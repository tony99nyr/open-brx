// Polish round 1 (H1): the player advert's restart gate. The old path ran the throttle's `published()` BEFORE the
// plugin's start and compared team/state/value only, so a failed start, a stop, or a new game byte / player id could
// freeze the advert in EVERY game with stations. The gate compares the whole UUID and records a start only once it worked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeUuid, AdvertGate, ADVERT_VALUE_MIN_MS } from '../src/beacon.js';

const u = (o = {}) => encodeUuid({ role: 'player', id: 7, team: 1, state: 1, value: 0, game: 9, ...o });

test('(a) a start that failed is retried on the next tick', () => {
  const g = new AdvertGate();
  assert.equal(g.due(u(), 0), 'start');
  g.failed('start');
  assert.equal(g.due(u(), 250), 'start', 'nothing was recorded, so the same advert is due again');
  assert.equal(g.due(null, 250), 'stop', 'and a stop is due too: the radio may still carry the previous advert');
  g.started(u(), 250);
  assert.equal(g.due(u(), 500), null);
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
  assert.equal(g.due(u({ state: 49, value: 4 }), 1), 'start', 'claim_ready goes out at once');
});
