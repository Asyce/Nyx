import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { verifyLauncherVisuals } from './verify-launcher-visuals.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '..');
const generated = path.join(site, 'src', 'data', 'generated');
const bucket = 'nyx-database-assets';
const immutableCache = 'public,max-age=31536000,immutable';
const manifestCache = 'public,max-age=60,must-revalidate';
const requestTimeoutMs = 60_000;
const maxManifestBytes = 512 * 1024;
const wranglerScript = path.join(site, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const execFileAsync = promisify(execFile);

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export async function buildLauncherVisualUploadPlan(baseDirectory = generated) {
  await verifyLauncherVisuals(baseDirectory);
  const manifestPath = path.join(baseDirectory, 'launcher-visuals-v1.json');
  const manifestBytes = await fs.readFile(manifestPath);
  if (manifestBytes.length > maxManifestBytes) throw new Error('Launcher visual manifest exceeds its size limit.');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const assets = Object.values(manifest.games).flatMap((entry) => entry.assets).map((asset) => {
    const fileName = path.basename(new URL(asset.url).pathname);
    return {
      key: `launcher-visuals/${fileName}`,
      file: path.join(baseDirectory, 'launcher-visuals', fileName),
      url: asset.url,
      sha256: asset.sha256,
      size: asset.size,
      mediaType: asset.mediaType,
      cacheControl: immutableCache,
    };
  });
  return {
    revision: manifest.revision,
    assets,
    manifest: {
      key: 'launcher-visuals-v1.json',
      file: manifestPath,
      url: 'https://assets.pengo.gg/launcher-visuals-v1.json',
      sha256: sha256(manifestBytes),
      size: manifestBytes.length,
      mediaType: 'application/json',
      cacheControl: manifestCache,
    },
  };
}

async function request(url, method = 'GET', {
  fetchImpl = fetch,
  timeoutMs = requestTimeoutMs,
} = {}) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const signal = AbortSignal.timeout(timeoutMs);
    let onAbort;
    let timeout;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason ?? new Error(`Request timed out for ${url}`));
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
      timeout = setTimeout(onAbort, timeoutMs);
    });
    try {
      const response = await Promise.race([fetchImpl(url, {
        method,
        headers: { 'Cache-Control': 'no-cache' },
        redirect: 'error',
        signal,
      }), aborted]);
      if (response.ok || response.status === 404) return response;
      last = new Error(`HTTP ${response.status} for ${url}`);
    } catch (error) { last = error; }
    finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  throw last;
}

export async function readBoundedResponseBytes(response, {
  maximum,
  timeoutMs = requestTimeoutMs,
} = {}) {
  if (!Number.isSafeInteger(maximum) || maximum <= 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Response bounds are invalid.');
  }
  const rawLength = response.headers.get('content-length');
  const length = rawLength === null ? null : Number(rawLength);
  if (length !== null && (!Number.isSafeInteger(length) || length < 0 || length > maximum)) {
    throw new Error(`Public response exceeds ${maximum} bytes.`);
  }
  if (!response.body) throw new Error('Public response has no body.');

  const signal = AbortSignal.timeout(timeoutMs);
  let onAbort;
  let timeout;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('Public response timed out.'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    timeout = setTimeout(onAbort, timeoutMs);
  });
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      total += value.byteLength;
      if (total > maximum) throw new Error(`Public response exceeds ${maximum} bytes.`);
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
    try { reader.releaseLock(); } catch {}
  }
  if (length !== null && total !== length) throw new Error('Public response size does not match its metadata.');
  return Buffer.concat(chunks, total);
}

export function metadataMatches(response, item, { requireLength = true } = {}) {
  const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const cache = new Set((response.headers.get('cache-control') ?? '')
    .toLowerCase()
    .split(',')
    .map((directive) => directive.trim())
    .filter(Boolean));
  const expectedCache = item.cacheControl.toLowerCase().split(',').map((directive) => directive.trim());
  return response.ok
    && (!requireLength || Number(response.headers.get('content-length')) === item.size)
    && type === item.mediaType.split(';', 1)[0].trim().toLowerCase()
    && expectedCache.every((directive) => cache.has(directive));
}

export async function verifyBytes(item, nonce, {
  fetchImpl = fetch,
  timeoutMs = requestTimeoutMs,
} = {}) {
  const response = await request(`${item.url}?nyx-verify=${nonce}`, 'GET', { fetchImpl, timeoutMs });
  if (!metadataMatches(response, item, { requireLength: false })) throw new Error(`Public metadata does not match for ${item.url}`);
  const bytes = await readBoundedResponseBytes(response, { maximum: item.size, timeoutMs });
  if (bytes.length !== item.size || sha256(bytes) !== item.sha256) {
    throw new Error(`Public bytes do not match for ${item.url}`);
  }
}

export function launcherVisualWranglerInvocation(item) {
  return {
    file: process.execPath,
    args: [
      wranglerScript, 'r2', 'object', 'put', `${bucket}/${item.key}`,
      '--file', item.file,
      '--content-type', item.mediaType,
      '--cache-control', item.cacheControl,
      '--remote', '--force',
    ],
    options: {
      cwd: site,
      env: process.env,
      maxBuffer: 2 * 1024 * 1024,
      shell: false,
    },
  };
}

async function putObject(item, execFileImpl = execFileAsync) {
  const invocation = launcherVisualWranglerInvocation(item);
  await execFileImpl(invocation.file, invocation.args, invocation.options);
}

export async function syncLauncherVisuals({
  apply = false,
  baseDirectory = generated,
  fetchImpl = fetch,
  execFileImpl = execFileAsync,
  timeoutMs = requestTimeoutMs,
} = {}) {
  const plan = await buildLauncherVisualUploadPlan(baseDirectory);
  if (!apply) return { ...plan, applied: false, uploadedAssets: 0, manifestUploaded: false };

  const nonce = `${Date.now()}-${plan.revision.slice(0, 12)}`;
  let uploadedAssets = 0;
  for (const item of plan.assets) {
    const head = await request(`${item.url}?nyx-head=${nonce}`, 'HEAD', { fetchImpl, timeoutMs });
    if (!metadataMatches(head, item)) {
      await putObject(item, execFileImpl);
      uploadedAssets += 1;
    }
    await verifyBytes(item, nonce, { fetchImpl, timeoutMs });
  }

  const current = await request(`${plan.manifest.url}?nyx-current=${nonce}`, 'GET', { fetchImpl, timeoutMs });
  const currentBytes = current.ok
    ? await readBoundedResponseBytes(current, { maximum: maxManifestBytes, timeoutMs })
    : null;
  const manifestUploaded = !currentBytes
    || currentBytes.length !== plan.manifest.size
    || sha256(currentBytes) !== plan.manifest.sha256
    || !metadataMatches(current, plan.manifest, { requireLength: false });
  if (manifestUploaded) await putObject(plan.manifest, execFileImpl);
  await verifyBytes(plan.manifest, `${nonce}-published`, { fetchImpl, timeoutMs });
  return { ...plan, applied: true, uploadedAssets, manifestUploaded };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  syncLauncherVisuals({ apply: process.argv.includes('--apply') }).then((result) => {
    process.stdout.write(`launcher visuals R2 ${result.applied ? 'ready' : 'plan'}: ${result.assets.length} assets, ${result.uploadedAssets} uploaded, manifest ${result.manifestUploaded ? 'uploaded' : 'unchanged'}, revision ${result.revision}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
