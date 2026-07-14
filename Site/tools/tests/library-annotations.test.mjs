import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const core = await fs.readFile(path.join(root, 'src/features/library/library-core.js'), 'utf8');
const source = await fs.readFile(path.join(root, 'src/features/library/library-annotations.js'), 'utf8');
const names = [
  'nyxLibraryVolumeFingerprint','nyxLibraryAnchorFromRange','nyxMakeLibraryAnnotation','nyxNormalizeLibraryAnnotation',
  'nyxResolveLibraryAnnotation','nyxResolveLibraryAnnotations','nyxLibraryAnnotationSegments','nyxLibraryAnnotationPresentation',
  'nyxLibrarySelectionFormatState','nyxLibrarySubtractFormatting','nyxMakeLibraryAnnotationUndo',
  'nyxListLibraryAnnotations','nyxSaveLibraryAnnotation','nyxReplaceLibraryAnnotations','nyxCommitLibraryAnnotationMutation',
  'nyxUndoLibraryAnnotations','nyxDeleteLibraryAnnotation','nyxLibraryAnnotationIsQuotaError','NYX_LIBRARY_ANNOTATION_CONTEXT',
];
const context = { Date, Math, Map, Set, Promise, console, setTimeout, clearTimeout, queueMicrotask };
vm.runInNewContext(`${core.replace(/^export /gm, '')}\n${source}\n;globalThis.__api={${names.join(',')}};`, context);
const api = context.__api;
const plain = (value) => JSON.parse(JSON.stringify(value));

const paragraph = (id, text) => ({ type:'paragraph', id, children:[{ type:'text', text }] });
const documentWith = (...blocks) => ({ version:1, blocks });
const scope = { game:'gi', bookId:'toki-alley-tales', volumeKey:'vol-1' };

function makeMark(document, leaf, start, end, extra = {}) {
  const input = {
    ...scope,
    blockId:leaf.id,
    leafType:'paragraph',
    start,
    end,
    leafText:leaf.children[0].text,
    sourceFingerprint:api.nyxLibraryVolumeFingerprint(document),
    style:'highlight',
    color:'rose',
    ...extra,
  };
  if (input.style !== 'highlight' && !Object.hasOwn(extra, 'color')) delete input.color;
  return api.nyxMakeLibraryAnnotation(input, { now:100 });
}

function fakeIndexedDB({ quota = false, abort = false } = {}) {
  const stores = new Map();
  const objectStoreNames = { contains:(name) => stores.has(name) };
  const makeStore = (name, tx) => {
    const map = stores.get(name);
    const request = (operation) => {
      const req = { result:undefined, error:null, onsuccess:null, onerror:null };
      tx.pending += 1;
      queueMicrotask(() => {
        try {
          if (abort) { const error = new Error('transaction aborted'); error.name = 'AbortError'; throw error; }
          req.result = operation(map);
          req.onsuccess?.();
        } catch (error) {
          req.error = error; tx.error = error; tx.failed = true; req.onerror?.(); setTimeout(() => tx.onabort?.(), 0);
        } finally { tx.pending -= 1; tx.finish(); }
      });
      return req;
    };
    return {
      createIndex(){},
      getAll:() => request((target) => Array.from(target.values())),
      put:(value) => request((target) => {
        if (quota) { const error = new Error('disk quota reached'); error.name = 'QuotaExceededError'; throw error; }
        target.set(value.id, structuredClone(value)); return value.id;
      }),
      delete:(id) => request((target) => target.delete(id)),
    };
  };
  const db = {
    objectStoreNames,
    createObjectStore(name){ if (!stores.has(name)) stores.set(name, new Map()); return { createIndex(){} }; },
    close(){},
    transaction(name){
      const tx = { error:null, pending:0, failed:false, completed:false, oncomplete:null, onerror:null, onabort:null };
      tx.finish = () => {
        if (tx.completed || tx.pending || tx.failed) return;
        tx.completed = true; setTimeout(() => tx.oncomplete?.(), 0);
      };
      tx.objectStore = (storeName) => makeStore(storeName, tx);
      setTimeout(tx.finish, 0);
      return tx;
    },
  };
  return {
    stores,
    open(){
      const request = { result:db, error:null, onupgradeneeded:null, onsuccess:null, onerror:null, onblocked:null };
      setTimeout(() => { request.onupgradeneeded?.(); request.onsuccess?.(); }, 0);
      return request;
    },
  };
}

test('UTF-16 anchors preserve emoji and combining marks without splitting surrogate pairs', () => {
  const text = 'A😀e\u0301Z';
  const leaf = paragraph('p-0123456789abcdef', text);
  const document = documentWith(leaf);
  const mark = makeMark(document, leaf, 1, 3);
  assert.equal(mark.anchor.quote, '😀');
  assert.equal(mark.anchor.end - mark.anchor.start, 2);
  assert.throws(() => makeMark(document, leaf, 1, 2), /emoji/);
  const accent = makeMark(document, leaf, 3, 5, { style:'underline' });
  assert.equal(accent.anchor.quote, 'e\u0301');
  assert.equal(accent.color, null);
});

test('unchanged source resolves by stable block and harmless earlier movement reanchors by exact context', () => {
  const text = `${'x'.repeat(80)} Tanuki history survives.`;
  const leaf = paragraph('p-1111111111111111', text);
  const document = documentWith(leaf);
  const start = text.indexOf('Tanuki');
  const mark = makeMark(document, leaf, start, start + 6);
  const stable = api.nyxResolveLibraryAnnotation(mark, document);
  assert.equal(stable.status, 'resolved'); assert.equal(stable.method, 'stable');
  const movedText = `New preface outside context. ${text}`;
  const moved = documentWith(paragraph('p-2222222222222222', movedText));
  const resolved = api.nyxResolveLibraryAnnotation(mark, moved);
  assert.equal(resolved.status, 'resolved'); assert.equal(resolved.method, 'context');
  assert.equal(resolved.start, movedText.indexOf('Tanuki'));
});

test('changed duplicate leaves never bind silently and missing text stays stale', () => {
  const text = 'Before exact quote after';
  const leaf = paragraph('p-3333333333333333', text);
  const original = documentWith(leaf);
  const mark = makeMark(original, leaf, 7, 18);
  const duplicate = documentWith(paragraph('p-4444444444444444', text), paragraph('p-3333333333333333', text));
  assert.equal(api.nyxResolveLibraryAnnotation(mark, duplicate).status, 'stale-ambiguous');
  assert.equal(api.nyxResolveLibraryAnnotation(mark, documentWith(paragraph('p-5555555555555555', 'Gone'))).status, 'stale-missing');
});

test('overlap segmentation preserves source text and unions bold/underline with deterministic highlight color', () => {
  const text = 'abcdef';
  const rows = [
    { status:'resolved', start:0, end:4, annotation:{ id:'a', style:'highlight', color:'violet', updatedAt:1 } },
    { status:'resolved', start:2, end:6, annotation:{ id:'b', style:'highlight', color:'amber', updatedAt:2 } },
    { status:'resolved', start:1, end:5, annotation:{ id:'c', style:'bold', updatedAt:3 } },
    { status:'resolved', start:3, end:6, annotation:{ id:'d', style:'underline', updatedAt:4 } },
  ];
  const segments = api.nyxLibraryAnnotationSegments(text, rows);
  assert.equal(segments.map((segment) => segment.text).join(''), text);
  const center = segments.find((segment) => segment.start === 3);
  assert.deepEqual(plain(api.nyxLibraryAnnotationPresentation(center.annotations)), { bold:true, underline:true, highlightColor:'amber', hasNote:false });
});

test('partial remove splits formatting but preserves a note-only anchor', () => {
  const text = '0123456789';
  const leaf = paragraph('p-6666666666666666', text); const document = documentWith(leaf);
  const mark = makeMark(document, leaf, 1, 9, { note:'Keep me' });
  const result = api.nyxLibrarySubtractFormatting(mark, 4, 6, text, api.nyxLibraryVolumeFingerprint(document), { now:200 });
  assert.deepEqual(plain(result.deleteIds), [mark.id]);
  assert.equal(result.put.filter((row) => row.style === null && row.note === 'Keep me').length, 1);
  assert.deepEqual(plain(result.put.filter((row) => row.style).map((row) => [row.anchor.start, row.anchor.end])), [[1,4],[6,9]]);
});

test('pressed-state coverage and style removal preserve other styles and notes', () => {
  const text = '0123456789';
  const leaf = paragraph('p-aaaaaaaaaaaaaaaa', text); const document = documentWith(leaf);
  const highlight = makeMark(document, leaf, 1, 9, { color:'violet', note:'Keep this note' });
  const bold = makeMark(document, leaf, 1, 9, { style:'bold' });
  const selection = { anchorable:true, blockId:leaf.id, start:3, end:7 };
  const resolved = [highlight, bold].map((annotation) => ({ status:'resolved', blockId:leaf.id, start:1, end:9, annotation }));
  assert.deepEqual(plain(api.nyxLibrarySelectionFormatState(resolved, selection)), {
    highlight:true, underline:false, bold:true, highlightColor:'violet', any:true,
  });
  const removed = api.nyxLibrarySubtractFormatting(highlight, 3, 7, text, api.nyxLibraryVolumeFingerprint(document), { now:200 });
  assert.equal(removed.put.some((row) => row.style === null && row.note === 'Keep this note'), true);
  assert.deepEqual(plain(removed.put.filter((row) => row.style === 'highlight').map((row) => [row.anchor.start, row.anchor.end, row.color])), [
    [1,3,'violet'], [7,9,'violet'],
  ]);
  assert.equal(bold.style, 'bold', 'removing Highlight never changes Bold');
});

test('changing a highlight color replaces the selected range and keeps notes plus outside color', async () => {
  const indexedDB = fakeIndexedDB();
  const text = '0123456789';
  const leaf = paragraph('p-eeeeeeeeeeeeeeee', text); const document = documentWith(leaf);
  const violet = makeMark(document, leaf, 1, 9, { id:'violet-mark', color:'violet', note:'Keep me' });
  await api.nyxCommitLibraryAnnotationMutation([], [violet], { indexedDB });
  const split = api.nyxLibrarySubtractFormatting(violet, 3, 7, text, api.nyxLibraryVolumeFingerprint(document), { now:200 });
  const rose = makeMark(document, leaf, 3, 7, { id:'rose-mark', color:'rose' });
  await api.nyxCommitLibraryAnnotationMutation(split.deleteIds, [...split.put, rose], { indexedDB });
  const rows = await api.nyxListLibraryAnnotations(scope, { indexedDB });
  assert.equal(rows.some((row) => row.note === 'Keep me'), true);
  assert.deepEqual(plain(rows.filter((row) => row.style === 'highlight').map((row) => [row.anchor.start, row.anchor.end, row.color])
    .sort((left, right) => left[0] - right[0])), [[1,3,'violet'], [3,7,'rose'], [7,9,'violet']]);
});

test('IndexedDB add, reload, edit, atomic remove, delete, and scope isolation work', async () => {
  const indexedDB = fakeIndexedDB();
  const leaf = paragraph('p-7777777777777777', 'Tanuki tales'); const document = documentWith(leaf);
  const gi = makeMark(document, leaf, 0, 6, { note:'first' });
  const saved = await api.nyxSaveLibraryAnnotation(gi, { indexedDB, now:10 });
  assert.equal(saved.revision, 1);
  let rows = await api.nyxListLibraryAnnotations(scope, { indexedDB });
  assert.equal(rows.length, 1); assert.equal(rows[0].note, 'first');
  const edited = await api.nyxSaveLibraryAnnotation({ ...rows[0], note:'edited' }, { indexedDB, now:20 });
  assert.equal(edited.revision, 2);
  const hsr = api.nyxMakeLibraryAnnotation({ ...scope, game:'hsr', blockId:leaf.id, leafType:'paragraph', start:0, end:6, leafText:'Tanuki tales', sourceFingerprint:api.nyxLibraryVolumeFingerprint(document), style:'bold' });
  await api.nyxSaveLibraryAnnotation(hsr, { indexedDB });
  assert.equal((await api.nyxListLibraryAnnotations(scope, { indexedDB })).length, 1, 'HSR never leaks into GI');
  const replacement = api.nyxMakeLibraryAnnotation({ ...scope, blockId:leaf.id, leafType:'paragraph', start:7, end:12, leafText:'Tanuki tales', sourceFingerprint:api.nyxLibraryVolumeFingerprint(document), style:'underline' });
  await api.nyxReplaceLibraryAnnotations([edited.id], [replacement], { indexedDB });
  rows = await api.nyxListLibraryAnnotations(scope, { indexedDB });
  assert.equal(rows.length, 1); assert.equal(rows[0].style, 'underline');
  await api.nyxDeleteLibraryAnnotation(rows[0].id, { indexedDB });
  assert.deepEqual(await api.nyxListLibraryAnnotations(scope, { indexedDB }), []);
});

test('one-step Undo reverses create, update, and delete without touching an unrelated cross-tab row', async () => {
  const indexedDB = fakeIndexedDB();
  const leaf = paragraph('p-cccccccccccccccc', 'Tanuki tales'); const document = documentWith(leaf);
  const created = makeMark(document, leaf, 0, 6, { id:'undo-create', note:'original' });
  const createMutation = await api.nyxCommitLibraryAnnotationMutation([], [created], { indexedDB, incrementRevision:true, now:10 });
  const unrelated = makeMark(document, leaf, 7, 12, { id:'other-tab', style:'bold' });
  indexedDB.stores.get('annotations').set(unrelated.id, structuredClone(unrelated));
  assert.deepEqual(plain((await api.nyxUndoLibraryAnnotations(createMutation.undo, { indexedDB })).appliedIds), [created.id]);
  assert.equal(indexedDB.stores.get('annotations').has(created.id), false);
  assert.equal(indexedDB.stores.get('annotations').get(unrelated.id).style, 'bold');

  const base = (await api.nyxCommitLibraryAnnotationMutation([], [created], { indexedDB, incrementRevision:true, now:20 })).rows[0];
  const updateMutation = await api.nyxCommitLibraryAnnotationMutation([], [{ ...base, note:'updated' }], { indexedDB, incrementRevision:true, now:30 });
  await api.nyxUndoLibraryAnnotations(updateMutation.undo, { indexedDB });
  let restored = indexedDB.stores.get('annotations').get(created.id);
  assert.equal(restored.note, 'original');
  assert.equal(restored.schemaVersion, 1, 'existing v1 rows reload unchanged after Undo');

  const deleteMutation = await api.nyxCommitLibraryAnnotationMutation([created.id], [], { indexedDB });
  assert.equal(indexedDB.stores.get('annotations').has(created.id), false);
  await api.nyxUndoLibraryAnnotations(deleteMutation.undo, { indexedDB });
  restored = indexedDB.stores.get('annotations').get(created.id);
  assert.equal(restored.note, 'original');
  assert.equal(indexedDB.stores.get('annotations').get(unrelated.id).style, 'bold');
});

test('Undo is all-or-none when another tab changes one affected annotation ID', async () => {
  const indexedDB = fakeIndexedDB();
  const leaf = paragraph('p-dddddddddddddddd', 'Tanuki tales'); const document = documentWith(leaf);
  const first = makeMark(document, leaf, 0, 6, { id:'first-mark' });
  const second = makeMark(document, leaf, 7, 12, { id:'second-mark', style:'underline' });
  await api.nyxCommitLibraryAnnotationMutation([], [first, second], { indexedDB });
  const deletion = await api.nyxCommitLibraryAnnotationMutation([first.id, second.id], [], { indexedDB });
  const external = { ...structuredClone(first), note:'Changed elsewhere', updatedAt:999, revision:9 };
  indexedDB.stores.get('annotations').set(first.id, external);
  const result = await api.nyxUndoLibraryAnnotations(deletion.undo, { indexedDB });
  assert.deepEqual(plain(result.appliedIds), []);
  assert.deepEqual(plain(result.skippedIds), [first.id]);
  assert.equal(indexedDB.stores.get('annotations').get(first.id).note, 'Changed elsewhere');
  assert.equal(indexedDB.stores.get('annotations').has(second.id), false, 'the other half is not partially restored');
});

test('stored rows require the current schema and corrupt or unknown rows are skipped on read', async () => {
  const indexedDB = fakeIndexedDB();
  const leaf = paragraph('p-aaaaaaaaaaaaaaaa', 'Tanuki records'); const document = documentWith(leaf);
  const valid = makeMark(document, leaf, 0, 6);
  await api.nyxSaveLibraryAnnotation(valid, { indexedDB, now:10 });
  const store = indexedDB.stores.get('annotations');
  const missing = structuredClone(valid); delete missing.schemaVersion; missing.id = 'missing-version';
  store.set(missing.id, missing);
  store.set('old-version', { ...structuredClone(valid), id:'old-version', schemaVersion:0 });
  store.set('unknown-version', { ...structuredClone(valid), id:'unknown-version', schemaVersion:2 });
  store.set('bad-highlight-color', { ...structuredClone(valid), id:'bad-highlight-color', color:'url(javascript:x)' });
  store.set('bad-bold-color', { ...structuredClone(valid), id:'bad-bold-color', style:'bold', color:'rose' });
  const rows = await api.nyxListLibraryAnnotations(scope, { indexedDB });
  assert.deepEqual(rows.map((row) => row.id), [valid.id]);
  assert.throws(() => api.nyxNormalizeLibraryAnnotation(missing), /unsupported storage version/);
  assert.throws(() => makeMark(document, leaf, 0, 6, { schemaVersion:2 }), /unsupported storage version/);
});

test('atomic replace enforces the 1000-record book cap after deletes and puts', async () => {
  const indexedDB = fakeIndexedDB();
  const leaf = paragraph('p-bbbbbbbbbbbbbbbb', 'Tanuki boundary'); const document = documentWith(leaf);
  const template = makeMark(document, leaf, 0, 6);
  await api.nyxSaveLibraryAnnotation(template, { indexedDB });
  const store = indexedDB.stores.get('annotations'); store.clear();
  for (let index = 0; index < 1000; index += 1) store.set(`seed-${index}`, { ...structuredClone(template), id:`seed-${index}` });
  const putA = makeMark(document, leaf, 7, 15, { id:'put-a', style:'bold' });
  const putB = makeMark(document, leaf, 7, 15, { id:'put-b', style:'underline' });
  await assert.rejects(api.nyxReplaceLibraryAnnotations(['seed-0'], [putA, putB], { indexedDB }), /too many personal marks/);
  assert.equal(store.size, 1000); assert.ok(store.has('seed-0')); assert.ok(!store.has('put-a')); assert.ok(!store.has('put-b'));
  await api.nyxReplaceLibraryAnnotations(['seed-0', 'seed-1'], [putA, putB], { indexedDB });
  assert.equal(store.size, 1000); assert.ok(!store.has('seed-0')); assert.ok(!store.has('seed-1')); assert.ok(store.has('put-a')); assert.ok(store.has('put-b'));
});

test('quota and transaction failure remain explicit without corrupting readable source', async () => {
  const leaf = paragraph('p-8888888888888888', 'Readable text'); const document = documentWith(leaf);
  const mark = makeMark(document, leaf, 0, 8);
  await assert.rejects(api.nyxSaveLibraryAnnotation(mark, { indexedDB:fakeIndexedDB({ quota:true }) }), (error) => api.nyxLibraryAnnotationIsQuotaError(error) && /Reading and copying still work/.test(error.message));
  await assert.rejects(api.nyxSaveLibraryAnnotation(mark, { indexedDB:fakeIndexedDB({ abort:true }) }), /aborted|could not be saved/);
  assert.equal(leaf.children[0].text, 'Readable text');
});

test('hostile notes stay literal and hostile styles/colors cannot become executable CSS or HTML', () => {
  const leaf = paragraph('p-9999999999999999', 'safe words'); const document = documentWith(leaf);
  const hostile = makeMark(document, leaf, 0, 4, { style:null, note:'<img src=x onerror=alert(1)><a href="javascript:x">x</a>' });
  assert.match(hostile.note, /<img/); assert.equal(hostile.style, null); assert.equal(hostile.color, null);
  assert.throws(() => makeMark(document, leaf, 0, 4, { style:'position:fixed', note:'' }), /supported annotation style/);
  assert.throws(() => makeMark(document, leaf, 0, 4, { color:'url(javascript:x)' }), /supported highlight color/);
  assert.throws(() => makeMark(document, leaf, 0, 4, { style:'bold', color:'rose' }), /only be used with a highlight/);
  assert.throws(() => makeMark(document, leaf, 0, 4, { style:null, note:'plain', color:'rose' }), /only be used with a highlight/);
  assert.equal(makeMark(document, leaf, 0, 4, { color:null }).color, 'violet');
});
