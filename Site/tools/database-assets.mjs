import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

export const DATABASE_ASSET_ORIGIN = 'https://assets.pengo.gg';
export const DATABASE_ASSET_SCHEMA_VERSION = 1;
export const DATABASE_ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.avif']);
export const DATABASE_ASSET_METADATA = Object.freeze({
  canonicalCacheControl: 'public, max-age=31536000, immutable',
  aliasCacheControl: 'public, max-age=300, must-revalidate',
  manifestMediaType: 'application/json; charset=utf-8',
  releaseCacheControl: 'public, max-age=31536000, immutable',
  latestCacheControl: 'public, max-age=60, must-revalidate',
});

function byteOrderCompare(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export async function inspectDatabaseAssetBytes(buffer, sourcePath = '<bytes>') {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  let metadata;
  try {
    metadata = await sharp(buffer, { animated: true, limitInputPixels: false }).metadata();
  } catch (error) {
    throw new Error(`${sourcePath} cannot be decoded as a supported image: ${error.message}`);
  }
  const formats = {
    png: ['image/png', 'png'],
    jpeg: ['image/jpeg', 'jpg'],
    webp: ['image/webp', 'webp'],
    gif: ['image/gif', 'gif'],
    svg: ['image/svg+xml', 'svg'],
    ico: ['image/x-icon', 'ico'],
  };
  let mapped = formats[metadata.format];
  if (metadata.format === 'heif' && buffer.subarray(4, 32).toString('ascii').match(/ftyp(?:avif|avis)/)) {
    mapped = ['image/avif', 'avif'];
  }
  if (!mapped) throw new Error(`${sourcePath} decoded as unsupported image format ${JSON.stringify(metadata.format)}`);
  if (!metadata.width || !metadata.height) throw new Error(`${sourcePath} has invalid ${mapped[0]} dimensions`);
  return {
    mediaType: mapped[0],
    actualExtension: mapped[1],
    width: metadata.width,
    height: metadata.height,
  };
}

export function validateDatabaseSourcePath(sourcePath) {
  if (typeof sourcePath !== 'string' || !sourcePath.startsWith('Database/')) {
    throw new Error(`unsafe Database asset path ${JSON.stringify(sourcePath)}`);
  }
  if (sourcePath.includes('\\') || sourcePath.includes('\0') || sourcePath.includes('\r') || sourcePath.includes('\n')) {
    throw new Error(`unsafe Database asset path ${JSON.stringify(sourcePath)}`);
  }
  const parts = sourcePath.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`unsafe Database asset path ${JSON.stringify(sourcePath)}`);
  }
  return sourcePath;
}

export function encodeAssetKey(key) {
  return key.split('/').map((part) => encodeURIComponent(part)).join('/');
}

export async function buildDatabaseAssetEntry(sourcePath, buffer, assetOrigin = DATABASE_ASSET_ORIGIN) {
  validateDatabaseSourcePath(sourcePath);
  const inspected = await inspectDatabaseAssetBytes(buffer, sourcePath);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const objectKey = `objects/sha256/${sha256.slice(0, 2)}/${sha256}.${inspected.actualExtension}`;
  const legacyKey = `legacy/${sourcePath}`;
  return {
    sourcePath,
    sha256,
    bytes: buffer.length,
    mediaType: inspected.mediaType,
    width: inspected.width,
    height: inspected.height,
    objectKey,
    publicUrl: `${assetOrigin}/${encodeAssetKey(objectKey)}`,
    legacyKey,
  };
}

export function assertNoUnsafePathCollisions(entries) {
  const seen = new Map();
  for (const entry of entries) {
    // JS has no direct Unicode CaseFolding API. Upper-then-lower applies the
    // important multi-code-point and contextual caseless mappings (including
    // Greek final sigma), while NFKC removes compatibility distinctions.
    const folded = entry.sourcePath.normalize('NFKC').toUpperCase().toLowerCase().normalize('NFKC');
    const prior = seen.get(folded);
    if (prior && prior.sourcePath !== entry.sourcePath && prior.sha256 !== entry.sha256) {
      throw new Error(`casefold/Unicode collision has different bytes: ${prior.sourcePath} and ${entry.sourcePath}`);
    }
    if (!prior) seen.set(folded, entry);
  }
}

async function git(rootDir, args, options = {}) {
  return execFileAsync('git', args, {
    cwd: rootDir,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
  });
}

export async function resolveInventoryCommit(rootDir, requestedCommit) {
  const commitish = requestedCommit || process.env.PENGO_DEPLOY_COMMIT || 'HEAD';
  const { stdout } = await git(rootDir, ['rev-parse', '--verify', `${commitish}^{commit}`]);
  return stdout.trim();
}

export async function listIndexedDatabaseAssetPaths(rootDir) {
  const { stdout } = await git(rootDir, ['ls-files', '--stage', '-z', '--', 'Database'], { encoding: 'buffer' });
  return stdout.toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const tab = record.indexOf('\t');
      if (tab < 0) throw new Error(`invalid Git index record ${JSON.stringify(record)}`);
      const [mode, objectId, stage] = record.slice(0, tab).split(' ');
      const sourcePath = validateDatabaseSourcePath(record.slice(tab + 1));
      if (!DATABASE_ASSET_EXTENSIONS.has(path.posix.extname(sourcePath).toLowerCase())) return null;
      if (!['100644', '100755'].includes(mode) || stage !== '0' || !/^[a-f0-9]{40,64}$/i.test(objectId || '')) {
        throw new Error(`${sourcePath} is not a regular stage-0 Git blob (mode ${mode || '<missing>'}, stage ${stage || '<missing>'})`);
      }
      return sourcePath;
    })
    .filter(Boolean)
    .sort(byteOrderCompare);
}

export async function assertDatabaseMatchesCommit(rootDir, commit) {
  const { stdout: head } = await git(rootDir, ['rev-parse', 'HEAD']);
  if (head.trim() !== commit) throw new Error(`inventory commit ${commit} is not checked out at HEAD ${head.trim()}`);
  for (const args of [
    ['diff', '--name-only', '-z', '--cached', commit, '--', 'Database'],
    ['diff', '--name-only', '-z', '--', 'Database'],
  ]) {
    const { stdout } = await git(rootDir, args, { encoding: 'buffer' });
    const changedAssets = stdout.toString('utf8').split('\0').filter(Boolean)
      .filter((sourcePath) => DATABASE_ASSET_EXTENSIONS.has(path.posix.extname(sourcePath).toLowerCase()));
    if (changedAssets.length) {
      throw new Error(`Database image assets must match the exact commit before inventory: ${changedAssets.slice(0, 5).join(', ')}`);
    }
  }
}

export async function buildDatabaseAssetManifest({
  rootDir,
  commit,
  assetOrigin = DATABASE_ASSET_ORIGIN,
  readFile = fs.readFile,
  generatedAt,
  requireClean = true,
} = {}) {
  if (!rootDir) throw new Error('rootDir is required');
  const gitCommit = await resolveInventoryCommit(rootDir, commit);
  if (requireClean) await assertDatabaseMatchesCommit(rootDir, gitCommit);
  const sourcePaths = await listIndexedDatabaseAssetPaths(rootDir);
  if (!sourcePaths.length) {
    throw new Error('exact Git inventory contains no tracked Database image assets; refusing an empty migration manifest');
  }
  const entries = new Array(sourcePaths.length);
  let nextPath = 0;
  await Promise.all(Array.from({ length: Math.min(16, sourcePaths.length) }, async () => {
    while (nextPath < sourcePaths.length) {
      const index = nextPath++;
      const sourcePath = sourcePaths[index];
      const bytes = await readFile(path.resolve(rootDir, ...sourcePath.split('/')));
      if (bytes.subarray(0, 40).toString('utf8').startsWith('version https://git-lfs.github.com/spec/v1')) {
        throw new Error(`${sourcePath} is an unresolved Git LFS pointer`);
      }
      entries[index] = await buildDatabaseAssetEntry(sourcePath, bytes, assetOrigin);
    }
  }));
  assertNoUnsafePathCollisions(entries);
  let deterministicGeneratedAt = generatedAt;
  if (!deterministicGeneratedAt) {
    const { stdout } = await git(rootDir, ['show', '-s', '--format=%cI', gitCommit]);
    deterministicGeneratedAt = stdout.trim();
  }
  const uniqueObjects = new Set(entries.map((entry) => entry.objectKey));
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  return {
    schemaVersion: DATABASE_ASSET_SCHEMA_VERSION,
    gitCommit,
    generatedAt: deterministicGeneratedAt,
    assetOrigin,
    totals: {
      assets: entries.length,
      bytes: totalBytes,
      uniqueObjects: uniqueObjects.size,
    },
    entries,
  };
}

function escapedJsPath(sourcePath) {
  return JSON.stringify(sourcePath).slice(1, -1);
}

function escapedAsciiJsPath(sourcePath) {
  return escapedJsPath(sourcePath).replace(/[^\x20-\x7e]/g, (char) => (
    [...char].map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')
  ));
}

function encodedSourcePath(sourcePath) {
  return sourcePath.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function makeReferenceTrie(entries) {
  const root = new Map();
  for (const entry of entries) {
    for (const value of new Set([
      entry.sourcePath,
      escapedJsPath(entry.sourcePath),
      escapedAsciiJsPath(entry.sourcePath),
      encodedSourcePath(entry.sourcePath),
    ])) {
      let node = root;
      for (const char of value) {
        if (!node.has(char)) node.set(char, new Map());
        node = node.get(char);
      }
      node.entry = entry;
    }
  }
  return root;
}

function matchTrie(text, start, trie) {
  let node = trie;
  let matched = null;
  for (let index = start; index < text.length; index += 1) {
    node = node.get(text[index]);
    if (!node) break;
    if (node.entry) matched = { entry: node.entry, end: index + 1 };
  }
  return matched;
}

export function rewriteDatabaseAssetReferences(text, entries, { strict = true } = {}) {
  const trie = makeReferenceTrie(entries);
  let cursor = 0;
  let output = '';
  let rewritten = 0;
  const referenced = new Set();
  while (cursor < text.length) {
    const databaseAt = text.indexOf('Database/', cursor);
    if (databaseAt < 0) {
      output += text.slice(cursor);
      break;
    }
    let start = databaseAt;
    while (start >= 3 && text.slice(start - 3, start) === '../') start -= 3;
    const matched = matchTrie(text, databaseAt, trie);
    if (!matched) {
      const tail = text.slice(databaseAt).match(/^Database\/[^\s"'`),\]}]+?\.(?:png|jpe?g|webp|gif|svg|ico|avif)(?=$|[?#\s"'`),\]}])/i);
      if (strict && tail) throw new Error(`deploy references an untracked Database image: ${tail[0]}`);
      output += text.slice(cursor, databaseAt + 'Database/'.length);
      cursor = databaseAt + 'Database/'.length;
      continue;
    }
    output += text.slice(cursor, start);
    output += matched.entry.publicUrl;
    cursor = matched.end;
    rewritten += 1;
    referenced.add(matched.entry.sourcePath);
  }
  return { text: output, rewritten, referenced: [...referenced].sort(byteOrderCompare) };
}

export async function writeDatabaseAssetManifest(manifest, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'w' });
}
