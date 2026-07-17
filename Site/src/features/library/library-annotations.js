// Browser-local Library annotations. Scraped books stay immutable; every mark
// is a separate, versioned IndexedDB record scoped to one game/book/volume.
const NYX_LIBRARY_ANNOTATION_DB = 'nyx-library-annotations';
const NYX_LIBRARY_ANNOTATION_DB_VERSION = 1;
const NYX_LIBRARY_ANNOTATION_STORE = 'annotations';
const NYX_LIBRARY_ANNOTATION_SCHEMA = 1;
const NYX_LIBRARY_ANNOTATION_CONTEXT = 64;
const NYX_LIBRARY_ANNOTATION_MAX_NOTE = 4000;
const NYX_LIBRARY_ANNOTATION_MAX_QUOTE = 20_000;
const NYX_LIBRARY_ANNOTATION_MAX_PER_BOOK = 1000;
const NYX_LIBRARY_ANNOTATION_STYLES = new Set(['highlight','underline','bold']);
const NYX_LIBRARY_ANNOTATION_COLORS = new Set(['violet','rose','amber','blue','green']);
const NYX_LIBRARY_LEAF_TYPES = new Set(['heading','paragraph','list-item','table-cell']);
const nyxLibraryAnnotationSubscribers = new Set();

function nyxLibraryAnnotationText(value, max){ return String(value ?? '').replace(/\u0000/g, '').slice(0, max); }
function nyxLibraryAnnotationToken(value, max){ return String(value || '').trim().slice(0, max); }
function nyxLibraryAnnotationScopeKey(game, bookId, volumeKey){ return `${game}\u0000${bookId}\u0000${volumeKey}`; }
function nyxLibraryAnnotationBookKey(game, bookId){ return `${game}\u0000${bookId}`; }

function nyxLibraryAnnotationId(){
  try { if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID(); } catch (error) {}
  return `mark-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function nyxLibrarySplitsSurrogate(text, offset){
  if (!Number.isInteger(offset) || offset <= 0 || offset >= text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF;
}

function nyxLibrarySafeContextStart(text, offset){
  let start = Math.max(0, offset - NYX_LIBRARY_ANNOTATION_CONTEXT);
  if (nyxLibrarySplitsSurrogate(text, start)) start += 1;
  return start;
}

function nyxLibrarySafeContextEnd(text, offset){
  let end = Math.min(text.length, offset + NYX_LIBRARY_ANNOTATION_CONTEXT);
  if (nyxLibrarySplitsSurrogate(text, end)) end -= 1;
  return end;
}

function nyxLibraryLeafType(leaf){
  if (leaf?.type === 'heading') return 'heading';
  if (leaf?.type === 'paragraph') return 'paragraph';
  if (leaf?.id?.startsWith('li-')) return 'list-item';
  if (leaf?.id?.startsWith('td-')) return 'table-cell';
  return '';
}

function nyxLibraryVolumeFingerprint(document){
  // FNV-1a over exact ordered leaf tuples. This is a change detector, not a
  // security primitive; exact quote/context checks still authorize a re-anchor.
  const source = nyxLibraryDocumentLeaves(document).map((leaf) => `${nyxLibraryLeafType(leaf)}\u001f${leaf.id || ''}\u001f${nyxLibraryLeafText(leaf)}`).join('\u001e');
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32-${source.length.toString(36)}-${hash.toString(16).padStart(8, '0')}`;
}

function nyxLibraryAnchorFromRange({ blockId, leafType, start, end, leafText, sourceFingerprint }){
  const text = String(leafText ?? '');
  const from = Number(start);
  const to = Number(end);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > text.length) throw new Error('Choose some text inside one paragraph.');
  if (nyxLibrarySplitsSurrogate(text, from) || nyxLibrarySplitsSurrogate(text, to)) throw new Error('That selection cuts through an emoji. Select the whole character.');
  const quote = text.slice(from, to);
  if (!quote.trim()) throw new Error('Choose words, not only spaces.');
  if (quote.length > NYX_LIBRARY_ANNOTATION_MAX_QUOTE) throw new Error('That selection is too long to mark.');
  const safeBlock = nyxLibraryAnnotationToken(blockId, 100);
  const safeType = nyxLibraryAnnotationToken(leafType, 20);
  if (!/^(?:h|p|li|td)-[a-f0-9]{16}(?:-(?:[2-9]|[1-9][0-9]+))?$/.test(safeBlock) || !NYX_LIBRARY_LEAF_TYPES.has(safeType)) throw new Error('This text does not have a safe Library anchor.');
  return {
    blockId:safeBlock,
    leafType:safeType,
    start:from,
    end:to,
    quote,
    prefix:text.slice(nyxLibrarySafeContextStart(text, from), from),
    suffix:text.slice(to, nyxLibrarySafeContextEnd(text, to)),
    sourceFingerprint:nyxLibraryAnnotationToken(sourceFingerprint, 100),
  };
}

function nyxNormalizeLibraryAnnotation(input, options = {}){
  const row = input || {};
  const hasSchemaVersion = Object.prototype.hasOwnProperty.call(row, 'schemaVersion') && row.schemaVersion != null;
  if (hasSchemaVersion ? row.schemaVersion !== NYX_LIBRARY_ANNOTATION_SCHEMA : options.allowMissingSchema !== true) throw new Error('This annotation uses an unsupported storage version.');
  const game = nyxLibraryAnnotationToken(row.game, 10);
  const bookId = nyxLibraryAnnotationToken(row.bookId, 160);
  const volumeKey = nyxLibraryAnnotationToken(row.volumeKey, 160);
  if (!['gi','hsr'].includes(game) || !/^[a-z0-9][a-z0-9-]*$/.test(bookId) || !/^[a-z0-9][a-z0-9-]*$/.test(volumeKey)) throw new Error('This annotation has an invalid Library scope.');
  const anchorInput = row.anchor || {};
  const anchor = {
    blockId:nyxLibraryAnnotationToken(anchorInput.blockId, 100),
    leafType:nyxLibraryAnnotationToken(anchorInput.leafType, 20),
    start:Number(anchorInput.start),
    end:Number(anchorInput.end),
    quote:nyxLibraryAnnotationText(anchorInput.quote, NYX_LIBRARY_ANNOTATION_MAX_QUOTE),
    prefix:nyxLibraryAnnotationText(anchorInput.prefix, NYX_LIBRARY_ANNOTATION_CONTEXT),
    suffix:nyxLibraryAnnotationText(anchorInput.suffix, NYX_LIBRARY_ANNOTATION_CONTEXT),
    sourceFingerprint:nyxLibraryAnnotationToken(anchorInput.sourceFingerprint, 100),
  };
  if (!/^(?:h|p|li|td)-[a-f0-9]{16}(?:-(?:[2-9]|[1-9][0-9]+))?$/.test(anchor.blockId) || !NYX_LIBRARY_LEAF_TYPES.has(anchor.leafType)) throw new Error('This annotation has an invalid text anchor.');
  if (!Number.isInteger(anchor.start) || !Number.isInteger(anchor.end) || anchor.start < 0 || anchor.end <= anchor.start || anchor.end - anchor.start !== anchor.quote.length || !anchor.quote.trim()) throw new Error('This annotation has invalid text offsets.');
  if (nyxLibrarySplitsSurrogate(anchor.quote, 0) || nyxLibrarySplitsSurrogate(anchor.quote, anchor.quote.length)) throw new Error('This annotation cuts through an emoji.');
  const style = row.style == null || row.style === '' ? null : nyxLibraryAnnotationToken(row.style, 20);
  if (style && !NYX_LIBRARY_ANNOTATION_STYLES.has(style)) throw new Error('Choose a supported annotation style.');
  const note = nyxLibraryAnnotationText(row.note, NYX_LIBRARY_ANNOTATION_MAX_NOTE).trim();
  if (!style && !note) throw new Error('Choose formatting or add a note.');
  const requestedColor = nyxLibraryAnnotationToken(row.color, 20);
  if (style === 'highlight' && requestedColor && !NYX_LIBRARY_ANNOTATION_COLORS.has(requestedColor)) throw new Error('Choose a supported highlight color.');
  if (style !== 'highlight' && requestedColor) throw new Error('Color can only be used with a highlight.');
  const color = style === 'highlight' ? (requestedColor || 'violet') : null;
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const createdAt = Number.isFinite(Number(row.createdAt)) ? Number(row.createdAt) : now;
  return {
    schemaVersion:NYX_LIBRARY_ANNOTATION_SCHEMA,
    id:nyxLibraryAnnotationToken(row.id, 180) || nyxLibraryAnnotationId(),
    game,
    bookId,
    volumeKey,
    scopeKey:nyxLibraryAnnotationScopeKey(game, bookId, volumeKey),
    bookKey:nyxLibraryAnnotationBookKey(game, bookId),
    anchor,
    style,
    color,
    note,
    revision:Math.max(1, Number.isInteger(Number(row.revision)) ? Number(row.revision) : 1),
    createdAt,
    updatedAt:now,
  };
}

function nyxMakeLibraryAnnotation(input, options = {}){
  const anchor = nyxLibraryAnchorFromRange(input);
  return nyxNormalizeLibraryAnnotation({ ...input, anchor }, { ...options, allowMissingSchema:true });
}

function nyxLibraryAnnotationContextMatches(text, at, anchor){
  const end = at + anchor.quote.length;
  if (anchor.prefix ? text.slice(Math.max(0, at - anchor.prefix.length), at) !== anchor.prefix : at !== 0) return false;
  if (anchor.suffix ? text.slice(end, end + anchor.suffix.length) !== anchor.suffix : end !== text.length) return false;
  return true;
}

function nyxLibraryAnnotationDirectMatches(text, anchor){
  return anchor.end <= text.length
    && text.slice(anchor.start, anchor.end) === anchor.quote
    && nyxLibraryAnnotationContextMatches(text, anchor.start, anchor);
}

function nyxResolveLibraryAnnotation(annotation, document){
  let row;
  try { row = nyxNormalizeLibraryAnnotation(annotation, { now:annotation.updatedAt }); }
  catch (error) { return { annotation, status:'stale-missing', reason:'invalid-record' }; }
  const leaves = nyxLibraryDocumentLeaves(document).map((leaf) => ({ leaf, blockId:String(leaf.id || ''), leafType:nyxLibraryLeafType(leaf), text:nyxLibraryLeafText(leaf) }));
  const fingerprint = nyxLibraryVolumeFingerprint(document);
  if (row.anchor.sourceFingerprint && row.anchor.sourceFingerprint === fingerprint) {
    const direct = leaves.find((item) => item.blockId === row.anchor.blockId && item.leafType === row.anchor.leafType);
    if (direct && nyxLibraryAnnotationDirectMatches(direct.text, row.anchor)) return { annotation:row, status:'resolved', method:'stable', blockId:direct.blockId, leafType:direct.leafType, start:row.anchor.start, end:row.anchor.end };
    return { annotation:row, status:'stale-missing', reason:'fingerprint-mismatch-record' };
  }
  const candidates = [];
  for (const item of leaves) {
    let at = item.text.indexOf(row.anchor.quote);
    while (at >= 0) {
      if (!nyxLibrarySplitsSurrogate(item.text, at) && !nyxLibrarySplitsSurrogate(item.text, at + row.anchor.quote.length) && nyxLibraryAnnotationContextMatches(item.text, at, row.anchor)) candidates.push({ ...item, start:at, end:at + row.anchor.quote.length });
      at = item.text.indexOf(row.anchor.quote, at + 1);
    }
  }
  if (candidates.length === 1) return { annotation:row, status:'resolved', method:'context', blockId:candidates[0].blockId, leafType:candidates[0].leafType, start:candidates[0].start, end:candidates[0].end };
  return { annotation:row, status:candidates.length ? 'stale-ambiguous' : 'stale-missing', reason:candidates.length ? 'multiple-context-matches' : 'no-context-match' };
}

function nyxResolveLibraryAnnotations(rows, document){ return (Array.isArray(rows) ? rows : []).map((row) => nyxResolveLibraryAnnotation(row, document)); }

function nyxLibraryAnnotationSegments(text, resolvedRows){
  const source = String(text ?? '');
  const valid = (Array.isArray(resolvedRows) ? resolvedRows : []).filter((row) => row?.status === 'resolved' && Number.isInteger(row.start) && Number.isInteger(row.end) && row.start >= 0 && row.end <= source.length && row.end > row.start);
  const boundaries = new Set([0, source.length]);
  valid.forEach((row) => { boundaries.add(row.start); boundaries.add(row.end); });
  const points = [...boundaries].sort((a, b) => a - b);
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]; const end = points[index + 1];
    if (end <= start) continue;
    segments.push({ start, end, text:source.slice(start, end), annotations:valid.filter((row) => row.start < end && row.end > start) });
  }
  return segments;
}

function nyxLibraryAnnotationPresentation(rows){
  const resolved = (Array.isArray(rows) ? rows : []).map((row) => row.annotation || row);
  const highlights = resolved.filter((row) => row.style === 'highlight').sort((a, b) => (Number(a.updatedAt) - Number(b.updatedAt)) || String(a.id).localeCompare(String(b.id)));
  return {
    bold:resolved.some((row) => row.style === 'bold'),
    underline:resolved.some((row) => row.style === 'underline'),
    highlightColor:highlights.length ? highlights[highlights.length - 1].color || 'violet' : null,
    hasNote:resolved.some((row) => !!row.note),
  };
}

function nyxLibrarySelectionFormatState(resolvedRows, selection){
  const empty = { highlight:false, underline:false, bold:false, highlightColor:null, any:false };
  if (!selection?.anchorable || !Number.isInteger(selection.start) || !Number.isInteger(selection.end)) return empty;
  const rows = (Array.isArray(resolvedRows) ? resolvedRows : []).filter((row) => row?.status === 'resolved'
    && row.blockId === selection.blockId && row.annotation?.style && row.start < selection.end && row.end > selection.start);
  const covers = (style) => {
    const ranges = rows.filter((row) => row.annotation.style === style)
      .map((row) => [Math.max(selection.start, row.start), Math.min(selection.end, row.end)])
      .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    let cursor = selection.start;
    for (const [start, end] of ranges) {
      if (start > cursor) return false;
      cursor = Math.max(cursor, end);
      if (cursor >= selection.end) return true;
    }
    return false;
  };
  const highlights = rows.filter((row) => row.annotation.style === 'highlight')
    .sort((left, right) => Number(left.annotation.updatedAt) - Number(right.annotation.updatedAt)
      || String(left.annotation.id).localeCompare(String(right.annotation.id)));
  return {
    highlight:covers('highlight'),
    underline:covers('underline'),
    bold:covers('bold'),
    highlightColor:highlights.length ? highlights[highlights.length - 1].annotation.color || 'violet' : null,
    any:rows.length > 0,
  };
}

function nyxLibrarySubtractFormatting(row, removeStart, removeEnd, leafText, sourceFingerprint, options = {}){
  const annotation = nyxNormalizeLibraryAnnotation(row, { now:options.now ?? row.updatedAt });
  if (!annotation.style || removeEnd <= annotation.anchor.start || removeStart >= annotation.anchor.end) return { deleteIds:[], put:[annotation] };
  const deleteIds = [annotation.id];
  const put = [];
  if (annotation.note) put.push(nyxNormalizeLibraryAnnotation({ ...annotation, id:annotation.id, style:null, color:null, revision:annotation.revision + 1 }, options));
  const fragments = [[annotation.anchor.start, Math.max(annotation.anchor.start, removeStart)], [Math.min(annotation.anchor.end, removeEnd), annotation.anchor.end]];
  for (const [start, end] of fragments) if (end > start) put.push(nyxMakeLibraryAnnotation({ ...annotation, id:undefined, note:'', start, end, leafText, blockId:annotation.anchor.blockId, leafType:annotation.anchor.leafType, sourceFingerprint }, options));
  return { deleteIds, put };
}

function nyxLibraryAnnotationSnapshotRow(row){
  if (!row) return null;
  return nyxNormalizeLibraryAnnotation(row, { now:row.updatedAt });
}

function nyxLibraryAnnotationSnapshotSignature(row){
  const normalized = nyxLibraryAnnotationSnapshotRow(row);
  return normalized ? JSON.stringify(normalized) : null;
}

function nyxMakeLibraryAnnotationUndo(beforeRows, afterRows){
  const before = new Map((beforeRows || []).map((row) => {
    const normalized = nyxLibraryAnnotationSnapshotRow(row);
    return [normalized.id, normalized];
  }));
  const after = new Map((afterRows || []).map((row) => {
    const normalized = nyxLibraryAnnotationSnapshotRow(row);
    return [normalized.id, normalized];
  }));
  const ids = [...new Set([...before.keys(), ...after.keys()])]
    .filter((id) => nyxLibraryAnnotationSnapshotSignature(before.get(id)) !== nyxLibraryAnnotationSnapshotSignature(after.get(id)));
  return {
    ids,
    before:Object.fromEntries(ids.map((id) => [id, before.get(id) || null])),
    after:Object.fromEntries(ids.map((id) => [id, after.get(id) || null])),
  };
}

function nyxLibraryAnnotationRequest(request){
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Library annotation storage request failed.'));
  });
}

function nyxLibraryAnnotationTransaction(transaction){
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Library annotation storage transaction failed.'));
  });
}

function nyxOpenLibraryAnnotationDatabase(factory){
  const idb = factory || (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (!idb) return Promise.reject(new Error('Personal Library marks are not available in this browser.'));
  return new Promise((resolve, reject) => {
    const request = idb.open(NYX_LIBRARY_ANNOTATION_DB, NYX_LIBRARY_ANNOTATION_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(NYX_LIBRARY_ANNOTATION_STORE)) {
        const store = db.createObjectStore(NYX_LIBRARY_ANNOTATION_STORE, { keyPath:'id' });
        if (store && typeof store.createIndex === 'function') {
          store.createIndex('byScope', 'scopeKey', { unique:false });
          store.createIndex('byBook', 'bookKey', { unique:false });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Personal Library marks could not be opened.'));
    request.onblocked = () => reject(new Error('Close other Pengo tabs, then try saving the mark again.'));
  });
}

function nyxLibraryAnnotationIsQuotaError(error){ return !!error && (error.name === 'QuotaExceededError' || /quota|storage.*full/i.test(String(error.message || ''))); }
function nyxLibraryAnnotationFriendlyError(error){
  if (nyxLibraryAnnotationIsQuotaError(error)) { const friendly = new Error('This browser is out of space. Reading and copying still work, but this mark was not saved.'); friendly.name = 'QuotaExceededError'; return friendly; }
  return error instanceof Error ? error : new Error('This mark could not be saved. Reading and copying still work.');
}

async function nyxLibraryAnnotationReadwrite(factory, prepare){
  const db = await nyxOpenLibraryAnnotationDatabase(factory);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(NYX_LIBRARY_ANNOTATION_STORE, 'readwrite');
      const store = tx.objectStore(NYX_LIBRARY_ANNOTATION_STORE);
      const request = store.getAll();
      let result;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error || tx.error || request.error || new Error('Library annotation storage transaction failed.'));
      };
      request.onsuccess = () => {
        try { result = prepare(Array.isArray(request.result) ? request.result : [], store); }
        catch (error) {
          fail(error);
          try { tx.abort?.(); } catch (abortError) {}
        }
      };
      request.onerror = () => fail(request.error);
      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      tx.onabort = tx.onerror = () => fail(tx.error);
    });
  } finally { db.close(); }
}

async function nyxListLibraryAnnotations(scope, options = {}){
  const game = nyxLibraryAnnotationToken(scope?.game, 10); const bookId = nyxLibraryAnnotationToken(scope?.bookId, 160); const volumeKey = nyxLibraryAnnotationToken(scope?.volumeKey, 160);
  const db = await nyxOpenLibraryAnnotationDatabase(options.indexedDB);
  try {
    const tx = db.transaction(NYX_LIBRARY_ANNOTATION_STORE, 'readonly');
    const rows = await nyxLibraryAnnotationRequest(tx.objectStore(NYX_LIBRARY_ANNOTATION_STORE).getAll());
    await nyxLibraryAnnotationTransaction(tx);
    return rows.map((row) => { try { return nyxNormalizeLibraryAnnotation(row, { now:row.updatedAt }); } catch (error) { return null; } })
      .filter((row) => row && row.game === game && row.bookId === bookId && (!volumeKey || row.volumeKey === volumeKey))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  } finally { db.close(); }
}

async function nyxCommitLibraryAnnotationMutation(deleteIds, rows, options = {}){
  const normalized = (Array.isArray(rows) ? rows : []).map((row) => nyxNormalizeLibraryAnnotation(row, options));
  const ids = [...new Set([
    ...(Array.isArray(deleteIds) ? deleteIds : []).map((id) => nyxLibraryAnnotationToken(id, 180)).filter(Boolean),
    ...normalized.map((row) => row.id),
  ])];
  try {
    const result = await nyxLibraryAnnotationReadwrite(options.indexedDB, (existingRows, store) => {
      const finalRows = new Map(existingRows.map((row) => [String(row.id || ''), row]));
      const before = ids.map((id) => finalRows.get(id)).filter(Boolean).map(nyxLibraryAnnotationSnapshotRow);
      const effective = normalized.map((row) => {
        if (options.incrementRevision !== true) return row;
        const existing = finalRows.get(row.id);
        return { ...row, revision:existing ? Math.max(Number(existing.revision) || 1, Number(row.revision) || 1) + 1 : 1 };
      });
      ids.forEach((id) => finalRows.delete(id));
      effective.forEach((row) => finalRows.set(row.id, row));
      const putBookKeys = new Set(effective.map((row) => row.bookKey));
      for (const bookKey of putBookKeys) {
        let count = 0;
        finalRows.forEach((row) => { if (row?.bookKey === bookKey) count += 1; });
        if (count > NYX_LIBRARY_ANNOTATION_MAX_PER_BOOK) throw new Error('This book has too many personal marks. Delete a few before adding more.');
      }
      ids.forEach((id) => store.delete(id));
      effective.forEach((row) => store.put(row));
      const after = ids.map((id) => finalRows.get(id)).filter(Boolean).map(nyxLibraryAnnotationSnapshotRow);
      return { rows:effective, undo:nyxMakeLibraryAnnotationUndo(before, after) };
    });
    nyxLibraryAnnotationSubscribers.forEach((listener) => { try { listener(); } catch (error) {} });
    return result;
  } catch (error) { throw nyxLibraryAnnotationFriendlyError(error); }
}

async function nyxSaveLibraryAnnotation(input, options = {}){
  const result = await nyxCommitLibraryAnnotationMutation([], [input], { ...options, incrementRevision:true });
  return result.rows[0];
}

async function nyxReplaceLibraryAnnotations(deleteIds, rows, options = {}){
  return (await nyxCommitLibraryAnnotationMutation(deleteIds, rows, options)).rows;
}

async function nyxUndoLibraryAnnotations(input, options = {}){
  const undo = input || {};
  const ids = [...new Set((Array.isArray(undo.ids) ? undo.ids : [])
    .map((id) => nyxLibraryAnnotationToken(id, 180)).filter(Boolean))];
  const before = new Map();
  const after = new Map();
  ids.forEach((id) => {
    const beforeRow = undo.before?.[id];
    const afterRow = undo.after?.[id];
    before.set(id, beforeRow ? nyxLibraryAnnotationSnapshotRow(beforeRow) : null);
    after.set(id, afterRow ? nyxLibraryAnnotationSnapshotRow(afterRow) : null);
  });
  if (!ids.length) return { appliedIds:[], skippedIds:[] };
  try {
    const result = await nyxLibraryAnnotationReadwrite(options.indexedDB, (existing, store) => {
      const current = new Map(existing.map((row) => [String(row.id || ''), row]));
      const skippedIds = ids.filter((id) => {
        try { return nyxLibraryAnnotationSnapshotSignature(current.get(id)) !== nyxLibraryAnnotationSnapshotSignature(after.get(id)); }
        catch (error) { return true; }
      });
      // A formatting change may split one mark into several rows. Undo it as one
      // atomic unit: if another tab changed any affected row, restore none of it.
      if (skippedIds.length) return { appliedIds:[], skippedIds };
      ids.forEach((id) => {
        const restore = before.get(id);
        if (restore) current.set(id, restore);
        else current.delete(id);
      });
      const restoredBookKeys = new Set(ids.map((id) => before.get(id)?.bookKey).filter(Boolean));
      for (const bookKey of restoredBookKeys) {
        let count = 0;
        current.forEach((row) => { if (row?.bookKey === bookKey) count += 1; });
        if (count > NYX_LIBRARY_ANNOTATION_MAX_PER_BOOK) throw new Error('This book has too many personal marks. Delete a few before undoing this change.');
      }
      ids.forEach((id) => {
        const restore = before.get(id);
        if (restore) store.put(restore);
        else store.delete(id);
      });
      return { appliedIds:ids, skippedIds:[] };
    });
    if (result.appliedIds.length) nyxLibraryAnnotationSubscribers.forEach((listener) => { try { listener(); } catch (error) {} });
    return result;
  } catch (error) { throw nyxLibraryAnnotationFriendlyError(error); }
}

async function nyxDeleteLibraryAnnotation(id, options = {}){ await nyxReplaceLibraryAnnotations([id], [], options); }
function nyxSubscribeLibraryAnnotations(listener){ nyxLibraryAnnotationSubscribers.add(listener); return () => nyxLibraryAnnotationSubscribers.delete(listener); }
