import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectAchievementIconBytes, RELEASED_VERSIONS, validateCatalog } from './core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'Database', 'Achievements');
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_CONCURRENCY = 8;
const RETRIEVED_AT = new Date().toISOString();

const GI = Object.freeze({
  sourcePageUrl: 'https://gi.nanoka.cc/achievement',
  metadataUrl: `https://static.nanoka.cc/gi/${RELEASED_VERSIONS.gi}/en/achievement/achievement.json`,
  assetBaseUrl: 'https://static.nanoka.cc/assets/gi',
});

const HSR = Object.freeze({
  sourcePageUrl: 'https://honkai-star-rail.fandom.com/wiki/Category:Achievement_Icons',
  apiUrl: 'https://honkai-star-rail.fandom.com/api.php',
  fileNames: Object.freeze({
    '1': 'Achievement I, Trailblazer.png',
    '2': 'Achievement Vestige of Luminflux.png',
    '3': 'Achievement The Rail Unto the Stars.png',
    '4': 'Achievement Fathom the Unfathomable.png',
    '5': 'Achievement The Memories We Share.png',
    '6': 'Achievement Glory of the Unyielding.png',
    '7': 'Achievement Eager for Battle.png',
    '8': 'Achievement Moment of Joy.png',
    '9': 'Achievement Universe in a Nutshell.png',
  }),
});

const REWARDS = Object.freeze({
  gi: {
    name: 'Primogem',
    sourceKey: 'UI_ItemIcon_201',
    sourcePageUrl: GI.sourcePageUrl,
    resolvedAssetUrl: 'https://static.nanoka.cc/assets/gi/UI_ItemIcon_201.webp',
    localSource: path.join(REPO_ROOT, 'Database', 'GameData', 'gi', 'assets', 'items', 'UI_ItemIcon_201.webp'),
  },
  hsr: {
    name: 'Stellar Jade',
    sourceKey: '900001',
    sourcePageUrl: 'https://hsr.nanoka.cc/achievement',
    resolvedAssetUrl: 'https://static.nanoka.cc/assets/hsr/itemfigures/900001.webp',
    localSource: path.join(REPO_ROOT, 'Database', 'GameData', 'hsr', 'assets', 'items', '900001.webp'),
  },
});

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function sha1(bytes) { return crypto.createHash('sha1').update(bytes).digest('hex'); }

function assertFinalUrl(url, allowedHosts, label) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !allowedHosts.includes(parsed.hostname)) throw new Error(`${label} redirected to disallowed host ${parsed.hostname}`);
}

async function request(url, { allowedHosts, accept, label }) {
  const requested = new URL(url);
  if (requested.protocol !== 'https:' || !allowedHosts.includes(requested.hostname)) throw new Error(`${label} uses a disallowed source URL`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(requested, {
      headers: { accept, 'user-agent':'Pengo-Nyx-achievement-icon-refresh/1.0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
    assertFinalUrl(response.url, allowedHosts, label);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function boundedBytes(response, maximum, label) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximum) throw new Error(`${label} declares ${declared} bytes, above ${maximum}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maximum) throw new Error(`${label} returned ${bytes.length} bytes, outside the safe ceiling`);
  return bytes;
}

async function fetchJson(url, allowedHosts, label) {
  const response = await request(url, { allowedHosts, accept:'application/json', label });
  const bytes = await boundedBytes(response, MAX_JSON_BYTES, label);
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (!type.includes('json')) throw new Error(`${label} returned ${type || 'no content type'}, not JSON`);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch (error) { throw new Error(`${label} returned invalid JSON: ${error.message}`); }
}

async function fetchIcon(url, { allowedHosts, expectedMediaType, label }) {
  const response = await request(url, { allowedHosts, accept:expectedMediaType, label });
  const bytes = await boundedBytes(response, 256 * 1024, label);
  const inspected = inspectAchievementIconBytes(bytes);
  const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (inspected.mediaType !== expectedMediaType || type !== expectedMediaType) throw new Error(`${label} returned ${type || inspected.mediaType}, expected ${expectedMediaType}`);
  return { bytes, inspected, resolvedAssetUrl:response.url, etag:response.headers.get('etag') || null, lastModified:response.headers.get('last-modified') || null };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length:Math.min(limit, items.length) }, run));
  return results;
}

function runtimePath(game, kind, hash, extension) {
  return `/assets/achievements/${game}/${kind}/${hash}.${extension}`;
}

function localPath(game, kind, hash, extension) {
  return `${game}/assets/${kind}/${hash}.${extension}`;
}

function assetRecord(game, kind, source, result, extra = {}) {
  const extension = result.inspected.mediaType === 'image/png' ? 'png' : 'webp';
  const hash = sha256(result.bytes);
  return {
    ...source,
    ...extra,
    runtimePath: runtimePath(game, kind, hash, extension),
    localPath: localPath(game, kind, hash, extension),
    sha256: hash,
    bytes: result.bytes.length,
    mediaType: result.inspected.mediaType,
    width: result.inspected.width,
    height: result.inspected.height,
    etag: result.etag,
    lastModified: result.lastModified,
    retrievedAt: RETRIEVED_AT,
    _bytes: result.bytes,
  };
}

async function loadCatalog(game) {
  const file = path.join(OUTPUT_ROOT, game, 'catalog.json');
  const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  validateCatalog(parsed);
  if (parsed.game !== game || parsed.releasedVersion !== RELEASED_VERSIONS[game]) throw new Error(`${game} checked-in catalog is not the released catalog`);
  return { file, parsed };
}

async function giCategoryRecords(catalog) {
  const metadata = await fetchJson(GI.metadataUrl, ['static.nanoka.cc'], 'GI live achievement metadata');
  return mapLimit(catalog.categories, DOWNLOAD_CONCURRENCY, async (category) => {
    const source = metadata?.[category.sourceId];
    if (!source || String(source.id) !== category.sourceId || source.name !== category.name) throw new Error(`GI category ${category.id} does not exactly match live metadata`);
    const sourceKey = String(source.icon || '');
    if (!/^UI_AchievementIcon_[A-Za-z0-9_]+$/.test(sourceKey)) throw new Error(`GI category ${category.id} has an unsafe icon key`);
    const result = await fetchIcon(`${GI.assetBaseUrl}/${sourceKey}.webp`, { allowedHosts:['static.nanoka.cc'], expectedMediaType:'image/webp', label:`GI category ${category.id} icon` });
    return assetRecord('gi', 'categories', {
      categoryId: category.id,
      sourceId: category.sourceId,
      name: category.name,
      sourceKey,
      sourcePageUrl: GI.sourcePageUrl,
      metadataUrl: GI.metadataUrl,
      resolvedAssetUrl: result.resolvedAssetUrl,
    }, result);
  });
}

async function hsrFileInfo() {
  const titles = Object.values(HSR.fileNames).map((name) => `File:${name}`).join('|');
  const url = new URL(HSR.apiUrl);
  for (const [key, value] of Object.entries({ action:'query', format:'json', formatversion:'2', prop:'imageinfo', iiprop:'url|size|sha1|timestamp|mime', titles })) url.searchParams.set(key, value);
  const metadata = await fetchJson(url, ['honkai-star-rail.fandom.com'], 'HSR achievement icon metadata');
  const pages = metadata?.query?.pages;
  if (!Array.isArray(pages)) throw new Error('HSR achievement icon metadata has no pages');
  return new Map(pages.map((page) => [String(page.title || '').replace(/^File:/, ''), page.imageinfo?.[0]]));
}

async function hsrCategoryRecords(catalog) {
  const infos = await hsrFileInfo();
  return mapLimit(catalog.categories, DOWNLOAD_CONCURRENCY, async (category) => {
    const fileName = HSR.fileNames[category.sourceId];
    if (!fileName || !fileName.startsWith(`Achievement ${category.name}`)) throw new Error(`HSR category ${category.id} has no reviewed base icon mapping`);
    const info = infos.get(fileName);
    if (!info || info.mime !== 'image/png' || !info.url || !/^[a-f0-9]{40}$/.test(info.sha1 || '')) throw new Error(`HSR category ${category.id} has incomplete file metadata`);
    const originalUrl = new URL(info.url);
    originalUrl.searchParams.set('format', 'original');
    const result = await fetchIcon(originalUrl, { allowedHosts:['static.wikia.nocookie.net'], expectedMediaType:'image/png', label:`HSR category ${category.id} icon` });
    if (result.bytes.length !== Number(info.size) || result.inspected.width !== Number(info.width) || result.inspected.height !== Number(info.height) || sha1(result.bytes) !== info.sha1) throw new Error(`HSR category ${category.id} does not match its pinned file revision`);
    return assetRecord('hsr', 'categories', {
      categoryId: category.id,
      sourceId: category.sourceId,
      name: category.name,
      sourceKey: fileName,
      sourcePageUrl: HSR.sourcePageUrl,
      metadataUrl: HSR.apiUrl,
      resolvedAssetUrl: result.resolvedAssetUrl,
    }, result, { sourceSha1:info.sha1, sourceTimestamp:info.timestamp });
  });
}

async function rewardRecord(game) {
  const config = REWARDS[game];
  const localBytes = await fs.readFile(config.localSource);
  const localInspected = inspectAchievementIconBytes(localBytes);
  if (localInspected.mediaType !== 'image/webp') throw new Error(`${game} reward source is not WebP`);
  const remote = await fetchIcon(config.resolvedAssetUrl, { allowedHosts:['static.nanoka.cc'], expectedMediaType:'image/webp', label:`${game} reward icon` });
  if (sha256(localBytes) !== sha256(remote.bytes)) throw new Error(`${game} checked-in reward icon differs from its released source`);
  return assetRecord(game, 'rewards', {
    name: config.name,
    sourceKey: config.sourceKey,
    sourcePageUrl: config.sourcePageUrl,
    metadataUrl: null,
    resolvedAssetUrl: remote.resolvedAssetUrl,
    sourceLocalPath: path.relative(REPO_ROOT, config.localSource).replace(/\\/g, '/'),
  }, { ...remote, bytes:localBytes, inspected:localInspected });
}

async function synchronizeDirectory(game, kind, records) {
  const dir = path.join(OUTPUT_ROOT, game, 'assets', kind);
  await fs.mkdir(dir, { recursive:true });
  const expected = new Set(records.map((row) => path.basename(row.localPath)));
  for (const row of records) {
    const file = path.join(dir, path.basename(row.localPath));
    try { await fs.writeFile(file, row._bytes, { flag:'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await fs.readFile(file);
      if (!existing.equals(row._bytes)) throw new Error(`content-addressed asset collision at ${file}`);
    }
  }
  for (const entry of await fs.readdir(dir, { withFileTypes:true })) {
    if (!entry.isFile() || !/^[a-f0-9]{64}\.(?:png|webp)$/.test(entry.name)) throw new Error(`unexpected achievement asset entry ${path.join(dir, entry.name)}`);
    if (!expected.has(entry.name)) await fs.unlink(path.join(dir, entry.name));
  }
}

function publicRecord(row) {
  const { _bytes, ...publicFields } = row;
  return publicFields;
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force:true });
  }
}

const catalogs = Object.fromEntries(await Promise.all(['gi', 'hsr'].map(async (game) => [game, await loadCatalog(game)])));
const [giCategories, hsrCategories, giReward, hsrReward] = await Promise.all([
  giCategoryRecords(catalogs.gi.parsed),
  hsrCategoryRecords(catalogs.hsr.parsed),
  rewardRecord('gi'),
  rewardRecord('hsr'),
]);
const categoryRecords = { gi:giCategories, hsr:hsrCategories };
const rewardRecords = { gi:giReward, hsr:hsrReward };

for (const game of ['gi', 'hsr']) {
  await synchronizeDirectory(game, 'categories', categoryRecords[game]);
  await synchronizeDirectory(game, 'rewards', [rewardRecords[game]]);
  const iconByCategory = new Map(categoryRecords[game].map((row) => [row.categoryId, row]));
  const catalog = catalogs[game].parsed;
  catalog.categories = catalog.categories.map((category) => {
    const row = iconByCategory.get(category.id);
    if (!row) throw new Error(`${game} category ${category.id} is missing a downloaded icon`);
    return { ...category, icon:{ kind:'image', path:row.runtimePath, sourceKey:row.sourceKey } };
  });
  const reward = rewardRecords[game];
  catalog.rewardCurrency = { name:reward.name, icon:{ kind:'image', path:reward.runtimePath, sourceKey:reward.sourceKey } };
  validateCatalog(catalog);
}

const provenance = {
  schemaVersion: 1,
  generatedBy: 'Scraper/achievements/refresh-icons.mjs',
  generatedAt: RETRIEVED_AT,
  runtimeHotlinks: false,
  licenseClaim: null,
  games: Object.fromEntries(['gi', 'hsr'].map((game) => [game, {
    releasedVersion: RELEASED_VERSIONS[game],
    categoryCount: categoryRecords[game].length,
    categories: categoryRecords[game].map(publicRecord),
    rewardCurrency: publicRecord(rewardRecords[game]),
  }])),
  rightsNote: 'No license is claimed for game artwork. Game content and assets remain owned by HoYoverse / COGNOSPHERE / miHoYo. Pengo is an unofficial, non-affiliated fan tool.',
};

await writeJsonAtomic(path.join(OUTPUT_ROOT, 'asset-provenance.json'), provenance);
for (const game of ['gi', 'hsr']) await writeJsonAtomic(catalogs[game].file, catalogs[game].parsed);

for (const game of ['gi', 'hsr']) {
  const categoryBytes = categoryRecords[game].reduce((sum, row) => sum + row.bytes, 0);
  console.log(`${game}: ${categoryRecords[game].length} category icons (${categoryBytes} bytes), ${rewardRecords[game].name} (${rewardRecords[game].bytes} bytes)`);
}
