import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = await fs.readFile(path.resolve(here, '../../src/features/gacha/pulls-engine.js'), 'utf8');

function engine(history = []) {
  const window = { NYX_BANNERS:{ ae:history } };
  vm.runInContext(source, vm.createContext({
    window, console, Date, Math, Map, Number, Object, Reflect, Set, TextEncoder,
    URL, URLSearchParams, JSON, parseInt, isFinite,
  }));
  return window.NyxPulls;
}

function pull({ poolType, poolId, poolName, seq, rank = 4, minute = seq, free = false, name = 'Result', itemType }) {
  const weapon = poolType === 'arsenal';
  return {
    id:(weapon ? 'weapon:' : 'character:') + poolId + ':' + seq,
    recordType:weapon ? 'weapon' : 'character',
    seqId:String(seq),
    poolId,
    poolName,
    poolType,
    banner:weapon ? 'weapon' : 'character',
    sourceBanner:poolName,
    itemId:String(1000 + seq),
    name,
    itemType:itemType || (weapon ? 'Sword' : 'character'),
    rank,
    rarity:rank,
    time:Date.UTC(2026, 6, 1, 0, minute),
    obtainedAt:new Date(Date.UTC(2026, 6, 1, 0, minute)).toISOString(),
    isNew:false,
    isFree:free,
    ...(weapon ? { batchId:poolId } : {}),
  };
}

test('Basic and Beginner use Endfield 6/5 rules while free pulls never change paid pity', () => {
  const rows = [];
  for (let seq = 1; seq <= 15; seq += 1) rows.push(pull({
    poolType:'basic', poolId:'BASIC', poolName:'Basic', seq,
    rank:seq === 1 ? 6 : (seq === 10 ? 5 : 4),
  }));
  rows.push(pull({ poolType:'basic', poolId:'BASIC', poolName:'Basic', seq:99, minute:12.5, rank:6, free:true }));
  for (let seq = 101; seq <= 140; seq += 1) rows.push(pull({
    poolType:'beginner', poolId:'BEGINNER', poolName:'Beginner', seq, minute:seq,
    rank:seq === 140 ? 6 : (seq % 10 === 0 ? 5 : 4),
  }));

  const views = engine().buildViews('ae', rows);
  const basic = views.find((view) => view.key === 'basic');
  const beginner = views.find((view) => view.key === 'beginner');
  assert.deepEqual(
    { top:basic.topRank, secondary:basic.secondaryRank, soft:basic.soft, hard:basic.hard, secondaryHard:basic.secondaryHard },
    { top:6, secondary:5, soft:66, hard:80, secondaryHard:10 },
  );
  assert.equal(basic.paidTotal, 15);
  assert.equal(basic.freeCount, 1);
  assert.equal(basic.currentPity, 14);
  assert.equal(basic.currentFourPity, 5);
  assert.equal(basic.fives.find((row) => row.isFree).affectsPity, false);
  assert.deepEqual({ current:basic.progress[0].current, target:basic.progress[0].target }, { current:15, target:300 });
  assert.equal(beginner.total, 40);
  assert.equal(beginner.hard, 40);
  assert.equal(beginner.currentPity, 0);
  assert.equal(beginner.currentFourPity, 0);
  assert.equal(views.some((view) => view.ff || view.guaranteed), false);
});

test('equal-time Endfield rows use numeric sequence order', () => {
  const rows = [
    pull({ poolType:'basic', poolId:'BASIC', poolName:'Basic', seq:10, minute:1, rank:6 }),
    pull({ poolType:'basic', poolId:'BASIC', poolName:'Basic', seq:9, minute:1, rank:4 }),
  ];
  const view = engine().buildViews('ae', rows).find((item) => item.key === 'basic');
  assert.equal(view.fives[0].pity, 2);
  assert.equal(view.currentPity, 0);
});

test('Chartered pity carries, while Fest pools and 120 rewards stay independent', () => {
  const history = [
    { type:'character', name:'Pool A', start:Date.UTC(2026, 6, 1), end:Date.UTC(2026, 6, 2), featuredTop:['rate_up'] },
    { type:'character', name:'Pool B', start:Date.UTC(2026, 6, 2), end:Date.UTC(2026, 6, 3), featuredTop:['other_rate_up'] },
  ];
  const rows = [];
  for (let seq = 1; seq <= 20; seq += 1) rows.push(pull({
    poolType:'chartered', poolId:'POOL_A', poolName:'Pool A', seq,
    rank:seq === 10 ? 6 : (seq % 10 === 0 ? 5 : 4), name:seq === 10 ? 'Rate Up' : 'Result',
  }));
  rows.push(pull({ poolType:'chartered', poolId:'POOL_A', poolName:'Pool A', seq:90, minute:20.5, rank:6, free:true, name:'Rate Up' }));
  for (let seq = 21; seq <= 25; seq += 1) rows.push(pull({
    poolType:'chartered', poolId:'POOL_B', poolName:'Pool B', seq, minute:1440 + seq,
  }));
  for (let seq = 31; seq <= 37; seq += 1) rows.push(pull({ poolType:'fest-joint', poolId:'FEST_A', poolName:'Fest A', seq, minute:3000 + seq }));
  rows.push(pull({ poolType:'fest-joint', poolId:'FEST_A', poolName:'Fest A', seq:98, minute:3040, rank:6, free:true }));
  for (let seq = 41; seq <= 43; seq += 1) rows.push(pull({ poolType:'fest-joint', poolId:'FEST_B', poolName:'Fest B', seq, minute:4000 + seq }));

  const views = engine(history).buildViews('ae', rows);
  const chartered = views.find((view) => view.key === 'chartered');
  assert.equal(chartered.paidTotal, 25);
  assert.equal(chartered.currentPity, 15);
  assert.equal(chartered.fives.find((row) => row.name === 'Rate Up' && !row.isFree).featured, true);
  const poolA = chartered.progress.find((row) => row.key.endsWith('POOL_A'));
  const poolB = chartered.progress.find((row) => row.key.endsWith('POOL_B'));
  assert.deepEqual({ current:poolA.current, target:poolA.target, achieved:poolA.achieved }, { current:20, target:120, achieved:true });
  assert.deepEqual({ current:poolB.current, target:poolB.target, achieved:poolB.achieved }, { current:5, target:120, achieved:false });

  const festA = views.find((view) => view.key === 'fest-joint:FEST_A');
  const festB = views.find((view) => view.key === 'fest-joint:FEST_B');
  assert.equal(festA.currentPity, 7);
  assert.equal(festA.freeCount, 1);
  assert.equal(festA.progress[0].current, 7);
  assert.equal(festB.currentPity, 3);
  assert.equal(festB.progress[0].current, 3);
});

test('Arsenal counts complete ten-record issues only and resolves its first featured result', () => {
  const history = [{
    type:'weapon', name:'Military Grade', start:Date.UTC(2026, 6, 1), end:Date.UTC(2026, 6, 3), featuredTop:['rate_up_weapon'],
  }];
  const rows = [];
  for (let seq = 1; seq <= 25; seq += 1) rows.push(pull({
    poolType:'arsenal', poolId:'ISSUE_A', poolName:'Military Grade Issue', seq,
    rank:seq === 1 || seq === 10 || seq === 20 ? 6 : (seq % 10 === 5 ? 5 : 4),
    name:seq === 20 ? 'Rate Up Weapon' : 'Other Weapon',
  }));

  const view = engine(history).buildViews('ae', rows).find((item) => item.key === 'arsenal:ISSUE_A');
  const pool = view.weaponPools[0];
  assert.equal(view.topRank, 6);
  assert.equal(view.hard, 4);
  assert.equal(view.currentPity, 0);
  assert.deepEqual(
    { complete:pool.completeIssues, incomplete:pool.incompleteRecords, six:pool.sixProgress, featured:pool.featuredObtained, featuredProgress:pool.featuredProgress },
    { complete:2, incomplete:5, six:0, featured:true, featuredProgress:2 },
  );
  assert.equal(view.fives.find((row) => row.seqId === '1').affectsPity, false);
  assert.equal(view.fives.find((row) => row.seqId === '20').featured, true);
  assert.equal(view.items.every((row) => row.isWeapon), true);
  assert.equal(view.ff, false);
  assert.equal(view.guaranteed, false);
});
