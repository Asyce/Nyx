import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(__dirname, '..');
const root = path.resolve(siteDir, '..');
const deployDir = path.resolve(root, '.deploy', 'pengo');

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
  return { copied, missing };
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
const files = await listFiles(deployDir);
const totalBytes = (await Promise.all(files.map(async (file) => (await fs.stat(file)).size)))
  .reduce((sum, size) => sum + size, 0);

console.log(`Built ${path.relative(root, deployDir)} with ${files.length} files (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
console.log(`Copied ${databaseAssets.copied} referenced Database asset(s); ${databaseAssets.missing} missing reference(s)`);
