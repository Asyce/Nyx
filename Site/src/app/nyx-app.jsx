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
    forms: ch.forms || [],
  }));
}

function requestCmGame(key){
  if (!key || key === 'nyx') return Promise.resolve(null);
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
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
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
  if (!source || !source.length) return [{ id:cfg.key + '-main', name:cfg.charName, tag:'', art:cfg.art, icon:cfg.benchIcon }];
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
      rarity:ch.r,
      forms:ch.forms || [],
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

let GP_DRAG = null; // { zone:'card', idx }

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
  gi:{ name:'Primogems', icon:'../../Database/Nanoka/gi/assets/items/UI_ItemIcon_201.webp' },
  hsr:{ name:'Stellar Jade', icon:'../../Database/Nanoka/hsr/assets/items/900001.webp' },
  zzz:{ name:'Polychrome', icon:'../../Database/Nanoka/zzz/assets/items/IconCurrency.webp' },
  wuwa:{ name:'Astrite', icon:'../../Database/Nanoka/ww/assets/items/UIResources/Common/Image/IconA/T_IconA_zcpq_UI.webp' },
  ae:{ name:'Originium', icon:null },
  nyx:{ name:'Premium currency', icon:null },
};

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
    fns:['Character Materials','Artifact Sorter','Wish Tracker'],
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
    fns:['Character Materials','Relic Sorter','Warp Tracker'],
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
    fns:['Character Materials','Drive Disc Sorter','Signal Tracker'],
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
    fns:['Character Materials','Echo Sorter','Convene Tracker'],
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
    fns:['Character Materials','Gear Sorter','Headhunting Tracker'],
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

function bannerFreshness(key){
  const group = dbBannerGroup(key);
  return (group && group.freshness) || null;
}

const BANNER_FRESH_LABEL = {
  transition:  'Banner phase transition',
  stale:       'Banner data may be out of date',
  invalid:     'Current banner unconfirmed — refreshing',
  unavailable: 'Banner data unavailable — refreshing',
};

// Visible stale/incomplete warning. Renders nothing while data is fresh.
function BannerFreshnessNote({ fresh }){
  if (!fresh || !fresh.status || fresh.status === 'fresh') return null;
  const label = BANNER_FRESH_LABEL[fresh.status] || 'Banner data updating';
  const checked = fresh.checkedAt ? formatUpdated(fresh.checkedAt) : null;
  return (
    <div className={'gp-banner-fresh st-' + fresh.status} role="status">
      <span className="dot" aria-hidden="true"></span>
      <span className="lbl">{label}</span>
      {checked && <span className="chk">Last checked {checked}</span>}
    </div>
  );
}

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
      sub:bannerAbsTime(card.start) + (hasEnd ? ' \u2192 ' + bannerAbsTime(card.end) : ''),
      pct:null,
    };
  }
  if (hasStart || hasEnd) {
    const ref = hasEnd ? card.end : card.start;
    if (ref <= now) return { state:'ended', headline:'Ended ' + shortDuration(now - ref) + ' ago', sub:bannerAbsTime(ref), pct:null };
    return { state:card.status, headline:durationParts(ref - now) + ' left', sub:'Ends ' + bannerAbsTime(ref), pct:null };
  }
  return { state:card.status, headline:'Dates not confirmed yet', sub:null, pct:null };
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
  const art = ch.namecard || ch.art || match?.art || ch.imageFallback || ch.image || match?.icon || gameCfg.art;
  const icon = ch.icon || ch.image || ch.imageFallback || match?.icon || art;
  return {
    name,
    icon,
    art,
    rarity,
    // Badge only reflects a rarity we actually know (scrape or roster match) —
    // an unknown unit renders without one instead of a guessed "5★".
    badge:bannerRarityLabel(gameCfg.key, rarity),
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
      // Featured = top rank (or unknown rarity, which the scrape lists first);
      // anything confirmed lower-rank rides along in the "Also featured" row.
      featured:units.filter((u) => !u.rarity || u.rarity >= rank),
      others:units.filter((u) => u.rarity && u.rarity < rank),
      artPool:units.filter((u) => !u.rarity || u.rarity >= rank).map((u) => u.art).filter(Boolean),
    });
  };
  push(group.current, 'live');
  push(group.next, 'next');
  (group.upcoming || []).slice(0, 2).forEach((phase) => push(phase, 'upcoming'));
  return cards;
}

function BannerPhaseCard({ card, now, showGame }){
  const artPool = card.artPool || [];
  const [artIndex, setArtIndex] = React.useState(0);
  React.useEffect(() => {
    setArtIndex(0);
    if (artPool.length < 2) return undefined;
    const id = setInterval(() => setArtIndex((idx) => (idx + 1) % artPool.length), 4200);
    return () => clearInterval(id);
  }, [artPool.join('|')]);
  const art = artPool.length ? artPool[artIndex % artPool.length] : (card.game?.bg || card.game?.art);
  const when = bannerWhen(card, now);
  const meta = BANNER_STATUS_META[when.state] || BANNER_STATUS_META[card.status] || BANNER_STATUS_META.live;
  const gameIcon = card.game?.icon || GAME_REGISTRY[card.game?.key]?.benchIcon;
  return (
    <article className={'gp-oban st-' + meta.cls}>
      <div className="gp-oban-art" style={{ backgroundImage:bgUrl(art) }}></div>
      <div className="gp-oban-shade"></div>
      <div className="gp-oban-body">
        <div className="gp-oban-top">
          <span className={'gp-oban-status st-' + meta.cls}>{meta.label}</span>
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
            <span key={unit.name} className="gp-oban-unit" title={unit.name}>
              {unit.icon && <img src={unit.icon} alt="" draggable="false" />}
              <b>{unit.name}</b>
              {unit.badge && <em>{unit.badge}</em>}
            </span>
          ))}
        </div>
        {!!card.others.length && (
          <div className="gp-oban-supports">
            <span>Also featured</span>
            <div>
              {card.others.map((unit) => (
                <i key={unit.name} title={unit.name}>
                  {unit.icon && <img src={unit.icon} alt="" draggable="false" />}
                  <b>{unit.name}</b>
                </i>
              ))}
            </div>
          </div>
        )}
        <div className="gp-oban-foot">
          <b>{when.headline}</b>
          {when.sub && <span>{when.sub}</span>}
          {when.pct !== null && <i style={{ '--pct':when.pct + '%' }}></i>}
        </div>
      </div>
    </article>
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
  const fresh = isNyx ? null : bannerFreshness(cfg.key);
  const updated = window.NYX_DB && window.NYX_DB.banners && window.NYX_DB.banners.updated;
  if (!cards.length && !fresh) return null;
  return (
    <section className="gp-current-banners" aria-label="Current banners">
      <div className="gp-current-banners-head">
        <GPSec title="Current Banners" icon="../assets/decor/orbit_burst.png" style={{ flex:1, minWidth:0 }} />
        {updated && <span>Updated {formatUpdated(updated)}</span>}
      </div>
      <BannerFreshnessNote fresh={fresh} />
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
const DEFAULT_RESET_REGION = 'na';

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

function resetTimerRows(now, regionKey){
  const region = RESET_REGIONS[regionKey] || RESET_REGIONS[DEFAULT_RESET_REGION];
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

function customTimerKey(gameKey){
  return 'nyx:custom-reset-timers:' + (gameKey || 'nyx') + ':v1';
}

function loadCustomTimers(gameKey){
  try {
    const rows = JSON.parse(localStorage.getItem(customTimerKey(gameKey)) || '[]');
    return Array.isArray(rows)
      ? rows.filter((row) => row && row.label && Number.isFinite(Number(row.target))).map((row) => ({
        id:String(row.id || row.label + '-' + row.target),
        label:String(row.label).slice(0, 42),
        target:Number(row.target),
        recur:sanitizeRecur(row.recur),
      }))
      : [];
  } catch (e) {
    return [];
  }
}

function saveCustomTimers(gameKey, rows){
  try { localStorage.setItem(customTimerKey(gameKey), JSON.stringify(rows)); } catch (e) {}
}

function resetRegionStorageKey(gameKey){
  return 'nyx:reset-region:' + (gameKey || 'nyx') + ':v1';
}

function loadResetRegion(gameKey){
  try {
    const key = localStorage.getItem(resetRegionStorageKey(gameKey));
    return RESET_REGIONS[key] ? key : DEFAULT_RESET_REGION;
  } catch (e) {
    return DEFAULT_RESET_REGION;
  }
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
  return t;
}

function recurLabel(recur){
  if (!recur) return '';
  if (recur.type === 'monthly') return 'Monthly';
  if (recur.type === 'interval') {
    const d = recur.days;
    if (d % 7 === 0 && d >= 7) { const w = d / 7; return w === 1 ? 'Weekly' : 'Every ' + w + ' weeks'; }
    return d === 1 ? 'Daily' : 'Every ' + d + ' days';
  }
  return '';
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
  const pickRegion = (key) => {
    if (!RESET_REGIONS[key]) return;
    setRegionKey(key);
    try { localStorage.setItem(resetRegionStorageKey(gameKey), key); } catch (e) {}
  };
  const commitCustom = (fn) => {
    setCustom((prev) => {
      const next = fn(prev).slice(0, 12);
      saveCustomTimers(gameKey, next);
      return next;
    });
  };
  const buildRecur = () => {
    if (recurMode === 'monthly') return { type:'monthly' };
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
    commitCustom((prev) => [...prev, { id:String(Date.now()) + '-' + Math.random().toString(16).slice(2), label:clean, target:ts, recur }]);
    setLabel('');
    setTarget(datetimeLocalValue(Date.now() + RESET_MS.day));
    setRecurMode('once');
    setRecurEvery('1');
    setRecurUnit('day');
  };
  const removeTimer = (id) => commitCustom((prev) => prev.filter((row) => row.id !== id));
  const rows = resetTimerRows(now, regionKey);
  const activeRegion = RESET_REGIONS[regionKey] || RESET_REGIONS.local;
  return (
    <section className="gp-reset-panel" aria-label="Reset timers">
      <div className="gp-reset-head">
        <span>Reset Timers</span>
        <b>{activeRegion.short}</b>
      </div>
      <div className="gp-reset-regions" role="group" aria-label="Timer region">
        {Object.values(RESET_REGIONS).map((region) => (
          <button type="button" key={region.key} className={regionKey === region.key ? 'on' : ''} aria-pressed={regionKey === region.key} onClick={() => pickRegion(region.key)}>
            {region.short}
          </button>
        ))}
      </div>
      <div className="gp-reset-grid">
        {rows.map((row) => (
          <div className={'gp-reset-tile rt-' + row.key} key={row.key}>
            <span className="k">{row.label}</span>
            <span className="v">{durationParts(row.target - now)}</span>
          </div>
        ))}
      </div>
      {custom.length > 0 && (
        <div className="gp-reset-custom">
          {custom.map((row) => {
            const fireAt = nextRecurringTarget(row.target, row.recur, now);
            const rl = recurLabel(row.recur);
            return (
              <div className="gp-reset-tile custom" key={row.id}>
                <span className="k">{row.label}{rl && <em className="gp-reset-recur" title={'Recurs: ' + rl}>{'↻ ' + rl}</em>}</span>
                <span className="v">{fireAt > now ? durationParts(fireAt - now) : 'Expired'}</span>
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
function FavCardI({ ch, idx, w, hgt, dt, faded, h, art, manage, count }){
  const cardArt = overviewCardArt({ art }, ch, idx);
  const artStyle = {
    backgroundImage:bgUrl(cardArt || ch.art || art),
    ...(ch.overviewArtZoom ? { backgroundSize:Math.round(Number(ch.overviewArtZoom || 1) * 100) + '% auto' } : {}),
  };
  // When not managing, the card itself is the button that opens details (keyboard
  // operable). In manage mode the nested controls are the interactive elements,
  // so the card drops its button role to avoid nested-interactive markup.
  const openProps = manage ? {} : {
    role:'button', tabIndex:0,
    'aria-label':ch.name + (ch.tag ? ' — ' + ch.tag : ''),
    onKeyDown:navKeyDown(() => h.open(ch)),
  };
  return (
    <div className={'gp-fav bpf grab' + (dt ? ' dt' : '') + (faded ? ' faded' : '')}
         style={{ width:w + 'px', height:hgt + 'px' }}
         onClick={() => h.open(ch)}
         draggable="true"
         onDragStart={(e) => { GP_DRAG = { zone:'card', idx }; e.dataTransfer.effectAllowed = 'move'; }}
         onDragOver={(e) => { e.preventDefault(); h.over('card', idx); }}
         onDragLeave={() => h.leave('card', idx)}
         onDrop={(e) => { e.preventDefault(); h.drop('card', idx); }}
      onDragEnd={h.end} {...openProps}>
      <div className="artwrap">
        <div className="art" style={artStyle}></div>
        <div className="scrim"></div>
      </div>
      <div className="frame"></div>
      {manage && (
        <div className="ctl">
          <button type="button" className="th" title="Move left" aria-label={'Move ' + ch.name + ' left'}
                  disabled={idx === 0}
                  onClick={(e) => { e.stopPropagation(); h.move && h.move(idx, idx - 1); }}>{'‹'}</button>
          <button type="button" className="tr" title="Unpin favourite" aria-label={'Unpin ' + ch.name}
                  onClick={(e) => { e.stopPropagation(); h.remove(idx); }}>Unpin</button>
          <button type="button" className="th" title="Move right" aria-label={'Move ' + ch.name + ' right'}
                  disabled={count != null && idx >= count - 1}
                  onClick={(e) => { e.stopPropagation(); h.move && h.move(idx, idx + 1); }}>{'›'}</button>
        </div>
      )}
      <div className="nm">{ch.name}{ch.tag ? <span className="sub"> {ch.tag}</span> : null}</div>
    </div>
  );
}

function AddSlot({ hgt, dt, h }){
  return (
    <button type="button" className={'gp-add' + (dt ? ' dt' : '')}
         style={{ width:'72px', height:hgt + 'px' }}
         title="Pin a favourite \u2014 click, or drag an icon here"
         aria-label="Pin a favourite"
         onClick={h.add}
         onDragOver={(e) => { e.preventDefault(); h.over('add', 0); }}
         onDragLeave={() => h.leave('add', 0)}
         onDrop={(e) => { e.preventDefault(); h.drop('add', 0); }}>
      <span className="fr"></span>
      <span className="plus">+</span>
    </button>
  );
}

const PINNED_DEFAULTS = {
  gi:['Skirk','Furina','Mavuika','Yae Miko','Neuvillette'],
  hsr:['Castorice','Acheron','Firefly','Robin','Kafka'],
  zzz:['Yixuan','Miyabi','Zhu Yuan','Astra Yao','Evelyn'],
  wuwa:['Carlotta','Jinhsi','Changli','Camellya','Zani'],
  ae:['Perlica','Laevatain','Chen Qianyu','Ember','Wulfgard'],
  nyx:['Skirk','Castorice','Yixuan','Carlotta','Perlica'],
};

function pinnedStorageKey(key){
  return 'nyx:pinned-favourites:' + key + ':v1';
}

function favsCollapsedStorageKey(key){
  return 'nyx:pinned-favourites-collapsed:' + key + ':v1';
}

function pinnedSeed(cfg, roster){
  const names = PINNED_DEFAULTS[cfg.key] || [];
  const byName = new Map(roster.map((ch) => [String(ch.name || '').toLowerCase(), ch]));
  const chosen = names.map((name) => byName.get(name.toLowerCase())).filter(Boolean);
  return (chosen.length ? chosen : roster).slice(0, 5);
}

function loadPinnedCards(cfg, roster){
  try {
    const ids = JSON.parse(localStorage.getItem(pinnedStorageKey(cfg.key)) || '[]');
    const byId = new Map(roster.map((ch) => [ch.id, ch]));
    const saved = Array.isArray(ids) ? ids.map((id) => byId.get(id)).filter(Boolean) : [];
    if (saved.length) return saved.slice(0, 5);
  } catch (e) {}
  return pinnedSeed(cfg, roster);
}

function savePinnedCards(cfg, cards){
  try { localStorage.setItem(pinnedStorageKey(cfg.key), JSON.stringify(cards.map((ch) => ch.id))); } catch (e) {}
}

function Favourites({ cfg, onOpenMaterial, settings }){
  const cmVersion = useCmGameVersion(cfg.key);
  const [characterImagePrefs] = useNyxCharacterImagePrefs();
  const specialKey = JSON.stringify(settings?.specialUnits || {});
  const customKey = JSON.stringify(characterImagePrefs || {});
  const roster = React.useMemo(() => makeRoster(cfg, settings, characterImagePrefs), [cfg.key, cmVersion, specialKey, customKey]);
  const [cards, setCards] = React.useState(() => loadPinnedCards(cfg, roster));
  const [hov, setHov] = React.useState(null);
  const [manage, setManage] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(() => {
    try { return localStorage.getItem(favsCollapsedStorageKey(cfg.key)) === '1'; } catch (e) { return false; }
  });
  const [q, setQ] = React.useState('');
  const [w, setW] = React.useState(900);
  const ref = React.useRef(null);

  React.useEffect(() => {
    setCards(loadPinnedCards(cfg, roster));
    setHov(null);
    setManage(false);
    setQ('');
    try { setCollapsed(localStorage.getItem(favsCollapsedStorageKey(cfg.key)) === '1'); } catch (e) { setCollapsed(false); }
  }, [cfg.key, roster]);

  React.useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((en) => { if (en[0]) setW(en[0].contentRect.width); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const commitCards = (fn) => {
    setCards((prev) => {
      const next = fn(prev).slice(0, 5);
      savePinnedCards(cfg, next);
      return next;
    });
  };
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(favsCollapsedStorageKey(cfg.key), next ? '1' : '0'); } catch (e) {}
      if (next) setManage(false);
      return next;
    });
  };

  const GAP = 16, ADDW = 72;
  const n = cards.length;
  const qq = q.trim().toLowerCase();
  const match = (ch) => appMatchesSearch(ch, qq);
  const pinnedIds = new Set(cards.map((ch) => ch.id));
  const candidates = roster.filter((ch) => !pinnedIds.has(ch.id) && match(ch)).slice(0, qq ? 24 : 12);
  const isFull = cards.length >= 5;
  const hasAdd = manage && !collapsed && candidates.length > 0 && !isFull;
  const fixed = (hasAdd ? ADDW + GAP : 0) + (n > 1 ? (n - 1) * GAP : 0);
  let cardW = n > 0 ? Math.floor((w - fixed) / n) : 0;
  cardW = Math.max(152, Math.min(200, cardW));
  const cardH = Math.round(cardW * (608 / 288));
  const rowW = n * cardW + fixed;
  const scroll = rowW > w + 1;

  const h = {
    over: (zone, idx) => { if (GP_DRAG) setHov({ zone, idx }); },
    leave: (zone, idx) => setHov(p => (p && p.zone === zone && p.idx === idx) ? null : p),
    end: () => { GP_DRAG = null; setHov(null); },
    hide: (idx) => commitCards((cs) => cs.filter((_, i) => i !== idx)),
    remove: (idx) => commitCards((cs) => cs.filter((_, i) => i !== idx)),
    add: () => { if (!candidates.length) return; commitCards((cs) => [...cs, candidates[0]]); },
    open: (ch) => {
      if (!onOpenMaterial || !ch?.name) return;
      const game = ch.gameKey && ch.gameKey !== 'nyx' ? ch.gameKey : cfg.key;
      if (game && game !== 'nyx') onOpenMaterial(game, ch.name);
    },
    drop: (zone, idx) => {
      const d = GP_DRAG; GP_DRAG = null; setHov(null);
      if (!d) return;
      if (d.zone === zone && d.idx === idx) return;
      if (zone === 'card' && d.zone === 'card'){
        commitCards(cs => { const a = [...cs]; const [m] = a.splice(d.idx, 1); a.splice(idx, 0, m); return a; });
      }
    },
    // keyboard reorder (no dragging required)
    move: (from, to) => commitCards((cs) => {
      if (to < 0 || to >= cs.length || from === to) return cs;
      const a = [...cs]; const [m] = a.splice(from, 1); a.splice(to, 0, m); return a;
    }),
  };

  const isDt = (zone, idx) => hov && hov.zone === zone && hov.idx === idx;
  const addCandidate = (ch) => commitCards((cs) => {
    if (cs.some((c) => c.id === ch.id)) return cs;
    if (cs.length < 5) return [...cs, ch];
    return [...cs.slice(0, 4), ch];
  });

  return (
    <div ref={ref} className={'gp-favs game-' + cfg.key + (manage ? ' manage' : '') + (collapsed ? ' collapsed' : '')} style={{ width:'100%' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'16px' }}>
        <GPSec title="Pinned Favourites" icon="../assets/decor/orbit_burst.png" style={{ flex:1, minWidth:0 }} />
        {manage && !collapsed && <div className="gp-search-wrap">
          <div className="gp-search">
            <span className="ic"></span>
            <input value={q} placeholder="Search Characters" spellCheck="false"
                   onChange={(e) => setQ(e.target.value)} />
            {q !== '' && <button type="button" className="x" title="Clear" onClick={() => setQ('')}>{'\u2715'}</button>}
          </div>
        </div>}
        <GPHex small fixw on={!collapsed} onClick={toggleCollapsed}>
          <span>{collapsed ? 'Show' : 'Hide'}</span>
        </GPHex>
        <GPHex small fixw on={manage} onClick={() => { if (collapsed) toggleCollapsed(); setManage(m => !m); }}>
          <span>{manage ? 'Done' : 'Edit'}</span>
        </GPHex>
      </div>
      {!collapsed && (
        <div className={'gp-cardrow' + (scroll ? ' scroll' : '')}
             style={{ justifyContent: scroll ? 'flex-start' : 'center' }}>
          {cards.map((c, i) => (
            <FavCardI key={c.id} ch={c} idx={i} w={cardW} hgt={cardH} dt={isDt('card', i)} faded={!match(c)} h={h} art={cfg.art} manage={manage} count={cards.length} />
          ))}
          {hasAdd && <AddSlot hgt={cardH} dt={isDt('add', 0)} h={h} />}
        </div>
      )}
      {manage && !collapsed && (
        <div className="gp-fav-picker">
          {candidates.map((ch) => (
            <button
              type="button"
              key={ch.id}
              className={isFull ? 'replace' : ''}
              title={isFull ? 'Replace last pinned card' : 'Pin character'}
              onClick={() => addCandidate(ch)}
            >
              <span className="pick-ico">
                <img src={ch.icon || cfg.benchIcon} alt="" draggable="false" />
                {cfg.key === 'nyx' && appGameIcon(ch.gameKey) && <i><img src={appGameIcon(ch.gameKey)} alt="" draggable="false" /></i>}
              </span>
              <span className="pick-meta">
                <b>{ch.name}</b>
                {ch.tag && <em>{ch.tag}</em>}
              </span>
            </button>
          ))}
          {candidates.length === 0 && <div className="empty">No matching unpinned characters.</div>}
        </div>
      )}
    </div>
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
      {r.redeemUrl
        ? <a className="cc" href={r.redeemUrl} target="_blank" rel="noopener noreferrer" title="Open the redeem page">{r.code}</a>
        : <span className="cc no-link" title="No redeem link available">{r.code}</span>}
      <span className={'cc-reward' + (r.premium ? '' : ' plain')} tabIndex={0} aria-label="Show all rewards">
        {r.premium && (safeCurrency.icon
          ? <img src={safeCurrency.icon} alt={safeCurrency.name} draggable="false" />
          : <span className="cur-glyph"></span>)}
        {r.premium && amount && <b>{amount}</b>}
        {!r.premium && <span className="reward-text">{rewardParts(r.reward)[0] || 'Reward'}</span>}
        <span className="cc-reward-pop" role="tooltip"><RewardChips reward={r.reward} full /></span>
      </span>
      <button type="button" className="cc-copy"
              title="Copy" aria-label={'Copy ' + r.code} onClick={() => onCopy(r.code)}>
        <span className="i-copy"></span>
      </button>
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

  const rows = sourceCodes.map((c, i) => ({
    ...c,
    _i:i,
    st:redeemed.has(c.code) ? 'redeemed' : copiedCode === c.code ? 'copied' : 'new',
  }));
  // redeemed codes sink to the bottom of their group (stable order otherwise)
  const sortRedeemedLast = (a, b) => {
    const ra = a.st === 'redeemed' ? 1 : 0;
    const rb = b.st === 'redeemed' ? 1 : 0;
    return ra - rb || a._i - b._i;
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
          <span className="gl">{kind === 'premium' ? currency.name : 'Other rewards'}</span>
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

/* shared overview right rail */
function OverviewAside({ cfg }){
  return (
    <aside className="gp-overview-aside">
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

function SimCodeCard({ code, reward, redeemUrl, isNew, gameKey }){
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
  const row = { code, reward, redeemUrl, st, premium:String(reward || '').toLowerCase().includes('primogem') || String(reward || '').toLowerCase().includes('stellar jade') || String(reward || '').toLowerCase().includes('polychrome') || String(reward || '').toLowerCase().includes('astrite') || String(reward || '').toLowerCase().includes('originium') };
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

function AllCodesView(){
  const [premiumOnly, setPremiumOnly] = React.useState(true);
  const meta = PREMIUM_CODE_META.nyx;
  const allCodes = Object.values(ALL_GAME_CODES).flat();
  const hasPremiumRows = allCodes.some((c) => c.premium);
  const filterActive = premiumOnly && hasPremiumRows;
  const visibleCount = allCodes.filter((c) => !filterActive || c.premium).length;
  return (
    <div style={{ minWidth:0, minHeight:0, display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'14px' }}>
        <GPSec title="All Redemption Codes" style={{ flex:1, minWidth:0 }} />
        <label className={'code-filter wide' + (filterActive ? ' on' : '') + (!hasPremiumRows ? ' disabled' : '')}>
          <input type="checkbox" checked={filterActive} disabled={!hasPremiumRows} onChange={(e) => setPremiumOnly(e.target.checked)} />
          <span className="cur-glyph"></span>
          <span className="code-filter-text"><b>{meta.name}</b><small>{visibleCount}/{allCodes.length}</small></span>
        </label>
        <span className="sim-updated">Updated {CODES_UPDATED}</span>
      </div>
      <div className="gp-codes-scroll" style={{ flex:1, minHeight:0, marginTop:'16px', gap:'26px' }}>
        {SIM_GAMES.map(g => (
          <div key={g.key} className="sim-codegroup">
            <div className="sim-grouphd">
              <img src={g.icon} alt="" />
              <span className="gn">{g.name}</span>
              <span className="rule"></span>
            </div>
            <div className="sim-codegrid">
              {ALL_GAME_CODES[g.key].filter((c) => !filterActive || c.premium).map((c, i) => (
                <SimCodeCard key={c.code} code={c.code} reward={c.reward} redeemUrl={c.redeemUrl} isNew={i === 0} gameKey={g.key} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AllBannersView(){
  const now = useNowTick(1000);
  // Shares the persisted region with the overview reset panel, so picking a
  // server here and there stays consistent.
  const [regionKey, setRegionKey] = React.useState(() => loadResetRegion('nyx'));
  const pickRegion = (key) => {
    if (!RESET_REGIONS[key]) return;
    setRegionKey(key);
    try { localStorage.setItem(resetRegionStorageKey('nyx'), key); } catch (e) {}
  };
  const region = RESET_REGIONS[regionKey] || RESET_REGIONS[DEFAULT_RESET_REGION];
  const updated = window.NYX_DB && window.NYX_DB.banners && window.NYX_DB.banners.updated;
  const groups = React.useMemo(() => SIM_GAMES.map((g) => ({
    game:g,
    cards:gameBannerCards(GAME_REGISTRY[g.key], g),
    fresh:bannerFreshness(g.key),
  })), []);
  return (
    <div style={{ minWidth:0, minHeight:0, display:'flex', flexDirection:'column' }}>
      <div className="sim-banhd">
        <GPSec title="All Banners" style={{ flex:1, minWidth:0 }} />
        <div className="sim-regions">
          {['eu','na','asia'].map((key) => (
            <button type="button" key={key} className={regionKey === key ? 'on' : ''} onClick={() => pickRegion(key)}>
              {RESET_REGIONS[key].short}
            </button>
          ))}
        </div>
        <div className="sim-resets">
          <div className="rs"><span className="k">Daily reset</span><span className="v">{durationParts(nextDailyReset(now, region) - now)}</span></div>
          <div className="rs"><span className="k">Weekly reset</span><span className="v">{durationParts(nextWeeklyReset(now, region) - now)}</span></div>
        </div>
      </div>
      {updated && <span className="sim-updated" style={{ marginTop:'-8px', marginBottom:'10px' }}>Banner data updated {formatUpdated(updated)}</span>}
      <div className="gp-codes-scroll" style={{ flex:1, minHeight:0, gap:'26px' }}>
        {groups.map(({ game:g, cards, fresh }) => (
          <section key={g.key} className="sim-bangroup" aria-label={g.name + ' banners'}>
            <div className="sim-grouphd">
              <img src={g.icon} alt="" />
              <span className="gn">{g.name}</span>
              <span className="rule"></span>
            </div>
            <BannerFreshnessNote fresh={fresh} />
            {cards.length
              ? <div className="gp-current-banner-row">
                  {cards.map((card) => (
                    <div className="gp-current-banner-cell" key={card.key}>
                      <BannerPhaseCard card={card} now={now} />
                    </div>
                  ))}
                </div>
              : <div className="gp-oban-empty">No confirmed banners right now.</div>}
          </section>
        ))}
      </div>
    </div>
  );
}

function CollectionLibrary({ game }){
  const gameData = (window.NYX_DB && window.NYX_DB.games && window.NYX_DB.games[game]) || null;
  const collections = (gameData && gameData.collections) || [];
  const [active, setActive] = React.useState(collections[0] ? collections[0].key : '');
  const [q, setQ] = React.useState('');

  React.useEffect(() => {
    setActive(collections[0] ? collections[0].key : '');
    setQ('');
  }, [game]);

  const cur = collections.find(c => c.key === active) || collections[0];
  const qq = q.trim().toLowerCase();
  const items = cur ? cur.items.filter(item => {
    const hay = [item.name, item.kind, item.text, ...Object.values(item.fields || {})].join(' ').toLowerCase();
    return !qq || hay.includes(qq);
  }) : [];

  if (!cur) {
    return (
      <div className="db-lib">
        <GPSec title="Database Library" />
        <div className="db-empty">No database collections found.</div>
      </div>
    );
  }

  return (
    <div className="db-lib">
      <div className="db-lib-head">
        <GPSec title="Database Library" style={{ flex:1, minWidth:0 }} />
        <div className="gp-search">
          <span className="ic"></span>
          <input value={q} placeholder="Search Database" spellCheck="false" onChange={(e) => setQ(e.target.value)} />
          {q !== '' && <button type="button" className="x" title="Clear" onClick={() => setQ('')}>{'\u2715'}</button>}
        </div>
      </div>
      <div className="db-tabs">
        {collections.map(c => (
          <button type="button" key={c.key} className={c.key === cur.key ? 'on' : ''} onClick={() => setActive(c.key)}>
            <span>{c.title}</span><b>{c.count}</b>
          </button>
        ))}
      </div>
      <div className="db-grid">
        {items.map(item => <CollectionCard key={item.id || item.name} item={item} />)}
      </div>
      {items.length === 0 && <div className="db-empty">No records match your search.</div>}
    </div>
  );
}

function CollectionCard({ item }){
  const fields = Object.entries(item.fields || {}).filter(([, v]) => {
    if (v === undefined || v === null || v === '') return false;
    return !(Array.isArray(v) && v.length === 0);
  }).slice(0, 4);
  return (
    <article className="db-card" title={item.name}>
      <div className="db-art">
        {item.art ? <img src={item.art} alt="" draggable="false" /> : <span>{simInitials(item.name)}</span>}
      </div>
      <div className="db-meta">
        <div className="db-name">{item.name}</div>
        <div className="db-fields">
          {fields.map(([k, v]) => (
            <span key={k}>{String(Array.isArray(v) ? v.join(' / ') : v)}</span>
          ))}
        </div>
        {item.text && <p>{item.text}</p>}
      </div>
    </article>
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
  const [activeCard, setActiveCard] = React.useState(null);
  const [restoreScroll, setRestoreScroll] = React.useState(0);
  const gridRef = React.useRef(null);
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
  const filters = [
    ['all', 'All Cards', cards.length],
    ['character', 'Character', (tcg.characterCards || []).length],
    ['action', 'Action', (tcg.otherCards || []).length],
  ];
  const tagTotal = tagFilters.reduce((sum, [, count]) => sum + count, 0);
  const openCard = (card) => {
    setRestoreScroll(gridRef.current ? gridRef.current.scrollTop : 0);
    setActiveCard(card);
  };
  const closeCard = () => {
    setActiveCard(null);
    setTimeout(() => {
      if (gridRef.current) gridRef.current.scrollTop = restoreScroll;
    }, 0);
  };
  if (activeCard) {
    return (
      <div className="tcg-view tcg-detail-page" data-screen-label="TCG card detail page">
        <div className="tcg-detail-toolbar">
          <button type="button" className="tcg-back" onClick={closeCard}>
            <span>{'\u2039'}</span><b>Back to TCG Cards</b>
          </button>
          <div>
            <span>{activeCard.type || (activeCard.kind === 'character' ? 'Character' : 'Action')}</span>
            <b>{activeCard.id}</b>
          </div>
        </div>
        <div className="tcg-detail-scroll">
          <article className="tcg-detail-panel">
            <div className="tcg-detail-art">{activeCard.art ? <img src={activeCard.art} alt="" draggable="false" /> : <span>{simInitials(activeCard.name)}</span>}</div>
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
        <GPSec title="Genius Invokation TCG" style={{ flex:1, minWidth:0 }} />
        <div className="gp-search">
          <span className="ic"></span>
          <input value={q} placeholder="Search TCG Cards" spellCheck="false" onChange={(e) => setQ(e.target.value)} />
          {q !== '' && <button type="button" className="x" title="Clear" onClick={() => setQ('')}>{'\u2715'}</button>}
        </div>
      </div>
      <div className="tcg-filter-block">
        <span>CARD TYPE</span>
        <div className="tcg-tabs">
          {filters.map(([key, label, count]) => (
            <button type="button" key={key} className={kind === key ? 'on' : ''} onClick={() => setKind(key)}>
              <span>{label}</span><b>{count}</b>
            </button>
          ))}
        </div>
      </div>
      {tagFilters.length > 0 && (
        <div className="tcg-filter-block">
          <span>TAGS</span>
          <div className="tcg-tabs tcg-category-tabs" aria-label="TCG card tags">
            <button type="button" className={tag === 'all' ? 'on' : ''} onClick={() => setTag('all')}>
              <span>All</span><b>{tagTotal}</b>
            </button>
            {tagFilters.map(([value, count]) => (
              <button type="button" key={value} className={tag === value ? 'on' : ''} onClick={() => setTag(value)}>
                <span>{value}</span><b>{count}</b>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="tcg-grid" ref={gridRef}>
        {visible.map((card) => (
          <button type="button" className={'tcg-card kind-' + card.kind} key={card.kind + '-' + card.id}
                  onClick={() => openCard(card)}>
            <div className="tcg-art">
              {card.art ? <img src={card.art} alt="" draggable="false" /> : <span>{simInitials(card.name)}</span>}
            </div>
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
  const [category, setCategory] = React.useState('all');
  const [sub, setSub] = React.useState('all');
  const [q, setQ] = React.useState('');
  const [activeItem, setActiveItem] = React.useState(null);
  const [restoreScroll, setRestoreScroll] = React.useState(0);
  const gridRef = React.useRef(null);
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
  const subTotal = subFilters.reduce((sum, [, count]) => sum + count, 0);
  const openItem = (item) => {
    setRestoreScroll(gridRef.current ? gridRef.current.scrollTop : 0);
    setActiveItem(item);
  };
  const closeItem = () => {
    setActiveItem(null);
    setTimeout(() => {
      if (gridRef.current) gridRef.current.scrollTop = restoreScroll;
    }, 0);
  };
  if (!items.length) {
    return (
      <div className="pot-view">
        <div className="pot-head">
          <GPSec title="Serenitea Pot" style={{ flex:1, minWidth:0 }} />
        </div>
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
          <button type="button" className="pot-back" onClick={closeItem}>
            <span>{'‹'}</span><b>Back to Furnishings</b>
          </button>
          <div>
            <span>{activeItem.category}</span>
            <b>{activeItem.id}</b>
          </div>
        </div>
        <div className="pot-detail-scroll">
          <article className="pot-detail-panel">
            <div className="pot-detail-art">{activeItem.art ? <img src={activeItem.art} alt="" draggable="false" /> : <span>{simInitials(activeItem.name)}</span>}</div>
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
        <GPSec title="Serenitea Pot" style={{ flex:1, minWidth:0 }} />
        <div className="gp-search">
          <span className="ic"></span>
          <input value={q} placeholder="Search Furnishings" spellCheck="false" onChange={(e) => setQ(e.target.value)} />
          {q !== '' && <button type="button" className="x" title="Clear" onClick={() => setQ('')}>{'✕'}</button>}
        </div>
      </div>
      <div className="pot-filter-block">
        <span>CATEGORY</span>
        <div className="pot-tabs pot-category-tabs">
          {categories.map(([key, label, count]) => (
            <button type="button" key={key} className={category === key ? 'on' : ''} onClick={() => setCategory(key)}>
              <span>{label}</span><b>{count}</b>
            </button>
          ))}
        </div>
      </div>
      {subFilters.length > 0 && (
        <div className="pot-filter-block">
          <span>TYPE</span>
          <div className="pot-tabs pot-category-tabs" aria-label="Furnishing types">
            <button type="button" className={sub === 'all' ? 'on' : ''} onClick={() => setSub('all')}>
              <span>All</span><b>{subTotal}</b>
            </button>
            {subFilters.map(([value, count]) => (
              <button type="button" key={value} className={sub === value ? 'on' : ''} onClick={() => setSub(value)}>
                <span>{value}</span><b>{count}</b>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="pot-grid" ref={gridRef}>
        {visible.map((item) => (
          <button type="button" className="pot-card" key={item.id} onClick={() => openItem(item)}>
            <div className="pot-art">
              {item.art ? <img src={item.art} alt="" draggable="false" loading="lazy" /> : <span>{simInitials(item.name)}</span>}
              {Number.isFinite(Number(item.rarity)) && item.rarity > 0 && <i className="pot-rar">{item.rarity + '★'}</i>}
            </div>
            <div className="pot-meta">
              <b>{item.name}</b>
              <span>{(item.subtypes && item.subtypes[0]) || item.category}</span>
            </div>
          </button>
        ))}
      </div>
      {visible.length === 0 && <div className="db-empty">No furnishings match your search.</div>}
    </div>
  );
}

/* ================= content panels ================= */
// Keyboard activation for role="button" nav rows (Enter / Space).
function navKeyDown(fn){
  return (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); fn(); } };
}

function GameContent({ cfg, tab, setTab, onOpenMaterial, settings, setSettings, characterCustomize, setCharacterCustomize, materialSelection, setMaterialSelection, onSelectMaterialCharacter, onCloseMaterialCharacter }){
  const fns = cfg.fns || ['Character Materials','Artifact Sorter','Wish Tracker'];
  const hasTcg = cfg.key === 'gi';
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
  // G13: the section list the Character-Materials header icon-dropdown switches between.
  const sectionKey = (f) => /tracker$/i.test(f) ? 'tracker' : /^character materials$/i.test(f) ? 'mats' : 'library';
  const sections = [{ key:'overview', label:'Overview' }, ...fns.map((f) => ({ key:sectionKey(f), label:f })), ...(hasTcg ? [{ key:'tcg', label:'TCG' }, { key:'pot', label:'Serenitea Pot' }] : []), { key:'settings', label:'Settings' }];
  return (
    <div className={'gp-layout' + (tab === 'overview' ? ' has-aside' : '')}>
      <nav className="gp-side-nav" aria-label="Tools">
        <div className={'gp-fn-row click' + (tab === 'overview' ? ' on' : '')}
             role="button" tabIndex={0} aria-current={tab === 'overview' ? 'page' : undefined}
             onClick={() => setTab('overview')} onKeyDown={navKeyDown(() => setTab('overview'))}>
          <span className="dia" aria-hidden="true"></span><span>Overview</span>
        </div>
        {fns.map(f => {
          const isTracker = /tracker$/i.test(f);
          const isMats = /^character materials$/i.test(f);
          const key = isTracker ? 'tracker' : isMats ? 'mats' : 'library';
          return (
            <div key={f} className={'gp-fn-row click' + (tab === key ? ' on' : '')}
                 role="button" tabIndex={0} aria-current={tab === key ? 'page' : undefined}
                 onClick={() => setTab(key)} onKeyDown={navKeyDown(() => setTab(key))}>
              <span className="dia" aria-hidden="true"></span><span>{f}</span><span className="go">{'\u203A'}</span>
            </div>
          );
        })}
        {hasTcg && (
          <div className={'gp-fn-row click' + (tab === 'tcg' ? ' on' : '')}
               role="button" tabIndex={0} aria-current={tab === 'tcg' ? 'page' : undefined}
               onClick={() => setTab('tcg')} onKeyDown={navKeyDown(() => setTab('tcg'))}>
            <span className="dia" aria-hidden="true"></span><span>TCG</span><span className="go">{'\u203A'}</span>
          </div>
        )}
        {hasTcg && (
          <div className={'gp-fn-row click' + (tab === 'pot' ? ' on' : '')}
               role="button" tabIndex={0} aria-current={tab === 'pot' ? 'page' : undefined}
               onClick={() => setTab('pot')} onKeyDown={navKeyDown(() => setTab('pot'))}>
            <span className="dia" aria-hidden="true"></span><span>Serenitea Pot</span><span className="go">{'\u203A'}</span>
          </div>
        )}
        <div className={'gp-fn-row click' + (tab === 'settings' ? ' on' : '')}
             role="button" tabIndex={0} aria-current={tab === 'settings' ? 'page' : undefined}
             onClick={() => setTab('settings')} onKeyDown={navKeyDown(() => setTab('settings'))}>
          <span className="dia" aria-hidden="true"></span><span>Settings</span><span className="go">{'\u203A'}</span>
        </div>
      </nav>

      {tab === 'overview' && (
        <main className="gp-main-pane gp-overview-main">
          <Favourites key={cfg.key} cfg={cfg} onOpenMaterial={onOpenMaterial} settings={settings} />
          <CurrentBannerStrip cfg={cfg} />
        </main>
      )}
      {tab === 'mats' && (
        <main className="gp-main-pane fill">
          <CharMaterials
            inline
            game={cfg.key}
            selectedName={materialSelection?.game === cfg.key ? materialSelection.name : null}
            selectedFrom={materialSelection?.game === cfg.key ? materialSelection.from : null}
            pageTab={tab}
            onPageTab={setTab}
            sections={sections}
            onCustomizeCharacter={openCharacterCustomize}
            onSelectCharacter={(ch) => onSelectMaterialCharacter && onSelectMaterialCharacter(cfg.key, ch)}
            onSelectedClose={() => {
              const fromOverview = materialSelection?.game === cfg.key && materialSelection?.from === 'overview';
              if (setMaterialSelection) setMaterialSelection(null);
              if (fromOverview) setTab('overview');
              else if (onCloseMaterialCharacter) onCloseMaterialCharacter(cfg.key);
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
      {tab === 'library' && (
        <main className="gp-main-pane fill">
          <CollectionLibrary key={cfg.key} game={cfg.key} />
        </main>
      )}
      {tab === 'tcg' && (
        <main className="gp-main-pane fill">
          <GenshinTcgView />
        </main>
      )}
      {tab === 'pot' && (
        <main className="gp-main-pane fill">
          <GenshinPotView />
        </main>
      )}
      {tab === 'settings' && <SettingsPane settings={settings} setSettings={setSettings} />}

      {tab === 'overview' && <OverviewAside cfg={cfg} />}
    </div>
  );
}

function SimContent({ tab, setTab, onOpenMaterial, settings, setSettings }){
  const NAV = [
    { key:'overview', label:'Overview' },
    { key:'pulls',    label:'Pull Overview' },
    { key:'codes',    label:'All Redemption Codes' },
    { key:'banners',  label:'All Banners' },
    { key:'settings', label:'Settings' },
  ];
  return (
    <div className={'gp-layout' + (tab === 'overview' ? ' has-aside' : '')}>
      <nav className="gp-side-nav" aria-label="Sections">
        {NAV.map(n => (
          <div key={n.key} className={'gp-fn-row click' + (tab === n.key ? ' on' : '')}
               role="button" tabIndex={0} aria-current={tab === n.key ? 'page' : undefined}
               onClick={() => setTab(n.key)} onKeyDown={navKeyDown(() => setTab(n.key))}>
            <span>{n.label}</span><span className="go">{'\u203A'}</span>
          </div>
        ))}
      </nav>
      {tab === 'overview' && (
        <main className="gp-main-pane gp-overview-main">
          <Favourites key="nyx" cfg={NYX_META} onOpenMaterial={onOpenMaterial} settings={settings} />
          <CurrentBannerStrip cfg={NYX_META} />
        </main>
      )}
      {tab === 'pulls' && <main className="gp-main-pane fill"><PullsOverview /></main>}
      {tab === 'codes' && <main className="gp-main-pane fill"><AllCodesView /></main>}
      {tab === 'banners' && <main className="gp-main-pane fill"><AllBannersView /></main>}
      {tab === 'settings' && <SettingsPane settings={settings} setSettings={setSettings} />}
      {tab === 'overview' && <OverviewAside cfg={NYX_META} />}
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
  library:'library',
  tracker:'tracker',
  tcg:'tcg',
  pot:'serenitea-pot',
  settings:'settings',
};
const NYX_TAB_TO_ROUTE = {
  overview:'',
  pulls:'pulls',
  codes:'codes',
  banners:'banners',
  settings:'settings',
};
const ROUTE_TO_GAME_TAB = {
  materials:'mats',
  mats:'mats',
  characters:'mats',
  character:'mats',
  library:'library',
  tracker:'tracker',
  tcg:'tcg',
  'serenitea-pot':'pot',
  pot:'pot',
  furniture:'pot',
  settings:'settings',
};
const ROUTE_TO_NYX_TAB = {
  pulls:'pulls',
  pull:'pulls',
  codes:'codes',
  banners:'banners',
  settings:'settings',
};

function routeSlug(value){
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function routeDisplayName(value){
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw === raw.toLowerCase()) {
    return raw.split(/[-_]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }
  return raw;
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
      return { key, tab:coerceTabForKey(key, ROUTE_TO_NYX_TAB[sub] || 'overview') };
    }
    const character = (sub === 'characters' || sub === 'character') ? parts.slice(2).join('-') : '';
    const tab = character ? 'mats' : (ROUTE_TO_GAME_TAB[sub] || 'overview');
    return { key, tab:coerceTabForKey(key, tab), character:character || null };
  } catch (e) {
    return {};
  }
}

function routePathFor(key, tab, selection){
  const base = GP_PAGE_HREF[key] || GP_PAGE_HREF.nyx;
  if (!key || key === 'nyx') {
    const slug = NYX_TAB_TO_ROUTE[coerceTabForKey('nyx', tab || 'overview')] || '';
    return slug ? base + '/' + slug : base;
  }
  const selectedName = selection && selection.game === key ? (selection.name || selection.slug) : '';
  const characterSlug = routeSlug(selectedName);
  if (characterSlug) return base + '/characters/' + characterSlug;
  const safeTab = coerceTabForKey(key, tab || 'overview');
  const slug = GAME_TAB_TO_ROUTE[safeTab] || '';
  return slug ? base + '/' + slug : base;
}

function routeStateFor(key, tab, selection){
  return {
    nyxKey:key,
    nyxTab:coerceTabForKey(key, tab || 'overview'),
    nyxCharacter:selection && selection.game === key ? (selection.name || selection.slug || null) : null,
  };
}

function routeTitleFor(key, tab, selection){
  const cfg = key === 'nyx' ? NYX_META : GAME_REGISTRY[key];
  const name = cfg?.name || 'Nyx';
  const selectedName = selection && selection.game === key ? routeDisplayName(selection.name) : '';
  if (selectedName) return 'Nyx \u2014 ' + selectedName + ' \u2014 ' + name;
  if (key === 'nyx') return tab && tab !== 'overview' ? 'Nyx \u2014 ' + tab.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Nyx';
  const label = { mats:'Character Materials', library:'Library', tracker:'Tracker', tcg:'TCG', pot:'Serenitea Pot', settings:'Settings' }[tab] || '';
  return label ? 'Nyx \u2014 ' + label + ' \u2014 ' + name : 'Nyx \u2014 ' + name;
}

function keyFromLocation(){
  try {
    return routeFromLocation().key;
  } catch (e) { return undefined; }
}

function validTabsForKey(key){
  if (key === 'gi') return ['overview','mats','char-customize','library','tracker','tcg','pot','settings'];
  return key === 'nyx' ? ['overview','pulls','codes','banners','settings'] : ['overview','mats','char-customize','library','tracker','settings'];
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
  const initialKey = (initialRoute.key || (window.GP_PAGE && window.GP_PAGE.key) || 'nyx');
  const [activeKey, setActiveKey] = React.useState(initialKey);
  const [tab, setTab] = React.useState(() => coerceTabForKey(initialKey, initialRoute.tab || DEFAULT_TAB(initialKey)));
  const [materialSelection, setMaterialSelection] = React.useState(() => (
    initialRoute.character && initialKey !== 'nyx'
      ? { game:initialKey, name:initialRoute.character, slug:initialRoute.character }
      : null
  ));
  const [characterCustomize, setCharacterCustomize] = React.useState(null);
  const [pengoSettings, setPengoSettings] = React.useState(loadPengoSettings);
  useCmGameVersion(activeKey);
  const previousAlwaysBetaRef = React.useRef(pengoSettings.alwaysBeta === true);

  const commitRoute = React.useCallback((key, nextTab, selection, opts) => {
    const safeKey = key || 'nyx';
    const safeTab = coerceTabForKey(safeKey, nextTab || 'overview');
    const href = routePathFor(safeKey, safeTab, selection);
    try {
      if (href && location.pathname !== href) {
        const method = opts && opts.replace ? 'replaceState' : 'pushState';
        window.history[method](routeStateFor(safeKey, safeTab, selection), '', href);
      }
      document.title = routeTitleFor(safeKey, safeTab, selection);
    } catch (e) {}
  }, []);

  React.useEffect(() => {
    const safeTab = coerceTabForKey(activeKey, tab === 'char-customize' ? 'mats' : tab);
    commitRoute(activeKey, safeTab, safeTab === 'mats' ? materialSelection : null, { replace:true });
  }, [activeKey, tab, materialSelection, commitRoute]);

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

  // living eye: slow random wander (top bar). Runs once — bar never unmounts.
  React.useEffect(() => {
    const ball = document.getElementById('tbBall');
    if (!ball || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let tm;
    (function wander(){
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random());
      ball.style.transform = 'translate(' + (Math.cos(a) * r * 5).toFixed(1) + 'px,' + (Math.sin(a) * r * 2.6).toFixed(1) + 'px)';
      tm = setTimeout(wander, 1100 + Math.random() * 1900);
    })();
    return () => clearTimeout(tm);
  }, []);

  React.useEffect(() => mountNyxAmbientText(), []);

  React.useEffect(() => {
    const contentScrollTargets = [
      '.cm-pop-main',
      '.cm-pop.ledger .cm-pop-layout',
      '.cm-body',
      '.gt-results',
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
      if (Math.abs(event.deltaY) < 1 || Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.2) return;
      const target = event.target instanceof Element ? event.target : null;
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
      setMaterialSelection(next.character && k !== 'nyx' ? { game:k, name:next.character, slug:next.character } : null);
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
  const openMaterialPage = (game, name) => {
    const targetGame = (game && game !== 'nyx') ? game : activeKey;
    if (!targetGame || targetGame === 'nyx' || !name) return;
    setActiveKey(targetGame);
    setTab('mats');
    setCharacterCustomize(null);
    // Tag the origin so the character detail can offer "Back to Overview" and
    // return to the overview (favourites) instead of the materials roster.
    const selection = { game:targetGame, name, from:'overview' };
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
    const targetGame = game || activeKey;
    setMaterialSelection(null);
    commitRoute(targetGame, 'mats', null);
  };

  return (
    <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column' }} data-screen-label={cfg.name + ' page'}>
      <header className="gp-topbar" data-screen-label="Top bar">
        <a className="tb-brand" href="/" title="Back to Worlds" aria-label="Back to the worlds index">
          <span className="plate" aria-hidden="true"></span>
          <span className="brand-mark">
            <span className="wm">Nyx</span>
            <span className="tb-eye" aria-hidden="true">
              <span className="elayer ball" id="tbBall"></span>
              <span className="elayer lid"></span>
              <span className="elayer drips"></span>
            </span>
          </span>
        </a>
        <div className="tb-center">
          <GPGameRail active={activeKey} onSwitch={switchGame} displayGames={pengoSettings.displayGames} gameIcons={pengoSettings.gameIcons} />
        </div>
      </header>

      <div className="gp-corner">
        <div className="gp-corner-actions">
          <a className="gp-kofi" href="https://ko-fi.com/asyce" target="_blank" rel="noopener noreferrer" title="Ko-fi" aria-label="Ko-fi">
            <img src="../assets/icon/kofi-logo.png" alt="" draggable="false" />
          </a>
        </div>
        {!isNyx && <NyxChannelToggle gameKey={activeKey} />}
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
