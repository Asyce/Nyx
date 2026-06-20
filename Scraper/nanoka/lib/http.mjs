import { promises as fs } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { ensureDir, fileExists } from './fs.mjs';

export const NANOKA_STATIC_BASE = 'https://static.nanoka.cc';
export const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

export function nanokaStaticUrl(...parts) {
  return `${NANOKA_STATIC_BASE}/${parts.map((part) => String(part).replace(/^\/+|\/+$/g, '')).join('/')}`;
}

export async function fetchJson(url, options = {}) {
  const { optional = false, retries = 3 } = options;
  const response = await fetchWithRetries(url, {
    optional,
    retries,
    headers: { accept: 'application/json' }
  });

  if (response === null) {
    return null;
  }

  return response.json();
}

export async function downloadFile(url, targetFile, options = {}) {
  const { optional = true, force = false, retries = 2 } = options;

  if (!force && await fileExists(targetFile)) {
    return { status: 'cached', targetFile };
  }

  const response = await fetchWithRetries(url, { optional, retries });
  if (response === null) {
    return { status: 'missing', targetFile };
  }

  await ensureDir(pathDirname(targetFile));
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(targetFile, buffer);
  return { status: 'downloaded', targetFile, bytes: buffer.byteLength };
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

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function fetchWithRetries(url, options = {}) {
  const { optional = false, retries = 3, headers, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS } = options;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });

      if (response.status === 404 && optional) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return response;
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        await delay(350 * (attempt + 1));
      }
    }
  }

  throw new Error(`Failed to fetch ${url}: ${lastError?.message || lastError}`);
}

function pathDirname(file) {
  return file.replace(/[\\/][^\\/]+$/, '') || '.';
}
