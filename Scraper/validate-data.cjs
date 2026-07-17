#!/usr/bin/env node
'use strict';
// ============================================================
// Pre-commit / CI gate for freshly-scraped data.
//
// Runs against the REAL Database/Banners/banners.json and
// Database/Codes/codes.json (not fixtures). Exits non-zero on structural
// failure so the scheduled workflow refuses to commit/deploy broken data and
// the last-known-good (already committed + already live) is preserved.
//
// It does NOT fail merely because a game is 'unavailable' — that can be
// legitimately true (e.g. Endfield with no announced banner). It fails on hard
// problems: unparseable JSON, an empty game list (total scrape collapse), or
// malformed entries (a featured character with no name, a code with no code).
// ============================================================

const fs = require('fs');
const path = require('path');
const { reflowBannerGroup } = require('./banners/normalize.cjs');

const root = path.join(__dirname, '..');
const errors = [];
const diagnostics = [];
const strictFreshness = process.argv.includes('--strict-freshness') ||
  String(process.env.NYX_STRICT_BANNER_FRESHNESS || '').toLowerCase() === 'true';
const strictAllowed = new Set(['fresh', 'transition']);
const strictOptionalGames = new Set(['endfield']);

function load(rel) {
  const p = path.join(root, 'Database', rel);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    errors.push(`Cannot read/parse ${rel}: ${e.message}`);
    return null;
  }
}

// ---- banners ----
const banners = load('Banners/banners.json');
if (banners) {
  const games = banners.games || [];
  if (!games.length) errors.push('banners.json has zero games (total scrape collapse?)');
  const now = Date.now();
  for (const g of games) {
    const r = reflowBannerGroup(g, now);
    const phases = [r.current, r.next, ...(r.upcoming || [])].filter(Boolean);
    const allChars = phases.flatMap((p) => p.characters || []);
    const nameless = allChars.filter((c) => !c || !c.name).length;
    if (nameless) errors.push(`banners[${g.id || g.name}]: ${nameless} featured character(s) missing a name`);
    if (strictFreshness && !strictAllowed.has(r.freshness.status) && !strictOptionalGames.has(String(g.id || g.name).toLowerCase())) {
      errors.push(`banners[${g.id || g.name}]: freshness is ${r.freshness.status}; expected fresh or transition`);
    }
    diagnostics.push(
      `banner ${String(g.id || g.name).padEnd(9)} ${r.freshness.status.padEnd(12)}` +
        ` current=${r.current ? r.current.characters.length : 0}` +
        ` next=${r.next ? r.next.characters.length : 0}` +
        ` upcoming=${(r.upcoming || []).length}`
    );
  }
}

// ---- codes ----
const codes = load('Codes/codes.json');
if (codes) {
  const games = codes.games || [];
  if (!games.length) errors.push('codes.json has zero games (total scrape collapse?)');
  for (const g of games) {
    let bad = 0;
    for (const c of g.codes || []) if (!c || !c.code) bad += 1;
    if (bad) errors.push(`codes[${g.slug || g.name}]: ${bad} entr(y/ies) with no code`);
    diagnostics.push(`codes  ${String(g.slug || g.name).padEnd(9)} ${(g.codes || []).length} code(s)`);
  }
}

// ---- EndfieldWiki operator/weapon materials ----
const endfieldCharacters = load('EndfieldWiki/endfield/characters.json');
const endfieldItemsPayload = load('EndfieldWiki/endfield/items.json');
const endfieldWeaponsPayload = load('EndfieldWiki/endfield/weapons.json');
if (endfieldCharacters) {
  if (!Array.isArray(endfieldCharacters) || !endfieldCharacters.length) {
    errors.push('EndfieldWiki/endfield/characters.json has zero operators');
  } else {
    const missingMats = endfieldCharacters.filter((ch) => !ch?.materials?.ascension?.length || !ch?.materials?.skill?.length);
    if (missingMats.length) {
      errors.push(`endfield materials: ${missingMats.length} operator(s) missing ascension or skill materials: ${missingMats.slice(0, 8).map((ch) => ch.name || ch.id).join(', ')}`);
    }
    diagnostics.push(`endfld operators ${endfieldCharacters.length} (${endfieldCharacters.length - missingMats.length} with material tables)`);
  }
}
if (endfieldItemsPayload && endfieldCharacters) {
  const items = endfieldItemsPayload.items || {};
  const missingItems = [];
  const referenced = new Set();
  for (const ch of endfieldCharacters || []) {
    for (const mat of [...(ch.materials?.ascension || []), ...(ch.materials?.skill || [])]) {
      if (!mat?.id) continue;
      referenced.add(mat.id);
      if (!items[mat.id]) missingItems.push(`${ch.name || ch.id}:${mat.id}`);
    }
  }
  const missingIcons = [...referenced]
    .map((id) => items[id])
    .filter((item) => item && !item.icon?.path);
  if (missingItems.length) errors.push(`endfield items: ${missingItems.length} referenced material id(s) missing metadata, first: ${missingItems.slice(0, 8).join(', ')}`);
  if (missingIcons.length) errors.push(`endfield items: ${missingIcons.length} referenced material item(s) missing local icon paths`);
  diagnostics.push(`endfld items     ${Object.keys(items).length} item(s), ${referenced.size} referenced by operators`);
}
if (endfieldWeaponsPayload) {
  const weapons = endfieldWeaponsPayload.weapons || [];
  const missingTuning = weapons.filter((weapon) => !weapon?.materials?.length || !weapon?.tuningStages?.length);
  if (!weapons.length) errors.push('EndfieldWiki/endfield/weapons.json has zero weapons');
  if (missingTuning.length) errors.push(`endfield weapons: ${missingTuning.length} weapon(s) missing tuning materials`);
  diagnostics.push(`endfld weapons   ${weapons.length} (${weapons.length - missingTuning.length} with tuning tables)`);
}

// ---- canonical banner history + sourced activities ----
const historyMinimums = { gi:280, hsr:210, zzz:120, wuwa:160, ae:25 };
for (const [game, minimum] of Object.entries(historyMinimums)) {
  const payload = load(`BannerHistory/${game}.json`);
  if (!payload) continue;
  const rows = payload.records;
  if (payload.schemaVersion !== 1 || payload.game !== game || !Array.isArray(rows) || rows.length < minimum) {
    errors.push(`banner history ${game}: expected schema v1 and at least ${minimum} records`);
    continue;
  }
  const byId = new Map();
  for (const row of rows) {
    if (!row?.id || byId.has(row.id)) errors.push(`banner history ${game}: empty/duplicate id ${row?.id}`);
    byId.set(row?.id, row);
    if (!['character','weapon','mixed'].includes(row?.bannerType) || !row?.source?.url || row?.source?.revision === undefined || !Array.isArray(row?.featured)) errors.push(`banner history ${game}: malformed ${row?.id}`);
    const windows = Object.entries(row?.windowsByRegion || {});
    if (!row?.permanent && !windows.length && !/^\d{4}-\d{2}-\d{2}$/.test(row?.dateOnly?.start || '')) errors.push(`banner history ${game}: ${row?.id} has no sourced time/date`);
    for (const [region, window] of windows) if (!['global','asia','europe','america'].includes(region) || !window?.sourceUrl || !Number.isFinite(Date.parse(window?.start)) || (window?.end && Date.parse(window.end) <= Date.parse(window.start))) errors.push(`banner history ${game}: bad ${region} window on ${row?.id}`);
  }
  for (const row of rows) for (const pairId of row.pairedBannerIds || []) {
    const other = byId.get(pairId);
    const sameWindow = other && Object.keys(row.windowsByRegion || {}).some((region) => other.windowsByRegion?.[region]?.start === row.windowsByRegion[region].start && other.windowsByRegion?.[region]?.end === row.windowsByRegion[region].end);
    if (!other || (!sameWindow && !(row.pairSourceUrl && row.pairSourceUrl === other.pairSourceUrl))) errors.push(`banner history ${game}: invalid pair ${row.id} -> ${pairId}`);
  }
  diagnostics.push(`history ${game.padEnd(5)} ${rows.length} record(s), ${rows.filter((row) => row.confirmed).length} confirmed`);
}
for (const [game, minimum] of Object.entries({ gi:2, hsr:3, zzz:2, wuwa:1 })) {
  const payload = load(`Activities/${game}.json`);
  if (!payload) continue;
  if (payload.schemaVersion !== 1 || payload.game !== game || !Array.isArray(payload.activities) || payload.activities.length < minimum) errors.push(`activities ${game}: invalid schema/count (minimum ${minimum})`);
  for (const row of payload.activities || []) {
    if (!row?.id || !['fixed','dated'].includes(row.mode) || !row.sourceUrl || !Number.isFinite(Date.parse(row.verifiedAt))) errors.push(`activities ${game}: malformed ${row?.id}`);
  if (row.mode === 'dated' && (
    !Array.isArray(row.windows)
    || !row.windows.length
    || row.windows.some((window) => {
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(window.dateStart || '') && /^\d{4}-\d{2}-\d{2}$/.test(window.dateEnd || '') && window.dateEnd > window.dateStart && window.source?.url;
      const regional = Object.values(window.windowsByRegion || {});
      return !dateOnly && (!regional.length || regional.some((part) => !part.start || !part.end || part.end <= part.start || !part.sourceUrl));
    })
    || row.windows.some((window) => window.status && !['exact','expected'].includes(window.status))
  )) errors.push(`activities ${game}: invalid dated windows on ${row?.id}`);
  }
  diagnostics.push(`activity ${game.padEnd(5)} ${(payload.activities || []).length} definition(s)`);
}

// ---- in-game events pipeline (Database/Events/<game>.json) ----
// Structural gate mirroring the other datasets. Empty is tolerated (a quiet game
// can legitimately have no announced events); malformed entries fail the gate.
const EVENT_TYPES = new Set(['event', 'banner', 'web_event', 'login', 'challenge', 'shop', 'permanent']);
const EVENT_CONFIDENCE = new Set(['high', 'medium', 'low']);
const EVENT_PERMANENCE = new Set(['permanent', 'timed', 'unknown']);
const EVENT_GAMES = ['gi', 'hsr', 'zzz', 'wuwa', 'endfield'];
const EVENT_LOCAL_IMAGE = /^\/assets\/[a-z0-9][a-z0-9._/-]*\.(?:avif|jpe?g|png|webp)$/i;
for (const game of EVENT_GAMES) {
  const payload = load(`Events/${game}.json`);
  if (!payload) continue;
  if (payload.schemaVersion !== 1 || payload.game !== game || !Array.isArray(payload.events)) {
    errors.push(`events ${game}: invalid schema/envelope`);
    continue;
  }
  const ids = new Set();
  let review = 0;
  let banners = 0;
  for (const e of payload.events) {
    if (!e?.id || ids.has(e.id)) errors.push(`events ${game}: empty/duplicate id ${e?.id}`);
    ids.add(e?.id);
    if (!e?.title || !EVENT_TYPES.has(e?.type) || !EVENT_CONFIDENCE.has(e?.confidence) || !EVENT_PERMANENCE.has(e?.permanence) || typeof e?.needs_review !== 'boolean') {
      errors.push(`events ${game}: malformed ${e?.id}`);
    }
    if (!e?.source?.name || !e?.source?.url || typeof e?.source?.priority !== 'number') errors.push(`events ${game}: bad source on ${e?.id}`);
    if (!e?.source?.kind || !e?.source?.recordId) errors.push(`events ${game}: missing source provenance on ${e?.id}`);
    if (!e?.source?.fetchedAt || !Number.isFinite(Date.parse(e.source.fetchedAt))) errors.push(`events ${game}: bad source fetchedAt on ${e?.id}`);
    if (e?.image !== null && e?.image !== undefined && (!EVENT_LOCAL_IMAGE.test(e.image) || String(e.image).includes('..'))) errors.push(`events ${game}: remote/unsafe image on ${e?.id}`);
    if (!['exact','expected'].includes(e?.scheduleStatus)) errors.push(`events ${game}: bad schedule status on ${e?.id}`);
    if (e?.scheduleStatus === 'exact' && e?.permanence !== 'permanent' && !e?.start) errors.push(`events ${game}: exact schedule missing start on ${e?.id}`);
    for (const bound of ['start', 'end']) {
      if (e?.[bound] !== null && !Number.isFinite(Date.parse(e?.[bound]))) errors.push(`events ${game}: bad ${bound} on ${e?.id}`);
    }
    if (e?.start && e?.end && Date.parse(e.end) <= Date.parse(e.start)) errors.push(`events ${game}: end<=start on ${e?.id}`);
    for (const [region, window] of Object.entries(e?.windowsByRegion || {})) {
      if (!['global','asia','europe','america'].includes(region) || !window?.sourceUrl || !Number.isFinite(Date.parse(window?.start)) || (window?.end && Date.parse(window.end) <= Date.parse(window.start))) errors.push(`events ${game}: bad ${region} window on ${e?.id}`);
    }
    // A non-review, non-permanent event must carry a real start anchor (no guessed dates).
    if (e && !e.needs_review && e.permanence !== 'permanent' && !e.start) errors.push(`events ${game}: dated event missing start on ${e?.id}`);
    if (e?.needs_review) review += 1;
    if (e?.type === 'banner') banners += 1;
  }
  diagnostics.push(`events  ${game.padEnd(9)} ${payload.events.length} event(s), ${review} needs_review, ${banners} banner-tagged`);
}

const eventCoverage = load('Events/manifest.json');
if (eventCoverage) {
  if (eventCoverage.schemaVersion !== 1 || !Number.isFinite(Date.parse(eventCoverage.generatedAt)) || !Array.isArray(eventCoverage.games)) errors.push('events coverage: invalid envelope');
  const covered = new Set();
  for (const row of eventCoverage.games || []) {
    if (!['gi','hsr','zzz','wuwa','endfield'].includes(row?.game) || covered.has(row.game)) errors.push(`events coverage: invalid/duplicate ${row?.game}`);
    covered.add(row?.game);
    if (!['complete-for-source','partial','stale'].includes(row?.status) || !row?.source?.name || !row?.source?.endpoint || !Number.isInteger(row?.pagesFetched) || row.pagesFetched < 0 || !Number.isInteger(row?.fetchedRecords) || row.fetchedRecords < 0) errors.push(`events coverage: malformed ${row?.game}`);
    if (row?.status === 'complete-for-source' && !row.exhausted) errors.push(`events coverage: false completion ${row?.game}`);
  }
  if (covered.size !== 5) errors.push(`events coverage: expected 5 games, found ${covered.size}`);
  diagnostics.push(`events coverage ${covered.size} game(s), ${(eventCoverage.games || []).filter((row) => row.status === 'complete-for-source').length} source-complete`);
}

const eventHistoryState = load('Events/history-state.json');
if (eventHistoryState) {
  const keys = Object.keys(eventHistoryState.games || {}).sort();
  if (eventHistoryState.schemaVersion !== 1 || keys.join(',') !== [...EVENT_GAMES].sort().join(',')) errors.push('events history state: invalid envelope/game set');
  for (const game of EVENT_GAMES) {
    const row = eventHistoryState.games?.[game];
    if (!row || !Array.isArray(row.completedIds) || row.completedIds.some((id) => typeof id !== 'string' || !id.trim()) || (row.resumeCursor !== null && typeof row.resumeCursor !== 'string') || typeof row.exhausted !== 'boolean' || (row.updatedAt !== null && !Number.isFinite(Date.parse(row.updatedAt)))) errors.push(`events history state: malformed ${game}`);
  }
}

console.log('--- data validation diagnostics ---');
for (const d of diagnostics) console.log('  ' + d);

if (errors.length) {
  console.error('\nVALIDATION FAILED:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('\nData validation passed.');
