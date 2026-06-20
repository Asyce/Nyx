import path from 'node:path';
import { downloadFile, fetchJson, mapLimit, nanokaStaticUrl } from '../lib/http.mjs';
import { collectionHashes, diffHashes } from '../lib/diff.mjs';
import { fromDatabasePath, readJson, writeJson } from '../lib/fs.mjs';

const GAME_ID = 'hsr';
const GAME_NAME = 'Honkai: Star Rail';
const OUTPUT_ROOT = 'Nanoka/hsr';
const ASSET_ROOT = `${OUTPUT_ROOT}/assets`;
const STATE_ROOT = 'Nanoka/_state';
const CHANGE_ROOT = 'Nanoka/changes';

const LIST_ENDPOINTS = {
  characters: { file: 'character.json' },
  lightcones: { file: 'lightcone.json' },
  relics: { file: 'relicset.json' },
  monsters: { file: 'monster.json', optional: true },
  items: { file: 'en/item.json', optional: true },
  itemAll: { file: 'en/item_all.json', optional: true }
};

export async function scrapeHsr(options) {
  const databaseDir = path.resolve(options.databaseDir);
  const manifest = await fetchJson(nanokaStaticUrl('manifest.json'));
  const hsrManifest = manifest?.[GAME_ID];

  if (!hsrManifest) {
    throw new Error('Nanoka manifest does not contain an HSR section');
  }

  await writeJson(path.join(databaseDir, 'Nanoka', 'manifest.json'), removeRemoteLinks(manifest));

  const requestedChannels = normalizeChannels(options.channels);
  const channelPlan = buildChannelPlan(hsrManifest, requestedChannels);
  const results = [];
  let liveComparison = null;

  for (const channel of channelPlan) {
    const result = await scrapeChannel({
      ...options,
      databaseDir,
      manifest: hsrManifest,
      channel,
      liveComparison
    });

    results.push(result.summary);

    if (channel.name === 'live') {
      liveComparison = result.comparison;
    }
  }

  return {
    provider: 'nanoka',
    game: GAME_ID,
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
    liveComparison
  } = context;

  const channelDir = path.join(databaseDir, OUTPUT_ROOT, channel.name);
  const rawDir = path.join(channelDir, 'raw');
  const assetBag = createAssetBag(databaseDir);

  const lists = await fetchLists(channel.version);
  await writeRawLists(rawDir, lists);

  const characterEntries = sampleEntries(toEntries(lists.characters), sample);
  const lightconeEntries = sampleEntries(toEntries(lists.lightcones), sample);
  const relicEntries = sampleEntries(toEntries(lists.relics), sample);

  const characterDetails = await fetchDetails(channel.version, 'character', characterEntries, concurrency);
  const lightconeDetails = await fetchDetails(channel.version, 'lightcone', lightconeEntries, concurrency);
  const relicDetails = await fetchDetails(channel.version, 'relicset', relicEntries, concurrency);

  await writeDetailSnapshots(rawDir, 'characters', characterDetails);
  await writeDetailSnapshots(rawDir, 'lightcones', lightconeDetails);
  await writeDetailSnapshots(rawDir, 'relics', relicDetails);

  const itemsById = lists.itemAll || lists.items || {};
  const characters = characterEntries.map(([id, summary]) => normalizeCharacter({
    id,
    summary,
    detail: characterDetails[id],
    channel: channel.name,
    itemsById,
    assetBag
  }));

  const lightcones = lightconeEntries.map(([id, summary]) => normalizeLightcone({
    id,
    summary,
    detail: lightconeDetails[id],
    channel: channel.name,
    itemsById,
    assetBag
  }));

  const relics = relicEntries.map(([id, summary]) => normalizeRelic({
    id,
    summary,
    detail: relicDetails[id],
    channel: channel.name,
    assetBag
  }));

  const items = normalizeItems(lists.itemAll || lists.items || {}, assetBag, sample);
  const monsters = normalizeMonsters(lists.monsters || {}, sample);

  const collections = { characters, lightcones, relics, items, monsters };
  const hashes = Object.fromEntries(
    Object.entries(collections).map(([name, records]) => [name, collectionHashes(records)])
  );

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
    manifest,
    channel,
    sample,
    lists,
    collections,
    assetCount: assetBag.downloads.size
  });

  await writeJson(path.join(channelDir, 'overview.json'), overview);
  await writeJson(path.join(channelDir, 'characters.json'), removeRemoteLinks(characters));
  await writeJson(path.join(channelDir, 'lightcones.json'), removeRemoteLinks(lightcones));
  await writeJson(path.join(channelDir, 'relics.json'), removeRemoteLinks(relics));
  await writeJson(path.join(channelDir, 'items.json'), removeRemoteLinks(items));
  await writeJson(path.join(channelDir, 'monsters.json'), removeRemoteLinks(monsters));

  const previousStateFile = path.join(databaseDir, STATE_ROOT, `${GAME_ID}-${channel.name}-hashes.json`);
  const previousState = await readJson(previousStateFile, {});
  const changes = buildChangeReport({ channel, previousState, hashes, collections, overview });

  await writeJson(previousStateFile, {
    game: GAME_ID,
    channel: channel.name,
    version: channel.version,
    updatedAt: overview.scrapedAt,
    hashes
  });

  await writeJson(
    path.join(databaseDir, CHANGE_ROOT, `${GAME_ID}-${channel.name}-latest.json`),
    changes
  );

  const assetSummary = skipAssets
    ? { skipped: assetBag.downloads.size, downloaded: 0, cached: 0, missing: 0, missingAssets: [] }
    : await downloadAssets(assetBag, { concurrency, forceAssets });

  await writeJson(path.join(channelDir, 'missing-assets.json'), assetSummary.missingAssets || []);

  await writeJson(path.join(channelDir, 'metadata.json'), {
    ...overview,
    assets: assetSummary,
    changeReport: `${CHANGE_ROOT}/${GAME_ID}-${channel.name}-latest.json`,
    missingAssetReport: `${OUTPUT_ROOT}/${channel.name}/missing-assets.json`
  });

  return {
    summary: {
      channel: channel.name,
      version: channel.version,
      output: `${OUTPUT_ROOT}/${channel.name}`,
      counts: overview.counts,
      assets: assetSummary,
      changes: changes.summary
    },
    comparison: {
      hashes,
      collections
    }
  };
}

async function fetchLists(version) {
  const entries = Object.entries(LIST_ENDPOINTS);
  const fetched = await Promise.all(entries.map(async ([name, endpoint]) => {
    const data = await fetchJson(nanokaStaticUrl(GAME_ID, version, endpoint.file), {
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

async function fetchDetails(version, detailType, entries, concurrency) {
  const detailEntries = await mapLimit(entries, concurrency, async ([id]) => {
    const data = await fetchJson(nanokaStaticUrl(GAME_ID, version, 'en', detailType, `${id}.json`), {
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

function normalizeCharacter({ id, summary, detail, channel, itemsById, assetBag }) {
  const name = detail?.name || text(summary?.en) || String(id);
  const record = {
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name,
    rarity: parseRarity(detail?.rarity || summary?.rank),
    rarityRaw: detail?.rarity || summary?.rank || null,
    path: detail?.base_type || summary?.baseType || null,
    element: detail?.damage_type || summary?.damageType || null,
    description: detail?.desc || summary?.desc || null,
    release: summary?.release || null,
    assets: {
      avatar: assetBag.register(`${ASSET_ROOT}/characters/avatar/${id}.webp`, `avataricon/avatar/${id}.webp`),
      roundIcon: assetBag.register(`${ASSET_ROOT}/characters/round/${id}.webp`, `avatarroundicon/${id}.webp`),
      shopIcon: assetBag.register(`${ASSET_ROOT}/characters/shop/${id}.webp`, `avatarshopicon/${id}.webp`),
      drawCard: assetBag.register(`${ASSET_ROOT}/characters/draw-card/${id}.webp`, `avatardrawcard/${id}.webp`)
    },
    profile: removeRemoteLinks(detail?.chara_info || null),
    skills: normalizeSkills(detail?.skills || {}, itemsById, assetBag),
    eidolons: normalizeRanks(detail?.ranks || {}, assetBag),
    traces: normalizeSkillTrees(detail?.skill_trees || {}, itemsById, assetBag),
    ascensions: normalizeStats(detail?.stats || {}, itemsById, assetBag),
    recommendations: removeRemoteLinks({
      relics: detail?.relics || null,
      lightcones: detail?.lightcones || null,
      teams: detail?.teams || null
    }),
    extras: removeRemoteLinks({
      enhance: summary?.enhance || detail?.enhanced || [],
      memosprite: detail?.memosprite || null,
      unique: detail?.unique || null,
      skin: detail?.skin || null,
      avatarVoTag: detail?.avatar_vo_tag || null,
      spNeed: detail?.sp_need ?? null
    }),
    sourceSnapshot: removeRemoteLinks({
      summary,
      detail
    })
  };

  return removeEmpty(record);
}

function normalizeLightcone({ id, summary, detail, channel, itemsById, assetBag }) {
  const name = detail?.name || text(summary?.en) || String(id);
  const record = {
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name,
    rarity: parseRarity(detail?.rarity || summary?.rank),
    rarityRaw: detail?.rarity || summary?.rank || null,
    path: detail?.base_type || summary?.baseType || null,
    description: detail?.desc || summary?.desc || null,
    attack: summary?.atk ?? null,
    assets: {
      mediumIcon: assetBag.register(`${ASSET_ROOT}/lightcones/medium/${id}.webp`, `lightconemediumicon/${id}.webp`),
      fullFigure: assetBag.register(`${ASSET_ROOT}/lightcones/full/${id}.webp`, `lightconemaxfigures/${id}.webp`)
    },
    effect: normalizeLightconeEffect(detail?.refinements || {}),
    ascensions: normalizeStats(detail?.stats || [], itemsById, assetBag),
    sourceSnapshot: removeRemoteLinks({
      summary,
      detail
    })
  };

  return removeEmpty(record);
}

function normalizeRelic({ id, summary, detail, channel, assetBag }) {
  const iconStem = iconStemFromRef(detail?.icon || summary?.icon);
  const record = {
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name: detail?.name || text(summary?.en) || String(id),
    rarity: null,
    type: relicSetType(id),
    description: null,
    assets: {
      icon: iconStem
        ? assetBag.register(`${ASSET_ROOT}/relics/sets/${iconStem}.webp`, `itemfigures/${iconStem}.webp`)
        : null
    },
    setEffects: normalizeRelicEffects(detail?.require_num || summary?.set || {}),
    parts: normalizeRelicParts(detail?.parts || {}),
    sourceSnapshot: removeRemoteLinks({
      summary,
      detail
    })
  };

  return removeEmpty(record);
}

function normalizeItems(items, assetBag, sample) {
  return sampleEntries(toEntries(items), sample).map(([id, item]) => {
    const iconStem = iconStemFromRef(item?.item_figure_icon_path || item?.item_icon_path);
    return removeEmpty({
      id: String(id),
      contentStatus: 'live',
      name: item?.item_name || String(id),
      rarity: item?.rarity || null,
      type: item?.item_main_type || null,
      subType: item?.item_sub_type || null,
      description: item?.item_desc || null,
      backgroundDescription: item?.item_bg_desc || null,
      purposeType: item?.purpose_type ?? null,
      assets: {
        icon: iconStem
          ? assetBag.register(`${ASSET_ROOT}/items/${iconStem}.webp`, `itemfigures/${iconStem}.webp`)
          : null
      },
      sourceSnapshot: removeRemoteLinks(item)
    });
  });
}

function normalizeMonsters(monsters, sample) {
  return sampleEntries(toEntries(monsters), sample).map(([id, monster]) => removeEmpty({
    id: String(id),
    contentStatus: 'live',
    name: text(monster?.en) || monster?.name || String(id),
    rarity: monster?.rarity || null,
    type: monster?.type || monster?.monster_type || null,
    description: monster?.desc || null,
    sourceSnapshot: removeRemoteLinks(monster)
  }));
}

function normalizeSkills(skills, itemsById, assetBag) {
  return toEntries(skills).map(([key, skill]) => {
    const { level, ...rest } = skill || {};
    return removeEmpty({
      key,
      id: String(skill?.id || key),
      name: skill?.name || String(key),
      description: skill?.desc || null,
      simpleDescription: skill?.simple_desc || null,
      type: skill?.type || null,
      typeName: skill?.type_name || null,
      tag: skill?.tag || null,
      spBase: skill?.sp_base ?? null,
      bpNeed: skill?.bp_need ?? null,
      bpAdd: skill?.bp_add ?? null,
      levels: normalizeLevelMap(level || {}),
      extra: removeRemoteLinks(rest.extra || {}),
      sourceSnapshot: removeRemoteLinks(rest)
    });
  });
}

function normalizeRanks(ranks, assetBag) {
  return toEntries(ranks).map(([key, rank]) => removeEmpty({
    key,
    id: String(rank?.id || key),
    name: rank?.name || String(key),
    description: rank?.desc || null,
    params: rank?.param_list || [],
    assets: {
      icon: registerSkillIcon(rank?.icon, assetBag)
    },
    sourceSnapshot: removeRemoteLinks(rank)
  }));
}

function normalizeSkillTrees(skillTrees, itemsById, assetBag) {
  return toEntries(skillTrees).map(([node, levels]) => removeEmpty({
    node,
    levels: toEntries(levels || {}).map(([level, data]) => {
      const enriched = enrichMaterialsDeep(data || {}, itemsById, assetBag);
      return removeEmpty({
        level: Number.parseInt(level, 10),
        anchor: data?.anchor || null,
        pointId: data?.point_id ? String(data.point_id) : null,
        pointName: data?.point_name || null,
        pointDescription: data?.point_desc || null,
        pointType: data?.point_type ?? null,
        triggerKey: data?.point_trigger_key ?? null,
        defaultUnlock: data?.default_unlock ?? null,
        maxLevel: data?.max_level ?? null,
        avatarPromotionLimit: data?.avatar_promotion_limit ?? null,
        avatarLevelLimit: data?.avatar_level_limit ?? null,
        prePoint: data?.pre_point || [],
        levelUpSkillIds: data?.level_up_skill_id || [],
        params: data?.param_list || [],
        statusAdds: data?.status_add_list || [],
        requirements: enriched.material_list || [],
        assets: {
          icon: registerTraceOrSkillIcon(data?.icon, assetBag)
        },
        sourceSnapshot: removeRemoteLinks(enriched)
      });
    })
  }));
}

function normalizeStats(stats, itemsById, assetBag) {
  return toEntries(stats).map(([key, data]) => {
    const enriched = enrichMaterialsDeep(data || {}, itemsById, assetBag);
    return removeEmpty({
      key,
      promotion: enriched.promotion ?? (Number.isFinite(Number(key)) ? Number(key) : null),
      playerLevelRequirement: enriched.player_level_require ?? null,
      worldLevelRequirement: enriched.world_level_require ?? null,
      maxLevel: enriched.max_level ?? null,
      requirements: enriched.cost || enriched.promotion_cost_list || [],
      stats: removeRemoteLinks(omitKeys(enriched, [
        'cost',
        'promotion_cost_list',
        'player_level_require',
        'world_level_require',
        'max_level',
        'promotion'
      ])),
      sourceSnapshot: removeRemoteLinks(enriched)
    });
  });
}

function normalizeLightconeEffect(refinements) {
  const { level, ...rest } = refinements || {};
  return removeEmpty({
    name: refinements?.name || null,
    description: refinements?.desc || null,
    levels: normalizeLevelMap(level || {}),
    sourceSnapshot: removeRemoteLinks(rest)
  });
}

function normalizeRelicEffects(effects) {
  return toEntries(effects).map(([pieces, effect]) => removeEmpty({
    pieces: Number.parseInt(pieces, 10),
    description: effect?.desc || effect?.en || null,
    params: effect?.param_list || effect?.ParamList || [],
    sourceSnapshot: removeRemoteLinks(effect)
  }));
}

function normalizeRelicParts(parts) {
  return toEntries(parts).map(([id, part]) => removeEmpty({
    id: String(id),
    name: part?.name || String(id),
    description: part?.desc || null,
    story: part?.story || null,
    sourceSnapshot: removeRemoteLinks(part)
  }));
}

function normalizeLevelMap(levels) {
  return toEntries(levels).map(([level, data]) => removeEmpty({
    level: Number.parseInt(level, 10),
    params: data?.param_list || data?.ParamList || [],
    sourceSnapshot: removeRemoteLinks(data)
  }));
}

function enrichMaterialsDeep(value, itemsById, assetBag) {
  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === 'object' && 'item_id' in item)) {
      return value.map((item) => enrichMaterial(item, itemsById, assetBag));
    }

    return value.map((item) => enrichMaterialsDeep(item, itemsById, assetBag));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      enrichMaterialsDeep(child, itemsById, assetBag)
    ]));
  }

  return value;
}

function enrichMaterial(material, itemsById, assetBag) {
  const itemId = String(material.item_id);
  const item = itemsById?.[itemId] || {};
  const iconStem = iconStemFromRef(item.item_figure_icon_path || item.item_icon_path);

  return removeEmpty({
    itemId,
    quantity: material.item_num ?? null,
    rarity: material.rarity || item.rarity || null,
    name: item.item_name || null,
    type: item.item_main_type || null,
    subType: item.item_sub_type || null,
    description: item.item_desc || item.item_bg_desc || null,
    assets: {
      icon: iconStem
        ? assetBag.register(`${ASSET_ROOT}/items/${iconStem}.webp`, `itemfigures/${iconStem}.webp`)
        : null
    },
    sourceSnapshot: removeRemoteLinks({
      material,
      item
    })
  });
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
      nanokaAssetPath: asset.remoteAssetPath
    }));

  return {
    requested: results.length,
    downloaded: results.filter((result) => result.status === 'downloaded').length,
    cached: results.filter((result) => result.status === 'cached').length,
    missing: missingAssets.length,
    missingAssets
  };
}

function buildOverview({ manifest, channel, sample, lists, collections, assetCount }) {
  const now = new Date().toISOString();
  const counts = Object.fromEntries(
    Object.entries(collections).map(([name, records]) => [name, records.length])
  );

  return removeRemoteLinks({
    provider: 'nanoka',
    game: GAME_ID,
    gameName: GAME_NAME,
    channel: channel.name,
    version: channel.version,
    liveVersion: manifest.live || null,
    betaVersion: manifest.latest || null,
    availableVersions: manifest.available || [],
    sample: sample || null,
    scrapedAt: now,
    counts,
    sourceCounts: {
      characters: toEntries(lists.characters).length,
      lightcones: toEntries(lists.lightcones).length,
      relics: toEntries(lists.relics).length,
      monsters: toEntries(lists.monsters).length,
      items: toEntries(lists.itemAll || lists.items).length
    },
    newInManifest: manifest.new || {},
    files: {
      characters: `${OUTPUT_ROOT}/${channel.name}/characters.json`,
      lightcones: `${OUTPUT_ROOT}/${channel.name}/lightcones.json`,
      relics: `${OUTPUT_ROOT}/${channel.name}/relics.json`,
      items: `${OUTPUT_ROOT}/${channel.name}/items.json`,
      monsters: `${OUTPUT_ROOT}/${channel.name}/monsters.json`,
      raw: `${OUTPUT_ROOT}/${channel.name}/raw`
    },
    assetsPlanned: assetCount,
    contentStatus: channel.name === 'live'
      ? 'All records are Live records from the Nanoka live manifest version.'
      : 'Beta records are compared to Live and marked live, beta, or beta_changed.'
  });
}

function buildChangeReport({ channel, previousState, hashes, collections, overview }) {
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
    provider: 'nanoka',
    game: GAME_ID,
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

function buildChannelPlan(manifest, requestedChannels) {
  const plans = [];

  for (const channel of requestedChannels) {
    if (channel === 'live') {
      plans.push({ name: 'live', version: manifest.live });
    } else if (channel === 'beta') {
      plans.push({ name: 'beta', version: manifest.latest || manifest.live });
    } else {
      throw new Error(`Unsupported HSR channel "${channel}". Use live, beta, or both.`);
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

function createAssetBag(databaseDir) {
  const downloads = new Map();

  return {
    downloads,
    register(databaseRelativePath, remoteAssetPath) {
      if (!remoteAssetPath) {
        return null;
      }

      if (!downloads.has(databaseRelativePath)) {
        downloads.set(databaseRelativePath, {
          databaseRelativePath,
          remoteAssetPath,
          url: nanokaStaticUrl('assets', GAME_ID, remoteAssetPath),
          targetFile: fromDatabasePath(databaseDir, databaseRelativePath)
        });
      }

      return databaseRelativePath;
    }
  };
}

function registerSkillIcon(iconRef, assetBag) {
  const stem = iconStemFromRef(iconRef);
  return stem ? assetBag.register(`${ASSET_ROOT}/skills/${stem}.webp`, `skillicons/${stem}.webp`) : null;
}

function registerTraceOrSkillIcon(iconRef, assetBag) {
  const stem = iconStemFromRef(iconRef);
  if (!stem) {
    return null;
  }

  if (stem.startsWith('SkillIcon_')) {
    return assetBag.register(`${ASSET_ROOT}/skills/${stem}.webp`, `skillicons/${stem}.webp`);
  }

  return assetBag.register(`${ASSET_ROOT}/traces/${stem}.webp`, `trace/${stem}.webp`);
}

function toEntries(value) {
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

function sampleEntries(entries, sample) {
  return sample ? entries.slice(0, sample) : entries;
}

function parseRarity(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return value;
  }

  const match = String(value).match(/(\d+)(?!.*\d)/);
  return match ? Number.parseInt(match[1], 10) : value;
}

function text(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object') {
    return value.en || value.name || value.text || null;
  }

  return String(value);
}

function iconStemFromRef(iconRef) {
  if (!iconRef || typeof iconRef !== 'string') {
    return null;
  }

  const fileName = iconRef.split(/[\\/]/).pop();
  return fileName ? fileName.replace(/\.(png|webp|jpg|jpeg)$/i, '') : null;
}

function relicSetType(id) {
  const numericId = Number(id);
  if (Number.isFinite(numericId) && numericId >= 300) {
    return 'planar ornament';
  }

  return 'cavern relic';
}

function omitKeys(value, keys) {
  const keySet = new Set(keys);
  return Object.fromEntries(Object.entries(value || {}).filter(([key]) => !keySet.has(key)));
}

function removeRemoteLinks(value) {
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

function removeEmpty(value) {
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
