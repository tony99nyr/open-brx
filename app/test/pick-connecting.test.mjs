// App 0.4.2, field 2026-09-19 (Pixel 5, app 0.4.1). After a tap on a gun the picker
// list emptied and the screen showed nothing for about 4 s. The phone log: "connecting to <gun>…"
// at 13:41:25, "connect 1/5 failed after 345 ms (GATT_ERROR 133)", "connect 2/5 failed after 364 ms
// (133)", then the link at 13:41:29. Two fixes, one test group each:
//  1. the picker shows "Connecting to <gun>…" from the tap until the link is up or fails;
//  2. the first connect after a scan stop waits for the stop, then SCAN_SETTLE_MS. Reconnects do not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BrxLink, SCAN_SETTLE_MS } from '../src/brxlink.js';
import { connectingText } from '../src/hud/hud.js';

function useClock(ctx) {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_700_000_000_000 });
  return async (ms = 1300) => {
    for (let i = 0; i < ms; i++) { ctx.mock.timers.tick(1); await new Promise(r => setImmediate(r)); }
  };
}

/** A plugin double: `stopLEScan` takes `stopMs`, the first `fails` connects throw status 133, and every
 *  native connect records the fake-clock time it started at. */
function gun({ fails = 0, stopMs = 50 } = {}) {
  const connects = [], stops = [];
  let n = 0, onDisc = null;
  const ble = {
    initialize: async () => {},
    requestLEScan: async () => {},
    stopLEScan: async () => { await new Promise(r => setTimeout(r, stopMs)); stops.push(Date.now()); },
    connect: async (id, cb) => { connects.push(Date.now()); onDisc = cb; if (n++ < fails) throw new Error('GATT_ERROR 133'); },
    startNotifications: async () => {},
    disconnect: async () => {},
  };
  return { ble, connects, stops, drop: () => onDisc && onDisc() };
}

test('connectingText: the gun name from the tap, the attempt count on a retry, a plain message on failure', () => {
  assert.deepEqual(connectingText({ name: 'GUN-A-3D4F', attempt: 1, of: 5 }),
    { head: 'Connecting to GUN-A-3D4F…', line: 'Keep the gun close and switched on.' });
  assert.equal(connectingText({ name: 'GUN-A-3D4F', attempt: 2, of: 5 }).line, 'Retrying (2 of 5)…');
  const f = connectingText({ name: 'GUN-A-3D4F', attempt: 5, of: 5, failed: true });
  assert.equal(f.head, 'Could not connect to GUN-A-3D4F');
  assert.match(f.line, /Scan again/);
});

// Review 2026-09-19: armed/live retries forever (BrxLink.unbounded()), so `attempt` can run past the `of`
// the connect started with. The picker must never print a stale bound like "Retrying (7 of 5)…".
test('connectingText: an unbounded retry (of: null) reads "Retrying…", never a stale count', () => {
  assert.equal(connectingText({ name: 'GUN-A-3D4F', attempt: 7, of: null }).line, 'Retrying…');
  assert.equal(connectingText({ name: 'GUN-A-3D4F', attempt: 2, of: null }).line, 'Retrying…');
});

test('connectingText: a bounded attempt past its own `of` still clamps, belt and braces', () => {
  assert.equal(connectingText({ name: 'GUN-A-3D4F', attempt: 7, of: 5 }).line, 'Retrying (5 of 5)…');
});

test('connect() reports every attempt, so the picker can show "Retrying (2 of 5)…"', async ctx => {
  const settle = useClock(ctx);
  const g = gun({ fails: 2 });
  const link = new BrxLink({ ble: g.ble });
  ctx.after(() => link.disconnect());
  const seen = [];
  const p = link.connect('A', 'GUN-A-3D4F', { onAttempt: (i, of) => seen.push(`${i}/${of}`) });
  await settle(5000);
  await p;
  assert.deepEqual(seen, ['1/5', '2/5', '3/5']);
  assert.equal(link.connected, true);
});

test('the first connect after a scan stop waits for the stop to complete, then SCAN_SETTLE_MS', async ctx => {
  const settle = useClock(ctx);
  const g = gun({ stopMs: 120 });
  const link = new BrxLink({ ble: g.ble });
  ctx.after(() => link.disconnect());
  await link.scan(() => {});
  const stop = link.stopScan();          // the picker does not wait for the stop before it calls connect
  const p = link.connect('A', 'GUN-A-3D4F');
  await settle(2000);
  await stop; await p;
  assert.equal(g.stops.length, 1);
  assert.ok(g.connects[0] - g.stops[0] >= SCAN_SETTLE_MS,
    `the connect started ${g.connects[0] - g.stops[0]} ms after the stop completed, not ${SCAN_SETTLE_MS}`);
  assert.ok(g.connects[0] - g.stops[0] < SCAN_SETTLE_MS + 50, 'the settle gap is applied once, not stacked');
});

test('a connect with no scan stop before it, and a reconnect after a drop, do not wait', async ctx => {
  const settle = useClock(ctx);
  const g = gun();
  const link = new BrxLink({ ble: g.ble });
  ctx.after(() => link.disconnect());
  const t0 = Date.now();
  const p = link.connect('A', 'GUN-A-3D4F');
  await settle(20); await p;
  assert.ok(g.connects[0] - t0 < 20, `a connect with no scan before it waited ${g.connects[0] - t0} ms`);
  // A scan (the beacon watch, say) stops while the gun is linked, then the gun drops the link.
  await link.scan(() => {}); link.stopScan();
  await settle(60);
  const tDrop = Date.now();
  g.drop();
  await settle(100);
  assert.equal(g.connects.length, 2, 'the reconnect did not run');
  assert.ok(g.connects[1] - tDrop < 50, `the reconnect waited ${g.connects[1] - tDrop} ms: the settle gap must not slow a reconnect`);
});

test('app.js onPick: the connecting state runs from the tap, per attempt, and to the end', () => {
  const src = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const pick = src.slice(src.indexOf('onPick: async'), src.indexOf('onUtility:'));
  assert.ok(pick.length > 0, 'onPick is gone from app.js -- FIX this guard, do not delete it');
  const firstAwait = pick.indexOf('await ');
  const shown = pick.indexOf('hud.setConnecting({ name, attempt: 1');
  assert.ok(shown > 0 && shown < firstAwait, 'the connecting state must show before the first await (the tap)');
  assert.match(pick, /onAttempt: \(i, of\) => \{ hud\.setConnecting\(\{ name, attempt: i, of: link\.unbounded\(\) \? null : of, failed: false \}\)/,
    'each attempt must update the attempt count, and clear `of` once the loop is unbounded (review 2026-09-19: "Retrying (7 of 5)…")');
  assert.match(pick, /hud\.setConnecting\(failed \? \{[^}]*failed: true \} : null\)/, 'a failure keeps a failed state on screen; a link clears it');
  const setGun = src.slice(src.indexOf('async function openPicker'), src.indexOf('onScanAgain:'));
  assert.match(setGun, /hud\.setConnecting\(null\)/, 'SCAN AGAIN must clear the failed state');
});
