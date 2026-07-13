import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nyxLibraryDocumentText, nyxLibraryLeafText, nyxLibraryWords } from '../../Site/src/features/library/library-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');
const USER_AGENT = 'Nyxarium/1.0 (readable library sync; https://pengo.gg)';
const MINIMUM_COUNTS = { gi: 90, hsr: 500 };
const SAFE_BLOCKS = new Set(['heading', 'paragraph', 'list', 'table', 'image']);
const SAFE_INLINE = new Set(['text', 'em', 'strong', 'br']);
const GAME_CONFIG = {
  gi: {
    api: 'https://genshin-impact.fandom.com/api.php',
    categories: ['Category:Book Collections', 'Category:Books'],
  },
  hsr: {
    api: 'https://honkai-star-rail.fandom.com/api.php',
    categories: ['Category:Readables'],
  },
};

export function slugify(value) {
  const slug = String(value || '').normalize('NFKD').toLowerCase()
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function cleanText(value) {
  return decodeEntities(String(value || '')).replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

function decodeEntities(value) {
  return String(value).replace(/&(nbsp|amp|lt|gt|quot|apos|mdash|ndash);|&#(\d+);|&#x([0-9a-f]+);/gi, (all, named, dec, hex) => {
    const names = { nbsp:' ', amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", mdash:'—', ndash:'–' };
    if (named) return names[named.toLowerCase()] ?? '';
    const point = dec ? Number(dec) : Number.parseInt(hex, 16);
    return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  });
}

function stripTemplates(value) {
  let text = String(value || '');
  text = text.replace(/\{\{\s*MC\b[^}]*\}\}/gi, 'they');
  text = text.replace(/\{\{\s*(?:Lang|Tooltip)\s*\|\s*([^|}]+)[^}]*\}\}/gi, '$1');
  for (let i = 0; i < 8 && /\{\{/.test(text); i += 1) {
    text = text.replace(/\{\{[^{}]*\}\}/g, ' ');
  }
  return text.replace(/\{\{[\s\S]*?\}\}/g, ' ');
}

function safeWikitext(value) {
  return cleanText(stripTemplates(String(value || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, ' ')
    .replace(/<ref\b[^>]*\/?\s*>/gi, ' ')
    .replace(/<(script|style|iframe|embed|object|form|input|button|video|audio|source)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(script|style|iframe|embed|object|form|input|button|video|audio|source)\b[^>]*\/?\s*>/gi, ' ')
    .replace(/\[\s*(?:javascript|data):[^\]]*\]/gi, ' ')
    .replace(/\[https?:\/\/[^\s\]]+(?:\s+([^\]]+))?\]/gi, '$1')
    .replace(/\[\[(?:File|Image):[^\]]+\]\]/gi, ' ')
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<div\b[^>]*>|<\/div\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/__\w+__/g, ' ')));
}

function inlineNodes(value) {
  const source = safeWikitext(value);
  if (!source) return [];
  const nodes = [];
  const pattern = /('''([^'](?:[\s\S]*?[^'])?)'''|''([^'](?:[\s\S]*?[^'])?)'')|\n/g;
  let at = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > at) nodes.push({ type:'text', text:source.slice(at, match.index) });
    if (match[0] === '\n') nodes.push({ type:'br' });
    else nodes.push({ type:match[2] !== undefined ? 'strong' : 'em', children:[{ type:'text', text:cleanText(match[2] ?? match[3]) }] });
    at = match.index + match[0].length;
  }
  if (at < source.length) nodes.push({ type:'text', text:source.slice(at) });
  return nodes.filter((node) => node.type !== 'text' || node.text);
}

function section(content, name) {
  const source = String(content || '');
  const re = new RegExp(`^==[ \\t]*${name}[ \\t]*==[ \\t]*$`, 'im');
  const found = re.exec(source);
  if (!found) return '';
  const start = found.index + found[0].length;
  const rest = source.slice(start);
  const end = rest.search(/^==[^=].*?==\s*$/m);
  return end >= 0 ? rest.slice(0, end) : rest;
}

function readableFallback(content) {
  const source = String(content || '').replace(/^\s*\{\{[\s\S]*?^\}\}\s*/m, '');
  const chunks = source.split(/^==[^=].*?==\s*$/m)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 80 && !/\{\{(?:Other Languages|Change History|Gallery)/i.test(chunk));
  return chunks.sort((a, b) => b.length - a.length)[0] || source;
}

export function parseReadableWikitext(value) {
  const lines = String(value || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let para = [];
  let list = null;
  let table = null;
  const flushPara = () => {
    const text = para.join('\n').trim();
    if (text) blocks.push({ type:'paragraph', children:inlineNodes(text) });
    para = [];
  };
  const flushList = () => { if (list?.items.length) blocks.push(list); list = null; };
  const flushTable = () => { if (table?.rows.length) blocks.push(table); table = null; };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    if (/^\{\|/.test(line)) { flushPara(); flushList(); table = { type:'table', rows:[] }; continue; }
    if (/^\|\}/.test(line)) { flushTable(); continue; }
    if (table) {
      if (/^\|-/.test(line)) continue;
      if (/^[|!]/.test(line)) {
        const cells = line.slice(1).split(/\|\||!!/).map((cell) => ({ children:inlineNodes(cell.replace(/^[^|]*\|/, '')) }));
        if (cells.some((cell) => cell.children.length)) table.rows.push({ cells });
      }
      continue;
    }
    const heading = line.match(/^(={2,6})\s*(.*?)\s*\1$/);
    if (heading) {
      flushPara(); flushList();
      const text = safeWikitext(heading[2]);
      if (text) blocks.push({ type:'heading', level:Math.min(4, Math.max(2, heading[1].length)), text });
      continue;
    }
    const item = line.match(/^([*#]+)\s*(.*)$/);
    if (item) {
      flushPara();
      const ordered = item[1][0] === '#';
      if (!list || list.ordered !== ordered) { flushList(); list = { type:'list', ordered, items:[] }; }
      const children = inlineNodes(item[2]);
      if (children.length) list.items.push({ children });
      continue;
    }
    if (/^\[\[(?:File|Image):/i.test(line)) continue;
    para.push(line);
  }
  flushPara(); flushList(); flushTable();
  return sanitizeDocument({ version:1, blocks });
}

function sanitizeInline(nodes) {
  if (!Array.isArray(nodes)) throw new Error('Structured readable inline content must be an array');
  return nodes.map((node) => {
    if (!node || !SAFE_INLINE.has(node.type)) throw new Error(`Disallowed readable inline type: ${node?.type || 'empty'}`);
    if (node.type === 'br') return { type:'br' };
    if (node.type === 'text') return { type:'text', text:cleanText(node.text).slice(0, 20_000) };
    return { type:node.type, children:sanitizeInline(node.children) };
  }).filter((node) => node.type !== 'text' || node.text);
}

function stableLeafId(prefix, leaf, seen) {
  const digest = crypto.createHash('sha256').update(`${prefix}\0${nyxLibraryLeafText(leaf)}`).digest('hex').slice(0, 16);
  const base = `${prefix}-${digest}`;
  const occurrence = (seen.get(base) || 0) + 1;
  seen.set(base, occurrence);
  return occurrence === 1 ? base : `${base}-${occurrence}`;
}

function assignStableLeafIds(blocks) {
  const seen = new Map();
  return blocks.map((block) => {
    if (block.type === 'heading') return { ...block, id:stableLeafId('h', block, seen) };
    if (block.type === 'paragraph') return { ...block, id:stableLeafId('p', block, seen) };
    if (block.type === 'list') return { ...block, items:block.items.map((item) => ({ ...item, id:stableLeafId('li', item, seen) })) };
    if (block.type === 'table') return { ...block, rows:block.rows.map((row) => ({ ...row, cells:row.cells.map((cell) => ({ ...cell, id:stableLeafId('td', cell, seen) })) })) };
    return block;
  });
}

export function sanitizeDocument(input) {
  if (!input || input.version !== 1 || !Array.isArray(input.blocks)) throw new Error('Invalid structured readable document');
  const blocks = input.blocks.map((block) => {
    if (!block || !SAFE_BLOCKS.has(block.type)) throw new Error(`Disallowed readable block type: ${block?.type || 'empty'}`);
    if (block.type === 'heading') return { type:'heading', level:Math.min(4, Math.max(2, Number(block.level) || 2)), text:cleanText(block.text).slice(0, 500) };
    if (block.type === 'paragraph') return { type:'paragraph', children:sanitizeInline(block.children) };
    if (block.type === 'list') return { type:'list', ordered:Boolean(block.ordered), items:(block.items || []).map((item) => ({ children:sanitizeInline(item.children) })) };
    if (block.type === 'table') return { type:'table', rows:(block.rows || []).map((row) => ({ cells:(row.cells || []).map((cell) => ({ children:sanitizeInline(cell.children) })) })) };
    const src = String(block.src || '').replace(/\\/g, '/');
    if (!/^icons\/[a-f0-9]{16,64}\.(?:png|webp)$/i.test(src) || /\.\./.test(src)) throw new Error(`Unsafe readable image path: ${src}`);
    return { type:'image', src, alt:cleanText(block.alt).slice(0, 300) };
  });
  return { version:1, blocks:assignStableLeafIds(blocks.filter((block) => block.type !== 'heading' || block.text)) };
}

export function buildLibrarySearchIndex(books, game, generatedAt) {
  const bookIds = [...new Set(books.map((book) => book.id))].sort((a, b) => a.localeCompare(b));
  const bookNumber = new Map(bookIds.map((id, index) => [id, index]));
  const postings = new Map();
  for (const book of books) {
    const words = new Set();
    for (const volume of (book.volumes || [])) for (const word of nyxLibraryWords(nyxLibraryDocumentText(volume.document))) words.add(word);
    for (const word of words) {
      if (!postings.has(word)) postings.set(word, []);
      postings.get(word).push(bookNumber.get(book.id));
    }
  }
  const sortedWords = [...postings.keys()].sort((a, b) => a.localeCompare(b));
  const words = {};
  for (const word of sortedWords) words[word] = [...new Set(postings.get(word))].sort((a, b) => a - b);
  return { schemaVersion:1, game, generatedAt, bookCount:bookIds.length, books:bookIds, wordCount:sortedWords.length, minWordLength:2, words };
}

export function enforceShrinkGuard(nextCounts, previousCounts = {}) {
  for (const game of Object.keys(GAME_CONFIG)) {
    const next = Number(nextCounts[game] || 0);
    const previous = Number(previousCounts[game] || 0);
    if (next < MINIMUM_COUNTS[game]) throw new Error(`${game} Library count ${next} is below safe minimum ${MINIMUM_COUNTS[game]}`);
    if (previous && next < Math.floor(previous * 0.9)) throw new Error(`${game} Library count ${next} failed 90% last-known-good shrink guard (${previous})`);
  }
}

async function fetchJson(url, fetchImpl, optional = false) {
  let error;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers:{ 'user-agent':USER_AGENT, accept:'application/json' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText || ''}`.trim());
      return await response.json();
    } catch (caught) {
      error = caught;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  if (optional) return null;
  throw new Error(`Failed to fetch ${url}: ${error?.message || error}`);
}

export async function enumerateCategory(api, category, fetchImpl = fetch) {
  const rows = [];
  let continuation = null;
  do {
    const url = new URL(api);
    Object.entries({ action:'query', list:'categorymembers', cmtitle:category, cmnamespace:'0', cmlimit:'max', format:'json', formatversion:'2' })
      .forEach(([key, value]) => url.searchParams.set(key, value));
    if (continuation) url.searchParams.set('cmcontinue', continuation);
    const data = await fetchJson(url.href, fetchImpl);
    rows.push(...(data?.query?.categorymembers || []));
    continuation = data?.continue?.cmcontinue || null;
  } while (continuation);
  return rows;
}

async function fetchPages(api, titles, fetchImpl) {
  const pages = [];
  for (let start = 0; start < titles.length; start += 40) {
    const url = new URL(api);
    Object.entries({ action:'query', prop:'revisions|pageimages|info', titles:titles.slice(start, start + 40).join('|'), rvprop:'content', rvslots:'main', piprop:'thumbnail|original', pithumbsize:'256', inprop:'url', redirects:'1', format:'json', formatversion:'2' })
      .forEach(([key, value]) => url.searchParams.set(key, value));
    const data = await fetchJson(url.href, fetchImpl);
    pages.push(...(data?.query?.pages || []));
  }
  return pages.filter((page) => !page.missing && page.ns === 0);
}

function infoboxField(content, field) {
  // Never use \s here: it includes newlines and can turn an empty value into the
  // next infobox field (for example `|title =\n|id = 178`).
  const match = String(content || '').match(new RegExp(`^\\|[ \\t]*${field}[ \\t]*=[ \\t]*(.*?)[ \\t]*$`, 'mi'));
  return match ? cleanLabel(match[1]) : '';
}

export function cleanLabel(value) {
  return safeWikitext(value)
    // A closing italic pair immediately followed by a possessive apostrophe is
    // encoded as three quotes: `''Butterfly Shadow'''s`.
    .replace(/(?<=[\p{L}\p{N}])'{3,5}(?=[\p{L}\p{N}])/gu, "'")
    .replace(/'{2,5}/g, '')
    .trim();
}

function volumeBodies(game, content) {
  if (game === 'gi' && /\{\{\s*Book Collection Infobox/i.test(content)) {
    // Most collections use ==Vol. 1==. A few released pages use ==Vol 1==,
    // while version-dependent texts nest ===Vol. 1=== below ==Version N==.
    const matches = [...String(content).matchAll(/^(={2,4})\s*(Vol\.?\s*\d+)\s*\1\s*$/gmi)];
    return matches.map((match, index) => {
      const start = match.index + match[0].length;
      const tail = String(content).slice(start);
      const ownLevel = match[1].length;
      const nextPeer = [...tail.matchAll(/^(={2,6})\s*([^=].*?)\s*\1\s*$/gm)]
        .find((heading) => heading[1].length <= ownLevel);
      const nextVolume = matches[index + 1]?.index;
      const peerEnd = nextPeer ? start + nextPeer.index : content.length;
      const end = Math.min(nextVolume ?? content.length, peerEnd);
      return { label:cleanLabel(match[2]), body:String(content).slice(start, end) };
    });
  }
  const text = section(content, 'Text') || readableFallback(content);
  if (game === 'hsr') {
    const matches = [...text.matchAll(/^===\s*([^=].*?)\s*===\s*$/gmi)];
    if (matches.length) return matches.map((match, index) => ({ label:cleanLabel(match[1]), body:text.slice(match.index + match[0].length, matches[index + 1]?.index ?? text.length) }));
  }
  return [{ label:'Text', body:text }];
}

function pageToBook(game, page, generatedAt) {
  const content = page.revisions?.[0]?.slots?.main?.content || page.revisions?.[0]?.content || '';
  if (!content || /^(Book|Readable)$/i.test(page.title)) return null;
  const volumeKeys = new Map();
  const volumes = volumeBodies(game, content).map((volume, index) => {
    const label = volume.label || `Volume ${index + 1}`;
    const baseKey = slugify(label);
    const occurrence = (volumeKeys.get(baseKey) || 0) + 1;
    volumeKeys.set(baseKey, occurrence);
    return {
      id:String(index + 1),
      volumeKey:occurrence === 1 ? baseKey : `${baseKey}-${occurrence}`,
      label,
      document:parseReadableWikitext(volume.body),
    };
  }).filter((volume) => volume.document.blocks.length);
  if (!volumes.length) return null;
  const name = cleanLabel(infoboxField(content, 'title') || page.title);
  if (!name || /^\|/.test(name)) throw new Error(`Library page has an unsafe display name: ${page.title}`);
  return {
    schemaVersion:1,
    game,
    id:slugify(page.title),
    name,
    sourceUrl:page.fullurl || null,
    scrapedAt:generatedAt,
    iconUrl:page.thumbnail?.source || page.original?.source || null,
    volumes,
  };
}

async function downloadIcons(books, iconDir, fetchImpl) {
  const byUrl = new Map();
  for (const book of books) if (book.iconUrl) byUrl.set(book.iconUrl, null);
  const byHash = new Map();
  for (const url of byUrl.keys()) {
    const response = await fetchImpl(url, { headers:{ 'user-agent':USER_AGENT, accept:'image/webp,image/png' } });
    if (!response.ok) throw new Error(`Failed to fetch Library icon ${url}: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 32 || bytes.length > 2_000_000) throw new Error(`Library icon has unsafe size: ${url}`);
    const type = String(response.headers?.get?.('content-type') || '');
    const isWebp = bytes.slice(0, 4).toString('ascii') === 'RIFF' && bytes.slice(8, 12).toString('ascii') === 'WEBP';
    const isPng = bytes.slice(1, 4).toString('ascii') === 'PNG';
    if (!isWebp && !isPng && !/image\/(?:webp|png)/i.test(type)) throw new Error(`Library icon is not PNG/WebP: ${url}`);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const ext = isWebp || /webp/i.test(type) ? 'webp' : 'png';
    const name = `${hash}.${ext}`;
    if (!byHash.has(hash)) { await fs.writeFile(path.join(iconDir, name), bytes); byHash.set(hash, name); }
    byUrl.set(url, name);
  }
  for (const book of books) {
    book.icon = book.iconUrl ? `icons/${byUrl.get(book.iconUrl)}` : null;
    delete book.iconUrl;
  }
  return byHash.size;
}

async function readPreviousCounts(outputDir) {
  const counts = {};
  for (const game of Object.keys(GAME_CONFIG)) {
    try { counts[game] = JSON.parse(await fs.readFile(path.join(outputDir, game, 'index.json'), 'utf8')).count || 0; } catch { counts[game] = 0; }
  }
  return counts;
}

async function replaceDirectory(staged, output) {
  const backup = output + `.backup-${process.pid}`;
  await fs.rm(backup, { recursive:true, force:true });
  try { await fs.rename(output, backup); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try {
    await fs.rename(staged, output);
    await fs.rm(backup, { recursive:true, force:true });
  } catch (error) {
    await fs.rm(output, { recursive:true, force:true });
    try { await fs.rename(backup, output); } catch {}
    throw error;
  }
}

export async function runLibrarySync({ rootDir = DEFAULT_ROOT, fetchImpl = fetch, now = () => new Date() } = {}) {
  const outputDir = path.resolve(rootDir, 'Database', 'Library');
  const stage = path.resolve(rootDir, 'Database', `.Library-stage-${process.pid}-${Date.now()}`);
  const previousCounts = await readPreviousCounts(outputDir);
  const generatedAt = now().toISOString();
  const report = { generatedAt, games:{}, files:0, icons:0 };
  await fs.rm(stage, { recursive:true, force:true });
  await fs.mkdir(stage, { recursive:true });
  try {
    const counts = {};
    for (const [game, cfg] of Object.entries(GAME_CONFIG)) {
      const categoryRows = (await Promise.all(cfg.categories.map((category) => enumerateCategory(cfg.api, category, fetchImpl)))).flat();
      const titles = [...new Set(categoryRows.map((row) => row.title).filter((title) => title && !/^(Book|Readable)$/i.test(title)))].sort((a, b) => a.localeCompare(b));
      const pages = await fetchPages(cfg.api, titles, fetchImpl);
      const books = pages.map((page) => pageToBook(game, page, generatedAt)).filter(Boolean);
      const deduped = [...new Map(books.map((book) => [book.id, book])).values()].sort((a, b) => a.name.localeCompare(b.name));
      const gameDir = path.join(stage, game);
      const iconDir = path.join(gameDir, 'icons');
      await fs.mkdir(iconDir, { recursive:true });
      const iconCount = await downloadIcons(deduped, iconDir, fetchImpl);
      for (const book of deduped) {
        const fileName = `${book.id}.json`;
        const output = { ...book };
        delete output.icon;
        await fs.writeFile(path.join(gameDir, fileName), JSON.stringify(output, null, 2) + '\n');
      }
      const index = {
        schemaVersion:1, game, generatedAt, count:deduped.length,
        entries:deduped.map((book) => ({ id:book.id, name:book.name, icon:book.icon, file:`${book.id}.json`, volumeCount:book.volumes.length, volumeLabels:book.volumes.map((volume) => volume.label), volumeKeys:book.volumes.map((volume) => volume.volumeKey) })),
      };
      await fs.writeFile(path.join(gameDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
      const searchIndex = buildLibrarySearchIndex(deduped, game, generatedAt);
      const searchJson = JSON.stringify(searchIndex) + '\n';
      await fs.writeFile(path.join(gameDir, 'search-index.json'), searchJson);
      counts[game] = deduped.length;
      report.games[game] = { count:deduped.length, volumes:deduped.reduce((sum, book) => sum + book.volumes.length, 0), icons:iconCount, searchWords:searchIndex.wordCount, searchBytes:Buffer.byteLength(searchJson) };
      report.files += deduped.length + 2;
      report.icons += iconCount;
    }
    enforceShrinkGuard(counts, previousCounts);
    await replaceDirectory(stage, outputDir);
    return report;
  } catch (error) {
    await fs.rm(stage, { recursive:true, force:true });
    throw error;
  }
}
