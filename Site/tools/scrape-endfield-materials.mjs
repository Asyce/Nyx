// Scrape Arknights: Endfield progression materials (ascension / skill-upgrade
// items) + currencies from endfield.wiki.gg, mirroring scrape-endfield-skill-icons.
// Each material page carries its icon at /images/<PageName>.png and a `rarity-N`
// CSS class in the DRUID infobox. We download the full-size icon and record
// name + rarity into a manifest the site generator can look up by normalized
// name. Self-contained; writes only under EndfieldWiki/endfield/material-icons.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const dbDir = path.resolve(root, 'Database');
const outDir = path.resolve(dbDir, 'EndfieldWiki', 'endfield', 'material-icons');
const manifestPath = path.resolve(outDir, 'manifest.json');
const API = 'https://endfield.wiki.gg/api.php';
const BASE = 'https://endfield.wiki.gg';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NyxEndfieldMaterialScraper/1.0';
const TIMEOUT = 20_000;
// Live (non-"Beta Test:") material + currency categories. Beta Test duplicates
// are skipped so we ship release names/icons.
const CATEGORIES = ['Progression Materials', 'Currencies'];

const force = process.argv.includes('--force');
const normName = (s) => String(s || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}
async function fetchImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok || !/image/i.test(res.headers.get('content-type') || '')) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 400 ? buf : null;
}
const thumbToFull = (u) => u.replace('/images/thumb/', '/images/').replace(/\/\d+px-[^/]+$/, '');

async function categoryPages(cat) {
  const out = [];
  let cont = '';
  do {
    const j = await fetchJson(`${API}?action=query&list=categorymembers&cmtitle=${encodeURIComponent('Category:' + cat)}&cmtype=page&cmlimit=500&format=json&formatversion=2${cont}`);
    for (const m of j?.query?.categorymembers || []) {
      if (!/^Beta Test:/i.test(m.title)) out.push(m.title);
    }
    cont = j?.continue?.cmcontinue ? `&cmcontinue=${encodeURIComponent(j.continue.cmcontinue)}` : '';
  } while (cont);
  return out;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = (!force && fs.existsSync(manifestPath)) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};

  const titles = [...new Set((await Promise.all(CATEGORIES.map(categoryPages))).flat())];
  let ok = 0, miss = 0;
  for (const title of titles) {
    const j = await fetchJson(`${API}?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&formatversion=2`);
    let text = j?.parse?.text || '';
    if (typeof text === 'object') text = text['*'] || '';

    // Icon: the infobox holds the full-size image at /images/<PageName>.png. Match
    // it directly; fall back to the first non-thumb /images/ png on the page.
    const wantFile = title.replace(/ /g, '_') + '.png';
    let src = null;
    const direct = text.match(new RegExp(`src="([^"]*\\/images\\/${wantFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*)"`, 'i'));
    if (direct) src = direct[1];
    if (!src) { const any = text.match(/src="([^"]*\/images\/(?!thumb\/)[^"]+\.png[^"]*)"/i); if (any) src = any[1]; }
    if (!src) { miss += 1; console.log(`${title}: no icon`); continue; }

    let url = src.startsWith('/') ? BASE + src : src;
    url = thumbToFull(url);
    const file = decodeURIComponent(url.split('/').pop().split('?')[0]);
    const dest = path.resolve(outDir, file);
    try {
      if (force || !fs.existsSync(dest)) { const buf = await fetchImage(url); if (buf) fs.writeFileSync(dest, buf); }
    } catch { /* leave missing */ }
    if (!fs.existsSync(dest)) { miss += 1; console.log(`${title}: download failed`); continue; }

    const rm = text.match(/rarity-(\d)/i) || text.match(/Rarity[\s\S]{0,80}?>(\d)\s*</i);
    const rar = rm ? Number(rm[1]) : null;
    manifest[normName(title)] = {
      name: title,
      icon: `EndfieldWiki/endfield/material-icons/${file}`,
      ...(rar ? { rar } : {}),
    };
    ok += 1;
    console.log(`${title}: ok (rar ${rar ?? '?'})`);
    await sleep(150);
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`AE materials: ${ok} ok, ${miss} missing of ${titles.length}`);
}
main();
