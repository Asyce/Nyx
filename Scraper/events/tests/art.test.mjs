import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeEventImage, validateEvent } from '../core.mjs';
import { hoyoArtByRecordId, hoyoPicWindow, wuwaArticleArt } from '../sources.mjs';
import { artFileName, artRequestUrl, isAllowedArtUrl, localizeEventArt, mergeProvenance, pruneEventArt, readImageSize, sniffImageType } from '../art.mjs';

// 600x200 JPEG header: SOI, then an SOF0 frame carrying the dimensions.
const wideJpeg = (width, height) => Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]),
  (() => { const b = Buffer.alloc(4); b.writeUInt16BE(height, 0); b.writeUInt16BE(width, 2); return b; })(),
  Buffer.alloc(24, 3),
]);

// Smallest valid PNG bytes (1x1) — enough for the magic-number sniff.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20, 7)]);
// A card-sized promo image: passes the sniff, the size floor and the byte cap.
const HERO = wideJpeg(1080, 390);

async function scratch() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nyx-event-art-'));
  return dir;
}

function event(id, recordId, extra = {}) {
  return {
    id, game:'gi', title:'Event ' + id, type:'event', start:'2026-08-01T00:00:00.000Z', end:'2026-08-10T00:00:00.000Z',
    server:'europe', timezone:'UTC+01:00', confidence:'high', scheduleStatus:'exact', permanence:'timed', needs_review:false,
    image:null, description:null,
    source:{ name:'Official', url:'https://official.example/' + recordId, kind:'official-announcement-api', recordId:String(recordId), fetchedAt:'2026-08-08T00:00:00.000Z', priority:1 },
    ...extra,
  };
}

test('only https publisher CDN hosts may be downloaded from', () => {
  assert.equal(isAllowedArtUrl('https://sdk.hoyoverse.com/upload/ann/a.png'), true);
  for (const bad of ['http://sdk.hoyoverse.com/a.png', 'https://evil.example/a.png', 'https://sdk.hoyoverse.com.evil.example/a.png', 'data:image/png;base64,abc', '', null]) {
    assert.equal(isAllowedArtUrl(bad), false, String(bad));
  }
});

test('image type comes from the bytes, not the declared content type', () => {
  assert.equal(sniffImageType(PNG), 'image/png');
  assert.equal(sniffImageType(JPEG), 'image/jpeg');
  assert.equal(sniffImageType(Buffer.from('<!doctype html><html><body>nope</body>')), null);
  assert.equal(artFileName(PNG, 'image/png').endsWith('.png'), true);
  assert.equal(artFileName(PNG, 'text/html'), null);
});

test('downloaded art produces a local runtime path the site is allowed to render', async () => {
  const rootDir = await scratch();
  const calls = [];
  const result = await localizeEventArt({
    game:'gi',
    events:[event('a', 21001), event('b', 21002)],
    artByRecordId:new Map([['21001', 'https://sdk.hoyoverse.com/upload/ann/a.png']]),
    rootDir,
    fetchImage:async (url) => { calls.push(url); return { buffer:HERO, declared:'image/jpeg', etag:'"x"', lastModified:null }; },
    now:'2026-08-08T00:00:00.000Z',
  });
  assert.equal(calls.length, 1, 'only the event with announcement art is fetched');
  assert.match(result.events[0].image, /^\/assets\/events\/gi\/[a-f0-9]{64}\.jpg$/);
  assert.equal(normalizeEventImage(result.events[0].image), result.events[0].image, 'the site renders this path as-is');
  assert.deepEqual(validateEvent(result.events[0]), []);
  assert.equal(result.events[1].image, null, 'events without announcement art are untouched');
  assert.equal(result.downloaded, 1);
  assert.deepEqual(result.provenance[0].eventIds, ['a']);
  const onDisk = await fs.readFile(path.resolve(rootDir, result.provenance[0].localPath));
  assert.deepEqual(onDisk, HERO);
});

test('shared art is downloaded once and a failure never costs the event', async () => {
  const rootDir = await scratch();
  let calls = 0;
  const shared = 'https://sdk.hoyoverse.com/upload/ann/shared.png';
  const result = await localizeEventArt({
    game:'gi',
    events:[event('a', 1), event('b', 2), event('c', 3), event('d', 4)],
    artByRecordId:new Map([['1', shared], ['2', shared], ['3', 'https://evil.example/a.png'], ['4', 'https://sdk.hoyoverse.com/upload/ann/broken.png']]),
    rootDir,
    fetchImage:async (url) => {
      calls += 1;
      if (url.includes('broken')) throw new Error('HTTP 404 Not Found');
      return { buffer:HERO, declared:'image/jpeg', etag:null, lastModified:null };
    },
  });
  assert.equal(calls, 2, 'the shared URL is fetched once; the disallowed host is never fetched');
  assert.equal(result.events[0].image, result.events[1].image);
  assert.equal(result.events[2].image, null);
  assert.equal(result.events[3].image, null);
  assert.equal(result.events.length, 4, 'no event is dropped by an art failure');
  assert.equal(result.problems.length, 2);
  assert.deepEqual(result.provenance[0].eventIds, ['a', 'b']);
});

test('bytes that lie about their type, or are oversized, are rejected', async () => {
  const rootDir = await scratch();
  const result = await localizeEventArt({
    game:'gi',
    events:[event('a', 1), event('b', 2)],
    artByRecordId:new Map([['1', 'https://sdk.hoyoverse.com/a.png'], ['2', 'https://sdk.hoyoverse.com/b.png']]),
    rootDir,
    fetchImage:async (url) => (url.includes('a.png')
      ? { buffer:Buffer.from('<html>not an image</html>'), declared:'image/png' }
      : { buffer:Buffer.concat([HERO, Buffer.alloc(2_000_000)]), declared:'image/jpeg' }),
  });
  assert.equal(result.events[0].image, null);
  assert.equal(result.events[1].image, null);
  assert.equal(result.downloaded, 0);
  assert.match(result.problems[0], /not a recognised image/);
  assert.match(result.problems[1], /too large/);
});

test('announcement art is keyed by ann_id and skips entries without a banner', () => {
  const map = hoyoArtByRecordId({ data:{ list:[{ list:[
    { ann_id:21368, banner:'https://sdk.hoyoverse.com/a.png' },
    { ann_id:21369, banner:'' },
    { ann_id:21370 },
  ] }] } });
  assert.deepEqual([...map.entries()], [['21368', 'https://sdk.hoyoverse.com/a.png']]);
  assert.deepEqual([...hoyoArtByRecordId(null).entries()], []);
});

test('every publisher CDN that actually serves event art is allowed', () => {
  for (const good of [
    'https://sdk.hoyoverse.com/upload/ann/a.jpg',                                  // Genshin / HSR / ZZZ
    'https://hw-media-cdn-mingchao.kurogame.com/object/1768/mkzd1ckc05q.jpg',      // Wuthering Waves
    'https://web-static.hg-cdn.com/upload/image/20260715/354e288f18.jpg',          // Endfield
  ]) assert.equal(isAllowedArtUrl(good), true, good);
});

test('WuWa art is the first image in the article body, since Kuro publishes no cover', () => {
  assert.equal(
    wuwaArticleArt({ articleContent:'<div><p>Intro</p><img src="https://hw-media-cdn-mingchao.kurogame.com/object/hero.jpg" /><img src="https://x/second.jpg" /></div>' }),
    'https://hw-media-cdn-mingchao.kurogame.com/object/hero.jpg',
  );
  assert.equal(wuwaArticleArt({ articleContent:'<p>no images here</p>' }), null);
  assert.equal(wuwaArticleArt(null), null);
});

test('image dimensions are read from the header so inline icons never become card art', async () => {
  assert.deepEqual(readImageSize(wideJpeg(1080, 390)), { width:1080, height:390 });
  assert.deepEqual(readImageSize(PNG), { width:1, height:1 });
  assert.equal(readImageSize(Buffer.from('nope')), null);

  const rootDir = await scratch();
  const result = await localizeEventArt({
    game:'wuwa',
    events:[event('hero', 1), event('icon', 2)],
    artByRecordId:new Map([['1', 'https://hw-media-cdn-mingchao.kurogame.com/a.jpg'], ['2', 'https://hw-media-cdn-mingchao.kurogame.com/b.jpg']]),
    rootDir,
    fetchImage:async (url) => ({ buffer:url.includes('a.jpg') ? wideJpeg(1080, 390) : wideJpeg(64, 64), declared:'image/jpeg' }),
  });
  assert.match(result.events[0].image, /^\/assets\/events\/wuwa\/[a-f0-9]{64}\.jpg$/);
  assert.equal(result.provenance[0].width, 1080);
  assert.equal(result.events[1].image, null, 'a 64px icon is not a key visual');
  assert.match(result.problems[0], /too small/);
});

test('OSS-backed CDNs are asked for a card-sized copy; HoYoverse URLs are left alone', () => {
  assert.equal(
    artRequestUrl('https://hw-media-cdn-mingchao.kurogame.com/object/hero.jpg'),
    'https://hw-media-cdn-mingchao.kurogame.com/object/hero.jpg?x-oss-process=image%2Fresize%2Cw_960%2Fquality%2Cq_80',
  );
  assert.match(artRequestUrl('https://web-static.hg-cdn.com/upload/image/a.jpg'), /x-oss-process/);
  // HoYoverse ignores the parameter and already serves a processed variant.
  assert.equal(artRequestUrl('https://sdk.hoyoverse.com/upload/ann/a.jpg'), 'https://sdk.hoyoverse.com/upload/ann/a.jpg');
  assert.equal(artRequestUrl('not a url'), 'not a url');
});

test('art is only stored for events the caller still wants, and the request is the resized URL', async () => {
  const rootDir = await scratch();
  const requested = [];
  const result = await localizeEventArt({
    game:'wuwa',
    events:[event('current', 1), event('ancient', 2)],
    artByRecordId:new Map([['1', 'https://hw-media-cdn-mingchao.kurogame.com/a.jpg'], ['2', 'https://hw-media-cdn-mingchao.kurogame.com/b.jpg']]),
    rootDir,
    shouldFetch:(row) => row.id === 'current',
    fetchImage:async (url) => { requested.push(url); return { buffer:HERO, declared:'image/jpeg' }; },
  });
  assert.equal(requested.length, 1, 'the skipped event is never fetched');
  assert.match(requested[0], /x-oss-process/);
  assert.ok(result.events[0].image);
  assert.equal(result.events[1].image, null);
  assert.equal(result.provenance[0].requestUrl, requested[0]);
});

test('art no dataset points at is deleted, and unrelated files are left alone', async () => {
  const rootDir = await scratch();
  const dir = path.resolve(rootDir, 'Site/assets/events/gi');
  await fs.mkdir(dir, { recursive:true });
  const keptName = 'a'.repeat(64) + '.jpg';
  const goneName = 'b'.repeat(64) + '.jpg';
  await fs.writeFile(path.join(dir, keptName), HERO);
  await fs.writeFile(path.join(dir, goneName), HERO);
  await fs.writeFile(path.join(dir, 'notes.txt'), 'not ours');
  const result = await pruneEventArt({
    game:'gi',
    events:[{ image:'/assets/events/gi/' + keptName }, { image:null }, { image:'/assets/events/hsr/' + goneName }],
    rootDir,
  });
  assert.deepEqual(result, { removed:1, kept:1 });
  assert.deepEqual((await fs.readdir(dir)).sort(), [keptName, 'notes.txt'].sort());
  assert.deepEqual(await pruneEventArt({ game:'zzz', events:[], rootDir }), { removed:0, kept:0 }, 'a game with no art folder is fine');
});

test('a record claiming art whose file is gone is re-fetched, never shipped broken', async () => {
  const rootDir = await scratch();
  const missing = { ...event('ghost', 1), image:'/assets/events/gi/' + 'c'.repeat(64) + '.jpg' };
  const result = await localizeEventArt({
    game:'gi',
    events:[missing],
    artByRecordId:new Map([['1', 'https://sdk.hoyoverse.com/a.jpg']]),
    rootDir,
    fetchImage:async () => ({ buffer:HERO, declared:'image/jpeg' }),
  });
  assert.notEqual(result.events[0].image, missing.image);
  assert.equal(result.downloaded, 1);
  assert.ok(await fs.readFile(path.resolve(rootDir, result.provenance[0].localPath)));

  // Nothing to re-fetch with: the stale path is cleared rather than kept.
  const orphan = await localizeEventArt({ game:'gi', events:[missing], artByRecordId:new Map([['1', 'https://evil.example/a.jpg']]), rootDir, fetchImage:async () => { throw new Error('never'); } });
  assert.equal(orphan.events[0].image, null);
});

test('provenance forgets art that was pruned but keeps everything still referenced', () => {
  const previous = mergeProvenance(null, [
    { game:'gi', sha256:'aa', fileName:'aa.jpg', sourceUrl:'https://sdk.hoyoverse.com/a.jpg', retrievedAt:'2026-07-01T00:00:00.000Z', eventIds:['a'] },
    { game:'gi', sha256:'bb', fileName:'bb.jpg', sourceUrl:'https://sdk.hoyoverse.com/b.jpg', retrievedAt:'2026-07-01T00:00:00.000Z', eventIds:['b'] },
  ], { generatedAt:'2026-07-01T00:00:00.000Z', games:['gi'] });
  const next = mergeProvenance(previous, [], { generatedAt:'2026-08-08T00:00:00.000Z', games:['gi'], referenced:new Set(['gi/aa']) });
  assert.deepEqual(next.art.map((row) => row.sha256), ['aa']);
});

test('provenance keeps the original retrieval date and never claims a license', () => {
  const first = mergeProvenance(null, [{ game:'gi', sha256:'aa', fileName:'aa.png', sourceUrl:'https://sdk.hoyoverse.com/a.png', retrievedAt:'2026-07-01T00:00:00.000Z', eventIds:['a'] }], { generatedAt:'2026-07-01T00:00:00.000Z', games:['gi'] });
  const second = mergeProvenance(first, [{ game:'gi', sha256:'aa', fileName:'aa.png', sourceUrl:'https://sdk.hoyoverse.com/a.png', retrievedAt:'2026-08-08T00:00:00.000Z', eventIds:['b'] }], { generatedAt:'2026-08-08T00:00:00.000Z', games:['gi'] });
  assert.equal(second.art.length, 1);
  assert.equal(second.art[0].retrievedAt, '2026-07-01T00:00:00.000Z');
  assert.deepEqual(second.art[0].eventIds, ['a', 'b']);
  assert.equal(second.runtimeHotlinks, false);
  assert.equal(second.licenseClaim, null);
  assert.match(second.rightsNote, /No license is claimed/);
});

test('picture announcements are read too, and their own window is the event window', () => {
  // Star Rail and Zenless publish most events in `data.pic_list`, nested a
  // level deeper than the text notices; reading `data.list` alone made those
  // games look nearly empty (2026-08-08).
  const listPayload = {
    data:{
      list:[{ type_label:'Notices', list:[{ ann_id:1, title:'Planar Fissure Event' }] }],
      pic_list:[{ type_list:[{ list:[
        { ann_id:2, title:'"Imagenae: Holy Grail War" Event Details', img:'https://sdk.hoyoverse.com/upload/ann/a.jpg',
          start_time:'2026-07-23 11:00:00', end_time:'2026-08-26 06:00:00' },
      ] }] }],
    },
  };
  const art = hoyoArtByRecordId(listPayload);
  assert.equal(art.get('2'), 'https://sdk.hoyoverse.com/upload/ann/a.jpg', 'picture art comes from `img`');

  const pic = { _pic:true, start_time:'2026-07-23 11:00:00', end_time:'2026-08-26 06:00:00' };
  assert.deepEqual(hoyoPicWindow(pic, '+01:00'), { start:'2026-07-23T10:00:00.000Z', end:'2026-08-26T05:00:00.000Z' });
  // A placeholder end a decade out means "no announced end", not a ten-year run.
  assert.equal(hoyoPicWindow({ ...pic, end_time:'2036-07-03 00:00:00' }, '+01:00').end, null);
  assert.equal(hoyoPicWindow({ ...pic, end_time:'2026-07-01 00:00:00' }, '+01:00').end, null, 'an end before the start is dropped');
  // Text notices keep using their body; their list window is only visibility.
  assert.deepEqual(hoyoPicWindow({ start_time:'2026-07-23 11:00:00' }, '+01:00'), { start:null, end:null });
});
