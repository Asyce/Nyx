// ============================================================
// Nyx — pull history persistence  (window.NyxPullStore)
//
// Local-first pull-history store for Nyx.
// IndexedDB keyed by [game, uid, id] so re-imports merge idempotently
// (a duplicate pull id is a no-op). Every record carries (game, uid) so
// a server-side or cloud merge can dedupe by the same key without extra
// plumbing — this is the seam both cloud backends sit behind:
//
//   Tier 1  browser-local      → this file (IndexedDB)            [now]
//   Tier 2  local file         → exportUIGF / importUIGF          [now-ish]
//   Tier 3a cloud: Google Drive → window.NyxSync provider 'drive' [Phase 3]
//   Tier 3b cloud: account/D1   → window.NyxSync provider 'account'[Phase 3]
//
// NyxSync is a thin registry so C1 and C2 are *both* available as
// opt-in adapters over the same canonical pull set — they are not
// mutually exclusive.
// ============================================================

window.NyxPullStore = (function () {
  'use strict';

  const DB_NAME = 'nyxarium-pulls';
  const DB_VERSION = 1;
  const PULLS = 'pulls';
  const META = 'meta';
  const LOCKED_PULL_FIELDS = ['recordType', 'seqId', 'poolId', 'poolName', 'poolType', 'itemId', 'name', 'itemType', 'rarity', 'obtainedAt', 'isNew', 'isFree', 'batchId'];

  function hasOwn(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }

  function copyPull(value) {
    const out = {
      id: value.id,
      banner: value.banner,
      name: value.name,
      itemId: value.itemId || '',
      itemType: value.itemType,
      rank: value.rank,
      time: value.time,
      sourceBanner: value.sourceBanner || '',
      part: value.part || '',
    };
    for (const field of LOCKED_PULL_FIELDS) if (hasOwn(value, field)) out[field] = value[field];
    return out;
  }

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable in this browser.')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PULLS)) {
          const store = db.createObjectStore(PULLS, { keyPath: ['game', 'uid', 'id'] });
          store.createIndex('byGameUid', ['game', 'uid'], { unique: false });
          store.createIndex('byGameUidBanner', ['game', 'uid', 'banner'], { unique: false });
          store.createIndex('byTime', ['game', 'uid', 'time'], { unique: false });
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META, { keyPath: ['game', 'uid'] });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
    return dbPromise;
  }

  function txDone(tx, result) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(result ? result() : undefined);
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  function abortTx(tx) {
    try { if (tx && typeof tx.abort === 'function') tx.abort(); } catch (e) {}
  }

  function readPulls(game, uid, tx) {
    return openDb().then((db) => {
      const transaction = tx || db.transaction(PULLS, 'readonly');
      const index = transaction.objectStore(PULLS).index('byGameUid');
      return new Promise((resolve, reject) => {
        const out = [];
        const req = index.openCursor(IDBKeyRange.only([game, uid]));
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const v = cursor.value;
            out.push(copyPull(v));
            cursor.continue();
          } else { resolve(out); }
        };
        req.onerror = () => reject(req.error || new Error('cursor failed'));
      });
    });
  }

  async function savePulls(game, uid, pulls, meta) {
    const hasExportMeta = !!(meta && typeof meta === 'object' && (
      meta.account && typeof meta.account === 'object'
      || typeof meta.kind === 'string' && meta.kind
      || Number.isInteger(meta.version)
      || typeof meta.exportedAt === 'string' && meta.exportedAt
      || meta.exportMeta && typeof meta.exportMeta === 'object'
    ));
    if (!pulls || pulls.length === 0) {
      if (!hasExportMeta) return { added: 0, skipped: 0 };
    }
    const db = await openDb();
    const tx = db.transaction([PULLS, META], 'readwrite');
    const store = tx.objectStore(PULLS);
    let added = 0, skipped = 0;
    for (const p of pulls || []) {
      await new Promise((resolve, reject) => {
        const rec = { game: game, uid: uid, id: p.id, banner: p.banner, name: p.name, itemId: p.itemId || '', itemType: p.itemType, rank: p.rank, time: p.time, sourceBanner: p.sourceBanner || '', part: p.part || '' };
        for (const field of LOCKED_PULL_FIELDS) if (hasOwn(p, field)) rec[field] = p[field];
        let r;
        try { r = store.add(rec); } catch (error) { abortTx(tx); reject(error); return; }
        r.onsuccess = () => { added++; resolve(); };
        r.onerror = (e) => {
          const error = r.error || (e && e.target && e.target.error);
          if (error && error.name === 'ConstraintError') { skipped++; if (e && e.preventDefault) e.preventDefault(); resolve(); }
          else { abortTx(tx); reject(error || new Error('IndexedDB write failed')); }
        };
      });
    }
    const all = await readPulls(game, uid, tx);
    const byBanner = Object.create(null);
    for (const p of all) byBanner[p.banner] = (byBanner[p.banner] || 0) + 1;
    const existingMeta = await new Promise((resolve, reject) => {
      const r = tx.objectStore(META).get([game, uid]);
      r.onsuccess = () => resolve(r.result || {});
      r.onerror = () => reject(r.error || new Error('IndexedDB metadata read failed'));
    });
    const savedMeta = Object.assign({}, existingMeta, {
      game: game,
      uid: uid,
      importedAt: Date.now(),
      totalPulls: all.length,
      byBanner: byBanner,
      accountName: meta && hasOwn(meta, 'accountName') ? String(meta.accountName || '') : (existingMeta.accountName || ''),
      sourceLabel: meta && hasOwn(meta, 'sourceLabel') ? String(meta.sourceLabel || '') : (existingMeta.sourceLabel || ''),
      importKind: meta && hasOwn(meta, 'importKind') ? String(meta.importKind || '') : (existingMeta.importKind || ''),
    });
    if (meta && meta.account && typeof meta.account === 'object') savedMeta.account = Object.assign({}, meta.account);
    if (meta && typeof meta.kind === 'string' && meta.kind) savedMeta.kind = meta.kind;
    if (meta && Number.isInteger(meta.version)) savedMeta.version = meta.version;
    if (meta && typeof meta.exportedAt === 'string' && meta.exportedAt) savedMeta.exportedAt = meta.exportedAt;
    if (meta && meta.exportMeta && typeof meta.exportMeta === 'object') savedMeta.exportMeta = Object.assign({}, meta.exportMeta);
    await new Promise((resolve, reject) => {
      let r;
      try { r = tx.objectStore(META).put(savedMeta); } catch (error) { abortTx(tx); reject(error); return; }
      r.onsuccess = resolve;
      r.onerror = () => reject(r.error || new Error('IndexedDB metadata write failed'));
    });
    await txDone(tx);
    return { added: added, skipped: skipped };
  }

  function loadPulls(game, uid) { return readPulls(game, uid); }

  async function loadAllUids(game) {
    const db = await openDb();
    const tx = db.transaction(META, 'readonly');
    const store = tx.objectStore(META);
    return new Promise((resolve, reject) => {
      const out = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          if (cursor.value.game === game) out.push({ uid: cursor.value.uid, importedAt: cursor.value.importedAt, total: cursor.value.totalPulls });
          cursor.continue();
        } else {
          out.sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0));
          resolve(out.map((m) => m.uid));
        }
      };
      req.onerror = () => reject(req.error || new Error('cursor failed'));
    });
  }

  async function loadSummary(game, uid) {
    const db = await openDb();
    const tx = db.transaction(META, 'readonly');
    return new Promise((resolve, reject) => {
      const req = tx.objectStore(META).get([game, uid]);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('get failed'));
    });
  }

  async function listSummaries(game) {
    const db = await openDb();
    const tx = db.transaction(META, 'readonly');
    const store = tx.objectStore(META);
    return new Promise((resolve, reject) => {
      const out = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const v = cursor.value || {};
          if (!game || v.game === game) out.push(Object.assign({}, v));
          cursor.continue();
        } else {
          out.sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0));
          resolve(out);
        }
      };
      req.onerror = () => reject(req.error || new Error('cursor failed'));
    });
  }

  async function exportGame(game) {
    if (game === 'ae') throw new Error('Endfield pull history stays in this browser and cannot be synced.');
    const summaries = await listSummaries(game);
    const accounts = [];
    for (const meta of summaries) {
      const pulls = await loadPulls(meta.game, meta.uid);
      accounts.push({ meta: meta, pulls: pulls });
    }
    return {
      version: 1,
      kind: 'nyx-pull-sync',
      exportedAt: Date.now(),
      game: game,
      accounts: accounts,
    };
  }

  async function importBundle(bundle, opts) {
    if (!bundle || !Array.isArray(bundle.accounts)) throw new Error('Sync payload is not a pull-history bundle.');
    if (bundle.game === 'ae' || bundle.accounts.some((account) => account?.meta?.game === 'ae')) {
      throw new Error('Endfield pull history stays in this browser and cannot be synced.');
    }
    let added = 0;
    let skipped = 0;
    for (const account of bundle.accounts) {
      const meta = account.meta || {};
      const game = meta.game || bundle.game;
      const uid = meta.uid;
      const pulls = account.pulls || [];
      if (!game || !uid || !pulls.length) continue;
      const res = await savePulls(game, uid, pulls, {
        accountName: meta.accountName || '',
        sourceLabel: opts && opts.sourceLabel ? opts.sourceLabel : (meta.sourceLabel || 'Pengo sync'),
        importKind: 'sync',
      });
      added += res.added || 0;
      skipped += res.skipped || 0;
    }
    return { added: added, skipped: skipped };
  }

  async function clearImport(game, uid) {
    const db = await openDb();
    const tx = db.transaction([PULLS, META], 'readwrite');
    const index = tx.objectStore(PULLS).index('byGameUid');
    await new Promise((resolve, reject) => {
      const req = index.openCursor(IDBKeyRange.only([game, uid]));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) { cursor.delete(); cursor.continue(); } else { resolve(); }
      };
      req.onerror = () => reject(req.error || new Error('cursor failed'));
    });
    tx.objectStore(META).delete([game, uid]);
    await txDone(tx);
  }

  return {
    savePulls: savePulls,
    loadPulls: loadPulls,
    loadAllUids: loadAllUids,
    loadSummary: loadSummary,
    listSummaries: listSummaries,
    exportGame: exportGame,
    importBundle: importBundle,
    clearImport: clearImport,
  };
})();

// ---- Sync seam: both cloud backends register here (Phase 3) ----------
// Providers implement { id, label, isReady(), push(game,uid,pulls),
// pull(game,uid) → pulls }. The local store stays the source of truth;
// providers just merge against it. C1 (Google Drive appDataFolder,
// client-side PKCE) and C2 (first-party account → Worker /api/account/*
// + D1) are *both* intended to live here, selectable and combinable.
window.NyxSync = window.NyxSync || (function () {
  'use strict';
  const providers = {};
  return {
    register: function (p) { providers[p.id] = p; },
    list: function () { return Object.values(providers); },
    get: function (id) { return providers[id] || null; },
  };
})();
