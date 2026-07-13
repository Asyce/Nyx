import {
  parseRarity,
  removeEmpty,
  removeRemoteLinks,
  scrapeConfiguredGame,
  text,
  toEntries
} from '../lib/gamedata-game.mjs';

const GAME_ID = 'hsr';
const OUTPUT_ROOT = 'GameData/hsr';
const ASSET_ROOT = `${OUTPUT_ROOT}/assets`;

const config = {
  gameId: GAME_ID,
  gameName: 'Honkai: Star Rail',
  outputRoot: OUTPUT_ROOT,
  rawLists: {
    characters: { file: 'character.json' },
    lightcones: { file: 'lightcone.json' },
    relics: { file: 'relicset.json' },
    monsters: { file: 'monster.json', optional: true },
    items: { file: 'en/item.json', optional: true },
    itemAll: { file: 'en/item_all.json', optional: true }
  },
  sections: [
    {
      key: 'characters',
      listKey: 'characters',
      detailType: 'character',
      outputFile: 'characters.json',
      normalize: normalizeCharacter
    },
    {
      key: 'lightcones',
      listKey: 'lightcones',
      detailType: 'lightcone',
      outputFile: 'lightcones.json',
      normalize: normalizeLightcone
    },
    {
      key: 'relics',
      listKey: 'relics',
      detailType: 'relicset',
      outputFile: 'relics.json',
      normalize: normalizeRelic
    },
    {
      key: 'items',
      listKey: 'itemAll',
      outputFile: 'items.json',
      normalize: normalizeItem
    },
    {
      key: 'monsters',
      listKey: 'monsters',
      outputFile: 'monsters.json',
      normalize: normalizeHsrMonster
    }
  ]
};

export async function scrapeHsr(options) {
  return scrapeConfiguredGame(options, config);
}

function normalizeCharacter({ id, summary, detail, channel, lists, assetBag }) {
  const itemsById = lists.itemAll || lists.items || {};
  const name = detail?.name || text(summary?.en) || String(id);

  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name,
    rarity: parseRarity(detail?.rarity || summary?.rank),
    rarityRaw: detail?.rarity || summary?.rank || null,
    path: detail?.base_type || summary?.baseType || null,
    element: detail?.damage_type || summary?.damageType || null,
    description: detail?.desc || summary?.desc || null,
    release: summary?.release || null,
    assets: {
      avatar: assetBag.register(`${ASSET_ROOT}/characters/avatar/${id}.webp`, `avataricon/avatar/${id}.webp`),
      roundIcon: assetBag.register(`${ASSET_ROOT}/characters/round/${id}.webp`, `avatarroundicon/${id}.webp`),
      shopIcon: assetBag.register(`${ASSET_ROOT}/characters/shop/${id}.webp`, `avatarshopicon/${id}.webp`),
      drawCard: assetBag.register(`${ASSET_ROOT}/characters/draw-card/${id}.webp`, `avatardrawcard/${id}.webp`)
    },
    profile: removeRemoteLinks(detail?.chara_info || null),
    skills: normalizeSkills(detail?.skills || {}, itemsById, assetBag),
    eidolons: normalizeRanks(detail?.ranks || {}, assetBag),
    traces: normalizeSkillTrees(detail?.skill_trees || {}, itemsById, assetBag),
    ascensions: normalizeStats(detail?.stats || {}, itemsById, assetBag),
    recommendations: removeRemoteLinks({
      relics: detail?.relics || null,
      lightcones: detail?.lightcones || null,
      teams: detail?.teams || null
    }),
    extras: removeRemoteLinks({
      enhance: summary?.enhance || detail?.enhanced || [],
      memosprite: detail?.memosprite || null,
      unique: detail?.unique || null,
      skin: detail?.skin || null,
      avatarVoTag: detail?.avatar_vo_tag || null,
      spNeed: detail?.sp_need ?? null
    }),
    sourceSnapshot: removeRemoteLinks({ summary, detail })
  });
}

function normalizeLightcone({ id, summary, detail, channel, lists, assetBag }) {
  const itemsById = lists.itemAll || lists.items || {};
  const name = detail?.name || text(summary?.en) || String(id);

  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name,
    rarity: parseRarity(detail?.rarity || summary?.rank),
    rarityRaw: detail?.rarity || summary?.rank || null,
    path: detail?.base_type || summary?.baseType || null,
    description: detail?.desc || summary?.desc || null,
    attack: summary?.atk ?? null,
    assets: {
      mediumIcon: assetBag.register(`${ASSET_ROOT}/lightcones/medium/${id}.webp`, `lightconemediumicon/${id}.webp`),
      fullFigure: assetBag.register(`${ASSET_ROOT}/lightcones/full/${id}.webp`, `lightconemaxfigures/${id}.webp`)
    },
    effect: normalizeLightconeEffect(detail?.refinements || {}),
    ascensions: normalizeStats(detail?.stats || [], itemsById, assetBag),
    sourceSnapshot: removeRemoteLinks({ summary, detail })
  });
}

function normalizeRelic({ id, summary, detail, channel, assetBag }) {
  const iconStem = iconStemFromRef(detail?.icon || summary?.icon);

  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name: detail?.name || text(summary?.en) || String(id),
    rarity: null,
    type: relicSetType(id),
    description: null,
    assets: {
      icon: iconStem
        ? assetBag.register(`${ASSET_ROOT}/relics/sets/${iconStem}.webp`, `itemfigures/${iconStem}.webp`)
        : null
    },
    setEffects: normalizeRelicEffects(detail?.require_num || summary?.set || {}),
    parts: normalizeRelicParts(detail?.parts || {}),
    sourceSnapshot: removeRemoteLinks({ summary, detail })
  });
}

function normalizeItem({ id, summary, channel, assetBag }) {
  const item = summary || {};
  const iconStem = iconStemFromRef(item?.item_figure_icon_path || item?.item_icon_path);

  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name: item?.item_name || String(id),
    rarity: item?.rarity || null,
    type: item?.item_main_type || null,
    subType: item?.item_sub_type || null,
    description: item?.item_desc || null,
    backgroundDescription: item?.item_bg_desc || null,
    purposeType: item?.purpose_type ?? null,
    assets: {
      icon: iconStem
        ? assetBag.register(`${ASSET_ROOT}/items/${iconStem}.webp`, `itemfigures/${iconStem}.webp`)
        : null
    },
    sourceSnapshot: removeRemoteLinks(item)
  });
}

export function normalizeHsrMonster({ id, summary, channel, assetBag }) {
  const monster = summary || {};
  const iconStem = iconStemFromRef(monster?.icon);

  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name: text(monster?.en) || monster?.name || String(id),
    rank: monster?.rank || null,
    camp: monster?.camp ?? null,
    weaknesses: Array.isArray(monster?.weak) ? monster.weak : [],
    type: monster?.type || monster?.monster_type || null,
    description: monster?.desc || null,
    assets: iconStem ? {
      icon: assetBag.register(`${ASSET_ROOT}/monsters/${iconStem}.webp`, `monsterfigure/${iconStem}.webp`)
    } : null,
    sourceSnapshot: removeRemoteLinks(monster)
  });
}

function normalizeSkills(skills, itemsById, assetBag) {
  return toEntries(skills).map(([key, skill]) => {
    const { level, ...rest } = skill || {};
    return removeEmpty({
      key,
      id: String(skill?.id || key),
      name: skill?.name || String(key),
      description: skill?.desc || null,
      simpleDescription: skill?.simple_desc || null,
      type: skill?.type || null,
      typeName: skill?.type_name || null,
      tag: skill?.tag || null,
      spBase: skill?.sp_base ?? null,
      bpNeed: skill?.bp_need ?? null,
      bpAdd: skill?.bp_add ?? null,
      levels: normalizeLevelMap(level || {}),
      extra: removeRemoteLinks(rest.extra || {}),
      sourceSnapshot: removeRemoteLinks(rest)
    });
  });
}

function normalizeRanks(ranks, assetBag) {
  return toEntries(ranks).map(([key, rank]) => removeEmpty({
    key,
    id: String(rank?.id || key),
    name: rank?.name || String(key),
    description: rank?.desc || null,
    params: rank?.param_list || [],
    assets: {
      icon: registerSkillIcon(rank?.icon, assetBag)
    },
    sourceSnapshot: removeRemoteLinks(rank)
  }));
}

function normalizeSkillTrees(skillTrees, itemsById, assetBag) {
  return toEntries(skillTrees).map(([node, levels]) => removeEmpty({
    node,
    levels: toEntries(levels || {}).map(([level, data]) => {
      const enriched = enrichMaterialsDeep(data || {}, itemsById, assetBag);
      return removeEmpty({
        level: Number.parseInt(level, 10),
        anchor: data?.anchor || null,
        pointId: data?.point_id ? String(data.point_id) : null,
        pointName: data?.point_name || null,
        pointDescription: data?.point_desc || null,
        pointType: data?.point_type ?? null,
        triggerKey: data?.point_trigger_key ?? null,
        defaultUnlock: data?.default_unlock ?? null,
        maxLevel: data?.max_level ?? null,
        avatarPromotionLimit: data?.avatar_promotion_limit ?? null,
        avatarLevelLimit: data?.avatar_level_limit ?? null,
        prePoint: data?.pre_point || [],
        levelUpSkillIds: data?.level_up_skill_id || [],
        params: data?.param_list || [],
        statusAdds: data?.status_add_list || [],
        requirements: enriched.material_list || [],
        assets: {
          icon: registerTraceOrSkillIcon(data?.icon, assetBag)
        },
        sourceSnapshot: removeRemoteLinks(enriched)
      });
    })
  }));
}

function normalizeStats(stats, itemsById, assetBag) {
  return toEntries(stats).map(([key, data]) => {
    const enriched = enrichMaterialsDeep(data || {}, itemsById, assetBag);
    return removeEmpty({
      key,
      promotion: enriched.promotion ?? (Number.isFinite(Number(key)) ? Number(key) : null),
      playerLevelRequirement: enriched.player_level_require ?? null,
      worldLevelRequirement: enriched.world_level_require ?? null,
      maxLevel: enriched.max_level ?? null,
      requirements: enriched.cost || enriched.promotion_cost_list || [],
      stats: removeRemoteLinks(omitKeys(enriched, [
        'cost',
        'promotion_cost_list',
        'player_level_require',
        'world_level_require',
        'max_level',
        'promotion'
      ])),
      sourceSnapshot: removeRemoteLinks(enriched)
    });
  });
}

function normalizeLightconeEffect(refinements) {
  const { level, ...rest } = refinements || {};
  return removeEmpty({
    name: refinements?.name || null,
    description: refinements?.desc || null,
    levels: normalizeLevelMap(level || {}),
    sourceSnapshot: removeRemoteLinks(rest)
  });
}

function normalizeRelicEffects(effects) {
  return toEntries(effects).map(([pieces, effect]) => removeEmpty({
    pieces: Number.parseInt(pieces, 10),
    description: effect?.desc || effect?.en || null,
    params: effect?.param_list || effect?.ParamList || [],
    sourceSnapshot: removeRemoteLinks(effect)
  }));
}

function normalizeRelicParts(parts) {
  return toEntries(parts).map(([id, part]) => removeEmpty({
    id: String(id),
    name: part?.name || String(id),
    description: part?.desc || null,
    story: part?.story || null,
    sourceSnapshot: removeRemoteLinks(part)
  }));
}

function normalizeLevelMap(levels) {
  return toEntries(levels).map(([level, data]) => removeEmpty({
    level: Number.parseInt(level, 10),
    params: data?.param_list || data?.ParamList || [],
    sourceSnapshot: removeRemoteLinks(data)
  }));
}

function enrichMaterialsDeep(value, itemsById, assetBag) {
  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === 'object' && 'item_id' in item)) {
      return value.map((item) => enrichMaterial(item, itemsById, assetBag));
    }

    return value.map((item) => enrichMaterialsDeep(item, itemsById, assetBag));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      enrichMaterialsDeep(child, itemsById, assetBag)
    ]));
  }

  return value;
}

function enrichMaterial(material, itemsById, assetBag) {
  const itemId = String(material.item_id);
  const item = itemsById?.[itemId] || {};
  const iconStem = iconStemFromRef(item.item_figure_icon_path || item.item_icon_path);

  return removeEmpty({
    itemId,
    quantity: material.item_num ?? null,
    rarity: material.rarity || item.rarity || null,
    name: item.item_name || null,
    type: item.item_main_type || null,
    subType: item.item_sub_type || null,
    description: item.item_desc || item.item_bg_desc || null,
    assets: {
      icon: iconStem
        ? assetBag.register(`${ASSET_ROOT}/items/${iconStem}.webp`, `itemfigures/${iconStem}.webp`)
        : null
    },
    sourceSnapshot: removeRemoteLinks({ material, item })
  });
}

function registerSkillIcon(iconRef, assetBag) {
  const stem = iconStemFromRef(iconRef);
  return stem ? assetBag.register(`${ASSET_ROOT}/skills/${stem}.webp`, `skillicons/${stem}.webp`) : null;
}

function registerTraceOrSkillIcon(iconRef, assetBag) {
  const stem = iconStemFromRef(iconRef);
  if (!stem) {
    return null;
  }

  if (stem.startsWith('SkillIcon_')) {
    return assetBag.register(`${ASSET_ROOT}/skills/${stem}.webp`, `skillicons/${stem}.webp`);
  }

  return assetBag.register(`${ASSET_ROOT}/traces/${stem}.webp`, `trace/${stem}.webp`);
}

function iconStemFromRef(iconRef) {
  if (!iconRef || typeof iconRef !== 'string') {
    return null;
  }

  const fileName = iconRef.split(/[\\/]/).pop();
  return fileName ? fileName.replace(/\.(png|webp|jpg|jpeg)$/i, '') : null;
}

function relicSetType(id) {
  const numericId = Number(id);
  if (Number.isFinite(numericId) && numericId >= 300) {
    return 'planar ornament';
  }

  return 'cavern relic';
}

function omitKeys(value, keys) {
  const keySet = new Set(keys);
  return Object.fromEntries(Object.entries(value || {}).filter(([key]) => !keySet.has(key)));
}
