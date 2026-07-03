import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const dbDir = path.resolve(root, 'Database');
const outDir = path.resolve(dbDir, 'Nanoka', 'gi', 'gcg');
const sourceUrl = 'https://gi.nanoka.cc/gcg';
const fetchTimeoutMs = 20_000;

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
    const p = path.resolve(dbDir, 'Nanoka', 'gi', 'assets', 'items', file);
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

function writeCards(folderName, cards) {
  const folder = path.resolve(outDir, folderName);
  const assetsDir = path.resolve(folder, 'assets');
  ensureDir(assetsDir);
  const rows = cards.map((card) => {
    const src = assetForIcon(card.icon);
    let localAsset = null;
    if (src) {
      const file = `${card.id}-${cleanFileName(card.name)}.webp`;
      const dest = path.resolve(assetsDir, file);
      fs.copyFileSync(src, dest);
      localAsset = path.relative(dbDir, dest).replace(/\\/g, '/');
    }
    return { ...card, localAsset };
  });
  fs.writeFileSync(path.resolve(folder, 'cards.json'), JSON.stringify(rows, null, 2), 'utf8');
  return rows;
}

const response = await fetch(sourceUrl, {
  redirect: 'follow',
  headers: { 'user-agent': 'Mozilla/5.0 Nyx scraper' },
  signal: AbortSignal.timeout(fetchTimeoutMs),
});
if (!response.ok) throw new Error(`Nanoka GCG scrape failed: ${response.status} ${response.statusText}`);
const html = await response.text();

ensureDir(path.resolve(outDir, 'raw'));
fs.writeFileSync(path.resolve(outDir, 'raw', 'page.html'), html, 'utf8');

const payloads = {};
const scriptRe = /<script[^>]*type="application\/json"[^>]*data-sveltekit-fetched[^>]*data-url="([^"]+)"[^>]*>([\s\S]*?)<\/script>/g;
for (const match of html.matchAll(scriptRe)) {
  const dataUrl = decodeHtmlEntities(match[1]);
  const wrapper = JSON.parse(decodeHtmlEntities(match[2]));
  const body = JSON.parse(wrapper.body);
  if (/\/gcg\.json$/i.test(dataUrl)) payloads.gcg = body;
  if (/\/gcg\/card\.json$/i.test(dataUrl)) payloads.card = body;
}

if (!payloads.gcg) throw new Error('Could not find Nanoka GCG card payload in page HTML.');
fs.writeFileSync(path.resolve(outDir, 'raw', 'gcg.json'), JSON.stringify(payloads.gcg, null, 2), 'utf8');
if (payloads.card) fs.writeFileSync(path.resolve(outDir, 'raw', 'card.json'), JSON.stringify(payloads.card, null, 2), 'utf8');

const playable = readJson('Nanoka/gi/live/characters.json')
  .filter((ch) => ch?.name && (ch.rarity === 4 || ch.rarity === 5));
const aliases = playableAliases(playable);

const characterCards = [];
const otherCards = [];
for (const [id, raw] of Object.entries(payloads.gcg)) {
  const rawName = raw.en || raw.name || raw.title || id;
  const playableName = raw.type === 'Character' ? matchPlayable([rawName, raw.title, raw.icon], aliases) : null;
  const name = String(rawName).startsWith('#{') && playableName ? playableName : rawName;
  const card = {
    id,
    name,
    title: raw.title || null,
    description: raw.desc || null,
    localizedNames: {
      ...(raw.en ? { en: raw.en } : {}),
      ...(raw.zh ? { zh: raw.zh } : {}),
      ...(raw.ja ? { ja: raw.ja } : {}),
      ...(raw.ko ? { ko: raw.ko } : {}),
    },
    type: raw.type || null,
    cost: Number.isFinite(Number(raw.cost)) ? Number(raw.cost) : null,
    hp: Number.isFinite(Number(raw.hp)) ? Number(raw.hp) : null,
    relatedCardId: raw.relate ? String(raw.relate) : null,
    icon: raw.icon || null,
    tags: raw.tag || [],
    playableCharacter: playableName,
  };
  if (playableName) characterCards.push(card);
  else otherCards.push(card);
}

const writtenCharacterCards = writeCards('character cards', characterCards);
const writtenOtherCards = writeCards('other cards', otherCards);

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
