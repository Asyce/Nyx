// ============================================================
// Events pipeline orchestrator.
// Fetches all 5 games' official announcement feeds, extracts events
// deterministically, dedupes, merges over last-known-good (so ended events
// accumulate into history and a transient outage never wipes data), validates,
// and writes Database/Events/<game>.json.
//
// A per-game source failure is contained: it logs a ::warning:: and carries
// the previous dataset forward. It never crashes the pipeline or the gate.
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAMES, dedupe, mergeById, validateDataset } from './core.mjs';
import { SOURCE_META, scrapeEndfield, scrapeHoyo, scrapeWuwa } from './sources.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.resolve(root, 'Database/Events');

async function readJson(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; } }

async function writeIfChanged(file, value) {
  const text = JSON.stringify(value, null, 2) + '\n';
  const current = await fs.readFile(file, 'utf8').catch(() => null);
  // Ignore generatedAt churn so an unchanged scrape doesn't rewrite the file.
  const strip = (t) => (t || '').replace(/"generatedAt":\s*"[^"]*"/g, '"generatedAt":""');
  if (current !== null && strip(current) === strip(text)) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, text);
  JSON.parse(await fs.readFile(tmp, 'utf8'));
  await fs.rename(tmp, file);
  return true;
}

async function scrapeGame(game) {
  if (game === 'wuwa') return scrapeWuwa();
  if (game === 'endfield') return scrapeEndfield();
  return scrapeHoyo(game);
}

export async function run() {
  const generatedAt = new Date().toISOString();
  const written = [];
  const report = [];

  for (const game of GAMES) {
    const file = path.join(outDir, `${game}.json`);
    const previous = await readJson(file);
    const previousEvents = Array.isArray(previous?.events) ? previous.events : [];

    let result;
    try {
      result = await scrapeGame(game);
    } catch (error) {
      // Total source failure: carry forward last-known-good, never crash.
      console.warn(`::warning::events ${game} scrape failed: ${error.message}; carrying forward ${previousEvents.length} events`);
      result = { events: [], anomaly: `scrape error: ${error.message}`, fetched: 0 };
    }

    if (result.anomaly) console.warn(`::warning::events ${game} anomaly: ${result.anomaly}`);

    const fresh = dedupe(result.events);
    // On anomaly with zero fresh events, keep previous untouched (carry-forward).
    const merged = fresh.length ? mergeById(previousEvents, fresh) : previousEvents;

    const dataset = {
      schemaVersion: 1,
      game,
      generatedAt,
      source: SOURCE_META[game],
      counts: {
        total: merged.length,
        needs_review: merged.filter((e) => e.needs_review).length,
        banner: merged.filter((e) => e.type === 'banner').length,
        byType: merged.reduce((acc, e) => { acc[e.type] = (acc[e.type] || 0) + 1; return acc; }, {}),
      },
      events: merged,
    };

    const errs = validateDataset(dataset);
    if (errs.length) {
      // Refuse to write a malformed dataset; keep last-known-good on disk.
      console.error(`::error::events ${game} dataset invalid: ${errs.slice(0, 5).join('; ')}`);
      report.push({ game, fetched: result.fetched, total: merged.length, needs_review: dataset.counts.needs_review, wrote: false, anomaly: result.anomaly || `INVALID: ${errs.length} errors` });
      continue;
    }

    const wrote = await writeIfChanged(file, dataset);
    if (wrote) written.push(path.relative(root, file));
    report.push({ game, fetched: result.fetched, total: merged.length, needs_review: dataset.counts.needs_review, banner: dataset.counts.banner, wrote, anomaly: result.anomaly || null });
  }

  console.log('--- events pipeline ---');
  for (const r of report) {
    console.log(`  ${r.game.padEnd(9)} fetched=${String(r.fetched).padStart(3)} total=${String(r.total).padStart(4)} needs_review=${String(r.needs_review).padStart(3)} banners=${String(r.banner ?? 0).padStart(3)} wrote=${r.wrote}${r.anomaly ? ` anomaly=${r.anomaly}` : ''}`);
  }
  console.log(`Events: ${written.length} file(s) changed`);
  return { report, written };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => { console.error(error?.stack || error); process.exit(1); });
}
