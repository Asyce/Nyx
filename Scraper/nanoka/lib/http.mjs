// Nanoka HTTP helpers. The generic fetch/download/concurrency primitives live in
// ../../lib/common.mjs (single source of truth, 429/Retry-After aware); this module
// adds the Nanoka-specific static CDN URL builder and turns on the conditional-GET
// cache for Nanoka's static JSON (the CDN serves ETag/Last-Modified and answers 304).
import { downloadFile, fetchJson as commonFetchJson, fetchText, mapLimit } from '../../lib/common.mjs';

export { downloadFile, fetchText, mapLimit };

export const NANOKA_STATIC_BASE = 'https://static.nanoka.cc';

const HTTP_CACHE_ENABLED = process.env.NYXARIUM_HTTP_CACHE !== '0';

export function fetchJson(url, options = {}) {
  return commonFetchJson(url, { cache: HTTP_CACHE_ENABLED, ...options });
}

export function nanokaStaticUrl(...parts) {
  return `${NANOKA_STATIC_BASE}/${parts.map((part) => String(part).replace(/^\/+|\/+$/g, '')).join('/')}`;
}
