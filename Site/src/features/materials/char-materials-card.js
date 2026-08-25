/* The Infographic card, rendered in the page.
 *
 * This is the browser half of tools/material-card. The offline pipeline is
 * still the design surface — extract.mjs works out the families and render.py
 * lays them out — but the layout below is a faithful port of render.py, driven
 * by the same data (baked at build time into cm-card-<game>.js) and the same
 * style sheet (card.css, baked into cm-card-style.js).
 *
 * Rendering happens by building the real markup, wrapping it in an SVG
 * <foreignObject> and drawing that into a canvas. The browser does the layout,
 * so gradients, masks and stretched SVG captions come out exactly as they do
 * offline — none of it has to be re-drawn by hand. The catch is that the
 * foreignObject is its own document: it cannot reach the page's stylesheets,
 * fonts or images, so every asset is inlined as a data URI first.
 *
 * Anything that fails here falls back to the older canvas card in
 * char-materials-share-card.js, so a browser that cannot do this still gets an
 * image. */

const NYX_CARD_TILE = 90;

/* ---------- palette: the same maths render.py uses ---------- */

const NYX_CARD_FRAME_DEFS = {
  1: { h:250, c:0.02, L:[0.44, 0.55, 0.66] },
  2: { h:158, c:0.10, L:[0.45, 0.57, 0.69] },
  3: { h:257, c:0.10, L:[0.45, 0.57, 0.69] },
  4: { h:288, c:0.10, L:[0.45, 0.57, 0.69], num:[0.80, 0.17, 294], num2:[0.62, 0.12, 294] },
  5: { h:68,  c:0.10, L:[0.58, 0.70, 0.82] },
};

const NYX_CARD_ELEMENT_ACCENT = {
  Cryo:'#9fe3ec', Hydro:'#7ac0f5', Pyro:'#f5a06a', Electro:'#c39bf0',
  Anemo:'#8fe3c2', Geo:'#f0c46a', Dendro:'#a6d96a',
  Ice:'#9fe3ec', Fire:'#f5a06a', Lightning:'#c39bf0', Wind:'#8fe3c2',
  Physical:'#d8d3e8', Quantum:'#8f9bf0', Imaginary:'#f2d97a',
};

function nyxCardOklch(L, C, H){
  const rad = H * Math.PI / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const ch = (v) => {
    const x = Math.min(1, Math.max(0, v));
    const y = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    return Math.round(y * 255).toString(16).padStart(2, '0');
  };
  return '#' + ch(R) + ch(G) + ch(B);
}

function nyxCardGlowGradient(base, peak = 0.45){
  const h = base.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const stops = [[0, 1], [11, .9], [22, .74], [33, .55], [43, .38], [53, .24],
    [62, .14], [71, .07], [80, .03], [89, .009], [100, 0]];
  const parts = stops.map(([p, mul]) =>
    `rgba(${r},${g},${b},${Math.round(peak * mul * 10000) / 10000}) ${p}%`);
  return 'radial-gradient(circle at center,' + parts.join(',') + ')';
}

const NYX_CARD_FRAMES = (() => {
  const out = {};
  for (const tier of Object.keys(NYX_CARD_FRAME_DEFS)) {
    const d = NYX_CARD_FRAME_DEFS[tier];
    const mid = nyxCardOklch(d.L[1], d.c, d.h);
    const num = d.num || [0.90, Math.min(d.c, 0.105), d.h];
    const num2 = d.num2 || [0.70, Math.min(d.c, 0.07), d.h];
    out[tier] = {
      top:nyxCardOklch(d.L[0], d.c, d.h),
      mid,
      bot:nyxCardOklch(d.L[2], d.c, d.h),
      line:nyxCardOklch(0.74, Math.min(d.c, 0.085), d.h),
      eye:nyxCardOklch(0.75, d.c, d.h),
      glow:nyxCardGlowGradient(mid),
      num:nyxCardOklch(num[0], num[1], num[2]),
      num2:nyxCardOklch(num2[0], num2[1], num2[2]),
    };
  }
  return out;
})();

const nyxCardFrame = (tier) => NYX_CARD_FRAMES[Math.max(1, Math.min(5, Number(tier) || 1))];

function nyxCardEscape(value){
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------- lazy data ---------- */

const NYX_CARD_LOADS = {};

function nyxCardLoadScript(src, key){
  if (NYX_CARD_LOADS[key]) return NYX_CARD_LOADS[key];
  NYX_CARD_LOADS[key] = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-nyx-card="' + key + '"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once:true });
      existing.addEventListener('error', () => reject(new Error('Failed to load ' + src)), { once:true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.nyxCard = key;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(script);
  });
  return NYX_CARD_LOADS[key];
}

async function nyxCardStyle(){
  if (!window.NYX_CARD_STYLE) await nyxCardLoadScript('../dist/cm-card-style.js', 'style');
  if (!window.NYX_CARD_STYLE) throw new Error('The card style sheet is unavailable.');
  return window.NYX_CARD_STYLE;
}

async function nyxCardPack(gameKey){
  const key = String(gameKey || '');
  if (!window.NYX_CARD_DATA?.[key]) await nyxCardLoadScript(`../dist/cm-card-${key}.js`, key);
  return window.NYX_CARD_DATA?.[key] || null;
}

async function nyxCardWeaponTable(pack, gameKey){
  // Endfield writes no table, so there is nothing to fetch and a request would
  // only 404 on every card
  if (!pack?.hasWeapons) return null;
  const key = String(gameKey || '');
  if (!window.NYX_CARD_WEAPONS?.[key]) {
    await nyxCardLoadScript(`../dist/cm-card-${key}-weapons.js`, key + ':weapons');
  }
  return window.NYX_CARD_WEAPONS?.[key] || null;
}

/* A character with element forms is several cards, one per element — Traveler,
   Trailblazer, Rover. The page hands us the active form, so address it the way
   the extractor filed it and fall back to the plain name. */
function nyxCardLookupKeys(view){
  // The pack is filed under the roster's English names. `n` is what the reader
  // sees, which a language preference rewrites and an identity choice renames
  // ("Aether", not "Traveler") — so every English spelling the view still
  // carries is tried before it. Most roster rows have no `rawName` at all, so
  // `englishName` is the one that saves a translated page.
  const names = [view?.englishName, view?.baseName, view?.rawName, view?.n]
    .map((x) => String(x || '')).filter(Boolean);
  const el = String(view?.el || '');
  const keys = [];
  if (el) for (const name of names) keys.push(`${name}:${el}`);
  keys.push(...names);
  return [...new Set(keys)];
}

/* Star Rail files its variants with a bullet — "Dan Heng • Imbibitor Lunae" —
   which the card's own display name drops, so an exact match on either spelling
   would miss the other. Matching on a flattened form catches both, along with
   ordinary casing and spacing drift. */
const nyxCardNormalise = (s) => String(s || '')
  .replace(/[•·]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

function nyxCardEntry(pack, view){
  if (!pack?.characters) return null;
  const keys = nyxCardLookupKeys(view);
  for (const key of keys) {
    if (pack.characters[key]) return { entry:pack.characters[key], key };
  }
  if (!pack.__loose) {
    const loose = new Map();
    for (const key of Object.keys(pack.characters)) {
      const flat = nyxCardNormalise(key);
      if (!loose.has(flat)) loose.set(flat, key);
    }
    Object.defineProperty(pack, '__loose', { value:loose, enumerable:false });
  }
  for (const key of keys) {
    const hit = pack.__loose.get(nyxCardNormalise(key));
    if (hit) return { entry:pack.characters[hit], key:hit };
  }
  return null;
}

/* ---------- asset inlining ---------- */

/* Inlined art is big — a splash alone runs to a few hundred KB of base64 — and
   the same icons come back on every card, so caching earns its keep. It is
   bounded because a reader working through a roster would otherwise accumulate
   every character's art for the life of the tab; oldest out first. */
const NYX_CARD_URI_CACHE = new Map();
const NYX_CARD_URI_CACHE_MAX = 240;

function nyxCardCacheSet(key, value){
  NYX_CARD_URI_CACHE.set(key, value);
  while (NYX_CARD_URI_CACHE.size > NYX_CARD_URI_CACHE_MAX) {
    const oldest = NYX_CARD_URI_CACHE.keys().next().value;
    if (oldest === undefined) break;
    NYX_CARD_URI_CACHE.delete(oldest);
  }
}

function nyxCardCanvas(w, h){
  const cvs = document.createElement('canvas');
  cvs.width = Math.max(1, Math.round(w));
  cvs.height = Math.max(1, Math.round(h));
  return cvs;
}

function nyxCardEncode(canvas){
  // WebP everywhere the browser has it: the splash art alone is most of the
  // payload and PNG roughly triples it. Safari before 14 falls back to PNG.
  const webp = canvas.toDataURL('image/webp', 0.92);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

/* The bounding box of the actual art. A plain alpha box is no use: one stray
   anti-aliased pixel holds a whole edge open, and most of these icons have
   exactly that. A row or column only counts once a small fraction of it is
   genuinely opaque. (render.py: _ink_box) */
function nyxCardInkBox(data, w, h, alphaMin = 24, coverage = 0.004){
  const rowHits = new Uint32Array(h);
  const colHits = new Uint32Array(w);
  for (let y = 0; y < h; y += 1) {
    const off = y * w * 4;
    for (let x = 0; x < w; x += 1) {
      if (data[off + x * 4 + 3] > alphaMin) { rowHits[y] += 1; colHits[x] += 1; }
    }
  }
  const span = (hits, n, limit) => {
    let lo = -1;
    let hi = -1;
    for (let i = 0; i < n; i += 1) if (hits[i] > limit) { if (lo < 0) lo = i; hi = i; }
    return lo < 0 ? null : [lo, hi + 1];
  };
  const cols = span(colHits, w, h * coverage);
  const rows = span(rowHits, h, w * coverage);
  if (!cols || !rows) return null;
  return [cols[0], rows[0], cols[1], rows[1]];
}

/* A circle wants a square. Cropping the long side is unavoidable, but taking it
   from the geometric middle slices the head off anything drawn off-centre, so
   take it around the art's centre of mass. (render.py: _square_on_subject) */
function nyxCardSquareOnSubject(data, w, h){
  if (w === h) return [0, 0, w, h];
  const side = Math.min(w, h);
  if (w > h) {
    let mass = 0;
    let weighted = 0;
    for (let x = 0; x < w; x += 1) {
      let column = 0;
      for (let y = 0; y < h; y += 1) column += data[(y * w + x) * 4 + 3];
      mass += column;
      weighted += column * x;
    }
    const centre = weighted / Math.max(mass, 1);
    const left = Math.round(Math.min(Math.max(centre - side / 2, 0), w - side));
    return [left, 0, side, h];
  }
  let mass = 0;
  let weighted = 0;
  for (let y = 0; y < h; y += 1) {
    let row = 0;
    for (let x = 0; x < w; x += 1) row += data[(y * w + x) * 4 + 3];
    mass += row;
    weighted += row * y;
  }
  const centre = weighted / Math.max(mass, 1);
  const top = Math.round(Math.min(Math.max(centre - side / 2, 0), h - side));
  return [0, top, w, side];
}

/* Zenless ships some item art as a sprite sheet — one 2048px image holding a
   hundred copies of the same icon, which draws as a grid of specks inside a
   tile. Walk in from the edge to the first ink, then on to the first fully
   transparent line: that span is one cell. (render.py: tile_uri) */
function nyxCardFirstSpriteCell(data, w, h){
  const colInk = new Uint8Array(w);
  const rowInk = new Uint8Array(h);
  for (let y = 0; y < h; y += 1) {
    const off = y * w * 4;
    for (let x = 0; x < w; x += 1) {
      if (data[off + x * 4 + 3] > 8) { colInk[x] = 1; rowInk[y] = 1; }
    }
  }
  const firstRun = (ink, n) => {
    let start = -1;
    for (let i = 0; i < n; i += 1) if (ink[i]) { start = i; break; }
    if (start < 0) return null;
    for (let i = start; i < n; i += 1) if (!ink[i]) return [start, i];
    return [start, n];
  };
  const spanX = firstRun(colInk, w);
  const spanY = firstRun(rowInk, h);
  if (spanX && spanY && (spanX[1] - spanX[0]) < w * 0.5) {
    return [spanX[0], spanY[0], spanX[1] - spanX[0], spanY[1] - spanY[0]];
  }
  return null;
}

function nyxCardPixels(image, w, h){
  const cvs = nyxCardCanvas(w, h);
  const ctx = cvs.getContext('2d', { willReadFrequently:true });
  ctx.drawImage(image, 0, 0, w, h);
  return { ctx, data:ctx.getImageData(0, 0, w, h).data };
}

/* mode: 'plain' ships the art as-is, 'tile' pulls one cell out of a sprite
   sheet, 'circle' trims to the art and squares it on its subject. */
async function nyxCardUri(rel, mode = 'plain'){
  if (!rel) return null;
  const key = mode + '::' + rel;
  if (NYX_CARD_URI_CACHE.has(key)) return NYX_CARD_URI_CACHE.get(key);
  const promise = (async () => {
    // data: URIs (the logo) are already inline
    if (String(rel).startsWith('data:')) return rel;
    const image = await nyxMaterialsCardLoadImage(rel);
    if (!image) return null;
    const w = image.naturalWidth;
    const h = image.naturalHeight;
    if (!w || !h) return null;
    try {
      if (mode === 'plain' || (mode === 'tile' && Math.max(w, h) <= 512)) {
        const cvs = nyxCardCanvas(w, h);
        cvs.getContext('2d').drawImage(image, 0, 0);
        return nyxCardEncode(cvs);
      }
      if (mode === 'tile') {
        const { data } = nyxCardPixels(image, w, h);
        const cell = nyxCardFirstSpriteCell(data, w, h);
        const [sx, sy, sw, sh] = cell || [0, 0, w, h];
        const cvs = nyxCardCanvas(sw, sh);
        cvs.getContext('2d').drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
        return nyxCardEncode(cvs);
      }
      // circle
      const { data } = nyxCardPixels(image, w, h);
      const box = nyxCardInkBox(data, w, h) || [0, 0, w, h];
      const cw = box[2] - box[0];
      const chh = box[3] - box[1];
      const trimmed = nyxCardCanvas(cw, chh);
      trimmed.getContext('2d').drawImage(image, box[0], box[1], cw, chh, 0, 0, cw, chh);
      const inner = nyxCardPixels(trimmed, cw, chh);
      const [qx, qy, qw, qh] = nyxCardSquareOnSubject(inner.data, cw, chh);
      const out = nyxCardCanvas(qw, qh);
      out.getContext('2d').drawImage(trimmed, qx, qy, qw, qh, 0, 0, qw, qh);
      return nyxCardEncode(out);
    } catch (error) {
      // a tainted canvas: nothing can be read back, so this asset is lost. The
      // card is still worth drawing without it.
      return null;
    }
  })();
  nyxCardCacheSet(key, promise);
  return promise;
}

/* ---------- text fitting ---------- */

/* The font size at which a string spans exactly `width`. render.py reads the
   advance widths straight out of the font; measureText is the same figure, so
   long as the measuring face is the one render.py measured with (HSR).
 *
 * The canvas has to belong to the stage's document — "HSRui" is declared by
 * card.css, which only ever lives there, so a canvas from the page would
 * measure a fallback face and size every caption a little wrong. */
let nyxCardMeasureCtx = null;
function nyxCardUseMeasureDoc(doc){
  const canvas = doc.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  nyxCardMeasureCtx = canvas.getContext('2d');
}
function nyxCardFitSize(text, width){
  nyxCardMeasureCtx.font = '400 100px "HSRui", sans-serif';
  const advance = nyxCardMeasureCtx.measureText(String(text)).width / 100;
  return advance > 0 ? Math.round((width / advance) * 100) / 100 : width;
}

/* One centred line that never wraps and never overflows. (render.py:
   fitted_text / lines_head both build this shape.) */
function nyxCardSvgText(text, width, size, cls){
  const full = nyxCardFitSize(text, width);
  const use = Math.min(size, full);
  const span = Math.round(width * (use / full) * 100) / 100;
  const h = Math.round(use * 1.32 * 100) / 100;
  return `<svg class="${cls}" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">`
    + `<text x="${width / 2}" y="${Math.round(use * 100) / 100}" text-anchor="middle" `
    + `textLength="${span}" lengthAdjust="spacingAndGlyphs" font-size="${use}">`
    + `${nyxCardEscape(text)}</text></svg>`;
}

/* A caption above a tile, each line stretched to the tile's width. Genshin uses
   it for gather sites; Star Rail for the domain a material comes from. */
function nyxCardLinesHead(lines, col, cap, bare){
  const rows = (lines || []).filter(Boolean).map(String);
  if (!rows.length) return '';
  const width = NYX_CARD_TILE - 4;
  const body = rows.map((text) => {
    const full = nyxCardFitSize(text, width);
    const fs = cap ? Math.min(full, cap) : full;
    const span = Math.round(width * (fs / full) * 100) / 100;
    const h = Math.round(fs * 1.12 * 100) / 100;
    return `<svg class="site" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">`
      + `<text x="${width / 2}" y="${Math.round(fs * 0.95 * 100) / 100}" text-anchor="middle" `
      + `textLength="${span}" lengthAdjust="spacingAndGlyphs" font-size="${fs}">`
      + `${nyxCardEscape(text)}</text></svg>`;
  }).join('');
  if (bare) return `<span class="sites">${body}</span>`;
  return `<span class="hd sites" style="grid-column:${col};grid-row:1">${body}</span>`;
}

/* ---------- the card ---------- */

/* One figure per tier. A tile carrying several tiers tints its figures by
   rarity; a single-tier tile stays white. Where the game has a second target
   the lower line sits underneath and prints only what moves. */
function nyxCardNumbers(fam, ctxOpts){
  const hi = fam.qty || [];
  let lo = fam.lo || null;
  const tiers = fam.tiers || [];
  if (lo && lo.map(String).join('|') === hi.map(String).join('|')) lo = null;
  const multi = hi.length > 1;
  const top = [];
  const bottom = [];
  hi.forEach((h, i) => {
    if (i) {
      top.push('<s>/</s>');
      bottom.push('<s class="r2 off">/</s>');
    }
    const frame = nyxCardFrame(i < tiers.length ? tiers[i] : 3);
    const style = multi ? ` style="color:${frame.num}"` : '';
    top.push(`<i${style}>${nyxCardEscape(h)}</i>`);
    const alt = lo && i < lo.length ? lo[i] : h;
    const changed = String(alt) !== String(h) && String(alt) !== '0' && String(alt) !== '';
    const s2 = multi && changed ? ` style="color:${frame.num2}"` : '';
    bottom.push(`<i class="r2${changed ? '' : ' off'}"${s2}>${nyxCardEscape(changed ? alt : h)}</i>`);
  });
  // A four-tier ladder prints eleven characters where a three-tier one prints
  // eight; at the standard size that overruns the tile.
  const width = hi.reduce((sum, x) => sum + String(x).length, 0) + hi.length - 1;
  const scale = width > 8 ? `;font-size:${Math.round(Math.min(1, 8 / width) * 100)}%` : '';
  // the second row is emitted even where every figure is hidden: it is what
  // keeps cells the same height, and the grid bottom-aligns them
  return `<span class="nums" style="grid-template-columns:repeat(${top.length},auto)${scale}">`
    + top.join('') + (ctxOpts.hasLower ? bottom.join('') : '') + '</span>';
}

function nyxCardTileCell(fam, col, row, cap, ctxOpts){
  const f = nyxCardFrame(fam.tier || 3);
  const icon = ctxOpts.uris.get('tile::' + fam.icon);
  if (!icon) return '';
  // In a wide layout a caption cannot live in the header strip, because the
  // tiles run over several rows — so it rides inside the cell instead. Every
  // cell reserves the slot, or tiles in one row would sit at different levels.
  const head = cap
    ? `<span class="cap">${nyxCardLinesHead(fam.lines, col, 10, true) || ''}</span>`
    : '';
  return `<span class="cell${cap ? ' capped' : ''}" style="grid-column:${col};grid-row:${row}">${head}`
    + `<span class="tile" style="--top:${f.top};--mid:${f.mid};--bot:${f.bot};`
    + `--line:${f.line};--eye:${f.eye};--glow:${f.glow}">`
    + '<span class="glow"></span><span class="eye"></span>'
    + `<img src="${icon}" alt="${nyxCardEscape(fam.name)}"></span>`
    + nyxCardNumbers(fam, ctxOpts) + '</span>';
}

/* No source recorded -> a "new" chip, since that nearly always means the item
   shipped before the wiki caught up. 1 -> a portrait. 2+ -> a cluster, and past
   what fits the last slot becomes a +N chip. */
function nyxCardSourcesHead(fam, col, row, oneLine, perRow, ctxOpts){
  perRow = perRow || 3;
  row = row || 1;
  if (fam?.lines?.length) return nyxCardLinesHead(fam.lines, col, 13, false);
  const all = fam?.sources || [];
  const srcs = all.filter((s) => s.icon && ctxOpts.uris.get('circle::' + s.icon));
  if (!srcs.length) {
    if (!fam) return '';
    if (all.length) {
      // we know where it comes from, we just have no portrait for it
      return `<span class="hd newtag named" style="grid-column:${col};grid-row:${row}">`
        + `${nyxCardEscape(all[0].name)}</span>`;
    }
    // a game that records no sources at all says nothing about an item being
    // new, and the card must not pretend otherwise
    if (!ctxOpts.claimsNew) return '';
    return `<span class="hd newtag" style="grid-column:${col};grid-row:${row}">new</span>`;
  }
  const uri = (s) => ctxOpts.uris.get('circle::' + s.icon);
  // the big portrait belongs to the character block only; the weapon row always
  // uses the small cluster icons, however few there are
  if (srcs.length === 1 && !oneLine) {
    let face = `<span class="boss"><img src="${uri(srcs[0])}" alt="${nyxCardEscape(srcs[0].name)}"></span>`;
    // Zenless enemy art is a dark bust that reads as a smudge at 56px, so the
    // name goes under it — fitted to the tile like any caption
    if (ctxOpts.namesBosses) face += nyxCardLinesHead([srcs[0].name], col, 11, true);
    return `<span class="hd bosswrap" style="grid-column:${col};grid-row:${row}">${face}</span>`;
  }
  const cap = oneLine
    ? (srcs.length <= perRow ? srcs.length : perRow - 1)
    : Math.min(srcs.length, 8);
  const shown = srcs.slice(0, cap);
  // only the weapon strip counts what it dropped: the character cluster is a
  // picture of where a material comes from, not an inventory
  const extra = oneLine ? srcs.length - cap : 0;
  const grid = shown.slice(0, 6);
  const nested = shown.slice(6, 8);
  let cells = grid.map((s) =>
    `<span class="cm"><img src="${uri(s)}" alt="${nyxCardEscape(s.name)}"></span>`).join('');
  if (extra > 0) cells += `<span class="cm more">+${extra}</span>`;
  cells += nested.map((s, i) =>
    `<span class="cx cx${i + 1}"><img src="${uri(s)}" alt=""></span>`).join('');
  const slots = grid.length + (extra > 0 ? 1 : 0);
  const cols = Math.min(perRow, slots);
  let style = `grid-column:${col};grid-row:${row};grid-template-columns:repeat(${cols},1fr)`;
  if (oneLine) {
    // size the strip so each icon lands at exactly the character cluster's icon
    // size, whatever the count — a fixed width would inflate them
    const width = (ctxOpts.cluster + 3) / perRow * cols - 3;
    style += `;width:${Math.round(width * 100) / 100}px`;
  }
  return `<span class="hd cluster" style="${style}">${cells}</span>`;
}

// gather sites read shortest-first; a scraped caption keeps its given order
const nyxCardSitesHead = (fam, col) => nyxCardLinesHead(fam?.sites, col, null, false);

/* Only where the game has a talent target worth stating; elsewhere the build is
   always maxed and the row would be pure decoration. */
function nyxCardTalentsHead(ch, col, ctxOpts){
  if (!ctxOpts.showsTargets) return '';
  const icons = (ch.skills || []).slice(0, 4)
    .map((s) => ctxOpts.uris.get('plain::' + s))
    .filter(Boolean)
    .map((uri) => `<span class="sk"><img src="${uri}" alt=""></span>`)
    .join('');
  const tg = ch.targets || {};
  let lines = nyxCardSvgText(tg.hi || '10 / 10 / 10', NYX_CARD_TILE, 13, 'k hi');
  if (tg.lo) lines += nyxCardSvgText(tg.lo, NYX_CARD_TILE, 11.5, 'k lo');
  return `<span class="hd bar" style="grid-column:${col};grid-row:1">`
    + `<span class="sks">${icons}</span>${lines}</span>`;
}

function nyxCardBrandCell(col, row, ctxOpts){
  return `<span class="cell brand" style="grid-column:${col};grid-row:${row}">`
    + `<span class="brand-mark"><img src="${ctxOpts.logo}" alt=""></span>`
    + '<span class="nums" style="grid-template-columns:auto">'
    + '<i class="brand-txt">pengo.gg</i>'
    + (ctxOpts.hasLower ? '<i class="r2 off">0</i>' : '')
    + '</span></span>';
}

function nyxCardWeaponSection(w, ctxOpts){
  if (!w) return '';
  const fams = w.families || [];
  const tiles = fams.map((f, i) => nyxCardTileCell(f, i + 1, 2, false, ctxOpts)).join('');
  // Genshin's weapon ascension domain is not an enemy — its "source" is the
  // domain's own name, which the tile already shows — so it gets no header.
  // Four tiers identifies it there; elsewhere four tiers is just how the game
  // builds a family, and skipping those leaves every weapon bare.
  const skipDomain = ctxOpts.game === 'gi';
  const heads = fams.slice(0, -2).map((f, i) =>
    (skipDomain && (f.qty || []).length === 4)
      ? ''
      : nyxCardSourcesHead(f, i + 1, 1, true, 3, ctxOpts)).join('');
  const art = ctxOpts.uris.get('plain::' + w.art);
  const typeIcon = ctxOpts.uris.get('plain::' + w.typeIcon);
  return '<div class="wrow"><div class="whead">'
    + `<span class="wart${w.shape || ''}"${art ? ` style="background-image:url(${art})"` : ''}></span>`
    + `<b>${nyxCardEscape(w.name)}</b>`
    + '<span class="meta">'
    + (typeIcon ? `<span class="chip"><img src="${typeIcon}" alt=""></span>` : '')
    + `<span class="lv">Lv ${ctxOpts.maxLevel}</span></span>`
    + `</div><div class="wside"><div class="mats wmats">${heads}${tiles}</div></div></div>`;
}

/* For a character with more families than the standard layout has slots. The
   tile order and the width come from the data; the header-bearing tiles are
   placed first so they all land in the top row. */
function nyxCardWideParts(ch, ctxOpts){
  const tiles = ch.tiles || [];
  const cols = ch.cols || 1;
  const head = ch.headerCount || 0;
  const parts = [];
  for (let i = 0; i < head && i < tiles.length; i += 1) {
    const col = (i % cols) + 1;
    // the specialty is the last of the header-bearing tiles, and it is the one
    // whose header is a place rather than a creature
    parts.push(i === head - 1
      ? nyxCardSitesHead(tiles[i], col)
      : nyxCardSourcesHead(tiles[i], col, 1, false, 3, ctxOpts));
  }
  parts.push(nyxCardTalentsHead(ch, cols, ctxOpts));
  // caption inside the cell when any tile past the header strip carries one
  const inline = tiles.slice(head).some((f) => f.lines?.length);
  tiles.forEach((fam, i) => {
    parts.push(nyxCardTileCell(fam, (i % cols) + 1, 2 + Math.floor(i / cols), inline, ctxOpts));
  });
  const slot = tiles.length;
  parts.push(nyxCardBrandCell((slot % cols) + 1, 2 + Math.floor(slot / cols), ctxOpts));
  return { parts, cols };
}

/* Two rows of tiles under a row of source headers. The column count is whatever
   the game actually has: GI fills five, HSR has no gem and no local specialty
   and fills four. */
function nyxCardMarkup(ch, ctxOpts){
  const f = ch.families || {};
  const rowA = (ctxOpts.layout.rowA || []).filter((k) => f[k]).map((k) => f[k]);
  const rowB = (ctxOpts.layout.rowB || []).filter((k) => f[k]).map((k) => f[k]);
  let cols = Math.max(rowA.length, rowB.length + 1);
  const spec = f.specialty;
  // the talent block, where a game has one, occupies the last header column
  const claimed = ctxOpts.showsTargets ? cols : null;
  let parts = [];
  rowA.forEach((x, i) => {
    if (i + 1 === claimed) return;
    parts.push(x === spec
      ? nyxCardSitesHead(x, i + 1)
      : nyxCardSourcesHead(x, i + 1, 1, false, 3, ctxOpts));
  });
  parts.push(nyxCardTalentsHead(ch, cols, ctxOpts));
  parts = parts.concat(rowA.map((x, i) => nyxCardTileCell(x, i + 1, 2, false, ctxOpts)));
  parts = parts.concat(rowB.map((x, i) => nyxCardTileCell(x, i + 1, 3, false, ctxOpts)));
  parts.push(nyxCardBrandCell(cols, 3, ctxOpts));
  if (ch.tiles?.length) {
    const wide = nyxCardWideParts(ch, ctxOpts);
    parts = wide.parts;
    cols = wide.cols;
  }
  const accent = NYX_CARD_ELEMENT_ACCENT[ch.element] || '#b7aaff';
  const chips = [ctxOpts.uris.get('plain::' + ch.elIcon), ctxOpts.uris.get('plain::' + ch.wpIcon)]
    .filter(Boolean)
    .map((uri) => `<span class="chip"><img src="${uri}" alt=""></span>`)
    .join('');
  const art = ctxOpts.uris.get('plain::' + ch.art);
  return `<div class="panel" style="--el:${accent};--cols:${cols}"><span class="rim"></span><div class="body">`
    + '<div class="top"><span class="ambient"></span>'
    + `<span class="bleed"${art ? ` style="background-image:url(${art})"` : ''}></span>`
    + `<div class="hero"><div class="hero-txt"><b>${nyxCardEscape(ctxOpts.title)}</b>`
    + `<span class="meta">${chips}<span class="lv">Lv ${ctxOpts.maxLevel}</span></span></div></div>`
    + `<div class="side"><div class="mats">${parts.join('')}</div></div></div>`
    + nyxCardWeaponSection(ch.weapon, ctxOpts)
    + '</div></div>';
}

/* ---------- assembly ---------- */

/* Every asset the markup will ask for, in the mode it will ask for it in.
   Collected up front so they can be fetched in parallel and looked up
   synchronously while the markup is built. */
function nyxCardAssetPlan(ch){
  const plan = [];
  const add = (rel, mode) => { if (rel) plan.push([rel, mode]); };
  add(ch.art, 'plain');
  add(ch.elIcon, 'plain');
  add(ch.wpIcon, 'plain');
  (ch.skills || []).slice(0, 4).forEach((s) => add(s, 'plain'));
  const fams = [
    ...Object.values(ch.families || {}),
    ...(ch.tiles || []),
    ...(ch.weapon?.families || []),
  ].filter(Boolean);
  for (const fam of fams) {
    add(fam.icon, 'tile');
    (fam.sources || []).forEach((s) => add(s.icon, 'circle'));
  }
  if (ch.weapon) {
    add(ch.weapon.art, 'plain');
    add(ch.weapon.typeIcon, 'plain');
  }
  const seen = new Set();
  return plan.filter(([rel, mode]) => {
    const key = mode + '::' + rel;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* The dim second line, where the game spends it on a combined total: what the
   character and the weapon cost together. Families pair by the material they
   hold, so only shared tiles carry a second figure. (extract.mjs:
   addWeaponTotals — repeated here because the weapon can change after the
   build.) */
function nyxCardWeaponTotals(ch, weapon, lowerMode){
  // Genshin spends its lower line on the one-below-max talent build instead, and
  // those figures are baked. Touching them here would erase the 9/9/9 column.
  if (lowerMode !== 'withWeapon') return;
  const byLookup = new Map();
  for (const f of weapon?.families || []) if (f.lookup) byLookup.set(f.lookup, f);
  const money = (weapon?.families || []).find((f) => typeof f.raw === 'number');
  const fams = [...Object.values(ch.families || {}), ...(ch.tiles || [])].filter(Boolean);
  for (const fam of fams) {
    delete fam.lo;
    if (typeof fam.raw === 'number' && money) {
      fam.lo = [nyxCardMora(fam.raw + money.raw)];
      continue;
    }
    const mate = fam.lookup ? byLookup.get(fam.lookup) : null;
    if (!mate) continue;
    fam.lo = fam.qty.map((q, i) => Number(q) + Number(mate.qty[i] ?? 0));
  }
}

/* Byte-for-byte the extractor's `mora`, because a recomputed figure sits in the
   same row as baked ones and any difference in grouping would show. */
const nyxCardMora = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : Number(n).toLocaleString('de-DE'));

async function nyxCardBuildHtml({ gameKey, view, activeWeapon, measureDoc }){
  nyxCardUseMeasureDoc(measureDoc);
  const style = await nyxCardStyle();
  const pack = await nyxCardPack(gameKey);
  const found = pack && nyxCardEntry(pack, view);
  if (!found) throw new Error('No card data for this character.');
  // a deep copy: the lower line is rewritten per weapon, and the pack is shared
  const ch = JSON.parse(JSON.stringify(found.entry));

  // The page's weapon picker wins. The signature is already baked in, so only a
  // deliberate swap pays for the weapon table — and a character shown with no
  // weapon at all loses the band, exactly as the offline sheet does.
  const wanted = String(activeWeapon?.name || '');
  if (!wanted) {
    ch.weapon = null;
    nyxCardWeaponTotals(ch, null, pack.lowerMode);
  } else if (ch.weapon?.name !== wanted) {
    const table = await nyxCardWeaponTable(pack, gameKey).catch(() => null);
    const swap = table?.[wanted];
    // no entry for it (an Endfield weapon, or one the game has not costed):
    // keep the signature rather than showing a band the figures do not match
    if (swap) {
      ch.weapon = JSON.parse(JSON.stringify(swap));
      nyxCardWeaponTotals(ch, ch.weapon, pack.lowerMode);
    }
  }

  const plan = nyxCardAssetPlan(ch);
  const loaded = await Promise.all(plan.map(async ([rel, mode]) => [mode + '::' + rel, await nyxCardUri(rel, mode)]));
  const uris = new Map(loaded.filter(([, uri]) => uri));

  // The page decides what this character is called — Aether, not Traveler — and
  // the element rides along when the card is one form of several.
  const formEl = found.key.includes(':') ? found.key.split(':')[1] : '';
  const shown = String(view?.n || ch.name || '');
  const title = formEl ? `${shown} (${formEl})` : shown;

  const ctxOpts = {
    game:pack.game,
    layout:pack.layout || { rowA:[], rowB:[] },
    maxLevel:pack.maxLevel || 90,
    claimsNew:!!pack.claimsNew,
    showsTargets:!!pack.showsTargets,
    namesBosses:!!pack.namesBosses,
    hasLower:!!pack.hasLower,
    cluster:style.cluster || 86,
    logo:style.logo,
    uris,
    title,
  };
  return nyxCardMarkup(ch, ctxOpts);
}

/* The card's two faces are declared by card.css, which is not part of the page
   until the stage carries it. Captions are sized by measuring text (see
   nyxCardFitSize), so the faces have to be loaded before the markup is built —
   measuring against a fallback face would size every caption slightly wrong. */
async function nyxCardEnsureFonts(doc){
  if (!doc.fonts?.load) return;
  await Promise.race([
    Promise.all([
      doc.fonts.load('400 100px "HSRui"'),
      doc.fonts.load('400 100px "GI"'),
    ]).then(() => doc.fonts.ready),
    new Promise((resolve) => setTimeout(resolve, 4000)),
  ]);
}

/* Lay the markup out for real, then hand the browser the same tree inside an
   SVG <foreignObject> and draw it.
 *
 * The stage is an iframe, not a div. card.css is a whole page's style sheet —
 * it styles `body`, and `.top`, `.meta`, `.cell` and `.chip` are names the
 * character page uses too — so dropping it into the document would restyle the
 * page under the reader for as long as the render takes. An iframe is its own
 * document: nothing leaks either way, and its fonts are the ones the measuring
 * canvas needs. It has to be on-screen-sized and not display:none, or the
 * content has no layout; it is parked off to the side instead. */
async function nyxCardRasterize(build, css, scale){
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('title', '');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:2400px;height:1400px;'
    + 'border:0;pointer-events:none;opacity:0;z-index:-1';
  document.body.appendChild(frame);
  try {
    const idoc = frame.contentDocument;
    if (!idoc) throw new Error('The card stage could not be created.');
    idoc.open();
    idoc.write('<!doctype html><meta charset="utf-8"><body></body>');
    idoc.close();
    const sheet = idoc.createElement('style');
    sheet.textContent = css;
    idoc.head.appendChild(sheet);
    const shell = idoc.createElement('div');
    shell.className = 'cardroot';
    // The offline sheet is a whole page, so the body shrink-wraps its one card
    // on its own. Here the shell is a div in a 2400px stage and would measure
    // the stage instead, padding the image out with empty space.
    shell.style.width = 'max-content';
    idoc.body.appendChild(shell);

    await nyxCardEnsureFonts(idoc);
    shell.innerHTML = await build(idoc);
    const rect = shell.getBoundingClientRect();
    const w = Math.ceil(rect.width);
    const h = Math.ceil(rect.height);
    if (!w || !h) throw new Error('The card measured as empty.');
    const markup = new XMLSerializer().serializeToString(shell);
    // The foreignObject is parsed as XML, so a bare "<" or "&" anywhere in the
    // style sheet — a comment mentioning a tag is enough — makes the whole
    // document malformed and the image silently fails to load. CDATA keeps the
    // CSS verbatim; the only sequence it cannot carry is its own terminator.
    const safeCss = String(css).split(']]>').join(']]]]><![CDATA[>');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`
      + '<foreignObject width="100%" height="100%">'
      + `<div xmlns="http://www.w3.org/1999/xhtml"><style><![CDATA[${safeCss}]]></style>${markup}</div>`
      + '</foreignObject></svg>';
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('The card image could not be rasterised.'));
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
    if (image.decode) { try { await image.decode(); } catch (error) {} }
    const canvas = nyxCardCanvas(w * scale, h * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(image, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The card image could not be encoded.');
    return blob;
  } finally {
    frame.remove();
  }
}

/* The entry point the button calls. Throws if this character has no card data
   or the browser cannot rasterise, and the caller falls back to the older
   canvas renderer. */
async function nyxRenderCharacterCard({ gameKey, view, activeWeapon, scale = 2 }){
  // the style sheet is fetched first so the stage can carry it while the markup
  // is being built — see nyxCardEnsureFonts
  const style = await nyxCardStyle();
  return nyxCardRasterize(
    (measureDoc) => nyxCardBuildHtml({ gameKey, view, activeWeapon, measureDoc }),
    style.css,
    scale,
  );
}

if (typeof window !== 'undefined') {
  Object.assign(window, { nyxRenderCharacterCard, nyxCardPack });
}
