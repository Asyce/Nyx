// ============================================================
// Nyx — Character Materials (Art of Khemia)
// Data-driven from window.CM_CFG (cm-data.jsx, loaded first).
// Per game: Roster + a material tab (Talents/Traces/Chips/Skills)
// + a boss tab (Trounce Domain / Echo of War / Notorious Hunt /
// Weekly Challenge). Search, per-game filter panel, owned toggle,
// Genshin day-of-week selector. Click a unit -> material popup.
// ============================================================

const CM_GAME_KEYS = ['gi', 'hsr', 'zzz', 'wuwa', 'ae'];
const CM_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CM_GLYPHS = ['\u25C8', '\u2726', '\u2756', '\u25C9', '\u2736', '\u2B22', '\u273F', '\u265B'];
const CM_GI_PRESETS = [
  { key:'6-6-6', label:'6/6/6', targets:[6, 6, 6] },
  { key:'6-9-9', label:'6/9/9', targets:[6, 9, 9] },
  { key:'9-9-9', label:'9/9/9', targets:[9, 9, 9] },
  { key:'10-10-10', label:'10/10/10', targets:[10, 10, 10] },
];
const CM_GI_TALENT_LABELS = ['Normal Attack', 'Elemental Skill', 'Elemental Burst'];
const CM_GI_TALENT_SHORT = ['NA', 'Skill', 'Burst'];
// Per-game talent/trace input config: labels, short codes, and the max level of
// each (GI talents max 10; HSR Basic ATK maxes at 6, Skill/Ultimate/Talent at 10).
const CM_TALENT_CFG = {
  gi:  { labels:CM_GI_TALENT_LABELS, short:CM_GI_TALENT_SHORT, max:[10, 10, 10] },
  hsr: { labels:['Basic ATK', 'Skill', 'Ultimate', 'Talent'], short:['Basic', 'Skill', 'Ult', 'Talent'], max:[6, 10, 10, 10] },
};
const CM_IDENTITY_SETTINGS_KEY = 'nyx-pengo-settings';
const CM_IDENTITY_DEFAULTS = { twin:'aether', receptacle:'caelus', sibling:'wise', rover:'male', endmin:'male' };
const CM_IDENTITY_ALLOWED = {
  twin:['aether', 'lumine', 'paimon', 'little_one', 'arama'],
  receptacle:['caelus', 'stelle', 'pom_pom', 'gepard', 'trash'],
  sibling:['wise', 'belle', 'eous', 'fairy', 'phaethon'],
  rover:['male', 'female', 'abby'],
  endmin:['male', 'female', 'penguin'],
};
const CM_IDENTITY_ASSETS = {
  gi:{
    paimon:{ label:'Paimon', icon:'../assets/icon/paimon-moments.jpg', iconZoom:1.08, iconPosition:'50% 48%' },
    little_one:{ label:'Little One', icon:'../assets/icon/little-one.png', iconZoom:1.05, iconPosition:'50% 50%' },
    arama:{ label:'Arama', icon:'../assets/icon/arama.png', iconZoom:1.05, iconPosition:'50% 50%' },
  },
  hsr:{
    caelus:{ label:'Caelus', iconZoom:1.42, iconPosition:'28% 26%' },
    stelle:{ label:'Stelle', iconZoom:1.42, iconPosition:'73% 26%' },
    pom_pom:{ label:'Pom-Pom', icon:'../assets/icon/pom-pom.png', iconZoom:1.08, iconPosition:'50% 50%' },
    gepard:{ label:'Gepard?', icon:'../assets/icon/gepard-question.png', iconZoom:1.08, iconPosition:'50% 50%' },
    trash:{ label:'I am Trash', icon:'../assets/icon/i-am-trash.png', iconZoom:1.08, iconPosition:'50% 50%' },
  },
  zzz:{
    wise:{ label:'Wise', icon:'../assets/icon/wise-proxy.png', iconZoom:2.18, iconPosition:'50% 12%' },
    belle:{ label:'Belle', icon:'../assets/icon/belle-proxy.png', iconZoom:2.05, iconPosition:'50% 12%' },
    eous:{ label:'Eous', icon:'../assets/icon/eous.png', iconZoom:1.82, iconPosition:'50% 16%' },
    fairy:{ label:'Fairy', icon:'../assets/icon/fairy.png', iconZoom:1.03, iconPosition:'50% 50%' },
    phaethon:{ label:'Phaethon', icon:'../assets/icon/phaethon-emblem.png', iconZoom:1.05, iconPosition:'50% 50%' },
  },
  wuwa:{
    male:{ label:'Male Rover', icon:'../../Database/Nanoka/ww/assets/items/UIResources/Common/Image/IconA/T_IconA_RoverSkinMale.webp', iconZoom:1.08, iconPosition:'50% 35%' },
    female:{ label:'Female Rover', icon:'../../Database/Nanoka/ww/assets/items/UIResources/Common/Image/IconA/T_IconA_RoverSkinFemale.webp', iconZoom:1.08, iconPosition:'50% 35%' },
    abby:{ label:'Abby', icon:'../assets/icon/abby-rover.png', iconZoom:1.03, iconPosition:'50% 24%' },
  },
  ae:{
    penguin:{ label:'Penguin', icon:'../assets/icon/endminguin.png', iconZoom:1.68, iconPosition:'50% 12%' },
  },
};

function cmSanitizeIdentityPrefs(raw){
  const src = (raw && typeof raw === 'object') ? raw : {};
  const next = Object.assign({}, CM_IDENTITY_DEFAULTS);
  Object.keys(CM_IDENTITY_ALLOWED).forEach((key) => {
    if (CM_IDENTITY_ALLOWED[key].includes(src[key])) next[key] = src[key];
  });
  return next;
}

function cmIdentityPrefsKey(prefs){
  const safe = cmSanitizeIdentityPrefs(prefs);
  return ['twin', 'receptacle', 'sibling', 'rover', 'endmin'].map((key) => safe[key]).join('|');
}

function cmLoadIdentityPrefs(){
  try {
    if (typeof window !== 'undefined' && window.NYX_IDENTITY_PREFS) {
      return cmSanitizeIdentityPrefs(window.NYX_IDENTITY_PREFS);
    }
    const raw = JSON.parse(localStorage.getItem(CM_IDENTITY_SETTINGS_KEY) || '{}');
    return cmSanitizeIdentityPrefs(raw.identity);
  } catch (e) {
    return Object.assign({}, CM_IDENTITY_DEFAULTS);
  }
}

const CM_LANGUAGE_DEFAULTS = { gi:'en', hsr:'en', zzz:'en', wuwa:'en', ae:'en' };
const CM_LANGUAGE_ALLOWED = ['en', 'zh', 'ja', 'ko'];

function cmSanitizeLanguagePrefs(raw){
  const src = (raw && typeof raw === 'object') ? raw : {};
  const next = Object.assign({}, CM_LANGUAGE_DEFAULTS);
  Object.keys(CM_LANGUAGE_DEFAULTS).forEach((key) => {
    if (CM_LANGUAGE_ALLOWED.includes(src[key])) next[key] = src[key];
  });
  return next;
}

function cmLanguagePrefsKey(prefs){
  const safe = cmSanitizeLanguagePrefs(prefs);
  return Object.keys(CM_LANGUAGE_DEFAULTS).map((key) => safe[key]).join('|');
}

function cmLoadLanguagePrefs(){
  try {
    if (typeof window !== 'undefined' && window.NYX_LANGUAGE_PREFS) {
      return cmSanitizeLanguagePrefs(window.NYX_LANGUAGE_PREFS);
    }
    const raw = JSON.parse(localStorage.getItem(CM_IDENTITY_SETTINGS_KEY) || '{}');
    return cmSanitizeLanguagePrefs(raw.language);
  } catch (e) {
    return Object.assign({}, CM_LANGUAGE_DEFAULTS);
  }
}

function cmAlwaysBetaEnabled(){
  try {
    if (typeof window !== 'undefined' && window.NYX_ALWAYS_BETA === true) return true;
    const raw = JSON.parse(localStorage.getItem(CM_IDENTITY_SETTINGS_KEY) || '{}');
    return raw.alwaysBeta === true;
  } catch (e) {
    return false;
  }
}

const CM_SPECIAL_UNIT_DEFAULTS = {
  gi: { aloy:true },
  hsr: { archer:true, saber:true, rin_tohsaka:true, gilgamesh:true },
  wuwa: { lucy:true, rebecca:true },
};
const CM_SPECIAL_UNIT_NAMES = {
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

function cmNormalizeUnitName(name){
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function cmSanitizeSpecialUnitPrefs(raw){
  const src = (raw && typeof raw === 'object') ? raw : {};
  const next = {};
  Object.keys(CM_SPECIAL_UNIT_DEFAULTS).forEach((gameKey) => {
    next[gameKey] = Object.assign({}, CM_SPECIAL_UNIT_DEFAULTS[gameKey], src[gameKey] || {});
    Object.keys(CM_SPECIAL_UNIT_DEFAULTS[gameKey]).forEach((unitKey) => {
      next[gameKey][unitKey] = next[gameKey][unitKey] !== false;
    });
  });
  return next;
}

function cmLoadSpecialUnitPrefs(){
  try {
    if (typeof window !== 'undefined' && window.NYX_SPECIAL_UNIT_PREFS) {
      return cmSanitizeSpecialUnitPrefs(window.NYX_SPECIAL_UNIT_PREFS);
    }
    const raw = JSON.parse(localStorage.getItem(CM_IDENTITY_SETTINGS_KEY) || '{}');
    return cmSanitizeSpecialUnitPrefs(raw.specialUnits);
  } catch (e) {
    return cmSanitizeSpecialUnitPrefs();
  }
}

function cmSpecialUnitKey(gameKey, name){
  const map = CM_SPECIAL_UNIT_NAMES[gameKey] || {};
  const n = cmNormalizeUnitName(name);
  return Object.keys(map).find((key) => (map[key] || []).some((alias) => n === cmNormalizeUnitName(alias))) || null;
}

function cmSpecialUnitVisible(gameKey, ch, prefs){
  const unitKey = cmSpecialUnitKey(gameKey, ch && (ch.n || ch.rawName || ch.baseName));
  if (!unitKey) return true;
  const safe = cmSanitizeSpecialUnitPrefs(prefs);
  return !safe[gameKey] || safe[gameKey][unitKey] !== false;
}

// Genshin ascension is 6 phases unlocked at Lv 20/40/50/60/70/80, each capping
// the level at 40/50/60/70/80/90. The material quantities per phase are
// universal (identical for every character — only the gem/boss/specialty/mob
// identities differ), so we can rebuild the cost for any target max level from
// the flat to-90 list the data already carries. Selectable max levels and the
// number of ascension phases each requires:
// Per-game max character level (GI/WuWa 90, HSR 80, ZZZ 60, Endfield 80).
const CM_GAME_MAX_LEVEL = { gi:90, hsr:80, zzz:60, wuwa:90, ae:80 };
// per-phase (A1..A6) quantities for each universal GI ascension slot
const CM_GI_ASC_PATTERN = {
  gem1:[1,0,0,0,0,0], gem2:[0,3,6,0,0,0], gem3:[0,0,0,3,6,0], gem4:[0,0,0,0,0,6],
  specialty:[3,10,20,30,45,60], boss:[0,2,4,8,12,20],
  mob1:[3,15,0,0,0,0], mob2:[0,0,12,18,0,0], mob3:[0,0,0,0,12,24],
  mora:[20000,40000,60000,80000,100000,120000],
};

// How many of the 6 GI ascension phases a given target level needs. Phases
// unlock at Lv 20/40/50/60/70/80 (raising the cap to 40/50/60/70/80/90), so any
// typed level 1-90 maps to a phase count.
function cmGiPhasesForLevel(level){
  const lv = Math.max(1, Math.min(90, Math.round(Number(level)) || 90));
  if (lv > 80) return 6;
  if (lv > 70) return 5;
  if (lv > 60) return 4;
  if (lv > 50) return 3;
  if (lv > 40) return 2;
  if (lv > 20) return 1;
  return 0;
}

// Rebuild the GI ascension item list + Mora cost for a target max level by
// summing the universal per-phase pattern up to that phase. Slots are inferred
// from the flat list: gems by rarity (sliver/fragment/chunk/gemstone), the
// specialty by kind, and the remaining drops by rarity (3 mob tiers + boss).
function cmGiAscensionForLevel(ascItems, ascCost, targetLevel){
  const phases = cmGiPhasesForLevel(targetLevel);
  if (phases >= 6) return { items:ascItems || [], cost:Number(ascCost || 0) };
  const items = ascItems || [];
  const gems = items.filter((m) => m.kind === 'gem').sort((a, b) => cmRarityValue(a.rar) - cmRarityValue(b.rar));
  const drops = items.filter((m) => m.kind !== 'gem' && m.kind !== 'specialty').sort((a, b) => cmRarityValue(a.rar) - cmRarityValue(b.rar));
  const slotOf = (m) => {
    if (m.kind === 'gem') return ['gem1', 'gem2', 'gem3', 'gem4'][gems.indexOf(m)];
    if (m.kind === 'specialty') return 'specialty';
    return ['mob1', 'mob2', 'mob3', 'boss'][drops.indexOf(m)];
  };
  const sumTo = (pat) => { let q = 0; for (let i = 0; i < phases; i += 1) q += pat[i] || 0; return q; };
  const out = [];
  items.forEach((m) => {
    const pat = CM_GI_ASC_PATTERN[slotOf(m)];
    if (!pat) { out.push(m); return; }
    const qty = sumTo(pat);
    if (qty > 0) out.push({ ...m, qty });
  });
  return { items:out, cost:sumTo(CM_GI_ASC_PATTERN.mora) };
}

const NYX_SEARCH_ALIASES = {
  dante:['Dan Heng \u2022 Permansor Terrae', 'Dan Heng Permansor Terrae'],
  daniel:['Dan Heng \u2022 Imbibitor Lunae', 'Dan Heng Imbibitor Lunae'],
  elysia:['Cyrene'],
  dromas:['Anaxa'],
  march:['Evernight'],
  dot:['Kafka', 'Black Swan', 'Hysilens'],
  yae:['Evanescia'],
  wise:['Pyrois'],
  belle:['Pyrois'],
  phaethon:['Pyrois'],
  tb:['Trailblazer'],
  stelle:['Trailblazer'],
  caelus:['Trailblazer'],
  aether:['Traveler', 'Manekin'],
  lumine:['Traveler', 'Manekin'],
  sparkle:['Sparxie'],
  fate:['Archer', 'Saber', 'Rin', 'Gilgamesh'],
  kevin:['Phainon'],
  kebin:['Phainon'],
  ipc:['Topaz', 'Aventurine', 'Yao Guang', 'Jade', 'Pearl', 'Kuchiba'],
  'galaxy rangers':['Ashveil', 'Rappa', 'Boothill', 'Acheron'],
  aha:['Sampo'],
  jq:['Jiaoqiu'],
  pichu:['Jiaoqiu'],
  bronya:['Silver Wolf'],
  himeko:['Argenti'],
};

function nyxSearchText(value){
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function nyxMatchesSearch(name, rawName, q, extra){
  const query = nyxSearchText(q).trim();
  if (!query) return true;
  const hay = nyxSearchText([name, rawName, extra].filter(Boolean).join(' '));
  if (hay.includes(query)) return true;
  for (const [alias, targets] of Object.entries(NYX_SEARCH_ALIASES)) {
    const key = nyxSearchText(alias);
    if (!(key.startsWith(query) || query.startsWith(key) || key.includes(query))) continue;
    if ((targets || []).some((target) => hay.includes(nyxSearchText(target)))) return true;
  }
  return false;
}

Object.assign(window, { NYX_SEARCH_ALIASES, nyxMatchesSearch });

// per-game material schedule buckets (drives the click-through popup)
const CM_MATS = {
  gi:   { gem:'Brilliant Gemstone', boss:'Boss Trophy', specialty:'Local Specialty',
    mob:['Common Drop','Refined Drop','Elite Drop'], book:['Teaching','Guide','Philosophies'],
    weekly:'Weekly Boss Trophy', crown:'Crown of Insight' },
  hsr:  { gem:'Ascension Gem', boss:'Echo of War Drop', specialty:'Trace Material',
    mob:['Common Trace','Refined Trace','Elite Trace'], book:['Tome','Records','Doctrines'],
    weekly:'Echo of War Trophy', crown:'Tracks of Destiny' },
  zzz:  { gem:'Certification Seal', boss:'Notorious Hunt Drop', specialty:'Skill Chip',
    mob:['Basic Chip','Advanced Chip','Specialized Chip'], book:['Hamster Cage Pass','Higher Dimensional Data','Hamster Core'],
    weekly:'Notorious Trophy', crown:'Ether Plating' },
  wuwa: { gem:'Whisperin Core', boss:'Tacet Core', specialty:'Forgery Material',
    mob:['LF Whisperin Core','MF Whisperin Core','HF Whisperin Core'], book:['Cadence Seed','Cadence Bud','Cadence Blossom'],
    weekly:'Weekly Boss Drop', crown:'Crown of Conquest' },
  ae:   { gem:'Origin Crystal', boss:'Operation Trophy', specialty:'Field Sample',
    mob:['Salvaged Part','Refined Part','Precision Part'], book:['Combat Manual','Tactical Files','Strategic Archive'],
    weekly:'Operation Boss Trophy', crown:'Endmind Core' },
};

function cmReqSort(a, b){
  const ac = a?.kind === 'currency';
  const bc = b?.kind === 'currency';
  if (ac !== bc) return ac ? -1 : 1;
  const ai = Number.parseInt(a?.id, 10);
  const bi = Number.parseInt(b?.id, 10);
  if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) return ai - bi;
  const rank = { gem:1, weapon:2, boss:3, specialty:4, mob:5, book:6, weekly:7, crown:8 };
  const ar = Object.prototype.hasOwnProperty.call(rank, a?.kind) ? rank[a.kind] : 9;
  const br = Object.prototype.hasOwnProperty.call(rank, b?.kind) ? rank[b.kind] : 9;
  return ar - br || String(a?.name || '').localeCompare(String(b?.name || ''));
}

function cmRarityValue(value, fallback = 1){
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return n;
  return { S:5, A:4, B:3, Normal:1, NotNormal:2, Rare:3, SuperRare:4, VeryRare:5 }[String(value || '')] || fallback;
}

const CM_ITEM_FRAME_DEFS = {
  white:{ h:90, c:0.006, L:[0.93, 0.88, 0.83], irid:true, tier:0 },
  grey:{ h:250, c:0.02, L:[0.44, 0.55, 0.66], tier:1 },
  green:{ h:158, c:0.10, L:[0.45, 0.57, 0.69], tier:2 },
  blue:{ h:257, c:0.10, L:[0.45, 0.57, 0.69], tier:3 },
  purple:{ h:288, c:0.10, L:[0.45, 0.57, 0.69], tier:4 },
  gold:{ h:68, c:0.10, L:[0.58, 0.70, 0.82], tier:5 },
  red:{ h:18, c:0.115, L:[0.41, 0.52, 0.62], tier:6 },
};

function cmFrameHexToRgb(hex){
  const h = String(hex || '#000000').replace('#', '');
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}

function cmFrameMix(a, b, t){
  const A = cmFrameHexToRgb(a);
  const B = cmFrameHexToRgb(b);
  const f = (i) => Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, '0');
  return '#' + f(0) + f(1) + f(2);
}

function cmFrameRgba(hex, alpha){
  const rgb = cmFrameHexToRgb(hex);
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

function cmFrameOklch(L, C, H){
  const rad = H * Math.PI / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const t = (v) => {
    const clamped = Math.min(1, Math.max(0, v));
    return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  };
  const q = (v) => Math.round(t(v) * 255).toString(16).padStart(2, '0');
  return '#' + q(R) + q(G) + q(B);
}

function cmFrameGlowGradient(base, peak){
  if (!(peak > 0)) return 'transparent';
  const rgb = cmFrameHexToRgb(base);
  const c = (alpha) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
  return `radial-gradient(circle at center, ${c(peak)} 0%, ${c(peak * 0.9)} 11%, ${c(peak * 0.74)} 22%, ${c(peak * 0.55)} 33%, ${c(peak * 0.38)} 43%, ${c(peak * 0.24)} 53%, ${c(peak * 0.14)} 62%, ${c(peak * 0.07)} 71%, ${c(peak * 0.03)} 80%, ${c(peak * 0.009)} 89%, ${c(0)} 100%)`;
}

function cmBuildItemFrameStyle(def){
  const o = (L, c) => cmFrameOklch(L, c === undefined ? def.c : c, def.h);
  const top = o(def.L[0]);
  const mid = o(def.L[1]);
  const bot = o(def.L[2]);
  const base = def.irid ? cmFrameOklch(0.89, 0.032, 265) : mid;
  const plate = cmFrameMix(base, '#1b1f27', 0.88);
  const P = cmFrameHexToRgb(plate);
  const Bs = cmFrameHexToRgb(base);
  const eyeAt = (pos) => {
    const alpha = 0.10 + 0.25 * pos;
    const f = (i) => Math.round(P[i] * (1 - alpha) + Bs[i] * 0.10 * (1 - pos)).toString(16).padStart(2, '0');
    return '#' + f(0) + f(1) + f(2);
  };
  const line = def.irid
    ? cmFrameOklch(0.75, 0.038, 305)
    : o(def.lineL === undefined ? 0.74 : def.lineL, def.lineC === undefined ? Math.min(def.c, 0.085) : def.lineC);
  const fill = def.irid
    ? `linear-gradient(180deg, ${cmFrameOklch(0.935, 0.03, 350)} 0%, ${cmFrameOklch(0.90, 0.036, 295)} 40%, ${cmFrameOklch(0.865, 0.038, 245)} 75%, ${cmFrameOklch(0.845, 0.034, 195)} 100%)`
    : `linear-gradient(${def.angle || 180}deg, ${top} 0%, ${mid} 52%, ${bot} 100%)`;
  return {
    '--cmf-fill': fill,
    '--cmf-line': line,
    '--cmf-plate': plate,
    '--cmf-eye-color': def.irid ? cmFrameOklch(0.86, 0.035, 280) : o(def.eyeL === undefined ? 0.75 : def.eyeL),
    '--cmf-eye-fill': `linear-gradient(180deg, ${eyeAt(0)} 0%, ${eyeAt(0)} 52%, ${plate} 52%, ${plate} 100%)`,
    '--cmf-band': `linear-gradient(180deg, ${cmFrameRgba(base, 0.10)} 0%, rgba(0,0,0,0.35) 100%)`,
    '--cmf-glow': cmFrameRgba(base, 0.55),
    '--cmf-glow-wide': `radial-gradient(closest-side, ${cmFrameRgba(base, 0.3)} 0%, ${cmFrameRgba(base, 0)} 75%)`,
    '--cmf-glow-grad': cmFrameGlowGradient(base, 0.45),
  };
}

const CM_ITEM_FRAME_STYLES = {
  0: cmBuildItemFrameStyle(CM_ITEM_FRAME_DEFS.white),
  1: cmBuildItemFrameStyle(CM_ITEM_FRAME_DEFS.grey),
  2: cmBuildItemFrameStyle(CM_ITEM_FRAME_DEFS.green),
  3: cmBuildItemFrameStyle(CM_ITEM_FRAME_DEFS.blue),
  4: cmBuildItemFrameStyle(CM_ITEM_FRAME_DEFS.purple),
  5: cmBuildItemFrameStyle(CM_ITEM_FRAME_DEFS.gold),
  6: cmBuildItemFrameStyle(CM_ITEM_FRAME_DEFS.red),
};

function cmItemFrameRarity(value, fallback = 4){
  return Math.max(0, Math.min(6, cmRarityValue(value, fallback)));
}

function cmFrameQuantityText(value){
  if (value === undefined || value === null || value === '') return '';
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === '') return '';
  const n = Number(raw);
  if (!Number.isFinite(n)) return String(raw);
  if (n <= 0) return '';
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/* Design formula: shrink the count so it always fits the 208px-wide frame canvas
   (GI digits ≈ 0.64em, dots ≈ 0.30em). The canvas is scaled as a whole, so this
   size is in design px — no per-frame-width correction. */
function cmFrameQuantitySize(text){
  const raw = String(text || '');
  if (!raw) return null;
  const dots = (raw.match(/\./g) || []).length;
  const digits = raw.length - dots;
  return Math.min(35, Math.floor(194 / (0.64 * digits + 0.30 * dots))) + 'px';
}

function CMItemFrame({ icon, sprite, glyph, rarity, quantity, className }){
  const r = cmItemFrameRarity(rarity, 4);
  const qty = cmFrameQuantityText(quantity);
  const style = {
    ...(CM_ITEM_FRAME_STYLES[r] || CM_ITEM_FRAME_STYLES[4]),
    '--cmf-qty-size': cmFrameQuantitySize(qty) || '35px',
  };
  /* DOM order mirrors the design template exactly — art, plate, seam glows,
     band (z2), rim strokes, eye emblem — so the paint order matches 1:1. */
  return (
    <span className={'cm-item-frame' + (qty ? ' has-qty' : '') + (className ? ' ' + className : '')} style={style} aria-hidden={!icon && !glyph}>
      <span className="cm-item-frame-canvas">
        <span className="cm-item-frame-art">
          <span className="cm-item-frame-fill">
            <span className="cm-item-frame-glow"></span>
            <span className="cm-item-frame-eye-soft"></span>
          </span>
          <span className="cm-item-frame-icon">
            {sprite ? <ZzzSpriteIcon icon={icon} sprite={sprite} alt="" /> : icon ? <img src={icon} alt="" draggable="false" /> : <span className="glyph">{glyph}</span>}
          </span>
        </span>
        <span className="cm-item-frame-plate" aria-hidden="true"></span>
        <span className="cm-item-frame-seam" aria-hidden="true">
          <span></span><i></i>
        </span>
        <span className="cm-item-frame-band">{qty && <b>{qty}</b>}</span>
        <svg className="cm-item-frame-rim" viewBox="0 0 208 260" aria-hidden="true">
          <path d="M14,1 L194,1 A13,13 0 0 1 207,14 L207,259 L1,259 L1,14 A13,13 0 0 1 14,1 Z" fill="none" stroke="var(--cmf-line)" strokeWidth="2"></path>
          <path d="M14,4 L194,4 A10,10 0 0 1 204,14 L204,208 M4,208 L4,14 A10,10 0 0 1 14,4" fill="none" stroke="var(--cmf-line)" strokeWidth="0.75" strokeOpacity="0.55"></path>
          <path d="M1,208 L207,208" fill="none" stroke="var(--cmf-line)" strokeWidth="1.5"></path>
        </svg>
        <span className="cm-item-frame-emblem" aria-hidden="true">
          <span className="fill"></span>
          <span className="line"></span>
        </span>
      </span>
    </span>
  );
}

function cmMergeMat(map, mat){
  if (!mat || !mat.name) return;
  const key = mat.id ? 'id:' + mat.id : 'name:' + mat.name.toLowerCase();
  const cur = map.get(key) || { ...mat, qty:0 };
  cur.qty += Number(mat.qty || 0);
  cur.rar = Math.max(cmRarityValue(cur.rar), cmRarityValue(mat.rar));
  if (!cur.icon && mat.icon) cur.icon = mat.icon;
  if (!cur.sprite && mat.sprite) cur.sprite = mat.sprite;
  if (!cur.source && mat.source) cur.source = mat.source;
  if (!cur.sources && mat.sources) cur.sources = mat.sources;
  if (Array.isArray(mat.sourceDetails) && mat.sourceDetails.length) {
    const next = [...(cur.sourceDetails || [])];
    mat.sourceDetails.forEach((detail) => {
      const key = String(detail?.name || '').toLowerCase();
      if (key && !next.some((row) => String(row?.name || '').toLowerCase() === key)) next.push(detail);
    });
    cur.sourceDetails = next;
  }
  map.set(key, cur);
}

function cmTalentForTargets(ch, targets){
  const groups = ch?.req?.talentStages || [];
  const by = new Map();
  // minor traces / always-on nodes (HSR) are included regardless of trace levels
  let cost = Number(ch?.req?.talentBaseCost || 0);
  (ch?.req?.talentBase || []).forEach((mat) => cmMergeMat(by, mat));
  groups.forEach((stages, i) => {
    const target = Math.max(1, Math.min(10, Number(targets[i] || targets[targets.length - 1] || 10)));
    const limit = Math.max(0, Math.min(stages.length, target - 1));
    for (let j = 0; j < limit; j += 1){
      const stage = stages[j];
      cost += Number(stage?.cost || 0);
      (stage?.items || []).forEach((mat) => cmMergeMat(by, mat));
    }
  });
  return { items:[...by.values()].sort(cmReqSort), cost };
}

function cmRequirements(gameKey, ch, opts){
  if (ch && ch.req) {
    const targeted = (gameKey === 'gi' || gameKey === 'hsr') && opts?.targets && ch.req.talentStages?.some((s) => s.length)
      ? cmTalentForTargets(ch, opts.targets)
      : null;
    const ascCost = Number(ch.req.ascCost || 0);
    const weaponCost = Number(ch.req.weapon?.cost || 0);
    const talentCost = targeted
      ? Number(targeted.cost || 0)
      : Number(ch.req.talentCost || Math.max(0, Number(ch.req.currency || 0) - ascCost - weaponCost));
    return {
      ascension: ch.req.ascension || [],
      talents: targeted ? targeted.items : (ch.req.talents || []),
      weapon: ch.req.weapon || null,
      ascCost,
      talentCost,
      weaponCost,
      currency: ascCost + talentCost + weaponCost,
    };
  }
  const M = CM_MATS[gameKey] || CM_MATS.gi;
  const ascension = [
    { name:ch.el + ' ' + M.gem, qty:46, rar:5, kind:'gem' },
    { name:M.boss, qty:46, rar:4, kind:'boss' },
    { name:M.specialty, qty:168, rar:1, kind:'specialty' },
    { name:M.mob[2], qty:36, rar:3, kind:'mob' },
    { name:M.mob[1], qty:96, rar:2, kind:'mob' },
    { name:M.mob[0], qty:18, rar:1, kind:'mob' },
  ];
  const talents = [
    { name:M.book[2], qty:12, rar:4, kind:'book' },
    { name:M.book[1], qty:21, rar:3, kind:'book' },
    { name:M.book[0], qty:9,  rar:2, kind:'book' },
    { name:M.mob[2], qty:18, rar:3, kind:'mob' },
    { name:M.mob[1], qty:66, rar:2, kind:'mob' },
    { name:M.weekly, qty:18, rar:5, kind:'weekly' },
    { name:M.crown,  qty:3,  rar:5, kind:'crown' },
  ];
  return { ascension, talents };
}

function cmCurrencyMat(cfg, qty){
  const count = Number(qty || 0);
  if (!count) return null;
  const name = cfg?.cur || 'Currency';
  return {
    id: 'currency:' + name,
    name,
    qty: count,
    rar: 3, // base credits/Mora-tier currency is a 3-star item, not purple (4)
    kind: 'currency',
    icon: cfg?.curIcon || null,
  };
}

function cmInitials(name){
  const p = name.replace(/[^A-Za-z0-9 ].*/, '').trim().split(/\s+/);
  return ((p[0] && p[0][0] || 'N') + (p[1] ? p[1][0] : (p[0] && p[0][1] || ''))).toUpperCase();
}

// Tidy scraped source blurbs for the hover tooltip: drop the useless
// "Go to collect" CTA artifact, strip the "Recommendation:" prefix, and remove
// the stray word "recommendation" (e.g. "Prydwen recommendation" -> "Prydwen").
function cmCleanSourceName(name){
  let s = String(name || '').trim();
  if (/^go to collect$/i.test(s)) return '';
  s = s.replace(/^\s*recommendation\s*:\s*/i, '');
  s = s.replace(/\brecommendations?\b/ig, '').replace(/\s{2,}/g, ' ').replace(/\s*[:·-]\s*$/, '').trim();
  return s;
}

// GI talent-book series -> region, so a talent book's obtaining text reads
// just "<Region> Talent Domain" instead of scraped per-day blurbs.
const CM_GI_TALENT_REGION = {
  freedom:'Mondstadt', resistance:'Mondstadt', ballad:'Mondstadt',
  prosperity:'Liyue', diligence:'Liyue', gold:'Liyue',
  transience:'Inazuma', elegance:'Inazuma', light:'Inazuma',
  admonition:'Sumeru', ingenuity:'Sumeru', praxis:'Sumeru',
  equity:'Fontaine', justice:'Fontaine', order:'Fontaine',
  contention:'Natlan', kindling:'Natlan', conflict:'Natlan',
};
function cmTalentDomainSource(m){
  const mm = String(m?.name || '').match(/\b(?:teaching|teachings|guide|philosophies)\s+(?:of|to)\s+([A-Za-z]+)/i);
  const region = mm && CM_GI_TALENT_REGION[mm[1].toLowerCase()];
  return region ? region + ' Talent Domain' : null;
}

function cmMatSourceInfo(m){
  const dom = cmTalentDomainSource(m);
  if (dom) return dom;
  if (Array.isArray(m?.sourceDetails) && m.sourceDetails.length) {
    const names = m.sourceDetails.map((entry) => cmCleanSourceName(entry?.name)).filter(Boolean);
    if (names.length) return names.join(' / ');
  }
  const direct = m?.source || m?.dropSource || m?.sourceText;
  if (direct) {
    const cleaned = String(direct).split(/\s+\/\s+/).map(cmCleanSourceName).filter(Boolean).join(' / ');
    if (cleaned) return cleaned;
  }
  if (Array.isArray(m?.sources) && m.sources.length) {
    const cleaned = m.sources.map(cmCleanSourceName).filter(Boolean);
    if (cleaned.length) return cleaned.join(' / ');
  }
  return '';
}

function cmMatSourceDetails(m){
  const dom = cmTalentDomainSource(m);
  if (dom) return [{ name:dom }];
  if (Array.isArray(m?.sourceDetails) && m.sourceDetails.length) {
    const seen = new Set();
    const cleaned = m.sourceDetails
      .map((entry) => ({ ...entry, name:cmCleanSourceName(entry?.name) }))
      .filter((entry) => {
        if (!entry.name) return false;
        // collapse repeats: same art (icon) shows once; otherwise dedupe by name
        const key = entry.icon ? 'icon:' + entry.icon : 'name:' + entry.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (cleaned.length) return cleaned;
  }
  const text = cmMatSourceInfo(m);
  return text
    ? text.split(/\s+\/\s+/).filter(Boolean).map((name) => ({ name }))
    : [];
}

function CMAvatar({ ch, big }){
  const pal = { a:'#9a89ea', b:'#372464', ring:'#cdb3ff', glow:'rgba(150,120,255,.55)' };
  const el = CM_ELEM[ch.el] || '#b7aaff';
  const real = ch.icon || ch.circle || (ch.n === 'Skirk' ? '../assets/char/skirk_circle.png' : null);
  const imgStyle = {};
  if (ch.iconZoom) imgStyle['--iconZoom'] = ch.iconZoom;
  if (ch.iconPosition) imgStyle.objectPosition = ch.iconPosition;
  // Beta characters often ship before their artwork. Show a named, labelled
  // "art pending" fallback instead of silently rendering bare initials.
  const artPending = !real && ch.__beta;
  return (
    <div className={'cm-av r' + ch.r + (big ? ' big' : '') + (artPending ? ' art-pending' : '')}
         style={{ '--rA':pal.a, '--rB':pal.b, '--ring':pal.ring, '--glow':pal.glow, '--el':el }}
         title={artPending ? ch.n + ' — artwork pending (unreleased)' : undefined}>
      <div className="disc">
        {real ? <img
          className={ch.iconZoom ? 'zoom' : ''}
          style={Object.keys(imgStyle).length ? imgStyle : undefined}
          src={real}
          alt={ch.n}
          draggable="false"
        /> : <span className="mono">{cmInitials(ch.n)}</span>}
      </div>
      {artPending && <span className="cm-av-pending">art pending</span>}
    </div>
  );
}

function MatTile({ m }){
  const icon = m.icon || m.art;
  const rarity = Math.max(0, Math.min(5, cmRarityValue(m.rar, 0)));
  const pal = CM_RAR[rarity] || CM_RAR[2];
  const g = m.kind === 'currency' ? '\u25CE' : m.kind === 'crown' ? '\u265B' : m.kind === 'gem' ? '\u25C8' : m.kind === 'book' ? '\u25A4'
    : m.kind === 'weekly' ? '\u2726' : m.kind === 'boss' ? '\u2756' : m.kind === 'specialty' ? '\u273F' : m.kind === 'weapon' ? '\u25A6' : '\u25C9';
  const qty = Number(m.qty || 0);
  const source = cmMatSourceInfo(m);
  const details = cmMatSourceDetails(m);
  return (
    <div className={'cm-mat' + (m.kind === 'currency' ? ' cur' : '')} title={(m.name || 'Material') + (qty ? ' x' + qty.toLocaleString('en-US') : '') + (source ? '\n' + source : '')}
         style={{ '--rA':pal.a, '--rB':pal.b, '--rarBg':'url("../../assets/mats/rarity' + rarity + '.png")' }}>
      <CMItemFrame icon={icon} sprite={m.sprite} glyph={g} rarity={rarity} quantity={qty} />
      <span className="nm">{m.name}</span>
      <span className="src-tip" role="tooltip">
        <b>{m.name}</b>
        {details.length > 0 ? (() => {
          const withIcon = details.filter((d) => d.icon);
          const noIcon = details.filter((d) => !d.icon);
          return (
            <span className="src-list">
              {withIcon.length > 0 && (
                <span className="src-icons">
                  {withIcon.map((detail, i) => (
                    <img key={'i' + i} src={detail.icon} alt={detail.name || ''} title={detail.name || ''} draggable="false" />
                  ))}
                </span>
              )}
              {noIcon.length > 0 && <em className="src-names">{noIcon.map((d) => d.name).join(' / ')}</em>}
            </span>
          );
        })() : (source ? <em>{source}</em> : null)}
      </span>
    </div>
  );
}

/* a small material token used in the Talents / Boss columns */
function ZzzSpriteIcon({ icon, sprite, alt }){
  const canvasRef = React.useRef(null);
  const [animated, setAnimated] = React.useState(false);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sprite) return undefined;
    let raf = 0;
    let cancelled = false;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (cancelled) return;
      const frame = 256;
      const cols = Math.floor(img.naturalWidth / frame);
      const rows = Math.floor(img.naturalHeight / frame);
      const available = cols * rows;
      const big = img.naturalWidth === 4096 && img.naturalHeight === 2048;
      const small = img.naturalWidth === 2048 && img.naturalHeight === 2048;
      if (!cols || !rows || img.naturalWidth < 1000 || (!big && !small)) {
        setAnimated(false);
        return;
      }
      const frameCount = Math.min(big ? 120 : 60, available);
      const frameMs = big ? 25 : 50;
      const pingPong = /ExBigBoss010/i.test(sprite);
      const ctx = canvas.getContext('2d');
      canvas.width = frame;
      canvas.height = frame;
      setAnimated(true);
      const draw = (time) => {
        if (cancelled || !ctx) return;
        let index = Math.floor(time / frameMs) % frameCount;
        if (pingPong) {
          const span = frameCount * 2 - 2;
          const pos = Math.floor(time / frameMs) % Math.max(span, 1);
          index = pos >= frameCount ? span - pos : pos;
        }
        const sx = (index % cols) * frame;
        const sy = Math.floor(index / cols) * frame;
        ctx.clearRect(0, 0, frame, frame);
        ctx.drawImage(img, sx, sy, frame, frame, 0, 0, frame, frame);
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
    };
    img.onerror = () => setAnimated(false);
    img.src = sprite;
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sprite]);

  return (
    <span className={'zzz-sprite' + (animated ? ' is-animated' : '')}>
      {icon && <img src={icon} alt={alt || ''} draggable="false" />}
      <canvas ref={canvasRef} aria-hidden="true"></canvas>
    </span>
  );
}

function CMToken({ name, glyph, icon, sprite, rarity, meta }){
  const quantity = /^\s*\d[\d.,]*\s*$/.test(String(meta || '')) ? meta : null;
  return (
    <div className="cm-mtoken">
      <CMItemFrame icon={icon} sprite={sprite} glyph={glyph} rarity={rarity} quantity={quantity} />
      <span className="lbl">{name}</span>
      {meta && !quantity && <span className="mt">{meta}</span>}
    </div>
  );
}

function cmMatName(mat){
  return String(typeof mat === 'string' ? mat : (mat && (mat.n || mat.name)) || '').trim();
}

function cmUsefulName(name){
  const n = String(name || '').trim();
  return !!n && !/^(unknown|unsorted)\b/i.test(n) && !/^talent material$/i.test(n);
}

function cmTokens(mats, fallback){
  const list = (mats || []).map((m) => ({
    n:cmMatName(m),
    icon:typeof m === 'object' && m ? (m.icon || m.art) : null,
    sprite:typeof m === 'object' && m ? m.sprite : null,
    rar:typeof m === 'object' && m ? (m.rar || m.rarity || m.rank) : null,
  })).filter((m) => cmUsefulName(m.n));
  if (list.length) return list;
  const fb = cmMatName(fallback);
  return cmUsefulName(fb) ? [{ n:fb }] : [];
}

function cmReqItems(items){
  return (items || []).filter((m) => m && cmUsefulName(m.name)).sort(cmReqSort);
}

function cmCharKey(prefix, ch, i){
  return prefix + '-' + (ch.id || ch.n) + '-' + i;
}

function cmReqTotal(items){
  return (items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0);
}

function cmCombineReqItems(...groups){
  const by = new Map();
  groups.flat().filter(Boolean).forEach((mat) => cmMergeMat(by, mat));
  return [...by.values()].sort(cmReqSort);
}

function cmHiddenKey(ch){
  return String(ch?.id || ch?.rawName || ch?.n || '');
}

function cmEmptyHiddenPrefs(){
  return { sync:false, all:{}, roster:{}, materials:{} };
}

const CM_DEFAULT_TOTAL_INCLUDE = { ascension:true, talents:true, weapon:true };
const CM_TOTAL_INCLUDE_KEY = 'nyx:cm-total-include:v1';

function cmLoadTotalIncludePrefs(){
  try { return JSON.parse(localStorage.getItem(CM_TOTAL_INCLUDE_KEY) || '{}') || {}; } catch (e) { return {}; }
}

function cmSaveTotalIncludePrefs(next){
  try { localStorage.setItem(CM_TOTAL_INCLUDE_KEY, JSON.stringify(next)); } catch (e) {}
}

function cmWeaponRowLabel(gameKey){
  if (gameKey === 'hsr') return 'LIGHT CONE';
  if (gameKey === 'zzz') return 'W-ENGINE';
  return 'WEAPON';
}

function cmWeaponCompatible(gameKey, ch, weapon){
  if (!ch || !weapon) return true;
  if (gameKey === 'gi') return !ch.w || !weapon.weaponType || weapon.weaponType === ch.w || weapon.type === ch.w;
  if (gameKey === 'hsr') return !ch.path || !weapon.path || weapon.path === ch.path || weapon.type === ch.path;
  return true;
}

function cmLoadHiddenPrefs(){
  try {
    const raw = JSON.parse(localStorage.getItem('nyx:cm-hidden:v1') || '{}');
    return {
      ...cmEmptyHiddenPrefs(),
      ...raw,
      all:{ ...(raw.all || {}) },
      roster:{ ...(raw.roster || {}) },
      materials:{ ...(raw.materials || {}) },
    };
  } catch (e) {
    return cmEmptyHiddenPrefs();
  }
}

function cmSaveHiddenPrefs(next){
  try { localStorage.setItem('nyx:cm-hidden:v1', JSON.stringify(next)); } catch (e) {}
}

function cmFilterGlyph(gameKey, filterKey, label, value){
  const text = String(label || value || '').trim();
  const elem = CM_ELEM[text] || CM_ELEM[value] || null;
  if (filterKey === 'el') {
    return <span className="cm-fi elem" style={{ '--fi':elem || '#b7aaff' }}>{text.slice(0, 1)}</span>;
  }
  if (filterKey === 'r') {
    return <span className="cm-fi rare">{/^(s|6|5)/i.test(text) ? '\u2726' : '\u2727'}</span>;
  }
  const short = {
    Sword:'Sw', Claymore:'Cl', Polearm:'Po', Bow:'Bw', Catalyst:'Ca',
    Broadblade:'Bb', Pistols:'Pi', Gauntlets:'Ga', Rectifier:'Re',
    Attack:'At', Stun:'St', Anomaly:'An', Support:'Su', Defense:'De', Defence:'De', Rupture:'Ru',
    Destruction:'De', Hunt:'Hu', Erudition:'Er', Preservation:'Pr', Nihility:'Ni', Harmony:'Ha', Abundance:'Ab', Remembrance:'Re', Elation:'El',
    Striker:'St', Guard:'Gu', Defender:'De', Caster:'Ca', Vanguard:'Va', Specialist:'Sp',
  }[text] || text.slice(0, 2);
  return <span className="cm-fi sym">{short}</span>;
}

function cmMetaKey(value){
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function cmMetaIconType(field, value){
  const key = cmMetaKey(value);
  const element = {
    pyro:'flame', fire:'flame', heat:'flame', fusion:'flame',
    hydro:'drop', water:'drop',
    cryo:'snow', ice:'snow', frost:'snow', glacio:'snow',
    electro:'bolt', lightning:'bolt', electric:'bolt',
    dendro:'leaf', nature:'leaf',
    anemo:'wind', wind:'wind', aero:'wind',
    geo:'diamond', quantum:'diamond', spectro:'star', imaginary:'sun', ether:'void', havoc:'crescent',
    physical:'impact',
  }[key];
  if (field === 'el' && element) return element;
  const weapon = {
    sword:'sword', claymore:'claymore', broadblade:'claymore', polearm:'spear', pole:'spear',
    bow:'bow', catalyst:'catalyst', rectifier:'catalyst', pistols:'pistols', gauntlets:'gauntlet',
  }[key];
  if ((field === 'w' || field === 'weapon') && weapon) return weapon;
  return ({
    destruction:'burst', hunt:'arrow', erudition:'book', preservation:'shield', nihility:'void',
    harmony:'wave', abundance:'leaf', remembrance:'crystal', elation:'spark',
    attack:'sword', damage:'sword', stun:'burst', anomaly:'triangle', support:'plus',
    buff:'plus', defense:'shield', defence:'shield', shield:'shield', rupture:'slash', ruin:'slash',
    striker:'sword', guard:'shield', defender:'shield', caster:'catalyst', vanguard:'spear', specialist:'spark',
  })[key] || 'spark';
}

function cmSvgIcon(type){
  const common = { fill:'none', stroke:'currentColor', strokeWidth:'1.9', strokeLinecap:'round', strokeLinejoin:'round' };
  switch (type) {
    case 'flame': return <svg viewBox="0 0 24 24"><path {...common} d="M12 22c4.4-1.4 7-4.5 7-8.4 0-3-1.6-5.5-4.6-8.2.1 2.8-.8 4.6-2.2 5.7.2-3.2-1.3-5.8-4.1-8.1.2 4.5-3.1 6.4-3.1 10.7C5 18 7.7 21 12 22z" /></svg>;
    case 'drop': return <svg viewBox="0 0 24 24"><path {...common} d="M12 3c4 4.6 6 7.9 6 11a6 6 0 0 1-12 0c0-3.1 2-6.4 6-11z" /></svg>;
    case 'snow': return <svg viewBox="0 0 24 24"><path {...common} d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M8 5.8 12 8l4-2.2M8 18.2l4-2.2 4 2.2" /></svg>;
    case 'bolt': return <svg viewBox="0 0 24 24"><path {...common} d="M13 2 5.5 13H11l-1 9 8.5-12H13l0-8z" /></svg>;
    case 'leaf': return <svg viewBox="0 0 24 24"><path {...common} d="M20 4c-7.6.3-13.4 4-15 11.4C9.8 17 16 13.8 20 4zM5 20c2.4-5.4 6.1-8.7 11-10" /></svg>;
    case 'wind': return <svg viewBox="0 0 24 24"><path {...common} d="M4 9h10.6c2 0 3.4-1 3.4-2.5S16.8 4 15.2 4M3 14h13.8c1.9 0 3.2 1 3.2 2.5S18.8 19 17.2 19M6 19h5" /></svg>;
    case 'diamond': return <svg viewBox="0 0 24 24"><path {...common} d="M12 3 21 12 12 21 3 12 12 3zM12 7l5 5-5 5-5-5 5-5z" /></svg>;
    case 'star': return <svg viewBox="0 0 24 24"><path {...common} d="M12 2.8 14.8 9l6.5.8-4.8 4.4 1.3 6.4L12 17.2l-5.8 3.4 1.3-6.4-4.8-4.4L9.2 9 12 2.8z" /></svg>;
    case 'sun': return <svg viewBox="0 0 24 24"><circle {...common} cx="12" cy="12" r="4.2" /><path {...common} d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" /></svg>;
    case 'crescent': return <svg viewBox="0 0 24 24"><path {...common} d="M17.8 19.5A8.8 8.8 0 0 1 12 3.1a7 7 0 1 0 5.8 16.4z" /></svg>;
    case 'impact': return <svg viewBox="0 0 24 24"><path {...common} d="M12 3v7M12 14v7M3 12h7M14 12h7M6 6l4 4M14 14l4 4M18 6l-4 4M10 14l-4 4" /></svg>;
    case 'sword': return <svg viewBox="0 0 24 24"><path {...common} d="M14.5 4 20 2l-2 5.5-9.7 9.7-3.5-3.5L14.5 4zM6 16l2 2M3.5 20.5 7 17" /></svg>;
    case 'claymore': return <svg viewBox="0 0 24 24"><path {...common} d="M15 2 21 8 9.5 19.5 4.5 14.5 15 2zM7 17l-3 3M5.5 13.5l5 5" /></svg>;
    case 'spear': return <svg viewBox="0 0 24 24"><path {...common} d="M15 2 22 9l-5.5 1.5L4 23M12 8l4 4" /></svg>;
    case 'bow': return <svg viewBox="0 0 24 24"><path {...common} d="M7 3c6 3.8 6 14.2 0 18M17 3c-6 3.8-6 14.2 0 18M7 12h10" /></svg>;
    case 'catalyst': return <svg viewBox="0 0 24 24"><circle {...common} cx="12" cy="12" r="6.5" /><path {...common} d="M12 7v10M7 12h10M8.5 8.5l7 7M15.5 8.5l-7 7" /></svg>;
    case 'pistols': return <svg viewBox="0 0 24 24"><path {...common} d="M4 9h10l2 2h4v3h-6l-2-2H9l-1 5H5l1-5H4V9z" /></svg>;
    case 'gauntlet': return <svg viewBox="0 0 24 24"><path {...common} d="M7 10V5M10 10V4M13 10V5M16 11V7M6 10h9.5c1.8 0 3.5 1.7 3.5 3.8V20H8.5C5.7 20 4 18.1 4 15.5V12c0-1.1.9-2 2-2z" /></svg>;
    case 'shield': return <svg viewBox="0 0 24 24"><path {...common} d="M12 3 20 6v5.6c0 4.7-2.9 8.1-8 9.4-5.1-1.3-8-4.7-8-9.4V6l8-3z" /></svg>;
    case 'arrow': return <svg viewBox="0 0 24 24"><path {...common} d="M4 20 20 4M13 4h7v7M7 17l-3 3" /></svg>;
    case 'book': return <svg viewBox="0 0 24 24"><path {...common} d="M5 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H5V4zM14 7a3 3 0 0 1 3-3h2v13h-2a3 3 0 0 0-3 3" /></svg>;
    case 'wave': return <svg viewBox="0 0 24 24"><path {...common} d="M3 13c3.5-5 6.5-5 9 0s5.5 5 9 0M3 18c3.5-5 6.5-5 9 0" /></svg>;
    case 'void': return <svg viewBox="0 0 24 24"><circle {...common} cx="12" cy="12" r="7" /><circle {...common} cx="12" cy="12" r="2.4" /></svg>;
    case 'crystal': return <svg viewBox="0 0 24 24"><path {...common} d="M12 2 18 8l-2 11-4 3-4-3L6 8l6-6zM8 8h8M12 2v20" /></svg>;
    case 'plus': return <svg viewBox="0 0 24 24"><path {...common} d="M12 5v14M5 12h14" /></svg>;
    case 'triangle': return <svg viewBox="0 0 24 24"><path {...common} d="M12 3 22 20H2L12 3zM12 9v5M12 17h.01" /></svg>;
    case 'slash': return <svg viewBox="0 0 24 24"><path {...common} d="M20 4 4 20M16 3l5 5M3 16l5 5" /></svg>;
    case 'burst':
    case 'spark':
    default: return <svg viewBox="0 0 24 24"><path {...common} d="M12 2 14.3 9.7 22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3L12 2z" /></svg>;
  }
}

// Real in-game element/path/weapon-type icons saved locally under
// assets/meta/<game>/ (sourced from jmp.blue, gi.yatta.moe, and the StarRailRes
// wiki). Anything not listed here falls back to the hand-drawn SVG glyph, so
// partial coverage degrades gracefully per game/field.
const CM_META_ICON_BASE = '../assets/meta/';
const CM_META_ICONS = {
  gi: {
    el: { pyro:'gi/pyro.webp', hydro:'gi/hydro.webp', cryo:'gi/cryo.webp', electro:'gi/electro.webp', anemo:'gi/anemo.webp', geo:'gi/geo.webp', dendro:'gi/dendro.webp' },
    w:  { sword:'gi/sword.png', claymore:'gi/claymore.png', polearm:'gi/polearm.png', bow:'gi/bow.png', catalyst:'gi/catalyst.png' },
  },
  hsr: {
    el:   { physical:'hsr/physical.png', fire:'hsr/fire.png', ice:'hsr/ice.png', lightning:'hsr/lightning.png', wind:'hsr/wind.png', quantum:'hsr/quantum.png', imaginary:'hsr/imaginary.png' },
    path: { destruction:'hsr/path_destruction.png', hunt:'hsr/path_hunt.png', erudition:'hsr/path_erudition.png', harmony:'hsr/path_harmony.png', nihility:'hsr/path_nihility.png', preservation:'hsr/path_preservation.png', abundance:'hsr/path_abundance.png', remembrance:'hsr/path_remembrance.png', elation:'hsr/path_elation.png' },
  },
  zzz: {
    el:   { physical:'zzz/physical.webp', fire:'zzz/fire.webp', ice:'zzz/ice.webp', electric:'zzz/electric.webp', ether:'zzz/ether.webp' },
    spec: { attack:'zzz/spec_attack.webp', stun:'zzz/spec_stun.webp', anomaly:'zzz/spec_anomaly.webp', support:'zzz/spec_support.webp', defense:'zzz/spec_defense.webp', defence:'zzz/spec_defense.webp', rupture:'zzz/spec_rupture.webp' },
  },
  wuwa: {
    el: { glacio:'wuwa/glacio.webp', fusion:'wuwa/fusion.webp', electro:'wuwa/electro.webp', aero:'wuwa/aero.webp', spectro:'wuwa/spectro.webp', havoc:'wuwa/havoc.webp' },
    w:  { sword:'wuwa/wp_sword.webp', broadblade:'wuwa/wp_broadblade.webp', pistols:'wuwa/wp_pistols.webp', gauntlets:'wuwa/wp_gauntlets.webp', rectifier:'wuwa/wp_rectifier.webp' },
  },
  ae: {
    el:  { heat:'ae/heat.png', cryo:'ae/cryo.png', electric:'ae/electric.png', nature:'ae/nature.png', physical:'ae/physical.png' },
    cls: { guard:'ae/cls_guard.png', defender:'ae/cls_defender.png', caster:'ae/cls_caster.png', vanguard:'ae/cls_vanguard.png', supporter:'ae/cls_supporter.png', striker:'ae/cls_striker.png' },
    w:   { sword:'ae/wp_sword.png', polearm:'ae/wp_polearm.png', greatsword:'ae/wp_greatsword.png', artsunit:'ae/wp_artsunit.png', handcannon:'ae/wp_handcannon.png' },
  },
};

function cmMetaIconSrc(gameKey, field, value){
  const g = CM_META_ICONS[gameKey];
  if (!g || !g[field]) return null;
  const key = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return g[field][key] ? CM_META_ICON_BASE + g[field][key] : null;
}

function cmMetaColor(value){
  return CM_ELEM[value] || CM_ELEM[String(value || '').replace(/^Electric$/i, 'Electro')] || '#b7aaff';
}

function CMMetaIcon({ gameKey, chip }){
  const color = cmMetaColor(chip.value);
  const type = cmMetaIconType(chip.key, chip.value);
  const src = cmMetaIconSrc(gameKey, chip.key, chip.value);
  const [failed, setFailed] = React.useState(false);
  if (src && !failed) {
    return (
      <span className="cm-meta-symbol img" aria-hidden="true">
        <img src={src} alt="" draggable="false" onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className={'cm-meta-symbol is-' + type} style={{ '--meta':color }} aria-hidden="true">
      {cmSvgIcon(type)}
    </span>
  );
}

const CM_META_FIELDS = {
  gi: [['el', 'Element'], ['w', 'Weapon']],
  hsr: [['el', 'Type'], ['path', 'Path']],
  zzz: [['el', 'Attribute'], ['spec', 'Specialty']],
  wuwa: [['el', 'Attribute'], ['w', 'Weapon']],
  ae: [['el', 'Element'], ['cls', 'Class'], ['w', 'Weapon']],
};

function cmMetaChips(gameKey, ch){
  const fields = CM_META_FIELDS[gameKey] || [];
  const seen = new Set();
  return fields.map(([key, label]) => {
    const value = ch?.[key];
    const text = String(value || '').trim();
    if (!text || /^unknown$/i.test(text)) return null;
    const id = key + ':' + text.toLowerCase();
    if (seen.has(id)) return null;
    seen.add(id);
  return { key, label, value:text };
  }).filter(Boolean);
}

function cmFormatReleaseDate(value){
  const raw = Number(value || 0);
  if (!Number.isFinite(raw) || raw <= 0) return '';
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
}

function cmCharacterReleaseText(ch){
  const date = cmFormatReleaseDate(ch?.release || ch?.releaseDate || ch?.updated);
  const patch = ch?.releasePatch || ch?.patch || ch?.version;
  if (date && patch) return date + ' - Patch ' + patch;
  return date || (patch ? 'Patch ' + patch : '');
}

function cmVoiceRows(ch, gameKey){
  const va = ch?.voiceActors || ch?.va;
  if (!va || typeof va !== 'object') return [];
  const labels = [
    ['english', 'EN'], ['en', 'EN'],
    ['japanese', 'JP'], ['ja', 'JP'], ['jp', 'JP'],
    ['chinese', 'CN'], ['zh', 'CN'], ['cn', 'CN'],
    ['korean', 'KR'], ['ko', 'KR'], ['kr', 'KR'],
  ];
  const seen = new Set();
  return labels.map(([key, label]) => {
    const voice = cmVoiceEntry(va[key], gameKey || ch?.gameKey || ch?.game || '');
    if (!voice || seen.has(label)) return null;
    seen.add(label);
    return { key:label, label, value:voice.text, url:voice.url };
  }).filter(Boolean);
}

function cleanVaText(value){
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text && text !== '-' ? text : '';
}

const CM_VOICE_WIKI_BASE = {
  gi:'https://genshin-impact.fandom.com/wiki/',
  hsr:'https://honkai-star-rail.fandom.com/wiki/',
  zzz:'https://zenless-zone-zero.fandom.com/wiki/',
  wuwa:'https://wutheringwaves.fandom.com/wiki/',
  ae:'https://arknights-endfield.fandom.com/wiki/',
};

function cmVoiceWikiUrl(gameKey, target){
  const clean = cleanVaText(target);
  if (!clean) return '';
  if (/^https?:\/\//i.test(clean)) return clean;
  if (/:/.test(clean)) return '';
  const base = CM_VOICE_WIKI_BASE[gameKey] || '';
  if (!base) return '';
  return base + encodeURIComponent(clean.replace(/\s+/g, '_')).replace(/%2F/gi, '/');
}

function cmVoiceEntry(value, gameKey){
  const raw = cleanVaText(value);
  if (!raw) return null;
  let target = '';
  let label = raw;
  const pipe = raw.indexOf('|');
  if (pipe !== -1) {
    target = raw.slice(0, pipe).trim();
    label = raw.slice(pipe + 1).trim();
  }
  label = label
    .replace(/^(?:ko|zh|ja|cn|jp|kr):/i, '')
    .replace(/\((?:ko|zh|ja|cn|jp|kr)=([^)]+)\)/gi, '($1)')
    .replace(/\s+/g, ' ')
    .trim();
  const cleanTarget = target.replace(/^(?:ko|zh|ja|cn|jp|kr):/i, '').trim();
  if (target && cleanTarget && /[A-Za-z]/.test(cleanTarget) && !/[A-Za-z]/.test(label)) {
    label = cleanTarget + ' (' + label + ')';
  }
  if (!target) {
    const simpleTarget = label.replace(/\s*\([^)]*\)\s*/g, '').trim();
    if (/^[A-Za-z][A-Za-z .'-]{1,80}$/.test(simpleTarget)) target = simpleTarget;
  }
  return { text:label || raw, url:cmVoiceWikiUrl(gameKey, target) };
}

function cmRoleLabel(ch){
  return ch.path || ch.spec || ch.cls || ch.w || ch.tag || '';
}

function cmArtFor(ch){
  return ch.art || ch.card || ch.icon || ch.circle || (ch.n === 'Skirk' ? '../assets/char/skirk.jpg' : null);
}

function cmCssUrl(value){
  return `url("${String(value || '').replace(/\\/g, '/').replace(/"/g, '\\"')}")`;
}

function cmBlockArtStyle(artOrChars){
  const art = typeof artOrChars === 'string'
    ? artOrChars
    : cmArtFor(cmNewestChar(artOrChars || []) || {});
  return art ? { '--cm-block-art': cmCssUrl(art) } : undefined;
}

const NYX_CHARACTER_IMAGES_KEY = 'nyx:character-images:v1';
const NYX_LOCAL_IMAGE_LIBRARY_KEY = 'nyx:local-image-library:v1';
const NYX_LOCAL_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
const NYX_SAFE_DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=\s]+$/i;
const NYX_SAFE_FILE_IMAGE_RE = /^image\/(?:png|jpeg|webp|gif)$/i;

function nyxSafeImageSrc(src){
  const text = String(src || '').trim();
  if (!text) return null;
  if (/^javascript:/i.test(text)) return null;
  if (/^data:/i.test(text) && !NYX_SAFE_DATA_IMAGE_RE.test(text)) return null;
  return text;
}

function nyxLoadLocalImageLibrary(){
  try {
    const rows = JSON.parse(localStorage.getItem(NYX_LOCAL_IMAGE_LIBRARY_KEY) || '[]');
    return Array.isArray(rows)
      ? rows.map((row) => ({
        id:String(row?.id || ''),
        name:String(row?.name || 'Local image').slice(0, 80),
        src:nyxSafeImageSrc(row?.src),
        savedAt:Number(row?.savedAt || 0),
      })).filter((row) => row.id && row.src).slice(0, 18)
      : [];
  } catch (e) {
    return [];
  }
}

function nyxSaveLocalImageLibrary(rows){
  const clean = (rows || [])
    .map((row) => ({
      id:String(row?.id || ''),
      name:String(row?.name || 'Local image').slice(0, 80),
      src:nyxSafeImageSrc(row?.src),
      savedAt:Number(row?.savedAt || Date.now()),
    }))
    .filter((row) => row.id && row.src)
    .slice(0, 18);
  try { localStorage.setItem(NYX_LOCAL_IMAGE_LIBRARY_KEY, JSON.stringify(clean)); } catch (e) {}
  try { window.dispatchEvent(new CustomEvent('nyx:local-image-library-changed', { detail:clean })); } catch (e) {}
  return clean;
}

function nyxRememberLocalImage(name, src){
  const safe = nyxSafeImageSrc(src);
  if (!safe) return nyxLoadLocalImageLibrary();
  const current = nyxLoadLocalImageLibrary().filter((row) => row.src !== safe);
  return nyxSaveLocalImageLibrary([
    { id:String(Date.now()) + '-' + Math.random().toString(16).slice(2), name:name || 'Local image', src:safe, savedAt:Date.now() },
    ...current,
  ]);
}

function useNyxLocalImageLibrary(){
  const [rows, setRows] = React.useState(nyxLoadLocalImageLibrary);
  React.useEffect(() => {
    const onChanged = (event) => setRows(Array.isArray(event.detail) ? event.detail : nyxLoadLocalImageLibrary());
    window.addEventListener('nyx:local-image-library-changed', onChanged);
    return () => window.removeEventListener('nyx:local-image-library-changed', onChanged);
  }, []);
  return [rows, setRows];
}

function nyxSanitizeCharacterImages(raw){
  const src = raw && typeof raw === 'object' ? raw : {};
  const next = {};
  Object.keys(src).forEach((key) => {
    const row = src[key] && typeof src[key] === 'object' ? src[key] : {};
    const icon = nyxSafeImageSrc(row.icon);
    const background = nyxSafeImageSrc(row.background);
    if (icon || background) next[key] = { ...(icon ? { icon } : {}), ...(background ? { background } : {}) };
  });
  return next;
}

function nyxLoadCharacterImages(){
  try { return nyxSanitizeCharacterImages(JSON.parse(localStorage.getItem(NYX_CHARACTER_IMAGES_KEY) || '{}')); }
  catch (e) { return {}; }
}

function nyxSaveCharacterImages(next){
  const clean = nyxSanitizeCharacterImages(next);
  try { localStorage.setItem(NYX_CHARACTER_IMAGES_KEY, JSON.stringify(clean)); } catch (e) {}
  try { window.dispatchEvent(new CustomEvent('nyx:character-images-changed', { detail:clean })); } catch (e) {}
  return clean;
}

function nyxCharacterImageKey(gameKey, ch){
  const id = String(ch?.id || ch?.rawName || ch?.n || ch?.name || '').trim();
  return (gameKey || 'game') + ':' + id;
}

function nyxSetCharacterImage(gameKey, ch, patch){
  const key = nyxCharacterImageKey(gameKey, ch);
  if (!key || /:$/.test(key)) return nyxLoadCharacterImages();
  const current = nyxLoadCharacterImages();
  const row = { ...(current[key] || {}) };
  Object.keys(patch || {}).forEach((field) => {
    const safe = nyxSafeImageSrc(patch[field]);
    if (safe) row[field] = safe;
    else delete row[field];
  });
  if (row.icon || row.background) current[key] = row;
  else delete current[key];
  return nyxSaveCharacterImages(current);
}

function useNyxCharacterImagePrefs(){
  const [prefs, setPrefs] = React.useState(nyxLoadCharacterImages);
  React.useEffect(() => {
    const onChanged = (event) => setPrefs(nyxSanitizeCharacterImages(event.detail || nyxLoadCharacterImages()));
    window.addEventListener('nyx:character-images-changed', onChanged);
    return () => window.removeEventListener('nyx:character-images-changed', onChanged);
  }, []);
  return [prefs, setPrefs];
}

function nyxApplyCharacterCustomImages(gameKey, ch, prefs){
  const key = nyxCharacterImageKey(gameKey, ch);
  const row = (prefs || nyxLoadCharacterImages())[key];
  if (!row) return ch;
  const icon = nyxSafeImageSrc(row.icon);
  const background = nyxSafeImageSrc(row.background);
  if (!icon && !background) return ch;
  return {
    ...ch,
    originalIcon: ch.originalIcon || ch.icon || ch.circle,
    originalArt: ch.originalArt || ch.art || ch.card,
    ...(icon ? { icon, circle:icon, customIcon:icon } : {}),
    ...(background ? { art:background, card:background, customBackground:background } : {}),
  };
}

function nyxDedupeImageChoices(rows){
  const seen = new Set();
  return (rows || []).map((row) => {
    const src = nyxSafeImageSrc(row && row.src);
    return src ? { ...row, src } : null;
  }).filter(Boolean).filter((row) => {
    if (seen.has(row.src)) return false;
    seen.add(row.src);
    return true;
  });
}

function nyxCharacterImageChoices(base, view, kind){
  const rows = [];
  const add = (label, src, group) => rows.push({ label, src, group });
  const addMany = (label, list, group) => (list || []).forEach((src, i) => add(list.length > 1 ? label + ' ' + (i + 1) : label, src, group));
  if (kind === 'icon') {
    add('Current icon', view?.icon || view?.circle, 'Current');
    add('Base icon', base?.originalIcon || base?.icon || base?.circle, 'Character');
    (base?.forms || []).forEach((form) => add(form.formLabel || form.rawName || form.n || 'Form', form.icon || form.circle, 'Forms'));
  } else {
    add('Current art', view?.art || view?.card, 'Current');
    add('Base art', base?.originalArt || base?.art || base?.card, 'Character');
    add('Namecard', base?.namecard || view?.namecard, 'Character');
    add('Overview art', base?.overviewArt || view?.overviewArt, 'Overview');
    addMany('Overview', base?.overviewArtPool || view?.overviewArtPool, 'Overview');
    addMany('Birthday', base?.birthdayArtPool || view?.birthdayArtPool, 'Special');
    addMany('Holiday', base?.holidayArtPool || view?.holidayArtPool, 'Special');
    (base?.forms || []).forEach((form) => add(form.formLabel || form.rawName || form.n || 'Form', form.art || form.card, 'Forms'));
  }
  return nyxDedupeImageChoices(rows);
}

function NyxImageEditor({ label, aspect = 1, outputWidth = 512, outputHeight = 512, shape = 'square', onSave, onCancel }){
  const [sourceUrl, setSourceUrl] = React.useState('');
  const [fileName, setFileName] = React.useState('');
  const [zoom, setZoom] = React.useState(1);
  const [rotate, setRotate] = React.useState(0);
  const [panX, setPanX] = React.useState(0);
  const [panY, setPanY] = React.useState(0);
  const [flipX, setFlipX] = React.useState(false);
  const [flipY, setFlipY] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState('');
  const [library, setLibrary] = useNyxLocalImageLibrary();
  const imgRef = React.useRef(null);

  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  const setSource = (src, name = 'Local image', remember = false) => {
    const safe = nyxSafeImageSrc(src);
    if (!safe) {
      setError('Use PNG, JPEG, WebP, or GIF.');
      return;
    }
    setSourceUrl(safe);
    setFileName(name || 'Local image');
    setZoom(1);
    setRotate(0);
    setPanX(0);
    setPanY(0);
    setFlipX(false);
    setFlipY(false);
    setReady(false);
    if (remember) setLibrary(nyxRememberLocalImage(name, safe));
  };

  const pickFile = (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    setError('');
    if (!file) return;
    if (!NYX_SAFE_FILE_IMAGE_RE.test(file.type)) {
      setError('Use PNG, JPEG, WebP, or GIF.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError('This image could not be read locally.');
    reader.onload = () => setSource(reader.result, file.name || 'Local image', true);
    reader.readAsDataURL(file);
  };

  const commit = () => {
    const img = imgRef.current;
    if (!img || !ready) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, outputWidth, outputHeight);
      ctx.save();
      ctx.translate(outputWidth / 2 + (panX / 100) * outputWidth * .45, outputHeight / 2 + (panY / 100) * outputHeight * .45);
      ctx.rotate((rotate * Math.PI) / 180);
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      const baseScale = Math.min(outputWidth / img.naturalWidth, outputHeight / img.naturalHeight);
      const scale = baseScale * zoom;
      const drawW = img.naturalWidth * scale;
      const drawH = img.naturalHeight * scale;
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
      onSave(canvas.toDataURL('image/png'));
    } catch (e) {
      setError('This image could not be saved locally.');
    }
  };

  const useOriginal = () => {
    const safe = nyxSafeImageSrc(sourceUrl);
    if (!safe) return;
    onSave(safe);
  };

  const control = (name, value, min, max, step, setter, suffix = '') => (
    <label>
      <span>{name}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => setter(clamp(e.target.value, min, max))} />
      <input type="number" min={min} max={max} step={step} value={value} onChange={(e) => setter(clamp(e.target.value, min, max))} aria-label={name + ' value'} />
      <em>{suffix}</em>
    </label>
  );

  return (
    <div className={'nyx-img-editor shape-' + shape}>
      <div className="nyx-img-editor-head">
        <b>{label}</b>
        <label>
          <input type="file" accept={NYX_LOCAL_IMAGE_ACCEPT} onChange={pickFile} />
          <span>Choose File</span>
        </label>
      </div>
      {sourceUrl && (
        <div className="nyx-img-preview" style={{ aspectRatio:String(aspect) }}>
          <img
            ref={imgRef}
            src={sourceUrl}
            alt=""
            draggable="false"
            onLoad={() => setReady(true)}
            style={{ transform:`translate(${panX * .45}%, ${panY * .45}%) rotate(${rotate}deg) scale(${flipX ? -zoom : zoom}, ${flipY ? -zoom : zoom})` }}
          />
        </div>
      )}
      {library.length > 0 && (
        <div className="nyx-img-library-block">
          <div className="nyx-img-library-head">
            <span>Local image memory</span>
            <button type="button" onClick={() => { nyxSaveLocalImageLibrary([]); setLibrary([]); }}>Clear</button>
          </div>
          <div className="nyx-img-library" aria-label="Previously uploaded local images">
            {library.map((row) => (
              <button type="button" key={row.id} title={row.name} onClick={() => setSource(row.src, row.name, false)}>
                <img src={row.src} alt="" draggable="false" />
                <span>{row.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="nyx-img-fields">
        {control('Zoom', zoom, .1, 10, .01, setZoom, 'x')}
        {control('X Offset', panX, -500, 500, 1, setPanX)}
        {control('Y Offset', panY, -500, 500, 1, setPanY)}
        {control('Rotate', rotate, -360, 360, 1, setRotate, 'deg')}
      </div>
      <div className="nyx-img-flips" role="group" aria-label="Mirror image">
        <button type="button" className={flipX ? 'on' : ''} aria-pressed={flipX} onClick={() => setFlipX((v) => !v)} disabled={!sourceUrl}>Mirror Horizontal</button>
        <button type="button" className={flipY ? 'on' : ''} aria-pressed={flipY} onClick={() => setFlipY((v) => !v)} disabled={!sourceUrl}>Mirror Vertical</button>
      </div>
      <div className="nyx-img-actions">
        <span>{fileName || 'PNG, JPEG, WebP, or GIF. Stored only in this browser.'}</span>
        <button type="button" onClick={() => setRotate((r) => r - 90)} disabled={!sourceUrl}>Rotate Left</button>
        <button type="button" onClick={() => setRotate((r) => r + 90)} disabled={!sourceUrl}>Rotate Right</button>
        <button type="button" onClick={useOriginal} disabled={!sourceUrl}>Use Original</button>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" onClick={commit} disabled={!ready}>Save</button>
      </div>
      {error && <div className="nyx-img-error">{error}</div>}
    </div>
  );
}

function NyxImageChoiceControl({ label, active, choices, aspect, outputWidth, outputHeight, shape, onPick }){
  const [editing, setEditing] = React.useState(false);
  const visible = nyxDedupeImageChoices(choices).slice(0, 48);
  return (
    <div className="nyx-img-choice">
      <div className="nyx-img-choice-head">
        <b>{label}</b>
        <button type="button" onClick={() => setEditing((v) => !v)}>{editing ? 'Close Upload' : 'Upload Local'}</button>
        <button type="button" onClick={() => onPick(null)}>Reset</button>
      </div>
      {visible.length > 0 && (
        <div className="nyx-img-choice-row">
          {visible.map((row) => (
            <button type="button" key={row.src} className={active === row.src ? 'on' : ''} title={(row.group ? row.group + ': ' : '') + row.label} onClick={() => onPick(row.src)}>
              <img src={row.src} alt="" draggable="false" />
              <span>{row.label}</span>
            </button>
          ))}
        </div>
      )}
      {editing && (
        <NyxImageEditor
          label={'Upload ' + label}
          aspect={aspect}
          outputWidth={outputWidth}
          outputHeight={outputHeight}
          shape={shape}
          onSave={(src) => { onPick(src); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function CharacterImageControls({ gameKey, base, view, prefs, onPrefs }){
  if (!base || !view) return null;
  const key = nyxCharacterImageKey(gameKey, base);
  const custom = prefs[key] || {};
  const save = (patch) => onPrefs(nyxSetCharacterImage(gameKey, base, patch));
  return (
    <div className="cm-custom-art-panel">
      <NyxImageChoiceControl
        label="Character Icon"
        active={custom.icon || ''}
        choices={nyxCharacterImageChoices(base, view, 'icon')}
        aspect={1}
        outputWidth={512}
        outputHeight={512}
        shape="circle"
        onPick={(src) => save({ icon:src })}
      />
      <NyxImageChoiceControl
        label="Character Background"
        active={custom.background || ''}
        choices={nyxCharacterImageChoices(base, view, 'background')}
        aspect={16 / 9}
        outputWidth={1600}
        outputHeight={900}
        shape="wide"
        onPick={(src) => save({ background:src })}
      />
    </div>
  );
}

// G29/G30: newest-released character in a list (by release / updated / sourceOrder).
function cmCharRelease(ch){
  return Number(ch && (ch.release || ch.updated || ch.sourceOrder)) || 0;
}
function cmNewestChar(chars){
  let best = null;
  for (const ch of (chars || [])){
    if (ch && (!best || cmCharRelease(ch) > cmCharRelease(best))) best = ch;
  }
  return best;
}

function cmBirthdayArtPool(ch){
  return Array.isArray(ch?.birthdayArtPool) ? ch.birthdayArtPool.filter(Boolean) : [];
}

function cmHolidayArtPool(ch){
  return Array.isArray(ch?.holidayArtPool) ? ch.holidayArtPool.filter(Boolean) : [];
}

function cmSpecialArtPool(gameKey, ch){
  if (gameKey === 'gi') return cmBirthdayArtPool(ch);
  if (gameKey === 'hsr') return cmHolidayArtPool(ch);
  return [];
}

function cmSpecialArtClass(gameKey, base, view){
  const hasPool = cmSpecialArtPool(gameKey, base).length > 0 || cmSpecialArtPool(gameKey, view).length > 0;
  if (!hasPool) return '';
  if (gameKey === 'gi') return ' birthday';
  if (gameKey === 'hsr') return ' holiday';
  return ' special';
}

function cmPopupArtFor(gameKey, base, view, cycleIndex){
  const pool = cmSpecialArtPool(gameKey, base).length ? cmSpecialArtPool(gameKey, base) : cmSpecialArtPool(gameKey, view);
  if (pool.length) return pool[Math.abs(Number(cycleIndex || 0)) % pool.length];
  return cmArtFor(view);
}

function cmFormOptions(ch){
  const forms = Array.isArray(ch?.forms) ? ch.forms : [];
  const seen = new Set();
  const out = [];
  forms.forEach((form) => {
    const key = form.variantKey || String(form.formLabel || form.el || form.path || form.cls || form.id || '').toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ key, label:form.formLabel || form.variantValue || form.el || form.path || form.cls || 'Form' });
  });
  return out;
}

function cmGenderOptions(ch){
  const forms = Array.isArray(ch?.forms) ? ch.forms : [];
  const seen = new Set();
  const out = [];
  forms.forEach((form) => {
    if (!form.gender || seen.has(form.gender)) return;
    seen.add(form.gender);
    out.push({ key:form.gender, label:form.genderLabel || form.gender });
  });
  return out;
}

function cmActiveForm(ch, variantKey, genderKey){
  const forms = Array.isArray(ch?.forms) ? ch.forms : [];
  if (!forms.length) return ch;
  const desiredVariant = variantKey || forms[0].variantKey;
  const desiredGender = genderKey || forms[0].gender || null;
  return forms.find((form) => form.variantKey === desiredVariant && (!desiredGender || form.gender === desiredGender))
    || forms.find((form) => form.variantKey === desiredVariant)
    || forms.find((form) => !desiredGender || form.gender === desiredGender)
    || forms[0]
    || ch;
}

function cmIdentityAliases(ch, names){
  const seen = new Set();
  return [...(ch?.aliases || []), ...(names || [])]
    .filter(Boolean)
    .filter((name) => {
      const key = String(name).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function cmWithIdentityDisplay(ch, label, opts = {}){
  const icon = opts.icon !== undefined ? opts.icon : ch.icon;
  const circle = opts.circle !== undefined ? opts.circle : ch.circle;
  const iconZoom = opts.iconZoom !== undefined ? opts.iconZoom : ch.iconZoom;
  const iconPosition = opts.iconPosition !== undefined ? opts.iconPosition : ch.iconPosition;
  const forms = opts.forms !== undefined ? opts.forms : ch.forms;
  const nextForms = Array.isArray(forms) ? forms.map((form) => ({
    ...form,
    n: label,
    icon: opts.formIcon !== undefined ? opts.formIcon : form.icon,
    circle: opts.formCircle !== undefined ? opts.formCircle : form.circle,
    iconZoom: opts.formIconZoom !== undefined ? opts.formIconZoom : form.iconZoom,
    iconPosition: opts.formIconPosition !== undefined ? opts.formIconPosition : form.iconPosition,
  })) : forms;
  return {
    ...ch,
    n: label,
    rawName: label,
    baseName: opts.baseName || ch.baseName || ch.n,
    aliases: cmIdentityAliases(ch, opts.aliases),
    icon,
    circle,
    iconZoom,
    iconPosition,
    forms: nextForms,
  };
}

function cmApplyLanguageDisplay(gameKey, ch, prefs){
  if (!ch) return ch;
  const lang = cmSanitizeLanguagePrefs(prefs)[gameKey] || 'en';
  if (lang === 'en') return ch;
  const localized = ch.localizedNames && ch.localizedNames[lang];
  if (!localized) return ch;
  const forms = Array.isArray(ch.forms) ? ch.forms.map((form) => ({
    ...form,
    englishName: form.englishName || form.n,
    n: form.localizedNames?.[lang] || localized,
  })) : ch.forms;
  return {
    ...ch,
    englishName: ch.englishName || ch.n,
    n: localized,
    forms,
  };
}

function cmFormsForGender(ch, gender){
  const forms = Array.isArray(ch?.forms) ? ch.forms : [];
  const filtered = forms.filter((form) => form.gender === gender);
  return filtered.length ? filtered : forms;
}

function cmApplyIdentityDisplay(gameKey, ch, prefs){
  if (!ch) return ch;
  const id = String(ch.id || '').toLowerCase();
  const name = String(ch.n || ch.rawName || '').toLowerCase();
  if (gameKey === 'gi' && (id === 'gi-traveler' || name === 'traveler')) {
    const custom = CM_IDENTITY_ASSETS.gi[prefs.twin];
    if (custom) {
      return cmWithIdentityDisplay(ch, custom.label, {
        icon:custom.icon,
        circle:custom.icon,
        iconZoom:custom.iconZoom,
        iconPosition:custom.iconPosition,
        formIcon:custom.icon,
        formCircle:custom.icon,
        formIconZoom:custom.iconZoom,
        formIconPosition:custom.iconPosition,
        aliases:['Traveler', 'Aether', 'Lumine', 'Paimon', 'Little One', 'Arama'],
      });
    }
    const choice = prefs.twin === 'lumine' ? 'lumine' : 'aether';
    const label = choice === 'lumine' ? 'Lumine' : 'Aether';
    const gender = choice === 'lumine' ? 'female' : 'male';
    const forms = cmFormsForGender(ch, gender);
    const first = forms[0] || {};
    return cmWithIdentityDisplay(ch, label, {
      forms,
      icon:first.icon || ch.icon,
      circle:first.circle || ch.circle,
      iconZoom:first.iconZoom || ch.iconZoom,
      aliases:['Traveler', 'Aether', 'Lumine'],
    });
  }
  if (gameKey === 'hsr' && (id === 'hsr-trailblazer' || name === 'trailblazer')) {
    const choice = CM_IDENTITY_ASSETS.hsr[prefs.receptacle] ? prefs.receptacle : 'caelus';
    const asset = CM_IDENTITY_ASSETS.hsr[choice];
    const opts = {
      icon:asset.icon,
      circle:asset.icon,
      iconZoom:asset.iconZoom,
      iconPosition:asset.iconPosition,
      formIcon:asset.icon,
      formCircle:asset.icon,
      formIconZoom:asset.iconZoom,
      formIconPosition:asset.iconPosition,
      aliases:['Trailblazer', 'Caelus', 'Stelle', 'Pom-Pom', 'Gepard?', 'I am Trash'],
    };
    if (!asset.icon) {
      delete opts.icon;
      delete opts.circle;
      delete opts.formIcon;
      delete opts.formCircle;
    }
    return cmWithIdentityDisplay(ch, asset.label, opts);
  }
  if (gameKey === 'zzz' && (id === 'zzz-pyrois' || name === 'pyrois')) {
    const choice = CM_IDENTITY_ASSETS.zzz[prefs.sibling] ? prefs.sibling : 'wise';
    const asset = CM_IDENTITY_ASSETS.zzz[choice];
    return cmWithIdentityDisplay(ch, asset.label, {
      icon:asset.icon,
      circle:asset.icon,
      iconZoom:asset.iconZoom,
      iconPosition:asset.iconPosition,
      formIcon:asset.icon,
      formCircle:asset.icon,
      formIconZoom:asset.iconZoom,
      formIconPosition:asset.iconPosition,
      aliases:['Pyrois', 'Lord Phaethon', 'Phaethon', 'Wise', 'Belle', 'Eous', 'Fairy'],
    });
  }
  if (gameKey === 'wuwa' && (id === 'wuwa-rover' || name === 'rover')) {
    const choice = CM_IDENTITY_ASSETS.wuwa[prefs.rover] ? prefs.rover : 'male';
    const asset = CM_IDENTITY_ASSETS.wuwa[choice];
    return cmWithIdentityDisplay(ch, asset.label, {
      icon:asset.icon,
      circle:asset.icon,
      iconZoom:asset.iconZoom,
      iconPosition:asset.iconPosition,
      formIcon:asset.icon,
      formCircle:asset.icon,
      formIconZoom:asset.iconZoom,
      formIconPosition:asset.iconPosition,
      aliases:['Rover', 'Male Rover', 'Female Rover', 'Abby'],
    });
  }
  if (gameKey === 'ae' && (id === 'ae-endministrator' || name === 'endministrator')) {
    const choice = prefs.endmin || 'male';
    if (choice === 'penguin') {
      const asset = CM_IDENTITY_ASSETS.ae.penguin;
      const forms = (Array.isArray(ch.forms) && ch.forms.length ? [ch.forms[0]] : ch.forms);
      return cmWithIdentityDisplay(ch, asset.label, {
        forms,
        icon:asset.icon,
        circle:asset.icon,
        iconZoom:asset.iconZoom,
        iconPosition:asset.iconPosition,
        formIcon:asset.icon,
        formCircle:asset.icon,
        formIconZoom:asset.iconZoom,
        formIconPosition:asset.iconPosition,
        aliases:['Endministrator', 'Endmin', 'Penguin'],
      });
    }
    const gender = choice === 'female' ? 'female' : 'male';
    const forms = cmFormsForGender(ch, gender);
    const first = forms[0] || {};
    const label = gender === 'female' ? 'Female Endministrator' : 'Male Endministrator';
    return cmWithIdentityDisplay(ch, label, {
      forms,
      icon:first.icon || ch.icon,
      circle:first.circle || ch.circle,
      iconZoom:first.iconZoom || ch.iconZoom,
      aliases:['Endministrator', 'Endmin', 'Male Endministrator', 'Female Endministrator', 'Male Endmin', 'Female Endmin'],
    });
  }
  return ch;
}

function cmSearchExtra(ch){
  const forms = Array.isArray(ch?.forms) ? ch.forms : [];
  return [
    ch?.title,
    cmRoleLabel(ch || {}),
    ...(ch?.aliases || []),
    ...forms.flatMap((form) => [
      form.rawName,
      form.formLabel,
      form.variantValue,
      form.genderLabel,
      form.el,
      form.path,
      form.cls,
    ]),
  ].filter(Boolean).join(' ');
}

/* a roster cell */
function CMCell({ ch, onClick, hideMode, hidden, onToggleHidden }){
  return (
    <button
      type="button"
      className={'cm-cell' + (hideMode ? ' hide-mode' : '') + (hidden ? ' hidden' : '')}
      title={hideMode ? (hidden ? 'Unhide ' : 'Hide ') + ch.n : ch.n}
      aria-pressed={hideMode ? !!hidden : undefined}
      onClick={() => { if (hideMode && onToggleHidden) onToggleHidden(ch); else if (onClick) onClick(); }}
    >
      <CMAvatar ch={ch} />
      <span className="cn">{ch.n}</span>
      {ch.__betaNew && <span className="cm-beta-tag" title="Beta (latest) data — upcoming, not yet released">Beta</span>}
      {hideMode && <span className="hm">{hidden ? 'Hidden' : 'Hide'}</span>}
    </button>
  );
}

// ----- Beta / Live channel (user-approved opt-in toggle, defaults to Live) -----
function cmHasBeta(gk){
  return !!(typeof window !== 'undefined' && window.CM_BETA_FILES && window.CM_BETA_FILES[gk]);
}
function cmLoadChannel(gk){
  try {
    if (cmAlwaysBetaEnabled() && cmHasBeta(gk)) return 'beta';
    return localStorage.getItem('nyx:cm-channel:' + gk) === 'beta' ? 'beta' : 'live';
  }
  catch (e) { return 'live'; }
}
function cmSaveChannel(gk, ch){
  try { localStorage.setItem('nyx:cm-channel:' + gk, ch); } catch (e) {}
}
// Merge the shipped beta delta over the live roster: changed characters are replaced by id,
// brand-new beta characters are appended and surfaced in the recent strip.
function cmMergeBetaCfg(liveCfg, betaPack){
  if (!liveCfg) return liveCfg;
  if (!betaPack || !Array.isArray(betaPack.roster) || !betaPack.roster.length) return liveCfg;
  const byId = new Map(betaPack.roster.map((ch) => [ch.id, { ...ch, __beta:true, __betaNew: ch.betaStatus === 'new' }]));
  const liveIds = new Set(liveCfg.roster.map((ch) => ch.id));
  const merged = liveCfg.roster.map((ch) => byId.get(ch.id) || ch);
  for (const ch of betaPack.roster){
    if (!liveIds.has(ch.id)) merged.push({ ...ch, __beta:true, __betaNew:true, recent:true });
  }
  return { ...liveCfg, roster: merged, __betaActive:true };
}

function CharMaterials({ open, onClose, game, inline, selectedName, modalOnly, pageTab, onPageTab, sections, customizeOnly, onCustomizeCharacter, onBackCustomize }){
  const [gk, setGk] = React.useState(game || 'gi');
  const [channel, setChannel] = React.useState(() => cmLoadChannel(game || 'gi'));
  const [dataTick, setDataTick] = React.useState(0);
  const [tab, setTab] = React.useState(() => {
    try {
      const saved = localStorage.getItem('nyx:character-material-tab:v1');
      return ['roster', 'mid', 'boss'].includes(saved) ? saved : 'roster';
    } catch (e) {
      return 'roster';
    }
  }); // roster | mid | boss
  const [sel, setSel] = React.useState(null);
  const [q, setQ] = React.useState('');
  const [filt, setFilt] = React.useState({});
  const [showFilt, setShowFilt] = React.useState(false);
  const [hideMenu, setHideMenu] = React.useState(false);
  const [sectionMenuOpen, setSectionMenuOpen] = React.useState(false); // G13: header section dropdown
  const [hideMode, setHideMode] = React.useState(false);
  const [showHidden, setShowHidden] = React.useState(false);
  const [hiddenPrefs, setHiddenPrefs] = React.useState(cmLoadHiddenPrefs);
  const [day, setDay] = React.useState(() => { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; }); // 0=Mon..6=Sun
  const [giPreset, setGiPreset] = React.useState('9-9-9');
  const [giTargets, setGiTargets] = React.useState([9, 9, 9]);
  const [giAscLevel, setGiAscLevel] = React.useState(90);
  const [hsrTargets, setHsrTargets] = React.useState([6, 10, 10, 10]);
  const [hsrMax, setHsrMax] = React.useState(true);
  const [activeVariant, setActiveVariant] = React.useState(null);
  const [activeGender, setActiveGender] = React.useState(null);
  const [activeArtIndex, setActiveArtIndex] = React.useState(0);
  const [artCycle, setArtCycle] = React.useState({});
  const [weaponPickByChar, setWeaponPickByChar] = React.useState({});
  const [weaponPickerOpen, setWeaponPickerOpen] = React.useState(false);
  const [weaponSearch, setWeaponSearch] = React.useState('');
  const [totalIncludeByChar, setTotalIncludeByChar] = React.useState(cmLoadTotalIncludePrefs);
  const [customizeOpen, setCustomizeOpen] = React.useState(false);
  const [ledgerRestoreScroll, setLedgerRestoreScroll] = React.useState(0);
  const [identityPrefs, setIdentityPrefs] = React.useState(cmLoadIdentityPrefs);
  const [unitPrefs, setUnitPrefs] = React.useState(cmLoadSpecialUnitPrefs);
  const [languagePrefs, setLanguagePrefs] = React.useState(cmLoadLanguagePrefs);
  const [characterImagePrefs, setCharacterImagePrefs] = useNyxCharacterImagePrefs();

  const betaAvailable = cmHasBeta(gk);
  const liveCfg = CM_CFG[gk] || null;
  const betaPack = (typeof window !== 'undefined' && window.CM_CFG_BETA) ? window.CM_CFG_BETA[gk] : null;
  const useBeta = channel === 'beta' && betaAvailable;
  const cfg = (useBeta && betaPack) ? cmMergeBetaCfg(liveCfg, betaPack) : liveCfg;

  const switchChannel = React.useCallback((ch) => {
    setChannel(ch);
    cmSaveChannel(gk, ch);
    setSel(null);
  }, [gk]);

  const openCharacter = React.useCallback((ch) => {
    if (!ch) return;
    const key = cmHiddenKey(ch);
    const pool = cmSpecialArtPool(gk, ch);
    const idx = pool.length > 1 ? (artCycle[key] || 0) : 0;
    setActiveArtIndex(idx);
    setSel(ch);
    if (pool.length > 1) {
      setArtCycle((prev) => ({ ...prev, [key]: (idx + 1) % pool.length }));
    }
  }, [artCycle, gk]);

  React.useEffect(() => {
    const onIdentity = (event) => {
      const next = cmSanitizeIdentityPrefs(event.detail || cmLoadIdentityPrefs());
      setIdentityPrefs((prev) => (cmIdentityPrefsKey(prev) === cmIdentityPrefsKey(next) ? prev : next));
    };
    window.addEventListener('nyx:identity-changed', onIdentity);
    return () => window.removeEventListener('nyx:identity-changed', onIdentity);
  }, []);

  React.useEffect(() => {
    const onSettings = (event) => {
      const detail = event.detail || {};
      const next = cmSanitizeSpecialUnitPrefs(detail.specialUnits || cmLoadSpecialUnitPrefs());
      const nextLang = cmSanitizeLanguagePrefs(detail.language || cmLoadLanguagePrefs());
      setUnitPrefs(next);
      setLanguagePrefs((prev) => (cmLanguagePrefsKey(prev) === cmLanguagePrefsKey(nextLang) ? prev : nextLang));
      window.NYX_ALWAYS_BETA = detail.alwaysBeta === true;
      setChannel(cmLoadChannel(gk));
    };
    window.addEventListener('nyx:settings-changed', onSettings);
    return () => window.removeEventListener('nyx:settings-changed', onSettings);
  }, [gk]);

  React.useEffect(() => { setSel(null); }, [identityPrefs, unitPrefs, languagePrefs, gk]);

  React.useEffect(() => {
    let live = true;
    const onLoaded = (event) => {
      if (!event.detail || event.detail.key === gk) setDataTick((v) => v + 1);
    };
    window.addEventListener('nyx:cm-game-loaded', onLoaded);
    if ((open || inline || modalOnly || customizeOnly) && !CM_CFG[gk] && window.loadNyxCmGame) {
      window.loadNyxCmGame(gk).then(() => { if (live) setDataTick((v) => v + 1); }).catch(() => {
        if (live) setDataTick((v) => v + 1);
      });
    }
    return () => {
      live = false;
      window.removeEventListener('nyx:cm-game-loaded', onLoaded);
    };
  }, [gk, open, inline, modalOnly, customizeOnly]);

  React.useEffect(() => {
    if (channel !== 'beta' || !betaAvailable) return undefined;
    let live = true;
    const onBeta = (event) => { if (!event.detail || event.detail.key === gk) setDataTick((v) => v + 1); };
    window.addEventListener('nyx:cm-beta-loaded', onBeta);
    if (window.CM_CFG_BETA && !window.CM_CFG_BETA[gk] && window.loadNyxCmBeta) {
      window.loadNyxCmBeta(gk).then(() => { if (live) setDataTick((v) => v + 1); }).catch(() => {});
    }
    return () => { live = false; window.removeEventListener('nyx:cm-beta-loaded', onBeta); };
  }, [gk, channel, betaAvailable]);

  // the Live/Beta toggle now lives in the page bottom-left corner (rendered by
  // the shell); sync this panel's channel when it fires for our game.
  React.useEffect(() => {
    const onChan = (event) => {
      const d = event.detail || {};
      if (d.key === gk && (d.channel === 'live' || d.channel === 'beta')) {
        setChannel(d.channel);
        setSel(null);
      }
    };
    window.addEventListener('nyx:cm-channel-changed', onChan);
    return () => window.removeEventListener('nyx:cm-channel-changed', onChan);
  }, [gk]);

  React.useEffect(() => { if (open || inline || customizeOnly) { setGk(game || 'gi'); if (!selectedName) setSel(null); } }, [open, inline, customizeOnly, game, selectedName]);
  React.useEffect(() => { setSel(null); setQ(''); setFilt({}); setShowFilt(false); setHideMenu(false); setSectionMenuOpen(false); setChannel(cmLoadChannel(gk)); }, [gk]);
  React.useEffect(() => {
    if (!sectionMenuOpen) return undefined;
    const onDoc = () => setSectionMenuOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [sectionMenuOpen]);
  React.useEffect(() => {
    if (!sel) {
      setActiveVariant(null);
      setActiveGender(null);
      setCustomizeOpen(false);
      return;
    }
    const wanted = String(selectedName || '').toLowerCase();
    const form = (sel.forms || []).find((row) => String(row.rawName || row.n || '').toLowerCase() === wanted);
    setActiveVariant(form?.variantKey || null);
    setActiveGender(form?.gender || null);
  }, [sel && sel.id, selectedName]);
  React.useEffect(() => {
    try { localStorage.setItem('nyx:character-material-tab:v1', tab); } catch (e) {}
  }, [tab]);
  React.useEffect(() => {
    if (!selectedName) return;
    const activeGame = game || gk;
    const nextCfg = CM_CFG[activeGame] || cfg || { roster:[] };
    const nextRoster = (nextCfg.roster || [])
      .map((ch) => cmApplyIdentityDisplay(activeGame, ch, identityPrefs))
      .filter((ch) => cmSpecialUnitVisible(activeGame, ch, unitPrefs))
      .map((ch) => cmApplyLanguageDisplay(activeGame, ch, languagePrefs))
      .map((ch) => nyxApplyCharacterCustomImages(activeGame, ch, characterImagePrefs));
    const wanted = String(selectedName).toLowerCase();
    const found = nextRoster.find((ch) => (
      String(ch.n || '').toLowerCase() === wanted
      || (ch.forms || []).some((form) => String(form.rawName || form.n || '').toLowerCase() === wanted)
    ));
    if (found) {
      const form = (found.forms || []).find((row) => String(row.rawName || row.n || '').toLowerCase() === wanted);
      openCharacter(found);
      if (form) {
        setActiveVariant(form.variantKey || null);
        setActiveGender(form.gender || null);
      }
    }
  }, [selectedName, game, gk, dataTick, identityPrefs, unitPrefs, languagePrefs, characterImagePrefs]);
  React.useEffect(() => {
    setWeaponPickerOpen(false);
    setWeaponSearch('');
  }, [gk, sel && cmHiddenKey(sel), activeVariant, activeGender]);
  // Accessible modal dialog: focus the Close button on open, trap Tab within the
  // dialog, close on Escape, and restore focus to the triggering card on close.
  const cmPopRef = React.useRef(null);
  const cmCloseBtnRef = React.useRef(null);
  const cmLedgerMainRef = React.useRef(null);
  React.useEffect(() => {
    if (!sel) return undefined;
    const trigger = (typeof document !== 'undefined') ? document.activeElement : null;
    const focusTimer = setTimeout(() => { if (cmCloseBtnRef.current) cmCloseBtnRef.current.focus(); }, 0);
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setWeaponPickerOpen(false);
        setSel(null);
        if (modalOnly && onClose) onClose();
        return;
      }
      if (event.key === 'Tab' && cmPopRef.current) {
        const f = cmPopRef.current.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey);
      if (trigger && typeof trigger.focus === 'function') { try { trigger.focus(); } catch (e) {} }
    };
  }, [sel, modalOnly, onClose]);

  if (!inline && !open) return null;
  if (!cfg) {
    const gameName = (window.CM_GAME_LABELS && window.CM_GAME_LABELS[gk]) || gk.toUpperCase();
    const loader = (
      <div className="cm-panel cm-loading" data-screen-label="Character Materials loading">
        <div className="cm-load-eye"></div>
        <div className="cm-ttl">
          <div className="t">Character Materials</div>
          <div className="s">Loading {gameName}</div>
        </div>
      </div>
    );
    if (inline) return <div className="cm-inline">{loader}</div>;
    return (
      <div className="cm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
        {loader}
      </div>
    );
  }

  const gMeta = cfg;
  const displayRoster = (cfg.roster || [])
    .map((ch) => cmApplyIdentityDisplay(gk, ch, identityPrefs))
    .filter((ch) => cmSpecialUnitVisible(gk, ch, unitPrefs))
    .map((ch) => cmApplyLanguageDisplay(gk, ch, languagePrefs))
    .map((ch) => nyxApplyCharacterCustomImages(gk, ch, characterImagePrefs));
  const byName = {};
  displayRoster.forEach(ch => {
    [ch.n, ch.rawName, ch.baseName, ...(ch.aliases || [])].filter(Boolean).forEach((key) => {
      if (!byName[key]) byName[key] = ch;
    });
  });
  const resolve = (name) => byName[name] || { n:name, r:cfg.rarities[0], el:cfg.filters[0].opts[0] };

  const qq = q.trim().toLowerCase();
  const passQ = (ch) => !qq || nyxMatchesSearch(ch.n, ch.rawName, qq, cmSearchExtra(ch));
  const passF = (ch) => Object.keys(filt).every(k => {
    const v = filt[k]; if (v === undefined || v === null) return true;
    if (k === 'r') return ch.r === v || (ch.forms || []).some((form) => form.r === v);
    if ((ch.forms || []).some((form) => form[k] === v)) return true;
    if (ch[k] === undefined) return true; // lenient: missing field doesn't exclude
    return ch[k] === v;
  });
  const activeHideScope = tab === 'roster' ? 'roster' : 'materials';
  const hiddenBucket = hiddenPrefs.sync ? 'all' : activeHideScope;
  const hiddenIds = new Set((hiddenPrefs[hiddenBucket] && hiddenPrefs[hiddenBucket][gk]) || []);
  const hiddenCount = hiddenIds.size;
  const isHidden = (ch) => hiddenIds.has(cmHiddenKey(ch));
  const passHidden = (ch) => showHidden || !isHidden(ch);
  const show = (ch) => passQ(ch) && passF(ch) && passHidden(ch);
  const updateHiddenPrefs = (fn) => {
    setHiddenPrefs((prev) => {
      const base = {
        ...cmEmptyHiddenPrefs(),
        ...prev,
        all:{ ...(prev.all || {}) },
        roster:{ ...(prev.roster || {}) },
        materials:{ ...(prev.materials || {}) },
      };
      const next = fn(base);
      cmSaveHiddenPrefs(next);
      return next;
    });
  };
  const toggleHidden = (ch) => {
    const id = cmHiddenKey(ch);
    if (!id) return;
    updateHiddenPrefs((base) => {
      const bucket = base.sync ? 'all' : activeHideScope;
      const perGame = { ...(base[bucket] || {}) };
      const arr = Array.isArray(perGame[gk]) ? perGame[gk] : [];
      perGame[gk] = arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
      return { ...base, [bucket]:perGame };
    });
  };
  const setHiddenSync = (sync) => {
    updateHiddenPrefs((base) => {
      if (!sync) return { ...base, sync:false };
      const all = { ...(base.all || {}) };
      all[gk] = [...new Set([...(all[gk] || []), ...((base.roster || {})[gk] || []), ...((base.materials || {})[gk] || [])])];
      return { ...base, sync:true, all };
    });
  };
  const clearHiddenScope = () => {
    updateHiddenPrefs((base) => {
      const bucket = base.sync ? 'all' : activeHideScope;
      const perGame = { ...(base[bucket] || {}) };
      perGame[gk] = [];
      return { ...base, [bucket]:perGame };
    });
  };
  const renderCell = (prefix, c, i) => (
    <CMCell
      key={cmCharKey(prefix, c, i)}
      ch={c}
      hideMode={hideMode}
      hidden={isHidden(c)}
      onToggleHidden={toggleHidden}
      onClick={() => openCharacter(c)}
    />
  );

  // ----- roster tab data -----
  const roster = displayRoster.filter(show);
  // G14: beta-new units lead the Recent strip. G24: Recent is an ADDITIONAL
  // quick-access row — units still appear under their 5★/4★ rarity group too.
  const recent = displayRoster.filter((ch) => ch.recent).filter(show)
    .sort((a, b) => (a.__betaNew ? 0 : 1) - (b.__betaNew ? 0 : 1));
  const rarityGroups = cfg.rarities.map(r => ({ r, label:cfg.rarityLabel[r], list:roster.filter(c => c.r === r) }));

  // ----- mid tab helpers -----
  const giDayTrio = day === 6 ? null : (day % 3);
  const giVisibleTrio = qq ? null : giDayTrio;

  // chunk a char list across n materials
  const chunk = (arr, n) => {
    if (n <= 1) return [arr];
    const out = Array.from({ length:n }, () => []);
    arr.forEach((x, i) => out[i % n].push(x));
    return out;
  };

  const tokenColor = (label) => CM_ELEM[label] || '#9a89ea';
  const giTalentBlocks = (cfg.talentDomains || []).map((domain, di) => {
    const rows = (domain.trios || [])
      .filter((trio) => giVisibleTrio === null || trio.trioIndex === giVisibleTrio)
      .map((trio, ti) => {
        const chars = (trio.chars || []).map(resolve).filter(show);
        return { domain, trio, chars, key:'talent-' + di + '-' + ti };
      })
      .filter((row) => row.chars.length > 0);
    const art = cmArtFor(cmNewestChar(rows.flatMap((r) => r.chars)) || {});
    return rows.length ? { domain, rows, art } : null;
  }).filter(Boolean);
  const giWeeklyBlocks = (cfg.weeklyBosses || []).map((boss, bi) => {
    const drops = (boss.drops || [])
      .map((drop, di) => {
        const chars = (drop.chars || []).map(resolve).filter(show);
        return { drop, chars, key:'weekly-' + bi + '-' + di };
      })
      .filter((row) => row.chars.length > 0);
    const newest = cmNewestChar(drops.flatMap((r) => r.chars));
    return drops.length ? { boss, drops, art:cmArtFor(newest || {}), order:cmCharRelease(newest) } : null;
  }).filter(Boolean).sort((a, b) => b.order - a.order);
  const activePreset = CM_GI_PRESETS.find((p) => p.targets.every((v, i) => v === giTargets[i]))
    || { key:'custom', label:giTargets.join('/'), targets:giTargets };

  const viewBase = sel ? cmActiveForm(sel, activeVariant, activeGender) : null;
  const view = viewBase ? nyxApplyCharacterCustomImages(gk, viewBase, characterImagePrefs) : null;
  const formOptions = cmFormOptions(sel);
  const genderOptions = cmGenderOptions(sel);
  const hsrTalentTargets = hsrMax ? CM_TALENT_CFG.hsr.max : hsrTargets;
  const talentTargets = gk === 'gi' ? giTargets : (gk === 'hsr' ? hsrTalentTargets : activePreset.targets);
  const req = view ? cmRequirements(gk, view, { targets:talentTargets }) : null;
  const giAsc = (gk === 'gi' && req && req.ascension) ? cmGiAscensionForLevel(req.ascension, req.ascCost, giAscLevel) : null;
  const ascItems = giAsc ? giAsc.items : (req?.ascension || []);
  const ascItemsCost = giAsc ? giAsc.cost : (req?.ascCost || 0);
  const ascReq = req ? cmReqItems([cmCurrencyMat(cfg, ascItemsCost), ...ascItems]) : [];
  const talentReq = req ? cmReqItems([cmCurrencyMat(cfg, req.talentCost), ...(req.talents || [])]) : [];
  const weaponOptions = view ? (cfg.weapons || []).filter((weapon) => cmWeaponCompatible(gk, view, weapon)) : [];
  const weaponPickKey = view ? `${gk}:${cmHiddenKey(view)}` : null;
  const signatureWeaponId = view?.signatureWeaponId || view?.signatureWeapon?.id || view?.signatureLightCone?.id || req?.weapon?.id || null;
  const signatureWeapon = signatureWeaponId
    ? weaponOptions.find((weapon) => String(weapon.id) === String(signatureWeaponId)) || null
    : null;
  const pickedWeaponId = weaponPickKey ? weaponPickByChar[weaponPickKey] : null;
  const pickedWeapon = pickedWeaponId ? weaponOptions.find((weapon) => String(weapon.id) === String(pickedWeaponId)) || null : null;
  const fallbackWeapon = req?.weapon ? {
    id: req.weapon.id || signatureWeaponId || req.weapon.name,
    name: req.weapon.name || view?.signatureWeaponName || 'Signature',
    icon: req.weapon.icon || req.weapon.art,
    art: req.weapon.art || req.weapon.icon,
    path: req.weapon.path,
    weaponType: req.weapon.weaponType,
    type: req.weapon.type || req.weapon.path || req.weapon.weaponType,
    items: req.weapon.items || [],
    cost: Number(req.weapon.cost || req.weaponCost || 0),
    educated: !!req.weapon.educated,
  } : null;
  const activeWeapon = pickedWeapon || signatureWeapon || fallbackWeapon;
  const weaponReq = activeWeapon ? cmReqItems([cmCurrencyMat(cfg, activeWeapon.cost || req?.weaponCost), ...(activeWeapon.items || [])]) : [];
  const totalIncludeKey = view ? `${gk}:${cmHiddenKey(view)}` : null;
  const ledgerInclude = {
    ...CM_DEFAULT_TOTAL_INCLUDE,
    ...(totalIncludeKey ? (totalIncludeByChar[totalIncludeKey] || {}) : {}),
  };
  const totalReq = cmCombineReqItems(
    ledgerInclude.ascension ? ascReq : [],
    ledgerInclude.talents ? talentReq : [],
    ledgerInclude.weapon ? weaponReq : [],
  );
  const hasAnyLedgerReq = ascReq.length > 0 || talentReq.length > 0 || weaponReq.length > 0;
  // G23: keep the Ascension / Talents rows on screen even when the chosen level/targets
  // compute to zero materials (e.g. Lv 1 or all talents at 1) — show an empty-state
  // instead of letting the whole section vanish.
  const hasAscData = !!(req && Array.isArray(req.ascension) && req.ascension.length > 0);
  const hasTalentData = !!(req && ((Array.isArray(req.talents) && req.talents.length > 0)
    || (Array.isArray(req.talentStages) && req.talentStages.some((s) => s.length))));
  const selArt = view ? (view.customBackground || cmPopupArtFor(gk, sel, view, activeArtIndex)) : null;
  const specialArtClass = view && !view.customBackground ? cmSpecialArtClass(gk, sel, view) : '';
  const metaChips = view ? cmMetaChips(gk, view) : [];
  const releaseText = view ? cmCharacterReleaseText(view) : '';
  const voiceRows = view ? cmVoiceRows(view, gk) : [];
  if (customizeOnly) {
    return (
      <div className="cm-inline cm-custom-page">
        <div className="cm-custom-page-head">
          <button type="button" className="cm-custom-back" onClick={onBackCustomize}>
            <span>{'\u2039'}</span><b>Back to Materials</b>
          </button>
          <div>
            <b>{view?.n || selectedName || 'Character'} Visuals</b>
            <em>Icon and background choices are stored locally in this browser.</em>
          </div>
        </div>
        {view && sel ? (
          <CharacterImageControls
            gameKey={gk}
            base={sel}
            view={view}
            prefs={characterImagePrefs}
            onPrefs={setCharacterImagePrefs}
          />
        ) : (
          <div className="cm-empty">Select a character before opening visual customization.</div>
        )}
      </div>
    );
  }
  const setGiTalentTarget = (index, value) => {
    const next = giTargets.slice(0, 3);
    next[index] = Math.max(1, Math.min(10, Number(value) || 1));
    setGiTargets(next);
    setGiPreset(next.join('-'));
  };
  const pickWeapon = (weaponId) => {
    if (!weaponPickKey) return;
    setWeaponPickByChar((prev) => {
      const next = { ...prev };
      if (weaponId === null) delete next[weaponPickKey];
      else next[weaponPickKey] = String(weaponId);
      return next;
    });
    setWeaponPickerOpen(false);
    setWeaponSearch('');
  };
  const filteredWeapons = weaponOptions.filter((weapon) => {
    const text = weaponSearch.trim().toLowerCase();
    return !text || String(weapon.name || '').toLowerCase().includes(text);
  });
  const weaponLabel = cmWeaponRowLabel(gk);
  // The auto-selected signature (no manual pick) is an educated guess; the
  // disclaimer now lives in a hover tooltip on that signature option, not inline.
  const isSignatureGuess = !!activeWeapon && !pickedWeapon;
  const toggleLedger = (key) => {
    if (!totalIncludeKey) return;
    setTotalIncludeByChar((prev) => {
      const cur = { ...CM_DEFAULT_TOTAL_INCLUDE, ...(prev[totalIncludeKey] || {}) };
      cur[key] = !cur[key];
      const next = { ...prev, [totalIncludeKey]:cur };
      cmSaveTotalIncludePrefs(next);
      return next;
    });
  };
  const closePop = () => {
    setCustomizeOpen(false);
    setSel(null);
    if (modalOnly && onClose) onClose();
  };
  const openCustomize = () => {
    if (typeof onCustomizeCharacter === 'function' && sel) {
      const body = (typeof document !== 'undefined') ? document.querySelector('.cm-body') : null;
      onCustomizeCharacter({
        game:gk,
        name:sel.rawName || sel.n || selectedName,
        restoreScroll:body ? body.scrollTop : 0,
      });
      setCustomizeOpen(false);
      setSel(null);
      if (modalOnly && onClose) onClose();
      return;
    }
    const node = cmLedgerMainRef.current;
    setLedgerRestoreScroll(node ? node.scrollTop : 0);
    setCustomizeOpen(true);
    setTimeout(() => { if (cmLedgerMainRef.current) cmLedgerMainRef.current.scrollTop = 0; }, 0);
  };
  const backFromCustomize = () => {
    setCustomizeOpen(false);
    const top = ledgerRestoreScroll;
    setTimeout(() => { if (cmLedgerMainRef.current) cmLedgerMainRef.current.scrollTop = top; }, 0);
  };

  const hasBoss = !!cfg.tabs.boss;
  const tabs = [{ k:'roster', label:'Roster' }, { k:'mid', label:cfg.tabs.mid }];
  if (hasBoss) tabs.push({ k:'boss', label:cfg.tabs.boss });
  const curTab = (tab === 'boss' && !hasBoss) ? 'roster' : tab;

  return (
    <div className={inline ? 'cm-inline' : 'cm-overlay'}
         onMouseDown={inline ? undefined : (e) => { if (e.target === e.currentTarget) onClose(); }}>
      {!modalOnly && <div className="cm-panel" data-screen-label="Character Materials">

        {/* The "Character Materials" header box is removed on the game page (sections
            are switched from the left nav); the standalone panel keeps a plain title. */}
        {!(sections && onPageTab) && (
          <div className="cm-head">
            <span className="cm-dia"></span>
            <div className="cm-ttl"><div className="t">Character Materials</div></div>
            <button type="button" className="cm-x" title="Close" onClick={onClose} style={{ display:inline ? 'none' : undefined }}>{'✕'}</button>
          </div>
        )}

        {/* tabs (Roster / Talents / Boss) on top; search + tools sit below them */}
        <div className="cm-controls">
          <div className="cm-tabs">
            {tabs.map(t => (
              <button type="button" key={t.k} className={curTab === t.k ? 'on' : ''} onClick={() => { setTab(t.k); setSel(null); }}>{t.label}</button>
            ))}
          </div>
          <div className="cm-tools">
            <div className="cm-search">
              <span className="ic"></span>
              <input value={q} placeholder="Search Characters" spellCheck="false" onChange={(e) => setQ(e.target.value)} />
              {q !== '' && <button type="button" className="x" onClick={() => setQ('')}>{'\u2715'}</button>}
            </div>
            <div className="cm-tbtns">
              <button type="button" className={'cm-tool' + (showFilt || Object.keys(filt).length ? ' on' : '')}
                      title="Filter" onClick={() => { setHideMenu(false); setShowFilt(s => !s); }}><span className="i-filter"></span></button>
              <button type="button" className={'cm-tool' + (hideMenu || hideMode ? ' on warn' : '')}
                      title="Hidden character options" onClick={() => { setShowFilt(false); setHideMenu(s => !s); }}>
                <span className="i-eyeoff"></span>{hiddenCount > 0 && <span className="cm-tool-badge">{hiddenCount}</span>}
              </button>
              <button type="button" className={'cm-tool' + (showHidden ? ' on' : '')}
                      title="Show hidden characters" onClick={() => setShowHidden(s => !s)}><span className="i-eye"></span></button>
            </div>

            {showFilt && (
              <div className="cm-filter" onMouseDown={(e) => e.stopPropagation()}>
                {cfg.filters.map(f => (
                  <div key={f.key} className="cm-fsec">
                    <div className="cm-fhd">{f.label}</div>
                    <div className="cm-fopts">
                      <button type="button" className={'cm-fopt all' + (filt[f.key] === undefined ? ' on' : '')}
                              onClick={() => setFilt(p => { const n = { ...p }; delete n[f.key]; return n; })}>All</button>
                      {f.opts.map(o => {
                        const lbl = Array.isArray(o) ? o[0] : o;
                        const val = Array.isArray(o) ? o[1] : o;
                        return (
                          <button type="button" key={lbl} className={'cm-fopt' + (filt[f.key] === val ? ' on' : '')}
                                  onClick={() => setFilt(p => ({ ...p, [f.key]:val }))}>
                            {cmFilterGlyph(gk, f.key, lbl, val)}<span>{lbl}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {hideMenu && (
              <div className="cm-hide-menu" onMouseDown={(e) => e.stopPropagation()}>
                <div className="cm-hide-hd">
                  <b>Hidden Characters</b>
                  <span>{hiddenPrefs.sync ? 'Synced lists' : (activeHideScope === 'roster' ? 'Roster list' : 'Materials list')}</span>
                </div>
                <button type="button" className={hideMode ? 'on' : ''} onClick={() => setHideMode(v => !v)}>
                  <span className="box"></span>
                  <span><b>Hide mode</b><em>Click character icons to hide or restore them.</em></span>
                </button>
                <button type="button" className={showHidden ? 'on' : ''} onClick={() => setShowHidden(v => !v)}>
                  <span className="box"></span>
                  <span><b>Show hidden</b><em>Display hidden characters dimmed so they can be restored.</em></span>
                </button>
                <button type="button" className={hiddenPrefs.sync ? 'on' : ''} onClick={() => setHiddenSync(!hiddenPrefs.sync)}>
                  <span className="box"></span>
                  <span><b>Sync hidden lists</b><em>Use one hidden list for roster, talents, and boss views.</em></span>
                </button>
                <button type="button" className="clear" disabled={!hiddenCount} onClick={clearHiddenScope}>
                  Clear current hidden list
                </button>
              </div>
            )}
          </div>
        </div>

        {/* day selector (Genshin Talents only) */}
        {curTab === 'mid' && cfg.midMode === 'days' && (
          <div className="cm-days">
            {CM_DAYS.map((d, i) => (
              <button type="button" key={d} className={i === day ? 'on' : ''} onClick={() => setDay(i)}>{d}</button>
            ))}
          </div>
        )}

        <div className="cm-body">
          {/* ---------- ROSTER ---------- */}
          {curTab === 'roster' && (
            <React.Fragment>
              {recent.length > 0 && (
                <div className="cm-group">
                  <div className="cm-ghd" title="Characters from the 3 most recent patches"><span className="t">Recent</span></div>
                  <div className="cm-grid cm-grid-recent">{recent.map((c, i) => renderCell('recent', c, i))}</div>
                </div>
              )}
              {rarityGroups.map(g => g.list.length > 0 && (
                <div className="cm-group" key={g.r}>
                  <div className="cm-ghd"><span className="t">{g.label}</span></div>
                  <div className="cm-grid">{g.list.map((c, i) => renderCell('rarity-' + g.r, c, i))}</div>
                </div>
              ))}
              {roster.length === 0 && recent.length === 0 && <div className="cm-empty">No units match your filters.</div>}
            </React.Fragment>
          )}

          {/* ---------- MID (Talents / Traces / Chips / Skills) ---------- */}
          {curTab === 'mid' && (
            <React.Fragment>
              {cfg.talentDomains ? (
                <React.Fragment>
                  {giTalentBlocks.map((block, bi) => (
                    <div className={'cm-mgroup cm-domain' + (block.art ? ' has-bg' : '')} key={'domain-' + bi} style={cmBlockArtStyle(block.art)}>
                      <div className="cm-mgroup-hd">
                        <span className="t">{block.domain.name}</span>
                        <span className="sub">{qq ? 'search results' : day === 6 ? 'Sunday - all books' : CM_DAYS[day]}</span>
                      </div>
                      {block.rows.map((row) => (
                        <div className="cm-mrow cm-domain-row" key={row.key}>
                          <div className="cm-mtokens">
                            <CMToken
                              name={row.trio.name}
                              color="#e3b269"
                              glyph={'\u25A4'}
                              icon={row.trio.material?.icon}
                              rarity={row.trio.material?.rar}
                            />
                          </div>
                          <div className="cm-grid">{row.chars.map((c, i) => renderCell('talent-' + row.key, c, i))}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                  {giTalentBlocks.length === 0 && <div className="cm-empty">No talent-book matches for this day or filter.</div>}
                </React.Fragment>
              ) : cfg.midGroups.map((g, gi) => {
                const chars = g.chars.map(resolve).filter(show);
                if (cfg.midMode === 'days'){
                  if (chars.length === 0) return null;
                  return (
                    <div className="cm-mgroup" key={gi}>
                      <div className="cm-mgroup-hd"><span className="t">{g.region}</span></div>
                      <div className={'cm-mrow' + (cmBlockArtStyle(chars) ? ' has-bg' : '')} style={cmBlockArtStyle(chars)}>
                        <CMToken name={g.region} color="#e3b269" glyph={'\u25A4'} />
                        <div className="cm-grid">{chars.map((c, i) => renderCell('day-' + gi, c, i))}</div>
                      </div>
                    </div>
                  );
                }
                const mats = cmTokens(g.mats, g.region);
                if (chars.length === 0) return null;
                if (mats.length === 0) return null;
                return (
                  <div className="cm-mgroup" key={gi}>
                    <div className="cm-mgroup-hd">
                      <span className="t">{g.region}</span>
                      {g.label && <span className="sub">{g.label}</span>}
                    </div>
                    <div className={'cm-mrow' + (cmBlockArtStyle(chars) ? ' has-bg' : '')} style={cmBlockArtStyle(chars)}>
                      <div className="cm-mtokens">
                        {mats.map((m, mi) => (
                          <CMToken key={mi} name={m.n} color={tokenColor(g.region)} glyph={CM_GLYPHS[(gi + mi) % CM_GLYPHS.length]} icon={m.icon} sprite={m.sprite} rarity={m.rar} />
                        ))}
                      </div>
                      <div className="cm-grid">{chars.map((c, i) => renderCell('mid-' + gi, c, i))}</div>
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          )}

          {/* ---------- BOSS (Trounce / Echo / Hunt / Weekly) ---------- */}
          {curTab === 'boss' && hasBoss && (
            <React.Fragment>
              <div className="cm-bosshd"><span className="t">{cfg.boss.title}</span></div>
              {cfg.weeklyBosses ? (
                <React.Fragment>
                  <div className="cm-trounce-grid">
                  {giWeeklyBlocks.map((block, bi) => (
                    <div className={'cm-bgroup cm-weekly' + (block.art ? ' has-bg' : '')} key={'weekly-' + bi} style={cmBlockArtStyle(block.art)}>
                      <div className="cm-bgroup-hd">{block.boss.bossName}</div>
                      {block.drops.map((row) => (
                        <div className="cm-brow cm-weekly-row" key={row.key}>
                          <div className="cm-bmats">
                            <CMToken name={row.drop.name} color="#e3b269" glyph={'\u2726'} icon={row.drop.icon} sprite={row.drop.sprite} rarity={row.drop.rar} />
                          </div>
                          <div className="cm-grid">{row.chars.map((c, i) => renderCell('weekly-' + row.key, c, i))}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                  </div>
                  {giWeeklyBlocks.length === 0 && <div className="cm-empty">No weekly material matches for this filter.</div>}
                </React.Fragment>
              ) : cfg.bossGroups.map((g, gi) => {
                const chars = g.chars.map(resolve).filter(show);
                const mats = cmTokens(g.mats, g.title);
                const title = cmUsefulName(g.title) ? g.title : (mats[0] && mats[0].n) || cfg.boss.title;
                if (chars.length === 0) return null;
                if (mats.length === 0) return null;
                return (
                  <div className="cm-bgroup" key={gi}>
                    <div className="cm-bgroup-hd">{title}</div>
                    <div className="cm-brow">
                      <div className="cm-bmats">
                        {mats.map((m, mi) => <CMToken key={mi} name={m.n} color="#e3b269" glyph={CM_GLYPHS[(gi + mi) % CM_GLYPHS.length]} icon={m.icon} sprite={m.sprite} rarity={m.rar} />)}
                      </div>
                      <div className="cm-grid">{chars.map((c, i) => renderCell('boss-' + gi, c, i))}</div>
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          )}
        </div>
      </div>}

      {sel && (() => {
        const pop = (
        <div className={'cm-pop-wrap' + (inline ? ' float' : '')} onMouseDown={(e) => { if (e.target === e.currentTarget) closePop(); }}>
          <div className="cm-pop ledger" data-screen-label="Material popup" ref={cmPopRef}
               role="dialog" aria-modal="true" aria-label={(sel.n || 'Character') + ' materials'}
               style={{ '--el':CM_ELEM[view.el] || '#b7aaff' }}>
            <div className="cm-pop-ambient"></div>
            <div className="cm-pop-scrim"></div>
            <button type="button" className="cm-x sm cm-pop-close" title="Close" aria-label="Close"
                    ref={cmCloseBtnRef} onClick={closePop}>{'\u2715'}</button>

            <div className="cm-pop-layout">
              <div className="cm-pop-main cm-ledger-main" ref={cmLedgerMainRef}>
                <div className="cm-ledger-top">
                  <div className="cm-ledger-title">
                    <div className="cm-pop-name-row">
                      <span className="cm-pop-name-wrap">
                        {(view.icon || view.circle) && <img className="cm-name-circle" src={view.icon || view.circle} alt="" draggable="false"
                          style={view.iconPosition ? { objectPosition:view.iconPosition } : undefined} />}
                        <span className="cm-pop-name">{sel.n}</span>
                        {sel.__betaNew && <span className="cm-beta-tag pop" title="Beta (latest) data — upcoming and subject to change">Beta</span>}
                      </span>
                      {metaChips.length > 0 && (
                        <span className="cm-pop-meta-inline">
                          {metaChips.map((chip) => (
                            <span key={chip.key + chip.value} className="cm-meta-inline" title={`${chip.label}: ${chip.value}`} aria-label={`${chip.label}: ${chip.value}`}>
                              <CMMetaIcon gameKey={gk} chip={chip} />
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                    {(releaseText || voiceRows.length > 0) && (
                      <div className="cm-pop-extra-meta">
                        {releaseText && <span><b>Release</b>{releaseText}</span>}
                        {voiceRows.length > 0 && (
                          <span className="voice"><b>VA</b>{voiceRows.map((row) => (
                            <em key={row.key}>
                              {row.label}: {row.url
                                ? <a href={row.url} target="_blank" rel="noopener noreferrer">{row.value}</a>
                                : row.value}
                            </em>
                          ))}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {gk === 'gi' && view.req?.talentStages?.length > 0 && (
                    <div className="cm-presets cm-presets-ledger">
                      {CM_GI_PRESETS.map((preset) => (
                        <button
                          type="button"
                          key={preset.key}
                          className={activePreset.key === preset.key ? 'on' : ''}
                          onClick={() => { setGiPreset(preset.key); setGiTargets(preset.targets.slice()); }}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* G36: HSR "Max" toggle sits top-right, same slot/format as the GI presets */}
                  {gk === 'hsr' && view.req?.talentStages?.some?.((s) => s.length) && (
                    <div className="cm-presets cm-presets-ledger cm-hsr-max-row">
                      <button type="button" className={'cm-trace-max' + (hsrMax ? ' on' : '')} aria-pressed={hsrMax}
                              title="Max out all traces" onClick={() => { setHsrTargets(CM_TALENT_CFG.hsr.max.slice()); setHsrMax(true); }}>Max</button>
                    </div>
                  )}
                </div>

                {customizeOpen ? (
                  <div className="cm-customize-view">
                    <button type="button" className="cm-custom-back" onClick={backFromCustomize}>
                      <span>{'\u2039'}</span><b>Back to Materials</b>
                    </button>
                    <CharacterImageControls
                      gameKey={gk}
                      base={sel}
                      view={view}
                      prefs={characterImagePrefs}
                      onPrefs={setCharacterImagePrefs}
                    />
                  </div>
                ) : (
                  <React.Fragment>
                {(formOptions.length > 1 || genderOptions.length > 1) && (
                  <div className="cm-form-switches compact">
                    {formOptions.length > 1 && (
                      <div className="cm-form-row">
                        <span>Form</span>
                        <div>
                          {formOptions.map((form) => (
                            <button
                              type="button"
                              key={form.key}
                              className={(view.variantKey || formOptions[0].key) === form.key ? 'on' : ''}
                              onClick={() => setActiveVariant(form.key)}
                            >
                              {form.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {genderOptions.length > 1 && (
                      <div className="cm-form-row">
                        <span>Artwork</span>
                        <div>
                          {genderOptions.map((gender) => (
                            <button
                              type="button"
                              key={gender.key}
                              className={(view.gender || genderOptions[0].key) === gender.key ? 'on' : ''}
                              onClick={() => setActiveGender(gender.key)}
                            >
                              {gender.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="cm-ledger-rows">
                  {selArt && <div className={'cm-ledger-art' + specialArtClass} aria-hidden="true"><img src={selArt} alt="" draggable="false" /></div>}
                  {hasAscData && (
                    <div className="cm-ledger-row">
                      <div className="cm-ledger-label"><b>ASCENSION</b>
                        {gk === 'gi'
                          ? <label className="cm-asc-level" title="Type a target level (1-90)"><span className="lv">Lv</span>
                              <input
                                type="number" min="1" max="90" inputMode="numeric"
                                aria-label="Ascension target level"
                                value={giAscLevel}
                                onChange={(e) => setGiAscLevel(Math.max(1, Math.min(90, Math.round(Number(e.target.value)) || 1)))}
                                onFocus={(e) => e.target.select()}
                              />
                            </label>
                          : <span>Lv.{CM_GAME_MAX_LEVEL[gk] || 90}</span>}
                      </div>
                      <div className="cm-mats cm-ledger-mats">{ascReq.length > 0
                        ? ascReq.map((m, i) => <MatTile key={i} m={m} />)
                        : <div className="cm-total-empty">Nothing required at this level.</div>}</div>
                    </div>
                  )}
                  {hasTalentData && (
                    <div className="cm-ledger-row">
                      <div className="cm-ledger-label">
                        <b>{String(cfg.tabs.mid || 'Materials').toUpperCase()}</b>
                        {(() => {
                          const tcfg = CM_TALENT_CFG[gk];
                          const hasInputs = tcfg && view?.req?.talentStages?.some?.((s) => s.length);
                          if (!hasInputs) {
                            // G37: games without per-level data still show their skill icons
                            // (read-only, leveled to max) so the format matches GI/HSR.
                            const skillIcons = (view?.skillIcons || []).filter(Boolean);
                            if (skillIcons.length) {
                              return (
                                <div className="cm-skill-icons" title="Skills (leveled to max)">
                                  {skillIcons.map((src, i) => (
                                    <span className="cm-skill-icon" key={i}><img src={src} alt="" draggable="false" /></span>
                                  ))}
                                  <span className="cm-talent-summary">Max</span>
                                </div>
                              );
                            }
                            return gk !== 'gi' ? <span className="cm-talent-summary">all to max</span> : null;
                          }
                          const values = gk === 'gi' ? giTargets : hsrTalentTargets;
                          const setTalent = (index, raw) => {
                            const max = tcfg.max[index] || 10;
                            const v = Math.max(1, Math.min(max, Math.round(Number(raw)) || 1));
                            if (gk === 'gi') { setGiTalentTarget(index, v); return; }
                            const next = (hsrMax ? CM_TALENT_CFG.hsr.max : hsrTargets).slice();
                            next[index] = v;
                            setHsrTargets(next);
                            setHsrMax(false);
                          };
                          return (
                            <React.Fragment>
                              <div className={'cm-talent-triplet cols' + values.length} aria-label="Talent level targets">
                                {values.map((value, index) => {
                                  const icon = view?.skillIcons?.[index];
                                  const label = tcfg.labels[index];
                                  const max = tcfg.max[index] || 10;
                                  return (
                                    <label className="cm-talent-control" key={index} title={`${label}: type a target level (1-${max})`}>
                                      <span className="cm-talent-icon">
                                        {icon ? <img src={icon} alt="" draggable="false" /> : <em>{tcfg.short[index]}</em>}
                                      </span>
                                      <input
                                        type="number" min="1" max={max} inputMode="numeric"
                                        className="cm-talent-num"
                                        aria-label={`${label} target level`}
                                        value={value}
                                        onChange={(e) => setTalent(index, e.target.value)}
                                        onFocus={(e) => e.target.select()}
                                      />
                                    </label>
                                  );
                                })}
                              </div>
                            </React.Fragment>
                          );
                        })()}
                      </div>
                      <div className="cm-mats cm-ledger-mats">{talentReq.length > 0
                        ? talentReq.map((m, i) => <MatTile key={i} m={m} />)
                        : <div className="cm-total-empty">Nothing required at these levels.</div>}</div>
                    </div>
                  )}
                  {(weaponReq.length > 0 || weaponOptions.length > 0) && (
                    <div className="cm-ledger-row weapon">
                      <div className="cm-ledger-label cm-weapon-label">
                        {activeWeapon?.icon && <img className="cm-weapon-watermark" src={activeWeapon.icon} alt="" draggable="false" />}
                        <b>{weaponLabel}</b>
                        <div className="cm-weapon-pickrow">
                          <button
                            type="button"
                            className="cm-weapon-pick"
                            aria-haspopup="listbox"
                            aria-expanded={weaponPickerOpen}
                            disabled={!weaponOptions.length}
                            onClick={() => weaponOptions.length && setWeaponPickerOpen((v) => !v)}
                          >
                            <span>{activeWeapon?.name || 'Pick a weapon'}</span>
                            <i>{weaponOptions.length ? '\u25BE' : ''}</i>
                          </button>
                          {isSignatureGuess && (
                            <span className="cm-sig-note" tabIndex={0} role="note" aria-label="About this signature pick">
                              <span className="cm-sig-mark" aria-hidden="true">{'\u24D8'}</span>
                              <span className="cm-sig-tip" role="tooltip">
                                <b>Signature</b>
                                <em>Signature Weapon is an automated educated guess and could be incorrect. Please double-check other sources before making decisions.</em>
                              </span>
                            </span>
                          )}
                        </div>
                        {weaponPickerOpen && weaponOptions.length > 0 && (
                          <div className="cm-weapon-menu" role="listbox" aria-label={`Pick ${weaponLabel.toLowerCase()}`} onMouseDown={(e) => e.stopPropagation()}>
                            <input
                              type="search"
                              value={weaponSearch}
                              placeholder={`Search ${weaponLabel.toLowerCase()}`}
                              spellCheck="false"
                              onChange={(e) => setWeaponSearch(e.target.value)}
                            />
                            <div className="cm-weapon-options">
                              {signatureWeapon && (
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={!pickedWeaponId}
                                  className={!pickedWeaponId ? 'on' : ''}
                                  title="Signature is an automated educated guess and could be incorrect. Please double-check other sources before making decisions."
                                  onClick={() => pickWeapon(null)}
                                >
                                  <span className="sig">{'\u2605'}</span>
                                  <span>Signature ({signatureWeapon.name})</span>
                                </button>
                              )}
                              {filteredWeapons.map((weapon) => (
                                <button
                                  type="button"
                                  key={weapon.id}
                                  role="option"
                                  aria-selected={String(activeWeapon?.id) === String(weapon.id)}
                                  className={String(activeWeapon?.id) === String(weapon.id) ? 'on' : ''}
                                  onClick={() => pickWeapon(weapon.id)}
                                >
                                  {weapon.icon ? <img src={weapon.icon} alt="" draggable="false" /> : <span className="sig">{weapon.rarity || ''}</span>}
                                  <span>{weapon.name}</span>
                                </button>
                              ))}
                              {filteredWeapons.length === 0 && <div className="cm-weapon-empty">No matches.</div>}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="cm-mats cm-ledger-mats">
                        {weaponReq.length > 0
                          ? weaponReq.map((m, i) => <MatTile key={i} m={m} />)
                          : <div className="cm-total-empty">{activeWeapon ? 'No material data for this weapon yet.' : 'Select a weapon to see materials.'}</div>}
                      </div>
                    </div>
                  )}
                  {hasAnyLedgerReq && (
                    <div className="cm-ledger-row total">
                      <div className="cm-ledger-label">
                        <b>TOTAL</b>
                        <div className="cm-total-checks">
                          {ascReq.length > 0 && (
                            <button type="button" className={ledgerInclude.ascension ? 'on' : ''} aria-pressed={ledgerInclude.ascension} onClick={() => toggleLedger('ascension')}>
                              <span className="box"></span><span>Ascension</span>
                            </button>
                          )}
                          {talentReq.length > 0 && (
                            <button type="button" className={ledgerInclude.talents ? 'on' : ''} aria-pressed={ledgerInclude.talents} onClick={() => toggleLedger('talents')}>
                              <span className="box"></span><span>{cfg.tabs.mid}</span>
                            </button>
                          )}
                          {weaponReq.length > 0 && (
                            <button type="button" className={ledgerInclude.weapon ? 'on' : ''} aria-pressed={ledgerInclude.weapon} onClick={() => toggleLedger('weapon')}>
                              <span className="box"></span><span>{weaponLabel.replace('-', '-').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="cm-mats cm-ledger-mats">
                        {totalReq.length > 0
                          ? totalReq.map((m, i) => <MatTile key={i} m={m} />)
                          : <div className="cm-total-empty">Select at least one section.</div>}
                      </div>
                    </div>
                  )}
                  {!hasAnyLedgerReq && (
                    <div className="cm-empty">No material data available for this unit yet.</div>
                  )}
                  <div className="cm-ledger-customize-entry">
                    <button type="button" onClick={openCustomize}>
                      <span>Customize Visuals</span>
                      <b>Icon / Background / Local Upload</b>
                    </button>
                  </div>
                </div>
                  </React.Fragment>
                )}
              </div>
            </div>
          </div>
        </div>
        );
        return inline && ReactDOM.createPortal ? ReactDOM.createPortal(pop, document.body) : pop;
      })()}
    </div>
  );
}

Object.assign(window, { CharMaterials });
