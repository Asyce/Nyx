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

// Search keeps order and repeated words. All completed words must match
// exactly; only the final word may be a prefix ("phane" -> "Phanes").
export function nyxLibraryQueryWords(value){
  const normalized = nyxLibraryNormalizeText(value);
  if (!normalized) return [];
  const words = normalized.split(' ');
  return words.every((word) => word.length >= 1 && word.length <= 80) ? words : [];
}

export function nyxLibraryWordSpans(value){
  const text = String(value || '');
  const spans = [];
  for (const match of text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
    const word = nyxLibraryNormalizeText(match[0]);
    if (word) spans.push({ word, start:match.index, end:match.index + match[0].length });
  }
  return spans;
}

export function nyxLibraryPhraseRanges(value, query){
  const wanted = nyxLibraryQueryWords(query);
  if (!wanted.length) return [];
  const source = nyxLibraryWordSpans(value);
  const ranges = [];
  for (let index = 0; index <= source.length - wanted.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < wanted.length; offset += 1) {
      const actual = source[index + offset].word;
      const expected = wanted[offset];
      if (offset === wanted.length - 1 ? !actual.startsWith(expected) : actual !== expected) {
        matches = false;
        break;
      }
    }
    if (matches) ranges.push({ start:source[index].start, end:source[index + wanted.length - 1].end });
  }
  return ranges;
}

export function nyxLibraryTextHasPhrase(value, query){
  return nyxLibraryPhraseRanges(value, query).length > 0;
}

export function nyxLibraryNormalizedTextHasPhrase(value, query){
  const text = String(value || '');
  const needle = (Array.isArray(query) ? query : nyxLibraryQueryWords(query)).join(' ');
  if (!needle) return false;
  let at = text.indexOf(needle);
  while (at >= 0) {
    if (at === 0 || text[at - 1] === ' ') return true;
    at = text.indexOf(needle, at + 1);
  }
  return false;
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

export function nyxLibraryDocumentQueryRanges(document, query){
  const ranges = [];
  for (const leaf of nyxLibraryDocumentLeaves(document)) {
    const blockId = String(leaf?.id || '');
    if (!blockId) continue;
    for (const range of nyxLibraryPhraseRanges(nyxLibraryLeafText(leaf), query)) ranges.push({ blockId, ...range });
  }
  return ranges;
}

export function nyxLibraryDocumentHasPhrase(document, query){
  return nyxLibraryDocumentQueryRanges(document, query).length > 0;
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

// Schema v2 stores normalized text per source leaf and volume. Returning the
// first matching volume for each book makes result opening deterministic while
// keeping phrases from crossing paragraph/list/table-cell boundaries.
export function nyxLibrarySearchMatches(searchIndex, query){
  const matches = new Map();
  const wanted = nyxLibraryQueryWords(query);
  if (!wanted.length || !searchIndex || searchIndex.schemaVersion !== 2
    || !Array.isArray(searchIndex.books) || !Array.isArray(searchIndex.volumes)) return matches;
  for (const volume of searchIndex.volumes) {
    const bookNumber = Number(volume?.book);
    const bookId = Number.isInteger(bookNumber) ? searchIndex.books[bookNumber] : null;
    if (!bookId || matches.has(bookId) || !Array.isArray(volume?.leaves)) continue;
    if (volume.leaves.some((leaf) => nyxLibraryNormalizedTextHasPhrase(leaf, wanted))) {
      matches.set(bookId, { bookId, volumeKey:String(volume.volumeKey || '') });
    }
  }
  return matches;
}

export function nyxLibraryMatchingVolumeIndex(volumes, query, preferredVolumeKey = ''){
  const rows = Array.isArray(volumes) ? volumes : [];
  const preferred = String(preferredVolumeKey || '');
  if (preferred) {
    const index = rows.findIndex((volume) => String(volume?.volumeKey || volume?.id || '') === preferred
      && nyxLibraryDocumentHasPhrase(volume?.document, query));
    if (index >= 0) return index;
  }
  return rows.findIndex((volume) => nyxLibraryDocumentHasPhrase(volume?.document, query));
}

export function nyxLibraryFocusReturnTarget(opener, bookId, candidates = []){
  if (opener?.isConnected && typeof opener.focus === 'function') return opener;
  return Array.from(candidates).find((node) => node?.isConnected && node?.dataset?.libraryBookId === bookId && typeof node.focus === 'function') || null;
}
