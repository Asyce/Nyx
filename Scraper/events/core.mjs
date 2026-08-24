// ============================================================
// Events pipeline — normalized schema, deterministic date parsing,
// classification, dedupe, and validation. NO AI / LLM extraction.
//
// Contract (Sonnet's UI depends on this exact per-event shape):
//   { game, id, title, type, start, end, server, timezone,
//     source: { name, url, priority }, confidence, permanence,
//     needs_review, image, description }
//   type      ∈ event | banner | web_event | login | challenge | shop | permanent
//   confidence∈ high | medium | low
//   permanence∈ permanent | timed | unknown
// Date-less / unparseable timed entries get needs_review:true rather than a guess.
// ============================================================

import crypto from 'node:crypto';

export const GAMES = ['gi', 'hsr', 'zzz', 'wuwa', 'endfield'];
export function normalizeEventImage(value) {
  const image = String(value || '').trim();
  if (!image) return null;
  // Runtime event data may reference an already-shipped site asset, but it must
  // never hotlink announcement/CDN art. Event art is optional and is not
  // downloaded by this pipeline.
  return /^\/assets\/[a-z0-9][a-z0-9._/-]*\.(?:avif|jpe?g|png|webp)$/i.test(image) && !image.includes('..')
    ? image
    : null;
}
export const EVENT_TYPES = new Set(['event', 'banner', 'web_event', 'login', 'challenge', 'shop', 'permanent']);
export const CONFIDENCE = new Set(['high', 'medium', 'low']);
export const PERMANENCE = new Set(['permanent', 'timed', 'unknown']);

// ---- text helpers ----
export function decodeEntities(value = '') {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '-', mdash: '-' };
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|ndash|mdash);/gi, (_, body) => {
    const key = body.toLowerCase();
    if (Object.hasOwn(named, key)) return named[key];
    if (key.startsWith('#x')) { const cp = Number.parseInt(key.slice(2), 16); return Number.isFinite(cp) ? String.fromCodePoint(cp) : ''; }
    if (key.startsWith('#')) { const cp = Number.parseInt(key.slice(1), 10); return Number.isFinite(cp) ? String.fromCodePoint(cp) : ''; }
    return '';
  });
}

export function stripTags(html = '') {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function cleanTitle(value = '') {
  // Announcement titles sometimes arrive wrapped in <p> markup (ZZZ) or with quotes.
  return stripTags(value).replace(/\s+/g, ' ').trim();
}

export function descriptionSnippet(value = '', maxLength = Infinity) {
  if (value === null || value === undefined) return null;
  const text = stripTags(decodeEntities(String(value))).replace(/[<>]/g, ' ').replace(/\s+/g, ' ').replace(/\s+([.,!?;:])/g, '$1').trim();
  if (!text) return null;
  const limit = Number.isFinite(Number(maxLength)) ? Math.max(40, Number(maxLength)) : Infinity;
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit - 1).replace(/\s+\S*$/, '').trim();
  return `${clipped || text.slice(0, limit - 1)}…`;
}

export function normalizeTitle(value = '') {
  return cleanTitle(value)
    .toLowerCase()
    .replace(/["'“”‘’«»]/g, '')
    .replace(/\b(?:version\s+)?\d+\.\d+\b/g, ' ')
    .replace(/\b(?:event|details|now available|coming soon|preview|announcement|notice)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ---- date helpers ----
// Accepts "2026/07/08 10:00", "2026-07-08 10:00:00", "2026-07-08T10:00" and an
// offset like "+01:00". Returns an ISO8601 instant, or null if unparseable.
export function toIso(value, offset = '+00:00') {
  const match = String(value || '').trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const off = String(offset || '+00:00').replace(/^(?:GMT|UTC)/i, '').replace(/^([+-]\d{1,2})$/, '$1:00').replace(/^([+-])(\d):/, '$10$2:') || '+00:00';
  const stamp = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T${match[4].padStart(2, '0')}:${match[5]}:${match[6] || '00'}${off}`;
  const parsed = new Date(stamp);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

// "January 5, 2026 at 05:00" (Endfield notice bodies) -> ISO with the given offset.
export function monthNameToIso(value, offset = '+00:00') {
  const m = String(value || '').match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})(?:\s+(?:at|,)\s+(\d{1,2}):(\d{2}))?/i);
  if (!m) return null;
  const hh = m[4] ? m[4].padStart(2, '0') : '00';
  const mm = m[5] || '00';
  return toIso(`${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')} ${hh}:${mm}`, offset);
}

// Pull the two boundary timestamps out of a HoYo "〓Event Duration〓" body.
// Prefers <t class="t_lc">…</t> markers, falls back to bare Y/M/D H:M strings.
// Returns { start, end, permanent } (ISO strings, or nulls).
export function parseHoyoDuration(contentHtml, offset = '+00:00', versionStarts = {}) {
  const decoded = decodeEntities(String(contentHtml || ''));
  // Only trust dates that sit inside an explicit Event Duration section. No section
  // means this notice doesn't state its own window (version notes, known issues); the
  // caller falls back to the announcement's list validity window instead of us
  // scraping unrelated reward-claim dates out of the body.
  const label = '(?:Event\\s+(?:Wish\\s+)?Duration|Event\\s+Period|Specified\\s+Duration|Time)';
  const header = new RegExp(`〓\\s*${label}\\s*〓`, 'i').exec(decoded)
    || new RegExp(`<(?:h[1-6]|p)\\b[^>]*>(?:\\s*<[^>]+>)*\\s*${label}\\s*(?:<\\/[^>]+>\\s*)*<\\/(?:h[1-6]|p)>`, 'i').exec(decoded)
    || new RegExp(`${label}\\s*[:：]`, 'i').exec(decoded);
  if (!header) return { start: null, end: null, permanent: false };
  // Start after an actual section label, not the same words in surrounding
  // prose or a table heading elsewhere in the announcement.
  const rest = decoded.slice(header.index + header[0].length);
  const nextMarker = rest.indexOf('〓');
  const tableEnd = rest.indexOf('</table>');
  const scope = nextMarker >= 0
    ? rest.slice(0, nextMarker)
    : tableEnd >= 0 && tableEnd < 2400 ? rest.slice(0, tableEnd) : rest.slice(0, 400);
  const date = '(\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}(?:\\s+\\d{1,2}:\\d{2}(?::\\d{2})?)?)';
  const tokens = [...scope.matchAll(new RegExp(`<t\\b([^>]*)>\\s*${date}\\s*<\\/t>|${date}`, 'gi'))];
  const isos = tokens.map((match) => {
    const value = match[2] || match[3];
    const tokenOffset = /\bt_gl\b/i.test(match[1] || '') ? '+08:00' : offset;
    return toIso(/\d:\d{2}/.test(value) ? value : `${value} 00:00`, tokenOffset);
  }).filter(Boolean);
  // Require an ordered start<end pair. Open-start events ("After the Version update –
  // <date>") and single-boundary notices fall through to needs_review, never a guess.
  for (let i = 0; i + 1 < isos.length; i += 1) {
    if (Date.parse(isos[i + 1]) > Date.parse(isos[i])) return { start: isos[i], end: isos[i + 1], permanent: false };
  }
  if (/permanent|permanently available|indefinite/i.test(scope)) return { start: null, end: null, permanent: true };
  const version = scope.match(/After\s+(?:the\s+)?Version\s+(\d+(?:\.\d+)+)\s+update/i)?.[1];
  const start = version && versionStarts[version];
  if (start && isos[0] && Date.parse(isos[0]) > Date.parse(start)) return { start, end: isos[0], permanent: false };
  return { start: null, end: null, permanent: false };
}

// Endfield notice bodies state "Availability: <Month D, YYYY at HH:MM> (server time) – …".
// Parse the first Availability block: month-name start, optional month-name/numeric end.
// End is frequently "Before version update and maintenance" (undated) → left null.
export function parseEndfieldAvailability(html, offset = '+08:00') {
  const text = stripTags(html);
  const idx = text.search(/Availability\s*[:：]/i);
  if (idx < 0) return { start: null, end: null };
  const tail = text.slice(idx, idx + 500);
  const afterHeader = tail.replace(/^.*?Availability\s*[:：]\s*/i, '');
  const boundary = afterHeader.search(/(?:[✦◆【〖「『]\s*(?:Eligibility|Requirements?|Rewards?|Details|Rules?|Notes?|Description|Content|Schedule)\s*[✦◆】〗」』]|\b(?:Eligibility|Requirements?|Rewards?|Details|Rules?|Notes?|Description|Content|Schedule)\s*[:：])/i);
  const scope = boundary >= 0 ? afterHeader.slice(0, boundary) : afterHeader.slice(0, 220);
  const starts = [...scope.matchAll(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+20\d{2}(?:\s+(?:at|,)\s+\d{1,2}:\d{2})?/gi)].map((m) => monthNameToIso(m[0], offset)).filter(Boolean);
  const numeric = [...scope.matchAll(/(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2})/g)].map((m) => toIso(m[1], offset)).filter(Boolean);
  const dates = [...starts, ...numeric].sort();
  const start = starts[0] || dates[0] || null;
  const end = dates.find((d) => start && Date.parse(d) > Date.parse(start)) || null;
  return { start, end };
}

// Generic "start - end" range with an optional trailing "(server time)" tag.
// Used for WuWa article bodies. Returns { start, end } ISO or nulls.
export function parseDateRange(text, offset = '+00:00') {
  const clean = stripTags(text);
  const dates = [...clean.matchAll(/(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)/g)].map((m) => toIso(m[1], offset)).filter(Boolean);
  if (dates.length === 1) return { start: dates[0], end: null };
  for (let index = 0; index + 1 < dates.length; index += 1) {
    if (Date.parse(dates[index + 1]) > Date.parse(dates[index])) return { start: dates[index], end: dates[index + 1] };
  }
  return { start: null, end: null };
}

// Parse a date pair only from a named duration/availability section. The scope
// ends at the next common section heading so reward, maintenance, publication,
// and unrelated schedule dates elsewhere in the article can never be promoted
// to the event window.
export function parseScopedDateRange(html, offset = '+00:00', headings = ['Duration', 'Event Duration', 'Event Period', 'Availability']) {
  const text = stripTags(html);
  const escaped = headings.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const header = new RegExp(`\\b(?:${escaped})\\s*(?:[:：]|[✦】』」◆])`, 'i');
  const match = header.exec(text);
  if (!match) return { start: null, end: null };
  const tail = text.slice(match.index + match[0].length);
  const boundary = tail.search(/(?:[✦◆【〖「『]\s*(?:Eligibility|Requirements?|Rewards?|How to Participate|Event Details|Details|Rules?|Notes?|Description|Content|Schedule)\s*[✦◆】〗」』]|\b(?:Eligibility|Requirements?|Rewards?|How to Participate|Event Details|Details|Rules?|Notes?|Description|Content|Schedule)\s*[:：])/i);
  const scope = (boundary >= 0 ? tail.slice(0, boundary) : tail.slice(0, 360));
  return parseDateRange(scope, offset);
}

// ---- classification (deterministic keyword map) ----
const BANNER_RE = /\b(event wish|epitome invocation|wish\b|character event warp|light cone event|warp\b|convene\b|signal search|w-engine|featured (?:resonator|weapon|character|agent|light cone)|chronicled|headhunting|arsenal exchange|rate ?up|banner|limited-time channels?|lto details)\b/i;
const LOGIN_RE = /\b(check-?in|log-?in|login|sign-?in|daily reward|web-?event login|check in)\b/i;
const CHALLENGE_RE = /\b(onslaught|abyss|memory of chaos|pure fiction|apocalyptic shadow|shiyu defense|deadly assault|hollow zero|combat (?:event|trial|challenge)|tacet crisis|realm of the strange|stygian|tower|boss challenge|forgotten hall|combat simulation)\b/i;
const SHOP_RE = /\b(shop|bundle|gift pack|supply pack|top-?up|mall|monthly card|blessing of|welkin)\b/i;
const WEB_RE = /\b(web[- ]?event|web[- ]?based|browser event|hoyolab (?:web )?event|mini[- ]?program)\b/i;

export function classifyType(title, { permanent = false, typeLabel = '' } = {}) {
  const hay = `${cleanTitle(title)} ${typeLabel || ''}`;
  if (BANNER_RE.test(hay)) return 'banner';
  if (WEB_RE.test(hay)) return 'web_event';
  if (LOGIN_RE.test(hay)) return 'login';
  if (CHALLENGE_RE.test(hay)) return 'challenge';
  if (SHOP_RE.test(hay)) return 'shop';
  if (permanent) return 'permanent';
  return 'event';
}

export function stableEventId(game, sourceKey, nativeId) {
  const basis = `${game}:${sourceKey}:${nativeId}`;
  return `${game}-${sourceKey}-${crypto.createHash('sha1').update(basis).digest('hex').slice(0, 12)}`;
}

// Build one normalized event from the pieces a parser has extracted.
export function makeEvent({ game, sourceKey, nativeId, title, typeLabel, start, end, permanent = false, server, timezone, sourceName, sourceUrl, sourceKind = 'official-feed', fetchedAt = null, priority = 1, image = null, description = null, dateSource = 'content', scheduleStatus = null, windowsByRegion = null }) {
  const cleanedTitle = cleanTitle(title);
  const type = classifyType(cleanedTitle, { permanent, typeLabel });
  // Defense-in-depth: a reversed/degenerate range is a bad parse — drop the end so the
  // entry becomes an honest needs_review rather than an invalid window.
  if (start && end && Date.parse(end) <= Date.parse(start)) end = null;
  const hasStart = Boolean(start);
  const hasEnd = Boolean(end);
  let permanence = 'unknown';
  if (permanent) permanence = 'permanent';
  else if (hasStart || hasEnd) permanence = 'timed';
  // needs_review flags entries we cannot place on the timeline without guessing:
  // no sourced start anchor and not permanent. A known start with an open end
  // (e.g. "until the next version update") is partial but real, not a guess.
  const needs_review = !permanent && !hasStart;
  let confidence = 'low';
  if (permanent) confidence = 'high';
  else if (hasStart && hasEnd) confidence = dateSource === 'content' ? 'high' : 'medium';
  else if (hasStart) confidence = 'medium';
  return {
    game,
    id: stableEventId(game, sourceKey, nativeId),
    title: cleanedTitle,
    type,
    start: hasStart ? start : null,
    end: hasEnd ? end : null,
    server: server || 'global',
    timezone: timezone || 'UTC+00:00',
    source: { name: sourceName, url: sourceUrl, kind:sourceKind, recordId:String(nativeId), fetchedAt:fetchedAt || new Date().toISOString(), priority },
    confidence,
    scheduleStatus:scheduleStatus || (permanent || hasStart ? 'exact' : 'expected'),
    permanence,
    needs_review,
    ...(windowsByRegion && Object.keys(windowsByRegion).length ? { windowsByRegion } : {}),
    image: normalizeEventImage(image),
    description: descriptionSnippet(description),
  };
}

// Recover only source IDs that are explicitly present in known official URLs.
// There is deliberately no hash/title fallback: an untraceable legacy row must
// fail validation instead of receiving invented provenance.
export function sourceRecordIdFromUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const queryId = url.searchParams.get('ann_id');
    if (queryId) return queryId;
    const pathId = url.pathname.match(/\/(?:article|detail|news)\/(\d+)\/?$/i)?.[1];
    return pathId || null;
  } catch {
    return null;
  }
}

export function normalizeRetainedEvent(event, observedAt) {
  if (!event || typeof event !== 'object') return event;
  const recordId = event.source?.recordId || sourceRecordIdFromUrl(event.source?.url);
  const validObservedAt = Number.isFinite(Date.parse(observedAt)) ? observedAt : null;
  const isTraceableLegacy = Boolean(recordId && validObservedAt && event.source?.url);
  const source = {
    ...event.source,
    ...(event.source?.kind ? {} : isTraceableLegacy ? { kind:'legacy-official-snapshot' } : {}),
    ...(event.source?.recordId ? {} : recordId ? { recordId:String(recordId) } : {}),
    ...(event.source?.fetchedAt ? {} : validObservedAt ? {
      fetchedAt:validObservedAt,
      fetchedAtMeaning:'nyx-snapshot-observed-at',
    } : {}),
  };
  const scheduleStatus = event.scheduleStatus
    ? (event.scheduleStatus === 'exact' && event.permanence !== 'permanent' && !event.start ? 'expected' : event.scheduleStatus)
    : source.kind === 'legacy-official-snapshot' ? (event.permanence === 'permanent' || event.start ? 'exact' : 'expected') : null;
  const classifiedType = classifyType(event.title, { permanent:event.permanence === 'permanent' });
  return {
    ...event,
    source,
    ...(event.type === 'event' && classifiedType !== 'event' ? { type:classifiedType } : {}),
    image:normalizeEventImage(event.image),
    ...(scheduleStatus ? { scheduleStatus } : {}),
  };
}

export function mergeRegionalEvents(events, preferredRegion = 'europe') {
  const merged = new Map();
  for (const event of events || []) {
    if (!event?.id) continue;
    const region = event.server || 'global';
    const existing = merged.get(event.id);
    const window = event.start ? {
      start:event.start,
      ...(event.end ? { end:event.end } : {}),
      timezone:event.timezone,
      sourceUrl:event.source?.url,
    } : null;
    if (!existing) {
      merged.set(event.id, {
        ...event,
        ...(window ? { windowsByRegion:{ [region]:window } } : {}),
      });
      continue;
    }
    const windowsByRegion = { ...(existing.windowsByRegion || {}) };
    if (window) windowsByRegion[region] = window;
    const preferred = region === preferredRegion || (!existing.start && event.start);
    merged.set(event.id, {
      ...(preferred ? { ...existing, ...event } : existing),
      windowsByRegion,
      source:{ ...existing.source, fetchedAt:[existing.source?.fetchedAt, event.source?.fetchedAt].filter(Boolean).sort().at(-1) || existing.source?.fetchedAt },
    });
  }
  return [...merged.values()];
}

// ---- dedupe: game + normalized title + overlapping range; official priority wins ----
function overlaps(a, b) {
  const as = a.start ? Date.parse(a.start) : null;
  const ae = a.end ? Date.parse(a.end) : as;
  const bs = b.start ? Date.parse(b.start) : null;
  const be = b.end ? Date.parse(b.end) : bs;
  if (as === null || bs === null) return true; // one side date-less: treat same title as the same thing
  return as <= (be ?? bs) && bs <= (ae ?? as);
}

function better(a, b) {
  // Lower priority number wins (official=1). Never authority-invert.
  if (a.source.priority !== b.source.priority) return a.source.priority < b.source.priority ? a : b;
  const rank = { high: 3, medium: 2, low: 1 };
  if (rank[a.confidence] !== rank[b.confidence]) return rank[a.confidence] > rank[b.confidence] ? a : b;
  // Prefer the one that actually has dates.
  const aDated = a.start && a.end ? 1 : 0;
  const bDated = b.start && b.end ? 1 : 0;
  if (aDated !== bDated) return aDated > bDated ? a : b;
  return a; // stable
}

export function dedupe(events) {
  const kept = [];
  for (const ev of events) {
    const key = normalizeTitle(ev.title);
    const clashIndex = kept.findIndex((k) => k.game === ev.game && normalizeTitle(k.title) === key && overlaps(k, ev));
    if (clashIndex < 0) { kept.push(ev); continue; }
    kept[clashIndex] = better(kept[clashIndex], ev);
  }
  return kept;
}

// Merge fresh events over an existing dataset by stable id. Fresh wins for a shared
// id (updated dates/confidence). Events absent from the fresh feed are RETAINED so
// ended events accumulate into history and a transient empty fetch never wipes data.
export function mergeById(previousEvents = [], freshEvents = []) {
  const byId = new Map();
  for (const ev of previousEvents) byId.set(ev.id, ev);
  for (const ev of freshEvents) byId.set(ev.id, ev);
  return [...byId.values()].sort((a, b) => (b.start || '').localeCompare(a.start || '') || a.id.localeCompare(b.id));
}

export function replaceExpectedWithExact(events = []) {
  const exact = events.filter((row) => row?.scheduleStatus === 'exact');
  return events.filter((row) => {
    if (row?.scheduleStatus !== 'expected') return true;
    const key = normalizeTitle(row.title);
    return !exact.some((candidate) => candidate.game === row.game && normalizeTitle(candidate.title) === key && overlaps(candidate, row));
  });
}


// Reconcile a complete successful source snapshot. Fresh rows win. An absent
// previous row is retained only when it has a verified end in the past, which
// preserves genuine history while allowing corrected parsers to remove false,
// undated, current, or future rows. Callers must NOT use this on an outage or
// anomaly; mergeById is the non-destructive carry-forward path for those cases.
export function reconcileById(previousEvents = [], freshEvents = [], now = Date.now(), retainPrevious = () => true) {
  const previousById = new Map(previousEvents.map((ev) => [ev.id, ev]));
  const stableFresh = freshEvents.map((ev) => {
    const previous = previousById.get(ev.id);
    // Some official notices describe the opening as "after the Version
    // update". The deterministic parser correctly leaves that undated. If a
    // previously verified copy of the same stable announcement already has a
    // complete official window, do not downgrade it back to needs-review.
    if (previous?.start && previous?.end && !ev?.start && !ev?.end && previous.confidence === 'high' && previous.needs_review === false) {
      return { ...ev, start:previous.start, end:previous.end, confidence:'high', permanence:'timed', needs_review:false };
    }
    return ev;
  });
  const freshIds = new Set(stableFresh.map((ev) => ev.id));
  const history = previousEvents.filter((ev) => {
    if (freshIds.has(ev.id)) return false;
    const end = ev?.end ? Date.parse(ev.end) : NaN;
    return Number.isFinite(end) && end < now && retainPrevious(ev);
  });
  return replaceExpectedWithExact(mergeById(history, stableFresh));
}

// ---- validation (mirrors validate-data.cjs style) ----
export function validateEvent(ev) {
  const errs = [];
  if (!ev || !GAMES.includes(ev.game)) errs.push(`bad game ${ev?.game}`);
  if (!ev?.id || !ev?.title) errs.push(`missing id/title (${ev?.id})`);
  if (!EVENT_TYPES.has(ev?.type)) errs.push(`bad type ${ev?.type} (${ev?.id})`);
  if (!CONFIDENCE.has(ev?.confidence)) errs.push(`bad confidence ${ev?.confidence} (${ev?.id})`);
  if (!PERMANENCE.has(ev?.permanence)) errs.push(`bad permanence ${ev?.permanence} (${ev?.id})`);
  if (typeof ev?.needs_review !== 'boolean') errs.push(`needs_review not bool (${ev?.id})`);
  if (ev?.description !== null && ev?.description !== undefined && (typeof ev.description !== 'string' || /[<>]/.test(ev.description))) errs.push(`bad description (${ev?.id})`);
  if (ev?.image !== null && ev?.image !== undefined && normalizeEventImage(ev.image) !== ev.image) errs.push(`bad event image (${ev?.id})`);
  if (!ev?.source?.name || !ev?.source?.url || typeof ev?.source?.priority !== 'number') errs.push(`bad source (${ev?.id})`);
  if (!ev?.source?.kind || !ev?.source?.recordId) errs.push(`missing source provenance (${ev?.id})`);
  if (!ev?.source?.fetchedAt || !Number.isFinite(Date.parse(ev.source.fetchedAt))) errs.push(`bad source fetchedAt (${ev?.id})`);
  if (!['exact','expected'].includes(ev?.scheduleStatus)) errs.push(`bad schedule status (${ev?.id})`);
  if (ev?.scheduleStatus === 'exact' && ev?.permanence !== 'permanent' && !ev?.start) errs.push(`exact schedule missing start (${ev?.id})`);
  for (const bound of ['start', 'end']) {
    if (ev?.[bound] !== null && !Number.isFinite(Date.parse(ev?.[bound]))) errs.push(`bad ${bound} ${ev?.[bound]} (${ev?.id})`);
  }
  if (ev?.start && ev?.end && Date.parse(ev.end) <= Date.parse(ev.start)) errs.push(`end<=start (${ev?.id})`);
  for (const [region, window] of Object.entries(ev?.windowsByRegion || {})) {
    if (!['global','asia','europe','america'].includes(region) || !window?.start || !Number.isFinite(Date.parse(window.start)) || (window?.end && Date.parse(window.end) <= Date.parse(window.start)) || !window?.sourceUrl) errs.push(`bad ${region} window (${ev?.id})`);
  }
  // A timed, non-permanent, non-needs_review event must carry a real start.
  if (!ev?.needs_review && ev?.permanence !== 'permanent' && !ev?.start) errs.push(`dated event missing start (${ev?.id})`);
  return errs;
}

export function validateDataset(dataset) {
  const errs = [];
  if (dataset?.schemaVersion !== 1 || !GAMES.includes(dataset?.game) || !Array.isArray(dataset?.events)) {
    errs.push(`invalid dataset envelope for ${dataset?.game}`);
    return errs;
  }
  const ids = new Set();
  for (const ev of dataset.events) {
    if (ids.has(ev?.id)) errs.push(`duplicate id ${ev?.id}`);
    ids.add(ev?.id);
    errs.push(...validateEvent(ev));
  }
  return errs;
}
