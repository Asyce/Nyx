import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  nyxLibraryDocumentHasTokens,
  nyxLibraryDocumentText,
  nyxLibraryFocusReturnTarget,
  nyxLibrarySearchIds,
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

test('body index intersects every query word without prose payloads', () => {
  const index = { schemaVersion:1, books:['other','toki-alley'], words:{ tanuki:[1], tale:[0,1], gate:[0] } };
  assert.deepEqual([...nyxLibrarySearchIds(index, 'Tanuki Tale')], ['toki-alley']);
  assert.deepEqual([...nyxLibrarySearchIds(index, 'tanuki gate')], []);
  assert.equal(JSON.stringify(index).includes('collected prose'), false);
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
  assert.match(view, />Search The Library</);
  assert.match(view, /placeholder="Search Title or Keyword"/);
  assert.match(view, /Found in text/);
  assert.match(annotationView, /data-library-block-id/);
  assert.match(view, /ReactDOM\.flushSync/);
  assert.match(view, /data-library-book-id/);
  assert.match(view, /focus\(\{ preventScroll:true \}\)/);
  assert.match(view, /volumeKey/);
  assert.match(view, /nyxLibraryDocumentHasTokens/);
  assert.doesNotMatch(view, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(app, /function (?:Legacy)?Library(?:Page|Document)/);
  assert.doesNotMatch(app, /legacyLibraryInline/);
  assert.match(styles, /\.library-reader\{[^}]*box-sizing:border-box;[^}]*width:100%;[^}]*min-width:0;[^}]*overflow:hidden/);
  assert.match(styles, /\.library-document\{[^}]*max-width:100%;[^}]*min-width:0;[^}]*user-select:text/);
  assert.match(styles, /\.library-volumes\{[^}]*flex-wrap:nowrap;[^}]*overflow-x:auto/);
  for (const action of ['Highlight','Underline','Bold','Add note','Copy','Remove formatting']) assert.match(annotationView, new RegExp(`>${action}<`));
  assert.match(annotationView, /Formatting works within one paragraph\. You can still copy this selection\./);
  assert.match(annotationView, /stale-ambiguous/);
  assert.match(annotationView, /data-library-ui/);
  assert.match(annotationView, /navigator\.clipboard/);
  assert.doesNotMatch(annotationView, /dangerouslySetInnerHTML|innerHTML\s*=/);
  assert.doesNotMatch(annotationEngine, /localStorage|sessionStorage|fetch\(/);
  assert.match(styles, /\.library-document::selection/);
});
