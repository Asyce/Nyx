'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { GAMES, mergeBannerSources, parsePrydwenPage } = require('../scrape.cjs');

test('Prydwen parses character phases and supplements Game8 without overriding it', () => {
  const card = ({ category = 'character', section, banner, phase, start = '', end = '', featured, secondary = '' }) => `
    <article data-banner-card="true" data-category="${category}" data-section="${section}">
      <b class="banner-name">${banner}</b>
      <div class="banner-phase-meta"><span>${phase}</span></div>
      <time data-banner-timer data-start-asia="${start}" data-end-asia="${end}"></time>
      <div aria-label="Featured Rate Up">${featured.map((name) => `<span class="featured-rate-up">${name}</span>`).join('')}</div>
      <div aria-label="Secondary Rate Up"><span class="featured-rate-up">${secondary}</span></div>
    </article>`;
  const html = [
    card({ section:'current', banner:'First Light', phase:'4.5 Phase 1', start:'2026-08-20T04:00:00Z', end:'2026-09-10T04:00:00Z', featured:['Alpha'], secondary:'Wrong Alpha' }),
    card({ section:'current', banner:'Second Light', phase:'4.5 Phase 1', start:'2026-08-20T04:00:00Z', end:'2026-09-10T04:00:00Z', featured:['Beta'] }),
    card({ section:'current', banner:'Old Collab', phase:'Collaboration', featured:['Old Hero'] }),
    card({ category:'weapon', section:'current', banner:'Weapon', phase:'4.5 Phase 1', end:'2026-09-10T04:00:00Z', featured:['Wrong Weapon'] }),
    card({ section:'upcoming', banner:'Third Light', phase:'4.5 Phase 2', start:'2026-09-10T04:00:00Z', end:'2026-10-01T04:00:00Z', featured:['Gamma'] }),
    card({ section:'upcoming', banner:'Fourth Light', phase:'4.5 Phase 2', start:'2026-09-10T16:00:00Z', end:'2026-10-01T04:00:00Z', featured:['Delta'] }),
    card({ section:'upcoming', banner:'Later Light', phase:'4.6 Phase 1', start:'2026-10-08T04:00:00Z', end:'2026-10-29T04:00:00Z', featured:['Epsilon'] }),
    card({ section:'teased', banner:'Distant Light', phase:'Announced', featured:[] }),
  ].join('');
  const parsed = parsePrydwenPage(html, Date.parse('2026-08-30T00:00:00Z'));

  assert.deepEqual(parsed.current.characters, ['Alpha', 'Beta']);
  assert.equal(parsed.current.phase, '4.5 Phase 1');
  assert.deepEqual(parsed.next.characters, ['Gamma', 'Delta']);
  assert.equal(parsed.next.start, '2026-09-10T04:00:00.000Z');
  assert.equal(parsed.next.end, '2026-10-01T04:00:00.000Z');
  assert.deepEqual(parsed.upcoming.map((phase) => [phase.phase, phase.characters, phase.teased === true]), [
    ['4.6 Phase 1', ['Epsilon'], false],
    ['Announced', ['Distant Light'], true],
  ]);

  const merged = mergeBannerSources({ source:'game8', result:{
    current:{ phase:'Game8 Current', characters:['Game8 Hero'], end:'2026-09-10T04:00:00.000Z' },
    next:{ phase:null, characters:['Gamma'], start:null, end:null },
    upcoming:[{ phase:'4.6 Phase 1', characters:['Epsilon'], start:'2026-10-08T04:00:00.000Z', end:'2026-10-29T04:00:00.000Z' }],
  } }, { source:'prydwen', result:parsed });
  assert.equal(merged.source, 'game8+prydwen');
  assert.deepEqual(merged.result.current.characters, ['Game8 Hero']);
  assert.deepEqual(merged.result.next.characters, ['Gamma', 'Delta']);
  assert.deepEqual(merged.result.upcoming.map((phase) => phase.characters), [['Epsilon'], ['Distant Light']]);

  assert.deepEqual(Object.fromEntries(GAMES.map((game) => [game.id, game.prydwenUrl])), {
    hsr:'https://www.prydwen.gg/star-rail/banners',
    genshin:'https://www.prydwen.gg/genshin-impact/banners',
    wuwa:'https://www.prydwen.gg/wuthering-waves/banners',
    zzz:'https://www.prydwen.gg/zenless/banners',
    endfield:'https://www.prydwen.gg/arknights-endfield/banners',
  });
});
