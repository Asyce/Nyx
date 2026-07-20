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
  const build = workflow.indexOf('- name: Build site');
  const smoke = workflow.indexOf('- name: Smoke deploy artifact');
  const push = workflow.indexOf('- name: Push verified changes');
  const deploy = workflow.indexOf('- name: Deploy to Cloudflare');
  const pushCommands = workflow.match(/\bgit push\b/g) || [];
  const verifiedCondition = "if: ${{ steps.livestream.outputs.changed == 'true' || steps.changes.outputs.changed == 'true' }}";
  const verifiedSteps = ['Install site deps', 'Build site', 'Smoke deploy artifact', 'Push verified changes'];

  assert(livestreamCommit >= 0 && livestreamCommit < build);
  assert(codesCommit >= 0 && codesCommit < build);
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
