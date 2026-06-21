// ============================================================
// Nyx — wish/gacha import engine  (window.NyxPulls)
//
// Ported from the proven As-I've-Hoarded "asivepulled" adapters, but
// rewritten as a self-contained browser global (no ES imports) so it
// drops straight into Site's esbuild IIFE bundle.
//
// Responsibilities:
//   • parse a pasted in-game history URL into auth params
//   • walk every banner via the Worker proxy (/api/gacha/*) and
//     normalize each page into the cross-game PullRecord shape
//   • turn imported pulls into the view object the GachaTracker UI
//     already renders (pity, 50/50, 5★ history, distribution, stream)
//
// Only Genshin ('gi') is wired for now; HSR/ZZZ/WuWa adapters slot in
// behind the same interface in Phase 2. Endfield ('ae') has no public
// endpoint yet → treated as "coming soon" by the UI.
//
// The proxy base is window.NYX_API_BASE (default same-origin). During
// local `python -m http.server` dev you can point it at a `wrangler dev`
// instance or at https://asyce.com (both allowlist localhost origins).
// ============================================================

window.NyxPulls = (function () {
  'use strict';

  const API_BASE = () =>
    (typeof window !== 'undefined' && window.NYX_API_BASE) || '';

  // ---- Genshin banner table (gacha_type → internal key) --------------
  const GI_BANNERS = [
    { key: 'character',  code: '301', label: 'Character Event Wish',   pityHard5: 90, pityHard4: 10, hasFiftyFifty: true },
    { key: 'character2', code: '400', label: 'Character Event Wish-2', pityHard5: 90, pityHard4: 10, hasFiftyFifty: true },
    { key: 'weapon',     code: '302', label: 'Weapon Event Wish',      pityHard5: 80, pityHard4: 10, hasFiftyFifty: true },
    { key: 'chronicled', code: '500', label: 'Chronicled Wish',        pityHard5: 90, pityHard4: 10, hasFiftyFifty: true },
    { key: 'standard',   code: '200', label: 'Standard Wish',          pityHard5: 90, pityHard4: 10 },
    { key: 'beginner',   code: '100', label: "Beginner's Wish",        pityHard5: 20, pityHard4: 10 },
  ];

  // The seven permanent 5★ characters. A 5★ *character* on the event
  // banner that belongs to this pool counts as a lost 50/50 (you got a
  // standard unit instead of the rate-up). Standard inference used by
  // every community tracker; rare edge case when a former standard unit
  // is itself the featured rate-up, which we accept for v1.
  const GI_STANDARD_5 = new Set([
    'Diluc', 'Jean', 'Keqing', 'Mona', 'Qiqi', 'Tighnari', 'Dehya',
  ]);

  // Region → UTC offset (hours). Genshin also returns region_time_zone
  // on every page, which we prefer when present.
  const REGION_TZ = { cn_gf01: 8, cn_qd01: 8, os_usa: -5, os_euro: 1, os_asia: 8, os_cht: 8 };

  function tzOffsetMs(region, override) {
    const hours = override != null ? override : (REGION_TZ[region] != null ? REGION_TZ[region] : 0);
    return hours * 3600000;
  }

  function parseServerTime(time, offsetMs) {
    const m = String(time).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return Date.parse(time + 'Z') || 0;
    const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return asUtc - offsetMs;
  }

  // ---- Genshin auth parse -------------------------------------------
  const GI_REQUIRED = ['authkey', 'authkey_ver', 'sign_type'];

  function parseGiAuth(url) {
    const trimmed = (url || '').trim();
    if (!trimmed) return { error: 'Paste a wish-history URL.' };
    let parsed;
    try { parsed = new URL(trimmed); } catch (e) { return { error: 'That does not look like a valid URL.' }; }
    const params = parsed.searchParams;
    for (const key of GI_REQUIRED) {
      if (!params.get(key)) return { error: 'Missing "' + key + '" — make sure you copied the whole link.' };
    }
    const region = params.get('region') || '';
    if (!region) return { error: 'Missing region in the URL.' };
    return { rawQuery: parsed.search.replace(/^\?/, ''), region, lang: params.get('lang') || 'en' };
  }

  // ---- Genshin import (paginate every banner via the proxy) ----------
  async function fetchGiPage(auth, banner, endId) {
    const params = Object.fromEntries(new URLSearchParams(auth.rawQuery));
    params.gacha_type = banner.code;
    params.size = '20';
    params.end_id = endId;
    params.lang = auth.lang;
    params.region = auth.region;
    const res = await fetch(API_BASE() + '/api/gacha/genshin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params }),
    });
    const body = await res.text();
    try { return JSON.parse(body); }
    catch (e) { throw new Error('Upstream returned non-JSON (HTTP ' + res.status + '): ' + body.slice(0, 120)); }
  }

  async function importGenshin(auth, onProgress) {
    const collected = [];
    let uid = '';
    for (let i = 0; i < GI_BANNERS.length; i++) {
      const banner = GI_BANNERS[i];
      let endId = '0';
      let done = false;
      let fetched = 0;
      while (!done) {
        const page = await fetchGiPage(auth, banner, endId);
        if (page.retcode !== 0 || !page.data) {
          throw new Error(page.message || ('Genshin upstream error (retcode ' + page.retcode + ')'));
        }
        const offset = tzOffsetMs(auth.region, page.data.region_time_zone);
        const list = page.data.list || [];
        if (list.length === 0) { done = true; break; }
        uid = uid || list[0].uid;
        for (const raw of list) {
          collected.push({
            id: raw.id,
            banner: banner.key,
            name: raw.name,
            itemId: raw.item_id || '',
            itemType: (raw.item_type === 'Weapon' || raw.item_type === '武器') ? 'weapon' : 'character',
            rank: parseInt(raw.rank_type, 10),
            time: parseServerTime(raw.time, offset),
          });
        }
        fetched += list.length;
        endId = list[list.length - 1].id;
        if (onProgress) onProgress({ bannerLabel: banner.label, bannerIndex: i, bannerTotal: GI_BANNERS.length, fetched: fetched });
        await new Promise((r) => setTimeout(r, 250));
        if (list.length < 20) done = true;
      }
    }
    return { pulls: collected, uid: uid };
  }

  // ---- item resolution: pull → local art / rarity / element ----------
  // Reuses the already-loaded Character Materials roster (window.CM_CFG)
  // — each char carries id ("gi-10000114" → numeric == gacha item_id),
  // name, rarity (r), element (el), weapon type (w), icon, gacha art.
  // Resolving by item_id first makes visuals language-proof; name is the
  // fallback for imported/UIGF data. Weapons aren't in this roster yet →
  // they resolve to null and the UI shows a rarity-colored placeholder
  // until the weapon-asset pipeline lands.
  function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  const _itemIndex = {};
  function itemIndex(gameKey) {
    if (_itemIndex[gameKey]) return _itemIndex[gameKey];
    const cfg = (typeof window !== 'undefined' && window.CM_CFG && window.CM_CFG[gameKey]) || null;
    const roster = (cfg && (cfg.chars || cfg.roster)) || [];
    const byName = {}, byId = {};
    for (const c of roster) {
      const meta = { name: c.n, rarity: c.r, element: c.el, weaponType: c.w, icon: c.icon, art: c.art, kind: 'character' };
      if (c.n) byName[normName(c.n)] = meta;
      if (c.id) byId[String(c.id).replace(/^[a-z]+-/i, '')] = meta;
      // HSR/ZZZ cm-data ids are slugs; the numeric avatar id (== gacha
      // item_id) is embedded in the icon path — index by that too.
      const num = String(c.icon || c.art || '').match(/(\d{3,})\.(?:webp|png|jpe?g)/i);
      if (num) byId[num[1]] = meta;
    }
    _itemIndex[gameKey] = { byName: byName, byId: byId, ready: roster.length > 0 };
    return _itemIndex[gameKey];
  }

  // Weapons live in a separate generated global (window.NYX_WEAPONS[game]),
  // id-indexed from the local Nanoka mirror by tools/gen-weapons-meta.mjs.
  const _weaponIndex = {};
  function weaponIndex(gameKey) {
    if (_weaponIndex[gameKey]) return _weaponIndex[gameKey];
    const src = (typeof window !== 'undefined' && window.NYX_WEAPONS && window.NYX_WEAPONS[gameKey]) || {};
    const byName = {}, byId = {};
    for (const id in src) {
      const w = src[id];
      const meta = { name: w.name, rarity: w.rarity, element: null, weaponType: w.type, icon: w.art, art: w.art, kind: 'weapon' };
      byId[id] = meta;
      if (w.name) byName[normName(w.name)] = meta;
    }
    _weaponIndex[gameKey] = { byName: byName, byId: byId };
    return _weaponIndex[gameKey];
  }

  function resolveItem(gameKey, pull) {
    const ix = itemIndex(gameKey);
    if (pull.itemId && ix.byId[String(pull.itemId)]) return ix.byId[String(pull.itemId)];
    if (pull.name && ix.byName[normName(pull.name)]) return ix.byName[normName(pull.name)];
    const wx = weaponIndex(gameKey);
    if (pull.itemId && wx.byId[String(pull.itemId)]) return wx.byId[String(pull.itemId)];
    if (pull.name && wx.byName[normName(pull.name)]) return wx.byName[normName(pull.name)];
    return null;
  }

  // ---- view builder: imported pulls → GachaTracker render shape -------
  // Emits exactly the object the existing results UI consumes (same
  // shape as the old simulator), computed on the *character* banner so
  // pity / 50-50 / soft-pity at 74 all line up with the rendered bar.
  function sortPulls(a, b) {
    if (a.time !== b.time) return a.time - b.time;
    return String(a.id).localeCompare(String(b.id));
  }

  // Per-banner display config for Genshin. soft/hard drive the pity bar
  // markers; ff = whether a 50/50 applies. Weapon soft/hard differ (63/80).
  const GI_VIEW_BANNERS = [
    { key: 'character',  label: 'Character',  keys: ['character', 'character2'], soft: 74, hard: 90, ff: true },
    { key: 'weapon',     label: 'Weapon',     keys: ['weapon'],     soft: 63, hard: 80, ff: false },
    { key: 'chronicled', label: 'Chronicled', keys: ['chronicled'], soft: 74, hard: 90, ff: true },
    { key: 'standard',   label: 'Standard',   keys: ['standard'],   soft: 74, hard: 90, ff: false },
    { key: 'beginner',   label: 'Beginner',   keys: ['beginner'],   soft: 74, hard: 90, ff: false },
  ];

  function bannerPulls(pulls, cfg) {
    return pulls.filter((p) => cfg.keys.indexOf(p.banner) >= 0).slice().sort(sortPulls);
  }

  // Compute one banner's view (pity, 5★ cards w/ local art, 50/50 when the
  // banner has it). 50/50 uses the standard-pool heuristic for now; it
  // becomes exact once the banner-history dataset lands.
  // ---- exact 50/50 via banner-history (window.NYX_BANNERS) -----------
  // Per game: [{ type:'character', start:ms, end:ms, featured5:[names] }].
  // When a 5★'s time falls in a known period we resolve win/lost exactly
  // (pulled unit == a featured unit); outside known data we fall back to
  // the standard-pool heuristic so nothing breaks before data lands.
  function makeFeaturedResolver(gameKey, bannerType) {
    const hist = (typeof window !== 'undefined' && window.NYX_BANNERS && window.NYX_BANNERS[gameKey]) || null;
    if (!hist) return null;
    const periods = hist.filter((b) => b.type === bannerType && Array.isArray(b.featured5) && b.featured5.length);
    if (!periods.length) return null;
    return function (timeMs) {
      for (const pd of periods) {
        if (timeMs >= pd.start && timeMs <= pd.end) {
          if (!pd._set) pd._set = new Set(pd.featured5.map(normName));
          return pd._set;
        }
      }
      return null;
    };
  }

  function computeBannerView(gameKey, banner, cfg, stdPool, featuredAt) {
    const fives = [], stream = [];
    let fourCount = 0, threeCount = 0, sinceFive = 0, guaranteedNext = false;
    banner.forEach((p) => {
      sinceFive++;
      stream.push(p.rank);
      if (p.rank === 4) fourCount++;
      else if (p.rank === 3) threeCount++;
      else if (p.rank === 5) {
        const pity = sinceFive;
        let ff = false, won = true, exact = false;
        if (cfg.ff) {
          if (guaranteedNext) { ff = false; won = true; guaranteedNext = false; }
          else {
            ff = true;
            const fset = featuredAt ? featuredAt(p.time) : null;
            won = fset ? fset.has(normName(p.name)) : !(stdPool && stdPool.has(p.name));
            exact = !!fset;
            if (!won) guaranteedNext = true;
          }
        }
        fives.push({ idx: stream.length, pity: pity, won: won, ff: ff, exact: exact, name: p.name, itemId: p.itemId, isWeapon: p.itemType === 'weapon' || p.itemType === 'light_cone' || p.itemType === 'w_engine' || p.itemType === 'bangboo' });
        sinceFive = 0;
      }
    });
    for (const f of fives) {
      const m = resolveItem(gameKey, f);
      if (m) { f.icon = m.icon; f.art = m.art; f.el = m.element; f.wtype = m.weaponType; if (!f.name && m.name) f.name = m.name; }
    }
    return {
      key: cfg.key, label: cfg.label, soft: cfg.soft, hard: cfg.hard, ff: cfg.ff,
      total: banner.length, fives: fives, fourCount: fourCount, threeCount: threeCount,
      currentPity: sinceFive, guaranteed: cfg.ff ? guaranteedNext : false, stream: stream,
    };
  }

  // Generic per-game banner-view builder. Adding a game = a view-banner
  // table + a standard pool.
  function buildViewsFor(gameKey, pulls, viewBanners, stdPool) {
    const featuredAt = makeFeaturedResolver(gameKey, 'character');
    const out = [];
    for (const cfg of viewBanners) {
      const b = bannerPulls(pulls, cfg);
      if (b.length) out.push(computeBannerView(gameKey, b, cfg, stdPool, cfg.ff ? featuredAt : null));
    }
    return out.length ? out : [computeBannerView(gameKey, [], viewBanners[0], stdPool, null)];
  }

  // Standard 5★/S pools for the 50/50 heuristic (interim until exact
  // banner-history lands). Only character/agent banners use it.
  const HSR_STANDARD_5 = new Set(['Bailu', 'Bronya', 'Clara', 'Gepard', 'Himeko', 'Welt', 'Yanqing']);
  const ZZZ_STANDARD_S = new Set(['Von Lycaon', 'Lycaon', 'Nekomata', 'Soldier 11', 'Grace Howard', 'Rina', 'Alexandrina Sebastiane', 'Koleda']);

  const HSR_VIEW_BANNERS = [
    { key: 'character', label: 'Character',  keys: ['character'], soft: 74, hard: 90, ff: true },
    { key: 'lightcone', label: 'Light Cone', keys: ['lightcone'], soft: 65, hard: 80, ff: false },
    { key: 'collab',    label: 'Collab',     keys: ['collab'],    soft: 74, hard: 90, ff: true },
    { key: 'collab_lc', label: 'Collab LC',  keys: ['collab_lc'], soft: 65, hard: 80, ff: false },
    { key: 'standard',  label: 'Stellar',    keys: ['standard'],  soft: 74, hard: 90, ff: false },
    { key: 'beginner',  label: 'Departure',  keys: ['beginner'],  soft: 50, hard: 50, ff: false },
  ];
  const ZZZ_VIEW_BANNERS = [
    { key: 'character', label: 'Agent',    keys: ['character'], soft: 75, hard: 90, ff: true },
    { key: 'wengine',   label: 'W-Engine', keys: ['wengine'],   soft: 65, hard: 80, ff: false },
    { key: 'bangboo',   label: 'Bangboo',  keys: ['bangboo'],   soft: 65, hard: 80, ff: false },
    { key: 'standard',  label: 'Stable',   keys: ['standard'],  soft: 74, hard: 90, ff: false },
  ];

  function buildGenshinView(pulls) {
    return computeBannerView('gi', bannerPulls(pulls, GI_VIEW_BANNERS[0]), GI_VIEW_BANNERS[0], GI_STANDARD_5);
  }
  function buildGenshinBannerViews(pulls) { return buildViewsFor('gi', pulls, GI_VIEW_BANNERS, GI_STANDARD_5); }
  function buildHsrBannerViews(pulls) { return buildViewsFor('hsr', pulls, HSR_VIEW_BANNERS, HSR_STANDARD_5); }
  function buildZzzBannerViews(pulls) { return buildViewsFor('zzz', pulls, ZZZ_VIEW_BANNERS, ZZZ_STANDARD_S); }

  // ---- import existing history (UIGF v4.x) ---------------------------
  // UIGF v4 is the community-standard interchange used by Paimon.moe,
  // Snap Hutao, stardb, HoYo.Gacha, etc. Genshin records live under the
  // `hk4e` array (hkrpg = HSR, nap = ZZZ — wired with those adapters).
  // Records may omit name/item_type and rely on item_id; we infer.
  const GI_CODE_KEY = (function () { const m = {}; for (const b of GI_BANNERS) m[b.code] = b.key; return m; })();

  function inferGiItemType(itemId, fallback) {
    if (fallback === 'weapon' || fallback === 'character') return fallback;
    // GI character item_ids are 8 digits (10000xxx); weapons are 5 (1xxxx).
    return String(itemId || '').length >= 8 ? 'character' : 'weapon';
  }

  function importUIGFGenshin(json) {
    const acc = json && json.hk4e && json.hk4e[0];
    if (!acc || !Array.isArray(acc.list)) return { error: 'No Genshin (hk4e) records found in this UIGF file.' };
    const offset = (acc.timezone != null ? acc.timezone : 8) * 3600000;
    const pulls = [];
    for (const it of acc.list) {
      const code = String(it.uigf_gacha_type != null ? it.uigf_gacha_type : (it.gacha_type != null ? it.gacha_type : ''));
      const key = GI_CODE_KEY[code];
      if (!key || it.id == null) continue;
      pulls.push({
        id: String(it.id),
        banner: key,
        name: it.name || '',
        itemId: String(it.item_id || ''),
        itemType: inferGiItemType(it.item_id, it.item_type === 'Weapon' || it.item_type === '武器' ? 'weapon' : (it.item_type ? 'character' : null)),
        rank: parseInt(it.rank_type, 10) || 0,
        time: parseServerTime(it.time, offset),
      });
    }
    return { uid: String(acc.uid || ''), pulls: pulls };
  }

  // ---- HSR / ZZZ live import (shared Hoyo getGachaLog pipeline) ------
  const HSR_BANNERS = [
    { key: 'character', code: '11', label: 'Character Event Warp' },
    { key: 'lightcone', code: '12', label: 'Light Cone Event Warp' },
    { key: 'standard',  code: '1',  label: 'Stellar Warp' },
    { key: 'beginner',  code: '2',  label: 'Departure Warp' },
    { key: 'collab',    code: '21', label: 'Collab Character Warp' },
    { key: 'collab_lc', code: '22', label: 'Collab Light Cone Warp' },
  ];
  const ZZZ_BANNERS = [
    { key: 'character', code: '2', label: 'Exclusive Channel' },
    { key: 'wengine',   code: '3', label: 'W-Engine Channel' },
    { key: 'bangboo',   code: '5', label: 'Bangboo Channel' },
    { key: 'standard',  code: '1', label: 'Stable Channel' },
  ];

  function tzOff(override, fallback) { return ((override != null ? override : (fallback != null ? fallback : 8)) || 0) * 3600000; }

  function normalizeHsr(banner, raw, offset) {
    return { id: raw.id, banner: banner.key, name: raw.name, itemId: String(raw.item_id || ''),
      itemType: /light\s*cone/i.test(raw.item_type || '') ? 'light_cone' : 'character',
      rank: parseInt(raw.rank_type, 10) || 0, time: parseServerTime(raw.time, offset) };
  }
  function detectZzzType(t) { const lc = String(t || '').toLowerCase(); if (lc.indexOf('engine') >= 0) return 'w_engine'; if (lc.indexOf('bangboo') >= 0) return 'bangboo'; return 'agent'; }
  function normalizeZzzRank(r) { const n = parseInt(r, 10); if (n === 4) return 5; if (n === 3) return 4; return 3; }
  function normalizeZzz(banner, raw, offset) {
    return { id: raw.id, banner: banner.key, name: raw.name, itemId: String(raw.item_id || ''),
      itemType: detectZzzType(raw.item_type), rank: normalizeZzzRank(raw.rank_type), time: parseServerTime(raw.time, offset) };
  }

  async function importHoyo(auth, gcfg, onProgress) {
    const collected = []; let uid = '';
    for (let i = 0; i < gcfg.banners.length; i++) {
      const banner = gcfg.banners[i]; let endId = '0', done = false, fetched = 0;
      while (!done) {
        const params = Object.fromEntries(new URLSearchParams(auth.rawQuery));
        params.gacha_type = banner.code;
        if (gcfg.realGachaType) params.real_gacha_type = banner.code;
        params.size = '20'; params.end_id = endId; params.lang = auth.lang; params.region = auth.region;
        const res = await fetch(API_BASE() + gcfg.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ params: params }) });
        const text = await res.text();
        let page;
        try { page = JSON.parse(text); } catch (e) { throw new Error('Upstream non-JSON (HTTP ' + res.status + '): ' + text.slice(0, 120)); }
        if (page.retcode !== 0 || !page.data) {
          if (gcfg.skipMissing && (page.retcode === -110 || /banner type/i.test(page.message || ''))) { done = true; break; }
          throw new Error(page.message || (gcfg.label + ' error (retcode ' + page.retcode + ')'));
        }
        const offset = tzOff(page.data.region_time_zone, 8);
        const list = page.data.list || [];
        if (!list.length) { done = true; break; }
        uid = uid || list[0].uid;
        for (const raw of list) collected.push(gcfg.normalize(banner, raw, offset));
        fetched += list.length; endId = list[list.length - 1].id;
        if (onProgress) onProgress({ bannerLabel: banner.label, bannerIndex: i, bannerTotal: gcfg.banners.length, fetched: fetched });
        await new Promise((r) => setTimeout(r, 250));
        if (list.length < 20) done = true;
      }
    }
    return { pulls: collected, uid: uid };
  }

  const HSR_CFG = { endpoint: '/api/gacha/hsr', banners: HSR_BANNERS, normalize: normalizeHsr, label: 'HSR', skipMissing: true };
  const ZZZ_CFG = { endpoint: '/api/gacha/zzz', banners: ZZZ_BANNERS, normalize: normalizeZzz, label: 'ZZZ', realGachaType: true };
  function importHsr(auth, onProgress) { return importHoyo(auth, HSR_CFG, onProgress); }
  function importZzz(auth, onProgress) { return importHoyo(auth, ZZZ_CFG, onProgress); }

  // UIGF v4 import for HSR (hkrpg) and ZZZ (nap).
  const HSR_CODE_KEY = (function () { const m = {}; for (const b of HSR_BANNERS) m[b.code] = b.key; return m; })();
  const ZZZ_CODE_KEY = (function () { const m = {}; for (const b of ZZZ_BANNERS) m[b.code] = b.key; return m; })();
  function importUIGFGame(json, field, codeKey, mapRecord) {
    const acc = json && json[field] && json[field][0];
    if (!acc || !Array.isArray(acc.list)) return { error: 'No records for this game in that UIGF file.' };
    const offset = tzOff(acc.timezone, 8);
    const pulls = [];
    for (const it of acc.list) {
      const code = String(it.uigf_gacha_type != null ? it.uigf_gacha_type : (it.gacha_type != null ? it.gacha_type : ''));
      const key = codeKey[code];
      if (!key || it.id == null) continue;
      pulls.push(mapRecord(key, it, offset));
    }
    return { uid: String(acc.uid || ''), pulls: pulls };
  }
  function importUIGFHsr(json) {
    return importUIGFGame(json, 'hkrpg', HSR_CODE_KEY, function (key, it, offset) {
      return { id: String(it.id), banner: key, name: it.name || '', itemId: String(it.item_id || ''),
        itemType: /light\s*cone/i.test(it.item_type || '') ? 'light_cone' : 'character',
        rank: parseInt(it.rank_type, 10) || 0, time: parseServerTime(it.time, offset) };
    });
  }
  function importUIGFZzz(json) {
    return importUIGFGame(json, 'nap', ZZZ_CODE_KEY, function (key, it, offset) {
      const r = parseInt(it.rank_type, 10);
      return { id: String(it.id), banner: key, name: it.name || '', itemId: String(it.item_id || ''),
        itemType: detectZzzType(it.item_type), rank: r <= 4 ? normalizeZzzRank(it.rank_type) : (r || 0),
        time: parseServerTime(it.time, offset) };
    });
  }

  // ---- WuWa convene import (Kuro POST/recordId — no authkey) ---------
  const WW_BANNERS = [
    { key: 'character',     code: '1', label: 'Featured Resonator' },
    { key: 'weapon',        code: '2', label: 'Featured Weapon' },
    { key: 'standard',      code: '3', label: 'Standard Resonator' },
    { key: 'standard_wpn',  code: '4', label: 'Standard Weapon' },
    { key: 'beginner',      code: '5', label: "Beginner's Convene" },
    { key: 'beginner_sel',  code: '6', label: "Beginner's Selector" },
    { key: 'beginner_sel2', code: '7', label: 'Selector — Permanent' },
  ];
  const WW_CODE_KEY = (function () { const m = {}; for (const b of WW_BANNERS) m[b.code] = b.key; return m; })();

  function parseWuwaAuth(url) {
    const trimmed = (url || '').trim();
    if (!trimmed) return { error: 'Paste a convene-history URL.' };
    let parsed; try { parsed = new URL(trimmed); } catch (e) { return { error: 'That does not look like a valid URL.' }; }
    const hash = parsed.hash.indexOf('#') === 0 ? parsed.hash.slice(1) : parsed.hash;
    const haystack = hash.indexOf('=') >= 0 ? (hash.split('?').slice(1).join('?') || hash) : parsed.search;
    const params = new URLSearchParams(haystack.replace(/^[?#]/, ''));
    const playerId = params.get('player_id') || params.get('playerId') || '';
    const recordId = params.get('record_id') || params.get('recordId') || '';
    const serverId = params.get('svr_id') || params.get('serverId') || '';
    const languageCode = params.get('lang') || params.get('languageCode') || 'en';
    const resourcesId = params.get('resources_id') || params.get('cardPoolId') || '';
    if (!playerId || !recordId || !serverId) return { error: 'URL is missing player_id / record_id / svr_id — copy it straight from the convene-history popup.' };
    const cardPoolIds = {}; for (const b of WW_BANNERS) cardPoolIds[b.key] = resourcesId;
    return { playerId: playerId, recordId: recordId, serverId: serverId, languageCode: languageCode, cardPoolIds: cardPoolIds };
  }

  function wuwaTime(time) {
    const m = String(time).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return Date.parse(time + 'Z') || 0;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - 8 * 3600000;
  }
  function wuwaSyntheticId(raw) {
    return String(raw.cardPoolType) + '-' + String(raw.time).replace(/\D/g, '') + '-' + String(raw.resourceId) + '-' + String(raw.count != null ? raw.count : 1);
  }
  function normalizeWuwa(banner, raw) {
    return { id: wuwaSyntheticId(raw), banner: banner.key, name: raw.name, itemId: String(raw.resourceId || ''),
      itemType: /weapon/i.test(raw.resourceType || '') ? 'weapon' : 'resonator', rank: parseInt(raw.qualityLevel, 10) || 0, time: wuwaTime(raw.time) };
  }

  async function importWuwa(auth, onProgress) {
    const collected = [];
    for (let i = 0; i < WW_BANNERS.length; i++) {
      const banner = WW_BANNERS[i];
      const body = { playerId: auth.playerId, cardPoolType: parseInt(banner.code, 10), cardPoolId: auth.cardPoolIds[banner.key] || '', languageCode: auth.languageCode, recordId: auth.recordId, serverId: auth.serverId };
      const res = await fetch(API_BASE() + '/api/gacha/wuwa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const text = await res.text();
      let page; try { page = JSON.parse(text); } catch (e) { throw new Error('Upstream non-JSON (HTTP ' + res.status + '): ' + text.slice(0, 120)); }
      if (page.code !== 0 || !page.data) {
        if (/no data|empty|not found/i.test(page.message || '')) { if (onProgress) onProgress({ bannerLabel: banner.label, bannerIndex: i, bannerTotal: WW_BANNERS.length, fetched: 0 }); continue; }
        throw new Error(page.message || ('Wuwa error (code ' + page.code + ')'));
      }
      for (const raw of page.data) collected.push(normalizeWuwa(banner, raw));
      if (onProgress) onProgress({ bannerLabel: banner.label, bannerIndex: i, bannerTotal: WW_BANNERS.length, fetched: page.data.length });
      await new Promise((r) => setTimeout(r, 250));
    }
    return { pulls: collected, uid: auth.playerId };
  }

  // Best-effort WuWa file import (WWGF / community convene exports).
  function importWWGF(json) {
    let list = null, uid = '';
    if (Array.isArray(json)) list = json;
    else if (json) {
      const acc = (json.ww && json.ww[0]) || (json.hkww && json.hkww[0]) || json;
      list = acc.list || json.list || null;
      uid = String(acc.uid || acc.playerId || json.uid || '');
    }
    if (!Array.isArray(list)) return { error: 'Unrecognized WuWa file — expected a list of convene records.' };
    const pulls = [];
    for (const it of list) {
      const code = String(it.cardPoolType != null ? it.cardPoolType : (it.gacha_type != null ? it.gacha_type : ''));
      const key = WW_CODE_KEY[code]; if (!key) continue;
      const resourceId = it.resourceId != null ? it.resourceId : (it.item_id != null ? it.item_id : it.itemId);
      const rank = parseInt(it.qualityLevel != null ? it.qualityLevel : it.rank_type, 10) || 0;
      pulls.push({ id: it.id != null ? String(it.id) : wuwaSyntheticId({ cardPoolType: code, time: it.time, resourceId: resourceId, count: it.count }),
        banner: key, name: it.name || '', itemId: String(resourceId || ''),
        itemType: /weapon/i.test(it.resourceType || it.item_type || '') ? 'weapon' : 'resonator', rank: rank, time: wuwaTime(it.time) });
    }
    return { uid: uid, pulls: pulls };
  }

  const WW_STANDARD_5 = new Set(['Calcharo', 'Encore', 'Jianxin', 'Lingyang', 'Verina']);
  const WW_VIEW_BANNERS = [
    { key: 'character',    label: 'Resonator',  keys: ['character'], soft: 66, hard: 80, ff: true },
    { key: 'weapon',       label: 'Weapon',     keys: ['weapon'],    soft: 66, hard: 80, ff: false },
    { key: 'standard',     label: 'Standard',   keys: ['standard'],  soft: 66, hard: 80, ff: false },
    { key: 'standard_wpn', label: 'Std Weapon', keys: ['standard_wpn'], soft: 66, hard: 80, ff: false },
    { key: 'beginner',     label: 'Beginner',   keys: ['beginner', 'beginner_sel', 'beginner_sel2'], soft: 50, hard: 80, ff: false },
  ];
  function buildWuwaBannerViews(pulls) { return buildViewsFor('wuwa', pulls, WW_VIEW_BANNERS, WW_STANDARD_5); }

  // ---- adapter registry (Nyx game-key → adapter) ----------------
  // Nyx uses 'wuwa'/'ae'; the underlying data model uses 'ww'/
  // 'endfield'. Map at the boundary so storage stays canonical.
  const ADAPTERS = {
    gi: {
      game: 'gi',
      label: 'Genshin Impact',
      helperCommand: "iex (irm 'https://asyce.com/asivepulled/scripts/genshin.ps1')",
      parseAuth: parseGiAuth,
      runImport: importGenshin,
      buildView: buildGenshinView,
      buildViews: buildGenshinBannerViews,
      importFile: importUIGFGenshin,
    },
    hsr: {
      game: 'hsr',
      label: 'Honkai: Star Rail',
      helperCommand: "iex (irm 'https://asyce.com/asivepulled/scripts/hsr.ps1')",
      parseAuth: parseGiAuth,
      runImport: importHsr,
      buildView: function (p) { return buildHsrBannerViews(p)[0]; },
      buildViews: buildHsrBannerViews,
      importFile: importUIGFHsr,
    },
    zzz: {
      game: 'zzz',
      label: 'Zenless Zone Zero',
      helperCommand: "iex (irm 'https://asyce.com/asivepulled/scripts/zzz.ps1')",
      parseAuth: parseGiAuth,
      runImport: importZzz,
      buildView: function (p) { return buildZzzBannerViews(p)[0]; },
      buildViews: buildZzzBannerViews,
      importFile: importUIGFZzz,
    },
    wuwa: {
      game: 'wuwa',
      label: 'Wuthering Waves',
      helperCommand: "iex (irm 'https://asyce.com/asivepulled/scripts/wuwa.ps1')",
      parseAuth: parseWuwaAuth,
      runImport: importWuwa,
      buildView: function (p) { return buildWuwaBannerViews(p)[0]; },
      buildViews: buildWuwaBannerViews,
      importFile: importWWGF,
    },
  };

  function adapterFor(nyxKey) {
    return ADAPTERS[nyxKey] || null; // hsr/zzz/wuwa/ae return null until wired
  }

  function buildView(nyxKey, pulls, opts) {
    const a = adapterFor(nyxKey);
    if (!a) return null;
    return a.buildView(pulls, opts);
  }

  function buildViews(nyxKey, pulls, opts) {
    const a = adapterFor(nyxKey);
    if (!a || !a.buildViews) return [];
    return a.buildViews(pulls, opts);
  }

  function importFile(nyxKey, json) {
    const a = adapterFor(nyxKey);
    if (!a || !a.importFile) return { error: 'File import is not available for this game yet.' };
    return a.importFile(json);
  }

  return {
    GI_BANNERS: GI_BANNERS,
    adapterFor: adapterFor,
    buildView: buildView,
    buildViews: buildViews,
    importFile: importFile,
    parseGiAuth: parseGiAuth,
    importGenshin: importGenshin,
    resolveItem: resolveItem,
    itemIndex: itemIndex,
  };
})();
