import crypto from 'node:crypto';

const GAME_KEYS = new Set(['zzz', 'wuwa', 'ae']);
const PROGRESS_MODELS = new Set(['boolean', 'multi-state']);
const WUWA_STANDARD_CATEGORY_IDS = new Set(['1', '2', '3', '4']);
const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_REVISION_TYPES = new Set(['github-commit', 'snapshot-sha256']);
const OFFICIAL_RELEASE_HOSTS = {
  zzz: new Set(['www.hoyolab.com', 'zenless.hoyoverse.com']),
};
const CAPABILITY_KEYS = [
  'stableIds',
  'englishText',
  'categories',
  'rewards',
  'hiddenRules',
  'icons',
  'multiState',
  'releasedVersionProven',
];

function iso(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid`);
  return new Date(parsed).toISOString();
}

function text(value, label, { nullable = false } = {}) {
  if (value == null && nullable) return null;
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} is empty`);
  return normalized;
}

function integer(value, label, { min = 0 } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) throw new Error(`${label} is invalid`);
  return parsed;
}

function booleanish(value, label) {
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === '0') return false;
  if (value === 1 || value === '1') return true;
  throw new Error(`${label} is invalid`);
}

function uniqueMap(rows, key, label) {
  if (!Array.isArray(rows)) throw new Error(`${label} must be an array`);
  const result = new Map();
  for (const row of rows) {
    const id = text(row?.[key], `${label} id`);
    if (result.has(id)) throw new Error(`${label} contains duplicate id ${id}`);
    result.set(id, row);
  }
  return result;
}

function sortById(rows) {
  return rows.sort((left, right) => left.id.localeCompare(right.id, 'en', { numeric: true }));
}

function capabilities(values) {
  const result = {};
  for (const key of CAPABILITY_KEYS) {
    if (typeof values?.[key] !== 'boolean') throw new Error(`Candidate capability ${key} is invalid`);
    result[key] = values[key];
  }
  return result;
}

function sourceMetadata(source) {
  const urls = Array.isArray(source?.urls) ? source.urls.map((url) => text(url, 'Candidate source URL')) : [];
  if (!urls.length || new Set(urls).size !== urls.length || urls.some((url) => !/^https:\/\//.test(url))) {
    throw new Error('Candidate source URLs are invalid');
  }
  const snapshotSha256 = text(source.snapshotSha256, 'Candidate source snapshot SHA-256');
  if (!SHA256.test(snapshotSha256)) throw new Error('Candidate source snapshot SHA-256 is invalid');
  const revisionType = text(source.revisionType, 'Candidate source revision type');
  if (!SOURCE_REVISION_TYPES.has(revisionType)) throw new Error('Candidate source revision type is invalid');
  const revision = text(source.revision, 'Candidate source revision');
  if (revisionType === 'github-commit' && !/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error('Candidate GitHub revision is invalid');
  }
  if (revisionType === 'snapshot-sha256' && !SHA256.test(revision)) {
    throw new Error('Candidate snapshot revision is invalid');
  }
  const codeRevision = source.codeRevision == null ? null : text(source.codeRevision, 'Candidate source code revision');
  if (codeRevision != null && !/^[a-f0-9]{40}$/.test(codeRevision)) {
    throw new Error('Candidate source code revision is invalid');
  }
  return {
    name: text(source.name, 'Candidate source name'),
    urls,
    revision,
    revisionType,
    codeRevision,
    retrievedAt: iso(source.retrievedAt, 'Candidate source retrievedAt'),
    snapshotSha256,
  };
}

function releaseMetadata(release, game) {
  if (release == null) return null;
  const version = text(release.version, `${game} candidate release version`);
  if (!/^\d+\.\d+$/.test(version)) throw new Error(`${game} candidate release version is invalid`);
  const officialUrl = new URL(text(release.officialUrl, `${game} candidate official release URL`));
  const hosts = OFFICIAL_RELEASE_HOSTS[game];
  if (
    officialUrl.protocol !== 'https:'
    || officialUrl.username
    || officialUrl.password
    || officialUrl.hash
    || !hosts?.has(officialUrl.hostname)
  ) {
    throw new Error(`${game} candidate official release URL is invalid`);
  }
  return {
    version,
    officialUrl: officialUrl.toString(),
    verifiedAt: iso(release.verifiedAt, `${game} candidate release verifiedAt`),
  };
}

function numericVersion(value, label) {
  const normalized = text(value, label);
  if (!/^\d+\.\d+$/.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized.split('.').map(Number);
}

function compareVersions(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function candidateEnvelope({
  game,
  generatedAt,
  source,
  release = null,
  candidateCapabilities,
  blockers,
  categories,
  achievements,
  metrics,
}) {
  if (!GAME_KEYS.has(game)) throw new Error('Candidate game is invalid');
  if (!Array.isArray(blockers) || !blockers.length) throw new Error(`${game} candidate needs blockers`);
  const normalizedBlockers = [...new Set(blockers.map((entry) => text(entry, `${game} candidate blocker`)))].sort();
  const normalizedCategories = sortById(categories);
  const normalizedAchievements = sortById(achievements);
  const candidate = {
    schemaVersion: 1,
    game,
    status: 'candidate',
    publishable: false,
    generatedAt: iso(generatedAt, `${game} candidate generatedAt`),
    source: sourceMetadata(source),
    release: releaseMetadata(release, game),
    capabilities: capabilities(candidateCapabilities),
    blockers: normalizedBlockers,
    categoryCount: normalizedCategories.length,
    achievementCount: normalizedAchievements.length,
    categories: normalizedCategories,
    achievements: normalizedAchievements,
    metrics,
  };
  return validateAchievementCandidate(candidate);
}

function categoryRow(id, titleValue, sort, hidden = false, iconPath = null) {
  return {
    id: text(id, 'Candidate category id'),
    title: titleValue == null ? null : text(titleValue, 'Candidate category title'),
    sort: integer(sort, 'Candidate category sort'),
    hidden: Boolean(hidden),
    iconPath: iconPath ? text(iconPath, 'Candidate category icon path') : null,
  };
}

function achievementRow({
  id,
  title: titleValue,
  description,
  categoryId,
  groupId = null,
  reward = null,
  hidden = null,
  version = null,
  iconPath = null,
  progressModel,
  states = [],
  metadata = {},
}) {
  if (!PROGRESS_MODELS.has(progressModel)) throw new Error('Candidate achievement progress model is invalid');
  return {
    id: text(id, 'Candidate achievement id'),
    title: titleValue == null ? null : text(titleValue, 'Candidate achievement title'),
    description: description == null ? null : String(description).trim(),
    categoryId: text(categoryId, 'Candidate achievement category id'),
    groupId: groupId == null ? null : text(groupId, 'Candidate achievement group id'),
    reward: reward == null ? null : integer(reward, 'Candidate achievement reward'),
    hidden: hidden == null ? null : Boolean(hidden),
    version: version == null || String(version).trim() === '' ? null : text(version, 'Candidate achievement version'),
    iconPath: iconPath == null || iconPath === '' ? null : text(iconPath, 'Candidate achievement icon path'),
    progressModel,
    states,
    metadata,
  };
}

export function sha256CandidateParts(parts) {
  if (!Array.isArray(parts) || !parts.length) throw new Error('Candidate source parts are missing');
  const hash = crypto.createHash('sha256');
  for (const part of parts) {
    const label = text(part?.label, 'Candidate source part label');
    const bytes = Buffer.isBuffer(part?.bytes) ? part.bytes : Buffer.from(String(part?.bytes ?? ''), 'utf8');
    hash.update(Buffer.from(`${label}\0${bytes.length}\0`, 'utf8'));
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function zzzMatchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[“”"'‘’「」『』《》〈〉，。！？：；、…—·,.!?:;\-]/g, '')
    .toLowerCase();
}

export function reconcileZzzReference(chineseRows = [], readableRows = []) {
  if (!chineseRows.length && !readableRows.length) {
    return {
      stableNonArcadeRows: 0,
      readableReferenceRows: 0,
      exactMatches: 0,
      titleOnlyMatches: 0,
      matchedReferenceRows: 0,
      unmatchedReferenceRows: 0,
      unmatchedStableRows: 0,
      unmatchedReferenceTitles: [],
      unmatchedStableIds: [],
    };
  }
  const stableById = uniqueMap(chineseRows, 'id', 'ZZZ Chinese achievements');
  const byFingerprint = new Map();
  const byTitle = new Map();
  for (const row of stableById.values()) {
    if (row.arcade) continue;
    const fingerprint = `${zzzMatchText(row.name)}|${zzzMatchText(row.description)}`;
    const titleKey = zzzMatchText(row.name);
    if (!byFingerprint.has(fingerprint)) byFingerprint.set(fingerprint, []);
    if (!byTitle.has(titleKey)) byTitle.set(titleKey, []);
    byFingerprint.get(fingerprint).push(row.id);
    byTitle.get(titleKey).push(row.id);
  }
  let exactMatches = 0;
  let titleOnlyMatches = 0;
  const matchedStableIds = new Set();
  const unmatchedReferenceTitles = [];
  for (const row of readableRows) {
    const titleValue = String(row?.['\u6210\u5c31\u540d'] ?? '').trim();
    const description = String(row?.['\u63cf\u8ff0'] ?? '').trim();
    if (!titleValue) throw new Error('ZZZ readable reference contains an empty title');
    const exact = byFingerprint.get(`${zzzMatchText(titleValue)}|${zzzMatchText(description)}`) || [];
    if (exact.length === 1) {
      exactMatches += 1;
      matchedStableIds.add(exact[0]);
      continue;
    }
    const titleMatches = byTitle.get(zzzMatchText(titleValue)) || [];
    if (titleMatches.length === 1) {
      titleOnlyMatches += 1;
      matchedStableIds.add(titleMatches[0]);
      continue;
    }
    unmatchedReferenceTitles.push(titleValue);
  }
  const stableNonArcadeIds = [...stableById.values()].filter((row) => !row.arcade).map((row) => row.id);
  const unmatchedStableIds = stableNonArcadeIds
    .filter((id) => !matchedStableIds.has(id))
    .map(String)
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
  return {
    stableNonArcadeRows: stableNonArcadeIds.length,
    readableReferenceRows: readableRows.length,
    exactMatches,
    titleOnlyMatches,
    matchedReferenceRows: exactMatches + titleOnlyMatches,
    unmatchedReferenceRows: unmatchedReferenceTitles.length,
    unmatchedStableRows: unmatchedStableIds.length,
    unmatchedReferenceTitles: unmatchedReferenceTitles.sort((left, right) => left.localeCompare(right, 'zh-CN')),
    unmatchedStableIds,
  };
}

export function normalizeZzzCandidate(rows, options) {
  const {
    chineseRows = [],
    readableRows = [],
    ...envelopeOptions
  } = options;
  const byId = uniqueMap(rows, 'id', 'ZZZ achievements');
  if (chineseRows.length) {
    const chineseById = uniqueMap(chineseRows, 'id', 'ZZZ Chinese achievements');
    if (chineseById.size !== byId.size || [...byId.keys()].some((id) => !chineseById.has(id))) {
      throw new Error('ZZZ English and Chinese API snapshots do not contain the same stable IDs');
    }
  }
  const categoryTitles = new Map();
  for (const row of byId.values()) {
    const categoryId = String(integer(row.series, 'ZZZ series id'));
    const titleValue = text(row.series_name, 'ZZZ series name');
    const previous = categoryTitles.get(categoryId);
    if (previous && previous !== titleValue) throw new Error(`ZZZ series ${categoryId} has conflicting names`);
    categoryTitles.set(categoryId, titleValue);
  }
  const categories = [...categoryTitles.entries()].map(([id, titleValue], index) => categoryRow(id, titleValue, index));
  const achievements = [...byId.values()].map((row) => achievementRow({
    id: String(integer(row.id, 'ZZZ achievement id', { min: 1 })),
    title: row.name,
    description: row.description,
    categoryId: String(integer(row.series, 'ZZZ series id')),
    reward: integer(row.currency, 'ZZZ currency reward'),
    hidden: Boolean(row.hidden),
    version: row.version,
    progressModel: 'boolean',
    metadata: {
      arcade: Boolean(row.arcade),
      gacha: Boolean(row.gacha),
      missable: Boolean(row.missable),
      impossible: Boolean(row.impossible),
      timegated: row.timegated == null ? null : String(row.timegated),
      relatedIds: Array.isArray(row.related) ? row.related.map((id) => integer(id, 'ZZZ related id', { min: 1 })) : [],
    },
  }));
  const versions = [...new Set(achievements.map(({ version }) => version).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const reconciliation = reconcileZzzReference(chineseRows, readableRows);
  const releasedVersionProven = envelopeOptions.release != null;
  return candidateEnvelope({
    game: 'zzz',
    ...envelopeOptions,
    candidateCapabilities: {
      stableIds: true,
      englishText: true,
      categories: true,
      rewards: true,
      hiddenRules: true,
      icons: false,
      multiState: false,
      releasedVersionProven,
    },
    blockers: [
      'Category icons and their reviewed local provenance are missing.',
      'The complete 894-row snapshot still needs an in-game total and stable-ID reconciliation before publication.',
      'The complete-account import source is still unproven.',
    ],
    categories,
    achievements,
    metrics: {
      apiRows: achievements.length,
      arcadeRows: achievements.filter(({ metadata }) => metadata.arcade).length,
      hiddenRows: achievements.filter(({ hidden }) => hidden).length,
      missingVersionRows: achievements.filter(({ version }) => version == null).length,
      versions,
      reconciliation,
    },
  });
}

export function normalizeWuwaCandidate({
  achievements: rawAchievements,
  categories: rawCategories,
  groups: rawGroups,
  starLevels,
  englishTextRows = [],
  dropPackages = [],
  localizedLegacy = [],
}, options) {
  const {
    standardOnly = false,
    excludeUnlocalizedPlaceholders = false,
    releasedReference = null,
    ...envelopeOptions
  } = options;
  const achievementsById = uniqueMap(rawAchievements, 'Id', 'WuWa achievements');
  const categoriesById = uniqueMap(rawCategories, 'Id', 'WuWa categories');
  const groupsById = uniqueMap(rawGroups, 'Id', 'WuWa groups');
  const englishByKey = new Map();
  for (const row of englishTextRows) {
    const key = text(row?.Id, 'WuWa English text key');
    const value = String(row?.Content ?? '').trim();
    if (englishByKey.has(key) && englishByKey.get(key) !== value) {
      throw new Error(`WuWa English text key ${key} has conflicting values`);
    }
    englishByKey.set(key, value);
  }
  const dropPackagesById = uniqueMap(dropPackages, 'Id', 'WuWa drop packages');
  const rewardByLevel = new Map();
  for (const row of starLevels) {
    const level = integer(row.Level, 'WuWa star level', { min: 1 });
    if (rewardByLevel.has(level)) throw new Error(`WuWa star level ${level} is duplicated`);
    rewardByLevel.set(level, integer(row.DropId, 'WuWa star reward id'));
  }
  const includedCategoryIds = standardOnly
    ? WUWA_STANDARD_CATEGORY_IDS
    : new Set([...categoriesById.keys()]);
  const categories = [...categoriesById.values()]
    .filter((row) => includedCategoryIds.has(String(row.Id)))
    .map((row) => categoryRow(
    String(integer(row.Id, 'WuWa category id', { min: 1 })),
    englishByKey.get(String(row.Name || '').trim()) || null,
    integer(row.Id, 'WuWa category sort', { min: 1 }),
    false,
    row.TexturePath || row.SpritePath || null,
  ));
  const normalizedAchievements = [...achievementsById.values()].map((row) => {
    const groupId = String(integer(row.GroupId, 'WuWa group id', { min: 1 }));
    const group = groupsById.get(groupId);
    if (!group) throw new Error(`WuWa achievement ${row.Id} has unknown group ${groupId}`);
    const categoryId = String(integer(group.Category, 'WuWa group category id', { min: 1 }));
    if (!categoriesById.has(categoryId)) throw new Error(`WuWa group ${groupId} has unknown category ${categoryId}`);
    const level = integer(row.Level, 'WuWa achievement level', { min: 1 });
    const rewardDropId = Number(row.OverrideDropId) > 0
      ? integer(row.OverrideDropId, 'WuWa override reward id', { min: 1 })
      : rewardByLevel.get(level) ?? integer(group.DropId, 'WuWa group reward id');
    const dropPackage = dropPackagesById.get(String(rewardDropId));
    const rewardItems = (dropPackage?.DropPreview || []).map((entry) => ({
      itemId: integer(entry.Key, 'WuWa reward item id', { min: 1 }),
      amount: integer(entry.Value, 'WuWa reward item amount', { min: 1 }),
    }));
    const astriteReward = rewardItems.find(({ itemId }) => itemId === 3)?.amount ?? null;
    const titleKey = String(row.Name || '').trim() || null;
    const descriptionKey = String(row.Desc || '').trim() || null;
    const groupTitleKey = String(group.Name || '').trim() || null;
    const categoryTitleKey = String(categoriesById.get(categoryId).Name || '').trim() || null;
    const achievement = achievementRow({
      id: String(integer(row.Id, 'WuWa achievement id', { min: 1 })),
      title: titleKey ? englishByKey.get(titleKey) || null : null,
      description: descriptionKey ? englishByKey.get(descriptionKey) || null : null,
      categoryId,
      groupId,
      reward: astriteReward,
      hidden: Boolean(row.Hidden),
      iconPath: row.IconPath || group.Icon || group.SmallIcon || null,
      progressModel: 'boolean',
      metadata: {
        titleKey,
        descriptionKey,
        level,
        nextId: Number(row.NextLink) > 0 ? integer(row.NextLink, 'WuWa next achievement id', { min: 1 }) : null,
        groupEnabled: Boolean(group.Enable),
        groupTitleKey,
        groupTitle: groupTitleKey ? englishByKey.get(groupTitleKey) || null : null,
        categoryTitleKey,
        rewardDropId,
        rewardItems,
      },
    });
    return {
      achievement,
      includedCategory: includedCategoryIds.has(categoryId),
      localized: achievement.title != null || achievement.description != null,
    };
  });
  const standardRows = normalizedAchievements.filter(({ includedCategory }) => includedCategory);
  const achievements = standardRows
    .filter(({ localized }) => !excludeUnlocalizedPlaceholders || localized)
    .map(({ achievement }) => achievement);
  const legacyById = uniqueMap(localizedLegacy, 'id', 'WuWa legacy localization rows');
  const englishTextComplete = (
    categories.every(({ title: titleValue }) => titleValue != null)
    && achievements.every(({ title: titleValue, description }) => titleValue != null && description != null)
  );
  const rewardsComplete = achievements.every(({ metadata }) => metadata.rewardItems.length > 0);
  return candidateEnvelope({
    game: 'wuwa',
    ...envelopeOptions,
    candidateCapabilities: {
      stableIds: true,
      englishText: englishTextComplete,
      categories: true,
      rewards: rewardsComplete,
      hiddenRules: true,
      icons: true,
      multiState: false,
      releasedVersionProven: false,
    },
    blockers: [
      ...(!englishTextComplete ? ['Current English titles, descriptions, or category names are unresolved for some stable raw IDs.'] : []),
      ...(!rewardsComplete ? ['Some reward drop references are missing a concrete item-and-amount preview.'] : []),
      ...(releasedReference?.reconciliation?.candidateOnlyIds?.length
        || releasedReference?.reconciliation?.referenceOnlyIds?.length
        ? [
          `The reviewed ${releasedReference.dataVersion} pages expose ${releasedReference.reconciliation.expandedPageRows} stable IDs; `
          + `${releasedReference.reconciliation.candidateOnlyIds.length} candidate-only and `
          + `${releasedReference.reconciliation.referenceOnlyIds.length} reference-only IDs must be reconciled in-game.`,
        ]
        : releasedReference && releasedReference.total !== achievements.length
        ? [`The reviewed ${releasedReference.dataVersion} list has ${releasedReference.total} trophies, while the pinned candidate has ${achievements.length}; the ${Math.abs(achievements.length - releasedReference.total)}-row difference must be reconciled in-game.`]
        : ['The raw 3.5 branch still needs an in-game released-list count and field review.']),
      'The complete-account import source is still unproven.',
    ],
    categories,
    achievements,
    metrics: {
      stableRawRows: achievementsById.size,
      standardRawRows: standardRows.length,
      candidateRows: achievements.length,
      auxiliaryRowsExcluded: normalizedAchievements.length - standardRows.length,
      unlocalizedPlaceholderRowsExcluded: standardRows.length - achievements.length,
      releasedReference,
      localizedLegacyRows: legacyById.size,
      unresolvedEnglishRows: achievements.filter(({ title: titleValue }) => titleValue == null).length,
      unresolvedDescriptionRows: achievements.filter(({ description }) => description == null).length,
      unresolvedCategoryRows: categories.filter(({ title: titleValue }) => titleValue == null).length,
      missingTitleKeys: achievements.filter(({ metadata }) => metadata.titleKey == null).length,
      missingDescriptionKeys: achievements.filter(({ metadata }) => metadata.descriptionKey == null).length,
      missingRewardPackages: achievements.filter(({ metadata }) => metadata.rewardItems.length === 0).length,
      astriteRewardRows: achievements.filter(({ reward }) => reward != null).length,
      otherRewardRows: achievements.filter(({ reward, metadata }) => reward == null && metadata.rewardItems.length > 0).length,
      rawGroups: groupsById.size,
      rawCategories: categoriesById.size,
    },
  });
}

export function normalizeEndfieldCandidate(rows, options) {
  const byId = uniqueMap(rows, 'id', 'Endfield achievements');
  const categoryTitles = new Map();
  const categoryMeta = new Map();
  for (const row of byId.values()) {
    const id = text(row.category?.id, 'Endfield category id');
    const titleValue = text(row.category?.name, 'Endfield category name');
    const previous = categoryTitles.get(id);
    if (previous && previous !== titleValue) throw new Error(`Endfield category ${id} has conflicting names`);
    categoryTitles.set(id, titleValue);
    categoryMeta.set(id, {
      sort: integer(row.category?.priority, 'Endfield category priority'),
      hidden: Boolean(row.category?.hidden),
    });
  }
  const categories = [...categoryTitles.entries()].map(([id, titleValue]) => {
    const meta = categoryMeta.get(id);
    return categoryRow(id, titleValue, meta.sort, meta.hidden);
  });
  const achievements = [...byId.values()].map((row) => {
    if (!Array.isArray(row.levels) || !row.levels.length) throw new Error(`Endfield achievement ${row.id} has no levels`);
    const states = row.levels.map((state) => ({
      level: integer(state.level, 'Endfield achievement level', { min: 1 }),
      description: text(state.description, 'Endfield level description'),
      conditions: (state.conditions || []).map((condition) => ({
        id: text(condition.id, 'Endfield condition id'),
        description: text(condition.description, 'Endfield condition description'),
        target: integer(condition.target, 'Endfield condition target', { min: 1 }),
      })),
    })).sort((left, right) => left.level - right.level);
    if (states.some(({ conditions }) => !conditions.length)) throw new Error(`Endfield achievement ${row.id} has an empty level`);
    const initialLevel = integer(row.initialLevel, 'Endfield initial level', { min: 1 });
    const maxLevel = integer(row.maxLevel, 'Endfield max level', { min: 1 });
    if (states[0].level !== initialLevel || states.at(-1).level !== maxLevel) {
      throw new Error(`Endfield achievement ${row.id} level bounds do not match`);
    }
    return achievementRow({
      id: row.id,
      title: row.name,
      description: states.at(-1).description,
      categoryId: row.category.id,
      groupId: row.group?.id || null,
      reward: null,
      hidden: Boolean(row.category.hidden),
      progressModel: 'multi-state',
      states,
      metadata: {
        groupTitle: String(row.group?.name || '').trim(),
        canBePlated: booleanish(row.canBePlated, 'Endfield canBePlated'),
        canBeUpgraded: booleanish(row.canBeUpgraded, 'Endfield canBeUpgraded'),
        applyRareEffect: booleanish(row.applyRareEffect, 'Endfield applyRareEffect'),
        initialLevel,
        maxLevel,
        order: integer(row.order, 'Endfield achievement order'),
      },
    });
  });
  return candidateEnvelope({
    game: 'ae',
    ...options,
    candidateCapabilities: {
      stableIds: true,
      englishText: true,
      categories: true,
      rewards: false,
      hiddenRules: true,
      icons: false,
      multiState: true,
      releasedVersionProven: false,
    },
    blockers: [
      'Medal and category icons plus reviewed local provenance are missing.',
      'Reward values are not present in the candidate source.',
      'A real account must prove how level, plating, and rare-effect progress are reported.',
      'The fixture-backed v2 draft is synthetic; a real exported payload must prove its field meanings before release.',
    ],
    categories,
    achievements,
    metrics: {
      apiRows: achievements.length,
      levelRows: achievements.reduce((sum, row) => sum + row.states.length, 0),
      platedRows: achievements.filter(({ metadata }) => metadata.canBePlated).length,
      upgradedRows: achievements.filter(({ metadata }) => metadata.canBeUpgraded).length,
      rareEffectRows: achievements.filter(({ metadata }) => metadata.applyRareEffect).length,
    },
  });
}

function endfieldLocalizedText(value, label, { nullable = false } = {}) {
  const localized = value && typeof value === 'object' ? value.en : value;
  if ((localized == null || String(localized).trim() === '') && nullable) return null;
  return text(localized, label);
}

function endfieldProfileByStableId(profileMedals) {
  if (!profileMedals || typeof profileMedals !== 'object' || Array.isArray(profileMedals)) {
    throw new Error('Endfield profile medals are invalid');
  }
  const byStableId = new Map();
  for (const [profileId, medal] of Object.entries(profileMedals)) {
    const iconByLevel = medal?.IconByLevel;
    if (!iconByLevel || typeof iconByLevel !== 'object' || Array.isArray(iconByLevel)) {
      throw new Error(`Endfield profile medal ${profileId} has no icons`);
    }
    const stableIds = new Set(Object.values(iconByLevel).map((iconPath) => {
      const match = String(iconPath).match(/\/([^/]+)_lv\d+\.png$/i);
      if (!match) throw new Error(`Endfield profile medal ${profileId} has an invalid icon path`);
      return match[1];
    }));
    if (stableIds.size !== 1) throw new Error(`Endfield profile medal ${profileId} maps to multiple achievements`);
    const [stableId] = stableIds;
    if (byStableId.has(stableId)) throw new Error(`Endfield profile medals duplicate ${stableId}`);
    byStableId.set(stableId, {
      profileId: text(profileId, 'Endfield profile medal id'),
      iconByLevel: Object.fromEntries(Object.entries(iconByLevel)
        .map(([level, iconPath]) => [
          String(integer(level, 'Endfield profile medal icon level', { min:1 })),
          text(iconPath, 'Endfield profile medal icon path'),
        ])
        .sort(([left], [right]) => Number(left) - Number(right))),
    });
  }
  return byStableId;
}

function endfieldTimeValue(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`${label} is invalid`);
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${second}`;
}

function endfieldAvailability(displayTimeId, timeRanges, referenceTime) {
  if (!displayTimeId) return { status:'always', ranges:[] };
  const record = timeRanges?.[displayTimeId];
  if (!record || !Array.isArray(record.timeRangeList) || !record.timeRangeList.length) {
    return { status:'unknown', ranges:[] };
  }
  const ranges = record.timeRangeList.map((range, index) => ({
    openTime: endfieldTimeValue(range?.openTime, `Endfield time range ${displayTimeId} open time ${index}`),
    closeTime: endfieldTimeValue(range?.closeTime, `Endfield time range ${displayTimeId} close time ${index}`),
  }));
  if (ranges.some(({ openTime }) => openTime == null)) return { status:'unknown', ranges };

  const reference = new Date(referenceTime).toISOString().slice(0, 19);
  const openTimes = ranges.map(({ openTime }) => openTime);
  const closeTimes = ranges.map(({ closeTime }) => closeTime).filter(Boolean);
  if (openTimes.every((openTime) => openTime > reference)) return { status:'future', ranges };
  if (openTimes.every((openTime) => openTime <= reference)) {
    if (closeTimes.length === ranges.length && closeTimes.every((closeTime) => closeTime <= reference)) {
      return { status:'closed', ranges };
    }
    return { status:'released', ranges };
  }
  return { status:'regional', ranges };
}

export function normalizeEndfieldClientCandidate(raw, options) {
  const { generatedAt, ...envelopeOptions } = options;
  const achievementRows = Object.values(raw?.achievements || {});
  const typeRows = Object.values(raw?.types || {});
  const profileTooltip = raw?.profileTooltip;
  if (!achievementRows.length || !typeRows.length) throw new Error('Endfield client tables are empty');
  if (!profileTooltip || typeof profileTooltip !== 'object' || Array.isArray(profileTooltip)) {
    throw new Error('Endfield profile tooltip is invalid');
  }

  const achievementsById = uniqueMap(achievementRows, 'achieveId', 'Endfield client achievements');
  const typesById = uniqueMap(typeRows, 'categoryId', 'Endfield client categories');
  const profileByStableId = endfieldProfileByStableId(raw.profileMedals);
  const groupToCategory = new Map();
  const groupTitles = new Map();
  const categories = [...typesById.values()].map((row) => {
    const categoryId = text(row.categoryId, 'Endfield client category id');
    const categoryTitle = endfieldLocalizedText(
      row.categoryName,
      'Endfield client category title',
    );
    for (const group of row.achievementGroupData || []) {
      const groupId = text(group.groupId, 'Endfield client group id');
      if (groupToCategory.has(groupId)) throw new Error(`Endfield client group ${groupId} is duplicated`);
      groupToCategory.set(groupId, categoryId);
      groupTitles.set(
        groupId,
        endfieldLocalizedText(
          group.groupName,
          'Endfield client group title',
          { nullable:true },
        ) || categoryTitle,
      );
    }
    return categoryRow(
      categoryId,
      categoryTitle,
      integer(row.categoryPriority, 'Endfield client category priority'),
      categoryId === 'achv_type_hide',
    );
  });

  const achievements = [...achievementsById.values()].map((row) => {
    const stableId = text(row.achieveId, 'Endfield client achievement id');
    const groupId = text(row.groupId, 'Endfield client achievement group id');
    const categoryId = groupToCategory.get(groupId);
    if (!categoryId) throw new Error(`Endfield client achievement ${stableId} has an unknown group`);
    const profile = profileByStableId.get(stableId);
    if (!profile) throw new Error(`Endfield client achievement ${stableId} has no profile mapping`);
    const tooltip = profileTooltip[profile.profileId];
    if (!tooltip) throw new Error(`Endfield client achievement ${stableId} has no English profile tooltip`);
    const levelInfos = Object.values(row.levelInfos || {});
    if (!levelInfos.length) throw new Error(`Endfield client achievement ${stableId} has no levels`);
    const states = levelInfos.map((state) => ({
      level: integer(state.achieveLevel, 'Endfield client achievement level', { min:1 }),
      description: endfieldLocalizedText(
        state.completeDesc,
        'Endfield client achievement completion description',
      ),
      conditions: (state.conditions || []).map((condition) => ({
        id: text(condition.conditionId, 'Endfield client achievement condition id'),
        description: endfieldLocalizedText(
          condition.desc,
          'Endfield client achievement condition description',
        ),
        target: integer(
          condition.progressToCompare,
          'Endfield client achievement condition target',
          { min:1 },
        ),
      })),
    })).sort((left, right) => left.level - right.level);
    if (states.some(({ conditions }) => !conditions.length)) {
      throw new Error(`Endfield client achievement ${stableId} has an empty level`);
    }
    const initialLevel = integer(row.initLevel, 'Endfield client initial level', { min:1 });
    const maxLevel = states.at(-1).level;
    if (states[0].level !== initialLevel) {
      throw new Error(`Endfield client achievement ${stableId} level bounds do not match`);
    }
    const maxIconPath = profile.iconByLevel[String(maxLevel)]
      || profile.iconByLevel[Object.keys(profile.iconByLevel).at(-1)];
    const displayTimeId = String(row.displayTimeId || '').trim() || null;
    const availability = endfieldAvailability(displayTimeId, raw.timeRanges, generatedAt);
    return achievementRow({
      id: stableId,
      title: endfieldLocalizedText(row.name, 'Endfield client achievement title'),
      description: endfieldLocalizedText(
        row.desc,
        'Endfield client achievement description',
        { nullable:true },
      ) || states.at(-1).description,
      categoryId,
      groupId,
      reward: null,
      hidden: categoryId === 'achv_type_hide',
      iconPath: maxIconPath,
      progressModel: 'multi-state',
      states,
      metadata: {
        groupTitle: groupTitles.get(groupId),
        canBePlated: booleanish(row.canBePlated, 'Endfield canBePlated'),
        canBeUpgraded: booleanish(row.canBeUpgraded, 'Endfield canBeUpgraded'),
        applyRareEffect: booleanish(row.applyRareEffect, 'Endfield applyRareEffect'),
        specialProgress: booleanish(row.specialProgress, 'Endfield specialProgress'),
        initialLevel,
        maxLevel,
        order: integer(row.order, 'Endfield achievement order'),
        displayTimeId,
        availability: availability.status,
        displayTimeRanges: availability.ranges,
        rewardModel: 'none',
        profileMedalId: profile.profileId,
        profileName: text(tooltip.Name, 'Endfield profile medal name'),
        profileIconByLevel: profile.iconByLevel,
        profileConditionByLevel: Object.fromEntries(Object.entries(tooltip.LevelInfos || {})
          .map(([level, value]) => [
            String(integer(level, 'Endfield profile tooltip level', { min:1 })),
            text(value.ConditionDesc, 'Endfield profile tooltip condition'),
          ])
          .sort(([left], [right]) => Number(left) - Number(right))),
      },
    });
  });

  if (profileByStableId.size !== achievements.length) {
    throw new Error('Endfield profile mapping contains achievements missing from the client table');
  }
  return candidateEnvelope({
    game: 'ae',
    generatedAt,
    ...envelopeOptions,
    candidateCapabilities: {
      stableIds: true,
      englishText: true,
      categories: true,
      rewards: true,
      hiddenRules: true,
      icons: true,
      multiState: true,
      releasedVersionProven: false,
    },
    blockers: [
      ...(achievements.some(({ metadata }) => metadata.availability === 'future')
        ? [`The client schedule marks ${achievements.filter(({ metadata }) => metadata.availability === 'future').length} medals as future content; they must remain outside a released catalog until their open dates and in-game visibility are verified.`]
        : []),
      ...(achievements.some(({ metadata }) => ['unknown', 'regional'].includes(metadata.availability))
        ? ['Some time-gated medals still lack an unambiguous release schedule.']
        : []),
      'A real complete-account payload must prove how medal level, condition progress, plating, rare effects, and timestamps map to the profile medal IDs.',
    ],
    categories,
    achievements,
    metrics: {
      clientRows: achievements.length,
      profileMedalRows: profileByStableId.size,
      profileMappedRows: achievements.filter(({ metadata }) => metadata.profileMedalId != null).length,
      levelRows: achievements.reduce((sum, row) => sum + row.states.length, 0),
      timeGatedRows: achievements.filter(({ metadata }) => metadata.displayTimeId != null).length,
      releasedTimeGatedRows: achievements.filter(({ metadata }) => metadata.availability === 'released').length,
      futureTimeGatedRows: achievements.filter(({ metadata }) => metadata.availability === 'future').length,
      closedTimeGatedRows: achievements.filter(({ metadata }) => metadata.availability === 'closed').length,
      unresolvedTimeGatedRows: achievements.filter(({ metadata }) => ['unknown', 'regional'].includes(metadata.availability)).length,
      platedRows: achievements.filter(({ metadata }) => metadata.canBePlated).length,
      upgradedRows: achievements.filter(({ metadata }) => metadata.canBeUpgraded).length,
      rareEffectRows: achievements.filter(({ metadata }) => metadata.applyRareEffect).length,
      specialProgressRows: achievements.filter(({ metadata }) => metadata.specialProgress).length,
      noRewardRows: achievements.filter(({ metadata }) => metadata.rewardModel === 'none').length,
    },
  });
}

export function validateAchievementCandidate(candidate) {
  if (candidate?.schemaVersion !== 1 || !GAME_KEYS.has(candidate.game)) throw new Error('Achievement candidate envelope is invalid');
  if (candidate.status !== 'candidate' || candidate.publishable !== false) throw new Error('Achievement candidate must remain unpublished');
  iso(candidate.generatedAt, `${candidate.game} candidate generatedAt`);
  sourceMetadata(candidate.source);
  const release = releaseMetadata(candidate.release, candidate.game);
  const candidateCapabilities = capabilities(candidate.capabilities);
  if (candidateCapabilities.releasedVersionProven !== (release != null)) {
    throw new Error('Candidate release evidence does not match its capability');
  }
  if (!Array.isArray(candidate.blockers) || !candidate.blockers.length) throw new Error('Achievement candidate blockers are missing');
  const categories = uniqueMap(candidate.categories, 'id', `${candidate.game} candidate categories`);
  const achievements = uniqueMap(candidate.achievements, 'id', `${candidate.game} candidate achievements`);
  if (candidate.categoryCount !== categories.size || candidate.achievementCount !== achievements.size) {
    throw new Error('Achievement candidate counts do not match');
  }
  for (const row of achievements.values()) {
    if (!categories.has(String(row.categoryId))) throw new Error(`${candidate.game} candidate achievement ${row.id} has an unknown category`);
    if (!PROGRESS_MODELS.has(row.progressModel)) throw new Error(`${candidate.game} candidate progress model is invalid`);
    if (!Array.isArray(row.states)) throw new Error(`${candidate.game} candidate states are invalid`);
    if (row.progressModel === 'boolean' && row.states.length) throw new Error(`${candidate.game} boolean candidate has multi-state rows`);
    if (row.progressModel === 'multi-state' && !row.states.length) throw new Error(`${candidate.game} multi-state candidate has no states`);
    if (candidateCapabilities.englishText && !String(row.title || '').trim()) {
      throw new Error(`${candidate.game} candidate is missing English text`);
    }
    if (
      release
      && row.version != null
      && compareVersions(
        numericVersion(row.version, `${candidate.game} achievement ${row.id} version`),
        numericVersion(release.version, `${candidate.game} candidate release version`),
      ) > 0
    ) {
      throw new Error(`${candidate.game} candidate achievement ${row.id} is newer than the proven release`);
    }
  }
  return candidate;
}

export function createAchievementCandidateReport(candidates, { generatedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(candidates) || candidates.length !== GAME_KEYS.size) {
    throw new Error('Achievement candidate report needs all unreleased games');
  }
  const byGame = uniqueMap(candidates, 'game', 'Achievement candidates');
  for (const game of GAME_KEYS) if (!byGame.has(game)) throw new Error(`Achievement candidate report is missing ${game}`);
  const games = [...byGame.values()]
    .map((candidate) => {
      validateAchievementCandidate(candidate);
      return {
        game: candidate.game,
        status: 'blocked',
        publishable: false,
        categoryCount: candidate.categoryCount,
        achievementCount: candidate.achievementCount,
        capabilities: candidate.capabilities,
        blockers: candidate.blockers,
        release: candidate.release,
        sourceRevision: candidate.source.revision,
        sourceSnapshotSha256: candidate.source.snapshotSha256,
      };
    })
    .sort((left, right) => left.game.localeCompare(right.game, 'en'));
  return {
    schemaVersion: 1,
    generatedAt: iso(generatedAt, 'Achievement candidate report generatedAt'),
    publishable: false,
    games,
  };
}
