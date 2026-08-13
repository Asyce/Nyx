import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  cleanDatabaseText,
  databaseRarityLabel,
  databaseRecordClassification,
  databaseSourceIconPolicy,
  databaseZzzDriveDiscTwoPieceStat,
} from './lib/database-data-helpers.mjs';
import { parseCatalogFieldLine } from '../../Scraper/prydwen/catalog-fields.mjs';
import { chooseCharacterOverlay } from './lib/character-source-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const databaseOnly = process.argv.includes('--database-only');
const charactersOnly = process.argv.includes('--characters-only');
if (databaseOnly && charactersOnly) throw new Error('Choose only one generation scope: --database-only or --characters-only');
const realWriteFileSync = fs.writeFileSync.bind(fs);
if (databaseOnly) {
  const databaseOutputs = /^(?:database-missing-art\.json|db-data-(?:gi|hsr|zzz|wuwa)\.js)$/;
  fs.writeFileSync = (target, ...args) => databaseOutputs.test(path.basename(String(target)))
    ? realWriteFileSync(target, ...args)
    : undefined;
}

// Shared reward vocabulary — single source of truth used by both the codes
// scraper's publish gate and this display filter, so they never disagree.
const require = createRequire(import.meta.url);
const { isUsefulReward: isUsefulRewardShared } = require(path.resolve(root, 'Scraper', 'codes', 'reward-vocab.cjs'));
// Banner timeline reflow + freshness — shared with the scraper so the deployed
// site never shows an expired/empty phase as the live banner (see normalize.cjs).
const { reflowBannerGroup } = require(path.resolve(root, 'Scraper', 'banners', 'normalize.cjs'));
const siteDir = path.resolve(root, 'Site');
const generatedDataDir = path.resolve(siteDir, 'src', 'data', 'generated');
const dbDir = path.resolve(root, 'Database');

const readJson = (rel) => JSON.parse(fs.readFileSync(path.resolve(dbDir, rel), 'utf8'));
const exists = (rel) => fs.existsSync(path.resolve(dbDir, rel));

// Active GameData channel for character/material reads. 'live' by default; flipped to
// 'beta' while building the beta delta. Item/avatar caches are keyed by channel so the
// two passes never cross-contaminate. Assets live in a shared (channel-less) dir.
const GAMEDATA_CHANNELS = ['gi', 'hsr', 'zzz', 'wuwa', 'ww'];
let GAMEDATA_CHANNEL = 'live';
const nch = () => GAMEDATA_CHANNEL;
// Beta is only meaningful when the channel dir actually exists on disk.
const betaChannelAvailable = (game) => exists(`GameData/${game === 'wuwa' ? 'ww' : game}/beta`);
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

const ZZZ_OFFICIAL_CHARACTER_PORTRAITS = new Map([
  ['pyrois', {
    status:'released',
    icon:dbAsset('GameData/zzz/assets/agents/icons/IconRole63.webp'),
    sourceUrl:'https://www.hoyolab.com/article/45488578',
  }],
  ['sigrid', {
    status:'announced',
    icon:dbAsset('Prydwen/zzz/assets/characters/sigrid-30ecebbe136b.webp'),
    sourceUrl:'https://www.hoyolab.com/article_pre/18014398241023132',
  }],
]);

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

function cleanKitText(s, len = 2600) {
  return String(s || '')
    .replace(/\r/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h\d)>/gi, '\n')
    .replace(/<IconMap:[^>]+>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{Cus:Ipt[^}]*\}/gi, '')
    .replace(/\{RUBY_[^}]+\}/g, '')
    .replace(/\{\/?LINK[^}]*\}/gi, '')
    .replace(/\{[A-Z][A-Z0-9_]*(?:#[^}]*)?\}/g, '')
    .replace(/\{\/[A-Z][A-Z0-9_]*\}/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, len);
}

function cleanKitName(s, len = 120) {
  return cleanKitText(s, len).replace(/\n+/g, ' ').trim();
}

function formatKitNumber(value, isPercent = false) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  const raw = isPercent && Math.abs(n) <= 10 ? n * 100 : n;
  const fixed = Math.abs(raw) >= 100 ? raw.toFixed(0)
    : Math.abs(raw) >= 10 ? raw.toFixed(1)
      : raw.toFixed(2);
  const text = fixed.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
  return text + (isPercent ? '%' : '');
}

function applyKitParams(desc, params = []) {
  const list = Array.isArray(params) ? params : [];
  return String(desc || '').replace(/#(\d+)(?:\[[^\]]+\])?(%)?/g, (_, rawIndex, pct) => {
    const value = list[Number(rawIndex) - 1];
    return value === undefined ? _ : formatKitNumber(value, !!pct);
  });
}

function cleanKitLevels(levels = []) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(levels) ? levels : []) {
    const label = cleanKitName(row?.label || row?.level || '', 40);
    const text = cleanKitText(row?.text || row?.desc || '', 5000);
    if (!label || !text) continue;
    const key = `${label}:${normKey(text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, text });
  }
  const uniqueTexts = new Set(out.map((row) => normKey(row.text)).filter(Boolean));
  return uniqueTexts.size > 1 ? out : [];
}

function cleanKitScaling(groups = []) {
  const out = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    const columns = (group?.columns || []).map((col) => cleanKitName(col, 24)).filter(Boolean);
    const rows = (group?.rows || [])
      .map((row) => ({
        label: cleanKitName(row?.label, 100),
        values: (row?.values || []).map((value) => cleanKitName(value, 80)),
      }))
      .filter((row) => row.label && row.values.some(Boolean));
    if (columns.length && rows.length) {
      out.push({
        title: cleanKitName(group?.title || 'Scaling', 80),
        columns,
        rows,
      });
    }
  }
  return out;
}

function kitSource(game, source = 'Game data') {
  const manifest = exists('GameData/manifest.json') ? readJson('GameData/manifest.json') : {};
  const key = game === 'wuwa' ? 'ww' : game;
  return {
    source,
    channel: GAMEDATA_CHANNEL,
    version: manifest[key]?.[GAMEDATA_CHANNEL === 'beta' ? 'latest' : 'live'] || manifest[key]?.latest || manifest[key]?.live || null,
  };
}

function kitEntry({ name, type, desc, icon, params, stats, levels, scaling }) {
  const body = cleanKitText(applyKitParams(desc, params));
  const cleanLevels = cleanKitLevels(levels);
  const cleanScaling = cleanKitScaling(scaling);
  if (!name && !body && !cleanLevels.length && !cleanScaling.length) return null;
  return {
    name: cleanKitName(name || type || 'Skill'),
    ...(type ? { type: cleanKitName(type, 80) } : {}),
    ...(body ? { desc: body } : {}),
    ...(icon ? { icon } : {}),
    ...(Array.isArray(stats) && stats.length ? { stats } : {}),
    ...(cleanLevels.length ? { levels: cleanLevels } : {}),
    ...(cleanScaling.length ? { scaling: cleanScaling } : {}),
  };
}

function dedupeKitEntries(entries) {
  const out = [];
  const byKey = new Map();
  for (const entry of entries || []) {
    if (!entry) continue;
    const key = `${normKey(entry.type || '')}:${normKey(entry.name || '')}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, entry);
      out.push(entry);
      continue;
    }
    if (!existing.icon && entry.icon) existing.icon = entry.icon;
    if ((!existing.stats || !existing.stats.length) && entry.stats?.length) existing.stats = entry.stats;
    if ((!existing.levels || !existing.levels.length) && entry.levels?.length) existing.levels = entry.levels;
    if ((!existing.scaling || !existing.scaling.length) && entry.scaling?.length) existing.scaling = entry.scaling;
    if (!entry.desc) continue;
    if (!existing.desc) {
      existing.desc = entry.desc;
      continue;
    }
    const current = normKey(existing.desc);
    const next = normKey(entry.desc);
    if (next && !current.includes(next) && !next.includes(current)) {
      existing.desc = cleanKitText(`${existing.desc}\n\n${entry.desc}`, 5000);
    }
  }
  return out;
}

function kitSection(title, entries) {
  const clean = dedupeKitEntries(entries).filter(Boolean);
  return clean.length ? { title, entries: clean } : null;
}

function trimNumberText(text) {
  return String(text)
    .replace(/(\.\d*?[1-9])0+(?=\D|$)/g, '$1')
    .replace(/\.0+(?=\D|$)/g, '');
}

function kitColumns(count) {
  return Array.from({ length: Math.max(0, count) }, (_, i) => `Lv. ${i + 1}`);
}

function formatGiPromoteValue(value, fmt = '') {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  const format = String(fmt || '');
  const isPercent = /P/i.test(format);
  const decimals = Number(format.match(/F(\d+)/i)?.[1] ?? (isPercent ? 1 : 0));
  const raw = isPercent ? n * 100 : n;
  return trimNumberText(raw.toFixed(Math.max(0, Math.min(4, decimals)))) + (isPercent ? '%' : '');
}

function applyGiPromoteParams(template, params = []) {
  return String(template || '').replace(/\{param(\d+):([^}]+)\}/gi, (match, rawIndex, fmt) => {
    const value = params[Number(rawIndex) - 1];
    return value === undefined ? match : formatGiPromoteValue(value, fmt);
  });
}

function giPromoteScaling(skill) {
  const levels = Object.values(skill?.promote || {})
    .filter((row) => Number(row?.level) > 0)
    .sort((a, b) => Number(a.level) - Number(b.level));
  if (!levels.length) return null;
  const first = Array.isArray(levels[0]?.desc) ? levels[0].desc : [];
  const rows = first.map((line, index) => {
    const [labelRaw] = String(line || '').split('|');
    const label = cleanKitName(labelRaw, 100);
    if (!label) return null;
    return {
      label,
      values: levels.map((level) => {
        const template = String((level.desc || [])[index] || line || '').split('|').slice(1).join('|');
        return cleanKitName(applyGiPromoteParams(template, level.param || []), 80);
      }),
    };
  }).filter(Boolean);
  return rows.length ? { title: 'Talent Level Scaling', columns: levels.map((row) => `Lv. ${row.level}`), rows } : null;
}

function hsrSkillLevels(skill, desc) {
  const levels = Object.values(skill?.level || {})
    .filter((row) => Number(row?.level) > 0)
    .sort((a, b) => Number(a.level) - Number(b.level));
  return levels.map((row) => ({
    label: `Lv. ${row.level}`,
    text: cleanKitText(applyKitParams(desc, row.param_list || []), 5000),
  }));
}

function wuwaSkillScaling(skill) {
  const rowsRaw = Object.values(skill?.level || {})
    .filter((row) => row?.name && Array.isArray(row?.param) && row.param.length)
    .sort((a, b) => Number(a?.id || 0) - Number(b?.id || 0));
  if (!rowsRaw.length) return null;
  const maxColumns = Math.max(...rowsRaw.map((row) => Math.max(...row.param.map((vals) => Array.isArray(vals) ? vals.length : 0))));
  const rows = rowsRaw.map((row) => ({
    label: cleanKitName(row.name, 100),
    values: Array.from({ length: maxColumns }, (_, i) => row.param
      .map((vals) => Array.isArray(vals) ? vals[i] : null)
      .filter((value) => value !== undefined && value !== null && value !== '')
      .join(' / ')),
  })).filter((row) => row.label && row.values.some(Boolean));
  return rows.length ? { title: 'Skill Level Scaling', columns: kitColumns(maxColumns), rows } : null;
}

function formatZzzScaleValue(prop, level) {
  const main = Number(prop?.main ?? prop?.damage_percentage ?? 0);
  const growth = Number(prop?.growth ?? prop?.damage_percentage_growth ?? 0);
  const raw = main + growth * (Number(level) - 1);
  const format = String(prop?.format || '');
  if (format.includes('%')) return trimNumberText((raw / 100).toFixed(1)) + '%';
  return trimNumberText(raw.toFixed(1));
}

function zzzParamScaling(params) {
  const rowsRaw = Array.isArray(params) ? params : [];
  const rows = rowsRaw.map((row) => {
    const prop = Object.values(row?.param || {})[0];
    if (!row?.name || !prop) return null;
    return {
      label: cleanKitName(row.name, 100),
      values: Array.from({ length: 12 }, (_, i) => formatZzzScaleValue(prop, i + 1)),
    };
  }).filter((row) => row?.label && row.values.some(Boolean));
  return rows.length ? { title: 'Skill Level Scaling', columns: kitColumns(12), rows } : null;
}

function zzzPassiveLevels(passiveRows, index) {
  return passiveRows
    .filter((row) => Number(row?.level) > 0)
    .sort((a, b) => Number(a.level) - Number(b.level))
    .map((row) => {
      const descs = Array.isArray(row.desc) ? row.desc : [row.desc];
      return { label: `Lv. ${row.level}`, text: descs[index] };
    });
}

function normKey(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{RUBY_[^}]+\}/g, '')
    .replace(/\{\/?LINK[^}]*\}/gi, '')
    .replace(/\{[A-Z][A-Z0-9_]*(?:#[^}]*)?\}/g, '')
    .replace(/\{\/[A-Z][A-Z0-9_]*\}/g, '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// Characters too new for the upstream EN TextMap can ship (in any game) with the
// raw localization key as their name — e.g. "Avatar_Female_Size02_Remielle".
// Real display names never contain underscores, so a key-shaped name means the
// translation is missing upstream. Such a key never matches the Prydwen roster
// name, and the character silently drops out of the site.
function looksLikeTextMapKey(value) {
  const text = String(value || '');
  return /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/.test(text);
}

// Recover a readable name for a key-named character: prefer codeName
// ("Remielle"), otherwise strip the key's scaffold segments.
function resolvedCharacterName(ch) {
  const raw = String(ch?.name || '');
  if (!looksLikeTextMapKey(raw)) return raw;
  const code = String(ch?.codeName || ch?.code || '').replace(/_En$/i, '');
  if (code && !looksLikeTextMapKey(code)) return code;
  return raw.replace(/^Avatar_[A-Za-z]+_Size\d+_/i, '').replace(/_En$/i, '').replace(/_/g, ' ').trim() || raw;
}

function gamedataCharacterAliases(game, ch) {
  const key = game === 'wuwa' ? 'ww' : game;
  const id = String(ch?.id || '');
  const name = cleanText(ch?.name, 120);
  const aliases = [ch?.name, name];

  const resolved = resolvedCharacterName(ch);
  if (resolved && resolved !== name) aliases.push(resolved);
  if (name.includes('•')) aliases.push(name.replace(/\s*•\s*/g, ' '));

  if (key === 'hsr') {
    if (id === '1001') aliases.push('March 7th');
    if (id === '1224') aliases.push('March 7th The Hunt', 'March 7th • The Hunt', 'March 7th Swordmaster');
    if (id === '1413') aliases.push('Evernight', 'March 7th Evernight', 'March 7th • Evernight');
    if (id === '1506') aliases.push('Silver Wolf LV.999', 'Silver Wolf LV999', 'Silver Wolf Lv 999', 'Silver Wolf • Lv. 999');
    if (id === '1225') aliases.push('Tingyun Fugue', 'Tingyun • Fugue');
    const trailblazerPath = {
      8001:'Destruction', 8002:'Destruction', 8003:'Preservation', 8004:'Preservation',
      8005:'Harmony', 8006:'Harmony', 8007:'Remembrance', 8008:'Remembrance',
      8009:'Elation', 8010:'Elation',
    }[id];
    if (trailblazerPath) aliases.push(`Trailblazer ${trailblazerPath}`, `Trailblazer • ${trailblazerPath}`);
  }

  if (key === 'ww' && name && !/^the\s+/i.test(name)) aliases.push(`The ${name}`);

  // GameData names agent 1261 "Jane"; Prydwen (and the game's UI) use "Jane Doe".
  if (key === 'zzz' && id === '1261') aliases.push('Jane Doe');

  return uniq(aliases.map((alias) => cleanText(alias, 120)).filter(Boolean));
}

function localizedNamesFrom(source) {
  const row = source && typeof source === 'object' ? source : {};
  // Unreleased characters can carry the raw TextMap key ("Avatar_Female_Size02_…")
  // instead of a translation — drop those, keep the languages that did resolve.
  const resolved = (value) => {
    const text = cleanText(value, 90);
    return text && looksLikeTextMapKey(text) ? undefined : text;
  };
  const out = {};
  if (row.en || row.name) out.en = resolved(row.en || row.name);
  if (row.zh) out.zh = resolved(row.zh);
  if (row.ja) out.ja = resolved(String(row.ja).replace(/\{RUBY_[^}]+\}/g, ''));
  if (row.ko) out.ko = resolved(row.ko);
  for (const key of Object.keys(out)) { if (!out[key]) delete out[key]; }
  return Object.keys(out).length ? out : undefined;
}

function voiceActorsFrom(source) {
  const row = source && typeof source === 'object' ? source : {};
  const out = {};
  const pairs = [
    ['english', row.english || row.en || row.cv_name_en],
    ['japanese', row.japanese || row.jp || row.ja || row.cv_name_jp],
    ['chinese', row.chinese || row.cn || row.zh || row.cv_name_cn],
    ['korean', row.korean || row.kr || row.ko || row.cv_name_ko],
  ];
  pairs.forEach(([key, value]) => {
    const text = cleanText(value, 180);
    if (text && text !== '-') out[key] = text;
  });
  return Object.keys(out).length ? out : undefined;
}

function mergeVoiceActors(primary, fallback) {
  const out = {};
  const score = (value) => {
    const text = cleanText(value, 180);
    if (!text || text === '-') return 0;
    return 1
      + (/[|]|https?:\/\//i.test(text) ? 4 : 0)
      + (/\([^)]*\)/.test(text) ? 2 : 0)
      + (/[A-Za-z]/.test(text) ? 1 : 0)
      + (/[^\x00-\x7f]/.test(text) ? 1 : 0);
  };
  [fallback, primary].forEach((source) => {
    if (!source || typeof source !== 'object') return;
    Object.entries(source).forEach(([key, value]) => {
      const text = cleanText(value, 180);
      if (!key || !text || text === '-') return;
      if (!out[key] || score(text) > score(out[key])) out[key] = text;
    });
  });
  return Object.keys(out).length ? out : undefined;
}

const fandomCharacterMetadataCache = new Map();

function fandomCharacterMetadata(game) {
  const key = game === 'ww' ? 'wuwa' : game;
  if (fandomCharacterMetadataCache.has(key)) return fandomCharacterMetadataCache.get(key);
  const rel = `Fandom/${key}/character-metadata.json`;
  const byName = new Map();
  if (exists(rel)) {
    for (const row of readJson(rel)) {
      if (!row || !row.name) continue;
      const meta = {
        localizedNames: localizedNamesFrom(row.localizedNames || row),
        voiceActors: voiceActorsFrom(row.voiceActors),
        release: parseRelease(row.releaseDate || row.release),
        releasePatch: cleanText(row.releasePatch || row.releaseVersion || row.version, 40) || undefined,
      };
      [row.name, row.pageTitle, ...(Array.isArray(row.aliases) ? row.aliases : [])]
        .filter(Boolean)
        .forEach((name) => byName.set(normKey(name), meta));
    }
  }
  fandomCharacterMetadataCache.set(key, byName);
  return byName;
}

const rawCharacterLocaleCache = new Map();
function rawCharacterLocaleMap(game, channel = nch()) {
  const key = `${game}:${channel}`;
  if (rawCharacterLocaleCache.has(key)) return rawCharacterLocaleCache.get(key);
  const rel = `GameData/${game}/${channel}/raw/characters.json`;
  const map = new Map();
  if (exists(rel)) {
    const raw = readJson(rel);
    const rows = Array.isArray(raw) ? raw : Object.values(raw || {});
    rows.forEach((row) => {
      const names = localizedNamesFrom(row);
      const name = row.en || row.name || row.code || row.code_name;
      if (name && names) map.set(normKey(name), names);
    });
  }
  rawCharacterLocaleCache.set(key, map);
  return map;
}

function prydwenVoiceActors(game, slug) {
  if (!slug) return undefined;
  const rel = `Prydwen/${game}/pages/characters/${slug}.json`;
  if (!exists(rel)) return undefined;
  const page = readJson(rel);
  const section = (page.sections || []).find((row) => /voice actors?/i.test(row.heading || row.id || ''));
  const text = section?.text || '';
  if (!text) return undefined;
  const out = {};
  const patterns = [
    ['english', /\b(?:ENG|EN)\s+([^\n]+)/i],
    ['japanese', /\b(?:JPN|JP)\s+([^\n]+)/i],
    ['chinese', /\b(?:CN|CHN)\s+([^\n]+)/i],
    ['korean', /\b(?:KR|KOR)\s+([^\n]+)/i],
  ];
  patterns.forEach(([key, pattern]) => {
    const match = text.match(pattern);
    const value = cleanText(match?.[1], 120);
    if (value && value !== '-') out[key] = value;
  });
  return Object.keys(out).length ? out : undefined;
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

// The material frame paints a rarity number straight onto its colour tier
// (1 grey, 2 green, 3 blue, 4 purple, 5 gold). GI/HSR/WuWa rank items on that
// same 1-5 star scale, so their numbers map 1:1. ZZZ does NOT — it uses a B/A/S
// rank enum (rarity 2/3/4 = blue/purple/gold, verified against agents: A-rank
// Anby = 3, S-rank Ellen = 4). Feeding the raw enum to the frame paints every
// ZZZ item a tier too low (S-rank boss mats show purple, not gold) and wrongly
// uses green — a colour ZZZ never has. Remap the ZZZ enum onto the shared tier
// scale: 1->grey, B(2)->blue, A(3)->purple, S(4)->gold, and clamp 5 to gold.
const ZZZ_RARITY_TIER = { 0: 0, 1: 1, 2: 3, 3: 4, 4: 5, 5: 5 };
function materialDisplayRarity(game, value, fallback = 1) {
  const n = rarityNumber(value, fallback);
  if (game !== 'zzz') return n;
  return ZZZ_RARITY_TIER[n] ?? Math.min(5, Math.max(1, n));
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
    gi: 'GameData/gi/live/monsters.json',
    hsr: 'GameData/hsr/live/monsters.json',
    zzz: 'GameData/zzz/live/monsters.json',
    wuwa: 'GameData/ww/live/monsters.json',
    ww: 'GameData/ww/live/monsters.json',
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
// G31: GI character namecards (wide banner art), keyed normName(name) -> asset path.
const GENSHIN_NAMECARD_ART = (() => {
  const rel = 'GenshinWiki/namecards/manifest.json';
  const map = new Map();
  if (!exists(rel)) return map;
  for (const [key, relPath] of Object.entries(readJson(rel) || {})) {
    const asset = dbAsset(relPath);
    if (key && asset) map.set(key, asset);
  }
  return map;
})();
const GENSHIN_AVATARS = exists('GenshinWiki/avatars/manifest.json')
  ? (readJson('GenshinWiki/avatars/manifest.json').entries || []).map((entry) => ({
      id:`wiki-avatar-${entry.id}`,
      name:cleanText(entry.name, 120),
      art:dbAsset(entry.art),
      sortId:Number(entry.sortId || entry.id || 0),
    })).filter((entry) => entry.name && entry.art)
  : [];

function genshinLibraryNames() {
  const dir = path.resolve(dbDir, 'Library', 'gi');
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => cleanText(readJson(`Library/gi/${name}`).name, 180))
    .filter(Boolean)
    .map(normKey));
}

const GENSHIN_LIBRARY_NAMES = genshinLibraryNames();

function genshinItemDestination(item, source) {
  const materialType = String(source?.material_type || '');
  const type = String(source?.type || item?.type || '').trim();
  const description = String(source?.desc || item?.description || '');
  if (['MATERIAL_NAMECARD', 'MATERIAL_PROFILE_PICTURE', 'MATERIAL_PROFILE_FRAME'].includes(materialType)) return 'gallery';
  if (materialType === 'MATERIAL_GCG_CARD' || materialType === 'MATERIAL_GCG_CARD_FACE') return 'tcg';
  if (materialType === 'MATERIAL_WEAPON_SKIN') return 'weapons';
  if (type === 'Firearm Accessory Blueprint') return 'shadowRealm';
  if (materialType === 'MATERIAL_FURNITURE_FORMULA'
      || materialType === 'MATERIAL_FURNITURE_SUITE_FORMULA'
      || (type === 'Material' && /\bfurniture\b|\bRealm Within\b/i.test(description))) return 'pot';
  if (materialType === 'MATERIAL_PHOTOGRAPH_POSE'
      || materialType === 'MATERIAL_COSTUME'
      || materialType === 'MATERIAL_BEYOND_COSTUME_SELECTABLE_CHEST'
      || type === 'Wonderland EXP') return 'wonderland';
  if (GENSHIN_LIBRARY_NAMES.has(normKey(item?.name))) return 'library';
  if (type === 'Unknown Weapon') return 'duplicate';
  return 'items';
}

function genshinDatabaseItemReleased(item, source) {
  return databaseRecordClassification({
    game:'gi',
    collection:'items',
    recordId:item?.id,
    name:item?.name,
    sourceIcon:sourceIconField(source)?.value,
  }) === 'released';
}
// G37: Endfield skill icons scraped from endfield.wiki.gg, keyed normKey(name) -> [Basic, Skill, Combo, Ult].
const ENDFIELD_SKILL_ICONS = (() => {
  const rel = 'EndfieldWiki/endfield/skill-icons/manifest.json';
  const map = new Map();
  if (!exists(rel)) return map;
  for (const [key, arr] of Object.entries(readJson(rel) || {})) {
    const icons = (arr || []).map((p) => (p ? dbAsset(p) : null));
    if (icons.some(Boolean)) map.set(key, icons);
  }
  return map;
})();
// Real Endfield progression materials (name + icon + rarity) scraped from
// endfield.wiki.gg by tools/scrape-endfield-materials.mjs. Endfield ships no
// per-character ascension recipe we can source yet, so the roster attaches one
// shared schedule built from these real items — identities/icons/rarities are
// correct even though the quantities are a representative approximation. This
// replaces the synthetic "Origin Crystal / Salvaged Part / ..." placeholders
// that had no icons at all.
const ENDFIELD_WIKI_ITEMS = (() => {
  const map = new Map();
  const rel = 'EndfieldWiki/endfield/items.json';
  if (!exists(rel)) return map;
  const raw = readJson(rel);
  const items = raw.items || raw;
  for (const item of Object.values(items || {})) {
    if (!item?.id && !item?.name) continue;
    const iconPath = item.icon?.path || item.iconPath || item.iconLocal || item.icon;
    const entry = {
      id: item.id || item.pageName || item.name,
      name: cleanText(item.name || item.id || '', 90),
      rar: Number(item.rarity || item.rar || 0) || undefined,
      kind: item.kind || undefined,
      icon: dbAsset(iconPath),
      source: cleanText(item.source || '', 220) || undefined,
      sourceUrl: item.sourceUrl || undefined,
    };
    for (const key of [entry.id, item.pageName, item.name, normKey(entry.name)]) {
      if (key) map.set(String(key), entry);
    }
  }
  return map;
})();
const ENDFIELD_LEGACY_MATERIALS = (() => {
  const rel = 'EndfieldWiki/endfield/material-icons/manifest.json';
  const map = new Map();
  if (!exists(rel)) return map;
  for (const [key, m] of Object.entries(readJson(rel) || {})) {
    if (m && m.name) map.set(key, { ...m, icon: m.icon ? dbAsset(m.icon) : null });
  }
  return map;
})();

function endfieldMaterial(name, qty, kind) {
  const hit = lookupEndfieldItem(name);
  return {
    id: `ae:${hit?.id || normKey(name)}`,
    name: hit?.name || name,
    n: hit?.name || name,
    qty,
    rar: hit?.rar || 3,
    kind,
    icon: hit?.icon || null,
    source: hit?.source || 'Endfield database',
    sourceUrl: hit?.sourceUrl,
  };
}

function lookupEndfieldItem(idOrName) {
  if (!idOrName) return null;
  return ENDFIELD_WIKI_ITEMS.get(String(idOrName))
    || ENDFIELD_WIKI_ITEMS.get(normKey(idOrName))
    || ENDFIELD_LEGACY_MATERIALS.get(normKey(idOrName))
    || null;
}

function endfieldRequirementMaterial(entry, fallbackKind = 'item') {
  if (!entry?.id || !Number(entry.count || 0)) return null;
  const hit = lookupEndfieldItem(entry.id);
  const name = hit?.name || String(entry.id).replace(/_/g, ' ');
  return {
    id: `ae:${hit?.id || entry.id}`,
    name,
    n: name,
    qty: Number(entry.count || 0),
    rar: hit?.rar || 3,
    kind: hit?.kind || fallbackKind,
    icon: hit?.icon || null,
    source: hit?.source || 'Endfield Wiki',
    sourceUrl: hit?.sourceUrl,
  };
}

function endfieldRequirementList(entries, fallbackKind) {
  return (entries || [])
    .map((entry) => endfieldRequirementMaterial(entry, fallbackKind))
    .filter(Boolean)
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.name.localeCompare(b.name));
}

function endfieldReqFromMaterials(materials) {
  if (!materials || (!materials.ascension?.length && !materials.skill?.length)) return null;
  return {
    ascension: endfieldRequirementList(materials.ascension || [], 'gem'),
    talents: endfieldRequirementList(materials.skill || [], 'book'),
    promotionStages: (materials.promotionStages || []).map((stage) => ({
      items: endfieldRequirementList(stage, 'gem'),
      cost: 0,
    })),
    skillLevelStages: (materials.skillLevelStages || []).map((stage) => ({
      items: endfieldRequirementList(stage, 'book'),
      cost: 0,
    })),
    skillMasteryStages: (materials.skillMasteryStages || []).map((stage) => ({
      items: endfieldRequirementList(stage, 'book'),
      cost: 0,
    })),
    extras: endfieldRequirementList(materials.extras || [], 'book'),
    ascCost: 0,
    talentCost: 0,
    currency: 0,
  };
}

// Fallback only. Current EndfieldWiki scraper runs emit exact per-character
// material tables; this shared schedule is used only for older or partial data.
function endfieldSharedReq() {
  const ascension = [
    endfieldMaterial('Credits', 500000, 'currency'),
    endfieldMaterial('Protohedron', 46, 'gem'),
    endfieldMaterial('Protoprism', 46, 'gem'),
    endfieldMaterial('Heavy Cast Die', 36, 'mob'),
    endfieldMaterial('Cast Die', 96, 'mob'),
    endfieldMaterial('Arms Inspector', 168, 'mob'),
    endfieldMaterial('Mark of Perseverance', 12, 'boss'),
  ];
  const talents = [
    endfieldMaterial('Credits', 700000, 'currency'),
    endfieldMaterial('Advanced Combat Record', 12, 'book'),
    endfieldMaterial('Intermediate Combat Record', 21, 'book'),
    endfieldMaterial('Elementary Combat Record', 9, 'book'),
    endfieldMaterial('Elementary Cognitive Carrier', 18, 'specialty'),
    endfieldMaterial('Heavy Cast Die', 24, 'mob'),
    endfieldMaterial('Cast Die', 18, 'mob'),
    endfieldMaterial('D96 Steel Sample 4', 12, 'weekly'),
  ];
  return { ascension, talents, ascCost: 0, talentCost: 0, currency: 0 };
}

// G37/ZZZ: the 5 skill-type icons are SHARED across all agents (Basic / Dodge /
// Assist / Special Attack / Chain Attack), sourced from static.nanoka.cc.
const ZZZ_SKILL_ICONS = [
  'GameData/zzz/assets/skills/Icon_Normal.webp',
  'GameData/zzz/assets/skills/Icon_Evade.webp',
  'GameData/zzz/assets/skills/Icon_Switch.webp',
  'GameData/zzz/assets/skills/IconRoleSkillKeySpecialV2.webp',
  'GameData/zzz/assets/skills/Icon_UltimateReady.webp',
].map((p) => dbAsset(p));

function zzzAgentAvatarIcon(agent) {
  const id = String(agent?.id || '').trim();
  return id ? dbAsset(`GameData/zzz/assets/items/CardDailyUse${id}.webp`) : null;
}

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
  zzz: {},
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
  const rel = 'GameData/gi/gcg/character cards/cards.json';
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
  const otherCards = gcgAssetPrefixIndex('GameData/gi/gcg/other cards/assets');
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

function gcgAssetLabel(file) {
  return String(file || '')
    .replace(/\.webp$/i, '')
    .replace(/^\d+-/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildGenshinTcgCards() {
  const characterRel = 'GameData/gi/gcg/character cards/cards.json';
  const otherRel = 'GameData/gi/gcg/other cards/cards.json';
  const reportRel = 'GameData/gi/gcg/report.json';
  const ambrRel = 'Ambr/gi/gcg/cards-en.json';
  const ambrById = new Map((exists(ambrRel) ? readJson(ambrRel) : []).map((card) => [String(card.id), card]));
  const mapTcgCard = (card, fallbackType, playableCharacter) => {
    const id = String(card.id || card.name);
    const detailTalent = card.details?.talent || null;
    const ambr = ambrById.get(id);
    return {
      id,
      name:card.name || card.playableCharacter || String(card.id),
      title:card.title || null,
      description:card.description || ambr?.description || null,
      sourceText:card.source || null,
      localizedNames:card.localizedNames || undefined,
      type:card.type || fallbackType,
      cost:card.cost ?? undefined,
      hp:Number.isFinite(Number(card.hp)) ? Number(card.hp) : undefined,
      relatedCardId:card.relatedCardId ? String(card.relatedCardId) : undefined,
      tags:Array.isArray(card.tags) ? card.tags : [],
      talent:detailTalent || undefined,
      playableCharacter,
      art:dbAsset(card.localAsset),
    };
  };
  const characterCards = exists(characterRel)
    ? readJson(characterRel)
      .map((card) => mapTcgCard(card, 'Character', card.playableCharacter || null))
    : [];
  const otherDir = path.resolve(dbDir, 'GameData/gi/gcg/other cards/assets');
  const otherCards = exists(otherRel)
    ? readJson(otherRel)
      .map((card) => mapTcgCard(card, 'Action', null))
      .sort((a, b) => a.name.localeCompare(b.name))
    : fs.existsSync(otherDir)
      ? fs.readdirSync(otherDir, { withFileTypes:true })
        .filter((entry) => entry.isFile() && /\.webp$/i.test(entry.name))
        .map((entry) => {
          const id = entry.name.match(/^(\d+)-/)?.[1] || entry.name.replace(/\.webp$/i, '');
        return {
          id:String(id),
          name:gcgAssetLabel(entry.name) || String(id),
          title:null,
          description:ambrById.get(String(id))?.description || null,
          localizedNames:ambrById.get(String(id))?.localizedNames || undefined,
          type:'Action',
          tags:[],
          playableCharacter:null,
          art:dbAsset(`GameData/gi/gcg/other cards/assets/${entry.name}`),
        };
        })
        .sort((a, b) => a.name.localeCompare(b.name))
      : [];
  const report = exists(reportRel) ? readJson(reportRel) : null;
  return {
    updated: report?.generatedAt || null,
    counts:{ characterCards:characterCards.length, otherCards:otherCards.length },
    characterCards,
    otherCards,
  };
}

function buildGenshinTcgItemVariantArtMap() {
  const artByVariantIcon = new Map();
  for (const rel of [
    'GameData/gi/gcg/character cards/cards.json',
    'GameData/gi/gcg/other cards/cards.json',
  ]) {
    if (!exists(rel)) continue;
    for (const card of readJson(rel)) {
      if (!card?.icon || !card?.localAsset) continue;
      const art = dbAsset(card.localAsset);
      if (!art) continue;
      artByVariantIcon.set(`${card.icon}_Golden`, art);
      artByVariantIcon.set(`${card.icon}_Platinum`, art);
    }
  }
  return artByVariantIcon;
}

// Serenitea Pot furnishings scraped from https://gi.nanoka.cc/furniture (see
// Site/tools/scrape-gamedata-furniture.mjs). Recipe material ids are resolved to
// names/icons through the same GameData gi item list used by the material tools.
function buildGenshinFurniture() {
  const furnitureRel = 'GameData/gi/furniture/furniture.json';
  const reportRel = 'GameData/gi/furniture/report.json';
  if (!exists(furnitureRel)) {
    return { updated:null, counts:{ items:0 }, categories:[], items:[] };
  }
  const itemLookup = gamedataItemLookup('gi');
  const resolveMaterial = (mat) => {
    const found = itemLookup.get(String(mat.id));
    return {
      id:String(mat.id),
      name:found?.name || String(mat.id),
      count:Number(mat.count) || 0,
      icon:found?.assets?.icon ? dbAsset(found.assets.icon) : null,
    };
  };
  const items = readJson(furnitureRel).filter((f) => f.name && f.name !== '???').map((f) => {
    const recipe = f.recipe && Array.isArray(f.recipe.items) && f.recipe.items.length
      ? {
          time:Number.isFinite(Number(f.recipe.time)) ? Number(f.recipe.time) : null,
          exp:Number.isFinite(Number(f.recipe.exp)) ? Number(f.recipe.exp) : null,
          materials:f.recipe.items.map(resolveMaterial),
        }
      : null;
    return {
      id:String(f.id),
      name:f.name || String(f.id),
      description:f.description || null,
      rarity:Number.isFinite(Number(f.rank)) ? Number(f.rank) : null,
      category:(Array.isArray(f.type) && f.type[0]) || 'Other',
      types:Array.isArray(f.type) ? f.type : [],
      subtypes:Array.isArray(f.type2) ? f.type2 : [],
      comfort:Number.isFinite(Number(f.comfort)) ? Number(f.comfort) : null,
      cost:Number.isFinite(Number(f.cost)) ? Number(f.cost) : null,
      source:Array.isArray(f.source) ? f.source : [],
      recipe,
      art:dbAsset(f.localAsset),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const catCounts = new Map();
  items.forEach((item) => catCounts.set(item.category, (catCounts.get(item.category) || 0) + 1));
  const categories = [...catCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, count }));
  const sourceItems = databaseSourceRows('gi', 'items');
  const inventoryItem = (item) => ({
      id:String(item.id),
      name:item.name,
      description:cleanDatabaseText(item.description),
      rarity:Number(item.rarity) || null,
      category:item.type,
      art:dbAsset(item.assets?.icon),
    });
  const potItems = readJson('GameData/gi/live/items.json')
    .filter((item) => {
      const source = sourceItems.get(String(item.id));
      return genshinDatabaseItemReleased(item, source) && genshinItemDestination(item, source) === 'pot';
    });
  const blueprints = potItems
    .filter((item) => /Blueprint/i.test(item.type || ''))
    .map(inventoryItem)
    .sort((left, right) => Number(right.id) - Number(left.id));
  const materials = potItems
    .filter((item) => !/Blueprint/i.test(item.type || ''))
    .map(inventoryItem)
    .sort((left, right) => Number(right.id) - Number(left.id));
  const report = exists(reportRel) ? readJson(reportRel) : null;
  return {
    updated:report?.generatedAt || null,
    version:report?.version || null,
    counts:{ items:items.length, craftable:items.filter((i) => i.recipe).length },
    categories,
    items,
    blueprints,
    materials,
  };
}

// Miliastra Wonderland is scraped atomically by Scraper/wonderland. Its filter
// labels come from the source lang_map payload, while all art stays in the local
// Database mirror (no runtime hotlinks).
function buildGenshinWonderland() {
  const base = 'GameData/gi/beyond';
  const reportRel = `${base}/report.json`;
  const langRel = `${base}/lang-map.json`;
  const humanize = (value) => cleanText(String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^BEYOND_/i, '')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()), 120);
  const canonical = (value) => String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  const langMap = exists(langRel) ? readJson(langRel) : { slot:{}, color:{} };
  const labelFrom = (group, value) => langMap[group]?.[canonical(value)] || humanize(value);
  const readRows = (name, kind) => {
    const rel = `${base}/${name}.json`;
    if (!exists(rel)) return [];
    return readJson(rel).map((row) => ({
      id:String(row.id),
      name:row.name || `Wonderland ${kind} ${row.id}`,
      kind,
      art:dbAsset(row.localAsset),
      rank:humanize(row.rank),
      type:humanize(row.type),
      body:(row.body || []).map((value) => humanize(String(value).replace(/^BODY_/i, ''))).filter(Boolean),
      color:(row.color || []).map((value) => labelFrom('color', value)).filter(Boolean),
      slot:(row.slot || []).map((value) => labelFrom('slot', value)).filter(Boolean),
      nameMissing:row.nameMissing === true,
    }));
  };
  const report = exists(reportRel) ? readJson(reportRel) : null;
  const costumes = readRows('costumes', 'Costume');
  const suits = readRows('suits', 'Set');
  const items = readRows('items', 'Inventory Item');
  return {
    updated:report?.generatedAt || null,
    version:report?.version || null,
    langMap,
    counts:{ costumes:costumes.length, suits:suits.length, items:items.length },
    costumes,
    suits,
    items,
  };
}

function markRecentBuckets(roster, keyFn, fallbackCount = 9, includeFn = () => true) {
  roster.forEach((ch) => {
    delete ch.recent;
    delete ch.recentFallback;
  });
  const eligible = roster.filter((ch) => includeFn(ch));
  const groups = new Map();
  for (const ch of eligible) {
    const key = keyFn(ch);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ch);
  }

  const selected = [];
  let buckets = 0;
  const huge = Math.max(12, Math.ceil((eligible.length || 1) * 0.3));
  for (const [, list] of [...groups.entries()].sort((a, b) => Number(b[0]) - Number(a[0]))) {
    if (list.length > huge) continue;
    selected.push(...list);
    buckets += 1;
    if (buckets >= 3) break;
  }

  const final = selected.length >= 3
    ? selected
    : eligible.slice(0, Math.min(fallbackCount, eligible.length));
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

const giItemLookupCache = new Map();

function giItemLookup() {
  if (giItemLookupCache.has(nch())) return giItemLookupCache.get(nch());
  const byKey = new Map();
  if (!exists(`GameData/gi/${nch()}/items.json`)) {
    giItemLookupCache.set(nch(), byKey);
    return byKey;
  }
  for (const item of readJson(`GameData/gi/${nch()}/items.json`)) {
    if (!item) continue;
    if (item.id !== undefined && item.id !== null) byKey.set(String(item.id), item);
    if (item.name) byKey.set(String(item.name).toLowerCase(), item);
  }
  giItemLookupCache.set(nch(), byKey);
  return byKey;
}

const gamedataItemLookupCache = new Map();

function gamedataItemLookup(game) {
  const cacheKey = `${game}:${nch()}`;
  if (gamedataItemLookupCache.has(cacheKey)) return gamedataItemLookupCache.get(cacheKey);
  const byKey = new Map();
  const rel = `GameData/${game}/${nch()}/items.json`;
  if (!exists(rel)) {
    gamedataItemLookupCache.set(cacheKey, byKey);
    return byKey;
  }
  for (const item of readJson(rel)) {
    if (!item) continue;
    if (item.id !== undefined && item.id !== null) byKey.set(String(item.id), item);
    if (item.name) byKey.set(String(item.name).toLowerCase(), item);
  }
  gamedataItemLookupCache.set(cacheKey, byKey);
  return byKey;
}

const localAvatarOverlayCache = new Map();

function setNamedMapEntry(map, name, value, aliases = [], options = {}) {
  if (!map || !value) return;
  const names = uniq([name, cleanText(name, 120), ...aliases].filter(Boolean));
  for (const alias of names) {
    const lower = String(alias).toLowerCase();
    const norm = normKey(alias);
    if (lower && (options.force || !map.has(lower))) map.set(lower, value);
    if (norm && (options.force || !map.has(norm))) map.set(norm, value);
  }
}

const PROFILE_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function profileNumber(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Number(n.toFixed(digits));
}

function profileText(value, max = 120) {
  const text = cleanText(value, max);
  if (!text || /^(?:unknown|none|n\/a|-+|\?+|[■□]+)$/i.test(text)) return undefined;
  return text;
}

function profileFirst(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return profileFirst(Object.values(value)[0]);
  return value;
}

function profilePlace(value) {
  const text = profileText(value, 120);
  if (!text) return undefined;
  return text === text.toUpperCase()
    ? text.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    : text;
}

function profileBirthday(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const month = Number(value[0]);
    const day = Number(value[1]);
    return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${PROFILE_MONTHS[month - 1]} ${day}` : undefined;
  }
  const text = profileText(value, 40);
  if (!text) return undefined;
  const cleaned = text.replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1').replace(/\s+/g, ' ').trim();
  const match = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (!match) return undefined;
  const monthIndex = PROFILE_MONTHS.findIndex((month) => month.toLowerCase().startsWith(match[1].toLowerCase().slice(0, 3)));
  const day = Number(match[2]);
  return monthIndex >= 0 && day >= 1 && day <= 31 ? `${PROFILE_MONTHS[monthIndex]} ${day}` : undefined;
}

function giProfileData(ch) {
  const stats = ch?.stats || {};
  const modifiers = stats.modifiers || {};
  const maxLevel = 90;
  const ascension = Array.isArray(modifiers.ascension) ? modifiers.ascension.at(-1) || {} : {};
  const scaled = (key, ascensionKey) => {
    const base = Number(stats[key]);
    const curve = Number(modifiers[key === 'baseHp' ? 'hp' : key === 'baseAtk' ? 'atk' : 'def']?.[maxLevel]);
    if (!Number.isFinite(base) || !Number.isFinite(curve)) return undefined;
    return profileNumber(base * curve + Number(ascension[ascensionKey] || 0));
  };
  const level1 = {
    hp: profileNumber(stats.baseHp),
    atk: profileNumber(stats.baseAtk),
    def: profileNumber(stats.baseDef),
    critRate: profileNumber(stats.critRate, 4),
    critDmg: profileNumber(stats.critDmg, 4),
    elementalMastery: profileNumber(stats.elementalMastery),
  };
  const max = {
    level: maxLevel,
    hp: scaled('baseHp', 'fight_prop_base_hp'),
    atk: scaled('baseAtk', 'fight_prop_base_attack'),
    def: scaled('baseDef', 'fight_prop_base_defense'),
    critRate: profileNumber(Number(stats.critRate || 0) + Number(ascension.fight_prop_critical || 0), 4),
    critDmg: profileNumber(Number(stats.critDmg || 0) + Number(ascension.fight_prop_critical_hurt || 0), 4),
    elementalMastery: profileNumber(Number(stats.elementalMastery || 0) + Number(ascension.fight_prop_element_mastery || 0)),
  };
  const rechargeBonus = Number(ascension.fight_prop_charge_efficiency || 0);
  if (rechargeBonus) {
    level1.energyRecharge = 1;
    max.energyRecharge = profileNumber(1 + rechargeBonus, 4);
  }
  const isTraveler = /^1000000[57]/.test(String(ch?.id || '')) || /^Traveler$/i.test(String(ch?.name || ''));
  const nation = String(ch?.profile?.region || '').replace(/^ASSOC_TYPE_/, '').replace(/_/g, ' ');
  return {
    baseStats: Object.keys(level1).some((key) => level1[key] !== undefined) ? { level1, max } : {},
    facts: {
      title: profileText(ch?.profile?.title),
      affiliation: profileText(ch?.profile?.native),
      constellation: profileText(ch?.profile?.constellation),
      birthday: isTraveler ? undefined : profileBirthday(ch?.profile?.birth || ch?.birthday),
      nation: /^MAINACTOR$/i.test(nation) ? undefined : profilePlace(nation),
    },
  };
}

function hsrProfileData(ch) {
  const ascensions = Array.isArray(ch?.ascensions) ? ch.ascensions : [];
  const first = ascensions[0]?.stats || {};
  const last = ascensions.at(-1)?.stats || {};
  const maxLevel = 80;
  const grow = (baseKey, addKey) => profileNumber(Number(last[baseKey]) + Number(last[addKey] || 0) * (maxLevel - 1));
  const hasStats = Object.keys(first).length > 0;
  return {
    baseStats: hasStats ? {
      level1: {
        hp: profileNumber(first.hp_base), atk: profileNumber(first.attack_base), def: profileNumber(first.defence_base),
        speed: profileNumber(first.speed_base), critRate: profileNumber(first.critical_chance, 4), critDmg: profileNumber(first.critical_damage, 4),
      },
      max: {
        level: maxLevel, hp: grow('hp_base', 'hp_add'), atk: grow('attack_base', 'attack_add'), def: grow('defence_base', 'defence_add'),
        speed: profileNumber(last.speed_base), critRate: profileNumber(last.critical_chance, 4), critDmg: profileNumber(last.critical_damage, 4),
      },
    } : {},
    facts: { camp: profileText(ch?.profile?.camp) },
  };
}

function zzzProfileData(ch) {
  const stats = ch?.stats || {};
  const maxLevel = 60;
  const promotion = ch?.levels?.[6] || Object.values(ch?.levels || {}).at(-1) || {};
  const grow = (baseKey, growthKey, promotionKey = baseKey) => profileNumber(
    Number(stats[baseKey]) + Number(stats[growthKey] || 0) / 10000 * (maxLevel - 1) + Number(promotion[promotionKey] || 0),
  );
  const hasStats = Number.isFinite(Number(stats.hp_max));
  return {
    baseStats: hasStats ? {
      level1: {
        hp: profileNumber(stats.hp_max), atk: profileNumber(stats.attack), def: profileNumber(stats.defence),
        critRate: profileNumber(Number(stats.crit) / 10000, 4), critDmg: profileNumber(Number(stats.crit_damage) / 10000, 4),
        impact: profileNumber(stats.break_stun), anomalyProficiency: profileNumber(stats.element_abnormal_power), anomalyMastery: profileNumber(stats.element_mystery),
      },
      max: {
        level: maxLevel, hp: grow('hp_max', 'hp_growth'), atk: grow('attack', 'attack_growth'), def: grow('defence', 'defence_growth'),
        critRate: profileNumber(Number(stats.crit) / 10000, 4), critDmg: profileNumber(Number(stats.crit_damage) / 10000, 4),
        impact: profileNumber(stats.break_stun), anomalyProficiency: profileNumber(stats.element_abnormal_power), anomalyMastery: profileNumber(stats.element_mystery),
      },
    } : {},
    facts: {
      fullName: resolvedProfileText(ch?.profile?.full_name),
      faction: resolvedProfileText(profileFirst(ch?.camp)),
      birthday: profileBirthday(ch?.profile?.birthday),
    },
  };
}

// Unreleased agents carry raw TextMap keys (e.g. "Partner_Name_1581") in profile
// fields — drop those rather than showing the key to users.
function resolvedProfileText(value, max = 120) {
  const text = profileText(value, max);
  return text && looksLikeTextMapKey(text) ? undefined : text;
}

function wuwaProfileData(ch) {
  const curves = ch?.stats?.stats || {};
  const firstCurve = curves[Object.keys(curves).sort((a, b) => Number(a) - Number(b))[0]] || {};
  const lastCurve = curves[Object.keys(curves).sort((a, b) => Number(a) - Number(b)).at(-1)] || {};
  const first = firstCurve[Object.keys(firstCurve).sort((a, b) => Number(a) - Number(b))[0]] || {};
  const maxLevel = Number(Object.keys(lastCurve).sort((a, b) => Number(a) - Number(b)).at(-1));
  const maxRow = lastCurve[maxLevel] || {};
  const info = ch?.profile?.charaInfo || {};
  return {
    baseStats: Object.keys(first).length ? {
      level1: { hp: profileNumber(first.life), atk: profileNumber(first.atk), def: profileNumber(first.def) },
      max: { level: maxLevel, hp: profileNumber(maxRow.life), atk: profileNumber(maxRow.atk), def: profileNumber(maxRow.def) },
    } : {},
    facts: {
      birthday: profileBirthday(info.birth),
      nation: profileText(info.country),
      influence: profileText(info.influence),
    },
  };
}

function endfieldProfileData(ch) {
  return {
    // The current structured Cargo/infobox records do not expose numeric operator
    // base stats. Keep the normalized object present and empty instead of guessing.
    baseStats: {},
    facts: {
      faction: profileText(ch?.faction || ch?.infobox?.faction),
      birthday: profileBirthday(ch?.birthDate || ch?.infobox?.birthdate),
    },
  };
}

function localAvatarOverlay(game, channel = nch()) {
  const key = game === 'ww' ? 'wuwa' : game;
  const cacheKey = `${key}:${channel}`;
  if (localAvatarOverlayCache.has(cacheKey)) return localAvatarOverlayCache.get(cacheKey);
  const byName = new Map();
  const fandom = fandomCharacterMetadata(key);

  if (key === 'hsr' && exists(`GameData/hsr/${channel}/characters.json`)) {
    const localized = rawCharacterLocaleMap('hsr', channel);
    for (const ch of readJson(`GameData/hsr/${channel}/characters.json`)) {
      if (!ch?.name) continue;
      const displayName = cleanText(resolvedCharacterName(ch), 120);
      const meta = fandom.get(normKey(displayName)) || fandom.get(normKey(ch.name));
      const payload = {
        contentStatus: ch.contentStatus,
        icon: dbAsset(ch.assets?.roundIcon || ch.assets?.avatar),
        splash: dbAsset(ch.assets?.drawCard), // D1: HSR splash art = draw-card
        fallbackArt: dbAsset(ch.assets?.drawCard || ch.assets?.avatar),
        title: titleOverride('hsr', displayName),
        localizedNames: localized.get(normKey(displayName)) || localized.get(normKey(ch.name)) || meta?.localizedNames,
        voiceActors: mergeVoiceActors(voiceActorsFrom(ch.profile?.va), meta?.voiceActors),
        release: parseRelease(ch.release) || meta?.release,
        releasePatch: meta?.releasePatch,
        ...hsrProfileData(ch),
      };
      setNamedMapEntry(byName, displayName, payload, gamedataCharacterAliases('hsr', ch), { force: String(ch.id) === '1001' });
    }
  }

  if (key === 'zzz' && exists(`GameData/zzz/${channel}/agents.json`)) {
    const localized = rawCharacterLocaleMap('zzz', channel);
    for (const ch of readJson(`GameData/zzz/${channel}/agents.json`)) {
      if (!ch?.name) continue;
      const displayName = cleanText(resolvedCharacterName(ch), 120);
      const meta = fandom.get(normKey(displayName)) || fandom.get(normKey(ch.name));
      setNamedMapEntry(byName, displayName, {
        // Facts fallback for agents Prydwen only stubs (attribute/specialty "Unknown")
        el: profileText(profileFirst(ch.element)),
        spec: profileText(profileFirst(ch.specialty)),
        rarity: Number(ch.rarity) || undefined,
        // B: real agent icons first (circle partner icon, then square role icon);
        // the CardDailyUse daily-use card art is a last-resort fallback only.
        icon: dbAsset(ch.assets?.partnerIcon || ch.assets?.icon) || zzzAgentAvatarIcon(ch),
        splash: dbAsset(ch.assets?.roleIcon || ch.assets?.icon), // D1: ZZZ splash art = full role art
        fallbackArt: dbAsset(ch.assets?.icon),
        title: titleOverride('zzz', displayName),
        localizedNames: localized.get(normKey(displayName)) || localized.get(normKey(ch.name)) || meta?.localizedNames,
        voiceActors: meta?.voiceActors,
        release: meta?.release,
        releasePatch: meta?.releasePatch,
        ...zzzProfileData(ch),
      }, gamedataCharacterAliases('zzz', ch));
    }
  }

  if (key === 'wuwa' && exists(`GameData/ww/${channel}/characters.json`)) {
    const localized = rawCharacterLocaleMap('ww', channel);
    for (const ch of readJson(`GameData/ww/${channel}/characters.json`)) {
      if (!ch?.name) continue;
      const detailRel = `GameData/ww/${channel}/raw/characters/${ch.id}.json`;
      const detail = exists(detailRel) ? readJson(detailRel) : null;
      const displayName = cleanText(resolvedCharacterName(ch), 120);
      const meta = fandom.get(normKey(displayName)) || fandom.get(normKey(ch.name));
      setNamedMapEntry(byName, displayName, {
        icon: dbAsset(ch.assets?.icon),
        // D1: WuWa splash art = PixActivity full-body portrait, half-body stand as fallback
        splash: dbAsset(ch.assets?.portrait || ch.assets?.stand),
        fallbackArt: dbAsset(ch.assets?.background),
        title: titleOverride('wuwa', displayName),
        localizedNames: localized.get(normKey(displayName)) || localized.get(normKey(ch.name)) || meta?.localizedNames,
        voiceActors: mergeVoiceActors(voiceActorsFrom(detail || ch.profile), meta?.voiceActors),
        release: meta?.release,
        releasePatch: meta?.releasePatch,
        releaseOrder: Number(ch.id) || 0,
        ...wuwaProfileData(ch),
      }, gamedataCharacterAliases('ww', ch));
    }
  }

  localAvatarOverlayCache.set(cacheKey, byName);
  return byName;
}

function trustedPrydwenIcon(game, ch) {
  const rel = ch?.art?.icon;
  if (!rel) return null;
  const slug = normKey(ch?.slug || ch?.id || ch?.name);
  const base = normKey(path.basename(String(rel)).replace(/-[a-f0-9]+\.[a-z0-9]+$/i, ''));
  if (!slug || !base || !base.includes(slug)) return null;
  return dbAsset(rel);
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
        // GI weekly-drop identity is the exact sourced ID set. Name matching
        // would incorrectly classify Dragon Lord's Crown as Crown of Insight.
        kind: game === 'gi' && GI_WEEKLY_DROP_IDS.has(String(id))
          ? 'weekly'
          : (game === 'gi' && GI_NON_WEEKLY_113_IDS.has(String(id))
            ? 'specialty'
            : inferMatKind(name, mat.rank, item)),
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
  { bossName: 'Stormterror Dvalin', releaseOrder:1, artAliases:['Stormterror'], matIds: ['113003', '113004', '113005'] },
  { bossName: 'Andrius', releaseOrder:2, artAliases:['Lupus Boreas, Dominator of Wolves'], matIds: ['113006', '113007', '113008'] },
  { bossName: 'Childe', releaseOrder:3, artAliases:['Tartaglia'], matIds: ['113013', '113014', '113015'] },
  { bossName: 'Azhdaha', releaseOrder:4, matIds: ['113017', '113018', '113019'] },
  { bossName: 'La Signora', releaseOrder:5, matIds: ['113025', '113026', '113027'] },
  { bossName: 'Magatsu Mitake Narukami no Mikoto', releaseOrder:6, matIds: ['113032', '113033', '113034'] },
  { bossName: 'Everlasting Lord of Arcane Wisdom', releaseOrder:7, artAliases:['Shouki no Kami, the Prodigal'], matIds: ['113041', '113042', '113043'] },
  { bossName: "Guardian of Apep's Oasis", releaseOrder:8, matIds: ['113046', '113047', '113048'] },
  { bossName: 'All-Devouring Narwhal', releaseOrder:9, matIds: ['113054', '113055', '113056'] },
  { bossName: 'The Knave', releaseOrder:10, matIds: ['113060', '113061', '113062'] },
  { bossName: 'Lord of Eroded Primal Fire', releaseOrder:11, matIds: ['113068', '113069', '113070'] },
  { bossName: 'The Game Before the Gate', releaseOrder:12, matIds: ['113073', '113074', '113075'] },
  { bossName: 'The Doctor', releaseOrder:13, matIds: ['113081', '113082', '113083'] },
  { bossName: 'Exalted Master of the Heretical Path', releaseOrder:14, artAliases:['Il Dottore'], matIds: ['113087', '113088', '113089'] },
];

const GI_WEEKLY_DROP_IDS = new Set(GI_WEEKLY_BOSS_SPECS.flatMap((boss) => boss.matIds));
// The Pyro Traveler's Cornerstone is a story reward, not a Trounce Domain drop.
const GI_NON_WEEKLY_113_IDS = new Set(['113063']);

function giWeeklyBossArt(spec) {
  const wanted = new Set([spec.bossName, ...(spec.artAliases || [])].map(normKey));
  const monsters = readJson('GameData/gi/live/monsters.json');
  const monster = monsters.find((row) => wanted.has(normKey(row?.name)) || wanted.has(normKey(row?.title)));
  const rel = monster?.assets?.icon;
  if (!rel || !exists(rel)) {
    throw new Error(`Missing local weekly boss art: ${spec.bossName} (aliases: ${(spec.artAliases || []).join(', ') || 'none'})`);
  }
  if (!/GameData\/gi\/assets\/monsters\//.test(rel)) {
    throw new Error(`Weekly boss art must be a local monster asset: ${spec.bossName} -> ${rel}`);
  }
  return dbAsset(rel);
}

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
  // After the scraper fix, each weapon stage is { cost:<number>, materials:[...] }
  // (normalized mats with itemId/quantity/rarity). Accept legacy field spellings
  // and the older mats.materials nesting as fallbacks so this is shape-tolerant.
  const rows = Object.values(weapon?.materials || {}).map((stage) => {
    const matsSrc = stage?.materials ?? stage?.mats?.materials ?? stage?.mats ?? [];
    const costSrc = stage?.cost?.materials ?? stage?.cost;
    const cost = Array.isArray(costSrc)
      ? costSrc.reduce((sum, c) => sum + Number(c?.count || c?.quantity || 0), 0)
      : Number(costSrc || 0);
    return {
      cost,
      mats: (Array.isArray(matsSrc) ? matsSrc : []).map((mat) => ({
        id: mat.itemId ?? mat.id,
        name: mat.name,
        count: mat.quantity ?? mat.count,
        rank: mat.rarity ?? mat.rank,
      })),
    };
  });
  return sumMaterials(rows, giItemLookup(), 'gi');
}

function buildGiWeaponRoster() {
  const rel = `GameData/gi/${nch()}/weapons.json`;
  if (!exists(rel)) return [];
  return readJson(rel)
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
      return icon ? dbAsset(`GameData/gi/assets/skills/${icon}.webp`) : null;
    })
    .filter(Boolean);
}

function giSkillIcon(skill) {
  const icon = giSkillIconName(skill);
  return icon ? dbAsset(`GameData/gi/assets/skills/${icon}.webp`) : null;
}

function buildGiKit(raw) {
  if (!raw) return null;
  const sections = [];
  const skills = (raw.skills || [])
    .map((skill) => kitEntry({
      name: skill?.name,
      type: 'Talent',
      desc: skill?.desc,
      icon: giSkillIcon(skill),
      scaling: [giPromoteScaling(skill)].filter(Boolean),
    }))
    .filter(Boolean);
  const skillSection = kitSection('Talents', skills);
  if (skillSection) sections.push(skillSection);
  const passives = (raw.passives || [])
    .map((skill) => kitEntry({
      name: skill?.name,
      type: 'Passive Talent',
      desc: skill?.desc,
      icon: skill?.icon ? dbAsset(`GameData/gi/assets/skills/${skill.icon}.webp`) : null,
    }))
    .filter(Boolean);
  const passiveSection = kitSection('Passive Talents', passives);
  if (passiveSection) sections.push(passiveSection);
  const constellations = (raw.constellations || [])
    .map((rank, index) => kitEntry({
      name: rank?.name,
      type: `Constellation ${index + 1}`,
      desc: rank?.desc,
      icon: rank?.icon ? dbAsset(`GameData/gi/assets/skills/${rank.icon}.webp`) : null,
    }))
    .filter(Boolean);
  const constellationSection = kitSection('Constellations', constellations);
  if (constellationSection) sections.push(constellationSection);
  return sections.length ? { ...kitSource('gi'), sections } : null;
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
  const fandom = fandomCharacterMetadata('gi');
  const chars = readJson(`GameData/gi/${nch()}/characters.json`)
    // Beta exports currently contain two internal tower-test avatars named
    // "TPS Traveler". They are not playable roster entries and have no real
    // weekly material, so keep them out of both the beta UI and its audits.
    .filter((ch) => ch.name && !/^TPS Traveler$/i.test(ch.name) && (ch.rarity === 4 || ch.rarity === 5))
    .map((ch) => {
      const rawRel = `GameData/gi/${nch()}/raw/characters/${ch.id}.json`;
      const raw = exists(rawRel) ? readJson(rawRel) : null;
      const book = giBookFamily(raw);
      const circleIcon = dbAsset(ch.assets?.circle);
      const fallbackIcon = dbAsset(ch.assets?.icon);
      const displayName = cleanText(resolvedCharacterName(ch), 120);
      const nameKey = normKey(displayName);
      const iconZoom = MANUAL_ICON_ZOOM.gi[nameKey] || (!circleIcon && !!fallbackIcon ? 1.18 : undefined);
      const birthdayArtPool = GENSHIN_BIRTHDAY_ART.get(nameKey) || [];
      const signature = signatures.get(nameKey);
      const skillIcons = giSkillIcons(raw);
      const meta = fandom.get(nameKey);
      const kit = buildGiKit(raw);
      const profileData = giProfileData(ch);
      return {
        id: 'gi-' + ch.id,
        n: displayName,
        localizedNames: localizedNamesFrom(raw || ch) || meta?.localizedNames,
        title: displayTitle('gi', ch),
        r: ch.rarity,
        el: ch.element || raw?.element || 'Unknown',
        w: weaponMap[ch.weapon] || ch.weapon || 'Unknown',
        tag: ch.profile?.region ? String(ch.profile.region).replace(/^ASSOC_TYPE_/, '').replace(/_/g, ' ') : undefined,
        release: parseRelease(ch.release) || meta?.release,
        releasePatch: meta?.releasePatch,
        voiceActors: mergeVoiceActors(voiceActorsFrom(ch.profile?.va), meta?.voiceActors),
        icon: circleIcon || fallbackIcon,
        iconZoom,
        art: dbAsset(ch.assets?.gacha || ch.assets?.card || ch.assets?.circle || ch.assets?.icon),
        birthdayArtPool: birthdayArtPool.length ? birthdayArtPool : undefined,
        namecard: GENSHIN_NAMECARD_ART.get(nameKey) || undefined,
        ...(skillIcons.length ? { skillIcons } : {}),
        ...(kit ? { kit } : {}),
        ...profileData,
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

function sumHsrMaterialList(materials, lookup = gamedataItemLookup('hsr')) {
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
  const lookup = gamedataItemLookup('hsr');
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
  if (!exists(`GameData/hsr/${nch()}/lightcones.json`)) return out;
  const lookup = gamedataItemLookup('hsr');
  for (const lc of readJson(`GameData/hsr/${nch()}/lightcones.json`)) {
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
  if (!exists(`GameData/hsr/${nch()}/lightcones.json`)) return [];
  const lookup = gamedataItemLookup('hsr');
  return readJson(`GameData/hsr/${nch()}/lightcones.json`)
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

function hsrSkillIconAsset(icon) {
  if (!icon) return null;
  return dbAsset(`GameData/hsr/assets/skills/${String(icon).replace(/\.(png|jpe?g)$/i, '.webp')}`);
}

function hsrSkillMaxParams(skill) {
  const levels = Object.values(skill?.level || {});
  const max = levels.sort((a, b) => Number(b?.level || 0) - Number(a?.level || 0))[0];
  return max?.param_list || skill?.param_list || [];
}

function hsrSkillTypeLabel(skill) {
  if (skill?.type === 'MazeNormal' || skill?.tag === 'MazeAttack') return 'Technique Attack';
  if (skill?.type === 'Assist') return 'Assist Skill';
  return skill?.type_name || skill?.tag;
}

function buildHsrKit(raw) {
  if (!raw) return null;
  const sections = [];
  const order = ['Normal', 'BPSkill', 'Ultra', 'Talent', 'Maze', 'MazeNormal'];
  const skills = Object.values(raw.skills || {})
    .sort((a, b) => {
      const ai = order.indexOf(a?.type);
      const bi = order.indexOf(b?.type);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || Number(a?.id || 0) - Number(b?.id || 0);
    })
    .map((skill) => {
      const icon = Object.values(raw.skill_trees || {})
        .flatMap((point) => Object.values(point || {}))
        .find((node) => (node?.level_up_skill_id || []).map(String).includes(String(skill.id)))?.icon;
      return kitEntry({
        name: skill?.name,
        type: hsrSkillTypeLabel(skill),
        desc: skill?.desc || skill?.simple_desc,
        params: hsrSkillMaxParams(skill),
        icon: hsrSkillIconAsset(icon),
        levels: hsrSkillLevels(skill, skill?.desc || skill?.simple_desc),
      });
    })
    .filter(Boolean);
  const skillSection = kitSection('Skills', skills);
  if (skillSection) sections.push(skillSection);

  const traces = Object.values(raw.skill_trees || {})
    .flatMap((point) => Object.values(point || {}))
    .filter((node) => Number(node?.point_type) === 3 && (node?.point_name || node?.point_desc))
    .sort((a, b) => Number(a?.point_id || 0) - Number(b?.point_id || 0))
    .map((node) => kitEntry({
      name: node?.point_name,
      type: 'Major Trace',
      desc: node?.point_desc,
      params: node?.param_list,
      icon: hsrSkillIconAsset(node?.icon),
    }))
    .filter(Boolean);
  const traceSection = kitSection('Major Traces', traces);
  if (traceSection) sections.push(traceSection);

  const eidolons = Object.entries(raw.ranks || {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([rank, row]) => kitEntry({
      name: row?.name,
      type: `Eidolon ${rank}`,
      desc: row?.desc,
      params: row?.param_list,
      icon: hsrSkillIconAsset(row?.icon),
    }))
    .filter(Boolean);
  const eidolonSection = kitSection('Eidolons', eidolons);
  if (eidolonSection) sections.push(eidolonSection);

  return sections.length ? { ...kitSource('hsr'), sections } : null;
}

function buildHsrKitMap() {
  const out = new Map();
  if (!exists(`GameData/hsr/${nch()}/characters.json`)) return out;
  for (const ch of readJson(`GameData/hsr/${nch()}/characters.json`)) {
    const rawRel = `GameData/hsr/${nch()}/raw/characters/${ch.id}.json`;
    if (!ch?.name || !exists(rawRel)) continue;
    const kit = buildHsrKit(readJson(rawRel));
    if (kit) setReqMapEntry(out, ch.name, kit, gamedataCharacterAliases('hsr', ch), { force: String(ch.id) === '1001' });
  }
  return out;
}

function buildHsrGameDataSignatureMap() {
  const out = new Map();
  if (!exists(`GameData/hsr/${nch()}/characters.json`)) return out;
  const lightCones = new Map(buildHsrLightConeRoster().map((lc) => [String(lc.id), lc]));
  for (const ch of readJson(`GameData/hsr/${nch()}/characters.json`)) {
    const rawRel = `GameData/hsr/${nch()}/raw/characters/${ch.id}.json`;
    if (!ch?.name || !exists(rawRel)) continue;
    const raw = readJson(rawRel);
    const first = (Array.isArray(raw?.lightcones) ? raw.lightcones : []).find(Boolean);
    const lightCone = first ? lightCones.get(String(first)) : null;
    if (!lightCone) continue;
    setReqMapEntry(out, ch.name, {
      ...lightCone,
      source: 'GameData recommended light cone',
      educated: false,
    }, gamedataCharacterAliases('hsr', ch), { force: String(ch.id) === '1001' });
  }
  return out;
}

// The 4 main traces map to skill_trees point01-04 (Basic ATK / Skill / Ultimate
// / Talent). Each level under a point carries the same skill `icon` (upstream
// names it .png; the scraped assets are .webp). Returns a 4-slot array aligned
// to CM_TALENT_CFG.hsr so the popout shows [skill icon][number] like Genshin.
function hsrSkillIcons(raw) {
  const POINTS = ['point01', 'point02', 'point03', 'point04'];
  const icons = POINTS.map((pk) => {
    const point = raw?.skill_trees?.[pk];
    if (!point) return null;
    const lv = point['1'] || Object.values(point)[0];
    const icon = lv?.icon;
    if (!icon) return null;
    return hsrSkillIconAsset(icon);
  });
  return icons.some(Boolean) ? icons : [];
}

function buildHsrSkillIconMap() {
  const out = new Map();
  if (!exists(`GameData/hsr/${nch()}/characters.json`)) return out;
  for (const ch of readJson(`GameData/hsr/${nch()}/characters.json`)) {
    const rawRel = `GameData/hsr/${nch()}/raw/characters/${ch.id}.json`;
    if (!ch?.name || !exists(rawRel)) continue;
    const icons = hsrSkillIcons(readJson(rawRel));
    if (!icons.length) continue;
    setNamedMapEntry(out, ch.name, icons, gamedataCharacterAliases('hsr', ch), { force: String(ch.id) === '1001' });
  }
  return out;
}

function buildHsrReqMap() {
  const out = new Map();
  if (!exists(`GameData/hsr/${nch()}/characters.json`)) return out;
  for (const ch of readJson(`GameData/hsr/${nch()}/characters.json`)) {
    const rawRel = `GameData/hsr/${nch()}/raw/characters/${ch.id}.json`;
    if (!ch?.name || !exists(rawRel)) continue;
    const req = hsrRequirements(readJson(rawRel));
    // Dual-key by lowercase + normKey so Prydwen "Himeko Nova" matches GameData "Himeko • Nova".
    setReqMapEntry(out, ch.name, req, gamedataCharacterAliases('hsr', ch), { force: String(ch.id) === '1001' });
  }
  return out;
}

function setReqMapEntry(map, name, req, aliases = [], options = {}) {
  setNamedMapEntry(map, name, req, aliases, options);
}

function sumZzzWEngineMaterials(engine) {
  const pairs = [];
  for (const group of engine?.materials || []) {
    for (const mat of group?.materials || []) pairs.push([mat.itemId, mat.quantity]);
  }
  return sumGameDataMaterialPairs('zzz', pairs, zzzMaterialKind, '10');
}

function zzzWEngineType(engine) {
  const type = firstValue(engine?.type || engine?.weapon_type) || 'Unknown';
  return String(type) === 'Defense' ? 'Defence' : String(type);
}

function buildZzzWEngineRoster() {
  if (!exists(`GameData/zzz/${nch()}/w-engines.json`)) return [];
  return readJson(`GameData/zzz/${nch()}/w-engines.json`)
    .filter((engine) => engine?.name && rarityNumber(engine.rarity, 0) >= 3)
    .map((engine) => {
      const summed = sumZzzWEngineMaterials(engine);
      const type = zzzWEngineType(engine);
      return {
        id: String(engine.id),
        name: cleanText(engine.name, 90),
        rarity: rarityNumber(engine.rarity, 0),
        weaponType: type,
        type,
        icon: dbAsset(engine.assets?.icon),
        art: dbAsset(engine.assets?.icon),
        items: summed.items.sort(materialIdSort).slice(0, 14),
        cost: summed.cost,
      };
    })
    .sort((a, b) => b.rarity - a.rarity || String(a.weaponType || '').localeCompare(String(b.weaponType || '')) || a.name.localeCompare(b.name));
}

function sumWuwaWeaponMaterials(weapon) {
  const pairs = [];
  for (const stage of Object.values(weapon?.ascensions || {})) {
    for (const mat of stage || []) pairs.push([mat.itemId, mat.quantity]);
  }
  return sumGameDataMaterialPairs('ww', pairs, wuwaMaterialKind, '2');
}

function buildWuwaWeaponRoster() {
  if (!exists(`GameData/ww/${nch()}/weapons.json`)) return [];
  return readJson(`GameData/ww/${nch()}/weapons.json`)
    .filter((weapon) => weapon?.name && rarityNumber(weapon.rarity, 0) >= 3)
    .map((weapon) => {
      const summed = sumWuwaWeaponMaterials(weapon);
      const type = wwWeaponMap[weapon.type] || weapon.type || 'Weapon';
      return {
        id: String(weapon.id),
        name: cleanText(weapon.name, 90),
        rarity: rarityNumber(weapon.rarity, 0),
        weaponType: type,
        type,
        icon: dbAsset(weapon.assets?.icon),
        art: dbAsset(weapon.assets?.icon),
        items: summed.items.sort(materialIdSort).slice(0, 14),
        cost: summed.cost,
      };
    })
    .sort((a, b) => b.rarity - a.rarity || String(a.weaponType || '').localeCompare(String(b.weaponType || '')) || a.name.localeCompare(b.name));
}

const weaponRosterCache = new Map();
function weaponRosterForGame(game) {
  const key = `${game}:${nch()}`;
  if (weaponRosterCache.has(key)) return weaponRosterCache.get(key);
  const roster = game === 'zzz'
    ? buildZzzWEngineRoster()
    : game === 'ww' || game === 'wuwa'
      ? buildWuwaWeaponRoster()
      : [];
  weaponRosterCache.set(key, roster);
  return roster;
}

function cleanRecommendedEquipmentLine(line) {
  return cleanText(line, 160)
    .replace(/^\d+(?:\.\d+)?%\s*/g, '')
    .replace(/^\d+[.)]\s*/g, '')
    .replace(/\((?:R|S|P)\s*\d+\s*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function recommendationSectionsForCharacter(ch, key) {
  if (!ch?.pageFile || !exists(ch.pageFile)) return [];
  const page = readJson(ch.pageFile);
  const sections = [...(page?.recommendations?.[key]?.sections || [])];
  const textBlock = prydwenRecommendationTextBlock(page, key);
  if (textBlock) sections.push({ heading: key, text: textBlock, assets: [] });
  return sections;
}

function prydwenRecommendationTextBlock(page, key) {
  const text = String(page?.text || '');
  const label = key === 'best-w-engines' ? 'Best W-Engines' : key === 'best-weapons' ? 'Best Weapons' : '';
  if (!label) return '';
  const start = text.search(new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
  if (start < 0) return '';
  const rest = text.slice(start);
  const afterLabel = rest.slice(label.length);
  const next = afterLabel.search(/\n\s*(?:Best (?!W-Engines\b|Weapons\b)[A-Z][^\n]{0,90}|Recommended endgame stats|Skills? priority|Traces priority|Synergy|Teams|Ratings)\s*\n/i);
  return next >= 0 ? rest.slice(0, label.length + next) : rest;
}

function findRecommendedEquipmentInText(text, weapons) {
  const byNorm = new Map(weapons.map((weapon) => [normKey(weapon.name), weapon]));
  for (const line of String(text || '').split(/\n+/)) {
    const clean = cleanRecommendedEquipmentLine(line);
    if (!clean) continue;
    const exact = byNorm.get(normKey(clean));
    if (exact) return exact;
    const leading = clean.match(/^(.+?)\s+(?:is|provides|offers|remains|works|comes)\b/i)?.[1];
    if (leading && byNorm.get(normKey(leading))) return byNorm.get(normKey(leading));
  }

  const fullText = ` ${cleanText(text, 5000)} `;
  return [...weapons]
    .map((weapon) => ({ weapon, index: fullText.toLowerCase().indexOf(` ${weapon.name.toLowerCase()} `) }))
    .filter((row) => row.index >= 0)
    .sort((a, b) => a.index - b.index || b.weapon.name.length - a.weapon.name.length)[0]?.weapon || null;
}

function prydwenRecommendedEquipment(game, ch) {
  const key = game === 'ww' ? 'best-weapons' : game === 'zzz' ? 'best-w-engines' : null;
  if (!key) return null;
  const weapons = weaponRosterForGame(game);
  if (!weapons.length) return null;
  const byNorm = new Map(weapons.map((weapon) => [normKey(weapon.name), weapon]));

  for (const section of recommendationSectionsForCharacter(ch, key)) {
    for (const asset of section.assets || []) {
      const hit = byNorm.get(normKey(asset.name));
      if (hit) return hit;
    }
    const textHit = findRecommendedEquipmentInText(section.text, weapons);
    if (textHit) return textHit;
  }

  return null;
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
    return icon || dbAsset(item?.assets?.icon || `GameData/zzz/assets/items/${asset}.webp`);
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

function sumGameDataMaterialPairs(game, pairs, kindForId, currencyId) {
  const lookup = gamedataItemLookup(game);
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
      rar: materialDisplayRarity(game, item?.rarity, 1),
      kind,
      icon,
      ...(sprite ? { sprite } : {}),
      ...materialSourceFields(game, item, id),
    };
    cur.qty += qty;
    cur.rar = Math.max(cur.rar, materialDisplayRarity(game, item?.rarity, 1));
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

// ZZZ agents have 6 upgradeable skills — 5 combat skills (Basic, Dodge, Assist,
// Special, Chain) that level 1-12, plus the Core skill (raw.passive) with 6
// upgrade tiers. This order matches ZZZ_SKILL_ICONS so the UI icons line up.
const ZZZ_SKILL_ORDER = ['basic', 'dodge', 'assist', 'special', 'chain'];

// Turn a { "<level>": {itemId: qty, ... } } map into Genshin-style incremental
// stages. Each populated level is the cost to advance one level, sorted low->high
// (the game's terminal max level carries no materials and is dropped by the
// empty-object filter), so summing the first N stages gives the cost through N.
function zzzStagesFromLevels(materialByLevel) {
  return Object.entries(materialByLevel || {})
    .filter(([, mats]) => mats && Object.keys(mats).length)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, mats]) => {
      const s = sumGameDataMaterialPairs('zzz', objectMaterialPairs(mats), zzzMaterialKind, '10');
      return { cost: s.cost, items: s.items };
    });
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

  const asc = sumGameDataMaterialPairs('zzz', ascPairs, zzzMaterialKind, '10');
  const talents = sumGameDataMaterialPairs('zzz', skillPairs, zzzMaterialKind, '10');
  const talentStages = [
    ...ZZZ_SKILL_ORDER.map((key) => zzzStagesFromLevels(raw.skill?.[key]?.material)),
    zzzStagesFromLevels(raw.passive?.materials),
  ];
  return {
    ascension: asc.items,
    talents: talents.items,
    talentStages,
    ascCost: asc.cost,
    talentCost: talents.cost,
    currency: asc.cost + talents.cost,
  };
}

function buildZzzKit(raw) {
  if (!raw) return null;
  const sections = [];
  const skillEntries = [];
  for (const key of ZZZ_SKILL_ORDER) {
    const group = raw.skill?.[key];
    const descriptions = Array.isArray(group?.description) ? group.description : [];
    for (const row of descriptions) {
      const scaling = zzzParamScaling(row?.param);
      if (!row?.desc && !scaling) continue;
      const entry = kitEntry({
        name: row.name,
        type: key.charAt(0).toUpperCase() + key.slice(1),
        desc: row.desc,
        scaling: [scaling].filter(Boolean),
      });
      if (entry) skillEntries.push(entry);
    }
  }
  const skillSection = kitSection('Skills', skillEntries);
  if (skillSection) sections.push(skillSection);

  const passiveRows = Object.values(raw.passive?.level || {});
  const passive = passiveRows.sort((a, b) => Number(b?.level || 0) - Number(a?.level || 0))[0];
  const passiveEntries = [];
  if (passive) {
    const names = Array.isArray(passive.name) ? passive.name : [passive.name];
    const descs = Array.isArray(passive.desc) ? passive.desc : [passive.desc];
    names.forEach((name, i) => {
      const entry = kitEntry({ name, type: i === 0 ? 'Core Passive' : 'Additional Ability', desc: descs[i] });
      if (entry) entry.levels = cleanKitLevels(zzzPassiveLevels(passiveRows, i));
      if (entry) passiveEntries.push(entry);
    });
  }
  const passiveSection = kitSection('Core Skill', passiveEntries);
  if (passiveSection) sections.push(passiveSection);

  const mindscapes = Object.entries(raw.talent || {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([rank, row]) => kitEntry({
      name: row?.name,
      type: `Mindscape ${rank}`,
      desc: row?.desc,
    }))
    .filter(Boolean);
  const mindscapeSection = kitSection('Mindscape Cinema', mindscapes);
  if (mindscapeSection) sections.push(mindscapeSection);
  return sections.length ? { ...kitSource('zzz'), sections } : null;
}

function buildZzzKitMap() {
  const out = new Map();
  if (!exists(`GameData/zzz/${nch()}/agents.json`)) return out;
  for (const ch of readJson(`GameData/zzz/${nch()}/agents.json`)) {
    const rawRel = `GameData/zzz/${nch()}/raw/agents/${ch.id}.json`;
    if (!ch?.name || !exists(rawRel)) continue;
    const kit = buildZzzKit(readJson(rawRel));
    if (kit) setReqMapEntry(out, ch.name, kit, gamedataCharacterAliases('zzz', ch));
  }
  return out;
}

function buildZzzReqMap() {
  const out = new Map();
  if (!exists(`GameData/zzz/${nch()}/agents.json`)) return out;
  for (const ch of readJson(`GameData/zzz/${nch()}/agents.json`)) {
    const rawRel = `GameData/zzz/${nch()}/raw/agents/${ch.id}.json`;
    if (!ch?.name || !exists(rawRel)) continue;
    setReqMapEntry(out, ch.name, zzzRequirements(readJson(rawRel)), gamedataCharacterAliases('zzz', ch));
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

  const asc = sumGameDataMaterialPairs('ww', ascPairs, wuwaMaterialKind, '2');
  const talents = sumGameDataMaterialPairs('ww', skillPairs, wuwaMaterialKind, '2');
  const chosenWeekly = weekly && talents.items.find((item) => String(item.id) === String(weekly));
  if (chosenWeekly) chosenWeekly.kind = 'weekly';
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
  if (!exists(`GameData/ww/${nch()}/characters.json`)) return out;
  for (const ch of readJson(`GameData/ww/${nch()}/characters.json`)) {
    const rawRel = `GameData/ww/${nch()}/raw/characters/${ch.id}.json`;
    if (!ch?.name || !exists(rawRel)) continue;
    setReqMapEntry(out, ch.name, wuwaRequirements(readJson(rawRel)), gamedataCharacterAliases('ww', ch));
  }
  return out;
}

// G37/WuWa: the 5 core skills carry an Unreal icon path in raw.skill_trees;
// map it to the locally-scraped webp under GameData/ww/assets/skills.
function wuwaSkillIconAsset(icon) {
  if (!icon) return null;
  const p = String(icon).replace(/^\/Game\/Aki\/UI\//, '').split('.')[0];
  const rel = `GameData/ww/assets/skills/${p}.webp`;
  return exists(rel) ? dbAsset(rel) : null;
}

function wuwaSkillIcons(raw) {
  const ORDER = ['Normal Attack', 'Resonance Skill', 'Resonance Liberation', 'Forte Circuit', 'Intro Skill'];
  const byType = {};
  for (const node of Object.values(raw?.skill_trees || {})) {
    const t = node?.skill?.type, ic = node?.skill?.icon;
    if (t && ic && !byType[t]) byType[t] = ic;
  }
  const icons = ORDER.map((t) => {
    const ic = byType[t];
    return wuwaSkillIconAsset(ic);
  });
  return icons.some(Boolean) ? icons : [];
}

function buildWuwaKit(raw) {
  if (!raw) return null;
  const sections = [];
  const order = ['Normal Attack', 'Resonance Skill', 'Resonance Liberation', 'Forte Circuit', 'Intro Skill', 'Outro Skill'];
  const seen = new Set();
  const skills = Object.values(raw.skill_trees || {})
    .filter((node) => node?.skill?.name || node?.skill?.desc)
    .filter((node) => {
      const key = normKey(node.skill?.type || node.skill?.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const ai = order.indexOf(a.skill?.type);
      const bi = order.indexOf(b.skill?.type);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || String(a.skill?.name || '').localeCompare(String(b.skill?.name || ''));
    })
    .map((node) => kitEntry({
      name: node.skill?.name,
      type: node.skill?.type,
      desc: node.skill?.desc || node.skill?.simple_desc,
      icon: wuwaSkillIconAsset(node.skill?.icon),
      scaling: [wuwaSkillScaling(node.skill)].filter(Boolean),
    }))
    .filter(Boolean);
  const skillSection = kitSection('Skills', skills);
  if (skillSection) sections.push(skillSection);

  const chains = Object.entries(raw.chains || {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([rank, row]) => kitEntry({
      name: row?.name,
      type: `Sequence ${rank}`,
      desc: row?.desc,
      icon: wuwaSkillIconAsset(row?.icon),
    }))
    .filter(Boolean);
  const chainSection = kitSection('Resonance Chain', chains);
  if (chainSection) sections.push(chainSection);
  return sections.length ? { ...kitSource('wuwa'), sections } : null;
}

function buildWuwaKitMap() {
  const out = new Map();
  if (!exists(`GameData/ww/${nch()}/characters.json`)) return out;
  for (const ch of readJson(`GameData/ww/${nch()}/characters.json`)) {
    const rawRel = `GameData/ww/${nch()}/raw/characters/${ch.id}.json`;
    if (!ch?.name || !exists(rawRel)) continue;
    const kit = buildWuwaKit(readJson(rawRel));
    if (kit) setReqMapEntry(out, ch.name, kit, gamedataCharacterAliases('ww', ch));
  }
  return out;
}

function buildWuwaSkillIconMap() {
  const out = new Map();
  if (!exists(`GameData/ww/${nch()}/characters.json`)) return out;
  for (const ch of readJson(`GameData/ww/${nch()}/characters.json`)) {
    const rawRel = `GameData/ww/${nch()}/raw/characters/${ch.id}.json`;
    if (!ch?.name || !exists(rawRel)) continue;
    const icons = wuwaSkillIcons(readJson(rawRel));
    if (!icons.length) continue;
    setNamedMapEntry(out, ch.name, icons, gamedataCharacterAliases('ww', ch));
  }
  return out;
}

function buildPrydwenRoster(game, mapFacts, reqByName = null, skillIconsByName = null, signatureByName = null, kitByName = null) {
  const overlayGame = game === 'ww' ? 'wuwa' : game;
  const overlay = localAvatarOverlay(game);
  const betaOverlay = GAMEDATA_CHANNEL === 'live' && betaChannelAvailable(game)
    ? localAvatarOverlay(game, 'beta')
    : null;
  // Beta-status ZZZ agents can exist in the live GameData channel only as placeholder
  // stubs (default spec/element → wrong cert-seal materials), so source their req/kit
  // from the beta channel instead when building the live roster.
  let betaReqByName = null;
  let betaKitByName = null;
  if (game === 'zzz' && GAMEDATA_CHANNEL === 'live' && betaChannelAvailable('zzz')) {
    const prevChannel = GAMEDATA_CHANNEL;
    GAMEDATA_CHANNEL = 'beta';
    try {
      betaReqByName = buildZzzReqMap();
      betaKitByName = buildZzzKitMap();
    } finally {
      GAMEDATA_CHANNEL = prevChannel;
    }
  }
  const fandom = fandomCharacterMetadata(overlayGame);
  const rawChars = readJson(`Prydwen/${game}/characters.json`);
  const hsrLightConeReqMap = game === 'hsr' ? buildHsrLightConeReqMap() : null;
  // ZZZ: only surface agents GameData actually has — drop Prydwen-only placeholders
  // (which arrive without icons/data). Other games keep the full Prydwen roster.
  const chars = (game === 'zzz' ? rawChars.filter((ch) => {
    const official = ZZZ_OFFICIAL_CHARACTER_PORTRAITS.get(normKey(ch.name));
    return overlay.has(normKey(ch.name)) || official?.status === 'released' || (GAMEDATA_CHANNEL === 'beta' && official?.status === 'announced');
  }) : rawChars).map((ch) => {
    const mapped = mapFacts(ch.facts || {});
    const primaryLocal = overlay.get(normKey(ch.name));
    const betaLocal = betaOverlay?.get(normKey(ch.name)) || null;
    // ZZZ beta-status agents can have a live placeholder stub while beta has the
    // real kit. Other games let Nanoka's live row win as soon as it appears.
    const selectedOverlay = chooseCharacterOverlay({
      game,
      primary: primaryLocal,
      beta: betaLocal,
      sourceStatus: ch.contentStatus,
    });
    const local = selectedOverlay.local;
    const effectiveStatus = selectedOverlay.status;
    // Unreleased ZZZ agents: Prydwen stubs facts as "Unknown" — backfill from GameData
    if (game === 'zzz' && local) {
      if (local.el && (!mapped.el || mapped.el === 'Unknown')) mapped.el = local.el;
      if (local.spec && (!mapped.spec || mapped.spec === 'Unknown')) mapped.spec = local.spec;
      // ZZZ's rarity enum is 4 = S-rank, 3 = A-rank (not the 5/4-star scale).
      if (local.rarity && (!mapped.r || mapped.r === 'Unknown')) mapped.r = Number(local.rarity) >= 4 ? 'S' : 'A';
    }
    const meta = fandom.get(normKey(ch.name));
    const officialPortrait = game === 'zzz' ? ZZZ_OFFICIAL_CHARACTER_PORTRAITS.get(normKey(ch.name)) : null;
    const isBetaChar = Boolean(effectiveStatus && effectiveStatus !== 'live' && officialPortrait?.status !== 'released');
    const lookupByName = (map) => map?.get(String(ch.name || '').toLowerCase()) || map?.get(normKey(ch.name)) || null;
    const req = (isBetaChar && lookupByName(betaReqByName)) || lookupByName(reqByName);
    const skillIcons = lookupByName(skillIconsByName) || (game === 'zzz' ? ZZZ_SKILL_ICONS : null);
    const kit = (isBetaChar && lookupByName(betaKitByName)) || lookupByName(kitByName);
    const gamedataSignature = signatureByName?.get(String(ch.name || '').toLowerCase()) || signatureByName?.get(normKey(ch.name)) || null;
    const signatureLightCone = game === 'hsr' ? (hsrSignatureForCharacter(ch.name, mapped.path) || gamedataSignature) : null;
    const signatureEquipment = signatureLightCone ? null : prydwenRecommendedEquipment(game, ch);
    const signatureDisplay = signatureLightCone || signatureEquipment;
    const signatureReq = signatureLightCone ? (signatureLightCone.items ? signatureLightCone : hsrLightConeReqMap?.get(normKey(signatureLightCone.name))) : signatureEquipment;
    const holidayArtPool = game === 'hsr' ? (HSR_HOLIDAY_ART.get(normKey(ch.name)) || []) : [];
    const icon = officialPortrait?.icon || local?.icon || trustedPrydwenIcon(game, ch);
    const iconZoom = MANUAL_ICON_ZOOM[overlayGame]?.[normKey(ch.name)] || (!local?.icon && icon ? 1.18 : undefined);
    // D1: the game's own splash art wins; scraped overlay art is the fallback
    const art = local?.splash || dbAsset(ch.art?.full || ch.art?.card || (!local?.fallbackArt ? ch.art?.icon : null)) || local?.fallbackArt;
    const card = dbAsset(ch.art?.card || ch.art?.full || (!local?.fallbackArt ? ch.art?.icon : null)) || local?.fallbackArt;
    const hasReliableData = !!(primaryLocal || req || kit);
    const upcomingOnly = effectiveStatus && effectiveStatus !== 'live' && !hasReliableData;
    const title = local?.title || displayTitle(overlayGame, ch, ch.facts || {});
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
      localizedNames: local?.localizedNames || meta?.localizedNames,
      title,
      slug: ch.slug,
      release: local?.release || meta?.release || undefined,
      releasePatch: local?.releasePatch || meta?.releasePatch || undefined,
      updated: parsePrydwenDate(ch.updatedText),
      sourceOrder: local?.releaseOrder || 0,
      voiceActors: mergeVoiceActors(local?.voiceActors || prydwenVoiceActors(game, ch.slug), meta?.voiceActors),
      icon,
      portraitProvenance: officialPortrait ? { status:officialPortrait.status, sourceUrl:officialPortrait.sourceUrl } : undefined,
      iconZoom,
      art,
      card,
      holidayArtPool: holidayArtPool.length ? holidayArtPool : undefined,
      ...(signatureDisplay ? {
        ...(signatureLightCone ? { signatureLightCone: {
          id: signatureDisplay.id,
          name: signatureDisplay.name,
          icon: signatureDisplay.icon,
          art: signatureDisplay.art,
          path: signatureDisplay.path,
        } } : {}),
        signatureWeapon: {
          id: signatureDisplay.id,
          name: signatureDisplay.name,
          path: signatureDisplay.path,
          type: signatureDisplay.weaponType || signatureDisplay.type,
          educated: false,
        },
        signatureWeaponId: signatureDisplay.id,
        signatureWeaponName: signatureDisplay.name,
        ...(signatureLightCone ? {
          overviewArt: signatureDisplay.art,
          overviewArtPool: [signatureDisplay.art],
        } : {}),
      } : {}),
      status: effectiveStatus,
      labels: ch.statusLabels || [],
      ...mapped,
      baseStats: local?.baseStats || {},
      facts: { ...(local?.facts || {}), ...(title ? { title } : {}) },
      ...(skillIcons ? { skillIcons } : {}),
      ...(kit ? { kit } : {}),
      ...(upcomingOnly ? {
        upcoming: true,
        reliableData: false,
        noReliableInfo: true,
      } : {}),
      ...(mergedReq ? { req: mergedReq } : {}),
    };
  });
  // Do not make a fresh Nanoka HSR character wait for Prydwen's roster. GameData
  // already carries the identity, kit, materials, stats, and local portraits we
  // need for a useful character card. Prydwen remains the richer primary row
  // whenever it has the character; this only fills names that are absent there.
  if (game === 'hsr' && exists(`GameData/hsr/${nch()}/characters.json`)) {
    const have = new Set(chars.map((character) => normKey(character.n)));
    const lookupByName = (map, name) => map?.get(String(name || '').toLowerCase()) || map?.get(normKey(name)) || null;
    for (const character of readJson(`GameData/hsr/${nch()}/characters.json`)) {
      const display = cleanText(resolvedCharacterName(character), 120);
      if (!display || /\{NICKNAME\}/i.test(display) || have.has(normKey(display))) continue;
      have.add(normKey(display));

      const local = overlay.get(normKey(display)) || {};
      const req = lookupByName(reqByName, display) || lookupByName(reqByName, character.name);
      const skillIcons = lookupByName(skillIconsByName, display) || lookupByName(skillIconsByName, character.name);
      const kit = lookupByName(kitByName, display) || lookupByName(kitByName, character.name);
      const characterPath = profileText(profileFirst(character.path));
      const gamedataSignature = lookupByName(signatureByName, display) || lookupByName(signatureByName, character.name);
      const signatureLightCone = hsrSignatureForCharacter(display, characterPath) || gamedataSignature;
      const signatureReq = signatureLightCone
        ? (signatureLightCone.items ? signatureLightCone : hsrLightConeReqMap?.get(normKey(signatureLightCone.name)))
        : null;
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
      const icon = local.icon || dbAsset(character.assets?.roundIcon || character.assets?.avatar);
      const art = local.splash || dbAsset(character.assets?.drawCard || character.assets?.avatar) || icon;
      const profile = hsrProfileData(character);
      chars.push({
        id: `hsr-${character.id}`,
        n: display,
        localizedNames: local.localizedNames,
        title: local.title,
        release: local.release || parseRelease(character.release),
        releasePatch: local.releasePatch,
        updated: Number(character.release || 0) * 1000,
        sourceOrder: Number(character.id) || 0,
        voiceActors: local.voiceActors,
        icon,
        art,
        card: icon || art,
        status: character.contentStatus || (GAMEDATA_CHANNEL === 'beta' ? 'beta' : 'live'),
        labels: [],
        r: Number(character.rarity) || character.rarity,
        el: profileText(profileFirst(character.element)),
        path: characterPath,
        baseStats: local.baseStats || profile.baseStats || {},
        facts: local.facts || profile.facts || {},
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
            type: signatureLightCone.weaponType || signatureLightCone.type,
            educated: false,
          },
          signatureWeaponId: signatureLightCone.id,
          signatureWeaponName: signatureLightCone.name,
          overviewArt: signatureLightCone.art,
          overviewArtPool: [signatureLightCone.art],
        } : {}),
        ...(skillIcons ? { skillIcons } : {}),
        ...(kit ? { kit } : {}),
        ...(mergedReq ? { req: mergedReq } : {}),
      });
    }
  }
  // G38: in the BETA channel, surface GameData beta-only ZZZ agents (e.g. Sigrid) that
  // Prydwen doesn't carry yet, so a zzz beta delta is produced and the Live/Beta toggle
  // appears. Live channel stays filtered to Prydwen∩GameData (no unreleased placeholders).
  if (game === 'zzz' && GAMEDATA_CHANNEL === 'beta' && exists(`GameData/zzz/${nch()}/agents.json`)) {
    const have = new Set(chars.map((c) => normKey(c.n)));
    const firstVal = (v) => (v && typeof v === 'object' ? Object.values(v)[0] : v);
    for (const ag of readJson(`GameData/zzz/${nch()}/agents.json`)) {
      if (!/^beta/.test(String(ag.contentStatus || '').toLowerCase())) continue;
      const display = cleanText(resolvedCharacterName(ag), 120);
      // Match against every known alias, not just the display name — GameData's
      // "Jane" is Prydwen's "Jane Doe", and a display-only check would resurface
      // a released agent here as a duplicate "new beta" entry.
      const aliasKeys = gamedataCharacterAliases('zzz', ag).map(normKey);
      if (!display || have.has(normKey(display)) || aliasKeys.some((alias) => have.has(alias))) continue;
      have.add(normKey(display));
      const req = reqByName?.get(String(ag.name || '').toLowerCase()) || reqByName?.get(normKey(ag.name)) || null;
      const kit = kitByName?.get(String(ag.name || '').toLowerCase()) || kitByName?.get(normKey(ag.name)) || null;
      const icon = dbAsset(ag.assets?.partnerIcon || ag.assets?.icon) || zzzAgentAvatarIcon(ag);
      const art = dbAsset(ag.assets?.roleIcon || ag.assets?.icon) || icon;
      const profileData = zzzProfileData(ag);
      chars.push({
        id: `zzz-${ag.id}`,
        n: display,
        updated: Number.MAX_SAFE_INTEGER, // newest → leads the recent strip
        sourceOrder: 0,
        icon,
        art,
        card: icon || art,
        r: Number(ag.rarity) >= 4 ? 'S' : 'A', // ZZZ rarity enum: 4 = S, 3 = A
        el: firstVal(ag.element) || 'Unknown',
        spec: firstVal(ag.specialty) || undefined,
        status: 'beta',
        ...profileData,
        ...(kit ? { kit } : {}),
        ...(req ? { req } : {}),
      });
    }
  }
  if (game === 'ww') {
    chars.sort((a, b) => (b.sourceOrder || 0) - (a.sourceOrder || 0) || rarityScore(b.r) - rarityScore(a.r) || a.n.localeCompare(b.n));
  } else {
    chars.sort((a, b) => (b.updated || 0) - (a.updated || 0) || rarityScore(b.r) - rarityScore(a.r) || a.n.localeCompare(b.n));
  }
  markRecentBuckets(chars, (ch) => ch.updated, game === 'ww' ? 9 : 9, (ch) => !ch.upcoming && ch.reliableData !== false);
  chars.forEach((ch) => { if (ch.upcoming) ch.recent = false; });
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

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function endfieldRecommendationSection(ch, recKey) {
  const page = endfieldPageForCharacter(ch);
  return page?.recommendations?.[recKey]?.sections?.find((row) => row?.text) || null;
}

function endfieldSignatureWeapon(ch, recommendedWeapons, wikiWeaponsByName) {
  const first = recommendedWeapons?.[0];
  if (!first?.name) return null;
  const wiki = wikiWeaponsByName.get(normKey(first.name));
  const section = endfieldRecommendationSection(ch, 'best-weapons');
  const text = cleanKitText(section?.text || '', 5000);
  const nameRx = escapeRegExp(first.name).replace(/\s+/g, '\\s+');
  const explicitSignature = new RegExp(`signature[\\s\\S]{0,450}${nameRx}|${nameRx}[\\s\\S]{0,450}signature`, 'i').test(text);
  return {
    ...(wiki || {}),
    id: wiki?.id || first.id || `weapon:${normKey(first.name)}`,
    name: wiki?.name || first.name,
    icon: wiki?.icon || first.icon,
    art: wiki?.art || first.art || first.icon,
    weaponType: wiki?.weaponType || wiki?.type || first.type,
    type: wiki?.type || wiki?.weaponType || first.type,
    items: wiki?.items || [],
    cost: Number(wiki?.cost || 0),
    educated: !explicitSignature,
    source: explicitSignature ? 'Prydwen signature wording' : 'Prydwen best weapon',
  };
}

function parseEndfieldTemplateFields(body) {
  const fields = {};
  const text = '\n' + String(body || '').trim();
  const re = /\n\|([^=\n]+)=([\s\S]*?)(?=\n\|[^=\n]+=|$)/g;
  let match;
  while ((match = re.exec(text))) {
    fields[String(match[1] || '').trim()] = String(match[2] || '').trim();
  }
  return fields;
}

function endfieldCombatSkillStats(fields) {
  return Object.entries(fields)
    .filter(([key]) => /^stat\d+$/i.test(key))
    .map(([, value]) => {
      const parts = String(value || '').split(/\s*,\s*/).filter(Boolean);
      if (parts.length < 2) return null;
      return {
        label: cleanKitName(parts[0], 90),
        value: cleanKitName(parts[parts.length - 1], 80),
      };
    })
    .filter(Boolean);
}

function buildEndfieldKit(ch) {
  const sections = [];
  const combatText = (ch.sections || []).find((row) => /combat skills/i.test(row?.heading || ''))?.text || '';
  const entries = [...String(combatText).matchAll(/\{\{Combat skill([\s\S]*?)\}\}/g)]
    .map((match) => {
      const fields = parseEndfieldTemplateFields(match[1]);
      return kitEntry({
        name: fields.name,
        type: fields.type || fields.info || 'Combat Skill',
        desc: fields.desc,
        stats: endfieldCombatSkillStats(fields),
      });
    })
    .filter(Boolean);
  if (entries.length) sections.push({ title: 'Combat Skills', entries });

  const baseText = (ch.sections || []).find((row) => /base skills/i.test(row?.heading || ''))?.text;
  if (baseText) {
    const entry = kitEntry({ name: 'Base Skills', type: 'Base', desc: baseText });
    if (entry) sections.push({ title: 'Base Skills', entries: [entry] });
  }
  return sections.length ? {
    source: 'EndfieldWiki',
    channel: ch.contentStatus || 'live',
    version: ch.contentStatus || null,
    sections,
  } : null;
}

const ENDFIELD_MATERIAL_CLASSIFICATION = Object.freeze({
  sourceCheckedAt:'2026-07-14',
  sources:{
    growth:{
      url:'https://endfield.wiki.gg/wiki/Item/Rare_Materials',
      revisionId:50579,
      lastEditedAt:'2026-05-31T06:44:00Z',
    },
    progression:{
      url:'https://endfield.wiki.gg/wiki/Item/Progression_Materials',
      revisionId:38938,
      lastEditedAt:'2026-03-05T17:09:57Z',
    },
  },
  growthNames:['Kalkodendra', 'Chrysodendra', 'Vitrodendra', 'Blighted Jadeleaf', 'False Aggela'],
  progressionNames:['D96 Steel Sample 4', 'Metadiastima Photoemission Tube', 'Quadrant Fitting Fluid', 'Tachyon Screening Lattice', 'Triphasic Nanoflake'],
});

function endfieldExplicitMaterialView(roster, { label, names, reqFields, source }) {
  const wanted = new Map(names.map((name, index) => [normKey(name), { name, index }]));
  const groups = names.map((name) => {
    const item = lookupEndfieldItem(name);
    const local = String(item?.icon || '');
    const rel = local.startsWith('../../Database/') ? local.slice('../../Database/'.length) : '';
    if (!item || !rel || !exists(rel)) throw new Error(`${label} source item is missing its local icon: ${name}`);
    if (![4, 5].includes(Number(item.rar))) throw new Error(`${label} source item has unsupported rarity: ${name} -> ${item.rar}`);
    return {
      region:label,
      title:name,
      mats:[{ ...item, n:item.name }],
      chars:[],
      classificationSource:{ ...source },
    };
  });
  const sourceCharacters = new Set();
  for (const ch of cmRosterSource(roster)) {
    for (const reqField of reqFields) {
      for (const mat of ch.req?.[reqField] || []) {
        const spec = wanted.get(normKey(mat?.name || mat?.n));
        if (!spec) continue;
        pushUnique(groups[spec.index].chars, ch.n);
        sourceCharacters.add(ch.n);
      }
    }
  }
  groups.forEach((group) => group.chars.sort((a, b) => a.localeCompare(b)));

  const generatedCharacters = new Set(groups.flatMap((group) => group.chars));
  // A freshly released operator whose wiki page has no materials yet (e.g. Liino,
  // 2026-07) ships with an empty req — exempt it from the sourced-requirement
  // check instead of failing the whole generation and keeping every complete
  // operator off the site. Operators that DO carry requirements in these fields
  // must still classify into a group.
  const unfilled = (roster || []).filter((ch) => !reqFields.some((field) => (ch.req?.[field] || []).length)).map((ch) => ch.n);
  if (unfilled.length) console.warn(`[endfield] ${label}: operator(s) without any sourced requirements (unfilled wiki page): ${unfilled.join(', ')}`);
  const rosterCharacters = new Set((roster || []).filter((ch) => !unfilled.includes(ch.n)).map((ch) => ch.n));
  const missing = [...sourceCharacters].filter((name) => !generatedCharacters.has(name)).sort();
  const extra = [...generatedCharacters].filter((name) => !sourceCharacters.has(name)).sort();
  const withoutSourceRequirement = [...rosterCharacters].filter((name) => !sourceCharacters.has(name)).sort();
  if (missing.length || extra.length || withoutSourceRequirement.length) {
    throw new Error(
      `${label} character-set mismatch: missing=[${missing.join(', ')}]; extra=[${extra.join(', ')}]; `
      + `no sourced requirement=[${withoutSourceRequirement.join(', ')}]`,
    );
  }
  return {
    groups,
    audit:{
      label,
      materialNames:names.slice(),
      requirementFields:reqFields.slice(),
      sourceCharacters:[...sourceCharacters].sort(),
      generatedCharacters:[...generatedCharacters].sort(),
      missing,
      extra,
      source:{ ...source },
    },
  };
}

function buildEndfieldMaterialViews(roster) {
  const growth = endfieldExplicitMaterialView(roster, {
    label:'Growth Materials',
    names:ENDFIELD_MATERIAL_CLASSIFICATION.growthNames,
    reqFields:['talents'],
    source:ENDFIELD_MATERIAL_CLASSIFICATION.sources.growth,
  });
  const progression = endfieldExplicitMaterialView(roster, {
    label:'Progression Materials',
    names:ENDFIELD_MATERIAL_CLASSIFICATION.progressionNames,
    reqFields:['ascension', 'talents'],
    source:ENDFIELD_MATERIAL_CLASSIFICATION.sources.progression,
  });
  const classified = new Set([
    ...ENDFIELD_MATERIAL_CLASSIFICATION.growthNames,
    ...ENDFIELD_MATERIAL_CLASSIFICATION.progressionNames,
  ].map(normKey));
  const unclassified = new Map();
  for (const ch of cmRosterSource(roster)) {
    for (const reqField of ['ascension', 'talents']) {
      for (const mat of ch.req?.[reqField] || []) {
        const name = cleanText(mat?.name || mat?.n, 90);
        if (!name || mat?.kind === 'currency' || classified.has(normKey(name))) continue;
        if (!unclassified.has(name)) unclassified.set(name, { name, requirementFields:new Set(), characters:new Set() });
        unclassified.get(name).requirementFields.add(reqField);
        unclassified.get(name).characters.add(ch.n);
      }
    }
  }
  return {
    growthGroups:growth.groups,
    progressionGroups:progression.groups,
    audit:{
      classification:'explicit-source-name-lists',
      sourceCheckedAt:ENDFIELD_MATERIAL_CLASSIFICATION.sourceCheckedAt,
      rosterCount:(roster || []).length,
      growth:growth.audit,
      progression:progression.audit,
      unclassifiedRequirements:[...unclassified.values()]
        .map((row) => ({
          name:row.name,
          requirementFields:[...row.requirementFields].sort(),
          characters:[...row.characters].sort(),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

function buildEndfieldWeaponRoster() {
  if (!exists('EndfieldWiki/endfield/weapons.json')) return [];
  const raw = readJson('EndfieldWiki/endfield/weapons.json');
  return (raw.weapons || [])
    .map((weapon) => ({
      id: weapon.id || normKey(weapon.name),
      name: cleanText(weapon.name || weapon.id || '', 90),
      rarity: Number(weapon.rarity || 0) || 4,
      weaponType: cleanText(weapon.weaponType || '', 40) || undefined,
      type: cleanText(weapon.weaponType || '', 40) || undefined,
      source: cleanText(weapon.source || '', 120) || undefined,
      icon: dbAsset(weapon.icon?.path || weapon.icon),
      art: dbAsset(weapon.icon?.path || weapon.icon),
      items: endfieldRequirementList(weapon.materials || [], 'weapon'),
      tuningStages: (weapon.tuningStages || []).map((stage) => ({
        items: endfieldRequirementList(stage, 'weapon'),
        cost: 0,
      })),
      cost: 0,
    }))
    .filter((weapon) => weapon.name && weapon.items.length)
    .sort((a, b) => b.rarity - a.rarity || String(a.weaponType || '').localeCompare(String(b.weaponType || '')) || a.name.localeCompare(b.name));
}

function buildEndfieldRoster() {
  const usingWiki = exists('EndfieldWiki/endfield/characters.json');
  const src = usingWiki
    ? readJson('EndfieldWiki/endfield/characters.json')
    : readJson('Prydwen/endfield/characters.json');
  const wikiWeaponsByName = new Map(buildEndfieldWeaponRoster().map((weapon) => [normKey(weapon.name), weapon]));
  const chars = src.map((ch) => {
    const recommendedWeapons = endfieldRecommendationItems(ch, 'best-weapons', 'weapon');
    const recommendedGear = endfieldRecommendationItems(ch, 'best-gear', 'gear');
    const preferredWeapons = recommendedWeapons.length ? recommendedWeapons : endfieldItemsFromCharacter(ch, 'preferredWeapons', 'weapon');
    const skillItems = recommendedGear.length ? recommendedGear : endfieldItemsFromCharacter(ch, 'matskill', 'gear');
    const statItems = endfieldItemsFromCharacter(ch, 'matstats', 'gear');
    const signatureWeapon = endfieldSignatureWeapon(ch, recommendedWeapons, wikiWeaponsByName);
    // With the wiki source, an operator without scraped materials is a freshly
    // released unit whose wiki page hasn't been filled in yet (e.g. Liino,
    // 2026-07). Ship it with NO requirement — the estimated shared fallback
    // would show invented numbers and fail the growth/progression material-view
    // classification. The Prydwen fallback source has no materials at all, so it
    // keeps the shared estimate.
    const reqBase = endfieldReqFromMaterials(ch.materials) || (usingWiki ? null : endfieldSharedReq());
    const req = signatureWeapon ? {
      ...(reqBase || {}),
      weapon: {
        id: signatureWeapon.id,
        name: signatureWeapon.name,
        icon: signatureWeapon.icon,
        art: signatureWeapon.art,
        path: signatureWeapon.weaponType,
        weaponType: signatureWeapon.weaponType,
        type: signatureWeapon.type,
        items: signatureWeapon.items || [],
        cost: Number(signatureWeapon.cost || 0),
        educated: !!signatureWeapon.educated,
      },
      currency: Number(reqBase?.currency || 0) + Number(signatureWeapon.cost || 0),
    } : reqBase;
    const kit = buildEndfieldKit(ch);
    const profileData = endfieldProfileData(ch);
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
      skillIcons: ENDFIELD_SKILL_ICONS.get(normKey(ch.name)) || undefined,
      ...profileData,
      ...(kit ? { kit } : {}),
      ...(signatureWeapon ? {
        signatureWeapon: {
          id: signatureWeapon.id,
          name: signatureWeapon.name,
          path: signatureWeapon.weaponType,
          type: signatureWeapon.type,
          educated: !!signatureWeapon.educated,
        },
        signatureWeaponId: signatureWeapon.id,
        signatureWeaponName: signatureWeapon.name,
      } : {}),
      req,
      // No requirement at all (unfilled wiki page): surface the roster's
      // "no reliable material data" treatment instead of an empty ledger.
      ...(reqBase ? {} : { reliableData: false }),
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
    releaseOrder: spec.releaseOrder,
    art: giWeeklyBossArt(spec),
    drops: spec.matIds.map((id) => ({
      ...materialPayloadById(id, lookup, GI_BOSS_MAT_NAME_FALLBACKS[id], 'weekly'),
      chars: [],
    })),
  }));
  const byId = new Map();
  bosses.forEach((boss) => boss.drops.forEach((drop) => byId.set(String(drop.id), drop)));
  const sourcedCharacters = new Set();
  const unknownWeeklyIds = new Map();

  for (const ch of cmRosterSource(roster)) {
    const requirements = [
      ...(ch.req?.talents || []),
      ...(ch.req?.talentStages || []).flatMap((group) => (group || []).flatMap((stage) => stage?.items || [])),
    ];
    const seenIds = new Set();
    for (const mat of requirements) {
      const id = String(mat.id || '');
      if (!/^113\d{3}$/.test(id) || seenIds.has(id)) continue;
      seenIds.add(id);
      const row = byId.get(id);
      if (row) {
        pushUnique(row.chars, ch.n);
        sourcedCharacters.add(ch.n);
      } else if (!GI_NON_WEEKLY_113_IDS.has(id)) {
        if (!unknownWeeklyIds.has(id)) unknownWeeklyIds.set(id, new Set());
        unknownWeeklyIds.get(id).add(ch.n);
      }
    }
  }

  if (unknownWeeklyIds.size) {
    const named = [...unknownWeeklyIds.entries()]
      .map(([id, names]) => `${id} (${[...names].sort().join(', ')})`)
      .join('; ');
    throw new Error(`GI weekly requirements are missing from GI_WEEKLY_BOSS_SPECS: ${named}`);
  }

  const known = bosses
    .map((boss) => ({
      ...boss,
      drops: boss.drops.map((drop) => ({
        ...drop,
        chars: drop.chars.sort((a, b) => a.localeCompare(b)),
      })),
    }))
    .sort((a, b) => b.releaseOrder - a.releaseOrder);

  const rosterNames = new Set((roster || []).map((ch) => ch.n));
  const generatedCharacters = new Set(known.flatMap((boss) => boss.drops.flatMap((drop) => drop.chars)));
  const missingSource = [...rosterNames].filter((name) => !sourcedCharacters.has(name)).sort();
  const missingGenerated = [...sourcedCharacters].filter((name) => !generatedCharacters.has(name)).sort();
  const extraGenerated = [...generatedCharacters].filter((name) => !sourcedCharacters.has(name)).sort();
  if (missingSource.length || missingGenerated.length || extraGenerated.length) {
    throw new Error(
      `GI weekly character-set mismatch: no sourced boss requirement=[${missingSource.join(', ')}]; `
      + `missing generated=[${missingGenerated.join(', ')}]; extra generated=[${extraGenerated.join(', ')}]`,
    );
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

function highestGradeMaterial(mats, game) {
  return [...(mats || [])].sort((a, b) => (
    materialDisplayRarity(game, b?.rar, 0) - materialDisplayRarity(game, a?.rar, 0)
    || materialIdSort(b, a)
  ))[0] || null;
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
      mats: [highestGradeMaterial(row.mats, 'zzz')].filter(Boolean),
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
      mats: [highestGradeMaterial(row.mats, 'wuwa')].filter(Boolean),
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
  const endfieldViews = buildEndfieldMaterialViews(rosters.ae);
  return {
    gi: {
      name: 'Genshin Impact',
      icon: '../assets/icon/giicon.png',
      cur: 'Mora',
      curIcon: dbAsset('GameData/gi/assets/items/UI_ItemIcon_202.webp'),
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
      curIcon: dbAsset('GameData/hsr/assets/items/2.webp'),
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
      curIcon: dbAsset('GameData/zzz/assets/items/IconCoin.webp'),
      tabs: { mid: 'Skills', boss: 'Notorious Hunt' },
      rarities: ['S', 'A'],
      rarityLabel: { S: 'S', A: 'A' },
      midMode: 'group',
      filters: [
        { key: 'el', label: 'Attribute', opts: ordered(rosters.zzz.map((ch) => ch.el), preferred.zzzAttributes) },
        { key: 'spec', label: 'Specialty', opts: ordered(rosters.zzz.map((ch) => ch.spec), preferred.zzzSpecs) },
        { key: 'r', label: 'Rarity', opts: [['S', 'S'], ['A', 'A']] },
      ],
      weapons: weaponRosterForGame('zzz'),
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
      curIcon: dbAsset('GameData/ww/assets/items/UIResources/Common/Image/IconA/T_IconA_hsb_UI.webp'),
      tabs: { mid: 'Skills', boss: 'Weekly Challenge' },
      rarities: [5, 4],
      rarityLabel: { 5: '5\u2605', 4: '4\u2605' },
      midMode: 'group',
      filters: [
        { key: 'el', label: 'Attribute', opts: ordered(rosters.wuwa.map((ch) => ch.el), preferred.wuwaElements) },
        { key: 'w', label: 'Weapon', opts: ordered(rosters.wuwa.map((ch) => ch.w), preferred.wuwaWeapons) },
        { key: 'r', label: 'Rarity', opts: [['5-star', 5], ['4-star', 4]] },
      ],
      weapons: weaponRosterForGame('ww'),
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
      tabs: { mid: 'Growth Materials', boss: 'Progression Materials' },
      rarities: [6, 5, 4],
      rarityLabel: { 6: '6\u2605', 5: '5\u2605', 4: '4\u2605' },
      midMode: 'group',
      filters: [
        { key: 'el', label: 'Element', opts: ordered(rosters.ae.map((ch) => ch.el), preferred.aeElements) },
        { key: 'cls', label: 'Class', opts: ordered(rosters.ae.map((ch) => ch.cls), preferred.aeClasses) },
        { key: 'w', label: 'Weapon', opts: ordered(rosters.ae.map((ch) => ch.w), preferred.aeWeapons) },
        { key: 'r', label: 'Rarity', opts: [['6-star', 6], ['5-star', 5], ['4-star', 4]] },
      ],
      weapons: buildEndfieldWeaponRoster(),
      roster: rosters.ae,
      midGroups: endfieldViews.growthGroups,
      boss: { title: 'Progression Materials', count: rosters.ae.length },
      bossGroups: endfieldViews.progressionGroups,
      materialClassificationAudit:endfieldViews.audit,
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

function normalizePrydwenFields(rawFields, rarityContext) {
  const fields = {};
  for (const [sourceKey, sourceValue] of Object.entries(rawFields || {})) {
    if (/^\d+(?:when|if|after|while)/i.test(sourceKey)) continue;
    const parsed = typeof sourceValue === 'string'
      ? parseCatalogFieldLine(`${sourceKey}: ${sourceValue}`)
      : [];
    if (parsed.length > 1) {
      parsed.forEach((field) => { fields[field.key] = field.value; });
    } else {
      fields[sourceKey] = sourceValue;
    }
  }
  if (fields.rarity !== undefined) fields.rarity = databaseRarityLabel(fields.rarity, rarityContext);
  return fields;
}

function normalizePrydwenCollection(rel, title, limit = Infinity, mapEntry = (entry) => entry, rarityContext = {}) {
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
      fields:normalizePrydwenFields(entry.fields, rarityContext),
      text: cleanDatabaseText(entry.text),
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

/* The Database sorts "newest first" inside each rarity (user 2026-08-09), but
   none of the item feeds carry a release date. Banner history does: it records
   every weapon/light-cone/W-engine run with a real date, so the first run is the
   release. Anything that never had a banner (craftables, shop and battle-pass
   gear) keeps no date and falls back to its internal id, which climbs over time.
   Keyed by normalized name so "Amos' Bow" matches across sources. */
const databaseReleaseCache = new Map();

function databaseReleaseDates(game) {
  if (databaseReleaseCache.has(game)) return databaseReleaseCache.get(game);
  const dates = new Map();
  const file = `BannerHistory/${game}.json`;
  if (exists(file)) {
    for (const record of readJson(file).records || []) {
      if (record?.permanent) continue;
      const start = Object.values(record.windowsByRegion || {})
        .map((window) => window?.start).filter(Boolean).sort()[0];
      if (!start) continue;
      const day = start.slice(0, 10);
      for (const featured of record.featured || []) {
        const id = String(featured?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        if (!id) continue;
        const known = dates.get(id);
        if (!known || day < known) dates.set(id, day);
      }
    }
  }
  databaseReleaseCache.set(game, dates);
  return dates;
}

function databaseReleasedOn(game, name) {
  const id = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return id ? (databaseReleaseDates(game).get(id) || null) : null;
}

// Stamps every row in a collection with its release date, so one call covers a
// whole collection regardless of which builder produced it.
function withDatabaseReleaseDates(game, collection) {
  if (!collection || !Array.isArray(collection.items)) return collection;
  return {
    ...collection,
    items: collection.items.map((item) => {
      const released = databaseReleasedOn(game, item?.name);
      return released ? { ...item, released } : item;
    }),
  };
}

function normalizeGameDataItems(rel, title, source, mapItem, limit = Infinity) {
  const rows = readJson(rel).slice(0, limit).map(mapItem).filter(Boolean);
  return {
    key: path.basename(rel, '.json'),
    title,
    source,
    count: rows.length,
    items: rows,
  };
}

function normalizeBangbooSkills(skills) {
  return Object.entries(skills || {}).map(([key, skill]) => {
    const levels = Object.entries(skill?.level || {})
      .sort(([a], [b]) => Number(a) - Number(b));
    const first = levels[0]?.[1];
    if (!first) return null;
    const rawDescription = String(first.desc || '');
    const type = cleanText(rawDescription.match(/^\s*<color=[^>]+>([^<]+)<\/color>/i)?.[1], 80) || undefined;
    const description = cleanText(
      rawDescription.replace(/^\s*<color=[^>]+>[^<]+<\/color>\s*/i, ''),
      1200,
    ) || undefined;
    const properties = uniq((first.property || []).map((value) => cleanText(value, 90)).filter(Boolean));
    return {
      key,
      name: cleanText(first.name, 120) || undefined,
      type,
      description,
      ...(properties.length ? { properties } : {}),
    };
  }).filter(Boolean);
}

/* Some upstream records ship an empty `assets` block, so no filename is ever
   produced and the row silently falls back to the grey placeholder — that is why
   Glacier and Snowfield and Prayers to the Firmament had no art (user
   2026-08-09). Genshin artifact icons follow a fixed convention, so the set id
   and its piece slots give the filenames directly. This picks up any such file
   that is already mirrored, and keeps picking them up automatically as new
   sets arrive, instead of needing the upstream JSON to name them.
   It deliberately does NOT invent an image: if nothing is mirrored under the
   conventional name, the row keeps its placeholder. */
const ARTIFACT_ICON_SLOTS = [4, 3, 5, 2, 1];

function conventionalArtifactArt(record) {
  const id = String(record?.id || '').trim();
  if (!/^\d+$/.test(id)) return null;
  for (const slot of ARTIFACT_ICON_SLOTS) {
    const hit = dbAsset(`GameData/gi/assets/artifacts/sets/UI_RelicIcon_${id}_${slot}.webp`);
    if (hit) return hit;
  }
  // Pieces sometimes carry their own icon even when the set block is empty.
  for (const part of record?.parts || []) {
    const hit = dbAsset(part?.assets?.icon);
    if (hit) return hit;
  }
  return null;
}

function buildCollections() {
  const stamped = buildCollectionsRaw();
  return Object.fromEntries(Object.entries(stamped).map(([game, list]) => [
    game,
    list.map((collection) => withDatabaseReleaseDates(game, collection)),
  ]));
}

function buildCollectionsRaw() {
  const genshinWeapons = normalizeGameDataItems('GameData/gi/live/weapons.json', 'Weapons', 'GameData', (it) => ({
    id: 'gi-wpn-' + it.id,
    name: it.name,
    kind: 'weapon',
    art: dbAsset(it.assets?.icon || it.assets?.gacha),
    fields: { rarity: databaseRarityLabel(it.rarity), type: weaponMap[it.type] || it.type, atk: it.attack },
    text: cleanDatabaseText(it.description),
  }));
  genshinWeapons.items = genshinWeapons.items.filter((item) => item.fields.type !== 'ITEM_TPS_WEAPON');
  genshinWeapons.count = genshinWeapons.items.length;
  return {
    gi: [
      normalizeGameDataItems('GameData/gi/live/artifacts.json', 'Artifacts', 'GameData', (it) => ({
        id: 'gi-art-' + it.id,
        name: it.name,
        kind: 'artifact',
        art: dbAsset(it.assets?.icon) || conventionalArtifactArt(it),
        // An artifact-set card represents every piece in the set. Use the
        // highest tier the set can actually drop at as its single card rarity.
        fields: { rarity: databaseRarityLabel(Array.isArray(it.rarity) && it.rarity.length ? Math.max(...it.rarity) : it.rarity), type: it.type },
        text: cleanDatabaseText((it.setEffects || []).map((e) => `(${e.pieces}) ${e.description}`).join('\n\n')),
      })),
      genshinWeapons,
    ],
    hsr: [
      normalizePrydwenCollection('Prydwen/hsr/collections/light-cones.json', 'Light Cones'),
      normalizePrydwenCollection('Prydwen/hsr/collections/relic-sets.json', 'Relic Sets'),
    ],
    zzz: [
      normalizePrydwenCollection('Prydwen/zzz/collections/w-engines.json', 'W-Engines'),
      normalizePrydwenCollection('Prydwen/zzz/collections/disk-drives.json', 'Drive Discs', Infinity, (entry) => ({
        ...entry,
        fields: {
          ...entry.fields,
          twoPieceStat: databaseZzzDriveDiscTwoPieceStat(entry.fields),
        },
      })),
      normalizeGameDataItems('GameData/zzz/live/bangboos.json', 'Bangboo', 'GameData', (it) => ({
        id: 'zzz-bb-' + it.id,
        name: it.name,
        kind: 'bangboo',
        art: dbAsset(it.assets?.icon),
        fields: { rarity: databaseRarityLabel(it.rarity), codeName: it.codeName },
        text: cleanDatabaseText(it.description || Object.values(it.skills || {}).map((skill) => Object.values(skill?.level || {})[0]?.desc).filter(Boolean).join('\n\n')),
        skills: normalizeBangbooSkills(it.skills),
      })),
    ],
    wuwa: [
      normalizePrydwenCollection('Prydwen/ww/collections/weapons.json', 'Weapons', Infinity, normalizeWuwaWeaponEntry),
      normalizeGameDataItems('GameData/ww/live/echoes.json', 'Echoes', 'GameData', (it) => ({
        id: 'ww-echo-' + it.id,
        name: it.name,
        kind: 'echo',
        art: dbAsset(it.assets?.icon),
        fields: { rarity: databaseRarityLabel(Array.isArray(it.rarity) && it.rarity.length === 1 ? it.rarity[0] : it.rarity), type: it.type, cost: it.intensity },
        text: cleanDatabaseText(it.skill?.description || it.monsterInfo || it.description),
      })),
    ],
    ae: [
      normalizePrydwenCollection('Prydwen/endfield/collections/weapons.json', 'Weapons', Infinity, (entry) => entry, { game:'ae' }),
      normalizePrydwenCollection('Prydwen/endfield/collections/gear.json', 'Gear', Infinity, (entry) => entry, { game:'ae' }),
    ],
  };
}

// Workstream I: Monsters + Items per game. These are large (10k+ GI items), so
// they ship as lazy per-game packs (db-data-<game>.js) loaded when the Database
// tab opens — never inside nyx-data.js. Endfield has no source for these.
function buildLazyCollections() {
  const humanize = (value) => {
    const raw = String(value || '').trim();
    const words = raw.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
    const readable = raw && raw === raw.toUpperCase()
      ? words.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
      : words;
    return cleanText(readable, 80) || undefined;
  };
  const objectLabel = (value) => value && typeof value === 'object' ? humanize(Object.values(value)[0]) : humanize(value);
  const iconOrNull = (icon) => dbAsset(icon) || null;
  const genshinItemType = (item) => {
    const source = databaseSourceRows('gi', 'items').get(String(item?.id));
    const type = String(source?.type || item?.type || '').trim();
    if (['Wishing Item', 'Limited Wishing Item', 'Superior Voucher', 'Common Voucher', 'Special Currency'].includes(type)) {
      return 'Special Currency';
    }
    return humanize(type);
  };
  const genshinTcgVariantArt = buildGenshinTcgItemVariantArtMap();
  const genshinItemArt = (item) => {
    const direct = iconOrNull(item?.assets?.icon);
    if (direct) return { art: direct };
    const source = databaseSourceRows('gi', 'items').get(String(item?.id));
    const sourceIcon = sourceIconField(source)?.value;
    const exactSourceIcon = sourceIcon
      ? iconOrNull(`GameData/gi/assets/items/${path.basename(sourceIcon).replace(/\.(png|webp|jpg|jpeg)$/i, '')}.webp`)
      : null;
    if (exactSourceIcon) {
      return {
        art: exactSourceIcon,
        artStatus: 'trusted-exact-source-icon',
        artSource: 'database-art-backfill-provenance',
      };
    }
    const variant = genshinTcgVariantArt.get(sourceIcon);
    return variant
      ? { art: variant, artStatus: 'trusted-local-reuse', artSource: 'genshin-tcg-base-card' }
      : { art: null };
  };
  const approved = (game, collection, item) => {
    const config = DATABASE_AUDIT_CONFIG[game];
    const source = databaseSourceRows(config.dir, collection).get(String(item?.id));
    return databaseRecordClassification({
      game,
      collection,
      recordId: item?.id,
      name: item?.name,
      sourceIcon: sourceIconField(source)?.value,
    }) === 'released';
  };
  return {
    gi: [
      normalizeGameDataItems('GameData/gi/live/monsters.json', 'Monsters', 'GameData', (it) => it?.name && approved('gi', 'monsters', it) ? {
        id: 'gi-mon-' + it.id,
        name: it.name,
        kind: 'monster',
        art: iconOrNull(it.assets?.icon),
        // GameData's monster `title` field is not a verified family field and is
        // known to be misassigned for some rows. Keep it out of display metadata.
        fields: { type: humanize(it.type) },
        text: cleanDatabaseText(it.description),
      } : null),
      normalizeGameDataItems('GameData/gi/live/items.json', 'Items', 'GameData', (it) => {
        if (!it?.name || !approved('gi', 'items', it)) return null;
        const source = databaseSourceRows('gi', 'items').get(String(it.id));
        if (genshinItemDestination(it, source) !== 'items') return null;
        return {
          id: 'gi-item-' + it.id,
          name: it.name,
          kind: 'item',
          ...genshinItemArt(it),
          fields: { rarity: databaseRarityLabel(it.rarity), type: genshinItemType(it) },
          text: cleanDatabaseText(it.description),
        };
      }),
    ],
    hsr: [
      normalizeGameDataItems('GameData/hsr/live/monsters.json', 'Monsters', 'GameData', (it) => it?.name && approved('hsr', 'monsters', it) ? {
        id: 'hsr-mon-' + it.id,
        name: it.name,
        kind: 'monster',
        art: iconOrNull(it.assets?.icon),
        fields: {
          rank: humanize(it.rank),
          camp: it.camp,
          weaknesses: Array.isArray(it.weaknesses) ? it.weaknesses.map(humanize).filter(Boolean).join(', ') : undefined,
        },
        text: cleanDatabaseText(it.description),
      } : null),
      normalizeGameDataItems('GameData/hsr/live/items.json', 'Items', 'GameData', (it) => it?.name && approved('hsr', 'items', it) ? {
        id: 'hsr-item-' + it.id,
        name: it.name,
        kind: 'item',
        art: iconOrNull(it.assets?.icon),
        fields: { rarity: databaseRarityLabel(it.rarity), type: humanize(it.subType || it.type) },
        text: cleanDatabaseText(it.description || it.backgroundDescription),
      } : null),
    ],
    zzz: [
      normalizeGameDataItems('GameData/zzz/live/monsters.json', 'Monsters', 'GameData', (it) => it?.name && approved('zzz', 'monsters', it) ? {
        id: 'zzz-mon-' + it.id,
        name: it.name,
        kind: 'monster',
        art: iconOrNull(it.assets?.icon),
        fields: { rarity: databaseRarityLabel(it.rarity), type: humanize(it.type) },
        text: cleanDatabaseText(it.description),
      } : null),
      normalizeGameDataItems('GameData/zzz/live/items.json', 'Items', 'GameData', (it) => it?.name && approved('zzz', 'items', it) ? {
        id: 'zzz-item-' + it.id,
        name: it.name,
        kind: 'item',
        art: iconOrNull(it.assets?.icon),
        fields: { rarity: databaseRarityLabel(it.rarity), type: objectLabel(it.type) },
        text: cleanDatabaseText(it.description || it.secondaryDescription),
      } : null),
    ],
    wuwa: [
      normalizeGameDataItems('GameData/ww/live/monsters.json', 'Monsters', 'GameData', (it) => it?.name && approved('wuwa', 'monsters', it) ? {
        id: 'ww-mon-' + it.id,
        name: it.name,
        kind: 'monster',
        art: iconOrNull(it.assets?.icon),
        fields: { rarity: databaseRarityLabel(it.rarity), element: wwElementMap[it.element] },
        text: cleanDatabaseText(it.description),
      } : null),
      normalizeGameDataItems('GameData/ww/live/items.json', 'Items', 'GameData', (it) => it?.name && approved('wuwa', 'items', it) ? {
        id: 'ww-item-' + it.id,
        name: it.name,
        kind: 'item',
        art: iconOrNull(it.assets?.icon),
        fields: { rarity: databaseRarityLabel(it.rarity), type: humanize(Array.isArray(it.tag) ? it.tag[0] : it.tag) },
        text: cleanDatabaseText(it.description),
      } : null),
    ],
  };
}

function buildGenshinShadowRealm() {
  const weapons = readJson('GameData/gi/live/weapons.json')
    .filter((item) => item?.name && item.type === 'ITEM_TPS_WEAPON')
    .map((item) => ({
      id:`gi-shadow-weapon-${item.id}`,
      name:item.name,
      kind:'weapon',
      art:dbAsset(item.assets?.icon || item.assets?.gacha),
      fields:{ rarity:databaseRarityLabel(item.rarity), type:'Weapon', atk:item.attack },
      text:cleanDatabaseText(item.description),
    }));
  const accessories = readJson('GameData/gi/live/items.json')
    .filter((item) => item?.name && item.type === 'Firearm Accessory Blueprint'
      && genshinDatabaseItemReleased(item, databaseSourceRows('gi', 'items').get(String(item.id))))
    .map((item) => ({
      id:`gi-shadow-item-${item.id}`,
      name:item.name,
      kind:'item',
      art:dbAsset(item.assets?.icon),
      fields:{ rarity:databaseRarityLabel(item.rarity), type:'Firearm Accessory Blueprint' },
      text:cleanDatabaseText(item.description),
    }));
  return { items:[...weapons, ...accessories] };
}

function buildGenshinGallery() {
  const rawItems = databaseSourceRows('gi', 'items');
  const items = readJson('GameData/gi/live/items.json')
    .filter((item) => genshinDatabaseItemReleased(item, rawItems.get(String(item.id))));
  const galleryItem = (item) => ({
    id:String(item.id),
    name:item.name,
    description:cleanDatabaseText(item.description),
    rarity:databaseRarityLabel(item.rarity),
    art:dbAsset(item.assets?.icon),
  });
  const namecards = items
    .filter((item) => rawItems.get(String(item.id))?.material_type === 'MATERIAL_NAMECARD')
    .map((item) => {
      const source = rawItems.get(String(item.id));
      const token = String(source?.icon || '').replace(/^UI_NameCard(?:Icon|Pic)_/, '');
      return {
        ...galleryItem(item),
        art:dbAsset(`GenshinWiki/namecards/all/${item.id}.webp`)
          || dbAsset(`GameData/gi/assets/items/UI_NameCardPic_${token}.webp`),
      };
    })
    .filter((item) => item.art);
  const portraitItems = items
    .filter((item) => rawItems.get(String(item.id))?.material_type === 'MATERIAL_PROFILE_PICTURE')
    .map(galleryItem);
  const characterPortraits = rosters.gi.map((character) => ({
    id:character.id,
    name:character.n,
    description:character.title || '',
    rarity:databaseRarityLabel(character.r),
    art:character.icon,
    sortId:String(character.id).match(/(\d+)$/)?.[1] || '0',
  }));
  const avatarFrames = items
    .filter((item) => rawItems.get(String(item.id))?.material_type === 'MATERIAL_PROFILE_FRAME')
    .map(galleryItem);
  const splashArts = rosters.gi.map((character) => ({
    id:`splash-${character.id}`,
    name:character.n,
    description:character.title || '',
    rarity:databaseRarityLabel(character.r),
    art:character.art,
    sortId:String(character.id).match(/(\d+)$/)?.[1] || '0',
  })).filter((item) => item.art);
  return {
    namecards,
    portraits:GENSHIN_AVATARS.length ? GENSHIN_AVATARS : [...portraitItems, ...characterPortraits],
    avatarFrames,
    splashArts,
  };
}

const DATABASE_AUDIT_CONFIG = {
  gi: { sourceGame: 'gi', dir: 'gi', idPrefix: 'gi', collections: ['monsters', 'items'] },
  hsr: { sourceGame: 'hsr', dir: 'hsr', idPrefix: 'hsr', collections: ['monsters', 'items'] },
  zzz: { sourceGame: 'zzz', dir: 'zzz', idPrefix: 'zzz', collections: ['monsters', 'items'] },
  wuwa: { sourceGame: 'ww', dir: 'ww', idPrefix: 'ww', collections: ['monsters', 'items'] },
};
const DATABASE_SOURCE_ROWS_CACHE = new Map();

function databaseSourceRows(dir, collection) {
  const key = `${dir}/${collection}`;
  if (DATABASE_SOURCE_ROWS_CACHE.has(key)) return DATABASE_SOURCE_ROWS_CACHE.get(key);
  const rawFile = collection === 'items' ? 'itemAll.json' : 'monsters.json';
  const value = readJson(`GameData/${dir}/live/raw/${rawFile}`);
  const rows = new Map(Array.isArray(value)
    ? value.map((row, index) => [String(row?.id ?? index), row])
    : Object.entries(value || {}).map(([id, row]) => [String(id), row]));
  DATABASE_SOURCE_ROWS_CACHE.set(key, rows);
  return rows;
}

function sourceIconField(row) {
  for (const field of ['icon', 'icon_path', 'item_icon_path', 'item_figure_icon_path', 'image_path']) {
    const value = row?.[field];
    if (typeof value === 'string' && value.trim()) return { field, value };
  }
  return null;
}

function wuwaAuditAssetPath(sourceRef) {
  if (!sourceRef || typeof sourceRef !== 'string') return null;
  const asset = sourceRef
    .replace(/^\/Game\/Aki\/UI\//, '')
    .replace(/^Game\/Aki\/UI\//, '')
    .replace(/^\/Game\/Aki\//, '')
    .replace(/^Game\/Aki\//, '')
    .replace(/\\/g, '/');
  const parts = asset.split('/');
  const file = parts.pop() || '';
  const stem = file.split('.')[0].replace(/\.(png|webp|jpg|jpeg)$/i, '');
  return [...parts, `${stem}.webp`].filter(Boolean).join('/');
}

function auditAssetProvenance(game, collection, iconField, normalizedDestination) {
  let remotePath = null;
  let localDestination = normalizedDestination || null;
  const iconValue = iconField?.value;

  if (game === 'hsr') {
    const stem = iconValue ? path.basename(iconValue).replace(/\.(png|webp|jpg|jpeg)$/i, '') : null;
    if (stem) {
      const remoteFolder = collection === 'monsters' ? 'monsterfigure' : 'itemfigures';
      remotePath = `${remoteFolder}/${stem}.webp`;
      localDestination ||= `GameData/hsr/assets/${collection}/${stem}.webp`;
    }
  } else if (game === 'ww') {
    remotePath = wuwaAuditAssetPath(iconValue);
    if (remotePath) localDestination ||= `GameData/ww/assets/${collection}/${remotePath}`;
  } else if (iconValue) {
    remotePath = `${path.basename(iconValue).replace(/\.(png|webp|jpg|jpeg)$/i, '')}.webp`;
    localDestination ||= `GameData/${game}/assets/${collection}/${remotePath}`;
  }

  if (!remotePath && localDestination) {
    const marker = `GameData/${game}/assets/${collection}/`;
    remotePath = localDestination.startsWith(marker) ? localDestination.slice(marker.length) : null;
  }

  return {
    localDestination,
    sourceUrl: remotePath ? `https://static.nanoka.cc/assets/${game}/${remotePath}` : null,
  };
}

function buildDatabaseArtAudit(lazyCollections, inlineCollections, specials) {
  const summaries = [];
  const records = [];
  const quarantinedRecords = [];
  const previousAudit = (() => {
    try { return readJson('Audits/database-missing-art.json'); }
    catch { return null; }
  })();

  for (const [siteGame, config] of Object.entries(DATABASE_AUDIT_CONFIG)) {
    const generatedByCollection = new Map((lazyCollections[siteGame] || []).map((collection) => [collection.key, collection]));
    for (const collection of config.collections) {
      const sourceRows = databaseSourceRows(config.dir, collection);
      const normalized = readJson(`GameData/${config.dir}/live/${collection}.json`);
      const generated = generatedByCollection.get(collection)?.items || [];
      const generatedById = new Map(generated.map((row) => [row.id, row]));

      if (sourceRows.size !== normalized.length) {
        throw new Error(
          `Database count mismatch for ${siteGame}/${collection}: source=${sourceRows.size}, normalized=${normalized.length}`,
        );
      }

      let availableArt = 0;
      let quarantinedCount = 0;
      let routedCount = 0;
      normalized.forEach((row) => {
        const sourceRow = sourceRows.get(String(row.id));
        const iconField = sourceIconField(sourceRow);
        const expectedId = `${config.idPrefix}-${collection === 'monsters' ? 'mon' : 'item'}-${row.id}`;
        const classification = databaseRecordClassification({
          game: siteGame,
          collection,
          recordId: row.id,
          name: row.name,
          sourceIcon: iconField?.value,
        });

        if (classification !== 'released') {
          quarantinedCount += 1;
          quarantinedRecords.push({
            game: siteGame,
            collection,
            recordId: String(row.id),
            name: row.name,
            releaseStatus: classification,
            sourceIconField: iconField,
            sourceUrl: null,
            localDestination: null,
            result: 'quarantined',
            reason: classification === 'no-localized-display-name'
              ? 'The source row has no usable localized display name. It is quarantined without guessing or substituting a name.'
              : 'The record name or source icon is explicitly marked test/internal and is excluded from generated released data and approved asset provenance.',
          });
          return;
        }

        if (siteGame === 'gi' && collection === 'items'
            && genshinItemDestination(row, sourceRow) !== 'items') {
          routedCount += 1;
          return;
        }

        const generatedRow = generatedById.get(expectedId);
        if (!generatedRow) {
          throw new Error(`Approved Database row missing from generated output: ${siteGame}/${collection}/${row.id}`);
        }

        if (generatedRow.art) {
          if (/^https?:\/\//i.test(generatedRow.art)) {
            throw new Error(`Remote Database art is forbidden: ${generatedRow.art}`);
          }
          availableArt += 1;
          return;
        }

        const unsafeSourceIcon = databaseSourceIconPolicy(iconField?.value) !== 'allowed';
        const provenance = unsafeSourceIcon
          ? { sourceUrl: null, localDestination: null }
          : auditAssetProvenance(
            config.sourceGame,
            collection,
            iconField,
            row.assets?.icon || null,
          );
        records.push({
          game: siteGame,
          collection,
          recordId: String(row.id),
          name: row.name,
          releaseStatus: row.contentStatus || 'live',
          sourceIconField: iconField,
          sourceUrl: provenance.sourceUrl,
          localDestination: provenance.localDestination,
          result: unsafeSourceIcon ? 'unsafe-source-icon' : (iconField ? 'unavailable' : 'no-approved-source-icon'),
          reason: unsafeSourceIcon
            ? 'The released record uses a known internal/test placeholder icon. The record remains available, but its unsafe art is blocked and no replacement filename is guessed.'
            : (iconField
              ? 'The exact icon named by the released source record was not available as a usable local file after the scraper attempt.'
              : 'The released source record does not name an icon, so no filename or URL was guessed.'),
        });
      });

      if (generated.length + routedCount + quarantinedCount !== normalized.length) {
        throw new Error(
          `Database output count mismatch for ${siteGame}/${collection}: normalized=${normalized.length}, generated=${generated.length}, routed=${routedCount}, quarantined=${quarantinedCount}`,
        );
      }

      summaries.push({
        game: siteGame,
        collection,
        sourceCount: sourceRows.size,
        normalizedCount: normalized.length,
        quarantinedCount,
        routedCount,
        approvedSourceCount: normalized.length - quarantinedCount,
        generatedCount: generated.length,
        localArtCount: availableArt,
        missingArtCount: generated.length - availableArt,
      });
    }
  }

  const auditGeneratedCollection = (scope, game, collection, rows) => {
    const list = Array.isArray(rows) ? rows : [];
    let localArtCount = 0;
    list.forEach((row, index) => {
      if (row?.art) {
        if (/^https?:\/\//i.test(row.art)) throw new Error(`Remote Database art is forbidden: ${row.art}`);
        localArtCount += 1;
        return;
      }
      records.push({
        scope,
        game,
        collection,
        recordId:String(row?.id ?? `${collection}-${index + 1}`),
        name:String(row?.name || 'Unnamed released record'),
        releaseStatus:row?.status || 'live',
        sourceIconField:null,
        sourceUrl:null,
        localDestination:null,
        result:'no-local-art-reference',
        reason:'The released generated record has no usable local art reference and no approved source URL or filename was available; the record remains visible with a neutral fallback.',
      });
    });
    summaries.push({
      scope,
      game,
      collection,
      sourceCount:list.length,
      normalizedCount:list.length,
      quarantinedCount:0,
      routedCount:0,
      approvedSourceCount:list.length,
      generatedCount:list.length,
      localArtCount,
      missingArtCount:list.length - localArtCount,
    });
  };

  for (const [game, gameCollections] of Object.entries(inlineCollections || {})) {
    for (const collection of gameCollections || []) {
      auditGeneratedCollection('inline', game, collection.key, collection.items);
    }
  }
  auditGeneratedCollection('special', 'gi', 'tcg-character-cards', specials?.tcg?.characterCards);
  auditGeneratedCollection('special', 'gi', 'tcg-action-cards', specials?.tcg?.otherCards);
  auditGeneratedCollection('special', 'gi', 'furniture', specials?.furniture?.items);
  auditGeneratedCollection('special', 'gi', 'furnishing-blueprints', specials?.furniture?.blueprints);
  auditGeneratedCollection('special', 'gi', 'realm-materials', specials?.furniture?.materials);
  auditGeneratedCollection('special', 'gi', 'wonderland-costumes', specials?.wonderland?.costumes);
  auditGeneratedCollection('special', 'gi', 'wonderland-suits', specials?.wonderland?.suits);
  auditGeneratedCollection('special', 'gi', 'wonderland-items', specials?.wonderland?.items);
  auditGeneratedCollection('special', 'gi', 'shadow-realm', specials?.shadowRealm?.items);
  auditGeneratedCollection('special', 'gi', 'gallery-namecards', specials?.gallery?.namecards);
  auditGeneratedCollection('special', 'gi', 'gallery-portraits', specials?.gallery?.portraits);
  auditGeneratedCollection('special', 'gi', 'gallery-avatar-frames', specials?.gallery?.avatarFrames);
  auditGeneratedCollection('special', 'gi', 'gallery-splash-art', specials?.gallery?.splashArts);

  records.sort((a, b) => a.game.localeCompare(b.game)
    || a.collection.localeCompare(b.collection)
    || a.recordId.localeCompare(b.recordId, undefined, { numeric: true }));
  quarantinedRecords.sort((a, b) => a.game.localeCompare(b.game)
    || a.collection.localeCompare(b.collection)
    || a.recordId.localeCompare(b.recordId, undefined, { numeric: true }));
  return {
    generatedAt: new Date().toISOString(),
    policy: 'Every generated Database row is counted. Released rows remain visible when art or description is missing; only rows with no usable localized display name or proven internal/test provenance are quarantined.',
    coverage: {
      before: {
        scopes:previousAudit?.coverage?.after?.scopes || ['lazy'],
        summaryCount:Number(previousAudit?.summary?.length) || 0,
        missingArtCount:Number(previousAudit?.missingArtCount) || 0,
        quarantinedCount:Number(previousAudit?.quarantinedCount) || 0,
      },
      after: {
        scopes:['inline', 'lazy', 'special'],
        summaryCount:summaries.length,
        missingArtCount:records.length,
        quarantinedCount:quarantinedRecords.length,
      },
    },
    summary: summaries,
    missingArtCount: records.length,
    records,
    quarantinedCount: quarantinedRecords.length,
    quarantinedRecords,
  };
}

const DATABASE_FALLBACK_ART = Object.fromEntries(
  ['gi', 'hsr', 'zzz', 'wuwa', 'ae'].map((game) => [
    game,
    dbAsset(`Shared/database-fallbacks/${game}.svg`),
  ]),
);

function applyDatabaseIntentionalFallbacks(lazyCollections, inlineCollections, specials) {
  let count = 0;
  const apply = (game, rows) => {
    const art = DATABASE_FALLBACK_ART[game];
    if (!art) throw new Error(`Missing neutral Database fallback asset for ${game}`);
    for (const row of rows || []) {
      if (row?.art) continue;
      row.art = art;
      row.artStatus = 'intentional-fallback';
      row.artSource = 'neutral-database-placeholder';
      count += 1;
    }
  };

  for (const [game, gameCollections] of Object.entries(lazyCollections || {})) {
    for (const collection of gameCollections || []) apply(game, collection.items);
  }
  for (const [game, gameCollections] of Object.entries(inlineCollections || {})) {
    for (const collection of gameCollections || []) apply(game, collection.items);
  }
  apply('gi', specials?.tcg?.characterCards);
  apply('gi', specials?.tcg?.otherCards);
  apply('gi', specials?.furniture?.items);
  apply('gi', specials?.furniture?.blueprints);
  apply('gi', specials?.furniture?.materials);
  apply('gi', specials?.wonderland?.costumes);
  apply('gi', specials?.wonderland?.suits);
  apply('gi', specials?.wonderland?.items);
  apply('gi', specials?.shadowRealm?.items);
  apply('gi', specials?.gallery?.namecards);
  apply('gi', specials?.gallery?.portraits);
  apply('gi', specials?.gallery?.avatarFrames);
  apply('gi', specials?.gallery?.splashArts);
  return count;
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
  gi: { name: 'Primogems', needle: 'primogem', icon: dbAsset('GameData/gi/assets/items/UI_ItemIcon_201.webp') },
  hsr: { name: 'Stellar Jade', needle: 'stellar jade', icon: dbAsset('GameData/hsr/assets/items/900001.webp') },
  zzz: { name: 'Polychrome', needle: 'polychrome', icon: dbAsset('GameData/zzz/assets/items/IconCurrency.webp') },
  wuwa: { name: 'Astrite', needle: 'astrite', icon: dbAsset('GameData/ww/assets/items/UIResources/Common/Image/IconA/T_IconA_zcpq_UI.webp') },
  ae: { name: 'Oroberyl', needle: 'oroberyl', aliases: ['originium'], icon: dbAsset('EndfieldWiki/endfield/material-icons/Oroberyl.png') },
};

function codeHasPremiumCurrency(key, reward) {
  const meta = premiumCurrencyMeta[key];
  if (!meta?.needle) return false;
  const text = String(reward || '').toLowerCase();
  return [meta.needle, ...(meta.aliases || [])].some((needle) => text.includes(String(needle).toLowerCase()));
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

/* Banner feeds and the roster do not always spell a character the same way
   (2026-08-09):
     · HSR publishes "Himeko • Nova", the roster carries "Himeko Nova"
     · ZZZ publishes full names — "Piper Wheel", "Ukinami Yuzuha" — while the
       roster uses the in-game short name, "Piper" and "Yuzuha"
   An exact string compare misses all of those, and a missed match means no icon
   and no splash art on the banner card. So: compare on letters and digits only,
   then fall back to a roster name that is the leading or trailing run of words
   in the banner name. An ambiguous fallback (two roster rows equally close) is
   dropped rather than guessed. */
function rosterNameKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function rosterNameWords(value) {
  return String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function rosterNameEdgeMatch(rosterName, bannerWords) {
  const words = rosterNameWords(rosterName);
  if (!words.length || words.length >= bannerWords.length) return 0;
  const leads = words.every((word, index) => bannerWords[index] === word);
  const offset = bannerWords.length - words.length;
  const trails = words.every((word, index) => bannerWords[offset + index] === word);
  return leads || trails ? words.length : 0;
}

function rosterHit(rosters, key, name) {
  const roster = rosters[key] || [];
  const wanted = rosterNameKey(name);
  if (!wanted) return null;
  const namesOf = (ch) => [ch.n, ...(ch.forms || []).map((form) => form.rawName || form.n)].filter(Boolean);
  const exact = roster.find((ch) => namesOf(ch).some((row) => rosterNameKey(row) === wanted));
  if (exact) return exact;
  const bannerWords = rosterNameWords(name);
  if (bannerWords.length < 2) return null;
  let best = null;
  let bestScore = 0;
  let tied = false;
  for (const ch of roster) {
    const score = Math.max(0, ...namesOf(ch).map((row) => rosterNameEdgeMatch(row, bannerWords)));
    if (!score) continue;
    if (score > bestScore) { best = ch; bestScore = score; tied = false; }
    else if (score === bestScore && best !== ch) tied = true;
  }
  return tied ? null : best;
}

// Rewrite a GameData CDN URL to its local Database-mirror path so nothing loads
// from an external host at runtime. localize-gamedata-icons.mjs downloads the
// referenced files into the mirror; non-matching values pass through unchanged.
function localImageRef(url) {
  if (typeof url !== 'string') return url;
  const local = url.replace(/^https:\/\/static\.gamedata\.cc\/assets\/([^/]+)\//, '../../Database/GameData/$1/assets/');
  // Drop the ref if the mirrored file isn't present (e.g. a variant that 404s
  // upstream) so the payload never points at a missing or external asset.
  if (local.startsWith('../../Database/') && !exists(local.slice('../../Database/'.length))) return null;
  return local;
}

// How many separate banner runs a character has ever had, from the official
// banner history. One run (or none, for someone not in history yet) means this
// is their debut — that is what earns the big splash card on the overview,
// rather than the rerun sharing the same phase. Counting runs avoids needing a
// reliable phase start date, which the banner scrape often leaves null.
function bannerRunCounts(key) {
  const file = `BannerHistory/${key}.json`;
  if (!exists(file)) return null;
  const runs = new Map();
  for (const record of readJson(file).records || []) {
    if (record?.permanent) continue;
    const start = Object.values(record.windowsByRegion || {})
      .map((window) => window?.start).filter(Boolean).sort()[0];
    if (!start) continue;
    for (const featured of record.featured || []) {
      if (!featured?.name || featured.entityType === 'weapon') continue;
      const id = String(featured.name).toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (!runs.has(id)) runs.set(id, new Set());
      runs.get(id).add(start.slice(0, 10));
    }
  }
  return runs;
}

// When nobody is debuting, the overview gives the big card to whoever joined
// the game most recently — so a phase pairing a brand-new-ish character with a
// years-old rerun leads with the newer face.
function bannerDebutDate(runCounts, name) {
  if (!runCounts) return null;
  const id = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const dates = runCounts.get(id);
  return dates && dates.size ? [...dates].sort()[0] : null;
}

// A character can be on a banner before they exist in the live roster — an
// upcoming patch's featured unit only appears in the GameData BETA channel.
// Without this the banner ships icon:null and art:null, and the renderer used to
// substitute one shared game picture, so two different upcoming characters both
// wore the same face (Odette and Alyosha, 2026-08-09). Their artwork is already
// mirrored locally; this reads it straight from the beta channel.
const bannerBetaAssetCache = new Map();

function bannerBetaAssets(key) {
  if (bannerBetaAssetCache.has(key)) return bannerBetaAssetCache.get(key);
  const dir = key === 'wuwa' ? 'ww' : key;
  const file = `GameData/${dir}/beta/characters.json`;
  const map = new Map();
  if (exists(file)) {
    const raw = readJson(file);
    const rows = Array.isArray(raw) ? raw : (raw?.items || raw?.characters || []);
    const add = (alias, entry) => {
      const clean = String(alias || '').trim().toLowerCase();
      if (clean && !map.has(clean)) map.set(clean, entry);
    };
    const segmentAliases = [];
    for (const row of rows) {
      const name = String(row?.name || '').trim();
      if (!name || !row?.assets) continue;
      // Beta assets are already Database-relative ("GameData/gi/assets/…"), so
      // they only need the mirror prefix — and dropping if the file is absent,
      // the same rule localImageRef applies to CDN refs.
      const localize = (value) => {
        const clean = String(value || '').trim();
        if (!clean.startsWith('GameData/') || !exists(clean)) return null;
        return `../../Database/${clean}`;
      };
      const entry = {
        name,
        icon: localize(row.assets.circle) || localize(row.assets.icon) || null,
        art: localize(row.assets.gacha) || localize(row.assets.card) || null,
        rarity: row.rarity ?? null,
      };
      add(name, entry);
      // Alt versions are "Base • Variant" in game data but announced by the
      // variant alone; index the segments in a second pass so a base character
      // never loses its own name to one of its variants.
      const segments = name.split(/\s*[•·|]\s*/).map((part) => part.trim()).filter(Boolean);
      if (segments.length > 1) for (const segment of segments) segmentAliases.push([segment, entry]);
    }
    for (const [alias, entry] of segmentAliases) add(alias, entry);
  }
  bannerBetaAssetCache.set(key, map);
  return map;
}

function normalizeBannerCharacter(rosters, key, entry, runCounts) {
  const name = typeof entry === 'string' ? entry : entry?.name;
  if (!name) return null;
  const runId = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '');
  // Unknown history (no file) makes no debut claim either way.
  const debut = runCounts ? (runCounts.get(runId)?.size || 0) <= 1 : null;
  const debutAt = bannerDebutDate(runCounts, name);
  const local = rosterHit(rosters, key, name);
  // The banner scraper enriches each character with a GameData icon
  // (`image` / `imageFallback`); localImageRef points those at the local mirror.
  // Fall back to them when the local roster has no hit — otherwise the icon goes
  // null and the renderer shows one shared game art for every card (the "all
  // banners show the same face" bug).
  const entryImage = typeof entry === 'object' ? (localImageRef(entry.image || entry.icon || null)) : null;
  const entryFallback = typeof entry === 'object' ? (localImageRef(entry.imageFallback || null)) : null;
  // Full-body art the scraper confirmed the CDN actually serves. A character
  // too new for the local roster (Robin • Summeretto) otherwise falls back to
  // a headshot URL that 404s, leaving the card blank.
  const entrySplash = typeof entry === 'object' ? (localImageRef(entry.imageSplash || null)) : null;
  const beta = local ? null : (bannerBetaAssets(key).get(String(name).toLowerCase()) || null);
  // Display the game's own name for the character rather than the community
  // feed's shorthand (user 2026-08-09): game8 announces "Summeretto" and
  // "Ukinami Yuzuha", the game calls them "Robin • Summeretto" and "Yuzuha".
  // Only when the roster actually matched — an unmatched name stays as scraped.
  const displayName = entry?.displayName || local?.n || beta?.name || name;
  return {
    name: displayName,
    icon: local?.icon || entryImage || beta?.icon || null,
    iconFallback: entryFallback || null,
    iconZoom: typeof entry === 'object' ? !!entry.imageFallbackZoom : false,
    art: local?.art || local?.card || entrySplash || entryImage || beta?.art || null,
    namecard: local?.namecard || null, // G31: GI banner art prefers the namecard
    rarity: local?.r || entry?.rarity || beta?.rarity || null,
    debut,
    debutAt,
  };
}

// User-provided order is only the tie-breaker for dateless teases. Game8 keeps
// the names and artwork fresh; Nanoka beta and official history take over as
// soon as a character receives machine-readable patch data.
const BANNER_ROADMAP_ORDER = {
  gi:['vesna', 'vodyanitsa', 'mitya', 'valeriy', 'tsaritsa', 'danica', 'noy'],
  hsr:['robinsummeretto', 'aventurinewaveflair', 'pearl', 'nihilux'],
  zzz:['claret', 'roxy', 'sunbringer', 'phoenix', 'thestoryteller'],
  wuwa:['qingxiao', 'jingran', 'suoming', 'hsin'],
};

const BANNER_ROADMAP_DISPLAY = {
  'gi:tsaritsa':'The Tsaritsa Anastasya Feodorovna Snezhnaya',
};

function bannerRoadmapCharacters(rosters, key, rows, runCounts) {
  const preferred = BANNER_ROADMAP_ORDER[key] || [];
  const byName = new Map((rows || []).map((row) => [rosterNameKey(row?.name), row]).filter(([name]) => name));
  const selected = preferred.map((name) => byName.get(name)).filter(Boolean);
  const selectedNames = new Set(selected.map((row) => rosterNameKey(row.name)));
  for (const row of rows || []) {
    const name = rosterNameKey(row?.name);
    if (!name || selectedNames.has(name)) continue;
    selected.push(row);
    selectedNames.add(name);
  }
  return selected.map((row) => {
    const sourceName = rosterNameKey(row.name);
    const unit = normalizeBannerCharacter(rosters, key, {
      ...row,
      displayName:BANNER_ROADMAP_DISPLAY[`${key}:${sourceName}`] || undefined,
    }, runCounts);
    return unit ? { ...unit, hint:row.hint || null, source:row.source || null, sourceUrl:row.sourceUrl || null } : null;
  }).filter(Boolean);
}

// Community banner pages occasionally publish a typo'd year (2026-08-08: the
// Genshin 7.0 Phase 1 end read "2206-09-01"). A date years out is not a
// schedule, and shipping it means a countdown claiming 180 years.
const BANNER_HORIZON_MS = 3 * 365 * 24 * 60 * 60 * 1000;

function plausibleBannerDate(value, now) {
  const at = Date.parse(value);
  if (!Number.isFinite(at) || at > now + BANNER_HORIZON_MS) return null;
  return value;
}

function normalizeBannerPhase(rosters, key, phase, runCounts) {
  const characters = (phase?.characters || [])
    .map((entry) => normalizeBannerCharacter(rosters, key, entry, runCounts))
    .filter(Boolean);
  const nowMs = Date.now();
  return {
    phase: phase?.phase || null,
    teased: phase?.teased === true,
    start: plausibleBannerDate(phase?.start, nowMs),
    end: plausibleBannerDate(phase?.end, nowMs),
    characters,
    subBanners: (phase?.subBanners || []).map((sub) => ({
      phase: sub.phase || null,
      start: sub.start || null,
      end: sub.end || null,
      characters: (sub.characters || [])
        .map((entry) => normalizeBannerCharacter(rosters, key, entry, runCounts))
        .filter(Boolean),
    })),
  };
}

// What is live right now, straight from the official banner history.
//
// The community banner scrape is the only source for what is COMING, but it
// lags on what is running: on 2026-08-08 it still listed Genshin 6.7 Phase 1
// (Sandrone, Citlali) while the official feed had Phase 2 (Raiden, Columbina)
// live. Anything the official feed can answer, it answers.
function officialPhaseFrom(rows, key, rosters, runCounts) {
  if (!rows.length) return null;
  const characters = [];
  const seen = new Set();
  for (const { record } of rows) {
    for (const featured of record.featured || []) {
      if (!featured?.name || featured.entityType === 'weapon') continue;
      // A placeholder the wiki uses for an unannounced slot — never a name.
      if (/^unknown\b/i.test(featured.name)) continue;
      const id = String(featured.name).toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      const entry = normalizeBannerCharacter(rosters, key, featured, runCounts);
      if (entry) characters.push(entry);
    }
  }
  if (!characters.length) return null;
  // A just-announced phase often has a start and no published end yet.
  const ends = rows.map((row) => row.end).filter((value) => Number.isFinite(value));
  const latestPhase = rows.reduce((latest, row) => row.start > latest.start ? row : latest, rows[0]);
  return {
    phase: latestPhase.phase || latestPhase.record.version || null,
    start: new Date(Math.min(...rows.map((row) => row.start))).toISOString(),
    end: ends.length ? new Date(Math.max(...ends)).toISOString() : null,
    characters,
    subBanners: [],
  };
}

// Short overlap banners (for example HSR collaborations) do not start a new
// three-week phase. A real phase boundary is at least two weeks later.
const BANNER_PHASE_GAP_MS = 14 * 24 * 60 * 60 * 1000;
function bannerPhaseStarts(starts) {
  const phases = [];
  for (const start of starts.sort((a, b) => a - b)) {
    if (!phases.length || start - phases.at(-1) >= BANNER_PHASE_GAP_MS) phases.push(start);
  }
  return phases;
}

// What is live now and what is confirmed next, straight from the official
// banner history.
//
// The community banner scrape is still needed for phases further out, but it
// lags on the running one (2026-08-08: it listed Genshin 6.7 Phase 1 while
// Phase 2 was live) and only ever lists the headline 5-stars, so the featured
// 4-stars (Alyosha on both 7.0 Phase 1 banners) exist only here.
function officialPhases(key, rosters, runCounts, now) {
  const file = `BannerHistory/${key}.json`;
  if (!exists(file)) return { current:null, next:null };
  const records = readJson(file).records || [];
  const startsByVersion = new Map();
  for (const record of records) {
    if (record?.permanent || record?.bannerType === 'weapon' || !record?.version) continue;
    const starts = Object.values(record.windowsByRegion || {}).map((window) => Date.parse(window?.start)).filter(Number.isFinite);
    if (!starts.length) continue;
    const version = String(record.version).trim();
    if (!startsByVersion.has(version)) startsByVersion.set(version, []);
    startsByVersion.get(version).push(Math.min(...starts));
  }
  for (const [version, starts] of startsByVersion) {
    startsByVersion.set(version, bannerPhaseStarts(starts));
  }
  const phaseLabel = (record, start) => {
    const version = String(record?.version || '').trim();
    if (!version || /\bphase\s*\d+\b/i.test(version)) return version || null;
    const starts = startsByVersion.get(version) || [];
    const index = starts.findIndex((known) => Math.abs(known - start) < 36 * 60 * 60 * 1000);
    return `${version} Phase ${Math.max(0, index) + 1}`;
  };
  const live = [];
  const future = [];
  for (const record of records) {
    if (record?.permanent || record?.bannerType === 'weapon') continue;
    // Every region is considered, not just the first: the regions end hours
    // apart, so stopping at (say) Asia drops a banner that is still running in
    // Europe and silently falls the whole game back to the community scrape.
    let running = null;
    let starting = null;
    for (const window of Object.values(record.windowsByRegion || {})) {
      const start = Date.parse(window?.start);
      const end = Date.parse(window?.end);
      if (!Number.isFinite(start)) continue;
      // "Live" needs a published end — without one an ancient record would
      // masquerade as running. "Upcoming" only needs a start.
      if (start <= now && Number.isFinite(end) && end >= now) {
        // Prefer the region that runs longest, so the countdown matches the
        // last server still on this banner.
        if (!running || end > running.end) running = { record, start, end, phase:phaseLabel(record, start) };
      } else if (start > now && (!starting || start < starting.start)) {
        starting = { record, start, end, phase:phaseLabel(record, start) };
      }
    }
    if (running) live.push(running);
    else if (starting) future.push(starting);
  }
  // "Next" is only the soonest future phase, not everything on the wiki.
  const soonest = future.length ? Math.min(...future.map((row) => row.start)) : null;
  const nextRows = soonest === null ? [] : future.filter((row) => row.start - soonest < 36 * 60 * 60 * 1000);
  return {
    current:officialPhaseFrom(live, key, rosters, runCounts),
    next:officialPhaseFrom(nextRows, key, rosters, runCounts),
  };
}

function buildBannersData(rosters, betaDeltas = {}) {
  if (!exists('Banners/banners.json')) return { updated: null, games: {} };
  const src = readJson('Banners/banners.json');
  const now = Date.now();
  const games = {};
  for (const group of src.games || []) {
    const key = gameKey(group.id || group.slug || group.name);
    if (!key) continue;
    const runCounts = bannerRunCounts(key);
    // 1) Normalize each phase's characters (roster art + scraper CDN icons).
    const scrapedCurrent = normalizeBannerPhase(rosters, key, group.current, runCounts);
    const scrapedNext = normalizeBannerPhase(rosters, key, group.next, runCounts);
    const official = officialPhases(key, rosters, runCounts, now);
    // The official feed wins for what is live and what is confirmed next. Keep
    // the community phase label ("6.7 Phase 2") only when it describes the same
    // banner — otherwise the label belongs to a phase that already ended.
    const keepLabel = (officialPhase, scraped) => {
      if (!officialPhase) return null;
      const sameRun = scraped?.phase && scraped.characters.some((row) => officialPhase.characters.some((hit) => hit.name === row.name));
      if (key === 'ae') return { ...officialPhase, phase:sameRun ? scraped.phase : officialPhase.phase };
      return { ...officialPhase, phase:officialPhase.phase || (sameRun ? scraped.phase : null) };
    };
    const current = keepLabel(official.current, scrapedCurrent) || scrapedCurrent;
    const next = keepLabel(official.next, scrapedNext) || scrapedNext;
    // The community feed repeats a phase in its own `upcoming` list — Genshin
    // publishes both `next: [Odette, Arlecchino]` and
    // `upcoming: [Odette, Arlecchino, Ineffa, Flins]`. Left alone those repeats
    // become extra "later" phases and the same characters appear twice on the
    // board, so anything already covered by current/next is dropped here.
    const alreadyShown = new Set([...(current?.characters || []), ...(next?.characters || [])]
      .map((row) => rosterNameKey(row.name)).filter(Boolean));
    const upcoming = [];
    for (const phase of group.upcoming || []) {
      const built = normalizeBannerPhase(rosters, key, phase, runCounts);
      const fresh = built.characters.filter((row) => !alreadyShown.has(rosterNameKey(row.name)));
      if (!fresh.length) continue;
      for (const row of fresh) alreadyShown.add(rosterNameKey(row.name));
      upcoming.push({ ...built, characters:fresh });
    }
    const normalized = { name: group.name, freshness: group.freshness || null, current, next, upcoming };
    // Reflow keeps only phases with a real start — correct for scheduled
    // banners, but it would throw away announced-but-unscheduled reveals
    // (Endfield teases operators long before a window exists). Those are set
    // aside and re-attached after re-threading.
    const teased = upcoming.filter((phase) => phase.teased);
    normalized.upcoming = upcoming.filter((phase) => !phase.teased);
    // 2) Re-thread current/next/upcoming from the timeline and compute honest
    //    freshness (drops expired-as-current, merges identical windows).
    games[key] = reflowBannerGroup(normalized, now);
    if (teased.length) games[key].upcoming = [...(games[key].upcoming || []), ...teased];
    const beta = (betaDeltas[key]?.roster || [])
      .filter((row) => row?.betaStatus === 'new')
      .map((row) => normalizeBannerCharacter(rosters, key, {
        name:row.n,
        image:row.icon,
        imageSplash:row.art,
        rarity:row.r ?? row.rarity ?? null,
      }, runCounts))
      .filter(Boolean);
    if (beta.length) games[key].beta = beta;
    const roadmap = bannerRoadmapCharacters(rosters, key, group.roadmap, runCounts);
    if (roadmap.length) games[key].roadmap = roadmap;
  }
  return { updated: src.updated || src.generatedAt || null, checkedAt: src.checkedAt || null, games };
}

function sourceMeta() {
  // Only ship the build timestamp to the client. Upstream data-provider version
  // info is intentionally not surfaced in the shipped payload.
  return {
    generatedAt: new Date().toISOString(),
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
    note: 'Endfield recommendation records that still lack a local icon. Character upgrade requirements are sourced from EndfieldWiki material tables when available.',
    count: rows.length,
    missing: rows.map(({ key, ...row }) => row).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function auditCharacterPortraitAssets(cmCfg, betaDeltas) {
  const rows = [];
  const inspect = (game, channel, character) => {
    for (const field of ['icon', 'circle', 'card', 'art']) {
      const value = character?.[field];
      if (!value) continue;
      if (/^https?:\/\//i.test(value)) throw new Error(`Remote character portrait is not allowed: ${game}/${channel}/${character.n}/${field}`);
      if (!String(value).startsWith('../../Database/')) continue;
      const rel = String(value).slice('../../Database/'.length);
      if (!exists(rel)) throw new Error(`Missing character portrait: ${game}/${channel}/${character.n}/${field} -> ${rel}`);
      rows.push(`${game}/${channel}/${character.n}/${field}`);
    }
  };
  for (const [game, cfg] of Object.entries(cmCfg || {})) for (const character of cmRosterSource(cfg.roster || [])) inspect(game, 'live', character);
  for (const [game, pack] of Object.entries(betaDeltas || {})) for (const character of pack.roster || []) inspect(game, 'beta', character);
  return rows.length;
}

// Build the full roster set for a given GameData channel ('live' or 'beta'). The req-map
// builders and GameData item/avatar/light-cone reads honour GAMEDATA_CHANNEL, so flipping
// it here yields the channel-specific character materials and weapon options.
function buildRostersForChannel(channel) {
  const prev = GAMEDATA_CHANNEL;
  GAMEDATA_CHANNEL = channel;
  try {
    const rawRosters = {
      gi: buildGiRoster(),
      hsr: buildPrydwenRoster('hsr', (f) => ({ r: f.rarity, el: f.element, path: f.path }), buildHsrReqMap(), buildHsrSkillIconMap(), buildHsrGameDataSignatureMap(), buildHsrKitMap()),
      zzz: buildPrydwenRoster('zzz', (f) => ({ r: f.rarity, el: f.attribute, spec: f.specialty, tag: f.faction }), buildZzzReqMap(), null, null, buildZzzKitMap()),
      wuwa: buildPrydwenRoster('ww', (f) => ({ r: f.rarity, el: f.element, w: f.weapon }), buildWuwaReqMap(), buildWuwaSkillIconMap(), null, buildWuwaKitMap()),
      ae: buildEndfieldRoster(),
    };
    return Object.fromEntries(
      Object.entries(rawRosters).map(([key, roster]) => [key, mergeProtagonistForms(key, roster)])
    );
  } finally {
    GAMEDATA_CHANNEL = prev;
  }
}

const rosters = buildRostersForChannel('live');

const genshinTcgOverviewArt = applyGenshinTcgOverviewArt(rosters.gi);

const reportsDir = path.resolve(dbDir, 'reports');
if (!charactersOnly) {
  fs.mkdirSync(reportsDir, { recursive: true });
  const missingCharacterTitles = {
    generatedAt: new Date().toISOString(),
    note: 'Genshin titles come from GameData profile.title with wiki cache fallback. HSR subtitles use wiki How to Obtain with light-cone fallback, ZZZ subtitles use wiki Namecard names, and Wuthering Waves subtitles use wiki title. Endfield displays class. Missing entries need wiki data, class data, or a manual override.',
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
}

const cmCfg = buildCmCfg(rosters);

if (charactersOnly) {
  const header = `// ============================================================\n// Nyx - generated Character Materials data\n// Source: Database/Prydwen, Database/GameData, Database/EndfieldWiki\n// Generated by Site/tools/generate-site-data.mjs\n// ============================================================\n\n`;
  for (const key of ['gi', 'ae']) {
    fs.writeFileSync(
      path.resolve(generatedDataDir, `cm-data-${key}.js`),
      header
        + `(function(){\n`
        + `  window.CM_CFG = window.CM_CFG || {};\n`
        + `  window.CM_CFG[${JSON.stringify(key)}] = ${normalizeForJs(cmCfg[key])};\n`
        + `  window.dispatchEvent(new CustomEvent('nyx:cm-game-loaded', { detail:{ key:${JSON.stringify(key)} } }));\n`
        + `})();\n`,
      'utf8',
    );
  }
  const portraitCount = auditCharacterPortraitAssets({ gi:cmCfg.gi, ae:cmCfg.ae }, {});
  console.log('Generated character-only data: cm-data-gi.js, cm-data-ae.js');
  console.log(`Character portrait audit: ${portraitCount} local references checked`);
  process.exit(0);
}

// ----- Beta channel delta (user-approved opt-in toggle, defaults to Live) -----
// Build a second roster set off the GameData beta channel and ship only the per-character
// difference (new beta characters + characters whose upgrade materials changed). The
// client merges this delta over the live roster when the visitor flips to Beta.
const CM_BETA_GAMES = ['gi', 'hsr', 'zzz', 'wuwa'];
const cmBetaDeltas = (() => {
  const anyBeta = CM_BETA_GAMES.some((key) => betaChannelAvailable(key));
  if (!anyBeta) return {};
  const betaRosters = buildRostersForChannel('beta');
  applyGenshinTcgOverviewArt(betaRosters.gi);
  const prevChannel = GAMEDATA_CHANNEL;
  GAMEDATA_CHANNEL = 'beta';
  let betaCfg;
  try {
    betaCfg = buildCmCfg(betaRosters);
  } finally {
    GAMEDATA_CHANNEL = prevChannel;
  }
  const gamedataManifest = exists('GameData/manifest.json') ? readJson('GameData/manifest.json') : {};
  const charSig = (ch) => JSON.stringify({
    req: ch?.req ?? null,
    signatureWeaponId: ch?.signatureWeaponId ?? null,
    signatureWeaponName: ch?.signatureWeaponName ?? null,
    reliableData: ch?.reliableData ?? null,
    upcoming: ch?.upcoming ?? null,
    kit: ch?.kit?.sections ?? null,
    baseStats: ch?.baseStats ?? null,
    facts: ch?.facts ?? null,
  });
  const rowSig = (row) => JSON.stringify(row ?? null);
  const out = {};
  for (const key of CM_BETA_GAMES) {
    if (!betaChannelAvailable(key)) continue;
    const liveById = new Map((cmCfg[key]?.roster || []).map((ch) => [ch.id, ch]));
    const liveWeaponsById = new Map((cmCfg[key]?.weapons || []).map((weapon) => [weapon.id, weapon]));
    const delta = (betaCfg[key]?.roster || [])
      .filter((bc) => { const lc = liveById.get(bc.id); return !lc || charSig(bc) !== charSig(lc); })
      .map((bc) => {
        // A live row that is itself an unreleased stub (beta status / upcoming / no
        // reliable data) is not released content: its beta replacement is NEW beta
        // material and should carry the Beta flair, not a silent "changed".
        const lc = liveById.get(bc.id);
        const released = lc && !(lc.upcoming || lc.reliableData === false || (lc.status && lc.status !== 'live'));
        return { ...bc, betaStatus: released ? 'changed' : 'new' };
      });
    const weaponDelta = (betaCfg[key]?.weapons || [])
      .filter((bw) => {
        const lw = liveWeaponsById.get(bw.id);
        return !lw || rowSig(bw) !== rowSig(lw);
      });
    if (!delta.length && !weaponDelta.length) continue;
    const manifestKey = key === 'wuwa' ? 'ww' : key;
    out[key] = {
      version: gamedataManifest[manifestKey]?.latest || null,
      liveVersion: gamedataManifest[manifestKey]?.live || null,
      newCount: delta.filter((ch) => ch.betaStatus === 'new').length,
      changedCount: delta.filter((ch) => ch.betaStatus === 'changed').length,
      roster: delta,
      ...(weaponDelta.length ? { weapons: weaponDelta } : {}),
    };
  }
  return out;
})();
console.log(`Beta deltas: ${Object.entries(cmBetaDeltas).map(([k, v]) => `${k}=${v.roster.length}(+${v.newCount}/~${v.changedCount})`).join(', ') || 'none'}`);
console.log(`Character portrait audit: ${auditCharacterPortraitAssets(cmCfg, cmBetaDeltas)} local references checked`);

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
const banners = buildBannersData(rosters, cmBetaDeltas);
const genshinTcgCards = buildGenshinTcgCards();
const genshinFurniture = buildGenshinFurniture();
const genshinWonderland = buildGenshinWonderland();
const genshinShadowRealm = buildGenshinShadowRealm();
const genshinGallery = buildGenshinGallery();
const meta = sourceMeta();

fs.mkdirSync(generatedDataDir, { recursive: true });

const cmHeader = `// ============================================================\n// Nyx - generated Character Materials data\n// Source: Database/Prydwen, Database/GameData, Database/EndfieldWiki\n// Generated by Site/tools/generate-site-data.mjs\n// ============================================================\n\n`;

const cmPalettes = `const CM_RAR = {\n  6:{ a:'#ef8a5e', b:'#d05a3a', ring:'#ffb07d', glow:'rgba(255,140,90,.6)' },\n  5:{ a:'#e3b269', b:'#caa14e', ring:'#ffd98a', glow:'rgba(255,190,90,.55)' },\n  4:{ a:'#9a89ea', b:'#6f57bf', ring:'#cdb3ff', glow:'rgba(150,120,255,.5)' },\n  3:{ a:'#4f7fc4', b:'#3a5d96', ring:'#9cc2ff', glow:'rgba(90,150,255,.45)' },\n  2:{ a:'#4faf8f', b:'#3a8068', ring:'#9ce8c8', glow:'rgba(90,210,160,.4)' },\n  1:{ a:'#8a94a6', b:'#596273', ring:'#d5d9e1', glow:'rgba(170,180,200,.28)' },\n  0:{ a:'#8a94a6', b:'#596273', ring:'#d5d9e1', glow:'rgba(170,180,200,.28)' },\n  S:{ a:'#e3b269', b:'#caa14e', ring:'#ffd98a', glow:'rgba(255,190,90,.55)' },\n  A:{ a:'#9a89ea', b:'#6f57bf', ring:'#cdb3ff', glow:'rgba(150,120,255,.5)' },\n  B:{ a:'#4f7fc4', b:'#3a5d96', ring:'#9cc2ff', glow:'rgba(90,150,255,.45)' }\n};\n\nconst CM_ELEM = {\n  Pyro:'#e6614c', Hydro:'#4cc5e6', Cryo:'#9fe3ec', Electro:'#c08fe6',\n  Dendro:'#90c84a', Anemo:'#74d6b0', Geo:'#e3b552', Ice:'#9fe3ec',\n  Wind:'#74d6b0', Lightning:'#c08fe6', Fire:'#e6614c', Physical:'#d8d2ea',\n  Quantum:'#8f7fd6', Imaginary:'#e6d24c', Ether:'#e07fb0', Electric:'#c08fe6',\n  Spectro:'#e6d24c', Havoc:'#c0608f', Aero:'#74d6b0', Glacio:'#9fe3ec',\n  Fusion:'#e6614c', Frost:'#7fb0e6', Heat:'#e6614c', Nature:'#90c84a',\n  Unknown:'#b7aaff'\n};\n\n`;

fs.writeFileSync(
  path.resolve(generatedDataDir, 'cm-data.js'),
  cmHeader + cmPalettes + `const CM_CFG = window.CM_CFG || {};\nconst CM_GAME_FILES = ${normalizeForJs(Object.fromEntries(Object.keys(cmCfg).map((key) => [key, `../dist/cm-data-${key}.js`])))};\nconst CM_GAME_LABELS = ${normalizeForJs(Object.fromEntries(Object.keys(cmCfg).map((key) => [key, cmCfg[key].name])))};\nconst CM_BETA_FILES = ${normalizeForJs(Object.fromEntries(Object.keys(cmBetaDeltas).map((key) => [key, `../dist/cm-data-${key}-beta.js`])))};\nconst CM_BETA_META = ${normalizeForJs(Object.fromEntries(Object.entries(cmBetaDeltas).map(([key, pack]) => [key, { version: pack.version, liveVersion: pack.liveVersion, newCount: pack.newCount, changedCount: pack.changedCount }])))};\nconst CM_LOADS = window.__NYX_CM_LOADS || {};\nconst CM_BETA_LOADS = window.__NYX_CM_BETA_LOADS || {};\nwindow.CM_CFG_BETA = window.CM_CFG_BETA || {};\n\nfunction loadNyxCmBeta(key) {\n  if (!key || !CM_BETA_FILES[key]) return Promise.resolve(null);\n  window.CM_CFG_BETA = window.CM_CFG_BETA || {};\n  if (window.CM_CFG_BETA[key]) return Promise.resolve(window.CM_CFG_BETA[key]);\n  if (CM_BETA_LOADS[key]) return CM_BETA_LOADS[key];\n  const src = CM_BETA_FILES[key];\n  CM_BETA_LOADS[key] = new Promise((resolve, reject) => {\n    const existing = document.querySelector('script[data-cm-beta=\"' + key + '\"]');\n    if (existing) {\n      existing.addEventListener('load', () => resolve(window.CM_CFG_BETA[key] || null), { once:true });\n      existing.addEventListener('error', () => reject(new Error('Failed to load ' + src)), { once:true });\n      return;\n    }\n    const script = document.createElement('script');\n    script.src = src;\n    script.async = true;\n    script.dataset.cmBeta = key;\n    script.onload = () => resolve(window.CM_CFG_BETA[key] || null);\n    script.onerror = () => reject(new Error('Failed to load ' + src));\n    document.head.appendChild(script);\n  });\n  return CM_BETA_LOADS[key];\n}\n\nfunction loadNyxCmGame(key) {\n  if (!key || key === 'nyx') return Promise.resolve(null);\n  window.CM_CFG = window.CM_CFG || CM_CFG;\n  if (window.CM_CFG[key]) return Promise.resolve(window.CM_CFG[key]);\n  if (CM_LOADS[key]) return CM_LOADS[key];\n  const src = CM_GAME_FILES[key];\n  if (!src) return Promise.reject(new Error('Unknown character-material game: ' + key));\n  CM_LOADS[key] = new Promise((resolve, reject) => {\n    const existing = document.querySelector('script[data-cm-game=\"' + key + '\"]');\n    if (existing) {\n      existing.addEventListener('load', () => resolve(window.CM_CFG[key] || null), { once:true });\n      existing.addEventListener('error', () => reject(new Error('Failed to load ' + src)), { once:true });\n      return;\n    }\n    const script = document.createElement('script');\n    script.src = src;\n    script.async = true;\n    script.dataset.cmGame = key;\n    script.onload = () => resolve(window.CM_CFG[key] || null);\n    script.onerror = () => reject(new Error('Failed to load ' + src));\n    document.head.appendChild(script);\n  });\n  return CM_LOADS[key];\n}\n\nfunction ensureNyxCmGames(keys) {\n  return Promise.all((keys || []).map((key) => loadNyxCmGame(key)));\n}\n\nObject.assign(window, { CM_CFG, CM_RAR, CM_ELEM, CM_GAME_FILES, CM_GAME_LABELS, CM_BETA_FILES, CM_BETA_META, loadNyxCmGame, loadNyxCmBeta, ensureNyxCmGames, __NYX_CM_LOADS: CM_LOADS, __NYX_CM_BETA_LOADS: CM_BETA_LOADS });\n`,
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

for (const [key, pack] of Object.entries(cmBetaDeltas)) {
  fs.writeFileSync(
    path.resolve(generatedDataDir, `cm-data-${key}-beta.js`),
    cmHeader
      + `(function(){\n`
      + `  window.CM_CFG_BETA = window.CM_CFG_BETA || {};\n`
      + `  window.CM_CFG_BETA[${JSON.stringify(key)}] = ${normalizeForJs(pack)};\n`
      + `  window.dispatchEvent(new CustomEvent('nyx:cm-beta-loaded', { detail:{ key:${JSON.stringify(key)} } }));\n`
      + `})();\n`,
    'utf8',
  );
}

const lazyCollections = Object.fromEntries(
  Object.entries(buildLazyCollections()).map(([game, list]) => [
    game,
    (Array.isArray(list) ? list : []).map((collection) => withDatabaseReleaseDates(game, collection)),
  ]),
);
const databaseArtAudit = buildDatabaseArtAudit(lazyCollections, collections, {
  tcg:genshinTcgCards,
  furniture:genshinFurniture,
  wonderland:genshinWonderland,
  shadowRealm:genshinShadowRealm,
  gallery:genshinGallery,
});
const intentionalFallbackCount = applyDatabaseIntentionalFallbacks(lazyCollections, collections, {
  tcg:genshinTcgCards,
  furniture:genshinFurniture,
  wonderland:genshinWonderland,
  shadowRealm:genshinShadowRealm,
  gallery:genshinGallery,
});
if (intentionalFallbackCount !== databaseArtAudit.missingArtCount) {
  throw new Error(`Database fallback count mismatch: audit=${databaseArtAudit.missingArtCount}, applied=${intentionalFallbackCount}`);
}
databaseArtAudit.intentionalFallbackCount = intentionalFallbackCount;
databaseArtAudit.displayArtMissingCount = 0;
databaseArtAudit.coverage.after.intentionalFallbackCount = intentionalFallbackCount;
databaseArtAudit.coverage.after.displayArtMissingCount = 0;
const databaseAuditsDir = path.resolve(dbDir, 'Audits');
fs.mkdirSync(databaseAuditsDir, { recursive: true });
fs.writeFileSync(
  path.resolve(databaseAuditsDir, 'database-missing-art.json'),
  JSON.stringify(databaseArtAudit, null, 2),
  'utf8',
);
console.log(`Database art audit: ${databaseArtAudit.summary.map((row) => `${row.game}/${row.collection}=${row.localArtCount}/${row.generatedCount}`).join(', ')}; missing=${databaseArtAudit.missingArtCount}; quarantined=${databaseArtAudit.quarantinedCount}`);
for (const [key, cols] of Object.entries(lazyCollections)) {
  fs.writeFileSync(
    path.resolve(generatedDataDir, `db-data-${key}.js`),
    cmHeader
      + `(function(){\n`
      + `  window.NYX_DB_EXTRA = window.NYX_DB_EXTRA || {};\n`
      + `  window.NYX_DB_EXTRA[${JSON.stringify(key)}] = ${normalizeForJs({ collections: cols })};\n`
      + `  window.dispatchEvent(new CustomEvent('nyx:db-extra-loaded', { detail:{ key:${JSON.stringify(key)} } }));\n`
      + `})();\n`,
    'utf8',
  );
  console.log(`Generated db-data-${key}.js (${cols.map((c) => c.key + ':' + c.count).join(', ')})`);
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
      tcg: key === 'gi' ? genshinTcgCards : undefined,
      furniture: key === 'gi' ? genshinFurniture : undefined,
      wonderland: key === 'gi' ? genshinWonderland : undefined,
      shadowRealm: key === 'gi' ? genshinShadowRealm : undefined,
      gallery: key === 'gi' ? genshinGallery : undefined,
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
        facts: ch.facts || {},
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
          facts: form.facts || {},
        })),
      })),
    },
  ])),
};

const nyxDataFile = path.resolve(generatedDataDir, 'nyx-data.js');
let nyxDataOutput = nyxData;
if (databaseOnly && fs.existsSync(nyxDataFile)) {
  const currentText = fs.readFileSync(nyxDataFile, 'utf8');
  const currentMatch = currentText.match(/var NYX_DB = ([\s\S]*);\s*Object\.assign\(window, \{ NYX_DB \}\);/);
  if (!currentMatch) throw new Error('Could not parse the existing generated Nyx Database payload');
  const current = JSON.parse(currentMatch[1]);
  for (const [game, next] of Object.entries(nyxData.games || {})) {
    current.games ||= {};
    current.games[game] ||= {};
    for (const field of ['collections', 'tcg', 'furniture', 'wonderland', 'shadowRealm', 'gallery']) {
      if (Object.prototype.hasOwnProperty.call(next, field)) current.games[game][field] = next[field];
      else delete current.games[game][field];
    }
  }
  nyxDataOutput = current;
}
const nyxDataText = `// ============================================================\n// Nyx - generated site-wide database payload\n// Generated by Site/tools/generate-site-data.mjs\n// ============================================================\n\nvar NYX_DB = ${normalizeForJs(nyxDataOutput)};\nObject.assign(window, { NYX_DB });\n`;
if (databaseOnly) realWriteFileSync(nyxDataFile, nyxDataText, 'utf8');
else fs.writeFileSync(nyxDataFile, nyxDataText, 'utf8');

console.log(`Generated ${path.relative(root, path.resolve(generatedDataDir, 'cm-data.js'))}`);
for (const key of Object.keys(cmCfg)) {
  console.log(`Generated ${path.relative(root, path.resolve(generatedDataDir, `cm-data-${key}.js`))}`);
}
console.log(`Generated ${path.relative(root, path.resolve(generatedDataDir, 'nyx-data.js'))}`);
