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
