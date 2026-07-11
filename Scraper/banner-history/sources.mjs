import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { connectPairs, list, localIso, sourceUrl, stableId, templateBlock, templateBlocks, templateFields, windowFrom } from './core.mjs';

const CONFIG = {
  gi:{ host:'https://genshin-impact.fandom.com', category:'Wish', template:'Wish', pool:'Wish Pool', entity:'character', typeMap:{'character event':'character','weapon event':'weapon','chronicled':'mixed','lightrace':'mixed'} },
  hsr:{ host:'https://honkai-star-rail.fandom.com', category:'Warp', template:'Warp', pool:'Warp Pool', entity:'character', typeMap:{'character event':'character','light cone event':'weapon','character collaboration':'character','light cone collaboration':'weapon'} },
  zzz:{ host:'https://zenless-zone-zero.fandom.com', category:'Signal Searches', template:'Signal Search Infobox', pool:'Signal Search Pool', entity:'character', typeMap:{'exclusive channel':'character','exclusive rescreening':'character','w-engine channel':'weapon'} },
  wuwa:{ host:'https://wutheringwaves.fandom.com', category:'Convene', template:'Convene', pool:'Convene/Pool', entity:'character', typeMap:{'featured resonator':'character','featured weapon':'weapon','anniversary resonator':'character','anniversary weapon':'weapon','collab resonator':'character','collab weapon':'weapon'} },
};

export async function getJson(url, { attempts=3 } = {}) {
  const cacheDir = path.join(os.tmpdir(), 'nyx-banner-history-http');
  const cacheFile = path.join(cacheDir, crypto.createHash('sha256').update(url).digest('hex') + '.json');
  let cached = null;
  try { cached = JSON.parse(await fs.readFile(cacheFile, 'utf8')); } catch {}
  let error;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const headers = { 'user-agent':'Nyxarium/1.0 banner history (https://pengo.gg)' };
      if (cached?.etag) headers['if-none-match'] = cached.etag;
      if (cached?.lastModified) headers['if-modified-since'] = cached.lastModified;
      const response = await fetch(url, { headers, signal:AbortSignal.timeout(25_000) });
      if (response.status === 304 && cached?.payload) return cached.payload;
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const payload = await response.json();
      await fs.mkdir(cacheDir, { recursive:true });
      await fs.writeFile(cacheFile, JSON.stringify({ etag:response.headers.get('etag'), lastModified:response.headers.get('last-modified'), payload }));
      return payload;
    } catch (caught) {
      error = caught;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
    }
  }
  throw new Error(`Fetch failed ${url}: ${error?.message}`);
}

function api(host, params) { return `${host}/api.php?${new URLSearchParams({ ...params, format:'json', origin:'*' })}`; }

export async function categoryTitles(config) {
  const titles = [];
  let cmcontinue;
  do {
    const payload = await getJson(api(config.host, { action:'query', list:'categorymembers', cmtitle:`Category:${config.category}`, cmnamespace:'0', cmlimit:'max', ...(cmcontinue ? { cmcontinue } : {}) }));
    titles.push(...(payload.query?.categorymembers || []).map((row) => row.title));
    cmcontinue = payload.continue?.cmcontinue;
  } while (cmcontinue);
  return titles;
}

export async function parseWikiPage(host, title) {
  const payload = await getJson(api(host, { action:'parse', page:title, prop:'wikitext|revid|externallinks' }));
  if (!payload.parse?.wikitext?.['*'] || !payload.parse?.revid) throw new Error(`No parse result for ${title}`);
  const cacheDir = path.join(os.tmpdir(), 'nyx-banner-history-cache');
  await fs.mkdir(cacheDir, { recursive:true });
  await fs.writeFile(path.join(cacheDir, Buffer.from(`${host}/${title}`).toString('base64url') + '.json'), JSON.stringify(payload));
  return { title:payload.parse.title, revision:payload.parse.revid, text:payload.parse.wikitext['*'], externalLinks:payload.parse.externallinks || [] };
}

function version(text) { return text.match(/\{\{Change History\s*\|\s*([^}|\n]+)/i)?.[1]?.trim() || undefined; }
function cleanName(fields, title) { return String(fields.name || title.split('/')[0]).replace(/\s+\d{4}-\d{2}-\d{2}$/, '').trim(); }
function addFeatured(rows, value, entityType, rarity, primary) {
  for (const name of list(value)) if (!rows.some((row) => row.entityType === entityType && row.name === name)) rows.push({ entityType, name, rarity, primary });
}
function legacyTemplateFields(block) {
  const fields = {};
  const body = block.replace(/^\{\{[^\n|]+\|?/, '').replace(/\}\}\s*$/, '');
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^\s*\|\s*([^=]+?)\s*=\s*(.*?)\s*$/);
    if (match) fields[match[1].trim().toLowerCase()] = match[2].trim();
  }
  return fields;
}

export function parseFandomRun(game, page) {
  const config = CONFIG[game];
  const infoBlock = templateBlock(page.text, config.template);
  if (!infoBlock) return null;
  const fields = templateFields(infoBlock.text);
  const mapped = config.typeMap[String(fields.type || '').toLowerCase()];
  const duration = String(fields.duration || '').toLowerCase();
  const permanent = ['permanent','perm','indefinite'].includes(duration) || (!fields.time_end || fields.time_end === 'none') && /^(?:standard|novice|permanent)$/i.test(fields.type || '');
  if (!mapped && !permanent) return null;
  const poolBlock = templateBlock(page.text, config.pool);
  const pool = poolBlock ? templateFields(poolBlock.text) : {};
  const hasCharacterPool = Boolean(pool.character_5 || pool.character_4 || pool.agent_s || pool.resonator_5);
  const hasWeaponPool = Boolean(pool.weapon_5 || pool.weapon_4 || pool.lightcone_5 || pool['w-engine_s']);
  const bannerType = mapped || (hasCharacterPool && hasWeaponPool ? 'mixed' : (hasWeaponPool || /weapon/i.test(`${fields.type} ${page.title}`) ? 'weapon' : 'character'));
  const featured = [];
  if (game === 'gi') {
    addFeatured(featured, pool.character_5_f, 'character', 5, true); addFeatured(featured, pool.character_4_f, 'character', 4, false);
    addFeatured(featured, pool.weapon_5_f, 'weapon', 5, true); addFeatured(featured, pool.weapon_4_f, 'weapon', 4, false);
    if (bannerType === 'mixed') {
      addFeatured(featured, pool.character_5, 'character', 5, true); addFeatured(featured, pool.character_4, 'character', 4, false);
      addFeatured(featured, pool.weapon_5, 'weapon', 5, true); addFeatured(featured, pool.weapon_4, 'weapon', 4, false);
    }
  } else if (game === 'hsr') {
    addFeatured(featured, pool.character_5_f, 'character', 5, true); addFeatured(featured, pool.character_4_f, 'character', 4, false);
    addFeatured(featured, pool.lightcone_5_f, 'weapon', 5, true); addFeatured(featured, pool.lightcone_4_f, 'weapon', 4, false);
  } else if (game === 'zzz') {
    addFeatured(featured, pool.agent_s_f, 'character', 'S', true); addFeatured(featured, pool.agent_a_f, 'character', 'A', false);
    addFeatured(featured, pool['w-engine_s_f'], 'weapon', 'S', true); addFeatured(featured, pool['w-engine_a_f'], 'weapon', 'A', false);
  } else {
    addFeatured(featured, pool.resonator_5_f, 'character', 5, true); addFeatured(featured, pool.resonator_4_f, 'character', 4, false);
    addFeatured(featured, pool.weapon_5_f, 'weapon', 5, true); addFeatured(featured, pool.weapon_4_f, 'weapon', 4, false);
  }
  if (!featured.length && !permanent) throw new Error(`${game} ${page.title} has no featured pool`);
  const url = sourceUrl(config.host, page.title);
  const window = windowFrom(fields, { source:url, defaultOffset:'+08:00' });
  const windowsByRegion = window ? { asia:window } : {};
  if (game === 'wuwa' && window) {
    const resetSource = 'https://wutheringwaves.fandom.com/wiki/Reset';
    for (const [region, offset] of [['europe','+01:00'], ['america','-05:00']]) {
      const regional = windowFrom({ ...fields, time_start_offset:offset, time_end_offset:offset }, { source:resetSource, defaultOffset:offset });
      if (regional) windowsByRegion[region] = regional;
    }
  }
  const record = {
    id:'pending', game, bannerType, category:fields.type || (permanent ? 'Permanent' : 'Event'), name:cleanName(fields, page.title),
    ...(version(page.text) ? { version:version(page.text) } : {}), windowsByRegion,
    ...(!window && /^\d{4}-\d{2}-\d{2}/.test(fields.time_start || '') ? { dateOnly:{ start:fields.time_start.slice(0,10), ...(/^\d{4}-\d{2}-\d{2}/.test(fields.time_end || '') ? { end:fields.time_end.slice(0,10) } : {}), sourceUrl:url } } : {}), permanent,
    featured, pairedBannerIds:[], source:{ url, kind:'maintained-wiki', revision:page.revision }, fetchedAt:new Date().toISOString(),
    confirmed:Boolean(fields.link || permanent || (window?.end && Date.parse(window.end) < Date.now())), _title:page.title, _officialLink:fields.link || '',
    _alongside:[fields.alongside, fields.alongside2, fields.alongside3].filter(Boolean).join(';'),
  };
  record.id = stableId({ ...record, name:page.title });
  const legacyFields = legacyTemplateFields(infoBlock.text);
  const legacyMapped = config.typeMap[String(legacyFields.type || '').toLowerCase()];
  const legacyPermanent = String(legacyFields.duration || '').toLowerCase() !== 'event' || !legacyFields.time_end;
  const legacyWindow = windowFrom(legacyFields, { source:url, defaultOffset:'+08:00' });
  const aliases = [];
  if (record.bannerType === 'mixed') aliases.push(stableId({ ...record, name:page.title, bannerType:'character' }));
  if (legacyMapped || legacyPermanent) aliases.push(stableId({ ...record, name:page.title, bannerType:legacyMapped || (/weapon/i.test(legacyFields.type || '') ? 'weapon' : 'character'), category:legacyFields.type || record.category, windowsByRegion:legacyWindow ? { asia:legacyWindow } : {} }));
  record.legacyIds = [...new Set(aliases.filter((id) => id !== record.id))];
  if (!record.legacyIds.length) delete record.legacyIds;
  return record;
}

export async function scrapeFandomGame(game) {
  const config = CONFIG[game];
  let titles;
  if (game === 'wuwa') {
    const template = await getJson(api(config.host, { action:'parse', page:'Template:Convene List', prop:'links|revid' }));
    titles = (template.parse?.links || []).map((row) => row['*']).filter((title) => /\/\d{4}-\d{2}-\d{2}$/.test(title));
    titles.push('Tidal Chorus', 'Standard Weapon Convene', 'Utterance of Marvels', "Beginner's Choice Convene");
  } else titles = await categoryTitles(config);
  if (!titles.length) throw new Error(`${game} discovery returned no pages`);
  const records = [];
  const queue = [...new Set(titles)];
  const workers = Array.from({ length:8 }, async () => {
    while (queue.length) {
      const title = queue.shift();
      const record = parseFandomRun(game, await parseWikiPage(config.host, title));
      if (record) records.push(record);
    }
  });
  await Promise.all(workers);
  records.sort((a, b) => (Object.values(a.windowsByRegion)[0]?.start || '').localeCompare(Object.values(b.windowsByRegion)[0]?.start || '') || a.id.localeCompare(b.id));
  connectPairs(records);
  await applyOfficialLatest(game, records);
  for (const row of records) delete row._officialLink;
  return records;
}

function wallTimeFromAsia(iso) {
  const date = new Date(Date.parse(iso) + 8 * 3_600_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')} ${String(date.getUTCHours()).padStart(2,'0')}:${String(date.getUTCMinutes()).padStart(2,'0')}:${String(date.getUTCSeconds()).padStart(2,'0')}`;
}

function officialMentionsWindow(text, row) {
  const asia = row.windowsByRegion?.asia;
  if (!asia?.start || !asia?.end) return false;
  const normalized = String(text).replace(/[/.]/g, '-');
  return [wallTimeFromAsia(asia.start), wallTimeFromAsia(asia.end)].every((stamp) => normalized.includes(stamp.slice(0,16)));
}

function addServerLocalRegions(row, officialUrl) {
  const asia = row.windowsByRegion?.asia;
  if (!asia?.start) return;
  const start = wallTimeFromAsia(asia.start); const end = asia.end ? wallTimeFromAsia(asia.end) : null;
  for (const [region, offset] of [['europe','+01:00'],['america','-05:00']]) {
    row.windowsByRegion[region] = { start:localIso(start, offset), ...(end ? { end:localIso(end, offset) } : {}), timezone:`UTC${offset}`, sourceUrl:officialUrl };
  }
}

async function hoyolabPost(url) {
  const id = String(url).match(/hoyolab\.com\/article\/(\d+)/i)?.[1];
  if (!id) return null;
  const payload = await getJson(`https://bbs-api-os.hoyolab.com/community/post/wapi/getPostFull?post_id=${id}`);
  const post = payload.data?.post?.post;
  if (!post?.structured_content) return null;
  let rows;
  try { rows = JSON.parse(post.structured_content); } catch { return null; }
  const text = rows.map((row) => typeof row.insert === 'string' ? row.insert : '').join('\n');
  return { text, url, revision:post.last_modify_time || post.post_id, subject:post.subject };
}

export async function applyOfficialLatest(game, records) {
  const cutoff = Date.now() - 240 * 86_400_000;
  if (game === 'wuwa') {
    const menu = await getJson('https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en/ArticleMenu.json');
    const candidates = menu.filter((row) => /convene/i.test(row.articleTitle || '') && Date.parse(String(row.startTime || '').replace(' ', 'T') + '+08:00') >= cutoff).slice(0, 40);
    await Promise.all(candidates.map(async (item) => {
      const detail = await getJson(`https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en/article/${item.articleId}.json`);
      const text = String(detail.articleContent || '').replace(/<[^>]+>/g, ' ');
      const url = `https://wutheringwaves.kurogames.com/en/main/news/detail/${item.articleId}`;
      const matched = records.filter((row) => text.toLowerCase().includes(row.name.toLowerCase()) && (String(row._officialLink).includes(`/detail/${item.articleId}`) || officialMentionsWindow(text, row)));
      for (const row of matched) { row.confirmed = true; row.officialSource = { url, kind:'official-latest', revision:String(item.articleId) }; if (officialMentionsWindow(text, row)) addServerLocalRegions(row, url); }
    }));
    return;
  }
  if (game === 'gi') {
    const regionMap = { asia:['os_asia','+08:00'], europe:['os_euro','+01:00'], america:['os_usa','-05:00'] };
    const announcements = {};
    for (const [region, [server, offset]] of Object.entries(regionMap)) {
      const endpoint = `https://sg-hk4e-api.hoyolab.com/common/hk4e_global/announcement/api/getAnnContent?game=hk4e&game_biz=hk4e_global&lang=en-us&bundle_id=hk4e_global&platform=pc&region=${server}&level=60&uid=800000000`;
      const payload = await getJson(endpoint);
      announcements[region] = { endpoint, offset, rows:payload.data?.list || [] };
    }
    for (const row of records) {
      const asia = row.windowsByRegion?.asia;
      const latest = asia ? Date.parse(asia.end || asia.start) : 0;
      if (latest < cutoff) continue;
      const boundaryDates = [asia?.start, asia?.end].filter(Boolean).map((iso) => wallTimeFromAsia(iso).slice(0,10));
      const matches = Object.entries(announcements).map(([region, group]) => [region, group, group.rows.find((ann) => {
        const combined = `${ann.title} ${ann.subtitle} ${ann.content}`;
        const normalized = combined.replace(/\//g, '-').toLowerCase();
        return normalized.includes(row.name.toLowerCase()) && boundaryDates.some((date) => normalized.includes(date));
      })]).filter(([, , ann]) => ann);
      if (!matches.length) continue;
      const [, firstGroup, first] = matches[0];
      row.confirmed = true; row.officialSource = { url:firstGroup.endpoint, kind:'official-latest', revision:String(first.ann_id) };
      for (const [region, group, ann] of matches) {
        const text = String(ann.content || '').replace(/<[^>]+>/g, ' ');
        const dates = [...text.matchAll(/(20\d{2})[/-](\d{2})[/-](\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/g)].map((m) => `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] || '00'}`);
        if (dates.length >= 2) row.windowsByRegion[region] = { start:localIso(dates[0], group.offset), end:localIso(dates[1], group.offset), timezone:`UTC${group.offset}`, sourceUrl:group.endpoint };
      }
    }
  }
  const links = new Map();
  for (const row of records) {
    const latest = Math.max(...Object.values(row.windowsByRegion || {}).map((window) => Date.parse(window.end || window.start)).filter(Number.isFinite), 0);
    if (latest >= cutoff && /hoyolab\.com\/article\/\d+/i.test(row._officialLink || '')) links.set(row._officialLink, null);
  }
  const queue = [...links.keys()];
  await Promise.all(Array.from({length:4}, async () => { while (queue.length) { const link=queue.shift(); try { links.set(link, await hoyolabPost(link)); } catch {} } }));
  for (const row of records) {
    const official = links.get(row._officialLink);
    if (!official || !official.text.toLowerCase().includes(row.name.toLowerCase())) continue;
    row.confirmed = true; row.officialSource = { url:official.url, kind:'official-latest', revision:String(official.revision) };
    if (officialMentionsWindow(official.text, row)) addServerLocalRegions(row, official.url);
  }
}

function endfieldWindows(fields, url, provisional=false) {
  const windows = {};
  const asiaStart = localIso(fields['asia start'] || fields.start, '+08:00');
  const asiaEnd = provisional ? null : localIso(fields['asia end'] || fields.end, '+08:00');
  const syncedStart = fields['start synced'] === 'yes' ? asiaStart : null;
  const syncedEnd = fields['end synced'] === 'yes' ? asiaEnd : null;
  const add = (region, start, end, timezone) => { if (start) windows[region] = { start, ...(end ? { end } : {}), timezone, sourceUrl:url }; };
  if (syncedStart && syncedEnd) add('global', syncedStart, syncedEnd, 'UTC');
  else {
    add('asia', asiaStart, asiaEnd, 'UTC+08:00');
    const ameuStart = localIso(fields['ameu start'], '-05:00') || syncedStart;
    const ameuEnd = provisional ? null : (localIso(fields['ameu end'], '-05:00') || syncedEnd);
    add('america', ameuStart, ameuEnd, 'UTC-05:00');
    add('europe', ameuStart, ameuEnd, 'UTC-05:00');
  }
  return windows;
}

export function parseEndfieldYear(page, kind) {
  const template = kind === 'character' ? 'Banners cell' : 'Issues cell';
  const rows = [];
  for (const block of templateBlocks(page.text, template)) {
    const fields = templateFields(block.text);
    if (!fields.name) continue;
    const before = page.text.slice(Math.max(0, block.start - 140), block.start);
    const provisional = /not final:[\s\S]*calculated/i.test(before);
    const permanent = /permanent\s*=\s*(?:yes|true)/i.test(block.text) || fields.name === 'Basic Headhunting';
    const url = sourceUrl('https://endfield.wiki.gg', page.title);
    const featured = [];
    if (kind === 'character') {
      for (const name of list(fields.operators)) featured.push({ entityType:'character', name, rarity:6, primary:name === fields.rateup });
      for (const name of list(fields.quota)) featured.push({ entityType:'character', name, rarity:5, primary:false });
    } else {
      for (const name of list(fields.weapons)) featured.push({ entityType:'weapon', name, rarity:name === fields.rateup ? 6 : 5, primary:name === fields.rateup });
    }
    const record = { id:'pending', game:'ae', bannerType:kind, category:kind === 'character' ? (permanent ? 'Permanent Headhunting' : 'Headhunting') : (permanent ? 'Permanent Arsenal' : 'Arsenal Exchange'), name:fields.name,
      version:page.title.match(/(\d{4})$/)?.[1], windowsByRegion:endfieldWindows(fields, url, provisional), permanent, featured, pairedBannerIds:[],
      source:{ url, kind:'maintained-wiki', revision:page.revision }, fetchedAt:new Date().toISOString(), confirmed:permanent || (!provisional && Object.values(endfieldWindows(fields, url)).some((x) => x.end && Date.parse(x.end) < Date.now())) };
    record.id = stableId(record); rows.push(record);
  }
  return rows;
}

const MONTHS = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
function endfieldOfficialLocal(value) {
  const match = String(value).match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\s+at\s+(\d{1,2}):(\d{2})/i);
  if (!match) return null;
  return `${match[3]}-${String(MONTHS[match[1].toLowerCase()]).padStart(2,'0')}-${String(match[2]).padStart(2,'0')} ${String(match[4]).padStart(2,'0')}:${match[5]}:00`;
}

export function mergeEndfieldOfficialWindow(row, detail, officialUrl) {
  const text = String(detail?.data || '').replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|amp);/g, ' ').replace(/\s+/g, ' ');
  const escaped = row.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`\\[${escaped}(?: Issue)?\\][\\s\\S]{0,1400}?Availability:\\s*([^·]{1,500})`, 'i'));
  if (!match) return false;
  const availability = match[1];
  const local = endfieldOfficialLocal(availability);
  if (!local) return false;
  const beforeDate = availability.slice(0, availability.search(/January|February|March|April|May|June|July|August|September|October|November|December/i));
  const isStart = /^\s*(?:opens\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)/i.test(availability) || /^\s*opens\s+/i.test(availability);
  const isEnd = !isStart && /(?:–|—|-)\s*$/.test(beforeDate.trim());
  if (!isStart && !isEnd) return false;
  for (const [region, offset] of [['asia','+08:00'],['america','-05:00'],['europe','-05:00']]) {
    const existing = row.windowsByRegion[region] || {};
    const instant = localIso(local, offset);
    const start = isStart ? instant : existing.start;
    const end = isEnd ? instant : existing.end;
    if (start) row.windowsByRegion[region] = { start, ...(end ? { end } : {}), timezone:`UTC${offset}`, sourceUrl:officialUrl };
  }
  return true;
}

export async function scrapeEndfield() {
  const host = 'https://endfield.wiki.gg';
  const discoverYears = async (indexTitle, prefix) => {
    const payload = await getJson(api(host, { action:'parse', page:indexTitle, prop:'links|revid' }));
    const titles = (payload.parse?.links || []).map((row) => row['*']).filter((title) => new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\/\\d{4}$`).test(title));
    if (!titles.length) throw new Error(`Endfield year discovery found no ${prefix} pages`);
    return [...new Set(titles)].sort();
  };
  const operatorTitles = await discoverYears('Headhunting/Banners', 'Headhunting/Banners');
  const weaponTitles = await discoverYears('Arsenal Exchange/Issues', 'Arsenal Exchange/Issues');
  const records = [];
  for (const title of operatorTitles) records.push(...parseEndfieldYear(await parseWikiPage(host, title), 'character'));
  for (const title of weaponTitles) records.push(...parseEndfieldYear(await parseWikiPage(host, title), 'weapon'));
  if (!records.some((x) => x.bannerType === 'character') || !records.some((x) => x.bannerType === 'weapon')) throw new Error('Endfield source lost a banner type');
  const officialDetails = [];
  for (let page = 1; page <= 4; page += 1) {
    const payload = await getJson(`https://web-news.gryphline.com/api/bulletin?lang=en-us&code=arknights_endfield_official&page=${page}&pageSize=20&tabs[]=notices`);
    for (const notice of payload.data?.list || []) if (/headhunt|issue|version update notes/i.test(notice.title || '')) {
      const detail = await getJson(`https://web-news.gryphline.com/api/bulletin/${notice.cid}?lang=en-us&code=arknights_endfield_official`);
      officialDetails.push(detail.data);
    }
  }
  for (const detail of officialDetails) {
    const haystack = String(detail?.data || '').replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|quot);/g, ' ');
    const found = records.filter((row) => haystack.toLowerCase().includes(row.name.toLowerCase()));
    const officialUrl = `https://web-news.gryphline.com/api/bulletin/${detail.cid}?lang=en-us&code=arknights_endfield_official`;
    for (const row of found) {
      row.confirmed = true;
      const dedicated = new RegExp(`^\\[${row.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?: Issue)?\\]`, 'i').test(detail.title || '');
      const score = dedicated ? 2 : 1;
      if (!row._officialScore || score > row._officialScore) { row.officialSource = { url:officialUrl, kind:'official-latest', revision:String(detail.cid) }; row._officialScore = score; }
      mergeEndfieldOfficialWindow(row, detail, officialUrl);
    }
    for (const character of found.filter((x) => x.bannerType === 'character')) for (const weapon of found.filter((x) => x.bannerType === 'weapon')) {
      const characterStart = character.windowsByRegion.global?.start || character.windowsByRegion.asia?.start;
      const weaponStart = weapon.windowsByRegion.global?.start || weapon.windowsByRegion.asia?.start;
      if (characterStart && characterStart === weaponStart) {
        character.pairedBannerIds.push(weapon.id); weapon.pairedBannerIds.push(character.id);
        character.pairSourceUrl = officialUrl; weapon.pairSourceUrl = officialUrl;
      }
    }
  }
  for (const row of records) { row.pairedBannerIds = [...new Set(row.pairedBannerIds)].sort(); delete row._officialScore; }
  return records.sort((a,b) => a.id.localeCompare(b.id));
}

export function parseKuroOfficial(article) {
  const text = String(article?.articleContent || '').replace(/<[^>]+>/g, ' ').replace(/&ndash;|–/g, '-');
  const names = [...text.matchAll(/(?:Resonator|Weapon) Convene[^:]*:\s*([^\n<]+)/gi)].map((m) => m[1].trim());
  const dates = [...text.matchAll(/(\d{4})[-/]([01]\d)[-/]([0-3]\d)\s+([0-2]\d):([0-5]\d)/g)].map((m) => `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:00`);
  return { id:String(article?.articleId || ''), title:article?.articleTitle, names, start:dates[0] ? localIso(dates[0], '+08:00') : null, end:dates[1] ? localIso(dates[1], '+08:00') : null };
}

export function parseGryphlineOfficial(detail) {
  const html = String(detail?.data || detail?.content || '');
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  const bannerNames = [...text.matchAll(/[“"]([^”"]+)[”"](?:\s+(?:Headhunting|Arsenal))/gi)].map((m) => m[1]);
  const dates = [...text.matchAll(/(\d{4})[-/]([01]\d)[-/]([0-3]\d)\s+([0-2]\d):([0-5]\d)/g)].map((m) => `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:00`);
  return { cid:String(detail?.cid || ''), title:detail?.title, bannerNames, dates };
}
