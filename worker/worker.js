// ============================================================
// Nyxarium Cloudflare Worker
//
// Owns the gacha-history proxy the browser can't call directly (the
// HoYo/Kuro endpoints send no CORS headers). Ported from the proven
// As-I've-Hoarded worker, scoped to what Nyxarium needs.
//
// Routes:
//   POST /api/gacha/genshin|hsr|zzz   → HoYo getGachaLog proxy
//   POST /api/gacha/wuwa              → Kuro convene-record proxy
//   *    /api/account/*               → C2 first-party accounts (STUB)
//   else                              → static assets (when bound)
//
// Privacy: authkeys are forwarded server-to-server and never logged or
// cached (Cache-Control: no-store). Origins are allowlisted.
// ============================================================

const TRUSTED_ORIGINS = new Set([
  'https://asyce.com',
  'https://www.asyce.com',
  'https://nyxarium.com',
  'https://www.nyxarium.com',
  'https://asyce.pages.dev',
  'https://nyxarium.pages.dev',
]);
const TRUSTED_PAGES_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.(?:asyce|nyxarium)\.pages\.dev$/;
const LOCAL_ORIGIN_RE = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

const MAX_BODY_BYTES = 4096;
const UPSTREAM_TIMEOUT_MS = 20_000;

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

function envTrustedOrigins(env) {
  return String(env?.TRUSTED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function originAllowed(origin, env) {
  if (!origin) return true;
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

async function fetchUpstream(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, Object.assign({}, init, { signal: controller.signal }));
  } finally {
    clearTimeout(timeout);
  }
}

function upstreamErrorResponse(request, error, env) {
  const timedOut = error && error.name === 'AbortError';
  return jsonResponse(request, {
    error: timedOut ? 'Upstream timed out' : 'Upstream unreachable',
    status: timedOut ? 504 : 502,
  }, { status: timedOut ? 504 : 502 }, env);
}

async function readBody(request) {
  const len = Number(request.headers.get('Content-Length') || '0');
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) return { error: 'Request body too large', status: 413 };
  let payload;
  try { payload = await request.json(); } catch (e) { return { error: 'Invalid JSON body', status: 400 }; }
  if (!payload || typeof payload !== 'object') return { error: 'Expected an object body', status: 400 };
  return { payload };
}

async function handleHoyoGacha(request, gameKey, env) {
  if (!trustedOrigin(request, env)) return jsonResponse(request, { error: 'Origin not allowed', status: 403 }, { status: 403 }, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (request.method !== 'POST') return jsonResponse(request, { error: 'POST the gacha params in the body.', status: 405 }, { status: 405, headers: { Allow: 'POST, OPTIONS' } }, env);

  const base = HOYO_GACHA_HOSTS[gameKey];
  if (!base) return jsonResponse(request, { error: 'Unknown game "' + gameKey + '"', status: 400 }, { status: 400 }, env);

  const parsed = await readBody(request);
  if (parsed.error) return jsonResponse(request, { error: parsed.error, status: parsed.status }, { status: parsed.status }, env);
  const params = parsed.payload.params;
  if (!params || typeof params !== 'object') return jsonResponse(request, { error: 'Body must include a `params` object', status: 400 }, { status: 400 }, env);

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!HOYO_ALLOWED_PARAMS.has(key)) continue;
    if (value == null) continue;
    const str = String(value);
    if (str.length > 4096 || /[\r\n]/.test(str)) continue;
    search.set(key, str);
  }
  if (!search.has('authkey')) return jsonResponse(request, { error: 'Missing `authkey`', status: 400 }, { status: 400 }, env);

  let upstream;
  try {
    upstream = await fetchUpstream(base + '?' + search.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; nyxarium/1.0)' },
    });
  } catch (e) { return upstreamErrorResponse(request, e, env); }

  const body = await upstream.text();
  const headers = corsHeaders(request, env);
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json; charset=utf-8');
  return new Response(body, { status: upstream.status, headers });
}

async function handleWuwaGacha(request, env) {
  if (!trustedOrigin(request, env)) return jsonResponse(request, { error: 'Origin not allowed', status: 403 }, { status: 403 }, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (request.method !== 'POST') return jsonResponse(request, { error: 'POST the convene payload in the body.', status: 405 }, { status: 405, headers: { Allow: 'POST, OPTIONS' } }, env);

  const parsed = await readBody(request);
  if (parsed.error) return jsonResponse(request, { error: parsed.error, status: parsed.status }, { status: parsed.status }, env);
  const required = ['playerId', 'cardPoolType', 'cardPoolId', 'languageCode', 'recordId', 'serverId'];
  const body = {};
  for (const key of required) {
    const value = parsed.payload[key];
    if (value == null || String(value).length === 0) return jsonResponse(request, { error: 'Missing required field: ' + key, status: 400 }, { status: 400 }, env);
    body[key] = typeof value === 'number' ? value : String(value);
  }
  let upstream;
  try {
    upstream = await fetchUpstream(WUWA_GACHA_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; nyxarium/1.0)' },
      body: JSON.stringify(body),
    });
  } catch (e) { return upstreamErrorResponse(request, e, env); }

  const text = await upstream.text();
  const headers = corsHeaders(request, env);
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json; charset=utf-8');
  return new Response(text, { status: upstream.status, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/gacha/genshin') return handleHoyoGacha(request, 'genshin', env);
    if (url.pathname === '/api/gacha/hsr') return handleHoyoGacha(request, 'hsr', env);
    if (url.pathname === '/api/gacha/zzz') return handleHoyoGacha(request, 'zzz', env);
    if (url.pathname === '/api/gacha/wuwa') return handleWuwaGacha(request, env);

    // C2 first-party accounts (Phase 3b): auth + D1-backed sync land here.
    if (url.pathname.startsWith('/api/account/')) {
      return jsonResponse(request, { error: 'Accounts not implemented yet', status: 501 }, { status: 501 }, env);
    }

    // Static assets, when an [assets] binding exists (production / full
    // `wrangler dev`). API-only `wrangler dev` has no binding → 404.
    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
