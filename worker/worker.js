// ============================================================
// Pengo/Nyx Cloudflare Worker
//
// Owns the gacha-history proxy the browser can't call directly (the
// HoYo/Kuro endpoints send no CORS headers). Scoped to the Pengo/Nyx
// browser app.
//
// Routes:
//   POST /api/gacha/genshin|hsr|zzz   → HoYo getGachaLog proxy
//   POST /api/gacha/wuwa              → Kuro convene-record proxy
//   POST /api/account/sync/*          -> encrypted pull-history sync
//   else                              → static assets (when bound)
//
// Privacy & abuse controls:
//   - authkeys are forwarded server-to-server, never logged or cached
//     (Cache-Control: no-store). Request bodies are never logged.
//   - Origins are allowlisted; browser-facing proxy requests from unknown
//     origins are rejected.
//   - Request bodies are capped at 8 KiB, enforced by streaming even when
//     Content-Length is absent.
//   - Per-IP rate limit (60/min/endpoint) when the GACHA_RL binding exists.
//   - Errors use a stable envelope { ok:false, error:{ code, message, requestId } }
//     and never leak upstream secrets.
// ============================================================

const TRUSTED_ORIGINS = new Set([
  'https://pengo.gg',
  'https://www.pengo.gg',
  'https://pengo.pages.dev',
]);
const TRUSTED_PAGES_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.pengo\.pages\.dev$/;
const LOCAL_ORIGIN_RE = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

const MAX_BODY_BYTES = 8192; // 8 KiB
const MAX_ACCOUNT_BODY_BYTES = 3 * 1024 * 1024; // encrypted pull bundles
const UPSTREAM_TIMEOUT_MS = 20_000;
const RATE_LIMIT_PER_MIN = 60;
const DATABASE_ASSET_ORIGIN = 'https://assets.pengo.gg';

const HOYO_GACHA_HOSTS = {
  genshin: 'https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog',
  hsr: 'https://public-operation-hkrpg-sg.hoyoverse.com/common/gacha_record/api/getGachaLog',
  zzz: 'https://public-operation-nap-sg.hoyoverse.com/common/gacha_record/api/getGachaLog',
};
const WUWA_GACHA_URL = 'https://gmserver-api.aki-game2.net/gacha/record/query';

const HOYO_ALLOWED_PARAMS = new Set([
  'authkey', 'authkey_ver', 'sign_type', 'auth_appid', 'init_type',
  'gacha_id', 'gacha_type', 'real_gacha_type', 'lang', 'size', 'end_id',
  'begin_id', 'region', 'game_biz', 'timestamp', 'plat_type', 'page',
]);
const ACCOUNT_GAMES = new Set(['gi', 'genshin', 'hsr', 'zzz', 'wuwa', 'ae', 'endfield']);

function requestId() {
  try { return crypto.randomUUID(); } catch { return 'req-' + Date.now().toString(36); }
}

function envTrustedOrigins(env) {
  return String(env?.TRUSTED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function originAllowed(origin, env) {
  if (!origin) return String(env?.ALLOW_NO_ORIGIN || '').toLowerCase() === 'true';
  if (TRUSTED_ORIGINS.has(origin)) return true;
  if (LOCAL_ORIGIN_RE.test(origin)) return true;
  if (TRUSTED_PAGES_PREVIEW_RE.test(origin)) return true;
  return envTrustedOrigins(env).includes(origin);
}

function corsHeaders(request, env) {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store, private',
    Vary: 'Origin',
  });
  const origin = request.headers.get('Origin');
  if (origin && originAllowed(origin, env)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function trustedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  return originAllowed(origin, env);
}

function jsonResponse(request, body, init, env) {
  const headers = new Headers((init && init.headers) || undefined);
  for (const [k, v] of corsHeaders(request, env)) headers.set(k, v);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), Object.assign({}, init, { headers }));
}

// Stable error envelope. `message` is safe, user-facing text — never an upstream
// body or secret.
function errorResponse(request, env, { status, code, message, rid, headers }) {
  return jsonResponse(
    request,
    { ok: false, error: { code, message, requestId: rid } },
    { status, headers },
    env
  );
}

async function fetchUpstream(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, Object.assign({}, init, { signal: controller.signal }));
  } finally {
    clearTimeout(timeout);
  }
}

function upstreamErrorResponse(request, error, env, rid) {
  const timedOut = error && error.name === 'AbortError';
  return errorResponse(request, env, {
    status: timedOut ? 504 : 502,
    code: timedOut ? 'upstream_timeout' : 'upstream_unreachable',
    message: timedOut ? 'The game server timed out. Try again.' : 'Could not reach the game server. Try again.',
    rid,
  });
}

// Read + parse a JSON body with a hard size cap, enforced by streaming so an
// absent/forged Content-Length can't smuggle a huge payload past the check.
async function readJsonCapped(request, max) {
  const declared = Number(request.headers.get('Content-Length') || '0');
  if (Number.isFinite(declared) && declared > max) return { error: 'too_large' };
  if (!request.body) return { error: 'bad_json' };

  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    let chunk;
    try { chunk = await reader.read(); } catch { return { error: 'bad_json' }; }
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > max) { try { await reader.cancel(); } catch {} return { error: 'too_large' }; }
    chunks.push(chunk.value);
  }
  const buf = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { buf.set(c, offset); offset += c.byteLength; }

  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(buf)); } catch { return { error: 'bad_json' }; }
  if (!payload || typeof payload !== 'object') return { error: 'bad_object' };
  return { payload };
}

function bodyError(request, env, kind, rid) {
  if (kind === 'too_large') return errorResponse(request, env, { status: 413, code: 'body_too_large', message: 'Request body too large.', rid });
  if (kind === 'bad_object') return errorResponse(request, env, { status: 400, code: 'bad_request', message: 'Expected a JSON object body.', rid });
  return errorResponse(request, env, { status: 400, code: 'invalid_json', message: 'Invalid JSON body.', rid });
}

async function shaHex(text) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text || '')));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeAccountGame(game) {
  const key = String(game || '').toLowerCase();
  if (key === 'genshin') return 'gi';
  if (key === 'endfield') return 'ae';
  return key;
}

function validAccountId(value) {
  return /^[a-f0-9]{32,64}$/i.test(String(value || ''));
}

function validAccountToken(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ''));
}

function syncStorage(env) {
  return env && env.PULL_SYNC && typeof env.PULL_SYNC.get === 'function' && typeof env.PULL_SYNC.put === 'function'
    ? env.PULL_SYNC
    : null;
}

function syncKey(accountId, game) {
  return 'pulls:v1:' + accountId + ':' + game;
}

function syncAuthKey(accountId) {
  return 'auth:v1:' + accountId;
}

function validEncryptedPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.format !== 'nyx-pull-sync-v1') return false;
  if (!payload.iv || !payload.ciphertext) return false;
  if (String(payload.iv).length > 128) return false;
  if (String(payload.ciphertext).length > MAX_ACCOUNT_BODY_BYTES) return false;
  return true;
}

async function requireSyncAuth(request, env, store, accountId, token, rid, opts) {
  const tokenHash = await shaHex(token);
  const key = syncAuthKey(accountId);
  const existing = await store.get(key, 'json');
  if (!existing) {
    if (!opts || !opts.create) {
      return {
        error: errorResponse(request, env, { status: 404, code: 'sync_not_found', message: 'No Pengo sync account exists for that phrase yet.', rid }),
      };
    }
    await store.put(key, JSON.stringify({ tokenHash, createdAt: new Date().toISOString() }));
    return { ok: true };
  }
  if (existing.tokenHash !== tokenHash) {
    return {
      error: errorResponse(request, env, { status: 403, code: 'sync_auth_failed', message: 'That sync phrase does not match this Pengo sync account.', rid }),
    };
  }
  return { ok: true };
}

async function handleAccountSync(request, action, env) {
  const rid = requestId();
  if (!trustedOrigin(request, env)) return errorResponse(request, env, { status: 403, code: 'origin_not_allowed', message: 'Origin not allowed.', rid });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (request.method !== 'POST') return errorResponse(request, env, { status: 405, code: 'method_not_allowed', message: 'POST a sync request body.', rid, headers: { Allow: 'POST, OPTIONS' } });

  const store = syncStorage(env);
  if (!store) return errorResponse(request, env, { status: 501, code: 'sync_not_configured', message: 'Pengo sync storage is not configured yet.', rid });

  if (await rateLimited(request, env, 'account-sync:' + action)) {
    return errorResponse(request, env, { status: 429, code: 'rate_limited', message: 'Too many sync requests. Try again in a minute.', rid, headers: { 'Retry-After': '60' } });
  }

  const parsed = await readJsonCapped(request, MAX_ACCOUNT_BODY_BYTES);
  if (parsed.error) return bodyError(request, env, parsed.error, rid);
  const body = parsed.payload;
  const accountId = String(body.accountId || '').toLowerCase();
  const token = String(body.token || '').toLowerCase();
  const game = normalizeAccountGame(body.game);
  if (!validAccountId(accountId)) return errorResponse(request, env, { status: 400, code: 'bad_account', message: 'Invalid sync account id.', rid });
  if (!validAccountToken(token)) return errorResponse(request, env, { status: 400, code: 'bad_token', message: 'Invalid sync token.', rid });
  if (!ACCOUNT_GAMES.has(game)) return errorResponse(request, env, { status: 400, code: 'bad_game', message: 'Invalid sync game.', rid });

  const auth = await requireSyncAuth(request, env, store, accountId, token, rid, { create: action === 'push' });
  if (auth.error) return auth.error;

  const key = syncKey(accountId, game);
  if (action === 'push') {
    if (!validEncryptedPayload(body.payload)) return errorResponse(request, env, { status: 400, code: 'bad_payload', message: 'Invalid encrypted sync payload.', rid });
    const incomingExportedAt = Number(body.exportedAt || Date.now());
    // Stale-push guard: block only when the incoming copy is STRICTLY older than
    // what's stored, and never when the client explicitly forces. A push with no
    // exportedAt defaults to "now", so it is treated as current and never blocked;
    // equal timestamps (a re-push of the same export) are allowed. This makes the
    // force path always reachable and a legitimate save impossible to lock out.
    if (body.force !== true) {
      const existing = await store.get(key, 'json');
      const priorExportedAt = existing ? Number(existing.exportedAt) : NaN;
      if (existing && Number.isFinite(priorExportedAt) && incomingExportedAt < priorExportedAt) {
        return jsonResponse(request, {
          ok: false,
          error: { code: 'stale_push', message: 'The saved Pengo copy is newer than this device. Restore first, or upload anyway to overwrite it.', requestId: rid },
          serverExportedAt: existing.exportedAt || null,
        }, { status: 409 }, env);
      }
    }
    const updatedAt = new Date().toISOString();
    const record = {
      version: 1,
      accountId,
      game,
      payload: body.payload,
      exportedAt: incomingExportedAt,
      updatedAt,
      size: JSON.stringify(body.payload).length,
    };
    await store.put(key, JSON.stringify(record));
    return jsonResponse(request, { ok: true, updatedAt, size: record.size }, { status: 200 }, env);
  }

  if (action === 'delete') {
    if (typeof store.delete !== 'function') return errorResponse(request, env, { status: 501, code: 'sync_not_configured', message: 'Pengo sync storage cannot delete right now.', rid });
    // Idempotent: removing the game blob returns ok whether or not it existed.
    // The auth record is intentionally left in place — it holds only a token
    // hash, and keeping it lets the user re-sync the same phrase later.
    await store.delete(key);
    return jsonResponse(request, { ok: true, deleted: true }, { status: 200 }, env);
  }

  const record = await store.get(key, 'json');
  if (!record) return errorResponse(request, env, { status: 404, code: 'sync_empty', message: 'No synced history was found for this game.', rid });
  if (action === 'status') {
    return jsonResponse(request, { ok: true, exists: true, updatedAt: record.updatedAt || null, exportedAt: record.exportedAt || null, size: record.size || null }, { status: 200 }, env);
  }
  if (action === 'pull') {
    return jsonResponse(request, { ok: true, payload: record.payload, updatedAt: record.updatedAt || null, exportedAt: record.exportedAt || null, size: record.size || null }, { status: 200 }, env);
  }
  return errorResponse(request, env, { status: 404, code: 'not_found', message: 'Unknown sync action.', rid });
}

// Best-effort per-IP rate limit. Uses the GACHA_RL rate-limiting binding when
// configured; silently no-ops when absent (e.g. local dev) so requests still work.
async function rateLimited(request, env, bucket) {
  const rl = env && env.GACHA_RL;
  if (!rl || typeof rl.limit !== 'function') return false;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    const { success } = await rl.limit({ key: bucket + ':' + ip });
    return !success;
  } catch {
    return false;
  }
}

async function handleHoyoGacha(request, gameKey, env) {
  const rid = requestId();
  if (!trustedOrigin(request, env)) return errorResponse(request, env, { status: 403, code: 'origin_not_allowed', message: 'Origin not allowed.', rid });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (request.method !== 'POST') return errorResponse(request, env, { status: 405, code: 'method_not_allowed', message: 'POST the gacha params in the body.', rid, headers: { Allow: 'POST, OPTIONS' } });

  if (await rateLimited(request, env, 'gacha:' + gameKey)) {
    return errorResponse(request, env, { status: 429, code: 'rate_limited', message: 'Too many requests. Try again in a minute.', rid, headers: { 'Retry-After': '60' } });
  }

  const base = HOYO_GACHA_HOSTS[gameKey];
  if (!base) return errorResponse(request, env, { status: 400, code: 'unknown_game', message: 'Unknown game.', rid });

  const parsed = await readJsonCapped(request, MAX_BODY_BYTES);
  if (parsed.error) return bodyError(request, env, parsed.error, rid);
  const params = parsed.payload.params;
  if (!params || typeof params !== 'object') return errorResponse(request, env, { status: 400, code: 'missing_params', message: 'Body must include a `params` object.', rid });

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!HOYO_ALLOWED_PARAMS.has(key)) continue;
    if (value == null) continue;
    const str = String(value);
    if (str.length > 4096 || /[\r\n]/.test(str)) continue;
    search.set(key, str);
  }
  if (!search.has('authkey')) return errorResponse(request, env, { status: 400, code: 'missing_authkey', message: 'Missing `authkey`.', rid });

  let upstream;
  try {
    upstream = await fetchUpstream(base + '?' + search.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; pengo-nyx/1.0)' },
    });
  } catch (e) { return upstreamErrorResponse(request, e, env, rid); }

  const body = await upstream.text();
  const headers = corsHeaders(request, env);
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json; charset=utf-8');
  return new Response(body, { status: upstream.status, headers });
}

async function handleWuwaGacha(request, env) {
  const rid = requestId();
  if (!trustedOrigin(request, env)) return errorResponse(request, env, { status: 403, code: 'origin_not_allowed', message: 'Origin not allowed.', rid });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (request.method !== 'POST') return errorResponse(request, env, { status: 405, code: 'method_not_allowed', message: 'POST the convene payload in the body.', rid, headers: { Allow: 'POST, OPTIONS' } });

  if (await rateLimited(request, env, 'gacha:wuwa')) {
    return errorResponse(request, env, { status: 429, code: 'rate_limited', message: 'Too many requests. Try again in a minute.', rid, headers: { 'Retry-After': '60' } });
  }

  const parsed = await readJsonCapped(request, MAX_BODY_BYTES);
  if (parsed.error) return bodyError(request, env, parsed.error, rid);
  const required = ['playerId', 'cardPoolType', 'cardPoolId', 'languageCode', 'recordId', 'serverId'];
  const body = {};
  for (const key of required) {
    const value = parsed.payload[key];
    if (value == null || String(value).length === 0) return errorResponse(request, env, { status: 400, code: 'missing_field', message: 'Missing required field: ' + key, rid });
    body[key] = typeof value === 'number' ? value : String(value);
  }
  let upstream;
  try {
    upstream = await fetchUpstream(WUWA_GACHA_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; pengo-nyx/1.0)' },
      body: JSON.stringify(body),
    });
  } catch (e) { return upstreamErrorResponse(request, e, env, rid); }

  const text = await upstream.text();
  const headers = corsHeaders(request, env);
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json; charset=utf-8');
  return new Response(text, { status: upstream.status, headers });
}

function assetRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === '/') url.pathname = '/index.html';
  return new Request(url, request);
}

function databaseLegacyKey(url) {
  if (/%(?:2f|5c)/i.test(url.pathname) || /%25(?:2e|2f|5c)/i.test(url.pathname)) return null;
  let decoded;
  try { decoded = decodeURIComponent(url.pathname); } catch { return null; }
  if (!decoded.startsWith('/Database/')) return null;
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.includes('\r') || decoded.includes('\n')) return null;
  const parts = decoded.slice(1).split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  return 'legacy/' + parts.join('/');
}

function encodedAssetKey(key) {
  return key.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function etagMatches(condition, etag, weak) {
  if (!condition || !etag) return false;
  if (condition.trim() === '*') return true;
  const normalize = (value) => {
    const trimmed = value.trim();
    return weak ? trimmed.replace(/^W\//i, '') : trimmed;
  };
  const expected = normalize(etag);
  return condition.split(',').some((candidate) => {
    const trimmed = candidate.trim();
    if (!weak && /^W\//i.test(trimmed)) return false;
    return normalize(trimmed) === expected;
  });
}

function failedConditionalStatus(request, object) {
  const headers = request.headers;
  const etag = object.httpEtag || '';
  const uploadedMs = object.uploaded ? new Date(object.uploaded).getTime() : NaN;
  // HTTP dates have one-second precision. Compare R2's millisecond timestamp
  // at the same precision so an object from the matching second is not treated
  // as spuriously newer.
  const uploaded = Number.isFinite(uploadedMs) ? Math.floor(uploadedMs / 1000) * 1000 : NaN;
  const ifMatch = headers.get('If-Match');
  if (ifMatch) {
    if (!etagMatches(ifMatch, etag, false)) return 412;
  } else {
    const unmodifiedSince = Date.parse(headers.get('If-Unmodified-Since') || '');
    if (Number.isFinite(unmodifiedSince) && Number.isFinite(uploaded) && uploaded > unmodifiedSince) return 412;
  }
  const ifNoneMatch = headers.get('If-None-Match');
  if (ifNoneMatch) {
    if (etagMatches(ifNoneMatch, etag, true)) return 304;
  } else {
    const modifiedSince = Date.parse(headers.get('If-Modified-Since') || '');
    if (Number.isFinite(modifiedSince) && Number.isFinite(uploaded) && uploaded <= modifiedSince) return 304;
  }
  // R2 omitted the body because an onlyIf condition failed. If it cannot be
  // classified as a cache validator, fail closed as a precondition failure.
  return 412;
}

async function emergencyDatabaseAsset(request, env, key) {
  if (String(env?.DATABASE_ASSETS_EMERGENCY || '').toLowerCase() !== 'true') return null;
  const bucket = env?.DATABASE_ASSETS;
  if (!bucket || typeof bucket.get !== 'function') return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  let object;
  try {
    object = await bucket.get(key, {
      onlyIf: request.headers,
      range: request.headers,
    });
  } catch (error) {
    if (error?.status === 416) {
      return new Response('Range not satisfiable', {
        status: 416,
        headers: { 'Accept-Ranges': 'bytes' },
      });
    }
    throw error;
  }
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers({
    'Cache-Control': 'public, max-age=300, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  });
  if (object.writeHttpMetadata) object.writeHttpMetadata(headers);
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  if (!object.body) return new Response(null, { status: failedConditionalStatus(request, object), headers });
  let status = 200;
  if (object.range) {
    const offset = Number(object.range.offset || 0);
    const length = Number(object.range.length || 0);
    const size = Number(object.size || offset + length);
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${size}`);
    headers.set('Content-Length', String(length));
    status = 206;
  } else if (Number.isFinite(Number(object.size))) {
    headers.set('Content-Length', String(object.size));
  }
  return new Response(request.method === 'HEAD' ? null : object.body, { status, headers });
}

async function handleLegacyDatabaseAsset(request, env, url) {
  const key = databaseLegacyKey(url);
  if (!key) return new Response('Bad Database asset path', { status: 400 });
  const emergency = await emergencyDatabaseAsset(request, env, key);
  if (emergency) return emergency;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const redirectOverride = String(env?.DATABASE_ASSET_LEGACY_REDIRECT || 'auto').toLowerCase();
  if (redirectOverride !== 'true' && env?.ASSETS && typeof env.ASSETS.fetch === 'function') {
    const staticResponse = await env.ASSETS.fetch(assetRequest(request));
    if (redirectOverride === 'false' || staticResponse.status !== 404) return staticResponse;
  }
  const location = `${DATABASE_ASSET_ORIGIN}/${encodedAssetKey(key)}${url.search}`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'public, max-age=300, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// Gallery art lives on assets.pengo.gg, and the page CSP is `connect-src
// 'self'` — so the browser can DISPLAY an asset but cannot read its bytes. The
// gallery lightbox needs the bytes to offer Download and Copy-image, so this
// streams a single asset back through the site's own origin.
//
// Deliberately narrow: only the content-addressed object layout the asset
// pipeline emits (objects/sha256/<2 hex>/<64 hex>.<ext>, see
// buildDatabaseAssetEntry in Site/tools/database-assets.mjs). No user-supplied
// host, no path traversal, no arbitrary key — anything else is a 400, so this
// cannot be turned into an open proxy.
const DATABASE_OBJECT_KEY_RE = /^objects\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}\.(?:png|jpe?g|webp|gif|avif)$/;
const DATABASE_ASSET_PROXY_PREFIX = '/api/asset/';

async function handleDatabaseAssetProxy(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  let key;
  try { key = decodeURIComponent(url.pathname.slice(DATABASE_ASSET_PROXY_PREFIX.length)); } catch { return new Response('Bad asset key', { status: 400 }); }
  if (!DATABASE_OBJECT_KEY_RE.test(key)) return new Response('Bad asset key', { status: 400 });

  const upstream = await fetch(`${DATABASE_ASSET_ORIGIN}/${encodedAssetKey(key)}`, {
    method: request.method,
    headers: { Accept: request.headers.get('Accept') || 'image/*' },
    redirect: 'follow',
  });
  if (!upstream.ok) return new Response('Asset not found', { status: upstream.status === 404 ? 404 : 502 });

  const headers = new Headers();
  const type = upstream.headers.get('Content-Type');
  if (type) headers.set('Content-Type', type);
  const length = upstream.headers.get('Content-Length');
  if (length) headers.set('Content-Length', length);
  headers.set('Cache-Control', 'public, max-age=86400, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  // Same-origin only. The point of this route is to satisfy `connect-src
  // 'self'` for our own page, not to hand the assets to other sites.
  headers.set('Vary', 'Accept');
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: 200, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith(DATABASE_ASSET_PROXY_PREFIX)) return handleDatabaseAssetProxy(request, env, url);
    if (url.pathname.startsWith('/Database/')) return handleLegacyDatabaseAsset(request, env, url);

    if (url.pathname === '/api/gacha/genshin') return handleHoyoGacha(request, 'genshin', env);
    if (url.pathname === '/api/gacha/hsr') return handleHoyoGacha(request, 'hsr', env);
    if (url.pathname === '/api/gacha/zzz') return handleHoyoGacha(request, 'zzz', env);
    if (url.pathname === '/api/gacha/wuwa') return handleWuwaGacha(request, env);

    if (url.pathname === '/api/account/sync/push') return handleAccountSync(request, 'push', env);
    if (url.pathname === '/api/account/sync/pull') return handleAccountSync(request, 'pull', env);
    if (url.pathname === '/api/account/sync/status') return handleAccountSync(request, 'status', env);
    if (url.pathname === '/api/account/sync/delete') return handleAccountSync(request, 'delete', env);
    if (url.pathname.startsWith('/api/account/')) {
      return errorResponse(request, env, { status: 404, code: 'not_found', message: 'Unknown account endpoint.', rid: requestId() });
    }

    // Static assets, when an [assets] binding exists (production / full
    // `wrangler dev`). API-only `wrangler dev` has no binding → 404.
    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(assetRequest(request));
    return new Response('Not found', { status: 404 });
  },
};
