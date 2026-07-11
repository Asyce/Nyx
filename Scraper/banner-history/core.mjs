import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const GAMES = ['gi', 'hsr', 'zzz', 'wuwa', 'ae'];
export const REGION_KEYS = new Set(['global', 'asia', 'europe', 'america']);

export function slug(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function stableId(record) {
  const windows = record.windowsByRegion || {};
  const first = windows.asia || windows.global || Object.entries(windows).sort(([a], [b]) => a.localeCompare(b))[0]?.[1];
  const start = first?.start || 'permanent';
  return [record.game, record.bannerType, record.category, slug(record.name), slug(start)].join(':');
}

export function templateBlock(text, templateName, from = 0) {
  const needle = `{{${templateName}`;
  const start = text.toLowerCase().indexOf(needle.toLowerCase(), from);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length - 1; i += 1) {
    const pair = text.slice(i, i + 2);
    if (pair === '{{') { depth += 1; i += 1; }
    else if (pair === '}}') { depth -= 1; i += 1; if (depth === 0) return { text:text.slice(start, i + 1), start, end:i + 1 }; }
  }
  throw new Error(`Unclosed template ${templateName}`);
}

export function templateBlocks(text, templateName) {
  const rows = [];
  let cursor = 0;
  while (cursor < text.length) {
    const block = templateBlock(text, templateName, cursor);
    if (!block) break;
    rows.push(block);
    cursor = block.end;
  }
  return rows;
}

export function templateFields(block) {
  const fields = {};
  const firstPipe = block.indexOf('|');
  if (firstPipe < 0) return fields;
  const body = block.slice(firstPipe + 1, -2).replace(/<!--[\s\S]*?-->/g, '');
  const tokens = []; let current = ''; let depth = 0;
  for (let index = 0; index < body.length; index += 1) {
    const pair = body.slice(index, index + 2);
    if (pair === '{{' || pair === '[[') { depth += 1; current += pair; index += 1; continue; }
    if (pair === '}}' || pair === ']]') { depth = Math.max(0, depth - 1); current += pair; index += 1; continue; }
    if (body[index] === '|' && depth === 0) { tokens.push(current); current = ''; } else current += body[index];
  }
  tokens.push(current);
  for (const token of tokens) {
    const equals = token.indexOf('=');
    if (equals > 0) fields[token.slice(0, equals).trim().toLowerCase()] = token.slice(equals + 1).trim();
  }
  return fields;
}

export function list(value) {
  return String(value || '').split(/\s*;\s*|\s*,\s*/).map((x) => x.trim()).filter(Boolean);
}

export function sourceUrl(host, title) {
  return `${host}/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/gi, '/')}`;
}

export function localIso(value, offset = '+08:00') {
  const match = String(value || '').trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const normalizedOffset = String(offset || '+08:00').replace(/^(?:GMT|UTC)/i, '').replace(/^([+-]\d{1,2})$/, '$1:00').replace(/^([+-])(\d):/, '$10$2:');
  const stamp = `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}T${match[4].padStart(2,'0')}:${match[5]}:${match[6] || '00'}${normalizedOffset}`;
  const parsed = new Date(stamp);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function windowFrom(fields, { start='time_start', end='time_end', offset='time_start_offset', defaultOffset='+08:00', source }) {
  const zone = fields[offset] || defaultOffset;
  const startIso = localIso(fields[start], zone);
  const endIso = localIso(fields[end], fields.time_end_offset || zone);
  if (!startIso) return null;
  const row = { start:startIso, timezone:String(zone).replace(/^GMT/i, 'UTC'), sourceUrl:source };
  if (endIso) row.end = endIso;
  return row;
}

export function sameRegionWindow(a, b) {
  return Object.keys(a.windowsByRegion || {}).some((region) => {
    const left = a.windowsByRegion[region];
    const right = b.windowsByRegion?.[region];
    return right && left.start === right.start && left.end === right.end;
  });
}

export function connectPairs(records) {
  const byTitle = new Map(records.map((row) => [row._title, row]));
  for (const row of records) {
    const linked = list(row._alongside).map((title) => byTitle.get(title)).filter(Boolean);
    row.pairedBannerIds = [...new Set(linked.filter((other) => other.bannerType !== row.bannerType && sameRegionWindow(row, other)).map((other) => other.id))].sort();
  }
  for (const row of records) { delete row._title; delete row._alongside; }
  return records;
}

export function validateRecord(record) {
  if (!record || !GAMES.includes(record.game) || !['character','weapon','mixed'].includes(record.bannerType)) throw new Error(`Invalid banner identity: ${record?.id}`);
  if (!record.id || !record.name || !record.category || typeof record.permanent !== 'boolean') throw new Error(`Incomplete banner: ${record?.id}`);
  if (!record.source?.url || !record.source?.kind || record.source.revision === undefined) throw new Error(`Missing source: ${record.id}`);
  const windows = Object.entries(record.windowsByRegion || {});
  if (!record.permanent && !windows.length && !/^\d{4}-\d{2}-\d{2}$/.test(record.dateOnly?.start || '')) throw new Error(`Finite banner has no window or sourced date: ${record.id}`);
  for (const [region, window] of windows) {
    if (!REGION_KEYS.has(region) || !window?.start || !window.timezone || !window.sourceUrl) throw new Error(`Invalid regional window: ${record.id}/${region}`);
    if (!Number.isFinite(Date.parse(window.start)) || (window.end && (!Number.isFinite(Date.parse(window.end)) || Date.parse(window.end) <= Date.parse(window.start)))) throw new Error(`Invalid dates: ${record.id}/${region}`);
  }
  if (!Array.isArray(record.featured) || (!record.permanent && !record.featured.length)) throw new Error(`Missing featured entries: ${record.id}`);
  if (!Array.isArray(record.pairedBannerIds)) throw new Error(`Invalid pair list: ${record.id}`);
}

export function validateDataset(dataset) {
  if (dataset?.schemaVersion !== 1 || !GAMES.includes(dataset.game) || !Array.isArray(dataset.records) || !dataset.records.length) throw new Error(`Empty/invalid ${dataset?.game || 'unknown'} history`);
  const ids = new Set();
  for (const row of dataset.records) { validateRecord(row); if (ids.has(row.id)) throw new Error(`Duplicate banner id ${row.id}`); ids.add(row.id); }
  for (const row of dataset.records) for (const pair of row.pairedBannerIds) {
    const other = dataset.records.find((candidate) => candidate.id === pair);
    if (!other || (!sameRegionWindow(row, other) && !(row.pairSourceUrl && row.pairSourceUrl === other.pairSourceUrl))) throw new Error(`Invalid pair ${row.id} -> ${pair}`);
  }
  return dataset;
}

export function isOfficialWindowSource(url) {
  return Boolean(url) && !/(?:fandom\.com|wiki\.gg)/i.test(String(url));
}

// Carry officially-sourced regional windows and official evidence forward when a fresh
// scrape lost them (e.g. an official notice endpoint was transiently unreachable). Only
// preserves windows whose recorded source is an official host. Regional backfill runs
// per region even when the fresh candidate carries its own official source, because a
// notice can set officialSource yet fail to populate every region (unparseable window
// text); the per-region guard below never overwrites a fresh official window, so this
// only fills regions the candidate left non-official or absent. Never invents times: an
// omission is retained whenever no previously-sourced official window exists.
export function preserveOfficialWindows(previous, candidate) {
  if (previous?.schemaVersion !== 1 || candidate?.schemaVersion !== 1) return candidate;
  const priorById = new Map();
  for (const row of previous.records) {
    priorById.set(row.id, row);
    for (const legacy of row.legacyIds || []) if (!priorById.has(legacy)) priorById.set(legacy, row);
  }
  for (const row of candidate.records) {
    const prior = priorById.get(row.id) || (row.legacyIds || []).map((id) => priorById.get(id)).find(Boolean);
    if (!prior?.officialSource) continue;
    if (!row.officialSource) {
      row.officialSource = prior.officialSource;
      row.confirmed = true;
    }
    // A fresh official `global` window is authoritative for every region; preserving stale
    // per-region official windows beside it would let the UI (which prefers an exact region over
    // global) display the OLD dates, violating "fresher official data always wins". So when the
    // candidate already carries an official global window, do not backfill any per-region window.
    const candidateGlobal = row.windowsByRegion.global;
    const candidateHasOfficialGlobal = candidateGlobal && isOfficialWindowSource(candidateGlobal.sourceUrl);
    for (const [region, window] of Object.entries(prior.windowsByRegion || {})) {
      if (!isOfficialWindowSource(window.sourceUrl)) continue;
      if (candidateHasOfficialGlobal && region !== 'global') continue;
      const current = row.windowsByRegion[region];
      if (!current || !isOfficialWindowSource(current.sourceUrl)) row.windowsByRegion[region] = window;
    }
  }
  return candidate;
}

export function monotonicMerge(previous, candidate) {
  validateDataset(candidate);
  if (!previous) return candidate;
  validateDataset(previous);
  if (previous.game !== candidate.game) throw new Error('Dataset game changed');
  const fresh = new Map(candidate.records.map((row) => [row.id, row]));
  const migratedIds = new Set(candidate.records.flatMap((row) => row.legacyIds || []));
  // Any previously present record that is gone (and not renamed via legacyIds) is a removal.
  // The plan requires removals to become needs_review, never silent auto-deletes. A same-count
  // swap (drop one id, add another) passes the shrink check below, so removals must be detected
  // by identity — for unconfirmed rows too, not only confirmed ones.
  const missing = previous.records.filter((row) => !fresh.has(row.id) && !migratedIds.has(row.id));
  const lostConfirmed = missing.filter((row) => row.confirmed);
  if (lostConfirmed.length) throw new Error(`needs_review: ${previous.game} lost ${lostConfirmed.length} confirmed records: ${lostConfirmed.slice(0, 5).map((x) => x.id).join(', ')}`);
  if (missing.length) throw new Error(`needs_review: ${previous.game} lost ${missing.length} records: ${missing.slice(0, 5).map((x) => x.id).join(', ')}`);
  if (candidate.records.length < previous.records.length) throw new Error(`needs_review: ${previous.game} shrank ${previous.records.length} -> ${candidate.records.length}`);
  return candidate;
}

export function semantic(value) {
  if (Array.isArray(value)) return value.map(semantic);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['fetchedAt','generatedAt'].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, semantic(item)]));
  return value;
}

export function semanticHash(value) { return crypto.createHash('sha256').update(JSON.stringify(semantic(value))).digest('hex'); }

export async function atomicWriteJson(file, value) {
  const text = JSON.stringify(value, null, 2) + '\n';
  try { const current = JSON.parse(await fs.readFile(file, 'utf8')); if (semanticHash(current) === semanticHash(value)) return false; } catch {}
  await fs.mkdir(path.dirname(file), { recursive:true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, text);
  JSON.parse(await fs.readFile(temp, 'utf8'));
  await fs.rename(temp, file);
  return true;
}
