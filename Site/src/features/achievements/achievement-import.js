// Achievement file parsing and additive import previews. Supported MVP input:
//   { "gi_achievements": [1001, "1002"] }
//   { "hsr_achievements": [2001, "2002"] }
// plus Nyx's own achievement backup bundle.
window.NyxAchievementImport = (function () {
  'use strict';

  const Core = window.NyxAchievementCore;
  const Store = window.NyxAchievementStore;
  if (!Core || !Store) throw new Error('Achievement core and storage must load before achievement-import.js.');

  function importError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function parse(value) {
    let data = value;
    if (typeof value === 'string') {
      try { data = JSON.parse(value); } catch (error) { throw importError('The achievement file is not valid JSON.', 'INVALID_JSON'); }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw importError('The achievement file has an unsupported shape.', 'INVALID_FORMAT');
    }
    if (data.kind === Store.BACKUP_KIND) {
      if (data.version !== Store.BACKUP_VERSION || !Array.isArray(data.profiles)) {
        throw importError('This Nyx achievement backup version is not supported.', 'INVALID_BACKUP');
      }
      return { format: 'nyx-backup', bundle: data };
    }

    const hasGi = Object.prototype.hasOwnProperty.call(data, 'gi_achievements');
    const hasHsr = Object.prototype.hasOwnProperty.call(data, 'hsr_achievements');
    if (hasGi === hasHsr) {
      throw importError(hasGi ? 'The file contains both games. Import one game at a time.' : 'No supported achievement list was found.', 'INVALID_FORMAT');
    }
    const game = hasGi ? 'gi' : 'hsr';
    const field = hasGi ? 'gi_achievements' : 'hsr_achievements';
    if (!Array.isArray(data[field])) throw importError('The achievement list must be an array.', 'INVALID_FORMAT');
    const inspected = Core.inspectIds(data[field]);
    return {
      format: 'stardb',
      game,
      ids: inspected.ids,
      inputCount: inspected.inputCount,
      duplicateCount: inspected.duplicateCount,
      invalidCount: inspected.invalidCount,
    };
  }

  function catalogIdSet(catalogIds) {
    const values = Array.isArray(catalogIds) ? catalogIds : [];
    const ids = [];
    for (const value of values) {
      // Catalog callers may pass IDs or catalog rows. Only the explicit id
      // field is read; titles/descriptions are intentionally ignored.
      const raw = value && typeof value === 'object' ? value.id : value;
      const id = Core.normalizeId(raw);
      if (id !== null) ids.push(id);
    }
    return new Set(ids);
  }

  function preview(parsed, targetGame, catalogIds, profile) {
    if (!parsed || parsed.format !== 'stardb') throw importError('Preview requires a Stardb achievement list.', 'INVALID_FORMAT');
    const game = Core.normalizeGame(targetGame);
    if (parsed.game !== game) throw importError('This achievement file belongs to a different game.', 'WRONG_GAME');
    if (profile && Core.normalizeGame(profile.game) !== game) {
      throw importError('The selected profile belongs to a different game.', 'WRONG_PROFILE');
    }

    const knownCatalog = catalogIdSet(catalogIds);
    const knownIds = [];
    const unknownIds = [];
    for (const id of parsed.ids) {
      if (knownCatalog.has(id)) knownIds.push(id);
      else unknownIds.push(id);
    }
    const completed = new Set(profile ? Core.normalizeIds(profile.completedIds) : []);
    const retainedUnknown = new Set(profile ? Core.normalizeIds(profile.unknownIds) : []);
    const newCompletedIds = knownIds.filter((id) => !completed.has(id));
    const newUnknownIds = unknownIds.filter((id) => !retainedUnknown.has(id) && !completed.has(id));

    return {
      format: parsed.format,
      game,
      profileId: profile ? String(profile.id) : null,
      inputCount: parsed.inputCount,
      uniqueCount: parsed.ids.length,
      duplicateCount: parsed.duplicateCount,
      invalidCount: parsed.invalidCount,
      knownIds,
      unknownIds,
      knownCount: knownIds.length,
      unknownCount: unknownIds.length,
      alreadyCompletedCount: knownIds.length - newCompletedIds.length,
      newCompletedIds,
      newCompletedCount: newCompletedIds.length,
      newUnknownIds,
      newUnknownCount: newUnknownIds.length,
      replaceCompletedRemovedCount: profile ? profile.completedIds.filter((id) => !knownIds.includes(id)).length : 0,
      replaceUnknownRemovedCount: profile ? profile.unknownIds.filter((id) => !unknownIds.includes(id)).length : 0,
    };
  }

  function apply(store, profileId, result, options) {
    if (!store || typeof store.mergeProgress !== 'function') throw new Error('Achievement store is required.');
    if (!result || !Array.isArray(result.knownIds) || !Array.isArray(result.unknownIds)) {
      throw new Error('A valid achievement import preview is required.');
    }
    if (result.profileId && String(profileId) !== result.profileId) {
      throw importError('The selected profile changed after this preview. Preview the file again.', 'WRONG_PROFILE');
    }
    const mode = options && options.mode === 'replace' ? 'replace' : 'merge';
    if (mode === 'replace') {
      if (typeof store.replaceProgress !== 'function') throw new Error('This achievement store cannot replace progress.');
      return store.replaceProgress(result.game, profileId, result.knownIds, result.unknownIds, options);
    }
    return store.mergeProgress(result.game, profileId, result.knownIds, result.unknownIds, options);
  }

  function restoreBackup(store, parsed, options) {
    if (!parsed || parsed.format !== 'nyx-backup') throw importError('A valid Nyx achievement backup is required.', 'INVALID_BACKUP');
    return store.restoreBackup(parsed.bundle, options);
  }

  return { parse, preview, apply, restoreBackup };
})();
