// ============================================================
// Nyx — shared custom-timer storage (window.NyxCustomTimers)
// One store for BOTH the Overview "Reset Timers" card and the
// (later) banner timeline. Owns the v2 schema, the safe v1->v2
// migration, and normalization/validation.
//
// Build note: the site build has no import/export — every source
// file is JSX-transformed and concatenated into one shared scope
// (see Site/tools/build-site.mjs). So the API is exposed two ways:
//   1. top-level `nyx*` function declarations (in scope for
//      app/nyx-app.jsx, which is concatenated AFTER this file), and
//   2. a `window.NyxCustomTimers` namespace for later timeline code.
// The pure, DOM-free logic (migrate / normalize / validate /
// sanitize) is exercised directly by the Node test, which loads this
// source in a vm sandbox with a mock localStorage/window — the same
// interop pattern as Site/tools/test-pinned-favourites.mjs.
//
// v2 schema  key: nyx:custom-reset-timers:<game>:v2
//   { id, label, color, enabled, type, target?, start?, end?, recur? }
//   type: 'point' | 'range' | 'recurring'
//     point     -> target (epoch ms)
//     range     -> start, end (epoch ms, start <= end)
//     recurring -> target (epoch ms) + recur
//   recur: null | { type:'monthly' } | { type:'interval', days:Number }
// ============================================================

var NYX_CUSTOM_TIMER_DEFAULT_COLOR = '#8b9cff';
var NYX_CUSTOM_TIMER_LABEL_MAX = 42;
var NYX_CUSTOM_TIMER_CAP = 12;

function nyxCustomTimerKeyV1(gameKey){
  return 'nyx:custom-reset-timers:' + (gameKey || 'nyx') + ':v1';
}

function nyxCustomTimerKeyV2(gameKey){
  return 'nyx:custom-reset-timers:' + (gameKey || 'nyx') + ':v2';
}

// Recurrence sanitiser (kept identical in meaning to the v1 card):
// 'interval' fires every N days; 'monthly' fires on the same day-of-month
// at the same time; 'semimonthly' fires on the 1st and 16th (twice-monthly
// cadence like GI Spiral Abyss). Any recurrence may carry an optional
// `until` epoch-ms end bound. Anything else -> null (one-off).
// Keys are inserted in a fixed order so JSON.stringify equality stays
// reliable across normalize/migrate.
function nyxSanitizeRecur(recur){
  if (!recur || typeof recur !== 'object') return null;
  var out = null;
  if (recur.type === 'monthly') out = { type:'monthly' };
  else if (recur.type === 'semimonthly') out = { type:'semimonthly' };
  else if (recur.type === 'interval') {
    var days = Number(recur.days);
    if (!(Number.isFinite(days) && days > 0)) return null;
    out = { type:'interval', days:Math.round(days) };
  } else return null;
  var until = Number(recur.until);
  if (Number.isFinite(until)) out.until = until;
  return out;
}

// Colors are stored as #rgb / #rrggbb; anything else falls back to
// the default so a corrupt value never breaks rendering.
function nyxSanitizeColor(color){
  if (typeof color === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color.trim())) {
    return color.trim().toLowerCase();
  }
  return NYX_CUSTOM_TIMER_DEFAULT_COLOR;
}

// Normalize ONE row into the canonical v2 shape, or null if the row
// cannot be represented (corrupt / missing required fields). Keys are
// always inserted in a fixed order per type so JSON.stringify equality
// is a reliable structural comparison. Idempotent: normalizing an
// already-normalized row returns an identical object.
function nyxNormalizeTimerV2(row){
  if (!row || typeof row !== 'object') return null;
  if (!row.label && row.label !== 0) return null;
  var label = String(row.label).slice(0, NYX_CUSTOM_TIMER_LABEL_MAX);
  if (!label) return null;

  var recur = nyxSanitizeRecur(row.recur);
  var start = Number(row.start);
  var end = Number(row.end);
  var target = Number(row.target);

  // Resolve the effective type. Trust an explicit valid type; otherwise
  // infer from the fields that are present.
  var type = row.type;
  if (type !== 'point' && type !== 'range' && type !== 'recurring') {
    if (recur) type = 'recurring';
    else if (Number.isFinite(start) && Number.isFinite(end)) type = 'range';
    else type = 'point';
  }

  var color = nyxSanitizeColor(row.color);
  var enabled = row.enabled === false ? false : true;
  var id = String(row.id || (label + '-' + (Number.isFinite(target) ? target : (Number.isFinite(start) ? start : '0'))));

  if (type === 'range') {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    return { id:id, label:label, color:color, enabled:enabled, type:'range', start:start, end:end };
  }
  if (type === 'recurring') {
    if (!Number.isFinite(target) || !recur) return null;
    return { id:id, label:label, color:color, enabled:enabled, type:'recurring', target:target, recur:recur };
  }
  // point
  if (!Number.isFinite(target)) return null;
  return { id:id, label:label, color:color, enabled:enabled, type:'point', target:target };
}

// Normalize an array of rows: drop the unrepresentable ones and cap at
// NYX_CUSTOM_TIMER_CAP, matching the v1 card's 12-timer behavior.
function nyxNormalizeTimersV2(rows){
  if (!Array.isArray(rows)) return [];
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var norm = nyxNormalizeTimerV2(rows[i]);
    if (norm) out.push(norm);
  }
  return out.slice(0, NYX_CUSTOM_TIMER_CAP);
}

// A store is valid when it is an array of representable rows within the
// cap. Used as a gate before writing / after read-back.
function nyxValidateTimersV2(rows){
  if (!Array.isArray(rows) || rows.length > NYX_CUSTOM_TIMER_CAP) return false;
  for (var i = 0; i < rows.length; i++) {
    if (!nyxNormalizeTimerV2(rows[i])) return false;
  }
  return true;
}

// Structural equality of two canonical rows / arrays. Both sides must
// already be normalized (stable key order) for this to be meaningful.
function nyxTimerEqual(a, b){
  return JSON.stringify(a) === JSON.stringify(b);
}
function nyxTimersEqual(a, b){
  return JSON.stringify(a) === JSON.stringify(b);
}
// Every `needle` has a structural match somewhere in `hay`.
function nyxTimersContainAll(hay, needles){
  if (!Array.isArray(hay) || !Array.isArray(needles)) return false;
  for (var i = 0; i < needles.length; i++) {
    var found = false;
    for (var j = 0; j < hay.length; j++) {
      if (nyxTimerEqual(hay[j], needles[i])) { found = true; break; }
    }
    if (!found) return false;
  }
  return true;
}

// Migrate the v1 store to canonical v2. v1 rows:
//   { id, label, target(Number epoch ms), recur }
// Rule (plan M2): recur present -> type:'recurring' (carry recur),
// otherwise type:'point'. Preserve id/label/target/recur; add a default
// color and enabled:true. Corrupt rows are skipped, not fatal.
function nyxMigrateV1ToV2(v1Rows){
  if (!Array.isArray(v1Rows)) return [];
  var out = [];
  for (var i = 0; i < v1Rows.length; i++) {
    var row = v1Rows[i];
    if (!row || !row.label) continue;
    var target = Number(row.target);
    if (!Number.isFinite(target)) continue;
    var recur = nyxSanitizeRecur(row.recur);
    var v2 = {
      id: String(row.id || (String(row.label) + '-' + target)),
      label: String(row.label).slice(0, NYX_CUSTOM_TIMER_LABEL_MAX),
      color: NYX_CUSTOM_TIMER_DEFAULT_COLOR,
      enabled: true,
      type: recur ? 'recurring' : 'point',
      target: target,
    };
    if (recur) v2.recur = recur;
    out.push(v2);
  }
  // Normalize to guarantee canonical shape + cap; idempotent.
  return nyxNormalizeTimersV2(out);
}

// Build a single v2 timer from user input (used by the Timers card's
// "Add" and by later timeline forms). Returns a canonical row or null.
function nyxMakeTimerV2(input){
  if (!input) return null;
  return nyxNormalizeTimerV2({
    id: input.id || (String(Date.now()) + '-' + Math.random().toString(16).slice(2)),
    label: input.label,
    color: input.color,
    enabled: input.enabled === false ? false : true,
    type: input.type,
    target: input.target,
    start: input.start,
    end: input.end,
    recur: input.recur,
  });
}

// ---- localStorage-facing helpers (require a DOM `localStorage`) ----

function nyxReadStore_(key){
  // -> { present:Boolean, valid:Boolean, rows:Array }
  // present: a value exists under the key. valid: it parsed as an array (a real store).
  // A present-but-unparseable/non-array value is NOT valid and must NOT be treated as an
  // authoritative empty store, or a corrupt v2 would permanently mask a still-valid v1.
  var raw = null;
  try { raw = localStorage.getItem(key); } catch (e) { return { present:false, valid:false, rows:[] }; }
  if (raw === null) return { present:false, valid:false, rows:[] };
  try { var p = JSON.parse(raw); if (Array.isArray(p)) return { present:true, valid:true, rows:nyxNormalizeTimersV2(p) }; }
  catch (e) { /* fall through to corrupt */ }
  return { present:true, valid:false, rows:[] };
}

// The v1 removal is gated on a verified read-back of v2. `exact` compares
// the whole store (migration commit, where v2 was just written from the
// migrated value); otherwise we only require that every migrated row is
// present in v2 (retry cleanup, where the user may have since added rows).
// Returns true ONLY when v1 was confirmed removed.
function nyxVerifiedRemoveV1_(v2Key, v1Key, expected, exact){
  var back = nyxReadStore_(v2Key);
  if (!back.present || !back.valid) return false;  // read-back failed / vanished / corrupt
  if (!nyxValidateTimersV2(back.rows)) return false;
  var ok = exact ? nyxTimersEqual(back.rows, expected)
                 : nyxTimersContainAll(back.rows, expected);
  if (!ok) return false;                           // v2 does not yet hold the v1 data
  try { localStorage.removeItem(v1Key); } catch (e) { return false; }
  // Confirm the removal actually took.
  try { if (localStorage.getItem(v1Key) !== null) return false; } catch (e) { return false; }
  return true;
}

// First-read migration commit: validate -> write v2 -> read back ->
// normalize -> compare(exact) -> only then remove v1. Any failed step
// leaves v1 untouched (retried on the next load). Returns true on full
// success (v2 written AND v1 removed).
function nyxCommitMigration_(v2Key, v1Key, migrated){
  if (!nyxValidateTimersV2(migrated)) return false;
  try { localStorage.setItem(v2Key, JSON.stringify(migrated)); } catch (e) { return false; }
  return nyxVerifiedRemoveV1_(v2Key, v1Key, migrated, true);
}

// PUBLIC: load the custom timers for a game, performing (idempotent)
// migration and safe v1 cleanup as needed. Always returns the best
// in-memory copy (normalized v2 rows) even if cleanup could not complete.
function nyxLoadCustomTimersV2(gameKey){
  var v2Key = nyxCustomTimerKeyV2(gameKey);
  var v1Key = nyxCustomTimerKeyV1(gameKey);

  var v2 = nyxReadStore_(v2Key);
  if (v2.present && v2.valid) {
    // A valid v2 store exists and is authoritative. If v1 lingers
    // (a previous removal failed), retry the cleanup — gated on v2 still
    // holding all of the migrated v1 rows, so no data can be lost.
    var v1a = nyxReadStore_(v1Key);
    if (v1a.present) {
      var v1RawArr = nyxReadRawArray_(v1Key);
      // Only retry cleanup for a genuinely parseable v1; never delete a corrupt blob.
      if (Array.isArray(v1RawArr)) {
        var migratedRetry = nyxMigrateV1ToV2(v1RawArr);
        nyxVerifiedRemoveV1_(v2Key, v1Key, migratedRetry, false);
      }
    }
    return v2.rows;
  }
  // A present-but-CORRUPT v2 is not authoritative: fall through to the v1 migration path so a
  // still-valid v1 is recovered (the commit below overwrites the corrupt v2 via verified write),
  // instead of the corrupt v2 masking real timer data forever.

  // No usable v2 yet: migrate from v1 (if any) on first read.
  var v1RawArr2 = nyxReadRawArray_(v1Key);
  if (v1RawArr2 === null) return [];               // nothing anywhere
  if (!Array.isArray(v1RawArr2)) return [];         // present but corrupt: leave v1 untouched, write no v2
  var migrated = nyxMigrateV1ToV2(v1RawArr2);
  nyxCommitMigration_(v2Key, v1Key, migrated);      // best-effort; safe on failure
  return migrated;                                  // keep using the in-memory copy regardless
}

// Raw v1 array read (pre-migration shape). Returns:
//   null            -> key absent (nothing to migrate)
//   {corrupt:true}  -> present but unreadable (unparseable, or not an array):
//                      must NOT be migrated-and-deleted, or we would discard
//                      unrecoverable user data behind an "empty" facade.
//   Array           -> parsed v1 array (may be empty)
function nyxReadRawArray_(key){
  var raw = null;
  try { raw = localStorage.getItem(key); } catch (e) { return null; }
  if (raw === null) return null;
  try { var p = JSON.parse(raw); return Array.isArray(p) ? p : { corrupt:true }; }
  catch (e) { return { corrupt:true }; }
}

// PUBLIC: normalize + persist the v2 store for a game. Returns the
// normalized rows that were written.
function nyxSaveCustomTimersV2(gameKey, rows){
  var norm = nyxNormalizeTimersV2(rows);
  try { localStorage.setItem(nyxCustomTimerKeyV2(gameKey), JSON.stringify(norm)); } catch (e) {}
  return norm;
}

// ---- Single source of truth: subscribe + per-id mutations -------------
//
// The Overview "Reset Timers" card and the banner timeline's Custom lane
// are mounted at the same time and edit the SAME v2 store. If each held its
// own snapshot and wrote the whole array, the slower surface would clobber
// the other's newer timers (Sol finding #2). To prevent that:
//   * every mutation reads a FRESH copy from storage, applies ONE per-id
//     change (upsert / remove / toggle), and writes the result — so a stale
//     in-memory snapshot can never overwrite unrelated rows, and
//   * subscribers are notified so both surfaces re-read after any change.

var NYX_CUSTOM_TIMER_SUBS = {};

// Subscribe to changes for a game's timers. `cb(rows)` runs after every
// mutation routed through the per-id helpers below. Returns an unsubscribe.
function nyxSubscribeCustomTimers(gameKey, cb){
  if (typeof cb !== 'function') return function(){};
  var key = String(gameKey == null ? 'nyx' : gameKey);
  var list = NYX_CUSTOM_TIMER_SUBS[key] || (NYX_CUSTOM_TIMER_SUBS[key] = []);
  list.push(cb);
  return function(){
    var arr = NYX_CUSTOM_TIMER_SUBS[key];
    if (!arr) return;
    var i = arr.indexOf(cb);
    if (i !== -1) arr.splice(i, 1);
  };
}

function nyxNotifyCustomTimers_(gameKey, rows){
  var key = String(gameKey == null ? 'nyx' : gameKey);
  var arr = NYX_CUSTOM_TIMER_SUBS[key];
  if (!arr || !arr.length) return;
  var copy = arr.slice();
  for (var i = 0; i < copy.length; i++) { try { copy[i](rows); } catch (e) {} }
}

// Insert or replace a timer by id, on top of the CURRENT persisted store
// (never a caller's stale snapshot). Returns the saved rows.
function nyxUpsertCustomTimerV2(gameKey, timer){
  var norm = nyxNormalizeTimerV2(timer);
  var cur = nyxLoadCustomTimersV2(gameKey);
  if (!norm) return cur;
  var out = [];
  var replaced = false;
  for (var i = 0; i < cur.length; i++) {
    if (cur[i].id === norm.id) { out.push(norm); replaced = true; }
    else out.push(cur[i]);
  }
  if (!replaced) out.push(norm);
  var saved = nyxSaveCustomTimersV2(gameKey, out);
  nyxNotifyCustomTimers_(gameKey, saved);
  return saved;
}

// Remove a timer by id from the CURRENT persisted store. Returns saved rows.
function nyxRemoveCustomTimerV2(gameKey, id){
  var cur = nyxLoadCustomTimersV2(gameKey);
  var out = [];
  for (var i = 0; i < cur.length; i++) if (cur[i].id !== id) out.push(cur[i]);
  var saved = nyxSaveCustomTimersV2(gameKey, out);
  nyxNotifyCustomTimers_(gameKey, saved);
  return saved;
}

// Toggle (or explicitly set) a timer's enabled flag on the CURRENT store.
function nyxToggleCustomTimerV2(gameKey, id, enabled){
  var cur = nyxLoadCustomTimersV2(gameKey);
  var out = [];
  for (var i = 0; i < cur.length; i++) {
    var r = cur[i];
    if (r.id !== id) { out.push(r); continue; }
    var next = {};
    for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) next[k] = r[k];
    next.enabled = (enabled === undefined) ? !r.enabled : !!enabled;
    out.push(next);
  }
  var saved = nyxSaveCustomTimersV2(gameKey, out);
  nyxNotifyCustomTimers_(gameKey, saved);
  return saved;
}

// Namespace for later (timeline) code that reaches across files.
if (typeof window !== 'undefined') {
  window.NyxCustomTimers = {
    DEFAULT_COLOR: NYX_CUSTOM_TIMER_DEFAULT_COLOR,
    CAP: NYX_CUSTOM_TIMER_CAP,
    keyV1: nyxCustomTimerKeyV1,
    keyV2: nyxCustomTimerKeyV2,
    load: nyxLoadCustomTimersV2,
    save: nyxSaveCustomTimersV2,
    subscribe: nyxSubscribeCustomTimers,
    upsert: nyxUpsertCustomTimerV2,
    remove: nyxRemoveCustomTimerV2,
    toggle: nyxToggleCustomTimerV2,
    migrate: nyxMigrateV1ToV2,
    normalize: nyxNormalizeTimersV2,
    normalizeOne: nyxNormalizeTimerV2,
    validate: nyxValidateTimersV2,
    sanitizeRecur: nyxSanitizeRecur,
    sanitizeColor: nyxSanitizeColor,
    make: nyxMakeTimerV2,
  };
}
