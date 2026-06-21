// Nanoka diff helpers. Hashing/canonicalization lives in ../../lib/common.mjs
// (single source of truth); this module only pins the Nanoka-specific omit set
// (so contentStatus/liveComparison/scrapedAt churn never shows up as a change)
// and the collection-shaped diff report.
import { contentHash as commonContentHash } from '../../lib/common.mjs';

// sourceSnapshot is the verbatim upstream blob; it is excluded from the hash so
// the change report tracks curated-field changes rather than upstream noise, and
// so toggling --debug (which controls whether the blob is written) never churns hashes.
const NANOKA_OMIT_KEYS = new Set(['contentStatus', 'liveComparison', 'scrapedAt', 'sourceSnapshot']);

export function contentHash(value, omitKeys = NANOKA_OMIT_KEYS) {
  return commonContentHash(value, omitKeys);
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

function entityChange(id, previousHash, currentHash, names) {
  return {
    id,
    name: names[id] || null,
    previousHash,
    currentHash
  };
}

function sortChanges(changes) {
  return changes.sort((left, right) => String(left.id).localeCompare(String(right.id), undefined, { numeric: true }));
}
