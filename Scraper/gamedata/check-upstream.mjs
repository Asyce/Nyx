#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchJson, gamedataStaticUrl } from './lib/http.mjs';
import { removeRemoteLinks } from './lib/gamedata-game.mjs';

export const SUPPORTED_GAMES = ['hsr', 'gi', 'ww', 'zzz'];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function detectManifestChanges(currentManifest, upstreamManifest, games = SUPPORTED_GAMES) {
  const changedGames = games.filter((game) => (
    JSON.stringify(canonical(currentManifest?.[game] ?? null))
      !== JSON.stringify(canonical(removeRemoteLinks(upstreamManifest?.[game] ?? null)))
  ));

  return {
    changed: changedGames.length > 0,
    games: changedGames,
  };
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

function parseArgs(argv) {
  const options = { current: null, upstream: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--current') options.current = argv[++index];
    else if (arg === '--upstream') options.upstream = argv[++index];
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

async function writeGithubOutput(result) {
  if (!process.env.GITHUB_OUTPUT) return;
  await fs.appendFile(process.env.GITHUB_OUTPUT, [
    `changed=${result.changed}`,
    `games=${result.games.join(',')}`,
    '',
  ].join('\n'));
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const options = parseArgs(process.argv.slice(2));
  const currentPath = path.resolve(options.current || path.join(root, 'Database', 'GameData', 'manifest.json'));
  const current = await readJson(currentPath, {});
  const upstream = options.upstream
    ? await readJson(path.resolve(options.upstream))
    : await fetchJson(gamedataStaticUrl('manifest.json'), { cache: false });
  const result = detectManifestChanges(current, upstream);

  await writeGithubOutput(result);
  console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
