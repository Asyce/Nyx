import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDatabaseAssetManifest } from './database-assets.mjs';
import { runLiveAssetChecks } from './live-check-database-assets-lib.mjs';

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = path.resolve(siteDir, '..');
const manifest = await buildDatabaseAssetManifest({
  rootDir,
  commit: process.env.PENGO_DEPLOY_COMMIT,
});
const deployDatabaseDir = path.resolve(rootDir, '.deploy', 'pengo', 'Database');

async function deployedDatabasePaths() {
  const found = new Set();
  async function walk(dir, relative) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.resolve(dir, entry.name), childRelative);
      else found.add(`Database/${childRelative}`);
    }
  }
  await walk(deployDatabaseDir, '');
  return found;
}

const full = process.argv.includes('--full');
const concurrency = Number(process.env.PENGO_LIVE_CHECK_CONCURRENCY || 24);
const staticSourcePaths = await deployedDatabasePaths();
const result = await runLiveAssetChecks(manifest, {
  full,
  concurrency,
  staticSourcePaths,
  onProgress: ({ completed, total }) => {
    if (full && (completed % 1_000 === 0 || completed === total)) {
      console.log(`Live GET verification: ${completed}/${total}`);
    }
  },
});
console.log(`Live-checked ${result.canonical} canonical URL(s), ${result.directAliases} direct legacy alias(es), and ${result.oldPaths} old pengo.gg path(s) in ${result.mode} mode for ${manifest.gitCommit}`);
