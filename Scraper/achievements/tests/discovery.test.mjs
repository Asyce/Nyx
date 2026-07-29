import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { createDiscoveryObservation, validateAchievementDiscoveryPlan } from '../discovery.mjs';

test('all unreleased achievement games have complete metadata-only discovery plans', async () => {
  const plan = JSON.parse(await fs.readFile(
    new URL('../../../Database/Achievements/discovery.json', import.meta.url),
    'utf8',
  ));
  assert.doesNotThrow(() => validateAchievementDiscoveryPlan(plan));
  assert.deepEqual(plan.games.map(({ game }) => game), ['zzz', 'wuwa', 'ae']);
  assert.ok(plan.games.every(({ publishable }) => publishable === false));
});

test('discovery observations accept bounded facts and reject payload-shaped data', () => {
  const observation = createDiscoveryObservation({
    game: 'wuwa',
    probeId: 'wuwa-network-shapes',
    observedAt: '2026-07-26T12:00:00Z',
    outcome: 'partial-signal',
    signals: {
      requestCount: 12,
      responseCount: 12,
      hasStableIds: false,
      hasCompleteState: false,
    },
  });
  assert.equal(observation.schemaVersion, 1);
  assert.equal(observation.signals.requestCount, 12);
  assert.throws(
    () => createDiscoveryObservation({
      game: 'wuwa',
      probeId: 'wuwa-network-shapes',
      observedAt: '2026-07-26T12:00:00Z',
      outcome: 'candidate',
      signals: { responseBody: '{"token":"secret"}' },
    }),
    /bounded metadata/,
  );
});

test('discovery plan fails closed if a probe records payloads or credentials', async () => {
  const plan = JSON.parse(await fs.readFile(
    new URL('../../../Database/Achievements/discovery.json', import.meta.url),
    'utf8',
  ));
  plan.games[0].probes[0].recordsPayloads = true;
  assert.throws(() => validateAchievementDiscoveryPlan(plan), /metadata-only policy/);
});
