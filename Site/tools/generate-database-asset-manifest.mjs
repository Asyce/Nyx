import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDatabaseAssetManifest,
  writeDatabaseAssetManifest,
} from './database-assets.mjs';

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = path.resolve(siteDir, '..');
const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
const outputPath = outputArg
  ? path.resolve(rootDir, outputArg.slice('--output='.length))
  : path.resolve(rootDir, '.deploy', 'database-assets-manifest.json');

const manifest = await buildDatabaseAssetManifest({
  rootDir,
  commit: process.env.PENGO_DEPLOY_COMMIT,
});
await writeDatabaseAssetManifest(manifest, outputPath);
console.log(`Inventoried ${manifest.totals.assets} Git-tracked Database assets (${manifest.totals.uniqueObjects} unique objects, ${manifest.totals.bytes} bytes) at ${manifest.gitCommit}`);
console.log(`Wrote ${path.relative(rootDir, outputPath)}`);
