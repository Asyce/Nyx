'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseGame8RoadmapCharacters,
  requiredCurrentSourceFailures,
  SourceUnavailableError,
  runCli
} = require('../scrape.cjs');
const { requiredBannerFreshnessFailures } = require('../normalize.cjs');

const silentLogger = { error() {} };

test('an expected source outage has the distinct retryable exit status 2', async () => {
  const exitCode = await runCli(async () => {
    throw new SourceUnavailableError('no current-run source for genshin');
  }, silentLogger);

  assert.equal(exitCode, 2);
});

test('current-run source success is required separately from age freshness', () => {
  const now = Date.parse('2026-07-26T12:00:00.000Z');
  const preservedButRecent = {
    id: 'genshin',
    freshness: {
      status: 'fresh',
      lastSuccessfulFetch: '2026-07-26T11:00:00.000Z',
      message: 'preserved previous data'
    },
    current: {
      characters: [{ name: 'Example' }],
      end: '2026-08-01T12:00:00.000Z'
    }
  };

  assert.deepEqual(requiredBannerFreshnessFailures([preservedButRecent], now), []);
  assert.deepEqual(
    requiredCurrentSourceFailures(['genshin', 'endfield'], [], ['endfield']),
    ['genshin']
  );
});

test('an unexpected scraper error stays red with exit status 1', async () => {
  const exitCode = await runCli(async () => {
    throw new Error('parser bug');
  }, silentLogger);

  assert.equal(exitCode, 1);
});

test('roadmap parser keeps character order, phase hints, and teaser art only', () => {
  const html = `
    <h2><span>New and Upcoming Characters</span></h2>
    <h3>Claret Release in 3.2</h3>
    <table><tr><td><img alt="Claret Upcoming" data-src="https://img.game8.co/1/claret.png/show"></td></tr></table>
    <h3>New Characters in Season 3</h3>
    <table><tr>
      <td><a><img alt="Lady Sunbringer Icon" data-src="https://img.game8.co/2/sunbringer.png/show">Sunbringer</a></td>
      <td><a><img alt="ZZZ - Electric" data-src="https://img.game8.co/3/electric.png/show">Electric</a></td>
    </tr></table>
    <h2>History</h2>`;

  assert.deepEqual(parseGame8RoadmapCharacters(html, 'zzz'), [
    { name:'Claret', image:'https://img.game8.co/1/claret.png/show', hint:'Claret Release in 3.2' },
    { name:'Sunbringer', image:'https://img.game8.co/2/sunbringer.png/show', hint:'New Characters in Season 3' },
  ]);
});
