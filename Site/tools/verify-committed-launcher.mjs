import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '..');
const root = path.resolve(site, '..');
const committedPrefix = 'Site/src/data/generated';
const fixedFiles = ['launcher-codes-v1.json', 'launcher-banners-v1.json'];

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024, ...options });
}

function committedFiles() {
  const stdout = git(['ls-tree', '-r', '--name-only', 'HEAD', '--',
    `${committedPrefix}/launcher-codes-v1.json`,
    `${committedPrefix}/launcher-banners-v1.json`,
    `${committedPrefix}/launcher-art`,
  ], { encoding: 'utf8' });
  return stdout.trim().split(/\r?\n/).filter(Boolean).sort();
}

async function walkFiles(dir, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walkFiles(path.join(dir, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`Launcher package contains a non-file entry: ${relative}`);
  }
  return files;
}

export async function verifyLauncherTree(baseDir) {
  const base = path.resolve(baseDir);
  const actualRelative = [...fixedFiles];
  const artDir = path.join(base, 'launcher-art');
  actualRelative.push(...(await walkFiles(artDir, 'launcher-art')));
  actualRelative.sort();
  const expected = committedFiles();
  const expectedRelative = expected.map((file) => file.slice(`${committedPrefix}/`.length));
  if (JSON.stringify(actualRelative) !== JSON.stringify(expectedRelative)) {
    throw new Error(`Launcher package file list differs from HEAD:\nexpected=${expectedRelative.join(',')}\nactual=${actualRelative.join(',')}`);
  }

  let bytes = 0;
  for (let index = 0; index < expected.length; index += 1) {
    const committed = git(['show', `HEAD:${expected[index]}`]);
    const actual = await fs.readFile(path.join(base, actualRelative[index]));
    if (!actual.equals(committed)) throw new Error(`${actualRelative[index]} bytes differ from HEAD`);
    bytes += actual.length;
  }
  const manifest = await fs.readFile(path.join(base, 'launcher-banners-v1.json'));
  return {
    files: actualRelative.length,
    bytes,
    manifestSha256: crypto.createHash('sha256').update(manifest).digest('hex'),
  };
}

async function cli() {
  const target = process.argv[2] ?? '--source';
  const bases = {
    '--source': path.join(site, 'src', 'data', 'generated'),
    '--dist': path.join(site, 'dist'),
    '--deploy': path.join(root, '.deploy', 'pengo', 'dist'),
  };
  const base = bases[target];
  if (!base) throw new Error('Usage: node verify-committed-launcher.mjs [--source|--dist|--deploy]');
  const result = await verifyLauncherTree(base);
  process.stdout.write(`launcher ${target.slice(2)} matches HEAD: ${result.files} files, ${result.bytes} bytes, manifest sha256 ${result.manifestSha256}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  cli().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
