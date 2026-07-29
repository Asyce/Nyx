// Browser-local achievement data primitives. This module deliberately knows
// nothing about pull history, sync, achievement names, or the network.
window.NyxAchievementCore = (function () {
  'use strict';

  const PROFILE_VERSION = 1;
  const GAMES = ['gi', 'hsr', 'zzz', 'wuwa', 'ae'];

  function normalizeGame(value) {
    const game = String(value == null ? '' : value).trim().toLowerCase();
    const registryGame = window.NyxAchievementGames && window.NyxAchievementGames.get(game);
    if (registryGame) return registryGame.key;
    if (game === 'gi' || game === 'genshin' || game === 'genshin-impact') return 'gi';
    if (game === 'hsr' || game === 'star-rail' || game === 'honkai-star-rail') return 'hsr';
    if (game === 'zzz' || game === 'zenless' || game === 'zenless-zone-zero') return 'zzz';
    if (game === 'wuwa' || game === 'ww' || game === 'wuthering-waves') return 'wuwa';
    if (game === 'ae' || game === 'endfield' || game === 'arknights-endfield') return 'ae';
    throw new Error('Unsupported achievement game.');
  }

  // Achievement identity is always a canonical decimal string. We never use
  // translated names because wording can change and names are not guaranteed
  // to be unique.
  function normalizeId(value) {
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 0) return null;
      return String(value);
    }
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    return trimmed.replace(/^0+(?=\d)/, '');
  }

  function inspectIds(values) {
    const rows = Array.isArray(values) ? values : [];
    const ids = [];
    const seen = new Set();
    let duplicateCount = 0;
    let invalidCount = Array.isArray(values) ? 0 : 1;
    for (const value of rows) {
      const id = normalizeId(value);
      if (id === null) {
        invalidCount += 1;
      } else if (seen.has(id)) {
        duplicateCount += 1;
      } else {
        seen.add(id);
        ids.push(id);
      }
    }
    return { ids, duplicateCount, invalidCount, inputCount: rows.length };
  }

  function normalizeIds(values) {
    return inspectIds(values).ids;
  }

  function cleanText(value, maxLength) {
    return String(value == null ? '' : value).trim().slice(0, maxLength);
  }

  function normalizeAccountBinding(value) {
    if (value == null || value === '') return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Achievement account binding is invalid.');
    }
    const scheme = cleanText(value.scheme, 48);
    const fingerprint = cleanText(value.value, 256);
    const region = cleanText(value.region, 48);
    if (scheme !== 'pengo-install-hmac-v1' || !/^[A-Za-z0-9_-]{16,256}$/.test(fingerprint)) {
      throw new Error('Achievement account binding is invalid.');
    }
    return { scheme, value: fingerprint, region };
  }

  function sameAccountBinding(left, right) {
    const a = normalizeAccountBinding(left);
    const b = normalizeAccountBinding(right);
    if (!a || !b) return a === b;
    return a.scheme === b.scheme && a.value === b.value && a.region === b.region;
  }

  function makeUuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Used only as a compatibility fallback for older browsers. The time and
    // random portions make collisions between local profiles very unlikely.
    return 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function createProfile(input, options) {
    const data = input || {};
    const opts = options || {};
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    const id = cleanText(opts.id || data.id || makeUuid(), 96);
    if (!id) throw new Error('Achievement profile ID is required.');
    return {
      version: PROFILE_VERSION,
      id,
      game: normalizeGame(data.game),
      label: cleanText(data.label, 80),
      uid: cleanText(data.uid, 64),
      accountBinding: normalizeAccountBinding(data.accountBinding),
      completedIds: normalizeIds(data.completedIds),
      unknownIds: normalizeIds(data.unknownIds),
      createdAt: Number.isFinite(data.createdAt) ? data.createdAt : now,
      updatedAt: Number.isFinite(data.updatedAt) ? data.updatedAt : now,
    };
  }

  function normalizeProfile(value, options) {
    if (!value || typeof value !== 'object') throw new Error('Achievement profile is invalid.');
    const profile = createProfile(value, { id: value.id, now: options && options.now });
    // An ID cannot be both a visible completion and an unresolved import.
    const completed = new Set(profile.completedIds);
    profile.unknownIds = profile.unknownIds.filter((id) => !completed.has(id));
    return profile;
  }

  return {
    PROFILE_VERSION,
    GAMES,
    normalizeGame,
    normalizeId,
    normalizeIds,
    inspectIds,
    normalizeAccountBinding,
    sameAccountBinding,
    createProfile,
    normalizeProfile,
  };
})();
