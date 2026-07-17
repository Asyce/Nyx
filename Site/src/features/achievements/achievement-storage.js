// Local-only achievement profiles. This uses its own localStorage namespace;
// it never reads or writes Nyx pull-history or sync storage.
window.NyxAchievementStore = (function () {
  'use strict';

  const Core = window.NyxAchievementCore;
  if (!Core) throw new Error('NyxAchievementCore must load before achievement-storage.js.');

  const STORAGE_PREFIX = 'nyx:achievements:v1:';
  const INDEX_KEY = STORAGE_PREFIX + 'profiles';
  const BACKUP_KIND = 'nyx-achievements-backup';
  const BACKUP_VERSION = 1;

  function defaultStorage() {
    if (typeof localStorage === 'undefined') throw new Error('Local storage is unavailable.');
    return localStorage;
  }

  function profileKey(game, id) {
    return STORAGE_PREFIX + 'profile:' + Core.normalizeGame(game) + ':' + encodeURIComponent(String(id));
  }

  function makeStore(storage) {
    const area = storage || defaultStorage();

    function readJson(key, fallback) {
      const raw = area.getItem(key);
      if (raw === null) return fallback;
      try { return JSON.parse(raw); } catch (error) { return fallback; }
    }

    function readIndex() {
      const value = readJson(INDEX_KEY, []);
      if (!Array.isArray(value)) return [];
      const out = [];
      const seen = new Set();
      for (const row of value) {
        if (!row || typeof row !== 'object') continue;
        let game;
        try { game = Core.normalizeGame(row.game); } catch (error) { continue; }
        const id = String(row.id == null ? '' : row.id).trim();
        const key = game + ':' + id;
        if (!id || seen.has(key)) continue;
        seen.add(key);
        out.push({ game, id });
      }
      return out;
    }

    function writeIndex(rows) {
      area.setItem(INDEX_KEY, JSON.stringify(rows));
    }

    function addToIndex(profile) {
      const index = readIndex();
      if (!index.some((row) => row.game === profile.game && row.id === profile.id)) {
        index.push({ game: profile.game, id: profile.id });
        writeIndex(index);
      }
    }

    function saveProfile(value, options) {
      const now = options && Number.isFinite(options.now) ? options.now : Date.now();
      const profile = Core.normalizeProfile(Object.assign({}, value, { updatedAt: now }), { now });
      const key = profileKey(profile.game, profile.id);
      const previousProfile = area.getItem(key);
      const previousIndex = area.getItem(INDEX_KEY);
      try {
        area.setItem(key, JSON.stringify(profile));
        addToIndex(profile);
      } catch (error) {
        try { if (previousProfile === null) area.removeItem(key); else area.setItem(key, previousProfile); } catch (rollbackError) {}
        try { if (previousIndex === null) area.removeItem(INDEX_KEY); else area.setItem(INDEX_KEY, previousIndex); } catch (rollbackError) {}
        throw error;
      }
      return profile;
    }

    function createProfile(input, options) {
      const profile = Core.createProfile(input, options);
      if (area.getItem(profileKey(profile.game, profile.id)) !== null) {
        throw new Error('An achievement profile with this ID already exists.');
      }
      return saveProfile(profile, { now: profile.updatedAt });
    }

    function loadProfile(game, id) {
      let normalizedGame;
      try { normalizedGame = Core.normalizeGame(game); } catch (error) { return null; }
      const raw = area.getItem(profileKey(normalizedGame, id));
      if (raw === null) return null;
      try {
        const profile = Core.normalizeProfile(JSON.parse(raw));
        if (profile.game !== normalizedGame || profile.id !== String(id)) return null;
        return profile;
      } catch (error) {
        return null;
      }
    }

    function requireProfile(game, id) {
      const profile = loadProfile(game, id);
      if (!profile) throw new Error('Achievement profile was not found.');
      return profile;
    }

    function listProfiles(game) {
      let filter = null;
      if (game != null && game !== '') filter = Core.normalizeGame(game);
      const profiles = [];
      for (const row of readIndex()) {
        if (filter && row.game !== filter) continue;
        const profile = loadProfile(row.game, row.id);
        if (profile) profiles.push(profile);
      }
      profiles.sort((a, b) => b.updatedAt - a.updatedAt || a.label.localeCompare(b.label));
      return profiles;
    }

    function updateProfile(game, id, patch, options) {
      const current = requireProfile(game, id);
      const allowed = patch || {};
      return saveProfile(Object.assign({}, current, {
        label: Object.prototype.hasOwnProperty.call(allowed, 'label') ? allowed.label : current.label,
        uid: Object.prototype.hasOwnProperty.call(allowed, 'uid') ? allowed.uid : current.uid,
      }), options);
    }

    function setCompleted(game, profileId, achievementId, completed, options) {
      const id = Core.normalizeId(achievementId);
      if (id === null) throw new Error('Achievement ID is invalid.');
      const profile = requireProfile(game, profileId);
      const completedSet = new Set(profile.completedIds);
      if (completed === false) completedSet.delete(id);
      else completedSet.add(id);
      return saveProfile(Object.assign({}, profile, {
        completedIds: Array.from(completedSet),
        // A manual check confirms that this ID is now understood by the UI.
        unknownIds: completed === false ? profile.unknownIds : profile.unknownIds.filter((value) => value !== id),
      }), options);
    }

    function setCompletedMany(game, profileId, achievementIds, completed, options) {
      const ids = Core.normalizeIds(achievementIds);
      const profile = requireProfile(game, profileId);
      const completedSet = new Set(profile.completedIds);
      const unknownSet = new Set(profile.unknownIds);
      let changed = 0;
      for (const id of ids) {
        const had = completedSet.has(id);
        if (completed === false) completedSet.delete(id);
        else {
          completedSet.add(id);
          unknownSet.delete(id);
        }
        if (had !== (completed !== false)) changed += 1;
      }
      const saved = saveProfile(Object.assign({}, profile, {
        completedIds: Array.from(completedSet),
        unknownIds: Array.from(unknownSet),
      }), options);
      return { profile: saved, changed };
    }

    function mergeProgress(game, profileId, completedIds, unknownIds, options) {
      const profile = requireProfile(game, profileId);
      const complete = new Set(profile.completedIds);
      const unknown = new Set(profile.unknownIds);
      let added = 0;
      let unknownAdded = 0;

      for (const id of Core.normalizeIds(completedIds)) {
        if (!complete.has(id)) { complete.add(id); added += 1; }
        unknown.delete(id);
      }
      for (const id of Core.normalizeIds(unknownIds)) {
        if (complete.has(id)) continue;
        if (!unknown.has(id)) { unknown.add(id); unknownAdded += 1; }
      }

      const saved = saveProfile(Object.assign({}, profile, {
        completedIds: Array.from(complete),
        unknownIds: Array.from(unknown),
      }), options);
      return { profile: saved, added, unknownAdded };
    }

    // Replace is deliberately separate from merge because it may remove
    // checkmarks. Callers must put their own explicit confirmation in front of
    // this operation.
    function replaceProgress(game, profileId, completedIds, unknownIds, options) {
      const profile = requireProfile(game, profileId);
      const complete = Core.normalizeIds(completedIds);
      const completeSet = new Set(complete);
      const unknown = Core.normalizeIds(unknownIds).filter((id) => !completeSet.has(id));
      const previousComplete = new Set(profile.completedIds);
      const previousUnknown = new Set(profile.unknownIds);
      const saved = saveProfile(Object.assign({}, profile, {
        completedIds: complete,
        unknownIds: unknown,
      }), options);
      return {
        profile: saved,
        added: complete.filter((id) => !previousComplete.has(id)).length,
        removed: profile.completedIds.filter((id) => !completeSet.has(id)).length,
        unknownAdded: unknown.filter((id) => !previousUnknown.has(id)).length,
        unknownRemoved: profile.unknownIds.filter((id) => !unknown.includes(id)).length,
      };
    }

    function resetProgress(game, profileId, options) {
      const profile = requireProfile(game, profileId);
      const removed = profile.completedIds.length;
      const unknownRemoved = profile.unknownIds.length;
      const saved = saveProfile(Object.assign({}, profile, {
        completedIds: [],
        unknownIds: [],
      }), options);
      return { profile: saved, removed, unknownRemoved };
    }

    // When a later catalog learns about a previously unknown imported ID, make
    // it a visible completion without requiring the player to import again.
    function reconcileCatalog(game, profileId, catalogIds, options) {
      const profile = requireProfile(game, profileId);
      const catalog = new Set(Core.normalizeIds(catalogIds));
      const resolved = profile.unknownIds.filter((id) => catalog.has(id));
      if (!resolved.length) return { profile, resolved: 0 };
      const complete = new Set(profile.completedIds);
      for (const id of resolved) complete.add(id);
      const saved = saveProfile(Object.assign({}, profile, {
        completedIds: Array.from(complete),
        unknownIds: profile.unknownIds.filter((id) => !catalog.has(id)),
      }), options);
      return { profile: saved, resolved: resolved.length };
    }

    function deleteProfile(game, id) {
      const normalizedGame = Core.normalizeGame(game);
      const key = profileKey(normalizedGame, id);
      const previousProfile = area.getItem(key);
      const previousIndex = area.getItem(INDEX_KEY);
      try {
        area.removeItem(key);
        writeIndex(readIndex().filter((row) => row.game !== normalizedGame || row.id !== String(id)));
      } catch (error) {
        try { if (previousProfile !== null) area.setItem(key, previousProfile); } catch (rollbackError) {}
        try { if (previousIndex === null) area.removeItem(INDEX_KEY); else area.setItem(INDEX_KEY, previousIndex); } catch (rollbackError) {}
        throw error;
      }
    }

    function exportBackup(options) {
      const now = options && Number.isFinite(options.now) ? options.now : Date.now();
      let profiles;
      if (options && options.profileId != null) {
        const profile = requireProfile(options.game, options.profileId);
        profiles = [profile];
      } else {
        profiles = listProfiles(options && options.game);
      }
      return {
        kind: BACKUP_KIND,
        version: BACKUP_VERSION,
        exportedAt: now,
        profiles,
      };
    }

    // Restore is additive. Existing checkmarks and unknown IDs are never
    // removed by a backup, which makes restoring safe over newer local data.
    function restoreBackup(bundle, options) {
      if (!bundle || bundle.kind !== BACKUP_KIND || bundle.version !== BACKUP_VERSION || !Array.isArray(bundle.profiles)) {
        throw new Error('This is not a supported Nyx achievement backup.');
      }
      // Validate every row before the first write. Keep the original values so
      // a storage failure in a later row cannot leave a partial restore.
      const incomingProfiles = bundle.profiles.map((value) => Core.normalizeProfile(value, options));
      const previousIndex = area.getItem(INDEX_KEY);
      const previousProfiles = new Map();
      for (const incoming of incomingProfiles) {
        const key = profileKey(incoming.game, incoming.id);
        if (!previousProfiles.has(key)) previousProfiles.set(key, area.getItem(key));
      }
      let created = 0;
      let merged = 0;
      try {
        for (const incoming of incomingProfiles) {
          const current = loadProfile(incoming.game, incoming.id);
          if (!current) {
            saveProfile(incoming, { now: incoming.updatedAt });
            created += 1;
            continue;
          }
          const result = mergeProgress(
            incoming.game,
            incoming.id,
            incoming.completedIds,
            incoming.unknownIds,
            { now: Math.max(current.updatedAt, incoming.updatedAt) },
          );
          updateProfile(incoming.game, incoming.id, {
            label: current.label || incoming.label,
            uid: current.uid || incoming.uid,
          }, { now: result.profile.updatedAt });
          merged += 1;
        }
      } catch (error) {
        for (const [key, previous] of previousProfiles) {
          try { if (previous === null) area.removeItem(key); else area.setItem(key, previous); } catch (rollbackError) {}
        }
        try { if (previousIndex === null) area.removeItem(INDEX_KEY); else area.setItem(INDEX_KEY, previousIndex); } catch (rollbackError) {}
        throw error;
      }
      return { created, merged, profiles: listProfiles() };
    }

    return {
      createProfile,
      saveProfile,
      loadProfile,
      listProfiles,
      updateProfile,
      setCompleted,
      setCompletedMany,
      mergeProgress,
      replaceProgress,
      resetProgress,
      reconcileCatalog,
      deleteProfile,
      exportBackup,
      restoreBackup,
    };
  }

  return {
    STORAGE_PREFIX,
    INDEX_KEY,
    BACKUP_KIND,
    BACKUP_VERSION,
    profileKey,
    create: makeStore,
    createProfile: (...args) => makeStore().createProfile(...args),
    saveProfile: (...args) => makeStore().saveProfile(...args),
    loadProfile: (...args) => makeStore().loadProfile(...args),
    listProfiles: (...args) => makeStore().listProfiles(...args),
    updateProfile: (...args) => makeStore().updateProfile(...args),
    setCompleted: (...args) => makeStore().setCompleted(...args),
    setCompletedMany: (...args) => makeStore().setCompletedMany(...args),
    mergeProgress: (...args) => makeStore().mergeProgress(...args),
    replaceProgress: (...args) => makeStore().replaceProgress(...args),
    resetProgress: (...args) => makeStore().resetProgress(...args),
    reconcileCatalog: (...args) => makeStore().reconcileCatalog(...args),
    deleteProfile: (...args) => makeStore().deleteProfile(...args),
    exportBackup: (...args) => makeStore().exportBackup(...args),
    restoreBackup: (...args) => makeStore().restoreBackup(...args),
  };
})();
