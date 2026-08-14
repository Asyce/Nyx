import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
export const GENERATED = path.join(ROOT, 'Site', 'src', 'data', 'generated');
export const VISUALS = path.join(GENERATED, 'launcher-visuals');
export const OUTPUT = path.join(GENERATED, 'launcher-visuals-v1.json');
const ARCHIVE_REPO = 'nano-shino/hyvbgarchive';
const ARCHIVE_BRANCH = 'master';
const ARCHIVE_DIRECTORIES = {
  gi: 'archive/gopR6Cufr3/',
  hsr: 'archive/4ziysqXOQ8/',
  zzz: 'archive/U5hbdsT9W7/',
};
const HOYO_GAME_IDS = {
  gi: 'gopR6Cufr3',
  hsr: '4ziysqXOQ8',
  zzz: 'U5hbdsT9W7',
};
const HOYO_VISUALS_URL = 'https://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getAllGameBasicInfo?launcher_id=VYTpXlbWo8&language=en-us';
const ENDFIELD_VISUALS_URL = 'https://launcher.gryphline.com/api/proxy/web/batch_proxy';
const ENDFIELD_VIDEO_HOST = 'gl-utils-public.hg-cdn.com';
const ENDFIELD_VIDEO_PREFIX = '/hg-utils/prod/eppcsuwqpaueijqk/YDUTE5gscDZ229CW/';
const ENDFIELD_REQUEST_JSON = '{"proxy_reqs":[{"kind":"get_main_bg_image","get_main_bg_image_req":{"appcode":"YDUTE5gscDZ229CW","language":"en-us","channel":"6","sub_channel":"6","platform":"Windows","source":"launcher"}}]}';
const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const ASSET_ORIGIN = 'https://assets.pengo.gg';
const WUWA_CONFIG_URL = 'https://prod-alicdn-gamestarter.kurogame.com/launcher/launcher/50004_obOHXFrFanqsaIEOmuKroCcbZkQRBC7c/G153/index.json';
const WUWA_BACKGROUND_ROOT = 'https://prod-alicdn-gamestarter.kurogame.com/launcher/50004_obOHXFrFanqsaIEOmuKroCcbZkQRBC7c/G153/background/';
const WUWA_MEDIA_HOSTS = new Set([
  'hw-pcdownload-qcloud.aki-game.net',
  'hw-pcdownload-aws.aki-game.net',
  'hw-pcdownload-akamai.aki-game.net',
]);

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const cleanText = (value, max = 80) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

function canonicalizeEntry(entry) {
  if (!entry || !Array.isArray(entry.assets)) return entry;
  return {
    ...entry,
    assets: entry.assets.map((asset) => {
      const extension = asset.mediaType === 'video/webm' ? '.webm'
        : asset.mediaType === 'video/mp4' ? '.mp4'
          : asset.mediaType === 'image/webp' ? '.webp'
            : asset.mediaType === 'image/png' ? '.png'
              : path.posix.extname(new URL(asset.url).pathname);
      return { ...asset, url: `${ASSET_ORIGIN}/launcher-visuals/${asset.sha256}${extension}` };
    }),
  };
}

export async function fetchTrustedBytes(url, {
  fetchImpl = fetch,
  maximum,
  accept,
  mediaTypes = [],
  timeoutMs = REQUEST_TIMEOUT_MS,
  method = 'GET',
  body,
  contentType,
  verifyContentMd5 = false,
} = {}) {
  if (!Number.isSafeInteger(maximum) || maximum <= 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Trusted download bounds are invalid.');
  }
  if (!['GET', 'POST'].includes(method) || method === 'GET' && body !== undefined) {
    throw new TypeError('Trusted download method is invalid.');
  }
  const signal = AbortSignal.timeout(timeoutMs);
  let onAbort;
  let timeout;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error(`Request timed out for ${url}`));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    timeout = setTimeout(onAbort, timeoutMs);
  });
  try {
    const response = await Promise.race([fetchImpl(url, {
      method,
      body,
      headers: {
        Accept: accept ?? '*/*',
        ...(contentType ? { 'Content-Type': contentType } : {}),
        'User-Agent': 'Pengo-Nyx-LauncherVisuals/1.0 (https://pengo.gg)',
      },
      redirect: 'error',
      signal,
    }), aborted]);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    if (mediaTypes.length > 0 && !mediaTypes.includes(mediaType)) {
      throw new Error(`Unexpected media type ${mediaType || '(missing)'} for ${url}`);
    }
    const rawLength = response.headers.get('content-length');
    const length = rawLength === null ? null : Number(rawLength);
    if (length !== null && (!Number.isSafeInteger(length) || length < 0 || length > maximum)) {
      throw new Error(`Remote asset exceeds ${maximum} bytes: ${url}`);
    }
    if (!response.body) throw new Error(`Remote asset has no body: ${url}`);

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        total += value.byteLength;
        if (total > maximum) throw new Error(`Remote asset exceeds ${maximum} bytes: ${url}`);
        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      void reader.cancel(error).catch(() => {});
      throw error;
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    if (total === 0 || length !== null && total !== length) throw new Error(`Invalid remote asset size: ${url}`);
    const bytes = Buffer.concat(chunks, total);
    const rawMd5 = verifyContentMd5 ? response.headers.get('content-md5') : null;
    if (rawMd5 !== null) {
      const expected = Buffer.from(rawMd5, 'base64');
      const actual = crypto.createHash('md5').update(bytes).digest();
      if (expected.length !== 16 || expected.toString('base64') !== rawMd5 || !crypto.timingSafeEqual(expected, actual)) {
        throw new Error(`Remote asset MD5 does not match: ${url}`);
      }
    }
    return bytes;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
  }
}

function parseOfficialHoyoVideo(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || url.href !== rawUrl) return null;
  const expectedPrefix = url.hostname === 'fastcdn.hoyoverse.com' ? 'static-resource-v2'
    : url.hostname === 'launcher-webstatic.hoyoverse.com' ? 'launcher-public'
      : null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (!expectedPrefix || parts.length !== 5 || parts[0] !== expectedPrefix) return null;
  const [_, year, month, day, file] = parts;
  if (!/^20\d{2}$/.test(year) || !/^(0[1-9]|1[0-2])$/.test(month) || !/^(0[1-9]|[12]\d|3[01])$/.test(day)) return null;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() + 1 !== Number(month)
    || date.getUTCDate() !== Number(day)) return null;
  const match = file.match(/^([a-f0-9]{32})_([0-9]{1,20})\.webm$/);
  return match ? { url: url.href, date: `${year}${month}${day}`, file, digest: match[1] } : null;
}

function officialHoyoVideos(payload) {
  const games = payload?.data?.game_info_list;
  if (!Array.isArray(games) || games.length === 0 || games.length > 32) throw new Error('Official HoYo launcher response is invalid.');
  const result = {};
  for (const [game, id] of Object.entries(HOYO_GAME_IDS)) {
    const matches = games.filter((entry) => entry?.game?.id === id);
    const backgrounds = matches.length === 1 ? matches[0]?.backgrounds : null;
    if (!Array.isArray(backgrounds) || backgrounds.length === 0 || backgrounds.length > 10) throw new Error('Official HoYo launcher response is invalid.');
    const video = backgrounds.map((entry) => parseOfficialHoyoVideo(entry?.video?.url)).find(Boolean);
    if (!video) throw new Error('Official HoYo launcher response is invalid.');
    result[game] = video;
  }
  return result;
}

export function selectCorroboratedArchiveFiles(tree, officialPayload) {
  const official = officialHoyoVideos(officialPayload);
  const result = {};
  for (const [game, prefix] of Object.entries(ARCHIVE_DIRECTORIES)) {
    const video = official[game];
    const expected = `${prefix}${video.date}_${video.file}`;
    const match = (tree ?? []).find((entry) => entry?.type === 'blob' && entry.path === expected);
    if (match) result[game] = { ...match, officialUrl: video.url, officialDigest: video.digest };
  }
  return result;
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return plainObject(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function parseOfficialEndfieldVideoUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'https:'
    || url.hostname !== ENDFIELD_VIDEO_HOST
    || url.port
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.href !== rawUrl
    || !url.pathname.startsWith(ENDFIELD_VIDEO_PREFIX)
    || !/^[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{32}\.mp4$/.test(url.pathname.slice(ENDFIELD_VIDEO_PREFIX.length))) return null;
  return url.href;
}

export function parseOfficialEndfieldVideo(payload) {
  if (!hasOnlyKeys(payload, ['proxy_rsps']) || !Array.isArray(payload.proxy_rsps) || payload.proxy_rsps.length !== 1) {
    throw new Error('Official Endfield launcher response is invalid.');
  }
  const item = payload.proxy_rsps[0];
  const response = item?.get_main_bg_image_rsp;
  const image = response?.main_bg_image;
  if (!hasOnlyKeys(item, ['kind', 'get_main_bg_image_rsp'])
    || item.kind !== 'get_main_bg_image'
    || !hasOnlyKeys(response, ['data_version', 'main_bg_image'])
    || !hasOnlyKeys(image, ['url', 'md5', 'video_url'])
    || (image.md5 !== undefined && image.md5 !== null && !/^[a-f0-9]{32}$/.test(image.md5))) {
    throw new Error('Official Endfield launcher response is invalid.');
  }
  const officialUrl = parseOfficialEndfieldVideoUrl(image.video_url);
  if (!officialUrl) throw new Error('Official Endfield launcher response is invalid.');
  return officialUrl;
}

async function mirror(bytes, extension, mediaType) {
  const hash = sha256(bytes);
  await fs.mkdir(VISUALS, { recursive: true });
  await fs.writeFile(path.join(VISUALS, `${hash}${extension}`), bytes);
  return {
    url: `${ASSET_ORIGIN}/launcher-visuals/${hash}${extension}`,
    sha256: hash,
    size: bytes.length,
    mediaType,
  };
}

function validateWuwaMediaUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:'
    || url.port
    || url.username
    || url.password
    || !WUWA_MEDIA_HOSTS.has(url.hostname)
    || !url.pathname.startsWith('/launcher/clientUpload/')) {
    throw new Error('WuWa launcher media URL is outside the official download hosts.');
  }
  return url;
}

export function parseWuwaBackground(config, metadata) {
  const backgroundId = cleanText(config?.functionCode?.background, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(backgroundId)) {
    throw new Error('WuWa launcher background ID is invalid.');
  }
  if (metadata?.functionSwitch !== 1) throw new Error('WuWa launcher background is disabled.');
  const mediaUrl = validateWuwaMediaUrl(metadata?.backgroundFile);
  const fileType = Number(metadata?.backgroundFileType);
  if (fileType !== 1 && fileType !== 2) throw new Error('WuWa launcher background type is unsupported.');
  return { backgroundId, mediaUrl: mediaUrl.href, fileType };
}

function isMp4(bytes) {
  return bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp';
}

function isWebm(bytes) {
  return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
}

async function buildWuwaEntry(fetchImpl, previous) {
  try {
    const configBytes = await fetchTrustedBytes(WUWA_CONFIG_URL, {
      fetchImpl,
      maximum: 1024 * 1024,
      accept: 'application/json',
      mediaTypes: ['application/json'],
    });
    const config = JSON.parse(configBytes.toString('utf8'));
    const backgroundId = cleanText(config?.functionCode?.background, 80);
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(backgroundId)) throw new Error('WuWa launcher background ID is invalid.');
    const metadataUrl = `${WUWA_BACKGROUND_ROOT}${backgroundId}/en.json`;
    const metadataBytes = await fetchTrustedBytes(metadataUrl, {
      fetchImpl,
      maximum: 1024 * 1024,
      accept: 'application/json',
      mediaTypes: ['application/json'],
    });
    const background = parseWuwaBackground(config, JSON.parse(metadataBytes.toString('utf8')));
    if (previous?.source?.backgroundId === background.backgroundId
      && Array.isArray(previous.assets)
      && previous.assets.length === 1) {
      const file = path.join(VISUALS, path.basename(new URL(previous.assets[0].url).pathname));
      if (await fs.stat(file).then((value) => value.isFile() && value.size === previous.assets[0].size).catch(() => false)) {
        return canonicalizeEntry(previous);
      }
    }

    if (background.fileType === 2) {
      const bytes = await fetchTrustedBytes(background.mediaUrl, {
        fetchImpl,
        maximum: MAX_VIDEO_BYTES,
        accept: 'video/mp4',
        mediaTypes: ['video/mp4'],
      });
      if (!isMp4(bytes)) throw new Error('WuWa launcher animation is not an MP4 file.');
      return {
        kind: 'video',
        source: { config: WUWA_CONFIG_URL, backgroundId: background.backgroundId },
        assets: [await mirror(bytes, '.mp4', 'video/mp4')],
      };
    }

    const original = await fetchTrustedBytes(background.mediaUrl, {
      fetchImpl,
      maximum: MAX_IMAGE_BYTES,
      accept: 'image/*',
      mediaTypes: ['image/jpeg', 'image/png', 'image/webp'],
    });
    const webp = await sharp(original).rotate().resize(1920, 1080, { fit: 'cover' }).webp({ quality: 90 }).toBuffer();
    return {
      kind: 'image',
      source: { config: WUWA_CONFIG_URL, backgroundId: background.backgroundId },
      assets: [await mirror(webp, '.webp', 'image/webp')],
    };
  } catch {
    return canonicalizeEntry(previous) ?? null;
  }
}

async function verifiedPreviousHoyoEntry(game, entry, corroborated = null) {
  try {
    const asset = entry?.kind === 'video' && entry?.assets?.length === 1 ? entry.assets[0] : null;
    if (!asset
      || asset.mediaType !== 'video/webm'
      || !/^[a-f0-9]{64}$/.test(asset.sha256)
      || !Number.isSafeInteger(asset.size)
      || asset.size <= 0
      || asset.size > MAX_VIDEO_BYTES) return null;
    const assetUrl = new URL(asset.url);
    if (assetUrl.href !== `${ASSET_ORIGIN}/launcher-visuals/${asset.sha256}.webm`) return null;

    const parsed = corroborated ? null : parseOfficialHoyoVideo(entry?.source?.officialUrl);
    const sourcePath = corroborated?.path ?? (parsed && `${ARCHIVE_DIRECTORIES[game]}${parsed.date}_${parsed.file}`);
    const officialUrl = corroborated?.officialUrl ?? parsed?.url;
    const officialDigest = corroborated?.officialDigest ?? parsed?.digest;
    if (!sourcePath || !officialUrl || !officialDigest || entry?.source?.path !== sourcePath) return null;

    const file = path.join(VISUALS, `${asset.sha256}.webm`);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size !== asset.size) return null;
    const bytes = await fs.readFile(file);
    if (sha256(bytes) !== asset.sha256
      || crypto.createHash('md5').update(bytes).digest('hex') !== officialDigest) return null;
    return {
      kind: 'video',
      source: {
        repository: `https://github.com/${ARCHIVE_REPO}`,
        path: sourcePath,
        officialUrl,
      },
      assets: [{ ...asset, url: assetUrl.href }],
    };
  } catch {
    return null;
  }
}

async function buildHoyoEntries(fetchImpl, previousGames = {}) {
  const treeUrl = `https://api.github.com/repos/${ARCHIVE_REPO}/git/trees/${ARCHIVE_BRANCH}?recursive=1`;
  let selected;
  try {
    const [officialBytes, treeBytes] = await Promise.all([
      fetchTrustedBytes(HOYO_VISUALS_URL, {
        fetchImpl,
        maximum: 512 * 1024,
        accept: 'application/json',
        mediaTypes: ['application/json'],
      }),
      fetchTrustedBytes(treeUrl, {
        fetchImpl,
        maximum: 8 * 1024 * 1024,
        accept: 'application/vnd.github+json',
        mediaTypes: ['application/json'],
      }),
    ]);
    selected = selectCorroboratedArchiveFiles(
      JSON.parse(treeBytes.toString('utf8')).tree,
      JSON.parse(officialBytes.toString('utf8')),
    );
  } catch (error) {
    const fallback = {};
    for (const game of Object.keys(ARCHIVE_DIRECTORIES)) {
      fallback[game] = await verifiedPreviousHoyoEntry(game, previousGames?.[game]);
      if (!fallback[game]) throw new Error(`No verified last-good ${game} launcher animation is available.`, { cause: error });
    }
    return fallback;
  }

  const entries = {};
  for (const game of Object.keys(ARCHIVE_DIRECTORIES)) {
    const current = selected[game];
    const previous = previousGames?.[game];
    if (!current) {
      entries[game] = await verifiedPreviousHoyoEntry(game, previous);
      if (!entries[game]) throw new Error(`No officially corroborated or last-good ${game} launcher animation is available.`);
      continue;
    }
    const matchingPrevious = await verifiedPreviousHoyoEntry(game, previous, current);
    if (matchingPrevious && previous?.source?.officialUrl === current.officialUrl) {
      entries[game] = matchingPrevious;
      continue;
    }
    try {
      const bytes = await fetchTrustedBytes(current.officialUrl, {
        fetchImpl,
        maximum: MAX_VIDEO_BYTES,
        accept: 'video/webm',
        mediaTypes: ['video/webm'],
      });
      if (!isWebm(bytes)
        || crypto.createHash('md5').update(bytes).digest('hex') !== current.officialDigest) {
        throw new Error(`${game} official launcher animation does not match its official filename.`);
      }
      entries[game] = {
        kind: 'video',
        source: {
          repository: `https://github.com/${ARCHIVE_REPO}`,
          path: current.path,
          officialUrl: current.officialUrl,
        },
        assets: [await mirror(bytes, '.webm', 'video/webm')],
      };
    } catch (error) {
      entries[game] = matchingPrevious ?? await verifiedPreviousHoyoEntry(game, previous);
      if (!entries[game]) throw new Error(`No fresh or verified last-good ${game} launcher animation is available.`, { cause: error });
    }
  }
  return entries;
}

async function verifiedPreviousEndfieldEntry(entry, expectedUrl = null) {
  try {
    const asset = entry?.kind === 'video' && entry?.assets?.length === 1 ? entry.assets[0] : null;
    const officialUrl = parseOfficialEndfieldVideoUrl(entry?.source?.officialUrl);
    if (!asset
      || entry?.source?.endpoint !== ENDFIELD_VISUALS_URL
      || !officialUrl
      || expectedUrl !== null && officialUrl !== expectedUrl
      || asset.mediaType !== 'video/mp4'
      || !/^[a-f0-9]{64}$/.test(asset.sha256)
      || !Number.isSafeInteger(asset.size)
      || asset.size <= 0
      || asset.size > MAX_VIDEO_BYTES) return null;
    const assetUrl = new URL(asset.url);
    if (assetUrl.href !== `${ASSET_ORIGIN}/launcher-visuals/${asset.sha256}.mp4`) return null;
    const file = path.join(VISUALS, `${asset.sha256}.mp4`);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size !== asset.size) return null;
    const bytes = await fs.readFile(file);
    if (!isMp4(bytes) || sha256(bytes) !== asset.sha256) return null;
    return {
      kind: 'video',
      source: { endpoint: ENDFIELD_VISUALS_URL, officialUrl },
      assets: [{ ...asset, url: assetUrl.href }],
    };
  } catch {
    return null;
  }
}

async function buildEndfieldEntry(fetchImpl, previous) {
  try {
    const responseBytes = await fetchTrustedBytes(ENDFIELD_VISUALS_URL, {
      fetchImpl,
      maximum: 128 * 1024,
      accept: 'application/json',
      mediaTypes: ['application/json'],
      method: 'POST',
      body: ENDFIELD_REQUEST_JSON,
      contentType: 'application/json',
    });
    const officialUrl = parseOfficialEndfieldVideo(JSON.parse(responseBytes.toString('utf8')));
    const existing = await verifiedPreviousEndfieldEntry(previous, officialUrl);
    if (existing) return existing;
    try {
      const bytes = await fetchTrustedBytes(officialUrl, {
        fetchImpl,
        maximum: MAX_VIDEO_BYTES,
        accept: 'video/mp4',
        mediaTypes: ['video/mp4'],
        verifyContentMd5: true,
      });
      if (!isMp4(bytes)) throw new Error('Official Endfield launcher animation is not an MP4 file.');
      return {
        kind: 'video',
        source: { endpoint: ENDFIELD_VISUALS_URL, officialUrl },
        assets: [await mirror(bytes, '.mp4', 'video/mp4')],
      };
    } catch (error) {
      const fallback = await verifiedPreviousEndfieldEntry(previous);
      if (fallback) return fallback;
      throw new Error('No fresh or verified last-good Endfield launcher animation is available.', { cause: error });
    }
  } catch (error) {
    const fallback = await verifiedPreviousEndfieldEntry(previous);
    if (fallback) return fallback;
    throw new Error('No verified last-good Endfield launcher animation is available.', { cause: error });
  }
}

export async function buildLauncherVisuals({ fetchImpl = fetch, previousManifest = null } = {}) {
  const previous = previousManifest ?? await fs.readFile(OUTPUT, 'utf8').then(JSON.parse).catch(() => null);
  const games = await buildHoyoEntries(fetchImpl, previous?.games);
  const wuwa = await buildWuwaEntry(fetchImpl, previous?.games?.wuwa);
  if (!wuwa) throw new Error('No verified WuWa launcher background is available.');
  games.wuwa = wuwa;
  games.ae = await buildEndfieldEntry(fetchImpl, previous?.games?.ae);
  const revision = sha256(Buffer.from(JSON.stringify({ schema: 1, games })));
  const generatedAt = previous?.revision === revision && typeof previous?.generatedAt === 'string'
    ? previous.generatedAt
    : new Date().toISOString();
  return { schema: 1, revision, generatedAt, games };
}

export async function writeLauncherVisuals(options = {}) {
  const manifest = await buildLauncherVisuals(options);
  await fs.mkdir(GENERATED, { recursive: true });
  await fs.writeFile(OUTPUT, `${JSON.stringify(manifest, null, 2)}\n`);
  const keep = new Set(Object.values(manifest.games).flatMap((entry) => entry.assets.map((asset) => path.basename(new URL(asset.url).pathname))));
  for (const file of await fs.readdir(VISUALS).catch(() => [])) {
    if (!keep.has(file)) await fs.rm(path.join(VISUALS, file), { force: true });
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await writeLauncherVisuals();
  process.stdout.write(`launcher visuals: ${manifest.revision} (${Object.keys(manifest.games).join(', ')})\n`);
}
