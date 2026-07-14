const SERVER_OFFSETS = { asia:'+08:00', europe:'+01:00', america:'-05:00' };

function localDate(parts, offset) {
  const iso = `${parts.year}-${String(parts.month).padStart(2,'0')}-${String(parts.day).padStart(2,'0')}T${String(parts.hour).padStart(2,'0')}:${String(parts.minute || 0).padStart(2,'0')}:00${offset}`;
  return new Date(iso);
}

function addMonths(date, count, day, hour, offset) {
  const local = new Date(date.getTime() + Number(offset.slice(0,3)) * 3_600_000);
  const target = local.getUTCFullYear() * 12 + local.getUTCMonth() + count;
  return localDate({ year:Math.floor(target / 12), month:(target % 12 + 12) % 12 + 1, day, hour }, offset);
}

export function validateActivity(activity) {
  if (!activity?.id || !activity.label || !['fixed','dated'].includes(activity.mode) || !activity.sourceUrl || !Number.isFinite(Date.parse(activity.verifiedAt))) throw new Error(`Invalid activity ${activity?.id}`);
  if (activity.mode === 'fixed') {
    if (!activity.anchorStart || !Number.isFinite(Date.parse(activity.anchorStart)) || !Number.isFinite(activity.resetHour) || !activity.timezoneMode) throw new Error(`Invalid fixed activity ${activity.id}`);
    if (!(Number.isFinite(activity.intervalDays) && activity.intervalDays > 0) && !(Number.isInteger(activity.calendarMonths) && activity.calendarMonths > 0 && Number.isInteger(activity.calendarDay))) throw new Error(`Fixed activity ${activity.id} has no cadence`);
    if (!(Number.isFinite(activity.durationDays) && activity.durationDays > 0) && !activity.durationToNext) throw new Error(`Fixed activity ${activity.id} has no duration`);
  }
  if (activity.mode === 'dated') {
    if (!Array.isArray(activity.windows) || !activity.windows.length) throw new Error(`Dated activity ${activity.id} has no windows`);
    for (const window of activity.windows) {
      const regional = Object.values(window.windowsByRegion || {});
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(window.dateStart || '') && /^\d{4}-\d{2}-\d{2}$/.test(window.dateEnd || '') && window.dateEnd > window.dateStart && window.source?.url;
      if (!dateOnly && (!regional.length || regional.some((row) => !row.start || !row.end || row.end <= row.start || !row.sourceUrl))) throw new Error(`Dated activity ${activity.id} has an invalid window`);
      if (window.status && !['exact','expected'].includes(window.status)) throw new Error(`Dated activity ${activity.id} has an invalid status`);
    }
  }
}

export function expandActivity(activity, rangeStart, rangeEnd, region='asia') {
  validateActivity(activity);
  const from = new Date(rangeStart); const to = new Date(rangeEnd);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) throw new Error('Invalid activity range');
  if (activity.mode === 'dated') return activity.windows.filter((row) => {
    const window = row.windowsByRegion?.[region];
    if (window) return window.end > from.toISOString() && window.start < to.toISOString();
    return row.dateEnd > from.toISOString().slice(0,10) && row.dateStart < to.toISOString().slice(0,10);
  }).map((row) => ({ status:'exact', ...row }));
  const offset = SERVER_OFFSETS[region];
  if (!offset) return [];
  const exceptions = new Map((activity.exceptions || []).filter((x) => x.region === region).map((x) => [x.start, x]));
  const rows = [];
  const asiaAnchor = new Date(Date.parse(activity.anchorStart) + 8 * 3_600_000);
  let cursor = localDate({ year:asiaAnchor.getUTCFullYear(), month:asiaAnchor.getUTCMonth()+1, day:asiaAnchor.getUTCDate(), hour:asiaAnchor.getUTCHours(), minute:asiaAnchor.getUTCMinutes() }, offset);
  let guard = 0;
  while (cursor < from && guard++ < 2000) {
    const next = activity.calendarMonths ? addMonths(cursor, activity.calendarMonths, activity.calendarDay, activity.resetHour, offset) : new Date(cursor.getTime() + activity.intervalDays * 86_400_000);
    const end = activity.durationToNext ? next : new Date(cursor.getTime() + activity.durationDays * 86_400_000);
    if (end > from) break;
    cursor = next;
  }
  guard = 0;
  while (cursor < to && guard++ < 2000) {
    const start = cursor.toISOString();
    if (activity.stopAfterByRegion?.[region] && start > activity.stopAfterByRegion[region]) break;
    const exception = exceptions.get(start);
    const next = activity.calendarMonths ? addMonths(cursor, activity.calendarMonths, activity.calendarDay, activity.resetHour, offset) : new Date(cursor.getTime() + activity.intervalDays * 86_400_000);
    const end = activity.durationToNext ? new Date(next.getTime() - 1000) : new Date(cursor.getTime() + activity.durationDays * 86_400_000 - 1000);
    if (!exception?.skip && end > from) rows.push(exception?.window ? { status:'exact', ...exception.window } : { start, end:end.toISOString(), timezone:`UTC${offset}`, sourceUrl:activity.sourceUrl, status:'expected' });
    cursor = next;
  }
  if (guard >= 2000) throw new Error(`Activity expansion overflow ${activity.id}`);
  return rows;
}

function windowsOverlap(left, right) {
  for (const region of new Set([...Object.keys(left?.windowsByRegion || {}), ...Object.keys(right?.windowsByRegion || {})])) {
    const a = left?.windowsByRegion?.[region]; const b = right?.windowsByRegion?.[region];
    if (!a?.start || !b?.start) continue;
    const ae = Date.parse(a.end || a.start); const be = Date.parse(b.end || b.start);
    if (Date.parse(a.start) <= be && Date.parse(b.start) <= ae) return true;
  }
  return false;
}

export function reconcileActivityWindows(existing = [], exact = []) {
  const exactRows = exact.map((row) => ({ ...row, status:'exact' }));
  const kept = existing.filter((row) => row?.status !== 'expected' || !exactRows.some((candidate) => windowsOverlap(row, candidate)));
  const byKey = new Map();
  for (const row of [...kept, ...exactRows]) {
    const key = row.id || JSON.stringify(row.windowsByRegion || row.dateStart || row);
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => {
    const first = (row) => Object.values(row.windowsByRegion || {}).map((window) => window.start).filter(Boolean).sort()[0] || row.dateStart || '';
    return first(a).localeCompare(first(b));
  });
}

export function validateActivityFile(file) {
  if (file?.schemaVersion !== 1 || !file.game || !Array.isArray(file.activities)) throw new Error('Invalid activity file');
  const ids = new Set();
  for (const row of file.activities) { validateActivity(row); if (ids.has(row.id)) throw new Error(`Duplicate activity ${row.id}`); ids.add(row.id); }
  return file;
}

export { SERVER_OFFSETS };
