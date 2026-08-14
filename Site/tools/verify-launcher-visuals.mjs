import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '..');
const hashPattern = /^[a-f0-9]{64}$/;

async function sha256(file) {
  const bytes = await fs.readFile(file);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export async function verifyLauncherVisuals(baseDirectory) {
  const base = path.resolve(baseDirectory);
  const manifestPath = path.join(base, 'launcher-visuals-v1.json');
  const assetDirectory = path.join(base, 'launcher-visuals');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest?.schema !== 1 || !hashPattern.test(manifest?.revision ?? '')) {
    throw new Error('Launcher visual manifest header is invalid.');
  }
  if (!manifest.games || typeof manifest.games !== 'object') {
    throw new Error('Launcher visual manifest has no games.');
  }
  const revision = crypto.createHash('sha256').update(JSON.stringify({ schema: 1, games: manifest.games })).digest('hex');
  if (revision !== manifest.revision) throw new Error('Launcher visual manifest revision does not match its games.');

  const referenced = new Set();
  let bytes = 0;
  for (const [game, entry] of Object.entries(manifest.games)) {
    if (!['gi', 'hsr', 'zzz', 'wuwa', 'ae'].includes(game)) throw new Error(`Unknown launcher visual game: ${game}`);
    const expectedCount = entry?.kind === 'video' || entry?.kind === 'image' ? 1 : entry?.kind === 'gallery' ? 3 : 0;
    if (!Array.isArray(entry?.assets) || entry.assets.length !== expectedCount) {
      throw new Error(`${game} launcher visual asset count is invalid.`);
    }
    for (const asset of entry.assets) {
      const url = new URL(asset?.url ?? '');
      if (url.protocol !== 'https:'
        || url.hostname !== 'assets.pengo.gg'
        || url.port
        || url.username
        || url.password
        || url.search
        || url.hash) {
        throw new Error(`${game} launcher visual URL is not Pengo-owned.`);
      }
      if (!hashPattern.test(asset?.sha256 ?? '') || !Number.isSafeInteger(asset?.size) || asset.size <= 0) {
        throw new Error(`${game} launcher visual integrity fields are invalid.`);
      }
      const extension = asset.mediaType === 'video/webm' ? '.webm'
        : asset.mediaType === 'video/mp4' ? '.mp4'
          : asset.mediaType === 'image/webp' ? '.webp'
            : null;
      const fileName = `${asset.sha256}${extension ?? ''}`;
      if (!extension || url.pathname !== `/launcher-visuals/${fileName}`) {
        throw new Error(`${game} launcher visual filename does not match its hash and media type.`);
      }
      if (referenced.has(fileName)) throw new Error(`Launcher visual is referenced more than once: ${fileName}`);
      referenced.add(fileName);
      const file = path.join(assetDirectory, fileName);
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size !== asset.size) throw new Error(`${fileName} size does not match its manifest.`);
      if (await sha256(file) !== asset.sha256) throw new Error(`${fileName} hash does not match its manifest.`);
      bytes += stat.size;
    }
  }

  for (const entry of await fs.readdir(assetDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !referenced.has(entry.name)) {
      throw new Error(`Unreferenced launcher visual asset: ${entry.name}`);
    }
  }
  return { files: referenced.size, bytes, revision: manifest.revision };
}

async function cli() {
  const target = process.argv[2] ?? '--source';
  const bases = {
    '--source': path.join(site, 'src', 'data', 'generated'),
    '--dist': path.join(site, 'dist'),
  };
  if (!bases[target]) throw new Error('Usage: node verify-launcher-visuals.mjs [--source|--dist]');
  const result = await verifyLauncherVisuals(bases[target]);
  process.stdout.write(`launcher visuals ${target.slice(2)} verified: ${result.files} files, ${result.bytes} bytes, revision ${result.revision}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  cli().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
