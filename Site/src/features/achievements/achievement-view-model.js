// Pure achievement-ledger view rules. Keeping these outside React makes the
// dense filtering and sorting behavior deterministic and directly testable.
window.NyxAchievementViewModel = (function () {
  'use strict';

  const BATCH_SIZE = 120;

  function catalogRows(catalog) {
    return Array.isArray(catalog && catalog.achievements)
      ? catalog.achievements.map((row, index) => ({
        ...row,
        id:String(row.id),
        categoryId:String(row.categoryId),
        _sourceIndex:index,
      }))
      : [];
  }

  function reward(row) {
    const value = row && typeof row.reward === 'object'
      ? (row.reward.count == null ? row.reward.amount : row.reward.count)
      : row && row.reward;
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function versionParts(value) {
    return String(value || '0').split(/[^0-9]+/).filter(Boolean).map(Number);
  }

  function compareVersions(a, b) {
    const left = versionParts(a);
    const right = versionParts(b);
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      const difference = (left[index] || 0) - (right[index] || 0);
      if (difference) return difference;
    }
    return 0;
  }

  function filterRows(rows, options) {
    const settings = options || {};
    const completed = settings.completed && typeof settings.completed.has === 'function'
      ? settings.completed
      : new Set(Array.isArray(settings.completed) ? settings.completed.map(String) : []);
    const categoryId = settings.categoryId || 'all';
    const status = settings.status || 'all';
    const version = settings.version || 'all';
    const selectedReward = settings.reward == null ? 'all' : settings.reward;
    const rarity = settings.rarity || 'all';
    const sort = settings.sort || 'source';
    const query = String(settings.query || '').trim().toLocaleLowerCase();

    const filtered = (Array.isArray(rows) ? rows : []).filter((row) => {
      const isDone = completed.has(String(row.id));
      if (categoryId !== 'all' && String(row.categoryId) !== String(categoryId)) return false;
      if (status === 'done' && !isDone) return false;
      if (status === 'missing' && isDone) return false;
      if (version !== 'all' && String(row.version) !== String(version)) return false;
      if (selectedReward !== 'all' && reward(row) !== Number(selectedReward)) return false;
      if (rarity !== 'all' && row.rarity !== rarity) return false;
      if (query && !`${row.name || ''} ${row.description || ''} ${row.id} ${row.version || ''}`.toLocaleLowerCase().includes(query)) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      if (sort === 'incomplete') return Number(completed.has(String(a.id))) - Number(completed.has(String(b.id))) || a._sourceIndex - b._sourceIndex;
      if (sort === 'newest') return compareVersions(b.version, a.version) || a._sourceIndex - b._sourceIndex;
      if (sort === 'reward') return reward(b) - reward(a) || a._sourceIndex - b._sourceIndex;
      if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || '')) || a._sourceIndex - b._sourceIndex;
      return a._sourceIndex - b._sourceIndex;
    });
  }

  function filterCategories(categories, progress, options) {
    const settings = options || {};
    const needle = String(settings.query || '').trim().toLocaleLowerCase();
    return (Array.isArray(categories) ? categories : []).filter((category) => {
      const value = progress && typeof progress.get === 'function' ? progress.get(category.id) : null;
      if (settings.hideCompleted && value && value.total && value.done === value.total) return false;
      return !needle || String(category.name || '').toLocaleLowerCase().includes(needle);
    });
  }

  function progressiveRows(rows, limit) {
    const values = Array.isArray(rows) ? rows : [];
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : BATCH_SIZE;
    return { rows:values.slice(0, safeLimit), hasMore:values.length > safeLimit };
  }

  return { BATCH_SIZE, catalogRows, reward, compareVersions, filterRows, filterCategories, progressiveRows };
})();
