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
import { GAMES, dedupe, mergeById, normalizeRetainedEvent, reconcileById, replaceExpectedWithExact, validateDataset } from './core.mjs';
import { SOURCE_META, isSourceEventRecord, scrapeEndfield, scrapeHoyo, scrapeWuwa } from './sources.mjs';
import { buildCoverageEntry, validateCoverageManifest, validateHistoryState } from './history.mjs';
import { reconcileActivityWindows, validateActivityFile } from '../banner-history/activities.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.resolve(root, 'Database/Events');
const coverageFile = path.join(outDir, 'manifest.json');
const stateFile = path.join(outDir, 'history-state.json');
const activityDir = path.resolve(root, 'Database/Activities');

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

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive:true });
  const next = `${file}.${process.pid}.next`;
  await fs.writeFile(next, JSON.stringify(value, null, 2) + '\n');
  JSON.parse(await fs.readFile(next, 'utf8'));
  await fs.rename(next, file);
}

function cleanHistoryState(value) {
  const games = {};
  for (const game of GAMES) {
    const row = value?.games?.[game] || {};
    games[game] = {
      completedIds:[...new Set((row.completedIds || []).map(String))].slice(-20_000),
      resumeCursor:row.resumeCursor ?? null,
      exhausted:Boolean(row.exhausted),
      updatedAt:Number.isFinite(Date.parse(row.updatedAt)) ? row.updatedAt : null,
    };
  }
  return { schemaVersion:1, games };
}

async function scrapeGame(game, historyState, persistCheckpoint) {
  const row = historyState.games[game];
  if (game === 'wuwa') return scrapeWuwa({
    limit:Math.max(1, Math.min(500, Number(process.env.NYX_EVENTS_HISTORY_BATCH) || 80)),
    completedIds:row.completedIds,
    resumeCursor:row.resumeCursor,
    onCheckpoint:(checkpoint) => persistCheckpoint(game, checkpoint),
  });
  if (game === 'endfield') return scrapeEndfield({
    pages:Math.max(1, Math.min(100, Number(process.env.NYX_EVENTS_HISTORY_PAGES) || 50)),
    startPage:Number.isInteger(Number(row.resumeCursor)) && Number(row.resumeCursor) > 1 ? Number(row.resumeCursor) : 1,
    completedIds:row.completedIds,
    onCheckpoint:(checkpoint) => persistCheckpoint(game, checkpoint),
  });
  return scrapeHoyo(game);
}

function exactActivityWindow(event) {
  const windowsByRegion = {};
  for (const [region, window] of Object.entries(event?.windowsByRegion || {})) {
    if (window?.start && window?.end && Date.parse(window.end) > Date.parse(window.start)) windowsByRegion[region] = { start:window.start, end:window.end, timezone:window.timezone || event.timezone, sourceUrl:window.sourceUrl || event.source.url };
  }
  if (!Object.keys(windowsByRegion).length && event?.start && event?.end) {
    const region = ['asia','europe','america','global'].includes(event.server) ? event.server : 'global';
    windowsByRegion[region] = { start:event.start, end:event.end, timezone:event.timezone, sourceUrl:event.source.url };
  }
  if (!Object.keys(windowsByRegion).length) return null;
  return { id:event.id, status:'exact', windowsByRegion, source:{ url:event.source.url, kind:event.source.kind || 'official-feed', fetchedAt:event.source.fetchedAt || null } };
}

async function syncGenshinActivities(events, generatedAt) {
  const file = path.join(activityDir, 'gi.json');
  const current = await readJson(file);
  if (!current?.activities) return false;
  const exact = events.filter((event) => /stygian onslaught/i.test(event.title || '') && event.scheduleStatus === 'exact').map(exactActivityWindow).filter(Boolean);
  if (!exact.length) return false;
  const activities = [...current.activities];
  const index = activities.findIndex((row) => row.id === 'gi-stygian-onslaught');
  const previous = index >= 0 ? activities[index] : null;
  const row = {
    id:'gi-stygian-onslaught', label:'Stygian Onslaught', mode:'dated', resetHour:4, timezoneMode:'server-fixed', exceptions:[],
    windows:reconcileActivityWindows(previous?.windows || [], exact),
    sourceUrl:[...exact].sort((left, right) => {
      const first = (item) => Object.values(item.windowsByRegion || {}).map((window) => window.start).filter(Boolean).sort()[0] || '';
      return first(right).localeCompare(first(left));
    })[0].source.url,
    verifiedAt:generatedAt,
  };
  if (index >= 0) activities[index] = row; else activities.push(row);
  const candidate = { ...current, dataTimestamp:generatedAt, activities };
  validateActivityFile(candidate);
  return writeIfChanged(file, candidate);
}

export async function run() {
  const generatedAt = new Date().toISOString();
  const written = [];
  const report = [];
  const historyState = cleanHistoryState(await readJson(stateFile));
  const previousCoverage = await readJson(coverageFile);
  const coverageGames = [];
  // Scraper checkpoints stay in memory until the matching dataset validates and
  // writes. A crash may repeat work, but can never skip rows that were not saved.
  const stagedCheckpoints = new Map();
  const persistCheckpoint = async (game, checkpoint) => { stagedCheckpoints.set(game, checkpoint); };

  for (const game of GAMES) {
    const file = path.join(outDir, `${game}.json`);
    const previous = await readJson(file);
    const previousEvents = Array.isArray(previous?.events)
      ? previous.events.map((event) => normalizeRetainedEvent(event, previous?.generatedAt))
      : [];

    let result;
    try {
      result = await scrapeGame(game, historyState, persistCheckpoint);
    } catch (error) {
      // Total source failure: carry forward last-known-good, never crash.
      console.warn(`::warning::events ${game} scrape failed: ${error.message}; carrying forward ${previousEvents.length} events`);
      result = { events: [], anomaly: `scrape error: ${error.message}`, fetched: 0, pagesFetched:0, pageLimit:0, exhausted:false, resumeCursor:historyState.games[game].resumeCursor, stale:true, gaps:['The source failed; last-known-good records were retained.'] };
    }

    if (result.anomaly) console.warn(`::warning::events ${game} anomaly: ${result.anomaly}`);

    const fresh = dedupe(result.events);
    // A complete successful snapshot reconciles current/future rows while
    // retaining ended history. Any anomaly is non-destructive: retain every
    // previous row and overlay whatever fresh rows were safely parsed.
    const merged = result.anomaly || result.reconcile === false
      ? replaceExpectedWithExact(mergeById(previousEvents, fresh))
      : reconcileById(previousEvents, fresh, Date.now(), (ev) => isSourceEventRecord(game, ev));

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
    coverageGames.push(buildCoverageEntry({ game, source:SOURCE_META[game], fetchedAt:generatedAt, result, events:merged, previousCount:previousEvents.length }));
    historyState.games[game] = {
      ...historyState.games[game],
      completedIds:result.completedIds || stagedCheckpoints.get(game)?.completedIds || historyState.games[game].completedIds,
      resumeCursor:result.resumeCursor ?? stagedCheckpoints.get(game)?.resumeCursor ?? null,
      exhausted:Boolean(result.exhausted),
      updatedAt:generatedAt,
    };
  }

  for (const game of GAMES) if (!coverageGames.some((row) => row.game === game)) {
    const prior = previousCoverage?.games?.find?.((row) => row.game === game);
    coverageGames.push(prior ? { ...prior, status:'stale', fetchedAt:generatedAt, anomaly:'Candidate dataset failed validation; previous coverage retained.' } : buildCoverageEntry({ game, source:SOURCE_META[game], fetchedAt:generatedAt, result:{ stale:true, anomaly:'Candidate dataset failed validation.', exhausted:false }, events:[] }));
  }
  const coverage = { schemaVersion:1, generatedAt, games:coverageGames.sort((a, b) => GAMES.indexOf(a.game) - GAMES.indexOf(b.game)) };
  const coverageErrors = validateCoverageManifest(coverage);
  if (coverageErrors.length) throw new Error(`Event coverage invalid: ${coverageErrors.join('; ')}`);
  if (await writeIfChanged(coverageFile, coverage)) written.push(path.relative(root, coverageFile));
  const historyStateErrors = validateHistoryState(historyState);
  if (historyStateErrors.length) throw new Error(`Event history state invalid: ${historyStateErrors.join('; ')}`);
  await writeJsonAtomic(stateFile, historyState);
  const giDataset = await readJson(path.join(outDir, 'gi.json'));
  if (await syncGenshinActivities(giDataset?.events || [], generatedAt)) written.push('Database/Activities/gi.json');

  console.log('--- events pipeline ---');
  for (const r of report) {
    console.log(`  ${r.game.padEnd(9)} fetched=${String(r.fetched).padStart(3)} total=${String(r.total).padStart(4)} needs_review=${String(r.needs_review).padStart(3)} banners=${String(r.banner ?? 0).padStart(3)} wrote=${r.wrote}${r.anomaly ? ` anomaly=${r.anomaly}` : ''}`);
  }
  console.log(`Events: ${written.length} file(s) changed`);
  return { report, written, coverage };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => { console.error(error?.stack || error); process.exit(1); });
}
