// Polish round 1 (H1): the player advert's restart gate. The old path ran the throttle's `published()` BEFORE the
// plugin's start and compared team/state/value only, so a failed start, a stop, or a new game byte / player id could
// freeze the advert in EVERY game with stations. The gate compares the whole UUID and records a start only once it worked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeUuid, AdvertGate, ADVERT_VALUE_MIN_MS, ADVERT_START_MIN_MS, ADVERT_FAIL_BACKOFF_MS } from '../src/beacon.js';

const u = (o = {}) => encodeUuid({ role: 'player', id: 7, team: 1, state: 1, value: 0, game: 9, ...o });

test('(a) a start that failed is retried after the back-off, not on the next 250 ms tick', () => {
  const g = new AdvertGate();
  assert.equal(g.due(u(), 0), 'start');
  g.failed('start', 0);
  assert.equal(g.due(u(), 250), null, 'F331: no retry every 250 ms after a failure');
  assert.equal(g.due(u(), ADVERT_FAIL_BACKOFF_MS - 1), null);
  assert.equal(g.due(u(), ADVERT_FAIL_BACKOFF_MS), 'start', 'nothing was recorded, so the same advert is due again');
  assert.equal(g.due(null, 250), 'stop', 'and a stop is due at once: the radio may still carry the previous advert');
  g.started(u(), ADVERT_FAIL_BACKOFF_MS);
  assert.equal(g.due(u(), ADVERT_FAIL_BACKOFF_MS + 500), null);
});

test('F331: state-bit flaps at the range edge restart at most once per ADVERT_START_MIN_MS', () => {
  const g = new AdvertGate();
  let starts = 0;
  for (let t = 0; t < 1000; t += 250) {   // the 250 ms loop, the claim bits flapping every tick
    const want = u({ state: (t / 250) % 2 ? 17 : 1, value: (t / 250) % 2 ? 4 : 0 });
    if (g.due(want, t) === 'start') { g.started(want, t); starts++; }
  }
  assert.ok(starts <= Math.floor(1000 / ADVERT_START_MIN_MS), `at most one start per ${ADVERT_START_MIN_MS} ms: ${starts} in 1 s`);
  assert.ok(ADVERT_START_MIN_MS >= 300 && ADVERT_FAIL_BACKOFF_MS >= 1000);
  // CONTROL: the first start of all is never held
  assert.equal(new AdvertGate().due(u(), 0), 'start');
});

test('(b) after a stop, the same advert starts again', () => {
  const g = new AdvertGate();
  g.started(u(), 0);
  assert.equal(g.due(null, 100), 'stop');
  g.stopped();
  assert.equal(g.due(null, 200), null, 'nothing to stop twice');
  assert.equal(g.due(u(), 300), 'start');
  // a stop that failed is retried, never forgotten
  g.started(u(), 300); g.failed('stop');
  assert.equal(g.due(null, 400), 'stop');
});

test('(c) a new game byte or player id with the same team/state/value is published', () => {
  const g = new AdvertGate();
  g.started(u(), 0);
  assert.equal(g.due(u({ game: 10 }), 5000), 'start');
  assert.equal(g.due(u({ id: 8 }), 5000), 'start');
});

test('a value-only change (the claimed station id) is held to one restart per interval; a state change is not', () => {
  const g = new AdvertGate();
  g.started(u({ state: 17, value: 4 }), 0);
  assert.equal(g.due(u({ state: 17, value: 5 }), ADVERT_VALUE_MIN_MS - 1), null);
  assert.equal(g.due(u({ state: 17, value: 5 }), ADVERT_VALUE_MIN_MS), 'start');
  assert.equal(g.due(u({ state: 49, value: 4 }), ADVERT_START_MIN_MS - 1), null, 'F331: the start floor holds a state change too');
  assert.equal(g.due(u({ state: 49, value: 4 }), ADVERT_START_MIN_MS), 'start', 'claim_ready goes out after the floor, not the 1 s value throttle');
});
