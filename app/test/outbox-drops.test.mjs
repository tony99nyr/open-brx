// O6: a fact the phone's outbox drops is counted, logged and reported (cumulatively), never silent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ring, memoryStorage } from '../src/transport/ring.js';
import { Transport } from '../src/transport/transport.js';

test('O6: a ring overflow and an age drop each write one log line and grow a cumulative total', () => {
  let now = 1_000_000; const lines = [];
  const r = new Ring({ storage: memoryStorage(), maxCount: 2, maxAgeMs: 1000, now: () => now, log: l => lines.push(l) });
  r.push({ type: 'a' }); r.push({ type: 'a' }); r.push({ type: 'a' });
  assert.equal(lines.length, 1); assert.match(lines[0], /outbox dropped 1 facts \(count 1\)/);
  now += 2000; r.push({ type: 'a' });
  assert.equal(lines.length, 2); assert.match(lines[1], /outbox dropped 2 facts \(age 2\)/);
  assert.equal(r.droppedTotal, 3);
  assert.equal(r.takeDropped(), 3); assert.equal(r.droppedTotal, 3, 'the cumulative count survives a heartbeat');
});

test('O6: the cumulative count survives a restart, a quota failure logs once per streak, a corrupt store logs', () => {
  const store = memoryStorage(); const lines = [];
  const r = new Ring({ storage: store, maxCount: 1, now: () => 1, log: l => lines.push(l) });
  r.push({}); r.push({});
  assert.equal(new Ring({ storage: store, now: () => 1, log: () => {} }).droppedTotal, 1);
  let boom = true;
  const flaky = { getItem: k => store.getItem(k), removeItem: k => store.removeItem(k), setItem: (k, v) => { if (boom) throw new Error('QuotaExceededError'); store.setItem(k, v); } };
  const q = []; const r2 = new Ring({ storage: flaky, now: () => 1, log: l => q.push(l) });
  r2.push({}); r2.push({});
  assert.equal(q.filter(l => /quota/.test(l)).length, 1);
  boom = false; r2.push({}); boom = true; r2.push({});
  assert.equal(q.filter(l => /quota/.test(l)).length, 2, 'a new streak logs again');
  const bad = memoryStorage(); bad.setItem('brx.outbox', '{nope'); const c = [];
  new Ring({ storage: bad, log: l => c.push(l) });
  assert.match(c[0], /corrupt/);
});

test('O6: the heartbeat carries dropped_total beside the per-beat delta, and omits it when nothing was lost', () => {
  const t = new Transport({ node: {}, gun: null, storage: memoryStorage() });
  t.ring.log = () => {};
  const sent = []; t.state = 'bound'; t._sendKind = (k, b) => { sent.push([k, b]); return true; };
  t.status({}); assert.equal('dropped_total' in sent[0][1], false);
  t.ring.maxCount = 1; t.ring.push({}); t.ring.push({}); t.ring.push({});
  t.status({}); assert.equal(sent[1][1].dropped, 2); assert.equal(sent[1][1].dropped_total, 2);
  t.status({}); assert.equal('dropped' in sent[2][1], false); assert.equal(sent[2][1].dropped_total, 2);
});
