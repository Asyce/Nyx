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
import { cleanTitle, classifyType, makeEvent, parseEndfieldAvailability, parseHoyoDuration, parseScopedDateRange } from './core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const RAW_DIR = path.join(here, 'raw');
const OFFLINE = String(process.env.NYX_EVENTS_OFFLINE || '').toLowerCase() === 'true' || process.env.NYX_EVENTS_OFFLINE === '1';
const UA = 'Nyxarium/1.0 events (https://pengo.gg)';

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
  if (stale !== null) { lastError && console.warn(`::warning::events ${key} fetch failed (${lastError.message}); using stale raw snapshot`); return stale; }
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

function flattenAnnList(payload) {
  const groups = payload?.data?.list;
  if (!Array.isArray(groups)) return { anns: [], retcode: payload?.retcode };
  const anns = [];
  for (const group of groups) for (const ann of group.list || []) anns.push({ ...ann, type_label: group.type_label });
  return { anns, retcode: payload?.retcode };
}

const HOYO_EVENT_TITLE = /\b(event|festival|challenge|trial|login|log-in|check-?in|wish|warp|signal search|w-engine|convene|double drop|drop rate|ley line overflow|overflowing mastery|planar fissure|garden of plenty|realm of the strange|gift|shop|bundle|combat|onslaught|abyss|fiction|hollow zero|shiyu|deadly assault)\b/i;
const HOYO_NOTICE_ONLY = /\b(fair gaming|declaration|survey|privacy|terms|community rules|fan[- ]?made|legal|known issues?|bug fixes?|maintenance|update summary|update details|adjustment|faq|account security|social media|project astro-warp)\b/i;

export function isHoyoEventCandidate(ann, body) {
  const title = cleanTitle(ann?.title || '');
  if (!title || HOYO_NOTICE_ONLY.test(title)) return false;
  const duration = parseHoyoDuration(body?.content || '', '+00:00');
  if (duration.start || duration.permanent) return true;
  const classified = classifyType(title, { typeLabel: ann?.type_label || '' });
  return classified !== 'event' || HOYO_EVENT_TITLE.test(title);
}

// Pure parser: given a getAnnList payload + getAnnContent payload, produce events.
export function parseHoyo(game, listPayload, contentPayload) {
  const cfg = HOYO[game];
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
      priority: 1,
      image: ann.banner || null,
      description: body?.content || null,
      dateSource,
    }));
  }
  return events;
}

export async function scrapeHoyo(game) {
  const cfg = HOYO[game];
  const listPayload = await fetchJson(cfg.list, `${game}-annlist`);
  const contentPayload = await fetchJson(cfg.content, `${game}-anncontent`);
  const { anns, retcode } = flattenAnnList(listPayload);
  const anomaly = retcode !== 0 && retcode !== undefined ? `retcode ${retcode}` : (!anns.length ? 'empty announcement list' : null);
  return { events: parseHoyo(game, listPayload, contentPayload), anomaly, fetched: anns.length };
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
    priority: 1,
    image: menuItem.suggestCover || null,
    description: html,
    dateSource: 'content',
  });
}

export async function scrapeWuwa({ limit = 40 } = {}) {
  const menu = await fetchJson(WUWA_MENU, 'wuwa-menu');
  if (!Array.isArray(menu)) return { events: [], anomaly: 'menu not an array', fetched: 0 };
  const cutoff = Date.now() - 200 * 86_400_000;
  const candidates = menu
    .filter(isWuwaEventCandidate)
    .filter((a) => Date.parse(String(a.startTime || '').replace(' ', 'T') + '+08:00') >= cutoff)
    .sort((a, b) => String(b.startTime).localeCompare(String(a.startTime)))
    .slice(0, limit);
  const events = [];
  let failed = 0;
  for (const item of candidates) {
    try {
      const article = await fetchJson(WUWA_ARTICLE(item.articleId), `wuwa-article-${item.articleId}`);
      events.push(parseWuwaArticle(item, article));
    } catch (error) {
      failed += 1;
      console.warn(`::warning::events wuwa article ${item.articleId} failed: ${error.message}`);
    }
  }
  return { events, anomaly: !candidates.length ? 'no event-ish articles in menu' : (failed ? `${failed} article fetch failures` : null), fetched: candidates.length };
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
    priority: 1,
    image: listItem.cover || null,
    description: html,
    dateSource: 'content',
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

export async function scrapeEndfield({ pages = 2 } = {}) {
  const events = [];
  let fetched = 0;
  let failed = 0;
  for (let page = 1; page <= pages; page += 1) {
    const payload = await fetchJson(ENDFIELD_LIST(page), `endfield-list-${page}`);
    const list = payload?.data?.list || [];
    const relevant = list.filter(isEndfieldEventCandidate);
    fetched += relevant.length;
    for (const item of relevant) {
      try {
        const detail = await fetchJson(ENDFIELD_DETAIL(item.cid), `endfield-detail-${item.cid}`);
        events.push(parseEndfieldDetail(item, detail));
      } catch (error) {
        failed += 1;
        console.warn(`::warning::events endfield ${item.cid} failed: ${error.message}`);
      }
    }
    if (!list.length) break;
  }
  return { events, anomaly: !fetched ? 'no endfield notices' : (failed ? `${failed} bulletin fetch failures` : null), fetched };
}

export const SOURCE_META = {
  gi: { name: HOYO.gi.sourceName, endpoint: 'sg-hk4e-api.hoyoverse.com getAnnList+getAnnContent' },
  hsr: { name: HOYO.hsr.sourceName, endpoint: 'sg-hkrpg-api.hoyoverse.com getAnnList+getAnnContent' },
  zzz: { name: HOYO.zzz.sourceName, endpoint: 'sg-announcement-api.hoyoverse.com getAnnList+getAnnContent' },
  wuwa: { name: 'Wuthering Waves Official', endpoint: 'hw-media-cdn-mingchao.kurogame.com ArticleMenu.json + article/*.json' },
  endfield: { name: 'Arknights: Endfield Official', endpoint: 'web-news.gryphline.com /api/bulletin' },
};
