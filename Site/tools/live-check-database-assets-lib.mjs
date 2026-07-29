import crypto from 'node:crypto';
import {
  DATABASE_ASSET_METADATA,
  encodeAssetKey,
} from './database-assets.mjs';

const DEFAULT_SAMPLE_PARTS = [0, .2, .4, .6, .8, 1];

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sampleEntries(entries) {
  const indexes = [...new Set(DEFAULT_SAMPLE_PARTS.map((part) => Math.min(
    entries.length - 1,
    Math.floor((entries.length - 1) * part),
  )))];
  return indexes.map((index) => entries[index]);
}

export function buildLiveCheckTargets(manifest, {
  full = false,
  siteOrigin = 'https://pengo.gg',
  staticSourcePaths,
} = {}) {
  if (!manifest?.entries?.length) throw new Error('live check requires a non-empty exact Git inventory');
  const entries = full ? manifest.entries : sampleEntries(manifest.entries);
  const canonicalByUrl = new Map();
  const aliases = [];
  for (const entry of entries) {
    const prior = canonicalByUrl.get(entry.publicUrl);
    if (prior && (prior.sha256 !== entry.sha256 || prior.bytes !== entry.bytes)) {
      throw new Error(`conflicting canonical inventory entry for ${entry.publicUrl}`);
    }
    if (!prior) {
      canonicalByUrl.set(entry.publicUrl, {
        kind: 'canonical',
        url: entry.publicUrl,
        redirectExpectation: 'forbidden',
        sha256: entry.sha256,
        bytes: entry.bytes,
        mediaType: entry.mediaType,
        cacheControl: DATABASE_ASSET_METADATA.canonicalCacheControl,
        sourcePath: entry.sourcePath,
      });
    }
    aliases.push({
      kind: 'direct legacy alias',
      url: `${manifest.assetOrigin}/${encodeAssetKey(entry.legacyKey)}`,
      redirectExpectation: 'forbidden',
      sha256: entry.sha256,
      bytes: entry.bytes,
      mediaType: entry.mediaType,
      cacheControl: DATABASE_ASSET_METADATA.aliasCacheControl,
      sourcePath: entry.sourcePath,
    });
  }
  const oldPaths = entries.map((entry) => {
    const staticExpected = staticSourcePaths?.has(entry.sourcePath);
    return {
      kind: 'old Database path',
      url: `${siteOrigin}/${encodeAssetKey(entry.sourcePath)}`,
      expectedFinalUrl: staticExpected === false
        ? `${manifest.assetOrigin}/${encodeAssetKey(entry.legacyKey)}`
        : undefined,
      redirectExpectation: staticExpected == null ? 'either' : (staticExpected ? 'forbidden' : 'required'),
      sha256: entry.sha256,
      bytes: entry.bytes,
      mediaType: staticExpected === false ? entry.mediaType : undefined,
      cacheControl: staticExpected === false
        ? DATABASE_ASSET_METADATA.aliasCacheControl
        : undefined,
      sourcePath: entry.sourcePath,
    };
  });
  return {
    canonical: [...canonicalByUrl.values()],
    directAliases: aliases,
    oldPaths,
    all: [...canonicalByUrl.values(), ...aliases, ...oldPaths],
  };
}

async function fetchWithRetry(target, {
  fetchImpl,
  attempts,
  sleep,
  timeoutMs,
}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(target.url, {
        redirect: 'follow',
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (target.redirectExpectation === 'forbidden' && response.redirected) {
        throw new Error(`unexpected redirect to ${response.url || '<unknown>'}`);
      }
      if (target.redirectExpectation === 'required'
        && (!response.redirected || response.url !== target.expectedFinalUrl)) {
        throw new Error(`expected redirect to ${target.expectedFinalUrl}, reached ${response.url || '<unknown>'}`);
      }
      if (target.mediaType) {
        const actualMediaType = response.headers?.get?.('content-type')
          ?.split(';', 1)[0].trim().toLowerCase() || null;
        if (actualMediaType !== target.mediaType.toLowerCase()) {
          throw new Error(`expected Content-Type ${target.mediaType}, got ${actualMediaType || '<missing>'}`);
        }
      }
      if (target.cacheControl) {
        const normalizeCacheControl = (value) => value
          ?.split(',')
          .map((part) => part.trim().toLowerCase())
          .filter(Boolean)
          .sort()
          .join(',') || null;
        const actualCacheControl = response.headers?.get?.('cache-control') || null;
        if (normalizeCacheControl(actualCacheControl) !== normalizeCacheControl(target.cacheControl)) {
          throw new Error(`expected Cache-Control ${target.cacheControl}, got ${actualCacheControl || '<missing>'}`);
        }
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const actualSha = sha256(bytes);
      if (bytes.length !== target.bytes || actualSha !== target.sha256) {
        throw new Error(`expected ${target.bytes} bytes/${target.sha256}, got ${bytes.length} bytes/${actualSha}`);
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 2_000);
    }
  }
  throw new Error(`${target.kind} failed after ${attempts} GET attempts: ${target.url} (${target.sourcePath}): ${lastError.message}`);
}

export async function runLiveAssetChecks(manifest, {
  full = false,
  siteOrigin = 'https://pengo.gg',
  staticSourcePaths,
  concurrency = 24,
  attempts = 5,
  timeoutMs = 30_000,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onProgress = () => {},
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 128) {
    throw new Error(`live-check concurrency must be an integer from 1 to 128, got ${concurrency}`);
  }
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
    throw new Error(`live-check attempts must be an integer from 1 to 10, got ${attempts}`);
  }
  const targets = buildLiveCheckTargets(manifest, { full, siteOrigin, staticSourcePaths });
  let next = 0;
  let completed = 0;
  let firstError;
  const workers = Array.from({ length: Math.min(concurrency, targets.all.length) }, async () => {
    while (!firstError) {
      const index = next++;
      if (index >= targets.all.length) return;
      try {
        await fetchWithRetry(targets.all[index], {
          fetchImpl,
          attempts,
          sleep,
          timeoutMs,
        });
        completed += 1;
        onProgress({ completed, total: targets.all.length });
      } catch (error) {
        firstError = error;
      }
    }
  });
  await Promise.all(workers);
  if (firstError) throw firstError;
  return {
    mode: full ? 'full' : 'sampled',
    canonical: targets.canonical.length,
    directAliases: targets.directAliases.length,
    oldPaths: targets.oldPaths.length,
    total: targets.all.length,
  };
}
