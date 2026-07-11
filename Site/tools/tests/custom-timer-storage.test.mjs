import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Load the browser-global storage module as source and run it in a vm
// sandbox with a mock localStorage/window — the same interop pattern as
// Site/tools/test-pinned-favourites.mjs. This exercises the REAL file
// (migration/normalization/cleanup) without a browser.
const here = path.dirname(fileURLToPath(import.meta.url));
const source = await fs.readFile(
  path.resolve(here, '../../src/features/timeline/custom-timer-storage.js'),
  'utf8',
);
const EXPORTS = [
  'nyxCustomTimerKeyV1', 'nyxCustomTimerKeyV2', 'nyxSanitizeRecur', 'nyxSanitizeColor',
  'nyxNormalizeTimerV2', 'nyxNormalizeTimersV2', 'nyxValidateTimersV2', 'nyxMigrateV1ToV2',
  'nyxMakeTimerV2', 'nyxLoadCustomTimersV2', 'nyxSaveCustomTimersV2',
  'nyxSubscribeCustomTimers', 'nyxUpsertCustomTimerV2', 'nyxRemoveCustomTimerV2', 'nyxToggleCustomTimerV2',
];

// Build a fresh sandbox (isolated localStorage) per test. `opts` may
// override setItem / getItem / removeItem to simulate storage failures.
function sandbox(seed = {}, opts = {}) {
  const store = new Map(Object.entries(seed));
  const localStorage = {
    getItem: opts.getItem || ((k) => (store.has(k) ? store.get(k) : null)),
    setItem: opts.setItem || ((k, v) => { store.set(k, String(v)); }),
    removeItem: opts.removeItem || ((k) => { store.delete(k); }),
  };
  const win = {};
  const context = { localStorage, window: win };
  const api = '\n;globalThis.__api={' + EXPORTS.map((n) => `${n}:${n}`).join(',') + '};';
  vm.runInNewContext(source + api, context);
  return { api: context.__api, store, win, localStorage };
}

// Sandbox objects live in the vm realm; clone them into this realm so
// deepStrictEqual compares structure, not cross-realm prototypes.
const plain = (x) => JSON.parse(JSON.stringify(x));

const GAME = 'gi';
const V1KEY = 'nyx:custom-reset-timers:gi:v1';
const V2KEY = 'nyx:custom-reset-timers:gi:v2';
const T = Date.UTC(2026, 6, 11, 4, 0, 0); // a fixed epoch ms

// ---- pure logic --------------------------------------------------------

test('key builders produce the v1/v2 shapes', () => {
  const { api } = sandbox();
  assert.equal(api.nyxCustomTimerKeyV1('gi'), V1KEY);
  assert.equal(api.nyxCustomTimerKeyV2('gi'), V2KEY);
  assert.equal(api.nyxCustomTimerKeyV2(''), 'nyx:custom-reset-timers:nyx:v2');
});

test('migration: point + recurring, corrupt rows skipped, color/enabled added', () => {
  const { api } = sandbox();
  const v1 = [
    { id: 'a', label: 'Boss', target: T, recur: null },                    // -> point
    { id: 'b', label: 'Weekly', target: T, recur: { type: 'interval', days: 7 } }, // -> recurring
    { id: 'c', label: 'Monthly', target: T, recur: { type: 'monthly' } },  // -> recurring
    { label: 'NoTarget', target: 'nope' },                                 // corrupt -> skipped
    null,                                                                   // corrupt -> skipped
    { target: T },                                                          // no label -> skipped
  ];
  const out = plain(api.nyxMigrateV1ToV2(v1));
  assert.equal(out.length, 3, 'three valid rows survive, three corrupt skipped');
  assert.deepEqual(out[0], { id: 'a', label: 'Boss', color: '#8b9cff', enabled: true, type: 'point', target: T });
  assert.deepEqual(out[1], { id: 'b', label: 'Weekly', color: '#8b9cff', enabled: true, type: 'recurring', target: T, recur: { type: 'interval', days: 7 } });
  assert.equal(out[2].type, 'recurring');
  assert.deepEqual(out[2].recur, { type: 'monthly' });
});

test('migration is idempotent (re-migrating normalized output is a no-op)', () => {
  const { api } = sandbox();
  const v1 = [{ id: 'a', label: 'Boss', target: T, recur: { type: 'interval', days: 3 } }];
  const once = api.nyxMigrateV1ToV2(v1);
  const twice = api.nyxMigrateV1ToV2(once);            // v2 rows fed back in
  assert.deepEqual(twice, once);
  assert.deepEqual(api.nyxNormalizeTimersV2(once), once);
});

test('normalize supports range + preserves color/enabled, drops invalid', () => {
  const { api } = sandbox();
  const range = plain(api.nyxNormalizeTimerV2({ id: 'r', label: 'Event', color: '#ff0000', enabled: false, type: 'range', start: T, end: T + 1000 }));
  assert.deepEqual(range, { id: 'r', label: 'Event', color: '#ff0000', enabled: false, type: 'range', start: T, end: T + 1000 });
  assert.equal(api.nyxNormalizeTimerV2({ label: 'Bad', type: 'range', start: T + 5, end: T }), null, 'end<start rejected');
  assert.equal(api.nyxNormalizeTimerV2({ label: 'Bad', type: 'recurring', target: T }), null, 'recurring without recur rejected');
  assert.equal(api.nyxSanitizeColor('not-a-color'), '#8b9cff', 'bad color -> default');
  assert.equal(api.nyxSanitizeColor('#ABC'), '#abc');
});

test('normalize caps at 12 timers', () => {
  const { api } = sandbox();
  const many = Array.from({ length: 20 }, (_, i) => ({ id: String(i), label: 'T' + i, target: T + i }));
  assert.equal(api.nyxNormalizeTimersV2(many).length, 12);
});

// ---- migration safety + storage ---------------------------------------

test('first read migrates, verifies, and deletes v1', () => {
  const seed = { [V1KEY]: JSON.stringify([{ id: 'a', label: 'Boss', target: T, recur: null }]) };
  const { api, store } = sandbox(seed);
  const rows = api.nyxLoadCustomTimersV2(GAME);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'point');
  assert.equal(store.has(V1KEY), false, 'v1 removed after verified v2 write');
  assert.ok(store.has(V2KEY), 'v2 written');
  // Second load reads v2 directly and is stable.
  assert.deepEqual(api.nyxLoadCustomTimersV2(GAME), rows);
});

test('failed WRITE leaves v1 intact; retried on next (working) load', () => {
  const seed = { [V1KEY]: JSON.stringify([{ id: 'a', label: 'Boss', target: T }]) };
  const store = new Map(Object.entries(seed));
  let failWrite = true;
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { if (failWrite) throw new Error('quota'); store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const ctx = { localStorage: ls, window: {} };
  vm.runInNewContext(source + '\n;globalThis.__api={nyxLoadCustomTimersV2:nyxLoadCustomTimersV2};', ctx);
  const rows1 = ctx.__api.nyxLoadCustomTimersV2(GAME);
  assert.equal(rows1.length, 1, 'in-memory migrated copy still returned');
  assert.equal(store.has(V1KEY), true, 'v1 preserved when write fails');
  assert.equal(store.has(V2KEY), false, 'v2 not written');
  failWrite = false;
  const rows2 = ctx.__api.nyxLoadCustomTimersV2(GAME);
  assert.equal(rows2.length, 1);
  assert.equal(store.has(V2KEY), true, 'v2 now written');
  assert.equal(store.has(V1KEY), false, 'v1 cleaned up on retry');
});

test('failed READBACK (silent no-op write) leaves v1 intact', () => {
  const seed = { [V1KEY]: JSON.stringify([{ id: 'a', label: 'Boss', target: T }]) };
  const store = new Map(Object.entries(seed));
  // setItem silently does nothing -> read-back finds no v2 -> verify fails.
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: () => {},
    removeItem: (k) => { store.delete(k); },
  };
  const ctx = { localStorage: ls, window: {} };
  vm.runInNewContext(source + '\n;globalThis.__api={nyxLoadCustomTimersV2:nyxLoadCustomTimersV2};', ctx);
  const rows = ctx.__api.nyxLoadCustomTimersV2(GAME);
  assert.equal(rows.length, 1, 'in-memory copy returned');
  assert.equal(store.has(V1KEY), true, 'v1 preserved when read-back fails');
});

test('failed REMOVAL leaves v1 intact; retried on next load', () => {
  const seed = { [V1KEY]: JSON.stringify([{ id: 'a', label: 'Boss', target: T }]) };
  const store = new Map(Object.entries(seed));
  let failRemove = true;
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { if (failRemove) throw new Error('locked'); store.delete(k); },
  };
  const ctx = { localStorage: ls, window: {} };
  vm.runInNewContext(source + '\n;globalThis.__api={nyxLoadCustomTimersV2:nyxLoadCustomTimersV2};', ctx);
  ctx.__api.nyxLoadCustomTimersV2(GAME);
  assert.equal(store.has(V2KEY), true, 'v2 written');
  assert.equal(store.has(V1KEY), true, 'v1 preserved when removal fails');
  failRemove = false;
  ctx.__api.nyxLoadCustomTimersV2(GAME);              // retry cleanup path
  assert.equal(store.has(V1KEY), false, 'v1 removed on retry once removal works');
});

test('retry cleanup: v2 already present + v1 lingering -> v1 removed', () => {
  const migrated = [{ id: 'a', label: 'Boss', color: '#8b9cff', enabled: true, type: 'point', target: T }];
  const seed = {
    [V1KEY]: JSON.stringify([{ id: 'a', label: 'Boss', target: T }]),
    [V2KEY]: JSON.stringify(migrated),
  };
  const { api, store } = sandbox(seed);
  const rows = plain(api.nyxLoadCustomTimersV2(GAME));
  assert.deepEqual(rows, migrated, 'v2 is authoritative');
  assert.equal(store.has(V1KEY), false, 'lingering v1 cleaned up because v2 holds its data');
});

test('retry cleanup is SKIPPED when v2 does not contain the v1 data (no loss)', () => {
  // User cleared v2 to empty but a v1 with real data still lingers.
  const seed = {
    [V1KEY]: JSON.stringify([{ id: 'a', label: 'Boss', target: T }]),
    [V2KEY]: JSON.stringify([]),
  };
  const { api, store } = sandbox(seed);
  const rows = plain(api.nyxLoadCustomTimersV2(GAME));
  assert.deepEqual(rows, [], 'empty v2 respected');
  assert.equal(store.has(V1KEY), true, 'v1 kept because v2 lacks its rows');
});

test('corrupt (unparseable) v1 blob is NEVER deleted and no empty v2 is written', () => {
  const { api, store } = sandbox({ [V1KEY]: '{this is not valid json!!!' });
  const rows = plain(api.nyxLoadCustomTimersV2(GAME));
  assert.deepEqual(rows, [], 'unreadable v1 surfaces as empty in-memory');
  assert.equal(store.has(V1KEY), true, 'corrupt v1 preserved, not silently discarded');
  assert.equal(store.has(V2KEY), false, 'no empty v2 committed over corrupt v1');
});

test('non-array v1 (object blob) is treated as corrupt and preserved', () => {
  const { api, store } = sandbox({ [V1KEY]: JSON.stringify({ oops: 1 }) });
  api.nyxLoadCustomTimersV2(GAME);
  assert.equal(store.has(V1KEY), true, 'non-array v1 preserved');
  assert.equal(store.has(V2KEY), false, 'no v2 written for non-array v1');
});

test('corrupt v1 lingering alongside a real v2 is left untouched (retry path)', () => {
  const migrated = [{ id: 'a', label: 'Boss', color: '#8b9cff', enabled: true, type: 'point', target: T }];
  const seed = { [V1KEY]: 'not-json', [V2KEY]: JSON.stringify(migrated) };
  const { api, store } = sandbox(seed);
  const rows = plain(api.nyxLoadCustomTimersV2(GAME));
  assert.deepEqual(rows, migrated, 'v2 authoritative');
  assert.equal(store.has(V1KEY), true, 'corrupt v1 not deleted on retry path');
});

test('a CORRUPT v2 does not mask a valid v1: migration recovers instead of returning empty', () => {
  // Sol repro: valid v1 + v2 holding a non-array blob ({}) previously returned [] and left the
  // real timer indefinitely inaccessible. It must migrate from v1 and recover.
  const seed = {
    [V1KEY]: JSON.stringify([{ id: 'a', label: 'Boss', target: T, recur: null }]),
    [V2KEY]: '{}',
  };
  const { api, store } = sandbox(seed);
  const rows = plain(api.nyxLoadCustomTimersV2(GAME));
  assert.equal(rows.length, 1, 'v1 data recovered, not masked by corrupt v2');
  assert.equal(rows[0].type, 'point');
  const v2now = JSON.parse(store.get(V2KEY));
  assert.ok(Array.isArray(v2now) && v2now.length === 1, 'corrupt v2 overwritten by verified migrated store');
  assert.equal(store.has(V1KEY), false, 'v1 removed only after the verified v2 rewrite');
});

test('a corrupt v2 with NO recoverable v1 returns empty in-memory without inventing data', () => {
  const { api } = sandbox({ [V2KEY]: 'not-json-at-all' });
  const rows = plain(api.nyxLoadCustomTimersV2(GAME));
  assert.deepEqual(rows, [], 'no v1 to recover -> empty, no fabrication');
});

test('save round-trips point, range, recurring with color + enabled', () => {
  const { api } = sandbox();
  const input = [
    { id: 'p', label: 'Point', color: '#112233', enabled: true, type: 'point', target: T },
    { id: 'r', label: 'Range', color: '#445566', enabled: false, type: 'range', start: T, end: T + 5000 },
    { id: 'g', label: 'Recur', color: '#778899', enabled: true, type: 'recurring', target: T, recur: { type: 'interval', days: 2 } },
  ];
  const saved = plain(api.nyxSaveCustomTimersV2(GAME, input));
  const loaded = plain(api.nyxLoadCustomTimersV2(GAME));
  assert.deepEqual(loaded, saved);
  assert.deepEqual(loaded, input, 'all three types + color + enabled preserved');
});

// ---- Sol finding #2: two visible surfaces must not clobber each other ---

test('per-id ops: a stale surface removing one timer never loses the other surface\'s new timer', () => {
  // Seed with two timers [A, C]. Both the Reset panel and the timeline load
  // this snapshot. The timeline upserts B; the Reset panel — still holding its
  // stale [A, C] snapshot — removes C. With per-id ops on a FRESH store read,
  // both changes must survive: B added AND C removed, A untouched.
  const A = { id: 'A', label: 'A', color: '#8b9cff', enabled: true, type: 'point', target: T };
  const C = { id: 'C', label: 'C', color: '#8b9cff', enabled: true, type: 'point', target: T + 1000 };
  const seed = { [V2KEY]: JSON.stringify([A, C]) };
  const { api, store } = sandbox(seed);
  // Surface 1 (timeline) adds B via per-id upsert.
  api.nyxUpsertCustomTimerV2(GAME, { id: 'B', label: 'B', target: T + 2000 });
  // Surface 2 (Reset panel), acting on its stale [A, C] view, removes C by id.
  api.nyxRemoveCustomTimerV2(GAME, 'C');
  const final = plain(JSON.parse(store.get(V2KEY)));
  const ids = final.map((r) => r.id).sort();
  assert.deepEqual(ids, ['A', 'B'], 'B survived (not clobbered) and C is gone');
});

test('subscribe: every per-id mutation notifies subscribers with the fresh rows', () => {
  const { api } = sandbox();
  const seen = [];
  const unsub = api.nyxSubscribeCustomTimers(GAME, (rows) => seen.push(plain(rows).map((r) => r.id)));
  api.nyxUpsertCustomTimerV2(GAME, { id: 'x', label: 'X', target: T });
  api.nyxUpsertCustomTimerV2(GAME, { id: 'y', label: 'Y', target: T + 1 });
  api.nyxToggleCustomTimerV2(GAME, 'x', false);
  api.nyxRemoveCustomTimerV2(GAME, 'x');
  unsub();
  api.nyxUpsertCustomTimerV2(GAME, { id: 'z', label: 'Z', target: T + 2 });
  assert.deepEqual(seen, [['x'], ['x', 'y'], ['x', 'y'], ['y']], 'notified on each change; silent after unsubscribe');
});

test('toggle flips enabled on a fresh read without touching other rows', () => {
  const { api } = sandbox();
  api.nyxUpsertCustomTimerV2(GAME, { id: 'a', label: 'A', target: T });
  api.nyxUpsertCustomTimerV2(GAME, { id: 'b', label: 'B', target: T + 1 });
  const rows = plain(api.nyxToggleCustomTimerV2(GAME, 'a', false));
  assert.equal(rows.find((r) => r.id === 'a').enabled, false);
  assert.equal(rows.find((r) => r.id === 'b').enabled, true);
});

test('sanitizeRecur accepts semimonthly and an optional until bound', () => {
  const { api } = sandbox();
  assert.deepEqual(plain(api.nyxSanitizeRecur({ type: 'semimonthly' })), { type: 'semimonthly' });
  assert.deepEqual(plain(api.nyxSanitizeRecur({ type: 'interval', days: 3, until: T })), { type: 'interval', days: 3, until: T });
  assert.deepEqual(plain(api.nyxSanitizeRecur({ type: 'monthly', until: T })), { type: 'monthly', until: T });
  // A recurring timer with until round-trips through make/normalize.
  const g = plain(api.nyxMakeTimerV2({ label: 'S', target: T, recur: { type: 'semimonthly', until: T + 5 } }));
  assert.equal(g.type, 'recurring');
  assert.deepEqual(g.recur, { type: 'semimonthly', until: T + 5 });
});

test('nyxMakeTimerV2 builds point/recurring and rejects bad input', () => {
  const { api } = sandbox();
  const p = api.nyxMakeTimerV2({ label: 'A', target: T });
  assert.equal(p.type, 'point');
  assert.equal(p.color, '#8b9cff');
  const g = api.nyxMakeTimerV2({ label: 'B', target: T, recur: { type: 'monthly' } });
  assert.equal(g.type, 'recurring');
  assert.equal(api.nyxMakeTimerV2({ label: '', target: T }), null);
  assert.equal(api.nyxMakeTimerV2({ label: 'X', target: 'no' }), null);
});
