import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTextWithFallback } from './lib/html-fetch.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const dbDir = path.resolve(root, 'Database');
const outDir = path.resolve(dbDir, 'GameData', 'gi', 'gcg');
const sourceUrl = 'https://gi.nanoka.cc/gcg';
const fetchTimeoutMs = 20_000;
const detailConcurrency = 16;

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.resolve(dbDir, rel), 'utf8'));
}

function normName(s) {
  return String(s || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanFileName(s) {
  return String(s || 'card')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    // Deploy asset scanner treats commas/parens/brackets/backticks as ref
    // terminators (e.g. "Awesome, Bro"), so keep them out of asset paths.
    .replace(/[,()\[\]`]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function assetForIcon(icon) {
  if (!icon) return null;
  const stem = String(icon).replace(/\.webp$/i, '');
  const candidates = [
    `${stem}.webp`,
    `UI_${stem}.webp`,
    stem.replace(/^Gcg_/i, 'UI_Gcg_') + '.webp',
  ];
  for (const file of candidates) {
    const p = path.resolve(dbDir, 'GameData', 'gi', 'assets', 'items', file);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function playableAliases(characters) {
  const aliases = new Map();
  const add = (name, actual) => {
    const key = normName(name);
    if (key) aliases.set(key, actual);
  };
  for (const ch of characters) {
    add(ch.name, ch.name);
    const parts = String(ch.name || '').split(/\s+/);
    if (parts.length > 1) add(parts[parts.length - 1], ch.name);
  }
  const manual = {
    alhatham: 'Alhaitham',
    alhaitham: 'Alhaitham',
    ambor: 'Amber',
    ayaka: 'Kamisato Ayaka',
    ayato: 'Kamisato Ayato',
    baizhuer: 'Baizhu',
    feiyan: 'Yanfei',
    heizo: 'Shikanoin Heizou',
    heizou: 'Shikanoin Heizou',
    hutao: 'Hu Tao',
    itto: 'Arataki Itto',
    kokomi: 'Sangonomiya Kokomi',
    liney: 'Lyney',
    linette: 'Lynette',
    liuyun: 'Xianyun',
    momoka: 'Kirara',
    noel: 'Noelle',
    olorun: 'Ororon',
    qin: 'Jean',
    sara: 'Kujou Sara',
    shinobu: 'Kuki Shinobu',
    shougun: 'Raiden Shogun',
    skirknew: 'Skirk',
    tohma: 'Thoma',
    yae: 'Yae Miko',
  };
  Object.entries(manual).forEach(([alias, actual]) => add(alias, actual));
  return aliases;
}

function matchPlayable(values, aliases) {
  const candidates = Array.isArray(values) ? values : [values];
  for (const value of candidates) {
    const direct = aliases.get(normName(value));
    if (direct) return direct;
  }
  for (const value of candidates) {
    const tokens = String(value || '').split(/[^A-Za-z0-9]+/).filter(Boolean);
    for (const token of tokens) {
      const direct = aliases.get(normName(token));
      if (direct) return direct;
    }
  }
  for (const value of candidates) {
    const normalized = normName(value);
    for (const [alias, actual] of aliases.entries()) {
      if (alias.length >= 5 && normalized.endsWith(alias)) return actual;
      if (alias.length >= 5 && normalized.includes('avatar' + alias)) return actual;
    }
  }
  return null;
}

const CARD_ASSET_CDN = 'https://static.nanoka.cc/assets/gi';

async function downloadCardAsset(icon, dest) {
  if (!icon) return false;
  const stem = String(icon).replace(/\.webp$/i, '');
  try {
    const response = await fetch(`${CARD_ASSET_CDN}/${stem}.webp`, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 Nyx scraper' },
      signal: AbortSignal.timeout(fetchTimeoutMs),
    });
    if (!response.ok) return false;
    fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

async function writeCards(folderName, cards) {
  const folder = path.resolve(outDir, folderName);
  const assetsDir = path.resolve(folder, 'assets');
  ensureDir(assetsDir);
  const rows = await mapLimit(cards, detailConcurrency, async (card) => {
    const file = `${card.id}-${cleanFileName(card.name)}.webp`;
    const dest = path.resolve(assetsDir, file);
    const src = assetForIcon(card.icon);
    let localAsset = null;
    if (src) {
      fs.copyFileSync(src, dest);
      localAsset = path.relative(dbDir, dest).replace(/\\/g, '/');
    } else if (await downloadCardAsset(card.icon, dest)) {
      // Newer cards (e.g. new characters) aren't in the local item mirror yet;
      // pull the card face straight from the GameData CDN into the local mirror
      // so no art is left blank and nothing loads externally at runtime.
      localAsset = path.relative(dbDir, dest).replace(/\\/g, '/');
    }
    return { ...card, localAsset };
  });
  fs.writeFileSync(path.resolve(folder, 'cards.json'), JSON.stringify(rows, null, 2), 'utf8');
  return rows;
}

async function fetchJson(url, retries = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 Nyx scraper' },
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError?.message || lastError}`);
}

async function mapLimit(entries, limit, mapper) {
  const out = new Array(entries.length);
  let index = 0;
  const workers = Array.from({ length:Math.min(limit, entries.length) }, async () => {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= entries.length) return;
      out[current] = await mapper(entries[current], current);
    }
  });
  await Promise.all(workers);
  return out;
}

const html = await fetchTextWithFallback(sourceUrl, {
  retries: 3,
  timeoutMs: fetchTimeoutMs,
  userAgent: 'Mozilla/5.0 Nyx scraper',
});

ensureDir(path.resolve(outDir, 'raw'));
fs.writeFileSync(path.resolve(outDir, 'raw', 'page.html'), html, 'utf8');

const payloads = {};
let staticGcgBase = null;
const scriptRe = /<script[^>]*type="application\/json"[^>]*data-sveltekit-fetched[^>]*data-url="([^"]+)"[^>]*>([\s\S]*?)<\/script>/g;
for (const match of html.matchAll(scriptRe)) {
  const dataUrl = decodeHtmlEntities(match[1]);
  const wrapper = JSON.parse(decodeHtmlEntities(match[2]));
  const body = JSON.parse(wrapper.body);
  if (/\/gcg\.json$/i.test(dataUrl)) {
    payloads.gcg = body;
    staticGcgBase = dataUrl.replace(/\/gcg\.json$/i, '');
  }
  if (/\/gcg\/card\.json$/i.test(dataUrl)) payloads.card = body;
}

if (!payloads.gcg) throw new Error('Could not find GameData GCG card payload in page HTML.');
if (!staticGcgBase) throw new Error('Could not determine GameData GCG static API base URL.');
fs.writeFileSync(path.resolve(outDir, 'raw', 'gcg.json'), JSON.stringify(payloads.gcg, null, 2), 'utf8');
if (payloads.card) fs.writeFileSync(path.resolve(outDir, 'raw', 'card.json'), JSON.stringify(payloads.card, null, 2), 'utf8');

const detailEntries = Object.keys(payloads.gcg).map((id) => [id, `${staticGcgBase}/en/gcg/${id}.json`]);
const detailResults = await mapLimit(detailEntries, detailConcurrency, async ([id, url]) => {
  try {
    return [id, await fetchJson(url)];
  } catch (error) {
    console.warn(`Warning: ${error.message}`);
    return [id, null];
  }
});
payloads.details = Object.fromEntries(detailResults.filter(([, detail]) => detail));
payloads.skill = await fetchJson(`${staticGcgBase}/en/gcg/skill.json`).catch((error) => {
  console.warn(`Warning: ${error.message}`);
  return null;
});
fs.writeFileSync(path.resolve(outDir, 'raw', 'details.json'), JSON.stringify(payloads.details, null, 2), 'utf8');
if (payloads.skill) fs.writeFileSync(path.resolve(outDir, 'raw', 'skill.json'), JSON.stringify(payloads.skill, null, 2), 'utf8');

const playable = readJson('GameData/gi/live/characters.json')
  .filter((ch) => ch?.name && (ch.rarity === 4 || ch.rarity === 5));
const aliases = playableAliases(playable);

const characterCards = [];
const otherCards = [];
for (const [id, raw] of Object.entries(payloads.gcg)) {
  const detail = payloads.details[id] || null;
  const rawName = detail?.name || raw.en || raw.name || raw.title || id;
  const playableName = raw.type === 'Character' ? matchPlayable([rawName, raw.title, raw.icon], aliases) : null;
  const name = String(rawName).startsWith('#{') && playableName ? playableName : rawName;
  const card = {
    id,
    name,
    title: detail?.title || raw.title || null,
    description: detail?.desc || raw.desc || null,
    source: detail?.source || null,
    sourceUrl: `${sourceUrl}/${id}`,
    localizedNames: {
      ...(raw.en ? { en: raw.en } : {}),
      ...(raw.zh ? { zh: raw.zh } : {}),
      ...(raw.ja ? { ja: raw.ja } : {}),
      ...(raw.ko ? { ko: raw.ko } : {}),
    },
    type: detail?.type || raw.type || null,
    cost: detail && Object.prototype.hasOwnProperty.call(detail, 'cost') ? detail.cost : (raw.cost ?? null),
    hp: Number.isFinite(Number(detail?.hp ?? raw.hp)) ? Number(detail?.hp ?? raw.hp) : null,
    relatedCardId: detail?.related ? String(detail.related) : (raw.relate ? String(raw.relate) : null),
    icon: detail?.icon || raw.icon || null,
    tags: detail?.tag || raw.tag || [],
    details: detail ? {
      talent: detail.talent || null,
      related: detail.related ? String(detail.related) : null,
    } : null,
    playableCharacter: playableName,
  };
  if (playableName) characterCards.push(card);
  else otherCards.push(card);
}

const writtenCharacterCards = await writeCards('character cards', characterCards);
const writtenOtherCards = await writeCards('other cards', otherCards);

const carded = new Set(writtenCharacterCards.map((card) => normName(card.playableCharacter)));
const missingPlayableCharacters = [...new Set(playable
  .filter((ch) => !carded.has(normName(ch.name)))
  .map((ch) => ch.name))]
  .sort((a, b) => a.localeCompare(b));

const report = {
  generatedAt: new Date().toISOString(),
  sourceUrl,
  payloads: {
    gcg: Object.keys(payloads.gcg).length,
    card: payloads.card ? Object.keys(payloads.card).length : 0,
    details: payloads.details ? Object.keys(payloads.details).length : 0,
    skill: payloads.skill ? Object.keys(payloads.skill).length : 0,
  },
  counts: {
    characterCards: writtenCharacterCards.length,
    otherCards: writtenOtherCards.length,
    missingPlayableCharacters: missingPlayableCharacters.length,
  },
  missingPlayableCharacters,
};

fs.writeFileSync(path.resolve(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`Saved ${writtenCharacterCards.length} character cards and ${writtenOtherCards.length} other cards to ${path.relative(root, outDir)}`);
console.log(`Missing playable character cards: ${missingPlayableCharacters.length}`);
