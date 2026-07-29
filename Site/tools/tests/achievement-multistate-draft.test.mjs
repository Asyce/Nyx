import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(here, '../..');
const repoRoot = path.resolve(siteRoot, '..');
const modulePath = path.join(siteRoot, 'src/features/achievements/achievement-multistate-draft.js');
const fixturePath = path.join(repoRoot, 'contracts/pengo-achievements-v2-ae-draft.fixture.json');
const catalogPath = path.join(repoRoot, 'Database/Achievements/candidates/ae/catalog.json');
const FIXTURE_SHA256 = 'dfff90376bc5da50b0c97899d6ebd6cdecc09a4594ca16178850ddc43cbd2689';

const [source, fixtureBytes, catalogBytes] = await Promise.all([
  fs.readFile(modulePath, 'utf8'),
  fs.readFile(fixturePath),
  fs.readFile(catalogPath),
]);
const fixture = JSON.parse(fixtureBytes);
const catalog = JSON.parse(catalogBytes);

function sandbox() {
  const window = {};
  vm.runInContext(source, vm.createContext({ window, Date, JSON, Map, Set, Math }));
  return window.NyxAchievementMultiStateDraft;
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const row = (id, level, options = {}) => ({
  id,
  state: {
    level,
    plated: options.plated === true,
    rareEffect: options.rareEffect === true,
    conditions: options.conditions || [],
  },
});

test('canonical Endfield v2 draft fixture is hash-pinned and validates against the candidate catalog', () => {
  assert.equal(crypto.createHash('sha256').update(fixtureBytes).digest('hex'), FIXTURE_SHA256);
  const parsed = sandbox().parse(fixture, catalog);
  assert.equal(parsed.format, 'pengo-v2-ae-draft');
  assert.equal(parsed.game, 'ae');
  assert.equal(parsed.unbound, true);
  assert.equal(parsed.knownAchievements.length, 3);
  assert.equal(parsed.unknownAchievements.length, 1);
  assert.equal(parsed.unknownAchievements[0].id, 'achv_future_fixture_1');
});

test('Endfield v2 draft rejects unsorted or duplicate achievement and condition IDs', () => {
  const Draft = sandbox();
  const unsorted = clone(fixture);
  unsorted.achievements.reverse();
  assert.throws(() => Draft.parse(unsorted, catalog), (error) => error.code === 'UNSORTED_ACHIEVEMENTS');

  const duplicate = clone(fixture);
  duplicate.achievements.splice(1, 0, clone(duplicate.achievements[0]));
  assert.throws(() => Draft.parse(duplicate, catalog), (error) => error.code === 'DUPLICATE_ACHIEVEMENT');

  const duplicateCondition = clone(fixture);
  duplicateCondition.achievements[0].state.conditions.push(
    clone(duplicateCondition.achievements[0].state.conditions[0]),
  );
  assert.throws(() => Draft.parse(duplicateCondition, catalog), (error) => error.code === 'DUPLICATE_CONDITION');
});

test('Endfield v2 draft enforces catalog levels, capabilities, and condition targets', () => {
  const Draft = sandbox();

  const tooHigh = clone(fixture);
  tooHigh.achievements[0].state.level = 4;
  assert.throws(() => Draft.parse(tooHigh, catalog), (error) => error.code === 'INVALID_LEVEL');

  const unsupportedPlate = clone(fixture);
  unsupportedPlate.achievements[0].state.plated = true;
  assert.throws(() => Draft.parse(unsupportedPlate, catalog), (error) => error.code === 'UNSUPPORTED_PLATING');

  const unsupportedRare = clone(fixture);
  unsupportedRare.achievements[1].state.rareEffect = true;
  assert.throws(() => Draft.parse(unsupportedRare, catalog), (error) => error.code === 'UNSUPPORTED_RARE_EFFECT');

  const wrongTarget = clone(fixture);
  wrongTarget.achievements[0].state.conditions[0].target = 181;
  assert.throws(() => Draft.parse(wrongTarget, catalog), (error) => error.code === 'CATALOG_TARGET_MISMATCH');

  const overTarget = clone(fixture);
  overTarget.achievements[0].state.conditions[0].current = 181;
  assert.throws(() => Draft.parse(overTarget, catalog), (error) => error.code === 'INVALID_CONDITION');
});

test('Endfield v2 merge never lowers levels, flags, counters, or unknown rows', () => {
  const Draft = sandbox();
  const incoming = Draft.parse(fixture, catalog).achievements;
  const current = [
    row('achv_adv_tundra_box', 1, {
      conditions: [{
        id: 'achv_adv_tundra_box_2_cond_1',
        current: 170,
        target: 180,
      }],
    }),
    row('achv_bat_defeat_agtrinit', 3, {
      plated: true,
      conditions: [{
        id: 'achv_bat_defeat_agtrinit_3_cond_1',
        current: 1,
        target: 1,
      }],
    }),
    row('achv_old_unknown', 7),
  ];
  const result = Draft.preview(current, incoming, catalog, { mode: 'merge' });
  const tundra = result.achievements.find((value) => value.id === 'achv_adv_tundra_box');
  assert.equal(tundra.state.level, 2);
  assert.equal(tundra.state.conditions[0].current, 170);
  assert.equal(result.achievements.some((value) => value.id === 'achv_old_unknown'), true);
  assert.equal(result.unknownAchievements.length, 2);
  assert.equal(result.removed, 0);
});

test('Endfield v2 replace is exact for known rows but retains unresolved achievement IDs', () => {
  const Draft = sandbox();
  const current = [
    row('achv_adv_tundra_box', 3, {
      conditions: [{
        id: 'achv_adv_tundra_box_3_cond_1',
        current: 288,
        target: 288,
      }],
    }),
    row('achv_bat_defeat_agtrinit', 3, {
      plated: true,
      conditions: [{
        id: 'achv_bat_defeat_agtrinit_3_cond_1',
        current: 1,
        target: 1,
      }],
    }),
    row('achv_old_unknown', 7),
  ];
  const incoming = [
    row('achv_adv_tundra_box', 1, {
      conditions: [{
        id: 'achv_adv_tundra_box_1_cond_1',
        current: 100,
        target: 120,
      }],
    }),
  ];
  const result = Draft.preview(current, incoming, catalog, { mode: 'replace' });
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.knownAchievements)),
    incoming,
  );
  assert.equal(result.removed, 1);
  assert.equal(result.unknownRetained, 1);
  assert.equal(result.unknownAchievements[0].id, 'achv_old_unknown');
});

test('Endfield v2 merge stops rather than guessing when one condition has conflicting targets', () => {
  const Draft = sandbox();
  const current = [
    row('achv_future_fixture_1', 1, {
      conditions: [{
        id: 'achv_future_fixture_1_cond_1',
        current: 2,
        target: 5,
      }],
    }),
  ];
  const incoming = [
    row('achv_future_fixture_1', 1, {
      conditions: [{
        id: 'achv_future_fixture_1_cond_1',
        current: 3,
        target: 6,
      }],
    }),
  ];
  assert.throws(
    () => Draft.preview(current, incoming, catalog, { mode: 'merge' }),
    (error) => error.code === 'CATALOG_TARGET_MISMATCH',
  );
});
