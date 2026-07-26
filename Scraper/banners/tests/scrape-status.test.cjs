'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
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
