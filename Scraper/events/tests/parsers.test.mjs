import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyType, dedupe, descriptionSnippet, makeEvent, mergeById, normalizeTitle,
  parseDateRange, parseEndfieldAvailability, parseHoyoDuration, parseScopedDateRange, reconcileById, toIso, validateDataset, validateEvent,
} from '../core.mjs';
import { isEndfieldEventCandidate, isHoyoEventCandidate, isSourceEventRecord, isWuwaEventCandidate, parseEndfieldDetail, parseHoyo, parseWuwaArticle } from '../sources.mjs';

test('toIso applies offsets and rejects garbage', () => {
  assert.equal(toIso('2026/07/08 10:00', '+01:00'), '2026-07-08T09:00:00.000Z');
  assert.equal(toIso('2026-07-08 10:00:00', '+08:00'), '2026-07-08T02:00:00.000Z');
  assert.equal(toIso('not a date'), null);
});

test('description snippets strip HTML, normalize whitespace, and stay bounded', () => {
  const snippet = descriptionSnippet('<p>Hello &amp; <b>travelers</b>.</p>&lt;t class="date"&gt;2026/07/01&lt;/t&gt;\n<div>' + 'reward '.repeat(80) + '</div>');
  assert.ok(snippet.startsWith('Hello & travelers. 2026/07/01 reward'));
  assert.ok(!/[<>]/.test(snippet));
  assert.ok(snippet.length <= 240);
  assert.ok(snippet.endsWith('…'));
  assert.equal(descriptionSnippet('   '), null);
  assert.equal(descriptionSnippet(null), null);
  assert.equal(descriptionSnippet(undefined), null);
});

test('parseHoyoDuration extracts an ordered <t> pair from the Event Duration block', () => {
  const html = '<p>〓Event Duration〓</p><p>Event Duration: &lt;t class="t_lc"&gt;2026/07/08 10:00&lt;/t&gt; - &lt;t class="t_lc"&gt;2026/08/11 03:59&lt;/t&gt;</p><p>〓Eligibility〓 2026/01/01 00:00</p>';
  const r = parseHoyoDuration(html, '+01:00');
  assert.equal(r.permanent, false);
  assert.equal(r.start, '2026-07-08T09:00:00.000Z');
  assert.equal(r.end, '2026-08-11T02:59:00.000Z');
});

test('parseHoyoDuration flags Permanent and never emits a window', () => {
  const r = parseHoyoDuration('<p>〓Event Duration〓</p><p>Permanent</p>', '+01:00');
  assert.deepEqual(r, { start: null, end: null, permanent: true });
});

test('parseHoyoDuration returns nulls for open-start ("After the Version update - date")', () => {
  // Only one boundary date; no ordered pair -> no guess.
  const r = parseHoyoDuration('<p>〓Event Duration〓</p><p>After the Version 3.0 update – 2026/07/27 03:59</p>', '+01:00');
  assert.deepEqual(r, { start: null, end: null, permanent: false });
});

test('parseHoyoDuration ignores dates when there is no duration section', () => {
  const r = parseHoyoDuration('<p>Version notes updated 2026/07/01 00:00 fixed bug 2026/07/02 00:00</p>', '+01:00');
  assert.deepEqual(r, { start: null, end: null, permanent: false });
});

test('parseEndfieldAvailability parses month-name start, tolerates undated end', () => {
  const html = '<p>· Availability: June 26, 2026 at 12:00 (server time) – Before version update and maintenance</p>';
  const r = parseEndfieldAvailability(html, '+08:00');
  assert.equal(r.start, '2026-06-26T04:00:00.000Z');
  assert.equal(r.end, null);
});

test('Endfield availability never steals a later Rewards date as its end', () => {
  const html = '<p>Availability: June 26, 2026 at 12:00 (server time) - Before version update</p><h2>◆ Rewards ◆</h2><p>Claim before January 1, 2034 at 12:00</p>';
  assert.deepEqual(parseEndfieldAvailability(html, '+08:00'), { start:'2026-06-26T04:00:00.000Z', end:null });
});

test('parseDateRange reads a WuWa "start - end (server time)" line', () => {
  const html = '<div>✦Duration✦ 2026-07-11 10:00 - 2026-08-19 11:59 (server time) ✦Rewards✦</div>';
  const r = parseDateRange(html, '+08:00');
  assert.equal(r.start, '2026-07-11T02:00:00.000Z');
  assert.equal(r.end, '2026-08-19T03:59:00.000Z');
});

test('scoped duration parsing ignores unrelated WuWa dates outside the duration section', () => {
  const html = '<p>Published 2034-01-01 10:00</p><p>Rewards: claim by 2035-02-02 10:00</p><p>Duration: 2026-07-11 10:00 - 2026-08-19 11:59</p><p>Schedule: 2036-03-03 10:00</p>';
  assert.deepEqual(parseScopedDateRange(html, '+08:00'), {
    start:'2026-07-11T02:00:00.000Z', end:'2026-08-19T03:59:00.000Z',
  });
  assert.deepEqual(parseScopedDateRange('<p>Published 2034-01-01 10:00; rewards 2035-02-02 10:00</p>', '+08:00'), { start:null, end:null });
  assert.deepEqual(parseScopedDateRange('<p>◆ Duration ◆ 2026-07-11 10:00 until update ◆ Rewards ◆ claim 2035-02-02 10:00</p>', '+08:00'), { start:'2026-07-11T02:00:00.000Z', end:null });
});

test('classifyType maps titles deterministically', () => {
  assert.equal(classifyType('Event Wish "Starry Night\'s Whispers"'), 'banner');
  assert.equal(classifyType('[Reverb Resonator Convene]'), 'banner');
  assert.equal(classifyType('[Expunger of Sin] Chartered Headhunting'), 'banner');
  assert.equal(classifyType('HoYoLAB Community "Daily Check-In" Feature'), 'login');
  assert.equal(classifyType('Stygian Onslaught Event'), 'challenge');
  assert.equal(classifyType('Some Web Event Details'), 'web_event');
  assert.equal(classifyType('Random Summer Festival'), 'event');
  assert.equal(classifyType('Boring Feature', { permanent: true }), 'permanent');
});

test('source candidate filters reject ordinary news while retaining explicit events', () => {
  assert.equal(isWuwaEventCandidate({ articleTitle:'Version 3.5 Update Maintenance Notice' }), false);
  assert.equal(isWuwaEventCandidate({ articleTitle:'Event Preview | Lament Recon Combat Event' }), true);
  assert.equal(isEndfieldEventCandidate({ title:'Notice Regarding Game Issues Caused by NVIDIA Driver Updates' }), false);
  assert.equal(isEndfieldEventCandidate({ title:'[Scarlet Pearl Issue] LTO Details' }), true);
  assert.equal(isSourceEventRecord('wuwa', { title:'Moonlit Journey' }), true, 'neutral genuine history is retained');
  assert.equal(isSourceEventRecord('wuwa', { title:'Version 3.4 Update Maintenance Notice' }), false);
  assert.equal(isSourceEventRecord('hsr', { title:'Honkai: Star Rail Fair Gaming Declaration' }), false);
});

test('makeEvent: full window is high-confidence timed, no start is needs_review', () => {
  const dated = makeEvent({ game: 'gi', sourceKey: 'hoyo-ann', nativeId: 1, title: 'Foo Event', start: '2026-07-01T00:00:00.000Z', end: '2026-07-10T00:00:00.000Z', sourceName: 'X', sourceUrl: 'https://x', description:'<p>Official event details</p>', dateSource: 'content' });
  assert.equal(dated.confidence, 'high');
  assert.equal(dated.permanence, 'timed');
  assert.equal(dated.needs_review, false);
  assert.equal(dated.description, 'Official event details');
  assert.deepEqual(validateEvent(dated), []);

  const undated = makeEvent({ game: 'wuwa', sourceKey: 'kuro-article', nativeId: 2, title: 'Mystery Event', start: null, end: null, sourceName: 'X', sourceUrl: 'https://x' });
  assert.equal(undated.needs_review, true);
  assert.equal(undated.permanence, 'unknown');
  assert.equal(undated.description, null);
  assert.deepEqual(validateEvent(undated), []);
});

test('makeEvent: reversed range is repaired to open-ended, not invalid', () => {
  const ev = makeEvent({ game: 'zzz', sourceKey: 'hoyo-ann', nativeId: 3, title: 'Weird', start: '2026-07-27T02:59:00.000Z', end: '2026-06-23T20:00:00.000Z', sourceName: 'X', sourceUrl: 'https://x' });
  assert.equal(ev.end, null);
  assert.equal(ev.needs_review, false); // start is still a real anchor
  assert.deepEqual(validateEvent(ev), []);
});

test('parseHoyo filters notices and never uses list visibility windows as event dates', () => {
  const list = { retcode: 0, data: { list: [{ type_label: 'Event', list: [
    { ann_id: 100, title: 'Event Wish "Test"', start_time: '2026-07-01 00:00:00', end_time: '2026-07-10 00:00:00', banner: 'https://img/a.png' },
    { ann_id: 101, title: 'Realm Challenge', start_time: '2026-07-02 00:00:00', end_time: '2026-07-05 00:00:00' },
    { ann_id: 102, title: 'Honkai: Star Rail Fair Gaming Declaration', start_time: '2026-01-01 00:00:00', end_time: '2035-01-01 00:00:00' },
    { ann_id: 103, title: 'Survey with Rewards', start_time: '2026-01-01 00:00:00', end_time: '2037-01-01 00:00:00' },
  ] }] } };
  const content = { data: { list: [
    { ann_id: 100, content: '<p>〓Event Duration〓</p><p>&lt;t&gt;2026/07/01 05:00&lt;/t&gt; - &lt;t&gt;2026/07/10 04:00&lt;/t&gt;</p>' },
  ] } };
  const events = parseHoyo('gi', list, content);
  assert.equal(events.length, 2);
  const wish = events.find((e) => e.title.includes('Test'));
  assert.equal(wish.type, 'banner');
  assert.equal(wish.confidence, 'high'); // came from content duration
  assert.equal(wish.start, '2026-07-01T04:00:00.000Z');
  const challenge = events.find((e) => e.title === 'Realm Challenge');
  assert.equal(challenge.confidence, 'low');
  assert.equal(challenge.start, null, 'empty content is needs-review, not the announcement visibility start');
  assert.equal(challenge.needs_review, true);
  assert.ok(!events.some((e) => /Fair Gaming|Survey/.test(e.title)));
  assert.equal(isHoyoEventCandidate({ title:'Social Media Fair Use Notice', type_label:'Event' }, null), false);
});

test('parseWuwaArticle and parseEndfieldDetail produce valid events', () => {
  const wuwa = parseWuwaArticle(
    { articleId: 5129, articleTitle: 'Event Preview | [Lament Recon] Combat Event', suggestCover: 'https://c.png' },
    { articleContent: '<div>✦Duration✦ 2026-07-11 10:00 - 2026-08-19 11:59 (server time)</div>' },
  );
  assert.equal(wuwa.game, 'wuwa');
  assert.equal(wuwa.type, 'challenge');
  assert.equal(wuwa.start, '2026-07-11T02:00:00.000Z');
  assert.deepEqual(validateEvent(wuwa), []);

  const ef = parseEndfieldDetail(
    { cid: '6175', title: '[Expunger of Sin] Chartered Headhunting', cover: 'https://c.png' },
    { data: { data: '<p>Availability: June 26, 2026 at 12:00 (server time) – Before version update</p>' } },
  );
  assert.equal(ef.type, 'banner');
  assert.equal(ef.start, '2026-06-26T04:00:00.000Z');
  assert.equal(ef.end, null);
  assert.deepEqual(validateEvent(ef), []);
});

test('WuWa and Endfield parsers never date events from unrelated body timestamps', () => {
  const wuwa = parseWuwaArticle(
    { articleId: 9, articleTitle:'New Region Preview', suggestCover:null },
    { articleContent:'<p>Published 2033-01-01 10:00</p><p>Reward mail expires 2034-02-02 10:00</p>' },
  );
  assert.equal(wuwa.start, null);
  assert.equal(wuwa.needs_review, true);
  const endfield = parseEndfieldDetail(
    { cid:'9', title:'Contingency Contract Event', cover:null },
    { data:{ data:'<p>Patch notes dated January 5, 2033 at 05:00. Mail expires February 6, 2034 at 06:00.</p>' } },
  );
  assert.equal(endfield.start, null);
  assert.equal(endfield.needs_review, true);
});

test('dedupe keeps the higher-priority / better-dated entry, never authority-inverts', () => {
  const official = makeEvent({ game: 'gi', sourceKey: 'hoyo-ann', nativeId: 1, title: 'Summer Festival', start: '2026-07-01T00:00:00.000Z', end: '2026-07-20T00:00:00.000Z', sourceName: 'Official', sourceUrl: 'https://o', priority: 1, dateSource: 'content' });
  const thirdParty = { ...makeEvent({ game: 'gi', sourceKey: 'game8', nativeId: 9, title: 'Summer Festival!!', start: '2026-07-02T00:00:00.000Z', end: '2026-07-19T00:00:00.000Z', sourceName: 'Third', sourceUrl: 'https://t', priority: 2, dateSource: 'list' }) };
  const out = dedupe([thirdParty, official]);
  assert.equal(out.length, 1);
  assert.equal(out[0].source.priority, 1);
  assert.equal(out[0].source.name, 'Official');
});

test('mergeById retains ended events and lets fresh data win by id', () => {
  const prev = [makeEvent({ game: 'gi', sourceKey: 'hoyo-ann', nativeId: 1, title: 'Old Event', start: '2026-01-01T00:00:00.000Z', end: '2026-01-10T00:00:00.000Z', sourceName: 'X', sourceUrl: 'https://x' })];
  const fresh = [makeEvent({ game: 'gi', sourceKey: 'hoyo-ann', nativeId: 2, title: 'New Event', start: '2026-07-01T00:00:00.000Z', end: '2026-07-10T00:00:00.000Z', sourceName: 'X', sourceUrl: 'https://x' })];
  const merged = mergeById(prev, fresh);
  assert.equal(merged.length, 2); // old one retained for history
  assert.equal(merged[0].title, 'New Event'); // sorted start desc
});

test('successful reconciliation prunes absent bad/future rows but retains genuine ended history', () => {
  const old = makeEvent({ game:'gi', sourceKey:'hoyo-ann', nativeId:1, title:'Ended Event', start:'2026-01-01T00:00:00.000Z', end:'2026-01-10T00:00:00.000Z', sourceName:'X', sourceUrl:'https://x' });
  const falseFuture = makeEvent({ game:'gi', sourceKey:'hoyo-ann', nativeId:2, title:'False Notice', start:'2026-07-01T00:00:00.000Z', end:'2035-01-01T00:00:00.000Z', sourceName:'X', sourceUrl:'https://x' });
  const undated = makeEvent({ game:'gi', sourceKey:'hoyo-ann', nativeId:3, title:'Broken', start:null, end:null, sourceName:'X', sourceUrl:'https://x' });
  const fresh = makeEvent({ game:'gi', sourceKey:'hoyo-ann', nativeId:4, title:'Fresh Event', start:'2026-07-01T00:00:00.000Z', end:'2026-07-20T00:00:00.000Z', sourceName:'X', sourceUrl:'https://x' });
  const reconciled = reconcileById([old, falseFuture, undated], [fresh], Date.parse('2026-07-12T00:00:00.000Z'));
  assert.deepEqual(reconciled.map((e) => e.title).sort(), ['Ended Event', 'Fresh Event']);
  const outage = mergeById([old, falseFuture, undated], []);
  assert.equal(outage.length, 3, 'outage path retains every previous row');
  const badEnded = { ...old, id:'bad-ended', title:'Version Update Maintenance Notice' };
  assert.ok(!reconcileById([old, badEnded], [], Date.parse('2026-07-12T00:00:00.000Z'), (ev) => !/Maintenance/.test(ev.title)).some((ev) => ev.id === 'bad-ended'));
});

test('normalizeTitle collapses punctuation and version noise', () => {
  assert.equal(normalizeTitle('Version 3.5 "Blade of Past" Event'), 'blade of past');
});

test('validateDataset accepts a well-formed envelope and rejects a broken one', () => {
  const good = { schemaVersion: 1, game: 'gi', events: [makeEvent({ game: 'gi', sourceKey: 'hoyo-ann', nativeId: 1, title: 'E', start: '2026-07-01T00:00:00.000Z', end: '2026-07-10T00:00:00.000Z', sourceName: 'X', sourceUrl: 'https://x' })] };
  assert.deepEqual(validateDataset(good), []);
  assert.ok(validateDataset({ schemaVersion: 2, game: 'gi', events: [] }).length > 0);
});
