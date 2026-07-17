import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACHIEVEMENT_ICON_MAX_BYTES, achievementIconFilename, inspectAchievementIconBytes, validateCatalog as validateAchievementCatalog } from '../../Scraper/achievements/core.mjs';
import { nyxLibraryNormalizeText } from '../src/features/library/library-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const FAMILY_CONFIG = [
  { source:'BannerHistory', target:'banner-history', optional:false },
  { source:'Activities', target:'activities', optional:false },
  { source:'Events', target:'events', optional:true },
];
const EVENT_GAMES = ['gi','hsr','zzz','wuwa','endfield'];

async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }

async function filesBelow(dir) {
  const files = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes:true })) {
      const next = path.resolve(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Runtime publisher refuses symlink: ${next}`);
      if (entry.isDirectory()) await walk(next);
      else files.push(next);
    }
  }
  await walk(dir);
  return files;
}

function relativeInside(root, file) {
  const relative = path.relative(root, file).replace(/\\/g, '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative) || relative.split('/').includes('..')) throw new Error(`Runtime publisher path traversal: ${file}`);
  return relative;
}

function dataTimestamp(parsed, stat) {
  const candidate = parsed?.dataTimestamp || parsed?.generatedAt || parsed?.scrapedAt || parsed?.updatedAt || parsed?.lastUpdated;
  const date = candidate ? new Date(candidate) : stat.mtime;
  if (!Number.isFinite(date.getTime())) throw new Error('Runtime JSON has an invalid data timestamp');
  return date.toISOString();
}

async function validatedJson(file, maxBytes) {
  const stat = await fs.stat(file);
  if (stat.size > maxBytes) throw new Error(`Runtime file exceeds ${maxBytes} byte ceiling: ${file}`);
  let parsed;
  try { parsed = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { throw new Error(`Invalid runtime JSON ${file}: ${error.message}`); }
  if (parsed === null || typeof parsed !== 'object') throw new Error(`Runtime JSON must contain an object or array: ${file}`);
  return { stat, parsed };
}

function validateInline(nodes, label) {
  if (!Array.isArray(nodes)) throw new Error(`${label} inline content is not an array`);
  for (const node of nodes) {
    if (!node || !['text','em','strong','br'].includes(node.type)) throw new Error(`${label} has a disallowed inline node`);
    const keys = Object.keys(node).sort().join(',');
    if (node.type === 'br' ? keys !== 'type' : node.type === 'text' ? keys !== 'text,type' : keys !== 'children,type') throw new Error(`${label} has unexpected inline attributes`);
    if (node.type === 'text' && typeof node.text !== 'string') throw new Error(`${label} has invalid text`);
    if (node.type === 'em' || node.type === 'strong') validateInline(node.children, label);
  }
}

function validateLeafId(value, prefix, label) {
  if (!new RegExp(`^${prefix}-[a-f0-9]{16}(?:-(?:[2-9]|[1-9][0-9]+))?$`).test(value || '')) throw new Error(`${label} has an invalid stable leaf id`);
}

function validateDocument(document, label) {
  if (document?.version !== 1 || !Array.isArray(document.blocks)) throw new Error(`${label} has an invalid structured document`);
  for (const block of document.blocks) {
    if (!block || !['heading','paragraph','list','table','image'].includes(block.type)) throw new Error(`${label} has a disallowed block`);
    if (block.type === 'heading') {
      if (typeof block.text !== 'string' || ![2,3,4].includes(block.level)) throw new Error(`${label} has an invalid heading`);
      validateLeafId(block.id, 'h', label);
      if (Object.keys(block).sort().join(',') !== 'id,level,text,type') throw new Error(`${label} heading has unexpected attributes`);
    }
    if (block.type === 'paragraph') {
      validateLeafId(block.id, 'p', label);
      if (Object.keys(block).sort().join(',') !== 'children,id,type') throw new Error(`${label} paragraph has unexpected attributes`);
      validateInline(block.children, label);
    }
    if (block.type === 'list') {
      if (typeof block.ordered !== 'boolean' || !Array.isArray(block.items)) throw new Error(`${label} has an invalid list`);
      for (const item of block.items) {
        validateLeafId(item.id, 'li', label);
        if (Object.keys(item).sort().join(',') !== 'children,id') throw new Error(`${label} list item has unexpected attributes`);
        validateInline(item.children, label);
      }
    }
    if (block.type === 'table') {
      if (!Array.isArray(block.rows)) throw new Error(`${label} has an invalid table`);
      for (const row of block.rows) {
        if (!Array.isArray(row.cells)) throw new Error(`${label} has an invalid table row`);
        for (const cell of row.cells) {
          validateLeafId(cell.id, 'td', label);
          if (Object.keys(cell).sort().join(',') !== 'children,id') throw new Error(`${label} table cell has unexpected attributes`);
          validateInline(cell.children, label);
        }
      }
    }
    if (block.type === 'image' && (!/^icons\/[a-f0-9]{64}\.(?:png|webp)$/.test(block.src || '') || typeof block.alt !== 'string')) throw new Error(`${label} has an unsafe image`);
  }
}

function validateBook(book, row, game, label) {
  if (book?.schemaVersion !== 1 || book.game !== game || book.id !== row.id || typeof book.name !== 'string' || !book.name.trim() || book.name !== row.name) throw new Error(`${label} has invalid book identity`);
  if (!Array.isArray(book.volumes) || !book.volumes.length || book.volumes.length !== row.volumeCount) throw new Error(`${label} volume count does not match its index`);
  if (!Array.isArray(row.volumeLabels) || row.volumeLabels.length !== book.volumes.length || !Array.isArray(row.volumeKeys) || row.volumeKeys.length !== book.volumes.length) throw new Error(`${label} volume metadata does not match its index`);
  book.volumes.forEach((volume, index) => {
    if (String(volume?.id || '') !== String(index + 1) || typeof volume.label !== 'string' || volume.label !== row.volumeLabels[index] || !/^[a-z0-9][a-z0-9-]*$/.test(volume.volumeKey || '') || volume.volumeKey !== row.volumeKeys[index]) throw new Error(`${label} has invalid volume metadata`);
    validateDocument(volume.document, `${label} volume ${index + 1}`);
  });
}

function validateSearchIndex(search, game, ids, volumeKeysByBook, label) {
  if (search?.schemaVersion !== 2 || search.game !== game || search.bookCount !== ids.size || !Array.isArray(search.books) || !Array.isArray(search.volumes)) throw new Error(`${label} is invalid`);
  if (search.books.length !== ids.size || search.books.some((id) => !ids.has(id)) || new Set(search.books).size !== search.books.length || search.books.join('\0') !== [...search.books].sort().join('\0')) throw new Error(`${label} has an invalid book dictionary`);
  const expected = search.books.flatMap((bookId, book) => (volumeKeysByBook.get(bookId) || []).map((volumeKey) => `${book}\0${volumeKey}`));
  if (search.volumeCount !== expected.length || search.volumes.length !== expected.length) throw new Error(`${label} has invalid volume metadata`);
  const actual = [];
  for (const volume of search.volumes) {
    if (!volume || Object.keys(volume).sort().join(',') !== 'book,leaves,volumeKey'
      || !Number.isInteger(volume.book) || volume.book < 0 || volume.book >= search.books.length
      || !/^[a-z0-9][a-z0-9-]*$/.test(volume.volumeKey || '') || !Array.isArray(volume.leaves)) {
      throw new Error(`${label} has an invalid volume row`);
    }
    actual.push(`${volume.book}\0${volume.volumeKey}`);
    for (const leaf of volume.leaves) {
      if (typeof leaf !== 'string' || !leaf || leaf.length > 250_000 || leaf !== nyxLibraryNormalizeText(leaf)) throw new Error(`${label} has invalid normalized leaf text`);
    }
  }
  if (actual.join('\u0001') !== expected.join('\u0001') || new Set(actual).size !== actual.length) throw new Error(`${label} volume rows do not match the books`);
}

async function validateIcon(file, relative) {
  const bytes = await fs.readFile(file);
  const expected = path.basename(relative).split('.')[0];
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  const webp = bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (actual !== expected || (!webp && !png)) throw new Error(`Runtime Library icon hash/magic mismatch: ${relative}`);
}

async function copyEntry({ source, dest, url, maxBytes, parsed = null, timestamp = null }) {
  const bytes = await fs.readFile(source);
  if (bytes.length > maxBytes) throw new Error(`Runtime file exceeds ${maxBytes} byte ceiling: ${source}`);
  await fs.mkdir(path.dirname(dest), { recursive:true });
  await fs.writeFile(dest, bytes);
  return {
    url,
    size:bytes.length,
    sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
    dataTimestamp:timestamp || (parsed ? dataTimestamp(parsed, await fs.stat(source)) : (await fs.stat(source)).mtime.toISOString()),
  };
}

async function publishLibrary({ databaseDir, dataDir, maxBytes }) {
  const sourceRoot = path.resolve(databaseDir, 'Library');
  if (!(await exists(sourceRoot))) throw new Error('Runtime Library source is missing');
  const all = await filesBelow(sourceRoot);
  const sourceByRel = new Map(all.map((file) => [relativeInside(sourceRoot, file), file]));
  const entries = [];
  for (const game of ['gi', 'hsr']) {
    const indexRel = `${game}/index.json`;
    const searchRel = `${game}/search-index.json`;
    if (!sourceByRel.has(indexRel)) throw new Error(`Runtime Library is missing ${indexRel}`);
    if (!sourceByRel.has(searchRel)) throw new Error(`Runtime Library is missing ${searchRel}`);
    const { parsed:index } = await validatedJson(sourceByRel.get(indexRel), maxBytes);
    if (index?.game !== game || !Array.isArray(index.entries) || index.count !== index.entries.length) throw new Error(`Runtime Library has an invalid ${indexRel}`);
    const ids = new Set();
    const volumeKeysByBook = new Map();
    for (const row of index.entries) {
      if (!row?.id || ids.has(row.id) || !/^[a-z0-9][a-z0-9-]*$/.test(row.id)) throw new Error(`${indexRel} has an empty, duplicate, or unsafe id`);
      ids.add(row.id);
      if (!/^[a-z0-9][a-z0-9-]*\.json$/.test(row.file || '') || !sourceByRel.has(`${game}/${row.file}`)) throw new Error(`${indexRel} references missing/unsafe book ${row.file}`);
      if (row.icon && (!/^icons\/[a-f0-9]{64}\.(?:png|webp)$/.test(row.icon) || !sourceByRel.has(`${game}/${row.icon}`))) throw new Error(`${indexRel} references missing/unsafe icon ${row.icon}`);
      const { parsed:book } = await validatedJson(sourceByRel.get(`${game}/${row.file}`), maxBytes);
      validateBook(book, row, game, `${game}/${row.file}`);
      volumeKeysByBook.set(row.id, [...row.volumeKeys]);
    }
    const { parsed:search } = await validatedJson(sourceByRel.get(searchRel), maxBytes);
    validateSearchIndex(search, game, ids, volumeKeysByBook, searchRel);
  }
  for (const [relative, source] of sourceByRel) {
    if (!/^(?:gi|hsr)\/(?:index|search-index|[a-z0-9][a-z0-9-]*)\.json$/.test(relative) && !/^(?:gi|hsr)\/icons\/[a-f0-9]{64}\.(?:png|webp)$/.test(relative)) {
      throw new Error(`Runtime Library contains a non-allowlisted file: ${relative}`);
    }
    const url = `/data/library/${relative}`;
    const dest = path.resolve(dataDir, 'library', ...relative.split('/'));
    if (relative.endsWith('.json')) {
      const { stat, parsed } = await validatedJson(source, maxBytes);
      entries.push(await copyEntry({ source, dest, url, maxBytes, parsed, timestamp:dataTimestamp(parsed, stat) }));
    } else {
      await validateIcon(source, relative);
      entries.push(await copyEntry({ source, dest, url, maxBytes }));
    }
  }
  return entries;
}

async function validateAchievementAsset(file, filename, maxBytes) {
  const bytes = await fs.readFile(file);
  const inspected = inspectAchievementIconBytes(bytes, { maxBytes:Math.min(maxBytes, ACHIEVEMENT_ICON_MAX_BYTES) });
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const extension = inspected.mediaType === 'image/png' ? 'png' : 'webp';
  if (filename !== `${hash}.${extension}`) throw new Error(`Runtime Achievement icon hash/magic mismatch: ${filename}`);
}

async function publishAchievements({ databaseDir, dataDir, deployDir, maxBytes }) {
  const sourceRoot = path.resolve(databaseDir, 'Achievements');
  if (!(await exists(sourceRoot))) throw new Error('Runtime Achievement source is missing');
  const entries = [];
  for (const game of ['gi', 'hsr']) {
    const source = path.resolve(sourceRoot, game, 'catalog.json');
    if (!(await exists(source))) throw new Error(`Runtime Achievements is missing ${game}/catalog.json`);
    const { stat, parsed } = await validatedJson(source, maxBytes);
    try {
      if (parsed?.game !== game) throw new Error(`catalog game ${parsed?.game} does not match ${game}`);
      validateAchievementCatalog(parsed);
    } catch (error) {
      throw new Error(`Runtime Achievements has an invalid ${game} catalog: ${error.message}`);
    }
    entries.push(await copyEntry({ source, dest:path.resolve(dataDir, 'achievements', game, 'catalog.json'), url:`/data/achievements/${game}/catalog.json`, maxBytes, parsed, timestamp:dataTimestamp(parsed, stat) }));

    const references = parsed.categories.flatMap((category) => category.icon ? [{ icon:category.icon, kind:'categories' }] : []);
    if (parsed.rewardCurrency?.icon) references.push({ icon:parsed.rewardCurrency.icon, kind:'rewards' });
    const expected = new Map();
    for (const { icon, kind } of references) {
      const filename = achievementIconFilename(game, icon.path, kind);
      const relative = `${kind}/${filename}`;
      if (expected.has(relative)) throw new Error(`Runtime Achievements has duplicate ${game} asset ${relative}`);
      expected.set(relative, { filename, url:icon.path });
    }
    const assetRoot = path.resolve(sourceRoot, game, 'assets');
    const actual = await exists(assetRoot) ? await filesBelow(assetRoot) : [];
    const actualByRelative = new Map(actual.map((file) => [relativeInside(assetRoot, file), file]));
    for (const relative of actualByRelative.keys()) {
      if (!/^(?:categories|rewards)\/[a-f0-9]{64}\.(?:png|webp)$/.test(relative) || !expected.has(relative)) throw new Error(`Runtime Achievements contains an unreferenced or unsafe ${game} asset: ${relative}`);
    }
    if (actualByRelative.size !== expected.size) throw new Error(`Runtime Achievements is missing a referenced ${game} asset`);
    for (const [relative, { filename, url }] of expected) {
      const assetSource = actualByRelative.get(relative);
      if (!assetSource) throw new Error(`Runtime Achievements is missing ${game}/${relative}`);
      await validateAchievementAsset(assetSource, filename, maxBytes);
      entries.push(await copyEntry({
        source: assetSource,
        dest: path.resolve(deployDir, 'assets', 'achievements', game, ...relative.split('/')),
        url,
        maxBytes: Math.min(maxBytes, ACHIEVEMENT_ICON_MAX_BYTES),
      }));
    }
  }
  return entries;
}

async function publishFamily({ databaseDir, dataDir, source, target, optional, maxBytes }) {
  const sourceRoot = path.resolve(databaseDir, source);
  if (!(await exists(sourceRoot))) {
    if (optional) return [];
    throw new Error(`Runtime source is missing: ${source}`);
  }
  const entries = [];
  const files = await filesBelow(sourceRoot);
  const names = new Set(files.map((file) => relativeInside(sourceRoot, file)));
  if (source === 'BannerHistory') for (const required of ['gi.json','hsr.json','zzz.json','wuwa.json','ae.json','manifest.json']) if (!names.has(required)) throw new Error(`Runtime BannerHistory is missing ${required}`);
  if (source === 'Activities') for (const required of ['gi.json','hsr.json','zzz.json','wuwa.json']) if (!names.has(required)) throw new Error(`Runtime Activities is missing ${required}`);
  // Events (Workstream N): the backend pipeline's own game key for Endfield
  // is 'endfield' (unlike BannerHistory/Activities' 'ae'), so its filename
  // differs from the client game-key convention — consumed as-is, per the
  // client's own game-key -> filename map (timeline-view.jsx).
  if (source === 'Events') for (const required of [...EVENT_GAMES.map((game) => `${game}.json`), 'manifest.json', 'history-state.json']) if (!names.has(required)) throw new Error(`Runtime Events is missing ${required}`);
  for (const file of files) {
    const relative = relativeInside(sourceRoot, file);
    if (!/^[a-z0-9][a-z0-9._-]*\.json$/i.test(relative) || relative.includes('/')) throw new Error(`Runtime ${source} contains a non-allowlisted file: ${relative}`);
    const { stat, parsed } = await validatedJson(file, maxBytes);
    if (source === 'BannerHistory' && relative !== 'manifest.json' && (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.records) || !parsed.records.length)) throw new Error(`Runtime BannerHistory has invalid ${relative}`);
    if (source === 'Activities') {
      const minimum = { 'gi.json':2, 'hsr.json':3, 'zzz.json':2, 'wuwa.json':1 }[relative] || 0;
      if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.activities) || parsed.activities.length < minimum) throw new Error(`Runtime Activities has invalid ${relative}`);
    }
    if (source === 'Events') {
      if (EVENT_GAMES.includes(relative.replace(/\.json$/, ''))) {
        if (parsed?.schemaVersion !== 1 || parsed.game !== relative.replace(/\.json$/, '') || !Array.isArray(parsed.events)) throw new Error(`Runtime Events has invalid ${relative}`);
      } else if (relative === 'manifest.json') {
        const games = Array.isArray(parsed?.games) ? parsed.games : [];
        const gameKeys = games.map((row) => row?.game);
        if (parsed?.schemaVersion !== 1 || !Number.isFinite(Date.parse(parsed?.generatedAt)) || games.length !== EVENT_GAMES.length || new Set(gameKeys).size !== EVENT_GAMES.length || EVENT_GAMES.some((game) => !gameKeys.includes(game)) || games.some((row) => !['complete-for-source','partial','stale'].includes(row?.status) || !row?.source?.name || !row?.source?.endpoint)) throw new Error('Runtime Events has invalid manifest.json');
      } else if (relative === 'history-state.json') {
        const keys = Object.keys(parsed?.games || {}).sort();
        const invalid = parsed?.schemaVersion !== 1 || keys.join(',') !== [...EVENT_GAMES].sort().join(',') || EVENT_GAMES.some((game) => {
          const row = parsed?.games?.[game];
          return !row || !Array.isArray(row.completedIds) || row.completedIds.some((id) => typeof id !== 'string' || !id.trim()) || (row.resumeCursor !== null && typeof row.resumeCursor !== 'string') || typeof row.exhausted !== 'boolean' || (row.updatedAt !== null && !Number.isFinite(Date.parse(row.updatedAt)));
        });
        if (invalid) throw new Error('Runtime Events has invalid history-state.json');
      }
    }
    entries.push(await copyEntry({ source:file, dest:path.resolve(dataDir, target, relative), url:`/data/${target}/${relative}`, maxBytes, parsed, timestamp:dataTimestamp(parsed, stat) }));
  }
  return entries;
}

export async function publishRuntimeData({ rootDir = DEFAULT_ROOT, deployDir = path.resolve(rootDir, '.deploy', 'pengo'), maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const databaseDir = path.resolve(rootDir, 'Database');
  const dataDir = path.resolve(deployDir, 'data');
  const achievementAssetsDir = path.resolve(deployDir, 'assets', 'achievements');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) throw new Error('Invalid runtime publisher size ceiling');
  await fs.rm(dataDir, { recursive:true, force:true });
  await fs.rm(achievementAssetsDir, { recursive:true, force:true });
  await fs.mkdir(dataDir, { recursive:true });
  try {
    const files = await publishLibrary({ databaseDir, dataDir, maxBytes });
    files.push(...await publishAchievements({ databaseDir, dataDir, deployDir, maxBytes }));
    for (const family of FAMILY_CONFIG) files.push(...await publishFamily({ databaseDir, dataDir, maxBytes, ...family }));
    files.sort((a, b) => a.url.localeCompare(b.url));
    const manifest = { schemaVersion:1, generatedAt:new Date().toISOString(), files };
    await fs.writeFile(path.resolve(dataDir, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return manifest;
  } catch (error) {
    await fs.rm(dataDir, { recursive:true, force:true });
    await fs.rm(achievementAssetsDir, { recursive:true, force:true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishRuntimeData().then((manifest) => console.log(`Published ${manifest.files.length} runtime data files`)).catch((error) => { console.error(error?.stack || error); process.exit(1); });
}
