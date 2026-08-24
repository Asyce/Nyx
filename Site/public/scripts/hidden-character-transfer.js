(function () {
  'use strict';

  const HASH_PREFIX = '#pengo-hidden-transfer=';
  const STORAGE_KEY = 'nyx:cm-hidden:v1';
  const RESULT_KEY = 'nyx:hidden-transfer-result:v1';
  const LEGACY_GAMES = ['gi', 'hsr', 'zzz', 'ww', 'endfield'];
  const GAME_KEYS = { gi: 'gi', hsr: 'hsr', zzz: 'zzz', ww: 'wuwa', endfield: 'ae' };
  const DATA_FILES = {
    hsr: '/dist/cm-data-hsr.js',
    zzz: '/dist/cm-data-zzz.js',
    wuwa: '/dist/cm-data-wuwa.js',
    ae: '/dist/cm-data-ae.js',
  };
  let messagePanel = null;
  let messageStylesAdded = false;

  function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function hasExactKeys(value, keys) {
    if (!isRecord(value)) return false;
    const ownKeys = Object.keys(value);
    return ownKeys.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
  }

  function parsePayload(hash) {
    const payload = JSON.parse(decodeURIComponent(hash.slice(HASH_PREFIX.length)));
    if (!hasExactKeys(payload, ['v', 'hidden', 'tracker']) || payload.v !== 1) throw new Error('Invalid transfer');
    for (const scopeName of ['hidden', 'tracker']) {
      const scope = payload[scopeName];
      if (!hasExactKeys(scope, LEGACY_GAMES)) throw new Error('Invalid transfer');
      for (const game of LEGACY_GAMES) {
        const names = scope[game];
        if (!Array.isArray(names) || names.length > 512) throw new Error('Invalid transfer');
        for (const name of names) {
          if (typeof name !== 'string' || !name || name.length > 160 || name.trim() !== name) {
            throw new Error('Invalid transfer');
          }
        }
      }
    }
    return payload;
  }

  function stripTransferHash() {
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (_) {}
  }

  function removeStoredResult() {
    try { window.sessionStorage.removeItem(RESULT_KEY); } catch (_) {}
  }

  function showMessage(title, text, kind) {
    const root = document.body || document.documentElement;
    if (!root) return;
    if (messagePanel) messagePanel.remove();
    if (!messageStylesAdded) {
      const style = document.createElement('style');
      style.textContent = '#nyx-hidden-transfer-message button:focus-visible{outline:3px solid #fff;outline-offset:3px}';
      (document.head || root).appendChild(style);
      messageStylesAdded = true;
    }

    const panel = document.createElement('div');
    panel.id = 'nyx-hidden-transfer-message';
    panel.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    panel.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    panel.style.cssText = kind === 'success'
      ? 'position:fixed;z-index:2147483647;top:20px;right:20px;max-width:min(440px,calc(100vw - 40px));padding:18px 20px;border:1px solid rgba(167,139,250,.7);border-radius:14px;background:#17102f;color:#f1ecff;box-shadow:0 16px 48px rgba(0,0,0,.5);font:600 16px/1.45 system-ui,sans-serif'
      : 'position:fixed;z-index:2147483647;inset:0;display:grid;place-items:center;padding:24px;background:rgba(6,5,26,.88);color:#f1ecff;font:600 17px/1.45 system-ui,sans-serif';

    const card = document.createElement('div');
    if (kind !== 'success') card.style.cssText = 'width:min(520px,100%);padding:30px;border:1px solid rgba(167,139,250,.5);border-radius:18px;background:#17102f;text-align:center;box-shadow:0 18px 60px rgba(0,0,0,.55)';
    const heading = document.createElement('strong');
    heading.style.cssText = 'display:block;margin-bottom:8px;font-size:22px';
    heading.textContent = title;
    const copy = document.createElement('div');
    copy.textContent = text;
    card.appendChild(heading);
    card.appendChild(copy);

    if (kind !== 'loading') {
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = 'Close';
      close.style.cssText = 'margin-top:14px;padding:8px 14px;border:1px solid #c4a8ff;border-radius:8px;background:#7658d7;color:#fff;cursor:pointer;font:700 15px system-ui,sans-serif';
      close.addEventListener('click', () => panel.remove());
      card.appendChild(close);
      if (kind === 'error') setTimeout(() => close.focus(), 0);
    }

    panel.appendChild(card);
    root.appendChild(panel);
    messagePanel = panel;
    if (kind === 'success') setTimeout(() => panel.remove(), 10000);
  }

  function showStoredResult() {
    let raw = null;
    try {
      raw = window.sessionStorage.getItem(RESULT_KEY);
      window.sessionStorage.removeItem(RESULT_KEY);
    } catch (_) {
      return;
    }
    if (!raw) return;
    try {
      const result = JSON.parse(raw);
      if (!hasExactKeys(result, ['count', 'unmatched'])
        || !Number.isInteger(result.count) || result.count < 1
        || !Number.isInteger(result.unmatched) || result.unmatched < 0) return;
      const unmatched = result.unmatched
        ? ` ${result.unmatched} ${result.unmatched === 1 ? 'choice could' : 'choices could'} not be matched.`
        : '';
      showMessage('Hidden characters copied', `${result.count} hidden ${result.count === 1 ? 'choice is' : 'choices are'} now in Pengo.${unmatched}`, 'success');
    } catch (_) {}
  }

  function loadGame(gameKey) {
    if (window.CM_CFG && window.CM_CFG[gameKey]) return Promise.resolve(window.CM_CFG[gameKey]);
    const src = DATA_FILES[gameKey];
    if (!src) return Promise.reject(new Error('Character data unavailable'));
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.pengoHiddenTransfer = gameKey;
      script.onload = () => {
        const cfg = window.CM_CFG && window.CM_CFG[gameKey];
        if (cfg) resolve(cfg);
        else reject(new Error('Character data unavailable'));
      };
      script.onerror = () => reject(new Error('Character data unavailable'));
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function normalizeName(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLocaleLowerCase('en-US')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function collectNames(value, output) {
    if (typeof value === 'string') output.push(value);
    else if (Array.isArray(value)) value.forEach((entry) => collectNames(entry, output));
    else if (isRecord(value)) Object.values(value).forEach((entry) => collectNames(entry, output));
  }

  function namesFor(record) {
    const names = [];
    if (!isRecord(record)) return names;
    for (const field of ['n', 'rawName', 'name', 'baseName', 'aliases', 'localizedNames', 'fullName']) {
      collectNames(record[field], names);
    }
    collectNames(record.profile && record.profile.fullName, names);
    return names;
  }

  function buildNameIndex(cfg, gameKey) {
    const roster = cfg && (Array.isArray(cfg.roster) ? cfg.roster : Array.isArray(cfg.chars) ? cfg.chars : null);
    if (!roster) throw new Error('Character data unavailable');
    const index = new Map();
    const add = (name, target) => {
      const normalized = normalizeName(name);
      if (!normalized || !target) return;
      const targets = index.get(normalized) || [];
      if (!targets.includes(target)) targets.push(target);
      index.set(normalized, targets);
    };

    for (const record of roster) {
      if (!isRecord(record)) continue;
      const target = String(record.id || record.rawName || record.n || record.name || '');
      if (!target) continue;
      const topNames = namesFor(record);
      topNames.forEach((name) => add(name, target));
      const forms = Array.isArray(record.forms) ? record.forms : [];
      for (const form of forms) {
        const formNames = namesFor(form);
        formNames.forEach((name) => add(name, target));
        const bases = topNames.concat(formNames);
        const elements = [];
        for (const field of ['el', 'element', 'elementName', 'variantValue', 'formLabel']) {
          collectNames(form && form[field], elements);
        }
        for (const base of bases) for (const element of elements) add(`${base} ${element}`, target);
        const gender = normalizeName(form && form.gender);
        if (gender === 'male' || gender === 'female') {
          const shortGender = gender === 'male' ? 'M' : 'F';
          for (const base of bases) {
            add(`${base} ${gender}`, target);
            add(`${base} ${shortGender}`, target);
          }
        }
      }
    }

    if (gameKey === 'gi') {
      for (const target of index.get(normalizeName('Traveler')) || []) add('Manekina', target);
    }
    return index;
  }

  function mapPayload(payload) {
    const mapped = { hidden: {}, tracker: {} };
    let count = 0;
    let unmatched = 0;
    for (const legacyGame of LEGACY_GAMES) {
      const gameKey = GAME_KEYS[legacyGame];
      if (!payload.hidden[legacyGame].length && !payload.tracker[legacyGame].length) {
        mapped.hidden[gameKey] = [];
        mapped.tracker[gameKey] = [];
        continue;
      }
      const index = buildNameIndex(window.CM_CFG && window.CM_CFG[gameKey], gameKey);
      for (const scopeName of ['hidden', 'tracker']) {
        const targets = [];
        for (const name of payload[scopeName][legacyGame]) {
          const matches = index.get(normalizeName(name)) || [];
          if (matches.length) {
            count += 1;
            for (const target of matches) if (!targets.includes(target)) targets.push(target);
          } else {
            unmatched += 1;
          }
        }
        mapped[scopeName][gameKey] = targets;
      }
    }
    return { mapped, count, unmatched };
  }

  function readExistingState() {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error('Hidden-character settings are damaged');
    return parsed;
  }

  function mergeState(existing, mapped) {
    const next = { sync: false, all: {}, roster: {}, materials: {}, ...existing };
    for (const bucketName of ['all', 'roster', 'materials']) {
      const bucket = next[bucketName];
      if (bucket !== undefined && bucket !== null && !isRecord(bucket)) {
        throw new Error('Hidden-character settings are damaged');
      }
      next[bucketName] = { ...(bucket || {}) };
    }

    const mergeBucket = (bucketName, gameKey, additions) => {
      if (!additions.length) return;
      const current = next[bucketName][gameKey];
      if (current !== undefined && !Array.isArray(current)) throw new Error('Hidden-character settings are damaged');
      const values = current ? current.slice() : [];
      for (const value of additions) if (!values.includes(value)) values.push(value);
      next[bucketName][gameKey] = values;
    };

    for (const gameKey of Object.values(GAME_KEYS)) {
      if (next.sync === true) {
        mergeBucket('all', gameKey, [...mapped.hidden[gameKey], ...mapped.tracker[gameKey]]);
      } else {
        mergeBucket('roster', gameKey, mapped.hidden[gameKey]);
        mergeBucket('materials', gameKey, mapped.tracker[gameKey]);
      }
    }
    return next;
  }

  const hash = window.location.hash || '';
  if (!hash.startsWith(HASH_PREFIX)) {
    showStoredResult();
    return;
  }

  let payload;
  try {
    payload = parsePayload(hash);
  } catch (_) {
    stripTransferHash();
    showMessage('Copy failed', 'This transfer link is invalid or damaged. Nothing changed.', 'error');
    return;
  }

  removeStoredResult();
  showMessage('Copying hidden characters', 'Pengo is matching your characters. Nothing has been changed yet.', 'loading');
  let stateSaved = false;
  (async () => {
    const neededGames = LEGACY_GAMES
      .filter((game) => payload.hidden[game].length || payload.tracker[game].length)
      .map((game) => GAME_KEYS[game]);
    await Promise.all([...new Set(neededGames)].map(loadGame));
    const result = mapPayload(payload);
    if (result.count === 0) throw new Error('Pengo could not match any hidden characters. Nothing changed.');
    const next = mergeState(readExistingState(), result.mapped);
    window.sessionStorage.setItem(RESULT_KEY, JSON.stringify({ count: result.count, unmatched: result.unmatched }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    stateSaved = true;
    window.location.replace('/genshin/materials');
  })().catch((error) => {
    if (!stateSaved) removeStoredResult();
    stripTransferHash();
    showMessage(
      stateSaved ? 'Characters copied' : 'Copy failed',
      stateSaved
        ? 'Your choices were saved, but the page could not reload automatically. Open Materials again to see them.'
        : (error && error.message) || 'Pengo could not copy your hidden characters. Nothing changed.',
      'error',
    );
  });
})();
