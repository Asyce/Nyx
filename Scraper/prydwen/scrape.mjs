#!/usr/bin/env node

import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  DEFAULT_DATABASE_DIR,
  cleanText,
  databasePath,
  decodeEntities,
  diffRecords,
  downloadFile,
  ensureDir,
  extFromUrl,
  extractImages,
  fetchText,
  mapLimit,
  parseAttrs,
  readJson,
  safeSlug,
  shortHash,
  stripTags,
  uniqueBy,
  writeJson
} from '../lib/common.mjs';

const PROVIDER = 'Prydwen';
const BASE = 'https://www.prydwen.gg';
const PRYDWEN_PAGE_DELAY_MS = 250;
let prydwenFetchGate = Promise.resolve();

const GAMES = {
  hsr: {
    id: 'hsr',
    aliases: ['star-rail', 'honkai-star-rail'],
    name: 'Honkai: Star Rail',
    basePath: '/star-rail',
    assetIncludes: ['/images/honkai-star-rail/'],
    recommendationHeadings: [
      'Best Light Cones',
      'Best Relic Sets',
      'Best Planetary Sets',
      'Best Stats',
      'Recommended endgame stats',
      'Traces priority',
      'Synergy',
      'Teams'
    ],
    collections: [
      collection('characters', 'Characters', '/star-rail/characters', '/star-rail/characters/', true, ['characters']),
      collection('light-cones', 'Light Cones', '/star-rail/light-cones', '/star-rail/light-cones/', false, ['light-cones']),
      collection('relic-sets', 'Relic Sets', '/star-rail/guides/relic-sets', '/star-rail/guides/relic-sets/', false, ['relics'])
    ]
  },
  ww: {
    id: 'ww',
    aliases: ['wuwa', 'wuthering-waves'],
    name: 'Wuthering Waves',
    basePath: '/wuthering-waves',
    assetIncludes: ['/images/wuthering-waves/', '/images/ww/'],
    recommendationHeadings: [
      'Best Weapons',
      'Best Echo Sets',
      'Best Echo Stats',
      'Best Endgame Stats',
      'Skill Priority',
      'Rotation',
      'Synergies',
      'Example Teams'
    ],
    collections: [
      collection('characters', 'Characters', '/wuthering-waves/characters', '/wuthering-waves/characters/', true, ['characters']),
      collection('weapons', 'Weapons', '/wuthering-waves/weapons', '/wuthering-waves/weapons/', false, ['weapons']),
      collection('echoes', 'Echoes', '/wuthering-waves/echoes', '/wuthering-waves/echoes/', false, ['echoes', 'sets'])
    ]
  },
  zzz: {
    id: 'zzz',
    aliases: ['zenless', 'zenless-zone-zero'],
    name: 'Zenless Zone Zero',
    basePath: '/zenless',
    assetIncludes: ['/images/zenless-zone-zero/'],
    recommendationHeadings: [
      'Best W-Engines',
      'Best Disk Drives Sets',
      'Best Disk Drives Stats',
      'Best Endgame Stats',
      'Skill priority',
      'Synergy',
      'Teams',
      'Teams (Shiyu Defense)',
      'Teams (Deadly Assault)'
    ],
    collections: [
      collection('characters', 'Agents', '/zenless/characters', '/zenless/characters/', true, ['characters']),
      collection('w-engines', 'W-Engines', '/zenless/w-engines', '/zenless/w-engines/', false, ['w-engines']),
      collection('bangboo', 'Bangboo', '/zenless/bangboo', '/zenless/bangboo/', false, ['bangboo']),
      collection('disk-drives', 'Disk Drives', '/zenless/disk-drives', '/zenless/disk-drives/', false, ['drive-discs'])
    ]
  },
  endfield: {
    id: 'endfield',
    aliases: ['arknights-endfield', 'ake'],
    name: 'Arknights: Endfield',
    basePath: '/arknights-endfield',
    assetIncludes: ['/images/arknights-endfield/'],
    recommendationHeadings: [
      'Best Teams',
      'Best Weapons',
      'Best Gear'
    ],
    collections: [
      collection('characters', 'Characters', '/arknights-endfield/characters', '/arknights-endfield/characters/', true, ['characters']),
      collection('weapons', 'Weapons', '/arknights-endfield/weapons', '/arknights-endfield/weapons/', false, ['weapons']),
      collection('gear', 'Gear', '/arknights-endfield/gear', '/arknights-endfield/gear/', false, ['gear'])
    ]
  }
};

function collection(id, label, indexPath, itemPathPrefix, hasDetailPages, catalogKinds) {
  return { id, label, indexPath, itemPathPrefix, hasDetailPages, catalogKinds };
}

function parseArgs(argv) {
  const options = {
    databaseDir: process.env.NYXARIUM_DATABASE_DIR || DEFAULT_DATABASE_DIR,
    game: 'all',
    collections: null,
    concurrency: 4,
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
    } else if (arg === '--game') {
      options.game = takeValue(arg, next).toLowerCase();
      i += 1;
    } else if (arg === '--collection') {
      options.collections = splitArg(takeValue(arg, next));
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

function splitArg(value) {
  return String(value).split(',').map((entry) => entry.trim()).filter(Boolean);
}

function printHelp() {
  console.log(`Usage:
  npm run prydwen
  npm run prydwen -- --game hsr
  npm run prydwen -- --game zzz --collection characters --sample 3
  npm run prydwen -- --game all --skip-assets

Options:
  --database-dir <path>   Database output directory.
  --game <id|all>         hsr, ww, wuwa, zzz, endfield, or all. Default: all.
  --collection <ids>      Comma-separated collection ids, for example characters,weapons.
  --concurrency <number>  Concurrent page and asset requests. Default: 4.
  --sample <number>       Limit detail pages per detail collection for quick validation.
  --skip-assets           Write JSON only.
  --force-assets          Re-download existing assets.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const databaseDir = path.resolve(options.databaseDir);
  const scrapedAt = new Date().toISOString();
  const games = selectGames(options.game);
  const manifestFile = path.join(databaseDir, PROVIDER, 'manifest.json');
  const existingManifest = await readJson(manifestFile, null);
  const manifest = existingManifest?.provider === PROVIDER ? existingManifest : {
    provider: PROVIDER,
    games: {}
  };
  manifest.generatedAt = scrapedAt;

  for (const cfg of games) {
    manifest.games[cfg.id] = await scrapeGame(cfg, options, databaseDir, scrapedAt);
  }

  await writeJson(manifestFile, manifest);
  console.log(JSON.stringify({
    provider: PROVIDER,
    output: databasePath(PROVIDER),
    games: Object.fromEntries(Object.entries(manifest.games).map(([id, summary]) => [id, summary.counts]))
  }, null, 2));
}

function selectGames(requested) {
  if (requested === 'all') return Object.values(GAMES);
  for (const cfg of Object.values(GAMES)) {
    if (cfg.id === requested || cfg.aliases.includes(requested)) return [cfg];
  }
  throw new Error(`Unknown game "${requested}". Use one of: all, ${Object.keys(GAMES).join(', ')}, wuwa`);
}

async function scrapeGame(cfg, options, databaseDir, scrapedAt) {
  const outputDir = path.join(databaseDir, PROVIDER, cfg.id);
  const rawDir = path.join(outputDir, 'raw');
  const pageDir = path.join(outputDir, 'pages');
  const collectionDir = path.join(outputDir, 'collections');
  const selectedCollections = filterCollections(cfg, options.collections);

  await ensureDir(outputDir);
  console.log(`[prydwen:${cfg.id}] scraping ${selectedCollections.length} collection(s)...`);

  const collections = [];
  const detailRecords = [];
  const collectionRecords = [];
  const allDownloads = [];
  const errors = [];

  for (const coll of selectedCollections) {
    try {
      const result = await scrapeCollection({ cfg, coll, options, databaseDir, pageDir, collectionDir, rawDir, scrapedAt });
      collections.push(result.collectionSummary);
      collectionRecords.push(result.collectionRecord);
      detailRecords.push(...result.detailRecords);
      allDownloads.push(...result.downloads);
    } catch (error) {
      errors.push({ collection: coll.id, message: error.message });
      console.warn(`[prydwen:${cfg.id}] ${coll.id} failed: ${error.message}`);
    }
  }

  const snapshot = await loadGameSnapshot(outputDir, cfg);
  const allRecords = snapshot.records;
  if (errors.length && !allRecords.length) {
    throw new Error(`[prydwen:${cfg.id}] all selected collections failed; leaving existing output untouched`);
  }

  const assetSummary = options.skipAssets
    ? { requested: uniqueBy(allDownloads, (entry) => entry.url).length, skipped: uniqueBy(allDownloads, (entry) => entry.url).length, downloaded: 0, cached: 0, missing: 0 }
    : await downloadAssets(allDownloads, options);

  const characters = snapshot.detailRecords
    .filter((record) => record.collection === 'characters')
    .map((record) => characterSummary(record, cfg))
    .sort((left, right) => left.name.localeCompare(right.name));

  await writeJson(path.join(outputDir, 'collections.json'), snapshot.collectionSummaries);
  await writeJson(path.join(outputDir, 'characters.json'), characters);
  await writeJson(path.join(outputDir, 'missing-assets.json'), assetSummary.missingAssets || []);

  const overview = {
    provider: PROVIDER,
    game: cfg.id,
    gameName: cfg.name,
    scrapedAt,
    sample: options.sample || null,
    source: {
      site: 'prydwen.gg',
      basePath: cfg.basePath
    },
    counts: {
      collections: snapshot.collectionRecords.length,
      records: allRecords.length,
      characters: characters.length,
      assetsPlanned: snapshot.assetCount,
      errors: errors.length
    },
    files: {
      collections: databasePath(PROVIDER, cfg.id, 'collections.json'),
      characters: databasePath(PROVIDER, cfg.id, 'characters.json'),
      collectionPages: databasePath(PROVIDER, cfg.id, 'collections'),
      detailPages: databasePath(PROVIDER, cfg.id, 'pages'),
      assets: databasePath(PROVIDER, cfg.id, 'assets'),
      missingAssets: databasePath(PROVIDER, cfg.id, 'missing-assets.json')
    },
    assets: withoutMissingList(assetSummary),
    errors,
    notes: [
      'Prydwen does not expose Nanoka-style game version switching; preview/beta status is inferred from index labels such as Soon or future-version badges.',
      'Normalized JSON stores local database-relative asset paths and source paths only, not remote URLs.'
    ]
  };
  await writeJson(path.join(outputDir, 'overview.json'), overview);

  const previousStateFile = path.join(databaseDir, PROVIDER, '_state', `${cfg.id}-hashes.json`);
  const previousState = await readJson(previousStateFile, {});
  const { hashes, report } = diffRecords(previousState.hashes?.records || {}, allRecords, (record) => record.name || record.title);
  const changes = {
    provider: PROVIDER,
    game: cfg.id,
    generatedAt: scrapedAt,
    summary: {
      records: {
        added: report.added.length,
        removed: report.removed.length,
        changed: report.changed.length,
        unchanged: report.unchanged
      }
    },
    sections: { records: report }
  };

  await writeJson(previousStateFile, {
    game: cfg.id,
    updatedAt: scrapedAt,
    hashes: { records: hashes }
  });
  await writeJson(path.join(databaseDir, PROVIDER, 'changes', `${cfg.id}-latest.json`), changes);
  await writeJson(path.join(outputDir, 'metadata.json'), {
    ...overview,
    changeReport: databasePath(PROVIDER, 'changes', `${cfg.id}-latest.json`)
  });

  console.log(`[prydwen:${cfg.id}] ${allRecords.length} records, ${characters.length} characters, ${overview.counts.assetsPlanned} assets planned`);
  return {
    game: cfg.id,
    gameName: cfg.name,
    counts: overview.counts,
    assets: withoutMissingList(assetSummary),
    changes: changes.summary
  };
}

function filterCollections(cfg, requested) {
  if (!requested?.length) return cfg.collections;
  const wanted = new Set(requested.map((entry) => entry.toLowerCase()));
  const collections = cfg.collections.filter((coll) => wanted.has(coll.id) || wanted.has(safeSlug(coll.label)));
  if (!collections.length) {
    throw new Error(`No collections matched "${requested.join(',')}" for ${cfg.id}`);
  }
  return collections;
}

async function loadGameSnapshot(outputDir, cfg) {
  const collectionRecords = [];
  const detailRecords = [];

  for (const coll of cfg.collections) {
    const collectionRecord = await readJson(path.join(outputDir, 'collections', `${coll.id}.json`), null);
    if (collectionRecord) collectionRecords.push(collectionRecord);

    const detailDir = path.join(outputDir, 'pages', coll.id);
    let files = [];
    try {
      files = await fs.readdir(detailDir);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    for (const file of files.filter((entry) => entry.endsWith('.json')).sort()) {
      const record = await readJson(path.join(detailDir, file), null);
      if (record) detailRecords.push(record);
    }
  }

  const records = [...collectionRecords, ...detailRecords].sort(compareById);
  const assetCount = uniqueBy(records.flatMap((record) => record.assets || []), (asset) => asset.sourceHash || asset.id).length;
  const collectionSummaries = collectionRecords.map((record) => ({
    id: record.collection,
    label: cfg.collections.find((coll) => coll.id === record.collection)?.label || record.collection,
    sourcePath: record.sourcePath,
    file: databasePath(PROVIDER, cfg.id, 'collections', `${record.collection}.json`),
    detailPagesTotal: record.detailPagesTotal || 0,
    detailPagesScraped: record.detailPagesScraped || 0,
    staleDetailPagesRemoved: record.staleDetailPagesRemoved || 0,
    entries: record.entries?.length || 0,
    assets: record.assets?.length || 0
  }));

  return { records, collectionRecords, detailRecords, collectionSummaries, assetCount };
}

async function scrapeCollection(context) {
  const { cfg, coll, options, databaseDir, pageDir, collectionDir, rawDir, scrapedAt } = context;
  const indexHtml = await fetchPrydwenHtml(coll.indexPath);
  const indexSourcePath = normalizeSourcePath(coll.indexPath);
  const indexPage = normalizePage({
    cfg,
    coll,
    html: indexHtml,
    sourcePath: indexSourcePath,
    id: `collection:${coll.id}`,
    slug: coll.id,
    recordType: 'collection',
    scrapedAt,
    databaseDir,
    indexName: coll.label
  });

  const links = extractCollectionLinks(indexHtml, coll).map((link) => ({
    ...link,
    contentStatus: inferContentStatus(link.name),
    statusLabels: extractStatusLabels(link.name)
  }));
  const detailLinks = coll.hasDetailPages
    ? (options.sample ? links.slice(0, options.sample) : links)
    : [];

  const detailResults = await mapLimit(detailLinks, options.concurrency, async (link, index) => {
    const record = await scrapeDetailPage({ cfg, coll, link, databaseDir, scrapedAt });
    console.log(`[prydwen:${cfg.id}:${coll.id}] ${index + 1}/${detailLinks.length} ${link.slug}`);
    return record;
  });

  const detailRecords = detailResults.map((result) => result.record);
  const detailDownloads = detailResults.flatMap((result) => result.downloads);

  const catalogEntries = coll.hasDetailPages
    ? links
    : catalogEntriesFromPage(indexPage.record, coll);

  const collectionPage = {
    ...indexPage.record,
    entries: catalogEntries,
    detailPagesScraped: detailRecords.length,
    detailPagesTotal: links.length
  };

  for (const detail of detailRecords) {
    const file = path.join(pageDir, coll.id, `${detail.slug}.json`);
    await writeJson(file, detail);
  }

  const staleDetailPagesRemoved = await pruneStaleDetailFiles({
    pageDir,
    coll,
    detailRecords,
    sample: options.sample
  });
  collectionPage.staleDetailPagesRemoved = staleDetailPagesRemoved;

  await writeJson(path.join(collectionDir, `${coll.id}.json`), collectionPage);
  await writeJson(path.join(rawDir, `${coll.id}-index.json`), {
    provider: PROVIDER,
    game: cfg.id,
    collection: coll.id,
    sourcePath: indexSourcePath,
    scrapedAt,
    detailPagesTotal: links.length,
    detailPagesScraped: detailRecords.length,
    staleDetailPagesRemoved,
    items: catalogEntries
  });

  return {
    collectionRecord: collectionPage,
    detailRecords,
    downloads: [...indexPage.downloads, ...detailDownloads],
    collectionSummary: {
      id: coll.id,
      label: coll.label,
      sourcePath: indexSourcePath,
      file: databasePath(PROVIDER, cfg.id, 'collections', `${coll.id}.json`),
      detailPagesTotal: links.length,
      detailPagesScraped: detailRecords.length,
      staleDetailPagesRemoved,
      entries: catalogEntries.length,
      assets: indexPage.record.assets.length
    }
  };
}

async function pruneStaleDetailFiles({ pageDir, coll, detailRecords, sample }) {
  if (!coll.hasDetailPages || sample) return 0;

  const detailDir = path.join(pageDir, coll.id);
  let files = [];
  try {
    files = await fs.readdir(detailDir);
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }

  const expectedFiles = new Set(detailRecords.map((record) => `${record.slug}.json`));
  let removed = 0;
  for (const file of files) {
    if (!file.endsWith('.json') || expectedFiles.has(file)) continue;
    await fs.unlink(path.join(detailDir, file));
    removed += 1;
  }
  return removed;
}

async function scrapeDetailPage({ cfg, coll, link, databaseDir, scrapedAt }) {
  const html = await fetchPrydwenHtml(link.sourcePath);
  const page = normalizePage({
    cfg,
    coll,
    html,
    sourcePath: link.sourcePath,
    id: `${coll.id}:${link.slug}`,
    slug: link.slug,
    recordType: 'detail',
    scrapedAt,
    databaseDir,
    indexName: link.name,
    contentStatus: link.contentStatus,
    statusLabels: link.statusLabels
  });
  return page;
}

async function fetchPrydwenHtml(sourcePath) {
  const html = await queuedPrydwenFetch(() => fetchText(`${BASE}${normalizeSourcePath(sourcePath)}`, { retries: 6 }));
  if (!html || !html.trim()) throw new Error(`Empty Prydwen response for ${sourcePath}`);
  if (/Just a moment|challenges\.cloudflare|cf-browser-verification/i.test(html.slice(0, 12000))) {
    throw new Error(`Cloudflare challenge received for ${sourcePath}`);
  }
  return html;
}

async function queuedPrydwenFetch(task) {
  const previous = prydwenFetchGate;
  let release;
  prydwenFetchGate = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await task();
  } finally {
    setTimeout(release, PRYDWEN_PAGE_DELAY_MS);
  }
}

function normalizePage({ cfg, coll, html, sourcePath, id, slug, recordType, scrapedAt, databaseDir, indexName, contentStatus, statusLabels }) {
  const meta = parseMeta(html);
  const pageText = cleanPageText(html);
  const assets = assetsFromHtml(html, `${BASE}${sourcePath}`, cfg, databaseDir);
  const assetRecords = assets.map((entry) => entry.record);
  const sections = parseSections(html, `${BASE}${sourcePath}`, cfg, databaseDir);
  const title = meta.h1 || meta.title || cleanText(indexName) || slug;
  const name = cleanName(title, cfg, indexName);
  const facts = inferFacts(cfg.id, pageText, assetRecords);
  const finalStatusLabels = statusLabels?.length ? statusLabels : extractStatusLabels(indexName || title);

  const record = {
    id,
    provider: PROVIDER,
    game: cfg.id,
    gameName: cfg.name,
    collection: coll.id,
    recordType,
    slug,
    name,
    title,
    sourcePath,
    contentStatus: contentStatus || inferContentStatus(indexName || title),
    statusLabels: finalStatusLabels,
    scrapedAt,
    updatedText: extractLastUpdated(pageText),
    meta: {
      title: meta.title,
      description: meta.description
    },
    facts,
    assets: assetRecords,
    sections,
    recommendations: buildRecommendations(cfg, sections),
    tables: extractTables(html),
    text: pageText
  };

  return { record, downloads: assets.map((entry) => entry.download) };
}

function parseMeta(html) {
  const title = stripTags(matchOne(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const h1 = stripTags(matchOne(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i));
  const descTag = matchOne(html, /<meta\b[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*>/i)
    || matchOne(html, /<meta\b[^>]*content=["'][^"']+["'][^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*>/i);
  const attrs = parseAttrs(descTag || '');
  return {
    title: cleanText(title),
    h1: cleanText(h1),
    description: cleanText(attrs.content || '')
  };
}

function cleanPageText(html) {
  return stripTags(html)
    .replace(/\bLoading content\.\.\./g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanName(title, cfg, fallback) {
  const text = cleanText(title || fallback || '');
  const patterns = [
    /^(.*?)\s+Best Build Guide\b/i,
    /^(.*?)\s+\|\s+/,
    new RegExp(`^(.*?)\\s+-\\s+${escapeRegExp(cfg.name)}$`, 'i')
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return cleanText(match[1]);
  }
  return text;
}

function extractCollectionLinks(html, coll) {
  const links = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = re.exec(html)) !== null) {
    const sourcePath = normalizeSourcePath(match[2]);
    if (!sourcePath.startsWith(coll.itemPathPrefix)) continue;
    const slug = sourcePath.slice(coll.itemPathPrefix.length).replace(/^\/+|\/+$/g, '');
    if (!/^[a-z0-9][a-z0-9-]+$/i.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    links.push({
      id: safeSlug(slug),
      slug,
      name: cleanText(stripTags(match[3])) || titleFromSlug(slug),
      sourcePath
    });
  }

  return links.sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeSourcePath(value) {
  try {
    const url = new URL(decodeEntities(value), BASE);
    return url.pathname.replace(/\/$/, '');
  } catch {
    return String(value || '').split(/[?#]/)[0].replace(/\/$/, '') || '/';
  }
}

function assetsFromHtml(html, pageUrl, cfg, databaseDir) {
  const imageEntries = extractImages(html, pageUrl, {
    include: (url) => shouldKeepAsset(url, cfg)
  });
  const linkEntries = extractPreloadImages(html, pageUrl, cfg);
  const images = uniqueBy([...imageEntries, ...linkEntries], (image) => image.url);

  return images.map((image) => {
    const record = assetRecord(image, cfg, databaseDir);
    return {
      record: sanitizeAssetRecord(record),
      download: {
        url: image.url,
        targetFile: path.join(databaseDir, record.path),
        sourceHash: record.sourceHash,
        path: record.path,
        name: record.name,
        kind: record.kind
      }
    };
  });
}

function extractPreloadImages(html, pageUrl, cfg) {
  const entries = [];
  const re = /<link\b[^>]*>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const attrs = parseAttrs(match[0]);
    if (String(attrs.as || '').toLowerCase() !== 'image') continue;
    const url = normalizeUrl(attrs.href, pageUrl);
    if (!url || !shouldKeepAsset(url, cfg)) continue;
    entries.push({
      id: shortHash(url),
      alt: '',
      title: '',
      url,
      width: null,
      height: null
    });
  }
  return entries;
}

function normalizeUrl(raw, baseUrl) {
  if (!raw) return null;
  try {
    const url = new URL(raw, baseUrl);
    const optimized = url.searchParams.get('url');
    if (optimized) return new URL(optimized, baseUrl).href;
    return url.href;
  } catch {
    return null;
  }
}

function shouldKeepAsset(url, cfg) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'cdn.prydwen.gg') return false;
    return cfg.assetIncludes.some((part) => parsed.pathname.includes(part));
  } catch {
    return false;
  }
}

function assetRecord(image, cfg, databaseDir) {
  const parsed = new URL(image.url);
  const fileStem = safeSlug(path.basename(parsed.pathname, path.extname(parsed.pathname)), 'asset');
  const sourceHash = shortHash(image.url);
  const kind = classifyAsset(parsed.pathname);
  const name = cleanText(image.alt || image.title || titleFromSlug(fileStem));
  const stem = assetStem(name, fileStem);
  const ext = normalizedExt(extFromUrl(image.url, '.webp'));
  const localRel = databasePath(PROVIDER, cfg.id, 'assets', kind, `${stem}-${sourceHash}${ext}`);

  return {
    id: sourceHash,
    sourceHash,
    kind,
    name,
    fileStem,
    path: localRel,
    width: image.width,
    height: image.height,
    databaseRelative: path.relative(databaseDir, path.join(databaseDir, localRel))
  };
}

function sanitizeAssetRecord(record) {
  const { databaseRelative, ...out } = record;
  return out;
}

function assetStem(name, fileStem) {
  const generic = new Set(['character', 'weapon', 'gear', 'gear-set', 'set', 'stat', 'icon', 'w-engines']);
  const slug = safeSlug(name, '');
  if (!slug || generic.has(slug)) return fileStem;
  return slug;
}

function classifyAsset(pathname) {
  const pathLower = pathname.toLowerCase();
  if (pathLower.includes('/characters/')) return 'characters';
  if (pathLower.includes('/light-cones/')) return 'light-cones';
  if (pathLower.includes('/relics/')) return 'relics';
  if (pathLower.includes('/weapons/')) return 'weapons';
  if (pathLower.includes('/echo')) return 'echoes';
  if (pathLower.includes('/w-engines/') || pathLower.includes('/engines/')) return 'w-engines';
  if (pathLower.includes('/bangboo/')) return 'bangboo';
  if (pathLower.includes('/drives/') || pathLower.includes('/disk')) return 'drive-discs';
  if (pathLower.includes('/gear/')) return 'gear';
  if (pathLower.includes('/items/')) return 'items';
  if (pathLower.includes('/factions/')) return 'factions';
  if (pathLower.includes('/icons/')) return 'icons';
  if (pathLower.includes('/categories/')) return 'categories';
  return 'misc';
}

function normalizedExt(ext) {
  const clean = String(ext || '.webp').toLowerCase();
  return clean === '.jpeg' ? '.jpg' : clean;
}

function parseSections(html, pageUrl, cfg, databaseDir) {
  const headings = [];
  const headingRe = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = headingRe.exec(html)) !== null) {
    const heading = cleanText(stripTags(match[2]));
    if (!heading) continue;
    headings.push({
      level: Number(match[1].slice(1)),
      heading,
      start: match.index,
      end: headingRe.lastIndex
    });
  }

  const blockHeadingRe = /<div\b[^>]*class=(["'])[^"']*\bcontent-header\b[^"']*\1[^>]*>([\s\S]*?)<\/div>/gi;
  while ((match = blockHeadingRe.exec(html)) !== null) {
    const heading = cleanText(stripTags(match[2]));
    if (!heading) continue;
    headings.push({
      level: 2,
      heading,
      start: match.index,
      end: blockHeadingRe.lastIndex
    });
  }

  headings.sort((left, right) => left.start - right.start || left.end - right.end);

  const sections = [];
  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i];
    const next = headings[i + 1];
    const body = html.slice(current.end, next ? next.start : html.length);
    const text = stripTags(body);
    const assets = assetsFromHtml(body, pageUrl, cfg, databaseDir).map((entry) => entry.record);
    if (!text && !assets.length) continue;
    sections.push({
      id: safeSlug(`${current.heading}-${i}`, `section-${i}`),
      level: current.level,
      heading: current.heading,
      text,
      assets: uniqueBy(assets, (asset) => asset.sourceHash)
    });
  }
  return sections;
}

function buildRecommendations(cfg, sections) {
  const headings = cfg.recommendationHeadings.map((heading) => ({
    key: safeSlug(heading),
    normalized: normalizeHeading(heading),
    label: heading
  }));
  const out = {};

  for (const section of sections) {
    const normalized = normalizeHeading(section.heading);
    const match = headings.find((heading) => normalized.includes(heading.normalized) || heading.normalized.includes(normalized));
    if (!match) continue;
    if (!out[match.key]) out[match.key] = { label: match.label, sections: [] };
    out[match.key].sections.push({
      heading: section.heading,
      text: section.text,
      assets: section.assets
    });
  }

  return out;
}

function normalizeHeading(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function extractTables(html) {
  const tables = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  while ((tableMatch = tableRe.exec(html)) !== null) {
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(tableMatch[1])) !== null) {
      const cells = [];
      const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
        cells.push(stripTags(cellMatch[1]));
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push({ rows });
  }
  return tables;
}

function inferFacts(game, text, assets) {
  const facts = {};
  const normalized = text.replace(/\s+/g, ' ');

  if (game === 'hsr') {
    const match = normalized.match(/is a\s+(\d)\s*(?:star|\u2605)\s+character from the\s+([A-Za-z ]+?)\s+element who follows the Path of\s+([A-Za-z ]+?)\s*[.]/i);
    if (match) Object.assign(facts, { rarity: numeric(match[1]), element: cleanText(match[2]), path: cleanText(match[3]) });
  } else if (game === 'ww') {
    const match = normalized.match(/is a\s+(\d)\s*(?:star|\u2605)\s+rarity character from the\s+([A-Za-z ]+?)\s+element who uses the\s+([A-Za-z ]+?)\s+type weapon/i);
    if (match) Object.assign(facts, { rarity: numeric(match[1]), element: cleanText(match[2]), weapon: cleanText(match[3]) });
  } else if (game === 'zzz') {
    const match = normalized.match(/with the\s+([A-Za-z ]+?)\s+attribute who belongs to the\s+([A-Za-z ]+?)\s+Specialty and who is part of the\s+(.+?)\s+faction/i);
    if (match) Object.assign(facts, { attribute: cleanText(match[1]), specialty: cleanText(match[2]), faction: cleanText(match[3]) });
    const rarity = assets.find((asset) => asset.kind === 'icons' && /^rarity-[sab]$/i.test(asset.fileStem.replace(/_/g, '-')));
    if (rarity) facts.rarity = rarity.fileStem.split(/[_-]/).pop()?.toUpperCase() || null;
  } else if (game === 'endfield') {
    const match = normalized.match(/is a\s+(\d)\s*-?star character.*?wields a\s+([A-Za-z ]+?)\s+and belongs to the\s+([A-Za-z ]+?)\s+class.*?access to the\s+([A-Za-z ]+?)\s+element/i);
    if (match) Object.assign(facts, { rarity: numeric(match[1]), weapon: cleanText(match[2]), class: cleanText(match[3]), element: cleanText(match[4]) });
  }

  return facts;
}

function extractLastUpdated(text) {
  return cleanText(text.match(/Last updated:\s*([0-9A-Za-z/ -]+)/i)?.[1] || '');
}

function catalogEntriesFromPage(page, coll) {
  const parsed = catalogEntriesFromText(page.text, coll, page.assets);
  const fallback = catalogEntriesFromAssets(page.assets, coll);
  if (!parsed.length) return fallback;

  const byId = new Map(parsed.map((entry) => [entry.id, entry]));
  for (const entry of fallback) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function catalogEntriesFromText(text, coll, assets) {
  const markers = catalogMarkers(coll);
  if (!markers.length) return [];

  const lines = String(text || '').split(/\n+/).map((line) => cleanText(line)).filter(Boolean);
  const starts = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (isCatalogItemName(lines[i]) && isCatalogMarker(lines[i + 1], markers)) starts.push(i);
  }

  const entries = [];
  const artAssets = catalogArtAssets(assets, coll);
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = starts[i + 1] || lines.length;
    const segment = lines.slice(start, end);
    const name = cleanText(segment[0]);
    const art = attachEntryArt(name, i, artAssets);
    entries.push({
      id: safeSlug(name),
      name,
      kind: coll.catalogKinds?.[0] || coll.id,
      contentStatus: inferContentStatus(name),
      statusLabels: extractStatusLabels(name),
      art: art?.path || null,
      assetId: art?.id || null,
      fields: catalogFields(segment),
      text: segment.join('\n')
    });
  }

  return uniqueBy(entries, (entry) => entry.id).sort((left, right) => left.name.localeCompare(right.name));
}

function catalogMarkers(coll) {
  if (['light-cones', 'weapons', 'w-engines', 'bangboo'].includes(coll.id)) return ['Rarity:'];
  if (coll.id === 'relic-sets') return ['Type:'];
  if (coll.id === 'echoes') return ['Class:'];
  if (coll.id === 'gear') return ['Level:'];
  if (coll.id === 'disk-drives') return ['(2)'];
  return [];
}

function isCatalogItemName(line) {
  if (!line || line.length < 2 || line.length > 100) return false;
  if (/[:{}()[\]]$/.test(line)) return false;
  if (/^(Home|Database|Characters|Weapons|Echoes|Gear|Bangboo|Filters|Reset|Showing|Last updated|Loading content|Privacy Policy|Copyright|Remove Ads)$/i.test(line)) return false;
  return true;
}

function isCatalogMarker(line, markers) {
  return markers.some((marker) => marker === '(2)' ? /^\(2\)/.test(line) : line.startsWith(marker));
}

function catalogFields(segment) {
  const fields = {};
  const bonuses = [];

  for (let i = 1; i < segment.length; i += 1) {
    const line = segment[i];
    const field = line.match(/^([^:]{2,80}):\s*(.*)$/);
    if (field) {
      const key = safeKey(field[1]);
      let value = cleanText(field[2]);
      if (!value && segment[i + 1] && !segment[i + 1].includes(':')) {
        value = cleanText(segment[i + 1]);
        i += 1;
      }
      fields[key] = value;
      continue;
    }
    if (/^\(\d+\)/.test(line)) bonuses.push(line);
  }

  if (bonuses.length) fields.bonuses = bonuses;
  return fields;
}

function attachEntryArt(name, index, artAssets) {
  const exact = artAssets.find((asset) => safeSlug(asset.name) === safeSlug(name));
  return exact || artAssets[index] || null;
}

function catalogArtAssets(assets, coll) {
  const wanted = new Set(coll.catalogKinds || []);
  return assets.filter((asset) => wanted.has(asset.kind));
}

function catalogEntriesFromAssets(assets, coll) {
  const wanted = new Set(coll.catalogKinds || []);
  return uniqueBy(assets.filter((asset) => wanted.has(asset.kind) && asset.name && !isGenericCatalogAssetName(asset.name)), (asset) => safeSlug(asset.name))
    .map((asset) => ({
      id: safeSlug(asset.name),
      name: asset.name,
      kind: asset.kind,
      art: asset.path,
      assetId: asset.id,
      contentStatus: 'live'
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function isGenericCatalogAssetName(name) {
  return new Set(['character', 'weapon', 'gear', 'gear set', 'set', 'stat', 'icon', 'w-engines']).has(cleanText(name).toLowerCase());
}

function safeKey(value) {
  return safeSlug(value).replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
}

async function downloadAssets(downloads, options) {
  const unique = uniqueBy(downloads, (entry) => entry.url);
  const results = await mapLimit(unique, options.concurrency, async (asset) => {
    const result = await downloadFile(asset.url, asset.targetFile, {
      force: options.forceAssets,
      optional: true
    });
    return { asset, result };
  });

  const missingAssets = results
    .filter(({ result }) => result.status === 'missing')
    .map(({ asset }) => ({
      sourceHash: asset.sourceHash,
      path: asset.path,
      kind: asset.kind,
      name: asset.name,
      reason: 'Asset did not resolve from Prydwen CDN during this scrape.'
    }));

  return {
    requested: results.length,
    downloaded: results.filter(({ result }) => result.status === 'downloaded').length,
    cached: results.filter(({ result }) => result.status === 'cached').length,
    missing: missingAssets.length,
    missingAssets
  };
}

function withoutMissingList(summary) {
  const { missingAssets, ...out } = summary;
  return out;
}

function characterSummary(record, cfg) {
  const art = {};
  for (const asset of record.assets.filter((entry) => entry.kind === 'characters')) {
    if (asset.fileStem.endsWith('-card') || asset.fileStem.endsWith('_card')) art.card = asset.path;
    else if (asset.fileStem.endsWith('-full') || asset.fileStem.endsWith('_full')) art.full = asset.path;
    else if (asset.fileStem.endsWith('-icon') || asset.fileStem.endsWith('_icon')) art.icon = asset.path;
  }

  return {
    id: record.slug,
    provider: PROVIDER,
    game: cfg.id,
    name: record.name,
    slug: record.slug,
    sourcePath: record.sourcePath,
    contentStatus: record.contentStatus,
    statusLabels: record.statusLabels,
    updatedText: record.updatedText,
    facts: record.facts,
    art,
    pageFile: databasePath(PROVIDER, cfg.id, 'pages', 'characters', `${record.slug}.json`),
    recommendationSections: Object.keys(record.recommendations),
    assetCount: record.assets.length
  };
}

function inferContentStatus(label) {
  const text = cleanText(label);
  if (/\bsoon\b/i.test(text)) return 'beta';
  if (/\b\d+\.\d+\b/.test(text) || /\b\d+\.x\b/i.test(text)) return 'beta';
  return 'live';
}

function extractStatusLabels(label) {
  const text = cleanText(label);
  const labels = [];
  for (const match of text.matchAll(/\b(New|Soon|\d+\.\d+|\d+\.x)\b/gi)) labels.push(match[1]);
  return [...new Set(labels)];
}

function matchOne(value, re) {
  return value.match(re)?.[1] || '';
}

function titleFromSlug(slug) {
  return cleanText(String(slug || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()));
}

function compareById(left, right) {
  return String(left.id).localeCompare(String(right.id), undefined, { numeric: true });
}

function numeric(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
