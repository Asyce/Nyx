import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { encodeAssetKey } from '../database-assets.mjs';
import {
  buildLiveCheckTargets,
  runLiveAssetChecks,
} from '../live-check-database-assets-lib.mjs';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function entry(sourcePath, bytes, objectName) {
  const sha = sha256(bytes);
  const objectKey = `objects/sha256/${sha.slice(0, 2)}/${objectName || `${sha}.png`}`;
  return {
    sourcePath,
    sha256: sha,
    bytes: bytes.length,
    mediaType: 'image/png',
    width: 1,
    height: 1,
    objectKey,
    publicUrl: `https://assets.pengo.gg/${encodeAssetKey(objectKey)}`,
    legacyKey: `legacy/${sourcePath}`,
  };
}

function manifest(entries) {
  return {
    schemaVersion: 1,
    gitCommit: 'a'.repeat(40),
    generatedAt: '2026-07-29T00:00:00Z',
    assetOrigin: 'https://assets.pengo.gg',
    totals: { assets: entries.length },
    entries,
  };
}

function fakeResponse(bytes, {
  redirected = false,
  url = '',
  mediaType = 'image/png',
  cacheControl,
} = {}) {
  const headers = new Headers({ 'Content-Type': mediaType });
  if (cacheControl) headers.set('Cache-Control', cacheControl);
  return {
    ok: true,
    status: 200,
    redirected,
    url,
    headers,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

test('full mode GET-verifies unique canonicals, direct aliases, and every old production path', async () => {
  const shared = Buffer.from('same immutable bytes');
  const other = Buffer.from('different immutable bytes');
  const entries = [
    entry('Database/Art/Caf\u00e9 \u2014 hero\u200b.png', shared),
    entry('Database/Art/Copy of hero.png', shared),
    entry('Database/Art/Other.png', other),
  ];
  const exact = manifest(entries);
  const staticSourcePaths = new Set(entries.slice(0, 2).map((row) => row.sourcePath));
  const targets = buildLiveCheckTargets(exact, { full: true, staticSourcePaths });
  assert.equal(targets.canonical.length, 2);
  assert.equal(targets.directAliases.length, 3);
  assert.equal(targets.oldPaths.length, 3);
  assert.equal(targets.oldPaths[0].mediaType, undefined);
  assert.equal(targets.oldPaths[0].cacheControl, undefined);
  assert.equal(targets.oldPaths[2].mediaType, 'image/png');

  const expected = new Map();
  for (const target of targets.canonical) expected.set(target.url, {
    bytes: entries.find((row) => row.sha256 === target.sha256).sourcePath === entries[2].sourcePath ? other : shared,
    mediaType: target.mediaType,
    cacheControl: target.cacheControl,
  });
  for (const target of targets.directAliases) {
    const source = entries.find((row) => row.sourcePath === target.sourcePath);
    expected.set(target.url, {
      bytes: source === entries[2] ? other : shared,
      mediaType: target.mediaType,
      cacheControl: target.cacheControl,
    });
  }
  for (const target of targets.oldPaths) {
    const source = entries.find((row) => row.sourcePath === target.sourcePath);
    expected.set(target.url, {
      bytes: source === entries[2] ? other : shared,
      redirected: target.redirectExpectation === 'required',
      url: target.expectedFinalUrl || target.url,
      mediaType: target.mediaType,
      cacheControl: target.cacheControl,
    });
  }
  const calls = [];
  const result = await runLiveAssetChecks(exact, {
    full: true,
    concurrency: 2,
    staticSourcePaths,
    fetchImpl: async (url) => {
      calls.push(url);
      const response = expected.get(url);
      assert(response, `unexpected URL ${url}`);
      return fakeResponse(response.bytes, response);
    },
    sleep: async () => {},
  });
  assert.deepEqual(result, {
    mode: 'full', canonical: 2, directAliases: 3, oldPaths: 3, total: 8,
  });
  assert.equal(calls.length, 8);
  assert.deepEqual(new Set(calls), new Set(targets.all.map((target) => target.url)));
});

test('full mode obeys its concurrency bound and retries transient GET failures', async () => {
  const entries = Array.from({ length: 4 }, (_, index) => (
    entry(`Database/Art/${index}.png`, Buffer.from(`bytes-${index}`))
  ));
  const exact = manifest(entries);
  const staticSourcePaths = new Set();
  const targets = buildLiveCheckTargets(exact, { full: true, staticSourcePaths });
  const byUrl = new Map(targets.all.map((target) => [
    target.url,
    {
      bytes: Buffer.from(`bytes-${entries.findIndex((row) => row.sourcePath === target.sourcePath)}`),
      redirected: target.redirectExpectation === 'required',
      url: target.expectedFinalUrl || target.url,
      mediaType: target.mediaType,
      cacheControl: target.cacheControl,
    },
  ]));
  let active = 0;
  let maximumActive = 0;
  let transient = true;
  const sleeps = [];
  await runLiveAssetChecks(exact, {
    full: true,
    concurrency: 2,
    attempts: 2,
    staticSourcePaths,
    sleep: async (ms) => { sleeps.push(ms); },
    fetchImpl: async (url) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (transient) {
        transient = false;
        return { ok: false, status: 503 };
      }
      const response = byUrl.get(url);
      return fakeResponse(response.bytes, response);
    },
  });
  assert(maximumActive <= 2);
  assert.deepEqual(sleeps, [2_000]);
});

test('full mode fails clearly on a corrupt direct public alias without trusting metadata', async () => {
  const bytes = Buffer.from('expected');
  const exact = manifest([entry('Database/Art/Hero.png', bytes)]);
  const targets = buildLiveCheckTargets(exact, { full: true });
  await assert.rejects(
    runLiveAssetChecks(exact, {
      full: true,
      attempts: 1,
      concurrency: 1,
      fetchImpl: async (url) => {
        const target = targets.all.find((candidate) => candidate.url === url);
        const body = target.kind === 'direct legacy alias' ? Buffer.from('corrupt!') : bytes;
        return fakeResponse(body, {
          redirected: target.redirectExpectation === 'required',
          url: target.expectedFinalUrl || target.url,
          mediaType: target.mediaType,
          cacheControl: target.cacheControl,
        });
      },
    }),
    /direct legacy alias failed after 1 GET attempts.*Database\/Art\/Hero\.png.*expected .* got/s,
  );
});

test('public checks reject wrong MIME and cache metadata even when bytes are correct', async () => {
  const bytes = Buffer.from('expected');
  const exact = manifest([entry('Database/Art/Hero.png', bytes)]);
  const targets = buildLiveCheckTargets(exact, { full: true, staticSourcePaths: new Set() });
  for (const failure of ['mediaType', 'cacheControl']) {
    await assert.rejects(
      runLiveAssetChecks(exact, {
        full: true,
        attempts: 1,
        concurrency: 1,
        staticSourcePaths: new Set(),
        fetchImpl: async (url) => {
          const target = targets.all.find((candidate) => candidate.url === url);
          return fakeResponse(bytes, {
            redirected: target.redirectExpectation === 'required',
            url: target.expectedFinalUrl || target.url,
            mediaType: failure === 'mediaType' ? 'text/plain' : target.mediaType,
            cacheControl: failure === 'cacheControl'
              ? 'public, max-age=1'
              : target.cacheControl,
          });
        },
      }),
      failure === 'mediaType' ? /expected Content-Type image\/png/ : /expected Cache-Control/,
    );
  }
});
