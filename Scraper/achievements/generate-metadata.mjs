import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from './core.mjs';
import { compareAchievementCatalogs, createAchievementManifest, createAchievementRefreshReport } from './manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_ROOT = path.resolve(HERE, '..', '..', 'Database', 'Achievements');
const generatedAt = new Date().toISOString();
const catalogFiles = [];

for (const game of ['gi', 'hsr']) {
  const file = path.join(OUTPUT_ROOT, game, 'catalog.json');
  const bytes = await fs.readFile(file);
  const catalog = JSON.parse(bytes.toString('utf8'));
  validateCatalog(catalog);
  catalogFiles.push({ game, catalog, bytes });
}

const manifest = createAchievementManifest(catalogFiles, { generatedAt });
const refreshReport = createAchievementRefreshReport(
  catalogFiles.map(({ catalog }) => compareAchievementCatalogs(catalog, catalog)),
  { generatedAt },
);

await fs.writeFile(path.join(OUTPUT_ROOT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(OUTPUT_ROOT, 'refresh-report.json'), `${JSON.stringify(refreshReport, null, 2)}\n`, 'utf8');
console.log(`Wrote achievement manifest for ${catalogFiles.length} released catalogs.`);
