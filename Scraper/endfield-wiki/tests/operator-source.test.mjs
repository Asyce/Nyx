import assert from 'node:assert/strict';
import test from 'node:test';

import { enrichOperatorRow, mergeOperatorRows } from '../scrape.mjs';

test('category-only future operators inherit infobox facts and conventional art names', () => {
  const rows = mergeOperatorRows(
    [{ _pageName:'Arcane', Operator:'Arcane', Rarity:'6' }],
    ['Arcane', 'Typhoeus'],
  );
  assert.deepEqual(rows.map((row) => row.Operator), ['Arcane', 'Typhoeus']);
  assert.equal(rows[0]._categoryOnly, undefined);
  assert.equal(rows[1]._categoryOnly, true);

  const typhoeus = enrichOperatorRow({ ...rows[1], Description:null }, {
    pageName:'Typhoeus',
    title:'Typhoeus',
    upcoming:true,
    infobox:{
      name:'Typhoeus', rarity:'6', class:'Striker', weapon:'Arts Unit', element:'Nature',
      faction:'Rhodes Island', tags:'Damage Dealer, Arts Burst', main:'Agility', sub:'Will',
      headhunting:'chartered', gender:'Female', image:'Typhoeus Splash Art.png',
    },
  });

  assert.deepEqual(typhoeus, {
    _pageName:'Typhoeus', Operator:'Typhoeus', Id:'',
    Icon:'Typhoeus icon.png', Banner:'', Splash:'Typhoeus Splash Art.png', Portrait:'',
    Gender:'Female', Rarity:'6', Class:'Striker', Weapon:'Arts Unit', Element:'Nature',
    Faction:'Rhodes Island', BirthDate:'', Tags:'Damage Dealer, Arts Burst',
    MainAttr:'Agility', SubAttr:'Will', Headhunting:'chartered', Description:'', Quote:'', Trait:'',
  });
});
