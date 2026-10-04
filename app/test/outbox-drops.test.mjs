// O6: a fact the phone's outbox drops is counted, logged and reported (cumulatively), never silent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ring, MAX_MATCHES, memoryStorage } from '../src/transport/ring.js';
import { Transport } from '../src/transport/transport.js';

test('O6: a ring overflow and an age drop each write one log line and grow a cumulative total', () => {
  let now = 1_000_000; const lines = [];
  const r = new Ring({ storage: memoryStorage(), maxCount: 2, maxAgeMs: 1000, now: () => now, log: l => lines.push(l) });
  r.push({ type: 'a', match_id: 'm1' }); r.push({ type: 'a', match_id: 'm1' }); r.push({ type: 'a', match_id: 'm1' });
  assert.equal(lines.length, 1); assert.match(lines[0], /outbox dropped 1 facts \(count 1\)/);
  r.push({ type: 'a' }); r.push({ type: 'a' });
  assert.equal(lines.length, 1, 'at the cap every push drops one: one line per streak, not per fact');
  assert.equal(r.lostFor('m1'), 3);
  r.prune(r.pending().at(-1).seq);                  // an ack ends the streak
  r.push({ type: 'a', match_id: 'm2' }); r.push({ type: 'a', match_id: 'm2' }); r.push({ type: 'a', match_id: 'm2' });
  assert.equal(lines.length, 2); assert.match(lines[1], /outbox dropped 1 facts/);
  now += 2000; r.push({ type: 'a' });
  assert.equal(lines.length, 2, 'the age drop is in the same streak until an ack');
  assert.equal(r.takeDropped(), 6);
  assert.equal(r.lostFor('m1'), 3, 'a loss is counted against ITS match: m1 keeps its 3');
  assert.equal(r.lostFor('m2') + r.lostFor(''), 3, 'the rest belong to m2 / the matchless facts');
  assert.equal(r.lostFor('m3'), 0); assert.equal(r.lostFor(null), 0);
});

test('O6: the per-match counts survive a restart and stay bounded; a quota failure logs once per streak; a corrupt store logs', () => {
  const store = memoryStorage();
  const r = new Ring({ storage: store, maxCount: 1, now: () => 1, log: () => {} });
  r.push({ match_id: 'a' }); r.push({ match_id: 'a' });
  assert.equal(new Ring({ storage: store, now: () => 1, log: () => {} }).lostFor('a'), 1);
  for (const m of ['b', 'c', 'd', 'e', 'f']) { r.push({ match_id: m }); r.push({ match_id: m }); }
  assert.ok(Object.keys(r.lost).length <= MAX_MATCHES, 'only the last few matches are remembered');
  assert.equal(r.lostFor('a'), 0, 'the oldest match is forgotten');
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

test('O6: the heartbeat names the match its loss count belongs to, and says nothing without a match', () => {
  const t = new Transport({ node: {}, gun: null, storage: memoryStorage() });
  t.ring.log = () => {};
  const sent = []; t.state = 'bound'; t._sendKind = (k, b) => { sent.push([k, b]); return true; };
  t.status({}); assert.equal('outbox_lost' in sent[0][1], false, 'no match, no claim');
  t.matchId = 'm1'; t.status({}); assert.deepEqual(sent[1][1].outbox_lost, { match_id: 'm1', n: 0 });
  t.ring.maxCount = 1; t.ring.push({ match_id: 'm1' }); t.ring.push({ match_id: 'm1' }); t.ring.push({ match_id: 'old' });
  t.status({}); assert.equal(sent[2][1].dropped, 2); assert.deepEqual(sent[2][1].outbox_lost, { match_id: 'm1', n: 2 });
  t.matchId = 'm2'; t.status({}); assert.deepEqual(sent[3][1].outbox_lost, { match_id: 'm2', n: 0 }, 'a new match starts at 0 on the phone: nothing to baseline');
  assert.equal('dropped' in sent[3][1], false);
});
