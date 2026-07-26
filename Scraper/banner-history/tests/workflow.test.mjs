import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
test('history workflow is isolated, six-hourly, serialized, and scoped', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/banner-history-refresh.yml'), 'utf8');
  assert.match(workflow, /cron: '45 \*\/6 \* \* \*'/);
  assert.match(workflow, /group: pengo-deploy/);
  assert.match(workflow, /npm run banners:history:test/);
  assert.match(workflow, /npm run banners:history/);
  assert.match(workflow, /git add Database\/BannerHistory Database\/Activities Site\/src\/features\/gacha\/pulls-banners-gi\.js/);
  assert.doesNotMatch(workflow, /codes\/|banners\/scrape\.cjs/);
  assert(
    workflow.indexOf('npm run smoke:deploy') < workflow.indexOf('git push'),
    'smoke must run before push',
  );
  assert(
    workflow.indexOf('git push') < workflow.indexOf('npx --yes wrangler deploy'),
    'push must complete before deploy',
  );
  const sideRunner = fs.readFileSync(path.join(root, 'Site/tools/run-side-data-sync.mjs'), 'utf8');
  assert.doesNotMatch(sideRunner, /banner-history\/gi\.mjs|Genshin banner history/);
  const source = fs.readFileSync(path.join(root, 'Scraper/banner-history/sources.mjs'), 'utf8');
  assert.match(source, /if-none-match/); assert.match(source, /if-modified-since/); assert.match(source, /response\.status === 304/);
  assert.match(source, /discoverYears\('Headhunting\/Banners'/);
  const index = fs.readFileSync(path.join(root, 'Scraper/banner-history/index.mjs'), 'utf8');
  assert.match(index, /\.transaction\.json/); assert.match(index, /fs\.rename\(item\.next, item\.target\)/); assert.doesNotMatch(index, /copyFile\(/);
});
