import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(path.resolve(import.meta.dirname, '../../src/features/timeline/timeline-data.js'), 'utf8');
const viewSource = await readFile(path.resolve(import.meta.dirname, '../../src/features/timeline/timeline-view.jsx'), 'utf8');
const sharedCss = await readFile(path.resolve(import.meta.dirname, '../../src/styles/game-page-shared.css'), 'utf8');
const appSource = await readFile(path.resolve(import.meta.dirname, '../../src/app/nyx-app.jsx'), 'utf8');
const sandbox = { window:{} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const api = sandbox.window.NyxTimelineData;
const iso = (value) => new Date(value).toISOString();
const plain = (x) => JSON.parse(JSON.stringify(x));

const records = [
  { id:'char', game:'gi', bannerType:'character', name:'Aster', version:'1.0', confirmed:true,
    featured:[{ entityType:'character', name:'Aster', rarity:5, primary:true }], pairedBannerIds:['weapon'],
    windowsByRegion:{ america:{ start:'2026-01-01T05:00:00.000Z', end:'2026-01-15T05:00:00.000Z', timezone:'UTC-5' }, europe:{ start:'2026-01-01T04:00:00.000Z', end:'2026-01-15T04:00:00.000Z', timezone:'UTC+1' } } },
  { id:'weapon', game:'gi', bannerType:'weapon', name:'Aster weapon', confirmed:true,
    featured:[{ entityType:'weapon', name:'Starblade', rarity:5, primary:true }], pairedBannerIds:['char'],
    windowsByRegion:{ america:{ start:'2026-01-01T05:00:00.000Z', end:'2026-01-15T05:00:00.000Z' } } },
];

test('buildBlocks uses the selected region and merges paired weapons without a weapons lane', () => {
  const blocks = api.buildBlocks(records, 'america');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].primaryFive, 'Aster');
  assert.deepEqual(Array.from(blocks[0].weaponNames), ['Starblade']);
  assert.deepEqual(Array.from(blocks[0].signatureWeaponNames), ['Starblade']);
  assert.equal(iso(blocks[0].startMs), '2026-01-01T05:00:00.000Z');
  assert.equal(api.searchMatch(blocks[0], 'starblade').match, true);
});

test('missing selected-region data is visibly date-only, never masquerading as that server time', () => {
  const onlyEurope = [{ ...records[0], pairedBannerIds:[], windowsByRegion:{ europe:records[0].windowsByRegion.europe } }];
  const blocks = api.buildBlocks(onlyEurope, 'america');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].dateOnly, true);
  assert.equal(blocks[0].region, null);
  assert.equal(blocks[0].precise, false);
});

// ---- Sol finding #7: date-only records shown, permanent rows hidden ------

test('a record with only a record-level dateOnly window is rendered honestly (WuWa collab shape)', () => {
  const rec = { id:'wuwa:dream', game:'wuwa', bannerType:'character', name:'Dreaming Upon the Moon', version:'3.4',
    windowsByRegion:{},
    dateOnly:{ start:'2026-06-08', end:'2026-07-09', sourceUrl:'https://wutheringwaves.fandom.com/wiki/Dreaming_Upon_the_Moon/2026-06-08' },
    permanent:false, featured:[{ entityType:'character', name:'Lucy', rarity:5, primary:true }], pairedBannerIds:[] };
  const blocks = api.buildBlocks([rec], 'america');
  assert.equal(blocks.length, 1, 'date-only record is not dropped');
  assert.equal(blocks[0].dateOnly, true);
  assert.equal(blocks[0].precise, false);
  assert.equal(blocks[0].region, null, 'not attributed to the user server');
  assert.equal(blocks[0].primaryFive, 'Lucy');
  assert.equal(iso(blocks[0].startMs), '2026-06-08T00:00:00.000Z');
  assert.equal(iso(blocks[0].endMs), '2026-07-09T23:59:59.000Z');
});

test('permanent/novice banners are hidden from the time axis (GI Beginners\' Wish / Wanderlust)', () => {
  const perm = [
    { id:'gi:beginners', game:'gi', bannerType:'character', name:"Beginners' Wish", permanent:true,
      featured:[{ entityType:'character', name:'Noelle', rarity:4, primary:true }], pairedBannerIds:[],
      windowsByRegion:{ asia:{ start:'2020-09-28T02:00:00.000Z' } } },
    { id:'gi:wanderlust', game:'gi', bannerType:'mixed', name:'Wanderlust Invocation', permanent:true,
      featured:[{ entityType:'character', name:'Jean', rarity:5, primary:true }], pairedBannerIds:[],
      windowsByRegion:{ asia:{ start:'2020-09-28T02:00:00.000Z' } } },
  ];
  assert.equal(api.buildBlocks(perm, 'asia').length, 0, 'no invented finite "Expected" blocks for permanent rows');
});

// ---- Sol finding #8: ZZZ letter-rarity S must be the headline unit --------

test('ZZZ S-rank character becomes the primary/high-rarity unit (letter rarity)', () => {
  const zzz = { id:'zzz:mellow', game:'zzz', bannerType:'character', name:'Mellow Waveride', version:'1.0', confirmed:true,
    featured:[
      { entityType:'character', name:'Ellen Joe', rarity:'S', primary:true },
      { entityType:'character', name:'Anton Ivanov', rarity:'A', primary:false },
      { entityType:'character', name:'Soukaku', rarity:'A', primary:false },
    ], pairedBannerIds:[],
    windowsByRegion:{ asia:{ start:'2024-07-04T02:00:00.000Z', end:'2024-07-24T03:59:59.000Z', timezone:'UTC+8' } } };
  const block = plain(api.buildBlocks([zzz], 'asia'))[0];
  assert.equal(block.primaryFive, 'Ellen Joe', 'S-rank primary is the card headline, not the channel title');
  assert.deepEqual(block.fives.map((f) => f.name), ['Ellen Joe'], 'only S goes in the high-rarity bucket');
  assert.deepEqual(block.fours.map((f) => f.name), ['Anton Ivanov', 'Soukaku'], 'A-rank are the lower bucket');
  assert.equal(api.rarityRank('S'), 5);
  assert.equal(api.isHighRarity('S'), true);
  assert.equal(api.isHighRarity('A'), false);
  assert.equal(api.isHighRarity(6), true, 'Endfield 6-star still counts as high');
});

// ---- Sol finding #9: fixed calendar activities never predate the anchor ---

test('fixed-calendar expansion never generates occurrences before the anchor', () => {
  const abyss = { id:'gi-spiral-abyss', label:'Spiral Abyss', mode:'fixed',
    anchorStart:'2024-07-15T20:00:00.000Z', calendarDay:16, calendarMonths:1, durationToNext:true, resetHour:4,
    sourceUrl:'https://example.test/abyss', verifiedAt:'2024-07-15T00:00:00.000Z', timezoneMode:'server' };
  // A range entirely before the anchor yields zero occurrences (no 2022/2023 back-extrapolation).
  const before = api.expandActivity(abyss, Date.parse('2023-01-01'), Date.parse('2023-03-31'), 'america');
  assert.equal(before.length, 0, 'no occurrences invented before the source anchor');
  // A range straddling the anchor starts at/after the anchor.
  const straddle = api.expandActivity(abyss, Date.parse('2024-06-01'), Date.parse('2024-10-01'), 'america');
  assert.ok(straddle.length > 0);
  assert.ok(straddle[0].start >= Date.parse('2024-07-15T20:00:00.000Z'), 'first occurrence is at/after the anchor');
  assert.equal(iso(straddle[0].start), '2024-07-16T09:00:00.000Z', 'America anchor occurrence matches the scraper');
});

test('activities, share state, and viewport virtualization remain deterministic', () => {
  const def = { id:'cycle', label:'Cycle', mode:'fixed', anchorStart:'2026-01-01T00:00:00.000Z', intervalDays:7, durationDays:2, sourceUrl:'https://example.test/source' };
  const activity = api.expandActivity(def, Date.parse('2026-01-01'), Date.parse('2026-01-31'), 'america');
  assert.equal(activity.length, 5);
  assert.equal(activity[0].sourceUrl, 'https://example.test/source');
  const decoded = api.decodeHash(api.encodeHash({ centerMs:Date.parse('2026-01-10'), zoom:3 }));
  assert.equal(decoded.zoom, 3);
  assert.equal(decoded.centerMs, Date.parse('2026-01-10'));
  const visible = api.visibleBlocks([{ startMs:0, endMs:10 }, { startMs:9e9, endMs:9e9 + 1 }], 0, 1, 100, 0);
  assert.equal(visible.length, 1);
});

test('reset alignment follows the selected server, never the browser timezone', () => {
  const input = Date.parse('2026-07-11T12:30:00.000Z');
  assert.equal(iso(api.alignToServerReset(input, 'na')), '2026-07-11T09:00:00.000Z');
  assert.equal(iso(api.alignToServerReset(input, 'eu')), '2026-07-11T03:00:00.000Z');
  assert.equal(iso(api.alignToServerReset(input, 'asia')), '2026-07-10T20:00:00.000Z');
});

test('timeline hierarchy uses the published patch and phase boundaries without forcing six or three weeks', () => {
  const day = api.DAY_MS;
  const start = Date.parse('2026-01-05T09:00:00.000Z');
  const hierarchy = plain(api.scheduleHierarchy([
    { id:'a', version:'1.0', startMs:start, endMs:start + 17 * day, expected:false },
    { id:'b', version:'1.0', startMs:start + 17 * day, endMs:start + 35 * day, expected:false },
    { id:'c', version:'1.1', startMs:start + 35 * day, endMs:start + 84 * day, expected:true },
  ], 'gi', 'america'));
  assert.deepEqual(hierarchy.patches.map((row) => [row.label, row.startMs, row.endMs, row.expected]), [
    ['1.0', start, start + 35 * day, false],
    ['1.1', start + 35 * day, start + 84 * day, true],
  ]);
  assert.deepEqual(hierarchy.phases.map((row) => [row.patch, row.label, row.startMs, row.endMs]), [
    ['1.0', 'Phase 1', start, start + 17 * day],
    ['1.0', 'Phase 2', start + 17 * day, start + 35 * day],
    ['1.1', 'Phase 1', start + 35 * day, start + 84 * day],
  ]);
  assert.equal(hierarchy.reset.known, true);
  assert.equal(hierarchy.reset.source, 'https://www.hoyolab.com/article/321317');
  assert.ok(hierarchy.weeks.length >= 12, 'actual reset weeks cover the irregular 84-day span');
  assert.deepEqual(hierarchy.weeks.filter((row) => row.patch === '1.1').slice(0, 2).map((row) => row.label), ['Week 1', 'Week 2']);
  assert.equal(hierarchy.weeks.every((row) => row.endMs > row.startMs), true);
});

test('weekly reset bands are game-aware and say unknown instead of borrowing another game rule', () => {
  const start = Date.parse('2026-01-05T00:00:00.000Z');
  const block = [{ id:'x', version:'1.0', startMs:start, endMs:start + 14 * api.DAY_MS, timezone:'UTC+8' }];
  for (const game of ['gi', 'hsr', 'zzz']) {
    const hierarchy = plain(api.scheduleHierarchy(block, game, 'asia'));
    assert.equal(hierarchy.reset.known, true, game + ' has direct official weekly reset evidence');
    assert.equal(iso(hierarchy.weeks[0].resetStartMs).slice(11, 16), '20:00');
    assert.equal(hierarchy.weeks[0].partial, true, 'display is honestly clipped at the patch edge');
    assert.match(hierarchy.reset.source, /^https:\/\/www\.hoyolab\.com\/article\//);
  }
  for (const game of ['wuwa', 'ae']) {
    const hierarchy = plain(api.scheduleHierarchy(block, game, 'asia'));
    assert.equal(hierarchy.reset.known, false, game + ' must not borrow an unsourced Monday rule');
    assert.deepEqual(hierarchy.weeks, []);
    assert.match(hierarchy.reset.label, /unavailable/i);
  }
});

test('Endfield year labels are not presented as sourced patch boundaries', () => {
  const start = Date.parse('2026-01-05T00:00:00.000Z');
  const hierarchy = plain(api.scheduleHierarchy([{ id:'ae', version:'2026', startMs:start, endMs:start + 21 * api.DAY_MS }], 'ae', 'global'));
  assert.deepEqual(hierarchy.patches, []);
  assert.deepEqual(hierarchy.phases, []);
  assert.match(hierarchy.patchStatus, /unavailable/i);
});

test('character names split once at the first space for compact cards', () => {
  assert.deepEqual(plain(api.splitName('Mavuika')), ['Mavuika']);
  assert.deepEqual(plain(api.splitName('Ellen Joe')), ['Ellen', 'Joe']);
  assert.deepEqual(plain(api.splitName('Dreaming Upon the Moon')), ['Dreaming', 'Upon the Moon']);
});

test('all timeline surfaces use the shared Patch, Phase, Week hierarchy and bottom date ruler', () => {
  assert.match(viewSource, /function NyxTimelineBands/);
  assert.ok((viewSource.match(/<NyxTimelineBands/g) || []).length >= 4, 'per-game, GI, All Events, and All Banners share the hierarchy');
  assert.ok((viewSource.match(/<NyxBottomDateRuler/g) || []).length >= 4, 'dates are rendered at the bottom on every surface');
  assert.doesNotMatch(viewSource, /function NyxGenshinTimeRuler|function NyxTimeRuler/);
});

test('timeline roster lookup ignores punctuation differences in published unit names', () => {
  const resolverStart = viewSource.indexOf('function nyxTlRosterNameKey');
  const resolverEnd = viewSource.indexOf('// Wide splash/card art', resolverStart);
  assert.ok(resolverStart >= 0 && resolverEnd > resolverStart, 'timeline roster resolver is present');
  const context = {
    getCmRoster: () => [{
      n:'Yangyang Xuanling',
      icon:'../../Database/GameData/ww/assets/characters/icons/UIResources/Common/Image/IconRoleHead256/T_IconRoleHead256_70_UI.webp',
    }],
  };
  vm.createContext(context);
  vm.runInContext(`${viewSource.slice(resolverStart, resolverEnd)}\n;globalThis.__api={nyxTlRosterRow,nyxTlViewIcon};`, context);
  const icon = context.__api.nyxTlViewIcon('wuwa', 'Yangyang: Xuanling');
  assert.equal(icon, '../../Database/GameData/ww/assets/characters/icons/UIResources/Common/Image/IconRoleHead256/T_IconRoleHead256_70_UI.webp');
  assert.match(icon, /_70_UI\.webp$/);
});

test('timeline copy is compact and the old redundant labels are gone', () => {
  assert.match(viewSource, /Add to Personal/);
  assert.match(viewSource, />Display</);
  assert.match(viewSource, />Personal</);
  assert.doesNotMatch(viewSource, />Add marker<|>Layers<|My planning|Custom planning/);
  assert.doesNotMatch(viewSource, /<h1>All Games Timeline<|<h1>All Games Events<|<span className="eyebrow">Banner history/);
});

test('Stygian Onslaught is a non-modal activity block', () => {
  assert.doesNotMatch(viewSource, /ntl-gi-featured-activity/);
  const eventAxisAssignment = viewSource.match(/var eventAxisBlocks\s*=\s*[^;]+;/)?.[0] || '';
  assert.match(eventAxisAssignment, /eventSplit\.axis\.filter/);
  assert.match(eventAxisAssignment, /!nyxTlIsGenshinFeaturedActivity\(block\)/);
  assert.match(eventAxisAssignment, /isGenshin/);
});

test('activity Exact and Expected provenance survives expansion into visible blocks', () => {
  const rangeStart = Date.parse('2026-01-01T00:00:00.000Z');
  const rangeEnd = Date.parse('2026-02-01T00:00:00.000Z');
  const dated = api.expandActivity({
    id:'dated', label:'Dated', mode:'dated', windows:[
      { status:'expected', windowsByRegion:{ europe:{ start:'2026-01-02T03:00:00.000Z', end:'2026-01-09T03:00:00.000Z' } } },
      { status:'exact', windowsByRegion:{ europe:{ start:'2026-01-10T03:00:00.000Z', end:'2026-01-17T03:00:00.000Z' } } },
    ],
  }, rangeStart, rangeEnd, 'europe');
  assert.deepEqual(plain(dated.map((row) => [row.scheduleStatus, row.expected])), [['expected', true], ['exact', false]]);
  const forecast = api.expandActivity({ id:'fixed', label:'Fixed', mode:'fixed', anchorStart:'2026-01-05T03:00:00.000Z', intervalDays:7, durationDays:7 }, rangeStart, rangeEnd, 'europe');
  assert.ok(forecast.length > 0);
  assert.equal(forecast[0].scheduleStatus, 'expected');
  assert.equal(forecast[0].expected, true);
});

test('event scheduleStatus survives conversion and drives Expected UI styling and copy', () => {
  const block = plain(api.buildEventBlocks([{ id:'future', game:'gi', title:'Future event', type:'event', start:'2026-08-01T00:00:00.000Z', end:'2026-08-10T00:00:00.000Z', scheduleStatus:'expected', needs_review:false }], NOW))[0];
  assert.equal(block.scheduleStatus, 'expected');
  assert.equal(block.expected, true);
  assert.match(viewSource, /block\.expected \? 'Expected'/);
  assert.match(viewSource, /activity\.expected \? ' expected' : ''/);
});

test('Nyx mixed timelines render a distinct Week subtrack for each game schedule', () => {
  assert.match(viewSource, /schedules\.map\(function\(item, track\)[\s\S]*?item\.hierarchy\.weeks\.filter\(place\)/);
  assert.doesNotMatch(viewSource, /resetKnown\.hierarchy\.weeks/);
  assert.match(viewSource, /style=\{\{ top:track \* 22/);
});

test('adjacent Patch and Phase bands keep their exact date geometry', () => {
  const start = Date.parse('2026-07-01T00:00:00.000Z');
  const boundary = start + 6 * 60 * 60 * 1000;
  const msPerPx = api.DAY_MS;
  const center = boundary;
  for (const width of [390, 2560]) {
    const left = api.msToX(start, center, msPerPx, width);
    const nextLeft = api.msToX(boundary, center, msPerPx, width);
    const renderedWidth = Math.max(0, (boundary - start) / msPerPx);
    assert.equal(left + renderedWidth, nextLeft, width + 'px: a short band must end exactly where the next band starts');
  }
  assert.doesNotMatch(viewSource, /width:Math\.max\(34, \(row\.endMs - row\.startMs\) \/ msPerPx\)/);
  assert.match(viewSource, /width:Math\.max\(0, \(row\.endMs - row\.startMs\) \/ msPerPx\)/);
  assert.match(sharedCss, /\.ntl-schedule-band\{[^}]*min-width:0;/);
});

test('overlapping Patch and Phase intervals pack into non-overlapping subrows', () => {
  const day = api.DAY_MS;
  const start = Date.parse('2026-07-01T00:00:00.000Z');
  const packed = plain(api.packScheduleIntervals([
    { id:'hsr-phase-1', startMs:start, endMs:start + 32 * day },
    { id:'hsr-phase-2', startMs:start, endMs:start + 17 * day },
    { id:'hsr-phase-3', startMs:start + 17 * day, endMs:start + 33 * day },
    { id:'wuwa-phase-1', startMs:start + 42 * day, endMs:start + 68 * day },
    { id:'wuwa-phase-2', startMs:start + 67 * day, endMs:start + 87 * day },
  ]));
  assert.equal(packed.laneCount, 2);
  for (const viewportWidth of [390, 2560]) {
    const bySubrow = new Map();
    for (const row of packed.rows) {
      const rectangle = {
        left:api.msToX(row.startMs, start + 44 * day, api.MS_PER_PX, viewportWidth),
        width:(row.endMs - row.startMs) / api.MS_PER_PX,
      };
      if (!bySubrow.has(row.subrow)) bySubrow.set(row.subrow, []);
      bySubrow.get(row.subrow).push(rectangle);
    }
    for (const rectangles of bySubrow.values()) {
      rectangles.sort((a, b) => a.left - b.left);
      for (let index = 1; index < rectangles.length; index++) {
        assert.ok(rectangles[index - 1].left + rectangles[index - 1].width <= rectangles[index].left,
          viewportWidth + 'px: packed rectangles must never overlap within a subrow');
      }
    }
  }
  assert.match(viewSource, /top:group\.top \+ row\.subrow \* 22/);
});

test('live-card countdown labels are compact and deterministic', () => {
  assert.equal(api.countdownLabel(2 * api.DAY_MS + 3 * 3600000), '2d 03h');
  assert.equal(api.countdownLabel(3 * 3600000 + 2 * 60000 + 1000), '03:02:01');
  assert.equal(api.countdownLabel(-1), '00:00:00');
});

test('simultaneous activities receive separate sub-lanes', () => {
  const layout = plain(api.assignSubLanes([
    { id:'a', start:0, end:100 },
    { id:'b', start:20, end:80 },
    { id:'c', start:100, end:200 },
  ], 0));
  assert.equal(layout.laneCount, 2);
  assert.deepEqual(layout.blocks.map((row) => [row.id, row.lane]), [['a', 0], ['b', 1], ['c', 0]]);
});

test('server-fixed interval anchors land at 04:00 in each selected region', () => {
  const def = {
    id:'zzz-cycle', label:'Cycle', mode:'fixed', timezoneMode:'server-fixed', resetHour:4,
    anchorStart:'2025-01-02T20:00:00.000Z', intervalDays:14, durationDays:14,
    sourceUrl:'https://example.test/cycle',
  };
  const start = Date.parse('2025-01-01T00:00:00.000Z');
  const end = Date.parse('2025-01-20T00:00:00.000Z');
  assert.equal(iso(api.expandActivity(def, start, end, 'asia')[0].start), '2025-01-02T20:00:00.000Z');
  assert.equal(iso(api.expandActivity(def, start, end, 'europe')[0].start), '2025-01-03T03:00:00.000Z');
  assert.equal(iso(api.expandActivity(def, start, end, 'america')[0].start), '2025-01-03T09:00:00.000Z');
});

// ---- Workstream N: events lane --------------------------------------

const NOW = Date.parse('2026-07-12T00:00:00.000Z');

const rawEvents = [
  { game:'gi', id:'gi-challenge', title:'Stygian Onslaught', type:'challenge',
    start:'2026-07-08T09:00:00.000Z', end:'2026-08-11T02:59:00.000Z',
    server:'europe', timezone:'UTC+01:00', source:{ name:'Genshin Impact Official', url:'https://sg-hk4e-api.hoyoverse.com/ann/1' },
    confidence:'high', permanence:'timed', needs_review:false, image:'https://example.test/img.jpg', description:'Official challenge details.' },
  // Banner-type exclusion guard (review finding) — banner lanes already cover these.
  { game:'gi', id:'gi-banner', title:'Character Event Wish', type:'banner',
    start:'2026-07-01T00:00:00.000Z', end:'2026-07-22T00:00:00.000Z',
    server:'europe', timezone:'UTC+01:00', source:{ name:'Genshin Impact Official', url:'https://example.test/ann/2' },
    confidence:'high', permanence:'timed', needs_review:false, image:null },
  // Real start, open end (until next version) — NOT needs_review.
  { game:'gi', id:'gi-open', title:"Version Details - What's New", type:'event',
    start:'2026-07-01T00:00:00.000Z', end:null,
    server:'europe', timezone:'UTC+01:00', source:{ name:'Genshin Impact Official', url:'https://example.test/ann/3' },
    confidence:'medium', permanence:'timed', needs_review:false, image:null },
  // Undated/uncertain — the needs-review bucket.
  { game:'wuwa', id:'wuwa-guess', title:'New Region Preview', type:'event',
    start:null, end:null,
    server:'global', timezone:'UTC+08:00', source:{ name:'Wuthering Waves Official', url:'https://example.test/ann/4' },
    confidence:'low', permanence:'unknown', needs_review:true, image:null },
];

test('events lane excludes type:banner (double-display guard — banner lanes already cover those)', () => {
  const blocks = api.buildEventBlocks(rawEvents, NOW);
  assert.ok(!blocks.some((b) => b.id === 'gi-banner'), 'banner-type event must not appear in the events lane');
  assert.equal(blocks.length, 3);
});

test('a dateless or needs_review event never gets a placeable date — it is bucketed, not guessed', () => {
  const blocks = api.buildEventBlocks(rawEvents, NOW);
  const guess = blocks.find((b) => b.id === 'wuwa-guess');
  assert.equal(guess.needsReview, true);
  assert.equal(guess.startMs, null, 'no invented start');
  assert.equal(guess.endMs, null, 'no invented end');
  const split = api.splitEventBlocks(blocks);
  assert.deepEqual(plain(split.review.map((b) => b.id)), ['wuwa-guess']);
  assert.deepEqual(plain(split.axis.map((b) => b.id)).sort(), ['gi-challenge', 'gi-open']);
  assert.equal(api.eventStatus(guess, NOW), 'review');
});

test('a real start with an open (null) end renders as ongoing, extended to "now" — never a fabricated future date', () => {
  const blocks = api.buildEventBlocks(rawEvents, NOW);
  const open = blocks.find((b) => b.id === 'gi-open');
  assert.equal(open.needsReview, false);
  assert.equal(open.openEnd, true);
  assert.equal(iso(open.startMs), '2026-07-01T00:00:00.000Z');
  assert.ok(open.endMs >= NOW, 'open-end event is drawn at least up to "now"');
  assert.equal(api.eventStatus(open, NOW), 'ongoing');
});

test('a fully-dated event classifies as live/upcoming/past deterministically', () => {
  const blocks = api.buildEventBlocks(rawEvents, NOW);
  const challenge = blocks.find((b) => b.id === 'gi-challenge');
  assert.equal(challenge.openEnd, false);
  assert.equal(api.eventStatus(challenge, NOW), 'live', 'NOW falls inside the challenge window');
  assert.equal(api.eventStatus(challenge, Date.parse('2026-01-01')), 'upcoming');
  assert.equal(api.eventStatus(challenge, Date.parse('2026-12-01')), 'past');
});

test('event blocks preserve the official post link but never carry a source-site display name', () => {
  const blocks = api.buildEventBlocks(rawEvents, NOW);
  const challenge = blocks.find((b) => b.id === 'gi-challenge');
  assert.equal(challenge.sourceUrl, 'https://sg-hk4e-api.hoyoverse.com/ann/1');
  assert.equal(challenge.image, 'https://example.test/img.jpg');
  assert.equal(challenge.description, 'Official challenge details.');
  assert.ok(!('sourceName' in challenge) && !('source' in challenge), 'no source-site name field is carried into the display block');
});

test('Genshin Lightrace selection pools never masquerade as character rate-ups', () => {
  const records = [
    {
      id:'pool', game:'gi', bannerType:'mixed', category:'Lightrace', name:'Selection Pool', version:'Luna VIII',
      windowsByRegion:{ asia:{ start:'2026-07-01T03:00:00.000Z', end:'2026-07-21T09:59:59.000Z' } }, permanent:false,
      featured:[{ entityType:'character', name:'Every Selectable Character', rarity:5, primary:true }], pairedBannerIds:[],
    },
    {
      id:'rate-up', game:'gi', bannerType:'character', category:'Character Event', name:'Real Rate-Up', version:'Luna VIII',
      windowsByRegion:{ asia:{ start:'2026-07-01T03:00:00.000Z', end:'2026-07-21T09:59:59.000Z' } }, permanent:false,
      featured:[{ entityType:'character', name:'Citlali', rarity:5, primary:true }], pairedBannerIds:[],
    },
  ];
  const built = api.buildBlocks(records, 'asia');
  assert.deepEqual(Array.from(built, (row) => row.primaryFive), ['Citlali']);
});

const eventRecord = (id, extra = {}) => ({
  id, game:'gi', title:'Event ' + id, type:'event', needs_review:false, scheduleStatus:'exact', confidence:'high', permanence:'timed',
  source:{ url:'https://official.example/' + id }, ...extra,
});

test('the event name is the marked span in the official title, across all five feeds', () => {
  // Real titles, one per publisher shape (2026-08-08 feeds).
  const cases = [
    ['"Ley Line Overflow" Event - Double Drops From Blossoms of Wealth and Blossoms of Revelation!', 'Ley Line Overflow'],
    ['Participate in "Starlight Voyage: Splendor Aglow" to Obtain Prismatic Crystals, the Token for the Colorful Surprise Box', 'Starlight Voyage: Splendor Aglow'],
    ['"To Temper Thyself and Journey Far": Rewards of Dedication', 'To Temper Thyself and Journey Far'],
    ['"Snap! Focus Showdown!" Event Details', 'Snap! Focus Showdown!'],
    ['"\'En-Nah\' Into Your Lap" Event Details', "'En-Nah' Into Your Lap"],
    ['Event Preview | [Lament Recon: Tacet Crisis] Combat Event, Coming Soon!', 'Lament Recon: Tacet Crisis'],
    ['[Crimson Hued Issue] LTO Details', 'Crimson Hued Issue'],
    ['「Summer Festival」 Event Details', 'Summer Festival'],
    // No marked span: drop the boilerplate tail instead of inventing a name.
    ['Stygian Onslaught Event: Disturbance-affected Ley Line challenges', 'Stygian Onslaught'],
    ['Planar Fissure Event: Planar Ornaments Drop Rate Doubled for a Limited Time', 'Planar Fissure'],
    ['Depart Anew When the Phantasmoon is Full | Share Screenshots to Win Stellar Jades', 'Depart Anew When the Phantasmoon is Full'],
    ['Event Preview | Somnium Labyrinth: Somnoire Adventure Event, Available Soon!', 'Somnium Labyrinth: Somnoire Adventure'],
  ];
  for (const [full, expected] of cases) assert.equal(api.eventDisplayTitle(full), expected, full);
  // Never returns nothing: a title with no structure to strip survives whole.
  assert.equal(api.eventDisplayTitle('Summer Fantasia'), 'Summer Fantasia');
  assert.equal(api.eventDisplayTitle('"ab" Event Details'), '"ab" Event Details', 'a two-letter span is not a name');
  assert.equal(api.eventDisplayTitle(''), '');
  assert.equal(api.eventDisplayTitle(null), '');
});

test('the event card and dialog show the short event name while retaining the source title in data', () => {
  const now = Date.parse('2026-08-08T12:00:00.000Z');
  const full = '"Ley Line Overflow" Event - Double Drops From Blossoms of Wealth!';
  const [card] = api.currentEvents([eventRecord('ley', { title:full, start:'2026-08-03T00:00:00.000Z', end:'2026-08-10T00:00:00.000Z' })], now, 'eu', 6);
  assert.equal(card.title, 'Ley Line Overflow');
  assert.equal(card.fullTitle, full);
  assert.match(viewSource, /<h3 className="gp-oev-title">\{block\.title\}<\/h3>/);
  assert.match(viewSource, /<h2>\{block\.title\}<\/h2>/);
});

test('the event blurb drops the dates the card already counts down', () => {
  // Official blurbs repeat the schedule the card shows as a countdown, wrapped
  // in section markers (user 2026-08-08).
  const clean = api.cleanEventText;
  assert.equal(
    clean('During the event, challenge a Blossom of Wealth to double your rewards. 〓Event Duration〓 2026/08/03 04:00 - 2026/08/10 03:59 〓Eligibility〓 Revitalize a Blossom.'),
    'During the event, challenge a Blossom of Wealth to double your rewards. Revitalize a Blossom.',
  );
  assert.equal(
    clean('Boosted drop rates! ✦Duration✦ 2026-07-30 10:00 - 2026-08-19 11:59 (server time) ✦Eligibility✦ Reach Union Level 5.'),
    'Boosted drop rates! Reach Union Level 5.',
  );
  assert.equal(
    clean('Availability: Opens June 26, 2026 at 12:00 (server time)'),
    '',
    'a blurb that was only a date collapses to nothing rather than to punctuation',
  );
  assert.equal(clean('Duration: From now until 2026-08-19 23:59 (UTC+8) New region available'), 'New region available');
  // Prose without dates survives untouched.
  assert.equal(clean('Complete hacking operations to obtain rewards.'), 'Complete hacking operations to obtain rewards.');
  assert.equal(clean(null), '');
});

test('event details become semantic blocks without losing publisher text', () => {
  const source = 'Opening paragraph. 〓Event Rules〓 Follow the trail. ● Find the first item. ● Return to camp. ※ Rewards are sent by mail. ✦Bonus Details✦ Claim them before expiry.';
  const blocks = plain(api.eventDetails(source));
  assert.deepEqual(blocks, [
    { type:'paragraph', text:'Opening paragraph.' },
    { type:'heading', text:'Event Rules' },
    { type:'paragraph', text:'Follow the trail.' },
    { type:'list', items:['Find the first item.', 'Return to camp.'] },
    { type:'note', text:'Rewards are sent by mail.' },
    { type:'heading', text:'Bonus Details' },
    { type:'paragraph', text:'Claim them before expiry.' },
  ]);
  const renderedText = blocks.flatMap((block) => block.items || [block.text]).join(' ');
  assert.equal(renderedText, source.replace(/[〓✦●※]/g, ' ').replace(/\s+/g, ' ').trim());
  assert.deepEqual(plain(api.eventDetails(null)), []);
});

// 2026-08-09: the card no longer links out to the official notice — that page
// is being replaced by an API. Clicking it opens the full description instead.
test('the event card opens its full description and never links out', () => {
  assert.doesNotMatch(viewSource, /className="gp-oev-link"/);
  assert.doesNotMatch(viewSource, /Official notice<\/a>/);
  assert.doesNotMatch(viewSource, /NYX_EVENT_TYPE_LABEL|<dt>Type<\/dt>/);
  assert.match(viewSource, /className="gp-oev-open"/);
  assert.match(viewSource, /function EventDetailDialog/);
  assert.match(viewSource, /aria-label=\{'View details for ' \+ block\.title\}/);
  assert.match(viewSource, /aria-label="Close event details"/);
  assert.match(viewSource, /className="gp-oev-modal-countdowns"/);
  assert.match(viewSource, /<dt>Start<\/dt><dd><strong>\{startCountdown\}<\/strong><span>\{nyxTlViewDate\(block\.startMs/);
  assert.match(viewSource, /<dt>End<\/dt><dd><strong>\{endCountdown\}<\/strong>/);
  assert.match(viewSource, /<h3>Event Details<\/h3>/);
  assert.match(viewSource, /var details = nyxTlEventDetails\(block\.description\)/);
  assert.match(viewSource, /part\.type === 'heading'[\s\S]*?<h4[\s\S]*?\{part\.text\}<\/h4>/);
  assert.match(viewSource, /part\.type === 'list'[\s\S]*?<ul[\s\S]*?<li key=\{bulletIndex\}>\{item\}<\/li>/);
  assert.match(viewSource, /className=\{part\.type === 'note' \? 'gp-oev-modal-note' : undefined\}/);
  assert.doesNotMatch(viewSource, /dangerouslySetInnerHTML/);
  assert.match(viewSource, /<h2>\{block\.title\}<\/h2>/, 'row one uses the compact event name');
  assert.match(viewSource, /'--gp-oev-modal-art':block\.image/);
  assert.match(sharedCss, /\.gp-oev-modal-card\{[\s\S]*?background-image:[\s\S]*?var\(--gp-oev-modal-art\)/);
  const stripSource = viewSource.slice(viewSource.indexOf('function CurrentEventsStrip'), viewSource.indexOf('function NyxGameTimelines'));
  assert.doesNotMatch(stripSource, /block\.description/, 'compact cards contain no description');
  assert.doesNotMatch(sharedCss, /\.gp-oev-text/);
});

test('the overview events card reads the player region window, not the merged europe-first one', () => {
  const now = Date.parse('2026-08-08T12:00:00.000Z');
  const record = eventRecord('regional', {
    start:'2026-08-01T09:00:00.000Z', end:'2026-08-20T02:59:00.000Z',
    windowsByRegion:{
      europe:{ start:'2026-08-01T09:00:00.000Z', end:'2026-08-20T02:59:00.000Z', timezone:'UTC+01:00' },
      america:{ start:'2026-08-01T15:00:00.000Z', end:'2026-08-20T08:59:00.000Z', timezone:'UTC-05:00' },
    },
  });
  const [americas] = api.currentEvents([record], now, 'na', 6);
  assert.equal(iso(americas.startMs), '2026-08-01T15:00:00.000Z');
  assert.equal(iso(americas.endMs), '2026-08-20T08:59:00.000Z');
  assert.equal(americas.region, 'america');
  assert.equal(americas.dateOnly, false);
  const [europe] = api.currentEvents([record], now, 'eu', 6);
  assert.equal(iso(europe.startMs), '2026-08-01T09:00:00.000Z');
  // A region the feed does not publish stays visibly date-only rather than
  // claiming another server's clock as the player's own.
  const [asiaOnly] = api.currentEvents([{ ...record, windowsByRegion:{ asia:{ start:'2026-08-01T02:00:00.000Z', end:'2026-08-19T19:59:00.000Z' } } }], now, 'na', 6);
  assert.equal(asiaOnly.dateOnly, true);
  assert.equal(asiaOnly.region, null);
});

test('the overview events card returns every live or upcoming row ordered by end, then start', () => {
  const now = Date.parse('2026-08-08T12:00:00.000Z');
  const records = [
    eventRecord('live-later', { start:'2026-08-01T00:00:00.000Z', end:'2026-08-30T00:00:00.000Z' }),
    eventRecord('live-soon', { start:'2026-08-02T00:00:00.000Z', end:'2026-08-09T00:00:00.000Z' }),
    eventRecord('next-week', { start:'2026-08-15T00:00:00.000Z', end:'2026-08-25T00:00:00.000Z' }),
    eventRecord('tomorrow', { start:'2026-08-09T00:00:00.000Z', end:'2026-08-25T00:00:00.000Z' }),
    eventRecord('live-middle', { start:'2026-08-03T00:00:00.000Z', end:'2026-08-12T00:00:00.000Z' }),
    eventRecord('live-twentieth', { start:'2026-08-01T00:00:00.000Z', end:'2026-08-20T00:00:00.000Z' }),
    eventRecord('upcoming-middle', { start:'2026-08-10T00:00:00.000Z', end:'2026-08-22T00:00:00.000Z' }),
    eventRecord('ended', { start:'2026-07-01T00:00:00.000Z', end:'2026-07-20T00:00:00.000Z' }),
  ];
  const picked = api.currentEvents(records, now, 'eu');
  assert.deepEqual(plain(picked.map((row) => row.id)), ['live-soon', 'live-middle', 'live-twentieth', 'upcoming-middle', 'tomorrow', 'next-week', 'live-later']);
  assert.deepEqual(plain(picked.map((row) => row.status)), ['live', 'live', 'live', 'upcoming', 'upcoming', 'upcoming', 'live']);
  assert.equal(picked.length, 7, 'omitting the limit returns all eligible rows');
  assert.deepEqual(plain(api.currentEvents(records, now, 'eu', 2).map((row) => row.id)), ['live-soon', 'live-middle'], 'an explicit positive numeric limit is still honoured');
});

test('open-ended events sort last by start date and stale ones are excluded', () => {
  const now = Date.parse('2026-08-08T12:00:00.000Z');
  const records = [
    eventRecord('no-end-older', { start:'2026-07-08T00:00:00.000Z', end:null }),
    eventRecord('no-end-newer', { start:'2026-08-01T00:00:00.000Z', end:null }),
    eventRecord('no-end-ancient', { start:'2024-12-31T00:00:00.000Z', end:null }),
    eventRecord('dated', { start:'2026-08-01T00:00:00.000Z', end:'2026-08-12T00:00:00.000Z' }),
  ];
  const picked = api.currentEvents(records, now, 'eu');
  assert.deepEqual(plain(picked.map((row) => row.id)), ['dated', 'no-end-older', 'no-end-newer']);
  assert.deepEqual(plain(picked.map((row) => row.status)), ['live', 'ongoing', 'ongoing']);
});

test('the overview events card never shows a banner row, a permanent feature, or a guessed date', () => {
  const now = Date.parse('2026-08-08T12:00:00.000Z');
  const records = [
    eventRecord('banner', { type:'banner', start:'2026-08-01T00:00:00.000Z', end:'2026-08-30T00:00:00.000Z' }),
    eventRecord('forever', { permanence:'permanent', start:'2026-08-01T00:00:00.000Z', end:'2026-08-30T00:00:00.000Z' }),
    eventRecord('undated', { needs_review:true, start:null, end:null }),
    eventRecord('real', { start:'2026-08-01T00:00:00.000Z', end:'2026-08-30T00:00:00.000Z' }),
  ];
  assert.deepEqual(plain(api.currentEvents(records, now, 'eu', 6).map((row) => row.id)), ['real']);
  assert.deepEqual(plain(api.currentEvents(null, now, 'eu', 6)), []);
});

test('the game overview shows the events card and no stale-banner disclaimer', () => {
  assert.match(appSource, /<CurrentEventsStrip game=\{cfg\.key\}/);
  assert.match(viewSource, /function CurrentEventsStrip\(\{ game, gameName, limit \}\)/);
  assert.match(viewSource, /nyxTlCurrentEvents\(payload\.events, now, region, limit\)/);
  assert.match(viewSource, /cards\.length > 9 \? ' is-scrollable' : ''/);
  assert.match(viewSource, /headline:'Starts in ' \+ nyxTlCountdownLabel/);
  assert.match(viewSource, /'Ends in ' \+ nyxTlCountdownLabel/);
  assert.match(viewSource, /'End date not announced'/);
  assert.match(sharedCss, /grid-template-columns:repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(sharedCss, /@media \(max-width:1500px\)\{[\s\S]*?\.gp-event-grid\{ grid-template-columns:repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(sharedCss, /@media \(max-width:900px\)\{[\s\S]*?\.gp-event-grid\{ grid-template-columns:minmax\(0, 1fr\); \}/);
  assert.match(sharedCss, /\.gp-event-grid\.is-scrollable\{\s*max-height:calc\(396px[\s\S]*?overflow-y:auto;/);
  assert.match(sharedCss, /@media \(max-width:1500px\)\{[\s\S]*?\.gp-event-grid\.is-scrollable\{ max-height:calc\(660px/);
  assert.match(sharedCss, /@media \(max-width:900px\)\{[\s\S]*?\.gp-event-grid\.is-scrollable\{ max-height:calc\(1188px/);
  assert.match(sharedCss, /grid-auto-rows:var\(--gp-event-row-height\)/);
  assert.match(sharedCss, /\.gp-oev-modal-card\{[^}]*box-sizing:border-box;/);
  // Removed 2026-08-08 at the user's request; the quiet "Updated" line stays.
  assert.doesNotMatch(appSource, /Banner data may be out of date/);
  assert.doesNotMatch(appSource, /BannerFreshnessNote/);
  assert.doesNotMatch(sharedCss, /gp-banner-fresh/);
  // Event art is local-only: the strip may never point at a publisher CDN.
  assert.doesNotMatch(viewSource, /gp-oev-art[\s\S]{0,200}https?:/);
});

test('per-game and cross-game event detail cards render the plain description field as React text', () => {
  assert.match(viewSource, /selectedEventBlock\.description\s*&&\s*<p>\{selectedEventBlock\.description\}<\/p>/);
  assert.match(viewSource, /selectedBlock\.description&&<p>\{selectedBlock\.description\}<\/p>/);
  assert.doesNotMatch(viewSource, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(viewSource, /Â·/, 'timeline labels must not render a mojibake separator');
});

// 2026-08-09: the hub keeps an Events tab, but it is now the per-game current
// events view rather than the cross-game "All Events" timeline.
test('the Events hub tab is present in both route maps and the Nyx valid-tab list', () => {
  assert.match(appSource, /NYX_TAB_TO_ROUTE\s*=\s*\{[\s\S]*?events:'events'/);
  assert.match(appSource, /ROUTE_TO_NYX_TAB\s*=\s*\{[\s\S]*?events:'events'/);
  assert.match(appSource, /\['overview','events','characters','calendar','codes','settings'\]/);
  assert.match(appSource, /function NyxEventsView\(\)/);
});

// 2026-08-09: the hub's Timeline, Pull Overview and All Banners tabs were
// removed at the user's request. Their old URLs fall back to Banners.
test('retired hub tabs are gone and their routes fall back to Banners', () => {
  assert.doesNotMatch(appSource, /NYX_TAB_TO_ROUTE\s*=\s*\{[\s\S]*?timeline:'timeline'/);
  assert.match(appSource, /ROUTE_TO_NYX_TAB\s*=\s*\{[\s\S]*?timeline:'overview'/);
  assert.match(appSource, /ROUTE_TO_NYX_TAB\s*=\s*\{[\s\S]*?banners:'overview'/);
  assert.doesNotMatch(appSource, /<NyxGameTimelines/);
  assert.doesNotMatch(appSource, /<CrossGameBannerTimeline/);
  assert.doesNotMatch(appSource, /<CrossGameEventsTimeline/);
  assert.doesNotMatch(appSource, /<PullsOverview/);
});

test('cross-game banner search scans full history, including off-screen runs', () => {
  const farPast = { id:'old', startMs:Date.parse('2020-01-01'), endMs:Date.parse('2020-01-20'), searchNames:['Aster'], name:'Aster', weaponNames:[] };
  const lanes = [{ gameKey:'gi', gameName:'Genshin Impact', allBlocks:[farPast] }, { gameKey:'hsr', gameName:'Honkai: Star Rail', allBlocks:[] }];
  const visible = api.visibleBlocks([farPast], Date.parse('2026-07-12'), api.ZOOM_LEVELS[api.DEFAULT_ZOOM], 1000, 600);
  assert.equal(visible.length, 0, 'fixture is outside the viewport');
  const results = plain(api.crossGameBannerSearch(lanes, 'aster'));
  assert.deepEqual(results, [{ gameKey:'gi', gameName:'Genshin Impact', blockId:'old', name:'Aster', startMs:Date.parse('2020-01-01') }]);
});

test('cross-game event grouping keeps all five games separate and excludes banner events', () => {
  const games = [
    { key:'gi', name:'Genshin Impact' }, { key:'hsr', name:'Honkai: Star Rail' },
    { key:'zzz', name:'Zenless Zone Zero' }, { key:'wuwa', name:'Wuthering Waves' }, { key:'ae', name:'Arknights: Endfield' },
  ];
  const feeds = {};
  games.forEach((game, index) => { feeds[game.key] = [
    { game:game.key === 'ae' ? 'endfield' : game.key, id:game.key + '-event', title:game.name + ' Event', type:'event', start:'2026-07-01T00:00:00.000Z', end:'2026-07-20T00:00:00.000Z', needs_review:false, source:{ url:'https://example.test/' + index } },
    { game:game.key, id:game.key + '-banner', title:'Banner', type:'banner', start:'2026-07-01T00:00:00.000Z', end:'2026-07-20T00:00:00.000Z', needs_review:false, source:{ url:'https://example.test/banner' } },
  ]; });
  const grouped = plain(api.groupEventsByGame(feeds, games, NOW));
  assert.deepEqual(grouped.map((row) => row.gameKey), ['gi','hsr','zzz','wuwa','ae']);
  assert.ok(grouped.every((row) => row.axis.length === 1 && row.allBlocks.length === 1));
  assert.equal(grouped[4].axis[0].game, 'endfield', 'Endfield backend records remain mapped under the ae UI lane');
});
