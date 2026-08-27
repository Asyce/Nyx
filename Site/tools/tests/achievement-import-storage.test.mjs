import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const featureDir = path.resolve(here, '../../src/features/achievements');
const source = (
  await Promise.all([
    'achievement-core.js',
    'achievement-storage.js',
    'achievement-import.js',
  ].map((name) => fs.readFile(path.join(featureDir, name), 'utf8')))
).join('\n');

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    key: (index) => Array.from(data.keys())[index] || null,
    get length() { return data.size; },
    data,
  };
}

function sandbox() {
  const window = {};
  const context = vm.createContext({
    window,
    console,
    Date,
    Math,
    Set,
    JSON,
    encodeURIComponent,
  });
  vm.runInContext(source, context);
  return {
    Core: window.NyxAchievementCore,
    Storage: window.NyxAchievementStore,
    Importer: window.NyxAchievementImport,
  };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test('Stardb preview uses stable IDs and reports known, unknown, duplicate, and invalid rows', () => {
  const { Importer } = sandbox();
  const parsed = Importer.parse({ gi_achievements: [1001, '01001', '1002', '9999', 'not-an-id'] });
  const result = plain(Importer.preview(parsed, 'gi', [{ id: 1001, name: 'ignored' }, { id: '1002' }]));

  assert.deepEqual(result.knownIds, ['1001', '1002']);
  assert.deepEqual(result.unknownIds, ['9999']);
  assert.equal(result.inputCount, 5);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.invalidCount, 1);
  assert.equal(result.newCompletedCount, 2);
  assert.equal(result.newUnknownCount, 1);
});

test('repeat import is idempotent and imports never uncheck existing progress', () => {
  const { Storage, Importer } = sandbox();
  const store = Storage.create(memoryStorage());
  store.createProfile({ game: 'gi', label: 'Main', completedIds: ['1003'] }, { id: 'profile-a', now: 10 });

  const parsed = Importer.parse({ gi_achievements: ['1001', '1002'] });
  const firstPreview = Importer.preview(parsed, 'gi', ['1001', '1002', '1003'], store.loadProfile('gi', 'profile-a'));
  const first = Importer.apply(store, 'profile-a', firstPreview, { now: 20 });
  const secondPreview = Importer.preview(parsed, 'gi', ['1001', '1002', '1003'], store.loadProfile('gi', 'profile-a'));
  const second = Importer.apply(store, 'profile-a', secondPreview, { now: 30 });

  assert.equal(first.added, 2);
  assert.equal(second.added, 0);
  assert.equal(second.unknownAdded, 0);
  assert.deepEqual(plain(second.profile.completedIds).sort(), ['1001', '1002', '1003']);
});

test('Desktop achievement artifacts parse as Stardb previews without retaining account bindings', () => {
  const { Importer } = sandbox();
  const parsed = plain(Importer.parse(JSON.stringify({
    kind: 'pengo-achievements',
    version: 1,
    game: 'hsr',
    accountBinding: {
      scheme: 'pengo-install-hmac-v1',
      value: 'AbCdEfGhIjKlMnOp_1234-5678',
      region: 'prod_official_eur',
    },
    catalogVersion: 'hsr-4.4',
    exportedAt: '2026-07-29T12:00:00Z',
    achievements: [{ id:1, status:'complete' }, { id:9007199254740991, status:'complete' }],
  })));

  assert.deepEqual(parsed, {
    format: 'stardb',
    game: 'hsr',
    ids: ['1', '9007199254740991'],
    inputCount: 2,
    duplicateCount: 0,
    invalidCount: 0,
  });
  assert.equal(Object.hasOwn(parsed, 'accountBinding'), false);
});

test('Desktop artifact validation rejects malformed, extra, unsorted, and wrong-game previews', () => {
  const { Importer } = sandbox();
  const artifact = {
    kind:'pengo-achievements', version:1, game:'hsr', catalogVersion:'hsr-4.4',
    exportedAt:'2026-07-29T12:00:00Z', achievements:[{ id:1, status:'complete' }],
  };
  const rejected = [
    { ...artifact, extra:true },
    { ...artifact, exportedAt:'not-a-date' },
    { ...artifact, achievements:[{ id:2, status:'complete' }, { id:1, status:'complete' }] },
    { ...artifact, achievements:[{ id:1, status:'partial' }] },
    { ...artifact, achievements:[{ id:1, status:'complete', extra:true }] },
    { ...artifact, accountBinding:{ scheme:'pengo-install-hmac-v1', value:'unsafe value', region:'eur' } },
  ];
  for (const value of rejected) {
    assert.throws(() => Importer.parse(value), (error) => error.code === 'INVALID_DESKTOP_ARTIFACT');
  }
  const parsed = Importer.parse(artifact);
  assert.throws(() => Importer.preview(parsed, 'gi', ['1']), (error) => error.code === 'WRONG_GAME');
});

test('repeat merge of a representative Desktop artifact adds progress only once', () => {
  const { Storage, Importer } = sandbox();
  const store = Storage.create(memoryStorage());
  store.createProfile({ game:'hsr', completedIds:['3'] }, { id:'desktop-target', now:1 });
  const parsed = Importer.parse({
    kind:'pengo-achievements', version:1, game:'hsr', catalogVersion:'hsr-4.4',
    exportedAt:'2026-07-29T12:00:00Z',
    achievements:[{ id:1, status:'complete' }, { id:2, status:'complete' }],
  });
  const firstPreview = Importer.preview(parsed, 'hsr', ['1', '2', '3'], store.loadProfile('hsr', 'desktop-target'));
  const first = Importer.apply(store, 'desktop-target', firstPreview, { mode:'merge', now:2 });
  const secondPreview = Importer.preview(parsed, 'hsr', ['1', '2', '3'], store.loadProfile('hsr', 'desktop-target'));
  const second = Importer.apply(store, 'desktop-target', secondPreview, { mode:'merge', now:3 });

  assert.ok(first.added > 0);
  assert.equal(secondPreview.newCompletedCount, 0);
  assert.equal(second.added, 0);
});

test('wrong-game import is rejected before it can change the profile', () => {
  const { Storage, Importer } = sandbox();
  const store = Storage.create(memoryStorage());
  store.createProfile({ game: 'hsr', label: 'Trailblazer' }, { id: 'hsr-a', now: 10 });
  const parsed = Importer.parse({ gi_achievements: ['1001'] });

  assert.throws(
    () => Importer.preview(parsed, 'hsr', ['1001'], store.loadProfile('hsr', 'hsr-a')),
    (error) => error.code === 'WRONG_GAME',
  );
  assert.deepEqual(plain(store.loadProfile('hsr', 'hsr-a').completedIds), []);
});

test('an import preview cannot be applied after switching profiles', () => {
  const { Storage, Importer } = sandbox();
  const store = Storage.create(memoryStorage());
  const first = store.createProfile({ game:'gi', label:'First' }, { id:'first', now:1 });
  const second = store.createProfile({ game:'gi', label:'Second' }, { id:'second', now:2 });
  const parsed = Importer.parse('{"gi_achievements":[80091]}');
  const preview = Importer.preview(parsed, 'gi', ['80091'], first);
  assert.throws(() => Importer.apply(store, second.id, preview), (error) => error.code === 'WRONG_PROFILE');
  assert.deepEqual(plain(store.loadProfile('gi', second.id).completedIds), []);
});

test('unknown IDs mark nothing but are retained for a future catalog update', () => {
  const { Storage, Importer } = sandbox();
  const store = Storage.create(memoryStorage());
  store.createProfile({ game: 'gi' }, { id: 'profile-a', now: 10 });
  const parsed = Importer.parse({ gi_achievements: ['1001', '9001'] });
  const result = Importer.preview(parsed, 'gi', ['1001'], store.loadProfile('gi', 'profile-a'));
  Importer.apply(store, 'profile-a', result, { now: 20 });
  const saved = plain(store.loadProfile('gi', 'profile-a'));

  assert.deepEqual(saved.completedIds, ['1001']);
  assert.deepEqual(saved.unknownIds, ['9001']);
});

test('profiles remain isolated by both game and local profile ID', () => {
  const { Storage } = sandbox();
  const store = Storage.create(memoryStorage());
  store.createProfile({ game: 'gi', label: 'GI one' }, { id: 'same-local-id', now: 10 });
  store.createProfile({ game: 'hsr', label: 'HSR one' }, { id: 'same-local-id', now: 11 });
  store.createProfile({ game: 'gi', label: 'GI two' }, { id: 'other-local-id', now: 12 });

  store.mergeProgress('gi', 'same-local-id', ['1001'], [], { now: 20 });
  store.mergeProgress('hsr', 'same-local-id', ['2001'], [], { now: 21 });

  assert.deepEqual(plain(store.loadProfile('gi', 'same-local-id').completedIds), ['1001']);
  assert.deepEqual(plain(store.loadProfile('hsr', 'same-local-id').completedIds), ['2001']);
  assert.deepEqual(plain(store.loadProfile('gi', 'other-local-id').completedIds), []);
  assert.equal(store.listProfiles('gi').length, 2);
  assert.equal(store.listProfiles('hsr').length, 1);
});

test('manual correction checks and unchecks one stable achievement ID', () => {
  const { Storage } = sandbox();
  const store = Storage.create(memoryStorage());
  store.createProfile({ game: 'gi', unknownIds: ['1001', '9999'] }, { id: 'profile-a', now: 10 });

  const checked = plain(store.setCompleted('gi', 'profile-a', '01001', true, { now: 20 }));
  assert.deepEqual(checked.completedIds, ['1001']);
  assert.deepEqual(checked.unknownIds, ['9999'], 'manually understood ID leaves the unknown list');

  const unchecked = plain(store.setCompleted('gi', 'profile-a', '1001', false, { now: 30 }));
  assert.deepEqual(unchecked.completedIds, []);
  assert.deepEqual(unchecked.unknownIds, ['9999']);
});

test('Nyx backup round-trips labels, optional UIDs, progress, and unknown IDs', () => {
  const { Storage, Importer } = sandbox();
  const sourceStore = Storage.create(memoryStorage());
  sourceStore.createProfile({
    game: 'hsr',
    label: 'EU account',
    uid: '700000001',
    completedIds: ['2001', '2002'],
    unknownIds: ['2999'],
  }, { id: 'trailblazer-a', now: 10 });

  const backup = plain(sourceStore.exportBackup({ now: 40 }));
  const parsed = Importer.parse(JSON.stringify(backup));
  const restoredStore = Storage.create(memoryStorage());
  const result = Importer.restoreBackup(restoredStore, parsed);
  const restored = plain(restoredStore.loadProfile('hsr', 'trailblazer-a'));

  assert.equal(result.created, 1);
  assert.equal(restored.label, 'EU account');
  assert.equal(restored.uid, '700000001');
  assert.deepEqual(restored.completedIds, ['2001', '2002']);
  assert.deepEqual(restored.unknownIds, ['2999']);
  assert.equal(backup.kind, Storage.BACKUP_KIND);
});

test('backup restore is additive over newer local progress', () => {
  const { Storage } = sandbox();
  const storage = memoryStorage();
  const store = Storage.create(storage);
  store.createProfile({ game: 'gi', completedIds: ['1002'] }, { id: 'profile-a', now: 20 });
  const bundle = {
    kind: Storage.BACKUP_KIND,
    version: Storage.BACKUP_VERSION,
    exportedAt: 10,
    profiles: [{
      version: 1,
      id: 'profile-a',
      game: 'gi',
      label: 'Older backup',
      uid: '',
      completedIds: ['1001'],
      unknownIds: ['9999'],
      createdAt: 1,
      updatedAt: 10,
    }],
  };

  store.restoreBackup(bundle);
  const restored = plain(store.loadProfile('gi', 'profile-a'));
  assert.deepEqual(restored.completedIds.sort(), ['1001', '1002']);
  assert.deepEqual(restored.unknownIds, ['9999']);
});

test('achievement storage has a separate namespace from pull sync', () => {
  const { Storage } = sandbox();
  const storage = memoryStorage();
  const store = Storage.create(storage);
  store.createProfile({ game: 'gi' }, { id: 'profile-a', now: 10 });

  assert.ok(Array.from(storage.data.keys()).every((key) => key.startsWith('nyx:achievements:v1:')));
  assert.ok(Array.from(storage.data.keys()).every((key) => !key.includes('pull')));
});

test('failed profile index write rolls back the profile blob', () => {
  const { Storage } = sandbox();
  const area = memoryStorage();
  const write = area.setItem;
  area.setItem = (key, value) => {
    if (key === Storage.INDEX_KEY) throw new Error('quota');
    write(key, value);
  };
  assert.throws(() => Storage.create(area).createProfile({ game:'gi' }, { id:'rollback', now:1 }), /quota/);
  assert.equal(area.getItem(Storage.profileKey('gi', 'rollback')), null);
});

test('backup restore validates every profile before writing anything', () => {
  const { Storage } = sandbox();
  const area = memoryStorage();
  const store = Storage.create(area);
  const valid = {
    version:1, id:'valid-first', game:'gi', label:'Valid', uid:'',
    completedIds:['1001'], unknownIds:[], createdAt:1, updatedAt:2,
  };
  const malformed = { ...valid, id:'bad-second', game:'not-a-game' };
  assert.throws(() => store.restoreBackup({
    kind:Storage.BACKUP_KIND,
    version:Storage.BACKUP_VERSION,
    profiles:[valid, malformed],
  }), /game/);
  assert.equal(area.getItem(Storage.profileKey('gi', 'valid-first')), null);
  assert.deepEqual(plain(store.listProfiles()), []);
});

test('replace import changes only the selected profile and reports removals', () => {
  const { Storage, Importer } = sandbox();
  const store = Storage.create(memoryStorage());
  store.createProfile({ game:'gi', completedIds:['1001', '1002'], unknownIds:['9001'] }, { id:'main', now:1 });
  store.createProfile({ game:'gi', completedIds:['1003'] }, { id:'alt', now:2 });
  store.createProfile({ game:'hsr', completedIds:['2001'] }, { id:'rail', now:3 });

  const preview = Importer.preview(
    Importer.parse({ gi_achievements:['1002', '1004', '9002'] }),
    'gi',
    ['1001', '1002', '1003', '1004'],
    store.loadProfile('gi', 'main'),
  );
  assert.equal(preview.replaceCompletedRemovedCount, 1);
  assert.equal(preview.replaceUnknownRemovedCount, 1);
  const result = Importer.apply(store, 'main', preview, { mode:'replace', now:10 });

  assert.deepEqual(plain(result.profile.completedIds), ['1002', '1004']);
  assert.deepEqual(plain(result.profile.unknownIds), ['9002']);
  assert.equal(result.added, 1);
  assert.equal(result.removed, 1);
  assert.deepEqual(plain(store.loadProfile('gi', 'alt').completedIds), ['1003']);
  assert.deepEqual(plain(store.loadProfile('hsr', 'rail').completedIds), ['2001']);
});

test('reset and bulk completion are atomic profile operations', () => {
  const { Storage } = sandbox();
  const store = Storage.create(memoryStorage());
  store.createProfile({ game:'hsr', completedIds:['2001'], unknownIds:['2002', '9999'] }, { id:'main', now:1 });

  const bulk = store.setCompletedMany('hsr', 'main', ['2002', '2003'], true, { now:2 });
  assert.equal(bulk.changed, 2);
  assert.deepEqual(plain(bulk.profile.completedIds).sort(), ['2001', '2002', '2003']);
  assert.deepEqual(plain(bulk.profile.unknownIds), ['9999']);

  const reset = store.resetProgress('hsr', 'main', { now:3 });
  assert.equal(reset.removed, 3);
  assert.equal(reset.unknownRemoved, 1);
  assert.deepEqual(plain(reset.profile.completedIds), []);
  assert.deepEqual(plain(reset.profile.unknownIds), []);
});

test('catalog reconciliation promotes newly-known imported IDs once', () => {
  const { Storage } = sandbox();
  const store = Storage.create(memoryStorage());
  store.createProfile({ game:'gi', unknownIds:['1001', '9001'] }, { id:'main', now:1 });

  const first = store.reconcileCatalog('gi', 'main', ['1001', '1002'], { now:2 });
  const second = store.reconcileCatalog('gi', 'main', ['1001', '1002'], { now:3 });
  assert.equal(first.resolved, 1);
  assert.equal(second.resolved, 0);
  assert.deepEqual(plain(second.profile.completedIds), ['1001']);
  assert.deepEqual(plain(second.profile.unknownIds), ['9001']);
});

test('selected-profile backup excludes every other profile and game', () => {
  const { Storage } = sandbox();
  const store = Storage.create(memoryStorage());
  store.createProfile({ game:'gi', label:'Main' }, { id:'main', now:1 });
  store.createProfile({ game:'gi', label:'Alt' }, { id:'alt', now:2 });
  store.createProfile({ game:'hsr', label:'Rail' }, { id:'rail', now:3 });

  const backup = plain(store.exportBackup({ game:'gi', profileId:'main', now:4 }));
  assert.equal(backup.profiles.length, 1);
  assert.equal(backup.profiles[0].id, 'main');
  assert.equal(backup.profiles[0].game, 'gi');
});
