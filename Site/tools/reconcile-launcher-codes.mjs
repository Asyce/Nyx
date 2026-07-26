import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileLauncherCodes } from './generate-launcher-manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const generated = path.resolve(here, '..', 'src', 'data', 'generated');
const manifestPath = path.join(generated, 'launcher-banners-v1.json');
const codesPath = path.join(generated, 'launcher-codes-v1.json');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const manifest = reconcileLauncherCodes(readJson(manifestPath), readJson(codesPath));
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`launcher banner codes reconciled: ${manifestPath} (${manifest.revision})\n`);
