import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverPayloads, enforceShrinkGuard, normalizePayloads, runWonderlandSync } from '../core.mjs';

const payload = (url, body) => `<script type="application/json" data-sveltekit-fetched data-url="${url}">${JSON.stringify({ body: JSON.stringify(body) }).replace(/"/g, '&quot;')}</script>`;
const rows = (count, make) => Object.fromEntries(Array.from({ length: count }, (_, index) => [String(100000 + index), make(index)]));
const fixture = ({ costumes = 500, items = 1200, suits = 150, icon = null } = {}) => {
  const base = 'https://static.nanoka.cc/gi/6.7.51/en/beyond';
  return [
    payload(`${base}/costume.json`, rows(costumes, (i) => ({ name:`Costume ${i}`, icon, rank:'Blue', body:['BODY_GIRL'], color:['Blue'], slot:['UpperCloth'] }))) +
      payload(`${base}/lang_map.json`, { slot:{ upper_cloth:'Top' }, color:{ blue:'Blue' } }),
    payload(`${base}/item.json`, rows(items, (i) => ({ name:`Item ${i}`, icon, rank:3, type:'MATERIAL' }))),
    payload(`${base}/costume_suit.json`, rows(suits, (i) => ({ name:`Set ${i}`, icon, rank:'Blue', body:['BODY_GIRL'], color:['Blue'] }))),
  ];
};

function fakeFetch(pages, { failAsset = false } = {}) {
  let page = 0;
  return async (url) => {
    if (String(url).includes('gi.nanoka.cc/beyond')) {
      const body = pages[page++];
      return { ok:true, text:async () => body };
    }
    if (failAsset) return { ok:false, status:503, statusText:'nope' };
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
    return { ok:true, arrayBuffer:async () => webp };
  };
}

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-wonderland-'));
  fs.mkdirSync(path.join(root, 'Database', 'GameData', 'gi', 'beyond'), { recursive:true });
  fs.writeFileSync(path.join(root, 'Database', 'GameData', 'gi', 'beyond', 'sentinel.txt'), 'last-known-good');
  return root;
}

test('discovers the versioned base and normalizes the complete schema', () => {
  const discovered = discoverPayloads(fixture());
  const normalized = normalizePayloads(discovered);
  assert.equal(discovered.version, '6.7.51');
  assert.deepEqual(Object.fromEntries(['costumes','items','suits'].map((key) => [key, normalized[key].length])), { costumes:500, items:1200, suits:150 });
  assert.equal(normalized.langMap.slot.upper_cloth, 'Top');
});

test('rejects hostile ids and icon paths', () => {
  const discovered = discoverPayloads(fixture());
  discovered.items = { '../escape': { name:'Bad', icon:'../../escape' }, ...discovered.items };
  assert.throws(() => normalizePayloads(discovered), /Unsafe Wonderland record id/);
});

test('rejects an unexpected source shrink below 80 percent', () => {
  assert.throws(() => enforceShrinkGuard({ costumes:Array(79), items:Array(80), suits:Array(80) }, { costumes:100, items:100, suits:100 }), /80% guard/);
});

test('failed fetch preserves the last-known-good directory', async () => {
  const rootDir = tempRoot();
  const fetchImpl = async () => { throw new Error('offline'); };
  await assert.rejects(runWonderlandSync({ rootDir, fetchImpl }), /Failed to fetch/);
  assert.equal(fs.readFileSync(path.join(rootDir, 'Database', 'GameData', 'gi', 'beyond', 'sentinel.txt'), 'utf8'), 'last-known-good');
});

test('schema failure preserves the last-known-good directory', async () => {
  const rootDir = tempRoot();
  const pages = fixture();
  pages[0] = pages[0].replace('costume.json', 'wrong.json');
  await assert.rejects(runWonderlandSync({ rootDir, fetchImpl:fakeFetch(pages) }), /Missing embedded costume/);
  assert.equal(fs.readFileSync(path.join(rootDir, 'Database', 'GameData', 'gi', 'beyond', 'sentinel.txt'), 'utf8'), 'last-known-good');
});

test('asset failure preserves the last-known-good directory', async () => {
  const rootDir = tempRoot();
  await assert.rejects(runWonderlandSync({ rootDir, fetchImpl:fakeFetch(fixture({ icon:'UI_Beyd_Test' }), { failAsset:true }) }), /Failed to fetch/);
  assert.equal(fs.readFileSync(path.join(rootDir, 'Database', 'GameData', 'gi', 'beyond', 'sentinel.txt'), 'utf8'), 'last-known-good');
});

test('successful run atomically replaces the old directory', async () => {
  const rootDir = tempRoot();
  const report = await runWonderlandSync({ rootDir, fetchImpl:fakeFetch(fixture({ icon:'UI_Beyd_Test' })), now:() => new Date('2026-07-11T00:00:00Z') });
  const out = path.join(rootDir, 'Database', 'GameData', 'gi', 'beyond');
  assert.equal(fs.existsSync(path.join(out, 'sentinel.txt')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'items.json'))).length, 1200);
  assert.equal(report.assets.referenced, 1);
});

