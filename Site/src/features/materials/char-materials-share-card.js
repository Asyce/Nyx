const NYX_MATERIALS_CARD_WIDTH = 2000;
const NYX_MATERIALS_CARD_MARGIN = 64;
const NYX_MATERIALS_CARD_LABEL_WIDTH = 420;
const NYX_MATERIALS_CARD_HEADER_HEIGHT = 224;
const NYX_MATERIALS_CARD_TILE_WIDTH = 150;
const NYX_MATERIALS_CARD_TILE_HEIGHT = 187;
const NYX_MATERIALS_CARD_TILE_STEP_X = 174;
const NYX_MATERIALS_CARD_TILE_STEP_Y = 246;
const NYX_MATERIALS_CARD_TILES_PER_LINE = 8;
const NYX_MATERIALS_CARD_MAX_LEVEL = { gi:90, hsr:80, zzz:60, wuwa:90, ae:80 };
const NYX_MATERIALS_CARD_ROUTES = { gi:'genshin', hsr:'hsr', zzz:'zzz', wuwa:'wuwa', ae:'endfield' };

// Max-level EXP packs. Nanoka supplies the local icons and GI/ZZZ/WuWa curves;
// missing totals are fixed from the HSR, WuWa, and Endfield wiki leveling tables.
const NYX_MATERIALS_CARD_LEVELING = {
  gi:{
    character:{ cost:1673400, items:[
      { id:'104001', name:"Wanderer's Advice", qty:12, rar:2, kind:'exp', icon:'../../Database/GameData/gi/assets/items/UI_ItemIcon_104001.webp' },
      { id:'104002', name:"Adventurer's Experience", qty:11, rar:3, kind:'exp', icon:'../../Database/GameData/gi/assets/items/UI_ItemIcon_104002.webp' },
      { id:'104003', name:"Hero's Wit", qty:415, rar:4, kind:'exp', icon:'../../Database/GameData/gi/assets/items/UI_ItemIcon_104003.webp' },
    ] },
    weapon:{
      3:{ cost:398840, items:[
        { id:'104011', name:'Enhancement Ore', qty:1, rar:1, kind:'exp', icon:'../../Database/GameData/gi/assets/items/UI_ItemIcon_104011.webp' },
        { id:'104012', name:'Fine Enhancement Ore', qty:4, rar:2, kind:'exp', icon:'../../Database/GameData/gi/assets/items/UI_ItemIcon_104012.webp' },
        { id:'104013', name:'Mystic Enhancement Ore', qty:398, rar:3, kind:'exp', icon:'../../Database/GameData/gi/assets/items/UI_ItemIcon_104013.webp' },
      ] },
      4:{ cost:604280, items:[
        { id:'104011', name:'Enhancement Ore', qty:2, rar:1, kind:'exp', icon:'../../Database/GameData/gi/assets/items/UI_ItemIcon_104011.webp' },
        { id:'104012', name:'Fine Enhancement Ore', qty:1, rar:2, kind:'exp', icon:'../../Database/GameData/gi/assets/items/UI_ItemIcon_104012.webp' },
        { id:'104013', name:'Mystic Enhancement Ore', qty:604, rar:3, kind:'exp', icon:'../../Database/GameData/gi/assets/items/UI_ItemIcon_104013.webp' },
      ] },
      5:{ cost:906480, items:[
        { id:'104011', name:'Enhancement Ore', qty:2, rar:1, kind:'exp', icon:'../../Database/GameData/gi/assets/items/UI_ItemIcon_104011.webp' },
        { id:'104012', name:'Fine Enhancement Ore', qty:2, rar:2, kind:'exp', icon:'../../Database/GameData/gi/assets/items/UI_ItemIcon_104012.webp' },
        { id:'104013', name:'Mystic Enhancement Ore', qty:906, rar:3, kind:'exp', icon:'../../Database/GameData/gi/assets/items/UI_ItemIcon_104013.webp' },
      ] },
    },
  },
  hsr:{
    character:{ cost:580100, items:[
      { id:'211', name:'Travel Encounters', qty:16, rar:2, kind:'exp', icon:'../../Database/GameData/hsr/assets/items/211.webp' },
      { id:'212', name:'Adventure Log', qty:9, rar:3, kind:'exp', icon:'../../Database/GameData/hsr/assets/items/212.webp' },
      { id:'213', name:"Traveler's Guide", qty:287, rar:4, kind:'exp', icon:'../../Database/GameData/hsr/assets/items/213.webp' },
    ] },
    weapon:{
      3:{ cost:299750, items:[
        { id:'221', name:'Sparse Aether', qty:7, rar:2, kind:'exp', icon:'../../Database/GameData/hsr/assets/items/221.webp' },
        { id:'222', name:'Condensed Aether', qty:7, rar:3, kind:'exp', icon:'../../Database/GameData/hsr/assets/items/222.webp' },
        { id:'223', name:'Refined Aether', qty:97, rar:4, kind:'exp', icon:'../../Database/GameData/hsr/assets/items/223.webp' },
      ] },
      4:{ cost:399250, items:[
        { id:'221', name:'Sparse Aether', qty:9, rar:2, kind:'exp', icon:'../../Database/GameData/hsr/assets/items/221.webp' },
        { id:'222', name:'Condensed Aether', qty:7, rar:3, kind:'exp', icon:'../../Database/GameData/hsr/assets/items/222.webp' },
        { id:'223', name:'Refined Aether', qty:130, rar:4, kind:'exp', icon:'../../Database/GameData/hsr/assets/items/223.webp' },
      ] },
      5:{ cost:498500, items:[
        { id:'221', name:'Sparse Aether', qty:14, rar:2, kind:'exp', icon:'../../Database/GameData/hsr/assets/items/221.webp' },
        { id:'222', name:'Condensed Aether', qty:9, rar:3, kind:'exp', icon:'../../Database/GameData/hsr/assets/items/222.webp' },
        { id:'223', name:'Refined Aether', qty:162, rar:4, kind:'exp', icon:'../../Database/GameData/hsr/assets/items/223.webp' },
      ] },
    },
  },
  zzz:{
    character:{ cost:0, items:[
      { id:'300003', name:'Senior Investigator Log', qty:300, rar:3, kind:'exp', icon:'../../Database/GameData/zzz/assets/items/RoleExp03.webp' },
    ] },
    weapon:{
      3:{ cost:0, items:[{ id:'301003', name:'W-Engine Energy Module', qty:160, rar:3, kind:'exp', icon:'../../Database/GameData/zzz/assets/items/WeaponExp03.webp' }] },
      4:{ cost:0, items:[{ id:'301003', name:'W-Engine Energy Module', qty:200, rar:3, kind:'exp', icon:'../../Database/GameData/zzz/assets/items/WeaponExp03.webp' }] },
    },
  },
  wuwa:{
    character:{ cost:853300, items:[
      { id:'43010001', name:'Basic Resonance Potion', qty:2, rar:2, kind:'exp', icon:'../../Database/GameData/ww/assets/items/UIResources/Common/Image/IconRup/T_IconRup_exp_1_UI.webp' },
      { id:'43010003', name:'Advanced Resonance Potion', qty:2, rar:4, kind:'exp', icon:'../../Database/GameData/ww/assets/items/UIResources/Common/Image/IconRup/T_IconRup_exp_3_UI.webp' },
      { id:'43010004', name:'Premium Resonance Potion', qty:121, rar:5, kind:'exp', icon:'../../Database/GameData/ww/assets/items/UIResources/Common/Image/IconRup/T_IconRup_exp_4_UI.webp' },
    ] },
    weapon:{
      3:{ cost:549600, items:[
        { id:'43020002', name:'Medium Energy Core', qty:2, rar:3, kind:'exp', icon:'../../Database/GameData/ww/assets/items/UIResources/Common/Image/IconWup/T_IconWup_Exp_2_UI.webp' },
        { id:'43020003', name:'Advanced Energy Core', qty:1, rar:4, kind:'exp', icon:'../../Database/GameData/ww/assets/items/UIResources/Common/Image/IconWup/T_IconWup_Exp_3_UI.webp' },
        { id:'43020004', name:'Premium Energy Core', qty:68, rar:5, kind:'exp', icon:'../../Database/GameData/ww/assets/items/UIResources/Common/Image/IconWup/T_IconWup_Exp_4_UI.webp' },
      ] },
      4:{ cost:916000, items:[
        { id:'43020001', name:'Basic Energy Core', qty:2, rar:2, kind:'exp', icon:'../../Database/GameData/ww/assets/items/UIResources/Common/Image/IconWup/T_IconWup_Exp_1_UI.webp' },
        { id:'43020003', name:'Advanced Energy Core', qty:1, rar:4, kind:'exp', icon:'../../Database/GameData/ww/assets/items/UIResources/Common/Image/IconWup/T_IconWup_Exp_3_UI.webp' },
        { id:'43020004', name:'Premium Energy Core', qty:114, rar:5, kind:'exp', icon:'../../Database/GameData/ww/assets/items/UIResources/Common/Image/IconWup/T_IconWup_Exp_4_UI.webp' },
      ] },
      5:{ cost:1077200, items:[
        { id:'43020001', name:'Basic Energy Core', qty:2, rar:2, kind:'exp', icon:'../../Database/GameData/ww/assets/items/UIResources/Common/Image/IconWup/T_IconWup_Exp_1_UI.webp' },
        { id:'43020002', name:'Medium Energy Core', qty:1, rar:3, kind:'exp', icon:'../../Database/GameData/ww/assets/items/UIResources/Common/Image/IconWup/T_IconWup_Exp_2_UI.webp' },
        { id:'43020003', name:'Advanced Energy Core', qty:1, rar:4, kind:'exp', icon:'../../Database/GameData/ww/assets/items/UIResources/Common/Image/IconWup/T_IconWup_Exp_3_UI.webp' },
        { id:'43020004', name:'Premium Energy Core', qty:134, rar:5, kind:'exp', icon:'../../Database/GameData/ww/assets/items/UIResources/Common/Image/IconWup/T_IconWup_Exp_4_UI.webp' },
      ] },
    },
  },
  ae:{
    character:{ cost:0, items:[
      { id:'ae:Elementary_Combat_Record', name:'Elementary Combat Record', qty:1, rar:1, kind:'exp', icon:'../../Database/EndfieldWiki/endfield/material-icons/Elementary_Combat_Record.png' },
      { id:'ae:Intermediate_Combat_Record', name:'Intermediate Combat Record', qty:7, rar:2, kind:'exp', icon:'../../Database/EndfieldWiki/endfield/material-icons/Intermediate_Combat_Record.png' },
      { id:'ae:Advanced_Combat_Record', name:'Advanced Combat Record', qty:74, rar:3, kind:'exp', icon:'../../Database/EndfieldWiki/endfield/material-icons/Advanced_Combat_Record.png' },
      { id:'ae:Elementary_Cognitive_Carrier', name:'Elementary Cognitive Carrier', qty:6, rar:4, kind:'exp', icon:'../../Database/EndfieldWiki/endfield/material-icons/Elementary_Cognitive_Carrier.png' },
      { id:'ae:Advanced_Cognitive_Carrier', name:'Advanced Cognitive Carrier', qty:46, rar:5, kind:'exp', icon:'../../Database/EndfieldWiki/endfield/material-icons/Advanced_Cognitive_Carrier.png' },
      { id:'ae:T-Creds', name:'T-Creds', qty:146440, rar:4, kind:'currency', icon:'../../Database/EndfieldWiki/endfield/assets/items/t-creds.png' },
    ] },
    weapon:{ default:{ cost:0, items:[
      { id:'ae:Arms_Inspector', name:'Arms Inspector', qty:4, rar:2, kind:'exp', icon:'../../Database/EndfieldWiki/endfield/material-icons/Arms_Inspector.png' },
      { id:'ae:Arms_INSP_Kit', name:'Arms INSP Kit', qty:3, rar:3, kind:'exp', icon:'../../Database/EndfieldWiki/endfield/material-icons/Arms_INSP_Kit.png' },
      { id:'ae:Arms_INSP_Set', name:'Arms INSP Set', qty:120, rar:4, kind:'exp', icon:'../../Database/EndfieldWiki/endfield/material-icons/Arms_INSP_Set.png' },
      { id:'ae:T-Creds', name:'T-Creds', qty:123850, rar:4, kind:'currency', icon:'../../Database/EndfieldWiki/endfield/assets/items/t-creds.png' },
    ] } },
  },
};

function nyxMaterialsCardQueryValue(value){
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function nyxParseMaterialsCardSearch(search){
  const query = new URLSearchParams(String(search || '').replace(/^[^?]*\?/, ''));
  if (query.get('card') !== '1') return null;
  return {
    weaponId:nyxMaterialsCardQueryValue(query.get('weapon')),
    variantKey:nyxMaterialsCardQueryValue(query.get('form')),
    gender:nyxMaterialsCardQueryValue(query.get('gender')),
    channel:query.get('channel') === 'beta' ? 'beta' : 'live',
  };
}

function nyxMaterialsCardUrl({ origin, gameKey, characterName, weaponId, variantKey, gender, channel }){
  const segment = NYX_MATERIALS_CARD_ROUTES[gameKey];
  const slug = cmRouteSlug(characterName);
  if (!segment || !slug) throw new Error('This character cannot be shared.');
  const base = new URL(origin || location.origin);
  const url = new URL('/' + segment + '/characters/' + slug, base.origin);
  url.searchParams.append('card', '1');
  const weapon = nyxMaterialsCardQueryValue(weaponId);
  const form = nyxMaterialsCardQueryValue(variantKey);
  const artwork = nyxMaterialsCardQueryValue(gender);
  if (weapon) url.searchParams.append('weapon', weapon);
  if (form) url.searchParams.append('form', form);
  if (artwork) url.searchParams.append('gender', artwork);
  url.searchParams.append('channel', channel === 'beta' ? 'beta' : 'live');
  return url.href;
}

function nyxMaterialsCardFilename({ gameKey, view }){
  const slug = cmRouteSlug(view?.rawName || view?.baseName || view?.n || 'character') || 'character';
  return 'pengo-' + (NYX_MATERIALS_CARD_ROUTES[gameKey] || gameKey || 'game') + '-' + slug + '-materials.png';
}

function nyxBuildMaterialsCardModel({ gameKey, view, cfg, activeWeapon, midLabel }){
  if (!NYX_MATERIALS_CARD_MAX_LEVEL[gameKey] || !view || !cfg) {
    throw new Error('Character material data is unavailable.');
  }
  const targets = CM_TALENT_CFG[gameKey]?.max?.slice?.() || null;
  const req = cmRequirements(gameKey, view, targets ? { targets } : undefined);
  if (!req) throw new Error('Character material data is unavailable.');

  const leveling = NYX_MATERIALS_CARD_LEVELING[gameKey] || {};
  const characterLeveling = leveling.character || {};
  const weaponLeveling = activeWeapon
    ? (leveling.weapon?.[Number(activeWeapon.rarity)] || leveling.weapon?.default || {})
    : {};
  const ascensionItems = gameKey === 'ae' && view.req?.promotionStages?.length
    ? view.req.promotionStages.slice(0, 3).flatMap((stage) => stage.items || [])
    : req.ascension || [];
  const weaponItems = gameKey === 'ae' && activeWeapon?.tuningStages?.length
    ? activeWeapon.tuningStages.slice(0, 3).flatMap((stage) => stage.items || [])
    : activeWeapon?.items || [];
  const ascension = cmCombineReqItems(
    cmCurrencyMat(cfg, Number(req.ascCost || 0) + Number(characterLeveling.cost || 0)),
    ascensionItems,
    characterLeveling.items || [],
  );
  const talents = cmReqItems([cmCurrencyMat(cfg, req.talentCost), ...(req.talents || [])]);
  const weaponCost = activeWeapon
    ? Number(activeWeapon.cost ?? req.weaponCost ?? 0) + Number(weaponLeveling.cost || 0)
    : 0;
  const weapon = activeWeapon
    ? cmCombineReqItems(cmCurrencyMat(cfg, weaponCost), weaponItems, weaponLeveling.items || [])
    : [];
  const total = cmCombineReqItems(ascension, talents, weapon);
  if (!total.length) throw new Error('No maxed material requirements are available for this character.');

  const meta = cmMetaChips(gameKey, view).map((chip) => ({
    ...chip,
    icon:cmMetaIconSrc(gameKey, chip.key, chip.value),
  })).filter((chip) => chip.icon);
  const rows = [
    { key:'ascension', title:'ASCENSION', items:ascension },
    { key:'talents', title:String(midLabel || 'Talents').toUpperCase(), items:talents },
  ];
  if (activeWeapon) rows.push({
    key:'weapon',
    title:cmWeaponRowLabel(gameKey),
    items:weapon,
    weaponName:activeWeapon.name || view.signatureWeaponName || 'Weapon',
  });
  rows.push({ key:'total', title:'TOTAL', items:total });

  return {
    gameKey,
    name:view.n || view.rawName || 'Character',
    title:view.title || view.subtitle || '',
    maxLevel:NYX_MATERIALS_CARD_MAX_LEVEL[gameKey],
    targets,
    midLabel:midLabel || 'Talents',
    accent:CM_ELEM[view.el] || '#9f85ff',
    art:view.originalArt || view.art || view.card || null,
    icon:view.originalIcon || view.icon || view.circle || null,
    skillIcons:(view.skillIcons || []).filter(Boolean),
    meta,
    weaponIcon:activeWeapon?.icon || activeWeapon?.art || null,
    rows,
  };
}

function nyxMaterialsCardRowHeight(row){
  const lines = Math.max(1, Math.ceil((row.items || []).length / NYX_MATERIALS_CARD_TILES_PER_LINE));
  return 44 + lines * NYX_MATERIALS_CARD_TILE_STEP_Y;
}

function nyxMaterialsCardHeight(model){
  return NYX_MATERIALS_CARD_MARGIN * 2
    + NYX_MATERIALS_CARD_HEADER_HEIGHT
    + model.rows.reduce((sum, row) => sum + nyxMaterialsCardRowHeight(row), 0);
}

function nyxMaterialsCardRoundedRect(ctx, x, y, width, height, radius){
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function nyxMaterialsCardFitFont(ctx, text, maxWidth, start, minimum, family){
  let size = start;
  while (size > minimum) {
    ctx.font = '400 ' + size + 'px ' + family;
    if (ctx.measureText(String(text || '')).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

function nyxMaterialsCardWrapText(ctx, text, maxWidth, maxLines){
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (!line || ctx.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines - 1) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  const used = lines.join(' ').split(/\s+/).filter(Boolean).length;
  if (used < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = (last || '') + '…';
  }
  return lines.map((value) => {
    if (ctx.measureText(value).width <= maxWidth) return value;
    let clipped = value;
    while (clipped && ctx.measureText(clipped + '…').width > maxWidth) clipped = clipped.slice(0, -1);
    return (clipped || '') + '…';
  });
}

function nyxMaterialsCardDrawFittedImage(ctx, img, dx, dy, dw, dh, source){
  if (!img) return false;
  const sx = source?.x || 0;
  const sy = source?.y || 0;
  const sw = source?.w || img.naturalWidth || img.width;
  const sh = source?.h || img.naturalHeight || img.height;
  if (!sw || !sh) return false;
  const scale = Math.min(dw / sw, dh / sh);
  const width = sw * scale;
  const height = sh * scale;
  ctx.drawImage(img, sx, sy, sw, sh, dx + (dw - width) / 2, dy + (dh - height) / 2, width, height);
  return true;
}

function nyxMaterialsCardDrawCover(ctx, img, x, y, width, height){
  if (!img) return;
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  if (!sw || !sh) return;
  const scale = Math.max(width / sw, height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(img, x + (width - dw) / 2, y + (height - dh) / 2, dw, dh);
}

function nyxMaterialsCardFrameColors(tier){
  const def = CM_ITEM_FRAME_DEFS[Math.max(0, Math.min(6, Number(tier) || 0)) === 0
    ? 'white'
    : ['white', 'grey', 'green', 'blue', 'purple', 'gold', 'red'][Math.max(0, Math.min(6, Number(tier) || 0))]];
  const color = (lightness, chroma) => cmFrameOklch(lightness, chroma === undefined ? def.c : chroma, def.h);
  const iridescent = !!def.irid;
  const top = iridescent ? cmFrameOklch(0.935, 0.03, 350) : color(def.L[0]);
  const mid = iridescent ? cmFrameOklch(0.90, 0.036, 295) : color(def.L[1]);
  const bottom = iridescent ? cmFrameOklch(0.845, 0.034, 195) : color(def.L[2]);
  const base = iridescent ? cmFrameOklch(0.89, 0.032, 265) : mid;
  return {
    top,
    mid,
    bottom,
    base,
    plate:cmFrameMix(base, '#1b1f27', 0.88),
    line:iridescent ? cmFrameOklch(0.75, 0.038, 305) : color(0.74, Math.min(def.c, 0.085)),
  };
}

function nyxMaterialsCardGlyph(kind){
  return kind === 'currency' ? '\u25CE' : kind === 'crown' ? '\u265B' : kind === 'gem' ? '\u25C8'
    : kind === 'book' ? '\u25A4' : kind === 'weekly' ? '\u2726' : kind === 'boss' ? '\u2756'
      : kind === 'specialty' ? '\u273F' : kind === 'weapon' ? '\u25A6' : '\u25C9';
}

function nyxMaterialsCardResolveUrl(source){
  if (!source) return null;
  try { return new URL(String(source), document.baseURI).href; } catch (error) { return null; }
}

async function nyxMaterialsCardLoadImage(source){
  const url = nyxMaterialsCardResolveUrl(source);
  if (!url) return null;
  try {
    const image = new Image();
    if (new URL(url).origin !== new URL(document.baseURI).origin) image.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    if (image.decode) {
      try { await image.decode(); } catch (error) {}
    }
    return image;
  } catch (error) {
    return null;
  }
}

async function nyxMaterialsCardLoadAssets(model){
  const sources = new Set(['/assets/icon/nyx_logo.png', model.art, model.icon, model.weaponIcon]);
  model.meta.forEach((chip) => sources.add(chip.icon));
  model.skillIcons.forEach((source) => sources.add(source));
  model.rows.forEach((row) => row.items.forEach((item) => {
    sources.add(item.sprite);
    sources.add(item.icon || item.art);
  }));
  const entries = [...sources].filter(Boolean);
  const loaded = await Promise.all(entries.map(async (source) => [source, await nyxMaterialsCardLoadImage(source)]));
  return new Map(loaded);
}

async function nyxMaterialsCardWaitForFonts(){
  if (!document.fonts?.load) return;
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, 3000); });
  try {
    await Promise.race([
      Promise.allSettled([
        document.fonts.load('400 84px "GI"'),
        document.fonts.load('400 34px "HSR"'),
      ]),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function nyxMaterialsCardCreateCanvas(width, height){
  if (typeof OffscreenCanvas === 'function' && OffscreenCanvas.prototype?.convertToBlob) {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function nyxMaterialsCardDrawHeader(ctx, model, assets){
  const margin = NYX_MATERIALS_CARD_MARGIN;
  const icon = assets.get(model.icon);
  const iconSize = 128;
  const iconX = margin;
  const iconY = margin + 18;
  ctx.save();
  nyxMaterialsCardRoundedRect(ctx, iconX, iconY, iconSize, iconSize, iconSize / 2);
  ctx.clip();
  ctx.fillStyle = '#171028';
  ctx.fillRect(iconX, iconY, iconSize, iconSize);
  if (icon) nyxMaterialsCardDrawCover(ctx, icon, iconX, iconY, iconSize, iconSize);
  else {
    ctx.fillStyle = model.accent;
    ctx.font = '400 48px "GI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cmInitials(model.name), iconX + iconSize / 2, iconY + iconSize / 2);
  }
  ctx.restore();
  ctx.strokeStyle = model.accent;
  ctx.lineWidth = 3;
  nyxMaterialsCardRoundedRect(ctx, iconX, iconY, iconSize, iconSize, iconSize / 2);
  ctx.stroke();

  const textX = iconX + iconSize + 30;
  const watermarkX = NYX_MATERIALS_CARD_WIDTH - margin - 150;
  const nameSize = nyxMaterialsCardFitFont(ctx, model.name, watermarkX - textX - 36, 84, 44, '"GI", sans-serif');
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '400 ' + nameSize + 'px "GI", sans-serif';
  ctx.fillText(model.name, textX, margin + 91);

  const detail = [model.title, 'Lv ' + model.maxLevel, 'Max ' + model.midLabel].filter(Boolean).join(' · ');
  ctx.fillStyle = 'rgba(229,222,246,.78)';
  ctx.font = '400 28px "HSR", sans-serif';
  ctx.fillText(detail, textX, margin + 134);

  let metaX = textX;
  for (const chip of model.meta) {
    const image = assets.get(chip.icon);
    if (!image) continue;
    ctx.save();
    ctx.globalAlpha = 0.82;
    nyxMaterialsCardDrawFittedImage(ctx, image, metaX, margin + 149, 34, 34);
    ctx.restore();
    metaX += 46;
  }

  const logo = assets.get('/assets/icon/nyx_logo.png');
  if (logo) {
    ctx.save();
    ctx.globalAlpha = 0.20;
    nyxMaterialsCardDrawFittedImage(ctx, logo, watermarkX, margin, 150, 112);
    ctx.restore();
  }
  ctx.save();
  ctx.globalAlpha = 0.50;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = '400 34px "GI", sans-serif';
  ctx.fillText('pengo.gg', watermarkX + 75, margin + 146);
  ctx.restore();
}

function nyxMaterialsCardDrawSplash(ctx, model, assets, contentY, contentHeight){
  const art = assets.get(model.art);
  if (!art) return;
  const x = NYX_MATERIALS_CARD_MARGIN + NYX_MATERIALS_CARD_LABEL_WIDTH;
  const width = NYX_MATERIALS_CARD_WIDTH - x - NYX_MATERIALS_CARD_MARGIN;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, contentY, width, contentHeight);
  ctx.clip();
  ctx.globalAlpha = 0.22;
  nyxMaterialsCardDrawCover(ctx, art, x, contentY, width, contentHeight);
  ctx.globalAlpha = 1;
  const leftFade = ctx.createLinearGradient(x, 0, x + 340, 0);
  leftFade.addColorStop(0, 'rgba(16,10,32,.98)');
  leftFade.addColorStop(1, 'rgba(16,10,32,0)');
  ctx.fillStyle = leftFade;
  ctx.fillRect(x, contentY, 340, contentHeight);
  const bottomFade = ctx.createLinearGradient(0, contentY + contentHeight - 260, 0, contentY + contentHeight);
  bottomFade.addColorStop(0, 'rgba(9,5,20,0)');
  bottomFade.addColorStop(1, 'rgba(9,5,20,.96)');
  ctx.fillStyle = bottomFade;
  ctx.fillRect(x, contentY + contentHeight - 260, width, 260);
  ctx.restore();
}

function nyxMaterialsCardDrawLabel(ctx, model, row, assets, x, y, height){
  const textX = x + 30;
  ctx.fillStyle = 'rgba(255,255,255,.95)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '400 32px "GI", sans-serif';
  ctx.fillText(row.title, textX, y + 58);

  if (row.key === 'ascension') {
    ctx.fillStyle = 'rgba(224,216,242,.75)';
    ctx.font = '400 30px "HSR", sans-serif';
    ctx.fillText('Lv ' + model.maxLevel, textX, y + 103);
    return;
  }
  if (row.key === 'weapon') {
    const weapon = assets.get(model.weaponIcon);
    if (weapon) {
      ctx.save();
      ctx.globalAlpha = 0.14;
      nyxMaterialsCardDrawFittedImage(ctx, weapon, x + 178, y + 54, 190, Math.min(190, height - 70));
      ctx.restore();
    }
    const fontSize = nyxMaterialsCardFitFont(ctx, row.weaponName, NYX_MATERIALS_CARD_LABEL_WIDTH - 60, 30, 22, '"HSR", sans-serif');
    ctx.font = '400 ' + fontSize + 'px "HSR", sans-serif';
    ctx.fillStyle = 'rgba(224,216,242,.78)';
    const lines = nyxMaterialsCardWrapText(ctx, row.weaponName, NYX_MATERIALS_CARD_LABEL_WIDTH - 60, 2);
    lines.forEach((line, index) => ctx.fillText(line, textX, y + 105 + index * (fontSize + 6)));
    return;
  }
  if (row.key !== 'talents') return;

  const icons = model.skillIcons;
  const values = model.targets || [];
  if (!icons.length) {
    ctx.fillStyle = 'rgba(224,216,242,.75)';
    ctx.font = '400 28px "HSR", sans-serif';
    ctx.fillText('Max', textX, y + 103);
    return;
  }
  const size = 52;
  const gap = 9;
  icons.slice(0, 6).forEach((source, index) => {
    const left = textX + index * (size + gap);
    ctx.fillStyle = 'rgba(10,7,20,.72)';
    nyxMaterialsCardRoundedRect(ctx, left, y + 80, size, size, size / 2);
    ctx.fill();
    const image = assets.get(source);
    if (image) nyxMaterialsCardDrawFittedImage(ctx, image, left + 4, y + 84, size - 8, size - 8);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '400 20px "GI", sans-serif';
    ctx.fillText(values[index] == null ? 'Max' : String(values[index]), left + size / 2, y + 157);
  });
  ctx.textAlign = 'left';
}

function nyxMaterialsCardDrawTile(ctx, item, assets, x, y){
  const tier = cmItemFrameRarity(item.rar, 4);
  const colors = nyxMaterialsCardFrameColors(tier);
  ctx.save();
  ctx.save();
  nyxMaterialsCardRoundedRect(ctx, x, y, NYX_MATERIALS_CARD_TILE_WIDTH, NYX_MATERIALS_CARD_TILE_HEIGHT, 9);
  ctx.clip();
  const fill = ctx.createLinearGradient(0, y, 0, y + NYX_MATERIALS_CARD_TILE_HEIGHT);
  fill.addColorStop(0, colors.top);
  fill.addColorStop(0.52, colors.mid);
  fill.addColorStop(1, colors.bottom);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, NYX_MATERIALS_CARD_TILE_WIDTH, NYX_MATERIALS_CARD_TILE_HEIGHT);
  ctx.fillStyle = colors.plate;
  ctx.fillRect(x, y + 150, NYX_MATERIALS_CARD_TILE_WIDTH, 37);
  const band = ctx.createLinearGradient(0, y + 150, 0, y + 187);
  band.addColorStop(0, cmFrameRgba(colors.base, 0.10));
  band.addColorStop(1, 'rgba(0,0,0,.35)');
  ctx.fillStyle = band;
  ctx.fillRect(x, y + 150, NYX_MATERIALS_CARD_TILE_WIDTH, 37);

  let image = null;
  let frame = null;
  if (item.sprite) {
    image = assets.get(item.sprite);
    if (image) {
      let frames = CM_SPRITE_FRAME_CACHE.get(item.sprite);
      if (frames === undefined) {
        frames = cmDetectSpriteFrames(image);
        CM_SPRITE_FRAME_CACHE.set(item.sprite, frames);
      }
      frame = frames?.[0] || null;
    }
  }
  if (!image || (item.sprite && !frame)) image = assets.get(item.icon || item.art);
  if (!nyxMaterialsCardDrawFittedImage(ctx, image, x + 10, y + 10, 130, 130, frame)) {
    ctx.fillStyle = colors.line;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '400 58px "GI", sans-serif';
    ctx.fillText(nyxMaterialsCardGlyph(item.kind), x + 75, y + 76);
  }

  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y + 150);
  ctx.lineTo(x + 150, y + 150);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 2;
  nyxMaterialsCardRoundedRect(ctx, x, y, NYX_MATERIALS_CARD_TILE_WIDTH, NYX_MATERIALS_CARD_TILE_HEIGHT, 9);
  ctx.stroke();
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  nyxMaterialsCardRoundedRect(ctx, x + 4, y + 4, NYX_MATERIALS_CARD_TILE_WIDTH - 8, NYX_MATERIALS_CARD_TILE_HEIGHT - 8, 6);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const quantity = cmFrameQuantityText(item.qty);
  if (quantity) {
    const designSize = parseFloat(cmFrameQuantitySize(quantity)) || 35;
    ctx.font = '400 ' + Math.max(16, Math.round(designSize * NYX_MATERIALS_CARD_TILE_WIDTH / 208)) + 'px "GI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,.8)';
    ctx.shadowBlur = 3;
    ctx.fillText(quantity, x + 75, y + 169);
    ctx.shadowBlur = 0;
  }

  ctx.fillStyle = 'rgba(246,242,255,.92)';
  ctx.font = '400 20px "HSR", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const lines = nyxMaterialsCardWrapText(ctx, item.name, NYX_MATERIALS_CARD_TILE_WIDTH + 12, 2);
  lines.forEach((line, index) => ctx.fillText(line, x + 75, y + 213 + index * 24));
  ctx.restore();
}

function nyxMaterialsCardDrawRows(ctx, model, assets, startY){
  let y = startY;
  for (const row of model.rows) {
    const height = nyxMaterialsCardRowHeight(row);
    const wash = ctx.createLinearGradient(NYX_MATERIALS_CARD_MARGIN, 0, NYX_MATERIALS_CARD_WIDTH - NYX_MATERIALS_CARD_MARGIN, 0);
    if (row.key === 'total') {
      wash.addColorStop(0, 'rgba(40,22,68,.62)');
      wash.addColorStop(1, 'rgba(22,12,42,.42)');
    } else {
      wash.addColorStop(0, 'rgba(16,9,32,.78)');
      wash.addColorStop(1, 'rgba(16,9,32,.18)');
    }
    ctx.fillStyle = wash;
    ctx.fillRect(NYX_MATERIALS_CARD_MARGIN, y, NYX_MATERIALS_CARD_WIDTH - NYX_MATERIALS_CARD_MARGIN * 2, height);
    ctx.strokeStyle = 'rgba(120,90,200,.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(NYX_MATERIALS_CARD_MARGIN, y);
    ctx.lineTo(NYX_MATERIALS_CARD_WIDTH - NYX_MATERIALS_CARD_MARGIN, y);
    ctx.stroke();
    nyxMaterialsCardDrawLabel(ctx, model, row, assets, NYX_MATERIALS_CARD_MARGIN, y, height);

    const tileX = NYX_MATERIALS_CARD_MARGIN + NYX_MATERIALS_CARD_LABEL_WIDTH + 20;
    row.items.forEach((item, index) => {
      const column = index % NYX_MATERIALS_CARD_TILES_PER_LINE;
      const line = Math.floor(index / NYX_MATERIALS_CARD_TILES_PER_LINE);
      nyxMaterialsCardDrawTile(
        ctx,
        item,
        assets,
        tileX + column * NYX_MATERIALS_CARD_TILE_STEP_X,
        y + 22 + line * NYX_MATERIALS_CARD_TILE_STEP_Y,
      );
    });
    y += height;
  }
}

async function nyxMaterialsCardEncode(canvas){
  if (canvas.convertToBlob) return canvas.convertToBlob({ type:'image/png' });
  if (!canvas.toBlob) throw new Error('PNG export is unavailable in this browser.');
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed.')), 'image/png');
  });
}

async function nyxRenderMaterialsCard(input){
  const model = nyxBuildMaterialsCardModel(input);
  await nyxMaterialsCardWaitForFonts();
  const assets = await nyxMaterialsCardLoadAssets(model);
  const height = nyxMaterialsCardHeight(model);
  const canvas = nyxMaterialsCardCreateCanvas(NYX_MATERIALS_CARD_WIDTH, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image rendering is unavailable in this browser.');

  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, '#100A20');
  background.addColorStop(1, '#090514');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, NYX_MATERIALS_CARD_WIDTH, height);
  ctx.fillStyle = model.accent;
  ctx.fillRect(0, 0, NYX_MATERIALS_CARD_WIDTH, 6);
  nyxMaterialsCardDrawHeader(ctx, model, assets);
  const contentY = NYX_MATERIALS_CARD_MARGIN + NYX_MATERIALS_CARD_HEADER_HEIGHT;
  nyxMaterialsCardDrawSplash(ctx, model, assets, contentY, height - contentY - NYX_MATERIALS_CARD_MARGIN);
  nyxMaterialsCardDrawRows(ctx, model, assets, contentY);
  return nyxMaterialsCardEncode(canvas);
}
