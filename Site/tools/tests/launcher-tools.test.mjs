import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildLauncherTools, validateLauncherTools } from '../generate-launcher-tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedPath = path.resolve(here, '..', '..', 'src', 'data', 'generated', 'launcher-tools-v1.json');
const generatedAt = '2026-08-25T12:34:56.789Z';
const expectedTools = [
  { game: 'gi', id: 'wiki', label: 'Wiki', url: 'https://wiki.hoyolab.com/pc/genshin/home' },
  { game: 'gi', id: 'material-calculator', label: 'Material Calculator', url: 'https://act.hoyolab.com/ys/event/calculator-sea/index.html' },
  { game: 'gi', id: 'battle-records', label: 'Battle Records', url: 'https://act.hoyolab.com/app/community-game-records-sea/index.html?gid=2#/ys' },
  { game: 'gi', id: 'upgrade-guide', label: 'Upgrade Guide', url: 'https://act.hoyolab.com/ys/event/bbs-lineup-ys-sea/index.html' },
  { game: 'hsr', id: 'wiki', label: 'Wiki', url: 'https://wiki.hoyolab.com/pc/hsr/home' },
  { game: 'hsr', id: 'material-calculator', label: 'Material Calculator', url: 'https://act.hoyolab.com/sr/event/calculator/index.html' },
  { game: 'hsr', id: 'battle-records', label: 'Battle Records', url: 'https://act.hoyolab.com/app/community-game-records-sea/index.html?gid=6#/hsr' },
  { game: 'hsr', id: 'upgrade-guide', label: 'Upgrade Guide', url: 'https://act.hoyolab.com/sr/event/cultivation-tool/#/tools/suggestion' },
  { game: 'zzz', id: 'wiki', label: 'Wiki', url: 'https://wiki.hoyolab.com/pc/zzz/home' },
  { game: 'zzz', id: 'battle-records', label: 'Battle Records', url: 'https://act.hoyolab.com/app/zzz-game-record/index.html' },
  { game: 'ae', id: 'wiki', label: 'Wiki', url: 'https://wiki.skport.com/endfield' },
  { game: 'ae', id: 'material-calculator', label: 'Material Calculator', url: 'https://game.skport.com/tools/endfield/cost-calculator?header=0' },
  { game: 'ae', id: 'team-recommendations', label: 'Team Recommendations', url: 'https://game.skport.com/tools/endfield/rec-team' },
];

test('builder publishes the exact 13 reviewed tools in canonical order', () => {
  const feed = buildLauncherTools(generatedAt);
  assert.deepEqual(Object.keys(feed), ['schemaVersion', 'generatedAt', 'tools']);
  assert.deepEqual(feed, { schemaVersion: 1, generatedAt, tools: expectedTools });
  assert.equal(feed.tools.filter((tool) => tool.game === 'wuwa').length, 0);
});

test('generated feed has the strict reviewed contract', async () => {
  const feed = JSON.parse(await fs.readFile(generatedPath, 'utf8'));
  assert.deepEqual(Object.keys(feed), ['schemaVersion', 'generatedAt', 'tools']);
  assert.deepEqual(feed.tools, expectedTools);
  assert.equal(validateLauncherTools(feed), feed);
});

test('validator rejects schema drift, unsafe URLs, unreviewed rows, duplicates, and incomplete feeds', () => {
  const valid = buildLauncherTools(generatedAt);
  const rejects = [
    (feed) => { feed.extra = true; },
    (feed) => { feed.tools[0].extra = true; },
    (feed) => { feed.generatedAt = '2026-08-25'; },
    (feed) => { feed.tools[0].game = 'genshin'; },
    (feed) => { feed.tools[0].url = 'http://wiki.hoyolab.com/pc/genshin/home'; },
    (feed) => { feed.tools[0].url = 'https://user:pass@wiki.hoyolab.com/pc/genshin/home'; },
    (feed) => { feed.tools[0].url = 'https://wiki.hoyolab.com:444/pc/genshin/home'; },
    (feed) => { feed.tools[0].label = 'Official Wiki'; },
    (feed) => { feed.tools[2].url = 'https://act.hoyolab.com/app/community-game-records-sea/index.html?gid=2'; },
    (feed) => { feed.tools[11].url = 'https://game.skport.com/tools/endfield/cost-calculator'; },
    (feed) => { feed.tools[1] = { ...feed.tools[0] }; },
    (feed) => { feed.tools.pop(); },
  ];
  for (const mutate of rejects) {
    const feed = structuredClone(valid);
    mutate(feed);
    assert.throws(() => validateLauncherTools(feed));
  }
});

test('validator can accept a reviewed launcher-compatible subset only when requested', () => {
  const feed = buildLauncherTools(generatedAt);
  feed.tools = [feed.tools[0], feed.tools.at(-1)];
  assert.throws(() => validateLauncherTools(feed), /all reviewed rows/);
  assert.equal(validateLauncherTools(feed, { requireComplete: false }), feed);
  assert.throws(() => validateLauncherTools(feed, { requireComplete: 0 }), /boolean/);
});
