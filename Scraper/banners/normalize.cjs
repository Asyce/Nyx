'use strict';
// ============================================================
// Banner timeline normalization, validation & freshness.
//
// Pure functions (no I/O), shared by:
//   - Scraper/banners/scrape.cjs   (honest freshness before writing banners.json)
//   - Site/tools/generate-site-data.mjs (reflow phases for the deployed site)
//
// The scraper used to stamp every successful fetch as `fresh`, even when the
// resulting timeline was nonsense (an expired phase still sitting in `current`,
// a `current`/`next` with zero featured characters, or two identical windows
// emitted as separate phases). These helpers compute the truth from the
// timeline itself so the UI never presents broken data as live.
// ============================================================

const HOUR = 3600 * 1000;
// A banner check older than this (since the last *successful* fetch) is treated
// as stale even if the timeline still looks valid.
const STALE_AFTER_MS = 36 * HOUR;
const TRANSITION_AFTER_MS = 48 * HOUR;

function toMs(v) {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

function windowKey(phase) {
  return (phase.start || '0') + '|' + (phase.end || '0');
}

// True when `now` falls inside the phase window. An open start (null) counts as
// "already running"; an open end (null) counts as "no known end" (still up).
function isActiveAt(phase, now) {
  const s = toMs(phase.start);
  const e = toMs(phase.end);
  if (e != null && e <= now) return false; // ended
  if (s != null && s > now) return false; // not started yet
  return true;
}

function charCount(phase) {
  return Array.isArray(phase && phase.characters) ? phase.characters.length : 0;
}

// Merge phases that share the EXACT same [start,end] window into one phase
// (union of characters, de-duped by name). Fixes the ZZZ case where game8 emits
// the same Jul 8–28 window twice (one char each) instead of one merged phase.
function mergeSameWindow(phases) {
  const byWindow = new Map();
  const order = [];
  for (const phase of phases) {
    if (!phase) continue;
    const key = windowKey(phase);
    if (!byWindow.has(key)) {
      byWindow.set(key, Object.assign({}, phase, { characters: [...(phase.characters || [])] }));
      order.push(key);
    } else {
      const target = byWindow.get(key);
      const seen = new Set(target.characters.map((c) => c && c.name));
      for (const c of phase.characters || []) {
        if (c && !seen.has(c.name)) { target.characters.push(c); seen.add(c.name); }
      }
      if (!target.phase && phase.phase) target.phase = phase.phase;
    }
  }
  return order.map((k) => byWindow.get(k));
}

// Re-thread current/next/upcoming purely from the timeline. Only a phase that is
// active right now AND has at least one featured character can be `current`;
// everything with a future start becomes next/upcoming (sorted, de-duplicated).
function reflowBannerGroup(group, now) {
  now = now || Date.now();
  const all = mergeSameWindow(
    [group.current, group.next, ...(group.upcoming || [])].filter(Boolean)
  );
  const populated = all.filter((p) => charCount(p) > 0);

  const current = populated.find((p) => isActiveAt(p, now)) || null;
  const future = populated
    .filter((p) => p !== current && (() => { const s = toMs(p.start); return s != null && s > now; })())
    .sort((a, b) => (toMs(a.start) || 0) - (toMs(b.start) || 0));
  const next = future[0] || null;
  const upcoming = future.slice(1);

  return {
    name: group.name,
    freshness: computeFreshness(group, { current, next, upcoming }, now),
    current,
    next,
    upcoming,
  };
}

// Statuses: fresh | stale | invalid | unavailable
//   fresh       — an active, populated current banner and a recent fetch.
//   stale       — timeline still valid but the last successful fetch is old.
//   invalid     — no usable current banner, but we do know what's coming next.
//   unavailable — no usable current or future banner data at all.
function computeFreshness(group, reflowed, now) {
  now = now || Date.now();
  const f = (group && group.freshness) || {};
  const lastOk = toMs(f.lastSuccessfulFetch);
  const hasCurrent = !!reflowed.current;
  const hasFuture = !!reflowed.next || (reflowed.upcoming && reflowed.upcoming.length > 0);
  const nextStart = toMs(reflowed.next && reflowed.next.start);
  const recentlyChecked = lastOk == null || now - lastOk <= STALE_AFTER_MS;
  const inTransition = !hasCurrent && recentlyChecked && nextStart != null && nextStart > now && nextStart - now <= TRANSITION_AFTER_MS;

  let status;
  if (hasCurrent) status = 'fresh';
  else if (inTransition) status = 'transition';
  else if (hasFuture) status = 'invalid';
  else status = 'unavailable';

  // Age-based downgrade only applies while we'd otherwise call it fresh.
  if ((status === 'fresh' || status === 'transition') && lastOk != null && now - lastOk > STALE_AFTER_MS) status = 'stale';
  // Never upgrade past a scraper-declared stale (e.g. a failed fetch preserved old data).
  if (f.status === 'stale' && (status === 'fresh' || status === 'transition')) status = 'stale';

  return {
    status,
    checkedAt: f.checkedAt || null,
    lastSuccessfulFetch: f.lastSuccessfulFetch || null,
    lastValidUpdate: hasCurrent
      ? (f.lastSuccessfulFetch || f.checkedAt || null)
      : (f.lastValidUpdate || null),
    ...(f.source ? { source: f.source } : {}),
    ...(f.message ? { message: f.message } : {}),
  };
}

// Convenience: just the status string, for the scraper to stamp onto banners.json
// without changing its phase shape.
function bannerFreshnessStatus(group, now) {
  const reflowed = reflowBannerGroup(group, now);
  return reflowed.freshness.status;
}

// Shared by the scraper's retry gate and tests. Keep this focused on the
// games whose current banners are required for a deploy; Endfield can
// legitimately have no announced banner between releases.
function requiredBannerFreshnessFailures(groups, now, optionalGames = ['endfield']) {
  const optional = new Set(optionalGames.map((game) => String(game).toLowerCase()));
  const allowed = new Set(['fresh', 'transition']);
  return (groups || [])
    .filter(Boolean)
    .map((group) => {
      const id = String(group?.id || group?.name || '').toLowerCase();
      const status = bannerFreshnessStatus(group, now);
      return { id, status };
    })
    .filter(({ id, status }) => !optional.has(id) && !allowed.has(status));
}

module.exports = {
  STALE_AFTER_MS,
  TRANSITION_AFTER_MS,
  toMs,
  isActiveAt,
  mergeSameWindow,
  reflowBannerGroup,
  computeFreshness,
  bannerFreshnessStatus,
  requiredBannerFreshnessFailures,
};
