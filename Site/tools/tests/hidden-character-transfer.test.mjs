import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const RECEIVER = await readFile(new URL('../../public/scripts/hidden-character-transfer.js', import.meta.url), 'utf8');
const STATE_KEY = 'nyx:cm-hidden:v1';
const RESULT_KEY = 'nyx:hidden-transfer-result:v1';
const GAMES = ['gi', 'hsr', 'zzz', 'ww', 'endfield'];

function emptyScope() {
  return Object.fromEntries(GAMES.map((game) => [game, []]));
}

function createStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const sets = [];
  return {
    data,
    sets,
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { sets.push({ key, value }); data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
}

function createDocument() {
  const scriptAppends = [];
  let onScriptAppend = () => {};
  const makeElement = (tagName) => ({
    tagName,
    children: [],
    dataset: {},
    style: {},
    appendChild(child) {
      this.children.push(child);
      child.parent = this;
      if (child.tagName === 'script') {
        scriptAppends.push(child);
        onScriptAppend(child);
      }
      return child;
    },
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    },
    setAttribute() {},
    addEventListener() {},
    focus() {},
  });
  const body = makeElement('body');
  const head = makeElement('head');
  return {
    body,
    head,
    documentElement: makeElement('html'),
    scriptAppends,
    createElement: makeElement,
    setScriptHandler(handler) { onScriptAppend = handler; },
  };
}

const configs = {
  gi: { roster: [{ id: 'gi-traveler', n: 'Traveler', aliases: ['Aether', 'Lumine'] }] },
  hsr: { roster: [
    { id: 'hsr-himeko-nova', n: 'Himeko Nova', profile: { fullName: 'Himeko • Nova' } },
    { id: 'hsr-march-7th', n: 'March 7th', localizedNames: { en: 'March 7th' } },
    { id: 'hsr-march-7th-swordmaster', n: 'March 7th • The Hunt', localizedNames: { en: 'March 7th' } },
  ] },
  zzz: { roster: [
    { id: 'zzz-anby-demara-soldier-0', n: 'Anby: Soldier 0', localizedNames: { en: 'Soldier 0 - Anby' } },
    { id: 'zzz-billy-starlight', n: 'Billy - Starlight', fullName: 'Starlight - Billy' },
  ] },
  wuwa: { roster: [{
    id: 'wuwa-rover',
    n: 'Rover',
    forms: ['Aero', 'Havoc', 'Spectro'].map((el) => ({ n: 'Rover', el })),
  }] },
  ae: { roster: [{
    id: 'ae-endministrator',
    rawName: 'Endministrator',
    forms: [{ n: 'Endministrator', gender: 'male' }, { n: 'Endministrator', gender: 'female' }],
  }] },
};

async function runReceiver(payload, existingState, cmCfg = configs, dynamicConfigs = {}) {
  const localStorage = createStorage(existingState === undefined ? {} : { [STATE_KEY]: JSON.stringify(existingState) });
  const sessionStorage = createStorage();
  const document = createDocument();
  const replacements = [];
  const historyUrls = [];
  const location = {
    hash: `#pengo-hidden-transfer=${encodeURIComponent(JSON.stringify(payload))}`,
    pathname: '/genshin/materials',
    search: '',
    replace(url) { replacements.push(url); },
  };
  const window = {
    CM_CFG: { ...cmCfg },
    document,
    history: { replaceState(_state, _title, url) { historyUrls.push(url); } },
    localStorage,
    location,
    sessionStorage,
  };
  document.setScriptHandler((script) => queueMicrotask(() => {
    const key = script.dataset.pengoHiddenTransfer;
    if (dynamicConfigs[key]) {
      window.CM_CFG[key] = dynamicConfigs[key];
      script.onload();
    } else {
      script.onerror();
    }
  }));
  vm.runInNewContext(RECEIVER, { console, document, setTimeout, window }, { filename: 'hidden-character-transfer.js' });
  await new Promise((resolve) => setImmediate(resolve));
  return { document, historyUrls, localStorage, replacements, sessionStorage };
}

test('maps legacy names, preserves both merge modes, and rejects malformed payloads', async () => {
  const hidden = emptyScope();
  hidden.gi = ['Manekina'];
  hidden.hsr = ['Himeko • Nova', 'March 7th'];
  hidden.zzz = ['Soldier 0 - Anby'];
  hidden.ww = ['Rover: Aero'];
  hidden.endfield = ['Endministrator (M)'];
  const tracker = emptyScope();
  tracker.zzz = ['Starlight - Billy'];
  tracker.ww = ['Rover: Havoc', 'Rover: Spectro'];
  tracker.endfield = ['Endministrator (F)'];

  const existing = {
    sync: false,
    all: { gi: ['keep-all'] },
    roster: { gi: ['keep-roster'], zzz: ['keep-zzz'] },
    materials: { hsr: ['keep-material'] },
    futureField: { keep: true },
  };
  const splitRun = await runReceiver({ v: 1, hidden, tracker }, existing);
  assert.equal(splitRun.localStorage.sets.length, 1, 'receiver makes one atomic localStorage write');
  const splitSaved = JSON.parse(splitRun.localStorage.data.get(STATE_KEY));
  assert.deepEqual(splitSaved.all, { gi: ['keep-all'] });
  assert.deepEqual(splitSaved.roster, {
    gi: ['keep-roster', 'gi-traveler'],
    zzz: ['keep-zzz', 'zzz-anby-demara-soldier-0'],
    hsr: ['hsr-himeko-nova', 'hsr-march-7th', 'hsr-march-7th-swordmaster'],
    wuwa: ['wuwa-rover'],
    ae: ['ae-endministrator'],
  });
  assert.deepEqual(splitSaved.materials, {
    hsr: ['keep-material'],
    zzz: ['zzz-billy-starlight'],
    wuwa: ['wuwa-rover'],
    ae: ['ae-endministrator'],
  });
  assert.deepEqual(splitSaved.futureField, { keep: true });
  assert.deepEqual(JSON.parse(splitRun.sessionStorage.data.get(RESULT_KEY)), { count: 10, unmatched: 0 });
  assert.deepEqual(splitRun.replacements, ['/genshin/materials']);

  const syncedHidden = emptyScope();
  syncedHidden.gi = ['Manekina'];
  const syncedTracker = emptyScope();
  syncedTracker.gi = ['Traveler'];
  const syncRun = await runReceiver(
    { v: 1, hidden: syncedHidden, tracker: syncedTracker },
    { sync: true, all: { gi: ['keep-synced'] }, roster: { gi: ['keep-roster'] }, materials: {}, future: 7 },
  );
  const syncSaved = JSON.parse(syncRun.localStorage.data.get(STATE_KEY));
  assert.deepEqual(syncSaved.all.gi, ['keep-synced', 'gi-traveler']);
  assert.deepEqual(syncSaved.roster.gi, ['keep-roster']);
  assert.equal(syncSaved.future, 7);

  const dynamicHidden = emptyScope();
  dynamicHidden.zzz = ['Soldier 0 - Anby'];
  const dynamicRun = await runReceiver(
    { v: 1, hidden: dynamicHidden, tracker: emptyScope() },
    undefined,
    { gi: configs.gi },
    { zzz: configs.zzz },
  );
  assert.deepEqual(dynamicRun.document.scriptAppends.map((script) => script.src), ['/dist/cm-data-zzz.js']);
  assert.deepEqual(JSON.parse(dynamicRun.localStorage.data.get(STATE_KEY)).roster.zzz, ['zzz-anby-demara-soldier-0']);

  const unknownHidden = emptyScope();
  unknownHidden.gi = ['Definitely Not A Character'];
  const noMatch = await runReceiver({ v: 1, hidden: unknownHidden, tracker: emptyScope() }, existing);
  assert.equal(noMatch.localStorage.sets.length, 0, 'a valid payload with no matches makes no write');
  assert.deepEqual(noMatch.replacements, []);

  const validEmpty = { v: 1, hidden: emptyScope(), tracker: emptyScope() };
  const malformedPayloads = [
    { ...validEmpty, v: 2 },
    { ...validEmpty, hidden: { ...validEmpty.hidden, gi: [' Traveler'] } },
    { ...validEmpty, tracker: { ...validEmpty.tracker, other: [] } },
  ];
  for (const malformed of malformedPayloads) {
    const rejected = await runReceiver(malformed, existing, {});
    assert.equal(rejected.localStorage.sets.length, 0);
    assert.equal(rejected.document.scriptAppends.length, 0, 'invalid input loads no roster scripts');
    assert.deepEqual(rejected.replacements, []);
    assert.equal(rejected.sessionStorage.data.has(RESULT_KEY), false);
  }
});
