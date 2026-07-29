import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, '../..');
const rootDir = path.resolve(siteDir, '..');
const exporterPath = path.resolve(siteDir, 'public/scripts/pengo-hsr-hoyolab-achievements.js');
const exporterSource = await fs.readFile(exporterPath, 'utf8');
const expectedPage = {
  origin: 'https://act.hoyolab.com',
  pathname: '/sr/event/cultivation-tool/index.html',
};
const knownIds = [4010101, 4010201];
const genericError = 'The export could not finish. Stay signed in on this page and try again.';
const encoder = new TextEncoder();

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeHarness({
  location = expectedPage,
  steps = [],
  now = 1720958400123,
  fireTimeoutImmediately = false,
} = {}) {
  const calls = [];
  const downloads = [];
  const objectUrls = new Map();
  const streamStates = [];
  const timers = [];
  let objectUrlNumber = 0;

  class Element {
    constructor(tagName) {
      this.tagName = String(tagName).toUpperCase();
      this.children = [];
      this.style = {};
      this.attributes = {};
      this.listeners = new Map();
      this.disabled = false;
      this.textContent = '';
      this.id = '';
      this.type = '';
      this.href = '';
      this.download = '';
    }

    appendChild(child) {
      this.children.push(child);
      return child;
    }

    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }

    addEventListener(name, listener) {
      const current = this.listeners.get(name) || [];
      current.push(listener);
      this.listeners.set(name, current);
    }

    async click() {
      if (this.tagName === 'A') {
        downloads.push({
          filename: this.download,
          href: this.href,
          blob: objectUrls.get(this.href),
        });
        return;
      }
      for (const listener of this.listeners.get('click') || []) {
        await listener.call(this, { type: 'click', target: this });
      }
    }
  }

  class MockBlob {
    constructor(parts, options = {}) {
      this.parts = parts.map(String);
      this.type = options.type || '';
    }

    async text() {
      return this.parts.join('');
    }
  }

  class MockURL extends URL {}
  MockURL.createObjectURL = (blob) => {
    const value = `blob:pengo-test-${++objectUrlNumber}`;
    objectUrls.set(value, blob);
    return value;
  };
  MockURL.revokeObjectURL = (value) => {
    objectUrls.delete(value);
  };

  const body = new Element('body');
  function walk(element, predicate) {
    if (predicate(element)) return element;
    for (const child of element.children) {
      const found = walk(child, predicate);
      if (found) return found;
    }
    return null;
  }

  const document = {
    body,
    createElement: (tagName) => new Element(tagName),
    getElementById: (id) => walk(body, (element) => element.id === id),
  };

  function setTimeoutMock(callback, milliseconds) {
    const timer = { callback, milliseconds, cleared: false };
    timers.push(timer);
    if (fireTimeoutImmediately) callback();
    return timers.length;
  }

  function clearTimeoutMock(id) {
    if (timers[id - 1]) timers[id - 1].cleared = true;
  }

  function streamedResponse(step, requestUrl) {
    const raw = Object.hasOwn(step, 'rawBody') ? step.rawBody : JSON.stringify(step.body);
    const bytes = encoder.encode(raw);
    const chunkSize = step.chunkSize || Math.max(bytes.byteLength, 1);
    const state = { cancelled: false, released: false, reads: 0 };
    streamStates.push(state);
    let offset = 0;

    const reader = {
      async read() {
        state.reads += 1;
        if (step.malformedPart && state.reads === 1) return step.malformedPart;
        if (offset >= bytes.byteLength) return { done: true, value: undefined };
        const end = Math.min(offset + chunkSize, bytes.byteLength);
        const value = step.invalidChunk ? 'not-bytes' : bytes.subarray(offset, end);
        offset = end;
        return { done: false, value };
      },
      async cancel() {
        state.cancelled = true;
        offset = bytes.byteLength;
      },
      releaseLock() {
        state.released = true;
      },
    };

    const contentType = Object.hasOwn(step, 'contentType')
      ? step.contentType
      : 'application/json; charset=utf-8';
    return {
      status: Object.hasOwn(step, 'status') ? step.status : 200,
      url: Object.hasOwn(step, 'finalUrl') ? step.finalUrl : String(requestUrl),
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'content-type' ? contentType : null;
        },
      },
      body: step.noBody ? null : { getReader: () => reader },
    };
  }

  const fetch = async (url, options) => {
    const index = calls.length;
    calls.push({ url: String(url), options });
    const step = steps[index];
    if (typeof step === 'function') return step(url, options);
    if (step instanceof Error) throw step;
    return streamedResponse(step || {}, url);
  };

  class MockDate extends Date {
    static now() {
      return now;
    }
  }

  const window = {
    location: { origin: location.origin, pathname: location.pathname },
    fetch,
  };
  const context = vm.createContext({
    window,
    document,
    Blob: MockBlob,
    URL: MockURL,
    Date: MockDate,
    Number,
    Set,
    Array,
    Object,
    JSON,
    String,
    RegExp,
    Error,
    Uint8Array,
    TextDecoder,
    AbortController,
    setTimeout: setTimeoutMock,
    clearTimeout: clearTimeoutMock,
  });
  vm.runInContext(exporterSource, context, { filename: exporterPath });

  return {
    calls,
    downloads,
    document,
    body,
    streamStates,
    timers,
    findTag: (tagName) => walk(body, (element) => element.tagName === tagName.toUpperCase()),
    status: () => {
      const panel = document.getElementById('pengo-hsr-achievement-exporter');
      return panel ? panel.children.at(-1).textContent : '';
    },
  };
}

function envelope(data, retcode = 0) {
  return { retcode, data };
}

function successSteps(rows, overrides = {}) {
  return [
    {
      body: envelope({ region: 'prod_official_usa', game_uid: '600123456' }),
      ...overrides.login,
    },
    {
      body: envelope({ achievement_list: rows }),
      ...overrides.list,
    },
  ];
}

async function downloadedJson(harness) {
  assert.equal(harness.downloads.length, 1);
  const download = harness.downloads[0];
  assert.ok(download.blob);
  const text = await download.blob.text();
  return { download, text, json: JSON.parse(text) };
}

function assertPengoExport(json, expectedIds) {
  assert.deepEqual(Object.keys(json), ['kind', 'version', 'game', 'catalogVersion', 'exportedAt', 'achievements']);
  assert.equal(json.kind, 'pengo-achievements');
  assert.equal(json.version, 1);
  assert.equal(json.game, 'hsr');
  assert.equal(json.catalogVersion, 'hsr-4.4');
  assert.doesNotThrow(() => new Date(json.exportedAt).toISOString());
  assert.deepEqual(
    json.achievements,
    expectedIds.map((id) => ({ id, status:'complete' })),
  );
}

async function clickAndExpectGenericFailure(harness) {
  await harness.findTag('button').click();
  assert.equal(harness.downloads.length, 0);
  assert.equal(harness.status(), genericError);
  assert.doesNotMatch(harness.status(), /SECRET|600123456|prod_official_usa|4010101/i);
  assert.equal(harness.findTag('button').disabled, false);
}

function assertRequestOptions(options) {
  assert.deepEqual(Object.keys(options).sort(), [
    'cache',
    'credentials',
    'method',
    'redirect',
    'referrerPolicy',
    'signal',
  ]);
  assert.equal(options.method, 'GET');
  assert.equal(options.credentials, 'include');
  assert.equal(options.redirect, 'error');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.ok(options.signal instanceof AbortSignal);
}

async function loadImporter() {
  const featureDir = path.resolve(siteDir, 'src/features/achievements');
  const source = (
    await Promise.all([
      'achievement-core.js',
      'achievement-storage.js',
      'achievement-import.js',
    ].map((name) => fs.readFile(path.join(featureDir, name), 'utf8')))
  ).join('\n');
  const window = {};
  vm.runInContext(source, vm.createContext({
    window,
    console,
    Date,
    Math,
    Set,
    JSON,
    encodeURIComponent,
  }));
  return window.NyxAchievementImport;
}

test('embedded release allowlist exactly matches the HSR catalog', async () => {
  const matches = [...exporterSource.matchAll(/RELEASED_HSR(?:_[0-9]+)?_IDS\s*=\s*Object\.freeze\(\[([0-9,]+)\]\)/g)];
  assert.ok(matches.length, 'embedded HSR allowlist is missing');
  const embedded = matches.flatMap((match) => match[1].split(',').map(Number)).sort((a, b) => a - b);
  const catalog = JSON.parse(await fs.readFile(path.resolve(rootDir, 'Database/Achievements/hsr/catalog.json'), 'utf8'));
  const expected = [...new Set(catalog.achievements.map((row) => Number(row.id)))].sort((a, b) => a - b);
  assert.deepEqual(embedded, expected);
});

test('runs only on the exact HoYoLAB HSR cultivation page', () => {
  for (const location of [
    { origin: 'http://act.hoyolab.com', pathname: expectedPage.pathname },
    { origin: 'https://evil.example', pathname: expectedPage.pathname },
    { origin: expectedPage.origin, pathname: '/sr/event/cultivation-tool/' },
    { origin: expectedPage.origin, pathname: '/sr/event/cultivation-tool/index.html/extra' },
  ]) {
    const harness = makeHarness({ location });
    assert.equal(harness.calls.length, 0);
    assert.equal(harness.document.getElementById('pengo-hsr-achievement-exporter'), null);
  }
});

test('makes no request until the user explicitly clicks export', () => {
  const harness = makeHarness({ steps: successSteps([]) });
  assert.ok(harness.findTag('button'));
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.downloads.length, 0);
  assert.match(harness.status(), /Nothing is sent until you click/);
});

test('uses exact endpoints and hardened GET options, then exports sorted finished IDs', async () => {
  const harness = makeHarness({
    steps: successSteps([
      { id: knownIds[1], finished: true },
      { id: String(knownIds[0]), finished: true },
      { id: 4010102, finished: false },
    ], {
      login: { chunkSize: 7 },
      list: { chunkSize: 11, contentType: 'Application/JSON; charset=UTF-8' },
    }),
  });
  await harness.findTag('button').click();

  assert.equal(harness.calls.length, 2);
  const login = new URL(harness.calls[0].url);
  assert.equal(login.origin, 'https://sg-public-api.hoyolab.com');
  assert.equal(login.pathname, '/common/badge/v1/login/info');
  assert.deepEqual([...login.searchParams.entries()], [
    ['game_biz', 'hkrpg_global'],
    ['lang', 'en-us'],
    ['ts', '1720958400123'],
  ]);
  assertRequestOptions(harness.calls[0].options);

  const achievements = new URL(harness.calls[1].url);
  assert.equal(achievements.origin, 'https://sg-public-api.hoyolab.com');
  assert.equal(achievements.pathname, '/event/rpgcultivate/achievement/list');
  assert.deepEqual([...achievements.searchParams.entries()], [
    ['game', 'hkrpg'],
    ['game_biz', 'hkrpg_global'],
    ['badge_region', 'prod_official_usa'],
    ['badge_uid', '600123456'],
    ['show_hide', 'false'],
    ['need_all', 'true'],
  ]);
  assertRequestOptions(harness.calls[1].options);
  assert.ok(harness.streamStates.every((state) => state.released));
  assert.ok(harness.timers.every((timer) => timer.milliseconds === 12000 && timer.cleared));

  const { download, text, json } = await downloadedJson(harness);
  assert.equal(download.filename, 'pengo-hsr-achievements.json');
  assert.equal(download.blob.type, 'application/json');
  assertPengoExport(json, knownIds);
  assert.notDeepEqual([...Buffer.from(text).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(harness.status(), 'Exported 2 completed achievements.');
  assert.doesNotMatch(harness.status(), /4010101|4010201/);
});

test('an empty finished list is a successful empty export', async () => {
  const harness = makeHarness({
    steps: successSteps([
      { id: knownIds[0], finished: false },
      { id: knownIds[1], finished: false },
    ]),
  });
  await harness.findTag('button').click();
  assertPengoExport((await downloadedJson(harness)).json, []);
  assert.equal(harness.status(), 'Exported 0 completed achievements.');
});

test('a canonical unknown unfinished row is ignored safely', async () => {
  const harness = makeHarness({
    steps: successSteps([
      { id: knownIds[0], finished: true },
      { id: 4999999, finished: false },
    ]),
  });
  await harness.findTag('button').click();
  assertPengoExport((await downloadedJson(harness)).json, [knownIds[0]]);
});

for (const [name, row] of [
  ['null row', null],
  ['array row', []],
  ['string row', 'SECRET_ROW'],
  ['missing row fields', {}],
  ['missing finished field', { id: knownIds[0] }],
  ['missing ID field', { finished: true }],
  ['nonboolean finished field', { id: knownIds[0], finished: 1 }],
  ['leading-zero ID', { id: '04010101', finished: true }],
  ['decimal-string ID', { id: '4010101.0', finished: true }],
  ['unsafe numeric ID', { id: Number.MAX_SAFE_INTEGER + 1, finished: true }],
]) {
  test(`${name} fails closed with no download`, async () => {
    await clickAndExpectGenericFailure(makeHarness({ steps: successSteps([row]) }));
  });
}

test('duplicate canonical IDs fail closed instead of being silently deduplicated', async () => {
  const harness = makeHarness({
    steps: successSteps([
      { id: knownIds[0], finished: true },
      { id: String(knownIds[0]), finished: true },
    ]),
  });
  await clickAndExpectGenericFailure(harness);
});

test('an unknown finished ID fails closed instead of producing a partial export', async () => {
  const harness = makeHarness({
    steps: successSteps([
      { id: knownIds[0], finished: true },
      { id: 4999999, finished: true },
    ]),
  });
  await clickAndExpectGenericFailure(harness);
});

test('more than 10,000 rows fail closed', async () => {
  const rows = Array.from(
    { length: 10001 },
    (_, index) => ({ id: 5000000 + index, finished: false }),
  );
  await clickAndExpectGenericFailure(makeHarness({ steps: successSteps(rows) }));
});

for (const [name, steps] of [
  ['non-200 login status', [{ status: 201, body: envelope({ region: 'prod_official_usa', game_uid: '600123456' }) }]],
  ['missing JSON content type', [{ contentType: null, body: envelope({ region: 'prod_official_usa', game_uid: '600123456' }) }]],
  ['non-JSON content type', [{ contentType: 'text/html', rawBody: '<p>SECRET_BODY</p>' }]],
  ['changed final response URL', [{
    finalUrl: 'https://sg-public-api.hoyolab.com/common/badge/v1/login/info?redirected=true',
    body: envelope({ region: 'prod_official_usa', game_uid: '600123456' }),
  }]],
  ['invalid JSON', [{ rawBody: '{"retcode":0,"data":SECRET_BODY}' }]],
  ['array response envelope', [{ body: [0, { region: 'prod_official_usa', game_uid: '600123456' }] }]],
  ['missing own retcode', [{ body: { data: { region: 'prod_official_usa', game_uid: '600123456' } } }]],
  ['string retcode', [{ body: envelope({ region: 'prod_official_usa', game_uid: '600123456' }, '0') }]],
  ['nonzero retcode', [{ body: envelope({ region: 'prod_official_usa', game_uid: '600123456' }, -1) }]],
  ['non-object data', [{ body: envelope([]) }]],
  ['missing achievement list', [
    { body: envelope({ region: 'prod_official_usa', game_uid: '600123456' }) },
    { body: envelope({ private: 'SECRET_BODY' }) },
  ]],
]) {
  test(`${name} fails closed with a generic error`, async () => {
    await clickAndExpectGenericFailure(makeHarness({ steps }));
  });
}

test('login response is capped at 16 KiB and the stream is cancelled', async () => {
  const harness = makeHarness({
    steps: [{ rawBody: 'x'.repeat(16385), chunkSize: 4096 }],
  });
  await clickAndExpectGenericFailure(harness);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.streamStates[0].cancelled, true);
  assert.equal(harness.streamStates[0].released, true);
});

test('achievement response is capped at 2 MiB and the stream is cancelled', async () => {
  const harness = makeHarness({
    steps: [
      { body: envelope({ region: 'prod_official_usa', game_uid: '600123456' }) },
      { rawBody: 'x'.repeat(2097153), chunkSize: 65536 },
    ],
  });
  await clickAndExpectGenericFailure(harness);
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.streamStates[1].cancelled, true);
  assert.equal(harness.streamStates[1].released, true);
});

test('a missing readable response body fails closed', async () => {
  await clickAndExpectGenericFailure(makeHarness({
    steps: [{ noBody: true, body: envelope({ region: 'prod_official_usa', game_uid: '600123456' }) }],
  }));
});

test('a non-byte stream chunk fails closed', async () => {
  await clickAndExpectGenericFailure(makeHarness({
    steps: [{ invalidChunk: true, body: envelope({ region: 'prod_official_usa', game_uid: '600123456' }) }],
  }));
});

test('request timeout aborts the fetch and clears its timer', async () => {
  const waitForAbort = (_url, options) => new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(new Error('SECRET_TIMEOUT'));
      return;
    }
    options.signal.addEventListener('abort', () => reject(new Error('SECRET_TIMEOUT')), { once: true });
  });
  const harness = makeHarness({
    steps: [waitForAbort],
    fireTimeoutImmediately: true,
  });
  await clickAndExpectGenericFailure(harness);
  assert.equal(harness.calls[0].options.signal.aborted, true);
  assert.equal(harness.timers.length, 1);
  assert.equal(harness.timers[0].milliseconds, 12000);
  assert.equal(harness.timers[0].cleared, true);
});

for (const [name, steps] of [
  ['fetch rejection', [new Error('SECRET_FETCH_FAILURE')]],
  ['malformed login fields', [{ body: envelope({ region: 'bad region', game_uid: 'SECRET_UID' }) }]],
  ['achievement fetch rejection', [
    { body: envelope({ region: 'prod_official_usa', game_uid: '600123456' }) },
    new Error('SECRET_API_FAILURE'),
  ]],
]) {
  test(`${name} never exposes private values`, async () => {
    await clickAndExpectGenericFailure(makeHarness({ steps }));
  });
}

test('source statically excludes privacy, messaging, dynamic-code, and DOM injection sinks', () => {
  const forbidden = [
    /console\s*\./i,
    /document\s*\.\s*cookie/i,
    /localStorage/i,
    /sessionStorage/i,
    /indexedDB/i,
    /CacheStorage/i,
    /\bcaches\s*\./i,
    /clipboard/i,
    /sendBeacon/i,
    /WebSocket/i,
    /EventSource/i,
    /XMLHttpRequest/i,
    /BroadcastChannel/i,
    /\b(?:Shared)?Worker\s*\(/i,
    /serviceWorker/i,
    /postMessage/i,
    /Notification/i,
    /geolocation/i,
    /\beval\s*\(/i,
    /new\s+Function\b/i,
    /document\s*\.\s*write/i,
    /\.innerHTML\s*=/i,
    /\.outerHTML\s*=/i,
    /insertAdjacentHTML/i,
    /window\s*\.\s*open\s*\(/i,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(exporterSource, pattern);
  assert.doesNotMatch(exporterSource, /response\s*\.\s*(?:json|text|arrayBuffer|blob)\s*\(/);
  assert.match(exporterSource, /body\.getReader\(\)/);
  assert.match(exporterSource, /Object\.hasOwn\(envelope, 'retcode'\)/);
});

test('source contains only the approved network URL literals', () => {
  const networkLiterals = exporterSource.match(/https:\/\/[^'"]+/g) || [];
  assert.deepEqual(networkLiterals, [
    'https://act.hoyolab.com',
    'https://sg-public-api.hoyolab.com/common/badge/v1/login/info',
    'https://sg-public-api.hoyolab.com/event/rpgcultivate/achievement/list',
  ]);
});

test('download remains BOM-less and accepted by the existing Pengo importer', async () => {
  const harness = makeHarness({
    steps: successSteps(knownIds.map((id) => ({ id, finished: true }))),
  });
  await harness.findTag('button').click();
  const { text, json } = await downloadedJson(harness);
  assertPengoExport(json, knownIds);
  assert.notDeepEqual([...Buffer.from(text).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const parsed = plain((await loadImporter()).parse(text));
  assert.equal(parsed.game, 'hsr');
  assert.deepEqual(parsed.ids, knownIds.map(String));
});
