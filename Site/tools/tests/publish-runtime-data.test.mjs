import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { publishRuntimeData } from '../publish-runtime-data.mjs';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function achievementPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(32, 0); header.writeUInt32BE(32, 4);
  header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(32 * (1 + 32 * 4));
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nyx-runtime-'));
  for (const game of ['gi','hsr']) {
    const dir = path.join(root, 'Database', 'Library', game);
    await fs.mkdir(path.join(dir, 'icons'), { recursive:true });
    const bytes = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32, game)]);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    await fs.writeFile(path.join(dir, 'icons', `${hash}.webp`), bytes);
    await fs.writeFile(path.join(dir, 'book.json'), JSON.stringify({ schemaVersion:1, game, id:'book', name:'Book', generatedAt:'2026-07-11T00:00:00Z', volumes:[{ id:'1', volumeKey:'text', label:'Text', document:{ version:1, blocks:[{ id:'p-0123456789abcdef', type:'paragraph', children:[{ type:'text', text:'Tanuki tale' }] }] } }] }));
    await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify({ schemaVersion:1, game, generatedAt:'2026-07-11T00:00:00Z', count:1, entries:[{ id:'book', name:'Book', file:'book.json', icon:`icons/${hash}.webp`, volumeCount:1, volumeLabels:['Text'], volumeKeys:['text'] }] }));
    await fs.writeFile(path.join(dir, 'search-index.json'), JSON.stringify({ schemaVersion:2, game, generatedAt:'2026-07-11T00:00:00Z', bookCount:1, volumeCount:1, books:['book'], volumes:[{ book:0, volumeKey:'text', leaves:['tanuki tale'] }] }));
    const achievementDir = path.join(root, 'Database', 'Achievements', game);
    await fs.mkdir(achievementDir, { recursive:true });
    const achievementIcon = achievementPng();
    const achievementIconHash = crypto.createHash('sha256').update(achievementIcon).digest('hex');
    await fs.mkdir(path.join(achievementDir, 'assets', 'categories'), { recursive:true });
    await fs.mkdir(path.join(achievementDir, 'assets', 'rewards'), { recursive:true });
    await fs.writeFile(path.join(achievementDir, 'assets', 'categories', `${achievementIconHash}.png`), achievementIcon);
    await fs.writeFile(path.join(achievementDir, 'assets', 'rewards', `${achievementIconHash}.png`), achievementIcon);
    await fs.writeFile(path.join(achievementDir, 'catalog.json'), JSON.stringify({
      schemaVersion:1,
      game,
      catalogVersion:game === 'gi' ? '6.7' : '4.3',
      releasedVersion:game === 'gi' ? '6.7' : '4.3',
      generatedAt:'2026-07-11T00:00:00Z',
      dataTimestamp:'2026-07-11T00:00:00Z',
      source:{ repository:'https://example.test/repo', dataUrl:'https://example.test/catalog.json', license:'MIT', commit:'fixture' },
      categoryCount:1,
      achievementCount:1,
      count:1,
      categories:[{ id:'1', name:'First Steps', sortOrder:1, symbol:{ kind:'monogram', value:'FS' }, icon:{ kind:'image', path:`/assets/achievements/${game}/categories/${achievementIconHash}.png`, sourceKey:'fixture-category.png' } }],
      rewardCurrency:{ name:game === 'gi' ? 'Primogem' : 'Stellar Jade', icon:{ kind:'image', path:`/assets/achievements/${game}/rewards/${achievementIconHash}.png`, sourceKey:'fixture-reward.png' } },
      achievements:[{ id:game === 'gi' ? '80091' : '4010101', categoryId:'1', name:'First achievement', description:'Complete a first step.', reward:5, version:'1.0', sortOrder:1 }],
    }));
  }
  // Genshin character stories: one record per character plus an index, the
  // source of /data/story/gi for the Story tab.
  const storyDir = path.join(root, 'Database', 'CharacterStory', 'gi');
  await fs.mkdir(storyDir, { recursive:true });
  await fs.writeFile(path.join(storyDir, '10000150.json'), JSON.stringify({
    schemaVersion:1, game:'gi', id:'gi-10000150', name:'Odette',
    stories:[{ title:'Character Details', text:'A dancer.' }, { title:'Character Story 1', text:'More.', unlock:['Unlocks at Friendship Lv. 2'] }],
    quotes:[{ title:'Hello', text:'Thanks for the support.' }],
    va:[{ language:'english', name:'Alexis Tipton' }],
  }));
  await fs.writeFile(path.join(storyDir, 'index.json'), JSON.stringify({
    schemaVersion:1, game:'gi', count:1,
    entries:[{ id:'gi-10000150', key:'10000150', name:'Odette', stories:2, quotes:1 }],
  }));
  const historyDir = path.join(root, 'Database', 'BannerHistory');
  const activityDir = path.join(root, 'Database', 'Activities');
  await fs.mkdir(historyDir, { recursive:true }); await fs.mkdir(activityDir, { recursive:true });
  for (const game of ['gi','hsr','zzz','wuwa','ae']) await fs.writeFile(path.join(historyDir, `${game}.json`), JSON.stringify({ schemaVersion:1, game, generatedAt:'2026-07-11T00:00:00Z', records:[{ id:`${game}:fixture` }] }));
  await fs.writeFile(path.join(historyDir, 'manifest.json'), JSON.stringify({ schemaVersion:1, generatedAt:'2026-07-11T00:00:00Z', games:{} }));
  for (const [game, count] of Object.entries({gi:2,hsr:3,zzz:2,wuwa:1})) await fs.writeFile(path.join(activityDir, `${game}.json`), JSON.stringify({ schemaVersion:1, game, generatedAt:'2026-07-11T00:00:00Z', activities:Array.from({length:count},(_,index)=>({id:`a${index}`})) }));
  return root;
}

test('publisher allowlists library data and writes verified manifest metadata', async () => {
  const rootDir = await fixture();
  const manifest = await publishRuntimeData({ rootDir, maxBytes:4096 });
  assert.equal(manifest.files.length, 26);
  for (const entry of manifest.files) {
    assert.match(entry.url, /^(?:\/data\/(?:library\/(?:gi|hsr)\/|story\/gi\/|achievements\/(?:gi|hsr)\/|banner-history\/|activities\/)|\/assets\/achievements\/(?:gi|hsr)\/(?:categories|rewards)\/)/);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.ok(entry.size > 0);
    assert.doesNotThrow(() => new Date(entry.dataTimestamp).toISOString());
  }
});

test('publisher rejects unexpected extensions and removes partial output', async () => {
  const rootDir = await fixture();
  await fs.writeFile(path.join(rootDir, 'Database', 'Library', 'gi', 'evil.svg'), '<svg/>');
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /non-allowlisted/);
  await assert.rejects(fs.access(path.join(rootDir, '.deploy', 'pengo', 'data')));
});

test('publisher rejects missing indexes, invalid JSON, missing icons, and oversized files', async () => {
  let rootDir = await fixture();
  await fs.rm(path.join(rootDir, 'Database', 'Library', 'hsr', 'index.json'));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /missing hsr\/index/);
  rootDir = await fixture();
  await fs.writeFile(path.join(rootDir, 'Database', 'Library', 'gi', 'book.json'), '{bad');
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /Invalid runtime JSON/);
  rootDir = await fixture();
  const indexFile = path.join(rootDir, 'Database', 'Library', 'gi', 'index.json');
  const index = JSON.parse(await fs.readFile(indexFile));
  index.entries[0].icon = `icons/${'0'.repeat(64)}.webp`;
  await fs.writeFile(indexFile, JSON.stringify(index));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /missing\/unsafe icon/);
  rootDir = await fixture();
  const traversalIndexFile = path.join(rootDir, 'Database', 'Library', 'gi', 'index.json');
  const traversalIndex = JSON.parse(await fs.readFile(traversalIndexFile));
  traversalIndex.entries[0].file = '../book.json';
  await fs.writeFile(traversalIndexFile, JSON.stringify(traversalIndex));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /missing\/unsafe book/);
  rootDir = await fixture();
  await fs.writeFile(path.join(rootDir, 'Database', 'Library', 'gi', 'book.json'), JSON.stringify({ generatedAt:'2026-07-11T00:00:00Z', pad:'x'.repeat(5000) }));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /exceeds/);
});

test('publisher rejects future or inconsistent achievement catalogs', async () => {
  let rootDir = await fixture();
  let file = path.join(rootDir, 'Database', 'Achievements', 'hsr', 'catalog.json');
  let catalog = JSON.parse(await fs.readFile(file));
  catalog.achievements[0].version = '4.4';
  await fs.writeFile(file, JSON.stringify(catalog));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /newer than 4\.3/);

  rootDir = await fixture();
  file = path.join(rootDir, 'Database', 'Achievements', 'gi', 'catalog.json');
  catalog = JSON.parse(await fs.readFile(file));
  catalog.count = 2;
  await fs.writeFile(file, JSON.stringify(catalog));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /count metadata is inconsistent/);

  rootDir = await fixture();
  file = path.join(rootDir, 'Database', 'Achievements', 'hsr', 'catalog.json');
  catalog = JSON.parse(await fs.readFile(file));
  catalog.releasedVersion = '99.9';
  catalog.catalogVersion = '99.9';
  catalog.achievements[0].version = '99.8';
  await fs.writeFile(file, JSON.stringify(catalog));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /release ceiling must be 4\.3/);
});

test('publisher rejects remote, missing, malformed, and unreferenced achievement icons', async () => {
  let rootDir = await fixture();
  let file = path.join(rootDir, 'Database', 'Achievements', 'gi', 'catalog.json');
  let catalog = JSON.parse(await fs.readFile(file));
  catalog.categories[0].icon.path = 'https://example.test/icon.png';
  await fs.writeFile(file, JSON.stringify(catalog));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /icon path is invalid/);

  rootDir = await fixture();
  file = path.join(rootDir, 'Database', 'Achievements', 'hsr', 'catalog.json');
  catalog = JSON.parse(await fs.readFile(file));
  const missing = path.basename(catalog.categories[0].icon.path);
  await fs.rm(path.join(rootDir, 'Database', 'Achievements', 'hsr', 'assets', 'categories', missing));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /missing a referenced hsr asset/);

  rootDir = await fixture();
  file = path.join(rootDir, 'Database', 'Achievements', 'gi', 'catalog.json');
  catalog = JSON.parse(await fs.readFile(file));
  const malformed = path.basename(catalog.categories[0].icon.path);
  await fs.writeFile(path.join(rootDir, 'Database', 'Achievements', 'gi', 'assets', 'categories', malformed), Buffer.from('not an image'));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /achievement icon|WebP|hash\/magic/i);

  rootDir = await fixture();
  await fs.writeFile(path.join(rootDir, 'Database', 'Achievements', 'gi', 'assets', 'categories', `${'0'.repeat(64)}.png`), achievementPng());
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /unreferenced or unsafe gi asset/);
});

test('publisher rejects inconsistent book schemas and icon content hashes', async () => {
  let rootDir = await fixture();
  const bookFile = path.join(rootDir, 'Database', 'Library', 'gi', 'book.json');
  const book = JSON.parse(await fs.readFile(bookFile));
  book.volumes[0].document.blocks = [{ type:'script', text:'bad' }];
  await fs.writeFile(bookFile, JSON.stringify(book));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /disallowed block/);
  rootDir = await fixture();
  const indexFile = path.join(rootDir, 'Database', 'Library', 'gi', 'index.json');
  const index = JSON.parse(await fs.readFile(indexFile));
  index.entries[0].volumeCount = 2;
  await fs.writeFile(indexFile, JSON.stringify(index));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /volume count/);
  rootDir = await fixture();
  const iconDir = path.join(rootDir, 'Database', 'Library', 'gi', 'icons');
  const iconName = (await fs.readdir(iconDir))[0];
  await fs.writeFile(path.join(iconDir, iconName), Buffer.from('not an image'));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /hash\/magic mismatch/);
});

test('publisher rejects unstable leaf ids and invalid search volumes', async () => {
  let rootDir = await fixture();
  const bookFile = path.join(rootDir, 'Database', 'Library', 'gi', 'book.json');
  const book = JSON.parse(await fs.readFile(bookFile));
  book.volumes[0].document.blocks[0].id = 'paragraph-1';
  await fs.writeFile(bookFile, JSON.stringify(book));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /stable leaf id/);
  rootDir = await fixture();
  const searchFile = path.join(rootDir, 'Database', 'Library', 'gi', 'search-index.json');
  const search = JSON.parse(await fs.readFile(searchFile));
  search.volumes[0].book = 1;
  await fs.writeFile(searchFile, JSON.stringify(search));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /invalid volume row/);
  rootDir = await fixture();
  const normalizedFile = path.join(rootDir, 'Database', 'Library', 'gi', 'search-index.json');
  const normalized = JSON.parse(await fs.readFile(normalizedFile));
  normalized.volumes[0].leaves[0] = 'Tanuki  tale';
  await fs.writeFile(normalizedFile, JSON.stringify(normalized));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /invalid normalized leaf text/);
});

test('publisher requires all five histories and supported activity files', async () => {
  let rootDir = await fixture();
  await fs.rm(path.join(rootDir, 'Database', 'BannerHistory', 'ae.json'));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /missing ae\.json/);
  rootDir = await fixture();
  await fs.rm(path.join(rootDir, 'Database', 'Activities', 'wuwa.json'));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /missing wuwa\.json/);
  rootDir = await fixture();
  await fs.writeFile(path.join(rootDir, 'Database', 'BannerHistory', 'gi.json'), JSON.stringify({ schemaVersion:1, records:[] }));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /invalid gi\.json/);
});

// ---- Events (Workstream N, optional family) --------------------------

async function withEvents(rootDir, gameToPayload) {
  const eventsDir = path.join(rootDir, 'Database', 'Events');
  await fs.mkdir(eventsDir, { recursive:true });
  for (const [game, payload] of Object.entries(gameToPayload)) {
    await fs.writeFile(path.join(eventsDir, `${game}.json`), JSON.stringify(payload));
  }
  const games = ['gi','hsr','zzz','wuwa','endfield'];
  await fs.writeFile(path.join(eventsDir, 'manifest.json'), JSON.stringify({
    schemaVersion:1,
    generatedAt:'2026-07-12T00:00:00Z',
    games:games.map((game) => ({ game, status:'complete-for-source', exhausted:true, source:{ name:'Official', endpoint:'official.example' } })),
  }));
  await fs.writeFile(path.join(eventsDir, 'history-state.json'), JSON.stringify({
    schemaVersion:1,
    games:Object.fromEntries(games.map((game) => [game, { completedIds:[], resumeCursor:null, exhausted:true, updatedAt:'2026-07-12T00:00:00Z' }])),
  }));
}

test('publisher is unaffected when Events is absent (still-optional family)', async () => {
  const rootDir = await fixture();
  const manifest = await publishRuntimeData({ rootDir, maxBytes:4096 });
  assert.equal(manifest.files.length, 26);
  assert.ok(!manifest.files.some((f) => f.url.startsWith('/data/events/')));
});

test('publisher includes and validates Events when present, keyed by the backend\'s own game field (endfield, not ae)', async () => {
  const rootDir = await fixture();
  await withEvents(rootDir, {
    gi: { schemaVersion:1, game:'gi', generatedAt:'2026-07-12T00:00:00Z', events:[{ id:'gi:fixture', type:'event' }] },
    hsr: { schemaVersion:1, game:'hsr', generatedAt:'2026-07-12T00:00:00Z', events:[] },
    zzz: { schemaVersion:1, game:'zzz', generatedAt:'2026-07-12T00:00:00Z', events:[] },
    wuwa: { schemaVersion:1, game:'wuwa', generatedAt:'2026-07-12T00:00:00Z', events:[] },
    endfield: { schemaVersion:1, game:'endfield', generatedAt:'2026-07-12T00:00:00Z', events:[] },
  });
  const manifest = await publishRuntimeData({ rootDir, maxBytes:4096 });
  assert.equal(manifest.files.length, 33);
  const eventUrls = manifest.files.filter((f) => f.url.startsWith('/data/events/')).map((f) => f.url).sort();
  assert.deepEqual(eventUrls, ['/data/events/endfield.json', '/data/events/gi.json', '/data/events/history-state.json', '/data/events/hsr.json', '/data/events/manifest.json', '/data/events/wuwa.json', '/data/events/zzz.json']);
});

test('publisher accepts the validated resumable event history state and rejects malformed checkpoints', async () => {
  const rootDir = await fixture();
  await withEvents(rootDir, Object.fromEntries(['gi','hsr','zzz','wuwa','endfield'].map((game) => [game, { schemaVersion:1, game, events:[] }])));
  const manifest = await publishRuntimeData({ rootDir, maxBytes:4096 });
  assert.ok(manifest.files.some((entry) => entry.url === '/data/events/history-state.json'));
  const stateFile = path.join(rootDir, 'Database', 'Events', 'history-state.json');
  const state = JSON.parse(await fs.readFile(stateFile));
  state.games.wuwa.resumeCursor = 42;
  await fs.writeFile(stateFile, JSON.stringify(state));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /invalid history-state\.json/);
});

test('publisher rejects Events whose game field does not match its filename', async () => {
  const rootDir = await fixture();
  await withEvents(rootDir, {
    gi: { schemaVersion:1, game:'gi', events:[] },
    hsr: { schemaVersion:1, game:'hsr', events:[] },
    zzz: { schemaVersion:1, game:'zzz', events:[] },
    wuwa: { schemaVersion:1, game:'wuwa', events:[] },
    endfield: { schemaVersion:1, game:'ae', events:[] }, // wrong — must be 'endfield'
  });
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /Runtime Events has invalid endfield\.json/);
});

test('publisher rejects an incomplete Events family (present dir, missing a required game file)', async () => {
  const rootDir = await fixture();
  await withEvents(rootDir, { gi: { schemaVersion:1, game:'gi', events:[] } });
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /Runtime Events is missing hsr\.json/);
});

test('publisher validates character stories against their index and allowlists the story tree', async () => {
  // /data/story is fetched per character by the Story tab, so a record that
  // disagrees with the index would surface as a silently wrong page.
  let rootDir = await fixture();
  const storyDir = path.join(rootDir, 'Database', 'CharacterStory', 'gi');
  const record = JSON.parse(await fs.readFile(path.join(storyDir, '10000150.json')));

  await fs.writeFile(path.join(storyDir, '10000150.json'), JSON.stringify({ ...record, quotes:[] }));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /does not match its index counts/);

  rootDir = await fixture();
  await fs.writeFile(path.join(rootDir, 'Database', 'CharacterStory', 'gi', 'evil.svg'), '<svg/>');
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /non-allowlisted/);

  rootDir = await fixture();
  await fs.rm(path.join(rootDir, 'Database', 'CharacterStory', 'gi', '10000150.json'));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /missing record/);

  rootDir = await fixture();
  const indexFile = path.join(rootDir, 'Database', 'CharacterStory', 'gi', 'index.json');
  const index = JSON.parse(await fs.readFile(indexFile));
  index.entries[0].key = '../../secrets';
  await fs.writeFile(indexFile, JSON.stringify(index));
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /unsafe key/);

  rootDir = await fixture();
  await fs.rm(path.join(rootDir, 'Database', 'CharacterStory'), { recursive:true });
  await assert.rejects(publishRuntimeData({ rootDir, maxBytes:4096 }), /CharacterStory source is missing/);
});
