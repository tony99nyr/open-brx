// F265, bench 2026-09-18: a bound phone can stop receiving score pushes while `wsState` still reads
// `bound`. Bench found a 161 s stale board labelled LIVE. `_boardAge`/`_boardStale` are pure functions
// of `st` (plus `Date.now()`), so they are called against `Hud.prototype` here: building a real `Hud`
// needs a DOM tree in its constructor, which this test does not want.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../src/hud/hud.js';

const boardAge = st => Hud.prototype._boardAge.call(Hud.prototype, st);
const boardStale = st => Hud.prototype._boardStale.call(Hud.prototype, st);

test('F265: a bound phone with a fresh score snapshot reads LIVE', () => {
  const st = { scoreAt: Date.now(), wsState: 'bound' };
  assert.equal(boardAge(st), 'LIVE');
  assert.equal(boardStale(st), false);
});

test('F265: a bound phone with a stale score snapshot does not claim LIVE', () => {
  // The bench case: wsState still bound, but the last push was 161 s ago.
  const st = { scoreAt: Date.now() - 161_000, wsState: 'bound' };
  assert.equal(boardAge(st), 'AS OF 2 MIN AGO');
  assert.equal(boardStale(st), true);
});

test('F265: an unbound phone always shows the age, never LIVE', () => {
  const st = { scoreAt: Date.now() - 5000, wsState: 'connecting' };
  assert.equal(boardAge(st), 'AS OF 5 S AGO');
  assert.equal(boardStale(st), true);
});

test('F265: no scores yet reads as such, bound or not', () => {
  assert.equal(boardAge({ scoreAt: null, wsState: 'bound' }), 'NO SCORES YET');
  assert.equal(boardAge({ scoreAt: null, wsState: 'connecting' }), 'NO SCORES YET');
});
