import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Clock } from '../src/transport/clock.js';
import { CLOCK_STEP_MS } from '../src/transport/contract.gen.js';

// F477: a phone whose wall clock stepped while OFFLINE must not walk the step off by EWMA on reconnect.
// One round trip with a fixed rtt: the server clock reads `server = node + trueOff` at the midpoint.
const rt = (c, trueOff, rtt = 20, t0 = 1_000_000) => c.sample(t0, t0 + rtt / 2 + trueOff, t0 + rtt);
const synced = (off) => { const c = new Clock(); for (let i = 0; i < 8; i++) rt(c, off); return c; };

test('F477: a +60 s step while offline snaps within the reconnect burst', () => {
  const c = synced(100);
  assert.equal(Math.round(c.offset), 100);
  c.newBurst();
  for (let i = 0; i < 5; i++) rt(c, 100 + 60_000);
  assert.equal(Math.round(c.offset), 60_100, 'adopts the burst best, not an EWMA of it');
});

test('F477: a 1 s difference stays on the EWMA (no jitter, no snap)', () => {
  assert.ok(1000 < CLOCK_STEP_MS);
  const c = synced(100);
  c.newBurst();
  for (let i = 0; i < 5; i++) rt(c, 1100);
  const expect = 100 + 1000 * (1 - 0.8 ** 5);
  assert.ok(Math.abs(c.offset - expect) < 1, `got ${c.offset}, want ${expect}`);
});

test('F477: one slow outlier in the burst does not cause a snap', () => {
  const c = synced(100);
  c.newBurst();
  rt(c, 100); rt(c, 100);
  rt(c, 100 + 8_000, 60);          // a slow sample, wildly off, but rtt under 3x median? 60 < 3*20
  rt(c, 100); rt(c, 100);
  assert.ok(Math.abs(c.offset - 100) < 2_000, `offset ${c.offset}`);
  assert.ok(Math.abs(c.offset - 8_100) > 5_000, 'did not snap to the outlier');
});

test('F477: a snap takes the minimum-rtt sample, not a slow one', () => {
  const c = synced(100);
  c.newBurst();
  rt(c, 60_000 + 100 + 4_000, 55);  // slow and skewed: must not be the one adopted
  for (let i = 0; i < 4; i++) rt(c, 60_100, 20);
  assert.equal(Math.round(c.offset), 60_100);
});
