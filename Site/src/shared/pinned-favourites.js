// Shared pinned-character storage used by the roster and Favourites surfaces.
// This file is bundled before both consumers by build-site.mjs.
const NYX_PINNED_CHANGED_EVENT = 'nyx:pinned-changed';
const NYX_FAVOURITE_CARD_LIMIT = 5;

function nyxPinnedStorageKey(gameKey){
  return 'nyx:pinned-favourites:' + gameKey + ':v1';
}

function nyxPinnedCharacterId(gameKey, character){
  const id = String(character?.id ?? '');
  if (gameKey !== 'nyx') return id;
  const sourceGame = String(character?.gameKey || 'nyx');
  return sourceGame + ':' + id;
}

function nyxLoadPinnedIds(gameKey){
  try {
    const raw = localStorage.getItem(nyxPinnedStorageKey(gameKey));
    if (raw === null) return null;
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return null;
    return [...new Set(rows.map((id) => String(id)).filter(Boolean))];
  } catch (e) {
    return null;
  }
}

function nyxSavePinnedIds(gameKey, ids){
  const clean = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id)).filter(Boolean))];
  try {
    localStorage.setItem(nyxPinnedStorageKey(gameKey), JSON.stringify(clean));
  } catch (e) {
    return false;
  }
  try {
    window.dispatchEvent(new CustomEvent(NYX_PINNED_CHANGED_EVENT, { detail:{ gameKey, ids:clean } }));
  } catch (e) {}
  return true;
}

function nyxFavouriteModeKey(gameKey){
  return 'nyx:pinned-favourites-mode:' + gameKey + ':v1';
}

function nyxLoadFavouriteMode(gameKey){
  try { return localStorage.getItem(nyxFavouriteModeKey(gameKey)) === 'icon' ? 'icon' : 'card'; } catch (e) { return 'card'; }
}

function nyxSaveFavouriteMode(gameKey, mode){
  const clean = mode === 'icon' ? 'icon' : 'card';
  try { localStorage.setItem(nyxFavouriteModeKey(gameKey), clean); } catch (e) {}
  return clean;
}

function nyxAddPinnedId(ids, id, mode){
  const rows = Array.isArray(ids) ? ids.map(String) : [];
  const clean = String(id || '');
  if (!clean || rows.includes(clean)) return rows;
  if (mode === 'icon' || rows.length < NYX_FAVOURITE_CARD_LIMIT) return [...rows, clean];
  // Card mode replaces only the fifth visible card. Pins beyond the Card-mode
  // window came from Icon mode and must remain intact for the +X switch.
  return [...rows.slice(0, NYX_FAVOURITE_CARD_LIMIT - 1), clean, ...rows.slice(NYX_FAVOURITE_CARD_LIMIT)];
}

function nyxFavouriteVisibleCards(cards, mode){
  const rows = Array.isArray(cards) ? cards : [];
  return mode === 'icon' ? rows : rows.slice(0, NYX_FAVOURITE_CARD_LIMIT);
}

function nyxAddFavourite(cards, character, mode, gameKey){
  const rows = Array.isArray(cards) ? cards : [];
  const id = nyxPinnedCharacterId(gameKey, character);
  if (!id || rows.some((row) => nyxPinnedCharacterId(gameKey, row) === id)) return rows;
  const ids = nyxAddPinnedId(rows.map((row) => nyxPinnedCharacterId(gameKey, row)), id, mode);
  if (ids.length === rows.length && ids.every((row, index) => row === nyxPinnedCharacterId(gameKey, rows[index]))) return rows;
  return ids.map((rowId) => rowId === id ? character : rows.find((row) => nyxPinnedCharacterId(gameKey, row) === rowId)).filter(Boolean);
}

function nyxUnfavouriteConfirmKey(gameKey){
  return 'nyx:unfavourite-confirm:' + gameKey + ':v1';
}

function nyxUnfavouriteConfirmSuppressed(gameKey, now = Date.now()){
  try {
    const key = nyxUnfavouriteConfirmKey(gameKey);
    const row = JSON.parse(localStorage.getItem(key) || 'null');
    if (row?.mode === 'forever') return true;
    if (row?.mode === '24h' && Number(row.until) > now) return true;
    if (row) localStorage.removeItem(key);
  } catch (e) {}
  return false;
}

function nyxSaveUnfavouriteConfirm(gameKey, mode, now = Date.now()){
  const row = mode === 'forever' ? { mode:'forever' } : { mode:'24h', until:now + 24 * 60 * 60 * 1000 };
  try { localStorage.setItem(nyxUnfavouriteConfirmKey(gameKey), JSON.stringify(row)); return row; } catch (e) { return null; }
}
