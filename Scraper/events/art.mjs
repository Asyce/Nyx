// ============================================================
// Event art localizer.
//
// Official announcements ship a promo banner image. The site is never allowed
// to hotlink it: Scraper/events/core.mjs `normalizeEventImage` accepts only
// /assets/... paths, and the deployed CSP (`img-src 'self' …`) blocks publisher
// CDNs outright. So this step downloads the art once, stores it under
// Site/assets/events/<game>/<sha256>.<ext> (Site/assets is copied wholesale to
// the deploy root, unlike Database/Events which the runtime publisher restricts
// to flat JSON), and writes the local path back onto the event.
//
// Provenance lands in Database/reports/event-art-provenance.json — same shape
// and same rights position as the achievement icon provenance: no license is
// claimed, the art stays owned by its publisher, and nothing is hotlinked.
//
// Every failure here is non-fatal. Art is decoration; an event with no image
// still renders. The caller keeps its dataset either way.
// ============================================================

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const ART_DIR_RELATIVE = 'Site/assets/events';
export const PROVENANCE_RELATIVE = 'Database/reports/event-art-provenance.json';
export const RUNTIME_PREFIX = '/assets/events';
// Generous, because it is a backstop against a pathological download, not the
// size control — that is the CDN resize plus the caller's shouldFetch window.
export const MAX_ART_BYTES = 2_000_000;
// The overview card renders art ~342px wide. Anything narrower than this is an
// inline icon or a decorative rule, not a key visual.
export const MIN_ART_WIDTH = 480;

// Announcement art is served from the publishers' own CDNs. An unexpected host
// means the feed shape changed; refuse rather than download from anywhere.
const ALLOWED_HOSTS = new Set([
  // HoYoverse (Genshin / Star Rail / Zenless) announcement art
  'sdk.hoyoverse.com',
  'webstatic.hoyoverse.com',
  'fastcdn.hoyoverse.com',
  'upload-os-bbs.hoyolab.com',
  'act-webstatic.hoyoverse.com',
  // Kuro Games (Wuthering Waves) article media
  'hw-media-cdn-mingchao.kurogame.com',
  'web-static.kurobbs.com',
  // Gryphline (Arknights: Endfield) bulletin covers
  'web-static.hg-cdn.com',
  // game8 teaser stills for announced-but-unscheduled characters
  'img.game8.co',
]);

// Two of the three CDNs are Alibaba OSS-backed and will resize on request
// (verified 2026-08-08: a 698 KB Kuro key visual comes back as 131 KB at
// w_960). The card renders ~342px wide, so full-resolution press art is pure
// page weight. HoYoverse ignores the parameter and already serves a
// "_transformed" variant, so its URLs are left alone.
const RESIZE_HOSTS = new Set(['hw-media-cdn-mingchao.kurogame.com', 'web-static.hg-cdn.com', 'web-static.kurobbs.com']);
const RESIZE_RECIPE = 'image/resize,w_960/quality,q_80';

export function artRequestUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!RESIZE_HOSTS.has(url.hostname) || url.searchParams.has('x-oss-process')) return url.toString();
    url.searchParams.set('x-oss-process', RESIZE_RECIPE);
    return url.toString();
  } catch { return String(value || ''); }
}

const EXT_BY_TYPE = {
  'image/jpeg':'jpg',
  'image/jpg':'jpg',
  'image/png':'png',
  'image/webp':'webp',
  'image/avif':'avif',
};

// Magic-number sniff: the Content-Type header is a claim, the bytes are the
// evidence. A mismatch (or anything that is not an image) is discarded.
export function sniffImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buffer.subarray(4, 8).toString('latin1') === 'ftyp' && /avif|avis/.test(buffer.subarray(8, 12).toString('latin1'))) return 'image/avif';
  return null;
}

// Intrinsic size straight from the file header — no image library in this
// repo. Used to reject art that is obviously not a promo image: WuWa has no
// cover field at all, so its art is the first image in the article body, and
// that could be an inline icon or a rules diagram rather than the key visual.
// Unknown/unsupported headers return null and are accepted (never guess).
export function readImageSize(buffer) {
  if (!buffer || buffer.length < 24) return null;
  if (buffer[0] === 0x89 && buffer.subarray(1, 4).toString('latin1') === 'PNG') {
    return { width:buffer.readUInt32BE(16), height:buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = buffer.readUInt16BE(offset + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { height:buffer.readUInt16BE(offset + 5), width:buffer.readUInt16BE(offset + 7) };
      if (length < 2) return null;
      offset += 2 + length;
    }
    return null;
  }
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    const chunk = buffer.subarray(12, 16).toString('latin1');
    if (chunk === 'VP8X' && buffer.length >= 30) {
      return { width:1 + buffer.readUIntLE(24, 3), height:1 + buffer.readUIntLE(27, 3) };
    }
    if (chunk === 'VP8 ' && buffer.length >= 30) {
      return { width:buffer.readUInt16LE(26) & 0x3fff, height:buffer.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L' && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return { width:(bits & 0x3fff) + 1, height:((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  return null;
}

export function isAllowedArtUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname);
  } catch { return false; }
}

export function artFileName(buffer, mediaType) {
  const ext = EXT_BY_TYPE[mediaType];
  if (!ext) return null;
  return `${crypto.createHash('sha256').update(buffer).digest('hex')}.${ext}`;
}

export function runtimeArtPath(bucket, fileName) {
  return `${RUNTIME_PREFIX}/${bucket}/${fileName}`;
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function defaultFetchImage(url) {
  const response = await fetch(url, {
    headers:{ 'User-Agent':'Nyxarium/1.0 events (https://pengo.gg)', accept:'image/*' },
    signal:AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const declared = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, declared, etag:response.headers.get('etag') || null, lastModified:response.headers.get('last-modified') || null };
}

// Downloads art for every event that has a source record in `artByRecordId`
// and no local image yet. Mutates nothing: returns new event objects plus the
// provenance rows for the ones that gained art.
export async function localizeEventArt({
  game,
  folder = null,
  events = [],
  artByRecordId = new Map(),
  rootDir,
  fetchImage = defaultFetchImage,
  shouldFetch = () => true,
  now = new Date().toISOString(),
} = {}) {
  const bucket = folder || game;
  const gameDir = path.resolve(rootDir, ART_DIR_RELATIVE, bucket);
  const provenance = [];
  const problems = [];
  let downloaded = 0;
  let reused = 0;
  const byUrl = new Map();

  const next = [];
  for (const original of events) {
    const recordId = original?.source?.recordId === undefined || original?.source?.recordId === null ? '' : String(original.source.recordId);
    const remote = recordId ? artByRecordId.get(recordId) : null;
    // A record can claim art whose file is gone (pruned while the event was
    // outside the window, or a wiped assets folder). Only a file that is
    // actually on disk counts as having art; a dangling path is cleared here
    // and re-fetched below, so a broken image is never shipped.
    const stored = String(original?.image || '').startsWith(`${RUNTIME_PREFIX}/${bucket}/`)
      ? await exists(path.resolve(gameDir, original.image.split('/').pop()))
      : Boolean(original?.image);
    const event = stored || !original?.image ? original : { ...original, image:null };
    if (!remote || stored || !shouldFetch(event)) { next.push(event); continue; }
    if (!isAllowedArtUrl(remote)) { problems.push(`${event.id}: art host not allowed (${remote.slice(0, 80)})`); next.push(event); continue; }

    // One download per distinct URL — announcements reuse the same art across
    // regions, and the same event id can appear in more than one dataset run.
    let resolved = byUrl.get(remote);
    if (!resolved) {
      try {
        const requestUrl = artRequestUrl(remote);
        const { buffer, declared, etag, lastModified } = await fetchImage(requestUrl);
        if (buffer.length > MAX_ART_BYTES) throw new Error(`art too large (${buffer.length} bytes)`);
        const sniffed = sniffImageType(buffer);
        if (!sniffed) throw new Error('not a recognised image');
        if (declared && EXT_BY_TYPE[declared] && EXT_BY_TYPE[declared] !== EXT_BY_TYPE[sniffed]) throw new Error(`content-type ${declared} does not match the bytes (${sniffed})`);
        const size = readImageSize(buffer);
        if (size && size.width < MIN_ART_WIDTH) throw new Error(`art too small for a card (${size.width}x${size.height})`);
        const fileName = artFileName(buffer, sniffed);
        if (!fileName) throw new Error(`unsupported media type ${sniffed}`);
        const file = path.join(gameDir, fileName);
        if (await exists(file)) { reused += 1; }
        else {
          await fs.mkdir(gameDir, { recursive:true });
          await fs.writeFile(file, buffer);
          downloaded += 1;
        }
        resolved = {
          runtimePath:runtimeArtPath(bucket, fileName),
          row:{
            game,
            fileName,
            sourceUrl:remote,
            requestUrl:requestUrl === remote ? null : requestUrl,
            runtimePath:runtimeArtPath(bucket, fileName),
            localPath:`${ART_DIR_RELATIVE}/${bucket}/${fileName}`,
            sha256:fileName.replace(/\.[a-z0-9]+$/i, ''),
            bytes:buffer.length,
            mediaType:sniffed,
            width:size ? size.width : null,
            height:size ? size.height : null,
            etag,
            lastModified,
            retrievedAt:now,
          },
        };
        byUrl.set(remote, resolved);
        provenance.push({ ...resolved.row, eventIds:[] });
      } catch (error) {
        problems.push(`${event.id}: ${error.message}`);
        next.push(event);
        continue;
      }
    }
    const row = provenance.find((entry) => entry.sourceUrl === remote);
    if (row && !row.eventIds.includes(event.id)) row.eventIds.push(event.id);
    next.push({ ...event, image:resolved.runtimePath });
  }

  return { events:next, provenance, downloaded, reused, problems };
}

// Deletes stored art no dataset points at any more. Without this the folder
// only ever grows: an event's art is downloaded once and the event itself is
// eventually aged out of the feed. Only ever removes files inside the game's
// own art folder, and only ones matching the hashed name this module writes.
export async function pruneEventArt({ game, folder = null, events = [], rootDir } = {}) {
  const bucket = folder || game;
  const gameDir = path.resolve(rootDir, ART_DIR_RELATIVE, bucket);
  const keep = new Set();
  for (const event of events) {
    const image = String(event?.image || '');
    if (image.startsWith(`${RUNTIME_PREFIX}/${bucket}/`)) keep.add(image.slice(`${RUNTIME_PREFIX}/${bucket}/`.length));
  }
  let removed = 0;
  let names;
  try { names = await fs.readdir(gameDir); } catch { return { removed:0, kept:keep.size }; }
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.(?:jpg|png|webp|avif)$/.test(name) || keep.has(name)) continue;
    await fs.rm(path.join(gameDir, name), { force:true });
    removed += 1;
  }
  return { removed, kept:keep.size };
}

// Merges this run's rows into the on-disk provenance file, keyed by sha256, so
// art that is still referenced keeps its original retrievedAt.
// `referenced` is the set of `<game>/<sha256>` the freshly written datasets
// still point at. Rows outside it describe art that pruneEventArt deleted:
// provenance records what is stored, not everything ever fetched.
export function mergeProvenance(previous, rows, { generatedAt, games, referenced = null }) {
  const byKey = new Map();
  for (const row of previous?.art || []) {
    if (!row?.sha256 || !row?.game) continue;
    const key = `${row.game}/${row.sha256}`;
    if (!referenced || referenced.has(key)) byKey.set(key, row);
  }
  for (const row of rows) {
    const key = `${row.game}/${row.sha256}`;
    const old = byKey.get(key);
    byKey.set(key, old ? { ...old, ...row, retrievedAt:old.retrievedAt, eventIds:[...new Set([...(old.eventIds || []), ...(row.eventIds || [])])] } : row);
  }
  return {
    schemaVersion:1,
    generatedBy:'Scraper/events/art.mjs',
    generatedAt,
    runtimeHotlinks:false,
    licenseClaim:null,
    games,
    art:[...byKey.values()].sort((left, right) => `${left.game}/${left.sha256}`.localeCompare(`${right.game}/${right.sha256}`)),
    rightsNote:'No license is claimed for game artwork. Game content and assets remain owned by their publishers (HoYoverse / COGNOSPHERE / miHoYo, Kuro Games, Gryphline). Pengo is an unofficial, non-affiliated fan tool.',
  };
}
