import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { ROOT, applySourcedBannerWindows, buildManifest, fetchRemoteLauncherArt, installManifestAtomically, loadManifestInputs, mirrorLauncherArt, officialUrl, reconcileLauncherCodes, validatePackagedManifest } from '../generate-launcher-manifest.mjs';

const NOW = Date.parse('2026-07-17T00:00:00.000Z');
const phase = (start, end, characters = [{ name: 'Alpha', rarity: 5 }]) => ({ phase: '1.0', start, end, characters });
const events = Object.fromEntries(['gi', 'hsr', 'zzz', 'wuwa', 'ae'].map((game) => [game, { events: [{ id: `${game}-safe`, title: 'Official update', start: '2026-07-16T00:00:00.000Z', end: '2026-07-20T00:00:00.000Z', source: { url: game === 'wuwa' ? 'https://wutheringwaves.kurogames.com/en/main/news/detail/1' : game === 'ae' ? 'https://endfield.gryphline.com/en-us/news/1' : `https://${game === 'gi' ? 'sg-hk4e-api' : game === 'hsr' ? 'sg-hkrpg-api' : 'sg-announcement-api'}.hoyoverse.com/common/announcement/1` } }, { id: `${game}-unsafe`, title: 'Unsafe', source: { url: 'http://example.invalid/nope' } }] }]));
const rosters = Object.fromEntries(['gi', 'hsr', 'zzz', 'wuwa', 'ae'].map((game) => [game, [{ id: `${game}-alpha`, name: 'Alpha', rarity: 5, limited: true, release: '2026-01-01T00:00:00.000Z', assets: game === 'gi' ? { gacha: 'GameData/gi/assets/characters/gacha/UI_Gacha_AvatarImg_MarionetteNew.webp' } : undefined }]]));

test('launcher code reconciliation changes only codes and content revision', () => {
  const manifest = buildManifest({ banners: {}, events: {}, rosters: {}, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z' });
  const original = structuredClone(manifest);
  const games = Object.fromEntries(['gi', 'hsr', 'zzz', 'wuwa', 'ae'].map((game) => [game, game === 'gi' ? [{ code: 'SAFE123', added: '2026-07-17', amount: 60, currency: 'Primogems', internal: 'must-not-leak' }] : []]));
  const reconciled = reconcileLauncherCodes(manifest, { schemaVersion: 1, games });

  assert.deepEqual(manifest, original, 'input manifest must remain unchanged on success');
  assert.notEqual(reconciled.revision, original.revision);
  assert.deepEqual(reconciled.games.gi.codes, [{ code: 'SAFE123', added: '2026-07-17', amount: 60, currency: 'Primogems' }]);
  for (const game of ['gi', 'hsr', 'zzz', 'wuwa', 'ae']) {
    const before = structuredClone(original.games[game]);
    const after = structuredClone(reconciled.games[game]);
    delete before.codes;
    delete after.codes;
    assert.deepEqual(after, before, `${game} banner data or art changed`);
  }
});

test('launcher code reconciliation rejects malformed or partial feeds without mutation', () => {
  const manifest = buildManifest({ banners: {}, events: {}, rosters: {}, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z' });
  const original = structuredClone(manifest);
  const emptyGames = Object.fromEntries(['gi', 'hsr', 'zzz', 'wuwa', 'ae'].map((game) => [game, []]));
  const invalidFeeds = [
    { schemaVersion: 2, games: emptyGames },
    { schemaVersion: 1, games: { gi: [] } },
    { schemaVersion: 1, games: { ...emptyGames, gi: [{ code: '../BAD', added: '2026-07-17', amount: 60, currency: 'Primogems' }] } },
    { schemaVersion: 1, games: { ...emptyGames, gi: [{ code: 'SAFE123', added: 'not-a-date', amount: 60, currency: 'Primogems' }] } },
    { schemaVersion: 1, games: { ...emptyGames, gi: [{ code: 'SAFE123', added: '2026-07-17', amount: -1, currency: 'Primogems' }] } },
  ];

  for (const feed of invalidFeeds) assert.throws(() => reconcileLauncherCodes(manifest, feed));
  assert.deepEqual(manifest, original, 'input manifest must remain unchanged after rejected feeds');
});

test('strict official links accept only HTTPS publisher hosts', () => {
  assert.equal(officialUrl('https://genshin.hoyoverse.com/en/news/1#unsafe', 'gi'), 'https://genshin.hoyoverse.com/en/news/1');
  assert.equal(officialUrl('https://example.com/news', 'gi'), null);
  assert.equal(officialUrl('http://sg-hk4e-api.hoyoverse.com/news', 'gi'), null);
  assert.equal(officialUrl('https://sg-hk4e-api.hoyoverse.com:444/news', 'gi'), null);
  assert.equal(officialUrl('https://sg-hk4e-api.hoyoverse.com/news?u=x', 'gi'), 'https://sg-hk4e-api.hoyoverse.com/news?u=x');
  assert.equal(officialUrl('https://sg-hkrpg-api.hoyoverse.com/news', 'gi'), null);
  assert.equal(officialUrl('https://honkai-star-rail.hoyoverse.com/news', 'gi'), null);
  assert.equal(officialUrl('https://evil.sg-hk4e-api.hoyoverse.com/news', 'gi'), null);
});

test('boundary uses start inclusive and end exclusive', () => {
  const banners = { games: [{ id: 'gi', current: phase('2026-07-17T00:00:00.000Z', '2026-07-18T00:00:00.000Z') }] };
  const atStart = buildManifest({ banners, events, rosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z', db: path.join(ROOT, 'Database') });
  assert.equal(atStart.games.gi.current.start, '2026-07-17T00:00:00.000Z');
  const atEnd = buildManifest({ banners: { games: [{ id: 'gi', current: phase('2026-07-16T00:00:00.000Z', '2026-07-17T00:00:00.000Z') }] }, events, rosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z' });
  assert.equal(atEnd.games.gi.current, null);
});

test('revision stays stable while only the countdown clock changes', () => {
  const banners = { games: [{ id: 'gi', current: phase('2026-07-16T00:00:00.000Z', '2026-07-18T00:00:00.000Z', [{ name: 'Citlali' }]) }] };
  const first = buildManifest({ banners, events, rosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z', db: path.join(ROOT, 'Database') });
  const second = buildManifest({ banners, events, rosters, now: NOW + 1000, generatedAt: '2026-07-17T00:00:01.000Z', db: path.join(ROOT, 'Database') });

  assert.notEqual(first.games.gi.current.remaining.durationSeconds, second.games.gi.current.remaining.durationSeconds);
  assert.equal(first.revision, second.revision);
});

test('overlap, including sourced current windows, uncertainty, and stale groups never become current', () => {
  const banners = { games: [
    { id: 'gi', current: { ...phase('2026-07-16T00:00:00.000Z', '2026-07-18T00:00:00.000Z'), _sourcedWindow: true }, next: phase('2026-07-17T00:00:00.000Z', '2026-07-19T00:00:00.000Z') },
    { id: 'hsr', current: { end: '2026-07-20T00:00:00.000Z', characters: [{ name: 'Alpha' }] } },
    { id: 'zzz', freshness: { status: 'stale' }, current: phase('2026-07-16T00:00:00.000Z', '2026-07-18T00:00:00.000Z') },
  ] };
  const manifest = buildManifest({ banners, events, rosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z' });
  assert.equal(manifest.games.gi.current, null);
  assert.equal(manifest.games.hsr.current, null);
  assert.equal(manifest.games.zzz.current, null);
});

test('a trusted history-backed current window survives a preserved raw-feed warning', () => {
  const banners = { games: [{
    id: 'gi',
    freshness: {
      status: 'fresh',
      message: 'This game failed to scrape during the latest banner check; preserved previous data.',
    },
    current: {
      ...phase('2026-07-16T00:00:00.000Z', '2026-07-18T00:00:00.000Z'),
      _sourcedWindow: true,
    },
  }] };

  const manifest = buildManifest({ banners, events, rosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z' });

  assert.equal(manifest.games.gi.current?.phase, '1.0');
});

test('fresh explicit current banner remains unavailable when its official start is missing', () => {
  const banners = { games: [{
    id: 'genshin',
    freshness: { status: 'fresh', lastSuccessfulFetch: '2026-07-16T12:00:00.000Z' },
    current: { phase: '6.7 Phase 1', end: '2026-07-18T00:00:00.000Z', characters: [{ name: 'Current Hero' }] },
    next: phase('2026-07-16T00:00:00.000Z', '2026-07-19T00:00:00.000Z', [{ name: 'Overlapping Next' }]),
  }] };
  const manifest = buildManifest({ banners, events, rosters: {}, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z' });
  assert.equal(manifest.games.gi.current, null);
  assert.equal(manifest.health.games.gi.reason, 'uncertain');
});

test('all five canonical games keep unsafe news visible but non-clickable', () => {
  const banners = { games: ['gi', 'hsr', 'zzz', 'wuwa', 'endfield'].map((id) => ({ id, current: phase('2026-07-16T00:00:00.000Z', '2026-07-18T00:00:00.000Z') })) };
  const manifest = buildManifest({ banners, events, rosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z' });
  assert.deepEqual(Object.keys(manifest.games), ['gi', 'hsr', 'zzz', 'wuwa', 'ae']);
  for (const game of Object.keys(manifest.games)) {
    assert.equal(manifest.games[game].news.length, 2);
    assert.equal(manifest.games[game].news.filter((item) => item.url === null).length, 1);
    assert.equal(manifest.games[game].news.filter((item) => /^https:\/\//.test(item.url ?? '')).length, 1);
  }
});

test('production manifest carries only the five newest premium currency codes', () => {
  const manifest = buildManifest({ ...loadManifestInputs({ now: NOW }), now: NOW, generatedAt: '2026-07-17T00:00:00.000Z' });
  for (const game of Object.values(manifest.games)) {
    assert.ok(game.codes.length <= 5);
    assert.ok(game.codes.every((entry) => /^[-_A-Za-z0-9]{1,64}$/.test(entry.code)));
    assert.ok(game.codes.every((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.added)));
    assert.ok(game.codes.every((entry, index) => index === 0 || game.codes[index - 1].added >= entry.added));
  }
});

test('local assets carry runtime metadata and a stable SHA-256', () => {
  const manifest = buildManifest({ banners: { games: [{ id: 'gi', current: phase('2026-07-16T00:00:00.000Z', '2026-07-18T00:00:00.000Z') }] }, events, rosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z' });
  const asset = manifest.games.gi.current.selectedCharacter.variants[0];
  assert.ok(asset);
  assert.equal(asset.mime, 'image/webp');
  assert.ok(asset.size > 0);
  assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  const bytes = fs.readFileSync(path.join(ROOT, asset.path.slice(1)));
  assert.equal(asset.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(asset.transparentBounds, { left: 0, top: 0, right: asset.dimensions.width, bottom: asset.dimensions.height });
});

test('current local art is normalized into metadata-free bounded WebP package assets', async () => {
  const manifest = buildManifest({ banners: { games: [{ id: 'gi', current: phase('2026-07-16T00:00:00.000Z', '2026-07-18T00:00:00.000Z') }] }, events, rosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z' });
  const originalIconPath = manifest.games.gi.current.characters[0].icon.path;
  assert.ok(originalIconPath.startsWith('/Database/'));
  const outputDir = fs.mkdtempSync(path.join(ROOT, 'Site', 'launcher-art-test-'));
  try {
    const result = await mirrorLauncherArt(manifest, { outputDir });
    assert.equal(result.count, 1);
    const files = fs.readdirSync(outputDir).sort();
    assert.equal(files.length, 1);
    for (const file of files) {
      assert.match(file, /^[a-f0-9]{64}\.webp$/);
      const bytes = fs.readFileSync(path.join(outputDir, file));
      assert.equal(file.slice(0, 64), crypto.createHash('sha256').update(bytes).digest('hex'));
    }
    const json = JSON.stringify(manifest);
    assert.doesNotMatch(json, /nanoka/i);
    assert.ok(manifest.games.gi.current.variants.every((asset) => asset.path.startsWith('/launcher-art/')));
    assert.ok(manifest.games.gi.current.variants.every((asset) => asset.url.startsWith('https://pengo.gg/dist/launcher-art/')));
    assert.ok(manifest.games.gi.current.variants.every((asset) => asset.mime === 'image/webp'));
    assert.ok(manifest.games.gi.current.variants.every((asset) => Math.max(asset.dimensions.width, asset.dimensions.height) <= 2048));
    const icon = manifest.games.gi.current.characters[0].icon;
    assert.match(icon.path, /^\/launcher-art\/[a-f0-9]{64}\.webp$/);
    assert.equal(icon.url, `https://pengo.gg/dist${icon.path}`);
    assert.equal(icon.mime, 'image/webp');
    assert.ok(manifest.revision);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('failed art generation preserves the last-known-good output and manifest', async () => {
  const manifest = buildManifest({ banners: { games: [{ id: 'gi', current: phase('2026-07-16T00:00:00.000Z', '2026-07-18T00:00:00.000Z') }] }, events, rosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z' });
  manifest.games.gi.current.variants[0].path = '/Database/does-not-exist.webp';
  const before = structuredClone(manifest);
  const outputDir = fs.mkdtempSync(path.join(ROOT, 'Site', 'launcher-art-rollback-test-'));
  const sentinel = path.join(outputDir, 'last-known-good.webp');
  fs.writeFileSync(sentinel, 'preserve-me');
  try {
    await assert.rejects(mirrorLauncherArt(manifest, { outputDir }), /source is missing/);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve-me');
    assert.deepEqual(manifest, before);
    assert.equal(fs.readdirSync(path.dirname(outputDir)).some((entry) => entry.startsWith(`${path.basename(outputDir)}.tmp-`)), false);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('remote launcher art rejects redirects before reading response bytes', async () => {
  const sourceUrl = 'https://static.nanoka.cc/assets/ww/icons/test.webp';
  let options;
  let read = false;
  const fetchImpl = async (_url, requestOptions) => {
    options = requestOptions;
    return {
      ok: true,
      status: 200,
      redirected: true,
      url: 'https://example.invalid/redirected.webp',
      headers: { get: (name) => name === 'content-type' ? 'image/webp' : null },
      body: { getReader() { read = true; throw new Error('redirect body must not be read'); } },
    };
  };

  await assert.rejects(fetchRemoteLauncherArt(sourceUrl, { fetchImpl }), /redirected away/);
  assert.equal(options.redirect, 'error');
  assert.equal(read, false);
});

test('remote launcher art stops an unbounded stream as soon as its byte cap is exceeded', async () => {
  const sourceUrl = 'https://static.nanoka.cc/assets/ww/icons/test.webp';
  const chunks = [Buffer.alloc(5, 1), Buffer.alloc(5, 2)];
  let index = 0;
  let cancelled = false;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    redirected: false,
    url: sourceUrl,
    headers: { get: (name) => name === 'content-type' ? 'image/webp' : null },
    body: { getReader: () => ({
      async read() { return index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }; },
      async cancel() { cancelled = true; },
      releaseLock() {},
    }) },
  });

  await assert.rejects(fetchRemoteLauncherArt(sourceUrl, { fetchImpl, maxBytes: 8 }), /exceeds 8 bytes/);
  assert.equal(cancelled, true);
  assert.equal(index, 2);
});

test('remote launcher art admits only reviewed Game8 image paths and matching image signatures', async () => {
  const sourceUrl = 'https://img.game8.co/4556216/2c5a1a5333a8fd3ec41795dfa39e175e.png/show';
  const response = (contentType, bytes) => ({
    ok: true,
    status: 200,
    redirected: false,
    url: sourceUrl,
    headers: { get: (name) => name === 'content-type' ? contentType : null },
    body: new Blob([bytes]).stream(),
  });
  const png = fs.readFileSync(path.join(ROOT, 'Database', 'EndfieldWiki', 'endfield', 'assets', 'operators', 'liino', 'icon.png'));

  assert.deepEqual(await fetchRemoteLauncherArt(sourceUrl, { fetchImpl: async () => response('image/png', png) }), png);
  await assert.rejects(fetchRemoteLauncherArt(sourceUrl, { fetchImpl: async () => response('text/html', png) }), /unsupported MIME/);
  await assert.rejects(fetchRemoteLauncherArt(sourceUrl, { fetchImpl: async () => response('image/png', Buffer.from('not an image')) }), /signature does not match/);
  for (const invalid of [
    'http://img.game8.co/4556216/2c5a1a5333a8fd3ec41795dfa39e175e.png/show',
    'https://img.game8.co/4556216/not-reviewed.png/show',
    'https://img.game8.co/4556216/2c5a1a5333a8fd3ec41795dfa39e175e.png/show?download=1',
    'https://evil.img.game8.co/4556216/2c5a1a5333a8fd3ec41795dfa39e175e.png/show',
  ]) await assert.rejects(fetchRemoteLauncherArt(invalid, { fetchImpl: async () => { throw new Error('must not fetch'); } }), /not approved/);
});

test('packaged manifest validation rejects stale time, expired windows, bad countdowns, and provenance leakage', () => {
  const sha = '0'.repeat(64);
  const asset = {
    path: `/launcher-art/${sha}.webp`,
    url: `https://pengo.gg/dist/launcher-art/${sha}.webp`,
    sha256: sha,
    mime: 'image/webp',
    size: 1,
    dimensions: { width: 1, height: 1 },
  };
  const games = Object.fromEntries(['gi', 'hsr', 'zzz', 'wuwa', 'ae'].map((game) => [game, {
    game,
    current: {
      start: '2026-07-16T00:00:00.000Z',
      end: '2026-07-18T00:00:00.000Z',
      remaining: {
        startsAt: '2026-07-16T00:00:00.000Z',
        endsAt: '2026-07-18T00:00:00.000Z',
        durationSeconds: 86_400,
      },
      selectedCharacter: { name: `${game}-current`, variants: [asset] },
      variants: [asset],
      characters: [{ name: `${game}-current`, icon: asset, variants: [asset] }],
    },
    upcoming: [],
  }]));
  const manifest = {
    schemaVersion: 1,
    revision: '1'.repeat(64),
    generatedAt: '2026-07-17T00:00:00.000Z',
    health: { status: 'ok', games: Object.fromEntries(Object.keys(games).map((game) => [game, { status: 'ok' }])) },
    games,
  };
  assert.deepEqual(validatePackagedManifest(manifest, { now: NOW }), { assets: 15, uniqueAssets: 1 });
  assert.throws(
    () => validatePackagedManifest(manifest, { now: NOW + 15 * 60_000 + 1 }),
    /generatedAt is missing or stale/,
  );

  const expiredCurrent = structuredClone(manifest);
  for (const game of Object.values(expiredCurrent.games)) {
    game.current.end = '2026-07-17T00:01:00.000Z';
    game.current.remaining.endsAt = game.current.end;
    game.current.remaining.durationSeconds = 60;
  }
  assert.throws(
    () => validatePackagedManifest(expiredCurrent, { now: NOW + 60_000 }),
    /current window is not active at deployment time/,
  );

  const forgedCountdown = structuredClone(manifest);
  forgedCountdown.games.gi.current.remaining.durationSeconds += 1;
  assert.throws(
    () => validatePackagedManifest(forgedCountdown, { now: NOW }),
    /current countdown does not match the committed snapshot/,
  );
  manifest.games.wuwa.current.characters[0].icon = { ...asset, sourceUrl: 'https://static.nanoka.cc/private.webp' };
  assert.throws(() => validatePackagedManifest(manifest, { now: NOW }), /internal provenance/);

  const databaseIcon = {
    ...asset,
    source: 'character-icon',
    path: '/Database/GameData/hsr/assets/characters/round/1512.webp',
    url: 'https://assets.pengo.gg/legacy/Database/GameData/hsr/assets/characters/round/1512.webp',
  };
  manifest.games.wuwa.current.characters[0].icon = databaseIcon;
  assert.doesNotThrow(() => validatePackagedManifest(manifest, { now: NOW }));
  manifest.games.wuwa.current.characters[0].icon = { ...databaseIcon, url: `${databaseIcon.url}?v=1` };
  assert.throws(() => validatePackagedManifest(manifest, { now: NOW }), /asset URL is invalid/);
  manifest.games.wuwa.current.characters[0].icon = { ...databaseIcon, path: '/Database/../secret.webp', url: 'https://assets.pengo.gg/legacy/Database/../secret.webp' };
  assert.throws(() => validatePackagedManifest(manifest, { now: NOW }), /asset path\/hash is invalid/);
});

test('manifest install failure preserves the old manifest and every old referenced art file', async () => {
  const candidate = buildManifest({ banners: { games: [{ id: 'gi', current: phase('2026-07-16T00:00:00.000Z', '2026-07-18T00:00:00.000Z') }] }, events, rosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z' });
  const root = fs.mkdtempSync(path.join(ROOT, 'Site', 'launcher-transaction-test-'));
  const outputDir = path.join(root, 'launcher-art');
  const manifestOutput = path.join(root, 'launcher-banners-v1.json');
  const oldArt = path.join(outputDir, `${'f'.repeat(64)}.webp`);
  const oldManifest = Buffer.from('{"old":true}\n');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(oldArt, 'old-art');
  fs.writeFileSync(manifestOutput, oldManifest);
  try {
    await assert.rejects(mirrorLauncherArt(candidate, {
      outputDir,
      manifestOutput,
      installManifest: () => {
        assert.ok(fs.readdirSync(outputDir).some((file) => file !== path.basename(oldArt)));
        throw new Error('injected manifest install failure');
      },
    }), /injected manifest install failure/);
    assert.deepEqual(fs.readFileSync(manifestOutput), oldManifest);
    assert.equal(fs.readFileSync(oldArt, 'utf8'), 'old-art');
    assert.equal(fs.readdirSync(root).some((file) => file.includes('.tmp') || file.includes('.bak')), false);

    await mirrorLauncherArt(candidate, { outputDir, manifestOutput });
    assert.deepEqual(fs.readFileSync(manifestOutput), Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`));
    assert.equal(fs.existsSync(oldArt), false);
    assert.deepEqual(
      fs.readdirSync(outputDir).sort(),
      [...new Set([...candidate.games.gi.current.variants, candidate.games.gi.current.characters[0].icon]
        .map((asset) => path.basename(asset.path)))].sort(),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('atomic manifest replacement never removes the live manifest before replacement', () => {
  const root = fs.mkdtempSync(path.join(ROOT, 'Site', 'manifest-replace-test-'));
  const target = path.join(root, 'launcher-banners-v1.json');
  const oldBytes = Buffer.from('{"old":true}\n');
  const nextBytes = Buffer.from('{"next":true}\n');
  fs.writeFileSync(target, oldBytes);
  try {
    assert.throws(() => installManifestAtomically(target, nextBytes, {
      replaceFile: (temporary, live) => {
        assert.equal(live, target);
        assert.deepEqual(fs.readFileSync(live), oldBytes);
        assert.deepEqual(fs.readFileSync(temporary), nextBytes);
        throw new Error('injected atomic replace failure');
      },
    }), /injected atomic replace failure/);
    assert.deepEqual(fs.readFileSync(target), oldBytes);
    assert.deepEqual(fs.readdirSync(root), ['launcher-banners-v1.json']);
    installManifestAtomically(target, nextBytes);
    assert.deepEqual(fs.readFileSync(target), nextBytes);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Genshin uses the local splash and never the removed portrait source', () => {
  const banners = { games: [{ id: 'gi', current: phase('2026-07-16T00:00:00.000Z', '2026-07-18T00:00:00.000Z', [{ name: 'Citlali' }]) }] };
  const customRosters = { ...rosters, gi: [{
    id: 'citlali',
    name: 'Citlali',
    rarity: 5,
    assets: { gacha: 'GameData/gi/assets/characters/gacha/UI_Gacha_AvatarImg_Citlali.webp' },
  }] };
  const manifest = buildManifest({ banners, events, rosters: customRosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z', db: path.join(ROOT, 'Database') });
  const variant = manifest.games.gi.current.selectedCharacter.variants[0];
  assert.equal(variant.source, 'splash');
  assert.match(variant.path, /UI_Gacha_AvatarImg_Citlali\.webp$/);
});

test('Prydwen source-hash aliases keep verified current art and provide an icon fallback', () => {
  const db = fs.mkdtempSync(path.join(ROOT, 'Site', 'launcher-prydwen-alias-test-'));
  try {
    const assetsDir = path.join(db, 'Prydwen', 'zzz', 'assets', 'characters');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.copyFileSync(
      path.join(ROOT, 'Database', 'GameData', 'gi', 'assets', 'characters', 'gacha', 'UI_Gacha_AvatarImg_Citlali.webp'),
      path.join(assetsDir, 'remielle-0123456789ab.webp'),
    );
    const banners = { games: [{ id: 'zzz', current: phase('2026-07-16T00:00:00.000Z', '2026-07-18T00:00:00.000Z', [{ name: 'Remielle Dan', rarity: 5 }]) }] };
    const customPrydwen = { zzz: [{
      id: 'remielle',
      name: 'Remielle',
      facts: { rarity: 'S' },
      art: { full: 'Prydwen/zzz/assets/characters/remielle-full-0123456789ab.webp' },
    }] };

    const manifest = buildManifest({
      banners,
      events,
      rosters: { ...rosters, zzz: [] },
      prydwen: customPrydwen,
      now: NOW,
      generatedAt: '2026-07-17T00:00:00.000Z',
      db,
    });
    const character = manifest.games.zzz.current.selectedCharacter;

    assert.match(character.variants[0].path, /remielle-0123456789ab\.webp$/);
    assert.equal(character.icon.source, 'character-icon');
    assert.equal(character.icon.sha256, character.variants[0].sha256);
    assert.deepEqual(character.icon.placement, { anchor: 'center', fit: 'cover', x: 0.5, y: 0.5 });
  } finally {
    fs.rmSync(db, { recursive: true, force: true });
  }
});

test('policy winner remains selected when its art is unavailable and current art remains usable as fallback', () => {
  const banners = { games: [{ id: 'gi', current: phase('2026-07-16T00:00:00.000Z', '2026-07-18T00:00:00.000Z', [{ name: 'Artless Newcomer' }, { name: 'Citlali' }]) }] };
  const customRosters = { ...rosters, gi: [
    { id: 'new', name: 'Artless Newcomer', rarity: 5, limited: true, release: '2026-07-01T00:00:00.000Z' },
    { id: 'citlali', name: 'Citlali', rarity: 5, limited: true, release: '2025-01-01T00:00:00.000Z', assets: { gacha: 'GameData/gi/assets/characters/gacha/UI_Gacha_AvatarImg_Citlali.webp' } },
  ] };
  const manifest = buildManifest({ banners, events, rosters: customRosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z', db: path.join(ROOT, 'Database') });
  assert.equal(manifest.games.gi.current.selectedCharacter.name, 'Artless Newcomer');
  assert.equal(manifest.games.gi.current.selectionReason, 'newer-limited-debut');
  assert.equal(manifest.games.gi.current.selectedCharacter.variants.length, 0);
  assert.ok(manifest.games.gi.current.variants.length > 0);
});

test('selection uses rarity, newer limited debut, then stable identity', () => {
  const banners = { games: [{ id: 'gi', current: phase('2026-07-16T00:00:00.000Z', '2026-07-18T00:00:00.000Z', [{ name: 'Zulu' }, { name: 'Alpha' }]) }] };
  const customRosters = { ...rosters, gi: [
    { id: 'z', name: 'Zulu', rarity: 5, limited: true, release: '2026-01-01T00:00:00.000Z' },
    { id: 'a', name: 'Alpha', rarity: 5, limited: true, release: '2026-06-01T00:00:00.000Z' },
  ] };
  const manifest = buildManifest({ banners, events, rosters: customRosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z' });
  assert.equal(manifest.games.gi.current.selectedCharacter.name, 'Alpha');
  assert.equal(manifest.games.gi.current.selectionReason, 'newer-limited-debut');
});

test('upcoming phases with unresolved icons are omitted instead of leaking broken art', () => {
  const banners = { games: [{
    id: 'gi',
    current: phase('2026-07-16T00:00:00.000Z', '2026-07-18T00:00:00.000Z'),
    next: phase('2026-07-18T00:00:00.000Z', '2026-07-20T00:00:00.000Z', [{ name: 'Unknown Future Character' }]),
  }] };
  const manifest = buildManifest({ banners, events, rosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z' });
  assert.deepEqual(manifest.games.gi.upcoming, []);
});

test('recent Game8 future windows publish automatically in deterministic non-overlapping phases', () => {
  const raw = { games: [{
    id: 'hsr',
    freshness: { status: 'fresh', source: 'game8', lastSuccessfulFetch: '2026-07-17T00:00:00.000Z' },
    next: phase('2026-07-18T00:00:00Z', '2026-08-08T00:00:00Z', [{ name: 'Summeretto' }]),
    upcoming: [
      phase('2026-07-18T00:00:00Z', '2026-08-08T00:00:00Z', [{ name: 'Summeretto' }]),
      phase('2026-08-08T00:00:00Z', '2026-08-29T00:00:00Z', [{ name: 'Waveflair' }]),
      phase('2026-07-18T00:00:00Z', '2026-08-29T00:00:00Z', [{ name: 'Summary Row' }]),
    ],
  }] };
  const missingHistory = path.join(ROOT, 'missing-banner-history');
  const normalized = applySourcedBannerWindows(raw, missingHistory, NOW);

  assert.deepEqual(normalized.games[0]._displayUpcoming.map((entry) => ({
    start: entry.start,
    end: entry.end,
    names: entry.characters.map((character) => character.name),
  })), [
    { start: '2026-07-18T00:00:00.000Z', end: '2026-08-08T00:00:00.000Z', names: ['Summeretto'] },
    { start: '2026-08-08T00:00:00.000Z', end: '2026-08-29T00:00:00.000Z', names: ['Waveflair'] },
  ]);
  assert.deepEqual(applySourcedBannerWindows(raw, missingHistory, NOW), normalized);
});

test('stale, non-Game8, and malformed future windows stay out of the launcher feed', () => {
  const candidate = (overrides = {}) => ({
    id: 'hsr',
    freshness: { status: 'fresh', source: 'game8', lastSuccessfulFetch: '2026-07-17T00:00:00.000Z' },
    next: phase('2026-07-18T00:00:00Z', '2026-08-08T00:00:00Z', [{ name: 'Future' }]),
    ...overrides,
  });
  const rejected = [
    candidate({ freshness: { status: 'stale', source: 'game8', lastSuccessfulFetch: '2026-07-17T00:00:00.000Z' } }),
    candidate({ freshness: { status: 'fresh', source: 'other', lastSuccessfulFetch: '2026-07-17T00:00:00.000Z' } }),
    candidate({ freshness: { status: 'fresh', source: 'game8', lastSuccessfulFetch: '2026-07-01T00:00:00.000Z' } }),
    candidate({ next: phase('2026-07-18T00:00:00Z', '2026-09-01T00:00:00Z', [{ name: 'Too Long' }]) }),
    candidate({ next: phase('2026-08-08T00:00:00Z', '2026-07-18T00:00:00Z', [{ name: 'Backwards' }]) }),
  ];

  for (const group of rejected) {
    const normalized = applySourcedBannerWindows({ games: [group] }, path.join(ROOT, 'missing-banner-history'), NOW);
    assert.deepEqual(normalized.games[0]._displayUpcoming, []);
  }
});

test('explicitly preserved Game8 futures survive a bounded source outage', () => {
  const now = Date.parse('2026-07-26T00:00:00.000Z');
  const preserved = {
    id: 'hsr',
    freshness: {
      status: 'stale',
      source: 'game8',
      lastSuccessfulFetch: '2026-07-17T00:00:00.000Z',
      message: 'This game failed to scrape during the latest banner check; preserved previous data.',
    },
    roadmapFreshness: { source: 'game8', lastSuccessfulFetch: '2026-07-17T00:00:00.000Z' },
    next: phase('2026-08-08T00:00:00Z', '2026-08-29T00:00:00Z', [{ name: 'Waveflair' }]),
    roadmap: [{ name: 'Pearl', image: '/assets/banners/hsr/30988ea93b8d36c7cd124310a61341f3.png' }],
  };

  const missingHistory = path.join(ROOT, 'missing-banner-history');
  const normalized = applySourcedBannerWindows({ games: [preserved] }, missingHistory, now).games[0];
  assert.deepEqual(normalized._displayUpcoming.map((entry) => entry.characters.map((character) => character.name)), [['Waveflair']]);
  assert.deepEqual(normalized._displayAnnounced.map((entry) => entry.characters.map((character) => character.name)), [['Pearl']]);

  preserved.freshness.message = 'stale for an unrelated reason';
  const rejected = applySourcedBannerWindows({ games: [preserved] }, missingHistory, now).games[0];
  assert.deepEqual(rejected._displayUpcoming, []);
  assert.deepEqual(rejected._displayAnnounced, []);
});

test('production preprocessing admits every trusted active history channel from the most complete region', () => {
  const db = fs.mkdtempSync(path.join(ROOT, 'Site', 'banner-history-test-'));
  try {
    fs.mkdirSync(path.join(db, 'BannerHistory'));
    const trustedSource = { url: 'https://genshin-impact.fandom.com/wiki/Wish', kind: 'maintained-wiki', revision: 7 };
    const record = (id, name, start, end, overrides = {}) => ({
      id: `gi:character:Character Event:${id}`, game: 'gi', bannerType: 'character', category: 'Character Event', version: '6.7', permanent: false,
      windowsByRegion: { europe: { start, end } },
      featured: [{ name, rarity: 5, primary: true }], source: trustedSource, confirmed: true, ...overrides,
    });
    fs.writeFileSync(path.join(db, 'BannerHistory', 'gi.json'), JSON.stringify({ schemaVersion: 1, game: 'gi', records: [
      record('one', 'Alpha', '2026-07-16T00:00:00Z', '2026-07-18T00:00:00Z'),
      record('two', 'Beta', '2026-07-16T12:00:00Z', '2026-07-17T12:00:00Z'),
      record('asia-only', 'Asia Only', '2026-07-16T00:00:00Z', '2026-07-18T00:00:00Z', { windowsByRegion: { asia: { start: '2026-07-16T00:00:00Z', end: '2026-07-18T00:00:00Z' } } }),
      record('wrong-game', 'Wrong Game', '2026-07-16T00:00:00Z', '2026-07-18T00:00:00Z', { game: 'hsr' }),
      record('unconfirmed', 'Unconfirmed', '2026-07-16T00:00:00Z', '2026-07-18T00:00:00Z', { confirmed: false }),
      record('untrusted', 'Untrusted Source', '2026-07-16T00:00:00Z', '2026-07-18T00:00:00Z', { source: { ...trustedSource, url: 'https://evil.genshin-impact.fandom.com/wiki/Wish' } }),
      record('wrong-kind', 'Wrong Source Kind', '2026-07-16T00:00:00Z', '2026-07-18T00:00:00Z', { source: { ...trustedSource, kind: 'mirror' } }),
      record('missing-revision', 'Missing Revision', '2026-07-16T00:00:00Z', '2026-07-18T00:00:00Z', { source: { url: trustedSource.url, kind: trustedSource.kind } }),
    ] }));
    const raw = { games: [{ id: 'gi', current: phase(null, '2026-07-19T00:00:00Z', [{ name: 'Untrusted' }]), next: phase('2026-07-16T00:00:00Z', '2026-07-20T00:00:00Z', [{ name: 'Unsupported overlap' }]) }] };
    const normalized = applySourcedBannerWindows(raw, db, NOW);
    assert.deepEqual(normalized.games[0].current.characters.map((entry) => entry.name), ['Alpha', 'Beta', 'Unconfirmed']);
    assert.equal(normalized.games[0].current.start, '2026-07-16T12:00:00.000Z');
    assert.equal(normalized.games[0].current.end, '2026-07-17T12:00:00.000Z');
    assert.equal(normalized.games[0].current.phase, '6.7');
    assert.equal(normalized.games[0].current._sourceRegion, 'europe');
    assert.equal(normalized.games[0].next, null);
    assert.ok(normalized.games[0].current._sourceChannels.every((entry) => entry.recordId && entry.category));
    const manifest = buildManifest({ banners: normalized, events, rosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z', db });
    assert.equal(manifest.games.gi.region, 'europe');
    assert.deepEqual(manifest.games.gi.current.characters.map((entry) => entry.name), ['Beta', 'Unconfirmed', 'Alpha']);
  } finally {
    fs.rmSync(db, { recursive: true, force: true });
  }
});

test('production preprocessing gives trusted history precedence over an earlier overlapping raw window', () => {
  const db = fs.mkdtempSync(path.join(ROOT, 'Site', 'banner-upcoming-trust-test-'));
  const source = { url: 'https://genshin-impact.fandom.com/wiki/Wish', kind: 'maintained-wiki', revision: 7 };
  const record = (id, name, start, end, overrides = {}) => ({
    id: `gi:character:Character Event:${id}`,
    game: 'gi', bannerType: 'character', category: 'Character Event', version: '6.7', permanent: false, confirmed: true,
    windowsByRegion: { europe: { start, end } },
    featured: [{ name, rarity: 5, primary: true }], source, ...overrides,
  });
  try {
    fs.mkdirSync(path.join(db, 'BannerHistory'));
    fs.writeFileSync(path.join(db, 'BannerHistory', 'gi.json'), JSON.stringify({ schemaVersion: 1, game: 'gi', records: [
      record('current', 'Alpha', '2026-07-16T00:00:00Z', '2026-07-18T00:00:00Z'),
      record('trusted-future', 'Trusted Future', '2026-07-19T00:00:00Z', '2026-07-20T00:00:00Z'),
      record('unconfirmed-future', 'Unconfirmed Future', '2026-07-21T00:00:00Z', '2026-07-22T00:00:00Z', { confirmed: false }),
      record('untrusted-future', 'Untrusted Future', '2026-07-23T00:00:00Z', '2026-07-24T00:00:00Z', { source: { ...source, url: 'https://evil.genshin-impact.fandom.com/wiki/Wish' } }),
      record('incomplete-future', 'Incomplete Future', '2026-07-25T00:00:00Z', null),
      record('stale', 'Stale Future', '2026-07-14T00:00:00Z', '2026-07-15T00:00:00Z'),
    ] }));
    const raw = { games: [{
      id: 'gi',
      freshness: { status: 'fresh', source: 'game8', lastSuccessfulFetch: '2026-07-17T00:00:00.000Z' },
      current: phase('2026-07-16T00:00:00Z', '2026-07-18T00:00:00Z', [{ name: 'Alpha' }]),
      next: phase('2026-07-18T23:59:00Z', '2026-07-20T00:00:00Z', [{ name: 'Raw Game8 Future' }]),
      upcoming: [],
    }] };

    const normalized = applySourcedBannerWindows(raw, db, NOW);
    assert.equal(normalized.games[0].current.characters[0].name, 'Alpha');
    assert.deepEqual(normalized.games[0]._displayUpcoming.map((entry) => ({
      start: entry.start,
      end: entry.end,
      names: entry.characters.map((character) => character.name),
    })), [
      {
        start: '2026-07-19T00:00:00.000Z',
        end: '2026-07-20T00:00:00.000Z',
        names: ['Trusted Future'],
      },
      {
        start: '2026-07-21T00:00:00.000Z',
        end: '2026-07-22T00:00:00.000Z',
        names: ['Unconfirmed Future'],
      },
    ]);
    const unprocessed = buildManifest({ banners: raw, events, rosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z' });
    assert.deepEqual(unprocessed.games.gi.upcoming, [], 'raw provider future rows must never publish without trusted preprocessing');
  } finally {
    fs.rmSync(db, { recursive: true, force: true });
  }
});

test('a matching sourced phase label replaces an unhelpful history version', () => {
  const db = fs.mkdtempSync(path.join(ROOT, 'Site', 'banner-history-display-phase-test-'));
  try {
    fs.mkdirSync(path.join(db, 'BannerHistory'));
    fs.writeFileSync(path.join(db, 'BannerHistory', 'ae.json'), JSON.stringify({
      schemaVersion: 1,
      game: 'ae',
      records: [{
        id: 'ae:character:Character Event:arcane',
        game: 'ae',
        bannerType: 'character',
        category: 'Character Event',
        version: '2026',
        permanent: false,
        confirmed: true,
        windowsByRegion: { global: { start: '2026-07-16T00:00:00Z', end: '2026-07-18T00:00:00Z' } },
        featured: [{ name: 'Arcane', rarity: 6, primary: true }],
        source: { url: 'https://endfield.wiki.gg/wiki/Headhunting', kind: 'maintained-wiki', revision: 1 },
      }],
    }));
    const raw = { games: [{
      id: 'ae',
      current: { phase: '1.4 Phase 1', end: '2026-07-18T00:00:00Z', characters: [{ name: 'Arcane' }] },
    }] };

    const normalized = applySourcedBannerWindows(raw, db, NOW);

    assert.equal(normalized.games[0].current.phase, '1.4 Phase 1');
  } finally {
    fs.rmSync(db, { recursive: true, force: true });
  }
});

test('wrong-game and untrusted history cannot fall back to raw current data', () => {
  const source = { url: 'https://genshin-impact.fandom.com/wiki/Wish', kind: 'maintained-wiki', revision: 7 };
  const base = {
    id: 'gi:character:Character Event:bad', game: 'gi', bannerType: 'character', category: 'Character Event', version: '6.7', permanent: false,
    windowsByRegion: { europe: { start: '2026-07-16T00:00:00Z', end: '2026-07-18T00:00:00Z' } },
    featured: [{ name: 'Bad', rarity: 5, primary: true }], source, confirmed: true,
  };
  const cases = [
    { name: 'wrong dataset game', historyGame: 'hsr', record: base },
    { name: 'wrong record game', historyGame: 'gi', record: { ...base, game: 'hsr' } },
    { name: 'untrusted host', historyGame: 'gi', record: { ...base, source: { ...source, url: 'https://evil.genshin-impact.fandom.com/wiki/Wish' } } },
    { name: 'untrusted kind', historyGame: 'gi', record: { ...base, source: { ...source, kind: 'mirror' } } },
    { name: 'missing revision', historyGame: 'gi', record: { ...base, source: { url: source.url, kind: source.kind } } },
  ];
  for (const fixture of cases) {
    const db = fs.mkdtempSync(path.join(ROOT, 'Site', 'banner-history-reject-test-'));
    try {
      fs.mkdirSync(path.join(db, 'BannerHistory'));
      fs.writeFileSync(path.join(db, 'BannerHistory', 'gi.json'), JSON.stringify({ schemaVersion: 1, game: fixture.historyGame, records: [fixture.record] }));
      const raw = { games: [{ id: 'gi', current: phase('2026-07-16T00:00:00Z', '2026-07-18T00:00:00Z', [{ name: 'Raw Fallback' }]) }] };
      const normalized = applySourcedBannerWindows(raw, db, NOW);
      assert.equal(normalized.games[0].current, null, fixture.name);
    } finally {
      fs.rmSync(db, { recursive: true, force: true });
    }
  }
});

test('trusted maintained history does not require a second raw provider to publish active characters', () => {
  const db = fs.mkdtempSync(path.join(ROOT, 'Site', 'banner-history-corroboration-test-'));
  const source = { url: 'https://honkai-star-rail.fandom.com/wiki/Warp', kind: 'maintained-wiki', revision: 9 };
  const record = (id, name) => ({
    id: `hsr:character:Character Event:${id}`, game: 'hsr', bannerType: 'character', category: 'Character Event', version: '4.4', permanent: false,
    windowsByRegion: { asia: { start: '2026-07-16T00:00:00Z', end: '2026-07-20T00:00:00Z' } },
    featured: [{ name, rarity: 5, primary: true }], source, confirmed: false,
  });
  try {
    fs.mkdirSync(path.join(db, 'BannerHistory'));
    fs.writeFileSync(path.join(db, 'BannerHistory', 'hsr.json'), JSON.stringify({ schemaVersion: 1, game: 'hsr', records: [
      record('exact', 'Alpha'),
      record('different-primary', 'Himeko Nova'),
    ] }));
    const normalized = applySourcedBannerWindows({ games: [{ id: 'hsr' }] }, db, NOW);
    assert.equal(normalized.games[0].current._sourceRegion, 'asia');
    assert.equal(normalized.games[0].current.phase, '4.4');
    assert.deepEqual(normalized.games[0].current.characters.map((entry) => entry.name), ['Himeko Nova', 'Alpha']);
  } finally {
    fs.rmSync(db, { recursive: true, force: true });
  }
});

test('an exact official Kuro banner can bridge a maintained-wiki rollover gap', () => {
  const db = fs.mkdtempSync(path.join(ROOT, 'Site', 'banner-history-kuro-fallback-test-'));
  try {
    fs.mkdirSync(path.join(db, 'BannerHistory'));
    fs.writeFileSync(path.join(db, 'BannerHistory', 'wuwa.json'), JSON.stringify({
      schemaVersion: 1,
      game: 'wuwa',
      records: [{
        id: 'wuwa:character:Featured Resonator:take-flight-in-spring:2026-07-30t02-00-00-000z',
        game: 'wuwa', bannerType: 'character', category: 'Featured Resonator', version: '3.5', permanent: false, confirmed: true,
        windowsByRegion: {
          europe: { start: '2026-07-30T09:00:00.000Z', end: '2026-08-19T10:59:00.000Z' },
          asia: { start: '2026-07-30T02:00:00.000Z', end: '2026-08-19T03:59:00.000Z' },
          america: { start: '2026-07-30T15:00:00.000Z', end: '2026-08-19T16:59:00.000Z' },
        },
        featured: [{ name: 'Aemeath', rarity: 5, primary: true }],
        source: { url: 'https://wutheringwaves.kurogames.com/en/main/news/detail/5220', kind: 'official-latest', revision: '5220' },
      }],
    }));
    const raw = { games: [{ id: 'wuwa', current: phase('2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z') }] };
    const normalized = applySourcedBannerWindows(raw, db, Date.parse('2026-08-01T00:00:00.000Z'));
    assert.equal(normalized.games[0].current.phase, '3.5');
    assert.equal(normalized.games[0].current._sourceRegion, 'europe');
    assert.deepEqual(normalized.games[0].current.characters.map((entry) => entry.name), ['Aemeath']);

    const history = JSON.parse(fs.readFileSync(path.join(db, 'BannerHistory', 'wuwa.json'), 'utf8'));
    history.records[0].source.url = 'https://wutheringwaves.kurogames.com/en/main/news/detail/9999';
    fs.writeFileSync(path.join(db, 'BannerHistory', 'wuwa.json'), JSON.stringify(history));
    assert.equal(applySourcedBannerWindows(raw, db, Date.parse('2026-08-01T00:00:00.000Z')).games[0].current, null);
  } finally {
    fs.rmSync(db, { recursive: true, force: true });
  }
});

test('trusted overlapping channels require one agreeing non-empty version', () => {
  const db = fs.mkdtempSync(path.join(ROOT, 'Site', 'banner-history-version-test-'));
  const source = { url: 'https://genshin-impact.fandom.com/wiki/Wish', kind: 'maintained-wiki', revision: 7 };
  const record = (id, version) => ({
    id: `gi:character:Character Event:${id}`, game: 'gi', bannerType: 'character', category: 'Character Event', version, permanent: false,
    windowsByRegion: { europe: { start: '2026-07-16T00:00:00Z', end: '2026-07-18T00:00:00Z' } },
    featured: [{ name: id, rarity: 5, primary: true }], source, confirmed: true,
  });
  const raw = { games: [{ id: 'gi', current: phase('2026-07-16T00:00:00Z', '2026-07-18T00:00:00Z') }] };
  try {
    fs.mkdirSync(path.join(db, 'BannerHistory'));
    const write = (records) => fs.writeFileSync(path.join(db, 'BannerHistory', 'gi.json'), JSON.stringify({ schemaVersion: 1, game: 'gi', records }));
    write([record('Alpha', '6.7'), record('Beta', '6.7')]);
    assert.equal(applySourcedBannerWindows(raw, db, NOW).games[0].current.phase, '6.7');

    write([record('Alpha', '6.7'), record('Beta', '6.8')]);
    assert.equal(applySourcedBannerWindows(raw, db, NOW).games[0].current, null);

    write([record('Alpha', '6.7'), record('Beta', null)]);
    assert.equal(applySourcedBannerWindows(raw, db, NOW).games[0].current, null);
  } finally {
    fs.rmSync(db, { recursive: true, force: true });
  }
});

test('selection uses stable identity when debut dates are missing', () => {
  const banners = { games: [{ id: 'zzz', current: phase('2026-07-16T00:00:00.000Z', '2026-07-18T00:00:00.000Z', [{ name: 'New' }, { name: 'Rerun' }]) }] };
  const customRosters = { ...rosters, zzz: [
    { id: 'z', name: 'New', rarity: 5 },
    { id: 'a', name: 'Rerun', rarity: 5 },
  ] };
  const manifest = buildManifest({ banners, events, rosters: customRosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z' });
  assert.equal(manifest.games.zzz.current.selectedCharacter.name, 'New');
  assert.equal(manifest.games.zzz.current.selectionReason, 'stable-identity');
});

test('selection prioritizes a newer debut even when limited metadata is missing', () => {
  const banners = { games: [{ id: 'gi', current: phase('2026-07-16T00:00:00.000Z', '2026-07-18T00:00:00.000Z', [{ name: 'Older' }, { name: 'Newer' }]) }] };
  const customRosters = { ...rosters, gi: [
    { id: 'older', name: 'Older', rarity: 5, release: '2025-01-01T00:00:00.000Z' },
    { id: 'newer', name: 'Newer', rarity: 5, release: '2026-01-01T00:00:00.000Z' },
  ] };
  const manifest = buildManifest({ banners, events, rosters: customRosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z' });
  assert.equal(manifest.games.gi.current.selectedCharacter.name, 'Newer');
  assert.equal(manifest.games.gi.current.selectionReason, 'newer-debut');
});

test('timezone-less roster debuts are UTC-stable and sentinel dates stay unknown', () => {
  const generatorUrl = pathToFileURL(path.join(ROOT, 'Site', 'tools', 'generate-launcher-manifest.mjs')).href;
  const releases = ['2026-01-15 08:30:00', '1970-01-01 00:00:00', '0001-01-01 00:00:00', '9999-12-31 23:59:59'];
  const script = `
    import { buildManifest } from ${JSON.stringify(generatorUrl)};
    const now = Date.parse('2026-07-17T00:00:00.000Z');
    const results = JSON.parse(process.env.ROSTER_RELEASES).map((release) => {
      const manifest = buildManifest({
        banners: { games: [{ id: 'gi', current: { phase: '1.0', start: '2026-07-16T00:00:00.000Z', end: '2026-07-18T00:00:00.000Z', characters: [{ name: 'Alpha' }] } }] },
        events: {},
        rosters: { gi: [{ id: 'alpha', name: 'Alpha', rarity: 5, release }] },
        codes: new Map(),
        now,
        generatedAt: '2026-07-17T00:00:00.000Z',
      });
      return { debut: manifest.games.gi.current.characters[0].debut, revision: manifest.revision };
    });
    process.stdout.write(JSON.stringify(results));
  `;
  const run = (TZ) => {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      env: { ...process.env, TZ, ROSTER_RELEASES: JSON.stringify(releases) },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };

  const utc = run('UTC');
  assert.deepEqual(run('America/Los_Angeles'), utc);
  assert.deepEqual(utc.map((entry) => entry.debut), ['2026-01-15T08:30:00.000Z', null, null, null]);
  assert.equal(new Set(utc.slice(1).map((entry) => entry.revision)).size, 1);
});

test('production snapshot selects the newest splash art and exposes future patch banners', () => {
  const productionNow = Date.parse('2026-07-17T12:00:00.000Z');
  const manifest = buildManifest({
    ...loadManifestInputs({ now: productionNow }),
    now: productionNow,
    generatedAt: '2026-07-17T12:00:00.000Z',
  });
  assert.equal(manifest.games.gi.current.selectedCharacter.name, 'Sandrone');
  assert.equal(manifest.games.hsr.current.selectedCharacter.name, 'Himeko • Nova');
  assert.equal(manifest.games.zzz.current.selectedCharacter.name, 'Norma');
  assert.equal(manifest.games.wuwa.current.selectedCharacter.name, 'Yangyang: Xuanling');
  assert.equal(manifest.games.ae.current.selectedCharacter.name, 'Arcane');
  assert.ok(manifest.games.hsr.current.selectedCharacter.variants.every((variant) => variant.source === 'splash'));
  assert.ok(manifest.games.zzz.current.selectedCharacter.variants.every((variant) => variant.source === 'splash'));
  assert.ok(manifest.games.wuwa.current.selectedCharacter.variants.every((variant) => variant.source === 'splash'));
  for (const game of ['gi', 'hsr', 'zzz', 'wuwa', 'ae']) {
    assert.ok(manifest.games[game].current.characters.every((character) => character.icon?.source === 'character-icon'));
  }
  assert.ok(manifest.games.gi.upcoming.some((phase) => phase.characters.some((character) => character.name === 'Columbina')));
  assert.deepEqual(manifest.games.zzz.upcoming, []);
  assert.deepEqual(manifest.games.wuwa.upcoming[0].characters.map((character) => character.name), ['Suisui', 'Aemeath']);
  assert.deepEqual(manifest.games.ae.upcoming[0].characters.map((character) => character.name), ['Liino', 'Arcane', 'Camille']);
});

test('production source rolls Genshin from Sandrone to Columbina at the trusted boundary', () => {
  const afterRollover = Date.parse('2026-07-21T19:00:00.000Z');
  const manifest = buildManifest({
    ...loadManifestInputs({ now: afterRollover }),
    now: afterRollover,
    generatedAt: '2026-07-21T19:00:00.000Z',
  });
  assert.equal(manifest.games.gi.current.selectedCharacter.name, 'Columbina');
  assert.ok(manifest.games.gi.current.characters.every((character) => character.name !== 'Sandrone'));
  assert.deepEqual(manifest.games.gi.upcoming, []);
});

test('current Pengo scrape projects headline characters with short names and known patch labels', async () => {
  const productionNow = Date.parse('2026-08-24T12:00:00.000Z');
  const manifest = buildManifest({
    ...loadManifestInputs({ now: productionNow }),
    now: productionNow,
    generatedAt: '2026-08-24T12:00:00.000Z',
  });
  const upcomingNames = (game) => manifest.games[game].upcoming.map((phase) => phase.characters.map((character) => character.name));
  const remielle = manifest.games.zzz.current.characters.find((character) => character.name === 'Remielle');
  assert.match(remielle.icon.path, /IconRoleCircle67\.webp$/);
  assert.notEqual(remielle.icon.sha256, remielle.variants[0].sha256);
  assert.deepEqual(manifest.games.hsr.current.characters.map((character) => character.name), [
    'Himeko • Nova', 'Cerydra', 'Anaxa', 'Aventurine',
  ]);
  assert.equal(manifest.games.hsr.current.phase, '4.4 Phase 2');
  assert.deepEqual(manifest.games.zzz.current.characters.map((character) => character.name), [
    'Sigrid', 'Remielle', 'Dialyn', 'Yuzuha', 'Harumasa',
  ]);
  const sigrid = manifest.games.zzz.current.characters.find((character) => character.name === 'Sigrid');
  const yuzuha = manifest.games.zzz.current.characters.find((character) => character.name === 'Yuzuha');
  assert.ok(sigrid.variants.every((asset) => asset.sha256 !== sigrid.icon.sha256 && asset.placement.x > 0.5));
  assert.ok(Math.max(sigrid.variants[0].dimensions.width, sigrid.variants[0].dimensions.height) >= 1000);
  assert.ok(yuzuha.variants.every((asset) => asset.sha256 !== yuzuha.icon.sha256));
  assert.deepEqual(upcomingNames('gi'), [['Flins', 'Ineffa'], ['Vesna', 'Vodyanitsa']]);
  assert.equal(manifest.games.gi.upcoming[0].phase, '7.0 Phase 2');
  assert.deepEqual(upcomingNames('hsr'), [
    ['Hyacine', 'Robin • Summeretto'],
    ['Ashveil', 'Aventurine • Waveflair'],
    ['Pearl'],
    ['Nihilux'],
  ]);
  assert.deepEqual(manifest.games.hsr.upcoming.slice(0, 2).map((phase) => phase.phase), [
    '4.5 Phase 1', '4.5 Phase 2',
  ]);
  assert.equal(manifest.games.hsr.upcoming[2].phase, 'Version 4.6');
  assert.equal(manifest.games.hsr.upcoming[3].phase, null);
  assert.deepEqual(upcomingNames('zzz'), [
    ['Claret', 'Roxy'],
    ['Sunbringer', 'Phoenix', 'The Storyteller'],
  ]);
  assert.equal(manifest.games.zzz.upcoming[0].phase, '3.2');
  assert.deepEqual(upcomingNames('wuwa'), [['Jingran', 'Hiyuki', 'Mornye'], ['Suoming', 'Hsin']]);
  assert.equal(manifest.games.wuwa.current.phase, '3.6');
  assert.deepEqual(manifest.games.ae.current.characters.map((character) => character.name), ['Liino', 'Arcane', 'Camille']);
  assert.equal(manifest.games.ae.current.selectedCharacter.name, 'Liino');
  assert.ok(manifest.games.ae.current.selectedCharacter.variants.some((variant) => /liino/i.test(variant.path)));
  assert.equal(manifest.games.ae.upcoming[0].announced, true);
  assert.equal(manifest.games.ae.upcoming[0].start, null);
  assert.equal(manifest.games.ae.upcoming[0].end, null);
  assert.deepEqual(manifest.games.ae.upcoming[0].characters.map((character) => character.name), [
    'Si',
    'Hongshan Imperial Guard',
  ]);
  assert.ok(manifest.games.ae.upcoming[0].characters.every((character) =>
    /^\/Site\/assets\/banners\/ae\/[a-f0-9]{32}\.png$/.test(character.icon.path)
    && character.icon.sourceUrl === undefined));
  assert.match(manifest.games.hsr.upcoming[0].characters.find((character) => character.name === 'Robin • Summeretto').icon.path, /(?:robin-summeretto|1512)/);
  assert.equal(manifest.games.gi.upcoming[1].phase, 'Version 7.1');
  assert.deepEqual(manifest.games.gi.upcoming[1].characters.map((character) => character.name), ['Vesna', 'Vodyanitsa']);
  assert.doesNotMatch(JSON.stringify(manifest.games.zzz), /Sigrid de L'Azur|Remielle Dan|Roxy Ifrita Pryce|Claret Flint/);
  for (const [game, minimum] of Object.entries({ gi: 5, hsr: 5, zzz: 5, wuwa: 5, ae: 6 })) {
    const characters = [
      ...manifest.games[game].current.characters,
      ...manifest.games[game].upcoming.flatMap((phase) => phase.characters),
    ];
    assert.ok(characters.every((character) => character.rarity == null || character.rarity >= minimum));
  }
  for (const game of ['gi', 'hsr', 'zzz', 'wuwa']) {
    assert.ok(manifest.games[game].upcoming.flatMap((phase) => phase.characters).every((character) => /^\/(?:Database|Site\/assets\/banners)\//.test(character.icon?.path ?? '') && character.icon.sourceUrl === undefined));
  }
  const firstRevision = manifest.revision;
  const second = buildManifest({
    ...loadManifestInputs({ now: productionNow }),
    now: productionNow + 1000,
    generatedAt: '2026-08-24T12:00:01.000Z',
  });
  assert.equal(firstRevision, second.revision);

  const outputDir = fs.mkdtempSync(path.join(ROOT, 'Site', 'launcher-art-endfield-test-'));
  try {
    await mirrorLauncherArt(manifest, {
      outputDir,
      fetchRemoteArt: async () => { throw new Error('local Endfield splash art must not use the network'); },
    });
    assert.ok(manifest.games.ae.upcoming[0].characters.every((character) => character.icon.path.startsWith('/launcher-art/')));
    assert.ok(manifest.games.ae.upcoming[0].characters.every((character) => character.icon.url.startsWith('https://pengo.gg/dist/launcher-art/')));
    assert.doesNotMatch(JSON.stringify(manifest), /nyx-data\.js|sourceUrl|verifiedAt|img\.game8\.co/i);
    const validation = validatePackagedManifest(manifest, { now: productionNow });
    assert.ok(validation.assets >= 18);
    assert.ok(validation.uniqueAssets >= 1);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('Endfield announced art accepts only exact Pengo-owned local splash paths', () => {
  const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'Database', 'Banners', 'banners.json'), 'utf8'));
  const ae = source.games.find((game) => game.id === 'endfield');
  assert.ok(ae);
  const announcedNow = Date.parse('2026-08-24T12:00:00.000Z');
  const valid = applySourcedBannerWindows(source, path.join(ROOT, 'Database'), announcedNow);
  assert.equal(valid.games.find((game) => game.id === 'endfield')._displayAnnounced.length, 1);

  const preserved = structuredClone(source);
  preserved.games.find((game) => game.id === 'endfield').teaserFreshness = { source: 'game8', lastSuccessfulFetch: '2026-08-18T00:00:00.000Z' };
  assert.equal(
    applySourcedBannerWindows(preserved, path.join(ROOT, 'Database'), announcedNow).games.find((game) => game.id === 'endfield')._displayAnnounced.length,
    1,
  );

  for (const teaserFreshness of [
    { source: 'game8', lastSuccessfulFetch: '2026-01-01T00:00:00.000Z' },
    null,
  ]) {
    const candidate = structuredClone(source);
    const group = candidate.games.find((game) => game.id === 'endfield');
    if (teaserFreshness) group.teaserFreshness = teaserFreshness;
    else delete group.teaserFreshness;
    assert.deepEqual(
      applySourcedBannerWindows(candidate, path.join(ROOT, 'Database'), announcedNow).games.find((game) => game.id === 'endfield')._displayAnnounced,
      [],
    );
  }

  for (const invalid of [
    '/assets/banners/ae/../secret.png',
    '/assets/banners/gi/fd3eda13a889b82719e4542a2adfeb3b.png',
    '/assets/banners/ae/fd3eda13a889b82719e4542a2adfeb3b.webp',
    'https://img.game8.co/4556216/2c5a1a5333a8fd3ec41795dfa39e175e.png/show',
  ]) {
    const candidate = structuredClone(source);
    candidate.games.find((game) => game.id === 'endfield').upcoming[0].characters[0].image = invalid;
    const normalized = applySourcedBannerWindows(candidate, path.join(ROOT, 'Database'), announcedNow);
    assert.deepEqual(normalized.games.find((game) => game.id === 'endfield')._displayAnnounced, []);
  }
});

test('fresh Pengo roadmaps accept bounded non-PNG art and preserve unknown limited status', async () => {
  const root = fs.mkdtempSync(path.join(ROOT, 'Site', 'banner-roadmap-test-'));
  const db = path.join(root, 'Database');
  const artDir = path.join(ROOT, 'Site', 'assets', 'banners', 'genshin');
  const filename = `${crypto.randomBytes(16).toString('hex')}.gif`;
  const artFile = path.join(artDir, filename);
  try {
    fs.mkdirSync(path.join(db, 'Banners'), { recursive: true });
    fs.mkdirSync(artDir, { recursive: true });
    fs.writeFileSync(artFile, Buffer.from('R0lGODlhBAAEAIAAAExpcf8A/yH5BAUAAAAALAAAAAAEAAQAAAIEjI8ZBQA7', 'base64'));
    const sourceGroup = {
      id: 'genshin',
      freshness: { status: 'fresh', source: 'game8', lastSuccessfulFetch: '2026-08-13T00:00:00.000Z' },
      roadmapFreshness: { source: 'game8', lastSuccessfulFetch: '2026-08-13T00:00:00.000Z' },
      roadmap: [
        { name: 'Vesna', rarity: 5, image: `/assets/banners/genshin/${filename}` },
        { name: 'Vodyanitsa', rarity: 5, image: `/assets/banners/genshin/${filename}` },
      ],
    };
    const normalized = applySourcedBannerWindows({ games: [sourceGroup] }, db, Date.parse('2026-08-13T00:00:00.000Z'));
    assert.deepEqual(normalized.games[0]._displayAnnounced[0].characters.map((character) => character.name), ['Vesna', 'Vodyanitsa']);
    assert.ok(normalized.games[0]._displayAnnounced[0].characters.every((character) => character.image === `Site/assets/banners/genshin/${filename}`));
    const manifest = buildManifest({ banners: normalized, events, rosters: { ...rosters, gi: [{ id: 'vesna', name: 'Vesna', rarity: 5 }] }, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z', db });
    assert.equal(manifest.games.gi.upcoming[0].characters[0].rarity, 5);
    assert.equal(manifest.games.gi.upcoming[0].characters[0].limited, null);
    assert.equal(manifest.games.gi.upcoming[0].characters[0].icon.mime, 'image/gif');
    await mirrorLauncherArt(manifest, { outputDir: path.join(root, 'launcher-art'), sourceRoot: ROOT });
    assert.match(manifest.games.gi.upcoming[0].characters[0].icon.path, /^\/launcher-art\/[a-f0-9]{64}\.webp$/);
    assert.equal(manifest.games.gi.upcoming[0].characters[0].icon.mime, 'image/webp');
    assert.doesNotMatch(JSON.stringify(manifest), /img\.game8\.co|sourceUrl/i);

    for (const roadmapFreshness of [
      { source: 'game8', lastSuccessfulFetch: '2026-08-01T00:00:00.000Z' },
      null,
    ]) {
      const candidate = structuredClone(sourceGroup);
      if (roadmapFreshness) candidate.roadmapFreshness = roadmapFreshness;
      else delete candidate.roadmapFreshness;
      assert.deepEqual(
        applySourcedBannerWindows({ games: [candidate] }, db, Date.parse('2026-08-13T00:00:00.000Z')).games[0]._displayAnnounced,
        [],
      );
    }

    normalized.games[0]._displayAnnounced[0].characters[0].image = 'Site/assets/banners/hsr/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png';
    const invalid = applySourcedBannerWindows({ games: [{
      id: 'genshin',
      freshness: { status: 'fresh', source: 'game8', lastSuccessfulFetch: '2026-08-13T00:00:00.000Z' },
      roadmapFreshness: { source: 'game8', lastSuccessfulFetch: '2026-08-13T00:00:00.000Z' },
      roadmap: [{ name: 'Vesna', image: '/assets/banners/hsr/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png' }],
    }] }, db, Date.parse('2026-08-13T00:00:00.000Z'));
    assert.deepEqual(invalid.games[0]._displayAnnounced, []);
  } finally {
    fs.rmSync(artFile, { force: true });
    if (fs.existsSync(artDir) && fs.readdirSync(artDir).length === 0) fs.rmdirSync(artDir);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Pengo roadmap projection prefers the current beta pair', () => {
  const root = fs.mkdtempSync(path.join(ROOT, 'Site', 'banner-roadmap-beta-test-'));
  const db = path.join(root, 'Database');
  const artDir = path.join(ROOT, 'Site', 'assets', 'banners', 'genshin');
  const filename = `${crypto.randomBytes(16).toString('hex')}.png`;
  const artFile = path.join(artDir, filename);
  try {
    fs.mkdirSync(path.join(db, 'Banners'), { recursive: true });
    fs.mkdirSync(path.join(db, 'GameData', 'gi', 'beta'), { recursive: true });
    fs.mkdirSync(artDir, { recursive: true });
    fs.writeFileSync(artFile, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    fs.writeFileSync(path.join(db, 'GameData', 'gi', 'beta', 'characters.json'), JSON.stringify([
      { name: 'Vesna', contentStatus: 'beta' }, { name: 'Vodyanitsa', contentStatus: 'beta' },
    ]));
    const image = `/assets/banners/genshin/${filename}`;
    const normalized = applySourcedBannerWindows({ games: [{
      id: 'genshin', freshness: { status: 'fresh', source: 'game8', lastSuccessfulFetch: '2026-08-13T00:00:00.000Z' },
      roadmapFreshness: { source: 'game8', lastSuccessfulFetch: '2026-08-13T00:00:00.000Z' },
      roadmap: ['Mitya', 'Vesna', 'Vodyanitsa'].map((name) => ({ name, image })),
    }] }, db, Date.parse('2026-08-13T00:00:00.000Z'));
    assert.deepEqual(normalized.games[0]._displayAnnounced[0].characters.map((character) => character.name), ['Vesna', 'Vodyanitsa']);
  } finally {
    fs.rmSync(artFile, { force: true });
    if (fs.existsSync(artDir) && fs.readdirSync(artDir).length === 0) fs.rmdirSync(artDir);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('WuWa banner icon sources stay tied to exact character identity', () => {
  const productionNow = Date.parse('2026-07-17T12:00:00.000Z');
  const manifest = buildManifest({
    ...loadManifestInputs({ now: productionNow }),
    now: productionNow,
    generatedAt: '2026-07-17T12:00:00.000Z',
  });
  const current = Object.fromEntries(manifest.games.wuwa.current.characters.map((character) => [character.name, character]));

  assert.equal(current['Yangyang: Xuanling'].id, '1610');
  assert.match(current['Yangyang: Xuanling'].icon.path, /T_IconRoleHead256_70_UI\.webp$/);
  assert.equal(current['Yangyang: Xuanling'].icon.sourceUrl, undefined);
  const upcoming = Object.fromEntries(manifest.games.wuwa.upcoming[0].characters.map((character) => [character.name, character]));
  assert.match(upcoming.Suisui.icon.path, /T_IconRoleHead256_71_UI\.webp$/);
  assert.match(upcoming.Aemeath.icon.path, /T_IconRoleHead256_53_UI\.webp$/);
});

test('WuWa icon identity beats a Yangyang name-prefix collision', () => {
  const banners = {
    games: [{
      id: 'wuwa',
      current: phase('2026-07-16T00:00:00.000Z', '2026-07-18T00:00:00.000Z', [{
        name: 'Yangyang Variant',
        image: 'https://static.nanoka.cc/assets/ww/UIResources/Common/Image/IconRoleHead256/T_IconRoleHead256_70_UI.webp',
      }]),
    }],
  };
  const customRosters = {
    ...rosters,
    wuwa: [
      { id: '1402', name: 'Yangyang', assets: { icon: 'GameData/ww/assets/characters/icons/UIResources/Common/Image/IconRoleHead256/T_IconRoleHead256_1_UI.webp' } },
      { id: '1610', name: 'Yangyang: Xuanling', assets: { icon: 'GameData/ww/assets/characters/icons/UIResources/Common/Image/IconRoleHead256/T_IconRoleHead256_70_UI.webp' } },
    ],
  };
  const manifest = buildManifest({ banners, events, rosters: customRosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z' });
  assert.equal(manifest.games.wuwa.current.selectedCharacter.id, '1610');
  assert.equal(manifest.games.wuwa.current.selectedCharacter.icon.path.endsWith('T_IconRoleHead256_70_UI.webp'), true);
  assert.equal(manifest.games.wuwa.current.selectedCharacter.icon.sourceUrl, undefined);
});
