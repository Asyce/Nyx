import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_DATABASE_DIR = path.resolve(__dirname, '..', '..', 'Database');
export const DEFAULT_UA = 'Mozilla/5.0 (compatible; NyxariumScraper/1.0)';
export const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJson(file, data) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function fetchText(url, options = {}) {
  const response = await fetchWithRetries(url, options);
  if (response === null) return null;
  return response.text();
}

export async function fetchJson(url, options = {}) {
  const response = await fetchWithRetries(url, {
    ...options,
    headers: { accept: 'application/json', ...(options.headers || {}) }
  });
  if (response === null) return null;
  if (options.maxBytes === undefined) return response.json();
  return JSON.parse(await boundedResponseText(response, options.maxBytes));
}

async function boundedResponseText(response, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Response byte limit is invalid');
  }

  const declared = response.headers?.get?.('content-length');
  if (declared !== null && declared !== undefined) {
    if (!/^(0|[1-9]\d*)$/.test(declared) || Number(declared) > maxBytes) {
      throw new Error('Response exceeds the byte limit');
    }
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error('Response exceeds the byte limit');
    return text;
  }

  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('Response exceeds the byte limit');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes).toString('utf8');
}

export async function downloadFile(url, targetFile, options = {}) {
  const { force = false, optional = true } = options;

  if (!force && await fileExists(targetFile)) {
    return { status: 'cached', bytes: null };
  }

  const response = await fetchWithRetries(url, { optional, retries: options.retries ?? 2 });
  if (response === null) {
    return { status: 'missing', bytes: null };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await ensureDir(path.dirname(targetFile));
  await fs.writeFile(targetFile, buffer);
  return { status: 'downloaded', bytes: buffer.byteLength };
}

export async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export function safeSlug(value, fallback = 'item') {
  const slug = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || fallback;
}

export function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

export function databasePath(...parts) {
  return toPosixPath(path.join(...parts));
}

export function hashString(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function shortHash(value, length = 12) {
  return hashString(value).slice(0, length);
}

export function contentHash(value, omitKeys = new Set(['generatedAt', 'scrapedAt', 'downloadedAt'])) {
  return hashString(JSON.stringify(stripKeys(value, omitKeys)));
}

export function diffRecords(previousHashes = {}, records = [], nameOf = (record) => record.name || null) {
  const currentHashes = Object.fromEntries(records.map((record) => [String(record.id), contentHash(record)]));
  const currentIds = new Set(Object.keys(currentHashes));
  const previousIds = new Set(Object.keys(previousHashes));
  const added = [];
  const removed = [];
  const changed = [];
  let unchanged = 0;

  for (const id of currentIds) {
    if (!previousIds.has(id)) {
      const record = records.find((entry) => String(entry.id) === id);
      added.push({ id, name: record ? nameOf(record) : null, previousHash: null, currentHash: currentHashes[id] });
    } else if (previousHashes[id] !== currentHashes[id]) {
      const record = records.find((entry) => String(entry.id) === id);
      changed.push({ id, name: record ? nameOf(record) : null, previousHash: previousHashes[id], currentHash: currentHashes[id] });
    } else {
      unchanged += 1;
    }
  }

  for (const id of previousIds) {
    if (!currentIds.has(id)) {
      removed.push({ id, name: null, previousHash: previousHashes[id], currentHash: null });
    }
  }

  return {
    hashes: currentHashes,
    report: {
      added: sortChanges(added),
      removed: sortChanges(removed),
      changed: sortChanges(changed),
      unchanged,
      totals: { previous: previousIds.size, current: currentIds.size }
    }
  };
}

export function decodeEntities(value = '') {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_, body) => {
    const key = body.toLowerCase();
    if (Object.hasOwn(named, key)) return named[key];
    if (key.startsWith('#x')) {
      const cp = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
    }
    if (key.startsWith('#')) {
      const cp = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
    }
    return '';
  });
}

export function stripTags(html = '') {
  return decodeEntities(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function parseAttrs(tag = '') {
  const attrs = {};
  const re = /([:@A-Za-z0-9_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;
  while ((match = re.exec(tag)) !== null) {
    attrs[match[1]] = decodeEntities(match[3] ?? match[4] ?? match[5] ?? '');
  }
  return attrs;
}

export function extractImages(html, baseUrl, options = {}) {
  const { include = () => true } = options;
  const images = [];
  const seen = new Set();
  const re = /<img\b[^>]*>/gi;
  let match;

  while ((match = re.exec(html)) !== null) {
    const attrs = parseAttrs(match[0]);
    const url = normalizeImageUrl(attrs.currentSrc || attrs.src || attrs['data-src'] || srcsetBest(attrs.srcset), baseUrl);
    if (!url || seen.has(url) || !include(url, attrs)) continue;
    seen.add(url);
    images.push({
      id: shortHash(url),
      alt: cleanText(attrs.alt || ''),
      title: cleanText(attrs.title || ''),
      url,
      width: numeric(attrs.width),
      height: numeric(attrs.height)
    });
  }

  return images;
}

export function normalizeImageUrl(raw, baseUrl) {
  if (!raw) return null;
  try {
    const url = new URL(raw, baseUrl);
    const optimized = url.searchParams.get('url');
    if (optimized) return new URL(optimized, baseUrl).href;
    return url.href;
  } catch {
    return null;
  }
}

export function cleanText(value = '') {
  return decodeEntities(String(value)).replace(/\s+/g, ' ').trim();
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function extFromUrl(url, fallback = '.bin') {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname);
    return ext || fallback;
  } catch {
    return fallback;
  }
}

async function fetchWithRetries(url, options = {}) {
  const {
    optional = false,
    retries = 3,
    headers = {},
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    cache = false,
    method = 'GET',
    body,
  } = options;
  const requestMethod = String(method).toUpperCase();
  const cacheable = cache && requestMethod === 'GET';
  let lastError;

  // Conditional-GET cache: opt-in (used by the GameData JSON fetchers). A cache hit still
  // makes the request, but the server answers 304 with no body, so we reuse the stored
  // payload and skip re-downloading/re-parsing unchanged data. Fail-safe: any cache error
  // falls through to a normal fetch.
  const cacheEntry = cacheable ? await readHttpCache(url) : null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const conditional = cacheEntry
        ? {
          ...(cacheEntry.etag ? { 'If-None-Match': cacheEntry.etag } : {}),
          ...(cacheEntry.lastModified ? { 'If-Modified-Since': cacheEntry.lastModified } : {})
        }
        : {};

      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        method: requestMethod,
        body,
        headers: { 'User-Agent': DEFAULT_UA, ...headers, ...conditional }
      });

      if (response.status === 304 && cacheEntry) {
        return cachedResponse(cacheEntry.body);
      }
      if (response.status === 404 && optional) return null;
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} ${response.statusText}`);
        error.status = response.status;
        error.retryAfter = response.headers.get('retry-after');
        throw error;
      }

      if (cacheable) {
        // Read the body once here so we can both cache it and hand it back.
        const responseBody = await response.text();
        await writeHttpCache(url, {
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
          body: responseBody
        });
        return cachedResponse(responseBody);
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, retryDelay(error, attempt)));
    }
  }

  throw new Error(`Failed to fetch ${url}: ${lastError?.message || lastError}`);
}

// Minimal duck-typed Response carrying an already-read body, so fetchText/fetchJson work
// transparently whether the body came from the network or the conditional-GET cache.
function cachedResponse(body) {
  return {
    ok: true,
    status: 200,
    fromCache: true,
    async text() { return body; },
    async json() { return JSON.parse(body); }
  };
}

function httpCacheDir() {
  const base = process.env.NYXARIUM_DATABASE_DIR
    ? path.resolve(process.env.NYXARIUM_DATABASE_DIR)
    : DEFAULT_DATABASE_DIR;
  return path.join(base, '_httpcache');
}

function httpCacheFile(url) {
  return path.join(httpCacheDir(), `${shortHash(url, 24)}.json`);
}

async function readHttpCache(url) {
  try {
    const entry = JSON.parse(await fs.readFile(httpCacheFile(url), 'utf8'));
    if (entry && entry.url === url && typeof entry.body === 'string' && (entry.etag || entry.lastModified)) {
      return entry;
    }
  } catch {
    // No cache / unreadable cache: behave as a normal fetch.
  }
  return null;
}

async function writeHttpCache(url, { etag, lastModified, body }) {
  if (!etag && !lastModified) return; // Nothing to revalidate against next time.
  try {
    const file = httpCacheFile(url);
    await ensureDir(path.dirname(file));
    await fs.writeFile(file, JSON.stringify({ url, etag, lastModified, body, savedAt: new Date().toISOString() }), 'utf8');
  } catch {
    // Caching is best-effort; a write failure must never break a scrape.
  }
}

function retryDelay(error, attempt) {
  const retryAfter = Number.parseInt(error?.retryAfter, 10);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  if (error?.status === 429) return 2500 * (attempt + 1);
  return 350 * (attempt + 1);
}

function srcsetBest(srcset = '') {
  const parts = String(srcset).split(',').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  return parts[parts.length - 1].split(/\s+/)[0] || null;
}

function numeric(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function stripKeys(value, omitKeys) {
  if (Array.isArray(value)) return value.map((item) => stripKeys(item, omitKeys));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (!omitKeys.has(key) && value[key] !== undefined) out[key] = stripKeys(value[key], omitKeys);
    }
    return out;
  }
  return value;
}

function sortChanges(changes) {
  return changes.sort((left, right) => String(left.id).localeCompare(String(right.id), undefined, { numeric: true }));
}
