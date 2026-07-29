import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const workerSource = await fs.readFile(new URL('../../../worker/worker.js', import.meta.url), 'utf8');
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`);

test('legacy Database paths temporarily redirect to the exact encoded alias and preserve query strings', async () => {
  const request = new Request('https://pengo.gg/Database/Game%20Art/Caf%C3%A9%20%231.png?v=old');
  const response = await worker.fetch(request, {}, {});
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://assets.pengo.gg/legacy/Database/Game%20Art/Caf%C3%A9%20%231.png?v=old');
  assert.match(response.headers.get('cache-control'), /max-age=300/);
});

test('local and dual artifacts serve an existing Database file from static assets first', async () => {
  const calls = [];
  const env = {
    ASSETS: {
      async fetch(request) {
        calls.push(new URL(request.url).pathname);
        return new Response('local bytes', { status: 200, headers: { 'Content-Type': 'image/png' } });
      },
    },
  };
  const response = await worker.fetch(new Request('https://pengo.gg/Database/Art/Hero.png'), env, {});
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'local bytes');
  assert.equal(response.redirected, false);
  assert.deepEqual(calls, ['/Database/Art/Hero.png']);
});

test('R2-only redirects when the static Database file is absent, with an explicit force-redirect override', async () => {
  const absent = {
    ASSETS: { async fetch() { return new Response('missing', { status: 404 }); } },
  };
  const automatic = await worker.fetch(new Request('https://pengo.gg/Database/Art/Hero.png'), absent, {});
  assert.equal(automatic.status, 302);
  assert.equal(automatic.headers.get('location'), 'https://assets.pengo.gg/legacy/Database/Art/Hero.png');

  const forced = await worker.fetch(new Request('https://pengo.gg/Database/Art/Hero.png'), {
    DATABASE_ASSET_LEGACY_REDIRECT: 'true',
    ASSETS: { async fetch() { throw new Error('force redirect must bypass ASSETS'); } },
  }, {});
  assert.equal(forced.status, 302);
});

test('legacy redirect rejects write methods and encoded separators/traversal', async () => {
  const method = await worker.fetch(new Request('https://pengo.gg/Database/a.png', { method: 'POST' }), {}, {});
  assert.equal(method.status, 405);
  for (const encoded of ['a%2fb.png', 'a%5cb.png', '%252e%252e%252fsecret.png']) {
    const response = await worker.fetch(new Request(`https://pengo.gg/Database/${encoded}`), {}, {});
    assert.equal(response.status, 400, encoded);
  }
});

test('emergency mode serves the alias through the private R2 binding', async () => {
  const calls = [];
  const env = {
    DATABASE_ASSETS_EMERGENCY: 'true',
    DATABASE_ASSETS: {
      async get(key) {
        calls.push(key);
        return {
          body: 'image bytes',
          size: 11,
          httpEtag: '"abc"',
          writeHttpMetadata(headers) { headers.set('Content-Type', 'image/png'); },
        };
      },
    },
  };
  const response = await worker.fetch(new Request('https://pengo.gg/Database/Art/Hero.png'), env, {});
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'image bytes');
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(calls, ['legacy/Database/Art/Hero.png']);
});

test('emergency mode returns 206 with exact range headers', async () => {
  const env = {
    DATABASE_ASSETS_EMERGENCY: 'true',
    DATABASE_ASSETS: {
      async get(key, options) {
        assert.equal(key, 'legacy/Database/Art/Hero.png');
        assert.equal(options.range.get('range'), 'bytes=2-5');
        return {
          body: 'mage',
          size: 11,
          range: { offset: 2, length: 4 },
          httpEtag: '"abc"',
          writeHttpMetadata(headers) { headers.set('Content-Type', 'image/png'); },
        };
      },
    },
  };
  const response = await worker.fetch(new Request('https://pengo.gg/Database/Art/Hero.png', {
    headers: { Range: 'bytes=2-5' },
  }), env, {});
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 2-5/11');
  assert.equal(response.headers.get('content-length'), '4');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(await response.text(), 'mage');
});

test('emergency mode returns 304 for a matching conditional request', async () => {
  const env = {
    DATABASE_ASSETS_EMERGENCY: 'true',
    DATABASE_ASSETS: {
      async get(key, options) {
        assert.equal(options.onlyIf.get('if-none-match'), '"abc"');
        return {
          size: 11,
          httpEtag: '"abc"',
          writeHttpMetadata(headers) { headers.set('Content-Type', 'image/png'); },
        };
      },
    },
  };
  const response = await worker.fetch(new Request('https://pengo.gg/Database/Art/Hero.png', {
    headers: { 'If-None-Match': '"abc"' },
  }), env, {});
  assert.equal(response.status, 304);
  assert.equal(response.headers.get('etag'), '"abc"');
  assert.equal(await response.text(), '');
});

test('emergency mode returns 412 for failed write preconditions before cache validators', async () => {
  const env = {
    DATABASE_ASSETS_EMERGENCY: 'true',
    DATABASE_ASSETS: {
      async get() {
        return {
          size: 11,
          httpEtag: '"current"',
          uploaded: new Date('2026-07-29T12:00:00Z'),
          writeHttpMetadata(headers) { headers.set('Content-Type', 'image/png'); },
        };
      },
    },
  };
  const ifMatch = await worker.fetch(new Request('https://pengo.gg/Database/Art/Hero.png', {
    headers: {
      'If-Match': '"old"',
      'If-None-Match': '"current"',
    },
  }), env, {});
  assert.equal(ifMatch.status, 412);

  const unmodified = await worker.fetch(new Request('https://pengo.gg/Database/Art/Hero.png', {
    headers: {
      'If-Unmodified-Since': 'Tue, 28 Jul 2026 12:00:00 GMT',
      'If-Modified-Since': 'Thu, 30 Jul 2026 12:00:00 GMT',
    },
  }), env, {});
  assert.equal(unmodified.status, 412);
});

test('emergency conditional precedence permits 304 only after write preconditions pass', async () => {
  const env = {
    DATABASE_ASSETS_EMERGENCY: 'true',
    DATABASE_ASSETS: {
      async get() {
        return {
          size: 11,
          httpEtag: '"current"',
          uploaded: new Date('2026-07-29T12:00:00Z'),
          writeHttpMetadata(headers) { headers.set('Content-Type', 'image/png'); },
        };
      },
    },
  };
  const response = await worker.fetch(new Request('https://pengo.gg/Database/Art/Hero.png', {
    headers: {
      'If-Match': '"current"',
      'If-None-Match': 'W/"current"',
    },
  }), env, {});
  assert.equal(response.status, 304);
});

test('emergency date conditions compare R2 upload time at HTTP whole-second precision', async () => {
  const env = {
    DATABASE_ASSETS_EMERGENCY: 'true',
    DATABASE_ASSETS: {
      async get() {
        return {
          size: 11,
          httpEtag: '"current"',
          uploaded: new Date('2026-07-29T12:00:00.900Z'),
          writeHttpMetadata(headers) { headers.set('Content-Type', 'image/png'); },
        };
      },
    },
  };
  const modified = await worker.fetch(new Request('https://pengo.gg/Database/Art/Hero.png', {
    headers: { 'If-Modified-Since': 'Wed, 29 Jul 2026 12:00:00 GMT' },
  }), env, {});
  assert.equal(modified.status, 304);

  const writeThenCache = await worker.fetch(new Request('https://pengo.gg/Database/Art/Hero.png', {
    headers: {
      'If-Unmodified-Since': 'Wed, 29 Jul 2026 12:00:00 GMT',
      'If-None-Match': '"current"',
    },
  }), env, {});
  assert.equal(writeThenCache.status, 304);
});
