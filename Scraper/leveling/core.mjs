/* Character level-up costs, per ascension band.
 *
 * The site used to carry one hard-coded "cost to reach max level" figure per
 * game, so the character page could only quote level-up EXP at the cap — the
 * published book mixes are not a plain greedy fill of the EXP curve, so there
 * was no honest way to price Lv 70 or Lv 80.
 *
 * These wiki pages publish the whole thing: for each level band, the items
 * required, the EXP needed and the currency cost, each with a running subtotal
 * in brackets. The subtotal at a band's end is exactly "what it costs to get a
 * character from Lv 1 to here", which is what the page's ascension slider asks
 * for. (user 2026-08-14)
 *
 * Endfield has no equivalent page and keeps its single max-level figure.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');
const USER_AGENT = 'Nyxarium/1.0 (character leveling tables; https://pengo.gg)';

export const GAME_CONFIG = {
  gi: {
    api: 'https://genshin-impact.fandom.com/api.php',
    page: 'Character EXP',
    section: 'Leveling Characters',
    items: 'gi',
    itemType: 'Character EXP Material',
    currency: { name: 'Mora', id: '202' },
  },
  hsr: {
    api: 'https://honkai-star-rail.fandom.com/api.php',
    page: 'Character EXP',
    section: 'Leveling Characters',
    items: 'hsr',
    itemType: 'Usable',
    currency: { name: 'Credit', id: '2' },
  },
  zzz: {
    api: 'https://zenless-zone-zero.fandom.com/api.php',
    page: 'Agent EXP Material',
    section: 'Agent Leveling',
    items: 'zzz',
    itemType: null,
    // ZZZ's table has no currency column: Dennies are charged per material use,
    // not per level, so the page carries no cost figure to quote.
    currency: null,
  },
  wuwa: {
    api: 'https://wutheringwaves.fandom.com/api.php',
    page: 'Resonator/Leveling',
    section: 'Leveling Resonators',
    items: 'ww',
    itemType: null,
    currency: { name: 'Shell Credit', id: '2' },
  },
};

const number = (value) => Number(String(value ?? '').replace(/[,\s]/g, '')) || 0;

/* The three table dialects differ only in how a cell spells "N of this item,
 * [M] so far":
 *   GI / WuWa   {{Card|Hero's Wit|171 [415]|show_caption=1}}
 *   HSR         {{Card|Traveler's Guide|5|caption=[5]}}
 *   ZZZ         {{Card List|Senior Investigator Log*45 (75);...}}
 * Only the bracketed running subtotal is kept — it is the "Lv 1 to here" figure. */
function parseItemCell(cell) {
  const rows = [];
  for (const match of String(cell).matchAll(/\{\{Card\s*\|([^|}]+)\|([^|}]*)(?:\|caption=([^|}]*))?[^}]*\}\}/g)) {
    const name = match[1].trim();
    const subtotal = /\[([\d,]+)\]/.exec(`${match[2]} ${match[3] ?? ''}`);
    const qty = subtotal ? number(subtotal[1]) : number(match[2]);
    if (name) rows.push({ name, qty });
  }
  for (const match of String(cell).matchAll(/\{\{Card List\|([^}]+)\}\}/g)) {
    for (const part of match[1].split(';')) {
      const parsed = /^\s*([^*]+)\*\s*[\d,]+\s*\(([\d,]+)\)/.exec(part);
      if (parsed) rows.push({ name: parsed[1].trim(), qty: number(parsed[2]) });
    }
  }
  return rows;
}

// "1 → 20" / "50 -> 60": the band's end level is the cap it unlocks.
function parseBandCap(cell) {
  const match = /(\d+)\s*(?:→|->|–|-)\s*(\d+)/.exec(String(cell));
  return match ? { from: Number(match[1]), cap: Number(match[2]) } : null;
}

function bracketed(cell) {
  const inner = /[\[(]\s*([\d,]+)\s*[\])]/.exec(String(cell));
  return inner ? number(inner[1]) : number(String(cell).split(/<br\s*\/?>|\n/)[0]);
}

export function parseLevelingTable(wikitext, sectionTitle, currencyName = null) {
  const isCurrency = (name) => currencyName && String(name).trim().toLowerCase() === String(currencyName).toLowerCase();
  const start = String(wikitext).indexOf(`==${sectionTitle}==`);
  if (start < 0) throw new Error(`section not found: ${sectionTitle}`);
  const tableStart = wikitext.indexOf('{|', start);
  const tableEnd = wikitext.indexOf('|}', tableStart);
  if (tableStart < 0 || tableEnd < 0) throw new Error(`table not found in section: ${sectionTitle}`);
  const table = wikitext.slice(tableStart, tableEnd);

  const bands = [];
  for (const row of table.split(/\n\|-\s*\n?/).slice(1)) {
    if (/^\s*!/.test(row)) continue; // the Total row restates the last subtotal
    const cells = row.split(/\n\|\||\n\||\|\|/).map((cell) => cell.trim()).filter(Boolean);
    if (!cells.length) continue;
    const band = parseBandCap(cells[0]);
    if (!band) continue;
    // HSR wraps its Credit cost in the same {{Card}} template it uses for EXP
    // books, so the currency has to be filtered out of the item list by name.
    const items = cells.flatMap((cell) => parseItemCell(cell))
      .filter((item) => item.qty > 0 && !isCurrency(item.name));
    if (!items.length) continue;
    // The currency column is the last cell that holds a bracketed number and no
    // item template; EXP columns are plain numbers with a bracketed subtotal.
    const numeric = cells.slice(1).filter((cell) => !/\{\{Card/.test(cell) && /[\d,]/.test(cell));
    const currencyCell = currencyName
      ? cells.slice(1).reverse().find((cell) => new RegExp(`\\{\\{(?:Item|Card)\\|${currencyName}\\b`, 'i').test(cell))
        || (numeric.length >= 2 ? numeric[numeric.length - 1] : null)
      : null;
    bands.push({
      from: band.from,
      cap: band.cap,
      exp: numeric.length ? bracketed(numeric[0]) : 0,
      cost: currencyCell ? bracketed(currencyCell) : 0,
      items,
    });
  }
  if (!bands.length) throw new Error(`no level bands parsed from: ${sectionTitle}`);
  return bands;
}

async function fetchWikitext(api, title, fetchImpl) {
  const url = new URL(api);
  Object.entries({
    action: 'query', prop: 'revisions', titles: title,
    rvprop: 'content', rvslots: 'main', format: 'json', formatversion: '2',
  }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetchImpl(url.href, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${api} returned ${response.status}`);
  const data = await response.json();
  const page = data?.query?.pages?.[0];
  const content = page?.revisions?.[0]?.slots?.main?.content;
  if (page?.missing || !content) throw new Error(`wiki page is missing: ${title}`);
  return content;
}

/* Names only get us so far — the page needs the real item id, rarity and icon,
 * which come from the same GameData tables everything else uses. A game can
 * have two items with the same display name (Genshin has a quest item literally
 * called "Adventurer's Experience"), so the EXP-material type wins the tie. */
export async function loadItemIndex(rootDir, config) {
  const file = path.resolve(rootDir, 'Database', 'GameData', config.items, 'live', 'items.json');
  const rows = JSON.parse(await fs.readFile(file, 'utf8'));
  const key = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const index = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = key(row?.name);
    if (!name) continue;
    const preferred = config.itemType && row.type === config.itemType;
    if (!index.has(name) || preferred) index.set(name, { row, preferred });
  }
  return { get: (name) => index.get(key(name))?.row || null };
}

export async function runLevelingSync({ rootDir = DEFAULT_ROOT, fetchImpl = fetch, now = () => new Date(), logger = console } = {}) {
  const outputDir = path.resolve(rootDir, 'Database', 'Leveling');
  await fs.mkdir(outputDir, { recursive: true });
  const generatedAt = now().toISOString();
  const report = { generatedAt, games: {} };

  for (const [game, config] of Object.entries(GAME_CONFIG)) {
    const wikitext = await fetchWikitext(config.api, config.page, fetchImpl);
    const bands = parseLevelingTable(wikitext, config.section, config.currency?.name || null);
    const items = await loadItemIndex(rootDir, config);
    const unresolved = [];
    const stages = bands.map((band) => ({
      cap: band.cap,
      exp: band.exp,
      cost: band.cost,
      items: band.items.map((entry) => {
        const row = items.get(entry.name);
        if (!row) unresolved.push(entry.name);
        return {
          id: row ? String(row.id) : null,
          name: row?.name || entry.name,
          qty: entry.qty,
          rarity: row?.rarity ?? null,
          icon: row?.assets?.icon || null,
        };
      }),
    }));
    if (unresolved.length) throw new Error(`${game}: EXP items not found in GameData: ${[...new Set(unresolved)].join(', ')}`);

    const payload = {
      schemaVersion: 1,
      game,
      generatedAt,
      source: { wiki: config.api, page: config.page, section: config.section },
      currency: config.currency,
      maxLevel: stages[stages.length - 1].cap,
      stages,
    };
    await fs.writeFile(path.join(outputDir, `${game}.json`), `${JSON.stringify(payload, null, 2)}\n`);
    report.games[game] = { stages: stages.length, maxLevel: payload.maxLevel, totalCost: stages[stages.length - 1].cost };
    logger.log(`[${game}] ${stages.length} level bands to Lv ${payload.maxLevel}`);
  }
  return report;
}
