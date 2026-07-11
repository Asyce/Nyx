#!/usr/bin/env node

import path from 'node:path';
import {
  DEFAULT_DATABASE_DIR,
  cleanText,
  fetchJson,
  mapLimit,
  readJson,
  writeJson
} from '../lib/common.mjs';

const PROVIDER = 'Fandom';
const OUTPUT_REL = path.join('WikiTitles', 'character-titles.json');
const BATCH_SIZE = 25;

const GAMES = {
  gi: {
    id: 'gi',
    aliases: ['genshin', 'genshin-impact'],
    name: 'Genshin Impact',
    wiki: 'Genshin Impact Wiki',
    api: 'https://genshin-impact.fandom.com/api.php',
    folder: 'gi'
  },
  hsr: {
    id: 'hsr',
    aliases: ['star-rail', 'honkai-star-rail'],
    name: 'Honkai: Star Rail',
    wiki: 'Honkai: Star Rail Wiki',
    api: 'https://honkai-star-rail.fandom.com/api.php',
    folder: 'hsr'
  },
  zzz: {
    id: 'zzz',
    aliases: ['zenless', 'zenless-zone-zero'],
    name: 'Zenless Zone Zero',
    wiki: 'Zenless Zone Zero Wiki',
    api: 'https://zenless-zone-zero.fandom.com/api.php',
    folder: 'zzz'
  },
  wuwa: {
    id: 'wuwa',
    aliases: ['ww', 'wuthering-waves'],
    name: 'Wuthering Waves',
    wiki: 'Wuthering Waves Wiki',
    api: 'https://wutheringwaves.fandom.com/api.php',
    folder: 'ww'
  }
};

function parseArgs(argv) {
  const options = {
    databaseDir: process.env.NYXARIUM_DATABASE_DIR || DEFAULT_DATABASE_DIR,
    game: 'all',
    sample: null,
    concurrency: 4,
    searchFallback: true
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
    } else if (arg === '--sample') {
      options.sample = Number.parseInt(takeValue(arg, next), 10);
      i += 1;
    } else if (arg === '--concurrency') {
      options.concurrency = Number.parseInt(takeValue(arg, next), 10);
      i += 1;
    } else if (arg === '--no-search') {
      options.searchFallback = false;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.sample !== null && (!Number.isFinite(options.sample) || options.sample < 1)) {
    throw new Error('--sample must be a positive number');
  }
  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
    throw new Error('--concurrency must be a positive number');
  }

  return options;
}

function takeValue(flag, value) {
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function printHelp() {
  console.log(`Usage:
  npm run wiki:titles
  npm run wiki:titles -- --game hsr
  npm run wiki:titles -- --game zzz --sample 5

Options:
  --database-dir <path>   Database output directory.
  --game <id|all>         gi, hsr, zzz, wuwa/ww, or all. Default: all.
  --sample <number>       Limit characters per game for quick validation.
  --concurrency <number>  Concurrent search fallback requests. Default: 4.
  --no-search             Do not use MediaWiki search fallback for page-name mismatches.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const databaseDir = path.resolve(options.databaseDir);
  const generatedAt = new Date().toISOString();
  const games = selectGames(options.game);
  const outputFile = path.join(databaseDir, OUTPUT_REL);
  const previous = await readJson(outputFile, null);

  const payload = {
    provider: PROVIDER,
    generatedAt,
    note: 'Character subtitle data is scraped from each game wiki. Genshin and Wuthering Waves use infobox title, ZZZ uses Namecard names, and Honkai: Star Rail uses How to Obtain with exclusive light cone fallback. Endfield uses class in the site generator because its wiki does not expose character titles.',
    games: { ...(previous?.games || {}) }
  };

  for (const cfg of games) {
    const roster = (await loadRoster(cfg, databaseDir)).slice(0, options.sample ?? undefined);
    payload.games[cfg.id] = await scrapeGameTitles(cfg, roster, options, generatedAt);
  }

  payload.summary = Object.fromEntries(Object.entries(payload.games).map(([key, game]) => [
    key,
    {
      count: game.entries?.length || 0,
      titled: (game.entries || []).filter((entry) => entry.title).length,
      missing: game.missing?.length || 0
    }
  ]));

  await writeJson(outputFile, payload);
  console.log(JSON.stringify({
    wrote: path.relative(databaseDir, outputFile).replace(/\\/g, '/'),
    summary: payload.summary
  }, null, 2));
}

function selectGames(value) {
  if (value === 'all') return Object.values(GAMES);
  const match = Object.values(GAMES).find((game) => game.id === value || game.aliases.includes(value));
  if (!match) throw new Error(`Unknown game: ${value}`);
  return [match];
}

async function loadRoster(cfg, databaseDir) {
  if (cfg.id === 'gi') {
    const rows = await readJson(path.join(databaseDir, 'GameData', 'gi', 'live', 'characters.json'), []);
    return rows
      .filter((ch) => ch?.name && (ch.rarity === 4 || ch.rarity === 5))
      .map((ch) => ({
        id: String(ch.id),
        name: ch.name,
        candidates: titleCandidates(ch.name),
        source: 'GameData'
      }));
  }

  const rows = await readJson(path.join(databaseDir, 'Prydwen', cfg.folder, 'characters.json'), []);
  return rows
    .filter((ch) => ch?.name)
    .map((ch) => ({
      id: String(ch.id || ch.slug || ch.name),
      name: ch.name,
      slug: ch.slug,
      candidates: titleCandidates(ch.name, ch.slug),
      source: 'Prydwen'
    }));
}

async function scrapeGameTitles(cfg, roster, options, generatedAt) {
  const entriesByName = new Map();

  for (const chunk of chunks(roster, BATCH_SIZE)) {
    const candidateRows = chunk.flatMap((ch) => ch.candidates.map((candidate) => ({ ch, candidate })));
    const pages = await fetchPages(cfg.api, candidateRows.map((row) => row.candidate));

    for (const row of candidateRows) {
      if (entriesByName.has(row.ch.name)) continue;
      const page = pages.get(normTitle(row.candidate));
      const entry = pageToEntry(cfg, row.ch, page, row.candidate, generatedAt);
      if (entry.title || entry.status === 'no-title') entriesByName.set(row.ch.name, entry);
    }

    for (const ch of chunk) {
      if (!entriesByName.has(ch.name)) {
        entriesByName.set(ch.name, missingEntry(cfg, ch, generatedAt, 'missing-page'));
      }
    }
  }

  let entries = [...entriesByName.values()];

  if (options.searchFallback) {
    entries = await mapLimit(entries, options.concurrency, async (entry) => {
      if (entry.title || entry.status === 'no-title') return entry;
      const page = await searchPage(cfg, entry.name);
      return pageToEntry(cfg, entry, page, page?.title || entry.name, generatedAt);
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  const missing = entries
    .filter((entry) => !entry.title)
    .map((entry) => ({
      name: entry.name,
      status: entry.status,
      pageTitle: entry.pageTitle || null,
      url: entry.url || null
    }));

  return {
    name: cfg.name,
    wiki: cfg.wiki,
    api: cfg.api,
    generatedAt,
    count: entries.length,
    entries,
    missing
  };
}

async function fetchPages(api, titles) {
  const out = new Map();
  const wanted = unique(titles.filter(Boolean));
  if (!wanted.length) return out;

  const url = new URL(api);
  url.searchParams.set('action', 'query');
  url.searchParams.set('titles', wanted.join('|'));
  url.searchParams.set('prop', 'revisions');
  url.searchParams.set('rvprop', 'content');
  url.searchParams.set('rvslots', 'main');
  url.searchParams.set('redirects', '1');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');

  const data = await fetchJson(url.href, { retries: 3 });
  const redirects = new Map((data?.query?.redirects || []).map((entry) => [normTitle(entry.from), normTitle(entry.to)]));
  const pages = new Map((data?.query?.pages || []).map((page) => [normTitle(page.title), page]));

  for (const requested of wanted) {
    out.set(normTitle(requested), pages.get(redirects.get(normTitle(requested)) || normTitle(requested)) || null);
  }

  return out;
}

async function searchPage(cfg, name) {
  const search = new URL(cfg.api);
  search.searchParams.set('action', 'query');
  search.searchParams.set('list', 'search');
  search.searchParams.set('srsearch', name);
  search.searchParams.set('srlimit', '8');
  search.searchParams.set('format', 'json');
  search.searchParams.set('formatversion', '2');

  const data = await fetchJson(search.href, { retries: 3, optional: true });
  const best = chooseSearchHit(name, data?.query?.search || []);
  if (!best) return null;
  const pages = await fetchPages(cfg.api, [best.title]);
  return pages.get(normTitle(best.title)) || null;
}

function chooseSearchHit(name, hits) {
  const nameKey = normKey(name);
  const words = wordKeys(name);
  let best = null;

  for (const hit of hits) {
    const title = cleanText(hit.title || '');
    if (!title || /\/|voice|outfit|media|quest|mission|event|gallery/i.test(title)) continue;
    const key = normKey(title);
    const hitWords = wordKeys(title);
    let score = 0;
    if (key === nameKey) score += 100;
    if (key.includes(nameKey) || nameKey.includes(key)) score += 70;
    if (words.every((word) => hitWords.includes(word))) score += 45;
    if (/playable|character|agent|resonator/i.test(stripSearchSnippet(hit.snippet))) score += 10;
    if (!best || score > best.score) best = { title, score };
  }

  return best?.score >= 45 ? best : null;
}

function pageToEntry(cfg, ch, page, requestedTitle, generatedAt) {
  if (!page || page.missing) return missingEntry(cfg, ch, generatedAt, 'missing-page', requestedTitle);
  const content = page.revisions?.[0]?.slots?.main?.content || page.revisions?.[0]?.content || '';
  const titleInfo = titleFromPage(cfg, ch, content);
  return {
    game: cfg.id,
    name: ch.name,
    key: normKey(ch.name),
    title: titleInfo.title || null,
    rawTitle: titleInfo.rawTitle || null,
    sourceField: titleInfo.sourceField || null,
    status: titleInfo.title ? 'ok' : 'no-title',
    pageTitle: page.title,
    requestedTitle,
    url: page.fullurl || wikiUrl(cfg, page.title),
    source: cfg.wiki,
    scrapedAt: generatedAt
  };
}

function titleFromPage(cfg, ch, content) {
  if (cfg.id === 'hsr') return hsrSubtitle(ch, content);
  if (cfg.id === 'zzz') {
    const rawTitle = extractInfoboxField(content, 'namecard');
    return {
      title: cleanZzzNamecard(rawTitle),
      rawTitle,
      sourceField: 'namecard'
    };
  }

  const rawTitle = extractInfoboxField(content, 'title');
  return {
    title: cleanUsefulWikiTitle(rawTitle),
    rawTitle,
    sourceField: 'title'
  };
}

function hsrSubtitle(ch, content) {
  if (normKey(ch.name) === 'acheron') {
    return {
      title: 'Bosenmori',
      rawTitle: 'manual:Bosenmori',
      sourceField: 'manual'
    };
  }

  const rawObtain = extractInfoboxField(content, 'how_to_obtain');
  const obtainTitle = cleanUsefulWikiTitle(rawObtain);
  if (obtainTitle) {
    return {
      title: obtainTitle,
      rawTitle: rawObtain,
      sourceField: 'how_to_obtain'
    };
  }

  const rawLightCone = extractInfoboxField(content, 'lightcone');
  return {
    title: cleanUsefulWikiTitle(rawLightCone),
    rawTitle: rawLightCone,
    sourceField: 'lightcone'
  };
}

function missingEntry(cfg, ch, generatedAt, status, requestedTitle = null) {
  return {
    game: cfg.id,
    name: ch.name,
    key: normKey(ch.name),
    title: null,
    rawTitle: null,
    sourceField: null,
    status,
    pageTitle: null,
    requestedTitle,
    url: null,
    source: cfg.wiki,
    scrapedAt: generatedAt
  };
}

function extractInfoboxField(content, field) {
  const re = new RegExp(`^\\|[ \\t]*${field}[ \\t]*=[ \\t]*(.*)$`, 'im');
  const match = String(content || '').match(re);
  if (!match) return null;
  return match[1].trim();
}

function cleanZzzNamecard(value) {
  if (!value) return null;
  const parts = String(value).split(';').map((part) => part.trim()).filter(Boolean);
  const preferred = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  return cleanUsefulWikiTitle(preferred);
}

function cleanUsefulWikiTitle(value) {
  const title = cleanWikiTitle(value);
  if (!title) return null;
  if (/^[A-Za-z ]+:$/.test(title)) return null;
  if (/^(event warp|event warps|character event warp|character event warps)$/i.test(title)) return null;
  return title;
}

function cleanWikiTitle(value) {
  if (!value) return null;
  let text = String(value)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<ref[\s\S]*?<\/ref>/gi, ' ')
    .replace(/<ref\b[^>]*\/>/gi, ' ')
    .replace(/\{\{\s*Icon\s*\|\s*([^|}]+)(?:\|[^}]*)?\}\}/gi, '$1')
    .replace(/\{\{[^{}]*\|([^|{}]+)\}\}/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/\[\[(?:File|Image):[^\]]+\]\]/gi, ' ')
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/^"+|"+$/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[0-9]+\]/g, ' ');

  text = cleanText(text).replace(/\s+/g, ' ').trim();
  text = dedupeRepeatedPrefixBeforeColon(text);
  if (!text || /^(none|n\/a|unknown)$/i.test(text)) return null;
  return dedupeRepeatedPhrase(text).slice(0, 90) || null;
}

function dedupeRepeatedPrefixBeforeColon(text) {
  const colon = text.indexOf(':');
  if (colon < 1) return text;
  const prefix = text.slice(0, colon).trim();
  const deduped = dedupeRepeatedPhrase(prefix);
  return deduped + text.slice(colon);
}

function dedupeRepeatedPhrase(text) {
  const words = text.split(/\s+/);
  if (words.length % 2 === 0) {
    const half = words.length / 2;
    const left = words.slice(0, half).join(' ');
    const right = words.slice(half).join(' ');
    if (left.toLowerCase() === right.toLowerCase()) return left;
  }
  return text;
}

function titleCandidates(name, slug = null) {
  const values = [
    name,
    name.replace(/\s*&\s*/g, ' and '),
    name.replace(/\s+&\s+/g, ' '),
    name.replace(/\s*:\s*/g, ' '),
    name.replace(/\s+-\s+/g, ' '),
    name.replace(/\s+\u2022\s+/g, ' '),
    name.replace(/\s+\u2022\s+/g, '/')
  ];
  if (slug) values.push(titleFromSlug(slug));
  return unique(values.map((value) => cleanText(value)).filter(Boolean));
}

function titleFromSlug(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((part) => {
      if (part === 'dr') return 'Dr.';
      if (part === 'and') return 'and';
      if (part === 'lv') return 'Lv.';
      return part.slice(0, 1).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function chunks(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function unique(values) {
  return [...new Set(values)];
}

function normTitle(value) {
  return cleanText(value).replace(/_/g, ' ').toLowerCase();
}

function normKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function wordKeys(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function stripSearchSnippet(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ');
}

function wikiUrl(cfg, title) {
  const base = cfg.api.replace(/\/api\.php$/, '/wiki/');
  return base + encodeURIComponent(String(title || '').replace(/ /g, '_'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
