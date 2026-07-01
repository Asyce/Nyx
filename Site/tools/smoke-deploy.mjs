import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
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
  const routeFile = routeFiles.get(pathname);
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
  for (const page of gamePages) {
    const html = await readDeployText(page);
    if (html.includes('dist/vendor/react')) throw new Error(`${page} still references old React vendor scripts`);
  }
  if (!version.commit || !version.shortCommit) throw new Error('version.json is missing commit metadata');

  console.log('Deploy smoke passed:');
  for (const line of results) console.log('  ' + line);
  console.log(`  script sha256 ${scriptHash}`);
  console.log(`  commit ${version.shortCommit}`);
}

main().catch((error) => {
  console.error('Deploy smoke failed:');
  console.error(error && error.stack || error);
  process.exit(1);
});
