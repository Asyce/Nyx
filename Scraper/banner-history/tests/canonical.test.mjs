import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { monotonicMerge, preserveOfficialWindows, validateDataset } from '../core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const load = (game) => JSON.parse(fs.readFileSync(path.join(root, 'Database/BannerHistory', `${game}.json`), 'utf8'));

test('canonical histories retain full source counts, both banner types, and official latest evidence', () => {
  const minimums = { gi:290, hsr:218, zzz:124, wuwa:166, ae:27 };
  for (const [game, minimum] of Object.entries(minimums)) {
    const rows = load(game).records;
    assert(rows.length >= minimum, `${game} count`);
    assert(rows.some((row) => row.bannerType === 'character'), `${game} character history`);
    assert(rows.some((row) => row.bannerType === 'weapon'), `${game} weapon history`);
    assert(rows.some((row) => row.officialSource), `${game} official latest evidence`);
  }
});

test('regional records never borrow another region and exact source-group pairs resolve', () => {
  for (const game of ['hsr','zzz','wuwa']) {
    const rows = load(game).records;
    const regional = rows.find((row) => row.windowsByRegion.asia && row.windowsByRegion.europe && row.windowsByRegion.america && row.windowsByRegion.asia.start !== row.windowsByRegion.america.start);
    assert(regional, `${game} has a three-region record`);
    assert.notEqual(regional.windowsByRegion.asia.start, regional.windowsByRegion.america.start, `${game} server boundaries differ`);
    for (const row of rows) for (const id of row.pairedBannerIds) assert(rows.some((other) => other.id === id), `${game} pair resolves`);
  }
  assert(load('ae').records.some((row) => row.windowsByRegion.asia && row.windowsByRegion.europe && row.windowsByRegion.america), 'ae has explicit three-region records');
});

test('permanent/novice records and honest date-only rows survive normalization', () => {
  const wuwa = load('wuwa').records;
  for (const name of ['Tidal Chorus','Standard Weapon Convene','Utterance of Marvels',"Beginner's Choice Convene"]) assert(wuwa.some((row) => row.name === name && row.permanent), name);
  assert(wuwa.some((row) => row.dateOnly && !Object.keys(row.windowsByRegion).length), 'WuWa sourced date-only record');
  const ae = load('ae').records;
  // Naming a specific in-flight banner here rots the moment Gryphline publishes its end,
  // so assert the behaviour instead: a still-running record keeps its starts and omits ends.
  assert(ae.some((row) => {
    const windows = Object.values(row.windowsByRegion);
    return windows.length && windows.every((window) => window.start && !window.end);
  }), 'provisional Endfield ends omitted');
});

test('Endfield dedicated official notices override exact regional boundaries and preserve unknown ends', () => {
  const rows = load('ae').records; const byName = (name) => rows.find((row) => row.name === name);
  const fists = byName('Fists of No Regrets');
  assert.match(fists.officialSource.url, /\/0759\?/); assert.equal(fists.windowsByRegion.asia.end, '2026-06-26T03:59:00.000Z'); assert.equal(fists.windowsByRegion.america.end, '2026-06-26T16:59:00.000Z');
  const expunger = byName('Expunger of Sin');
  assert.match(expunger.officialSource.url, /\/6175\?/); assert.equal(expunger.windowsByRegion.asia.start, '2026-06-26T04:00:00.000Z'); assert.equal(expunger.windowsByRegion.america.start, '2026-06-26T17:00:00.000Z');
  const crimson = byName('Crimson Hued');
  assert.match(crimson.officialSource.url, /\/1321\?/); assert.equal(crimson.windowsByRegion.america.start, '2026-06-26T17:00:00.000Z');
  const scarlet = byName('Scarlet Knot');
  assert.match(scarlet.officialSource.url, /\/4492\?/);
  // "Preserve unknown ends" means ends are reported, never invented. A region holds an
  // omitted end until an official notice publishes one — and a later notice legitimately
  // may, per region, so pinning a named banner as open forever is what previously broke
  // this suite. Assert the invariant that survives new notices instead.
  for (const row of rows) for (const [region, window] of Object.entries(row.windowsByRegion)) {
    if (!window.end) continue;
    assert(Number.isFinite(Date.parse(window.end)), `${row.name} ${region} end parses`);
    assert(Date.parse(window.end) > Date.parse(window.start), `${row.name} ${region} end follows start`);
  }
  assert(rows.some((row) => Object.values(row.windowsByRegion).some((window) => window.start && !window.end)), 'unpublished Endfield ends stay omitted');
});

test('written canonical records keep official regional windows even when a fresh scrape misses the notice', () => {
  const officialUrl = 'https://web-news.gryphline.com/api/bulletin/0759?lang=en-us&code=arknights_endfield_official';
  const base = () => ({
    id:'ae:character:Headhunting:sample:2026-06-05', game:'ae', bannerType:'character', category:'Headhunting', name:'Sample',
    permanent:false, featured:[{ entityType:'character', name:'Sample', rarity:6, primary:true }], pairedBannerIds:[],
    source:{ url:'https://endfield.wiki.gg/wiki/Headhunting/Banners/2026', kind:'maintained-wiki', revision:1 }, fetchedAt:'2026-01-01T00:00:00Z',
  });
  // Prior canonical record: official notice supplied exact three-region boundaries.
  const previous = { schemaVersion:1, game:'ae', generatedAt:'2026-06-01T00:00:00Z', records:[{ ...base(), confirmed:true,
    officialSource:{ url:officialUrl, kind:'official-latest', revision:'0759' },
    windowsByRegion:{
      asia:{ start:'2026-06-05T04:00:00.000Z', end:'2026-06-26T03:59:00.000Z', timezone:'UTC+08:00', sourceUrl:officialUrl },
      america:{ start:'2026-06-05T04:00:00.000Z', end:'2026-06-26T16:59:00.000Z', timezone:'UTC-05:00', sourceUrl:officialUrl },
      europe:{ start:'2026-06-05T04:00:00.000Z', end:'2026-06-26T16:59:00.000Z', timezone:'UTC-05:00', sourceUrl:officialUrl },
    } }] };
  // Fresh scrape that could not reach the official notice: wiki-only asia window, no official evidence.
  const candidate = validateDataset({ schemaVersion:1, game:'ae', generatedAt:'2026-07-01T00:00:00Z', records:[{ ...base(), confirmed:false,
    windowsByRegion:{ asia:{ start:'2026-06-05T04:00:00.000Z', end:'2026-06-26T03:59:59.000Z', timezone:'UTC+08:00', sourceUrl:'https://endfield.wiki.gg/wiki/Headhunting/Banners/2026' } } }] });
  preserveOfficialWindows(previous, candidate);
  const written = monotonicMerge(previous, candidate).records[0];
  assert.equal(written.windowsByRegion.asia.end, '2026-06-26T03:59:00.000Z', 'official asia end must survive a degraded scrape');
  assert.equal(written.windowsByRegion.america.end, '2026-06-26T16:59:00.000Z', 'official america window must survive');
  assert.equal(written.windowsByRegion.europe.end, '2026-06-26T16:59:00.000Z', 'official europe window must survive');
  assert.equal(written.officialSource.revision, '0759', 'official evidence must survive');
  assert.equal(written.confirmed, true);
});

test('official regional windows survive when a fresh notice sets officialSource but cannot parse every region', () => {
  const priorUrl = 'https://web-news.gryphline.com/api/bulletin/0759?x';
  const freshUrl = 'https://web-news.gryphline.com/api/bulletin/0760?x';
  const wikiUrl = 'https://endfield.wiki.gg/wiki/Headhunting/Banners/2026';
  const base = () => ({ id:'ae:character:Headhunting:partial:2026-06-05', game:'ae', bannerType:'character', category:'Headhunting', name:'Partial',
    permanent:false, featured:[{ entityType:'character', name:'Partial', rarity:6, primary:true }], pairedBannerIds:[],
    source:{ url:wikiUrl, kind:'maintained-wiki', revision:1 }, fetchedAt:'2026-01-01T00:00:00Z' });
  // Prior canonical record carried official three-region boundaries from an earlier notice.
  const previous = { schemaVersion:1, game:'ae', generatedAt:'2026-06-01T00:00:00Z', records:[{ ...base(), confirmed:true,
    officialSource:{ url:priorUrl, kind:'official-latest', revision:'0759' },
    windowsByRegion:{
      asia:{ start:'2026-06-05T04:00:00.000Z', end:'2026-06-26T03:59:00.000Z', timezone:'UTC+08:00', sourceUrl:priorUrl },
      america:{ start:'2026-06-05T04:00:00.000Z', end:'2026-06-26T16:59:00.000Z', timezone:'UTC-05:00', sourceUrl:priorUrl },
      europe:{ start:'2026-06-05T04:00:00.000Z', end:'2026-06-26T16:59:00.000Z', timezone:'UTC-05:00', sourceUrl:priorUrl },
    } }] };
  // Fresh scrape: a notice matched by name so officialSource is set, but only asia parsed officially;
  // america/europe fell back to wiki text (unparseable "Availability:" for those regions).
  const candidate = validateDataset({ schemaVersion:1, game:'ae', generatedAt:'2026-07-01T00:00:00Z', records:[{ ...base(), confirmed:true,
    officialSource:{ url:freshUrl, kind:'official-latest', revision:'0760' },
    windowsByRegion:{
      asia:{ start:'2026-06-05T04:00:00.000Z', end:'2026-06-27T03:59:00.000Z', timezone:'UTC+08:00', sourceUrl:freshUrl },
      america:{ start:'2026-06-05T04:00:00.000Z', end:'2026-06-26T16:59:59.000Z', timezone:'UTC-05:00', sourceUrl:wikiUrl },
    } }] });
  preserveOfficialWindows(previous, candidate);
  const written = monotonicMerge(previous, candidate).records[0];
  assert.equal(written.windowsByRegion.asia.end, '2026-06-27T03:59:00.000Z', 'fresh official asia wins');
  assert.equal(written.windowsByRegion.america.end, '2026-06-26T16:59:00.000Z', 'prior official america survives the wiki-only fresh window');
  assert.equal(written.windowsByRegion.america.sourceUrl, priorUrl, 'america window keeps its official source');
  assert.equal(written.windowsByRegion.europe.end, '2026-06-26T16:59:00.000Z', 'prior official europe (absent in fresh scrape) is preserved');
  assert.equal(written.officialSource.revision, '0760', 'fresh official evidence is kept');
});

test('a fresh official GLOBAL window supersedes stale per-region official windows (no downgrade)', () => {
  const oldUrl = 'https://web-news.gryphline.com/api/bulletin/0100?x';
  const freshUrl = 'https://web-news.gryphline.com/api/bulletin/0200?x';
  const base = () => ({ id:'ae:character:Headhunting:g:2026-02-05', game:'ae', bannerType:'character', category:'Headhunting', name:'G',
    permanent:false, featured:[{ entityType:'character', name:'G', rarity:6, primary:true }], pairedBannerIds:[],
    source:{ url:'https://endfield.wiki.gg/wiki/Headhunting/Banners/2026', kind:'maintained-wiki', revision:1 }, fetchedAt:'2026-01-01T00:00:00Z' });
  // Prior official truth was per-region JANUARY windows.
  const previous = { schemaVersion:1, game:'ae', generatedAt:'2026-01-01T00:00:00Z', records:[{ ...base(), confirmed:true,
    officialSource:{ url:oldUrl, kind:'official-latest', revision:'0100' },
    windowsByRegion:{
      america:{ start:'2026-01-05T05:00:00.000Z', end:'2026-01-26T16:59:00.000Z', timezone:'UTC-05:00', sourceUrl:oldUrl },
      asia:{ start:'2026-01-05T04:00:00.000Z', end:'2026-01-26T03:59:00.000Z', timezone:'UTC+08:00', sourceUrl:oldUrl },
    } }] };
  // Fresh official notice supplies a single authoritative GLOBAL window with FEBRUARY dates.
  const candidate = validateDataset({ schemaVersion:1, game:'ae', generatedAt:'2026-02-10T00:00:00Z', records:[{ ...base(), confirmed:true,
    officialSource:{ url:freshUrl, kind:'official-latest', revision:'0200' },
    windowsByRegion:{ global:{ start:'2026-02-05T04:00:00.000Z', end:'2026-02-26T03:59:00.000Z', timezone:'UTC+00:00', sourceUrl:freshUrl } } }] });
  preserveOfficialWindows(previous, candidate);
  const row = candidate.records[0];
  assert.equal(row.windowsByRegion.global.start, '2026-02-05T04:00:00.000Z', 'fresh global kept');
  assert.equal(row.windowsByRegion.america, undefined, 'stale January america must NOT be re-attached beside the fresh global');
  assert.equal(row.windowsByRegion.asia, undefined, 'stale January asia must NOT be re-attached beside the fresh global');
});

test('preserveOfficialWindows never invents times and yields to fresher official data', () => {
  const wikiUrl = 'https://endfield.wiki.gg/wiki/Headhunting/Banners/2026';
  const freshOfficial = 'https://web-news.gryphline.com/api/bulletin/9999?x';
  const base = () => ({ id:'ae:character:Headhunting:x:2026-06-05', game:'ae', bannerType:'character', category:'Headhunting', name:'X',
    permanent:false, featured:[{ entityType:'character', name:'X', rarity:6, primary:true }], pairedBannerIds:[],
    source:{ url:wikiUrl, kind:'maintained-wiki', revision:1 }, fetchedAt:'2026-01-01T00:00:00Z' });
  // No prior official window exists -> a still-unsourced fresh record stays unsourced (no fabrication).
  const previousWikiOnly = { schemaVersion:1, game:'ae', generatedAt:'2026-06-01T00:00:00Z', records:[{ ...base(), confirmed:false,
    windowsByRegion:{ asia:{ start:'2026-06-05T04:00:00.000Z', timezone:'UTC+08:00', sourceUrl:wikiUrl } } }] };
  const stillWiki = { schemaVersion:1, game:'ae', generatedAt:'2026-07-01T00:00:00Z', records:[{ ...base(), confirmed:false,
    windowsByRegion:{ asia:{ start:'2026-06-05T04:00:00.000Z', timezone:'UTC+08:00', sourceUrl:wikiUrl } } }] };
  preserveOfficialWindows(previousWikiOnly, stillWiki);
  assert.equal(stillWiki.records[0].officialSource, undefined, 'no official source to carry forward');
  assert.equal(stillWiki.records[0].windowsByRegion.america, undefined, 'no regional window is invented');
  // A fresh official window always wins over a stale one; preserve is a no-op when the candidate is sourced.
  const previousOfficial = { schemaVersion:1, game:'ae', generatedAt:'2026-06-01T00:00:00Z', records:[{ ...base(), confirmed:true,
    officialSource:{ url:'https://web-news.gryphline.com/api/bulletin/0001?x', kind:'official-latest', revision:'0001' },
    windowsByRegion:{ asia:{ start:'2026-06-05T04:00:00.000Z', end:'2026-06-26T03:59:00.000Z', timezone:'UTC+08:00', sourceUrl:'https://web-news.gryphline.com/api/bulletin/0001?x' } } }] };
  const fresherOfficial = { schemaVersion:1, game:'ae', generatedAt:'2026-07-01T00:00:00Z', records:[{ ...base(), confirmed:true,
    officialSource:{ url:freshOfficial, kind:'official-latest', revision:'9999' },
    windowsByRegion:{ asia:{ start:'2026-06-05T04:00:00.000Z', end:'2026-06-27T03:59:00.000Z', timezone:'UTC+08:00', sourceUrl:freshOfficial } } }] };
  preserveOfficialWindows(previousOfficial, fresherOfficial);
  assert.equal(fresherOfficial.records[0].windowsByRegion.asia.end, '2026-06-27T03:59:00.000Z', 'fresh official data is authoritative');
  assert.equal(fresherOfficial.records[0].officialSource.revision, '9999');
});
