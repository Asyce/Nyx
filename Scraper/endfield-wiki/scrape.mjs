#!/usr/bin/env node

import path from 'node:path';
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
  readJson,
  safeSlug,
  stripTags,
  writeJson
} from '../lib/common.mjs';

const PROVIDER = 'EndfieldWiki';
const GAME_ID = 'endfield';
const GAME_NAME = 'Arknights: Endfield';
const WIKI_API = 'https://endfield.wiki.gg/api.php';
const WIKI_PAGE_BASE = 'https://endfield.wiki.gg/wiki/';

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

  console.log(`[endfield-wiki] fetching Cargo Operators table...`);
  let cargoRows = await fetchCargoOperators();
  cargoRows = cargoRows.sort(compareOperators);
  if (options.sample) cargoRows = cargoRows.slice(0, options.sample);
  await writeJson(path.join(rawDir, 'cargo-operators.json'), cargoRows);

  console.log(`[endfield-wiki] resolving ${cargoRows.length} operator pages + image files...`);
  const imageLookup = await fetchImageInfo(cargoRows);
  const pageData = await mapLimit(cargoRows, options.concurrency, async (row) => {
    const page = await fetchOperatorPage(row._pageName);
    return [operatorId(row), page];
  });
  const pagesById = Object.fromEntries(pageData);

  const assets = [];
  const missingAssets = [];
  const characters = cargoRows.map((row) => normalizeOperator({
    row,
    page: pagesById[operatorId(row)],
    imageLookup,
    assetRoot,
    databaseDir,
    assets,
    missingAssets
  }));

  const assetSummary = options.skipAssets
    ? { requested: assets.length, skipped: assets.length, downloaded: 0, cached: 0, missing: 0 }
    : await downloadAssets(assets, options);

  await writeJson(path.join(outputDir, 'characters.json'), characters);
  await writeJson(path.join(outputDir, 'missing-assets.json'), missingAssets);

  const overview = {
    provider: PROVIDER,
    game: GAME_ID,
    gameName: GAME_NAME,
    scrapedAt,
    source: {
      site: 'endfield.wiki.gg',
      api: 'MediaWiki API + Cargo Operators table',
      table: 'Operators'
    },
    sample: options.sample || null,
    counts: {
      characters: characters.length,
      assetsPlanned: assets.length,
      missingAssets: missingAssets.length
    },
    files: {
      characters: databasePath(PROVIDER, GAME_ID, 'characters.json'),
      raw: databasePath(PROVIDER, GAME_ID, 'raw'),
      assets: databasePath(PROVIDER, GAME_ID, 'assets'),
      missingAssets: databasePath(PROVIDER, GAME_ID, 'missing-assets.json')
    },
    assets: assetSummary,
    notes: [
      'Banner and portrait art are optional on upstream wiki pages; missing files are reported without removing the operator.',
      'Normalized data stores only local database-relative asset paths, not remote image URLs.'
    ]
  };
  await writeJson(path.join(outputDir, 'overview.json'), overview);

  const previousStateFile = path.join(databaseDir, PROVIDER, '_state', `${GAME_ID}-hashes.json`);
  const previousState = await readJson(previousStateFile, {});
  const { hashes, report } = diffRecords(previousState.hashes?.characters || {}, characters);
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
      }
    },
    sections: { characters: report }
  };

  await writeJson(previousStateFile, {
    game: GAME_ID,
    updatedAt: scrapedAt,
    hashes: { characters: hashes }
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

async function fetchOperatorPage(pageName) {
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(pageName)}&prop=wikitext|displaytitle&format=json&disableeditsection=1`;
  const json = await fetchJson(url, { optional: true });
  if (!json || json.error) return null;
  const wikitext = json.parse?.wikitext?.['*'] || '';
  return {
    title: stripTags(json.parse?.displaytitle || pageName),
    infobox: parseInfobox(wikitext),
    sections: parseWikiSections(wikitext)
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

function normalizeOperator({ row, page, imageLookup, assetRoot, databaseDir, assets, missingAssets }) {
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

  return {
    id,
    contentStatus: 'live',
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
    art,
    infobox: page?.infobox || {},
    sections: page?.sections || []
  };
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
  const start = wikitext.indexOf('{{Operator infobox');
  if (start < 0) return {};
  const end = wikitext.indexOf('\n}}', start);
  const body = wikitext.slice(start, end > start ? end : start + 8000);
  const out = {};
  let currentKey = null;

  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^\|([^=]+?)\s*=\s*(.*)$/);
    if (match) {
      currentKey = safeKey(match[1]);
      out[currentKey] = wikiToText(match[2]);
    } else if (currentKey && line.trim()) {
      out[currentKey] = [out[currentKey], wikiToText(line)].filter(Boolean).join('\n').trim();
    }
  }

  return out;
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

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
