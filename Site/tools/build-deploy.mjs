import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cacheStampForCommit, selectDeployCommit } from './deploy-commit.mjs';
import { publishRuntimeData } from './publish-runtime-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(__dirname, '..');
const root = path.resolve(siteDir, '..');
const deployDir = path.resolve(root, '.deploy', 'pengo');
const execFileAsync = promisify(execFile);
const CLOUDFLARE_ASSET_FILE_LIMIT = 20_000;
// inject-seo.mjs edits HTML in place and adds only sitemap.xml.
const POST_BUILD_FILE_RESERVE = 1;

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
    const value = match[0]
      .replace(/^(?:\.\.\/)*/, '')
      .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
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
  return { copied, missing };
}

async function writeVersionFile() {
  const commit = deployCommit;
  const shortCommit = commit.slice(0, 8);
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

const deployCommit = selectDeployCommit({
  explicitCommit: process.env.PENGO_DEPLOY_COMMIT,
  gitHead: await gitValue(['rev-parse', 'HEAD']),
  githubSha: process.env.GITHUB_SHA,
});

try {
  await fs.rm(deployDir, { recursive: true, force: true });
} catch (err) {
  if (err?.code !== 'EBUSY') throw err;
  // Windows: the folder itself can be locked as another process's working
  // directory (e.g. a local preview server). Clearing its contents is
  // equivalent for a clean rebuild.
  for (const entry of await fs.readdir(deployDir)) {
    await fs.rm(path.resolve(deployDir, entry), { recursive: true, force: true });
  }
}
await ensureDir(deployDir);

// Pages carry a hand-maintained `?v=` cache-buster on script/style URLs; browsers
// keep the old bundle when it isn't bumped. The deploy copy stamps it with the
// commit so every deploy invalidates caches; source pages stay untouched for dev.
const cacheStamp = cacheStampForCommit(deployCommit);
for (const page of await fs.readdir(path.resolve(siteDir, 'pages'))) {
  if (page.endsWith('.html')) {
    const html = await fs.readFile(path.resolve(siteDir, 'pages', page), 'utf8');
    const stamped = html.replace(/\?v=[\w.-]+/g, '?v=' + cacheStamp);
    await ensureDir(deployDir);
    await fs.writeFile(path.resolve(deployDir, page), stamped);
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
const runtimeManifest = await publishRuntimeData({ rootDir:root, deployDir });
await writeVersionFile();
const files = await listFiles(deployDir);
if (files.length > CLOUDFLARE_ASSET_FILE_LIMIT - POST_BUILD_FILE_RESERVE) {
  throw new Error(`Deploy contains ${files.length} files before SEO injection; the conservative limit is ${CLOUDFLARE_ASSET_FILE_LIMIT - POST_BUILD_FILE_RESERVE} (${POST_BUILD_FILE_RESERVE} files reserved under Cloudflare's ${CLOUDFLARE_ASSET_FILE_LIMIT}-file asset limit)`);
}
const totalBytes = (await Promise.all(files.map(async (file) => (await fs.stat(file)).size)))
  .reduce((sum, size) => sum + size, 0);

console.log(`Built ${path.relative(root, deployDir)} with ${files.length} files (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
console.log(`Copied ${databaseAssets.copied} referenced Database asset(s); ${databaseAssets.missing} missing reference(s)`);
console.log(`Published ${runtimeManifest.files.length} allowlisted runtime data file(s)`);
