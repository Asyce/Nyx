import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

// Shared reward vocabulary — single source of truth used by both the codes
// scraper's publish gate and this display filter, so they never disagree.
const require = createRequire(import.meta.url);
const { isUsefulReward: isUsefulRewardShared } = require(path.resolve(root, 'Scraper', 'codes', 'reward-vocab.cjs'));
const siteDir = path.resolve(root, 'Site');
const generatedDataDir = path.resolve(siteDir, 'src', 'data', 'generated');
const dbDir = path.resolve(root, 'Database');

const readJson = (rel) => JSON.parse(fs.readFileSync(path.resolve(dbDir, rel), 'utf8'));
const exists = (rel) => fs.existsSync(path.resolve(dbDir, rel));
function dbAsset(p) {
  if (!p) return null;
  const norm = String(p).replace(/\\/g, '/');
  const candidates = [
    norm,
    norm.replace(/\/([^/]+)-(?:card|icon|full)-([a-f0-9]+\.[a-z0-9]+)$/i, '/$1-$2'),
  ];
  const found = candidates.find((rel) => fs.existsSync(path.resolve(dbDir, rel)));
  return found ? '../../Database/' + found : null;
}

const preferred = {
  giElements: ['Pyro', 'Hydro', 'Electro', 'Cryo', 'Anemo', 'Geo', 'Dendro'],
  giWeapons: ['Sword', 'Claymore', 'Polearm', 'Bow', 'Catalyst'],
  hsrPaths: ['Destruction', 'Hunt', 'Erudition', 'Preservation', 'Nihility', 'Harmony', 'Abundance', 'Remembrance', 'Elation'],
  hsrElements: ['Physical', 'Fire', 'Ice', 'Lightning', 'Wind', 'Quantum', 'Imaginary'],
  zzzAttributes: ['Physical', 'Fire', 'Ice', 'Electric', 'Frost', 'Ether'],
  zzzSpecs: ['Attack', 'Stun', 'Anomaly', 'Support', 'Defense', 'Rupture'],
  wuwaElements: ['Glacio', 'Fusion', 'Electro', 'Aero', 'Spectro', 'Havoc'],
  wuwaWeapons: ['Broadblade', 'Sword', 'Pistols', 'Gauntlets', 'Rectifier'],
  aeElements: ['Heat', 'Cryo', 'Electric', 'Nature', 'Physical'],
  aeClasses: ['Striker', 'Guard', 'Defender', 'Caster', 'Vanguard', 'Supporter', 'Specialist'],
  aeWeapons: ['Sword', 'Greatsword', 'Polearm', 'Handcannon', 'Arts Unit'],
};

const weaponMap = {
  WEAPON_SWORD_ONE_HAND: 'Sword',
  WEAPON_CLAYMORE: 'Claymore',
  WEAPON_POLE: 'Polearm',
  WEAPON_BOW: 'Bow',
  WEAPON_CATALYST: 'Catalyst',
};
const wwWeaponMap = {
  1: 'Broadblade',
  2: 'Sword',
  3: 'Pistols',
  4: 'Gauntlets',
  5: 'Rectifier',
};
const wwElementMap = {
  1: 'Glacio',
  2: 'Fusion',
  3: 'Electro',
  4: 'Aero',
  5: 'Spectro',
  6: 'Havoc',
};

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function ordered(values, order = []) {
  const set = new Set(values.filter((v) => v !== undefined && v !== null && v !== ''));
  const first = order.filter((v) => set.delete(v));
  return [...first, ...[...set].sort((a, b) => String(a).localeCompare(String(b)))];
}

function parsePrydwenDate(s) {
  if (!s) return 0;
  const m = String(s).match(/(\d{1,2})\/([A-Za-z]+)\/(\d{4})/);
  if (!m) return 0;
  const months = { Jan:0, January:0, Feb:1, February:1, Mar:2, March:2, Apr:3, April:3, May:4, Jun:5, June:5, Jul:6, July:6, Aug:7, August:7, Sep:8, September:8, Oct:9, October:9, Nov:10, November:10, Dec:11, December:11 };
  const mo = months[m[2]] ?? months[m[2].slice(0, 3)];
  return mo === undefined ? 0 : new Date(Number(m[3]), mo, Number(m[1])).getTime();
}

function parseRelease(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value * 1000;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function cleanText(s, len = 220) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, len);
}

function normKey(s) {
  return String(s || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

const QUALITY_RARITY = {
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

function rarityNumber(value, fallback = 1) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return n;
  return QUALITY_RARITY[String(value || '')] || fallback;
}

const GENERIC_SOURCE_RE = /placeholder|craftable amount|crafting bench|crafting table|stardust|starglitter|embers exchange|starlight exchange|omni-synthesizer|synthesis|conversion|item exchange|weapon shop|souvenir shop|gift shop|supply pack|quest rewards?|mission rewards?|assignment rewards?|level rewards?|limited-time event|battle pass|nameless honor|daily training|shop\b/i;
const MONSTER_SOURCE_CACHE = new Map();

function cleanSourceText(value, len = 160) {
  return cleanText(value, len)
    .replace(/\{[^}]*\}/g, '')
    .replace(/\s*\/\s*$/, '')
    .trim();
}

function pushSourceCandidate(out, value) {
  if (Array.isArray(value)) {
    value.forEach((entry) => pushSourceCandidate(out, entry));
    return;
  }
  if (!value) return;
  if (typeof value === 'object') {
    pushSourceCandidate(out, value.name || value.desc || value.text || value.title);
    return;
  }
  const text = cleanSourceText(value);
  if (text) out.push(text);
}

function rawSourceCandidates(item) {
  const snap = item?.sourceSnapshot || {};
  const source = item?.source || {};
  const out = [];
  pushSourceCandidate(out, snap.source_list);
  pushSourceCandidate(out, snap.jump_descs);
  pushSourceCandidate(out, snap.item_comefrom);
  pushSourceCandidate(out, source.source);
  pushSourceCandidate(out, source.jump_descs);
  pushSourceCandidate(out, item?.source);

  const zzzDesc = cleanSourceText(item?.secondaryDescription || snap.desc2 || '', 260);
  if (zzzDesc) {
    const patterns = [
      /retrieved from (?:the )?([^.;]+)/i,
      /preserved from (?:the )?["“]?([^."”;]+)/i,
      /extracted from (?:the )?([^.;]+)/i,
      /taken from (?:the )?([^.;]+)/i,
      /obtained from ["“]?([^."”]+)/i,
      /combat records of .*? versus ([^,.;]+)/i,
      /\bversus ([^,.;]+)/i,
    ];
    for (const pattern of patterns) {
      const match = zzzDesc.match(pattern);
      if (match?.[1]) pushSourceCandidate(out, match[1]);
    }
  }
  return out;
}

function sourceBaseName(value) {
  return cleanSourceText(value)
    .replace(/^lv\.?\s*\d+\+?\s*/i, '')
    .replace(/\s+challenge reward$/i, '')
    .replace(/^dropped by\s+(?:the\s+)?/i, '')
    .replace(/^retrieved from\s+(?:the\s+)?/i, '')
    .replace(/^extracted from\s+(?:the\s+)?/i, '')
    .replace(/^obtained from\s+(?:the\s+)?/i, '')
    .replace(/^echo of war:\s*(.+)$/i, '$1')
    .replace(/^stagnant shadow:\s*(.+)$/i, '$1')
    .replace(/^weekly challenge:\s*(.+)$/i, '$1')
    .replace(/^notorious hunt:\s*(.+)$/i, '$1')
    .replace(/:\s*$/i, '')
    .replace(/^challenge\s+/i, '')
    .replace(/[.!]+$/g, '')
    .trim();
}

function isGenericSource(value) {
  const text = cleanSourceText(value);
  if (!text) return true;
  if (/^alchemy$/i.test(text)) return true;
  return GENERIC_SOURCE_RE.test(text);
}

function extraSourceCandidates(game, item, id) {
  const out = [];
  const sid = String(id ?? item?.id ?? item?.sourceSnapshot?.id ?? '');
  if (game === 'gi') {
    const book = GI_BOOK_LOOKUP.get(sid);
    if (book) {
      const spec = GI_DOMAIN_SPECS[book.di];
      const trio = spec?.trios?.[book.ti];
      if (spec && trio) out.push(`${trio.name} - ${spec.name}`);
    }
    const weapon = GI_WEAPON_DOMAIN_LOOKUP.get(sid);
    if (weapon) {
      const spec = GI_WEAPON_DOMAIN_SPECS[weapon.di];
      const trio = spec?.trios?.[weapon.ti];
      if (spec && trio) out.push(`${trio.name} - ${spec.name}`);
    }
    const weekly = GI_WEEKLY_BOSS_SPECS.find((boss) => boss.matIds.includes(sid));
    if (weekly) out.push(weekly.bossName);
  }
  if (game === 'hsr') {
    const desc = cleanSourceText(item?.desc || item?.description || item?.sourceSnapshot?.item_desc || '', 180);
    const subType = String(item?.sourceSnapshot?.item_sub_type || '');
    const remains = desc.match(/^Remains of (?:the\s+)?(.+?)\./i);
    if (remains?.[1]) out.push(remains[1]);
    const possessive = desc.match(/^(.+?)'s .+? Can be used/i);
    if (possessive?.[1]) out.push(possessive[1]);
    if (/WeeklyMonsterDrop/i.test(subType)) out.push('Echo of War');
    if (/AvatarRank/i.test(subType)) out.push('Stagnant Shadow');
  }
  if (game === 'zzz') {
    const name = String(item?.name || item?.sourceSnapshot?.name || '');
    if (/Certification Seal/i.test(name)) out.push('Combat Simulation - Agent Promotion');
    if (/\bChip\b/i.test(name)) out.push('Combat Simulation - Agent Skills');
    if (/Higher Dimensional Data/i.test(name)) out.push('Expert Challenge');
    if (/Hamster Cage Pass/i.test(name)) out.push('Event / New Eridu City Fund');
  }
  return out;
}

function sourceNames(item, fallback = null, game = null, id = null) {
  const sources = [
    ...rawSourceCandidates(item),
    ...extraSourceCandidates(game, item, id),
  ]
    .map((value) => sourceBaseName(value))
    .filter((value) => value && !isGenericSource(value));
  const unique = uniq(sources).slice(0, 6);
  if (unique.length) return unique;
  return fallback ? [fallback] : [];
}

function sourceSummary(item, fallback = null, game = null, id = null) {
  const sources = sourceNames(item, fallback, game, id);
  return sources.length ? sources.join(' / ') : fallback;
}

function rewardIdsForMonster(monster) {
  const ids = [];
  const walk = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === 'object') {
      for (const key of ['id', 'item_id', 'itemId']) {
        if (value[key] !== undefined && value[key] !== null) ids.push(String(value[key]));
      }
      Object.values(value).forEach(walk);
    }
  };
  walk(monster?.rewards);
  walk(monster?.sourceSnapshot?.reward);
  walk(monster?.sourceSnapshot?.rewards);
  return uniq(ids);
}

function monsterSourceRel(game) {
  return {
    gi: 'Nanoka/gi/live/monsters.json',
    hsr: 'Nanoka/hsr/live/monsters.json',
    zzz: 'Nanoka/zzz/live/monsters.json',
    wuwa: 'Nanoka/ww/live/monsters.json',
    ww: 'Nanoka/ww/live/monsters.json',
  }[game] || null;
}

function monsterSourceIndex(game) {
  const rel = monsterSourceRel(game);
  if (!rel || !exists(rel)) return { byReward: new Map(), byName: [] };
  if (MONSTER_SOURCE_CACHE.has(rel)) return MONSTER_SOURCE_CACHE.get(rel);
  const byReward = new Map();
  const byName = [];
  for (const monster of readJson(rel)) {
    const name = cleanSourceText(monster?.name || monster?.title, 90);
    if (!name) continue;
    const entry = {
      name,
      key: normKey(name),
      icon: dbAsset(monster?.assets?.icon || monster?.sourceSnapshot?.icon),
    };
    byName.push(entry);
    for (const id of rewardIdsForMonster(monster)) {
      if (!byReward.has(id)) byReward.set(id, []);
      byReward.get(id).push(entry);
    }
  }
  const index = { byReward, byName };
  MONSTER_SOURCE_CACHE.set(rel, index);
  return index;
}

function matchMonsterSource(name, index) {
  const key = normKey(name);
  if (!key) return null;
  let best = null;
  for (const monster of index.byName || []) {
    if (monster.key === key) return monster;
    if (monster.key && (key.includes(monster.key) || monster.key.includes(key))) {
      if (!best || monster.key.length > best.key.length) best = monster;
    }
  }
  return best;
}

function addSourceDetail(out, detail) {
  const name = cleanSourceText(detail?.name, 90);
  if (!name || isGenericSource(name)) return;
  const key = normKey(name);
  if (out.some((row) => normKey(row.name) === key)) return;
  out.push({
    name,
    ...(detail.icon ? { icon: detail.icon } : {}),
  });
}

function sourceDetailsForItem(game, item, id = null) {
  const out = [];
  const sid = String(id ?? item?.id ?? item?.sourceSnapshot?.id ?? '');
  const index = monsterSourceIndex(game);
  for (const monster of index.byReward.get(sid) || []) addSourceDetail(out, monster);
  for (const source of sourceNames(item, null, game, sid)) {
    const matched = matchMonsterSource(source, index);
    addSourceDetail(out, matched || { name: source });
  }
  return out.slice(0, 6);
}

function materialSourceFields(game, item, id = null) {
  const source = sourceSummary(item, null, game, id);
  const sourceDetails = sourceDetailsForItem(game, item, id);
  return {
    ...(source ? { source } : {}),
    ...(sourceDetails.length ? { sourceDetails } : {}),
  };
}

function loadWikiTitleCache() {
  const rel = 'WikiTitles/character-titles.json';
  const cache = {};
  if (!exists(rel)) return cache;
  const src = readJson(rel);
  for (const [game, group] of Object.entries(src.games || {})) {
    const key = game === 'ww' ? 'wuwa' : game;
    cache[key] = new Map();
    for (const entry of group.entries || []) {
      if (!entry?.name || !entry.title) continue;
      cache[key].set(normKey(entry.name), cleanText(entry.title, 90));
    }
  }
  return cache;
}

function firstValue(value) {
  if (!value) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) return Object.values(value)[0];
  return value;
}

function loadGenshinBirthdayArtMap() {
  const rel = 'GenshinWiki/birthday-art/manifest.json';
  const map = new Map();
  if (!exists(rel)) return map;
  const manifest = readJson(rel);
  for (const row of manifest.characters || []) {
    const key = normKey(row.name);
    const pool = (row.artworks || [])
      .map((art) => dbAsset(art.localAsset))
      .filter(Boolean);
    if (key && pool.length) map.set(key, uniq(pool));
  }
  return map;
}

function loadHsrHolidayArtMap() {
  const rel = 'HsrWiki/holiday-art/manifest.json';
  const map = new Map();
  if (!exists(rel)) return map;
  const manifest = readJson(rel);
  for (const row of manifest.characters || []) {
    const key = normKey(row.name);
    const pool = (row.artworks || [])
      .map((art) => dbAsset(art.localAsset))
      .filter(Boolean);
    if (key && pool.length) map.set(key, uniq(pool));
  }
  return map;
}

const HSR_PATH_NAMES = {
  Warrior: 'Destruction',
  Rogue: 'Hunt',
  Mage: 'Erudition',
  Knight: 'Preservation',
  Warlock: 'Nihility',
  Shaman: 'Harmony',
  Priest: 'Abundance',
  Memory: 'Remembrance',
  Elation: 'Elation',
};

const HSR_SIGNATURE_CHARACTER_ALIASES = {
  evernight: ['March 7th • Evernight'],
  fugue: ['Tingyun • Fugue'],
  silverwolflv999: ['Silver Wolf • Lv. 999'],
};

function hsrReadablePath(pathName) {
  return HSR_PATH_NAMES[pathName] || pathName || null;
}

function loadHsrSignatureLightConeMap() {
  const rel = 'HsrWiki/signature-lightcones/manifest.json';
  const map = new Map();
  if (!exists(rel)) return map;
  const manifest = readJson(rel);
  for (const row of manifest.lightCones || []) {
    const art = dbAsset(row.localAsset);
    if (!row?.name || !art) continue;
    const entry = {
      id: String(row.id || ''),
      name: cleanText(row.name, 90),
      art,
      icon: dbAsset(row.localIcon),
      rarity: Number(row.rarity || 0),
      path: hsrReadablePath(row.path),
      rawPath: row.path || null,
      sourcePage: row.sourcePage || null,
    };
    const names = [];
    for (const charName of row.characters || []) {
      names.push(charName);
      const aliases = HSR_SIGNATURE_CHARACTER_ALIASES[normKey(charName)] || [];
      names.push(...aliases);
    }
    for (const charName of names) {
      const key = normKey(charName);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(entry);
    }
  }
  return map;
}

const WIKI_TITLE_CACHE = loadWikiTitleCache();
const GENSHIN_BIRTHDAY_ART = loadGenshinBirthdayArtMap();
const HSR_HOLIDAY_ART = loadHsrHolidayArtMap();
const HSR_SIGNATURE_LIGHT_CONES = loadHsrSignatureLightConeMap();

const MANUAL_CHARACTER_TITLE_OVERRIDES = {
  hsr: {},
  zzz: {},
  wuwa: {},
  ae: {},
};

const MANUAL_ICON_ZOOM = {
  gi: {
    durin: 1.34,
    nefer: 1.32,
    columbina: 1.32,
  },
  zzz: {
    norma: 1.24,
    velina: 1.24,
  },
};

const MANUAL_OVERVIEW_ART_ZOOM = {
  gi: {
    durin: 1.12,
    nefer: 1.12,
    columbina: 1.12,
  },
};

function titleOverride(game, name) {
  const key = game === 'ww' ? 'wuwa' : game;
  const normalized = normKey(name);
  return WIKI_TITLE_CACHE[key]?.get(normalized) || MANUAL_CHARACTER_TITLE_OVERRIDES[key]?.[normalized] || undefined;
}

function displayTitle(game, source, facts = {}) {
  return cleanText(
    source?.profile?.title ||
    source?.title ||
    facts?.title ||
    titleOverride(game, source?.name || source?.n),
    90,
  ) || undefined;
}

const GI_TCG_OVERVIEW_EXTRA_PREFIXES = {
  durin: ['332054'],
  ineffa: ['332062'],
  aino: ['332060'],
  xilonen: ['332055'],
  kirara: ['332052'],
  ifa: ['332050', '1515'],
  ororon: ['332049'],
  iansan: ['332048'],
  chasca: ['332046'],
  citlali: ['332045'],
  kinich: ['332044'],
  kachina: ['332043'],
  mualani: ['332041'],
  lynette: ['332037'],
  lyney: ['332032'],
  freminet: ['332031'],
  keqing: ['332018'],
  kazuha: ['332017'],
  xiao: ['332014'],
  hutao: ['332013'],
  amber: ['332012'],
  yaemiko: ['332011'],
  tartaglia: ['332010'],
  mona: ['332008'],
  shenhe: ['332007'],
  noelle: ['332006'],
  aratakiitto: ['332005'],
  sangonomiyakokomi: ['332004'],
  ningguang: ['332003'],
  rosaria: ['332002'],
  columbina: ['331807', '321035'],
  mavuika: ['331806', '330010'],
  furina: ['331805', '330006'],
  nahida: ['331804', '330012'],
  raidenshogun: ['331803', '330008', '330001'],
  zhongli: ['331802', '330002'],
  venti: ['331801', '330004'],
  neuvillette: ['330009'],
  xiangling: ['330005'],
  wanderer: ['1506'],
  traveler: ['332001'],
};

function gcgAssetPrefixIndex(relDir) {
  const abs = path.resolve(dbDir, relDir);
  const map = new Map();
  if (!fs.existsSync(abs)) return map;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.webp$/i.test(entry.name)) continue;
    const prefix = entry.name.match(/^(\d+)-/)?.[1];
    if (!prefix) continue;
    const rel = `${relDir}/${entry.name}`.replace(/\\/g, '/');
    if (!map.has(prefix)) map.set(prefix, []);
    map.get(prefix).push('../../Database/' + rel);
  }
  for (const list of map.values()) list.sort((a, b) => a.localeCompare(b));
  return map;
}

function buildGcgCharacterCardMap() {
  const map = new Map();
  const rel = 'Nanoka/gi/gcg/character cards/cards.json';
  if (!exists(rel)) return map;
  for (const card of readJson(rel)) {
    const who = card.playableCharacter || card.name;
    const asset = card.localAsset ? dbAsset(card.localAsset) : null;
    if (!who || !asset) continue;
    const key = normKey(who);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(asset);
  }
  for (const list of map.values()) list.sort((a, b) => a.localeCompare(b));
  return map;
}

function applyGenshinTcgOverviewArt(roster) {
  const characterCards = buildGcgCharacterCardMap();
  const otherCards = gcgAssetPrefixIndex('Nanoka/gi/gcg/other cards/assets');
  const report = {
    generatedAt: new Date().toISOString(),
    note: 'overviewArtPool is used only by overview favourite cards. Material/detail art stays on normal character assets.',
    counts: {
      roster: roster.length,
      withCharacterCard: 0,
      withManualExtra: 0,
      withOverviewPool: 0,
      missingOverviewPool: 0,
    },
    missingCharacterCards: [],
    missingOverviewPool: [],
    missingManualPrefixes: [],
    characters: [],
  };

  for (const ch of roster) {
    const key = normKey(ch.n);
    const automatic = characterCards.get(key) || [];
    const manualPrefixes = GI_TCG_OVERVIEW_EXTRA_PREFIXES[key] || [];
    const manual = [];
    for (const prefix of manualPrefixes) {
      const matches = otherCards.get(prefix) || [];
      if (!matches.length) report.missingManualPrefixes.push({ character: ch.n, prefix });
      manual.push(...matches);
    }
    const pool = uniq([...automatic, ...manual]);
    if (automatic.length) report.counts.withCharacterCard += 1;
    else report.missingCharacterCards.push(ch.n);
    if (manual.length) report.counts.withManualExtra += 1;
    if (pool.length) {
      ch.overviewArtPool = pool;
      ch.overviewArt = pool[0];
      const zoom = MANUAL_OVERVIEW_ART_ZOOM.gi[key];
      if (zoom) ch.overviewArtZoom = zoom;
      report.counts.withOverviewPool += 1;
    } else {
      report.counts.missingOverviewPool += 1;
      report.missingOverviewPool.push(ch.n);
    }
    report.characters.push({
      name: ch.n,
      automatic: automatic.length,
      manual: manual.length,
      pool: pool.length,
    });
  }

  report.missingCharacterCards.sort((a, b) => a.localeCompare(b));
  report.missingOverviewPool.sort((a, b) => a.localeCompare(b));
  report.missingManualPrefixes.sort((a, b) => a.character.localeCompare(b.character) || a.prefix.localeCompare(b.prefix));
  return report;
}

function markRecentBuckets(roster, keyFn, fallbackCount = 9) {
  roster.forEach((ch) => {
    delete ch.recent;
    delete ch.recentFallback;
  });
  const groups = new Map();
  for (const ch of roster) {
    const key = keyFn(ch);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ch);
  }

  const selected = [];
  let buckets = 0;
  const huge = Math.max(12, Math.ceil((roster.length || 1) * 0.3));
  for (const [, list] of [...groups.entries()].sort((a, b) => Number(b[0]) - Number(a[0]))) {
    if (list.length > huge) continue;
    selected.push(...list);
    buckets += 1;
    if (buckets >= 3) break;
  }

  const final = selected.length >= 3
    ? selected
    : roster.slice(0, Math.min(fallbackCount, roster.length));
  final.forEach((ch) => {
    ch.recent = 1;
    if (selected.length < 3) ch.recentFallback = 1;
  });
}

function gameKey(id) {
  const key = String(id || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const map = {
    gi: 'gi',
    genshin: 'gi',
    genshinimpact: 'gi',
    hsr: 'hsr',
    honkaistarrail: 'hsr',
    starrail: 'hsr',
    zzz: 'zzz',
    zenlesszonezero: 'zzz',
    wuwa: 'wuwa',
    ww: 'wuwa',
    wutheringwaves: 'wuwa',
    ae: 'ae',
    endfield: 'ae',
    arknightsendfield: 'ae',
  };
  return map[key] || null;
}

function normalizeForJs(source) {
  return JSON.stringify(source, null, 2).replace(/[^\x00-\x7F]/g, (ch) => {
    const cp = ch.codePointAt(0);
    if (cp <= 0xffff) return '\\u' + cp.toString(16).padStart(4, '0');
    const n = cp - 0x10000;
    const hi = 0xd800 + (n >> 10);
    const lo = 0xdc00 + (n & 0x3ff);
    return '\\u' + hi.toString(16).padStart(4, '0') + '\\u' + lo.toString(16).padStart(4, '0');
  });
}

let giItemLookupCache = null;

function giItemLookup() {
  if (giItemLookupCache) return giItemLookupCache;
  const byKey = new Map();
  if (!exists('Nanoka/gi/live/items.json')) {
    giItemLookupCache = byKey;
    return byKey;
  }
  for (const item of readJson('Nanoka/gi/live/items.json')) {
    if (!item) continue;
    if (item.id !== undefined && item.id !== null) byKey.set(String(item.id), item);
    if (item.name) byKey.set(String(item.name).toLowerCase(), item);
  }
  giItemLookupCache = byKey;
  return byKey;
}

const nanokaItemLookupCache = new Map();

function nanokaItemLookup(game) {
  if (nanokaItemLookupCache.has(game)) return nanokaItemLookupCache.get(game);
  const byKey = new Map();
  const rel = `Nanoka/${game}/live/items.json`;
  if (!exists(rel)) {
    nanokaItemLookupCache.set(game, byKey);
    return byKey;
  }
  for (const item of readJson(rel)) {
    if (!item) continue;
    if (item.id !== undefined && item.id !== null) byKey.set(String(item.id), item);
    if (item.name) byKey.set(String(item.name).toLowerCase(), item);
  }
  nanokaItemLookupCache.set(game, byKey);
  return byKey;
}

const localAvatarOverlayCache = new Map();

function localAvatarOverlay(game) {
  const key = game === 'ww' ? 'wuwa' : game;
  if (localAvatarOverlayCache.has(key)) return localAvatarOverlayCache.get(key);
  const byName = new Map();

  if (key === 'hsr' && exists('Nanoka/hsr/live/characters.json')) {
    for (const ch of readJson('Nanoka/hsr/live/characters.json')) {
      if (!ch?.name) continue;
      byName.set(normKey(ch.name), {
        icon: dbAsset(ch.assets?.roundIcon || ch.assets?.avatar),
        fallbackArt: dbAsset(ch.assets?.drawCard || ch.assets?.avatar),
        title: titleOverride('hsr', ch.name),
      });
    }
  }

  if (key === 'zzz' && exists('Nanoka/zzz/live/agents.json')) {
    for (const ch of readJson('Nanoka/zzz/live/agents.json')) {
      if (!ch?.name) continue;
      byName.set(normKey(ch.name), {
        icon: dbAsset(ch.assets?.partnerIcon || ch.assets?.icon),
        fallbackArt: dbAsset(ch.assets?.icon),
        title: titleOverride('zzz', ch.name),
      });
    }
  }

  if (key === 'wuwa' && exists('Nanoka/ww/live/characters.json')) {
    for (const ch of readJson('Nanoka/ww/live/characters.json')) {
      if (!ch?.name) continue;
      byName.set(normKey(ch.name), {
        icon: dbAsset(ch.assets?.icon),
        fallbackArt: dbAsset(ch.assets?.background),
        title: titleOverride('wuwa', ch.name),
        releaseOrder: Number(ch.id) || 0,
      });
    }
  }

  localAvatarOverlayCache.set(key, byName);
  return byName;
}

function materialLookup(mat, lookup) {
  if (!lookup || !mat) return null;
  if (mat.id !== undefined && mat.id !== null && lookup.has(String(mat.id))) return lookup.get(String(mat.id));
  if (mat.name && lookup.has(String(mat.name).toLowerCase())) return lookup.get(String(mat.name).toLowerCase());
  return null;
}

function sumMaterials(rows, lookup = null, game = 'gi') {
  const byName = new Map();
  let cost = 0;
  for (const row of rows || []) {
    if (!row) continue;
    if (typeof row.cost === 'number') cost += row.cost;
    for (const mat of row.mats || []) {
      if (!mat || !mat.name) continue;
      const item = materialLookup(mat, lookup);
      const id = item?.id ?? mat.id;
      const name = item?.name || mat.name;
      const key = id !== undefined && id !== null ? `id:${id}` : `name:${String(name).toLowerCase()}`;
      const rarity = Math.max(1, rarityNumber(item?.rarity ?? mat.rarity ?? mat.rank, 1));
      const icon = dbAsset(item?.assets?.icon);
      const cur = byName.get(key) || {
        id: id !== undefined && id !== null ? String(id) : undefined,
        name,
        qty: 0,
        rar: rarity,
        kind: inferMatKind(name, mat.rank, item),
        icon,
        ...materialSourceFields(game, item, id),
      };
      cur.qty += Number(mat.count || 0);
      cur.rar = Math.max(cur.rar, rarity);
      if (!cur.icon && icon) cur.icon = icon;
      if (!cur.source) cur.source = sourceSummary(item, null, game, id) || undefined;
      if (!cur.sourceDetails?.length) {
        const details = sourceDetailsForItem(game, item, id);
        if (details.length) cur.sourceDetails = details;
      }
      byName.set(key, cur);
    }
  }
  return { items: [...byName.values()], cost };
}

function materialPayloadById(id, lookup, fallbackName = null, fallbackKind = null, game = 'gi') {
  const item = lookup?.get(String(id));
  const name = item?.name || fallbackName || String(id);
  return {
    id: String(id),
    name,
    n: name,
    rar: rarityNumber(item?.rarity, 5),
    kind: fallbackKind || inferMatKind(name, item?.rarity, item),
    icon: dbAsset(item?.assets?.icon),
    ...materialSourceFields(game, item, id),
  };
}

function inferMatKind(name, rank, item = null) {
  const type = String(item?.type || item?.sourceSnapshot?.material_type || '');
  if (/\bcrown\b/i.test(name)) return 'crown';
  if (/teaching|guide|philosoph/i.test(name)) return 'book';
  if (/sliver|fragment|chunk|gemstone/i.test(name)) return 'gem';
  if (/weapon ascension/i.test(type)) return 'weapon';
  if (/local specialty/i.test(type)) return 'specialty';
  if (/weekly/i.test(type)) return 'weekly';
  if (/boss/i.test(type)) return 'boss';
  const rarity = rarityNumber(rank, 0);
  if (rarity >= 5) return 'weekly';
  if (rarity === 0) return 'specialty';
  return 'mob';
}

function giTalentGroups(raw) {
  const skills = raw?.materials?.skills || [];
  return skills.length ? skills : (raw?.materials?.talents || []);
}

function giBookFamily(raw) {
  const skills = giTalentGroups(raw);
  for (const group of skills) {
    for (const row of group || []) {
      for (const mat of row.mats || []) {
        const m = String(mat.name || '').match(/(?:Teachings of|Guide to|Philosophies of)\s+(.+)/);
        if (m) return m[1];
      }
    }
  }
  return null;
}

const GI_DOMAIN_SPECS = [
  { name: 'Mondstadt - Forsaken Rift', trios: [
    { name: 'Freedom', firstId: 104301 },
    { name: 'Resistance', firstId: 104304 },
    { name: 'Ballad', firstId: 104307 },
  ] },
  { name: 'Liyue - Taishan Mansion', trios: [
    { name: 'Prosperity', firstId: 104310 },
    { name: 'Diligence', firstId: 104313 },
    { name: 'Gold', firstId: 104316 },
  ] },
  { name: 'Inazuma - Violet Court', trios: [
    { name: 'Transience', firstId: 104320 },
    { name: 'Elegance', firstId: 104323 },
    { name: 'Light', firstId: 104326 },
  ] },
  { name: 'Sumeru - Steeple of Ignorance', trios: [
    { name: 'Admonition', firstId: 104329 },
    { name: 'Ingenuity', firstId: 104332 },
    { name: 'Praxis', firstId: 104335 },
  ] },
  { name: 'Fontaine - Pale Forgotten Glory', trios: [
    { name: 'Equity', firstId: 104338 },
    { name: 'Justice', firstId: 104341 },
    { name: 'Order', firstId: 104344 },
  ] },
  { name: 'Natlan - Blazing Ruins', trios: [
    { name: 'Contention', firstId: 104347 },
    { name: 'Kindling', firstId: 104350 },
    { name: 'Conflict', firstId: 104353 },
  ] },
  { name: 'Nod-Krai - Lightless Capital', trios: [
    { name: 'Moonlight', firstId: 104356 },
    { name: 'Elysium', firstId: 104359 },
    { name: 'Vagrancy', firstId: 104362 },
  ] },
];

const GI_BOOK_LOOKUP = new Map();
GI_DOMAIN_SPECS.forEach((domain, di) => {
  domain.trios.forEach((trio, ti) => {
    for (let k = 0; k < 3; k += 1) GI_BOOK_LOOKUP.set(String(trio.firstId + k), { di, ti });
  });
});

const GI_WEAPON_DOMAIN_SPECS = [
  { name: 'Mondstadt - Cecilia Garden', trios: [
    { name: "Decarabian's Tower", firstId: 114001 },
    { name: "Boreal Wolf's Fang", firstId: 114005 },
    { name: 'Dandelion Gladiator', firstId: 114009 },
  ] },
  { name: 'Liyue - Hidden Palace of Lianshan Formula', trios: [
    { name: 'Guyun', firstId: 114013 },
    { name: 'Mist Veiled Elixir', firstId: 114017 },
    { name: 'Aerosiderite', firstId: 114021 },
  ] },
  { name: 'Inazuma - Court of Flowing Sand', trios: [
    { name: 'Distant Sea', firstId: 114025 },
    { name: 'Narukami', firstId: 114029 },
    { name: 'Mask', firstId: 114033 },
  ] },
  { name: 'Sumeru - Tower of Abject Pride', trios: [
    { name: 'Forest Dew', firstId: 114037 },
    { name: 'Oasis Garden', firstId: 114041 },
    { name: 'Scorching Might', firstId: 114045 },
  ] },
  { name: 'Fontaine - Echoes of the Deep Tides', trios: [
    { name: 'Ancient Chord', firstId: 114049 },
    { name: 'Pure Sacred Dewdrop', firstId: 114053 },
    { name: 'Pristine Sea', firstId: 114057 },
  ] },
  { name: 'Natlan - Ancient Watchtower', trios: [
    { name: 'Blazing Sacrificial Heart', firstId: 114061 },
    { name: 'Delirious Sacred Lord', firstId: 114065 },
    { name: "Night-Wind's Mystic Consideration", firstId: 114069 },
  ] },
  { name: 'Nod-Krai - Lost Mooncourt', trios: [
    { name: 'Artful Device', firstId: 114073 },
    { name: 'Long Night Flint', firstId: 114077 },
    { name: 'Far-North Scions', firstId: 114081 },
  ] },
];

const GI_WEAPON_DOMAIN_LOOKUP = new Map();
GI_WEAPON_DOMAIN_SPECS.forEach((domain, di) => {
  domain.trios.forEach((trio, ti) => {
    for (let k = 0; k < 4; k += 1) GI_WEAPON_DOMAIN_LOOKUP.set(String(trio.firstId + k), { di, ti });
  });
});

const GI_WEEKLY_BOSS_SPECS = [
  { bossName: 'Stormterror Dvalin', matIds: ['113003', '113004', '113005'] },
  { bossName: 'Andrius', matIds: ['113006', '113007', '113008'] },
  { bossName: 'Childe', matIds: ['113013', '113014', '113015'] },
  { bossName: 'Azhdaha', matIds: ['113017', '113018', '113019'] },
  { bossName: 'La Signora', matIds: ['113025', '113026', '113027'] },
  { bossName: 'Magatsu Mitake Narukami no Mikoto', matIds: ['113032', '113033', '113034'] },
  { bossName: 'Everlasting Lord of Arcane Wisdom', matIds: ['113041', '113042', '113043'] },
  { bossName: "Guardian of Apep's Oasis", matIds: ['113046', '113047', '113048'] },
  { bossName: 'All-Devouring Narwhal', matIds: ['113054', '113055', '113056'] },
  { bossName: 'The Knave', matIds: ['113060', '113061', '113062'] },
  { bossName: 'Lord of Eroded Primal Fire', matIds: ['113068', '113069', '113070'] },
  { bossName: 'The Game Before the Gate', matIds: ['113073', '113074', '113075'] },
  { bossName: 'The Doctor', matIds: ['113081', '113082', '113083'] },
  { bossName: 'Exalted Master of the Heretical Path', matIds: ['113087', '113088', '113089'] },
];

const GI_BOSS_MAT_NAME_FALLBACKS = {
  113081: 'Mask of the Virtuous Doctor',
  113082: "Madman's Restraint",
  113083: 'Elixir of the Heretic',
  113087: 'Counterfeit Resin',
  113088: 'Twisted Withered Branch',
  113089: 'Profaned Sprout',
};

function giRequirements(raw) {
  if (!raw?.materials) return null;
  const lookup = giItemLookup();
  const asc = sumMaterials(raw.materials.ascensions || [], lookup, 'gi');
  const skills = [];
  const groups = giTalentGroups(raw);
  for (const group of groups) skills.push(...(group || []));
  const tal = sumMaterials(skills, lookup, 'gi');
  const talentStages = groups.map((group) => (group || []).map((row) => {
    const stage = sumMaterials([row], lookup, 'gi');
    return {
      items: stage.items.sort((a, b) => kindRank(a.kind) - kindRank(b.kind)),
      cost: stage.cost,
    };
  }));
  return {
    ascension: asc.items.sort((a, b) => kindRank(a.kind) - kindRank(b.kind)).slice(0, 9),
    talents: tal.items.sort((a, b) => kindRank(a.kind) - kindRank(b.kind)).slice(0, 9),
    talentStages,
    ascCost: asc.cost,
    talentCost: tal.cost,
    currency: asc.cost + tal.cost,
  };
}

function materialIdSort(a, b) {
  const ai = Number.parseInt(a?.id, 10);
  const bi = Number.parseInt(b?.id, 10);
  if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) return ai - bi;
  return String(a?.name || '').localeCompare(String(b?.name || ''));
}

function sumGiWeaponMaterials(weapon) {
  const rows = Object.values(weapon?.materials || {}).map((stage) => ({
    cost: Number(stage?.cost?.sourceSnapshot || 0),
    mats: (stage?.mats?.sourceSnapshot || []).map((mat) => ({
      id: mat.id,
      name: mat.name,
      count: mat.count,
      rank: mat.rank,
    })),
  }));
  return sumMaterials(rows, giItemLookup(), 'gi');
}

function buildGiWeaponRoster() {
  if (!exists('Nanoka/gi/live/weapons.json')) return [];
  return readJson('Nanoka/gi/live/weapons.json')
    .filter((weapon) => weapon?.name && rarityNumber(weapon.rarity, 0) >= 3)
    .map((weapon) => {
      const summed = sumGiWeaponMaterials(weapon);
      const type = weaponMap[weapon.type] || weapon.type || 'Weapon';
      return {
        id: String(weapon.id),
        name: cleanText(weapon.name, 90),
        rarity: rarityNumber(weapon.rarity, 0),
        weaponType: type,
        type,
        icon: dbAsset(weapon.assets?.icon || weapon.assets?.gacha),
        art: dbAsset(weapon.assets?.gacha || weapon.assets?.icon),
        items: summed.items.sort(materialIdSort).slice(0, 14),
        cost: summed.cost,
      };
    })
    .sort((a, b) => b.rarity - a.rarity || a.weaponType.localeCompare(b.weaponType) || a.name.localeCompare(b.name));
}

function giSkillIconName(skill) {
  const promote = skill?.promote;
  const promoted = promote && typeof promote === 'object'
    ? Object.values(promote).find((row) => row?.icon)
    : null;
  return promoted?.icon || skill?.icon || null;
}

function giSkillIcons(raw) {
  return (raw?.skills || [])
    .slice(0, 3)
    .map((skill) => {
      const icon = giSkillIconName(skill);
      return icon ? dbAsset(`Nanoka/gi/assets/skills/${icon}.webp`) : null;
    })
    .filter(Boolean);
}

function loadGiSignatureMap() {
  const rel = 'AsIveHoarded/gi-signatures.json';
  if (!exists(rel)) return new Map();
  const src = readJson(rel);
  const rows = src.signatures || src;
  const map = new Map();
  for (const [name, entry] of Object.entries(rows || {})) {
    if (!name || !entry?.weaponId) continue;
    map.set(normKey(name), {
      id: String(entry.weaponId),
      name: cleanText(entry.weaponName || '', 90),
      build: cleanText(entry.build || '', 90) || undefined,
      educated: !!entry.educated,
    });
  }
  return map;
}

function kindRank(kind) {
  return { gem: 1, weapon: 2, boss: 3, specialty: 4, mob: 5, book: 6, weekly: 7, crown: 8 }[kind] || 9;
}

function buildGiRoster() {
  const signatures = loadGiSignatureMap();
  const chars = readJson('Nanoka/gi/live/characters.json')
    .filter((ch) => ch.name && (ch.rarity === 4 || ch.rarity === 5))
    .map((ch) => {
      const rawRel = `Nanoka/gi/live/raw/characters/${ch.id}.json`;
      const raw = exists(rawRel) ? readJson(rawRel) : null;
      const book = giBookFamily(raw);
      const circleIcon = dbAsset(ch.assets?.circle);
      const fallbackIcon = dbAsset(ch.assets?.icon);
      const nameKey = normKey(ch.name);
      const iconZoom = MANUAL_ICON_ZOOM.gi[nameKey] || (!circleIcon && !!fallbackIcon ? 1.18 : undefined);
      const birthdayArtPool = GENSHIN_BIRTHDAY_ART.get(nameKey) || [];
      const signature = signatures.get(nameKey);
      const skillIcons = giSkillIcons(raw);
      return {
        id: 'gi-' + ch.id,
        n: ch.name,
        title: displayTitle('gi', ch),
        r: ch.rarity,
        el: ch.element || raw?.element || 'Unknown',
        w: weaponMap[ch.weapon] || ch.weapon || 'Unknown',
        tag: ch.profile?.region ? String(ch.profile.region).replace(/^ASSOC_TYPE_/, '').replace(/_/g, ' ') : undefined,
        release: parseRelease(ch.release),
        icon: circleIcon || fallbackIcon,
        iconZoom,
        art: dbAsset(ch.assets?.gacha || ch.assets?.card || ch.assets?.circle || ch.assets?.icon),
        birthdayArtPool: birthdayArtPool.length ? birthdayArtPool : undefined,
        ...(skillIcons.length ? { skillIcons } : {}),
        book,
        ...(signature ? {
          signatureWeapon: signature,
          signatureWeaponId: signature.id,
          signatureWeaponName: signature.name,
          signatureWeaponEducated: signature.educated || undefined,
        } : {}),
        req: giRequirements(raw),
      };
    });
  chars.sort((a, b) => (b.release || 0) - (a.release || 0) || Number(b.r) - Number(a.r) || a.n.localeCompare(b.n));
  markRecentBuckets(chars, (ch) => ch.release, 9);
  return chars;
}

function hsrMaterialKind(id) {
  const s = String(id);
  if (s === '2') return 'currency';
  if (/^1105\d{2}$/.test(s)) return 'weekly';
  if (/^1104\d{2}$/.test(s)) return 'boss';
  if (/^110[123]\d{2}$/.test(s)) return 'book';
  if (/^11[1-4]\d{3}$/.test(s)) return 'mob';
  return 'mob';
}

const HSR_RARITY_SCORE = {
  Normal: 1,
  NotNormal: 2,
  Rare: 3,
  SuperRare: 4,
  VeryRare: 5,
};

function hsrRarityScore(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  return HSR_RARITY_SCORE[String(value || '')] || 3;
}

function sumHsrMaterialList(materials, lookup = nanokaItemLookup('hsr')) {
  const byKey = new Map();
  let credits = 0;
  for (const mat of materials || []) {
    const id = String(mat.item_id ?? mat.itemId ?? mat.id ?? '');
    const qty = Number(mat.item_num ?? mat.quantity ?? mat.count ?? 0);
    if (!id || !qty) continue;
    if (id === '2') {
      credits += qty;
      continue;
    }
    const item = lookup.get(id);
    const name = cleanText(item?.name || mat.name || id, 80);
    const cur = byKey.get(id) || {
      id,
      name,
      qty: 0,
      rar: hsrRarityScore(item?.rarity || mat.rarity),
      kind: hsrMaterialKind(id),
      icon: dbAsset(item?.assets?.icon || mat.assets?.icon),
      ...materialSourceFields('hsr', item || mat, id),
    };
    cur.qty += qty;
    cur.rar = Math.max(cur.rar, hsrRarityScore(item?.rarity || mat.rarity));
    if (!cur.icon) cur.icon = dbAsset(item?.assets?.icon || mat.assets?.icon);
    if (!cur.source) cur.source = sourceSummary(item || mat, null, 'hsr', id) || undefined;
    if (!cur.sourceDetails?.length) {
      const details = sourceDetailsForItem('hsr', item || mat, id);
      if (details.length) cur.sourceDetails = details;
    }
    byKey.set(id, cur);
  }
  return { items: [...byKey.values()], cost: credits };
}

function hsrRequirements(raw) {
  if (!raw?.skill_trees && !raw?.stats) return null;
  const lookup = nanokaItemLookup('hsr');
  const ascensionRows = [];
  for (const row of Object.values(raw.stats || {})) {
    ascensionRows.push(...(row?.cost || []));
  }
  const asc = sumHsrMaterialList(ascensionRows, lookup);
  const sortItems = (arr) => arr.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || String(a.id).localeCompare(String(b.id)));
  // The 4 main traces are point01 (Basic ATK, max 6), point02 (Skill),
  // point03 (Ultimate), point04 (Talent) — each level's material_list is the
  // incremental cost to reach that level, so they form Genshin-style stages.
  // Everything else (point05+) is minor traces / stat nodes — always included.
  const HSR_MAIN_POINTS = ['point01', 'point02', 'point03', 'point04'];
  const talentStages = HSR_MAIN_POINTS.map((pk) => {
    const point = raw.skill_trees?.[pk];
    if (!point) return [];
    // the level is the object key ("1".."10"); level 1 is the free unlock, so
    // each stage (keys 2..max) is the incremental cost to reach that level.
    return Object.entries(point)
      .filter(([k, lv]) => Number(k) > 1 && lv && Array.isArray(lv.material_list) && lv.material_list.length)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, lv]) => {
        const s = sumHsrMaterialList(lv.material_list, lookup);
        return { cost: s.cost, items: s.items };
      });
  });
  const minorRows = [];
  for (const [pk, point] of Object.entries(raw.skill_trees || {})) {
    if (HSR_MAIN_POINTS.includes(pk)) continue;
    for (const level of Object.values(point || {})) minorRows.push(...(level?.material_list || []));
  }
  const minor = sumHsrMaterialList(minorRows, lookup);
  const traceRows = [];
  for (const point of Object.values(raw.skill_trees || {})) {
    for (const level of Object.values(point || {})) {
      traceRows.push(...(level?.material_list || []));
    }
  }
  const traces = sumHsrMaterialList(traceRows, lookup);
  return {
    ascension: sortItems(asc.items).slice(0, 14),
    talents: sortItems(traces.items).slice(0, 14),
    talentStages,
    talentBase: sortItems(minor.items),
    talentBaseCost: minor.cost,
    ascCost: asc.cost,
    talentCost: traces.cost,
    currency: asc.cost + traces.cost,
  };
}

function buildHsrLightConeReqMap() {
  const out = new Map();
  if (!exists('Nanoka/hsr/live/lightcones.json')) return out;
  const lookup = nanokaItemLookup('hsr');
  for (const lc of readJson('Nanoka/hsr/live/lightcones.json')) {
    if (!lc?.name) continue;
    const rows = [];
    for (const asc of lc.ascensions || []) {
      rows.push(...(asc.requirements || []));
    }
    const summed = sumHsrMaterialList(rows, lookup);
    out.set(normKey(lc.name), {
      name: cleanText(lc.name, 90),
      cost: summed.cost,
      items: summed.items.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || String(a.id).localeCompare(String(b.id))).slice(0, 14),
      icon: dbAsset(lc.assets?.mediumIcon),
      art: dbAsset(lc.assets?.fullFigure),
      path: hsrReadablePath(lc.path),
    });
  }
  return out;
}

function buildHsrLightConeRoster() {
  if (!exists('Nanoka/hsr/live/lightcones.json')) return [];
  const lookup = nanokaItemLookup('hsr');
  return readJson('Nanoka/hsr/live/lightcones.json')
    .filter((lc) => lc?.name && rarityNumber(lc.rarity, 0) >= 3)
    .map((lc) => {
      const rows = [];
      for (const asc of lc.ascensions || []) rows.push(...(asc.requirements || []));
      const summed = sumHsrMaterialList(rows, lookup);
      const pathName = hsrReadablePath(lc.path);
      return {
        id: String(lc.id),
        name: cleanText(lc.name, 90),
        rarity: rarityNumber(lc.rarity, 0),
        path: pathName,
        type: pathName,
        icon: dbAsset(lc.assets?.mediumIcon),
        art: dbAsset(lc.assets?.fullFigure || lc.assets?.mediumIcon),
        items: summed.items.sort(materialIdSort).slice(0, 14),
        cost: summed.cost,
      };
    })
    .sort((a, b) => b.rarity - a.rarity || String(a.path || '').localeCompare(String(b.path || '')) || a.name.localeCompare(b.name));
}

function hsrSignatureForCharacter(name, pathName) {
  const candidates = HSR_SIGNATURE_LIGHT_CONES.get(normKey(name)) || [];
  if (!candidates.length) return null;
  if (!pathName) return candidates[0];
  return candidates.find((lc) => lc.path === pathName) || null;
}

function buildHsrReqMap() {
  const out = new Map();
  if (!exists('Nanoka/hsr/live/characters.json')) return out;
  for (const ch of readJson('Nanoka/hsr/live/characters.json')) {
    const rawRel = `Nanoka/hsr/live/raw/characters/${ch.id}.json`;
    if (!ch?.name || !exists(rawRel)) continue;
    const req = hsrRequirements(readJson(rawRel));
    if (req) out.set(String(ch.name).toLowerCase(), req);
  }
  return out;
}

function setReqMapEntry(map, name, req) {
  if (!name || !req) return;
  map.set(String(name).toLowerCase(), req);
  map.set(normKey(name), req);
}

function zzzMaterialKind(id, item = null) {
  const name = String(item?.name || id || '');
  if (String(id) === '10') return 'currency';
  if (/Certification Seal/i.test(name)) return 'gem';
  if (/\bChip\b/i.test(name)) return 'book';
  if (/Hamster Cage/i.test(name)) return 'crown';
  if (/^Higher Dimensional Data/i.test(name)) return 'boss';
  if (/^1100\d+/.test(String(id)) || /Notorious|Exuvia|Grip|Drive|Engine|Refinement|Spike|Substance|Thorn/i.test(name)) return 'weekly';
  return 'mob';
}

function zzzSpriteForItem(item, icon = null) {
  const asset = String(item?.assets?.icon || item?.sourceSnapshot?.icon_path || '');
  if (/Ex(?:Big|Small)Boss\d+\.webp$/i.test(asset) || /^Ex(?:Big|Small)Boss\d+$/i.test(asset)) {
    return icon || dbAsset(item?.assets?.icon || `Nanoka/zzz/assets/items/${asset}.webp`);
  }
  return null;
}

function wuwaMaterialKind(id, item = null) {
  const s = String(id);
  const name = String(item?.name || '');
  const tags = [
    ...(item?.source?.tag || []),
    ...(item?.sourceSnapshot?.tag || []),
  ].join(' ');
  if (s === '2') return 'currency';
  if (/Skill Upgrade Material/i.test(tags)) return 'weekly';
  if (/Resonator Ascension Material/i.test(tags)) return 'boss';
  if (/Ascension Material/i.test(tags) && /^42/.test(s)) return 'specialty';
  if (/^4302|^43021/.test(s)) return 'book';
  if (/^411/.test(s) || /Core|Ring|Residuum|Pendant/i.test(name)) return 'mob';
  if (/^414/.test(s)) return 'boss';
  return 'mob';
}

function sumNanokaMaterialPairs(game, pairs, kindForId, currencyId) {
  const lookup = nanokaItemLookup(game);
  const byKey = new Map();
  let cost = 0;
  for (const [rawId, rawQty] of pairs || []) {
    const id = String(rawId);
    const qty = Number(rawQty || 0);
    if (!id || !qty) continue;
    if (id === String(currencyId)) {
      cost += qty;
      continue;
    }
    const item = lookup.get(id);
    const name = cleanText(item?.name || id, 90);
    const key = `id:${id}`;
    const kind = kindForId(id, item);
    const icon = dbAsset(item?.assets?.icon);
    const sprite = game === 'zzz' ? zzzSpriteForItem(item, icon) : null;
    const cur = byKey.get(key) || {
      id,
      name,
      qty: 0,
      rar: rarityNumber(item?.rarity, 1),
      kind,
      icon,
      ...(sprite ? { sprite } : {}),
      ...materialSourceFields(game, item, id),
    };
    cur.qty += qty;
    cur.rar = Math.max(cur.rar, rarityNumber(item?.rarity, 1));
    if (!cur.icon) cur.icon = icon;
    if (!cur.sprite && sprite) cur.sprite = sprite;
    if (!cur.source) cur.source = sourceSummary(item, null, game, id) || undefined;
    if (!cur.sourceDetails?.length) {
      const details = sourceDetailsForItem(game, item, id);
      if (details.length) cur.sourceDetails = details;
    }
    byKey.set(key, cur);
  }
  return {
    items: [...byKey.values()].sort(materialIdSort),
    cost,
  };
}

function objectMaterialPairs(obj) {
  return Object.entries(obj || {}).map(([id, qty]) => [id, qty]);
}

function zzzRequirements(raw) {
  if (!raw) return null;
  const ascPairs = [];
  for (const stage of Object.values(raw.level || {})) ascPairs.push(...objectMaterialPairs(stage?.materials));

  const skillPairs = [];
  for (const skill of Object.values(raw.skill || {})) {
    for (const stage of Object.values(skill?.material || {})) skillPairs.push(...objectMaterialPairs(stage));
  }
  for (const stage of Object.values(raw.passive?.materials || {})) skillPairs.push(...objectMaterialPairs(stage));

  const asc = sumNanokaMaterialPairs('zzz', ascPairs, zzzMaterialKind, '10');
  const talents = sumNanokaMaterialPairs('zzz', skillPairs, zzzMaterialKind, '10');
  return {
    ascension: asc.items,
    talents: talents.items,
    ascCost: asc.cost,
    talentCost: talents.cost,
    currency: asc.cost + talents.cost,
  };
}

function buildZzzReqMap() {
  const out = new Map();
  if (!exists('Nanoka/zzz/live/agents.json')) return out;
  for (const ch of readJson('Nanoka/zzz/live/agents.json')) {
    const rawRel = `Nanoka/zzz/live/raw/agents/${ch.id}.json`;
    if (!ch?.name || !exists(rawRel)) continue;
    setReqMapEntry(out, ch.name, zzzRequirements(readJson(rawRel)));
  }
  return out;
}

const WW_MAX_SKILL_TOTALS = {
  shell: 2030000,
  common: [25, 28, 40, 57],
  skill: [25, 28, 55, 67],
  weekly: 26,
};

function wwConsumeEntries(raw) {
  const entries = [];
  for (const node of Object.values(raw?.skill_trees || {})) {
    for (const c of node?.consume || []) entries.push(c);
  }
  return entries;
}

function wwCommonDropFamily(raw) {
  const ids = [];
  for (const stage of Object.values(raw?.ascensions || {})) {
    for (const c of stage || []) {
      const id = String(c.key);
      if (/^411\d+$/.test(id)) ids.push(id);
    }
  }
  return [...new Set(ids)].sort((a, b) => Number(a) - Number(b)).slice(0, 4);
}

function wwSkillMaterialFamily(raw) {
  const prefixes = new Map();
  for (const c of wwConsumeEntries(raw)) {
    const id = String(c.key);
    if (!/^4302\d+[34]$/.test(id)) continue;
    const prefix = id.slice(0, -1);
    prefixes.set(prefix, (prefixes.get(prefix) || 0) + Number(c.value || 0));
  }
  const [prefix] = [...prefixes.entries()].sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0] || [];
  return prefix ? ['1', '2', '3', '4'].map((tier) => `${prefix}${tier}`) : [];
}

function wwWeeklyMaterial(raw) {
  const ids = new Map();
  for (const c of wwConsumeEntries(raw)) {
    const id = String(c.key);
    if (!/^414\d+$/.test(id)) continue;
    ids.set(id, (ids.get(id) || 0) + Number(c.value || 0));
  }
  const [id] = [...ids.entries()].sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0] || [];
  return id || null;
}

function wuwaRequirements(raw) {
  if (!raw) return null;
  const ascPairs = [];
  for (const stage of Object.values(raw.ascensions || {})) {
    for (const c of stage || []) ascPairs.push([String(c.key), Number(c.value || 0)]);
  }
  const skillPairs = [['2', WW_MAX_SKILL_TOTALS.shell]];
  wwCommonDropFamily(raw).forEach((id, i) => skillPairs.push([id, WW_MAX_SKILL_TOTALS.common[i] || 0]));
  wwSkillMaterialFamily(raw).forEach((id, i) => skillPairs.push([id, WW_MAX_SKILL_TOTALS.skill[i] || 0]));
  const weekly = wwWeeklyMaterial(raw);
  if (weekly) skillPairs.push([weekly, WW_MAX_SKILL_TOTALS.weekly]);

  const asc = sumNanokaMaterialPairs('ww', ascPairs, wuwaMaterialKind, '2');
  const talents = sumNanokaMaterialPairs('ww', skillPairs, wuwaMaterialKind, '2');
  return {
    ascension: asc.items,
    talents: talents.items,
    ascCost: asc.cost,
    talentCost: talents.cost,
    currency: asc.cost + talents.cost,
  };
}

function buildWuwaReqMap() {
  const out = new Map();
  if (!exists('Nanoka/ww/live/characters.json')) return out;
  for (const ch of readJson('Nanoka/ww/live/characters.json')) {
    const rawRel = `Nanoka/ww/live/raw/characters/${ch.id}.json`;
    if (!ch?.name || !exists(rawRel)) continue;
    setReqMapEntry(out, ch.name, wuwaRequirements(readJson(rawRel)));
  }
  return out;
}

function buildPrydwenRoster(game, mapFacts, reqByName = null) {
  const overlayGame = game === 'ww' ? 'wuwa' : game;
  const overlay = localAvatarOverlay(game);
  const rawChars = readJson(`Prydwen/${game}/characters.json`);
  // ZZZ: only surface agents Nanoka actually has — drop Prydwen-only placeholders
  // (which arrive without icons/data). Other games keep the full Prydwen roster.
  const chars = (game === 'zzz' ? rawChars.filter((ch) => overlay.has(normKey(ch.name))) : rawChars).map((ch) => {
    const mapped = mapFacts(ch.facts || {});
    const local = overlay.get(normKey(ch.name));
    const req = reqByName?.get(String(ch.name || '').toLowerCase()) || reqByName?.get(normKey(ch.name)) || null;
    const signatureLightCone = game === 'hsr' ? hsrSignatureForCharacter(ch.name, mapped.path) : null;
    const signatureReq = signatureLightCone ? hsrLightConeReqByName.get(normKey(signatureLightCone.name)) : null;
    const holidayArtPool = game === 'hsr' ? (HSR_HOLIDAY_ART.get(normKey(ch.name)) || []) : [];
    const icon = local?.icon || dbAsset(ch.art?.icon || ch.art?.card || ch.art?.full);
    const iconZoom = MANUAL_ICON_ZOOM[overlayGame]?.[normKey(ch.name)] || (!local?.icon && icon ? 1.18 : undefined);
    const art = dbAsset(ch.art?.full || ch.art?.card || ch.art?.icon) || local?.fallbackArt;
    const card = dbAsset(ch.art?.card || ch.art?.full || ch.art?.icon) || local?.fallbackArt;
    const mergedReq = req || signatureReq
      ? {
          ...(req || {}),
          ...(signatureReq ? { weapon: {
            name: signatureReq.name,
            icon: signatureReq.icon,
            art: signatureReq.art,
            path: signatureReq.path,
            items: signatureReq.items || [],
            cost: Number(signatureReq.cost || 0),
          } } : {}),
          currency: Number(req?.currency || 0) + Number(signatureReq?.cost || 0),
        }
      : null;
    return {
      id: `${game}-${ch.id}`,
      n: ch.name,
      title: local?.title || displayTitle(overlayGame, ch, ch.facts || {}),
      slug: ch.slug,
      updated: parsePrydwenDate(ch.updatedText),
      sourceOrder: local?.releaseOrder || 0,
      icon,
      iconZoom,
      art,
      card,
      holidayArtPool: holidayArtPool.length ? holidayArtPool : undefined,
      ...(signatureLightCone ? {
        signatureLightCone: {
          id: signatureLightCone.id,
          name: signatureLightCone.name,
          icon: signatureLightCone.icon,
          art: signatureLightCone.art,
          path: signatureLightCone.path,
        },
        signatureWeapon: {
          id: signatureLightCone.id,
          name: signatureLightCone.name,
          path: signatureLightCone.path,
          educated: false,
        },
        signatureWeaponId: signatureLightCone.id,
        signatureWeaponName: signatureLightCone.name,
        overviewArt: signatureLightCone.art,
        overviewArtPool: [signatureLightCone.art],
      } : {}),
      status: ch.contentStatus,
      labels: ch.statusLabels || [],
      ...mapped,
      ...(mergedReq ? { req: mergedReq } : {}),
    };
  });
  if (game === 'ww') {
    chars.sort((a, b) => (b.sourceOrder || 0) - (a.sourceOrder || 0) || rarityScore(b.r) - rarityScore(a.r) || a.n.localeCompare(b.n));
  } else {
    chars.sort((a, b) => (b.updated || 0) - (a.updated || 0) || rarityScore(b.r) - rarityScore(a.r) || a.n.localeCompare(b.n));
  }
  markRecentBuckets(chars, (ch) => ch.updated, game === 'ww' ? 9 : 9);
  return chars;
}

function loadEndfieldCollectionItems(rel, kind) {
  if (!exists(rel)) return [];
  const raw = readJson(rel);
  const entries = Array.isArray(raw) ? raw : (raw.entries || []);
  return entries
    .filter((item) => item?.name)
    .map((item) => ({
      id: `${kind}:${item.id || normKey(item.name)}`,
      name: cleanText(item.name, 90),
      n: cleanText(item.name, 90),
      kind,
      rar: Number(String(item.fields?.rarity || '').match(/\d+/)?.[0]) || 4,
      icon: dbAsset(item.art || item.assets?.icon || item.assets?.image),
      assetId: item.assetId || String(item.art || '').match(/-([a-f0-9]{8,})\.[a-z0-9]+$/i)?.[1],
      type: cleanText(item.fields?.type || kind, 60),
      source: 'Endfield database',
    }));
}

const ENDFIELD_ITEM_BY_ASSET = new Map();
const ENDFIELD_ITEM_LOOKUP = (() => {
  const map = new Map();
  for (const item of [
    ...loadEndfieldCollectionItems('Prydwen/endfield/collections/weapons.json', 'weapon'),
    ...loadEndfieldCollectionItems('Prydwen/endfield/collections/gear.json', 'gear'),
  ]) {
    map.set(normKey(item.name), item);
    if (item.assetId) ENDFIELD_ITEM_BY_ASSET.set(item.assetId, item);
  }
  return map;
})();

function endfieldItemNames(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => endfieldItemNames(entry));
  return String(value)
    .split(/\s*,\s*|\s*;\s*/)
    .map((name) => cleanText(name, 90))
    .filter(Boolean);
}

function endfieldItemPayload(name, fallbackKind = 'gear') {
  const hit = ENDFIELD_ITEM_LOOKUP.get(normKey(name));
  if (hit) return { ...hit };
  return {
    id: `${fallbackKind}:${normKey(name) || name}`,
    name,
    n: name,
    kind: fallbackKind,
    rar: 4,
    source: 'Endfield database',
  };
}

function endfieldItemsFromCharacter(ch, field, fallbackKind = 'gear') {
  const values = [
    ...(field === 'preferredWeapons' ? endfieldItemNames(ch.preferredWeapons) : []),
    ...endfieldItemNames(ch[field]),
    ...endfieldItemNames(ch.facts?.[field]),
  ];
  return uniq(values).map((name) => endfieldItemPayload(name, fallbackKind));
}

function endfieldPageForCharacter(ch) {
  const candidates = [
    ch.id,
    ch.slug,
    ch.pageName,
    ch.name,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  for (const slug of uniq(candidates)) {
    const rel = `Prydwen/endfield/pages/characters/${slug}.json`;
    if (exists(rel)) return readJson(rel);
  }
  return null;
}

function extractRankedRecommendationNames(text) {
  return String(text || '')
    .split(/\n\s*\d+\s*\n+/)
    .slice(1)
    .map((chunk) => {
      const line = chunk
        .split(/\n+/)
        .map((row) => cleanText(row, 120))
        .find((row) => row && !/%/.test(row) && !/^(?:solo|team)\b/i.test(row));
      return line ? cleanText(line.replace(/\s*\(P\s*\d+\s*\)\s*$/i, ''), 90) : '';
    })
    .filter((name) => name && !/^no set$/i.test(name));
}

function endfieldRecommendationItems(ch, recKey, fallbackKind) {
  const page = endfieldPageForCharacter(ch);
  const section = page?.recommendations?.[recKey]?.sections?.find((row) => row?.text);
  if (!section) return [];
  const names = uniq(extractRankedRecommendationNames(section.text));
  const assets = section.assets || [];
  return names.map((name, index) => {
    const asset = assets[index];
    const byAsset = asset ? ENDFIELD_ITEM_BY_ASSET.get(asset.id || asset.sourceHash) : null;
    const byName = ENDFIELD_ITEM_LOOKUP.get(normKey(name));
    const hit = byName || byAsset;
    if (hit) {
      return {
        ...hit,
        source: 'Prydwen recommendation',
      };
    }
    return {
      id: `${fallbackKind}:${normKey(name) || name}`,
      name,
      n: name,
      kind: fallbackKind,
      rar: 4,
      icon: dbAsset(asset?.path),
      source: 'Prydwen recommendation',
    };
  }).filter((item) => item?.icon || ENDFIELD_ITEM_LOOKUP.has(normKey(item?.name)));
}

function buildEndfieldItemGroups(roster, fields, fallbackTitle) {
  const source = cmRosterSource(roster);
  const groups = new Map();
  for (const ch of source) {
    for (const field of fields) {
      for (const mat of ch[field] || []) {
        if (!mat.icon) continue;
        const key = mat.id || mat.name || mat.n;
        if (!key) continue;
        if (!groups.has(key)) {
          groups.set(key, {
            region: mat.type || fallbackTitle,
            title: mat.name || mat.n,
            mats: [{ ...mat }],
            chars: [],
          });
        }
        pushUnique(groups.get(key).chars, ch.n);
      }
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      chars: group.chars.sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => String(a.region || '').localeCompare(String(b.region || '')) || String(a.title || '').localeCompare(String(b.title || '')));
}

function buildEndfieldRoster() {
  const src = exists('EndfieldWiki/endfield/characters.json')
    ? readJson('EndfieldWiki/endfield/characters.json')
    : readJson('Prydwen/endfield/characters.json');
  const chars = src.map((ch) => {
    const recommendedWeapons = endfieldRecommendationItems(ch, 'best-weapons', 'weapon');
    const recommendedGear = endfieldRecommendationItems(ch, 'best-gear', 'gear');
    const preferredWeapons = recommendedWeapons.length ? recommendedWeapons : endfieldItemsFromCharacter(ch, 'preferredWeapons', 'weapon');
    const skillItems = recommendedGear.length ? recommendedGear : endfieldItemsFromCharacter(ch, 'matskill', 'gear');
    const statItems = endfieldItemsFromCharacter(ch, 'matstats', 'gear');
    return {
      id: 'ae-' + (ch.id || ch.slug || ch.name.toLowerCase().replace(/\W+/g, '-')),
      n: ch.name,
      title: cleanText(ch.class || ch.facts?.class || '', 90) || displayTitle('ae', ch, ch.facts || {}),
      r: ch.rarity || ch.facts?.rarity || 5,
      el: ch.element || ch.facts?.element || 'Physical',
      cls: ch.class || ch.facts?.class || 'Operator',
      w: ch.weapon || ch.facts?.weapon || 'Unknown',
      tag: ch.faction,
      icon: dbAsset(ch.art?.icon?.path || ch.art?.icon || ch.art?.card),
      art: dbAsset(ch.art?.splash?.path || ch.art?.banner?.path || ch.art?.full || ch.art?.card || ch.art?.icon?.path),
      card: dbAsset(ch.art?.banner?.path || ch.art?.portrait?.path || ch.art?.splash?.path || ch.art?.card),
      aePreferredItems: preferredWeapons,
      aeSkillItems: skillItems.length ? skillItems : preferredWeapons,
      aeStatItems: statItems,
    };
  });
  chars.sort((a, b) => rarityScore(b.r) - rarityScore(a.r) || a.n.localeCompare(b.n));
  markRecentBuckets(chars, () => 0, 9);
  return chars;
}

function rarityScore(r) {
  if (r === 'S') return 5;
  if (r === 'A') return 4;
  return Number(r) || 0;
}

const PROTAGONIST_FORM_ORDER = {
  gi: ['Anemo', 'Geo', 'Electro', 'Dendro', 'Hydro', 'Pyro'],
  hsr: ['Destruction', 'Preservation', 'Harmony', 'Remembrance', 'Elation'],
  wuwa: ['Spectro', 'Havoc', 'Aero'],
  ae: ['Guard'],
};

function protagonistSpec(game, ch) {
  if (game === 'gi' && ch.n === 'Traveler') {
    return { key: 'traveler', name: 'Traveler', aliases: ['Aether', 'Lumine'] };
  }
  if (game === 'hsr' && /^Trailblazer\b/i.test(ch.n)) {
    return { key: 'trailblazer', name: 'Trailblazer', aliases: ['Stelle', 'Caelus', 'TB'] };
  }
  if (game === 'wuwa' && /^Rover\b/i.test(ch.n)) {
    return { key: 'rover', name: 'Rover' };
  }
  if (game === 'ae' && /^Endministrator$/i.test(ch.n)) {
    return { key: 'endministrator', name: 'Endministrator' };
  }
  return null;
}

function protagonistGender(game, ch) {
  const raw = [ch.id, ch.n, ch.icon, ch.art, ch.card].join(' ').toLowerCase();
  if (game === 'gi') {
    if (/10000007|playergirl|lumine|female/.test(raw)) return 'female';
    if (/10000005|playerboy|aether|male/.test(raw)) return 'male';
  }
  if (game === 'ae') {
    if (/\bfemale\b/.test(raw)) return 'female';
    if (/\bmale\b/.test(raw)) return 'male';
  }
  return null;
}

function genderLabel(gender) {
  return gender ? gender.charAt(0).toUpperCase() + gender.slice(1) : undefined;
}

function protagonistVariantValue(game, ch) {
  if (game === 'hsr') return ch.path || ch.el || 'Base';
  if (game === 'ae') return ch.cls || ch.el || 'Base';
  return ch.el || ch.path || ch.cls || 'Base';
}

function protagonistFormLabel(game, ch) {
  if (game === 'hsr') return [ch.path, ch.el ? `(${ch.el})` : ''].filter(Boolean).join(' ');
  if (game === 'ae') return ch.cls || ch.el || 'Base';
  return protagonistVariantValue(game, ch);
}

function protagonistSortValue(game, form) {
  const order = PROTAGONIST_FORM_ORDER[game] || [];
  const variantRank = order.findIndex((item) => item === form.variantValue || item === form.path || item === form.el || item === form.cls);
  const genderRank = form.gender === 'male' ? 0 : form.gender === 'female' ? 1 : 0;
  return [
    variantRank === -1 ? 99 : variantRank,
    genderRank,
    String(form.n || '').localeCompare(String(form.n || '')),
  ];
}

function compareProtagonistForms(game, a, b) {
  const av = protagonistSortValue(game, a);
  const bv = protagonistSortValue(game, b);
  return av[0] - bv[0] || av[1] - bv[1] || String(a.id).localeCompare(String(b.id));
}

function protagonistForm(game, baseName, ch) {
  const gender = protagonistGender(game, ch);
  const variantValue = protagonistVariantValue(game, ch);
  const variantKey = normKey(variantValue);
  const copy = { ...ch };
  delete copy.forms;
  return {
    ...copy,
    n: baseName,
    rawName: ch.n,
    baseName,
    variantValue,
    variantKey,
    formKey: [variantKey, gender || 'any'].join(':'),
    formLabel: protagonistFormLabel(game, ch),
    gender,
    genderLabel: genderLabel(gender),
  };
}

function mergeProtagonistForms(game, roster) {
  const groups = new Map();
  const specs = new Map();

  for (const ch of roster) {
    const spec = protagonistSpec(game, ch);
    if (!spec) continue;
    if (!groups.has(spec.key)) groups.set(spec.key, []);
    if (!specs.has(spec.key)) specs.set(spec.key, spec);
    groups.get(spec.key).push(ch);
  }
  if (!groups.size) return roster;

  const mergedByKey = new Map();
  for (const [key, rows] of groups.entries()) {
    const spec = specs.get(key);
    const forms = rows
      .map((ch) => protagonistForm(game, spec.name, ch))
      .sort((a, b) => compareProtagonistForms(game, a, b));
    const base = forms[0] || protagonistForm(game, spec.name, rows[0]);
    mergedByKey.set(key, {
      ...base,
      id: `${game}-${spec.key}`,
      n: spec.name,
      rawName: spec.name,
      aliases: spec.aliases || [],
      title: base.title,
      forms,
    });
  }

  const out = [];
  const emitted = new Set();
  for (const ch of roster) {
    const spec = protagonistSpec(game, ch);
    if (!spec) {
      out.push(ch);
      continue;
    }
    if (emitted.has(spec.key)) continue;
    out.push(mergedByKey.get(spec.key));
    emitted.add(spec.key);
  }
  return out;
}

function cmRosterSource(roster) {
  const out = [];
  for (const ch of roster || []) {
    if (Array.isArray(ch.forms) && ch.forms.length) {
      ch.forms.forEach((form) => out.push({ ...form, n: ch.n, id: ch.id, aliases: ch.aliases }));
    } else {
      out.push(ch);
    }
  }
  return out;
}

function pushUnique(list, value) {
  if (!value || list.includes(value)) return;
  list.push(value);
}

function groupBy(roster, key, titleMap = (x) => x, matMap = (x) => [{ n: x }]) {
  const source = cmRosterSource(roster);
  return ordered(source.map((ch) => ch[key])).map((value) => ({
    region: titleMap(value),
    mats: matMap(value),
    chars: uniq(source.filter((ch) => ch[key] === value).map((ch) => ch.n)),
  }));
}

function groupByPreferred(roster, key, order, matMap = (x) => [{ n: x }]) {
  const source = cmRosterSource(roster);
  return ordered(source.map((ch) => ch[key]), order).map((value) => ({
    region: value,
    mats: matMap(value),
    chars: uniq(source.filter((ch) => ch[key] === value).map((ch) => ch.n)),
  }));
}

function buildGiTalentDomains(roster) {
  const lookup = giItemLookup();
  const domains = GI_DOMAIN_SPECS.map((domain) => ({
    name: domain.name,
    trios: domain.trios.map((trio, trioIndex) => ({
      name: trio.name,
      firstId: trio.firstId,
      trioIndex,
      days: trioIndex === 0 ? ['Mon', 'Thu'] : trioIndex === 1 ? ['Tue', 'Fri'] : ['Wed', 'Sat'],
      material: materialPayloadById(trio.firstId + 2, lookup, `Philosophies of ${trio.name}`, 'book'),
      chars: [],
    })),
  }));

  for (const ch of cmRosterSource(roster)) {
    const hit = (ch.req?.talents || [])
      .map((mat) => GI_BOOK_LOOKUP.get(String(mat.id)))
      .find(Boolean);
    if (hit) pushUnique(domains[hit.di].trios[hit.ti].chars, ch.n);
  }

  return domains
    .map((domain) => ({
      ...domain,
      trios: domain.trios.map((trio) => ({
        ...trio,
        chars: trio.chars.sort((a, b) => a.localeCompare(b)),
      })),
    }))
    .filter((domain) => domain.trios.some((trio) => trio.chars.length > 0));
}

function buildGiWeeklyBosses(roster) {
  const lookup = giItemLookup();
  const bosses = GI_WEEKLY_BOSS_SPECS.map((spec) => ({
    bossName: spec.bossName,
    drops: spec.matIds.map((id) => ({
      ...materialPayloadById(id, lookup, GI_BOSS_MAT_NAME_FALLBACKS[id], 'weekly'),
      chars: [],
    })),
  }));
  const byId = new Map();
  bosses.forEach((boss) => boss.drops.forEach((drop) => byId.set(String(drop.id), drop)));
  const extras = new Map();

  for (const ch of cmRosterSource(roster)) {
    for (const mat of ch.req?.talents || []) {
      const id = String(mat.id || '');
      if (!/^113\d{3}$/.test(id) || /crown/i.test(mat.name || '')) continue;
      const row = byId.get(id);
      if (row) pushUnique(row.chars, ch.n);
      else {
        if (!extras.has(id)) {
          extras.set(id, {
            ...materialPayloadById(id, lookup, mat.name || id, 'weekly'),
            chars: [],
          });
        }
        pushUnique(extras.get(id).chars, ch.n);
      }
      break;
    }
  }

  const known = bosses
    .map((boss) => ({
      ...boss,
      drops: boss.drops.map((drop) => ({
        ...drop,
        chars: drop.chars.sort((a, b) => a.localeCompare(b)),
      })),
    }))
    .filter((boss) => boss.drops.some((drop) => drop.chars.length > 0))
    .reverse();

  if (extras.size) {
    known.unshift({
      bossName: 'Unmapped Weekly Materials',
      drops: [...extras.values()].sort((a, b) => Number(b.id) - Number(a.id)),
    });
  }

  return known;
}

const HSR_BOSS_NAMES = {
  110501: "Destruction's Beginning",
  110502: 'End of the Eternal Freeze',
  110503: 'Divine Seed',
  110504: "Borehole Planet's Old Crater",
  110505: 'Salutations of Ashen Dreams',
  110506: 'Inner Beast',
  110507: 'Daythunder',
  110508: 'Vanquished Flow',
};

function buildHsrTraceGroups(roster) {
  const groups = new Map();
  for (const ch of cmRosterSource(roster)) {
    const mats = (ch.req?.talents || []).filter((m) => m.kind === 'book' && /^110\d{3}$/.test(String(m.id)));
    if (!mats.length) continue;
    const best = mats.slice().sort((a, b) => Number(b.id) - Number(a.id))[0];
    const key = String(best.id).slice(0, 5);
    if (!groups.has(key)) groups.set(key, { mat: best, chars: [] });
    pushUnique(groups.get(key).chars, ch.n);
  }
  return [...groups.values()]
    .sort((a, b) => String(a.mat.name).localeCompare(String(b.mat.name)))
    .map((g) => ({
      region: g.mat.name.replace(/\s*Trace Material$/i, ''),
      mats: [g.mat],
      chars: g.chars.sort((a, b) => a.localeCompare(b)),
    }));
}

function buildHsrWeeklyBosses(roster) {
  const groups = new Map();
  for (const ch of cmRosterSource(roster)) {
    const weekly = (ch.req?.talents || []).find((m) => m.kind === 'weekly');
    if (!weekly) continue;
    const id = String(weekly.id);
    if (!groups.has(id)) {
      groups.set(id, {
        bossName: HSR_BOSS_NAMES[id] || weekly.source || 'Echo of War',
        drops: [{ ...weekly, chars: [] }],
      });
    }
    pushUnique(groups.get(id).drops[0].chars, ch.n);
  }
  return [...groups.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([, boss]) => ({
      ...boss,
      drops: boss.drops.map((drop) => ({ ...drop, chars: drop.chars.sort((a, b) => a.localeCompare(b)) })),
    }));
}

function zzzChipFamilyName(name) {
  return String(name || '')
    .replace(/^(Basic|Advanced|Specialized)\s+/i, '')
    .replace(/\s+Chip$/i, '')
    .trim();
}

function buildZzzSkillGroups(roster) {
  const groups = new Map();
  for (const ch of cmRosterSource(roster)) {
    const chips = (ch.req?.talents || []).filter((m) => m.kind === 'book' && /\bChip\b/i.test(m.name));
    if (!chips.length) continue;
    const family = zzzChipFamilyName(chips[chips.length - 1]?.name || chips[0].name);
    const key = normKey(family);
    if (!groups.has(key)) groups.set(key, { region: `${family} Chips`, mats: [], chars: [] });
    const row = groups.get(key);
    chips.forEach((mat) => {
      if (!row.mats.some((m) => String(m.id) === String(mat.id))) row.mats.push(mat);
    });
    pushUnique(row.chars, ch.n);
  }
  return [...groups.values()]
    .map((row) => ({
      ...row,
      mats: row.mats.sort(materialIdSort),
      chars: row.chars.sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.region.localeCompare(b.region));
}

function buildZzzWeeklyBosses(roster) {
  const groups = new Map();
  for (const ch of cmRosterSource(roster)) {
    const weekly = (ch.req?.talents || []).find((m) => m.kind === 'weekly');
    if (!weekly) continue;
    const id = String(weekly.id || weekly.name);
    if (!groups.has(id)) {
      groups.set(id, {
        bossName: weekly.source || weekly.name,
        drops: [{ ...weekly, chars: [] }],
      });
    }
    pushUnique(groups.get(id).drops[0].chars, ch.n);
  }
  return [...groups.entries()]
    .sort((a, b) => String(a[1].bossName).localeCompare(String(b[1].bossName)))
    .map(([, boss]) => ({
      ...boss,
      drops: boss.drops.map((drop) => ({ ...drop, chars: drop.chars.sort((a, b) => a.localeCompare(b)) })),
    }));
}

function wuwaSkillFamilyName(name) {
  return String(name || '')
    .replace(/^(Lento|Adagio|Andante|Presto|Inert|Reactive|Polarized|Heterized|Impure|Extracted|Refined|Flawless|Waveworn Residue\s+\d+|Cadence|Broken|Monowing|Polywing|Layered|Incomplete|Aftertune|Remnant|Reverb|Spliced|Solidified|Melodic|LF|MF|HF|FF|Crude|Basic|Improved|Tailored)\s+/i, '')
    .replace(/\s+\d+$/i, '')
    .trim();
}

function wuwaSkillFamilyNameFromMats(mats) {
  const names = (mats || []).map((m) => String(m.name || '')).join(' | ');
  const known = [
    'Metallic Drip',
    'Phlogiston',
    'Helix',
    'Waveworn Residue',
    'Cadence',
    'Wing Polarizer',
    'Combustor',
    'String',
    'Carved Crystal',
    'Waveworn Shard',
  ];
  return known.find((name) => new RegExp(name.replace(/\s+/g, '\\s+'), 'i').test(names))
    || wuwaSkillFamilyName(mats[mats.length - 1]?.name || mats[0]?.name);
}

function buildWuwaSkillGroups(roster) {
  const groups = new Map();
  for (const ch of cmRosterSource(roster)) {
    const mats = (ch.req?.talents || []).filter((m) => m.kind === 'book' && /^4302/.test(String(m.id)));
    if (!mats.length) continue;
    const family = wuwaSkillFamilyNameFromMats(mats) || mats[mats.length - 1].name;
    const key = normKey(family);
    if (!groups.has(key)) groups.set(key, { region: `${family} Series`, mats: [], chars: [] });
    const row = groups.get(key);
    mats.forEach((mat) => {
      if (!row.mats.some((m) => String(m.id) === String(mat.id))) row.mats.push(mat);
    });
    pushUnique(row.chars, ch.n);
  }
  return [...groups.values()]
    .map((row) => ({
      ...row,
      mats: row.mats.sort(materialIdSort),
      chars: row.chars.sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.region.localeCompare(b.region));
}

function buildWuwaWeeklyBosses(roster) {
  const groups = new Map();
  for (const ch of cmRosterSource(roster)) {
    const weekly = (ch.req?.talents || []).find((m) => m.kind === 'weekly');
    if (!weekly) continue;
    const id = String(weekly.id || weekly.name);
    if (!groups.has(id)) {
      groups.set(id, {
        bossName: weekly.source || weekly.name,
        drops: [{ ...weekly, chars: [] }],
      });
    }
    pushUnique(groups.get(id).drops[0].chars, ch.n);
  }
  return [...groups.entries()]
    .sort((a, b) => String(a[1].bossName).localeCompare(String(b[1].bossName)))
    .map(([, boss]) => ({
      ...boss,
      drops: boss.drops.map((drop) => ({ ...drop, chars: drop.chars.sort((a, b) => a.localeCompare(b)) })),
    }));
}

function buildCmCfg(rosters) {
  return {
    gi: {
      name: 'Genshin Impact',
      icon: '../assets/icon/giicon.png',
      cur: 'Mora',
      curIcon: dbAsset('Nanoka/gi/assets/items/UI_ItemIcon_202.webp'),
      tabs: { mid: 'Talents', boss: 'Trounce Domain' },
      rarities: [5, 4],
      rarityLabel: { 5: '5\u2605', 4: '4\u2605' },
      midMode: 'days',
      filters: [
        { key: 'el', label: 'Element', opts: ordered(rosters.gi.map((ch) => ch.el), preferred.giElements) },
        { key: 'w', label: 'Weapon', opts: ordered(rosters.gi.map((ch) => ch.w), preferred.giWeapons) },
        { key: 'tag', label: 'Region', opts: ordered(rosters.gi.map((ch) => ch.tag)) },
        { key: 'r', label: 'Rarity', opts: [['5-star', 5], ['4-star', 4]] },
      ],
      weapons: buildGiWeaponRoster(),
      roster: rosters.gi,
      midGroups: groupBy(rosters.gi, 'book', (x) => x ? `${x} Series` : 'Unsorted Talent Books', (x) => x ? [{ n: `Teachings / Guide / Philosophies of ${x}` }] : [{ n: 'Talent Material' }]),
      talentDomains: buildGiTalentDomains(rosters.gi),
      boss: { title: 'Trounce Domain', count: rosters.gi.length },
      bossGroups: giWeeklyGroups(rosters.gi),
      weeklyBosses: buildGiWeeklyBosses(rosters.gi),
    },
    hsr: {
      name: 'Honkai: Star Rail',
      icon: '../assets/icon/hsricon.png',
      cur: 'Credits',
      curIcon: dbAsset('Nanoka/hsr/assets/items/2.webp'),
      tabs: { mid: 'Traces', boss: 'Echo of War' },
      rarities: [5, 4],
      rarityLabel: { 5: '5\u2605', 4: '4\u2605' },
      midMode: 'group',
      filters: [
        { key: 'path', label: 'Path', opts: ordered(rosters.hsr.map((ch) => ch.path), preferred.hsrPaths) },
        { key: 'el', label: 'Type', opts: ordered(rosters.hsr.map((ch) => ch.el), preferred.hsrElements) },
        { key: 'r', label: 'Rarity', opts: [['5-star', 5], ['4-star', 4]] },
      ],
      weapons: buildHsrLightConeRoster(),
      roster: rosters.hsr,
      midGroups: buildHsrTraceGroups(rosters.hsr),
      boss: { title: 'Echo of War', count: rosters.hsr.length },
      bossGroups: groupByPreferred(rosters.hsr, 'el', preferred.hsrElements, (x) => [`${x} build guides`]),
      weeklyBosses: buildHsrWeeklyBosses(rosters.hsr),
    },
    zzz: {
      name: 'Zenless Zone Zero',
      icon: '../assets/icon/zzzicon.png',
      cur: 'Dennies',
      curIcon: dbAsset('Nanoka/zzz/assets/items/IconCoin.webp'),
      tabs: { mid: 'Skills', boss: 'Notorious Hunt' },
      rarities: ['S', 'A'],
      rarityLabel: { S: 'S', A: 'A' },
      midMode: 'group',
      filters: [
        { key: 'el', label: 'Attribute', opts: ordered(rosters.zzz.map((ch) => ch.el), preferred.zzzAttributes) },
        { key: 'spec', label: 'Specialty', opts: ordered(rosters.zzz.map((ch) => ch.spec), preferred.zzzSpecs) },
        { key: 'r', label: 'Rarity', opts: [['S', 'S'], ['A', 'A']] },
      ],
      roster: rosters.zzz,
      midGroups: buildZzzSkillGroups(rosters.zzz),
      boss: { title: 'Notorious Hunt', count: rosters.zzz.length },
      bossGroups: buildZzzWeeklyBosses(rosters.zzz).map((boss) => ({
        title: boss.bossName,
        mats: boss.drops,
        chars: uniq(boss.drops.flatMap((drop) => drop.chars || [])),
      })),
      weeklyBosses: buildZzzWeeklyBosses(rosters.zzz),
    },
    wuwa: {
      name: 'Wuthering Waves',
      icon: '../assets/icon/wuwaicon.png',
      cur: 'Shell Credit',
      curIcon: dbAsset('Nanoka/ww/assets/items/UIResources/Common/Image/IconA/T_IconA_hsb_UI.webp'),
      tabs: { mid: 'Skills', boss: 'Weekly Challenge' },
      rarities: [5, 4],
      rarityLabel: { 5: '5\u2605', 4: '4\u2605' },
      midMode: 'group',
      filters: [
        { key: 'el', label: 'Attribute', opts: ordered(rosters.wuwa.map((ch) => ch.el), preferred.wuwaElements) },
        { key: 'w', label: 'Weapon', opts: ordered(rosters.wuwa.map((ch) => ch.w), preferred.wuwaWeapons) },
        { key: 'r', label: 'Rarity', opts: [['5-star', 5], ['4-star', 4]] },
      ],
      roster: rosters.wuwa,
      midGroups: buildWuwaSkillGroups(rosters.wuwa),
      boss: { title: 'Weekly Challenge', count: rosters.wuwa.length },
      bossGroups: buildWuwaWeeklyBosses(rosters.wuwa).map((boss) => ({
        title: boss.bossName,
        mats: boss.drops,
        chars: uniq(boss.drops.flatMap((drop) => drop.chars || [])),
      })),
      weeklyBosses: buildWuwaWeeklyBosses(rosters.wuwa),
    },
    ae: {
      name: 'Arknights: Endfield',
      icon: '../assets/icon/aeicon.png',
      cur: 'Currency',
      tabs: { mid: 'Skills', boss: 'Field Operations' },
      rarities: [6, 5, 4],
      rarityLabel: { 6: '6\u2605', 5: '5\u2605', 4: '4\u2605' },
      midMode: 'group',
      filters: [
        { key: 'el', label: 'Element', opts: ordered(rosters.ae.map((ch) => ch.el), preferred.aeElements) },
        { key: 'cls', label: 'Class', opts: ordered(rosters.ae.map((ch) => ch.cls), preferred.aeClasses) },
        { key: 'w', label: 'Weapon', opts: ordered(rosters.ae.map((ch) => ch.w), preferred.aeWeapons) },
        { key: 'r', label: 'Rarity', opts: [['6-star', 6], ['5-star', 5], ['4-star', 4]] },
      ],
      roster: rosters.ae,
      midGroups: buildEndfieldItemGroups(rosters.ae, ['aeSkillItems', 'aeStatItems'], 'Recommended Gear'),
      boss: { title: 'Field Operations', count: rosters.ae.length },
      bossGroups: buildEndfieldItemGroups(rosters.ae, ['aePreferredItems'], 'Recommended Weapons'),
    },
  };
}

function giWeeklyGroups(roster) {
  const groups = new Map();
  for (const ch of cmRosterSource(roster)) {
    const weekly = (ch.req?.talents || []).find((m) => m.kind === 'weekly' && !/crown/i.test(m.name));
    const name = weekly?.name || 'Unsorted Weekly Materials';
    if (!groups.has(name)) groups.set(name, []);
    pushUnique(groups.get(name), ch.n);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([title, chars]) => ({
    title,
    mats: [title],
    chars,
  }));
}

function normalizePrydwenCollection(rel, title, limit = Infinity, mapEntry = (entry) => entry) {
  const page = readJson(rel);
  const entries = (page.entries || [])
    .slice(0, limit)
    .map((entry) => mapEntry(entry, page))
    .filter(Boolean)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      art: dbAsset(entry.art),
      fields: entry.fields || {},
      text: cleanText(entry.text, 260),
      status: entry.contentStatus,
      labels: entry.statusLabels || [],
    }));
  return {
    key: page.collection || path.basename(rel, '.json'),
    title,
    updatedText: page.updatedText,
    source: 'Prydwen',
    count: entries.length,
    items: entries,
  };
}

function normalizeWuwaWeaponEntry(entry, page) {
  const typeByCode = { 1: 'Broadblade', 2: 'Sword', 3: 'Pistols', 4: 'Gauntlets', 5: 'Rectifier' };
  const asset = (page.assets || []).find((item) => item.id === entry.assetId || item.path === entry.art);
  const code = String(asset?.fileStem || '').match(/^210([1-5])/);
  const type = code ? typeByCode[code[1]] : null;
  if (!type) return entry;
  return {
    ...entry,
    fields: { ...(entry.fields || {}), type },
    text: String(entry.text || '').replace(/Type:\s*[^\n]+/, `Type: ${type}`),
  };
}

function normalizeNanokaItems(rel, title, source, mapItem, limit = Infinity) {
  const rows = readJson(rel).slice(0, limit).map(mapItem).filter(Boolean);
  return {
    key: path.basename(rel, '.json'),
    title,
    source,
    count: rows.length,
    items: rows,
  };
}

function buildCollections() {
  return {
    gi: [
      normalizeNanokaItems('Nanoka/gi/live/artifacts.json', 'Artifacts', 'Nanoka', (it) => ({
        id: 'gi-art-' + it.id,
        name: it.name,
        kind: 'artifact',
        art: dbAsset(it.assets?.icon),
        fields: { rarity: Array.isArray(it.rarity) ? it.rarity.join('-') + ' \u2605' : it.rarity, type: it.type },
        text: cleanText((it.setEffects || []).map((e) => `(${e.pieces}) ${e.description}`).join(' '), 260),
      })),
      normalizeNanokaItems('Nanoka/gi/live/weapons.json', 'Weapons', 'Nanoka', (it) => ({
        id: 'gi-wpn-' + it.id,
        name: it.name,
        kind: 'weapon',
        art: dbAsset(it.assets?.icon || it.assets?.gacha),
        fields: { rarity: it.rarity ? `${it.rarity} \u2605` : undefined, type: weaponMap[it.type] || it.type, atk: it.attack },
        text: cleanText(it.description, 260),
      })),
    ],
    hsr: [
      normalizePrydwenCollection('Prydwen/hsr/collections/light-cones.json', 'Light Cones'),
      normalizePrydwenCollection('Prydwen/hsr/collections/relic-sets.json', 'Relic Sets'),
    ],
    zzz: [
      normalizePrydwenCollection('Prydwen/zzz/collections/w-engines.json', 'W-Engines'),
      normalizePrydwenCollection('Prydwen/zzz/collections/disk-drives.json', 'Drive Discs'),
      normalizeNanokaItems('Nanoka/zzz/live/bangboos.json', 'Bangboo', 'Nanoka', (it) => ({
        id: 'zzz-bb-' + it.id,
        name: it.name,
        kind: 'bangboo',
        art: dbAsset(it.assets?.icon),
        fields: { rarity: it.rarity, codeName: it.codeName },
        text: cleanText(it.description || (it.skills || []).map((s) => s.description).join(' '), 260),
      })),
    ],
    wuwa: [
      normalizePrydwenCollection('Prydwen/ww/collections/weapons.json', 'Weapons', Infinity, normalizeWuwaWeaponEntry),
      normalizeNanokaItems('Nanoka/ww/live/echoes.json', 'Echoes', 'Nanoka', (it) => ({
        id: 'ww-echo-' + it.id,
        name: it.name,
        kind: 'echo',
        art: dbAsset(it.assets?.icon),
        fields: { rarity: Array.isArray(it.rarity) ? it.rarity.join('-') : it.rarity, type: it.type, cost: it.intensity },
        text: cleanText(it.skill?.description || it.monsterInfo || it.description, 260),
      })),
    ],
    ae: [
      normalizePrydwenCollection('Prydwen/endfield/collections/weapons.json', 'Weapons'),
      normalizePrydwenCollection('Prydwen/endfield/collections/gear.json', 'Gear'),
    ],
  };
}

function rewardText(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => typeof entry === 'string' ? entry : [entry.count, entry.item || entry.name].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(' + ');
  }
  return cleanText(value, 180);
}

const premiumCurrencyMeta = {
  gi: { name: 'Primogems', needle: 'primogem', icon: dbAsset('Nanoka/gi/assets/items/UI_ItemIcon_201.webp') },
  hsr: { name: 'Stellar Jade', needle: 'stellar jade', icon: dbAsset('Nanoka/hsr/assets/items/900001.webp') },
  zzz: { name: 'Polychrome', needle: 'polychrome', icon: dbAsset('Nanoka/zzz/assets/items/IconCurrency.webp') },
  wuwa: { name: 'Astrite', needle: 'astrite', icon: dbAsset('Nanoka/ww/assets/items/UIResources/Common/Image/IconA/T_IconA_zcpq_UI.webp') },
  ae: { name: 'Originium', needle: 'originium', icon: null },
};

function codeHasPremiumCurrency(key, reward) {
  const needle = premiumCurrencyMeta[key]?.needle;
  if (!needle) return false;
  return String(reward || '').toLowerCase().includes(needle);
}

// Delegates to the shared reward vocabulary so the site filter and the scraper's
// publish gate stay in lockstep.
function isUsefulCodeReward(key, reward, sourceUrl) {
  return isUsefulRewardShared(key, reward, sourceUrl);
}

function buildCodesData() {
  if (!exists('Codes/codes.json')) return { updated: null, games: {} };
  const src = readJson('Codes/codes.json');
  const games = {};
  for (const group of src.games || []) {
    const key = gameKey(group.slug || group.id || group.name);
    if (!key) continue;
    games[key] = (group.codes || [])
      .filter((code) => code?.code)
      .map((code) => {
        const rawCode = String(code.code).trim();
        const reward = rewardText(code.reward ?? code.rewards) || 'Rewards';
        return {
          code: rawCode,
          reward,
          premium: codeHasPremiumCurrency(key, reward),
          premiumCurrency: premiumCurrencyMeta[key] || null,
          added: code.added || null,
          firstSeen: code.firstSeen || null,
          sourceUrl: code.sourceUrl || group.sourceUrl || null,
          redeemUrl: group.redeemBase ? group.redeemBase + encodeURIComponent(rawCode) : null,
        };
      })
      .filter((code) => isUsefulCodeReward(key, code.reward, code.sourceUrl));
  }
  return { updated: src.generatedAt || src.updated || null, maxAgeDays: src.maxAgeDays || null, games };
}

function rosterHit(rosters, key, name) {
  const normalized = String(name || '').toLowerCase();
  return (rosters[key] || []).find((ch) => {
    if (String(ch.n || '').toLowerCase() === normalized) return true;
    return (ch.forms || []).some((form) => String(form.rawName || form.n || '').toLowerCase() === normalized);
  }) || null;
}

function normalizeBannerCharacter(rosters, key, entry) {
  const name = typeof entry === 'string' ? entry : entry?.name;
  if (!name) return null;
  const local = rosterHit(rosters, key, name);
  return {
    name,
    icon: local?.icon || null,
    art: local?.art || local?.card || null,
    rarity: local?.r || entry?.rarity || null,
  };
}

function normalizeBannerPhase(rosters, key, phase) {
  const characters = (phase?.characters || [])
    .map((entry) => normalizeBannerCharacter(rosters, key, entry))
    .filter(Boolean);
  return {
    phase: phase?.phase || null,
    start: phase?.start || null,
    end: phase?.end || null,
    characters,
    subBanners: (phase?.subBanners || []).map((sub) => ({
      phase: sub.phase || null,
      start: sub.start || null,
      end: sub.end || null,
      characters: (sub.characters || [])
        .map((entry) => normalizeBannerCharacter(rosters, key, entry))
        .filter(Boolean),
    })),
  };
}

function buildBannersData(rosters) {
  if (!exists('Banners/banners.json')) return { updated: null, games: {} };
  const src = readJson('Banners/banners.json');
  const games = {};
  for (const group of src.games || []) {
    const key = gameKey(group.id || group.slug || group.name);
    if (!key) continue;
    games[key] = {
      name: group.name,
      freshness: group.freshness || null,
      current: normalizeBannerPhase(rosters, key, group.current),
      next: normalizeBannerPhase(rosters, key, group.next),
      upcoming: (group.upcoming || []).map((phase) => normalizeBannerPhase(rosters, key, phase)),
    };
  }
  return { updated: src.updated || src.generatedAt || null, checkedAt: src.checkedAt || null, games };
}

function sourceMeta() {
  const prydwen = readJson('Prydwen/manifest.json');
  const nanoka = readJson('Nanoka/manifest.json');
  const endfield = exists('EndfieldWiki/endfield/overview.json') ? readJson('EndfieldWiki/endfield/overview.json') : null;
  return {
    generatedAt: new Date().toISOString(),
    providers: {
      Prydwen: prydwen.generatedAt,
      Nanoka: { gi: nanoka.gi?.live, hsr: nanoka.hsr?.live, ww: nanoka.ww?.live, zzz: nanoka.zzz?.live },
      EndfieldWiki: endfield?.scrapedAt || null,
    },
  };
}

function materialHasSource(mat) {
  if (!mat || mat.kind === 'currency') return true;
  if (mat.source && !isGenericSource(mat.source)) return true;
  return Array.isArray(mat.sourceDetails) && mat.sourceDetails.some((entry) => entry?.name && !isGenericSource(entry.name));
}

function pushMaterialSourceGap(out, game, context, mat) {
  if (!mat?.name || materialHasSource(mat)) return;
  const key = [game, mat.id || mat.name].join('|');
  if (out.some((row) => row.key === key)) return;
  out.push({
    key,
    game,
    context,
    id: mat.id || null,
    name: mat.name,
    kind: mat.kind || null,
  });
}

function collectMaterialSourceGaps(cmCfg) {
  const rows = [];
  for (const [game, cfg] of Object.entries(cmCfg || {})) {
    for (const ch of cmRosterSource(cfg.roster || [])) {
      for (const mat of ch.req?.ascension || []) pushMaterialSourceGap(rows, game, `${ch.n} ascension`, mat);
      for (const mat of ch.req?.talents || []) pushMaterialSourceGap(rows, game, `${ch.n} talents`, mat);
      for (const mat of ch.req?.weapon?.items || []) pushMaterialSourceGap(rows, game, `${ch.n} weapon`, mat);
      for (const stages of ch.req?.talentStages || []) {
        for (const stage of stages || []) {
          for (const mat of stage?.items || []) pushMaterialSourceGap(rows, game, `${ch.n} talent stage`, mat);
        }
      }
    }
    for (const boss of cfg.weeklyBosses || []) {
      for (const mat of boss.drops || []) pushMaterialSourceGap(rows, game, `${boss.bossName || 'weekly'} weekly`, mat);
    }
    for (const weapon of cfg.weapons || []) {
      for (const mat of weapon.items || []) pushMaterialSourceGap(rows, game, `${weapon.name} weapon`, mat);
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    note: 'Generic shops, crafting, exchanges, and event rewards are intentionally filtered. Rows here need scraper/wiki-specific source data.',
    count: rows.length,
    missing: rows.map(({ key, ...row }) => row).sort((a, b) => a.game.localeCompare(b.game) || a.name.localeCompare(b.name)),
  };
}

function collectEndfieldIconGaps(roster) {
  const rows = [];
  for (const ch of cmRosterSource(roster || [])) {
    for (const field of ['aeSkillItems', 'aeStatItems', 'aePreferredItems']) {
      for (const mat of ch[field] || []) {
        if (mat?.icon) continue;
        const key = [field, mat?.id || mat?.name || mat?.n].join('|');
        if (rows.some((row) => row.key === key)) continue;
        rows.push({
          key,
          field,
          name: mat?.name || mat?.n || 'Unknown',
          kind: mat?.kind || null,
        });
      }
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    note: 'Endfield character upgrade material tables are not fully available in the local scrape yet. These rows are recommendation/material records that still lack a local icon.',
    count: rows.length,
    missing: rows.map(({ key, ...row }) => row).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const hsrReqByName = buildHsrReqMap();
const hsrLightConeReqByName = buildHsrLightConeReqMap();
const zzzReqByName = buildZzzReqMap();
const wuwaReqByName = buildWuwaReqMap();

const rawRosters = {
  gi: buildGiRoster(),
  hsr: buildPrydwenRoster('hsr', (f) => ({ r: f.rarity, el: f.element, path: f.path }), hsrReqByName),
  zzz: buildPrydwenRoster('zzz', (f) => ({ r: f.rarity, el: f.attribute, spec: f.specialty, tag: f.faction }), zzzReqByName),
  wuwa: buildPrydwenRoster('ww', (f) => ({ r: f.rarity, el: f.element, w: f.weapon }), wuwaReqByName),
  ae: buildEndfieldRoster(),
};

const rosters = Object.fromEntries(
  Object.entries(rawRosters).map(([key, roster]) => [key, mergeProtagonistForms(key, roster)])
);

const genshinTcgOverviewArt = applyGenshinTcgOverviewArt(rosters.gi);

const reportsDir = path.resolve(dbDir, 'reports');
fs.mkdirSync(reportsDir, { recursive: true });

const missingCharacterTitles = {
  generatedAt: new Date().toISOString(),
  note: 'Genshin titles come from Nanoka profile.title with wiki cache fallback. HSR subtitles use wiki How to Obtain with light-cone fallback, ZZZ subtitles use wiki Namecard names, and Wuthering Waves subtitles use wiki title. Endfield displays class. Missing entries need wiki data, class data, or a manual override.',
  missing: Object.fromEntries(Object.entries(rosters).map(([key, roster]) => [
    key,
    [...new Set(roster.filter((ch) => !ch.title).map((ch) => ch.n))]
      .sort((a, b) => a.localeCompare(b)),
  ])),
};
missingCharacterTitles.counts = Object.fromEntries(Object.entries(missingCharacterTitles.missing).map(([key, list]) => [key, list.length]));
fs.writeFileSync(
  path.resolve(reportsDir, 'missing-character-titles.json'),
  JSON.stringify(missingCharacterTitles, null, 2),
  'utf8',
);
fs.writeFileSync(
  path.resolve(reportsDir, 'genshin-overview-tcg-art.json'),
  JSON.stringify(genshinTcgOverviewArt, null, 2),
  'utf8',
);

const cmCfg = buildCmCfg(rosters);
fs.writeFileSync(
  path.resolve(reportsDir, 'material-source-gaps.json'),
  JSON.stringify(collectMaterialSourceGaps(cmCfg), null, 2),
  'utf8',
);
fs.writeFileSync(
  path.resolve(reportsDir, 'endfield-icon-gaps.json'),
  JSON.stringify(collectEndfieldIconGaps(rosters.ae), null, 2),
  'utf8',
);
const collections = buildCollections();
const codes = buildCodesData();
const banners = buildBannersData(rosters);
const meta = sourceMeta();

fs.mkdirSync(generatedDataDir, { recursive: true });

const cmHeader = `// ============================================================\n// Nyx - generated Character Materials data\n// Source: Database/Prydwen, Database/Nanoka, Database/EndfieldWiki\n// Generated by Site/tools/generate-site-data.mjs\n// ============================================================\n\n`;

const cmPalettes = `const CM_RAR = {\n  6:{ a:'#ef8a5e', b:'#d05a3a', ring:'#ffb07d', glow:'rgba(255,140,90,.6)' },\n  5:{ a:'#e3b269', b:'#caa14e', ring:'#ffd98a', glow:'rgba(255,190,90,.55)' },\n  4:{ a:'#9a89ea', b:'#6f57bf', ring:'#cdb3ff', glow:'rgba(150,120,255,.5)' },\n  3:{ a:'#4f7fc4', b:'#3a5d96', ring:'#9cc2ff', glow:'rgba(90,150,255,.45)' },\n  2:{ a:'#4faf8f', b:'#3a8068', ring:'#9ce8c8', glow:'rgba(90,210,160,.4)' },\n  1:{ a:'#8a94a6', b:'#596273', ring:'#d5d9e1', glow:'rgba(170,180,200,.28)' },\n  0:{ a:'#8a94a6', b:'#596273', ring:'#d5d9e1', glow:'rgba(170,180,200,.28)' },\n  S:{ a:'#e3b269', b:'#caa14e', ring:'#ffd98a', glow:'rgba(255,190,90,.55)' },\n  A:{ a:'#9a89ea', b:'#6f57bf', ring:'#cdb3ff', glow:'rgba(150,120,255,.5)' },\n  B:{ a:'#4f7fc4', b:'#3a5d96', ring:'#9cc2ff', glow:'rgba(90,150,255,.45)' }\n};\n\nconst CM_ELEM = {\n  Pyro:'#e6614c', Hydro:'#4cc5e6', Cryo:'#9fe3ec', Electro:'#c08fe6',\n  Dendro:'#90c84a', Anemo:'#74d6b0', Geo:'#e3b552', Ice:'#9fe3ec',\n  Wind:'#74d6b0', Lightning:'#c08fe6', Fire:'#e6614c', Physical:'#d8d2ea',\n  Quantum:'#8f7fd6', Imaginary:'#e6d24c', Ether:'#e07fb0', Electric:'#c08fe6',\n  Spectro:'#e6d24c', Havoc:'#c0608f', Aero:'#74d6b0', Glacio:'#9fe3ec',\n  Fusion:'#e6614c', Frost:'#7fb0e6', Heat:'#e6614c', Nature:'#90c84a',\n  Unknown:'#b7aaff'\n};\n\n`;

fs.writeFileSync(
  path.resolve(generatedDataDir, 'cm-data.js'),
  cmHeader + cmPalettes + `const CM_CFG = window.CM_CFG || {};\nconst CM_GAME_FILES = ${normalizeForJs(Object.fromEntries(Object.keys(cmCfg).map((key) => [key, `../dist/cm-data-${key}.js`])))};\nconst CM_GAME_LABELS = ${normalizeForJs(Object.fromEntries(Object.keys(cmCfg).map((key) => [key, cmCfg[key].name])))};\nconst CM_LOADS = window.__NYX_CM_LOADS || {};\n\nfunction loadNyxCmGame(key) {\n  if (!key || key === 'nyx') return Promise.resolve(null);\n  window.CM_CFG = window.CM_CFG || CM_CFG;\n  if (window.CM_CFG[key]) return Promise.resolve(window.CM_CFG[key]);\n  if (CM_LOADS[key]) return CM_LOADS[key];\n  const src = CM_GAME_FILES[key];\n  if (!src) return Promise.reject(new Error('Unknown character-material game: ' + key));\n  CM_LOADS[key] = new Promise((resolve, reject) => {\n    const existing = document.querySelector('script[data-cm-game=\"' + key + '\"]');\n    if (existing) {\n      existing.addEventListener('load', () => resolve(window.CM_CFG[key] || null), { once:true });\n      existing.addEventListener('error', () => reject(new Error('Failed to load ' + src)), { once:true });\n      return;\n    }\n    const script = document.createElement('script');\n    script.src = src;\n    script.async = true;\n    script.dataset.cmGame = key;\n    script.onload = () => resolve(window.CM_CFG[key] || null);\n    script.onerror = () => reject(new Error('Failed to load ' + src));\n    document.head.appendChild(script);\n  });\n  return CM_LOADS[key];\n}\n\nfunction ensureNyxCmGames(keys) {\n  return Promise.all((keys || []).map((key) => loadNyxCmGame(key)));\n}\n\nObject.assign(window, { CM_CFG, CM_RAR, CM_ELEM, CM_GAME_FILES, CM_GAME_LABELS, loadNyxCmGame, ensureNyxCmGames, __NYX_CM_LOADS: CM_LOADS });\n`,
  'utf8',
);

for (const [key, cfg] of Object.entries(cmCfg)) {
  fs.writeFileSync(
    path.resolve(generatedDataDir, `cm-data-${key}.js`),
    cmHeader
      + `(function(){\n`
      + `  window.CM_CFG = window.CM_CFG || {};\n`
      + `  window.CM_CFG[${JSON.stringify(key)}] = ${normalizeForJs(cfg)};\n`
      + `  window.dispatchEvent(new CustomEvent('nyx:cm-game-loaded', { detail:{ key:${JSON.stringify(key)} } }));\n`
      + `})();\n`,
    'utf8',
  );
}

const nyxData = {
  ...meta,
  codes,
  banners,
  games: Object.fromEntries(Object.keys(cmCfg).map((key) => [
    key,
    {
      name: cmCfg[key].name,
      icon: cmCfg[key].icon,
      rosterCount: cmCfg[key].roster.length,
      collections: collections[key],
      codes: codes.games[key] || [],
      banners: banners.games[key] || null,
      roster: cmCfg[key].roster.map((ch) => ({
        id: ch.id,
        name: ch.n,
        aliases: ch.aliases || [],
        title: ch.title,
        rarity: ch.r,
        element: ch.el,
        role: ch.path || ch.spec || ch.cls || ch.w || ch.tag,
        icon: ch.icon,
        art: ch.art || ch.card,
        overviewArt: ch.overviewArt,
        overviewArtPool: ch.overviewArtPool,
        overviewArtZoom: ch.overviewArtZoom,
        forms: (ch.forms || []).map((form) => ({
          name: form.rawName || form.n,
          label: form.formLabel,
          variant: form.variantValue,
          gender: form.gender,
          element: form.el,
          role: form.path || form.spec || form.cls || form.w || form.tag,
          icon: form.icon,
          art: form.art || form.card,
        })),
      })),
    },
  ])),
};

fs.writeFileSync(
  path.resolve(generatedDataDir, 'nyx-data.js'),
  `// ============================================================\n// Nyx - generated site-wide database payload\n// Generated by Site/tools/generate-site-data.mjs\n// ============================================================\n\nvar NYX_DB = ${normalizeForJs(nyxData)};\nObject.assign(window, { NYX_DB });\n`,
  'utf8',
);

console.log(`Generated ${path.relative(root, path.resolve(generatedDataDir, 'cm-data.js'))}`);
for (const key of Object.keys(cmCfg)) {
  console.log(`Generated ${path.relative(root, path.resolve(generatedDataDir, `cm-data-${key}.js`))}`);
}
console.log(`Generated ${path.relative(root, path.resolve(generatedDataDir, 'nyx-data.js'))}`);
