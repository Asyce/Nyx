#!/usr/bin/env node
'use strict';

const fs = require('fs');

function codeKey(code) {
  return String(code || '').toUpperCase();
}

function normalizeCodeEntry(entry) {
  return {
    code: entry.code || '',
    key: codeKey(entry.code),
    rewards: entry.rewards || '',
    added: entry.added || '',
    sourceUrl: entry.sourceUrl || '',
    premium: !!entry.premium,
    premium100: !!entry.premium100,
    cwSeen: !!entry.cwSeen,
    regionLocked: entry.regionLocked ?? null,
    expires: entry.expires ?? null,
    variants: Array.isArray(entry.variants) ? entry.variants.map(String).sort() : [],
  };
}

function normalizeCodeList(list) {
  return (Array.isArray(list) ? list : [])
    .map(normalizeCodeEntry)
    .sort((a, b) => a.key.localeCompare(b.key));
}

function semanticSnapshot(payload) {
  const games = Array.isArray(payload?.games) ? payload.games : [];
  return games
    .map((game) => ({
      slug: game.slug || '',
      codes: normalizeCodeList(game.codes),
      review: normalizeCodeList(game.review?.codes),
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function stableJson(value) {
  return JSON.stringify(value, null, 2);
}

function entryMap(entries) {
  return new Map((entries || []).map((entry) => [entry.key, entry]));
}

function summarizeListDiff(beforeEntries, afterEntries, label) {
  const before = entryMap(beforeEntries);
  const after = entryMap(afterEntries);
  const out = [];

  for (const [key, entry] of after) {
    if (!before.has(key)) out.push(`${label} +${entry.code || key}`);
    else if (stableJson(before.get(key)) !== stableJson(entry)) out.push(`${label} ~${entry.code || key}`);
  }
  for (const [key, entry] of before) {
    if (!after.has(key)) out.push(`${label} -${entry.code || key}`);
  }
  return out;
}

function diffSemanticCodes(beforePayload, afterPayload) {
  const before = semanticSnapshot(beforePayload);
  const after = semanticSnapshot(afterPayload);
  const changed = stableJson(before) !== stableJson(after);
  if (!changed) return { changed: false, summary: [] };

  const beforeGames = new Map(before.map((game) => [game.slug, game]));
  const afterGames = new Map(after.map((game) => [game.slug, game]));
  const slugs = [...new Set([...beforeGames.keys(), ...afterGames.keys()])].sort();
  const summary = [];

  for (const slug of slugs) {
    const b = beforeGames.get(slug) || { codes: [], review: [] };
    const a = afterGames.get(slug) || { codes: [], review: [] };
    summary.push(...summarizeListDiff(b.codes, a.codes, `${slug}:live`));
    summary.push(...summarizeListDiff(b.review, a.review, `${slug}:review`));
  }

  return { changed: true, summary };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main(argv = process.argv.slice(2)) {
  const [beforeFile, afterFile] = argv;
  if (!beforeFile || !afterFile) {
    console.error('Usage: node ./codes/semantic-diff.cjs BEFORE.json AFTER.json');
    process.exit(2);
  }

  const diff = diffSemanticCodes(readJson(beforeFile), readJson(afterFile));
  if (!diff.changed) {
    console.log('No semantic code changes.');
    return;
  }

  console.log('Semantic code changes:');
  for (const line of diff.summary) console.log(`  ${line}`);
  process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  codeKey,
  semanticSnapshot,
  diffSemanticCodes,
};
