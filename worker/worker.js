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
//   *    /api/account/*               → first-party accounts (disabled, 501)
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
const UPSTREAM_TIMEOUT_MS = 20_000;
const RATE_LIMIT_PER_MIN = 60;

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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/gacha/genshin') return handleHoyoGacha(request, 'genshin', env);
    if (url.pathname === '/api/gacha/hsr') return handleHoyoGacha(request, 'hsr', env);
    if (url.pathname === '/api/gacha/zzz') return handleHoyoGacha(request, 'zzz', env);
    if (url.pathname === '/api/gacha/wuwa') return handleWuwaGacha(request, env);

    // First-party accounts (Phase 3b): auth + D1-backed sync land here. Disabled.
    if (url.pathname.startsWith('/api/account/')) {
      return errorResponse(request, env, { status: 501, code: 'not_implemented', message: 'Accounts are not available yet.', rid: requestId() });
    }

    // Static assets, when an [assets] binding exists (production / full
    // `wrangler dev`). API-only `wrangler dev` has no binding → 404.
    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(assetRequest(request));
    return new Response('Not found', { status: 404 });
  },
};
