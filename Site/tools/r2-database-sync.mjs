import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DATABASE_ASSET_METADATA } from './database-assets.mjs';

export const R2_METADATA = DATABASE_ASSET_METADATA;

function sha256(value, encoding = 'hex') {
  return crypto.createHash('sha256').update(value).digest(encoding);
}

export function assertR2SyncConcurrency(concurrency) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) {
    throw new Error(`R2 sync concurrency must be an integer from 1 to 64, got ${concurrency}`);
  }
  return concurrency;
}

export class R2S3Client {
  constructor({
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket = 'nyx-database-assets',
    sdkClient,
  }) {
    if (!accountId || !accessKeyId || !secretAccessKey) throw new Error('R2 S3 credentials are incomplete');
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/i.test(bucket)) throw new Error(`invalid R2 bucket ${JSON.stringify(bucket)}`);
    this.bucket = bucket;
    this.operations = [];
    this.sdk = sdkClient || new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async send(command, method, key) {
    const allowedCommands = {
      HEAD: 'HeadObjectCommand',
      GET: 'GetObjectCommand',
      PUT: 'PutObjectCommand',
    };
    if (allowedCommands[method] !== command?.constructor?.name) {
      throw new Error(`${command?.constructor?.name || method} is forbidden for the zero-loss R2 migration`);
    }
    this.operations.push({ method, key });
    return this.sdk.send(command);
  }

  async head(key) {
    try {
      const response = await this.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), 'HEAD', key);
      return {
        bytes: Number(response.ContentLength),
        sha256: response.Metadata?.['pengo-sha256'] || null,
        mediaType: response.ContentType || null,
        cacheControl: response.CacheControl || null,
      };
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') return null;
      throw error;
    }
  }

  async get(key) {
    const response = await this.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), 'GET', key);
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async put(key, bytes, { mediaType, sha, cacheControl }) {
    await this.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: bytes,
      ContentLength: bytes.length,
      ContentType: mediaType,
      CacheControl: cacheControl,
      Metadata: { 'pengo-sha256': sha },
    }), 'PUT', key);
  }
}

export function validatePriorManifest(prior, expectedOrigin) {
  if (!prior) return null;
  if (prior.schemaVersion !== 1 || prior.assetOrigin !== expectedOrigin || !Array.isArray(prior.entries)) {
    throw new Error('remote latest Database asset manifest is incompatible');
  }
  const sources = new Map();
  const objects = new Map();
  for (const entry of prior.entries) {
    if (!entry?.sourcePath || !/^[a-f0-9]{64}$/.test(entry.sha256 || '')
      || !entry.objectKey || !entry.legacyKey) throw new Error('remote latest Database asset manifest has an invalid entry');
    sources.set(entry.sourcePath, entry);
    const priorSha = objects.get(entry.objectKey);
    if (priorSha && priorSha !== entry.sha256) throw new Error(`remote manifest object collision at ${entry.objectKey}`);
    objects.set(entry.objectKey, entry.sha256);
  }
  return { sources, objects };
}

async function mapLimit(items, concurrency, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await fn(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function verifyHead(client, key, expected) {
  const head = await client.head(key);
  if (!head
    || head.bytes !== expected.bytes
    || head.sha256 !== expected.sha256
    || head.mediaType !== expected.mediaType
    || head.cacheControl !== expected.cacheControl) {
    throw new Error(`R2 HEAD verification failed for ${key}: expected ${expected.bytes} bytes, ${expected.sha256}, ${expected.mediaType}, ${expected.cacheControl}; got ${JSON.stringify(head)}`);
  }
}

async function verifyGet(client, key, expected) {
  const bytes = await client.get(key);
  if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) {
    throw new Error(`R2 full read-back verification failed for ${key}`);
  }
}

export async function syncDatabaseAssets({
  manifest,
  rootDir,
  client,
  apply = false,
  concurrency = 8,
  readFile = fs.readFile,
  priorManifest,
  verifyAll = false,
}) {
  if (!manifest || !Array.isArray(manifest.entries) || !manifest.entries.length) {
    throw new Error('a non-empty Database asset manifest is required');
  }
  if (!rootDir) throw new Error('rootDir is required');
  if (apply && !client) throw new Error('an R2 client is required with apply=true');
  assertR2SyncConcurrency(concurrency);
  validatePriorManifest(priorManifest, manifest.assetOrigin);
  const uniqueObjects = new Map();
  for (const entry of manifest.entries) {
    const existing = uniqueObjects.get(entry.objectKey);
    if (existing && existing.sha256 !== entry.sha256) throw new Error(`canonical object collision at ${entry.objectKey}`);
    if (!existing) uniqueObjects.set(entry.objectKey, entry);
  }
  const objectEntries = [...uniqueObjects.values()];
  const plan = {
    canonicalChecks: 0,
    canonicalUploads: 0,
    aliasChecks: 0,
    aliasUploads: 0,
    manifestUploads: 0,
    verificationGets: 0,
  };

  await mapLimit(objectEntries, concurrency, async (entry) => {
    plan.canonicalChecks += 1;
    if (!apply) {
      plan.canonicalUploads += 1;
      return;
    }
    const head = await client.head(entry.objectKey);
    if (head) {
      if (head.sha256 !== entry.sha256
        || head.bytes !== entry.bytes
        || head.mediaType !== entry.mediaType
        || head.cacheControl !== R2_METADATA.canonicalCacheControl) {
        throw new Error(`immutable canonical object differs at ${entry.objectKey}; refusing to overwrite`);
      }
      return;
    }
    const bytes = await readFile(path.resolve(rootDir, ...entry.sourcePath.split('/')));
    if (sha256(bytes) !== entry.sha256 || bytes.length !== entry.bytes) {
      throw new Error(`${entry.sourcePath} changed after inventory; refusing upload`);
    }
    await client.put(entry.objectKey, bytes, {
      mediaType: entry.mediaType,
      sha: entry.sha256,
      cacheControl: R2_METADATA.canonicalCacheControl,
    });
    plan.canonicalUploads += 1;
    const expected = { ...entry, cacheControl: R2_METADATA.canonicalCacheControl };
    await verifyHead(client, entry.objectKey, expected);
    await verifyGet(client, entry.objectKey, entry);
    plan.verificationGets += 1;
  });

  await mapLimit(manifest.entries, concurrency, async (entry) => {
    plan.aliasChecks += 1;
    if (!apply) {
      plan.aliasUploads += 1;
      return;
    }
    const head = await client.head(entry.legacyKey);
    if (head?.sha256 === entry.sha256 && head.bytes === entry.bytes) {
      if (head.mediaType !== entry.mediaType || head.cacheControl !== R2_METADATA.aliasCacheControl) {
        throw new Error(`legacy alias metadata differs at ${entry.legacyKey}; refusing to publish latest`);
      }
      return;
    }
    const bytes = await readFile(path.resolve(rootDir, ...entry.sourcePath.split('/')));
    if (sha256(bytes) !== entry.sha256 || bytes.length !== entry.bytes) {
      throw new Error(`${entry.sourcePath} changed after inventory; refusing alias upload`);
    }
    await client.put(entry.legacyKey, bytes, {
      mediaType: entry.mediaType,
      sha: entry.sha256,
      cacheControl: R2_METADATA.aliasCacheControl,
    });
    plan.aliasUploads += 1;
    const expected = { ...entry, cacheControl: R2_METADATA.aliasCacheControl };
    await verifyHead(client, entry.legacyKey, expected);
    await verifyGet(client, entry.legacyKey, entry);
    plan.verificationGets += 1;
  });

  if (apply && verifyAll) {
    await mapLimit(objectEntries, concurrency, async (entry) => {
      await verifyGet(client, entry.objectKey, entry);
      plan.verificationGets += 1;
    });
    await mapLimit(manifest.entries, concurrency, async (entry) => {
      await verifyGet(client, entry.legacyKey, entry);
      plan.verificationGets += 1;
    });
  }

  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const manifestSha = sha256(manifestBytes);
  const releaseKey = `_manifests/releases/${manifest.gitCommit}.json`;
  const latestKey = '_manifests/latest.json';
  if (!apply) {
    plan.manifestUploads = 2;
    return { ...plan, releaseKey, latestKey };
  }
  const releaseHead = await client.head(releaseKey);
  if (releaseHead) {
    await verifyHead(client, releaseKey, {
      bytes: manifestBytes.length,
      sha256: manifestSha,
      mediaType: R2_METADATA.manifestMediaType,
      cacheControl: R2_METADATA.releaseCacheControl,
    });
  } else {
    await client.put(releaseKey, manifestBytes, {
      mediaType: R2_METADATA.manifestMediaType,
      sha: manifestSha,
      cacheControl: R2_METADATA.releaseCacheControl,
    });
    plan.manifestUploads += 1;
    const expected = {
      bytes: manifestBytes.length,
      sha256: manifestSha,
      mediaType: R2_METADATA.manifestMediaType,
      cacheControl: R2_METADATA.releaseCacheControl,
    };
    await verifyHead(client, releaseKey, expected);
    await verifyGet(client, releaseKey, expected);
    plan.verificationGets += 1;
  }
  await client.put(latestKey, manifestBytes, {
    mediaType: R2_METADATA.manifestMediaType,
    sha: manifestSha,
    cacheControl: R2_METADATA.latestCacheControl,
  });
  plan.manifestUploads += 1;
  const latestExpected = {
    bytes: manifestBytes.length,
    sha256: manifestSha,
    mediaType: R2_METADATA.manifestMediaType,
    cacheControl: R2_METADATA.latestCacheControl,
  };
  await verifyHead(client, latestKey, latestExpected);
  await verifyGet(client, latestKey, latestExpected);
  plan.verificationGets += 1;
  return { ...plan, releaseKey, latestKey };
}

export async function loadRemoteLatestManifest(client) {
  const head = await client.head('_manifests/latest.json');
  if (!head) return null;
  const bytes = await client.get('_manifests/latest.json');
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('remote latest Database asset manifest is not valid JSON');
  }
}
