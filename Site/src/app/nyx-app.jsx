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

function artworkUrl(src, kind){
  return window.NyxArtwork ? window.NyxArtwork.url(src, kind) : src;
}

function artworkBgUrl(src, kind){
  if (!src) return undefined;
  return window.NyxArtwork ? window.NyxArtwork.bgImage(src, kind) : bgUrl(src);
}

function artworkImgProps(src, kind, extra){
  return window.NyxArtwork ? window.NyxArtwork.imgProps(src, kind, extra) : Object.assign({}, extra || {}, { src });
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

function overviewCardArt(cfg, ch, offset = 0){
  const pool = Array.isArray(ch.overviewArtPool)
    ? ch.overviewArtPool.filter(Boolean)
    : [];
  if (!pool.length) return ch.overviewArt || ch.art || ch.card || cfg.art;
  return pool[Math.abs(Number(offset) || 0) % pool.length];
}

function makeRoster(cfg){
  const source = cfg.roster || getCmRoster(cfg.key);
  if (!source || !source.length) return [{ id:cfg.key + '-main', name:cfg.charName, tag:'', art:cfg.art, icon:cfg.benchIcon }];
  const seen = new Set();
  const out = [];
  source.forEach((ch, i) => {
    const name = ch.n || ch.name;
    const key = String(name || '').toLowerCase();
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    out.push({
      id:ch.id || (cfg.key + '-' + i),
      name,
      rawName:ch.rawName,
      gameKey:cfg.key,
      gameName:cfg.name,
      aliases:ch.aliases || [],
      tag:rosterTag(ch),
      art:overviewCardArt(cfg, ch, i),
      overviewArtPool:ch.overviewArtPool,
      overviewArtZoom:ch.overviewArtZoom,
      icon:ch.icon || ch.circle || ch.card || cfg.benchIcon,
      rarity:ch.r,
      forms:ch.forms || [],
    });
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
    backgroundImage:artworkBgUrl(cardArt || ch.art || art, 'character'),
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

function Favourites({ cfg, onOpenMaterial }){
  const cmVersion = useCmGameVersion(cfg.key);
  const roster = React.useMemo(() => makeRoster(cfg), [cfg.key, cmVersion]);
  const [cards, setCards] = React.useState(() => loadPinnedCards(cfg, roster));
  const [hov, setHov] = React.useState(null);
  const [manage, setManage] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [w, setW] = React.useState(900);
  const ref = React.useRef(null);

  React.useEffect(() => {
    setCards(loadPinnedCards(cfg, roster));
    setHov(null);
    setManage(false);
    setQ('');
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

  const GAP = 16, ADDW = 72;
  const n = cards.length;
  const qq = q.trim().toLowerCase();
  const match = (ch) => appMatchesSearch(ch, qq);
  const pinnedIds = new Set(cards.map((ch) => ch.id));
  const candidates = roster.filter((ch) => !pinnedIds.has(ch.id) && match(ch)).slice(0, qq ? 24 : 12);
  const isFull = cards.length >= 5;
  const hasAdd = manage && candidates.length > 0 && !isFull;
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
    <div ref={ref} className={'gp-favs game-' + cfg.key + (manage ? ' manage' : '')} style={{ width:'100%' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'16px' }}>
        <GPSec title="Pinned Favourites" icon="../assets/decor/orbit_burst.png" style={{ flex:1, minWidth:0 }} />
        {manage && <div className="gp-search-wrap">
          <div className="gp-search">
            <span className="ic"></span>
            <input value={q} placeholder="Search Characters" spellCheck="false"
                   onChange={(e) => setQ(e.target.value)} />
            {q !== '' && <button type="button" className="x" title="Clear" onClick={() => setQ('')}>{'\u2715'}</button>}
          </div>
        </div>}
        <GPHex small fixw on={manage} onClick={() => setManage(m => !m)}>
          <span>{manage ? 'Done' : 'Edit'}</span>
        </GPHex>
      </div>
      <div className={'gp-cardrow' + (scroll ? ' scroll' : '')}
           style={{ justifyContent: scroll ? 'flex-start' : 'center' }}>
        {cards.map((c, i) => (
          <FavCardI key={c.id} ch={c} idx={i} w={cardW} hgt={cardH} dt={isDt('card', i)} faded={!match(c)} h={h} art={cfg.art} manage={manage} count={cards.length} />
        ))}
        {hasAdd && <AddSlot hgt={cardH} dt={isDt('add', 0)} h={h} />}
      </div>
      {manage && (
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
                <img {...artworkImgProps(ch.icon || cfg.benchIcon, 'character', { alt:'', draggable:'false' })} />
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
          ? <img {...artworkImgProps(currency.icon, 'item', { alt:currency.name, draggable:'false' })} />
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
  // G5: the "N more below" hint reflects how many code rows are still below the
  // scroll fold, recomputed live on scroll/resize (not a static count).
  const scrollRef = React.useRef(null);
  const [belowCount, setBelowCount] = React.useState(0);
  const recountBelow = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const fold = el.getBoundingClientRect().bottom;
    let n = 0;
    el.querySelectorAll('.gp-code-row').forEach((r) => { if (r.getBoundingClientRect().top > fold - 6) n += 1; });
    setBelowCount(n);
  }, []);
  React.useEffect(() => {
    recountBelow();
    window.addEventListener('resize', recountBelow);
    return () => window.removeEventListener('resize', recountBelow);
  }, [recountBelow, rows.length]);

  const renderGroup = (kind, list) => (
    list.length === 0 ? null : (
      <div className="codes-group" key={kind}>
        <div className="codes-group-hd">
          {kind === 'premium' && (currency.icon
            ? <img {...artworkImgProps(currency.icon, 'item', { alt:'', draggable:'false' })} />
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
      <div className="overview-codes-scroll" ref={scrollRef} onScroll={recountBelow}>
        {renderGroup('premium', premiumRows)}
        {renderGroup('other', plainRows)}
        {rows.length === 0 && <div className="code-empty">No redemption codes found.</div>}
      </div>
      {belowCount > 0 && (
        <div className="codes-more-hint" aria-hidden="true">
          <span className="chev">{'⌄'}</span>{belowCount} more below
        </div>
      )}
    </React.Fragment>
  );
}

/* shared overview right rail */
function OverviewAside({ cfg }){
  const b = cfg.banner;
  const phaseCards = bannerPhaseCards(cfg);
  const ongoing = phaseCards.filter((c) => c.status === 'Ongoing');
  const upcoming = phaseCards.filter((c) => c.status !== 'Ongoing');
  return (
    <aside style={{ display:'flex', flexDirection:'column', gap:'12px', minWidth:0, minHeight:0 }}>
      <GPSec title="Redemption Codes" />
      <CodesPanel codes={cfg.codes} gameKey={cfg.key} />
      <BannerFreshnessNote fresh={bannerFreshness(cfg.key)} />
      {ongoing.length > 0 ? ongoing.map((card, i) => (
        <GPBanner key={'on-' + card.five + '-' + i} compact h={150}
          art={card.art || cfg.art} title={card.title} status={card.status}
          five={card.five} fiveIcon={card.fiveIcon} chips={card.chips} time={card.time} pct={card.pct} />
      )) : (
        <GPBanner compact h={158} art={b.art || cfg.art} title={b.title}
          status="Database fallback" five={'5\u2605 ' + b.five}
          chips={(b.fours || []).map((name) => ({ key:name, text:name }))} time={b.time} pct={b.pct} />
      )}
      {upcoming.length > 0 && (
        <React.Fragment>
          {upcoming.map((card, i) => (
            <GPBanner key={'up-' + card.five + '-' + i} compact next h={84}
              art={card.art || cfg.art} title={card.title} status={card.status}
              five={card.five} fiveIcon={card.fiveIcon} chips={card.chips} time={card.time} pct={card.pct} />
          ))}
        </React.Fragment>
      )}
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
        {ch.icon ? <img {...artworkImgProps(ch.icon, 'character', { alt:'', draggable:'false' })} /> : <span>{simInitials(ch.name)}</span>}
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
      <div className="art" style={{ backgroundImage:artworkBgUrl(g.bg, 'banner'), backgroundPosition:g.pos }}></div>
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
        {item.art ? <img {...artworkImgProps(item.art, 'item', { alt:'', draggable:'false' })} /> : <span>{simInitials(item.name)}</span>}
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

/* ================= content panels ================= */
// Keyboard activation for role="button" nav rows (Enter / Space).
function navKeyDown(fn){
  return (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); fn(); } };
}

function GameContent({ cfg, tab, setTab, onOpenMaterial }){
  const fns = cfg.fns || ['Character Materials','Artifact Sorter','Wish Tracker'];
  // G13: the section list the Character-Materials header icon-dropdown switches between.
  const sectionKey = (f) => /tracker$/i.test(f) ? 'tracker' : /^character materials$/i.test(f) ? 'mats' : 'library';
  const sections = [{ key:'overview', label:'Overview' }, ...fns.map((f) => ({ key:sectionKey(f), label:f }))];
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
      </nav>

      {tab === 'overview' && (
        <main className="gp-main-pane">
          <Favourites key={cfg.key} cfg={cfg} onOpenMaterial={onOpenMaterial} />
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

      {tab === 'overview' && <OverviewAside cfg={cfg} />}
    </div>
  );
}

function SimContent({ tab, setTab, onOpenMaterial }){
  const NAV = [
    { key:'overview', label:'Overview' },
    { key:'pulls',    label:'Pull Overview' },
    { key:'codes',    label:'All Redemption Codes' },
    { key:'banners',  label:'All Banners' },
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
        <main className="gp-main-pane">
          <Favourites key="nyx" cfg={NYX_META} onOpenMaterial={onOpenMaterial} />
        </main>
      )}
      {tab === 'pulls' && <main className="gp-main-pane fill"><PullsOverview /></main>}
      {tab === 'codes' && <main className="gp-main-pane fill"><AllCodesView /></main>}
      {tab === 'banners' && <main className="gp-main-pane fill"><AllBannersView /></main>}
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
  return key === 'nyx' ? ['overview','pulls','codes','banners'] : ['overview','mats','library','tracker'];
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
  artworkQuality: 'original',
  khaenriah: false,
  displayGames: NYX_PENGO_DISPLAY_DEFAULTS,
  identity: NYX_IDENTITY_DEFAULTS,
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

function loadPengoSettings(){
  try {
    const raw = JSON.parse(localStorage.getItem(NYX_PENGO_SETTINGS_KEY) || '{}');
    return Object.assign({}, NYX_PENGO_DEFAULTS, raw, {
      animation: ['play', 'pause', 'stop'].includes(raw.animation) ? raw.animation : NYX_PENGO_DEFAULTS.animation,
      artworkQuality: raw.artworkQuality === 'faster' ? 'faster' : NYX_PENGO_DEFAULTS.artworkQuality,
      displayGames: Object.assign({}, NYX_PENGO_DISPLAY_DEFAULTS, raw.displayGames || {}),
      identity: sanitizeNyxIdentity(raw.identity),
      energy: clampPengoNumber(raw.energy ?? NYX_PENGO_DEFAULTS.energy, 1, 69),
      spawn: clampPengoNumber(raw.spawn ?? NYX_PENGO_DEFAULTS.spawn, 0, 9999),
      sacrifice: clampPengoNumber(raw.sacrifice ?? NYX_PENGO_DEFAULTS.sacrifice, 0, 9999),
    });
  } catch (e) {
    return Object.assign({}, NYX_PENGO_DEFAULTS);
  }
}

function PengoMenu({ settings, setSettings }){
  const update = (patch) => setSettings((prev) => Object.assign({}, prev, patch));
  const [syncSecret, setSyncSecret] = React.useState('');
  const [syncBusy, setSyncBusy] = React.useState(false);
  const [syncStatus, setSyncStatus] = React.useState('');
  const identity = sanitizeNyxIdentity(settings.identity);
  const setIdentity = (group, value) => update({ identity:Object.assign({}, identity, { [group]:value }) });
  const opusCount = clampPengoNumber(settings.spawn ?? settings.sacrifice ?? NYX_PENGO_DEFAULTS.spawn, 0, 9999);
  const setOpusCount = (value) => {
    const next = clampPengoNumber(value, 0, 9999);
    update({ spawn:next, sacrifice:next });
  };
  const bumpOpusCount = (delta) => setOpusCount(opusCount + delta);
  const toggleDisplayGame = (key) => update({
    displayGames: Object.assign({}, NYX_PENGO_DISPLAY_DEFAULTS, settings.displayGames || {}, {
      [key]: !((settings.displayGames || {})[key] !== false),
    }),
  });
  const resetInterface = () => update({
    whispers: NYX_PENGO_DEFAULTS.whispers,
    animation: NYX_PENGO_DEFAULTS.animation,
    artworkQuality: NYX_PENGO_DEFAULTS.artworkQuality,
    khaenriah: NYX_PENGO_DEFAULTS.khaenriah,
    displayGames: Object.assign({}, NYX_PENGO_DISPLAY_DEFAULTS),
  });
  const resetOpus = () => update({
    lapis: NYX_PENGO_DEFAULTS.lapis,
    energy: NYX_PENGO_DEFAULTS.energy,
    spawn: NYX_PENGO_DEFAULTS.spawn,
    sacrifice: NYX_PENGO_DEFAULTS.sacrifice,
  });
  const nextAnim = settings.animation === 'play' ? 'pause' : (settings.animation === 'pause' ? 'stop' : 'play');
  const animIcon = settings.animation === 'play' ? '\u25b6' : (settings.animation === 'pause' ? '\u23f8' : '\u25a0');
  const syncPreferences = async (mode) => {
    if (!window.NyxArtwork || !syncSecret.trim()) return;
    setSyncBusy(true);
    setSyncStatus('');
    try {
      if (mode === 'push') {
        await window.NyxArtwork.pushPreferences(syncSecret, { artworkQuality:settings.artworkQuality });
        setSyncStatus('Saved');
      } else {
        const result = await window.NyxArtwork.pullPreferences(syncSecret);
        const pref = result && result.preferences && result.preferences.artworkQuality;
        if (pref) update({ artworkQuality:pref });
        setSyncStatus(pref ? 'Restored' : 'No preferences');
      }
    } catch (e) {
      setSyncStatus(e && e.message ? e.message : 'Sync failed');
    } finally {
      setSyncBusy(false);
    }
  };
  return (
    <div className="nyx-pengo-menu" role="dialog" aria-label="Pengo settings" onClick={(e) => e.stopPropagation()}>
      <section>
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
      <section>
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
        <div className="pm-quality-row" role="group" aria-label="Artwork quality">
          <span>Artwork quality</span>
          <div className="pm-segments">
            <button type="button" className={settings.artworkQuality !== 'faster' ? 'on' : ''}
                    aria-pressed={settings.artworkQuality !== 'faster'}
                    onClick={() => update({ artworkQuality:'original' })}>Original</button>
            <button type="button" className={settings.artworkQuality === 'faster' ? 'on' : ''}
                    aria-pressed={settings.artworkQuality === 'faster'}
                    onClick={() => update({ artworkQuality:'faster' })}>Faster</button>
          </div>
        </div>
        <div className="pm-pref-sync">
          <input
            type="password"
            value={syncSecret}
            autoComplete="off"
            placeholder="Sync phrase"
            aria-label="Preference sync phrase"
            onChange={(e) => setSyncSecret(e.target.value)}
          />
          <button type="button" disabled={syncBusy || !syncSecret.trim()} onClick={() => syncPreferences('push')}>Save</button>
          <button type="button" disabled={syncBusy || !syncSecret.trim()} onClick={() => syncPreferences('pull')}>Restore</button>
          {syncStatus && <span className="pm-sync-status">{syncStatus}</span>}
        </div>
        <button type="button" className="pm-row" data-tip="Change all fonts to the Ancient(Khaenri'ahn) Script"
                onClick={() => update({ khaenriah:!settings.khaenriah })}>
          <span>Welcome to Khaenri'ah</span><b className="pm-state">{settings.khaenriah ? 'On' : 'Off'}</b>
        </button>
        <div className="pm-display-games">
          <span>Display Games</span>
          <div className="pm-game-icons" aria-label="Display games">
            {SIM_GAMES.map((game) => {
              const on = (settings.displayGames || {})[game.key] !== false;
              return (
                <button key={game.key} type="button" className={on ? 'on' : ''} title={game.name}
                        aria-label={'Display ' + game.name} aria-pressed={on}
                        onClick={() => toggleDisplayGame(game.key)}>
                  <img src={game.icon} alt="" draggable="false" />
                </button>
              );
            })}
          </div>
        </div>
        <button type="button" className="pm-reset" data-tip="Reset the interface to default" onClick={resetInterface}>Reset</button>
      </section>
      <section>
        <h3>Who are you?</h3>
        <div className="pm-identity-list">
          {NYX_IDENTITY_GROUPS.map((group) => (
            <div key={group.key} className="pm-identity-row" data-tip={group.tip}>
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
          ))}
        </div>
      </section>
    </div>
  );
}

function NyxChannelToggle({ gameKey }){
  const [channel, setChannel] = React.useState(() => cmLoadChannel(gameKey));
  React.useEffect(() => { setChannel(cmLoadChannel(gameKey)); }, [gameKey]);
  const betaAvailable = cmHasBeta(gameKey);
  const pick = (ch) => {
    const next = ch === 'beta' && !betaAvailable ? 'live' : ch;
    setChannel(next);
    cmSaveChannel(gameKey, next);
    try { window.dispatchEvent(new CustomEvent('nyx:cm-channel-changed', { detail:{ key:gameKey, channel:next } })); } catch (e) {}
  };
  const isBeta = betaAvailable && channel === 'beta';
  const toggle = () => pick(isBeta ? 'live' : 'beta');
  return (
    <div className={'cm-chan-switch' + (isBeta ? ' beta' : ' live') + (betaAvailable ? '' : ' no-beta')}
         role="group" aria-label="Data channel: Live or Beta" onClick={toggle}
         title={betaAvailable ? undefined : 'Beta data is not available for this game yet'}>
      <button type="button" className={'cm-chan-option live-option' + (!isBeta ? ' on' : '')} aria-pressed={!isBeta}
              title="Released, live-server data" onClick={(e) => { e.stopPropagation(); pick('live'); }}>Live</button>
      <span className="cm-chan-medallion" aria-hidden="true">
        <img src="../assets/icon/pengoemote.png" alt="" draggable="false" />
      </span>
      <button type="button" className={'cm-chan-option beta-option' + (isBeta ? ' on' : '')} aria-pressed={isBeta}
              aria-disabled={!betaAvailable} onClick={(e) => { e.stopPropagation(); pick('beta'); }}
              title={betaAvailable ? 'Beta (latest) data - upcoming, subject to change' : 'No beta data available yet'}>Beta</button>
    </div>
  );
}

function NyxApp(){
  const initialKey = (window.GP_PAGE && window.GP_PAGE.key) || keyFromLocation() || 'nyx';
  const [activeKey, setActiveKey] = React.useState(initialKey);
  const [tab, setTab] = React.useState(DEFAULT_TAB(initialKey));
  const [materialModal, setMaterialModal] = React.useState(null);
  const [pengoMenuOpen, setPengoMenuOpen] = React.useState(false);
  const [pengoSettings, setPengoSettings] = React.useState(loadPengoSettings);
  const cornerRef = React.useRef(null);
  useCmGameVersion(activeKey);

  React.useEffect(() => {
    try { localStorage.setItem(NYX_PENGO_SETTINGS_KEY, JSON.stringify(pengoSettings)); } catch (e) {}
    const identity = sanitizeNyxIdentity(pengoSettings.identity);
    window.NYX_IDENTITY_PREFS = identity;
    try { window.dispatchEvent(new CustomEvent('nyx:identity-changed', { detail:identity })); } catch (e) {}
    const root = document.documentElement;
    root.classList.toggle('nyx-whispers-off', !pengoSettings.whispers);
    root.classList.toggle('nyx-pattern-paused', pengoSettings.animation === 'pause');
    root.classList.toggle('nyx-pattern-off', pengoSettings.animation === 'stop');
    root.classList.toggle('nyx-khaenriah', !!pengoSettings.khaenriah);
    if (window.NyxArtwork) window.NyxArtwork.applyQuality(pengoSettings.artworkQuality);
    try { window.dispatchEvent(new CustomEvent('nyx:artwork-quality-changed', { detail:{ artworkQuality:pengoSettings.artworkQuality } })); } catch (e) {}
  }, [pengoSettings]);

  React.useEffect(() => {
    if (!pengoMenuOpen) return;
    const onPointer = (event) => {
      if (cornerRef.current && !cornerRef.current.contains(event.target)) setPengoMenuOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setPengoMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [pengoMenuOpen]);

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
          <GPGameRail active={activeKey} onSwitch={switchGame} displayGames={pengoSettings.displayGames} />
        </div>
      </header>

      <div className="gp-corner" ref={cornerRef}>
        <div className="gp-corner-actions">
          <a className="gp-kofi" href="https://ko-fi.com/asyce" target="_blank" rel="noopener noreferrer" title="Ko-fi" aria-label="Ko-fi">
            <img src="../assets/icon/kofi-logo.png" alt="" draggable="false" />
          </a>
          <button type="button" className={'tb-pengo corner menu-trigger' + (pengoMenuOpen ? ' on' : '')}
                  title="Pengo menu" aria-label="Pengo menu" aria-expanded={pengoMenuOpen}
                  onClick={() => setPengoMenuOpen((open) => !open)}>
            <img src="../assets/icon/pengo.png" alt="" draggable="false" />
          </button>
        </div>
        {pengoMenuOpen && <PengoMenu settings={pengoSettings} setSettings={setPengoSettings} />}
        {!isNyx && <NyxChannelToggle gameKey={activeKey} />}
      </div>

      {isNyx
        ? <SimContent tab={tab} setTab={setTab} onOpenMaterial={openMaterialModal} />
        : <GameContent cfg={cfg} tab={tab} setTab={setTab} onOpenMaterial={openMaterialModal} />}
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
