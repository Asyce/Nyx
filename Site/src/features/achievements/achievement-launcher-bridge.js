(function initNyxAchievementLauncherBridge(global){
  'use strict';

  const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
  const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
  const SUPPORTED_VERSION = 'v1';

  function clearFragment(location, history){
    if (!location || !history || typeof history.replaceState !== 'function') return;
    const clean = `${location.pathname || '/'}${location.search || ''}`;
    history.replaceState(history.state ?? null, '', clean);
  }

  function consume(location=global.location, history=global.history){
    const raw = String(location?.hash || '');
    if (!raw.startsWith('#nyx-import=')) return null;
    clearFragment(location, history);

    const entries = Array.from(new URLSearchParams(raw.slice(1)).entries());
    if (entries.length !== 3) throw new Error('The launcher handoff link is invalid or has expired.');
    const values = Object.create(null);
    for (const [name, value] of entries) {
      if (!['nyx-import', 'port', 'nonce'].includes(name) || Object.hasOwn(values, name)) {
        throw new Error('The launcher handoff link is invalid or has expired.');
      }
      values[name] = value;
    }
    if (values['nyx-import'] !== SUPPORTED_VERSION
      || !/^[1-9][0-9]{3,4}$/.test(values.port || '')
      || Number(values.port) > 65535
      || !NONCE_PATTERN.test(values.nonce || '')) {
      throw new Error('The launcher handoff link is invalid or has expired.');
    }
    const endpoint = `http://127.0.0.1:${values.port}/v1/achievement-import/${values.nonce}`;
    return Object.freeze({ version:SUPPORTED_VERSION, endpoint });
  }

  async function readBoundedBody(response){
    const declared = response.headers?.get?.('content-length');
    if (declared != null && (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_ARTIFACT_BYTES)) {
      throw new Error('The launcher export is too large.');
    }
    if (!response.body?.getReader) {
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > MAX_ARTIFACT_BYTES) {
        throw new Error('The launcher export is too large.');
      }
      return text;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) throw new Error('The launcher returned an invalid response.');
        total += value.byteLength;
        if (total > MAX_ARTIFACT_BYTES) throw new Error('The launcher export is too large.');
        chunks.push(value);
      }
    } finally {
      reader.releaseLock?.();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder('utf-8', { fatal:true }).decode(bytes);
  }

  async function fetchExport(request, options={}){
    if (!request || request.version !== SUPPORTED_VERSION
      || typeof request.endpoint !== 'string'
      || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}\/v1\/achievement-import\/[A-Za-z0-9_-]{43}$/.test(request.endpoint)) {
      throw new Error('The launcher handoff request is invalid.');
    }
    const fetchImpl = options.fetch || global.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('This browser cannot receive launcher exports.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15_000);
    try {
      const response = await fetchImpl(request.endpoint, {
        method:'GET',
        mode:'cors',
        credentials:'omit',
        cache:'no-store',
        redirect:'error',
        referrerPolicy:'no-referrer',
        signal:controller.signal,
      });
      if (!response?.ok) throw new Error('The launcher export could not be received. It may have expired.');
      const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
      if (!contentType.startsWith('application/json')) {
        throw new Error('The launcher returned an unexpected response.');
      }
      return await readBoundedBody(response);
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('The launcher handoff timed out. Use the saved JSON file instead.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  global.NyxAchievementLauncherBridge = Object.freeze({
    MAX_ARTIFACT_BYTES,
    consume,
    fetchExport,
  });
})(window);
