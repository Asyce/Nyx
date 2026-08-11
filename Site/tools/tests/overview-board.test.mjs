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
  // takes the slot; two characters means two headline cards.
  assert.match(appSource, /left\.unit\.debut !== right\.unit\.debut/);
  assert.match(appSource, /row\.unit\.debutAt \|\| ''/);
  assert.match(appSource, /units\.length === 2 \? ranked\.slice\(0, 2\) : ranked\.slice\(0, 1\)/);
  // Featured lower-rarity units ride along on the headline card — except in
  // Endfield, where that slot carries the 50/50 loss pool instead.
  assert.match(appSource, /all\.filter\(\(unit\) => unit\.rarity && unit\.rarity < rank\)/);
  assert.match(appSource, /cfg\.key === 'ae' \? ranked\.filter/);
  // ZZZ shows no lower-rarity row at all.
  assert.match(appSource, /support:cfg\.key === 'zzz' \? \[\]/);
  // Both headline cards in a phase list them, so the row stays uniform.
  assert.match(appSource, /others:column\.support,/);
});

test('the overview renders five banner columns and folds the old rail into the grid', () => {
  // Five columns, and the captions under them were removed 2026-08-08.
  assert.equal((appSource.match(/<BannerBoardColumn/g) || []).length, 5);
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
  assert.match(appSource, /\{!lossPool && \(/);
  // ...so the neighbouring column must not repeat the same names.
  assert.match(appSource, /if \(!lossPool && column && column\.others\.length\)/);
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
