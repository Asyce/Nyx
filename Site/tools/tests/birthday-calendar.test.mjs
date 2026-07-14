import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = await fs.readFile(path.resolve(here, '../../src/features/calendar/birthday-calendar.js'), 'utf8');
const names = [
  'nyxValidBirthdayDate', 'nyxNextBirthdayDate', 'nyxNormalizeBirthday', 'nyxBirthdayInitials',
  'nyxPrepareBirthdayIcon', 'nyxListCustomBirthdays', 'nyxSaveCustomBirthday', 'nyxDeleteCustomBirthday',
  'nyxBirthdayIsQuotaError', 'nyxCalendarHistoryOrigin', 'nyxShouldReturnToCalendar',
  'nyxReadCalendarViewState', 'nyxSaveCalendarViewState',
  'nyxCalendarFocusTarget',
  'NYX_BIRTHDAY_MAX_INPUT_BYTES', 'NYX_BIRTHDAY_MAX_ICON_BYTES', 'NYX_BIRTHDAY_MAX_ICON_EDGE',
];
const sessionValues = new Map();
const sessionStorage = { getItem:(key) => sessionValues.get(key) || null, setItem:(key, value) => sessionValues.set(key, String(value)) };
const context = { Blob, Date, Math, Map, Set, Promise, console, setTimeout, clearTimeout, queueMicrotask, sessionStorage };
vm.runInNewContext(`${source}\n;globalThis.__api={${names.join(',')}};`, context);
const api = context.__api;
const plain = (value) => JSON.parse(JSON.stringify(value));

function fakeIndexedDB({ quota = false } = {}){
  const stores = new Map();
  const objectStoreNames = { contains:(name) => stores.has(name) };
  const db = {
    objectStoreNames,
    createObjectStore(name){ if (!stores.has(name)) stores.set(name, new Map()); return {}; },
    close(){},
    transaction(names){
      const tx = { error:null, oncomplete:null, onerror:null, onabort:null, pending:0, failed:false };
      let completionQueued = false;
      const finish = () => {
        if (completionQueued || tx.pending || tx.failed) return;
        completionQueued = true;
        setTimeout(() => tx.oncomplete?.(), 0);
      };
      tx.objectStore = (name) => {
        const map = stores.get(name);
        const request = (operation) => {
          const req = { result:undefined, error:null, onsuccess:null, onerror:null };
          tx.pending += 1;
          queueMicrotask(() => {
            try {
              req.result = operation(map);
              req.onsuccess?.();
            } catch (error) {
              req.error = error; tx.error = error; tx.failed = true;
              req.onerror?.(); setTimeout(() => tx.onerror?.(), 0);
            } finally { tx.pending -= 1; finish(); }
          });
          return req;
        };
        return {
          getAll:() => request((target) => Array.from(target.values())),
          put:(value) => request((target) => {
            if (quota && name === 'icons') { const error = new Error('disk quota reached'); error.name = 'QuotaExceededError'; throw error; }
            target.set(value.id, value); return value.id;
          }),
          delete:(id) => request((target) => target.delete(id)),
        };
      };
      setTimeout(finish, 0);
      return tx;
    },
  };
  return {
    stores,
    open(){
      const request = { result:db, error:null, onupgradeneeded:null, onsuccess:null, onerror:null };
      setTimeout(() => { request.onupgradeneeded?.(); request.onsuccess?.(); }, 0);
      return request;
    },
  };
}

test('recurring dates reject impossible days and keep leap day on leap day', () => {
  assert.equal(api.nyxValidBirthdayDate(3, 31), false, 'April 31 is invalid');
  assert.equal(api.nyxValidBirthdayDate(1, 29), true, 'February 29 is valid');
  const next = api.nyxNextBirthdayDate(new Date(2026, 6, 13), 1, 29);
  assert.deepEqual([next.getFullYear(), next.getMonth(), next.getDate()], [2028, 1, 29]);
  const after = api.nyxNextBirthdayDate(new Date(2028, 2, 1), 1, 29);
  assert.deepEqual([after.getFullYear(), after.getMonth(), after.getDate()], [2032, 1, 29]);
});

test('records are bounded, use initials fallback, and never preserve remote icon URLs', () => {
  const row = plain(api.nyxNormalizeBirthday({ name:' Ada Lovelace ', month:11, day:10, icon:'https://example.test/icon.png', note:'n'.repeat(400) }));
  assert.equal(row.name, 'Ada Lovelace');
  assert.equal(row.note.length, 280);
  assert.equal(row.hasIcon, false);
  assert.equal(Object.hasOwn(row, 'icon'), false);
  assert.equal(api.nyxBirthdayInitials('Ada Lovelace'), 'AL');
  assert.throws(() => api.nyxNormalizeBirthday({ name:'Bad', month:1, day:30 }), /real month and day/);
});

test('IndexedDB metadata and icon Blobs survive add, edit, reload, and delete', async () => {
  const indexedDB = fakeIndexedDB();
  const icon = new Blob(['small-webp'], { type:'image/webp' });
  const added = await api.nyxSaveCustomBirthday({ id:'stable', name:'Paimon', month:5, day:1, game:'gi', iconBlob:icon }, { indexedDB });
  assert.equal(added.id, 'stable');
  let rows = await api.nyxListCustomBirthdays({ indexedDB });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Paimon');
  assert.equal(rows[0].iconBlob.size, icon.size);
  assert.equal(indexedDB.stores.get('birthdays').get('stable').iconBlob, undefined, 'Blob is not mixed into metadata');
  assert.equal(indexedDB.stores.get('icons').get('stable').blob.type, 'image/webp');
  await api.nyxSaveCustomBirthday({ ...rows[0], name:'Best Guide' }, { indexedDB });
  rows = await api.nyxListCustomBirthdays({ indexedDB });
  assert.equal(rows[0].name, 'Best Guide');
  await api.nyxDeleteCustomBirthday('stable', { indexedDB });
  assert.deepEqual(await api.nyxListCustomBirthdays({ indexedDB }), []);
});

test('quota failure is explicit and keeps retry advice', async () => {
  const icon = new Blob(['small-webp'], { type:'image/webp' });
  await assert.rejects(
    api.nyxSaveCustomBirthday({ name:'Full', month:0, day:1, iconBlob:icon }, { indexedDB:fakeIndexedDB({ quota:true }) }),
    (error) => api.nyxBirthdayIsQuotaError(error) && /Free some space|remove the birthday icon/.test(error.message),
  );
});

test('image intake rejects bad/oversized files and bounds large decoded art', async () => {
  await assert.rejects(api.nyxPrepareBirthdayIcon(new Blob(['x'], { type:'image/gif' })), /PNG, JPEG, or WebP/);
  await assert.rejects(api.nyxPrepareBirthdayIcon(new Blob([new Uint8Array(api.NYX_BIRTHDAY_MAX_INPUT_BYTES + 1)], { type:'image/png' })), /10 MB/);
  const calls = [];
  const output = await api.nyxPrepareBirthdayIcon(new Blob(['valid'], { type:'image/png' }), {
    decode:async () => ({ width:4000, height:2000, close(){} }),
    encode:async (args) => { calls.push(args); return new Blob(['webp'], { type:'image/webp' }); },
  });
  assert.equal(output.type, 'image/webp');
  assert.ok(output.size <= api.NYX_BIRTHDAY_MAX_ICON_BYTES);
  assert.ok(calls[0].width <= api.NYX_BIRTHDAY_MAX_ICON_EDGE && calls[0].height <= api.NYX_BIRTHDAY_MAX_ICON_EDGE);
  await assert.rejects(api.nyxPrepareBirthdayIcon(new Blob(['broken'], { type:'image/jpeg' }), { decode:async () => { throw new Error('decode failed'); } }), /readable image/);
});

test('Calendar and Nyx history origins are carried only by the matching character entry', () => {
  assert.equal(api.nyxCalendarHistoryOrigin({ nyxFrom:'calendar', nyxCharacter:'Mavuika' }, 'mavuika'), 'calendar');
  assert.equal(api.nyxCalendarHistoryOrigin({ nyxFrom:'nyx', nyxCharacter:'Mavuika' }, 'mavuika'), 'nyx');
  assert.equal(api.nyxCalendarHistoryOrigin({ nyxFrom:'calendar', nyxCharacter:'Mavuika' }, 'furina'), undefined);
  assert.equal(api.nyxCalendarHistoryOrigin({}, 'mavuika'), undefined, 'direct links stay direct');
  assert.equal(api.nyxShouldReturnToCalendar({ from:'calendar' }), true);
  assert.equal(api.nyxShouldReturnToCalendar({ from:'nyx' }), true);
  assert.equal(api.nyxShouldReturnToCalendar({ from:'characters' }), false);
});

test('Calendar month and scroll position survive leaving and returning', () => {
  api.nyxSaveCalendarViewState({ year:2028, month:1, scrollTop:417 });
  assert.deepEqual(plain(api.nyxReadCalendarViewState()), { year:2028, month:1, scrollTop:417 });
  api.nyxSaveCalendarViewState({ year:2028, month:99, scrollTop:1 });
  assert.deepEqual(plain(api.nyxReadCalendarViewState()), { year:2028, month:1, scrollTop:417 }, 'invalid state cannot replace the saved view');
});

test('birthday dialog focus returns to its live trigger or the Calendar action fallback', () => {
  const trigger = { isConnected:true, focus(){} };
  const removedTrigger = { isConnected:false, focus(){} };
  const fallback = { isConnected:true, focus(){} };
  assert.equal(api.nyxCalendarFocusTarget(trigger, fallback), trigger, 'edit/cancel/save returns to the birthday that opened the dialog');
  assert.equal(api.nyxCalendarFocusTarget(removedTrigger, fallback), fallback, 'delete falls back when its birthday control is gone');
  assert.equal(api.nyxCalendarFocusTarget(null, fallback), fallback, 'Add flow returns to Add date');
  assert.equal(api.nyxCalendarFocusTarget(null, null), null);
});

test('Calendar UI wiring keeps the 1px purple ring and history-backed return', async () => {
  const app = await fs.readFile(path.resolve(here, '../../src/app/nyx-app.jsx'), 'utf8');
  const materials = await fs.readFile(path.resolve(here, '../../src/features/materials/char-materials.jsx'), 'utf8');
  const css = await fs.readFile(path.resolve(here, '../../src/styles/game-page-shared.css'), 'utf8');
  assert.match(app, /nyxFrom:selection[^\n]+selection\.from === 'calendar'/);
  assert.match(app, /nyxShouldReturnToCalendar\(materialSelection\)[\s\S]{0,120}window\.history\.back\(\)/);
  assert.match(materials, /selectedFrom === 'calendar' \? 'Back to Calendar'/);
  assert.match(css, /\.bcal-chip\{[^}]*border:1px solid rgba\(190,158,255/);
  assert.match(app, /dialogTriggerRef\.current = trigger/);
  assert.match(app, /const target = nyxCalendarFocusTarget\(preferred, addButtonRef\.current\)/);
  assert.match(app, /ReactDOM\.flushSync\(\(\) => setEditing\(undefined\)\)/);
  assert.match(app, /target\?\.focus\(\{ preventScroll:true \}\)/);
  assert.match(app, /event\.stopImmediatePropagation\(\)/, 'Escape is handled only by the open birthday dialog');
  assert.match(app, /deleteCustom[^\n]+closeEditor\(false\)/, 'delete deliberately restores the Calendar fallback');
  assert.match(app, />Add date<|Add date'/);
  assert.doesNotMatch(app, />Add birthday</);
});
