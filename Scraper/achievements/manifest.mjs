import crypto from 'node:crypto';

const GAME_KEY = /^(?:gi|hsr|zzz|wuwa|ae)$/;
const SHA256 = /^[a-f0-9]{64}$/;

function iso(value, label) {
  const timestamp = new Date(value).toISOString();
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error(`${label} is invalid`);
  return timestamp;
}

function sortedUnique(values, label) {
  const sorted = [...values].sort((left, right) => left.localeCompare(right, 'en'));
  if (new Set(sorted).size !== sorted.length) throw new Error(`${label} contains duplicates`);
  return sorted;
}

function recordFingerprint(value) {
  return JSON.stringify(value);
}

function mapById(rows, label) {
  if (!Array.isArray(rows)) throw new Error(`${label} must be an array`);
  const result = new Map();
  for (const row of rows) {
    const id = String(row?.id ?? '');
    if (!id || result.has(id)) throw new Error(`${label} contains an empty or duplicate id`);
    result.set(id, row);
  }
  return result;
}

export function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function achievementManifestEntry(catalog, bytes) {
  if (!catalog || !GAME_KEY.test(catalog.game || '')) throw new Error('Achievement catalog game is invalid');
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new Error(`${catalog.game} catalog bytes are missing`);
  const sourceCommit = String(catalog.source?.commit || '');
  if (!sourceCommit || sourceCommit.length > 128 || /[\u0000-\u001f<>]/.test(sourceCommit)) throw new Error(`${catalog.game} source commit is invalid`);
  return {
    game: catalog.game,
    catalogVersion: String(catalog.catalogVersion),
    releasedVersion: String(catalog.releasedVersion),
    categoryCount: catalog.categoryCount,
    achievementCount: catalog.achievementCount,
    catalogSha256: sha256Bytes(bytes),
    sourceCommit,
    dataTimestamp: iso(catalog.dataTimestamp, `${catalog.game} data timestamp`),
  };
}

export function createAchievementManifest(catalogFiles, { generatedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(catalogFiles) || !catalogFiles.length) throw new Error('Achievement manifest needs at least one catalog');
  const games = catalogFiles
    .map(({ catalog, bytes }) => achievementManifestEntry(catalog, bytes))
    .sort((left, right) => left.game.localeCompare(right.game, 'en'));
  sortedUnique(games.map(({ game }) => game), 'Achievement manifest games');
  return {
    schemaVersion: 1,
    generatedAt: iso(generatedAt, 'Achievement manifest generatedAt'),
    games,
  };
}

export function validateAchievementManifest(manifest, catalogFiles, expectedGames = null) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.games) || !manifest.games.length) {
    throw new Error('Achievement manifest envelope is invalid');
  }
  iso(manifest.generatedAt, 'Achievement manifest generatedAt');
  const expected = createAchievementManifest(catalogFiles, { generatedAt:manifest.generatedAt });
  const actualGames = manifest.games.map((entry) => entry?.game);
  if (JSON.stringify(actualGames) !== JSON.stringify(sortedUnique(actualGames, 'Achievement manifest games'))) {
    throw new Error('Achievement manifest games are not sorted');
  }
  if (expectedGames) {
    const wanted = sortedUnique(expectedGames.map(String), 'Expected achievement games');
    if (JSON.stringify(actualGames) !== JSON.stringify(wanted)) throw new Error('Achievement manifest does not match the enabled tracker games');
  }
  if (JSON.stringify(manifest.games) !== JSON.stringify(expected.games)) {
    throw new Error('Achievement manifest metadata or catalog checksum does not match');
  }
  for (const entry of manifest.games) {
    if (!SHA256.test(entry.catalogSha256 || '')) throw new Error(`${entry.game} achievement catalog checksum is invalid`);
  }
  return manifest;
}

function changedIds(previousRows, nextRows, label) {
  const previous = mapById(previousRows, `${label} previous rows`);
  const next = mapById(nextRows, `${label} next rows`);
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, row] of next) {
    if (!previous.has(id)) added.push(id);
    else if (recordFingerprint(previous.get(id)) !== recordFingerprint(row)) changed.push(id);
  }
  for (const id of previous.keys()) if (!next.has(id)) removed.push(id);
  return {
    added: sortedUnique(added, `${label} added ids`),
    removed: sortedUnique(removed, `${label} removed ids`),
    changed: sortedUnique(changed, `${label} changed ids`),
  };
}

export function compareAchievementCatalogs(previous, next) {
  if (!next || !GAME_KEY.test(next.game || '')) throw new Error('Next achievement catalog is invalid');
  if (previous && previous.game !== next.game) throw new Error('Achievement catalog comparison game mismatch');
  const before = previous || { catalogVersion:null, categoryCount:0, achievementCount:0, categories:[], achievements:[] };
  const achievements = changedIds(before.achievements, next.achievements, `${next.game} achievements`);
  const categories = changedIds(before.categories, next.categories, `${next.game} categories`);
  const countDelta = next.achievementCount - before.achievementCount;
  const largeCountChange = previous
    ? Math.abs(countDelta) > Math.max(25, Math.ceil(previous.achievementCount * 0.1))
    : false;
  const reviewRequired = achievements.removed.length > 0 || categories.removed.length > 0 || largeCountChange;
  const changed = [
    ...achievements.added,
    ...achievements.removed,
    ...achievements.changed,
    ...categories.added,
    ...categories.removed,
    ...categories.changed,
  ].length > 0 || before.catalogVersion !== next.catalogVersion;
  return {
    game: next.game,
    status: reviewRequired ? 'review-required' : changed ? 'changed' : 'unchanged',
    reviewRequired,
    largeCountChange,
    previousCatalogVersion: before.catalogVersion,
    nextCatalogVersion: next.catalogVersion,
    previousCategoryCount: before.categoryCount,
    nextCategoryCount: next.categoryCount,
    previousAchievementCount: before.achievementCount,
    nextAchievementCount: next.achievementCount,
    achievementCountDelta: countDelta,
    achievements,
    categories,
  };
}

export function createAchievementRefreshReport(comparisons, { generatedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(comparisons) || !comparisons.length) throw new Error('Achievement refresh report needs comparisons');
  const games = comparisons.slice().sort((left, right) => left.game.localeCompare(right.game, 'en'));
  sortedUnique(games.map(({ game }) => game), 'Achievement refresh report games');
  return {
    schemaVersion: 1,
    generatedAt: iso(generatedAt, 'Achievement refresh report generatedAt'),
    reviewRequired: games.some((entry) => entry.reviewRequired),
    games,
  };
}
