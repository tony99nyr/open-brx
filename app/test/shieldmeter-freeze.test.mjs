// S59 Low: a stun freezes the shield meter's delay creep where it stood (`fx.dl`). A hit during the stun restamps the
// engine's `quietAt`, so the delay starts over; the frozen creep must not keep its old width.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meterHtml, meterModel, DELAY_CREEP_MAX } from '../src/hud/shieldmeter.js';

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

// HUD QA R2-04: during the delay the creep grew to 93% of the track while the shield was 0, then snapped to 0.
test('R2-04: the delay creep never draws more than DELAY_CREEP_MAX of the track on an empty shield', () => {
  const live = { ...st(1000), shieldRegen: { ...st(1000).shieldRegen, paused: false } };
  for (const now of [1000, 2500, 4000, 5900, 6000, 9000]) {
    const m = meterModel(live, now);
    assert.equal(m.pct, 0, 'the pool is empty');
    assert.ok(m.delayPct <= DELAY_CREEP_MAX + 1e-9 && m.delayPct <= 0.3, `at ${now - 1000} ms the creep is ${m.delayPct} of the track`);
  }
  assert.ok(meterModel(live, 5900).delayPct > 0.25, 'CONTROL: it still creeps towards its cap');
});
