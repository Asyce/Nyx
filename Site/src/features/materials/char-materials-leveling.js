/* Level-up EXP packs, shared by the character page and the downloadable
   material image. It lives in its own file because the share card is unit
   tested in isolation (tools/tests/characters-nyx.test.mjs runs it in a bare
   VM context), so the table has to be loadable without the rest of the
   character page. Listed before both consumers in tools/build-site.mjs. */

/* Per-level costs come from window.CM_LEVELING, scraped from each game's own
   wiki leveling table into Database/Leveling (Scraper/leveling) and shipped in
   cm-data.js. Those tables publish a running subtotal at every ascension band,
   so "what does Lv 70 cost" is a sourced number rather than a guess — which is
   why the character page can price any slider position now (user 2026-08-14).

   The table below is the fallback: it is character totals at max level only,
   plus the weapon/light-cone figures and Endfield, none of which the four
   scraped pages cover. Every game the scrape does cover reproduces its total
   row here exactly, which is the check that the two agree. */
function nyxLevelingStages(gameKey){
  const table = typeof window !== 'undefined' ? window.CM_LEVELING : null;
  const rows = table?.[gameKey]?.stages;
  return Array.isArray(rows) && rows.length ? rows : null;
}

// The bill to take a character from Lv 1 to `targetLevel`: the highest sourced
// band whose cap the target reaches. Returns null when the target is below the
// first band, and falls back to the max-level total when a game has no table.
function nyxCharacterLeveling(gameKey, targetLevel, maxLevel){
  const stages = nyxLevelingStages(gameKey);
  if (!stages) {
    const entry = NYX_MATERIALS_LEVELING[gameKey]?.character;
    return Number(targetLevel) === Number(maxLevel) && entry ? entry : null;
  }
  const level = Number(targetLevel);
  let best = null;
  for (const stage of stages) if (Number(stage.cap) <= level && (!best || stage.cap > best.cap)) best = stage;
  return best ? { cost:Number(best.cost || 0), items:best.items || [] } : null;
}

// Weapons/light-cones have no scraped table yet, so they stay max-level only.
function nyxWeaponLeveling(gameKey, rarity, targetLevel, maxLevel){
  if (Number(targetLevel) !== Number(maxLevel)) return null;
  const weapon = NYX_MATERIALS_LEVELING[gameKey]?.weapon;
  return weapon?.[Number(rarity)] || weapon?.default || null;
}

const NYX_MATERIALS_LEVELING = {
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
