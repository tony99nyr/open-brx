// The beacon watch (scanwatch.js). Playtest 2026-09-13: the Pixel 5 ran 8 scan stops and 8 starts a second,
// because the restart stamp was written only after the slow bridge answered, and restarts overlapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BeaconWatch, RESCAN_DOWN_MS, RESCAN_IDLE_MS } from '../src/scanwatch.js';

/** A link whose every scan call takes `lag` ms of fake time to settle, like a starved Capacitor bridge. */
function rig({ failStart = false } = {}) {
  let clock = 1_000_000; const pending = []; const calls = []; let inFlight = 0, maxInFlight = 0;
  const slow = (name, fail) => new Promise((res, rej) => {
    calls.push(name); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    pending.push(() => { inFlight--; fail ? rej(new Error('scanning too frequently')) : res(); });
  });
  const link = { scan: () => slow('start', failStart), stopScan: () => slow('stop', false) };
  const watch = new BeaconWatch({ link, now: () => clock });
  const turn = () => new Promise(r => setImmediate(r));
  const flush = async () => { await turn(); while (pending.length) { pending.shift()(); await turn(); } };
  return { watch, calls, flush, adv: ms => { clock += ms; }, get maxInFlight() { return maxInFlight; } };
}
const live = (alive = true) => ({ phase: 'live', alive, respawnType: 'scanner' });

test('a slow bridge never stacks restarts: one scan operation at a time', async () => {
  const r = rig();
  r.watch.tick(live()); await r.flush();           // open
  r.adv(RESCAN_IDLE_MS);                           // a restart is due
  for (let i = 0; i < 20; i++) { r.watch.tick(live()); r.adv(1000); }   // 20 ticks while the bridge answers nothing
  await r.flush();
  r.adv(1000); r.watch.tick(live()); await r.flush();   // the stamp was taken before the await: nothing is overdue now
  assert.equal(r.maxInFlight, 1, 'a second scan call must never overlap the first');
  assert.deepEqual(r.calls, ['start', 'stop', 'start'], 'exactly one restart, not one per tick');
});

test('the scan is open only in a match: not before ARMED, and closed after the match ends', async () => {
  const r = rig();
  for (const phase of ['idle', 'connected', 'kitted', 'lobby']) { r.watch.tick({ phase, alive: true }); await r.flush(); }
  assert.deepEqual(r.calls, [], 'no reader needs station adverts outside a match');
  r.watch.tick({ phase: 'armed', alive: true }); await r.flush();
  assert.equal(r.watch.open, true);
  r.watch.tick({ phase: 'kitted', alive: true }); await r.flush();
  assert.equal(r.watch.open, false);
  assert.deepEqual(r.calls, ['start', 'stop']);
});

test('the gun picker owns the radio: no beacon start while it is open', async () => {
  const r = rig();
  r.watch.tick(live(), { pickerOpen: true }); await r.flush();
  assert.deepEqual(r.calls, []);
});

test('a refused start retries on the down cadence, not every tick', async () => {
  const r = rig({ failStart: true });
  for (let i = 0; i < 10; i++) { r.watch.tick(live()); await r.flush(); r.adv(1000); }
  assert.equal(r.calls.filter(c => c === 'start').length, 2, `10 s of ticks: a start at 0 s and one at ${RESCAN_DOWN_MS / 1000} s`);
});

test('going down kicks one immediate restart, then the 7 s cadence', async () => {
  const r = rig();
  r.watch.tick(live()); await r.flush();
  r.adv(1000); r.watch.tick(live(false)); await r.flush();
  assert.deepEqual(r.calls, ['start', 'stop', 'start']);
  r.adv(1000); r.watch.tick(live(false)); await r.flush();
  assert.equal(r.calls.length, 3, 'no second kick a second later');
  r.adv(RESCAN_DOWN_MS); r.watch.tick(live(false)); await r.flush();
  assert.equal(r.calls.length, 5);
});
