import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { detectManifestChanges } from '../check-upstream.mjs';
import { stripMissingAssetReferences } from '../lib/gamedata-game.mjs';
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

test('GameData-only validation identifies records that have no portrait source', async (t) => {
  const databaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nyx-gamedata-portrait-'));
  t.after(() => fs.rm(databaseDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(databaseDir, 'GameData'), { recursive: true });
  await fs.writeFile(path.join(databaseDir, 'GameData', 'manifest.json'), JSON.stringify({
    zzz: { live: '3.0', latest: '3.0' },
  }));

  for (const channel of ['live', 'beta']) {
    const channelDir = path.join(databaseDir, 'GameData', 'zzz', channel);
    const relativeFile = `GameData/zzz/${channel}/agents.json`;
    await fs.mkdir(channelDir, { recursive: true });
    await fs.writeFile(path.join(databaseDir, relativeFile), JSON.stringify([
      { id: '1581', name: 'Avatar_Female_Size02_Remielle', assets: {} },
    ]));
    await fs.writeFile(path.join(channelDir, 'metadata.json'), JSON.stringify({
      channel, version: '3.0', counts: { agents: 1 }, files: { agents: relativeFile },
    }));
  }

  await assert.rejects(
    validateGameDataOutput(databaseDir, ['zzz']),
    /without a local portrait reference: Avatar_Female_Size02_Remielle \(1581\)/,
  );
});

test('beta character and agent records that end with no local art are omitted after stripping', () => {
  const missing = [
    'GameData/ww/assets/characters/icons/1212.webp',
    'GameData/ww/assets/characters/portraits/1212.webp',
    'GameData/ww/assets/characters/portraits/1213.webp',
    'GameData/zzz/assets/agents/icons/1413.webp',
    'GameData/zzz/assets/agents/partner-icons/1413.webp'
  ].map((path) => ({ path }));
  const collections = {
    characters: [
      {
        id: '1212',
        name: 'Stay tuned',
        assets: {
          icon: 'GameData/ww/assets/characters/icons/1212.webp',
          portrait: 'GameData/ww/assets/characters/portraits/1212.webp'
        }
      },
      {
        id: '1213',
        name: 'Partial art',
        assets: {
          icon: 'GameData/ww/assets/characters/icons/1213.webp',
          portrait: 'GameData/ww/assets/characters/portraits/1213.webp'
        }
      },
      { id: '1214', name: 'No art reference', assets: {} }
    ],
    agents: [{
      id: '1413',
      name: 'Qingxiao',
      assets: {
        icon: 'GameData/zzz/assets/agents/icons/1413.webp',
        partnerIcon: 'GameData/zzz/assets/agents/partner-icons/1413.webp'
      }
    }]
  };

  const omissions = stripMissingAssetReferences(collections, missing, {
    omitBetaCharacterRecords: true
  });

  assert.deepEqual(omissions, [
    {
      section: 'characters',
      id: '1212',
      name: 'Stay tuned',
      missingAssets: [
        'GameData/ww/assets/characters/icons/1212.webp',
        'GameData/ww/assets/characters/portraits/1212.webp'
      ]
    },
    {
      section: 'characters',
      id: '1214',
      name: 'No art reference',
      missingAssets: []
    },
    {
      section: 'agents',
      id: '1413',
      name: 'Qingxiao',
      missingAssets: [
        'GameData/zzz/assets/agents/icons/1413.webp',
        'GameData/zzz/assets/agents/partner-icons/1413.webp'
      ]
    }
  ]);
  assert.deepEqual(collections.characters.map(({ id }) => id), ['1213']);
  assert.deepEqual(collections.characters[0].assets, {
    icon: 'GameData/ww/assets/characters/icons/1213.webp'
  });
  assert.deepEqual(collections.agents, []);
});

test('beta records with no upstream art source are omitted even when no downloads fail', () => {
  const collections = {
    characters: [
      { id: '1201', name: 'No source', assets: {} },
      {
        id: '1202',
        name: 'Has source',
        assets: { icon: 'GameData/ww/assets/characters/icons/1202.webp' }
      }
    ]
  };

  const omissions = stripMissingAssetReferences(collections, [], {
    omitBetaCharacterRecords: true
  });

  assert.deepEqual(collections.characters.map(({ id }) => id), ['1202']);
  assert.deepEqual(omissions, [{
    section: 'characters',
    id: '1201',
    name: 'No source',
    missingAssets: []
  }]);
});
