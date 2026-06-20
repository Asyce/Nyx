#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

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
  const html = r.text;
  const entries = [];

  // Concatenate every Flight payload string body.
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let combined = "";
  let m;
  while ((m = re.exec(html)) !== null) {
    try { combined += JSON.parse('"' + m[1] + '"'); } catch {}
  }

  const idx = combined.indexOf('"initialCodes":[');
  if (idx < 0) {
    console.warn(`[${tag}] initialCodes not found in payload`);
    return null; // can't trust this run for prune-by-absence
  }
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

  let arr;
  try { arr = JSON.parse(combined.slice(start, end)); }
  catch (err) { console.warn(`[${tag}] JSON parse failed: ${err.message}`); return null; }

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
    entries.push({ code, rewards, added: toIsoDate(added), sourceUrl: url });
  }
  return entries;
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

const REDDIT_SUBS = {
  genshin: "Genshin_Impact",
  hsr:     "HonkaiStarRail",
  zzz:     "ZZZ_Official",
  wuwa:    "WutheringWaves",
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

function harvestRedditCodes(rawText, postedAt, sourceUrl, out, seen) {
  if (!rawText) return;
  const text = stripRedditNoise(rawText);
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
      // Drop all-lowercase tokens outright ("version7", "patch52", prose) —
      // real codes are upper or mixed-case.
      if (code === code.toLowerCase()) continue;
      // Letter-only candidates (no digit) are the danger zone: real WuWa drops
      // (STRANGEVISITORS / BEYONDTHEDOOR / SAYCHEESE) are letter-only ALLCAPS,
      // but so is shouty prose ("…ALIEN COMPUTERS AND SHIT and honestly…").
      // Require the token to stand alone as a code, not sit inside a running
      // sentence:
      //   • reject Title-case-no-digit words ("Preview", "Broadcast"); and
      //   • accept ALLCAPS-no-digit only when the line is essentially just
      //     code(s) (≤2 chars of other text) or is a short reward/redeem line
      //     (≤40 chars of prose). A reward keyword buried in a long paragraph
      //     ("Fate/Extra…" trips `fates?`) no longer qualifies.
      // Digit-bearing codes are unambiguous and skip this gate entirely.
      if (!/\d/.test(code)) {
        if (code !== code.toUpperCase()) continue;
        if (lineProseLen > 2 && !(lineHasReward && lineProseLen <= 40)) continue;
      }
      if (REDDIT_STOPWORDS.has(code.toLowerCase())) continue;
      // Drop codes whose own line or sticky header is invite/return-event
      // context — personal referral codes masquerading as redemption codes.
      if (REDDIT_INVITE_CONTEXT_RE.test(line) ||
          (lastHeader && REDDIT_INVITE_CONTEXT_RE.test(lastHeader))) continue;
      if (seen.has(code)) continue;
      seen.add(code);
      let rewards = extractRedditReward(line, code);
      // Fallback: code is alone on its line under a "<Reward> Codes:" header.
      if (!rewards && lastHeader && REDDIT_REWARD_CONTEXT_RE.test(lastHeader)) {
        rewards = lastHeader;
      }
      out.push({ code, rewards, added: toIsoDate(postedAt), sourceUrl });
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
  const sub = REDDIT_SUBS[game.slug];
  if (!sub) return [];
  const tag = `reddit-${game.slug}`;

  // Two discovery surfaces, run in parallel:
  //   1. Subreddit search (last month) for code-drop keywords — catches
  //      "[Code] X.Y Livestream", "Active Codes Compilation", etc.
  //   2. /new — catches very recent posts the search index may not have
  //      picked up yet (Reddit search lags ~10–30 min behind submission).
  const searchPath = `/r/${sub}/search.rss?q=${encodeURIComponent("code OR redeem OR livestream")}&restrict_sr=on&sort=new&t=month&limit=${REDDIT_LISTING_LIMIT}`;
  const newPath = `/r/${sub}/new.rss?limit=${REDDIT_LISTING_LIMIT}`;
  const [searchXml, newXml] = await Promise.all([
    fetchRedditRss(searchPath, `${tag}-search`),
    fetchRedditRss(newPath, `${tag}-new`),
  ]);
  if (!searchXml && !newXml) return null;

  const ageCutoffMs = Date.now() - REDDIT_NEW_POST_MAX_AGE_HOURS * 3600 * 1000;
  const posts = new Map();   // post_id → entry

  const addPosts = (xml, requireKeyword, applyAgeCutoff) => {
    if (!xml) return;
    for (const e of parseRedditFeed(xml)) {
      if (e.kind !== "t3") continue;
      if (requireKeyword && !REDDIT_TITLE_KEYWORD_RE.test(e.title)) continue;
      if (applyAgeCutoff && e.date && e.date.getTime() < ageCutoffMs) continue;
      if (!posts.has(e.id)) posts.set(e.id, e);
    }
  };

  // Search results already matched the query, so no extra keyword/age filter.
  addPosts(searchXml, false, false);
  // /new: title must match keyword AND post must be within the age window.
  addPosts(newXml, true, true);

  const out = [];
  const seen = new Set();

  // Cap targets so we don't burn the rate limit on noisy subs; newest first.
  const sortedPosts = [...posts.values()]
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
    .slice(0, REDDIT_MAX_TARGETS_PER_GAME);

  for (const post of sortedPosts) {
    // Skip invite/return-event threads outright — their body and comments are
    // wall-to-wall personal referral codes, not redemption codes.
    if (REDDIT_INVITE_CONTEXT_RE.test(post.title)) {
      console.log(`[${tag}] skipping invite/return-event post: ${post.title.slice(0, 80)}`);
      continue;
    }
    const permalink = post.link || `https://www.reddit.com/r/${sub}/comments/${post.id}/`;
    const postedAt = post.date ?? new Date();
    // Scan the post body (self-text). Link posts have no body — harmless.
    harvestRedditCodes(post.body, postedAt, permalink, out, seen);

    // Only dig into comments when the title looks code-related — most code
    // drops live in a pinned comment under a "Livestream"/"Codes" post.
    if (!REDDIT_COMMENT_KEYWORD_RE.test(post.title)) continue;
    let commentPath;
    try {
      commentPath = new URL(permalink).pathname.replace(/\/$/, "");
    } catch {
      commentPath = `/r/${sub}/comments/${post.id}`;
    }
    const commentXml = await fetchRedditRss(`${commentPath}/.rss?sort=top&limit=200`, `${tag}-comments-${post.id}`);
    if (!commentXml) continue;
    for (const c of parseRedditFeed(commentXml)) {
      if (c.kind !== "t1" || !c.body) continue;
      // Only scan comments that mention a code-ish keyword or carry a long
      // ALLCAPS run. Skips chit-chat.
      if (!REDDIT_COMMENT_KEYWORD_RE.test(c.body) && !/[A-Z0-9]{8,}/.test(c.body)) continue;
      harvestRedditCodes(c.body, c.date ?? postedAt, c.link || permalink, out, seen);
    }
  }

  console.log(`[${tag}] ${out.length} candidate code(s) from ${sortedPosts.length}/${posts.size} post(s)`);
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

async function processGame(game, prevGame) {
  // All sources for a game run concurrently. Reddit returns null only when
  // both subreddit fetches fail; otherwise it returns its candidate list
  // (which goes through the same expired-prune + dedupe as everything else).
  const tasks = [
    fetchNexusActive(game),               // null on failure
    fetchCrimsonwitchActive(game.slug),   // null on failure
    fetchExpiredAll(game.slug),
    fetchRedditActive(game),              // null on failure, [] on no codes
  ];
  if (game.slug === "wuwa") tasks.push(fetchGame8WuwaActive());

  const [nexus, cw, expired, redditRaw, game8Wuwa = []] = await Promise.all(tasks);

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
  // "ever seen on crimsonwitch" sets so we can prune confidently.
  const cwOk = cw !== null;
  const cwArr = cwOk ? cw : [];
  const cwCurrent = new Set(cwArr.map((e) => e.code));
  const cwHistorical = new Set(
    (prevGame?.codes || []).filter((c) => c.cwSeen).map((c) => c.code)
  );

  const seen = new Set();
  const merged = [];
  const now = Date.now();

  const consume = (entries) => {
    if (!entries) return;
    for (const e of entries) {
      if (!e || !e.code) continue;
      if (IGNORED_CODES.has(e.code)) continue;
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
      const { premium, premium100 } = classifyPremium(e.rewards);
      // Livestream-style codes get a stricter 72h cutoff; everything else 28d.
      if (premium100) {
        if (now - added.getTime() > PREMIUM100_TTL_MS) continue;
      } else if (!isRecent(added)) continue;
      if (expired.has(e.code)) continue;
      if (seen.has(e.code)) continue;
      seen.add(e.code);
      const cwSeen = cwCurrent.has(e.code) || cwHistorical.has(e.code);
      merged.push({ ...e, premium, premium100, cwSeen });
    }
  };
  consume(nexus);
  consume(cwArr);
  consume(game8Wuwa);
  // Reddit last so authoritative sources win the dedupe (date + rewards).
  // Reddit-only codes still survive — they just lose the metadata race.
  consume(reddit);

  // Apply crimsonwitch authority prune: if we've seen this code on cw before
  // (or this run picked it up there) and the current cw fetch doesn't list
  // it, it's expired. Skipped when the cw fetch failed.
  let kept = merged;
  if (cwOk) {
    const before = kept.length;
    kept = kept.filter((c) => !c.cwSeen || cwCurrent.has(c.code));
    const dropped = before - kept.length;
    if (dropped > 0) console.log(`[crimsonwitch-${game.slug}] pruned ${dropped} code(s) no longer on crimsonwitch`);
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
    if (c.code) prevFirstSeen.set(c.code, c.firstSeen || c.added);
  }
  for (const c of prevGame?.review?.codes || []) {
    if (!c.code) continue;
    prevFirstSeen.set(c.code, c.firstSeen || c.added);
    prevHeld.add(c.code); // already quarantined last run → keep it quarantined
  }
  const nowIso = new Date().toISOString();
  for (const c of kept) c.firstSeen = prevFirstSeen.get(c.code) || nowIso;

  // A flood = MORE than BURST_THRESHOLD non-allowlisted codes first seen inside
  // the window. When that trips, hold every recent code; established codes
  // (older than the window) keep publishing normally. Codes held on a previous
  // run stay held until the operator allowlists them (REVIEWED_CODES) or they
  // age off the sources entirely — so a quarantined flood never silently
  // auto-publishes once it slides past the 24h mark.
  const burstFloor = Date.now() - BURST_WINDOW_MS;
  const isRecentFirstSeen = (c) => new Date(c.firstSeen).getTime() >= burstFloor;
  const recent = kept.filter((c) => !REVIEWED_CODES.has(c.code) && isRecentFirstSeen(c));
  const burst = recent.length > BURST_THRESHOLD;

  const liveCodes = [];
  const heldCodes = [];
  for (const c of kept) {
    const hold = !REVIEWED_CODES.has(c.code) &&
      (prevHeld.has(c.code) || (burst && isRecentFirstSeen(c)));
    (hold ? heldCodes : liveCodes).push(c);
  }

  let review = null;
  if (heldCodes.length) {
    review = {
      reason: burst
        ? `Possible referral/invite-code flood: ${recent.length} ${game.name} codes first seen in 24h (threshold ${BURST_THRESHOLD}). Held for review — confirm legit ones in REVIEWED_CODES to publish.`
        : `${heldCodes.length} ${game.name} code(s) held from an earlier burst, pending review.`,
      detectedAt: nowIso,
      codes: heldCodes,
    };
    console.warn(`[burst-${game.slug}] ${review.reason}`);
    console.warn(`[burst-${game.slug}] held: ${heldCodes.map((c) => c.code).join(", ")}`);
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

async function main() {
  console.log(`Cutoff: codes added in the last ${MAX_AGE_DAYS} days (livestream/100-premium: 72h)`);

  // Load existing JSON up front so processGame can read prev cwSeen flags.
  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(OUTPUT, "utf8")); } catch {}
  const prevBySlug = existing?.games
    ? Object.fromEntries(existing.games.map(g => [g.slug, g]))
    : {};

  const games = await Promise.all(
    SOURCES.map((s) => processGame(s, prevBySlug[s.slug]))
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
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2));
  console.log(`Saved ${OUTPUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
