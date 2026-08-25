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
import { avatarEntryAfterFailure } from '../scrape-genshin-avatars.mjs';

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

test('Genshin avatar refresh retries changed art after a transient download failure', () => {
  const next = { id:'1', sourceUrl:'new', art:'new.webp' };
  const previous = { id:'1', sourceUrl:'old', art:'old.webp' };
  assert.deepEqual(avatarEntryAfterFailure(next, previous, true), previous);
  assert.deepEqual(avatarEntryAfterFailure(next, null, false), { ...next, failed:true });
});

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
      assert.equal(normalized.length, output.count + summary.quarantinedCount + (summary.routedCount || 0), `${game}/${collection} normalized -> generated + routed + quarantined`);
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
    { '4 \u2605':3, '5 \u2605':62 },
  );
});

test('HSR Relic Sets use the complete live GameData facts without source residue', () => {
  const source = readJson('Database/GameData/hsr/live/relics.json');
  const hsr = readNyxDatabase().games.hsr;
  const relics = hsr.collections.find((row) => row.key === 'relic-sets');
  const typeMap = new Map([
    ['cavern relic', 'RELIC SET'],
    ['planar ornament', 'PLANETARY ORNAMENT SET'],
  ]);
  const renderValue = (value, percent) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value ?? '');
    const raw = percent && Math.abs(number) <= 10 ? number * 100 : number;
    const fixed = Math.abs(raw) >= 100 ? raw.toFixed(0)
      : Math.abs(raw) >= 10 ? raw.toFixed(1) : raw.toFixed(2);
    return fixed.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1') + (percent ? '%' : '');
  };
  const renderBonus = (effect) => cleanDatabaseText(`(${effect.pieces}) ${String(effect.description || '')
    .replace(/#(\d+)(?:\[[^\]]+\])?(%)?/g, (token, index, percent) => {
      const value = (effect.params || [])[Number(index) - 1];
      return value === undefined ? token : renderValue(value, !!percent);
    })}`);

  assert.equal(relics.key, 'relic-sets');
  assert.equal(relics.title, 'Relic Sets');
  assert.equal(relics.source, 'GameData');
  assert.equal(source.length, 60);
  assert.equal(source.every((row) => row.contentStatus === 'live'), true);
  assert.equal(relics.count, 60);
  assert.equal(relics.items.length, 60);
  assert.equal(source.reduce((count, row) => count + (row.setEffects || []).length, 0), 92);
  assert.equal(relics.items.reduce((count, row) => count + row.fields.bonuses.length, 0), 92);
  assert.equal(new Set(relics.items.map((row) => row.id)).size, 60);
  const lightCones = hsr.collections.find((row) => row.key === 'light-cones');
  const lightConeSource = readJson('Database/Prydwen/hsr/collections/light-cones.json');
  assert.equal(lightCones.source, 'Prydwen');
  assert.equal(lightCones.count, lightConeSource.entries.length);
  assert.equal(lightCones.items.length, lightConeSource.entries.length);

  const byId = new Map(relics.items.map((row) => [row.id, row]));
  for (const row of source) {
    const type = typeMap.get(row.type);
    assert.ok(type, `${row.id}: unsupported type ${row.type}`);
    const bonuses = (row.setEffects || []).map(renderBonus);
    const actual = byId.get(`hsr-relic-${row.id}`);
    assert.ok(actual, row.name);
    assert.deepEqual({
      id:actual.id,
      name:actual.name,
      kind:actual.kind,
      art:actual.art,
      fields:actual.fields,
      status:actual.status,
      labels:actual.labels,
    }, {
      id:`hsr-relic-${row.id}`,
      name:row.name,
      kind:'relics',
      art:`../../Database/${row.assets.icon}`,
      fields:{ type, bonuses },
      status:row.contentStatus,
      labels:[],
    }, row.name);
    assert.equal(actual.text, cleanDatabaseText([row.name, `Type: ${type}`, ...bonuses].join('\n')), row.name);
    assert.equal(fs.existsSync(path.resolve(root, 'Database', row.assets.icon)), true, row.name);
  }

  const rendered = relics.items.flatMap((row) => [row.text, ...row.fields.bonuses]).join('\n');
  assert.doesNotMatch(rendered, /#\d+(?:\[[^\]]+\])?/);
  assert.doesNotMatch(rendered, /<[^>]+>/);
  assert.equal(relics.items.every((row) => row.art && row.status === 'live'), true);
  assert.equal(relics.items.some((row) => /Prydwen/i.test(row.art)), false);
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
        const expected = game === 'gi' && collection === 'items' && /local specialty/i.test(String(sourceRow.type || ''))
          ? '1 \u2605' : databaseRarityLabel(sourceRow.rarity);
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
    giMonsters:584,
    giItems:2292,
    hsrMonsters:612,
    hsrRelicSets:60,
    hsrLightCones:4,
    zzzDriveDiscs:29,
    wuwaEchoes:181,
    endfieldGear:158,
  });
  const tcg = [...(inline.gi.tcg.characterCards || []), ...(inline.gi.tcg.otherCards || [])];
  assert.equal(tcg.length, 619);
  assert.equal(tcg.every((row) => databaseRarityLabel(row.rarity) === 'Unknown'), true);
});

test('missing-art audit accounts for every intentional neutral fallback', () => {
  const audit = readJson('Database/Audits/database-missing-art.json');
  const lazyRows = Object.keys({ gi: 1, hsr: 1, zzz: 1, wuwa: 1 })
    .flatMap((game) => readGenerated(game).collections)
    .flatMap((collection) => collection.items);
  const nyx = readNyxDatabase();
  const inlineRows = Object.values(nyx.games)
    .flatMap((game) => game.collections || [])
    .flatMap((collection) => collection.items || []);
  const gi = nyx.games.gi;
  const specialRows = [
    ...(gi.tcg?.characterCards || []),
    ...(gi.tcg?.otherCards || []),
    ...(gi.furniture?.items || []),
    ...(gi.furniture?.blueprints || []),
    ...(gi.furniture?.materials || []),
    ...(gi.wonderland?.costumes || []),
    ...(gi.wonderland?.suits || []),
    ...(gi.wonderland?.items || []),
    ...(gi.shadowRealm?.items || []),
    ...(gi.gallery?.namecards || []),
    ...(gi.gallery?.portraits || []),
    ...(gi.gallery?.avatarFrames || []),
    ...(gi.gallery?.splashArts || []),
  ];
  const generatedRows = [...lazyRows, ...inlineRows, ...specialRows];
  const fallbacks = generatedRows.filter((row) => row.artStatus === 'intentional-fallback');
  assert.equal(generatedRows.some((row) => !row.art), false);
  assert.equal(audit.records.length, fallbacks.length);
  assert.equal(audit.missingArtCount, audit.records.length);
  assert.equal(audit.intentionalFallbackCount, fallbacks.length);
  assert.equal(audit.displayArtMissingCount, 0);
  assert.equal(fallbacks.every((row) => row.artSource === 'neutral-database-placeholder'), true);
  for (const row of fallbacks) {
    assert.match(row.art, /^\.\.\/\.\.\/Database\/Shared\/database-fallbacks\/(?:gi|hsr|zzz|wuwa|ae)\.svg$/);
    assert.equal(fs.existsSync(path.resolve(root, row.art.replace('../../', ''))), true, row.art);
  }
  assert.deepEqual(audit.coverage.after.scopes, ['inline', 'lazy', 'special']);
  assert.equal(audit.coverage.after.summaryCount, audit.summary.length);
  assert.equal(audit.summary.reduce((count, row) => count + row.missingArtCount, 0), audit.missingArtCount);
  assert.equal(audit.records.some((row) => row.releaseStatus !== 'live'), false);
  assert.equal(audit.records.some((row) => row.sourceUrl && !row.sourceUrl.startsWith('https://static.nanoka.cc/assets/')), false);
  assert.equal(audit.records.some((row) => row.result === 'no-approved-source-icon' && row.sourceUrl), false);
});

test('Genshin Items routes duplicate tabs, currencies, Gallery, and Pot from source markers', () => {
  const nyx = readNyxDatabase().games.gi;
  const items = readGenerated('gi').collections.find((collection) => collection.key === 'items').items;
  const raw = readJson('Database/GameData/gi/live/raw/itemAll.json');
  const normalized = readJson('Database/GameData/gi/live/items.json');
  const itemIds = new Set(items.map((row) => row.id.replace(/^gi-item-/, '')));
  const excludedMaterialTypes = new Set([
    'MATERIAL_NAMECARD', 'MATERIAL_PROFILE_PICTURE', 'MATERIAL_PROFILE_FRAME',
    'MATERIAL_GCG_CARD', 'MATERIAL_GCG_CARD_FACE', 'MATERIAL_FURNITURE_FORMULA',
    'MATERIAL_FURNITURE_SUITE_FORMULA', 'MATERIAL_PHOTOGRAPH_POSE', 'MATERIAL_COSTUME',
    'MATERIAL_BEYOND_COSTUME_SELECTABLE_CHEST', 'MATERIAL_WEAPON_SKIN',
  ]);
  for (const id of itemIds) assert.equal(excludedMaterialTypes.has(raw[id]?.material_type), false, id);
  assert.equal(items.some((row) => row.fields?.type === 'Unknown Weapon'), false);
  assert.equal(items.some((row) => row.fields?.type === 'Firearm Accessory Blueprint'), false);
  assert.equal(items.filter((row) => row.fields?.type === 'Special Currency').length, 10);
  const localSpecialties = items.filter((row) => /local specialty/i.test(row.fields?.type || ''));
  assert.equal(localSpecialties.length, 61);
  assert.equal(localSpecialties.every((row) => row.fields?.rarity === '1 \u2605'), true);
  for (const type of ['Wishing Item', 'Limited Wishing Item', 'Superior Voucher', 'Common Voucher']) {
    assert.equal(items.some((row) => row.fields?.type === type), false, type);
  }

  const tpsWeapons = normalized.filter((row) => row.type === 'Firearm Accessory Blueprint').length
    + readJson('Database/GameData/gi/live/weapons.json').filter((row) => row.type === 'ITEM_TPS_WEAPON').length;
  assert.equal(nyx.shadowRealm.items.length, tpsWeapons);
  const firearmAccessories = nyx.shadowRealm.items.filter((row) => row.id.startsWith('gi-shadow-item-'));
  assert.equal(firearmAccessories.every((row) => !/^Blueprint for a firearm accessory/i.test(row.text)), true);
  assert.equal(firearmAccessories.find((row) => row.name === "Balsag's Sunwheel: Ammo Feed").text,
    'Reloading speed is greatly increased. The number of rounds loaded at once is increased to 3.');
  assert.equal(nyx.collections.find((row) => row.key === 'weapons').items.some((row) => row.fields?.type === 'ITEM_TPS_WEAPON'), false);
  assert.equal(nyx.gallery.namecards.length, Object.values(raw).filter((row) => row.material_type === 'MATERIAL_NAMECARD').length);
  for (const row of nyx.gallery.namecards) {
    const file = path.resolve(root, row.art.replace(/^\.\.\/\.\.\//, ''));
    assert.equal(fs.readFileSync(file).subarray(8, 12).toString(), 'WEBP', row.name);
  }
  // Portraits merge three sources instead of taking only the wiki manifest
  // (user 2026-08-14): the manifest lags each release, so a non-empty manifest
  // used to discard every roster-derived portrait — Odette had a splash art and
  // a namecard in the gallery but no portrait. Every manifest entry still has
  // to survive the merge, and the roster fills the gaps.
  const avatarManifest = readJson('Database/GenshinWiki/avatars/manifest.json');
  assert.ok(nyx.gallery.portraits.length >= avatarManifest.entries.length, 'the wiki manifest is never dropped');
  const portraitNames = new Set(nyx.gallery.portraits.map((row) => row.name));
  assert.equal(new Set(nyx.gallery.portraits.map((row) => row.id)).size, nyx.gallery.portraits.length, 'portrait ids are unique');
  for (const name of ['Diligent Study', 'Vigorous Yapping', 'Provisional Head Priestess of the Asase Shrine', 'Ann & Mary-Ann']) {
    assert.equal(portraitNames.has(name), true, name);
  }
  // The roster is newest-first, so the front of it is exactly where the wiki
  // manifest lags — Odette had no portrait at all before the merge.
  for (const row of nyx.roster.slice(0, 12)) {
    assert.equal(portraitNames.has(row.name), true, `${row.name} has a portrait even before the wiki catches up`);
  }
  assert.equal(nyx.gallery.portraits.every((row) => row.art), true, 'every portrait has art');
  assert.equal(nyx.gallery.avatarFrames.length, Object.values(raw).filter((row) => row.material_type === 'MATERIAL_PROFILE_FRAME').length);
  assert.equal(nyx.gallery.splashArts.length, nyx.roster.length);
  assert.equal(nyx.gallery.splashArts.every((row) => row.art), true);
  assert.equal(nyx.furniture.blueprints.length, normalized.filter((row) => /Blueprint/i.test(row.type || '') && ['Furnishing Blueprint', 'Furnishing Blueprints', 'Furnishing Set Blueprint'].includes(row.type)).length);
  assert.equal(nyx.furniture.materials.every((row) => row.category === 'Material' && /\bfurniture\b|\bRealm Within\b/i.test(row.description || '')), true);
});

test('Genshin normal and Shadow Realm weapons expose ordered Lv.90 facts and cleaned R1 effects', () => {
  const gi = readNyxDatabase().games.gi;
  const weapons = gi.collections.find((row) => row.key === 'weapons').items;
  const shadowWeapons = gi.shadowRealm.items.filter((row) => row.kind === 'weapon');
  for (const row of [...weapons, ...shadowWeapons]) {
    assert.deepEqual(Object.keys(row.fields), ['rarity', 'type', 'baseAttack', 'subStat', 'weaponEffect'], row.name);
  }
  assert.equal(weapons.find((row) => row.name === 'Cool Steel').fields.subStat, 'ATK \u00b7 35.2%');
  assert.equal(weapons.find((row) => row.name === 'Dark Iron Sword').fields.subStat, 'Elemental Mastery \u00b7 141');
  assert.equal(weapons.find((row) => row.name === 'Dull Blade').fields.subStat, 'None');
  const coolSteelEffect = weapons.find((row) => row.name === 'Cool Steel').fields.weaponEffect;
  assert.match(coolSteelEffect, /^Bane of Water and Ice: /);
  assert.match(coolSteelEffect, /12%/);
  assert.doesNotMatch(coolSteelEffect, /<[^>]+>/);
  assert.equal(shadowWeapons.every((row) => row.fields.baseAttack === 'Unknown' && row.fields.subStat === 'Unknown'), true);
});

test('trusted exact-source Genshin backfill stays hashed after duplicate TCG variants leave Items', () => {
  const provenance = readJson('Database/Audits/database-art-backfill-provenance.json');
  const audit = readJson('Database/Audits/database-missing-art.json');
  const items = readGenerated('gi').collections.find((collection) => collection.key === 'items').items;
  const backfilled = items.filter((row) => row.artStatus === 'trusted-exact-source-icon');
  const destinations = new Set();
  const sourceIcons = new Set();

  assert.equal(provenance.assetCount, provenance.assets.length);
  assert.equal(provenance.resolvedRecordCount, 235);
  assert.equal(provenance.assetCount, 221);
  for (const asset of provenance.assets) {
    assert.match(asset.localDestination, /^GameData\/gi\/assets\/items\/[^/]+\.webp$/);
    assert.equal(destinations.has(asset.localDestination), false, asset.localDestination);
    destinations.add(asset.localDestination);
    sourceIcons.add(asset.sourceIcon);
    const bytes = fs.readFileSync(path.resolve(root, 'Database', asset.localDestination));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), asset.outputSha256);
    assert.equal(bytes.length, asset.outputBytes);
    assert.ok(asset.provider);
    assert.ok(asset.sourceUrl);
  }
  assert.equal(backfilled.length, 0, 'the backfilled Golden and Platinum duplicates now live only under TCG');
  assert.equal(audit.records.some((row) => sourceIcons.has(row.sourceIconField?.value)), false);
});
