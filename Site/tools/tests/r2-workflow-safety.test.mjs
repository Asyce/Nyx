import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const workflowDir = path.resolve(rootDir, '.github', 'workflows');
const scheduled = [
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

test('every scheduled deploy pushes the exact commit before publishing R2 manifests', async () => {
  for (const name of scheduled) {
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
    assert.match(deployBlock, /env\.DATABASE_ASSET_MODE == 'local' \|\| steps\.r2_sync\.outputs\.ready == 'true'/);
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
