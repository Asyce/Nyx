'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { headingCharCandidates } = require('../heading.cjs');

test('Endfield: "X in Phase N of Version V"', () => {
  assert.deepEqual(headingCharCandidates('Rossi in Phase 2 of Version 1.1'), ['Rossi']);
});

test('Endfield: "X for Phase N of Version V"', () => {
  assert.deepEqual(headingCharCandidates('Zhuang Fangyi for Phase 1 of Version 1.2'), ['Zhuang Fangyi']);
});

test('Endfield: "X Banner on V Phase N" strips the Banner suffix', () => {
  assert.deepEqual(headingCharCandidates('Camille Banner on 1.3 Phase 2'), ['Camille']);
});

test('Endfield: teaser heading "X Teased for Version V" yields the bare name', () => {
  assert.deepEqual(headingCharCandidates('Arcane Teased for Version 1.4'), ['Arcane']);
});

test('ZZZ: multi-character "X and Y to Release in Version V"', () => {
  assert.deepEqual(
    headingCharCandidates('Promeia and Starlight Billy to Release in Version 2.8'),
    ['Promeia', 'Starlight Billy']
  );
});

test('weapon-issue headings still surface their full (rejectable) name', () => {
  // The caller filters candidates through isLikelyCharName, which rejects
  // "Issue" names — the extractor itself just reports what the heading says.
  assert.deepEqual(headingCharCandidates('Crimson Hued Issue on 1.3 Phase 2'), ['Crimson Hued Issue']);
});

test('non-banner headings yield nothing', () => {
  assert.deepEqual(headingCharCandidates('Arknights: Endfield Banner Roadmap'), []);
  assert.deepEqual(headingCharCandidates('Standard Banner - Basic Headhunting'), []);
  assert.deepEqual(headingCharCandidates(''), []);
  assert.deepEqual(headingCharCandidates(null), []);
});
