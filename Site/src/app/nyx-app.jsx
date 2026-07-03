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
    banner:{ title:'Lone Shadow', five:'Skirk', fours:['Bennett','Xiangling','Fischl'], time:'Ends in 11d 22h 14m', pct:42 },
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
    banner:{ title:'Reverie of Ash', five:'Castorice', fours:['Asta','March 7th','Herta'], time:'Ends in 6d 4h', pct:55 },
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
    banner:{ title:'Astral Drive', five:'Yixuan', fours:['Nicole','Anby','Billy'], time:'Ends in 9d 13h', pct:40 },
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
    banner:{ title:'Tides of Echo', five:'Carlotta', fours:['Yangyang','Baizhi','Chixia'], time:'Ends in 4d 7h', pct:70 },
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
    banner:{ title:'First Light', five:'Perlica', fours:['Wulfgard','Xaihi','Endmin'], time:'Ends in 15d 2h', pct:30 },
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
  codes:GAME_REGISTRY.gi.codes, banner:GAME_REGISTRY.gi.banner };

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

function phaseTimeLabel(phase, opts){
  const end = phase && phase.end ? new Date(phase.end).getTime() : NaN;
  const start = phase && phase.start ? new Date(phase.start).getTime() : NaN;
  const now = Date.now();
  const endLabel = Number.isFinite(end) ? (end >= now ? 'Ends in ' : 'Ended ') + shortDuration(end - now) : null;
  const startLabel = Number.isFinite(start) ? (start >= now ? 'Starts in ' : 'Started ') + shortDuration(start - now) : null;
  // Banners that aren't up yet show their START time; live banners show the end.
  if (opts && opts.preferStart) return startLabel || endLabel;
  return endLabel || startLabel;
}

function phasePct(phase, fallback){
  const start = phase && phase.start ? new Date(phase.start).getTime() : NaN;
  const end = phase && phase.end ? new Date(phase.end).getTime() : NaN;
  const now = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return fallback;
  const done = (now - start) / (end - start);
  return Math.max(8, Math.min(96, Math.round(done * 100)));
}

function bannerFromDb(key, fallback){
  const group = dbBannerGroup(key);
  const phase = group && group.current;
  const chars = phase && phase.characters && phase.characters.length ? phase.characters : null;
  if (!chars) return fallback;
  const first = chars[0];
  return Object.assign({}, fallback, {
    title:phase.phase || fallback.title || 'Current Banner',
    five:first.name || fallback.five,
    fours:chars.slice(1, 4).map(c => c.name).filter(Boolean),
    time:phaseTimeLabel(phase) || fallback.time,
    pct:phasePct(phase, fallback.pct || 42),
    art:first.art || first.icon || fallback.art,
  });
}

function bannerPhaseCards(cfg){
  const group = dbBannerGroup(cfg.key);
  if (!group) return [];
  const cards = [];
  const is5 = (ch) => { const r = ch && ch.rarity; return r === 5 || r === '5' || r === 'S'; };
  const add = (phase, status, splitFives) => {
    const chars = phase?.characters || [];
    if (!chars.length) return;
    const fives = chars.filter(is5);
    const fours = chars.filter((ch) => !is5(ch));
    const fourChips = fours.map((ch, i) => ({ key:(ch.name || 'char') + '-' + i, text:ch.name, icon:ch.icon || null }));
    // G32: every featured 5\u2605 gets its OWN card (e.g. Lohen AND Mavuika); 4\u2605s are shared chips.
    const leads = (splitFives && fives.length > 1) ? fives : [fives[0] || chars[0]];
    leads.forEach((first) => {
      cards.push({
        title:phase.phase || cfg.banner?.title || status,
        status,
        next:status !== 'Ongoing',
        five:(first.rarity || 5) + '\u2605 ' + first.name,
        fiveIcon:first.icon || null,
        chips:fourChips,
        time:phaseTimeLabel(phase, { preferStart:status !== 'Ongoing' }) || 'Date pending',
        pct:phasePct(phase, cfg.banner?.pct || 42),
        art:first.namecard || first.art || first.icon || cfg.art, // G31: GI prefers namecard, else splash
      });
    });
  };
  add(group.current, 'Ongoing', true);
  add(group.next, 'Next', false);
  (group.upcoming || []).slice(0, 2).forEach((phase) => add(phase, 'Upcoming', false));
  return cards;
}

const BANNER_WEAPON_COLLECTIONS = {
  gi:['weapons'],
  hsr:['light-cones'],
  zzz:['w-engines'],
  wuwa:['weapons'],
  ae:['weapons'],
};

const BANNER_WEAPON_TITLES = {
  gi:'Weapon Event Wish',
  hsr:'Light Cone Event Warp',
  zzz:'W-Engine Channel',
  wuwa:'Weapon Convene',
  ae:'Weapon Headhunt',
};

function bannerFeaturedRank(gameKey){
  if (gameKey === 'zzz') return 4;
  if (gameKey === 'ae') return 6;
  return 5;
}

function bannerSupportRank(gameKey){
  if (gameKey === 'zzz') return 3;
  if (gameKey === 'ae') return 5;
  return 4;
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
    badge:bannerRarityLabel(gameCfg.key, rarity || bannerFeaturedRank(gameCfg.key)),
    order:index,
  };
}

function fallbackRosterUnits(gameCfg, wantedRank, excludeNames, limit){
  const blocked = excludeNames || new Set();
  return makeRoster(gameCfg)
    .filter((ch) => !blocked.has(normalizeUnitName(ch.name)))
    .map((ch) => {
      const rarity = bannerRarityValue(ch.rarity);
      return {
        name:ch.name,
        icon:ch.icon,
        art:ch.art,
        rarity,
        badge:bannerRarityLabel(gameCfg.key, rarity),
      };
    })
    .filter((ch) => ch.rarity === wantedRank)
    .slice(0, limit || 6);
}

function characterBannerCard(gameCfg, source){
  const group = dbBannerGroup(gameCfg.key);
  const phase = group && group.current;
  const chars = (phase && phase.characters) || [];
  const rosterMap = rosterUnitMap(gameCfg);
  const units = dedupeByName(chars.map((ch, i) => phaseUnit(gameCfg, ch, rosterMap, i))).filter((ch) => ch.name);
  if (!units.length) {
    const fallback = fallbackRosterUnits(gameCfg, bannerFeaturedRank(gameCfg.key), new Set(), 2);
    if (!fallback.length) return null;
    const low = fallbackRosterUnits(gameCfg, bannerSupportRank(gameCfg.key), new Set(fallback.map((x) => normalizeUnitName(x.name))), 4);
    return {
      kind:'character',
      category:'Character',
      title:gameCfg.banner?.title || 'Character Banner',
      status:'Ongoing',
      featured:fallback,
      supports:low,
      supportLabel:'4-Star Characters',
      time:gameCfg.banner?.time || 'Date pending',
      pct:gameCfg.banner?.pct || 42,
      artPool:fallback.map((u) => u.art).filter(Boolean),
      game:source || gameCfg,
    };
  }
  const featuredRank = bannerFeaturedRank(gameCfg.key);
  const supportRank = bannerSupportRank(gameCfg.key);
  const featured = units.filter((unit) => !unit.rarity || unit.rarity >= featuredRank);
  const leads = featured.length ? featured : units.slice(0, Math.min(2, units.length));
  const excluded = new Set(leads.map((unit) => normalizeUnitName(unit.name)));
  const explicitSupports = units.filter((unit) => unit.rarity === supportRank && !excluded.has(normalizeUnitName(unit.name)));
  const supports = explicitSupports.length ? explicitSupports : fallbackRosterUnits(gameCfg, supportRank, excluded, 4);
  return {
    kind:'character',
    category:'Character',
    title:phase.phase || gameCfg.banner?.title || 'Character Banner',
    status:'Ongoing',
    featured:leads,
    supports,
    supportLabel:'4-Star Characters',
    time:phaseTimeLabel(phase) || gameCfg.banner?.time || 'Date pending',
    pct:phasePct(phase, gameCfg.banner?.pct || 42),
    artPool:leads.map((unit) => unit.art).filter(Boolean),
    game:source || gameCfg,
  };
}

function weaponBannerCard(gameCfg, source){
  const items = weaponItemsFor(gameCfg.key);
  if (!items.length) return null;
  const featuredRank = bannerFeaturedRank(gameCfg.key);
  const supportRank = bannerSupportRank(gameCfg.key);
  const featured = items.filter((item) => item.rarity >= featuredRank).slice(0, 2);
  const supports = items.filter((item) => item.rarity === supportRank).slice(0, 5);
  if (!featured.length && !supports.length) return null;
  const phase = dbBannerGroup(gameCfg.key)?.current;
  return {
    kind:'weapon',
    category:gameCfg.key === 'hsr' ? 'Light Cone' : (gameCfg.key === 'zzz' ? 'W-Engine' : 'Weapon'),
    title:BANNER_WEAPON_TITLES[gameCfg.key] || 'Weapon Banner',
    status:'Ongoing',
    featured:featured.length ? featured : items.slice(0, 2),
    supports,
    supportLabel:gameCfg.key === 'zzz' ? 'A-Rank Weapons' : '4-Star Weapons',
    time:phaseTimeLabel(phase) || gameCfg.banner?.time || 'Date pending',
    pct:phasePct(phase, gameCfg.banner?.pct || 42),
    artPool:(featured.length ? featured : items.slice(0, 2)).map((item) => item.art || item.icon).filter(Boolean),
    game:source || gameCfg,
  };
}

function chronicleBannerCard(gameCfg, source){
  if (gameCfg.key !== 'gi') return null;
  const roster = makeRoster(gameCfg).filter((ch) => bannerRarityValue(ch.rarity) >= 5);
  const weapons = weaponItemsFor(gameCfg.key).filter((item) => item.rarity >= 5);
  if (!roster.length && !weapons.length) return null;
  const featured = roster.map((ch) => ({
    name:ch.name,
    icon:ch.icon,
    art:ch.art,
    rarity:5,
    badge:'5\u2605',
  }));
  const phase = dbBannerGroup(gameCfg.key)?.current;
  return {
    kind:'chronicle',
    category:'Chronicle',
    title:'Chronicled Wish',
    status:'Ongoing',
    featured,
    supports:weapons,
    supportLabel:'5-Star Weapons',
    time:phaseTimeLabel(phase) || 'Selection banner',
    pct:phasePct(phase, 42),
    artPool:featured.map((item) => item.art).filter(Boolean),
    game:source || gameCfg,
  };
}

function currentBannerCards(cfg){
  const buildFor = (gameCfg, source) => {
    return [
      characterBannerCard(gameCfg, source),
      weaponBannerCard(gameCfg, source),
      chronicleBannerCard(gameCfg, source),
    ].filter(Boolean);
  };
  if (cfg.key !== 'nyx') return buildFor(cfg);
  return SIM_GAMES.flatMap((game) => buildFor(GAME_REGISTRY[game.key], game));
}

function OverviewBannerCard({ card, index, showGame }){
  const artPool = (card.artPool || []).filter(Boolean);
  const [artIndex, setArtIndex] = React.useState(0);
  React.useEffect(() => {
    setArtIndex(0);
    if (artPool.length < 2) return undefined;
    const id = setInterval(() => setArtIndex((idx) => (idx + 1) % artPool.length), 4200);
    return () => clearInterval(id);
  }, [artPool.join('|')]);
  const art = artPool.length ? artPool[artIndex % artPool.length] : (card.featured?.[0]?.art || card.game?.bg || card.game?.art);
  const gameIcon = card.game?.icon || GAME_REGISTRY[card.game?.key]?.benchIcon;
  return (
    <article className={'gp-oban kind-' + card.kind} style={{ '--pct':(card.pct || 42) + '%' }}>
      <div className="gp-oban-art" style={{ backgroundImage:bgUrl(art) }}></div>
      <div className="gp-oban-shade"></div>
      <div className="gp-oban-body">
        <div className="gp-oban-top">
          <span className="gp-oban-cat">{card.category}</span>
          {showGame && card.game && (
            <span className="gp-oban-game">
              {gameIcon && <img src={gameIcon} alt="" draggable="false" />}
              <span>{card.game.name}</span>
            </span>
          )}
        </div>
        <div className="gp-oban-title">{card.title}</div>
        <div className="gp-oban-featured" aria-label={card.category + ' featured'}>
          {(card.featured || []).map((unit) => (
            <span key={unit.name} className="gp-oban-unit" title={unit.name}>
              {unit.icon && <img src={unit.icon} alt="" draggable="false" />}
              <b>{unit.name}</b>
              {unit.badge && <em>{unit.badge}</em>}
            </span>
          ))}
        </div>
        {!!(card.supports || []).length && (
          <div className="gp-oban-supports">
            <span>{card.supportLabel}</span>
            <div>
              {card.supports.map((unit) => (
                <i key={unit.name} title={unit.name}>
                  {unit.icon && <img src={unit.icon} alt="" draggable="false" />}
                  <b>{unit.name}</b>
                </i>
              ))}
            </div>
          </div>
        )}
        <div className="gp-oban-foot">
          <span>{card.time}</span>
          <i></i>
        </div>
      </div>
    </article>
  );
}

function CurrentBannerStrip({ cfg }){
  const cards = currentBannerCards(cfg);
  if (!cards.length) return null;
  return (
    <section className="gp-current-banners" aria-label="Current banners">
      <div className="gp-current-banners-head">
        <GPSec title="Current Banners" icon="../assets/decor/orbit_burst.png" style={{ flex:1, minWidth:0 }} />
        <span>{cards.length} categories</span>
      </div>
      <div className="gp-current-banner-row">
        {cards.map((card, i) => (
          <div className="gp-current-banner-cell" key={(card.game?.key || cfg.key) + '-' + card.kind + '-' + i}>
            <OverviewBannerCard card={card} index={i} showGame={cfg.key === 'nyx'} />
          </div>
        ))}
      </div>
    </section>
  );
}

const RESET_MS = {
  day:24 * 60 * 60 * 1000,
  week:7 * 24 * 60 * 60 * 1000,
};

const RESET_REGIONS = {
  local:{ key:'local', label:'Local', short:'Local', offset:null },
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

function resetTimerRows(now, regionKey){
  const region = RESET_REGIONS[regionKey] || RESET_REGIONS.local;
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
    return RESET_REGIONS[key] ? key : 'local';
  } catch (e) {
    return 'local';
  }
}

function datetimeLocalValue(ts){
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function ResetTimersPanel({ gameKey }){
  const [now, setNow] = React.useState(Date.now());
  const [regionKey, setRegionKey] = React.useState(() => loadResetRegion(gameKey));
  const [custom, setCustom] = React.useState(() => loadCustomTimers(gameKey));
  const [label, setLabel] = React.useState('');
  const [target, setTarget] = React.useState(() => datetimeLocalValue(Date.now() + RESET_MS.day));
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [gameKey]);
  React.useEffect(() => {
    setRegionKey(loadResetRegion(gameKey));
    setCustom(loadCustomTimers(gameKey));
    setLabel('');
    setTarget(datetimeLocalValue(Date.now() + RESET_MS.day));
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
  const addTimer = () => {
    const clean = label.trim();
    const ts = new Date(target).getTime();
    if (!clean || !Number.isFinite(ts)) return;
    commitCustom((prev) => [...prev, { id:String(Date.now()) + '-' + Math.random().toString(16).slice(2), label:clean, target:ts }]);
    setLabel('');
    setTarget(datetimeLocalValue(Date.now() + RESET_MS.day));
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
          {custom.map((row) => (
            <div className="gp-reset-tile custom" key={row.id}>
              <span className="k">{row.label}</span>
              <span className="v">{row.target > now ? durationParts(row.target - now) : 'Expired'}</span>
              <button type="button" aria-label={'Remove ' + row.label} title="Remove custom timer" onClick={() => removeTimer(row.id)}>x</button>
            </div>
          ))}
        </div>
      )}
      <div className="gp-reset-form" aria-label="Add custom timer">
        <input value={label} placeholder="Custom timer" maxLength="42" onChange={(e) => setLabel(e.target.value)} />
        <input type="datetime-local" value={target} onChange={(e) => setTarget(e.target.value)} />
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
  cfg.banner = Object.assign({}, cfg.banner, {
    title:'Database Highlights',
    five:high[0] || top.n,
    fours:(low.length ? low : roster.slice(1, 4).map(ch => ch.n)).slice(0, 3),
    time:roster.length + ' units indexed',
    pct:Math.max(24, Math.min(88, Math.round((high.length / Math.max(1, roster.length)) * 100))),
  });
  cfg.codes = dbCodes(key, cfg.codes);
  cfg.banner = bannerFromDb(key, cfg.banner);
  cfg.track = Object.assign({}, cfg.track, {
    fives:high.length ? high : roster.slice(0, 8).map(ch => ch.n),
    fours:low.length ? low : roster.slice(8, 16).map(ch => ch.n),
  });
});

NYX_META.roster = Object.keys(GAME_REGISTRY).flatMap(key => makeRoster(GAME_REGISTRY[key]));
NYX_META.codes = Object.keys(GAME_REGISTRY).flatMap(key => GAME_REGISTRY[key].codes.slice(0, 2)).slice(0, 8);
NYX_META.banner = Object.assign({}, NYX_META.banner, {
  title:'Indexed Worlds',
  five:'Database',
  fours:Object.keys(GAME_REGISTRY).map(key => GAME_REGISTRY[key].name).slice(0, 3),
  time:'Prydwen + Nanoka + EndfieldWiki',
  pct:72,
});

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
  const amount = codeCurrencyAmount(r.reward, currency.name);
  const redeemed = r.st === 'redeemed';
  return (
    <div className={'gp-code-row st-' + r.st + (r.premium ? ' premium' : '')}>
      <label className="cc-check" title={redeemed ? 'Mark as not redeemed' : 'Mark as redeemed'}>
        <input type="checkbox" checked={redeemed} onChange={() => onToggleRedeemed(r.code)} />
        <span className="box"></span>
      </label>
      {r.redeemUrl
        ? <a className="cc" href={r.redeemUrl} target="_blank" rel="noopener noreferrer" title="Open the redeem page">{r.code}</a>
        : <span className="cc no-link" title="No redeem link available">{r.code}</span>}
      <span className={'cc-reward' + (r.premium ? '' : ' plain')} tabIndex={0} aria-label="Show all rewards">
        {r.premium && (currency.icon
          ? <img src={currency.icon} alt={currency.name} draggable="false" />
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

function SimCodeCard({ code, reward, redeemUrl, isNew }){
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
  const canCopy = st === 'new' || st === 'available';
  const row = { code, reward, redeemUrl, st, premium:String(reward || '').toLowerCase().includes('primogem') || String(reward || '').toLowerCase().includes('stellar jade') || String(reward || '').toLowerCase().includes('polychrome') || String(reward || '').toLowerCase().includes('astrite') || String(reward || '').toLowerCase().includes('originium') };
  return <CodeCardRow row={row} isNew={isNew && canCopy} onCopy={onCopy} onRowAction={(nextCode, action) => action === 'redeem' ? markRedeemed() : (st === 'redeemed' ? undoRedeemed() : markRedeemed())} />;
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
                <SimCodeCard key={c.code} code={c.code} reward={c.reward} redeemUrl={c.redeemUrl} isNew={i === 0} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const SIM_RESETS = { daily:'13h 10m 48s', weekly:'1d 13h 10m 48s' };

function phaseNames(phase){
  return ((phase && phase.characters) || []).map(ch => ch.name).filter(Boolean);
}

function phaseChars(phase){
  return ((phase && phase.characters) || []).filter(ch => ch && ch.name);
}

function phaseSeconds(phase, fallback){
  const end = phase && phase.end ? new Date(phase.end).getTime() : NaN;
  if (!Number.isFinite(end)) return fallback;
  return Math.max(0, Math.floor((end - Date.now()) / 1000));
}

function bannerFlowFor(g, i){
  const group = dbBannerGroup(g.key);
  if (group && group.current && phaseNames(group.current).length) {
    const upcoming = (group.upcoming || []).flatMap(phaseChars);
    const next = phaseChars(group.next).slice(0, 4);
    const upcomingShort = upcoming.slice(0, 8);
    return {
      status:group.current.end && new Date(group.current.end).getTime() < Date.now() ? 'ended' : 'now',
      secs:phaseSeconds(group.current, 824448 + i * 129600),
      now:phaseChars(group.current).slice(0, 4),
      next:next.length ? next : null,
      upcoming:upcomingShort.length ? upcomingShort : null,
    };
  }
  const names = makeRoster(GAME_REGISTRY[g.key]).map(ch => ({ name:ch.name, icon:ch.icon }));
  const next = names.slice(2, 4);
  const upcoming = names.slice(4, 8);
  return {
    status:'now',
    secs:824448 + i * 129600,
    now:names.slice(0, 2),
    next:next.length ? next : null,
    upcoming:upcoming.length ? upcoming : null,
  };
}

const BANNER_FLOW = {};
SIM_GAMES.forEach((g, i) => {
  BANNER_FLOW[g.key] = bannerFlowFor(g, i);
});
const SIM_CC_COLORS = ['#dd0044','#635bff','#c08fe6','#e3b552','#b8b3ff','#d8b86a','#8f7fd6','#e07fb0'];

function SimChar({ name }){
  const ch = typeof name === 'string' ? { name } : name;
  const col = SIM_CC_COLORS[ch.name.length % SIM_CC_COLORS.length];
  return (
    <div className="sim-cc" title={ch.name}>
      <div className="d" style={{ '--c':col }}>
        {ch.icon ? <img src={ch.icon} alt="" draggable="false" /> : <span>{simInitials(ch.name)}</span>}
      </div>
      <span className="n">{ch.name}</span>
    </div>
  );
}

function Countdown({ secs }){
  const [t, setT] = React.useState(secs);
  React.useEffect(() => { const id = setInterval(() => setT(x => x > 0 ? x - 1 : 0), 1000); return () => clearInterval(id); }, []);
  const d = Math.floor(t / 86400), h = Math.floor(t % 86400 / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return <span>{(d > 0 ? d + 'd ' : '') + pad(h) + 'h ' + pad(m) + 'm ' + pad(s) + 's'}</span>;
}

function SimGameBanner({ g }){
  const f = BANNER_FLOW[g.key];
  const ended = f.status === 'ended';
  return (
    <div className="sim-gbanner">
      <div className="art" style={{ backgroundImage:'url(' + g.bg + ')', backgroundPosition:g.pos }}></div>
      <div className="shade"></div>
      <div className="inner">
        <div className="ghd">{g.name}</div>
        <div className={'phase' + (ended ? ' end' : '')}>{ended ? 'Ended' : 'Now'}</div>
        <div className="ccrow">{f.now.map(n => <SimChar key={typeof n === 'string' ? n : n.name} name={n} />)}</div>
        {ended ? <div className="timer ended">Ended</div> : <div className="timer"><Countdown secs={f.secs} /></div>}
        {f.next && (
          <React.Fragment>
            <div className="phase">Next</div>
            <div className="ccrow">{f.next.map(n => <SimChar key={typeof n === 'string' ? n : n.name} name={n} />)}</div>
            {f.nextStart && <div className="substart">{f.nextStart}</div>}
          </React.Fragment>
        )}
        {f.upcoming && (
          <React.Fragment>
            <div className="phase">Upcoming</div>
            <div className="ccrow wrap">{f.upcoming.map(n => <SimChar key={typeof n === 'string' ? n : n.name} name={n} />)}</div>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

function AllBannersView(){
  const [region, setRegion] = React.useState('EU');
  return (
    <div style={{ minWidth:0, minHeight:0, display:'flex', flexDirection:'column' }}>
      <div className="sim-banhd">
        <div className="sim-regions">
          {['EU','NA','Asia'].map(r => (
            <button type="button" key={r} className={region === r ? 'on' : ''} onClick={() => setRegion(r)}>{r}</button>
          ))}
        </div>
        <div className="sim-resets">
          <div className="rs"><span className="k">Daily</span><span className="v">{SIM_RESETS.daily}</span></div>
          <div className="rs"><span className="k">Weekly</span><span className="v">{SIM_RESETS.weekly}</span></div>
        </div>
      </div>
      <div className="sim-gbangrid">
        {SIM_GAMES.map(g => <SimGameBanner key={g.key} g={g} />)}
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

function GenshinTcgView(){
  const gameData = dbGame('gi') || {};
  const tcg = gameData.tcg || {};
  const [kind, setKind] = React.useState('all');
  const [q, setQ] = React.useState('');
  const cards = [
    ...((tcg.characterCards || []).map((card) => ({ ...card, kind:'character' }))),
    ...((tcg.otherCards || []).map((card) => ({ ...card, kind:'action' }))),
  ];
  const qq = q.trim().toLowerCase();
  const visible = cards.filter((card) => {
    if (kind !== 'all' && card.kind !== kind) return false;
    const hay = [card.name, card.title, card.type, card.playableCharacter, ...(card.tags || [])].filter(Boolean).join(' ').toLowerCase();
    return !qq || hay.includes(qq);
  });
  const filters = [
    ['all', 'All Cards', cards.length],
    ['character', 'Character', (tcg.characterCards || []).length],
    ['action', 'Action', (tcg.otherCards || []).length],
  ];
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
      <div className="tcg-tabs">
        {filters.map(([key, label, count]) => (
          <button type="button" key={key} className={kind === key ? 'on' : ''} onClick={() => setKind(key)}>
            <span>{label}</span><b>{count}</b>
          </button>
        ))}
      </div>
      <div className="tcg-grid">
        {visible.map((card) => (
          <article className={'tcg-card kind-' + card.kind} key={card.kind + '-' + card.id}>
            <div className="tcg-art">
              {card.art ? <img src={card.art} alt="" draggable="false" /> : <span>{simInitials(card.name)}</span>}
            </div>
            <div className="tcg-meta">
              <b>{card.name}</b>
              {card.title && <em>{card.title}</em>}
              <span>{card.type || (card.kind === 'character' ? 'Character Card' : 'Action Card')}</span>
              {!!(card.tags || []).length && (
                <div>{card.tags.slice(0, 4).map((tag) => <i key={tag}>{tag}</i>)}</div>
              )}
            </div>
          </article>
        ))}
      </div>
      {visible.length === 0 && <div className="db-empty">No TCG cards match your search.</div>}
    </div>
  );
}

/* ================= content panels ================= */
// Keyboard activation for role="button" nav rows (Enter / Space).
function navKeyDown(fn){
  return (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); fn(); } };
}

function GameContent({ cfg, tab, setTab, onOpenMaterial, settings, setSettings }){
  const fns = cfg.fns || ['Character Materials','Artifact Sorter','Wish Tracker'];
  const hasTcg = cfg.key === 'gi';
  // G13: the section list the Character-Materials header icon-dropdown switches between.
  const sectionKey = (f) => /tracker$/i.test(f) ? 'tracker' : /^character materials$/i.test(f) ? 'mats' : 'library';
  const sections = [{ key:'overview', label:'Overview' }, ...fns.map((f) => ({ key:sectionKey(f), label:f })), ...(hasTcg ? [{ key:'tcg', label:'TCG' }] : []), { key:'settings', label:'Settings' }];
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
          <CharMaterials inline game={cfg.key} pageTab={tab} onPageTab={setTab} sections={sections} />
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

function keyFromLocation(){
  try {
    const f = decodeURIComponent((location.pathname.split('/').pop() || ''));
    return HREF_TO_KEY[f];
  } catch (e) { return undefined; }
}

function validTabsForKey(key){
  if (key === 'gi') return ['overview','mats','library','tracker','tcg','settings'];
  return key === 'nyx' ? ['overview','pulls','codes','banners','settings'] : ['overview','mats','library','tracker','settings'];
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
  specialUnits: NYX_SPECIAL_UNIT_DEFAULTS,
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

function loadPengoSettings(){
  try {
    const raw = JSON.parse(localStorage.getItem(NYX_PENGO_SETTINGS_KEY) || '{}');
    return Object.assign({}, NYX_PENGO_DEFAULTS, raw, {
      animation: ['play', 'pause', 'stop'].includes(raw.animation) ? raw.animation : NYX_PENGO_DEFAULTS.animation,
      displayGames: Object.assign({}, NYX_PENGO_DISPLAY_DEFAULTS, raw.displayGames || {}),
      gameIcons: sanitizeGameIcons(raw.gameIcons),
      identity: sanitizeNyxIdentity(raw.identity),
      specialUnits: sanitizeSpecialUnits(raw.specialUnits),
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
    const top = Math.max(16, Math.min(window.innerHeight - 120, rect.bottom + 8));
    setPos({ left, top, width });
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
    <div className="pm-icon-pop fixed" ref={popRef} style={pos ? { left:pos.left + 'px', top:pos.top + 'px', width:pos.width + 'px' } : undefined}>
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

function PengoMenu({ settings, setSettings, inline }){
  const update = (patch) => setSettings((prev) => Object.assign({}, prev, patch));
  const identity = sanitizeNyxIdentity(settings.identity);
  const gameIcons = sanitizeGameIcons(settings.gameIcons);
  const specialUnits = sanitizeSpecialUnits(settings.specialUnits);
  const displayGames = Object.assign({}, NYX_PENGO_DISPLAY_DEFAULTS, settings.displayGames || {});
  const setIdentity = (group, value) => update({ identity:Object.assign({}, identity, { [group]:value }) });
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
  const resetInterface = () => update({
    whispers: NYX_PENGO_DEFAULTS.whispers,
    animation: NYX_PENGO_DEFAULTS.animation,
    khaenriah: NYX_PENGO_DEFAULTS.khaenriah,
  });
  const resetOpus = () => update({
    lapis: NYX_PENGO_DEFAULTS.lapis,
    energy: NYX_PENGO_DEFAULTS.energy,
    spawn: NYX_PENGO_DEFAULTS.spawn,
    sacrifice: NYX_PENGO_DEFAULTS.sacrifice,
  });
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
          <button type="button" className="pm-reset" data-tip="Reset the Magnum Opus Pengonis to default" onClick={resetOpus}>Reset</button>
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
          <button type="button" className="pm-reset" data-tip="Reset the interface to default" onClick={resetInterface}>Reset</button>
        </section>
      </div>
      <div className="settings-games-col">
        {SIM_GAMES.map((game) => {
          const groupKey = SETTINGS_IDENTITY_BY_GAME[game.key];
          const group = NYX_IDENTITY_GROUPS.find((row) => row.key === groupKey);
          const specials = SETTINGS_SPECIAL_TOGGLES[game.key] || [];
          const gameOn = displayGames[game.key] !== false;
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
                  <span>{group.label}</span>
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
              )}
              {specials.length > 0 && (
                <div className="pm-special-list">
                  {specials.map(([unitKey, label]) => {
                    const on = (specialUnits[game.key] || {})[unitKey] !== false;
                    return (
                      <button type="button" key={unitKey} className={'pm-row' + (on ? ' on' : '')}
                              aria-pressed={on} onClick={() => toggleSpecial(game.key, unitKey)}>
                        <span>{label}</span><b className="pm-state">{on ? 'On' : 'Off'}</b>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
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
  const betaAvailable = cmHasBeta(gameKey);
  const betaSessionKey = 'nyx:beta-disclaimer:' + gameKey + ':v1';
  const commitPick = (ch) => {
    const next = ch === 'beta' && !betaAvailable ? 'live' : ch;
    setChannel(next);
    cmSaveChannel(gameKey, next);
    try { window.dispatchEvent(new CustomEvent('nyx:cm-channel-changed', { detail:{ key:gameKey, channel:next } })); } catch (e) {}
  };
  const pick = (ch) => {
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
  const isBeta = betaAvailable && channel === 'beta';
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
            <p>Are you sure you wish to view Beta content? Please be aware there could be spoilers.</p>
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
  const initialKey = (window.GP_PAGE && window.GP_PAGE.key) || keyFromLocation() || 'nyx';
  const [activeKey, setActiveKey] = React.useState(initialKey);
  const [tab, setTab] = React.useState(DEFAULT_TAB(initialKey));
  const [materialModal, setMaterialModal] = React.useState(null);
  const [pengoSettings, setPengoSettings] = React.useState(loadPengoSettings);
  useCmGameVersion(activeKey);

  React.useEffect(() => {
    try { localStorage.setItem(NYX_PENGO_SETTINGS_KEY, JSON.stringify(pengoSettings)); } catch (e) {}
    const identity = sanitizeNyxIdentity(pengoSettings.identity);
    window.NYX_IDENTITY_PREFS = identity;
    window.NYX_SPECIAL_UNIT_PREFS = sanitizeSpecialUnits(pengoSettings.specialUnits);
    try { window.dispatchEvent(new CustomEvent('nyx:identity-changed', { detail:identity })); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('nyx:settings-changed', { detail:pengoSettings })); } catch (e) {}
    const root = document.documentElement;
    root.classList.toggle('nyx-whispers-off', !pengoSettings.whispers);
    root.classList.toggle('nyx-pattern-paused', pengoSettings.animation === 'pause');
    root.classList.toggle('nyx-pattern-off', pengoSettings.animation === 'stop');
    root.classList.toggle('nyx-khaenriah', !!pengoSettings.khaenriah);
  }, [pengoSettings]);

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
      '.sim-gbangrid',
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
      const preferred = candidates.find((el) => el.matches('.cm-pop-main,.cm-pop.ledger .cm-pop-layout,.cm-body,.gt-results,.db-grid,.tcg-grid,.sim-gbangrid,.gp-overview-main,.gp-overview-aside,.gp-codes-scroll,.overview-codes-scroll,.settings-pane,.nyx-pengo-menu.as-tab')) || candidates[0];
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
      const k = (window.history.state && window.history.state.nyxKey) || keyFromLocation() || 'nyx';
      setActiveKey(k);
      setTab((prev) => coerceTabForKey(k, prev));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const switchGame = (key) => {
    if (key === activeKey) return;
    setActiveKey(key);
    setTab((prev) => coerceTabForKey(key, prev));
    try {
      const href = GP_PAGE_HREF[key];
      if (href) window.history.pushState({ nyxKey:key }, '', href);
      const cfg = key === 'nyx' ? NYX_META : GAME_REGISTRY[key];
      const cfgName = cfg ? cfg.name : 'Hub';
      document.title = (cfgName && cfgName !== 'Nyx') ? 'Nyx \u2014 ' + cfgName : 'Nyx';
    } catch (e) {}
  };

  const isNyx = activeKey === 'nyx';
  const cfg = isNyx ? NYX_META : GAME_REGISTRY[activeKey];
  const openMaterialModal = (game, name) => setMaterialModal({ game, name });

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
        ? <SimContent tab={tab} setTab={setTab} onOpenMaterial={openMaterialModal} settings={pengoSettings} setSettings={setPengoSettings} />
        : <GameContent cfg={cfg} tab={tab} setTab={setTab} onOpenMaterial={openMaterialModal} settings={pengoSettings} setSettings={setPengoSettings} />}
      {materialModal && (
        <CharMaterials
          inline
          modalOnly
          game={materialModal.game}
          selectedName={materialModal.name}
          onClose={() => setMaterialModal(null)}
        />
      )}
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
