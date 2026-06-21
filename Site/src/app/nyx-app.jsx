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

function rarityValue(r){
  if (r === 'S') return 5;
  if (r === 'A') return 4;
  return Number(r) || 0;
}

let GP_DRAG = null; // { zone:'card', idx }

function copyText(txt){
  try { navigator.clipboard.writeText(txt); } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e2) {}
    ta.remove();
  }
}

function rewardParts(text){
  return String(text || 'Rewards')
    .split(/\s*(?:\u00B7|,|\+)\s*/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function RewardChips({ reward, limit = 2 }){
  const parts = rewardParts(reward);
  const visible = parts.slice(0, limit);
  const hidden = parts.slice(limit);
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
  const rows = ((window.NYX_DB && window.NYX_DB.codes && window.NYX_DB.codes.games && window.NYX_DB.codes.games[key]) || dbGame(key)?.codes || [])
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
  return rows.length ? rows : fallback;
}

function dbBannerGroup(key){
  return (window.NYX_DB && window.NYX_DB.banners && window.NYX_DB.banners.games && window.NYX_DB.banners.games[key]) || dbGame(key)?.banners || null;
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

function phaseTimeLabel(phase){
  const end = phase && phase.end ? new Date(phase.end).getTime() : NaN;
  const start = phase && phase.start ? new Date(phase.start).getTime() : NaN;
  const now = Date.now();
  if (Number.isFinite(end)) return (end >= now ? 'Ends in ' : 'Ended ') + shortDuration(end - now);
  if (Number.isFinite(start)) return (start >= now ? 'Starts in ' : 'Started ') + shortDuration(start - now);
  return null;
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
  const add = (phase, status) => {
    const chars = phase?.characters || [];
    if (!chars.length) return;
    const first = chars[0];
    cards.push({
      title:phase.phase || cfg.banner?.title || status,
      status,
      five:(first.rarity || 5) + '\u2605 ' + first.name,
      fiveIcon:first.icon || null,
      chips:chars.slice(1).map((ch, i) => ({
        key:(ch.name || 'char') + '-' + i,
        text:(ch.rarity || '') + (ch.rarity ? '\u2605 ' : '') + ch.name,
        icon:ch.icon || null,
      })),
      time:phaseTimeLabel(phase) || 'Date pending',
      pct:phasePct(phase, cfg.banner?.pct || 42),
      art:first.art || first.icon || cfg.art,
    });
  };
  add(group.current, 'Ongoing');
  add(group.next, 'Next');
  (group.upcoming || []).slice(0, 2).forEach((phase) => add(phase, 'Upcoming'));
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
function FavCardI({ ch, idx, w, hgt, dt, faded, h, art }){
  const cardArt = overviewCardArt({ art }, ch, idx);
  const artStyle = {
    backgroundImage:bgUrl(cardArt || ch.art || art),
    ...(ch.overviewArtZoom ? { backgroundSize:Math.round(Number(ch.overviewArtZoom || 1) * 100) + '% auto' } : {}),
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
      onDragEnd={h.end}>
      <div className="artwrap">
        <div className="art" style={artStyle}></div>
        <div className="scrim"></div>
      </div>
      <div className="frame"></div>
      <div className="ctl">
        <button type="button" className="tr" title="Unpin favourite"
                onClick={(e) => { e.stopPropagation(); h.remove(idx); }}>Unpin</button>
      </div>
      <div className="nm">{ch.name}{ch.tag ? <span className="sub"> {ch.tag}</span> : null}</div>
    </div>
  );
}

function AddSlot({ hgt, dt, h }){
  return (
    <div className={'gp-add' + (dt ? ' dt' : '')}
         style={{ width:'72px', height:hgt + 'px' }}
         title="Pin a favourite \u2014 click, or drag an icon here"
         onClick={h.add}
         onDragOver={(e) => { e.preventDefault(); h.over('add', 0); }}
         onDragLeave={() => h.leave('add', 0)}
         onDrop={(e) => { e.preventDefault(); h.drop('add', 0); }}>
      <span className="fr"></span>
      <span className="plus">+</span>
    </div>
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
          <FavCardI key={c.id} ch={c} idx={i} w={cardW} hgt={cardH} dt={isDt('card', i)} faded={!match(c)} h={h} art={cfg.art} />
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

/* ---------------- overview-aside redemption codes ---------------- */
function CodeCardRow({ row, onCopy, onRowAction, isNew }){
  const r = row;
  return (
    <div className={'gp-code st-' + r.st + (r.premium ? ' premium' : '') + (isNew ? ' is-new' : '')}>
      <div className="code-main">
        {r.redeemUrl
          ? <a className="cc" href={r.redeemUrl} target="_blank" rel="noopener noreferrer" onClick={() => onRowAction(r.code, 'redeem')}>{r.code}</a>
          : <span className="cc">{r.code}</span>}
        {r.premium && <span className="premium-dot"></span>}
        {isNew && r.st !== 'redeemed' && <span className="newtag">NEW</span>}
      </div>
      <div className="code-actions">
        <button type="button" className={'cp icon' + (r.st === 'copied' ? ' ask' : '')}
                title="Copy code" aria-label={'Copy ' + r.code} onClick={() => onCopy(r.code)}>
          <span className="i-copy"></span>
        </button>
        <button type="button" className="mark" onClick={() => onRowAction(r.code, 'toggle')}>
          {r.st === 'redeemed' ? 'Undo' : r.st === 'copied' ? 'Save' : 'Done'}
        </button>
      </div>
      <div className="rw"><RewardChips reward={r.reward} /></div>
    </div>
  );
}

function CodesPanel({ codes, gameKey = 'nyx' }){
  const sourceCodes = codes || [];
  const currency = premiumCodeMeta(gameKey, sourceCodes);
  const hasPremiumRows = sourceCodes.some((c) => c.premium);
  const [premiumOnly, setPremiumOnly] = React.useState(true);
  const [copiedCode, setCopiedCode] = React.useState(null);
  const [redeemed, setRedeemed] = React.useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('nyx:redeemed-codes:v1') || '[]')); }
    catch (e) { return new Set(); }
  });
  const filterActive = premiumOnly && hasPremiumRows;
  const visibleCodes = sourceCodes.filter((c) => !filterActive || c.premium);
  const rows = visibleCodes.map(c => ({
    ...c,
    st:redeemed.has(c.code) ? 'redeemed' : copiedCode === c.code ? 'copied' : 'new',
  }));
  const saveRedeemed = (next) => {
    setRedeemed(next);
    try { localStorage.setItem('nyx:redeemed-codes:v1', JSON.stringify([...next])); } catch (e) {}
  };
  const markRedeemed = (code) => {
    const next = new Set(redeemed);
    next.add(code);
    saveRedeemed(next);
    setCopiedCode(null);
  };
  const onCopy = (code) => {
    copyText(code);
    if (!redeemed.has(code)) setCopiedCode(code);
  };
  const undoRedeemed = (code) => {
    const next = new Set(redeemed);
    next.delete(code);
    saveRedeemed(next);
    setCopiedCode(null);
  };
  const onRowAction = (code) => {
    const r = rows.find(row => row.code === code);
    if (!r) return;
    if (r.st === 'redeemed') undoRedeemed(code);
    else markRedeemed(code);
  };
  return (
    <React.Fragment>
      <label className={'code-filter' + (filterActive ? ' on' : '') + (!hasPremiumRows ? ' disabled' : '')}>
        <input type="checkbox" checked={filterActive} disabled={!hasPremiumRows} onChange={(e) => setPremiumOnly(e.target.checked)} />
        {currency.icon ? <img src={currency.icon} alt="" draggable="false" /> : <span className="cur-glyph"></span>}
        <span className="code-filter-text"><b>{currency.name}</b><small>{rows.length}/{sourceCodes.length}</small></span>
      </label>
      <div className="gp-codes-scroll overview-codes" style={{ flex:'0 0 auto', minHeight:'120px', maxHeight:'318px' }}>
        {rows.map(r => (
          <CodeCardRow key={r.code} row={r} onCopy={onCopy} onRowAction={(code, action) => action === 'redeem' ? markRedeemed(code) : onRowAction(code)} />
        ))}
        {rows.length === 0 && <div className="code-empty">No premium-currency codes found.</div>}
      </div>
    </React.Fragment>
  );
}

/* shared overview right rail */
function OverviewAside({ cfg }){
  const b = cfg.banner;
  const phaseCards = bannerPhaseCards(cfg);
  return (
    <aside style={{ display:'flex', flexDirection:'column', gap:'12px', minWidth:0, minHeight:0 }}>
      <GPSec title="Redemption Codes" />
      <CodesPanel codes={cfg.codes} gameKey={cfg.key} />
      <GPSec title="Ongoing Banners" />
      {phaseCards.length > 0 ? phaseCards.map((card, i) => (
        <GPBanner key={card.status + '-' + i} compact h={i === 0 ? 158 : 136}
          art={card.art || cfg.art} title={card.title} status={card.status}
          five={card.five} fiveIcon={card.fiveIcon} chips={card.chips} time={card.time} pct={card.pct} />
      )) : (
        <GPBanner compact h={158} art={b.art || cfg.art} title={b.title}
          status="Database fallback" five={'5\u2605 ' + b.five}
          chips={(b.fours || []).map((name) => ({ key:name, text:name }))} time={b.time} pct={b.pct} />
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

/* ================= content panels ================= */
function GameContent({ cfg, tab, setTab, onOpenMaterial }){
  const fns = cfg.fns || ['Character Materials','Artifact Sorter','Wish Tracker'];
  return (
    <div className={'gp-layout' + (tab === 'overview' ? ' has-aside' : '')}>
      <nav className="gp-side-nav">
        <div className={'gp-fn-row click' + (tab === 'overview' ? ' on' : '')} onClick={() => setTab('overview')}><span>Overview</span></div>
        {fns.map(f => {
          const isTracker = /tracker$/i.test(f);
          const isMats = /^character materials$/i.test(f);
          const key = isTracker ? 'tracker' : isMats ? 'mats' : 'library';
          return (
            <div key={f} className={'gp-fn-row click' + (tab === key ? ' on' : '')}
                 onClick={() => setTab(key)}>
              <span>{f}</span><span className="go">{'\u203A'}</span>
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
          <CharMaterials inline game={cfg.key} />
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
      <nav className="gp-side-nav">
        {NAV.map(n => (
          <div key={n.key} className={'gp-fn-row click' + (tab === n.key ? ' on' : '')} onClick={() => setTab(n.key)}>
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

function NyxApp(){
  const initialKey = (window.GP_PAGE && window.GP_PAGE.key) || keyFromLocation() || 'nyx';
  const [activeKey, setActiveKey] = React.useState(initialKey);
  const [tab, setTab] = React.useState(DEFAULT_TAB(initialKey));
  const [materialModal, setMaterialModal] = React.useState(null);
  useCmGameVersion(activeKey);

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
      ball.style.transform = 'translate(' + (Math.cos(a) * r * 14.5).toFixed(1) + 'px,' + (Math.sin(a) * r * 6).toFixed(1) + 'px)';
      tm = setTimeout(wander, 1100 + Math.random() * 1900);
    })();
    return () => clearTimeout(tm);
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
        <a className="tb-eye" href="index.html" title="Back to Worlds" aria-label="Back to Worlds">
          <span className="elayer ball" id="tbBall"></span>
          <span className="elayer lid"></span>
          <span className="elayer drips"></span>
        </a>
        <div className="tb-center">
          <GPGameRail active={activeKey} onSwitch={switchGame} />
        </div>
        <div className="tb-right" aria-hidden="true">
          <span className="plate"></span>
          <span className="wm">Nyx</span>
        </div>
      </header>

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
})();

ReactDOM.createRoot(document.getElementById('app')).render(<NyxApp />);
