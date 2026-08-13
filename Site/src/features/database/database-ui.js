// Small, deterministic Database UI helpers. Kept free of browser state so the
// filtering and progressive-reveal rules can be tested without mounting React.
const NYX_DATABASE_PAGE_SIZE = 120;

function nyxDatabaseFacetValue(key, raw){
  const value = String(raw ?? '').trim();
  if (key !== 'rarity') return value;
  const sourceRank = value.replace(/-?rank$/i, '').trim().toUpperCase();
  const letterRank = { B:3, A:4, S:5 }[sourceRank];
  if (letterRank) return letterRank + '\u2605';
  const match = value.match(/^(\d+)\s*(?:\u2605|star(?:s)?)?$/i);
  const rank = match ? Number(match[1]) : NaN;
  return Number.isInteger(rank) && rank >= 1 && rank <= 6 ? rank + '\u2605' : 'Unknown';
}

function nyxDatabaseRarityTier(raw){
  const match = nyxDatabaseFacetValue('rarity', raw).match(/^([1-6])\u2605$/);
  return match ? Number(match[1]) : 0;
}

function nyxDatabaseActiveFilterCount(filters){
  return Object.values(filters || {}).filter((value) => value !== undefined
    && value !== null && value !== '' && value !== 'all').length;
}

function nyxDatabaseHasFacets(facets){
  return Array.isArray(facets) && facets.some((facet) => Array.isArray(facet?.values) && facet.values.length > 0);
}

function nyxDatabaseFacetLabel(key){
  if (key === 'twoPieceStat') return '2-Piece Stat';
  return String(key || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function nyxDatabaseSortFacetValues(key, entries){
  return [...entries].sort((a, b) => {
    if (key === 'rarity') {
      const av = /^([1-6])\u2605$/.test(a[0]) ? Number(a[0][0]) : 99;
      const bv = /^([1-6])\u2605$/.test(b[0]) ? Number(b[0][0]) : 99;
      return av - bv || String(a[0]).localeCompare(String(b[0]));
    }
    return b[1] - a[1] || String(a[0]).localeCompare(String(b[0]));
  });
}

function nyxDatabaseNextLimit(current, total, pageSize = NYX_DATABASE_PAGE_SIZE){
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeCurrent = Math.max(0, Number(current) || 0);
  const safePage = Math.max(1, Number(pageSize) || NYX_DATABASE_PAGE_SIZE);
  return Math.min(safeTotal, safeCurrent + safePage);
}

function nyxDatabaseEscapeAction({ detailOpen = false, filterOpen = false } = {}){
  if (filterOpen) return 'close-filter';
  if (detailOpen) return 'close-detail';
  return 'stay';
}

/* ---------------------------------------------------------------------------
   Shared Database ordering (user 2026-08-09), applied to every collection in
   every game — weapons, artifacts, light cones, relics, W-engines, echoes,
   gear, items, monsters, and the Genshin TCG / Serenitea Pot / Miliastra
   Wonderland views.

     1. split into labelled sections by category (weapon type, monster type…)
     2. inside a section, highest rarity first
     3. inside a rarity, most recently released first
     4. name as the final tiebreak, so the order never wobbles

   "Most recently released" reads a `released` date the site build attaches from
   banner history; anything without one falls back to its internal id, which
   climbs over time in every one of these games.
--------------------------------------------------------------------------- */

// A section only earns its own heading if the field genuinely divides the
// collection — one value, or a value per item, is not a grouping.
const NYX_DATABASE_GROUP_KEYS = ['type', 'family', 'purpose', 'element', 'kind'];
const NYX_DATABASE_UNGROUPED = 'All';

function nyxDatabaseGroupKey(items){
  const rows = Array.isArray(items) ? items : [];
  if (rows.length < 8) return '';
  for (const key of NYX_DATABASE_GROUP_KEYS) {
    const values = new Set();
    let covered = 0;
    for (const item of rows) {
      const value = String((item?.fields || {})[key] ?? (key === 'kind' ? item?.kind : '') ?? '').trim();
      if (!value) continue;
      covered += 1;
      values.add(value);
    }
    // Needs to cover most of the collection, split it into a readable number of
    // sections, and not degenerate into one section per item.
    if (covered < rows.length * 0.8) continue;
    // Up to 80 sections: Genshin Items alone spans 74 item types, and leaving
    // it as one 9,700-row block is worse than a long list of headed sections.
    if (values.size < 2 || values.size > 80) continue;
    if (values.size > rows.length / 3) continue;
    return key;
  }
  return '';
}

function nyxDatabaseGroupValue(item, key){
  if (!key) return NYX_DATABASE_UNGROUPED;
  const raw = (item?.fields || {})[key] ?? (key === 'kind' ? item?.kind : '');
  const value = String(raw ?? '').trim();
  return value || 'Other';
}

// Sort key for "newest first". A real release date wins; otherwise the numeric
// tail of the id, which increases as content ships.
function nyxDatabaseRecency(item){
  const released = String(item?.released || item?.fields?.released || '').trim();
  if (released) return { kind:'date', value:released };
  const digits = String(item?.id || '').match(/(\d+)\s*$/);
  return { kind:'id', value:digits ? Number(digits[1]) : -1 };
}

// Collections carry rarity in slightly different places: `fields.rarity` for
// the main database, a bare `rank` for Wonderland costumes, `rarity` for the
// special views.
function nyxDatabaseItemRarity(item){
  return nyxDatabaseRarityTier(item?.fields?.rarity ?? item?.rarity ?? item?.rank);
}

/* Some rows have no artwork in either the live or the beta game data — cut or
   unreleased content the game files still list (Glacier and Snowfield, the 7.0
   weapons that have not shipped art yet). They get their own section at the
   bottom rather than sitting among real entries (user 2026-08-09).
   The site build marks them `artStatus:'intentional-fallback'` when it falls
   back to the shared placeholder. */
const NYX_DATABASE_UNRELEASED_LABEL = '???';

const NYX_DATABASE_COLLAPSED_GROUPS = new Set([
  'Unlocks the associated character',
  'Activates Constellation',
]);

function nyxDatabaseGroupCollapsed(label){
  return NYX_DATABASE_COLLAPSED_GROUPS.has(String(label || ''));
}

function nyxDatabaseIsUnreleased(item){
  if (item?.artStatus === 'intentional-fallback') return true;
  const art = String(item?.art || '');
  return !art || art.includes('database-fallbacks');
}

function nyxDatabaseCompareItems(a, b){
  // Art-less rows sink below everything else, in the flat-sorted special views
  // as well as inside a section.
  const unreleased = (nyxDatabaseIsUnreleased(a) ? 1 : 0) - (nyxDatabaseIsUnreleased(b) ? 1 : 0);
  if (unreleased) return unreleased;
  const rarity = nyxDatabaseItemRarity(b) - nyxDatabaseItemRarity(a);
  if (rarity) return rarity;
  const ra = nyxDatabaseRecency(a);
  const rb = nyxDatabaseRecency(b);
  if (ra.kind === 'date' && rb.kind === 'date' && ra.value !== rb.value) return ra.value > rb.value ? -1 : 1;
  if (ra.kind === 'date' && rb.kind !== 'date') return -1;
  if (rb.kind === 'date' && ra.kind !== 'date') return 1;
  if (ra.kind === 'id' && rb.kind === 'id' && ra.value !== rb.value) return rb.value - ra.value;
  return String(a?.name || '').localeCompare(String(b?.name || ''));
}

// Sections themselves are ordered by their best item, so the type holding the
// newest 5-star leads. Alphabetical is the tiebreak.
function nyxDatabaseGroupItems(items, options){
  const all = Array.isArray(items) ? items : [];
  // Pulled out before grouping so they never split across type sections.
  const rows = all.filter((item) => !nyxDatabaseIsUnreleased(item));
  const unreleased = all.filter(nyxDatabaseIsUnreleased);
  const key = options && options.groupKey !== undefined ? options.groupKey : nyxDatabaseGroupKey(rows);
  const buckets = new Map();
  rows.forEach((item) => {
    const label = nyxDatabaseGroupValue(item, key);
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(item);
  });
  const groups = [...buckets.entries()].map(([label, list]) => ({
    key:label,
    label,
    items:list.slice().sort(nyxDatabaseCompareItems),
  }));
  groups.sort((left, right) => {
    const leftCollapsed = nyxDatabaseGroupCollapsed(left.label) ? 1 : 0;
    const rightCollapsed = nyxDatabaseGroupCollapsed(right.label) ? 1 : 0;
    return leftCollapsed - rightCollapsed
      || nyxDatabaseCompareItems(left.items[0], right.items[0])
      || String(left.label).localeCompare(String(right.label));
  });
  if (unreleased.length) {
    groups.push({
      key:'__unreleased__',
      label:NYX_DATABASE_UNRELEASED_LABEL,
      unreleased:true,
      items:unreleased.slice().sort(nyxDatabaseCompareItems),
    });
  }
  return { groupKey:key, groups };
}

// 1-2 star items are hidden until asked for; 3-star items always display. Only offered
// when the collection actually spans rarities — hiding half of a list that has
// no rarity at all would just lose rows.
const NYX_DATABASE_LOW_RARITY_MAX = 2;

function nyxDatabaseHasLowRarity(items){
  const rows = Array.isArray(items) ? items : [];
  let low = 0;
  let high = 0;
  rows.forEach((item) => {
    const tier = nyxDatabaseItemRarity(item);
    if (!tier) return;
    if (tier <= NYX_DATABASE_LOW_RARITY_MAX) low += 1; else high += 1;
  });
  return low > 0 && high > 0;
}

function nyxDatabaseApplyRarityFloor(items, showAll){
  const rows = Array.isArray(items) ? items : [];
  if (showAll || !nyxDatabaseHasLowRarity(rows)) return rows;
  return rows.filter((item) => nyxDatabaseItemRarity(item) > NYX_DATABASE_LOW_RARITY_MAX);
}
