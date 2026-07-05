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

console.log('--- data validation diagnostics ---');
for (const d of diagnostics) console.log('  ' + d);

if (errors.length) {
  console.error('\nVALIDATION FAILED:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('\nData validation passed.');
