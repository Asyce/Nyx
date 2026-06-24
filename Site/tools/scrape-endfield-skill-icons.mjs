// Scrape Arknights: Endfield character skill icons from endfield.wiki.gg (G37).
// Each operator page has a Skills section with 4 icons whose files are named
// Attack-<weapon>.png (Basic), Skill-<Char>.png, Combo-<Char>.png, Ult-<Char>.png.
// We pull the rendered page HTML via the MediaWiki API, extract those img srcs,
// convert the thumb URL to the full-size original, and download.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const dbDir = path.resolve(root, 'Database');
const charsPath = path.resolve(dbDir, 'EndfieldWiki', 'endfield', 'characters.json');
const outDir = path.resolve(dbDir, 'EndfieldWiki', 'endfield', 'skill-icons');
const manifestPath = path.resolve(outDir, 'manifest.json');
const API = 'https://endfield.wiki.gg/api.php';
const BASE = 'https://endfield.wiki.gg';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NyxEndfieldSkillScraper/1.0';
const TIMEOUT = 20_000;

const force = process.argv.includes('--force');
const normName = (s) => String(s || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT) });
  return res.ok ? res.text() : null;
}
async function fetchImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok || !/image/i.test(res.headers.get('content-type') || '')) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 400 ? buf : null;
}
const thumbToFull = (u) => u.replace('/images/thumb/', '/images/').replace(/\/\d+px-[^/]+$/, '');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const raw = JSON.parse(fs.readFileSync(charsPath, 'utf8'));
  const list = Array.isArray(raw) ? raw : (raw.characters || raw.entries || []);
  const manifest = (!force && fs.existsSync(manifestPath)) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  // Basic, Battle Skill, Combo, Ultimate — order matches the in-game skill panel.
  const TYPES = ['Attack', 'Skill', 'Combo', 'Ult'];
  let ok = 0, miss = 0;
  for (const ch of list) {
    const page = ch.pageName || ch.name;
    if (!page) continue;
    const body = await fetchText(`${API}?action=parse&page=${encodeURIComponent(page)}&prop=text&format=json&formatversion=2`);
    let text = '';
    try { const j = JSON.parse(body || '{}'); text = j?.parse?.text || ''; if (typeof text === 'object') text = text['*'] || ''; } catch {}
    const icons = [];
    for (const prefix of TYPES) {
      const m = text.match(new RegExp(`src="([^"]*${prefix}-[^"]*\\.png[^"]*)"`, 'i'));
      if (!m) { icons.push(null); continue; }
      let u = m[1]; if (u.startsWith('/')) u = BASE + u; u = thumbToFull(u);
      const file = decodeURIComponent(u.split('/').pop().split('?')[0]);
      const dest = path.resolve(outDir, file);
      try {
        if (force || !fs.existsSync(dest)) { const buf = await fetchImage(u); if (buf) fs.writeFileSync(dest, buf); }
        icons.push(fs.existsSync(dest) ? `EndfieldWiki/endfield/skill-icons/${file}` : null);
      } catch { icons.push(null); }
    }
    if (icons.some(Boolean)) { manifest[normName(ch.name)] = icons; ok++; } else miss++;
    console.log(`${ch.name}: ${icons.filter(Boolean).length}/4`);
    await sleep(150);
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`AE skill icons: ${ok} chars ok, ${miss} missing of ${list.length}`);
}
main();
