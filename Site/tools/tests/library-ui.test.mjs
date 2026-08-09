import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  nyxLibraryDocumentHasPhrase,
  nyxLibraryDocumentHasTokens,
  nyxLibraryDocumentQueryRanges,
  nyxLibraryDocumentText,
  nyxLibraryFocusReturnTarget,
  nyxLibraryMatchingVolumeIndex,
  nyxLibrarySearchMatches,
  nyxLibraryTextHasPhrase,
  nyxLibraryWords,
} from '../../src/features/library/library-core.js';

const root = path.resolve(import.meta.dirname, '../..');
const view = await fs.readFile(path.join(root, 'src/features/library/library-view.jsx'), 'utf8');
const app = await fs.readFile(path.join(root, 'src/app/nyx-app.jsx'), 'utf8');
const build = await fs.readFile(path.join(root, 'tools/build-site.mjs'), 'utf8');
const styles = await fs.readFile(path.join(root, 'src/styles/game-page-shared.css'), 'utf8');
const annotationView = await fs.readFile(path.join(root, 'src/features/library/library-annotations-view.jsx'), 'utf8');
const annotationEngine = await fs.readFile(path.join(root, 'src/features/library/library-annotations.js'), 'utf8');

test('canonical Library text covers every text-bearing leaf', () => {
  const document = { version:1, blocks:[
    { id:'h-a', type:'heading', level:2, text:'Heading' },
    { id:'p-a', type:'paragraph', children:[{ type:'text', text:'Tanuki tale' }] },
    { type:'list', ordered:false, items:[{ id:'li-a', children:[{ type:'text', text:'Forest list' }] }] },
    { type:'table', rows:[{ cells:[{ id:'td-a', children:[{ type:'text', text:'Hidden cell' }] }] }] },
  ] };
  assert.equal(nyxLibraryDocumentText(document), 'Heading\nTanuki tale\nForest list\nHidden cell');
  assert.deepEqual(nyxLibraryWords('Tánuki, TALE!'), ['tanuki', 'tale']);
  assert.equal(nyxLibraryDocumentHasTokens(document, ['tanuki', 'forest']), true);
});

test('body index returns the exact first matching volume for a contiguous phrase', () => {
  const index = { schemaVersion:2, books:['other','toki-alley'], volumes:[
    { book:0, volumeKey:'text', leaves:['and a scattered story', 'the moon appears later'] },
    { book:1, volumeKey:'vol-3', leaves:['when the tanuki waits and the moon rises'] },
  ] };
  assert.deepEqual([...nyxLibrarySearchMatches(index, 'tanu').values()], [{ bookId:'toki-alley', volumeKey:'vol-3' }]);
  assert.deepEqual([...nyxLibrarySearchMatches(index, 'and the moon').keys()], ['toki-alley']);
  assert.equal(nyxLibraryTextHasPhrase('Aristophanes', 'phane'), false, 'prefixes start at a word boundary');
  assert.equal(nyxLibraryTextHasPhrase('Phanes, the Primordial One', 'phane'), true);
});

test('query ranges preserve source offsets and never cross text leaves', () => {
  const document = { version:1, blocks:[
    { id:'p-a', type:'paragraph', children:[{ type:'text', text:'Before ' }, { type:'em', children:[{ type:'text', text:'Phanes' }] }, { type:'text', text:' arrives.' }] },
    { id:'p-b', type:'paragraph', children:[{ type:'text', text:'and' }] },
    { id:'p-c', type:'paragraph', children:[{ type:'text', text:'the moon' }] },
  ] };
  const ranges = nyxLibraryDocumentQueryRanges(document, 'phane');
  assert.deepEqual(ranges, [{ blockId:'p-a', start:7, end:13 }]);
  assert.equal(nyxLibraryDocumentText(document).split('\n')[0].slice(ranges[0].start, ranges[0].end), 'Phanes');
  assert.equal(nyxLibraryDocumentHasPhrase(document, 'and the moon'), false);
  const volumes = [
    { volumeKey:'stale', document:{ version:1, blocks:[{ id:'p-x', type:'paragraph', children:[{ type:'text', text:'No match' }] }] } },
    { volumeKey:'vol-2', document },
  ];
  assert.equal(nyxLibraryMatchingVolumeIndex(volumes, 'phane', 'stale'), 1, 'stale preferred keys revalidate and fall back');
});

test('tracked corpus proves partial-word and whole-phrase volume matches', async () => {
  const gi = JSON.parse(await fs.readFile(path.resolve(root, '../Database/Library/gi/search-index.json'), 'utf8'));
  const hsr = JSON.parse(await fs.readFile(path.resolve(root, '../Database/Library/hsr/search-index.json'), 'utf8'));
  const phane = nyxLibrarySearchMatches(gi, 'phane');
  assert.deepEqual(phane.get('the-byakuyakoku-collection'), { bookId:'the-byakuyakoku-collection', volumeKey:'vol-2' });
  assert.equal(phane.size, 1);
  assert.equal(nyxLibrarySearchMatches(gi, 'and the moon').size, 4);
  assert.equal(nyxLibrarySearchMatches(hsr, 'and the moon').size, 4);
  assert.equal(nyxLibrarySearchMatches(hsr, 'and the moon').get('floating-grease-chronicles-chapter-of-the-monkey')?.volumeKey, 'xi');
});

test('Back resolves the exact connected result tile after the reader unmounts', () => {
  const stale = { isConnected:false, dataset:{ libraryBookId:'toki-alley-tales' }, focus() {} };
  const other = { isConnected:true, dataset:{ libraryBookId:'other' }, focus() {} };
  const toki = { isConnected:true, dataset:{ libraryBookId:'toki-alley-tales' }, focus() {} };
  assert.equal(nyxLibraryFocusReturnTarget(stale, 'toki-alley-tales', [other, toki]), toki);
  assert.equal(nyxLibraryFocusReturnTarget(toki, 'toki-alley-tales', [other]), toki);
  assert.equal(nyxLibraryFocusReturnTarget(stale, 'missing', [other, toki]), null);
});

test('focused Library module is wired with exact search copy and safe rendering', () => {
  assert.match(build, /features\/library\/library-core\.js/);
  assert.match(build, /features\/library\/library-view\.jsx/);
  assert.match(build, /features\/library\/library-annotations\.js/);
  assert.match(build, /features\/library\/library-annotations-view\.jsx/);
  // 2026-08-09: the bold "Search Library" label was removed; the field stands alone.
  assert.doesNotMatch(view, />Search Library</);
  assert.match(view, /aria-label="Search the library"/);
  assert.match(view, /function nyxLibraryTitleSize/, 'book titles shrink to fit exactly two lines');
  assert.match(view, /placeholder="Search Title or Keyword"/);
  assert.match(view, /Found in text/);
  assert.match(annotationView, /data-library-block-id/);
  assert.match(view, /ReactDOM\.flushSync/);
  assert.match(view, /data-library-book-id/);
  assert.match(view, /focus\(\{ preventScroll:true \}\)/);
  assert.match(view, /volumeKey/);
  assert.match(view, /nyxLibraryMatchingVolumeIndex/);
  assert.match(view, /matchVolumeKey/);
  assert.doesNotMatch(view, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(app, /function (?:Legacy)?Library(?:Page|Document)/);
  assert.doesNotMatch(app, /legacyLibraryInline/);
  assert.match(styles, /\.library-reader\{[^}]*box-sizing:border-box;[^}]*width:100%;[^}]*min-width:0;[^}]*overflow:hidden/);
  assert.match(styles, /\.library-document\{[^}]*max-width:100%;[^}]*min-width:0;[^}]*user-select:text/);
  assert.match(styles, /\.library-volumes\{[^}]*flex-wrap:nowrap;[^}]*overflow-x:auto/);
  for (const action of ['Highlight','Underline','Bold','Add note','Clear formatting']) assert.match(annotationView, new RegExp(`>${action}<`));
  assert.ok((annotationView.match(/aria-pressed=\{formatState\./g) || []).length >= 3, 'formatting buttons expose pressed state');
  assert.match(annotationView, /className="library-highlight-swatches" role="group" aria-label="Highlight color"/);
  assert.match(annotationView, /className="library-annotation-overflow" role="menu"/);
  assert.match(annotationView, /if \(!selection\?\.anchorable\) return null/);
  assert.match(annotationView, /if \(next\?\.anchorable\).*setSelection\(next\)[\s\S]*else setSelection\(null\)/);
  assert.match(annotationView, /stale-ambiguous/);
  assert.match(annotationView, /data-library-ui/);
  assert.match(annotationView, /data-library-query-hit/);
  assert.match(annotationView, /scrollIntoView\(\{ block:'center'/);
  assert.match(annotationView, /nyxLibraryDocumentQueryRanges/);
  assert.doesNotMatch(annotationView, /navigator\.clipboard|writeText\(|>Copy</);
  assert.doesNotMatch(annotationView, /<select|<option/);
  assert.match(annotationView, /nyxUndoLibraryAnnotations/);
  assert.doesNotMatch(annotationView, /dangerouslySetInnerHTML|innerHTML\s*=/);
  assert.doesNotMatch(annotationEngine, /localStorage|sessionStorage|fetch\(/);
  assert.match(styles, /\.library-document::selection/);
  assert.match(styles, /\.library-highlight-swatches\{[^}]*background:#0d0a14/);
  assert.match(styles, /\.library-annotation-overflow\{[^}]*background:#120e1d/);
});
