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
