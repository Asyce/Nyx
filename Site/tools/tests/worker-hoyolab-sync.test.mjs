import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import test from 'node:test';

if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

const workerSource = await fs.readFile(new URL('../../../worker/worker.js', import.meta.url), 'utf8');
const { default: worker, HoyoSyncObject } = await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`);

const URL_ROOT = 'https://pengo.gg/api/account/sync/';
const ORIGIN = 'https://pengo.gg';
const SYNC_ID = 'a'.repeat(48);
const TOKEN = 'b'.repeat(64);
const OTHER_TOKEN = 'c'.repeat(64);
const IV = Buffer.alloc(12).toString('base64');
const CIPHERTEXT = Buffer.alloc(17, 1).toString('base64');
const MAX_CIPHERTEXT_BYTES = 3 * 1024 * 1024 + 16;
const MAX_CIPHERTEXT_BASE64 = Math.ceil(MAX_CIPHERTEXT_BYTES / 3) * 4;
const MAX_HOYO_BODY = MAX_CIPHERTEXT_BASE64 + 1024;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

class FakeKv {
  constructor() { this.values = new Map(); }
  async get(key, type) {
    const value = this.values.get(key);
    if (value == null) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }
  async put(key, value) { this.values.set(key, value); }
  async delete(key) { this.values.delete(key); }
}

class FakeDoStorage {
  constructor() {
    this.values = new Map();
    this.tail = Promise.resolve();
    this.transactions = 0;
  }
  async get(key) { return clone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, clone(value)); }
  async delete(key) { return this.values.delete(key); }
  async transaction(callback) {
    const prior = this.tail;
    let release;
    this.tail = new Promise((resolve) => { release = resolve; });
    await prior;
    this.transactions += 1;
    try { return await callback(this); } finally { release(); }
  }
}

class FakeDoNamespace {
  constructor() {
    this.objects = new Map();
    this.names = [];
  }
  idFromName(name) {
    this.names.push(name);
    return name;
  }
  get(id) {
    if (!this.objects.has(id)) {
      const storage = new FakeDoStorage();
      this.objects.set(id, { storage, object: new HoyoSyncObject({ storage }) });
    }
    const entry = this.objects.get(id);
    return { fetch: (input, init) => entry.object.fetch(new Request(input, init)) };
  }
  storage(id = SYNC_ID) { return this.objects.get(id)?.storage; }
}

function environment() {
  return { PULL_SYNC: new FakeKv(), HOYO_SYNC: new FakeDoNamespace() };
}

function envelope(ciphertext = CIPHERTEXT) {
  return {
    format: 'nyx-hoyolab-sync-v1',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 150000 },
    iv: IV,
    ciphertext,
  };
}

function hoyoBody(overrides = {}) {
  return {
    kind: 'hoyolab',
    syncId: SYNC_ID,
    token: TOKEN,
    game: 'hsr',
    baseUpdatedAt: null,
    payload: envelope(),
    ...overrides,
  };
}

async function call(action, body, env, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (options.origin !== null) headers.set('Origin', options.origin || ORIGIN);
  if (options.hoyo !== false) headers.set('X-Nyx-Sync-Kind', 'hoyolab');
  const request = new Request(URL_ROOT + action, {
    method: options.method || 'POST',
    headers,
    body: options.rawBody ?? JSON.stringify(body),
    ...(options.stream ? { duplex: 'half' } : {}),
  });
  const response = await worker.fetch(request, env, {});
  const result = response.status === 204 ? null : await response.json();
  return { response, result };
}

async function push(env, body = hoyoBody(), options) {
  return call('push', body, env, options);
}

function pullBody(overrides = {}) {
  return {
    accountId: SYNC_ID,
    token: TOKEN,
    game: 'hsr',
    payload: { format: 'nyx-pull-sync-v1', iv: IV, ciphertext: CIPHERTEXT },
    exportedAt: 100,
    ...overrides,
  };
}

test('missing and explicit pulls preserve KV keys, equal-time, force, and delete behavior', async () => {
  const env = environment();
  let result = await call('push', pullBody(), env, { hoyo: false });
  assert.equal(result.response.status, 200);
  assert.deepEqual([...env.PULL_SYNC.values.keys()].sort(), [`auth:v1:${SYNC_ID}`, `pulls:v1:${SYNC_ID}:hsr`]);

  result = await call('push', pullBody({ kind: 'pulls', payload: { format: 'nyx-pull-sync-v1', iv: IV, ciphertext: Buffer.alloc(16, 2).toString('base64') } }), env, { hoyo: false });
  assert.equal(result.response.status, 200, 'equal exportedAt remains accepted');

  result = await call('push', pullBody({ kind: 'pulls', exportedAt: 1 }), env, { hoyo: false });
  assert.equal(result.response.status, 409);
  result = await call('push', pullBody({ kind: 'pulls', exportedAt: 1, force: true }), env, { hoyo: false });
  assert.equal(result.response.status, 200, 'pull force remains accepted');
  result = await call('delete', { kind: 'pulls', accountId: SYNC_ID, token: TOKEN, game: 'hsr' }, env, { hoyo: false });
  assert.equal(result.response.status, 200);
  assert(env.PULL_SYNC.values.has(`auth:v1:${SYNC_ID}`));
  assert(!env.PULL_SYNC.values.has(`pulls:v1:${SYNC_ID}:hsr`));
});

test('invalid pull games fail before authentication without creating KV state', async () => {
  for (const variant of [
    { label: 'missing kind, missing game', overrides: { game: undefined } },
    { label: 'missing kind, invalid game', overrides: { game: 'future' } },
    { label: 'explicit pulls, missing game', overrides: { kind: 'pulls', game: undefined } },
    { label: 'explicit pulls, invalid game', overrides: { kind: 'pulls', game: 'future' } },
  ]) {
    const env = environment();
    const result = await call('push', pullBody(variant.overrides), env, { hoyo: false });
    assert.equal(result.response.status, 400, variant.label);
    assert.equal(result.result.error.code, 'bad_game', variant.label);
    assert.equal(env.PULL_SYNC.values.size, 0, `${variant.label} must not create auth or pull keys`);
  }

  let env = environment();
  let result = await call('status', { accountId: SYNC_ID, token: TOKEN, game: 'future' }, env, { hoyo: false });
  assert.equal(result.response.status, 400, 'invalid game is rejected before absent-auth lookup');
  assert.equal(result.result.error.code, 'bad_game');
  assert.equal(env.PULL_SYNC.values.size, 0);

  env = environment();
  await call('push', pullBody(), env, { hoyo: false });
  result = await call('status', { accountId: SYNC_ID, token: OTHER_TOKEN, game: 'future' }, env, { hoyo: false });
  assert.equal(result.response.status, 400, 'invalid game is rejected before wrong-auth lookup');
  assert.equal(result.result.error.code, 'bad_game');
  result = await call('status', { accountId: SYNC_ID, token: OTHER_TOKEN, game: 'hsr' }, env, { hoyo: false });
  assert.equal(result.response.status, 403, 'valid game still reaches authentication');
  assert.equal(result.result.error.code, 'sync_auth_failed');
});

test('kind, origin, and CORS gates distinguish browser pulls from native HoYo', async () => {
  const env = environment();
  let result = await push(env, hoyoBody(), { origin: null });
  assert.equal(result.response.status, 200, 'native HoYo request needs no Origin');

  result = await call('push', pullBody(), environment(), { hoyo: false, origin: null });
  assert.equal(result.response.status, 403, 'native pull request remains browser-origin gated');
  result = await push(environment(), hoyoBody(), { origin: 'https://evil.example' });
  assert.equal(result.response.status, 403);
  result = await call('push', { ...hoyoBody(), kind: 'pulls' }, environment());
  assert.equal(result.response.status, 400);
  assert.equal(result.result.error.code, 'sync_kind_mismatch');
  result = await call('push', hoyoBody(), environment(), { hoyo: false });
  assert.equal(result.response.status, 400);
  assert.equal(result.result.error.code, 'sync_kind_mismatch');
  result = await call('push', { ...pullBody(), kind: 'future' }, environment(), { hoyo: false });
  assert.equal(result.response.status, 400);
  result = await call('push', hoyoBody(), environment(), { headers: { 'X-Nyx-Sync-Kind': 'future' }, hoyo: false });
  assert.equal(result.response.status, 400);
  assert.equal(result.result.error.code, 'unknown_sync_kind');

  const preflight = await worker.fetch(new Request(URL_ROOT + 'push', {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-nyx-sync-kind',
    },
  }), env, {});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /X-Nyx-Sync-Kind/i);
});

test('header is required before the larger stream limit and both outer limits are enforced', async () => {
  const env = environment();
  let result = await call('push', hoyoBody(), env, { headers: { 'Content-Length': String(MAX_HOYO_BODY + 1) } });
  assert.equal(result.response.status, 413);

  const oversized = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(' '.repeat(MAX_HOYO_BODY + 1)));
      controller.close();
    },
  });
  result = await call('push', null, env, {
    rawBody: oversized,
    stream: true,
    headers: { 'Content-Length': '1' },
  });
  assert.equal(result.response.status, 413, 'forged small Content-Length cannot bypass streaming cap');

  result = await call('push', { ...pullBody(), padding: 'x'.repeat(3 * 1024 * 1024) }, environment(), { hoyo: false });
  assert.equal(result.response.status, 413, 'pull cap stays at 3 MiB');
});

test('decoded AES-GCM limit accepts exactly 3 MiB plus tag and rejects one more byte', async () => {
  const maxCiphertext = Buffer.alloc(MAX_CIPHERTEXT_BYTES).toString('base64');
  const env = environment();
  let result = await push(env, hoyoBody({ payload: envelope(maxCiphertext) }));
  assert.equal(result.response.status, 200);
  assert.equal(result.result.size, MAX_CIPHERTEXT_BYTES);
  const storage = env.HOYO_SYNC.storage();
  const chunkKeys = [...storage.values.keys()].filter((key) => key.startsWith('hoyolab:v1:hsr:chunk:')).sort();
  assert.deepEqual(chunkKeys, [0, 1, 2, 3, 4].map((index) => `hoyolab:v1:hsr:chunk:${index}`));
  assert(chunkKeys.every((key) => storage.values.get(key).length <= 1024 * 1024));
  assert(!('ciphertext' in storage.values.get('hoyolab:v1:hsr').payload));

  const replacement = envelope(Buffer.alloc(17, 9).toString('base64'));
  result = await push(env, hoyoBody({ baseUpdatedAt: result.result.updatedAt, payload: replacement }));
  assert.equal(result.response.status, 200);
  assert(storage.values.has('hoyolab:v1:hsr:chunk:0'));
  for (let index = 1; index < 5; index += 1) assert(!storage.values.has(`hoyolab:v1:hsr:chunk:${index}`));

  const overCiphertext = Buffer.alloc(MAX_CIPHERTEXT_BYTES + 1).toString('base64');
  result = await push(environment(), hoyoBody({ payload: envelope(overCiphertext) }));
  assert.equal(result.response.status, 400);
  assert.equal(result.result.error.code, 'bad_payload');
});

test('strict HoYo identifiers, shape, timestamp, envelope, KDF, IV, and Base64 validation', async (t) => {
  const cases = [
    ['uppercase sync id', { syncId: 'A'.repeat(48) }],
    ['short sync id', { syncId: 'a'.repeat(47) }],
    ['uppercase token', { token: 'B'.repeat(64) }],
    ['wrong game', { game: 'gi' }],
    ['non-canonical timestamp', { baseUpdatedAt: '2026-01-01T00:00:00Z' }],
    ['unknown top field', { force: true }],
    ['wrong envelope', { payload: { ...envelope(), format: 'nyx-pull-sync-v1' } }],
    ['wrong KDF name', { payload: { ...envelope(), kdf: { name: 'scrypt', hash: 'SHA-256', iterations: 150000 } } }],
    ['wrong KDF hash', { payload: { ...envelope(), kdf: { name: 'PBKDF2', hash: 'SHA-512', iterations: 150000 } } }],
    ['wrong KDF iterations', { payload: { ...envelope(), kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 150001 } } }],
    ['extra KDF field', { payload: { ...envelope(), kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 150000, salt: 'plaintext' } } }],
    ['short IV', { payload: { ...envelope(), iv: Buffer.alloc(11).toString('base64') } }],
    ['non-canonical IV Base64', { payload: { ...envelope(), iv: ` ${IV.slice(1)}` } }],
    ['tag-only ciphertext', { payload: envelope(Buffer.alloc(16).toString('base64')) }],
    ['invalid ciphertext Base64', { payload: envelope('!'.repeat(24)) }],
    ['extra payload field', { payload: { ...envelope(), plaintext: 'no' } }],
  ];
  for (const [name, override] of cases) {
    await t.test(name, async () => {
      const result = await push(environment(), hoyoBody(override));
      assert.equal(result.response.status, 400);
    });
  }
});

test('first push atomically stores only hashed auth and allowed opaque metadata under exact keys', async () => {
  const env = environment();
  const result = await push(env);
  assert.equal(result.response.status, 200);
  assert.deepEqual(env.HOYO_SYNC.names, [SYNC_ID]);
  const storage = env.HOYO_SYNC.storage();
  assert.equal(storage.transactions, 1);
  assert.deepEqual([...storage.values.keys()].sort(), ['auth:hoyolab:v1', 'hoyolab:v1:hsr', 'hoyolab:v1:hsr:chunk:0']);
  const auth = storage.values.get('auth:hoyolab:v1');
  const record = storage.values.get('hoyolab:v1:hsr');
  assert.deepEqual(Object.keys(auth).sort(), ['createdAt', 'syncId', 'tokenHash']);
  assert.deepEqual(Object.keys(record).sort(), ['chunkCount', 'ciphertextLength', 'ciphertextSize', 'createdAt', 'game', 'payload', 'syncId', 'updatedAt']);
  assert.deepEqual(Object.keys(record.payload).sort(), ['format', 'iv', 'kdf']);
  assert.equal(auth.tokenHash, crypto.createHash('sha256').update(TOKEN).digest('hex'));
  assert.equal(record.game, 'hsr');
  assert.equal(record.ciphertextSize, 17);
  const persisted = JSON.stringify([...storage.values]);
  assert(!persisted.includes(TOKEN), 'raw token is never persisted');
  for (const forbidden of ['uid', 'role', 'capability', 'nickname', 'cookie', 'secret', 'recoveryCode', 'ttl', 'expiration']) {
    assert(!Object.hasOwn(auth, forbidden));
    assert(!Object.hasOwn(record, forbidden));
  }
});

test('matching CAS advances monotonically, stale CAS reports server time, and lost-success retry is idempotent', async () => {
  const env = environment();
  const first = await push(env);
  const firstAt = first.result.updatedAt;
  const secondPayload = envelope(Buffer.alloc(17, 2).toString('base64'));
  const second = await push(env, hoyoBody({ baseUpdatedAt: firstAt, payload: secondPayload }));
  assert.equal(second.response.status, 200);
  assert(Date.parse(second.result.updatedAt) > Date.parse(firstAt));

  const stale = await push(env, hoyoBody({ baseUpdatedAt: firstAt, payload: envelope(Buffer.alloc(17, 3).toString('base64')) }));
  assert.equal(stale.response.status, 409);
  assert.equal(stale.result.error.code, 'stale_write');
  assert.equal(stale.result.serverUpdatedAt, second.result.updatedAt);

  const retry = await push(env, hoyoBody({ baseUpdatedAt: firstAt, payload: secondPayload }));
  assert.equal(retry.response.status, 200);
  assert.equal(retry.result.updatedAt, second.result.updatedAt);
});

test('first push requires null base and two concurrent matching CAS pushes have one winner', async () => {
  let env = environment();
  let result = await push(env, hoyoBody({ baseUpdatedAt: '2026-01-01T00:00:00.000Z' }));
  assert.equal(result.response.status, 409);
  assert.equal(result.result.serverUpdatedAt, null);
  assert.equal(env.HOYO_SYNC.storage().values.size, 0);

  env = environment();
  const first = await push(env);
  const baseUpdatedAt = first.result.updatedAt;
  const [left, right] = await Promise.all([
    push(env, hoyoBody({ baseUpdatedAt, payload: envelope(Buffer.alloc(17, 4).toString('base64')) })),
    push(env, hoyoBody({ baseUpdatedAt, payload: envelope(Buffer.alloc(17, 5).toString('base64')) })),
  ]);
  assert.deepEqual([left.response.status, right.response.status].sort(), [200, 409]);
});

test('pull returns ciphertext while status returns opaque metadata only', async () => {
  const env = environment();
  await push(env);
  const common = { kind: 'hoyolab', syncId: SYNC_ID, token: TOKEN, game: 'hsr' };
  const status = await call('status', common, env);
  assert.equal(status.response.status, 200);
  assert.equal(status.result.size, 17);
  assert(!('payload' in status.result));
  assert(!JSON.stringify(status.result).includes(CIPHERTEXT));
  const pulled = await call('pull', common, env);
  assert.equal(pulled.response.status, 200);
  assert.deepEqual(pulled.result.payload, envelope());
});

test('pull, status, and delete require the matching token and reuse the account rate limit', async () => {
  const env = environment();
  const common = { kind: 'hoyolab', syncId: SYNC_ID, token: TOKEN, game: 'hsr' };
  for (const action of ['pull', 'status', 'delete']) {
    const missing = await call(action, common, env);
    assert.equal(missing.response.status, 404);
  }
  await push(env);
  for (const action of ['pull', 'status', 'delete']) {
    const denied = await call(action, { ...common, token: OTHER_TOKEN }, env);
    assert.equal(denied.response.status, 403);
  }
  const keys = [];
  env.GACHA_RL = { async limit({ key }) { keys.push(key); return { success: false }; } };
  const limited = await call('status', common, env);
  assert.equal(limited.response.status, 429);
  assert.match(keys[0], /^account-sync:status:/);
});

test('game deletion retains auth and allows a new null-base push', async () => {
  const env = environment();
  await push(env);
  const common = { kind: 'hoyolab', syncId: SYNC_ID, token: TOKEN, game: 'hsr' };
  let result = await call('delete', common, env);
  assert.equal(result.response.status, 200);
  const storage = env.HOYO_SYNC.storage();
  assert(storage.values.has('auth:hoyolab:v1'));
  assert(!storage.values.has('hoyolab:v1:hsr'));
  assert(![...storage.values.keys()].some((key) => key.startsWith('hoyolab:v1:hsr:chunk:')));
  result = await call('delete', common, env);
  assert.equal(result.response.status, 200, 'a lost successful deletion can be retried');
  result = await push(env);
  assert.equal(result.response.status, 200);
});

test('HoYo delete-account is authenticated, HoYo-only, and idempotent after absence', async () => {
  const env = environment();
  await push(env);
  await call('push', pullBody(), env, { hoyo: false });
  const common = { kind: 'hoyolab', syncId: SYNC_ID, token: TOKEN, game: 'hsr' };
  let result = await call('delete-account', { ...common, token: OTHER_TOKEN }, env);
  assert.equal(result.response.status, 403);
  result = await call('delete-account', common, env);
  assert.equal(result.response.status, 200);
  assert.equal(env.HOYO_SYNC.storage().values.size, 0);
  assert(env.PULL_SYNC.values.has(`pulls:v1:${SYNC_ID}:hsr`));
  env.HOYO_SYNC.storage().values.set('hoyolab:v1:hsr:chunk:0', 'orphan');
  result = await call('delete-account', { ...common, token: OTHER_TOKEN }, env);
  assert.equal(result.response.status, 200, 'already-absent account deletion is idempotent');
  assert.equal(env.HOYO_SYNC.storage().values.size, 0);
});

test('missing or corrupt ciphertext chunks fail closed and authenticated deletion removes them', async () => {
  const env = environment();
  await push(env);
  const storage = env.HOYO_SYNC.storage();
  storage.values.delete('hoyolab:v1:hsr:chunk:0');
  const common = { kind: 'hoyolab', syncId: SYNC_ID, token: TOKEN, game: 'hsr' };
  let result = await call('pull', common, env);
  assert.equal(result.response.status, 500);
  assert.equal(result.result.error.code, 'sync_corrupt');
  result = await call('status', common, env);
  assert.equal(result.response.status, 500);
  result = await call('delete', common, env);
  assert.equal(result.response.status, 200);
  assert.deepEqual([...storage.values.keys()], ['auth:hoyolab:v1']);

  result = await push(env);
  assert.equal(result.response.status, 200);
  storage.values.set('hoyolab:v1:hsr:chunk:0', 'AAAA');
  result = await call('pull', common, env);
  assert.equal(result.response.status, 500);
  result = await call('delete-account', common, env);
  assert.equal(result.response.status, 200);
  assert.equal(storage.values.size, 0);

  result = await push(env);
  assert.equal(result.response.status, 200);
  storage.values.set('hoyolab:v1:hsr:chunk:1', 'AAAA');
  result = await call('status', common, env);
  assert.equal(result.response.status, 500, 'unexpected excess chunks fail closed');
});

test('pull delete-account removes fixed pull keys and auth without touching HoYo', async () => {
  const env = environment();
  await push(env);
  for (const game of ['gi', 'hsr', 'zzz', 'wuwa', 'ae']) {
    await call('push', pullBody({ game }), env, { hoyo: false });
  }
  let result = await call('delete-account', { accountId: SYNC_ID, token: OTHER_TOKEN }, env, { hoyo: false });
  assert.equal(result.response.status, 403);
  assert.equal(env.PULL_SYNC.values.size, 6);
  result = await call('delete-account', { accountId: SYNC_ID, token: TOKEN }, env, { hoyo: false });
  assert.equal(result.response.status, 200);
  assert.equal(env.PULL_SYNC.values.size, 0);
  assert(env.HOYO_SYNC.storage().values.has('hoyolab:v1:hsr'));
  result = await call('delete-account', { kind: 'pulls', accountId: SYNC_ID, token: OTHER_TOKEN }, env, { hoyo: false });
  assert.equal(result.response.status, 200, 'already-absent pull deletion is idempotent');
  assert.equal(env.PULL_SYNC.values.size, 0, 'idempotent deletion recreates no auth or game key');
  assert(env.HOYO_SYNC.storage().values.has('hoyolab:v1:hsr'));
  await call('push', pullBody({ kind: 'pulls' }), env, { hoyo: false });
  const explicit = await call('delete-account', { kind: 'pulls', accountId: SYNC_ID, token: TOKEN }, env, { hoyo: false });
  assert.equal(explicit.response.status, 200);
  assert.equal(env.PULL_SYNC.values.size, 0);
  assert(env.HOYO_SYNC.storage().values.has('hoyolab:v1:hsr'));
});

test('production and preview configs bind the same SQLite Durable Object class', async () => {
  async function config(name) {
    const source = await fs.readFile(new URL(`../../../${name}`, import.meta.url), 'utf8');
    return JSON.parse(source.replace(/^\s*\/\/.*$/gm, ''));
  }
  for (const name of ['wrangler.jsonc', 'wrangler.preview.jsonc']) {
    const parsed = await config(name);
    assert.deepEqual(parsed.durable_objects.bindings, [{ name: 'HOYO_SYNC', class_name: 'HoyoSyncObject' }]);
    assert.deepEqual(parsed.migrations, [{ tag: 'hoyo-sync-v1', new_sqlite_classes: ['HoyoSyncObject'] }]);
  }
});
