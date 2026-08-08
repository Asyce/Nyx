// ============================================================
// Event sources: official announcement endpoints for all 5 games.
// Verified live 2026-07-12 (see EVENTS_README). Every fetch stores a raw
// snapshot under events/raw/ so parser fixes never need a re-fetch, and an
// offline mode (NYX_EVENTS_OFFLINE=1) re-parses from those snapshots.
//
// Resilience: retry+backoff, treat shapes as changeable, and flag anomalies
// (retcode≠0, empty list) so the orchestrator can carry forward last-known-good.
// Deterministic extraction only — no AI stage.
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanTitle, classifyType, decodeEntities, makeEvent, mergeRegionalEvents, parseEndfieldAvailability, parseHoyoDuration, parseScopedDateRange } from './core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const RAW_DIR = path.join(here, 'raw');
const OFFLINE = String(process.env.NYX_EVENTS_OFFLINE || '').toLowerCase() === 'true' || process.env.NYX_EVENTS_OFFLINE === '1';
const UA = 'Nyxarium/1.0 events (https://pengo.gg)';
const staleFetchKeys = new Set();
const sourceUsedStale = (prefix) => [...staleFetchKeys].some((key) => key.startsWith(prefix));

async function writeRaw(key, payload) {
  try {
    await fs.mkdir(RAW_DIR, { recursive: true });
    await fs.writeFile(path.join(RAW_DIR, `${key}.json`), JSON.stringify({ savedAt: new Date().toISOString(), payload }, null, 2));
  } catch { /* best-effort */ }
}

async function readRaw(key) {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(RAW_DIR, `${key}.json`), 'utf8'));
    return parsed?.payload ?? null;
  } catch { return null; }
}

// Fetch JSON with retry/backoff; snapshot on success; in OFFLINE mode read the snapshot.
export async function fetchJson(url, key, { attempts = 3, timeoutMs = 20_000 } = {}) {
  if (OFFLINE) {
    const cached = await readRaw(key);
    if (cached === null) throw new Error(`offline: no raw snapshot for ${key}`);
    return cached;
  }
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const payload = await response.json();
      await writeRaw(key, payload);
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((r) => setTimeout(r, 500 * (2 ** attempt)));
    }
  }
  // Last-ditch: fall back to a stale snapshot rather than crash the pipeline.
  const stale = await readRaw(key);
  if (stale !== null) { staleFetchKeys.add(key); lastError && console.warn(`::warning::events ${key} fetch failed (${lastError.message}); using stale raw snapshot`); return stale; }
  throw new Error(`events fetch failed ${key}: ${lastError?.message || lastError}`);
}

// ---------- HoYo (GI / HSR / ZZZ) ----------
// The working hosts are the sg- ones; *-api-os.hoyoverse.com 504s (plan Workstream N).
// Europe server endpoints (verified). Event-duration times in bodies are server-local.
const HOYO = {
  gi: {
    sourceName: 'Genshin Impact Official',
    server: 'europe', timezone: 'UTC+01:00', offset: '+01:00',
    list: 'https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api/getAnnList?game=hk4e&game_biz=hk4e_global&lang=en&bundle_id=hk4e_global&channel_id=1&level=55&platform=pc&region=os_euro&uid=700000000',
    content: 'https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api/getAnnContent?game=hk4e&game_biz=hk4e_global&lang=en&bundle_id=hk4e_global&platform=pc&region=os_euro&level=55&uid=700000000',
    postUrl: (id) => `https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api/getAnnContent?game=hk4e&game_biz=hk4e_global&lang=en&ann_id=${id}`,
  },
  hsr: {
    sourceName: 'Honkai: Star Rail Official',
    server: 'europe', timezone: 'UTC+01:00', offset: '+01:00',
    list: 'https://sg-hkrpg-api.hoyoverse.com/common/hkrpg_global/announcement/api/getAnnList?game=hkrpg&game_biz=hkrpg_global&lang=en&bundle_id=hkrpg_global&channel_id=1&level=55&platform=pc&region=prod_official_eur&uid=700000000',
    content: 'https://sg-hkrpg-api.hoyoverse.com/common/hkrpg_global/announcement/api/getAnnContent?game=hkrpg&game_biz=hkrpg_global&lang=en&bundle_id=hkrpg_global&platform=pc&region=prod_official_eur&level=55&uid=700000000',
    postUrl: (id) => `https://sg-hkrpg-api.hoyoverse.com/common/hkrpg_global/announcement/api/getAnnContent?game=hkrpg&game_biz=hkrpg_global&lang=en&ann_id=${id}`,
  },
  zzz: {
    sourceName: 'Zenless Zone Zero Official',
    server: 'europe', timezone: 'UTC+01:00', offset: '+01:00',
    list: 'https://sg-announcement-api.hoyoverse.com/common/nap_global/announcement/api/getAnnList?game=nap&game_biz=nap_global&lang=en&bundle_id=nap_global&channel_id=1&level=55&platform=pc&region=prod_gf_eu&uid=700000000',
    content: 'https://sg-announcement-api.hoyoverse.com/common/nap_global/announcement/api/getAnnContent?game=nap&game_biz=nap_global&lang=en&bundle_id=nap_global&platform=pc&region=prod_gf_eu&level=55&uid=700000000',
    postUrl: (id) => `https://sg-announcement-api.hoyoverse.com/common/nap_global/announcement/api/getAnnContent?game=nap&game_biz=nap_global&lang=en&ann_id=${id}`,
  },
};

const HOYO_REGION_VALUES = {
  gi:{ asia:'os_asia', europe:'os_euro', america:'os_usa' },
  hsr:{ asia:'prod_official_asia', europe:'prod_official_eur', america:'prod_official_usa' },
  zzz:{ asia:'prod_gf_jp', europe:'prod_gf_eu', america:'prod_gf_us' },
};
const REGION_TIME = {
  asia:{ timezone:'UTC+08:00', offset:'+08:00' },
  europe:{ timezone:'UTC+01:00', offset:'+01:00' },
  america:{ timezone:'UTC-05:00', offset:'-05:00' },
};

function hoyoRegionConfig(game, region) {
  const base = HOYO[game];
  const regionValue = HOYO_REGION_VALUES[game]?.[region];
  if (!base || !regionValue || !REGION_TIME[region]) throw new Error(`Unsupported HoYo region ${game}/${region}`);
  const replaceRegion = (value) => {
    const url = new URL(value);
    url.searchParams.set('region', regionValue);
    return url.toString();
  };
  return { ...base, ...REGION_TIME[region], server:region, list:replaceRegion(base.list), content:replaceRegion(base.content) };
}

// The feed has TWO announcement lists. `data.list` holds text notices, and
// `data.pic_list` holds the illustrated event cards — nested one level deeper,
// under a per-type bucket. Star Rail and Zenless publish most of their events
// only in the picture list (2026-08-08: HSR had 1 event in the text list and 8
// in the picture list), so reading `data.list` alone made those games look
// almost empty. Genshin uses the text list only, hence it never showed.
function flattenAnnList(payload) {
  const anns = [];
  for (const group of payload?.data?.list || []) {
    for (const ann of group.list || []) anns.push({ ...ann, type_label: group.type_label });
  }
  for (const group of payload?.data?.pic_list || []) {
    for (const bucket of group.type_list || []) {
      for (const ann of bucket.list || []) anns.push({ ...ann, type_label: ann.type_label || group.type_label, _pic: true });
    }
  }
  if (!anns.length && !Array.isArray(payload?.data?.list)) return { anns: [], retcode: payload?.retcode };
  return { anns, retcode: payload?.retcode };
}

// A picture announcement carries no body, so its own window IS the event
// window. Some carry a placeholder end a decade out ("Fate/UBW Collaboration
// Warp Details" ends 2036) — that is "no announced end", not a ten-year event.
const HOYO_PIC_HORIZON_MS = 2 * 365 * 24 * 60 * 60 * 1000;

export function hoyoPicWindow(ann, offset) {
  if (!ann?._pic) return { start:null, end:null };
  const at = (value) => {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return null;
    const iso = text.replace(' ', 'T') + offset;
    return Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString() : null;
  };
  const start = at(ann.start_time);
  let end = at(ann.end_time);
  if (end && Date.parse(end) - Date.now() > HOYO_PIC_HORIZON_MS) end = null;
  if (end && start && Date.parse(end) <= Date.parse(start)) end = null;
  return { start, end };
}

const HOYO_EVENT_TITLE = /\b(event|festival|challenge|trial|login|log-in|check-?in|wish|warp|signal search|w-engine|convene|double drop|drop rate|ley line overflow|overflowing mastery|planar fissure|garden of plenty|realm of the strange|gift|shop|bundle|combat|onslaught|abyss|fiction|hollow zero|shiyu|deadly assault)\b/i;
const HOYO_NOTICE_ONLY = /\b(fair gaming|declaration|survey|privacy|terms|community rules|fan[- ]?made|legal|known issues?|bug fixes?|maintenance|update summary|update details|adjustment|faq|account security|social media|project astro-warp)\b/i;

export function isHoyoEventCandidate(ann, body) {
  const title = cleanTitle(ann?.title || '');
  if (!title || HOYO_NOTICE_ONLY.test(title)) return false;
  const duration = parseHoyoDuration(body?.content || '', '+00:00');
  if (duration.start || duration.permanent) return true;
  if (ann?._pic && hoyoPicWindow(ann, '+00:00').start) return true;
  const classified = classifyType(title, { typeLabel: ann?.type_label || '' });
  return classified !== 'event' || HOYO_EVENT_TITLE.test(title);
}

// Pure parser: given a getAnnList payload + getAnnContent payload, produce events.
export function parseHoyo(game, listPayload, contentPayload, region = 'europe', fetchedAt = null) {
  const cfg = hoyoRegionConfig(game, region);
  const { anns } = flattenAnnList(listPayload);
  const contentById = new Map((contentPayload?.data?.list || []).map((c) => [c.ann_id, c]));
  const events = [];
  for (const ann of anns) {
    const title = cleanTitle(ann.title);
    if (!title) continue;
    const body = contentById.get(ann.ann_id);
    if (!isHoyoEventCandidate(ann, body)) continue;
    let start = null; let end = null; let permanent = false; let dateSource = 'content';
    if (body) {
      const parsed = parseHoyoDuration(body.content, cfg.offset);
      if (parsed.permanent) permanent = true;
      if (parsed.start) { start = parsed.start; end = parsed.end; dateSource = 'content'; }
    }
    // Picture announcements have no body to read, so their own window is the
    // event window — the only dates those events ever publish here.
    if (!start && ann._pic) {
      const picked = hoyoPicWindow(ann, cfg.offset);
      if (picked.start) { start = picked.start; end = picked.end; dateSource = 'list'; }
    }
    // Announcement-list start/end fields describe notice visibility, not the
    // event itself. Missing/broken content therefore stays needs_review.
    events.push(makeEvent({
      game,
      sourceKey: 'hoyo-ann',
      nativeId: ann.ann_id,
      title,
      typeLabel: ann.type_label,
      start, end, permanent,
      server: cfg.server, timezone: cfg.timezone,
      sourceName: cfg.sourceName,
      sourceUrl: cfg.postUrl(ann.ann_id),
      sourceKind: 'official-announcement-api',
      fetchedAt,
      priority: 1,
      image: ann.banner || ann.img || null,
      description: body?.content || null,
      dateSource,
    }));
  }
  return events;
}

// Announcement art (the `banner` field), keyed by ann_id — i.e. by an event's
// source.recordId. Deliberately kept out of parseHoyo: an event record must
// never carry a publisher CDN URL, because the site only ever renders local
// /assets paths (normalizeEventImage) and the deployed CSP blocks third-party
// image hosts. Scraper/events/art.mjs downloads these and writes the local path.
export function hoyoArtByRecordId(listPayload) {
  const { anns } = flattenAnnList(listPayload);
  const out = new Map();
  for (const ann of anns) {
    const id = ann?.ann_id === undefined || ann?.ann_id === null ? '' : String(ann.ann_id);
    const banner = String(ann?.banner || ann?.img || '').trim();
    if (id && banner) out.set(id, banner);
  }
  return out;
}

export async function fetchHoyoArt(game) {
  if (!HOYO[game]) return new Map();
  const cfg = hoyoRegionConfig(game, 'europe');
  return hoyoArtByRecordId(await fetchJson(cfg.list, `${game}-europe-annlist`));
}

// Kuro publishes no cover field on either the menu or the article (both
// `suggestCover` and `articleCover` are empty across the whole feed), but every
// event post opens with its key visual, so the first body image is the art.
export function wuwaArticleArt(articlePayload) {
  const match = String(articlePayload?.articleContent || '').match(/<img[^>]+src="([^"]+)"/i);
  return match ? decodeEntities(match[1]).trim() : null;
}

export async function scrapeHoyo(game) {
  staleFetchKeys.forEach((key) => { if (key.startsWith(`${game}-`)) staleFetchKeys.delete(key); });
  const fetchedAt = new Date().toISOString();
  const regional = [];
  const anomalies = [];
  const artByRecordId = new Map();
  let fetched = 0;
  let pagesFetched = 0;
  for (const region of ['europe','asia','america']) {
    const cfg = hoyoRegionConfig(game, region);
    try {
      const listPayload = await fetchJson(cfg.list, `${game}-${region}-annlist`);
      const contentPayload = await fetchJson(cfg.content, `${game}-${region}-anncontent`);
      for (const [id, url] of hoyoArtByRecordId(listPayload)) if (!artByRecordId.has(id)) artByRecordId.set(id, url);
      const { anns, retcode } = flattenAnnList(listPayload);
      pagesFetched += 1;
      fetched += anns.length;
      if (retcode !== 0 && retcode !== undefined) anomalies.push(`${region} retcode ${retcode}`);
      else if (!anns.length) anomalies.push(`${region} empty announcement list`);
      regional.push(...parseHoyo(game, listPayload, contentPayload, region, fetchedAt));
    } catch (error) {
      anomalies.push(`${region} fetch failed: ${error.message}`);
    }
  }
  const stale = sourceUsedStale(`${game}-`);
  if (stale) anomalies.push('one or more regions used a stale raw snapshot');
  return {
    events:mergeRegionalEvents(regional), artByRecordId, anomaly:anomalies.join('; ') || null, fetched,
    pagesFetched, pageLimit:3, exhausted:pagesFetched === 3, resumeCursor:pagesFetched === 3 ? null : ['europe','asia','america'][pagesFetched], stale,
    gaps:['The official HoYo announcement API is a rolling feed and does not expose a launch-to-present pagination cursor.'],
  };
}

// ---------- WuWa (Kuro official CDN) ----------
const WUWA_MENU = 'https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en/ArticleMenu.json';
const WUWA_ARTICLE = (id) => `https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en/article/${id}.json`;
const WUWA_POST = (id) => `https://wutheringwaves.kurogames.com/en/main/news/detail/${id}`;
const WUWA_EVENTISH = /\b(event|convene|challenge|login|sign-?in|activit(?:y|ies))\b/i;
export function isWuwaEventCandidate(item) { return WUWA_EVENTISH.test(item?.articleTitle || ''); }

// Pure parser for one WuWa article body. offset = server time (+08:00).
export function parseWuwaArticle(menuItem, articlePayload) {
  const html = String(articlePayload?.articleContent || '');
  const { start, end } = parseScopedDateRange(html, '+08:00', ['Duration', 'Event Duration', 'Event Period', 'Availability']);
  return makeEvent({
    game: 'wuwa',
    sourceKey: 'kuro-article',
    nativeId: menuItem.articleId,
    title: menuItem.articleTitle,
    typeLabel: '',
    start, end, permanent: false,
    server: 'global', timezone: 'UTC+08:00',
    sourceName: 'Wuthering Waves Official',
    sourceUrl: WUWA_POST(menuItem.articleId),
    sourceKind: 'official-article-api',
    priority: 1,
    image: menuItem.suggestCover || null,
    description: html,
    dateSource: 'content',
    windowsByRegion:start ? { global:{ start, ...(end ? { end } : {}), timezone:'UTC+08:00', sourceUrl:WUWA_POST(menuItem.articleId) } } : null,
  });
}

const wuwaRecordId = (item) => String(item?.articleId || '');

export function planWuwaHistory(candidates, { limit = 80, completedIds = [], resumeCursor = null, recentLimit = 60 } = {}) {
  const boundedLimit = Math.max(1, Math.floor(Number(limit) || 1));
  const completed = new Set(completedIds.map(String));
  // Keep current notices fresh while reserving at least one slot for history.
  const refreshCount = Math.min(candidates.length, Math.max(0, boundedLimit - 1), Math.max(0, recentLimit));
  const recent = candidates.slice(0, refreshCount);
  const recentIds = new Set(recent.map(wuwaRecordId));
  const cursorIndex = resumeCursor === null ? -1 : candidates.findIndex((item) => wuwaRecordId(item) === String(resumeCursor));
  const historyStart = cursorIndex >= 0 ? cursorIndex : refreshCount;
  const historyPool = candidates.slice(historyStart)
    .filter((item) => !recentIds.has(wuwaRecordId(item)) && !completed.has(wuwaRecordId(item)));
  const history = historyPool.slice(0, boundedLimit - recent.length);
  return {
    batch:[...recent, ...history],
    historyPool,
    cursorFound:resumeCursor === null || cursorIndex >= 0,
  };
}

export async function scrapeWuwa({ limit = 80, completedIds = [], resumeCursor = null, onCheckpoint = async () => {}, delayMs = 250 } = {}) {
  staleFetchKeys.forEach((key) => { if (key.startsWith('wuwa-')) staleFetchKeys.delete(key); });
  const menu = await fetchJson(WUWA_MENU, 'wuwa-menu');
  if (!Array.isArray(menu)) return { events: [], anomaly: 'menu not an array', fetched: 0, pagesFetched:1, pageLimit:1, exhausted:false, resumeCursor:null, gaps:['Official menu response was not an array.'] };
  const candidates = menu
    .filter(isWuwaEventCandidate)
    .sort((a, b) => String(b.startTime).localeCompare(String(a.startTime)) || String(b.articleId).localeCompare(String(a.articleId)));
  const completed = new Set(completedIds.map(String));
  const plan = planWuwaHistory(candidates, { limit, completedIds, resumeCursor });
  const batch = plan.batch;
  const events = [];
  const artByRecordId = new Map();
  let failed = 0;
  const nextCursor = () => wuwaRecordId(plan.historyPool.find((item) => !completed.has(wuwaRecordId(item)))) || null;
  for (let index = 0; index < batch.length; index += 1) {
    const item = batch[index];
    try {
      const article = await fetchJson(WUWA_ARTICLE(item.articleId), `wuwa-article-${item.articleId}`);
      const art = wuwaArticleArt(article);
      if (art) artByRecordId.set(wuwaRecordId(item), art);
      events.push(parseWuwaArticle(item, article));
      completed.add(String(item.articleId));
      await onCheckpoint({ completedIds:[...completed].sort(), resumeCursor:nextCursor() });
    } catch (error) {
      failed += 1;
      console.warn(`::warning::events wuwa article ${item.articleId} failed: ${error.message}`);
    }
    if (index + 1 < batch.length && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const unprocessed = plan.historyPool.filter((item) => !completed.has(wuwaRecordId(item))).length;
  const stale = sourceUsedStale('wuwa-');
  const anomaly = !candidates.length ? 'no event-ish articles in menu' : !plan.cursorFound ? `resume cursor ${resumeCursor} was absent; restarted at the first unprocessed historical record` : failed ? `${failed} article fetch failures` : unprocessed ? `history batch limit ${limit} reached` : stale ? 'one or more records used a stale raw snapshot' : null;
  return {
    events, artByRecordId, anomaly, fetched:batch.length, pagesFetched:1, pageLimit:1, exhausted:unprocessed === 0 && failed === 0,
    resumeCursor:nextCursor(),
    completedIds:[...completed].sort(), stale,
    gaps:unprocessed ? [`${unprocessed} official menu records remain for a later resumable batch.`] : [], reconcile:false,
  };
}

// ---------- Endfield (Gryphline web-news) ----------
const ENDFIELD_LIST = (page) => `https://web-news.gryphline.com/api/bulletin?lang=en-us&code=arknights_endfield_official&page=${page}&pageSize=20&tabs[]=notices`;
const ENDFIELD_DETAIL = (cid) => `https://web-news.gryphline.com/api/bulletin/${cid}?lang=en-us&code=arknights_endfield_official`;
const ENDFIELD_POST = (cid) => `https://endfield.gryphline.com/en-us/news/${cid}`;

// Pure parser for one Endfield bulletin detail. Bodies state availability as
// "Availability: <Month D, YYYY at HH:MM> (server time)". Asia server = UTC+8
// (the body's own "Asia Server Time Zone: UTC+8"). End is often an undated
// "Before version update and maintenance" → left null (needs_review).
export function parseEndfieldDetail(listItem, detailPayload) {
  const data = detailPayload?.data || {};
  const html = String(data.data || '');
  const { start, end } = parseEndfieldAvailability(html, '+08:00');
  return makeEvent({
    game: 'endfield',
    sourceKey: 'gryphline-bulletin',
    nativeId: listItem.cid,
    title: listItem.title,
    typeLabel: 'notices',
    start, end, permanent: false,
    server: 'global', timezone: 'UTC+08:00',
    sourceName: 'Arknights: Endfield Official',
    sourceUrl: ENDFIELD_POST(listItem.cid),
    sourceKind: 'official-bulletin-api',
    priority: 1,
    image: listItem.cover || null,
    description: html,
    dateSource: 'content',
    windowsByRegion:start ? { asia:{ start, ...(end ? { end } : {}), timezone:'UTC+08:00', sourceUrl:ENDFIELD_POST(listItem.cid) } } : null,
  });
}

const ENDFIELD_EVENTISH = /\b(event|headhunting|LTO|contingency contract|challenge|login|sign-?in)\b/i;
export function isEndfieldEventCandidate(item) { return ENDFIELD_EVENTISH.test(item?.title || ''); }

export function isSourceEventRecord(game, event) {
  const title = cleanTitle(event?.title || '');
  if (!title) return false;
  // Historical retention is deliberately broader than today's discovery
  // filter. Old official events may have neutral titles. Remove only narrow,
  // explicit known non-event families introduced by the old parser.
  if (game === 'wuwa') return !/\b(?:update maintenance notice|wallpaper|resonator (?:review|reveal)|patch notes?)\b/i.test(title);
  if (game === 'endfield') return !/\b(?:NVIDIA driver updates?|PayPal service|game tools updated|pre-download & update notice|update & maintenance preview)\b/i.test(title);
  return !HOYO_NOTICE_ONLY.test(title);
}

export async function scrapeEndfield({ pages = 50, startPage = 1, completedIds = [], onCheckpoint = async () => {}, delayMs = 250 } = {}) {
  staleFetchKeys.forEach((key) => { if (key.startsWith('endfield-')) staleFetchKeys.delete(key); });
  const events = [];
  const artByRecordId = new Map();
  let fetched = 0;
  let failed = 0;
  let pagesFetched = 0;
  let exhausted = false;
  let resumeCursor = startPage;
  const completed = new Set(completedIds.map(String));
  const seenPageHeads = new Set();
  const historyBudget = Math.max(0, pages - (startPage > 1 ? 1 : 0));
  const pageNumbers = [...new Set([1, ...Array.from({ length:historyBudget }, (_, index) => startPage + index)])];
  for (const page of pageNumbers) {
    const payload = await fetchJson(ENDFIELD_LIST(page), `endfield-list-${page}`);
    const list = payload?.data?.list || [];
    pagesFetched += 1;
    const head = list.map((item) => String(item.cid)).join(',');
    if (head && seenPageHeads.has(head)) { failed += 1; resumeCursor = page; break; }
    if (head) seenPageHeads.add(head);
    const relevant = list.filter(isEndfieldEventCandidate);
    fetched += relevant.length;
    for (const item of relevant) {
      try {
        const detail = await fetchJson(ENDFIELD_DETAIL(item.cid), `endfield-detail-${item.cid}`);
        const art = String(item.cover || '').trim();
        if (art) artByRecordId.set(String(item.cid), art);
        events.push(parseEndfieldDetail(item, detail));
        completed.add(String(item.cid));
      } catch (error) {
        failed += 1;
        console.warn(`::warning::events endfield ${item.cid} failed: ${error.message}`);
      }
    }
    resumeCursor = page + 1;
    exhausted = !list.length || list.length < 20;
    await onCheckpoint({ completedIds:[...completed].sort(), resumeCursor:exhausted ? null : resumeCursor });
    if (exhausted && page >= startPage) break;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const stale = sourceUsedStale('endfield-');
  const anomaly = !fetched && !exhausted ? 'no endfield notices' : failed ? `${failed} bulletin/repeated-page failures` : !exhausted ? `page limit ${pages} reached` : stale ? 'one or more records used a stale raw snapshot' : null;
  return {
    events, artByRecordId, anomaly, fetched, pagesFetched, pageLimit:pages, exhausted, resumeCursor:exhausted ? null : resumeCursor,
    completedIds:[...completed].sort(), stale,
    gaps:!exhausted ? ['The Gryphline bulletin history has more pages pending in the next resumable batch.'] : [], reconcile:true,
  };
}

export const SOURCE_META = {
  gi: { name: HOYO.gi.sourceName, endpoint: 'sg-hk4e-api.hoyoverse.com getAnnList+getAnnContent' },
  hsr: { name: HOYO.hsr.sourceName, endpoint: 'sg-hkrpg-api.hoyoverse.com getAnnList+getAnnContent' },
  zzz: { name: HOYO.zzz.sourceName, endpoint: 'sg-announcement-api.hoyoverse.com getAnnList+getAnnContent' },
  wuwa: { name: 'Wuthering Waves Official', endpoint: 'hw-media-cdn-mingchao.kurogame.com ArticleMenu.json + article/*.json' },
  endfield: { name: 'Arknights: Endfield Official', endpoint: 'web-news.gryphline.com /api/bulletin' },
};
