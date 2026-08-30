#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DATABASE_DIR,
  contentHash,
  fetchJson,
  readJson,
} from '../lib/common.mjs';

export const PAGE_SIZE = 30;
export const MAX_PAGES = 20;
export const MAX_ROWS = PAGE_SIZE * MAX_PAGES;
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const MAX_NAME_BYTES = 512;
export const SHADOW_REQUEST_TIMEOUT_MS = 2_500;

export const HOYO_GAMES = Object.freeze([
  {
    game: 'gi',
    wikiApp: 'genshin',
    collections: [
      { style: 'character', collection: 'characters', fileKey: 'characters' },
      { style: 'weapon', collection: 'weapons', fileKey: 'weapons' },
      { style: 'reliquary', collection: 'artifacts', fileKey: 'artifacts' },
    ],
  },
  {
    game: 'hsr',
    wikiApp: 'hsr',
    collections: [
      { style: 'character', collection: 'characters', fileKey: 'characters' },
      { style: 'equipment', collection: 'lightcones', fileKey: 'lightcones' },
      { style: 'relic', collection: 'relics', fileKey: 'relics' },
    ],
  },
  {
    game: 'zzz',
    wikiApp: 'zzz',
    collections: [
      { style: 'agent', collection: 'agents', fileKey: 'agents' },
      { style: 'w_engine', collection: 'w-engines', fileKey: 'wEngines' },
      { style: 'drivedisc', collection: 'drive-discs', fileKey: 'driveDiscs' },
    ],
  },
]);

const HSR_PATH_NAMES = Object.freeze({
  Warrior: 'Destruction',
  Rogue: 'Hunt',
  Mage: 'Erudition',
  Knight: 'Preservation',
  Warlock: 'Nihility',
  Shaman: 'Harmony',
  Priest: 'Abundance',
  Memory: 'Remembrance',
  Elation: 'Elation',
});

const HASH_ALL_KEYS = new Set();
const shadowHash = (value) => contentHash(value, HASH_ALL_KEYS);
const EMPTY_HASH = shadowHash([]);
const BETA_STATUSES = new Set(['live', 'beta', 'beta_changed']);

class ShadowError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new ShadowError(code);
}

function errorCode(error, fallback) {
  return error instanceof ShadowError ? error.code : fallback;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareIds(left, right) {
  const a = String(left);
  const b = String(right);
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const numeric = BigInt(a) - BigInt(b);
    if (numeric < 0n) return -1;
    if (numeric > 0n) return 1;
  }
  return a.localeCompare(b);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

export function canonicalRowsHash(rows, idOf = (row) => row.id ?? row.entry_page_id) {
  return shadowHash([...rows]
    .sort((left, right) => compareIds(idOf(left), idOf(right)))
    .map(canonicalValue));
}

function schemaProjection(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const variants = [...new Set(value.map((item) => JSON.stringify(schemaProjection(item))))]
      .sort()
      .map((item) => JSON.parse(item));
    return { type: 'array', items: variants };
  }
  if (isObject(value)) {
    return {
      type: 'object',
      fields: Object.fromEntries(Object.keys(value).sort().map((key) => [key, schemaProjection(value[key])])),
    };
  }
  return typeof value;
}

function schemaVariants(values) {
  return [...new Set(values.map((value) => JSON.stringify(schemaProjection(value))))].sort();
}

function schemaHash(payloads) {
  const envelopes = payloads.map((payload) => ({
    ...payload,
    data: { ...payload.data, list: [] },
  }));
  const entries = payloads.flatMap((payload) => payload.data.list);
  return shadowHash({ envelopes: schemaVariants(envelopes), entries: schemaVariants(entries) });
}

export function normalizeAlias(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/<[^>]*>/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function buildLocalAliases(game, row) {
  const values = [row.name, row.codeName];
  if (Array.isArray(row.aliases)) values.push(...row.aliases);
  if (isObject(row.profile)) values.push(row.profile.full_name, row.profile.fullName);

  if (game === 'gi' && normalizeAlias(row.name) === 'traveler' && typeof row.element === 'string') {
    values.push(`${row.name}${row.element}`);
  }

  if (game === 'hsr') {
    const base = row.name === '{NICKNAME}' ? 'Trailblazer' : row.name;
    const officialPath = HSR_PATH_NAMES[row.path];
    if (typeof base === 'string' && normalizeAlias(base)) {
      values.push(base);
      if (officialPath) values.push(`${base}${officialPath}`, `${base}The${officialPath}`);
    }
  }

  return [...new Set(values.map(normalizeAlias).filter(Boolean))].sort();
}

function containsGameDataAsset(value) {
  if (typeof value === 'string') return /^GameData\/[^/]+\/assets\//.test(value);
  if (Array.isArray(value)) return value.some(containsGameDataAsset);
  return isObject(value) && Object.values(value).some(containsGameDataAsset);
}

export function validateLocalRows(game, channel, rows) {
  if (!Array.isArray(rows)) fail('LOCAL_ROWS_INVALID');
  const seen = new Set();

  return rows.map((row) => {
    if (!isObject(row)) fail('LOCAL_ROW_INVALID');
    if (typeof row.id !== 'string' || !row.id || row.id.trim() !== row.id || seen.has(row.id)) {
      fail('LOCAL_ID_INVALID');
    }
    seen.add(row.id);
    if (row.aliases !== undefined
      && (!Array.isArray(row.aliases) || row.aliases.some((alias) => typeof alias !== 'string'))) {
      fail('LOCAL_ALIASES_INVALID');
    }
    if (channel === 'live' ? row.contentStatus !== 'live' : !BETA_STATUSES.has(row.contentStatus)) {
      fail('LOCAL_CONTENT_STATUS_INVALID');
    }
    const aliases = buildLocalAliases(game, row);
    if ((channel === 'live' && (typeof row.name !== 'string' || !normalizeAlias(row.name)))
      || aliases.length === 0) fail('LOCAL_NAME_INVALID');
    return {
      id: row.id,
      aliases,
      hasAsset: containsGameDataAsset(row),
    };
  });
}

function positiveVersion(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  return typeof value === 'string'
    && /^[1-9]\d*(?:\.\d+)*(?:[+-][A-Za-z0-9.-]+)?$/.test(value);
}

export function validateMetadata(metadata, channel) {
  if (!isObject(metadata)
    || metadata.channel !== channel
    || !positiveVersion(metadata.version)
    || !isObject(metadata.files)) {
    fail('LOCAL_METADATA_INVALID');
  }
  return metadata;
}

function collectionPath(databaseDir, metadata, game, channel, fileKey) {
  const relative = metadata.files[fileKey];
  const posix = typeof relative === 'string' ? relative.replaceAll('\\', '/') : '';
  if (path.posix.normalize(posix) !== posix
    || !posix.startsWith(`GameData/${game}/${channel}/`)
    || !posix.endsWith('.json')) {
    fail('LOCAL_FILE_PATH_INVALID');
  }
  const resolved = path.resolve(databaseDir, ...posix.split('/'));
  const outside = path.relative(path.resolve(databaseDir), resolved);
  if (outside.startsWith('..') || path.isAbsolute(outside)) fail('LOCAL_FILE_PATH_INVALID');
  return resolved;
}

async function loadMetadata(databaseDir, game, channel, readJsonImpl) {
  try {
    return validateMetadata(await readJsonImpl(path.join(databaseDir, 'GameData', game, channel, 'metadata.json')), channel);
  } catch (error) {
    if (error instanceof ShadowError) throw error;
    fail('LOCAL_METADATA_READ_FAILED');
  }
}

async function loadLocalCollection(databaseDir, game, collection, liveMetadata, betaMetadata, readJsonImpl) {
  try {
    const liveRows = await readJsonImpl(collectionPath(
      databaseDir, liveMetadata, game, 'live', collection.fileKey,
    ));
    const betaRows = await readJsonImpl(collectionPath(
      databaseDir, betaMetadata, game, 'beta', collection.fileKey,
    ));
    const live = validateLocalRows(game, 'live', liveRows);
    const beta = validateLocalRows(game, 'beta', betaRows);
    return {
      live,
      beta,
      localLiveCount: live.length,
      localBetaCount: beta.length,
      localWithoutAsset: live.filter((row) => !row.hasAsset).length,
      localIdentityHash: shadowHash({
        live: [...live].sort((a, b) => compareIds(a.id, b.id)).map(({ id, aliases }) => ({ id, aliases })),
        beta: [...beta].sort((a, b) => compareIds(a.id, b.id)).map(({ id, aliases }) => ({ id, aliases })),
      }),
    };
  } catch (error) {
    if (error instanceof ShadowError) throw error;
    fail('LOCAL_COLLECTION_READ_FAILED');
  }
}

function requestHeaders(game) {
  return {
    origin: 'https://wiki.hoyolab.com',
    referer: `https://wiki.hoyolab.com/pc/${game.wikiApp}/home`,
    'x-rpc-wiki_app': game.wikiApp,
    'x-rpc-language': 'en-us',
  };
}

function apiUrl(game, operation) {
  return `https://sg-act-public-api.hoyolab.com/hoyowiki/${game.wikiApp}/wapi/${operation}`;
}

function payloadBytes(payload, tooLargeCode, envelopeCode) {
  let serialized;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    fail(envelopeCode);
  }
  if (serialized === undefined) fail(envelopeCode);
  if (Buffer.byteLength(serialized) > MAX_PAGE_BYTES) fail(tooLargeCode);
}

function validateEnvelope(payload, prefix) {
  if (!isObject(payload) || typeof payload.retcode !== 'number' || typeof payload.message !== 'string') {
    fail(`${prefix}_ENVELOPE_INVALID`);
  }
  if (payload.retcode !== 0) fail(`${prefix}_RETCODE`);
  if (!isObject(payload.data)) fail(`${prefix}_ENVELOPE_INVALID`);
}

async function fetchMenus(game, fetchJsonImpl) {
  let payload;
  try {
    payload = await fetchJsonImpl(apiUrl(game, 'get_menus'), {
      cache: false,
      maxBytes: MAX_PAGE_BYTES,
      retries: 0,
      timeoutMs: SHADOW_REQUEST_TIMEOUT_MS,
      headers: requestHeaders(game),
    });
  } catch {
    fail('MENU_FETCH_FAILED');
  }
  payloadBytes(payload, 'MENU_PAYLOAD_TOO_LARGE', 'MENU_ENVELOPE_INVALID');
  validateEnvelope(payload, 'MENU');
  if (!Array.isArray(payload.data.menus)) fail('MENU_ENVELOPE_INVALID');
  return payload.data.menus;
}

export function discoverMenu(menus, style) {
  if (!Array.isArray(menus)) fail('MENU_ENVELOPE_INVALID');
  const matches = [];

  function visit(items) {
    for (const menu of items) {
      if (!isObject(menu)) fail('MENU_ENVELOPE_INVALID');
      if (menu.style === style && menu.has_page === true && menu.is_hidden === false) matches.push(menu);
      if (menu.sub_menus !== undefined) {
        if (!Array.isArray(menu.sub_menus)) fail('MENU_ENVELOPE_INVALID');
        visit(menu.sub_menus);
      }
    }
  }

  visit(menus);
  if (matches.length !== 1 || typeof matches[0].id !== 'string' || !matches[0].id.trim()) {
    fail('MENU_NOT_UNIQUE');
  }
  return matches[0].id;
}

function pageTotal(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  fail('PAGE_TOTAL_INVALID');
}

function entryId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return BigInt(value).toString();
  fail('ENTRY_ID_INVALID');
}

function validAssetUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && ['hoyoverse.com', 'hoyolab.com'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function validateEntry(row) {
  if (!isObject(row)) fail('ENTRY_SCHEMA_INVALID');
  const id = entryId(row.entry_page_id);
  if (typeof row.name !== 'string' || !normalizeAlias(row.name)) fail('ENTRY_NAME_INVALID');
  if (Buffer.byteLength(row.name) > MAX_NAME_BYTES) fail('ENTRY_NAME_OVERSIZED');
  if (!validAssetUrl(row.icon_url)) fail('ENTRY_ICON_INVALID');
  if (!isObject(row.display_field)) fail('ENTRY_DISPLAY_INVALID');
  if (!isObject(row.filter_values)) fail('ENTRY_FILTER_INVALID');
  if (typeof row.desc !== 'string') fail('ENTRY_DESC_INVALID');
  return { id, name: row.name, raw: row };
}

export async function fetchHoyoCollection(game, menuId, fetchJsonImpl = fetchJson) {
  const entries = [];
  const payloads = [];
  const seen = new Set();
  let expectedTotal = null;
  let pageCount = 1;

  for (let page = 1; page <= pageCount; page += 1) {
    let payload;
    try {
      payload = await fetchJsonImpl(apiUrl(game, 'get_entry_page_list'), {
        cache: false,
        method: 'POST',
        body: JSON.stringify({ menu_id: menuId, page_num: page, page_size: PAGE_SIZE, filters: [] }),
        maxBytes: MAX_PAGE_BYTES,
        retries: 0,
        timeoutMs: SHADOW_REQUEST_TIMEOUT_MS,
        headers: { ...requestHeaders(game), 'content-type': 'application/json' },
      });
    } catch {
      fail('PAGE_FETCH_FAILED');
    }

    payloadBytes(payload, 'PAGE_PAYLOAD_TOO_LARGE', 'PAGE_ENVELOPE_INVALID');
    validateEnvelope(payload, 'PAGE');
    if (!Array.isArray(payload.data.list)) fail('PAGE_ENVELOPE_INVALID');
    const total = pageTotal(payload.data.total);
    if (expectedTotal === null) {
      expectedTotal = total;
      if (total === 0) fail('PAGE_TOTAL_COLLAPSE');
      if (total > MAX_ROWS) fail('PAGE_LIMIT_EXCEEDED');
      pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (pageCount > MAX_PAGES) fail('PAGE_LIMIT_EXCEEDED');
    } else if (total !== expectedTotal) {
      fail('PAGE_TOTAL_CHANGED');
    }

    const expectedRows = Math.min(PAGE_SIZE, Math.max(0, expectedTotal - ((page - 1) * PAGE_SIZE)));
    if (payload.data.list.length === 0 && expectedRows > 0) fail('PAGE_EMPTY');
    if (payload.data.list.length !== expectedRows) fail('PAGE_COUNT_MISMATCH');

    for (const row of payload.data.list) {
      const entry = validateEntry(row);
      if (seen.has(entry.id)) fail('ENTRY_ID_DUPLICATE');
      seen.add(entry.id);
      entries.push(entry);
    }
    payloads.push(payload);
  }

  if (entries.length !== expectedTotal) fail('PAGE_COUNT_MISMATCH');
  return {
    entries,
    hoyoCount: entries.length,
    hoyoProjectedHash: canonicalRowsHash(entries.map((entry) => entry.raw), (row) => entryId(row.entry_page_id)),
    hoyoSchemaHash: schemaHash(payloads),
  };
}

export function classifyEntries(hoyoEntries, liveRows, betaRows) {
  const liveIds = new Set(liveRows.map((row) => row.id));
  const liveAliases = new Set(liveRows.flatMap((row) => row.aliases));
  const betaAliases = new Set(betaRows
    .filter((row) => !liveIds.has(row.id))
    .flatMap((row) => row.aliases));
  const counts = { liveMatched: 0, betaOnly: 0, unknown: 0 };

  for (const entry of hoyoEntries) {
    const alias = normalizeAlias(entry.name);
    if (liveAliases.has(alias)) counts.liveMatched += 1;
    else if (betaAliases.has(alias)) counts.betaOnly += 1;
    else counts.unknown += 1;
  }
  return counts;
}

function baseCollectionReport(collection, local = null) {
  return {
    collection: collection.collection,
    localLiveCount: local?.localLiveCount ?? 0,
    localBetaCount: local?.localBetaCount ?? 0,
    localWithoutAsset: local?.localWithoutAsset ?? 0,
    hoyoCount: 0,
    liveMatched: 0,
    betaOnly: 0,
    unknown: 0,
    localIdentityHash: local?.localIdentityHash ?? EMPTY_HASH,
    hoyoProjectedHash: EMPTY_HASH,
    hoyoSchemaHash: EMPTY_HASH,
    status: 'unhealthy',
    errorCode: null,
  };
}

function unhealthyCollection(collection, local, code) {
  return { ...baseCollectionReport(collection, local), errorCode: code };
}

function comparedCollection(collection, local, upstream) {
  const counts = classifyEntries(upstream.entries, local.live, local.beta);
  const status = counts.betaOnly || counts.unknown || local.localWithoutAsset ? 'differences' : 'aligned';
  return {
    ...baseCollectionReport(collection, local),
    hoyoCount: upstream.hoyoCount,
    ...counts,
    hoyoProjectedHash: upstream.hoyoProjectedHash,
    hoyoSchemaHash: upstream.hoyoSchemaHash,
    status,
    errorCode: null,
  };
}

export function renderMarkdown(report) {
  const lines = [
    '## HoYoWiki shadow comparison',
    '',
    `Mode: \`${report.mode}\` | Locale: \`${report.locale}\` | Published: \`${report.published}\` | Overall: \`${report.overallHealth}\``,
    '',
    '| Game | Live version | Beta version | Collection | Local live | Local beta | Missing local asset | HoYo | Live matched | Beta only | Unknown | Status | Error | Local identity SHA-256 | HoYo projection SHA-256 | HoYo schema SHA-256 |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |',
  ];

  for (const game of report.games) {
    for (const collection of game.collections) {
      lines.push(`| ${game.game} | ${game.liveVersion ?? '-'} | ${game.betaVersion ?? '-'} | ${collection.collection} | ${collection.localLiveCount} | ${collection.localBetaCount} | ${collection.localWithoutAsset} | ${collection.hoyoCount} | ${collection.liveMatched} | ${collection.betaOnly} | ${collection.unknown} | ${collection.status} | ${collection.errorCode ?? '-'} | ${collection.localIdentityHash} | ${collection.hoyoProjectedHash} | ${collection.hoyoSchemaHash} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export async function runShadowComparison({
  databaseDir = DEFAULT_DATABASE_DIR,
  fetchJsonImpl = fetchJson,
  readJsonImpl = readJson,
  now = () => new Date(),
} = {}) {
  const games = [];

  for (const game of HOYO_GAMES) {
    let liveMetadata;
    let betaMetadata;
    try {
      liveMetadata = await loadMetadata(databaseDir, game.game, 'live', readJsonImpl);
      betaMetadata = await loadMetadata(databaseDir, game.game, 'beta', readJsonImpl);
    } catch (error) {
      const code = errorCode(error, 'LOCAL_METADATA_READ_FAILED');
      games.push({
        game: game.game,
        liveVersion: null,
        betaVersion: null,
        collections: game.collections.map((collection) => unhealthyCollection(collection, null, code)),
      });
      continue;
    }

    const local = new Map();
    for (const collection of game.collections) {
      try {
        local.set(collection.collection, await loadLocalCollection(
          databaseDir, game.game, collection, liveMetadata, betaMetadata, readJsonImpl,
        ));
      } catch (error) {
        local.set(collection.collection, error);
      }
    }

    let menus;
    let menuError = null;
    try {
      menus = await fetchMenus(game, fetchJsonImpl);
    } catch (error) {
      menuError = error;
    }

    const collections = [];
    for (const collection of game.collections) {
      const baseline = local.get(collection.collection);
      if (baseline instanceof Error) {
        collections.push(unhealthyCollection(
          collection, null, errorCode(baseline, 'LOCAL_COLLECTION_READ_FAILED'),
        ));
        continue;
      }
      if (menuError) {
        collections.push(unhealthyCollection(collection, baseline, errorCode(menuError, 'MENU_FETCH_FAILED')));
        continue;
      }

      try {
        const menuId = discoverMenu(menus, collection.style);
        const upstream = await fetchHoyoCollection(game, menuId, fetchJsonImpl);
        collections.push(comparedCollection(collection, baseline, upstream));
      } catch (error) {
        collections.push(unhealthyCollection(collection, baseline, errorCode(error, 'INTERNAL_ERROR')));
      }
    }

    games.push({
      game: game.game,
      liveVersion: String(liveMetadata.version),
      betaVersion: String(betaMetadata.version),
      collections,
    });
  }

  const overallHealth = games.some((game) => game.collections.some(({ status }) => status === 'unhealthy'))
    ? 'unhealthy'
    : 'healthy';
  const date = now();
  const report = {
    schemaVersion: 1,
    mode: 'shadow',
    locale: 'en-us',
    published: false,
    promotedFields: [],
    generatedAt: (date instanceof Date ? date : new Date(date)).toISOString(),
    overallHealth,
    games,
  };
  return { report, markdown: renderMarkdown(report), exitCode: overallHealth === 'healthy' ? 0 : 1 };
}

async function main() {
  const result = await runShadowComparison();
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, result.markdown, 'utf8');
    } catch {
      result.report.overallHealth = 'unhealthy';
      result.report.errorCode = 'SUMMARY_WRITE_FAILED';
      result.exitCode = 1;
    }
  }
  console.log(JSON.stringify(result.report));
  process.exitCode = result.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.log(JSON.stringify({
      schemaVersion: 1,
      mode: 'shadow',
      locale: 'en-us',
      published: false,
      promotedFields: [],
      generatedAt: new Date().toISOString(),
      overallHealth: 'unhealthy',
      errorCode: 'INTERNAL_ERROR',
      games: [],
    }));
    process.exitCode = 1;
  });
}
