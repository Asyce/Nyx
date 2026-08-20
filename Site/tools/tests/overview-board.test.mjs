// The game Overview board (user layout, 2026-08-08): five banner columns on
// top, then the events grid with Timers and Redemption Codes as their own
// columns. Covers both the shipped banner data and the page structure.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const appSource = await readFile(path.resolve(root, 'src/app/nyx-app.jsx'), 'utf8');
const sharedCss = await readFile(path.resolve(root, 'src/styles/game-page-shared.css'), 'utf8');
const generator = await readFile(path.resolve(root, 'tools/generate-site-data.mjs'), 'utf8');

const sandbox = { window:{} };
vm.createContext(sandbox);
vm.runInContext(await readFile(path.resolve(root, 'src/data/generated/nyx-data.js'), 'utf8'), sandbox);
const banners = sandbox.window.NYX_DB?.banners?.games || {};
const GAMES = ['gi', 'hsr', 'zzz', 'wuwa', 'ae'];
const phases = (group) => [group?.current, group?.next, ...(group?.upcoming || [])].filter(Boolean);

function sourceFunction(name) {
  const from = appSource.indexOf(`function ${name}`);
  assert.ok(from >= 0, `${name} not found`);
  const open = appSource.indexOf('{', from);
  let depth = 0;
  for (let index = open; index < appSource.length; index += 1) {
    if (appSource[index] === '{') depth += 1;
    else if (appSource[index] === '}' && --depth === 0) return appSource.slice(from, index + 1);
  }
  throw new Error(`${name} is incomplete`);
}

// Same idea for the object literals the board helpers close over
// (the roadmap denylist and the pinned "copium" names).
function sourceConst(name) {
  const from = appSource.indexOf(`const ${name} = {`);
  assert.ok(from >= 0, `${name} not found`);
  const open = appSource.indexOf('{', from);
  let depth = 0;
  for (let index = open; index < appSource.length; index += 1) {
    if (appSource[index] === '{') depth += 1;
    else if (appSource[index] === '}' && --depth === 0) return `${appSource.slice(from, index + 1)};`;
  }
  throw new Error(`${name} is incomplete`);
}

test('the Genshin plan and bottom pin order stay explicit', () => {
  const box = { window:{} };
  vm.createContext(box);
  vm.runInContext(`${sourceConst('BANNER_PLAN_LABELS')} ${sourceConst('BANNER_COPIUM_PINS')} window.values = { labels:BANNER_PLAN_LABELS.gi, pins:BANNER_COPIUM_PINS.gi };`, box);
  assert.deepEqual(JSON.parse(JSON.stringify(box.window.values)), {
    labels:{ vesna:'7.1 Phase 1', vodyanitsa:'7.1 Phase 2' },
    pins:['Alice', 'Dainsleif'],
  });
  assert.match(appSource, /label:row\.column\?\.label \|\| BANNER_PLAN_LABELS\[cfg\.key\]/);
  assert.match(sharedCss, /\.gp-ovb-pins\{[^}]*flex-direction:row/);
  assert.match(sharedCss, /\.gp-ovb-pins > \.gp-ovb-row\{[^}]*flex:1 1 0;[^}]*min-width:0/);
});

test('the banner list owns its wheel scrolling', () => {
  assert.match(sharedCss, /\.gp-ovb-scroll\{[^}]*overscroll-behavior:contain/);
  assert.match(appSource, /const bannerList = target\?\.closest\('\.gp-ovb-scroll'\);\s*if \(bannerList\) \{\s*event\.preventDefault\(\);\s*bannerList\.scrollBy/);
  const wheelHandler = appSource.slice(appSource.indexOf('const onWheel ='), appSource.indexOf("window.addEventListener('wheel'"));
  assert.ok(wheelHandler.indexOf('const bannerList') < wheelHandler.indexOf('Math.abs(event.deltaY) < 1'));
});

test('every shipped banner character carries a debut verdict', () => {
  const games = Object.keys(banners);
  assert.ok(games.length >= 4, `expected banner data for most games, got ${games.join(',') || 'none'}`);
  for (const [key, group] of Object.entries(banners)) {
    for (const phase of phases(group)) {
      for (const character of phase.characters || []) {
        assert.equal(typeof character.debut, 'boolean', `${key}: ${character.name} has no debut verdict`);
      }
    }
  }
});

test('a phase never ships a date centuries out', () => {
  // A community page once published "2206-09-01" for a Genshin phase end; the
  // generator clamps anything past a three-year horizon to null.
  const horizon = Date.now() + 4 * 365 * 24 * 60 * 60 * 1000;
  for (const [key, group] of Object.entries(banners)) {
    for (const phase of phases(group)) {
      for (const field of ['start', 'end']) {
        if (!phase[field]) continue;
        const at = Date.parse(phase[field]);
        assert.ok(Number.isFinite(at), `${key}: unparseable ${field} ${phase[field]}`);
        assert.ok(at < horizon, `${key}: ${field} ${phase[field]} is beyond the horizon`);
      }
    }
  }
  assert.match(generator, /BANNER_HORIZON_MS/);
  assert.match(generator, /plausibleBannerDate/);
});

test('what is live comes from the official history, not the community scrape', () => {
  // The scrape lags on the running phase (2026-08-08: it still listed Genshin
  // 6.7 Phase 1 while Phase 2 was live), so the official feed wins for current.
  assert.match(generator, /function officialPhases/);
  assert.match(generator, /const current = keepLabel\(official\.current, scrapedCurrent\)/);
  // Every region is examined, not just the first. They end hours apart, so
  // stopping at one (Asia) dropped a banner still running in Europe and fell
  // the whole game back to the community scrape.
  assert.match(generator, /if \(!running \|\| end > running\.end\) running =/);
  // The community feed repeats a phase inside its own upcoming list; those
  // repeats must not become extra "later" phases.
  assert.match(generator, /const alreadyShown = new Set/);
  // Next comes from official history too — it is the only source that lists the
  // featured 4-stars (Alyosha on both Genshin 7.0 Phase 1 banners).
  assert.match(generator, /const next = keepLabel\(official\.next, scrapedNext\)/);
  // Deliberately no assertion that the shipped current phase is still running:
  // the payload is rebuilt on a schedule, so between a phase rollover and the
  // next refresh it is legitimately behind. Asserting freshness here would fail
  // the build at every phase boundary.
});

test('the board splits each phase into a headline banner and the rest', () => {
  assert.match(appSource, /function bannerBoardColumn/);
  assert.match(appSource, /function overviewBannerBoard/);
  // Debut headlines the phase; with no debut the most recently added character
  // takes the slot. Only Endfield keeps paired headline cards.
  assert.match(appSource, /function bannerUnitRecency/);
  assert.match(appSource, /const ranked = \[\.\.\.units\]\.sort\(bannerUnitRecency\)/);
  assert.match(appSource, /cfg\.key === 'ae' && units\.length === 2 \? ranked\.slice\(0, 2\) : ranked\.slice\(0, 1\)/);
  assert.match(appSource, /column\.others\.map/);
  // Lower-rarity featured units are omitted; Endfield alone keeps its 50/50
  // loss pool on the headline card.
  assert.match(appSource, /cfg\.key === 'ae' \? ranked\.filter/);
  assert.doesNotMatch(appSource, /function BannerBoardRail/);
  assert.doesNotMatch(sharedCss, /\.gp-ovb-rank-rail/);
  assert.match(appSource, /others:cfg\.key === 'ae' \? column\.support : \[\]/);
  assert.match(appSource, /support:cfg\.key === 'ae'[\s\S]*?: \[\]/);
});

test('the overview renders five banner columns and folds the old rail into the grid', () => {
  // Five columns, and the captions under them were removed 2026-08-08.
  assert.equal((appSource.match(/<BannerBoardColumn/g) || []).length, 9);
  assert.match(appSource, /if \(!lossPool\) \{[\s\S]*?board\.planned\[0\][\s\S]*?board\.planned\[1\][\s\S]*?'Announced'/);
  assert.doesNotMatch(appSource, /gp-ovb-caption/);
  assert.doesNotMatch(appSource, /New Character Banner/);
  assert.match(appSource, /<OverviewBannerBoard cfg=\{cfg\}/);
  assert.match(appSource, /gp-ov-timers[\s\S]{0,120}<ResetTimersPanel gameKey=\{cfg\.key\}/);
  assert.match(appSource, /gp-ov-codes[\s\S]{0,400}<CodesPanel/);
  assert.match(appSource, /gp-ov-region[\s\S]{0,120}<TimePreferenceControl gameKey=\{cfg\.key\}/);
  // 2026-08-09: the right-hand rail is gone everywhere — the hub's Banners tab
  // now holds five per-game columns and codes moved to their own tab.
  assert.doesNotMatch(appSource, /<OverviewAside/);
  assert.match(appSource, /<NyxBannerColumns onOpenMaterial=\{onOpenMaterial\}/);
  assert.match(appSource, /function NyxBannerColumn\(\{ cfg, onOpenMaterial, now \}\)/);
  // The hub lists headline units only, each group stamped with its own window.
  assert.match(appSource, /const units = \[\.\.\.column\.heroes, \.\.\.column\.others\]/);
  assert.match(appSource, /className="nyx-ban-phase-when"/);
});

test('the grid reflows instead of overflowing on narrow screens', () => {
  // Columns 1-4 are equal width so a phase's two headline cards match and
  // nothing squashes; column 5 is the narrower "later" list.
  assert.match(sharedCss, /\.gp-ovb\{[\s\S]*?grid-template-columns:repeat\(4, minmax\(0, 1fr\)\) minmax\(0, 0\.82fr\)/);
  assert.match(sharedCss, /\.gp-ov-lower\{[\s\S]*?grid-template-columns:repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(sharedCss, /@media \(max-width:1500px\)\{[\s\S]*?\.gp-ovb\{ grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(sharedCss, /@media \(max-width:900px\)\{[\s\S]*?grid-template-columns:minmax\(0, 1fr\)/);
});

test("Endfield's off-banner characters are labelled as the 50/50 loss pool", () => {
  // Losing the 50/50 in Endfield gives one of the previous banner characters,
  // so those names are a loss pool, not banners running alongside.
  assert.match(appSource, /const lossPool = cfg\.key === 'ae'/);
  // The pool now sits on the headline card, labelled there...
  assert.match(appSource, /supportLabel:cfg\.key === 'ae' \? 'Available on loss' : null/);
  // The "?" opens a self-hosted copy of the rate table — never a hotlink.
  assert.match(appSource, /assets\/info\/endfield-loss-rates\.webp/);
  assert.doesNotMatch(appSource, /cdn\.prydwen\.gg/);
  // Endfield fills columns 2-4 with what is coming and drops the fifth.
  assert.match(appSource, /const aeUpcoming = lossPool \? laterUnits\.slice\(0, 3\) : \[\]/);
  assert.match(appSource, /if \(!lossPool\) \{/);
  assert.match(appSource, /const aeColumn = \(index\)/);
  assert.match(sharedCss, /\.gp-oban-supports-label\{/);
  assert.match(sharedCss, /\.gp-ovb-note\{/);
});

test('every banner column is the same height with its caption on one baseline', () => {
  // heading / body / caption, with the body absorbing the slack.
  assert.match(sharedCss, /\.gp-ovb-col\{[\s\S]*?grid-template-rows:auto minmax\(0, 1fr\) auto/);
  assert.match(sharedCss, /\.gp-ovb\{[\s\S]*?align-items:stretch/);
  // The headline card must stretch too, or its countdown rides up under the name.
  assert.match(sharedCss, /\.gp-ovb-body > \.gp-oban\{[\s\S]*?display:flex; flex-direction:column/);
  assert.match(sharedCss, /\.gp-ovb-body > \.gp-oban \.gp-oban-body\{ flex:1 1 auto/);
});

test('the headline card leads with the character, not the namecard strip', () => {
  assert.match(appSource, /const splash = ch\.art \|\| match\?\.art \|\| ch\.namecard/);
  assert.match(appSource, /artPool:\[hero\.splash\]\.filter\(Boolean\)/);
  // The column heading names the phase, so the card must not repeat it.
  assert.match(appSource, /phase:null,/);
});

test('the events strip is a grid on the board, not a sideways-scrolling row', () => {
  assert.match(sharedCss, /\.gp-event-grid\{[\s\S]*?grid-template-columns:repeat\(3, minmax\(0, 1fr\)\)/);
});

test('every game key the site knows about is represented in the banner payload', () => {
  const missing = GAMES.filter((key) => !banners[key]);
  assert.deepEqual(missing, [], `banner data missing for ${missing.join(', ')}`);
});

test('the achievements tab survives the multi-game registry not being bundled', () => {
  // achievement-games.js ships with the launcher work and is not in the bundle
  // yet. Gating the tab on it alone made the tab vanish live and broke the
  // /<game>/achievements route — so the gate falls back to the two games that
  // already had a tracker.
  const from = appSource.indexOf('function achievementsSupported');
  assert.ok(from > 0, 'achievementsSupported helper not found');
  const to = appSource.indexOf('\n}', from) + 2;
  const box = { window:{} };
  vm.createContext(box);
  vm.runInContext(appSource.slice(from, to) + ';window.supported = achievementsSupported;', box);
  const supported = box.window.supported;

  // No registry (today's live bundle): the known trackers still appear.
  assert.equal(supported('gi'), true);
  assert.equal(supported('hsr'), true);
  assert.equal(supported('zzz'), false);

  // Registry present: it decides, so new games light up without a code change.
  const withRegistry = { window:{ NyxAchievementGames:{ supportsTracker:(key) => key === 'zzz' } } };
  vm.createContext(withRegistry);
  vm.runInContext(appSource.slice(from, to) + ';window.supported = achievementsSupported;', withRegistry);
  assert.equal(withRegistry.window.supported('zzz'), true);
  assert.equal(withRegistry.window.supported('gi'), false);

  // Both the nav and the route table must use it, or they disagree.
  assert.match(appSource, /const hasAchievements = achievementsSupported\(cfg\.key\)/);
  assert.match(appSource, /if \(achievementsSupported\(key\)\) tabs\.push\('achievements'\)/);
});

test('the phase after next rolls into the following patch, never a third phase', () => {
  // A patch runs two phases, so "7.0 Phase 2" is followed by "7.1 Phase 1" —
  // and the minor version tops out at .8 before the major rolls over
  // (user 2026-08-08).
  const from = appSource.indexOf('const BANNER_PHASES_PER_PATCH');
  const to = appSource.indexOf('function bannerNextPhaseHeading');
  assert.ok(from > 0 && to > from, 'phase-label helpers not found');
  const box = { window:{} };
  vm.createContext(box);
  vm.runInContext(appSource.slice(from, to) + ';window.advance = bannerAdvancePhaseLabel;', box);
  const advance = box.window.advance;

  assert.equal(advance('7.0 Phase 1'), '7.0 Phase 2');
  assert.equal(advance('7.0 Phase 2'), '7.1 Phase 1');
  assert.equal(advance('7.8 Phase 2'), '8.0 Phase 1');
  assert.equal(advance('3.1 Phase 1'), '3.1 Phase 2');
  // A named version can count within its own patch, but the next version's
  // name is never guessed.
  assert.equal(advance('Luna VIII Phase 1'), 'Luna VIII Phase 2');
  assert.equal(advance('Luna VIII Phase 2'), null);
  assert.equal(advance('Luna VIII'), null);
  assert.equal(advance(''), null);
});

test('the shipped roadmap keeps the requested order and self-hosted art', () => {
  const expected = {
    gi:['Vesna', 'Vodyanitsa', 'Mitya', 'Valeriy', 'The Tsaritsa Anastasya Feodorovna Snezhnaya', 'Danica', 'Noy'],
    hsr:['Pearl', 'Nihilux'],
    zzz:['Claret', 'Roxy', 'Sunbringer', 'Phoenix', 'The Storyteller'],
    wuwa:['Jingran', 'Suoming', 'Hsin'],
  };
  for (const [key, names] of Object.entries(expected)) {
    const rows = banners[key]?.roadmap || [];
    assert.deepEqual(Array.from(rows.slice(0, names.length), (row) => row.name), names, `${key} roadmap order`);
    for (const row of rows.slice(0, names.length)) {
      assert.match(row.icon || row.art || '', /^(?:\.\.\/|\/)assets\//, `${key}: ${row.name} art must be self-hosted`);
    }
  }
  assert.match(appSource, /const trustedFuture = new Set/);
  const rowNameStart = sharedCss.indexOf('\n.gp-ovb-row b{');
  const rowNameCss = sharedCss.slice(rowNameStart, sharedCss.indexOf('}', rowNameStart) + 1);
  assert.match(rowNameCss, /white-space:nowrap/);
  assert.match(rowNameCss, /var\(--fit, 1\)/);
  assert.doesNotMatch(rowNameCss, /text-overflow:ellipsis/);
});

test('short overlap banners do not invent an extra phase', () => {
  const from = generator.indexOf('const BANNER_PHASE_GAP_MS');
  const to = generator.indexOf('function officialPhases');
  assert.ok(from > 0 && to > from, 'official phase grouping helper not found');
  const box = { window:{} };
  vm.createContext(box);
  vm.runInContext(generator.slice(from, to) + ';window.starts = bannerPhaseStarts;', box);
  const day = 24 * 60 * 60 * 1000;
  assert.deepEqual(Array.from(box.window.starts([0, 9 * day, 21 * day])), [0, 21 * day]);
});

test('the five-column model matches each requested game roadmap', () => {
  const phaseHelpers = appSource.slice(
    appSource.indexOf('const BANNER_PHASES_PER_PATCH'),
    appSource.indexOf('function bannerNextPhaseHeading'),
  );
  const box = { window:{}, groups:banners };
  vm.createContext(box);
  vm.runInContext(`
    function dbBannerGroup(key){ return groups[key]; }
    function rosterUnitMap(){ return new Map(); }
    ${sourceFunction('normalizeUnitName')}
    ${sourceFunction('bannerFeaturedRank')}
    ${sourceFunction('bannerRarityValue')}
    ${sourceFunction('bannerRarityLabel')}
    ${sourceFunction('dedupeByName')}
    ${sourceFunction('phaseUnit')}
    ${sourceFunction('bannerUnitRecency')}
    ${sourceFunction('bannerBoardColumn')}
    ${phaseHelpers}
    ${sourceFunction('bannerRoadmapVersion')}
    ${sourceFunction('bannerPlanLabelFromHint')}
    ${sourceFunction('bannerUnknownPhaseLabel')}
    ${sourceFunction('bannerApplyPlanLabels')}
    ${sourceConst('BANNER_ROADMAP_DENY')}
    ${sourceConst('BANNER_COPIUM_PINS')}
    ${sourceConst('BANNER_PLAN_LABELS')}
    ${sourceFunction('bannerRoadmapAllowed')}
    ${sourceFunction('overviewBannerPins')}
    ${sourceFunction('overviewBannerBoard')}
    window.board = (key) => overviewBannerBoard({ key });
    window.rank = bannerUnitRecency;
  `, box);
  const board = (key) => JSON.parse(JSON.stringify(box.window.board(key)));
  const names = (rows) => (rows || []).map((row) => row.name);

  const gi = board('gi');
  assert.deepEqual([gi.current.label, gi.next.label], ['7.0 Phase 1', '7.0 Phase 2']);
  assert.equal(gi.current.heroes[0].name, 'Odette');
  assert.deepEqual(names(gi.current.others), ['Arlecchino']);
  assert.equal(gi.next.heroes[0].name, 'Flins');
  assert.deepEqual(names(gi.next.others), ['Ineffa']);
  assert.deepEqual(gi.planned.map((column) => column.heroes[0].name), ['Vesna', 'Vodyanitsa']);
  assert.deepEqual(gi.planned.map((column) => column.label), ['7.1 Phase 1', '7.1 Phase 2']);
  assert.ok(gi.planned.every((column) => column.start === null && column.end === null));
  assert.deepEqual(names(gi.future).slice(0, 5), ['Mitya', 'Valeriy', 'The Tsaritsa Anastasya Feodorovna Snezhnaya', 'Danica', 'Noy']);

  const hsr = board('hsr');
  assert.deepEqual([hsr.current.label, hsr.next.label], ['4.4 Phase 2', '4.5 Phase 1']);
  assert.deepEqual(hsr.planned.map((column) => column.heroes[0].name), ['Aventurine • Waveflair', 'Pearl']);
  assert.deepEqual(hsr.planned.map((column) => column.label), ['4.5 Phase 2', '4.6 Phase 1']);
  assert.deepEqual(names(hsr.future), ['Nihilux']);

  const zzz = board('zzz');
  assert.deepEqual([zzz.current.label, zzz.next.label], ['3.1 Phase 1', '3.1 Phase 2']);
  assert.equal(zzz.next.heroes[0].name, 'Sigrid');
  assert.deepEqual(zzz.planned.map((column) => column.heroes[0].name), ['Claret', 'Roxy']);
  assert.deepEqual(names(zzz.future), ['Sunbringer', 'Phoenix', 'The Storyteller']);

  const wuwa = board('wuwa');
  assert.deepEqual([wuwa.current.label, wuwa.next.label], ['3.5 Phase 2', '3.6 Phase 1']);
  assert.equal(wuwa.next.heroes[0].name, 'Qingxiao');
  assert.deepEqual(wuwa.planned.map((column) => column.heroes[0].name), ['Jingran']);
  assert.deepEqual(wuwa.planned.map((column) => column.label), ['3.6 Phase 2']);
  assert.deepEqual(names(wuwa.future), ['Suoming', 'Hsin']);
  assert.deepEqual(names(wuwa.current.support), []);
});

test('banner art overrides survive automatic data regeneration', () => {
  const pearl = banners.hsr?.roadmap?.find((row) => row.name === 'Pearl');
  const qingxiao = phases(banners.wuwa).flatMap((phase) => phase.characters || []).find((row) => row.name === 'Qingxiao');
  assert.equal(pearl?.art, '/assets/banners/hsr/pearl-splash-3c9ede1f47fc14b1.png');
  assert.equal(qingxiao?.icon, '/assets/banners/wuwa/qingxiao-icon-4a0339409ff85cad.png');
});

test('story NPCs never reach Announced, and the copium pair is pinned separately', () => {
  // game8's roadmap page mixes long-teased story characters in with real
  // upcoming units. They used to slip past the approved-name gate (anything
  // flagged beta in the local gamedata was admitted) and filled the Announced
  // column with names nobody expects to be playable (user 2026-08-14).
  const box = { window:{}, groups:{
    gi:{
      current:{ phase:'7.0 Phase 1', characters:[{ name:'Odette' }], start:'2026-08-01T00:00:00Z', end:'2026-08-20T00:00:00Z' },
      next:{ phase:'7.0 Phase 2', characters:[{ name:'Flins' }], start:'2026-08-20T00:00:00Z', end:'2026-09-10T00:00:00Z' },
      upcoming:[],
      roadmap:[
        { name:'Mitya' }, { name:'Noy' },
        { name:'Pantalone' }, { name:'Rerir' }, { name:'Pulcinella' }, { name:'Pierro' },
        { name:'Dainsleif', image:'/assets/banners/genshin/dain.png' }, { name:'Alice' },
      ],
    },
  } };
  vm.createContext(box);
  vm.runInContext(`
    function dbBannerGroup(key){ return groups[key]; }
    function rosterUnitMap(){ return new Map(); }
    ${sourceFunction('normalizeUnitName')}
    ${sourceFunction('bannerFeaturedRank')}
    ${sourceFunction('bannerRarityValue')}
    ${sourceFunction('bannerRarityLabel')}
    ${sourceFunction('dedupeByName')}
    ${sourceFunction('phaseUnit')}
    ${sourceFunction('bannerUnitRecency')}
    ${sourceFunction('bannerBoardColumn')}
    ${appSource.slice(appSource.indexOf('const BANNER_PHASES_PER_PATCH'), appSource.indexOf('function bannerNextPhaseHeading'))}
    ${sourceFunction('bannerRoadmapVersion')}
    ${sourceFunction('bannerPlanLabelFromHint')}
    ${sourceFunction('bannerUnknownPhaseLabel')}
    ${sourceFunction('bannerApplyPlanLabels')}
    ${sourceConst('BANNER_ROADMAP_DENY')}
    ${sourceConst('BANNER_COPIUM_PINS')}
    ${sourceConst('BANNER_PLAN_LABELS')}
    ${sourceFunction('bannerRoadmapAllowed')}
    ${sourceFunction('overviewBannerPins')}
    ${sourceFunction('overviewBannerBoard')}
    window.board = overviewBannerBoard({ key:'gi' });
  `, box);
  const board = JSON.parse(JSON.stringify(box.window.board));
  const listed = [...board.future, ...board.planned.flatMap((column) => column.heroes)].map((row) => row.name);
  for (const denied of ['Pantalone', 'Rerir', 'Pulcinella', 'Pierro', 'Dainsleif', 'Alice']) {
    assert.equal(listed.includes(denied), false, `${denied} is not announced`);
  }
  assert.deepEqual(listed.filter((name) => ['Mitya', 'Noy'].includes(name)).sort(), ['Mitya', 'Noy'], 'real roadmap names survive');
  // The two the user keeps as a joke come back as a separate pinned list, so
  // the board can render them under the real entries with a "copium" note.
  assert.deepEqual(board.pinned.map((row) => row.name), ['Alice', 'Dainsleif']);
  // Other games have neither a denylist nor pins.
  assert.deepEqual(JSON.parse(JSON.stringify(box.window.board)).pinned.length, 2);
});
