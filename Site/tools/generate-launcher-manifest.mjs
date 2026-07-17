import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
export const DATABASE = path.join(ROOT, 'Database');
export const GENERATED = path.join(ROOT, 'Site', 'src', 'data', 'generated');
export const LAUNCHER_ART = path.join(GENERATED, 'launcher-art');

export const GAMES = ['gi', 'hsr', 'zzz', 'wuwa', 'ae'];
const GAME_ALIASES = new Map([
  ['gi', 'gi'], ['genshin', 'gi'], ['genshinimpact', 'gi'],
  ['hsr', 'hsr'], ['starrail', 'hsr'], ['honkaistarrail', 'hsr'],
  ['zzz', 'zzz'], ['zenless', 'zzz'], ['zenlesszonezero', 'zzz'],
  ['wuwa', 'wuwa'], ['ww', 'wuwa'], ['wutheringwaves', 'wuwa'],
  ['ae', 'ae'], ['endfield', 'ae'], ['arknightsendfield', 'ae'],
]);

const OFFICIAL_HOSTS = {
  gi: ['genshin.hoyoverse.com', 'sg-hk4e-api.hoyoverse.com', 'sg-hk4e-api.hoyolab.com'],
  hsr: ['honkai-star-rail.hoyoverse.com', 'sg-hkrpg-api.hoyoverse.com', 'sg-hkrpg-api.hoyolab.com'],
  zzz: ['zenless.hoyoverse.com', 'sg-announcement-api.hoyoverse.com'],
  wuwa: ['wutheringwaves.kurogames.com'],
  ae: ['endfield.gryphline.com'],
};

const BANNER_HISTORY_HOSTS = {
  gi: 'genshin-impact.fandom.com',
  hsr: 'honkai-star-rail.fandom.com',
  zzz: 'zenless-zone-zero.fandom.com',
  wuwa: 'wutheringwaves.fandom.com',
  ae: 'endfield.wiki.gg',
};
const BANNER_REGIONS = ['europe', 'asia', 'america', 'global'];

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const exists = (file) => fs.existsSync(file);
const norm = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const cleanText = (value, max = 160) => String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const sameCharacterName = (left, right) => left === right
  || (left.length >= 4 && right.startsWith(left))
  || (right.length >= 4 && left.startsWith(right));

function canonicalGame(value) {
  return GAME_ALIASES.get(norm(value)) ?? null;
}

function hasTrustedBannerHistoryIdentity(history, record, game) {
  if (history?.schemaVersion !== 1 || history?.game !== game || record?.game !== game) return false;
  if (typeof record?.id !== 'string' || !record.id.startsWith(`${game}:`)) return false;
  if (record?.source?.kind !== 'maintained-wiki' || !Number.isSafeInteger(record?.source?.revision) || record.source.revision <= 0) return false;
  try {
    const source = new URL(record.source.url);
    return source.protocol === 'https:'
      && !source.username
      && !source.password
      && !source.port
      && !source.hash
      && source.hostname.toLowerCase() === BANNER_HISTORY_HOSTS[game];
  } catch {
    return false;
  }
}

function hasIndependentCurrentCorroboration(group, record, window, nowMs) {
  if (record?.confirmed === true) return true;
  const current = group?.current;
  const rawSource = cleanText(current?.source, 64);
  const freshnessSource = cleanText(group?.freshness?.source, 64);
  const checkedMs = timestamp(iso(group?.freshness?.lastSuccessfulFetch ?? group?.freshness?.checkedAt));
  const startMs = timestamp(iso(window?.start));
  const rawEndMs = timestamp(iso(current?.end));
  if (group?.freshness?.status !== 'fresh'
    || !rawSource
    || rawSource !== freshnessSource
    || /maintained[- ]?wiki|fandom|wiki\.gg/i.test(rawSource)
    || checkedMs == null
    || startMs == null
    || checkedMs < startMs
    || checkedMs > nowMs
    || rawEndMs == null
    || nowMs >= rawEndMs) return false;
  const rawNames = new Set((current?.characters ?? []).map((entry) => cleanText(entry?.name ?? entry, 80)).filter(Boolean));
  return (record?.featured ?? []).some((entry) => entry?.primary === true
    && typeof entry?.name === 'string'
    && rawNames.has(cleanText(entry.name, 80)));
}

function iso(value) {
  if (value == null || value === '') return null;
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function timestamp(value) {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

function isAllowedHost(host, allowed) {
  return allowed.includes(host);
}

/** Return an official, safe URL or null. Never ships provider/source URLs. */
export function officialUrl(value, game) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
    if (!isAllowedHost(parsed.hostname.toLowerCase(), OFFICIAL_HOSTS[game] ?? [])) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function dimensions(bytes, mime) {
  if (mime === 'image/png' && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mime !== 'image/webp' || bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = bytes.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (kind === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L' && bytes.length >= 25 && bytes[21] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { width: 1 + (bits >>> 8 & 0x3fff), height: 1 + (bits >>> 22 & 0x3fff) };
  }
  return null;
}

function mimeFor(file, bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  const ext = path.extname(file).toLowerCase();
  return ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : null;
}

function safeAssetPath(relative, db = DATABASE) {
  if (typeof relative !== 'string' || !relative || /^https?:/i.test(relative)) return null;
  const clean = relative.replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  const candidates = [
    { full: path.resolve(ROOT, clean), path: clean },
    { full: path.resolve(db, clean), path: path.relative(ROOT, path.resolve(db, clean)).replace(/\\/g, '/') },
  ];
  const found = candidates.find((candidate) => candidate.full.startsWith(`${ROOT}${path.sep}`) && exists(candidate.full) && fs.statSync(candidate.full).isFile());
  return found ?? null;
}

function inspectAsset(relative, source, variantId, placement = 'contain', db = DATABASE) {
  const resolved = safeAssetPath(relative, db);
  if (!resolved) return null;
  const bytes = fs.readFileSync(resolved.full);
  const mime = mimeFor(resolved.full, bytes);
  if (!mime) return null;
  const size = bytes.length;
  const dim = dimensions(bytes, mime);
  if (!dim || !dim.width || !dim.height || size <= 0) return null;
  const placementValue = typeof placement === 'string'
    ? { anchor: 'center', fit: placement, x: 0.5, y: 0.5 }
    : {
        anchor: 'center',
        fit: placement?.fit === 'cover' ? 'cover' : 'contain',
        x: Math.max(0, Math.min(1, Number(placement?.x) || 0.5)),
        y: Math.max(0, Math.min(1, Number(placement?.y) || 0.5)),
      };
  return {
    id: variantId,
    source,
    path: `/${resolved.path}`,
    url: null,
    mime,
    size,
    dimensions: dim,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    transparentBounds: { left: 0, top: 0, right: dim.width, bottom: dim.height },
    placement: placementValue,
  };
}

function rosterEntry(rosters, game, name) {
  const wanted = norm(name);
  return (rosters[game] ?? []).find((entry) => norm(entry?.name) === wanted || norm(entry?.displayName) === wanted || norm(entry?.id) === wanted) ?? null;
}

function parseRarity(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const found = String(value ?? '').match(/[3-6]|[S]/i);
  if (!found) return null;
  return found[0].toUpperCase() === 'S' ? 5 : Number(found[0]);
}

function parseDebut(entry) {
  for (const value of [entry?.debut, entry?.release, entry?.releaseDate, entry?.profile?.release_date]) {
    const parsed = iso(value);
    if (parsed) return parsed;
  }
  return null;
}

function loadBannerDebuts(db = DATABASE) {
  const byGame = {};
  for (const game of GAMES) {
    const file = path.join(db, 'BannerHistory', `${game}.json`);
    const debuts = new Map();
    if (exists(file)) {
      const history = readJson(file);
      for (const record of history?.records ?? []) {
        if (!hasTrustedBannerHistoryIdentity(history, record, game) || record?.confirmed !== true) continue;
        if (record?.bannerType !== 'character') continue;
        const windows = Object.values(record?.windowsByRegion ?? {});
        const starts = windows.map((window) => iso(window?.start)).filter(Boolean).sort();
        const start = starts[0];
        if (!start) continue;
        for (const featured of record?.featured ?? []) {
          const name = norm(featured?.name);
          if (name && (!debuts.has(name) || start < debuts.get(name))) debuts.set(name, start);
        }
      }
    }
    byGame[game] = debuts;
  }
  return byGame;
}

function sourcedDebut(debuts, name) {
  const wanted = norm(name);
  return [...(debuts ?? new Map()).entries()]
    .filter(([candidate]) => sameCharacterName(candidate, wanted))
    .map(([, start]) => start)
    .sort()[0] ?? null;
}

function isLimited(entry) {
  if (typeof entry?.limited === 'boolean') return entry.limited;
  if (typeof entry?.isLimited === 'boolean') return entry.isLimited;
  if (typeof entry?.facts?.limited === 'boolean') return entry.facts.limited;
  return null;
}

function loadRosters(db = DATABASE) {
  const load = (file) => exists(path.join(db, file)) ? readJson(path.join(db, file)) : [];
  return {
    gi: load('GameData/gi/live/characters.json'),
    hsr: load('GameData/hsr/live/characters.json'),
    zzz: load('GameData/zzz/live/agents.json'),
    wuwa: load('GameData/ww/live/characters.json'),
    ae: load('EndfieldWiki/endfield/characters.json'),
  };
}

function loadPrydwen(db = DATABASE) {
  const load = (file) => exists(path.join(db, file)) ? readJson(path.join(db, file)) : [];
  return {
    hsr: load('Prydwen/hsr/characters.json'),
    zzz: load('Prydwen/zzz/characters.json'),
    wuwa: load('Prydwen/ww/characters.json'),
  };
}

function allFiles(dir) {
  if (!exists(dir)) return [];
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...allFiles(full));
    else out.push(full);
  }
  return out;
}

function approvedGenshinPortraits(character, db = DATABASE) {
  const manifestFile = path.join(db, 'LauncherArt', 'gi', 'portraits.json');
  if (!exists(manifestFile)) return [];
  try {
    const manifest = readJson(manifestFile);
    const wanted = norm(character?.name ?? character?.displayName ?? character?.id);
    const entry = Object.entries(manifest?.characters ?? {})
      .find(([name]) => norm(name) === wanted)?.[1];
    return Array.isArray(entry?.files) ? entry.files : [];
  } catch {
    return [];
  }
}

function localVariants(game, character, roster, db = DATABASE, prydwen = {}) {
  const assets = character?.assets ?? {};
  const art = character?.art ?? {};
  const id = String(character?.id ?? norm(character?.name));
  const variants = [];
  const add = (relative, source, suffix, placement = 'contain') => {
    const item = inspectAsset(relative, source, `${id}-${suffix}`, placement, db);
    if (item && !variants.some((existing) => existing.sha256 === item.sha256)) variants.push(item);
  };
  if (game === 'gi') {
    const portraits = [
      ...approvedGenshinPortraits(character, db),
      ...(character?.launcherPortraits ?? character?.portraitVariants ?? []),
    ];
    for (const candidate of portraits) add(candidate?.path ?? candidate, 'portrait', `portrait-${variants.length}`, { fit: 'contain', x: 0.7, y: 0.5 });
    if (!variants.length) add(assets.gacha, 'official-default', 'gacha', { fit: 'contain', x: 0.68, y: 0.5 });
  } else if (game === 'hsr') {
    for (const candidate of character?.outfitPortraits ?? character?.portraitVariants ?? []) add(candidate?.path ?? candidate, 'outfit', `outfit-${variants.length}`, { fit: 'contain', x: 0.72, y: 0.5 });
    if (!variants.length) add(assets.drawCard, 'draw-card', 'draw-card', { fit: 'contain', x: 0.72, y: 0.5 });
    if (!variants.length) {
      for (const candidate of [art.card, art.full]) add(candidate, 'local-fallback', `fallback-${variants.length}`, 'contain');
    }
  } else if (game === 'zzz') {
    const icon = assets.icon ?? assets.partnerIcon ?? assets.roleIcon;
    const match = String(icon ?? '').match(/IconRole(?:Circle)?(\d+)/i);
    const files = match ? allFiles(path.join(db, 'GameData/zzz/assets')).filter((file) => !file.includes(`${path.sep}items${path.sep}`) && new RegExp(`^IconRole${match[1]}(?:_[^.]*)?\\.(?:webp|png)$`, 'i').test(path.basename(file))) : [];
    for (const file of files.sort()) add(path.relative(db, file), 'icon-role', `icon-${variants.length}`, { fit: 'contain', x: 0.74, y: 0.52 });
    if (!variants.length) add(icon, 'local-fallback', 'icon', 'contain');
  } else if (game === 'wuwa') {
    add(assets.portrait, 'activity-role', 'activity', { fit: 'contain', x: 0.72, y: 0.52 });
    if (!variants.length) add(assets.icon, 'local-fallback', 'icon', 'contain');
  } else if (game === 'ae') {
    add(art?.splash?.path ?? art?.splash, 'splash', 'splash', { fit: 'contain', x: 0.72, y: 0.5 });
    if (!variants.length) add(art?.banner?.path ?? art?.banner, 'local-fallback', 'banner', 'contain');
    if (!variants.length) add(art?.icon?.path ?? art?.icon, 'local-fallback', 'icon', 'contain');
  }
  // Missing source-specific art is represented by an empty variant list. The
  // runtime can retain its last-known-good/user-selected art without shipping
  // provider paths or third-party identifiers.
  return variants;
}

function normalizePhase(group, phase, index) {
  const start = iso(phase?.start);
  const end = iso(phase?.end);
  return {
    phase: cleanText(phase?.phase, 48) || null,
    start,
    end,
    startMs: timestamp(start),
    endMs: timestamp(end),
    index,
    characters: Array.isArray(phase?.characters) ? phase.characters : [],
    sourceRegion: BANNER_REGIONS.includes(phase?._sourceRegion) ? phase._sourceRegion : null,
    uncertain: !start || !end || timestamp(end) <= timestamp(start),
  };
}

function chooseCurrent(group, nowMs) {
  const freshnessMessage = String(group?.freshness?.message ?? '');
  if (!group || (group.freshness && group.freshness.status !== 'fresh') || /stale|failed|preserved|uncertain/i.test(freshnessMessage)) return { phase: null, reason: 'stale' };
  const phases = [group.current, group.next, ...(group.upcoming ?? [])].map((phase, index) => normalizePhase(group, phase, index));
  const active = phases.filter((phase) => !phase.uncertain && phase.startMs <= nowMs && nowMs < phase.endMs);
  if (!active.length) return { phase: null, reason: 'expired-or-not-started' };
  if (active.length > 1) return { phase: null, reason: 'overlap' };
  // An open-ended/unknown phase that could also cover now makes the group
  // uncertain. Expired unknown records do not block a known next phase.
  const uncertainCoveringNow = phases.some((phase) => phase.uncertain && phase.endMs != null && phase.endMs > nowMs && phase.startMs == null);
  if (uncertainCoveringNow) return { phase: null, reason: 'uncertain' };
  return { phase: active[0], reason: null };
}

function stableCharacterId(game, entry, roster) {
  return String(roster?.id ?? entry?.id ?? norm(entry?.name)).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

function buildCharacter(game, raw, rosters, prydwen, db, debuts) {
  const name = cleanText(raw?.name ?? raw, 80);
  if (!name) return null;
  const roster = rosterEntry(rosters, game, name);
  const provider = roster ? null : rosterEntry(prydwen, game, name);
  const record = roster ?? provider ?? {};
  const rarity = parseRarity(raw?.rarity ?? record.rarity ?? record.facts?.rarity);
  const debut = parseDebut({ ...record, ...raw }) ?? sourcedDebut(debuts?.[game], name);
  const limited = typeof raw?.limited === 'boolean' ? raw.limited : isLimited(record);
  const variants = localVariants(game, record, roster, db, provider);
  const id = stableCharacterId(game, raw, record);
  return { id, name, rarity, limited, debut, variants };
}

function selectCharacter(characters) {
  if (!characters.length) return { selected: null, reason: 'no-characters' };
  const sorted = characters.map((character, index) => ({ character, index })).sort((left, right) => {
    const a = left.character;
    const b = right.character;
    const rarity = (b.rarity ?? -1) - (a.rarity ?? -1);
    if (rarity) return rarity;
    if (a.limited === true && b.limited !== true) return -1;
    if (b.limited === true && a.limited !== true) return 1;
    if (a.debut && b.debut && a.debut !== b.debut) return b.debut.localeCompare(a.debut);
    return a.id.localeCompare(b.id);
  });
  const selected = sorted[0].character;
  const sameRarity = characters.filter((entry) => (entry.rarity ?? -1) === (selected.rarity ?? -1));
  const sameRarityWithDebut = sameRarity.filter((entry) => entry.debut);
  const reason = selected.limited === true && sameRarity.some((entry) => entry.limited !== true)
    ? 'limited'
    : sameRarityWithDebut.length > 1
      ? selected.limited === true ? 'newer-limited-debut' : 'newer-debut'
      : sameRarity.length > 1 ? 'stable-identity' : 'highest-rarity';
  return { selected, reason };
}

function loadEvents(db = DATABASE) {
  const files = { gi: 'Events/gi.json', hsr: 'Events/hsr.json', zzz: 'Events/zzz.json', wuwa: 'Events/wuwa.json', ae: 'Events/endfield.json' };
  return Object.fromEntries(GAMES.map((game) => [game, exists(path.join(db, files[game])) ? readJson(path.join(db, files[game])) : { events: [] }]));
}

export function applySourcedBannerWindows(banners, db = DATABASE, nowMs = Date.now()) {
  const copy = structuredClone(banners ?? { games: [] });
  for (const group of copy.games ?? []) {
    const game = canonicalGame(group?.id ?? group?.slug ?? group?.name);
    if (!game) continue;
    const historyFile = path.join(db, 'BannerHistory', `${game}.json`);
    if (!fs.existsSync(historyFile)) continue;
    const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    const corroboratingGroup = structuredClone(group);
    // A present history file is the only authority for launcher current-state
    // decisions. Invalid identity/provenance must not fall back to raw banner
    // timestamps from another provider.
    group.current = null;
    group.next = null;
    group.upcoming = [];
    const trusted = (history.records ?? []).filter((record) => hasTrustedBannerHistoryIdentity(history, record, game));
    let region = null;
    let active = [];
    for (const candidateRegion of BANNER_REGIONS) {
      const candidateActive = [];
      for (const record of trusted) {
        if (record?.bannerType !== 'character' || record?.permanent === true || !record?.category) continue;
        const window = record.windowsByRegion?.[candidateRegion];
        const start = iso(window?.start);
        const end = iso(window?.end);
        if (!(timestamp(start) <= nowMs && nowMs < timestamp(end))) continue;
        if (!hasIndependentCurrentCorroboration(corroboratingGroup, record, window, nowMs)) continue;
        const characters = (record.featured ?? [])
          .filter((entry) => entry?.primary === true && norm(entry?.name))
          .map((entry) => ({ name: cleanText(entry.name, 80), rarity: parseRarity(entry.rarity), limited: true }));
        if (!characters.length) continue;
        candidateActive.push({ recordId: record.id, category: record.category, version: cleanText(record.version, 48) || null, start, end, characters });
      }
      if (candidateActive.length) {
        region = candidateRegion;
        active = candidateActive;
        break;
      }
    }
    if (!region || !active.length) continue;
    const versions = new Set(active.map((entry) => entry.version).filter(Boolean));
    if (active.some((entry) => !entry.version) || versions.size !== 1) continue;
    const start = new Date(Math.max(...active.map((entry) => timestamp(entry.start)))).toISOString();
    const end = new Date(Math.min(...active.map((entry) => timestamp(entry.end)))).toISOString();
    if (timestamp(end) <= timestamp(start) || !(timestamp(start) <= nowMs && nowMs < timestamp(end))) continue;
    const characters = [];
    for (const channel of active.sort((left, right) => left.recordId.localeCompare(right.recordId))) {
      for (const character of channel.characters) {
        if (!characters.some((entry) => sameCharacterName(norm(entry.name), norm(character.name)))) characters.push(character);
      }
    }
    group.current = {
      phase: [...versions][0],
      start,
      end,
      characters,
      _sourcedWindow: true,
      _sourceRegion: region,
      _sourceChannels: active.map((entry) => ({ recordId: entry.recordId, category: entry.category })),
    };
    // Raw next/upcoming timestamps are not trusted for current-state decisions.
    // Only independently identified, complete history records above can enter
    // the current composite.
  }
  return copy;
}

function buildNews(game, events) {
  const rows = Array.isArray(events?.events) ? events.events : [];
  return rows.map((event) => {
    const url = officialUrl(event?.source?.url, game);
    return { id: cleanText(event.id, 100), title: cleanText(event.title, 180), type: cleanText(event.type, 32) || 'event', start: iso(event.start), end: iso(event.end), url };
  }).filter((event) => event?.id && event.title).sort((a, b) => (b.start ?? '').localeCompare(a.start ?? '') || a.id.localeCompare(b.id)).slice(0, 8);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function manifestRevision(manifest) {
  const games = structuredClone(manifest.games ?? {});
  for (const game of Object.values(games)) {
    if (game?.current?.remaining) delete game.current.remaining.durationSeconds;
  }
  const payload = { schemaVersion: manifest.schemaVersion, health: { status: 'pending', games: manifest.health.games }, games };
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

/**
 * Copy only the current-phase assets referenced by a manifest into the small,
 * packageable launcher-art directory. Files are content-addressed so the
 * shipped manifest never needs to expose a provider/database path.
 */
export async function mirrorLauncherArt(manifest, {
  outputDir = LAUNCHER_ART,
  sourceRoot = ROOT,
  publicBaseUrl = 'https://pengo.gg/dist/launcher-art',
} = {}) {
  if (!manifest || typeof manifest !== 'object') throw new TypeError('A launcher manifest is required.');
  const root = path.resolve(sourceRoot);
  const destination = path.resolve(outputDir);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  const processed = new Map();
  const seenAssets = new Set();
  for (const game of Object.values(manifest.games ?? {})) {
    const current = game?.current;
    if (!current) continue;
    const assets = [
      ...(current.variants ?? []),
      ...(current.characters ?? []).flatMap((character) => character.variants ?? []),
    ];
    for (const asset of assets) {
      if (!asset || seenAssets.has(asset)) continue;
      seenAssets.add(asset);
      if (typeof asset.path !== 'string' || !asset.path.startsWith('/Database/')) {
        throw new Error(`Launcher art source is not a local Database path: ${asset?.path ?? '<missing>'}`);
      }
      const relative = asset.path.slice(1).replace(/\//g, path.sep);
      const source = path.resolve(root, relative);
      if (!source.startsWith(`${root}${path.sep}`) || !exists(source) || !fs.statSync(source).isFile()) {
        throw new Error(`Launcher art source is missing: ${asset.path}`);
      }
      const bytes = fs.readFileSync(source);
      const actual = crypto.createHash('sha256').update(bytes).digest('hex');
      if (actual !== asset.sha256 || bytes.length !== asset.size) throw new Error(`Launcher art source metadata mismatch: ${asset.path}`);
      let output = processed.get(source);
      if (!output) {
        const converted = await sharp(bytes, { animated: false, failOn: 'error', limitInputPixels: 4096 * 4096 })
          .rotate()
          .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 })
          .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 92, alphaQuality: 100, effort: 5, smartSubsample: true })
          .toBuffer({ resolveWithObject: true });
        if (!converted.info.width || !converted.info.height || converted.data.length <= 0) throw new Error(`Launcher art conversion failed: ${asset.path}`);
        const hash = crypto.createHash('sha256').update(converted.data).digest('hex');
        const filename = `${hash}.webp`;
        fs.writeFileSync(path.join(destination, filename), converted.data);
        output = { filename, hash, size: converted.data.length, width: converted.info.width, height: converted.info.height };
        processed.set(source, output);
      }
      asset.mime = 'image/webp';
      asset.size = output.size;
      asset.dimensions = { width: output.width, height: output.height };
      asset.sha256 = output.hash;
      asset.transparentBounds = { left: 0, top: 0, right: output.width, bottom: output.height };
      const filename = output.filename;
      asset.path = `/launcher-art/${filename}`;
      asset.url = `${publicBaseUrl}/${filename}`;
    }
  }
  manifest.revision = manifestRevision(manifest);
  return { manifest, outputDir: destination, count: processed.size, bytes: [...processed.values()].reduce((total, item) => total + item.size, 0) };
}

export function buildManifest({ banners, events, rosters, prydwen = {}, debuts = {}, now = Date.now(), generatedAt = new Date(now).toISOString(), db = DATABASE } = {}) {
  const source = banners ?? { games: [] };
  const groups = new Map();
  for (const group of Array.isArray(source.games) ? source.games : []) {
    const game = canonicalGame(group?.id ?? group?.slug ?? group?.name);
    if (game && !groups.has(game)) groups.set(game, group);
  }
  const games = {};
  const gameHealth = {};
  for (const game of GAMES) {
    const group = groups.get(game);
    const current = chooseCurrent(group, now);
    const chars = current.phase ? (current.phase.characters.map((entry) => buildCharacter(game, entry, rosters ?? {}, prydwen[game] ?? [], db, debuts)).filter(Boolean)) : [];
    const selected = current.phase ? selectCharacter(chars) : { selected: null, reason: current.reason ?? 'no-current-phase' };
    const news = buildNews(game, events?.[game]);
    const healthStatus = group && current.phase && news.length ? 'ok' : group ? 'degraded' : 'missing';
    gameHealth[game] = { status: healthStatus, reason: current.reason ?? null, newsCount: news.length };
    games[game] = {
      game,
      region: current.phase?.sourceRegion ?? 'global',
      current: current.phase ? {
        phase: current.phase.phase,
        start: current.phase.start,
        end: current.phase.end,
        remaining: { startsAt: current.phase.start, endsAt: current.phase.end, durationSeconds: Math.max(0, Math.floor((current.phase.endMs - now) / 1000)) },
        characters: chars,
        selectedCharacter: selected.selected,
        selectedCharacterId: selected.selected?.id ?? null,
        selectionReason: selected.reason,
        variants: chars.flatMap((character) => character.variants),
      } : null,
      news,
    };
  }
  // Revision is content-addressed and deliberately excludes the clock. A
  // refresh with unchanged source data must keep variant selection stable.
  const payload = { schemaVersion: 1, health: { status: 'pending', games: gameHealth }, games };
  const revision = manifestRevision(payload);
  const statuses = Object.values(gameHealth).map((entry) => entry.status);
  const status = statuses.every((entry) => entry === 'ok') ? 'ok' : statuses.some((entry) => entry === 'ok' || entry === 'degraded') ? 'degraded' : 'unavailable';
  return { schemaVersion: 1, revision, generatedAt, health: { status, games: gameHealth }, games };
}

export function loadManifestInputs({ db = DATABASE, bannersFile = path.join(db, 'Banners', 'banners.json'), events = loadEvents(db), rosters = loadRosters(db), prydwen = loadPrydwen(db), debuts = loadBannerDebuts(db), now = Date.now() } = {}) {
  return { banners: applySourcedBannerWindows(readJson(bannersFile), db, now), events, rosters, prydwen, debuts, db };
}

async function cli() {
  const atArg = process.argv.find((arg) => arg.startsWith('--at='));
  const at = atArg ? Date.parse(atArg.slice(5)) : Date.now();
  if (!Number.isFinite(at)) throw new Error('Invalid --at timestamp');
  const generatedArg = process.argv.find((arg) => arg.startsWith('--generated-at='));
  const generatedAt = generatedArg ? new Date(generatedArg.slice(15)).toISOString() : new Date(at).toISOString();
  const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
  const output = outputArg ? path.resolve(outputArg.slice(9)) : path.join(GENERATED, 'launcher-banners-v1.json');
  const manifest = buildManifest({ ...loadManifestInputs({ now: at }), now: at, generatedAt });
  const artArg = process.argv.find((arg) => arg.startsWith('--art-output='));
  const artOutput = artArg ? path.resolve(artArg.slice(13)) : LAUNCHER_ART;
  const mirrored = await mirrorLauncherArt(manifest, { outputDir: artOutput });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`launcher manifest: ${output} (${manifest.revision}); art: ${mirrored.count} files (${mirrored.bytes} bytes)\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  cli().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
