import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteDir = resolve(__dirname, '..');
const strict = process.argv.includes('--strict');

const jobs = [
  ['Character metadata', ['tools/scrape-character-fandom-metadata.mjs']],
  ['Genshin birthday art', ['tools/scrape-genshin-birthday-art.mjs']],
  ['Genshin namecards', ['tools/scrape-genshin-namecards.mjs']],
  ['Genshin avatars', ['tools/scrape-genshin-avatars.mjs']],
  ['Endfield skill icons', ['tools/scrape-endfield-skill-icons.mjs']],
  ['Genshin signature weapons', ['tools/scrape-genshin-signature-weapons.mjs']],
  ['HSR holiday art', ['tools/scrape-hsr-holiday-art.mjs']],
  ['HSR signature lightcones', ['tools/scrape-hsr-signature-lightcones.mjs']],
  ['Genshin TCG data', ['tools/scrape-gamedata-gcg.mjs']],
  ['Genshin furniture data', ['tools/scrape-gamedata-furniture.mjs']],
  ['Miliastra Wonderland data', ['../Scraper/wonderland/scrape.mjs']],
  ['GI and HSR Library data', ['../Scraper/library/scrape.mjs']],
  ['Character leveling tables', ['../Scraper/leveling/scrape.mjs']],
  ['AMBR TCG images', ['tools/scrape-ambr-gcg.mjs']],
];

const failures = [];

for (const [name, args] of jobs) {
  console.log(`\n[side-data] ${name}`);
  const result = spawnSync(process.execPath, args, {
    cwd: siteDir,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) {
    failures.push(name);
    console.warn(`[side-data] ${name} failed with exit ${result.status}`);
  }
}

if (failures.length) {
  console.warn(`\n[side-data] Completed with ${failures.length} warning(s): ${failures.join(', ')}`);
  if (strict) process.exit(1);
} else {
  console.log('\n[side-data] All jobs completed');
}
