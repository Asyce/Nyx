import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeHsrMonster } from '../games/hsr.mjs';
import { isUnreleasedAgentPlaceholder, normalizeZzzAgent } from '../games/zzz.mjs';

test('HSR monster normalization preserves released fields and exact local icon provenance', () => {
  const registrations = [];
  const row = normalizeHsrMonster({
    id: '1002011',
    channel: 'live',
    summary: {
      en: 'Ice Edge',
      rank: 'MinionLv2',
      camp: 7,
      weak: ['Fire', 'Thunder'],
      icon: 'SpriteOutput/MonsterFigure/Monster_1002011.png',
      desc: 'Released description.',
    },
    assetBag: {
      register(local, remote) {
        registrations.push({ local, remote });
        return local;
      },
    },
  });

  assert.equal(row.rank, 'MinionLv2');
  assert.equal(row.camp, 7);
  assert.deepEqual(row.weaknesses, ['Fire', 'Thunder']);
  assert.equal(row.assets.icon, 'GameData/hsr/assets/monsters/Monster_1002011.webp');
  assert.deepEqual(registrations, [{
    local: 'GameData/hsr/assets/monsters/Monster_1002011.webp',
    remote: 'monsterfigure/Monster_1002011.webp',
  }]);
});

test('HSR monster normalization never invents an icon filename', () => {
  const row = normalizeHsrMonster({
    id: 'missing-icon',
    channel: 'live',
    summary: { en: 'No Icon', rank: 'MinionLv1', weak: [] },
    assetBag: { register() { throw new Error('must not register'); } },
  });
  assert.equal(row.assets, undefined);
});

test('ZZZ normalization drops only unmistakable unreleased internal avatar shells', () => {
  const placeholder = {
    code: 'Avatar_Female_Size02_Remielle_En',
    en: 'Avatar_Female_Size02_Remielle',
    icon: '',
  };
  const detail = {
    name: 'Avatar_Female_Size02_Remielle',
    code_name: 'Avatar_Female_Size02_Remielle_En',
    icon: '',
    partner_info: {},
  };
  assert.equal(isUnreleasedAgentPlaceholder(placeholder, detail), true);
  assert.equal(normalizeZzzAgent({ id: '1581', summary: placeholder, detail }), null);
  assert.equal(isUnreleasedAgentPlaceholder({ en: 'Remielle', icon: '' }, { name: 'Remielle' }), false);
  assert.equal(isUnreleasedAgentPlaceholder(placeholder, { ...detail, icon: 'IconRole67' }), false);
});
