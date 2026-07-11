import fs from 'node:fs';
import path from 'node:path';

const SOURCE_ROUTES = [
  'https://gi.nanoka.cc/beyond/',
  'https://gi.nanoka.cc/beyond/inventory',
  'https://gi.nanoka.cc/beyond/set',
];
const MINIMUMS = { costumes: 500, items: 1200, suits: 150 };
const ASSET_CONCURRENCY = 24;
const TIMEOUT_MS = 20_000;

export function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

export function discoverPayloads(pages) {
  const found = new Map();
  const scriptRe = /<script[^>]*type="application\/json"[^>]*data-sveltekit-fetched[^>]*data-url="([^"]+)"[^>]*>([\s\S]*?)<\/script>/g;
  for (const html of pages) {
    for (const match of String(html || '').matchAll(scriptRe)) {
      const dataUrl = decodeHtmlEntities(match[1]);
      const file = dataUrl.match(/\/beyond\/(costume|item|costume_suit|lang_map)\.json$/i)?.[1];
      if (!file) continue;
      let wrapper;
      let body;
      try {
        wrapper = JSON.parse(decodeHtmlEntities(match[2]));
        body = JSON.parse(wrapper.body);
      } catch (error) {
        throw new Error(`Invalid embedded ${file}.json payload: ${error.message}`);
      }
      found.set(file, { dataUrl, body: assertRecord(body, `${file}.json`) });
    }
  }
  for (const file of ['costume', 'item', 'costume_suit', 'lang_map']) {
    if (!found.has(file)) throw new Error(`Missing embedded ${file}.json payload`);
  }
  const bases = new Set([...found.values()].map(({ dataUrl }) => dataUrl.replace(/\/beyond\/[^/]+\.json$/i, '')));
  if (bases.size !== 1) throw new Error('Wonderland payloads disagree on their versioned static base');
  const staticBase = [...bases][0];
  const version = staticBase.match(/\/gi\/([^/]+)\/en$/)?.[1];
  if (!version || !/^[0-9]+(?:\.[0-9]+)+$/.test(version)) throw new Error('Could not safely discover the Wonderland data version');
  return {
    version,
    staticBase,
    costumes: found.get('costume').body,
    items: found.get('item').body,
    suits: found.get('costume_suit').body,
    langMap: found.get('lang_map').body,
  };
}

function cleanText(value, max = 180) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function safeId(value) {
  const id = String(value || '');
  if (!/^[0-9]+$/.test(id)) throw new Error(`Unsafe Wonderland record id: ${id}`);
  return id;
}

function safeIcon(value) {
  if (value === undefined || value === null || value === '') return null;
  const icon = String(value).replace(/\.webp$/i, '');
  if (!/^[A-Za-z0-9_]+$/.test(icon)) throw new Error(`Unsafe Wonderland icon name: ${value}`);
  return icon;
}

function stringList(value) {
  return (Array.isArray(value) ? value : value ? [value] : []).map((row) => cleanText(row, 80)).filter(Boolean);
}

function normalizeRows(source, kind) {
  return Object.entries(source).map(([rawId, raw]) => {
    const id = safeId(rawId);
    const row = assertRecord(raw, `${kind} ${id}`);
    const fallback = kind === 'item' ? `Wonderland Item ${id}` : `Wonderland ${kind === 'suit' ? 'Set' : 'Costume'} ${id}`;
    const name = cleanText(row.name, 160);
    return {
      id,
      name: name || fallback,
      ...(name ? {} : { nameMissing: true }),
      rank: cleanText(row.rank, 40),
      icon: safeIcon(row.icon),
      ...(kind === 'item' ? { type: cleanText(row.type, 120) } : {
        body: stringList(row.body),
        color: stringList(row.color),
        ...(kind === 'costume' ? { slot: stringList(row.slot) } : {}),
      }),
    };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function normalizePayloads(discovered) {
  const langMap = assertRecord(discovered.langMap, 'lang_map.json');
  const slot = assertRecord(langMap.slot, 'lang_map.slot');
  const color = assertRecord(langMap.color, 'lang_map.color');
  const costumes = normalizeRows(discovered.costumes, 'costume');
  const items = normalizeRows(discovered.items, 'item');
  const suits = normalizeRows(discovered.suits, 'suit');
  for (const [key, rows] of Object.entries({ costumes, items, suits })) {
    if (rows.length < MINIMUMS[key]) throw new Error(`${key} count ${rows.length} is below safe minimum ${MINIMUMS[key]}`);
  }
  return {
    costumes,
    items,
    suits,
    langMap: {
      slot: Object.fromEntries(Object.entries(slot).map(([key, value]) => [cleanText(key, 80), cleanText(value, 80)]).filter(([key, value]) => key && value)),
      color: Object.fromEntries(Object.entries(color).map(([key, value]) => [cleanText(key, 80), cleanText(value, 80)]).filter(([key, value]) => key && value)),
    },
  };
}

function readPreviousCounts(outDir) {
  const counts = {};
  for (const key of ['costumes', 'items', 'suits']) {
    try {
      const value = JSON.parse(fs.readFileSync(path.resolve(outDir, `${key}.json`), 'utf8'));
      if (Array.isArray(value)) counts[key] = value.length;
    } catch { /* First run or a separately damaged copy: fixed minimums still apply. */ }
  }
  return counts;
}

export function enforceShrinkGuard(normalized, previousCounts) {
  for (const key of ['costumes', 'items', 'suits']) {
    const previous = Number(previousCounts[key] || 0);
    if (previous && normalized[key].length < Math.ceil(previous * 0.8)) {
      throw new Error(`${key} unexpectedly shrank from ${previous} to ${normalized[key].length} (80% guard)`);
    }
  }
}

async function fetchWithRetries(url, fetchImpl, kind = 'text') {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 Nyx Wonderland scraper' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return kind === 'buffer' ? Buffer.from(await response.arrayBuffer()) : response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError?.message || lastError}`);
}

function validWebp(buffer) {
  return buffer.length >= 16 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
}

async function mapLimit(entries, limit, mapper) {
  const out = new Array(entries.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, entries.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= entries.length) return;
      out[index] = await mapper(entries[index], index);
    }
  });
  // Let every in-flight writer settle before the caller removes a failed stage.
  // Promise.all would reject early while other workers were still touching it.
  const settled = await Promise.allSettled(workers);
  const failed = settled.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
  return out;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function swapDirectory(stageDir, outDir) {
  const backupDir = `${outDir}.backup-${process.pid}-${Date.now()}`;
  let movedOld = false;
  try {
    if (fs.existsSync(outDir)) {
      fs.renameSync(outDir, backupDir);
      movedOld = true;
    }
    fs.renameSync(stageDir, outDir);
    // The publish is complete. A locked backup must not turn a successful swap
    // into a false failure or trigger restoration over the new good data.
    if (movedOld) {
      try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch { /* harmless stale backup */ }
    }
  } catch (error) {
    if (!fs.existsSync(outDir) && movedOld && fs.existsSync(backupDir)) fs.renameSync(backupDir, outDir);
    throw error;
  }
}

export async function runWonderlandSync({ rootDir, fetchImpl = fetch, now = () => new Date() } = {}) {
  if (!rootDir) throw new Error('rootDir is required');
  const dbDir = path.resolve(rootDir, 'Database');
  const outDir = path.resolve(dbDir, 'GameData', 'gi', 'beyond');
  const stageDir = path.resolve(path.dirname(outDir), `.beyond-stage-${process.pid}-${Date.now()}`);
  const previousCounts = readPreviousCounts(outDir);
  try {
    const pages = await Promise.all(SOURCE_ROUTES.map((url) => fetchWithRetries(url, fetchImpl)));
    const discovered = discoverPayloads(pages);
    const normalized = normalizePayloads(discovered);
    enforceShrinkGuard(normalized, previousCounts);

    fs.mkdirSync(path.resolve(stageDir, 'assets'), { recursive: true });
    const icons = [...new Set([...normalized.costumes, ...normalized.items, ...normalized.suits].map((row) => row.icon).filter(Boolean))].sort();
    const existingAssets = path.resolve(outDir, 'assets');
    const statuses = await mapLimit(icons, ASSET_CONCURRENCY, async (icon) => {
      const file = `${icon}.webp`;
      const prior = path.resolve(existingAssets, file);
      const dest = path.resolve(stageDir, 'assets', file);
      if (fs.existsSync(prior)) {
        const priorBuffer = fs.readFileSync(prior);
        if (validWebp(priorBuffer)) {
          fs.copyFileSync(prior, dest);
          return 'reused';
        }
      }
      const buffer = await fetchWithRetries(`https://static.nanoka.cc/assets/gi/${file}`, fetchImpl, 'buffer');
      if (!validWebp(buffer)) throw new Error(`Invalid WebP response for ${icon}`);
      fs.writeFileSync(dest, buffer);
      return 'downloaded';
    });

    const localize = (rows) => rows.map((row) => ({
      ...row,
      localAsset: row.icon ? `GameData/gi/beyond/assets/${row.icon}.webp` : null,
    }));
    writeJson(path.resolve(stageDir, 'costumes.json'), localize(normalized.costumes));
    writeJson(path.resolve(stageDir, 'items.json'), localize(normalized.items));
    writeJson(path.resolve(stageDir, 'suits.json'), localize(normalized.suits));
    writeJson(path.resolve(stageDir, 'lang-map.json'), normalized.langMap);
    const report = {
      generatedAt: now().toISOString(),
      sourceRoutes: SOURCE_ROUTES,
      version: discovered.version,
      staticBase: discovered.staticBase,
      counts: Object.fromEntries(['costumes', 'items', 'suits'].map((key) => [key, normalized[key].length])),
      assets: {
        referenced: icons.length,
        downloaded: statuses.filter((value) => value === 'downloaded').length,
        reused: statuses.filter((value) => value === 'reused').length,
        iconless: [...normalized.costumes, ...normalized.items, ...normalized.suits].filter((row) => !row.icon).length,
      },
      unnamedItems: normalized.items.filter((row) => row.nameMissing).map((row) => row.id),
    };
    writeJson(path.resolve(stageDir, 'report.json'), report);
    swapDirectory(stageDir, outDir);
    return report;
  } catch (error) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    throw error;
  }
}
