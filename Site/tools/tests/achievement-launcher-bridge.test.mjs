import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = await fs.readFile(
  path.resolve(here, '../../src/features/achievements/achievement-launcher-bridge.js'),
  'utf8',
);
const headers = await fs.readFile(path.resolve(here, '../../public/_headers'), 'utf8');

function sandbox(){
  const window = {};
  const context = vm.createContext({
    window,
    URLSearchParams,
    AbortController,
    Uint8Array,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    Object,
  });
  vm.runInContext(source, context);
  return window.NyxAchievementLauncherBridge;
}

function location(hash){
  return { hash, pathname:'/hsr/achievements', search:'?profile=main' };
}

test('consumes an exact one-use launcher fragment and removes it from browser history', () => {
  const bridge = sandbox();
  const nonce = 'A'.repeat(43);
  const calls = [];
  const request = bridge.consume(
    location(`#nyx-import=v1&port=49152&nonce=${nonce}`),
    { state:{ safe:true }, replaceState:(...args) => calls.push(args) },
  );

  assert.deepEqual(JSON.parse(JSON.stringify(request)), {
    version:'v1',
    endpoint:`http://127.0.0.1:49152/v1/achievement-import/${nonce}`,
  });
  assert.deepEqual(calls, [[{ safe:true }, '', '/hsr/achievements?profile=main']]);
});

test('rejects duplicate, extra, malformed, and non-loopback handoff inputs', () => {
  const bridge = sandbox();
  const nonce = 'B'.repeat(43);
  const bad = [
    `#nyx-import=v2&port=49152&nonce=${nonce}`,
    `#nyx-import=v1&port=80&nonce=${nonce}`,
    `#nyx-import=v1&port=70000&nonce=${nonce}`,
    `#nyx-import=v1&port=49152&nonce=short`,
    `#nyx-import=v1&port=49152&nonce=${nonce}&extra=1`,
    `#nyx-import=v1&port=49152&port=49153&nonce=${nonce}`,
  ];
  for (const hash of bad) {
    assert.throws(
      () => bridge.consume(location(hash), { replaceState:() => {} }),
      /invalid or has expired/,
    );
  }
  assert.equal(bridge.consume(location('#ordinary-anchor'), { replaceState:() => {} }), null);
});

test('fetches only the validated loopback endpoint with secret-free browser options', async () => {
  const bridge = sandbox();
  const nonce = 'C'.repeat(43);
  const request = bridge.consume(
    location(`#nyx-import=v1&port=49152&nonce=${nonce}`),
    { replaceState:() => {} },
  );
  const calls = [];
  const body = '{"kind":"pengo-achievements"}';
  const result = await bridge.fetchExport(request, {
    fetch:async (...args) => {
      calls.push(args);
      return {
        ok:true,
        headers:{ get:(name) => name === 'content-type' ? 'application/json; charset=utf-8' : String(body.length) },
        body:null,
        text:async () => body,
      };
    },
  });

  assert.equal(result, body);
  assert.equal(calls[0][0], request.endpoint);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), {
    method:'GET',
    mode:'cors',
    credentials:'omit',
    cache:'no-store',
    redirect:'error',
    referrerPolicy:'no-referrer',
    signal:{},
  });
});

test('rejects wrong content types and oversized responses before import parsing', async () => {
  const bridge = sandbox();
  const request = {
    version:'v1',
    endpoint:`http://127.0.0.1:49152/v1/achievement-import/${'D'.repeat(43)}`,
  };
  await assert.rejects(
    bridge.fetchExport(request, {
      fetch:async () => ({
        ok:true,
        headers:{ get:(name) => name === 'content-type' ? 'text/html' : '12' },
      }),
    }),
    /unexpected response/,
  );
  await assert.rejects(
    bridge.fetchExport(request, {
      fetch:async () => ({
        ok:true,
        headers:{ get:(name) => name === 'content-type' ? 'application/json' : String(bridge.MAX_ARTIFACT_BYTES + 1) },
      }),
    }),
    /too large/,
  );
});

test('production CSP permits only the loopback transport needed by the launcher bridge', () => {
  assert.match(headers, /connect-src 'self' http:\/\/127\.0\.0\.1:\*/);
  assert.doesNotMatch(headers, /connect-src[^;\r\n]*localhost/);
  assert.doesNotMatch(headers, /connect-src\s+\*/);
});
