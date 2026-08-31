import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { transform } from 'esbuild';

const site = path.resolve(import.meta.dirname, '../..');
const source = await fs.readFile(path.join(site, 'src/features/account/hoyo-sync.js'), 'utf8');
const uiSource = await fs.readFile(path.join(site, 'src/features/account/my-hoyo.jsx'), 'utf8');
const appSource = await fs.readFile(path.join(site, 'src/app/nyx-app.jsx'), 'utf8');
const buildSource = await fs.readFile(path.join(site, 'tools/build-site.mjs'), 'utf8');
const css = await fs.readFile(path.join(site, 'src/styles/game-page-shared.css'), 'utf8');
const pullsSource = await fs.readFile(path.join(site, 'src/features/gacha/pulls-sync.js'), 'utf8');
const vectorBytes = await fs.readFile(path.join(site, 'tools/tests/fixtures/hoyo-sync-vector-v1.json'));
const expectedVectorHash = 'CE6F3690401D1B54F6FB6CBAC76EE67004CC03FD89404149CA1D261865699A0F';
const vectorHash = createHash('sha256').update(vectorBytes).digest('hex').toUpperCase();
assert.equal(vectorHash, expectedVectorHash, 'raw HoYo interoperability vector bytes changed');
const vector = JSON.parse(vectorBytes.toString('utf8'));
const compiledUi = (await transform(uiSource + '\nwindow.__myHoyoTest={MyHoyoPage,myHoyoExpectedFull};', {
  loader:'jsx',
  format:'iife',
  target:'es2020',
})).code;
const encode = new TextEncoder();
const decode64 = (value) => Uint8Array.from(Buffer.from(value, 'base64'));
const encode64 = (value) => Buffer.from(value).toString('base64');
const plain = (value) => JSON.parse(JSON.stringify(value));

function loadApi({ crypto = webcrypto, fetch = async () => { throw new Error('unexpected fetch'); } } = {}) {
  const window = {
    crypto,
    fetch,
    atob:(value) => Buffer.from(value, 'base64').toString('binary'),
    btoa:(value) => Buffer.from(value, 'binary').toString('base64'),
  };
  vm.runInNewContext(source, { window, TextEncoder, TextDecoder, Uint8Array, Set, Date, JSON, Object, Array, Number, Error, RegExp });
  return window.NyxHoyoSync;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const flushTasks = () => new Promise((resolve) => setImmediate(resolve));

function createUiHarness({ api, accountSync = null, confirm = true, catalog = { schemaVersion:1, game:'hsr', achievements:[] } }) {
  const hooks = [];
  const listeners = new Map();
  const resetCalls = [];
  let cursor = 0;
  let pendingEffects = [];
  let mounted = true;
  let updatesAfterUnmount = 0;
  let flushCommits = 0;
  let tree = null;

  const sameDeps = (left, right) => left && right && left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
  const React = {
    createElement(type, props, ...children) {
      return { type, props:{ ...(props || {}), children:children.length <= 1 ? children[0] : children } };
    },
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { kind:'state', value:typeof initial === 'function' ? initial() : initial };
      const set = (next) => {
        if (!mounted) updatesAfterUnmount += 1;
        hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next;
      };
      return [hooks[index].value, set];
    },
    useRef(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { kind:'ref', value:{ current:initial } };
      return hooks[index].value;
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!hooks[index] || !sameDeps(hooks[index].deps, deps)) hooks[index] = { kind:'callback', value:callback, deps };
      return hooks[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const prior = hooks[index];
      if (!prior || !sameDeps(prior.deps, deps)) {
        pendingEffects.push({ index, effect, priorCleanup:prior?.cleanup });
        hooks[index] = { kind:'effect', deps, cleanup:null };
      }
    },
  };
  const window = {
    NyxHoyoSync:api,
    NyxAccountSync:accountSync,
    confirm:() => confirm,
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
    },
    removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
  };
  class FakeFormData {
    constructor(form) { this.form = form; }
    get(name) { return this.form?.data?.[name] ?? null; }
  }
  const context = {
    window,
    React,
    ReactDOM:{ flushSync(callback) { callback(); if (mounted) { render(); flushCommits += 1; } } },
    AbortController,
    FormData:FakeFormData,
    Date,
    Map,
    Number,
    String,
    Object,
    Array,
    Error,
    fetch:async () => ({ ok:true, status:200, json:async () => catalog }),
  };
  vm.runInNewContext(compiledUi, context);

  const walk = (node, visit) => {
    if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return; }
    if (!node || typeof node !== 'object') return;
    visit(node);
    const children = node.props?.children;
    (Array.isArray(children) ? children : [children]).forEach((child) => walk(child, visit));
  };
  const render = () => {
    cursor = 0;
    pendingEffects = [];
    tree = window.__myHoyoTest.MyHoyoPage();
    walk(tree, (node) => {
      if (node.props?.ref && typeof node.props.ref === 'object') {
        node.props.ref.current = { reset:() => resetCalls.push(node.props.id || node.props.className || 'form') };
      }
    });
    for (const item of pendingEffects) {
      item.priorCleanup?.();
      hooks[item.index].cleanup = item.effect() || null;
    }
    return tree;
  };
  const find = (predicate) => {
    let found = null;
    walk(tree, (node) => { if (!found && predicate(node)) found = node; });
    return found;
  };
  const textContent = (node = tree) => {
    if (Array.isArray(node)) return node.map((child) => textContent(child)).join(' ');
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (!node.props || node.props.children === undefined) return '';
    const children = node.props?.children;
    return (Array.isArray(children) ? children : [children]).map((child) => textContent(child)).join(' ');
  };
  const emit = (name, event = {}) => { for (const handler of listeners.get(name) || []) handler(event); };
  const unmount = () => {
    mounted = false;
    for (const hook of hooks) hook?.cleanup?.();
  };
  return {
    render,
    find,
    textContent,
    emit,
    unmount,
    resetCalls,
    updatesAfterUnmount:() => updatesAfterUnmount,
    flushCommits:() => flushCommits,
    expectedFull:window.__myHoyoTest.myHoyoExpectedFull,
  };
}

function fixtureBundle(nickname = 'Test Trailblazer') {
  const bundle = JSON.parse(vector.plaintext);
  bundle.roles[0].nickname = nickname;
  return bundle;
}

async function fixtureKey() {
  return webcrypto.subtle.importKey('raw', Buffer.from(vector.keyHex, 'hex'), { name:'AES-GCM' }, false, ['encrypt']);
}

async function envelopeFor(value, { aad = vector.aad, iv = decode64(vector.iv) } = {}) {
  const bytes = typeof value === 'string' ? encode.encode(value) : value;
  const ciphertext = await webcrypto.subtle.encrypt(
    { name:'AES-GCM', iv, additionalData:encode.encode(aad) },
    await fixtureKey(),
    bytes
  );
  return {
    format:vector.format,
    kdf:{ name:'PBKDF2', hash:'SHA-256', iterations:150000 },
    iv:encode64(iv),
    ciphertext:encode64(new Uint8Array(ciphertext)),
  };
}

async function vectorAuth(api = loadApi()) {
  return api.derive(vector.displayCode);
}

test('raw interoperability vector bytes stay pinned before JSON parsing', () => {
  assert.equal(vectorHash, expectedVectorHash);
});

test('recovery code normalization and derivation match the frozen vector', async () => {
  const api = loadApi();
  assert.equal(api.normalizeRecoveryCode('  ｎｙｘ－ｈｏｙｏ－ａａａａ－ｂｂｂｂ－ｃｃｃｃ－ｄｄｄｄ－ｅｅｅｅ－ｆｆｆｆ－ｇｇｇｇ－ｈｈｈｈ  '), vector.canonicalCode);
  assert.throws(() => api.normalizeRecoveryCode('NYX-HOYO-' + 'A'.repeat(31)), /complete/);
  assert.throws(() => api.normalizeRecoveryCode('NYX-HOYO-' + '1'.repeat(32)), /complete/);
  const auth = await api.derive(vector.displayCode);
  assert.equal(auth.syncId, vector.syncId);
  assert.equal(auth.token, vector.token);
  assert.equal(auth.key.extractable, false);
  assert.deepEqual(auth.key.usages, ['decrypt']);

  const material = await webcrypto.subtle.importKey('raw', encode.encode(vector.canonicalCode), 'PBKDF2', false, ['deriveBits']);
  const bits = await webcrypto.subtle.deriveBits({
    name:'PBKDF2', hash:'SHA-256', iterations:150000, salt:encode.encode(vector.salt),
  }, material, 256);
  assert.equal(Buffer.from(bits).toString('hex'), vector.keyHex);
});

test('fixed IV encryption and browser decryption match the exact launcher plaintext vector', async () => {
  const generated = await envelopeFor(vector.plaintext);
  assert.equal(generated.iv, vector.iv);
  assert.equal(generated.ciphertext, vector.ciphertext);
  assert.equal(Buffer.from(vector.ciphertext, 'base64').subarray(-16).toString('hex'), vector.tagHex);
  const api = loadApi();
  const bundle = await api.decrypt(await vectorAuth(api), {
    format:vector.format,
    kdf:{ name:'PBKDF2', hash:'SHA-256', iterations:150000 },
    iv:vector.iv,
    ciphertext:vector.ciphertext,
  });
  assert.deepEqual(plain(bundle), JSON.parse(vector.plaintext));
});

test('wrong recovery code, wrong AAD, and ciphertext tampering fail closed', async () => {
  const api = loadApi();
  const payload = { format:vector.format, kdf:{ name:'PBKDF2', hash:'SHA-256', iterations:150000 }, iv:vector.iv, ciphertext:vector.ciphertext };
  await assert.rejects(api.decrypt(await api.derive('NYX-HOYO-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ'), payload), /does not unlock/);
  const auth = await vectorAuth(api);
  await assert.rejects(api.decrypt({ ...auth, syncId:'0'.repeat(48) }, payload), /does not unlock/);
  const tampered = decode64(vector.ciphertext); tampered[0] ^= 1;
  await assert.rejects(api.decrypt(auth, { ...payload, ciphertext:encode64(tampered) }), /does not unlock/);
});

test('envelope validation rejects noncanonical base64, wrong KDF or IV, and size bounds', async () => {
  const api = loadApi();
  const auth = await vectorAuth(api);
  const payload = { format:vector.format, kdf:{ name:'PBKDF2', hash:'SHA-256', iterations:150000 }, iv:vector.iv, ciphertext:vector.ciphertext };
  await assert.rejects(api.decrypt(auth, { ...payload, kdf:{ ...payload.kdf, iterations:149999 } }), /unsupported format/);
  await assert.rejects(api.decrypt(auth, { ...payload, iv:'AA==' }), /invalid/);
  await assert.rejects(api.decrypt(auth, { ...payload, iv:vector.iv + '=' }), /invalid/);
  await assert.rejects(api.decrypt(auth, { ...payload, ciphertext:encode64(new Uint8Array(16)) }), /invalid/);
  await assert.rejects(api.decrypt(auth, { ...payload, ciphertext:encode64(new Uint8Array(api.MAX_PLAINTEXT_BYTES + 17)) }), /invalid/);
});

test('decryption rejects invalid UTF-8, JSON, duplicate fields, and oversized plaintext', async () => {
  const api = loadApi();
  const auth = await vectorAuth(api);
  await assert.rejects(api.decrypt(auth, await envelopeFor(Uint8Array.of(0xff))), /valid text/);
  await assert.rejects(api.decrypt(auth, await envelopeFor('{nope')), /valid JSON/);
  await assert.rejects(api.decrypt(auth, await envelopeFor(vector.plaintext.replace('{"schemaVersion":2', '{"schemaVersion":2,"schemaVersion":2'))), /valid JSON/);

  const huge = new Uint8Array(api.MAX_PLAINTEXT_BYTES + 1);
  const fakeCrypto = { subtle:{ decrypt:async () => huge.buffer } };
  const oversized = loadApi({ crypto:fakeCrypto });
  await assert.rejects(oversized.decrypt({ syncId:vector.syncId, key:{} }, {
    format:vector.format, kdf:{ name:'PBKDF2', hash:'SHA-256', iterations:150000 }, iv:vector.iv, ciphertext:encode64(new Uint8Array(17)),
  }), /too large/);
  assert.ok(huge.every((value) => value === 0), 'oversized decrypted bytes are zeroed');
});

test('strict HSR v2 validation enforces roles, observations, resources, achievements, consent, and timestamps', () => {
  const api = loadApi();
  const base = JSON.parse(vector.plaintext);
  const accepted = plain(base);
  assert.equal(api.validateBundle(accepted), accepted);
  const rejected = [
    { ...plain(base), schemaVersion:3 },
    Object.assign(plain(base), { extra:true }),
    (() => { const value = plain(base); delete value.gameId; return value; })(),
    (() => { const value = plain(base); value.roles[0].binding.roleId='123x'; return value; })(),
    (() => { const value = plain(base); value.roles[0].binding.server='prod_unknown'; return value; })(),
    (() => { const value = plain(base); value.roles[0].nickname='bad\ud800'; return value; })(),
    (() => { const value = plain(base); value.roles[0].observations.inventory='2026-08-30T00:00:00Z'; return value; })(),
    (() => { const value = plain(base); value.roles[0].resource.current=301; return value; })(),
    (() => { const value = plain(base); value.roles[0].resource.observedAt='2026-08-29T00:00:00Z'; return value; })(),
    (() => { const value = plain(base); value.roles[0].completedAchievementIds=[4010301,4010101]; return value; })(),
    (() => { const value = plain(base); value.roles[0].completedAchievementIds=[4010101,4010101]; return value; })(),
    (() => { const value = plain(base); value.consents.inventory=true; return value; })(),
    (() => { const value = plain(base); value.roles[0].observations.resources='2999-01-01T00:00:00Z'; value.roles[0].resource.observedAt='2999-01-01T00:00:00Z'; return value; })(),
    (() => { const value = plain(base); value.selectedRole={ roleId:'999', server:'prod_official_eur' }; return value; })(),
  ];
  rejected.forEach((value) => assert.throws(() => api.validateBundle(value), /invalid|unsupported|selected/));
});

test('maximum eight roles and 10,000 sorted unique achievement IDs are accepted at the exact bounds', () => {
  const api = loadApi();
  const value = JSON.parse(vector.plaintext);
  value.roles = Array.from({ length:8 }, (_, index) => {
    const role = plain(value.roles[0]);
    role.binding.roleId = String(100000001 + index);
    role.completedAchievementIds = Array.from({ length:10000 }, (unused, id) => id + 1);
    return role;
  });
  value.selectedRole = plain(value.roles[7].binding);
  assert.equal(api.validateBundle(value), value);
  value.roles.push(plain(value.roles[0]));
  assert.throws(() => api.validateBundle(value), /unsupported|invalid/);
});

test('tombstones are bounded, ordered, exact, and cannot contradict live capability data', () => {
  const api = loadApi();
  const base = JSON.parse(vector.plaintext);
  const binding = plain(base.roles[0].binding);
  base.roles[0].resource = null;
  base.roles[0].observations.resources = null;
  base.capabilityTombstones = [{ binding, capability:'resources', deletedAt:'2026-08-30T00:00:01Z' }];
  assert.equal(api.validateBundle(base), base);
  const contradiction = JSON.parse(vector.plaintext);
  contradiction.capabilityTombstones = [{ binding, capability:'resources', deletedAt:'2026-08-30T00:00:01Z' }];
  assert.throws(() => api.validateBundle(contradiction), /deleted capability/);
  const badOrder = plain(base);
  badOrder.capabilityTombstones = [
    { binding, capability:'resources', deletedAt:'2026-08-30T00:00:02Z' },
    { binding, capability:'achievements', deletedAt:'2026-08-30T00:00:01Z' },
  ];
  assert.throws(() => api.validateBundle(badOrder), /deleted capability/);

  const deletedRole = plain(base);
  deletedRole.roles = [];
  deletedRole.selectedRole = null;
  deletedRole.capabilityTombstones = [];
  deletedRole.roleTombstones = [{ binding, deletedAt:'2026-08-30T00:00:03Z' }];
  assert.equal(api.validateBundle(deletedRole), deletedRole);
  deletedRole.roleTombstones = Array.from({ length:65 }, (unused, index) => ({ binding:{ roleId:String(200000000 + index), server:'prod_official_eur' }, deletedAt:'2026-08-30T00:00:' + String(index % 60).padStart(2, '0') + 'Z' }));
  assert.throws(() => api.validateBundle(deletedRole), /unsupported|invalid/);
});

test('browser API is read-only apart from explicit deletion and sends the fixed HoYo receiver contract', async () => {
  const calls = [];
  const api = loadApi({ fetch:async (url, init) => {
    calls.push({ url, init });
    return { ok:true, status:200, json:async () => ({ ok:true, exists:true }) };
  } });
  const auth = await vectorAuth(api);
  const controller = new AbortController();
  await api.status(auth, { signal:controller.signal });
  await api.deleteGame(auth, { signal:controller.signal });
  await api.deleteAccount(auth, { signal:controller.signal });
  assert.deepEqual(calls.map((call) => call.url), ['/api/account/sync/status', '/api/account/sync/delete', '/api/account/sync/delete-account']);
  for (const call of calls) {
    assert.equal(call.init.signal, controller.signal);
    assert.equal(call.init.headers['X-Nyx-Sync-Kind'], 'hoyolab');
    assert.deepEqual(JSON.parse(call.init.body), { kind:'hoyolab', syncId:vector.syncId, token:vector.token, game:'hsr' });
  }
  assert.equal('push' in api, false);
  const unconfirmed = loadApi({ fetch:async () => ({ ok:true, status:200, json:async () => ({}) }) });
  await assert.rejects(unconfirmed.deleteAccount(auth), /cloud access failed/);
});

test('accepted auth can delete absent, corrupt, or unsupported ciphertext without decrypting it', async () => {
  for (const mode of ['absent', 'corrupt', 'unsupported']) {
    const calls = [];
    const api = loadApi({ fetch:async (url) => {
      calls.push(url);
      if (url.endsWith('/delete')) return { ok:true, status:200, json:async () => ({ ok:true }) };
      if (mode === 'absent') return { ok:true, status:200, json:async () => ({ ok:true }) };
      if (mode === 'unsupported') return { ok:true, status:200, json:async () => ({ ok:true, payload:{ format:'future' } }) };
      const bytes = decode64(vector.ciphertext); bytes[0] ^= 1;
      return { ok:true, status:200, json:async () => ({ ok:true, payload:{ format:vector.format, kdf:{ name:'PBKDF2', hash:'SHA-256', iterations:150000 }, iv:vector.iv, ciphertext:encode64(bytes) } }) };
    } });
    const auth = await vectorAuth(api);
    await assert.rejects(api.pull(auth), /No synced|unsupported|does not unlock/);
    await api.deleteGame(auth);
    assert.deepEqual(calls, ['/api/account/sync/pull', '/api/account/sync/delete']);
  }
});

test('locking can drop every controllable session reference without persistent storage', async () => {
  const api = loadApi();
  const session = { auth:await vectorAuth(api), bundle:JSON.parse(vector.plaintext), updatedAt:'2026-08-30T00:00:00.000Z' };
  api.scrub(session);
  assert.deepEqual(session, { auth:null, bundle:null, updatedAt:null });
});

test('delayed unlock is aborted and scrubbed on pagehide, BFCache restore, and unmount', async () => {
  for (const exit of ['pagehide', 'unmount']) {
    const wait = deferred();
    const scrubbed = [];
    let signal;
    const api = {
      derive:async () => ({ label:exit + '-auth' }),
      pull:async (auth, options) => { signal = options.signal; return wait.promise; },
      scrub:(value) => { scrubbed.push(value?.auth?.label || value?.label || 'unknown'); if (value && typeof value === 'object') { value.auth = null; value.bundle = null; } },
    };
    const harness = createUiHarness({ api });
    harness.render();
    harness.find((node) => node.props?.id === 'my-hoyo-code').props.onChange({ target:{ value:vector.displayCode } });
    harness.render();
    const pending = harness.find((node) => node.type === 'form' && node.props?.className === 'my-hoyo-unlock-form').props.onSubmit({ preventDefault() {} });
    await flushTasks();
    assert(signal, 'pull began with an AbortSignal');
    if (exit === 'pagehide') {
      harness.emit('pagehide');
      assert.equal(signal.aborted, true);
      assert(scrubbed.includes('pagehide-auth'));
      assert(harness.resetCalls.length > 0, 'destructive forms are reset on page exit');
      harness.emit('pageshow', { persisted:true });
    } else {
      harness.unmount();
      assert.equal(signal.aborted, true);
      assert(scrubbed.includes('unmount-auth'));
    }
    const updates = harness.updatesAfterUnmount();
    const lateResult = { bundle:fixtureBundle('Stale role'), updatedAt:'2026-08-30T00:00:00Z' };
    wait.resolve(lateResult);
    await pending;
    assert.equal(lateResult.bundle, null, 'a decrypted result arriving after exit is explicitly scrubbed');
    assert.equal(harness.updatesAfterUnmount(), updates, 'stale completion does not update an exited component');
    if (exit === 'pagehide') {
      harness.render();
      assert.doesNotMatch(harness.textContent(), /Stale role/);
      assert.match(harness.textContent(), /Locked after page restore/);
      harness.unmount();
    }
  }
});

test('a newer generation wins after page restore and scrubs the delayed candidate', async () => {
  const first = deferred();
  const scrubbed = [];
  const api = {
    derive:async (code) => ({ label:code.includes('AAAA') ? 'first' : 'second' }),
    pull:async (auth) => auth.label === 'first' ? first.promise : { bundle:fixtureBundle('Current role'), updatedAt:'2026-08-30T00:00:00Z' },
    scrub:(value) => { scrubbed.push(value?.auth?.label || value?.label || 'unknown'); if (value && typeof value === 'object') value.auth = null; },
  };
  const harness = createUiHarness({ api });
  harness.render();
  const start = async (code) => {
    harness.find((node) => node.props?.id === 'my-hoyo-code').props.onChange({ target:{ value:code } });
    harness.render();
    return harness.find((node) => node.type === 'form' && node.props?.className === 'my-hoyo-unlock-form').props.onSubmit({ preventDefault() {} });
  };
  const old = start(vector.displayCode);
  await flushTasks();
  harness.emit('pagehide');
  harness.emit('pageshow', { persisted:true });
  harness.render();
  const current = start('NYX-HOYO-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ');
  await current;
  harness.render();
  assert.match(harness.textContent(), /Current role/);
  first.resolve({ bundle:fixtureBundle('Stale role'), updatedAt:'2026-08-30T00:00:00Z' });
  await old;
  harness.render();
  assert.match(harness.textContent(), /Current role/);
  assert.doesNotMatch(harness.textContent(), /Stale role/);
  assert(scrubbed.includes('first'));
  harness.unmount();
});

test('auth derived after unmount is scrubbed before any network request', async () => {
  const pendingAuth = deferred();
  let pulls = 0;
  const api = {
    derive:() => pendingAuth.promise,
    pull:async () => { pulls += 1; throw new Error('must not run'); },
    scrub:loadApi().scrub,
  };
  const harness = createUiHarness({ api });
  harness.render();
  harness.find((node) => node.props?.id === 'my-hoyo-code').props.onChange({ target:{ value:vector.displayCode } });
  harness.render();
  const pending = harness.find((node) => node.type === 'form' && node.props?.className === 'my-hoyo-unlock-form').props.onSubmit({ preventDefault() {} });
  harness.unmount();
  const auth = { syncId:'fake-id', token:'fake-token', key:{ fake:true } };
  pendingAuth.resolve(auth);
  await pending;
  assert.deepEqual(auth, { syncId:null, token:null, key:null });
  assert.equal(pulls, 0);
  assert.equal(harness.updatesAfterUnmount(), 0);
});

test('failed payload keeps auth only for explicit deletion and never requires plaintext', async () => {
  const deleted = [];
  const auth = { label:'accepted-auth' };
  const api = {
    derive:async () => auth,
    pull:async () => { throw new Error('Stored copy is corrupt.'); },
    deleteGame:async (value) => { deleted.push(value.label); return { ok:true }; },
    scrub:(value) => { if (value && typeof value === 'object') { value.auth = null; value.bundle = null; } },
  };
  const harness = createUiHarness({ api });
  harness.render();
  harness.find((node) => node.props?.id === 'my-hoyo-code').props.onChange({ target:{ value:vector.displayCode } });
  harness.render();
  await harness.find((node) => node.type === 'form' && node.props?.className === 'my-hoyo-unlock-form').props.onSubmit({ preventDefault() {} });
  harness.render();
  assert.match(harness.textContent(), /still try removing/i);
  assert.equal(auth.key, null, 'decryption key is dropped in the deletion-only state');
  await harness.find((node) => harness.textContent(node).includes('Remove HSR cloud copy') && node.type === 'button').props.onClick();
  assert.deepEqual(deleted, ['accepted-auth']);
  harness.render();
  assert.match(harness.textContent(), /Removed the Star Rail HoYo cloud copy/);
  harness.unmount();
});

test('editing a recovery code immediately revokes the previous code deletion authority', async () => {
  const firstAuth = { syncId:'first-code', token:'first-token', key:{ fake:true } };
  const secondAuth = { syncId:'second-code', token:'second-token', key:{ fake:true } };
  const deleted = [];
  const secondCode = 'NYX-HOYO-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ';
  const api = {
    derive:async (code) => code === vector.displayCode ? firstAuth : secondAuth,
    pull:async () => { throw new Error('Unavailable fixture copy'); },
    deleteGame:async (auth) => { deleted.push(auth.syncId); return { ok:true }; },
    scrub:loadApi().scrub,
  };
  const harness = createUiHarness({ api });
  harness.render();
  harness.find((node) => node.props?.id === 'my-hoyo-code').props.onChange({ target:{ value:vector.displayCode } });
  harness.render();
  await harness.find((node) => node.type === 'form' && node.props?.className === 'my-hoyo-unlock-form').props.onSubmit({ preventDefault() {} });
  harness.render();
  const oldDelete = harness.find((node) => node.type === 'button' && harness.textContent(node) === 'Remove HSR cloud copy').props.onClick;
  harness.find((node) => node.props?.id === 'my-hoyo-code').props.onChange({ target:{ value:secondCode } });
  assert.deepEqual(firstAuth, { syncId:null, token:null, key:null }, 'old authority is scrubbed inside the input handler');
  await oldDelete();
  assert.deepEqual(deleted, [], 'even a stale button handler cannot delete with the first code');
  harness.render();
  assert.equal(harness.find((node) => node.props?.className === 'my-hoyo-auth-delete'), null);
  assert.equal(harness.find((node) => node.props?.id === 'my-hoyo-code').props.value, secondCode);
  await harness.find((node) => node.type === 'form' && node.props?.className === 'my-hoyo-unlock-form').props.onSubmit({ preventDefault() {} });
  harness.render();
  await harness.find((node) => node.type === 'button' && harness.textContent(node) === 'Remove HSR cloud copy').props.onClick();
  assert.deepEqual(deleted, ['second-code']);
  harness.unmount();
});

test('pagehide and persisted pageshow synchronously commit a locked tree before returning', async () => {
  for (const eventName of ['pagehide', 'pageshow']) {
    const api = {
      derive:async () => ({ syncId:'fake', token:'fake', key:{ fake:true } }),
      pull:async () => ({ bundle:fixtureBundle('Private DOM fixture'), updatedAt:'2026-08-30T00:00:00Z' }),
      scrub:loadApi().scrub,
    };
    const harness = createUiHarness({ api });
    harness.render();
    harness.find((node) => node.props?.id === 'my-hoyo-code').props.onChange({ target:{ value:vector.displayCode } });
    harness.render();
    await harness.find((node) => node.type === 'form' && node.props?.className === 'my-hoyo-unlock-form').props.onSubmit({ preventDefault() {} });
    harness.render();
    assert.match(harness.textContent(), /Private DOM fixture/);
    harness.emit(eventName, { persisted:true });
    // Deliberately do not call render here: the lifecycle handler must commit it.
    assert.equal(harness.flushCommits(), 1);
    assert.doesNotMatch(harness.textContent(), /Private DOM fixture/);
    assert(harness.find((node) => node.props?.id === 'my-hoyo-code'));
    harness.unmount();
  }
});

test('every opened snapshot keeps the canonical official fallback in its status strip', async () => {
  const canonical = 'https://act.hoyolab.com/app/community-game-records-sea/index.html?gid=6#/hsr';
  for (const state of ['complete-old', 'complete-fresh', 'partial-old', 'partial-fresh']) {
    const bundle = fixtureBundle();
    const updatedAt = state.endsWith('old') ? '2024-01-02T03:04:05Z' : '2026-08-30T00:00:00Z';
    if (state.startsWith('partial')) {
      bundle.roles[0].resource = null;
      bundle.roles[0].completedAchievementIds = null;
      bundle.roles[0].observations.resources = null;
      bundle.roles[0].observations.achievements = null;
    } else {
      bundle.roles[0].resource.observedAt = updatedAt;
      bundle.roles[0].observations.resources = updatedAt;
      bundle.roles[0].observations.achievements = updatedAt;
    }
    const api = {
      derive:async () => ({ syncId:'fake', token:'fake', key:{ fake:true } }),
      pull:async () => ({ bundle, updatedAt }),
      scrub:loadApi().scrub,
    };
    const harness = createUiHarness({ api });
    harness.render();
    harness.find((node) => node.props?.id === 'my-hoyo-code').props.onChange({ target:{ value:vector.displayCode } });
    harness.render();
    await harness.find((node) => node.type === 'form' && node.props?.className === 'my-hoyo-unlock-form').props.onSubmit({ preventDefault() {} });
    harness.render();
    const strip = harness.find((node) => node.props?.['aria-label'] === 'Cloud copy status');
    const link = strip.props.children.find((node) => node?.type === 'a');
    assert.equal(link.props.href, canonical, state);
    assert.equal(link.props.rel, 'noopener noreferrer');
    assert.equal(link.props.target, '_blank');
    if (state.startsWith('complete')) assert.match(harness.textContent(), /Expected full at snapshot/);
    harness.unmount();
  }
});

test('pull-only deletion remains reachable after a fresh mount and resets its form immediately', async () => {
  const phrases = [];
  const api = { scrub:() => {} };
  for (let mount = 0; mount < 2; mount += 1) {
    const harness = createUiHarness({ api, accountSync:{ deleteAccount:async (phrase) => { phrases.push(phrase); } } });
    harness.render();
    const form = harness.find((node) => node.type === 'form' && node.props?.className === 'my-hoyo-pull-retry');
    assert(form, 'pull-only deletion form is present without a HoYo session');
    let resets = 0;
    await form.props.onSubmit({ preventDefault() {}, currentTarget:{ data:{ pullPhrase:'test-only pull phrase' }, reset() { resets += 1; } } });
    assert.equal(resets, 1);
    harness.unmount();
  }
  assert.deepEqual(phrases, ['test-only pull phrase', 'test-only pull phrase']);
});

test('pagehide aborts pull-only deletion and ignores its delayed completion', async () => {
  const pendingDelete = deferred();
  let signal;
  const harness = createUiHarness({
    api:{ scrub:() => {} },
    accountSync:{ deleteAccount:(phrase, options) => { signal = options.signal; return pendingDelete.promise; } },
  });
  harness.render();
  const form = harness.find((node) => node.type === 'form' && node.props?.className === 'my-hoyo-pull-retry');
  const pending = form.props.onSubmit({ preventDefault() {}, currentTarget:{ data:{ pullPhrase:'test-only pull phrase' }, reset() {} } });
  harness.emit('pagehide');
  assert.equal(signal.aborted, true);
  pendingDelete.resolve({ ok:true });
  await pending;
  harness.render();
  assert.doesNotMatch(harness.textContent(), /Removed encrypted pull-history cloud data/);
  harness.unmount();
});

test('Lock and successful HSR or HoYo deletion use the same sensitive cleanup', async () => {
  for (const action of ['Lock', 'Remove HSR cloud copy', 'Remove all HoYo cloud data']) {
    const api = {
      derive:async () => ({ syncId:'fake', token:'fake', key:{ fake:true } }),
      pull:async () => ({ bundle:fixtureBundle('Private fixture role'), updatedAt:'2026-08-30T00:00:00Z' }),
      deleteGame:async () => ({ ok:true }),
      deleteAccount:async () => ({ ok:true }),
      scrub:loadApi().scrub,
    };
    const harness = createUiHarness({ api });
    harness.render();
    harness.find((node) => node.props?.id === 'my-hoyo-code').props.onChange({ target:{ value:vector.displayCode } });
    harness.render();
    await harness.find((node) => node.type === 'form' && node.props?.className === 'my-hoyo-unlock-form').props.onSubmit({ preventDefault() {} });
    harness.render();
    const achievements = harness.find((node) => node.props?.className === 'my-hoyo-achievement-list');
    assert.equal(achievements.props.tabIndex, '0');
    assert.equal(achievements.props['aria-label'], 'Completed achievement names and IDs');
    harness.find((node) => node.type === 'button' && harness.textContent(node) === 'Remove entire Pengo cloud data').props.onClick();
    harness.render();
    assert(harness.find((node) => node.props?.id === 'my-hoyo-entire-delete'));
    await harness.find((node) => node.type === 'button' && harness.textContent(node) === action).props.onClick();
    harness.render();
    assert.doesNotMatch(harness.textContent(), /Private fixture role/);
    assert.equal(harness.find((node) => node.props?.id === 'my-hoyo-entire-delete'), null);
    assert.equal(harness.find((node) => node.props?.id === 'my-hoyo-code').props.value, '');
    assert(harness.resetCalls.includes('my-hoyo-entire-delete'));
    harness.unmount();
  }
});

test('combined deletion is pull-first and reports each safe partial outcome truthfully', async () => {
  for (const scenario of ['pull-fails', 'hoyo-fails']) {
    const order = [];
    const api = {
      derive:async () => ({ label:'hoyo-auth' }),
      pull:async () => ({ bundle:fixtureBundle(), updatedAt:'2026-08-30T00:00:00Z' }),
      deleteAccount:async () => { order.push('hoyo'); if (scenario === 'hoyo-fails') throw new Error('HoYo unavailable'); },
      scrub:(value) => { if (value && typeof value === 'object') { value.auth = null; value.bundle = null; } },
    };
    const accountSync = { deleteAccount:async () => { order.push('pulls'); if (scenario === 'pull-fails') throw new Error('Wrong pull phrase'); } };
    const harness = createUiHarness({ api, accountSync });
    harness.render();
    harness.find((node) => node.props?.id === 'my-hoyo-code').props.onChange({ target:{ value:vector.displayCode } });
    harness.render();
    await harness.find((node) => node.type === 'form' && node.props?.className === 'my-hoyo-unlock-form').props.onSubmit({ preventDefault() {} });
    harness.render();
    harness.find((node) => node.type === 'button' && harness.textContent(node).includes('Remove entire Pengo')).props.onClick();
    harness.render();
    const form = harness.find((node) => node.props?.id === 'my-hoyo-entire-delete');
    let resets = 0;
    await form.props.onSubmit({ preventDefault() {}, currentTarget:{ data:{ pullPhrase:'test-only pull phrase' }, reset() { resets += 1; } } });
    assert.equal(resets, 1);
    harness.render();
    if (scenario === 'pull-fails') {
      assert.deepEqual(order, ['pulls']);
      assert.match(harness.textContent(), /HoYo cloud data was not touched/);
    } else {
      assert.deepEqual(order, ['pulls', 'hoyo']);
      assert.match(harness.textContent(), /Pull cloud data was removed. HoYo cloud deletion was not confirmed/);
    }
    harness.unmount();
  }
});

test('resource snapshot copy uses an absolute historical expected-full time', () => {
  const harness = createUiHarness({ api:{ scrub:() => {} } });
  harness.render();
  const value = harness.expectedFull({ observedAt:'2024-01-02T03:04:05Z', recoverySeconds:3600 });
  assert.equal(value, new Date('2024-01-02T04:04:05Z').toLocaleString());
  assert.match(value, /2024/);
  harness.unmount();
});

test('My HoYo route, UI, privacy, accessibility, and pull compatibility stay additive', () => {
  assert.match(appSource, /\{ key:'my-hoyo',\s+label:'My HoYo' \}/);
  assert.match(appSource, /'my-hoyo':'my-hoyo'/);
  assert.match(appSource, /tab === 'my-hoyo' && <MyHoyoPage \/>/);
  assert.match(buildSource, /features\/account\/hoyo-sync\.js/);
  assert.match(buildSource, /features\/account\/my-hoyo\.jsx/);
  assert.match(uiSource, /aria-labelledby="my-hoyo-title"/);
  assert.match(uiSource, /role=\{error \? 'alert' : 'status'\}/);
  assert.match(uiSource, /aria-pressed=/);
  assert.match(uiSource, /setRecoveryCode\(''\)/, 'raw recovery input is cleared before cloud access');
  assert.match(uiSource, /api\?\.scrub\(sessionRef\.current\)/, 'decrypted session is cleared on lock and unmount');
  assert.match(uiSource, /does not show it as zero/);
  assert.match(uiSource, /Unmatched achievement #/);
  assert.match(uiSource, /Remove pull-history cloud data/);
  assert.match(uiSource, /tabIndex="0" aria-label="Completed achievement names and IDs"/);
  assert.match(uiSource, /Expected full at snapshot/);
  assert.doesNotMatch(uiSource, />Full in</);
  assert.equal((uiSource.match(/https:\/\/act\.hoyolab\.com\/app\/community-game-records-sea\/index\.html\?gid=6#\/hsr/g) || []).length, 3);
  assert.equal((uiSource.match(/rel="noopener noreferrer"/g) || []).length, 3);
  assert.doesNotMatch(source + uiSource, /localStorage|indexedDB|console\.|location\.|push\(/i);
  assert.match(css, /\.my-hoyo-constellation/);
  assert.match(css, /\.my-hoyo-achievement-list:focus-visible/);
  assert.match(css, /@media \(max-width:760px\)[^{]*\{[^}]*\.my-hoyo-scroll/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{ \.my-hoyo/);
  assert.match(pullsSource, /async function deleteAccount\(secret, options = \{\}\)/);
  for (const method of ['pushGame', 'pullGame', 'status', 'deleteGame']) assert.match(pullsSource, new RegExp('\\b' + method + '\\b'));
});

test('pull account deletion executes the exact additive receiver request without a game', async () => {
  const calls = [];
  let responseBody = { ok:true };
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok:true, status:200, json:async () => responseBody };
  };
  const window = { crypto:webcrypto, NyxPullStore:{}, NYX_API_BASE:'https://sync.example' };
  vm.runInNewContext(pullsSource, {
    window,
    crypto:webcrypto,
    fetch,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    btoa:(value) => Buffer.from(value, 'binary').toString('base64'),
    atob:(value) => Buffer.from(value, 'base64').toString('binary'),
    localStorage:{ getItem:() => null, setItem:() => {}, removeItem:() => {} },
    JSON,
    Object,
    String,
    Error,
  });
  const phrase = 'test-only pull phrase';
  const controller = new AbortController();
  await window.NyxAccountSync.deleteAccount(phrase, { signal:controller.signal });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://sync.example/api/account/sync/delete-account');
  assert.equal(calls[0].init.signal, controller.signal);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, {
    accountId:createHash('sha256').update('nyx-sync-id:v1:' + phrase).digest('hex').slice(0, 48),
    token:createHash('sha256').update('nyx-sync-token:v1:' + phrase).digest('hex'),
    kind:'pulls',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'game'), false);
  responseBody = {};
  await assert.rejects(window.NyxAccountSync.deleteAccount(phrase), /not confirmed/);
});
