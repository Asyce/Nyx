// Scrape Genshin character namecards (the wide UI_NameCardPic_<Char>_P art) for
// the ongoing-banner cards (G31). The <Char> token is the same one used in the
// GameData gacha asset (UI_Gacha_AvatarImg_<Char>.webp); enka.network serves the
// namecard by that exact game filename. Characters without a namecard (e.g.
// brand-new/unreleased) are simply skipped — the banner falls back to splash art.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const dbDir = path.resolve(root, 'Database');
const charsPath = path.resolve(dbDir, 'GameData', 'gi', 'live', 'characters.json');
const itemsPath = path.resolve(dbDir, 'GameData', 'gi', 'live', 'raw', 'itemAll.json');
const outDir = path.resolve(dbDir, 'GenshinWiki', 'namecards');
const allOutDir = path.resolve(outDir, 'all');
const manifestPath = path.resolve(outDir, 'manifest.json');
const reportPath = path.resolve(dbDir, 'reports', 'genshin-namecards.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NyxNamecardScraper/1.0';
const TIMEOUT = 20_000;

const args = new Map();
for (const a of process.argv.slice(2)) { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) args.set(m[1], m[2] ?? 'true'); }
const force = args.get('force') === 'true';
const concurrency = Math.max(1, Math.min(8, Number(args.get('concurrency') || 5)));

function normName(s){ return String(s || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

async function fetchImage(url){
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/png,image/*' }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) return null;
  if (!/image/i.test(res.headers.get('content-type') || '')) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 1000 ? buf : null;
}

async function main(){
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(allOutDir, { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const chars = JSON.parse(fs.readFileSync(charsPath, 'utf8'));
  const targets = chars.map((ch) => {
    const m = ch.assets?.gacha?.match(/UI_Gacha_AvatarImg_(.+)\.webp$/);
    return m ? { name:ch.name, token:m[1], dest:path.resolve(outDir, `${m[1]}.png`), rel:`GenshinWiki/namecards/${m[1]}.png` } : null;
  }).filter(Boolean);
  const rawItems = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));
  Object.entries(rawItems).forEach(([id, item]) => {
    if (item?.material_type !== 'MATERIAL_NAMECARD') return;
    const token = String(item.icon || '').replace(/^UI_NameCard(?:Icon|Pic)_/, '');
    if (token) targets.push({ name:item.name, token, dest:path.resolve(allOutDir, `${id}.webp`), webp:true });
  });

  const manifest = (!force && fs.existsSync(manifestPath)) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  let ok = 0, miss = 0, cached = 0;
  const queue = [...targets];
  const worker = async () => {
    while (queue.length){
      const t = queue.shift();
      if (!force && fs.existsSync(t.dest)){ if (t.rel) manifest[normName(t.name)] = t.rel; cached++; continue; }
      const url = `https://enka.network/ui/UI_NameCardPic_${t.token}_P.png`;
      try {
        const buf = await fetchImage(url);
        if (buf){ fs.writeFileSync(t.dest, t.webp ? await sharp(buf).webp({ quality:84 }).toBuffer() : buf); if (t.rel) manifest[normName(t.name)] = t.rel; ok++; }
        else { miss++; }
      } catch { miss++; }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), ok, cached, miss, total: targets.length }, null, 2));
  console.log(`namecards: ${ok} new, ${cached} cached, ${miss} missing of ${targets.length}`);
}

main();
