'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const workflow = fs.readFileSync(
  path.join(root, '.github/workflows/code-watch.yml'),
  'utf8',
);

test('code watch verifies every automated commit before its only push', () => {
  const livestreamCommit = workflow.indexOf('git commit -m "chore(codes): update livestream windows [skip ci]"');
  const codesCommit = workflow.indexOf('git commit -m "chore(data): codes watch refresh [skip ci]"');
  const reconcile = workflow.indexOf('- name: Reconcile committed launcher code feeds');
  const amend = workflow.indexOf('git commit --amend --no-edit');
  const build = workflow.indexOf('- name: Build site');
  const smoke = workflow.indexOf('- name: Smoke deploy artifact');
  const push = workflow.indexOf('- name: Push verified changes');
  const deploy = workflow.indexOf('- name: Deploy to Cloudflare');
  const pushCommands = workflow.match(/\bgit push\b/g) || [];
  const verifiedCondition = "if: ${{ steps.livestream.outputs.changed == 'true' || steps.changes.outputs.changed == 'true' }}";
  const verifiedSteps = ['Install site deps', 'Build site', 'Smoke deploy artifact', 'Push verified changes'];

  assert(livestreamCommit >= 0 && livestreamCommit < build);
  assert(codesCommit >= 0 && codesCommit < reconcile);
  assert(reconcile >= 0 && reconcile < amend);
  assert(amend >= 0 && amend < build);
  assert(build >= 0 && build < smoke);
  assert(smoke >= 0 && smoke < push);
  assert(push >= 0 && push < deploy);
  assert.equal(pushCommands.length, 1, 'workflow must have one push after verification');

  for (const name of verifiedSteps) {
    const start = workflow.indexOf('- name: ' + name);
    const end = workflow.indexOf('\n      - name:', start + 1);
    const condition = workflow.indexOf(verifiedCondition, start);
    assert(start >= 0, 'missing ' + name + ' step');
    assert(condition > start && (end < 0 || condition < end), name + ' must verify livestream and code changes');
  }
});

test('code watch commits both reconciled launcher feeds with authoritative codes', () => {
  const sourceCommit = workflow.indexOf('- name: Commit refreshed codes');
  const reconcile = workflow.indexOf('- name: Reconcile committed launcher code feeds');
  const amend = workflow.indexOf('- name: Amend refreshed codes with generated feeds');
  const build = workflow.indexOf('- name: Build site');
  const generated = workflow.indexOf('npm run generate:data && npm run generate:launcher-codes && npm run reconcile:launcher-codes', reconcile);
  const sourceStaged = workflow.indexOf('git add Database/Codes/codes.json', sourceCommit);
  const pull = workflow.indexOf('git pull --rebase origin main', sourceCommit);
  const feedsStaged = workflow.indexOf('git add Site/src/data/generated/nyx-data.js Site/src/data/generated/launcher-codes-v1.json Site/src/data/generated/launcher-banners-v1.json', amend);
  const sourceChangedCondition = "if: ${{ steps.changes.outputs.source_changed == 'true' }}";

  assert(sourceCommit >= 0 && sourceCommit < reconcile);
  assert(sourceStaged > sourceCommit && sourceStaged < pull);
  assert(pull > sourceStaged && pull < reconcile, 'rebase must happen before generators can dirty unrelated tracked outputs');
  assert(generated > reconcile && generated < amend);
  assert(feedsStaged > amend && feedsStaged < build);
  assert.match(workflow, /source_changed=(?:true|false)/);
  for (const start of [sourceCommit, reconcile, amend]) {
    const end = workflow.indexOf('\n      - name:', start + 1);
    const condition = workflow.indexOf(sourceChangedCondition, start);
    assert(condition > start && condition < end, 'source-changing steps must not run for force-only deploys');
  }
});

test('every scheduled publishing workflow pushes only after a deploy smoke test', () => {
  const workflows = [
    'banner-history-refresh.yml',
    'code-watch.yml',
    'data-refresh.yml',
    'gamedata-asset-sync.yml',
    'gamedata-watch.yml',
    'roster-sync.yml',
    'side-data-sync.yml',
  ];
  for (const file of workflows) {
    const source = fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8');
    const pushes = [...source.matchAll(/\bgit push\b/g)];
    assert.equal(pushes.length, 1, `${file} must have exactly one push`);
    const push = pushes[0].index;
    const smoke = source.lastIndexOf('npm run smoke:deploy', push);
    const deploy = source.indexOf('wrangler deploy', push);
    assert(smoke >= 0 && smoke < push, `${file} must smoke-test before push`);
    assert(deploy < 0 || push < deploy, `${file} must push before deploy`);
  }
});

test('only the current-banner owner blocks on banner freshness and retries transient failures', () => {
  const workflow = (file) => fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8');
  const dataRefresh = workflow('data-refresh.yml');
  assert.match(dataRefresh, /for attempt in 1 2 3/);
  assert.match(dataRefresh, /banners\/scrape\.cjs --require-fresh/);
  assert.match(dataRefresh, /npm run validate:strict/);

  for (const file of ['banner-history-refresh.yml', 'roster-sync.yml', 'side-data-sync.yml']) {
    const source = workflow(file);
    assert.match(source, /npm run validate(?:\r?\n|$)/, `${file} must keep structural validation`);
    assert.doesNotMatch(source, /npm run validate:strict/, `${file} must not own current-banner freshness`);
  }
});

test('data owners commit regenerated launcher feeds before exact production builds', () => {
  const workflow = (file) => fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8');
  for (const file of ['data-refresh.yml', 'banner-history-refresh.yml', 'roster-sync.yml']) {
    const source = workflow(file);
    const refresh = source.indexOf('npm run generate:data && npm run refresh:launcher');
    const stageManifest = source.indexOf('git add Site/src/data/generated/nyx-data.js Site/src/data/generated/launcher-codes-v1.json Site/src/data/generated/launcher-banners-v1.json');
    const stageArt = source.indexOf('git add -A Site/src/data/generated/launcher-art');
    const amend = source.indexOf('git commit --amend --no-edit');
    const build = source.indexOf('npm run build:deploy', amend);
    assert(refresh >= 0 && refresh < stageManifest, `${file} must refresh before staging generated feeds`);
    assert(stageManifest < stageArt && stageArt < amend, `${file} must stage feed bytes and exact art before amend`);
    assert(amend < build, `${file} must amend generated feeds before the exact production build`);
    assert.doesNotMatch(source.slice(build, source.indexOf('git push', build)), /build:deploy:generated/, `${file} production build must consume committed feeds`);
  }

  const gameData = workflow('gamedata-watch.yml');
  assert.equal((gameData.match(/npm run build:deploy:generated/g) || []).length, 2, 'GameData pre-commit builds must regenerate explicitly');
  assert.equal((gameData.match(/npm run smoke:deploy:generated/g) || []).length, 2, 'GameData pre-commit smoke checks must allow uncommitted candidates');
  const amend = gameData.indexOf('- name: Amend rebased generated output');
  const exactSmoke = gameData.indexOf('npm run smoke:deploy', amend);
  const push = gameData.indexOf('git push', exactSmoke);
  assert(amend >= 0 && exactSmoke > amend && push > exactSmoke, 'GameData must verify committed deploy bytes after amend and before push');
});
