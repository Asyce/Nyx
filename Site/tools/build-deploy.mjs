import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(__dirname, '..');
const root = path.resolve(siteDir, '..');
const deployDir = path.resolve(root, '.deploy', 'pengo');
const execFileAsync = promisify(execFile);

const runtimeDirs = [
  ['assets', path.resolve(siteDir, 'assets')],
  ['dist', path.resolve(siteDir, 'dist')],
  ['src/styles', path.resolve(siteDir, 'src', 'styles')],
];

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

async function copyDir(src, dest) {
  await fs.cp(src, dest, { recursive: true });
}

async function gitValue(args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: root });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function listFiles(dir) {
  const out = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(next);
      else out.push(next);
    }
  }
  await walk(dir);
  return out;
}

function databaseRefsFromText(text) {
  const refs = new Set();
  const re = /(?:\.\.\/)*Database\/[^"`),\]\s]+(?: [^"`),\]\s]+)*/g;
  for (const match of text.matchAll(re)) {
    const value = match[0].replace(/^(?:\.\.\/)*/, '');
    if (/\.(?:png|jpe?g|webp|gif|svg|ico|ttf|woff2?)$/i.test(value)) refs.add(value);
  }
  return refs;
}

async function copyReferencedDatabaseAssets() {
  const scanDirs = [
    path.resolve(siteDir, 'dist'),
    path.resolve(siteDir, 'pages'),
    path.resolve(siteDir, 'src', 'styles'),
  ];
  const refs = new Set();
  for (const dir of scanDirs) {
    if (!(await exists(dir))) continue;
    for (const file of await listFiles(dir)) {
      if (!/\.(?:html|css|js)$/i.test(file)) continue;
      const text = await fs.readFile(file, 'utf8');
      for (const ref of databaseRefsFromText(text)) refs.add(ref);
    }
  }

  let copied = 0;
  let missing = 0;
  for (const ref of [...refs].sort()) {
    const src = path.resolve(root, ref);
    if (!(await exists(src))) {
      missing += 1;
      continue;
    }
    await copyFile(src, path.resolve(deployDir, ref));
    copied += 1;
  }
  return { copied, missing, refs };
}

function webPath(value) {
  return '/' + String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function webpRef(ref) {
  return String(ref || '').replace(/\.(?:png|jpe?g)$/i, '.webp');
}

function shouldGenerateArtworkWebpRef(ref) {
  const value = String(ref || '').replace(/\\/g, '/');
  if (!/\.(?:png|jpe?g)$/i.test(value)) return false;
  if (/^assets\/(?:char|banner)\//i.test(value)) return true;
  if (/^assets\/bg\/(?:noxbg|gibg2|hsrbg|zzzbg3|wuwabg2|aebg)\.(?:png|jpe?g)$/i.test(value)) return true;
  if (!value.startsWith('Database/')) return false;
  return (
    /\/assets\/(?:characters|items|operators|weapons|light-cones|w-engines|bangboo|drive-discs|relic-sets|echoes)\//i.test(value) ||
    /\/(?:birthday-art|holiday-art|banners?)\//i.test(value) ||
    /\/(?:banner|splash|namecard|art|icon)\.(?:png|jpe?g)$/i.test(value)
  );
}

async function collectSiteArtworkRefs() {
  const refs = new Set();
  const assetsDir = path.resolve(siteDir, 'assets');
  if (!(await exists(assetsDir))) return refs;
  for (const file of await listFiles(assetsDir)) {
    const rel = 'assets/' + path.relative(assetsDir, file).replace(/\\/g, '/');
    if (shouldGenerateArtworkWebpRef(rel)) refs.add(rel);
  }
  return refs;
}

async function findFfmpeg() {
  try {
    await execFileAsync('ffmpeg', ['-version'], { cwd: root });
    return 'ffmpeg';
  } catch {
    return null;
  }
}

async function mapLimit(items, limit, fn) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function generateWebpVariants(databaseRefs) {
  const refs = new Set();
  for (const ref of databaseRefs || []) {
    if (shouldGenerateArtworkWebpRef(ref)) refs.add(ref);
  }
  for (const ref of await collectSiteArtworkRefs()) refs.add(ref);

  const targets = [...refs].sort();
  const manifest = new Set();
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg || targets.length === 0) {
    return { generated: 0, failed: 0, skipped: targets.length, manifest };
  }

  let generated = 0;
  let failed = 0;
  await mapLimit(targets, 3, async (ref) => {
    const src = ref.startsWith('assets/')
      ? path.resolve(siteDir, ref)
      : path.resolve(root, ref);
    if (!(await exists(src))) return;
    const outRef = webpRef(ref);
    const dest = path.resolve(deployDir, outRef);
    try {
      await ensureDir(path.dirname(dest));
      await execFileAsync(ffmpeg, [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-i', src,
        '-frames:v', '1',
        '-c:v', 'libwebp',
        '-q:v', '92',
        '-compression_level', '6',
        dest,
      ], { cwd: root, maxBuffer: 1024 * 1024 });
      manifest.add(webPath(outRef));
      generated += 1;
    } catch {
      failed += 1;
    }
  });

  return { generated, failed, skipped: targets.length - generated - failed, manifest };
}

async function writeWebpManifest(manifest) {
  const entries = {};
  for (const item of [...manifest].sort()) entries[item] = 1;
  const body = 'window.NYX_WEBP_MANIFEST = Object.freeze(' + JSON.stringify(entries) + ');\n';
  await ensureDir(path.resolve(deployDir, 'dist'));
  await ensureDir(path.resolve(siteDir, 'dist'));
  await fs.writeFile(path.resolve(deployDir, 'dist', 'artwork-webp-manifest.js'), body);
  await fs.writeFile(path.resolve(siteDir, 'dist', 'artwork-webp-manifest.js'), body);
}

async function writeVersionFile() {
  const commit = process.env.PENGO_DEPLOY_COMMIT || process.env.GITHUB_SHA || await gitValue(['rev-parse', 'HEAD']);
  const shortCommit = commit ? commit.slice(0, 8) : await gitValue(['rev-parse', '--short', 'HEAD']);
  const branch = process.env.PENGO_DEPLOY_BRANCH || process.env.GITHUB_REF_NAME || await gitValue(['branch', '--show-current']);
  const version = {
    app: 'pengo-nyx',
    builtAt: new Date().toISOString(),
    commit,
    shortCommit,
    branch,
  };
  await fs.writeFile(path.resolve(deployDir, 'version.json'), JSON.stringify(version, null, 2) + '\n');
}

await fs.rm(deployDir, { recursive: true, force: true });
await ensureDir(deployDir);

for (const page of await fs.readdir(path.resolve(siteDir, 'pages'))) {
  if (page.endsWith('.html')) {
    await copyFile(path.resolve(siteDir, 'pages', page), path.resolve(deployDir, page));
  }
}

for (const [target, source] of runtimeDirs) {
  await copyDir(source, path.resolve(deployDir, target));
}

// Static deploy-root files: _redirects, _headers, robots.txt, 404.html,
// scripts/, etc. Files land at the deploy root; subdirectories are copied whole.
const publicDir = path.resolve(siteDir, 'public');
if (await exists(publicDir)) {
  for (const entry of await fs.readdir(publicDir, { withFileTypes: true })) {
    const src = path.resolve(publicDir, entry.name);
    const dest = path.resolve(deployDir, entry.name);
    if (entry.isDirectory()) await copyDir(src, dest);
    else await copyFile(src, dest);
  }
}

const databaseAssets = await copyReferencedDatabaseAssets();
const webpVariants = await generateWebpVariants(databaseAssets.refs);
await writeWebpManifest(webpVariants.manifest);
await writeVersionFile();
const files = await listFiles(deployDir);
const totalBytes = (await Promise.all(files.map(async (file) => (await fs.stat(file)).size)))
  .reduce((sum, size) => sum + size, 0);

console.log(`Built ${path.relative(root, deployDir)} with ${files.length} files (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
console.log(`Copied ${databaseAssets.copied} referenced Database asset(s); ${databaseAssets.missing} missing reference(s)`);
console.log(`Generated ${webpVariants.generated} optional WebP artwork variant(s); ${webpVariants.failed} failed; ${webpVariants.skipped} skipped`);
