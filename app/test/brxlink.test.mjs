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
/** The backoff runs on the mocked clock of node:test, so a loaded machine cannot stretch or shrink it
 *  against the assertions. `settle(ms)` steps 1 ms at a time and lets the retry loop's promise callbacks
 *  run after each step. `setImmediate` is not mocked. */
function useClock(ctx) {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_700_000_000_000 });
  return async (ms = 1300) => {
    for (let i = 0; i < ms; i++) { ctx.mock.timers.tick(1); await new Promise(r => setImmediate(r)); }
  };
}
/** A rig whose link is released when the test ends, pass or fail: a forever-loop left running keeps
 *  retrying on the mocked clock after the test, and on a real clock it would hold the process open. */
function cleanRig(ctx) {
  const r = rig();
  ctx.after(() => r.link.disconnect());
  return r;
}

test('picking a second gun does not strand it without auto-reconnect', async ctx => {
  const settle = useClock(ctx);
  const r = cleanRig(ctx);
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

test('an abandoned gun is never re-adopted when it powers back on', async ctx => {
  const settle = useClock(ctx);
  const r = cleanRig(ctx);
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

test('TAP TO RECONNECT cuts the backoff short instead of waiting it out', async ctx => {
  const settle = useClock(ctx);
  const r = cleanRig(ctx);
  await r.link.connect('A', 'GUN-A-1111');
  r.up.A = false; r.cb.A();
  await settle(900);                               // now sleeping in a backoff
  const before = r.attempts.A;
  r.link.retryNow();
  await settle(150);
  assert.ok(r.attempts.A > before, 'the tap must trigger an immediate attempt');
  await r.link.disconnect();
});

test('disconnect() stops the forever-loop', async ctx => {
  const settle = useClock(ctx);
  const r = cleanRig(ctx);
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
test('B4: noteStale() forces the OS to release the stale GATT link and runs the exact drop path', async ctx => {
  const settle = useClock(ctx);
  const r = cleanRig(ctx);
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

test('B4: noteStale() is a no-op when there is no live connection to cycle', ctx => {
  const r = cleanRig(ctx);
  r.link.noteStale();                 // never connected: no deviceId
  assert.equal(r.drops.length, 0);
  assert.equal(r.disconnects.length, 0);
});

// transport-hardening.md §3: the write pacing is one frozen table, and the block pause ships OFF. The gun
// reads one serial byte per main-loop pass from a 1 KB buffer (V4_30/V4_31 disassembly); the block pause is
// the lever bench §14 measures, and until it is measured the field pacing must not move.
test('write pacing: the shipped values are the field values and the block pause is off', async ctx => {
  const { WRITE_PACING } = await import('../src/brxlink.js');
  assert.deepEqual(WRITE_PACING, { chunkGapMs: 8, frameGapMs: 18, blockFrames: 0, blockPauseMs: 0 });
  assert.ok(Object.isFrozen(WRITE_PACING));
  const r = cleanRig(ctx);
  assert.equal(r.link.chunkGapMs, 8); assert.equal(r.link.frameGapMs, 18);
  assert.equal(r.link.blockFrames, 0); assert.equal(r.link.blockPauseMs, 0);
});

test('write pacing: with a block size set, a pause lands after every N frames and never after the last', async ctx => {
  const settle = useClock(ctx);
  const writes = [];
  const ble = {
    initialize: async () => {}, disconnect: async () => {}, connect: async () => {}, startNotifications: async () => {},
    writeWithoutResponse: async (_id, _s, _c, dv) => { writes.push({ at: Date.now(), n: dv.byteLength }); },
  };
  const link = new BrxLink({ ble, log: () => {}, blockFrames: 2, blockPauseMs: 300 });
  ctx.after(() => link.disconnect());
  await link.connect('A', 'GUN-A-1111');
  const done = link.write(['$PING,*', '$PING,*', '$PING,*', '$PING,*', '$PING,*']);
  await settle(2000);
  assert.equal(await done, true);
  assert.equal(writes.length, 5);
  const gaps = writes.slice(1).map((w, i) => w.at - writes[i].at);
  // 18 ms frame gap everywhere; +300 ms after frames 2 and 4 (frame 5 is last: no trailing pause)
  assert.deepEqual(gaps, [18, 318, 18, 318]);
});
