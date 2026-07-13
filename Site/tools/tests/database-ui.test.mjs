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
vm.runInNewContext(`${helperSource}\n;globalThis.__api={NYX_DATABASE_PAGE_SIZE,nyxDatabaseFacetValue,nyxDatabaseSortFacetValues,nyxDatabaseNextLimit,nyxDatabaseEscapeAction};`, context);
const api = context.__api;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('rarity facets normalize to supported 1★ through 5★ then Unknown', () => {
  const raw = ['5 ★', 'Unknown', '2 stars', '4★', '1', '3 star', '6★', 'broken'];
  const counts = new Map();
  raw.forEach((value) => {
    const label = api.nyxDatabaseFacetValue('rarity', value);
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  const sorted = plain(api.nyxDatabaseSortFacetValues('rarity', counts.entries())).map(([label]) => label);
  assert.deepEqual(sorted, ['1★', '2★', '3★', '4★', '5★', 'Unknown']);
  assert.equal(counts.get('Unknown'), 3, 'invalid ranks stay reachable under Unknown');
});

test('rarity order never follows result counts', () => {
  const entries = [['5★', 900], ['2★', 1], ['Unknown', 9999], ['1★', 2], ['4★', 70], ['3★', 8]];
  assert.deepEqual(plain(api.nyxDatabaseSortFacetValues('rarity', entries)).map(([label]) => label), ['1★', '2★', '3★', '4★', '5★', 'Unknown']);
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

test('Database surfaces use progressive reveal, focus snapshots, and the TCG filter popout', () => {
  assert.doesNotMatch(appSource, /DB_GRID_CAP|Showing \{DB_GRID_CAP\}/);
  assert.match(appSource, /className="tcg-filter-popout"/);
  assert.match(appSource, /document\.addEventListener\('pointerdown', onPointerDown\)/);
  assert.match(appSource, /document\.addEventListener\('keydown', onKeyDown, true\)/);
  assert.match(appSource, /data-db-focus-key=\{dbListFocusKey\('tcg'/);
  assert.match(appSource, /data-db-focus-key=\{dbListFocusKey\('pot'/);
  assert.match(appSource, /data-db-focus-key=\{dbListFocusKey\('wonder'/);
  assert.ok((appSource.match(/className="db-load-more"/g) || []).length >= 4);
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
