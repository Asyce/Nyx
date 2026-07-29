import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDatabaseAssetManifest } from './database-assets.mjs';
import {
  assertR2SyncConcurrency,
  loadRemoteLatestManifest,
  R2S3Client,
  syncDatabaseAssets,
} from './r2-database-sync.mjs';

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = path.resolve(siteDir, '..');
const apply = process.argv.includes('--apply');
const verifyAll = process.argv.includes('--verify-all');
const concurrency = assertR2SyncConcurrency(Number(process.env.R2_SYNC_CONCURRENCY || 8));
const bucket = process.env.R2_DATABASE_BUCKET || 'nyx-database-assets';
const credentials = {
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
};
if (bucket !== 'nyx-database-assets') throw new Error(`R2_DATABASE_BUCKET must be nyx-database-assets, got ${JSON.stringify(bucket)}`);
if (apply && Object.values(credentials).some((value) => !value)) {
  throw new Error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required with --apply');
}

const manifest = await buildDatabaseAssetManifest({
  rootDir,
  commit: process.env.PENGO_DEPLOY_COMMIT,
});
const client = apply ? new R2S3Client({ ...credentials, bucket }) : null;
const priorManifest = client ? await loadRemoteLatestManifest(client) : null;
const result = await syncDatabaseAssets({
  manifest,
  rootDir,
  client,
  apply,
  priorManifest,
  verifyAll,
  concurrency,
});
console.log(`${apply ? 'Synced' : 'Planned'} ${manifest.totals.assets} Database aliases and ${manifest.totals.uniqueObjects} immutable objects for ${manifest.gitCommit}`);
console.log(JSON.stringify(result, null, 2));
if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `ready=${apply ? 'true' : 'false'}\nsha=${manifest.gitCommit}\n`);
}
