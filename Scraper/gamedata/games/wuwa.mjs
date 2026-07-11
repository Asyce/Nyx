import {
  normalizeMaterials,
  parseRarity,
  registerAsset,
  removeEmpty,
  removeRemoteLinks,
  scrapeConfiguredGame,
  text,
  toEntries
} from '../lib/gamedata-game.mjs';

const config = {
  gameId: 'ww',
  gameName: 'Wuthering Waves',
  outputRoot: 'GameData/ww',
  assetPath: wuwaAssetPath,
  rawLists: {
    characters: { file: 'character.json' },
    weapons: { file: 'weapon.json' },
    echoes: { file: 'echo.json' },
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
      key: 'weapons',
      listKey: 'weapons',
      detailType: 'weapon',
      outputFile: 'weapons.json',
      normalize: normalizeWeapon
    },
    {
      key: 'echoes',
      listKey: 'echoes',
      detailType: 'echo',
      outputFile: 'echoes.json',
      normalize: normalizeEcho
    },
    {
      key: 'monsters',
      listKey: 'monsters',
      detailType: 'monster',
      outputFile: 'monsters.json',
      normalize: normalizeMonster
    },
    {
      key: 'items',
      listKey: 'itemAll',
      outputFile: 'items.json',
      normalize: normalizeItem
    }
  ]
};

export async function scrapeWuwa(options) {
  return scrapeConfiguredGame(options, config);
}

function normalizeCharacter({ id, summary, detail, channel, lists, assetBag }) {
  const itemsById = lists.itemAll || lists.items || {};
  const registerItem = (itemIcon) => registerAsset(assetBag, config, 'items', itemIcon);

  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name: detail?.name || text(summary?.en) || String(id),
    nickname: detail?.nick_name || summary?.nickname || null,
    rarity: parseRarity(detail?.rarity || summary?.rank),
    weapon: detail?.weapon || summary?.weapon || null,
    element: detail?.element || summary?.element || null,
    description: detail?.desc || summary?.desc || null,
    assets: {
      icon: registerAsset(assetBag, config, 'characters/icons', detail?.icon || summary?.icon),
      background: registerAsset(assetBag, config, 'characters/backgrounds', detail?.background || summary?.background),
      stand: registerAsset(assetBag, config, 'characters/stands', detail?.background_stand),
      // full-body PixActivity art (base skin) — used as the character splash art
      portrait: registerAsset(assetBag, config, 'characters/portraits', baseSkinPortrait(detail))
    },
    profile: removeRemoteLinks({
      charaInfo: detail?.chara_info || null,
      stories: detail?.stories || [],
      voices: detail?.voices || [],
      goods: detail?.goods || [],
      specialCook: detail?.special_cook || null
    }),
    tags: removeRemoteLinks(detail?.tag || {}),
    stats: removeRemoteLinks({
      stats: detail?.stats || {},
      weakness: detail?.stats_weakness || {},
      levelExp: detail?.level_exp || []
    }),
    skills: normalizeSkillTrees(detail?.skill_trees || {}, itemsById, registerItem, assetBag),
    skillBranches: removeRemoteLinks(detail?.skill_branches || {}),
    chains: normalizeIconMap(detail?.chains || {}, 'chains', assetBag),
    ascensions: normalizeRequirementMap(detail?.ascensions || {}, itemsById, registerItem),
    forte: removeRemoteLinks(detail?.forte || null),
    forteNew: removeRemoteLinks(detail?.forte_new || null),
    skins: removeRemoteLinks(detail?.skin || {}),
    recommendations: removeRemoteLinks(detail?.recommend || {}),
    sourceSnapshot: removeRemoteLinks({ summary, detail })
  });
}

function baseSkinPortrait(detail) {
  const skins = detail?.skin;
  if (!skins || typeof skins !== 'object') return null;
  const keys = Object.keys(skins)
    .filter((key) => skins[key]?.portrait)
    .sort((a, b) => Number(a) - Number(b));
  return keys.length ? skins[keys[0]].portrait : null;
}

function normalizeWeapon({ id, summary, detail, channel, lists, assetBag }) {
  const itemsById = lists.itemAll || lists.items || {};
  const registerItem = (itemIcon) => registerAsset(assetBag, config, 'items', itemIcon);

  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name: detail?.name || text(summary?.en) || String(id),
    rarity: parseRarity(detail?.rarity || summary?.rank),
    type: detail?.type || summary?.type || null,
    description: detail?.desc || summary?.desc || null,
    attack: summary?.atk ?? null,
    subStat: summary?.sub || null,
    assets: {
      icon: registerAsset(assetBag, config, 'weapons', detail?.icon || summary?.icon)
    },
    stats: removeRemoteLinks(detail?.stats || {}),
    effect: removeRemoteLinks({
      name: detail?.effect_name || null,
      description: detail?.effect || null,
      params: detail?.param || []
    }),
    ascensions: normalizeRequirementMap(detail?.ascensions || {}, itemsById, registerItem),
    sourceSnapshot: removeRemoteLinks({ summary, detail })
  });
}

function normalizeEcho({ id, summary, detail, channel, assetBag }) {
  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name: detail?.name || text(summary?.en) || String(id),
    code: detail?.code || summary?.code || null,
    rarity: detail?.rarity || summary?.rank || [],
    type: detail?.type || null,
    intensity: detail?.intensity || summary?.intensity || null,
    place: detail?.place || null,
    group: removeRemoteLinks(detail?.group || summary?.group || {}),
    assets: {
      icon: registerAsset(assetBag, config, 'echoes', detail?.icon || summary?.icon),
      skill: registerAsset(assetBag, config, 'echoes/skills', detail?.skill?.icon)
    },
    skill: removeRemoteLinks(detail?.skill || null),
    monsterInfo: detail?.monster_info || null,
    sourceSnapshot: removeRemoteLinks({ summary, detail })
  });
}

function normalizeMonster({ id, summary, detail, channel, assetBag }) {
  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name: detail?.name || text(summary?.en) || String(id),
    rarity: detail?.rarity || summary?.rank || null,
    element: detail?.element ?? summary?.element ?? null,
    echo: detail?.echo || summary?.echo || null,
    description: detail?.desc || summary?.desc || null,
    openDescription: detail?.desc_open || null,
    assets: {
      icon: registerAsset(assetBag, config, 'monsters', detail?.icon || summary?.icon)
    },
    stats: removeRemoteLinks({
      base: detail?.base_stats || {},
      stats: detail?.stats || {}
    }),
    sourceSnapshot: removeRemoteLinks({ summary, detail })
  });
}

function normalizeItem({ id, summary, channel, assetBag }) {
  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name: summary?.name || String(id),
    rarity: summary?.rarity ?? summary?.rank ?? null,
    type: summary?.type || null,
    tag: summary?.tag || [],
    description: summary?.desc || null,
    background: summary?.bg || null,
    source: summary?.source || null,
    assets: {
      icon: registerAsset(assetBag, config, 'items', summary?.icon)
    },
    sourceSnapshot: removeRemoteLinks(summary)
  });
}

function normalizeSkillTrees(skillTrees, itemsById, registerItem, assetBag) {
  return toEntries(skillTrees).map(([key, node]) => removeEmpty({
    key,
    type: node?.skill?.type || null,
    unlockCondition: node?.un_lock_condition ?? null,
    coordinate: node?.coordinate ?? null,
    requirements: normalizeMaterials(node?.consume || [], itemsById, registerItem),
    skill: removeEmpty({
      name: node?.skill?.name || null,
      description: node?.skill?.desc || null,
      simpleDescription: node?.skill?.simple_desc || null,
      params: node?.skill?.param || [],
      assets: {
        icon: registerAsset(assetBag, config, 'skills', node?.skill?.icon)
      },
      levels: toEntries(node?.skill?.level || {}).map(([level, data]) => removeEmpty({
        key: level,
        name: data?.name || null,
        params: data?.param || [],
        sourceSnapshot: removeRemoteLinks(data)
      }))
    }),
    sourceSnapshot: removeRemoteLinks(node)
  }));
}

function normalizeIconMap(value, category, assetBag) {
  return toEntries(value).map(([key, item]) => removeEmpty({
    key,
    name: item?.name || null,
    description: item?.desc || null,
    params: item?.param || [],
    assets: {
      icon: registerAsset(assetBag, config, category, item?.icon)
    },
    sourceSnapshot: removeRemoteLinks(item)
  }));
}

function normalizeRequirementMap(value, itemsById, registerItem) {
  return Object.fromEntries(toEntries(value).map(([level, requirements]) => [
    level,
    normalizeMaterials(requirements || [], itemsById, registerItem)
  ]));
}

function wuwaAssetPath(sourceRef) {
  if (!sourceRef || typeof sourceRef !== 'string') {
    return null;
  }

  let asset = sourceRef
    .replace(/^\/Game\/Aki\/UI\//, '')
    .replace(/^Game\/Aki\/UI\//, '')
    .replace(/^\/Game\/Aki\//, '')
    .replace(/^Game\/Aki\//, '')
    .replace(/\\/g, '/');
  const parts = asset.split('/');
  const last = parts.pop() || '';
  const stem = last.split('.')[0].replace(/\.(png|webp|jpg|jpeg)$/i, '');
  return [...parts, `${stem}.webp`].filter(Boolean).join('/');
}
