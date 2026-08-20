import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAgentDetail, sameKnownAgentName, validateAgentDetail } from '../scrape.mjs';

test('parses ZZZ agent metadata and Materials Calculator items', () => {
  const html = `
    <main>
      <h1>Claret</h1>
      <a href="/agents/beta?filter=r:4">S Rank</a>
      <a href="/agents/beta?filter=s:7">Armorer</a>
      <a href="/agents/beta?filter=e:203">Electric</a>
      <a href="/agents/beta?filter=f:16"><img alt="Roscaelifer"></a>
      <span>ID 1611</span>
      <section>
        <h2>Materials Calculator</h2>
        <a href="/items/currencies/10/denny"><img alt="Denny"><span>3,705,000</span></a>
        <a href="/items/materials/100217/beginner"><img alt="Beginner Armorer Certification Seal"><span>4</span></a>
        <a href="/items/materials/100113/basic"><img alt="Basic Shock Chip"><span>25</span></a>
      </section>
    </main>`;
  const detail = parseAgentDetail(html, { id: '1611', name: 'Fallback' });
  assert.deepEqual({ id: detail.id, name: detail.name, rarity: detail.rarity, attribute: detail.attribute, specialty: detail.specialty, faction: detail.faction }, {
    id: '1611', name: 'Claret', rarity: 'S', attribute: 'Electric', specialty: 'Armorer', faction: 'Roscaelifer',
  });
  assert.deepEqual(detail.materials, [
    { id: '10', name: 'Denny', qty: 3705000 },
    { id: '100217', name: 'Beginner Armorer Certification Seal', qty: 4 },
    { id: '100113', name: 'Basic Shock Chip', qty: 25 },
  ]);
  assert.doesNotThrow(() => validateAgentDetail(detail, { id: '1611', name: 'Claret Flint' }));
  assert.throws(() => validateAgentDetail({ ...detail, id: '9999' }, { id: '1611', name: 'Claret' }), /Unexpected agent ID/);
  assert.throws(() => validateAgentDetail({ ...detail, faction: null }, { id: '1611', name: 'Claret' }), /Missing agent metadata: faction/);
  assert.equal(sameKnownAgentName('Remielle Dan', 'Remielle Dan'), true);
  assert.equal(sameKnownAgentName('Starlight - Billy', 'Billy - Starlight'), true);
  assert.equal(sameKnownAgentName('Billy - Starlight', 'Billy'), false);
});
