#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { isUsefulReward } = require("./reward-vocab.cjs");
const { diffSemanticCodes } = require("./semantic-diff.cjs");

// Codes redeem case-insensitively, so identity for dedupe/corroboration/expiry
// matching is the upper-cased form. Display casing is preserved on the record;
// only comparisons use this key.
const codeKey = (code) => String(code || "").toUpperCase();

// ---- config -----------------------------------------------------------------

const MAX_AGE_DAYS = 28;
const PREMIUM100_TTL_MS = 72 * 60 * 60 * 1000; // livestream-style codes expire fast
const FETCH_TIMEOUT_MS = 15000;
const FETCH_RETRIES = 1; // 2 attempts total
const RETRY_DELAY_MS = 1500;

// Burst guard. Real redemption codes arrive a few at a time (a livestream drops
// 1-3); return-event referral codes flood (every player shares their own). If
// MORE than this many codes for a single game are first seen inside the window,
// the recent batch is held for manual review instead of published live — the
// catch-all for invite-code formats not yet in INVITE_CODE_SHAPES.
const BURST_THRESHOLD = 5;
const BURST_WINDOW_MS = 24 * 60 * 60 * 1000;

const OUTPUT = path.join(__dirname, "..", "..", "Database", "Codes", "codes.json");

function parseGameList(value = "") {
  return String(value || "")
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function parseCliOptions(argv = process.argv.slice(2), env = process.env) {
  const flags = new Set(argv);
  const redditGamesArg = argv.find((arg) => arg.startsWith("--reddit-games="));
  const activeOnly = flags.has("--active-only");
  const deep = flags.has("--deep");
  return {
    activeOnly,
    deep,
    changeGated: flags.has("--change-gated"),
    skipExpired: activeOnly,
    skipReddit: flags.has("--skip-reddit") || (activeOnly && !deep),
    redditGames: parseGameList(redditGamesArg ? redditGamesArg.slice("--reddit-games=".length) : env.CODES_REDDIT_GAMES),
    preserveMissing: activeOnly,
  };
}

const CLI_OPTIONS = parseCliOptions();

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HTML_HEADERS = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,*/*;q=0.9",
  "Accept-Language": "en-US,en;q=0.9",
};
const JSON_HEADERS = {
  "User-Agent": UA,
  "Accept": "application/json, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

const SOURCES = [
  { slug: "genshin", name: "Genshin Impact", icon: "GI",
    redeemBase: "https://genshin.hoyoverse.com/en/gift?code=",
    note: "",
    nexusUrl: "https://nexus-codes.app/games/GI/codes/" },
  { slug: "hsr", name: "Honkai: Star Rail", icon: "HSR",
    redeemBase: "https://hsr.hoyoverse.com/gift?code=",
    note: "",
    nexusUrl: "https://nexus-codes.app/games/HSR/codes/" },
  { slug: "zzz", name: "Zenless Zone Zero", icon: "ZZZ",
    redeemBase: "https://zenless.hoyoverse.com/redemption?code=",
    note: "",
    nexusUrl: "https://nexus-codes.app/games/ZZZ/codes/" },
  { slug: "wuwa", name: "Wuthering Waves", icon: "WUWA",
    redeemBase: "",
    note: "Redeem ingame via Terminal > Settings > Other Settings > Redemption Code",
    nexusUrl: "https://nexus-codes.app/games/WUWA/codes/" },
];

// crimsonwitch.com is a Next.js SSR app; code data is embedded in
// __next_f.push() Flight payloads as JSON-encoded strings.
const CRIMSONWITCH_URLS = {
  genshin: "https://www.crimsonwitch.com/codes/Genshin_Impact",
  hsr:     "https://www.crimsonwitch.com/codes/Honkai_Star_Rail",
  zzz:     "https://www.crimsonwitch.com/codes/Zenless_Zone_Zero",
  wuwa:    "https://www.crimsonwitch.com/codes/Wuthering_Waves",
};

// Per-game expired-code sources. Drives a single fetcher per backend so we
// don't re-implement the same Fandom + game8 logic four times.
//   fandom.mode "all-rows"          — every <td>-bearing row is expired
//   fandom.mode "class-on-last-td"  — only rows whose last <td> has className
//   game8.mode "table"              — rows in the first <table> after Expired heading
//   game8.mode "strong"             — codes in <strong> tags after Expired heading
const EXPIRED_CONFIG = {
  genshin: {
    fandom: { url: "https://genshin-impact.fandom.com/api.php",
              page: "Promotional_Code/History", mode: "all-rows" },
    game8: null,
  },
  hsr: {
    fandom: { url: "https://honkai-star-rail.fandom.com/api.php",
              page: "Redemption_Code", mode: "class-on-last-td", className: "bg-old" },
    game8: { url: "https://game8.co/games/Honkai-Star-Rail/archives/410296", mode: "table" },
  },
  zzz: {
    fandom: { url: "https://zenless-zone-zero.fandom.com/api.php",
              page: "Redemption_Code", mode: "class-on-last-td", className: "bg-red" },
    game8: { url: "https://game8.co/games/Zenless-Zone-Zero/archives/435683", mode: "table" },
  },
  wuwa: {
    fandom: { url: "https://wutheringwaves.fandom.com/api.php",
              page: "Redemption_Code", mode: "class-on-last-td", className: "bg-old" },
    game8: { url: "https://game8.co/games/Wuthering-Waves/archives/453149", mode: "strong" },
  },
};

const PREMIUM_KEYS = ["Polychrome", "Astrite", "Stellar Jade", "Primogem"];
// Loose match: "100 Primogems", "100x Primogem", "100 x Stellar Jade", etc.
const PREMIUM100_RE = /\b100\s*x?\s*(?:Polychromes?|Astrites?|Stellar\s+Jades?|Primogems?)\b/i;

// Codes manually blacklisted (e.g. perma-active filler that nexus keeps surfacing).
const IGNORED_CODES = new Set(["WUTHERINGGIFT"]);

// Codes the operator has manually reviewed and confirmed legit. Listing a code
// here force-publishes it: it bypasses BOTH the structural invite-shape filter
// and the burst hold below. This is the "release" lever for the burst guard —
// when a real code gets caught in a flood (or happens to match a referral
// shape), add it here and the next run publishes it. Keep this trimmed: once a
// released code expires off the sources it no longer matters, so old entries
// can be deleted.
const REVIEWED_CODES = new Set([]);

// ---- helpers ----------------------------------------------------------------

function normalizeText(text = "") {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Single fetch wrapper: timeout covers both headers and body read, retry on
// 5xx/network/body timeout, structured result.
async function fetchWithRetry(url, { headers = HTML_HEADERS, tag = "fetch", responseType = "text" } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        if (res.status >= 500 && attempt < FETCH_RETRIES) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        return { ok: false, error: `HTTP ${res.status}` };
      }
      try {
        const body = responseType === "json" ? await res.json() : await res.text();
        return responseType === "json"
          ? { ok: true, json: body }
          : { ok: true, text: body };
      } catch (err) {
        lastErr = err;
        if (attempt < FETCH_RETRIES) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        return { ok: false, error: `${err.name || "ReadError"}: ${err.message || "body read failed"}` };
      }
    } catch (err) {
      lastErr = err;
      if (attempt < FETCH_RETRIES) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
    }
  }
  return { ok: false, error: lastErr?.message || "fetch failed" };
}

let _cutoffMs = null;
function recencyCutoffMs() {
  if (_cutoffMs === null) {
    const cutoff = new Date();
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCDate(cutoff.getUTCDate() - MAX_AGE_DAYS);
    _cutoffMs = cutoff.getTime();
  }
  return _cutoffMs;
}

function isRecent(date) {
  if (!date) return false;
  return date.getTime() >= recencyCutoffMs();
}

const toIsoDate = (date) => date.toISOString().slice(0, 10);

function parseAddedDate(text) {
  const cleaned = normalizeText(text);
  const match = cleaned.match(/Added\s+([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/i);
  if (!match) return null;
  const date = new Date(match[1] + " UTC");
  return Number.isNaN(date.getTime()) ? null : date;
}

function classifyPremium(rewards = "") {
  const lower = rewards.toLowerCase();
  const premium = PREMIUM_KEYS.some(k => lower.includes(k.toLowerCase()));
  const premium100 = PREMIUM100_RE.test(rewards);
  return { premium, premium100 };
}

// ---- active sources ---------------------------------------------------------

function parseNexusCodes(html, game) {
  const $ = cheerio.load(html);
  const entries = [];
  const seen = new Set();

  $("h3").each((_, el) => {
    const heading = $(el);
    // Skip anchor IDs; the real link is the first http(s) anchor.
    const codeLink = heading.find("a[href^='http']").first();
    const href = codeLink.attr("href") || "";

    let code = "";
    const codeEl = codeLink.find("code").first();
    if (codeEl.length) code = normalizeText(codeEl.text());
    else if (codeLink.length) code = normalizeText(codeLink.text()).replace(/^`+|`+$/g, "");
    if (!code) return;

    let rewards = "";
    let added = null;
    let node = heading.next();
    while (node.length) {
      const tag = (node[0].tagName || "").toLowerCase();
      if (tag === "h3" || tag === "h2") break;
      const text = normalizeText(node.text());
      if (text) {
        // Date may be inline with rewards (e.g. rewards<br><em>Added ...</em>).
        const dateMatch = text.match(/Added\s+[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}/i);
        if (dateMatch) {
          if (!added) added = parseAddedDate(dateMatch[0]);
          if (!rewards) {
            const stripped = normalizeText(text.replace(dateMatch[0], ""));
            if (stripped) rewards = stripped;
          }
        } else if (!rewards) rewards = text;
      }
      node = node.next();
    }

    if (!added) return;
    const id = `${game.slug}:${code}`;
    if (seen.has(id)) return;
    seen.add(id);
    entries.push({ code, rewards, added: toIsoDate(added), sourceUrl: href || game.nexusUrl });
  });
  return entries;
}

async function fetchNexusActive(game) {
  const tag = `nexus-${game.slug}`;
  const r = await fetchWithRetry(game.nexusUrl, { tag });
  if (!r.ok) {
    console.warn(`[${tag}] ${r.error}`);
    return null; // null distinguishes "source failed" from "no codes"
  }
  const html = r.text;
  return parseNexusCodes(html, game);
}

// Returns null on fetch failure so callers can distinguish "fetch failed"
// from "fetch succeeded with empty list" — important for the "crimsonwitch
// dropped this code = expired" rule, which must not trigger when the source
// is unreachable.
async function fetchCrimsonwitchActive(slug) {
  const url = CRIMSONWITCH_URLS[slug];
  if (!url) return [];
  const tag = `crimsonwitch-${slug}`;
  const r = await fetchWithRetry(url, { tag });
  if (!r.ok) { console.warn(`[${tag}] ${r.error}`); return null; }
  const arr = parseCrimsonwitchPayload(r.text);
  if (arr === null) {
    console.warn(`[${tag}] initialCodes not found / parse failed`);
    return null; // can't trust this run for prune-by-absence
  }

  const entries = [];
  for (const item of arr) {
    const code = normalizeText(item?.code || "");
    if (!code || !/^[A-Za-z0-9]{4,20}$/.test(code)) continue;
    const added = item?.added ? new Date(item.added) : null;
    if (!added || Number.isNaN(added.getTime())) continue;
    const rewards = Array.isArray(item.rewards)
      ? item.rewards.filter(r => r && r.item)
          .map(r => `${r.qty ?? ""} ${r.item}`.trim().replace(/\s+/g, " "))
          .join(", ")
      : "";
    const expiresDate = item?.expires ? new Date(item.expires) : null;
    entries.push({
      code,
      rewards,
      added: toIsoDate(added),
      sourceUrl: url,
      // region_locked: null / "$undefined" (Next.js Flight sentinel) = global.
      regionLocked: normalizeRegionLocked(item?.region_locked),
      expires: expiresDate && !Number.isNaN(expiresDate.getTime()) ? expiresDate.toISOString() : null,
      variants: parseCodeVariants(item?.code_variants),
    });
  }
  return entries;
}

// Pure: extract the `initialCodes` array out of crimsonwitch's Next.js Flight
// payloads. Returns the raw item array, or null when the payload can't be parsed
// (so callers don't prune-by-absence on a bad fetch). Exported for unit tests.
function parseCrimsonwitchPayload(html) {
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let combined = "";
  let m;
  while ((m = re.exec(html)) !== null) {
    try { combined += JSON.parse('"' + m[1] + '"'); } catch {}
  }

  const idx = combined.indexOf('"initialCodes":[');
  if (idx < 0) return null;

  // Bracket-balance the JSON array starting after "initialCodes":
  const start = idx + '"initialCodes":'.length;
  let depth = 0, end = start, inStr = false, esc = false;
  for (let i = start; i < combined.length; i++) {
    const c = combined[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { end = i + 1; break; } }
  }

  try { return JSON.parse(combined.slice(start, end)); }
  catch { return null; }
}

// null / "$undefined" / empty = global (not region-locked); otherwise the region tag.
function normalizeRegionLocked(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || s === "$undefined" || s.toLowerCase() === "null") return null;
  return s;
}

function parseCodeVariants(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[\s,]+/);
  return list.map((v) => normalizeText(v)).filter((v) => /^[A-Za-z0-9]{4,20}$/.test(v));
}

// game8's Wuwa page lists active codes as `CODE - rewards` in <ul> bullets.
async function fetchGame8WuwaActive() {
  const tag = "wuwa-game8-active";
  const url = "https://game8.co/games/Wuthering-Waves/archives/453149";
  const r = await fetchWithRetry(url, { tag });
  if (!r.ok) { console.warn(`[${tag}] ${r.error}`); return []; }
  const html = r.text;
  const $ = cheerio.load(html);
  $("script, style").remove();

  // Walk h2/h3/h4 sections that look like active/livestream codes; skip Expired.
  const headings = $("h2, h3, h4").filter((_, el) => {
    const t = normalizeText($(el).text());
    if (/expired/i.test(t)) return false;
    return /(?:active|livestream).*code/i.test(t) || /^all\s+active\s+codes?$/i.test(t);
  }).toArray();

  const today = new Date();
  const entries = [];

  for (const h of headings) {
    const heading = $(h);
    let sectionDate = null;
    let el = heading.next();
    while (el.length && !el.is("h1, h2, h3")) {
      if (!sectionDate) {
        const txt = normalizeText(el.text());
        const m = txt.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})\b/);
        if (m) {
          const d = new Date(`${m[1]} ${m[2]}, ${m[3]} UTC`);
          if (!Number.isNaN(d.getTime())) sectionDate = d;
        }
      }
      if (el.is("ul, ol")) {
        el.find("li").each((_, li) => {
          const text = normalizeText($(li).text());
          const m = text.match(/^([A-Z0-9]{4,20})\s*[-–—]\s*(.+)$/);
          if (!m) return;
          entries.push({
            code: m[1],
            rewards: m[2].trim(),
            added: toIsoDate(sectionDate ?? today),
            sourceUrl: url,
          });
        });
      }
      el = el.next();
    }
  }
  return entries;
}

// ---- hoyo-codes (active, redemption-verified) ------------------------------
//
// hoyo-codes.seria.moe re-checks each code by actually attempting redemption
// through a HoYoLAB account and only returns ones whose status is "OK". That
// makes it a strong AUTHORITATIVE source for Genshin/HSR/ZZZ: consumed before
// Reddit, it both supplies clean codes directly and corroborates Reddit codes
// (a Reddit code it also lists wins the dedupe with a non-reddit sourceUrl, so
// it's no longer "Reddit-only" and publishes). The API carries no publish date,
// so hoyo-exclusive codes are stamped "today" — fine, since they're verified
// live now and our own firstSeen tracking stabilises age across runs. Region
// caveat: it validates on a global/Asia account, so it is NOT a Global-vs-CN
// authority — the region_locked / CN filters still apply.
const HOYO_CODES_GAME = { genshin: "genshin", hsr: "hkrpg", zzz: "nap" };

async function fetchHoyoCodes(game) {
  const apiGame = HOYO_CODES_GAME[game.slug];
  if (!apiGame) return []; // wuwa not covered by hoyo-codes
  const tag = `hoyo-codes-${game.slug}`;
  const url = `https://hoyo-codes.seria.moe/codes?game=${apiGame}`;
  const r = await fetchWithRetry(url, { headers: JSON_HEADERS, tag, responseType: "json" });
  if (!r.ok) { console.warn(`[${tag}] ${r.error}`); return null; } // null = fetch failed
  const list = Array.isArray(r.json?.codes) ? r.json.codes : (Array.isArray(r.json) ? r.json : []);
  const today = toIsoDate(new Date());
  const entries = [];
  for (const item of list) {
    if (item?.status && String(item.status).toUpperCase() !== "OK") continue;
    const code = normalizeText(item?.code || "");
    if (!code || !/^[A-Za-z0-9]{4,20}$/.test(code)) continue;
    // Normalise the "Item*Qty;Item*Qty" shape into readable prose; leave already
    // prose-formatted reward strings (some games) untouched.
    const rewards = normalizeText(String(item?.rewards || "").replace(/\*/g, " x ").replace(/;/g, ", "));
    entries.push({
      code,
      rewards,
      added: today,
      sourceUrl: game.redeemBase ? game.redeemBase + encodeURIComponent(code) : url,
      hoyoVerified: true, // redemption-verified; exempt from the referral-flood burst guard
    });
  }
  console.log(`[${tag}] ${entries.length} OK code(s)`);
  return entries;
}

// ---- Reddit (active, via RSS) ----------------------------------------------
//
// Many livestream / collaboration codes land on Reddit (e.g. WuWa's
// "STRANGEVISITORS / BEYONDTHEDOOR / SAYCHEESE" from a 3.x preview broadcast)
// hours before nexus-codes.app or crimsonwitch index them. We scan two
// surfaces per subreddit:
//
//   1. Self-posts surfaced by subreddit search + /new whose title looks like
//      a code drop. The post body (carried inline in the listing feed) is
//      harvested directly.
//   2. For those code-ish posts, the top comments too (HoyoVerse-style pinned
//      megathreads drop codes in comments rather than the body).
//
// TRANSPORT: Reddit shut off unauthenticated JSON in 2026 — every *.json
// endpoint now 403s, from GitHub Actions *and* residential IPs, and the OAuth
// app flow tightened the same year. Reddit's RSS/Atom feeds (search.rss,
// new.rss, <post>/.rss) still return 200 to a normal browser UA, so we use
// those as the bypass. When REDDIT_PROXY_BASE is set we additionally fall the
// RSS fetch back through the residential proxy if a direct hit fails (belt &
// suspenders for any IP-based RSS throttling in CI).
//
// All emissions go through the same processGame() pipeline as every other
// source, so the cutoff, expired-prune, and crimsonwitch-authority rules
// still apply — Reddit codes that are wrong / typo'd get pruned the moment
// they show up on the fandom / game8 expired tables.

// One or more subreddits per game. A real livestream/collab code usually shows
// up across more than one of these, which strengthens the "≥2 independent
// mentions" signal in harvestRedditCodes; the same strict gate runs on every
// candidate, so the extra surface adds little noise.
const REDDIT_SUBS = {
  genshin: ["Genshin_Impact"],
  hsr:     ["HonkaiStarRail", "StarRailStation"],
  zzz:     ["ZZZ_Official", "ZenlessZoneZero"],
  wuwa:    ["WutheringWaves"],
};

// Code-candidate regex. Accepts mixed case (e.g. "snezhnaya20260812") and
// all-uppercase (the dominant form). Length 6–20, must start with a
// letter. The "must contain a digit" filter is applied separately so
// rare letter-only codes can be allow-listed if needed later.
const REDDIT_CODE_RE = /\b[A-Za-z][A-Za-z0-9]{5,19}\b/g;

// Title keywords that mark a post as worth scanning. Daily-questions and
// general-discussion megathreads are excluded by absence of these.
const REDDIT_TITLE_KEYWORD_RE = /\b(code|livestream|redeem|primogem|gift|special\s+(?:program|broadcast))/i;

// Anything matching the regex but clearly not a code. Lowercased on lookup.
const REDDIT_STOPWORDS = new Set([
  "genshin","genshinimpact","honkai","starrail","hsr","zenless","zonezero","wuthering",
  "wutheringwaves","wuwa","mihoyo","hoyoverse","kuro","kurogames",
  "primogems","stellarjades","polychromes","astrites","mora","credits",
  "redeem","redemption","code","codes","gift","giftcode","livestream",
  "twitter","reddit","youtube","official","update","patch","version","season",
  "edited","deleted","removed","banned","spoilers","megathread",
  "iphone","android","windows","macos","english","chinese","japanese","korean",
  "europe","america","asia","global","server",
  // Singular reward-noun forms (the regex requires len ≥ 6, so these slip past
  // the plural entries above).
  "primogem","polychrome","astrite","stellar","jades","oneiric","denny","dennies",
  // All-caps PR/event vocabulary that sits next to "Redeem codes for…" banners
  // now that letter-only ALLCAPS tokens are accepted as candidates.
  "broadcast","preview","program","special","trailer","banner","anniversary",
  "maintenance","compensation","event","events","collab","collaboration",
  "character","characters","weapon","weapons","currency","reward","rewards",
  "active","expired","limited","standard","welkin","express","details","summary",
  "cyberpunk","edgerunners","playstation","nintendo","mobile","steam","crossplay",
]);

const REDDIT_TIMEOUT_MS = 12_000;
const REDDIT_LISTING_LIMIT = 25;       // entries pulled per search/new RSS feed
const REDDIT_NEW_POST_MAX_AGE_HOURS = 36;
// /new.rss is much more prone to 429s from datacenter IPs than search.rss.
// Keep it as an explicit local/debug fallback, but make CI's normal deep pass
// lean on the endpoint that still returns 200 consistently.
const REDDIT_INCLUDE_NEW = /^(1|true|yes)$/i.test(process.env.REDDIT_INCLUDE_NEW || "");
// Cap on comment-fetches per game (1 fetch per target post). With the
// global REDDIT_MIN_GAP_MS gate below, 8 per game × 4 games × ~11 calls
// each = ~35s of serialized fetches per hourly run — comfortable.
const REDDIT_MAX_TARGETS_PER_GAME = 8;
const REDDIT_COMMENT_KEYWORD_RE = /\b(code|livestream|redeem|gift|primogem|astrite|stellar\s*jade|polychrome)/i;

// Reward-context keyword. A regex-matched candidate is only emitted when
// its line also contains one of these — that's the bright-line filter that
// suppresses YouTube IDs, imgur slugs, Reddit usernames, etc., which never
// appear next to reward terminology.
const REDDIT_REWARD_CONTEXT_RE = /\b(primogem|stellar\s*jade|polychrome|astrite|mora|credit|reward|gift|redeem|codes?|exp|materials?|tickets?|fates?)\b/i;

// Negative context: "invite friends back" / returning-player events (e.g. ZZZ's
// "Version 3.0 Return Event") hand every active player a *personal referral
// code* and the megathreads fill up with them. They're random, digit-bearing,
// and sit next to reward/"code" terminology, so they pass every other filter —
// but they're NOT redemption codes and fail in the redemption box (this is what
// dumped 20 GE…2K / GJ…2K / GU…2K codes onto the Nicode page). When a code's
// line, sticky header, or post title talks about inviting/returning, drop it.
const REDDIT_INVITE_CONTEXT_RE = /\b(?:invit\w*|referr\w*|returnee|return(?:ing)?\s+(?:event|player|proxy|commission)|return\s+to|call\s+back|come\s+back|welcome\s+back|friend\s+code|use\s+my\s+code)\b/i;

// Known machine-generated referral/invite-code shapes, per game. Return-event
// "invite a friend back" codes are randomly generated per player and flood the
// megathreads in bulk; each batch shares a rigid shape no real redemption code
// uses, so the context-based REDDIT_INVITE_CONTEXT_RE above misses the ones
// listed bare next to "60 Polychromes". List a game's CONFIRMED pattern here to
// suppress it silently. For formats not yet catalogued (a brand-new event, or
// another game's first return event), the burst guard in processGame() is the
// catch-all: it holds any sudden flood for manual review instead of publishing.
// Add a pattern here once you've identified a new event's format from a burst
// warning — that turns the one-off alert into a permanent silent filter.
const INVITE_CODE_SHAPES = {
  // ZZZ "Return to Rida" / 2.x "Assembly Commission" return events: 10 chars,
  // starts "G", ends "2K" (GUNSXVJX2K, GEJE24ZY2K, GESCS6SY2K, GERYKQGY2K, …).
  zzz: [/^G[A-Z0-9]{7}2K$/],
  // genshin: [/.../],  // add when a Genshin return-event format is confirmed
  // hsr:     [/.../],  // add when an HSR return-event format is confirmed
  // wuwa:    [/.../],
};

function isInviteShapedCode(slug, code) {
  const shapes = INVITE_CODE_SHAPES[slug];
  return !!shapes && shapes.some((re) => re.test(code));
}

// CN / China-server context. Such codes redeem on a separate mainland portal and
// never work on any Global server, so they're dropped. This is a FALLBACK for
// sources that don't tag region (Reddit, game8, nexus) — crimsonwitch's
// region_locked field is the primary, authoritative signal. Deliberately EXCLUDES
// the global server names Asia/Europe/America/TW/HK/MO (the global gift page lists
// "Asia" as a selectable server, so matching it would drop legit codes).
const CN_CONTEXT_RE = /\b(?:cn[\s-]?server|china(?:se)?[\s-]?server|mainland(?:\s+china)?|cn[\s-]?only|cn[\s-]?exclusive|bilibili|taptap|wechat|weibo|qq\s*group|mihoyo\s*cn|hoyoverse\s*cn)\b|国服|官服|米哈游/i;

function isCnContext(text) {
  return CN_CONTEXT_RE.test(String(text || ""));
}

// A code is "authoritative / corroborated" when its surviving sourceUrl is NOT a
// reddit.com permalink — i.e. nexus, crimsonwitch, game8 or hoyo-codes won the
// dedupe for it. Reddit-only codes (reddit.com sourceUrl) face the confidence gate.
function isAuthoritativeSource(sourceUrl) {
  return !/reddit\.com/i.test(String(sourceUrl || ""));
}

// Confidence gate (pure). Given the merged+pruned `kept` list, returns the set of
// upper-cased keys for Reddit-ONLY codes that must be held for review. A Reddit-only
// code (reddit.com sourceUrl) is held when it fails to (a) name a real reward or
// (b) appear in ≥2 independent posts/comments. The reward check ALWAYS applies —
// even to codes that were live last run — so junk like EARLYGIFT is removed from
// live on the next pass. The mentions check is waived for already-live codes only,
// because Reddit carry-forward (on a failed fetch) loses the per-code mention tally
// and we don't want to yank a legit, already-published code over that.
// Mutates each held record's `reviewReason` for operator visibility.
function classifyRedditOnlyHolds(kept, { slug, prevLiveKeys = new Set() } = {}) {
  const held = new Set();
  for (const c of kept) {
    if (REVIEWED_CODES.has(c.code)) continue;
    if (isAuthoritativeSource(c.sourceUrl)) continue;   // corroborated → publish
    const wasLive = prevLiveKeys.has(codeKey(c.code));
    const reasons = [];
    if (!isUsefulReward(slug, c.rewards, c.sourceUrl)) reasons.push("no real reward");
    if (!wasLive && (c.mentions || 0) < 2) reasons.push("single mention");
    if (reasons.length) {
      held.add(codeKey(c.code));
      c.reviewReason = `unconfirmed Reddit-only code (${reasons.join("; ")})`;
    }
  }
  return held;
}

// Strip out URLs (raw + markdown) before code-extraction so we don't fish
// IDs out of links. Also strips inline-code backticks since real codes are
// usually bold/plain, not code-formatted (and `inline` text often contains
// random tokens).
function stripRedditNoise(text) {
  return text
    // Markdown links: [text](url) — keep the text portion.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Bare URLs.
    .replace(/https?:\/\/\S+/g, " ")
    // `inline code` blocks — codes don't typically come in these.
    .replace(/`[^`\n]*`/g, " ")
    // u/Username and /u/Username references.
    .replace(/\b\/?u\/\S+/gi, " ");
}

// Tries to harvest a per-code "rewards" snippet from the comment body. We
// look at the same line as the code: anything after `:`, `-`, `—`, or `=`.
// Returns "" when nothing plausible is on that line.
function extractRedditReward(line, code) {
  const idx = line.indexOf(code);
  if (idx < 0) return "";
  let after = line.slice(idx + code.length).trim().replace(/^[-–—:=•|·*]\s*/, "");
  if (!after) return "";
  // Codes often appear space-separated on one line ("CODE1 CODE2 CODE3").
  // Don't let one code swallow the rest of the list as its "reward": cut at
  // the next code-like ALLCAPS token. Immediately-following code → no reward.
  const next = after.match(/\b[A-Z][A-Z0-9]{5,}\b/);
  if (next) {
    if (next.index === 0) return "";
    after = after.slice(0, next.index).trim();
  }
  if (!after) return "";
  // Truncate runaway sentences.
  return normalizeText(after.split(/(?:\.\s|[\n\r])/)[0]).slice(0, 140);
}

// Harvest code candidates from one Reddit body (post self-text or a single
// comment) into `byCode` (Map keyed by upper-cased code → { code, rewards,
// added, sourceUrl, mentions }). Each distinct body contributes at most one
// mention per code, so `mentions` counts independent posts/comments — the
// signal the confidence gate uses for "≥2 independent mentions".
function harvestRedditCodes(rawText, postedAt, sourceUrl, byCode) {
  if (!rawText) return;
  const text = stripRedditNoise(rawText);
  const seenThisBody = new Set();
  // Walk line-by-line so reward-context detection stays local. Many posts
  // use a "Stellar Jade Codes:" header followed by codes on separate lines
  // (markdown link extraction collapses [CODE](url) to bare CODE), so we
  // keep a sticky context flag: once a recent line mentioned a reward
  // keyword, the next few lines are treated as candidates until interrupted
  // by another header-like line. `contextLinesLeft` caps how far that
  // stickiness travels so unrelated content downstream doesn't inherit.
  const REWARD_CONTEXT_WINDOW = 6;
  let contextLinesLeft = 0;
  // Most recent header line (e.g. "Stellar Jade Codes:") — used as a
  // fallback "rewards" label when the code sits alone on its own line and
  // extractRedditReward returns "". Without this, codes from the canonical
  // Hoyo pinned-comment layout end up with empty rewards and lose their
  // premium-currency flag in the downstream premium-stamping pass.
  let lastHeader = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const lineHasReward = REDDIT_REWARD_CONTEXT_RE.test(line);
    if (lineHasReward) {
      // Carry reward context forward only when the line looks like a header.
      // Two header shapes open the sticky window:
      //   • colon-terminated and short  ("Stellar Jade Codes:")
      //   • announces codes anywhere    ("🛑 Redeem codes for 3.4 Preview")
      // The second shape matters because parseRedditFeed turns block tags into
      // newlines, so a colon-less "codes" banner can end up on its own line
      // with the actual codes on the lines below. Prose that merely mentions
      // "stellar jade" in passing satisfies neither and won't open the window.
      const isHeaderLike = line.length <= 60 && /:\s*$/.test(line);
      const announcesCodes = line.length <= 100 && /\bcodes?\b/i.test(line);
      // Don't open a harvest window for an invite/return-event banner — the
      // codes listed under it are personal referral codes, not redemption codes.
      if ((isHeaderLike || announcesCodes) && !REDDIT_INVITE_CONTEXT_RE.test(line)) {
        contextLinesLeft = REWARD_CONTEXT_WINDOW;
        // Strip the trailing colon and "Codes"/"Code" suffix to leave just
        // the reward kind (e.g. "Stellar Jade Codes:" → "Stellar Jade"). Only
        // colon-headers name a reward kind; "Redeem codes for…" banners don't,
        // so we don't promote them to lastHeader (would be a junk reward).
        if (isHeaderLike) {
          lastHeader = line
            .replace(/:\s*$/, "")
            .replace(/\s+codes?\s*$/i, "")
            .trim();
        }
      } else {
        contextLinesLeft = 0;
      }
    } else if (contextLinesLeft <= 0) {
      // No fresh reward context and no sticky window — can't be a code drop.
      continue;
    } else {
      contextLinesLeft--;
    }
    // How much non-code "prose" sits on this line — the discriminator for
    // letter-only candidates below. A bare code or a delimited code list
    // leaves almost nothing behind ("STRANGEVISITORS" → 0; "Edit: CODES: A,
    // B, and C" → ~12); a prose paragraph that merely contains an ALLCAPS
    // word leaves a lot ("…FUTURE WITH ALIEN COMPUTERS AND SHIT and
    // honestly…" → ~199).
    const lineProseLen =
      line.replace(REDDIT_CODE_RE, " ").replace(/[^A-Za-z0-9]+/g, "").length;
    REDDIT_CODE_RE.lastIndex = 0;
    let m;
    while ((m = REDDIT_CODE_RE.exec(line)) !== null) {
      const code = m[0];
      // Reddit candidates must be UPPERCASE-only. Real livestream drops
      // (STRANGEVISITORS / BEYONDTHEDOOR / digit-bearing ones) are all uppercase;
      // mixed/lower-case tokens are almost always usernames/prose. A themed
      // mixed-case code (e.g. "ToTheMoon") still reaches us via an authoritative
      // source and publishes through corroboration — we just don't trust Reddit
      // to introduce it on its own.
      if (code !== code.toUpperCase()) continue;
      // Standalone-line check, now applied to ALL candidates (the old digit
      // bypass let any digit-bearing token through near reward context). Accept
      // only when the line is essentially just code(s) (≤2 chars of other text)
      // or is a short reward/redeem line (≤40 chars of prose); a code-shaped
      // token buried in a long paragraph no longer qualifies.
      if (lineProseLen > 2 && !(lineHasReward && lineProseLen <= 40)) continue;
      if (REDDIT_STOPWORDS.has(code.toLowerCase())) continue;
      // Drop codes whose own line or sticky header is invite/return-event
      // context (personal referral codes) or CN/China-server context (won't
      // redeem on Global).
      if (REDDIT_INVITE_CONTEXT_RE.test(line) ||
          (lastHeader && REDDIT_INVITE_CONTEXT_RE.test(lastHeader))) continue;
      if (isCnContext(line) || (lastHeader && isCnContext(lastHeader))) continue;
      const key = codeKey(code);
      if (seenThisBody.has(key)) continue; // one mention max per body
      seenThisBody.add(key);
      let rewards = extractRedditReward(line, code);
      // Fallback: code is alone on its line under a "<Reward> Codes:" header.
      if (!rewards && lastHeader && REDDIT_REWARD_CONTEXT_RE.test(lastHeader)) {
        rewards = lastHeader;
      }
      const existing = byCode.get(key);
      if (existing) {
        existing.mentions += 1;
        if (!existing.rewards && rewards) existing.rewards = rewards;
      } else {
        byCode.set(key, { code, rewards, added: toIsoDate(postedAt), sourceUrl, mentions: 1 });
      }
    }
  }
}

// Global Reddit rate gate. All requests across all games share this single
// schedule, so a 4-game parallel scrape doesn't hammer Reddit with 12
// simultaneous listing fetches. Each call advances the next-allowed time
// by REDDIT_MIN_GAP_MS — effective rate ~1.2 req/s, well under the 1
// req/s sustained budget Reddit enforces for unauth clients.
const REDDIT_MIN_GAP_MS = 800;
let _redditNextAllowedAt = 0;
async function redditRateGate() {
  const now = Date.now();
  const wait = Math.max(0, _redditNextAllowedAt - now);
  _redditNextAllowedAt = Math.max(now, _redditNextAllowedAt) + REDDIT_MIN_GAP_MS;
  if (wait > 0) await sleep(wait);
}

// REDDIT_PROXY_BASE (CI) routes Reddit fetches through the asyce VPS proxy,
// which forwards via an SSH reverse tunnel to a home PC on a residential IP.
// With the RSS transport a direct hit usually succeeds even from datacenter
// IPs, so the proxy is now a *fallback* (fetchRedditRss tries direct first,
// then the proxy). The proxy reconstructs https://www.reddit.com<path>, so it
// forwards .rss paths transparently. Local dev hits Reddit directly.
const REDDIT_PROXY_BASE = process.env.REDDIT_PROXY_BASE || null;
const REDDIT_PROXY_SECRET = process.env.REDDIT_PROXY_SECRET || null;

function viaProxy(redditUrl) {
  if (!REDDIT_PROXY_BASE) return { url: redditUrl, extraHeaders: {} };
  // Strip the reddit.com host; the proxy reconstructs https://www.reddit.com<path>.
  const u = new URL(redditUrl);
  return {
    url: REDDIT_PROXY_BASE.replace(/\/$/, "") + u.pathname + u.search,
    extraHeaders: REDDIT_PROXY_SECRET ? { "X-Proxy-Secret": REDDIT_PROXY_SECRET } : {},
  };
}

// Fetch one Reddit RSS/Atom feed. Reddit blanket-403s unauthenticated `.json`
// endpoints (March 2026 change) but still serves `.rss` with HTTP 200 to a
// browser User-Agent — that's the bypass. Tries a direct hit first, then the
// residential proxy (CI) if one is configured. Returns the raw XML, or null on
// total failure. Honors one 429 back-off per attempt.
async function fetchRedditRss(pathAndQuery, tag) {
  const directUrl = `https://www.reddit.com${pathAndQuery}`;
  const attempts = [{ url: directUrl, headers: {} }];
  if (REDDIT_PROXY_BASE) {
    const { url, extraHeaders } = viaProxy(directUrl);
    attempts.push({ url, headers: extraHeaders });
  }
  const headersBase = {
    "User-Agent": UA,
    "Accept": "application/atom+xml, application/xml, text/xml, */*;q=0.8",
  };
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    const more = i + 1 < attempts.length ? " — trying proxy next" : "";
    await redditRateGate();
    try {
      const res = await fetch(a.url, {
        headers: { ...headersBase, ...a.headers },
        signal: AbortSignal.timeout(REDDIT_TIMEOUT_MS),
      });
      if (res.status === 429) {
        const ra = parseInt(res.headers.get("retry-after") ?? "", 10);
        const waitMs = Number.isFinite(ra) ? Math.min(ra * 1000, 10_000) : 3000;
        console.warn(`[${tag}] HTTP 429 — backing off ${waitMs}ms`);
        await sleep(waitMs);
        const res2 = await fetch(a.url, {
          headers: { ...headersBase, ...a.headers },
          signal: AbortSignal.timeout(REDDIT_TIMEOUT_MS),
        });
        if (res2.ok) return await res2.text();
        console.warn(`[${tag}] HTTP ${res2.status} after back-off${more}`);
        continue;
      }
      if (res.ok) return await res.text();
      console.warn(`[${tag}] HTTP ${res.status}${more}`);
    } catch (err) {
      console.warn(`[${tag}] ${err.message}${more}`);
    }
  }
  return null;
}

// Parse a Reddit Atom feed into a flat array of entries. Each entry carries
// its kind ("t3" = post, "t1" = comment), title, link, plain-text body, and a
// parsed date. The `<content type="html">` payload is escaped HTML, so we
// convert block-level tags to newlines (preserving the line structure that
// harvestRedditCodes relies on) and load it back through cheerio for text.
function parseRedditFeed(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const entries = [];
  $("entry").each((_, e) => {
    const $e = $(e);
    const fullId = $e.find("id").first().text().trim();
    const kind = fullId.split("_")[0] || "";
    const contentHtml = $e.find("content").first().text();
    let body = "";
    if (contentHtml) {
      const withBreaks = contentHtml
        .replace(/<\/(p|div|li|h[1-6]|blockquote|tr|table)>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n");
      body = cheerio.load(withBreaks).root().text();
    }
    const pub = $e.find("published").first().text() || $e.find("updated").first().text();
    const date = pub ? new Date(pub) : null;
    entries.push({
      id: fullId.replace(/^t\d_/, ""),
      kind,
      title: normalizeText($e.find("title").first().text()),
      link: $e.find("link").first().attr("href") || "",
      body,
      date: date && !Number.isNaN(date.getTime()) ? date : null,
    });
  });
  return entries;
}

async function fetchRedditActive(game) {
  const subs = REDDIT_SUBS[game.slug];
  if (!subs || !subs.length) return [];
  const tag = `reddit-${game.slug}`;

  // Discover across every configured sub. `search.rss` is the default surface:
  // it catches "[Code] X.Y Livestream", "Active Codes Compilation", etc. and is
  // currently much less rate-limited than /new.rss. /new can be enabled locally
  // with REDDIT_INCLUDE_NEW=1 when debugging fresh submissions.
  const feedJobs = [];
  for (const sub of subs) {
    const searchPath = `/r/${sub}/search.rss?q=${encodeURIComponent("code OR redeem OR livestream")}&restrict_sr=on&sort=new&t=month&limit=${REDDIT_LISTING_LIMIT}`;
    feedJobs.push(
      fetchRedditRss(searchPath, `${tag}-${sub}-search`).then((xml) => ({ sub, xml, requireKeyword: false, applyAgeCutoff: false })),
    );
    if (REDDIT_INCLUDE_NEW) {
      const newPath = `/r/${sub}/new.rss?limit=${REDDIT_LISTING_LIMIT}`;
      feedJobs.push(
        fetchRedditRss(newPath, `${tag}-${sub}-new`).then((xml) => ({ sub, xml, requireKeyword: true, applyAgeCutoff: true })),
      );
    }
  }
  const feeds = await Promise.all(feedJobs);
  if (feeds.every((f) => !f.xml)) return null;

  const ageCutoffMs = Date.now() - REDDIT_NEW_POST_MAX_AGE_HOURS * 3600 * 1000;
  const posts = new Map();   // post_id → entry (carries its source sub)
  for (const { sub, xml, requireKeyword, applyAgeCutoff } of feeds) {
    if (!xml) continue;
    for (const e of parseRedditFeed(xml)) {
      if (e.kind !== "t3") continue;
      if (requireKeyword && !REDDIT_TITLE_KEYWORD_RE.test(e.title)) continue;
      if (applyAgeCutoff && e.date && e.date.getTime() < ageCutoffMs) continue;
      if (!posts.has(e.id)) posts.set(e.id, { ...e, sub });
    }
  }

  // byCode: upper-cased code → candidate with a cross-body `mentions` tally.
  const byCode = new Map();

  // Cap targets so we don't burn the rate limit on noisy subs; newest first.
  const sortedPosts = [...posts.values()]
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
    .slice(0, REDDIT_MAX_TARGETS_PER_GAME);

  for (const post of sortedPosts) {
    // Skip invite/return-event or CN/China-server threads outright — their body
    // and comments are wall-to-wall referral codes / non-Global codes.
    if (REDDIT_INVITE_CONTEXT_RE.test(post.title)) {
      console.log(`[${tag}] skipping invite/return-event post: ${post.title.slice(0, 80)}`);
      continue;
    }
    if (isCnContext(post.title)) {
      console.log(`[${tag}] skipping CN/region post: ${post.title.slice(0, 80)}`);
      continue;
    }
    const permalink = post.link || `https://www.reddit.com/r/${post.sub}/comments/${post.id}/`;
    const postedAt = post.date ?? new Date();
    // Scan the post body (self-text). Link posts have no body — harmless.
    const bodyCandidateCount = byCode.size;
    harvestRedditCodes(post.body, postedAt, permalink, byCode);
    const foundInBody = byCode.size > bodyCandidateCount;

    // Only dig into comments when the title looks code-related — most code
    // drops live in a pinned comment under a "Livestream"/"Codes" post. If the
    // listing body already carried candidates, skip comments; comment RSS is the
    // next most common 429 source and usually adds no value for body code posts.
    if (foundInBody || !REDDIT_COMMENT_KEYWORD_RE.test(post.title)) continue;
    let commentPath;
    try {
      commentPath = new URL(permalink).pathname.replace(/\/$/, "");
    } catch {
      commentPath = `/r/${post.sub}/comments/${post.id}`;
    }
    const commentXml = await fetchRedditRss(`${commentPath}/.rss?sort=top&limit=200`, `${tag}-comments-${post.id}`);
    if (!commentXml) continue;
    for (const c of parseRedditFeed(commentXml)) {
      if (c.kind !== "t1" || !c.body) continue;
      // Only scan comments that mention a code-ish keyword or carry a long
      // ALLCAPS run. Skips chit-chat.
      if (!REDDIT_COMMENT_KEYWORD_RE.test(c.body) && !/[A-Z0-9]{8,}/.test(c.body)) continue;
      harvestRedditCodes(c.body, c.date ?? postedAt, c.link || permalink, byCode);
    }
  }

  const out = [...byCode.values()];
  console.log(`[${tag}] ${out.length} candidate code(s) from ${sortedPosts.length}/${posts.size} post(s) across ${subs.length} sub(s)`);
  return out;
}

// ---- expired sources (table-driven) ----------------------------------------

async function fetchExpiredFromFandom(slug) {
  const cfg = EXPIRED_CONFIG[slug]?.fandom;
  if (!cfg) return new Set();
  const tag = `${slug}-fandom`;
  const url = `${cfg.url}?` + new URLSearchParams({
    action: "parse", page: cfg.page, prop: "text",
    format: "json", disabletoc: "1", disableeditsection: "1",
  });
  const r = await fetchWithRetry(url, { headers: JSON_HEADERS, tag, responseType: "json" });
  if (!r.ok) { console.warn(`[${tag}] ${r.error}`); return new Set(); }
  const json = r.json;
  const html = json?.parse?.text?.["*"] || "";
  if (!html) { console.warn(`[${tag}] empty response`); return new Set(); }

  const $ = cheerio.load(html);
  const expired = new Set();
  $("table.wikitable tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (!cells.length) return;
    if (cfg.mode === "class-on-last-td" && !cells.last().hasClass(cfg.className)) return;
    const code = normalizeText(cells.first().find("code").text() || cells.first().text());
    if (code && /^[A-Za-z0-9]{4,20}$/.test(code)) expired.add(code);
  });
  console.log(`[${tag}] ${expired.size} expired codes`);
  return expired;
}

async function fetchExpiredFromGame8(slug) {
  const cfg = EXPIRED_CONFIG[slug]?.game8;
  if (!cfg) return new Set();
  const tag = `${slug}-game8`;
  const r = await fetchWithRetry(cfg.url, { tag });
  if (!r.ok) { console.warn(`[${tag}] ${r.error}`); return new Set(); }
  const html = r.text;
  const $ = cheerio.load(html);
  const expired = new Set();

  const expiredHeading = $("h2, h3, h4").filter((_, el) => /expired/i.test($(el).text())).first();
  if (!expiredHeading.length) {
    console.warn(`[${tag}] no Expired heading found`);
    return expired;
  }
  let el = expiredHeading.next();
  while (el.length && !el.is("h2, h3, h4")) {
    if (cfg.mode === "table") {
      const table = el.is("table") ? el : el.find("table").first();
      if (table.length) {
        table.find("tr").each((_, tr) => {
          const code = normalizeText($(tr).find("td").first().text());
          if (code && /^[A-Za-z0-9]{4,20}$/.test(code)) expired.add(code);
        });
      }
    } else if (cfg.mode === "strong") {
      el.find("strong").addBack("strong").each((_, strong) => {
        const code = normalizeText($(strong).text());
        if (code && /^[A-Za-z0-9]{4,20}$/.test(code)) expired.add(code);
      });
    }
    el = el.next();
  }
  console.log(`[${tag}] ${expired.size} expired codes`);
  return expired;
}

async function fetchExpiredAll(slug) {
  const [fandom, game8] = await Promise.all([
    fetchExpiredFromFandom(slug),
    fetchExpiredFromGame8(slug),
  ]);
  for (const c of game8) fandom.add(c);
  return fandom;
}

// ---- per-game pipeline ------------------------------------------------------

async function processGame(game, prevGame, options = {}) {
  const redditTargets = new Set(options.redditGames || []);
  const skipRedditForGame = options.skipReddit || (redditTargets.size > 0 && !redditTargets.has(game.slug));
  // All sources for a game run concurrently. Reddit returns null only when
  // both subreddit fetches fail; otherwise it returns its candidate list
  // (which goes through the same expired-prune + dedupe as everything else).
  const tasks = [
    fetchNexusActive(game),               // null on failure
    game.slug === "wuwa" ? Promise.resolve(null) : fetchCrimsonwitchActive(game.slug), // null on failure / disabled source
    options.skipExpired ? Promise.resolve(new Set()) : fetchExpiredAll(game.slug),
    skipRedditForGame ? Promise.resolve([]) : fetchRedditActive(game), // null on failure, [] on no codes
    fetchHoyoCodes(game),                 // null on failure, [] when game not covered
  ];
  if (game.slug === "wuwa") tasks.push(fetchGame8WuwaActive());

  const [nexus, cw, expired, redditRaw, hoyo, game8Wuwa = []] = await Promise.all(tasks);

  // Reddit carry-forward: GitHub Actions runners are 403'd by Reddit's
  // unauth API, so the hourly CI run can't refresh Reddit-sourced codes.
  // When the fetch fails entirely (null), preserve any Reddit-sourced
  // codes from the previous file so they don't disappear from live until
  // an authoritative source picks them up. Subject to the same age cutoff
  // and expired-list prune via `consume()` downstream.
  let reddit = redditRaw;
  if (redditRaw === null && prevGame?.codes?.length) {
    const carried = prevGame.codes.filter((c) =>
      typeof c.sourceUrl === "string" && /reddit\.com/.test(c.sourceUrl)
    );
    if (carried.length) {
      console.log(`[reddit-${game.slug}] carrying forward ${carried.length} code(s) from previous file (live fetch failed)`);
      reddit = carried;
    }
  }

  // Crimsonwitch authority rule: a code we've ever seen on crimsonwitch.com
  // disappears = it's expired. Build the "currently on crimsonwitch" and
  // "ever seen on crimsonwitch" sets (case-folded) plus the region-lock and
  // hard-expiry sets crimsonwitch now exposes. code_variants are folded in as
  // aliases so a code and its alternate string share identity.
  const cwOk = cw !== null;
  const cwArr = cwOk ? cw : [];
  const cwCurrent = new Set();
  const cwRegionLocked = new Set();   // codeKey → non-Global, drop entirely
  const cwExpires = new Map();        // codeKey → ISO expiry
  for (const e of cwArr) {
    for (const k of [codeKey(e.code), ...(e.variants || []).map(codeKey)]) {
      cwCurrent.add(k);
      if (e.regionLocked) cwRegionLocked.add(k);
      if (e.expires) cwExpires.set(k, e.expires);
    }
  }
  const cwHistorical = new Set(
    (prevGame?.codes || []).filter((c) => c.cwSeen).map((c) => codeKey(c.code))
  );
  // Expired tables (fandom/game8), folded for case-insensitive matching.
  const expiredKeys = new Set([...(expired || [])].map(codeKey));

  // Codes hoyo-codes verified as redeemable this run. These are provably not
  // broken referral codes, so they're exempt from the referral-flood burst guard
  // (a genuine referral flood won't validate on a global account, so it isn't
  // here). Built from the raw result so it's independent of dedupe order.
  const hoyoVerifiedKeys = new Set((Array.isArray(hoyo) ? hoyo : []).map((e) => codeKey(e.code)));

  const seen = new Set();
  const merged = [];
  const now = Date.now();

  const consume = (entries) => {
    if (!entries) return;
    for (const e of entries) {
      if (!e || !e.code) continue;
      const key = codeKey(e.code);
      if (IGNORED_CODES.has(e.code)) continue;
      // Region-locked (crimsonwitch's authoritative region_locked) — never works
      // on Global, so drop on every path even if another source also lists it.
      if (cwRegionLocked.has(key)) {
        console.log(`[${game.slug}] dropped region-locked code ${e.code}`);
        continue;
      }
      // CN/China-server context in the reward text — fallback for sources that
      // don't tag region (Reddit/game8/nexus).
      if (isCnContext(e.rewards)) {
        console.log(`[${game.slug}] dropped CN-context code ${e.code}`);
        continue;
      }
      // Return-event referral codes (GUNSXVJX2K, GEJE24ZY2K, …): drop by shape
      // regardless of source/context. Catches the ones that slip past the
      // reward-context invite filter below because they're listed bare.
      // REVIEWED_CODES is the manual override for a false positive.
      if (isInviteShapedCode(game.slug, e.code) && !REVIEWED_CODES.has(e.code)) {
        console.log(`[${game.slug}] dropped invite-shaped code ${e.code}`);
        continue;
      }
      // Belt-and-suspenders: drop any code whose reward text gives away an
      // invite/return-event origin. Catches reward-bearing referral codes on
      // every path, including Reddit carry-forward from a stale prev file.
      if (REDDIT_INVITE_CONTEXT_RE.test(e.rewards || "")) continue;
      const added = new Date(e.added);
      if (Number.isNaN(added.getTime())) continue;
      // Hard expiry from crimsonwitch's `expires` field — more precise than the
      // age cutoff (catches codes that expire inside the 28-day window).
      const cwExp = cwExpires.get(key);
      if (cwExp && new Date(cwExp).getTime() < now) continue;
      const { premium, premium100 } = classifyPremium(e.rewards);
      // Livestream-style codes get a stricter 72h cutoff; everything else 28d.
      if (premium100) {
        if (now - added.getTime() > PREMIUM100_TTL_MS) continue;
      } else if (!isRecent(added)) continue;
      if (expiredKeys.has(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      const cwSeen = cwCurrent.has(key) || cwHistorical.has(key);
      merged.push({ ...e, premium, premium100, cwSeen });
    }
  };
  consume(nexus);
  consume(cwArr);
  consume(game8Wuwa);
  // hoyo-codes before Reddit: it's authoritative (redemption-verified), so a
  // Reddit code it also lists wins the dedupe with a non-reddit sourceUrl and is
  // thereby corroborated (no longer "Reddit-only").
  consume(hoyo);
  // Active-only watch mode is intentionally non-destructive. Preserve previous
  // live records before Reddit so an already-published authoritative record
  // (for example Game8-backed WuWa livestream codes) cannot be downgraded to a
  // Reddit-only review item when the active source misses a run.
  if (options.preserveMissing) consume(prevGame?.codes);
  // Reddit last so authoritative sources win the dedupe (date + rewards).
  // Reddit-only codes still survive — they just lose the metadata race.
  consume(reddit);
  // Active-only removals are left to the full refresh that also checks expired
  // source tables and is less vulnerable to a single active source returning an
  // empty/stale edge cache.

  // Apply crimsonwitch authority prune: if we've seen this code on cw before
  // (or this run picked it up there) and the current cw fetch doesn't list
  // it, it's expired. Skipped when the cw fetch failed.
  let kept = merged;
  if (cwOk) {
    const before = kept.length;
    kept = kept.filter((c) => !c.cwSeen || cwCurrent.has(codeKey(c.code)));
    const dropped = before - kept.length;
    if (dropped > 0) console.log(`[crimsonwitch-${game.slug}] pruned ${dropped} code(s) no longer on crimsonwitch`);
  }

  // ---- confidence gate (Reddit-only codes) --------------------------------
  // A code still carrying a reddit.com sourceUrl after the merge was discovered
  // ONLY on Reddit (no authoritative source — nexus/crimsonwitch/game8/hoyo-codes
  // — claimed it). Such a code auto-publishes only if it (a) names a real reward
  // and (b) was seen in ≥2 independent posts/comments; otherwise it's held for
  // review (released via REVIEWED_CODES). Codes already published in the previous
  // file are exempt so we never retroactively yank a live code (this also
  // preserves the Reddit carry-forward behaviour on a failed fetch).
  const prevLiveKeys = new Set((prevGame?.codes || []).map((c) => codeKey(c.code)));
  const gateHeldKeys = classifyRedditOnlyHolds(kept, { slug: game.slug, prevLiveKeys });
  for (const c of kept) {
    if (gateHeldKeys.has(codeKey(c.code))) console.log(`[${game.slug}] holding Reddit-only code ${c.code}: ${c.reviewReason}`);
  }

  kept.sort((a, b) =>
    new Date(b.added) - new Date(a.added) || a.code.localeCompare(b.code));

  // ---- first-seen tracking + burst guard ----------------------------------
  // Stamp each surviving code with the moment WE first saw it (carried from the
  // previous file across both live and held lists, so a code's age in our index
  // is stable run-to-run). `added` is the source's publish date and can't be
  // trusted for "is this a sudden flood" — firstSeen can.
  const prevFirstSeen = new Map();
  const prevHeld = new Set();
  for (const c of prevGame?.codes || []) {
    if (c.code) prevFirstSeen.set(codeKey(c.code), c.firstSeen || c.added);
  }
  for (const c of prevGame?.review?.codes || []) {
    if (!c.code) continue;
    prevFirstSeen.set(codeKey(c.code), c.firstSeen || c.added);
    prevHeld.add(codeKey(c.code)); // already quarantined last run → keep it quarantined
  }
  const nowIso = new Date().toISOString();
  for (const c of kept) c.firstSeen = prevFirstSeen.get(codeKey(c.code)) || nowIso;

  // A flood = MORE than BURST_THRESHOLD non-allowlisted codes first seen inside
  // the window. When that trips, hold every recent code; established codes
  // (older than the window) keep publishing normally. Codes held on a previous
  // run stay held until the operator allowlists them (REVIEWED_CODES) or they
  // age off the sources entirely — so a quarantined flood never silently
  // auto-publishes once it slides past the 24h mark.
  const burstFloor = Date.now() - BURST_WINDOW_MS;
  const isRecentFirstSeen = (c) => new Date(c.firstSeen).getTime() >= burstFloor;
  // hoyo-verified codes don't count toward a "flood" (they're proven redeemable,
  // not referral codes), so a legit batch surfacing at once can't trip the guard.
  const recent = kept.filter((c) =>
    !REVIEWED_CODES.has(c.code) && isRecentFirstSeen(c) && !hoyoVerifiedKeys.has(codeKey(c.code)));
  const burst = recent.length > BURST_THRESHOLD;

  const liveCodes = [];
  const heldCodes = [];
  for (const c of kept) {
    const key = codeKey(c.code);
    // Verified-redeemable codes are never burst-held, and a previously-held code
    // that hoyo now verifies is released. Likewise, a previously-held Reddit
    // candidate is released once a non-Reddit source corroborates it with useful
    // metadata; otherwise one weak Reddit pass can quarantine a real code
    // forever even after Game8/Nexus catches up.
    const stillHeldFromEarlier = prevHeld.has(key) && !isAuthoritativeSource(c.sourceUrl);
    const hold = !REVIEWED_CODES.has(c.code) && !hoyoVerifiedKeys.has(key) &&
      (stillHeldFromEarlier ||     // quarantined on a previous run and still Reddit-only
        gateHeldKeys.has(key) ||   // failed the Reddit-only confidence gate
        (burst && isRecentFirstSeen(c)));   // caught in a sudden flood
    (hold ? heldCodes : liveCodes).push(c);
  }

  let review = null;
  if (heldCodes.length) {
    const gateHeldCount = heldCodes.filter((c) => gateHeldKeys.has(codeKey(c.code))).length;
    const reasonParts = [];
    if (burst) reasonParts.push(`possible referral/invite flood (${recent.length} first seen in 24h, threshold ${BURST_THRESHOLD})`);
    if (gateHeldCount) reasonParts.push(`${gateHeldCount} unconfirmed Reddit-only code(s)`);
    if (!reasonParts.length) reasonParts.push("held from an earlier run");
    review = {
      reason: `${heldCodes.length} ${game.name} code(s) held for review: ${reasonParts.join("; ")}. Confirm legit ones in REVIEWED_CODES to publish.`,
      detectedAt: nowIso,
      codes: heldCodes,
    };
    console.warn(`[review-${game.slug}] ${review.reason}`);
    console.warn(`[review-${game.slug}] held: ${heldCodes.map((c) => c.code).join(", ")}`);
  }

  return {
    slug: game.slug,
    name: game.name,
    icon: game.icon,
    redeemBase: game.redeemBase,
    note: game.note,
    sourceUrl: game.nexusUrl,
    // Flips to null when the primary source fails this run; main() carries
    // forward the last good value from the existing JSON.
    lastSuccessfulFetch: nexus !== null ? new Date().toISOString() : null,
    codes: liveCodes,
    ...(review ? { review } : {}),
  };
}

// ---- main -------------------------------------------------------------------

async function main(options = CLI_OPTIONS) {
  console.log(`Cutoff: codes added in the last ${MAX_AGE_DAYS} days (livestream/100-premium: 72h)`);
  if (options.activeOnly) {
    const reddit = options.skipReddit
      ? "skipped"
      : options.redditGames?.length
        ? `enabled for ${options.redditGames.join(",")}`
        : "enabled";
    console.log(`Mode: active-only (expired-table sweeps skipped, Reddit ${reddit})`);
  }
  if (options.changeGated) console.log("Mode: change-gated (timestamp-only changes will not rewrite codes.json)");

  // Load existing JSON up front so processGame can read prev cwSeen flags.
  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(OUTPUT, "utf8")); } catch {}
  const prevBySlug = existing?.games
    ? Object.fromEntries(existing.games.map(g => [g.slug, g]))
    : {};

  const games = await Promise.all(
    SOURCES.map((s) => processGame(s, prevBySlug[s.slug], options))
  );
  for (const g of games) {
    const status = g.lastSuccessfulFetch ? "ok" : "primary-failed";
    console.log(`[${g.slug}] ${g.codes.length} codes (${status})`);
  }

  // Carry forward lastSuccessfulFetch for sources whose primary failed.
  for (const g of games) {
    if (g.lastSuccessfulFetch === null) {
      g.lastSuccessfulFetch = prevBySlug[g.slug]?.lastSuccessfulFetch || null;
    }
  }

  // Always write — generatedAt should reflect the actual hourly check, not
  // just the last code change. The workflow's `git diff --staged --quiet`
  // still skips commits when the file content is byte-identical (which won't
  // happen in practice now that generatedAt is fresh, so the workflow will
  // commit hourly).
  const payload = {
    generatedAt: new Date().toISOString(),
    maxAgeDays: MAX_AGE_DAYS,
    games,
  };

  if (options.changeGated && existing) {
    const diff = diffSemanticCodes(existing, payload);
    if (!diff.changed) {
      console.log("No semantic code changes; leaving Database/Codes/codes.json unchanged.");
      return;
    }
    console.log("Semantic code changes detected:");
    for (const line of diff.summary) console.log(`  ${line}`);
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2));
  console.log(`Saved ${OUTPUT}`);
}

// Run only when invoked directly; when required (tests) just expose the
// internals so the pure heuristics can be exercised without the network.
if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = {
  processGame,
  parseCrimsonwitchPayload,
  normalizeRegionLocked,
  parseCodeVariants,
  harvestRedditCodes,
  classifyRedditOnlyHolds,
  isCnContext,
  isAuthoritativeSource,
  isInviteShapedCode,
  classifyPremium,
  parseCliOptions,
  parseGameList,
  codeKey,
  CN_CONTEXT_RE,
  REDDIT_SUBS,
  HOYO_CODES_GAME,
};
