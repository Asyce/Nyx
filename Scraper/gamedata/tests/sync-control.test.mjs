import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { detectManifestChanges } from '../check-upstream.mjs';
import { validateGameDataOutput } from '../validate-output.mjs';

test('manifest detection reports only supported games whose live or beta data changed', () => {
  const current = {
    hsr: { live: '4.3', latest: '4.3.56', available: ['4.3', '4.3.56'], new: { character: [1508] } },
    gi: { live: '6.7', latest: '6.7.52' },
  };
  const upstream = {
    hsr: { live: '4.4', latest: '4.4.51', available: ['4.3', '4.4', '4.4.51'], new: { character: [1512, 1513] } },
    gi: { live: '6.7', latest: '6.7.52' },
    nte: { live: '1.2', latest: '1.2.14' },
  };

  assert.deepEqual(detectManifestChanges(current, upstream, ['hsr', 'gi']), {
    changed: true,
    games: ['hsr'],
  });
});

test('manifest detection ignores object key order and unsupported games', () => {
  const current = { hsr: { live: '4.4', latest: '4.4.51' } };
  const upstream = {
    hsr: { latest: '4.4.51', live: '4.4' },
    nte: { live: '1.2', latest: '1.2.14' },
  };
  assert.deepEqual(detectManifestChanges(current, upstream, ['hsr']), { changed: false, games: [] });
});

test('GameData-only validation accepts matching live and beta output without reading unrelated datasets', async (t) => {
  const databaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nyx-gamedata-'));
  t.after(() => fs.rm(databaseDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(databaseDir, 'GameData', 'hsr', 'live'), { recursive: true });
  await fs.mkdir(path.join(databaseDir, 'GameData', 'hsr', 'beta'), { recursive: true });
  await fs.writeFile(path.join(databaseDir, 'GameData', 'manifest.json'), JSON.stringify({
    hsr: { live: '4.4', latest: '4.4.51' },
  }));

  for (const [channel, version] of [['live', '4.4'], ['beta', '4.4.51']]) {
    const relativeFile = `GameData/hsr/${channel}/characters.json`;
    const asset = 'GameData/hsr/assets/characters/round/1512.webp';
    await fs.mkdir(path.join(databaseDir, path.dirname(asset)), { recursive: true });
    await fs.writeFile(path.join(databaseDir, asset), 'fixture');
    await fs.writeFile(path.join(databaseDir, relativeFile), JSON.stringify([
      { id: '1512', name: 'Robin Summeretto', assets: { roundIcon: asset } },
      { id: '1513', name: 'Aventurine Waveflair', assets: { roundIcon: asset } },
    ]));
    await fs.writeFile(path.join(databaseDir, 'GameData', 'hsr', channel, 'metadata.json'), JSON.stringify({
      channel,
      version,
      counts: { characters: 2 },
      files: { characters: relativeFile },
    }));
  }

  const results = await validateGameDataOutput(databaseDir, ['hsr']);
  assert.deepEqual(results.map(({ channel, version }) => ({ channel, version })), [
    { channel: 'live', version: '4.4' },
    { channel: 'beta', version: '4.4.51' },
  ]);
});

test('GameData-only validation rejects a missing referenced asset', async (t) => {
  const databaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nyx-gamedata-assets-'));
  t.after(() => fs.rm(databaseDir, { recursive: true, force: true }));
  const channelDir = path.join(databaseDir, 'GameData', 'hsr', 'live');
  await fs.mkdir(channelDir, { recursive: true });
  await fs.writeFile(path.join(databaseDir, 'GameData', 'manifest.json'), JSON.stringify({
    hsr: { live: '4.4', latest: '4.4' },
  }));
  const relativeFile = 'GameData/hsr/live/characters.json';
  await fs.writeFile(path.join(databaseDir, relativeFile), JSON.stringify([{
    id: '1512',
    name: 'Robin Summeretto',
    assets: { roundIcon: 'GameData/hsr/assets/characters/round/1512.webp' },
  }]));
  await fs.writeFile(path.join(channelDir, 'metadata.json'), JSON.stringify({
    channel: 'live', version: '4.4', counts: { characters: 1 }, files: { characters: relativeFile },
  }));
  await assert.rejects(
    validateGameDataOutput(databaseDir, ['hsr']),
    /references missing asset GameData\/hsr\/assets\/characters\/round\/1512\.webp/,
  );
});
