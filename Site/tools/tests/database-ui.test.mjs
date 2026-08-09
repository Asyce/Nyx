import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const helperSource = await fs.readFile(path.join(root, 'src/features/database/database-ui.js'), 'utf8');
const appSource = await fs.readFile(path.join(root, 'src/app/nyx-app.jsx'), 'utf8');
const context = { console };
vm.runInNewContext(`${helperSource}\n;globalThis.__api={NYX_DATABASE_PAGE_SIZE,nyxDatabaseFacetValue,nyxDatabaseRarityTier,nyxDatabaseActiveFilterCount,nyxDatabaseHasFacets,nyxDatabaseFacetLabel,nyxDatabaseSortFacetValues,nyxDatabaseNextLimit,nyxDatabaseEscapeAction};`, context);
const api = context.__api;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('rarity facets normalize source tiers through Endfield 6★ then Unknown', () => {
  const raw = ['5 ★', 'Unknown', '2 stars', '4★', '1', '3 star', '6★', 'B-Rank', 'A', 'S', 'broken'];
  const counts = new Map();
  raw.forEach((value) => {
    const label = api.nyxDatabaseFacetValue('rarity', value);
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  const sorted = plain(api.nyxDatabaseSortFacetValues('rarity', counts.entries())).map(([label]) => label);
  assert.deepEqual(sorted, ['1★', '2★', '3★', '4★', '5★', '6★', 'Unknown']);
  assert.equal(counts.get('Unknown'), 2, 'invalid ranks stay reachable under Unknown');
  assert.equal(api.nyxDatabaseRarityTier('S-Rank'), 5);
  assert.equal(api.nyxDatabaseActiveFilterCount({ kind:'all', tag:'Food', rarity:undefined }), 1);
});

test('rarity order never follows result counts', () => {
  const entries = [['5★', 900], ['2★', 1], ['Unknown', 9999], ['1★', 2], ['4★', 70], ['3★', 8]];
  assert.deepEqual(plain(api.nyxDatabaseSortFacetValues('rarity', entries)).map(([label]) => label), ['1★', '2★', '3★', '4★', '5★', 'Unknown']);
});

test('generic collection Filter is available only when it has usable choices', () => {
  assert.equal(api.nyxDatabaseHasFacets([]), false);
  assert.equal(api.nyxDatabaseHasFacets([{ key:'rarity', values:[] }]), false);
  assert.equal(api.nyxDatabaseHasFacets([{ key:'rarity', values:['4\u2605', '5\u2605'] }]), true);
  assert.match(appSource, /nyxDatabaseHasFacets\(facets\) && <DatabaseFilterPopover id="database-collection-filter-popout"/);
  assert.equal(api.nyxDatabaseFacetLabel('rank'), 'Rank');
  assert.equal(api.nyxDatabaseFacetLabel('twoPieceStat'), '2-Piece Stat');
  assert.match(appSource, /DB_FACET_KEYS = \[[^\]]*'rank'[^\]]*'twoPieceStat'/);
});

test('progressive reveal reaches every result, including records after 400', () => {
  let limit = api.NYX_DATABASE_PAGE_SIZE;
  const total = 1001;
  const seen = new Set();
  while (true) {
    for (let index = 0; index < Math.min(limit, total); index += 1) seen.add(index);
    if (limit >= total) break;
    limit = api.nyxDatabaseNextLimit(limit, total);
  }
  assert.equal(limit, total);
  assert.ok(seen.has(400));
  assert.ok(seen.has(1000));
  assert.equal(seen.size, total);
});

test('Escape closes a popout first, a detail second, and leaves an ordinary list alone', () => {
  assert.equal(api.nyxDatabaseEscapeAction({ filterOpen:true, detailOpen:true }), 'close-filter');
  assert.equal(api.nyxDatabaseEscapeAction({ detailOpen:true }), 'close-detail');
  assert.equal(api.nyxDatabaseEscapeAction({}), 'stay');
});

test('Database surfaces share accessible Filter popouts and preserve list focus', () => {
  assert.doesNotMatch(appSource, /DB_GRID_CAP|Showing \{DB_GRID_CAP\}/);
  assert.equal((appSource.match(/<DatabaseFilterPopover/g) || []).length, 4);
  for (const id of ['database-collection-filter-popout', 'wonderland-filter-popout', 'tcg-filter-popout', 'pot-filter-popout']) {
    assert.match(appSource, new RegExp(`id="${id}"`));
  }
  assert.match(appSource, /className="db-filter-popout"/);
  assert.match(appSource, /document\.addEventListener\('pointerdown', onPointerDown\)/);
  assert.match(appSource, /document\.addEventListener\('keydown', onKeyDown, true\)/);
  assert.match(appSource, /data-db-focus-key=\{dbListFocusKey\('tcg'/);
  assert.match(appSource, /data-db-focus-key=\{dbListFocusKey\('pot'/);
  assert.match(appSource, /data-db-focus-key=\{dbListFocusKey\('wonder'/);
  // 2026-08-09: "Load more" is gone from every Database surface — sections
  // render everything and paint as they scroll into view.
  assert.doesNotMatch(appSource, /className="db-load-more"/);
  assert.match(appSource, /<DatabaseGroupedList/);
  assert.match(appSource, /className="db-scroll"/);
  assert.ok((appSource.match(/window\.addEventListener\('keydown', onKeyDown\)/g) || []).length >= 3);
});

test('all Database details unmount before restoring tile focus without scrolling', () => {
  const start = appSource.indexOf('const closeDetail = React.useCallback(() => {');
  const end = appSource.indexOf('\n  }, []);', start);
  const closeDetailSource = appSource.slice(start, end);
  assert.ok(start >= 0 && end > start, 'Collection closeDetail callback is present');
  assert.match(closeDetailSource, /const restore = restoreFocusRef\.current/);
  assert.match(closeDetailSource, /ReactDOM\.flushSync\(\(\) => setDetailItem\(null\)\)/);
  assert.match(closeDetailSource, /requestAnimationFrame\(\(\) => restore\.focus\(\{ preventScroll:true \}\)\)/);
  assert.ok(closeDetailSource.indexOf('flushSync') < closeDetailSource.indexOf('restore.focus'), 'modal unmount happens before focus restoration');
  assert.match(appSource, /ReactDOM\.flushSync\(\(\) => setDetail\(null\)\);\s*dbRestoreListSnapshot\(snapshot, gridRef\)/);
  assert.match(appSource, /ReactDOM\.flushSync\(\(\) => setActiveCard\(null\)\);\s*dbRestoreListSnapshot\(snapshot, gridRef\)/);
  assert.match(appSource, /ReactDOM\.flushSync\(\(\) => setActiveItem\(null\)\);\s*dbRestoreListSnapshot\(snapshot, gridRef\)/);
  assert.match(appSource, /target\.focus\(\{ preventScroll:true \}\)/);
});

test('collection, Wonderland, TCG, and Pot tab buttons do not render count badges', () => {
  const collectionTabs = appSource.slice(appSource.indexOf('<div className="db-tabs">'), appSource.indexOf('</div>', appSource.indexOf('<div className="db-tabs">')) + 6);
  const wonderTabs = appSource.slice(appSource.indexOf('<div className="wonder-tabs"'), appSource.indexOf('</div>', appSource.indexOf('<div className="wonder-tabs"')) + 6);
  assert.doesNotMatch(collectionTabs, /<b>\{c\.count\}<\/b>/);
  assert.doesNotMatch(wonderTabs, /<b>\{row\.items\.length\}<\/b>/);
  assert.doesNotMatch(appSource, /<span>\{label\}<\/span><b>\{count\}<\/b>/);
  assert.doesNotMatch(appSource, /<span>All<\/span><b>\{(?:tagTotal|subTotal)\}<\/b>/);
});

test('every Database list and detail surface uses the filled rarity frame', () => {
  assert.match(appSource, /function DatabaseItemFrame[\s\S]*<CMItemFrame[\s\S]*dataRarityTier=\{tier\}/);
  for (const className of ['db-art', 'db-modal-media', 'wonder-detail-art', 'wonder-art', 'tcg-detail-image', 'tcg-art', 'pot-detail-art', 'pot-art']) {
    assert.match(appSource, new RegExp(`<DatabaseItemFrame className="${className}"`));
  }
  assert.match(appSource, /rarity=\{activeCard\.rarity \?\? 0\} portrait/);
  assert.match(appSource, /rarity=\{card\.rarity \?\? 0\} portrait/);
  assert.doesNotMatch(appSource, /db-rarity-frame/);
  assert.equal(api.nyxDatabaseRarityTier(undefined), 0, 'missing source rarity is explicit Unknown');
  assert.equal(api.nyxDatabaseRarityTier(1), 1, 'known 1-star stays distinct from Unknown');
});
