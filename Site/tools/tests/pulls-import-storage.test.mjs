import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const featureDir = path.resolve(here, '../../src/features/gacha');
const [engineSource, storageSource] = await Promise.all([
  fs.readFile(path.join(featureDir, 'pulls-engine.js'), 'utf8'),
  fs.readFile(path.join(featureDir, 'pulls-storage.js'), 'utf8'),
]);

function engine() {
  const window = {};
  const context = vm.createContext({
    window,
    console,
    Date,
    Math,
    Map,
    Number,
    Object,
    Reflect,
    Set,
    TextEncoder,
    URL,
    URLSearchParams,
    JSON,
    parseInt,
    isFinite,
  });
  vm.runInContext(engineSource, context);
  return window.NyxPulls;
}

function fakeIndexedDB({ writeErrorName = '' } = {}) {
  const stores = new Map();
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const keyOf = (value) => JSON.stringify(value);

  function request(tx, operation) {
    const req = { result: undefined, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      if (tx.failed) return;
      try {
        req.result = operation();
        req.onsuccess?.();
      } catch (error) {
        req.error = error;
        tx.error = error;
        const event = { preventDefault: () => { event.defaultPrevented = true; }, defaultPrevented: false };
        req.onerror?.(event);
        if (!event.defaultPrevented) {
          tx.failed = true;
          setTimeout(() => tx.onabort?.(), 0);
        }
      }
    });
    return req;
  }

  function cursorRequest(tx, values, predicate) {
    const req = { result: undefined, error: null, onsuccess: null, onerror: null };
    const matches = values.filter(predicate);
    let index = 0;
    const emit = () => {
      if (index >= matches.length) {
        req.result = null;
        req.onsuccess?.();
        return;
      }
      const entry = matches[index];
      const cursor = {
        value: clone(entry.value),
        continue: () => { index += 1; queueMicrotask(emit); },
        delete: () => { stores.get(entry.store).delete(entry.key); },
      };
      req.result = cursor;
      req.onsuccess?.();
    };
    queueMicrotask(emit);
    return req;
  }

  const db = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      return { createIndex() {} };
    },
    transaction(names) {
      const tx = { error: null, oncomplete: null, onerror: null, onabort: null, failed: false };
      const objectStore = (name) => {
        const map = stores.get(name);
        const makeError = (nameValue) => { const error = new Error(nameValue); error.name = nameValue; return error; };
        const keyFor = (value) => {
          if (Array.isArray(value)) return keyOf(value);
          return keyOf(value);
        };
        return {
          add(value) {
            return request(tx, () => {
              if (writeErrorName) throw makeError(writeErrorName);
              const key = keyFor([value.game, value.uid, value.id]);
              if (map.has(key)) throw makeError('ConstraintError');
              map.set(key, clone(value));
              return value;
            });
          },
          get(value) {
            return request(tx, () => clone(map.get(keyFor(value))));
          },
          put(value) {
            return request(tx, () => {
              const key = name === 'meta' ? keyFor([value.game, value.uid]) : keyFor([value.game, value.uid, value.id]);
              map.set(key, clone(value));
              return value;
            });
          },
          delete(value) {
            return request(tx, () => map.delete(keyFor(value)));
          },
          index() {
            return {
              openCursor(range) {
                const wanted = range && range.value;
                return cursorRequest(tx, Array.from(map.entries()).map(([key, value]) => ({ store: name, key, value })), (entry) => {
                  return name === 'pulls' && (!wanted || keyOf([entry.value.game, entry.value.uid]) === keyOf(wanted));
                });
              },
            };
          },
          openCursor() {
            return cursorRequest(tx, Array.from(map.entries()).map(([key, value]) => ({ store: name, key, value })), () => true);
          },
        };
      };
      tx.objectStore = objectStore;
      setTimeout(() => { if (!tx.failed && tx.oncomplete) tx.oncomplete(); }, 0);
      return tx;
    },
  };

  return {
    stores,
    open() {
      const req = { result: db, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
      setTimeout(() => { req.onupgradeneeded?.(); req.onsuccess?.(); }, 0);
      return req;
    },
  };
}

function storage(options) {
  const indexedDB = fakeIndexedDB(options);
  const IDBKeyRange = { only: (value) => ({ value }) };
  const context = vm.createContext({ window: {}, indexedDB, IDBKeyRange, console, Date, Math, Promise, queueMicrotask, setTimeout, clearTimeout });
  vm.runInContext(storageSource, context);
  return { Store: context.window.NyxPullStore, indexedDB };
}

function strictFixture() {
  return {
    kind: 'pengo-pulls',
    version: 1,
    game: 'ae',
    exportedAt: '2026-07-29T12:00:00.0000000+00:00',
    account: { uid: '10001', roleId: '20002', serverId: '2', serverName: 'Europe' },
    records: [
      {
        id: 'character:BASIC:11', recordType: 'character', seqId: '11', poolId: 'BASIC', poolName: 'Basic', poolType: 'basic',
        itemId: '101', name: 'Character', itemType: 'character', rarity: 6, obtainedAt: '2026-07-29T12:00:00.0000000+00:00', isNew: true, isFree: true,
      },
      {
        id: 'weapon:ISSUE_1:10', recordType: 'weapon', seqId: '10', poolId: 'ISSUE_1', poolName: 'Issue One', poolType: 'arsenal',
        itemId: '501', name: 'Weapon', itemType: 'Sword', rarity: 6, obtainedAt: '2026-07-29T12:01:00.0000000+00:00', isNew: false, isFree: false, batchId: 'ISSUE_1',
      },
    ],
  };
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('strict Endfield v1 parse returns the exact profile key and every locked field', () => {
  const parsed = engine().adapterFor('ae').importFile(strictFixture());

  assert.equal(parsed.error, undefined);
  assert.equal(parsed.uid, 'ae:2:20002');
  assert.equal(parsed.strict, true);
  assert.deepEqual(plain(parsed.account), { uid: '10001', roleId: '20002', serverId: '2', serverName: 'Europe' });
  assert.deepEqual(plain(parsed.exportMeta), {
    kind: 'pengo-pulls', version: 1, game: 'ae', exportedAt: '2026-07-29T12:00:00.0000000+00:00',
  });
  assert.equal(parsed.pulls[0].banner, 'character');
  assert.equal(parsed.pulls[0].poolType, 'basic');
  assert.equal(parsed.pulls[0].time, Date.parse(parsed.pulls[0].obtainedAt));
  assert.equal(parsed.pulls[1].banner, 'weapon');
  assert.equal(parsed.pulls[1].batchId, 'ISSUE_1');
  for (const field of ['id', 'recordType', 'seqId', 'poolId', 'poolName', 'poolType', 'itemId', 'name', 'itemType', 'rarity', 'obtainedAt', 'isNew', 'isFree']) {
    assert.ok(Object.hasOwn(parsed.pulls[0], field), field + ' was dropped');
  }
  assert.ok(Object.hasOwn(parsed.pulls[1], 'batchId'));
});

test('a present wrong kind fails before Endfield legacy heuristics', () => {
  const value = { kind: 'legacy-format', list: [{ id: 'legacy', name: 'Legacy', rank: 5, time: '2026-07-29T12:00:00Z' }] };
  const result = engine().adapterFor('ae').importFile(value);
  assert.match(result.error || '', /invalid/i);
  assert.equal(result.pulls, undefined);
});

test('strict Endfield validation rejects shape, time, id, pool, type, bound, and duplicate violations', () => {
  const rejected = [];
  const check = (label, mutate) => {
    const value = strictFixture();
    mutate(value);
    const result = engine().adapterFor('ae').importFile(value);
    rejected.push(label);
    assert.match(result.error || '', /invalid/i, label);
  };
  check('extra root', (value) => { value.extra = true; });
  check('missing root', (value) => { delete value.records; });
  check('extra account', (value) => { value.account.extra = true; });
  check('non-UTC export offset', (value) => { value.exportedAt = '2026-07-29T12:00:00+01:00'; });
  check('invalid calendar date', (value) => { value.exportedAt = '2026-02-30T12:00:00Z'; });
  check('non-UTC record offset', (value) => { value.records[0].obtainedAt = '2026-07-29T12:00:00-01:00'; });
  check('wrong id', (value) => { value.records[0].id = 'character:BASIC:12'; });
  check('bad sequence', (value) => { value.records[0].seqId = '-1'; });
  check('sequence overflow', (value) => { value.records[0].seqId = '18446744073709551616'; value.records[0].id = 'character:BASIC:18446744073709551616'; });
  check('duplicate id', (value) => { value.records[1].id = 'character:BASIC:11'; value.records[1].recordType = 'character'; delete value.records[1].batchId; value.records[1].poolId = 'BASIC'; value.records[1].poolType = 'basic'; value.records[1].itemType = 'character'; });
  check('character weapon pool', (value) => { value.records[0].poolType = 'arsenal'; });
  check('character item type', (value) => { value.records[0].itemType = 'operator'; });
  check('weapon pool', (value) => { value.records[1].poolType = 'basic'; });
  check('weapon batch', (value) => { value.records[1].batchId = 'OTHER'; });
  check('weapon free', (value) => { value.records[1].isFree = true; });
  check('rarity', (value) => { value.records[0].rarity = 7; });
  check('boolean', (value) => { value.records[0].isNew = 1; });
  check('identifier character', (value) => { value.records[0].itemId = 'bad id'; });
  check('text bound', (value) => { value.records[0].poolName = 'x'.repeat(257); });
  check('identifier bound', (value) => { value.account.uid = 'x'.repeat(129); });
  check('server profile separator', (value) => { value.account.serverId = 'eu:1'; });
  check('role profile separator', (value) => { value.account.roleId = '20:002'; });
  check('record count', (value) => {
    value.records = Array.from({ length: 10001 }, (_, index) => ({
      id: 'character:BASIC:' + index, recordType: 'character', seqId: String(index), poolId: 'BASIC', poolName: 'Basic', poolType: 'basic',
      itemId: '101', name: 'Character', itemType: 'character', rarity: 6, obtainedAt: '2026-07-29T12:00:00Z', isNew: true, isFree: true,
    }));
  });
  assert.equal(rejected.length, 23);
});

test('Endfield legacy JSON remains available when kind is absent, including CSV adapters', () => {
  const parsed = engine().adapterFor('ae').importFile({
    uid: 'ae:2:20002',
    list: [{ id: 'legacy-1', banner: 'character', name: 'Legacy', item_id: '101', item_type: 'operator', rank: 5, time: '2026-07-29 12:00:00' }],
  });
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.uid, 'ae:2:20002');
  assert.equal(parsed.pulls[0].id, 'legacy-1');
  assert.equal(parsed.pulls[0].itemType, 'operator');
  const csv = engine().adapterFor('ae').importCsv('time,name,rank,banner,uid\n2026-07-29T12:00:00Z,CSV Unit,5,character,ae:2:20002');
  assert.equal(csv.pulls.length, 1);
  assert.equal(csv.pulls[0].name, 'CSV Unit');
  assert.equal(csv.uid, 'ae:2:20002');
  const utcMinusFive = engine().adapterFor('ae').importCsv('time,name,rank,banner,uid\n2026-07-29T12:00:00-05:00,Offset Unit,5,character,ae:2:20002');
  assert.equal(utcMinusFive.error, undefined);
  assert.equal(utcMinusFive.pulls[0].time, Date.parse('2026-07-29T12:00:00-05:00'));
  const legacyView = engine().buildViews('ae', csv.pulls)[0];
  assert.deepEqual(
    { top:legacyView.topRank, secondary:legacyView.secondaryRank, ff:legacyView.ff, pityUnavailable:legacyView.pityUnavailable },
    { top:6, secondary:5, ff:false, pityUnavailable:true },
  );

  assert.match(engine().adapterFor('ae').importCsv('time,name,rank,banner\n2026-07-29T12:00:00Z,Missing role,5,character').error || '', /profile ID/);
  assert.match(engine().adapterFor('ae').importFile({ list:[{ id:'missing', name:'Missing identity' }] }).error || '', /profile ID/);
  assert.match(engine().adapterFor('ae').importFile({ uid:'legacy-account', list:[{ id:'unsafe', name:'Unsafe identity' }] }).error || '', /profile ID/);
  assert.match(engine().adapterFor('ae').importFile({ uid:'ae:2:20002', list:[{ id:'mixed', name:'Mixed identity', uid:'ae:3:30003' }] }).error || '', /same profile ID/);
  assert.match(engine().adapterFor('ae').importCsv('time,name,rank,banner,uid\n2026-07-29 12:00:00,Missing offset,5,character,ae:2:20002').error || '', /UTC offset/);
  assert.match(engine().adapterFor('ae').importCsv('time,name,rank,banner,uid\n2026-02-30T12:00:00Z,Impossible date,5,character,ae:2:20002').error || '', /must be valid/);
  assert.match(engine().adapterFor('ae').importCsv('time,name,rank,banner,uid\n2026-07-29T12:00:00Z,One,5,character,ae:2:20002\n2026-07-29T12:01:00Z,Two,5,character,ae:3:30003').error || '', /one account or role/);
  assert.match(engine().adapterFor('ae').importCsv('time,name,rank,banner,uid\n2026-07-29T12:00:00Z,One,5,character,ae:2:20002\n2026-07-29T12:01:00Z,Two,5,character,').error || '', /Every Endfield CSV row/);
  const tooMany = Array.from({ length:10001 }, (_, index) => ({ id:String(index), name:'Row ' + index }));
  assert.match(engine().adapterFor('ae').importFile({ uid:'ae:2:20002', list:tooMany }).error || '', /10,000/);
  const tooManyCsv = 'time,name,rank,banner,uid\n' + Array.from({ length:10001 }, (_, index) => '2026-07-29T12:00:00Z,Row ' + index + ',5,character,ae:2:20002').join('\n');
  assert.match(engine().adapterFor('ae').importCsv(tooManyCsv).error || '', /10,000/);

  const strict = engine().adapterFor('ae').importFile(strictFixture());
  const mixed = engine().buildViews('ae', strict.pulls.concat(csv.pulls));
  assert.equal(mixed.reduce((sum, view) => sum + view.total, 0), strict.pulls.length + csv.pulls.length);
  assert.equal(mixed.find((view) => view.key === 'character').pityUnavailable, true);
});

test('a strict zero-record Endfield export keeps its local account metadata', async () => {
  const value = strictFixture();
  value.records = [];
  const parsed = engine().adapterFor('ae').importFile(value);
  assert.equal(parsed.strict, true);
  assert.deepEqual(plain(parsed.pulls), []);

  const { Store } = storage();
  assert.deepEqual(plain(await Store.savePulls('ae', parsed.uid, parsed.pulls, parsed)), { added:0, skipped:0 });
  const summary = await Store.loadSummary('ae', parsed.uid);
  assert.equal(summary.totalPulls, 0);
  assert.deepEqual(plain(summary.account), plain(parsed.account));
  assert.deepEqual(plain((await Store.listSummaries('ae')).map((row) => row.uid)), [parsed.uid]);
});

test('Endfield pool identifiers named __proto__ remain ordinary data', () => {
  const value = strictFixture();
  value.records = [value.records[0]];
  value.records[0].id = 'character:__proto__:11';
  value.records[0].poolId = '__proto__';
  value.records[0].poolName = '__proto__';
  value.records[0].poolType = 'chartered';
  const pulls = engine();
  const parsed = pulls.adapterFor('ae').importFile(value);
  assert.equal(parsed.error, undefined);
  const view = pulls.buildViews('ae', parsed.pulls)[0];
  assert.equal(view.progress[0].key, 'chartered-featured:__proto__');
});

test('IndexedDB save/load preserves all strict fields, aliases, and export metadata', async () => {
  const parsed = engine().adapterFor('ae').importFile(strictFixture());
  const { Store } = storage();
  const saved = await Store.savePulls('ae', parsed.uid, parsed.pulls, parsed);
  assert.deepEqual(plain(saved), { added: 2, skipped: 0 });
  const loaded = await Store.loadPulls('ae', parsed.uid);
  assert.equal(loaded.length, 2);
  for (const row of loaded) {
    const source = parsed.pulls.find((pull) => pull.id === row.id);
    for (const field of ['id', 'recordType', 'seqId', 'poolId', 'poolName', 'poolType', 'itemId', 'name', 'itemType', 'rarity', 'obtainedAt', 'isNew', 'isFree']) {
      assert.deepEqual(row[field], source[field], field + ' was not retained');
    }
    if (source.recordType === 'weapon') assert.equal(row.batchId, source.batchId);
    assert.equal(row.rank, source.rank);
    assert.equal(row.time, source.time);
    assert.equal(row.banner, source.banner);
    assert.equal(row.sourceBanner, source.sourceBanner);
  }
  const summary = await Store.loadSummary('ae', parsed.uid);
  assert.deepEqual(plain(summary.account), plain(parsed.account));
  assert.equal(summary.kind, 'pengo-pulls');
  assert.equal(summary.version, 1);
  assert.equal(summary.exportedAt, parsed.exportedAt);
  assert.deepEqual(plain(summary.exportMeta), plain(parsed.exportMeta));

  const csv = engine().adapterFor('ae').importCsv('time,name,rank,banner,uid\n2026-07-29T13:00:00-05:00,Manual backfill,5,character,ae:2:20002');
  await Store.savePulls('ae', parsed.uid, csv.pulls, {
    accountName:'Imported history', sourceLabel:'CSV/manual file', importKind:'csv',
    account:null, exportedAt:'', kind:undefined, version:undefined, exportMeta:undefined,
  });
  const afterBackfill = await Store.loadSummary('ae', parsed.uid);
  assert.deepEqual(plain(afterBackfill.account), plain(parsed.account));
  assert.equal(afterBackfill.kind, 'pengo-pulls');
  assert.equal(afterBackfill.version, 1);
  assert.equal(afterBackfill.exportedAt, parsed.exportedAt);
  assert.deepEqual(plain(afterBackfill.exportMeta), plain(parsed.exportMeta));
});

test('duplicate saves skip only ConstraintError records', async () => {
  const parsed = engine().adapterFor('ae').importFile(strictFixture());
  const { Store } = storage();
  assert.deepEqual(plain(await Store.savePulls('ae', parsed.uid, [parsed.pulls[0]], parsed)), { added: 1, skipped: 0 });
  assert.deepEqual(plain(await Store.savePulls('ae', parsed.uid, [parsed.pulls[0]], parsed)), { added: 0, skipped: 1 });
  assert.equal((await Store.loadPulls('ae', parsed.uid)).length, 1);
});

test('non-ConstraintError IndexedDB writes reject and do not become duplicates', async () => {
  const parsed = engine().adapterFor('ae').importFile(strictFixture());
  const { Store } = storage({ writeErrorName: 'QuotaExceededError' });
  await assert.rejects(Store.savePulls('ae', parsed.uid, [parsed.pulls[0]], parsed), (error) => error && error.name === 'QuotaExceededError');
});

test('two strict Endfield profiles remain isolated by their server and role key', async () => {
  const first = engine().adapterFor('ae').importFile(strictFixture());
  const secondRoot = strictFixture();
  secondRoot.account.roleId = '30003';
  secondRoot.account.serverId = '3';
  secondRoot.records[0].id = 'character:OTHER:11';
  secondRoot.records[0].poolId = 'OTHER';
  const second = engine().adapterFor('ae').importFile(secondRoot);
  const { Store } = storage();
  await Store.savePulls('ae', first.uid, [first.pulls[0]], first);
  await Store.savePulls('ae', second.uid, [second.pulls[0]], second);
  assert.equal(first.uid, 'ae:2:20002');
  assert.equal(second.uid, 'ae:3:30003');
  assert.deepEqual(plain((await Store.loadPulls('ae', first.uid)).map((row) => row.id)), ['character:BASIC:11']);
  assert.deepEqual(plain((await Store.loadPulls('ae', second.uid)).map((row) => row.id)), ['character:OTHER:11']);
  assert.deepEqual(plain((await Store.loadAllUids('ae')).sort()), [first.uid, second.uid].sort());
});

test('Endfield cannot enter the pull sync bundle seam', async () => {
  const { Store } = storage();
  await assert.rejects(Store.exportGame('ae'), /stays in this browser/);
  await assert.rejects(Store.importBundle({ game:'ae', accounts:[] }), /stays in this browser/);
  await assert.rejects(Store.importBundle({ game:'gi', accounts:[{ meta:{ game:'ae' }, pulls:[] }] }), /stays in this browser/);
});
