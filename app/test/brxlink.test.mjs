// Reconnect lifetime. The "retry forever" fix (field 2026-09-01) shipped with a critical regression:
// the forever-loop never cleared `_reconnecting`, so every gun picked afterwards lost auto-reconnect
// entirely and the TAP TO RECONNECT pill was inert. Found by review, and pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrxLink, flapDelay, directWriter, NUS, RX } from '../src/brxlink.js';

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

// F210 (game-test-2026-09-13.md C1): docs/manual/dev.md — a gun with no headset linked connects,
// answers a $PING, then drops itself within seconds, forever. `_connectWithRetry`'s own backoff only
// grows on a FAILED connect; a connect that SUCCEEDS and then drops seconds later never fails, so the
// old code reconnected the instant it dropped and spun as fast as the hardware allowed.
function flapRig(flapMs = 150) {
  const attempts = { A: 0 }; const cb = {};
  const ble = {
    initialize: async () => {}, disconnect: async () => {},
    connect: async (id, c) => { attempts.A++; cb.A = c; },   // always "succeeds" — the gun always accepts the BLE connection
    startNotifications: async () => {},
  };
  const flaps = [];
  const link = new BrxLink({ ble, log: () => {}, flapMs, onFlap: f => flaps.push(f) });
  return { link, attempts, cb, flaps };
}

test('F210: a single quick drop right after connecting still retries at once', async () => {
  const r = flapRig();
  await r.link.connect('A', 'GUN-A-1111');
  r.cb.A();                                       // one quick drop (a manual relink, a genuine blip)
  await new Promise(res => setTimeout(res, 20));
  assert.equal(r.attempts.A, 2, 'the very first flap must not be held back');
  await r.link.disconnect();
});

test('F210: a REPEATING quick drop (headset not linked) backs off instead of spinning forever', async () => {
  const r = flapRig();
  await r.link.connect('A', 'GUN-A-1111');
  r.cb.A();                                       // 1st quick drop — retries at once
  await new Promise(res => setTimeout(res, 20));
  assert.equal(r.attempts.A, 2);
  r.cb.A();                                       // 2nd consecutive quick drop: now the pattern repeats
  await new Promise(res => setTimeout(res, 20));
  assert.equal(r.attempts.A, 2, 'a repeating flap must not reconnect instantly a second time');
  await new Promise(res => setTimeout(res, 200));
  assert.ok(r.attempts.A >= 3, 'but it does retry once the backoff has elapsed');
  await r.link.disconnect();
});

// Bench 2026-09-17: the flat 5 s wait still reconnected every 5-6 s forever, and the tagger said
// "phone connected" on every connect. The wait now grows: 5 s, 15 s, 30 s, then 60 s.
test('flap backoff: the schedule is 5 s, 15 s, 30 s, then a 60 s cap', () => {
  assert.deepEqual([2, 3, 4, 5, 9].map(n => flapDelay(n)), [5000, 15000, 30000, 60000, 60000]);
});

/** One quick drop on the mocked clock: the link is up, the gun drops it at once. */
async function flapOnce(r, settle) { r.cb.A(); await settle(1); }
/** Steps the clock until the attempt count moves, and returns how many ms that took. */
async function msUntilAttempt(r, settle, cap = 3000) {
  const before = r.attempts.A;
  for (let ms = 1; ms <= cap; ms++) { await settle(1); if (r.attempts.A > before) return ms; }
  return -1;
}

test('flap backoff: each further quick drop waits longer, up to the cap', async ctx => {
  const settle = useClock(ctx);
  const r = flapRig(150);                         // the schedule scales with flapMs: 150, 450, 900, 1800
  ctx.after(() => r.link.disconnect());
  await r.link.connect('A', 'GUN-A-1111');
  await flapOnce(r, settle);                      // 1st quick drop: a genuine blip, retried at once
  assert.equal(r.attempts.A, 2, 'the first reconnect stays immediate');
  assert.equal(r.link.flapping, null, 'one quick drop is not flapping');
  const waits = [];
  for (let i = 0; i < 5; i++) {
    r.cb.A();
    const f = r.link.flapping;
    assert.equal(f.count, i + 2);
    assert.equal(f.next_retry_at - Date.now(), [150, 450, 900, 1800, 1800][i], 'next_retry_at says when the wait ends');
    waits.push(await msUntilAttempt(r, settle));
  }
  assert.deepEqual(waits, [150, 450, 900, 1800, 1800]);
  assert.ok(r.flaps.some(f => f && f.count === 6), 'the app hears every change of the flap state');
});

test('flap backoff: a link that stays up clears the flap count', async ctx => {
  const settle = useClock(ctx);
  const r = flapRig(150);
  ctx.after(() => r.link.disconnect());
  await r.link.connect('A', 'GUN-A-1111');
  await flapOnce(r, settle); r.cb.A();            // 2 quick drops: flapping, 150 ms wait
  assert.equal(r.link.flapping.count, 2);
  assert.ok(await msUntilAttempt(r, settle) > 0);
  await settle(160);                              // the headset went on: the link holds past flapMs
  assert.equal(r.link.flapping, null);
  assert.equal(r.flaps.at(-1), null, 'the app hears that the flapping stopped');
  const before = r.attempts.A;
  await flapOnce(r, settle);                      // a later drop counts from the start again
  assert.equal(r.attempts.A, before + 1, 'a drop after a held link reconnects at once');
});

for (const [name, act] of [
  ['RECONNECT NOW', l => l.retryNow()],
  ['RELINK', l => l.relink()],
  ['picking a gun', l => l.connect('A', 'GUN-A-1111')],
]) {
  test(`flap backoff: ${name} resets the backoff and reconnects at once`, async ctx => {
    const settle = useClock(ctx);
    const r = flapRig(150);
    ctx.after(() => r.link.disconnect());
    await r.link.connect('A', 'GUN-A-1111');
    await flapOnce(r, settle);
    for (let i = 0; i < 2; i++) { r.cb.A(); await msUntilAttempt(r, settle); }
    r.cb.A();                                     // 4 quick drops in a row: now in the 450 ms wait
    assert.equal(r.link.flapping.count, 4);
    const before = r.attempts.A;
    act(r.link);
    await settle(5);
    assert.ok(r.attempts.A > before, 'the user action does not wait out the backoff');
    assert.equal(r.link.flapping, null, 'the flap count starts again');
    await flapOnce(r, settle);                    // the next quick drop is a first one again
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
function slowBridgeRig({ answerMs = 10_000, failAt = -1 } = {}) {
  const calls = [];
  const answer = (v, fail) => new Promise((res, rej) => setTimeout(() => (fail ? rej(new Error('Writing characteristic failed.')) : res(v)), answerMs));
  const plugin = {
    writeWithoutResponse: o => { calls.push({ t: Date.now(), kind: 'write', value: o.value }); return answer(undefined, calls.length - 1 === failAt); },
    stopLEScan: () => { calls.push({ t: Date.now(), kind: 'stop' }); return answer(); },
  };
  let queue = Promise.resolve();
  const queued = fn => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };
  const ble = {
    initialize: async () => {}, disconnect: async () => {}, startNotifications: async () => {}, connect: async () => {},
    stopLEScan: () => queued(() => plugin.stopLEScan()),
    writeWithoutResponse: (id, s, c, dv) => queued(() => plugin.writeWithoutResponse({ deviceId: id, value: dv })),
  };
  const logs = [];
  const link = new BrxLink({ ble, log: m => logs.push(m), writeChunk: directWriter(plugin, () => 'android') });
  return { link, calls, logs };
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
  assert.equal(await q, true);
  assert.equal(slow.calls.length, 2);
  assert.match(slow.logs.join('\n'), /write err \(after the answer cap\): Writing characteristic failed/);
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
