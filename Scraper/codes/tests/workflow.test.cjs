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

test('code watch verifies every automated commit before each push', () => {
  const livestreamCommit = workflow.indexOf('git commit -m "chore(codes): update livestream windows [skip ci]"');
  const codesCommit = workflow.indexOf('git commit -m "chore(data): codes watch refresh [skip ci]"');
  const refresh = workflow.indexOf('- name: Refresh committed launcher snapshot');
  const snapshot = workflow.indexOf('- name: Commit refreshed launcher snapshot');
  const build = workflow.indexOf('- name: Build site');
  const smoke = workflow.indexOf('- name: Smoke deploy artifact');
  const push = workflow.indexOf('- name: Push verified changes');
  const finalSmoke = workflow.indexOf('- name: Smoke exact final deployment artifact');
  const finalPush = workflow.indexOf('- name: Push exact final deployment snapshot');
  const deploy = workflow.indexOf('- name: Deploy to Cloudflare');
  const pushCommands = workflow.match(/\bgit push\b/g) || [];
  const freshCondition = "if: ${{ steps.launcher_snapshot.outputs.fresh == 'true' }}";
  const verifiedSteps = ['Build site', 'Smoke deploy artifact', 'Push verified changes'];

  assert(livestreamCommit >= 0 && livestreamCommit < build);
  assert(codesCommit >= 0 && codesCommit < refresh);
  assert(refresh >= 0 && refresh < snapshot);
  assert(snapshot >= 0 && snapshot < build);
  assert(build >= 0 && build < smoke);
  assert(smoke >= 0 && smoke < push);
  assert(push >= 0 && push < finalSmoke);
  assert(finalSmoke < finalPush && finalPush < deploy);
  assert.equal(pushCommands.length, 2, 'workflow must verify both the pre-sync and final deployment pushes');

  for (const name of verifiedSteps) {
    const start = workflow.indexOf('- name: ' + name);
    const end = workflow.indexOf('\n      - name:', start + 1);
    const condition = workflow.indexOf(freshCondition, start);
    assert(start >= 0, 'missing ' + name + ' step');
    assert(condition > start && (end < 0 || condition < end), name + ' must require a fresh committed launcher snapshot');
  }
  const deployBlock = workflow.slice(deploy, workflow.indexOf('\n        run:', deploy));
  assert.match(deployBlock, /steps\.deployment_snapshot\.outputs\.fresh == 'true'/);
  assert.match(deployBlock, /steps\.changes\.outputs\.changed == 'true'/);
});

test('code watch commits a full fresh launcher snapshot with authoritative codes', () => {
  const sourceCommit = workflow.indexOf('- name: Commit refreshed codes');
  const rebase = workflow.indexOf('- name: Rebase before launcher snapshot');
  const refresh = workflow.indexOf('- name: Refresh committed launcher snapshot');
  const snapshot = workflow.indexOf('- name: Commit refreshed launcher snapshot');
  const build = workflow.indexOf('- name: Build site');
  const generated = workflow.indexOf('npm run generate:data && npm run refresh:launcher', refresh);
  const sourceStaged = workflow.indexOf('git add Database/Codes/codes.json', sourceCommit);
  const pull = workflow.indexOf('git pull --rebase origin main', sourceCommit);
  const feedsStaged = workflow.indexOf('git add Site/src/data/generated/nyx-data.js Site/src/data/generated/launcher-codes-v1.json Site/src/data/generated/launcher-banners-v1.json', snapshot);
  const artStaged = workflow.indexOf('git add -A Site/src/data/generated/launcher-art', snapshot);
  const sourceChangedCondition = "if: ${{ steps.changes.outputs.source_changed == 'true' }}";

  assert(sourceCommit >= 0 && sourceCommit < rebase);
  assert(sourceStaged > sourceCommit && sourceStaged < pull);
  assert(pull > sourceStaged && pull < rebase);
  assert(rebase < generated && generated < snapshot, 'the final rebase must happen before the wall-clock snapshot is generated');
  assert(feedsStaged > snapshot && feedsStaged < artStaged && artStaged < build);
  assert.match(workflow.slice(snapshot, build), /git commit --amend --no-edit/);
  assert.match(workflow.slice(snapshot, build), /git commit -m "chore\(data\): refresh launcher snapshot \[skip ci\]"/);
  assert.match(workflow.slice(snapshot, build), /echo "fresh=true"/);
  assert.match(workflow, /source_changed=(?:true|false)/);
  const end = workflow.indexOf('\n      - name:', sourceCommit + 1);
  const condition = workflow.indexOf(sourceChangedCondition, sourceCommit);
  assert(condition > sourceCommit && condition < end, 'the source commit must not run for force-only deploys');
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
    assert.equal(pushes.length, 2, `${file} must push the verified pre-sync commit and the exact final deployment commit`);
    for (const match of pushes) {
      const smoke = source.lastIndexOf('npm run smoke:deploy', match.index);
      assert(smoke >= 0 && smoke < match.index, `${file} must smoke-test before each push`);
    }
    const finalPush = pushes.at(-1).index;
    const deploy = source.indexOf('wrangler deploy', finalPush);
    assert(deploy < 0 || finalPush < deploy, `${file} must push the exact final commit before deploy`);
  }
});

test('automatic schedules stay fixed and only the daily job deploys automatically', () => {
  const workflowDir = path.join(root, '.github/workflows');
  const expectedCrons = {
    'code-watch.yml': '0 * * * *',
    'gamedata-watch.yml': '20 2,14 * * *',
    'data-refresh.yml': '15 3 * * *',
    'banner-history-refresh.yml': '45 4 * * 1,4',
    'roster-sync.yml': '30 5 * * 0',
    'side-data-sync.yml': '45 6 * * 0,3',
    'daily-deploy.yml': '0 11 * * *',
  };
  const source = (file) => fs.readFileSync(path.join(workflowDir, file), 'utf8');

  for (const [file, cron] of Object.entries(expectedCrons)) {
    assert(source(file).includes(`cron: '${cron}'`) || source(file).includes(`cron: "${cron}"`), `${file} must use ${cron}`);
  }

  const assetHeader = source('gamedata-asset-sync.yml').split('\nconcurrency:')[0];
  assert.doesNotMatch(assetHeader, /\bschedule:/, 'GameData asset repair must stay manual-only');

  for (const file of [...Object.keys(expectedCrons), 'gamedata-asset-sync.yml', 'r2-database-reconcile.yml']) {
    assert.match(source(file), /concurrency:\s*\r?\n\s*group: pengo-deploy\s*\r?\n\s*queue: max\s*\r?\n\s*cancel-in-progress: false/, `${file} must serialize without replacing pending runs`);
  }

  const daily = source('daily-deploy.yml');
  assert.match(daily, /timezone:\s*["']Europe\/Paris["']/, 'daily deploy must stay at 11:00 Paris time across clock changes');
  const liveCheck = daily.indexOf('- name: Check whether main is already live');
  const rebase = daily.indexOf('- name: Rebase before deployment');
  const lfsPull = daily.indexOf('git lfs pull');
  const install = daily.indexOf('- name: Install site dependencies');
  const r2Sync = daily.indexOf('- name: Additively sync Database assets to R2');
  const refresh = daily.indexOf('- name: Refresh deployment launcher snapshot');
  assert(liveCheck >= 0 && liveCheck < rebase && rebase < lfsPull && lfsPull < install && install < r2Sync && r2Sync < refresh, 'daily deploy must rebase before installing and renew freshness after R2');
  assert.doesNotMatch(daily.slice(0, liveCheck), /lfs:\s*true/, 'the cheap live check must happen before any LFS download');

  for (const file of [
    'banner-history-refresh.yml',
    'code-watch.yml',
    'data-refresh.yml',
    'gamedata-asset-sync.yml',
    'gamedata-watch.yml',
    'roster-sync.yml',
    'side-data-sync.yml',
  ]) {
    const workflow = source(file);
    for (const name of ['Additively sync Database assets to R2', 'Refresh final deployment launcher snapshot', 'Commit final deployment launcher snapshot', 'Deploy to Cloudflare']) {
      const start = workflow.indexOf(`- name: ${name}`);
      const end = workflow.indexOf('\n      - name:', start + 1);
      assert(start >= 0, `${file} is missing ${name}`);
      assert.match(workflow.slice(start, end), /github\.event_name == 'workflow_dispatch'/, `${file} ${name} must be manual-only`);
    }
  }
});

test('only the current-banner owner requires live scraper freshness and retries transient failures', () => {
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

test('data refresh carries banners forward while independently refreshing events', () => {
  const source = fs.readFileSync(path.join(root, '.github/workflows/data-refresh.yml'), 'utf8');
  const scrape = source.indexOf('- name: Scrape banners + codes');
  const events = source.indexOf('- name: Scrape in-game events');
  const validate = source.indexOf('- name: Validate scraped data');
  const commit = source.indexOf('- name: Commit refreshed data');
  const build = source.indexOf('- name: Build site');
  const deploy = source.indexOf('- name: Deploy to Cloudflare');

  assert(scrape >= 0 && scrape < events && events < validate && validate < commit);
  assert.match(source.slice(scrape, events), /id: banner_refresh/);
  assert.match(source.slice(scrape, events), /banner_status=\$\?/);
  assert.match(source.slice(scrape, events), /"\$banner_status" -eq 0/);
  assert.match(source.slice(scrape, events), /"\$banner_status" -ne 2/);
  assert.match(source.slice(scrape, events), /exit "\$banner_status"/);
  assert.match(source.slice(scrape, events), /echo "fresh=false"/);
  assert.match(source.slice(scrape, events), /warning::required banner sources stayed unavailable after 3 attempts/);
  assert.match(source.slice(scrape, events), /git restore --source=HEAD -- \.\.\/Database\/Banners\/banners\.json \.\.\/Database\/reports\/banner-teaser-art-provenance\.json/);
  assert.match(source.slice(scrape, events), /git clean -fd -- \.\.\/Site\/assets\/banners/);
  const eventsEnd = source.indexOf('\n      - name:', events + 1);
  assert.doesNotMatch(source.slice(events, eventsEnd), /banner_refresh\.outputs\.fresh/, 'events must refresh even when a banner source is down');
  assert.match(source.slice(commit, build), /git add -A Site\/assets\/events/, 'event art must be committed with event data');
  assert.match(source.slice(commit, build), /git add -A Site\/assets\/banners Site\/assets\/events/, 'fresh banner art must be committed with banner data');

  for (const start of [commit, build]) {
    const next = source.indexOf('\n      - name:', start + 1);
    assert.doesNotMatch(source.slice(start, next), /if:\s*\$\{\{[^\n]*banner_refresh\.outputs\.fresh/, 'event publishing must not require a fresh banner result');
  }
  const deployEnd = source.indexOf('\n      - name:', deploy + 1);
  assert.match(source.slice(deploy, deployEnd < 0 ? source.length : deployEnd), /banner_refresh\.outputs\.fresh/, 'deployment must still require fresh banners');
});

test('every production deploy requires a freshly committed launcher snapshot', () => {
  const workflowDir = path.join(root, '.github/workflows');
  const workflows = fs.readdirSync(workflowDir)
    .filter((file) => /\.ya?ml$/.test(file))
    .filter((file) => fs.readFileSync(path.join(workflowDir, file), 'utf8').includes('wrangler deploy'));
  assert.ok(workflows.length > 0, 'expected at least one production deploy workflow');
  for (const file of workflows) {
    const source = fs.readFileSync(path.join(workflowDir, file), 'utf8');
    const snapshotId = source.includes('id: deployment_snapshot') ? 'deployment_snapshot' : 'launcher_snapshot';
    const snapshot = source.indexOf(`id: ${snapshotId}`);
    const refresh = Math.max(
      source.lastIndexOf('npm run refresh:launcher', snapshot),
      source.lastIndexOf('npm run build:deploy:generated', snapshot),
    );
    const shaOutput = source.indexOf('echo "sha=$(git rev-parse HEAD)"', snapshot);
    const commitEnv = source.indexOf(`PENGO_DEPLOY_COMMIT: \${{ steps.${snapshotId}.outputs.sha }}`, snapshot);
    const packageCommand = Math.min(
      ...[
        source.indexOf('npm run build:deploy', commitEnv),
        source.indexOf('node ./tools/build-deploy.mjs', commitEnv),
      ].filter((index) => index >= 0),
    );
    const exactSmoke = source.indexOf('npm run smoke:deploy', snapshot);
    const push = source.indexOf('git push', exactSmoke);
    const deploy = source.indexOf('- name: Deploy to Cloudflare', push);
    const deployRun = source.indexOf('\n        run:', deploy);
    const deployBlock = source.slice(deploy, deployRun);

    assert(refresh >= 0 && refresh < snapshot, `${file} must refresh before marking a committed snapshot fresh`);
    assert.match(source.slice(snapshot, exactSmoke), /git commit(?: --amend| -m)/, `${file} must commit refreshed launcher bytes`);
    assert.match(source.slice(snapshot, exactSmoke), /echo "fresh=true"/, `${file} must publish an explicit fresh-snapshot output`);
    assert(shaOutput > snapshot && shaOutput < commitEnv, `${file} must export the exact post-refresh HEAD`);
    assert(commitEnv < packageCommand && packageCommand < exactSmoke, `${file} production packaging must receive the post-refresh HEAD`);
    assert(exactSmoke > snapshot && push > exactSmoke && deploy > push, `${file} must smoke, push, then deploy the committed snapshot`);
    assert.match(deployBlock, new RegExp(`steps\\.${snapshotId}\\.outputs\\.fresh == 'true'`), `${file} deploy must fail closed without a fresh snapshot`);
  }
});

test('data owners commit regenerated launcher feeds before exact production builds', () => {
  const workflow = (file) => fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8');
  for (const file of ['data-refresh.yml', 'banner-history-refresh.yml', 'roster-sync.yml']) {
    const source = workflow(file);
    const refresh = source.indexOf('npm run generate:data && npm run refresh:launcher');
    const stageManifest = source.indexOf('git add Site/src/data/generated/nyx-data.js Site/src/data/generated/launcher-codes-v1.json Site/src/data/generated/launcher-banners-v1.json');
    const stageArt = source.indexOf('git add -A Site/src/data/generated/launcher-art');
    const snapshot = source.indexOf('- name: Commit refreshed launcher snapshot');
    const amend = source.indexOf('git commit --amend --no-edit', snapshot);
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
