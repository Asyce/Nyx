import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  chooseCharacterOverlay,
  chooseHsrCharacterIcon,
  chooseHsrCharacterIconFromHash,
} from '../lib/character-source-helpers.mjs';

test('HSR skips the TEST No.999 round icon but keeps ordinary round icons', () => {
  const testHash = '40a77817b465339c0a82d7249bf3fd00f260cc340a2d3d99faba492c8cf4eb86';
  const assets = { roundIcon: 'synthetic/round.webp', avatar: 'synthetic/avatar.webp' };

  assert.equal(chooseHsrCharacterIconFromHash(assets, testHash), assets.avatar);
  assert.equal(chooseHsrCharacterIconFromHash({ roundIcon: assets.roundIcon }, testHash), null);
  assert.equal(chooseHsrCharacterIconFromHash(assets, 'ordinary-round-icon'), assets.roundIcon);
  assert.equal(chooseHsrCharacterIcon(assets, import.meta.dirname), assets.roundIcon);
  assert.equal(chooseHsrCharacterIconFromHash({ avatar: assets.avatar }, testHash), assets.avatar);
  assert.equal(chooseHsrCharacterIconFromHash({}, testHash), null);
});

test('HSR switches a Prydwen beta row to Nanoka live data immediately', () => {
  const primary = { contentStatus: 'live', marker: 'nanoka-live' };
  const beta = { contentStatus: 'beta', marker: 'nanoka-beta' };
  assert.deepEqual(chooseCharacterOverlay({
    game: 'hsr', primary, beta, sourceStatus: 'beta',
  }), { local: primary, status: 'live' });
});

test('HSR uses the beta overlay while Nanoka has not promoted the character', () => {
  const beta = { contentStatus: 'beta', marker: 'nanoka-beta' };
  assert.deepEqual(chooseCharacterOverlay({
    game: 'hsr', beta, sourceStatus: 'beta',
  }), { local: beta, status: 'beta' });
});

test('ZZZ keeps its complete beta overlay for an explicit beta placeholder', () => {
  const primary = { contentStatus: 'live', marker: 'placeholder' };
  const beta = { contentStatus: 'beta', marker: 'complete' };
  assert.deepEqual(chooseCharacterOverlay({
    game: 'zzz', primary, beta, sourceStatus: 'beta',
  }), { local: beta, status: 'beta' });
});

test('ZZZ uses a beta-only overlay when the live agent is missing', () => {
  const beta = { contentStatus: 'beta', marker: 'beta-only' };
  assert.deepEqual(chooseCharacterOverlay({
    game: 'zzz', primary: null, beta, sourceStatus: 'beta',
  }), { local: beta, status: 'beta' });
});

test('HSR GameData-only fallback keeps signature light-cone materials', async () => {
  const generator = await fs.readFile(path.resolve(import.meta.dirname, '../generate-site-data.mjs'), 'utf8');
  const fallback = generator.split('Do not make a fresh Nanoka HSR character')[1]
    ?.split('// G38:')[0] || '';
  assert.match(fallback, /lookupByName\(signatureByName/);
  assert.match(fallback, /hsrSignatureForCharacter\(display, characterPath\)/);
  assert.match(fallback, /signatureReq/);
  assert.match(fallback, /req: mergedReq/);
});
