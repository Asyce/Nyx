// Small, deterministic Database UI helpers. Kept free of browser state so the
// filtering and progressive-reveal rules can be tested without mounting React.
const NYX_DATABASE_PAGE_SIZE = 120;

function nyxDatabaseFacetValue(key, raw){
  const value = String(raw ?? '').trim();
  if (key !== 'rarity') return value;
  const match = value.match(/^(\d+)\s*(?:\u2605|star(?:s)?)?$/i);
  const rank = match ? Number(match[1]) : NaN;
  return Number.isInteger(rank) && rank >= 1 && rank <= 5 ? rank + '\u2605' : 'Unknown';
}

function nyxDatabaseSortFacetValues(key, entries){
  return [...entries].sort((a, b) => {
    if (key === 'rarity') {
      const av = /^([1-5])\u2605$/.test(a[0]) ? Number(a[0][0]) : 99;
      const bv = /^([1-5])\u2605$/.test(b[0]) ? Number(b[0][0]) : 99;
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
