'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  completeLocalizedSnapshot,
  fetchHtml,
  fetchTeaserArt,
  localizeTeaserArt,
  parseGame8RoadmapCharacters,
  repairImpossibleCurrentEnd,
  requiredCurrentSourceFailures,
  roadmapSnapshot,
  scrapeGame8RoadmapCharacters,
  scrapeGame8UpcomingCharacters,
  SourceUnavailableError,
  selectRoadmapRows,
  teaserSnapshot,
  GAMES,
  runCli
} = require('../scrape.cjs');
const { requiredBannerFreshnessFailures } = require('../normalize.cjs');

const silentLogger = { error() {} };
const quietLogger = { log() {}, error() {} };

test('an impossible current end uses the known next-phase boundary', () => {
  const result = repairImpossibleCurrentEnd({
    current:{ end:'2206-09-01T10:00:00.000Z' },
    next:{ start:'2026-09-01T10:00:00.000Z' },
  });

  assert.equal(result.current.end, result.next.start);
});

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

test('roadmap failures preserve only the independent observation timestamp', () => {
  const checkedAt = '2026-08-14T12:00:00.000Z';
  const previous = {
    roadmap:[{ name:'Old Reveal' }],
    roadmapFreshness:{ source:'game8', checkedAt:'2026-08-01T00:00:00.000Z', lastSuccessfulFetch:'2026-08-01T00:00:00.000Z' },
  };

  assert.deepEqual(roadmapSnapshot(null, previous, checkedAt), {
    roadmap:previous.roadmap,
    roadmapFreshness:previous.roadmapFreshness,
  });
  assert.deepEqual(roadmapSnapshot([], previous, checkedAt), {
    roadmap:[],
    roadmapFreshness:{ source:'game8', checkedAt, lastSuccessfulFetch:checkedAt },
  });
  assert.deepEqual(roadmapSnapshot(null, { roadmap:previous.roadmap }, checkedAt), {
    roadmap:previous.roadmap,
    roadmapFreshness:null,
  });
});

test('Endfield teaser failures preserve only the independent observation timestamp', () => {
  const checkedAt = '2026-08-14T12:00:00.000Z';
  const characters = [{ name:'Old Reveal', image:'/assets/banners/ae/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png' }];
  const previous = {
    upcoming:[{ characters, start:null, end:null, teased:true }],
    teaserFreshness:{ source:'game8', checkedAt:'2026-08-01T00:00:00.000Z', lastSuccessfulFetch:'2026-08-01T00:00:00.000Z' },
  };

  assert.deepEqual(teaserSnapshot(null, previous, checkedAt), {
    teased:characters,
    teaserFreshness:previous.teaserFreshness,
  });
  assert.deepEqual(teaserSnapshot([], previous, checkedAt), {
    teased:[],
    teaserFreshness:{ source:'game8', checkedAt, lastSuccessfulFetch:checkedAt },
  });
  assert.deepEqual(teaserSnapshot(null, { upcoming:previous.upcoming }, checkedAt), {
    teased:characters,
    teaserFreshness:null,
  });
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
    <table><tr>
      <td><img alt="Claret Upcoming" data-src="https://img.game8.co/1/claret.png/show"></td>
      <td><a><img alt="Flint Workshop Icon" data-src="https://img.game8.co/1/faction.png/show">Flint Workshop</a></td>
    </tr></table>
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

test('named release sections trust the linked card when the Game8 heading is stale', () => {
  const html = `
    <h2>List of Upcoming Characters</h2>
    <h3>Robin - Summeretto Release in Phase 1 of Version 4.6</h3>
    <table><tr><td><a><img alt="Star Rail - Pearl" data-src="https://img.game8.co/1/pearl.png/show">Pearl</a></td></tr></table>
    <h2>History</h2>`;

  assert.deepEqual(parseGame8RoadmapCharacters(html, 'hsr'), [
    { name:'Pearl', image:'https://img.game8.co/1/pearl.png/show', hint:'Robin - Summeretto Release in Phase 1 of Version 4.6' },
  ]);
});

test('multi-character version headings admit only their matching linked cards', () => {
  const html = `
    <h2>Upcoming WuWa Characters</h2>
    <h3>Qingxiao and Jingran in Version 3.6</h3>
    <table><tr>
      <td><a><img alt="Wuthering Waves - Qingxiao" data-src="https://img.game8.co/1/qingxiao.png/show">Qingxiao</a></td>
      <td><a><img alt="Wuthering Waves - Fusion" data-src="https://img.game8.co/2/fusion.png/show">Fusion</a></td>
      <td><a><img alt="Wuthering Waves - Jingran" data-src="https://img.game8.co/3/jingran.png/show">Jingran</a></td>
    </tr></table>
    <h2>History</h2>`;

  assert.deepEqual(parseGame8RoadmapCharacters(html, 'wuwa'), [
    { name:'Qingxiao', image:'https://img.game8.co/1/qingxiao.png/show', hint:'Qingxiao and Jingran in Version 3.6' },
    { name:'Jingran', image:'https://img.game8.co/3/jingran.png/show', hint:'Qingxiao and Jingran in Version 3.6' },
  ]);
});

test('roadmap parser trusts new Game8 art identities without a manual name list', () => {
  const html = `
    <h2>New and Upcoming Characters</h2>
    <table><tr>
      <td><a><img alt="Aurora Character Icon" data-src="https://img.game8.co/1/aurora.png/show">Aurora</a></td>
      <td><a><img alt="Generic Teaser" data-src="https://img.game8.co/2/catalog.png/show">Catalog Hero</a></td>
      <td><a><img alt="Sunbringer Icon" data-src="https://img.game8.co/3/wrong.png/show">Ring</a></td>
      <td><a><img alt="Outsider Icon" data-src="https://example.com/outsider.png">Outsider</a></td>
      <td><a><img data-src="https://img.game8.co/4/no-alt.png/show">No Alt</a></td>
    </tr></table>
    <h2>History</h2>`;

  assert.deepEqual(parseGame8RoadmapCharacters(html, 'zzz', new Set(['cataloghero'])), [
    { name:'Aurora', image:'https://img.game8.co/1/aurora.png/show', hint:'New and Upcoming Characters' },
    { name:'Catalog Hero', image:'https://img.game8.co/2/catalog.png/show', hint:'New and Upcoming Characters' },
  ]);
});

test('roadmap art and Endfield page outages return the carry-forward sentinel', async () => {
  const roadmap = await scrapeGame8RoadmapCharacters(
    'https://game8.co/games/Honkai-Star-Rail/archives/415899',
    { id:'hsr' },
    new Set(),
    quietLogger,
    {
      fetchHtmlImpl:async () => '<h2>List of Upcoming Characters</h2><table><tr><td><a><img alt="Star Rail - Pearl" data-src="https://img.game8.co/1/pearl.png/show">Pearl</a></td></tr></table><h2>History</h2>',
      localizeImpl:async (_bucket, rows) => rows.map((row) => ({ ...row, image:null })),
    },
  );
  assert.equal(roadmap, null);

  const teased = await scrapeGame8UpcomingCharacters(
    'https://game8.co/games/Arknights-Endfield/archives/529966',
    quietLogger,
    'ae',
    { fetchHtmlImpl:async () => { throw new Error('page unavailable'); } },
  );
  assert.equal(teased, null);
});

test('partial teaser localization preserves prior provenance and writes no orphan art', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-teaser-transaction-'));
  const artRoot = path.join(root, 'assets');
  const provenanceFile = path.join(root, 'provenance.json');
  const previous = { buckets:{ hsr:[{ name:'Old Reveal', localPath:'/assets/banners/hsr/old.png' }] }, generatedAt:'2026-08-01T00:00:00.000Z' };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(provenanceFile, `${JSON.stringify(previous, null, 2)}\n`);
  let calls = 0;
  try {
    const rows = await localizeTeaserArt('hsr', [
      { name:'One', image:'https://img.game8.co/1/one.png/show' },
      { name:'Two', image:'https://img.game8.co/2/two.png/show' },
    ], quietLogger, {
      artRoot,
      provenanceFile,
      fetchArtImpl:async () => {
        calls += 1;
        if (calls === 1) return png;
        throw new Error('CDN unavailable');
      },
    });
    assert.equal(completeLocalizedSnapshot('hsr', rows), null);
    assert.deepEqual(JSON.parse(fs.readFileSync(provenanceFile, 'utf8')), previous);
    assert.equal(fs.existsSync(artRoot), false);
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('HTML fetch rejects unapproved sources, redirects, and declared oversize bodies before reading', async () => {
  const source = 'https://game8.co/games/Honkai-Star-Rail/archives/415899';
  let read = false;
  const response = (overrides = {}) => ({
    ok:true,
    status:200,
    redirected:false,
    url:source,
    headers:{ get:() => null },
    body:{ getReader() { read = true; return { read:async () => ({ done:true }), releaseLock() {} }; } },
    ...overrides,
  });

  await assert.rejects(fetchHtml('https://example.com/page', { fetchImpl:async () => response() }), /not approved/);
  await assert.rejects(fetchHtml(source, {
    fetchImpl:async (_url, options) => {
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers['User-Agent'], 'Prydwen test agent');
      return response({ redirected:true, url:'https://example.com/page' });
    },
    headers:{ 'User-Agent':'Prydwen test agent' },
  }), /HTML source redirected/);
  await assert.rejects(fetchHtml(source, {
    maxBytes:4,
    fetchImpl:async () => response({ headers:{ get:(name) => name === 'content-length' ? '5' : null } }),
  }), /unexpected size 5/);
  assert.equal(read, false);
});

test('HTML fetch stops no-length oversized streams and times out stalled streams', async () => {
  const source = 'https://game8.co/games/Honkai-Star-Rail/archives/415899';
  let cancelled = false;
  const response = (reader) => ({
    ok:true,
    status:200,
    redirected:false,
    url:source,
    headers:{ get:() => null },
    body:{ getReader:() => reader },
  });
  const chunks = [Buffer.alloc(3), Buffer.alloc(2)];
  await assert.rejects(fetchHtml(source, {
    maxBytes:4,
    fetchImpl:async () => response({
      read:async () => chunks.length ? { done:false, value:chunks.shift() } : { done:true },
      cancel:async () => { cancelled = true; },
      releaseLock() {},
    }),
  }), /unexpected size 5/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);

  await assert.rejects(fetchHtml(source, {
    timeoutMs:10,
    fetchImpl:async () => response({
      read:() => new Promise(() => {}),
      releaseLock() {},
    }),
  }), /HTML request timed out after 10ms/);
});

test('teaser art download rejects redirects and declared oversize responses before reading', async () => {
  const source = 'https://img.game8.co/1/teaser.png/show';
  let read = false;
  const response = (overrides = {}) => ({
    ok:true,
    status:200,
    redirected:false,
    url:source,
    headers:{ get:() => null },
    body:{ getReader() { read = true; return { read:async () => ({ done:true }), releaseLock() {} }; } },
    ...overrides,
  });

  await assert.rejects(fetchTeaserArt(source, {
    fetchImpl:async (_url, options) => {
      assert.equal(options.redirect, 'error');
      return response({ redirected:true, url:'https://example.com/teaser.png' });
    },
  }), /teaser art source redirected/);
  await assert.rejects(fetchTeaserArt(source, {
    maxBytes:4,
    fetchImpl:async () => response({ headers:{ get:(name) => name === 'content-length' ? '5' : null } }),
  }), /unexpected size 5/);
  assert.equal(read, false);
});

test('teaser art download stops no-length oversized streams and times out stalled streams', async () => {
  const source = 'https://img.game8.co/1/teaser.png/show';
  let cancelled = false;
  const response = (reader) => ({
    ok:true,
    status:200,
    redirected:false,
    url:source,
    headers:{ get:() => null },
    body:{ getReader:() => reader },
  });
  const chunks = [Buffer.alloc(3), Buffer.alloc(2)];
  await assert.rejects(fetchTeaserArt(source, {
    maxBytes:4,
    fetchImpl:async () => response({
      read:async () => chunks.length ? { done:false, value:chunks.shift() } : { done:true },
      cancel:async () => { cancelled = true; },
      releaseLock() {},
    }),
  }), /unexpected size 5/);
  assert.equal(cancelled, true);

  await assert.rejects(fetchTeaserArt(source, {
    timeoutMs:10,
    fetchImpl:async () => response({
      read:() => new Promise(() => {}),
      releaseLock() {},
    }),
  }), /timed out after 10ms/);
});

test('story-only roadmap names are dropped and the pinned pair is flagged', () => {
  // game8 lists story NPCs beside real upcoming units, and the parser now
  // trusts art identity rather than a manual allowlist — so the denylist is
  // the only thing keeping names nobody expects to play off the board.
  const genshin = GAMES.find((game) => game.id === 'genshin');
  const rows = selectRoadmapRows([
    { name:'Vesna' }, { name:'Noy' },
    { name:'Pantalone' }, { name:'Rerir' }, { name:'Pulcinella' }, { name:'Pierro' },
    { name:'Dainsleif' }, { name:'Alice' },
  ], genshin);

  assert.deepEqual(rows.filter((row) => !row.pinned).map((row) => row.name), ['Vesna', 'Noy']);
  // Pinned rows stay in the scrape so their teaser art is localized with
  // everyone else's; the site data splits them out for display.
  assert.deepEqual(rows.filter((row) => row.pinned).map((row) => row.name), ['Dainsleif', 'Alice']);
});

test('a pinned name outranks the caller-supplied exclusion set', () => {
  // `excluded` holds names already shown in a live or next phase. A pin is a
  // deliberate editorial choice and is not subject to it.
  const genshin = GAMES.find((game) => game.id === 'genshin');
  const rows = selectRoadmapRows(
    [{ name:'Dainsleif' }, { name:'Vesna' }],
    genshin,
    new Set(['dainsleif', 'vesna']),
  );

  assert.deepEqual(rows.map((row) => `${row.name}:${row.pinned ? 'pinned' : 'plain'}`), ['Dainsleif:pinned']);
});
