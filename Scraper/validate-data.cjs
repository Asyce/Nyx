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

console.log('--- data validation diagnostics ---');
for (const d of diagnostics) console.log('  ' + d);

if (errors.length) {
  console.error('\nVALIDATION FAILED:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('\nData validation passed.');
