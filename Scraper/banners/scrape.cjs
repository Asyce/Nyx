#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const OUTPUT = path.join(__dirname, '..', '..', 'Database', 'Banners', 'banners.json');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GAMES = [
  {
    id: 'hsr',
    name: 'Honkai: Star Rail',
    game8Url: 'https://game8.co/games/Honkai-Star-Rail/archives/408381',
    fallbackUrl: 'https://prydwen.gg/star-rail/',
    preferFallback: true,  // Prydwen has cleaner HSR data; game8 mixes characters with light cones
    defaultHourUtc: 16,
    tzOffsetHours: -5,
  },
  {
    id: 'genshin',
    name: 'Genshin Impact',
    game8Url: 'https://game8.co/games/Genshin-Impact/archives/305012',
    defaultHourUtc: 10,  // 18:00 UTC+8
    tzOffsetHours: 8,
  },
  {
    id: 'wuwa',
    name: 'Wuthering Waves',
    game8Url: 'https://game8.co/games/Wuthering-Waves/archives/453303',
    defaultHourUtc: 10,  // 18:00 UTC+8
    tzOffsetHours: 8,
  },
  {
    id: 'zzz',
    name: 'Zenless Zone Zero',
    game8Url: 'https://game8.co/games/Zenless-Zone-Zero/archives/435687',
    defaultHourUtc: 10,  // 18:00 UTC+8
    tzOffsetHours: 8,
  },
  {
    id: 'endfield',
    name: 'Arknights: Endfield',
    game8Url: 'https://game8.co/games/Arknights-Endfield/archives/524215',
    defaultHourUtc: 2,   // 10:00 UTC+8 (typical Endfield maintenance window)
    tzOffsetHours: 8,
  },
];

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
  'Accept-Language': 'en-US,en;q=0.9',
};
const FETCH_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchHtml(url) {
  const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function normalizeText(text = '') {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

const MONTH_SHORT = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

// Parse a single date expression like "April 21, 2026" or "Apr. 17, 2026".
// Returns { year, month0, day } or null.
function parseDateTokens(str) {
  if (!str) return null;
  // Strip parenthetical timezone annotations and periods from abbreviated months
  const clean = str
    .replace(/\([^)]*\)/g, '')
    .replace(/\./g, '')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')  // insert space between digit and letter (e.g. "2026Featured" → "2026 Featured")
    .replace(/\s+/g, ' ')
    .trim();
  const m = clean.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})\b/i
  );
  if (!m) return null;
  const month0 = MONTH_SHORT.indexOf(m[1].slice(0, 3).toLowerCase());
  if (month0 < 0) return null;
  return { year: parseInt(m[3]), month0, day: parseInt(m[2]) };
}

// Build an ISO string from date tokens + explicit UTC hour (avoids TZ guessing).
function tokensToIso(tokens, hourUtc) {
  if (!tokens) return null;
  return new Date(Date.UTC(tokens.year, tokens.month0, tokens.day, hourUtc, 0, 0)).toISOString();
}

// Given a string that may contain one or two dates (range), return
// { start, end } as ISO strings (either may be null).
function extractDateRange(str, hourUtc) {
  if (!str) return { start: null, end: null };

  // Try to find two distinct date expressions split by either a dash/en-dash
  // (with whitespace so we don't break "5-Star" or "Lv.999") or by a prose
  // range word — "from X until Y", "X to Y", "X through Y", "X till Y".
  // Endfield's body text uses "from May 14, 2026 ... until June 5, 2026"
  // exclusively; without the prose split it parsed as a single date.
  const RANGE_RE = /\s+[–-]\s+|\s+(?:until|through|thru|till|to)\s+/i;
  const parts = str.split(RANGE_RE);
  if (parts.length >= 2) {
    // The year might only appear on the last part ("April 15 - May 5, 2026")
    const lastTokens = parseDateTokens(parts[parts.length - 1]);
    if (lastTokens) {
      // Try to parse first part; if it lacks a year, reuse last year
      let firstStr = parts[0];
      if (!/\d{4}/.test(firstStr)) firstStr += `, ${lastTokens.year}`;
      const firstTokens = parseDateTokens(firstStr);
      return {
        start: tokensToIso(firstTokens, hourUtc),
        end:   tokensToIso(lastTokens,  hourUtc),
      };
    }
  }

  const tokens = parseDateTokens(str);
  return { start: null, end: tokensToIso(tokens, hourUtc) };
}

const JUNK_PATTERN = /banner|phase|version|event|wish|warp|convene|recruit|rerun|limited|★|element|weapon|rarity|rate|guaranteed|pull|roll|reward|item|material|promo|invocation|\brank\b|\bengine\b|\bduration\b|\bfeatured\b|\binformation\b|\bresonator\b|\bstandard\b|\bcharacters\b|\bcone\b|\bcones\b|\bindelible\b/i;
const DATE_LIKE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

// Known game-name prefixes used in game8 img[alt] attributes.
// Handles both "ZZZ - Cissia" (hyphen-separated) and "Endfield Rossi" (space-only).
const GAME_PREFIX_RE = /^(?:honkai[:\s]*star\s*rail|genshin\s*impact|wuthering\s+waves|zenless\s+zone\s+zero|arknights[:\s]*endfield|honkai|genshin|endfield|zzz|hsr|star\s*rail)\s+(?:-\s*)?/i;

function isLikelyCharName(text) {
  // Strip rank/rarity annotations before checking (e.g. "Cissia (S-Rank)" → "Cissia")
  let t = normalizeText(text).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 2 || t.length > 30) return false;
  // Allow "Lv.NNN" suffix as part of a character name (HSR's "Silver Wolf Lv.999"
  // is a distinct character from "Silver Wolf"); reject all other digit fragments.
  const digitCheck = t.replace(/\s+lv\.?\s*\d+\s*$/i, '');
  if (/\d/.test(digitCheck)) return false;
  if (/:/.test(t)) return false;            // label cells (e.g. "Featured 5-Star:")
  if (DATE_LIKE.test(t)) return false;      // contains a month name
  if (JUNK_PATTERN.test(t)) return false;
  // Character names in these games are always 1-2 words; 3+ words = light cone / skill / weapon
  // (the Lv.X suffix is stripped before counting so "Silver Wolf Lv.999" still passes).
  if (digitCheck.split(/\s+/).length > 2) return false;
  // Filter light-cone / skill names that contain common English function/auxiliary words.
  // "the" is allowed (HSR has "The Dahlia", "The Herta", etc.) — the 2-word cap above
  // still rejects multi-word light cones like "The Seriousness of Breakfast".
  if (/\b(a|an|and|of|by|for|to|in|at|on|from|with|through|towards|her|his|my|our|make|should|might|could|would|shall)\b/i.test(t)) return false;
  if (/^[A-Z\u00C0-\u024F]/.test(t)) return true;  // starts with uppercase (incl. accented)
  return false;
}

// ---------------------------------------------------------------------------
// Nanoka character-icon enrichment
// ---------------------------------------------------------------------------
//
// Per-game pipeline:
//   1. fetch https://static.nanoka.cc/manifest.json → resolve `latest` version
//   2. fetch https://static.nanoka.cc/{game}/{version}/character.json
//   3. for each scraped character name, find best match by `en` field
//   4. compute icon URL via game-specific builder (primary, with fallback)
//
// URL builders were reverse-engineered from the SvelteKit chunks of each
// nanoka.cc subdomain (see prior session notes).

const NANOKA_MANIFEST = 'https://static.nanoka.cc/manifest.json';

const NANOKA_GAMES = {
  hsr: {
    manifestKey: 'hsr',
    charJsonPath: (v) => `https://static.nanoka.cc/hsr/${v}/character.json`,
    // For HSR the per-record KEY is the numeric ID used in the URL,
    // not the `icon` slug field.
    primaryUrl:  (id, _rec) => `https://static.nanoka.cc/assets/hsr/avataricon/avatar/${id}.webp`,
    fallbackUrl: (id, _rec) => `https://static.nanoka.cc/assets/hsr/avatarroundicon/${id}.webp`,
  },
  genshin: {
    manifestKey: 'gi',
    charJsonPath: (v) => `https://static.nanoka.cc/gi/${v}/character.json`,
    // GI: prefer the transparent Circle render; fall back to the boxed Icon.
    primaryUrl:  (_id, rec) => `https://static.nanoka.cc/assets/gi/${rec.icon}_Circle.webp`,
    fallbackUrl: (_id, rec) => `https://static.nanoka.cc/assets/gi/${rec.icon}.webp`,
    zoomFallback: true,  // boxed Icon is waist-up; crop in to roughly match Circle
  },
  zzz: {
    manifestKey: 'zzz',
    charJsonPath: (v) => `https://static.nanoka.cc/zzz/${v}/character.json`,
    // ZZZ: prefer the transparent Circle render; fall back to the boxed Select.
    primaryUrl:  (_id, rec) => {
      const suf = (rec.icon ?? '').replace(/^IconRole/, '');
      return `https://static.nanoka.cc/assets/zzz/IconRoleCircle${suf}.webp`;
    },
    fallbackUrl: (_id, rec) => {
      const suf = (rec.icon ?? '').replace(/^IconRole/, '');
      return `https://static.nanoka.cc/assets/zzz/IconRoleSelect${suf}.webp`;
    },
    zoomFallback: true,
  },
  wuwa: {
    manifestKey: 'ww',
    charJsonPath: (v) => `https://static.nanoka.cc/ww/${v}/character.json`,
    // Wuwa icon path: "/Game/Aki/UI/UIResources/.../T_IconRoleHead256_7_UI.T_IconRoleHead256_7_UI"
    // → strip "/Game/Aki/UI/" prefix and the duplicated tail-suffix after "."
    primaryUrl: (_id, rec) => {
      if (!rec.icon) return null;
      const path = rec.icon.replace(/^\/Game\/Aki\/UI\//, '').split('.')[0];
      return `https://static.nanoka.cc/assets/ww/${path}.webp`;
    },
    fallbackUrl: () => null,
  },
};

// Strip XML-like tags from a string (nanoka uses tags like
// `<unbreak>999</unbreak>` and `{RUBY_B#…}…{RUBY_E#}` inside the `en` field).
function stripTags(s) {
  if (!s) return '';
  return s
    .replace(/<\/?[a-z][^>]*>/gi, '')         // <unbreak>, </unbreak>, <i>, etc.
    .replace(/\{[A-Z_]+#[^}]*\}/g, '')        // {RUBY_B#...}
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalize a name for fuzzy lookup: lowercase, strip non-alphanumerics.
function normName(name) {
  return stripTags(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

// Manual aliases for character names that differ between game8/prydwen and nanoka.
// Map normName(scraped) → normName(nanoka).
const NAME_ALIASES = {
  // Trailblazer / MC variants land on whatever Trailblazer entries exist.
  // We don't currently target a specific Trailblazer path — leave to direct match.
  marth7th: 'march7th',
  mar7: 'march7th',
};

let NANOKA_MANIFEST_CACHE = null;
async function fetchNanokaManifest() {
  if (NANOKA_MANIFEST_CACHE) return NANOKA_MANIFEST_CACHE;
  const res = await fetch(NANOKA_MANIFEST, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`nanoka manifest HTTP ${res.status}`);
  NANOKA_MANIFEST_CACHE = await res.json();
  return NANOKA_MANIFEST_CACHE;
}

const CHAR_MAP_CACHE = {};

// Build a Map<normName, {name, image, imageFallback?}> for a nanoka game.
// `image` = preferred render (e.g. transparent Circle for GI/ZZZ).
// `imageFallback` = lower-priority render the frontend can swap to on 404
// (some characters lack the Circle variant).
//
// We also tag each entry with `isRecent` — true for the top N highest
// numeric IDs in the roster. Newer characters get higher IDs, so this
// is a cheap proxy for "just added" that doesn't depend on release-date
// metadata (which is mostly null in nanoka). Used by the banner-filter
// to keep new 4-star debuts visible even when the min-rank is set to 5.
const RECENT_COHORT_SIZE = 12;
async function loadNanokaMap(gameId) {
  const cfg = NANOKA_GAMES[gameId];
  const manifest = await fetchNanokaManifest();
  const version = manifest?.[cfg.manifestKey]?.latest;
  if (!version) throw new Error(`no version in manifest for key "${cfg.manifestKey}"`);
  const url = cfg.charJsonPath(version);
  const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();

  // Pre-compute the recent cohort: the N highest numeric IDs in the
  // roster, minus MC / {NICKNAME} placeholder entries (HSR has 8001+
  // dummy IDs for every trailblazer variant which would crowd out
  // real new chars otherwise).
  const idAsNumber = (id) => {
    const m = String(id).match(/(\d+)/);
    return m ? Number(m[1]) : 0;
  };
  const realIds = Object.entries(json)
    .filter(([, r]) => r && typeof r === 'object' && r.en && r.en !== '{NICKNAME}' && r.rank)
    .map(([id]) => id);
  const recentIds = new Set(
    [...realIds].sort((a, b) => idAsNumber(b) - idAsNumber(a)).slice(0, RECENT_COHORT_SIZE)
  );

  const map = new Map();
  const addEntry = (key, entry) => {
    if (!key || map.has(key)) return;
    map.set(key, entry);
  };
  for (const [id, rec] of Object.entries(json)) {
    if (!rec || typeof rec !== 'object') continue;
    const enRaw = rec.en || rec.name || rec.code;
    if (!enRaw) continue;
    const en = stripTags(enRaw);
    const image = cfg.primaryUrl(id, rec) || null;
    const fallback = cfg.fallbackUrl ? (cfg.fallbackUrl(id, rec) || null) : null;
    const useFallback = fallback && fallback !== image;
    const entry = {
      name: en,
      image,
      imageFallback: useFallback ? fallback : null,
      imageFallbackZoom: useFallback && cfg.zoomFallback ? true : false,
      // Carry the upstream rank so the banner pipeline can filter out
      // 4-stars / lower-rarity entries that game8 mixes into rate-up lists.
      // Falls back to `null` for games where the field isn't populated.
      rank: typeof rec.rank === 'number' ? rec.rank
          : typeof rec.rank === 'string' ? parseInt(rec.rank, 10) || null
          : null,
      // "Recent" = in the top RECENT_COHORT_SIZE by ID. Used to whitelist
      // new 4-star debuts past the min-rank filter.
      isRecent: recentIds.has(id),
    };
    addEntry(normName(en), entry);
    // ZZZ has separate `code` (e.g. "Anby") vs `en`; index both
    if (rec.code && rec.code !== en) {
      addEntry(normName(rec.code), entry);
    }
  }
  console.log(`[${gameId}] nanoka: loaded ${map.size} entries from version ${version}`);
  return { map, version };
}

// Endfield: perlica.moe is the primary source, arknightsendfield.gg is the fallback.
async function loadEndfieldMap() {
  const map = new Map();
  let perlicaCount = 0, fallbackCount = 0;

  // ── Primary: perlica.moe — operators are embedded as JSON in the page HTML ──
  try {
    const html = await fetchHtml('https://perlica.moe/operators');
    // Match operator JSON blobs: ..."name":"X","slug":"y","type":"operator",...,"thumbnail":"/images/.../y.webp",..."rarity":6,...
    const re = /"name":"([^"]+)","slug":"([^"]+)","type":"operator"[^}]*?"thumbnail":"([^"]+)"[^}]*?"rarity":(\d+)/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const [, name, , thumb, rarityStr] = m;
      const image = thumb.startsWith('http') ? thumb : `https://cdn.perlica.moe${thumb}`;
      const rarity = parseInt(rarityStr, 10);
      const key = normName(name);
      if (!map.has(key)) {
        map.set(key, { name, image, rarity });
        perlicaCount++;
      }
    }
    console.log(`[endfield] perlica: loaded ${perlicaCount} operators`);
  } catch (err) {
    console.warn(`[endfield] perlica fetch failed: ${err.message}`);
  }

  // ── Fallback: arknightsendfield.gg — character build links carry portraits ──
  try {
    const html = await fetchHtml('https://arknightsendfield.gg/');
    const $ = cheerio.load(html);
    $('a[href*="/character/"]').each((_, a) => {
      const href = $(a).attr('href') || '';
      const slugM = href.match(/\/character\/([a-z0-9-]+?)(?:-build)?\/?$/i);
      if (!slugM) return;
      const slug = slugM[1];
      const name = slug.split('-').map(p => p[0].toUpperCase() + p.slice(1)).join(' ');
      const img = $(a).find('img').first();
      const src = img.attr('data-src') || img.attr('src') || '';
      if (!src.includes('arknightsendfield.gg')) return;
      const key = normName(name);
      if (!map.has(key)) {
        map.set(key, { name, image: src });
        fallbackCount++;
      }
    });
    console.log(`[endfield] arknightsendfield.gg: filled ${fallbackCount} additional operators`);
  } catch (err) {
    console.warn(`[endfield] arknightsendfield.gg fetch failed: ${err.message}`);
  }

  return { map, version: `perlica+aef` };
}

async function fetchCharacterMap(gameId) {
  if (CHAR_MAP_CACHE[gameId] !== undefined) return CHAR_MAP_CACHE[gameId];
  try {
    if (gameId === 'endfield') {
      CHAR_MAP_CACHE[gameId] = await loadEndfieldMap();
    } else if (NANOKA_GAMES[gameId]) {
      CHAR_MAP_CACHE[gameId] = await loadNanokaMap(gameId);
    } else {
      CHAR_MAP_CACHE[gameId] = null;
    }
  } catch (err) {
    console.warn(`[${gameId}] character-map load failed: ${err.message}`);
    CHAR_MAP_CACHE[gameId] = null;
  }
  return CHAR_MAP_CACHE[gameId];
}

function findCharacterEntry(charMap, scrapedName) {
  if (!charMap || !scrapedName) return null;
  const k = normName(scrapedName);
  if (charMap.has(k)) return charMap.get(k);
  const alias = NAME_ALIASES[k];
  if (alias && charMap.has(alias)) return charMap.get(alias);
  // Try last-name / first-name only (e.g. "Kamisato Ayaka" → "Ayaka").
  // Skip this fallback for names ending in Lv.X (it would erroneously match the
  // base name without the level suffix — they're distinct characters).
  if (/\blv\.?\s*\d+\s*$/i.test(scrapedName)) return null;
  const parts = scrapedName.split(/\s+/);
  if (parts.length > 1) {
    const last = normName(parts[parts.length - 1]);
    if (charMap.has(last)) return charMap.get(last);
    const first = normName(parts[0]);
    if (charMap.has(first)) return charMap.get(first);
  }
  return null;
}

// Minimum upstream rank to accept on a banner. Game8/Prydwen sometimes
// list 4-stars next to the headline rate-ups (especially noisy for WuWa
// where the table includes weapon names too); anything below this gets
// dropped instead of leaking onto the page as an iconless tile.
const MIN_BANNER_RANK = { hsr: 5, genshin: 5, zzz: null /* S = 4 in nanoka */, wuwa: 5, endfield: null };

// Resolve a single character name → record, or `null` if the name has no
// match in the nanoka roster (= weapon / light cone / typo) or is below
// the min rank for this game.
async function resolveCharacterIcon(gameId, name) {
  const data = await fetchCharacterMap(gameId);
  if (!data) return { name, image: null };
  const found = findCharacterEntry(data.map, name);
  if (!found) {
    console.warn(`[${gameId}] dropping "${name}" — no nanoka match (weapon or typo)`);
    return null;
  }
  const minRank = MIN_BANNER_RANK[gameId];
  if (minRank != null && found.rank != null && found.rank < minRank) {
    // Whitelist: new characters get through even below the min rank.
    // Covers WuWa's occasional 4-star event debut and similar edge cases
    // — without this, a brand-new 4★ headlining a special banner would
    // get silently dropped. `isRecent` is computed in loadNanokaMap as
    // "in the top N highest IDs", which is a roster-position proxy for
    // "just added to nanoka".
    if (!found.isRecent) {
      console.warn(`[${gameId}] dropping "${name}" — rank ${found.rank} below min ${minRank}`);
      return null;
    }
    console.log(`[${gameId}] keeping "${name}" — rank ${found.rank} but recent debut`);
  }
  const out = { name, image: found.image };
  if (found.imageFallback) out.imageFallback = found.imageFallback;
  if (found.imageFallbackZoom) out.imageFallbackZoom = true;
  return out;
}

async function enrichCharactersWithIcons(gameId, names) {
  if (!names || !names.length) return [];
  const resolved = await Promise.all(names.map(n => resolveCharacterIcon(gameId, n)));
  return resolved.filter((r) => r !== null);
}

// ---------------------------------------------------------------------------
// game8 parser
// ---------------------------------------------------------------------------

// Extract a "phase" label like "1.1 Phase 2" or "6.5 Phase 1" from headings /
// table cells within a section. Tries several common game8 formats.
function extractPhase($, els) {
  const texts = [];
  for (const el of els) {
    if (el.is('h2,h3,h4,h5')) texts.push(normalizeText(el.text()));
    // Scan table cells for "Ver. X.Y(Current)" / "Version X.Y" markers
    const tableRoot = el.is('table') ? el : el.find('table');
    tableRoot.find('td,th').each((_, c) => texts.push(normalizeText($(c).text())));
  }
  for (const t of texts) {
    // "Phase N of Version X.Y" (Endfield)
    let m = t.match(/phase\s+(\d+)\s+of\s+version\s+(\d+\.\d+)/i);
    if (m) return `${m[2]} Phase ${m[1]}`;
    // "Version X.Y Phase N" or "Ver. X.Y Phase N"
    m = t.match(/\bver(?:sion|\.)?\s*(\d+\.\d+)\s+phase\s+(\d+)/i);
    if (m) return `${m[1]} Phase ${m[2]}`;
    // "X.Y Phase N" bare
    m = t.match(/\b(\d+\.\d+)\s+phase\s+(\d+)/i);
    if (m) return `${m[1]} Phase ${m[2]}`;
    // "Version X.Y" / "Ver. X.Y"
    m = t.match(/\bver(?:sion|\.)?\s*(\d+\.\d+)\b/i);
    if (m) return m[1];
  }
  return null;
}

// Returns the content elements between a heading matching `pattern` and the
// next heading of the same or higher rank.
function getSectionElements($, pattern) {
  const heading = $('h2, h3, h4')
    .filter((_, el) => pattern.test(normalizeText($(el).text())))
    .first();
  if (!heading.length) return [];

  const rank = parseInt(heading[0].tagName[1]);
  const stopSelector = Array.from({ length: rank }, (_, i) => `h${i + 1}`).join(', ');

  const els = [];
  let el = heading.next();
  while (el.length && !el.is(stopSelector)) {
    els.push(el);
    el = el.next();
  }
  return els;
}

// Split a cell that may contain multiple names separated by rank annotations,
// bullets, or commas (e.g. "Cissia (S-Rank) Pulchra (A-Rank) Ben (A-Rank)").
function splitCandidates(cell) {
  return cell
    .replace(/\([^)]*\)/g, '|')   // replace (annotation) with separator
    .replace(/[·\/,]/g, '|')      // replace common list separators
    .split('|')
    .map(s => s.trim())
    .filter(Boolean);
}

// Extract img[alt] values that were game-prefixed (e.g. "ZZZ - Cissia" → "Cissia").
// Only returns values where the prefix was actually stripped — this ensures we're
// looking at character images, not generic icon images.
//
// Note: we deliberately keep "Lv.X" suffixes intact because some characters use them
// as part of their name (e.g. HSR's "Silver Wolf Lv.999" is a distinct character
// from "Silver Wolf"). The nanoka match logic normalizes both sides anyway.
function prefixedAlts($, td) {
  return $(td).find('img[alt]')
    .map((_, img) => {
      const alt = normalizeText($(img).attr('alt') || '');
      const stripped = alt
        .replace(GAME_PREFIX_RE, '')
        .replace(/\s+icon\s*$/i, '')
        .trim();
      return (stripped && stripped !== alt) ? stripped : null;
    })
    .get()
    .filter(Boolean);
}

// Filter img-alt names by cross-referencing the cell's text for rarity markers.
// Keeps only 5★/6★/S-Rank names; drops 4★/A-Rank/B-Rank.
// Two strategies:
//   (a) "Featured 5-Star: … Featured 4-Star: …" sections → filter by position in text
//   (b) per-name "(S-Rank)" / "(4-Star)" annotations → filter by paren content
const FIVE_STAR_PARENS_RE = /5[★*]|5[-\s]?Star|S[-\s]?Rank|6[★*]|6[-\s]?Star/i;
const ANY_RARITY_PARENS_RE = /\b[456][★*]|\b\d[-\s]?Star|\b[SABC][-\s]?Rank/i;
const FEATURED_5_RE = /\bfeatured\s+5[-\s]?star|\b5[-\s]?star\s*:/i;
const FEATURED_4_RE = /\bfeatured\s+4[-\s]?star|\b4[-\s]?star\s*:/i;
function fiveStarFromCell($, td) {
  const alts = prefixedAlts($, td);
  if (!alts.length) return alts;
  const cellText = normalizeText($(td).text());

  // Strategy A: cell has "Featured 5-Star: … Featured 4-Star: …" sections.
  const fiveIdx = cellText.search(FEATURED_5_RE);
  const fourIdx = cellText.search(FEATURED_4_RE);
  if (fiveIdx >= 0 && fourIdx > fiveIdx) {
    return alts.filter(name => {
      const idx = cellText.indexOf(name);
      return idx >= fiveIdx && idx < fourIdx;
    });
  }

  // Strategy B: per-name paren annotation filter.
  if (!ANY_RARITY_PARENS_RE.test(cellText)) return alts;
  return alts.filter(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped + '\\s*\\(([^)]+)\\)', 'i');
    const m = cellText.match(re);
    if (!m) return true;  // no paren directly after this name → keep
    // Only apply rarity check if the paren content looks like a rarity annotation
    // (e.g. "(S-Rank)", "(4-Star)", "(5★)") — not a path/element like "(Nihility, Fire)"
    if (!/[★*]|\bstar\b|\brank\b/i.test(m[1])) return true;
    return FIVE_STAR_PARENS_RE.test(m[1]);
  });
}

// From a list of cheerio element wrappers, collect character-like names and date-like strings.
// Strategy: prefer structured extraction (labeled rows, column headers, schedule markers)
// over generic text scanning to avoid picking up light cone / weapon / skill names.
function extractFromElements($, els) {
  const chars = [];
  const dateStrings = [];

  // Row-level: first cell matches → value cells contain character names
  const ROW_CHAR_LABEL = /rate.?up.*(character|agent|operator|resonator)|featured.*(character|agent|operator|recruit)|(star|rank).*rate.*up|\brate.?up\s+agents?\b/i;
  // Column-level: column header cell matches → that column across data rows has character names
  const COL_CHAR_LABEL = /featured\s*characters?|characters?\s+featured/i;

  // ── Case 0: Character name embedded in section sub-heading text ─────────────
  // Endfield: "Rossi in Phase 2 of Version 1.1" / "Zhuang Fangyi for Phase 1 of Version 1.2"
  // ZZZ:      "Promeia and Starlight Billy to Release in Version 2.8"
  // The character name is everything before the schedule clause.
  const SUBHEADING_CHAR_RE = /^(.+?)\s+(?:(?:in|for)\s+(?:phase|both\s+phase|version)|to\s+(?:release|debut|arrive|launch))\s+/i;
  for (const el of els) {
    if (el.is('h2,h3,h4,h5')) {
      const m = normalizeText(el.text()).match(SUBHEADING_CHAR_RE);
      if (m) {
        // Split on "and" / "&" / "," to handle multi-character subheadings
        m[1].split(/\s*(?:,|&|\band\b)\s*/i).forEach(name => {
          const t = name.trim();
          if (isLikelyCharName(t)) chars.push(t);
        });
      }
    }
  }

  for (const el of els) {
    // Process each table individually so we can detect column-level headers
    (el.is('table') ? el : el.find('table')).each((_, table) => {
      const rows = $(table).find('tr').toArray();
      if (!rows.length) return;

      // Detect if the header row has a "Featured Characters" column
      const headerTds = $(rows[0]).find('th, td').toArray();
      let charColIdx = -1;
      headerTds.forEach((cell, idx) => {
        if (COL_CHAR_LABEL.test(normalizeText($(cell).text()))) charColIdx = idx;
      });

      rows.forEach((tr, rowIdx) => {
        const tds = $(tr).find('td, th').toArray();
        if (!tds.length) return;

        const firstText = normalizeText($(tds[0]).text());

        // Always extract dates from all cells (text content)
        tds.forEach(td => {
          const t = normalizeText($(td).text());
          if (DATE_LIKE.test(t) && /\d{4}/.test(t)) dateStrings.push(t);
        });

        // ── Case 1: Schedule table "(Current)" marker ─────────────────────────
        // HSR: "Ver. 4.1(Current)" row in the warp schedule table
        if (/\(current\)/i.test(firstText)) {
          tds.forEach(td => {
            fiveStarFromCell($, td).forEach(n => { if (isLikelyCharName(n)) chars.push(n); });
          });
          return;
        }

        // ── Case 2: Row-level character label ─────────────────────────────────
        // ZZZ: "Rate-Up Agents", Genshin: "5-star Rate Up", etc.
        if (tds.length >= 2 && ROW_CHAR_LABEL.test(firstText)) {
          // If the row label itself says "5-Star" / "S-Rank", accept all alts without rarity check.
          const labelIsFiveStar = FIVE_STAR_PARENS_RE.test(firstText);
          const labelIsLowRarity = /\b4[★*]|\b4[-\s]?Star|\b[ABC][-\s]?Rank/i.test(firstText);
          if (labelIsLowRarity) return;  // 4-star row, skip entirely
          tds.slice(1).forEach(td => {
            const alts = labelIsFiveStar ? prefixedAlts($, td) : fiveStarFromCell($, td);
            if (alts.length) {
              alts.forEach(n => { if (isLikelyCharName(n)) chars.push(n); });
            } else {
              splitCandidates(normalizeText($(td).text()))
                .forEach(n => { if (isLikelyCharName(n)) chars.push(n); });
            }
          });
          return;
        }

        // ── Case 3: Table has "Featured Characters" column header ──────────────
        // Wuwa: "Banner | Featured Characters" table — extract from that column in data rows.
        // Skip weapon banner rows: game8 puts the weapon name in parentheses in Cell 0
        // e.g. "Absolute Pulsation (Spectrum Blaster)" → weapon row, skip it.
        if (charColIdx >= 0 && rowIdx > 0 && tds[charColIdx]) {
          if (/\([^)]+\)/.test(normalizeText($(tds[0]).text()))) return; // weapon banner row
          const charTd = tds[charColIdx];
          const alts = fiveStarFromCell($, charTd);
          if (alts.length) {
            alts.forEach(n => { if (isLikelyCharName(n)) chars.push(n); });
          } else {
            splitCandidates(normalizeText($(charTd).text()))
              .forEach(n => { if (isLikelyCharName(n)) chars.push(n); });
          }
          return;
        }

        // ── Case 4: Date-cell + character img alts ─────────────────────────────
        // Endfield / HSR next: a cell has date text AND game-prefixed character img alts
        tds.forEach(td => {
          const t = normalizeText($(td).text());
          if (DATE_LIKE.test(t)) {
            fiveStarFromCell($, td).forEach(n => { if (isLikelyCharName(n)) chars.push(n); });
          }
        });
      });
    });

    // Date fallback: iterate p and li children individually to avoid conflating multiple date
    // ranges into one string (e.g. a <ul> listing all banner dates would otherwise be parsed
    // as one long range whose last entry becomes the "end" date).
    const fallbackNodes = el.is('p,li') ? el.toArray() : el.find('p, li').toArray();
    if (fallbackNodes.length) {
      for (const fe of fallbackNodes) {
        const t = normalizeText($(fe).text());
        if (DATE_LIKE.test(t) && /\d{4}/.test(t)) dateStrings.push(t);
      }
    } else if (!el.is('table')) {
      // No p/li children: fall back to full element text (e.g. bare div with text)
      const full = normalizeText(el.text());
      if (DATE_LIKE.test(full) && /\d{4}/.test(full)) dateStrings.push(full);
    }

    // ── Case 5: Prose pattern "Featured in the banner are X, Y, Z, and W" ──
    // Endfield's page intersperses multi-character banners across sub-h3
    // sections whose own heading is a banner *name* (Fest of Brilliance),
    // not a character. The roster shows up in the body paragraph as
    // "Featured in the banner are Pogranichnik, Gilberta, Laevatain, and
    // Ardelia." — scan paragraphs for that wording. Downstream nanoka
    // enrichment drops any candidate that isn't a known character, so
    // false positives from a loose regex get filtered automatically.
    const PROSE_RE = /(?:featured\s+(?:in\s+the\s+banner\s+)?(?:are|is)|rate[- ]?up\s+(?:6★|5★|6\*|5\*|6\s*Star|5\s*Star|operators?|characters?)\s*:)\s+([^.\n]+?)(?=\s*\.|$)/gi;
    const proseNodes = el.is('p,li') ? el.toArray() : el.find('p, li').toArray();
    for (const fe of proseNodes) {
      const t = normalizeText($(fe).text());
      let m;
      PROSE_RE.lastIndex = 0;
      while ((m = PROSE_RE.exec(t)) !== null) {
        const list = m[1].replace(/\band\b/gi, ',');
        for (const raw of list.split(/\s*,\s*/)) {
          const name = raw.trim().replace(/\s+/g, ' ');
          if (isLikelyCharName(name)) chars.push(name);
        }
      }
    }
  }

  return {
    characters: [...new Set(chars)].slice(0, 8),
    dateStrings: [...new Set(dateStrings)],
  };
}

function parseGame8Page(html, game) {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, .ad, [class*="advertisement"]').remove();

  // Try progressively broader patterns for current/next sections.
  // Order matters: more specific patterns first.
  function firstMatch(...patterns) {
    for (const p of patterns) {
      const els = getSectionElements($, p);
      if (els.length) return els;
    }
    return [];
  }

  const resolvedCurrentEls = firstMatch(
    /all\s+warp\s+banner/i,       // HSR: "All Warp Banners Schedule" (clean schedule table with (Current) row)
    /current\s+banner/i,          // ZZZ, Endfield, most games: "Current Banner"
    /banners?\s+in\s+version/i,   // Genshin: "Banners in Version X.X"
    /available.*banner/i,         // Wuwa: "Available Convene Banners in Wuthering Waves"
    /current/i,                   // broad fallback
  );

  const resolvedNextEls = firstMatch(
    /(?:next|upcoming)\s+banner/i,
    /upcoming.*banner|upcoming\s+banners?\s+in/i,
    /upcoming|next/i,
  );

  if (!resolvedCurrentEls.length && !resolvedNextEls.length) {
    console.warn(`  [${game.id}] game8: could not find current/next banner sections`);
    return null;
  }

  // Variant of splitSubsections that ALWAYS starts a new group at an
  // h3/h4/h5 boundary, regardless of whether the previous group had
  // "interesting" content. Used for Endfield's current section where
  // each sub-banner has its own heading and we want one group per
  // heading even if a preceding group only contained the section
  // preamble. The first group (before the first heading) is kept so
  // the caller can decide whether to discard it.
  function splitAtEveryHeading(els) {
    const groups = [];
    let cur = [];
    for (const el of els) {
      if (el.is('h3,h4,h5')) {
        if (cur.length) groups.push(cur);
        cur = [el];
      } else {
        cur.push(el);
      }
    }
    if (cur.length) groups.push(cur);
    return groups;
  }

  // Split next-section elements into subsections at h3/h4 boundaries
  // (e.g. Wuwa's "3.3 Phase 1 Banners" vs "3.3 Phase 2 Banners").
  // First subsection → next; rest → upcoming.
  function splitSubsections(els) {
    if (!els.length) return [els];
    const groups = [];
    let cur = [];
    let sawInterestingContent = false;
    for (const el of els) {
      if (el.is('h3,h4,h5')) {
        if (cur.length && sawInterestingContent) {
          groups.push(cur);
          cur = [];
          sawInterestingContent = false;
        }
      } else if (el.is('table,ul,ol') || el.find('table,ul,ol').length) {
        sawInterestingContent = true;
      }
      cur.push(el);
    }
    if (cur.length) groups.push(cur);
    return groups.length ? groups : [els];
  }

  const currentData = extractFromElements($, resolvedCurrentEls);
  const nextGroups  = splitSubsections(resolvedNextEls);
  const nextData    = extractFromElements($, nextGroups[0] ?? []);
  const upcomingData = nextGroups.slice(1).map(g => extractFromElements($, g));

  // Pick the most date-rich string for the end date.
  //
  // Endfield interleaves several concurrent sub-banners under one
  // "Current Banners" heading (Phase 1 Zhuang Fangyi ending May 22 +
  // Phase 2 Fest of Brilliance ending June 5 + various Weapon Issues),
  // so "first match" picks whichever section appears first in the page
  // — usually NOT the latest of the bunch. For Endfield only we pick
  // the latest-future end so the displayed countdown reflects when the
  // whole phase actually wraps. Other games have a single linear phase
  // per current section so the original first-match logic is correct.
  const now = Date.now();
  function bestEndDate(ds) {
    if (game.id === 'endfield') {
      let bestFuture = null;
      let latest = null;
      for (const d of ds) {
        const { end } = extractDateRange(d, game.defaultHourUtc);
        if (!end) continue;
        const ts = new Date(end).getTime();
        if (Number.isNaN(ts)) continue;
        if (ts > now && (!bestFuture || ts > new Date(bestFuture).getTime())) bestFuture = end;
        if (!latest || ts > new Date(latest).getTime()) latest = end;
      }
      return bestFuture ?? latest;
    }
    for (const d of ds) {
      const { end } = extractDateRange(d, game.defaultHourUtc);
      if (end) return end;
    }
    return null;
  }

  function bestStartDate(ds) {
    if (game.id === 'endfield') {
      let earliest = null;
      for (const d of ds) {
        const { start } = extractDateRange(d, game.defaultHourUtc);
        if (!start) continue;
        const ts = new Date(start).getTime();
        if (Number.isNaN(ts)) continue;
        if (!earliest || ts < new Date(earliest).getTime()) earliest = start;
      }
      return earliest;
    }
    for (const d of ds) {
      const { start } = extractDateRange(d, game.defaultHourUtc);
      if (start) return start;
    }
    return null;
  }

  // ── Endfield concurrent sub-banners ──
  //
  // Endfield's "Current Banners" section is the only one in the four
  // games that hosts MULTIPLE simultaneously-active character banners
  // with independent end dates — Phase 1 (one operator) and Phase 2
  // (the Fest of Brilliance multi-op event) run on overlapping windows
  // with different timers. The aggregate `current` block above smashes
  // them into one phase + one (latest) end date; that loses information.
  //
  // We additionally walk the current section and split it at EVERY h3/h4
  // boundary, treating each subsection as a candidate sub-banner. The
  // "X Issue" weapon-issue subsections (Smelting Fire Issue, Swift
  // Walker Issue, etc.) get filtered out — they don't carry character
  // names and aren't what users come here to track. Emitted as
  // `current.subBanners`; the front-end renders one countdown per entry
  // when present, falling back to the aggregate `current` block when
  // not (i.e. for the other four games, which don't run concurrent
  // banners).
  let endfieldSubBanners = null;
  if (game.id === 'endfield' && resolvedCurrentEls.length) {
    const subGroups = splitAtEveryHeading(resolvedCurrentEls);
    const candidates = [];
    for (const group of subGroups) {
      const headingEl = group.find(el => el.is('h3,h4,h5'));
      if (!headingEl) continue;     // first chunk before any h3 = preamble
      const headingText = normalizeText(headingEl.text());
      // Weapon-banner heuristic: title ends in " Issue" with no other
      // marker (no "Phase", no "Version", no character-like phrasing).
      if (/\bIssue\s*$/i.test(headingText) && !/\bphase\b|\bversion\b/i.test(headingText)) continue;
      const data = extractFromElements($, group);
      if (!data.characters.length) continue;
      candidates.push({
        phase: extractPhase($, group),
        characters: data.characters,
        end: bestEndDate(data.dateStrings),
        start: bestStartDate(data.dateStrings),
      });
    }
    // Only emit when we actually found ≥2 distinct sub-banners — a
    // single sub-banner is equivalent to the aggregate and doesn't
    // need the extra rendering path.
    if (candidates.length >= 2) endfieldSubBanners = candidates;
  }

  return {
    current: {
      characters: currentData.characters,
      phase: extractPhase($, resolvedCurrentEls),
      end: bestEndDate(currentData.dateStrings),
      subBanners: endfieldSubBanners,
    },
    next: {
      characters: nextData.characters,
      phase: extractPhase($, nextGroups[0] ?? []),
      start: bestStartDate(nextData.dateStrings),
      end: bestEndDate(nextData.dateStrings),
    },
    upcoming: upcomingData
      .filter(d => d.characters.length)
      .map(d => ({
        characters: d.characters,
        start: bestStartDate(d.dateStrings),
        end:   bestEndDate(d.dateStrings),
      })),
  };
}

// ---------------------------------------------------------------------------
// prydwen fallback (HSR only)
// prydwen embeds banner data in its page text as:
//   (BannerTitle) (CharacterName) - ends YYYY/MM/DD HH:MM:SS
// ---------------------------------------------------------------------------

function parsePrydwenPage(html) {
  const $ = cheerio.load(html);
  $('script, style').remove();
  const text = $.text();

  // Match "ends YYYY/MM/DD HH:MM:SS" patterns
  const endPattern = /ends\s+(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})/gi;
  const allEnds = [];
  let m;
  while ((m = endPattern.exec(text)) !== null) {
    const d = new Date(m[1].replace(/\//g, '-') + 'Z'); // treat as UTC
    if (!isNaN(d.getTime())) allEnds.push(d.getTime());
  }

  if (!allEnds.length) return null;

  const now = Date.now();
  allEnds.sort((a, b) => a - b);

  // Soonest future end = current banner end; next group = next banner
  const currentEnd = allEnds.find(e => e > now) ?? null;
  const nextEnd    = currentEnd
    ? (allEnds.find(e => e > (currentEnd + 60 * 1000)) ?? null)
    : null;

  // Extract character names near "Current" section (rough text scan)
  const currentSection = text.match(/Current Banners?([\s\S]{0,2000}?)(?:Upcoming|Future|Next Banner)/i)?.[1] ?? '';
  const nextSection    = text.match(/Upcoming Banners?([\s\S]{0,2000}?)(?:$|Future)/i)?.[1] ?? '';

  function namesFromSection(sec) {
    return [...sec.matchAll(/\(([A-Z][a-zA-Z\s'.:-]{1,35})\)/g)]
      .map(x => x[1].trim())
      .filter(n => !JUNK_PATTERN.test(n) && !DATE_LIKE.test(n))
      .slice(0, 6);
  }

  return {
    current: {
      characters: namesFromSection(currentSection),
      end: currentEnd ? new Date(currentEnd).toISOString() : null,
    },
    next: {
      characters: namesFromSection(nextSection),
      start: currentEnd ? new Date(currentEnd).toISOString() : null,
      end: nextEnd ? new Date(nextEnd).toISOString() : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function tryGame8(game) {
  console.log(`[${game.id}] Fetching game8: ${game.game8Url}`);
  try {
    const html = await fetchHtml(game.game8Url);
    const result = parseGame8Page(html, game);
    if (result && (result.current.end || result.next.end)) {
      console.log(`[${game.id}] game8 OK — current end: ${result.current.end}, next end: ${result.next.end}`);
      return { result, source: 'game8' };
    }
    console.warn(`[${game.id}] game8 parse yielded no dates`);
  } catch (err) {
    console.warn(`[${game.id}] game8 error: ${err.message}`);
  }
  return null;
}

async function tryPrydwen(game) {
  if (!game.fallbackUrl) return null;
  console.log(`[${game.id}] Fetching prydwen: ${game.fallbackUrl}`);
  try {
    const html = await fetchHtml(game.fallbackUrl);
    const result = parsePrydwenPage(html);
    if (result && (result.current.end || result.next.end)) {
      console.log(`[${game.id}] prydwen OK — current end: ${result.current.end}`);
      return { result, source: 'prydwen' };
    }
    console.warn(`[${game.id}] prydwen parse yielded no dates`);
  } catch (err) {
    console.warn(`[${game.id}] prydwen error: ${err.message}`);
  }
  return null;
}

async function scrapeGame(game) {
  // preferFallback = try Prydwen first, then game8 (used for HSR where game8 mixes light cones)
  if (game.preferFallback) {
    return (await tryPrydwen(game)) ?? (await tryGame8(game));
  }
  return (await tryGame8(game)) ?? (await tryPrydwen(game));
}

async function main() {
  const checkedAt = new Date().toISOString();
  // Load existing JSON so we can preserve games that fail to scrape
  let existing = { updated: null, checkedAt: null, games: [] };
  if (fs.existsSync(OUTPUT)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
    } catch {
      console.warn('Could not read existing banner_data.json — starting fresh');
    }
  }

  const existingById = Object.fromEntries((existing.games ?? []).map(g => [g.id, g]));
  const updatedGames = [];

  for (const game of GAMES) {
    const scraped = await scrapeGame(game);
    const old = existingById[game.id];

    if (!scraped) {
      // Preserve old entry unchanged; mark it as stale
      if (old) {
        console.warn(`[${game.id}] Using preserved data from last successful scrape`);
        updatedGames.push({
          ...old,
          freshness: {
            status: 'stale',
            checkedAt,
            lastSuccessfulFetch: old.freshness?.lastSuccessfulFetch || old.lastSuccessfulFetch || existing.updated || null,
            message: 'This game failed to scrape during the latest banner check; preserved previous data.'
          }
        });
      } else {
        console.warn(`[${game.id}] No data at all — skipping game`);
      }
      continue;
    }

    const { result, source } = scraped;

    // Merge: use scraped character lists as-is (empty = "unknown", render as "?").
    // Only dates fall back to old values so countdowns don't disappear on one bad scrape.
    const oldCurrent = old?.current ?? {};
    const oldNext    = old?.next    ?? {};

    // Enrich each character name with a nanoka icon URL (when available).
    const currentChars = await enrichCharactersWithIcons(game.id, result.current.characters);
    let nextChars      = await enrichCharactersWithIcons(game.id, result.next.characters);
    let upcomingEnriched = await Promise.all(
      (result.upcoming ?? []).map(async (u) => ({
        characters: await enrichCharactersWithIcons(game.id, u.characters),
        start: u.start,
        end:   u.end,
      }))
    );
    // Endfield: enrich each sub-banner the same way + drop any that
    // ended up with zero matched characters after enrichment (heuristic
    // false positives upstream of the nanoka filter).
    const currentSubBanners = result.current.subBanners
      ? (await Promise.all(
          result.current.subBanners.map(async (sb) => ({
            phase: sb.phase,
            characters: await enrichCharactersWithIcons(game.id, sb.characters),
            start: sb.start ?? null,
            end: sb.end,
          }))
        )).filter((sb) => sb.characters.length > 0)
      : null;

    let nextStart = result.next.start ?? oldNext.start ?? null;
    let nextEnd   = result.next.end   ?? oldNext.end   ?? null;

    // If the scraped "next" has no characters but "upcoming[0]" does, promote
    // upcoming[0] into next (typical for ZZZ where game8's overview only labels
    // one section "current" and the next phase lives under a sub-heading).
    if (!nextChars.length && upcomingEnriched.length && upcomingEnriched[0].characters.length) {
      const promoted = upcomingEnriched.shift();
      nextChars = promoted.characters;
      nextStart = promoted.start ?? nextStart;
      nextEnd   = promoted.end   ?? nextEnd;
    }

    // Sanitise stale "next" data when game8 had nothing real to say about
    // it. Endfield in particular hits this — its "No Announcement Yet for
    // Version 1.3 Banners" section leaves dates dangling from a previous
    // run's parse (e.g. start:null + end:2026-05-04 in the past). A NEXT
    // phase with no characters AND no future start date is meaningless;
    // blank it out so the page never has to decide what to render.
    const nextStartMs = nextStart ? new Date(nextStart).getTime() : null;
    const nextEndMs   = nextEnd   ? new Date(nextEnd).getTime()   : null;
    const noFutureWindow =
      (!Number.isFinite(nextStartMs) || nextStartMs < Date.now()) &&
      (!Number.isFinite(nextEndMs)   || nextEndMs   < Date.now());
    if (nextChars.length === 0 && noFutureWindow) {
      nextStart = null;
      nextEnd = null;
    }

    updatedGames.push({
      id: game.id,
      name: game.name,
      freshness: {
        status: 'fresh',
        checkedAt,
        lastSuccessfulFetch: checkedAt,
        source
      },
      current: {
        phase:      result.current.phase,
        characters: currentChars,
        end:        result.current.end ?? oldCurrent.end ?? null,
        source,
        // Only emit subBanners when populated (≥2 entries after
        // enrichment); otherwise omit so other games' JSON stays clean.
        ...(currentSubBanners && currentSubBanners.length >= 2 ? { subBanners: currentSubBanners } : {}),
      },
      next: {
        phase:      result.next.phase,
        characters: nextChars,
        start:      nextStart,
        end:        nextEnd,
        source,
      },
      upcoming: upcomingEnriched,
    });
  }

  const payload = {
    checkedAt,
    updated: updatedGames
      .map((game) => game.freshness?.lastSuccessfulFetch)
      .filter(Boolean)
      .sort()
      .at(-1) || existing.updated || checkedAt,
    games: updatedGames,
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2));
  console.log(`Saved ${OUTPUT}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
