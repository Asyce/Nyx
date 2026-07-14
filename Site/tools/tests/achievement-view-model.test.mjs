import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = await fs.readFile(path.join(root, 'src/features/achievements/achievement-view-model.js'), 'utf8');
const context = { window:{} };
vm.createContext(context);
vm.runInContext(source, context, { filename:'achievement-view-model.js' });
const View = context.window.NyxAchievementViewModel;

const rows = View.catalogRows({ achievements:[
  { id:2, categoryId:'a', name:'Beta', description:'Second task', version:'2.10', reward:5, rarity:'Low' },
  { id:1, categoryId:'a', name:'Alpha', description:'First task', version:'2.9', reward:{ count:20 }, rarity:'High' },
  { id:3, categoryId:'b', name:'Gamma', description:'Third task', version:'1.0', reward:{ amount:10 }, rarity:'Mid' },
] });

test('catalog rows normalize stable IDs and keep deterministic source order', () => {
  assert.deepEqual(Array.from(rows, (row) => [row.id, row.categoryId, row._sourceIndex]), [
    ['2', 'a', 0], ['1', 'a', 1], ['3', 'b', 2],
  ]);
});

test('combined filters use category, completion, version, reward, rarity, query, and stable IDs', () => {
  const result = View.filterRows(rows, {
    completed:new Set(['1']), categoryId:'a', status:'done', version:'2.9', reward:'20',
    rarity:'High', query:'first task 1', sort:'source',
  });
  assert.deepEqual(Array.from(result, (row) => row.id), ['1']);
  assert.deepEqual(Array.from(View.filterRows(rows, { completed:['1'], status:'missing' }), (row) => row.id), ['2', '3']);
});

test('all ledger sort modes are deterministic and understand semantic versions and reward objects', () => {
  const ids = (sort) => Array.from(View.filterRows(rows, { completed:new Set(['1']), sort }), (row) => row.id);
  assert.deepEqual(ids('source'), ['2', '1', '3']);
  assert.deepEqual(ids('incomplete'), ['2', '3', '1']);
  assert.deepEqual(ids('newest'), ['2', '1', '3']);
  assert.deepEqual(ids('reward'), ['1', '3', '2']);
  assert.deepEqual(ids('name'), ['1', '2', '3']);
  assert.equal(View.compareVersions('2.10', '2.9') > 0, true);
});

test('category atlas search and hide-completed rules preserve unfinished categories', () => {
  const categories = [{ id:'a', name:'Alpha Atlas' }, { id:'b', name:'Beta Book' }, { id:'c', name:'Gamma' }];
  const progress = new Map([
    ['a', { total:2, done:2 }], ['b', { total:3, done:1 }], ['c', { total:0, done:0 }],
  ]);
  assert.deepEqual(Array.from(View.filterCategories(categories, progress, { hideCompleted:true }), (row) => row.id), ['b', 'c']);
  assert.deepEqual(Array.from(View.filterCategories(categories, progress, { query:'book' }), (row) => row.id), ['b']);
});

test('progressive rendering returns exact stable batches without losing the remainder', () => {
  const values = Array.from({ length:241 }, (_, index) => ({ id:String(index) }));
  const first = View.progressiveRows(values);
  const second = View.progressiveRows(values, 240);
  assert.equal(first.rows.length, 120);
  assert.equal(first.hasMore, true);
  assert.equal(second.rows.length, 240);
  assert.equal(second.rows[239].id, '239');
  assert.equal(second.hasMore, true);
  assert.equal(View.progressiveRows(values, 241).hasMore, false);
});
