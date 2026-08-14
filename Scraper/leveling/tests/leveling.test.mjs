import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GAME_CONFIG, parseLevelingTable } from '../core.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/* One row per dialect. The three wikis spell "N of this item, [M] so far"
 * differently, and only the bracketed running subtotal is wanted — it is the
 * "Lv 1 to here" figure the character page's ascension slider asks for. */
const GI_TABLE = `==Leveling Characters==
{| class="wikitable align-center"
! Level<br>Range !! Items Required [subtotal] !! EXP Needed [subtotal] !! EXP Wasted !! {{Item|Mora|text=Cost}} [subtotal]
|-
|1 → 20||{{Card|Hero's Wit|6 [6]|show_caption=1}}{{Card|Adventurer's Experience|0 [0]|show_caption=1}}{{Card|Wanderer's Advice|1 [1]|show_caption=1}}||120,175
[120,175]
|825||24,200
[24,200]
|-
|20 → 40||{{Card|Hero's Wit|28 [34]|show_caption=1}}{{Card|Adventurer's Experience|3 [3]|show_caption=1}}{{Card|Wanderer's Advice|4 [5]|show_caption=1}}||578,325
[698,500]
|675||115,800
[140,000]
|-
!'''Total'''|| style="font-weight: normal;" | {{Card|Hero's Wit|415|show_caption=1}}||8,362,650||4,350||1,673,400
|}`;

const HSR_TABLE = `==Leveling Characters==
{| class='wikitable' style="text-align:center;"
! Level<br />Range !! Items Required<br />[subtotal] !! EXP Needed<br />[subtotal] !! EXP Wasted !! {{Item|Credit|text=Cost}}<br />[subtotal]
|-
|1 → 20
|{{Card|Traveler's Guide|5|caption=[5]}}{{Card|Adventure Log|2|caption=[2]}}{{Card|Travel Encounters|3|caption=[3]}}
|112,510<br />[112,510]
|490
|{{Card|Credit|11,300|caption=[11,300]}}
|-
|20 → 30
|{{Card|Traveler's Guide|8|caption=[13]}}{{Card|Adventure Log|3|caption=[5]}}{{Card|Travel Encounters|3|caption=[6]}}
|177,910<br />[290,420]
|90
|{{Card|Credit|17,800|caption=[29,100]}}
|}`;

const ZZZ_TABLE = `==Agent Leveling==
{| class="wikitable align-center"
|-
! Level<br/>Range !! EXP Needed<br/>(subtotal) !! Items Required<br/>(subtotal) !! EXP Wasted
|-
| 1 -> 10 || 6,000<br/>(6,000) || {{Card List|Trainee Investigator Log*0 (0);Senior Investigator Log*2 (2)|show_caption=1}} || 0
|-
| 10 -> 20 || 24,000<br/>(30,000) || {{Card List|Trainee Investigator Log*0 (0);Senior Investigator Log*8 (10)|show_caption=1}} || 0
|}`;

test('each wiki dialect yields the running subtotal for every level band', () => {
  const gi = parseLevelingTable(GI_TABLE, 'Leveling Characters', 'Mora');
  assert.deepEqual(gi.map((row) => row.cap), [20, 40], 'the Total row is not a band');
  // 6 -> 34 is the subtotal, not the 28 spent inside the band. A zero-quantity
  // entry (Adventurer's Experience at Lv 20) is dropped rather than shown as x0.
  assert.deepEqual(gi[0].items, [{ name: "Hero's Wit", qty: 6 }, { name: "Wanderer's Advice", qty: 1 }]);
  assert.deepEqual(gi[1].items, [
    { name: "Hero's Wit", qty: 34 },
    { name: "Adventurer's Experience", qty: 3 },
    { name: "Wanderer's Advice", qty: 5 },
  ]);
  assert.deepEqual([gi[0].cost, gi[1].cost], [24200, 140000]);
  assert.deepEqual([gi[0].exp, gi[1].exp], [120175, 698500]);

  // HSR wraps its Credit cost in the same {{Card}} template as the EXP books,
  // so the currency must not also be counted as an item.
  const hsr = parseLevelingTable(HSR_TABLE, 'Leveling Characters', 'Credit');
  assert.deepEqual(hsr.map((row) => row.cap), [20, 30]);
  assert.equal(hsr.every((row) => row.items.every((item) => item.name !== 'Credit')), true);
  assert.deepEqual(hsr[1].items, [
    { name: "Traveler's Guide", qty: 13 },
    { name: 'Adventure Log', qty: 5 },
    { name: 'Travel Encounters', qty: 6 },
  ]);
  assert.deepEqual([hsr[0].cost, hsr[1].cost], [11300, 29100]);

  // ZZZ uses one Card List cell and publishes no currency column.
  const zzz = parseLevelingTable(ZZZ_TABLE, 'Agent Leveling', null);
  assert.deepEqual(zzz.map((row) => row.cap), [10, 20]);
  assert.deepEqual(zzz[1].items, [{ name: 'Senior Investigator Log', qty: 10 }]);
  assert.deepEqual(zzz.map((row) => row.cost), [0, 0]);
});

test('a missing section or table fails loudly instead of shipping an empty table', () => {
  assert.throws(() => parseLevelingTable(GI_TABLE, 'Nonexistent Section'), /section not found/);
  assert.throws(() => parseLevelingTable('==Leveling Characters==\nno table here', 'Leveling Characters'), /table not found/);
});

test('the shipped leveling data covers every game with a published table', () => {
  for (const [game, config] of Object.entries(GAME_CONFIG)) {
    const file = path.resolve(rootDir, 'Database', 'Leveling', `${game}.json`);
    assert.ok(fs.existsSync(file), `${game} leveling data is shipped`);
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.game, game);
    assert.ok(payload.stages.length >= 5, `${game} has every level band`);
    // Caps ascend, subtotals never shrink, and every item resolved to a real
    // GameData id and icon (a name-only row would render as a blank tile).
    let previousCap = 0;
    let previousCost = -1;
    for (const stage of payload.stages) {
      assert.ok(stage.cap > previousCap, `${game} caps ascend`);
      assert.ok(stage.cost >= previousCost, `${game} costs are cumulative`);
      previousCap = stage.cap;
      previousCost = stage.cost;
      assert.ok(stage.items.length > 0, `${game} Lv ${stage.cap} lists its EXP items`);
      for (const item of stage.items) {
        assert.ok(item.id, `${game} Lv ${stage.cap} ${item.name} resolved to a GameData id`);
        assert.ok(item.icon, `${game} Lv ${stage.cap} ${item.name} has an icon`);
        assert.ok(item.qty > 0);
        if (config.currency) assert.notEqual(item.name, config.currency.name, 'the currency is not an item');
      }
    }
    assert.equal(payload.stages.at(-1).cap, payload.maxLevel);
  }
});

test('the scraped totals reproduce the figures the site shipped before', () => {
  // The site carried these max-level numbers as hand-maintained constants. The
  // scrape agreeing with them is the check that the parse is reading the table
  // correctly — and where it disagrees (WuWa listed 2/2/121 potions and no
  // Medium at all) the wiki is the source of truth.
  const expected = {
    gi: { cost: 1673400, items: { "Hero's Wit": 415, "Adventurer's Experience": 11, "Wanderer's Advice": 12 } },
    hsr: { cost: 580100, items: { "Traveler's Guide": 287, 'Adventure Log': 9, 'Travel Encounters': 16 } },
    zzz: { cost: 0, items: { 'Senior Investigator Log': 300 } },
    wuwa: { cost: 853300, items: { 'Basic Resonance Potion': 12, 'Medium Resonance Potion': 7, 'Advanced Resonance Potion': 6, 'Premium Resonance Potion': 118 } },
  };
  for (const [game, want] of Object.entries(expected)) {
    const payload = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'Database', 'Leveling', `${game}.json`), 'utf8'));
    const final = payload.stages.at(-1);
    assert.equal(final.cost, want.cost, `${game} total currency`);
    assert.deepEqual(Object.fromEntries(final.items.map((item) => [item.name, item.qty])), want.items, `${game} total items`);
  }
});
