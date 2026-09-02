(function initPengoPullLauncherBridge(global){
  'use strict';

  const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
  const HANDOFF_TIMEOUT_MS = 15_000;
  const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
  const PORT_PATTERN = /^[1-9][0-9]{3,4}$/;
  const INVALID_HANDOFF = 'The launcher handoff link is invalid or has expired.';

  const consumedFragments = new Set();
  let pendingPromise = null;

  function error(message, code){
    const result = new Error(message);
    if (code) result.code = code;
    return result;
  }

  function clearFragment(location, history){
    if (!location || !history || typeof history.replaceState !== 'function') return false;
    const clean = `${location.pathname || '/'}${location.search || ''}`;
    try { history.replaceState(history.state ?? null, '', clean); return true; } catch (e) { return false; }
  }

  function recognized(raw){
    return raw.startsWith('#nyx-import=v1') || raw.startsWith('#nyx-import=v2');
  }

  function validPort(value){
    return PORT_PATTERN.test(value || '') && Number(value) >= 1024 && Number(value) <= 65535;
  }

  function receiverPage(location, version){
    if (!location) return false;
    const origin = String(location.origin || '');
    if (origin !== 'https://pengo.gg' && origin !== 'http://127.0.0.1:5173') return false;
    if (version === 'v2') return location.pathname === '/endfield' ? { type:'pulls' } : false;
    const game = location.pathname === '/genshin/achievements' ? 'gi'
      : location.pathname === '/hsr/achievements' ? 'hsr' : '';
    return game ? { type:'achievements', game } : false;
  }

  function parseFragment(location=global.location, history=global.history){
    const target = location;
    const raw = String(target && target.hash || '');
    if (!recognized(raw)) return null;
    if (consumedFragments.has(raw)) return null;
    consumedFragments.add(raw);
    if (!clearFragment(target, history)) throw error(INVALID_HANDOFF, 'INVALID_HANDOFF');

    const version = raw.startsWith('#nyx-import=v1') ? 'v1' : 'v2';
    const receiver = receiverPage(target, version);
    if (!receiver) throw error(INVALID_HANDOFF, 'INVALID_HANDOFF');
    if (raw.includes('%') || raw.includes('+')) throw error(INVALID_HANDOFF, 'INVALID_HANDOFF');
    const fields = raw.slice(1).split('&');
    const expectedNames = version === 'v1'
      ? ['nyx-import', 'port', 'nonce']
      : ['nyx-import', 'type', 'port', 'nonce'];
    if (fields.length !== expectedNames.length) throw error(INVALID_HANDOFF, 'INVALID_HANDOFF');
    const values = Object.create(null);
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index];
      const equal = field.indexOf('=');
      if (equal <= 0 || equal !== field.lastIndexOf('=')) throw error(INVALID_HANDOFF, 'INVALID_HANDOFF');
      const name = field.slice(0, equal);
      const value = field.slice(equal + 1);
      if (name !== expectedNames[index] || Object.hasOwn(values, name)) {
        throw error(INVALID_HANDOFF, 'INVALID_HANDOFF');
      }
      values[name] = value;
    }
    if (values['nyx-import'] !== version || (version === 'v2' && values.type !== 'pulls')
      || !validPort(values.port) || !NONCE_PATTERN.test(values.nonce || '')) {
      throw error(INVALID_HANDOFF, 'INVALID_HANDOFF');
    }
    if (version === 'v1') {
      return Object.freeze({
        version,
        type: receiver.type,
        game: receiver.game,
        endpoint: `http://127.0.0.1:${values.port}/v1/achievement-import/${values.nonce}`,
      });
    }
    return Object.freeze({
      version,
      type: receiver.type,
      endpoint: `http://127.0.0.1:${values.port}/v2/pull-import/${values.nonce}`,
    });
  }

  function dependency(name, options){
    if (options && Object.hasOwn(options, name)) return options[name];
    if (global && global[name]) return global[name];
    try {
      if (name === 'AbortController' && typeof AbortController === 'function') return AbortController;
      if (name === 'TextEncoder' && typeof TextEncoder === 'function') return TextEncoder;
      if (name === 'TextDecoder' && typeof TextDecoder === 'function') return TextDecoder;
      if (name === 'setTimeout' && typeof setTimeout === 'function') return setTimeout;
      if (name === 'clearTimeout' && typeof clearTimeout === 'function') return clearTimeout;
    } catch (e) {}
    return null;
  }

  function header(response, name){
    return response && response.headers && typeof response.headers.get === 'function'
      ? response.headers.get(name)
      : null;
  }

  function checkLength(response){
    const declared = header(response, 'content-length');
    if (declared == null) return;
    const value = String(declared);
    if (!/^\d+$/.test(value) || Number(value) > MAX_PAYLOAD_BYTES) {
      throw error('The launcher export is too large.', 'PAYLOAD_TOO_LARGE');
    }
  }

  function asBytes(value){
    if (!value) return null;
    if (value instanceof Uint8Array) return value;
    try {
      if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return new Uint8Array(value);
      if (ArrayBuffer.isView(value) && value.BYTES_PER_ELEMENT === 1) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      }
    } catch (e) {}
    return null;
  }

  function decode(bytes, options){
    const Decoder = dependency('TextDecoder', options);
    if (typeof Decoder !== 'function') throw error('The launcher returned an invalid response.', 'INVALID_RESPONSE');
    return new Decoder('utf-8', { fatal:true }).decode(bytes);
  }

  async function readBody(response, options={}){
    checkLength(response);
    const body = response && response.body;
    if (body && typeof body.getReader === 'function') {
      const reader = body.getReader();
      const chunks = [];
      let total = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (!part || part.done) break;
          const bytes = asBytes(part.value);
          if (!bytes) throw error('The launcher returned an invalid response.', 'INVALID_RESPONSE');
          total += bytes.byteLength;
          if (total > MAX_PAYLOAD_BYTES) {
            try { await reader.cancel(); } catch (e) {}
            throw error('The launcher export is too large.', 'PAYLOAD_TOO_LARGE');
          }
          chunks.push(bytes);
        }
      } finally {
        try { reader.releaseLock?.(); } catch (e) {}
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return decode(bytes, options);
    }

    if (response && typeof response.arrayBuffer === 'function') {
      const bytes = asBytes(await response.arrayBuffer());
      if (!bytes || bytes.byteLength > MAX_PAYLOAD_BYTES) {
        throw error('The launcher export is too large.', 'PAYLOAD_TOO_LARGE');
      }
      return decode(bytes, options);
    }

    if (!response || typeof response.text !== 'function') {
      throw error('The launcher returned an invalid response.', 'INVALID_RESPONSE');
    }
    const text = await response.text();
    const Encoder = dependency('TextEncoder', options);
    if (typeof Encoder !== 'function' || new Encoder().encode(text).byteLength > MAX_PAYLOAD_BYTES) {
      throw error('The launcher export is too large.', 'PAYLOAD_TOO_LARGE');
    }
    return text;
  }

  function endpointParts(request){
    if (!request || typeof request.endpoint !== 'string') {
      throw error('The launcher handoff request is invalid.', 'INVALID_HANDOFF');
    }
    const endpointPattern = request.version === 'v2' && request.type === 'pulls'
      ? /^http:\/\/127\.0\.0\.1:([1-9][0-9]{3,4})\/v2\/pull-import\/([A-Za-z0-9_-]{43})$/
      : request.version === 'v1' && request.type === 'achievements' && ['gi', 'hsr'].includes(request.game)
        ? /^http:\/\/127\.0\.0\.1:([1-9][0-9]{3,4})\/v1\/achievement-import\/([A-Za-z0-9_-]{43})$/
        : null;
    if (!endpointPattern) throw error('The launcher handoff request is invalid.', 'INVALID_HANDOFF');
    const match = endpointPattern.exec(request.endpoint);
    if (!match || !validPort(match[1]) || !NONCE_PATTERN.test(match[2])) {
      throw error('The launcher handoff request is invalid.', 'INVALID_HANDOFF');
    }
    return match;
  }

  function strictParser(request){
    if (request.version !== 'v2' || request.type !== 'pulls') return null;
    const pulls = global && global.NyxPulls;
    if (!pulls || typeof pulls.importFile !== 'function') return null;
    return (value) => {
      const parsed = pulls.importFile('ae', value);
      if (!parsed || parsed.error || parsed.importKind !== 'pengo-pulls-v1') {
        throw error('The launcher export failed schema validation.', 'INVALID_SCHEMA');
      }
      return parsed;
    };
  }

  async function fetchExport(request, options={}){
    endpointParts(request);
    const fetchImpl = options.fetch || (global && global.fetch);
    if (typeof fetchImpl !== 'function') throw error('This browser cannot receive launcher exports.', 'UNAVAILABLE');
    const Controller = dependency('AbortController', options);
    const setTimer = dependency('setTimeout', options);
    const clearTimer = dependency('clearTimeout', options);
    if (typeof Controller !== 'function' || typeof setTimer !== 'function') {
      throw error('This browser cannot receive launcher exports.', 'UNAVAILABLE');
    }
    const controller = new Controller();
    const timeout = setTimer(() => controller.abort(), HANDOFF_TIMEOUT_MS);
    try {
      const response = await fetchImpl(request.endpoint, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response || response.redirected || !response.ok) {
        throw error('The launcher export could not be received. It may have expired.', 'RECEIVE_FAILED');
      }
      const contentType = String(header(response, 'content-type') || '');
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType)) {
        throw error('The launcher returned an unexpected response.', 'INVALID_CONTENT_TYPE');
      }
      const text = await readBody(response, options);
      let value;
      try { value = JSON.parse(text); } catch (e) {
        throw error('The launcher returned invalid JSON.', 'INVALID_JSON');
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw error('The launcher returned an invalid JSON object.', 'INVALID_JSON');
      }
      const parser = strictParser(request);
      let payload = value;
      let schemaValidated = false;
      if (parser) {
        try { payload = await parser(value); } catch (e) {
          throw error('The launcher export failed schema validation.', 'INVALID_SCHEMA');
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.error) {
          throw error('The launcher export failed schema validation.', 'INVALID_SCHEMA');
        }
        schemaValidated = true;
      }
      return Object.freeze({ text, payload, schemaValidated });
    } catch (caught) {
      if (caught?.name === 'AbortError' || controller.signal?.aborted) {
        throw error('The launcher handoff timed out. Use the saved JSON file instead.', 'TIMEOUT');
      }
      throw caught;
    } finally {
      if (typeof clearTimer === 'function') clearTimer(timeout);
    }
  }

  function rejectedPromise(caught){
    const promise = Promise.reject(caught);
    promise.catch(() => {});
    return promise;
  }

  function takePending(){
    const result = pendingPromise;
    pendingPromise = null;
    return result;
  }

  global.PengoPullLauncherBridge = Object.freeze({
    MAX_PAYLOAD_BYTES,
    HANDOFF_TIMEOUT_MS,
    consume: parseFragment,
    fetchExport,
    hasPending: () => pendingPromise !== null,
    takePending,
  });

  try {
    const request = parseFragment(global.location, global.history);
    if (request) {
      pendingPromise = fetchExport(request);
      pendingPromise.catch(() => {});
    }
  } catch (caught) {
    pendingPromise = rejectedPromise(caught);
  }
})(window);
