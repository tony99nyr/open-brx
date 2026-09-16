// Reconnect lifetime. The "retry forever" fix (field 2026-09-01) shipped with a critical regression:
// the forever-loop never cleared `_reconnecting`, so every gun picked afterwards lost auto-reconnect
// entirely and the TAP TO RECONNECT pill was inert. Found by review, and pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrxLink } from '../src/brxlink.js';

function rig() {
  const attempts = { A: 0, B: 0 }, subs = [], cb = {}, ups = [], drops = [], disconnects = [];
  const up = { A: true, B: true };
  const ble = {
    initialize: async () => {}, disconnect: async id => { disconnects.push(id); },
    connect: async (id, c) => { attempts[id]++; cb[id] = c; if (!up[id]) throw new Error('powered off'); },
    startNotifications: async id => { subs.push(id); },
  };
  const link = new BrxLink({ ble, log: () => {}, onUp: a => ups.push(a && a.basename), onDrop: () => drops.push(Date.now()) });
  return { link, attempts, subs, cb, ups, up, drops, disconnects };
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

// B4 (field session 2026-09-12): the engine's link-silence watchdog calls `noteStale()` when the gun has
// gone quiet for too long while the native BLE stack still reports "connected" — a bad-but-not-dead
// link the disconnect callback this whole file otherwise depends on may never fire for.
test('B4: noteStale() forces the OS to release the stale GATT link and runs the exact drop path', async () => {
  const r = rig();
  await r.link.connect('A', 'GUN-A-1111');
  assert.equal(r.link.connected, true);
  const before = r.attempts.A;   // captured BEFORE noteStale(): the fake `ble.connect` bumps this synchronously, inside noteStale()'s own call stack, once per retry attempt
  r.link.noteStale();
  assert.equal(r.link.connected, false, 'flips immediately, exactly like a real disconnect');
  assert.equal(r.drops.length, 1, 'onDrop fires — the same path the engine/HUD/MC status already trust');
  assert.deepEqual(r.disconnects, ['A'], 'the OS is told to actually let go of the stale link, not just JS bookkeeping');
  assert.ok(r.attempts.A > before, 'the forever-reconnect loop takes over exactly as it would after a real disconnect');
  await settle();
  await r.link.disconnect();
});

test('B4: noteStale() is a no-op when there is no live connection to cycle', () => {
  const r = rig();
  r.link.noteStale();                 // never connected: no deviceId
  assert.equal(r.drops.length, 0);
  assert.equal(r.disconnects.length, 0);
});

// Playtest 2026-09-13 (Pixel 5 scan storm): overlapping stop/start calls on a slow bridge.
function scanRig() {
  const native = [], gates = [];
  const gated = name => new Promise(res => { native.push(name); gates.push(res); });
  const ble = { initialize: async () => {}, requestLEScan: () => gated('request'), stopLEScan: () => gated('stop') };
  const link = new BrxLink({ ble, log: () => {} });
  const turn = () => new Promise(r => setImmediate(r));
  const open = async () => { await turn(); while (gates.length) { gates.shift()(); await turn(); } };
  return { link, native, open, turn };
}

test('scan flag: a slow stop that overlaps a newer scan cannot clear the flag under it', async () => {
  const r = scanRig();
  const first = r.link.scan(() => {}); await r.open(); await first;
  const stopA = r.link.stopScan(); const stopB = r.link.stopScan();   // two overlapping stops, bridge not answering
  const again = r.link.scan(() => {});                                // the restart that followed the first stop
  await r.open(); await Promise.all([stopA, stopB, again]);
  assert.equal(r.link.scanning, true, 'the newest scan is open, so the flag must say so');
  assert.equal(r.native.at(-1), 'request', 'the native calls ran in call order: the scan is the last one');
  await assert.rejects(r.link.scan(() => {}), /already open/, 'and the guard still refuses a third scan');
});

test('scan flag: a refused start leaves no phantom open scan', async () => {
  const ble = { initialize: async () => {}, requestLEScan: async () => { throw new Error('scanning too frequently'); }, stopLEScan: async () => {} };
  const link = new BrxLink({ ble, log: () => {} });
  await assert.rejects(link.scan(() => {}), /too frequently/);
  assert.equal(link.scanning, false);
});

test('RELINK GUN on a link that reads connected really cycles it and runs onUp again', async () => {
  const r = rig();
  await r.link.connect('A', 'GUN-A-1111');
  assert.equal(r.ups.length, 1);
  const before = r.attempts.A;
  const cycled = r.link.relink();
  r.cb.A();                                        // the native stack reports the forced disconnect too
  assert.equal(await cycled, true);
  await settle(100);
  assert.deepEqual(r.disconnects, ['A'], 'the GATT link is released');
  assert.equal(r.drops.length, 1, 'the engine hears about the drop exactly once');
  assert.ok(r.attempts.A > before, 'a fresh connect follows');
  assert.equal(r.link.connected, true);
  assert.equal(r.ups.length, 2, 'onUp runs again, so the engine re-runs its relink path');
  await r.link.disconnect();
});

test('RELINK GUN with no gun picked does nothing', async () => {
  const r = rig();
  assert.equal(await r.link.relink(), false);
  assert.equal(r.disconnects.length, 0);
});
