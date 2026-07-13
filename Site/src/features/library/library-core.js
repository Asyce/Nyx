// Shared, deterministic Library text helpers. The scraper imports this file
// directly and the browser bundle loads it before the Library view, so search,
// rendering, and future annotation offsets all use the same plain-text rules.

export function nyxLibraryNormalizeText(value){
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function nyxLibraryWords(value){
  const normalized = nyxLibraryNormalizeText(value);
  return normalized ? [...new Set(normalized.split(' ').filter((word) => word.length >= 2 && word.length <= 80))] : [];
}

export function nyxLibraryInlineText(nodes){
  return (Array.isArray(nodes) ? nodes : []).map((node) => {
    if (!node || typeof node !== 'object') return '';
    if (node.type === 'text') return String(node.text || '');
    if (node.type === 'br') return '\n';
    if (node.type === 'em' || node.type === 'strong') return nyxLibraryInlineText(node.children);
    return '';
  }).join('');
}

// A text-bearing leaf is a heading, paragraph, list item, or table cell.
export function nyxLibraryLeafText(leaf){
  if (!leaf || typeof leaf !== 'object') return '';
  if (leaf.type === 'heading') return String(leaf.text || '');
  return nyxLibraryInlineText(leaf.children);
}

export function nyxLibraryDocumentLeaves(document){
  const leaves = [];
  for (const block of (document && Array.isArray(document.blocks) ? document.blocks : [])) {
    if (block.type === 'heading' || block.type === 'paragraph') leaves.push(block);
    else if (block.type === 'list') leaves.push(...(block.items || []));
    else if (block.type === 'table') for (const row of (block.rows || [])) leaves.push(...(row.cells || []));
  }
  return leaves;
}

export function nyxLibraryDocumentText(document){
  return nyxLibraryDocumentLeaves(document).map(nyxLibraryLeafText).filter(Boolean).join('\n');
}

export function nyxLibraryDocumentHasTokens(document, tokens){
  const wanted = Array.isArray(tokens) ? tokens : [];
  if (!wanted.length) return false;
  const words = new Set(nyxLibraryWords(nyxLibraryDocumentText(document)));
  return wanted.every((word) => words.has(word));
}

export function nyxLibrarySearchIds(searchIndex, query){
  const words = nyxLibraryWords(query);
  if (!words.length || !searchIndex || searchIndex.schemaVersion !== 1 || !Array.isArray(searchIndex.books) || !searchIndex.words) return new Set();
  const postings = words.map((word) => Array.isArray(searchIndex.words[word]) ? searchIndex.words[word] : []);
  if (postings.some((rows) => !rows.length)) return new Set();
  postings.sort((a, b) => a.length - b.length);
  const rest = postings.slice(1).map((rows) => new Set(rows));
  return new Set(postings[0].filter((bookNumber) => rest.every((rows) => rows.has(bookNumber))).map((bookNumber) => searchIndex.books[bookNumber]).filter(Boolean));
}

export function nyxLibraryFocusReturnTarget(opener, bookId, candidates = []){
  if (opener?.isConnected && typeof opener.focus === 'function') return opener;
  return Array.from(candidates).find((node) => node?.isConnected && node?.dataset?.libraryBookId === bookId && typeof node.focus === 'function') || null;
}
