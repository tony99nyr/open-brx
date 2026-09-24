// S59 Low: a stun freezes the shield meter's delay creep where it stood (`fx.dl`). A hit during the stun restamps the
// engine's `quietAt`, so the delay starts over; the frozen creep must not keep its old width.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meterHtml } from '../src/hud/shieldmeter.js';

const st = quietAt => ({ phase: 'live', alive: true, shield: 0, maxShield: 105,
  shieldRegen: { on: true, paused: true, charging: false, gaveUp: false, down: true, delayMs: 5000, quietAt } });
const creep = html => (html.match(/class="svdly" data-k="dl" style="--w:([\d.]+)%"/) || [])[1];

test('a frozen creep holds its width while quietAt is the same (CONTROL)', () => {
  const fx = { dl: 0.4, dlq: 1000 };
  assert.equal(creep(meterHtml(st(1000), fx, 3000)), '40');
});

test('a hit during the stun (a new quietAt) clears the freeze: the creep starts over from nothing', () => {
  const fx = { dl: 0.4, dlq: 1000 };
  assert.equal(creep(meterHtml(st(2500), fx, 3000)), '0');
});
