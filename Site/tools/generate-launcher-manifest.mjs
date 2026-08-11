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
const REMOTE_WUWA_ICON_HOST = 'static.nanoka.cc';
export const MAX_REMOTE_LAUNCHER_ART_BYTES = 2 * 1024 * 1024;
const PREMIUM_CURRENCY = {
  gi: { name: 'Primogems', aliases: ['primogem', 'primogems'] },
  hsr: { name: 'Stellar Jade', aliases: ['stellar jade'] },
  zzz: { name: 'Polychrome', aliases: ['polychrome'] },
  wuwa: { name: 'Astrite', aliases: ['astrite'] },
  ae: { name: 'Oroberyl', aliases: ['oroberyl'] },
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const exists = (file) => fs.existsSync(file);
const norm = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const cleanText = (value, max = 160) => String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const sameCharacterName = (left, right) => left === right
  || (left.length >= 4 && right.startsWith(left))
  || (right.length >= 4 && left.startsWith(right));
const sameBannerCharacter = (game, left, right) => {
  const normalizedLeft = norm(left);
  const normalizedRight = norm(right);
  return game === 'wuwa' ? normalizedLeft === normalizedRight : sameCharacterName(normalizedLeft, normalizedRight);
};

function canonicalGame(value) {
  return GAME_ALIASES.get(norm(value)) ?? null;
}

function premiumAmount(game, reward) {
  const text = String(reward ?? '').replace(/,/g, ' ');
  for (const alias of PREMIUM_CURRENCY[game]?.aliases ?? []) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const pattern of [
      new RegExp(`(\\d{1,6})\\s*${escaped}s?\\b`, 'i'),
      new RegExp(`${escaped}s?\\s*(?:x|×|:)??\\s*(\\d{1,6})\\b`, 'i'),
    ]) {
      const match = text.match(pattern);
      if (match) return Number(match[1]);
    }
  }
  return 0;
}

function loadPremiumCodes(db = DATABASE) {
  const file = path.join(db, 'Codes', 'codes.json');
  if (!exists(file)) return new Map();
  const source = readJson(file);
  const result = new Map();
  for (const group of Array.isArray(source?.games) ? source.games : []) {
    const game = canonicalGame(group?.slug ?? group?.name ?? group?.icon);
    if (!game) continue;
    const codes = (Array.isArray(group?.codes) ? group.codes : [])
      .filter((entry) => entry?.premium === true && /^[-_A-Za-z0-9]{1,64}$/.test(entry?.code ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(entry?.added ?? ''))
      .sort((left, right) => String(right.added).localeCompare(String(left.added)) || String(right.firstSeen ?? '').localeCompare(String(left.firstSeen ?? '')) || String(left.code).localeCompare(String(right.code)))
      .slice(0, 5)
      .map((entry) => {
        const amount = premiumAmount(game, entry.rewards ?? entry.reward);
        return {
          code: entry.code,
          added: entry.added,
          amount,
          currency: amount > 0 ? PREMIUM_CURRENCY[game].name : '',
        };
      });
    result.set(game, codes);
  }
  return result;
}

function hasTrustedBannerHistoryIdentity(history, record, game) {
  if (history?.schemaVersion !== 1 || history?.game !== game || record?.game !== game) return false;
  if (typeof record?.id !== 'string' || !record.id.startsWith(`${game}:`)) return false;
  try {
    const source = new URL(record.source.url);
    const safeUrl = source.protocol === 'https:'
      && !source.username
      && !source.password
      && !source.port
      && !source.hash;
    if (!safeUrl) return false;
    if (record?.source?.kind === 'maintained-wiki') {
      return Number.isSafeInteger(record?.source?.revision)
        && record.source.revision > 0
        && source.hostname.toLowerCase() === BANNER_HISTORY_HOSTS[game];
    }
    const officialRevision = String(record?.source?.revision || '');
    return game === 'wuwa'
      && record?.source?.kind === 'official-latest'
      && /^\d+$/.test(officialRevision)
      && source.hostname.toLowerCase() === 'wutheringwaves.kurogames.com'
      && source.pathname === `/en/main/news/detail/${officialRevision}`;
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
  if (found) return found;

  // Prydwen can expose the same CDN image under two names. Its downloader
  // stores one copy, while a detail record may retain the other name. The
  // source hash in both names is authoritative, so accept one unambiguous
  // sibling with that exact hash instead of treating verified local art as
  // missing.
  if (!/(?:^|\/)Prydwen\//i.test(clean)) return null;
  const hashedName = path.basename(clean).match(/-([a-f0-9]{12})(\.[a-z0-9]+)$/i);
  if (!hashedName) return null;
  const [, sourceHash, extension] = hashedName;
  const fallbacks = [];
  for (const candidate of candidates) {
    const dir = path.dirname(candidate.full);
    if (!dir.startsWith(`${ROOT}${path.sep}`) || !exists(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.toLowerCase().endsWith(`-${sourceHash.toLowerCase()}${extension.toLowerCase()}`)) continue;
      const full = path.resolve(dir, name);
      if (!full.startsWith(`${ROOT}${path.sep}`) || !fs.statSync(full).isFile()) continue;
      fallbacks.push({ full, path: path.relative(ROOT, full).replace(/\\/g, '/') });
    }
  }
  return fallbacks.length === 1 ? fallbacks[0] : null;
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

function remoteWuwaIconUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:'
      || parsed.hostname.toLowerCase() !== REMOTE_WUWA_ICON_HOST
      || parsed.username
      || parsed.password
      || parsed.port
      || parsed.search
      || !/^\/assets\/ww\/.+\.(?:webp|png|jpe?g)$/i.test(parsed.pathname)) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function fetchRemoteLauncherArt(sourceUrl, {
  fetchImpl = globalThis.fetch,
  maxBytes = MAX_REMOTE_LAUNCHER_ART_BYTES,
} = {}) {
  const approvedUrl = remoteWuwaIconUrl(sourceUrl);
  if (!approvedUrl || approvedUrl !== sourceUrl) throw new Error(`Launcher art source URL is not approved: ${sourceUrl}`);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError('Launcher art byte limit must be a positive safe integer');
  const response = await fetchImpl(approvedUrl, {
    headers: { accept: 'image/webp,image/png,image/jpeg' },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response?.ok) throw new Error(`Launcher art source request failed (${response?.status ?? 'unknown'}): ${approvedUrl}`);
  if (response.redirected === true || response.url !== approvedUrl) {
    throw new Error(`Launcher art source redirected away from its approved URL: ${approvedUrl}`);
  }
  const contentType = String(response.headers?.get?.('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (!['image/webp', 'image/png', 'image/jpeg'].includes(contentType)) {
    throw new Error(`Launcher art source returned an unsupported MIME type: ${contentType || '<missing>'}`);
  }
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Launcher art source exceeds ${maxBytes} bytes: ${approvedUrl}`);
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error(`Launcher art source did not provide a bounded response stream: ${approvedUrl}`);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel('launcher art byte limit exceeded');
        throw new Error(`Launcher art source exceeds ${maxBytes} bytes: ${approvedUrl}`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  if (!total) throw new Error(`Launcher art source is empty: ${approvedUrl}`);
  return Buffer.concat(chunks, total);
}

function remoteCharacterIcon(game, raw, variantId) {
  if (game !== 'wuwa') return null;
  const sourceUrl = remoteWuwaIconUrl(raw?.image ?? raw?.icon);
  if (!sourceUrl) return null;
  return {
    id: variantId,
    source: 'character-icon',
    sourceUrl,
    placement: { anchor: 'center', fit: 'cover', x: 0.5, y: 0.5 },
  };
}

function iconFileKey(value) {
  const text = String(value ?? '').replace(/\\/g, '/');
  const file = text.slice(text.lastIndexOf('/') + 1);
  return file.replace(/\.[^.]+$/, '').toLowerCase();
}

function rosterEntry(rosters, game, name, sourceIcon = null) {
  const wanted = norm(name);
  const rows = rosters[game] ?? [];
  if (game === 'wuwa') {
    const sourceKey = iconFileKey(sourceIcon);
    const bySource = sourceKey
      ? rows.find((entry) => iconFileKey(entry?.assets?.icon) === sourceKey)
      : null;
    if (bySource) return bySource;
  }
  const exact = rows.find((entry) => norm(entry?.name) === wanted || norm(entry?.displayName) === wanted || norm(entry?.id) === wanted);
  if (exact || game === 'wuwa') return exact ?? null;
  return rows.find((entry) => sameCharacterName(norm(entry?.name ?? entry?.displayName), wanted)) ?? null;
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
  const rows = [...(debuts ?? new Map()).entries()];
  const exact = rows.filter(([candidate]) => candidate === wanted);
  return (exact.length ? exact : rows.filter(([candidate]) => sameCharacterName(candidate, wanted)))
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
    add(assets.gacha, 'splash', 'splash', { fit: 'cover', x: 0.68, y: 0.5 });
  } else if (game === 'hsr') {
    add(prydwen?.art?.full ?? prydwen?.art?.card, 'splash', 'splash', { fit: 'contain', x: 0.72, y: 0.5 });
    if (!variants.length) add(assets.drawCard, 'splash', 'draw-card', { fit: 'contain', x: 0.72, y: 0.5 });
  } else if (game === 'zzz') {
    add(prydwen?.art?.full ?? prydwen?.art?.card, 'splash', 'splash', { fit: 'contain', x: 0.74, y: 0.52 });
    const icon = assets.icon ?? assets.partnerIcon ?? assets.roleIcon;
    if (!variants.length) add(icon, 'splash-fallback', 'icon', 'contain');
  } else if (game === 'wuwa') {
    add(prydwen?.art?.full ?? prydwen?.art?.card, 'splash', 'splash', { fit: 'contain', x: 0.72, y: 0.52 });
    if (!variants.length) add(assets.portrait, 'splash-fallback', 'activity', { fit: 'contain', x: 0.72, y: 0.52 });
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

function localCharacterIcon(game, character, db = DATABASE) {
  const assets = character?.assets ?? {};
  const art = character?.art ?? {};
  const id = String(character?.id ?? norm(character?.name));
  const relative = game === 'gi'
    ? assets.circle ?? assets.icon
    : game === 'hsr'
      ? assets.roundIcon ?? assets.avatar
      : game === 'zzz'
        ? assets.partnerIcon ?? assets.icon
        : game === 'wuwa'
          ? assets.icon ?? assets.portrait
          : art?.icon?.path ?? art?.icon ?? art?.portrait?.path ?? art?.portrait;
  return inspectAsset(relative, 'character-icon', `${id}-icon`, { fit: 'cover', x: 0.5, y: 0.5 }, db);
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
  const hasTrustedSourcedWindow = group?.current?._sourcedWindow === true;
  if (!group
    || (!hasTrustedSourcedWindow && group.freshness && group.freshness.status !== 'fresh')
    || (!hasTrustedSourcedWindow && /stale|failed|preserved|uncertain/i.test(freshnessMessage))) {
    return { phase: null, reason: 'stale' };
  }
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
  const roster = rosterEntry(rosters, game, name, raw?.image ?? raw?.icon);
  const provider = rosterEntry({ [game]: prydwen }, game, name);
  const record = roster ?? provider ?? {};
  const rarity = parseRarity(raw?.rarity ?? record.rarity ?? record.facts?.rarity);
  const debut = parseDebut({ ...record, ...raw }) ?? sourcedDebut(debuts?.[game], name);
  const limited = typeof raw?.limited === 'boolean' ? raw.limited : isLimited(record);
  const variants = localVariants(game, record, roster, db, provider ?? {});
  const id = stableCharacterId(game, raw, record);
  // A local file has already passed identity, path, MIME, and dimension checks.
  // Use the reviewed remote host only when that exact local asset is absent.
  const verifiedArtIcon = variants[0] ? {
    ...variants[0],
    id: `${id}-icon`,
    source: 'character-icon',
    placement: { anchor: 'center', fit: 'cover', x: 0.5, y: 0.5 },
  } : null;
  const icon = localCharacterIcon(game, record, db) ?? verifiedArtIcon ?? remoteCharacterIcon(game, raw, `${id}-icon`);
  return { id, name, rarity, limited, debut, icon, variants };
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
    if (a.debut && !b.debut) return 1;
    if (!a.debut && b.debut) return -1;
    const aNumeric = Number.parseInt(a.id, 10);
    const bNumeric = Number.parseInt(b.id, 10);
    if (Number.isFinite(aNumeric) && Number.isFinite(bNumeric) && aNumeric !== bNumeric) return bNumeric - aNumeric;
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
    const corroboratingGroup = structuredClone(group);
    group._displayUpcoming = [];
    group.current = null;
    group.next = null;
    group.upcoming = [];
    const historyFile = path.join(db, 'BannerHistory', `${game}.json`);
    if (!fs.existsSync(historyFile)) continue;
    const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    // A present history file is the only authority for launcher current-state
    // decisions. Invalid identity/provenance must not fall back to raw banner
    // timestamps from another provider.
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
    const sourceImages = new Map();
    for (const phase of [corroboratingGroup.current, corroboratingGroup.next, ...(corroboratingGroup.upcoming ?? [])]) {
      for (const entry of phase?.characters ?? []) {
        const name = norm(entry?.name ?? entry);
        const image = remoteWuwaIconUrl(entry?.image ?? entry?.icon);
        if (name && image && !sourceImages.has(name)) sourceImages.set(name, image);
      }
    }
    const characters = [];
    for (const channel of active.sort((left, right) => left.recordId.localeCompare(right.recordId))) {
      for (const character of channel.characters) {
        if (!characters.some((entry) => sameBannerCharacter(game, entry.name, character.name))) {
          const image = sourceImages.get(norm(character.name));
          characters.push(image ? { ...character, image } : character);
        }
      }
    }
    const activeNames = characters.map((entry) => norm(entry.name));
    const labelledRawPhase = [corroboratingGroup.current, corroboratingGroup.next, ...(corroboratingGroup.upcoming ?? [])]
      .filter((phase) => typeof phase?.phase === 'string' && /\bphase\b/i.test(phase.phase))
      .filter((phase) => {
        const names = (phase.characters ?? []).map((entry) => norm(entry?.name ?? entry));
        return names.some((name) => activeNames.some((activeName) => sameBannerCharacter(game, name, activeName)));
      })
      .sort((left, right) => {
        const leftEnd = timestamp(iso(left?.end));
        const rightEnd = timestamp(iso(right?.end));
        const activeEnd = timestamp(end);
        return Math.abs((leftEnd ?? 0) - activeEnd) - Math.abs((rightEnd ?? 0) - activeEnd);
      })[0];
    group.current = {
      phase: cleanText(labelledRawPhase?.phase, 48) || [...versions][0],
      start,
      end,
      characters,
      _sourcedWindow: true,
      _sourceRegion: region,
      _sourceChannels: active.map((entry) => ({ recordId: entry.recordId, category: entry.category })),
    };
    const futureWindows = new Map();
    for (const record of trusted) {
      if (record?.confirmed !== true || record?.bannerType !== 'character' || record?.permanent === true || !record?.category) continue;
      const window = record.windowsByRegion?.[region];
      const futureStart = iso(window?.start);
      const futureEnd = iso(window?.end);
      if (!(timestamp(futureStart) > nowMs) || !(timestamp(futureEnd) > timestamp(futureStart))) continue;
      const key = `${futureStart}\u0000${futureEnd}`;
      if (!futureWindows.has(key)) futureWindows.set(key, []);
      futureWindows.get(key).push(record);
    }
    group._displayUpcoming = [...futureWindows.entries()].flatMap(([key, records]) => {
      const [futureStart, futureEnd] = key.split('\u0000');
      const futureVersions = new Set(records.map((record) => cleanText(record.version, 48)).filter(Boolean));
      if (records.some((record) => !cleanText(record.version, 48)) || futureVersions.size !== 1) return [];
      const futureCharacters = [];
      for (const record of records.sort((left, right) => left.id.localeCompare(right.id))) {
        for (const featured of record.featured ?? []) {
          const futureName = cleanText(featured?.name, 80);
          if (featured?.primary !== true || !futureName || futureCharacters.some((entry) => sameBannerCharacter(game, entry.name, futureName))) continue;
          const image = sourceImages.get(norm(futureName));
          const character = { name: futureName, rarity: parseRarity(featured.rarity), limited: true };
          futureCharacters.push(image ? { ...character, image } : character);
        }
      }
      if (!futureCharacters.length) return [];
      return [{
        phase: [...futureVersions][0],
        start: futureStart,
        end: futureEnd,
        characters: futureCharacters,
        _sourcedWindow: true,
        _sourceRegion: region,
        _sourceChannels: records.map((record) => ({ recordId: record.id, category: record.category })),
      }];
    }).sort((left, right) => left.start.localeCompare(right.start));
    // Raw next/upcoming timestamps never enter the launcher feed. Complete,
    // confirmed records with the same trusted history identity as current data
    // are the only future-banner authority.
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

function buildUpcomingPhases(game, group, rosters, prydwen, db, debuts, nowMs) {
  const raw = Array.isArray(group?._displayUpcoming)
    ? group._displayUpcoming
    : [];
  return raw
    .map((phase, index) => normalizePhase(group, phase, index))
    .filter((phase) => !phase.uncertain && phase.startMs > nowMs)
    .sort((left, right) => left.startMs - right.startMs)
    .slice(0, 5)
    .map((phase) => ({
      phase: phase.phase,
      start: phase.start,
      end: phase.end,
      characters: phase.characters
        .map((entry) => buildCharacter(game, entry, rosters ?? {}, prydwen[game] ?? [], db, debuts))
        .filter(Boolean)
        .map((character) => ({ ...character, variants: [] })),
    }))
    // Upcoming art is optional. Omit an incomplete phase instead of shipping
    // a broken remote reference or failing the known-good current feed.
    .filter((phase) => phase.characters.length > 0 && phase.characters.every((character) => character.icon));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function manifestRevision(manifest) {
  const games = structuredClone(manifest.games ?? {});
  for (const game of Object.values(games)) {
    if (game?.current?.remaining) delete game.current.remaining.durationSeconds;
  }
  const payload = { schemaVersion: manifest.schemaVersion, health: { status: 'pending', games: manifest.health.games }, games };
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function reconcileLauncherCodes(manifest, codesFeed) {
  if (manifest?.schemaVersion !== 1 || codesFeed?.schemaVersion !== 1) {
    throw new Error('Launcher manifests must use schemaVersion 1');
  }
  const manifestGames = Object.keys(manifest?.games ?? {});
  const codeGames = Object.keys(codesFeed?.games ?? {});
  if (manifestGames.length !== GAMES.length || codeGames.length !== GAMES.length
    || GAMES.some((game) => !manifestGames.includes(game) || !codeGames.includes(game))) {
    throw new Error('Launcher manifests must contain exactly the five canonical games');
  }

  const reconciled = structuredClone(manifest);
  for (const game of GAMES) {
    const codes = codesFeed.games[game];
    if (!Array.isArray(codes) || codes.length > 5) throw new Error(`${game} launcher codes must be an array of at most five entries`);
    for (const entry of codes) {
      if (!entry || !/^[-_A-Za-z0-9]{1,64}$/.test(entry.code ?? '')
        || !/^\d{4}-\d{2}-\d{2}$/.test(entry.added ?? '')
        || !Number.isSafeInteger(entry.amount) || entry.amount < 0
        || typeof entry.currency !== 'string') {
        throw new Error(`${game} launcher code entry is invalid`);
      }
    }
    reconciled.games[game].codes = codes.map(({ code, added, amount, currency }) => ({ code, added, amount, currency }));
  }
  reconciled.revision = manifestRevision(reconciled);
  return reconciled;
}

/**
 * Copy current-phase art and the small upcoming character icons referenced by a manifest into the small,
 * packageable launcher-art directory. Files are content-addressed so the
 * shipped manifest never needs to expose a provider/database path.
 */
export async function mirrorLauncherArt(manifest, {
  outputDir = LAUNCHER_ART,
  sourceRoot = ROOT,
  publicBaseUrl = 'https://pengo.gg/dist/launcher-art',
  requireDeployable = false,
} = {}) {
  if (!manifest || typeof manifest !== 'object') throw new TypeError('A launcher manifest is required.');
  const root = path.resolve(sourceRoot);
  const destination = path.resolve(outputDir);
  const nonce = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const staging = `${destination}.tmp-${nonce}`;
  const backup = `${destination}.bak-${nonce}`;
  const working = structuredClone(manifest);
  fs.mkdirSync(staging, { recursive: true });
  const processed = new Map();
  const seenAssets = new Set();
  try {
    for (const game of Object.values(working.games ?? {})) {
      const current = game?.current;
      const assets = [
        ...(current?.variants ?? []),
        ...(current?.characters ?? []).map((character) => character.icon).filter(Boolean),
        ...(current?.characters ?? []).flatMap((character) => character.variants ?? []),
        ...(game?.upcoming ?? []).flatMap((phase) => phase.characters ?? []).map((character) => character.icon).filter(Boolean),
      ];
      for (const asset of assets) {
        if (!asset || seenAssets.has(asset)) continue;
        seenAssets.add(asset);
        let source = null;
        let bytes;
        if (typeof asset.sourceUrl === 'string') {
          const sourceUrl = remoteWuwaIconUrl(asset.sourceUrl);
          if (!sourceUrl) throw new Error(`Launcher art source URL is not an approved WuWa icon: ${asset.sourceUrl}`);
          bytes = await fetchRemoteLauncherArt(sourceUrl);
          source = sourceUrl;
        } else {
          if (typeof asset.path !== 'string' || !asset.path.startsWith('/Database/')) {
            throw new Error(`Launcher art source is not a local Database path: ${asset?.path ?? '<missing>'}`);
          }
          const relative = asset.path.slice(1).replace(/\//g, path.sep);
          source = path.resolve(root, relative);
          if (!source.startsWith(`${root}${path.sep}`) || !exists(source) || !fs.statSync(source).isFile()) {
            throw new Error(`Launcher art source is missing: ${asset.path}`);
          }
          bytes = fs.readFileSync(source);
          const actual = crypto.createHash('sha256').update(bytes).digest('hex');
          if (actual !== asset.sha256 || bytes.length !== asset.size) throw new Error(`Launcher art source metadata mismatch: ${asset.path}`);
        }
        let output = processed.get(source);
        if (!output) {
          const converted = await sharp(bytes, { animated: false, failOn: 'error', limitInputPixels: 4096 * 4096 })
            .rotate()
            .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 })
            .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 92, alphaQuality: 100, effort: 5, smartSubsample: true })
            .toBuffer({ resolveWithObject: true });
          if (!converted.info.width || !converted.info.height || converted.data.length <= 0) throw new Error(`Launcher art conversion failed: ${asset.sourceUrl ?? asset.path}`);
          const hash = crypto.createHash('sha256').update(converted.data).digest('hex');
          const filename = `${hash}.webp`;
          fs.writeFileSync(path.join(staging, filename), converted.data);
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
        delete asset.sourceUrl;
      }
    }
    working.revision = manifestRevision(working);
    if (requireDeployable) validatePackagedManifest(working, { now: Date.parse(working.generatedAt) });
    const hadDestination = exists(destination);
    if (hadDestination) fs.renameSync(destination, backup);
    try {
      fs.renameSync(staging, destination);
    } catch (error) {
      if (hadDestination && exists(backup) && !exists(destination)) fs.renameSync(backup, destination);
      throw error;
    }
    if (hadDestination) fs.rmSync(backup, { recursive: true, force: true });
    for (const key of Object.keys(manifest)) delete manifest[key];
    Object.assign(manifest, working);
    const unique = new Map([...processed.values()].map((item) => [item.hash, item]));
    return { manifest, outputDir: destination, count: unique.size, bytes: [...unique.values()].reduce((total, item) => total + item.size, 0) };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    if (exists(backup) && !exists(destination)) fs.renameSync(backup, destination);
    throw error;
  }
}

export function buildManifest({ banners, events, rosters, prydwen = {}, debuts = {}, db = DATABASE, codes = loadPremiumCodes(db), now = Date.now(), generatedAt = new Date(now).toISOString() } = {}) {
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
    const upcoming = buildUpcomingPhases(game, group, rosters, prydwen, db, debuts, now);
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
      upcoming,
      news,
      codes: codes.get(game) ?? [],
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
  return { banners: applySourcedBannerWindows(readJson(bannersFile), db, now), events, rosters, prydwen, debuts, codes: loadPremiumCodes(db), db };
}

export function validatePackagedManifest(manifest, { now = Date.now(), maxAgeMs = 15 * 60_000 } = {}) {
  const errors = [];
  const gameKeys = Object.keys(manifest?.games ?? {});
  if (manifest?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!/^[a-f0-9]{64}$/.test(manifest?.revision ?? '')) errors.push('revision must be a SHA-256 hash');
  const generatedAt = Date.parse(manifest?.generatedAt ?? '');
  if (!Number.isFinite(generatedAt) || generatedAt > now + 60_000 || now - generatedAt > maxAgeMs) errors.push('generatedAt is missing or stale');
  if (gameKeys.length !== GAMES.length || GAMES.some((game) => !gameKeys.includes(game))) errors.push('exactly five canonical games are required');
  if (manifest?.health?.status !== 'ok') errors.push(`manifest health is ${manifest?.health?.status ?? 'missing'}`);

  const assets = [];
  for (const game of GAMES) {
    const entry = manifest?.games?.[game];
    if (entry?.game !== game || manifest?.health?.games?.[game]?.status !== 'ok') errors.push(`${game} identity or health is invalid`);
    if (!entry?.current?.selectedCharacter?.name) errors.push(`${game} has no current selection`);
    if (!(entry?.current?.selectedCharacter?.variants?.length > 0)) errors.push(`${game} current selection has no splash art`);
    const currentStart = Date.parse(entry?.current?.start ?? '');
    const currentEnd = Date.parse(entry?.current?.end ?? '');
    const expectedDuration = Number.isFinite(currentEnd) && Number.isFinite(generatedAt)
      ? Math.max(0, Math.floor((currentEnd - generatedAt) / 1000))
      : NaN;
    if (!Number.isFinite(currentStart) || !Number.isFinite(currentEnd) || currentStart > generatedAt || currentEnd <= generatedAt) {
      errors.push(`${game} current window is invalid at generation time`);
    } else if (now < currentStart || now >= currentEnd) {
      errors.push(`${game} current window is not active at deployment time`);
    }
    if (entry?.current?.remaining?.startsAt !== entry?.current?.start
      || entry?.current?.remaining?.endsAt !== entry?.current?.end
      || entry?.current?.remaining?.durationSeconds !== expectedDuration) {
      errors.push(`${game} current countdown does not match the committed snapshot`);
    }
    for (const character of entry?.current?.characters ?? []) {
      if (!character?.icon) errors.push(`${game} current character ${character?.name ?? '<unknown>'} has no icon`);
    }
    for (const phase of entry?.upcoming ?? []) {
      for (const character of phase?.characters ?? []) {
        if (!character?.icon) errors.push(`${game} upcoming character ${character?.name ?? '<unknown>'} has no icon`);
      }
    }
    assets.push(
      ...(entry?.current?.variants ?? []),
      ...(entry?.current?.characters ?? []).map((character) => character.icon).filter(Boolean),
      ...(entry?.current?.characters ?? []).flatMap((character) => character.variants ?? []),
      ...(entry?.upcoming ?? []).flatMap((phase) => phase.characters ?? []).map((character) => character.icon).filter(Boolean),
    );
  }
  for (const asset of assets) {
    const match = String(asset?.path ?? '').match(/^\/launcher-art\/([a-f0-9]{64})\.webp$/);
    if (!match || match[1] !== asset?.sha256) errors.push(`asset path/hash is invalid: ${asset?.path ?? '<missing>'}`);
    if (asset?.url !== `https://pengo.gg/dist${asset?.path ?? ''}`) errors.push(`asset URL is invalid: ${asset?.url ?? '<missing>'}`);
    if (asset?.mime !== 'image/webp' || !Number.isSafeInteger(asset?.size) || asset.size <= 0) errors.push(`asset metadata is invalid: ${asset?.path ?? '<missing>'}`);
    if (!Number.isSafeInteger(asset?.dimensions?.width) || asset.dimensions.width <= 0
      || !Number.isSafeInteger(asset?.dimensions?.height) || asset.dimensions.height <= 0) errors.push(`asset dimensions are invalid: ${asset?.path ?? '<missing>'}`);
  }
  const serialized = JSON.stringify(manifest);
  // `token` is matched as a credential, not as the English word: official event
  // titles legitimately contain it ("...Prismatic Crystals, the Token for the
  // Colorful Surprise Box"), and the bare-word match blocked every deploy.
  if (/nanoka|drive\.google|google drive|sourceUrl|(?:^|[\"/])Database(?:[\/\"]|$)|[a-z]:\\\\|[\\/]Users[\\/]|(?:access|api|auth|bearer|refresh|secret|session)[_-]?token|token[\"']?\s*[=:]\s*[\"']?[\w-]{8}/i.test(serialized)) {
    errors.push('manifest contains internal provenance or secret-like metadata');
  }
  if (errors.length) throw new Error(`Launcher manifest is not deployable:\n- ${errors.join('\n- ')}`);
  return { assets: assets.length, uniqueAssets: new Set(assets.map((asset) => asset.sha256)).size };
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
  const mirrored = await mirrorLauncherArt(manifest, { outputDir: artOutput, requireDeployable: true });
  validatePackagedManifest(manifest, { now: at });
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
