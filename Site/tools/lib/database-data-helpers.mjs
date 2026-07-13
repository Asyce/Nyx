const DATABASE_QUALITY_RARITY = {
  QUALITY_WHITE: 1,
  QUALITY_GREEN: 2,
  QUALITY_BLUE: 3,
  QUALITY_PURPLE: 4,
  QUALITY_ORANGE: 5,
  Normal: 1,
  NotNormal: 2,
  Rare: 3,
  SuperRare: 4,
  VeryRare: 5,
};

export function cleanDatabaseText(value) {
  return String(value || '')
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function databaseRarityLabel(value) {
  const direct = Number(value);
  if (Number.isInteger(direct) && direct >= 1 && direct <= 5) {
    return `${direct} ★`;
  }

  const quality = DATABASE_QUALITY_RARITY[String(value || '')];
  if (Number.isInteger(quality) && quality >= 1 && quality <= 5) {
    return `${quality} ★`;
  }

  const match = String(value || '').trim().match(/^([1-5])\s*(?:★|\*)?$/);
  return match ? `${match[1]} ★` : 'Unknown';
}

export function compareDatabaseRarityLabels(left, right) {
  const rank = (value) => Number(String(value || '').match(/^([1-5])/)?.[1]) || 99;
  return rank(left) - rank(right) || String(left).localeCompare(String(right));
}

const RELEASED_RECORDS_WITH_UNSAFE_TEST_PLACEHOLDER_ART = new Set([
  'zzz:items:202051',
  'zzz:items:202052',
  'zzz:items:204051',
  'zzz:items:204052',
]);

export function databaseRecordClassification({ game, collection, recordId, name, sourceIcon } = {}) {
  const label = String(name || '');
  const icon = String(sourceIcon || '');
  const recordKey = `${String(game || '')}:${String(collection || '')}:${String(recordId || '')}`;
  const releasedWithUnsafePlaceholder = RELEASED_RECORDS_WITH_UNSAFE_TEST_PLACEHOLDER_ART.has(recordKey);
  const explicitTestName = /^\s*(?:\(test\)|test(?:[\s\/-]|$))/i.test(label)
    || /\btest (?:package|bundle)\s*$/i.test(label)
    || /(?:^|_)s\d*test(?:_|$)/i.test(label)
    || /\btest item\b/i.test(label);
  const explicitTestAsset = /(?:^|[\\/])TrapTest(?:\.[^\\/]+)?$/i.test(icon);
  if (explicitTestName || (explicitTestAsset && !releasedWithUnsafePlaceholder)) {
    return 'internal/test';
  }
  return 'released';
}

export function databaseSourceIconPolicy(sourceIcon) {
  return /(?:^|[\\/])TrapTest(?:\.[^\\/]+)?$/i.test(String(sourceIcon || ''))
    ? 'unsafe-test-placeholder'
    : 'allowed';
}
