// Pulls everything a material card needs out of the shipped data (live + beta)
// and writes it as JSON. Implements the collapsing ruleset:
//   - a "family" is a set of items sharing a source list and an id run
//   - each family renders as its top tier's icon, with one figure per tier
//   - EXP packs collapse to their top-tier equivalent
//
// Two games, one engine. Everything below the profile is shared; the profile
// says only where the data lives and which families that game has.
import fs from 'node:fs';
import vm from 'node:vm';

const REPO = 'C:/Pengo/Nyx-characters';
const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SITE = `${REPO}/Site`;
const GAME = (process.env.CARD_GAME || 'gi').toLowerCase();
const PROFILE = {
  // Per-game switches. Everything else is read from the game's own data.
  //
  //   claimsNew    a missing source means "too new to be catalogued". True only
  //                where the game normally records sources at all: Genshin
  //                does, so a blank there is real news; the others do not, so a
  //                blank says nothing and the card must not imply otherwise.
  //   showsTargets the talent block exists - skill icons and level figures.
  //                Only Genshin, which is the one game with a real choice to
  //                report: the last talent level is what costs a Crown.
  //   lowerMode    what the dim second figure under a tile means. 'talents' is
  //                the one-below-max build; 'withWeapon' is the character and
  //                the signature weapon together.
  //   layout       the tile order, since not every game has the same families.
  //   dbDir        where Database/GameData keeps this game, when the folder is
  //                not named after the game key - Wuthering Waves is 'ww'.
  //   alwaysWide   the game has more families than any fixed layout holds, so
  //                every card gets an explicit tile order (§4a).
  //   maxLevel     the level the card is costed to. Genshin and Star Rail cap
  //                at 90, Zenless at 60.
  //
  // The currency's name and icon are deliberately NOT here: every game ships
  // its own as cfg.cur / cfg.curIcon, so reading them is shorter and cannot
  // point a Star Rail card at Genshin's Mora coin.
  gi:  { weaponWord:'weapon',   maxLevel:90,
         claimsNew:true,  showsTargets:true,  lowerMode:'talents',
         layout:{ rowA:['weekly', 'boss', 'common', 'specialty', 'books'],
                  rowB:['crown', 'gem', 'exp', 'mora'] } },
  hsr: { weaponWord:'light cone', maxLevel:90,
         claimsNew:false, showsTargets:false, lowerMode:'withWeapon',
         layout:{ rowA:['weekly', 'boss', 'books', 'common'],
                  rowB:['crown', 'exp', 'mora'] } },
  // namesBosses: print the source's name under its portrait. Zenless enemy art
  // is a small dark bust that reads as a smudge at 56px, so the name earns its
  // line there in a way it does not in the other two games.
  zzz: { weaponWord:'W-Engine', maxLevel:60, namesBosses:true,
         claimsNew:false, showsTargets:false, lowerMode:'withWeapon',
         layout:{ rowA:['weekly', 'boss', 'gem', 'books'],
                  rowB:['crown', 'exp', 'mora'] } },
  wuwa:{ weaponWord:'weapon', maxLevel:90, dbDir:'ww',
         claimsNew:false, showsTargets:false, lowerMode:'withWeapon',
         layout:{ rowA:['weekly', 'boss', 'common', 'books'],
                  rowB:['specialty', 'exp', 'mora'] } },
  ae:  { weaponWord:'weapon', maxLevel:80, alwaysWide:true,
         claimsNew:false, showsTargets:false, lowerMode:'withWeapon',
         layout:{ rowA:[], rowB:[] } },
}[GAME];
if (!PROFILE) throw new Error(
  `unknown CARD_GAME '${GAME}' (expected gi, hsr, zzz, wuwa or ae)`);
const DB = PROFILE.dbDir || GAME;

const ctx = { window:{ addEventListener(){}, dispatchEvent(){} }, CustomEvent:class{},
              document:{ addEventListener(){} }, console };
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of [`src/data/generated/cm-data-${GAME}.js`,
                 `src/data/generated/cm-data-${GAME}-beta.js`,
                 'src/features/materials/char-materials-leveling.js']) {
  // not every game ships a beta pack
  const path = `${SITE}/${f}`;
  if (fs.existsSync(path)) vm.runInContext(fs.readFileSync(path, 'utf8'), ctx);
}
const live = (ctx.window.CM_CFG || ctx.CM_CFG || {})[GAME];
const beta = (ctx.window.CM_CFG_BETA || {})[GAME] || {};
const LEVELING = vm.runInContext('NYX_MATERIALS_LEVELING', ctx)[GAME];

// EXP per pack, read out of the item text rather than hard-coded: both games
// state it ("Gives 20,000 EXP", "Provides <unbreak>6000</unbreak> Light Cone
// EXP"). This is what turns 12/11/415 into a single "419 Hero's Wit".
const EXP_VALUE = new Map();
const CURRENCY = String(live?.cur || 'Currency');
const CURRENCY_ICON = live?.curIcon || null;
// the frame colour is the money's own rarity - Shell Credit is blue, Mora gold
let CURRENCY_TIER = 3;

// Where each Star Rail material comes from, scraped from the wiki's item
// infobox by `scrape-sites.mjs --hsr`. The game data records nothing at all, so
// this file is what turns four blank header slots into captions and a portrait.
// Which nation each Forgery Challenge sits in, scraped by
// `scrape-sites.mjs --wuwa`. The challenge's own name is long and says little;
// the nation is what a reader is actually navigating by.
const WW_WIKI = (() => {
  const path = `${HERE}/ww-nations.json`;
  const raw = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : {};
  return { nations:raw.nations || {}, families:raw.families || {} };
})();
const WW_NATIONS = WW_WIKI.nations;

// How many distinct items name each source. A specific enemy shows up on a
// handful; a game mode or a shop - "Forgery Challenge", "Souvenir Store" -
// shows up on hundreds, and is a place rather than something to draw.
const SOURCE_USE = (() => {
  const count = new Map();
  for (const stage of ['live', 'beta']) {
    const path = `${REPO}/Database/GameData/${DB}/${stage}/items.json`;
    if (!fs.existsSync(path)) continue;
    const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
    const rows = Array.isArray(raw) ? raw : (raw.items || Object.values(raw)[0] || []);
    for (const it of rows)
      for (const s of (Array.isArray(it.source) ? it.source : []))
        count.set(String(s), (count.get(String(s)) || 0) + 1);
  }
  return count;
})();
const isPlace = (name) => (SOURCE_USE.get(String(name)) || 0) > 20;

const WIKI_SOURCES = (() => {
  const path = `${HERE}/hsr-sources.json`;
  return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : {};
})();
// Beta packs ship placeholder names - Robin Summeretto's weekly is literally
// "..." - so fall back to the item database, which already knows the real one.
const ITEM_NAME = new Map();
// How many distinct item names each long word appears in. A boss's proper noun
// shows up once or twice; the game's own vocabulary shows up everywhere.
const WORD_USE = new Map();
const PLACEHOLDER = /^[.…\s?-]*$/;
// "Silver Wolf - Lv. 999" ships with a bullet separator that lands at the start
// of the second line once the name wraps. The space alone reads better.
const displayName = (n) => String(n || '').replace(/\s*•\s*/g, ' ').trim();
const realName = (it) => {
  const shipped = String(it?.name || '').replace(/<[^>]*>/g, '').trim();
  if (shipped && !PLACEHOLDER.test(shipped)) return shipped;
  return ITEM_NAME.get(String(it?.id || '')) || shipped;
};

// Weekly-boss entries in sourceDetails carry a name but no icon, so fall back to
// the monster database, which indexes every monster by both name and title.
const MONSTERS = (() => {
  const index = new Map();
  for (const stage of ['live', 'beta']) {
    const path = `${REPO}/Database/GameData/${DB}/${stage}/monsters.json`;
    if (!fs.existsSync(path)) continue;
    const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
    const rows = Array.isArray(raw) ? raw : (raw.monsters || Object.values(raw)[0] || []);
    for (const m of rows) {
      const icon = m?.assets?.icon;
      if (!icon) continue;
      const rel = `../../Database/${icon.replace(/^GameData/, 'GameData')}`;
      for (const key of [m.name, m.title]) if (key)
        index.set(String(key).toLowerCase(), { icon:rel, name:String(key) });
    }
  }
  return index;
})();

// Weekly-boss materials are mapped to a boss *display* name that the monster
// database does not use: "Mirror of Mushin" resolves to "Everlasting Lord of
// Arcane Wisdom", which the DB files under "Shouki no Kami, the Prodigal".
// generate-site-data.mjs already carries that alias table, so read it from there
// rather than keeping a second copy.
// HSR names its weekly drops after the Echo of War *stage*, not the monster,
// and the monster database has no row under that name. generate-site-data.mjs
// carries the id -> stage mapping, so read it and use it as a caption: the
// ruleset's "named, but no portrait" case, which GI never actually reaches.
const HSR_STAGE_NAMES = (() => {
  const map = new Map();
  if (GAME !== 'hsr') return map;
  const src = fs.readFileSync(`${SITE}/tools/generate-site-data.mjs`, 'utf8');
  const block = src.match(/const HSR_BOSS_NAMES = \{([\s\S]*?)\n\};/);
  for (const line of (block ? block[1] : '').split('\n')) {
    const m = line.match(/(\d+)\s*:\s*['"`](.+?)['"`]/);
    if (m) map.set(m[1], m[2]);
  }
  return map;
})();

const WEEKLY_ALIASES = (() => {
  if (GAME !== 'gi') return new Map();
  const src = fs.readFileSync(`${SITE}/tools/generate-site-data.mjs`, 'utf8');
  const block = src.match(/const GI_WEEKLY_BOSS_SPECS = \[([\s\S]*?)\n\];/);
  const map = new Map();
  if (!block) return map;
  for (const line of block[1].split('\n')) {
    const boss = line.match(/bossName:\s*['"`](.+?)['"`]/);
    if (!boss) continue;
    const aliases = [...line.matchAll(/artAliases:\s*\[([^\]]*)\]/g)]
      .flatMap((m) => [...m[1].matchAll(/['"`](.+?)['"`]/g)].map((x) => x[1]));
    map.set(boss[1].toLowerCase(), aliases);
  }
  return map;
})();


const ITEM_DESC = (() => {
  const map = new Map();
  for (const stage of ['live', 'beta']) {
    const path = `${REPO}/Database/GameData/${DB}/${stage}/items.json`;
    if (!fs.existsSync(path)) continue;
    const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
    const rows = Array.isArray(raw) ? raw : (raw.items || Object.values(raw)[0] || []);
    for (const it of rows) {
      if (!it?.id) continue;
      // HSR only names the source enemy in the flavour text, so both fields go in
      map.set(String(it.id), `${it.description || ''} ${it.backgroundDescription || ''}`);
      // the beta pack overwrites 110509's real name with "...", so a
      // placeholder must never displace a name we already have
      if (it.name && !PLACEHOLDER.test(String(it.name)))
        ITEM_NAME.set(String(it.id), String(it.name));
      if (it.name === CURRENCY && Number(it.rarity)) CURRENCY_TIER = Number(it.rarity);
      for (const tok of new Set(String(it.name || '').toLowerCase().split(/[^a-z0-9]+/)))
        if (tok.length >= 7) WORD_USE.set(tok, (WORD_USE.get(tok) || 0) + 1);
      // "Gives 20,000 EXP", "Provides <unbreak>6000</unbreak> Light Cone EXP",
      // "Provides 1,000 Resonator EXP" - the qualifier is whatever the game
      // calls its own experience, so allow any words before EXP
      const exp = /(?:Gives|Provides)\s*(?:<unbreak>)?\s*([\d,]+)\s*(?:<\/unbreak>)?(?:\s+[A-Za-z]+){0,3}\s+EXP/i
        .exec(it.description || '');
      if (exp) EXP_VALUE.set(it.name, Number(exp[1].replace(/,/g, '')));
    }
  }
  return map;
})();
const MONSTER_NAMES = [...MONSTERS.keys()].filter((n) => n.length >= 8)
  .sort((a, b) => b.length - a.length);

// Reduce a name to space-separated words, padded, so one can be tested for
// inside another without a regex - and so no escaping can go wrong on a name
// like 'Asat Pramad: "Existence"'.
const spaced = (s) => ' ' + String(s).toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim() + ' ';

function resolveIcon(name) {
  const key = String(name || '').toLowerCase();
  const direct = MONSTERS.get(key);
  if (direct) return direct.icon;
  // The wiki names a boss plainly; the database decorates it. The plain name
  // can sit anywhere inside the decorated one and in any dress:
  //   Irontomb    -> "Irontomb, Anti-Nous, Funeral of Gnosis"   (leading)
  //   Asat Pramad -> "Lord of Samvartasthayi, Asat Pramad"      (trailing)
  //   Feixiao     -> "Maddened Feixiao", 'Shadow of "Feixiao"'  (adjective, quotes)
  // So look for the name as a whole word anywhere in the title. Matching a
  // comma-delimited segment - what this used to do - missed every decorated
  // form, which is why Castorice's weekly had no face.
  if (key.length >= 5) {
    const needle = spaced(key);
    let best = null;
    for (const [full, entry] of MONSTERS) {
      if (!spaced(full).includes(needle)) continue;
      // the shortest title is the boss itself; the longer ones are its phases
      // ('Asat Pramad: "Existence"') or its stage dressing
      if (!best || full.length < best.full.length) best = { full, entry };
    }
    if (best) return best.entry.icon;
  }
  for (const alias of WEEKLY_ALIASES.get(key) || []) {
    const hit = MONSTERS.get(alias.toLowerCase());
    if (hit) return hit.icon;
  }
  return null;
}

// Monsters indexed by their distinctive proper nouns, so an item can be matched
// to a boss the database names differently: the Icewind Suite is titled
// "Nemesis of Coppelius", and its drop is "Artificed Spare Clockwork Component
// - Coppelius". A shared 7+ character token is specific enough to trust.
// Only a token that belongs to exactly one monster is usable. "Coppelius"
// identifies the Icewind Suite; "eternal" appears in half a dozen HSR names and
// happily matched Castorice's Eternal Lament to a Lance of the Eternal Freeze.
// Ambiguous tokens are dropped rather than guessed at.
const MONSTER_TOKENS = (() => {
  const map = new Map();
  const ambiguous = new Set();
  for (const entry of MONSTERS.values()) {
    for (const tok of new Set(entry.name.toLowerCase().split(/[^a-z0-9]+/))) {
      // A word the game reuses across many item names is vocabulary, not a
      // name. "Coppelius" names two items and identifies a boss; "Specialized"
      // names 121, and matched a Specialized Anomaly Component to a
      // Specialized Assault Bomber. Four sits far above one and far below the
      // other.
      if (tok.length < 7 || (WORD_USE.get(tok) || 0) >= 4) continue;
      // compare by portrait, not by name: the database lists "Shape Shifter"
      // twice, once tagged (Bug), and that alone made "shifter" look ambiguous
      const prev = map.get(tok);
      if (prev && prev.icon !== entry.icon) ambiguous.add(tok);
      else if (!prev) map.set(tok, entry);
    }
  }
  for (const tok of ambiguous) map.delete(tok);
  return map;
})();

function sourceFromTokens(item) {
  for (const tok of String(item?.name || '').toLowerCase().split(/[^a-z0-9]+/)) {
    const hit = tok.length >= 7 ? MONSTER_TOKENS.get(tok) : null;
    if (hit) return { name:hit.name, icon:hit.icon };
  }
  return null;
}

/** Last resort for a family with no sources at all: read the item's own text.
    Only for things a monster actually drops - trace books and EXP come out of
    domains, and letting them match a name in their flavour text put a Calyx
    boss's face on Kafka's light cone. */
const DROPPED_BY_MONSTERS = new Set(['mob', 'boss', 'weekly', 'gem', 'specialty']);
function sourceFromDescription(item) {
  if (!DROPPED_BY_MONSTERS.has(item?.kind)) return null;
  const desc = (ITEM_DESC.get(String(item?.id || '')) || '').toLowerCase();
  if (!desc) return null;
  const entry = MONSTERS.get(MONSTER_NAMES.find((n) => desc.includes(n)));
  return entry ? { name:entry.name, icon:entry.icon } : null;
}

const roster = [...(live.roster || []), ...(beta.roster || [])];
const weapons = [...(live.weapons || []), ...(beta.weapons || [])];
// A name can appear twice: HSR ships Robin Summeretto as an empty placeholder
// in the live pack and the real thing in the beta pack. Take the one with data.
const find = (name) => {
  // "Traveler:Anemo" addresses one elemental form. The roster entry carries a
  // `forms` array - 14 of them, complete materials each, male and female
  // identical - so a form is a first-class character, not a variant to merge.
  const [base, form] = String(name).split(':');
  const want = String(base).toLowerCase();
  const hits = roster.filter((c) => String(c.n || c.rawName || '').toLowerCase() === want);
  const parent = hits.find((c) => c.req?.ascension?.length) || hits[0];
  if (!form || !parent?.forms?.length) return parent;
  const f = parent.forms.find((x) => String(x.el || '').toLowerCase() === form.toLowerCase()
                                     && x.req?.ascension?.length);
  return f ? { ...parent, ...f, n:`${parent.n} (${f.el})` } : null;
};

const srcKey = (it) => (it.sourceDetails || []).map((s) => s.name).join('|');
// Group on the source list alone. `kind` is unreliable - the shipped data tags
// one tier of some weapon families as 'gem' while its siblings are 'weapon',
// which used to split the family. Only fall back to kind when a family has no
// source at all (specialty, crown), where it is the only thing separating them.
const bySource = (items) => {
  const groups = new Map();
  for (const it of items) {
    const k = srcKey(it) || `kind::${it.kind}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  // Within a group, walk the items in id order and break the run wherever the
  // rarity stops climbing. A family is a rarity ladder, so a repeat or a drop
  // can only mean a second family has started - which is what separates
  // Tulaytullah's two fungal lines, both drawn from the same enemies.
  //
  // Do NOT also require consecutive ids. Genshin numbers a family 1 apart but
  // Zenless numbers it 10 apart, and the adjacency test shattered every Zenless
  // family into singletons.
  const runs = [];
  for (const g of groups.values()) {
    const sorted = g.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
    let run = [sorted[0]];
    for (const it of sorted.slice(1)) {
      if (it.rar > run[run.length - 1].rar) run.push(it);
      else { runs.push(run); run = [it]; }
    }
    runs.push(run);
  }
  return runs.map((g) => g.sort((a, b) => a.rar - b.rar));
};

/** Sources for a family, keeping any we can name even when we have no portrait.
    Unioned across every tier: GI records the same list on all of them, but HSR
    records none at all and each tier names a different enemy in its flavour
    text, so the union is what produces a cluster instead of a lone face. */
/** "Clamorlings or Tranquilites" is two enemies in one entry. Split those, so
    each can be looked up and drawn on its own. */
const splitNames = (name) => String(name).split(/\s+or\s+|\s*\/\s*/)
  .map((s) => s.trim()).filter(Boolean);

/** An enemy family named where the database keeps individual monsters. The
    wiki's category for it lists the members; draw the ones we have art for. */
function familyMembers(name) {
  const members = WW_WIKI.families[name] || [];
  const out = [];
  for (const m of members) {
    // "Exile (Enemy)" disambiguates the page, not the monster
    const clean = m.replace(/\s*\(Enemy\)\s*$/i, '').trim();
    const icon = resolveIcon(clean);
    if (icon && !out.some((x) => x.icon === icon)) out.push({ name:clean, icon });
  }
  return out;
}

function sourcesFor(items) {
  const out = [];
  const seen = new Set();
  const add = (s) => {
    const key = (s.icon || s.name || '').toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };
  for (const it of items) {
    const listed = (it.sourceDetails || [])
      .filter((s) => s.icon || !isPlace(s.name))
      .flatMap((s) => splitNames(s.name).flatMap((n, i) => {
        // A family wins over a single face, even one the data handed us:
        // "Exile" is both one enemy and a group of three, and the group is
        // what drops the material. Checking this only when the data gave us
        // nothing left Exile as a lone icon.
        const members = familyMembers(n);
        if (members.length > 1) return members;
        // the shipped icon belongs to the whole entry, so only the first of a
        // split name may claim it
        const icon = (i === 0 && s.icon) || resolveIcon(n);
        return [{ name:n, icon: icon || null }];
      }));
    if (listed.length) { listed.forEach(add); continue; }
    const guessed = sourceFromDescription(it)
      || (DROPPED_BY_MONSTERS.has(it.kind) ? sourceFromTokens(it) : null);
    if (guessed) { add(guessed); continue; }
    const stage = HSR_STAGE_NAMES.get(String(it.id));
    if (stage) add({ name:stage, icon:resolveIcon(stage) || null });
  }
  return out;
}

/** The caption above a tile. Two lines where the game splits the source in two:
    an element and the Stagnant Shadow that drops it, or the Calyx type and the
    Path it feeds. Echo of War entries become a portrait instead, when the wiki
    names the boss and the monster database has art for it. */
function wikiHeader(top, ch) {
  const hit = top ? WIKI_SOURCES[realName(top)] : null;
  if (!hit) return {};
  // the wiki is authoritative here, so it clears whatever the description
  // matcher guessed: a caption naming the actual domain beats a face scraped
  // out of flavour text, and mixing the two put both in one slot.
  const caption = (lines) => ({ lines, sources:[] });
  if (hit.kind === 'shadow') return caption([ch?.el, hit.name].filter(Boolean));
  if (hit.kind === 'calyx') return caption(['Crimson Calyx', hit.name]);
  if (hit.kind === 'echo') {
    // try each name the page mentions, in order, and take the first with art
    for (const boss of hit.bosses || (hit.boss ? [hit.boss] : [])) {
      const icon = resolveIcon(boss);
      if (icon) return { lines:null, sources:[{ name:boss, icon }] };
    }
    return caption([hit.name]);
  }
  return caption([hit.name]);
}

/** A source that is a place rather than a creature reads as a caption, not a
    face. Zenless records "Combat Simulation - Agent Promotion", which is a mode
    and a mode within it; stacking the two halves says what a blank slot or a
    single cramped line cannot. Only applies when the family has no art at all,
    so a boss with a portrait is never demoted to text. */
function domainLines(sources) {
  if (!sources.length || sources.some((s) => s.icon)) return null;
  const parts = sources[0].name.split(/\s+[-/]\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts : null;
}

/** Sum duplicate ids, so a material billed by both ascension and talents lands
    in one entry before anything reads the ladders. */
const sumIds = (items) => {
  const acc = new Map();
  for (const it of items) {
    const prev = acc.get(String(it.id));
    acc.set(String(it.id), prev ? { ...prev, qty:prev.qty + it.qty } : { ...it });
  }
  return [...acc.values()];
};

/** A rarity ladder in id order, ignoring the source list. Wuthering Waves
    records a different source for the lower two tiers of a family than for the
    upper two - the weak ones also drop from a Forgery Challenge - so grouping
    on the source splits every family in half. The ladder is the real shape. */
const byLadder = (items) => {
  const sorted = [...items].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const runs = [];
  let run = [];
  for (const it of sorted) {
    if (run.length && it.rar <= run[run.length - 1].rar) { runs.push(run); run = []; }
    run.push(it);
  }
  if (run.length) runs.push(run);
  return runs;
};

/** A width that fills its rows evenly: 15 cells go 5x3, not 7+7+1. */
const gridCols = (cells) => {
  const rows = cells <= 12 ? 2 : 3;
  return Math.max(4, Math.ceil(cells / rows));
};

// a family: top-tier icon, one figure per tier, plus its shared source list.
// An absent family is null, not an empty shell - Pyro Traveler genuinely has no
// weekly boss material, and the card should leave that column out.
const family = (items, extra = {}) => {
  if (!items || !items.length) return null;
  const top = items[items.length - 1];
  const found = sourcesFor(items);
  const asLines = domainLines(found);
  if (asLines) return {
    name: items.length > 1 ? `${realName(top)} family` : realName(top),
    icon: top.icon, tier: top.rar,
    tiers: items.map((i) => i.rar),
    qty: items.map((i) => i.qty),
    sources: [], lines: asLines,
    rawSources: [...new Set(items.flatMap((i) => (i.sourceDetails || []).map((s) => s.name)))],
    lookup: realName(top),
    ...extra,
  };
  return {
    name: items.length > 1 ? `${realName(top)} family` : realName(top),
    icon: top.icon, tier: top.rar,
    tiers: items.map((i) => i.rar),
    qty: items.map((i) => i.qty),
    sources: found,
    // every name the data listed, before places were filtered and captions
    // replaced them - the scrapers key off this
    rawSources: [...new Set(items.flatMap((i) => (i.sourceDetails || []).map((s) => s.name)))],
    lookup: realName(top),
    ...extra,
  };
};

// Talent totals with the top `drop` levels shaved off every talent. drop=0 is
// the maxed build; drop=1 is one level below max on each. Expressed this way
// rather than as an absolute level because the two games cap differently -
// GI is 10/10/10, HSR is 6/10/10/10 - and the data already knows which.
function talentTotals(ch, drop) {
  const acc = new Map(); let cost = 0;
  for (const talent of ch.req?.talentStages || []) {
    for (const lvl of drop ? talent.slice(0, Math.max(0, talent.length - drop)) : talent) {
      cost += lvl.cost || 0;
      for (const it of lvl.items || []) {
        const prev = acc.get(it.name);
        acc.set(it.name, prev ? { ...prev, qty:prev.qty + it.qty } : { ...it });
      }
    }
  }
  return { items:[...acc.values()], cost };
}

const expEquivalent = (items) => {
  const total = items.reduce((sum, it) => sum + (EXP_VALUE.get(it.name) || 0) * it.qty, 0);
  const top = items.reduce((a, b) => (a.rar >= b.rar ? a : b));
  const unit = EXP_VALUE.get(top.name);
  if (!unit) throw new Error(`no EXP value found in the item text for ${top.name}`);
  return { icon:top.icon, tier:top.rar, tiers:[top.rar],
           qty:[Math.ceil(total / unit)], name:`${top.name} equivalent`, sources:[] };
};

const mora = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M`
                              : n.toLocaleString('de-DE'));

function buildCharacterGI(name) {
  const ch = find(name);
  if (!ch) return { name, error:'not in roster' };
  // announced but not shipped: the roster carries the entry with nothing in it
  if (!ch.req?.ascension?.length) return { name, error:'no material data yet' };
  const asc = ch.req?.ascension || [];
  const max = talentTotals(ch, 0);
  const nine = talentTotals(ch, 1);
  const lvl = LEVELING.character;

  const pick = (arr, kind) => arr.filter((i) => i.kind === kind);

  // Classify ascension families by shape and source, never by `kind`: the data
  // tags the odd tier wrongly (Neuvillette's r2 enemy drop is marked 'gem'),
  // which would otherwise give a five-tier gem family and a two-tier common one.
  const ascGroups = bySource(asc);
  const gemGroup = ascGroups.find((g) => g.length === 4) || pick(asc, 'gem');
  const commonAsc = ascGroups.find((g) => g.length === 3) || [];
  const commonKey = commonAsc.length ? srcKey(commonAsc[0]) : null;
  // Whatever is left over once the gems, the enemy trio and the specialty are
  // accounted for is the ascension boss drop. Neither `kind` nor the presence of
  // a source can be relied on: Arlecchino's is tagged 'gem', Navia's has no
  // source recorded at all.
  const claimed = new Set([gemGroup, commonAsc]);
  const bossDrop = ascGroups.find((g) => !claimed.has(g) && g.length === 1
                                          && g[0].kind !== 'specialty');

  // the same enemy family reappears in the talent bill; match it by source
  const talGroup = (items, key) =>
    key ? (bySource(items).find((g) => srcKey(g[0]) === key) || []) : [];
  const commonTal = talGroup(max.items, commonKey);
  const commonNine = talGroup(nine.items, commonKey);

  // ascension + talents share the common enemy family, so add them tier by tier
  const merge = (a, b) => {
    const byName = new Map();
    for (const it of [...a, ...b]) {
      const prev = byName.get(it.name);
      byName.set(it.name, prev ? { ...prev, qty:prev.qty + it.qty } : { ...it });
    }
    return [...byName.values()].sort((x, y) => x.rar - y.rar);
  };
  const common = merge(commonAsc, commonTal);
  const commonAt9 = merge(commonAsc, commonNine);

  // Talent books first by kind, and only then by shape. Selecting purely on
  // "a three-run that is not the common family" put Traveler's Forbidden Curse
  // Scrolls - an enemy drop - in the books slot and dropped the real books
  // altogether, because the roster merges every elemental form and so carries
  // two enemy lines and three book lines at once.
  // Every distinct book line, biggest first. Most characters have exactly one;
  // Traveler has three, because each of its talents draws a different series,
  // and Geo has six because it draws from two nations at once.
  const bookGroups = (items) => {
    const groups = bySource(items);
    const total = (g) => g.reduce((s, i) => s + i.qty, 0);
    const tagged = groups.filter((g) => g.every((i) => i.kind === 'book'));
    if (tagged.length) return tagged.sort((a, b) => total(b) - total(a));
    const shaped = groups.find((g) => g.length === 3 && srcKey(g[0]) !== commonKey);
    return shaped ? [shaped] : [pick(items, 'book').sort((a, b) => a.rar - b.rar)];
  };
  // Every enemy family too. The normal `common` above stays exactly as it was -
  // this is only consulted when a character turns out to have more than one.
  // A domain reads as "Equity - Fontaine - Pale Forgotten Glory"; a creature
  // list reads as "Hilichurl,Hilichurl Fighter,...". That tells a book line
  // from an enemy line without touching `kind`, which cannot be trusted here:
  // Hydro Traveler's middle enemy tier is tagged 'gem' and Pyro's weekly is
  // tagged 'specialty'.
  const isDomain = (g) => srcKey(g[0]).includes(' - ');
  const sumById = (items) => {
    const acc = new Map();
    for (const it of items) {
      const prev = acc.get(String(it.id));
      acc.set(String(it.id), prev ? { ...prev, qty:prev.qty + it.qty } : { ...it });
    }
    return [...acc.values()];
  };
  // An enemy line is a rarity ladder drawn from named creatures. A lone item is
  // the ascension boss drop, which has its own slot - counting it as a second
  // enemy family put 118 of 120 characters on the wide layout.
  // the gem ladder also lists creatures - the elemental bosses that drop it -
  // so it has to be named out, or every character looks like it has two
  // enemy families
  const gemKey = gemGroup && gemGroup.length ? srcKey(gemGroup[0]) : null;
  const mobFamilies = (items) =>
    bySource(sumById(items)).filter((g) => g.length > 1 && srcKey(g[0]) && !isDomain(g)
                                           && srcKey(g[0]) !== gemKey);
  const allCommon = mobFamilies([...asc, ...max.items]);
  const allCommon9 = mobFamilies([...asc, ...nine.items]);
  const allBooks = bookGroups(max.items).filter((g) => g.length);
  const allBooks9 = bookGroups(nine.items).filter((g) => g.length);
  const books = allBooks[0] || [];
  const books9 = allBooks9[0] || [];
  const weekly = pick(max.items, 'weekly');
  const weekly9 = pick(nine.items, 'weekly');
  const crown = pick(max.items, 'crown');
  const crown9 = pick(nine.items, 'crown');
  // One tile per family assumes one family per slot. Rather than guess from
  // kinds - the ascension boss drop is tagged 'mob' too, so counting them says
  // nothing - just check the arithmetic: whatever the tiles add up to should be
  // everything the character needs. Traveler is the one that fails, because the
  // roster merges every elemental form and so carries three book lines.
  const owed = new Map();
  for (const it of [...asc, ...max.items]) {
    if (it.kind === 'exp') continue;
    owed.set(String(it.id), (owed.get(String(it.id)) || 0) + it.qty);
  }
  const owedTotal = [...owed.values()].reduce((a, b) => a + b, 0);

  const moraMax = (ch.req?.ascCost || 0) + max.cost + (lvl.cost || 0);
  const mora9 = (ch.req?.ascCost || 0) + nine.cost + (lvl.cost || 0);

  const withLo = (fam, loItems) => (fam && PROFILE.lowerMode === 'talents' ? {
    ...fam,
    lo: fam.qty.map((q, i) => (loItems[i] ? loItems[i].qty : 0)),
  } : fam);

  // A character with more than one enemy or book line does not fit the five
  // slots the normal layout has, so it gets an explicit tile order and a width
  // instead. Header-bearing tiles (weekly, enemies, specialty) come first so
  // they all land in the top row, where the header strip lives.
  // Geo draws two weekly bosses, Dvalin and Andrius, so weeklies group too
  // The weekly is what the talent bill has left once the book lines, the enemy
  // ladders and the crown are accounted for - the same leftover rule §1 uses
  // for the ascension boss drop, and the only thing that finds Pyro's.
  const weeklyGroups = (items) => {
    const enemyKeys = new Set(mobFamilies([...asc, ...items]).map((g) => srcKey(g[0])));
    return bySource(sumById(items)).filter((g) =>
      !isDomain(g) && !enemyKeys.has(srcKey(g[0]))
      && g.every((i) => i.kind !== 'crown' && i.kind !== 'book')
      && !asc.some((a) => String(a.id) === String(g[0].id)));
  };
  const allWeekly = weeklyGroups(max.items);
  const allWeekly9 = weeklyGroups(nine.items);
  const wide = allCommon.length > 1 || allBooks.length > 1 || allWeekly.length > 1;
  let tiles = null, cols = null;
  if (wide) {
    const pairLo = (groups, groups9) => groups.map((g) => {
      const mate = groups9.find((h) => srcKey(h[0]) === srcKey(g[0])) || [];
      return withLo(family(g), mate);
    });
    const mobs = pairLo(allCommon, allCommon9);
    const vols = pairLo(allBooks, allBooks9);
    const weeks = pairLo(allWeekly, allWeekly9);
    const head = [...weeks, ...mobs, family(pick(asc, 'specialty'))];
    const rest = [family(gemGroup), withLo(family(crown), crown9), ...vols,
                  expEquivalent(lvl.items),
                  { name:CURRENCY, icon:CURRENCY_ICON, tier:CURRENCY_TIER, tiers:[CURRENCY_TIER],
                    qty:[mora(moraMax)], lo:[mora(mora9)], sources:[] }];
    tiles = [...head, ...rest].filter((f) => f && f.qty.length);
    // wide enough that the header strip clears the talent block in the corner
    cols = Math.max(6, head.length + 1);
  }

  return {
    name: displayName(ch.n), title: ch.title || '', element: ch.el, weaponType: ch.w,
    art: ch.art, icon: ch.icon, skills: ch.skillIcons || [], beta: !!ch.__beta,
    targets: { hi: talentCaps(ch).join(' / '),
               lo: (PROFILE.lowerMode === 'talents') ? talentCaps(ch, 1).join(' / ') : null },
    owedTotal, tiles, cols,
    headerCount: wide ? allWeekly.length + allCommon.length + 1 : null,
    signature: ch.signatureWeaponName || null,
    families: {
      weekly: withLo(family(weekly), weekly9),
      boss: bossDrop ? family(bossDrop) : null,
      common: withLo(family(common), commonAt9),
      specialty: family(pick(asc, 'specialty')),
      books: withLo(family(books), books9),
      crown: withLo(family(crown), crown9),
      gem: family(gemGroup),
      exp: expEquivalent(lvl.items),
      mora: { name:CURRENCY, icon:CURRENCY_ICON, tier:CURRENCY_TIER, tiers:[CURRENCY_TIER], qty:[mora(moraMax)],
              lo:[mora(mora9)], sources:[] },
    },
  };
}

function buildWeaponGI(weaponName) {
  const w = weapons.find((x) => (x.name || '') === weaponName);
  if (!w) return null;
  const items = w.items || [];
  const lvl = LEVELING.weapon[Number(w.rarity)] || LEVELING.weapon.default;
  // a weapon ascension family always has four tiers; enemy drops have three
  const groups = bySource(items);
  const domain = groups.find((g) => g.length === 4) || [];
  const mobs = groups.filter((g) => g !== domain && g.length > 1)
    .sort((a, b) => b[b.length - 1].rar - a[a.length - 1].rar);
  const total = Number(w.cost || 0) + Number(lvl.cost || 0);
  return {
    name: w.name, rarity: w.rarity, type: w.weaponType || w.type,
    icon: w.icon,
    families: [
      family(domain),
      ...mobs.map((g) => family(g)),
      { name:CURRENCY, icon:CURRENCY_ICON, tier:CURRENCY_TIER, tiers:[CURRENCY_TIER], qty:[mora(total)], sources:[] },
      expEquivalent(lvl.items),
    ],
  };
}


// ---------------------------------------------------------------------------
// Honkai: Star Rail. Same ruleset, a different set of families: no gem and no
// local specialty, and a "Tracks of Destiny" tile where GI has its crown.
// ---------------------------------------------------------------------------

/** Levels each talent reaches, e.g. [10,10,10] for GI, [6,10,10,10] for HSR.
    Read off the data, since the two games cap their talents differently. */
const talentCaps = (ch, drop = 0) =>
  (ch.req?.talentStages || []).map((s) => s.length + 1 - drop);

function buildCharacterHSR(name) {
  const ch = find(name);
  if (!ch) return { name, error:'not in roster' };
  // announced but not shipped: the roster carries the entry with nothing in it
  if (!ch.req?.ascension?.length) return { name, error:'no material data yet' };
  const asc = ch.req?.ascension || [];
  // talentStages covers only the four traces' level-ups. The bonus abilities
  // and the stat nodes cost materials too and appear nowhere in it; req.talents
  // is the complete bill. Using the stages alone undercounted every trace
  // figure - 56 Whimsy Wax read as 26.
  const traces = ch.req?.talents || (ch.req?.talentStages || []).flat()
                                      .flatMap((l) => l.items || []);
  const lvl = LEVELING.character;
  // An enemy drop is billed twice - once for ascension, once for traces - so
  // fold the two lists together before anything tries to read the id runs.
  const sumById = (items) => {
    const acc = new Map();
    for (const it of items) {
      const prev = acc.get(String(it.id));
      acc.set(String(it.id), prev ? { ...prev, qty:prev.qty + it.qty } : { ...it });
    }
    return [...acc.values()];
  };
  const all = sumById([...asc, ...traces]);
  // the same arithmetic check the Genshin builder runs: whatever the tiles add
  // up to should be everything the character needs
  const owedTotal = all.filter((i) => i.kind !== 'exp')
                       .reduce((s, i) => s + i.qty, 0);

  // HSR records no sourceDetails at all, so every family falls out of the id
  // runs alone. That is enough: the three enemy drops are consecutive, the
  // three trace materials are consecutive, and each boss drop stands alone.
  const runs = (items, kind) => bySource(items.filter((i) => i.kind === kind));
  const mobRuns = runs(all, 'mob');
  const common = mobRuns.find((g) => g.length === 3) || [];
  // Tracks of Destiny is filed as a mob drop and is nothing of the sort; it is
  // whatever mob entry the three-tier enemy line leaves behind.
  const tracks = mobRuns.find((g) => g !== common && g.length === 1) || [];
  const pick = (items, kind) => items.filter((i) => i.kind === kind)
                                     .sort((a, b) => a.rar - b.rar);
  // req.talentCost is the complete trace spend, nodes included: it equals the
  // staged cost plus req.talentBaseCost exactly.
  const credits = (ch.req?.ascCost || 0) + Number(ch.req?.talentCost || 0) + (lvl.cost || 0);

  return {
    name: displayName(ch.n), title: ch.title || '', element: ch.el, weaponType: ch.path,
    art: ch.art, icon: ch.icon, skills: ch.skillIcons || [], beta: !!ch.__beta,
    targets: { hi: talentCaps(ch).join(' / '),
               lo: (PROFILE.lowerMode === 'talents') ? talentCaps(ch, 1).join(' / ') : null },
    signature: ch.signatureWeaponName || ch.signatureLightCone?.name || null,
    owedTotal,
    families: {
      weekly: family(pick(all, 'weekly'), wikiHeader(pick(all, 'weekly').at(-1), ch)),
      boss: family(pick(asc, 'boss'), wikiHeader(pick(asc, 'boss').at(-1), ch)),
      common: family(common, wikiHeader(common.at(-1), ch)),
      specialty: null,
      books: family(pick(all, 'book'), wikiHeader(pick(all, 'book').at(-1), ch)),
      crown: tracks.length ? family(tracks) : null,
      gem: null,
      exp: expEquivalent(lvl.items),
      mora: { name:CURRENCY, icon:CURRENCY_ICON, tier:CURRENCY_TIER, tiers:[CURRENCY_TIER],
              qty:[mora(credits)], raw:credits, sources:[] },
    },
  };
}

function buildLightCone(coneName, owner) {
  const w = weapons.find((x) => (x.name || '') === coneName);
  if (!w) return null;
  const items = w.items || [];
  const lvl = LEVELING.weapon[Number(w.rarity)] || LEVELING.weapon[5];
  // a cone wants the same three trace materials and the same three enemy drops
  const groups = bySource(items).filter((g) => g.length > 1)
    .sort((a, b) => (a[0].kind === 'book' ? -1 : 1));
  const total = Number(w.cost || 0) + Number(lvl.cost || 0);
  return {
    name: w.name, rarity: w.rarity, type: w.path || w.type, icon: w.art || w.icon,
    families: [
      ...groups.map((g) => family(g, wikiHeader(g.at(-1), owner))),
      expEquivalent(lvl.items),
      { name:CURRENCY, icon:CURRENCY_ICON, tier:CURRENCY_TIER, tiers:[CURRENCY_TIER],
        qty:[mora(total)], raw:total, sources:[] },
    ],
  };
}

/** The dim line under each tile, where the game spends it on a combined total:
    what the character and the signature weapon cost together. Families are
    paired by the material they hold, so only the tiles the weapon actually
    shares carry a second figure - the rest print nothing, which is the same
    "only what changed" rule Genshin's talent line uses. */
function addWeaponTotals(c) {
  if (PROFILE.lowerMode !== 'withWeapon' || !c.weapon) return;
  const byLookup = new Map();
  for (const f of c.weapon.families) if (f.lookup) byLookup.set(f.lookup, f);
  const money = c.weapon.families.find((f) => typeof f.raw === 'number');
  for (const fam of Object.values(c.families)) {
    if (!fam) continue;
    if (typeof fam.raw === 'number' && money) {
      fam.lo = [mora(fam.raw + money.raw)];
      continue;
    }
    const mate = fam.lookup ? byLookup.get(fam.lookup) : null;
    if (!mate) continue;
    fam.lo = fam.qty.map((q, i) => Number(q) + Number(mate.qty[i] ?? 0));
  }
}

// ---------------------------------------------------------------------------
// Zenless Zone Zero. Closest to Star Rail in shape - no local specialty, no
// talent block - but its promotion materials are a gem ladder rather than an
// enemy line, and its W-Engine shares nothing with the agent except money.
// ---------------------------------------------------------------------------

/** Zenless names its materials after where they come from, so the caption is
    read off the item rather than off its recorded source - which only ever says
    "Combat Simulation - Agent Promotion", the same words on every agent's card.
    "Basic Freeze Chip" -> Freeze; "Controller Certification Seal" -> Controller;
    "Anomaly Component" -> Anomaly. */
const zzzKind = (items, strip) => {
  const from = strip === 'top' ? items[items.length - 1] : items[0];
  return realName(from)
    .replace(/^(Basic|Advanced|Specialized|Reinforced)\s+/i, '')
    .replace(/\s+(Chip|Certification Seal|Component)$/i, '')
    .replace(/'s$/, '')
    .trim();
};

function buildCharacterZZZ(name) {
  const ch = find(name);
  if (!ch) return { name, error:'not in roster' };
  // announced but not shipped: the roster carries the entry with nothing in it
  if (!ch.req?.ascension?.length) return { name, error:'no material data yet' };
  const asc = ch.req?.ascension || [];
  const traces = ch.req?.talents || (ch.req?.talentStages || []).flat()
                                      .flatMap((l) => l.items || []);
  const lvl = LEVELING.character;
  const all = [...asc, ...traces];
  const pick = (kind) => all.filter((i) => i.kind === kind).sort((a, b) => a.rar - b.rar);
  const owedTotal = all.filter((i) => i.kind !== 'exp')
                       .reduce((s, i) => s + i.qty, 0);

  // ascCost + talentCost is already the whole bill; req.currency agrees exactly
  const money = (ch.req?.ascCost || 0) + (ch.req?.talentCost || 0) + (lvl.cost || 0);

  return {
    name: displayName(ch.n), title: ch.title || '', element: ch.el,
    weaponType: ch.spec, art: ch.art, icon: ch.icon,
    skills: ch.skillIcons || [], beta: !!ch.__beta,
    targets: { hi: talentCaps(ch).join(' / '), lo: null },
    signature: ch.signatureWeaponName || null,
    owedTotal,
    families: {
      weekly: family(pick('weekly')),
      boss: family(pick('boss')),
      // the top seal names the agent's role, the chips name the anomaly
      gem: family(pick('gem'), { lines:['Agent Promotion', zzzKind(pick('gem'), 'top')],
                                 sources:[] }),
      books: family(pick('book'), { lines:['Agent Skill', zzzKind(pick('book'))],
                                    sources:[] }),
      crown: family(pick('crown')),
      common: null,
      specialty: null,
      exp: expEquivalent(lvl.items),
      mora: { name:CURRENCY, icon:CURRENCY_ICON, tier:CURRENCY_TIER, tiers:[CURRENCY_TIER],
              qty:[mora(money)], raw:money, sources:[] },
    },
  };
}

function buildWEngine(engineName) {
  const w = weapons.find((x) => (x.name || '') === engineName);
  if (!w) return null;
  const lvl = LEVELING.weapon[Number(w.rarity)] || LEVELING.weapon[4];
  const groups = bySource(w.items || []).filter((g) => g.length > 1);
  const total = Number(w.cost || 0) + Number(lvl.cost || 0);
  return {
    name: w.name, rarity: w.rarity, type: w.weaponType || w.type,
    icon: w.art || w.icon,
    families: [
      ...groups.map((g) => family(g, { lines:['W-Engine Mod', zzzKind(g)], sources:[] })),
      expEquivalent(lvl.items),
      { name:CURRENCY, icon:CURRENCY_ICON, tier:CURRENCY_TIER, tiers:[CURRENCY_TIER],
        qty:[mora(total)], raw:total, sources:[] },
    ],
  };
}

// ---------------------------------------------------------------------------
// Wuthering Waves. Four-tier ladders where the others have three, one gather
// item filed as an enemy drop, and no gem or crown at all.
// ---------------------------------------------------------------------------

/** "Forgery Challenge" over the nations its challenges sit in. */
function forgeryCaption(items) {
  // a family we can illustrate keeps its faces; the caption is for the ones we
  // cannot, or the weapon's enemy tile loses its Exile to a Forgery Challenge
  // that merely also drops the material
  if (sourcesFor(items).some((s) => s.icon)) return {};
  const nations = new Set();
  let anyChallenge = false;
  for (const it of items)
    for (const s of it.sourceDetails || []) {
      if (!/^Forgery Challenge/i.test(s.name)) continue;
      anyChallenge = true;
      if (WW_NATIONS[s.name]) nations.add(WW_NATIONS[s.name]);
    }
  // the newest challenges have no wiki page yet, so the type alone is all the
  // caption can honestly say
  return anyChallenge ? { lines:['Forgery Challenge', ...nations], sources:[] } : {};
}

function buildCharacterWUWA(name) {
  const ch = find(name);
  if (!ch) return { name, error:'not in roster' };
  if (!ch.req?.ascension?.length) return { name, error:'no material data yet' };
  const asc = ch.req?.ascension || [];
  const talents = ch.req?.talents || [];
  const lvl = LEVELING.character;
  const all = sumIds([...asc, ...talents]);
  const owedTotal = all.filter((i) => i.kind !== 'exp').reduce((s, i) => s + i.qty, 0);

  const pick = (kind) => all.filter((i) => i.kind === kind).sort((a, b) => a.rar - b.rar);
  const ladders = byLadder(pick('mob')).filter((g) => g.length > 1);
  const common = ladders.sort((a, b) => b.length - a.length)[0] || [];
  // Two singles are left once the enemy ladder is taken: the boss drop and a
  // plant picked off the ground. `kind` separates them for some characters and
  // calls both 'mob' for others, so go by rarity - the boss drop is the rare
  // one, the plant is the common one.
  const leftover = pick('mob').filter((i) => !common.includes(i));
  const bossDrop = pick('boss')[0] || leftover.find((i) => i.rar >= 4);
  const gathered = leftover.filter((i) => i !== bossDrop);

  const money = (ch.req?.ascCost || 0) + (ch.req?.talentCost || 0) + (lvl.cost || 0);
  return {
    name: displayName(ch.n), title: ch.title || '', element: ch.el, weaponType: ch.w,
    art: ch.art, icon: ch.icon, skills: ch.skillIcons || [], beta: !!ch.__beta,
    targets: { hi: talentCaps(ch).join(' / '), lo: null },
    owedTotal, tiles: null, cols: null, headerCount: null,
    signature: ch.signatureWeaponName || null,
    families: {
      weekly: family(pick('weekly')),
      boss: family(bossDrop ? [bossDrop] : []),
      common: family(common),
      specialty: family(gathered),
      books: family(byLadder(pick('book'))[0] || [], forgeryCaption(pick('book'))),
      crown: null,
      gem: null,
      exp: expEquivalent(lvl.items),
      mora: { name:CURRENCY, icon:CURRENCY_ICON, tier:CURRENCY_TIER, tiers:[CURRENCY_TIER],
              qty:[mora(money)], raw:money, sources:[] },
    },
  };
}

// Endfield keeps its materials in a scraped wiki file rather than in the game
// data, and each carries a `source` line - "Area found: Wuling Outskirts, Rare
// Gathering Sites, ..." - which is the only provenance the game exposes.
const AE_SOURCES = (() => {
  const map = new Map();
  const path = `${REPO}/Database/EndfieldWiki/endfield/items.json`;
  if (GAME !== 'ae' || !fs.existsSync(path)) return map;
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  for (const [, it] of Object.entries(raw.items || {})) {
    const where = String(it.source || '').replace(/^Area found:\s*/i, '').split(',')[0].trim();
    if (it.name && where) map.set(it.name, where);
  }
  return map;
})();

// ---------------------------------------------------------------------------
// Endfield. No sources recorded anywhere, money is an ordinary item rather than
// a cost, and a character wants eight separate gathered materials - far more
// families than any fixed layout holds, so every card is a wide one (§4a).
// ---------------------------------------------------------------------------

function buildCharacterAE(name) {
  const ch = find(name);
  if (!ch) return { name, error:'not in roster' };
  if (!ch.req?.ascension?.length) return { name, error:'no material data yet' };
  const lvl = LEVELING.character;
  const all = sumIds([...(ch.req.ascension || []), ...(ch.req.talents || []),
                      ...(ch.req.extras || [])]);
  const owedTotal = all.filter((i) => i.kind !== 'exp' && i.kind !== 'currency')
                       .reduce((s, i) => s + i.qty, 0);
  const of = (kind) => all.filter((i) => i.kind === kind).sort((a, b) => a.rar - b.rar);

  const levelCash = (lvl.items || []).filter((i) => i.kind === 'currency');
  const cash = [...of('currency'), ...levelCash].reduce((s, i) => s + i.qty, 0);
  const cashIcon = (of('currency')[0] || levelCash[0] || {}).icon || CURRENCY_ICON;
  // Endfield states no EXP values anywhere, so the packs cannot collapse to a
  // top-tier equivalent (§3). They render as the ladders they are instead.
  // Endfield ids are names, so id order says nothing about tier. The packs come
  // in two lines - Combat Records and Cognitive Carriers - and the last two
  // words of the name are what separates them.
  const expLadders = [...(lvl.items || []).filter((i) => i.kind === 'exp')
    .reduce((acc, i) => {
      const line = i.name.split(/\s+/).slice(-2).join(' ');
      acc.set(line, [...(acc.get(line) || []), i]);
      return acc;
    }, new Map()).values()].map((g) => g.sort((a, b) => a.rar - b.rar));
  const caption = (i) => {
    const where = AE_SOURCES.get(i.name);
    return where ? { lines:[where], sources:[] } : {};
  };
  // one tile per ladder, then every gathered material on its own
  const tiles = [
    family(of('gem')), family(of('book')),
    ...of('skill').map((i) => family([i], caption(i))),
    ...of('specialty').map((i) => family([i], caption(i))),
    ...expLadders.map((g) => family(g)),
    { name:of('currency')[0]?.name || CURRENCY, icon:cashIcon, tier:4, tiers:[4],
      qty:[mora(cash)], raw:cash, sources:[] },
  ].filter((f) => f && f.qty.length);

  return {
    name: displayName(ch.n), title: ch.title || '', element: ch.el,
    weaponType: ch.cls || ch.w, art: ch.art, icon: ch.icon,
    skills: ch.skillIcons || [], beta: !!ch.__beta,
    targets: { hi: talentCaps(ch).join(' / '), lo: null },
    owedTotal, tiles, cols: gridCols(tiles.length + 1), headerCount: 0,
    signature: ch.signatureWeaponName || null,
    families: { weekly:null, boss:null, common:null, specialty:null, books:null,
                crown:null, gem:null, exp:null, mora:null },
  };
}

function buildWeaponWUWA(weaponName, owner) {
  const w = weapons.find((x) => (x.name || '') === weaponName);
  if (!w) return null;
  const lvl = LEVELING.weapon[Number(w.rarity)] || LEVELING.weapon[5];
  // same four-tier ladders as the character, and the same reason to read them
  // off the ids rather than the source lists
  const groups = byLadder(sumIds(w.items || [])).filter((g) => g.length > 1)
    .sort((a, b) => b[b.length - 1].rar - a[a.length - 1].rar);
  const total = Number(w.cost || 0) + Number(lvl.cost || 0);
  return {
    name: w.name, rarity: w.rarity, type: w.weaponType || w.type,
    icon: w.art || w.icon,
    families: [
      // only the forgery material is captioned by its challenge; an enemy line
      // keeps its own name even when we have no face for it
      ...groups.map((g) => family(g, g[0].kind === 'book' ? forgeryCaption(g) : {})),
      expEquivalent(lvl.items),
      { name:CURRENCY, icon:CURRENCY_ICON, tier:CURRENCY_TIER, tiers:[CURRENCY_TIER],
        qty:[mora(total)], raw:total, sources:[] },
    ],
  };
}

const buildCharacter = { hsr:buildCharacterHSR, zzz:buildCharacterZZZ,
                         wuwa:buildCharacterWUWA, ae:buildCharacterAE }[GAME]
                       || buildCharacterGI;
const buildWeapon = { hsr:buildLightCone, zzz:buildWEngine, wuwa:buildWeaponWUWA,
                      ae:() => null }[GAME] || buildWeaponGI;

const NAMES = process.argv.slice(3);
const out = NAMES.map((n) => {
  const c = buildCharacter(n);
  if (c.error) return c;
  c.weapon = c.signature ? buildWeapon(c.signature, c) : null;
  if (!c.error) addWeaponTotals(c);
  // does the card actually add up? anything the tiles cannot reach is stated on
  // the card rather than silently dropped
  const printed = c.tiles
    ? c.tiles.filter((f) => f.name !== CURRENCY && !/ equivalent$/.test(f.name))
    : Object.entries(c.families).filter(([k, f]) => f && k !== 'mora' && k !== 'exp')
        .map(([, f]) => f);
  const shown = printed.reduce((s, f) => s + f.qty.reduce((a, b) => a + Number(b), 0), 0);
  const short = (c.owedTotal || 0) - shown;
  // Not a merge: Traveler genuinely needs more families than the card has
  // slots - three talent-book lines and two enemy lines, one per talent.
  c.partial = short > 0
    ? `${short} materials not shown - more families than the card has slots`
    : null;
  delete c.owedTotal;
  return c;
});
fs.writeFileSync(process.argv[2], JSON.stringify(
  { game:GAME, claimsNew:PROFILE.claimsNew, showsTargets:PROFILE.showsTargets,
    layout:PROFILE.layout, maxLevel:PROFILE.maxLevel,
    namesBosses:!!PROFILE.namesBosses, characters:out }, null, 1));
for (const c of out) {
  if (c.error) { console.log(`${c.name}: ${c.error}`); continue; }
  const f = c.families;
  const fig = (x) => x ? x.qty.join('/') : '-';
  console.log(`${c.name}${c.beta ? ' (beta)' : ''} [${c.element}/${c.weaponType}]`);
  console.log(`   weekly ${fig(f.weekly)}  boss ${fig(f.boss)}  common ${fig(f.common)}` +
              `  spec ${fig(f.specialty)}  books ${fig(f.books)}`);
  console.log(`   crown ${fig(f.crown)}  gem ${fig(f.gem)}  exp ${fig(f.exp)}` +
              `  ${CURRENCY.toLowerCase()} ${fig(f.mora)}   targets ${c.targets.hi} / ${c.targets.lo}`);
  const nsrc = (x) => (x ? x.sources.length : 0);
  console.log(`   sources: boss=${nsrc(f.boss)} common=${nsrc(f.common)}` +
              ` gem=${nsrc(f.gem)} books=${nsrc(f.books)} weekly=${nsrc(f.weekly)}`);
  console.log(`   weapon: ${c.weapon ? c.weapon.name + ' (' + c.weapon.families.map(x => x.qty.join('/')).join(' | ') + ')' : 'NONE'}`);
  // the shape check assumes one family per slot; a wide entry has several, and
  // theirs are legitimately uneven - Traveler's Resistance and Ballad lines run
  // two tiers because those talents start above the Teachings rank
  const shapes = c.tiles ? [] : { wuwa: [[f.common, 4], [f.books, 4], [f.weekly, 1], [f.boss, 1]],
                                  hsr: [[f.common, 3], [f.books, 3], [f.weekly, 1], [f.boss, 1], [f.crown, 1]],
                   zzz: [[f.gem, 3], [f.books, 3], [f.weekly, 1], [f.boss, 1], [f.crown, 1]],
                 }[GAME] || [[f.gem, 4], [f.common, 3], [f.books, 3], [f.weekly, 1], [f.crown, 1]];
  const odd = shapes.filter(([x, n]) => x && x.qty.length !== n)
                    .map(([x, n]) => `${x.name} has ${x.qty.length} tiers, expected ${n}`);
  if (c.weapon) {
    const wf = c.weapon.families;
    if (GAME !== 'gi') {
      const want = GAME === 'wuwa' ? 4 : 3;
      for (const g of wf.slice(0, -2)) if (g.qty.length !== want)
        odd.push(`${PROFILE.weaponWord} ${g.name} has ${g.qty.length} tiers, expected ${want}`);
    } else {
      if (wf[0].qty.length !== 4) odd.push(`weapon domain has ${wf[0].qty.length} tiers, expected 4`);
      for (const g of wf.slice(1, -2)) if (g.qty.length !== 3)
        odd.push(`weapon ${g.name} has ${g.qty.length} tiers, expected 3`);
    }
  }
  if (odd.length) console.log('   !! ' + odd.join('; '));
}
