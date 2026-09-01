import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(here, '..', 'src', 'data', 'generated', 'launcher-tools-v1.json');
const rootKeys = ['generatedAt', 'schemaVersion', 'tools'];
const rowKeys = ['game', 'id', 'label', 'url'];
const gameIds = new Set(['gi', 'hsr', 'zzz', 'wuwa', 'ae']);

export const REVIEWED_LAUNCHER_TOOLS = [
  { game: 'gi', id: 'wiki', label: 'Wiki', url: 'https://wiki.hoyolab.com/pc/genshin/home' },
  { game: 'gi', id: 'material-calculator', label: 'Material Calculator', url: 'https://act.hoyolab.com/ys/event/calculator-sea/index.html' },
  { game: 'gi', id: 'battle-records', label: 'Battle Records', url: 'https://act.hoyolab.com/app/community-game-records-sea/index.html?gid=2#/ys' },
  { game: 'gi', id: 'upgrade-guide', label: 'Upgrade Guide', url: 'https://act.hoyolab.com/ys/event/bbs-lineup-ys-sea/index.html' },
  { game: 'hsr', id: 'wiki', label: 'Wiki', url: 'https://wiki.hoyolab.com/pc/hsr/home' },
  { game: 'hsr', id: 'material-calculator', label: 'Material Calculator', url: 'https://act.hoyolab.com/sr/event/cultivation-tool/index.html?game_biz=hkrpg_global&hyl_auth_required=true&hyl_hide_status_bar=true&hyl_landscape=true&hyl_presentation_style=fullscreen&mode=fullscreen&utm_campaign=CultivationTool&utm_id=6&utm_medium=tools&utm_source=hoyolab&win_mode=fullscreen#/tools/calculation?target=Character' },
  { game: 'hsr', id: 'battle-records', label: 'Battle Records', url: 'https://act.hoyolab.com/app/community-game-records-sea/index.html?gid=6#/hsr' },
  { game: 'hsr', id: 'upgrade-guide', label: 'Upgrade Guide', url: 'https://act.hoyolab.com/sr/event/cultivation-tool/#/tools/suggestion' },
  { game: 'zzz', id: 'wiki', label: 'Wiki', url: 'https://wiki.hoyolab.com/pc/zzz/home' },
  { game: 'zzz', id: 'battle-records', label: 'Battle Records', url: 'https://act.hoyolab.com/app/zzz-game-record/index.html' },
  { game: 'ae', id: 'wiki', label: 'Wiki', url: 'https://wiki.skport.com/endfield' },
  { game: 'ae', id: 'material-calculator', label: 'Material Calculator', url: 'https://game.skport.com/tools/endfield/cost-calculator?header=0' },
  { game: 'ae', id: 'team-recommendations', label: 'Team Recommendations', url: 'https://game.skport.com/tools/endfield/rec-team' },
];

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);
}

export function validateLauncherTools(feed, { requireComplete = true } = {}) {
  if (typeof requireComplete !== 'boolean') throw new Error('requireComplete must be a boolean');
  if (!hasExactKeys(feed, rootKeys)) throw new Error('launcher tools root keys are invalid');
  if (feed.schemaVersion !== 1) throw new Error('launcher tools schemaVersion must be 1');
  const generatedAt = Date.parse(feed.generatedAt);
  if (!Number.isFinite(generatedAt) || new Date(generatedAt).toISOString() !== feed.generatedAt) {
    throw new Error('launcher tools generatedAt must be an ISO timestamp');
  }
  if (!Array.isArray(feed.tools)) throw new Error('launcher tools must be an array');

  const seen = new Set();
  for (const row of feed.tools) {
    if (!hasExactKeys(row, rowKeys)) throw new Error('launcher tool row keys are invalid');
    if (!gameIds.has(row.game)) throw new Error(`launcher tool game is invalid: ${row.game}`);
    if (rowKeys.some((key) => typeof row[key] !== 'string' || !row[key])) throw new Error('launcher tool fields must be non-empty strings');

    let parsed;
    try {
      parsed = new URL(row.url);
    } catch {
      throw new Error(`launcher tool URL is invalid: ${row.url}`);
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
      throw new Error(`launcher tool URL is unsafe: ${row.url}`);
    }

    const key = `${row.game}/${row.id}`;
    if (seen.has(key)) throw new Error(`duplicate launcher tool: ${key}`);
    seen.add(key);
    const reviewed = REVIEWED_LAUNCHER_TOOLS.find((tool) => tool.game === row.game && tool.id === row.id);
    if (!reviewed || reviewed.label !== row.label || reviewed.url !== row.url) {
      throw new Error(`launcher tool is not reviewed: ${key}`);
    }
  }

  if (requireComplete && (feed.tools.length !== REVIEWED_LAUNCHER_TOOLS.length
    || feed.tools.some((row, index) => row.game !== REVIEWED_LAUNCHER_TOOLS[index].game
      || row.id !== REVIEWED_LAUNCHER_TOOLS[index].id
      || row.label !== REVIEWED_LAUNCHER_TOOLS[index].label
      || row.url !== REVIEWED_LAUNCHER_TOOLS[index].url))) {
    throw new Error('launcher tools must contain all reviewed rows in canonical order');
  }
  return feed;
}

export function buildLauncherTools(generatedAt = new Date().toISOString()) {
  return validateLauncherTools({
    schemaVersion: 1,
    generatedAt,
    tools: REVIEWED_LAUNCHER_TOOLS.map((tool) => ({ ...tool })),
  });
}

async function cli() {
  const feed = buildLauncherTools();
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(feed, null, 2)}\n`, 'utf8');
  process.stdout.write(`launcher tools: ${outputPath} (${feed.tools.length} rows)\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  cli().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
