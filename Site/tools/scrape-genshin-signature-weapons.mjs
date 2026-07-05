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
const searchUserAgent = 'Mozilla/5.0 NyxGiSignatureWeaponScraper/1.0';
const fetchTimeoutMs = 25_000;
const noSignatureCharacters = new Set(['traveler']);
const blockedConsensusDomains = new Set([
  'bing.com',
  'discord.com',
  'discord.gg',
  'duckduckgo.com',
  'facebook.com',
  'google.com',
  'instagram.com',
  'microsoft.com',
  'reddit.com',
  't.co',
  't.me',
  'telegram.me',
  'threads.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'youtu.be',
  'youtube.com',
]);

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
const useConsensusFallback = !args.has('no-consensus') && args.get('consensus') !== 'false';
const consensusMinSources = Math.max(1, Number(args.get('consensus-min-sources') || 2));
const consensusMaxPages = Math.max(consensusMinSources, Number(args.get('consensus-max-pages') || 12));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function writeJsonPreserveStyle(absPath, data) {
  const existing = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : '';
  const pretty = existing.trim().includes('\n');
  fs.writeFileSync(absPath, `${JSON.stringify(data, null, pretty ? 2 : 0)}\n`, 'utf8');
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

function cleanText(s, limit = 500) {
  const text = stripTags(s)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  return limit && text.length > limit ? `${text.slice(0, limit - 3).trim()}...` : text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function sourceDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isBlockedConsensusDomain(domain) {
  if (!domain) return true;
  return [...blockedConsensusDomains].some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

function phraseRegexText(s) {
  return String(s || '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '[\\s\\-]+');
}

function firstMatchIndex(text, aliases) {
  for (const alias of aliases) {
    const re = new RegExp(phraseRegexText(alias), 'i');
    const match = re.exec(text);
    if (match) return { index: match.index, alias };
  }
  return null;
}

function clipAround(text, index, length = 360) {
  const start = Math.max(0, index - Math.floor(length / 2));
  const end = Math.min(text.length, index + Math.floor(length / 2));
  return cleanText(text.slice(start, end), length);
}

function decodeSearchUrl(href) {
  const raw = decodeHtml(href || '').trim();
  if (!raw) return '';
  const value = raw.startsWith('//') ? `https:${raw}` : raw;
  try {
    const parsed = new URL(value, 'https://duckduckgo.com/');
    const uddg = parsed.searchParams.get('uddg');
    return uddg || parsed.href;
  } catch {
    return value;
  }
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

async function fetchSearchText(url, tries = 2) {
  let lastError = null;
  for (let i = 1; i <= tries; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': searchUserAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (error) {
      lastError = error;
      if (i < tries) await sleep(750 * i);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`Unable to fetch search page ${url}`);
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

function weaponAliases(weapon) {
  const aliases = new Set([weapon.name]);
  const name = String(weapon.name || '');
  if (/whitelake/i.test(name)) aliases.add(name.replace(/whitelake/i, 'White Lake'));
  if (/frostfeather/i.test(name)) aliases.add(name.replace(/frostfeather/i, 'Winterfeather'));
  if (/whitelake/i.test(name) && /frostfeather/i.test(name)) {
    aliases.add(name.replace(/whitelake/i, 'White Lake').replace(/frostfeather/i, 'Winterfeather'));
  }
  return [...aliases].filter(Boolean);
}

function compatibleWeaponsForCharacter(weaponsByName, ch) {
  return [...weaponsByName.values()]
    .filter((weapon) => !ch.weapon || !weapon.type || weapon.type === ch.weapon)
    .sort((a, b) => Number(b.rarity || 0) - Number(a.rarity || 0) || String(a.name).localeCompare(String(b.name)));
}

function betaOnlyFiveStarWeapons(weapons) {
  return weapons.filter((weapon) => {
    const channels = weapon.channels || [weapon.channel].filter(Boolean);
    return Number(weapon.rarity || 0) >= 5 && channels.includes('beta') && !channels.includes('live');
  });
}

function signatureSearchQueries(ch, compatibleWeapons) {
  const base = [
    `${ch.name} Genshin Impact signature weapon`,
    `${ch.name} Genshin Impact best weapon signature`,
    `${ch.name} Genshin Impact ${weaponTypeLabel(ch.weapon)} signature`,
  ];
  const betaWeapons = betaOnlyFiveStarWeapons(compatibleWeapons).slice(0, 4);
  for (const weapon of betaWeapons) {
    base.push(`${ch.name} Genshin Impact ${weapon.name}`);
    base.push(`${ch.name} Genshin Impact ${weapon.name} signature`);
  }
  return [...new Set(base.map((q) => q.replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

function slugForSearchPath(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sourceTemplateResults(ch) {
  const slug = slugForSearchPath(ch.name);
  if (!slug) return [];
  const rows = [
    {
      title: `${ch.name} Genshin Impact kit`,
      url: `https://www.u7buy.com/blog/genshin-impact-${slug}-kit/`,
      snippet: 'Genshin Impact kit, weapons, and signature weapon guide.',
    },
    {
      title: `${ch.name} Genshin Impact materials`,
      url: `https://www.u7buy.com/blog/genshin-impact-${slug}-materials/`,
      snippet: 'Genshin Impact materials and signature weapon guide.',
    },
    {
      title: `${ch.name} Genshin Impact leaks`,
      url: `https://www.enjoygm.com/blog/genshin-impact/${slug}-leaks`,
      snippet: 'Genshin Impact kit, constellations, and signature weapon guide.',
    },
    {
      title: `${ch.name} Genshin Impact leak build guide`,
      url: `https://www.topuplive.com/news/genshin-impact-${slug}-leaks.html`,
      snippet: 'Genshin Impact build, weapons, and signature weapon guide.',
    },
    {
      title: `${ch.name} Genshin Impact kit and constellations`,
      url: `https://beebom.com/genshin-impact-${slug}-kit-constellations/`,
      snippet: 'Genshin Impact kit, constellations, and weapon guide.',
    },
  ];
  return rows.map((row) => ({
    ...row,
    domain: sourceDomain(row.url),
    searchProvider: 'source-template',
    query: 'source-template',
  })).filter((row) => !isBlockedConsensusDomain(row.domain));
}

function parseDuckDuckGoResults(html) {
  const out = [];
  const re = /<a[^>]+class=["'][^"']*\bresult__a\b[^"']*["'][^>]+href=(["'])(?<href>[^"']+)\1[^>]*>(?<title>[\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>(?<snippet>[\s\S]*?)<\/a>|<div[^>]+class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>(?<snippetDiv>[\s\S]*?)<\/div>)/gi;
  for (const match of html.matchAll(re)) {
    const url = decodeSearchUrl(match.groups.href);
    const domain = sourceDomain(url);
    if (!url || isBlockedConsensusDomain(domain)) continue;
    out.push({
      title: cleanText(match.groups.title, 180),
      url,
      domain,
      snippet: cleanText(match.groups.snippet || match.groups.snippetDiv || '', 320),
      searchProvider: 'duckduckgo',
    });
  }
  return out;
}

function parseBingRssResults(xml) {
  const out = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  for (const item of xml.matchAll(itemRe)) {
    const body = item[1];
    const title = cleanText((body.match(/<title>([\s\S]*?)<\/title>/i) || [])[1], 180);
    const url = cleanText((body.match(/<link>([\s\S]*?)<\/link>/i) || [])[1], 500);
    const domain = sourceDomain(url);
    if (!url || isBlockedConsensusDomain(domain)) continue;
    out.push({
      title,
      url,
      domain,
      snippet: cleanText((body.match(/<description>([\s\S]*?)<\/description>/i) || [])[1], 320),
      searchProvider: 'bing-rss',
    });
  }
  return out;
}

function plausibleConsensusResult(result, ch) {
  const hay = norm(`${result.title} ${result.snippet} ${result.url}`);
  const nameKey = norm(ch.name);
  if (!hay.includes(nameKey)) return false;
  if (!hay.includes('genshin')) return false;
  return ['signature', 'weapon', 'build', 'kit', 'materials', 'leak'].some((token) => hay.includes(token));
}

async function searchSignatureSources(ch, compatibleWeapons) {
  const results = [];
  const queries = signatureSearchQueries(ch, compatibleWeapons);
  for (const query of queries) {
    try {
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const html = await fetchSearchText(ddgUrl);
      results.push(...parseDuckDuckGoResults(html).map((row) => ({ ...row, query })));
    } catch (error) {
      results.push({
        title: '',
        url: '',
        domain: '',
        snippet: '',
        searchProvider: 'duckduckgo',
        query,
        error: error?.message || String(error),
      });
    }

    try {
      const bingUrl = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
      const xml = await fetchSearchText(bingUrl, 1);
      results.push(...parseBingRssResults(xml).map((row) => ({ ...row, query })));
    } catch (error) {
      results.push({
        title: '',
        url: '',
        domain: '',
        snippet: '',
        searchProvider: 'bing-rss',
        query,
        error: error?.message || String(error),
      });
    }
  }

  const usable = [...sourceTemplateResults(ch), ...results].filter((row) => row.url && plausibleConsensusResult(row, ch));
  return {
    queries,
    errors: results.filter((row) => row.error).map((row) => ({
      query: row.query,
      provider: row.searchProvider,
      error: row.error,
    })),
    results: uniqBy(usable, (row) => row.url).slice(0, consensusMaxPages),
  };
}

function signatureEvidenceInText(text, ch, weapon, source) {
  const body = cleanText(text, 0);
  if (!body) return null;
  const aliases = weaponAliases(weapon);
  const match = firstMatchIndex(body, aliases);
  if (!match) return null;

  const window = body.slice(Math.max(0, match.index - 320), Math.min(body.length, match.index + 420));
  const windowKey = norm(window);
  if (!windowKey.includes(norm(ch.name))) return null;

  const signature = /\bsignature\s+(weapon|sword|claymore|polearm|bow|catalyst)\b|\b(?:sig|sign)\b/i.test(window);
  const best = /\bbest\s+(weapon|sword|claymore|polearm|bow|catalyst)\b|\brecommended\s+(weapon|sword|claymore|polearm|bow|catalyst)\b/i.test(window);
  if (!signature && !best) return null;

  return {
    character: ch.name,
    weaponId: String(weapon.id),
    weaponName: weapon.name,
    matchedAlias: match.alias,
    kind: signature ? 'signature' : 'best-weapon',
    strength: signature ? 2 : 1,
    matchedText: clipAround(body, match.index),
    title: source.title,
    url: source.url,
    domain: source.domain,
    query: source.query,
    searchProvider: source.searchProvider,
  };
}

function bestEvidenceForSource(text, ch, candidateWeapons, source) {
  const evidence = [];
  for (const weapon of candidateWeapons) {
    const row = signatureEvidenceInText(text, ch, weapon, source);
    if (row) evidence.push(row);
  }
  evidence.sort((a, b) => b.strength - a.strength || a.weaponName.localeCompare(b.weaponName));
  return evidence[0] || null;
}

function consensusFromEvidence(ch, evidence) {
  const byWeapon = new Map();
  for (const row of evidence) {
    const prev = byWeapon.get(row.weaponId) || {
      weaponId: row.weaponId,
      weaponName: row.weaponName,
      sourcesByDomain: new Map(),
    };
    const current = prev.sourcesByDomain.get(row.domain);
    if (!current || row.strength > current.strength) prev.sourcesByDomain.set(row.domain, row);
    byWeapon.set(row.weaponId, prev);
  }

  const candidates = [...byWeapon.values()].map((row) => {
    const sources = [...row.sourcesByDomain.values()].sort((a, b) => b.strength - a.strength || a.domain.localeCompare(b.domain));
    return {
      weaponId: row.weaponId,
      weaponName: row.weaponName,
      sourceCount: sources.length,
      signatureSourceCount: sources.filter((source) => source.kind === 'signature').length,
      score: sources.reduce((sum, source) => sum + source.strength, 0),
      sources,
    };
  }).sort((a, b) => (
    b.score - a.score
    || b.signatureSourceCount - a.signatureSourceCount
    || b.sourceCount - a.sourceCount
    || a.weaponName.localeCompare(b.weaponName)
  ));

  const top = candidates[0];
  const second = candidates[1];
  if (
    top
    && top.signatureSourceCount >= consensusMinSources
    && top.sourceCount >= consensusMinSources
    && top.score > Number(second?.score || 0)
  ) {
    return {
      status: 'ok',
      character: ch.name,
      weaponId: top.weaponId,
      weaponName: top.weaponName,
      evidence: top.sources.slice(0, 6),
      confidence: top.signatureSourceCount >= 3 ? 'high' : 'medium',
      candidates: candidates.map((candidate) => ({
        weaponId: candidate.weaponId,
        weaponName: candidate.weaponName,
        sourceCount: candidate.sourceCount,
        signatureSourceCount: candidate.signatureSourceCount,
        score: candidate.score,
      })),
    };
  }

  return {
    status: 'no-consensus-signature',
    character: ch.name,
    candidates: candidates.map((candidate) => ({
      weaponId: candidate.weaponId,
      weaponName: candidate.weaponName,
      sourceCount: candidate.sourceCount,
      signatureSourceCount: candidate.signatureSourceCount,
      score: candidate.score,
      sources: candidate.sources.slice(0, 3),
    })),
  };
}

async function resolveSignatureByConsensus(ch, weaponsByName) {
  const compatibleWeapons = compatibleWeaponsForCharacter(weaponsByName, ch);
  if (!compatibleWeapons.length) {
    return {
      character: ch.name,
      status: 'no-compatible-local-weapons',
    };
  }

  const search = await searchSignatureSources(ch, compatibleWeapons);
  const sourceRows = [];
  const evidence = [];
  for (const source of search.results) {
    const combinedSnippet = `${source.title}\n${source.snippet}`;
    const snippetEvidence = bestEvidenceForSource(combinedSnippet, ch, compatibleWeapons, source);
    let pageEvidence = null;
    let error = null;
    try {
      const html = await fetchText(source.url, 1);
      const pageText = cleanText(html, 0);
      pageEvidence = bestEvidenceForSource(pageText, ch, compatibleWeapons, source);
    } catch (err) {
      error = err?.message || String(err);
    }

    const chosen = pageEvidence || snippetEvidence;
    sourceRows.push({
      title: source.title,
      url: source.url,
      domain: source.domain,
      query: source.query,
      searchProvider: source.searchProvider,
      status: chosen ? 'matched' : error ? 'fetch-error' : 'no-match',
      ...(chosen ? {
        weaponId: chosen.weaponId,
        weaponName: chosen.weaponName,
        kind: chosen.kind,
        matchedText: chosen.matchedText,
      } : {}),
      ...(error ? { error } : {}),
    });
    if (chosen) evidence.push(chosen);
  }

  const consensus = consensusFromEvidence(ch, evidence);
  return {
    ...consensus,
    searchQueries: search.queries,
    searchErrors: search.errors,
    sources: sourceRows,
  };
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

if (useConsensusFallback && targets.length) {
  const byCharacter = new Map(results.map((row) => [norm(row.character), row]));
  const consensusTargets = targets.filter((ch) => byCharacter.get(norm(ch.name))?.status !== 'ok');
  if (consensusTargets.length) {
    console.log(`GI signatures: web consensus fallback for ${consensusTargets.length} unresolved character(s).`);
    const consensusRows = await mapConcurrent(consensusTargets, async (ch, i) => {
      const row = await resolveSignatureByConsensus(ch, weaponsByName);
      const suffix = row.status === 'ok' ? `${row.weaponName} (${row.confidence})` : row.status;
      console.log(`[consensus ${i + 1}/${consensusTargets.length}] ${ch.name}: ${suffix}`);
      return { ch, row };
    });

    const allWeapons = [...weaponsByName.values()];
    for (const { ch, row } of consensusRows) {
      const key = norm(ch.name);
      const original = byCharacter.get(key) || { character: ch.name, status: 'not-scraped' };
      if (row.status === 'ok') {
        const weapon = allWeapons.find((candidate) => String(candidate.id) === String(row.weaponId));
        byCharacter.set(key, {
          ...original,
          character: ch.name,
          status: 'ok',
          source: 'web-consensus',
          originalStatus: original.status,
          weaponId: String(row.weaponId),
          weaponName: row.weaponName,
          weaponType: weaponTypeLabel(weapon?.type || ch.weapon),
          weaponChannels: weapon?.channels || [weapon?.channel].filter(Boolean),
          consensusConfidence: row.confidence,
          consensusEvidence: row.evidence || [],
          consensusCandidates: row.candidates || [],
          consensusSources: row.sources || [],
          consensusSearchQueries: row.searchQueries || [],
          consensusSearchErrors: row.searchErrors || [],
        });
      } else {
        byCharacter.set(key, {
          ...original,
          consensusStatus: row.status,
          consensusCandidates: row.candidates || [],
          consensusSources: row.sources || [],
          consensusSearchQueries: row.searchQueries || [],
          consensusSearchErrors: row.searchErrors || [],
        });
      }
    }
    results = targets.map((ch) => byCharacter.get(norm(ch.name))).filter(Boolean);
  }
}

const additions = results.filter((row) => row.status === 'ok');
if (additions.length && !dryRun) {
  const next = {
    ...signatureSource,
    source: 'GameWith character build pages + web consensus fallback + existing imported signatures',
    generated: new Date().toISOString(),
    signatures: { ...signatureSource.signatures },
  };
  for (const row of additions) {
    const prev = next.signatures[row.character] || {};
    next.signatures[row.character] = {
      ...prev,
      weaponId: row.weaponId,
      weaponName: row.weaponName,
      source: row.source === 'web-consensus' ? 'web-consensus' : 'gamewith-character-build',
      sourceUrl: row.source === 'web-consensus' ? row.consensusEvidence?.[0]?.url : row.characterPage,
      ...(row.weaponSourceUrl ? { weaponSourceUrl: row.weaponSourceUrl } : {}),
      ...(row.source === 'web-consensus' ? {
        confidence: row.consensusConfidence,
        consensus: {
          minSources: consensusMinSources,
          evidence: (row.consensusEvidence || []).slice(0, 6).map((source) => ({
            title: source.title,
            url: source.url,
            domain: source.domain,
            kind: source.kind,
            matchedAlias: source.matchedAlias,
            matchedText: source.matchedText,
          })),
        },
      } : {}),
      scrapedAt: new Date().toISOString(),
    };
  }
  writeJsonPreserveStyle(signaturesPath, next);
}

const report = {
  generatedAt: new Date().toISOString(),
  startedAt,
  dryRun,
  source: 'GameWith character build pages + web consensus fallback',
  sourcePage: gameWithCharacterListUrl,
  consensus: {
    enabled: useConsensusFallback,
    minSources: consensusMinSources,
    maxPages: consensusMaxPages,
  },
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
