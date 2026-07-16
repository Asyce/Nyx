#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_GAMES } from './check-upstream.mjs';

const GAME_DIRS = { hsr: 'hsr', gi: 'gi', ww: 'ww', zzz: 'zzz' };
const CHARACTER_SECTIONS = new Set(['characters', 'agents']);

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function requestedGames(argv) {
  const value = argv[0] || SUPPORTED_GAMES.join(',');
  const games = value.split(',').map((game) => game.trim()).filter(Boolean);
  for (const game of games) {
    if (!SUPPORTED_GAMES.includes(game)) throw new Error(`Unsupported GameData game: ${game}`);
  }
  return games;
}

function assetReferences(value, found = []) {
  if (typeof value === 'string' && /^GameData\/[a-z]+\/assets\//.test(value)) found.push(value);
  else if (Array.isArray(value)) value.forEach((child) => assetReferences(child, found));
  else if (value && typeof value === 'object') Object.values(value).forEach((child) => assetReferences(child, found));
  return found;
}

export async function validateGameDataOutput(databaseDir, games) {
  const manifest = await readJson(path.join(databaseDir, 'GameData', 'manifest.json'));
  const results = [];

  for (const game of games) {
    const gameManifest = manifest?.[game];
    if (!gameManifest?.live || !gameManifest?.latest) {
      throw new Error(`GameData manifest is missing live/latest versions for ${game}`);
    }

    for (const [channel, expectedVersion] of [['live', gameManifest.live], ['beta', gameManifest.latest]]) {
      const channelDir = path.join(databaseDir, 'GameData', GAME_DIRS[game], channel);
      const metadata = await readJson(path.join(channelDir, 'metadata.json'));
      if (metadata.channel !== channel || metadata.version !== expectedVersion) {
        throw new Error(`${game}/${channel} metadata is ${metadata.version}; expected ${expectedVersion}`);
      }

      for (const [section, count] of Object.entries(metadata.counts || {})) {
        const relativeFile = metadata.files?.[section];
        if (!relativeFile) throw new Error(`${game}/${channel} metadata has no file for ${section}`);
        const records = await readJson(path.join(databaseDir, relativeFile));
        if (!Array.isArray(records) || records.length !== count || count < 1) {
          throw new Error(`${game}/${channel}/${section} has ${records?.length ?? 'invalid'} records; expected ${count}`);
        }
        if (CHARACTER_SECTIONS.has(section)) {
          const withoutPortrait = records.filter((record) => assetReferences(record?.assets).length < 1);
          if (withoutPortrait.length) {
            throw new Error(`${game}/${channel}/${section} has ${withoutPortrait.length} character(s) without a local portrait reference`);
          }
        }
        for (const reference of new Set(assetReferences(records))) {
          try {
            await fs.access(path.join(databaseDir, reference));
          } catch {
            throw new Error(`${game}/${channel}/${section} references missing asset ${reference}`);
          }
        }
      }

      results.push({ game, channel, version: expectedVersion, counts: metadata.counts });
    }
  }

  return results;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const databaseDir = path.resolve(process.env.NYXARIUM_DATABASE_DIR || path.join(root, 'Database'));
  const results = await validateGameDataOutput(databaseDir, requestedGames(process.argv.slice(2)));
  for (const result of results) {
    console.log(`${result.game}/${result.channel} ${result.version}: ${JSON.stringify(result.counts)}`);
  }
  console.log('GameData validation passed.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
