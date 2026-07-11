import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const dbDir = path.resolve(root, 'Database');
const outDir = path.resolve(dbDir, 'Ambr', 'gi', 'gcg');
const lang = process.argv.includes('--lang')
  ? process.argv[process.argv.indexOf('--lang') + 1] || 'en'
  : 'en';
const endpoints = [
  `https://api.ambr.top/v2/${lang}/gcg`,
  `https://api.ambr.top/v2/${lang}/gcg/card`,
  `https://api.ambr.top/v2/${lang}/gcg/cards`,
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive:true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

async function fetchJsonOptional(url) {
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0 Nyx scraper',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return { ok:false, status:response.status, statusText:response.statusText };
    return { ok:true, data:await response.json() };
  } catch (error) {
    return { ok:false, error:error.message };
  }
}

function normalizeCards(payload) {
  const data = payload?.data || payload?.items || payload;
  const rows = Array.isArray(data) ? data : Object.entries(data || {}).map(([id, row]) => ({ id, ...row }));
  return rows.map((row) => ({
    id:String(row.id || row.ID || row.cardId || row.card_id || ''),
    name:row.name || row.Name || row.title || row.en || null,
    title:row.title || row.Title || null,
    description:row.description || row.desc || row.Desc || row.effect || row.story || null,
    type:row.type || row.Type || null,
    icon:row.icon || row.Icon || null,
    tags:Array.isArray(row.tags) ? row.tags : Array.isArray(row.tag) ? row.tag : [],
    source:'AMBR',
  })).filter((row) => row.id && row.name);
}

ensureDir(outDir);
const attempts = [];
let cards = [];
let sourceUrl = null;
for (const endpoint of endpoints) {
  const result = await fetchJsonOptional(endpoint);
  attempts.push({ endpoint, ok:result.ok, status:result.status || null, error:result.error || result.statusText || null });
  if (!result.ok) continue;
  cards = normalizeCards(result.data);
  if (cards.length) {
    sourceUrl = endpoint;
    writeJson(path.resolve(outDir, `raw-${lang}.json`), result.data);
    break;
  }
}

const report = {
  generatedAt:new Date().toISOString(),
  source:'AMBR',
  language:lang,
  sourceUrl,
  attempts,
  count:cards.length,
  note:cards.length
    ? 'AMBR GCG cards scraped successfully. GameData remains the primary local art source.'
    : 'AMBR endpoint was unavailable or did not return a recognized GCG card payload. This scraper is optional and safe to rerun.',
};

writeJson(path.resolve(outDir, `cards-${lang}.json`), cards);
writeJson(path.resolve(outDir, `report-${lang}.json`), report);
console.log(JSON.stringify({ wrote:path.relative(root, outDir).replace(/\\/g, '/'), count:cards.length, sourceUrl }, null, 2));
