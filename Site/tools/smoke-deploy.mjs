import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { inspectAchievementIconBytes, validateCatalog as validateAchievementCatalog } from '../../Scraper/achievements/core.mjs';
import { buildDatabaseAssetEntry } from './database-assets.mjs';
import { assertDeployCommitIdentity } from './deploy-commit.mjs';
import { buildManifest, loadManifestInputs, validatePackagedManifest } from './generate-launcher-manifest.mjs';
import { validateLauncherTools } from './generate-launcher-tools.mjs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(__dirname, '..');
const root = path.resolve(siteDir, '..');
const deployDir = path.resolve(root, '.deploy', 'pengo');
const CLOUDFLARE_ASSET_FILE_LIMIT = 20_000;
const databaseAssetMode = String(process.env.PENGO_DATABASE_ASSET_MODE || 'dual').toLowerCase();

const routeFiles = new Map([
  ['/', 'index.html'],
  ['/nyx', 'nyx.html'],
  ['/genshin', 'genshin.html'],
  ['/hsr', 'hsr.html'],
  ['/zzz', 'zzz.html'],
  ['/wuwa', 'wuwa.html'],
  ['/endfield', 'endfield.html'],
]);
const routePrefixes = [
  ['/nyx/', 'nyx.html'],
  ['/genshin/', 'genshin.html'],
  ['/hsr/', 'hsr.html'],
  ['/zzz/', 'zzz.html'],
  ['/wuwa/', 'wuwa.html'],
  ['/endfield/', 'endfield.html'],
];

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ps1': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
};

function deployPath(urlPath) {
  const pathname = decodeURIComponent(urlPath.split('?')[0] || '/');
  const routeFile = routeFiles.get(pathname) || (routePrefixes.find(([prefix]) => pathname.startsWith(prefix)) || [])[1];
  const rel = routeFile || pathname.replace(/^\/+/, '');
  const candidate = path.resolve(deployDir, rel);
  if (!candidate.startsWith(deployDir)) return null;
  return candidate;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const file = deployPath(req.url || '/');
      if (!file || !(await exists(file))) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const body = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String(error && error.message || error));
    }
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function readDeployText(rel) {
  return fs.readFile(path.resolve(deployDir, rel), 'utf8');
}

async function assertNotExists(rel) {
  const target = path.resolve(deployDir, rel);
  if (await exists(target)) throw new Error(`${rel} should not exist in deploy output`);
}

async function countFiles(dir) {
  let count = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes:true })) {
    if (entry.isDirectory()) count += await countFiles(path.resolve(dir, entry.name));
    else count += 1;
  }
  return count;
}

async function verifyRuntimeData(base) {
  const manifestText = await readDeployText('data/runtime-manifest.json');
  const manifest = JSON.parse(manifestText);
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('runtime manifest is missing or invalid');
  const urls = new Set();
  const entriesByUrl = new Map();
  for (const entry of manifest.files) {
    const achievementAsset = /^\/assets\/achievements\/(?:gi|hsr)\/(?:categories|rewards)\/[a-f0-9]{64}\.(?:png|webp)$/.test(entry?.url ?? '');
    if ((!entry?.url?.startsWith('/data/') && !achievementAsset) || entry.url.includes('..') || urls.has(entry.url)) throw new Error(`runtime manifest has unsafe/duplicate URL ${entry?.url}`);
    urls.add(entry.url);
    entriesByUrl.set(entry.url, entry);
    const relative = entry.url.replace(/^\/+/, '');
    const bytes = await fs.readFile(path.resolve(deployDir, relative));
    if (bytes.length !== entry.size) throw new Error(`${entry.url} size does not match runtime manifest`);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (hash !== entry.sha256) throw new Error(`${entry.url} hash does not match runtime manifest`);
    if (/\.json$/i.test(entry.url)) JSON.parse(bytes.toString('utf8'));
    else {
      const iconHash = entry.url.match(/\/([a-f0-9]{64})\.(?:png|webp)$/i)?.[1];
      const webp = bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
      const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      if (!iconHash || iconHash !== hash || (!webp && !png)) throw new Error(`runtime manifest has invalid binary ${entry.url}`);
      if (achievementAsset) inspectAchievementIconBytes(bytes);
    }
  }
  for (const game of ['gi','hsr']) {
    const achievementUrl = `/data/achievements/${game}/catalog.json`;
    if (!urls.has(achievementUrl)) throw new Error(`runtime manifest is missing ${achievementUrl}`);
    const catalog = JSON.parse(await readDeployText(achievementUrl.slice(1)));
    try {
      if (catalog?.game !== game) throw new Error(`catalog game ${catalog?.game} does not match ${game}`);
      validateAchievementCatalog(catalog);
    } catch (error) { throw new Error(`${achievementUrl} is invalid: ${error.message}`); }
    await checkFetch(base, achievementUrl, '"achievements"', 500);
    const categoryIcons = catalog.categories.map((category) => category.icon).filter(Boolean);
    if (categoryIcons.length !== catalog.categories.length) throw new Error(`${achievementUrl} is missing released category icons`);
    if (!catalog.rewardCurrency?.icon) throw new Error(`${achievementUrl} is missing its reward currency icon`);
    for (const icon of [...categoryIcons, catalog.rewardCurrency.icon]) {
      const entry = entriesByUrl.get(icon.path);
      if (!entry) throw new Error(`${achievementUrl} icon is absent from the runtime manifest: ${icon.path}`);
      await checkBinaryFetch(base, icon.path, entry);
    }
    const indexUrl = `/data/library/${game}/index.json`;
    const searchUrl = `/data/library/${game}/search-index.json`;
    if (!urls.has(indexUrl)) throw new Error(`runtime manifest is missing ${indexUrl}`);
    if (!urls.has(searchUrl)) throw new Error(`runtime manifest is missing ${searchUrl}`);
    const index = JSON.parse(await readDeployText(indexUrl.slice(1)));
    const search = JSON.parse(await readDeployText(searchUrl.slice(1)));
    if (!Array.isArray(index.entries) || index.entries.length !== index.count || !index.entries.length) throw new Error(`${indexUrl} is empty or invalid`);
    const expectedVolumeCount = index.entries.reduce((sum, row) => sum + Number(row.volumeCount || 0), 0);
    if (search?.schemaVersion !== 2 || search.game !== game || search.bookCount !== index.count || !Array.isArray(search.books)
      || search.books.length !== index.count || !Array.isArray(search.volumes) || search.volumeCount !== expectedVolumeCount
      || search.volumes.length !== expectedVolumeCount) throw new Error(`${searchUrl} is invalid`);
    for (const row of index.entries) {
      if (!urls.has(`/data/library/${game}/${row.file}`)) throw new Error(`${indexUrl} book is absent from manifest: ${row.file}`);
      if (row.icon && !urls.has(`/data/library/${game}/${row.icon}`)) throw new Error(`${indexUrl} icon is absent from manifest: ${row.icon}`);
      const book = JSON.parse(await readDeployText(`data/library/${game}/${row.file}`));
      if (book?.schemaVersion !== 1 || book.game !== game || book.id !== row.id || book.name !== row.name || !Array.isArray(book.volumes) || book.volumes.length !== row.volumeCount) throw new Error(`${row.file} identity/volume data does not match ${indexUrl}`);
      if (!Array.isArray(row.volumeLabels) || row.volumeLabels.length !== book.volumes.length || !Array.isArray(row.volumeKeys) || row.volumeKeys.length !== book.volumes.length) throw new Error(`${row.file} volume metadata does not match ${indexUrl}`);
      for (let volumeIndex = 0; volumeIndex < book.volumes.length; volumeIndex += 1) {
        const volume = book.volumes[volumeIndex];
        if (volume?.label !== row.volumeLabels[volumeIndex] || volume?.volumeKey !== row.volumeKeys[volumeIndex] || volume?.document?.version !== 1 || !Array.isArray(volume.document.blocks)) throw new Error(`${row.file} volume ${volumeIndex + 1} is invalid`);
        for (const block of volume.document.blocks) {
          if (!['heading','paragraph','list','table','image'].includes(block?.type)) throw new Error(`${row.file} has a disallowed structured block`);
          if (block.type === 'heading' && !/^h-[a-f0-9]{16}(?:-(?:[2-9]|[1-9][0-9]+))?$/.test(block.id || '')) throw new Error(`${row.file} has an invalid heading id`);
          if (block.type === 'paragraph' && !/^p-[a-f0-9]{16}(?:-(?:[2-9]|[1-9][0-9]+))?$/.test(block.id || '')) throw new Error(`${row.file} has an invalid paragraph id`);
          if (block.type === 'list' && block.items.some((item) => !/^li-[a-f0-9]{16}(?:-(?:[2-9]|[1-9][0-9]+))?$/.test(item.id || ''))) throw new Error(`${row.file} has an invalid list item id`);
          if (block.type === 'table' && block.rows.some((row) => row.cells.some((cell) => !/^td-[a-f0-9]{16}(?:-(?:[2-9]|[1-9][0-9]+))?$/.test(cell.id || '')))) throw new Error(`${row.file} has an invalid table cell id`);
        }
      }
    }
    await checkFetch(base, indexUrl, '"entries"', 100);
    const fetchedSearch = JSON.parse(await fetchCheckedText(base, searchUrl, null, 100));
    if (fetchedSearch?.schemaVersion !== 2 || !Array.isArray(fetchedSearch.volumes)) {
      throw new Error(`${searchUrl} did not serve the volume-aware schema`);
    }
    await checkFetch(base, `/data/library/${game}/${index.entries[0].file}`, '"volumes"', 100);
  }
  // Genshin character stories: the Story tab fetches one file per character at
  // open time, so the route has to be live and the index has to agree with the
  // records it points at.
  {
    const indexUrl = '/data/story/gi/index.json';
    if (!urls.has(indexUrl)) throw new Error(`runtime manifest is missing ${indexUrl}`);
    const index = JSON.parse(await readDeployText(indexUrl.slice(1)));
    if (index?.schemaVersion !== 1 || index.game !== 'gi' || !Array.isArray(index.entries) || !index.entries.length
      || index.entries.length !== index.count) throw new Error(`${indexUrl} is empty or invalid`);
    for (const row of index.entries) {
      const recordUrl = `/data/story/gi/${row.key}.json`;
      if (!urls.has(recordUrl)) throw new Error(`${indexUrl} record is absent from manifest: ${row.key}`);
      const record = JSON.parse(await readDeployText(recordUrl.slice(1)));
      if (record?.schemaVersion !== 1 || record.game !== 'gi' || record.id !== row.id || record.name !== row.name
        || !Array.isArray(record.stories) || !Array.isArray(record.quotes) || !Array.isArray(record.va)
        || record.stories.length !== row.stories || record.quotes.length !== row.quotes) throw new Error(`${recordUrl} does not match ${indexUrl}`);
    }
    await checkFetch(base, indexUrl, '"entries"', 100);
    await checkFetch(base, `/data/story/gi/${index.entries[0].key}.json`, '"quotes"', 100);
  }
  for (const game of ['gi','hsr','zzz','wuwa','ae']) {
    const url = `/data/banner-history/${game}.json`;
    if (!urls.has(url)) throw new Error(`runtime manifest is missing ${url}`);
    const history = JSON.parse(await readDeployText(url.slice(1)));
    if (history?.schemaVersion !== 1 || history.game !== game || !Array.isArray(history.records) || !history.records.length) throw new Error(`${url} is empty or invalid`);
    await checkFetch(base, url, '"records"', 100);
  }
  for (const game of ['gi','hsr','zzz','wuwa']) {
    const url = `/data/activities/${game}.json`;
    if (!urls.has(url)) throw new Error(`runtime manifest is missing ${url}`);
    const activities = JSON.parse(await readDeployText(url.slice(1)));
    const minimum = { gi:2, hsr:3, zzz:2, wuwa:1 }[game];
    if (activities?.schemaVersion !== 1 || activities.game !== game || !Array.isArray(activities.activities) || activities.activities.length < minimum) throw new Error(`${url} is invalid`);
    await checkFetch(base, url, '"activities"', 80);
  }
  // Events (Workstream N). Endfield's backend game key is 'endfield', not
  // the client key 'ae' — same filename map as timeline-view.jsx.
  for (const game of ['gi','hsr','zzz','wuwa','ae']) {
    const file = game === 'ae' ? 'endfield' : game;
    const url = `/data/events/${file}.json`;
    if (!urls.has(url)) throw new Error(`runtime manifest is missing ${url}`);
    const events = JSON.parse(await readDeployText(url.slice(1)));
    if (events?.schemaVersion !== 1 || events.game !== file || !Array.isArray(events.events)) throw new Error(`${url} is invalid`);
    await checkFetch(base, url, '"events"', 80);
  }
  return manifest.files.length;
}

async function fetchCheckedText(base, route, contains, minBytes = 500) {
  const res = await fetch(base + route);
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${route} returned ${res.status}`);
  if (text.length < minBytes) throw new Error(`${route} returned suspiciously small body (${text.length} bytes)`);
  if (contains && !text.includes(contains)) throw new Error(`${route} is missing expected text: ${contains}`);
  return text;
}

async function checkFetch(base, route, contains, minBytes = 500) {
  return (await fetchCheckedText(base, route, contains, minBytes)).length;
}

async function checkBinaryFetch(base, route, expected) {
  const res = await fetch(base + route);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (res.status !== 200) throw new Error(`${route} returned ${res.status}`);
  if (bytes.length !== expected.size) throw new Error(`${route} returned the wrong byte count`);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (hash !== expected.sha256) throw new Error(`${route} returned the wrong content hash`);
  inspectAchievementIconBytes(bytes);
  return bytes.length;
}

function collectLauncherAssets(manifest) {
  const assets = [];
  for (const game of Object.values(manifest?.games ?? {})) {
    const current = game?.current;
    assets.push(
      ...(current?.variants ?? []),
      ...(current?.characters ?? []).map((character) => character.icon).filter(Boolean),
      ...(current?.characters ?? []).flatMap((character) => character.variants ?? []),
      ...(game?.upcoming ?? []).flatMap((phase) => phase.characters ?? []).map((character) => character.icon).filter(Boolean),
    );
  }
  return assets;
}

async function verifyLauncherBanners(base) {
  const manifestFile = path.resolve(deployDir, 'dist', 'launcher-banners-v1.json');
  const manifestBytes = await fs.readFile(manifestFile);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const launcherCodes = JSON.parse(await readDeployText('dist/launcher-codes-v1.json'));
  const generatedAt = Date.parse(manifest.generatedAt ?? '');
  if (!Number.isFinite(generatedAt) || generatedAt > Date.now() + 60_000) throw new Error('launcher manifest generatedAt is invalid or in the future');
  // Deploy the immutable committed snapshot only while it is fresh and all
  // advertised current windows are still active at the real wall clock.
  validatePackagedManifest(manifest, { now: Date.now() });

  const expected = buildManifest({
    ...loadManifestInputs({ now: generatedAt }),
    now: generatedAt,
    generatedAt: manifest.generatedAt,
  });
  for (const game of ['gi', 'hsr', 'zzz', 'wuwa', 'ae']) {
    if (JSON.stringify(manifest.games[game].codes) !== JSON.stringify(launcherCodes.games?.[game])) throw new Error(`${game} embedded launcher codes differ from the standalone feed`);
    const actualIdentity = {
      selected: manifest.games[game].current.selectedCharacter.name,
      current: manifest.games[game].current.characters.map((character) => character.name),
      upcoming: manifest.games[game].upcoming.map((phase) => ({ start: phase.start, characters: phase.characters.map((character) => character.name) })),
    };
    const expectedIdentity = {
      selected: expected.games[game].current?.selectedCharacter?.name,
      current: expected.games[game].current?.characters?.map((character) => character.name),
      upcoming: expected.games[game].upcoming.map((phase) => ({ start: phase.start, characters: phase.characters.map((character) => character.name) })),
    };
    if (JSON.stringify(actualIdentity) !== JSON.stringify(expectedIdentity)) throw new Error(`${game} launcher selection does not match trusted source data`);
  }

  const assets = collectLauncherAssets(manifest);
  const unique = new Map();
  for (const asset of assets) {
    const existing = unique.get(asset.sha256);
    const metadata = JSON.stringify({ path: asset.path, url: asset.url, mime: asset.mime, size: asset.size, dimensions: asset.dimensions });
    if (existing && existing.metadata !== metadata) throw new Error(`launcher asset ${asset.sha256} has conflicting metadata`);
    unique.set(asset.sha256, { asset, metadata });
  }
  const artDir = path.resolve(deployDir, 'dist', 'launcher-art');
  const entries = await fs.readdir(artDir, { withFileTypes: true });
  const actualFiles = entries.map((entry) => entry.name).sort();
  if (entries.some((entry) => !entry.isFile() || !/^[a-f0-9]{64}\.webp$/.test(entry.name))) throw new Error('launcher-art contains a non-content-addressed entry');
  const expectedFiles = [...unique.keys()].map((sha) => `${sha}.webp`).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) throw new Error('launcher-art contains missing or unreferenced files');

  let artBytes = 0;
  for (const [sha, { asset }] of unique) {
    const expectedPath = `/launcher-art/${sha}.webp`;
    if (asset.path !== expectedPath || asset.url !== `https://pengo.gg/dist${expectedPath}` || asset.mime !== 'image/webp') throw new Error(`launcher asset ${sha} has an unsafe path or MIME`);
    const file = path.resolve(artDir, `${sha}.webp`);
    if (!file.startsWith(`${artDir}${path.sep}`)) throw new Error(`launcher asset ${sha} escaped launcher-art`);
    const bytes = await fs.readFile(file);
    if (bytes.length !== asset.size) throw new Error(`launcher asset ${sha} has the wrong size`);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== sha) throw new Error(`launcher asset ${sha} has the wrong hash`);
    if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') throw new Error(`launcher asset ${sha} is not WebP`);
    artBytes += bytes.length;
  }

  const manifestResponse = await fetch(`${base}/dist/launcher-banners-v1.json`);
  const fetchedManifest = Buffer.from(await manifestResponse.arrayBuffer());
  if (manifestResponse.status !== 200 || !String(manifestResponse.headers.get('content-type')).startsWith('application/json')) throw new Error('launcher manifest HTTP probe failed');
  if (!fetchedManifest.equals(manifestBytes)) throw new Error('launcher manifest HTTP bytes differ from deploy artifact');
  const first = unique.values().next().value?.asset;
  if (!first) throw new Error('launcher manifest references no art');
  const assetResponse = await fetch(`${base}/dist${first.path}`);
  const fetchedAsset = Buffer.from(await assetResponse.arrayBuffer());
  if (assetResponse.status !== 200 || assetResponse.headers.get('content-type') !== 'image/webp') throw new Error('launcher art HTTP probe failed');
  if (fetchedAsset.length !== first.size || crypto.createHash('sha256').update(fetchedAsset).digest('hex') !== first.sha256) throw new Error('launcher art HTTP bytes differ from manifest');

  return {
    manifestBytes: manifestBytes.length,
    manifestSha256: crypto.createHash('sha256').update(manifestBytes).digest('hex'),
    revision: manifest.revision,
    occurrences: assets.length,
    uniqueAssets: unique.size,
    artBytes,
    selections: Object.fromEntries(Object.entries(manifest.games).map(([game, entry]) => [game, entry.current.selectedCharacter.name])),
  };
}

async function verifyLauncherTools(base) {
  const file = path.resolve(deployDir, 'dist', 'launcher-tools-v1.json');
  const bytes = await fs.readFile(file);
  const feed = JSON.parse(bytes.toString('utf8'));
  validateLauncherTools(feed);

  const response = await fetch(`${base}/dist/launcher-tools-v1.json`);
  const fetched = Buffer.from(await response.arrayBuffer());
  if (response.status !== 200 || !String(response.headers.get('content-type')).startsWith('application/json')) throw new Error('launcher tools HTTP probe failed');
  if (!fetched.equals(bytes)) throw new Error('launcher tools HTTP bytes differ from deploy artifact');
  return {
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    rows: feed.tools.length,
  };
}

async function main() {
  if (!(await exists(deployDir))) throw new Error(`Missing deploy directory: ${deployDir}`);

  const server = createServer();
  const base = await listen(server);
  const results = [];
  let launcherBanners;
  let launcherTools;
  try {
    for (const [route, marker, minBytes] of [
      ['/', 'Pengo'],
      ['/nyx', 'Nyx'],
      ['/genshin', 'Genshin Impact'],
      ['/hsr', 'Honkai: Star Rail'],
      ['/zzz', 'Zenless Zone Zero'],
      ['/wuwa', 'Wuthering Waves'],
      ['/endfield', 'Arknights: Endfield'],
      ['/endfield/tracker', 'Arknights: Endfield'],
      ['/nyx/codes', 'Nyx'],
      ['/genshin/materials', 'Genshin Impact'],
      ['/genshin/database', 'Genshin Impact'],
      ['/genshin/database/tcg', 'Genshin Impact'],
      ['/genshin/database/serenitea-pot', 'Genshin Impact'],
      ['/genshin/database/wonderland', 'Genshin Impact'],
      ['/genshin/achievements', 'Genshin Impact'],
      ['/hsr/achievements', 'Honkai: Star Rail'],
      ['/genshin/books', 'Genshin Impact'],
      ['/hsr/books', 'Honkai: Star Rail'],
      ['/genshin/serenitea-pot', 'Genshin Impact'],
      ['/genshin/characters/skirk', 'Genshin Impact'],
      ['/hsr/characters/castorice', 'Honkai: Star Rail'],
      ['/sitemap.xml', '<urlset'],
      ['/version.json', '"app": "pengo-nyx"', 50],
      ['/dist/launcher-codes-v1.json', '"schemaVersion": 1', 100],
      ['/dist/launcher-banners-v1.json', '"schemaVersion": 1', 1_000],
      ['/dist/launcher-tools-v1.json', '"schemaVersion": 1', 100],
      ['/scripts/pengo-achievements.ps1', 'Pengo Nyx - offline achievement screenshot reader', 50_000],
      ['/scripts/pengo-hsr-hoyolab-achievements.js', 'Pengo HSR achievement export', 20_000],
    ]) {
      results.push(`${route} ${await checkFetch(base, route, marker, minBytes)} bytes`);
    }
    launcherBanners = await verifyLauncherBanners(base);
    launcherTools = await verifyLauncherTools(base);
    results.push(`runtime data ${await verifyRuntimeData(base)} files`);
  } finally {
    await close(server);
  }

  const script = await fs.readFile(path.resolve(deployDir, 'scripts', 'pengo-pulls.ps1'));
  const scriptText = script.toString('utf8');
  const scriptHash = crypto.createHash('sha256').update(script).digest('hex');
  const achievementScript = await fs.readFile(path.resolve(deployDir, 'scripts', 'pengo-achievements.ps1'));
  const achievementScriptText = achievementScript.toString('utf8');
  const achievementScriptHash = crypto.createHash('sha256').update(achievementScript).digest('hex');
  const hsrAchievementScript = await fs.readFile(path.resolve(deployDir, 'scripts', 'pengo-hsr-hoyolab-achievements.js'));
  const hsrAchievementScriptText = hsrAchievementScript.toString('utf8');
  const hsrAchievementScriptHash = crypto.createHash('sha256').update(hsrAchievementScript).digest('hex');
  const bundle = await readDeployText('dist/game-page.bundle.js');
  const headers = await readDeployText('_headers');
  const indexHtml = await readDeployText('index.html');
  const version = JSON.parse(await readDeployText('version.json'));
  const gamePages = ['genshin.html', 'hsr.html', 'zzz.html', 'wuwa.html', 'endfield.html', 'nyx.html'];
  const deployPages = { 'index.html': indexHtml };

  if (!scriptText.includes('Pengo Nyx')) throw new Error('pengo-pulls.ps1 is missing Pengo branding');
  if (scriptText.includes('asyce.com/asivepulled')) throw new Error('pengo-pulls.ps1 contains old helper URL');
  if (!bundle.includes(scriptHash)) throw new Error(`bundle does not contain script SHA-256 ${scriptHash}`);
  if (!achievementScriptText.includes('Pengo Nyx - offline achievement screenshot reader')) throw new Error('pengo-achievements.ps1 is missing Pengo branding');
  if (!achievementScriptText.includes('Windows.Media.Ocr.OcrEngine')) throw new Error('pengo-achievements.ps1 is missing offline OCR');
  if (!achievementScriptText.includes('Get-CompletionDate') || !achievementScriptText.includes('Test-SameCardGeometry') || !achievementScriptText.includes('Test-WrappedTitleGeometry')) throw new Error('pengo-achievements.ps1 is missing completion date or card geometry checks');
  if (!achievementScriptText.includes('OcrEngine') || !achievementScriptText.includes('MaxImageDimension') || !achievementScriptText.includes('$ConfiguredMaxDimension = 10000')) throw new Error('pengo-achievements.ps1 is missing the bounded Windows OCR dimension limit');
  if (!achievementScriptText.includes('Only plain local paths are accepted') || !achievementScriptText.includes('DriveType]::Network')) throw new Error('pengo-achievements.ps1 is missing local-path restrictions');
  if (achievementScriptText.includes('FixtureTextPath') || achievementScriptText.includes('PENGO_ACHIEVEMENT_EXTRACTOR_TEST_MODE')) throw new Error('pengo-achievements.ps1 contains a production test backdoor');
  if (/Invoke-(?:WebRequest|RestMethod)|Start-BitsTransfer|WebClient|HttpClient|Get-Process|OpenProcess|ReadProcessMemory|WriteProcessMemory|CreateRemoteThread|SetWindowsHookEx/i.test(achievementScriptText)) throw new Error('pengo-achievements.ps1 contains a forbidden network or game-process API');
  if (!/^[a-f0-9]{64}$/.test(achievementScriptHash)) throw new Error('pengo-achievements.ps1 SHA-256 could not be calculated');
  if (!hsrAchievementScriptText.includes('Pengo HSR achievement export')) throw new Error('pengo-hsr-hoyolab-achievements.js is missing Pengo branding');
  if (!hsrAchievementScriptText.includes('https://sg-public-api.hoyolab.com/common/badge/v1/login/info') || !hsrAchievementScriptText.includes('https://sg-public-api.hoyolab.com/event/rpgcultivate/achievement/list')) throw new Error('pengo-hsr-hoyolab-achievements.js is missing the reviewed HoYoLAB endpoints');
  if (!/^[a-f0-9]{64}$/.test(hsrAchievementScriptHash)) throw new Error('pengo-hsr-hoyolab-achievements.js SHA-256 could not be calculated');
  if (!bundle.includes('achievement-page-head') || !bundle.includes('NyxAchievementImport')) throw new Error('bundle is missing the achievement tracker');
  if (!bundle.includes('Quick PowerShell command')) throw new Error('bundle missing quick import method copy');
  if (!bundle.includes('Manual CSV backfill')) throw new Error('bundle missing manual CSV import copy');
  if (!bundle.includes('Pengo encrypted sync')) throw new Error('bundle missing encrypted sync UI copy');
  if (!bundle.includes('/v2/pull-import/') || !bundle.includes('Review Endfield history before saving') || !bundle.includes('pengo-pulls-v1')) throw new Error('bundle missing the Endfield launcher pull receiver');
  if (!bundle.includes('Endfield pull history stays in this browser and cannot be synced.')) throw new Error('bundle missing the Endfield local-only sync guard');
  if (!/connect-src 'self' http:\/\/127\.0\.0\.1:\*/.test(headers) || /connect-src[^;\r\n]*localhost/.test(headers)) throw new Error('deploy headers are missing the exact Endfield loopback CSP');
  if (!bundle.includes('Monsters and Items could not be loaded.')) throw new Error('bundle missing lazy Database retry state');
  if (!bundle.includes('database/serenitea-pot')) throw new Error('bundle missing canonical nested Database routes');
  if (!bundle.includes('database/wonderland')) throw new Error('bundle missing Wonderland Database route');
  if (!bundle.includes('tcg-filter-popout')) throw new Error('bundle missing compact TCG filter popout');
  // 2026-08-09: Load more was replaced by category sections that render every
  // row and paint as they scroll into view.
  if (bundle.includes('db-load-more')) throw new Error('bundle still contains the old Load more pagination');
  if (!bundle.includes('db-group-head')) throw new Error('bundle missing grouped Database sections');
  if (!bundle.includes('db-scroll')) throw new Error('bundle missing the Database section scroller');
  if (!bundle.includes('db-rarity-toggle')) throw new Error('bundle missing the 3-star rarity toggle');
  if (bundle.includes('Showing 400 of')) throw new Error('bundle still contains the old 400-result dead end');
  if (!bundle.includes('Search Miliastra Wonderland')) throw new Error('bundle missing accessible Wonderland search');
  // The visible "Search Library" label was removed 2026-08-09; the field keeps
  // an accessible name.
  if (!bundle.includes('Search the library')) throw new Error('bundle missing Library search');
  if (!bundle.includes('Opening book')) throw new Error('bundle missing The Library lazy-reader state');
  if (!bundle.includes('Book volumes')) throw new Error('bundle missing accessible Library volume controls');
  if (bundle.includes('asyce.com/asivepulled')) throw new Error('bundle contains old helper URL');
  if (!indexHtml.includes('class="page-bg"')) throw new Error('index page missing restored background layer');
  if (!indexHtml.includes('page-pattern')) throw new Error('index page missing restored pattern background');
  if (!indexHtml.includes('page-vignette')) throw new Error('index page missing restored vignette background');
  if (indexHtml.includes('<video') || indexHtml.includes('index-bg.webm') || indexHtml.includes('index-bg-poster.webp')) throw new Error('index page still references video background assets');
  if (!indexHtml.includes("../assets/bg/backgroundnyx.png")) throw new Error('index page missing Nyx background asset');
  if (indexHtml.includes('id="cosmicBg"') || indexHtml.includes('function drawStars') || indexHtml.includes('function drawGlints')) throw new Error('index page still includes procedural cosmic background');
  await assertNotExists('assets/bg/index-bg.webm');
  await assertNotExists('assets/bg/index-bg-poster.webp');
  await assertNotExists('dist/vendor');
  const nyxPayload = await readDeployText('dist/nyx-data.js');
  const nyxContext = { window:{} };
  vm.runInNewContext(nyxPayload, nyxContext, { filename:'nyx-data.js' });
  const expectedDbMinimums = { gi:{ monsters:500, items:6000 }, hsr:{ monsters:500, items:1400 }, zzz:{ monsters:250, items:4500 }, wuwa:{ monsters:250, items:2000 } };
  let genshinItems = [];
  for (const [game, minimums] of Object.entries(expectedDbMinimums)) {
    const pack = await readDeployText(`dist/db-data-${game}.js`);
    const context = { window:{ dispatchEvent() {} }, CustomEvent:class {} };
    vm.runInNewContext(pack, context, { filename:`db-data-${game}.js` });
    const collections = context.window.NYX_DB_EXTRA?.[game]?.collections || [];
    if (game === 'gi') genshinItems = collections.find((collection) => collection.key === 'items')?.items || [];
    for (const [key, minimum] of Object.entries(minimums)) {
      const count = Number(pack.match(new RegExp(`"key": "${key}"[\\s\\S]{0,200}?"count": (\\d+)`))?.[1] || 0);
      if (count < minimum) throw new Error(`dist/db-data-${game}.js ${key} count ${count} is below safe minimum ${minimum}`);
    }
    for (const collection of collections) {
      const ids = new Set();
      for (const item of collection.items) {
        const id = String(item.id || '');
        if (!id || ids.has(id)) throw new Error(`dist/db-data-${game}.js ${collection.key} has ${id ? `duplicate id ${id}` : 'an empty id'}`);
        ids.add(id);
      }
    }
  }
  const genshin = nyxContext.window.NYX_DB?.games?.gi;
  const genshinItemPartitions = {
    items:genshinItems,
    tcg:[...(genshin?.tcg?.characterCards || []), ...(genshin?.tcg?.otherCards || [])],
    furnitureBlueprints:genshin?.furniture?.blueprints || [],
    furnitureMaterials:genshin?.furniture?.materials || [],
    wonderland:[...(genshin?.wonderland?.costumes || []), ...(genshin?.wonderland?.suits || []), ...(genshin?.wonderland?.items || [])],
    shadowRealm:genshin?.shadowRealm?.items || [],
    galleryNamecards:genshin?.gallery?.namecards || [],
    galleryPortraits:genshin?.gallery?.portraits || [],
    galleryAvatarFrames:genshin?.gallery?.avatarFrames || [],
    gallerySplashArts:genshin?.gallery?.splashArts || [],
  };
  for (const [key, minimum] of Object.entries({ tcg:600, furnitureBlueprints:1400, furnitureMaterials:50, shadowRealm:19, galleryNamecards:280, galleryPortraits:150, galleryAvatarFrames:10, gallerySplashArts:100 })) {
    if (genshinItemPartitions[key].length < minimum) throw new Error(`Genshin ${key} count is below safe minimum ${minimum}`);
  }
  const genshinItemIds = new Set(Object.values(genshinItemPartitions).flat().map((item) => String(item.id || '').replace(/^gi-(?:item|shadow-(?:weapon|accessory))-/, '')).filter(Boolean));
  if (genshinItemIds.size < 9000) throw new Error(`Genshin partitioned Database coverage ${genshinItemIds.size} is below safe minimum 9000`);
  const launcherCodes = JSON.parse(await readDeployText('dist/launcher-codes-v1.json'));
  const endfieldLauncherCode = launcherCodes?.games?.ae?.find((entry) => entry.code === 'ENDFIELDGIFT');
  if (endfieldLauncherCode?.amount !== 150 || endfieldLauncherCode?.currency !== 'Oroberyl') {
    throw new Error('launcher code feed is missing the reviewed Endfield Oroberyl reward');
  }
  const oroberylSourcePath = 'Database/EndfieldWiki/endfield/material-icons/Oroberyl.png';
  const oroberylDeployPath = path.resolve(deployDir, ...oroberylSourcePath.split('/'));
  if (databaseAssetMode === 'r2-only') {
    if (await exists(oroberylDeployPath)) {
      throw new Error('R2-only deploy unexpectedly contains the Endfield Oroberyl icon');
    }
    const oroberylEntry = await buildDatabaseAssetEntry(
      oroberylSourcePath,
      await fs.readFile(path.resolve(root, ...oroberylSourcePath.split('/'))),
    );
    if (!nyxPayload.includes(oroberylEntry.publicUrl)) {
      throw new Error('R2-only deploy is missing the rewritten Endfield Oroberyl icon URL');
    }
  } else if (!(await exists(oroberylDeployPath))) {
    throw new Error('deploy is missing the Endfield Oroberyl icon');
  }
  const wonderland = nyxContext.window.NYX_DB?.games?.gi?.wonderland;
  for (const [key, minimum] of Object.entries({ costumes:500, suits:150, items:1200 })) {
    const rows = wonderland?.[key];
    if (!Array.isArray(rows) || rows.length < minimum) throw new Error(`Wonderland ${key} count is below safe minimum ${minimum}`);
    const ids = rows.map((row) => String(row.id || ''));
    if (ids.some((id) => !id) || new Set(ids).size !== rows.length) throw new Error(`Wonderland ${key} has empty or duplicate ids`);
  }
  if (!wonderland?.version || !wonderland?.langMap?.slot || !wonderland?.langMap?.color) throw new Error('Wonderland version or lang_map filters are missing');
  const deployFileCount = await countFiles(deployDir);
  if (deployFileCount > CLOUDFLARE_ASSET_FILE_LIMIT) {
    throw new Error(`deploy has ${deployFileCount} files, above Cloudflare's ${CLOUDFLARE_ASSET_FILE_LIMIT}-file asset limit`);
  }
  for (const page of gamePages) {
    const html = await readDeployText(page);
    deployPages[page] = html;
    if (!html.includes('<base href="/"/>')) throw new Error(`${page} missing root base href for nested routes`);
    if (html.includes('dist/vendor/react')) throw new Error(`${page} still references old React vendor scripts`);
  }
  if (!version.commit || !version.shortCommit) throw new Error('version.json is missing commit metadata');
  const headCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assertDeployCommitIdentity({ head: headCommit, version, pages: deployPages });

  console.log('Deploy smoke passed:');
  for (const line of results) console.log('  ' + line);
  console.log(`  script sha256 ${scriptHash}`);
  console.log(`  achievement script sha256 ${achievementScriptHash}`);
  console.log(`  HSR HoYoLAB script sha256 ${hsrAchievementScriptHash}`);
  console.log(`  launcher manifest ${launcherBanners.manifestBytes} bytes sha256 ${launcherBanners.manifestSha256} revision ${launcherBanners.revision}`);
  console.log(`  launcher art ${launcherBanners.uniqueAssets} unique/${launcherBanners.occurrences} occurrences ${launcherBanners.artBytes} bytes`);
  console.log(`  launcher selections ${JSON.stringify(launcherBanners.selections)}`);
  console.log(`  launcher tools ${launcherTools.rows} rows ${launcherTools.bytes} bytes sha256 ${launcherTools.sha256}`);
  console.log(`  commit ${version.shortCommit}`);
  console.log(`  deploy files ${deployFileCount}/${CLOUDFLARE_ASSET_FILE_LIMIT}`);
}

main().catch((error) => {
  console.error('Deploy smoke failed:');
  console.error(error && error.stack || error);
  process.exit(1);
});
