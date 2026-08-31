(function initNyxHoyoSync(global) {
  'use strict';

  const FORMAT = 'nyx-hoyolab-sync-v1';
  const GAME = 'hsr';
  const KIND = 'hoyolab';
  const KDF_ITERATIONS = 150000;
  const MAX_PLAINTEXT_BYTES = 3 * 1024 * 1024;
  const MAX_CIPHERTEXT_BYTES = MAX_PLAINTEXT_BYTES + 16;
  const CAPABILITIES = ['resources', 'inventory', 'builds', 'achievements', 'exploration', 'endgame', 'events', 'currency'];
  const HSR_SERVERS = new Set(['prod_official_usa', 'prod_official_eur', 'prod_official_asia', 'prod_official_cht']);
  const REGION_LABELS = {
    prod_official_usa:'Americas',
    prod_official_eur:'Europe',
    prod_official_asia:'Asia',
    prod_official_cht:'TW/HK/MO',
  };
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal:true });
  const apiBase = () => (typeof global.NYX_API_BASE === 'string' ? global.NYX_API_BASE : '');

  function exactObject(value, names) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const actual = Object.keys(value);
    return actual.length === names.length && names.every((name) => Object.prototype.hasOwnProperty.call(value, name));
  }

  function normalizeRecoveryCode(value) {
    const canonical = String(value || '').normalize('NFKC').trim().toUpperCase().replace(/[\t\n\v\f\r -]/g, '');
    if (!/^NYXHOYO[A-Z2-7]{32}$/.test(canonical)) {
      throw new Error('Enter the complete NYX-HOYO recovery code.');
    }
    return canonical;
  }

  function hex(bytes) {
    let output = '';
    for (const value of bytes) output += value.toString(16).padStart(2, '0');
    return output;
  }

  async function sha256Text(prefix, canonical) {
    const input = encoder.encode(prefix + canonical);
    let digest;
    try {
      digest = new Uint8Array(await global.crypto.subtle.digest('SHA-256', input));
      return hex(digest);
    } finally {
      input.fill(0);
      digest?.fill(0);
    }
  }

  async function derive(value) {
    if (!global.crypto?.subtle) throw new Error('Encrypted HoYo access is not available in this browser.');
    const canonical = normalizeRecoveryCode(value);
    const syncId = (await sha256Text('nyx-hoyolab-sync-id:v1:', canonical)).slice(0, 48);
    const token = await sha256Text('nyx-hoyolab-sync-token:v1:', canonical);
    const material = encoder.encode(canonical);
    const salt = encoder.encode('nyx-hoyolab-sync-key:v1:' + syncId);
    let baseKey;
    try {
      baseKey = await global.crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveKey']);
      const key = await global.crypto.subtle.deriveKey(
        { name:'PBKDF2', hash:'SHA-256', salt, iterations:KDF_ITERATIONS },
        baseKey,
        { name:'AES-GCM', length:256 },
        false,
        ['decrypt']
      );
      return { syncId, token, key };
    } finally {
      material.fill(0);
      salt.fill(0);
      baseKey = null;
    }
  }

  function canonicalBase64(value, minimum, maximum) {
    if (typeof value !== 'string'
      || value.length === 0
      || value.length > Math.ceil(maximum / 3) * 4
      || value.length % 4 !== 0
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      throw new Error('The encrypted HoYo copy is invalid.');
    }
    let binary;
    try { binary = global.atob(value); }
    catch { throw new Error('The encrypted HoYo copy is invalid.'); }
    if (global.btoa(binary) !== value || binary.length < minimum || binary.length > maximum) {
      throw new Error('The encrypted HoYo copy is invalid.');
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    binary = '';
    return bytes;
  }

  function validTimestamp(value, now = Date.now()) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed)
      && parsed >= 0
      && parsed <= now + 5 * 60 * 1000
      && new Date(parsed).toISOString().replace('.000Z', 'Z') === value;
  }

  function validBinding(value) {
    return exactObject(value, ['roleId', 'server'])
      && typeof value.roleId === 'string'
      && /^\d{1,20}$/.test(value.roleId)
      && typeof value.server === 'string'
      && HSR_SERVERS.has(value.server);
  }

  function bindingKey(value) {
    return value.server + '\n' + value.roleId;
  }

  function validNickname(value) {
    if (value === null) return true;
    if (typeof value !== 'string' || value.length === 0 || Array.from(value).length > 32) return false;
    const bytes = encoder.encode(value);
    try {
      return bytes.length <= 64 && decoder.decode(bytes) === value && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
    } catch { return false; }
    finally { bytes.fill(0); }
  }

  function validObservations(value, now) {
    if (!exactObject(value, CAPABILITIES)) return false;
    if (!CAPABILITIES.every((name) => value[name] === null || validTimestamp(value[name], now))) return false;
    return ['inventory', 'builds', 'exploration', 'endgame', 'events', 'currency'].every((name) => value[name] === null);
  }

  function validResource(value, observation, now) {
    if (value === null) return observation === null;
    return exactObject(value, ['name', 'current', 'maximum', 'observedAt', 'recoverySeconds', 'reserve'])
      && value.name === 'Trailblaze Power'
      && Number.isInteger(value.current) && value.current >= 0 && value.current <= 10000
      && Number.isInteger(value.maximum) && value.maximum > 0 && value.maximum <= 10000
      && value.current <= value.maximum
      && validTimestamp(value.observedAt, now)
      && value.observedAt === observation
      && Number.isInteger(value.recoverySeconds) && value.recoverySeconds >= 0 && value.recoverySeconds <= 14 * 24 * 60 * 60
      && (value.reserve === null || (Number.isInteger(value.reserve) && value.reserve >= 0 && value.reserve <= 10000));
  }

  function validAchievements(value, observation) {
    if (value === null) return observation === null;
    if (!Array.isArray(value) || observation === null || value.length > 10000) return false;
    let previous = 0;
    for (const id of value) {
      if (!Number.isSafeInteger(id) || id <= previous || id > Number.MAX_SAFE_INTEGER) return false;
      previous = id;
    }
    return true;
  }

  function compareTombstone(left, right, includeCapability) {
    const compare = (a, b) => a === b ? 0 : a < b ? -1 : 1;
    return compare(left.deletedAt, right.deletedAt)
      || compare(left.binding.server, right.binding.server)
      || compare(left.binding.roleId, right.binding.roleId)
      || (includeCapability ? compare(left.capability, right.capability) : 0);
  }

  // JSON.parse keeps only the last duplicate property. The launcher rejects
  // duplicates, so scan object keys first and fail closed at the same boundary.
  function hasUniqueJsonProperties(text) {
    let index = 0;
    const whitespace = () => { while (/\s/.test(text[index] || '')) index += 1; };
    const readString = () => {
      if (text[index] !== '"') throw new Error('string');
      const start = index++;
      let escaped = false;
      while (index < text.length) {
        const char = text[index++];
        if (escaped) { escaped = false; continue; }
        if (char === '\\') { escaped = true; continue; }
        if (char === '"') return JSON.parse(text.slice(start, index));
      }
      throw new Error('string');
    };
    const readValue = () => {
      whitespace();
      if (text[index] === '"') { readString(); return; }
      if (text[index] === '[') {
        index += 1; whitespace();
        if (text[index] === ']') { index += 1; return; }
        while (index < text.length) {
          readValue(); whitespace();
          if (text[index] === ']') { index += 1; return; }
          if (text[index++] !== ',') throw new Error('array');
        }
        throw new Error('array');
      }
      if (text[index] === '{') {
        index += 1; whitespace();
        const keys = new Set();
        if (text[index] === '}') { index += 1; return; }
        while (index < text.length) {
          whitespace();
          const key = readString();
          if (keys.has(key)) throw new Error('duplicate');
          keys.add(key);
          whitespace();
          if (text[index++] !== ':') throw new Error('object');
          readValue(); whitespace();
          if (text[index] === '}') { index += 1; return; }
          if (text[index++] !== ',') throw new Error('object');
        }
        throw new Error('object');
      }
      const start = index;
      while (index < text.length && !/[\s,\]}]/.test(text[index])) index += 1;
      if (index === start) throw new Error('value');
    };
    try { readValue(); whitespace(); return index === text.length; }
    catch { return false; }
  }

  function validateBundle(bundle, now = Date.now()) {
    if (!exactObject(bundle, ['schemaVersion', 'gameId', 'roles', 'selectedRole', 'consents', 'capabilityTombstones', 'roleTombstones'])
      || bundle.schemaVersion !== 2
      || bundle.gameId !== GAME
      || !Array.isArray(bundle.roles) || bundle.roles.length > 8
      || !exactObject(bundle.consents, CAPABILITIES)
      || !CAPABILITIES.every((name) => typeof bundle.consents[name] === 'boolean')
      || ['inventory', 'builds', 'exploration', 'endgame', 'events', 'currency'].some((name) => bundle.consents[name])
      || !Array.isArray(bundle.capabilityTombstones) || bundle.capabilityTombstones.length > 64
      || !Array.isArray(bundle.roleTombstones) || bundle.roleTombstones.length > 64) {
      throw new Error('The HoYo copy uses an unsupported or invalid account format.');
    }

    const active = new Map();
    for (const role of bundle.roles) {
      if (!exactObject(role, ['binding', 'nickname', 'region', 'observations', 'resource', 'completedAchievementIds'])
        || !validBinding(role.binding)
        || active.has(bindingKey(role.binding))
        || !validNickname(role.nickname)
        || role.region !== REGION_LABELS[role.binding.server]
        || !validObservations(role.observations, now)
        || !validResource(role.resource, role.observations.resources, now)
        || !validAchievements(role.completedAchievementIds, role.observations.achievements)
        || (role.resource !== null && !bundle.consents.resources)
        || (role.completedAchievementIds !== null && !bundle.consents.achievements)) {
        throw new Error('The HoYo copy contains an invalid Star Rail role.');
      }
      active.set(bindingKey(role.binding), role);
    }

    if (active.size === 0) {
      if (bundle.selectedRole !== null || bundle.roleTombstones.length === 0) throw new Error('The HoYo copy has no valid selected role.');
    } else if (!validBinding(bundle.selectedRole) || !active.has(bindingKey(bundle.selectedRole))) {
      throw new Error('The HoYo copy has no valid selected role.');
    }

    const deleted = new Set();
    let previousRole = null;
    for (const tombstone of bundle.roleTombstones) {
      if (!exactObject(tombstone, ['binding', 'deletedAt'])
        || !validBinding(tombstone.binding)
        || active.has(bindingKey(tombstone.binding))
        || deleted.has(bindingKey(tombstone.binding))
        || !validTimestamp(tombstone.deletedAt, now)
        || (previousRole && compareTombstone(previousRole, tombstone, false) >= 0)) {
        throw new Error('The HoYo copy contains an invalid deleted role.');
      }
      deleted.add(bindingKey(tombstone.binding));
      previousRole = tombstone;
    }

    const deletedCapabilities = new Set();
    let previousCapability = null;
    for (const tombstone of bundle.capabilityTombstones) {
      const identity = validBinding(tombstone?.binding) ? bindingKey(tombstone.binding) + '\n' + tombstone.capability : '';
      const role = active.get(validBinding(tombstone?.binding) ? bindingKey(tombstone.binding) : '');
      if (!exactObject(tombstone, ['binding', 'capability', 'deletedAt'])
        || !validBinding(tombstone.binding)
        || !CAPABILITIES.includes(tombstone.capability)
        || deletedCapabilities.has(identity)
        || (!role && !deleted.has(bindingKey(tombstone.binding)))
        || !validTimestamp(tombstone.deletedAt, now)
        || (previousCapability && compareTombstone(previousCapability, tombstone, true) >= 0)
        || (role && tombstone.capability === 'resources' && (role.resource !== null || role.observations.resources !== null))
        || (role && tombstone.capability === 'achievements' && (role.completedAchievementIds !== null || role.observations.achievements !== null))) {
        throw new Error('The HoYo copy contains an invalid deleted capability.');
      }
      deletedCapabilities.add(identity);
      previousCapability = tombstone;
    }
    return bundle;
  }

  async function decrypt(auth, payload) {
    if (!auth?.key || typeof auth.syncId !== 'string') throw new Error('Unlock this HoYo copy again.');
    if (!exactObject(payload, ['format', 'kdf', 'iv', 'ciphertext'])
      || payload.format !== FORMAT
      || !exactObject(payload.kdf, ['name', 'hash', 'iterations'])
      || payload.kdf.name !== 'PBKDF2'
      || payload.kdf.hash !== 'SHA-256'
      || payload.kdf.iterations !== KDF_ITERATIONS) {
      throw new Error('The encrypted HoYo copy uses an unsupported format.');
    }
    let iv;
    let ciphertext;
    let aad;
    let plaintext;
    let bundle;
    try {
      iv = canonicalBase64(payload.iv, 12, 12);
      ciphertext = canonicalBase64(payload.ciphertext, 17, MAX_CIPHERTEXT_BYTES);
      aad = encoder.encode(FORMAT + '|' + KIND + '|' + GAME + '|' + auth.syncId);
      plaintext = new Uint8Array(await global.crypto.subtle.decrypt({ name:'AES-GCM', iv, additionalData:aad }, auth.key, ciphertext));
      if (plaintext.length === 0 || plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('The decrypted HoYo copy is too large.');
      let text;
      try { text = decoder.decode(plaintext); }
      catch { throw new Error('The decrypted HoYo copy is not valid text.'); }
      try {
        if (!hasUniqueJsonProperties(text)) throw new Error('json');
        bundle = JSON.parse(text);
      }
      catch { throw new Error('The decrypted HoYo copy is not valid JSON.'); }
      text = '';
      return validateBundle(bundle);
    } catch (error) {
      if (bundle) scrub(bundle);
      if (error?.name === 'OperationError') throw new Error('That recovery code does not unlock this HoYo copy.');
      throw error;
    } finally {
      iv?.fill(0);
      ciphertext?.fill(0);
      aad?.fill(0);
      plaintext?.fill(0);
    }
  }

  async function request(action, auth, options = {}) {
    if (!auth || !/^[a-f0-9]{48}$/.test(auth.syncId || '') || !/^[a-f0-9]{64}$/.test(auth.token || '')) {
      throw new Error('Unlock this HoYo copy again.');
    }
    const response = await global.fetch(apiBase() + '/api/account/sync/' + action, {
      method:'POST',
      credentials:'same-origin',
      signal:options.signal,
      headers:{ 'Content-Type':'application/json', 'X-Nyx-Sync-Kind':KIND },
      body:JSON.stringify({ kind:KIND, syncId:auth.syncId, token:auth.token, game:GAME }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || result.ok !== true) {
      const error = new Error(result?.error?.message || 'HoYo cloud access failed (' + response.status + ').');
      if (result?.error?.code) error.code = result.error.code;
      throw error;
    }
    return result;
  }

  async function pull(auth, options) {
    const result = await request('pull', auth, options);
    if (!result.payload) throw new Error('No synced HoYo data was found.');
    return { bundle:await decrypt(auth, result.payload), updatedAt:result.updatedAt || null };
  }

  function scrub(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value instanceof Uint8Array) { value.fill(0); return; }
    if (Array.isArray(value)) { value.forEach((item) => scrub(item, seen)); value.length = 0; return; }
    for (const key of Object.keys(value)) {
      scrub(value[key], seen);
      try { value[key] = null; } catch { }
    }
  }

  global.NyxHoyoSync = Object.freeze({
    FORMAT,
    GAME,
    KIND,
    KDF_ITERATIONS,
    MAX_PLAINTEXT_BYTES,
    normalizeRecoveryCode,
    derive,
    decrypt,
    validateBundle,
    pull,
    status:(auth, options) => request('status', auth, options),
    deleteGame:(auth, options) => request('delete', auth, options),
    deleteAccount:(auth, options) => request('delete-account', auth, options),
    scrub,
  });
})(window);
