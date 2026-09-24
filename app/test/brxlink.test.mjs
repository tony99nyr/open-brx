// Reconnect lifetime. The "retry forever" fix (field 2026-09-01) shipped with a critical regression:
// the forever-loop never cleared `_reconnecting`, so every gun picked afterwards lost auto-reconnect
// entirely and the TAP TO RECONNECT pill was inert. Found by review, and pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrxLink, flapDelay, directWriter, NUS, RX, PARSER_RESET } from '../src/brxlink.js';

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

test('scan: onRaw counts every result the bridge carried; the picker call is unchanged', async () => {
  let opts, cb;
  const ble = { initialize: async () => {}, requestLEScan: async (o, f) => { opts = o; cb = f; }, stopLEScan: async () => {} };
  const link = new BrxLink({ ble, log: () => {} });
  const hits = []; await link.scan(h => hits.push(h));   // the gun picker's call, exactly as app.js makes it
  assert.deepEqual(opts, { allowDuplicates: true, scanMode: 2 }, 'the picker still scans at low latency, with no filter');
  cb({ device: { deviceId: 'X1', name: 'Tactix-FE30' }, rssi: -50 }); cb({ device: { deviceId: 'X2' }, rssi: -80 });
  assert.equal(hits.length, 1, 'the name/UUID filter is unchanged');
  await link.stopScan();
  let raw = 0; await link.scan(() => {}, { scanMode: 1, onRaw: () => raw++ });
  assert.equal(opts.scanMode, 1);
  cb({ device: { deviceId: 'X1', name: 'Tactix-FE30' } }); cb({ device: { deviceId: 'X2' } }); cb({ device: {} });
  assert.equal(raw, 3, 'counted before any filter: each one crossed the bridge');
});

test('RELINK GUN on a link that reads connected really cycles it and runs onUp again', async ctx => {
  const settle = useClock(ctx);
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

// F210 (docs/archive/game-test-2026-09-13.md C1): docs/manual/dev.md — a gun with no headset linked connects,
// answers a $PING, then drops itself within seconds, forever. `_connectWithRetry`'s own backoff only
// grows on a FAILED connect; a connect that SUCCEEDS and then drops seconds later never fails, so the
// old code reconnected the instant it dropped and spun as fast as the hardware allowed.
// Game day 2026-09-19 (p4/p5 phone logs): the gun reset its radio about every 6 s, so the link held 4-8 s.
// A 5 s window missed those drops, the count cleared 5 s after each connect, and a flap wait ran beside
// the retry loop instead of holding it. The rig takes the real constants unless a test scales them.
function flapRig(opts = {}) {
  const attempts = { A: 0 }; const cb = {}; const log = [];
  const r = { attempts, cb, log, flaps: [], drops: 0, ups: 0, fail: false, failCallback: true };
  const ble = {
    initialize: async () => {}, disconnect: async () => {},
    connect: async (id, c) => {
      attempts.A++; cb.A = c;
      // Android: a failed connect ALSO fires the disconnect callback (p4 log 12:45:04), then rejects
      if (r.fail) { if (r.failCallback) c(); throw new Error('Not connected to device.'); }
    },
    startNotifications: async () => {},
  };
  r.link = new BrxLink({ ble, log: m => log.push(m), onFlap: f => r.flaps.push(f), onDrop: () => r.drops++, onUp: () => r.ups++, ...opts });
  return r;
}
const SCALED = { flapWindowMs: 200, flapHoldMs: 300, flapBackoffMs: 50, quietMs: 400 };

test('flap back-off: a 2nd flap waits FLAP_BACKOFF_MS, a 3rd starts the 30 s quiet period', () => {
  assert.deepEqual([1, 2, 3, 4, 9].map(n => flapDelay(n)), [0, 5000, 30000, 30000, 30000]);
});

/** One quick drop on the mocked clock: the link is up, the gun drops it at once. */
async function flapOnce(r, settle) { r.cb.A(); await settle(1); }
/** Steps the clock until the attempt count moves, and returns how many ms that took. */
async function msUntilAttempt(r, settle, cap = 3000, step = 1) {
  const before = r.attempts.A;
  for (let ms = step; ms <= cap; ms += step) { await settle(step); if (r.attempts.A > before) return ms; }
  return -1;
}

test('F210: a single quick drop right after connecting still retries at once', async ctx => {
  const settle = useClock(ctx);
  const r = flapRig(SCALED); ctx.after(() => r.link.disconnect());
  await r.link.connect('A', 'GUN-A-1111');
  await flapOnce(r, settle);
  assert.equal(r.attempts.A, 2, 'the very first flap must not be held back');
  assert.equal(r.link.flapping, null, 'one quick drop is not flapping');
});

test('game day: drops 5-8 s after each connect (the p4 log) are flaps, and the 3rd starts the quiet period', async ctx => {
  const settle = useClock(ctx);
  const r = flapRig(); ctx.after(() => r.link.disconnect());   // the real constants
  const step = async ms => { for (let i = 0; i < ms; i += 50) { ctx.mock.timers.tick(50); await new Promise(res => setImmediate(res)); } };
  await r.link.connect('A', 'GUN-A-1111');
  await step(6000); await flapOnce(r, settle);                 // held 6 s: flap 1, reconnect at once
  assert.equal(r.attempts.A, 2);
  await step(7000); r.cb.A();                                  // held 7 s: flap 2, 5 s back-off
  assert.equal(r.link.flapping.count, 2);
  assert.ok(!r.link.quiet);
  assert.equal(await msUntilAttempt(r, step, 20000, 50), 5000, 'the retry loop waits out the 5 s back-off');
  await step(5000); r.cb.A();                                  // held 5 s: flap 3, the quiet period
  assert.equal(r.link.flapping.count, 3);
  assert.equal(r.link.quiet, true);
  assert.equal(r.flaps.at(-1).quiet, true, 'the app hears the quiet period');
  assert.ok(r.log.some(m => /Quiet period/.test(m)));
  assert.ok(!r.log.some(m => /flap count cleared/.test(m)), 'a link that held 5-7 s never clears the count');
  const before = r.attempts.A;
  await step(29900);
  assert.equal(r.attempts.A, before, 'no reconnect attempt during the quiet period');
  assert.equal(await msUntilAttempt(r, step, 1000, 50), 100, 'it resumes when the quiet period ends');
  assert.ok(!r.link.quiet, 'the quiet state ends with the wait');
  assert.equal(r.link.flapping.count, 3, 'the gun still counts as flapping (MC gun_flapping stays true)');
});

test('quiet period: a failed connect in the retry loop does not reconnect inside the quiet period', async ctx => {
  const settle = useClock(ctx);
  const r = flapRig(SCALED); ctx.after(() => r.link.disconnect());
  await r.link.connect('A', 'GUN-A-1111');
  await flapOnce(r, settle);
  r.cb.A(); await msUntilAttempt(r, settle);                  // flap 2: the 50 ms back-off
  r.fail = true; r.cb.A();                                     // flap 3: quiet 400 ms; the gun is also not connectable
  assert.equal(r.link.quiet, true);
  const before = r.attempts.A;
  await settle(395);
  assert.equal(r.attempts.A, before, 'no attempt inside the quiet period');
  await settle(10);
  assert.equal(r.attempts.A, before + 1);
});

test('flap back-off: a drop during a wait does not start a second retry loop', async ctx => {
  const settle = useClock(ctx);
  const r = flapRig(SCALED); ctx.after(() => r.link.disconnect());
  await r.link.connect('A', 'GUN-A-1111');
  await flapOnce(r, settle);
  r.cb.A();                                                    // flap 2: the loop waits 50 ms
  r.link._reconnect(); r.link._reconnect();                    // extra callers must join the one loop
  await settle(49);
  assert.equal(r.attempts.A, 2, 'nothing reconnects inside the back-off');
  await settle(5);
  assert.equal(r.attempts.A, 3, 'exactly one loop reconnects when the wait ends');
});

test('flap back-off: a link held FLAP_HOLD_MS clears the count; a drop between window and hold keeps it', async ctx => {
  const settle = useClock(ctx);
  const r = flapRig(SCALED); ctx.after(() => r.link.disconnect());
  await r.link.connect('A', 'GUN-A-1111');
  await flapOnce(r, settle); r.cb.A();                         // 2 quick drops: flapping
  assert.equal(r.link.flapping.count, 2);
  assert.ok(await msUntilAttempt(r, settle) > 0);
  await settle(250); r.cb.A();                                 // held 250 ms: past the window, short of the hold
  await settle(1);
  assert.equal(r.link.flapping.count, 2, 'a drop before the hold time does not clear the count');
  assert.equal(r.attempts.A, 4, 'and it is not a flap, so it reconnects at once');
  await settle(299);
  assert.equal(r.link.flapping.count, 2, 'the count holds until the link has held FLAP_HOLD_MS');
  await settle(2);
  assert.equal(r.link.flapping, null);
  assert.equal(r.flaps.at(-1), null, 'the app hears that the flapping stopped');
  const before = r.attempts.A;
  await flapOnce(r, settle);                                   // a later drop counts from the start again
  assert.equal(r.attempts.A, before + 1, 'a drop after a held link reconnects at once');
});

test('a failed connect runs no drop path: one "gun disconnected", one onDrop', async ctx => {
  const settle = useClock(ctx);
  const r = flapRig(SCALED); ctx.after(() => r.link.disconnect());
  await r.link.connect('A', 'GUN-A-1111');
  r.fail = true;
  r.cb.A();                                                    // the link drops once
  await settle(1);
  assert.ok(r.attempts.A >= 2, 'the retry loop tried again');
  await settle(3000);                                          // several failed connects, each firing the callback
  assert.ok(r.attempts.A >= 3);
  assert.equal(r.drops, 1, 'the engine hears the drop once');
  assert.equal(r.log.filter(m => /gun disconnected/.test(m)).length, 1, 'one "gun disconnected" line');
  r.fail = false;
  await settle(10000);
  assert.equal(r.link.connected, true);
});

test('a connect whose link drops before the notifications start is retried, not claimed as up', async ctx => {
  const settle = useClock(ctx);
  const r = flapRig(SCALED); ctx.after(() => r.link.disconnect());
  await r.link.connect('A', 'GUN-A-1111');
  let once = true;
  r.link.ble.startNotifications = async () => { if (once) { once = false; r.cb.A(); } };
  r.cb.A();                                                    // drop; the reconnect's link dies mid-setup
  await settle(3000);
  assert.equal(r.link.connected, true);
  assert.ok(r.attempts.A >= 3, 'the half-made link was retried');
  assert.equal(r.drops, 1);
});

for (const [name, act] of [
  ['RECONNECT NOW', l => l.retryNow()],
  ['RELINK', l => l.relink()],
  ['picking a gun', l => l.connect('A', 'GUN-A-1111')],
]) {
  test(`quiet period: ${name} cancels it and connects at once`, async ctx => {
    const settle = useClock(ctx);
    const r = flapRig(SCALED); ctx.after(() => r.link.disconnect());
    await r.link.connect('A', 'GUN-A-1111');
    await flapOnce(r, settle);
    r.cb.A(); await msUntilAttempt(r, settle);
    r.cb.A();                                                  // 3 quick drops in a row: the quiet period
    assert.equal(r.link.quiet, true);
    const before = r.attempts.A;
    act(r.link);
    await settle(5);
    assert.equal(r.attempts.A, before + 1, 'the user action does not wait out the quiet period');
    assert.equal(r.link.flapping, null, 'the flap count starts again');
    assert.equal(r.link.connected, true);
    await flapOnce(r, settle);                                 // the next quick drop is a first one again
    assert.equal(r.link.flapping, null);
  });
}

// Bench 2026-09-17 (match e6cbe0ae09, Pixel on 0.3.0): RELINK GUN during a LIVE match. The phone log shows
// the press at 13:23:57, three plugin connects that each ran out the plugin's default 10 s timeout
// (13:24:07, 13:24:17, 13:24:28) with a growing retry backoff between them (443, 857, 1939 ms), and the
// link back at 13:24:31: 34 s off the gun. A second press did nothing, because a connect was in flight.
/** A fake plugin with a real sense of time: the gun is connectable from `r.availableAt` on. A connect
 *  catches the gun mid-attempt (a direct connect scans for it), or runs out its `timeout` option (the
 *  plugin default is 10 s) and rejects with the plugin's own message. */
function timedRig(opts = {}) {
  const r = { availableAt: 0, calls: [], ups: 0, drops: 0, relinks: [], disconnects: 0, hangDisconnect: false };
  const ble = {
    initialize: async () => {},
    disconnect: () => { r.disconnects++; return r.hangDisconnect ? new Promise(() => {}) : Promise.resolve(); },
    connect: (id, cb, o) => new Promise((res, rej) => {
      const call = { start: Date.now(), timeout: (o && o.timeout) || 10000 }; r.calls.push(call);
      const readyIn = Math.max(0, r.availableAt - call.start) + 50;
      if (readyIn <= call.timeout) setTimeout(() => { call.end = Date.now(); r.cb = cb; res(); }, readyIn);
      else setTimeout(() => { call.end = Date.now(); rej(new Error('Connection timeout.')); }, call.timeout);
    }),
    startNotifications: async () => {},
  };
  r.link = new BrxLink({ ble, log: () => {}, unbounded: () => true, onUp: () => r.ups++, onDrop: () => r.drops++, onRelink: v => r.relinks.push(v), ...opts });
  return r;
}
async function settleUntil(settle, cond, cap) { for (let ms = 0; ms < cap; ms += 10) { if (cond()) return ms; await settle(10); } return -1; }

test('RELINK reconnects at once: bounded plugin connects, no growing backoff, no flap wait', async ctx => {
  const settle = useClock(ctx);
  const r = timedRig();
  ctx.after(() => r.link.disconnect());
  const up = r.link.connect('A', 'GUN-A-1111'); await settle(60); await up;
  const pressAt = Date.now();
  r.availableAt = pressAt + 16000;                 // the gun is not connectable for a while after the forced disconnect
  const n0 = r.calls.length;
  r.link.relink();
  assert.ok(await settleUntil(settle, () => r.link.connected && r.ups === 2, 30000) >= 0, 'the relink never came back');
  const calls = r.calls.slice(n0);
  assert.ok(calls[0].start - pressAt <= 50, `the first connect waited ${calls[0].start - pressAt} ms after the press`);
  for (const c of calls) assert.ok(c.timeout <= 5000, `a relink connect ran the plugin's ${c.timeout} ms timeout`);
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i].start - calls[i - 1].end <= 300, `attempt ${i + 1} waited ${calls[i].start - calls[i - 1].end} ms after attempt ${i} failed`);
  assert.equal(r.link.flapping, null, 'a user RELINK is never a flap');
  assert.equal(r.drops, 1, 'the engine hears the drop once');
});

test('RELINK: a second press while one is running is ignored, and relinking reads true until the link is up', async ctx => {
  const settle = useClock(ctx);
  const r = timedRig();
  ctx.after(() => r.link.disconnect());
  const up = r.link.connect('A', 'GUN-A-1111'); await settle(60); await up;
  r.availableAt = Date.now() + 7000;
  r.link.relink();
  await settle(100);
  assert.equal(r.link.relinking, true, 'the HUD needs to know a relink is running');
  const calls = r.calls.length, disc = r.disconnects;
  await r.link.relink();                            // Tony's second press, while a connect is in flight
  await settle(100);
  assert.equal(r.disconnects, disc, 'the second press must not cycle the link again');
  assert.equal(r.calls.length, calls, 'the second press must not start a parallel connect');
  assert.ok(await settleUntil(settle, () => r.link.connected, 15000) >= 0);
  await settle(10);
  assert.equal(r.link.relinking, false, 'RELINKING clears once the link is up');
  assert.deepEqual(r.relinks, [true, false], 'the app hears the start and the end, once each');
  assert.equal(r.ups, 2);
});

test('RELINK: a disconnect that never confirms does not hold the reconnect back', async ctx => {
  const settle = useClock(ctx);
  const r = timedRig();
  ctx.after(() => { r.hangDisconnect = false; return r.link.disconnect(); });
  const up = r.link.connect('A', 'GUN-A-1111'); await settle(60); await up;
  r.hangDisconnect = true;
  const pressAt = Date.now(), n0 = r.calls.length;
  r.link.relink();
  assert.ok(await settleUntil(settle, () => r.calls.length > n0, 10000) >= 0, 'a hung disconnect held the relink forever');
  assert.ok(r.calls[n0].start - pressAt <= 2100, `the connect waited ${r.calls[n0].start - pressAt} ms for the disconnect`);
  assert.ok(await settleUntil(settle, () => r.link.connected, 5000) >= 0);
});

test('RELINK: a gun that never answers ends the relink visibly, and the normal reconnect loop takes over', async ctx => {
  const settle = useClock(ctx);
  const r = timedRig({ relinkConnectMs: 400, relinkAttempts: 3 });
  ctx.after(() => r.link.disconnect());
  const up = r.link.connect('A', 'GUN-A-1111'); await settle(60); await up;
  r.availableAt = Infinity;
  const done = r.link.relink();
  assert.ok(await settleUntil(settle, () => !r.link.relinking, 5000) >= 0, 'RELINKING never cleared');
  assert.equal(await done, false);
  const n = r.calls.length;
  await settle(12000);
  assert.ok(r.calls.length > n, 'the forever-reconnect loop must keep trying after a failed relink');
  r.availableAt = 0;
  assert.ok(await settleUntil(settle, () => r.link.connected, 30000) >= 0);
});

// Bench 2026-09-17 (match 592e444eff, Pixel 5): the spawn write took 62 s. Each native write finished in
// 1-2 ms, but the plugin's answer reached JS 6-11 s late (a backlog behind the beacon scan's results), and
// BleClient's queue plus the write loop waited for every answer. The rig models that bridge: the plugin
// records each call the moment JS makes it, and answers `answerMs` later. `ble` is BleClient's shape, one
// queue that waits for each answer, so the old write path is exactly what ran on the phone.
function slowBridgeRig({ answerMs = 10_000, failAt = -1, fails = null } = {}) {
  const calls = [];
  const answer = (v, fail) => new Promise((res, rej) => setTimeout(() => (fail ? rej(new Error('Writing characteristic failed.')) : res(v)), answerMs));
  const plugin = {
    writeWithoutResponse: o => { calls.push({ t: Date.now(), kind: 'write', value: o.value }); return answer(undefined, fails ? fails(calls.length - 1) : calls.length - 1 === failAt); },
    stopLEScan: () => { calls.push({ t: Date.now(), kind: 'stop' }); return answer(); },
  };
  let queue = Promise.resolve();
  const queued = fn => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };
  const ble = {
    initialize: async () => {}, disconnect: async () => {}, startNotifications: async () => {}, connect: async () => {},
    stopLEScan: () => queued(() => plugin.stopLEScan()),
    writeWithoutResponse: (id, s, c, dv) => queued(() => plugin.writeWithoutResponse({ deviceId: id, value: dv })),
  };
  const logs = [], sev = [];
  const link = new BrxLink({ ble, log: (m, c) => { logs.push(m); sev.push([m, c]); }, writeChunk: directWriter(plugin, () => 'android') });
  return { link, calls, logs, sev };
}
const SPAWN = ['$SIR,6,0,,28,0,0,1,,*', '$SIR,13,1,,28,0,0,1,,*', '$SIR,13,0,,28,0,0,1,,*', '$SIR,13,3,,28,0,0,1,,*',
  '$PLAYX,0,*', '$SPAWN,,*', '$AMMO,0,40,80,1,*', '$BMAP,0,0,,,,,*'];
const hexOf = t => [...t].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');

test('a spawn write reaches the gun in about a second when the plugin answers 10 s late', async ctx => {
  const settle = useClock(ctx);
  const r = slowBridgeRig();
  await r.link.connect('A', 'GUN-A-1111');
  const t0 = Date.now();
  const done = r.link.write(SPAWN);
  await settle(1500);
  const writes = r.calls.filter(c => c.kind === 'write');
  const chunks = SPAWN.flatMap(f => f.match(/.{1,20}/g)).map(hexOf);
  assert.equal(writes.length, chunks.length, `every chunk left within 1.5 s (got ${writes.length} of ${chunks.length})`);
  assert.deepEqual(writes.map(w => w.value), chunks, 'in frame order, chunk order, as hex');
  assert.ok(writes.at(-1).t - t0 < 1500);
  assert.equal(await done, true);
  assert.match(r.logs.join('\n'), /write answers slow: 12 of 12 chunk\(s\)/);
  assert.equal(r.link.lateAcks, 12);
});

test('a gun write does not wait behind a scan stop whose answer is slow, and two writes keep their order', async ctx => {
  const settle = useClock(ctx);
  const r = slowBridgeRig();
  await r.link.connect('A', 'GUN-A-1111');
  r.link.stopScan();                               // the beacon watch's 90 s restart, just before T-0
  const a = r.link.write('$PLAYX,0,*'); const b = r.link.write('$SPAWN,,*');
  await settle(300);
  assert.deepEqual(r.calls.map(c => c.kind).sort(), ['stop', 'write', 'write'], 'both writes left while the stop was still unanswered');
  const stopAt = r.calls.find(c => c.kind === 'stop').t, lastWrite = r.calls.filter(c => c.kind === 'write').at(-1).t;
  assert.ok(lastWrite < stopAt + 10_000, 'no write waited for the stop answer');
  assert.deepEqual(r.calls.filter(c => c.kind === 'write').map(c => c.value), [hexOf('$PLAYX,0,*'), hexOf('$SPAWN,,*')]);
  await settle(20);
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
});

test('a healthy answer still holds the next chunk until it arrives', async ctx => {
  const settle = useClock(ctx);
  const r = slowBridgeRig({ answerMs: 30 });      // under the cap: the GATT permit protection is unchanged
  await r.link.connect('A', 'GUN-A-1111');
  const done = r.link.write('$SIR,13,1,,28,0,0,1,,*');
  await settle(29);
  assert.equal(r.calls.length, 1, 'the second chunk waits for the first answer');
  await settle(200);
  assert.equal(r.calls.length, 2);
  assert.ok(r.calls[1].t - r.calls[0].t >= 30);
  assert.equal(await done, true);
  assert.equal(r.link.lateAcks, 0);
});

test('a write error inside the answer cap still stops the batch; a late one is logged', async ctx => {
  const settle = useClock(ctx);
  const fast = slowBridgeRig({ answerMs: 5, failAt: 0 });
  await fast.link.connect('A', 'GUN-A-1111');
  const p = fast.link.write(['$PLAYX,0,*', '$SPAWN,,*']);
  await settle(200);
  assert.equal(await p, false);
  assert.equal(fast.calls.length, 1, 'the batch stopped at the failed chunk');
  assert.match(fast.logs.join('\n'), /write err: Writing characteristic failed/);
  const slow = slowBridgeRig({ answerMs: 500, failAt: 0 });
  await slow.link.connect('A', 'GUN-A-1111');
  const q = slow.link.write(['$PLAYX,0,*', '$SPAWN,,*']);
  await settle(700);
  assert.equal(await q, true, 'this tiny batch finished sending long before the late answer landed');
  assert.equal(slow.calls.length, 2);
  assert.match(slow.logs.join('\n'), /write err \(after the answer cap\): Writing characteristic failed/);
});

const chunksOf = frames => frames.flatMap(f => f.match(/.{1,20}/g)).map(hexOf);
/** Splits the rig's write calls back into whole frames: true when every frame in `got` is whole and `expected`
 *  is the concatenation of `got`'s frames in the same order (a re-send repeats a run, it never reorders one). */
const framesSent = writes => {
  const text = writes.map(w => w.value.match(/../g).map(h => String.fromCharCode(parseInt(h, 16))).join('')).join('');
  return text.match(/\$[^*]*\*/g) || [];
};

test('pl3 2026-09-17: a late error from batch N never cuts batch N+1 -- every frame of N+1 goes, once, and it reports true', async ctx => {
  // Before: `_poisoned` was link-wide and cleared at each write() start. Batch N (one chunk) resolved true, its
  // late rejection landed while batch N+1 was sending, and N+1 stopped partway: `$SPAWN`/`$AMMO`/`$BMAP` never left.
  const settle = useClock(ctx);
  const r = slowBridgeRig({ answerMs: 200, failAt: 0 });
  await r.link.connect('A', 'GUN-A-1111');
  const first = r.link.write('$PLAYX,0,*');     // one chunk; its real answer is a rejection 200 ms later
  const second = r.link.write(SPAWN);           // still sending when that rejection lands
  await settle(2500);
  assert.equal(await first, true, 'batch N already resolved before its late error');
  const writes = r.calls.filter(c => c.kind === 'write');
  // F341: batch N's lost chunk (its last frame) may have left a partial frame in the gun's parser, and batch N+1's
  // first frame was appended to it. So N+1 sends `$*` at its next frame boundary and sends again from frame 0. It is
  // never cut: every frame goes, whole and in order.
  const f = framesSent(writes);
  const at = f.indexOf(PARSER_RESET);
  assert.ok(at > 1 && f.lastIndexOf(PARSER_RESET) === at, 'one parser reset, inside batch N+1');
  assert.equal(f[0], '$PLAYX,0,*');
  const pass1 = f.slice(1, at), pass2 = f.slice(at + 1);
  assert.deepEqual(pass1, SPAWN.slice(0, pass1.length), 'batch N+1 in order up to the reset');
  assert.deepEqual(pass2, SPAWN, 'then the whole batch again from its first frame, the one that was damaged');
  assert.equal(await second, true, 'the late error was not batch N+1\'s');
  assert.equal(r.link.lateLost, 1, 'counted against the batch that owned it');
  assert.match(r.logs.join('\n'), /write err \(after the answer cap\): Writing characteristic failed. -- its batch had already been sent/);
});

test('pl4 2026-09-17: a late error on the last frame, after its batch resolved, is logged at le with the batch label and frame', async ctx => {
  const settle = useClock(ctx);
  const r = slowBridgeRig({ answerMs: 200, failAt: chunksOf(SPAWN).length - 1 });   // the $BMAP chunk is lost, and we learn it after the batch resolved
  await r.link.connect('A', 'GUN-A-1111');
  const done = r.link.write(SPAWN, 'revive');
  await settle(3000);
  assert.equal(await done, true, 'setup: the batch had already resolved true');
  assert.equal(r.link.lateLost, 1);
  const line = r.sev.find(([m]) => /its batch had already been sent/.test(m));
  assert.ok(line, 'the loss is logged');
  assert.equal(line[1], 'le');
  assert.match(line[0], /batch "revive", frame 8 of 8: \$BMAP,0,0/);
  assert.deepEqual(r.link.lastLateLost, { label: 'revive', frame: 7, of: 8, text: '$BMAP,0,0,,,,,*' });
});

test('pl3 2026-09-17: a late error inside its own batch sends again from the start of the failed frame, whole and in order', async ctx => {
  const settle = useClock(ctx);
  const r = slowBridgeRig({ answerMs: 200, failAt: 0 });   // chunk 0 (frame 0) is lost, and we learn it ~4 frames later
  await r.link.connect('A', 'GUN-A-1111');
  const done = r.link.write(SPAWN);
  await settle(3000);
  assert.equal(await done, true, 'the re-send landed');
  const all = framesSent(r.calls.filter(c => c.kind === 'write'));
  const cut = all.indexOf(PARSER_RESET);
  assert.ok(cut > 0 && all.lastIndexOf(PARSER_RESET) === cut, 'F341: exactly one parser reset, at the boundary');
  const sent = all.filter(f => f !== PARSER_RESET);
  const k = sent.length - SPAWN.length;
  assert.ok(k > 0 && k < SPAWN.length, `some frames went before the loss was known (${k})`);
  assert.equal(cut, k, 'F341: the reset goes between the first pass and the re-send');
  assert.deepEqual(sent.slice(0, k), SPAWN.slice(0, k), 'the first pass, in order, up to the boundary');
  assert.deepEqual(sent.slice(k), SPAWN, 'then the whole batch again from frame 0: nothing dropped, nothing reordered');
  assert.match(r.logs.join('\n'), /a chunk of frame 1 of 8 was lost -- sending again from that frame/);
});

test('pl3 2026-09-17: a batch whose re-sends keep failing still sends every frame, then resolves false', async ctx => {
  const settle = useClock(ctx);
  const r = slowBridgeRig({ answerMs: 200, fails: () => true });   // every chunk's late answer is a rejection
  await r.link.connect('A', 'GUN-A-1111');
  const done = r.link.write(SPAWN);
  await settle(8000);
  assert.equal(await done, false, 'a batch that never landed cleanly reports failure');
  const sent = framesSent(r.calls.filter(c => c.kind === 'write')).filter(f => f !== PARSER_RESET);
  assert.deepEqual(sent.slice(-SPAWN.length), SPAWN, 'the last pass still sent every frame through to the end');
  assert.match(r.logs.join('\n'), /still lost after 2 re-send\(s\)/);
  const again = r.link.write('$PING,*');
  await settle(300);
  assert.equal(await again, true, 'the next batch is not tainted by the old one');
});

// F341 (field 2026-09-24, 0.4.11, Pixel 5, Tactix-FE30): `$HP,4545,7070,0` on every read for the rest of a match. The last
// chunk of the spawn burst's `$PSET` (the one with the `*`) failed with status 201, and the loop sent the `$PSET` again
// from its first byte. The gun's parser keeps tokens 1..59 across a `$` (transport-hardening.md §1.3), so the second copy
// was appended to the first: hp "45"+"45", armour "70"+"70". `gunParser` models that parser byte for byte, and `$*`
// (screamers A4) as the reset that clears it.
function gunParser() {
  let tok = new Array(60).fill(''), idx = 0;
  const out = [];
  return {
    out,
    feed(text) {
      for (const c of text) {
        if (c === '$') { tok[0] = ''; idx = 0; }
        else if (c === ',') idx = idx >= 59 ? 1 : idx + 1;
        else if (c === '*') {
          let n = tok.length; while (n > 1 && tok[n - 1] === '') n--;
          out.push(tok.slice(0, Math.max(n, idx + 1)));
          tok = new Array(60).fill(''); idx = 0;   // the common return path clears every token
        } else tok[idx] += c;
      }
    },
  };
}
const PSET = '$PSET,0,1,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*';
const LIFE_BURST = [PSET, '$SPAWN,,*', '$TID,1,*', '$AMMO,0,30,90,1,*'];
const textOf = w => w.value.match(/../g).map(h => String.fromCharCode(parseInt(h, 16))).join('');

test('the gun parser model reproduces 4545/7070 from a partial $PSET followed by a whole one', () => {
  const g = gunParser();
  g.feed(PSET.slice(0, 80)); g.feed(PSET);             // the incident: the `*` chunk never arrived
  assert.deepEqual(g.out[0].slice(0, 6), ['PSET', '00', '11', '4545', '7070', '7070']);
  const h = gunParser();
  h.feed(PSET.slice(0, 80)); h.feed(PARSER_RESET); h.feed(PSET);   // the cure: `$*` between them
  assert.deepEqual(h.out.at(-1).slice(0, 6), ['PSET', '0', '1', '45', '70', '70']);
});

for (const delivered of [false, true]) {
  test(`F341: after an uncertain chunk (${delivered ? 'it did reach the gun' : 'status 201, it never went'}) the re-send goes only after $*, and the gun reads 45/70`, async ctx => {
    const settle = useClock(ctx);
    const last = chunksOf([PSET]).length - 1;             // the chunk with the `*`
    // 60 ms: past the 50 ms cap, so the loop has moved on, but inside the frame gap: the loss is known at the
    // boundary right after the `$PSET`, which is exactly when the old loop re-sent it onto the partial frame.
    const r = slowBridgeRig({ answerMs: 60, failAt: last });
    await r.link.connect('A', 'GUN-A-1111');
    const done = r.link.write(LIFE_BURST, 'spawn');
    await settle(3000);
    assert.equal(await done, true, 'the re-send landed');
    const writes = r.calls.filter(c => c.kind === 'write');
    const texts = writes.map(textOf);
    const resetAt = texts.indexOf(PARSER_RESET);
    assert.ok(resetAt > last, 'a $* went out after the failed chunk');
    assert.equal(texts.slice(last + 1, resetAt).join('').includes('$PSET'), false, 'no re-send of the $PSET started before the reset');
    assert.equal(texts.slice(resetAt + 1).join('').startsWith('$PSET,'), true, 'the re-send starts right after the reset');
    const g = gunParser();
    writes.forEach((w, i) => { if (delivered || i !== last) g.feed(texts[i]); });
    const psets = g.out.filter(t => t[0] === 'PSET');
    assert.ok(psets.length >= 1);
    for (const t of psets) assert.deepEqual(t.slice(3, 5), ['45', '70'], `the gun never holds a doubled pool: ${t.slice(0, 6).join(',')}`);
    assert.match(r.logs.join('\n'), /sent \$\* first to clear the gun's parser/);
    assert.equal(r.link.parserResets, 1);
  });
}

test('F341: a chunk error that lands after its batch resolved makes the NEXT write start with $*', async ctx => {
  const settle = useClock(ctx);
  const r = slowBridgeRig({ answerMs: 200, failAt: 0 });
  await r.link.connect('A', 'GUN-A-1111');
  const first = r.link.write('$PLAYX,0,*');
  await settle(400);                                     // the batch resolves, then its late rejection lands with the queue idle
  assert.equal(await first, true);
  assert.equal(r.link.lateLost, 1);
  const next = r.link.write('$LIFE,0,0,0,*', 'poll');
  await settle(400);
  assert.equal(await next, true);
  const texts = r.calls.filter(c => c.kind === 'write').map(textOf);
  assert.deepEqual(texts.slice(1), [PARSER_RESET, '$LIFE,0,0,0,*'], 'the reset goes first, then the frame, once');
  const again = r.link.write('$PING,*');
  await settle(400);
  assert.equal(await again, true);
  assert.equal(r.calls.filter(c => c.kind === 'write').map(textOf).at(-1), '$PING,*', 'one reset per loss, not one per write');
  assert.equal(r.link.parserResets, 1);
});

test('F341: a chunk error inside the cap stops the batch, and the next write starts with $*', async ctx => {
  const settle = useClock(ctx);
  const r = slowBridgeRig({ answerMs: 5, failAt: 1 });  // the second chunk of the $PSET fails at once
  await r.link.connect('A', 'GUN-A-1111');
  assert.equal(await Promise.race([r.link.write([PSET]), settle(300).then(() => 'hung')]), false);
  const next = r.link.write('$SPAWN,,*');
  await settle(300);
  assert.equal(await next, true);
  const texts = r.calls.filter(c => c.kind === 'write').map(textOf);
  assert.deepEqual(texts.slice(-2), [PARSER_RESET, '$SPAWN,,*']);
});

test('the real plugin gets the direct writer; the web build is sent the DataView', () => {
  const seen = [];
  const plugin = { writeWithoutResponse: o => { seen.push(o); return Promise.resolve(); } };
  const dv = new DataView(new TextEncoder().encode('$PING,*').buffer);
  directWriter(plugin, () => 'android')('A', dv);
  directWriter(plugin, () => 'web')('A', dv);
  assert.deepEqual(seen[0], { deviceId: 'A', service: NUS, characteristic: RX, value: hexOf('$PING,*') });
  assert.equal(seen[1].value, dv);
  assert.equal(typeof new BrxLink({}).writeChunk, 'function');
});

// transport-hardening.md §3: the write pacing is one frozen table, and the block pause ships OFF. The gun
// reads one serial byte per main-loop pass from a 1 KB buffer (V4_30/V4_31 disassembly); the block pause is
// the lever bench §14 measures, and until it is measured the field pacing must not move.
test('write pacing: the shipped values are the field values and the block pause is off', async ctx => {
  const { WRITE_PACING } = await import('../src/brxlink.js');
  assert.deepEqual(WRITE_PACING, { chunkGapMs: 8, frameGapMs: 18, blockFrames: 0, blockPauseMs: 0, responseForMultiPacket: false });
  assert.ok(Object.isFrozen(WRITE_PACING));
  const r = cleanRig(ctx);
  assert.equal(r.link.chunkGapMs, 8); assert.equal(r.link.frameGapMs, 18);
  assert.equal(r.link.blockFrames, 0); assert.equal(r.link.blockPauseMs, 0);
  assert.equal(r.link.responseForMultiPacket, false);
});

// F270 (transport-hardening.md §5, FOLLOWUPS): the response-for-multi-packet lever. Off by default --
// pin today's behaviour, that every chunk still goes through the without-response writer -- and, when on,
// only a frame over one 20-byte packet is affected.
function responseRig(ctx, opts = {}) {
  const calls = [];
  const plugin = {
    writeWithoutResponse: o => { calls.push({ kind: 'noresp', value: o.value }); return Promise.resolve(); },
    write: o => { calls.push({ kind: 'resp', value: o.value }); return Promise.resolve(); },
  };
  const ble = { initialize: async () => {}, disconnect: async () => {}, startNotifications: async () => {}, connect: async () => {} };
  const link = new BrxLink({
    ble, log: () => {}, ...opts,
    writeChunk: directWriter(plugin, () => 'android'),
    writeChunkResponse: directWriter(plugin, () => 'android', { response: true }),
  });
  ctx.after(() => link.disconnect());
  return { link, calls };
}

test('F270: responseForMultiPacket off (default) -- every chunk, single- or multi-packet, uses the without-response writer', async ctx => {
  const settle = useClock(ctx);
  const { link, calls } = responseRig(ctx);
  await link.connect('A', 'GUN-A-1111');
  const done = link.write(SPAWN);
  await settle(1000);
  assert.equal(await done, true);
  assert.equal(calls.length, chunksOf(SPAWN).length, 'every chunk was sent');
  assert.ok(calls.every(c => c.kind === 'noresp'), 'the lever is off: nothing goes through the response writer');
});

test('F270: responseForMultiPacket on -- a multi-packet frame\'s chunks use the response writer, a single-packet frame\'s does not', async ctx => {
  const settle = useClock(ctx);
  const { link, calls } = responseRig(ctx, { responseForMultiPacket: true });
  await link.connect('A', 'GUN-A-1111');
  const done = link.write(SPAWN);
  await settle(1000);
  assert.equal(await done, true);
  const expectedKinds = SPAWN.flatMap(f => Array(Math.ceil(f.length / 20)).fill(f.length > 20 ? 'resp' : 'noresp'));
  assert.deepEqual(calls.map(c => c.kind), expectedKinds);
  assert.deepEqual(calls.map(c => c.value), chunksOf(SPAWN), 'the chunk bytes are unchanged either way');
});

test('F270: with the lever on, a response chunk that answers after the cap holds the next chunk back', async ctx => {
  // The plugin keeps one write callback per device, so a second write issued before the first answers
  // fails as busy (Android) or overwrites the pending callback (iOS). A response chunk must wait, cap or not.
  const settle = useClock(ctx);
  const events = [];
  let open = 0;
  const plugin = {
    writeWithoutResponse: () => { events.push('noresp'); return Promise.resolve(); },
    write: () => {
      assert.equal(open, 0, 'a response write started while another was still unanswered');
      open++; events.push('resp');
      return new Promise(r => setTimeout(() => { open--; r(); }, 80));   // past the 50 ms cap
    },
  };
  const ble = { initialize: async () => {}, disconnect: async () => {}, startNotifications: async () => {}, connect: async () => {} };
  const link = new BrxLink({ ble, log: () => {}, responseForMultiPacket: true,
    writeChunk: directWriter(plugin, () => 'android'),
    writeChunkResponse: directWriter(plugin, () => 'android', { response: true }) });
  ctx.after(() => link.disconnect());
  await link.connect('A', 'GUN-A-1111');
  const long = '$' + 'A'.repeat(50) + ',*';
  const done = link.write([long]);
  await settle(1000);
  assert.equal(await done, true);
  assert.deepEqual(events, ['resp', 'resp', 'resp']);
  assert.equal(link.lateAcks, 0, 'a response chunk is never counted late');
});

test('F270: with the lever on, a response chunk that fails after the cap still fails the write', async ctx => {
  const settle = useClock(ctx);
  const plugin = {
    writeWithoutResponse: () => Promise.resolve(),
    write: () => new Promise((_, rej) => setTimeout(() => rej(new Error('GATT 133')), 80)),
  };
  const ble = { initialize: async () => {}, disconnect: async () => {}, startNotifications: async () => {}, connect: async () => {} };
  const link = new BrxLink({ ble, log: () => {}, responseForMultiPacket: true,
    writeChunk: directWriter(plugin, () => 'android'),
    writeChunkResponse: directWriter(plugin, () => 'android', { response: true }) });
  ctx.after(() => link.disconnect());
  await link.connect('A', 'GUN-A-1111');
  const done = link.write(['$' + 'A'.repeat(50) + ',*']);
  await settle(2000);
  assert.equal(await done, false, 'a lost response write is reported, not swallowed');
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

// Review 2026-09-19: a SET MY GUN tap during a background reconnect to a gun that is off used to fail
// silently -- `scan()` throws "a gun connect is in flight" while the loop holds the radio, and the picker
// showed "No guns found" with no scan ever having run. app.js's `openPicker` now ends that loop first
// (`link.disconnect()`, the smallest safe option) before it scans; this pins the BrxLink half of that fix.
test('ending a background reconnect frees the radio, so the picker can scan instead of "No guns found"', async ctx => {
  const settle = useClock(ctx);
  // Models a gun that is off: the native connect() hangs (a real GATT connect can sit for many seconds)
  // until a disconnect() call on the same id aborts it -- the assumption behind the fix.
  let pendingReject = null;
  const ble = {
    initialize: async () => {}, requestLEScan: async () => {}, stopLEScan: async () => {},
    connect: () => new Promise((_res, rej) => { pendingReject = rej; }),
    startNotifications: async () => {},
    disconnect: async () => { if (pendingReject) { const rej = pendingReject; pendingReject = null; rej(new Error('disconnected while connecting')); } },
  };
  const link = new BrxLink({ ble, log: () => {} });
  link.deviceId = 'A';                 // a remembered gun the app is retrying in the background
  link._reconnect();                   // the forever-loop starts trying it
  for (let i = 0; i < 5 && !link.connecting; i++) await new Promise(r => setImmediate(r));
  assert.equal(link.connecting, true, 'CONTROL: the background loop holds the radio');
  await assert.rejects(link.scan(() => {}), /connect is in flight/, 'CONTROL: a scan still refuses on its own');
  if (link.connecting) await link.disconnect();   // exactly what openPicker now does before it scans
  await settle(50);
  assert.equal(link.connecting, false, 'the disconnect ended the in-flight connect');
  await link.scan(() => {});
  assert.equal(link.scanning, true, 'the picker can now open its scan');
  await link.stopScan();
});
