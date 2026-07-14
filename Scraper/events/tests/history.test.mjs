import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCoverageEntry, validateCoverageManifest, validateHistoryState, walkHistoryPages } from '../history.mjs';

test('bounded history walk resumes from a cursor, deduplicates, and checkpoints complete pages', async () => {
  const checkpoints = [];
  const pages = new Map([
    ['p2', { rows:[{ id:2 }, { id:3 }], next:'p3' }],
    ['p3', { rows:[{ id:3 }, { id:4 }], next:null }],
  ]);
  const result = await walkHistoryPages({
    startCursor:'p2', maxPages:5, delayMs:0,
    fetchPage:async (cursor) => pages.get(cursor),
    getItems:(payload) => payload.rows,
    getNextCursor:(payload) => payload.next,
    itemKey:(row) => row.id,
    onCheckpoint:async (row) => checkpoints.push(row),
  });
  assert.deepEqual(result.items.map((row) => row.id), [2,3,4]);
  assert.equal(result.exhausted, true);
  assert.equal(result.resumeCursor, null);
  assert.equal(checkpoints.length, 2);
  assert.equal(checkpoints[0].nextCursor, 'p3');
});

test('repeated cursors, repeated payloads, and page limits stop adversarial sources', async () => {
  const repeatedCursor = await walkHistoryPages({
    delayMs:0, maxPages:10, fetchPage:async () => ({ rows:[{ id:1 }], next:1 }),
    getItems:(payload) => payload.rows, getNextCursor:(payload) => payload.next,
  });
  assert.match(repeatedCursor.anomaly, /repeated cursor/);
  assert.equal(repeatedCursor.pagesFetched, 1);

  const limited = await walkHistoryPages({
    delayMs:0, maxPages:2, fetchPage:async (page) => ({ rows:[{ id:page }], next:page + 1 }),
    getItems:(payload) => payload.rows, getNextCursor:(payload) => payload.next,
  });
  assert.match(limited.anomaly, /page limit 2/);
  assert.equal(limited.resumeCursor, 3);
});

test('coverage never calls a partial or stale source complete', () => {
  const generatedAt = '2026-07-14T00:00:00.000Z';
  const entry = buildCoverageEntry({
    game:'wuwa', source:{ name:'Official', endpoint:'official.example/menu' }, fetchedAt:generatedAt,
    result:{ events:[{}], fetched:1, pagesFetched:2, pageLimit:3, exhausted:false, anomaly:'page limit 3 reached', gaps:['Official source exposes a rolling window.'] },
    events:[{ start:'2026-01-01T00:00:00.000Z', end:'2026-01-02T00:00:00.000Z' }], previousCount:4,
  });
  assert.equal(entry.status, 'partial');
  assert.equal(entry.exhausted, false);
  assert.deepEqual(validateCoverageManifest({ schemaVersion:1, generatedAt, games:[entry] }), []);
  assert.ok(validateCoverageManifest({ schemaVersion:1, generatedAt, games:[{ ...entry, status:'complete-for-source' }] }).length);
});

test('history state contains only the five public resumable source checkpoints', () => {
  const row = { completedIds:[], resumeCursor:null, exhausted:true, updatedAt:'2026-07-14T00:00:00.000Z' };
  const state = { schemaVersion:1, games:Object.fromEntries(['gi','hsr','zzz','wuwa','endfield'].map((game) => [game, { ...row }])) };
  assert.deepEqual(validateHistoryState(state), []);
  assert.ok(validateHistoryState({ ...state, games:{ ...state.games, secret:{ ...row } } }).length);
  assert.ok(validateHistoryState({ ...state, games:{ ...state.games, wuwa:{ ...row, resumeCursor:42 } } }).length);
});
