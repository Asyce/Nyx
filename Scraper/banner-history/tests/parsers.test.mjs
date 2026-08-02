import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeEndfieldOfficialWindow, mergeKuroOfficialFallbacks, parseEndfieldYear, parseFandomRun, parseGryphlineOfficial, parseKuroOfficial, parseKuroOfficialBanners } from '../sources.mjs';

const cases = [
  ['gi','Wish','Wish Pool','Character Event','character_5_F','character_4_F','Hero','Friend'],
  ['gi','Wish','Wish Pool','Weapon Event','weapon_5_F','weapon_4_F','Sword','Small Sword'],
  ['hsr','Warp','Warp Pool','Character Event','character_5_F','character_4_F','Hero','Friend'],
  ['hsr','Warp','Warp Pool','Light Cone Event','lightcone_5_F','lightcone_4_F','Cone','Small Cone'],
  ['zzz','Signal Search Infobox','Signal Search Pool','Exclusive Channel','agent_S_F','agent_A_F','Agent','Helper'],
  ['zzz','Signal Search Infobox','Signal Search Pool','W-Engine Channel','w-engine_S_F','w-engine_A_F','Engine','Small Engine'],
  ['wuwa','Convene','Convene/Pool','Featured Resonator','resonator_5_F','resonator_4_F','Hero','Friend'],
  ['wuwa','Convene','Convene/Pool','Featured Weapon','weapon_5_F','weapon_4_F','Blade','Small Blade'],
];
for (const [game, info, pool, type, primaryKey, secondaryKey, primary, secondary] of cases) test(`${game} character/weapon fixture parses canonical featured data`, () => {
  const text = `{{${info}\n|name = Sample 2024-01-01\n|type = ${type}\n|duration = event\n|time_start = 2024-01-01 10:00:00\n|time_start_offset = GMT+8\n|time_end = 2024-01-21 17:59:59\n|alongside = Pair/2024-01-01\n|link = https://official.example/notice\n}}\n{{${pool}\n|${primaryKey} = ${primary}\n|${secondaryKey} = ${secondary}\n}}\n{{Change History|1.0}}`;
  const record = parseFandomRun(game, { title:'Sample/2024-01-01', revision:7, text });
  assert.equal(record.game, game); assert.equal(record.featured[0].name, primary); assert.equal(record.featured[0].primary, true);
  assert.equal(record.windowsByRegion.asia.start, '2024-01-01T02:00:00.000Z'); assert.equal(record.source.revision, 7); assert.equal(record.confirmed, true);
});

test('unfinished future wiki placeholders are ignored without accepting tentative dates', () => {
  const text = `{{Wish
|name = Astral Actuation 7.0
|type = Character Event
|duration = unknown<!--event-->
|time_start = <!--2026-09-01 18:00:00-->
|time_end = <!--2026-09-22 14:59:59-->
}}
{{Wish Pool
|character_5_F = Ineffa
  |character_4_F = Unknown Character; Unknown Character; Unknown Character
}}`;
  assert.equal(parseFandomRun('gi', { title:'Astral Actuation/7.0', revision:2137972, text }), null);
  assert.notEqual(parseFandomRun('gi', { title:'Broken Event', revision:1, text:text.replace('unknown<!--event-->', 'event') }), null, 'other malformed finite rows still reach fail-closed dataset validation');
});

test('Endfield parses operator and weapon rows, region fields, and rejects provisional ends', () => {
  const operators = parseEndfieldYear({title:'Headhunting/Banners/2026',revision:10,text:`{{Banners cell\n|name = Alpha\n|start = 2026/01/22 11:00:00\n|end = 2026/02/07 11:59:59\n|start synced = yes\n|end synced = yes\n|operators = Alpha, Beta\n|rateup = Alpha\n|quota = Gamma\n}}`}, 'character');
  assert.deepEqual(Object.keys(operators[0].windowsByRegion), ['global']); assert.equal(operators[0].featured[0].rarity, 6);
  const weapons = parseEndfieldYear({title:'Arsenal Exchange/Issues/2026',revision:11,text:`<!-- Not final: end date calculated as start + 51 days -->\n{{Issues cell\n|name = Blade Issue\n|ameu start = 2026/06/04 23:00:00\n|asia start = 2026/06/05 12:00:00\n|end = 2026/07/26 05:59:59\n|weapons = Blade, Knife\n|rateup = Blade\n}}`}, 'weapon');
  assert.equal(weapons[0].windowsByRegion.asia.end, undefined); assert.equal(weapons[0].windowsByRegion.america.start, '2026-06-05T04:00:00.000Z'); assert.equal(weapons[0].confirmed, false);
});

test('official Kuro and Gryphline extractors are deterministic', () => {
  const kuro = parseKuroOfficial({articleId:4916,articleTitle:'Phase',articleContent:'Resonator Convene: Cartethyia 2026-06-18 10:00 - 2026-07-09 11:59'});
  assert.equal(kuro.id, '4916'); assert.equal(kuro.start, '2026-06-18T02:00:00.000Z'); assert.equal(kuro.end, '2026-07-09T03:59:00.000Z');
  const gryph = parseGryphlineOfficial({cid:758,title:'Update',data:'<p>“Fists of No Regrets” Headhunting 2026/06/05 12:00</p>'});
  assert.deepEqual(gryph.bannerNames, ['Fists of No Regrets']); assert.equal(gryph.dates.length, 1);
});

test('official Kuro banner notices fill a current wiki rollover gap without guessing dates', () => {
  const records = parseKuroOfficialBanners({
    articleId: 5220,
    articleTitle: '[Version 3.5 Featured Resonator/Weapon Convene: Phase II]',
    articleContent: '[Take Flight in Spring] Featured Resonator Convene During the event, 5-Star Resonator: Aemeath, 4-Star Resonators: Baizhi, Mortefi, and Lumi receive boosted drop rates! Duration 2026-07-30 10:00 - 2026-08-19 11:59 (server time) [Everbright Polestar] Featured Weapon Convene During the event, 5-Star Weapon: Everbright Polestar, 4-Star Weapons: Variation, Endless Collapse, and Relativistic Jet receive boosted drop rates! Duration 2026-07-30 10:00 - 2026-08-19 11:59 (server time)',
  }, { fetchedAt: '2026-08-01T00:00:00.000Z' });
  assert.equal(records.length, 2);
  assert.equal(records[0].version, '3.5');
  assert.equal(records[0].featured[0].name, 'Aemeath');
  assert.deepEqual(records[0].featured.slice(1).map((row) => row.name), ['Baizhi', 'Mortefi', 'Lumi']);
  assert.equal(records[0].windowsByRegion.asia.start, '2026-07-30T02:00:00.000Z');
  assert.equal(records[0].windowsByRegion.europe.start, '2026-07-30T09:00:00.000Z');
  assert.equal(records[0].source.url, 'https://wutheringwaves.kurogames.com/en/main/news/detail/5220');
  assert.equal(records[0].confirmed, true);

  const wikiRecord = { ...structuredClone(records[0]), version: undefined, source: { url: 'https://wutheringwaves.fandom.com/wiki/Take_Flight_in_Spring/2026-07-30', kind: 'maintained-wiki', revision: 7 } };
  mergeKuroOfficialFallbacks([wikiRecord], records);
  assert.equal(wikiRecord.version, '3.5', 'the exact official notice fills a missing wiki version');

  assert.deepEqual(parseKuroOfficialBanners({
    articleId: 5039,
    articleTitle: '[Version 3.5 Featured Resonator/Weapon Convene: Phase I]',
    articleContent: '[When Winter Thaws] Featured Resonator Convene During the event, 5-Star Resonator: Luuk Herssen, 4-Star Resonators: Danjin, Chixia, and Aalto receive boosted drop rates! Duration Version 3.5 update - 2026-07-30 09:59 (server time)',
  }), [], 'a missing official start is rejected instead of inferred');
});

test('Endfield official availability merges exact regional starts/ends without inventing rule-based ends', () => {
  const base = { name:'Fists of No Regrets', windowsByRegion:{ asia:{start:'2026-06-05T04:00:00.000Z',timezone:'UTC+08:00',sourceUrl:'wiki'}, america:{start:'2026-06-05T04:00:00.000Z',timezone:'UTC-05:00',sourceUrl:'wiki'}, europe:{start:'2026-06-05T04:00:00.000Z',timezone:'UTC-05:00',sourceUrl:'wiki'} } };
  assert(mergeEndfieldOfficialWindow(base, {data:'<p>[Fists of No Regrets] Chartered Headhunting Details · Availability: After version release – June 26, 2026 at 11:59 (server time) · Participation</p>'}, 'official'));
  assert.equal(base.windowsByRegion.asia.end, '2026-06-26T03:59:00.000Z');
  assert.equal(base.windowsByRegion.america.end, '2026-06-26T16:59:00.000Z');
  const start = { name:'Expunger of Sin', windowsByRegion:{ asia:{start:'old'} } };
  assert(mergeEndfieldOfficialWindow(start, {data:'<p>[Expunger of Sin] Chartered Headhunting · Availability: June 26, 2026 at 12:00 (server time) – Before maintenance · Participation</p>'}, 'official'));
  assert.equal(start.windowsByRegion.asia.start, '2026-06-26T04:00:00.000Z'); assert.equal(start.windowsByRegion.america.start, '2026-06-26T17:00:00.000Z');
  const rule = { name:'Crimson Hued', windowsByRegion:{asia:{start:'old'}} };
  assert(mergeEndfieldOfficialWindow(rule, {data:'<p>[Crimson Hued Issue] · Availability: Opens June 26, 2026 at 12:00 (server time), and ends after 3 banners · Participation</p>'}, 'official'));
  assert.equal(rule.windowsByRegion.america.end, undefined);
});
