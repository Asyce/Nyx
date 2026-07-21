import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const sourcePath = path.join(root, 'Database', 'Codes', 'codes.json');
const outputPath = path.join(root, 'Site', 'src', 'data', 'generated', 'launcher-codes-v1.json');
const gameIds = ['gi', 'hsr', 'zzz', 'wuwa', 'ae'];
const aliases = new Map([
  ['genshin', 'gi'],
  ['hsr', 'hsr'],
  ['zzz', 'zzz'],
  ['wuwa', 'wuwa'],
  ['endfield', 'ae'],
]);
const premiumCurrency = {
  gi: { name: 'Primogems', aliases: ['primogem', 'primogems'] },
  hsr: { name: 'Stellar Jade', aliases: ['stellar jade'] },
  zzz: { name: 'Polychrome', aliases: ['polychrome'] },
  wuwa: { name: 'Astrite', aliases: ['astrite'] },
  ae: { name: 'Oroberyl', aliases: ['oroberyl'] },
};

function premiumAmount(game, reward) {
  const text = String(reward ?? '').replace(/,/g, ' ');
  for (const alias of premiumCurrency[game]?.aliases ?? []) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const pattern of [
      new RegExp(`(\\d{1,6})\\s*${escaped}s?\\b`, 'i'),
      new RegExp(`${escaped}s?\\s*(?:x|\\u00d7|:)??\\s*(\\d{1,6})\\b`, 'i'),
    ]) {
      const match = text.match(pattern);
      if (match) return Number(match[1]);
    }
  }
  return 0;
}

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const games = Object.fromEntries(gameIds.map((game) => [game, []]));
for (const group of Array.isArray(source?.games) ? source.games : []) {
  const game = aliases.get(String(group?.slug ?? '').toLowerCase());
  if (!game) continue;
  games[game] = (Array.isArray(group?.codes) ? group.codes : [])
    .filter((entry) => entry?.premium === true
      && /^[-_A-Za-z0-9]{1,64}$/.test(entry?.code ?? '')
      && /^\d{4}-\d{2}-\d{2}$/.test(entry?.added ?? ''))
    .sort((left, right) => String(right.added).localeCompare(String(left.added))
      || String(right.firstSeen ?? '').localeCompare(String(left.firstSeen ?? ''))
      || String(left.code).localeCompare(String(right.code)))
    .slice(0, 5)
    .map((entry) => {
      const amount = premiumAmount(game, entry.rewards ?? entry.reward);
      return {
        code: entry.code,
        added: entry.added,
        amount,
        currency: amount > 0 ? premiumCurrency[game].name : '',
      };
    });
}

const content = { schemaVersion: 1, generatedAt: source.generatedAt, games };
const revision = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
const manifest = { ...content, revision };
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`launcher codes: ${outputPath} (${revision})\n`);
