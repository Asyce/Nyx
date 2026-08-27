import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const workflowDir = path.resolve(rootDir, '.github', 'workflows');
const producerDeploys = [
  'banner-history-refresh.yml',
  'code-watch.yml',
  'data-refresh.yml',
  'gamedata-asset-sync.yml',
  'gamedata-watch.yml',
  'roster-sync.yml',
  'side-data-sync.yml',
];

test('deploy guard permits exactly the Cloudflare asset limit after SEO', async () => {
  const source = await fs.readFile(path.resolve(rootDir, 'Site', 'tools', 'build-deploy.mjs'), 'utf8');
  assert.match(source, /if \(files\.length > hardFileLimit - POST_BUILD_FILE_RESERVE\)/);
  assert.doesNotMatch(source, /files\.length >= hardFileLimit - POST_BUILD_FILE_RESERVE/);
});

test('every producer manual deploy pushes the exact commit before publishing R2 manifests', async () => {
  for (const name of producerDeploys) {
    const source = await fs.readFile(path.resolve(workflowDir, name), 'utf8');
    const push = source.indexOf('- name: Push verified');
    const sync = source.indexOf('- name: Additively sync Database assets to R2');
    const deploy = source.indexOf('- name: Deploy to Cloudflare');
    assert(push >= 0, `${name} has a verified push`);
    assert(sync > push, `${name} pushes before R2 sync`);
    assert(deploy > sync, `${name} syncs before deploy`);
    assert.match(source, /PENGO_DATABASE_ASSET_MODE: \$\{\{ vars\.DATABASE_ASSET_MODE \|\| 'local' \}\}/);
    assert.match(source, /DATABASE_ASSET_MODE: \$\{\{ vars\.DATABASE_ASSET_MODE \|\| 'local' \}\}/);
    const syncBlock = source.slice(sync, deploy);
    assert.match(syncBlock, /env\.DATABASE_ASSET_MODE != 'local'/);
    const deployBlock = source.slice(deploy);
    assert.match(deployBlock, /steps\.deployment_snapshot\.outputs\.fresh == 'true'/);
    const finalRefresh = source.indexOf('- name: Refresh final deployment launcher snapshot');
    const finalCommit = source.indexOf('id: deployment_snapshot');
    const finalBuild = source.indexOf('- name: Build exact final deployment artifact');
    const finalSmoke = source.indexOf('- name: Smoke exact final deployment artifact');
    const finalPush = source.indexOf('- name: Push exact final deployment snapshot');
    assert(finalRefresh > sync, `${name} renews launcher freshness after the potentially slow R2 sync`);
    assert(finalCommit > finalRefresh && finalBuild > finalCommit && finalSmoke > finalBuild, `${name} commits, builds, and smokes the renewed snapshot`);
    assert(finalPush > finalSmoke && deploy > finalPush, `${name} pushes the exact renewed snapshot before deployment`);
    const finalBuildBlock = source.slice(finalBuild, finalSmoke);
    assert.match(finalBuildBlock, /PENGO_DEPLOY_COMMIT: \$\{\{ steps\.deployment_snapshot\.outputs\.sha \}\}/);
    assert.match(finalBuildBlock, /PENGO_DATABASE_ASSET_MODE: \$\{\{ vars\.DATABASE_ASSET_MODE \|\| 'local' \}\}/);
    const smokeBlocks = source.match(/- name: Smoke[^\n]*[\s\S]*?(?=\n      - name:)/g) || [];
    assert(smokeBlocks.length > 0, `${name} has a deploy smoke step`);
    for (const block of smokeBlocks.filter((entry) => entry.includes('smoke:deploy'))) {
      assert.match(block, /PENGO_DATABASE_ASSET_MODE:/, `${name} smoke uses the same explicit Database asset mode as its build`);
    }
  }
});

test('daily deploy syncs pushed main and verifies a renewed exact snapshot before Cloudflare', async () => {
  const source = await fs.readFile(path.resolve(workflowDir, 'daily-deploy.yml'), 'utf8');
  const liveCheck = source.indexOf('- name: Check whether main is already live');
  const rebase = source.indexOf('- name: Rebase before deployment');
  const lfsPull = source.indexOf('git lfs pull');
  const install = source.indexOf('- name: Install site dependencies');
  const launcherSnapshot = source.indexOf('id: launcher_snapshot');
  const firstBuild = source.indexOf('- name: Build verified launcher snapshot');
  const firstSmoke = source.indexOf('- name: Smoke verified launcher snapshot');
  const firstPush = source.indexOf('- name: Push verified launcher snapshot');
  const sync = source.indexOf('- name: Additively sync Database assets to R2');
  const refresh = source.indexOf('- name: Refresh deployment launcher snapshot');
  const snapshot = source.indexOf('id: deployment_snapshot');
  const build = source.indexOf('- name: Build exact deployment artifact');
  const smoke = source.indexOf('- name: Smoke exact deployment artifact');
  const push = source.indexOf('- name: Push exact deployment snapshot');
  const deploy = source.indexOf('- name: Deploy to Cloudflare');

  assert(liveCheck >= 0 && liveCheck < rebase, 'the no-op check must precede the expensive path');
  assert(rebase < lfsPull && lfsPull < install, 'the exact rebased commit must own LFS files and dependencies');
  assert(install < launcherSnapshot && launcherSnapshot < firstBuild && firstBuild < firstSmoke && firstSmoke < firstPush && firstPush < sync, 'the rebased launcher snapshot must be verified and pushed before R2');
  assert(sync < refresh && refresh < snapshot, 'launcher freshness must be renewed after R2');
  assert(snapshot < build && build < smoke && smoke < push && push < deploy, 'the renewed commit must build, smoke, and push before deploy');
  assert.match(source.slice(sync, refresh), /PENGO_DEPLOY_COMMIT: \$\{\{ steps\.pushed_launcher_snapshot\.outputs\.sha \}\}/);
  assert.match(source.slice(build, smoke), /PENGO_DEPLOY_COMMIT: \$\{\{ steps\.deployment_snapshot\.outputs\.sha \}\}/);
  assert.match(source.slice(deploy), /steps\.deployment_snapshot\.outputs\.fresh == 'true'/);
  assert.match(source.slice(deploy), /working-directory: Site/);
  assert.match(source.slice(deploy), /node \.\/node_modules\/wrangler\/bin\/wrangler\.js deploy/);
  assert.doesNotMatch(source.slice(deploy), /npx --yes wrangler/);
});

test('data refresh deploy uses the installed pinned Wrangler', async () => {
  const source = await fs.readFile(path.resolve(workflowDir, 'data-refresh.yml'), 'utf8');
  const deploy = source.indexOf('- name: Deploy to Cloudflare');
  assert.match(source.slice(deploy), /node \.\/node_modules\/wrangler\/bin\/wrangler\.js deploy/);
  assert.doesNotMatch(source.slice(deploy), /npx --yes wrangler/);
});

test('daily deploy rebuilds the newest main before retrying a rejected push', async () => {
  const source = await fs.readFile(path.resolve(workflowDir, 'daily-deploy.yml'), 'utf8');
  const pushBlocks = source.match(/- name: Push (?:verified launcher|exact deployment) snapshot[\s\S]*?(?=\n      - name:)/g) || [];

  assert.equal(pushBlocks.length, 2);
  for (const block of pushBlocks) {
    assert.match(block, /for attempt in 1 2 3/);
    assert.match(block, /git push origin HEAD:main/);
    assert.match(block, /git fetch origin main[\s\S]*git switch --detach origin\/main[\s\S]*git lfs pull/);
    assert.match(block, /npm ci --no-audit --no-fund[\s\S]*npm run generate:data && npm run refresh:launcher/);
    assert.match(block, /PENGO_DEPLOY_COMMIT="\$sha" npm run build:deploy && npm run smoke:deploy/);
    assert.match(block, /echo "sha=\$\(git rev-parse HEAD\)" >> "\$GITHUB_OUTPUT"/);
  }
  assert.match(pushBlocks[1], /R2_ACCOUNT_ID: \$\{\{ vars\.CLOUDFLARE_ACCOUNT_ID \}\}/);
  assert.match(pushBlocks[1], /PENGO_DEPLOY_COMMIT="\$launcher_sha" npm run sync:database-assets:r2 -- --apply/);
  assert.match(pushBlocks[1], /sync:database-assets:r2[\s\S]*npm run generate:data && npm run refresh:launcher[\s\S]*npm run build:deploy && npm run smoke:deploy/);
  assert.match(source, /PENGO_DEPLOY_COMMIT: \$\{\{ steps\.pushed_launcher_snapshot\.outputs\.sha \}\}/);
});

test('GameData preflight and rebased checks use the configured Database asset mode', async () => {
  const source = await fs.readFile(path.resolve(workflowDir, 'gamedata-watch.yml'), 'utf8');
  assert.doesNotMatch(source, /PENGO_DATABASE_ASSET_MODE:\s+local/);
  for (const name of [
    'Preflight site build',
    'Preflight deploy artifact',
    'Rebuild after rebase',
    'Smoke rebased deploy artifact',
  ]) {
    const block = source.match(new RegExp(`- name: ${name}[\\s\\S]*?(?=\\n      - name:)`))?.[0] || '';
    assert.match(block, /PENGO_DATABASE_ASSET_MODE: \$\{\{ vars\.DATABASE_ASSET_MODE \|\| 'local' \}\}/, `${name} follows the configured R2 mode`);
  }
});

test('GameData amend gates accept only generated Genshin character stories', async () => {
  const source = await fs.readFile(path.resolve(workflowDir, 'gamedata-watch.yml'), 'utf8');
  for (const [name, error] of [
    ['Amend verified generated output', 'The GameData build changed an unexpected tracked path.'],
    ['Amend rebased generated output', 'The rebased GameData build changed an unexpected tracked path.'],
  ]) {
    const block = source.match(new RegExp(`- name: ${name}[\\s\\S]*?(?=\\n      - name:)`))?.[0] || '';
    const gitAdd = block.match(/^\s*git add -A .*$/m)?.[0].trim();
    assert.equal(gitAdd, 'git add -A Database/GameData Database/Audits Database/reports Database/CharacterStory/gi Site/src/data/generated');
    assert.match(block, /if ! git diff --quiet; then/);
    assert.ok(block.includes(`echo "::error::${error}"`), `${name} keeps its unexpected-path error`);
  }
});

test('manual rollout never mutates repository variables and has mode-aware rollback paths', async () => {
  const source = await fs.readFile(path.resolve(workflowDir, 'r2-database-reconcile.yml'), 'utf8');
  assert.doesNotMatch(source, /github\.token|gh variable set|actions:\s*write/);
  assert.match(source, /permissions:\s*\n\s*contents: write/);
  assert.match(source, /id: launcher_snapshot/);
  assert.match(source, /npm run generate:data && npm run refresh:launcher/);
  assert.match(source, /PENGO_DEPLOY_COMMIT: \$\{\{ steps\.launcher_snapshot\.outputs\.sha \}\}/);
  assert.doesNotMatch(source, /npm run (?:build:deploy|smoke:deploy):generated/);
  assert.match(source, /npm run build:deploy/);
  assert.match(source, /npm run smoke:deploy/);
  assert(source.indexOf('git push') < source.indexOf('- name: Additively reconcile Database assets and manifests'));
  const currentR2Smoke = source.match(/- name: Smoke exact current R2-only artifact[\s\S]*?(?=\n      - name:)/)?.[0] || '';
  assert.match(currentR2Smoke, /PENGO_DATABASE_ASSET_MODE: r2-only/);
  const currentDualSmoke = source.match(/- name: Smoke exact dual deploy artifact[\s\S]*?(?=\n      - name:)/)?.[0] || '';
  assert.match(currentDualSmoke, /PENGO_DATABASE_ASSET_MODE: dual/);
  const audit = source.indexOf('- name: Additively reconcile Database assets and manifests');
  const refreshAfterAudit = source.indexOf('- name: Refresh deployment launcher snapshot after R2 audit');
  const deploymentCommit = source.indexOf('id: deployment_snapshot');
  const finalR2Build = source.indexOf('- name: Build and smoke exact R2-only artifact');
  const finalPush = source.indexOf('- name: Push verified deployment launcher snapshot');
  const firstDeploy = source.indexOf('- name: Deploy to Cloudflare exact dual artifact');
  assert(audit >= 0 && refreshAfterAudit > audit, 'launcher freshness is renewed after the exhaustive R2 audit');
  assert(deploymentCommit > refreshAfterAudit, 'the post-audit launcher snapshot is committed');
  assert(finalR2Build > deploymentCommit, 'the exact deployment artifact uses the post-audit snapshot');
  assert(finalPush > finalR2Build && firstDeploy > finalPush, 'the verified post-audit snapshot is pushed before deployment');
  const finalR2Block = source.match(/- name: Build and smoke exact R2-only artifact[\s\S]*?(?=\n      - name:)/)?.[0] || '';
  assert.match(finalR2Block, /PENGO_DEPLOY_COMMIT: \$\{\{ steps\.deployment_snapshot\.outputs\.sha \}\}/);
  assert.match(finalR2Block, /PENGO_DATABASE_ASSET_MODE: r2-only/);
  for (const id of ['deploy_dual', 'verify_dual', 'restore_local', 'deploy_r2', 'verify_r2', 'restore_dual', 'rollback_r2']) {
    assert.match(source, new RegExp(`id: ${id}\\b`));
  }
  assert.match(source, /DATABASE_ASSET_MODE: \$\{\{ vars\.DATABASE_ASSET_MODE \|\| 'local' \}\}/);
  for (const name of ['Build exact dual deploy artifact', 'Smoke exact dual deploy artifact', 'Deploy to Cloudflare exact dual artifact', 'Live-check dual rollout']) {
    const block = source.match(new RegExp(`- name: ${name}[\\s\\S]*?(?=\\n      - name:)`))?.[0] || '';
    assert.match(block, /env\.DATABASE_ASSET_MODE != 'r2-only'/);
  }
  assert.match(source, /failure\(\).*steps\.deploy_dual\.outcome == 'failure'.*steps\.deploy_dual\.outcome == 'success'.*steps\.verify_dual\.outcome != 'success'/);
  assert.match(source, /failure\(\).*steps\.deploy_r2\.outcome == 'failure'.*steps\.deploy_r2\.outcome == 'success'.*steps\.verify_r2\.outcome != 'success'/);
  assert.match(source, /inputs\.cutover_to_r2_only \|\| env\.DATABASE_ASSET_MODE == 'r2-only'/);

  const local = source.match(/- name: Restore exact local artifact[\s\S]*?(?=\n      - name:)/)?.[0] || '';
  assert.match(local, /PENGO_DATABASE_ASSET_MODE: local/);
  assert.match(local, /npm run build:deploy[\s\S]*npm run smoke:deploy[\s\S]*wrangler deploy/);

  const dual = source.match(/- name: Restore verified dual artifact[\s\S]*$/)?.[0] || '';
  assert.match(dual, /PENGO_DATABASE_ASSET_MODE: dual/);
  assert.match(dual, /npm run build:deploy[\s\S]*npm run smoke:deploy[\s\S]*wrangler deploy/);

  const rollback = source.match(/- name: Roll back the prior R2-only deployment[\s\S]*$/)?.[0] || '';
  assert.match(rollback, /env\.DATABASE_ASSET_MODE == 'r2-only'/);
  assert.match(rollback, /steps\.deploy_r2\.outcome == 'success'/);
  assert.match(rollback, /steps\.verify_r2\.outcome != 'success'/);
  assert.match(rollback, /wrangler rollback --message/);

  const order = ['id: deploy_dual', 'id: verify_dual', 'id: restore_local', 'id: deploy_r2', 'id: verify_r2', 'id: restore_dual', 'id: rollback_r2']
    .map((needle) => source.indexOf(needle));
  assert(order.every((index) => index >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.equal(source.match(/live-check-database-assets\.mjs --full/g)?.length, 2);
});
