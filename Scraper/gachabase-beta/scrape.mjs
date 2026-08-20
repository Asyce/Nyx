import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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

function textOf($, selector) {
  return $(selector).first().text().replace(/\s+/g, ' ').trim() || null;
}

function filterText($, key) {
  return $(`a[href*="filter=${key}:"]`).map((_, el) => (
    $(el).text().replace(/\s+/g, ' ').trim()
      || $(el).find('img[alt]').first().attr('alt')?.trim()
      || $(el).find('img[title]').first().attr('title')?.trim()
  )).get().find(Boolean) || null;
}

function parseMaterialRows($, section) {
  const rows = [];
  const seen = new Set();
  $(section).find('a[href*="/items/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const id = href.match(/\/items\/[^/]+\/(\d+)(?:\/|$)/)?.[1];
    const name = $(el).find('img[alt]').first().attr('alt')?.trim() || null;
    const values = $(el).find('span').map((__, span) => $(span).text().replace(/\s+/g, ' ').trim()).get();
    const qtyText = [...values].reverse().find((value) => /^\d[\d,]*$/.test(value));
    const qty = Number(String(qtyText || '').replace(/,/g, ''));
    if (!id || !name || !Number.isFinite(qty) || qty <= 0 || seen.has(id)) return;
    seen.add(id);
    rows.push({ id, name, qty });
  });
  return rows;
}

export function parseAgentDetail(html) {
  const $ = load(html);
  const calculator = $('h2').filter((_, el) => /Materials Calculator/i.test($(el).text())).first();
  const materials = calculator.length ? parseMaterialRows($, calculator.closest('section')) : [];
  const rank = filterText($, 'r')?.match(/([SAB])\s*Rank/i)?.[1] || null;
  const id = textOf($, 'body')?.match(/\bID\s+(\d+)\b/)?.[1] || null;
  return {
    game: 'zzz',
    type: 'agents',
    id,
    name: textOf($, 'h1'),
    rarity: rank,
    specialty: filterText($, 's'),
    attribute: filterText($, 'e'),
    faction: filterText($, 'f'),
    materials,
  };
}

function sameAgentName(left, right) {
  const words = (value) => String(value || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  const a = words(left);
  const b = words(right);
  return a.length > 0 && b.length > 0
    && (a.every((word) => b.includes(word)) || b.every((word) => a.includes(word)));
}

export function sameKnownAgentName(left, right) {
  const keys = (value) => {
    const words = String(value || '').toLowerCase().match(/[a-z0-9]+/g) || [];
    return new Set([words.join(''), [...words].sort().join('')].filter(Boolean));
  };
  const a = keys(left);
  return [...keys(right)].some((key) => a.has(key));
}

export function validateAgentDetail(detail, expected) {
  if (String(detail?.id || '') !== String(expected?.id || '')) {
    throw new Error(`Unexpected agent ID ${detail?.id || 'missing'} for ${expected?.id || 'unknown'}`);
  }
  if (!sameAgentName(detail?.name, expected?.name)) {
    throw new Error(`Unexpected agent name ${detail?.name || 'missing'} for ${expected?.name || 'unknown'}`);
  }
  const missing = ['rarity', 'specialty', 'attribute', 'faction'].filter((key) => !detail?.[key]);
  if (missing.length) throw new Error(`Missing agent metadata: ${missing.join(', ')}`);
  if (!detail?.materials?.length) throw new Error('No Materials Calculator items parsed');
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

function latestZzzAgentEntries(entries) {
  const latest = new Map();
  for (const entry of entries || []) {
    if (entry?.type !== 'agents' || entry?.id === undefined || !entry.href) continue;
    const id = String(entry.id);
    const previous = latest.get(id);
    if (!previous || Number(entry.revision || 0) >= Number(previous.revision || 0)) latest.set(id, entry);
  }
  return [...latest.values()];
}

function zzzBetaAgentIdentity() {
  const file = path.resolve(root, 'Database', 'GameData', 'zzz', 'beta', 'agents.json');
  const rows = readJsonIfExists(file);
  const agents = Array.isArray(rows) ? rows : [];
  return {
    ids: new Set(agents.map((row) => String(row?.id || '')).filter(Boolean)),
    names: agents.flatMap((row) => [row?.name, row?.codeName, row?.profile?.full_name]).filter(Boolean),
  };
}

async function scrapeZzzAgentDetails(entries, previousPayload) {
  const local = zzzBetaAgentIdentity();
  const knownAgent = (row) => local.ids.has(String(row?.id)) || local.names.some((name) => sameKnownAgentName(row?.name, name));
  const previous = new Map((previousPayload?.agentDetails || [])
    .map((detail) => [String(detail?.id || ''), detail])
    .filter(([id, detail]) => id && !knownAgent(detail) && detail?.materials?.length));
  const details = new Map(previous);
  const errors = [];
  for (const entry of latestZzzAgentEntries(entries).filter((row) => !knownAgent(row))) {
    const old = details.get(String(entry.id));
    if (old && Number(old.revision || 0) >= Number(entry.revision || 0)) continue;
    try {
      const detail = parseAgentDetail(await fetchHtml(entry.href));
      validateAgentDetail(detail, entry);
      details.set(String(entry.id), {
        ...entry,
        ...detail,
        id: String(entry.id),
        name: entry.name,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      errors.push(`${entry.id}: ${error.message}`);
      console.warn(`[gachabase-beta] zzz agent ${entry.id}: ${error.message}; ${old ? 'preserved previous detail' : 'no previous detail'}`);
    }
  }
  return { details: [...details.values()], errors };
}

async function scrapeGame(game) {
  const scrapedAt = new Date().toISOString();
  const html = await fetchHtml(game.sourceUrl);
  const $ = load(html);
  const entries = extractEntries(html, game);
  if (!entries.length) throw new Error(`No GachaBase beta entries parsed for ${game.key}`);
  const previous = readJsonIfExists(path.join(outRoot, game.key, 'beta-changelog.json'));
  const agentDetails = game.key === 'zzz' ? await scrapeZzzAgentDetails(entries, previous) : { details: [], errors: [] };
  if (agentDetails.errors.length) throw new Error(`Agent detail refresh failed: ${agentDetails.errors.join('; ')}`);
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
      agentDetails: agentDetails.details.length,
      byType: countBy(entries, (entry) => entry.type),
      byStatus: countBy(entries, (entry) => entry.status),
    },
    entries,
    ...(agentDetails.details.length ? { agentDetails: agentDetails.details } : {}),
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

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(`[gachabase-beta] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
