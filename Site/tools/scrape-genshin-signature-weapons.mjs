import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTextWithFallback } from './lib/html-fetch.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const dbDir = path.resolve(root, 'Database');
const signaturesPath = path.resolve(dbDir, 'AsIveHoarded', 'gi-signatures.json');
const reportsDir = path.resolve(dbDir, 'reports');
const reportPath = path.resolve(reportsDir, 'gi-signature-weapons.json');

const gameWithCharacterListUrl = 'https://gamewith.net/genshin-impact/article/show/22357';
const userAgent = 'NyxGiSignatureWeaponScraper/1.0';
const fetchTimeoutMs = 25_000;
const noSignatureCharacters = new Set(['traveler']);

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args.set(m[1], m[2] ?? 'true');
}

const onlyName = args.get('name') || '';
const includeExisting = args.get('include-existing') === 'true' || args.get('all') === 'true';
const includeNoSignature = args.get('include-no-signature') === 'true';
const dryRun = args.get('dry-run') === 'true';
const concurrency = Math.max(1, Math.min(8, Number(args.get('concurrency') || 4)));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function readDbJson(rel) {
  return readJson(path.resolve(dbDir, rel));
}

function existsDb(rel) {
  return fs.existsSync(path.resolve(dbDir, rel));
}

function norm(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number.parseInt(n, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(s) {
  return decodeHtml(String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function cleanAnchorText(html) {
  return stripTags(String(html || '').replace(/<noscript>[\s\S]*?<\/noscript>/gi, ' '));
}

function toAbsGameWithUrl(href) {
  const value = decodeHtml(href || '').trim();
  if (!value) return '';
  if (value.startsWith('http')) return value;
  if (value.startsWith('/')) return `https://gamewith.net${value}`;
  return `https://gamewith.net/${value}`;
}

function extractArticleAnchors(html) {
  const out = [];
  const re = /<a\b([^>]*?)\bhref=(["'])(?<href>[^"']*\/genshin-impact\/article\/show\/(?<id>\d+)[^"']*)\2([^>]*)>(?<body>[\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(re)) {
    const text = cleanAnchorText(match.groups.body);
    const url = toAbsGameWithUrl(match.groups.href);
    if (!url || !text) continue;
    out.push({ id: match.groups.id, url, text });
  }
  return out;
}

async function fetchText(url, tries = 3) {
  return fetchTextWithFallback(url, {
    retries: tries,
    timeoutMs: fetchTimeoutMs,
    userAgent,
    accept: 'text/html,application/xhtml+xml',
  });
}

async function mapConcurrent(items, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return out;
}

function weaponTypeLabel(type) {
  return {
    WEAPON_SWORD_ONE_HAND: 'Sword',
    WEAPON_CLAYMORE: 'Claymore',
    WEAPON_POLE: 'Polearm',
    WEAPON_BOW: 'Bow',
    WEAPON_CATALYST: 'Catalyst',
  }[type] || String(type || '');
}

function loadChannelRows(kind) {
  const rows = [];
  for (const channel of ['live', 'beta']) {
    const rel = `Nanoka/gi/${channel}/${kind}.json`;
    if (!existsDb(rel)) continue;
    for (const row of readDbJson(rel)) rows.push({ ...row, channel });
  }
  return rows;
}

function loadCharacters() {
  const byName = new Map();
  for (const ch of loadChannelRows('characters')) {
    if (!ch?.name || !(ch.rarity === 4 || ch.rarity === 5)) continue;
    const key = norm(ch.name);
    const prev = byName.get(key);
    if (!prev || prev.channel !== 'beta' && ch.channel === 'beta') byName.set(key, ch);
  }
  return [...byName.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function loadWeapons() {
  const byName = new Map();
  for (const weapon of loadChannelRows('weapons')) {
    if (!weapon?.name || !weapon?.id) continue;
    const key = norm(weapon.name);
    const prev = byName.get(key);
    const channels = new Set([...(prev?.channels || []), weapon.channel]);
    byName.set(key, {
      ...(prev || weapon),
      ...weapon,
      channels: [...channels].sort(),
    });
  }
  return byName;
}

function loadSignatureSource() {
  if (!fs.existsSync(signaturesPath)) return { game: 'gi', signatures: {} };
  const src = readJson(signaturesPath);
  return {
    ...src,
    game: src.game || 'gi',
    signatures: src.signatures || {},
  };
}

function signatureKeys(signatures) {
  return new Set(Object.keys(signatures || {}).map(norm));
}

function targetCharacters(characters, signatures) {
  const existing = signatureKeys(signatures);
  const query = norm(onlyName);
  return characters.filter((ch) => {
    const key = norm(ch.name);
    if (query && !key.includes(query) && !query.includes(key)) return false;
    if (!includeExisting && existing.has(key)) return false;
    if (!includeNoSignature && noSignatureCharacters.has(key)) return false;
    return true;
  });
}

function skippedCharacters(characters, signatures) {
  const existing = signatureKeys(signatures);
  return characters
    .filter((ch) => !existing.has(norm(ch.name)) && noSignatureCharacters.has(norm(ch.name)))
    .map((ch) => ({
      name: ch.name,
      reason: 'known-no-signature',
      weaponType: weaponTypeLabel(ch.weapon),
    }));
}

function discoverCharacterPage(characterPageAnchors, ch) {
  const key = norm(ch.name);
  const exact = characterPageAnchors.find((a) => norm(a.text) === key);
  if (exact) return exact;

  const buildGuide = characterPageAnchors.find((a) => {
    const textKey = norm(a.text);
    return textKey.includes(key) && /build|guide/i.test(a.text);
  });
  return buildGuide || null;
}

function signaturePhraseIndex(html, ch) {
  const name = String(ch.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const possessive = new RegExp(`${name}(?:'|&#0?39;|&#x27;|&rsquo;|&apos;|\\u2019|’)?s\\s+Signature\\s+Weapon`, 'i');
  const ofPattern = new RegExp(`Signature\\s+Weapon\\s+Of\\s+${name}`, 'i');
  const forPattern = new RegExp(`Signature\\s+Weapon\\s+For\\s+${name}`, 'i');
  const patterns = [possessive, ofPattern, forPattern];
  for (const re of patterns) {
    const match = re.exec(html);
    if (match) return match.index;
  }
  return -1;
}

function linkedWeaponBeforeSignature(html, signatureIdx) {
  const start = Math.max(0, signatureIdx - 3500);
  const before = html.slice(start, signatureIdx);
  const anchors = extractArticleAnchors(before);
  return anchors.at(-1) || null;
}

function findLocalWeaponByText(weaponsByName, text, ch) {
  const textKey = norm(text);
  const compatible = [...weaponsByName.values()].filter((weapon) => !ch.weapon || !weapon.type || weapon.type === ch.weapon);
  const exact = compatible.find((weapon) => norm(weapon.name) === textKey);
  if (exact) return exact;

  let best = null;
  for (const weapon of compatible) {
    const key = norm(weapon.name);
    const index = textKey.lastIndexOf(key);
    if (index < 0) continue;
    if (!best || index > best.index || key.length > best.key.length) best = { weapon, index, key };
  }
  return best?.weapon || null;
}

function fallbackWeaponFromWindow(html, signatureIdx, weaponsByName, ch) {
  const start = Math.max(0, signatureIdx - 2500);
  const windowText = stripTags(html.slice(start, signatureIdx + 200));
  return findLocalWeaponByText(weaponsByName, windowText, ch);
}

function parseCharacterPageForSignature(html, ch, weaponsByName) {
  const signatureIdx = signaturePhraseIndex(html, ch);
  if (signatureIdx < 0) {
    return { status: 'no-explicit-signature-phrase' };
  }

  const weaponAnchor = linkedWeaponBeforeSignature(html, signatureIdx);
  const weapon = weaponAnchor
    ? findLocalWeaponByText(weaponsByName, weaponAnchor.text, ch)
    : fallbackWeaponFromWindow(html, signatureIdx, weaponsByName, ch);

  if (!weapon) {
    return {
      status: 'signature-phrase-without-local-weapon',
      candidateText: weaponAnchor?.text || null,
      weaponSourceUrl: weaponAnchor?.url || null,
    };
  }

  if (ch.weapon && weapon.type && ch.weapon !== weapon.type) {
    return {
      status: 'weapon-type-mismatch',
      candidateText: weaponAnchor?.text || weapon.name,
      characterWeaponType: weaponTypeLabel(ch.weapon),
      weaponType: weaponTypeLabel(weapon.type),
      weaponSourceUrl: weaponAnchor?.url || null,
    };
  }

  return {
    status: 'ok',
    weapon,
    weaponSourceUrl: weaponAnchor?.url || null,
  };
}

async function scrapeCharacter(ch, page, weaponsByName) {
  try {
    const html = await fetchText(page.url);
    const parsed = parseCharacterPageForSignature(html, ch, weaponsByName);
    if (parsed.status !== 'ok') {
      return {
        character: ch.name,
        status: parsed.status,
        characterPage: page.url,
        ...parsed,
      };
    }
    return {
      character: ch.name,
      status: 'ok',
      weaponId: String(parsed.weapon.id),
      weaponName: parsed.weapon.name,
      weaponType: weaponTypeLabel(parsed.weapon.type),
      weaponChannels: parsed.weapon.channels || [parsed.weapon.channel].filter(Boolean),
      characterPage: page.url,
      weaponSourceUrl: parsed.weaponSourceUrl,
    };
  } catch (err) {
    return {
      character: ch.name,
      status: 'error',
      characterPage: page.url,
      error: err?.message || String(err),
    };
  }
}

ensureDir(reportsDir);

const startedAt = new Date().toISOString();
const signatureSource = loadSignatureSource();
const characters = loadCharacters();
const weaponsByName = loadWeapons();
const targets = targetCharacters(characters, signatureSource.signatures);
const skipped = skippedCharacters(characters, signatureSource.signatures);

console.log(`GI signatures: ${Object.keys(signatureSource.signatures).length} existing; ${targets.length} target character(s).`);

let results = [];
if (targets.length) {
  const listHtml = await fetchText(gameWithCharacterListUrl);
  const anchors = extractArticleAnchors(listHtml);
  const pages = targets.map((ch) => ({ ch, page: discoverCharacterPage(anchors, ch) }));
  const missingPages = pages.filter((row) => !row.page).map((row) => ({
    character: row.ch.name,
    status: 'no-character-page',
  }));
  const withPages = pages.filter((row) => row.page);

  if (withPages.length) {
    const scraped = await mapConcurrent(withPages, async ({ ch, page }, i) => {
      const row = await scrapeCharacter(ch, page, weaponsByName);
      const suffix = row.status === 'ok' ? row.weaponName : row.status;
      console.log(`[${i + 1}/${withPages.length}] ${ch.name}: ${suffix}`);
      return row;
    });
    results = [...scraped, ...missingPages];
  } else {
    results = missingPages;
  }
}

const additions = results.filter((row) => row.status === 'ok');
if (additions.length && !dryRun) {
  const next = {
    ...signatureSource,
    source: 'GameWith character build pages + existing imported signatures',
    generated: new Date().toISOString(),
    signatures: { ...signatureSource.signatures },
  };
  for (const row of additions) {
    const prev = next.signatures[row.character] || {};
    next.signatures[row.character] = {
      ...prev,
      weaponId: row.weaponId,
      weaponName: row.weaponName,
      source: 'gamewith-character-build',
      sourceUrl: row.characterPage,
      ...(row.weaponSourceUrl ? { weaponSourceUrl: row.weaponSourceUrl } : {}),
      scrapedAt: new Date().toISOString(),
    };
  }
  fs.writeFileSync(signaturesPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
}

const report = {
  generatedAt: new Date().toISOString(),
  startedAt,
  dryRun,
  source: 'GameWith character build pages',
  sourcePage: gameWithCharacterListUrl,
  existingSignatures: Object.keys(signatureSource.signatures).length,
  targetCharacters: targets.map((ch) => ({
    name: ch.name,
    rarity: ch.rarity,
    weaponType: weaponTypeLabel(ch.weapon),
    channel: ch.channel,
  })),
  skipped,
  results,
  summary: {
    targets: targets.length,
    found: additions.length,
    added: dryRun ? 0 : additions.length,
    skipped: skipped.length,
    unresolved: results.filter((row) => row.status !== 'ok').length,
  },
};

if (!dryRun) {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
}

console.log(`Done. ${additions.length}/${targets.length} signature weapon(s) found${dryRun ? ' (dry run)' : ''}.`);
if (!dryRun) console.log(`Report: ${path.relative(root, reportPath)}`);
if (additions.length && !dryRun) console.log(`Updated: ${path.relative(root, signaturesPath)}`);
