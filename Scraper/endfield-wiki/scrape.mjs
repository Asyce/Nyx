#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DATABASE_DIR,
  cleanText,
  databasePath,
  decodeEntities,
  diffRecords,
  downloadFile,
  ensureDir,
  extFromUrl,
  fetchJson,
  mapLimit,
  parseAttrs,
  readJson,
  safeSlug,
  stripTags,
  writeJson
} from '../lib/common.mjs';

const PROVIDER = 'EndfieldWiki';
const GAME_ID = 'endfield';
const GAME_NAME = 'Arknights: Endfield';
const WIKI_API = 'https://endfield.wiki.gg/api.php';
const WIKI_BASE = 'https://endfield.wiki.gg';
const WIKI_PAGE_BASE = 'https://endfield.wiki.gg/wiki/';

const CHAR_PROMOTION_HEADINGS = ['Promotion'];
const ITEM_BOX_RE = /<div class="item-bg item-bg-t(\d+)">[\s\S]*?<div class="item-tooltip"([^>]*)>[\s\S]*?<a href="\/wiki\/([^"#]+)"[\s\S]*?<img[^>]*src="([^"]+)"[\s\S]*?<div class="item-count">\s*([0-9.,KkMm]+)\s*<\/div>/g;

const CARGO_FIELDS = [
  '_pageName',
  'Operator',
  'Id',
  'Icon',
  'Banner',
  'Splash',
  'Portrait',
  'Gender',
  'Rarity',
  'Class',
  'Weapon',
  'Element',
  'Faction',
  'BirthMonth',
  'BirthDay',
  'BirthDate',
  'Tags',
  'MainAttr',
  'SubAttr',
  'Headhunting',
  'Description',
  'Quote',
  'Trait',
  'Expertise1',
  'Expertise2',
  'Hobby1',
  'Hobby2',
  'Prefer'
];

const ART_FIELDS = {
  icon: 'Icon',
  banner: 'Banner',
  splash: 'Splash',
  portrait: 'Portrait'
};

function parseArgs(argv) {
  const options = {
    databaseDir: process.env.NYXARIUM_DATABASE_DIR || DEFAULT_DATABASE_DIR,
    concurrency: 6,
    sample: null,
    skipAssets: false,
    forceAssets: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--database-dir') {
      options.databaseDir = path.resolve(takeValue(arg, next));
      i += 1;
    } else if (arg === '--concurrency') {
      options.concurrency = Number.parseInt(takeValue(arg, next), 10);
      i += 1;
    } else if (arg === '--sample') {
      options.sample = Number.parseInt(takeValue(arg, next), 10);
      i += 1;
    } else if (arg === '--skip-assets') {
      options.skipAssets = true;
    } else if (arg === '--force-assets') {
      options.forceAssets = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
    throw new Error('--concurrency must be a positive number');
  }

  if (options.sample !== null && (!Number.isFinite(options.sample) || options.sample < 1)) {
    throw new Error('--sample must be a positive number');
  }

  return options;
}

function takeValue(flag, value) {
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function printHelp() {
  console.log(`Usage:
  npm run endfield:wiki
  npm run endfield:wiki -- --sample 5
  npm run endfield:wiki -- --skip-assets

Options:
  --database-dir <path>   Database output directory.
  --concurrency <number>  Concurrent page and asset requests. Default: 6.
  --sample <number>       Limit operators for quick validation.
  --skip-assets           Write JSON only.
  --force-assets          Re-download existing assets.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const databaseDir = path.resolve(options.databaseDir);
  const outputDir = path.join(databaseDir, PROVIDER, GAME_ID);
  const rawDir = path.join(outputDir, 'raw');
  const assetRoot = path.join(outputDir, 'assets');
  const scrapedAt = new Date().toISOString();

  console.log(`[endfield-wiki] fetching Cargo Operators table + operator pages...`);
  let cargoRows = mergeOperatorRows(await fetchCargoOperators(), await fetchOperatorCategoryPages());
  cargoRows = cargoRows.sort(compareOperators);
  if (options.sample) cargoRows = cargoRows.slice(0, options.sample);

  console.log(`[endfield-wiki] resolving ${cargoRows.length} operator pages + image files...`);
  const pageData = await mapLimit(cargoRows, options.concurrency, async (row) => {
    const page = await fetchOperatorPage(row._pageName);
    return [operatorId(row), page];
  });
  const pagesById = Object.fromEntries(pageData);
  const unresolvedCategoryRows = cargoRows.filter((row) => row._categoryOnly && !pagesById[operatorId(row)]);
  if (unresolvedCategoryRows.length) {
    throw new Error(`Category-only operator page(s) did not resolve: ${unresolvedCategoryRows.map((row) => row.Operator).join(', ')}`);
  }
  await writeJson(path.join(rawDir, 'cargo-operators.json'), cargoRows.map(({ _categoryOnly, ...row }) => row));
  cargoRows = cargoRows.map((row) => enrichOperatorRow(row, pagesById[operatorId(row)]));
  const imageLookup = await fetchImageInfo(cargoRows);

  const assets = [];
  const missingAssets = [];
  const itemAssetsQueued = new Set();
  const itemsById = new Map();
  const materialReports = [];
  const characters = cargoRows.map((row) => normalizeOperator({
    row,
    page: pagesById[operatorId(row)],
    imageLookup,
    assetRoot,
    databaseDir,
    assets,
    missingAssets,
    itemAssetsQueued,
    itemsById,
    materialReports
  }));

  console.log(`[endfield-wiki] scraping weapon tuning materials...`);
  const weapons = await fetchWeapons({
    databaseDir,
    assets,
    itemAssetsQueued,
    itemsById,
    concurrency: options.concurrency,
    sample: options.sample
  });
  const items = [...itemsById.values()]
    .map(({ _assetQueued, ...item }) => item)
    .sort((a, b) => a.name.localeCompare(b.name));

  const assetSummary = options.skipAssets
    ? { requested: assets.length, skipped: assets.length, downloaded: 0, cached: 0, missing: 0 }
    : await downloadAssets(assets, options);

  await writeJson(path.join(outputDir, 'characters.json'), characters);
  await writeJson(path.join(outputDir, 'weapons.json'), {
    provider: PROVIDER,
    game: GAME_ID,
    gameName: GAME_NAME,
    scrapedAt,
    source: {
      site: 'endfield.wiki.gg',
      api: 'MediaWiki API rendered Weapon pages',
      index: wikiPageUrl('Weapon')
    },
    sample: options.sample || null,
    weapons
  });
  await writeJson(path.join(outputDir, 'items.json'), {
    provider: PROVIDER,
    game: GAME_ID,
    gameName: GAME_NAME,
    scrapedAt,
    source: {
      site: 'endfield.wiki.gg',
      api: 'MediaWiki API rendered item boxes'
    },
    sample: options.sample || null,
    items: Object.fromEntries(items.map((item) => [item.id, item]))
  });
  await writeJson(path.join(outputDir, 'material-report.json'), {
    provider: PROVIDER,
    game: GAME_ID,
    generatedAt: scrapedAt,
    counts: {
      characters: characters.length,
      charactersWithMaterials: characters.filter((ch) => ch.materials?.ascension?.length || ch.materials?.skill?.length).length,
      charactersMissingMaterials: materialReports.filter((row) => row.status !== 'ok').length,
      weapons: weapons.length,
      items: items.length
    },
    characters: materialReports.sort((a, b) => a.name.localeCompare(b.name))
  });
  await writeJson(path.join(outputDir, 'missing-assets.json'), missingAssets);

  const overview = {
    provider: PROVIDER,
    game: GAME_ID,
    gameName: GAME_NAME,
    scrapedAt,
    source: {
      site: 'endfield.wiki.gg',
      api: 'MediaWiki API + Cargo Operators table + Operators category',
      table: 'Operators'
    },
    sample: options.sample || null,
    counts: {
      characters: characters.length,
      charactersWithMaterials: characters.filter((ch) => ch.materials?.ascension?.length || ch.materials?.skill?.length).length,
      weapons: weapons.length,
      materialItems: items.length,
      assetsPlanned: assets.length,
      missingAssets: missingAssets.length
    },
    files: {
      characters: databasePath(PROVIDER, GAME_ID, 'characters.json'),
      weapons: databasePath(PROVIDER, GAME_ID, 'weapons.json'),
      items: databasePath(PROVIDER, GAME_ID, 'items.json'),
      materialReport: databasePath(PROVIDER, GAME_ID, 'material-report.json'),
      raw: databasePath(PROVIDER, GAME_ID, 'raw'),
      assets: databasePath(PROVIDER, GAME_ID, 'assets'),
      missingAssets: databasePath(PROVIDER, GAME_ID, 'missing-assets.json')
    },
    assets: assetSummary,
    notes: [
      'Banner and portrait art are optional on upstream wiki pages; missing files are reported without removing the operator.',
      'Operator Promotion, Skill upgrades, Talent upgrades, Base Skill upgrades, and weapon Tuning material counts are parsed from rendered wiki item boxes.',
      'Normalized data stores only local database-relative asset paths, not remote image URLs.'
    ]
  };
  await writeJson(path.join(outputDir, 'overview.json'), overview);

  const previousStateFile = path.join(databaseDir, PROVIDER, '_state', `${GAME_ID}-hashes.json`);
  const previousState = await readJson(previousStateFile, {});
  const { hashes, report } = diffRecords(previousState.hashes?.characters || {}, characters);
  const { hashes: weaponHashes, report: weaponReport } = diffRecords(previousState.hashes?.weapons || {}, weapons);
  const { hashes: itemHashes, report: itemReport } = diffRecords(previousState.hashes?.items || {}, items);
  const changes = {
    provider: PROVIDER,
    game: GAME_ID,
    generatedAt: scrapedAt,
    summary: {
      characters: {
        added: report.added.length,
        removed: report.removed.length,
        changed: report.changed.length,
        unchanged: report.unchanged
      },
      weapons: {
        added: weaponReport.added.length,
        removed: weaponReport.removed.length,
        changed: weaponReport.changed.length,
        unchanged: weaponReport.unchanged
      },
      items: {
        added: itemReport.added.length,
        removed: itemReport.removed.length,
        changed: itemReport.changed.length,
        unchanged: itemReport.unchanged
      }
    },
    sections: { characters: report, weapons: weaponReport, items: itemReport }
  };

  await writeJson(previousStateFile, {
    game: GAME_ID,
    updatedAt: scrapedAt,
    hashes: { characters: hashes, weapons: weaponHashes, items: itemHashes }
  });
  await writeJson(path.join(databaseDir, PROVIDER, 'changes', `${GAME_ID}-latest.json`), changes);
  await writeJson(path.join(outputDir, 'metadata.json'), {
    ...overview,
    changeReport: databasePath(PROVIDER, 'changes', `${GAME_ID}-latest.json`)
  });

  console.log(JSON.stringify({
    provider: PROVIDER,
    game: GAME_ID,
    output: databasePath(PROVIDER, GAME_ID),
    counts: overview.counts,
    assets: assetSummary,
    changes: changes.summary
  }, null, 2));
}

async function fetchCargoOperators() {
  const url = `${WIKI_API}?action=cargoquery&tables=Operators&fields=${encodeURIComponent(CARGO_FIELDS.join(','))}&limit=500&format=json`;
  const json = await fetchJson(url);
  const rows = (json?.cargoquery || []).map((entry) => entry.title || {});
  if (!rows.length) throw new Error('Cargo Operators query returned no rows');
  return rows;
}

async function fetchOperatorCategoryPages() {
  const pages = [];
  let cmcontinue = null;
  do {
    const continuation = cmcontinue ? `&cmcontinue=${encodeURIComponent(cmcontinue)}` : '';
    const url = `${WIKI_API}?action=query&list=categorymembers&cmtitle=Category%3AOperators&cmnamespace=0&cmlimit=max&format=json${continuation}`;
    const json = await fetchJson(url);
    pages.push(...(json?.query?.categorymembers || []).map((entry) => entry.title).filter(Boolean));
    cmcontinue = json?.continue?.cmcontinue || null;
  } while (cmcontinue);
  if (!pages.length) throw new Error('Operators category returned no pages');
  return pages;
}

function mergeOperatorRows(cargoRows, pageNames) {
  const rows = [...(cargoRows || [])];
  const seen = new Set(rows.map((row) => cleanText(row?._pageName || row?.Operator).toLowerCase()).filter(Boolean));
  for (const pageName of pageNames || []) {
    const name = cleanText(pageName);
    const key = name.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({ _pageName:name, Operator:name, _categoryOnly:true });
  }
  return rows;
}

async function fetchOperatorPage(pageName) {
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(pageName)}&prop=wikitext|displaytitle|text&format=json&disableeditsection=1`;
  const json = await fetchJson(url, { optional: true });
  if (!json || json.error) return null;
  const wikitext = json.parse?.wikitext?.['*'] || '';
  return {
    title: stripTags(json.parse?.displaytitle || pageName),
    pageName,
    upcoming: /^\s*\{\{Upcoming\b/im.test(wikitext),
    html: json.parse?.text?.['*'] || '',
    infobox: parseInfobox(wikitext),
    sections: parseWikiSections(wikitext)
  };
}

function enrichOperatorRow(row, page) {
  const { _categoryOnly, ...cleanRow } = row || {};
  const infobox = page?.infobox || {};
  const first = (...values) => values
    .filter((value) => value != null && String(value).trim().toLowerCase() !== 'null')
    .map((value) => cleanText(value)).find(Boolean) || '';
  const field = (name, ...aliases) => first(row?.[name], ...aliases.map((alias) => infobox[alias]));
  const name = field('Operator', 'name') || first(page?.title, row?._pageName) || 'Operator';
  return {
    ...cleanRow,
    _pageName:first(row?._pageName, page?.pageName, name),
    Operator:name,
    Id:field('Id', 'id'),
    Icon:field('Icon', 'icon') || `${name} icon.png`,
    Banner:field('Banner', 'banner'),
    Splash:field('Splash', 'image', 'splash'),
    Portrait:field('Portrait', 'portrait'),
    Gender:field('Gender', 'gender'),
    Rarity:field('Rarity', 'rarity'),
    Class:field('Class', 'class'),
    Weapon:field('Weapon', 'weapon'),
    Element:field('Element', 'element'),
    Faction:field('Faction', 'faction', 'authentication'),
    BirthDate:field('BirthDate', 'birthdate'),
    Tags:field('Tags', 'tags'),
    MainAttr:field('MainAttr', 'main', 'mainAttr'),
    SubAttr:field('SubAttr', 'sub', 'subAttr'),
    Headhunting:field('Headhunting', 'headhunting'),
    Description:field('Description', 'description'),
    Quote:field('Quote', 'quote'),
    Trait:field('Trait', 'trait'),
  };
}

async function fetchImageInfo(rows) {
  const candidates = [];
  for (const row of rows) {
    for (const cargoField of Object.values(ART_FIELDS)) {
      for (const title of fileCandidates(row[cargoField])) candidates.push(title);
    }
  }

  const uniqueTitles = [...new Set(candidates)];
  const lookup = new Map();
  for (let i = 0; i < uniqueTitles.length; i += 50) {
    const chunk = uniqueTitles.slice(i, i + 50);
    const url = `${WIKI_API}?action=query&titles=${encodeURIComponent(chunk.join('|'))}&prop=imageinfo&iiprop=url|size|mime&format=json`;
    const json = await fetchJson(url);
    for (const page of Object.values(json?.query?.pages || {})) {
      const info = page.imageinfo?.[0] || null;
      lookup.set(page.title, info ? {
        title: page.title,
        width: info.width ?? null,
        height: info.height ?? null,
        mime: info.mime ?? null,
        size: info.size ?? null,
        url: info.url
      } : null);
    }
  }

  return lookup;
}

function normalizeOperator({ row, page, imageLookup, assetRoot, databaseDir, assets, missingAssets, itemAssetsQueued, itemsById, materialReports }) {
  const id = operatorId(row);
  const name = cleanText(row.Operator);
  const art = {};

  for (const [kind, cargoField] of Object.entries(ART_FIELDS)) {
    const resolved = resolveImage(row[cargoField], imageLookup);
    if (!resolved?.url) {
      art[kind] = null;
      if (row[cargoField]) {
        missingAssets.push({
          id,
          name,
          kind,
          wikiFile: row[cargoField],
          reason: 'Referenced file does not currently resolve through the wiki image API.'
        });
      }
      continue;
    }

    const ext = extFromUrl(resolved.url, '.png');
    const localRel = path.join(PROVIDER, GAME_ID, 'assets', 'operators', id, `${kind}${ext}`);
    const localAbs = path.join(databaseDir, localRel);
    assets.push({ url: resolved.url, targetFile: localAbs, id, name, kind, localPath: databasePath(localRel) });
    art[kind] = {
      path: databasePath(localRel),
      file: row[cargoField],
      width: resolved.width,
      height: resolved.height,
      mime: resolved.mime
    };
  }

  const materialResult = parseOperatorMaterials(page, {
    characterId: id,
    characterName: name,
    databaseDir,
    assets,
    itemAssetsQueued,
    itemsById
  });
  materialReports.push(materialResult.report);

  return {
    id,
    contentStatus: page?.upcoming ? 'beta' : 'live',
    name,
    pageName: cleanText(row._pageName),
    gameId: cleanText(row.Id) || null,
    gender: cleanText(row.Gender) || null,
    rarity: numeric(row.Rarity),
    class: cleanText(row.Class) || null,
    weapon: cleanText(row.Weapon) || null,
    element: cleanText(row.Element) || null,
    faction: cleanText(row.Faction) || null,
    tags: splitList(row.Tags),
    mainAttribute: cleanText(row.MainAttr) || null,
    subAttribute: cleanText(row.SubAttr) || null,
    headhunting: cleanText(row.Headhunting) || null,
    birthDate: cleanText(row.BirthDate) || null,
    quote: cleanText(row.Quote) || null,
    description: cleanText(row.Description) || null,
    trait: cleanText(row.Trait) || null,
    expertise: [cleanText(row.Expertise1), cleanText(row.Expertise2)].filter(Boolean),
    hobbies: [cleanText(row.Hobby1), cleanText(row.Hobby2)].filter(Boolean),
    preferredWeapons: splitList(row.Prefer),
    materials: materialResult.materials,
    art,
    infobox: page?.infobox || {},
    sections: page?.sections || []
  };
}

function parseOperatorMaterials(page, context) {
  const html = page?.html || '';
  const report = {
    id: context.characterId,
    name: context.characterName,
    pageName: page?.pageName || page?.title || null,
    sourceUrl: page?.pageName ? wikiPageUrl(page.pageName) : null,
    status: 'missing-page',
    sections: {}
  };

  if (!html) return { materials: null, report };

  const promotionStagesRaw = [];
  for (const heading of CHAR_PROMOTION_HEADINGS) {
    const stages = parsePerStageTable(sectionSlice(html, heading), 4);
    report.sections[heading] = { stages: stages.length, items: stages.flat().length };
    promotionStagesRaw.push(...stages);
  }
  const promotionStages = promotionStagesRaw.map((stage) => materialEntriesFromItems(stage, 'promotion', context));
  const ascension = sumEntries(promotionStages.flat());

  const skillSlice = sectionSlice(html, 'Skill_upgrades');
  const skillRows = tableRows(skillSlice).filter((row) => row.includes('item-box-wrapper'));
  const skillLevelStages = [];
  const skillMasteryStages = [];
  const skillMasterySkillStages = [];
  for (let i = 0; i < Math.min(8, skillRows.length); i += 1) {
    skillLevelStages.push(materialEntriesFromItems(parseItemBoxes(skillRows[i]), 'skill', context));
  }
  for (let i = 8; i < Math.min(11, skillRows.length); i += 1) {
    const allItems = parseItemBoxes(skillRows[i]);
    const cells = tableCells(skillRows[i]).filter((cell) => cell.includes('item-box-wrapper'));
    skillMasteryStages.push(sumEntries(materialEntriesFromItems(allItems, 'skill', context)));
    skillMasterySkillStages.push(cells.map((cell) => sumEntries(materialEntriesFromItems(parseItemBoxes(cell), 'skill', context))));
  }
  report.sections.Skill_upgrades = {
    rows: skillRows.length,
    skillLevelStages: skillLevelStages.length,
    skillMasteryStages: skillMasteryStages.length,
    items: skillRows.reduce((sum, row) => sum + parseItemBoxes(row).length, 0)
  };

  const extrasEntries = [];
  for (const heading of ['Talent_upgrades', 'Base_Skill_upgrades']) {
    const items = parseItemBoxes(sectionSlice(html, heading));
    const entries = materialEntriesFromItems(items, 'skill', context);
    extrasEntries.push(...entries);
    report.sections[heading] = { items: entries.length };
  }
  const extras = sumEntries(extrasEntries);

  const skillFlat = [];
  const combatSkillCount = Math.max(1, skillMasterySkillStages[0]?.length || 4);
  for (const stage of skillLevelStages) {
    for (const entry of stage) skillFlat.push({ ...entry, count: entry.count * combatSkillCount });
  }
  for (const stage of skillMasteryStages) skillFlat.push(...stage);
  skillFlat.push(...extrasEntries);
  const skill = sumEntries(skillFlat);

  const materials = ascension.length || skill.length
    ? {
        ascension,
        skill,
        promotionStages,
        skillLevelStages,
        skillMasteryStages,
        skillMasterySkillStages,
        extras,
        combatSkillCount
      }
    : null;

  report.status = materials ? 'ok' : 'missing-materials';
  report.counts = {
    ascension: ascension.length,
    skill: skill.length,
    extras: extras.length
  };

  return { materials, report };
}

async function fetchWeapons({ databaseDir, assets, itemAssetsQueued, itemsById, concurrency, sample }) {
  const slugs = await fetchWikiSlugList('Weapon');
  const skipExact = new Set([
    'Operator', 'Gear', 'Attribute', 'Stagger', 'Arsenal_Exchange',
    'Stock_Redistribution', 'T-Creds', 'Arms_Inspector', 'Arms_INSP_Kit',
    'Arms_INSP_Set', 'Cast_Die', 'Kalkonyx', 'Auronyx', 'Heavy_Cast_Die',
    'Umbronyx', 'Protocolized_Weapon_Pattern', 'Essence'
  ]);
  const candidates = slugs.filter((slug) => !skipExact.has(slug));
  const limited = sample ? candidates.slice(0, sample) : candidates;
  const parsed = await mapLimit(limited, concurrency, async (slug) => parseWeapon(slug, {
    databaseDir,
    assets,
    itemAssetsQueued,
    itemsById
  }));
  return parsed
    .filter(Boolean)
    .sort((a, b) => raritySort(b.rarity) - raritySort(a.rarity) || a.name.localeCompare(b.name));
}

async function fetchWikiSlugList(indexPage) {
  const html = await fetchWikiHtml(indexPage);
  if (!html) return [];
  const slugs = new Set();
  const re = /href="\/wiki\/([^"#:?]+)"/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const slug = decodeURIComponent(match[1]);
    if (slug.includes('/')) continue;
    if (/^[a-z]/.test(slug)) continue;
    slugs.add(slug);
  }
  return [...slugs];
}

async function fetchWikiHtml(pageTitle) {
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(pageTitle)}&prop=text&format=json&disableeditsection=1`;
  const json = await fetchJson(url, { optional: true });
  if (!json || json.error) return null;
  return json.parse?.text?.['*'] || '';
}

async function parseWeapon(slug, context) {
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(slug)}&prop=text|wikitext|displaytitle&format=json&disableeditsection=1`;
  const json = await fetchJson(url, { optional: true });
  if (!json || json.error) return null;
  const html = json.parse?.text?.['*'] || '';
  const tuningSlice = sectionSlice(html, 'Tuning');
  if (!tuningSlice) return null;
  const tuningStagesRaw = parsePerStageTable(tuningSlice, 4);
  if (!tuningStagesRaw.length) return null;

  const wikitext = json.parse?.wikitext?.['*'] || '';
  const infobox = parseTemplateInfobox(wikitext, 'Weapon infobox');
  const name = cleanText(stripTags(json.parse?.displaytitle || '')) || cleanText(infobox.name) || slug.replace(/_/g, ' ');
  const iconUrl = firstWeaponIconUrl(html, slug);
  const icon = iconUrl ? queueLocalAsset({
    url: iconUrl,
    databaseDir: context.databaseDir,
    assets: context.assets,
    relParts: [PROVIDER, GAME_ID, 'assets', 'weapons', safeSlug(slug), `icon${extFromUrl(iconUrl, '.png')}`],
    id: slug,
    name,
    kind: 'weapon'
  }) : null;

  const tuningStages = tuningStagesRaw.map((stage) => materialEntriesFromItems(stage, 'weapon', context));
  const materials = sumEntries(tuningStages.flat());
  return {
    id: slug,
    name,
    pageName: slug,
    sourceUrl: wikiPageUrl(slug),
    rarity: numeric(infobox.rarity) || extractWeaponRarity(html),
    weaponType: cleanText(infobox.type) || null,
    source: cleanText(infobox.source) || null,
    icon,
    materials,
    tuningStages
  };
}

function materialEntriesFromItems(items, fallbackKind, context) {
  return (items || []).map((item) => {
    const registered = registerItem(context.itemsById, item, { ...context, fallbackKind });
    return { id: registered.id, count: item.count };
  });
}

function registerItem(itemsById, item, context) {
  const id = item.slug || item.id || safeSlug(item.name || 'item');
  const name = cleanText(item.name || id.replace(/_/g, ' '));
  const iconUrl = item.iconUrl ? wikiImageOriginalUrl(item.iconUrl) : null;
  const existing = itemsById.get(id);
  const source = cleanText(item.source) || null;
  const kind = inferItemKind({ ...item, source }, context.fallbackKind);
  const next = existing || {
    id,
    name,
    pageName: id,
    sourceUrl: wikiPageUrl(id),
    rarity: item.rarity || item.tier || null,
    kind,
    source,
    icon: null
  };

  if (!next.source && source) next.source = source;
  if (!next.kind || next.kind === 'item') next.kind = kind;
  if (!next.rarity && (item.rarity || item.tier)) next.rarity = item.rarity || item.tier;
  if (!next.icon && iconUrl) {
    next.icon = queueLocalAsset({
      url: iconUrl,
      databaseDir: context.databaseDir,
      assets: context.assets,
      queued: context.itemAssetsQueued,
      relParts: [PROVIDER, GAME_ID, 'assets', 'items', `${safeSlug(id)}${extFromUrl(iconUrl, '.png')}`],
      id,
      name,
      kind: 'item'
    });
  }

  itemsById.set(id, next);
  return next;
}

function queueLocalAsset({ url, databaseDir, assets, queued = null, relParts, id, name, kind }) {
  const rel = path.join(...relParts);
  const localPath = databasePath(rel);
  const key = `${kind}:${localPath}`;
  if (!queued || !queued.has(key)) {
    assets.push({ url, targetFile: path.join(databaseDir, rel), id, name, kind, localPath });
    if (queued) queued.add(key);
  }
  return { path: localPath, url };
}

function sectionSlice(html, headingId) {
  if (!html) return null;
  const re = new RegExp(`<h[23][^>]*><span[^>]*id="${escapeRegExp(headingId)}"`, 'i');
  const match = html.match(re);
  if (!match) return null;
  const start = match.index;
  const after = html.slice(start + match[0].length);
  const next = after.match(/<h[23][^>]*><span[^>]*id="/i);
  const end = next ? start + match[0].length + next.index : html.length;
  return html.slice(start, end);
}

function parsePerStageTable(sliceHtml, expectedStages = 4) {
  const table = firstTable(sliceHtml);
  if (!table) return [];
  return tableRows(table)
    .filter((row) => row.includes('item-box-wrapper'))
    .slice(0, expectedStages)
    .map((row) => parseItemBoxes(row));
}

function parseItemBoxes(sliceHtml) {
  const out = [];
  if (!sliceHtml) return out;
  let match;
  ITEM_BOX_RE.lastIndex = 0;
  while ((match = ITEM_BOX_RE.exec(sliceHtml)) !== null) {
    const attrs = parseAttrs(`<div${match[2]}>`);
    const count = parseCount(match[5]);
    if (!Number.isFinite(count) || count <= 0) continue;
    const slug = decodeURIComponent(match[3]);
    out.push({
      slug,
      name: cleanText(attrs['data-name'] || slug.replace(/_/g, ' ')),
      rarity: numeric(attrs['data-tier']) || Number(match[1]) || null,
      source: cleanText(attrs['data-obtain'] || ''),
      iconUrl: normalizeWikiUrl(match[4]),
      count
    });
  }
  return out;
}

function tableRows(html = '') {
  return [...String(html || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((row) => row[1]);
}

function tableCells(html = '') {
  return [...String(html || '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]);
}

function firstTable(html = '') {
  return String(html || '').match(/<table[\s\S]*?<\/table>/)?.[0] || null;
}

function sumEntries(entries) {
  const totals = new Map();
  for (const entry of entries || []) {
    if (!entry?.id) continue;
    totals.set(entry.id, (totals.get(entry.id) || 0) + Number(entry.count || 0));
  }
  return [...totals.entries()]
    .filter(([, count]) => count > 0)
    .map(([id, count]) => ({ id, count }));
}

function parseCount(raw) {
  const match = String(raw || '').replace(/,/g, '').trim().match(/^([\d.]+)([KkMm]?)$/);
  if (!match) return null;
  let count = Number.parseFloat(match[1]);
  if (!Number.isFinite(count)) return null;
  const suffix = match[2].toLowerCase();
  if (suffix === 'k') count *= 1_000;
  if (suffix === 'm') count *= 1_000_000;
  return Math.round(count);
}

function inferItemKind(item, fallback = 'item') {
  const name = cleanText(item.name || item.slug);
  const source = cleanText(item.source || '');
  if (/^T-Creds$/i.test(name) || /\bT-Creds\b/i.test(source)) return 'currency';
  if (/Area found|Rare (Gathering|Mining) Sites|Growth Chamber|Production/i.test(source)) return 'specialty';
  if (/Weapon Tune/i.test(source) || fallback === 'weapon') return 'weapon';
  if (/Skill Up/i.test(source)) return 'book';
  if (/Promotions/i.test(source) || fallback === 'promotion') return 'gem';
  return fallback || 'item';
}

function firstWeaponIconUrl(html, slug) {
  const expectedAlt = `${slug.replace(/_/g, ' ')} icon.png`.toLowerCase();
  const imgRe = /<img\b[^>]*>/gi;
  let match;
  while ((match = imgRe.exec(String(html || ''))) !== null) {
    const attrs = parseAttrs(match[0]);
    const src = attrs.src || '';
    const alt = cleanText(attrs.alt || '').toLowerCase();
    if (src && alt === expectedAlt) return wikiImageOriginalUrl(src);
  }
  imgRe.lastIndex = 0;
  while ((match = imgRe.exec(String(html || ''))) !== null) {
    const attrs = parseAttrs(match[0]);
    const src = attrs.src || '';
    const alt = cleanText(attrs.alt || '');
    if (src && /_icon\.png/i.test(src) && / icon\.png$/i.test(alt)) return wikiImageOriginalUrl(src);
  }
  return null;
}

function extractWeaponRarity(html) {
  const match = String(html || '').match(/Rarity_(\d)\.png/i) || String(html || '').match(/Rarity[\s\S]{0,80}?(\d)\s*★/i);
  return match ? Number(match[1]) : null;
}

function wikiImageOriginalUrl(raw) {
  const url = normalizeWikiUrl(raw);
  return url
    .replace('/images/thumb/', '/images/')
    .replace(/\/\d+px-[^/?#]+(?=([?#]|$))/, '');
}

function normalizeWikiUrl(raw) {
  if (!raw) return null;
  try {
    return new URL(decodeEntities(raw), WIKI_BASE).href;
  } catch {
    return null;
  }
}

function wikiPageUrl(title) {
  return WIKI_PAGE_BASE + encodeURIComponent(String(title || '').replace(/ /g, '_')).replace(/%2F/g, '/');
}

function raritySort(value) {
  return Number(value) || 0;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function downloadAssets(assets, options) {
  const results = await mapLimit(assets, options.concurrency, async (asset) => {
    const result = await downloadFile(asset.url, asset.targetFile, {
      force: options.forceAssets,
      optional: true
    });
    return { asset, result };
  });

  return {
    requested: results.length,
    downloaded: results.filter(({ result }) => result.status === 'downloaded').length,
    cached: results.filter(({ result }) => result.status === 'cached').length,
    missing: results.filter(({ result }) => result.status === 'missing').length
  };
}

function operatorId(row) {
  const name = row.Operator || row._pageName || 'operator';
  const gender = cleanText(row.Gender).toLowerCase();
  const suffix = row.Operator === 'Endministrator' && gender ? `-${gender}` : '';
  return safeSlug(`${name}${suffix}`, 'operator');
}

function compareOperators(left, right) {
  const rarity = Number(right.Rarity || 0) - Number(left.Rarity || 0);
  if (rarity) return rarity;
  return String(left.Operator || '').localeCompare(String(right.Operator || ''));
}

function fileCandidates(raw) {
  if (!raw || !String(raw).trim()) return [];
  const value = String(raw).trim();
  const variants = new Set([
    value,
    value.replace(/_\s+/g, '_'),
    value.replace(/\s+/g, '_'),
    value.replace(/_/g, ' '),
    value.replace(/_\s+/g, '_').replace(/_/g, ' ')
  ]);
  return [...variants].map((entry) => `File:${entry}`);
}

function resolveImage(raw, lookup) {
  for (const candidate of fileCandidates(raw)) {
    const normalized = candidate.replace(/_/g, ' ');
    const direct = lookup.get(candidate) || lookup.get(normalized);
    if (direct) return direct;
    for (const [title, info] of lookup.entries()) {
      if (info && title === normalized) return info;
    }
  }
  return null;
}

function parseInfobox(wikitext) {
  return parseTemplateInfobox(wikitext, 'Operator infobox');
}

function parseTemplateInfobox(wikitext, templateName) {
  const start = wikitext.indexOf(`{{${templateName}`);
  if (start < 0) return {};
  const end = findTemplateEnd(wikitext, start);
  const body = wikitext.slice(start, end > start ? end : start + 8000);
  const out = {};
  let currentKey = null;

  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^\|([^=]+?)\s*=\s*(.*)$/);
    if (match) {
      currentKey = safeKey(match[1]);
      out[currentKey] = wikiToText(match[2].replace(/\}\}\s*$/, ''));
    } else if (currentKey && line.trim()) {
      out[currentKey] = [out[currentKey], wikiToText(line)].filter(Boolean).join('\n').trim();
    }
  }

  return out;
}

function findTemplateEnd(wikitext, start) {
  let depth = 0;
  for (let i = start; i < wikitext.length - 1; i += 1) {
    const pair = wikitext.slice(i, i + 2);
    if (pair === '{{') {
      depth += 1;
      i += 1;
    } else if (pair === '}}') {
      depth -= 1;
      i += 1;
      if (depth <= 0) return i + 1;
    }
  }
  return -1;
}

function parseWikiSections(wikitext) {
  const sections = [];
  const headingRe = /^==+\s*([^=\n]+?)\s*==+\s*$/gm;
  const headings = [];
  let match;
  while ((match = headingRe.exec(wikitext)) !== null) {
    headings.push({ title: cleanText(match[1]), start: match.index, end: headingRe.lastIndex });
  }

  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i];
    const next = headings[i + 1];
    const raw = wikitext.slice(current.end, next ? next.start : wikitext.length);
    const text = wikiToText(raw);
    if (text) sections.push({ heading: current.title, text });
  }

  return sections;
}

function wikiToText(value = '') {
  return stripTags(decodeEntities(String(value)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\{\{Color\|([^|}]+)(?:\|[^}]*)?\}\}/g, '$1')
    .replace(/\{\{G\|([^|}]+)(?:\|[^}]*)?\}\}/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, '$1')
    .replace(/'''?/g, '')))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitList(value) {
  return cleanText(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function numeric(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function safeKey(value) {
  return String(value).trim().replace(/[^A-Za-z0-9]+(.)/g, (_, c) => c.toUpperCase());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

export { enrichOperatorRow, mergeOperatorRows };
