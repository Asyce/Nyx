#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeGenshin } from './games/genshin.mjs';
import { scrapeHsr } from './games/hsr.mjs';
import { scrapeWuwa } from './games/wuwa.mjs';
import { scrapeZzz } from './games/zzz.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DATABASE_DIR = path.resolve(__dirname, '..', '..', 'Database');
const SCRAPERS = {
  gi: scrapeGenshin,
  genshin: scrapeGenshin,
  hsr: scrapeHsr,
  ww: scrapeWuwa,
  wuwa: scrapeWuwa,
  zzz: scrapeZzz
};

function parseArgs(argv) {
  const options = {
    game: 'hsr',
    channels: ['live', 'beta'],
    databaseDir: process.env.NYXARIUM_DATABASE_DIR || DEFAULT_DATABASE_DIR,
    concurrency: 8,
    skipAssets: false,
    forceAssets: false,
    sample: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--game') {
      options.game = takeValue(arg, next);
      i += 1;
    } else if (arg === '--channel' || arg === '--channels') {
      options.channels = takeValue(arg, next)
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      i += 1;
    } else if (arg === '--database-dir') {
      options.databaseDir = path.resolve(takeValue(arg, next));
      i += 1;
    } else if (arg === '--concurrency') {
      options.concurrency = Number.parseInt(takeValue(arg, next), 10);
      i += 1;
    } else if (arg === '--sample') {
      options.sample = Number.parseInt(takeValue(arg, next), 10);
      i += 1;
    } else if (arg === '--skip-assets') {
      options.skipAssets = true;
    } else if (arg === '--force-assets') {
      options.forceAssets = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
    throw new Error('--concurrency must be a positive number');
  }

  if (options.sample !== null && (!Number.isFinite(options.sample) || options.sample < 1)) {
    throw new Error('--sample must be a positive number');
  }

  return options;
}

function takeValue(flag, value) {
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function printHelp() {
  console.log(`Usage:
  npm run nanoka:hsr
  npm run nanoka:gi
  npm run nanoka:ww
  npm run nanoka:zzz
  npm run nanoka -- --game all
  npm run nanoka:hsr -- --channel live
  npm run nanoka:hsr -- --sample 3

Options:
  --game hsr                Game scraper to run: hsr, gi, genshin, ww, wuwa, zzz, all.
  --channel live,beta       Channels to write. Defaults to both.
  --database-dir <path>     Database output directory.
  --concurrency <number>    Concurrent detail and asset requests.
  --sample <number>         Limit each section for quick validation.
  --skip-assets             Write JSON only.
  --force-assets            Re-download existing assets.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.game === 'all') {
    const results = [];
    for (const game of ['hsr', 'gi', 'ww', 'zzz']) {
      results.push(await SCRAPERS[game]({ ...options, game }));
    }
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const scraper = SCRAPERS[options.game];
  if (!scraper) {
    throw new Error(`Nanoka game "${options.game}" is not implemented yet`);
  }

  const result = await scraper(options);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
