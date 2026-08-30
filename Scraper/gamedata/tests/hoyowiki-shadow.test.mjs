import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchJson as fetchCommonJson } from '../../lib/common.mjs';
import {
  HOYO_GAMES,
  MAX_PAGES,
  MAX_NAME_BYTES,
  MAX_PAGE_BYTES,
  SHADOW_REQUEST_TIMEOUT_MS,
  buildLocalAliases,
  canonicalRowsHash,
  classifyEntries,
  discoverMenu,
  fetchHoyoCollection,
  normalizeAlias,
  renderMarkdown,
  runShadowComparison,
  validateLocalRows,
  validateMetadata,
} from '../hoyowiki-shadow.mjs';

const VALID_ASSET = 'https://upload-os-bbs.hoyolab.com/wiki/test.webp';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function entry(overrides = {}) {
  return {
    entry_page_id: '1',
    name: 'Safe Name',
    icon_url: VALID_ASSET,
    display_field: {},
    filter_values: {},
    desc: '',
    ...overrides,
  };
}

function page(rows, total = rows.length) {
  return { retcode: 0, message: 'OK', data: { list: rows, total: String(total) } };
}

async function rejectsCode(action, code) {
  await assert.rejects(action, (error) => error?.code === code);
}

test('canonical row hashing ignores object and row order', () => {
  const first = [
    { id: '2', nested: { z: 1, a: 2 }, values: ['a', 'b'] },
    { id: '1', name: 'one' },
  ];
  const reordered = [
    { name: 'one', id: '1' },
    { values: ['a', 'b'], nested: { a: 2, z: 1 }, id: '2' },
  ];
  assert.equal(canonicalRowsHash(first), canonicalRowsHash(reordered));
  assert.notEqual(canonicalRowsHash(first), canonicalRowsHash([
    reordered[0], { ...reordered[1], values: ['b', 'a'] },
  ]));
  assert.notEqual(canonicalRowsHash(first), canonicalRowsHash([
    ...first.slice(0, 1), { ...first[1], generatedAt: 'full-value-must-hash' },
  ]));
});

test('menu discovery selects exactly one visible page by style', () => {
  const menus = [
    { id: 'hidden', style: 'character', has_page: true, is_hidden: true },
    {
      id: 'parent',
      style: 'other',
      has_page: false,
      is_hidden: false,
      sub_menus: [{ id: '42', style: 'character', has_page: true, is_hidden: false }],
    },
  ];
  assert.equal(discoverMenu(menus, 'character'), '42');
  assert.throws(
    () => discoverMenu([...menus, { id: '43', style: 'character', has_page: true, is_hidden: false }], 'character'),
    (error) => error?.code === 'MENU_NOT_UNIQUE',
  );
});

test('scope stays pinned to the approved three collections per HoYo game', () => {
  assert.deepEqual(HOYO_GAMES.map(({ game, collections }) => ({
    game,
    collections: collections.map(({ collection }) => collection),
  })), [
    { game: 'gi', collections: ['characters', 'weapons', 'artifacts'] },
    { game: 'hsr', collections: ['characters', 'lightcones', 'relics'] },
    { game: 'zzz', collections: ['agents', 'w-engines', 'drive-discs'] },
  ]);
});

test('page requests carry the required POST contract and disable cache', async () => {
  const calls = [];
  const result = await fetchHoyoCollection(HOYO_GAMES[0], '42', async (url, options) => {
    calls.push({ url, options });
    return page([entry()]);
  });

  assert.equal(result.hoyoCount, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/genshin\/wapi\/get_entry_page_list$/);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.cache, false);
  assert.equal(calls[0].options.maxBytes, MAX_PAGE_BYTES);
  assert.equal(calls[0].options.retries, 0);
  assert.equal(calls[0].options.timeoutMs, SHADOW_REQUEST_TIMEOUT_MS);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    menu_id: '42', page_num: 1, page_size: 30, filters: [],
  });
  assert.equal(calls[0].options.headers.origin, 'https://wiki.hoyolab.com');
  assert.equal(calls[0].options.headers.referer, 'https://wiki.hoyolab.com/pc/genshin/home');
  assert.equal(calls[0].options.headers['x-rpc-wiki_app'], 'genshin');
  assert.equal(calls[0].options.headers['x-rpc-language'], 'en-us');
  assert.equal(calls[0].options.headers['content-type'], 'application/json');
});

test('shared fetch helper forwards POST bodies without conditional GET caching', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json', etag: 'must-not-be-cached' },
    });
  };

  assert.deepEqual(await fetchCommonJson('https://example.invalid/post', {
    method: 'post',
    body: '{"value":1}',
    cache: true,
    retries: 0,
    headers: { 'content-type': 'application/json' },
  }), { ok: true });
  assert.equal(request.url, 'https://example.invalid/post');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.body, '{"value":1}');
  assert.equal(request.options.headers['If-None-Match'], undefined);
  assert.equal(request.options.headers['If-Modified-Since'], undefined);
});

test('shared fetch helper stops an oversized JSON stream before parsing', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(`${' '.repeat(64)}{"ok":true}`, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  await assert.rejects(
    () => fetchCommonJson('https://example.invalid/oversized', {
      maxBytes: 32,
      retries: 0,
    }),
    /Response exceeds the byte limit/,
  );
});

test('malformed envelopes, retcodes, page bounds, and pagination drift are rejected', async (t) => {
  const cases = [
    ['wrong envelope', { retcode: 0, message: 'OK', data: null }, 'PAGE_ENVELOPE_INVALID'],
    ['nonzero retcode', { retcode: 7, message: 'no', data: {} }, 'PAGE_RETCODE'],
    ['zero-total collapse', page([], 0), 'PAGE_TOTAL_COLLAPSE'],
    ['premature empty page', page([], 1), 'PAGE_EMPTY'],
    ['count mismatch', page([entry()], 2), 'PAGE_COUNT_MISMATCH'],
    ['row ceiling', page([], 601), 'PAGE_LIMIT_EXCEEDED'],
    ['oversized payload', page([entry({ desc: 'x'.repeat(MAX_PAGE_BYTES) })]), 'PAGE_PAYLOAD_TOO_LARGE'],
  ];

  for (const [name, payload, code] of cases) {
    await t.test(name, () => rejectsCode(
      () => fetchHoyoCollection(HOYO_GAMES[0], '1', async () => payload),
      code,
    ));
  }

  await t.test('total changes between pages', async () => {
    let call = 0;
    const firstPage = Array.from({ length: 30 }, (_, index) => entry({ entry_page_id: String(index + 1) }));
    await rejectsCode(
      () => fetchHoyoCollection(HOYO_GAMES[0], '1', async () => (
        call++ === 0 ? page(firstPage, 31) : page([], 30)
      )),
      'PAGE_TOTAL_CHANGED',
    );
  });
});

test('duplicate, missing, and non-numeric entry IDs are rejected', async (t) => {
  const cases = [
    ['missing', entry({ entry_page_id: undefined }), 'ENTRY_ID_INVALID'],
    ['non-numeric', entry({ entry_page_id: 'abc' }), 'ENTRY_ID_INVALID'],
    ['duplicate', [entry(), entry({ name: 'Second' })], 'ENTRY_ID_DUPLICATE'],
  ];

  for (const [name, value, code] of cases) {
    await t.test(name, () => rejectsCode(
      () => fetchHoyoCollection(
        HOYO_GAMES[0],
        '1',
        async () => page(Array.isArray(value) ? value : [value]),
      ),
      code,
    ));
  }
});

test('missing or invalid name, asset, display, filter, and description fields are rejected', async (t) => {
  const cases = [
    ['missing name', { name: undefined }, 'ENTRY_NAME_INVALID'],
    ['oversized name', { name: 'x'.repeat(MAX_NAME_BYTES + 1) }, 'ENTRY_NAME_OVERSIZED'],
    ['missing icon', { icon_url: undefined }, 'ENTRY_ICON_INVALID'],
    ['http icon', { icon_url: 'http://upload-os-bbs.hoyolab.com/a.webp' }, 'ENTRY_ICON_INVALID'],
    ['foreign icon', { icon_url: 'https://hoyolab.com.evil.example/a.webp' }, 'ENTRY_ICON_INVALID'],
    ['array display', { display_field: [] }, 'ENTRY_DISPLAY_INVALID'],
    ['missing filter', { filter_values: undefined }, 'ENTRY_FILTER_INVALID'],
    ['non-string desc', { desc: null }, 'ENTRY_DESC_INVALID'],
  ];

  for (const [name, overrides, code] of cases) {
    await t.test(name, () => rejectsCode(
      () => fetchHoyoCollection(HOYO_GAMES[0], '1', async () => page([entry(overrides)])),
      code,
    ));
  }
});

test('local metadata and live row contracts stay strict while missing assets are counted', () => {
  assert.throws(
    () => validateMetadata({ channel: 'beta', version: '1.0', files: {} }, 'live'),
    (error) => error?.code === 'LOCAL_METADATA_INVALID',
  );
  assert.throws(
    () => validateMetadata({ channel: 'live', version: 0, files: {} }, 'live'),
    (error) => error?.code === 'LOCAL_METADATA_INVALID',
  );
  assert.throws(
    () => validateLocalRows('gi', 'live', [{ id: '1', name: 'Name', contentStatus: 'beta' }]),
    (error) => error?.code === 'LOCAL_CONTENT_STATUS_INVALID',
  );
  assert.equal(validateLocalRows('gi', 'live', [
    { id: '1', name: 'Name', contentStatus: 'live' },
  ])[0].hasAsset, false);
  assert.doesNotThrow(() => validateLocalRows('gi', 'beta', [
    { id: '1', name: 'Name', contentStatus: 'beta_changed' },
  ]));
  assert.doesNotThrow(() => validateLocalRows('zzz', 'beta', [
    { id: '2', name: '', codeName: 'Beta Code', contentStatus: 'beta' },
  ]));
  assert.throws(
    () => validateLocalRows('zzz', 'beta', [{ id: '3', name: '', contentStatus: 'beta' }]),
    (error) => error?.code === 'LOCAL_NAME_INVALID',
  );
});

test('GI, HSR, and ZZZ aliases cover only the approved exact joins', () => {
  assert.ok(buildLocalAliases('gi', { name: 'Traveler', element: 'Anemo' }).includes('traveleranemo'));

  const trailblazer = buildLocalAliases('hsr', { name: '{NICKNAME}', path: 'Warrior' });
  assert.ok(trailblazer.includes('trailblazer'));
  assert.ok(trailblazer.includes('trailblazerthedestruction'));

  const march = buildLocalAliases('hsr', { name: 'March 7th', path: 'Rogue' });
  assert.ok(march.includes('march7ththehunt'));
  assert.equal(normalizeAlias('Silver Wolf LV.<unbreak>999</unbreak>'), 'silverwolflv999');

  const zzz = buildLocalAliases('zzz', { name: 'Short', profile: { full_name: 'Full Name' } });
  assert.ok(zzz.includes('fullname'));
  assert.ok(!buildLocalAliases('zzz', { name: 'Piper', profile: { full_name: 'Piper' } }).includes('piperwheel'));
});

test('aggregate classification separates live, beta-only, and unknown names', () => {
  const live = validateLocalRows('hsr', 'live', [
    { id: '1', name: 'Alpha', contentStatus: 'live' },
  ]);
  const beta = validateLocalRows('hsr', 'beta', [
    { id: '1', name: 'Alpha', contentStatus: 'live' },
    { id: '2', name: 'Beta', contentStatus: 'beta' },
  ]);
  const counts = classifyEntries([
    { name: 'Alpha' }, { name: 'Beta' }, { name: 'Unknown' },
  ], live, beta);
  assert.deepEqual(counts, { liveMatched: 1, betaOnly: 1, unknown: 1 });
});

test('workflow keeps the shadow job read-only, non-blocking, and separate from publishing', async () => {
  const workflow = await fs.readFile(path.join(REPO_ROOT, '.github', 'workflows', 'gamedata-watch.yml'), 'utf8');
  const start = workflow.indexOf('\n  hoyowiki-shadow:');
  const end = workflow.indexOf('\n  gamedata:', start);
  assert.ok(start >= 0 && end > start);
  const shadowJob = workflow.slice(start, end);
  assert.match(shadowJob, /continue-on-error:\s*true/);
  assert.match(shadowJob, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(shadowJob, /hoyowiki-shadow\.test\.mjs/);
  assert.match(shadowJob, /hoyowiki-shadow\.mjs/);
  const lfsCacheIndex = shadowJob.indexOf('uses: actions/cache/restore@v6');
  const lfsCheckoutIndex = shadowJob.indexOf('git lfs checkout');
  const lfsPullIndex = shadowJob.indexOf('git lfs pull --include="Database/GameData/gi/live/characters.json,Database/GameData/hsr/live/characters.json" --exclude=""');
  const compareIndex = shadowJob.indexOf('node ./gamedata/hoyowiki-shadow.mjs');
  assert.ok(lfsCacheIndex >= 0);
  assert.ok(lfsCacheIndex < lfsCheckoutIndex && lfsCheckoutIndex < lfsPullIndex && lfsPullIndex < compareIndex);
  assert.match(shadowJob, /if git grep [\s\S]+git lfs pull --include=[\s\S]+\n\s*fi/);
  assert.doesNotMatch(shadowJob, /secrets\.|CF_API_TOKEN|wrangler|git\s+(?:add|commit|push)|deploy/i);
  const timeoutMinutes = Number(shadowJob.match(/timeout-minutes:\s*(\d+)/)?.[1]);
  const maximumRequests = HOYO_GAMES.length
    + HOYO_GAMES.reduce((total, game) => total + (game.collections.length * MAX_PAGES), 0);
  assert.ok(maximumRequests * SHADOW_REQUEST_TIMEOUT_MS < timeoutMinutes * 60_000 * 0.8);
});

function fixtureHarness({
  malformed = null,
  unknown = null,
  withoutAsset = null,
  unsafePath = null,
} = {}) {
  const databaseDir = path.resolve('shadow-fixture-database');
  const files = new Map();
  const collectionData = new Map();
  const calls = [];

  for (const [gameIndex, game] of HOYO_GAMES.entries()) {
    const liveFiles = {};
    const betaFiles = {};
    for (const [collectionIndex, collection] of game.collections.entries()) {
      const stem = collection.collection;
      const id = String(((gameIndex + 1) * 100) + collectionIndex + 1);
      const name = `Fixture ${game.game} ${collectionIndex + 1}`;
      const key = `${game.game}/${collection.collection}`;
      liveFiles[collection.fileKey] = unsafePath === key
        ? `GameData/${game.game}/live/../beta/${stem}.json`
        : `GameData/${game.game}/live/${stem}.json`;
      betaFiles[collection.fileKey] = `GameData/${game.game}/beta/${stem}.json`;
      const asset = withoutAsset === key ? {} : {
        assets: { icon: `GameData/${game.game}/assets/${stem}/${id}.webp` },
      };
      const liveRow = { id, name, contentStatus: 'live', ...asset };
      const betaRow = { ...liveRow, contentStatus: 'live' };
      files.set(path.normalize(path.join(databaseDir, liveFiles[collection.fileKey])), [liveRow]);
      files.set(path.normalize(path.join(databaseDir, betaFiles[collection.fileKey])), [betaRow]);
      collectionData.set(key, { id, name, menuId: String(collectionIndex + 1), game, collection });
    }
    files.set(path.normalize(path.join(databaseDir, 'GameData', game.game, 'live', 'metadata.json')), {
      channel: 'live', version: `${gameIndex + 1}.0`, files: liveFiles,
    });
    files.set(path.normalize(path.join(databaseDir, 'GameData', game.game, 'beta', 'metadata.json')), {
      channel: 'beta', version: `${gameIndex + 1}.1`, files: betaFiles,
    });
  }

  const readJsonImpl = async (file) => {
    const value = files.get(path.normalize(file));
    if (value === undefined) throw Object.assign(new Error('missing fixture'), { code: 'ENOENT' });
    return structuredClone(value);
  };

  const fetchJsonImpl = async (url, options) => {
    calls.push({ url, options });
    const game = HOYO_GAMES.find((candidate) => url.includes(`/hoyowiki/${candidate.wikiApp}/`));
    assert.ok(game);
    if (url.endsWith('/get_menus')) {
      return {
        retcode: 0,
        message: 'OK',
        data: {
          menus: game.collections.map((collection, index) => ({
            id: String(index + 1),
            style: collection.style,
            has_page: true,
            is_hidden: false,
          })),
        },
      };
    }

    const body = JSON.parse(options.body);
    const collection = game.collections[Number(body.menu_id) - 1];
    const key = `${game.game}/${collection.collection}`;
    if (malformed === key) return { retcode: 0, message: 'OK', data: { list: null, total: '1' } };
    const data = collectionData.get(key);
    return page([entry({
      entry_page_id: data.id,
      name: unknown === key ? 'RAW_NAME_SENTINEL' : data.name,
      icon_url: 'https://upload-os-bbs.hoyolab.com/RAW_URL_SENTINEL.webp',
      desc: 'RAW_DESCRIPTION_SENTINEL',
      display_field: { secret: 'RAW_DISPLAY_SENTINEL' },
      filter_values: { secret: { values: ['RAW_FILTER_SENTINEL'] } },
    })]);
  };

  return { databaseDir, readJsonImpl, fetchJsonImpl, calls };
}

test('differences and missing local assets stay healthy and reports contain no raw fields', async () => {
  const fixture = fixtureHarness({
    unknown: 'zzz/agents',
    withoutAsset: 'gi/weapons',
  });
  const result = await runShadowComparison({
    ...fixture,
    now: () => new Date('2026-08-30T12:00:00.000Z'),
  });
  const giWeapons = result.report.games[0].collections[1];
  const zzzAgents = result.report.games[2].collections[0];

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.overallHealth, 'healthy');
  assert.equal(giWeapons.localWithoutAsset, 1);
  assert.equal(giWeapons.status, 'differences');
  assert.equal(zzzAgents.unknown, 1);
  assert.equal(zzzAgents.status, 'differences');
  assert.equal(result.report.mode, 'shadow');
  assert.equal(result.report.locale, 'en-us');
  assert.equal(result.report.published, false);
  assert.deepEqual(result.report.promotedFields, []);
  const menuCalls = fixture.calls.filter(({ url }) => url.endsWith('/get_menus'));
  assert.equal(menuCalls.length, HOYO_GAMES.length);
  assert.ok(menuCalls.every(({ options }) => options.maxBytes === MAX_PAGE_BYTES
    && options.retries === 0
    && options.timeoutMs === SHADOW_REQUEST_TIMEOUT_MS));

  const output = `${JSON.stringify(result.report)}\n${result.markdown}\n${renderMarkdown(result.report)}`;
  for (const sentinel of [
    'RAW_NAME_SENTINEL',
    'RAW_URL_SENTINEL',
    'RAW_DESCRIPTION_SENTINEL',
    'RAW_DISPLAY_SENTINEL',
    'RAW_FILTER_SENTINEL',
    'upload-os-bbs.hoyolab.com',
  ]) assert.ok(!output.includes(sentinel));
});

test('one collection failure is sanitized, unhealthy, nonzero, and does not stop siblings', async () => {
  const fixture = fixtureHarness({ malformed: 'hsr/lightcones' });
  const result = await runShadowComparison({
    ...fixture,
    now: () => new Date('2026-08-30T12:00:00.000Z'),
  });
  const hsr = result.report.games[1].collections;

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.overallHealth, 'unhealthy');
  assert.equal(hsr[1].status, 'unhealthy');
  assert.equal(hsr[1].errorCode, 'PAGE_ENVELOPE_INVALID');
  assert.equal(hsr[0].status, 'aligned');
  assert.equal(hsr[2].status, 'aligned');
  assert.ok(!JSON.stringify(result.report).includes('list'));
});

test('metadata collection paths cannot cross the declared channel directory', async () => {
  const fixture = fixtureHarness({ unsafePath: 'gi/characters' });
  const result = await runShadowComparison({
    ...fixture,
    now: () => new Date('2026-08-30T12:00:00.000Z'),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.games[0].collections[0].status, 'unhealthy');
  assert.equal(result.report.games[0].collections[0].errorCode, 'LOCAL_FILE_PATH_INVALID');
  assert.equal(result.report.games[0].collections[1].status, 'aligned');
});

test('full upstream values affect only hashes, while row order does not', async () => {
  const rows = [entry({ entry_page_id: '2', desc: 'two' }), entry({ entry_page_id: '1', desc: 'one' })];
  const forward = await fetchHoyoCollection(HOYO_GAMES[0], '1', async () => page(rows));
  const reversed = await fetchHoyoCollection(HOYO_GAMES[0], '1', async () => page([...rows].reverse()));
  const changed = await fetchHoyoCollection(HOYO_GAMES[0], '1', async () => page([
    rows[0], { ...rows[1], desc: 'changed' },
  ]));

  assert.equal(forward.hoyoProjectedHash, reversed.hoyoProjectedHash);
  assert.equal(forward.hoyoSchemaHash, reversed.hoyoSchemaHash);
  assert.notEqual(forward.hoyoProjectedHash, changed.hoyoProjectedHash);
  assert.equal(forward.hoyoSchemaHash, changed.hoyoSchemaHash);
});

test('schema hashing is stable when heterogeneous rows cross a page boundary', async () => {
  const rows = Array.from({ length: 31 }, (_, index) => entry({
    entry_page_id: String(index + 1),
    ...(index === 0 ? { optional_field: true } : {}),
  }));
  const moved = [...rows.slice(1), rows[0]];

  async function load(order, _url, options) {
    const { page_num: pageNumber, page_size: pageSize } = JSON.parse(options.body);
    const start = (pageNumber - 1) * pageSize;
    return page(order.slice(start, start + pageSize), order.length);
  }

  const first = await fetchHoyoCollection(
    HOYO_GAMES[0], '1', (url, options) => load(rows, url, options),
  );
  const reordered = await fetchHoyoCollection(
    HOYO_GAMES[0], '1', (url, options) => load(moved, url, options),
  );

  assert.equal(first.hoyoProjectedHash, reordered.hoyoProjectedHash);
  assert.equal(first.hoyoSchemaHash, reordered.hoyoSchemaHash);
});
