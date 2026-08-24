// ============================================================
// Nyx — unified game-hub app (single-page / tabbed)
// One mounted app for ALL pages. The top rail switches the active
// game in React state — no navigation, no reload — so it feels like
// tabs. The top bar + rail stay mounted; only the content swaps;
// the page background art crossfades between games. Each game keeps
// a real shareable URL via history.pushState.
// Requires game-page-components.jsx, cm-data.jsx, char-materials.jsx,
// gacha-tracker.jsx loaded first.
// ============================================================

function getCmRoster(key){
  const cfg = (window.CM_CFG || {})[key];
  if (cfg && cfg.roster) return cfg.roster;
  const lite = window.NYX_DB && window.NYX_DB.games && window.NYX_DB.games[key] && window.NYX_DB.games[key].roster;
  return (lite || []).map((ch) => ({
    id: ch.id,
    n: ch.name,
    name: ch.name,
    rawName: ch.name,
    aliases: ch.aliases || [],
    title: ch.title,
    r: ch.rarity,
    el: ch.element,
    tag: ch.role,
    icon: ch.icon,
    art: ch.art,
    overviewArt: ch.overviewArt,
    overviewArtPool: ch.overviewArtPool,
    overviewArtZoom: ch.overviewArtZoom,
    status: ch.status,
    upcoming: ch.upcoming,
    reliableData: ch.reliableData,
    noReliableInfo: ch.noReliableInfo,
    forms: ch.forms || [],
  }));
}

function requestCmGame(key){
  if (!key) return Promise.resolve(null);
  if (key === 'nyx') {
    const gameKeys = Object.keys(GAME_REGISTRY || {});
    return window.ensureNyxCmGames ? window.ensureNyxCmGames(gameKeys).catch(() => []) : Promise.resolve([]);
  }
  if ((window.CM_CFG || {})[key]) return Promise.resolve(window.CM_CFG[key]);
  return window.loadNyxCmGame ? window.loadNyxCmGame(key).catch(() => null) : Promise.resolve(null);
}

function useCmGameVersion(key){
  const [version, setVersion] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    const onLoaded = (event) => {
      if (!key || key === 'nyx' || !event.detail || event.detail.key === key) {
        setVersion((v) => v + 1);
      }
    };
    window.addEventListener('nyx:cm-game-loaded', onLoaded);
    requestCmGame(key).then(() => { if (live) setVersion((v) => v + 1); });
    return () => {
      live = false;
      window.removeEventListener('nyx:cm-game-loaded', onLoaded);
    };
  }, [key]);
  return version;
}

function bgUrl(src){
  if (!src) return undefined;
  return 'url("' + encodeURI(String(src)).replace(/#/g, '%23').replace(/"/g, '%22') + '")';
}

function randomRange(min, max){
  return min + Math.random() * (max - min);
}

function nyxBgScene(mode){
  const isIndex = mode === 'index';
  const zoom = Math.round(randomRange(isIndex ? 106 : 110, isIndex ? 118 : 126));
  const x = Math.round(randomRange(28, 72));
  const y = Math.round(randomRange(24, 76));
  const flip = Math.random() < .5 ? -1 : 1;
  const rot = randomRange(-3.5, 3.5).toFixed(2);
  return {
    pos:`${x}% ${y}%`,
    size:`${zoom}% auto`,
    transform:`scaleX(${flip}) scale(1.025) rotate(${rot}deg)`,
    filter:`brightness(${isIndex ? .62 : 1.18}) saturate(${isIndex ? 1.03 : 1.12}) contrast(${isIndex ? 1.02 : 1.05})`,
  };
}

function applyNyxBgElement(el, src, scene){
  if (!el || !scene) return;
  if (src) el.style.backgroundImage = bgUrl(src);
  el.style.backgroundPosition = scene.pos;
  el.style.backgroundSize = scene.size;
  el.style.transform = scene.transform;
  el.style.filter = scene.filter;
}

function rosterTag(ch){
  return ch.title || ch.tag || '';
}

function appMatchesSearch(ch, q){
  const query = String(q || '').trim();
  if (!query) return true;
  const extra = [
    ch.tag,
    ch.gameName,
    ...(ch.aliases || []),
    ...((ch.forms || []).flatMap((form) => [
      form.name,
      form.label,
      form.variant,
      form.gender,
      form.element,
      form.role,
    ])),
  ].filter(Boolean).join(' ');
  if (window.nyxMatchesSearch) return window.nyxMatchesSearch(ch.name, ch.rawName, query, extra);
  return (ch.name + ' ' + extra).toLowerCase().includes(query.toLowerCase());
}

function appGameIcon(key){
  return ((window.CM_CFG || {})[key] || {}).icon || null;
}

const NYX_SPECIAL_UNIT_DEFAULTS = {
  gi: { aloy:true },
  hsr: { archer:true, saber:true, rin_tohsaka:true, gilgamesh:true },
  wuwa: { lucy:true, rebecca:true },
};

const NYX_SPECIAL_UNIT_NAMES = {
  gi: { aloy:['aloy'] },
  hsr: {
    archer:['archer'],
    saber:['saber'],
    rin_tohsaka:['rin tohsaka', 'rin'],
    gilgamesh:['gilgamesh'],
  },
  wuwa: {
    lucy:['lucy'],
    rebecca:['rebecca'],
  },
};

function normalizeUnitName(name){
  return String(name || '').trim().toLowerCase()
    .replace(/[\u00b7\u2022\u2013\u2014-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function sanitizeSpecialUnits(raw){
  const src = (raw && typeof raw === 'object') ? raw : {};
  const next = {};
  Object.keys(NYX_SPECIAL_UNIT_DEFAULTS).forEach((gameKey) => {
    next[gameKey] = Object.assign({}, NYX_SPECIAL_UNIT_DEFAULTS[gameKey], src[gameKey] || {});
    Object.keys(NYX_SPECIAL_UNIT_DEFAULTS[gameKey]).forEach((unitKey) => {
      next[gameKey][unitKey] = next[gameKey][unitKey] !== false;
    });
  });
  return next;
}

function specialUnitKey(gameKey, name){
  const map = NYX_SPECIAL_UNIT_NAMES[gameKey] || {};
  const n = normalizeUnitName(name);
  return Object.keys(map).find((key) => (map[key] || []).some((alias) => n === normalizeUnitName(alias))) || null;
}

function isSpecialUnitVisible(gameKey, name, settings){
  const unitKey = specialUnitKey(gameKey, name);
  if (!unitKey) return true;
  const prefs = sanitizeSpecialUnits(settings && settings.specialUnits);
  return !prefs[gameKey] || prefs[gameKey][unitKey] !== false;
}

function overviewCardArt(cfg, ch, offset = 0){
  const pool = Array.isArray(ch.overviewArtPool)
    ? ch.overviewArtPool.filter(Boolean)
    : [];
  if (!pool.length) return ch.overviewArt || ch.art || ch.card || cfg.art;
  return pool[Math.abs(Number(offset) || 0) % pool.length];
}

function makeRoster(cfg, settings, characterImagePrefs){
  const source = cfg.roster || getCmRoster(cfg.key);
  if (!source || !source.length) return [{ id:cfg.key + '-main', name:cfg.charName, tag:'', art:cfg.art, icon:cfg.benchIcon, detailAvailable:false }];
  const seen = new Set();
  const out = [];
  source.forEach((ch, i) => {
    const name = ch.n || ch.name;
    if (!isSpecialUnitVisible(cfg.key, name, settings)) return;
    const key = String(name || '').toLowerCase();
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    const row = {
      id:ch.id || (cfg.key + '-' + i),
      name,
      rawName:ch.rawName,
      gameKey:ch.gameKey || cfg.key,
      gameName:ch.gameName || cfg.name,
      aliases:ch.aliases || [],
      tag:rosterTag(ch),
      art:overviewCardArt(cfg, ch, i),
      overviewArtPool:ch.overviewArtPool,
      overviewArtZoom:ch.overviewArtZoom,
      icon:ch.icon || ch.circle || ch.card || cfg.benchIcon,
      el:ch.el || ch.element,
      rarity:ch.r,
      forms:ch.forms || [],
      detailAvailable:!cmIsUpcomingOnly(ch),
    };
    const customGameKey = row.gameKey && row.gameKey !== 'nyx' ? row.gameKey : cfg.key;
    out.push(typeof nyxApplyCharacterCustomImages === 'function'
      ? nyxApplyCharacterCustomImages(customGameKey, row, characterImagePrefs)
      : row);
  });
  return out;
}

function shuffleOnce(list){
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1){
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

let NYX_WHISPER_WORDS_PROMISE = null;

function fetchNyxWhisperWords(){
  if (!NYX_WHISPER_WORDS_PROMISE) {
    NYX_WHISPER_WORDS_PROMISE = fetch('../assets/data/nyx-whispers.txt', { cache:'force-cache' })
      .then((res) => res.ok ? res.text() : '')
      .then((text) => {
        const seen = new Set();
        return String(text || '')
          .split(/\r?\n/g)
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => {
            const key = line.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
      })
      .catch(() => []);
  }
  return NYX_WHISPER_WORDS_PROMISE;
}

function mountNyxAmbientText(){
  const field = document.querySelector('.nyx-rune-field');
  if (!field) return () => {};
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cleanup = [];
  let disposed = false;
  fetchNyxWhisperWords().then((words) => {
    if (disposed || !words.length) return;
    const count = Math.max(4, Math.min(8, Math.round(1600 / 285)));
    const laneStep = 82 / Math.max(1, count - 1);
    const lanes = Array.from({ length:count }, (_, i) => 9 + (laneStep * i));
    let bag = [];
    const nextWord = () => {
      if (!bag.length) bag = shuffleOnce(words);
      return bag.pop() || words[0] || '';
    };
    field.textContent = '';
    field.dataset.count = String(words.length);
    for (let i = 0; i < count; i += 1){
      const line = document.createElement('span');
      line.className = 'nyx-rune-line';
      const dur = randomRange(62, 98);
      const reset = (initial) => {
        line.textContent = nextWord().toUpperCase().replace(/\s+/g, '');
        line.style.setProperty('--x', lanes[i].toFixed(2) + '%');
        line.style.setProperty('--dur', dur.toFixed(2) + 's');
        line.style.setProperty('--delay', initial ? (-randomRange(0, dur)).toFixed(2) + 's' : '0s');
        line.style.setProperty('--alpha', randomRange(.12, .28).toFixed(2));
        line.style.setProperty('--size', randomRange(30, 48).toFixed(2) + 'px');
        line.style.setProperty('--static-y', randomRange(60, 780).toFixed(2) + 'px');
      };
      reset(true);
      if (!reduced) {
        const onIter = () => reset(false);
        line.addEventListener('animationiteration', onIter);
        cleanup.push(() => line.removeEventListener('animationiteration', onIter));
      }
      field.appendChild(line);
    }
  });
  return () => {
    disposed = true;
    cleanup.forEach((fn) => fn());
    field.textContent = '';
  };
}

function rarityValue(r){
  if (r === 'S') return 5;
  if (r === 'A') return 4;
  return Number(r) || 0;
}


function copyText(txt){
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { ta.setSelectionRange(0, txt.length); } catch (e0) {}
    try { document.execCommand('copy'); } catch (e2) {}
    ta.remove();
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      // writeText() rejects ASYNCHRONOUSLY (unfocused doc / denied permission /
      // insecure origin); a sync try/catch can't see that, so .catch() + fall back.
      navigator.clipboard.writeText(txt).catch(fallback);
      return;
    }
  } catch (e) {}
  fallback();
}

function rewardParts(text, max = 6){
  // Split rewards on item separators (\u00B7, +, comma) but NOT on a comma used as a
  // thousands separator, e.g. "20,000 Shell Credit" must stay one part instead
  // of splitting into "20" and "000 Shell Credit".
  return String(text || 'Rewards')
    .split(/\s*(?:\u00B7|\+|,(?!\d))\s*/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, max);
}

// `full` (used by the hover popout, G4): show EVERY reward, no "..." truncation.
function RewardChips({ reward, limit = 2, full = false }){
  const parts = rewardParts(reward, full ? 99 : 6);
  const visible = full ? parts : parts.slice(0, limit);
  const hidden = full ? [] : parts.slice(limit);
  return (
    <div className="reward-chips">
      {visible.map((part, i) => <span key={part + '-' + i}>{part}</span>)}
      {hidden.length > 0 && <span className="more" title={hidden.join(' \u00B7 ')}>...</span>}
    </div>
  );
}

const PREMIUM_CODE_META = {
  gi:{ name:'Primogems', icon:'../../Database/GameData/gi/assets/items/UI_ItemIcon_201.webp' },
  hsr:{ name:'Stellar Jade', icon:'../../Database/GameData/hsr/assets/items/900001.webp' },
  zzz:{ name:'Polychrome', icon:'../../Database/GameData/zzz/assets/items/IconCurrency.webp' },
  wuwa:{ name:'Astrite', icon:'../../Database/GameData/ww/assets/items/UIResources/Common/Image/IconA/T_IconA_zcpq_UI.webp' },
  // Endfield's premium currency is Oroberyl, with its own icon (user 2026-08-09).
  ae:{ name:'Oroberyl', icon:'../../Database/EndfieldWiki/endfield/material-icons/Oroberyl.png' },
  nyx:{ name:'Premium currency', icon:null },
};
// Everything that is not the premium currency is just "Goodies" — the exact
// contents are one hover away (user 2026-08-09).
const NYX_CODE_GOODIES_LABEL = 'Goodies';

function premiumCodeMeta(gameKey, codes){
  if (gameKey === 'nyx') return PREMIUM_CODE_META.nyx;
  const fromCode = (codes || []).find((c) => c.premiumCurrency)?.premiumCurrency;
  return Object.assign({}, PREMIUM_CODE_META[gameKey] || PREMIUM_CODE_META.nyx, fromCode || {});
}

/* ---------------- per-game registry (single source of truth) ---------------- */
const GAME_REGISTRY = {
  gi: {
    key:'gi', name:'Genshin Impact', charName:'Skirk',
    art:'../assets/char/skirk.jpg', benchIcon:'../assets/char/skirk_icon.png',
    pageBg:'../assets/bg/backgroundnyx.png', bgPos:'42% 38%', bgSize:'138% auto', bgTransform:'scale(1.04) rotate(-2deg)',
    fns:['Characters','Database','Gallery','Wish Tracker'],
    track:{ pull:'Wish', pulls:'Wishes', title:'Wish Tracker', currency:'Primogems', cost:160,
      fives:['Skirk','Mavuika','Neuvillette','Arlecchino','Furina'], fours:['Bennett','Xiangling','Fischl','Sucrose','Rosaria'] },
    codes:[
      { code:'NYXEYE2026',   reward:'100 Primogems \u00B7 10 Mystic Enhancement Ore' },
      { code:'GENSHINGIFT',  reward:'50 Primogems \u00B7 3 Hero\u2019s Wit' },
      { code:'EA7VKTQ5N9HV', reward:'100 Primogems \u00B7 10 Mystic Enhancement Ore' },
      { code:'KT7DKSFGCRWV', reward:'100 Primogems \u00B7 5 Hero\u2019s Wit' },
      { code:'5BV8SU7ZNRWH', reward:'60 Primogems \u00B7 5 Adventurer\u2019s EXP' },
      { code:'MS7C3SV8DMZH', reward:'100 Primogems \u00B7 50,000 Mora' },
    ],
  },
  hsr: {
    key:'hsr', name:'Honkai: Star Rail', charName:'Castorice',
    art:'../assets/bg/hsrbg.png', benchIcon:'../assets/bg/hsrbg.png',
    pageBg:'../assets/bg/backgroundnyx.png', bgPos:'63% 31%', bgSize:'152% auto', bgTransform:'scaleX(-1) scale(1.07) rotate(2.5deg)',
    fns:['Characters','Database','Warp Tracker'],
    track:{ pull:'Warp', pulls:'Warps', title:'Warp Tracker', currency:'Stellar Jade', cost:160,
      fives:['Castorice','Firefly','Acheron','Robin','Aglaea'], fours:['Asta','March 7th','Herta','Tingyun','Pela'] },
    codes:[
      { code:'STARNYX26',     reward:'100 Stellar Jade \u00B7 4 Refined Aether' },
      { code:'STARRAILGIFT',  reward:'50 Stellar Jade \u00B7 2 Traveler\u2019s Guide' },
      { code:'HSRGRANDOPEN3', reward:'100 Stellar Jade \u00B7 4 Refined Aether' },
      { code:'7SAVES8RJ4HN',  reward:'50 Stellar Jade \u00B7 10,000 Credits' },
    ],
  },
  zzz: {
    key:'zzz', name:'Zenless Zone Zero', charName:'Yixuan',
    art:'../assets/bg/zzzbg3.png', benchIcon:'../assets/bg/zzzbg3.png',
    pageBg:'../assets/bg/backgroundnyx.png', bgPos:'30% 55%', bgSize:'165% auto', bgTransform:'scale(1.08) rotate(4deg)',
    fns:['Characters','Database','Signal Tracker'],
    track:{ pull:'Signal', pulls:'Signals', title:'Signal Tracker', currency:'Polychrome', cost:160,
      fives:['Yixuan','Miyabi','Zhu Yuan','Evelyn','Astra Yao'], fours:['Nicole','Anby','Billy','Corin','Ben'] },
    codes:[
      { code:'ZZZNYX2026',  reward:'100 Polychrome \u00B7 10,000 Dennies' },
      { code:'ZENLESSGIFT', reward:'100 Polychrome \u00B7 10,000 Dennies' },
      { code:'ZZZNEWELLY',  reward:'50 Polychrome \u00B7 2 Senior Investigator Log' },
    ],
  },
  wuwa: {
    key:'wuwa', name:'Wuthering Waves', charName:'Carlotta',
    art:'../assets/bg/wuwabg2.png', benchIcon:'../assets/bg/wuwabg2.png',
    pageBg:'../assets/bg/backgroundnyx.png', bgPos:'74% 45%', bgSize:'148% auto', bgTransform:'scaleX(-1) scale(1.06) rotate(-3deg)',
    fns:['Characters','Database','Convene Tracker'],
    track:{ pull:'Convene', pulls:'Convenes', title:'Convene Tracker', currency:'Astrite', cost:160,
      fives:['Carlotta','Jinhsi','Changli','Camellya','Zani'], fours:['Yangyang','Baizhi','Chixia','Sanhua','Taoqi'] },
    codes:[
      { code:'WUWANYX26',     reward:'Astrite \u00D7100 \u00B7 20,000 Shell Credit' },
      { code:'WUTHERINGGIFT', reward:'Astrite \u00D7100 \u00B7 20,000 Shell Credit' },
      { code:'WAVESHORE',     reward:'Astrite \u00D750 \u00B7 2 Premium Resonance Potion' },
    ],
  },
  ae: {
    key:'ae', name:'Arknights: Endfield', charName:'Perlica',
    art:'../assets/bg/aebg.png', benchIcon:'../assets/bg/aebg.png',
    pageBg:'../assets/bg/backgroundnyx.png', bgPos:'52% 68%', bgSize:'158% auto', bgTransform:'scale(1.08) rotate(1.5deg)',
    fns:['Characters','Database','Headhunting Tracker'],
    track:{ pull:'Headhunt', pulls:'Headhunts', title:'Headhunting Tracker', currency:'Originium', cost:120,
      fives:['Perlica','Laevatain','Chen Qianyu','Ember','Wulfgard'], fours:['Xaihi','Endmin','Da Pan','Gilberta','Snowshine'] },
    codes:[
      { code:'ENDNYX2026',   reward:'Originium \u00D7100 \u00B7 20,000 Industrial Currency' },
      { code:'ENDFIELDGIFT', reward:'Originium \u00D7100 \u00B7 20,000 Industrial Currency' },
      { code:'AKEF2025',     reward:'Originium \u00D750 \u00B7 4 Skill Summary' },
    ],
  },
};
const NYX_META = { key:'nyx', name:'Nyx', charName:'Nyx', art:'../assets/bg/noxbg.png',
  benchIcon:'../assets/bg/noxbg.png', pageBg:'../assets/bg/backgroundnyx.png', bgPos:'50% 48%', bgSize:'132% auto', bgTransform:'scaleX(-1) scale(1.03) rotate(-1deg)',
  codes:GAME_REGISTRY.gi.codes };

function dbGame(key){
  return (window.NYX_DB && window.NYX_DB.games && window.NYX_DB.games[key]) || null;
}

function dbCodes(key, fallback){
  const codesDb = window.NYX_DB && window.NYX_DB.codes;
  const rows = ((codesDb && codesDb.games && codesDb.games[key]) || dbGame(key)?.codes || [])
    .filter(c => c && c.code)
    .map(c => {
      const reward = c.reward || c.rewards || 'Rewards';
      const meta = PREMIUM_CODE_META[key] || PREMIUM_CODE_META.nyx;
      const needle = String(meta.name || '').toLowerCase().replace(/s$/, '');
      return {
        code:c.code,
        reward,
        redeemUrl:c.redeemUrl || null,
        premium:c.premium !== undefined ? !!c.premium : String(reward).toLowerCase().includes(needle),
        premiumCurrency:c.premiumCurrency || meta,
        // Kept so the codes list can order newest first (user 2026-08-09).
        added:c.added || null,
        firstSeen:c.firstSeen || null,
      };
    });
  if (rows.length) return rows;
  // The real codes source is loaded but this game has none right now → show the
  // empty state rather than fabricated sample codes. Only fall back to the
  // built-in samples when there's no codes data at all (e.g. local dev).
  return codesDb ? [] : (fallback || []);
}

function dbBannerGroup(key){
  return (window.NYX_DB && window.NYX_DB.banners && window.NYX_DB.banners.games && window.NYX_DB.banners.games[key]) || dbGame(key)?.banners || null;
}

// The banner staleness warning strip was removed from the overview
// 2026-08-08 at the user's request. The quiet "Updated <date>" line in the
// strip header remains the honest signal; the pipeline still records
// `freshness` in the banner data for tooling.

function shortDuration(ms){
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor(abs % 86400000 / 3600000);
  const m = Math.floor(abs % 3600000 / 60000);
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + m + 'm';
  return Math.max(0, m) + 'm';
}

// Shared 1s clock so every banner countdown ticks live instead of freezing at
// whatever Date.now() was when the page rendered.
function useNowTick(intervalMs){
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs || 1000);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Absolute times are always shown in the viewer's local timezone.
function bannerAbsTime(ts){
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month:'short', day:'numeric' }) + ', ' +
    d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
}

const BANNER_STATUS_META = {
  live:{ label:'Live now', cls:'live' },
  next:{ label:'Up next', cls:'next' },
  upcoming:{ label:'Upcoming', cls:'upcoming' },
  ended:{ label:'Ended', cls:'ended' },
};

// Timing block for a phase card. Only claims what the data supports: no
// progress bar without a real start AND end, no invented "42%" placeholders.
function bannerWhen(card, now){
  const hasStart = Number.isFinite(card.start);
  const hasEnd = Number.isFinite(card.end);
  if (card.status === 'live') {
    if (hasEnd && card.end <= now) {
      return { state:'ended', headline:'Ended ' + shortDuration(now - card.end) + ' ago', sub:bannerAbsTime(card.end), pct:null };
    }
    return {
      state:'live',
      headline:hasEnd ? durationParts(card.end - now) + ' left' : 'End date unconfirmed',
      sub:hasEnd ? 'Ends ' + bannerAbsTime(card.end) : null,
      pct:hasStart && hasEnd && card.end > card.start
        ? Math.max(0, Math.min(100, Math.round((now - card.start) / (card.end - card.start) * 100)))
        : null,
    };
  }
  if (hasStart && card.start > now) {
    return {
      state:card.status,
      headline:'Starts in ' + durationParts(card.start - now),
      // Only the start: an upcoming banner's end is noise next to "starts in"
      // and it pushed the line past the card (user 2026-08-11).
      sub:'Begins ' + bannerAbsTime(card.start),
      pct:null,
    };
  }
  if (hasStart || hasEnd) {
    const ref = hasEnd ? card.end : card.start;
    if (ref <= now) return { state:'ended', headline:'Ended ' + shortDuration(now - ref) + ' ago', sub:bannerAbsTime(ref), pct:null };
    return { state:card.status, headline:durationParts(ref - now) + ' left', sub:'Ends ' + bannerAbsTime(ref), pct:null };
  }
  // Nothing is known about when this runs, so the footer stays empty rather
  // than announcing the absence of a date (user 2026-08-11).
  return { state:card.status, headline:null, sub:null, pct:null };
}

const BANNER_WEAPON_COLLECTIONS = {
  gi:['weapons'],
  hsr:['light-cones'],
  zzz:['w-engines'],
  wuwa:['weapons'],
  ae:['weapons'],
};

function bannerFeaturedRank(gameKey){
  if (gameKey === 'zzz') return 4;
  if (gameKey === 'ae') return 6;
  return 5;
}

function bannerRarityValue(value){
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  const text = String(value).trim();
  if (/^s\b/i.test(text)) return 4;
  if (/^a\b/i.test(text)) return 3;
  if (/^b\b/i.test(text)) return 2;
  const n = text.match(/[0-9]+/);
  return n ? Number(n[0]) : 0;
}

function bannerRarityLabel(gameKey, rarity){
  const r = bannerRarityValue(rarity);
  if (!r) return '';
  if (gameKey === 'zzz') return r >= 4 ? 'S' : (r === 3 ? 'A' : 'B');
  if (gameKey === 'ae') return r + '\u2726';
  return r + '\u2605';
}

function dedupeByName(list){
  const seen = new Set();
  return (list || []).filter((item) => {
    const key = normalizeUnitName(item && item.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dbCollectionItems(gameKey, keys){
  const collections = (dbGame(gameKey) && dbGame(gameKey).collections) || [];
  const wanted = new Set(keys || []);
  return collections
    .filter((col) => wanted.has(col.key))
    .flatMap((col) => (col.items || []).map((item) => Object.assign({ collectionKey:col.key }, item)));
}

function weaponItemsFor(gameKey){
  const generated = window.NYX_WEAPONS && window.NYX_WEAPONS[gameKey]
    ? Object.values(window.NYX_WEAPONS[gameKey]).map((item) => Object.assign({ kind:'weapon' }, item))
    : [];
  const collection = dbCollectionItems(gameKey, BANNER_WEAPON_COLLECTIONS[gameKey] || ['weapons']);
  return dedupeByName([...generated, ...collection]).map((item) => {
    const rarity = bannerRarityValue(item.rarity || item.fields?.rarity);
    return {
      name:item.name,
      icon:item.icon || item.art,
      art:item.art || item.icon,
      rarity,
      badge:bannerRarityLabel(gameKey, rarity),
    };
  }).filter((item) => item.name && (item.icon || item.art));
}

function rosterUnitMap(gameCfg){
  const map = new Map();
  makeRoster(gameCfg).forEach((ch) => {
    if (ch.detailAvailable === false) return;
    [ch.name, ch.rawName, ...(ch.aliases || [])].filter(Boolean).forEach((name) => {
      const key = normalizeUnitName(name);
      if (key && !map.has(key)) map.set(key, ch);
    });
  });
  return map;
}

function phaseUnit(gameCfg, ch, rosterMap, index){
  const name = ch.name || ch.n || '';
  const match = rosterMap.get(normalizeUnitName(name));
  const rarity = bannerRarityValue(ch.rarity || ch.r || match?.rarity);
  // Never fall back to the game's own character art (user 2026-08-09): that art
  // is one specific character, so two units the feed has no picture for both
  // rendered as the same face — Odette and Alyosha both showed Skirk. A unit
  // with no picture of its own gets none, and the card falls back to the
  // neutral page backdrop instead of impersonating somebody.
  const art = ch.namecard || ch.art || match?.art || ch.imageFallback || ch.image || match?.icon || null;
  const icon = ch.icon || ch.image || ch.imageFallback || match?.icon || art;
  // The overview's headline card wants the character, not the namecard strip
  // Genshin cards normally lead with — namecards crop to an abstract blur at
  // card size, splashes read as a face.
  const splash = ch.art || match?.art || ch.namecard || ch.imageFallback || ch.image || match?.icon || null;
  return {
    name,
    icon,
    art,
    splash,
    rarity,
    // Badge only reflects a rarity we actually know (scrape or roster match) —
    // an unknown unit renders without one instead of a guessed "5★".
    // Only a below-headline rarity is worth a badge: 5-star is the default
    // assumption on a banner, a featured 4-star is the exception (user
    // 2026-08-08).
    badge:rarity && rarity < bannerFeaturedRank(gameCfg.key) ? bannerRarityLabel(gameCfg.key, rarity) : null,
    // Build-time facts about the character's banner history: `debut` is their
    // first ever run, `debutAt` is when they joined. Together they decide who
    // gets the big splash card on the overview board.
    debut:ch.debut === true,
    debutAt:ch.debutAt || null,
    order:index,
  };
}

// One card per scraped phase (current / next / upcoming) \u2014 nothing invented.
// Every banner surface on the site renders these same cards.
function gameBannerCards(gameCfg, source){
  const group = dbBannerGroup(gameCfg.key);
  if (!group) return [];
  const rosterMap = rosterUnitMap(gameCfg);
  const rank = bannerFeaturedRank(gameCfg.key);
  const cards = [];
  const push = (phase, status) => {
    if (!phase) return;
    const units = dedupeByName(((phase.characters) || []).map((ch, i) => phaseUnit(gameCfg, ch, rosterMap, i))).filter((u) => u.name);
    if (!units.length) return;
    cards.push({
      key:gameCfg.key + '-' + status + '-' + cards.length,
      game:source || gameCfg,
      status,
      phase:phase.phase || null,
      start:phase.start ? new Date(phase.start).getTime() : NaN,
      end:phase.end ? new Date(phase.end).getTime() : NaN,
      // Top rank only. Lower-rarity lineups are intentionally omitted.
      featured:units.filter((u) => !u.rarity || u.rarity >= rank),
      others:[],
      artPool:units.filter((u) => !u.rarity || u.rarity >= rank).map((u) => u.art).filter(Boolean),
    });
  };
  push(group.current, 'live');
  push(group.next, 'next');
  (group.upcoming || []).slice(0, 2).forEach((phase) => push(phase, 'upcoming'));
  return cards;
}

// A featured unit is a button when the page can route to that character, and
// plain text otherwise (the Nyx hub strip lists units from games whose roster
// is not loaded). Same markup either way so the card layout never shifts.
// Step text down in size until it fits its box.
//
// CSS cannot do this on its own: the rendered text and font decide whether a
// one- or two-line box overflows. The element declares its size as
// `calc(base * var(--fit))`, and this walks --fit down until it fits.
// The parent is observed rather than the element itself — observing a node
// whose font-size you are changing feeds the observer its own output.
const NYX_FIT_STEPS = [0.92, 0.84, 0.76, 0.68, 0.6, 0.54, 0.48, 0.42, 0.36];

function useFitText(text, multiline = false){
  const ref = React.useRef(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let alive = true;
    const fits = () => el.scrollWidth <= el.clientWidth + 1
      && (!multiline || el.scrollHeight <= el.clientHeight + 1);
    const fit = () => {
      if (!alive || !el.isConnected) return;
      el.style.removeProperty('--fit');
      if (fits()) return;
      for (const step of NYX_FIT_STEPS) {
        el.style.setProperty('--fit', String(step));
        if (fits()) return;
      }
    };
    fit();
    // The display faces are webfonts. The first measurement runs against the
    // fallback metrics, which are narrower, so a name that really does overflow
    // measures as fitting. Re-fit once the real faces are in and once more
    // after layout settles (user 2026-08-11).
    const frame = requestAnimationFrame(fit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit).catch(() => {});
    const box = el.parentElement;
    const observer = box && window.ResizeObserver ? new ResizeObserver(fit) : null;
    if (observer) observer.observe(box);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      if (observer) observer.disconnect();
    };
  }, [text, multiline]);
  return ref;
}

function FitText({ as:Tag = 'b', text, className, multiline = false }){
  const ref = useFitText(text, multiline);
  return <Tag ref={ref} className={className}>{text}</Tag>;
}

function BannerUnit({ unit, onOpen, showBadge = true, href }){
  const inner = (
    <React.Fragment>
      {unit.icon && <img src={unit.icon} alt="" draggable="false" />}
      <FitText text={unit.name} />
      {showBadge && unit.badge && <em>{unit.badge}</em>}
    </React.Fragment>
  );
  if (!onOpen) return <span className="gp-oban-unit" title={unit.name}>{inner}</span>;
  if (href) {
    return (
      <a className="gp-oban-unit is-link" href={href} draggable={false} title={'Open ' + unit.name}
         onClick={(event) => nyxNavClick(event, onOpen)}>{inner}</a>
    );
  }
  return (
    <button type="button" className="gp-oban-unit is-link" title={'Open ' + unit.name}
            onClick={onOpen}>{inner}</button>
  );
}

function BannerPhaseCard({ card, now, showGame, unitLink, unitHref }){
  const artPool = card.artPool || [];
  const [artIndex, setArtIndex] = React.useState(0);
  // Splash files can lag behind banner data for brand-new characters. The art
  // path is only a constructed string, so a card must verify the file actually
  // loads; broken entries drop out of the rotation and the card falls back to
  // the game background instead of an empty well.
  const [badArts, setBadArts] = React.useState(() => new Set());
  const livePool = artPool.filter((a) => !badArts.has(a));
  React.useEffect(() => {
    setArtIndex(0);
    setBadArts(new Set());
  }, [artPool.join('|')]);
  React.useEffect(() => {
    if (livePool.length < 2) return undefined;
    const id = setInterval(() => setArtIndex((idx) => idx + 1), 4200);
    return () => clearInterval(id);
  }, [artPool.join('|'), livePool.length]);
  // No usable splash means no character art at all — the neutral page backdrop
  // stands in rather than the game's mascot character (user 2026-08-09).
  const art = livePool.length ? livePool[artIndex % livePool.length] : (card.game?.bg || card.game?.pageBg);
  React.useEffect(() => {
    if (!art || !livePool.includes(art)) return undefined;
    let alive = true;
    const probe = new Image();
    probe.onerror = () => { if (alive) setBadArts((prev) => { const next = new Set(prev); next.add(art); return next; }); };
    probe.src = art;
    return () => { alive = false; probe.onerror = null; };
  }, [art]);
  const when = bannerWhen(card, now);
  const meta = BANNER_STATUS_META[when.state] || BANNER_STATUS_META[card.status] || BANNER_STATUS_META.live;
  const gameIcon = card.game?.icon || GAME_REGISTRY[card.game?.key]?.benchIcon;
  return (
    <article className={'gp-oban st-' + meta.cls + (card.containArt ? ' is-contain-art' : '')}>
      <div className="gp-oban-art" style={{ backgroundImage:bgUrl(art) }}></div>
      <div className="gp-oban-shade"></div>
      <div className="gp-oban-body">
        <div className="gp-oban-top">
          {/* The "Live now" / "Up next" pill was removed 2026-08-08 at the
              user's request; the countdown in the footer already says it. */}
          {card.phase && <span className="gp-oban-phase">{card.phase}</span>}
          {showGame && card.game && (
            <span className="gp-oban-game">
              {gameIcon && <img src={gameIcon} alt="" draggable="false" />}
              <span>{card.game.name}</span>
            </span>
          )}
        </div>
        <div className="gp-oban-featured" aria-label="Featured units">
          {card.featured.map((unit) => (
            <BannerUnit key={unit.name} unit={unit} onOpen={unitLink && unitLink(unit)} href={unitHref && unitHref(unit)} />
          ))}
        </div>
        {(card.supportLabel || card.others.length > 0) && (
          <div className="gp-oban-supports">
            {card.supportLabel && (card.supportHelp
              ? <button type="button" className="gp-oban-supports-label"
                        aria-label={card.supportHelp.label}
                        aria-haspopup="dialog"
                        onClick={card.supportHelp.onOpen}>{card.supportLabel}</button>
              : <span className="gp-oban-supports-label">{card.supportLabel}</span>)}
            {card.others.map((unit) => (
              <BannerUnit key={unit.name} unit={unit} onOpen={unitLink && unitLink(unit)} href={unitHref && unitHref(unit)} showBadge={false} />
            ))}
          </div>
        )}
        {when.headline && (
          <div className="gp-oban-foot">
            <FitText text={when.headline} />
            {when.sub && <FitText as="span" text={when.sub} />}
          </div>
        )}
      </div>
    </article>
  );
}

/* ---- overview banner board (user layout, 2026-08-08) -------------------
   Five columns across the top of a game Overview: the phase running now
   (its headline banner, then everything else running alongside), the phase
   starting next in the same split, and whatever is known after that.
   Same NYX_DB banner group every other banner surface reads — the board only
   decides which banner earns the big card. */
function bannerUnitRecency(left, right){
  if (left.debut !== right.debut) return left.debut ? -1 : 1;
  const at = (unit) => unit.debutAt || (unit.debut ? '9999-12-31' : '');
  if (at(left) !== at(right)) return at(left) > at(right) ? -1 : 1;
  return left.order - right.order;
}

function bannerBoardColumn(cfg, phase, status){
  if (!phase) return null;
  const rosterMap = rosterUnitMap(cfg);
  const rank = bannerFeaturedRank(cfg.key);
  const lossPool = phase.lossPool ? {
    current:phase.lossPool.current ? phaseUnit(cfg, phase.lossPool.current, rosterMap, 0) : null,
    previous:dedupeByName((phase.lossPool.previous || []).map((unit, index) => phaseUnit(cfg, unit, rosterMap, index))).filter((unit) => unit.name),
    permanent:dedupeByName((phase.lossPool.permanent || []).map((unit, index) => phaseUnit(cfg, unit, rosterMap, index))).filter((unit) => unit.name),
  } : null;
  const all = dedupeByName((phase.characters || []).map((ch, i) => phaseUnit(cfg, ch, rosterMap, i))).filter((unit) => unit.name);
  const units = all.filter((unit) => !unit.rarity || unit.rarity >= rank);
  if (!units.length && !lossPool?.current) return null;
  // Headline order: whoever is debuting, else whoever joined the game most
  // recently (user 2026-08-08 — a phase pairing a recent character with an
  // ancient rerun should lead with the recent one), else feed order.
  const ranked = [...units].sort(bannerUnitRecency);
  // Endfield keeps its paired headline cards; every other game demotes the
  // simultaneous 5-star banners into compact rows under the newest one.
  const heroes = lossPool?.current
    ? [lossPool.current]
    : (cfg.key === 'ae' && units.length === 2 ? ranked.slice(0, 2) : ranked.slice(0, 1));
  return {
    status,
    label:phase.phase || null,
    start:phase.start ? new Date(phase.start).getTime() : NaN,
    end:phase.end ? new Date(phase.end).getTime() : NaN,
    heroes,
    others:ranked.filter((unit) => !heroes.some((hero) => normalizeUnitName(hero.name) === normalizeUnitName(unit.name))),
    // Endfield's off-banner headliners are its loss pool. Other games omit
    // lower-rarity featured characters (user 2026-08-13).
    support:lossPool ? lossPool.previous
      : cfg.key === 'ae' ? ranked.filter((unit) => !heroes.includes(unit)) : [],
    lossPool,
  };
}

// game8's roadmap page lists story NPCs alongside real upcoming units, and a
// published banners.json can still carry them until the next scrape runs. The
// scraper filters these too (Scraper/banners/scrape.cjs `roadmapExclude`); this
// is the client-side belt so already-deployed data is corrected immediately.
const BANNER_ROADMAP_DENY = {
  gi:new Set(['pantalone', 'rerir', 'pulcinella', 'pierro', 'dainsleif', 'alice']),
};
// ...and the two the user wants kept as a joke, pinned under the real entries
// with a "copium" note. Sourced from `group.pinned` when the scraper has run;
// otherwise recovered from the roadmap rows the denylist above just removed.
const BANNER_COPIUM_PINS = { gi:['Alice', 'Dainsleif'] };
const BANNER_PLAN_LABELS = { gi:{ vesna:'7.1 Phase 1', vodyanitsa:'7.1 Phase 2' } };

function bannerRoadmapAllowed(cfg, unit){
  const deny = BANNER_ROADMAP_DENY[cfg.key];
  return !deny || !deny.has(normalizeUnitName(unit?.name));
}

function overviewBannerPins(cfg, group, rosterMap){
  const wanted = BANNER_COPIUM_PINS[cfg.key];
  if (!wanted || !wanted.length) return [];
  const byName = new Map([...(group.pinned || []), ...(group.roadmap || [])]
    .map((row) => [normalizeUnitName(row?.name), row]).filter(([name]) => name));
  return wanted
    .map((name) => byName.get(normalizeUnitName(name)) || { name })
    .map((row) => phaseUnit(cfg, row, rosterMap, 0) || { name:row.name })
    .filter((unit) => unit && unit.name);
}

function overviewBannerBoard(cfg){
  const group = dbBannerGroup(cfg.key);
  if (!group) return { current:null, next:null, later:[], planned:[], future:[], pinned:[] };
  const current = bannerBoardColumn(cfg, group.current, 'live');
  const next = bannerBoardColumn(cfg, group.next, 'next');
  const later = (group.upcoming || []).map((phase) => bannerBoardColumn(cfg, phase, 'upcoming')).filter(Boolean).slice(0, 3);
  if (cfg.key === 'ae') return { current, next, later, planned:[], future:[], pinned:[] };

  const rosterMap = rosterUnitMap(cfg);
  const pinned = overviewBannerPins(cfg, group, rosterMap);
  const roadmapRows = (group.roadmap || []).filter((unit) => bannerRoadmapAllowed(cfg, unit));
  const shown = new Set([current, next].filter(Boolean)
    .flatMap((column) => [...column.heroes, ...column.others, ...column.support])
    .map((unit) => normalizeUnitName(unit.name)));
  const trustedFuture = new Set([...(group.beta || []), ...roadmapRows]
    .map((unit) => normalizeUnitName(unit.name)));
  const rows = [];
  const add = (unit, source, hint = null, column = null) => {
    const key = normalizeUnitName(unit?.name);
    if (!key || shown.has(key)) return;
    shown.add(key);
    rows.push({ unit, source, hint, column });
  };
  for (const column of later) {
    for (const unit of [...column.heroes, ...column.others]) {
      if (trustedFuture.has(normalizeUnitName(unit.name))) add(unit, 'scheduled', null, column);
    }
  }
  const versionedRoadmap = roadmapRows.filter((unit) => bannerRoadmapVersion(unit.hint));
  for (const unit of versionedRoadmap) add(phaseUnit(cfg, unit, rosterMap, 0), 'roadmap', unit.hint);
  for (const unit of group.beta || []) add(phaseUnit(cfg, unit, rosterMap, 0), 'beta');

  const planned = rows.slice(0, 2).map((row) => ({
    ...(row.column || {}),
    status:'upcoming',
    label:row.column?.label || BANNER_PLAN_LABELS[cfg.key]?.[normalizeUnitName(row.unit?.name)] || null,
    phaseUnknown:row.source === 'beta' && !row.column?.label,
    hint:row.hint,
    start:NaN,
    end:NaN,
    heroes:[row.unit],
    others:[],
    support:[],
  }));
  const future = rows.slice(2).filter((row) => row.source !== 'beta').map((row) => row.unit);
  for (const unit of roadmapRows) {
    const key = normalizeUnitName(unit?.name);
    if (!key || shown.has(key)) continue;
    shown.add(key);
    future.push(phaseUnit(cfg, unit, rosterMap, 0));
  }
  bannerApplyPlanLabels(current, next, planned, roadmapRows);
  return { current, next, later, planned, future:future.filter(Boolean), pinned };
}

// "6.7 Phase 2" reads as a patch; "Luna VIII" is already a name. Only prefix
// the ones that are bare numbers, and never show a naked year (some feeds put
// "2026" in the version field).
function bannerPhaseHeading(column){
  const label = column && column.label ? String(column.label).trim() : '';
  if (!label || /^\d{4}$/.test(label)) return null;
  return /^\d/.test(label) ? 'Patch ' + label : label;
}

// A patch runs exactly two phases, and the minor version tops out at .8 before
// the major rolls over. So the phase after "7.0 Phase 2" is "7.1 Phase 1", not
// a third phase, and after "7.8 Phase 2" comes "8.0 Phase 1" (user 2026-08-08).
const BANNER_PHASES_PER_PATCH = 2;
const BANNER_MAX_MINOR = 8;

function bannerAdvancePhaseLabel(label){
  const text = String(label || '').trim();
  const numbered = text.match(/^(\d+)\.(\d+)\s*Phase\s*(\d+)$/i);
  if (numbered) {
    const phase = Number(numbered[3]);
    let major = Number(numbered[1]);
    let minor = Number(numbered[2]);
    if (phase < BANNER_PHASES_PER_PATCH) return major + '.' + minor + ' Phase ' + (phase + 1);
    minor += 1;
    if (minor > BANNER_MAX_MINOR) { major += 1; minor = 0; }
    return major + '.' + minor + ' Phase 1';
  }
  // A named version ("Luna VIII Phase 1") can still count within its own patch,
  // but the next version's name is not something to guess.
  const named = text.match(/^(.*?)\s*Phase\s*(\d+)$/i);
  if (!named || !named[1]) return null;
  const phase = Number(named[2]);
  return phase < BANNER_PHASES_PER_PATCH ? named[1] + ' Phase ' + (phase + 1) : null;
}

// The phase after next rarely carries a label of its own, so it is counted on
// from the next one.
function bannerNextPhaseHeading(later, next){
  const own = bannerPhaseHeading(later);
  if (own) return own;
  const advanced = bannerAdvancePhaseLabel(next && next.label);
  return advanced ? bannerPhaseHeading({ label:advanced }) : null;
}

function bannerRoadmapVersion(hint){
  const text = String(hint || '').trim();
  const phaseFirst = text.match(/\bPhase\s*(\d+)\b[\s\S]*?\b(?:Version|Patch)\s*(\d+(?:\.\d+)+)/i);
  if (phaseFirst) return { version:phaseFirst[2], phase:Number(phaseFirst[1]) };
  const versionFirst = text.match(/\b(?:Version|Patch)\s*(\d+(?:\.\d+)+)(?:[\s\S]*?\bPhase\s*(\d+)\b)?/i)
    || text.match(/\bRelease\s+in\s+(\d+(?:\.\d+)+)\b/i);
  return versionFirst ? { version:versionFirst[1], phase:versionFirst[2] ? Number(versionFirst[2]) : null } : null;
}

function bannerPlanLabelFromHint(hint, previous){
  const parsed = bannerRoadmapVersion(hint);
  if (!parsed) return bannerAdvancePhaseLabel(previous);
  if (parsed.phase) return `${parsed.version} Phase ${parsed.phase}`;
  const prior = String(previous || '').match(/^(\d+(?:\.\d+)+)\s+Phase\s+(\d+)$/i);
  return prior && prior[1] === parsed.version
    ? bannerAdvancePhaseLabel(previous)
    : `${parsed.version} Phase 1`;
}

function bannerUnknownPhaseLabel(previous){
  const text = String(previous || '').trim();
  const existing = text.match(/^(\d+(?:\.\d+)+)\s+Phase\s+\?$/i);
  if (existing) return `${existing[1]} Phase ?`;
  const advanced = bannerAdvancePhaseLabel(text);
  const version = String(advanced || '').match(/^(\d+(?:\.\d+)+)\s+Phase\s+\d+$/i);
  return version ? `${version[1]} Phase ?` : null;
}

function bannerApplyPlanLabels(current, next, planned, roadmap){
  const roadmapHintFor = (column) => {
    const names = new Set([...(column?.heroes || []), ...(column?.others || [])]
      .map((unit) => normalizeUnitName(unit.name)));
    return (roadmap || []).find((row) => names.has(normalizeUnitName(row.name)))?.hint || null;
  };
  if (current && !current.label) current.label = bannerPlanLabelFromHint(roadmapHintFor(current), null);
  if (next && !next.label) next.label = bannerPlanLabelFromHint(roadmapHintFor(next), current?.label || null);
  let previous = next?.label || current?.label || null;
  for (const column of planned) {
    column.label = column.label || (column.phaseUnknown
      ? bannerUnknownPhaseLabel(previous)
      : bannerPlanLabelFromHint(column.hint, previous));
    previous = column.label || previous;
  }
}

function BannerBoardRow({ unit, status, onOpen, note, href }){
  const body = (
    <React.Fragment>
      {unit.icon && <img src={unit.icon} alt="" draggable="false" loading="lazy" />}
      <span className="gp-ovb-row-text">
        <FitText text={unit.name} />
        {note && <em className="gp-ovb-row-note">{note}</em>}
      </span>
    </React.Fragment>
  );
  return (
    <div className={'gp-ovb-row st-' + status + (note ? ' has-note' : '')}>
      {unit.splash && <div className="gp-ovb-row-art" style={{ backgroundImage:bgUrl(unit.splash) }}></div>}
      {onOpen && href
        ? <a className="gp-ovb-row-body is-link" href={href} draggable={false} title={'Open ' + unit.name}
             onClick={(event) => nyxNavClick(event, onOpen)}>{body}</a>
        : onOpen
          ? <button type="button" className="gp-ovb-row-body is-link" title={'Open ' + unit.name}
                    onClick={onOpen}>{body}</button>
          : <div className="gp-ovb-row-body">{body}</div>}
    </div>
  );
}

function BannerBoardColumn({ heading, className, children }){
  if (!React.Children.count(children)) return <div aria-hidden="true"></div>;
  return (
    <div className={'gp-ovb-col' + (className ? ' ' + className : '')}>
      <b className={'gp-ovb-heading' + (heading ? '' : ' is-blank')}>{heading || ' '}</b>
      <div className="gp-ovb-body">{children}</div>
    </div>
  );
}

// Endfield only: losing the 50/50 on the limited banner gives you one of the
// previous banner characters, so those names are a loss pool rather than
// separate banners running alongside (user 2026-08-08).
function BannerBoardNote({ title, children }){
  return (
    <div className="gp-ovb-note">
      <b>{title}</b>
      <span>{children}</span>
    </div>
  );
}

function OverviewBannerBoard({ cfg, onOpenMaterial }){
  const now = useNowTick(1000);
  const lossDialogRef = React.useRef(null);
  const openLossHelp = React.useCallback(() => {
    const dialog = lossDialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const closeLossHelp = React.useCallback(() => {
    const dialog = lossDialogRef.current;
    if (dialog?.open) dialog.close();
  }, []);
  const board = React.useMemo(() => overviewBannerBoard(cfg), [cfg.key]);
  // A banner name is a link into that character's own page, and the Back button
  // there returns here rather than to the roster (user 2026-08-09). Only units
  // this game actually has a page for are linked.
  const rosterMap = React.useMemo(() => rosterUnitMap(cfg), [cfg.key]);
  const openUnit = React.useCallback((unit) => {
    if (!onOpenMaterial || !unit?.name) return;
    const match = rosterMap.get(normalizeUnitName(unit.name));
    if (!match) return;
    onOpenMaterial(cfg.key, match.rawName || match.name || unit.name, { from:'overview' });
  }, [cfg.key, onOpenMaterial, rosterMap]);
  // Returns a click handler for units this game has a page for, null otherwise —
  // an unreleased unit stays plain text rather than a button that does nothing.
  const unitLink = React.useCallback((unit) => (
    onOpenMaterial && unit?.name && rosterMap.has(normalizeUnitName(unit.name))
      ? () => openUnit(unit)
      : null
  ), [onOpenMaterial, rosterMap, openUnit]);
  // The matching address for the same units, so a linked name can also be
  // ctrl/cmd/middle-clicked into its own tab. Resolved through the roster so the
  // address matches exactly what a plain click navigates to.
  const unitHref = React.useCallback((unit) => {
    const match = unit?.name ? rosterMap.get(normalizeUnitName(unit.name)) : null;
    return match ? nyxCharacterHref(cfg.key, match.rawName || match.name || unit.name) : undefined;
  }, [cfg.key, rosterMap]);
  const lossUnitLink = React.useCallback((unit) => {
    const open = unitLink(unit);
    return open ? () => { closeLossHelp(); open(); } : null;
  }, [unitLink, closeLossHelp]);
  // The column heading above already names the phase, so the card does not
  // repeat it — that space belongs to the splash art.
  const heroCard = (column, hero, index) => ({
    key:cfg.key + '-' + column.status + '-' + index,
    game:cfg,
    status:column.status,
    phase:null,
    start:column.start,
    end:column.end,
    featured:[hero],
    // Endfield's paired headline banners share the same loss pool.
    others:cfg.key === 'ae' ? column.support : [],
    // ZZZ agent renders are full-body; letting them cover the card crops the
    // agent to a torso, so they are contained and zoomed instead.
    containArt:cfg.key === 'zzz',
    supportLabel:column.lossPool ? 'Available on loss' : null,
    supportHelp:column.lossPool
      ? { label:'Available on loss', onOpen:openLossHelp }
      : null,
    // One art only — a two-entry pool would crossfade the splash against the
    // namecard every few seconds.
    artPool:[hero.splash].filter(Boolean),
  });
  const heroCards = (column) => (column ? column.heroes.map((hero, index) => heroCard(column, hero, index)) : []);
  const currentHeroes = heroCards(board.current);
  const currentLossPool = board.current?.lossPool || null;
  const lossSequence = currentLossPool ? [
    { label:'Current banner', outcome:'Rate-up win', unit:currentLossPool.current },
    { label:'Previous banner', outcome:'Available on loss', unit:currentLossPool.previous[0] },
    { label:'Two banners ago', outcome:'Available on loss', unit:currentLossPool.previous[1] },
  ].filter((row) => row.unit) : [];
  // Endfield's off-banner characters are the loss pool, not parallel banners.
  const lossPool = cfg.key === 'ae';
  const laterUnits = board.later.flatMap((column) => [...column.heroes, ...column.others].map((unit) => ({ unit, column, label:bannerPhaseHeading(column) })));
  // Endfield runs one banner at a time and announces little, so the middle
  // columns would sit empty while the later column overflowed. Its upcoming
  // operators move up into columns 2-4 and the later column is dropped
  // entirely — no placeholder (user 2026-08-11).
  const aeUpcoming = lossPool ? laterUnits.slice(0, 3) : [];
  // Shown as full-art cards, the same shape as the live banner (user
  // 2026-08-11). A teased operator has no dates and no known loss pool yet, so
  // the card carries the art and the name and nothing it cannot stand behind.
  const aeUpcomingCards = aeUpcoming.map((row, index) => ({
    ...heroCard(row.column, row.unit, 'later-' + index),
    status:'upcoming',
    others:[],
    supportLabel:null,
    supportHelp:null,
  }));
  const aeColumn = (index) => (aeUpcomingCards[index]
    ? <BannerPhaseCard card={aeUpcomingCards[index]} now={now} unitLink={unitLink} unitHref={unitHref} />
    : null);
  const phaseColumn = (column) => {
    const cards = heroCards(column);
    if (!cards.length) return null;
    return (
      <React.Fragment>
        <BannerPhaseCard card={cards[0]} now={now} unitLink={unitLink} unitHref={unitHref} />
        {column.others.map((unit) => (
          <BannerBoardRow key={unit.name} unit={unit} status={column.status} onOpen={unitLink(unit)} href={unitHref(unit)} />
        ))}
      </React.Fragment>
    );
  };
  if (!lossPool) {
    return (
      <section className="gp-ovb" aria-label="Banner schedule">
        <BannerBoardColumn heading={bannerPhaseHeading(board.current)}>
          {phaseColumn(board.current)}
        </BannerBoardColumn>
        <BannerBoardColumn heading={bannerPhaseHeading(board.next)}>
          {phaseColumn(board.next)}
        </BannerBoardColumn>
        <BannerBoardColumn heading={bannerPhaseHeading(board.planned[0])}>
          {phaseColumn(board.planned[0])}
        </BannerBoardColumn>
        <BannerBoardColumn heading={bannerPhaseHeading(board.planned[1])}>
          {phaseColumn(board.planned[1])}
        </BannerBoardColumn>
        {/* The Announced list scrolls inside a capped body. Without the cap its
            row count set the grid row height for every column, so a long list
            inflated the headline banner cards to 3x the size they have on the
            other games (user 2026-08-14). The copium pins sit below the scroll
            area so they stay visible and don't count toward the cap. */}
        <BannerBoardColumn className="is-announced"
                           heading={(board.future.length || board.pinned.length) ? 'Announced' : null}>
          {board.future.length > 0 && (
            <div className="gp-ovb-scroll">
              {board.future.map((unit) => (
                <BannerBoardRow key={unit.name} unit={unit} status="upcoming" onOpen={unitLink(unit)} href={unitHref(unit)} />
              ))}
            </div>
          )}
          {board.pinned.length > 0 && (
            <div className="gp-ovb-pins">
              {board.pinned.map((unit) => (
                <BannerBoardRow key={unit.name} unit={unit} status="upcoming" note="copium" onOpen={unitLink(unit)} href={unitHref(unit)} />
              ))}
            </div>
          )}
        </BannerBoardColumn>
      </section>
    );
  }
  return (
    <section className="gp-ovb" aria-label="Banner schedule">
      <BannerBoardColumn heading={bannerPhaseHeading(board.current)}>
        {currentHeroes.length ? <BannerPhaseCard card={currentHeroes[0]} now={now} unitLink={unitLink} unitHref={unitHref} /> : null}
      </BannerBoardColumn>
      <BannerBoardColumn heading={aeUpcoming.length ? 'Upcoming' : null}>
        {aeColumn(0)}
      </BannerBoardColumn>
      <BannerBoardColumn>
        {aeColumn(1)}
      </BannerBoardColumn>
      <BannerBoardColumn>
        {aeColumn(2)}
      </BannerBoardColumn>
      {currentLossPool && (
        <dialog ref={lossDialogRef} className="gp-ovb-modal" aria-labelledby="gp-endfield-loss-title"
                onKeyDown={(event) => { if (event.key === 'Escape') closeLossHelp(); }}
                onClick={(event) => { if (event.target === event.currentTarget) closeLossHelp(); }}>
          <div className="gp-ovb-modal-box">
            <div className="gp-ovb-modal-head">
              <div>
                <span>Chartered Headhunting</span>
                <h2 id="gp-endfield-loss-title">Available on loss</h2>
              </div>
              <button type="button" className="gp-ovb-modal-close" onClick={closeLossHelp} aria-label="Close">×</button>
            </div>
            <p className="gp-ovb-loss-rule">The current banner is the win. On a 6★ loss, you can get up to two preceding rate-ups or a permanent operator. A rate-up leaves after its third Chartered banner.</p>
            <div className="gp-ovb-loss-sequence" aria-label="Recent Chartered rate-ups">
              {lossSequence.map((row) => (
                <div className="gp-ovb-loss-step" key={row.label}>
                  <span>{row.label}</span>
                  <BannerUnit unit={row.unit} onOpen={lossUnitLink(row.unit)} href={unitHref(row.unit)} showBadge={false} />
                  <strong>{row.outcome}</strong>
                </div>
              ))}
            </div>
            <section className="gp-ovb-loss-permanent" aria-labelledby="gp-endfield-permanent-title">
              <h3 id="gp-endfield-permanent-title">Permanent operators · Available on loss</h3>
              <div>
                {currentLossPool.permanent.map((unit) => (
                  <BannerUnit key={unit.name} unit={unit} onOpen={lossUnitLink(unit)} href={unitHref(unit)} showBadge={false} />
                ))}
              </div>
            </section>
          </div>
        </dialog>
      )}
    </section>
  );
}

function CurrentBannerStrip({ cfg }){
  const now = useNowTick(1000);
  const isNyx = cfg.key === 'nyx';
  // Game pages show the full phase flow; the Nyx overview shows what's live
  // in each game right now (the All Banners tab has the rest). Memoized: the
  // card data is static, only the countdowns tick.
  const cards = React.useMemo(() => (
    isNyx
      ? SIM_GAMES.flatMap((game) => gameBannerCards(GAME_REGISTRY[game.key], game).filter((c) => c.status === 'live').slice(0, 1))
      : gameBannerCards(cfg)
  ), [cfg.key]);
  // The hub strip stays hidden when nothing is live; a game overview keeps the
  // section so the page never collapses to an empty pane.
  if (!cards.length && isNyx) return null;
  return (
    <section className="gp-current-banners" aria-label="Current banners">
      {/* The "Updated <date>" stamp was removed 2026-08-09 at the user's
          request — when the data was refreshed is not something a player needs. */}
      <div className="gp-current-banners-head">
        <GPSec title="Current Banners" icon="../assets/decor/orbit_burst.png" className="nyx-u-fill" />
      </div>
      {cards.length
        ? <div className="gp-current-banner-row">
            {cards.map((card) => (
              <div className="gp-current-banner-cell" key={card.key}>
                <BannerPhaseCard card={card} now={now} showGame={isNyx} />
              </div>
            ))}
          </div>
        : <div className="gp-oban-empty">No confirmed banners right now.</div>}
    </section>
  );
}

const RESET_MS = {
  day:24 * 60 * 60 * 1000,
  week:7 * 24 * 60 * 60 * 1000,
};

const RESET_REGIONS = {
  eu:{ key:'eu', label:'Europe', short:'EU', offset:1 },
  na:{ key:'na', label:'America', short:'NA', offset:-5 },
  asia:{ key:'asia', label:'Asia', short:'Asia', offset:8 },
};

function nextLocalResetAt(now, year, month, day, hour){
  return new Date(year, month, day, hour, 0, 0, 0).getTime();
}

function serverParts(now, offset){
  const d = new Date(now + offset * 60 * 60 * 1000);
  return { year:d.getUTCFullYear(), month:d.getUTCMonth(), date:d.getUTCDate(), day:d.getUTCDay() };
}

function serverResetAt(year, month, day, hour, offset){
  return Date.UTC(year, month, day, hour - offset, 0, 0, 0);
}

function nextDailyReset(now, region){
  if (region && Number.isFinite(region.offset)) {
    const p = serverParts(now, region.offset);
    let next = serverResetAt(p.year, p.month, p.date, 4, region.offset);
    if (next <= now) next = serverResetAt(p.year, p.month, p.date + 1, 4, region.offset);
    return next;
  }
  const d = new Date(now);
  let next = nextLocalResetAt(d, d.getFullYear(), d.getMonth(), d.getDate(), 4);
  if (next <= now) next += RESET_MS.day;
  return next;
}

function nextWeeklyReset(now, region){
  if (region && Number.isFinite(region.offset)) {
    const p = serverParts(now, region.offset);
    const daysUntilMonday = (8 - p.day) % 7;
    let next = serverResetAt(p.year, p.month, p.date + daysUntilMonday, 4, region.offset);
    if (next <= now) next = serverResetAt(p.year, p.month, p.date + daysUntilMonday + 7, 4, region.offset);
    return next;
  }
  const d = new Date(now);
  const day = d.getDay();
  const daysUntilMonday = (8 - day) % 7;
  let next = nextLocalResetAt(d, d.getFullYear(), d.getMonth(), d.getDate() + daysUntilMonday, 4);
  if (next <= now) next += RESET_MS.week;
  return next;
}

function nextMonthlyReset(now, region){
  if (region && Number.isFinite(region.offset)) {
    const p = serverParts(now, region.offset);
    let next = serverResetAt(p.year, p.month, 1, 4, region.offset);
    if (next <= now) next = serverResetAt(p.year, p.month + 1, 1, 4, region.offset);
    return next;
  }
  const d = new Date(now);
  let next = nextLocalResetAt(d, d.getFullYear(), d.getMonth(), 1, 4);
  if (next <= now) next = nextLocalResetAt(d, d.getFullYear(), d.getMonth() + 1, 1, 4);
  return next;
}

function nextSemiMonthlyReset(now, region){
  if (region && Number.isFinite(region.offset)) {
    const p = serverParts(now, region.offset);
    const candidates = [
      serverResetAt(p.year, p.month, 1, 4, region.offset),
      serverResetAt(p.year, p.month, 16, 4, region.offset),
      serverResetAt(p.year, p.month + 1, 1, 4, region.offset),
    ];
    return candidates.find((ts) => ts > now) || candidates[candidates.length - 1];
  }
  const d = new Date(now);
  const candidates = [
    nextLocalResetAt(d, d.getFullYear(), d.getMonth(), 1, 4),
    nextLocalResetAt(d, d.getFullYear(), d.getMonth(), 16, 4),
    nextLocalResetAt(d, d.getFullYear(), d.getMonth() + 1, 1, 4),
  ];
  return candidates.find((ts) => ts > now) || candidates[candidates.length - 1];
}

function resetTimerRows(now, regionKey, gameKey){
  // These four rules are Genshin-specific. Do not silently paint them onto
  // another game's overview; nyx-0040 supplies other sourced schedules.
  if (gameKey !== 'gi') return [];
  const region = RESET_REGIONS[regionKey] || RESET_REGIONS.na;
  return [
    { key:'abyss', label:'Abyss', target:nextSemiMonthlyReset(now, region) },
    { key:'theater', label:'Imaginarium', target:nextMonthlyReset(now, region) },
    { key:'weekly', label:'Weekly', target:nextWeeklyReset(now, region) },
    { key:'daily', label:'Daily', target:nextDailyReset(now, region) },
  ];
}

function durationParts(ms){
  const safe = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(safe / 86400);
  const h = Math.floor(safe % 86400 / 3600);
  const m = Math.floor(safe % 3600 / 60);
  const s = safe % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return d > 0 ? d + 'd ' + pad(h) + 'h ' + pad(m) + 'm' : pad(h) + 'h ' + pad(m) + 'm ' + pad(s) + 's';
}

// Custom timers now live in the shared v2 store (features/timeline/
// custom-timer-storage.js). These thin wrappers keep the Timers card on
// the shared helper — load performs the safe v1->v2 migration, save
// normalizes + persists. v2 rows are a superset of the old v1 shape
// (they still carry id/label/target/recur), so the card renders them
// unchanged.
function loadCustomTimers(gameKey){
  return nyxLoadCustomTimersV2(gameKey);
}

function saveCustomTimers(gameKey, rows){
  return nyxSaveCustomTimersV2(gameKey, rows);
}

function resetRegionStorageKey(gameKey){
  return nyxLegacyResetRegionKey(gameKey);
}

function loadResetRegion(gameKey){
  return nyxLoadTimePreference(gameKey).serverRegion;
}

function subscribeResetRegion(gameKey, cb){
  if (typeof cb !== 'function') return () => {};
  return nyxSubscribeTimePreference(gameKey, (preference) => cb(preference.serverRegion));
}
function saveResetRegion(gameKey, regionKey){
  if (!RESET_REGIONS[regionKey]) return;
  nyxPatchTimePreference(gameKey, { serverRegion:regionKey, displayMode:'server' });
}

function datetimeLocalValue(ts){
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// Custom timers may recur: 'interval' fires every N days; 'monthly' fires on the
// same day-of-month at the same time. Stored alongside the one-off target.
function sanitizeRecur(recur){
  if (!recur || typeof recur !== 'object') return null;
  if (recur.type === 'monthly') return { type:'monthly' };
  if (recur.type === 'interval') {
    const days = Number(recur.days);
    return Number.isFinite(days) && days > 0 ? { type:'interval', days:Math.round(days) } : null;
  }
  return null;
}

// The next firing at or after `now`. One-off timers return their raw target;
// recurring timers roll forward past `now` so they never read as "Expired".
function nextRecurringTarget(target, recur, now){
  const t = Number(target);
  if (!Number.isFinite(t) || !recur || t > now) return t;
  if (recur.type === 'interval') {
    const stepMs = recur.days * RESET_MS.day;
    if (stepMs <= 0) return t;
    return t + Math.ceil((now - t) / stepMs) * stepMs;
  }
  if (recur.type === 'monthly') {
    const base = new Date(t);
    const day = base.getDate(), h = base.getHours(), mi = base.getMinutes();
    const ref = new Date(now);
    let cand = new Date(ref.getFullYear(), ref.getMonth(), day, h, mi, 0, 0);
    if (cand.getTime() <= now) cand = new Date(ref.getFullYear(), ref.getMonth() + 1, day, h, mi, 0, 0);
    return cand.getTime();
  }
  if (recur.type === 'semimonthly') {
    const base = new Date(t);
    const h = base.getHours(), mi = base.getMinutes();
    const ref = new Date(now);
    const cands = [
      new Date(ref.getFullYear(), ref.getMonth(), 1, h, mi, 0, 0).getTime(),
      new Date(ref.getFullYear(), ref.getMonth(), 16, h, mi, 0, 0).getTime(),
      new Date(ref.getFullYear(), ref.getMonth() + 1, 1, h, mi, 0, 0).getTime(),
    ];
    return cands.find((x) => x > now) || cands[cands.length - 1];
  }
  return t;
}

// Firing status for any custom timer row (point / range / recurring),
// respecting an optional recur.until end bound. `ms` is the countdown to
// the returned event, or null when the row has ended/expired.
function customTimerFireInfo(row, now){
  if (!row) return { label:'', ms:null };
  if (row.type === 'range') {
    if (now < row.start) return { label:'Starts in', ms:row.start - now };
    if (now <= row.end) return { label:'Ends in', ms:row.end - now };
    return { label:'Ended', ms:null };
  }
  if (row.type === 'recurring' && row.recur) {
    const fire = nextRecurringTarget(row.target, row.recur, now);
    if (!Number.isFinite(fire) || (Number.isFinite(row.recur.until) && fire > row.recur.until)) {
      return { label:'Ended', ms:null };
    }
    return { label:'', ms:fire - now };
  }
  const t = Number(row.target);
  if (!Number.isFinite(t)) return { label:'', ms:null };
  return t > now ? { label:'', ms:t - now } : { label:'Expired', ms:null };
}

function recurLabel(recur){
  if (!recur) return '';
  if (recur.type === 'monthly') return 'Monthly';
  if (recur.type === 'semimonthly') return 'Twice monthly';
  if (recur.type === 'interval') {
    const d = recur.days;
    if (d % 7 === 0 && d >= 7) { const w = d / 7; return w === 1 ? 'Weekly' : 'Every ' + w + ' weeks'; }
    return d === 1 ? 'Daily' : 'Every ' + d + ' days';
  }
  return '';
}

function TimePreferenceControl({ gameKey }){
  const [preference, setPreference] = React.useState(() => nyxLoadTimePreference(gameKey));
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef(null);
  const customButtonRef = React.useRef(null);
  const zoneRef = React.useRef(null);
  const zones = React.useMemo(() => nyxSupportedTimeZones(), []);
  React.useEffect(() => {
    setPreference(nyxLoadTimePreference(gameKey));
    setOpen(false);
    return nyxSubscribeTimePreference(gameKey, setPreference);
  }, [gameKey]);
  React.useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => customButtonRef.current?.focus());
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => zoneRef.current?.focus());
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
  // The server-time choice is global: one pick drives every game's timers and
  // timelines (user decision 2026-07-15, #2).
  const apply = (patch) => {
    Object.keys(GAME_REGISTRY).concat('nyx').forEach((key) => {
      if (key !== gameKey) nyxPatchTimePreference(key, patch);
    });
    setPreference(nyxPatchTimePreference(gameKey, patch));
  };
  const pickRegion = (region) => {
    apply({ serverRegion:region, displayMode:'server' });
    setOpen(false);
  };
  const pickCustom = () => {
    if (preference.displayMode !== 'custom') apply({ displayMode:'custom' });
    setOpen((value) => !value);
  };
  const selected = preference.displayMode === 'custom' ? 'custom' : preference.serverRegion;
  const fieldId = 'nyx-time-zone-' + String(gameKey || 'nyx').replace(/[^a-z0-9_-]/gi, '');
  return (
    <div className="nyx-time-pref" ref={rootRef}>
      {/* Compact text choices: three servers, then Custom behind a divider. */}
      <div className="nyx-time-pref-switch" role="group" aria-label="Server region and display timezone">
        <div className="nyx-time-pref-regions">
          {['eu','na','asia'].map((key) => (
            <button type="button" key={key} className={selected === key ? 'on' : ''}
                    aria-pressed={selected === key} onClick={() => pickRegion(key)}>
              {RESET_REGIONS[key].short}
            </button>
          ))}
          <span className="nyx-time-pref-div" aria-hidden="true"></span>
          <button type="button" ref={customButtonRef}
                  className={'nyx-time-pref-custom' + (selected === 'custom' ? ' on' : '')}
                  aria-pressed={selected === 'custom'} aria-expanded={open}
                  aria-controls={open ? fieldId + '-panel' : undefined} onClick={pickCustom}>
            Custom
          </button>
        </div>
      </div>
      {open && (
        <div className="nyx-time-pref-popover" id={fieldId + '-panel'} role="dialog" aria-label="Custom timezone">
          <label htmlFor={fieldId}>
            <span>Display timezone</span>
            <select id={fieldId} ref={zoneRef} value={preference.timeZone}
                    onChange={(event) => apply({ displayMode:'custom', timeZone:event.target.value })}>
              {zones.indexOf(preference.timeZone) === -1 && (
                <option value={preference.timeZone}>{preference.timeZone.replace(/_/g, ' ')}</option>
              )}
              {zones.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <label htmlFor={fieldId + '-server'}>
            <span>Reset server</span>
            <select id={fieldId + '-server'} value={preference.serverRegion}
                    onChange={(event) => apply({ displayMode:'custom', serverRegion:event.target.value })}>
              <option value="eu">EU</option>
              <option value="na">NA</option>
              <option value="asia">Asia</option>
            </select>
          </label>
          <p>Dates use your timezone. Resets still follow the chosen game server.</p>
        </div>
      )}
    </div>
  );
}

function ResetTimersPanel({ gameKey }){
  const [now, setNow] = React.useState(Date.now());
  const [regionKey, setRegionKey] = React.useState(() => loadResetRegion(gameKey));
  const [custom, setCustom] = React.useState(() => loadCustomTimers(gameKey));
  const [label, setLabel] = React.useState('');
  const [target, setTarget] = React.useState(() => datetimeLocalValue(Date.now() + RESET_MS.day));
  const [recurMode, setRecurMode] = React.useState('once');
  const [recurEvery, setRecurEvery] = React.useState('1');
  const [recurUnit, setRecurUnit] = React.useState('day');
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [gameKey]);
  React.useEffect(() => {
    setRegionKey(loadResetRegion(gameKey));
    setCustom(loadCustomTimers(gameKey));
    setLabel('');
    setTarget(datetimeLocalValue(Date.now() + RESET_MS.day));
    setRecurMode('once');
    setRecurEvery('1');
    setRecurUnit('day');
  }, [gameKey]);
  // Share the server-region selection and the timer store with the banner
  // timeline (both mounted together): re-read whenever either changes.
  React.useEffect(() => subscribeResetRegion(gameKey, setRegionKey), [gameKey]);
  React.useEffect(() => nyxSubscribeCustomTimers(gameKey, setCustom), [gameKey]);
  const buildRecur = () => {
    if (recurMode === 'monthly') return { type:'monthly' };
    if (recurMode === 'semimonthly') return { type:'semimonthly' };
    if (recurMode === 'interval') {
      const every = Math.max(1, Math.round(Number(recurEvery) || 1));
      return sanitizeRecur({ type:'interval', days:every * (recurUnit === 'week' ? 7 : 1) });
    }
    return null;
  };
  const addTimer = () => {
    const clean = label.trim();
    const ts = new Date(target).getTime();
    if (!clean || !Number.isFinite(ts)) return;
    const recur = buildRecur();
    const timer = nyxMakeTimerV2({ label:clean, target:ts, recur });
    if (!timer) return;
    // Per-id upsert on a fresh store read (never a whole-array clobber),
    // so the timeline's concurrent edits survive (Sol finding #2).
    setCustom(nyxUpsertCustomTimerV2(gameKey, timer));
    setLabel('');
    setTarget(datetimeLocalValue(Date.now() + RESET_MS.day));
    setRecurMode('once');
    setRecurEvery('1');
    setRecurUnit('day');
  };
  const removeTimer = (id) => setCustom(nyxRemoveCustomTimerV2(gameKey, id));
  const toggleTimer = (id) => setCustom(nyxToggleCustomTimerV2(gameKey, id));
  const rows = resetTimerRows(now, regionKey, gameKey);
  return (
    <section className="gp-reset-panel" aria-label="Reset timers">
      <div className="gp-reset-head">
        <span>Reset Timers</span>
      </div>
      {rows.length > 0 ? (
        <div className="gp-reset-grid">
          {rows.map((row) => (
            <div className={'gp-reset-tile rt-' + row.key} key={row.key}>
              <span className="k">{row.label}</span>
              <span className="v">{durationParts(row.target - now)}</span>
            </div>
          ))}
        </div>
      ) : <p className="gp-reset-unknown">No sourced automatic reset schedule for this game yet.</p>}
      {custom.length > 0 && (
        <div className="gp-reset-custom">
          {custom.map((row) => {
            const info = customTimerFireInfo(row, now);
            const rl = recurLabel(row.recur);
            const off = row.enabled === false;
            return (
              <div className={'gp-reset-tile custom' + (off ? ' off' : '')} key={row.id}>
                <span className="k">{row.label}{rl && <em className="gp-reset-recur" title={'Recurs: ' + rl}>{'↻ ' + rl}</em>}</span>
                <span className="v">{info.ms != null ? durationParts(info.ms) : info.label}</span>
                <button type="button" aria-pressed={!off} aria-label={(off ? 'Enable ' : 'Disable ') + row.label} title={off ? 'Enable timer' : 'Disable timer'} onClick={() => toggleTimer(row.id)}>{off ? '○' : '●'}</button>
                <button type="button" aria-label={'Remove ' + row.label} title="Remove custom timer" onClick={() => removeTimer(row.id)}>x</button>
              </div>
            );
          })}
        </div>
      )}
      <div className="gp-reset-form" aria-label="Add custom timer">
        <input value={label} placeholder="Custom timer" maxLength="42" onChange={(e) => setLabel(e.target.value)} />
        <input type="datetime-local" value={target} onChange={(e) => setTarget(e.target.value)} />
        <div className="gp-reset-recur-row">
          <select value={recurMode} aria-label="Repeat" onChange={(e) => setRecurMode(e.target.value)}>
            <option value="once">One-time</option>
            <option value="interval">Repeat every…</option>
            <option value="semimonthly">Twice monthly (1st + 16th)</option>
            <option value="monthly">Monthly (same date)</option>
          </select>
          {recurMode === 'interval' && (
            <div className="gp-reset-every">
              <input type="number" min="1" max="365" value={recurEvery} aria-label="Interval amount"
                     onChange={(e) => setRecurEvery(e.target.value)} />
              <select value={recurUnit} aria-label="Interval unit" onChange={(e) => setRecurUnit(e.target.value)}>
                <option value="day">days</option>
                <option value="week">weeks</option>
              </select>
            </div>
          )}
        </div>
        <button type="button" onClick={addTimer} disabled={!label.trim()}>Add</button>
      </div>
    </section>
  );
}

function formatUpdated(iso){
  if (!iso) return 'local fixtures';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'local fixtures';
  return d.toLocaleDateString(undefined, { month:'short', day:'numeric' }) + ', ' +
    d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
}

Object.keys(GAME_REGISTRY).forEach((key) => {
  const cfg = GAME_REGISTRY[key];
  const roster = getCmRoster(key);
  if (!roster.length) return;
  const top = roster[0];
  const high = roster.filter(ch => rarityValue(ch.r) >= (key === 'ae' ? 5 : 5)).map(ch => ch.n).slice(0, 8);
  const low = roster.filter(ch => rarityValue(ch.r) < (key === 'ae' ? 5 : 5)).map(ch => ch.n).slice(0, 8);
  cfg.roster = roster;
  cfg.charName = top.n;
  cfg.art = top.art || top.card || cfg.art;
  cfg.benchIcon = top.icon || top.card || cfg.benchIcon;
  cfg.codes = dbCodes(key, cfg.codes);
  cfg.track = Object.assign({}, cfg.track, {
    fives:high.length ? high : roster.slice(0, 8).map(ch => ch.n),
    fours:low.length ? low : roster.slice(8, 16).map(ch => ch.n),
  });
});

NYX_META.roster = Object.keys(GAME_REGISTRY).flatMap(key => makeRoster(GAME_REGISTRY[key]));
NYX_META.codes = Object.keys(GAME_REGISTRY).flatMap(key => GAME_REGISTRY[key].codes.slice(0, 2)).slice(0, 8);

const buildTrack = (cfg) => Object.assign({ pull:'Wish', pulls:'Wishes', currency:'Primogems', cost:160, fives:[], fours:[] }, cfg.track || {}, { key:cfg.key });

/* ---------------- pinned favourites ---------------- */


function FavIconPinned({ ch, cfg, onOpen, href }){
  const inner = (
    <React.Fragment>
      <span>
        <img src={ch.icon || cfg.benchIcon} alt="" draggable="false" />
      </span>
      <b>{ch.name}</b>
    </React.Fragment>
  );
  return (
    <div className="gp-fav-icon gp-fav-icon--sim">
      {href
        ? <a className="gp-fav-icon-open" href={href} draggable={false} aria-label={ch.name}
             onClick={(event) => nyxNavClick(event, () => onOpen(ch))}>{inner}</a>
        : <button type="button" className="gp-fav-icon-open" onClick={() => onOpen(ch)} aria-label={ch.name}>{inner}</button>}
    </div>
  );
}

function loadCurrentPinnedCards(cfg, roster){
  if (cfg.key === 'nyx') {
    const byId = new Map(roster.map((ch) => [nyxPinnedCharacterId('nyx', ch), ch]));
    return nyxLoadPinnedUnion(Object.keys(GAME_REGISTRY))
      .map(({ gameKey, id }) => byId.get(gameKey + ':' + id))
      .filter(Boolean);
  }
  const byId = new Map(roster.map((ch) => [String(ch.id), ch]));
  return nyxLoadPinnedIds(cfg.key).map((id) => byId.get(String(id))).filter(Boolean);
}

function makeCurrentFavouriteRoster(cfg, settings, characterImagePrefs){
  if (cfg.key !== 'nyx') return makeRoster(cfg, settings, characterImagePrefs);
  return Object.keys(GAME_REGISTRY).flatMap((gameKey) => makeRoster(GAME_REGISTRY[gameKey], settings, characterImagePrefs));
}

/* Pinned Favourites are icons, always. The Card display mode, its 5-card limit,
   the "More favourites" overflow row and the Hide/Show toggle were all removed
   2026-08-09 at the user's request, for every game including the Nyx hub. */
function Favourites({ cfg, onOpenMaterial, settings }){
  const cmVersion = useCmGameVersion(cfg.key);
  const [characterImagePrefs] = useNyxCharacterImagePrefs();
  const specialKey = JSON.stringify(settings?.specialUnits || {});
  const customKey = JSON.stringify(characterImagePrefs || {});
  const roster = React.useMemo(() => makeCurrentFavouriteRoster(cfg, settings, characterImagePrefs), [cfg.key, cmVersion, specialKey, customKey]);
  const [cards, setCards] = React.useState(() => loadCurrentPinnedCards(cfg, roster));

  React.useEffect(() => {
    setCards(loadCurrentPinnedCards(cfg, roster));
  }, [cfg.key, roster]);

  React.useEffect(() => {
    const onPinned = (event) => {
      const changedGame = event.detail?.gameKey;
      if (changedGame === cfg.key || (cfg.key === 'nyx' && Object.prototype.hasOwnProperty.call(GAME_REGISTRY, changedGame))) {
        setCards(loadCurrentPinnedCards(cfg, roster));
      }
    };
    window.addEventListener(NYX_PINNED_CHANGED_EVENT, onPinned);
    return () => window.removeEventListener(NYX_PINNED_CHANGED_EVENT, onPinned);
  }, [cfg.key, roster]);

  const openCharacter = (ch) => {
    if (!onOpenMaterial || !ch?.name) return;
    const game = ch.gameKey && ch.gameKey !== 'nyx' ? ch.gameKey : cfg.key;
    if (game && game !== 'nyx') onOpenMaterial(game, ch.name, { from:cfg.key === 'nyx' ? 'nyx' : 'characters' });
  };
  // Same game resolution as openCharacter, so the link and the click agree.
  const characterHref = (ch) => (
    nyxCharacterHref(ch?.gameKey && ch.gameKey !== 'nyx' ? ch.gameKey : cfg.key, ch?.name)
  );

  return (
    <section className={'gp-favs game-' + cfg.key} aria-labelledby={'gp-favs-title-' + cfg.key}>
      <div className="gp-fav-heading">
        <h2 id={'gp-favs-title-' + cfg.key}>Pinned Favourites</h2>
        <span className="gp-fav-rule"></span>
      </div>
      {cards.length === 0
        ? <p className="gp-fav-empty">Favourite a character from the roster to pin them here.</p>
        : <div className="gp-fav-icon-grid">
            {cards.map((ch) => <FavIconPinned key={nyxPinnedCharacterId(cfg.key, ch)} ch={ch} cfg={cfg} onOpen={openCharacter} href={characterHref(ch)} />)}
          </div>}
    </section>
  );
}

/* ---------------- overview-aside redemption codes (table layout) ---------------- */
// Pull the premium-currency amount out of the reward string for the
// "[currency icon] + [amount]" column. Handles "100 Primogems" and "Astrite x100".
function codeCurrencyAmount(reward, currencyName){
  const text = String(reward || '');
  const name = String(currencyName || '').replace(/s$/, '').trim();
  if (!name) return null;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // amount can precede or follow the currency, with an optional x / × separator
  const m = text.match(new RegExp('([0-9][0-9,]*)\\s*[x\\u00D7]?\\s*' + esc + '|' + esc + '\\s*[x\\u00D7]?\\s*([0-9][0-9,]*)', 'i'));
  const amt = m ? (m[1] || m[2]) : null;
  return amt ? amt.replace(/[,\s]+$/, '') : null;
}

function CodeCardRow({ row, currency, onCopy, onToggleRedeemed }){
  const r = row;
  const safeCurrency = currency || PREMIUM_CODE_META.nyx;
  const amount = codeCurrencyAmount(r.reward, safeCurrency.name);
  const redeemed = r.st === 'redeemed';
  return (
    <div className={'gp-code-row st-' + r.st + (r.premium ? ' premium' : '')}>
      <label className="cc-check" title={redeemed ? 'Mark as not redeemed' : 'Mark as redeemed'}>
        <input type="checkbox" checked={redeemed} onChange={() => { if (onToggleRedeemed) onToggleRedeemed(r.code); }} />
        <span className="box"></span>
      </label>
      {/* The code sits in its own invisible column and shrinks a step at a time
          rather than truncating, so a long code still reads in full
          (user 2026-08-11). */}
      {r.redeemUrl
        ? <a className="cc" href={r.redeemUrl} target="_blank" rel="noopener noreferrer" title="Open the redeem page"><FitText as="span" className="cc-text" text={r.code} /></a>
        : <span className="cc no-link" title="No redeem link available"><FitText as="span" className="cc-text" text={r.code} /></span>}
      <span className={'cc-reward' + (r.premium ? '' : ' plain')} tabIndex={0} aria-label="Show all rewards">
        {r.premium && (safeCurrency.icon
          ? <img src={safeCurrency.icon} alt={safeCurrency.name} draggable="false" />
          : <span className="cur-glyph"></span>)}
        {r.premium && amount && <b>{amount}</b>}
        {!r.premium && <span className="reward-text">{NYX_CODE_GOODIES_LABEL}</span>}
        <span className="cc-reward-pop" role="tooltip"><RewardChips reward={r.reward} full /></span>
      </span>
      {/* The button and its "Copied" flash share one cell so the flash still has
          something to anchor to now that the row itself draws no box. */}
      <span className="cc-copy-cell">
        <button type="button" className="cc-copy"
                title="Copy" aria-label={'Copy ' + r.code} onClick={() => onCopy(r.code)}>
          <span className="i-copy"></span>
        </button>
        {r.st === 'copied' && <span className="cc-copied-pop" role="status">Copied</span>}
      </span>
    </div>
  );
}

function CodesPanel({ codes, gameKey = 'nyx' }){
  const sourceCodes = codes || [];
  const currency = premiumCodeMeta(gameKey, sourceCodes);
  const [copiedCode, setCopiedCode] = React.useState(null);
  const [redeemed, setRedeemed] = React.useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('nyx:redeemed-codes:v1') || '[]')); }
    catch (e) { return new Set(); }
  });
  const saveRedeemed = (next) => {
    setRedeemed(next);
    try { localStorage.setItem('nyx:redeemed-codes:v1', JSON.stringify([...next])); } catch (e) {}
  };
  const toggleRedeemed = (code) => {
    const next = new Set(redeemed);
    if (next.has(code)) next.delete(code); else next.add(code);
    saveRedeemed(next);
  };
  const onCopy = (code) => { copyText(code); setCopiedCode(code); };
  React.useEffect(() => {
    if (!copiedCode) return undefined;
    const t = setTimeout(() => setCopiedCode(null), 1400);
    return () => clearTimeout(t);
  }, [copiedCode]);

  const rows = sourceCodes.map((c, i) => ({
    ...c,
    _i:i,
    st:redeemed.has(c.code) ? 'redeemed' : copiedCode === c.code ? 'copied' : 'new',
  }));
  // redeemed codes sink to the bottom of their group (stable order otherwise)
  // Redeemed sinks; otherwise newest first (user 2026-08-09).
  const sortRedeemedLast = (a, b) => {
    const ra = a.st === 'redeemed' ? 1 : 0;
    const rb = b.st === 'redeemed' ? 1 : 0;
    if (ra !== rb) return ra - rb;
    const ka = codeSortKey(a);
    const kb = codeSortKey(b);
    if (ka !== kb) return ka > kb ? -1 : 1;
    return a._i - b._i;
  };
  const premiumRows = rows.filter(r => r.premium).sort(sortRedeemedLast);
  const plainRows = rows.filter(r => !r.premium).sort(sortRedeemedLast);

  const renderGroup = (kind, list) => (
    list.length === 0 ? null : (
      <div className="codes-group" key={kind}>
        <div className="codes-group-hd">
          {kind === 'premium' && (currency.icon
            ? <img src={currency.icon} alt="" draggable="false" />
            : <span className="cur-glyph"></span>)}
          <span className="gl">{kind === 'premium' ? currency.name : NYX_CODE_GOODIES_LABEL}</span>
          <span className="rule"></span>
        </div>
        <div className="gp-codes-table overview-codes">
          {list.map(r => (
            <CodeCardRow key={r.code} row={r} currency={currency} onCopy={onCopy} onToggleRedeemed={toggleRedeemed} />
          ))}
        </div>
      </div>
    )
  );

  return (
    <React.Fragment>
      <div className="overview-codes-scroll">
        {renderGroup('premium', premiumRows)}
        {renderGroup('other', plainRows)}
        {rows.length === 0 && <div className="code-empty">No redemption codes found.</div>}
      </div>
    </React.Fragment>
  );
}

/* shared overview right rail — server-time selection sits above the timers it
   drives (user decision 2026-07-15, #2). */
function OverviewAside({ cfg }){
  return (
    <aside className="gp-overview-aside">
      <div className="gp-aside-time">
        <TimePreferenceControl gameKey={cfg.key} />
      </div>
      <ResetTimersPanel gameKey={cfg.key} />
      <GPSec title="Redemption Codes" />
      <CodesPanel codes={cfg.codes} gameKey={cfg.key} />
    </aside>
  );
}

/* ================= Nyx hub (all-games) views ================= */
const SIM_GAMES = [
  { key:'gi',   name:'Genshin Impact',      icon:'../assets/icon/giicon.png',   bg:'../assets/bg/gibg2.png',  pos:'50% 14%' },
  { key:'hsr',  name:'Honkai: Star Rail',   icon:'../assets/icon/hsricon.png',  bg:'../assets/bg/hsrbg.png',  pos:'50% 10%' },
  { key:'zzz',  name:'Zenless Zone Zero',   icon:'../assets/icon/zzzicon.png',  bg:'../assets/bg/zzzbg3.png', pos:'55% 30%' },
  { key:'wuwa', name:'Wuthering Waves',     icon:'../assets/icon/wuwaicon.png', bg:'../assets/bg/wuwabg2.png',pos:'45% 22%' },
  { key:'ae',   name:'Arknights: Endfield', icon:'../assets/icon/aeicon.png',   bg:'../assets/bg/aebg.png',   pos:'50% 34%' },
];
const ALL_GAME_CODES = {
  gi:   GAME_REGISTRY.gi.codes,
  hsr:  GAME_REGISTRY.hsr.codes,
  zzz:  GAME_REGISTRY.zzz.codes,
  wuwa: GAME_REGISTRY.wuwa.codes,
  ae:   GAME_REGISTRY.ae.codes,
};
const CODES_UPDATED = formatUpdated(window.NYX_DB && window.NYX_DB.codes && window.NYX_DB.codes.updated);

function simInitials(name){
  const p = name.replace(/[^A-Za-z0-9 ].*/, '').trim().split(/\s+/);
  return ((p[0] && p[0][0] || 'N') + (p[1] ? p[1][0] : (p[0] && p[0][1] || ''))).toUpperCase();
}

function SimCodeCard({ code, reward, redeemUrl, isNew, gameKey, premium, premiumCurrency }){
  const [st, setSt] = React.useState(() => {
    try {
      const redeemed = new Set(JSON.parse(localStorage.getItem('nyx:redeemed-codes:v1') || '[]'));
      return redeemed.has(code) ? 'redeemed' : 'available';
    } catch (e) {
      return 'available';
    }
  });
  const onCopy = () => { copyText(code); setSt('copied'); };
  const markRedeemed = () => {
    try {
      const redeemed = new Set(JSON.parse(localStorage.getItem('nyx:redeemed-codes:v1') || '[]'));
      redeemed.add(code);
      localStorage.setItem('nyx:redeemed-codes:v1', JSON.stringify([...redeemed]));
    } catch (e) {}
    setSt('redeemed');
  };
  const undoRedeemed = () => {
    try {
      const redeemed = new Set(JSON.parse(localStorage.getItem('nyx:redeemed-codes:v1') || '[]'));
      redeemed.delete(code);
    localStorage.setItem('nyx:redeemed-codes:v1', JSON.stringify([...redeemed]));
    } catch (e) {}
    setSt('available');
  };
  // Trust the flag the data carries. This used to re-derive it from a hardcoded
  // currency list, which still said "Originium" and so filed every Endfield
  // Oroberyl code under Goodies (user 2026-08-09). The needle check only stands
  // in when a caller passes no flag at all.
  const meta = PREMIUM_CODE_META[gameKey] || PREMIUM_CODE_META.nyx;
  const needles = [premiumCurrency?.name, meta.name, ...(premiumCurrency?.aliases || [])]
    .filter(Boolean).map((value) => String(value).toLowerCase().replace(/s$/, ''));
  const derived = needles.some((needle) => String(reward || '').toLowerCase().includes(needle));
  const row = { code, reward, redeemUrl, st, premium:premium === undefined ? derived : !!premium, premiumCurrency };
  const currency = premiumCodeMeta(gameKey, [row]);
  return (
    <CodeCardRow
      row={row}
      currency={currency}
      onCopy={onCopy}
      onToggleRedeemed={() => (st === 'redeemed' ? undoRedeemed() : markRedeemed())}
    />
  );
}

// Newest first, premium currency ahead of everything else (user 2026-08-09).
// `added` is the day the code was first published; `firstSeen` is when our own
// scrape met it, and stands in when the source gave no date.
function codeSortKey(code){
  return String(code?.added || code?.firstSeen || '').slice(0, 10);
}

function sortCodesForDisplay(codes){
  return (Array.isArray(codes) ? codes : []).slice().sort((a, b) => {
    if (!!a.premium !== !!b.premium) return a.premium ? -1 : 1;
    const ka = codeSortKey(a);
    const kb = codeSortKey(b);
    if (ka !== kb) return ka > kb ? -1 : 1;
    return String(a.code || '').localeCompare(String(b.code || ''));
  });
}

/* Every code, always: the premium-currency filter and its "Premium currency"
   tag were removed 2026-08-09 at the user's request. */
function AllCodesView(){
  const groups = React.useMemo(() => (
    SIM_GAMES.map((game) => ({ game, codes:sortCodesForDisplay(ALL_GAME_CODES[game.key]) }))
  ), []);
  return (
    <div className="all-codes-view">
      <div className="all-codes-head">
        <GPSec title="Redemption Codes" className="nyx-u-fill" />
        <span className="sim-updated">Updated {CODES_UPDATED}</span>
      </div>
      <div className="gp-codes-scroll all-codes-list">
        {groups.map(({ game, codes }) => (
          <div key={game.key} className="sim-codegroup">
            <div className="sim-grouphd">
              <img src={game.icon} alt="" />
              <span className="gn">{game.name}</span>
              <span className="rule"></span>
            </div>
            <div className="sim-codegrid">
              {codes.map((c, i) => (
                <SimCodeCard key={c.code} code={c.code} reward={c.reward} redeemUrl={c.redeemUrl} isNew={i === 0}
                             gameKey={game.key} premium={c.premium} premiumCurrency={c.premiumCurrency} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* J: Monsters/Items ship as lazy per-game packs; loaded when the Database tab
   opens (same script-injection pattern as the beta packs). */
const NYX_DB_EXTRA_FILES = {
  gi:'../dist/db-data-gi.js',
  hsr:'../dist/db-data-hsr.js',
  zzz:'../dist/db-data-zzz.js',
  wuwa:'../dist/db-data-wuwa.js',
};
const NYX_DB_EXTRA_LOADS = {};
function loadNyxDbExtra(key){
  const src = NYX_DB_EXTRA_FILES[key];
  if (!src) return Promise.resolve(null);
  window.NYX_DB_EXTRA = window.NYX_DB_EXTRA || {};
  if (window.NYX_DB_EXTRA[key]) return Promise.resolve(window.NYX_DB_EXTRA[key]);
  if (NYX_DB_EXTRA_LOADS[key]) return NYX_DB_EXTRA_LOADS[key];
  NYX_DB_EXTRA_LOADS[key] = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    script.src = src;
    script.async = true;
    script.dataset.dbExtra = key;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      delete NYX_DB_EXTRA_LOADS[key];
      script.remove();
      reject(new Error('Failed to load ' + src));
    };
    script.onload = () => {
      if (!window.NYX_DB_EXTRA[key]) return fail();
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(window.NYX_DB_EXTRA[key]);
    };
    script.onerror = fail;
    const timer = setTimeout(fail, 20_000);
    document.head.appendChild(script);
  });
  return NYX_DB_EXTRA_LOADS[key];
}

const DB_FACET_KEYS = ['type', 'rarity', 'element', 'family', 'purpose', 'rank', 'twoPieceStat'];

function dbCollectionFacets(cur){
  if (!cur) return [];
  const out = [];
  for (const key of DB_FACET_KEYS){
    const values = new Map();
    for (const item of cur.items || []){
      const raw = item.fields && item.fields[key];
      if (raw === undefined || raw === null || raw === '') continue;
      if (typeof raw === 'object') continue;
      const value = nyxDatabaseFacetValue(key, raw);
      if (!value || /^\[object Object\]$/i.test(value)) continue;
      values.set(value, (values.get(value) || 0) + 1);
    }
    if (values.size >= 2 && values.size <= 24){
      out.push({ key, values:nyxDatabaseSortFacetValues(key, values.entries()).map(([value]) => value) });
    }
  }
  return out;
}

function DatabaseFilterPopover({ id, label = 'Database', open, setOpen, filters, facets, onToggle, onClear }){
  const buttonRef = React.useRef(null);
  const popRef = React.useRef(null);
  const activeCount = nyxDatabaseActiveFilterCount(filters);
  React.useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (popRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      requestAnimationFrame(() => buttonRef.current?.focus());
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, setOpen]);
  return (
    <div className="db-filter-control">
      <button type="button" ref={buttonRef} className={'db-filter-button' + (open ? ' on' : '')}
              aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        Filter{activeCount > 0 && <span>{activeCount}</span>}
      </button>
      {open && (
        <div id={id} ref={popRef} className="db-filter-popout" role="dialog" aria-label={label + ' filters'}>
          <div className="db-filter-pop-head">
            <b>Filters</b>
            <button type="button" onClick={onClear} disabled={activeCount === 0}>Clear all</button>
          </div>
          {(facets || []).map((facet) => (
            <div className="db-filter-group" key={facet.key} role="group" aria-label={'Filter by ' + facet.label}>
              <span>{facet.label}</span>
              <div>
                {(facet.values || []).map((entry) => {
                  const row = typeof entry === 'object' ? entry : { value:entry, label:entry };
                  const selected = filters?.[facet.key] === row.value;
                  return (
                    <button type="button" key={row.value} className={selected ? 'on' : ''} aria-pressed={selected}
                            onClick={() => onToggle(facet.key, row.value)}>
                      <span>{row.label ?? row.value}</span>{row.count !== undefined && <em>{row.count}</em>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionLibrary({ game, view, onViewChange }){
  const gameData = (window.NYX_DB && window.NYX_DB.games && window.NYX_DB.games[game]) || null;
  const inline = (gameData && gameData.collections) || [];
  const [extraTick, setExtraTick] = React.useState(0);
  const [extraState, setExtraState] = React.useState(NYX_DB_EXTRA_FILES[game] ? 'loading' : 'ready');
  const extra = (window.NYX_DB_EXTRA && window.NYX_DB_EXTRA[game] && window.NYX_DB_EXTRA[game].collections) || [];
  const collections = [...inline, ...extra];
  const specialViews = game === 'gi' ? [{ key:'shadow', title:'TPS: Shadow Realm' }, { key:'tcg', title:'TCG' }, { key:'pot', title:'Serenitea Pot' }, { key:'wonderland', title:'Miliastra Wonderland' }] : [];
  const [active, setActive] = React.useState(collections[0] ? collections[0].key : '');
  const [q, setQ] = React.useState('');
  const [filters, setFilters] = React.useState({});
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [showAllRarities, setShowAllRarities] = React.useState(false);
  const [detailItem, setDetailItem] = React.useState(null);
  const restoreFocusRef = React.useRef(null);
  const specialActive = view === 'shadow' || view === 'tcg' || view === 'pot' || view === 'wonderland';

  React.useEffect(() => {
    const gameInline = ((window.NYX_DB && window.NYX_DB.games && window.NYX_DB.games[game]) || {}).collections || [];
    setActive(gameInline[0] ? gameInline[0].key : '');
    setQ('');
    setFilters({});
    setFilterOpen(false);
    setDetailItem(null);
    let live = true;
    setExtraState(NYX_DB_EXTRA_FILES[game] ? 'loading' : 'ready');
    loadNyxDbExtra(game)
      .then(() => { if (live) { setExtraState('ready'); setExtraTick((v) => v + 1); } })
      .catch(() => { if (live) setExtraState('error'); });
    return () => { live = false; };
  }, [game]);

  const retryExtra = () => {
    setExtraState('loading');
    loadNyxDbExtra(game)
      .then(() => { setExtraState('ready'); setExtraTick((v) => v + 1); })
      .catch(() => setExtraState('error'));
  };

  const cur = collections.find(c => c.key === active) || collections[0];
  const facets = React.useMemo(() => dbCollectionFacets(cur), [game, cur && cur.key, extraTick]);
  const qq = q.trim().toLowerCase();
  const matches = cur ? cur.items.filter(item => {
    for (const [key, value] of Object.entries(filters)){
      if (value && nyxDatabaseFacetValue(key, (item.fields || {})[key]) !== value) return false;
    }
    if (!qq) return true;
    const hay = dbSearchText([item.name, item.kind, item.text, item.fields, item.skills]).toLowerCase();
    return hay.includes(qq);
  }) : [];
  // Every match renders; sections paint as they scroll into view. "Load more"
  // was removed 2026-08-09.
  React.useEffect(() => setShowAllRarities(false), [game, cur && cur.key]);
  const pickCollection = (key) => {
    if (specialActive && onViewChange) onViewChange('database');
    setActive(key);
    setFilters({});
    setFilterOpen(false);
    setDetailItem(null);
  };
  const toggleFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: prev[key] === value ? undefined : value }));
  const openDetail = (item) => {
    restoreFocusRef.current = document.activeElement;
    setFilterOpen(false);
    setDetailItem(item);
  };
  const closeDetail = React.useCallback(() => {
    const restore = restoreFocusRef.current;
    restoreFocusRef.current = null;
    ReactDOM.flushSync(() => setDetailItem(null));
    if (restore && restore.isConnected !== false && typeof restore.focus === 'function') {
      requestAnimationFrame(() => restore.focus({ preventScroll:true }));
    }
  }, []);

  if (!cur && !specialViews.length) {
    return (
      <div className="db-lib">
        <div className="db-empty">No database collections found.</div>
      </div>
    );
  }

  return (
    <div className="db-lib">
      <div className="db-tabs">
        {collections.map(c => (
          <button type="button" key={c.key} className={!specialActive && cur && c.key === cur.key ? 'on' : ''} onClick={() => pickCollection(c.key)}>
            <span>{c.title}</span>
          </button>
        ))}
        {specialViews.map(s => (
          <a key={s.key} className={view === s.key ? 'on' : ''} href={routePathFor(game, s.key, null)} draggable={false}
             aria-current={view === s.key ? 'page' : undefined}
             onClick={(event) => nyxNavClick(event, () => onViewChange && onViewChange(s.key))}>
            <span>{s.title}</span>
          </a>
        ))}
      </div>
      {!specialActive && (
        <div className="db-search-tools">
          <div className="gp-search">
            <span className="ic"></span>
            <input value={q} placeholder="Search Database" spellCheck="false" onChange={(e) => setQ(e.target.value)} />
            {q !== '' && <button type="button" className="x" title="Clear" onClick={() => setQ('')}>{'\u2715'}</button>}
          </div>
          {nyxDatabaseHasFacets(facets) && <DatabaseFilterPopover id="database-collection-filter-popout" label="Database" open={filterOpen} setOpen={setFilterOpen}
            filters={filters} onClear={() => setFilters({})} onToggle={toggleFilter}
            facets={facets.map((facet) => ({ key:facet.key, label:nyxDatabaseFacetLabel(facet.key), values:facet.values }))} />}
        </div>
      )}
      {!specialActive && extraState === 'loading' && (
        <div className="db-load-state" role="status" aria-live="polite">
          <span className="db-load-spinner" aria-hidden="true"></span>
          Loading Monsters and Items…
        </div>
      )}
      {!specialActive && extraState === 'error' && (
        <div className="db-load-state error" role="alert">
          <span>Monsters and Items could not be loaded.</span>
          <button type="button" onClick={retryExtra}>Retry</button>
        </div>
      )}
      {specialActive
        ? (view === 'shadow' ? <GenshinShadowRealmView /> : (view === 'tcg' ? <GenshinTcgView /> : (view === 'pot' ? <GenshinPotView /> : <GenshinWonderlandView />)))
        : (
          <React.Fragment>
            <DatabaseGroupedList
              items={matches}
              showAllRarities={showAllRarities}
              onShowAllRarities={setShowAllRarities}
              renderItem={(item) => <CollectionCard key={item.id || item.name} item={item} onOpen={openDetail} />}
            />
            {matches.length === 0 && <div className="db-empty">No records match your search.</div>}
            {detailItem && <CollectionDetailModal item={detailItem} onClose={closeDetail} />}
          </React.Fragment>
        )}
    </div>
  );
}

/* One section of a grouped Database list. Everything is present — nothing is
   paginated away (user 2026-08-09) — but a section only paints its cards once
   it is near the viewport, so a 9,700-row collection opens instantly instead of
   building ten thousand cards up front. The placeholder reserves the section's
   real height so the scrollbar never jumps. */
const DB_SECTION_CHUNK = 150;

function DatabaseGroupSection({ group, showHeading, renderItem, rowHeight = 132, columns = 6 }){
  const headRef = React.useRef(null);
  const tailRef = React.useRef(null);
  const total = group.items.length;
  const collapsible = nyxDatabaseGroupCollapsed(group.label);
  const [open, setOpen] = React.useState(!collapsible);
  // A section starts empty and grows a chunk at a time as it scrolls into view.
  // Painting a whole section at once is fine for 250 weapons and fatal for the
  // 9,700-row Items list, which locked the tab up for tens of seconds.
  const [shown, setShown] = React.useState(() => (collapsible ? 0 : (total <= DB_SECTION_CHUNK ? total : 0)));
  React.useEffect(() => { setShown(total <= DB_SECTION_CHUNK ? total : 0); }, [group.key, total]);
  React.useEffect(() => {
    if (!open) return undefined;
    if (shown >= total) return undefined;
    if (typeof IntersectionObserver !== 'function') { setShown(total); return undefined; }
    const targets = [headRef.current, tailRef.current].filter(Boolean);
    if (!targets.length) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShown((count) => Math.min(total, Math.max(count, 0) + DB_SECTION_CHUNK));
      }
    }, { rootMargin:'800px 0px' });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [open, shown, total, group.key]);
  // Reserve the height of what has not been painted yet so the scrollbar keeps
  // a stable length instead of lurching as sections fill in.
  const reserved = Math.ceil(Math.max(0, total - shown) / columns) * rowHeight;
  return (
    <section className={'db-group' + (group.unreleased ? ' is-unreleased' : '') + (collapsible ? ' is-collapsible' : '')}>
      {showHeading && (
        <div className="db-group-head" ref={headRef}>
          {collapsible && <button type="button" className="db-group-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? '−' : '+'}</button>}
          <span className="t">{group.label}</span>
          <span className="n">{total}</span>
        </div>
      )}
      {open && shown > 0 && <div className="db-grid">{group.items.slice(0, shown).map(renderItem)}</div>}
      {open && shown < total && (
        <div className="db-grid-placeholder" ref={tailRef} style={{ height:reserved + 'px' }} aria-hidden="true"></div>
      )}
      {!showHeading && shown === 0 && <div ref={headRef} aria-hidden="true"></div>}
    </section>
  );
}

/* Shared renderer for every Database list: sections by category, highest rarity
   first, newest first inside a rarity, with only 1-2-star rows behind a toggle. */
function DatabaseGroupedList({ items, renderItem, showAllRarities, onShowAllRarities, groupKey }){
  const visible = React.useMemo(
    () => nyxDatabaseApplyRarityFloor(items, showAllRarities),
    [items, showAllRarities]
  );
  const { groups } = React.useMemo(
    () => nyxDatabaseGroupItems(visible, groupKey === undefined ? undefined : { groupKey }),
    [visible, groupKey]
  );
  const offersToggle = React.useMemo(() => nyxDatabaseHasLowRarity(items), [items]);
  const showHeading = groups.length > 1 || (groups[0] && groups[0].key !== 'All');
  // One scroller around every section, so the page scrolls as a single list
  // rather than each section scrolling inside itself.
  return (
    <div className="db-scroll">
      {groups.map((group) => (
        <DatabaseGroupSection key={group.key} group={group} showHeading={showHeading} renderItem={renderItem} />
      ))}
      {offersToggle && (
        <button type="button" className="db-rarity-toggle" aria-pressed={!!showAllRarities}
                onClick={() => onShowAllRarities(!showAllRarities)}>
          {showAllRarities ? 'Hide 1–2★' : 'Show 1–2★'}
        </button>
      )}
    </div>
  );
}

function dbHasValue(value){
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.some(dbHasValue);
  if (typeof value === 'object') return Object.values(value).some(dbHasValue);
  return true;
}

function dbSearchText(value){
  if (!dbHasValue(value)) return '';
  if (Array.isArray(value)) return value.map(dbSearchText).join(' ');
  if (typeof value === 'object') return Object.entries(value).map(([key, row]) => key + ' ' + dbSearchText(row)).join(' ');
  return String(value);
}

function dbFieldLabel(value){
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dbFieldValue(value){
  if (Array.isArray(value)) return value.map(dbFieldValue).filter(Boolean).join(' / ');
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, row]) => dbHasValue(row))
      .map(([key, row]) => dbFieldLabel(key) + ': ' + dbFieldValue(row))
      .join(' / ');
  }
  return String(value);
}

function dbListFocusKey(scope, value){
  return scope + ':' + String(value ?? '');
}

function dbRestoreListSnapshot(snapshot, gridRef){
  if (!snapshot) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const grid = gridRef.current;
    if (grid) grid.scrollTop = Math.max(0, Number(snapshot.scrollTop) || 0);
    const target = Array.from(document.querySelectorAll('[data-db-focus-key]'))
      .find((node) => node.dataset.dbFocusKey === snapshot.focusKey);
    if (target && typeof target.focus === 'function') target.focus({ preventScroll:true });
  }));
}

/* Database art uses the same filled rarity treatment as material items. Tier 0
   is deliberately the white Unknown frame; it never falls back to purple. */
function DatabaseItemFrame({ art, fallback, rarity, portrait = false, className = '', children }){
  const tier = nyxDatabaseRarityTier(rarity);
  if (!portrait) {
    return (
      <CMItemFrame icon={art} glyph={fallback || '?'} rarity={tier} bandless
        className={'db-item-frame' + (className ? ' ' + className : '')} dataRarityTier={tier}>
        {children}
      </CMItemFrame>
    );
  }
  const style = { ...(CM_ITEM_FRAME_STYLES[tier] || CM_ITEM_FRAME_STYLES[0]) };
  return (
    <span className={'db-item-frame-portrait' + (className ? ' ' + className : '')}
          style={style} data-rarity-tier={tier} aria-hidden="true">
      <span className="db-item-frame-portrait-fill"><span className="db-item-frame-portrait-glow"></span></span>
      <span className="db-item-frame-portrait-media">
        {art ? <img src={art} alt="" draggable="false" /> : <span>{fallback || '?'}</span>}
      </span>
      <svg className="db-item-frame-portrait-rim" viewBox="0 0 208 320" preserveAspectRatio="none" aria-hidden="true">
        <rect x="1" y="1" width="206" height="318" rx="13" fill="none" stroke="var(--cmf-line)" strokeWidth="2"></rect>
        <rect x="4" y="4" width="200" height="312" rx="10" fill="none" stroke="var(--cmf-line)" strokeWidth="0.75" strokeOpacity="0.55"></rect>
      </svg>
    </span>
  );
}

function CollectionCard({ item, onOpen }){
  return (
    <button type="button" className="db-card" title={'View ' + item.name} aria-label={'View details for ' + item.name} onClick={() => onOpen(item)}>
      <DatabaseItemFrame className="db-art" art={item.art} fallback={simInitials(item.name)} rarity={item.fields?.rarity} />
      <span className="db-name">{item.name}</span>
    </button>
  );
}

function CollectionDetailModal({ item, onClose }){
  const closeRef = React.useRef(null);
  const cardRef = React.useRef(null);
  const kind = String(item.kind || '').toLowerCase();
  const isWeapon = kind === 'weapon' || kind === 'weapons';
  const hideKind = kind === 'artifact' || isWeapon || kind === 'monster' || kind === 'item';
  const fields = Object.entries(item.fields || {}).filter(([key, value]) => dbHasValue(value)
    && !((kind === 'artifact' || kind === 'item') && (key === 'rarity' || key === 'type'))
    && !(kind === 'monster' && key === 'type'));
  const skills = Array.isArray(item.skills) ? item.skills.filter((skill) => dbHasValue(skill)) : [];

  React.useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'Tab') {
        const focusable = Array.from(cardRef.current?.querySelectorAll('button:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])') || []);
        if (!focusable.length) {
          event.preventDefault();
          cardRef.current?.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !cardRef.current?.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !cardRef.current?.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const modal = (
    <div className="db-modal" role="dialog" aria-modal="true" aria-label={item.name + ' details'}
         onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <article ref={cardRef} tabIndex={-1} className="db-modal-card">
        <button type="button" ref={closeRef} className="db-modal-close" aria-label={'Close ' + item.name + ' details'} onClick={onClose}>{'\u2715'}</button>
        <DatabaseItemFrame className="db-modal-media" art={item.art} fallback={simInitials(item.name)} rarity={item.fields?.rarity} />
        <div className="db-modal-copy">
          {!hideKind && <span className="db-modal-kind">{dbFieldLabel(item.kind || 'Database record')}</span>}
          <h2>{item.name}</h2>
          {item.text && <p className="db-modal-description">{item.text}</p>}
          {fields.length > 0 && (
            <dl className={'db-modal-fields' + (isWeapon ? ' is-weapon' : '')}>
              {fields.map(([key, value]) => (
                <div key={key}><dt>{dbFieldLabel(key)}</dt><dd>{dbFieldValue(value)}</dd></div>
              ))}
            </dl>
          )}
          {skills.length > 0 && (
            <section className="db-modal-skills" aria-label={item.kind === 'bangboo' ? 'Bangboo skills' : 'Skills'}>
              <h3>{item.kind === 'bangboo' ? 'Bangboo Skills' : 'Skills'}</h3>
              {skills.map((skill, index) => (
                <article key={skill.key || skill.name || index}>
                  {skill.type && <span>{skill.type}</span>}
                  <h4>{skill.name || 'Skill ' + (index + 1)}</h4>
                  {skill.description && <p>{skill.description}</p>}
                  {Array.isArray(skill.properties) && skill.properties.length > 0 && (
                    <div>{skill.properties.map((property) => <em key={property}>{property}</em>)}</div>
                  )}
                </article>
              ))}
            </section>
          )}
        </div>
      </article>
    </div>
  );
  return ReactDOM.createPortal ? ReactDOM.createPortal(modal, document.body) : modal;
}

function GenshinShadowRealmView(){
  const items = dbGame('gi')?.shadowRealm?.items || [];
  const [q, setQ] = React.useState('');
  const [detail, setDetail] = React.useState(null);
  const query = q.trim().toLowerCase();
  const visible = items.filter((item) => !query || dbSearchText([item.name, item.text, item.fields]).toLowerCase().includes(query));
  return (
    <div className="db-special-view">
      <div className="db-search-tools">
        <div className="gp-search">
          <span className="ic"></span>
          <input value={q} placeholder="Search Shadow Realm" spellCheck="false" onChange={(event) => setQ(event.target.value)} />
          {q !== '' && <button type="button" className="x" title="Clear" onClick={() => setQ('')}>{'\u2715'}</button>}
        </div>
      </div>
      <DatabaseGroupedList items={visible} showAllRarities groupKey="type"
        renderItem={(item) => <CollectionCard key={item.id} item={item} onOpen={setDetail} />} />
      {visible.length === 0 && <div className="db-empty">No Shadow Realm items match your search.</div>}
      {detail && <CollectionDetailModal item={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

const GALLERY_TABS = [
  ['namecards', 'Namecards'],
  ['portraits', 'Portraits'],
  ['splashArts', 'Splash Art'],
  ['avatarFrames', 'Avatar Frames'],
];

/* ---------- Gallery lightbox: full-size art with download / copy ----------
   Gallery art is served from assets.pengo.gg while the page CSP is
   `connect-src 'self'`, so the browser can show an image but not read its
   bytes. Download and Copy both need the bytes, so a cross-origin asset is
   routed through /api/asset/<key> (worker/worker.js) to stay same-origin.
   Locally the art is a relative ../../Database path and needs no proxy. */
function galleryAbsoluteUrl(src){
  if (!src) return '';
  try { return new URL(src, window.location.href).href; } catch (error) { return ''; }
}

function galleryFetchUrl(src){
  const absolute = galleryAbsoluteUrl(src);
  if (!absolute) return '';
  let parsed;
  try { parsed = new URL(absolute); } catch (error) { return ''; }
  if (parsed.origin === window.location.origin) return absolute;
  // Content-addressed objects (objects/sha256/aa/<hash>.<ext>) are the only
  // shape the proxy accepts; anything else has no byte-level actions.
  if (parsed.hostname !== 'assets.pengo.gg') return '';
  const key = parsed.pathname.replace(/^\//, '');
  if (!/^objects\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}\.(?:png|jpe?g|webp|gif|avif)$/.test(key)) return '';
  return `/api/asset/${key}`;
}

function galleryFilename(name, src){
  const extension = (galleryAbsoluteUrl(src).match(/\.([a-z0-9]+)(?:[?#]|$)/i) || [, 'webp'])[1].toLowerCase();
  const base = String(name || 'artwork').replace(/[^\w\d]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'artwork';
  return `${base}.${extension}`;
}

// Chrome only accepts image/png on the clipboard, and the art is WebP.
function galleryBlobToPng(blob){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      canvas.toBlob((png) => {
        URL.revokeObjectURL(url);
        png ? resolve(png) : reject(new Error('Could not convert this image.'));
      }, 'image/png');
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image.')); };
    image.src = url;
  });
}

function GalleryLightbox({ item, label, onClose }){
  const closeRef = React.useRef(null);
  const cardRef = React.useRef(null);
  const [status, setStatus] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const shareUrl = galleryAbsoluteUrl(item.art);
  const fetchUrl = galleryFetchUrl(item.art);

  React.useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(cardRef.current?.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || []);
      if (!focusable.length) { event.preventDefault(); cardRef.current?.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !cardRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !cardRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const loadBlob = async () => {
    const response = await fetch(fetchUrl, { credentials:'same-origin' });
    if (!response.ok) throw new Error(`Image returned ${response.status}`);
    return response.blob();
  };

  const run = async (kind, work, done) => {
    setBusy(kind);
    setStatus('');
    try {
      await work();
      setStatus(done);
    } catch (error) {
      setStatus(error?.message || 'That did not work.');
    } finally {
      setBusy('');
    }
  };

  const download = () => run('download', async () => {
    const blob = await loadBlob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = galleryFilename(item.name, item.art);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }, 'Saved');

  const copyImage = () => run('copy', async () => {
    if (!navigator.clipboard || typeof window.ClipboardItem !== 'function') throw new Error('This browser cannot copy images.');
    const png = await galleryBlobToPng(await loadBlob());
    await navigator.clipboard.write([new window.ClipboardItem({ 'image/png':png })]);
  }, 'Copied image');

  const copyLink = () => run('link', async () => {
    await navigator.clipboard.writeText(shareUrl);
  }, 'Copied link');

  const modal = (
    <div className="db-modal gallery-lightbox" role="dialog" aria-modal="true" aria-label={item.name + ' artwork'}
         onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <article ref={cardRef} tabIndex={-1} className="db-modal-card gallery-lightbox-card">
        <button type="button" ref={closeRef} className="db-modal-close" aria-label={'Close ' + item.name} onClick={onClose}>{'✕'}</button>
        <div className="gallery-lightbox-art">
          {item.art
            ? <img src={item.art} alt={item.name} draggable="false" />
            : <span>{simInitials(item.name)}</span>}
        </div>
        <div className="gallery-lightbox-copy">
          <span className="db-modal-kind">{label}</span>
          <h2>{item.name}</h2>
          {item.description && <p className="db-modal-description">{item.description}</p>}
        </div>
        <div className="gallery-lightbox-actions">
          <button type="button" disabled={!fetchUrl || !!busy} onClick={download}>
            {busy === 'download' ? 'Saving…' : 'Download'}
          </button>
          <button type="button" disabled={!fetchUrl || !!busy} onClick={copyImage}>
            {busy === 'copy' ? 'Copying…' : 'Copy'}
          </button>
          <button type="button" disabled={!shareUrl || !!busy} onClick={copyLink}>
            {busy === 'link' ? 'Copying…' : 'Copy link'}
          </button>
          <span className="gallery-lightbox-status" role="status" aria-live="polite">{status}</span>
        </div>
      </article>
    </div>
  );
  return ReactDOM.createPortal(modal, document.body);
}

function GenshinGalleryView(){
  const gallery = dbGame('gi')?.gallery || {};
  const [tab, setTab] = React.useState('namecards');
  const [q, setQ] = React.useState('');
  const [detail, setDetail] = React.useState(null);
  const query = q.trim().toLowerCase();
  const items = (gallery[tab] || [])
    .filter((item) => !query || dbSearchText([item.name, item.description]).toLowerCase().includes(query))
    .slice()
    .sort((left, right) => Number(right.sortId || right.id) - Number(left.sortId || left.id) || String(left.name).localeCompare(String(right.name)));
  return (
    <div className="gallery-view">
      <div className="gallery-toolbar">
        <div className="db-tabs" role="tablist" aria-label="Gallery">
          {GALLERY_TABS.map(([key, label]) => (
            <button type="button" role="tab" key={key} className={tab === key ? 'on' : ''}
                    aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
        <div className="gp-search">
          <span className="ic"></span>
          <input value={q} placeholder={'Search ' + GALLERY_TABS.find(([key]) => key === tab)[1]} spellCheck="false" onChange={(event) => setQ(event.target.value)} />
          {q !== '' && <button type="button" className="x" title="Clear" onClick={() => setQ('')}>{'\u2715'}</button>}
        </div>
      </div>
      <div className={'gallery-grid is-' + tab}>
        {items.map((item) => (
          <figure className="gallery-card" key={item.id}>
            <button type="button" className="gallery-art is-open" title={'Open ' + item.name}
                    onClick={() => setDetail(item)}>
              {item.art ? <img src={item.art} alt="" loading="lazy" draggable="false" /> : <span>{simInitials(item.name)}</span>}
            </button>
            <figcaption><b>{item.name}</b></figcaption>
          </figure>
        ))}
      </div>
      {items.length === 0 && <div className="db-empty">No gallery entries match your search.</div>}
      {detail && (
        <GalleryLightbox item={detail} label={GALLERY_TABS.find(([key]) => key === tab)[1]}
                         onClose={() => setDetail(null)} />
      )}
    </div>
  );
}

function wonderValues(items, key){
  const counts = new Map();
  for (const item of items){
    const values = Array.isArray(item[key]) ? item[key] : (item[key] ? [item[key]] : []);
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function GenshinWonderlandView(){
  const wonderland = dbGame('gi')?.wonderland || {};
  const sections = [
    { key:'costumes', label:'Costumes', items:wonderland.costumes || [] },
    { key:'suits', label:'Sets', items:wonderland.suits || [] },
    { key:'items', label:'Inventory', items:wonderland.items || [] },
  ];
  const [section, setSection] = React.useState('costumes');
  const [q, setQ] = React.useState('');
  const [filters, setFilters] = React.useState({});
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [detail, setDetail] = React.useState(null);
  const backRef = React.useRef(null);
  const gridRef = React.useRef(null);
  const listSnapshotRef = React.useRef(null);
  const active = sections.find((row) => row.key === section) || sections[0];
  const facetKeys = section === 'costumes' ? ['slot','color','body','rank']
    : section === 'suits' ? ['color','body','rank'] : ['type','rank'];
  const facets = facetKeys.map((key) => ({ key, values:wonderValues(active.items, key) })).filter((row) => row.values.length > 1);
  const query = q.trim().toLowerCase();
  const visible = active.items.filter((item) => {
    for (const [key, selected] of Object.entries(filters)){
      if (!selected) continue;
      const values = Array.isArray(item[key]) ? item[key] : [item[key]];
      if (!values.includes(selected)) return false;
    }
    if (!query) return true;
    return dbSearchText([item.name, item.kind, item.rank, item.type, item.body, item.color, item.slot]).toLowerCase().includes(query);
  });
  // Everything renders — "Load more" was removed 2026-08-09 — in the shared
  // Database order: highest rank first, newest first inside a rank.
  const ordered = React.useMemo(() => visible.slice().sort(nyxDatabaseCompareItems), [visible]);
  const selectSection = (key) => {
    setSection(key);
    setFilters({});
    setFilterOpen(false);
    setDetail(null);
  };
  const toggle = (key, value) => setFilters((previous) => ({ ...previous, [key]:previous[key] === value ? undefined : value }));
  const openDetail = (item) => {
    listSnapshotRef.current = { focusKey:dbListFocusKey('wonder', item.id), scrollTop:gridRef.current ? gridRef.current.scrollTop : 0 };
    setFilterOpen(false);
    setDetail(item);
  };
  const closeDetail = React.useCallback(() => {
    const snapshot = listSnapshotRef.current;
    ReactDOM.flushSync(() => setDetail(null));
    dbRestoreListSnapshot(snapshot, gridRef);
  }, []);
  React.useEffect(() => {
    if (detail) backRef.current?.focus();
  }, [detail]);
  React.useEffect(() => {
    if (!detail) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeDetail();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detail, closeDetail]);

  if (!sections.some((row) => row.items.length)) {
    return <div className="wonder-view"><div className="db-empty">Wonderland data has not been generated yet.</div></div>;
  }
  if (detail) {
    const stats = [
      ['ID', detail.id],
      ['Type', detail.kind],
      ['Rank', detail.rank],
      ['Slot', (detail.slot || []).join(' / ')],
      ['Color', (detail.color || []).join(' / ')],
      ['Body Type', (detail.body || []).join(' / ')],
      ['Item Type', detail.type],
    ].filter(([, value]) => dbHasValue(value));
    return (
      <div className="wonder-view wonder-detail-page" data-screen-label="Miliastra Wonderland detail page">
        <button type="button" ref={backRef} className="wonder-back" onClick={closeDetail}><span>{'\u2039'}</span><b>Back to {active.label}</b></button>
        <div className="wonder-detail-scroll">
          <article className="wonder-detail-panel">
            <DatabaseItemFrame className="wonder-detail-art" art={detail.art} fallback={simInitials(detail.name)} rarity={detail.rank} />
            <div className="wonder-detail-copy">
              <span>{detail.kind}</span>
              <h2>{detail.name}</h2>
              <dl>
                {stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
            </div>
          </article>
        </div>
      </div>
    );
  }
  return (
    <div className="wonder-view">
      <div className="wonder-head">
        <div className="db-search-tools">
          <div className="gp-search">
            <span className="ic"></span>
            <input aria-label="Search Miliastra Wonderland" value={q} placeholder={'Search ' + active.label} spellCheck="false" onChange={(event) => setQ(event.target.value)} />
            {q !== '' && <button type="button" className="x" title="Clear search" onClick={() => setQ('')}>{'\u2715'}</button>}
          </div>
          <DatabaseFilterPopover id="wonderland-filter-popout" label="Wonderland" open={filterOpen} setOpen={setFilterOpen}
            filters={filters} onClear={() => setFilters({})} onToggle={toggle}
            facets={facets.map((facet) => ({
              key:facet.key,
              label:facet.key === 'body' ? 'Body Type' : dbFieldLabel(facet.key),
              values:facet.values.map(([value, count]) => ({ value, label:value, count })),
            }))} />
        </div>
      </div>
      <div className="wonder-tabs" role="tablist" aria-label="Wonderland collections">
        {sections.map((row) => (
          <button type="button" role="tab" key={row.key} aria-selected={section === row.key} className={section === row.key ? 'on' : ''} onClick={() => selectSection(row.key)}>
            <span>{row.label}</span>
          </button>
        ))}
      </div>
      <div className="wonder-grid" ref={gridRef} aria-live="polite">
        {ordered.map((item) => (
          <button type="button" className="wonder-card" key={item.id} data-db-focus-key={dbListFocusKey('wonder', item.id)} aria-label={'View details for ' + item.name} onClick={() => openDetail(item)}>
            <DatabaseItemFrame className="wonder-art" art={item.art} fallback={simInitials(item.name)} rarity={item.rank} />
            <b>{item.name}</b>
          </button>
        ))}
      </div>
      {visible.length === 0 && <div className="db-empty">No Wonderland records match your search.</div>}
    </div>
  );
}

const TCG_COST_LABELS = {
  GCG_COST_DICE_CRYO:'Cryo',
  GCG_COST_DICE_HYDRO:'Hydro',
  GCG_COST_DICE_PYRO:'Pyro',
  GCG_COST_DICE_ELECTRO:'Electro',
  GCG_COST_DICE_ANEMO:'Anemo',
  GCG_COST_DICE_GEO:'Geo',
  GCG_COST_DICE_DENDRO:'Dendro',
  GCG_COST_DICE_VOID:'Unaligned',
  GCG_COST_DICE_SAME:'Matching Element',
  GCG_COST_DICE_LEGEND:'Arcane Legend',
  GCG_COST_ENERGY:'Energy',
  GCG_COST_LEGEND:'Arcane Legend',
  GCG_COST_SKIRK_SPECIAL_ENERGY:"Serpent's Subtlety",
};

const TCG_ELEMENT_LABELS = {
  GCG_ELEMENT_VOID:'Physical DMG',
  GCG_ELEMENT_CRYO:'Cryo DMG',
  GCG_ELEMENT_HYDRO:'Hydro DMG',
  GCG_ELEMENT_PYRO:'Pyro DMG',
  GCG_ELEMENT_ELECTRO:'Electro DMG',
  GCG_ELEMENT_ANEMO:'Anemo DMG',
  GCG_ELEMENT_GEO:'Geo DMG',
  GCG_ELEMENT_DENDRO:'Dendro DMG',
};

const TCG_SKILL_TAG_LABELS = {
  GCG_SKILL_TAG_A:'Normal Attack',
  GCG_SKILL_TAG_E:'Elemental Skill',
  GCG_SKILL_TAG_Q:'Elemental Burst',
  GCG_SKILL_TAG_PASSIVE:'Passive',
};

function tcgCleanText(value){
  return String(value ?? '')
    .replace(/\\n/g, '\n')
    .replace(/<color=[^>]+>/gi, '')
    .replace(/<\/color>/gi, '')
    .replace(/\{SPRITE_PRESET#\d+\}/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tcgCleanInline(value){
  return tcgCleanText(value).replace(/\s+/g, ' ').trim();
}

function tcgCostTypeLabel(value){
  const key = String(value || '').toUpperCase();
  return TCG_COST_LABELS[key] || key.replace(/^GCG_COST_/, '').replace(/^DICE_/, '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function tcgFormatCost(cost){
  if (cost === undefined || cost === null || cost === '') return '';
  if (Number.isFinite(Number(cost))) return String(Number(cost));
  if (Array.isArray(cost)) {
    return cost
      .filter((row) => row && row.cost_type !== 'GCG_COST_INVALID')
      .map((row) => `${Number(row.count) || 0} ${tcgCostTypeLabel(row.cost_type)}`)
      .join(' / ');
  }
  if (typeof cost === 'object') {
    return Object.entries(cost)
      .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0)
      .map(([key, value]) => `${Number(value)} ${tcgCostTypeLabel(key)}`)
      .join(' / ');
  }
  return String(cost);
}

function tcgReferenceLabel(raw, child, resolver){
  const key = String(raw || '');
  const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (normalized === 'd__key__damage') return child?.d_key_damage ?? key;
  if (normalized === 'd__key__element') return TCG_ELEMENT_LABELS[child?.d_key_element] || child?.d_key_element || key;
  const value = child?.[normalized];
  if (value && typeof value === 'object') return tcgCleanInline(value.name || value.desc || key);
  if (typeof value === 'string') return resolver?.[value] || resolver?.[key] || resolver?.[value.replace(/^[ACKS]/, '')] || value;
  return resolver?.[key] || resolver?.[key.replace(/^[ACKS]/, '')] || key;
}

function tcgRenderText(value, child, resolver){
  return tcgCleanText(value)
    .replace(/\$\[([^\]]+)\]/g, (_, key) => tcgReferenceLabel(key, child || {}, resolver || {}))
    .replace(/\s+\./g, '.')
    .replace(/\s+,/g, ',');
}

function tcgReferenceRows(child, resolver){
  if (!child || typeof child !== 'object') return [];
  return Object.entries(child)
    .filter(([, value]) => value && typeof value === 'object' && (value.name || value.desc))
    .map(([key, value]) => ({
      key,
      name:tcgRenderText(value.name || key, value.child, resolver),
      desc:tcgRenderText(value.desc || '', value.child, resolver),
    }))
    .filter((row) => row.name || row.desc);
}

function tcgTalentRows(card){
  const talent = card?.talent;
  if (!talent) return [];
  if (Array.isArray(talent)) return talent;
  if (card.type === 'Character' && typeof talent === 'object') {
    return Object.entries(talent).map(([id, row]) => ({ id, ...row }));
  }
  if (typeof talent === 'object') return [{ id:card.id, ...talent }];
  return [];
}

function tcgStatRows(card){
  if (!card) return [];
  const rows = [];
  rows.push(['ID', String(card.id || '')]);
  rows.push(['Type', card.type || (card.kind === 'character' ? 'Character' : 'Action')]);
  const costText = tcgFormatCost(card.cost);
  if (costText) rows.push([card.type === 'Character' ? 'Energy' : 'Cost', costText]);
  if (Number.isFinite(Number(card.hp))) rows.push(['HP', String(card.hp)]);
  if (card.playableCharacter) rows.push(['Character', card.playableCharacter]);
  if (Array.isArray(card.tags) && card.tags.length) rows.push(['Tags', card.tags.join(' / ')]);
  if (card.relatedCardId) rows.push(['Related', card.relatedCardId]);
  return rows;
}

function GenshinTcgView(){
  const gameData = dbGame('gi') || {};
  const tcg = gameData.tcg || {};
  const [kind, setKind] = React.useState('all');
  const [tag, setTag] = React.useState('all');
  const [q, setQ] = React.useState('');
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [activeCard, setActiveCard] = React.useState(null);
  const gridRef = React.useRef(null);
  const listSnapshotRef = React.useRef(null);
  const backRef = React.useRef(null);
  const cards = [
    ...((tcg.characterCards || []).map((card) => ({ ...card, kind:'character' }))),
    ...((tcg.otherCards || []).map((card) => ({ ...card, kind:'action' }))),
  ];
  const resolver = React.useMemo(() => {
    const out = {};
    cards.forEach((card) => {
      if (card.type === 'Character') {
        out[String(card.id)] = card.name;
        out['A' + card.id] = card.name;
      }
      tcgTalentRows(card).forEach((row) => {
        if (!row.id || !row.name) return;
        out[String(row.id)] = row.name;
        out['S' + row.id] = row.name;
      });
    });
    return out;
  }, [cards.length]);
  const tagFilters = React.useMemo(() => {
    const counts = new Map();
    cards.filter((card) => kind === 'all' || card.kind === kind).forEach((card) => {
      (card.tags || []).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
    });
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [cards.length, kind]);
  React.useEffect(() => {
    if (tag === 'all') return;
    if (!tagFilters.some(([value]) => value === tag)) setTag('all');
  }, [tag, tagFilters]);
  const qq = q.trim().toLowerCase();
  const visible = cards.filter((card) => {
    if (kind !== 'all' && card.kind !== kind) return false;
    if (tag !== 'all' && !(card.tags || []).includes(tag)) return false;
    const talentText = tcgTalentRows(card).map((row) => [row.name, row.desc, tcgFormatCost(row.cost)].join(' ')).join(' ');
    const hay = [card.name, card.title, card.type, card.description, card.sourceText, card.playableCharacter, tcgFormatCost(card.cost), card.hp, talentText, ...(card.tags || [])].filter(Boolean).join(' ').toLowerCase();
    return !qq || hay.includes(qq);
  });
  // Everything renders — "Load more" was removed 2026-08-09 — newest cards
  // first within the selected kind.
  const ordered = React.useMemo(() => visible.slice().sort(nyxDatabaseCompareItems), [visible]);
  const kindFilters = [
    ['all', 'All Cards'],
    ['character', 'Character'],
    ['action', 'Action'],
  ];
  const openCard = (card) => {
    listSnapshotRef.current = { focusKey:dbListFocusKey('tcg', card.kind + '-' + card.id), scrollTop:gridRef.current ? gridRef.current.scrollTop : 0 };
    setFilterOpen(false);
    setActiveCard(card);
  };
  const closeCard = React.useCallback(() => {
    const snapshot = listSnapshotRef.current;
    ReactDOM.flushSync(() => setActiveCard(null));
    dbRestoreListSnapshot(snapshot, gridRef);
  }, []);
  React.useEffect(() => {
    if (!activeCard) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeCard();
    };
    window.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => backRef.current?.focus());
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeCard, closeCard]);
  if (activeCard) {
    return (
      <div className="tcg-view tcg-detail-page" data-screen-label="TCG card detail page">
        <div className="tcg-detail-toolbar">
          <button type="button" ref={backRef} className="tcg-back" onClick={closeCard}>
            <span>{'\u2039'}</span><b>Back to TCG Cards</b>
          </button>
          <div>
            <span>{activeCard.type || (activeCard.kind === 'character' ? 'Character' : 'Action')}</span>
            <b>{activeCard.id}</b>
          </div>
        </div>
        <div className="tcg-detail-scroll">
          <article className="tcg-detail-panel">
            <DatabaseItemFrame className="tcg-detail-image" art={activeCard.art} fallback={simInitials(activeCard.name)} rarity={activeCard.rarity ?? 0} portrait />
            <div className="tcg-detail-copy">
              <b>{activeCard.name}</b>
              {activeCard.title && <em>{activeCard.title}</em>}
              <div className="tcg-stat-grid">
                {tcgStatRows(activeCard).map(([label, value]) => (
                  <span key={label}><b>{label}</b><em>{value}</em></span>
                ))}
              </div>
              {activeCard.description && (
                <div className="tcg-effect">
                  <span>Description</span>
                  <p>{tcgRenderText(activeCard.description, null, resolver)}</p>
                </div>
              )}
              {activeCard.sourceText && (
                <div className="tcg-effect tcg-source">
                  <span>Source</span>
                  <p>{activeCard.sourceText}</p>
                </div>
              )}
              {tcgTalentRows(activeCard).length > 0 && (
                <div className="tcg-skill-list">
                  <span>Skills / Effects</span>
                  {tcgTalentRows(activeCard).map((row, index) => {
                    const refs = tcgReferenceRows(row.child, resolver);
                    return (
                      <article className="tcg-skill-card" key={(row.id || activeCard.id) + '-' + index}>
                        <div className="tcg-skill-head">
                          <b>{row.name || activeCard.name}</b>
                          {row.tag && <em>{TCG_SKILL_TAG_LABELS[row.tag] || row.tag}</em>}
                          {tcgFormatCost(row.cost) && <i>{tcgFormatCost(row.cost)}</i>}
                        </div>
                        {row.desc && <p>{tcgRenderText(row.desc, row.child, resolver)}</p>}
                        {refs.length > 0 && (
                          <div className="tcg-reference-list">
                            <span>References</span>
                            {refs.map((ref) => (
                              <div key={ref.key}>
                                <b>{ref.name}</b>
                                {ref.desc && <p>{ref.desc}</p>}
                              </div>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </article>
        </div>
      </div>
    );
  }
  return (
    <div className="tcg-view">
      <div className="tcg-head">
        <div className="tcg-search-tools">
          <div className="gp-search">
            <span className="ic"></span>
            <input aria-label="Search TCG cards" value={q} placeholder="Search TCG Cards" spellCheck="false" onChange={(e) => setQ(e.target.value)} />
            {q !== '' && <button type="button" className="x" title="Clear" onClick={() => setQ('')}>{'\u2715'}</button>}
          </div>
          <DatabaseFilterPopover id="tcg-filter-popout" label="TCG" open={filterOpen} setOpen={setFilterOpen}
            filters={{ kind, tag }} onClear={() => { setKind('all'); setTag('all'); }}
            onToggle={(key, value) => key === 'kind' ? setKind((current) => current === value ? 'all' : value) : setTag((current) => current === value ? 'all' : value)}
            facets={[
              { key:'kind', label:'Card Type', values:kindFilters.filter(([key]) => key !== 'all').map(([value, label]) => ({ value, label })) },
              { key:'tag', label:'Tags', values:tagFilters.map(([value, count]) => ({ value, label:value, count })) },
            ]} />
        </div>
      </div>
      {(kind !== 'all' || tag !== 'all') && (
        <div className="tcg-active-filters" aria-label="Active TCG filters">
          {kind !== 'all' && <button type="button" onClick={() => setKind('all')}>{kind === 'character' ? 'Character' : 'Action'} <span aria-hidden="true">{'\u00d7'}</span></button>}
          {tag !== 'all' && <button type="button" onClick={() => setTag('all')}>{tag} <span aria-hidden="true">{'\u00d7'}</span></button>}
          <button type="button" className="clear" onClick={() => { setKind('all'); setTag('all'); }}>Clear all</button>
        </div>
      )}
      <div className="tcg-grid" ref={gridRef}>
        {ordered.map((card) => (
          <button type="button" className={'tcg-card kind-' + card.kind} key={card.kind + '-' + card.id}
                  data-db-focus-key={dbListFocusKey('tcg', card.kind + '-' + card.id)}
                  onClick={() => openCard(card)}>
            <DatabaseItemFrame className="tcg-art" art={card.art} fallback={simInitials(card.name)} rarity={card.rarity ?? 0} portrait />
            <div className="tcg-meta">
              <b>{card.name}</b>
              <span>{card.type}</span>
            </div>
          </button>
        ))}
      </div>

      {visible.length === 0 && <div className="db-empty">No TCG cards match your search.</div>}
    </div>
  );
}

function potFormatTime(seconds){
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return '';
  const totalMinutes = Math.round(s / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(days + 'd');
  if (hours) parts.push(hours + 'h');
  if (minutes && !days) parts.push(minutes + 'm');
  return parts.join(' ') || '0m';
}

function GenshinPotView(){
  const gameData = dbGame('gi') || {};
  const pot = gameData.furniture || {};
  const items = pot.items || [];
  const extraGroups = [
    { key:'blueprints', label:'Furnishing Blueprints', items:pot.blueprints || [] },
    { key:'materials', label:'Realm Materials', items:pot.materials || [] },
  ];
  const [category, setCategory] = React.useState('all');
  const [sub, setSub] = React.useState('all');
  const [q, setQ] = React.useState('');
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [extraOpen, setExtraOpen] = React.useState({});
  const [activeItem, setActiveItem] = React.useState(null);
  const gridRef = React.useRef(null);
  const listSnapshotRef = React.useRef(null);
  const backRef = React.useRef(null);
  const categories = React.useMemo(() => (
    [['all', 'All', items.length], ...(pot.categories || []).map((c) => [c.key, c.key, c.count])]
  ), [items.length]);
  const subFilters = React.useMemo(() => {
    const counts = new Map();
    items.filter((item) => category === 'all' || item.category === category).forEach((item) => {
      (item.subtypes || []).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items.length, category]);
  React.useEffect(() => {
    if (sub === 'all') return;
    if (!subFilters.some(([value]) => value === sub)) setSub('all');
  }, [sub, subFilters]);
  const qq = q.trim().toLowerCase();
  const visible = items.filter((item) => {
    if (category !== 'all' && item.category !== category) return false;
    if (sub !== 'all' && !(item.subtypes || []).includes(sub)) return false;
    if (!qq) return true;
    const hay = [item.name, item.description, item.category, ...(item.subtypes || []), ...(item.source || [])]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(qq);
  });
  const visibleExtraGroups = extraGroups.map((group) => ({
    ...group,
    items:category === 'all' && sub === 'all'
      ? group.items.filter((item) => !qq || [item.name, item.description, item.category].filter(Boolean).join(' ').toLowerCase().includes(qq))
      : [],
  })).filter((group) => group.items.length);
  // Everything renders — "Load more" was removed 2026-08-09 — newest first
  // within the selected category.
  const ordered = React.useMemo(() => visible.slice().sort(nyxDatabaseCompareItems), [visible]);
  const openItem = (item) => {
    listSnapshotRef.current = { focusKey:dbListFocusKey('pot', item.id), scrollTop:gridRef.current ? gridRef.current.scrollTop : 0 };
    setFilterOpen(false);
    setActiveItem(item);
  };
  const closeItem = React.useCallback(() => {
    const snapshot = listSnapshotRef.current;
    ReactDOM.flushSync(() => setActiveItem(null));
    dbRestoreListSnapshot(snapshot, gridRef);
  }, []);
  React.useEffect(() => {
    if (!activeItem) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeItem();
    };
    window.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => backRef.current?.focus());
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeItem, closeItem]);
  if (!items.length) {
    return (
      <div className="pot-view">
        <div className="db-empty">Furnishing data has not been generated yet.</div>
      </div>
    );
  }
  if (activeItem) {
    const statRows = [];
    statRows.push(['ID', String(activeItem.id)]);
    statRows.push(['Category', activeItem.category]);
    if (activeItem.subtypes && activeItem.subtypes.length) statRows.push(['Type', activeItem.subtypes.join(' / ')]);
    if (Number.isFinite(Number(activeItem.rarity))) statRows.push(['Rarity', String(activeItem.rarity) + '★']);
    if (Number.isFinite(Number(activeItem.comfort)) && activeItem.comfort > 0) statRows.push(['Adeptal Energy', String(activeItem.comfort)]);
    if (Number.isFinite(Number(activeItem.cost)) && activeItem.cost > 0) statRows.push(['Load', String(activeItem.cost)]);
    return (
      <div className="pot-view pot-detail-page" data-screen-label="Serenitea Pot furnishing detail page">
        <div className="pot-detail-toolbar">
          <button type="button" ref={backRef} className="pot-back" onClick={closeItem}>
            <span>{'‹'}</span><b>Back to Furnishings</b>
          </button>
          <div>
            <span>{activeItem.category}</span>
            <b>{activeItem.id}</b>
          </div>
        </div>
        <div className="pot-detail-scroll">
          <article className="pot-detail-panel">
            <DatabaseItemFrame className="pot-detail-art" art={activeItem.art} fallback={simInitials(activeItem.name)} rarity={activeItem.rarity} />
            <div className="pot-detail-copy">
              <b>{activeItem.name}</b>
              <div className="pot-stat-grid">
                {statRows.map(([label, value]) => (
                  <span key={label}><b>{label}</b><em>{value}</em></span>
                ))}
              </div>
              {activeItem.description && (
                <div className="pot-effect">
                  <span>Description</span>
                  <p>{String(activeItem.description).replace(/\\n/g, '\n')}</p>
                </div>
              )}
              {activeItem.recipe && activeItem.recipe.materials.length > 0 && (
                <div className="pot-recipe">
                  <span>Crafting Recipe{activeItem.recipe.time ? ' · ' + potFormatTime(activeItem.recipe.time) : ''}</span>
                  <div className="pot-recipe-list">
                    {activeItem.recipe.materials.map((mat) => (
                      <div className="pot-mat" key={mat.id}>
                        <div className="pot-mat-icon">
                          {mat.icon ? <img src={mat.icon} alt="" draggable="false" /> : <span>{simInitials(mat.name)}</span>}
                        </div>
                        <b>{mat.name}</b>
                        <i>{'×' + mat.count}</i>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {activeItem.source && activeItem.source.length > 0 && (
                <div className="pot-effect pot-source">
                  <span>Source</span>
                  {activeItem.source.map((line, index) => <p key={index}>{line}</p>)}
                </div>
              )}
            </div>
          </article>
        </div>
      </div>
    );
  }
  return (
    <div className="pot-view">
      <div className="pot-head">
        <div className="db-search-tools">
          <div className="gp-search">
            <span className="ic"></span>
            <input value={q} placeholder="Search Furnishings" spellCheck="false" onChange={(e) => setQ(e.target.value)} />
            {q !== '' && <button type="button" className="x" title="Clear" onClick={() => setQ('')}>{'✕'}</button>}
          </div>
          <DatabaseFilterPopover id="pot-filter-popout" label="Furnishing" open={filterOpen} setOpen={setFilterOpen}
            filters={{ category, sub }} onClear={() => { setCategory('all'); setSub('all'); }}
            onToggle={(key, value) => {
              if (key === 'category') {
                setCategory((current) => current === value ? 'all' : value);
                setSub('all');
              } else {
                setSub((current) => current === value ? 'all' : value);
              }
            }}
            facets={[
              { key:'category', label:'Category', values:categories.filter(([value]) => value !== 'all').map(([value, label, count]) => ({ value, label, count })) },
              { key:'sub', label:'Type', values:subFilters.map(([value, count]) => ({ value, label:value, count })) },
            ]} />
        </div>
      </div>
      <div className="pot-grid" ref={gridRef}>
        {ordered.map((item) => (
          <button type="button" className="pot-card" key={item.id} data-db-focus-key={dbListFocusKey('pot', item.id)} onClick={() => openItem(item)}>
            <DatabaseItemFrame className="pot-art" art={item.art} fallback={simInitials(item.name)} rarity={item.rarity}>
              {Number.isFinite(Number(item.rarity)) && item.rarity > 0 && <i className="pot-rar">{item.rarity + '★'}</i>}
            </DatabaseItemFrame>
            <div className="pot-meta">
              <b>{item.name}</b>
              <span>{(item.subtypes && item.subtypes[0]) || item.category}</span>
            </div>
          </button>
        ))}
        {visibleExtraGroups.map((group) => (
          <section className="pot-extra-group" key={group.key}>
            <button type="button" className="pot-extra-toggle" aria-expanded={!!extraOpen[group.key]}
                    onClick={() => setExtraOpen((current) => ({ ...current, [group.key]:!current[group.key] }))}>
              <span>{group.label}</span><b>{group.items.length}</b><i>{extraOpen[group.key] ? '−' : '+'}</i>
            </button>
            {extraOpen[group.key] && (
              <div className="pot-extra-grid">
                {group.items.map((item) => (
                  <button type="button" className="pot-card" key={item.id} data-db-focus-key={dbListFocusKey('pot', item.id)} onClick={() => openItem(item)}>
                    <DatabaseItemFrame className="pot-art" art={item.art} fallback={simInitials(item.name)} rarity={item.rarity}>
                      {Number.isFinite(Number(item.rarity)) && item.rarity > 0 && <i className="pot-rar">{item.rarity + '★'}</i>}
                    </DatabaseItemFrame>
                    <div className="pot-meta"><b>{item.name}</b><span>{item.category}</span></div>
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      {visible.length === 0 && visibleExtraGroups.length === 0 && <div className="db-empty">No furnishings match your search.</div>}
    </div>
  );
}

/* ================= content panels ================= */
// (navKeyDown removed: the Achievements nav row was the only role="button" row
// left, and it is now a real link that Enter activates on its own.)

// Which games have an achievement tracker.
//
// The multi-game registry (features/achievements/achievement-games.js) is part
// of the launcher work and is not bundled yet. Until it is, fall back to the
// two games that already shipped a tracker — without this the tab silently
// disappears and /<game>/achievements stops routing.
/* The living eye, moved out of the top bar and parked under Settings at the
   foot of the side nav (user 2026-08-09). Decoration only — the Pengo wordmark
   in the top bar keeps the back-to-Worlds link. Owns its own wander timer so it
   survives switching between the hub and a game page. */
function NyxNavEye(){
  const ballRef = React.useRef(null);
  React.useEffect(() => {
    const ball = ballRef.current;
    if (!ball || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    let tm;
    (function wander(){
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random());
      ball.style.transform = 'translate(' + (Math.cos(a) * r * 5).toFixed(1) + 'px,' + (Math.sin(a) * r * 2.6).toFixed(1) + 'px)';
      tm = setTimeout(wander, 1100 + Math.random() * 1900);
    })();
    return () => clearTimeout(tm);
  }, []);
  return (
    <div className="gp-nav-eye" aria-hidden="true">
      <span className="tb-eye">
        <span className="elayer ball" ref={ballRef}></span>
        <span className="elayer lid"></span>
        <span className="elayer drips"></span>
      </span>
    </div>
  );
}

function achievementsSupported(key){
  const registry = typeof window !== 'undefined' ? window.NyxAchievementGames : null;
  if (registry && typeof registry.supportsTracker === 'function') return Boolean(registry.supportsTracker(key));
  return key === 'gi' || key === 'hsr';
}

function GameContent({ cfg, tab, setTab, onOpenMaterial, settings, setSettings, characterCustomize, setCharacterCustomize, materialSelection, setMaterialSelection, onSelectMaterialCharacter, onCloseMaterialCharacter }){
  const fns = cfg.fns || ['Characters','Database','Wish Tracker'];
  const visibleFns = fns; // J: Database is always visible (gating + settings toggle removed)
  const sideNavRef = React.useRef(null);
  // The channel state that used to live here only fed the Beta nav section
  // (removed 2026-08-14). The Live/Beta toggle and CharMaterials each track the
  // channel themselves, so GameContent no longer listens for it.
  const hasTcg = cfg.key === 'gi';
  const hasGallery = cfg.key === 'gi';
  const hasLibrary = cfg.key === 'gi' || cfg.key === 'hsr';
  const hasAchievements = achievementsSupported(cfg.key);
  // The Beta section was removed from the side nav 2026-08-14 (user request).
  // The Live/Beta channel toggle and all beta character data stay — only the
  // standalone /<game>/beta data-diff page is gone. Old links fall back to the
  // overview through validTabsForKey/coerceTabForKey.
  React.useEffect(() => {
    const nav = sideNavRef.current;
    if (nav && window.matchMedia('(max-width:760px)').matches) nav.scrollLeft = 0;
  }, [tab, cfg.key]);
  const openCharacterCustomize = (payload) => {
    setCharacterCustomize(Object.assign({ game:cfg.key, restoreScroll:0 }, payload || {}));
    setTab('char-customize');
  };
  const backFromCharacterCustomize = () => {
    const restore = Number(characterCustomize?.restoreScroll || 0);
    setTab('mats');
    setTimeout(() => {
      const scroller = document.querySelector('.cm-body');
      if (scroller) scroller.scrollTop = restore;
    }, 40);
  };
  // G13: the section list the Characters header icon-dropdown switches between.
  const sectionKey = (f) => /tracker$/i.test(f) ? 'tracker' : /^gallery$/i.test(f) ? 'gallery' : /^(characters|character materials)$/i.test(f) ? 'mats' : 'database';
  const sections = [{ key:'overview', label:'Overview' }, ...visibleFns.map((f) => ({ key:sectionKey(f), label:f })), ...(hasAchievements ? [{ key:'achievements', label:'Achievements' }] : []), ...(hasLibrary ? [{ key:'books', label:'Library' }] : []), { key:'settings', label:'Settings' }];
  // Each section already has a real address; handing it to the nav row as an
  // href is what makes ctrl/cmd/middle-click open the section in a new tab.
  const tabHref = (key) => routePathFor(cfg.key, key, null);
  return (
    <div className="gp-layout">
      <nav ref={sideNavRef} className="gp-side-nav" aria-label="Tools">
        <GPSectionNavButton active={tab === 'overview'} label="Overview" arrow={false} href={tabHref('overview')} onActivate={() => setTab('overview')} />
        {visibleFns.map(f => {
          const isTracker = /tracker$/i.test(f);
          const isGallery = /^gallery$/i.test(f);
          const isMats = /^(characters|character materials)$/i.test(f);
          const key = isTracker ? 'tracker' : isGallery ? 'gallery' : isMats ? 'mats' : 'database';
          // TCG + Serenitea Pot live INSIDE Database now \u2014 their tabs keep the
          // Database nav row lit.
          const isOn = tab === key || (key === 'database' && (tab === 'shadow' || tab === 'tcg' || tab === 'pot' || tab === 'wonderland'));
          return (
            <GPSectionNavButton key={f} active={isOn} label={f} href={tabHref(key)} onActivate={() => setTab(key)} />
          );
        })}
        {hasAchievements && (
          <a className={'gp-fn-row click' + (tab === 'achievements' ? ' on' : '')}
             href={tabHref('achievements')} draggable={false}
             aria-current={tab === 'achievements' ? 'page' : undefined}
             onClick={(event) => nyxNavClick(event, () => setTab('achievements'))}>
            <span className="dia" aria-hidden="true"></span><span>Achievements</span>
          </a>
        )}
        {hasLibrary && (
          <GPSectionNavButton active={tab === 'books'} label="Library" href={tabHref('books')} onActivate={() => setTab('books')} />
        )}
        <GPSectionNavButton active={tab === 'settings'} label="Settings" href={tabHref('settings')} onActivate={() => setTab('settings')} />
      </nav>

      {/* Overview board (user layout, 2026-08-08). One full-width grid: the
          banner columns on top, then events with timers and codes as their own
          columns. The old right-hand rail is dissolved into this grid, and the
          server-region control moves to the top-right corner. */}
      {tab === 'overview' && (
        <main className="gp-main-pane gp-overview-main">
          <div className="gp-ov-region">
            <TimePreferenceControl gameKey={cfg.key} />
          </div>
          <OverviewBannerBoard cfg={cfg} onOpenMaterial={onOpenMaterial} />
          <div className="gp-ov-lower">
            <CurrentEventsStrip game={cfg.key} gameName={cfg.name} />
            <section className="gp-ov-side gp-ov-timers" aria-label="Reset timers">
              <ResetTimersPanel gameKey={cfg.key} />
            </section>
            <section className="gp-ov-side gp-ov-codes" aria-label="Redemption codes">
              {/* Plain heading: the emblem and trailing rule were removed
                  2026-08-08 at the user's request. */}
              <b className="gp-ov-side-title">Redemption Codes</b>
              <CodesPanel codes={cfg.codes} gameKey={cfg.key} />
            </section>
          </div>
        </main>
      )}
      {tab === 'mats' && (
        <main className="gp-main-pane fill gp-characters-main">
          <CharMaterials
            inline
            game={cfg.key}
            selectedName={materialSelection?.game === cfg.key ? materialSelection.name : null}
            selectedFrom={materialSelection?.game === cfg.key ? materialSelection.from : null}
            sharedCard={materialSelection?.game === cfg.key ? materialSelection.shareCard : null}
            onCloseSharedCard={() => {
              if (setMaterialSelection) setMaterialSelection((current) => current?.game === cfg.key ? { ...current, shareCard:null } : current);
            }}
            pageTab={tab}
            onPageTab={setTab}
            sections={sections}
            pinnedFavourites={!materialSelection?.name ? <Favourites key={cfg.key} cfg={cfg} onOpenMaterial={onOpenMaterial} settings={settings} /> : null}
            onCustomizeCharacter={openCharacterCustomize}
            onSelectCharacter={(ch) => onSelectMaterialCharacter && onSelectMaterialCharacter(cfg.key, ch)}
            characterHref={(ch) => nyxCharacterHref(cfg.key, ch && (ch.rawName || ch.baseName || ch.n || ch.name))}
            onSelectedClose={() => {
              if (onCloseMaterialCharacter) onCloseMaterialCharacter(cfg.key);
              else if (setMaterialSelection) setMaterialSelection(null);
            }}
          />
        </main>
      )}
      {tab === 'char-customize' && (
        <main className="gp-main-pane fill">
          <CharMaterials
            inline
            customizeOnly
            game={cfg.key}
            selectedName={characterCustomize?.name}
            onBackCustomize={backFromCharacterCustomize}
          />
        </main>
      )}
      {tab === 'tracker' && (
        <main className="gp-main-pane fill">
          <GachaTracker key={cfg.key} inline cfg={buildTrack(cfg)} />
        </main>
      )}
      {(tab === 'database' || tab === 'shadow' || tab === 'tcg' || tab === 'pot' || tab === 'wonderland') && (
        <main className="gp-main-pane fill">
          <CollectionLibrary key={cfg.key} game={cfg.key}
            view={tab === 'database' ? undefined : tab}
            onViewChange={(next) => setTab(next)} />
        </main>
      )}
      {tab === 'gallery' && hasGallery && <main className="gp-main-pane fill"><GenshinGalleryView /></main>}
      {tab === 'achievements' && hasAchievements && <AchievementPage key={cfg.key} game={cfg.key} />}
      {tab === 'books' && hasLibrary && <LibraryPage game={cfg.key} />}
      {tab === 'settings' && <SettingsPane settings={settings} setSettings={setSettings} />}

    </div>
  );
}


/* ---------------- hub birthday calendar (Workstream P) ---------------- */
// HSR is excluded by design: its characters canonically have no birthdays.
const BDAY_GAMES = ['gi','zzz','wuwa','ae'];
const BDAY_STORE_KEY = 'nyx:birthday-calendar-games:v1';
const BDAY_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const BDAY_WEEKDAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function bdayParse(text){
  const m = String(text || '').trim().match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (!m) return null;
  const month = BDAY_MONTHS.findIndex((name) => name.toLowerCase() === m[1].toLowerCase());
  const day = Number(m[2]);
  return month >= 0 && day >= 1 && day <= 31 ? { month, day } : null;
}

function loadBdayGames(){
  try {
    const saved = JSON.parse(localStorage.getItem(BDAY_STORE_KEY) || 'null');
    if (Array.isArray(saved)) return BDAY_GAMES.filter((g) => saved.includes(g));
  } catch (e) {}
  return BDAY_GAMES.slice();
}

// Next real occurrence; February 29 waits for the next leap year.
function bdayNextDate(now, month, day){ return nyxNextBirthdayDate(now, month, day); }

function BdayChip({ entry, onOpenMaterial, onEdit }){
  const [blobUrl, setBlobUrl] = React.useState('');
  React.useEffect(() => {
    if (!(entry.iconBlob instanceof Blob)) { setBlobUrl(''); return undefined; }
    const next = URL.createObjectURL(entry.iconBlob);
    setBlobUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [entry.iconBlob]);
  const gameLabel = GAME_REGISTRY[entry.game]?.name || entry.label || (entry.custom ? 'Custom birthday' : entry.game);
  const activate = (event) => entry.custom ? onEdit?.(entry, event.currentTarget) : onOpenMaterial?.(entry.game, entry.name);
  // A custom birthday opens the editor rather than a character page, so it has
  // no address and stays a button.
  const href = entry.custom ? undefined : nyxCharacterHref(entry.game, entry.name);
  const cls = 'bcal-chip g-' + entry.game;
  const title = entry.name + ' — ' + BDAY_MONTHS[entry.month] + ' ' + entry.day + ' (' + gameLabel + ')' + (entry.custom ? ' — edit' : '');
  const label = entry.name + ', birthday ' + BDAY_MONTHS[entry.month] + ' ' + entry.day + ', ' + gameLabel + (entry.custom ? ', edit birthday' : '');
  const inner = (blobUrl || entry.icon)
    ? <img src={blobUrl || entry.icon} alt="" draggable="false" loading="lazy" />
    : <span className="bcal-chip-fallback">{nyxBirthdayInitials(entry.name)}</span>;
  if (href) {
    return (
      <a className={cls} href={href} draggable={false} title={title} aria-label={label}
         onClick={(event) => nyxNavClick(event, () => onOpenMaterial?.(entry.game, entry.name))}>{inner}</a>
    );
  }
  return (
    <button type="button" className={cls} title={title} aria-label={label} onClick={activate}>{inner}</button>
  );
}

function BirthdayDialog({ entry, onClose, onSaved, onDeleted }){
  const [draft, setDraft] = React.useState(() => entry ? { ...entry } : {
    name:'', month:new Date().getMonth(), day:new Date().getDate(), game:'', label:'', note:'', iconBlob:null,
  });
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const titleRef = React.useRef(null);
  const formRef = React.useRef(null);
  React.useEffect(() => {
    titleRef.current?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopImmediatePropagation(); onClose(); return; }
      if (event.key !== 'Tab' || !formRef.current) return;
      const focusable = Array.from(formRef.current.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  const update = (key, value) => setDraft((previous) => ({ ...previous, [key]:value }));
  const chooseIcon = async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    try { update('iconBlob', await nyxPrepareBirthdayIcon(file)); }
    catch (nextError) { setError(nextError.message || 'That image could not be used.'); }
    finally { setBusy(false); }
  };
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSaved(draft); }
    catch (nextError) { setError(nextError.message || 'The birthday could not be saved.'); setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError('');
    try { await onDeleted(entry); }
    catch (nextError) { setError(nextError.message || 'The birthday could not be deleted.'); setBusy(false); }
  };
  return <div className="bcal-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="bcal-dialog" role="dialog" aria-modal="true" aria-labelledby="bcal-dialog-title" onSubmit={submit} ref={formRef}>
      <div className="bcal-dialog-head">
        <div><span>Personal calendar</span><h2 id="bcal-dialog-title" tabIndex="-1" ref={titleRef}>{entry ? 'Edit date' : 'Add date'}</h2></div>
        <button type="button" className="bcal-dialog-close" aria-label="Close birthday dialog" onClick={onClose} disabled={busy}>{'×'}</button>
      </div>
      <label><span>Name</span><input required maxLength="80" value={draft.name} onChange={(event) => update('name', event.target.value)} /></label>
      <div className="bcal-dialog-date">
        <label><span>Month</span><select value={draft.month} onChange={(event) => update('month', Number(event.target.value))}>{BDAY_MONTHS.map((month, index) => <option value={index} key={month}>{month}</option>)}</select></label>
        <label><span>Day</span><input type="number" required min="1" max="31" value={draft.day} onChange={(event) => update('day', Number(event.target.value))} /></label>
      </div>
      <label><span>Game (optional)</span><select value={draft.game} onChange={(event) => update('game', event.target.value)}><option value="">Personal</option>{SIM_GAMES.map((game) => <option value={game.key} key={game.key}>{game.name}</option>)}</select></label>
      <label><span>Label (optional)</span><input maxLength="60" value={draft.label || ''} onChange={(event) => update('label', event.target.value)} placeholder="Friend, anniversary…" /></label>
      <label><span>Short note (optional)</span><textarea maxLength="280" rows="3" value={draft.note || ''} onChange={(event) => update('note', event.target.value)} /></label>
      <div className="bcal-icon-field">
        <div><span>Icon (optional)</span><small>PNG, JPEG, or WebP. It stays in this browser.</small></div>
        <label className="bcal-file"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseIcon} disabled={busy} /><span>{draft.iconBlob ? 'Replace icon' : 'Choose icon'}</span></label>
        {draft.iconBlob && <button type="button" onClick={() => update('iconBlob', null)} disabled={busy}>Remove icon</button>}
      </div>
      {error && <p className="bcal-dialog-error" role="alert">{error}</p>}
      <div className="bcal-dialog-actions">
        {entry && <button type="button" className="danger" onClick={remove} disabled={busy}>Delete</button>}
        <span></span><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save date'}</button>
      </div>
    </form>
  </div>;
}

function BirthdayCalendar({ onOpenMaterial }){
  const [enabled, setEnabled] = React.useState(loadBdayGames);
  const [loadTick, setLoadTick] = React.useState(0);
  const [customEntries, setCustomEntries] = React.useState([]);
  const [customError, setCustomError] = React.useState('');
  const [editing, setEditing] = React.useState(undefined);
  const savedView = React.useMemo(() => nyxReadCalendarViewState(), []);
  const [cursor, setCursor] = React.useState(() => savedView || (() => { const d = new Date(); return { year:d.getFullYear(), month:d.getMonth() }; })());
  const calendarRef = React.useRef(null);
  const addButtonRef = React.useRef(null);
  const dialogTriggerRef = React.useRef(null);
  const cursorRef = React.useRef(cursor);
  cursorRef.current = cursor;

  const loadCustom = React.useCallback(async () => {
    try { setCustomEntries(await nyxListCustomBirthdays()); setCustomError(''); }
    catch (error) { setCustomError(error.message || 'Personal birthdays could not be loaded.'); }
  }, []);

  React.useEffect(() => {
    let live = true;
    BDAY_GAMES.forEach((g) => requestCmGame(g).then(() => { if (live) setLoadTick((v) => v + 1); }));
    loadCustom();
    const unsubscribe = nyxSubscribeCustomBirthdays(loadCustom);
    return () => { live = false; unsubscribe(); };
  }, [loadCustom]);

  const calendarScrollTop = React.useCallback(() => {
    const node = calendarRef.current;
    return Math.max(node?.scrollTop || 0, node?.closest('.gp-main-pane')?.scrollTop || 0, node?.closest('.gp-layout')?.scrollTop || 0, document.scrollingElement?.scrollTop || 0);
  }, []);
  React.useEffect(() => {
    const top = savedView?.scrollTop || 0;
    if (!top) return undefined;
    const frame = requestAnimationFrame(() => {
      const node = calendarRef.current;
      const pane = node?.closest('.gp-main-pane');
      const layout = node?.closest('.gp-layout');
      if (node) node.scrollTop = top;
      if (pane) pane.scrollTop = top;
      if (layout) layout.scrollTop = top;
      if (document.scrollingElement) document.scrollingElement.scrollTop = top;
    });
    return () => cancelAnimationFrame(frame);
  }, [savedView]);
  React.useEffect(() => () => nyxSaveCalendarViewState({ ...cursorRef.current, scrollTop:calendarScrollTop() }), [calendarScrollTop]);

  const toggle = (g) => setEnabled((prev) => {
    const next = prev.includes(g) ? prev.filter((k) => k !== g) : BDAY_GAMES.filter((k) => prev.includes(k) || k === g);
    try { localStorage.setItem(BDAY_STORE_KEY, JSON.stringify(next)); } catch (e) {}
    return next;
  });

  const generatedEntries = React.useMemo(() => {
    const out = [];
    for (const g of BDAY_GAMES){
      if (!enabled.includes(g)) continue;
      const seen = new Set();
      for (const ch of getCmRoster(g)){
        const name = ch.n || ch.name;
        const key = String(name || '').toLowerCase();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        const b = bdayParse(ch.facts && ch.facts.birthday);
        if (!b) continue;
        out.push({ game:g, name, icon: ch.icon || ch.circle || ch.card || null, month:b.month, day:b.day });
      }
    }
    return out;
  }, [enabled, loadTick]);
  const entries = React.useMemo(() => generatedEntries.concat(customEntries.map((entry) => ({ ...entry, custom:true }))), [generatedEntries, customEntries]);

  const now = new Date();
  const upcoming = React.useMemo(() => (
    entries
      .map((entry) => ({ ...entry, next:bdayNextDate(now, entry.month, entry.day) }))
      .filter((entry) => entry.next)
      .sort((a, b) => a.next - b.next || a.name.localeCompare(b.name))
      .slice(0, 5)
  ), [entries, now.getFullYear(), now.getMonth(), now.getDate()]);

  const byDay = React.useMemo(() => {
    const map = new Map();
    for (const entry of entries){
      if (entry.month !== cursor.month) continue;
      if (!map.has(entry.day)) map.set(entry.day, []);
      map.get(entry.day).push(entry);
    }
    for (const list of map.values()) list.sort((a, b) => Number(a.custom) - Number(b.custom) || BDAY_GAMES.indexOf(a.game) - BDAY_GAMES.indexOf(b.game) || a.name.localeCompare(b.name));
    return map;
  }, [entries, cursor.month]);

  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const leadBlanks = (new Date(cursor.year, cursor.month, 1).getDay() + 6) % 7; // Monday-first
  const isTodayCell = (day) => day === now.getDate() && cursor.month === now.getMonth() && cursor.year === now.getFullYear();
  const moveMonth = (delta) => setCursor((prev) => {
    const d = new Date(prev.year, prev.month + delta, 1);
    const next = { year:d.getFullYear(), month:d.getMonth() };
    nyxSaveCalendarViewState({ ...next, scrollTop:calendarScrollTop() });
    return next;
  });
  const daysUntil = (next) => {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.round((next.getTime() - todayStart) / 86400000);
  };
  const openCharacter = (game, name) => {
    nyxSaveCalendarViewState({ ...cursor, scrollTop:calendarScrollTop() });
    onOpenMaterial?.(game, name, { from:'calendar' });
  };
  const closeEditor = React.useCallback((preferTrigger) => {
    const preferred = preferTrigger ? dialogTriggerRef.current : null;
    const target = nyxCalendarFocusTarget(preferred, addButtonRef.current);
    dialogTriggerRef.current = null;
    ReactDOM.flushSync(() => setEditing(undefined));
    target?.focus({ preventScroll:true });
  }, []);
  const openEditor = (entry, trigger) => { dialogTriggerRef.current = trigger || null; setEditing(entry); };
  const saveCustom = async (draft) => { const wasEditing = !!editing; await nyxSaveCustomBirthday(draft); closeEditor(wasEditing); };
  const deleteCustom = async (entry) => { await nyxDeleteCustomBirthday(entry.id); closeEditor(false); };

  return (
    <section className="bcal" aria-label="Character birthday calendar" ref={calendarRef}>
      {editing !== undefined && <BirthdayDialog entry={editing || null} onClose={() => closeEditor(!!editing)} onSaved={saveCustom} onDeleted={deleteCustom} />}
      <div className="bcal-head">
        <GPSec title="Birthday Calendar" icon="../assets/decor/orbit_burst.png" className="nyx-u-fill" />
        <button type="button" className="bcal-add" ref={addButtonRef} onClick={(event) => openEditor(null, event.currentTarget)}>Add date</button>
        <div className="bcal-toggles" role="group" aria-label="Games shown on the calendar">
          {BDAY_GAMES.map((g) => (
            <button type="button" key={g} className={'bcal-toggle g-' + g + (enabled.includes(g) ? ' on' : '')}
                    aria-pressed={enabled.includes(g)} onClick={() => toggle(g)}>
              {(SIM_GAMES.find((game) => game.key === g) || {}).icon && <img src={SIM_GAMES.find((game) => game.key === g).icon} alt="" draggable="false" />}
              <span>{GAME_REGISTRY[g]?.name || g}</span>
            </button>
          ))}
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className="bcal-next" aria-label="Next birthdays">
          <b>Next birthdays</b>
          <div className="bcal-next-row">
            {upcoming.map((entry) => (
              <div className="bcal-next-item" key={entry.custom ? entry.id : entry.game + ':' + entry.name}>
                <BdayChip entry={entry} onOpenMaterial={openCharacter} onEdit={openEditor} />
                <span className="who">{entry.name}</span>
                <span className="when">{BDAY_MONTHS[entry.month].slice(0, 3)} {entry.day}{daysUntil(entry.next) === 0 ? ' · today!' : ' · in ' + daysUntil(entry.next) + 'd'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bcal-month-bar">
        <button type="button" className="bcal-nav" aria-label="Previous month" onClick={() => moveMonth(-1)}>{'‹'}</button>
        <b>{BDAY_MONTHS[cursor.month]} {cursor.year}</b>
        <button type="button" className="bcal-nav" aria-label="Next month" onClick={() => moveMonth(1)}>{'›'}</button>
        {(cursor.month !== now.getMonth() || cursor.year !== now.getFullYear()) && (
          <button type="button" className="bcal-today-btn" onClick={() => { const next = { year:now.getFullYear(), month:now.getMonth() }; setCursor(next); nyxSaveCalendarViewState({ ...next, scrollTop:calendarScrollTop() }); }}>Today</button>
        )}
      </div>

      <div className="bcal-grid" role="grid" aria-label={BDAY_MONTHS[cursor.month] + ' ' + cursor.year}>
        {BDAY_WEEKDAYS.map((d) => <div className="bcal-wd" key={d} role="columnheader">{d}</div>)}
        {Array.from({ length: leadBlanks }, (_, i) => <div className="bcal-cell blank" key={'blank-' + i} aria-hidden="true"></div>)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const list = byDay.get(day) || [];
          return (
            <div className={'bcal-cell' + (isTodayCell(day) ? ' today' : '') + (list.length ? ' has-bday' : '')} key={day} role="gridcell">
              <span className="d">{day}</span>
              {list.length > 0 && (
                <div className="bcal-cell-chips">
                  {list.map((entry) => <BdayChip key={entry.custom ? entry.id : entry.game + ':' + entry.name} entry={entry} onOpenMaterial={openCharacter} onEdit={openEditor} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {customError && <div className="bcal-storage-error" role="alert">{customError}</div>}
      {entries.length === 0 && <div className="bcal-empty">{enabled.length ? 'Birthday data is still loading…' : 'Add a personal birthday or enable a game.'}</div>}
    </section>
  );
}

/* ---- Nyx hub: Banners (user 2026-08-09) --------------------------------
   One column per game, read top to bottom: the phase running now, then the one
   after it, then whatever is known beyond that. Every unit is the same wide row
   the game overviews use — round icon, big name, splash bleeding out to the
   right — so a banner reads the same everywhere on the site. */
function NyxBannerColumn({ cfg, onOpenMaterial, now }){
  const board = React.useMemo(() => overviewBannerBoard(cfg), [cfg.key]);
  const rosterMap = React.useMemo(() => rosterUnitMap(cfg), [cfg.key]);
  const openUnit = React.useCallback((unit) => {
    const match = rosterMap.get(normalizeUnitName(unit.name));
    if (!onOpenMaterial || !match) return;
    onOpenMaterial(cfg.key, match.rawName || match.name || unit.name, { from:'nyx' });
  }, [cfg.key, onOpenMaterial, rosterMap]);
  const unitLink = (unit) => (
    onOpenMaterial && unit?.name && rosterMap.has(normalizeUnitName(unit.name)) ? () => openUnit(unit) : null
  );
  // Hub rows link into the game's own character page, never a hub address.
  const unitHref = (unit) => {
    const match = unit?.name ? rosterMap.get(normalizeUnitName(unit.name)) : null;
    return match ? nyxCharacterHref(cfg.key, match.rawName || match.name || unit.name) : undefined;
  };
  const sections = [];
  // A unit is listed once per column. The ZZZ feed in particular repeats the
  // same names across its next and upcoming phases, and two sections carrying
  // the same patch label are one phase split in the source — merge rather than
  // print "Patch 3.1" twice with overlapping casts.
  const seen = new Set();
  const push = (column, heading, status) => {
    if (!column) return;
    // The hub lists headline units only.
    const units = [...column.heroes, ...column.others]
      .filter((unit) => {
        // Matched on BOTH name and artwork: feeds spell alt versions two ways
        // ("Ukinami Yuzuha" vs "Yuzuha") so the artwork catches those, and a
        // summary row can resolve the same character to a different art file so
        // the name catches those.
        const keys = [normalizeUnitName(unit.name), unit.icon, unit.splash].filter(Boolean);
        if (!keys.length || keys.some((key) => seen.has(key))) return false;
        keys.forEach((key) => seen.add(key));
        return true;
      });
    if (!units.length) return;
    const when = bannerWhen({ start:column.start, end:column.end, status }, now);
    const last = sections[sections.length - 1];
    if (last && last.heading === heading) last.units.push(...units);
    else sections.push({ key:status + sections.length, heading, status, units, when });
  };
  push(board.current, bannerPhaseHeading(board.current) || 'Running now', 'live');
  push(board.next, bannerPhaseHeading(board.next) || 'Up next', 'next');
  board.later.forEach((column, index) => {
    push(column, (index === 0 ? bannerNextPhaseHeading(column, board.next) : bannerPhaseHeading(column)) || 'Later', 'upcoming');
  });
  if (!sections.length) return <div aria-hidden="true"></div>;
  return (
    <section className="nyx-ban-col" aria-label={cfg.name + ' banners'}>
      <header className="nyx-ban-col-head">
        {cfg.icon && <img src={cfg.icon} alt="" draggable="false" />}
        <b>{cfg.name}</b>
      </header>
      {sections.map((section) => (
        <div className="nyx-ban-phase" key={section.key}>
          <div className="nyx-ban-phase-head">
            <b>{section.heading}</b>
            {/* Each group carries its own countdown and window
                (user 2026-08-09). */}
            {section.when && section.when.headline && (
              <span className="nyx-ban-phase-when">
                <b>{section.when.headline}</b>
                {section.when.sub && <em>{section.when.sub}</em>}
              </span>
            )}
          </div>
          {section.units.map((unit) => (
            <BannerBoardRow key={section.key + unit.name} unit={unit} status={section.status} onOpen={unitLink(unit)} href={unitHref(unit)} />
          ))}
        </div>
      ))}
    </section>
  );
}

function NyxBannerColumns({ onOpenMaterial }){
  const now = useNowTick(1000);
  return (
    <section className="nyx-ban-cols" aria-label="Banners by game">
      {SIM_GAMES.map((game) => (
        <NyxBannerColumn key={game.key} cfg={GAME_REGISTRY[game.key]} onOpenMaterial={onOpenMaterial} now={now} />
      ))}
    </section>
  );
}

/* ---- Nyx hub: Events (user 2026-08-09) ---------------------------------
   The same Current Events strip each game overview shows, stacked one game per
   block so the hub answers "what is running anywhere" in a single scroll. */
function NyxEventsView(){
  return (
    <div className="nyx-events-view">
      {SIM_GAMES.map((game) => (
        <section className="nyx-events-game" key={game.key}>
          <header className="nyx-ban-col-head">
            {game.icon && <img src={game.icon} alt="" draggable="false" />}
            <b>{game.name}</b>
          </header>
          <CurrentEventsStrip game={game.key} gameName={game.name} />
        </section>
      ))}
    </div>
  );
}

function SimContent({ tab, setTab, onOpenMaterial, settings, setSettings }){
  const sideNavRef = React.useRef(null);
  React.useEffect(() => {
    const nav = sideNavRef.current;
    if (nav && window.matchMedia('(max-width:760px)').matches) nav.scrollLeft = 0;
  }, [tab]);
  // The All Banners, All Events, Pull Overview and Timeline tabs were removed
  // 2026-08-09; Overview became Banners and now carries the per-game columns.
  const NAV = [
    { key:'overview', label:'Banners' },
    { key:'events',   label:'Events' },
    { key:'characters', label:'Pinned Characters' },
    { key:'calendar', label:'Calendar' },
    { key:'codes',    label:'Redemption Codes' },
    { key:'settings', label:'Settings' },
  ];
  return (
    <div className="gp-layout">
      <nav ref={sideNavRef} className="gp-side-nav" aria-label="Sections">
        {NAV.map(n => (
          <GPSectionNavButton key={n.key} active={tab === n.key} label={n.label} diamond={false} href={routePathFor('nyx', n.key, null)} onActivate={() => setTab(n.key)} />
        ))}
      </nav>
      {/* The server-region control, reset timers and codes aside were removed
          from this pane 2026-08-09 — codes have their own tab. */}
      {tab === 'overview' && (
        <main className="gp-main-pane fill gp-overview-main">
          <NyxBannerColumns onOpenMaterial={onOpenMaterial} />
        </main>
      )}
      {tab === 'events' && <main className="gp-main-pane fill"><NyxEventsView /></main>}
      {tab === 'characters' && <main className="gp-main-pane fill gp-characters-main"><Favourites key="nyx" cfg={NYX_META} onOpenMaterial={onOpenMaterial} settings={settings} /></main>}
      {tab === 'calendar' && <main className="gp-main-pane fill"><BirthdayCalendar onOpenMaterial={onOpenMaterial} /></main>}
      {tab === 'codes' && <main className="gp-main-pane fill"><AllCodesView /></main>}
      {tab === 'settings' && <SettingsPane settings={settings} setSettings={setSettings} />}
    </div>
  );
}

/* ================= root (tabbed SPA) ================= */
const HREF_TO_KEY = {};
Object.keys(GP_PAGE_HREF).forEach(k => { HREF_TO_KEY[GP_PAGE_HREF[k]] = k; });
const ROUTE_SEGMENT_TO_KEY = {
  nyx:'nyx',
  genshin:'gi',
  hsr:'hsr',
  zzz:'zzz',
  wuwa:'wuwa',
  endfield:'ae',
};
const GAME_TAB_TO_ROUTE = {
  overview:'',
  mats:'materials',
  database:'database',
  gallery:'gallery',
  tracker:'tracker',
  shadow:'database/tps-shadow-realm',
  tcg:'database/tcg',
  pot:'database/serenitea-pot',
  wonderland:'database/wonderland',
  achievements:'achievements',
  books:'books',
  settings:'settings',
};
// key -> URL segment (the inverse of ROUTE_SEGMENT_TO_KEY); used by the hub
// Timeline tab so the chosen game shows up as /nyx/timeline/<game>.
const KEY_TO_ROUTE_SEGMENT = {};
Object.keys(ROUTE_SEGMENT_TO_KEY).forEach((seg) => {
  const key = ROUTE_SEGMENT_TO_KEY[seg];
  if (!KEY_TO_ROUTE_SEGMENT[key]) KEY_TO_ROUTE_SEGMENT[key] = seg;
});
const NYX_TAB_TO_ROUTE = {
  overview:'',
  characters:'characters',
  calendar:'calendar',
  codes:'codes',
  events:'events',
  settings:'settings',
};
const ROUTE_TO_GAME_TAB = {
  materials:'mats',
  mats:'mats',
  characters:'mats',
  character:'mats',
  database:'database',
  library:'database', // old bookmarks land on the renamed Database tab
  gallery:'gallery',
  achievements:'achievements',
  books:'books',
  tracker:'tracker',
  tcg:'tcg',
  'tps-shadow-realm':'shadow',
  shadow:'shadow',
  'serenitea-pot':'pot',
  pot:'pot',
  furniture:'pot',
  wonderland:'wonderland',
  // Retired 2026-08-14: /<game>/beta no longer has a page. The segment is left
  // out of the map so coerceTabForKey falls the URL through to the overview.
  settings:'settings',
};
const ROUTE_TO_NYX_TAB = {
  characters:'characters',
  character:'characters',
  calendar:'calendar',
  codes:'codes',
  events:'events',
  settings:'settings',
  // Retired hub tabs (2026-08-09): a bookmarked link lands on Banners rather
  // than a dead route.
  timeline:'overview',
  pulls:'overview',
  pull:'overview',
  banners:'overview',
};

// Remembered game for the hub Timeline tab, so returning to /nyx/timeline
// (no game in the URL) reopens the timeline you were last reading.
const NYX_TIMELINE_GAME_KEY = 'nyx:timeline-game:v1';

function loadTimelineGame(){
  try {
    const saved = localStorage.getItem(NYX_TIMELINE_GAME_KEY);
    if (saved && SIM_GAMES.some((g) => g.key === saved)) return saved;
  } catch (e) {}
  return SIM_GAMES[0].key;
}

function saveTimelineGame(key){
  try { localStorage.setItem(NYX_TIMELINE_GAME_KEY, String(key || '')); } catch (e) {}
}

function routeSlug(value){
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function routeFromLocation(){
  try {
    const parts = location.pathname
      .split('/')
      .map((part) => decodeURIComponent(part))
      .filter(Boolean);
    const first = parts[0] || '';
    const key = ROUTE_SEGMENT_TO_KEY[first] || HREF_TO_KEY['/' + first] || (first === '' ? 'nyx' : undefined);
    if (!key) return {};
    const sub = parts[1] || '';
    if (key === 'nyx') {
      const nyxTab = coerceTabForKey(key, ROUTE_TO_NYX_TAB[sub] || 'overview');
      const timelineGame = nyxTab === 'timeline' ? (ROUTE_SEGMENT_TO_KEY[parts[2] || ''] || null) : null;
      return { key, tab:nyxTab, timelineGame:timelineGame === 'nyx' ? null : timelineGame };
    }
    const character = (sub === 'characters' || sub === 'character') ? parts.slice(2).join('-') : '';
    const legacyHash = String(location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean).pop() || '';
    const hashTab = ROUTE_TO_GAME_TAB[legacyHash];
    const databaseView = sub === 'database' ? (ROUTE_TO_GAME_TAB[parts[2] || ''] || hashTab) : null;
    const tab = character ? 'mats' : (databaseView || ROUTE_TO_GAME_TAB[sub] || hashTab || 'overview');
    const shareCard = character ? nyxParseMaterialsCardSearch(location.search) : null;
    return { key, tab:coerceTabForKey(key, tab), character:character || null, shareCard };
  } catch (e) {
    return {};
  }
}

function routePathFor(key, tab, selection, timelineGame){
  const base = GP_PAGE_HREF[key] || GP_PAGE_HREF.nyx;
  if (!key || key === 'nyx') {
    const safeNyxTab = coerceTabForKey('nyx', tab || 'overview');
    const slug = NYX_TAB_TO_ROUTE[safeNyxTab] || '';
    if (!slug) return base;
    const gameSlug = safeNyxTab === 'timeline' ? (KEY_TO_ROUTE_SEGMENT[timelineGame] || '') : '';
    return base + '/' + slug + (gameSlug ? '/' + gameSlug : '');
  }
  const selectedName = selection && selection.game === key ? (selection.name || selection.slug) : '';
  const characterSlug = routeSlug(selectedName);
  if (characterSlug) return base + '/characters/' + characterSlug;
  const safeTab = coerceTabForKey(key, tab || 'overview');
  const slug = GAME_TAB_TO_ROUTE[safeTab] || '';
  return slug ? base + '/' + slug : base;
}

// The address of a character's own page. Every control that opens a character
// hands this to its `href`, so ctrl/cmd/middle-click lands them in a new tab
// while a plain click stays an in-app switch. The hub has no character pages of
// its own — those always belong to a game.
function nyxCharacterHref(key, name){
  if (!key || key === 'nyx' || !name) return undefined;
  return routePathFor(key, 'mats', { game:key, name });
}

function routeStateFor(key, tab, selection){
  return {
    nyxKey:key,
    nyxTab:coerceTabForKey(key, tab || 'overview'),
    nyxCharacter:selection && selection.game === key ? (selection.name || selection.slug || null) : null,
    nyxFrom:selection && selection.game === key && (selection.from === 'calendar' || selection.from === 'nyx') ? selection.from : null,
  };
}

function validTabsForKey(key){
  // Timeline, Pull Overview, All Banners and All Events were removed from the
  // hub 2026-08-09; their old URLs fall through to Banners (the overview).
  if (key === 'nyx') return ['overview','events','characters','calendar','codes','settings'];
  const tabs = ['overview','mats','char-customize','database','tracker'];
  if (key === 'gi') tabs.push('gallery','shadow','tcg','pot','wonderland');
  if (achievementsSupported(key)) tabs.push('achievements');
  if (key === 'gi' || key === 'hsr') tabs.push('books');
  // 'beta' was retired 2026-08-14; a bookmarked /<game>/beta coerces to overview.
  tabs.push('settings');
  return tabs;
}

function coerceTabForKey(key, wanted){
  return validTabsForKey(key).includes(wanted) ? wanted : 'overview';
}

const DEFAULT_TAB = () => 'overview';

// Live/Beta data toggle — pinned bottom-left of the game page (above the Pengo).
// Owns nothing but the per-game channel in localStorage; the materials panel
// (CharMaterials) listens for 'nyx:cm-channel-changed' and re-renders to match.
// Shares cmHasBeta/cmLoadChannel/cmSaveChannel from char-materials.jsx (same bundle).
const NYX_PENGO_SETTINGS_KEY = 'nyx-pengo-settings';
const NYX_PENGO_DISPLAY_DEFAULTS = { gi:true, hsr:true, zzz:true, wuwa:true, ae:true };
const NYX_IDENTITY_DEFAULTS = { twin:'aether', receptacle:'caelus', sibling:'wise', rover:'male', endmin:'male' };
const NYX_LANGUAGE_DEFAULTS = { gi:'en', hsr:'en', zzz:'en', wuwa:'en', ae:'en' };
const NYX_LANGUAGE_OPTIONS = [
  ['en', 'English'],
  ['zh', 'Chinese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
];
const NYX_IDENTITY_GROUPS = [
  { key:'twin', label:'Traveler', tip:'Who went with Columbina to the moon?', options:[['aether', 'Aether'], ['lumine', 'Lumine'], ['paimon', 'Paimon'], ['little_one', 'Little One'], ['arama', 'Arama']] },
  { key:'receptacle', label:'Trailblazer', tip:'Who is digging into the Trashcan?', options:[['caelus', 'Caelus'], ['stelle', 'Stelle'], ['pom_pom', 'Pom-Pom'], ['gepard', 'Gepard?'], ['trash', 'I am Trash']] },
  { key:'sibling', label:'Lord Phaethon', tip:"Don't worry, Vivian loves both Lord Phaethons equally", options:[['wise', 'Wise'], ['belle', 'Belle'], ['eous', 'Eous'], ['fairy', 'Fairy'], ['phaethon', 'Phaethon']] },
  { key:'rover', label:'Rover', tip:"Abby doesn't ask questions when you change gender", options:[['male', 'Male'], ['female', 'Female'], ['abby', 'Abby']] },
  { key:'endmin', label:'Endministrator', tip:'Who is your Originium Penguin?', options:[['male', 'Male'], ['female', 'Female'], ['penguin', 'Penguin']] },
];
const NYX_PENGO_DEFAULTS = {
  whispers: true,
  animation: 'play',
  khaenriah: false,
  displayGames: NYX_PENGO_DISPLAY_DEFAULTS,
  gameIcons: {},
  identity: NYX_IDENTITY_DEFAULTS,
  language: NYX_LANGUAGE_DEFAULTS,
  specialUnits: NYX_SPECIAL_UNIT_DEFAULTS,
  alwaysBeta: false,
  lapis: false,
  energy: 35,
  spawn: 1,
  sacrifice: 1,
};

function clampPengoNumber(value, min, max){
  const n = parseInt(value, 10);
  if (!isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function sanitizeNyxIdentity(raw){
  const src = (raw && typeof raw === 'object') ? raw : {};
  const next = Object.assign({}, NYX_IDENTITY_DEFAULTS);
  NYX_IDENTITY_GROUPS.forEach((group) => {
    const allowed = group.options.map(([key]) => key);
    if (allowed.includes(src[group.key])) next[group.key] = src[group.key];
  });
  return next;
}

function sanitizeGameIcons(raw){
  const src = (raw && typeof raw === 'object') ? raw : {};
  const next = {};
  SIM_GAMES.forEach((game) => {
    const safe = typeof nyxSafeImageSrc === 'function' ? nyxSafeImageSrc(src[game.key]) : String(src[game.key] || '');
    if (safe) next[game.key] = safe;
  });
  return next;
}

function sanitizeNyxLanguage(raw){
  const src = (raw && typeof raw === 'object') ? raw : {};
  const next = Object.assign({}, NYX_LANGUAGE_DEFAULTS);
  const allowed = NYX_LANGUAGE_OPTIONS.map(([key]) => key);
  Object.keys(NYX_LANGUAGE_DEFAULTS).forEach((key) => {
    if (allowed.includes(src[key])) next[key] = src[key];
  });
  return next;
}

function loadPengoSettings(){
  try {
    const raw = JSON.parse(localStorage.getItem(NYX_PENGO_SETTINGS_KEY) || '{}');
    return Object.assign({}, NYX_PENGO_DEFAULTS, raw, {
      animation: ['play', 'pause', 'stop'].includes(raw.animation) ? raw.animation : NYX_PENGO_DEFAULTS.animation,
      displayGames: Object.assign({}, NYX_PENGO_DISPLAY_DEFAULTS, raw.displayGames || {}),
      gameIcons: sanitizeGameIcons(raw.gameIcons),
      identity: sanitizeNyxIdentity(raw.identity),
      language: sanitizeNyxLanguage(raw.language),
      specialUnits: sanitizeSpecialUnits(raw.specialUnits),
      alwaysBeta: raw.alwaysBeta === true,
      energy: clampPengoNumber(raw.energy ?? NYX_PENGO_DEFAULTS.energy, 1, 69),
      spawn: clampPengoNumber(raw.spawn ?? NYX_PENGO_DEFAULTS.spawn, 0, 9999),
      sacrifice: clampPengoNumber(raw.sacrifice ?? NYX_PENGO_DEFAULTS.sacrifice, 0, 9999),
    });
  } catch (e) {
    return Object.assign({}, NYX_PENGO_DEFAULTS);
  }
}

const SETTINGS_IDENTITY_BY_GAME = { gi:'twin', hsr:'receptacle', zzz:'sibling', wuwa:'rover', ae:'endmin' };
const SETTINGS_SPECIAL_TOGGLES = {
  gi:[['aloy', 'Display Aloy']],
  hsr:[['archer', 'Display Archer'], ['saber', 'Display Saber'], ['rin_tohsaka', 'Display Rin Tohsaka'], ['gilgamesh', 'Display Gilgamesh']],
  wuwa:[['lucy', 'Display Lucy'], ['rebecca', 'Display Rebecca']],
};

function gameIconOptions(gameKey){
  const sim = SIM_GAMES.find((game) => game.key === gameKey);
  const cfg = GAME_REGISTRY[gameKey];
  const out = [];
  if (sim) out.push({ id:'default', name:'Default', icon:sim.icon, group:'Game', defaultIcon:true });
  if (cfg) {
    makeRoster(cfg).forEach((ch) => {
      if (ch.icon) out.push({ id:'char-' + ch.id, name:ch.name, icon:ch.icon, group:'Characters' });
      (ch.forms || []).forEach((form, i) => {
        if (form.icon) out.push({ id:'form-' + ch.id + '-' + i, name:form.label || form.name || ch.name, icon:form.icon, group:'Characters' });
      });
    });
  }
  const identityAssets = (typeof CM_IDENTITY_ASSETS !== 'undefined' && CM_IDENTITY_ASSETS[gameKey]) ? CM_IDENTITY_ASSETS[gameKey] : {};
  Object.keys(identityAssets).forEach((key) => {
    const row = identityAssets[key];
    if (row.icon) out.push({ id:'avatar-' + key, name:row.label || key, icon:row.icon, group:'Avatars' });
  });
  weaponItemsFor(gameKey).forEach((item) => {
    if (item.icon || item.art) out.push({ id:'weapon-' + item.name, name:item.name, icon:item.icon || item.art, group:'Equipment' });
  });
  const collections = (dbGame(gameKey)?.collections || []);
  collections.forEach((col) => {
    (col.items || []).forEach((item) => {
      const icon = item.icon || item.art;
      if (icon) out.push({ id:'db-' + col.key + '-' + (item.id || item.name), name:item.name, icon, group:col.title || col.key });
    });
  });
  const seen = new Set();
  return out.filter((item) => {
    const key = normalizeUnitName(item.name) + '|' + item.icon;
    if (!item.icon || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function GameIconPicker({ game, selected, onPick }){
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [editing, setEditing] = React.useState(false);
  const [pos, setPos] = React.useState(null);
  const triggerRef = React.useRef(null);
  const popRef = React.useRef(null);
  const options = React.useMemo(() => gameIconOptions(game.key), [game.key]);
  const activeIcon = (typeof nyxSafeImageSrc === 'function' ? nyxSafeImageSrc(selected) : selected) || game.icon;
  const query = q.trim().toLowerCase();
  const visible = options.filter((item) => !query || [item.name, item.group].join(' ').toLowerCase().includes(query));
  const updatePos = React.useCallback(() => {
    const node = triggerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const width = Math.min(560, Math.max(320, window.innerWidth - 32));
    const left = Math.max(16, Math.min(window.innerWidth - width - 16, rect.right - width));
    const desired = Math.min(720, window.innerHeight - 32);
    const belowTop = rect.bottom + 8;
    const aboveTop = rect.top - desired - 8;
    const top = belowTop + 320 <= window.innerHeight
      ? Math.max(16, belowTop)
      : Math.max(16, Math.min(rect.top - 16, aboveTop > 16 ? aboveTop : window.innerHeight - desired - 16));
    const maxHeight = Math.max(280, window.innerHeight - top - 16);
    setPos({ left, top, width, maxHeight });
  }, []);
  React.useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target) return;
      if (triggerRef.current && triggerRef.current.contains(target)) return;
      if (popRef.current && popRef.current.contains(target)) return;
      setOpen(false);
      setEditing(false);
    };
    updatePos();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [open, updatePos]);
  const pop = open ? (
    <div className="pm-icon-pop fixed" ref={popRef} style={pos ? { left:pos.left + 'px', top:pos.top + 'px', width:pos.width + 'px', maxHeight:pos.maxHeight + 'px' } : undefined}>
      <div className="pm-icon-search">
        <input value={q} placeholder="Search icons" spellCheck="false" onChange={(e) => setQ(e.target.value)} />
        <button type="button" onClick={() => setEditing((v) => !v)}>{editing ? 'Close Upload' : 'Upload Local'}</button>
      </div>
      {editing && (
        <NyxImageEditor
          label={'Upload ' + game.name + ' Icon'}
          aspect={1}
          outputWidth={512}
          outputHeight={512}
          shape="circle"
          onSave={(src) => { onPick(src); setEditing(false); setOpen(false); }}
          onCancel={() => setEditing(false)}
        />
      )}
      <div className="pm-icon-grid">
        {visible.map((item) => (
          <button type="button" key={item.id} title={item.group + ': ' + item.name}
                  className={item.icon === activeIcon ? 'on' : ''}
                  onClick={() => { onPick(item.defaultIcon ? null : item.icon); setOpen(false); setEditing(false); }}>
            <img src={item.icon} alt="" draggable="false" />
            <span>{item.name}</span>
          </button>
        ))}
        {visible.length === 0 && <div className="pm-icon-empty">No icons found.</div>}
      </div>
    </div>
  ) : null;
  return (
    <div className="pm-icon-picker">
      <button type="button" ref={triggerRef} className="pm-icon-trigger" onClick={() => setOpen((v) => !v)}
              aria-expanded={open} aria-label={'Select ' + game.name + ' icon'}>
        <img src={activeIcon} alt="" draggable="false" />
        <span>Select Game Icon</span>
      </button>
      {pop && ReactDOM.createPortal ? ReactDOM.createPortal(pop, document.body) : pop}
    </div>
  );
}

function PmSelect({ value, options, onChange, label }){
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const active = options.find(([key]) => key === value) || options[0];
  React.useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => {
      if (!ref.current || !ref.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="pm-select" ref={ref}>
      <button type="button" className="pm-select-trigger" aria-haspopup="listbox" aria-expanded={open}
              aria-label={label} onClick={() => setOpen((v) => !v)}>
        <span>{active?.[1] || value}</span><i>{'\u25BE'}</i>
      </button>
      {open && (
        <div className="pm-select-menu" role="listbox" aria-label={label}>
          {options.map(([key, optionLabel]) => (
            <button type="button" key={key} role="option" aria-selected={value === key}
                    className={value === key ? 'on' : ''}
                    onClick={() => { onChange(key); setOpen(false); }}>
              {optionLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PengoMenu({ settings, setSettings, inline }){
  const [collabOpen, setCollabOpen] = React.useState({});
  const [resetConfirm, setResetConfirm] = React.useState(null);
  const update = (patch) => setSettings((prev) => Object.assign({}, prev, patch));
  const identity = sanitizeNyxIdentity(settings.identity);
  const gameIcons = sanitizeGameIcons(settings.gameIcons);
  const specialUnits = sanitizeSpecialUnits(settings.specialUnits);
  const displayGames = Object.assign({}, NYX_PENGO_DISPLAY_DEFAULTS, settings.displayGames || {});
  const language = sanitizeNyxLanguage(settings.language);
  const setIdentity = (group, value) => update({ identity:Object.assign({}, identity, { [group]:value }) });
  const setLanguage = (gameKey, value) => update({ language:Object.assign({}, language, { [gameKey]:value }) });
  const opusCount = clampPengoNumber(settings.spawn ?? settings.sacrifice ?? NYX_PENGO_DEFAULTS.spawn, 0, 9999);
  const setOpusCount = (value) => {
    const next = clampPengoNumber(value, 0, 9999);
    update({ spawn:next, sacrifice:next });
  };
  const bumpOpusCount = (delta) => setOpusCount(opusCount + delta);
  const toggleDisplayGame = (key) => update({
    displayGames:Object.assign({}, displayGames, { [key]:displayGames[key] === false }),
  });
  const setGameIcon = (key, icon) => {
    const next = Object.assign({}, gameIcons);
    if (icon) next[key] = icon;
    else delete next[key];
    update({ gameIcons:next });
  };
  const toggleSpecial = (gameKey, unitKey) => update({
    specialUnits:Object.assign({}, specialUnits, {
      [gameKey]:Object.assign({}, specialUnits[gameKey] || {}, { [unitKey]:(specialUnits[gameKey] || {})[unitKey] === false }),
    }),
  });
  const setCollabAll = (gameKey, specials, enabled) => update({
    specialUnits:Object.assign({}, specialUnits, {
      [gameKey]:Object.assign({}, specialUnits[gameKey] || {}, Object.fromEntries(specials.map(([unitKey]) => [unitKey, enabled]))),
    }),
  });
  const askReset = (label, action) => setResetConfirm({ label, action });
  const confirmReset = () => {
    if (resetConfirm?.action) resetConfirm.action();
    setResetConfirm(null);
  };
  const resetAll = () => setSettings(Object.assign({}, NYX_PENGO_DEFAULTS, {
    displayGames:Object.assign({}, NYX_PENGO_DISPLAY_DEFAULTS),
    gameIcons:{},
    identity:Object.assign({}, NYX_IDENTITY_DEFAULTS),
    language:Object.assign({}, NYX_LANGUAGE_DEFAULTS),
    specialUnits:sanitizeSpecialUnits(NYX_SPECIAL_UNIT_DEFAULTS),
  }));
  const resetInterface = () => update({
    whispers: NYX_PENGO_DEFAULTS.whispers,
    animation: NYX_PENGO_DEFAULTS.animation,
    khaenriah: NYX_PENGO_DEFAULTS.khaenriah,
    alwaysBeta: NYX_PENGO_DEFAULTS.alwaysBeta,
  });
  const resetOpus = () => update({
    lapis: NYX_PENGO_DEFAULTS.lapis,
    energy: NYX_PENGO_DEFAULTS.energy,
    spawn: NYX_PENGO_DEFAULTS.spawn,
    sacrifice: NYX_PENGO_DEFAULTS.sacrifice,
  });
  const resetGame = (gameKey, groupKey, specials) => update({
    displayGames:Object.assign({}, displayGames, { [gameKey]:NYX_PENGO_DISPLAY_DEFAULTS[gameKey] }),
    gameIcons:Object.fromEntries(Object.entries(gameIcons).filter(([key]) => key !== gameKey)),
    identity:Object.assign({}, identity, { [groupKey]:NYX_IDENTITY_DEFAULTS[groupKey] }),
    language:Object.assign({}, language, { [gameKey]:NYX_LANGUAGE_DEFAULTS[gameKey] }),
    specialUnits:Object.assign({}, specialUnits, specials.length ? { [gameKey]:Object.assign({}, NYX_SPECIAL_UNIT_DEFAULTS[gameKey] || {}) } : {}),
  });
  const identityPreview = (gameKey, group, value) => {
    const assets = (typeof CM_IDENTITY_ASSETS !== 'undefined' && CM_IDENTITY_ASSETS[gameKey]) ? CM_IDENTITY_ASSETS[gameKey] : {};
    if (assets[value]?.icon) return assets[value].icon;
    const cfg = GAME_REGISTRY[gameKey];
    if (!cfg) return null;
    const protagonist = makeRoster(cfg).find((ch) => String(ch.id || '').includes(group.key) || String(ch.n || ch.name || '').toLowerCase() === String(group.label || '').toLowerCase());
    const forms = protagonist?.forms || [];
    const gender = (value === 'lumine' || value === 'stelle' || value === 'female' || value === 'belle') ? 'female' : (value === 'aether' || value === 'caelus' || value === 'male' || value === 'wise') ? 'male' : null;
    const form = forms.find((row) => row.gender === gender) || forms[0] || protagonist;
    return form?.icon || form?.circle || protagonist?.icon || protagonist?.circle || null;
  };
  const nextAnim = settings.animation === 'play' ? 'pause' : (settings.animation === 'pause' ? 'stop' : 'play');
  const animIcon = settings.animation === 'play' ? '\u25b6' : (settings.animation === 'pause' ? '\u23f8' : '\u25a0');
  return (
    <div className={'nyx-pengo-menu settings-board' + (inline ? ' as-tab' : '')}
         role={inline ? 'region' : 'dialog'}
         aria-label="Pengo settings"
         onClick={(e) => e.stopPropagation()}>
      <div className="settings-nyx-col">
        <section className="pm-section pm-opus">
          <h3>Magnum Opus Pengonis</h3>
          <button type="button" className="pm-row" data-tip="Power assistant Pengo On/Off"
                  onClick={() => update({ lapis:!settings.lapis })}>
            <span>Lapis Philosophorum</span><b className="pm-state">{settings.lapis ? 'On' : 'Off'}</b>
          </button>
          <label className="pm-slider" data-tip="Change how much energy is being poured into Pengo. Size change.">
            <span>Energy</span>
            <input type="range" min="1" max="69" value={settings.energy}
                   onChange={(e) => update({ energy:clampPengoNumber(e.target.value, 1, 69) })} />
            <input type="number" min="1" max="69" inputMode="numeric" value={settings.energy}
                   aria-label="Energy value"
                   onChange={(e) => update({ energy:clampPengoNumber(e.target.value, 1, 69) })}
                   onFocus={(e) => e.target.select()} />
          </label>
          <div className="pm-opus-actions">
            <button type="button" className="pm-action" data-tip="Summon more Pengo assistants to keep you company!">Summon</button>
            <button type="button" className="pm-action" data-tip="Every Pengo returns to the Void. There, they await your inevitable arrival, ready to serve once more.">Sacrifice</button>
            <div className="pm-stepper" aria-label="Pengo count">
              <button type="button" aria-label="Decrease Pengo count" onClick={() => bumpOpusCount(-1)}>-</button>
              <input type="text" inputMode="numeric" pattern="[0-9]*" value={opusCount}
                     aria-label="Pengo count" onChange={(e) => setOpusCount(e.target.value)} />
              <button type="button" aria-label="Increase Pengo count" onClick={() => bumpOpusCount(1)}>+</button>
            </div>
          </div>
          <button type="button" className="pm-reset" data-tip="Reset the Magnum Opus Pengonis to default" onClick={() => askReset('Magnum Opus Pengonis', resetOpus)}>Reset</button>
        </section>
        <section className="pm-section pm-interface">
          <h3>Interface</h3>
          <button type="button" className={'pm-row media ' + settings.animation}
                  data-tip="Turns On/Freezes/Off the rotating background"
                  onClick={() => update({ animation:nextAnim })}>
            <span>Background Animation</span><b className="pm-state">{animIcon}</b>
          </button>
          <button type="button" className="pm-row" data-tip="Turns floating background on/off"
                  onClick={() => update({ whispers:!settings.whispers })}>
            <span>Nyx Whispers</span><b className="pm-state">{settings.whispers ? 'On' : 'Off'}</b>
          </button>
          <button type="button" className="pm-row" data-tip="Change all fonts to the Ancient(Khaenri'ahn) Script"
                  onClick={() => update({ khaenriah:!settings.khaenriah })}>
            <span>Welcome to Khaenri'ah</span><b className="pm-state">{settings.khaenriah ? 'On' : 'Off'}</b>
          </button>
          <button type="button" className="pm-row" data-tip="Always show beta data where a beta channel exists"
                  onClick={() => update({ alwaysBeta:!settings.alwaysBeta })}>
            <span>Always Show Beta Content</span><b className="pm-state">{settings.alwaysBeta ? 'On' : 'Off'}</b>
          </button>
          <button type="button" className="pm-reset" data-tip="Reset the interface to default" onClick={() => askReset('Interface', resetInterface)}>Reset</button>
        </section>
        <section className="pm-section pm-reset-all">
          <h3>Reset</h3>
          <button type="button" className="pm-reset danger" data-tip="Reset every Nyx and game setting to default" onClick={() => askReset('all Nyx settings', resetAll)}>Reset All Settings</button>
        </section>
      </div>
      <div className="settings-games-col">
        {SIM_GAMES.map((game) => {
          const groupKey = SETTINGS_IDENTITY_BY_GAME[game.key];
          const group = NYX_IDENTITY_GROUPS.find((row) => row.key === groupKey);
          const specials = SETTINGS_SPECIAL_TOGGLES[game.key] || [];
          const gameOn = displayGames[game.key] !== false;
          const identityPreviewIcon = group ? identityPreview(game.key, group, identity[group.key]) : null;
          return (
            <section className="pm-section pm-game-section" key={game.key}>
              <div className="pm-game-head">
                <img src={gameIcons[game.key] || game.icon} alt="" draggable="false" />
                <h3>{game.name}</h3>
              </div>
              <button type="button" className="pm-row" onClick={() => toggleDisplayGame(game.key)}>
                <span>Display Game</span><b className="pm-state">{gameOn ? 'On' : 'Off'}</b>
              </button>
              <div className="pm-identity-row pm-icon-row">
                <span>Select Game Icon</span>
                <GameIconPicker game={game} selected={gameIcons[game.key]} onPick={(icon) => setGameIcon(game.key, icon)} />
              </div>
              {group && (
                <div className="pm-identity-row" data-tip={group.tip}>
                  <span className="pm-identity-label">
                    <b>{group.label}</b>
                    {identityPreviewIcon && (
                      <span className="pm-identity-preview" aria-label={group.label + ' icon preview'}>
                        <img src={identityPreviewIcon} alt="" draggable="false" />
                      </span>
                    )}
                  </span>
                  <div className="pm-identity-control">
                    <div className="pm-choice-set" role="group" aria-label={group.label}>
                      {group.options.map(([key, label]) => (
                        <button key={key} type="button" className={identity[group.key] === key ? 'on' : ''}
                                aria-pressed={identity[group.key] === key}
                                onClick={() => setIdentity(group.key, key)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div className="pm-identity-row pm-language-row">
                <span>Language</span>
                <PmSelect
                  label={`${game.name} language`}
                  value={language[game.key]}
                  options={NYX_LANGUAGE_OPTIONS}
                  onChange={(value) => setLanguage(game.key, value)}
                />
              </div>
              {specials.length > 0 && (
                <div className={'pm-special-list' + (collabOpen[game.key] ? ' open' : '')}>
                  {(() => {
                    const enabledCount = specials.filter(([unitKey]) => (specialUnits[game.key] || {})[unitKey] !== false).length;
                    const allOn = enabledCount === specials.length;
                    return (
                      <div className="pm-collab-control">
                        <button type="button" className={'pm-row pm-collab-master' + (allOn ? ' on' : '')}
                                aria-pressed={allOn}
                                onClick={() => setCollabAll(game.key, specials, !allOn)}>
                          <span>Collab Characters</span><b className="pm-state">{allOn ? 'On' : 'Off'}</b>
                        </button>
                        <button type="button" className="pm-collab-expand"
                                aria-expanded={!!collabOpen[game.key]}
                                onClick={() => setCollabOpen((prev) => Object.assign({}, prev, { [game.key]:!prev[game.key] }))}>
                          {collabOpen[game.key] ? 'Collapse' : 'Expand'}
                        </button>
                      </div>
                    );
                  })()}
                  {collabOpen[game.key] && specials.map(([unitKey, label]) => {
                    const on = (specialUnits[game.key] || {})[unitKey] !== false;
                    return (
                      <button type="button" key={unitKey} className={'pm-row pm-collab-unit' + (on ? ' on' : '')}
                              aria-pressed={on} onClick={() => toggleSpecial(game.key, unitKey)}>
                        <span>{label.replace(/^Display\s+/i, '')}</span><b className="pm-state">{on ? 'On' : 'Off'}</b>
                      </button>
                    );
                  })}
                </div>
              )}
              <button type="button" className="pm-reset" data-tip={'Reset ' + game.name + ' settings'} onClick={() => askReset(game.name + ' settings', () => resetGame(game.key, groupKey, specials))}>Reset {game.name}</button>
            </section>
          );
        })}
      </div>
      {resetConfirm && (
        <div className="pm-reset-confirm" role="dialog" aria-modal="true" aria-label={'Reset ' + resetConfirm.label}
             onMouseDown={(e) => { if (e.target === e.currentTarget) setResetConfirm(null); }}>
          <article>
            <b>Reset {resetConfirm.label}?</b>
            <p>This will restore this setting group to its default values.</p>
            <div>
              <button type="button" onClick={() => setResetConfirm(null)}>Cancel</button>
              <button type="button" className="primary" onClick={confirmReset}>Reset</button>
            </div>
          </article>
        </div>
      )}
    </div>
  );
}

function SettingsPane({ settings, setSettings }){
  return (
    <main className="gp-main-pane fill settings-pane">
      <PengoMenu settings={settings} setSettings={setSettings} inline />
    </main>
  );
}

function NyxChannelToggle({ gameKey }){
  const [channel, setChannel] = React.useState(() => cmLoadChannel(gameKey));
  const [confirmBeta, setConfirmBeta] = React.useState(false);
  React.useEffect(() => { setChannel(cmLoadChannel(gameKey)); }, [gameKey]);
  React.useEffect(() => {
    const onChannel = (event) => {
      const detail = event.detail || {};
      if (detail.key === gameKey && (detail.channel === 'live' || detail.channel === 'beta')) setChannel(detail.channel);
    };
    window.addEventListener('nyx:cm-channel-changed', onChannel);
    return () => window.removeEventListener('nyx:cm-channel-changed', onChannel);
  }, [gameKey]);
  const betaAvailable = cmHasBeta(gameKey);
  const alwaysBeta = (() => { try { return window.NYX_ALWAYS_BETA === true; } catch (e) { return false; } })();
  const betaSessionKey = 'nyx:beta-disclaimer:' + gameKey + ':v1';
  const commitPick = (ch) => {
    const next = ch === 'beta' && !betaAvailable ? 'live' : ch;
    setChannel(next);
    cmSaveChannel(gameKey, next);
    try { window.dispatchEvent(new CustomEvent('nyx:cm-channel-changed', { detail:{ key:gameKey, channel:next } })); } catch (e) {}
  };
  const pick = (ch) => {
    if (ch === 'live' && alwaysBeta) {
      try { window.dispatchEvent(new CustomEvent('nyx:set-always-beta', { detail:{ value:false, source:'channel-toggle' } })); } catch (e) {}
      commitPick('live');
      return;
    }
    if (ch === 'beta' && betaAvailable) {
      let accepted = false;
      try { accepted = sessionStorage.getItem(betaSessionKey) === '1'; } catch (e) {}
      if (!accepted) {
        setConfirmBeta(true);
        return;
      }
    }
    commitPick(ch);
  };
  const acceptBeta = () => {
    try { sessionStorage.setItem(betaSessionKey, '1'); } catch (e) {}
    setConfirmBeta(false);
    commitPick('beta');
  };
  const isBeta = betaAvailable && (channel === 'beta' || alwaysBeta);
  const toggle = () => pick(isBeta ? 'live' : 'beta');
  return (
    <React.Fragment>
      <div className={'cm-chan-switch' + (isBeta ? ' beta' : ' live') + (betaAvailable ? '' : ' no-beta')}
           role="group" aria-label="Data channel: Live or Beta" onClick={toggle}
           title={betaAvailable ? undefined : 'Beta data is not available for this game yet'}>
        <button type="button" className={'cm-chan-option live-option' + (!isBeta ? ' on' : '')} aria-pressed={!isBeta}
                title="Released, live-server data" onClick={(e) => { e.stopPropagation(); toggle(); }}>Live</button>
        <span className="cm-chan-medallion" aria-hidden="true">
          <img src="../assets/icon/pengoemote.png" alt="" draggable="false" />
        </span>
        <button type="button" className={'cm-chan-option beta-option' + (isBeta ? ' on' : '')} aria-pressed={isBeta}
                aria-disabled={!betaAvailable} onClick={(e) => { e.stopPropagation(); toggle(); }}
                title={betaAvailable ? 'Beta content may contain spoilers' : 'No beta data available yet'}>Beta</button>
      </div>
      {confirmBeta && (
        <div className="nyx-beta-confirm" role="dialog" aria-modal="true" aria-label="View Beta content">
          <div className="nyx-beta-card">
            <b>View Beta content?</b>
            <p>Are you sure you wish to view Beta content?<br />Please be aware there could be spoilers.</p>
            <div>
              <button type="button" onClick={() => setConfirmBeta(false)}>Cancel</button>
              <button type="button" className="primary" onClick={acceptBeta}>View Beta</button>
            </div>
          </div>
        </div>
      )}
    </React.Fragment>
  );
}

function NyxApp(){
  const initialRoute = routeFromLocation();
  const initialHistoryState = window.history.state || {};
  const initialKey = (initialRoute.key || (window.GP_PAGE && window.GP_PAGE.key) || 'nyx');
  const [activeKey, setActiveKey] = React.useState(initialKey);
  const [tab, setTab] = React.useState(() => coerceTabForKey(initialKey, initialRoute.tab || DEFAULT_TAB(initialKey)));
  const [materialSelection, setMaterialSelection] = React.useState(() => (
    initialRoute.character && initialKey !== 'nyx'
      ? { game:initialKey, name:initialRoute.character, slug:initialRoute.character,
          from:nyxCalendarHistoryOrigin(initialHistoryState, initialRoute.character), shareCard:initialRoute.shareCard }
      : null
  ));
  const [characterCustomize, setCharacterCustomize] = React.useState(null);
  // Which game the hub Timeline tab is showing. The URL wins on first load
  // (/nyx/timeline/hsr), otherwise the last game picked in a previous visit.
  const [timelineGame, setTimelineGame] = React.useState(() => initialRoute.timelineGame || loadTimelineGame());
  const timelineGameRef = React.useRef(timelineGame);
  React.useEffect(() => {
    timelineGameRef.current = timelineGame;
    saveTimelineGame(timelineGame);
  }, [timelineGame]);
  const [pengoSettings, setPengoSettings] = React.useState(loadPengoSettings);
  useCmGameVersion(activeKey);
  const previousAlwaysBetaRef = React.useRef(pengoSettings.alwaysBeta === true);
  // Sweep settings for the favourite Card/Hide controls removed 2026-08-09.
  React.useEffect(() => {
    nyxForgetRetiredFavouriteSettings(Object.keys(GAME_REGISTRY).concat('nyx'));
  }, []);

  const commitRoute = React.useCallback((key, nextTab, selection, opts) => {
    const safeKey = key || 'nyx';
    const safeTab = coerceTabForKey(safeKey, nextTab || 'overview');
    const game = timelineGameRef.current;
    const href = routePathFor(safeKey, safeTab, selection, game);
    try {
      // Keep a timeline share token while canonicalizing `genshin.html` to
      // `/genshin`. The timeline now lives on the hub's Timeline tab, so that
      // is where the token is preserved. Other/legacy hashes still clear when
      // the active tab changes.
      const timelineHash = safeKey === 'nyx' && safeTab === 'timeline'
        && /^#tl\.[0-9a-z]+\.\d+$/.test(String(location.hash || ''))
        ? location.hash : '';
      const query = new URLSearchParams(location.search);
      ['card', 'weapon', 'form', 'gender', 'channel'].forEach((name) => query.delete(name));
      const shareCard = selection && selection.game === safeKey ? selection.shareCard : null;
      if (shareCard) {
        query.append('card', '1');
        if (shareCard.weaponId != null && String(shareCard.weaponId).trim()) query.append('weapon', String(shareCard.weaponId));
        if (shareCard.variantKey != null && String(shareCard.variantKey).trim()) query.append('form', String(shareCard.variantKey));
        if (shareCard.gender != null && String(shareCard.gender).trim()) query.append('gender', String(shareCard.gender));
        query.append('channel', String(shareCard.channel || 'live'));
      }
      const search = query.toString();
      const target = href + (search ? '?' + search : '') + timelineHash;
      if (href && location.pathname + location.search + location.hash !== target) {
        const method = opts && opts.replace ? 'replaceState' : 'pushState';
        window.history[method](routeStateFor(safeKey, safeTab, selection), '', target);
      }
      document.title = ({ nyx:'Pengo: Nyx', gi:'Pengo: GI', hsr:'Pengo: HSR', zzz:'Pengo: ZZZ', wuwa:'Pengo: WW', ae:'Pengo: AKE' })[safeKey] || 'Pengo';
    } catch (e) {}
  }, []);

  React.useEffect(() => {
    const safeTab = coerceTabForKey(activeKey, tab === 'char-customize' ? 'mats' : tab);
    commitRoute(activeKey, safeTab, safeTab === 'mats' ? materialSelection : null, { replace:true });
  }, [activeKey, tab, materialSelection, timelineGame, commitRoute]);

  React.useEffect(() => {
    try { localStorage.setItem(NYX_PENGO_SETTINGS_KEY, JSON.stringify(pengoSettings)); } catch (e) {}
    const identity = sanitizeNyxIdentity(pengoSettings.identity);
    const language = sanitizeNyxLanguage(pengoSettings.language);
    const alwaysBeta = pengoSettings.alwaysBeta === true;
    const wasAlwaysBeta = previousAlwaysBetaRef.current === true;
    window.NYX_IDENTITY_PREFS = identity;
    window.NYX_LANGUAGE_PREFS = language;
    window.NYX_ALWAYS_BETA = alwaysBeta;
    window.NYX_SPECIAL_UNIT_PREFS = sanitizeSpecialUnits(pengoSettings.specialUnits);
    try { window.dispatchEvent(new CustomEvent('nyx:identity-changed', { detail:identity })); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('nyx:settings-changed', { detail:pengoSettings })); } catch (e) {}
    if (alwaysBeta) {
      SIM_GAMES.forEach((game) => {
        if (typeof cmHasBeta === 'function' && cmHasBeta(game.key)) {
          try { window.dispatchEvent(new CustomEvent('nyx:cm-channel-changed', { detail:{ key:game.key, channel:'beta' } })); } catch (e) {}
        }
      });
    } else if (wasAlwaysBeta) {
      SIM_GAMES.forEach((game) => {
        if (typeof cmHasBeta === 'function' && cmHasBeta(game.key)) {
          try { cmSaveChannel(game.key, 'live'); } catch (e) {}
          try { window.dispatchEvent(new CustomEvent('nyx:cm-channel-changed', { detail:{ key:game.key, channel:'live' } })); } catch (e) {}
        }
      });
    }
    previousAlwaysBetaRef.current = alwaysBeta;
    const root = document.documentElement;
    root.classList.toggle('nyx-whispers-off', !pengoSettings.whispers);
    root.classList.toggle('nyx-pattern-paused', pengoSettings.animation === 'pause');
    root.classList.toggle('nyx-pattern-off', pengoSettings.animation === 'stop');
    root.classList.toggle('nyx-khaenriah', !!pengoSettings.khaenriah);
  }, [pengoSettings]);

  React.useEffect(() => {
    const onAlwaysBeta = (event) => {
      const value = event?.detail?.value === true;
      setPengoSettings((prev) => prev.alwaysBeta === value ? prev : Object.assign({}, prev, { alwaysBeta:value }));
    };
    window.addEventListener('nyx:set-always-beta', onAlwaysBeta);
    return () => window.removeEventListener('nyx:set-always-beta', onAlwaysBeta);
  }, []);

  // reveal the page once the app has actually mounted. The page-level
  // background paints the instant the HTML is parsed (well before this bundle
  // downloads + runs), so without a cover you briefly see the bare backdrop at
  // full brightness before any content appears. A dark veil (body::before in
  // game-page-shared.css) sits on top until we flip html.nyx-app-ready here,
  // one frame after first commit so the bg-art layer below has settled.
  React.useEffect(() => {
    // Add directly (not via requestAnimationFrame): effects still run when the
    // tab is hidden, but rAF is throttled there — so an open-in-background tab
    // would otherwise stay dark until the CSS failsafe. The veil's own CSS
    // transition handles the smooth fade.
    document.documentElement.classList.add('nyx-app-ready');
  }, []);

  React.useEffect(() => mountNyxAmbientText(), []);

  React.useEffect(() => {
    const contentScrollTargets = [
      '.cm-pop-main',
      '.cm-pop.ledger .cm-pop-layout',
      '.cm-body',
      '.gt-results',
      '.db-scroll',
      '.db-grid',
      '.tcg-grid',
      '.tcg-detail-scroll',
      '.pot-grid',
      '.pot-detail-scroll',
      '.gp-overview-main',
      '.gp-overview-aside',
      '.gp-codes-scroll',
      '.overview-codes-scroll',
      '.gp-current-banner-row',
      '.settings-pane',
      '.nyx-pengo-menu.as-tab',
      '.gp-layout',
    ];
    const passiveScrollTargets = [
      '.gt-panel',
      '.gp-side-nav',
      '.gp-main-pane',
      '.pm-icon-grid',
      '.cm-weapon-options',
    ];
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const styles = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && styles.display !== 'none' && styles.visibility !== 'hidden';
    };
    const canScrollY = (el, deltaY) => {
      if (!el || !isVisible(el) || el.scrollHeight <= el.clientHeight + 1) return false;
      const overflowY = window.getComputedStyle(el).overflowY;
      if (overflowY === 'hidden' || overflowY === 'clip' || overflowY === 'visible') return false;
      if (deltaY > 0) return el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      if (deltaY < 0) return el.scrollTop > 1;
      return false;
    };
    const onWheel = (event) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.2) return;
      const target = event.target instanceof Element ? event.target : null;
      const bannerList = target?.closest('.gp-ovb-scroll');
      if (bannerList) {
        event.preventDefault();
        bannerList.scrollBy({ top:event.deltaY, left:0, behavior:'auto' });
        return;
      }
      if (Math.abs(event.deltaY) < 1) return;
      const closestContent = target && contentScrollTargets
        .map((selector) => target.closest(selector))
        .find((el) => canScrollY(el, event.deltaY));
      if (closestContent) {
        event.preventDefault();
        closestContent.scrollBy({ top:event.deltaY, left:0, behavior:'auto' });
        return;
      }
      if (target) {
        const passive = passiveScrollTargets
          .map((selector) => target.closest(selector))
          .find((el) => canScrollY(el, event.deltaY));
        if (passive && !passive.matches('.gp-side-nav')) return;
      }
      const candidates = contentScrollTargets
        .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
        .filter((el) => canScrollY(el, event.deltaY));
      const preferred = candidates.find((el) => el.matches('.cm-pop-main,.cm-pop.ledger .cm-pop-layout,.cm-body,.gt-results,.db-grid,.tcg-grid,.tcg-detail-scroll,.pot-grid,.pot-detail-scroll,.gp-overview-main,.gp-overview-aside,.gp-codes-scroll,.overview-codes-scroll,.settings-pane,.nyx-pengo-menu.as-tab')) || candidates[0];
      if (!preferred) return;
      event.preventDefault();
      preferred.scrollBy({ top:event.deltaY, left:0, behavior:'auto' });
    };
    window.addEventListener('wheel', onWheel, { passive:false, capture:true });
    return () => window.removeEventListener('wheel', onWheel, { capture:true });
  }, []);

  // background art crossfade between games (two viewport-level layers)
  const bgToggle = React.useRef(0);
  React.useEffect(() => {
    const cfg = activeKey === 'nyx' ? NYX_META : GAME_REGISTRY[activeKey];
    const layers = document.querySelectorAll('.nyx-bgart');
    if (!layers.length || !cfg) return;
    const next = layers[bgToggle.current % layers.length];
    const prev = layers[(bgToggle.current + 1) % layers.length];
    const scene = nyxBgScene(activeKey === 'nyx' ? 'index' : 'game');
    applyNyxBgElement(next, cfg.pageBg, scene);
    applyNyxBgElement(document.querySelector('.page-bg'), cfg.pageBg, scene);
    next.classList.add('on');
    if (prev) prev.classList.remove('on');
    bgToggle.current += 1;
  }, [activeKey]);

  // browser back/forward
  React.useEffect(() => {
    const onPop = () => {
      const next = routeFromLocation();
      const k = (next.key || (window.history.state && window.history.state.nyxKey) || 'nyx');
      setActiveKey(k);
      setTab(coerceTabForKey(k, next.tab || 'overview'));
      setCharacterCustomize(null);
      const state = window.history.state || {};
      setMaterialSelection(next.character && k !== 'nyx' ? { game:k, name:next.character, slug:next.character,
        from:nyxCalendarHistoryOrigin(state, next.character), shareCard:next.shareCard } : null);
      if (next.timelineGame) setTimelineGame(next.timelineGame);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const routeTab = (nextTab) => {
    const safeTab = coerceTabForKey(activeKey, nextTab === 'char-customize' ? 'mats' : nextTab);
    const keepMaterialSelection = safeTab === 'mats' && (nextTab === 'char-customize' || tab === 'char-customize');
    const nextSelection = keepMaterialSelection ? materialSelection : null;
    setTab(nextTab);
    if (nextTab !== 'char-customize') setCharacterCustomize(null);
    if (!nextSelection) setMaterialSelection(null);
    commitRoute(activeKey, safeTab, nextSelection);
  };

  const pickTimelineGame = (key) => {
    if (!key || key === timelineGame) return;
    timelineGameRef.current = key;
    setTimelineGame(key);
    commitRoute('nyx', 'timeline', null);
  };

  const switchGame = (key) => {
    if (key === activeKey) return;
    const nextTab = coerceTabForKey(key, tab === 'char-customize' ? 'mats' : tab);
    setActiveKey(key);
    setTab(nextTab);
    setCharacterCustomize(null);
    setMaterialSelection(null);
    commitRoute(key, nextTab, null);
  };

  const isNyx = activeKey === 'nyx';
  const cfg = isNyx ? NYX_META : GAME_REGISTRY[activeKey];
  // Overview renders the time control inside its right rail; the topbar copy
  // only remains for hub tabs that have no aside.
  const showTimePreference = isNyx && (tab === 'banners' || tab === 'events');
  const isGameOverview = !isNyx && tab === 'overview';
  const openMaterialPage = (game, name, options) => {
    const targetGame = (game && game !== 'nyx') ? game : activeKey;
    if (!targetGame || targetGame === 'nyx' || !name) return;
    const wanted = normalizeUnitName(name);
    const fullRoster = getCmRoster(targetGame) || [];
    const matching = fullRoster.find((ch) => [
      ch.n, ch.name, ch.rawName, ...(ch.aliases || []),
      ...((ch.forms || []).flatMap((form) => [form.n, form.name, form.rawName, form.label])),
    ].filter(Boolean).some((value) => normalizeUnitName(value) === wanted));
    if (matching && cmIsUpcomingOnly(matching)) return;
    setActiveKey(targetGame);
    setTab('mats');
    setCharacterCustomize(null);
    const origin = options?.from === 'calendar' || options?.from === 'nyx' || options?.from === 'overview'
      ? options.from
      : 'characters';
    const selection = { game:targetGame, name, from:origin };
    setMaterialSelection(selection);
    commitRoute(targetGame, 'mats', selection);
  };
  const openCharacterCustomize = (payload) => {
    const next = Object.assign({ game:activeKey, restoreScroll:0 }, payload || {});
    if (next.game && next.game !== activeKey) setActiveKey(next.game);
    setCharacterCustomize(next);
    setMaterialSelection(null);
    setTab('char-customize');
  };
  const selectMaterialCharacter = (game, ch) => {
    const name = ch && (ch.rawName || ch.baseName || ch.n || ch.name);
    if (!game || !name) return;
    const selection = { game, name };
    setMaterialSelection(selection);
    commitRoute(game, 'mats', selection);
  };
  const closeMaterialCharacter = (game) => {
    if (nyxShouldReturnToCalendar(materialSelection)) {
      window.history.back();
      return;
    }
    const targetGame = game || activeKey;
    // Opened from a banner on the Overview? Back goes there, not to the roster
    // (user 2026-08-09).
    if (materialSelection?.from === 'overview') {
      setMaterialSelection(null);
      setTab('overview');
      commitRoute(targetGame, 'overview', null);
      return;
    }
    setMaterialSelection(null);
    commitRoute(targetGame, 'mats', null);
  };

  return (
    <div className="nyx-screen" data-screen-label={cfg.name + ' page'}>
      <header className={'gp-topbar' + (showTimePreference ? ' has-time-preference' : '') + (isGameOverview ? ' is-game-overview' : '')} data-screen-label="Top bar">
        {/* Wordmark reads "Pengo" and stands alone: the living eye moved down
            under Settings in the side nav (user 2026-08-09). */}
        {/* The Pengo mascot sits behind the wordmark, facing right (user
            2026-08-09). Only the word itself is the link — the art and plate
            around it are decoration and do not navigate. */}
        <div className="tb-brand">
          <span className="plate" aria-hidden="true"></span>
          <span className="brand-mark">
            <img className="brand-pengo" src="../assets/icon/pengo.png" alt="" draggable="false" aria-hidden="true" />
            <a className="wm" href="/" title="Back to Worlds" aria-label="Back to the worlds index">Pengo</a>
          </span>
        </div>
        <div className="tb-center">
          <GPGameRail active={activeKey} onSwitch={switchGame} displayGames={pengoSettings.displayGames} gameIcons={pengoSettings.gameIcons} />
          {showTimePreference && <TimePreferenceControl gameKey={isNyx ? 'nyx' : activeKey} />}
        </div>
      </header>

      <div className="gp-corner">
        <div className="gp-corner-actions">
          {/* The living eye sits directly above the Ko-fi badge (user 2026-08-09). */}
          <NyxNavEye />
          <a className="gp-kofi" href="https://ko-fi.com/asyce" target="_blank" rel="noopener noreferrer" title="Ko-fi" aria-label="Ko-fi">
            <img src="../assets/icon/kofi-logo.png" alt="" draggable="false" />
          </a>
        </div>
        {!isNyx && !(materialSelection?.game === activeKey && materialSelection.shareCard) && <NyxChannelToggle gameKey={activeKey} />}
      </div>

      {isNyx
        ? <SimContent tab={tab} setTab={routeTab} onOpenMaterial={openMaterialPage} settings={pengoSettings} setSettings={setPengoSettings} />
        : <GameContent cfg={cfg} tab={tab} setTab={routeTab} onOpenMaterial={openMaterialPage} settings={pengoSettings} setSettings={setPengoSettings} characterCustomize={characterCustomize} setCharacterCustomize={setCharacterCustomize} materialSelection={materialSelection} setMaterialSelection={setMaterialSelection} onSelectMaterialCharacter={selectMaterialCharacter} onCloseMaterialCharacter={closeMaterialCharacter} />}
    </div>
  );
}

// inject the two crossfading background-art layers at viewport scale
(function(){
  if (document.querySelector('.nyx-bgart')) return;
  const base = document.querySelector('.page-bg');
  const wrap = document.createElement('div');
  wrap.className = 'nyx-bgwrap';
  wrap.innerHTML = '<div class="nyx-bgart"></div><div class="nyx-bgart"></div><div class="nyx-bgscrim"></div>';
  if (base && base.parentNode) base.parentNode.insertBefore(wrap, base.nextSibling);
  else document.body.insertBefore(wrap, document.body.firstChild);
  if (!document.querySelector('.nyx-rune-field')) {
    const runes = document.createElement('div');
    runes.className = 'nyx-rune-field';
    runes.setAttribute('aria-hidden', 'true');
    const stage = document.querySelector('.stage');
    const app = document.getElementById('app');
    const pattern = document.querySelector('.page-pattern');
    if (stage) stage.insertBefore(runes, app || stage.firstChild);
    else if (pattern && pattern.parentNode) pattern.parentNode.insertBefore(runes, pattern.nextSibling);
    else if (wrap.parentNode) wrap.parentNode.insertBefore(runes, wrap.nextSibling);
  }
})();

ReactDOM.createRoot(document.getElementById('app')).render(<NyxApp />);
