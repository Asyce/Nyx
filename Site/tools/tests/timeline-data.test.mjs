import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(path.resolve(import.meta.dirname, '../../src/features/timeline/timeline-data.js'), 'utf8');
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
