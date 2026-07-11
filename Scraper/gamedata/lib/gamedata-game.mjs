import path from 'node:path';
import { downloadFile, fetchJson, mapLimit, gamedataStaticUrl } from './http.mjs';
import { collectionHashes, diffHashes } from './diff.mjs';
import { fromDatabasePath, readJson, writeJson } from './fs.mjs';

const STATE_ROOT = 'GameData/_state';
const CHANGE_ROOT = 'GameData/changes';

export async function scrapeConfiguredGame(options, config) {
  const databaseDir = path.resolve(options.databaseDir);
  const manifest = await fetchJson(gamedataStaticUrl('manifest.json'));
  const gameManifest = manifest?.[config.gameId];

  if (!gameManifest) {
    throw new Error(`GameData manifest does not contain a ${config.gameId} section`);
  }

  await writeJson(path.join(databaseDir, 'GameData', 'manifest.json'), removeRemoteLinks(manifest));

  const channelPlan = buildChannelPlan(config, gameManifest, normalizeChannels(options.channels));
  const results = [];
  let liveComparison = null;

  for (const channel of channelPlan) {
    const result = await scrapeChannel({
      ...options,
      databaseDir,
      manifest: gameManifest,
      channel,
      liveComparison,
      config
    });

    results.push(result.summary);

    if (channel.name === 'live') {
      liveComparison = result.comparison;
    }
  }

  return {
    provider: 'gamedata',
    game: config.gameId,
    channels: results,
    databaseDir
  };
}

async function scrapeChannel(context) {
  const {
    databaseDir,
    manifest,
    channel,
    concurrency,
    sample,
    skipAssets,
    forceAssets,
    includeSourceSnapshot,
    allowEmpty,
    liveComparison,
    config
  } = context;

  const channelDir = path.join(databaseDir, config.outputRoot, channel.name);
  const rawDir = path.join(channelDir, 'raw');
  const assetBag = createAssetBag(databaseDir, config);

  const lists = await fetchLists(config, channel.version);
  await writeRawLists(rawDir, lists);

  const detailResults = {};
  for (const section of config.sections) {
    if (!section.detailType) {
      continue;
    }

    const entries = sampleEntries(toEntries(lists[section.listKey]), sample);
    detailResults[section.key] = await fetchDetails(
      config,
      channel.version,
      section.detailType,
      entries,
      concurrency
    );
    await writeDetailSnapshots(rawDir, section.detailFolder || section.key, detailResults[section.key]);
  }

  const collections = {};
  for (const section of config.sections) {
    const entries = sampleEntries(toEntries(lists[section.listKey]), sample);
    collections[section.key] = entries.map(([id, summary]) => section.normalize({
      id,
      summary,
      detail: detailResults[section.key]?.[id] || null,
      channel: channel.name,
      lists,
      assetBag,
      config
    }));
  }

  // Asset registration happens during normalize, so the bag is fully populated by now.
  // sourceSnapshot is the verbatim upstream blob (the bulk of the file size); it is
  // dropped unless --debug is set. The same raw data is always written under raw/.
  if (!includeSourceSnapshot) {
    for (const key of Object.keys(collections)) {
      collections[key] = stripKeyDeep(collections[key], 'sourceSnapshot');
    }
  }

  const assetSummary = skipAssets
    ? { skipped: assetBag.downloads.size, downloaded: 0, cached: 0, missing: 0, missingAssets: [] }
    : await downloadAssets(assetBag, { concurrency, forceAssets });

  stripMissingAssetReferences(collections, assetSummary.missingAssets || []);

  const hashes = Object.fromEntries(
    Object.entries(collections).map(([name, records]) => [name, collectionHashes(records)])
  );

  // Robustness guard: read previous state up front and refuse to overwrite a populated
  // section with an empty one (a classic symptom of upstream returning an empty 200 or
  // renaming a field). This leaves the last good output in place. Override with --allow-empty.
  const previousStateFile = path.join(databaseDir, STATE_ROOT, `${config.gameId}-${channel.name}-hashes.json`);
  const previousState = await readJson(previousStateFile, {});
  assertNoSectionCollapse({ config, channel, previousState, collections, allowEmpty });

  if (channel.name === 'beta' && liveComparison) {
    markBetaStatus(collections, hashes, liveComparison.hashes);
  } else {
    for (const records of Object.values(collections)) {
      for (const record of records) {
        record.contentStatus = 'live';
      }
    }
  }

  const overview = buildOverview({
    config,
    manifest,
    channel,
    sample,
    lists,
    collections,
    assetCount: assetBag.downloads.size
  });

  await writeJson(path.join(channelDir, 'overview.json'), overview);
  for (const section of config.sections) {
    await writeJson(
      path.join(channelDir, section.outputFile || `${section.key}.json`),
      removeRemoteLinks(collections[section.key])
    );
  }

  const changes = buildChangeReport({ config, channel, previousState, hashes, collections, overview });

  await writeJson(previousStateFile, {
    game: config.gameId,
    channel: channel.name,
    version: channel.version,
    updatedAt: overview.scrapedAt,
    hashes
  });

  await writeJson(
    path.join(databaseDir, CHANGE_ROOT, `${config.gameId}-${channel.name}-latest.json`),
    changes
  );

  await writeJson(path.join(channelDir, 'missing-assets.json'), assetSummary.missingAssets || []);

  await writeJson(path.join(channelDir, 'metadata.json'), {
    ...overview,
    assets: assetSummary,
    changeReport: `${CHANGE_ROOT}/${config.gameId}-${channel.name}-latest.json`,
    missingAssetReport: `${config.outputRoot}/${channel.name}/missing-assets.json`
  });

  return {
    summary: {
      channel: channel.name,
      version: channel.version,
      output: `${config.outputRoot}/${channel.name}`,
      counts: overview.counts,
      assets: summarizeAssets(assetSummary),
      changes: changes.summary
    },
    comparison: {
      hashes,
      collections
    }
  };
}

function summarizeAssets(assetSummary) {
  const { missingAssets, ...summary } = assetSummary;
  if (missingAssets?.length) {
    summary.missingAssetReport = 'See missing-assets.json in the channel output folder.';
  }
  return summary;
}

function stripMissingAssetReferences(collections, missingAssets) {
  if (!missingAssets.length) {
    return;
  }

  const missingPaths = new Set(missingAssets.map((asset) => asset.path));
  for (const [key, records] of Object.entries(collections)) {
    collections[key] = stripMissingValue(records, missingPaths);
  }
}

function stripMissingValue(value, missingPaths) {
  if (typeof value === 'string') {
    return missingPaths.has(value) ? null : value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => stripMissingValue(item, missingPaths))
      .filter((item) => item !== null && item !== undefined);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([key, child]) => [key, stripMissingValue(child, missingPaths)])
      .filter(([, child]) => child !== null && child !== undefined));
  }

  return value;
}

async function fetchLists(config, version) {
  const entries = Object.entries(config.rawLists);
  const fetched = await Promise.all(entries.map(async ([name, endpoint]) => {
    const data = await fetchJson(gamedataStaticUrl(config.gameId, version, endpoint.file), {
      optional: Boolean(endpoint.optional)
    });
    return [name, data || {}];
  }));

  return Object.fromEntries(fetched);
}

async function writeRawLists(rawDir, lists) {
  await Promise.all(Object.entries(lists).map(([name, data]) => (
    writeJson(path.join(rawDir, `${name}.json`), removeRemoteLinks(data))
  )));
}

async function fetchDetails(config, version, detailType, entries, concurrency) {
  const detailEntries = await mapLimit(entries, concurrency, async ([id]) => {
    const data = await fetchJson(gamedataStaticUrl(config.gameId, version, 'en', detailType, `${id}.json`), {
      optional: true
    });
    return [id, data];
  });

  return Object.fromEntries(detailEntries.filter(([, data]) => data));
}

async function writeDetailSnapshots(rawDir, section, details) {
  await Promise.all(Object.entries(details).map(([id, data]) => (
    writeJson(path.join(rawDir, section, `${id}.json`), removeRemoteLinks(data))
  )));
}

async function downloadAssets(assetBag, options) {
  const assets = [...assetBag.downloads.values()];
  const results = await mapLimit(assets, options.concurrency, async (asset) => (
    downloadFile(asset.url, asset.targetFile, {
      optional: true,
      force: options.forceAssets
    })
  ));
  const missingAssets = results
    .map((result, index) => ({ result, asset: assets[index] }))
    .filter(({ result }) => result.status === 'missing')
    .map(({ asset }) => ({
      path: asset.databaseRelativePath,
      gamedataAssetPath: asset.remoteAssetPath
    }));

  return {
    requested: results.length,
    downloaded: results.filter((result) => result.status === 'downloaded').length,
    cached: results.filter((result) => result.status === 'cached').length,
    missing: missingAssets.length,
    missingAssets
  };
}

function buildOverview({ config, manifest, channel, sample, lists, collections, assetCount }) {
  const now = new Date().toISOString();
  const counts = Object.fromEntries(
    Object.entries(collections).map(([name, records]) => [name, records.length])
  );
  const sourceCounts = Object.fromEntries(
    config.sections.map((section) => [section.key, toEntries(lists[section.listKey]).length])
  );
  const files = Object.fromEntries(
    config.sections.map((section) => [
      section.key,
      `${config.outputRoot}/${channel.name}/${section.outputFile || `${section.key}.json`}`
    ])
  );

  files.raw = `${config.outputRoot}/${channel.name}/raw`;

  return removeRemoteLinks({
    provider: 'gamedata',
    game: config.gameId,
    gameName: config.gameName,
    channel: channel.name,
    version: channel.version,
    liveVersion: manifest.live || null,
    betaVersion: manifest.latest || null,
    availableVersions: manifest.available || [],
    sample: sample || null,
    scrapedAt: now,
    counts,
    sourceCounts,
    newInManifest: manifest.new || {},
    files,
    assetsPlanned: assetCount,
    contentStatus: channel.name === 'live'
      ? 'All records are Live records from the GameData live manifest version.'
      : 'Beta records are compared to Live and marked live, beta, or beta_changed.'
  });
}

export function assertNoSectionCollapse({ config, channel, previousState, collections, allowEmpty }) {
  if (allowEmpty) {
    return;
  }

  const collapsed = [];
  for (const section of config.sections) {
    const previousCount = Object.keys(previousState?.hashes?.[section.key] || {}).length;
    const currentCount = (collections[section.key] || []).length;
    if (previousCount > 0 && currentCount === 0) {
      collapsed.push(`${section.key} (${previousCount} -> 0)`);
    }
  }

  if (collapsed.length) {
    throw new Error(
      `Refusing to overwrite ${config.gameId}/${channel.name}: section(s) collapsed to empty: ${collapsed.join(', ')}. `
      + 'This usually means an upstream change broke parsing. Existing output was left untouched. '
      + 'Re-run with --allow-empty to override.'
    );
  }
}

function buildChangeReport({ config, channel, previousState, hashes, collections, overview }) {
  const sections = {};

  for (const [name, currentHashes] of Object.entries(hashes)) {
    const names = Object.fromEntries(collections[name].map((record) => [String(record.id), record.name || null]));
    sections[name] = diffHashes(previousState?.hashes?.[name] || {}, currentHashes, names);
  }

  const summary = Object.fromEntries(Object.entries(sections).map(([name, section]) => [
    name,
    {
      added: section.added.length,
      removed: section.removed.length,
      changed: section.changed.length,
      unchanged: section.unchanged
    }
  ]));

  return {
    provider: 'gamedata',
    game: config.gameId,
    channel: channel.name,
    version: channel.version,
    generatedAt: overview.scrapedAt,
    summary,
    sections
  };
}

function markBetaStatus(collections, betaHashes, liveHashes) {
  for (const [collectionName, records] of Object.entries(collections)) {
    for (const record of records) {
      const id = String(record.id);
      const liveHash = liveHashes?.[collectionName]?.[id];
      const betaHash = betaHashes?.[collectionName]?.[id];

      if (!liveHash) {
        record.contentStatus = 'beta';
      } else if (liveHash === betaHash) {
        record.contentStatus = 'live';
      } else {
        record.contentStatus = 'beta_changed';
      }

      record.liveComparison = {
        liveHash: liveHash || null,
        currentHash: betaHash || null
      };
    }
  }
}

function buildChannelPlan(config, manifest, requestedChannels) {
  const plans = [];

  for (const channel of requestedChannels) {
    if (channel === 'live') {
      plans.push({ name: 'live', version: manifest.live });
    } else if (channel === 'beta') {
      plans.push({ name: 'beta', version: manifest.latest || manifest.live });
    } else {
      throw new Error(`Unsupported ${config.gameId} channel "${channel}". Use live, beta, or both.`);
    }
  }

  const seen = new Set();
  return plans.filter((plan) => {
    const key = plan.name;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).sort((left, right) => {
    if (left.name === 'live') return -1;
    if (right.name === 'live') return 1;
    return 0;
  });
}

function normalizeChannels(channels) {
  if (!channels || channels.length === 0) {
    return ['live', 'beta'];
  }

  return channels.map((channel) => channel.toLowerCase());
}

function createAssetBag(databaseDir, config) {
  const downloads = new Map();

  return {
    downloads,
    register(databaseRelativePath, remoteAssetPath) {
      if (!remoteAssetPath) {
        return null;
      }

      const cleanRemote = String(remoteAssetPath).replace(/^\/+/, '');
      if (!downloads.has(databaseRelativePath)) {
        downloads.set(databaseRelativePath, {
          databaseRelativePath,
          remoteAssetPath: cleanRemote,
          url: gamedataStaticUrl('assets', config.gameId, cleanRemote),
          targetFile: fromDatabasePath(databaseDir, databaseRelativePath)
        });
      }

      return databaseRelativePath;
    }
  };
}

export function registerAsset(assetBag, config, category, sourceRef, options = {}) {
  if (!sourceRef) {
    return null;
  }

  const remote = config.assetPath(sourceRef, options);
  if (!remote) {
    return null;
  }

  const local = `${config.outputRoot}/assets/${category}/${remote}`;
  return assetBag.register(local, remote);
}

export function toEntries(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => [String(item?.id || item?.ID || index), item]);
  }

  return Object.entries(value).sort(([left], [right]) => (
    String(left).localeCompare(String(right), undefined, { numeric: true })
  ));
}

export function sampleEntries(entries, sample) {
  return sample ? entries.slice(0, sample) : entries;
}

export function removeRemoteLinks(value) {
  if (typeof value === 'string') {
    return /^https?:\/\//i.test(value) ? null : value;
  }

  if (Array.isArray(value)) {
    return value.map(removeRemoteLinks).filter((item) => item !== null && item !== undefined);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([key, child]) => [key, removeRemoteLinks(child)])
      .filter(([, child]) => child !== null && child !== undefined));
  }

  return value;
}

export function stripKeyDeep(value, dropKey) {
  if (Array.isArray(value)) {
    return value.map((item) => stripKeyDeep(item, dropKey));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== dropKey)
      .map(([key, child]) => [key, stripKeyDeep(child, dropKey)]));
  }

  return value;
}

export function removeEmpty(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  return Object.fromEntries(Object.entries(value).filter(([, child]) => {
    if (child === null || child === undefined) {
      return false;
    }

    if (Array.isArray(child)) {
      return true;
    }

    if (typeof child === 'object') {
      return Object.keys(child).length > 0;
    }

    return true;
  }));
}

export function text(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object') {
    return value.en || value.name || value.text || value.title || null;
  }

  return String(value);
}

export function parseRarity(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return value;
  }

  const qualityMap = {
    QUALITY_ORANGE: 5,
    QUALITY_PURPLE: 4,
    QUALITY_BLUE: 3,
    QUALITY_GREEN: 2,
    QUALITY_WHITE: 1
  };
  if (qualityMap[value]) {
    return qualityMap[value];
  }

  const match = String(value).match(/(\d+)(?!.*\d)/);
  return match ? Number.parseInt(match[1], 10) : value;
}

export function assetStem(sourceRef) {
  if (!sourceRef || typeof sourceRef !== 'string') {
    return null;
  }

  const fileName = sourceRef.split(/[\\/]/).pop() || '';
  return fileName.split('.')[0].replace(/\.(png|webp|jpg|jpeg)$/i, '') || null;
}

export function ensureWebp(value) {
  if (!value) {
    return null;
  }

  return String(value).replace(/\.(png|webp|jpg|jpeg)$/i, '') + '.webp';
}

export function normalizeMaterials(value, itemsById = {}, registerItemAsset = null) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeMaterialEntry(entry, itemsById, registerItemAsset));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).map(([id, quantity]) => normalizeMaterialEntry(
      { id, count: quantity },
      itemsById,
      registerItemAsset
    ));
  }

  if (typeof value === 'string') {
    return value.split('|').filter(Boolean).map((group, index) => ({
      group: index + 1,
      materials: group.split(',').filter(Boolean).map((part) => {
        const [id, quantity] = part.split(':');
        return normalizeMaterialEntry({ id, count: Number(quantity) }, itemsById, registerItemAsset);
      })
    }));
  }

  return [];
}

export function normalizeMaterialEntry(entry, itemsById = {}, registerItemAsset = null) {
  if (!entry || typeof entry !== 'object') {
    return entry;
  }

  const itemId = String(entry.id ?? entry.item_id ?? entry.key ?? entry.itemId ?? '');
  const item = itemId ? (itemsById[itemId] || {}) : {};
  const quantity = entry.count ?? entry.item_num ?? entry.value ?? entry.quantity ?? null;
  const icon = item.icon || item.icon_path || item.Icon || item.IconWw || entry.icon || null;

  return removeEmpty({
    itemId: itemId || null,
    quantity,
    name: entry.name || item.name || item.item_name || item.ItemName || null,
    rarity: entry.rank ?? entry.rarity ?? item.rank ?? item.rarity ?? item.Rarity ?? null,
    type: item.type || item.item_type || item.item_main_type || item.class || null,
    assets: {
      icon: registerItemAsset && icon ? registerItemAsset(icon) : null
    },
    sourceSnapshot: removeRemoteLinks({ entry, item })
  });
}
