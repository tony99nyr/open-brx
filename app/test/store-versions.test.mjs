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
