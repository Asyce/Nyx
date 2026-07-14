import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const site = path.resolve(import.meta.dirname, '../..');
const generated = path.join(site, 'src/data/generated');
const read = (rel) => fs.readFile(path.join(site, rel), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

async function loadGenerated(file, key, beta = false){
  const window = { CM_CFG:{}, CM_CFG_BETA:{}, dispatchEvent(){} };
  vm.runInNewContext(await fs.readFile(path.join(generated, file), 'utf8'), {
    window,
    CustomEvent:class CustomEvent { constructor(type, init){ this.type = type; this.detail = init?.detail; } },
  });
  return beta ? window.CM_CFG_BETA[key] : window.CM_CFG[key];
}

const localAsset = (ref) => String(ref).startsWith('../../Database/')
  ? path.resolve(site, '..', 'Database', String(ref).slice('../../Database/'.length))
  : path.resolve(site, ref);

test('Characters tabs share the shell control and pinned favourites stay on Roster', async () => {
  const [app, components, materials, css] = await Promise.all([
    read('src/app/nyx-app.jsx'),
    read('src/components/game-page-components.jsx'),
    read('src/features/materials/char-materials.jsx'),
    read('src/styles/game-page-shared.css'),
  ]);
  assert.match(components, /function GPSectionNavButton/);
  assert.ok((app.match(/<GPSectionNavButton/g) || []).length >= 6, 'game and Nyx shell navigation use the shared control');
  assert.match(materials, /<GPSectionNavButton key=\{t\.k\}/);
  assert.match(materials, /curTab === 'roster' && pinnedFavourites/);
  assert.doesNotMatch(materials, /cm-tab-orbit/);
  assert.ok(materials.indexOf('curTab === \'roster\' && pinnedFavourites') > materials.indexOf('<div className="cm-body">'), 'favourites scroll with the roster body');
  assert.match(materials, /<span className="cm-character-tabs">[\s\S]*className="cm-detail-back"[\s\S]*>Materials<\/button>/, 'Back sits beside Materials and Character Kit');
  assert.match(css, /\.cm-tabs\{[^}]*max-width:994px[^}]*repeat\(3,minmax\(0,326px\)\)/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*grid-template-columns:minmax\(0,326px\)/);
});

test('favourite visibility, hover treatment, compact Nyx cards, and origin routing are wired', async () => {
  const [app, materials, storage, css] = await Promise.all([
    read('src/app/nyx-app.jsx'), read('src/features/materials/char-materials.jsx'),
    read('src/shared/pinned-favourites.js'), read('src/styles/game-page-shared.css'),
  ]);
  assert.match(storage, /nyx:pinned-favourites-visible:/);
  assert.match(app, /nyxSaveFavouriteVisibility\(cfg\.key, !visible\)/);
  assert.match(app, /from:cfg\.key === 'nyx' \? 'nyx' : 'characters'/);
  assert.match(app, /selection\.from === 'calendar' \|\| selection\.from === 'nyx'/);
  assert.match(materials, /selectedFrom === 'nyx' \? 'Back to Nyx'/);
  assert.match(css, /\.cm-favourite-star\{[^}]*opacity:0[^}]*pointer-events:none/);
  assert.doesNotMatch(css, /@media \(hover:none\), \(pointer:coarse\)[\s\S]{0,120}\.cm-favourite-star/);
  assert.match(css, /\.gp-card-grid\.hub\{ grid-template-columns:repeat\(auto-fill,minmax\(132px,160px\)\)/);
  assert.doesNotMatch(app, /gp-fav-game|appGameIcon\(ch\.gameKey\)/);
});

test('ZZZ and WuWa overview groups show only the highest grade without losing calculation tiers', async () => {
  const [zzz, wuwa] = await Promise.all([
    loadGenerated('cm-data-zzz.js', 'zzz'), loadGenerated('cm-data-wuwa.js', 'wuwa'),
  ]);
  assert.ok(zzz.midGroups.length > 0 && zzz.midGroups.every((row) => row.mats.length === 1));
  assert.ok(zzz.midGroups.every((row) => /^Specialized\b/i.test(row.mats[0].name)), 'ZZZ overview uses Specialized chips');
  assert.ok(zzz.roster.some((ch) => (ch.req?.talents || []).filter((mat) => /\bChip\b/i.test(mat.name)).length >= 3), 'ZZZ calculations retain lower chip tiers');
  assert.ok(wuwa.midGroups.length > 0 && wuwa.midGroups.every((row) => row.mats.length === 1));
  assert.ok(wuwa.roster.some((ch) => (ch.req?.talents || []).filter((mat) => /^4302/.test(String(mat.id))).length >= 4), 'WuWa calculations retain all skill tiers');
});

test('WuWa weekly challenges are built from only the selected weekly material', async () => {
  const wuwa = await loadGenerated('cm-data-wuwa.js', 'wuwa');
  assert.ok(wuwa.weeklyBosses.length > 0, 'weekly challenge groups are no longer empty');
  const weekly = wuwa.roster.flatMap((ch) => (ch.req?.talents || []).filter((mat) => mat.kind === 'weekly'));
  assert.ok(weekly.length > 0);
  assert.ok(weekly.every((mat) => /^414/.test(String(mat.id))));
  assert.ok(wuwa.weeklyBosses.every((boss) => boss.drops.length === 1 && boss.drops[0].kind === 'weekly'));
});

test('Genshin weekly bosses keep exact drops, local boss art, chronology, and sourced character equality', async () => {
  const materials = await read('src/features/materials/char-materials.jsx');
  const helperSource = materials.match(/function cmKeepWeeklyDrop\([\s\S]*?\n\}/)?.[0];
  assert.ok(helperSource, 'weekly-drop visibility helper exists');
  const helperContext = {};
  vm.runInNewContext(`${helperSource}; this.keepWeeklyDrop = cmKeepWeeklyDrop;`, helperContext);
  assert.equal(helperContext.keepWeeklyDrop({ chars:[] }, [], false), true, 'unused sourced drops remain visible normally');
  assert.equal(helperContext.keepWeeklyDrop({ chars:[] }, [], true), false, 'unused sourced drops do not defeat an active search/filter');
  assert.equal(helperContext.keepWeeklyDrop({ chars:['A'] }, [], false), false, 'populated drops hide when no character is visible');
  assert.equal(helperContext.keepWeeklyDrop({ chars:['A'] }, [{}], true), true, 'matching populated drops remain visible');
  const gi = await loadGenerated('cm-data-gi.js', 'gi');
  const expected = [
    ['Exalted Master of the Heretical Path', ['113087', '113088', '113089']],
    ['The Doctor', ['113081', '113082', '113083']],
    ['The Game Before the Gate', ['113073', '113074', '113075']],
    ['Lord of Eroded Primal Fire', ['113068', '113069', '113070']],
    ['The Knave', ['113060', '113061', '113062']],
    ['All-Devouring Narwhal', ['113054', '113055', '113056']],
    ["Guardian of Apep's Oasis", ['113046', '113047', '113048']],
    ['Everlasting Lord of Arcane Wisdom', ['113041', '113042', '113043']],
    ['Magatsu Mitake Narukami no Mikoto', ['113032', '113033', '113034']],
    ['La Signora', ['113025', '113026', '113027']],
    ['Azhdaha', ['113017', '113018', '113019']],
    ['Childe', ['113013', '113014', '113015']],
    ['Andrius', ['113006', '113007', '113008']],
    ['Stormterror Dvalin', ['113003', '113004', '113005']],
  ];
  assert.equal(gi.weeklyBosses.length, 14);
  assert.deepEqual(plain(gi.weeklyBosses.map((boss) => boss.bossName)), expected.map(([name]) => name));
  assert.deepEqual(plain(gi.weeklyBosses.map((boss) => boss.releaseOrder)), Array.from({ length:14 }, (_, index) => 14 - index));
  assert.deepEqual(plain(gi.weeklyBosses.map((boss) => boss.drops.map((drop) => String(drop.id)))), expected.map(([, ids]) => ids));
  const drops = gi.weeklyBosses.flatMap((boss) => boss.drops);
  assert.equal(drops.length, 42);
  assert.equal(new Set(drops.map((drop) => String(drop.id))).size, 42);
  assert.match(materials, /\.filter\(\(row\) => cmKeepWeeklyDrop\(row\.drop, row\.chars, hasCharacterFilter\)\)/);
  for (const boss of gi.weeklyBosses) {
    assert.match(boss.art, /^\.\.\/\.\.\/Database\/GameData\/gi\/assets\/monsters\//, boss.bossName + ' uses boss art');
    assert.ok((await fs.stat(localAsset(boss.art))).size > 0, boss.bossName + ' boss art exists');
    assert.equal(boss.drops.length, 3);
    for (const drop of boss.drops) {
      assert.equal(drop.kind, 'weekly');
      assert.equal(new Set(drop.chars).size, drop.chars.length, `${boss.bossName}/${drop.name} has no duplicate character`);
      assert.ok((await fs.stat(localAsset(drop.icon))).size > 0, drop.name + ' icon exists');
    }
  }

  const azhdahaCrown = gi.weeklyBosses.find((boss) => boss.bossName === 'Azhdaha').drops.find((drop) => String(drop.id) === '113017');
  assert.equal(azhdahaCrown.name, "Dragon Lord's Crown");
  assert.deepEqual(plain(azhdahaCrown.chars.filter((name) => ['Eula', 'Yoimiya'].includes(name)).sort()), ['Eula', 'Yoimiya']);

  const exactDropIds = new Set(expected.flatMap(([, ids]) => ids));
  const sourcedCharacters = new Set();
  const travelerIds = new Set();
  for (const character of gi.roster) {
    const forms = character.forms?.length ? character.forms : [character];
    for (const form of forms) {
      const requirements = [
        ...(form.req?.talents || []),
        ...(form.req?.talentStages || []).flatMap((group) => (group || []).flatMap((stage) => stage?.items || [])),
      ];
      for (const mat of requirements) {
        const id = String(mat.id || '');
        if (!exactDropIds.has(id)) continue;
        sourcedCharacters.add(character.n);
        if (character.n === 'Traveler') travelerIds.add(id);
      }
    }
  }
  const generatedCharacters = new Set(drops.flatMap((drop) => drop.chars));
  const rosterCharacters = new Set(gi.roster.map((character) => character.n));
  assert.deepEqual([...sourcedCharacters].sort(), [...rosterCharacters].sort());
  assert.deepEqual([...generatedCharacters].sort(), [...sourcedCharacters].sort());
  assert.deepEqual([...travelerIds].sort(), ['113005', '113006', '113017', '113032', '113046']);
  assert.ok(!drops.some((drop) => String(drop.id) === '113063'), 'Pyro Traveler story reward is not a weekly boss drop');
});

test('Endfield material overview uses the exact sourced Growth and Progression lists', async () => {
  const ae = await loadGenerated('cm-data-ae.js', 'ae');
  const growthNames = ['Kalkodendra', 'Chrysodendra', 'Vitrodendra', 'Blighted Jadeleaf', 'False Aggela'];
  const progressionNames = ['D96 Steel Sample 4', 'Metadiastima Photoemission Tube', 'Quadrant Fitting Fluid', 'Tachyon Screening Lattice', 'Triphasic Nanoflake'];
  assert.deepEqual(plain(ae.tabs), { mid:'Growth Materials', boss:'Progression Materials' });
  assert.deepEqual(plain(ae.midGroups.map((group) => group.title)), growthNames);
  assert.deepEqual(plain(ae.bossGroups.map((group) => group.title)), progressionNames);
  assert.ok(ae.midGroups.every((group) => group.mats.length === 1));
  assert.ok(ae.bossGroups.every((group) => group.mats.length === 1));

  for (const group of [...ae.midGroups, ...ae.bossGroups]) {
    const mat = group.mats[0];
    assert.ok([4, 5].includes(Number(mat.rar)), group.title + ' keeps sourced 4/5-star rarity');
    assert.ok((await fs.stat(localAsset(mat.icon))).size > 0, group.title + ' icon exists');
  }

  const sourceCharacters = (names, fields) => new Set(ae.roster
    .filter((character) => fields.some((field) => (character.req?.[field] || []).some((mat) => names.includes(mat.name))))
    .map((character) => character.n));
  const growthSource = sourceCharacters(growthNames, ['talents']);
  const progressionSource = sourceCharacters(progressionNames, ['ascension', 'talents']);
  const growthGenerated = new Set(ae.midGroups.flatMap((group) => group.chars));
  const progressionGenerated = new Set(ae.bossGroups.flatMap((group) => group.chars));
  assert.equal(ae.roster.length, 28);
  assert.equal(growthSource.size, 28);
  assert.equal(progressionSource.size, 28);
  assert.deepEqual([...growthGenerated].sort(), [...growthSource].sort());
  assert.deepEqual([...progressionGenerated].sort(), [...progressionSource].sort());

  const audit = ae.materialClassificationAudit;
  assert.equal(audit.classification, 'explicit-source-name-lists');
  assert.equal(audit.sourceCheckedAt, '2026-07-14');
  assert.equal(audit.rosterCount, 28);
  assert.deepEqual(plain(audit.growth.materialNames), growthNames);
  assert.deepEqual(plain(audit.progression.materialNames), progressionNames);
  assert.deepEqual(plain(audit.growth.requirementFields), ['talents']);
  assert.deepEqual(plain(audit.progression.requirementFields), ['ascension', 'talents']);
  assert.deepEqual(plain(audit.growth.missing), []);
  assert.deepEqual(plain(audit.growth.extra), []);
  assert.deepEqual(plain(audit.progression.missing), []);
  assert.deepEqual(plain(audit.progression.extra), []);
  assert.deepEqual(plain(audit.growth.source), {
    url:'https://endfield.wiki.gg/wiki/Item/Rare_Materials',
    revisionId:50579,
    lastEditedAt:'2026-05-31T06:44:00Z',
  });
  assert.deepEqual(plain(audit.progression.source), {
    url:'https://endfield.wiki.gg/wiki/Item/Progression_Materials',
    revisionId:38938,
    lastEditedAt:'2026-03-05T17:09:57Z',
  });
  assert.ok(audit.unclassifiedRequirements.length > 0, 'other requirements remain available but are audited instead of inferred into a tab');
});

test('Endfield uses user-facing Growth and Progression tab labels without mutating generated data', async () => {
  const materials = await read('src/features/materials/char-materials.jsx');
  assert.match(materials, /gk === 'ae'[\s\S]*mid:'Growth Materials', boss:'Progression Materials'/);
  assert.match(materials, /label:displayTabs\.mid/);
  assert.match(materials, /label:displayTabs\.boss/);
});

test('released and announced ZZZ portraits are local, status-correct, and Mavuika has fallback protection', async () => {
  const [zzz, beta, materials] = await Promise.all([
    loadGenerated('cm-data-zzz.js', 'zzz'),
    loadGenerated('cm-data-zzz-beta.js', 'zzz', true),
    read('src/features/materials/char-materials.jsx'),
  ]);
  const pyrois = zzz.roster.find((ch) => ch.n === 'Pyrois');
  const sigrid = beta.roster.find((ch) => ch.n === 'Sigrid');
  assert.ok(pyrois && pyrois.portraitProvenance?.status === 'released');
  assert.ok(!zzz.roster.some((ch) => ch.n === 'Sigrid'), 'Sigrid is not moved to Live');
  assert.ok(sigrid && sigrid.portraitProvenance?.status === 'announced');
  for (const ch of [pyrois, sigrid]) assert.ok((await fs.stat(localAsset(ch.icon))).size > 0, ch.n + ' portrait exists locally');
  const mavuika = path.resolve(site, '../Database/GameData/gi/assets/characters/circles/UI_AvatarIcon_Mavuika_Circle.webp');
  assert.ok((await fs.stat(mavuika)).size > 0);
  assert.match(materials, /ch\.icon, ch\.originalIcon, ch\.circle, ch\.card, ch\.art/);
  assert.match(materials, /onError=\{\(\) => setSourceIndex/);
});
