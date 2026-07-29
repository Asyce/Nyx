import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const databaseDir = path.resolve(root, 'Database');
const auditFile = path.resolve(databaseDir, 'Audits', 'database-missing-art.json');
const provenanceFile = path.resolve(databaseDir, 'Audits', 'database-art-backfill-provenance.json');
const apply = process.argv.includes('--apply');
const verbose = process.argv.includes('--verbose');
const concurrency = Number(process.env.PENGO_ART_BACKFILL_CONCURRENCY || 12);
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
  throw new Error(`PENGO_ART_BACKFILL_CONCURRENCY must be an integer from 1 to 32; got ${JSON.stringify(concurrency)}`);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function candidates(sourceIcon) {
  const encoded = encodeURIComponent(sourceIcon);
  const out = [
    {
      provider: 'yatta',
      url: `https://gi.yatta.moe/assets/UI/${encoded}.png`,
    },
  ];

  const snapCategories = [];
  if (
    sourceIcon.startsWith('UI_ItemIcon_')
    || sourceIcon.startsWith('UI_RogueDiary_Icon_')
    || sourceIcon.startsWith('UI_GcgIcon_')
    || sourceIcon.startsWith('UI_Icon_MusicGame_')
  ) {
    snapCategories.push('ItemIcon');
  }
  if (sourceIcon.startsWith('UI_NameCardIcon_')) snapCategories.push('NameCardIcon');
  if (sourceIcon.startsWith('UI_EquipIcon_')) snapCategories.push('EquipIcon');
  if (sourceIcon.startsWith('UI_AvatarIcon_')) snapCategories.push('AvatarIcon');
  if (sourceIcon.startsWith('UI_AvatarFrameIcon_')) snapCategories.push('AvatarIcon');
  for (const category of snapCategories) {
    out.push({
      provider: 'snap-hutao',
      url: `https://static.snaphutaorp.org/static/raw/${category}/${encoded}.png`,
    });
  }

  out.push({
    provider: 'enka',
    url: `https://enka.network/ui/${encoded}.png`,
  });

  if (sourceIcon.startsWith('UI_Gcg_CardBack_')) {
    out.push({
      provider: 'mhywiki',
      url: `https://media.githubusercontent.com/media/mixuanda/MHYwiki/master/site/images/GCG/${encoded}.png`,
    });
  }
  return out;
}

function safeDestination(relative) {
  const normalized = String(relative || '').replace(/\\/g, '/');
  if (!normalized.startsWith('GameData/gi/assets/items/') || !normalized.endsWith('.webp')) {
    throw new Error(`unsafe Genshin item-art destination ${JSON.stringify(relative)}`);
  }
  const absolute = path.resolve(databaseDir, ...normalized.split('/'));
  const allowedRoot = path.resolve(databaseDir, 'GameData', 'gi', 'assets', 'items');
  if (!absolute.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error(`destination escapes the Genshin item-art directory: ${relative}`);
  }
  return { normalized, absolute };
}

async function fetchImage(candidate, sourceIcon) {
  let response;
  try {
    response = await fetch(candidate.url, {
      redirect: 'follow',
      headers: { 'user-agent': 'Pengo-Nyx-art-backfill/1.0' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return null;
  }
  if (!response.ok || !String(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) {
    await response.body?.cancel();
    return null;
  }
  const sourceBytes = Buffer.from(await response.arrayBuffer());
  if (!sourceBytes.length || sourceBytes.length > MAX_SOURCE_BYTES) {
    throw new Error(`${sourceIcon} returned an unsafe ${sourceBytes.length}-byte source image from ${candidate.url}`);
  }
  let metadata;
  try {
    metadata = await sharp(sourceBytes, { limitInputPixels: 50_000_000 }).metadata();
  } catch (error) {
    throw new Error(`${sourceIcon} returned undecodable image bytes from ${candidate.url}: ${error.message}`);
  }
  if (!metadata.width || !metadata.height) {
    throw new Error(`${sourceIcon} returned an image without dimensions from ${candidate.url}`);
  }
  const outputBytes = await sharp(sourceBytes, { limitInputPixels: 50_000_000 })
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
  return {
    ...candidate,
    sourceBytes,
    outputBytes,
    width: metadata.width,
    height: metadata.height,
  };
}

async function mapLimit(values, limit, mapper) {
  const output = new Array(values.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= values.length) return;
      output[current] = await mapper(values[current], current);
    }
  }));
  return output;
}

const audit = JSON.parse(await fs.readFile(auditFile, 'utf8'));
const eligible = audit.records.filter((record) => (
  record.game === 'gi'
  && record.collection === 'items'
  && record.result === 'unavailable'
  && record.sourceIconField?.value
  && record.localDestination
));

const jobsByDestination = new Map();
for (const record of eligible) {
  const destination = safeDestination(record.localDestination);
  const sourceIcon = String(record.sourceIconField.value);
  const prior = jobsByDestination.get(destination.normalized);
  if (prior && prior.sourceIcon !== sourceIcon) {
    throw new Error(`${destination.normalized} is shared by different source icons: ${prior.sourceIcon} and ${sourceIcon}`);
  }
  if (prior) {
    prior.records.push({ recordId: String(record.recordId), name: record.name });
  } else {
    jobsByDestination.set(destination.normalized, {
      ...destination,
      sourceIcon,
      records: [{ recordId: String(record.recordId), name: record.name }],
    });
  }
}

const jobs = [...jobsByDestination.values()].sort((a, b) => a.normalized.localeCompare(b.normalized));
const results = await mapLimit(jobs, concurrency, async (job) => {
  try {
    const existing = await fs.readFile(job.absolute);
    const metadata = await sharp(existing, { limitInputPixels: 50_000_000 }).metadata();
    return {
      status: 'cached',
      job,
      outputSha256: sha256(existing),
      outputBytes: existing.length,
      width: metadata.width,
      height: metadata.height,
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  for (const candidate of candidates(job.sourceIcon)) {
    const found = await fetchImage(candidate, job.sourceIcon);
    if (!found) continue;
    if (apply) {
      await fs.mkdir(path.dirname(job.absolute), { recursive: true });
      await fs.writeFile(job.absolute, found.outputBytes, { flag: 'wx' });
    }
    return {
      status: apply ? 'downloaded' : 'available',
      job,
      provider: found.provider,
      sourceUrl: found.url,
      sourceSha256: sha256(found.sourceBytes),
      sourceBytes: found.sourceBytes.length,
      outputSha256: sha256(found.outputBytes),
      outputBytes: found.outputBytes.length,
      width: found.width,
      height: found.height,
    };
  }
  return { status: 'missing', job };
});

const successful = results.filter((result) => result.status !== 'missing');
const resolvedRecords = successful.reduce((count, result) => count + result.job.records.length, 0);
const summary = Object.fromEntries(
  ['downloaded', 'available', 'cached', 'missing']
    .map((status) => [status, results.filter((result) => result.status === status).length]),
);

if (apply) {
  const provenance = {
    generatedAt: new Date().toISOString(),
    policy: 'Only exact source icon names from released audit records are accepted. Downloads are decoded, converted to lossless WebP, and written without overwrite.',
    providers: {
      yatta: 'https://gi.yatta.moe',
      'snap-hutao': 'https://snaphutaorp.org',
      enka: 'https://enka.network',
      mhywiki: 'https://github.com/mixuanda/MHYwiki',
    },
    resolvedRecordCount: resolvedRecords,
    assetCount: successful.length,
    assets: successful.map((result) => ({
      localDestination: result.job.normalized,
      sourceIcon: result.job.sourceIcon,
      provider: result.provider || 'existing-local',
      sourceUrl: result.sourceUrl || null,
      sourceSha256: result.sourceSha256 || null,
      sourceBytes: result.sourceBytes || null,
      outputSha256: result.outputSha256,
      outputBytes: result.outputBytes,
      width: result.width,
      height: result.height,
      records: result.job.records,
    })),
  };
  await fs.writeFile(provenanceFile, `${JSON.stringify(provenance, null, 2)}\n`, { flag: 'w' });
}

const unmatched = results
  .filter((result) => result.status === 'missing')
  .map((result) => ({
    sourceIcon: result.job.sourceIcon,
    localDestination: result.job.normalized,
    records: result.job.records,
  }));

console.log(JSON.stringify({
  apply,
  eligibleRecords: eligible.length,
  uniqueDestinations: jobs.length,
  resolvedRecords,
  ...summary,
  unmatchedCount: unmatched.length,
  unmatched: verbose ? unmatched : unmatched.slice(0, 20),
}, null, 2));
