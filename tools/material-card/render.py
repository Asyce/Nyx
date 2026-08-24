# Renders a material card for every character in chars.json.
# Nothing here is per-character: everything comes from the extracted data, so a
# new character works as soon as it is in the shipped GI data.
import base64, io, json, math, os, sys
import numpy as np
from PIL import Image
from fontTools.ttLib import TTFont


REPO = r'C:\Pengo\Nyx-characters'
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('CARD_DATA', os.path.join(HERE, 'chars.json'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'cards.html')


TILE, BOSS, CLUSTER = 90, 56, 86


# ---- the one thing the database does not carry yet: where a local specialty
# grows. Keyed by item name so adding a character is a data edit, not a code one.
SITES_FILE = os.environ.get('SITES_FILE', os.path.join(HERE, 'sites.json'))
GATHER_SITES = (json.loads(io.open(SITES_FILE, encoding='utf-8').read())
                if os.path.exists(SITES_FILE) else {})


FRAME_DEFS = {
    1: dict(h=250, c=0.02, L=[0.44, 0.55, 0.66]),
    2: dict(h=158, c=0.10, L=[0.45, 0.57, 0.69]),
    3: dict(h=257, c=0.10, L=[0.45, 0.57, 0.69]),
    4: dict(h=288, c=0.10, L=[0.45, 0.57, 0.69], num=(0.80, 0.17, 294), num2=(0.62, 0.12, 294)),
    5: dict(h=68,  c=0.10, L=[0.58, 0.70, 0.82]),
}
ELEMENT_ACCENT = {
    'Cryo':'#9fe3ec', 'Hydro':'#7ac0f5', 'Pyro':'#f5a06a', 'Electro':'#c39bf0',
    'Anemo':'#8fe3c2', 'Geo':'#f0c46a', 'Dendro':'#a6d96a',
    'Ice':'#9fe3ec', 'Fire':'#f5a06a', 'Lightning':'#c39bf0', 'Wind':'#8fe3c2',
    'Physical':'#d8d3e8', 'Quantum':'#8f9bf0', 'Imaginary':'#f2d97a',
}




def oklch(L, C, H):
    rad = H * math.pi / 180
    a, b = C * math.cos(rad), C * math.sin(rad)
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    B = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    def ch(v):
        v = min(1.0, max(0.0, v))
        v = 12.92 * v if v <= 0.0031308 else 1.055 * (v ** (1 / 2.4)) - 0.055
        return '%02x' % round(v * 255)
    return '#' + ch(R) + ch(G) + ch(B)




def glow_gradient(base, peak=0.45):
    h = base.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    c = lambda a: 'rgba(%d,%d,%d,%s)' % (r, g, b, round(a, 4))
    stops = [(0, 1), (11, .9), (22, .74), (33, .55), (43, .38), (53, .24),
             (62, .14), (71, .07), (80, .03), (89, .009), (100, 0)]
    return 'radial-gradient(circle at center,' + ','.join(
        '%s %d%%' % (c(peak * m), p) for p, m in stops) + ')'




def frame(tier):
    d = FRAME_DEFS[max(1, min(5, int(tier or 1)))]
    mid = oklch(d['L'][1], d['c'], d['h'])
    return dict(top=oklch(d['L'][0], d['c'], d['h']), mid=mid,
                bot=oklch(d['L'][2], d['c'], d['h']), line=oklch(0.74, min(d['c'], 0.085), d['h']),
                eye=oklch(0.75, d['c'], d['h']), glow=glow_gradient(mid),
                num=oklch(*d.get('num', (0.90, min(d['c'], 0.105), d['h']))),
                num2=oklch(*d.get('num2', (0.70, min(d['c'], 0.07), d['h']))))




F = {t: frame(t) for t in FRAME_DEFS}


_HSR = TTFont(os.path.join(REPO, 'Site', 'assets', 'fonts', 'HSR.ttf'))
_CMAP, _HMTX, _UPEM = _HSR.getBestCmap(), _HSR['hmtx'], _HSR['head'].unitsPerEm
fit_size = lambda t, w: round(w / (sum(_HMTX[_CMAP.get(ord(c)) or '.notdef'][0]
                                       for c in t) / _UPEM), 2)


_CACHE = {}




def uri(rel):
    """Data-URI any asset the data points at, whatever its relative prefix."""
    if not rel:
        return None
    if rel in _CACHE:
        return _CACHE[rel]
    path = os.path.join(REPO, rel.replace('../../', '').replace('/', os.sep))
    if not os.path.exists(path):
        _CACHE[rel] = None
        return None
    mime = 'image/png' if path.lower().endswith('.png') else 'image/webp'
    with open(path, 'rb') as fh:
        _CACHE[rel] = 'data:%s;base64,%s' % (mime, base64.b64encode(fh.read()).decode('ascii'))
    return _CACHE[rel]




def _ink_box(im, alpha_min=24, coverage=0.004):
    """The bounding box of the actual art. A plain alpha bbox is no use here:
       one stray anti-aliased pixel holds a whole edge open, and most of these
       icons have exactly that. A row or column only counts as art once a small
       fraction of it is genuinely opaque."""
    a = np.asarray(im.getchannel('A'), dtype=np.uint8) > alpha_min
    h, w = a.shape
    rows = np.flatnonzero(a.sum(axis=1) > w * coverage)
    cols = np.flatnonzero(a.sum(axis=0) > h * coverage)
    if not rows.size or not cols.size:
        return None
    return (int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1)


def _square_on_subject(im):
    """A circle wants a square. Cropping the long side is unavoidable, but the
       browser would take it from the geometric middle, which slices the head
       off anything drawn off-centre. Take it around the art's centre of mass
       instead, so what survives is the creature."""
    w, h = im.size
    if w == h:
        return im
    side = min(w, h)
    a = np.asarray(im.getchannel('A'), dtype=np.float32)
    if w > h:
        mass = a.sum(axis=0)
        centre = float((mass * np.arange(w)).sum() / max(mass.sum(), 1))
        left = int(round(min(max(centre - side / 2, 0), w - side)))
        return im.crop((left, 0, left + side, h))
    mass = a.sum(axis=1)
    centre = float((mass * np.arange(h)).sum() / max(mass.sum(), 1))
    top = int(round(min(max(centre - side / 2, 0), h - side)))
    return im.crop((0, top, w, top + side))


def tile_uri(rel):
    """Zenless ships some item art as a sprite sheet - the weekly boss drop is
       one 2048px image holding ~130 copies of the same 156px icon, which drew
       as a grid of specks inside the tile. Anything unusually large is scanned
       for its first sprite: walk in from the edge to the first ink, then on to
       the first fully transparent line, and that span is one cell."""
    if not rel:
        return None
    key = 'tile::' + rel
    if key in _CACHE:
        return _CACHE[key]
    path = os.path.join(REPO, rel.replace('../../', '').replace('/', os.sep))
    if not os.path.exists(path):
        _CACHE[key] = None
        return None
    im = Image.open(path).convert('RGBA')
    if max(im.size) <= 512:
        _CACHE[key] = uri(rel)              # an ordinary icon, ship it untouched
        return _CACHE[key]
    a = np.asarray(im.getchannel('A')) > 8

    def first_run(v):
        ink = np.flatnonzero(v > 0)
        if not ink.size:
            return None
        start = int(ink[0])
        gap = np.flatnonzero(v[start:] == 0)
        return (start, start + int(gap[0])) if gap.size else (start, len(v))

    span_x, span_y = first_run(a.sum(axis=0)), first_run(a.sum(axis=1))
    if span_x and span_y and (span_x[1] - span_x[0]) < im.width * 0.5:
        im = im.crop((span_x[0], span_y[0], span_x[1], span_y[1]))
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=92, method=4)
    _CACHE[key] = 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')
    return _CACHE[key]


def circle_uri(rel):
    """A source portrait sits in a circle, so its art has to reach the rim. The
       shipped icons are 256px frames with the creature floating in the middle,
       which leaves a visible crescent of empty background. Trim to the art and
       let object-fit:cover scale it up until the circle is full."""
    if not rel:
        return None
    key = 'circle::' + rel
    if key in _CACHE:
        return _CACHE[key]
    path = os.path.join(REPO, rel.replace('../../', '').replace('/', os.sep))
    if not os.path.exists(path):
        _CACHE[key] = None
        return None
    im = Image.open(path).convert('RGBA')
    box = _ink_box(im)
    if box and box != (0, 0, im.width, im.height):
        im = im.crop(box)
    im = _square_on_subject(im)
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=90, method=4)
    _CACHE[key] = 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')
    return _CACHE[key]


def site_asset(name):
    return uri('Site/assets/' + name)




LOGO = site_asset('icon/nyx_logo.png')
EYE = site_asset('decor/nyx_eye_line.png')
FONT_GI = 'data:font/woff2;base64,' + base64.b64encode(
    open(os.path.join(HERE, 'fonts', 'GI-sub.woff2'), 'rb').read()).decode()
FONT_HSR = 'data:font/woff2;base64,' + base64.b64encode(
    open(os.path.join(HERE, 'fonts', 'HSR-sub.woff2'), 'rb').read()).decode()




def numbers(fam):
    """One figure per tier. A tile carrying several tiers tints its figures by
       rarity; a single-tier tile stays white. Where the game has a second
       target, the lower line sits underneath and prints only what moves;
       where it does not, there is no second line at all."""
    hi, lo, tiers = fam['qty'], fam.get('lo'), fam.get('tiers') or []
    if lo and list(map(str, lo)) == list(map(str, hi)):
        lo = None                      # nothing to add, so nothing to print
    multi = len(hi) > 1
    top, bottom = [], []
    for i, h in enumerate(hi):
        if i:
            top.append('<s>/</s>')
            bottom.append('<s class="r2 off">/</s>')
        t = tiers[i] if i < len(tiers) else 3
        style = ' style="color:%s"' % F[t]['num'] if multi else ''
        top.append('<i%s>%s</i>' % (style, h))
        alt = lo[i] if lo and i < len(lo) else h
        changed = str(alt) != str(h) and str(alt) not in ('0', '')
        s2 = ' style="color:%s"' % F[t]['num2'] if (multi and changed) else ''
        bottom.append('<i class="r2%s"%s>%s</i>' % ('' if changed else ' off', s2,
                                                    alt if changed else h))
    return ('<span class="nums" style="grid-template-columns:repeat(%d,auto)">%s%s</span>'
            # the second row is emitted even where every figure is hidden: it
            # is what keeps cells the same height, and the grid bottom-aligns
            # them, so dropping it lifts that tile above its neighbours
            % (len(top), ''.join(top), ''.join(bottom) if HAS_LOWER else ''))




def tile_cell(fam, col, row):
    f = F[max(1, min(5, int(fam.get('tier') or 3)))]
    icon = tile_uri(fam.get('icon'))
    if not icon:
        raise SystemExit('no icon for tile %r - check the currency item name '
                         'in the game profile' % fam.get('name'))
    return ('<span class="cell" style="grid-column:%d;grid-row:%d">'
            '<span class="tile" style="--top:%s;--mid:%s;--bot:%s;--line:%s;--eye:%s;--glow:%s">'
            '<span class="glow"></span><span class="eye"></span>'
            '<img src="%s" alt="%s"></span>%s</span>'
            % (col, row, f['top'], f['mid'], f['bot'], f['line'], f['eye'], f['glow'],
               icon, fam.get('name', ''), numbers(fam)))




def html_escape(s):
    return (str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def sources_head(fam, col, row=1, one_line=False, per_row=3):
    """No source recorded -> a "new" chip, since that nearly always means the
       item shipped before the wiki caught up. 1 -> a portrait. 2+ -> a cluster,
       and past what fits the last slot becomes a +N chip."""
    if (fam or {}).get('lines'):
        # the scraped caption wins: it names the domain, which is what a reader
        # needs, and it is never a guess the way a flavour-text face can be
        return lines_head(fam['lines'], col, cap=13)
    all_srcs = (fam or {}).get('sources', [])
    srcs = [s for s in all_srcs if s.get('icon')]
    if not srcs:
        if not fam:
            return ''
        if all_srcs:
            # we know where it comes from, we just have no portrait for it
            return ('<span class="hd newtag named" style="grid-column:%d;grid-row:%d">%s</span>'
                    % (col, row, all_srcs[0]['name']))
        if not CLAIMS_NEW:
            # this game records no sources at all, so a blank says nothing about
            # the item being new and the card must not pretend otherwise
            return ''
        return ('<span class="hd newtag" style="grid-column:%d;grid-row:%d">new</span>'
                % (col, row))
    # the big portrait belongs to the character block only; the weapon row
    # always uses the small cluster icons, however few there are
    if len(srcs) == 1 and not one_line:
        face = ('<span class="boss"><img src="%s" alt="%s"></span>'
                % (circle_uri(srcs[0]['icon']), html_escape(srcs[0]['name'])))
        if NAMES_BOSSES:
            # Zenless enemy art is a dark bust that reads as a smudge at 56px,
            # so the name goes under it - fitted to the tile like any caption
            face += lines_head([srcs[0]['name']], col, cap=11, bare=True)
        return ('<span class="hd bosswrap" style="grid-column:%d;grid-row:%d">%s</span>'
                % (col, row, face))
    # a weapon tile has room for a single line, so past what fits the last
    # slot becomes the +N; the character block can run to a second row.
    cap = (len(srcs) if len(srcs) <= per_row else per_row - 1) if one_line           else min(len(srcs), 8)
    shown, extra = srcs[:cap], len(srcs) - min(cap, len(srcs))
    grid, nested = shown[:6], shown[6:8]
    cells = ''.join('<span class="cm"><img src="%s" alt="%s"></span>'
                    % (circle_uri(s['icon']), s['name']) for s in grid)
    if extra > 0:
        cells += '<span class="cm more">+%d</span>' % extra
    cells += ''.join('<span class="cx cx%d"><img src="%s" alt=""></span>'
                     % (i + 1, circle_uri(s['icon'])) for i, s in enumerate(nested))
    slots = len(grid) + (1 if extra > 0 else 0)
    cols = min(per_row, slots)
    style = 'grid-column:%d;grid-row:%d;grid-template-columns:repeat(%d,1fr)' % (col, row, cols)
    if one_line:
        # size the strip so each icon lands at exactly the character cluster's
        # icon size, whatever the count - a fixed width would inflate them
        style += ';width:%.2fpx' % ((CLUSTER + 3) / per_row * cols - 3)
    return '<span class="hd cluster" style="%s">%s</span>' % (style, cells)




def lines_head(lines, col, cap=None, bare=False):
    """A caption above a tile, each line stretched to the tile's width. Genshin
       uses it for gather sites; Star Rail for the domain a material comes from
       - an element over a Stagnant Shadow, "Crimson Calyx" over a Path."""
    lines = [str(x) for x in (lines or []) if x]
    if not lines:
        return ''
    width = TILE - 4
    rows = ''
    for text in lines:
        fs = fit_size(text, width)
        if cap:
            fs = min(fs, cap)
        span = round(width * fs / fit_size(text, width), 2)
        h = round(fs * 1.12, 2)
        rows += ('<svg class="site" width="%s" height="%s" viewBox="0 0 %s %s">'
                 '<text x="%s" y="%s" text-anchor="middle" textLength="%s" '
                 'lengthAdjust="spacingAndGlyphs" font-size="%s">%s</text></svg>'
                 % (width, h, width, h, width / 2.0, round(fs * 0.95, 2), span, fs,
                    html_escape(text)))
    if bare:
        return '<span class="sites">%s</span>' % rows
    return '<span class="hd sites" style="grid-column:%d;grid-row:1">%s</span>' % (col, rows)


def sites_head(fam, col):
    # gather sites read shortest-first; a scraped caption keeps its given order
    return lines_head(sorted(GATHER_SITES.get((fam or {}).get('name', '')) or [], key=len), col)




def fitted_text(text, width, size, cls):
    """One centred line that never wraps and never overflows. GI has three
       talents and HSR four, so a fixed size wraps on one game and looks lost on
       the other; shrink to the column only when the text would not fit."""
    full = fit_size(text, width)          # the size at which it spans exactly width
    use = min(size, full)
    span = round(width * use / full, 2)   # what it actually measures at `use`
    h = round(use * 1.32, 2)
    return ('<svg class="%s" width="%s" height="%s" viewBox="0 0 %s %s">'
            '<text x="%s" y="%s" text-anchor="middle" textLength="%s" '
            'lengthAdjust="spacingAndGlyphs" font-size="%s">%s</text></svg>'
            % (cls, width, h, width, h, width / 2.0, round(use, 2), span, use, text))


def talents_head(ch, col):
    # only where the game has a talent target worth stating (see the profile);
    # elsewhere the build is always maxed and the row would be pure decoration
    if not SHOWS_TARGETS:
        return ''
    icons = ''.join('<span class="sk"><img src="%s" alt=""></span>' % uri(s)
                    for s in (ch.get('skills') or [])[:4] if uri(s))
    tg = ch.get('targets') or {}
    lines = fitted_text(tg.get('hi', '10 / 10 / 10'), TILE, 13, 'k hi')
    if tg.get('lo'):
        lines += fitted_text(tg['lo'], TILE, 11.5, 'k lo')
    return ('<span class="hd bar" style="grid-column:%d;grid-row:1">'
            '<span class="sks">%s</span>%s</span>' % (col, icons, lines))




def meta_icon(name):
    """Element and weapon/path chips, whichever extension the game ships."""
    if not name:
        return None
    slug = str(name).lower().replace(' ', '-')
    # elements are filed plainly; the other axis carries a prefix, and which
    # one depends on the game - HSR path_remembrance, ZZZ spec_anomaly
    for prefix in ('', 'path_', 'spec_'):
        hit = (site_asset('meta/%s/%s%s.webp' % (GAME, prefix, slug))
               or site_asset('meta/%s/%s%s.png' % (GAME, prefix, slug)))
        if hit:
            return hit
    return None


def brand_cell(col, row):
    return ('<span class="cell brand" style="grid-column:%d;grid-row:%d">'
            '<span class="brand-mark"><img src="%s" alt=""></span>'
            '<span class="nums" style="grid-template-columns:auto">'
            '<i class="brand-txt">pengo.gg</i>%s</span></span>'
            % (col, row, LOGO, '<i class="r2 off">0</i>' if HAS_LOWER else ''))




def weapon_section(w):
    if not w:
        return ''
    fams = w['families']
    tiles = ''.join(tile_cell(f, i + 1, 2) for i, f in enumerate(fams))
    # source clusters over the two enemy-drop families (positions 2 and 3)
    # the ascension domain is not an enemy - its "source" is the domain's own
    # name, which is already the tile - so only the drop families get a header.
    # Four tiers identifies it in Genshin; Star Rail has no such family at all.
    heads = ''.join('' if len(f.get('qty') or []) == 4
                    else sources_head(f, i + 1, row=1, one_line=True)
                    for i, f in enumerate(fams[:-2]))
    src = w.get('icon') or ''
    art = uri(src.replace('/icons/', '/gacha/')
                 .replace('UI_EquipIcon_', 'UI_Gacha_EquipIcon_')) or uri(src)
    # HSR ships a rectangular card image where GI ships a cut-out weapon
    shape = ' card' if '/lightcones/' in src else ''
    type_icon = meta_icon(w.get('type'))
    return ('<div class="wrow">'
            '<div class="whead">'
            '<span class="wart%s" style="background-image:url(%s)"></span>'
            '<b>%s</b>'
            '<span class="meta">%s<span class="lv">Lv @@LV@@</span></span>'
            '</div>'
            '<div class="wside"><div class="mats wmats">%s%s</div></div>'
            '</div>'
            % (shape, art, w['name'],
               ('<span class="chip"><img src="%s" alt=""></span>' % type_icon) if type_icon else '',
               heads, tiles))




def card_wide(ch):
    """For a character with more families than the standard layout has slots.
       The tile order and the width come from the data; the header-bearing tiles
       are placed first so they all land in the top row, under the header strip.
       Everything else - frames, numbers, captions - is the ordinary machinery."""
    tiles, cols = ch['tiles'], ch['cols']
    head = ch.get('headerCount') or 0
    parts = []
    for i, fam in enumerate(tiles[:head]):
        col = i % cols + 1
        # the specialty is the last of the header-bearing tiles, and it is the
        # one whose header is a place rather than a creature
        parts.append(sites_head(fam, col) if i == head - 1 else sources_head(fam, col))
    parts.append(talents_head(ch, cols))
    for i, fam in enumerate(tiles):
        parts.append(tile_cell(fam, i % cols + 1, 2 + i // cols))
    slot = len(tiles)
    parts.append(brand_cell(slot % cols + 1, 2 + slot // cols))
    return parts, cols


def card(ch):
    """Two rows of tiles under a row of source headers. The column count is
       whatever the game actually has: GI fills five, HSR has no gem and no
       local specialty and fills four."""
    f = ch['families']
    row_a = [f[k] for k in LAYOUT['rowA'] if f.get(k)]
    row_b = [f[k] for k in LAYOUT['rowB'] if f.get(k)]
    cols = max(len(row_a), len(row_b) + 1)
    # a header sits above its own tile, so headers follow row_a's order
    spec = f.get('specialty')
    # the talent block, where a game has one, occupies the last header column;
    # everything left of it belongs to the tile below it
    claimed = cols if SHOWS_TARGETS else None
    parts = [(sites_head(x, i + 1) if x is spec else sources_head(x, i + 1))
             for i, x in enumerate(row_a) if i + 1 != claimed]
    parts.append(talents_head(ch, cols))
    parts += [tile_cell(x, i + 1, 2) for i, x in enumerate(row_a)]
    parts += [tile_cell(x, i + 1, 3) for i, x in enumerate(row_b)]
    parts.append(brand_cell(cols, 3))
    if ch.get('tiles'):
        parts, cols = card_wide(ch)
    accent = ELEMENT_ACCENT.get(ch.get('element'), '#b7aaff')
    el_icon = meta_icon(ch.get('element'))
    wp_icon = meta_icon(ch.get('weaponType'))
    chips = ''.join('<span class="chip"><img src="%s" alt=""></span>' % i
                    for i in (el_icon, wp_icon) if i)
    return ('<div class="panel" style="--el:%s;--cols:%d"><span class="rim"></span><div class="body">'
            '<div class="top"><span class="ambient"></span>'
            '<span class="bleed" style="background-image:url(%s)"></span>'
            '<div class="hero"><div class="hero-txt"><b>%s</b>'
            '<span class="meta">%s<span class="lv">Lv @@LV@@</span></span></div></div>'
            '<div class="side"><div class="mats">%s</div></div></div>%s'
            '</div></div>'
            % (accent, cols, uri(ch['art']), ch['name'], chips, ''.join(parts),
               weapon_section(ch.get('weapon'))))




CSS = io.open(os.path.join(HERE, 'card.css'), encoding='utf-8').read()
_raw = json.loads(io.open(DATA, encoding='utf-8').read())
data = _raw['characters']
GAME = _raw.get('game', 'gi')
CLAIMS_NEW = _raw.get('claimsNew', True)
SHOWS_TARGETS = _raw.get('showsTargets', True)
LAYOUT = _raw.get('layout') or {'rowA': ['weekly', 'boss', 'common', 'specialty', 'books'],
                                'rowB': ['crown', 'gem', 'exp', 'mora']}
MAX_LEVEL = _raw.get('maxLevel', 90)
NAMES_BOSSES = _raw.get('namesBosses', False)
# the brand cell borrows a tile's number grid, so it needs the same row count
HAS_LOWER = any(f.get('lo') for ch in data if not ch.get('error')
                for f in ch['families'].values() if f)
cards = ''
for ch in data:
    if ch.get('error'):
        cards += '<p class="miss">%s &mdash; %s</p>' % (ch['name'], ch['error'])
        continue
    flags = []
    if ch.get('beta'):
        flags.append('beta data')
    boss = ch['families']['boss']
    # only worth saying when there IS a boss material whose source we lack;
    # a character with no boss drop at all is not missing anything
    if boss and not (boss.get('sources') or boss.get('lines')):
        flags.append('no boss source recorded')
    spec = ch['families'].get('specialty')
    if spec and not GATHER_SITES.get(spec['name']):
        flags.append('no gather sites recorded')
    if not ch.get('weapon'):
        flags.append('no signature %s' % ('light cone' if GAME == 'hsr' else 'weapon'))
    if ch.get('partial'):
        flags.append(ch['partial'])
    cards += ('<p class="lbl">%s<em>%s</em></p>%s'
              % (ch['name'], ('  &middot;  '.join(flags)) if flags else '', card(ch)))


# without the charset the browser guesses Windows-1252 and mangles every
# non-ASCII name - "Silver Wolf - Lv. 999", "Bija of Consciousness"
cards = cards.replace('@@LV@@', str(MAX_LEVEL))
html = ('<meta charset="utf-8">'
        '<title>Nyx material cards</title><style>%s</style>%s'
        % (CSS.replace('@@TILE@@', str(TILE)).replace('@@BOSS@@', str(BOSS))
              .replace('@@CLUSTER@@', str(CLUSTER)).replace('@@EYE@@', EYE)
              .replace('@@FONT_GI@@', FONT_GI).replace('@@FONT_HSR@@', FONT_HSR), cards))
io.open(OUT, 'w', encoding='utf-8').write(html)
print('wrote %s (%.2f MB) - %d cards' % (OUT, os.path.getsize(OUT) / 1048576.0, len(data)))
