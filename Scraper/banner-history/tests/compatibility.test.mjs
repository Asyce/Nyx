import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { endfieldCompatibility, giCompatibility } from '../index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
test('GI pull compatibility exactly derives canonical character count and date range', () => {
  const canonical = JSON.parse(fs.readFileSync(path.join(root, 'Database/BannerHistory/gi.json'), 'utf8'));
  const generated = giCompatibility(canonical);
  const rows = JSON.parse(generated.match(/window\.NYX_BANNERS\["gi"\] = (.+);\n$/s)[1]);
  const expected = canonical.records.filter((row) => row.bannerType === 'character' && !row.permanent && Object.values(row.windowsByRegion || {}).some((window) => window.start));
  assert.equal(rows.length, expected.length);
  const canonicalStarts = expected.flatMap((row) => Object.values(row.windowsByRegion).map((window) => Date.parse(window.start)));
  const canonicalEnds = expected.flatMap((row) => Object.values(row.windowsByRegion).map((window) => Date.parse(window.end || window.start)));
  assert.equal(rows[0].start, Math.min(...canonicalStarts));
  assert.equal(rows.at(-1).end, Math.max(...canonicalEnds));
  const normalizeEol = (value) => value.replace(/\r\n/g, '\n');
  assert.equal(normalizeEol(fs.readFileSync(path.join(root, 'Site/src/features/gacha/pulls-banners-gi.js'), 'utf8')), normalizeEol(generated));
});

test('Endfield pull compatibility derives dated character and weapon feature windows', () => {
  const canonical = JSON.parse(fs.readFileSync(path.join(root, 'Database/BannerHistory/ae.json'), 'utf8'));
  const generated = endfieldCompatibility(canonical);
  const rows = JSON.parse(generated.match(/window\.NYX_BANNERS\["ae"\] = (.+);\n$/s)[1]);
  const expected = canonical.records.filter((row) => !row.permanent
    && (row.bannerType === 'character' || row.bannerType === 'weapon')
    && Object.values(row.windowsByRegion || {}).some((window) => window.start));
  assert.equal(rows.length, expected.length);
  assert.ok(rows.some((row) => row.type === 'character' && row.featuredTop.length));
  assert.ok(rows.some((row) => row.type === 'weapon' && row.featuredTop.length));
  const normalizeEol = (value) => value.replace(/\r\n/g, '\n');
  assert.equal(normalizeEol(fs.readFileSync(path.join(root, 'Site/src/features/gacha/pulls-banners-ae.js'), 'utf8')), normalizeEol(generated));
});
