// T2-B item 3: the hidden utility-mode door must not open from a burst of accidental taps alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTapHoldGate } from '../src/tapgate.js';
const APP_JS = new URL('../src/app.js', import.meta.url);

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

// ---------------- the guard: app.js must actually WIRE the hold gate, not the old bare tap-count ----------------
test('T2-B guard: app.js uses createTapHoldGate for the utility-mode door, not a bare 7-tap count', () => {
  const src = readFileSync(APP_JS, 'utf8');
  assert.match(src, /import \{ createTapHoldGate \} from '\.\/tapgate\.js'/, 'app.js must import the extracted gate');
  const i = src.indexOf("pointerdown'", src.indexOf('utility mode'));
  assert.ok(i > 0, 'the tap-gesture listener block is gone from app.js -- FIX this guard, do not delete it');
  const block = src.slice(Math.max(0, i - 400), i + 600);
  assert.match(block, /createTapHoldGate\(\)/, 'the listener must be backed by the pure gate, not inline tap counting');
  assert.match(block, /gate\.held\(/, 'entry must be gated on held(), not just a tap count reaching 7');
  assert.match(block, /setTimeout\([\s\S]*?,\s*1500\)/, 'the hold duration is 1.5s per the brief');
  assert.doesNotMatch(block, /taps\.length >= 7[^)]*switchRole/, 'the old immediate-fire-on-7-taps path must be gone');
});
