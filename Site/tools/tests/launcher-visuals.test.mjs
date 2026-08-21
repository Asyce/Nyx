import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildLauncherVisuals,
  fetchTrustedBytes,
  parseOfficialEndfieldVideo,
  parseWuwaBackground,
  selectCorroboratedArchiveFiles,
  transcodeGenshinVideo,
} from '../generate-launcher-visuals.mjs';
import { verifyLauncherVisuals } from '../verify-launcher-visuals.mjs';
import {
  buildLauncherVisualUploadPlan,
  launcherVisualWranglerInvocation,
  metadataMatches,
  syncLauncherVisuals,
  verifyBytes,
} from '../sync-launcher-visuals-r2.mjs';

const repository = path.resolve(import.meta.dirname, '..', '..', '..');
const manifestFor = (games) => ({
  schema: 1,
  revision: crypto.createHash('sha256').update(JSON.stringify({ schema: 1, games })).digest('hex'),
  games,
});

const officialUrls = {
  gi: 'https://launcher-webstatic.hoyoverse.com/launcher-public/2026/08/11/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_1.webm',
  hsr: 'https://fastcdn.hoyoverse.com/static-resource-v2/2026/07/09/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb_2.webm',
  zzz: 'https://fastcdn.hoyoverse.com/static-resource-v2/2026/07/27/cccccccccccccccccccccccccccccccc_3.webm',
};
const officialPayload = (urls = officialUrls) => ({
  data: {
    game_info_list: [
      { game: { id: 'gopR6Cufr3' }, backgrounds: [{ video: { url: urls.gi } }] },
      { game: { id: '4ziysqXOQ8' }, backgrounds: [{ video: { url: urls.hsr } }] },
      { game: { id: 'U5hbdsT9W7' }, backgrounds: [{ video: { url: urls.zzz } }] },
    ],
  },
});
const officialEndfieldUrl = 'https://gl-utils-public.hg-cdn.com/hg-utils/prod/eppcsuwqpaueijqk/YDUTE5gscDZ229CW/aa/f5/aaf5ac1d9daa01523bc186b4e3599476.mp4';
const officialEndfieldPayload = (videoUrl = officialEndfieldUrl) => ({
  proxy_rsps: [{
    kind: 'get_main_bg_image',
    get_main_bg_image_rsp: {
      data_version: '',
      main_bg_image: {
        url: 'https://gl-utils-public.hg-cdn.com/hg-utils/prod/eppcsuwqpaueijqk/YDUTE5gscDZ229CW/ab/45/ab45e5a24a328218e3967d1db4bf83a5.png',
        md5: '7c98967e7aaa10aa0727dd432760cec8',
        video_url: videoUrl,
      },
    },
  }],
});

test('an archive-only newer launcher animation is rejected', () => {
  const selected = selectCorroboratedArchiveFiles([
    { type: 'blob', path: 'archive/gopR6Cufr3/20260812_dddddddddddddddddddddddddddddddd_4.webm' },
    { type: 'blob', path: 'archive/4ziysqXOQ8/20260709_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb_2.webm' },
    { type: 'blob', path: 'archive/U5hbdsT9W7/20260727_cccccccccccccccccccccccccccccccc_3.webm' },
  ], officialPayload());

  assert.equal(selected.gi, undefined);
  assert.equal(selected.hsr.path, 'archive/4ziysqXOQ8/20260709_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb_2.webm');
});

test('the exact official launcher animation is selected despite a newer archive path', () => {
  const selected = selectCorroboratedArchiveFiles([
    { type: 'blob', path: 'archive/gopR6Cufr3/20260812_dddddddddddddddddddddddddddddddd_4.webm' },
    { type: 'blob', path: 'archive/gopR6Cufr3/20260811_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_1.webm' },
  ], officialPayload());

  assert.equal(selected.gi.path, 'archive/gopR6Cufr3/20260811_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_1.webm');
  assert.equal(selected.gi.officialUrl, officialUrls.gi);
});

test('Genshin launcher WebM is converted to WinUI-compatible H.264 MP4', async () => {
  const source = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
  let args;
  const result = await transcodeGenshinVideo(source, {
    execFileImpl: async (file, received) => {
      assert.equal(file, 'ffmpeg');
      args = received;
      await fs.writeFile(received.at(-1), Buffer.from('0000ftypisom-genshin-test'));
    },
  });

  assert.equal(result.toString(), '0000ftypisom-genshin-test');
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('yuv420p'));
});

test('trusted downloads reject redirects and unexpected media types', async () => {
  let request;
  const fetchImpl = async (_url, options) => {
    request = options;
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'text/html' } });
  };

  await assert.rejects(() => fetchTrustedBytes('https://example.test/data.json', {
    fetchImpl,
    maximum: 100,
    accept: 'application/json',
    mediaTypes: ['application/json'],
  }), /Unexpected media type/);
  assert.equal(request.redirect, 'error');
});

test('trusted downloads stop an oversized stream without Content-Length', async () => {
  let canceled = false;
  const response = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(60)); },
    cancel() { canceled = true; },
  }), { headers: { 'Content-Type': 'application/octet-stream' } });

  await assert.rejects(() => fetchTrustedBytes('https://example.test/large', {
    fetchImpl: async () => response,
    maximum: 100,
    mediaTypes: ['application/octet-stream'],
    timeoutMs: 100,
  }), /exceeds 100 bytes/);
  assert.equal(canceled, true);
});

test('trusted downloads abort stalled requests and streams', async () => {
  await assert.rejects(() => fetchTrustedBytes('https://example.test/stalled-request', {
    fetchImpl: async () => new Promise(() => {}),
    maximum: 100,
    timeoutMs: 20,
  }), (error) => error?.name === 'TimeoutError');

  let canceled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([1])); },
    cancel() { canceled = true; },
  }), { headers: { 'Content-Type': 'application/octet-stream' } });
  await assert.rejects(() => fetchTrustedBytes('https://example.test/stalled-stream', {
    fetchImpl: async () => response,
    maximum: 100,
    mediaTypes: ['application/octet-stream'],
    timeoutMs: 20,
  }), (error) => error?.name === 'TimeoutError');
  assert.equal(canceled, true);
});

test('an official-source outage keeps every locally verified last-good launcher animation', async () => {
  const previous = JSON.parse(await fs.readFile(path.join(repository, 'Site', 'src', 'data', 'generated', 'launcher-visuals-v1.json'), 'utf8'));
  const next = await buildLauncherVisuals({
    fetchImpl: async () => { throw new Error('simulated outage'); },
    previousManifest: previous,
  });

  for (const game of ['gi', 'hsr', 'zzz', 'wuwa', 'ae']) assert.deepEqual(next.games[game], previous.games[game]);
  assert.equal(next.revision, previous.revision);

  const untrusted = structuredClone(previous);
  untrusted.games.ae.source = { page: 'https://example.com/untrusted' };
  await assert.rejects(() => buildLauncherVisuals({
    fetchImpl: async () => { throw new Error('simulated outage'); },
    previousManifest: untrusted,
  }), /No verified last-good Endfield launcher animation/);
});

test('daily data refresh verifies and pushes launcher backgrounds before publishing them', async () => {
  const workflow = await fs.readFile(path.join(repository, '.github', 'workflows', 'data-refresh.yml'), 'utf8');
  const refresh = workflow.indexOf('npm run generate:launcher-visuals');
  const verify = workflow.indexOf('npm run verify:launcher-visuals:source', refresh);
  const visualOnlyFeed = workflow.indexOf('- name: Refresh launcher feeds for a background-only snapshot', verify);
  const snapshot = workflow.indexOf('- name: Commit refreshed launcher snapshot', visualOnlyFeed);
  const push = workflow.indexOf('run: git push', verify);
  const publish = workflow.indexOf('npm run sync:launcher-visuals:r2 -- --apply', push);
  assert.ok(refresh >= 0 && verify > refresh && visualOnlyFeed > verify && snapshot > visualOnlyFeed && push > snapshot && publish > push);
  const refreshBlock = workflow.slice(workflow.lastIndexOf('- name: Refresh and verify official launcher backgrounds', refresh), visualOnlyFeed);
  assert.match(refreshBlock, /command -v ffmpeg[\s\S]*apt-get install --no-install-recommends -y ffmpeg[\s\S]*npm run generate:launcher-visuals/);
  const visualOnlyBlock = workflow.slice(visualOnlyFeed, snapshot);
  assert.match(visualOnlyBlock, /steps\.data_commit\.outputs\.changed != 'true' && steps\.launcher_visuals\.outputs\.changed == 'true'/);
  assert.match(visualOnlyBlock, /npm run generate:data && npm run refresh:launcher/);
  const snapshotBlock = workflow.slice(snapshot, workflow.indexOf('- name: Build site', snapshot));
  assert.match(snapshotBlock, /steps\.data_commit\.outputs\.changed == 'true' \|\| steps\.launcher_visuals\.outputs\.changed == 'true'/);
  const publishBlock = workflow.slice(workflow.lastIndexOf('- name: Publish launcher backgrounds', publish), workflow.indexOf('- name: Additively sync Database assets', publish));
  assert.match(publishBlock, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(publishBlock, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ vars\.CLOUDFLARE_ACCOUNT_ID \}\}/);
});

test('Endfield accepts only the exact official Gryphline launcher video contract', () => {
  assert.equal(parseOfficialEndfieldVideo(officialEndfieldPayload()), officialEndfieldUrl);
  assert.throws(() => parseOfficialEndfieldVideo(officialEndfieldPayload(`${officialEndfieldUrl}?changed=1`)), /invalid/);
  assert.throws(() => parseOfficialEndfieldVideo(officialEndfieldPayload(officialEndfieldUrl.replace('gl-utils-public.hg-cdn.com', 'example.com'))), /invalid/);
  assert.throws(() => parseOfficialEndfieldVideo({ ...officialEndfieldPayload(), extra: true }), /invalid/);
});

test('trusted downloads verify Content-MD5 when the official response supplies it', async () => {
  const bytes = Buffer.from('0000ftypisom-endfield-test');
  const contentMd5 = crypto.createHash('md5').update(bytes).digest('base64');
  const response = (value) => new Response(bytes, {
    headers: { 'Content-Type': 'video/mp4', 'Content-MD5': value },
  });
  assert.deepEqual(await fetchTrustedBytes(officialEndfieldUrl, {
    fetchImpl: async () => response(contentMd5),
    maximum: 100,
    mediaTypes: ['video/mp4'],
    verifyContentMd5: true,
  }), bytes);
  await assert.rejects(() => fetchTrustedBytes(officialEndfieldUrl, {
    fetchImpl: async () => response('AAAAAAAAAAAAAAAAAAAAAA=='),
    maximum: 100,
    mediaTypes: ['video/mp4'],
    verifyContentMd5: true,
  }), /MD5 does not match/);
});

test('WuWa launcher background accepts only the official media hosts', () => {
  const config = { functionCode: { background: 'dOlPEc8xvpP8r4k2lyIOK6p0R7hNNqRf' } };
  assert.deepEqual(parseWuwaBackground(config, {
    functionSwitch: 1,
    backgroundFileType: 2,
    backgroundFile: 'https://hw-pcdownload-qcloud.aki-game.net/launcher/clientUpload/current.mp4',
  }), {
    backgroundId: 'dOlPEc8xvpP8r4k2lyIOK6p0R7hNNqRf',
    mediaUrl: 'https://hw-pcdownload-qcloud.aki-game.net/launcher/clientUpload/current.mp4',
    fileType: 2,
  });
  assert.throws(() => parseWuwaBackground(config, {
    functionSwitch: 1,
    backgroundFileType: 2,
    backgroundFile: 'https://example.com/launcher/clientUpload/current.mp4',
  }), /official download hosts/);
});

test('launcher visual verifier rejects bytes that differ from the Pengo manifest', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nyx-launcher-visuals-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'launcher-visuals');
  await fs.mkdir(directory);
  const bytes = Buffer.from('verified-webm');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const fileName = `${hash}.webm`;
  await fs.writeFile(path.join(directory, fileName), bytes);
  await fs.writeFile(path.join(root, 'launcher-visuals-v1.json'), JSON.stringify(manifestFor({
      gi: {
        kind: 'video',
        assets: [{
          url: `https://assets.pengo.gg/launcher-visuals/${fileName}`,
          sha256: hash,
          size: bytes.length,
          mediaType: 'video/webm',
        }],
      },
  })));

  assert.equal((await verifyLauncherVisuals(root)).files, 1);
  const plan = await buildLauncherVisualUploadPlan(root);
  assert.equal(plan.assets[0].key, `launcher-visuals/${fileName}`);
  assert.equal(plan.manifest.key, 'launcher-visuals-v1.json');
  await fs.writeFile(path.join(directory, fileName), Buffer.from('tampered-webm'));
  await assert.rejects(() => verifyLauncherVisuals(root), /size does not match|hash does not match/);
});

test('launcher visual verifier accepts a mirrored WuWa MP4', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nyx-launcher-visuals-wuwa-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'launcher-visuals');
  await fs.mkdir(directory);
  const bytes = Buffer.from('0000ftypisom-wuwa-test');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const fileName = `${hash}.mp4`;
  await fs.writeFile(path.join(directory, fileName), bytes);
  await fs.writeFile(path.join(root, 'launcher-visuals-v1.json'), JSON.stringify(manifestFor({
      wuwa: {
        kind: 'video',
        assets: [{
          url: `https://assets.pengo.gg/launcher-visuals/${fileName}`,
          sha256: hash,
          size: bytes.length,
          mediaType: 'video/mp4',
        }],
      },
  })));

  const result = await verifyLauncherVisuals(root);
  assert.equal(result.files, 1);
  const plan = await buildLauncherVisualUploadPlan(root);
  assert.equal(plan.assets[0].mediaType, 'video/mp4');
});

test('launcher visual uploads invoke only the pinned local Wrangler', async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(repository, 'Site', 'package.json'), 'utf8'));
  const packageLock = JSON.parse(await fs.readFile(path.join(repository, 'Site', 'package-lock.json'), 'utf8'));
  const invocation = launcherVisualWranglerInvocation({
    key: 'launcher-visuals/example.webm',
    file: 'example.webm',
    mediaType: 'video/webm',
    cacheControl: 'public,max-age=31536000,immutable',
  });

  assert.match(packageJson.devDependencies.wrangler, /^\d+\.\d+\.\d+$/);
  assert.equal(packageLock.packages[''].devDependencies.wrangler, packageJson.devDependencies.wrangler);
  assert.equal(packageLock.packages['node_modules/wrangler'].version, packageJson.devDependencies.wrangler);
  assert.equal(invocation.file, process.execPath);
  assert.equal(invocation.args[0], path.join(repository, 'Site', 'node_modules', 'wrangler', 'bin', 'wrangler.js'));
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.args.includes('--yes'), false);
});

test('public byte verification stops oversized and stalled streams', async () => {
  const bytes = Buffer.from('good');
  const item = {
    url: 'https://assets.pengo.gg/launcher-visuals/test.webm',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    mediaType: 'video/webm',
    cacheControl: 'public,max-age=31536000,immutable',
  };
  const headers = { 'Content-Type': 'video/webm', 'Cache-Control': item.cacheControl };
  let oversizedCanceled = false;
  const oversized = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(item.size + 1)); },
    cancel() { oversizedCanceled = true; },
  }), { headers });
  await assert.rejects(() => verifyBytes(item, 'oversized', {
    fetchImpl: async () => oversized,
    timeoutMs: 100,
  }), /exceeds 4 bytes/);
  assert.equal(oversizedCanceled, true);

  let stalledCanceled = false;
  const stalled = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([1])); },
    cancel() { stalledCanceled = true; },
  }), { headers });
  await assert.rejects(() => verifyBytes(item, 'stalled', {
    fetchImpl: async () => stalled,
    timeoutMs: 20,
  }), (error) => error?.name === 'TimeoutError');
  assert.equal(stalledCanceled, true);
});

test('the mutable launcher manifest rejects a longer public cache lifetime', () => {
  const item = {
    size: 10,
    mediaType: 'application/json',
    cacheControl: 'public,max-age=60,must-revalidate',
  };
  const response = (cacheControl) => new Response('{}', {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
    },
  });

  assert.equal(metadataMatches(response('public,max-age=600,must-revalidate'), item, { requireLength: false }), false);
  assert.equal(metadataMatches(response('public, max-age=60, must-revalidate'), item, { requireLength: false }), true);
});

test('R2 sync rejects same-size corrupt asset bytes even when HEAD metadata matches', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nyx-launcher-visuals-r2-corrupt-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'launcher-visuals');
  await fs.mkdir(directory);
  const bytes = Buffer.from('right');
  const corrupt = Buffer.from('wrong');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const fileName = `${hash}.webm`;
  await fs.writeFile(path.join(directory, fileName), bytes);
  await fs.writeFile(path.join(root, 'launcher-visuals-v1.json'), JSON.stringify(manifestFor({
    gi: {
      kind: 'video',
      assets: [{
        url: `https://assets.pengo.gg/launcher-visuals/${fileName}`,
        sha256: hash,
        size: bytes.length,
        mediaType: 'video/webm',
      }],
    },
  })));
  const headers = {
    'Content-Type': 'video/webm',
    'Content-Length': String(bytes.length),
    'Cache-Control': 'public,max-age=31536000,immutable',
  };
  let requests = 0;
  await assert.rejects(() => syncLauncherVisuals({
    apply: true,
    baseDirectory: root,
    fetchImpl: async (_url, options) => {
      requests += 1;
      return options.method === 'HEAD'
        ? new Response(null, { headers })
        : new Response(corrupt, { headers });
    },
    execFileImpl: async () => { throw new Error('metadata match must not upload'); },
    timeoutMs: 100,
  }), /Public bytes do not match/);
  assert.equal(requests, 2);
});
