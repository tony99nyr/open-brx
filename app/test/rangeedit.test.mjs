// F365 / contracts A67: the on-station range edit's rule and report (app/src/rangeedit.js), on a fake clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RangeEdits, RANGE_EDITS_MAX, rangeHoldMs, RANGE_HOLD_MS, RANGE_OVERRIDE_HOLD_MS, wireAge } from '../src/rangeedit.js';
import { createTapHoldGate } from '../src/tapgate.js';

/** A RangeEdits on a shared fake store and a fake wall + monotonic clock. `restart()` gives a fresh instance on the
 *  same store with no monotonic anchors, as after an app restart. */
function rig(t = 1_000_000) {
  const clock = { wall: t, mono: 500 };
  let stored = null;
  const make = () => new RangeEdits({ load: () => (stored == null ? null : JSON.parse(stored)), save: s => { stored = JSON.stringify(s); },
    now: () => clock.wall, mono: () => clock.mono });
  const step = ms => { clock.wall += ms; clock.mono += ms; };
  return { clock, make, step, get stored() { return stored; } };
}

test('A67: an on-station edit YOUNGER than MC\'s value is kept, and src stays "station"', () => {
  const r = rig(), e = r.make();
  e.edit('threshold', -57, -60);
  r.step(3000);
  assert.equal(e.mcDecides('threshold', 10_000), false, 'MC set its value 10 s ago; the edit is 3 s old: keep the edit');
  assert.equal(e.src('threshold'), 'station');
  assert.equal(e.status().threshold_src, 'station');
  assert.equal(e.status().threshold_edit_age_ms, 3000);
});

test('A67: an edit OLDER than MC\'s value gives way: MC applies, the edit is dropped, src "mc"', () => {
  const r = rig(), e = r.make();
  e.edit('threshold', -57, -60);
  r.step(20_000);
  assert.equal(e.mcDecides('threshold', 5000), true);
  assert.equal(e.src('threshold'), 'mc');
  const st = e.status();
  assert.equal(st.threshold_src, 'mc');
  assert.equal('threshold_edit_age_ms' in st, false, 'no edit age once MC\'s value is the applied one');
});

test('A67: an equal age is not "less": MC applies', () => {
  const r = rig(), e = r.make();
  e.edit('threshold', -57, -60); r.step(4000);
  assert.equal(e.mcDecides('threshold', 4000), true);
});

test('A67: an older MC sends no age: its value applies, as before A67', () => {
  for (const age of [undefined, null, '', 'soon', -5, true]) {
    const r = rig(), e = r.make();
    e.edit('threshold', -57, -60); r.step(10);
    assert.equal(e.mcDecides('threshold', age), true, `age ${JSON.stringify(age)} must apply MC's value`);
  }
  assert.equal(wireAge('1200'), 1200);
});

test('A67: per-field independence: a kept radius edit does not keep the strength, and vice versa', () => {
  const r = rig(), e = r.make();
  e.edit('threshold', -57, -60); r.step(1000);
  assert.equal(e.mcDecides('threshold', 60_000), false, 'the radius edit is newer: kept');
  assert.equal(e.mcDecides('tx_power', 60_000), true, 'no strength edit here: MC\'s tx_power applies');
  assert.equal(e.src('threshold'), 'station');
  assert.equal(e.src('tx_power'), 'mc');
  e.edit('tx_power', 'high', 'low'); r.step(1000);
  assert.equal(e.mcDecides('tx_power', 500), true, 'the strength edit is older than MC\'s: MC wins that field only');
  assert.equal(e.src('threshold'), 'station', 'the radius edit is untouched');
});

test('A67: a restart keeps the edit, its source and its age (wall clock), clamped at 0 if the clock went back', () => {
  const r = rig(), e = r.make();
  e.edit('threshold', -57, -62, { locked: true });
  r.clock.wall += 7000;                 // the app is closed for 7 s: a new run has no monotonic anchor
  const e2 = r.make();
  assert.equal(e2.src('threshold'), 'station');
  assert.equal(e2.editAge('threshold'), 7000);
  assert.equal(e2.pending('threshold'), true, 'never sent: still waiting to sync');
  assert.deepEqual(e2.status().range_edits.map(x => [x.seq, x.from, x.to, x.locked, x.age_ms]), [[1, -57, -62, true, 7000]]);
  r.clock.wall -= 60_000;               // the phone clock jumped backwards
  assert.equal(r.make().editAge('threshold'), 0, 'a negative age is clamped to 0');
});

test('A67: in one run the age is monotonic: a wall-clock jump does not move it', () => {
  const r = rig(), e = r.make();
  e.edit('threshold', -57, -62);
  r.clock.mono += 2500; r.clock.wall -= 3_600_000;
  assert.equal(e.editAge('threshold'), 2500);
});

test('A67 addendum 2: seq persists across a restart and keeps rising', () => {
  const r = rig(), e = r.make();
  e.edit('threshold', -57, -60); e.edit('tx_power', 'high', 'low');
  const e2 = r.make();
  const n = e2.edit('threshold', -60, -64);
  assert.equal(n.seq, 3);
  assert.equal(JSON.parse(r.stored).seq, 3);
});

test('A67 addendum 2: the list is capped at 8, oldest dropped, restated whole on every call', () => {
  const r = rig(), e = r.make();
  for (let i = 0; i < 11; i++) { e.edit('threshold', -50 - i, -51 - i); r.step(100); }
  const a = e.status().range_edits, b = e.status().range_edits;
  assert.equal(a.length, RANGE_EDITS_MAX);
  assert.deepEqual(a.map(x => x.seq), [4, 5, 6, 7, 8, 9, 10, 11], 'oldest first, the three oldest dropped');
  assert.deepEqual(b.map(x => x.seq), a.map(x => x.seq), 'restated, not drained, by a beat');
  assert.equal(a[0].field, 'threshold'); assert.equal(a[7].age_ms, 100);
});

test('A67: offline edits wait to sync until a beat has carried them; then they are reported as sent', () => {
  const r = rig(), e = r.make();
  e.edit('threshold', -57, -60);
  assert.equal(e.pending('threshold'), true);
  e.markSent();
  assert.equal(e.pending('threshold'), false);
  e.edit('tx_power', 'high', 'medium');
  assert.equal(e.pending('tx_power'), true);
  assert.equal(e.pending('threshold'), false);
  assert.equal(r.make().pending('tx_power'), true, 'the sent mark persists too');
});

test('F365: a locked station needs the 5 s hold; the normal 1.5 s hold does not open it', () => {
  assert.equal(RANGE_HOLD_MS, 1500); assert.equal(RANGE_OVERRIDE_HOLD_MS, 5000);
  const locked = createTapHoldGate({ taps: 1, holdMs: rangeHoldMs(true) });
  locked.down(0);
  assert.equal(locked.held(1500), false, 'the normal hold must not override an MC lock');
  assert.equal(locked.held(4999), false);
  assert.equal(locked.held(5000), true);
  const plain = createTapHoldGate({ taps: 1, holdMs: rangeHoldMs(false) });
  plain.down(0); plain.up();
  assert.equal(plain.held(5000), false, 'a tap or a knock (down then up) never opens it');
  plain.down(10);
  assert.equal(plain.held(1509), false); assert.equal(plain.held(1510), true);
});
