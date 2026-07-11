import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(__dirname, '..');
const root = path.resolve(siteDir, '..');
const deployDir = path.resolve(root, '.deploy', 'pengo');

const routeFiles = new Map([
  ['/', 'index.html'],
  ['/nyx', 'nyx.html'],
  ['/genshin', 'genshin.html'],
  ['/hsr', 'hsr.html'],
  ['/zzz', 'zzz.html'],
  ['/wuwa', 'wuwa.html'],
  ['/endfield', 'endfield.html'],
]);
const routePrefixes = [
  ['/nyx/', 'nyx.html'],
  ['/genshin/', 'genshin.html'],
  ['/hsr/', 'hsr.html'],
  ['/zzz/', 'zzz.html'],
  ['/wuwa/', 'wuwa.html'],
  ['/endfield/', 'endfield.html'],
];

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ps1': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
};

function deployPath(urlPath) {
  const pathname = decodeURIComponent(urlPath.split('?')[0] || '/');
  const routeFile = routeFiles.get(pathname) || (routePrefixes.find(([prefix]) => pathname.startsWith(prefix)) || [])[1];
  const rel = routeFile || pathname.replace(/^\/+/, '');
  const candidate = path.resolve(deployDir, rel);
  if (!candidate.startsWith(deployDir)) return null;
  return candidate;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const file = deployPath(req.url || '/');
      if (!file || !(await exists(file))) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const body = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String(error && error.message || error));
    }
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function readDeployText(rel) {
  return fs.readFile(path.resolve(deployDir, rel), 'utf8');
}

async function assertNotExists(rel) {
  const target = path.resolve(deployDir, rel);
  if (await exists(target)) throw new Error(`${rel} should not exist in deploy output`);
}

async function countFiles(dir) {
  let count = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes:true })) {
    if (entry.isDirectory()) count += await countFiles(path.resolve(dir, entry.name));
    else count += 1;
  }
  return count;
}

async function checkFetch(base, route, contains, minBytes = 500) {
  const res = await fetch(base + route);
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${route} returned ${res.status}`);
  if (text.length < minBytes) throw new Error(`${route} returned suspiciously small body (${text.length} bytes)`);
  if (contains && !text.includes(contains)) throw new Error(`${route} is missing expected text: ${contains}`);
  return text.length;
}

async function main() {
  if (!(await exists(deployDir))) throw new Error(`Missing deploy directory: ${deployDir}`);

  const server = createServer();
  const base = await listen(server);
  const results = [];
  try {
    for (const [route, marker, minBytes] of [
      ['/', 'Pengo'],
      ['/nyx', 'Nyx'],
      ['/genshin', 'Genshin Impact'],
      ['/hsr', 'Honkai: Star Rail'],
      ['/zzz', 'Zenless Zone Zero'],
      ['/wuwa', 'Wuthering Waves'],
      ['/endfield', 'Arknights: Endfield'],
      ['/nyx/codes', 'Nyx'],
      ['/genshin/materials', 'Genshin Impact'],
      ['/genshin/database', 'Genshin Impact'],
      ['/genshin/database/tcg', 'Genshin Impact'],
      ['/genshin/database/serenitea-pot', 'Genshin Impact'],
      ['/genshin/database/wonderland', 'Genshin Impact'],
      ['/genshin/serenitea-pot', 'Genshin Impact'],
      ['/genshin/characters/skirk', 'Genshin Impact'],
      ['/hsr/characters/castorice', 'Honkai: Star Rail'],
      ['/sitemap.xml', '<urlset'],
      ['/version.json', '"app": "pengo-nyx"', 50],
    ]) {
      results.push(`${route} ${await checkFetch(base, route, marker, minBytes)} bytes`);
    }
  } finally {
    await close(server);
  }

  const script = await fs.readFile(path.resolve(deployDir, 'scripts', 'pengo-pulls.ps1'));
  const scriptText = script.toString('utf8');
  const scriptHash = crypto.createHash('sha256').update(script).digest('hex');
  const bundle = await readDeployText('dist/game-page.bundle.js');
  const indexHtml = await readDeployText('index.html');
  const version = JSON.parse(await readDeployText('version.json'));
  const gamePages = ['genshin.html', 'hsr.html', 'zzz.html', 'wuwa.html', 'endfield.html', 'nyx.html'];

  if (!scriptText.includes('Pengo Nyx')) throw new Error('pengo-pulls.ps1 is missing Pengo branding');
  if (scriptText.includes('asyce.com/asivepulled')) throw new Error('pengo-pulls.ps1 contains old helper URL');
  if (!bundle.includes(scriptHash)) throw new Error(`bundle does not contain script SHA-256 ${scriptHash}`);
  if (!bundle.includes('Quick PowerShell command')) throw new Error('bundle missing quick import method copy');
  if (!bundle.includes('Manual CSV backfill')) throw new Error('bundle missing manual CSV import copy');
  if (!bundle.includes('Pengo encrypted sync')) throw new Error('bundle missing encrypted sync UI copy');
  if (!bundle.includes('Monsters and Items could not be loaded.')) throw new Error('bundle missing lazy Database retry state');
  if (!bundle.includes('database/serenitea-pot')) throw new Error('bundle missing canonical nested Database routes');
  if (!bundle.includes('database/wonderland')) throw new Error('bundle missing Wonderland Database route');
  if (!bundle.includes('Search Miliastra Wonderland')) throw new Error('bundle missing accessible Wonderland search');
  if (bundle.includes('asyce.com/asivepulled')) throw new Error('bundle contains old helper URL');
  if (!indexHtml.includes('class="page-bg"')) throw new Error('index page missing restored background layer');
  if (!indexHtml.includes('page-pattern')) throw new Error('index page missing restored pattern background');
  if (!indexHtml.includes('page-vignette')) throw new Error('index page missing restored vignette background');
  if (indexHtml.includes('<video') || indexHtml.includes('index-bg.webm') || indexHtml.includes('index-bg-poster.webp')) throw new Error('index page still references video background assets');
  if (!indexHtml.includes("../assets/bg/backgroundnyx.png")) throw new Error('index page missing Nyx background asset');
  if (indexHtml.includes('id="cosmicBg"') || indexHtml.includes('function drawStars') || indexHtml.includes('function drawGlints')) throw new Error('index page still includes procedural cosmic background');
  await assertNotExists('assets/bg/index-bg.webm');
  await assertNotExists('assets/bg/index-bg-poster.webp');
  await assertNotExists('dist/vendor');
  const expectedDbMinimums = { gi:{ monsters:500, items:9000 }, hsr:{ monsters:500, items:1400 }, zzz:{ monsters:250, items:4500 }, wuwa:{ monsters:250, items:2000 } };
  for (const [game, minimums] of Object.entries(expectedDbMinimums)) {
    const pack = await readDeployText(`dist/db-data-${game}.js`);
    const context = { window:{ dispatchEvent() {} }, CustomEvent:class {} };
    vm.runInNewContext(pack, context, { filename:`db-data-${game}.js` });
    const collections = context.window.NYX_DB_EXTRA?.[game]?.collections || [];
    for (const [key, minimum] of Object.entries(minimums)) {
      const count = Number(pack.match(new RegExp(`"key": "${key}"[\\s\\S]{0,200}?"count": (\\d+)`))?.[1] || 0);
      if (count < minimum) throw new Error(`dist/db-data-${game}.js ${key} count ${count} is below safe minimum ${minimum}`);
    }
    for (const collection of collections) {
      const ids = new Set();
      for (const item of collection.items) {
        const id = String(item.id || '');
        if (!id || ids.has(id)) throw new Error(`dist/db-data-${game}.js ${collection.key} has ${id ? `duplicate id ${id}` : 'an empty id'}`);
        ids.add(id);
      }
    }
  }
  const nyxPayload = await readDeployText('dist/nyx-data.js');
  const nyxContext = { window:{} };
  vm.runInNewContext(nyxPayload, nyxContext, { filename:'nyx-data.js' });
  const wonderland = nyxContext.window.NYX_DB?.games?.gi?.wonderland;
  for (const [key, minimum] of Object.entries({ costumes:500, suits:150, items:1200 })) {
    const rows = wonderland?.[key];
    if (!Array.isArray(rows) || rows.length < minimum) throw new Error(`Wonderland ${key} count is below safe minimum ${minimum}`);
    const ids = rows.map((row) => String(row.id || ''));
    if (ids.some((id) => !id) || new Set(ids).size !== rows.length) throw new Error(`Wonderland ${key} has empty or duplicate ids`);
  }
  if (!wonderland?.version || !wonderland?.langMap?.slot || !wonderland?.langMap?.color) throw new Error('Wonderland version or lang_map filters are missing');
  const deployFileCount = await countFiles(deployDir);
  if (deployFileCount > 19_990) throw new Error(`deploy has ${deployFileCount} files, above the conservative 19,990-file asset limit`);
  for (const page of gamePages) {
    const html = await readDeployText(page);
    if (!html.includes('<base href="/"/>')) throw new Error(`${page} missing root base href for nested routes`);
    if (html.includes('dist/vendor/react')) throw new Error(`${page} still references old React vendor scripts`);
  }
  if (!version.commit || !version.shortCommit) throw new Error('version.json is missing commit metadata');

  console.log('Deploy smoke passed:');
  for (const line of results) console.log('  ' + line);
  console.log(`  script sha256 ${scriptHash}`);
  console.log(`  commit ${version.shortCommit}`);
  console.log(`  deploy files ${deployFileCount}/20000`);
}

main().catch((error) => {
  console.error('Deploy smoke failed:');
  console.error(error && error.stack || error);
  process.exit(1);
});
