import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTextWithFallback } from './lib/html-fetch.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const dbDir = path.resolve(root, 'Database');
const outDir = path.resolve(dbDir, 'GameData', 'gi', 'furniture');
const sourceUrl = 'https://gi.nanoka.cc/furniture/';
const assetBase = 'https://static.nanoka.cc/assets/gi';
const fetchTimeoutMs = 20_000;
const detailConcurrency = 16;
const assetConcurrency = 16;

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizeRawHtml(s) {
  return String(s || '').replace(/[ \t]+$/gm, '').replace(/\r?\n/g, '\n');
}

async function fetchText(url, retries = 3) {
  return fetchTextWithFallback(url, {
    retries,
    timeoutMs: fetchTimeoutMs,
    userAgent: 'Mozilla/5.0 Nyx scraper',
  });
}

async function fetchJson(url, { optional = false, retries = 3 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 Nyx scraper' },
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });
      if (response.status === 404 && optional) return null;
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    }
  }
  if (optional) return null;
  throw new Error(`Failed to fetch ${url}: ${lastError?.message || lastError}`);
}

async function downloadAsset(url, dest, { force = false } = {}) {
  if (!force && fs.existsSync(dest)) return 'cached';
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 Nyx scraper' },
      signal: AbortSignal.timeout(fetchTimeoutMs),
    });
    if (!response.ok) return 'missing';
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(dest, buffer);
    return 'downloaded';
  } catch {
    return 'missing';
  }
}

async function mapLimit(entries, limit, mapper) {
  const out = new Array(entries.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, entries.length) }, async () => {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= entries.length) return;
      out[current] = await mapper(entries[current], current);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---- 1. Load the furniture list payload embedded in the SvelteKit page ----
const html = await fetchText(sourceUrl);

ensureDir(path.resolve(outDir, 'raw'));
ensureDir(path.resolve(outDir, 'assets'));
fs.writeFileSync(path.resolve(outDir, 'raw', 'page.html'), normalizeRawHtml(html), 'utf8');

let listPayload = null;
let staticBase = null;
const scriptRe = /<script[^>]*type="application\/json"[^>]*data-sveltekit-fetched[^>]*data-url="([^"]+)"[^>]*>([\s\S]*?)<\/script>/g;
for (const match of html.matchAll(scriptRe)) {
  const dataUrl = decodeHtmlEntities(match[1]);
  if (!/\/furniture\.json$/i.test(dataUrl)) continue;
  const wrapper = JSON.parse(decodeHtmlEntities(match[2]));
  listPayload = JSON.parse(wrapper.body);
  staticBase = dataUrl.replace(/\/furniture\.json$/i, '');
  break;
}

if (!listPayload) throw new Error('Could not find GameData furniture list payload in page HTML.');
if (!staticBase) throw new Error('Could not determine GameData furniture static API base URL.');
fs.writeFileSync(path.resolve(outDir, 'raw', 'furniture.json'), JSON.stringify(listPayload, null, 2), 'utf8');

const version = staticBase.match(/\/gi\/([^/]+)$/)?.[1] || null;
const ids = Object.keys(listPayload);
console.log(`Found ${ids.length} furnishings (version ${version || 'unknown'}). Fetching details...`);

// ---- 2. Fetch per-furnishing detail (desc, cost, comfort, source, full recipe) ----
const detailResults = await mapLimit(ids, detailConcurrency, async (id) => {
  const detail = await fetchJson(`${staticBase}/en/furniture/${id}.json`, { optional: true });
  return [id, detail];
});
const details = Object.fromEntries(detailResults.filter(([, detail]) => detail));
fs.writeFileSync(path.resolve(outDir, 'raw', 'details.json'), JSON.stringify(details, null, 2), 'utf8');
console.log(`Fetched ${Object.keys(details).length} furnishing detail records.`);

// ---- 3. Normalize + queue icon downloads ----
const assetsDir = path.resolve(outDir, 'assets');
const items = ids.map((id) => {
  const list = listPayload[id] || {};
  const detail = details[id] || {};
  const icon = detail.icon || list.icon || null;
  const listRecipe = Array.isArray(list.recipe) ? list.recipe : [];
  const detailRecipe = detail.recipe && typeof detail.recipe === 'object' ? detail.recipe : null;
  const recipeItems = detailRecipe && Array.isArray(detailRecipe.items) ? detailRecipe.items : listRecipe;
  return {
    id: String(id),
    name: detail.name || list.en || String(id),
    description: detail.desc || null,
    rank: Number.isFinite(Number(detail.rank ?? list.rank)) ? Number(detail.rank ?? list.rank) : null,
    type: Array.isArray(detail.type) ? detail.type : (Array.isArray(list.type) ? list.type : []),
    type2: Array.isArray(detail.type2) ? detail.type2 : (Array.isArray(list.type2) ? list.type2 : []),
    cost: Number.isFinite(Number(detail.cost)) ? Number(detail.cost) : null,
    comfort: Number.isFinite(Number(detail.comfort)) ? Number(detail.comfort) : null,
    source: Array.isArray(detail.source) ? detail.source : (detail.source ? [detail.source] : []),
    recipe: (recipeItems.length || detailRecipe) ? {
      exp: Number.isFinite(Number(detailRecipe?.exp)) ? Number(detailRecipe.exp) : null,
      time: Number.isFinite(Number(detailRecipe?.time)) ? Number(detailRecipe.time) : null,
      items: recipeItems.map((row) => ({ id: String(row.id), count: Number(row.count) || 0 })),
    } : null,
    icon,
    localizedNames: {
      ...(list.en ? { en: list.en } : {}),
      ...(list.zh ? { zh: list.zh } : {}),
      ...(list.ja ? { ja: list.ja } : {}),
      ...(list.ko ? { ko: list.ko } : {}),
    },
    localAsset: null,
  };
});

// Icon files are named by id only. Furnishing display names routinely contain
// commas, quotes, and parentheses, which the deploy asset-copy scanner
// (databaseRefsFromText in build-deploy.mjs) treats as reference terminators —
// embedding them in the path would drop those assets from the deploy build.
const downloadQueue = items
  .filter((item) => item.icon)
  .map((item) => ({ item, file: `${item.id}.webp` }));

const downloadResults = await mapLimit(downloadQueue, assetConcurrency, async ({ item, file }) => {
  const dest = path.resolve(assetsDir, file);
  const status = await downloadAsset(`${assetBase}/${item.icon}.webp`, dest);
  if (status !== 'missing') {
    item.localAsset = path.relative(dbDir, dest).replace(/\\/g, '/');
  }
  return status;
});

const downloaded = downloadResults.filter((s) => s === 'downloaded').length;
const cached = downloadResults.filter((s) => s === 'cached').length;
const missingAssets = downloadResults.filter((s) => s === 'missing').length;

fs.writeFileSync(path.resolve(outDir, 'furniture.json'), JSON.stringify(items, null, 2), 'utf8');

// ---- 4. Report ----
const categoryCounts = {};
for (const item of items) {
  const cat = item.type[0] || 'Other';
  categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
}

const report = {
  generatedAt: new Date().toISOString(),
  sourceUrl,
  version,
  staticBase,
  counts: {
    furnishings: items.length,
    withDetail: Object.keys(details).length,
    withRecipe: items.filter((item) => item.recipe && item.recipe.items.length).length,
    withAsset: items.filter((item) => item.localAsset).length,
  },
  assets: { downloaded, cached, missing: missingAssets },
  categoryCounts,
};
fs.writeFileSync(path.resolve(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

console.log(`Saved ${items.length} furnishings to ${path.relative(root, outDir)}`);
console.log(`Assets: ${downloaded} downloaded, ${cached} cached, ${missingAssets} missing.`);
