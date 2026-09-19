// F265, bench 2026-09-18: a bound phone can stop receiving score pushes while `wsState` still reads
// `bound`. Bench found a 161 s stale board labelled LIVE. `_boardAge`/`_boardStale` are pure functions
// of `st` (plus `Date.now()`), so they are called against `Hud.prototype` here: building a real `Hud`
// needs a DOM tree in its constructor, which this test does not want.
//
// Polish review #2 (2026-09-18): `_boardStale`'s freshness clock moved from `st.scoreAt` (the last
// score CHANGE) to `st.lastMcMsgAt` (the phone's own clock time of the last message heard from MC,
// engine.js -- `time_res` included, which MC answers every ~5 s whether or not the match is eventful).
// `scoreAt` still drives `_boardAge`'s "AS OF Ns AGO" wording (the age of the DATA), so both fields
// are set in every case below, usually to the same instant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../src/hud/hud.js';

const boardAge = st => Hud.prototype._boardAge.call(Hud.prototype, st);
const boardStale = st => Hud.prototype._boardStale.call(Hud.prototype, st);

test('F265: a bound phone with a fresh score snapshot reads LIVE', () => {
  const st = { scoreAt: Date.now(), lastMcMsgAt: Date.now(), wsState: 'bound' };
  assert.equal(boardAge(st), 'LIVE');
  assert.equal(boardStale(st), false);
});

test('F265: a bound phone that has heard nothing from MC in a long time does not claim LIVE', () => {
  // The bench case: wsState still bound, but the last MESSAGE (not just the last score) was 161 s ago.
  const st = { scoreAt: Date.now() - 161_000, lastMcMsgAt: Date.now() - 161_000, wsState: 'bound' };
  assert.equal(boardAge(st), 'AS OF 2 MIN AGO');
  assert.equal(boardStale(st), true);
});

test('F265 polish review #2: a quiet 5 s with no kills (no score push) must not read as stale, as long as MC keeps talking', () => {
  // The bug this fix closes: MC pushes a score only on change, so a normal quiet spell with nobody
  // dying left `scoreAt` old even on a perfectly healthy socket. `lastMcMsgAt` (a `time_res` reply,
  // say) is recent, and that is what must decide LIVE now.
  const st = { scoreAt: Date.now() - 9000, lastMcMsgAt: Date.now() - 500, wsState: 'bound' };
  assert.equal(boardStale(st), false, 'a recent message from MC must read LIVE despite an old score push');
  assert.equal(boardAge(st), 'LIVE');
});

test('F265 polish review #2: MC has gone quiet for longer than its own heartbeat period reads stale even with a recent-ish score', () => {
  const st = { scoreAt: Date.now() - 3000, lastMcMsgAt: Date.now() - 20_000, wsState: 'bound' };
  assert.equal(boardStale(st), true, 'no message from MC in 20 s (well past its ~5 s time_res cadence) must read stale');
});

test('F265: an unbound phone always shows the age, never LIVE', () => {
  const st = { scoreAt: Date.now() - 5000, lastMcMsgAt: Date.now() - 5000, wsState: 'connecting' };
  assert.equal(boardAge(st), 'AS OF 5 S AGO');
  assert.equal(boardStale(st), true);
});

test('F265: no scores yet reads as such, bound or not', () => {
  assert.equal(boardAge({ scoreAt: null, lastMcMsgAt: Date.now(), wsState: 'bound' }), 'NO SCORES YET');
  assert.equal(boardAge({ scoreAt: null, lastMcMsgAt: Date.now(), wsState: 'connecting' }), 'NO SCORES YET');
});
