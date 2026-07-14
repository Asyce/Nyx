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

// Source-native ranks mapped onto the shared five-tier frame. Numeric 1..5
// and star symbols are direct; HoYo quality enums keep their documented order;
// ZZZ/Prydwen B/A/S ranks are blue/purple/gold (3/4/5). Unsupported values
// remain Unknown instead of receiving a guessed tier.
const DATABASE_LETTER_RARITY = { B:3, A:4, S:5 };

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

export function databaseRarityLabel(value, { game = '' } = {}) {
  const sourceValue = String(value || '').trim();
  const sourceRank = sourceValue.replace(/-?rank$/i, '').trim().toUpperCase();
  const letter = DATABASE_LETTER_RARITY[sourceRank];
  if (Number.isInteger(letter)) return `${letter} \u2605`;
  const symbols = sourceValue.match(/^[\u2605*]{1,5}$/)?.[0];
  if (symbols) return `${symbols.length} \u2605`;
  const endfieldTier = sourceValue.match(/^([3-6])\s*\u2726$/)?.[1];
  if (game === 'ae' && endfieldTier) return `${endfieldTier} \u2605`;

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

// Drive Disc sets expose a structured `(2)` bonus separately from their long
// `(4)` effect. Only map known source-native stat phrases from that `(2)` row;
// unfamiliar or malformed values stay Unknown instead of becoming UI guesses.
const ZZZ_DRIVE_TWO_PIECE_STATS = [
  [/^ATK\s*\+/i, 'ATK'],
  [/^CRIT DMG\s*\+/i, 'CRIT DMG'],
  [/^HP\s*\+/i, 'HP'],
  [/^Anomaly Proficiency\s*\+/i, 'Anomaly Proficiency'],
  [/^Ether DMG\s*\+/i, 'Ether DMG'],
  [/^Physical DMG\s*\+/i, 'Physical DMG'],
  [/^Fire DMG\s*\+/i, 'Fire DMG'],
  [/^Energy Regen\s*\+/i, 'Energy Regen'],
  [/^Ice DMG\s*\+/i, 'Ice DMG'],
  [/^Anomaly Mastery\s*\+/i, 'Anomaly Mastery'],
  [/^Shield Effect\s*\+/i, 'Shield Effect'],
  [/^PEN Ratio\s*\+/i, 'PEN Ratio'],
  [/^Impact\s*\+/i, 'Impact'],
  [/^DEF\s*\+/i, 'DEF'],
  [/^Electric DMG\s*\+/i, 'Electric DMG'],
  [/^CRIT Rate\s*\+/i, 'CRIT Rate'],
  [/^Wind DMG\s*\+/i, 'Wind DMG'],
  [/^Increases Basic Attack DMG by\b/i, 'Basic Attack DMG'],
  [/^Increases Daze of attacks by\b/i, 'Daze'],
  [/^The DMG of Aftershocks and Dash Attacks is increased by\b/i, 'Aftershock / Dash Attack DMG'],
];

export function databaseZzzDriveDiscTwoPieceStat(fields) {
  const bonuses = Array.isArray(fields?.bonuses) ? fields.bonuses : [];
  const source = bonuses.find((value) => /^\s*\(2\)\s+/.test(String(value || '')));
  if (!source) return 'Unknown';
  const bonus = cleanDatabaseText(source).replace(/^\s*\(2\)\s+/, '');
  return ZZZ_DRIVE_TWO_PIECE_STATS.find(([pattern]) => pattern.test(bonus))?.[1] || 'Unknown';
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
  const trimmedLabel = label.trim();
  const numericFallbackName = /^\d+$/.test(trimmedLabel)
    && (!recordId || trimmedLabel === String(recordId).trim());
  const rawLocalizationKey = !/\s/.test(trimmedLabel) && (
    /^(?:OfficialName_|TextMap|Item_[A-Za-z0-9_]+_name$)/i.test(trimmedLabel)
    || /^(?:[A-Za-z0-9]+_){2,}[A-Za-z0-9]+(?:_name)?$/i.test(trimmedLabel)
  );
  const unusableLocalizedName = !trimmedLabel
    || numericFallbackName
    || rawLocalizationKey
    || /^\[(?:missing|unknown|textmap)[^\]]*\]$/i.test(trimmedLabel);
  if (unusableLocalizedName) return 'no-localized-display-name';
  if (explicitTestName || (explicitTestAsset && !releasedWithUnsafePlaceholder)) {
    return 'proven-internal-test';
  }
  return 'released';
}

export function databaseSourceIconPolicy(sourceIcon) {
  return /(?:^|[\\/])TrapTest(?:\.[^\\/]+)?$/i.test(String(sourceIcon || ''))
    ? 'unsafe-test-placeholder'
    : 'allowed';
}
