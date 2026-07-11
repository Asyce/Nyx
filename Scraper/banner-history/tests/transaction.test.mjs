import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { recoverTransaction, transactionalReplace } from '../index.mjs';

async function crashCase(phase, index, expected) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nyx-history-transaction-'));
  const files = ['a.json','b.json','c.json'].map((name) => path.join(dir, name));
  await Promise.all(files.map((file, position) => fs.writeFile(file, JSON.stringify({ value:`old${position}` }))));
  const error = new Error('injected crash'); error.simulatedCrash = true;
  await assert.rejects(transactionalReplace(files.map((file, position) => [file, JSON.stringify({ value:`new${position}` })]), {
    journalPath:path.join(dir, 'journal.json'),
    onBoundary:(seenPhase, seenIndex) => { if (seenPhase === phase && seenIndex === index) throw error; },
  }), /injected crash/);
  await recoverTransaction(path.join(dir, 'journal.json'));
  for (let position=0; position<files.length; position+=1) assert.equal(JSON.parse(await fs.readFile(files[position], 'utf8')).value, `${expected}${position}`);
  assert.deepEqual((await fs.readdir(dir)).sort(), ['a.json','b.json','c.json']);
  await fs.rm(dir, { recursive:true, force:true });
}

test('prepared/swap crashes roll every file back to one LKG generation', async () => {
  await crashCase('prepared', -1, 'old');
  for (let index=0; index<3; index+=1) await crashCase('swap', index, 'old');
});

test('committed/cleanup/finalize crashes finish the complete new generation', async () => {
  await crashCase('committed', -1, 'new');
  for (let index=0; index<3; index+=1) await crashCase('cleanup', index, 'new');
  // finalize: crash after the journal is removed but before the committed marker. The no-journal
  // recovery branch clears the orphaned marker and keeps the already-swapped new generation.
  await crashCase('finalize', 0, 'new');
});

test('finalize crash keeps a brand-new (previously absent) target instead of deleting it', async () => {
  // Sol repro: one pre-existing target + one NEW target. After cleanup the backups are gone, so the
  // old journal-first-marker-last bug made recovery roll back and DELETE the new file (mixed gen).
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nyx-history-newtarget-'));
  const existing = path.join(dir, 'existing.json');
  const created = path.join(dir, 'created.json');            // does NOT exist before the transaction
  await fs.writeFile(existing, JSON.stringify({ value:'old' }));
  const error = new Error('injected crash'); error.simulatedCrash = true;
  await assert.rejects(transactionalReplace([
    [existing, JSON.stringify({ value:'new-existing' })],
    [created, JSON.stringify({ value:'new-created' })],
  ], {
    journalPath:path.join(dir, 'journal.json'),
    onBoundary:(phase, index) => { if (phase === 'finalize' && index === 0) throw error; },
  }), /injected crash/);
  await recoverTransaction(path.join(dir, 'journal.json'));
  assert.equal(JSON.parse(await fs.readFile(existing, 'utf8')).value, 'new-existing', 'existing target keeps new content');
  assert.equal(JSON.parse(await fs.readFile(created, 'utf8')).value, 'new-created', 'new target survives — not rolled back to MISSING');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['created.json','existing.json'], 'no journal/marker/backup debris');
  await fs.rm(dir, { recursive:true, force:true });
});

test('an orphaned committed marker never lets a later transaction leave a mixed generation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nyx-history-orphan-'));
  const files = ['a.json','b.json','c.json'].map((name) => path.join(dir, name));
  await Promise.all(files.map((file, position) => fs.writeFile(file, JSON.stringify({ value:`old${position}` }))));
  const journalPath = path.join(dir, 'journal.json');
  // Simulate a prior transaction that crashed after removing its journal but before its committed
  // marker: a committed marker with no journal alongside the complete old generation.
  await fs.writeFile(`${journalPath}.committed`, JSON.stringify({ schemaVersion:1, committed:true }));
  const error = new Error('injected crash'); error.simulatedCrash = true;
  await assert.rejects(transactionalReplace(files.map((file, position) => [file, JSON.stringify({ value:`new${position}` })]), {
    journalPath,
    onBoundary:(phase, index) => { if (phase === 'swap' && index === 1) throw error; },
  }), /injected crash/);
  await recoverTransaction(journalPath);
  const values = [];
  for (const file of files) values.push(JSON.parse(await fs.readFile(file, 'utf8')).value);
  assert.deepEqual(values, ['old0','old1','old2'], 'mid-swap crash must roll fully back, not blend generations');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['a.json','b.json','c.json'], 'no journal or marker debris survives');
  await fs.rm(dir, { recursive:true, force:true });
});
