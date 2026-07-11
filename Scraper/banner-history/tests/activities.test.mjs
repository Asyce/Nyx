import assert from 'node:assert/strict';
import test from 'node:test';
import { expandActivity, validateActivity } from '../activities.mjs';

const biweekly = { id:'cycle', label:'Cycle', mode:'fixed', anchorStart:'2024-12-27T20:00:00.000Z', intervalDays:14, durationDays:14, resetHour:4, timezoneMode:'server-fixed', exceptions:[], sourceUrl:'https://official.example', verifiedAt:'2026-01-01T00:00:00Z' };
test('fixed expansion crosses year and leap-year boundaries without DST drift', () => {
  const rows = expandActivity(biweekly, '2024-12-01T00:00:00Z', '2025-03-01T00:00:00Z', 'asia');
  assert(rows.length >= 5); assert(rows.some((row) => row.start === biweekly.anchorStart));
  for (let i=1;i<rows.length;i++) assert.equal(Date.parse(rows[i].start)-Date.parse(rows[i-1].start), 14*86_400_000);
});
test('fixed server-local anchors differ by region and never extrapolate before the official anchor', () => {
  const asia = expandActivity(biweekly, '2024-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 'asia');
  const europe = expandActivity(biweekly, '2024-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 'europe');
  const america = expandActivity(biweekly, '2024-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 'america');
  assert.equal(asia[0].start, '2024-12-27T20:00:00.000Z');
  assert.equal(europe[0].start, '2024-12-28T03:00:00.000Z');
  assert.equal(america[0].start, '2024-12-28T09:00:00.000Z');
});
test('exceptions suppress a known occurrence', () => {
  const value = { ...biweekly, exceptions:[{region:'asia',start:'2025-01-10T20:00:00.000Z',skip:true}] };
  const rows = expandActivity(value, '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z', 'asia');
  assert(!rows.some((row) => row.start === '2025-01-10T20:00:00.000Z'));
});
test('monthly calendar cadence handles February and leap year', () => {
  const monthly = { ...biweekly, anchorStart:'2024-01-31T20:00:00.000Z', intervalDays:undefined, durationDays:undefined, calendarMonths:1, calendarDay:1, durationToNext:true };
  const rows = expandActivity(monthly, '2024-01-01T00:00:00Z', '2024-04-02T00:00:00Z', 'asia');
  assert(rows.some((row) => row.start.startsWith('2024-02-29T20:00:00.000Z')) || rows.some((row) => row.start.startsWith('2024-02-01T')));
  assert(rows.some((row) => row.start.startsWith('2024-03-')));
});
test('missing anchors, sources, and durations are rejected', () => {
  assert.throws(() => validateActivity({ ...biweekly, anchorStart:null }), /Invalid fixed/);
  assert.throws(() => validateActivity({ ...biweekly, sourceUrl:'' }), /Invalid activity/);
  assert.throws(() => validateActivity({ ...biweekly, durationDays:null }), /no duration/);
  assert.throws(() => validateActivity({ id:'bad-dated',label:'Bad',mode:'dated',windows:[{dateStart:'2025-01-01'}],sourceUrl:'https://official.example',verifiedAt:'2026-01-01T00:00:00Z' }), /invalid window/);
});
