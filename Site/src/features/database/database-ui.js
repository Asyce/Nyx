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
