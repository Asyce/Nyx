import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  assertNoUnsafePathCollisions,
  buildDatabaseAssetEntry,
  buildDatabaseAssetManifest,
  inspectDatabaseAssetBytes,
  rewriteDatabaseAssetReferences,
  validateDatabaseSourcePath,
} from '../database-assets.mjs';

async function image(format, width, height) {
  return sharp({
    create: { width, height, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
  })[format]().toBuffer();
}

const PNG = await image('png', 7, 9);
const JPEG = await image('jpeg', 11, 13);
const WEBP = await image('webp', 17, 19);

test('byte sniffing supplies actual media type, extension, and dimensions', async () => {
  assert.deepEqual(await inspectDatabaseAssetBytes(PNG), {
    mediaType: 'image/png', actualExtension: 'png', width: 7, height: 9,
  });
  assert.deepEqual(await inspectDatabaseAssetBytes(JPEG), {
    mediaType: 'image/jpeg', actualExtension: 'jpg', width: 11, height: 13,
  });
  assert.deepEqual(await inspectDatabaseAssetBytes(WEBP), {
    mediaType: 'image/webp', actualExtension: 'webp', width: 17, height: 19,
  });
  const mislabeled = await buildDatabaseAssetEntry('Database/art/not-really-a-jpeg.jpg', PNG);
  assert.match(mislabeled.objectKey, /\.png$/);
  assert.equal(mislabeled.mediaType, 'image/png');
  await assert.rejects(inspectDatabaseAssetBytes(Buffer.from('version https://git-lfs.github.com/spec/v1')), /cannot be decoded/);
});

test('paths and casefold/Unicode collisions fail closed unless bytes are identical', async () => {
  for (const unsafe of [
    '../Database/a.png',
    'Database/../a.png',
    'Database/a\\b.png',
    'Database//a.png',
    'Database/a\nb.png',
  ]) assert.throws(() => validateDatabaseSourcePath(unsafe), /unsafe/);

  const bytes = PNG;
  const first = await buildDatabaseAssetEntry('Database/Art/Caf\u00e9 \u2014 hero\u200b.png', bytes);
  const identical = await buildDatabaseAssetEntry('Database/art/Cafe\u0301 \u2014 hero\u200b.png', bytes);
  assert.doesNotThrow(() => assertNoUnsafePathCollisions([first, identical]));
  const different = await buildDatabaseAssetEntry('Database/art/Cafe\u0301 \u2014 hero\u200b.png', await image('png', 2, 3));
  assert.throws(() => assertNoUnsafePathCollisions([first, different]), /collision has different bytes/);

  const sigma = await buildDatabaseAssetEntry('Database/Greek/\u03a3.png', bytes);
  const finalSigmaSame = await buildDatabaseAssetEntry('Database/Greek/\u03c2.png', bytes);
  assert.doesNotThrow(() => assertNoUnsafePathCollisions([sigma, finalSigmaSame]));
  const finalSigmaDifferent = await buildDatabaseAssetEntry('Database/Greek/\u03c2.png', await image('png', 4, 5));
  assert.throws(() => assertNoUnsafePathCollisions([sigma, finalSigmaDifferent]), /collision has different bytes/);
});

test('production rewriting handles relative, escaped, encoded, Unicode, and spaced paths', async () => {
  const entry = await buildDatabaseAssetEntry('Database/Game Art/Caf\u00e9 \u2014 #1\u200b.png', PNG);
  const escaped = JSON.stringify(entry.sourcePath).slice(1, -1);
  const encoded = entry.sourcePath.split('/').map(encodeURIComponent).join('/');
  const source = `a="../../${entry.sourcePath}" b="../${escaped}" c="${encoded}"`;
  const result = rewriteDatabaseAssetReferences(source, [entry]);
  assert.equal(result.rewritten, 3);
  assert.equal(result.text, `a="${entry.publicUrl}" b="${entry.publicUrl}" c="${entry.publicUrl}"`);
  assert.deepEqual(result.referenced, [entry.sourcePath]);
});

test('production rewriting rejects an image reference absent from the Git inventory', () => {
  assert.throws(
    () => rewriteDatabaseAssetReferences('x="../../Database/not-tracked.png"', []),
    /untracked Database image/,
  );
});

test('manifest generation rejects an empty tracked Database image inventory', async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nyx-empty-database-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(rootDir, 'Database'));
  await fs.writeFile(path.join(rootDir, 'Database', 'README.md'), 'no images\n');
  execFileSync('git', ['init', '--quiet'], { cwd: rootDir });
  execFileSync('git', ['add', 'Database/README.md'], { cwd: rootDir });
  execFileSync('git', [
    '-c', 'user.name=Nyx Test',
    '-c', 'user.email=test@pengo.invalid',
    'commit', '--quiet', '-m', 'empty fixture',
  ], { cwd: rootDir });
  await assert.rejects(
    buildDatabaseAssetManifest({ rootDir }),
    /contains no tracked Database image assets/,
  );
});

test('inventory rejects a Git symlink image entry before reading filesystem image bytes', async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nyx-symlink-database-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(rootDir, 'Database'));
  await fs.writeFile(path.join(rootDir, 'Database', 'link.png'), PNG);
  execFileSync('git', ['init', '--quiet'], { cwd: rootDir });
  const linkBlob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: rootDir,
    input: '../real.png',
    encoding: 'utf8',
  }).trim();
  execFileSync('git', ['update-index', '--add', '--cacheinfo', `120000,${linkBlob},Database/link.png`], { cwd: rootDir });
  execFileSync('git', [
    '-c', 'user.name=Nyx Test',
    '-c', 'user.email=test@pengo.invalid',
    'commit', '--quiet', '-m', 'symlink fixture',
  ], { cwd: rootDir });
  await assert.rejects(
    buildDatabaseAssetManifest({ rootDir, requireClean: false }),
    /Database\/link\.png is not a regular stage-0 Git blob \(mode 120000/,
  );
});
