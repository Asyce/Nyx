// Downloads any Nanoka CDN icons referenced by the banner data into the local
// Database mirror, so the generated site never loads character art from an
// external host at runtime. Idempotent: files already present are skipped.
//
//   remote  https://static.nanoka.cc/assets/<game>/<rest>
//   local   Database/Nanoka/<game>/assets/<rest>
//
// generate-site-data.mjs (localImageRef) rewrites the same URLs to the local
// path form, so running this before a build keeps the two in sync.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const dbDir = path.resolve(root, 'Database');
const bannersFile = path.resolve(dbDir, 'Banners', 'banners.json');
const fetchTimeoutMs = 20_000;
const concurrency = 12;

const REMOTE_RE = /https:\/\/static\.nanoka\.cc\/assets\/([^/]+)\/([^"\\]+?\.(?:webp|png|jpe?g))/gi;

function collectUrls() {
  const sources = [bannersFile];
  const urls = new Map(); // url -> { game, rest }
  for (const file of sources) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(REMOTE_RE)) {
      urls.set(match[0], { game: match[1], rest: match[2] });
    }
  }
  return urls;
}

async function download(url, dest) {
  if (fs.existsSync(dest)) return 'cached';
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 Nyx scraper' },
      signal: AbortSignal.timeout(fetchTimeoutMs),
    });
    if (!response.ok) return 'missing';
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
    return 'downloaded';
  } catch {
    return 'missing';
  }
}

async function mapLimit(entries, limit, mapper) {
  const out = new Array(entries.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, entries.length) }, async () => {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= entries.length) return;
      out[current] = await mapper(entries[current]);
    }
  });
  await Promise.all(workers);
  return out;
}

const entries = [...collectUrls().entries()].map(([url, { game, rest }]) => ({
  url,
  dest: path.resolve(dbDir, 'Nanoka', game, 'assets', rest),
}));

if (!entries.length) {
  console.log('No Nanoka CDN icons referenced — nothing to localize.');
  process.exit(0);
}

const results = await mapLimit(entries, concurrency, ({ url, dest }) => download(url, dest));
const count = (status) => results.filter((r) => r === status).length;
console.log(`Localized Nanoka icons: ${count('downloaded')} downloaded, ${count('cached')} cached, ${count('missing')} missing (of ${entries.length}).`);
if (count('missing')) {
  console.warn('Some icons could not be downloaded; they will 404 locally until re-run.');
  process.exitCode = 1;
}
