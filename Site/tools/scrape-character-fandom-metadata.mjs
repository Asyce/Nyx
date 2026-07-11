import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const dbDir = path.resolve(root, 'Database');
const fetchTimeoutMs = 20_000;
const userAgent = 'Nyx character metadata scraper (local project data refresh)';

const WIKIS = {
  gi: {
    label: 'Genshin Impact',
    api: 'https://genshin-impact.fandom.com/api.php',
    source: 'GameData/gi/live/characters.json',
    name: (row) => row.name,
  },
  hsr: {
    label: 'Honkai: Star Rail',
    api: 'https://honkai-star-rail.fandom.com/api.php',
    source: 'Prydwen/hsr/characters.json',
    name: (row) => row.name,
  },
  zzz: {
    label: 'Zenless Zone Zero',
    api: 'https://zenless-zone-zero.fandom.com/api.php',
    source: 'GameData/zzz/live/agents.json',
    name: (row) => row.name,
    searchWhenThin: true,
  },
  wuwa: {
    label: 'Wuthering Waves',
    api: 'https://wutheringwaves.fandom.com/api.php',
    source: 'GameData/ww/live/characters.json',
    name: (row) => row.name,
  },
  ae: {
    label: 'Arknights: Endfield',
    api: 'https://arknights-endfield.fandom.com/api.php',
    source: 'Prydwen/endfield/characters.json',
    name: (row) => row.name,
    searchWhenThin: true,
  },
};

const argv = new Set(process.argv.slice(2));
const gameArg = process.argv.find((arg) => arg.startsWith('--game='));
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const games = gameArg
  ? gameArg.replace(/^--game=/, '').split(',').map((s) => s.trim()).filter(Boolean)
  : Object.keys(WIKIS);
const limit = limitArg ? Math.max(0, Number(limitArg.replace(/^--limit=/, '')) || 0) : 0;
const refreshSearch = argv.has('--refresh-search');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.resolve(dbDir, rel), 'utf8'));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normName(s) {
  return String(s || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripWikiText(value, options = {}) {
  const preserveLinks = options.preserveLinks === true;
  let text = decodeHtmlEntities(String(value || ''));
  text = text.split(/<br\s*\/?>/i)[0];
  text = text.replace(/<ref\b[^>]*\/>/gi, '');
  text = text.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/\{\{(?:w|wp)\|([^|{}]+)\|([^{}]+)\}\}/gi, '$2');
  text = text.replace(/\{\{(?:w|wp)\|([^{}]+)\}\}/gi, '$1');
  text = text.replace(/\{\{(?:Lang|lang)\|[^{}]*?\|([^{}]+)\}\}/gi, '$1');
  text = text.replace(/\{\{(?:zh|ja|ko|cn|jp|kr)\|([^{}]+)\}\}/gi, '$1');
  text = text.replace(/\{\{[^{}|]+\|([^{}]+)\}\}/g, '$1');
  text = text.replace(/\{\{[^{}]*\}\}/g, '');
  if (preserveLinks) {
    text = text.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$1|$2');
    text = text.replace(/\[\[([^\]]+)\]\]/g, '$1|$1');
    text = text.replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g, '$1|$2');
  } else {
    text = text.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2');
    text = text.replace(/\[\[([^\]]+)\]\]/g, '$1');
    text = text.replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g, '$2');
  }
  text = text.replace(/\[(https?:\/\/[^\]]+)\]/g, '');
  text = text.replace(/'''?/g, '');
  text = text.replace(/<[^>]+>/g, '');
  return text.replace(/\s+/g, ' ').trim();
}

function extractField(text, names, options = {}) {
  for (const name of names) {
    const re = new RegExp(String.raw`^\|\s*${name}\s*=\s*([\s\S]*?)(?=\n\||\n\}\}|\n<[!/]|$)`, 'im');
    const match = text.match(re);
    const clean = match ? stripWikiText(match[1], options) : '';
    if (clean) return clean;
  }
  return null;
}

function releasePatchFromCategories(categories) {
  const titles = (categories || []).map((cat) => cat.title || cat);
  const released = titles.find((title) => /Released in Version/i.test(title));
  const introduced = titles.find((title) => /Introduced in Version/i.test(title));
  const match = String(released || introduced || '').match(/Version\s+([0-9.]+)/i);
  return match ? match[1] : null;
}

function parseMetadata(name, pageTitle, text, categories, aliases = []) {
  const voiceActors = {
    english: extractField(text, ['voiceEN', 'vaEN', 'englishVA', 'voiceEnglish'], { preserveLinks:true }),
    chinese: extractField(text, ['voiceCN', 'vaCN', 'chineseVA', 'voiceChinese'], { preserveLinks:true }),
    japanese: extractField(text, ['voiceJP', 'vaJP', 'japaneseVA', 'voiceJapanese'], { preserveLinks:true }),
    korean: extractField(text, ['voiceKR', 'vaKR', 'koreanVA', 'voiceKorean'], { preserveLinks:true }),
  };
  Object.keys(voiceActors).forEach((key) => { if (!voiceActors[key]) delete voiceActors[key]; });
  const releaseDate = extractField(text, ['releaseDate', 'release_date', 'release']);
  const releasePatch = releasePatchFromCategories(categories);
  return {
    name,
    pageTitle,
    aliases: Array.from(new Set(aliases.filter(Boolean))),
    releaseDate,
    releasePatch,
    voiceActors: Object.keys(voiceActors).length ? voiceActors : undefined,
    categories: (categories || []).map((cat) => cat.title || cat).filter((title) => /Version/i.test(title)),
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': userAgent } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPage(api, title) {
  const qs = new URLSearchParams({
    action: 'query',
    prop: 'revisions|categories',
    titles: title,
    rvprop: 'content',
    rvslots: 'main',
    cllimit: 'max',
    format: 'json',
    formatversion: '2',
    origin: '*',
  });
  const json = await fetchJson(`${api}?${qs.toString()}`);
  const page = json?.query?.pages?.[0];
  if (!page || page.missing) return null;
  const text = page.revisions?.[0]?.slots?.main?.content || page.revisions?.[0]?.content || '';
  return { title: page.title || title, text, categories: page.categories || [] };
}

async function searchPage(api, name) {
  const qs = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: `${name} playable character`,
    srlimit: '5',
    format: 'json',
    formatversion: '2',
    origin: '*',
  });
  const json = await fetchJson(`${api}?${qs.toString()}`);
  const rows = json?.query?.search || [];
  const nameKey = normName(name);
  const best = rows.find((row) => normName(row.title).includes(nameKey))
    || rows.find((row) => /character|agent|resonator|operator/i.test(`${row.title} ${row.snippet || ''}`))
    || rows[0];
  return best?.title || null;
}

function loadCharacters(cfg) {
  const rows = readJson(cfg.source);
  return rows
    .map((row) => ({ name: cfg.name(row), aliases: [row.name, row.fullName, row.slug, row.id].filter(Boolean) }))
    .filter((row) => row.name)
    .filter((row, index, arr) => arr.findIndex((other) => normName(other.name) === normName(row.name)) === index);
}

async function scrapeGame(gameKey) {
  const cfg = WIKIS[gameKey];
  if (!cfg) throw new Error(`Unknown game "${gameKey}"`);
  const outDir = path.resolve(dbDir, 'Fandom', gameKey);
  ensureDir(outDir);
  let rows = loadCharacters(cfg);
  if (limit) rows = rows.slice(0, limit);
  const metadata = [];
  const missing = [];
  const thin = [];

  for (const [index, row] of rows.entries()) {
    let page = null;
    let pageTitle = row.name;
    try {
      page = await fetchPage(cfg.api, pageTitle);
      if ((!page || (!extractField(page.text, ['releaseDate', 'release_date', 'release']) && !releasePatchFromCategories(page.categories))) && cfg.searchWhenThin) {
        const found = await searchPage(cfg.api, row.name);
        if (found && (refreshSearch || normName(found) !== normName(pageTitle))) {
          const searched = await fetchPage(cfg.api, found);
          if (searched) {
            page = searched;
            pageTitle = found;
          }
        }
      }
      if (!page) {
        missing.push(row.name);
        continue;
      }
      const meta = parseMetadata(row.name, page.title || pageTitle, page.text, page.categories, row.aliases);
      if (!meta.releaseDate && !meta.releasePatch && !meta.voiceActors) thin.push(row.name);
      metadata.push(meta);
    } catch (error) {
      missing.push(`${row.name}: ${error.message || error}`);
    }
    if ((index + 1) % 20 === 0) console.log(`${gameKey}: ${index + 1}/${rows.length}`);
  }

  metadata.sort((a, b) => a.name.localeCompare(b.name));
  const report = {
    game: gameKey,
    label: cfg.label,
    source: cfg.api,
    scrapedAt: new Date().toISOString(),
    total: rows.length,
    saved: metadata.length,
    withReleaseDate: metadata.filter((row) => row.releaseDate).length,
    withReleasePatch: metadata.filter((row) => row.releasePatch).length,
    withVoiceActors: metadata.filter((row) => row.voiceActors && Object.keys(row.voiceActors).length).length,
    missing,
    thin,
  };
  fs.writeFileSync(path.resolve(outDir, 'character-metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
  fs.writeFileSync(path.resolve(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`${gameKey}: saved ${metadata.length}/${rows.length}, release patches ${report.withReleasePatch}, VA ${report.withVoiceActors}`);
}

for (const game of games) {
  await scrapeGame(game);
}
