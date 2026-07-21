import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '..', '..');
const root = path.resolve(site, '..');
const require = createRequire(import.meta.url);
const { isUsefulReward } = require(path.join(root, 'Scraper', 'codes', 'reward-vocab.cjs'));

test('launcher code feed contains only safe dated premium-code rows', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(site, 'src', 'data', 'generated', 'launcher-codes-v1.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(manifest.games), ['gi', 'hsr', 'zzz', 'wuwa', 'ae']);
  for (const codes of Object.values(manifest.games)) {
    assert.ok(codes.length <= 5);
    assert.ok(codes.every((entry) => /^[-_A-Za-z0-9]{1,64}$/.test(entry.code)));
    assert.ok(codes.every((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.added)));
    assert.ok(codes.every((entry, index) => index === 0 || codes[index - 1].added >= entry.added));
  }
});

test('standalone launcher codes exactly match banner-manifest embedded codes', () => {
  const codes = JSON.parse(fs.readFileSync(path.join(site, 'src', 'data', 'generated', 'launcher-codes-v1.json'), 'utf8'));
  const banners = JSON.parse(fs.readFileSync(path.join(site, 'src', 'data', 'generated', 'launcher-banners-v1.json'), 'utf8'));
  for (const game of ['gi', 'hsr', 'zzz', 'wuwa', 'ae']) {
    assert.deepEqual(banners.games[game].codes, codes.games[game], `${game} launcher code feeds drifted`);
  }
});

test('site-wide generated codes contain exactly the current authoritative code rows', () => {
  const source = JSON.parse(fs.readFileSync(path.join(root, 'Database', 'Codes', 'codes.json'), 'utf8'));
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(site, 'src', 'data', 'generated', 'nyx-data.js'), 'utf8'), context);
  const nyx = JSON.parse(JSON.stringify(context.window.NYX_DB));
  const aliases = new Map([['genshin', 'gi'], ['hsr', 'hsr'], ['zzz', 'zzz'], ['wuwa', 'wuwa'], ['endfield', 'ae']]);
  const expected = Object.fromEntries(['gi', 'hsr', 'zzz', 'wuwa', 'ae'].map((game) => [game, []]));

  for (const group of source.games) {
    const game = aliases.get(group.slug);
    expected[game] = group.codes
      .filter((entry) => entry?.code)
      .filter((entry) => isUsefulReward(game, entry.reward ?? entry.rewards, entry.sourceUrl ?? group.sourceUrl))
      .map((entry) => String(entry.code).trim());
  }
  assert.equal(nyx.codes.updated, source.generatedAt);
  for (const game of ['gi', 'hsr', 'zzz', 'wuwa', 'ae']) {
    const actual = nyx.codes.games[game].map((entry) => entry.code);
    assert.deepEqual(actual, expected[game], `${game} site-wide codes drifted from Database/Codes/codes.json`);
    assert.deepEqual(nyx.games[game].codes.map((entry) => entry.code), actual, `${game} duplicated site code payload drifted`);
  }
});
