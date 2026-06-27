#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG = path.join(__dirname, 'livestream-windows.json');
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DEFAULT_PRE_WINDOW_HOURS = 6;
const DEFAULT_POST_WINDOW_HOURS = 78; // 72h code life + buffer for source lag.
const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_PRUNE_AFTER_DAYS = 2;
const DEFAULT_MERGE_GAP_HOURS = 24;
const FETCH_TIMEOUT_MS = Number(process.env.CODES_LIVESTREAM_FETCH_TIMEOUT_MS || 12_000);

const LIVESTREAM_TITLE_RE = /\b(?:special\s+(?:program|broadcast)|preview\s+special\s+broadcast|special\s+preview\s+program)\b/i;
const VERSIONED_LIVESTREAM_TITLE_RE = /\bversion\s+\d+(?:\.\d+)?[\s\S]{0,80}\b(?:livestream|live\s*stream|program|broadcast|preview)\b/i;
const NON_PROGRAM_VIDEO_RE = /\b(?:trailer|teaser|demo|music|ost|behind[-\s]?the[-\s]?scenes|geographic\s+preview|agent\s+record|story\s+cinematics)\b/i;

const SOURCES = [
  {
    game: 'genshin',
    name: 'Genshin Impact',
    channelId: 'UCiS882YPwZt1NfaM0gR0D9Q',
  },
  {
    game: 'hsr',
    name: 'Honkai: Star Rail',
    channelId: 'UC2PeMPA8PAOp-bynLoCeMLA',
  },
  {
    game: 'zzz',
    name: 'Zenless Zone Zero',
    channelId: 'UC2SpC8rL9LaeQriE4YNdyzA',
  },
  {
    game: 'wuwa',
    name: 'Wuthering Waves',
    channelId: 'UC0Bi5KMcECRVYis5Gb_ZYZQ',
  },
  {
    game: 'endfield',
    name: 'Arknights: Endfield',
    channelId: 'UCowPaVRBzg8CE6K4CB6LJfw',
  },
];

function iso(date) {
  return date.toISOString().replace('.000Z', 'Z');
}

function parseIso(value) {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? new Date(t) : null;
}

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function tagText(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  return decodeXml(xml.match(re)?.[1] || '');
}

function linkHref(xml) {
  return decodeXml(xml.match(/<link\b[^>]*\bhref="([^"]+)"/i)?.[1] || '');
}

function parseYoutubeFeed(xml) {
  return String(xml || '')
    .split(/<entry>/i)
    .slice(1)
    .map((body) => `<entry>${body}`)
    .map((entryXml) => ({
      id: tagText(entryXml, 'yt:videoId') || tagText(entryXml, 'id'),
      title: tagText(entryXml, 'title'),
      published: tagText(entryXml, 'published'),
      updated: tagText(entryXml, 'updated'),
      link: linkHref(entryXml),
      description: tagText(entryXml, 'media:description'),
    }))
    .filter((entry) => entry.title && (entry.published || entry.updated));
}

function feedUrl(source) {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(source.channelId)}`;
}

function isLivestreamEntry(entry) {
  const title = String(entry?.title || '');
  if (!LIVESTREAM_TITLE_RE.test(title) && !VERSIONED_LIVESTREAM_TITLE_RE.test(title)) return false;
  if (NON_PROGRAM_VIDEO_RE.test(title) && !/\b(?:special|livestream|live\s*stream|broadcast|program)\b/i.test(title)) {
    return false;
  }
  return true;
}

function windowFromEntry(source, entry, options = {}) {
  if (!isLivestreamEntry(entry)) return null;

  const now = options.now || new Date();
  const lookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const preHours = options.preWindowHours ?? DEFAULT_PRE_WINDOW_HOURS;
  const postHours = options.postWindowHours ?? DEFAULT_POST_WINDOW_HOURS;
  const eventAt = parseIso(entry.published || entry.updated);
  if (!eventAt) return null;

  const ageMs = now.getTime() - eventAt.getTime();
  const futureMs = eventAt.getTime() - now.getTime();
  if (ageMs > lookbackDays * DAY_MS) return null;
  if (futureMs > 14 * DAY_MS) return null;

  return {
    game: source.game,
    startsAt: iso(new Date(eventAt.getTime() - preHours * HOUR_MS)),
    endsAt: iso(new Date(eventAt.getTime() + postHours * HOUR_MS)),
    mode: 'deep',
    note: entry.title,
    source: 'youtube',
    sourceUrl: entry.link || (entry.id && /^[-_A-Za-z0-9]{8,}$/.test(entry.id) ? `https://www.youtube.com/watch?v=${entry.id}` : undefined),
  };
}

function normalizeWindow(raw) {
  const game = String(raw?.game || '').trim().toLowerCase();
  const start = parseIso(raw?.startsAt);
  const end = parseIso(raw?.endsAt);
  if (!game || !start || !end || end <= start) return null;

  const sourceUrls = [];
  if (raw.sourceUrl) sourceUrls.push(String(raw.sourceUrl));
  if (Array.isArray(raw.sourceUrls)) sourceUrls.push(...raw.sourceUrls.map(String));

  const out = {
    game,
    startsAt: iso(start),
    endsAt: iso(end),
    mode: String(raw.mode || 'deep').toLowerCase() === 'deep' ? 'deep' : String(raw.mode || 'deep'),
    note: String(raw.note || `${game} livestream window`).trim(),
    source: String(raw.source || 'manual').trim() || 'manual',
  };
  const uniqueUrls = [...new Set(sourceUrls.filter(Boolean))].sort();
  if (uniqueUrls.length === 1) out.sourceUrl = uniqueUrls[0];
  else if (uniqueUrls.length > 1) out.sourceUrls = uniqueUrls;
  return out;
}

function shouldKeepExistingWindow(window, now = new Date(), pruneAfterDays = DEFAULT_PRUNE_AFTER_DAYS) {
  const end = parseIso(window.endsAt);
  if (!end) return false;
  return end.getTime() >= now.getTime() - pruneAfterDays * DAY_MS;
}

function splitSources(value) {
  return String(value || '')
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
}

function mergedNote(a, b) {
  const notes = [a.note, b.note]
    .map((note) => String(note || '').trim())
    .filter(Boolean);
  const unique = [...new Set(notes)];
  const detectorNote = unique.find((note) => isLivestreamEntry({ title: note }));
  return detectorNote || unique[0] || 'livestream window';
}

function allSourceUrls(...windows) {
  const urls = [];
  for (const w of windows) {
    if (w.sourceUrl) urls.push(w.sourceUrl);
    if (Array.isArray(w.sourceUrls)) urls.push(...w.sourceUrls);
  }
  return [...new Set(urls.filter(Boolean).map(String))].sort();
}

function mergeTwoWindows(a, b) {
  const start = new Date(Math.min(parseIso(a.startsAt).getTime(), parseIso(b.startsAt).getTime()));
  const end = new Date(Math.max(parseIso(a.endsAt).getTime(), parseIso(b.endsAt).getTime()));
  const sources = [...new Set([...splitSources(a.source), ...splitSources(b.source)])].sort();
  const urls = allSourceUrls(a, b);

  const out = {
    game: a.game,
    startsAt: iso(start),
    endsAt: iso(end),
    mode: a.mode === 'deep' || b.mode === 'deep' ? 'deep' : (a.mode || b.mode || 'deep'),
    note: mergedNote(a, b),
    source: sources.join('+') || 'manual',
  };
  if (urls.length === 1) out.sourceUrl = urls[0];
  else if (urls.length > 1) out.sourceUrls = urls;
  return out;
}

function windowsOverlapOrTouch(a, b, mergeGapHours = DEFAULT_MERGE_GAP_HOURS) {
  if (a.game !== b.game) return false;
  const aStart = parseIso(a.startsAt).getTime();
  const aEnd = parseIso(a.endsAt).getTime();
  const bStart = parseIso(b.startsAt).getTime();
  const bEnd = parseIso(b.endsAt).getTime();
  const gap = mergeGapHours * HOUR_MS;
  return aStart <= bEnd + gap && bStart <= aEnd + gap;
}

function mergeWindows(windows, options = {}) {
  const mergeGapHours = options.mergeGapHours ?? DEFAULT_MERGE_GAP_HOURS;
  const normalized = windows
    .map(normalizeWindow)
    .filter(Boolean)
    .sort((a, b) => a.game.localeCompare(b.game) || a.startsAt.localeCompare(b.startsAt));

  const merged = [];
  for (const w of normalized) {
    const last = merged[merged.length - 1];
    if (last && windowsOverlapOrTouch(last, w, mergeGapHours)) {
      merged[merged.length - 1] = mergeTwoWindows(last, w);
    } else {
      merged.push(w);
    }
  }

  return merged.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.game.localeCompare(b.game));
}

function loadConfig(file = CONFIG) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { windows: Array.isArray(parsed.windows) ? parsed.windows : [] };
  } catch {
    return { windows: [] };
  }
}

function stablePayload(windows) {
  return `${JSON.stringify({ windows }, null, 2)}\n`;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'pengo-code-watch/1.0 (+https://pengo.gg)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function detectFromSources(sources = SOURCES, options = {}) {
  const windows = [];
  const errors = [];
  const now = options.now || new Date();

  for (const source of sources) {
    const url = source.feedUrl || feedUrl(source);
    try {
      const xml = options.feedByGame?.[source.game] ?? await fetchText(url);
      const entries = parseYoutubeFeed(xml);
      const detected = entries
        .map((entry) => windowFromEntry(source, entry, { ...options, now }))
        .filter(Boolean);
      windows.push(...detected);
      console.log(`[livestream-${source.game}] ${detected.length} window candidate(s) from ${entries.length} YouTube feed entries`);
    } catch (err) {
      errors.push({ game: source.game, url, error: err.message });
      console.warn(`[livestream-${source.game}] ${url} failed: ${err.message}`);
    }
  }

  return { windows, errors };
}

function activeWindowGames(windows, now = new Date()) {
  const t = now.getTime();
  return [...new Set(windows
    .filter((w) => {
      const start = parseIso(w.startsAt);
      const end = parseIso(w.endsAt);
      return start && end && start.getTime() <= t && t <= end.getTime();
    })
    .map((w) => w.game)
    .filter(Boolean))].sort();
}

function writeGithubOutput(values) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value).replace(/\r?\n/g, ' ')}`);
  fs.appendFileSync(out, `${lines.join('\n')}\n`);
}

async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const now = process.env.CODES_WATCH_NOW ? new Date(process.env.CODES_WATCH_NOW) : new Date();
  const existing = loadConfig();
  const keptExisting = existing.windows.filter((w) => shouldKeepExistingWindow(w, now));
  const detected = await detectFromSources(SOURCES, { now });
  const windows = mergeWindows([...keptExisting, ...detected.windows].filter((w) => shouldKeepExistingWindow(w, now)));
  const next = stablePayload(windows);
  const prev = stablePayload(mergeWindows(existing.windows));
  const changed = next !== prev;

  if (dryRun) {
    process.stdout.write(next);
  } else if (changed) {
    fs.writeFileSync(CONFIG, next, 'utf8');
    console.log(`Updated ${path.relative(process.cwd(), CONFIG)} with ${windows.length} livestream window(s).`);
  } else {
    console.log('No livestream window changes.');
  }

  const activeGames = activeWindowGames(windows, now);
  writeGithubOutput({
    changed: changed ? 'true' : 'false',
    active_games: activeGames.join(','),
    detected_games: [...new Set(detected.windows.map((w) => w.game))].sort().join(','),
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  SOURCES,
  activeWindowGames,
  decodeXml,
  detectFromSources,
  isLivestreamEntry,
  mergeWindows,
  normalizeWindow,
  parseYoutubeFeed,
  shouldKeepExistingWindow,
  windowFromEntry,
};
