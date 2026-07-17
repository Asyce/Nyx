const SAFE_TEXT_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const VERSION_PATTERN = /^\d+\.\d+$/;
const ICON_PATH_PATTERN = /^\/assets\/achievements\/(gi|hsr)\/(categories|rewards)\/([a-f0-9]{64})\.(png|webp)$/;

export const CATALOG_SCHEMA_VERSION = 1;
export const RELEASED_VERSIONS = Object.freeze({ gi: '6.7', hsr: '4.3' });
export const ACHIEVEMENT_ICON_MAX_BYTES = 256 * 1024;
export const ACHIEVEMENT_ICON_MIN_DIMENSION = 32;
export const ACHIEVEMENT_ICON_MAX_DIMENSION = 512;

export const SOURCES = Object.freeze({
  gi: {
    name: 'Paimon.moe achievement data',
    repository: 'https://github.com/MadeBaruna/paimon-moe',
    repositoryPath: 'src/data/achievement/en.json',
    dataUrl: 'https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/achievement/en.json',
    license: 'MIT',
    licenseUrl: 'https://github.com/MadeBaruna/paimon-moe/blob/main/LICENSE',
  },
  hsr: {
    name: 'starrail-data achievement data',
    repository: 'https://github.com/theBowja/starrail-data',
    repositoryPath: 'data/EN/achievements.json',
    dataUrl: 'https://raw.githubusercontent.com/theBowja/starrail-data/main/data/EN/achievements.json',
    license: 'MIT',
    licenseUrl: 'https://github.com/theBowja/starrail-data/blob/main/LICENSE',
  },
});

export function compareVersions(left, right) {
  const a = parseVersion(left, 'left version');
  const b = parseVersion(right, 'right version');
  return a[0] - b[0] || a[1] - b[1];
}

function parseVersion(value, label) {
  const text = String(value ?? '').trim();
  if (!VERSION_PATTERN.test(text)) throw new Error(`${label} must look like 6.7, received ${JSON.stringify(value)}`);
  return text.split('.').map(Number);
}

function requiredText(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const text = value
    .replace(/<color(?:=[^>]*)?>/gi, '')
    .replace(/<\/color>/gi, '')
    .replace(/<\/?(?:i|u|unbreak)>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) throw new Error(`${label} is empty`);
  if (SAFE_TEXT_CONTROLS.test(text) || /<[^>]*>/.test(text) || /\{[^{}]{1,80}\}/.test(text)) throw new Error(`${label} contains unsafe markup, placeholders, or control characters`);
  return text;
}

function resolvedHsrText(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const resolved = value
    .replace(/(?:\{LAYOUT_(?:MOBILE|CONTROLLER|KEYBOARD)#[^}]+\})+/g, 'Interact')
    .replace(/\bInteract\s+on\b/g, 'Interact with')
    .replace(/\{NICKNAME\}/g, 'Trailblazer')
    .replace(/\{TEXTJOIN#54\}/g, 'Warp Trotter')
    .replace(/\{TEXTJOIN#87\}/g, 'the Radiant Feldspar');
  return requiredText(resolved, label);
}

function requiredId(value, label) {
  const id = String(value ?? '').trim();
  if (!/^\d+$/.test(id)) throw new Error(`${label} must contain digits only`);
  return id;
}

function finiteInteger(value, label, { minimum = 0 } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) throw new Error(`${label} must be an integer of at least ${minimum}`);
  return number;
}

export function makeMonogram(name) {
  const words = requiredText(name, 'category name')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const useful = words.filter((word) => !['a', 'an', 'and', 'in', 'of', 'the', 'to'].includes(word.toLowerCase()));
  const picked = useful.length ? useful : words;
  return picked.slice(0, 2).map((word) => [...word][0]).join('').toLocaleUpperCase('en-US').slice(0, 2) || '?';
}

function iconMappingEntries(categoryIcons) {
  if (categoryIcons == null) return [];
  if (categoryIcons instanceof Map) return [...categoryIcons.entries()];
  if (typeof categoryIcons === 'object' && !Array.isArray(categoryIcons)) return Object.entries(categoryIcons);
  throw new Error('category icon mapping must be a Map or object');
}

function applyCategoryIcons(categories, categoryIcons) {
  const entries = iconMappingEntries(categoryIcons);
  if (!entries.length) return categories;
  const categoryIds = new Set(categories.map(({ id }) => id));
  for (const [categoryId] of entries) {
    if (!categoryIds.has(categoryId)) throw new Error(`category icon mapping references missing or unreleased category ${categoryId}`);
  }
  const icons = new Map(entries);
  return categories.map((category) => icons.has(category.id) ? { ...category, icon:icons.get(category.id) } : category);
}

export function achievementIconFilename(game, iconPath, kind = null) {
  const match = ICON_PATH_PATTERN.exec(String(iconPath ?? ''));
  if (!match || match[1] !== game || (kind && match[2] !== kind)) throw new Error(`achievement icon path is invalid for ${game}`);
  return `${match[3]}.${match[4]}`;
}

function validateIconDescriptor(icon, game, kind, label) {
  if (!icon || typeof icon !== 'object' || Array.isArray(icon)) throw new Error(`${label} icon is invalid`);
  const keys = Object.keys(icon).sort().join(',');
  if (keys !== 'kind,path,sourceKey') throw new Error(`${label} icon has unexpected fields`);
  if (icon.kind !== 'image') throw new Error(`${label} icon kind must be image`);
  achievementIconFilename(game, icon.path, kind);
  const sourceKey = String(icon.sourceKey ?? '').trim();
  if (!sourceKey || sourceKey.length > 180 || SAFE_TEXT_CONTROLS.test(sourceKey) || /[<>]/.test(sourceKey) || /^https?:/i.test(sourceKey)) throw new Error(`${label} icon sourceKey is invalid`);
  return icon;
}

function readUint24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(bytes) {
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(signature)) throw new Error('achievement icon is not a valid PNG container');
  let offset = 8;
  let width;
  let height;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = offset + 8;
    const checksum = data + size;
    const next = checksum + 4;
    if (next > bytes.length) throw new Error('achievement PNG has a truncated chunk');
    if (bytes.readUInt32BE(checksum) !== crc32(bytes.subarray(offset + 4, checksum))) throw new Error(`achievement PNG ${type || '?'} checksum is invalid`);
    if (!sawHeader) {
      if (type !== 'IHDR' || size !== 13) throw new Error('achievement PNG must start with IHDR');
      width = bytes.readUInt32BE(data);
      height = bytes.readUInt32BE(data + 4);
      const bitDepth = bytes[data + 8];
      const colorType = bytes[data + 9];
      const allowedDepths = { 0:[1,2,4,8,16], 2:[8,16], 3:[1,2,4,8], 4:[8,16], 6:[8,16] };
      if (!allowedDepths[colorType]?.includes(bitDepth) || bytes[data + 10] !== 0 || bytes[data + 11] !== 0 || ![0,1].includes(bytes[data + 12])) throw new Error('achievement PNG header is invalid');
      sawHeader = true;
    } else if (type === 'IHDR') {
      throw new Error('achievement PNG has more than one IHDR');
    }
    if (type === 'IDAT') sawImageData = true;
    if (type === 'IEND') {
      if (size !== 0 || !sawImageData || next !== bytes.length) throw new Error('achievement PNG ending is invalid');
      sawEnd = true;
      break;
    }
    offset = next;
  }
  if (!sawHeader || !sawImageData || !sawEnd) throw new Error('achievement PNG is incomplete');
  return { width, height };
}

function inspectWebp(bytes) {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') throw new Error('achievement icon is not a valid WebP container');
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('achievement WebP container size is invalid');
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + size > bytes.length) throw new Error('achievement WebP has a truncated chunk');
    if (type === 'VP8X' && size >= 10) return { width:1 + readUint24LE(bytes, data + 4), height:1 + readUint24LE(bytes, data + 7) };
    if (type === 'VP8 ' && size >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      return { width:bytes.readUInt16LE(data + 6) & 0x3fff, height:bytes.readUInt16LE(data + 8) & 0x3fff };
    }
    if (type === 'VP8L' && size >= 5 && bytes[data] === 0x2f) {
      const b1 = bytes[data + 1], b2 = bytes[data + 2], b3 = bytes[data + 3], b4 = bytes[data + 4];
      return { width:1 + b1 + ((b2 & 0x3f) << 8), height:1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10) };
    }
    offset = data + size + (size % 2);
  }
  throw new Error('achievement WebP has no supported dimensions');
}

export function inspectAchievementIconBytes(input, { maxBytes = ACHIEVEMENT_ICON_MAX_BYTES } = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input ?? []);
  if (!bytes.length || bytes.length > maxBytes) throw new Error(`achievement icon must be between 1 and ${maxBytes} bytes`);
  let mediaType;
  let width;
  let height;
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    mediaType = 'image/png';
    ({ width, height } = inspectPng(bytes));
  } else {
    mediaType = 'image/webp';
    ({ width, height } = inspectWebp(bytes));
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < ACHIEVEMENT_ICON_MIN_DIMENSION || height < ACHIEVEMENT_ICON_MIN_DIMENSION || width > ACHIEVEMENT_ICON_MAX_DIMENSION || height > ACHIEVEMENT_ICON_MAX_DIMENSION) {
    throw new Error(`achievement icon dimensions ${width}x${height} are outside the safe ceiling`);
  }
  return { mediaType, width, height, bytes:bytes.length };
}

function sourceEnvelope(game, options) {
  const source = SOURCES[game];
  const commit = requiredText(options.sourceCommit ?? 'fixture', 'source commit');
  const pinnedDataUrl = commit === 'fixture'
    ? source.dataUrl
    : source.dataUrl.replace('/main/', `/${commit}/`);
  return {
    name: source.name,
    repository: source.repository,
    dataUrl: pinnedDataUrl,
    license: source.license,
    licenseUrl: source.licenseUrl,
    commit,
  };
}

function catalogEnvelope(game, options, categories, achievements) {
  const releasedVersion = options.releasedVersion ?? RELEASED_VERSIONS[game];
  parseVersion(releasedVersion, `${game} release ceiling`);
  const generatedAt = new Date(options.generatedAt ?? Date.now()).toISOString();
  const dataTimestamp = new Date(options.dataTimestamp ?? generatedAt).toISOString();
  const catalog = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    game,
    catalogVersion: releasedVersion,
    releasedVersion,
    generatedAt,
    dataTimestamp,
    source: sourceEnvelope(game, options),
    categoryCount: categories.length,
    achievementCount: achievements.length,
    count: achievements.length,
    categories,
    achievements,
  };
  if (options.rewardCurrency) catalog.rewardCurrency = options.rewardCurrency;
  return catalog;
}

export function assertCatalogNotCollapsed(next, previous, minimumRatio = 0.8) {
  if (!previous || previous.game !== next?.game || !Array.isArray(previous.achievements)) return next;
  if (!(minimumRatio > 0 && minimumRatio <= 1)) throw new Error('catalog shrink ratio is invalid');
  const minimum = Math.ceil(previous.achievements.length * minimumRatio);
  if (next.achievements.length < minimum) throw new Error(`${next.game} catalog collapsed from ${previous.achievements.length} to ${next.achievements.length}; minimum safe count is ${minimum}`);
  return next;
}

function walkGiAchievementGroups(groups, visit, label) {
  if (!Array.isArray(groups)) throw new Error(`${label}.achievements must be an array`);
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const stages = Array.isArray(group) ? group : [group];
    if (!stages.length) throw new Error(`${label}.achievements[${groupIndex}] is an empty stage group`);
    for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
      visit(stages[stageIndex], { groupIndex, stageIndex, stageCount: stages.length });
    }
  }
}

export function normalizeGiCatalog(raw, options = {}) {
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw new Error('GI source must be a numbered category object');
  const releasedVersion = options.releasedVersion ?? RELEASED_VERSIONS.gi;
  parseVersion(releasedVersion, 'GI release ceiling');
  const categories = [];
  const achievements = [];
  const seenIds = new Set();

  const entries = Object.entries(raw).sort(([left], [right]) => Number(left) - Number(right));
  for (const [sourceCategoryId, category] of entries) {
    if (!/^\d+$/.test(sourceCategoryId) || !category || typeof category !== 'object') {
      throw new Error(`GI category key ${JSON.stringify(sourceCategoryId)} is invalid`);
    }
    const name = requiredText(category.name, `GI category ${sourceCategoryId} name`);
    const categoryId = `gi-${sourceCategoryId}`;
    const categorySortOrder = finiteInteger(category.order, `GI category ${sourceCategoryId} order`);
    categories.push({
      id: categoryId,
      sourceId: sourceCategoryId,
      name,
      sortOrder: categorySortOrder,
      symbol: { kind: 'monogram', value: makeMonogram(name) },
    });

    walkGiAchievementGroups(category.achievements, (record, stage) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`GI category ${sourceCategoryId} has an invalid achievement`);
      const id = requiredId(record.id, `GI achievement id in category ${sourceCategoryId}`);
      if (seenIds.has(id)) throw new Error(`duplicate achievement id ${id}`);
      seenIds.add(id);
      const version = String(record.ver ?? '').trim();
      parseVersion(version, `GI achievement ${id} version`);
      const name = requiredText(record.name, `GI achievement ${id} name`);
      const description = requiredText(record.desc, `GI achievement ${id} description`);
      const reward = finiteInteger(record.reward, `GI achievement ${id} reward`, { minimum: 1 });
      if (compareVersions(version, releasedVersion) > 0) return;
      achievements.push({
        id,
        categoryId,
        name,
        description,
        reward,
        version,
        stage: stage.stageIndex + 1,
        stageCount: stage.stageCount,
        sortOrder: stage.groupIndex,
      });
    }, `GI category ${sourceCategoryId}`);
  }

  const usedCategoryIds = new Set(achievements.map(({ categoryId }) => categoryId));
  const releasedCategories = categories.filter(({ id }) => usedCategoryIds.has(id)).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const categoryOrder = new Map(releasedCategories.map((category) => [category.id, category.sortOrder]));
  achievements.sort((a, b) => categoryOrder.get(a.categoryId) - categoryOrder.get(b.categoryId) || a.sortOrder - b.sortOrder || a.stage - b.stage || a.id.localeCompare(b.id));
  return validateCatalog(catalogEnvelope('gi', { ...options, releasedVersion }, applyCategoryIcons(releasedCategories, options.categoryIcons), achievements));
}

export function normalizeHsrCatalog(raw, options = {}) {
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw new Error('HSR source must be an ID-keyed object');
  const releasedVersion = options.releasedVersion ?? RELEASED_VERSIONS.hsr;
  parseVersion(releasedVersion, 'HSR release ceiling');
  const categoriesById = new Map();
  const achievements = [];
  const seenIds = new Set();
  const allowedRarities = new Set(['Low', 'Mid', 'High']);
  const rewardByRarity = { Low: 5, Mid: 10, High: 20 };

  for (const [sourceKey, record] of Object.entries(raw)) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`HSR achievement ${sourceKey} is invalid`);
    const id = requiredId(record.Id, `HSR achievement ${sourceKey} id`);
    if (id !== String(sourceKey)) throw new Error(`HSR achievement key ${sourceKey} does not match Id ${id}`);
    if (seenIds.has(id)) throw new Error(`duplicate achievement id ${id}`);
    seenIds.add(id);
    const version = String(record.VersionAdded ?? '').trim();
    parseVersion(version, `HSR achievement ${id} version`);
    const name = resolvedHsrText(record.Name, `HSR achievement ${id} name`);
    const description = resolvedHsrText(record.Description, `HSR achievement ${id} description`);
    const seriesId = requiredId(record.SeriesId, `HSR achievement ${id} series id`);
    const categoryName = requiredText(record.SeriesText, `HSR achievement ${id} series name`);
    const rarity = requiredText(record.Rarity, `HSR achievement ${id} rarity`);
    if (!allowedRarities.has(rarity)) throw new Error(`HSR achievement ${id} has unsupported rarity ${rarity}`);
    const sortOrder = finiteInteger(record.SortOrder, `HSR achievement ${id} sort order`);
    if (compareVersions(version, releasedVersion) > 0) continue;

    const categoryId = `hsr-${seriesId}`;
    const existingCategory = categoriesById.get(categoryId);
    if (existingCategory && existingCategory.name !== categoryName) {
      throw new Error(`HSR series ${seriesId} has conflicting names`);
    }
    if (!existingCategory) {
      categoriesById.set(categoryId, {
        id: categoryId,
        sourceId: seriesId,
        name: categoryName,
        sortOrder: Number(seriesId),
        symbol: { kind: 'monogram', value: makeMonogram(categoryName) },
      });
    }
    achievements.push({ id, categoryId, name, description, reward:rewardByRarity[rarity], rarity, version, sortOrder });
  }

  const categories = [...categoriesById.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  achievements.sort((a, b) => {
    const categoryDelta = Number(a.categoryId.slice(4)) - Number(b.categoryId.slice(4));
    return categoryDelta || b.sortOrder - a.sortOrder || a.id.localeCompare(b.id);
  });
  return validateCatalog(catalogEnvelope('hsr', { ...options, releasedVersion }, applyCategoryIcons(categories, options.categoryIcons), achievements));
}

export function validateCatalog(catalog) {
  if (!catalog || catalog.schemaVersion !== CATALOG_SCHEMA_VERSION) throw new Error('catalog schemaVersion is invalid');
  if (!Object.hasOwn(RELEASED_VERSIONS, catalog.game)) throw new Error(`catalog game ${catalog.game} is invalid`);
  if (catalog.releasedVersion !== RELEASED_VERSIONS[catalog.game]) throw new Error(`catalog release ceiling must be ${RELEASED_VERSIONS[catalog.game]}`);
  if (catalog.catalogVersion !== catalog.releasedVersion) throw new Error('catalogVersion must match releasedVersion');
  parseVersion(catalog.releasedVersion, 'catalog release ceiling');
  if (!Number.isFinite(Date.parse(catalog.generatedAt)) || !Number.isFinite(Date.parse(catalog.dataTimestamp))) throw new Error('catalog timestamps are invalid');
  if (!catalog.source?.dataUrl || !catalog.source?.repository || catalog.source?.license !== 'MIT' || !catalog.source?.commit) throw new Error('catalog source provenance is incomplete');
  if (!Array.isArray(catalog.categories) || !catalog.categories.length) throw new Error('catalog categories are empty');
  if (!Array.isArray(catalog.achievements) || !catalog.achievements.length) throw new Error('catalog achievements are empty');
  if (catalog.categoryCount !== catalog.categories.length || catalog.achievementCount !== catalog.achievements.length || catalog.count !== catalog.achievements.length) throw new Error('catalog count metadata is inconsistent');

  const categoryIds = new Set();
  const categoryIconPaths = new Set();
  const categoryIconSourceKeys = new Set();
  let categoryIconCount = 0;
  for (const category of catalog.categories) {
    if (!category?.id || categoryIds.has(category.id)) throw new Error(`duplicate or missing category id ${category?.id}`);
    categoryIds.add(category.id);
    requiredText(category.name, `category ${category.id} name`);
    if (category.symbol?.kind !== 'monogram' || !/^[\p{L}\p{N}]{1,2}$/u.test(category.symbol?.value ?? '')) throw new Error(`category ${category.id} symbol is invalid`);
    if (category.icon) {
      validateIconDescriptor(category.icon, catalog.game, 'categories', `category ${category.id}`);
      if (categoryIconPaths.has(category.icon.path)) throw new Error(`duplicate category icon path ${category.icon.path}`);
      if (categoryIconSourceKeys.has(category.icon.sourceKey)) throw new Error(`duplicate category icon sourceKey ${category.icon.sourceKey}`);
      categoryIconPaths.add(category.icon.path);
      categoryIconSourceKeys.add(category.icon.sourceKey);
      categoryIconCount += 1;
    }
  }
  if (categoryIconCount && categoryIconCount !== catalog.categories.length) throw new Error(`catalog category icon coverage is incomplete (${categoryIconCount}/${catalog.categories.length})`);

  if (catalog.rewardCurrency != null) {
    if (!catalog.rewardCurrency || typeof catalog.rewardCurrency !== 'object' || Array.isArray(catalog.rewardCurrency) || Object.keys(catalog.rewardCurrency).sort().join(',') !== 'icon,name') throw new Error('catalog rewardCurrency is invalid');
    requiredText(catalog.rewardCurrency.name, 'catalog reward currency name');
    validateIconDescriptor(catalog.rewardCurrency.icon, catalog.game, 'rewards', 'catalog reward currency');
  }

  const ids = new Set();
  for (const achievement of catalog.achievements) {
    const id = requiredId(achievement?.id, 'catalog achievement id');
    if (ids.has(id)) throw new Error(`duplicate achievement id ${id}`);
    ids.add(id);
    if (!categoryIds.has(achievement.categoryId)) throw new Error(`achievement ${id} references missing category ${achievement.categoryId}`);
    requiredText(achievement.name, `achievement ${id} name`);
    requiredText(achievement.description, `achievement ${id} description`);
    parseVersion(achievement.version, `achievement ${id} version`);
    if (compareVersions(achievement.version, catalog.releasedVersion) > 0) throw new Error(`achievement ${id} is newer than ${catalog.releasedVersion}`);
  }
  return catalog;
}
