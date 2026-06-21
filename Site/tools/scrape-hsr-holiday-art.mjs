import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const dbDir = path.resolve(root, 'Database');
const outRoot = path.resolve(dbDir, 'HsrWiki', 'holiday-art');
const rawRoot = path.resolve(outRoot, 'raw');
const manifestPath = path.resolve(outRoot, 'manifest.json');
const reportsDir = path.resolve(dbDir, 'reports');
const reportPath = path.resolve(reportsDir, 'hsr-holiday-art.json');
const apiRoot = 'https://honkai-star-rail.fandom.com/api.php';
const userAgent = 'NyxHsrHolidayArtScraper/1.0';
const fetchTimeoutMs = 20_000;

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args.set(m[1], m[2] ?? 'true');
}

const onlyName = args.get('name') || '';
const limit = Number(args.get('limit') || 0);
const width = Math.max(900, Math.min(2400, Number(args.get('width') || 1600)));
const concurrency = Math.max(1, Math.min(8, Number(args.get('concurrency') || 4)));
const force = args.get('force') === 'true';

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

function cleanFileName(s, fallback = 'image') {
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

function mediaPageCandidates(ch) {
  const names = [ch.name];
  if (ch.name === 'Topaz & Numby') names.push('Topaz');
  if (/^Trailblazer\b/i.test(ch.name)) names.push('Trailblazer');
  if (/^March 7th\b/i.test(ch.name)) names.push('March 7th');
  const unique = [...new Set(names.filter(Boolean))];
  return unique.map((name) => `${name}/Media`);
}

function playableCharacters() {
  const byName = new Map();
  for (const ch of readJson('Prydwen/hsr/characters.json')) {
    if (!ch?.name || (ch.facts?.rarity !== 4 && ch.facts?.rarity !== 5)) continue;
    const key = normName(ch.name);
    if (!byName.has(key)) byName.set(key, ch);
  }
  let rows = [...byName.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (onlyName) {
    const q = normName(onlyName);
    rows = rows.filter((ch) => normName(ch.name).includes(q) || q.includes(normName(ch.name)));
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

async function fetchBuffer(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(fetchTimeoutMs) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      last = err;
      await new Promise((resolve) => setTimeout(resolve, 650 * (i + 1)));
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

function sectionHtml(html, id) {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return '';
  const afterStart = html.indexOf('</h3>', start);
  if (afterStart < 0) return '';
  const next = html.indexOf('<h3', afterStart + 5);
  return html.slice(afterStart + 5, next < 0 ? html.length : next);
}

function holidayFilesFromHtml(html) {
  const section = sectionHtml(html, 'Holidays');
  if (!section) return [];
  const rows = [];
  const seen = new Set();
  const imageRe = /<img\b[^>]*>/gi;
  for (const match of section.matchAll(imageRe)) {
    const tag = match[0];
    const imageName = decodeHtml(tag.match(/\bdata-image-name="([^"]+)"/i)?.[1] || '');
    const key = decodeHtml(tag.match(/\bdata-image-key="([^"]+)"/i)?.[1] || '');
    const title = decodeHtml(tag.match(/\btitle="([^"]+)"/i)?.[1] || '');
    const alt = decodeHtml(tag.match(/\balt="([^"]*)"/i)?.[1] || '');
    const fileName = imageName || key;
    if (!fileName || seen.has(fileName)) continue;
    seen.add(fileName);
    rows.push({ fileName, title: title || fileName, alt });
  }
  return rows;
}

async function imageInfo(fileName) {
  const url = new URL(apiRoot);
  url.searchParams.set('action', 'query');
  url.searchParams.set('titles', `File:${fileName}`);
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|mime|size|thumbmime');
  url.searchParams.set('iiurlwidth', String(width));
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  const data = await fetchJson(url);
  const page = Object.values(data?.query?.pages || {})[0];
  return page?.imageinfo?.[0] || null;
}

async function parseMediaPage(candidates) {
  const errors = [];
  for (const page of candidates) {
    const url = new URL(apiRoot);
    url.searchParams.set('action', 'parse');
    url.searchParams.set('page', page);
    url.searchParams.set('prop', 'text');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');
    const data = await fetchJson(url);
    if (data?.error) {
      errors.push(`${page}: ${data.error.code}`);
      continue;
    }
    const html = data?.parse?.text?.['*'] || '';
    return { page, html, files: holidayFilesFromHtml(html) };
  }
  throw new Error(errors.join('; ') || 'No media page candidates worked.');
}

async function scrapeCharacter(ch) {
  const name = ch.name;
  const key = normName(name);
  const folder = path.resolve(outRoot, key);
  const rawFolder = path.resolve(rawRoot, key);
  ensureDir(folder);
  ensureDir(rawFolder);

  try {
    const parsed = await parseMediaPage(mediaPageCandidates(ch));
    fs.writeFileSync(path.resolve(rawFolder, 'holidays.html'), parsed.html, 'utf8');
    const artworks = [];
    for (let i = 0; i < parsed.files.length; i += 1) {
      const file = parsed.files[i];
      const info = await imageInfo(file.fileName);
      if (!info) continue;
      const sourceExt = path.extname(file.fileName);
      const ext = (sourceExt.replace(/^\./, '') || (String(info.mime || '').split('/')[1] || 'png')).replace(/^jpeg$/i, 'jpg');
      const stem = cleanFileName(path.basename(file.fileName, sourceExt), name);
      const localFile = `${String(i + 1).padStart(2, '0')}-${stem}.${ext}`;
      const abs = path.resolve(folder, localFile);
      if (force || !fs.existsSync(abs) || fs.statSync(abs).size === 0) {
        const imageUrl = info.thumburl || info.url;
        const buf = await fetchBuffer(imageUrl);
        fs.writeFileSync(abs, buf);
      }
      artworks.push({
        file: file.fileName,
        title: file.title,
        localAsset: path.relative(dbDir, abs).replace(/\\/g, '/'),
        sourcePage: `https://honkai-star-rail.fandom.com/wiki/${encodeURIComponent(parsed.page).replace(/%2F/g, '/')}`,
        sourceFile: info.descriptionurl || null,
        width: info.thumbwidth || info.width || null,
        height: info.thumbheight || info.height || null,
        originalWidth: info.width || null,
        originalHeight: info.height || null,
        mime: info.thumbmime || info.mime || null,
      });
    }
    return {
      name,
      key,
      page: parsed.page,
      status: artworks.length ? 'ok' : 'fallback',
      artworks,
    };
  } catch (err) {
    return {
      name,
      key,
      page: mediaPageCandidates(ch)[0],
      status: 'error',
      error: err?.message || String(err),
      artworks: [],
    };
  }
}

ensureDir(outRoot);
ensureDir(rawRoot);
ensureDir(reportsDir);

const startedAt = new Date().toISOString();
const characters = playableCharacters();
console.log(`Scraping HSR holiday art for ${characters.length} character(s) at width ${width}...`);

const rows = await mapConcurrent(characters, async (ch) => {
  const row = await scrapeCharacter(ch);
  const note = row.status === 'ok' ? `${row.artworks.length} image(s)` : row.status;
  console.log(`${row.name}: ${note}`);
  return row;
});

const manifest = {
  generatedAt: new Date().toISOString(),
  source: 'Honkai: Star Rail Wiki / Fandom MediaWiki API',
  sourceExample: 'https://honkai-star-rail.fandom.com/wiki/Kafka/Media',
  requestedWidth: width,
  section: 'Artwork > Holidays',
  characters: rows,
};

const report = {
  startedAt,
  generatedAt: manifest.generatedAt,
  total: rows.length,
  withHolidayArt: rows.filter((row) => row.artworks.length > 0).length,
  fallbackToSplash: rows.filter((row) => row.status !== 'ok').map((row) => ({
    name: row.name,
    status: row.status,
    page: row.page,
    error: row.error || undefined,
  })),
};

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`Saved ${path.relative(root, manifestPath)}`);
console.log(`Saved ${path.relative(root, reportPath)}`);
