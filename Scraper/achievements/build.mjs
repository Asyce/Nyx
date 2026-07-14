import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { achievementIconFilename, assertCatalogNotCollapsed, inspectAchievementIconBytes, normalizeGiCatalog, normalizeHsrCatalog, RELEASED_VERSIONS, SOURCES } from './core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'Database', 'Achievements');
const ASSET_PROVENANCE_FILE = path.join(OUTPUT_ROOT, 'asset-provenance.json');
const GITHUB_API = 'https://api.github.com';

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'pengo-achievement-catalog-builder' } });
  if (!response.ok) throw new Error(`GET ${url} returned ${response.status}`);
  return response.json();
}

async function latestSourceCommit(game) {
  const source = SOURCES[game];
  const repositoryPath = new URL(source.repository).pathname.replace(/^\//, '');
  const url = `${GITHUB_API}/repos/${repositoryPath}/commits?path=${encodeURIComponent(source.repositoryPath)}&per_page=1`;
  const commits = await fetchJson(url);
  const commit = commits?.[0];
  const dataTimestamp = commit?.commit?.committer?.date;
  if (!commit?.sha || !dataTimestamp) throw new Error(`No source commit found for ${game}`);
  return { sourceCommit: commit.sha, dataTimestamp };
}

async function loadAssetProvenance() {
  try {
    const parsed = JSON.parse(await fs.readFile(ASSET_PROVENANCE_FILE, 'utf8'));
    if (parsed?.schemaVersion !== 1 || parsed?.runtimeHotlinks !== false || !parsed.games) throw new Error('invalid asset provenance envelope');
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Achievement asset provenance is invalid: ${error.message}`);
  }
}

function assetOptions(game, provenance) {
  if (!provenance) return {};
  const entry = provenance.games?.[game];
  if (!entry || entry.releasedVersion !== RELEASED_VERSIONS[game] || !Array.isArray(entry.categories)) throw new Error(`Achievement asset provenance is incomplete for ${game}`);
  const categoryIcons = new Map(entry.categories.map((row) => [row.categoryId, { kind:'image', path:row.runtimePath, sourceKey:row.sourceKey }]));
  const reward = entry.rewardCurrency;
  const rewardCurrency = reward ? { name:reward.name, icon:{ kind:'image', path:reward.runtimePath, sourceKey:reward.sourceKey } } : null;
  return { categoryIcons, rewardCurrency };
}

async function verifyCatalogAssets(catalog) {
  const expectedByKind = new Map([['categories', new Set()], ['rewards', new Set()]]);
  const descriptors = catalog.categories.map(({ icon }) => ({ icon, kind:'categories' }));
  if (catalog.rewardCurrency?.icon) descriptors.push({ icon:catalog.rewardCurrency.icon, kind:'rewards' });
  for (const { icon, kind } of descriptors) {
    if (!icon) continue;
    const filename = achievementIconFilename(catalog.game, icon.path, kind);
    expectedByKind.get(kind).add(filename);
    const file = path.join(OUTPUT_ROOT, catalog.game, 'assets', kind, filename);
    const bytes = await fs.readFile(file);
    const inspected = inspectAchievementIconBytes(bytes);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (filename !== `${hash}.${inspected.mediaType === 'image/png' ? 'png' : 'webp'}`) throw new Error(`${catalog.game} achievement icon hash or extension mismatch: ${filename}`);
  }
  for (const [kind, expected] of expectedByKind) {
    const dir = path.join(OUTPUT_ROOT, catalog.game, 'assets', kind);
    let actual = [];
    try { actual = await fs.readdir(dir); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (actual.some((name) => !expected.has(name)) || actual.length !== expected.size) throw new Error(`${catalog.game} ${kind} assets contain missing or unreferenced files`);
  }
}

async function buildGame(game, provenance) {
  const source = SOURCES[game];
  const commit = await latestSourceCommit(game);
  const pinnedDataUrl = source.dataUrl.replace('/main/', `/${commit.sourceCommit}/`);
  const raw = await fetchJson(pinnedDataUrl);
  const options = { ...commit, ...assetOptions(game, provenance), releasedVersion: RELEASED_VERSIONS[game], generatedAt: new Date().toISOString() };
  const catalog = game === 'gi' ? normalizeGiCatalog(raw, options) : normalizeHsrCatalog(raw, options);
  if (provenance) await verifyCatalogAssets(catalog);
  const outputDir = path.join(OUTPUT_ROOT, game);
  await fs.mkdir(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, 'catalog.json');
  let previous = null;
  try { previous = JSON.parse(await fs.readFile(outputFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assertCatalogNotCollapsed(catalog, previous);
  await fs.writeFile(outputFile, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  return { game, categories: catalog.categories.length, achievements: catalog.achievements.length, commit: catalog.source.commit };
}

const results = [];
const assetProvenance = await loadAssetProvenance();
for (const game of ['gi', 'hsr']) results.push(await buildGame(game, assetProvenance));
for (const result of results) console.log(`${result.game}: ${result.achievements} achievements in ${result.categories} categories (${result.commit.slice(0, 12)})`);
