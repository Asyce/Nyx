import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWonderlandSync } from './core.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const report = await runWonderlandSync({ rootDir });
console.log(`Wonderland ${report.version}: ${report.counts.costumes} costumes, ${report.counts.suits} sets, ${report.counts.items} inventory items.`);
console.log(`Assets: ${report.assets.referenced} referenced, ${report.assets.downloaded} downloaded, ${report.assets.reused} reused, ${report.assets.iconless} iconless.`);

