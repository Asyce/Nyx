const NUXT_WRAPPERS = new Set(['Reactive', 'Ref', 'ShallowReactive', 'ShallowRef']);

function decodeSpecialReference(index) {
  switch (index) {
    case -1: return undefined;
    case -2: return Number.NaN;
    case -3: return Number.POSITIVE_INFINITY;
    case -4: return Number.NEGATIVE_INFINITY;
    case -5: return -0;
    default: return undefined;
  }
}

export function unflattenNuxtData(flattened) {
  if (!Array.isArray(flattened)) throw new Error('Nuxt payload must be a flattened array');
  const cache = new Map();

  function hydrate(index) {
    if (typeof index !== 'number') return index;
    if (index < 0) return decodeSpecialReference(index);
    if (cache.has(index)) return cache.get(index);
    if (index >= flattened.length) throw new Error(`Nuxt reference ${index} is out of range`);

    const value = flattened[index];
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      if (typeof value[0] === 'string' && NUXT_WRAPPERS.has(value[0])) return hydrate(value[1]);
      const result = [];
      cache.set(index, result);
      for (const entry of value) result.push(hydrate(entry));
      return result;
    }

    const result = {};
    cache.set(index, result);
    for (const [key, entry] of Object.entries(value)) result[key] = hydrate(entry);
    return result;
  }

  return { flattened, hydrate };
}

export function parseWuwaReferencePage(html) {
  const match = String(html).match(
    /<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) throw new Error('WuWa reference page has no Nuxt data payload');

  let flattened;
  try {
    flattened = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`WuWa reference Nuxt payload is invalid JSON: ${error.message}`);
  }
  const { hydrate } = unflattenNuxtData(flattened);
  let overview = null;
  let group = null;
  let resourceVersion = null;

  for (let index = 0; index < flattened.length; index += 1) {
    const raw = flattened[index];
    if (!raw || Array.isArray(raw) || typeof raw !== 'object' || !Object.hasOwn(raw, 'data')) continue;
    const value = hydrate(index)?.data;
    if (
      Array.isArray(value?.list)
      && value.list.every((category) => Array.isArray(category?.child))
      && Number.isSafeInteger(value?.count?.value)
    ) {
      overview = value;
    }
    if (
      Number.isSafeInteger(value?.id)
      && typeof value?.name === 'string'
      && Array.isArray(value?.child)
      && value.child.every((achievement) => Number.isSafeInteger(achievement?.id))
    ) {
      group = value;
    }
    if (typeof value?.resourceVersion === 'string') resourceVersion = value.resourceVersion;
  }

  return { resourceVersion, overview, group };
}

export function expandWuwaReferenceAchievements(rows) {
  if (!Array.isArray(rows)) throw new Error('WuWa reference achievements must be an array');
  const expanded = [];
  function visit(row) {
    if (!Number.isSafeInteger(row?.id)) throw new Error('WuWa reference achievement ID is invalid');
    expanded.push(row);
    for (const child of row.child || []) visit(child);
  }
  for (const row of rows) visit(row);
  return expanded;
}

export function reconcileWuwaReleasedReference(candidateAchievements, overview, groups) {
  if (!Array.isArray(candidateAchievements)) throw new Error('WuWa candidate achievements must be an array');
  if (!overview || !Array.isArray(overview.list) || !Number.isSafeInteger(overview?.count?.value)) {
    throw new Error('WuWa reference overview is invalid');
  }
  if (!Array.isArray(groups)) throw new Error('WuWa reference groups must be an array');

  const summaries = overview.list.flatMap((category) => category.child.map((group) => ({
    categoryId: String(category.id),
    groupId: String(group.id),
    title: String(group.title),
    listedRows: Number(group.count),
  })));
  const expectedGroupIds = new Set(summaries.map(({ groupId }) => groupId));
  const groupsById = new Map();
  for (const group of groups) {
    const groupId = String(group?.id);
    if (!expectedGroupIds.has(groupId)) throw new Error(`WuWa reference returned unexpected group ${groupId}`);
    if (groupsById.has(groupId)) throw new Error(`WuWa reference returned duplicate group ${groupId}`);
    groupsById.set(groupId, group);
  }
  const missingGroups = [...expectedGroupIds].filter((groupId) => !groupsById.has(groupId));
  if (missingGroups.length) throw new Error(`WuWa reference is missing groups: ${missingGroups.join(', ')}`);

  const candidateById = new Map(candidateAchievements.map((row) => [String(row.id), row]));
  if (candidateById.size !== candidateAchievements.length) throw new Error('WuWa candidate IDs are duplicated');
  const candidateCounts = new Map();
  for (const row of candidateAchievements) {
    const groupId = String(row.groupId);
    candidateCounts.set(groupId, (candidateCounts.get(groupId) || 0) + 1);
  }

  const referenceRows = [];
  const groupReconciliation = summaries.map((summary) => {
    const group = groupsById.get(summary.groupId);
    const expanded = expandWuwaReferenceAchievements(group.child);
    referenceRows.push(...expanded.map((row) => ({ ...row, groupId:summary.groupId })));
    return {
      ...summary,
      pageRows: group.child.length,
      expandedRows: expanded.length,
      candidateRows: candidateCounts.get(summary.groupId) || 0,
    };
  });
  const referenceById = new Map(referenceRows.map((row) => [String(row.id), row]));
  if (referenceById.size !== referenceRows.length) throw new Error('WuWa reference IDs are duplicated');

  const candidateOnlyIds = [...candidateById.keys()]
    .filter((id) => !referenceById.has(id))
    .sort((left, right) => left.localeCompare(right, 'en', { numeric:true }));
  const referenceOnlyIds = [...referenceById.keys()]
    .filter((id) => !candidateById.has(id))
    .sort((left, right) => left.localeCompare(right, 'en', { numeric:true }));

  return {
    total: overview.count.value,
    listedGroupRows: summaries.reduce((sum, group) => sum + group.listedRows, 0),
    expandedPageRows: referenceRows.length,
    candidateRows: candidateAchievements.length,
    candidateOnlyIds,
    referenceOnlyIds,
    groupCountMismatches: groupReconciliation.filter((group) => (
      group.listedRows !== group.expandedRows || group.listedRows !== group.candidateRows
    )),
  };
}
