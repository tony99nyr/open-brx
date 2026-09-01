// Reconnect lifetime. The "retry forever" fix (field 2026-09-01) shipped with a critical regression:
// the forever-loop never cleared `_reconnecting`, so every gun picked afterwards lost auto-reconnect
// entirely and the TAP TO RECONNECT pill was inert. Found by review, and pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrxLink } from '../src/brxlink.js';

function rig() {
  const attempts = { A: 0, B: 0 }, subs = [], cb = {}, ups = [];
  const up = { A: true, B: true };
  const ble = {
    initialize: async () => {}, disconnect: async () => {},
    connect: async (id, c) => { attempts[id]++; cb[id] = c; if (!up[id]) throw new Error('powered off'); },
    startNotifications: async id => { subs.push(id); },
  };
  const link = new BrxLink({ ble, log: () => {}, onUp: a => ups.push(a && a.basename), onDrop: () => {} });
  return { link, attempts, subs, cb, ups, up };
}
const settle = (ms = 1300) => new Promise(r => setTimeout(r, ms));

test('picking a second gun does not strand it without auto-reconnect', async () => {
  const r = rig();
  await r.link.connect('A', 'GUN-A-1111');
  r.up.A = false; r.cb.A();                       // gun A dies → forever-loop starts
  await settle();
  await r.link.connect('B', 'GUN-B-2222');        // player grabs the spare
  assert.equal(r.link._reconnecting, false, 'the stale loop must release the reconnect guard');
  r.up.B = false; r.cb.B();
  const before = r.attempts.B;
  await settle();
  assert.ok(r.attempts.B > before, 'gun B must still auto-reconnect after gun A was abandoned');
  await r.link.disconnect();
});

test('an abandoned gun is never re-adopted when it powers back on', async () => {
  const r = rig();
  await r.link.connect('A', 'GUN-A-1111');
  r.up.A = false; r.cb.A();
  await settle();
  await r.link.connect('B', 'GUN-B-2222');
  r.up.A = true;                                   // the old gun comes back on in the pit
  await settle(1500);
  assert.equal(r.subs.filter(x => x === 'A').length, 1, 'gun A must not be re-subscribed');
  assert.equal(r.link.deviceId, 'B');
  await r.link.disconnect();
});

test('TAP TO RECONNECT cuts the backoff short instead of waiting it out', async () => {
  const r = rig();
  await r.link.connect('A', 'GUN-A-1111');
  r.up.A = false; r.cb.A();
  await settle(900);                               // now sleeping in a backoff
  const before = r.attempts.A;
  r.link.retryNow();
  await settle(150);
  assert.ok(r.attempts.A > before, 'the tap must trigger an immediate attempt');
  await r.link.disconnect();
});

test('disconnect() stops the forever-loop', async () => {
  const r = rig();
  await r.link.connect('A', 'GUN-A-1111');
  r.up.A = false; r.cb.A();
  await settle(900);
  await r.link.disconnect();
  const after = r.attempts.A;
  await settle(1500);
  assert.equal(r.attempts.A, after, 'no attempts may continue once the gun is released');
});
