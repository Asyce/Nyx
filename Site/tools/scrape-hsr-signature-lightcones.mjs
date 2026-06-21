import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const dbDir = path.resolve(root, 'Database');
const outRoot = path.resolve(dbDir, 'HsrWiki', 'signature-lightcones');
const rawRoot = path.resolve(outRoot, 'raw');
const manifestPath = path.resolve(outRoot, 'manifest.json');
const reportsDir = path.resolve(dbDir, 'reports');
const reportPath = path.resolve(reportsDir, 'hsr-signature-lightcones.json');
const apiRoot = 'https://honkai-star-rail.fandom.com/api.php';
const userAgent = 'NyxHsrSignatureLightConeScraper/1.0';
const fetchTimeoutMs = 20_000;

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args.set(m[1], m[2] ?? 'true');
}

const onlyName = args.get('name') || '';
const limit = Number(args.get('limit') || 0);
const minRarity = args.get('all') === 'true' ? 1 : Math.max(1, Math.min(5, Number(args.get('min-rarity') || 5)));
const concurrency = Math.max(1, Math.min(8, Number(args.get('concurrency') || 4)));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.resolve(dbDir, rel), 'utf8'));
}

function normName(s) {
  return String(s || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function cleanFileName(s, fallback = 'page') {
  const clean = String(s || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
  return clean || fallback;
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(s) {
  return decodeHtml(String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function wikiPageName(name) {
  return String(name || '').replace(/\s+/g, '_');
}

function lightCones() {
  let rows = readJson('Nanoka/hsr/live/lightcones.json')
    .filter((lc) => lc?.name && Number(lc.rarity || 0) >= minRarity)
    .sort((a, b) => Number(b.rarity || 0) - Number(a.rarity || 0) || String(a.name).localeCompare(String(b.name)));
  if (onlyName) {
    const q = normName(onlyName);
    rows = rows.filter((lc) => normName(lc.name).includes(q) || q.includes(normName(lc.name)));
  }
  if (limit > 0) rows = rows.slice(0, limit);
  return rows;
}

async function fetchJson(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(fetchTimeoutMs) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      last = err;
      await new Promise((resolve) => setTimeout(resolve, 450 * (i + 1)));
    }
  }
  throw last;
}

async function mapConcurrent(items, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

function featuredCharactersFromHtml(html) {
  const marker = html.search(/Featured\s+Characters/i);
  if (marker < 0) return [];
  const afterMarker = html.slice(marker, marker + 5000);
  const sourceMatch = /data-source="characters?"/i.exec(afterMarker);
  if (!sourceMatch) return [];
  const sourceIdx = marker + sourceMatch.index;
  const sectionEnd = html.indexOf('</section>', sourceIdx);
  const nextHeader = html.indexOf('<h2', sourceIdx + 20);
  const end = sectionEnd > sourceIdx ? sectionEnd : (nextHeader > sourceIdx ? nextHeader : sourceIdx + 1600);
  const section = html.slice(sourceIdx, end);
  const rows = [];
  const seen = new Set();
  const linkRe = /<a\b([^>]*?)>(.*?)<\/a>/gi;
  for (const match of section.matchAll(linkRe)) {
    const attrs = match[1] || '';
    const href = decodeHtml(attrs.match(/\bhref="([^"]+)"/i)?.[1] || '');
    const title = decodeHtml(attrs.match(/\btitle="([^"]+)"/i)?.[1] || '');
    const text = stripTags(match[2]);
    if (!href.includes('/wiki/')) continue;
    if (/^(File|Category|Special|Light Cone)\b/i.test(title)) continue;
    const name = cleanCharacterName(title || text);
    const key = normName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(name);
  }
  return rows;
}

function cleanCharacterName(name) {
  return String(name || '')
    .replace(/\s*\(Character\)\s*$/i, '')
    .replace(/\s*\(Honkai:\s*Star\s*Rail\)\s*$/i, '')
    .trim();
}

async function parseLightConePage(name) {
  const page = wikiPageName(name);
  const url = new URL(apiRoot);
  url.searchParams.set('action', 'parse');
  url.searchParams.set('page', page);
  url.searchParams.set('prop', 'text');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  const data = await fetchJson(url);
  if (data?.error) throw new Error(data.error.info || data.error.code || 'wiki parse error');
  const html = data?.parse?.text?.['*'] || '';
  return { page, html };
}

async function scrapeLightCone(lc) {
  const key = normName(lc.name);
  const rawFile = path.resolve(rawRoot, `${cleanFileName(key || lc.id)}.html`);
  try {
    const parsed = await parseLightConePage(lc.name);
    fs.writeFileSync(rawFile, parsed.html, 'utf8');
    const characters = featuredCharactersFromHtml(parsed.html);
    return {
      id: String(lc.id),
      name: lc.name,
      key,
      rarity: Number(lc.rarity || 0),
      path: lc.path || null,
      status: characters.length ? 'ok' : 'no-featured-character',
      characters,
      localAsset: lc.assets?.fullFigure || null,
      localIcon: lc.assets?.mediumIcon || null,
      sourcePage: `https://honkai-star-rail.fandom.com/wiki/${encodeURIComponent(parsed.page).replace(/%2F/g, '/')}`,
    };
  } catch (err) {
    return {
      id: String(lc.id),
      name: lc.name,
      key,
      rarity: Number(lc.rarity || 0),
      path: lc.path || null,
      status: 'error',
      characters: [],
      localAsset: lc.assets?.fullFigure || null,
      localIcon: lc.assets?.mediumIcon || null,
      sourcePage: `https://honkai-star-rail.fandom.com/wiki/${encodeURIComponent(wikiPageName(lc.name))}`,
      error: err?.message || String(err),
    };
  }
}

ensureDir(outRoot);
ensureDir(rawRoot);
ensureDir(reportsDir);

const startedAt = new Date().toISOString();
const rows = lightCones();
console.log(`Scraping HSR signature light cone data for ${rows.length} light cone(s)...`);

const lightConesOut = await mapConcurrent(rows, async (lc, i) => {
  const row = await scrapeLightCone(lc);
  const names = row.characters.length ? row.characters.join(', ') : row.status;
  console.log(`[${i + 1}/${rows.length}] ${row.name}: ${names}`);
  return row;
});

const manifest = {
  generatedAt: new Date().toISOString(),
  source: 'Honkai: Star Rail Wiki / Fandom MediaWiki API',
  sourceExample: 'https://honkai-star-rail.fandom.com/wiki/Patience_Is_All_You_Need',
  minRarity,
  startedAt,
  lightCones: lightConesOut,
};

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
fs.writeFileSync(reportPath, JSON.stringify({
  ...manifest,
  summary: {
    total: lightConesOut.length,
    withFeaturedCharacters: lightConesOut.filter((row) => row.characters.length).length,
    noFeaturedCharacters: lightConesOut.filter((row) => row.status === 'no-featured-character').map((row) => row.name),
    errors: lightConesOut.filter((row) => row.status === 'error').map((row) => ({ name: row.name, error: row.error })),
  },
}, null, 2), 'utf8');

const ok = lightConesOut.filter((row) => row.characters.length).length;
console.log(`Done. ${ok}/${lightConesOut.length} light cone(s) linked to character(s).`);
console.log(`Manifest: ${path.relative(root, manifestPath)}`);
console.log(`Report: ${path.relative(root, reportPath)}`);
