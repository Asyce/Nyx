import assert from 'node:assert/strict';
import test from 'node:test';
import { connectPairs, localIso, monotonicMerge, semanticHash, stableId, validateDataset } from '../core.mjs';

function row(overrides={}) {
  const record = { id:'x', game:'gi', bannerType:'character', category:'Character Event', name:'Example', windowsByRegion:{ asia:{ start:'2024-01-01T02:00:00.000Z', end:'2024-01-21T09:59:59.000Z', timezone:'UTC+8', sourceUrl:'https://example.test' } }, permanent:false, featured:[{entityType:'character',name:'Example',rarity:5,primary:true}], pairedBannerIds:[], source:{url:'https://example.test',kind:'fixture',revision:1}, fetchedAt:'2026-01-01T00:00:00Z', confirmed:true, ...overrides };
  return record;
}
function dataset(records) { return { schemaVersion:1, game:'gi', generatedAt:'2026-01-01T00:00:00Z', records }; }

test('local server timestamps preserve explicit offsets', () => {
  assert.equal(localIso('2024-01-01 10:00:00', 'GMT+8'), '2024-01-01T02:00:00.000Z');
  assert.equal(localIso('2024-01-01 10:00', 'UTC-5'), '2024-01-01T15:00:00.000Z');
});

test('stable ids ignore fetch metadata', () => {
  assert.equal(stableId(row()), stableId(row({ fetchedAt:'2030-01-01T00:00:00Z', source:{url:'x',kind:'x',revision:99} })));
  assert.equal(semanticHash(dataset([row()])), semanticHash({ ...dataset([row({ fetchedAt:'2030-01-01T00:00:00Z' })]), generatedAt:'2030-01-01T00:00:00Z' }));
});

test('pairing requires an explicit source link and an exact same-region window', () => {
  const character = row({ id:'c', _title:'Character/2024-01-01', _alongside:'Weapon/2024-01-01' });
  const weapon = row({ id:'w', bannerType:'weapon', featured:[{entityType:'weapon',name:'Weapon',rarity:5,primary:true}], _title:'Weapon/2024-01-01', _alongside:'Character/2024-01-01' });
  connectPairs([character, weapon]);
  assert.deepEqual(character.pairedBannerIds, ['w']);
  weapon.windowsByRegion.asia.start = '2024-01-02T02:00:00.000Z';
  character._title='Character/2024-01-01'; character._alongside='Weapon/2024-01-01'; weapon._title='Weapon/2024-01-01'; weapon._alongside='Character/2024-01-01';
  connectPairs([character, weapon]);
  assert.deepEqual(character.pairedBannerIds, []);
});

test('LKG rejects empty, shrink, duplicate, bad dates, and confirmed removal', () => {
  const old = dataset([row({id:'a'}), row({id:'b',name:'Second'})]);
  assert.throws(() => validateDataset(dataset([])), /Empty/);
  assert.throws(() => validateDataset(dataset([row({id:'a'}),row({id:'a'})])), /Duplicate/);
  assert.throws(() => validateDataset(dataset([row({windowsByRegion:{asia:{start:'2024-02-01T00:00:00Z',end:'2024-01-01T00:00:00Z',timezone:'UTC',sourceUrl:'x'}}})])), /Invalid dates/);
  assert.throws(() => monotonicMerge(old, dataset([row({id:'a'})])), /needs_review/);
  assert.throws(() => monotonicMerge(old, dataset([row({id:'a'}),row({id:'c',name:'Third'})])), /lost 1 confirmed/);
});

test('same-count replacement of an UNCONFIRMED record is flagged, not silently deleted', () => {
  // Sol repro: previous [confirmed, unconfirmed-old]; candidate swaps in unconfirmed-new at the
  // same count. This slips past both the confirmed-only removal filter and the shrink check.
  const old = dataset([row({id:'confirmed'}), row({id:'unconfirmed-old', name:'Old', confirmed:false})]);
  const candidate = dataset([row({id:'confirmed'}), row({id:'unconfirmed-new', name:'New', confirmed:false})]);
  assert.throws(() => monotonicMerge(old, candidate), /needs_review: gi lost 1 records/);
  // A genuine no-removal merge (same ids) still succeeds.
  assert.doesNotThrow(() => monotonicMerge(old, dataset([row({id:'confirmed'}), row({id:'unconfirmed-old', name:'Old', confirmed:false})])));
});
