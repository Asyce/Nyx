// ============================================================
// Nyx — Banner Timeline PURE data logic (window.NyxTimelineData)
// No React, no DOM. Everything here is a pure function so the Node
// test can load this source in a vm sandbox (same interop pattern as
// custom-timer-storage.js) and exercise the maths directly.
//
// Build note: the site build has no import/export — every source file
// is JSX-transformed and concatenated into one shared scope (see
// Site/tools/build-site.mjs). So the API is exposed two ways:
//   1. top-level `nyxTl*` function declarations (hoisted, in scope for
//      the timeline view + nyx-app which are concatenated AFTER), and
//   2. a `window.NyxTimelineData` namespace.
//
// Responsibilities:
//   - region-window selection (server-region setting -> global -> date-only)
//   - banner record -> timeline block (weapons merged into character cards)
//   - overlap -> parallel sub-lane assignment
//   - activity occurrence expansion (fixed calendar, fixed interval,
//     dated windowsByRegion, dated date-only) with exceptions
//   - Expected-window inference for unconfirmed upcoming banners
//   - share-hash encode/decode round-trip
//   - search matching (character AND weapon names)
//   - scale maths (ms<->x) for zoom/pan
// ============================================================

var NYX_TL_DAY_MS = 86400000;

// Zoom levels expressed as milliseconds-per-pixel, coarse -> fine is
// large -> small. Roughly: year, multi-patch, patch-pair, patch, week.
// The default (index 3, ~0.22 day/px) makes a normal 21-day banner read
// ~95px wide (comfortably past the min-width) and a ~1000px viewport span
// ~220 days — the current patch plus a couple on each side.
var NYX_TL_ZOOM_LEVELS = [
  6 * NYX_TL_DAY_MS,    // 0: ~year (very zoomed out)
  2 * NYX_TL_DAY_MS,    // 1: multi-patch
  0.7 * NYX_TL_DAY_MS,  // 2: patch-pair
  0.22 * NYX_TL_DAY_MS, // 3: patch (default — 21d banner ~95px)
  0.09 * NYX_TL_DAY_MS, // 4: week
];
var NYX_TL_DEFAULT_ZOOM = 3;

// Minimum rendered card width (px). Sub-lane assignment inflates each
// block's time extent to at least this many pixels so min-width cards can
// never visually overlap even when their true time spans do not. Kept in
// sync with the Math.max(78, ...) in timeline-view.jsx and the CSS.
var NYX_TL_BLOCK_MIN_PX = 78;
var NYX_TL_MARKER_MIN_PX = 110;

// The vertical "now" line sits at the golden-ratio point from the left,
// so history stretches left and upcoming stretches right.
var NYX_TL_NOW_FRACTION = 0.618;

// Map the existing server-region setting (RESET_REGIONS keys: na/eu/asia)
// onto the banner data's windowsByRegion keys.
function nyxTlRegionKey(settingKey){
  if (settingKey === 'eu') return 'europe';
  if (settingKey === 'asia') return 'asia';
  if (settingKey === 'na') return 'america';
  if (settingKey === 'europe' || settingKey === 'asia' || settingKey === 'america' || settingKey === 'global') return settingKey;
  return 'america';
}

// Server reset offset (hours from UTC) for a region, used only to place
// server-fixed activity resets. global/date-only -> 0 (UTC).
function nyxTlOffsetHours(regionKey){
  if (regionKey === 'asia') return 8;
  if (regionKey === 'europe') return 1;
  if (regionKey === 'america') return -5;
  return 0;
}

// Snap an instant to 04:00 on the SAME calendar date in the selected game
// server. The datetime-local input is parsed in the browser timezone, so doing
// d.setHours(4) would silently align to the computer instead of NA/EU/Asia.
function nyxTlAlignToServerReset(ms, settingKey){
  if (!Number.isFinite(ms)) return ms;
  var offH = nyxTlOffsetHours(nyxTlRegionKey(settingKey));
  var serverDate = new Date(ms + offH * 3600000);
  return Date.UTC(
    serverDate.getUTCFullYear(),
    serverDate.getUTCMonth(),
    serverDate.getUTCDate(),
    4 - offH,
    0,
    0,
    0
  );
}

// Compact live-card countdown. Long-running banners show days + hours; the
// final day shows a ticking HH:MM:SS value driven by the view's shared clock.
function nyxTlCountdownLabel(remainingMs){
  var total = Math.max(0, Math.floor(Number(remainingMs) / 1000));
  if (!Number.isFinite(total)) return '';
  var days = Math.floor(total / 86400);
  var hours = Math.floor((total % 86400) / 3600);
  var minutes = Math.floor((total % 3600) / 60);
  var seconds = total % 60;
  function pad(n){ return String(n).padStart(2, '0'); }
  return days > 0
    ? days + 'd ' + pad(hours) + 'h'
    : pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
}

// Select the window for a record given the user's region. Priority:
//   1. exact region match      -> precise, attributed to that region
//   2. global                  -> precise, attributed to global
//   3. date-only fallback      -> first available region purely for
//      placement; NOT attributed to the user's region (precise:false).
// Returns null only when no window exists at all.
function nyxTlSelectWindow(windowsByRegion, regionKey){
  if (!windowsByRegion || typeof windowsByRegion !== 'object') return null;
  function usable(key){
    var w = windowsByRegion[key];
    return (w && typeof w === 'object' && w.start) ? w : null;
  }
  var exact = usable(regionKey);
  if (exact) {
    return { start: exact.start, end: exact.end || null, timezone: exact.timezone || null,
             sourceUrl: exact.sourceUrl || null, region: regionKey, precise: true, dateOnly: false };
  }
  var glob = usable('global');
  if (glob) {
    return { start: glob.start, end: glob.end || null, timezone: glob.timezone || null,
             sourceUrl: glob.sourceUrl || null, region: 'global', precise: true, dateOnly: false };
  }
  // date-only fallback — deterministic order, never claimed as the user's region.
  var order = ['asia', 'europe', 'america'];
  for (var i = 0; i < order.length; i++) {
    var w = usable(order[i]);
    if (w) {
      return { start: w.start, end: w.end || null, timezone: null,
               sourceUrl: w.sourceUrl || null, region: null, precise: false, dateOnly: true };
    }
  }
  return null;
}

function nyxTlNum(v){ var n = Date.parse(v); return Number.isFinite(n) ? n : null; }

// Canonical rarity rank. Rarity is numeric in GI/HSR/WuWa (4/5) and
// Endfield (5/6), but ZZZ uses letter grades ('S' top, 'A' below).
// Number('S') is NaN, so a raw Number() test silently drops every ZZZ
// S-rank. Map letters onto the same numeric scale (S=5 top, A=4, ...).
// Returns NaN for an unknown/absent rarity.
function nyxTlRarityRank(rarity){
  if (typeof rarity === 'number') return Number.isFinite(rarity) ? rarity : NaN;
  var s = String(rarity == null ? '' : rarity).trim().toUpperCase();
  if (s === '') return NaN;
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
  var LETTERS = { S: 5, A: 4, B: 3, C: 2, D: 1 };
  return Object.prototype.hasOwnProperty.call(LETTERS, s) ? LETTERS[s] : NaN;
}
// "High rarity" = the headline tier (numeric 5/6 or letter S). Used to
// bucket featured units into fives/fours and pick the primary five.
function nyxTlIsHighRarity(rarity){
  var r = nyxTlRarityRank(rarity);
  return Number.isFinite(r) && r >= 5;
}

// Parse a record-level date-only window ({start,end} as 'YYYY-MM-DD' or
// full ISO). Returns a window shaped like nyxTlSelectWindow's date-only
// result, or null. Honest: never attributed to the user's region.
function nyxTlDateOnlyWindow(dateOnly){
  if (!dateOnly || typeof dateOnly !== 'object') return null;
  var rawStart = dateOnly.start;
  var rawEnd = dateOnly.end;
  if (!rawStart) return null;
  var startIso = /^\d{4}-\d{2}-\d{2}$/.test(rawStart) ? (rawStart + 'T00:00:00.000Z') : rawStart;
  var endIso = rawEnd ? (/^\d{4}-\d{2}-\d{2}$/.test(rawEnd) ? (rawEnd + 'T23:59:59.000Z') : rawEnd) : null;
  if (nyxTlNum(startIso) === null) return null;
  return { start: startIso, end: endIso, timezone: null,
           sourceUrl: dateOnly.sourceUrl || null, region: null, precise: false, dateOnly: true };
}

// Names of featured entities of a given entityType, primary first.
function nyxTlFeaturedNames(featured, entityType){
  if (!Array.isArray(featured)) return [];
  var prim = [], rest = [];
  for (var i = 0; i < featured.length; i++) {
    var f = featured[i];
    if (!f || (entityType && f.entityType !== entityType)) continue;
    if (!f.name) continue;
    (f.primary ? prim : rest).push(f.name);
  }
  return prim.concat(rest);
}

// Build one display block from a character/mixed record, merging the
// paired weapon record(s) onto the card. Returns null when the record
// has no placeable window. `byId` maps record id -> record.
function nyxTlBlockFromRecord(record, byId, regionKey){
  if (!record) return null;
  // Prefer a real regional/global window; otherwise accept the record-level
  // date-only window (WuWa collab banners carry dates but no server clocks).
  var win = nyxTlSelectWindow(record.windowsByRegion, regionKey);
  if (!win) win = nyxTlDateOnlyWindow(record.dateOnly);
  if (!win) return null;
  var startMs = nyxTlNum(win.start);
  if (startMs === null) return null;
  var endMs = win.end ? nyxTlNum(win.end) : null;

  var featured = Array.isArray(record.featured) ? record.featured : [];
  var chars5 = [], chars4 = [];
  for (var i = 0; i < featured.length; i++) {
    var f = featured[i];
    if (!f || !f.name) continue;
    if (f.entityType === 'character') (nyxTlIsHighRarity(f.rarity) ? chars5 : chars4).push(f);
  }

  // Merge paired weapon records (no separate weapons lane).
  var weaponNames = [];
  var weaponPrimary = null;
  var weaponRecords = [];
  var paired = Array.isArray(record.pairedBannerIds) ? record.pairedBannerIds : [];
  for (var p = 0; p < paired.length; p++) {
    var wr = byId ? byId[paired[p]] : null;
    if (!wr) continue;
    weaponRecords.push(wr);
    var wnames = nyxTlFeaturedNames(wr.featured, 'weapon');
    for (var q = 0; q < wnames.length; q++) if (weaponNames.indexOf(wnames[q]) === -1) weaponNames.push(wnames[q]);
    if (!weaponPrimary && wnames.length) weaponPrimary = wnames[0];
  }
  // A "mixed"/weapon-carrying record may itself list weapons in featured.
  var ownWeapons = nyxTlFeaturedNames(featured, 'weapon');
  for (var o = 0; o < ownWeapons.length; o++) if (weaponNames.indexOf(ownWeapons[o]) === -1) weaponNames.push(ownWeapons[o]);
  if (!weaponPrimary && ownWeapons.length) weaponPrimary = ownWeapons[0];

  var charNames = [];
  for (var c = 0; c < featured.length; c++) if (featured[c].entityType === 'character' && featured[c].name) charNames.push(featured[c].name);

  var primaryFive = null;
  for (var g = 0; g < chars5.length; g++) { if (chars5[g].primary) { primaryFive = chars5[g].name; break; } }
  if (!primaryFive && chars5.length) primaryFive = chars5[0].name;

  var confirmed = record.confirmed !== false;
  var expected = !confirmed || endMs === null;

  return {
    id: record.id,
    game: record.game,
    name: record.name || primaryFive || 'Banner',
    version: record.version || null,
    category: record.category || null,
    bannerType: record.bannerType || 'character',
    permanent: !!record.permanent,
    startMs: startMs,
    endMs: endMs,
    dateOnly: !!win.dateOnly,
    precise: !!win.precise,
    region: win.region,
    timezone: win.timezone,
    sourceUrl: win.sourceUrl,
    confirmed: confirmed,
    expected: expected,
    featured: featured,
    fives: chars5.map(function(x){ return { name:x.name, rarity:x.rarity, primary:!!x.primary }; }),
    fours: chars4.map(function(x){ return { name:x.name, rarity:x.rarity, primary:!!x.primary }; }),
    charNames: charNames,
    primaryFive: primaryFive,
    weaponNames: weaponNames,
    weaponPrimary: weaponPrimary,
    searchNames: charNames.concat(weaponNames),
  };
}

// Median gap (ms) between successive banner version starts — the inferred
// "patch length". Falls back to 42 days when history is too thin. Clamped
// to a sane 14..70 day range so one bad row can't warp the axis.
function nyxTlInferPatchMs(records, regionKey){
  var starts = [];
  var seen = {};
  for (var i = 0; i < (records || []).length; i++) {
    var r = records[i];
    if (!r || r.permanent || r.bannerType === 'weapon') continue;
    if (r.confirmed === false) continue;
    var win = nyxTlSelectWindow(r.windowsByRegion, regionKey);
    if (!win) continue;
    var s = nyxTlNum(win.start);
    if (s === null) continue;
    var vkey = (r.version || '') + '|' + s;
    if (seen[vkey]) continue;
    seen[vkey] = 1;
    starts.push(s);
  }
  starts.sort(function(a, b){ return a - b; });
  var gaps = [];
  for (var g = 1; g < starts.length; g++) {
    var d = starts[g] - starts[g - 1];
    if (d > 3 * NYX_TL_DAY_MS && d < 120 * NYX_TL_DAY_MS) gaps.push(d);
  }
  if (!gaps.length) return 42 * NYX_TL_DAY_MS;
  gaps.sort(function(a, b){ return a - b; });
  var mid = Math.floor(gaps.length / 2);
  var med = gaps.length % 2 ? gaps[mid] : Math.round((gaps[mid - 1] + gaps[mid]) / 2);
  if (med < 14 * NYX_TL_DAY_MS) med = 14 * NYX_TL_DAY_MS;
  if (med > 70 * NYX_TL_DAY_MS) med = 70 * NYX_TL_DAY_MS;
  return med;
}

// The next inferred banner window after `afterMs`, using the inferred
// patch length. Used to place Expected (unconfirmed) upcoming blocks.
function nyxTlExpectedWindow(records, regionKey, afterMs){
  var patch = nyxTlInferPatchMs(records, regionKey);
  var last = afterMs;
  if (last === undefined || last === null) {
    last = 0;
    for (var i = 0; i < (records || []).length; i++) {
      var r = records[i];
      if (!r || r.permanent) continue;
      var win = nyxTlSelectWindow(r.windowsByRegion, regionKey);
      if (!win) continue;
      var e = win.end ? nyxTlNum(win.end) : nyxTlNum(win.start);
      if (e !== null && e > last) last = e;
    }
  }
  return { start: last, end: last + patch, expected: true, patchMs: patch };
}

// Build every character/mixed block for a game, filling in an estimated
// end for Expected blocks that have a start but no confirmed end.
function nyxTlBuildBlocks(records, regionKey){
  records = Array.isArray(records) ? records : [];
  var byId = {};
  for (var i = 0; i < records.length; i++) if (records[i] && records[i].id) byId[records[i].id] = records[i];
  var patch = nyxTlInferPatchMs(records, regionKey);
  var out = [];
  for (var j = 0; j < records.length; j++) {
    var r = records[j];
    if (!r) continue;
    // Weapon-only records merge into their paired character card; they are
    // not their own block (no separate weapons lane).
    if (r.bannerType === 'weapon') continue;
    // Permanent/novice banners (GI Beginners' Wish, Wanderlust Invocation)
    // have no finite span; drawing them would invent a fake "Expected" end.
    // Hidden from the time axis by default per plan Workstream M.
    if (r.permanent) continue;
    var block = nyxTlBlockFromRecord(r, byId, regionKey);
    if (!block) continue;
    if (block.endMs === null) block.endMs = block.startMs + patch;
    out.push(block);
  }
  out.sort(function(a, b){ return a.startMs - b.startMs; });
  return out;
}

// Greedy interval-graph colouring: assign each banner/activity interval the
// lowest sub-lane whose previous interval has already ended. Accepts either
// startMs/endMs (banners) or start/end (activities). Mutates nothing; returns
// a new array with `.lane` set and the total lane count.
//
// `minSpanMs` inflates each block's effective extent so a card that renders
// at the min-width (78px) reserves at least that much horizontal room in the
// lane graph. Without it, a 21-day banner at a coarse zoom occupies ~15px of
// true time but paints as a 78px card and overlaps its neighbour. Callers
// pass minSpanMs = NYX_TL_BLOCK_MIN_PX * msPerPx for the current zoom.
function nyxTlAssignSubLanes(blocks, minSpanMs){
  var pad = (typeof minSpanMs === 'number' && minSpanMs > 0) ? minSpanMs : 0;
  function startsAt(row){ return row && row.startMs != null ? row.startMs : row && row.start; }
  var sorted = (blocks || []).slice().sort(function(a, b){ return startsAt(a) - startsAt(b); });
  var laneEnds = []; // laneEnds[i] = effective endMs of last block in lane i
  var result = [];
  for (var i = 0; i < sorted.length; i++) {
    var b = sorted[i];
    var start = b.startMs != null ? b.startMs : b.start;
    var end = b.endMs != null ? b.endMs : b.end;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    var effEnd = Math.max(end, start + pad);
    var placed = -1;
    for (var l = 0; l < laneEnds.length; l++) {
      if (start >= laneEnds[l]) { placed = l; break; }
    }
    if (placed === -1) { placed = laneEnds.length; laneEnds.push(effEnd); }
    else laneEnds[placed] = effEnd;
    var copy = {};
    for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k)) copy[k] = b[k];
    copy.lane = placed;
    result.push(copy);
  }
  return { blocks: result, laneCount: laneEnds.length };
}

// ---- Activity occurrence expansion ----------------------------------

// Fixed calendar cadence (e.g. GI Spiral Abyss: 16th of each month at
// server reset). Occurrences step `calendarMonths` from the anchor's
// server-local month, landing on `calendarDay` at `resetHour`. When
// `durationToNext` the block runs until the next occurrence; otherwise it
// runs `durationDays`.
function nyxTlExpandFixedCalendar(def, rangeStart, rangeEnd, offH){
  var anchor = nyxTlNum(def.anchorStart);
  if (anchor === null) return [];
  var step = Math.max(1, Math.round(def.calendarMonths || 1));
  var day = Math.round(def.calendarDay);
  if (!Number.isFinite(day)) return [];
  var hour = Number.isFinite(def.resetHour) ? def.resetHour : 4;
  var offMs = offH * 3600000;
  var durDays = Math.max(1, def.durationDays || 1);

  // First occurrence is the anchor itself, re-expressed at the region
  // offset from its ASIA-local calendar fields — matching the scraper
  // (Scraper/banner-history/activities.mjs). The cadence NEVER back-
  // extrapolates before this anchor, so we never invent occurrences that
  // predate the source (Sol finding #9: Spiral Abyss anchor 2024-07-15
  // must not spawn 2022-12 occurrences).
  var asia = new Date(anchor + 8 * 3600000);
  function localMs(y, mon, d, h){ return Date.UTC(y, mon, d, h) - offMs; }
  var cursor = localMs(asia.getUTCFullYear(), asia.getUTCMonth(), asia.getUTCDate(), asia.getUTCHours());
  function nextFrom(curMs){
    var loc = new Date(curMs + offMs);
    var mn = loc.getUTCFullYear() * 12 + loc.getUTCMonth() + step;
    var yy = Math.floor(mn / 12);
    var mm = ((mn % 12) + 12) % 12;
    return localMs(yy, mm, day, hour);
  }
  function endOf(startMs, nextMs){
    return def.durationToNext ? nextMs : startMs + durDays * NYX_TL_DAY_MS;
  }
  // Advance forward (never backward past the anchor) until the occurrence's
  // end reaches rangeStart.
  var guard = 0;
  while (cursor < rangeStart && guard++ < 6000) {
    var nx = nextFrom(cursor);
    if (endOf(cursor, nx) > rangeStart) break;
    cursor = nx;
  }
  var out = [];
  guard = 0;
  while (cursor <= rangeEnd && guard++ < 6000) {
    var next = nextFrom(cursor);
    var e = endOf(cursor, next);
    if (e >= rangeStart) out.push({ start: cursor, end: e });
    cursor = next;
  }
  return out;
}

// Fixed interval cadence (e.g. ZZZ Shiyu Defense: every 14 days,
// 14 days long). Stops at stopAfterByRegion; region exceptions replace a
// same-start occurrence and any extra exception windows are appended.
function nyxTlExpandFixedInterval(def, rangeStart, rangeEnd, regionKey){
  var anchor = nyxTlNum(def.anchorStart);
  if (anchor === null || !def.intervalDays) return [];
  // Server-fixed definitions store the canonical anchor at Asia's reset.
  // Re-express that same server-local calendar date at 04:00 for the user's
  // selected region; otherwise EU/NA inherit Asia's 20:00Z boundary.
  if (def.timezoneMode === 'server-fixed' || def.timezoneMode === 'server') {
    var asiaAnchor = new Date(anchor + 8 * 3600000);
    var offH = nyxTlOffsetHours(regionKey);
    var resetHour = Number.isFinite(def.resetHour) ? def.resetHour : asiaAnchor.getUTCHours();
    anchor = Date.UTC(
      asiaAnchor.getUTCFullYear(), asiaAnchor.getUTCMonth(), asiaAnchor.getUTCDate(),
      resetHour - offH, 0, 0, 0
    );
  }
  var intervalMs = def.intervalDays * NYX_TL_DAY_MS;
  if (intervalMs <= 0) return [];
  var durMs = Math.max(1, def.durationDays || def.intervalDays) * NYX_TL_DAY_MS;
  var stopAfter = (def.stopAfterByRegion && def.stopAfterByRegion[regionKey])
    ? nyxTlNum(def.stopAfterByRegion[regionKey]) : Infinity;
  // Region exceptions -> explicit windows, keyed by start instant.
  var exMap = {};
  var extras = [];
  var exList = Array.isArray(def.exceptions) ? def.exceptions : [];
  for (var x = 0; x < exList.length; x++) {
    var ex = exList[x];
    if (!ex) continue;
    if (ex.region && ex.region !== regionKey) continue;
    var w = ex.window || ex;
    var ws = nyxTlNum(w.start), we = nyxTlNum(w.end);
    if (ws === null) continue;
    var exStart = nyxTlNum(ex.start);
    var exSourceUrl = w.sourceUrl || ex.sourceUrl || null;
    if (exStart !== null) exMap[exStart] = { start: ws, end: we !== null ? we : ws + durMs, sourceUrl:exSourceUrl };
    extras.push({ start: ws, end: we !== null ? we : ws + durMs, exception: true, sourceUrl:exSourceUrl });
  }
  var out = [];
  var k = Math.floor((rangeStart - anchor) / intervalMs) - 1;
  if (k < 0) k = 0;
  var guard = 0;
  while (guard++ < 8000) {
    var s = anchor + k * intervalMs;
    if (s > rangeEnd) break;
    if (s >= stopAfter) break; // cadence stops; never extrapolate across the stop/exception
    var e = s + durMs;
    var exHit = exMap[s] || null;
    if (exHit) { e = exHit.end; }
    if (e >= rangeStart) out.push({ start: s, end: e, sourceUrl:exHit && exHit.sourceUrl });
    k++;
  }
  // Append exception windows that fall in range (e.g. the extended tail).
  for (var xx = 0; xx < extras.length; xx++) {
    var ee = extras[xx];
    if (ee.end >= rangeStart && ee.start <= rangeEnd) {
      var dup = false;
      for (var d = 0; d < out.length; d++) if (out[d].start === ee.start) { dup = true; break; }
      if (!dup) out.push({ start: ee.start, end: ee.end, sourceUrl:ee.sourceUrl });
    }
  }
  out.sort(function(a, b){ return a.start - b.start; });
  return out;
}

// Dated windows carrying per-region timestamps (e.g. HSR MoC/PF/AS).
function nyxTlExpandDatedRegional(def, rangeStart, rangeEnd, regionKey){
  var out = [];
  var windows = Array.isArray(def.windows) ? def.windows : [];
  for (var i = 0; i < windows.length; i++) {
    var win = nyxTlSelectWindow(windows[i].windowsByRegion, regionKey);
    if (!win) continue;
    var s = nyxTlNum(win.start);
    var e = win.end ? nyxTlNum(win.end) : null;
    if (s === null) continue;
    if (e === null) continue;
    if (e >= rangeStart && s <= rangeEnd) out.push({ start: s, end: e, dateOnly: !win.precise, sourceUrl: win.sourceUrl });
  }
  return out;
}

// Dated date-only windows (e.g. WuWa Tower of Adversity: YYYY-MM-DD).
function nyxTlExpandDatedDateOnly(def, rangeStart, rangeEnd){
  var out = [];
  var windows = Array.isArray(def.windows) ? def.windows : [];
  for (var i = 0; i < windows.length; i++) {
    var wnd = windows[i];
    if (!wnd || !wnd.dateStart || !wnd.dateEnd) continue;
    var s = nyxTlNum(wnd.dateStart + 'T00:00:00.000Z');
    var e = nyxTlNum(wnd.dateEnd + 'T23:59:59.000Z');
    if (s === null || e === null) continue;
    if (e >= rangeStart && s <= rangeEnd) {
      out.push({ start: s, end: e, dateOnly: true, sourceUrl: (wnd.source && wnd.source.url) || wnd.sourceUrl || null });
    }
  }
  return out;
}

// Expand one activity definition across [rangeStart, rangeEnd]. Returns
// occurrences [{id,label,start,end,dateOnly,sourceUrl,...}]. Missing
// anchor/duration or unknown shape -> [] (draw nothing).
function nyxTlExpandActivity(def, rangeStart, rangeEnd, regionKey){
  if (!def || typeof def !== 'object') return [];
  var offH = nyxTlOffsetHours(regionKey);
  var occ = [];
  if (def.mode === 'fixed') {
    if (def.calendarDay != null && def.calendarMonths != null) occ = nyxTlExpandFixedCalendar(def, rangeStart, rangeEnd, offH);
    else if (def.intervalDays != null) occ = nyxTlExpandFixedInterval(def, rangeStart, rangeEnd, regionKey);
    else occ = [];
  } else if (def.mode === 'dated') {
    var windows = Array.isArray(def.windows) ? def.windows : [];
    if (windows.length && windows[0] && windows[0].windowsByRegion) occ = nyxTlExpandDatedRegional(def, rangeStart, rangeEnd, regionKey);
    else occ = nyxTlExpandDatedDateOnly(def, rangeStart, rangeEnd);
  }
  var out = [];
  for (var i = 0; i < occ.length; i++) {
    var o = occ[i];
    out.push({
      id: def.id + '@' + o.start,
      defId: def.id,
      label: def.label || def.id,
      start: o.start,
      end: o.end,
      dateOnly: o.dateOnly || def.timezoneMode === 'date-only',
      sourceUrl: o.sourceUrl || def.sourceUrl || null,
    });
  }
  return out;
}

// Expand every activity definition for a game.
function nyxTlExpandActivities(defs, rangeStart, rangeEnd, regionKey){
  defs = Array.isArray(defs) ? defs : [];
  var out = [];
  for (var i = 0; i < defs.length; i++) {
    var occ = nyxTlExpandActivity(defs[i], rangeStart, rangeEnd, regionKey);
    for (var j = 0; j < occ.length; j++) out.push(occ[j]);
  }
  return out;
}

// ---- Search ----------------------------------------------------------

// Does `block` match `query`? Matches featured character AND weapon names
// (weapons merged onto the character card), case-insensitive substring.
// Returns { match, names } where names are the matched entity names.
function nyxTlSearchMatch(block, query){
  var q = String(query || '').trim().toLowerCase();
  if (!q) return { match: false, names: [] };
  var names = (block && block.searchNames) || [];
  var hit = [];
  for (var i = 0; i < names.length; i++) {
    if (String(names[i]).toLowerCase().indexOf(q) !== -1) hit.push(names[i]);
  }
  if ((block && block.name) && String(block.name).toLowerCase().indexOf(q) !== -1 && hit.indexOf(block.name) === -1) {
    // name matches too, but only report entity names as the reason
  }
  return { match: hit.length > 0, names: hit };
}

// Group search results by matched entity -> [{name, count, blockIds}],
// sorted by descending run count then name.
function nyxTlSearchGroups(blocks, query){
  var q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  var map = {};
  for (var i = 0; i < (blocks || []).length; i++) {
    var res = nyxTlSearchMatch(blocks[i], query);
    if (!res.match) continue;
    for (var j = 0; j < res.names.length; j++) {
      var nm = res.names[j];
      if (!map[nm]) map[nm] = { name: nm, count: 0, blockIds: [] };
      map[nm].count++;
      map[nm].blockIds.push(blocks[i].id);
    }
  }
  var arr = [];
  for (var key in map) if (Object.prototype.hasOwnProperty.call(map, key)) arr.push(map[key]);
  arr.sort(function(a, b){ return b.count - a.count || (a.name < b.name ? -1 : 1); });
  return arr;
}

// ---- Share hash (view state <-> URL hash) ----------------------------

// Encode { centerMs, zoom } into a compact hash token. centerMs is
// base36; zoom is a small integer. Round-trips through nyxTlDecodeHash.
function nyxTlEncodeHash(state){
  if (!state || !Number.isFinite(state.centerMs)) return '';
  var z = Number.isFinite(state.zoom) ? Math.max(0, Math.min(NYX_TL_ZOOM_LEVELS.length - 1, Math.round(state.zoom))) : NYX_TL_DEFAULT_ZOOM;
  return 'tl.' + Math.round(state.centerMs).toString(36) + '.' + z;
}

function nyxTlDecodeHash(hash){
  if (!hash) return null;
  var s = String(hash).replace(/^#/, '');
  // tolerate other hash params joined by & or ;
  var parts = s.split(/[&;]/);
  for (var i = 0; i < parts.length; i++) {
    var m = /^tl\.([0-9a-z]+)\.(\d+)$/.exec(parts[i].trim());
    if (m) {
      var centerMs = parseInt(m[1], 36);
      var zoom = parseInt(m[2], 10);
      if (!Number.isFinite(centerMs)) return null;
      if (!Number.isFinite(zoom) || zoom < 0 || zoom >= NYX_TL_ZOOM_LEVELS.length) zoom = NYX_TL_DEFAULT_ZOOM;
      return { centerMs: centerMs, zoom: zoom };
    }
  }
  return null;
}

// ---- Scale maths -----------------------------------------------------

// Time -> x pixel. `centerMs` is the instant positioned at the now-line,
// which sits at NYX_TL_NOW_FRACTION of the width.
function nyxTlMsToX(ms, centerMs, msPerPx, width){
  var nowX = width * NYX_TL_NOW_FRACTION;
  return nowX + (ms - centerMs) / msPerPx;
}
function nyxTlXToMs(x, centerMs, msPerPx, width){
  var nowX = width * NYX_TL_NOW_FRACTION;
  return centerMs + (x - nowX) * msPerPx;
}

// Which blocks fall within the viewport +/- buffer px (virtualization).
function nyxTlVisibleBlocks(blocks, centerMs, msPerPx, width, bufferPx){
  var buf = bufferPx || 400;
  var minMs = nyxTlXToMs(-buf, centerMs, msPerPx, width);
  var maxMs = nyxTlXToMs(width + buf, centerMs, msPerPx, width);
  var out = [];
  for (var i = 0; i < (blocks || []).length; i++) {
    var b = blocks[i];
    var s = b.startMs != null ? b.startMs : b.start;
    var e = b.endMs != null ? b.endMs : b.end;
    if (e >= minMs && s <= maxMs) out.push(b);
  }
  return out;
}

// Version ribbons: collapse blocks to one span per version string.
function nyxTlVersionRibbons(blocks){
  var map = {};
  for (var i = 0; i < (blocks || []).length; i++) {
    var b = blocks[i];
    if (!b.version) continue;
    if (!map[b.version]) map[b.version] = { version: b.version, startMs: b.startMs, endMs: b.endMs };
    else {
      if (b.startMs < map[b.version].startMs) map[b.version].startMs = b.startMs;
      if (b.endMs > map[b.version].endMs) map[b.version].endMs = b.endMs;
    }
  }
  var arr = [];
  for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k)) arr.push(map[k]);
  arr.sort(function(a, b){ return a.startMs - b.startMs; });
  return arr;
}

if (typeof window !== 'undefined') {
  window.NyxTimelineData = {
    DAY_MS: NYX_TL_DAY_MS,
    ZOOM_LEVELS: NYX_TL_ZOOM_LEVELS,
    DEFAULT_ZOOM: NYX_TL_DEFAULT_ZOOM,
    BLOCK_MIN_PX: NYX_TL_BLOCK_MIN_PX,
    MARKER_MIN_PX: NYX_TL_MARKER_MIN_PX,
    NOW_FRACTION: NYX_TL_NOW_FRACTION,
    rarityRank: nyxTlRarityRank,
    isHighRarity: nyxTlIsHighRarity,
    dateOnlyWindow: nyxTlDateOnlyWindow,
    regionKey: nyxTlRegionKey,
    offsetHours: nyxTlOffsetHours,
    alignToServerReset: nyxTlAlignToServerReset,
    countdownLabel: nyxTlCountdownLabel,
    selectWindow: nyxTlSelectWindow,
    blockFromRecord: nyxTlBlockFromRecord,
    buildBlocks: nyxTlBuildBlocks,
    assignSubLanes: nyxTlAssignSubLanes,
    inferPatchMs: nyxTlInferPatchMs,
    expectedWindow: nyxTlExpectedWindow,
    expandActivity: nyxTlExpandActivity,
    expandActivities: nyxTlExpandActivities,
    searchMatch: nyxTlSearchMatch,
    searchGroups: nyxTlSearchGroups,
    encodeHash: nyxTlEncodeHash,
    decodeHash: nyxTlDecodeHash,
    msToX: nyxTlMsToX,
    xToMs: nyxTlXToMs,
    visibleBlocks: nyxTlVisibleBlocks,
    versionRibbons: nyxTlVersionRibbons,
    featuredNames: nyxTlFeaturedNames,
  };
}
