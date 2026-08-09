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
vm.runInNewContext(source + '\n;globalThis.api={nyxPinnedCharacterId,nyxLoadPinnedIds,nyxSavePinnedIds,nyxAddPinnedId,nyxLoadPinnedUnion,nyxAddFavourite,nyxForgetRetiredFavouriteSettings,nyxUnfavouriteConfirmKey,nyxUnfavouriteConfirmSuppressed,nyxSaveUnfavouriteConfirm};', context);
const api = context.api;

assert.deepEqual([...api.nyxLoadPinnedIds('gi')], [], 'fresh storage starts with no favourites');
assert.equal(api.nyxSavePinnedIds('gi', ['1', '1', 2]), true);
assert.deepEqual([...api.nyxLoadPinnedIds('gi')], ['1', '2']);
assert.equal(events.at(-1).type, 'nyx:pinned-changed');
assert.deepEqual([...events.at(-1).detail.ids], ['1', '2']);
api.nyxSavePinnedIds('gi', []);
assert.deepEqual([...api.nyxLoadPinnedIds('gi')], [], 'an empty pinned list must stay empty');
assert.equal(api.nyxPinnedCharacterId('nyx', { gameKey:'hsr', id:1001 }), 'hsr:1001');
// 2026-08-09: the Card/Icon mode and the Hide toggle are gone — favourites are
// always icons and always shown. Their saved keys get swept on load.
data.set('nyx:pinned-favourites-mode:gi:v1', 'card');
data.set('nyx:pinned-favourites-visible:gi:v1', 'hidden');
api.nyxForgetRetiredFavouriteSettings(['gi', 'nyx']);
assert.equal(data.has('nyx:pinned-favourites-mode:gi:v1'), false, 'the retired display-mode key is swept');
assert.equal(data.has('nyx:pinned-favourites-visible:gi:v1'), false, 'the retired hide key is swept');

const cards = Array.from({ length:7 }, (_, index) => ({ id:String(index + 1) }));
assert.deepEqual([...api.nyxAddFavourite(cards.slice(0, 5), { id:'6' }, 'gi').map((row) => row.id)], ['1', '2', '3', '4', '5', '6']);
assert.equal(api.nyxAddFavourite(cards.slice(0, 5), { id:'6' }, 'gi').length, 6, 'every favourite is kept — there is no card limit');
assert.deepEqual([...api.nyxAddPinnedId(['1', '2', '3', '4', '5'], '6')], ['1', '2', '3', '4', '5', '6']);
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
// 2026-08-09: the hub's Overview became Banners, Characters became Pinned
// Characters, and Events sits between them.
assert.match(appSource, /\{ key:'overview', label:'Banners' \}/, 'the hub overview tab is titled Banners');
assert.match(appSource, /\{ key:'characters', label:'Pinned Characters' \}/, 'hub favourites tab is Pinned Characters');
assert.match(appSource, /mats:'materials'/, 'the old materials route remains available');
assert.match(appSource, /ensureNyxCmGames\(gameKeys\)/, 'hub loads all character datasets');
assert.match(appSource, /nyxLoadPinnedUnion\(Object\.keys\(GAME_REGISTRY\)\)/, 'hub derives favourites from every game store');
assert.doesNotMatch(appSource, /gp-card-grid|gp-fav-modes|gp-fav-visibility|CurrentFavCard/, 'the favourite card system is gone (2026-08-09)');
assert.match(appSource, /<div className="gp-fav-icon-grid">/, 'favourites always render as icons');
assert.match(appSource, /pinnedFavourites=/, 'favourites are mounted inside Characters below its controls');
assert.match(materialsSource, /event\.stopPropagation\(\); onTogglePinned/, 'the roster star cannot open the character cell');
assert.match(materialsSource, /placeholder="Search" aria-label="Search characters"/, 'character search is a labelled rectangular Search box');
assert.match(materialsSource, /cmMetaIconSrc\(gameKey, filterKey/, 'filter controls use the released local icon map');
assert.match(materialsSource, /bandless/, 'Talent and boss tokens support the bandless frame');
assert.match(materialsSource, /Back to Characters/, 'character detail back navigation targets Characters');
assert.match(cssSource, /--character-hover:#c18cff;[\s\S]*\.cm-cell:hover \.disc,\.cm-cell:focus-within \.disc[^}]*var\(--character-hover\)/, 'roster hover and keyboard focus share the brighter purple token');
assert.doesNotMatch(cssSource, /@media \(hover:none\), \(pointer:coarse\)[\s\S]{0,100}\.cm-favourite-star/, 'favourite stars remain hover/focus only');
assert.match(cssSource, /\.cm-item-frame\.bandless/, 'bandless item frames remove the number section');
assert.doesNotMatch(cssSource, /\.gp-card-grid|\.gp-fav-modes|\.gp-fav-visibility/, 'the favourite card grid and its toggles are gone');
assert.match(materialsSource, /curTab === 'roster' && pinnedFavourites/, 'pinned favourites only render on Roster');
assert.match(materialsSource, /<GPSectionNavButton key=\{t\.k\}/, 'character tabs reuse the shell navigation button');
assert.doesNotMatch(appSource, /gp-fav-game|appGameIcon\(ch\.gameKey\)/, 'Nyx favourites do not add game badges');
assert.match(cssSource, /@media \(max-width: 680px\)[\s\S]*\.gp-fav-icon-grid/, 'compact favourites have a mobile layout');

const mavuika = path.resolve(here, '../../Database/GameData/gi/assets/characters/circles/UI_AvatarIcon_Mavuika_Circle.webp');
assert.ok((await fs.stat(mavuika)).size > 0, 'Mavuika uses the released non-empty local circle icon');

console.log('Pinned favourites tests passed.');
