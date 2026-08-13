import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const site = path.resolve(import.meta.dirname, '../..');
const generated = path.join(site, 'src/data/generated');
const read = (rel) => fs.readFile(path.join(site, rel), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

async function loadMaterialsShareCard(){
  const requirementCalls = [];
  const currencyCosts = [];
  const context = {
    URL,
    URLSearchParams,
    location:{ origin:'https://pengo.gg' },
    CM_TALENT_CFG:{
      gi:{ max:[10, 10, 10] },
      hsr:{ max:[6, 10, 10, 10] },
      zzz:{ max:[12, 12, 12, 12, 12, 6] },
    },
    CM_ELEM:{ fire:'#ff6655' },
    cmRouteSlug:(value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    cmRequirements:(gameKey, view, options) => {
      requirementCalls.push({ gameKey, options });
      return {
        ascCost:11,
        talentCost:22,
        weaponCost:33,
        ascension:[{ name:'Ascension', kind:'gem', qty:1 }],
        talents:[{ name:'Talent', kind:'book', qty:2 }],
      };
    },
    cmCurrencyMat:(cfg, cost) => {
      currencyCosts.push(cost);
      return cost === 0 ? null : { name:'Currency', kind:'currency', qty:cost };
    },
    cmReqItems:(items) => items.filter(Boolean),
    cmCombineReqItems:(...groups) => {
      const by = new Map();
      groups.flat().filter(Boolean).forEach((item) => {
        const key = item.id || item.name;
        const current = by.get(key);
        by.set(key, current ? { ...current, qty:Number(current.qty || 0) + Number(item.qty || 0) } : { ...item });
      });
      return [...by.values()];
    },
    cmMetaChips:() => [],
    cmMetaIconSrc:() => null,
    cmWeaponRowLabel:(gameKey) => gameKey === 'hsr' ? 'LIGHT CONE' : gameKey === 'zzz' ? 'W-ENGINE' : 'WEAPON',
  };
  vm.runInNewContext(`${await read('src/features/materials/char-materials-share-card.js')}
    this.shareCardApi = { nyxBuildMaterialsCardModel, nyxMaterialsCardFitWrappedText, nyxMaterialsCardUrl, nyxParseMaterialsCardSearch };`, context);
  return { ...context.shareCardApi, requirementCalls, currencyCosts };
}

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
  // 2026-08-09: tabs hug their own label instead of sharing one width — equal
  // 1fr columns made the active-tab underline far wider than the word.
  assert.match(css, /\.cm-tabs\{[^}]*display:inline-flex/, 'each tab sizes to its own label (2026-08-09)');
  assert.doesNotMatch(css, /\.cm-tabs\{[^}]*grid-auto-columns:1fr/);
});

// 2026-08-09: pinned favourites are icons, always, for every game including the
// hub. The Card/Icon toggle, the Hide/Show button, the 5-card limit and the
// "More favourites" overflow row are all gone.
test('pinned favourites are icon-only, with hover treatment and origin routing wired', async () => {
  const [app, materials, storage, css] = await Promise.all([
    read('src/app/nyx-app.jsx'), read('src/features/materials/char-materials.jsx'),
    read('src/shared/pinned-favourites.js'), read('src/styles/game-page-shared.css'),
  ]);
  assert.doesNotMatch(app, /gp-fav-modes|gp-fav-visibility|CurrentFavCard|gp-card-grid|gp-fav-overflow/);
  assert.doesNotMatch(storage, /nyxLoadFavouriteMode|nyxSaveFavouriteVisibility|NYX_FAVOURITE_CARD_LIMIT/);
  assert.doesNotMatch(css, /\.gp-fav-modes|\.gp-fav-visibility|\.gp-card-grid/);
  // The retired keys are swept so nobody is stuck in a mode that no longer exists.
  assert.match(storage, /nyx:pinned-favourites-mode:/);
  assert.match(storage, /nyx:pinned-favourites-visible:/);
  assert.match(storage, /function nyxForgetRetiredFavouriteSettings/);
  assert.match(app, /nyxForgetRetiredFavouriteSettings\(/);
  assert.match(app, /<div className="gp-fav-icon-grid">/);
  assert.match(app, /from:cfg\.key === 'nyx' \? 'nyx' : 'characters'/);
  assert.match(app, /selection\.from === 'calendar' \|\| selection\.from === 'nyx'/);
  assert.match(materials, /selectedFrom === 'nyx' \? 'Back to Nyx'/);
  assert.match(css, /\.cm-favourite-star\{[^}]*opacity:0[^}]*pointer-events:none/);
  assert.doesNotMatch(css, /@media \(hover:none\), \(pointer:coarse\)[\s\S]{0,120}\.cm-favourite-star/);
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
  assert.equal(ae.roster.length, 30);
  // Liino shipped with an unfilled wiki page, so 29 of the 30 operators had
  // sourced requirements. That page is filled in now, so the whole roster is
  // covered and nothing is left unsourced (2026-08-11).
  assert.equal(growthSource.size, 30);
  assert.equal(progressionSource.size, 30);
  const missingSourcedRequirements = ae.roster
    .map((character) => character.n)
    .filter((name) => !growthSource.has(name) || !progressionSource.has(name));
  assert.deepEqual(plain(missingSourcedRequirements), []);
  assert.deepEqual([...growthGenerated].sort(), [...growthSource].sort());
  assert.deepEqual([...progressionGenerated].sort(), [...progressionSource].sort());

  const audit = ae.materialClassificationAudit;
  assert.equal(audit.classification, 'explicit-source-name-lists');
  assert.equal(audit.sourceCheckedAt, '2026-07-14');
  assert.equal(audit.rosterCount, 30);
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
  assert.match(materials, /gk === 'ae'[\s\S]*mid:'Growth Materials', boss:'Progression'/, 'boss tab reads Progression (2026-07-15 #8)');
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

test('materials share URLs round-trip unknown selections in deterministic order', async () => {
  const { nyxMaterialsCardUrl, nyxParseMaterialsCardSearch } = await loadMaterialsShareCard();
  const href = nyxMaterialsCardUrl({
    origin:'https://pengo.gg/ignored/path',
    gameKey:'gi',
    characterName:'Future Traveler',
    weaponId:'unknown weapon',
    variantKey:'future/form',
    gender:'unreleased-art',
    channel:'beta',
  });
  assert.equal(href, 'https://pengo.gg/genshin/characters/future-traveler?card=1&weapon=unknown+weapon&form=future%2Fform&gender=unreleased-art&channel=beta');
  assert.deepEqual(plain(nyxParseMaterialsCardSearch(href)), {
    weaponId:'unknown weapon',
    variantKey:'future/form',
    gender:'unreleased-art',
    channel:'beta',
  });
  assert.equal(nyxParseMaterialsCardSearch('?weapon=unknown&channel=beta'), null);
});

test('materials share models always use every game max, standard art, and a literal zero weapon cost', async () => {
  const { nyxBuildMaterialsCardModel, requirementCalls, currencyCosts } = await loadMaterialsShareCard();
  const expected = {
    gi:{ level:90, targets:[10, 10, 10] },
    hsr:{ level:80, targets:[6, 10, 10, 10] },
    zzz:{ level:60, targets:[12, 12, 12, 12, 12, 6] },
    wuwa:{ level:90, targets:null },
    ae:{ level:80, targets:null },
  };
  for (const [gameKey, max] of Object.entries(expected)) {
    const model = nyxBuildMaterialsCardModel({
      gameKey,
      view:{
        n:'Test Character',
        el:'fire',
        originalArt:'/standard-art.webp',
        art:'data:image/png;base64,local-custom-art',
        originalIcon:'/standard-icon.webp',
        icon:'data:image/png;base64,local-custom-icon',
      },
      cfg:{},
      activeWeapon:{ id:'zero-cost', name:'Zero Cost', cost:0, items:[] },
      midLabel:gameKey === 'ae' ? 'Growth Materials' : 'Talents',
    });
    assert.equal(model.maxLevel, max.level, gameKey + ' uses its character level cap');
    assert.deepEqual(plain(model.targets), max.targets, gameKey + ' uses its max talent targets');
    assert.equal(model.art, '/standard-art.webp');
    assert.equal(model.icon, '/standard-icon.webp');
  }
  assert.deepEqual(plain(requirementCalls.map((call) => call.options?.targets || null)), Object.values(expected).map((row) => row.targets));
  assert.deepEqual(currencyCosts.filter((_, index) => index % 3 === 2), [0, 0, 0, 0, 0], 'weapon cost 0 never falls back to the requirement cost');
});

test('materials share cards use Nyx purple and shrink names without ellipses', async () => {
  const { nyxBuildMaterialsCardModel, nyxMaterialsCardFitWrappedText } = await loadMaterialsShareCard();
  const model = nyxBuildMaterialsCardModel({
    gameKey:'gi',
    view:{ n:'Test Character', el:'fire', originalArt:'/standard-art.webp', originalIcon:'/standard-icon.webp' },
    cfg:{},
    activeWeapon:null,
    midLabel:'Talents',
  });
  assert.equal(model.accent, '#9f85ff');

  const ctx = {
    font:'',
    measureText(value){
      const size = Number(this.font.match(/(\d+)px/)?.[1] || 20);
      return { width:String(value).length * size * .55 };
    },
  };
  const name = 'Ethereal Crystalscale Stone';
  const fitted = nyxMaterialsCardFitWrappedText(ctx, name, 162, 2, 20, 'sans-serif');
  assert.ok(fitted.size < 20);
  assert.ok(fitted.lines.length <= 2);
  assert.equal(fitted.lines.join(' '), name);
  assert.equal(fitted.lines.some((line) => line.includes('…')), false);
});

test('materials share models include max-level EXP packs and leveling currency for every game', async () => {
  const { nyxBuildMaterialsCardModel, currencyCosts } = await loadMaterialsShareCard();
  const cases = [
    ['gi', 3, "Hero's Wit", 415, 1673411, 'Mystic Enhancement Ore', 398, 398840],
    ['gi', 4, "Hero's Wit", 415, 1673411, 'Mystic Enhancement Ore', 604, 604280],
    ['gi', 5, "Hero's Wit", 415, 1673411, 'Mystic Enhancement Ore', 906, 906480],
    ['hsr', 3, "Traveler's Guide", 287, 580111, 'Refined Aether', 97, 299750],
    ['hsr', 4, "Traveler's Guide", 287, 580111, 'Refined Aether', 130, 399250],
    ['hsr', 5, "Traveler's Guide", 287, 580111, 'Refined Aether', 162, 498500],
    ['zzz', 3, 'Senior Investigator Log', 300, 11, 'W-Engine Energy Module', 160, 0],
    ['zzz', 4, 'Senior Investigator Log', 300, 11, 'W-Engine Energy Module', 200, 0],
    ['wuwa', 3, 'Premium Resonance Potion', 121, 853311, 'Premium Energy Core', 68, 549600],
    ['wuwa', 4, 'Premium Resonance Potion', 121, 853311, 'Premium Energy Core', 114, 916000],
    ['wuwa', 5, 'Premium Resonance Potion', 121, 853311, 'Premium Energy Core', 134, 1077200],
    ['ae', 6, 'Advanced Combat Record', 74, 11, 'Arms INSP Set', 120, 0],
  ];
  const checkedIcons = new Set();
  for (const [gameKey, rarity, charName, charQty, charCurrency, weaponName, weaponQty, weaponCurrency] of cases) {
    const before = currencyCosts.length;
    const endfieldStage = (name, qty) => ({ items:[{ id:'ae:' + name, name, qty, kind:name === 'T-Creds' ? 'currency' : 'gem' }] });
    const model = nyxBuildMaterialsCardModel({
      gameKey,
      view:{
        n:'Test Character',
        el:'fire',
        originalArt:'/standard-art.webp',
        originalIcon:'/standard-icon.webp',
        req:gameKey === 'ae' ? { promotionStages:[
          endfieldStage('T-Creds', 1600),
          endfieldStage('T-Creds', 6500),
          endfieldStage('T-Creds', 18000),
          endfieldStage('Lv 90 promotion', 1),
        ] } : undefined,
      },
      cfg:{},
      activeWeapon:{
        id:'test-weapon',
        name:'Test Weapon',
        rarity,
        cost:0,
        items:[],
        tuningStages:gameKey === 'ae' ? [
          endfieldStage('T-Creds', 2200),
          endfieldStage('T-Creds', 8500),
          endfieldStage('T-Creds', 25000),
          endfieldStage('Lv 90 tuning', 1),
        ] : undefined,
      },
      midLabel:'Talents',
    });
    const ascension = model.rows.find((row) => row.key === 'ascension').items;
    const weapon = model.rows.find((row) => row.key === 'weapon').items;
    assert.equal(ascension.find((item) => item.name === charName)?.qty, charQty, `${gameKey}/${rarity} character EXP`);
    assert.equal(weapon.find((item) => item.name === weaponName)?.qty, weaponQty, `${gameKey}/${rarity} weapon EXP`);
    assert.deepEqual(currencyCosts.slice(before), [charCurrency, 22, weaponCurrency], `${gameKey}/${rarity} leveling currency is added once`);
    if (gameKey === 'ae') {
      assert.equal(ascension.find((item) => item.name === 'T-Creds')?.qty, 172540);
      assert.equal(weapon.find((item) => item.name === 'T-Creds')?.qty, 159550);
      assert.equal(ascension.some((item) => item.name === 'Lv 90 promotion'), false);
      assert.equal(weapon.some((item) => item.name === 'Lv 90 tuning'), false);
    }
    for (const item of [...ascension, ...weapon].filter((entry) => entry.kind === 'exp')) {
      if (checkedIcons.has(item.icon)) continue;
      checkedIcons.add(item.icon);
      assert.ok((await fs.stat(localAsset(item.icon))).size > 0, item.name + ' icon exists locally');
    }
  }
});

test('materials share gender is protagonist-only and genderless forms resolve from copied URLs', async () => {
  const materials = await read('src/features/materials/char-materials.jsx');
  const genderSource = materials.match(/function cmMaterialsShareGender\([\s\S]*?\n\}/)?.[0];
  const identitySource = materials.match(/function cmSharedIdentityGender\([\s\S]*?\n\}/)?.[0];
  const resolverSource = materials.match(/const sharedForms = Array\.isArray\(materialSel\?\.forms\)[\s\S]*?\n\s*: null;/)?.[0];
  assert.ok(genderSource && identitySource && resolverSource, 'shared gender generation and resolver logic exist');
  const context = { cmSanitizeIdentityPrefs:(prefs) => prefs };
  vm.runInNewContext(`${genderSource}; this.shareGender = cmMaterialsShareGender;`, context);
  const { nyxMaterialsCardUrl, nyxParseMaterialsCardSearch } = await loadMaterialsShareCard();
  for (const [gameKey, view, prefs] of [
    ['hsr', { id:'hsr-march-7th', baseName:'March 7th', gender:null }, { receptacle:'stelle' }],
    ['wuwa', { id:'wuwa-jiyan', baseName:'Jiyan', gender:null }, { rover:'female' }],
  ]) {
    const gender = context.shareGender(gameKey, view, prefs);
    const href = nyxMaterialsCardUrl({ origin:'https://pengo.gg', gameKey, characterName:view.baseName, gender, channel:'live' });
    assert.equal(gender, null, gameKey + ' ordinary character has no derived gender');
    assert.equal(new URL(href).searchParams.has('gender'), false, gameKey + ' ordinary URL omits gender');
  }

  const protagonists = [
    ['hsr', { id:'hsr-trailblazer-fire', baseName:'Trailblazer', gender:null }, { receptacle:'caelus' }, 'male', { id:'hsr-trailblazer', baseName:'Trailblazer' }],
    ['hsr', { id:'hsr-trailblazer-fire', baseName:'Trailblazer', gender:null }, { receptacle:'stelle' }, 'female', { id:'hsr-trailblazer', baseName:'Trailblazer' }],
    ['hsr', { id:'hsr-trailblazer-fire', baseName:'Trailblazer', gender:null }, { receptacle:'pom_pom' }, 'male', { id:'hsr-trailblazer', baseName:'Trailblazer' }],
    ['hsr', { id:'hsr-trailblazer-fire', baseName:'Trailblazer', gender:null }, { receptacle:'gepard' }, 'male', { id:'hsr-trailblazer', baseName:'Trailblazer' }],
    ['hsr', { id:'hsr-trailblazer-fire', baseName:'Trailblazer', gender:null }, { receptacle:'trash' }, 'male', { id:'hsr-trailblazer', baseName:'Trailblazer' }],
    ['wuwa', { id:'ww-rover-spectro', baseName:'Rover', gender:null }, { rover:'male' }, 'male', { id:'wuwa-rover', baseName:'Rover' }],
    ['wuwa', { id:'ww-rover-spectro', baseName:'Rover', gender:null }, { rover:'female' }, 'female', { id:'wuwa-rover', baseName:'Rover' }],
    ['wuwa', { id:'ww-rover-spectro', baseName:'Rover', gender:null }, { rover:'abby' }, 'male', { id:'wuwa-rover', baseName:'Rover' }],
  ];
  for (const [gameKey, view, prefs, expected, root] of protagonists) {
    const gender = context.shareGender(gameKey, view, prefs);
    const href = nyxMaterialsCardUrl({ origin:'https://pengo.gg', gameKey, characterName:view.baseName, variantKey:'physical', gender, channel:'live' });
    const sharedCard = nyxParseMaterialsCardSearch(href);
    assert.equal(sharedCard.gender, expected, `${gameKey}/${Object.values(prefs)[0]} is encoded as ${expected}`);
    const resolverContext = {
      gk:gameKey,
      materialSel:{ ...root, forms:[{ id:'genderless-form', variantKey:'physical', gender:null }] },
      sharedCard,
      sharedVariantProvided:true,
      sharedGenderProvided:true,
      sharedVariantKey:sharedCard.variantKey,
      sharedGenderKey:sharedCard.gender,
    };
    vm.runInNewContext(`${identitySource}\n${resolverSource}\nthis.resolved = sharedForm;`, resolverContext);
    assert.equal(resolverContext.resolved?.id, 'genderless-form', gameKey + ' identity gender accepts a genderless protagonist form');
  }
});

test('materials share cards stay stateless, bundle-local, and wired through the character route', async () => {
  const [shareCard, materials, app, build, css] = await Promise.all([
    read('src/features/materials/char-materials-share-card.js'),
    read('src/features/materials/char-materials.jsx'),
    read('src/app/nyx-app.jsx'),
    read('tools/build-site.mjs'),
    read('src/styles/game-page-shared.css'),
  ]);
  assert.match(shareCard, /const NYX_MATERIALS_CARD_WIDTH = 2000;/);
  assert.doesNotMatch(shareCard, /devicePixelRatio|\bfetch\s*\(|\bClipboardItem\b|cmMatSourceDetails|weeklyBosses|Object\.assign\(window|window\.nyx/i);
  const materialsEntry = build.indexOf("'features/materials/char-materials.jsx'");
  const shareEntry = build.indexOf("'features/materials/char-materials-share-card.js'");
  const appEntry = build.indexOf("'app/nyx-app.jsx'");
  assert.ok(materialsEntry >= 0 && materialsEntry < shareEntry && shareEntry < appEntry, 'share helpers load after materials helpers and before their route consumers');
  assert.match(materials, /function CMMaterialsShareCard\(/);
  assert.match(materials, />Copy share link<\/button>/);
  assert.match(materials, /navigator\.clipboard\.writeText\(shareUrl\)/);
  assert.match(materials, /window\.prompt\('Copy this share link:', shareUrl\)/);
  assert.match(materials, /const img = new Image\(\);\s*img\.decoding = 'async';\s*img\.crossOrigin = 'anonymous';[\s\S]*?img\.src = cmSpriteCorsUrl\(sprite\);/, 'ZZZ sprite frames request CORS access before loading');
  assert.match(materials, /const cmSpriteCorsUrl = .*cors=1/, 'ZZZ sprites bypass legacy non-CORS cache entries');
  assert.match(materials, /<img src=\{cmSpriteCorsUrl\(icon\)\} crossOrigin="anonymous"/, 'ZZZ sprite fallback uses the same CORS cache mode');
  assert.match(materials, /<div className="cm-share-preview"/);
  assert.match(materials, /<FitText as="span" className="nm" text=\{m\.name\} multiline \/>/);
  assert.match(materials, /<FitText as="span" className="lbl" text=\{name\} multiline \/>/);
  assert.doesNotMatch(shareCard, /fillRect\(0, 0, NYX_MATERIALS_CARD_WIDTH, 6\)/);
  assert.match(materials, /function cmApplySharedIdentityDisplay\(gameKey, ch, prefs, sharedCard\)/);
  assert.match(materials, /const prefKey = \{ gi:'twin', hsr:'receptacle', wuwa:'rover', ae:'endmin' \}\[gameKey\][\s\S]*gi:\{ male:'aether', female:'lumine' \}[\s\S]*hsr:\{ male:'caelus', female:'stelle' \}[\s\S]*wuwa:\{ male:'male', female:'female' \}[\s\S]*ae:\{ male:'male', female:'female' \}/);
  assert.match(materials, /\.filter\(\(ch\) => !!sharedCard \|\| cmSpecialUnitVisible\(activeGame, ch, unitPrefs\)\)/);
  assert.match(materials, /\.filter\(\(ch\) => cmSpecialUnitVisible\(gk, ch, unitPrefs\)\)/);
  assert.match(materials, /characterName:sel\?\.baseName \|\| sel\?\.rawName \|\| sel\?\.n/);
  assert.match(materials, /gender:cmMaterialsShareGender\(gk, view, identityPrefs\)/);
  assert.match(materials, /else if \(!sharedCard && cfg && sel\) \{\s*setSel\(null\);\s*setActiveVariant\(null\);\s*setActiveGender\(null\);\s*if \(onSelectedClose\) onSelectedClose\(\);\s*\}[\s\S]*?\[selectedName, game, gk, effectiveChannel, sharedCard,/);
  assert.doesNotMatch(materials, /nyxBuildMaterialsCardModel\(input\)/);
  assert.match(app, /character \? nyxParseMaterialsCardSearch\(location\.search\) : null/);
  assert.match(app, /shareCard:initialRoute\.shareCard/);
  assert.match(app, /\['card', 'weapon', 'form', 'gender', 'channel'\]\.forEach/);
  assert.match(app, /!isNyx && !\(materialSelection\?\.game === activeKey && materialSelection\.shareCard\) && <NyxChannelToggle gameKey=\{activeKey\} \/>/);
  assert.match(css, /\.cm-share-preview\{/);
});
