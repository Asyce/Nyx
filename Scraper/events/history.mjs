import crypto from 'node:crypto';

export const EVENT_COVERAGE_SCHEMA = 1;
export const DEFAULT_HISTORY_PAGE_LIMIT = 50;
export const EVENT_HISTORY_GAMES = ['gi','hsr','zzz','wuwa','endfield'];

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)));

function cursorKey(cursor) {
  return cursor === null || cursor === undefined ? '<end>' : JSON.stringify(cursor);
}

function pageFingerprint(items) {
  return crypto.createHash('sha256').update(JSON.stringify(items || [])).digest('hex');
}

// Walk a cursor or page-number source without allowing a malformed endpoint to
// loop forever. The caller owns persistence through onCheckpoint, which is
// invoked only after a complete page has been parsed.
export async function walkHistoryPages({
  fetchPage,
  startCursor = 1,
  maxPages = DEFAULT_HISTORY_PAGE_LIMIT,
  delayMs = 250,
  getItems = (payload) => payload?.items || [],
  getNextCursor = (payload) => payload?.nextCursor ?? null,
  itemKey = (item) => item?.id,
  onCheckpoint = async () => {},
} = {}) {
  if (typeof fetchPage !== 'function') throw new Error('History page walker requires fetchPage');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 500) throw new Error('History page limit must be between 1 and 500');

  const items = [];
  const seenItems = new Set();
  const seenCursors = new Set();
  const seenPages = new Set();
  let cursor = startCursor;
  let pagesFetched = 0;
  let exhausted = false;
  let anomaly = null;

  while (pagesFetched < maxPages) {
    const encodedCursor = cursorKey(cursor);
    if (seenCursors.has(encodedCursor)) {
      anomaly = `repeated cursor ${encodedCursor}`;
      break;
    }
    seenCursors.add(encodedCursor);

    const payload = await fetchPage(cursor, pagesFetched + 1);
    const rows = getItems(payload);
    if (!Array.isArray(rows)) throw new Error(`History page ${pagesFetched + 1} did not contain an item array`);
    const fingerprint = pageFingerprint(rows);
    if (rows.length && seenPages.has(fingerprint)) {
      anomaly = `repeated page payload at ${encodedCursor}`;
      break;
    }
    seenPages.add(fingerprint);

    for (const row of rows) {
      const key = String(itemKey(row) ?? '').trim();
      if (!key || seenItems.has(key)) continue;
      seenItems.add(key);
      items.push(row);
    }
    pagesFetched += 1;

    const nextCursor = getNextCursor(payload, rows, cursor);
    exhausted = nextCursor === null || nextCursor === undefined || nextCursor === '';
    await onCheckpoint({ cursor, nextCursor, pagesFetched, fetchedRecords:items.length, exhausted });
    if (exhausted) { cursor = null; break; }
    cursor = nextCursor;
    if (pagesFetched < maxPages) await wait(delayMs);
  }

  if (!exhausted && !anomaly && pagesFetched >= maxPages) anomaly = `page limit ${maxPages} reached`;
  return {
    items,
    pagesFetched,
    pageLimit:maxPages,
    exhausted,
    anomaly,
    resumeCursor:exhausted ? null : cursor,
  };
}

function eventBounds(events) {
  const starts = (events || []).map((row) => row?.start).filter((value) => Number.isFinite(Date.parse(value))).sort();
  const ends = (events || []).map((row) => row?.end || row?.start).filter((value) => Number.isFinite(Date.parse(value))).sort();
  return starts.length ? { earliest:starts[0], latest:ends.at(-1) } : { earliest:null, latest:null };
}

export function buildCoverageEntry({ game, source, fetchedAt, result, events, previousCount = 0 } = {}) {
  const rows = Array.isArray(events) ? events : [];
  const bounds = eventBounds(rows);
  const partial = Boolean(result?.anomaly) || result?.exhausted === false;
  return {
    game,
    source,
    fetchedAt,
    status:result?.stale ? 'stale' : partial ? 'partial' : 'complete-for-source',
    exhausted:Boolean(result?.exhausted),
    pagesFetched:Number(result?.pagesFetched) || 0,
    pageLimit:Number(result?.pageLimit) || 0,
    fetchedRecords:Number(result?.fetched) || 0,
    storedRecords:rows.length,
    retainedPrevious:Math.max(0, rows.length - Number(result?.events?.length || 0)),
    previousRecords:Math.max(0, Number(previousCount) || 0),
    earliest:bounds.earliest,
    latest:bounds.latest,
    resumeCursor:result?.resumeCursor ?? null,
    gaps:[...new Set((result?.gaps || []).filter(Boolean))],
    anomaly:result?.anomaly || null,
  };
}

export function validateCoverageManifest(manifest) {
  const errors = [];
  if (manifest?.schemaVersion !== EVENT_COVERAGE_SCHEMA || !Number.isFinite(Date.parse(manifest?.generatedAt)) || !Array.isArray(manifest?.games)) return ['invalid coverage manifest envelope'];
  const seen = new Set();
  for (const row of manifest.games) {
    if (!row?.game || seen.has(row.game)) errors.push(`invalid/duplicate coverage game ${row?.game}`);
    seen.add(row?.game);
    if (!['complete-for-source','partial','stale'].includes(row?.status)) errors.push(`bad coverage status ${row?.game}`);
    if (!row?.source?.name || !row?.source?.endpoint) errors.push(`bad coverage source ${row?.game}`);
    if (!Number.isInteger(row?.pagesFetched) || row.pagesFetched < 0 || !Number.isInteger(row?.fetchedRecords) || row.fetchedRecords < 0) errors.push(`bad coverage counts ${row?.game}`);
    if (row?.status === 'complete-for-source' && !row.exhausted) errors.push(`complete source is not exhausted ${row?.game}`);
    if (row?.earliest && !Number.isFinite(Date.parse(row.earliest))) errors.push(`bad coverage earliest ${row?.game}`);
    if (row?.latest && !Number.isFinite(Date.parse(row.latest))) errors.push(`bad coverage latest ${row?.game}`);
  }
  return errors;
}

export function validateHistoryState(state) {
  const errors = [];
  if (state?.schemaVersion !== 1 || !state.games || typeof state.games !== 'object' || Array.isArray(state.games)) return ['invalid history state envelope'];
  const keys = Object.keys(state.games).sort();
  if (keys.join(',') !== [...EVENT_HISTORY_GAMES].sort().join(',')) errors.push('history state must contain exactly five supported games');
  for (const game of EVENT_HISTORY_GAMES) {
    const row = state.games[game];
    if (!row || !Array.isArray(row.completedIds) || row.completedIds.some((id) => typeof id !== 'string' || !id.trim())) errors.push(`bad completedIds ${game}`);
    if (row && row.resumeCursor !== null && typeof row.resumeCursor !== 'string') errors.push(`bad resumeCursor ${game}`);
    if (row && typeof row.exhausted !== 'boolean') errors.push(`bad exhausted ${game}`);
    if (row && row.updatedAt !== null && !Number.isFinite(Date.parse(row.updatedAt))) errors.push(`bad updatedAt ${game}`);
  }
  return errors;
}
