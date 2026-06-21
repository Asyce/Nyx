// ============================================================
// Nyx — pull history persistence  (window.NyxPullStore)
//
// Local-first store, ported from As-I've-Hoarded's asivepulled/storage.
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
            out.push({ id: v.id, banner: v.banner, name: v.name, itemId: v.itemId || '', itemType: v.itemType, rank: v.rank, time: v.time });
            cursor.continue();
          } else { resolve(out); }
        };
        req.onerror = () => reject(req.error || new Error('cursor failed'));
      });
    });
  }

  async function savePulls(game, uid, pulls) {
    if (!pulls || pulls.length === 0) return { added: 0, skipped: 0 };
    const db = await openDb();
    const tx = db.transaction([PULLS, META], 'readwrite');
    const store = tx.objectStore(PULLS);
    let added = 0, skipped = 0;
    for (const p of pulls) {
      await new Promise((resolve) => {
        const rec = { game: game, uid: uid, id: p.id, banner: p.banner, name: p.name, itemId: p.itemId || '', itemType: p.itemType, rank: p.rank, time: p.time };
        const r = store.add(rec);
        r.onsuccess = () => { added++; resolve(); };
        r.onerror = (e) => { skipped++; e.preventDefault(); resolve(); };
      });
    }
    const all = await readPulls(game, uid, tx);
    const byBanner = {};
    for (const p of all) byBanner[p.banner] = (byBanner[p.banner] || 0) + 1;
    tx.objectStore(META).put({ game: game, uid: uid, importedAt: Date.now(), totalPulls: all.length, byBanner: byBanner });
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
