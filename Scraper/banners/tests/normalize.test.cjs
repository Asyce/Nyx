'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  reflowBannerGroup,
  mergeSameWindow,
  bannerFreshnessStatus,
  requiredBannerFreshnessFailures,
} = require('../normalize.cjs');

// Fixed "now" so the fixtures are deterministic: 2026-06-24T02:00:00Z.
const NOW = Date.parse('2026-06-24T02:00:00.000Z');
const ch = (name) => ({ name });

test('expired phase stuck in `current` is not presented as live (WuWa)', () => {
  const group = {
    name: 'Wuthering Waves',
    freshness: { status: 'fresh', lastSuccessfulFetch: '2026-06-24T01:00:00.000Z' },
    current: { phase: null, characters: [ch('Lucy'), ch('Rebecca')], end: '2026-06-08T10:00:00.000Z' },
    next: { phase: null, characters: [], start: '2026-06-18T10:00:00.000Z', end: '2026-07-09T10:00:00.000Z' },
    upcoming: [],
  };
  const out = reflowBannerGroup(group, NOW);
  assert.equal(out.current, null, 'expired banner must not be current');
  assert.equal(out.freshness.status, 'unavailable', 'no usable current/future → unavailable');
});

test('duplicate identical windows are merged into one phase (ZZZ Norma + Sunna)', () => {
  const group = {
    name: 'Zenless Zone Zero',
    freshness: { status: 'fresh', lastSuccessfulFetch: '2026-06-24T01:00:00.000Z' },
    current: { phase: null, characters: [ch('Velina'), ch('Ye Shunguang')], end: '2026-07-08T10:00:00.000Z' },
    next: { phase: null, characters: [ch('Norma')], start: '2026-07-08T10:00:00.000Z', end: '2026-07-28T10:00:00.000Z' },
    upcoming: [{ characters: [ch('Sunna')], start: '2026-07-08T10:00:00.000Z', end: '2026-07-28T10:00:00.000Z' }],
  };
  const out = reflowBannerGroup(group, NOW);
  assert.ok(out.current, 'has an active current');
  assert.equal(out.upcoming.length, 0, 'no leftover duplicate window');
  assert.deepEqual(
    out.next.characters.map((c) => c.name).sort(),
    ['Norma', 'Sunna'],
    'identical Jul 8–28 windows merged into one phase'
  );
  assert.equal(out.freshness.status, 'fresh');
});

test('current phase with zero characters → unavailable (Endfield)', () => {
  const group = {
    name: 'Arknights: Endfield',
    freshness: { status: 'fresh', lastSuccessfulFetch: '2026-06-24T01:00:00.000Z' },
    current: { phase: '1.3 Phase 1', characters: [], end: '2026-06-26T02:00:00.000Z' },
    next: { phase: null, characters: [], start: null, end: null },
    upcoming: [],
  };
  const out = reflowBannerGroup(group, NOW);
  assert.equal(out.current, null);
  assert.equal(out.freshness.status, 'unavailable');
});

test('healthy multi-phase data stays fresh and ordered (Genshin)', () => {
  const group = {
    name: 'Genshin Impact',
    freshness: { status: 'fresh', lastSuccessfulFetch: '2026-06-24T01:00:00.000Z' },
    current: { phase: '6.6 Phase 2', characters: [ch('Lohen'), ch('Mavuika')], end: '2026-06-30T10:00:00.000Z' },
    next: { phase: '6.7 Phase 1', characters: [ch('Sandrone'), ch('Citlali')], start: '2026-07-01T10:00:00.000Z', end: '2026-07-21T10:00:00.000Z' },
    upcoming: [{ characters: [ch('Columbina')], start: '2026-07-21T10:00:00.000Z', end: '2026-08-11T10:00:00.000Z' }],
  };
  const out = reflowBannerGroup(group, NOW);
  assert.equal(out.current.characters[0].name, 'Lohen');
  assert.equal(out.next.characters[0].name, 'Sandrone');
  assert.equal(out.upcoming.length, 1);
  assert.equal(out.upcoming[0].characters[0].name, 'Columbina');
  assert.equal(out.freshness.status, 'fresh');
});

test('valid timeline but old fetch downgrades to stale', () => {
  const group = {
    name: 'Honkai: Star Rail',
    freshness: { status: 'fresh', lastSuccessfulFetch: '2026-06-21T00:00:00.000Z' }, // >36h before NOW
    current: { phase: '4.3', characters: [ch('Gilgamesh')], end: '2026-06-30T16:00:00.000Z' },
    next: null,
    upcoming: [],
  };
  const out = reflowBannerGroup(group, NOW);
  assert.equal(out.freshness.status, 'stale');
});

test('preserved data from a transient source failure stays fresh until the age gate', () => {
  const group = {
    name: 'Honkai: Star Rail',
    freshness: {
      status: 'fresh',
      checkedAt: '2026-06-24T02:00:00.000Z',
      lastSuccessfulFetch: '2026-06-24T01:00:00.000Z',
      message: 'This game failed to scrape during the latest banner check; preserved previous data.',
    },
    current: { phase: '4.3', characters: [ch('Gilgamesh')], end: '2026-06-30T16:00:00.000Z' },
    next: null,
    upcoming: [],
  };
  const out = reflowBannerGroup(group, NOW);
  assert.equal(out.freshness.status, 'fresh');
  assert.equal(out.freshness.message, group.freshness.message);
});

test('short no-current handoff before next phase is marked as transition', () => {
  const now = Date.parse('2026-06-30T02:00:00.000Z');
  const group = {
    name: 'Genshin Impact',
    freshness: { status: 'fresh', lastSuccessfulFetch: '2026-06-30T01:00:00.000Z' },
    current: { phase: '6.6 Phase 2', characters: [ch('Lohen')], end: '2026-06-30T00:00:00.000Z' },
    next: { phase: '6.7 Phase 1', characters: [ch('Sandrone')], start: '2026-07-01T10:00:00.000Z', end: '2026-07-21T10:00:00.000Z' },
    upcoming: [],
  };
  const out = reflowBannerGroup(group, now);
  assert.equal(out.current, null);
  assert.equal(out.next.characters[0].name, 'Sandrone');
  assert.equal(out.freshness.status, 'transition');
});

test('long no-current future-only timeline remains invalid', () => {
  const now = Date.parse('2026-06-30T02:00:00.000Z');
  const group = {
    name: 'Genshin Impact',
    freshness: { status: 'fresh', lastSuccessfulFetch: '2026-06-30T01:00:00.000Z' },
    current: null,
    next: { phase: '6.7 Phase 1', characters: [ch('Sandrone')], start: '2026-07-05T10:00:00.000Z', end: '2026-07-21T10:00:00.000Z' },
    upcoming: [],
  };
  const out = reflowBannerGroup(group, now);
  assert.equal(out.freshness.status, 'invalid');
});

test('lastValidUpdate is preserved when current is unavailable', () => {
  const group = {
    name: 'Wuthering Waves',
    freshness: { status: 'fresh', lastSuccessfulFetch: '2026-06-24T01:00:00.000Z', lastValidUpdate: '2026-06-07T10:00:00.000Z' },
    current: { characters: [ch('Lucy')], end: '2026-06-08T10:00:00.000Z' },
    next: null,
    upcoming: [],
  };
  const out = reflowBannerGroup(group, NOW);
  assert.equal(out.freshness.status, 'unavailable');
  assert.equal(out.freshness.lastValidUpdate, '2026-06-07T10:00:00.000Z');
});

test('mergeSameWindow unions characters and keeps first non-null label', () => {
  const merged = mergeSameWindow([
    { phase: null, characters: [ch('A')], start: 's', end: 'e' },
    { phase: '2.0', characters: [ch('B'), ch('A')], start: 's', end: 'e' },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].phase, '2.0');
  assert.deepEqual(merged[0].characters.map((c) => c.name), ['A', 'B']);
});

test('bannerFreshnessStatus is a convenience wrapper over reflow', () => {
  const group = {
    freshness: { status: 'fresh', lastSuccessfulFetch: '2026-06-24T01:00:00.000Z' },
    current: { characters: [ch('Lucy')], end: '2026-06-08T10:00:00.000Z' },
    next: null,
    upcoming: [],
  };
  assert.equal(bannerFreshnessStatus(group, NOW), 'unavailable');
});

test('required banner freshness reports stale required games but allows optional Endfield gaps', () => {
  const stale = {
    id: 'zzz',
    freshness: { lastSuccessfulFetch: '2026-06-21T00:00:00.000Z' },
    current: { characters: [ch('Anby')], end: '2026-07-01T00:00:00.000Z' },
  };
  const optional = { id: 'endfield', freshness: {}, current: null, next: null };
  assert.deepEqual(requiredBannerFreshnessFailures([stale, optional], NOW), [
    { id: 'zzz', status: 'stale' },
  ]);
});
