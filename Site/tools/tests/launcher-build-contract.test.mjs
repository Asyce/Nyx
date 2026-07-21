import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyLauncherTree } from '../verify-committed-launcher.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '..', '..');
const root = path.resolve(site, '..');

test('byte-verified launcher files have checkout-stable Git attributes', () => {
  const attributes = execFileSync('git', [
    'check-attr', 'text', 'eol',
    '--',
    'Site/src/data/generated/launcher-banners-v1.json',
    'Site/src/data/generated/launcher-codes-v1.json',
    'Site/src/data/generated/launcher-art/021af660df0417d1ddc5cda915459c0af07e6b1adfc4cdd0274245ffbd72a0d8.webp',
  ], { cwd: root, encoding: 'utf8' });
  assert.match(attributes, /launcher-banners-v1\.json: text: set/);
  assert.match(attributes, /launcher-banners-v1\.json: eol: lf/);
  assert.match(attributes, /launcher-codes-v1\.json: text: set/);
  assert.match(attributes, /launcher-codes-v1\.json: eol: lf/);
  assert.match(attributes, /launcher-art\/.+\.webp: text: unset/);
});

test('production build packages committed launcher bytes and keeps regeneration explicit', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(site, 'package.json'), 'utf8'));
  const smoke = await fs.readFile(path.join(site, 'tools', 'smoke-deploy.mjs'), 'utf8');
  assert.match(pkg.scripts.build, /verify:launcher:source/);
  assert.match(pkg.scripts.build, /verify:launcher:dist/);
  assert.doesNotMatch(pkg.scripts.build, /refresh:launcher|generate:launcher-(?:codes|manifest)/);
  assert.match(pkg.scripts['build:generated'], /refresh:launcher/);
  assert.match(pkg.scripts['build:deploy'], /verify:launcher:deploy/);
  assert.match(pkg.scripts['smoke:deploy'], /verify:launcher:deploy/);
  assert.match(smoke, /validatePackagedManifest\(manifest, \{ now: Date\.now\(\) \}\)/);
  assert.doesNotMatch(smoke, /validatePackagedManifest\(manifest, \{ now: generatedAt \}\)/);
});

test('committed launcher verifier rejects byte changes and extra art', async () => {
  const source = path.join(site, 'src', 'data', 'generated');
  const temp = await fs.mkdtemp(path.join(site, 'launcher-verify-test-'));
  try {
    await fs.copyFile(path.join(source, 'launcher-codes-v1.json'), path.join(temp, 'launcher-codes-v1.json'));
    await fs.copyFile(path.join(source, 'launcher-banners-v1.json'), path.join(temp, 'launcher-banners-v1.json'));
    await fs.cp(path.join(source, 'launcher-art'), path.join(temp, 'launcher-art'), { recursive: true });
    await assert.doesNotReject(verifyLauncherTree(temp));

    await fs.appendFile(path.join(temp, 'launcher-banners-v1.json'), ' ');
    await assert.rejects(verifyLauncherTree(temp), /bytes differ from HEAD/);
    await fs.copyFile(path.join(source, 'launcher-banners-v1.json'), path.join(temp, 'launcher-banners-v1.json'));
    await fs.writeFile(path.join(temp, 'launcher-art', 'unexpected.webp'), 'not art');
    await assert.rejects(verifyLauncherTree(temp), /file list differs from HEAD/);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
