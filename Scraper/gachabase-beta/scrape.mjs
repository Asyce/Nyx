import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const outRoot = path.resolve(root, 'Database', 'GachaBase');

const GAMES = {
  zzz: {
    key: 'zzz',
    label: 'Zenless Zone Zero',
    baseUrl: 'https://zzz.gachabase.net',
    sourceUrl: 'https://zzz.gachabase.net/changelog/beta?lang=en',
  },
  hsr: {
    key: 'hsr',
    label: 'Honkai: Star Rail',
    baseUrl: 'https://hsr.gachabase.net',
    sourceUrl: 'https://hsr.gachabase.net/changelog/beta?lang=en',
  },
  gi: {
    key: 'gi',
    label: 'Genshin Impact',
    baseUrl: 'https://gi.gachabase.net',
    sourceUrl: 'https://gi.gachabase.net/changelog/beta?lang=en',
  },
};

const USER_AGENT = 'NyxariumBot/1.0 (+https://pengo.gg)';

function parseArgs(argv) {
  const out = { game: 'all' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--game') out.game = argv[++i] || 'all';
    else if (arg.startsWith('--game=')) out.game = arg.slice('--game='.length);
  }
  return out;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function absUrl(baseUrl, href) {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function decodeJsString(value) {
  const raw = String(value || '');
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
  } catch {
    return raw
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
}

function cleanScalar(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'null' || raw === 'undefined') return null;
  return decodeJsString(raw.replace(/^"|"$/g, ''));
}

function typeFromHref(href) {
  return String(href || '').match(/^\/?([^/?#]+)/)?.[1] || 'unknown';
}

function betaMetaFromHref(href) {
  const match = String(href || '').match(/\/beta\/([^/]+)\/(\d+)(?:[/?#]|$)/);
  return match ? { betaVersion: match[1], revision: match[2] } : {};
}

function countBy(rows, keyFn) {
  const out = {};
  for (const row of rows || []) {
    const key = keyFn(row) || 'unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function extractCategoryLinks($, baseUrl) {
  const links = [];
  const seen = new Set();
  $('a[href*="/beta"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !/\/beta(?:[/?#]|$)/.test(href)) return;
    const type = typeFromHref(href);
    const key = `${type}:${href}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({
      type,
      href: absUrl(baseUrl, href),
      text: $(el).text().replace(/\s+/g, ' ').trim() || null,
    });
  });
  return links;
}

function extractEntries(html, game) {
  const entries = [];
  const seen = new Set();
  const entryRe = /\{id:([^,{}]+),rarity:([^,{}]+),name:\{[^{}]*?text:"((?:\\.|[^"\\])*)"[^{}]*?\},icon:"([^"]*)",status:"([^"]*)",href:"([^"]*)"(?:,diff:"([^"]*)")?/g;
  let match;
  while ((match = entryRe.exec(html))) {
    const [, rawId, rawRarity, rawName, iconHash, status, href, diff] = match;
    if (!String(href || '').includes('/beta/')) continue;
    const meta = betaMetaFromHref(href);
    const type = typeFromHref(href);
    const entry = {
      game: game.key,
      type,
      id: cleanScalar(rawId),
      rarity: Number.isFinite(Number(rawRarity)) ? Number(rawRarity) : null,
      name: decodeJsString(rawName),
      iconHash: iconHash || null,
      status,
      href: absUrl(game.baseUrl, href),
      ...(diff ? { diff: absUrl(game.baseUrl, diff) } : {}),
      ...meta,
    };
    const key = `${entry.game}:${entry.type}:${entry.id}:${entry.href}:${entry.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return entries;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'accept': 'text/html,application/xhtml+xml',
      'user-agent': USER_AGENT,
    },
  });
  const html = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  if (!html || html.length < 1000) throw new Error(`Short response for ${url}`);
  return html;
}

async function scrapeGame(game) {
  const scrapedAt = new Date().toISOString();
  const html = await fetchHtml(game.sourceUrl);
  const $ = load(html);
  const entries = extractEntries(html, game);
  if (!entries.length) throw new Error(`No GachaBase beta entries parsed for ${game.key}`);
  return {
    game: game.key,
    label: game.label,
    source: 'GachaBase beta changelog',
    sourceUrl: game.sourceUrl,
    scrapedAt,
    title: $('title').text().replace(/\s+/g, ' ').trim() || null,
    categoryLinks: extractCategoryLinks($, game.baseUrl),
    counts: {
      entries: entries.length,
      byType: countBy(entries, (entry) => entry.type),
      byStatus: countBy(entries, (entry) => entry.status),
    },
    entries,
  };
}

function staleGamePayload(game, error) {
  const file = path.join(outRoot, game.key, 'beta-changelog.json');
  const previous = readJsonIfExists(file);
  if (!previous) return null;
  return {
    ...previous,
    stale: true,
    freshness: {
      ok: false,
      message: error.message,
      checkedAt: new Date().toISOString(),
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selected = args.game === 'all'
    ? Object.values(GAMES)
    : String(args.game).split(',').map((key) => GAMES[key.trim()]).filter(Boolean);
  if (!selected.length) throw new Error(`No supported GachaBase game selected: ${args.game}`);

  ensureDir(outRoot);
  const games = {};
  const errors = [];
  for (const game of selected) {
    try {
      const payload = await scrapeGame(game);
      games[game.key] = payload;
      writeJson(path.join(outRoot, game.key, 'beta-changelog.json'), payload);
      console.log(`[gachabase-beta] ${game.key}: ${payload.counts.entries} entries`);
    } catch (error) {
      const stale = staleGamePayload(game, error);
      if (stale) {
        games[game.key] = stale;
        writeJson(path.join(outRoot, game.key, 'beta-changelog.json'), stale);
        console.warn(`[gachabase-beta] ${game.key}: ${error.message}; preserved previous output`);
      } else {
        errors.push(`${game.key}: ${error.message}`);
        console.error(`[gachabase-beta] ${game.key}: ${error.message}`);
      }
    }
  }

  const entries = Object.values(games).flatMap((payload) => payload.entries || []);
  const combined = {
    generatedAt: new Date().toISOString(),
    source: 'GachaBase beta changelog',
    games,
    counts: {
      entries: entries.length,
      byGame: countBy(entries, (entry) => entry.game),
      byType: countBy(entries, (entry) => `${entry.game}:${entry.type}`),
      byStatus: countBy(entries, (entry) => entry.status),
    },
    entries,
    ...(errors.length ? { errors } : {}),
  };
  writeJson(path.join(outRoot, 'beta-changelog.json'), combined);

  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[gachabase-beta] ${error.stack || error.message}`);
  process.exitCode = 1;
});
