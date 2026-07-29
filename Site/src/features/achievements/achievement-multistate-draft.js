// Disabled Endfield multi-state achievement contract.
//
// This module is deliberately not loaded by the live achievement page. It is
// a fixture-backed contract laboratory for the v2 format while real account
// payload semantics and account binding remain unproven.
window.NyxAchievementMultiStateDraft = (function () {
  'use strict';

  const PENGO_KIND = 'pengo-achievements';
  const PENGO_VERSION = 2;
  const GAME = 'ae';
  const FORMAT = 'pengo-v2-ae-draft';
  const MAX_ACHIEVEMENTS = 1000;
  const MAX_CONDITIONS = 100;
  const MAX_UNKNOWN_LEVEL = 255;

  function contractError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function assertShape(value, required, optional, code, label) {
    if (!isRecord(value)) throw contractError(`${label} must be an object.`, code);
    const allowed = new Set(required.concat(optional || []));
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) throw contractError(`${label} contains an unsupported field: ${key}.`, code);
    }
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        throw contractError(`${label} is missing the required field: ${key}.`, code);
      }
    }
  }

  function normalizeToken(value, label) {
    const token = String(value == null ? '' : value).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_:-]{0,159}$/.test(token)) {
      throw contractError(`${label} is invalid.`, 'INVALID_ID');
    }
    return token;
  }

  function normalizeCount(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw contractError(`${label} must be a non-negative whole number.`, 'INVALID_PROGRESS');
    }
    return value;
  }

  function normalizeBinding(value) {
    if (value == null) return null;
    assertShape(value, ['scheme', 'value', 'region'], [], 'INVALID_BINDING', 'Account binding');
    const scheme = String(value.scheme).trim();
    const fingerprint = String(value.value).trim();
    const region = String(value.region).trim().slice(0, 48);
    if (scheme !== 'pengo-install-hmac-v1' || !/^[A-Za-z0-9_-]{16,256}$/.test(fingerprint)) {
      throw contractError('The automatic-export account binding is invalid.', 'INVALID_BINDING');
    }
    return { scheme, value: fingerprint, region };
  }

  function makeCatalogIndex(catalog) {
    if (!isRecord(catalog) || catalog.game !== GAME || !Array.isArray(catalog.achievements)) {
      throw contractError('A valid Endfield candidate catalog is required.', 'INVALID_CATALOG');
    }
    const achievements = new Map();
    for (const row of catalog.achievements) {
      if (!isRecord(row)) throw contractError('The Endfield catalog contains an invalid achievement.', 'INVALID_CATALOG');
      const id = normalizeToken(row.id, 'Catalog achievement ID');
      if (achievements.has(id)) throw contractError('The Endfield catalog contains duplicate achievement IDs.', 'INVALID_CATALOG');
      const metadata = isRecord(row.metadata) ? row.metadata : {};
      const maxFromStates = Array.isArray(row.states)
        ? row.states.reduce((maximum, state) => (
          isRecord(state) && Number.isSafeInteger(state.level) ? Math.max(maximum, state.level) : maximum
        ), 0)
        : 0;
      const maxLevel = Number.isSafeInteger(metadata.maxLevel) && metadata.maxLevel >= 0
        ? metadata.maxLevel
        : maxFromStates;
      const conditions = new Map();
      for (const state of Array.isArray(row.states) ? row.states : []) {
        for (const condition of isRecord(state) && Array.isArray(state.conditions) ? state.conditions : []) {
          const conditionId = normalizeToken(condition.id, 'Catalog condition ID');
          const target = normalizeCount(condition.target, 'Catalog condition target');
          const prior = conditions.get(conditionId);
          if (prior != null && prior !== target) {
            throw contractError('The Endfield catalog gives one condition ID multiple targets.', 'INVALID_CATALOG');
          }
          conditions.set(conditionId, target);
        }
      }
      achievements.set(id, {
        id,
        maxLevel,
        canBePlated: metadata.canBePlated === true,
        applyRareEffect: metadata.applyRareEffect === true,
        conditions,
      });
    }
    return achievements;
  }

  function normalizeCondition(value, catalogConditionTargets) {
    assertShape(value, ['id', 'current', 'target'], [], 'INVALID_CONDITION', 'Achievement condition');
    const id = normalizeToken(value.id, 'Achievement condition ID');
    const current = normalizeCount(value.current, 'Achievement condition progress');
    const target = normalizeCount(value.target, 'Achievement condition target');
    if (current > target) {
      throw contractError('Achievement condition progress cannot exceed its target.', 'INVALID_CONDITION');
    }
    if (catalogConditionTargets && catalogConditionTargets.has(id) && catalogConditionTargets.get(id) !== target) {
      throw contractError('Achievement condition target does not match the pinned catalog.', 'CATALOG_TARGET_MISMATCH');
    }
    return { id, current, target };
  }

  function normalizeAchievement(value, catalogIndex) {
    assertShape(value, ['id', 'state'], [], 'INVALID_ACHIEVEMENT', 'Achievement row');
    const id = normalizeToken(value.id, 'Achievement ID');
    const catalogRow = catalogIndex.get(id) || null;
    const state = value.state;
    assertShape(
      state,
      ['level', 'plated', 'rareEffect', 'conditions'],
      [],
      'INVALID_STATE',
      'Achievement state',
    );
    const maximum = catalogRow ? catalogRow.maxLevel : MAX_UNKNOWN_LEVEL;
    const level = normalizeCount(state.level, 'Achievement level');
    if (level > maximum) {
      throw contractError('Achievement level exceeds the pinned catalog maximum.', 'INVALID_LEVEL');
    }
    if (typeof state.plated !== 'boolean' || typeof state.rareEffect !== 'boolean') {
      throw contractError('Achievement plating and rare-effect states must be true or false.', 'INVALID_STATE');
    }
    if (catalogRow && state.plated && !catalogRow.canBePlated) {
      throw contractError('This achievement cannot be plated according to the pinned catalog.', 'UNSUPPORTED_PLATING');
    }
    if (catalogRow && state.rareEffect && !catalogRow.applyRareEffect) {
      throw contractError('This achievement cannot have a rare effect according to the pinned catalog.', 'UNSUPPORTED_RARE_EFFECT');
    }
    if (!Array.isArray(state.conditions) || state.conditions.length > MAX_CONDITIONS) {
      throw contractError(`Achievement conditions must contain at most ${MAX_CONDITIONS} rows.`, 'INVALID_CONDITION');
    }
    const conditions = [];
    let priorId = '';
    for (const conditionValue of state.conditions) {
      const condition = normalizeCondition(conditionValue, catalogRow && catalogRow.conditions);
      if (condition.id === priorId) throw contractError('Achievement conditions must have unique IDs.', 'DUPLICATE_CONDITION');
      if (priorId && condition.id.localeCompare(priorId) <= 0) {
        throw contractError('Achievement conditions must be sorted by ID.', 'UNSORTED_CONDITIONS');
      }
      priorId = condition.id;
      conditions.push(condition);
    }
    return {
      id,
      state: {
        level,
        plated: state.plated,
        rareEffect: state.rareEffect,
        conditions,
      },
      known: Boolean(catalogRow),
    };
  }

  function normalizeRows(values, catalogIndex, requireSorted) {
    if (!Array.isArray(values) || values.length > MAX_ACHIEVEMENTS) {
      throw contractError(`The achievement list must contain at most ${MAX_ACHIEVEMENTS} rows.`, 'INVALID_FORMAT');
    }
    const rows = [];
    const seen = new Set();
    let priorId = '';
    for (const value of values) {
      const row = normalizeAchievement(value, catalogIndex);
      if (seen.has(row.id)) throw contractError('Achievement rows must have unique IDs.', 'DUPLICATE_ACHIEVEMENT');
      if (requireSorted && priorId && row.id.localeCompare(priorId) <= 0) {
        throw contractError('Achievement rows must be sorted by ID.', 'UNSORTED_ACHIEVEMENTS');
      }
      seen.add(row.id);
      priorId = row.id;
      rows.push(row);
    }
    rows.sort((left, right) => left.id.localeCompare(right.id));
    return rows;
  }

  function publicRow(row) {
    return {
      id: row.id,
      state: {
        level: row.state.level,
        plated: row.state.plated,
        rareEffect: row.state.rareEffect,
        conditions: row.state.conditions.map((condition) => ({
          id: condition.id,
          current: condition.current,
          target: condition.target,
        })),
      },
    };
  }

  function parse(value, catalog) {
    let data = value;
    if (typeof value === 'string') {
      try { data = JSON.parse(value); } catch (error) {
        throw contractError('The achievement file is not valid JSON.', 'INVALID_JSON');
      }
    }
    assertShape(
      data,
      ['kind', 'version', 'game', 'catalogVersion', 'exportedAt', 'achievements'],
      ['accountBinding'],
      'INVALID_FORMAT',
      'Pengo achievement export',
    );
    if (data.kind !== PENGO_KIND) throw contractError('This is not a Pengo achievement export.', 'INVALID_KIND');
    if (data.version !== PENGO_VERSION) throw contractError('This draft accepts only Pengo achievement version 2.', 'INVALID_VERSION');
    if (data.game !== GAME) throw contractError('This draft accepts only Endfield exports.', 'INVALID_GAME');
    const catalogVersion = String(data.catalogVersion == null ? '' : data.catalogVersion).trim();
    if (!catalogVersion || catalogVersion.length > 160) {
      throw contractError('The catalog version is missing or invalid.', 'INVALID_CATALOG_VERSION');
    }
    const exportedAt = String(data.exportedAt == null ? '' : data.exportedAt).trim();
    if (!exportedAt || !Number.isFinite(Date.parse(exportedAt))) {
      throw contractError('The export date is invalid.', 'INVALID_EXPORTED_AT');
    }
    const catalogIndex = makeCatalogIndex(catalog);
    const rows = normalizeRows(data.achievements, catalogIndex, true);
    const achievements = rows.map(publicRow);
    return {
      format: FORMAT,
      game: GAME,
      catalogVersion,
      exportedAt,
      accountBinding: normalizeBinding(data.accountBinding),
      unbound: data.accountBinding == null,
      achievements,
      knownAchievements: rows.filter((row) => row.known).map(publicRow),
      unknownAchievements: rows.filter((row) => !row.known).map(publicRow),
    };
  }

  function mergeConditions(left, right) {
    const merged = new Map();
    for (const condition of left.concat(right)) {
      const prior = merged.get(condition.id);
      if (prior && prior.target !== condition.target) {
        throw contractError('One condition ID cannot have multiple targets.', 'CATALOG_TARGET_MISMATCH');
      }
      merged.set(condition.id, prior
        ? { id: condition.id, current: Math.max(prior.current, condition.current), target: condition.target }
        : { id: condition.id, current: condition.current, target: condition.target });
    }
    return Array.from(merged.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  function mergeRows(left, right, catalogIndex) {
    const merged = {
      id: right.id,
      state: {
        level: Math.max(left.state.level, right.state.level),
        plated: left.state.plated || right.state.plated,
        rareEffect: left.state.rareEffect || right.state.rareEffect,
        conditions: mergeConditions(left.state.conditions, right.state.conditions),
      },
    };
    return normalizeAchievement(merged, catalogIndex);
  }

  function rowChanged(left, right) {
    return JSON.stringify(publicRow(left)) !== JSON.stringify(publicRow(right));
  }

  function preview(currentAchievements, incomingAchievements, catalog, options) {
    const mode = options && options.mode === 'replace' ? 'replace' : 'merge';
    const catalogIndex = makeCatalogIndex(catalog);
    const current = normalizeRows(currentAchievements || [], catalogIndex, false);
    const incoming = normalizeRows(incomingAchievements || [], catalogIndex, false);
    const currentById = new Map(current.map((row) => [row.id, row]));
    const incomingById = new Map(incoming.map((row) => [row.id, row]));
    const nextById = new Map();
    let added = 0;
    let advanced = 0;
    let removed = 0;
    let unknownRetained = 0;

    if (mode === 'merge') {
      for (const row of current) nextById.set(row.id, row);
      for (const row of incoming) {
        const prior = nextById.get(row.id);
        if (!prior) {
          nextById.set(row.id, row);
          added += 1;
        } else {
          const merged = mergeRows(prior, row, catalogIndex);
          if (rowChanged(prior, merged)) advanced += 1;
          nextById.set(row.id, merged);
        }
      }
    } else {
      for (const row of incoming) nextById.set(row.id, row);
      for (const row of current) {
        if (!row.known && !incomingById.has(row.id)) {
          nextById.set(row.id, row);
          unknownRetained += 1;
        } else if (row.known && !incomingById.has(row.id)) {
          removed += 1;
        }
      }
      for (const row of incoming) {
        const prior = currentById.get(row.id);
        if (!prior) added += 1;
        else if (rowChanged(prior, row)) advanced += 1;
      }
    }

    const normalized = Array.from(nextById.values()).sort((a, b) => a.id.localeCompare(b.id));
    return {
      format: FORMAT,
      game: GAME,
      mode,
      achievements: normalized.map(publicRow),
      knownAchievements: normalized.filter((row) => row.known).map(publicRow),
      unknownAchievements: normalized.filter((row) => !row.known).map(publicRow),
      added,
      advanced,
      removed,
      unknownRetained,
    };
  }

  return {
    PENGO_KIND,
    PENGO_VERSION,
    GAME,
    FORMAT,
    MAX_ACHIEVEMENTS,
    MAX_CONDITIONS,
    parse,
    preview,
  };
})();
