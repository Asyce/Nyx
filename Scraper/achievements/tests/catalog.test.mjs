import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { assertCatalogNotCollapsed, inspectAchievementIconBytes, normalizeGiCatalog, normalizeHsrCatalog, validateCatalog } from '../core.mjs';

const FIXED = {
  sourceCommit: 'fixture',
  generatedAt: '2026-07-14T00:00:00.000Z',
  dataTimestamp: '2026-07-13T00:00:00.000Z',
};

async function fixture(name) {
  return JSON.parse(await fs.readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function png(dimension) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(dimension, 0); header.writeUInt32BE(dimension, 4);
  header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(dimension * (1 + dimension * 4));
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function icon(game, kind, hashCharacter, sourceKey) {
  return { kind:'image', path:`/assets/achievements/${game}/${kind}/${hashCharacter.repeat(64)}.png`, sourceKey };
}

test('GI flattens every stage and excludes data beyond the release ceiling', async () => {
  const catalog = normalizeGiCatalog(await fixture('gi'), { ...FIXED, releasedVersion: '7.0' });
  assert.equal(catalog.game, 'gi');
  assert.equal(catalog.catalogVersion, '7.0');
  assert.deepEqual(catalog.categories.map(({ id }) => id), ['gi-1', 'gi-0']);
  assert.deepEqual(catalog.achievements.map(({ id }) => id), ['200', '100', '101', '102']);
  assert.deepEqual(catalog.achievements.slice(2, 4).map(({ stage, stageCount }) => [stage, stageCount]), [[1, 2], [2, 2]]);
  assert.deepEqual(catalog.categories[1].symbol, { kind: 'monogram', value: 'WW' });
  assert.doesNotThrow(() => validateCatalog(catalog));
});

test('HSR builds stable series categories, removes game markup, and excludes future data', async () => {
  const catalog = normalizeHsrCatalog(await fixture('hsr'), { ...FIXED, releasedVersion: '4.5' });
  assert.equal(catalog.achievements[0].reward, 20);
  assert.equal(catalog.game, 'hsr');
  assert.deepEqual(catalog.categories.map(({ id }) => id), ['hsr-1', 'hsr-3']);
  assert.deepEqual(catalog.achievements.map(({ id }) => id), ['4010101', '4030101', '4030102', '4030103']);
  assert.equal(catalog.achievements[1].description, 'Launch a journey Board the Astral Express.');
  assert.doesNotMatch(catalog.achievements[1].description, /[<>]/);
  assert.doesNotThrow(() => validateCatalog(catalog));
});

test('catalog icon contracts require complete, local, released category coverage', async () => {
  const raw = await fixture('gi');
  const categoryIcons = {
    'gi-1':icon('gi', 'categories', 'a', 'UI_AchievementIcon_A001'),
    'gi-0':icon('gi', 'categories', 'b', 'UI_AchievementIcon_O001'),
  };
  const rewardCurrency = { name:'Primogem', icon:icon('gi', 'rewards', 'c', 'UI_ItemIcon_201') };
  const catalog = normalizeGiCatalog(raw, { ...FIXED, releasedVersion:'7.0', categoryIcons, rewardCurrency });
  assert.ok(catalog.categories.every(({ icon:categoryIcon }) => categoryIcon?.kind === 'image'));
  assert.deepEqual(catalog.rewardCurrency, rewardCurrency);

  assert.throws(() => normalizeGiCatalog(raw, { ...FIXED, categoryIcons:{ 'gi-1':categoryIcons['gi-1'] } }), /icon coverage is incomplete/);
  assert.throws(() => normalizeGiCatalog(raw, { ...FIXED, categoryIcons:{ ...categoryIcons, 'gi-999':categoryIcons['gi-1'] } }), /missing or unreleased category/);
  assert.throws(() => normalizeGiCatalog(raw, {
    ...FIXED,
    categoryIcons:{ ...categoryIcons, 'gi-1':{ ...categoryIcons['gi-1'], path:'https://example.test/icon.png' } },
  }), /icon path is invalid/);
});

test('achievement icon inspection enforces real image structure, size, and dimensions', async () => {
  const minimum = png(32);
  assert.deepEqual(inspectAchievementIconBytes(minimum), { mediaType:'image/png', width:32, height:32, bytes:minimum.length });
  assert.throws(() => inspectAchievementIconBytes(png(31)), /dimensions 31x31/);
  assert.throws(() => inspectAchievementIconBytes(minimum, { maxBytes:minimum.length - 1 }), /must be between/);
  const corrupt = Buffer.from(minimum);
  corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => inspectAchievementIconBytes(corrupt), /checksum is invalid/);
});

test('duplicate achievement IDs stop catalog generation', async () => {
  const raw = await fixture('gi');
  raw['1'].achievements.push({ ...raw['0'].achievements[0] });
  assert.throws(() => normalizeGiCatalog(raw, FIXED), /duplicate achievement id 100/);
});

test('mismatched or incomplete source records stop catalog generation', async () => {
  const raw = await fixture('hsr');
  raw['4010101'].Id = '999';
  assert.throws(() => normalizeHsrCatalog(raw, FIXED), /does not match Id/);

  const incomplete = await fixture('gi');
  delete incomplete['0'].achievements[0].desc;
  assert.throws(() => normalizeGiCatalog(incomplete, FIXED), /description must be text/);
});

test('unsafe unrecognized markup is rejected', async () => {
  const raw = await fixture('hsr');
  raw['4010101'].Description = '<script>nope</script>';
  assert.throws(() => normalizeHsrCatalog(raw, FIXED), /unsafe markup/);
});

test('HSR player, device, ship, and trotter placeholders become readable text', async () => {
  const raw = await fixture('hsr');
  raw['4010101'].Name = "{NICKNAME}'s Test";
  raw['4010101'].Description = '{LAYOUT_MOBILE#Tap}{LAYOUT_CONTROLLER#Press}{LAYOUT_KEYBOARD#Click} on {TEXTJOIN#87}; keep {TEXTJOIN#54}.';
  const catalog = normalizeHsrCatalog(raw, FIXED);
  assert.equal(catalog.achievements[0].name, "Trailblazer's Test");
  assert.equal(catalog.achievements[0].description, 'Interact with the Radiant Feldspar; keep Warp Trotter.');
  for (const { name, description } of catalog.achievements) {
    assert.doesNotMatch(`${name} ${description}`, /\{[^}]+\}/);
  }
});

test('catalog refresh blocks a collapse below eighty percent of last known good', async () => {
  const previous = normalizeGiCatalog(await fixture('gi'), { ...FIXED, releasedVersion:'7.0' });
  const next = { ...previous, achievements:previous.achievements.slice(0, 1), achievementCount:1, count:1 };
  assert.throws(() => assertCatalogNotCollapsed(next, previous), /catalog collapsed/);
});

test('catalog validation rejects a self-declared future release ceiling', async () => {
  const catalog = normalizeHsrCatalog(await fixture('hsr'), { ...FIXED, releasedVersion:'4.5' });
  catalog.releasedVersion = '99.9';
  catalog.catalogVersion = '99.9';
  catalog.achievements[0].version = '99.8';
  assert.throws(() => validateCatalog(catalog), /release ceiling must be 4\.5/);
});

test('checked-in catalogs pass the same release and safety validation', async () => {
  const root = new URL('../../../Database/Achievements/', import.meta.url);
  const provenance = JSON.parse(await fs.readFile(new URL('asset-provenance.json', root), 'utf8'));
  assert.equal(provenance.schemaVersion, 1);
  assert.equal(provenance.runtimeHotlinks, false);
  assert.equal(provenance.licenseClaim, null);
  assert.match(provenance.rightsNote, /No license is claimed for game artwork/);
  for (const game of ['gi', 'hsr']) {
    const expectedCounts = { gi:{ categories:73, achievements:1844 }, hsr:{ categories:9, achievements:1921 } }[game];
    const catalogUrl = new URL(`${game}/catalog.json`, root);
    const catalog = JSON.parse(await fs.readFile(catalogUrl, 'utf8'));
    assert.doesNotThrow(() => validateCatalog(catalog));
    assert.equal(catalog.categoryCount, expectedCounts.categories);
    assert.equal(catalog.achievementCount, expectedCounts.achievements);
    assert.equal(catalog.categories.filter(({ icon:categoryIcon }) => categoryIcon).length, expectedCounts.categories);
    assert.ok(catalog.rewardCurrency?.icon);
    assert.ok(catalog.achievements.every(({ version }) => {
      const [major, minor] = version.split('.').map(Number);
      const [ceilingMajor, ceilingMinor] = catalog.releasedVersion.split('.').map(Number);
      return major < ceilingMajor || (major === ceilingMajor && minor <= ceilingMinor);
    }));
    assert.ok(catalog.achievements.every(({ name, description }) => !/<[^>]*>|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(`${name}${description}`)));

    const gameProvenance = provenance.games[game];
    assert.equal(gameProvenance.releasedVersion, catalog.releasedVersion);
    assert.equal(gameProvenance.categoryCount, expectedCounts.categories);
    assert.equal(gameProvenance.categories.length, expectedCounts.categories);
    assert.equal(gameProvenance.rewardCurrency.runtimePath, catalog.rewardCurrency.icon.path);
    const provenanceByPath = new Map([
      ...gameProvenance.categories.map((entry) => [entry.runtimePath, entry]),
      [gameProvenance.rewardCurrency.runtimePath, gameProvenance.rewardCurrency],
    ]);
    const references = [
      ...catalog.categories.map((category) => ({ kind:'categories', icon:category.icon })),
      { kind:'rewards', icon:catalog.rewardCurrency.icon },
    ];
    assert.deepEqual(
      gameProvenance.categories.map(({ runtimePath }) => runtimePath).sort(),
      catalog.categories.map(({ icon:categoryIcon }) => categoryIcon.path).sort(),
    );
    for (const { kind, icon:asset } of references) {
      assert.doesNotMatch(asset.path, /^https?:/i);
      const filename = path.basename(asset.path);
      const bytes = await fs.readFile(new URL(`${game}/assets/${kind}/${filename}`, root));
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      const inspected = inspectAchievementIconBytes(bytes);
      assert.equal(filename, `${sha256}.${inspected.mediaType === 'image/png' ? 'png' : 'webp'}`);
      const source = provenanceByPath.get(asset.path);
      assert.ok(source, `missing provenance for ${asset.path}`);
      assert.equal(source.sourceKey, asset.sourceKey);
      assert.equal(source.sha256, sha256);
      assert.equal(source.bytes, bytes.length);
      assert.equal(source.mediaType, inspected.mediaType);
      assert.equal(source.width, inspected.width);
      assert.equal(source.height, inspected.height);
    }
    for (const kind of ['categories', 'rewards']) {
      const actual = (await fs.readdir(new URL(`${game}/assets/${kind}/`, root))).sort();
      const expected = references.filter((entry) => entry.kind === kind).map(({ icon:asset }) => path.basename(asset.path)).sort();
      assert.deepEqual(actual, expected);
    }
  }
});
