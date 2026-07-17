import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCatalogFieldLine, parseCatalogFields } from './catalog-fields.mjs';

test('compound catalog fields split into independent source-native values', () => {
  assert.deepEqual(parseCatalogFieldLine('Rarity: B | Type: Attack'), [
    { key:'rarity', value:'B' },
    { key:'type', value:'Attack' },
  ]);
});

test('unlabelled pipe text remains in the preceding value', () => {
  assert.deepEqual(parseCatalogFieldLine('Effect: Fire | Ice'), [
    { key:'effect', value:'Fire | Ice' },
  ]);
  assert.deepEqual(parseCatalogFieldLine('not a field'), []);
});

test('set bonus sentences with colons stay bonuses instead of becoming facets', () => {
  assert.deepEqual(parseCatalogFields([
    'Defense Drive Disc',
    '(2) DEF +16%',
    '(4) When the equipper is a Defense character: increases squad damage.',
    'Rarity: A | Type: Defense',
  ]), {
    rarity:'A',
    type:'Defense',
    bonuses:[
      '(2) DEF +16%',
      '(4) When the equipper is a Defense character: increases squad damage.',
    ],
  });
});
