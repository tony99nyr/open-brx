// M4 (maintainability review 2026-10-10): the two blobs a restart must survive, `brx.engine` and the outbox ring,
// carry a schema version `v`. A blob WITHOUT `v` is version 1: it is every blob an older build wrote, and it restores
// exactly as before. A blob with a `v` this build does not know is not restored: start clean and log one line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, ENGINE_STORE_V } from '../src/engine.js';
import { Ring, RING_STORE_V } from '../src/transport/ring.js';
import { mkStorage } from './_helpers.mjs';

const mkEngine = (storage, lines = []) => new Engine({ writer: () => {}, emit: () => {}, report: () => {},
  now: () => 1_000_000, wallNow: () => 1_000_000, synced: () => true, storage, log: l => lines.push(l), delay: (ms, fn) => fn(), rng: () => 0 });
const PLAYER = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue' };
const tick = () => new Promise(r => setImmediate(r));   // `_load` logs from a microtask, after construction

function savedEngine() {
  const st = mkStorage();
  const e = mkEngine(st); e.player = PLAYER; e._save();
  return st;
}

test('(e) an engine save writes the schema version', () => {
  const st = savedEngine();
  assert.equal(JSON.parse(st.getItem('brx.engine')).v, ENGINE_STORE_V);
});

test('(a) a brx.engine blob with no v restores exactly as before', async () => {
  const st = savedEngine();
  const blob = JSON.parse(st.getItem('brx.engine')); delete blob.v; st.setItem('brx.engine', JSON.stringify(blob));
  const lines = []; const e = mkEngine(st, lines); await tick();
  assert.deepEqual(e.player, PLAYER);
  assert.deepEqual(lines, []);
});

test('(b) a brx.engine blob with an unknown v is not restored, and one line says so', async () => {
  for (const v of [99, 'two']) {
    const st = savedEngine();
    const blob = JSON.parse(st.getItem('brx.engine')); blob.v = v; st.setItem('brx.engine', JSON.stringify(blob));
    const lines = []; const e = mkEngine(st, lines); await tick();
    assert.equal(e.player, null, `v ${v}: nothing restored`);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /brx\.engine/); assert.ok(lines[0].includes(JSON.stringify(v)));
  }
});

function savedRing() {
  const st = mkStorage();
  const r = new Ring({ storage: st, log: () => {} }); r.push({ t: 1, kind: 'x' });
  return st;
}

test('(e) a ring save writes the schema version', () => {
  assert.equal(JSON.parse(savedRing().getItem('brx.outbox')).v, RING_STORE_V);
});

test('(c) an outbox blob with no v restores exactly as before', () => {
  const st = savedRing();
  const blob = JSON.parse(st.getItem('brx.outbox')); delete blob.v; st.setItem('brx.outbox', JSON.stringify(blob));
  const lines = []; const r = new Ring({ storage: st, log: l => lines.push(l) });
  assert.equal(r.size, 1); assert.equal(r.seqNext, 2); assert.deepEqual(lines, []);
});

test('(d) an outbox blob with an unknown v is not restored, and one line says so', () => {
  for (const v of [99, 'two']) {
    const st = savedRing();
    const blob = JSON.parse(st.getItem('brx.outbox')); blob.v = v; st.setItem('brx.outbox', JSON.stringify(blob));
    const lines = []; const r = new Ring({ storage: st, log: l => lines.push(l) });
    assert.equal(r.size, 0); assert.equal(r.seqNext, 1);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /brx\.outbox/); assert.ok(lines[0].includes(JSON.stringify(v)));
  }
});

// M4 review r1: a dropped store restarts seq at 1. A fact queued BEFORE the welcome would keep that low seq and MC
// (seq_hi 500) would discard it. After a reset only, `adoptSeqHi` renumbers the queue above seq_hi.
function resetRing(how) {
  const st = savedRing();
  const blob = JSON.parse(st.getItem('brx.outbox'));
  if (how === 'v') { blob.v = 99; st.setItem('brx.outbox', JSON.stringify(blob)); } else st.setItem('brx.outbox', '{not json');
  const r = new Ring({ storage: st, log: () => {} });
  r.push({ t: 2, kind: 'offline-hit' }); r.push({ t: 3, kind: 'second' });
  return { st, r };
}

for (const [name, how] of [['(a) an unknown-v drop', 'v'], ['(b) a corrupt store', 'corrupt']]) {
  test(`${name}, a fact queued, then the welcome: the facts go out above seq_hi`, () => {
    const { st, r } = resetRing(how);
    assert.deepEqual(r.pending().map(p => p.seq), [1, 2]);
    r.adoptSeqHi(500);
    assert.deepEqual(r.pending().map(p => [p.seq, p.kind]), [[501, 'offline-hit'], [502, 'second']]);
    assert.equal(r.push({ t: 4 }), 503);
    assert.deepEqual(JSON.parse(st.getItem('brx.outbox')).items.map(i => i.seq), [501, 502, 503]);
    r.adoptSeqHi(900);   // a later welcome: the flag is spent, nothing is renumbered
    assert.deepEqual(r.pending().map(p => p.seq), [501, 502, 503]);
  });
}

test('(c) no reset: queued items keep their seq when the welcome arrives', () => {
  const st = savedRing();   // seq 1 queued by a previous run
  const r = new Ring({ storage: st, log: () => {} });
  r.push({ t: 2 });
  r.adoptSeqHi(500);
  assert.deepEqual(r.pending().map(p => p.seq), [1, 2]);
  assert.equal(r.seqNext, 501);
});

// M4 review r2: a queue longer than seq_hi must be renumbered whole (no collision with the new seqs), and the reset
// flag is spent only once the renumbered queue is stored.
function resetQueue(n, storage) {
  const st = storage || savedRing();
  const blob = JSON.parse(st.getItem('brx.outbox')); blob.v = 99; st.setItem('brx.outbox', JSON.stringify(blob));
  const r = new Ring({ storage: st, log: () => {} });
  for (let i = 0; i < n; i++) r.push({ t: i, kind: `f${i}` });
  return r;
}

test('(r2) a reset queue of 5 and seq_hi 3: seqs are unique and ascending 4..8, all delivered', () => {
  const r = resetQueue(5);
  r.adoptSeqHi(3);
  assert.deepEqual(r.pending().map(p => [p.seq, p.kind]), [[4, 'f0'], [5, 'f1'], [6, 'f2'], [7, 'f3'], [8, 'f4']]);
  assert.equal(r.seqNext, 9);
  r.prune(8); assert.equal(r.size, 0);
});

test('(r2) a reset queue and seq_hi 0: seqs run 1..n', () => {
  const r = resetQueue(3);
  r.adoptSeqHi(0);
  assert.deepEqual(r.pending().map(p => p.seq), [1, 2, 3]);
  assert.equal(r.seqNext, 4);
});

test('(r3) a failed renumber save: a second welcome renumbers the never-sent queue above it, and the next good save writes the new seqs', () => {
  const st = savedRing(); let full = false;
  const flaky = { getItem: k => st.getItem(k), removeItem: k => st.removeItem(k), setItem: (k, v) => { if (full) throw new Error('quota'); st.setItem(k, v); } };
  const r = resetQueue(2, flaky);
  full = true; r.adoptSeqHi(10);
  assert.deepEqual(r.pending().map(p => p.seq), [11, 12]);
  assert.deepEqual(JSON.parse(st.getItem('brx.outbox')).items.map(i => i.seq), [1, 2], 'the store still holds the old seqs');
  // A later welcome. Since the landed-late fix the unsaved renumber is HELD (flushable sends nothing), so 11 and 12 were
  // never sent and are renumbered above the new seq_hi; a renumber that WAS stored is never redone (the test below, c).
  r.adoptSeqHi(20);
  assert.deepEqual(r.pending().map(p => p.seq), [21, 22], 'never sent, so renumbered above the new seq_hi');
  full = false; r.push({ t: 9 });   // the next save, on an enqueue
  assert.deepEqual(JSON.parse(st.getItem('brx.outbox')).items.map(i => i.seq), [21, 22, 23]);
});

// M4 landed-late review (brx5, 2026-10-11): the reset flag lived on the Ring instance only. A second Ring on the same
// storage before the first welcome (a McLink re-dial makes a new Transport, or the app restarts) read the valid store
// the first Ring had saved and kept the low seqs MC already holds, so MC dropped those facts silently.
test('(landed-late) a reset survives a second Ring before the first welcome: the facts go out above seq_hi', () => {
  const st = savedRing();
  const a = resetQueue(2, st);                                    // Transport #1, never welcomed: it saves seqs 1, 2
  const b = new Ring({ storage: st, log: () => {} });             // Transport #2 (a re-dial) or an app restart
  b.adoptSeqHi(40);
  assert.deepEqual(b.pending().map(p => [p.seq, p.kind]), [[41, 'f0'], [42, 'f1']]);
  const c = new Ring({ storage: st, log: () => {} });             // and once spent, a later Ring does not renumber again
  c.adoptSeqHi(80);
  assert.deepEqual(c.pending().map(p => p.seq), [41, 42]);
  void a;
});

test('(landed-late) a store with no reset pending is written exactly as before (no new key)', () => {
  const st = savedRing();
  const r = new Ring({ storage: st, log: () => {} });
  r.push({ t: 1 });
  assert.deepEqual(Object.keys(JSON.parse(st.getItem('brx.outbox'))).sort(), ['dropped', 'items', 'lost', 'seq_next', 'v']);
});

// brx5's follow-up: MC dedupes facts by (node_id, seq) only (scoring.py `seen`), so a fact sent under a renumbered seq and
// renumbered AGAIN after a restart would count twice. A renumber whose save failed therefore holds the queue back from
// the flush until the renumbered seqs are stored: a restart that still finds `renumber` in the store then proves those
// facts were never sent, and renumbering them again is safe. pending() still counts them (status.pending, recap finality).
test('(landed-late r2) a renumber whose save fails holds the flush until a save stores the new seqs', () => {
  const st = savedRing(); let full = false;
  const flaky = { getItem: k => st.getItem(k), removeItem: k => st.removeItem(k), setItem: (k, v) => { if (full) throw new Error('quota'); st.setItem(k, v); } };
  const r = resetQueue(2, flaky);
  full = true; r.adoptSeqHi(10);
  assert.deepEqual(r.flushable(), [], 'not sent while the store still holds the old seqs');
  assert.equal(r.pending().length, 2, 'still counted for status.pending');
  const restarted = new Ring({ storage: st, log: () => {} });  // a restart now: nothing was sent, so renumbering again is safe
  restarted.adoptSeqHi(10);
  assert.deepEqual(restarted.pending().map(p => p.seq), [11, 12]);
  full = false;
  assert.deepEqual(r.flushable().map(p => p.seq), [11, 12], 'the next flush saves first, then sends');
  assert.equal(JSON.parse(st.getItem('brx.outbox')).renumber, undefined, 'the stored flag is spent with the save');
});

test('(landed-late r2) with a working store the flush sends at once after a renumber', () => {
  const r = resetQueue(2);
  r.adoptSeqHi(10);
  assert.deepEqual(r.flushable().map(p => p.seq), [11, 12]);
});

test('(landed-late r4) a later welcome with a higher seq_hi while held renumbers the never-sent facts above it', () => {
  const st = savedRing(); let full = false;
  const flaky = { getItem: k => st.getItem(k), removeItem: k => st.removeItem(k), setItem: (k, v) => { if (full) throw new Error('quota'); st.setItem(k, v); } };
  const r = resetQueue(2, flaky);
  full = true; r.adoptSeqHi(10);
  assert.deepEqual(r.flushable(), []);
  r.adoptSeqHi(1000);                                   // a reconnect: MC now holds up to 1000 (MC rejects 11 outside its window)
  full = false;
  assert.deepEqual(r.flushable().map(p => p.seq), [1001, 1002]);
});
