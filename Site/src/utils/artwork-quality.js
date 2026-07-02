// Nyx artwork quality preference. Original assets stay the default; Faster uses
// generated WebP variants only when the deploy manifest confirms they exist.
(function () {
  'use strict';

  const SETTINGS_KEY = 'nyx-pengo-settings';
  const ACCOUNT_PREFS_KEY = 'nyx:account-preferences:v1';
  const ARTWORK_KINDS = new Set(['character', 'item', 'banner', 'splash']);
  const apiBase = () => (typeof window !== 'undefined' && window.NYX_API_BASE) || '';

  function normalizeQuality(value) {
    return value === 'faster' ? 'faster' : 'original';
  }

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }

  function loadQuality() {
    return normalizeQuality(loadSettings().artworkQuality);
  }

  function applyQuality(value) {
    const quality = normalizeQuality(value);
    window.NYX_ARTWORK_QUALITY = quality;
    const root = document.documentElement;
    if (root) {
      root.dataset.nyxArtworkQuality = quality;
      root.classList.toggle('nyx-artwork-faster', quality === 'faster');
      root.classList.toggle('nyx-artwork-original', quality !== 'faster');
    }
    return quality;
  }

  function updateLocalQuality(value) {
    const settings = loadSettings();
    settings.artworkQuality = normalizeQuality(value);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
    return applyQuality(settings.artworkQuality);
  }

  function manifestHas(pathname) {
    const manifest = window.NYX_WEBP_MANIFEST || {};
    return !!manifest[pathname];
  }

  function webpCandidate(src) {
    const value = String(src || '');
    return value.replace(/\.(?:png|jpe?g)([?#].*)?$/i, '.webp$1');
  }

  function pathFor(src) {
    try { return new URL(src, window.location.href).pathname; } catch (e) { return ''; }
  }

  function shouldSwap(src, kind) {
    if (!src || !ARTWORK_KINDS.has(kind)) return false;
    if (normalizeQuality(window.NYX_ARTWORK_QUALITY || loadQuality()) !== 'faster') return false;
    if (!/\.(?:png|jpe?g)(?:[?#].*)?$/i.test(String(src))) return false;
    const candidate = webpCandidate(src);
    return candidate !== src && manifestHas(pathFor(candidate));
  }

  function url(src, kind) {
    if (!src) return src;
    return shouldSwap(src, kind) ? webpCandidate(src) : src;
  }

  function cssUrl(value) {
    return 'url("' + encodeURI(String(value || '')).replace(/#/g, '%23').replace(/"/g, '%22') + '")';
  }

  function bgImage(src, kind) {
    if (!src) return undefined;
    const chosen = url(src, kind);
    return chosen === src ? cssUrl(src) : cssUrl(chosen) + ', ' + cssUrl(src);
  }

  function restoreImage(img, original) {
    if (!img || !original) return;
    if (img.getAttribute('src') !== original) img.setAttribute('src', original);
  }

  function imgProps(src, kind, extra) {
    const original = String(src || '');
    const chosen = url(original, kind);
    const next = Object.assign({}, extra || {}, { src: chosen });
    if (chosen !== original) {
      const userOnError = next.onError;
      next.onError = (event) => {
        restoreImage(event.currentTarget || event.target, original);
        if (typeof userOnError === 'function') userOnError(event);
      };
    }
    return next;
  }

  async function requestPreference(action, body) {
    const res = await fetch(apiBase() + '/api/account/preferences/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.ok === false) {
      const msg = json && json.error && json.error.message ? json.error.message : ('Preference sync failed (' + res.status + ').');
      throw new Error(msg);
    }
    return json;
  }

  async function credentials(secret) {
    if (!window.NyxAccountSync || typeof window.NyxAccountSync.credentials !== 'function') {
      throw new Error('Pengo account sync is not available yet.');
    }
    return window.NyxAccountSync.credentials(secret);
  }

  function saveAccountMeta(next) {
    try {
      const cur = JSON.parse(localStorage.getItem(ACCOUNT_PREFS_KEY) || '{}') || {};
      localStorage.setItem(ACCOUNT_PREFS_KEY, JSON.stringify(Object.assign({}, cur, next)));
    } catch (e) {}
  }

  async function pushPreferences(secret, preferences) {
    const auth = await credentials(secret);
    const result = await requestPreference('push', {
      accountId: auth.accountId,
      token: auth.token,
      preferences: {
        artworkQuality: normalizeQuality(preferences && preferences.artworkQuality),
      },
    });
    saveAccountMeta({ accountId: auth.accountId, updatedAt: result.updatedAt || Date.now() });
    return result;
  }

  async function pullPreferences(secret) {
    const auth = await credentials(secret);
    const result = await requestPreference('pull', { accountId: auth.accountId, token: auth.token });
    saveAccountMeta({ accountId: auth.accountId, updatedAt: result.updatedAt || Date.now() });
    return result;
  }

  window.NyxArtwork = {
    normalizeQuality,
    loadQuality,
    applyQuality,
    updateLocalQuality,
    url,
    bgImage,
    imgProps,
    restoreImage,
    pushPreferences,
    pullPreferences,
  };

  applyQuality(loadQuality());
  window.addEventListener('storage', (event) => {
    if (event.key === SETTINGS_KEY) applyQuality(loadQuality());
  });
})();
