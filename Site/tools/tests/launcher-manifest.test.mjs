import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ROOT, applySourcedBannerWindows, buildManifest, mirrorLauncherArt, officialUrl } from '../generate-launcher-manifest.mjs';

const NOW = Date.parse('2026-07-17T00:00:00.000Z');
const phase = (start, end, characters = [{ name: 'Alpha', rarity: 5 }]) => ({ phase: '1.0', start, end, characters });
const events = Object.fromEntries(['gi', 'hsr', 'zzz', 'wuwa', 'ae'].map((game) => [game, { events: [{ id: `${game}-safe`, title: 'Official update', start: '2026-07-16T00:00:00.000Z', end: '2026-07-20T00:00:00.000Z', source: { url: game === 'wuwa' ? 'https://wutheringwaves.kurogames.com/en/main/news/detail/1' : game === 'ae' ? 'https://endfield.gryphline.com/en-us/news/1' : `https://${game === 'gi' ? 'sg-hk4e-api' : game === 'hsr' ? 'sg-hkrpg-api' : 'sg-announcement-api'}.hoyoverse.com/common/announcement/1` } }, { id: `${game}-unsafe`, title: 'Unsafe', source: { url: 'http://example.invalid/nope' } }] }]));
const rosters = Object.fromEntries(['gi', 'hsr', 'zzz', 'wuwa', 'ae'].map((game) => [game, [{ id: `${game}-alpha`, name: 'Alpha', rarity: 5, limited: true, release: '2026-01-01T00:00:00.000Z', assets: game === 'gi' ? { gacha: 'GameData/gi/assets/characters/gacha/UI_Gacha_AvatarImg_MarionetteNew.webp' } : undefined }]]));

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
    assert.ok(manifest.revision);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('approved Genshin portrait source wins over the default splash fallback', () => {
  const banners = { games: [{ id: 'gi', current: phase('2026-07-16T00:00:00.000Z', '2026-07-18T00:00:00.000Z', [{ name: 'Citlali' }]) }] };
  const customRosters = { ...rosters, gi: [{
    id: 'citlali',
    name: 'Citlali',
    rarity: 5,
    assets: { gacha: 'GameData/gi/assets/characters/gacha/UI_Gacha_AvatarImg_Citlali.webp' },
  }] };
  const manifest = buildManifest({ banners, events, rosters: customRosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z', db: path.join(ROOT, 'Database') });
  const variant = manifest.games.gi.current.selectedCharacter.variants[0];
  assert.equal(variant.source, 'portrait');
  assert.match(variant.path, /Character Portrait_Citlali\.png$/);
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

test('production preprocessing admits only independently identified active history channels', () => {
  const db = fs.mkdtempSync(path.join(ROOT, 'Site', 'banner-history-test-'));
  try {
    fs.mkdirSync(path.join(db, 'BannerHistory'));
    const trustedSource = { url: 'https://genshin-impact.fandom.com/wiki/Wish', kind: 'maintained-wiki', revision: 7 };
    const record = (id, name, start, end, overrides = {}) => ({
      id: `gi:character:Character Event:${id}`, game: 'gi', bannerType: 'character', category: 'Character Event', version: '6.7', permanent: false,
      windowsByRegion: {
        europe: { start, end },
        asia: { start: '2026-07-15T00:00:00Z', end: '2026-07-19T00:00:00Z' },
      },
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
    assert.deepEqual(normalized.games[0].current.characters.map((entry) => entry.name), ['Alpha', 'Beta']);
    assert.equal(normalized.games[0].current.start, '2026-07-16T12:00:00.000Z');
    assert.equal(normalized.games[0].current.end, '2026-07-17T12:00:00.000Z');
    assert.equal(normalized.games[0].current.phase, '6.7');
    assert.equal(normalized.games[0].current._sourceRegion, 'europe');
    assert.equal(normalized.games[0].next, null);
    assert.ok(normalized.games[0].current._sourceChannels.every((entry) => entry.recordId && entry.category));
    const manifest = buildManifest({ banners: normalized, events, rosters, now: NOW, generatedAt: '2026-07-17T00:00:00.000Z', db });
    assert.equal(manifest.games.gi.region, 'europe');
    assert.deepEqual(manifest.games.gi.current.characters.map((entry) => entry.name), ['Alpha', 'Beta']);
  } finally {
    fs.rmSync(db, { recursive: true, force: true });
  }
});

test('wrong-game, unconfirmed, and untrusted history cannot fall back to raw current data', () => {
  const source = { url: 'https://genshin-impact.fandom.com/wiki/Wish', kind: 'maintained-wiki', revision: 7 };
  const base = {
    id: 'gi:character:Character Event:bad', game: 'gi', bannerType: 'character', category: 'Character Event', version: '6.7', permanent: false,
    windowsByRegion: { europe: { start: '2026-07-16T00:00:00Z', end: '2026-07-18T00:00:00Z' } },
    featured: [{ name: 'Bad', rarity: 5, primary: true }], source, confirmed: true,
  };
  const cases = [
    { name: 'wrong dataset game', historyGame: 'hsr', record: base },
    { name: 'wrong record game', historyGame: 'gi', record: { ...base, game: 'hsr' } },
    { name: 'unconfirmed', historyGame: 'gi', record: { ...base, confirmed: false } },
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

test('fresh independent raw current corroborates only an exact unconfirmed primary character', () => {
  const db = fs.mkdtempSync(path.join(ROOT, 'Site', 'banner-history-corroboration-test-'));
  const source = { url: 'https://honkai-star-rail.fandom.com/wiki/Warp', kind: 'maintained-wiki', revision: 9 };
  const record = (id, name) => ({
    id: `hsr:character:Character Event:${id}`, game: 'hsr', bannerType: 'character', category: 'Character Event', version: '4.4', permanent: false,
    windowsByRegion: { asia: { start: '2026-07-16T00:00:00Z', end: '2026-07-20T00:00:00Z' } },
    featured: [{ name, rarity: 5, primary: true }], source, confirmed: false,
  });
  const rawGame = (overrides = {}) => ({
    id: 'hsr',
    freshness: { status: 'fresh', checkedAt: '2026-07-17T00:00:00Z', lastSuccessfulFetch: '2026-07-17T00:00:00Z', source: 'independent-feed' },
    current: { phase: '1.0', characters: [{ name: 'Alpha' }], end: '2026-07-19T00:00:00Z', source: 'independent-feed' },
    ...overrides,
  });
  try {
    fs.mkdirSync(path.join(db, 'BannerHistory'));
    fs.writeFileSync(path.join(db, 'BannerHistory', 'hsr.json'), JSON.stringify({ schemaVersion: 1, game: 'hsr', records: [
      record('exact', 'Alpha'),
      record('different-primary', 'Himeko Nova'),
    ] }));
    const normalized = applySourcedBannerWindows({ games: [rawGame()] }, db, NOW);
    assert.equal(normalized.games[0].current._sourceRegion, 'asia');
    assert.equal(normalized.games[0].current.phase, '4.4');
    assert.deepEqual(normalized.games[0].current.characters.map((entry) => entry.name), ['Alpha']);

    const rejected = [
      rawGame({ freshness: { status: 'stale', checkedAt: '2026-07-17T00:00:00Z', lastSuccessfulFetch: '2026-07-17T00:00:00Z', source: 'independent-feed' } }),
      rawGame({ freshness: { status: 'fresh', checkedAt: '2026-07-15T00:00:00Z', lastSuccessfulFetch: '2026-07-15T00:00:00Z', source: 'independent-feed' } }),
      rawGame({ current: { phase: '1.0', characters: [{ name: 'Alpha' }], end: '2026-07-16T00:00:00Z', source: 'independent-feed' } }),
      rawGame({ current: { phase: '1.0', characters: [{ name: 'Alpha' }], end: '2026-07-19T00:00:00Z', source: 'maintained-wiki' } }),
      rawGame({ current: { phase: '1.0', characters: [{ name: 'Alpha Extra' }], end: '2026-07-19T00:00:00Z', source: 'independent-feed' } }),
    ];
    for (const candidate of rejected) {
      assert.equal(applySourcedBannerWindows({ games: [candidate] }, db, NOW).games[0].current, null);
    }
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
  assert.equal(manifest.games.zzz.current.selectedCharacter.name, 'Rerun');
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
