import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '..', '..');

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
