// Scrapes gather sites for local specialties from the Genshin wiki.
//
// The "How to Obtain" section names where a specialty grows, but the prose is
// inconsistent - the places are wiki links, and boss arenas get used as
// landmarks ("near the Maguu Kenki's arena"). So: pull every link out of the
// section's lead paragraph, then keep only the ones the wiki itself files under
// Category:Locations. That drops the bosses and keeps the places.
//
// Names written as plain text rather than links (Cecilia -> "Starsnatch Cliff")
// cannot be recovered this way and come back empty, which the caller reports.
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://genshin-impact.fandom.com/api.php';
const UA = 'pengo-nyx/1.0 (material card gather-site scraper)';
// beside the script, not beside the caller: running this from the repo root
// otherwise starts a second, empty cache there and re-fetches everything
const CACHE = process.env.SITE_CACHE
  || path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'wiki-cache');
const MAX_LINES = 3;                    // the card has room for three

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cacheFile = (kind, key) =>
  path.join(CACHE, `${kind}_${key.replace(/[^\w]+/g, '_')}.json`);

async function api(params, kind, key) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = cacheFile(kind, key);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const url = `${API}?${new URLSearchParams({ format:'json', formatversion:'2', ...params })}`;
  const res = await fetch(url, { headers:{ 'user-agent':UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  fs.writeFileSync(file, JSON.stringify(json));
  await sleep(300);
  return json;
}

const wikitext = async (page) =>
  (await api({ action:'parse', page, prop:'wikitext', redirects:'1' }, 'wt', page))
    ?.parse?.wikitext || '';

/** Links in the lead paragraph of "How to Obtain", before the map footer. */
export function candidateLinks(text) {
  const sec = text.match(/==\s*How to Obtain\s*==([\s\S]*?)(?=\n==|$)/i);
  if (!sec) return [];
  let body = sec[1].replace(/<!--[\s\S]*?-->/g, '');
  body = body.split(/\n\s*\n/)[0];                       // lead paragraph only
  body = body.split(/See the gallery|Teyvat Interactive Map/i)[0];
  const out = [];
  for (const m of body.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
    const target = m[1].trim();
    // Natlan tribe territories are written quoted ("Masters of the Night-Wind");
    // the quote marks are wiki styling, not part of the place name.
    const label = (m[2] || m[1]).replace(/\s*\(.*?\)\s*/g, '')
                                .replace(/^["“‘]|["”’]$/g, '').trim();
    if (!out.some((x) => x.target === target)) out.push({ target, label });
  }
  return out;
}

/** Ask the wiki which of these pages it files as a Location. */
async function keepLocations(links) {
  if (!links.length) return [];
  const titles = links.map((l) => l.target);
  const json = await api({ action:'query', prop:'categories', cllimit:'max',
                           titles:titles.join('|'), redirects:'1' },
                         'cat', titles.join('|').slice(0, 120));
  const isPlace = new Set();
  const alias = new Map();
  for (const p of json?.query?.pages || []) {
    const cats = (p.categories || []).map((c) => c.title);
    if (cats.includes('Category:Locations')) isPlace.add(p.title);
  }
  for (const r of json?.query?.redirects || []) alias.set(r.from, r.to);
  return links.filter((l) => isPlace.has(alias.get(l.target) || l.target));
}

/** Capitalised phrases, for pages that name a place without linking it
    ("Cecilias grow exclusively on Starsnatch Cliff"). Each candidate is still
    category-checked, so a stray proper noun cannot slip through. */
function bareNames(text, itemName) {
  const sec = text.match(/==\s*How to Obtain\s*==([\s\S]*?)(?=\n==|$)/i);
  if (!sec) return [];
  let body = sec[1].replace(/<!--[\s\S]*?-->/g, '').split(/\n\s*\n/)[0];
  body = body.split(/See the gallery|Teyvat Interactive Map/i)[0]
             .replace(/\[\[[^\]]*\]\]/g, ' ').replace(/\{\{[^}]*\}\}/g, ' ');
  const stem = itemName.replace(/s$/, '');
  const out = [];
  const re = /\b([A-Z][\w'\u2019-]+(?:\s+(?:of|the|and)?\s*[A-Z][\w'\u2019-]+){0,3})\b/g;
  for (const m of body.matchAll(re)) {
    const name = m[1].trim();
    if (name.startsWith(stem) || name.length < 5 || out.includes(name)) continue;
    out.push(name);
  }
  return out.slice(0, 6).map((n) => ({ target:n, label:n }));
}


/** Last resort: the infobox says "Local Specialty (Snezhnaya)". A nation is a
    poorer answer than a subarea, but it beats an empty slot. */
function regionOf(text) {
  const m = text.match(/\|\s*type\s*=\s*Local Specialty\s*\(([^)]+)\)/i);
  return m ? [m[1].trim()] : [];
}

export async function sitesFor(itemName) {
  try {
    const text = await wikitext(itemName);
    let places = await keepLocations(candidateLinks(text));
    if (!places.length) places = await keepLocations(bareNames(text, itemName));
    if (!places.length) return { sites:regionOf(text), fallback:'region' };
    return { sites:places.slice(0, MAX_LINES).map((p) => p.label) };
  } catch (err) {
    return { error:err.message };
  }
}


if (process.argv[2] === '--for') {
  // pull every distinct local specialty out of an extracted chars.json
  const chars = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const names = [...new Set(chars.filter((c) => !c.error)
    .map((c) => c.families?.specialty?.name).filter(Boolean))];
  const out = {};
  for (const n of names) {
    const r = await sitesFor(n);
    if (r.error) { console.log(`${n.padEnd(28)} ERROR ${r.error}`); continue; }
    if (r.sites?.length) out[n] = r.sites;
    console.log(`${n.padEnd(28)} ${(r.sites || []).join(' | ') || '(nothing)'}` +
                `${r.fallback ? '   <- region fallback' : ''}`);
  }
  fs.writeFileSync(process.argv[4], JSON.stringify(out, null, 1));
  console.log(`
${Object.keys(out).length}/${names.length} specialties resolved`);
} else if (process.argv[2] === '--run') {
  const names = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const out = {};
  let hit = 0;
  for (const n of names) {
    const r = await sitesFor(n);
    if (r.error) { console.log(`${n.padEnd(28)} ERROR ${r.error}`); continue; }
    if (r.sites && r.sites.length) { out[n] = r.sites; hit++; }
    console.log(`${n.padEnd(28)} ${(r.sites || []).join(' | ') || '(nothing)'}` +
                `${r.fallback ? '   <- region fallback' : ''}`);
  }
  console.log(`\ncovered ${hit}/${names.length}`);
  if (process.argv[4]) fs.writeFileSync(process.argv[4], JSON.stringify(out, null, 1));
}

// ---------------------------------------------------------------------------
// Star Rail. The game data records no sources at all, but the wiki's item
// infobox carries a source1 link that names exactly what the card needs:
//   [[Stagnant Shadow: Shape of Deepsheaf]]                    ascension boss
//   [[Calyx (Crimson): Bud of Elation ("World's End" Tavern)]] trace materials
//   [[Echo of War: Rusted Crypt of the Iron Carcass]]          weekly
//   [[Imagenated Creature]]s / [[Antimatter Legion|...]]       enemy drops
// Echo of War entries also carry `mentions`, which names the boss itself and is
// what turns that slot into a portrait rather than a caption.
// ---------------------------------------------------------------------------
const HSR_API = 'https://honkai-star-rail.fandom.com/api.php';

async function hsrWikitext(page, kind = 'hsr') {
  const file = cacheFile(kind, page);
  fs.mkdirSync(CACHE, { recursive: true });
  let text;
  if (fs.existsSync(file)) {
    text = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    const url = `${HSR_API}?${new URLSearchParams({ format:'json', formatversion:'2',
      action:'parse', page, prop:'wikitext', redirects:'1' })}`;
    const res = await fetch(url, { headers:{ 'user-agent':UA } });
    const json = res.ok ? await res.json() : null;
    text = json?.parse?.wikitext || '';
    fs.writeFileSync(file, JSON.stringify(text));
    await sleep(300);
  }
  return text;
}

async function hsrInfobox(item) {
  const box = /\{\{Item Infobox([\s\S]*?)\n\}\}/.exec(await hsrWikitext(item));
  const out = {};
  if (!box) return out;
  for (const line of box[1].split('\n')) {
    const m = line.match(/^\s*\|\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** "[[A (B)|C]]s" -> "Cs". The trailing plural sits outside the link. */
const linkText = (s) => String(s || '')
  .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
  .replace(/\[\[([^\]]*)\]\]/g, '$1')
  .replace(/&mdash;.*$/, '')
  .replace(/\s+/g, ' ').trim();

/** The link's target, not its label. A wiki link may be piped to an abbreviated
    display name - "Calyx (Crimson): Bud of Harmony (The Reverie)" shows as
    "Calyx: The Reverie" - and only the target is canonical. Classifying on the
    label filed those as plain enemies. */
const linkTarget = (s) =>
  [...String(s || '').matchAll(/\[\[([^\]|]+)/g)].map((m) => m[1].trim()).join(' ');

/** The Echo of War stage page names what you actually fight, in one of two
    places: a `boss` field in the Domain Infobox, or the lead sentence
    ("It features the boss [[Doomsday Beast]]"). Both beat the material page's
    `mentions`, which lists every name the flavour text drops - for
    Destruction's Beginning that is "Warforge; Leviathan; Doomsday Beast", and
    only the last is the boss. */
async function echoBosses(stage) {
  const text = await hsrWikitext('Echo of War: ' + stage, 'echo');
  const out = [];
  const box = /\{\{[A-Za-z ]*Infobox([\s\S]*?)\n\}\}/.exec(text);
  for (const line of (box ? box[1] : '').split('\n')) {
    const m = line.match(/^\s*\|\s*boss\s*=\s*(.+?)\s*$/i);
    if (m) out.push(...m[1].split(';'));
  }
  const prose = /features the boss\s*\[\[([^\]|]+)/i.exec(text);
  if (prose) out.push(prose[1]);
  // "Starcrusher Swarm King: Skaracabaz (Synthetic)" - offer the whole title and
  // each of its parts, since the database may file it under either
  const names = [];
  for (const raw of out) {
    const clean = linkText(raw).replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    for (const n of [clean, ...clean.split(/\s*[:,]\s*/)])
      if (n && !names.includes(n)) names.push(n.trim());
  }
  return names;
}

/** Classify one material's source1 into something the card can draw. The three
    domain forms are matched before any tidying, because the tidying strips the
    very parentheses that identify a Calyx. */
export function classify(fields) {
  const target = linkTarget(fields.source1);
  const text = linkText(fields.source1);
  // Every name the page mentions, in order. The boss is not always the first:
  // Destroyer's Final Road lists "Warforge; Leviathan; Doomsday Beast" and only
  // the last of those is the thing you fight.
  const bosses = String(fields.mentions || '').split(';')
    .map((s) => s.trim()).filter(Boolean);
  let m;
  if ((m = /Stagnant Shadow:\s*Shape of\s+([^(]+)/i.exec(target)))
    return { kind: 'shadow', name: m[1].trim() };
  // [^(] rather than a single word: "Bud of The Hunt" is the one Path whose
  // name is two words, and a \w+ capture left it reading "The"
  if ((m = /Calyx\s*\(Crimson\):\s*Bud of\s+([^(]+)/i.exec(target)))
    return { kind: 'calyx', name: m[1].trim() };
  if ((m = /Echo of War:\s*([^(]+)/i.exec(target)))
    return { kind: 'echo', name: m[1].trim(), bosses };
  // "Imagenated Creatures at Equilibrium Level 2 or higher" - the qualifier is
  // about when they start dropping, not about who drops them
  // "Certain [[Fragmentum Monsters]] at Equilibrium Level 4 or higher" - the
  // prose wrapped around the link is a qualifier, not part of the name
  const plain = text.replace(/^(Certain|Some|Various)\s+/i, '')
                    .replace(/\s+at Equilibrium Level.*$/i, '')
                    .replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return plain ? { kind: 'enemy', name: plain } : null;
}

if (process.argv[2] === '--hsr') {
  const data = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const names = new Set();
  for (const c of data.characters || []) {
    if (c.error) continue;
    for (const f of Object.values(c.families || {})) if (f && f.lookup) names.add(f.lookup);
    for (const f of ((c.weapon && c.weapon.families) || [])) if (f && f.lookup) names.add(f.lookup);
  }
  const out = {};
  for (const n of [...names].sort()) {
    const hit = classify(await hsrInfobox(n));
    // an Echo of War entry needs a second lookup: the stage page, not the item
    if (hit && hit.kind === 'echo')
      hit.bosses = [...await echoBosses(hit.name), ...hit.bosses];
    if (hit) out[n] = hit;
    console.log(n.slice(0, 36).padEnd(37) + (hit
      ? hit.kind.padEnd(7) + ' ' + hit.name + (hit.boss ? '   boss: ' + hit.boss : '')
      : '-- nothing --'));
  }
  fs.writeFileSync(process.argv[4], JSON.stringify(out, null, 1));
  console.log('\n' + Object.keys(out).length + '/' + names.size + ' materials resolved');
}

// ---------------------------------------------------------------------------
// Wuthering Waves. A forgery material lists the challenges that drop it -
// "Forgery Challenge: Abyss of Confession" - and the challenge's own page names
// the nation it sits in. That nation is what the caption wants; the challenge's
// own name is too long and says less.
// ---------------------------------------------------------------------------
const WW_API = 'https://wutheringwaves.fandom.com/api.php';

async function wwWikitext(page) {
  const file = cacheFile('ww', page);
  fs.mkdirSync(CACHE, { recursive: true });
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const url = `${WW_API}?${new URLSearchParams({ format:'json', formatversion:'2',
    action:'parse', page, prop:'wikitext', redirects:'1' })}`;
  const res = await fetch(url, { headers:{ 'user-agent':UA } });
  const json = res.ok ? await res.json() : null;
  const text = json?.parse?.wikitext || '';
  fs.writeFileSync(file, JSON.stringify(text));
  await sleep(300);
  return text;
}

/** The nation an infobox names, whichever infobox the page happens to use. */
/** Wuthering Waves names an enemy *family* where the database holds individual
    monsters - "Clamorlings", "Whisperins". The wiki files each as a category,
    `Category:Clamorling Enemies`, whose members are the monsters themselves. */
export async function wwCategory(family) {
  // "Clamorling TDs in Lahai-Roi" is the Clamorling family, seen in one place.
  // Strip the qualifier and the plural before asking for the category.
  const stem = String(family)
    .replace(/\s+TDs?\s.*$/i, '')
    .replace(/\s+in\s+.*$/i, '')
    .replace(/s$/, '')
    .trim();
  const cat = `Category:${stem} Enemies`;
  const file = cacheFile('wwcat', cat);
  fs.mkdirSync(CACHE, { recursive: true });
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const url = `${WW_API}?${new URLSearchParams({ format:'json', formatversion:'2',
    action:'query', list:'categorymembers', cmtitle:cat, cmlimit:'max', cmtype:'page' })}`;
  const res = await fetch(url, { headers:{ 'user-agent':UA } });
  const json = res.ok ? await res.json() : null;
  const names = (json?.query?.categorymembers || []).map((m) => m.title);
  fs.writeFileSync(file, JSON.stringify(names));
  await sleep(300);
  return names;
}

export async function wwNation(challenge) {
  const text = await wwWikitext(challenge);
  const m = /\|\s*nation\s*=\s*([^\n|}]+)/i.exec(text);
  return m ? m[1].trim() : null;
}

if (process.argv[2] === '--wuwa') {
  const data = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const named = new Set();
  for (const c of data.characters || []) {
    if (c.error) continue;
    const fams = [...Object.values(c.families || {}), ...(c.weapon?.families || [])];
    // "Clamorlings or Tranquilites" is two families in one string
    for (const f of fams) for (const n of (f?.rawSources || []))
      for (const one of String(n).split(/\s+or\s+|\s*\/\s*/))
        if (one.trim()) named.add(one.trim());
  }
  const challenges = [...named].filter((n) => /^Forgery Challenge:/i.test(n)).sort();
  const families = [...named].filter((n) => !/^Forgery Challenge/i.test(n)).sort();

  const out = { nations:{}, families:{} };
  for (const name of challenges) {
    const nation = await wwNation(name);
    if (nation) out.nations[name] = nation;
    console.log(`${name.slice(0, 44).padEnd(45)} ${nation || '-- no nation --'}`);
  }
  for (const fam of families) {
    const members = await wwCategory(fam);
    if (members.length) out.families[fam] = members;
    console.log(`${fam.slice(0, 44).padEnd(45)} ${members.length || '--'} members`);
  }
  fs.writeFileSync(process.argv[4], JSON.stringify(out, null, 1));
  console.log(`\n${Object.keys(out.nations).length}/${challenges.length} challenges, `
    + `${Object.keys(out.families).length}/${families.length} enemy families resolved`);
}
