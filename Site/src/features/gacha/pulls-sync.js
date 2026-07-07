// ============================================================
// Nyx pull-history sync (window.NyxAccountSync)
//
// A local-first account layer: the browser encrypts pull bundles with a
// user-chosen sync phrase before sending them to the Worker. The Worker stores
// opaque ciphertext only, keyed by a derived account id and protected by a
// separate derived write/read token.
// ============================================================

window.NyxAccountSync = (function () {
  'use strict';

  const SETTINGS_KEY = 'nyx:p pull-sync:v1'.replace('p ', '');
  const KDF_ITERATIONS = 150000;
  const STORE = () => window.NyxPullStore || null;
  const apiBase = () => (typeof window !== 'undefined' && window.NYX_API_BASE) || '';

  function available() {
    return !!(window.crypto && crypto.subtle && STORE());
  }

  function normalizeSecret(secret) {
    return String(secret || '').trim();
  }

  function utf8(text) {
    return new TextEncoder().encode(String(text));
  }

  function bytesToBase64(bytes) {
    let out = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(out);
  }

  function base64ToBytes(value) {
    const bin = atob(String(value || ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function shaHex(text) {
    const hash = await crypto.subtle.digest('SHA-256', utf8(text));
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function credentials(secret) {
    const clean = normalizeSecret(secret);
    if (clean.length < 10) throw new Error('Use a sync phrase with at least 10 characters.');
    const accountId = (await shaHex('nyx-sync-id:v1:' + clean)).slice(0, 48);
    const token = await shaHex('nyx-sync-token:v1:' + clean);
    return { accountId, token };
  }

  async function deriveKey(secret, accountId) {
    const baseKey = await crypto.subtle.importKey('raw', utf8(normalizeSecret(secret)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: utf8('nyx-pull-sync:' + accountId),
        iterations: KDF_ITERATIONS,
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptBundle(secret, accountId, bundle) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(secret, accountId);
    const plain = utf8(JSON.stringify(bundle));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
    return {
      format: 'nyx-pull-sync-v1',
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS },
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(cipher)),
    };
  }

  async function decryptBundle(secret, accountId, payload) {
    if (!payload || payload.format !== 'nyx-pull-sync-v1') throw new Error('That sync data uses an unsupported format.');
    const key = await deriveKey(secret, accountId);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
      key,
      base64ToBytes(payload.ciphertext)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  async function request(action, body) {
    const res = await fetch(apiBase() + '/api/account/sync/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.ok === false) {
      const msg = json && json.error && json.error.message ? json.error.message : ('Sync request failed (' + res.status + ').');
      const err = new Error(msg);
      if (json && json.error && json.error.code) err.code = json.error.code;
      if (json && json.serverExportedAt) err.serverExportedAt = json.serverExportedAt;
      throw err;
    }
    return json;
  }

  async function pushGame(secret, game, opts) {
    if (!available()) throw new Error('Encrypted sync is not available in this browser.');
    const auth = await credentials(secret);
    const bundle = await STORE().exportGame(game);
    if (!bundle.accounts.length) throw new Error('There is no saved local history for this game yet.');
    const payload = await encryptBundle(secret, auth.accountId, bundle);
    const result = await request('push', {
      accountId: auth.accountId,
      token: auth.token,
      game,
      payload,
      exportedAt: bundle.exportedAt,
      force: !!(opts && opts.force),
    });
    saveSettings({ accountId: auth.accountId, lastGame: game, updatedAt: result.updatedAt || Date.now() });
    return Object.assign({}, result, { accountId: auth.accountId, accounts: bundle.accounts.length });
  }

  async function pullGame(secret, game) {
    if (!available()) throw new Error('Encrypted sync is not available in this browser.');
    const auth = await credentials(secret);
    const result = await request('pull', { accountId: auth.accountId, token: auth.token, game });
    if (!result.payload) throw new Error('No synced history was found for this game.');
    const bundle = await decryptBundle(secret, auth.accountId, result.payload);
    const imported = await STORE().importBundle(bundle, { sourceLabel: 'Pengo sync' });
    saveSettings({ accountId: auth.accountId, lastGame: game, updatedAt: result.updatedAt || Date.now() });
    return Object.assign({}, result, imported, { accountId: auth.accountId });
  }

  async function status(secret, game) {
    const auth = await credentials(secret);
    return request('status', { accountId: auth.accountId, token: auth.token, game });
  }

  async function deleteGame(secret, game) {
    const auth = await credentials(secret);
    return request('delete', { accountId: auth.accountId, token: auth.token, game });
  }

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }

  function saveSettings(next) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.assign({}, loadSettings(), next))); } catch (e) {}
  }

  function forgetSettings() {
    try { localStorage.removeItem(SETTINGS_KEY); } catch (e) {}
  }

  return {
    available,
    credentials,
    pushGame,
    pullGame,
    status,
    deleteGame,
    loadSettings,
    forgetSettings,
  };
})();

if (window.NyxSync && window.NyxAccountSync) {
  window.NyxSync.register({
    id: 'account',
    label: 'Pengo encrypted sync',
    isReady: () => window.NyxAccountSync.available(),
  });
}
