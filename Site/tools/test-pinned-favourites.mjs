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
vm.runInNewContext(source + '\n;globalThis.api={nyxPinnedCharacterId,nyxLoadPinnedIds,nyxSavePinnedIds,nyxFavouriteModeKey,nyxLoadFavouriteMode,nyxSaveFavouriteMode,nyxAddPinnedId,nyxFavouriteVisibleCards,nyxLoadPinnedUnion,nyxAddFavourite,nyxUnfavouriteConfirmKey,nyxUnfavouriteConfirmSuppressed,nyxSaveUnfavouriteConfirm};', context);
const api = context.api;

assert.deepEqual([...api.nyxLoadPinnedIds('gi')], [], 'fresh storage starts with no favourites');
assert.equal(api.nyxSavePinnedIds('gi', ['1', '1', 2]), true);
assert.deepEqual([...api.nyxLoadPinnedIds('gi')], ['1', '2']);
assert.equal(events.at(-1).type, 'nyx:pinned-changed');
assert.deepEqual([...events.at(-1).detail.ids], ['1', '2']);
api.nyxSavePinnedIds('gi', []);
assert.deepEqual([...api.nyxLoadPinnedIds('gi')], [], 'an empty pinned list must stay empty');
assert.equal(api.nyxPinnedCharacterId('nyx', { gameKey:'hsr', id:1001 }), 'hsr:1001');
for (const game of ['gi', 'hsr', 'zzz', 'wuwa', 'ae']) assert.equal(api.nyxLoadFavouriteMode(game), 'icon', game + ' defaults to Icon');
assert.equal(api.nyxLoadFavouriteMode('nyx'), 'card', 'hub defaults to Card');
data.set(api.nyxFavouriteModeKey('hsr'), 'card');
assert.equal(api.nyxLoadFavouriteMode('hsr'), 'card', 'an existing Card preference is preserved');
assert.equal(api.nyxSaveFavouriteMode('gi', 'icon'), 'icon');
assert.equal(api.nyxLoadFavouriteMode('gi'), 'icon');

const cards = Array.from({ length:7 }, (_, index) => ({ id:String(index + 1) }));
assert.equal(api.nyxFavouriteVisibleCards(cards, 'card', 'gi').length, 5);
assert.equal(cards.length - api.nyxFavouriteVisibleCards(cards, 'card', 'gi').length, 2, 'per-game Card mode leaves overflow for icons');
assert.equal(api.nyxFavouriteVisibleCards(cards, 'icon').length, 7, 'Icon mode is unlimited');
assert.equal(api.nyxFavouriteVisibleCards(cards, 'card', 'nyx').length, 7, 'hub Card mode is unlimited');
assert.deepEqual([...api.nyxAddFavourite(cards.slice(0, 5), { id:'6' }, 'card', 'gi').map((row) => row.id)], ['1', '2', '3', '4', '5', '6']);
assert.equal(api.nyxAddFavourite(cards.slice(0, 5), { id:'6' }, 'icon', 'gi').length, 6);
assert.deepEqual([...api.nyxAddPinnedId(['1', '2', '3', '4', '5'], '6', 'card')], ['1', '2', '3', '4', '5', '6']);
assert.deepEqual([...api.nyxAddPinnedId(['1', '2', '3', '4', '5'], '6', 'icon')], ['1', '2', '3', '4', '5', '6']);
api.nyxSavePinnedIds('hsr', ['1001']);
api.nyxSavePinnedIds('zzz', ['2001', '2002']);
assert.deepEqual([...api.nyxLoadPinnedUnion(['hsr', 'zzz'])].map((row) => row.gameKey + ':' + row.id), ['hsr:1001', 'zzz:2001', 'zzz:2002']);

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
assert.match(appSource, /ensureNyxCmGames\(gameKeys\)/, 'hub loads all character datasets');
assert.match(appSource, /nyxLoadPinnedUnion\(Object\.keys\(GAME_REGISTRY\)\)/, 'hub derives favourites from every game store');
assert.match(appSource, /gp-card-grid[^\n]*hub/, 'hub cards wrap in a grid');
assert.match(appSource, /overflowCards[\s\S]*gp-fav-icon-grid compact/, 'per-game Card overflow renders as icons');
assert.match(appSource, /pinnedFavourites=/, 'favourites are mounted inside Characters below its controls');
assert.match(materialsSource, /event\.stopPropagation\(\); onTogglePinned/, 'the roster star cannot open the character cell');
assert.match(materialsSource, /placeholder="Search" aria-label="Search characters"/, 'character search is a labelled rectangular Search box');
assert.match(materialsSource, /cmMetaIconSrc\(gameKey, filterKey/, 'filter controls use the released local icon map');
assert.match(materialsSource, /bandless/, 'Talent and boss tokens support the bandless frame');
assert.match(materialsSource, /Back to Characters/, 'character detail back navigation targets Characters');
assert.match(cssSource, /\.cm-cell:hover \.disc,\.cm-cell:focus-within \.disc[^}]*#c23a78/, 'roster hover and keyboard focus share one purple-red glow');
assert.match(cssSource, /@media \(hover:none\), \(pointer:coarse\)[\s\S]*\.cm-favourite-star/, 'touch keeps favourite stars usable');
assert.match(cssSource, /\.cm-item-frame\.bandless/, 'bandless item frames remove the number section');
assert.match(cssSource, /\.gp-card-grid\.hub\{ grid-template-columns:repeat\(5/, 'hub wraps after five cards');
assert.match(cssSource, /@media \(max-width: 680px\)[\s\S]*\.gp-fav-icon-grid/, 'compact favourites have a mobile layout');

const mavuika = path.resolve(here, '../../Database/GameData/gi/assets/characters/circles/UI_AvatarIcon_Mavuika_Circle.webp');
assert.ok((await fs.stat(mavuika)).size > 0, 'Mavuika uses the released non-empty local circle icon');

console.log('Pinned favourites tests passed.');
