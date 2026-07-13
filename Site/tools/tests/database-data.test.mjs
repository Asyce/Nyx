import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  cleanDatabaseText,
  compareDatabaseRarityLabels,
  databaseRarityLabel,
  databaseRecordClassification,
} from '../lib/database-data-helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.resolve(root, relative), 'utf8'));
}

function readGenerated(game) {
  const code = fs.readFileSync(path.resolve(root, `Site/src/data/generated/db-data-${game}.js`), 'utf8');
  const window = { dispatchEvent() {} };
  vm.runInNewContext(code, {
    window,
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  });
  return JSON.parse(JSON.stringify(window.NYX_DB_EXTRA[game]));
}

test('cross-game rarity fixtures normalize and sort 1 ★ through 5 ★ explicitly', () => {
  const fixtures = {
    gi: [1, 2, 3, 4, 5],
    hsr: ['Normal', 'NotNormal', 'Rare', 'SuperRare', 'VeryRare'],
    zzz: [1, 2, 3, 4, 5],
    wuwa: ['1 ★', '2 ★', '3 ★', '4 ★', '5 ★'],
  };
  const expected = ['1 ★', '2 ★', '3 ★', '4 ★', '5 ★'];
  for (const [game, inputs] of Object.entries(fixtures)) {
    assert.deepEqual(inputs.map(databaseRarityLabel), expected, game);
  }
  assert.deepEqual(
    ['Unknown', '5 ★', '2 ★', '4 ★', '1 ★', '3 ★'].sort(compareDatabaseRarityLabels),
    [...expected, 'Unknown'],
  );
  assert.equal(databaseRarityLabel('not-a-rarity'), 'Unknown');
  assert.equal(databaseRarityLabel(0), 'Unknown');
});

test('focused helper import is side-effect-free for generated Database packs', async () => {
  const packPaths = ['gi', 'hsr', 'zzz', 'wuwa']
    .map((game) => path.resolve(root, `Site/src/data/generated/db-data-${game}.js`));
  const snapshot = (file) => ({
    mtimeMs: fs.statSync(file).mtimeMs,
    hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  });
  const before = packPaths.map(snapshot);
  const helperUrl = pathToFileURL(path.resolve(root, 'Site/tools/lib/database-data-helpers.mjs')).href;
  await import(`${helperUrl}?side-effect-check=${Date.now()}`);
  assert.deepEqual(packPaths.map(snapshot), before);
});

test('Database detail text decodes escaped line breaks without truncating', () => {
  const tail = 'This is the complete final sentence.';
  const value = cleanDatabaseText(`First paragraph.\\n\\nSecond paragraph. ${'long '.repeat(80)}${tail}`);
  assert.match(value, /First paragraph\.\n\nSecond paragraph\./);
  assert.ok(value.endsWith(tail));
  assert.equal(value.includes('\\n'), false);
});

test('source, normalized, and generated Database counts match deterministically', () => {
  const audit = readJson('Database/Audits/database-missing-art.json');
  const configs = {
    gi: { dir: 'gi' },
    hsr: { dir: 'hsr' },
    zzz: { dir: 'zzz' },
    wuwa: { dir: 'ww' },
  };
  for (const [game, config] of Object.entries(configs)) {
    const generated = readGenerated(game);
    for (const collection of ['monsters', 'items']) {
      const rawFile = collection === 'items' ? 'itemAll.json' : 'monsters.json';
      const source = readJson(`Database/GameData/${config.dir}/live/raw/${rawFile}`);
      const normalized = readJson(`Database/GameData/${config.dir}/live/${collection}.json`);
      const output = generated.collections.find((row) => row.key === collection);
      const summary = audit.summary.find((row) => row.game === game && row.collection === collection);
      assert.equal(Object.keys(source).length, normalized.length, `${game}/${collection} source -> normalized`);
      assert.equal(normalized.length, output.count + summary.quarantinedCount, `${game}/${collection} normalized -> approved + quarantined`);
      assert.equal(output.count, output.items.length, `${game}/${collection} generated payload`);
      assert.equal(output.items.some((row) => /^https?:\/\//i.test(row.art || '')), false, `${game}/${collection} local art only`);
    }
  }
});

test('test/internal records are quarantined and never approved as released data', () => {
  const audit = readJson('Database/Audits/database-missing-art.json');
  assert.equal(audit.quarantinedCount, 44);
  assert.equal(audit.quarantinedRecords.length, 44);
  assert.equal(audit.quarantinedRecords.filter((row) => row.game === 'gi' && row.collection === 'items').length, 33);
  assert.equal(audit.quarantinedRecords.filter((row) => /TrapTest/i.test(row.sourceIconField?.value || '')).length, 1);
  assert.equal(audit.quarantinedRecords.every((row) => row.releaseStatus === 'internal/test'), true);
  assert.equal(audit.quarantinedRecords.every((row) => row.result === 'quarantined'), true);
  assert.equal(audit.quarantinedRecords.every((row) => row.sourceUrl === null && row.localDestination === null), true);
  assert.equal(audit.records.some((row) => databaseRecordClassification({
    game: row.game,
    collection: row.collection,
    recordId: row.recordId,
    name: row.name,
    sourceIcon: row.sourceIconField?.value,
  }) !== 'released'), false);
  assert.equal(databaseRecordClassification({ name: 'The Bestest Travel Companion!' }), 'released');
  assert.equal(databaseRecordClassification({ name: 'Disciples of Sanctus Medicus: Internal Alchemist' }), 'released');
  assert.equal(databaseRecordClassification({ name: 'Ultra-Hot Burner Lamp Test Model' }), 'released');
  assert.equal(databaseRecordClassification({ name: 'Automatic Wooden Dummy' }), 'released');

  const releasedTrapRecords = [
    ['202051', 'Unknown Trap'],
    ['202052', 'Enhanced Trap'],
    ['204051', 'Memory of the Shelled'],
    ['204052', 'Dreadful Memory of the Shelled'],
  ];
  for (const [recordId, name] of releasedTrapRecords) {
    assert.equal(databaseRecordClassification({
      game: 'zzz',
      collection: 'items',
      recordId,
      name,
      sourceIcon: 'Assets/NapResources/UI/Sprite/ItemIcon/TrapTest.png',
    }), 'released', name);
    const auditRow = audit.records.find((row) => row.game === 'zzz' && row.collection === 'items' && row.recordId === recordId);
    assert.equal(auditRow?.result, 'unsafe-source-icon', name);
    assert.equal(auditRow?.sourceUrl, null, name);
    assert.equal(auditRow?.localDestination, null, name);
  }
  assert.equal(databaseRecordClassification({
    game: 'zzz',
    collection: 'items',
    recordId: '207013',
    name: 'Item_RL_CurseClear_name',
    sourceIcon: 'Assets/NapResources/UI/Sprite/ItemIcon/TrapTest.png',
  }), 'internal/test');

  const generatedNames = ['gi', 'hsr', 'zzz', 'wuwa']
    .flatMap((game) => readGenerated(game).collections)
    .flatMap((collection) => collection.items.map((row) => row.name));
  for (const row of audit.quarantinedRecords) assert.equal(generatedNames.includes(row.name), false, row.name);
});

test('The Game Before the Gate keeps complete text and no unsupported family', () => {
  const gi = readGenerated('gi');
  const monsters = gi.collections.find((row) => row.key === 'monsters');
  const gate = monsters.items.find((row) => row.name === 'The Game Before the Gate');
  assert.ok(gate);
  assert.equal(gate.text.includes('\\n'), false);
  assert.match(gate.text, /\n/);
  assert.match(gate.text, /such constraints no longer apply\.$/);
  assert.equal(Object.hasOwn(gate.fields, 'family'), false);
  assert.equal(JSON.stringify(gate.fields).includes('Fatui'), false);
});

test('missing-art audit accounts for every generated no-art row', () => {
  const audit = readJson('Database/Audits/database-missing-art.json');
  const generatedMissing = Object.keys({ gi: 1, hsr: 1, zzz: 1, wuwa: 1 })
    .flatMap((game) => readGenerated(game).collections)
    .flatMap((collection) => collection.items.filter((row) => !row.art));
  assert.equal(audit.records.length, generatedMissing.length);
  assert.equal(audit.missingArtCount, audit.records.length);
  assert.equal(audit.records.some((row) => row.releaseStatus !== 'live'), false);
  assert.equal(audit.records.some((row) => row.sourceUrl && !row.sourceUrl.startsWith('https://static.nanoka.cc/assets/')), false);
  assert.equal(audit.records.some((row) => row.result === 'no-approved-source-icon' && row.sourceUrl), false);
});
