import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanLabel, enforceShrinkGuard, enumerateCategory, parseReadableWikitext, runLibrarySync, sanitizeDocument, slugify } from '../core.mjs';

test('structured sanitizer keeps only the explicit block and inline allowlist', () => {
  const document = sanitizeDocument({ version:1, blocks:[
    { type:'heading', level:2, text:'Chapter' },
    { type:'paragraph', children:[{ type:'text', text:'Safe' }, { type:'br' }, { type:'em', children:[{ type:'text', text:'story' }] }] },
    { type:'list', ordered:false, items:[{ children:[{ type:'strong', children:[{ type:'text', text:'One' }] }] }] },
    { type:'table', rows:[{ cells:[{ children:[{ type:'text', text:'Cell' }] }] }] },
    { type:'image', src:'icons/0123456789abcdef.webp', alt:'Local' },
  ] });
  assert.deepEqual(document.blocks.map((block) => block.type), ['heading','paragraph','list','table','image']);
  assert.throws(() => sanitizeDocument({ version:1, blocks:[{ type:'iframe', src:'https://evil.test' }] }), /Disallowed/);
  assert.throws(() => sanitizeDocument({ version:1, blocks:[{ type:'image', src:'https://evil.test/x.png' }] }), /Unsafe/);
  assert.throws(() => sanitizeDocument({ version:1, blocks:[{ type:'image', src:'icons/..%2Fevil.png' }] }), /Unsafe/);
});

test('hostile wiki markup cannot survive as executable or remote content', () => {
  const hostile = `==Text==\nHello<script>alert(1)</script><style>x</style><iframe src=x></iframe><form onsubmit=x><input></form>\n[ javascript:alert(1)]\n[https://tracker.test/p.png Remote] [[File:X.png|link=https://evil.test]]\n<div onclick="steal()">Fine<br>line</div>\n{{MC|f=she|m=he}}`;
  const result = parseReadableWikitext(hostile);
  const serialized = JSON.stringify(result);
  for (const unsafe of ['script','style','iframe','form','onclick','onsubmit','javascript:','data:','https://tracker.test','https://evil.test']) assert.equal(serialized.toLowerCase().includes(unsafe), false, unsafe);
  assert.match(serialized, /Fine/);
  assert.match(serialized, /they/);
});

test('GI collection parsing accepts dotted, undotted, and nested volume headings', () => {
  const result = parseReadableWikitext("===Vol 1===\nFirst\n===Vol. 2===\nSecond");
  assert.equal(result.blocks.filter((block) => block.type === 'heading').length, 2);
});

test('category enumeration follows continuation and returns every unique page candidate', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const continued = String(url).includes('cmcontinue=next');
    return { ok:true, json:async () => continued
      ? { query:{ categorymembers:[{ pageid:2, ns:0, title:'Second' }] } }
      : { continue:{ cmcontinue:'next' }, query:{ categorymembers:[{ pageid:1, ns:0, title:'First' }] } } };
  };
  const rows = await enumerateCategory('https://example.test/api.php', 'Category:Books', fetchImpl);
  assert.deepEqual(rows.map((row) => row.title), ['First','Second']);
  assert.equal(calls.length, 2);
});

test('slug and shrink guards are deterministic and preserve monotonic safety', () => {
  assert.equal(slugify("A Drunkard's Tale"), 'a-drunkard-s-tale');
  assert.doesNotThrow(() => enforceShrinkGuard({ gi:118, hsr:618 }, { gi:118, hsr:618 }));
  assert.throws(() => enforceShrinkGuard({ gi:89, hsr:618 }, {}), /safe minimum/);
  assert.throws(() => enforceShrinkGuard({ gi:100, hsr:550 }, { gi:118, hsr:618 }), /shrink guard/);
});

test('wiki emphasis is removed from labels without losing possessive apostrophes', () => {
  assert.equal(cleanLabel("''Robe Brethren''"), 'Robe Brethren');
  assert.equal(cleanLabel("''Butterfly Shadow'''s Special Issue"), "Butterfly Shadow's Special Issue");
});

function mockLibraryFetch() {
  const image = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32, 7)]);
  return async (url) => {
    const href = String(url);
    if (href === 'https://icons.test/shared.webp') return { ok:true, headers:{ get:() => 'image/webp' }, arrayBuffer:async () => image };
    const parsed = new URL(href);
    const game = parsed.hostname.startsWith('genshin') ? 'gi' : 'hsr';
    if (parsed.searchParams.get('list') === 'categorymembers') {
      const count = game === 'gi' ? 90 : 500;
      return { ok:true, json:async () => ({ query:{ categorymembers:Array.from({ length:count }, (_, index) => ({ pageid:index + 1, ns:0, title:`${game} Book ${index}` })) } }) };
    }
    const titles = (parsed.searchParams.get('titles') || '').split('|');
    return { ok:true, json:async () => ({ query:{ pages:titles.map((title, index) => ({
      pageid:index + 1, ns:0, title, fullurl:`https://wiki.test/${encodeURIComponent(title)}`,
      thumbnail:{ source:'https://icons.test/shared.webp' },
      revisions:[{ slots:{ main:{ content:game === 'gi'
        ? `{{Book Collection Infobox\n|image=Shared.png\n}}\n==Vol. 1==\nFirst volume\n==Vol 2==\nSecond volume`
        : `{{Readable Infobox\n|title = \n|image = Shared.png\n|parts=2\n}}\n==Text==\n===Part A===\nFirst part\n===Part B===\nSecond part` } } }],
    })) } }) };
  };
}

test('full sync dedupes category rows and shared icons while preserving multi-volume books', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-library-'));
  const report = await runLibrarySync({ rootDir, fetchImpl:mockLibraryFetch(), now:() => new Date('2026-07-11T00:00:00Z') });
  assert.deepEqual(Object.fromEntries(Object.entries(report.games).map(([game, row]) => [game, row.count])), { gi:90, hsr:500 });
  assert.deepEqual(Object.fromEntries(Object.entries(report.games).map(([game, row]) => [game, row.icons])), { gi:1, hsr:1 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(rootDir, 'Database', 'Library', 'gi', 'gi-book-0.json'))).volumes.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(rootDir, 'Database', 'Library', 'hsr', 'hsr-book-0.json'))).volumes.length, 2);
  const hsrIndex = JSON.parse(fs.readFileSync(path.join(rootDir, 'Database', 'Library', 'hsr', 'index.json')));
  assert.equal(hsrIndex.entries.some((row) => /^\||'{2}/.test(row.name)), false);
});

test('fetch failure leaves the complete last-known-good Library untouched', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-library-lkg-'));
  const output = path.join(rootDir, 'Database', 'Library');
  fs.mkdirSync(output, { recursive:true });
  fs.writeFileSync(path.join(output, 'sentinel.txt'), 'last-known-good');
  await assert.rejects(runLibrarySync({ rootDir, fetchImpl:async () => { throw new Error('offline'); } }), /Failed to fetch/);
  assert.equal(fs.readFileSync(path.join(output, 'sentinel.txt'), 'utf8'), 'last-known-good');
});
