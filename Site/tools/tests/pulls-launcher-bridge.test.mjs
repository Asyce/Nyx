import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = await fs.readFile(
  path.resolve(here, '../../src/features/gacha/pulls-launcher-bridge.js'),
  'utf8',
);
const headers = await fs.readFile(path.resolve(here, '../../public/_headers'), 'utf8');
const buildSource = await fs.readFile(path.resolve(here, '../build-site.mjs'), 'utf8');
const trackerSource = await fs.readFile(path.resolve(here, '../../src/features/gacha/gacha-tracker.jsx'), 'utf8');
const overviewSource = await fs.readFile(path.resolve(here, '../../src/features/gacha/pulls-overview.jsx'), 'utf8');

const NONCE = 'A'.repeat(43);
const MAX_BYTES = 5 * 1024 * 1024;

function location(hash = '') {
  return { origin: 'https://pengo.gg', pathname: '/endfield', search: '?tab=pulls', hash };
}

function sandbox({ hash = '', fetch, importFile, replaceState, timers = {} } = {}) {
  const calls = [];
  const target = location(hash);
  const window = {
    location: target,
    history: {
      state: { keep: true },
      replaceState: (...args) => {
        calls.push(args);
        if (replaceState) replaceState(...args);
        target.hash = '';
      },
    },
  };
  if (fetch) window.fetch = fetch;
  if (importFile) window.NyxPulls = { importFile };
  const context = vm.createContext({
    window,
    AbortController,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    setTimeout: timers.setTimeout || setTimeout,
    clearTimeout: timers.clearTimeout || clearTimeout,
    Object,
    Promise,
    JSON,
  });
  vm.runInContext(source, context);
  return { bridge: window.PengoPullLauncherBridge, calls, target, window };
}

function validFragment({ port = '49152', nonce = NONCE } = {}) {
  return `#nyx-import=v2&type=pulls&port=${port}&nonce=${nonce}`;
}

function request(bridge, hash = validFragment()) {
  return bridge.consume(location(hash), { state: null, replaceState() {} });
}

function response(body, { contentType = 'application/json', contentLength, ok = true, redirected = false, stream = false } = {}) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const length = contentLength === undefined ? bytes.byteLength : contentLength;
  const headersMap = {
    'content-type': contentType,
    'content-length': String(length),
  };
  return {
    ok,
    redirected,
    headers: { get: (name) => headersMap[name.toLowerCase()] ?? null },
    ...(stream
      ? {
          body: {
            getReader() {
              let used = false;
              return {
                async read() {
                  if (used) return { done: true };
                  used = true;
                  return { done: false, value: bytes };
                },
                releaseLock() {},
                async cancel() {},
              };
            },
          },
        }
      : { body: null, text: async () => body }),
  };
}

test('captures and clears a valid fragment synchronously, then exposes one pending Promise', async () => {
  const order = [];
  const handoff = validFragment({ port: '1024', nonce: NONCE });
  const { bridge, calls, target } = sandbox({
    hash: handoff,
    fetch: async () => {
      order.push('fetch');
      return response('{"kind":"pengo-pulls"}');
    },
    replaceState: () => order.push('clear'),
  });

  assert.deepEqual(calls, [[{ keep: true }, '', '/endfield?tab=pulls']]);
  assert.deepEqual(order, ['clear', 'fetch']);
  assert.equal(target.hash, '');
  assert.equal(bridge.hasPending(), true);
  const pending = bridge.takePending();
  assert.ok(pending && typeof pending.then === 'function');
  assert.equal(bridge.hasPending(), false);
  assert.equal(bridge.takePending(), null);
  assert.deepEqual(JSON.parse(JSON.stringify(await pending)), {
    text: '{"kind":"pengo-pulls"}',
    payload: { kind: 'pengo-pulls' },
    schemaValidated: false,
  });
});

test('parses exact raw fields and accepts only the inclusive port range', () => {
  const { bridge } = sandbox();
  assert.match(request(bridge, validFragment({ port: '1024' })).endpoint, /:1024\//);
  assert.match(request(bridge, validFragment({ port: '65535' })).endpoint, /:65535\//);

  const malformed = [
    '#nyx-import=v2&type=pulls&port=49152',
    `${validFragment()}&extra=1`,
    validFragment().replace('&type=pulls', '&type=pulls&type=pulls'),
    validFragment().replace('port=49152', 'port=049152'),
    validFragment().replace('port=49152', 'port=1023'),
    validFragment().replace('port=49152', 'port=1000'),
    validFragment().replace('port=49152', 'port=65536'),
    validFragment().replace('nonce=' + NONCE, 'nonce=' + 'A'.repeat(42)),
    validFragment().replace('nonce=' + NONCE, 'nonce=' + 'A'.repeat(44)),
    validFragment().replace('nonce=' + NONCE, 'nonce=' + 'A'.repeat(42) + '+'),
    validFragment().replace('nonce=' + NONCE, 'nonce=' + 'A'.repeat(42) + '%2F'),
    validFragment().replace('port=49152', 'port=49%152'),
    validFragment().replace('type=pulls', 'type=pull+s'),
    validFragment().replace('&type=pulls&port=', '&port=').replace('&nonce=', '&type=pulls&nonce='),
    '#nyx-import=v2&type=pulls&port=49152&nonce=' + NONCE + '=extra',
  ];
  for (const hash of malformed) {
    assert.throws(() => bridge.consume(location(hash), { replaceState() {} }), /invalid or has expired/);
  }
});

test('accepts only the production or exact local Endfield page', () => {
  const { bridge } = sandbox();
  const wrongRoute = location(validFragment({ nonce: 'B'.repeat(43) }));
  wrongRoute.pathname = '/hsr';
  assert.throws(() => bridge.consume(wrongRoute, { replaceState() {} }), /invalid or has expired/);

  const wrongOrigin = location(validFragment({ nonce: 'C'.repeat(43) }));
  wrongOrigin.origin = 'http://localhost:5173';
  assert.throws(() => bridge.consume(wrongOrigin, { replaceState() {} }), /invalid or has expired/);

  const missingOrigin = location(validFragment({ nonce: 'E'.repeat(43) }));
  missingOrigin.origin = '';
  assert.throws(() => bridge.consume(missingOrigin, { replaceState() {} }), /invalid or has expired/);

  const dev = location(validFragment({ nonce: 'D'.repeat(43) }));
  dev.origin = 'http://127.0.0.1:5173';
  assert.equal(bridge.consume(dev, { replaceState() {} }).type, 'pulls');
});

test('clears malformed recognized v2 fragments but leaves unrelated hashes untouched', () => {
  const { bridge, calls } = sandbox();
  const malformedLocation = location('#nyx-import=v2&type=pulls');
  const malformedHistory = { state: null, replaceState: (...args) => calls.push(args) };
  assert.throws(() => bridge.consume(malformedLocation, malformedHistory), /invalid or has expired/);
  assert.deepEqual(calls, [[null, '', '/endfield?tab=pulls']]);

  const unrelatedCalls = [];
  const unrelated = location('#section-2');
  assert.equal(bridge.consume(unrelated, { replaceState: (...args) => unrelatedCalls.push(args) }), null);
  assert.deepEqual(unrelatedCalls, []);
  assert.equal(unrelated.hash, '#section-2');
});

test('a fragment-clear failure performs no fetch', async () => {
  let fetched = false;
  const { bridge } = sandbox({
    fetch: async () => { fetched = true; return response('{}'); },
    replaceState: () => { throw new Error('history unavailable'); },
  });
  assert.throws(
    () => bridge.consume(location(validFragment()), { replaceState: () => { throw new Error('history unavailable'); } }),
    /invalid or has expired/,
  );
  assert.equal(fetched, false);
});

test('a consumed location cannot be consumed twice, including after the first attempt failed', () => {
  const { bridge } = sandbox();
  const target = location(validFragment());
  const history = { replaceState() {} };
  const first = bridge.consume(target, history);
  assert.equal(first.type, 'pulls');
  assert.equal(bridge.consume(target, history), null);
  assert.equal(bridge.consume(location(validFragment()), history), null);

  const failedTarget = location('#nyx-import=v2&type=pulls&port=1023&nonce=' + NONCE);
  assert.throws(() => bridge.consume(failedTarget, history), /invalid or has expired/);
  assert.equal(bridge.consume(failedTarget, history), null);
  assert.equal(bridge.consume(location(failedTarget.hash), history), null);
});

test('uses the exact loopback GET request options and returns an explicitly unvalidated payload', async () => {
  const { bridge } = sandbox();
  const handoff = request(bridge);
  const calls = [];
  const result = await bridge.fetchExport(handoff, {
    fetch: async (...args) => {
      calls.push(args);
      return response('{"kind":"pengo-pulls","version":1}');
    },
  });
  assert.equal(calls[0][0], handoff.endpoint);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    headers: { Accept: 'application/json' },
    signal: {},
  });
  assert.equal(result.schemaValidated, false);
  assert.deepEqual(result.payload, { kind: 'pengo-pulls', version: 1 });
});

test('uses the existing strict Endfield importer when it is the available parser', async () => {
  const parsed = [];
  const { bridge } = sandbox({ importFile: (game, value) => {
    parsed.push([game, value]);
    return { importKind: 'pengo-pulls-v1', pulls: [] };
  } });
  const result = await bridge.fetchExport(request(bridge), {
    fetch: async () => response('{"kind":"pengo-pulls"}'),
  });
  assert.deepEqual(parsed, [['ae', { kind: 'pengo-pulls' }]]);
  assert.equal(result.schemaValidated, true);

  const invalid = sandbox({ importFile: () => ({ error: 'invalid' }) });
  await assert.rejects(
    invalid.bridge.fetchExport(request(invalid.bridge), { fetch: async () => response('{}') }),
    /schema validation/,
  );
});

test('rejects failed status, redirects, wrong content type, and an oversized Content-Length without a payload', async () => {
  const { bridge } = sandbox();
  const handoff = request(bridge);
  const cases = [
    [response('{}', { ok: false }), /could not be received/],
    [response('{}', { redirected: true }), /could not be received/],
    [response('{}', { contentType: 'text/html' }), /unexpected response/],
    [response('{}', { contentType: 'application/json; charset=iso-8859-1' }), /unexpected response/],
    [response('{}', { contentLength: MAX_BYTES + 1 }), /too large/],
    [response('{}', { contentLength: 'not-a-length' }), /too large/],
  ];
  for (const [value, pattern] of cases) {
    await assert.rejects(bridge.fetchExport(handoff, { fetch: async () => value }), pattern);
  }
});

test('cancels an oversized streamed body before rejecting', async () => {
  const { bridge } = sandbox();
  let cancelled = false;
  let released = false;
  const value = new Uint8Array(MAX_BYTES + 1);
  const oversized = {
    ok: true,
    redirected: false,
    headers: { get: (name) => name === 'content-type' ? 'application/json' : null },
    body: {
      getReader: () => ({
        read: async () => ({ done: false, value }),
        cancel: async () => { cancelled = true; },
        releaseLock: () => { released = true; },
      }),
    },
  };
  await assert.rejects(
    bridge.fetchExport(request(bridge), { fetch: async () => oversized }),
    /too large/,
  );
  assert.equal(cancelled, true);
  assert.equal(released, true);
});

test('fatal-decodes streamed UTF-8 and rejects invalid JSON, null, and arrays', async () => {
  const { bridge } = sandbox();
  const handoff = { version: 'v2', type: 'pulls', endpoint: `http://127.0.0.1:49152/v2/pull-import/${NONCE}` };
  const invalidUtf8 = {
    ok: true,
    redirected: false,
    headers: { get: (name) => name === 'content-type' ? 'application/json' : null },
    body: { getReader: () => ({
      read: (() => {
        let used = false;
        return async () => used
          ? { done: true }
          : (used = true, { done: false, value: new Uint8Array([0xff]) });
      })(),
      releaseLock() {},
      cancel() {},
    }) },
  };
  await assert.rejects(
    bridge.fetchExport(handoff, { fetch: async () => invalidUtf8 }),
    /encoded|UTF-8|invalid/i,
  );

  for (const body of ['not-json', 'null', '[]']) {
    await assert.rejects(
      bridge.fetchExport(handoff, { fetch: async () => response(body) }),
      /invalid JSON object|invalid JSON/,
    );
  }
});

test('aborts exactly at the 15-second deadline and maps AbortError to a safe fallback', async () => {
  let timerCallback;
  let timerDelay;
  let rejectFetch;
  const timers = {
    setTimeout: (callback, delay) => { timerCallback = callback; timerDelay = delay; return 7; },
    clearTimeout: () => {},
  };
  const { bridge } = sandbox({ timers });
  const pending = bridge.fetchExport(request(bridge), {
    fetch: async (_url, options) => new Promise((resolve, reject) => {
      rejectFetch = reject;
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  assert.equal(timerDelay, 15_000);
  timerCallback();
  await assert.rejects(pending, /timed out/);
  assert.equal(typeof rejectFetch, 'function');
});

test('does not mutate storage or remove the manual-import path', () => {
  const sentinel = { savePulls: () => 'manual' };
  const { bridge, window } = sandbox();
  window.NyxPullStore = sentinel;
  assert.equal(bridge.takePending(), null);
  assert.equal(window.NyxPullStore, sentinel);
  assert.doesNotMatch(source, /localStorage|indexedDB|savePulls|importBundle/);
});

test('strict empty Endfield exports reach preview and can restore their metadata-only profile', () => {
  assert.match(trackerSource, /!res\.pulls\.length && !\(C\.key === 'ae' && res\.strict\)/);
  assert.match(trackerSource, /all\.length \|\| \(C\.key === 'ae' && summary\)/);
  assert.match(trackerSource, /if \(ids\.has\(pullId\)\) duplicateCount \+= 1;\s*else ids\.add\(pullId\);/);
});

test('every bundled Endfield pull summary omits unknown pity and uses its real top rarity', () => {
  assert.match(overviewSource, /views\.find\(\(view\) => !view\.pityUnavailable\)/);
  assert.match(overviewSource, /r\.pityUnavailable \? \(/);
  assert.match(overviewSource, /History only/);
  assert.match(overviewSource, /r\.topRank/);
  assert.match(overviewSource, /!r\.pityUnavailable && <i>/);
});

test('build order loads the bridge before pull and app consumers, and CSP allows only exact loopback HTTP', () => {
  assert.ok(buildSource.indexOf("'features/gacha/pulls-launcher-bridge.js'")
    < buildSource.indexOf("'features/gacha/pulls-engine.js'"));
  assert.ok(buildSource.indexOf("'features/gacha/pulls-launcher-bridge.js'")
    < buildSource.indexOf("'features/gacha/gacha-tracker.jsx'"));
  assert.ok(buildSource.indexOf("'features/gacha/pulls-launcher-bridge.js'")
    < buildSource.indexOf("'app/nyx-app.jsx'"));
  assert.match(headers, /connect-src 'self' http:\/\/127\.0\.0\.1:\*/);
  assert.doesNotMatch(headers, /connect-src[^;\r\n]*localhost/);
  assert.doesNotMatch(headers, /connect-src[^;\r\n]*https:\/\/127\.0\.0\.1/);
  assert.doesNotMatch(headers, /connect-src\s+\*/);
});
