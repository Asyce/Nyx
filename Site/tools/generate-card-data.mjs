// Bakes the material-card data for every character in every game.
//
// tools/material-card/extract.mjs is the engine — the same one used to iterate
// on the design offline. It reads the generated cm-data-<game>.js packs, so this
// has to run AFTER generate-site-data.mjs, not before.
//
// One file per game, lazy-loaded by the Infographic button, because nobody who
// never clicks it should pay for ~800 KB of source portraits and tier ladders.
// The character page's own payload is untouched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const extractor = path.resolve(root, 'tools', 'material-card', 'extract.mjs');
const generatedDir = path.resolve(root, 'Site', 'src', 'data', 'generated');
const GAMES = ['gi', 'hsr', 'zzz', 'wuwa', 'ae'];

/* Extraction internals that only mattered while resolving the data. Shipping
   them would add a fifth to the payload for fields nothing renders. */
// `lookup` and `raw` stay: they are what pairs a character family with the same
// material on a weapon, which is how the combined lower line is worked out when
// a reader swaps the weapon (see nyxCardWeaponTotals).
const DROP_FAMILY = ['rawSources'];
const DROP_CHARACTER = ['signature', 'key', 'error'];

/* Where a Genshin local specialty grows. The database does not carry it, so the
   card pipeline keeps it as a hand-maintained table keyed by item name. */
const sitesFile = path.resolve(root, 'tools', 'material-card', 'sites.json');
const GATHER_SITES = fs.existsSync(sitesFile)
  ? JSON.parse(fs.readFileSync(sitesFile, 'utf8'))
  : {};

const assetExists = (rel) => rel && fs.existsSync(path.resolve(root, rel.replace(/^(?:\.\.\/)+/, '')));

/* Everything below used to be resolved by render.py poking at the filesystem.
   The browser cannot do that, so the answers are baked here instead — the
   runtime only ever renders paths it was handed. */
function metaIcon(game, name) {
  if (!name) return null;
  const slug = String(name).toLowerCase().replace(/ /g, '-');
  // elements are filed plainly; the other axis carries a prefix, and which one
  // depends on the game — HSR path_remembrance, ZZZ spec_anomaly
  for (const prefix of ['', 'path_', 'spec_']) {
    for (const ext of ['webp', 'png']) {
      const rel = `Site/assets/meta/${game}/${prefix}${slug}.${ext}`;
      // the page's own convention for a site asset (CM_META_ICON_BASE), not the
      // repo-relative form the offline renderer uses
      if (assetExists(rel)) return `../assets/meta/${game}/${prefix}${slug}.${ext}`;
    }
  }
  return null;
}

/* The weapon header wants the gacha splash, not the inventory thumbnail. Star
   Rail ships a rectangular card where Genshin ships a cut-out, and the two want
   different framing, so the shape travels with the art. */
function weaponArt(icon) {
  if (!icon) return { art: null, shape: '' };
  const gacha = icon.replace('/icons/', '/gacha/').replace('UI_EquipIcon_', 'UI_Gacha_EquipIcon_');
  const art = assetExists(gacha) ? gacha : (assetExists(icon) ? icon : null);
  return { art, shape: icon.includes('/lightcones/') ? ' card' : '' };
}

function trimFamily(fam) {
  if (!fam) return fam;
  const out = {};
  for (const [k, v] of Object.entries(fam)) {
    if (DROP_FAMILY.includes(k)) continue;
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function trimCharacter(ch, game) {
  const out = {};
  for (const [k, v] of Object.entries(ch)) {
    if (DROP_CHARACTER.includes(k)) continue;
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  if (out.families) {
    out.families = Object.fromEntries(
      Object.entries(out.families).filter(([, f]) => f).map(([k, f]) => [k, trimFamily(f)]),
    );
  }
  if (Array.isArray(out.tiles)) out.tiles = out.tiles.map(trimFamily);
  if (out.weapon?.families) {
    const { art, shape } = weaponArt(out.weapon.icon);
    out.weapon = {
      name: out.weapon.name,
      art,
      shape,
      typeIcon: metaIcon(game, out.weapon.type),
      families: out.weapon.families.map(trimFamily),
    };
    if (!out.weapon.art) delete out.weapon.art;
    if (!out.weapon.typeIcon) delete out.weapon.typeIcon;
  }
  const elIcon = metaIcon(game, out.element);
  const wpIcon = metaIcon(game, out.weaponType);
  if (elIcon) out.elIcon = elIcon;
  if (wpIcon) out.wpIcon = wpIcon;
  // the gather-site caption rides on the family it captions; shortest line
  // first, which is the order render.py prints them in
  const spec = out.families?.specialty;
  const sites = spec && GATHER_SITES[spec.name];
  if (sites?.length) spec.sites = [...sites].sort((a, b) => a.length - b.length);
  return out;
}

function extract(game) {
  const tmp = path.join(os.tmpdir(), `nyx-card-${game}-${process.pid}.json`);
  const run = spawnSync(process.execPath, [extractor, tmp], {
    env: { ...process.env, CARD_GAME: game, CARD_WEAPONS: '1' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(`card extraction failed for ${game}:\n${run.stderr || run.stdout}`);
  }
  const raw = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.rmSync(tmp, { force: true });
  return raw;
}

/* The full weapon table is its own file. The page defaults to the signature,
   which is already baked into the character, so the common path never loads
   this at all — only an explicit swap in the weapon picker does. */
function writeWeapons(game, weapons) {
  const names = Object.keys(weapons || {});
  if (!names.length) return 0;
  const table = {};
  for (const [name, w] of Object.entries(weapons)) {
    const { art, shape } = weaponArt(w.icon);
    table[name] = {
      name: w.name,
      shape,
      families: w.families.map(trimFamily),
      ...(art ? { art } : {}),
      ...(metaIcon(game, w.type) ? { typeIcon: metaIcon(game, w.type) } : {}),
    };
  }
  const file = path.resolve(generatedDir, `cm-card-${game}-weapons.js`);
  const body = 'window.NYX_CARD_WEAPONS = window.NYX_CARD_WEAPONS || {};\n'
    + `window.NYX_CARD_WEAPONS[${JSON.stringify(game)}] = ${JSON.stringify(table)};\n`;
  fs.writeFileSync(file, body, 'utf8');
  console.log(`Generated ${path.relative(root, file)} — ${names.length} weapons, `
    + `${Math.round(body.length / 1024)} KB`);
  return names.length;
}

/* The card is rasterised inside an SVG <foreignObject>, which is its own
   document: it cannot reach the page's stylesheets, fonts or images. So the
   style sheet ships with every byte it needs already inside it. The two fonts
   are Latin subsets (~19 KB and ~24 KB) rather than the 7 MB and 12 MB CJK
   originals; a name outside that range falls back to a system face, which is a
   different face but never a tofu box. */
const dataUri = (rel, mime) =>
  `data:${mime};base64,${fs.readFileSync(path.resolve(root, rel)).toString('base64')}`;

function writeStyle() {
  const cardDir = path.resolve(root, 'tools', 'material-card');
  const TILE = 90;
  const BOSS = 56;
  const CLUSTER = 86;
  const css = fs.readFileSync(path.resolve(cardDir, 'card.css'), 'utf8')
    .replace(/@@TILE@@/g, String(TILE))
    .replace(/@@BOSS@@/g, String(BOSS))
    .replace(/@@CLUSTER@@/g, String(CLUSTER))
    .replace(/@@EYE@@/g, dataUri('Site/assets/decor/nyx_eye_line.png', 'image/png'))
    .replace(/@@FONT_GI@@/g, dataUri('tools/material-card/fonts/GI-sub.woff2', 'font/woff2'))
    .replace(/@@FONT_HSR@@/g, dataUri('tools/material-card/fonts/HSR-sub.woff2', 'font/woff2'));
  const payload = {
    css,
    tile: TILE,
    boss: BOSS,
    cluster: CLUSTER,
    logo: dataUri('Site/assets/icon/nyx_logo.png', 'image/png'),
  };
  const file = path.resolve(generatedDir, 'cm-card-style.js');
  const body = `window.NYX_CARD_STYLE = ${JSON.stringify(payload)};\n`;
  fs.writeFileSync(file, body, 'utf8');
  console.log(`Generated ${path.relative(root, file)} — ${Math.round(body.length / 1024)} KB`);
}

writeStyle();

let totalChars = 0;
let totalSkipped = 0;
for (const game of GAMES) {
  const raw = extract(game);
  const chars = {};
  let skipped = 0;
  for (const ch of raw.characters) {
    // "no material data yet" is an unreleased character, not a fault: the page
    // has nothing to cost either, so there is no card to ship.
    if (ch.error) { skipped += 1; continue; }
    chars[ch.key || ch.name] = trimCharacter(ch, game);
  }
  const payload = {
    game: raw.game,
    claimsNew: raw.claimsNew,
    showsTargets: raw.showsTargets,
    // 'talents' = the one-below-max build; 'withWeapon' = character + weapon
    lowerMode: raw.lowerMode,
    layout: raw.layout,
    maxLevel: raw.maxLevel,
    namesBosses: raw.namesBosses,
    // the brand cell borrows a tile's number grid, so it needs to know whether
    // this game prints a second row of figures at all
    hasLower: Object.values(chars).some((ch) => [
      ...Object.values(ch.families || {}),
      ...(ch.tiles || []),
      ...(ch.weapon?.families || []),
    ].some((f) => f?.lo)),
    // Endfield has no weapon band at all, so there is no table to go looking
    // for. Without this the runtime chases a file that was never written, once
    // per card rendered.
    hasWeapons: writeWeapons(game, raw.weapons) > 0,
    characters: chars,
  };
  const file = path.resolve(generatedDir, `cm-card-${game}.js`);
  const body = `window.NYX_CARD_DATA = window.NYX_CARD_DATA || {};\n`
    + `window.NYX_CARD_DATA[${JSON.stringify(game)}] = ${JSON.stringify(payload)};\n`;
  fs.writeFileSync(file, body, 'utf8');
  totalChars += Object.keys(chars).length;
  totalSkipped += skipped;
  console.log(`Generated ${path.relative(root, file)} — ${Object.keys(chars).length} characters, `
    + `${skipped} without material data, ${Math.round(body.length / 1024)} KB`);
}
console.log(`Card data: ${totalChars} characters across ${GAMES.length} games (${totalSkipped} skipped).`);
