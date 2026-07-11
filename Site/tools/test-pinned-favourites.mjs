import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = await fs.readFile(path.resolve(here, '../src/shared/pinned-favourites.js'), 'utf8');
const data = new Map();
const events = [];
const context = {
  localStorage:{
    getItem:(key) => data.has(key) ? data.get(key) : null,
    setItem:(key, value) => data.set(key, String(value)),
    removeItem:(key) => data.delete(key),
  },
  CustomEvent:class CustomEvent { constructor(type, init){ this.type = type; this.detail = init?.detail; } },
  window:{ dispatchEvent:(event) => { events.push(event); return true; } },
};
vm.runInNewContext(source + '\n;globalThis.api={nyxPinnedCharacterId,nyxLoadPinnedIds,nyxSavePinnedIds,nyxFavouriteModeKey,nyxLoadFavouriteMode,nyxSaveFavouriteMode,nyxAddPinnedId,nyxFavouriteVisibleCards,nyxAddFavourite,nyxUnfavouriteConfirmKey,nyxUnfavouriteConfirmSuppressed,nyxSaveUnfavouriteConfirm};', context);
const api = context.api;

assert.equal(api.nyxLoadPinnedIds('gi'), null, 'missing storage must be distinguishable from an intentionally empty list');
assert.equal(api.nyxSavePinnedIds('gi', ['1', '1', 2]), true);
assert.deepEqual([...api.nyxLoadPinnedIds('gi')], ['1', '2']);
assert.equal(events.at(-1).type, 'nyx:pinned-changed');
assert.deepEqual([...events.at(-1).detail.ids], ['1', '2']);
api.nyxSavePinnedIds('gi', []);
assert.deepEqual([...api.nyxLoadPinnedIds('gi')], [], 'an empty pinned list must stay empty');
assert.equal(api.nyxPinnedCharacterId('nyx', { gameKey:'hsr', id:1001 }), 'hsr:1001');
assert.equal(api.nyxLoadFavouriteMode('gi'), 'card');
assert.equal(api.nyxSaveFavouriteMode('gi', 'icon'), 'icon');
assert.equal(api.nyxLoadFavouriteMode('gi'), 'icon');

const cards = Array.from({ length:7 }, (_, index) => ({ id:String(index + 1) }));
assert.equal(api.nyxFavouriteVisibleCards(cards, 'card').length, 5);
assert.equal(cards.length - api.nyxFavouriteVisibleCards(cards, 'card').length, 2, 'Card mode exposes the +X count');
assert.equal(api.nyxFavouriteVisibleCards(cards, 'icon').length, 7, 'Icon mode is unlimited');
assert.deepEqual([...api.nyxAddFavourite(cards.slice(0, 5), { id:'6' }, 'card', 'gi').map((row) => row.id)], ['1', '2', '3', '4', '6']);
assert.equal(api.nyxAddFavourite(cards.slice(0, 5), { id:'6' }, 'icon', 'gi').length, 6);
assert.deepEqual([...api.nyxAddPinnedId(['1', '2', '3', '4', '5'], '6', 'card')], ['1', '2', '3', '4', '6']);
assert.deepEqual([...api.nyxAddPinnedId(['1', '2', '3', '4', '5'], '6', 'icon')], ['1', '2', '3', '4', '5', '6']);
assert.deepEqual([...api.nyxAddPinnedId(['1', '2', '3', '4', '5', '6', '7'], '8', 'card')], ['1', '2', '3', '4', '8', '6', '7'], 'Card replacement preserves Icon-mode overflow pins');

const now = 1_000_000;
api.nyxSaveUnfavouriteConfirm('gi', '24h', now);
assert.equal(api.nyxUnfavouriteConfirmSuppressed('gi', now + 1), true);
assert.equal(api.nyxUnfavouriteConfirmSuppressed('gi', now + 24 * 60 * 60 * 1000 + 1), false);
assert.equal(data.has(api.nyxUnfavouriteConfirmKey('gi')), false, 'expired suppression is cleaned up');
api.nyxSaveUnfavouriteConfirm('gi', 'forever', now);
assert.equal(api.nyxUnfavouriteConfirmSuppressed('gi', now + 10 * 365 * 24 * 60 * 60 * 1000), true);

const appSource = await fs.readFile(path.resolve(here, '../src/app/nyx-app.jsx'), 'utf8');
const materialsSource = await fs.readFile(path.resolve(here, '../src/features/materials/char-materials.jsx'), 'utf8');
const cssSource = await fs.readFile(path.resolve(here, '../src/styles/game-page-shared.css'), 'utf8');
assert.match(appSource, /fns:\['Characters','Database'/, 'game tabs are user-facing Characters tabs');
assert.match(appSource, /\{ key:'overview', label:'Overview' \},\s*\{ key:'characters', label:'Characters' \}/, 'hub Characters sits directly below Overview');
assert.match(appSource, /mats:'materials'/, 'the old materials route remains available');
assert.match(appSource, /overviewCardArt\(\{ art \}, ch, idx\)/, 'Card mode keeps the special-art card path');
assert.match(materialsSource, /event\.stopPropagation\(\); onTogglePinned/, 'the roster star cannot open the character cell');
assert.match(materialsSource, /Back to Characters/, 'character detail back navigation targets Characters');
assert.match(cssSource, /\.cm-cell:hover \.disc,\.cm-cell:focus-within \.disc/, 'roster hover and keyboard focus share the glow');
assert.match(cssSource, /@media \(max-width: 680px\)[\s\S]*\.gp-fav-icon-grid/, 'compact favourites have a mobile layout');

console.log('Pinned favourites tests passed.');
