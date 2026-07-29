import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expandWuwaReferenceAchievements,
  parseWuwaReferencePage,
  reconcileWuwaReleasedReference,
} from '../wuwa-reference.mjs';

function flattenRoots(roots) {
  const flattened = [];
  function add(value) {
    const index = flattened.length;
    flattened.push(null);
    if (value == null || typeof value !== 'object') {
      flattened[index] = value;
    } else if (Array.isArray(value)) {
      flattened[index] = value.map(add);
    } else {
      flattened[index] = Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, add(entry)]),
      );
    }
    return index;
  }
  for (const root of roots) add(root);
  return flattened;
}

test('WuWa reference parser reads version, overview, and recursive group rows from Nuxt data', () => {
  const overview = {
    list: [{
      id:1,
      title:'Exploration',
      child:[{ id:1001, title:'Exploration: Test', count:2 }],
    }],
    count:{ value:2, stars:2, astrites:10 },
  };
  const group = {
    id:1001,
    name:'Exploration: Test',
    child:[{
      id:1,
      title:'First',
      child:[{ id:2, title:'Second', display:true }],
      display:true,
    }],
  };
  const payload = flattenRoots([
    { code:1000, data:{ resourceVersion:'3.5.10' }, message:'ok' },
    { code:1000, data:overview, message:'ok' },
    { code:1000, data:group, message:'ok' },
  ]);
  const parsed = parseWuwaReferencePage(
    `<script type="application/json" id="__NUXT_DATA__">${JSON.stringify(payload)}</script>`,
  );
  assert.equal(parsed.resourceVersion, '3.5.10');
  assert.deepEqual(parsed.overview, overview);
  assert.deepEqual(parsed.group, group);
  assert.deepEqual(expandWuwaReferenceAchievements(group.child).map(({ id }) => id), [1, 2]);
});

test('WuWa reference reconciliation reports summary-count bugs and exact missing IDs', () => {
  const overview = {
    list: [{
      id:2,
      title:'Journey',
      child:[{ id:2007, title:'World in All Its Variety II', count:1 }],
    }],
    count:{ value:1 },
  };
  const groups = [{
    id:2007,
    name:'World in All Its Variety II',
    child:[{ id:1, title:'Released' }],
  }];
  const result = reconcileWuwaReleasedReference([
    { id:'1', groupId:'2007' },
    { id:'2', groupId:'2007' },
  ], overview, groups);
  assert.equal(result.total, 1);
  assert.equal(result.expandedPageRows, 1);
  assert.deepEqual(result.candidateOnlyIds, ['2']);
  assert.deepEqual(result.referenceOnlyIds, []);
  assert.deepEqual(result.groupCountMismatches, [{
    categoryId:'2',
    groupId:'2007',
    title:'World in All Its Variety II',
    listedRows:1,
    pageRows:1,
    expandedRows:1,
    candidateRows:2,
  }]);
});

test('WuWa reference reconciliation fails closed when a group page is missing', () => {
  assert.throws(
    () => reconcileWuwaReleasedReference([], {
      list:[{ id:1, title:'Exploration', child:[{ id:1001, title:'Test', count:0 }] }],
      count:{ value:0 },
    }, []),
    /missing groups/,
  );
});
