import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import test from 'node:test';
import {
  DATABASE_ASSET_METADATA,
  buildDatabaseAssetEntry,
} from '../database-assets.mjs';
import {
  normalizeR2Credentials,
  R2S3Client,
  syncDatabaseAssets,
} from '../r2-database-sync.mjs';

async function png(width = 3, height = 5) {
  return sharp({
    create: { width, height, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
  }).png().toBuffer();
}

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

class MemoryR2 {
  constructor() {
    this.objects = new Map();
    this.operations = [];
  }
  async head(key) {
    this.operations.push(['HEAD', key]);
    const object = this.objects.get(key);
    return object ? {
      bytes: object.bytes.length,
      sha256: object.sha256,
      mediaType: object.mediaType,
      cacheControl: object.cacheControl,
    } : null;
  }
  async get(key) {
    this.operations.push(['GET', key]);
    const object = this.objects.get(key);
    if (!object) throw new Error(`missing ${key}`);
    return object.bytes;
  }
  async put(key, bytes, options) {
    this.operations.push(['PUT', key]);
    this.objects.set(key, {
      bytes: Buffer.from(bytes),
      sha256: options.sha,
      mediaType: options.mediaType,
      cacheControl: options.cacheControl,
    });
  }
}

test('official-SDK wrapper refuses every command outside HEAD, GET, and PUT', async () => {
  const client = new R2S3Client({
    accountId: 'account',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
    sdkClient: { async send() { throw new Error('must not reach SDK'); } },
  });
  class DeleteObjectCommand {}
  await assert.rejects(client.send(new DeleteObjectCommand(), 'DELETE', 'unsafe'), /forbidden/);
  assert.deepEqual(client.operations, []);
});

test('R2 credentials are trimmed and control characters fail before HTTP signing', () => {
  assert.deepEqual(normalizeR2Credentials({
    accountId: ' account123 \r\n',
    accessKeyId: '\tACCESS123\n',
    secretAccessKey: ' SECRET/+=123 \r\n',
  }), {
    accountId: 'account123',
    accessKeyId: 'ACCESS123',
    secretAccessKey: 'SECRET/+=123',
  });
  assert.throws(() => normalizeR2Credentials({
    accountId: 'account123',
    accessKeyId: 'ACCESS\n123',
    secretAccessKey: 'SECRET123',
  }), /invalid whitespace or characters/);
});

test('empty manifests and invalid concurrency fail before any R2 operation', async () => {
  for (const options of [
    {
      manifest: {
        schemaVersion: 1,
        gitCommit: 'a'.repeat(40),
        assetOrigin: 'https://assets.pengo.gg',
        entries: [],
      },
      concurrency: 1,
      expected: /non-empty Database asset manifest/,
    },
    {
      manifest: {
        schemaVersion: 1,
        gitCommit: 'a'.repeat(40),
        assetOrigin: 'https://assets.pengo.gg',
        entries: [{ sourcePath: 'Database/a.png' }],
      },
      concurrency: 0,
      expected: /integer from 1 to 64/,
    },
    {
      manifest: {
        schemaVersion: 1,
        gitCommit: 'a'.repeat(40),
        assetOrigin: 'https://assets.pengo.gg',
        entries: [{ sourcePath: 'Database/a.png' }],
      },
      concurrency: 1.5,
      expected: /integer from 1 to 64/,
    },
  ]) {
    const client = new MemoryR2();
    await assert.rejects(syncDatabaseAssets({
      ...options,
      rootDir: os.tmpdir(),
      client,
      apply: true,
    }), options.expected);
    assert.deepEqual(client.operations, []);
    assert.equal(client.objects.size, 0);
  }
});

async function fixture() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nyx-r2-test-'));
  const sourcePath = 'Database/Art/Hero.png';
  const bytes = await png();
  await fs.mkdir(path.join(rootDir, 'Database', 'Art'), { recursive: true });
  await fs.writeFile(path.join(rootDir, 'Database', 'Art', 'Hero.png'), bytes);
  const entry = await buildDatabaseAssetEntry(sourcePath, bytes);
  const manifest = {
    schemaVersion: 1,
    gitCommit: 'a'.repeat(40),
    generatedAt: '2026-07-29T00:00:00Z',
    assetOrigin: 'https://assets.pengo.gg',
    totals: { assets: 1, bytes: bytes.length, uniqueObjects: 1 },
    entries: [entry],
  };
  return { rootDir, bytes, entry, manifest };
}

test('sync is additive, verifies uploads, and publishes manifests last', async (t) => {
  const { rootDir, entry, manifest } = await fixture();
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const client = new MemoryR2();
  const result = await syncDatabaseAssets({ manifest, rootDir, client, apply: true, concurrency: 2 });
  assert.equal(result.canonicalUploads, 1);
  assert.equal(result.aliasUploads, 1);
  assert.equal(result.manifestUploads, 2);
  assert(client.objects.has(entry.objectKey));
  assert(client.objects.has(entry.legacyKey));
  assert(client.operations.every(([method]) => method !== 'DELETE'));
  const puts = client.operations.filter(([method]) => method === 'PUT').map(([, key]) => key);
  const gets = client.operations.filter(([method]) => method === 'GET').map(([, key]) => key);
  assert.deepEqual(puts.slice(-2), [
    `_manifests/releases/${manifest.gitCommit}.json`,
    '_manifests/latest.json',
  ]);
  assert.deepEqual(new Set(gets), new Set(puts));
  assert.equal(result.verificationGets, 4);
  assert.deepEqual(
    {
      mediaType: client.objects.get(entry.objectKey).mediaType,
      cacheControl: client.objects.get(entry.objectKey).cacheControl,
    },
    {
      mediaType: entry.mediaType,
      cacheControl: DATABASE_ASSET_METADATA.canonicalCacheControl,
    },
  );
  assert.equal(client.objects.get(entry.legacyKey).cacheControl, DATABASE_ASSET_METADATA.aliasCacheControl);
  assert.equal(
    client.objects.get(`_manifests/releases/${manifest.gitCommit}.json`).cacheControl,
    DATABASE_ASSET_METADATA.releaseCacheControl,
  );
  assert.equal(
    client.objects.get('_manifests/latest.json').cacheControl,
    DATABASE_ASSET_METADATA.latestCacheControl,
  );
});

test('canonical objects are immutable and never overwritten on a mismatch', async (t) => {
  const { rootDir, entry, manifest } = await fixture();
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const client = new MemoryR2();
  const wrong = Buffer.from('wrong');
  client.objects.set(entry.objectKey, {
    bytes: wrong,
    sha256: hash(wrong),
    mediaType: 'image/png',
    cacheControl: DATABASE_ASSET_METADATA.canonicalCacheControl,
  });
  await assert.rejects(
    syncDatabaseAssets({ manifest, rootDir, client, apply: true }),
    /refusing to overwrite/,
  );
  assert.equal(client.objects.get(entry.objectKey).bytes.toString(), 'wrong');
  assert(!client.operations.some(([method, key]) => method === 'PUT' && key === entry.objectKey));
});

test('source mutation after inventory aborts before uploading that object', async (t) => {
  const { rootDir, entry, manifest } = await fixture();
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(rootDir, ...entry.sourcePath.split('/')), await png(9, 9));
  const client = new MemoryR2();
  await assert.rejects(
    syncDatabaseAssets({ manifest, rootDir, client, apply: true }),
    /changed after inventory/,
  );
  assert(!client.operations.some(([method]) => method === 'PUT'));
});

test('prior manifests never bypass existing-object metadata checks', async (t) => {
  const { rootDir, entry, manifest } = await fixture();
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const client = new MemoryR2();
  await syncDatabaseAssets({ manifest, rootDir, client, apply: true });
  client.operations.length = 0;
  const result = await syncDatabaseAssets({
    manifest,
    rootDir,
    client,
    apply: true,
    priorManifest: manifest,
  });
  assert.equal(result.canonicalChecks, 1);
  assert.equal(result.aliasChecks, 1);
  assert(client.operations.some(([method, key]) => method === 'HEAD' && key === entry.objectKey));
  assert(client.operations.some(([method, key]) => method === 'HEAD' && key === entry.legacyKey));
  assert(!client.operations.some(([method, key]) => method === 'PUT'
    && (key === entry.objectKey || key === entry.legacyKey)));
  assert.equal(result.verificationGets, 1);
  assert.deepEqual(client.operations.at(-3), ['PUT', '_manifests/latest.json']);
});

test('initial-cutover verification GETs and hashes every canonical object and alias', async (t) => {
  const { rootDir, entry, manifest } = await fixture();
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const client = new MemoryR2();
  const result = await syncDatabaseAssets({
    manifest,
    rootDir,
    client,
    apply: true,
    verifyAll: true,
  });
  assert.equal(result.verificationGets, 6);
  const verifiedKeys = client.operations
    .filter(([method]) => method === 'GET')
    .map(([, key]) => key);
  assert.equal(verifiedKeys.filter((key) => key === entry.objectKey).length, 2);
  assert.equal(verifiedKeys.filter((key) => key === entry.legacyKey).length, 2);
});

test('initial-cutover verification fails on remotely corrupted bytes', async (t) => {
  const { rootDir, entry, manifest } = await fixture();
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const client = new MemoryR2();
  const originalPut = client.put.bind(client);
  client.put = async (key, bytes, options) => {
    await originalPut(key, bytes, options);
    if (key === entry.legacyKey) client.objects.get(key).bytes = Buffer.alloc(bytes.length, 0x7f);
  };
  await assert.rejects(
    syncDatabaseAssets({ manifest, rootDir, client, apply: true, verifyAll: true }),
    /full read-back verification failed/,
  );
  assert(!client.objects.has('_manifests/latest.json'));
});

test('correct asset bytes with wrong MIME or cache metadata stop before latest', async (t) => {
  const { rootDir, bytes, entry, manifest } = await fixture();
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const cases = [
    ['canonical MIME', entry.objectKey, 'text/plain', DATABASE_ASSET_METADATA.canonicalCacheControl],
    ['canonical cache', entry.objectKey, entry.mediaType, 'public, max-age=1'],
    ['alias MIME', entry.legacyKey, 'text/plain', DATABASE_ASSET_METADATA.aliasCacheControl],
    ['alias cache', entry.legacyKey, entry.mediaType, 'public, max-age=1'],
  ];
  for (const [name, key, mediaType, cacheControl] of cases) {
    const client = new MemoryR2();
    client.objects.set(entry.objectKey, {
      bytes,
      sha256: entry.sha256,
      mediaType: entry.mediaType,
      cacheControl: DATABASE_ASSET_METADATA.canonicalCacheControl,
    });
    if (key === entry.legacyKey) {
      client.objects.set(entry.legacyKey, {
        bytes,
        sha256: entry.sha256,
        mediaType,
        cacheControl,
      });
    } else {
      client.objects.get(entry.objectKey).mediaType = mediaType;
      client.objects.get(entry.objectKey).cacheControl = cacheControl;
    }
    await assert.rejects(
      syncDatabaseAssets({ manifest, rootDir, client, apply: true }),
      key === entry.objectKey ? /refusing to overwrite/ : /metadata differs/,
      name,
    );
    assert(!client.operations.some(([method, operationKey]) => (
      method === 'PUT' && operationKey === '_manifests/latest.json'
    )), `${name} must stop before latest`);
  }
});

test('newly uploaded asset metadata is HEAD-verified before aliases or latest', async (t) => {
  const { rootDir, entry, manifest } = await fixture();
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const client = new MemoryR2();
  const originalPut = client.put.bind(client);
  client.put = async (key, bytes, options) => {
    await originalPut(key, bytes, options);
    if (key === entry.objectKey) client.objects.get(key).cacheControl = 'public, max-age=1';
  };
  await assert.rejects(
    syncDatabaseAssets({ manifest, rootDir, client, apply: true }),
    /HEAD verification failed/,
  );
  assert(!client.objects.has(entry.legacyKey));
  assert(!client.objects.has('_manifests/latest.json'));
});

test('existing release manifest metadata is verified before latest is refreshed', async (t) => {
  const { rootDir, manifest } = await fixture();
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const client = new MemoryR2();
  await syncDatabaseAssets({ manifest, rootDir, client, apply: true });
  const releaseKey = `_manifests/releases/${manifest.gitCommit}.json`;
  client.objects.get(releaseKey).mediaType = 'text/plain';
  client.operations.length = 0;
  await assert.rejects(
    syncDatabaseAssets({ manifest, rootDir, client, apply: true }),
    /HEAD verification failed/,
  );
  assert(!client.operations.some(([method, key]) => (
    method === 'PUT' && key === '_manifests/latest.json'
  )));
});

test('new release and latest manifest metadata are HEAD-verified', async (t) => {
  const { rootDir, manifest } = await fixture();
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  for (const corruptKey of [
    `_manifests/releases/${manifest.gitCommit}.json`,
    '_manifests/latest.json',
  ]) {
    const client = new MemoryR2();
    const originalPut = client.put.bind(client);
    client.put = async (key, bytes, options) => {
      await originalPut(key, bytes, options);
      if (key === corruptKey) client.objects.get(key).cacheControl = 'public, max-age=1';
    };
    await assert.rejects(
      syncDatabaseAssets({ manifest, rootDir, client, apply: true }),
      /HEAD verification failed/,
    );
    if (corruptKey.startsWith('_manifests/releases/')) {
      assert(!client.objects.has('_manifests/latest.json'));
    }
  }
});
