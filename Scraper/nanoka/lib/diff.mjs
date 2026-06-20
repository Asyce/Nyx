import { createHash } from 'node:crypto';

const DEFAULT_OMIT_KEYS = new Set([
  'contentStatus',
  'liveComparison',
  'scrapedAt'
]);

export function contentHash(value, omitKeys = DEFAULT_OMIT_KEYS) {
  return createHash('sha256')
    .update(stableStringify(stripKeys(value, omitKeys)))
    .digest('hex');
}

export function collectionHashes(records) {
  return Object.fromEntries(records.map((record) => [String(record.id), contentHash(record)]));
}

export function diffHashes(previousHashes = {}, currentHashes = {}, names = {}) {
  const previousIds = new Set(Object.keys(previousHashes));
  const currentIds = new Set(Object.keys(currentHashes));
  const added = [];
  const removed = [];
  const changed = [];
  let unchanged = 0;

  for (const id of currentIds) {
    if (!previousIds.has(id)) {
      added.push(entityChange(id, null, currentHashes[id], names));
    } else if (previousHashes[id] !== currentHashes[id]) {
      changed.push(entityChange(id, previousHashes[id], currentHashes[id], names));
    } else {
      unchanged += 1;
    }
  }

  for (const id of previousIds) {
    if (!currentIds.has(id)) {
      removed.push(entityChange(id, previousHashes[id], null, names));
    }
  }

  return {
    added: sortChanges(added),
    removed: sortChanges(removed),
    changed: sortChanges(changed),
    unchanged,
    totals: {
      previous: previousIds.size,
      current: currentIds.size
    }
  };
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function stripKeys(value, keys = DEFAULT_OMIT_KEYS) {
  if (Array.isArray(value)) {
    return value.map((item) => stripKeys(item, keys));
  }

  if (value && typeof value === 'object') {
    const next = {};
    for (const key of Object.keys(value).sort()) {
      if (!keys.has(key) && value[key] !== undefined) {
        next[key] = stripKeys(value[key], keys);
      }
    }
    return next;
  }

  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) {
        sorted[key] = canonicalize(value[key]);
      }
    }
    return sorted;
  }

  return value;
}

function entityChange(id, previousHash, currentHash, names) {
  return {
    id,
    name: names[id] || null,
    previousHash,
    currentHash
  };
}

function sortChanges(changes) {
  return changes.sort((left, right) => naturalCompare(left.id, right.id));
}

function naturalCompare(left, right) {
  return String(left).localeCompare(String(right), undefined, { numeric: true });
}
