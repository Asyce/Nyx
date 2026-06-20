import {
  assetStem,
  ensureWebp,
  normalizeMaterials,
  parseRarity,
  registerAsset,
  removeEmpty,
  removeRemoteLinks,
  scrapeConfiguredGame,
  text,
  toEntries
} from '../lib/nanoka-game.mjs';

const config = {
  gameId: 'zzz',
  gameName: 'Zenless Zone Zero',
  outputRoot: 'Nanoka/zzz',
  assetPath: zzzAssetPath,
  rawLists: {
    characters: { file: 'character.json' },
    weapons: { file: 'weapon.json' },
    bangboos: { file: 'bangboo.json' },
    equipment: { file: 'equipment.json' },
    monsters: { file: 'monster.json', optional: true },
    items: { file: 'en/item.json', optional: true },
    itemAll: { file: 'en/item_all.json', optional: true }
  },
  sections: [
    {
      key: 'agents',
      listKey: 'characters',
      detailType: 'character',
      detailFolder: 'agents',
      outputFile: 'agents.json',
      normalize: normalizeAgent
    },
    {
      key: 'wEngines',
      listKey: 'weapons',
      detailType: 'weapon',
      detailFolder: 'w-engines',
      outputFile: 'w-engines.json',
      normalize: normalizeWEngine
    },
    {
      key: 'bangboos',
      listKey: 'bangboos',
      detailType: 'bangboo',
      outputFile: 'bangboos.json',
      normalize: normalizeBangboo
    },
    {
      key: 'driveDiscs',
      listKey: 'equipment',
      detailType: 'equipment',
      detailFolder: 'drive-discs',
      outputFile: 'drive-discs.json',
      normalize: normalizeDriveDisc
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

export async function scrapeZzz(options) {
  return scrapeConfiguredGame(options, config);
}

function normalizeAgent({ id, summary, detail, channel, lists, assetBag }) {
  const itemsById = lists.itemAll || lists.items || {};
  const registerItem = (itemIcon) => registerAsset(assetBag, config, 'items', itemIcon);

  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name: detail?.name || text(summary?.en) || String(id),
    codeName: detail?.code_name || summary?.code || null,
    rarity: parseRarity(detail?.rarity ?? summary?.rank),
    specialty: detail?.weapon_type || summary?.type || null,
    element: detail?.element_type || summary?.element || null,
    specialElement: detail?.special_element_type || null,
    hitType: detail?.hit_type || summary?.hit || null,
    camp: detail?.camp || summary?.camp || null,
    gender: detail?.gender || null,
    description: summary?.desc || detail?.partner_info?.profile_desc || null,
    assets: {
      icon: registerAsset(assetBag, config, 'agents/icons', detail?.icon || summary?.icon),
      partnerIcon: registerAsset(assetBag, config, 'agents/partner-icons', detail?.partner_info?.icon_path),
      roleIcon: registerAsset(assetBag, config, 'agents/role-icons', detail?.partner_info?.role_icon)
    },
    profile: removeRemoteLinks(detail?.partner_info || null),
    skins: removeRemoteLinks(detail?.skin || summary?.skin || {}),
    stats: removeRemoteLinks(detail?.stats || {}),
    levels: normalizeZzzLevelMap(detail?.level || {}, itemsById, registerItem),
    extraLevels: normalizeZzzLevelMap(detail?.extra_level || {}, itemsById, registerItem),
    levelExp: detail?.level_exp || [],
    skills: normalizeAgentSkills(detail?.skill || {}),
    skillList: removeRemoteLinks(detail?.skill_list || {}),
    passive: normalizePassive(detail?.passive || {}, itemsById, registerItem),
    mindscape: removeRemoteLinks(detail?.talent || {}),
    recommendations: removeRemoteLinks(detail?.fairy_recommend || {}),
    strategy: removeRemoteLinks(detail?.strategy || []),
    potential: removeRemoteLinks({
      list: detail?.potential || [],
      detail: detail?.potential_detail || {}
    }),
    sourceSnapshot: removeRemoteLinks({ summary, detail })
  });
}

function normalizeWEngine({ id, summary, detail, channel, lists, assetBag }) {
  const itemsById = lists.itemAll || lists.items || {};
  const registerItem = (itemIcon) => registerAsset(assetBag, config, 'items', itemIcon);

  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name: detail?.name || text(summary?.en) || String(id),
    codeName: detail?.code_name || summary?.icon || null,
    rarity: parseRarity(detail?.rarity ?? summary?.rank),
    type: detail?.weapon_type || summary?.type || null,
    description: detail?.desc || summary?.desc || null,
    shortDescription: detail?.desc3 || null,
    assets: {
      icon: registerAsset(assetBag, config, 'w-engines', detail?.icon || summary?.icon)
    },
    baseProperty: removeRemoteLinks(detail?.base_property || {}),
    randomProperty: removeRemoteLinks(detail?.rand_property || {}),
    levels: removeRemoteLinks(detail?.level || {}),
    stars: removeRemoteLinks(detail?.stars || {}),
    materials: normalizeMaterials(detail?.materials || '', itemsById, registerItem),
    talents: removeRemoteLinks(detail?.talents || {}),
    sourceSnapshot: removeRemoteLinks({ summary, detail })
  });
}

function normalizeBangboo({ id, summary, detail, channel, lists, assetBag }) {
  const itemsById = lists.itemAll || lists.items || {};
  const registerItem = (itemIcon) => registerAsset(assetBag, config, 'items', itemIcon);

  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name: detail?.name || text(summary?.en) || String(id),
    codeName: detail?.code_name || summary?.codename || null,
    rarity: parseRarity(detail?.rarity ?? summary?.rank),
    description: detail?.desc || summary?.desc || null,
    assets: {
      icon: registerAsset(assetBag, config, 'bangboos', detail?.icon || summary?.icon)
    },
    stats: removeRemoteLinks(detail?.stats || {}),
    levels: normalizeZzzLevelMap(detail?.level || {}, itemsById, registerItem),
    skills: removeRemoteLinks(detail?.skill || {}),
    skillProperties: removeRemoteLinks(detail?.skill_prop || {}),
    sourceSnapshot: removeRemoteLinks({ summary, detail })
  });
}

function normalizeDriveDisc({ id, summary, detail, channel, assetBag }) {
  const name = detail?.name || text(summary?.en?.name) || text(summary?.en) || String(id);

  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name,
    type: 'drive disc set',
    description: detail?.desc2 || text(summary?.en?.desc2) || null,
    setEffects: [
      removeEmpty({
        pieces: 2,
        description: detail?.desc2 || text(summary?.en?.desc2) || null
      }),
      removeEmpty({
        pieces: 4,
        description: detail?.desc4 || text(summary?.en?.desc4) || null
      })
    ],
    story: detail?.story || null,
    assets: {
      icon: registerAsset(assetBag, config, 'drive-discs', detail?.icon || summary?.icon),
      icon2: registerAsset(assetBag, config, 'drive-discs', detail?.icon2 || summary?.icon2)
    },
    sourceSnapshot: removeRemoteLinks({ summary, detail })
  });
}

function normalizeMonster({ id, summary, detail, channel, assetBag }) {
  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    monsterId: detail?.monster_id || null,
    name: detail?.name || text(summary?.en) || String(id),
    rarity: detail?.rarity || summary?.rarity || null,
    type: detail?.group_desc || summary?.group || null,
    description: detail?.desc || summary?.desc || null,
    assets: {
      icon: registerAsset(assetBag, config, 'monsters', detail?.image_path || summary?.icon)
    },
    monsterInfo: removeRemoteLinks(detail?.monster_info || {}),
    card: removeRemoteLinks({
      obtain: detail?.card_obtain || null,
      quote: detail?.card_quote || null,
      skillDescription: detail?.card_skill_desc || null
    }),
    elementAbnormal: removeRemoteLinks(detail?.element_abnormal || null),
    sourceSnapshot: removeRemoteLinks({ summary, detail })
  });
}

function normalizeItem({ id, summary, channel, assetBag }) {
  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name: summary?.name || String(id),
    rarity: summary?.rarity ?? summary?.rank ?? null,
    type: summary?.class || summary?.type || null,
    description: summary?.desc || null,
    secondaryDescription: summary?.desc2 || null,
    assets: {
      icon: registerAsset(assetBag, config, 'items', summary?.icon_path || summary?.icon)
    },
    sourceSnapshot: removeRemoteLinks(summary)
  });
}

function normalizeAgentSkills(skillGroups) {
  return Object.entries(skillGroups).map(([group, data]) => removeEmpty({
    group,
    descriptions: removeRemoteLinks(data?.description || []),
    sourceSnapshot: removeRemoteLinks(data)
  }));
}

function normalizePassive(passive, itemsById, registerItem) {
  return removeEmpty({
    levels: removeRemoteLinks(passive?.level || {}),
    materials: normalizeZzzLevelMap(passive?.materials || {}, itemsById, registerItem),
    sourceSnapshot: removeRemoteLinks(passive)
  });
}

function normalizeZzzLevelMap(levels, itemsById, registerItem) {
  return Object.fromEntries(toEntries(levels).map(([level, data]) => [
    level,
    removeEmpty({
      ...removeRemoteLinks(data),
      materials: normalizeMaterials(data?.materials || {}, itemsById, registerItem)
    })
  ]));
}

function zzzAssetPath(sourceRef) {
  return ensureWebp(assetStem(sourceRef));
}
