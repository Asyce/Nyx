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
} from '../lib/gamedata-game.mjs';

const config = {
  gameId: 'gi',
  gameName: 'Genshin Impact',
  outputRoot: 'GameData/gi',
  assetPath: genshinAssetPath,
  rawLists: {
    characters: { file: 'character.json' },
    weapons: { file: 'weapon.json' },
    artifacts: { file: 'artifact.json' },
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
      key: 'artifacts',
      listKey: 'artifacts',
      detailType: 'artifact',
      outputFile: 'artifacts.json',
      normalize: normalizeArtifact
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

export async function scrapeGenshin(options) {
  return scrapeConfiguredGame(options, config);
}

function normalizeCharacter({ id, summary, detail, channel, lists, assetBag }) {
  const itemsById = lists.itemAll || lists.items || {};
  const icon = detail?.icon || summary?.icon;
  const registerItem = (itemIcon) => registerAsset(assetBag, config, 'items', itemIcon);

  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name: detail?.name || text(summary?.en) || String(id),
    rarity: parseRarity(detail?.rarity || summary?.rank),
    rarityRaw: detail?.rarity || summary?.rank || null,
    weapon: detail?.weapon || summary?.weapon || null,
    element: detail?.element || summary?.element || null,
    description: detail?.desc || summary?.desc || null,
    release: detail?.chara_info?.release_date || summary?.release || null,
    birthday: detail?.chara_info?.birth || summary?.birth || null,
    assets: {
      icon: registerAsset(assetBag, config, 'characters/icons', icon),
      gacha: icon ? registerAsset(assetBag, config, 'characters/gacha', icon.replace('UI_AvatarIcon_', 'UI_Gacha_AvatarImg_')) : null,
      card: icon ? registerAsset(assetBag, config, 'characters/cards', `${icon}_Card`) : null,
      circle: icon ? registerAsset(assetBag, config, 'characters/circles', `${icon}_Circle`) : null
    },
    profile: removeRemoteLinks(detail?.chara_info || null),
    stats: removeRemoteLinks({
      staminaRecovery: detail?.stamina_recovery ?? null,
      baseHp: detail?.base_hp ?? null,
      baseAtk: detail?.base_atk ?? null,
      baseDef: detail?.base_def ?? null,
      critRate: detail?.crit_rate ?? null,
      critDmg: detail?.crit_dmg ?? null,
      elementalMastery: detail?.elemental_mastery ?? null,
      levelExp: detail?.level_exp || [],
      modifiers: detail?.stats_modifier || null
    }),
    skills: normalizeSkills(detail?.skills || [], assetBag),
    passives: normalizeTalents(detail?.passives || [], 'passives', assetBag),
    constellations: normalizeTalents(detail?.constellations || [], 'constellations', assetBag),
    materials: normalizeGenshinMaterials(detail?.materials || {}, itemsById, registerItem),
    sourceSnapshot: removeRemoteLinks({ summary, detail })
  });
}

function normalizeWeapon({ id, summary, detail, channel, lists, assetBag }) {
  const itemsById = lists.itemAll || lists.items || {};
  const icon = detail?.icon || summary?.icon;
  const registerItem = (itemIcon) => registerAsset(assetBag, config, 'items', itemIcon);

  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name: detail?.name || text(summary?.en) || String(id),
    rarity: parseRarity(detail?.rarity ?? summary?.rank),
    type: detail?.weapon_type || summary?.type || null,
    description: detail?.desc || summary?.desc || null,
    attack: summary?.atk ?? null,
    subStat: summary?.sub || null,
    assets: {
      icon: registerAsset(assetBag, config, 'weapons/icons', icon),
      gacha: icon ? registerAsset(assetBag, config, 'weapons/gacha', icon.replace('EquipIcon', 'Gacha_EquipIcon')) : null
    },
    properties: removeRemoteLinks(detail?.weapon_prop || []),
    stats: removeRemoteLinks(detail?.stats_modifier || {}),
    xpRequirements: removeRemoteLinks(detail?.xp_requirements || {}),
    ascensions: removeRemoteLinks(detail?.ascension || {}),
    refinements: removeRemoteLinks(detail?.refinement || {}),
    materials: normalizeGenshinMaterials(detail?.materials || {}, itemsById, registerItem),
    story: removeRemoteLinks(detail?.story || {}),
    sourceSnapshot: removeRemoteLinks({ summary, detail })
  });
}

function normalizeArtifact({ id, summary, detail, channel, assetBag }) {
  const setName = detail?.affix?.[0]?.name || text(Object.values(summary?.set || {})[0]?.name) || String(id);
  const icon = detail?.icon || summary?.icon;

  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name: setName,
    rarity: detail?.rank || summary?.rank || [],
    type: 'artifact set',
    assets: {
      icon: registerAsset(assetBag, config, 'artifacts/sets', icon)
    },
    setEffects: normalizeArtifactEffects(detail?.affix || summary?.set || []),
    parts: normalizeArtifactParts(detail?.parts || {}, assetBag),
    sourceSnapshot: removeRemoteLinks({ summary, detail })
  });
}

function normalizeMonster({ id, summary, detail, channel, assetBag }) {
  const icon = detail?.icon || summary?.icon;

  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name: detail?.name || text(summary?.en) || String(id),
    rarity: detail?.rarity || summary?.rarity || null,
    type: detail?.codex || summary?.codex || null,
    title: detail?.title || null,
    description: detail?.desc || summary?.desc || null,
    assets: {
      icon: registerAsset(assetBag, config, 'monsters', icon)
    },
    rewards: removeRemoteLinks(detail?.reward || []),
    child: removeRemoteLinks(detail?.child || null),
    sourceSnapshot: removeRemoteLinks({ summary, detail })
  });
}

function normalizeItem({ id, summary, channel, assetBag }) {
  return removeEmpty({
    id: String(id),
    contentStatus: channel === 'live' ? 'live' : 'beta',
    name: summary?.name || String(id),
    rarity: summary?.rank ?? summary?.rarity ?? null,
    type: summary?.type || summary?.item_type || summary?.material_type || null,
    description: summary?.desc || null,
    effect: summary?.effect || null,
    assets: {
      icon: registerAsset(assetBag, config, 'items', summary?.icon)
    },
    sourceSnapshot: removeRemoteLinks(summary)
  });
}

function normalizeSkills(skills, assetBag) {
  return skills.map((skill) => removeEmpty({
    id: String(skill.id ?? ''),
    name: skill.name || null,
    description: skill.desc || null,
    assets: {
      icon: registerAsset(assetBag, config, 'skills', firstPromoteIcon(skill))
    },
    levels: toEntries(skill.promote || {}).map(([level, data]) => removeEmpty({
      key: level,
      level: data?.level ?? Number(level) + 1,
      description: data?.desc || [],
      params: data?.param || [],
      assets: {
        icon: registerAsset(assetBag, config, 'skills', data?.icon)
      },
      sourceSnapshot: removeRemoteLinks(data)
    })),
    sourceSnapshot: removeRemoteLinks(skill)
  }));
}

function normalizeTalents(talents, category, assetBag) {
  return talents.map((talent, index) => removeEmpty({
    key: String(talent.id ?? index + 1),
    id: talent.id ? String(talent.id) : null,
    name: talent.name || null,
    description: talent.desc || null,
    params: talent.param_list || [],
    assets: {
      icon: registerAsset(assetBag, config, category, talent.icon)
    },
    sourceSnapshot: removeRemoteLinks(talent)
  }));
}

function normalizeGenshinMaterials(materials, itemsById, registerItem) {
  if (!materials || typeof materials !== 'object') {
    return {};
  }

  return Object.fromEntries(Object.entries(materials).map(([key, value]) => {
    if (Array.isArray(value)) {
      return [key, value.map((group, index) => removeEmpty({
        key: String(index + 1),
        cost: group?.cost ?? null,
        materials: normalizeMaterials(group?.mats || [], itemsById, registerItem),
        sourceSnapshot: removeRemoteLinks(group)
      }))];
    }

    if (value && typeof value === 'object') {
      // Weapon ascension stages arrive as a single group { mats:[...], cost:<number> }
      // keyed by stage number. The per-level iteration below was written for a
      // legacy { level:{mats,cost} } shape and silently dropped weapon materials
      // (it read group.mats off the mats ARRAY / cost NUMBER, getting undefined).
      // Normalize the group directly when it looks like { mats:[...], cost:N }.
      if (Array.isArray(value.mats) || typeof value.cost === 'number') {
        return [key, removeEmpty({
          cost: value?.cost ?? null,
          materials: normalizeMaterials(value?.mats || [], itemsById, registerItem),
          sourceSnapshot: removeRemoteLinks(value)
        })];
      }
      return [key, Object.fromEntries(Object.entries(value).map(([level, group]) => [level, removeEmpty({
        level,
        cost: group?.cost ?? null,
        materials: normalizeMaterials(group?.mats || [], itemsById, registerItem),
        sourceSnapshot: removeRemoteLinks(group)
      })]))];
    }

    return [key, removeRemoteLinks(value)];
  }));
}

function normalizeArtifactEffects(effects) {
  if (Array.isArray(effects)) {
    return effects.map((effect) => removeEmpty({
      id: effect.affix_id ? String(effect.affix_id) : null,
      pieces: effect.level === 0 ? 2 : 4,
      name: effect.name || null,
      description: effect.desc || null,
      params: effect.param_list || [],
      addProps: effect.add_props || [],
      sourceSnapshot: removeRemoteLinks(effect)
    }));
  }

  return toEntries(effects).map(([key, effect]) => removeEmpty({
    id: String(key),
    name: text(effect?.name) || null,
    description: text(effect?.desc) || null,
    sourceSnapshot: removeRemoteLinks(effect)
  }));
}

function normalizeArtifactParts(parts, assetBag) {
  return toEntries(parts).map(([slot, part]) => removeEmpty({
    slot,
    name: part?.name || null,
    description: part?.desc || null,
    story: removeRemoteLinks(part?.story || null),
    assets: {
      icon: registerAsset(assetBag, config, 'artifacts/parts', part?.icon)
    },
    sourceSnapshot: removeRemoteLinks(part)
  }));
}

function firstPromoteIcon(skill) {
  const first = Object.values(skill?.promote || {})[0];
  return first?.icon || null;
}

function genshinAssetPath(sourceRef) {
  return ensureWebp(assetStem(sourceRef));
}
