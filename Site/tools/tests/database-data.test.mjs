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
  databaseZzzDriveDiscTwoPieceStat,
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

function readNyxDatabase() {
  const code = fs.readFileSync(path.resolve(root, 'Site/src/data/generated/nyx-data.js'), 'utf8');
  const context = { window:{} };
  vm.runInNewContext(code, context);
  return JSON.parse(JSON.stringify(context.NYX_DB || context.window.NYX_DB));
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
  assert.deepEqual(['B', 'A-Rank', 'S'].map(databaseRarityLabel), ['3 ★', '4 ★', '5 ★']);
  assert.equal(databaseRarityLabel('6✦', { game:'ae' }), '6 ★');
  assert.equal(databaseRarityLabel('6✦'), 'Unknown');
  assert.equal(databaseRarityLabel('6★'), 'Unknown');
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

test('only unusable localized names and proven internal records are quarantined', () => {
  const audit = readJson('Database/Audits/database-missing-art.json');
  assert.equal(audit.quarantinedCount, audit.quarantinedRecords.length);
  assert.ok(audit.quarantinedCount > 44, 'raw localization keys and numeric fallback names are quarantined too');
  const allowedReasons = new Set(['no-localized-display-name', 'proven-internal-test']);
  assert.equal(audit.quarantinedRecords.every((row) => allowedReasons.has(row.releaseStatus)), true);
  assert.ok(audit.quarantinedRecords.some((row) => row.releaseStatus === 'no-localized-display-name'));
  assert.ok(audit.quarantinedRecords.some((row) => row.releaseStatus === 'proven-internal-test'));
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
  assert.equal(databaseRecordClassification({ recordId:'1234', name:'1234' }), 'no-localized-display-name');
  assert.equal(databaseRecordClassification({ name:'OfficialName_Broken' }), 'no-localized-display-name');

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
  }), 'no-localized-display-name');

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

test('existing Prydwen compound fields are repaired without bogus bonus facets', () => {
  const nyx = readNyxDatabase();
  const engines = nyx.games.zzz.collections.find((row) => row.key === 'w-engines');
  assert.ok(engines.items.length > 0);
  assert.equal(engines.items.some((row) => row.fields.rarity === 'Unknown'), false);
  assert.equal(engines.items.every((row) => row.fields.type), true);
  const disks = nyx.games.zzz.collections.find((row) => row.key === 'disk-drives');
  assert.equal(disks.items.some((row) => Object.keys(row.fields).some((key) => /^\d+when/i.test(key))), false);
});

test('GI artifact sets expose their highest obtainable rarity tier', () => {
  const source = readJson('Database/GameData/gi/live/artifacts.json');
  const expected = new Map(source.map((row) => [String(row.id), Math.max(...row.rarity) + ' \u2605']));
  const artifacts = readNyxDatabase().games.gi.collections.find((row) => row.key === 'artifacts');
  assert.equal(artifacts.items.length, source.length);
  assert.equal(artifacts.items.some((row) => row.fields.rarity === 'Unknown'), false);
  for (const row of artifacts.items) {
    assert.equal(row.fields.rarity, expected.get(String(row.id).replace(/^gi-art-/, '')), row.name);
  }
  assert.deepEqual(
    Object.fromEntries([...new Set(artifacts.items.map((row) => row.fields.rarity))].sort().map((tier) => [tier, artifacts.items.filter((row) => row.fields.rarity === tier).length])),
    { '4 \u2605':3, '5 \u2605':60 },
  );
});

test('HSR Monsters and ZZZ Drive Discs expose trustworthy source-native facets', () => {
  const hsrMonsters = readGenerated('hsr').collections.find((row) => row.key === 'monsters');
  const ranks = [...new Set(hsrMonsters.items.map((row) => row.fields.rank).filter(Boolean))].sort();
  assert.deepEqual(ranks, ['Big Boss', 'Elite', 'Little Boss', 'Minion', 'Minion Lv2']);

  assert.equal(databaseZzzDriveDiscTwoPieceStat({ bonuses:['(2) ATK + 10% .', '(4) arbitrary prose'] }), 'ATK');
  assert.equal(databaseZzzDriveDiscTwoPieceStat({ bonuses:['(2) Increases Basic Attack DMG by 15% .'] }), 'Basic Attack DMG');
  assert.equal(databaseZzzDriveDiscTwoPieceStat({ bonuses:['(4) ATK + 99% .'] }), 'Unknown');
  assert.equal(databaseZzzDriveDiscTwoPieceStat({ bonuses:['(2) Unverified Mystery + 10% .'] }), 'Unknown');

  const disks = readNyxDatabase().games.zzz.collections.find((row) => row.key === 'disk-drives');
  const stats = [...new Set(disks.items.map((row) => row.fields.twoPieceStat))].sort();
  assert.equal(disks.items.every((row) => row.fields.twoPieceStat), true);
  assert.equal(stats.includes('Unknown'), false, 'all current structured two-piece bonuses are recognized');
  assert.ok(stats.length >= 2 && stats.length <= 24, 'the facet remains useful and bounded');
  for (const expected of ['ATK', 'Basic Attack DMG', 'CRIT Rate', 'Energy Regen', 'Wind DMG']) {
    assert.ok(stats.includes(expected), expected);
  }
});

test('every supported normalized source rarity matches its generated Database tier', () => {
  const configs = {
    gi: { dir:'gi', prefix:'gi' },
    hsr: { dir:'hsr', prefix:'hsr' },
    zzz: { dir:'zzz', prefix:'zzz' },
    wuwa: { dir:'ww', prefix:'ww' },
  };
  const mismatches = [];
  for (const [game, config] of Object.entries(configs)) {
    const generated = readGenerated(game);
    for (const collection of ['items', 'monsters']) {
      const source = readJson(`Database/GameData/${config.dir}/live/${collection}.json`);
      const byId = new Map(source.map((row) => [String(row.id), row]));
      const output = generated.collections.find((row) => row.key === collection);
      for (const row of output.items) {
        const sourceId = String(row.id).replace(new RegExp(`^${config.prefix}-(?:item|mon)-`), '');
        const sourceRow = byId.get(sourceId);
        if (!sourceRow || !Object.hasOwn(sourceRow, 'rarity')) continue;
        const expected = databaseRarityLabel(sourceRow.rarity);
        const actual = row.fields?.rarity || 'Unknown';
        if (expected !== actual) mismatches.push({ game, collection, sourceId, expected, actual });
      }
    }
  }
  assert.deepEqual(mismatches, []);
});

test('Unknown rarity gates remain explicit until a trustworthy source exists', () => {
  const lazy = Object.fromEntries(['gi', 'hsr'].map((game) => [game, readGenerated(game)]));
  const inline = readNyxDatabase().games;
  const countUnknown = (items) => items.filter((row) => !row.fields?.rarity || row.fields.rarity === 'Unknown').length;
  const lazyCollection = (game, key) => lazy[game].collections.find((row) => row.key === key).items;
  const inlineCollection = (game, key) => inline[game].collections.find((row) => row.key === key).items;
  assert.deepEqual({
    giMonsters:countUnknown(lazyCollection('gi', 'monsters')),
    giItems:countUnknown(lazyCollection('gi', 'items')),
    hsrMonsters:countUnknown(lazyCollection('hsr', 'monsters')),
    hsrRelicSets:countUnknown(inlineCollection('hsr', 'relic-sets')),
    hsrLightCones:countUnknown(inlineCollection('hsr', 'light-cones')),
    zzzDriveDiscs:countUnknown(inlineCollection('zzz', 'disk-drives')),
    wuwaEchoes:countUnknown(inlineCollection('wuwa', 'echoes')),
    endfieldGear:countUnknown(inlineCollection('ae', 'gear')),
  }, {
    giMonsters:547,
    giItems:2270,
    hsrMonsters:612,
    hsrRelicSets:60,
    hsrLightCones:3,
    zzzDriveDiscs:28,
    wuwaEchoes:180,
    endfieldGear:152,
  });
  const tcg = [...(inline.gi.tcg.characterCards || []), ...(inline.gi.tcg.otherCards || [])];
  assert.equal(tcg.length, 619);
  assert.equal(tcg.every((row) => databaseRarityLabel(row.rarity) === 'Unknown'), true);
});

test('missing-art audit accounts for every generated no-art row', () => {
  const audit = readJson('Database/Audits/database-missing-art.json');
  const lazyMissing = Object.keys({ gi: 1, hsr: 1, zzz: 1, wuwa: 1 })
    .flatMap((game) => readGenerated(game).collections)
    .flatMap((collection) => collection.items.filter((row) => !row.art));
  const nyx = readNyxDatabase();
  const inlineMissing = Object.values(nyx.games)
    .flatMap((game) => game.collections || [])
    .flatMap((collection) => collection.items || [])
    .filter((row) => !row.art);
  const gi = nyx.games.gi;
  const specialMissing = [
    ...(gi.tcg?.characterCards || []),
    ...(gi.tcg?.otherCards || []),
    ...(gi.furniture?.items || []),
    ...(gi.wonderland?.costumes || []),
    ...(gi.wonderland?.suits || []),
    ...(gi.wonderland?.items || []),
  ].filter((row) => !row.art);
  const generatedMissing = [...lazyMissing, ...inlineMissing, ...specialMissing];
  assert.equal(audit.records.length, generatedMissing.length);
  assert.equal(audit.missingArtCount, audit.records.length);
  assert.deepEqual(audit.coverage.after.scopes, ['inline', 'lazy', 'special']);
  assert.equal(audit.coverage.after.summaryCount, audit.summary.length);
  assert.equal(audit.summary.reduce((count, row) => count + row.missingArtCount, 0), audit.missingArtCount);
  assert.equal(audit.records.some((row) => row.releaseStatus !== 'live'), false);
  assert.equal(audit.records.some((row) => row.sourceUrl && !row.sourceUrl.startsWith('https://static.nanoka.cc/assets/')), false);
  assert.equal(audit.records.some((row) => row.result === 'no-approved-source-icon' && row.sourceUrl), false);
});
