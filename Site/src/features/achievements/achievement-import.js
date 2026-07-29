// Achievement file parsing and additive import previews. New exporters write
// the versioned Pengo contract. The original GI/HSR list formats remain
// readable so existing files do not break.
window.NyxAchievementImport = (function () {
  'use strict';

  const Core = window.NyxAchievementCore;
  const Store = window.NyxAchievementStore;
  const Games = window.NyxAchievementGames;
  if (!Core || !Store) throw new Error('Achievement core and storage must load before achievement-import.js.');

  const PENGO_KIND = 'pengo-achievements';
  const PENGO_VERSION = 1;
  const MAX_ACHIEVEMENTS = 10000;

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

    if (data.kind === PENGO_KIND) {
      if (data.version !== PENGO_VERSION) {
        throw importError('This Pengo achievement export version is not supported.', 'INVALID_VERSION');
      }
      let game;
      try { game = Core.normalizeGame(data.game); } catch (error) {
        throw importError('This Pengo achievement export names an unsupported game.', 'INVALID_GAME');
      }
      const gameConfig = Games && Games.get(game);
      if (gameConfig && gameConfig.progressModel !== 'boolean') {
        throw importError('This game needs a newer multi-state achievement format.', 'MULTI_STATE_REQUIRED');
      }
      if (!Array.isArray(data.achievements) || data.achievements.length > MAX_ACHIEVEMENTS) {
        throw importError(`The achievement list must contain at most ${MAX_ACHIEVEMENTS} rows.`, 'INVALID_FORMAT');
      }
      const rawIds = [];
      for (const row of data.achievements) {
        if (!row || typeof row !== 'object' || Array.isArray(row) || row.status !== 'complete') {
          throw importError('Every achievement row must contain an ID and status "complete".', 'INVALID_ACHIEVEMENT');
        }
        const id = Core.normalizeId(row.id);
        if (id === null || !Number.isSafeInteger(Number(id))) {
          throw importError('An achievement ID is invalid or outside the supported range.', 'INVALID_ACHIEVEMENT');
        }
        rawIds.push(id);
      }
      const inspected = Core.inspectIds(rawIds);
      if (inspected.duplicateCount) {
        throw importError('Pengo achievement rows must contain unique IDs.', 'DUPLICATE_ACHIEVEMENT');
      }
      for (let index = 1; index < inspected.ids.length; index += 1) {
        if (Number(inspected.ids[index - 1]) >= Number(inspected.ids[index])) {
          throw importError('Pengo achievement rows must be sorted by numeric ID.', 'UNSORTED_ACHIEVEMENTS');
        }
      }
      let accountBinding = null;
      if (data.accountBinding != null) {
        try { accountBinding = Core.normalizeAccountBinding(data.accountBinding); } catch (error) {
          throw importError('The automatic-export account binding is invalid.', 'INVALID_BINDING');
        }
      }
      const exportedAt = String(data.exportedAt == null ? '' : data.exportedAt).trim();
      if (exportedAt && !Number.isFinite(Date.parse(exportedAt))) {
        throw importError('The export date is invalid.', 'INVALID_EXPORTED_AT');
      }
      return {
        format: 'pengo-v1',
        game,
        ids: inspected.ids,
        inputCount: data.achievements.length,
        duplicateCount: inspected.duplicateCount,
        invalidCount: inspected.invalidCount,
        accountBinding,
        catalogVersion: String(data.catalogVersion == null ? '' : data.catalogVersion).trim().slice(0, 80),
        exportedAt,
        unbound: !accountBinding,
      };
    }

    const legacy = [
      ['gi', 'gi_achievements'],
      ['hsr', 'hsr_achievements'],
    ].filter(([, field]) => Object.prototype.hasOwnProperty.call(data, field));
    if (legacy.length !== 1) {
      throw importError(legacy.length > 1 ? 'The file contains both games. Import one game at a time.' : 'No supported achievement list was found.', 'INVALID_FORMAT');
    }
    const [game, field] = legacy[0];
    if (!Array.isArray(data[field])) throw importError('The achievement list must be an array.', 'INVALID_FORMAT');
    if (data[field].length > MAX_ACHIEVEMENTS) {
      throw importError(`The achievement list must contain at most ${MAX_ACHIEVEMENTS} rows.`, 'INVALID_FORMAT');
    }
    const inspected = Core.inspectIds(data[field]);
    return {
      format: 'stardb',
      game,
      ids: inspected.ids,
      inputCount: inspected.inputCount,
      duplicateCount: inspected.duplicateCount,
      invalidCount: inspected.invalidCount,
      accountBinding: null,
      catalogVersion: '',
      exportedAt: '',
      unbound: true,
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
    if (!parsed || !['stardb', 'pengo-v1'].includes(parsed.format)) {
      throw importError('Preview requires a supported achievement list.', 'INVALID_FORMAT');
    }
    const game = Core.normalizeGame(targetGame);
    if (parsed.game !== game) throw importError('This achievement file belongs to a different game.', 'WRONG_GAME');
    if (profile && Core.normalizeGame(profile.game) !== game) {
      throw importError('The selected profile belongs to a different game.', 'WRONG_PROFILE');
    }
    if (parsed.accountBinding && profile && profile.accountBinding && !Core.sameAccountBinding(parsed.accountBinding, profile.accountBinding)) {
      throw importError('This automatic export belongs to a different linked account.', 'WRONG_ACCOUNT');
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
      accountBinding: parsed.accountBinding,
      accountBindingStatus: parsed.accountBinding
        ? (profile && profile.accountBinding ? 'matched' : 'new')
        : 'unbound',
      requiresUnboundConfirmation: !parsed.accountBinding,
      catalogVersion: parsed.catalogVersion || '',
      exportedAt: parsed.exportedAt || '',
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
    if (result.requiresUnboundConfirmation && !(options && options.unboundConfirmed === true)) {
      throw importError('Confirm that this unlinked file belongs to the selected profile.', 'UNBOUND_CONFIRMATION_REQUIRED');
    }
    const opts = Object.assign({}, options, {
      accountBinding: result.accountBinding || undefined,
    });
    const mode = opts.mode === 'replace' ? 'replace' : 'merge';
    if (mode === 'replace') {
      if (typeof store.replaceProgress !== 'function') throw new Error('This achievement store cannot replace progress.');
      return store.replaceProgress(result.game, profileId, result.knownIds, result.unknownIds, opts);
    }
    return store.mergeProgress(result.game, profileId, result.knownIds, result.unknownIds, opts);
  }

  function restoreBackup(store, parsed, options) {
    if (!parsed || parsed.format !== 'nyx-backup') throw importError('A valid Nyx achievement backup is required.', 'INVALID_BACKUP');
    return store.restoreBackup(parsed.bundle, options);
  }

  return {
    PENGO_KIND,
    PENGO_VERSION,
    MAX_ACHIEVEMENTS,
    parse,
    preview,
    apply,
    restoreBackup,
  };
})();
