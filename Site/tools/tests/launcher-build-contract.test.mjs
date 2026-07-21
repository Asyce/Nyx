import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyLauncherTree } from '../verify-committed-launcher.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '..', '..');

test('production build packages committed launcher bytes and keeps regeneration explicit', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(site, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.build, /verify:launcher:source/);
  assert.match(pkg.scripts.build, /verify:launcher:dist/);
  assert.doesNotMatch(pkg.scripts.build, /refresh:launcher|generate:launcher-(?:codes|manifest)/);
  assert.match(pkg.scripts['build:generated'], /refresh:launcher/);
  assert.match(pkg.scripts['build:deploy'], /verify:launcher:deploy/);
  assert.match(pkg.scripts['smoke:deploy'], /verify:launcher:deploy/);
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
