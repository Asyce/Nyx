import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { publishRuntimeData } from '../publish-runtime-data.mjs';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nyx-runtime-'));
  for (const game of ['gi','hsr']) {
    const dir = path.join(root, 'Database', 'Library', game);
    await fs.mkdir(path.join(dir, 'icons'), { recursive:true });
    const bytes = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32, game)]);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    await fs.writeFile(path.join(dir, 'icons', `${hash}.webp`), bytes);
    await fs.writeFile(path.join(dir, 'book.json'), JSON.stringify({ schemaVersion:1, game, id:'book', name:'Book', generatedAt:'2026-07-11T00:00:00Z', volumes:[{ id:'1', label:'Text', document:{ version:1, blocks:[] } }] }));
    await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify({ schemaVersion:1, game, generatedAt:'2026-07-11T00:00:00Z', count:1, entries:[{ id:'book', name:'Book', file:'book.json', icon:`icons/${hash}.webp`, volumeCount:1, volumeLabels:['Text'] }] }));
  }
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
  assert.equal(manifest.files.length, 16);
  for (const entry of manifest.files) {
    assert.match(entry.url, /^\/data\/(?:library\/(?:gi|hsr)\/|banner-history\/|activities\/)/);
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
