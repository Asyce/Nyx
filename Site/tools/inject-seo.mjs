// ============================================================
// Inject per-page SEO into the built deploy pages and emit sitemap.xml.
//
// Runs AFTER build-deploy.mjs, operating on .deploy/pengo/*.html so the source
// pages stay clean. Adds: <title>, meta description, canonical, Open Graph,
// Twitter, JSON-LD, and a screen-reader/crawler-only <h1> + light data summary
// (current banner names, active code count). Full datasets stay behind JS.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(__dirname, '..');
const root = path.resolve(siteDir, '..');
const deployDir = path.resolve(root, '.deploy', 'pengo');
const dbDir = path.resolve(root, 'Database');
const require = createRequire(import.meta.url);
const { reflowBannerGroup } = require(path.resolve(root, 'Scraper', 'banners', 'normalize.cjs'));

const ORIGIN = 'https://pengo.gg';
const OG_IMAGE = ORIGIN + '/assets/icon/pengo.png';

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- live data summaries (best-effort) ----
const banners = readJson(path.join(dbDir, 'Banners', 'banners.json'));
const codes = readJson(path.join(dbDir, 'Codes', 'codes.json'));
const now = Date.now();
function currentBanner(bid) {
  if (!banners) return null;
  const g = (banners.games || []).find((x) => x.id === bid);
  if (!g) return null;
  const r = reflowBannerGroup(g, now);
  if (!r.current) return null;
  const names = (r.current.characters || []).map((c) => c.name).filter(Boolean);
  return names.length ? names.join(', ') : null;
}
function codeCount(slug) {
  if (!codes) return 0;
  const g = (codes.games || []).find((x) => x.slug === slug);
  return g ? (g.codes || []).length : 0;
}

const GAMES = {
  'genshin.html':  { slug: '/genshin',  bid: 'genshin',  cslug: 'genshin',  name: 'Genshin Impact',
    tools: 'character ascension & talent materials, the live banner schedule, and active redemption codes' },
  'hsr.html':      { slug: '/hsr',      bid: 'hsr',      cslug: 'hsr',      name: 'Honkai: Star Rail',
    tools: 'character & light cone materials, the warp banner schedule, and active redemption codes' },
  'zzz.html':      { slug: '/zzz',      bid: 'zzz',      cslug: 'zzz',      name: 'Zenless Zone Zero',
    tools: 'agent materials, the channel banner schedule, and active redemption codes' },
  'wuwa.html':     { slug: '/wuwa',     bid: 'wuwa',     cslug: 'wuwa',     name: 'Wuthering Waves',
    tools: 'resonator materials, the convene banner schedule, and active redemption codes' },
  'endfield.html': { slug: '/endfield', bid: 'endfield', cslug: 'endfield', name: 'Arknights: Endfield',
    tools: 'operator materials, banners, and active redemption codes' },
};

function srOnlySection(h1, paras) {
  const style = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;margin:-1px;padding:0;';
  return `<section class="seo-only" style="${style}" aria-label="About this page">`
    + `<h1>${esc(h1)}</h1>`
    + paras.filter(Boolean).map((t) => `<p>${esc(t)}</p>`).join('')
    + `</section>`;
}

function headMeta({ title, descr, url, ld }) {
  return [
    `<meta name="description" content="${esc(descr)}"/>`,
    `<link rel="canonical" href="${url}"/>`,
    `<meta property="og:type" content="website"/>`,
    `<meta property="og:site_name" content="Pengo"/>`,
    `<meta property="og:title" content="${esc(title)}"/>`,
    `<meta property="og:description" content="${esc(descr)}"/>`,
    `<meta property="og:url" content="${url}"/>`,
    `<meta property="og:image" content="${OG_IMAGE}"/>`,
    `<meta name="twitter:card" content="summary"/>`,
    `<meta name="twitter:title" content="${esc(title)}"/>`,
    `<meta name="twitter:description" content="${esc(descr)}"/>`,
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
  ].join('\n');
}

function inject(file, { title, headHtml, bodyHtml }) {
  const fp = path.join(deployDir, file);
  if (!fs.existsSync(fp)) return false;
  let html = fs.readFileSync(fp, 'utf8');
  if (html.includes('<!--seo-injected-->')) return false;
  if (title) html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
  html = html.replace(/<\/head>/i, `${headHtml}\n<!--seo-injected-->\n</head>`);
  if (bodyHtml) html = html.replace(/<body([^>]*)>/i, (m) => `${m}\n${bodyHtml}`);
  fs.writeFileSync(fp, html);
  return true;
}

const website = { '@type': 'WebSite', name: 'Pengo', url: ORIGIN };
let injected = 0;

// ---- per-game pages ----
for (const [file, g] of Object.entries(GAMES)) {
  const url = ORIGIN + g.slug;
  const cur = currentBanner(g.bid);
  const n = codeCount(g.cslug);
  const title = `${g.name} materials, banners & codes — Pengo`;
  const descr = `Pengo's ${g.name} companion: ${g.tools}.` + (cur ? ` Current banner: ${cur}.` : '');
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: title,
    url,
    applicationCategory: 'GameApplication',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    isPartOf: website,
  };
  const paras = [`${g.name} tools on Pengo: ${g.tools}.`];
  if (cur) paras.push(`Current banner: ${cur}.`);
  if (n) paras.push(`${n} active redemption code${n === 1 ? '' : 's'} tracked.`);
  if (inject(file, { title, headHtml: headMeta({ title, descr, url, ld }), bodyHtml: srOnlySection(`${g.name} — materials, banners & codes on Pengo`, paras) })) injected += 1;
}

// ---- Nyx hub ----
{
  const url = ORIGIN + '/nyx';
  const title = 'Nyx — all-games banners, codes & pulls hub — Pengo';
  const descr = 'The Nyx hub on Pengo: banners, redemption codes and pull overviews across Genshin Impact, Honkai: Star Rail, Zenless Zone Zero, Wuthering Waves and Arknights: Endfield in one place.';
  const ld = { '@context': 'https://schema.org', '@type': 'WebPage', name: title, url, isPartOf: website };
  if (inject('nyx.html', { title, headHtml: headMeta({ title, descr, url, ld }),
    bodyHtml: srOnlySection('Nyx — the all-games hub on Pengo', [descr]) })) injected += 1;
}

// ---- homepage ----
{
  const url = ORIGIN + '/';
  const title = 'Pengo — Genshin, Star Rail, ZZZ, Wuthering Waves & Endfield tools';
  const descr = 'Pengo is a companion for Genshin Impact, Honkai: Star Rail, Zenless Zone Zero, Wuthering Waves and Arknights: Endfield — character materials, live banner schedules, redemption codes and pull trackers.';
  const ld = {
    '@context': 'https://schema.org', '@type': 'WebSite', name: 'Pengo', url: ORIGIN,
    description: descr,
  };
  if (inject('index.html', { title, headHtml: headMeta({ title, descr, url, ld }),
    bodyHtml: srOnlySection('Pengo — gacha game companion tools', [
      descr,
      'Choose a game: Genshin Impact, Honkai: Star Rail, Zenless Zone Zero, Wuthering Waves, or Arknights: Endfield.',
    ]) })) injected += 1;
}

// ---- sitemap.xml ----
const routes = ['/', '/nyx', '/genshin', '/hsr', '/zzz', '/wuwa', '/endfield'];
const lastmod = new Date().toISOString().slice(0, 10);
const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + routes.map((r) => `  <url><loc>${ORIGIN}${r}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>${r === '/' ? '1.0' : '0.8'}</priority></url>`).join('\n')
  + '\n</urlset>\n';
fs.writeFileSync(path.join(deployDir, 'sitemap.xml'), sitemap);

console.log(`Injected SEO into ${injected} page(s); wrote sitemap.xml (${routes.length} routes).`);
