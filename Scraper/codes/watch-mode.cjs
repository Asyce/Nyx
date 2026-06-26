#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG = path.join(__dirname, 'livestream-windows.json');

function loadWindows(file = CONFIG) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed.windows) ? parsed.windows : [];
  } catch {
    return [];
  }
}

function activeWindows(windows, now) {
  const t = now.getTime();
  return windows.filter((w) => {
    const start = new Date(w.startsAt).getTime();
    const end = new Date(w.endsAt).getTime();
    return Number.isFinite(start) && Number.isFinite(end) && start <= t && t <= end;
  });
}

function windowGames(windows) {
  return [...new Set(windows
    .map((w) => String(w.game || '').trim().toLowerCase())
    .filter(Boolean))];
}

function decideWatchMode({ now = new Date(), eventName = '', schedule = '', windows = [] } = {}) {
  const active = activeWindows(windows, now);
  const deep = active.some((w) => String(w.mode || '').toLowerCase() === 'deep');
  const redditGames = deep ? windowGames(active) : [];
  const isExtraHalfHour = /^37\s/.test(schedule || '');
  const isSchedule = eventName === 'schedule';
  const shouldRun = !isSchedule || deep || !isExtraHalfHour;
  const reason = active.length
    ? active.map((w) => `${w.game || 'unknown'} ${w.note || 'livestream window'}`).join('; ')
    : 'normal hourly code watch';

  return {
    shouldRun,
    deep,
    npmScript: deep ? 'codes:watch:deep' : 'codes:watch',
    redditGames,
    reason,
  };
}

function readScheduleFromEvent() {
  const file = process.env.GITHUB_EVENT_PATH;
  if (!file) return '';
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).schedule || '';
  } catch {
    return '';
  }
}

function writeGithubOutput(values) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value).replace(/\r?\n/g, ' ')}`);
  fs.appendFileSync(out, `${lines.join('\n')}\n`);
}

function main() {
  const now = process.env.CODES_WATCH_NOW ? new Date(process.env.CODES_WATCH_NOW) : new Date();
  const mode = decideWatchMode({
    now,
    eventName: process.env.GITHUB_EVENT_NAME || '',
    schedule: readScheduleFromEvent(),
    windows: loadWindows(),
  });

  console.log(`Codes watch: ${mode.npmScript}; should_run=${mode.shouldRun}; reason=${mode.reason}`);
  writeGithubOutput({
    should_run: mode.shouldRun ? 'true' : 'false',
    deep: mode.deep ? 'true' : 'false',
    npm_script: mode.npmScript,
    reddit_games: mode.redditGames.join(','),
    reason: mode.reason,
  });
}

if (require.main === module) main();

module.exports = {
  activeWindows,
  decideWatchMode,
  loadWindows,
  windowGames,
};
