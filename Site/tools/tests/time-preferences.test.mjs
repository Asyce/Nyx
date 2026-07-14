import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = await fs.readFile(
  path.resolve(import.meta.dirname, '../../src/features/timeline/time-preferences.js'),
  'utf8',
);
const appSource = await fs.readFile(
  path.resolve(import.meta.dirname, '../../src/app/nyx-app.jsx'),
  'utf8',
);
const timelineSource = await fs.readFile(
  path.resolve(import.meta.dirname, '../../src/features/timeline/timeline-view.jsx'),
  'utf8',
);
const buildSource = await fs.readFile(
  path.resolve(import.meta.dirname, '../build-site.mjs'),
  'utf8',
);

const EXPORTS = [
  'nyxTimePreferenceStorageKey', 'nyxLegacyResetRegionKey',
  'nyxNormalizeTimeZone', 'nyxDetectTimePreference', 'nyxNormalizeTimePreference',
  'nyxTimePreferenceDisplayZone', 'nyxFormatTimePreferenceDate',
  'nyxLoadTimePreference', 'nyxSaveTimePreference', 'nyxPatchTimePreference',
  'nyxSubscribeTimePreference',
];

function sandbox(seed = {}, options = {}) {
  const store = new Map(Object.entries(seed));
  const listeners = {};
  const localStorage = {
    getItem: options.getItem || ((key) => store.has(key) ? store.get(key) : null),
    setItem: options.setItem || ((key, value) => store.set(key, String(value))),
    removeItem: options.removeItem || ((key) => store.delete(key)),
  };
  const window = {
    addEventListener(type, cb) { (listeners[type] || (listeners[type] = [])).push(cb); },
    dispatchEvent(event) { (listeners[event.type] || []).slice().forEach((cb) => cb(event)); },
  };
  const context = {
    Intl,
    Date,
    JSON,
    Math,
    Number,
    Object,
    String,
    Array,
    Set,
    localStorage,
    window,
  };
  vm.runInNewContext(
    source + '\n;globalThis.__api={' + EXPORTS.map((name) => `${name}:${name}`).join(',') + '};',
    context,
  );
  return { api:context.__api, store, window };
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const V2 = 'nyx:time-preferences:gi:v2';
const LEGACY = 'nyx:reset-region:gi:v1';

test('key builders retain the old per-game key and introduce a versioned preference key', () => {
  const { api } = sandbox();
  assert.equal(api.nyxTimePreferenceStorageKey('gi'), V2);
  assert.equal(api.nyxTimePreferenceStorageKey(''), 'nyx:time-preferences:nyx:v2');
  assert.equal(api.nyxLegacyResetRegionKey('gi'), LEGACY);
});

test('first-run detection maps well-known IANA families and keeps other zones Custom', () => {
  const { api } = sandbox();
  assert.deepEqual(plain(api.nyxDetectTimePreference('Europe/Paris')), {
    serverRegion:'eu', displayMode:'server', timeZone:'Europe/Paris',
  });
  assert.deepEqual(plain(api.nyxDetectTimePreference('America/New_York')), {
    serverRegion:'na', displayMode:'server', timeZone:'America/New_York',
  });
  assert.deepEqual(plain(api.nyxDetectTimePreference('Asia/Tokyo')), {
    serverRegion:'asia', displayMode:'server', timeZone:'Asia/Tokyo',
  });
  const custom = plain(api.nyxDetectTimePreference('Africa/Johannesburg'));
  assert.equal(custom.displayMode, 'custom');
  assert.equal(custom.timeZone, 'Africa/Johannesburg');
  assert.ok(['eu','na','asia'].includes(custom.serverRegion));
});

test('normalization keeps server and display choices separate and rejects invalid zones', () => {
  const { api } = sandbox();
  assert.deepEqual(plain(api.nyxNormalizeTimePreference({
    serverRegion:'asia', displayMode:'custom', timeZone:'Europe/Paris',
  }, 'UTC')), {
    serverRegion:'asia', displayMode:'custom', timeZone:'Europe/Paris',
  });
  assert.equal(api.nyxNormalizeTimeZone('Not/A_Zone', 'UTC'), 'UTC');
  const fixed = plain(api.nyxNormalizeTimePreference({
    serverRegion:'bad', displayMode:'bad', timeZone:'Not/A_Zone',
  }, 'Europe/London'));
  assert.equal(fixed.serverRegion, 'eu');
  assert.equal(fixed.displayMode, 'server');
  assert.equal(fixed.timeZone, 'Europe/London');
});

test('legacy region wins over browser detection and is preserved for rollback', () => {
  const { api, store } = sandbox({ [LEGACY]:'asia' });
  const pref = plain(api.nyxLoadTimePreference('gi', 'Europe/Paris'));
  assert.deepEqual(pref, { serverRegion:'asia', displayMode:'server', timeZone:'Europe/Paris' });
  assert.equal(store.get(LEGACY), 'asia', 'old preference remains readable by a rolled-back build');
  assert.deepEqual(JSON.parse(store.get(V2)), pref, 'verified v2 copy is written');
});

test('corrupt v2 falls back to valid legacy instead of masking it', () => {
  const { api, store } = sandbox({ [V2]:'{"oops":true}', [LEGACY]:'eu' });
  const pref = plain(api.nyxLoadTimePreference('gi', 'Asia/Tokyo'));
  assert.deepEqual(pref, { serverRegion:'eu', displayMode:'server', timeZone:'Asia/Tokyo' });
  assert.deepEqual(JSON.parse(store.get(V2)), pref);
});

test('save mirrors serverRegion to the legacy key and notifies live subscribers', () => {
  const { api, store } = sandbox();
  const seen = [];
  const unsubscribe = api.nyxSubscribeTimePreference('gi', (pref) => seen.push(plain(pref)));
  api.nyxSaveTimePreference('gi', { serverRegion:'eu', displayMode:'server', timeZone:'Europe/Paris' });
  api.nyxPatchTimePreference('gi', { displayMode:'custom', timeZone:'Asia/Tokyo' });
  unsubscribe();
  api.nyxPatchTimePreference('gi', { serverRegion:'asia' });
  assert.equal(store.get(LEGACY), 'asia');
  assert.deepEqual(seen, [
    { serverRegion:'eu', displayMode:'server', timeZone:'Europe/Paris' },
    { serverRegion:'eu', displayMode:'custom', timeZone:'Asia/Tokyo' },
  ]);
});

test('a legacy-only change persists to v2 across reload without corrupting Custom display timezone', () => {
  const initial = JSON.stringify({
    serverRegion:'eu', displayMode:'custom', timeZone:'Europe/Paris',
  });
  const { api, store, window } = sandbox({ [V2]:initial, [LEGACY]:'eu' });
  const seen = [];
  api.nyxSubscribeTimePreference('gi', (pref) => seen.push(plain(pref)));
  store.set(LEGACY, 'asia');
  window.dispatchEvent({ type:'storage', key:LEGACY, newValue:'asia' });
  assert.deepEqual(seen, [{
    serverRegion:'asia', displayMode:'custom', timeZone:'Europe/Paris',
  }]);
  assert.deepEqual(JSON.parse(store.get(V2)), seen[0], 'legacy change is committed to v2');
  assert.deepEqual(plain(api.nyxLoadTimePreference('gi', 'UTC')), seen[0], 'reload keeps the migrated choice');
});

test('a failed v2 write never destroys or rewrites the old preference', () => {
  const seed = { [LEGACY]:'na' };
  const store = new Map(Object.entries(seed));
  const { api } = sandbox(seed, {
    getItem:(key) => store.has(key) ? store.get(key) : null,
    setItem:(key, value) => { if (key === V2) throw new Error('quota'); store.set(key, String(value)); },
  });
  const pref = plain(api.nyxLoadTimePreference('gi', 'Europe/Paris'));
  assert.equal(pref.serverRegion, 'na');
  assert.equal(store.get(LEGACY), 'na');
  assert.equal(store.has(V2), false);
});

test('custom IANA formatting follows DST while server display uses fixed offsets', () => {
  const { api } = sandbox();
  const winter = Date.UTC(2026, 0, 15, 12, 0, 0);
  const summer = Date.UTC(2026, 6, 15, 12, 0, 0);
  const options = { hour:'2-digit', minute:'2-digit', hourCycle:'h23' };
  const custom = { serverRegion:'eu', displayMode:'custom', timeZone:'Europe/Paris' };
  assert.match(api.nyxFormatTimePreferenceDate(winter, custom, options), /13:00/);
  assert.match(api.nyxFormatTimePreferenceDate(summer, custom, options), /14:00/);
  const server = { serverRegion:'eu', displayMode:'server', timeZone:'Europe/Paris' };
  assert.equal(api.nyxTimePreferenceDisplayZone(server), 'Etc/GMT-1');
  assert.equal(api.nyxTimePreferenceDisplayZone(server, 'gi'), 'Etc/GMT-1');
  assert.equal(api.nyxTimePreferenceDisplayZone(server, 'ae'), 'Etc/GMT+5', 'Endfield Europe shares the official UTC-5 server clock');
  assert.equal(api.nyxTimePreferenceDisplayZone({ ...server, serverRegion:'asia' }, 'ae'), 'Etc/GMT-8');
  assert.match(api.nyxFormatTimePreferenceDate(winter, server, options), /13:00/);
  assert.match(api.nyxFormatTimePreferenceDate(summer, server, options), /13:00/);
});

test('the shared module is bundled before consumers and duplicate selectors are removed', () => {
  const preferenceAt = buildSource.indexOf("'features/timeline/time-preferences.js'");
  const timelineAt = buildSource.indexOf("'features/timeline/timeline-view.jsx'");
  const appAt = buildSource.indexOf("'app/nyx-app.jsx'");
  assert.ok(preferenceAt >= 0 && preferenceAt < timelineAt && preferenceAt < appAt);
  assert.match(appSource, /function TimePreferenceControl\(\{ gameKey \}\)/);
  assert.match(appSource, /tab === 'overview' \|\| \(isNyx && \(tab === 'banners' \|\| tab === 'events'\)\)/);
  assert.doesNotMatch(appSource, /className="gp-reset-regions"/);
  assert.doesNotMatch(timelineSource, /className="ntl-regions"/);
});

test('timezone-only changes rerender and format game timelines, All Banners, and All Events', () => {
  assert.match(timelineSource, /function nyxTlViewDate\(ms, dateOnly, preference, gameKey\)/);
  assert.match(timelineSource, /nyxFormatTimePreferenceDate\(ms, preference, options, gameKey\)/);
  assert.match(timelineSource, /function BannerTimeline[\s\S]*?nyxTlUseTimePreference\(game\)/);
  assert.match(timelineSource, /function CrossGameEventsTimeline[\s\S]*?nyxTlUseTimePreference\('nyx'\)/);
  assert.match(timelineSource, /function CrossGameBannerTimeline[\s\S]*?nyxTlUseTimePreference\('nyx'\)/);

  const { api } = sandbox();
  const at = Date.UTC(2026, 6, 15, 2, 0, 0);
  const rendered = { game:[], allBanners:[], allEvents:[] };
  const render = (target) => (pref) => rendered[target].push(
    api.nyxFormatTimePreferenceDate(at, pref, { month:'short', day:'numeric', year:'numeric' }),
  );
  api.nyxSubscribeTimePreference('gi', render('game'));
  api.nyxSubscribeTimePreference('nyx', render('allBanners'));
  api.nyxSubscribeTimePreference('nyx', render('allEvents'));
  api.nyxSaveTimePreference('gi', { serverRegion:'eu', displayMode:'custom', timeZone:'America/New_York' });
  api.nyxSaveTimePreference('nyx', { serverRegion:'eu', displayMode:'custom', timeZone:'America/New_York' });
  api.nyxPatchTimePreference('gi', { timeZone:'Asia/Tokyo' });
  api.nyxPatchTimePreference('nyx', { timeZone:'Asia/Tokyo' });
  const expected = ['America/New_York','Asia/Tokyo'].map((timeZone) => new Intl.DateTimeFormat(undefined, {
    month:'short', day:'numeric', year:'numeric', timeZone,
  }).format(new Date(at)));
  assert.deepEqual(rendered, {
    game:expected,
    allBanners:expected,
    allEvents:expected,
  });
});

test('Genshin reset rules are not silently shown for other games', () => {
  assert.match(appSource, /if \(gameKey !== 'gi'\) return \[\];/);
  assert.match(appSource, /No sourced automatic reset schedule for this game yet\./);
});
