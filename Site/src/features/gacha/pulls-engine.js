// ============================================================
// Nyx — wish/gacha import engine  (window.NyxPulls)
//
// Based on the earlier prototype import adapters, but rewritten as a
// self-contained browser global (no ES imports) so it drops straight
// into Site's esbuild IIFE bundle.
//
// Responsibilities:
//   • parse a pasted in-game history URL into auth params
//   • walk every banner via the Worker proxy (/api/gacha/*) and
//     normalize each page into the cross-game PullRecord shape
//   • turn imported pulls into the view object the GachaTracker UI
//     already renders (pity, 50/50, 5★ history, distribution, stream)
//
// Genshin, HSR, ZZZ, and Wuthering Waves support live URL import.
// Endfield currently supports file/CSV/manual import only because no
// stable public history endpoint is enabled here yet.
//
// The proxy base is window.NYX_API_BASE (default same-origin). During
// local `python -m http.server` dev you can point it at a `wrangler dev`
// instance.
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
            sourceBanner: banner.label,
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
  // id-indexed from the local GameData mirror by tools/gen-weapons-meta.mjs.
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

  function enrichPull(gameKey, pull, pity5, pity4, idx) {
    const meta = resolveItem(gameKey, pull) || {};
    const itemType = pull.itemType || meta.kind || '';
    const isWeapon = itemType === 'weapon' || itemType === 'light_cone' || itemType === 'w_engine' || itemType === 'bangboo';
    return {
      idx: idx,
      id: pull.id,
      banner: pull.banner,
      sourceBanner: pull.sourceBanner || '',
      part: pull.part || '',
      name: pull.name || meta.name || 'Unknown',
      itemId: pull.itemId || '',
      itemType: itemType,
      isWeapon: isWeapon,
      rank: pull.rank,
      rarity: meta.rarity || pull.rank,
      time: pull.time || 0,
      pity: pity5,
      pity5: pity5,
      pity4: pity4,
      icon: meta.icon || meta.art || '',
      art: meta.art || meta.icon || '',
      el: meta.element || null,
      wtype: meta.weaponType || null,
    };
  }

  function archiveFromItems(items) {
    const byKey = {};
    for (const item of items) {
      if (!item || item.rank < 4) continue;
      const kind = item.isWeapon ? 'weapon' : 'character';
      const key = kind + ':' + (normName(item.name) || item.itemId || item.id || item.idx);
      const rec = byKey[key] || {
        key: key,
        kind: kind,
        name: item.name,
        itemId: item.itemId || '',
        rank: item.rank,
        rarity: item.rarity || item.rank,
        copies: 0,
        lastTime: 0,
        icon: item.icon || '',
        art: item.art || item.icon || '',
        el: item.el || null,
        wtype: item.wtype || null,
      };
      rec.copies += 1;
      rec.rank = Math.max(rec.rank || 0, item.rank || 0);
      rec.rarity = Math.max(rec.rarity || 0, item.rarity || item.rank || 0);
      rec.lastTime = Math.max(rec.lastTime || 0, item.time || 0);
      rec.icon = rec.icon || item.icon || item.art || '';
      rec.art = rec.art || item.art || item.icon || '';
      rec.el = rec.el || item.el || null;
      rec.wtype = rec.wtype || item.wtype || null;
      byKey[key] = rec;
    }
    return Object.values(byKey);
  }

  function sourceGroupsFromItems(items, fallbackLabel) {
    const groups = {};
    for (const item of (items || [])) {
      const source = String(item.sourceBanner || '').trim();
      const part = String(item.part || '').trim();
      const label = source || fallbackLabel || 'Imported banner';
      const key = normName(label) + ':' + part;
      const rec = groups[key] || {
        key: key,
        label: label,
        part: part,
        displayName: label + (part ? ' · ' + part : ''),
        total: 0,
        fiveCount: 0,
        fourCount: 0,
        lastTime: 0,
        items: [],
      };
      rec.total += 1;
      if (item.rank === 5) rec.fiveCount += 1;
      if (item.rank === 4) rec.fourCount += 1;
      rec.lastTime = Math.max(rec.lastTime || 0, item.time || 0);
      rec.items.push(item);
      groups[key] = rec;
    }
    return Object.values(groups).map((rec) => {
      const newest = rec.items.slice().sort((a, b) => (b.time || 0) - (a.time || 0) || (b.idx || 0) - (a.idx || 0));
      return Object.assign({}, rec, {
        recent: newest.slice(0, 6),
        highlights: newest.filter((it) => it.rank >= 4).slice(0, 6),
      });
    }).sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0) || (b.total || 0) - (a.total || 0));
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
    const fives = [], stream = [], items = [];
    let fourCount = 0, threeCount = 0, sinceFive = 0, sinceFour = 0, guaranteedNext = false;
    banner.forEach((p) => {
      sinceFive++;
      sinceFour++;
      stream.push(p.rank);
      const item = enrichPull(gameKey, p, sinceFive, sinceFour, stream.length);
      items.push(item);
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
        fives.push(Object.assign({}, item, { pity: pity, pity5: pity, won: won, ff: ff, exact: exact }));
        sinceFive = 0;
      }
      if (p.rank >= 4) sinceFour = 0;
    });
    const archive = archiveFromItems(items);
    const sourceGroups = sourceGroupsFromItems(items, cfg.label);
    return {
      key: cfg.key, label: cfg.label, soft: cfg.soft, hard: cfg.hard, ff: cfg.ff,
      total: banner.length, fives: fives, fourCount: fourCount, threeCount: threeCount,
      currentPity: sinceFive, currentFourPity: sinceFour, guaranteed: cfg.ff ? guaranteedNext : false,
      stream: stream, items: items, history: items.slice().reverse(), archive: archive, sourceGroups: sourceGroups,
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

  function parseSimpleCsv(text) {
    const rows = [];
    let row = [], cur = '', quote = false;
    const pushCell = () => { row.push(cur); cur = ''; };
    const pushRow = () => {
      if (row.length || cur !== '') { pushCell(); rows.push(row); }
      row = [];
    };
    for (let i = 0; i < String(text || '').length; i++) {
      const ch = text[i], next = text[i + 1];
      if (quote && ch === '"' && next === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { quote = !quote; continue; }
      if (!quote && ch === ',') { pushCell(); continue; }
      if (!quote && (ch === '\n' || ch === '\r')) {
        if (ch === '\r' && next === '\n') i++;
        pushRow();
        continue;
      }
      cur += ch;
    }
    pushRow();
    return rows.filter((r) => r.some((v) => String(v || '').trim() !== ''));
  }

  function csvObjects(text) {
    const rows = parseSimpleCsv(text);
    if (rows.length < 2) return [];
    const headers = rows[0].map((h) => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''));
    return rows.slice(1).map((cells) => {
      const out = {};
      headers.forEach((h, i) => { if (h) out[h] = cells[i] != null ? String(cells[i]).trim() : ''; });
      return out;
    });
  }

  function pick(row, keys) {
    for (const k of keys) if (row[k] != null && String(row[k]).trim() !== '') return row[k];
    return '';
  }

  function firstArray(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return null;
    const keys = ['list', 'records', 'pulls', 'items', 'history', 'data'];
    for (const key of keys) {
      if (Array.isArray(value[key])) return value[key];
      if (value[key] && typeof value[key] === 'object') {
        const nested = firstArray(value[key]);
        if (nested) return nested;
      }
    }
    return null;
  }

  function importGenericRows(rows, opts) {
    const codeKey = opts.codeKey || {};
    const defaultBanner = opts.defaultBanner || 'character';
    const defaultType = opts.defaultType || 'character';
    const uid = String(opts.uid || pick(opts.meta || {}, ['uid', 'player_id', 'playerid', 'account_id', 'accountid']) || '');
    const pulls = [];
    rows.forEach((it, idx) => {
      const row = it || {};
      const code = String(pick(row, ['uigf_gacha_type', 'gacha_type', 'real_gacha_type', 'card_pool_type', 'cardpooltype', 'pool_type', 'banner_type']));
      const rawBanner = String(pick(row, ['banner', 'banner_key', 'bannerkey', 'pool', 'pool_name', 'gacha_name', 'gacha_type_name', 'source_banner'])).toLowerCase();
      let banner = codeKey[code] || '';
      if (!banner) {
        if (/weapon|light.?cone|w.?engine|engine/.test(rawBanner)) banner = opts.weaponBanner || 'weapon';
        else if (/standard|permanent|stable|stellar/.test(rawBanner)) banner = 'standard';
        else if (/beginner|departure|novice/.test(rawBanner)) banner = 'beginner';
        else if (/bangboo/.test(rawBanner)) banner = 'bangboo';
        else banner = defaultBanner;
      }
      const id = String(pick(row, ['id', 'record_id', 'recordid', 'history_id', 'historyid']) || (opts.idPrefix || 'import') + ':' + idx + ':' + pick(row, ['time', 'date', 'timestamp']));
      const itemTypeRaw = String(pick(row, ['item_type', 'itemtype', 'resource_type', 'resourcetype', 'type', 'kind'])).toLowerCase();
      const itemType = /weapon|light.?cone|w.?engine|engine/.test(itemTypeRaw) || ['weapon', 'lightcone', 'wengine', 'standard_wpn'].includes(banner)
        ? (opts.weaponType || 'weapon')
        : (/bangboo/.test(itemTypeRaw) || banner === 'bangboo' ? 'bangboo' : defaultType);
      const rank = parseInt(pick(row, ['rank_type', 'rank', 'rarity', 'quality_level', 'qualitylevel']), 10) || 0;
      const timeRaw = pick(row, ['time', 'date', 'datetime', 'timestamp', 'created_at', 'createdat']);
      pulls.push({
        id,
        banner,
        sourceBanner: pick(row, ['source_banner', 'sourcebanner', 'banner_name', 'banner', 'pool_name', 'gacha_name']),
        name: pick(row, ['name', 'item_name', 'itemname', 'resource_name', 'resourcename']),
        itemId: String(pick(row, ['item_id', 'itemid', 'resource_id', 'resourceid', 'id_item']) || ''),
        itemType,
        rank,
        time: typeof timeRaw === 'number' ? timeRaw : (Date.parse(String(timeRaw).replace(' ', 'T') + (String(timeRaw).match(/z|[+-]\d\d:?\d\d$/i) ? '' : 'Z')) || 0),
        source: opts.source || 'file',
      });
    });
    return { uid, pulls: pulls.filter((p) => p.name || p.itemId || p.rank || p.time) };
  }

  function importGenericJson(json, opts) {
    const root = Array.isArray(json) ? json : (json && (json.export || json.data || json.account || json));
    const list = firstArray(root);
    if (!list) return { error: 'No recognizable pull records found in that JSON file.' };
    const meta = Array.isArray(root) ? {} : root;
    return importGenericRows(list, Object.assign({}, opts, { meta }));
  }

  function importGenericCsv(text, opts) {
    const rows = csvObjects(text);
    if (!rows.length) return { error: 'No CSV rows found. Use a header row such as time,name,rank,banner.' };
    return importGenericRows(rows, Object.assign({}, opts, { source:'csv-manual' }));
  }

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
    if (!acc || !Array.isArray(acc.list)) return importGenericJson(json, {
      codeKey: GI_CODE_KEY, defaultBanner:'character', defaultType:'character', weaponBanner:'weapon',
      weaponType:'weapon', idPrefix:'gi-json', source:'json-genshin',
    });
    const offset = (acc.timezone != null ? acc.timezone : 8) * 3600000;
    const pulls = [];
    for (const it of acc.list) {
      const code = String(it.uigf_gacha_type != null ? it.uigf_gacha_type : (it.gacha_type != null ? it.gacha_type : ''));
      const key = GI_CODE_KEY[code];
      if (!key || it.id == null) continue;
      pulls.push({
        id: String(it.id),
        banner: key,
        sourceBanner: it.banner || it.banner_name || it.name_banners || '',
        name: it.name || '',
        itemId: String(it.item_id || ''),
        itemType: inferGiItemType(it.item_id, it.item_type === 'Weapon' || it.item_type === '武器' ? 'weapon' : (it.item_type ? 'character' : null)),
        rank: parseInt(it.rank_type, 10) || 0,
        time: parseServerTime(it.time, offset),
      });
    }
    return { uid: String(acc.uid || ''), pulls: pulls };
  }

  // Paimon.moe Excel exports are .xlsx files with one worksheet per
  // Genshin banner family. The site bundle is a browser global, so this
  // is a tiny OOXML reader instead of a Node/package dependency.
  function u8FromBuffer(buffer) {
    if (buffer instanceof Uint8Array) return buffer;
    if (ArrayBuffer.isView(buffer)) return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    return new Uint8Array(buffer || []);
  }

  function findZipEocd(view) {
    for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65558); i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  async function inflateZipBytes(bytes, method) {
    if (method === 0) return bytes;
    if (method !== 8) throw new Error('Unsupported .xlsx compression method: ' + method);
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot unpack .xlsx files. Export JSON/UIGF instead.');
    }
    async function run(format) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    try { return await run('deflate-raw'); }
    catch (e) { return await run('deflate'); }
  }

  function openXlsxZip(buffer) {
    const bytes = u8FromBuffer(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = findZipEocd(view);
    if (eocd < 0) throw new Error('That does not look like an .xlsx file.');
    const count = view.getUint16(eocd + 10, true);
    let ptr = view.getUint32(eocd + 16, true);
    const entries = {};
    const decoder = new TextDecoder('utf-8');
    for (let i = 0; i < count; i += 1) {
      if (view.getUint32(ptr, true) !== 0x02014b50) break;
      const method = view.getUint16(ptr + 10, true);
      const compressedSize = view.getUint32(ptr + 20, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localOffset = view.getUint32(ptr + 42, true);
      const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
      entries[name] = { name: name, method: method, compressedSize: compressedSize, localOffset: localOffset };
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    return {
      async text(path) {
        const entry = entries[path];
        if (!entry) return '';
        const lp = entry.localOffset;
        if (view.getUint32(lp, true) !== 0x04034b50) throw new Error('Invalid .xlsx local file header.');
        const nameLen = view.getUint16(lp + 26, true);
        const extraLen = view.getUint16(lp + 28, true);
        const start = lp + 30 + nameLen + extraLen;
        const raw = bytes.subarray(start, start + entry.compressedSize);
        const inflated = await inflateZipBytes(raw, entry.method);
        return decoder.decode(inflated);
      },
    };
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text || '', 'application/xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    if (err) throw new Error('Could not read the .xlsx XML.');
    return doc;
  }

  function xmlText(node) {
    return node ? (node.textContent || '') : '';
  }

  function sharedStringsFromXml(xml) {
    if (!xml) return [];
    const doc = parseXml(xml);
    return Array.from(doc.getElementsByTagName('si')).map((si) => {
      return Array.from(si.getElementsByTagName('t')).map(xmlText).join('');
    });
  }

  function colIndex(ref) {
    const letters = String(ref || '').match(/^[A-Z]+/i);
    if (!letters) return -1;
    let out = 0;
    const s = letters[0].toUpperCase();
    for (let i = 0; i < s.length; i += 1) out = out * 26 + (s.charCodeAt(i) - 64);
    return out - 1;
  }

  function sheetRowsFromXml(xml, shared) {
    const doc = parseXml(xml);
    return Array.from(doc.getElementsByTagName('row')).map((row) => {
      const out = [];
      let next = 0;
      Array.from(row.getElementsByTagName('c')).forEach((cell) => {
        const idx = Math.max(0, colIndex(cell.getAttribute('r')) >= 0 ? colIndex(cell.getAttribute('r')) : next);
        const type = cell.getAttribute('t') || '';
        let value = '';
        if (type === 'inlineStr') value = xmlText(cell.getElementsByTagName('t')[0]);
        else {
          const raw = xmlText(cell.getElementsByTagName('v')[0]);
          value = type === 's' ? (shared[parseInt(raw, 10)] || '') : raw;
        }
        out[idx] = value;
        next = idx + 1;
      });
      return out;
    });
  }

  function workbookSheets(workbookXml, relsXml) {
    const wb = parseXml(workbookXml);
    const rels = parseXml(relsXml);
    const relMap = {};
    Array.from(rels.getElementsByTagName('Relationship')).forEach((rel) => {
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target') || '';
      if (id) relMap[id] = target.indexOf('xl/') === 0 ? target : ('xl/' + target.replace(/^\/+/, ''));
    });
    return Array.from(wb.getElementsByTagName('sheet')).map((sheet) => {
      const rid = sheet.getAttribute('r:id') || sheet.getAttribute('id') || '';
      return { name: sheet.getAttribute('name') || '', path: relMap[rid] || '' };
    });
  }

  function headerIndex(headers, test) {
    for (let i = 0; i < headers.length; i += 1) {
      if (test(String(headers[i] || '').trim())) return i;
    }
    return -1;
  }

  function parsePaimonTime(value) {
    const s = String(value || '').trim();
    const serial = Number(s);
    if (isFinite(serial) && serial > 20000) return Math.round((serial - 25569) * 86400000);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return Date.parse(s) || 0;
  }

  function paimonItemType(type, bannerKey) {
    if (/weapon/i.test(type || '')) return 'weapon';
    if (/character/i.test(type || '')) return 'character';
    return bannerKey === 'weapon' ? 'weapon' : 'character';
  }

  async function importPaimonXlsx(buffer) {
    const zip = openXlsxZip(buffer);
    const shared = sharedStringsFromXml(await zip.text('xl/sharedStrings.xml'));
    const sheets = workbookSheets(
      await zip.text('xl/workbook.xml'),
      await zip.text('xl/_rels/workbook.xml.rels')
    );
    const sheetMap = {
      'character event': { banner: 'character', fallback: 'Character Event Wish' },
      'weapon event': { banner: 'weapon', fallback: 'Weapon Event Wish' },
      'standard': { banner: 'standard', fallback: 'Standard Wish' },
      "beginners' wish": { banner: 'beginner', fallback: "Beginner's Wish" },
      'beginner wish': { banner: 'beginner', fallback: "Beginner's Wish" },
    };
    const pulls = [];
    for (const sheet of sheets) {
      const cfg = sheetMap[String(sheet.name || '').trim().toLowerCase()];
      if (!cfg || !sheet.path) continue;
      const rows = sheetRowsFromXml(await zip.text(sheet.path), shared);
      if (rows.length < 2) continue;
      const headers = rows[0] || [];
      const typeIdx = headerIndex(headers, (h) => h.toLowerCase() === 'type');
      const nameIdx = headerIndex(headers, (h) => h.toLowerCase() === 'name');
      const timeIdx = headerIndex(headers, (h) => h.toLowerCase() === 'time');
      const rankIdx = headerIndex(headers, (h) => h.indexOf('\u2b50') >= 0 || /rank|rarity|star/i.test(h));
      const rollIdx = headerIndex(headers, (h) => h.toLowerCase() === '#roll' || h.toLowerCase() === 'roll');
      const bannerIdx = headerIndex(headers, (h) => h.toLowerCase() === 'banner');
      const partIdx = headerIndex(headers, (h) => h.toLowerCase() === 'part');
      if (nameIdx < 0 || rankIdx < 0) continue;
      for (let i = 1; i < rows.length; i += 1) {
        const row = rows[i] || [];
        const name = String(row[nameIdx] || '').trim();
        if (!name) continue;
        const time = parsePaimonTime(row[timeIdx]);
        const rank = parseInt(row[rankIdx], 10) || 0;
        const sourceBanner = String(row[bannerIdx] || cfg.fallback).trim() || cfg.fallback;
        const part = String(row[partIdx] || '').trim();
        const roll = String(row[rollIdx] || i).trim();
        pulls.push({
          id: ['paimon', cfg.banner, roll, time || i, name, sourceBanner, part].map((v) => String(v).replace(/:/g, '')).join(':'),
          banner: cfg.banner,
          sourceBanner: sourceBanner,
          part: part,
          name: name,
          itemId: '',
          itemType: paimonItemType(row[typeIdx], cfg.banner),
          rank: rank,
          time: time,
        });
      }
    }
    pulls.sort(sortPulls);
    return { uid: 'paimon-moe-xlsx', pulls: pulls };
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
    if (!(json && json.hkrpg && json.hkrpg[0] && Array.isArray(json.hkrpg[0].list))) {
      return importGenericJson(json, {
        codeKey: HSR_CODE_KEY, defaultBanner:'character', defaultType:'character', weaponBanner:'lightcone',
        weaponType:'light_cone', idPrefix:'hsr-json', source:'json-hsr',
      });
    }
    return importUIGFGame(json, 'hkrpg', HSR_CODE_KEY, function (key, it, offset) {
      return { id: String(it.id), banner: key, name: it.name || '', itemId: String(it.item_id || ''),
        itemType: /light\s*cone/i.test(it.item_type || '') ? 'light_cone' : 'character',
        rank: parseInt(it.rank_type, 10) || 0, time: parseServerTime(it.time, offset) };
    });
  }
  function importUIGFZzz(json) {
    if (!(json && json.nap && json.nap[0] && Array.isArray(json.nap[0].list))) {
      return importGenericJson(json, {
        codeKey: ZZZ_CODE_KEY, defaultBanner:'character', defaultType:'agent', weaponBanner:'wengine',
        weaponType:'w_engine', idPrefix:'zzz-json', source:'json-zzz',
      });
    }
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
    if (!Array.isArray(list)) return importGenericJson(json, {
      codeKey: WW_CODE_KEY, defaultBanner:'character', defaultType:'resonator', weaponBanner:'weapon',
      weaponType:'weapon', idPrefix:'wuwa-json', source:'json-wuwa',
    });
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

  // ---- Endfield file/manual import -----------------------------------
  const AE_CODE_KEY = { '1':'character', '2':'weapon', '3':'standard', '4':'standard' };
  const AE_VIEW_BANNERS = [
    { key: 'character', label: 'Operator',  keys: ['character'], soft: 60, hard: 80, ff: true },
    { key: 'weapon',    label: 'Weapon',    keys: ['weapon'],    soft: 60, hard: 80, ff: false },
    { key: 'standard',  label: 'Standard',  keys: ['standard'],  soft: 60, hard: 80, ff: false },
  ];
  function importEndfieldJson(json) {
    return importGenericJson(json, {
      codeKey: AE_CODE_KEY, defaultBanner:'character', defaultType:'operator', weaponBanner:'weapon',
      weaponType:'weapon', idPrefix:'ae-json', source:'json-endfield',
    });
  }
  function buildEndfieldBannerViews(pulls) { return buildViewsFor('ae', pulls || [], AE_VIEW_BANNERS, new Set()); }

  // One versioned, inspectable script hosted on pengo.gg with a published
  // checksum. Users can either run it quickly from the URL or download and
  // verify it first. One file, parameterised by -Game.
  const PULLS_SCRIPT = {
    url: '/scripts/pengo-pulls.ps1',
    sha256: '49b5e855bf905f57e2af9898f48d00bea07bd5824db508547e1c4dc203db7fa1',
  };
  function quickCommand(game) {
    return "& ([scriptblock]::Create((irm 'https://pengo.gg/scripts/pengo-pulls.ps1'))) -Game " + game;
  }

  // ---- adapter registry (Nyx game-key → adapter) ----------------
  // Nyx uses 'wuwa'/'ae'; the underlying data model uses 'ww'/
  // 'endfield'. Map at the boundary so storage stays canonical.
  const ADAPTERS = {
    gi: {
      game: 'gi',
      label: 'Genshin Impact',
      helperCommand: quickCommand('gi'),
      safeScript: PULLS_SCRIPT,
      parseAuth: parseGiAuth,
      runImport: importGenshin,
      buildView: buildGenshinView,
      buildViews: buildGenshinBannerViews,
      importFile: importUIGFGenshin,
      importCsv: function (text) { return importGenericCsv(text, { codeKey:GI_CODE_KEY, defaultBanner:'character', defaultType:'character', weaponBanner:'weapon', weaponType:'weapon', idPrefix:'gi-csv' }); },
      importExcel: importPaimonXlsx,
    },
    hsr: {
      game: 'hsr',
      label: 'Honkai: Star Rail',
      helperCommand: quickCommand('hsr'),
      safeScript: PULLS_SCRIPT,
      parseAuth: parseGiAuth,
      runImport: importHsr,
      buildView: function (p) { return buildHsrBannerViews(p)[0]; },
      buildViews: buildHsrBannerViews,
      importFile: importUIGFHsr,
      importCsv: function (text) { return importGenericCsv(text, { codeKey:HSR_CODE_KEY, defaultBanner:'character', defaultType:'character', weaponBanner:'lightcone', weaponType:'light_cone', idPrefix:'hsr-csv' }); },
    },
    zzz: {
      game: 'zzz',
      label: 'Zenless Zone Zero',
      helperCommand: quickCommand('zzz'),
      safeScript: PULLS_SCRIPT,
      parseAuth: parseGiAuth,
      runImport: importZzz,
      buildView: function (p) { return buildZzzBannerViews(p)[0]; },
      buildViews: buildZzzBannerViews,
      importFile: importUIGFZzz,
      importCsv: function (text) { return importGenericCsv(text, { codeKey:ZZZ_CODE_KEY, defaultBanner:'character', defaultType:'agent', weaponBanner:'wengine', weaponType:'w_engine', idPrefix:'zzz-csv' }); },
    },
    wuwa: {
      game: 'wuwa',
      label: 'Wuthering Waves',
      helperCommand: quickCommand('wuwa'),
      safeScript: PULLS_SCRIPT,
      parseAuth: parseWuwaAuth,
      runImport: importWuwa,
      buildView: function (p) { return buildWuwaBannerViews(p)[0]; },
      buildViews: buildWuwaBannerViews,
      importFile: importWWGF,
      importCsv: function (text) { return importGenericCsv(text, { codeKey:WW_CODE_KEY, defaultBanner:'character', defaultType:'resonator', weaponBanner:'weapon', weaponType:'weapon', idPrefix:'wuwa-csv' }); },
    },
    ae: {
      game: 'ae',
      label: 'Arknights: Endfield',
      safeScript: null,
      parseAuth: function () { return { error:'Endfield live-token import is not enabled yet. Use a JSON/CSV file or manual CSV backfill so your token stays off Pengo.' }; },
      runImport: null,
      buildView: function (p) { return buildEndfieldBannerViews(p)[0]; },
      buildViews: buildEndfieldBannerViews,
      importFile: importEndfieldJson,
      importCsv: function (text) { return importGenericCsv(text, { codeKey:AE_CODE_KEY, defaultBanner:'character', defaultType:'operator', weaponBanner:'weapon', weaponType:'weapon', idPrefix:'ae-csv' }); },
    },
  };

  function adapterFor(nyxKey) {
    return ADAPTERS[nyxKey] || null;
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
