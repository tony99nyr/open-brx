// T2-B item 3: the hidden utility-mode door must not open from a burst of accidental taps alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTapHoldGate, installTapHoldDoor } from '../src/tapgate.js';

/** Fire N quick taps (down+up close together), returning the gate. */
function quickTaps(gate, n, start = 0, gapMs = 50) {
  let t = start;
  for (let i = 0; i < n; i++) { gate.down(t); gate.up(); t += gapMs; }
  return t;
}

test('tapgate: 7 rapid taps with no hold never fires, no matter how long you wait afterward', () => {
  const gate = createTapHoldGate();
  const t = quickTaps(gate, 7, 0, 50);
  // Nothing is down any more (every tap released quickly) -- polling held() later must stay false.
  assert.equal(gate.held(t), false);
  assert.equal(gate.held(t + 5000), false);
});

test('tapgate: 6 quick taps then a 1.5s hold on the 7th fires exactly once', () => {
  const gate = createTapHoldGate();
  const t = quickTaps(gate, 6, 0, 50); // t = 300
  gate.down(t);                         // the 7th contact goes down and STAYS down
  assert.equal(gate.held(t + 1000), false, 'not held long enough yet');
  assert.equal(gate.held(t + 1499), false, 'still one ms short');
  assert.equal(gate.held(t + 1500), true, 'held long enough -- fires');
  assert.equal(gate.held(t + 1600), false, 'fires at most once per contact');
});

test('tapgate: releasing the 7th contact before 1.5s cancels it -- re-pressing does not inherit the old hold', () => {
  const gate = createTapHoldGate();
  const t = quickTaps(gate, 6, 0, 50); // t = 300
  gate.down(t);
  gate.up();                            // released early, e.g. an accidental brief 7th tap
  assert.equal(gate.held(t + 1500), false, 'the early release must cancel the hold');
});

test('tapgate: pointercancel (e.g. the OS steals the gesture) also cancels the hold', () => {
  const gate = createTapHoldGate();
  const t = quickTaps(gate, 6, 0, 50);
  gate.down(t);
  gate.cancel();
  assert.equal(gate.held(t + 1500), false);
});

test('tapgate: taps spread past the 3s window never accumulate to a 7th', () => {
  const gate = createTapHoldGate();
  let t = 0;
  for (let i = 0; i < 6; i++) { gate.down(t); gate.up(); t += 600; } // 6 taps over 3000ms -- the window keeps sliding
  gate.down(t);                          // the "7th" is outside the window relative to the earliest taps
  // Only some of the earlier taps survive the window prune; assert the gate did not treat this as the 7th.
  assert.equal(gate.held(t + 1500), false, 'a spread-out sequence must not satisfy the tap count');
});

test('tapgate: after a successful trigger, the history resets -- immediate re-entry needs a fresh 7 taps', () => {
  const gate = createTapHoldGate();
  let t = quickTaps(gate, 6, 0, 50);
  gate.down(t);
  assert.equal(gate.held(t + 1500), true);
  // Right away, a single hold (no preceding 6 taps) must NOT fire again.
  gate.down(t + 1600);
  assert.equal(gate.held(t + 1600 + 1500), false, 'must not fire on a single lingering touch after a reset');
});

// ---------------- behavioral wiring: the same installer app.js puts on the idle stage ----------------
test('T2-B wiring: the installed door requires 6 taps plus a held 7th, and rechecks eligibility', () => {
  const stageListeners = new Map(), releaseListeners = new Map();
  const stage = { addEventListener: (kind, fn) => stageListeners.set(kind, fn) };
  const releaseTarget = { addEventListener: (kind, fn) => releaseListeners.set(kind, fn) };
  let t = 0, timer = null, timerMs = null, entered = 0, eligible = true;
  installTapHoldDoor({
    stage, releaseTarget,
    eligible: () => eligible,
    activate: () => { entered++; },
    now: () => t,
    setTimer: (fn, ms) => { timer = fn; timerMs = ms; return 1; },
    clearTimer: () => { timer = null; },
  });
  const down = () => stageListeners.get('pointerdown')?.();
  const release = kind => releaseListeners.get(kind)?.();

  for (let i = 0; i < 7; i++) { down(); release('pointerup'); t += 50; }
  assert.equal(entered, 0, 'seven quick contacts never enter utility mode');

  for (let i = 0; i < 6; i++) { down(); release('pointerup'); t += 50; }
  down();
  assert.ok(timer, 'the held contact schedules the 1.5 s decision');
  assert.equal(timerMs, 1500);
  t += 1500;
  timer();
  assert.equal(entered, 1, 'the deliberate held seventh contact enters once');

  for (let i = 0; i < 6; i++) { down(); release('pointerup'); t += 50; }
  down();
  eligible = false;
  t += 1500;
  timer();
  assert.equal(entered, 1, 'a link/phase change during the hold cancels entry at fire time');

  eligible = true;
  down();
  t += 1500;
  timer();
  assert.equal(entered, 1, 'eligibility loss resets old taps; one later hold cannot enter');
});

test('T2-B wiring: release outside the stage cancels the pending hold and its stale callback', () => {
  const stageListeners = new Map(), releaseListeners = new Map();
  const stage = { addEventListener: (kind, fn) => stageListeners.set(kind, fn) };
  const releaseTarget = { addEventListener: (kind, fn) => releaseListeners.set(kind, fn) };
  let t = 0, timer = null, entered = 0;
  installTapHoldDoor({
    stage, releaseTarget,
    eligible: () => true,
    activate: () => { entered++; },
    now: () => t,
    setTimer: fn => { timer = fn; return 1; },
    clearTimer: () => { timer = null; },
  });
  for (let i = 0; i < 6; i++) {
    stageListeners.get('pointerdown')();
    releaseListeners.get('pointerup')();
    t += 50;
  }
  stageListeners.get('pointerdown')();
  const staleTimer = timer;
  releaseListeners.get('pointerup')();
  assert.equal(timer, null, 'window-level release clears the live timer');
  t += 1500;
  staleTimer();
  assert.equal(entered, 0, 'even an already-queued callback cannot activate after release');
});
