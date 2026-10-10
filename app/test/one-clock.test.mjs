// ARCH-1 (review 2026-10-10): the engine stamps every time it publishes on ITS clock (`now()`: the phone clock plus MC's
// offset), and the HUD used to read those stamps against the phone clock (`Date.now()`). With an offline field laptop
// MC's offset can be seconds, so feed rows lingered or vanished early, BOARD "AS OF" ages were wrong, and the shield
// creep drew from the wrong start. `state().clockSkew` is the offset; hud/shared.js `engineNow(st)` reads the engine clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineNow } from '../src/hud/shared.js';
import { meterModel } from '../src/hud/shieldmeter.js';
import { _boardAge } from '../src/hud/score.js';
import { LANE_FEED_MS } from '../src/lanes.js';
import { loadStates, renderDom } from './hud-html-harness.mjs';

const SKEWS = [5000, -5000];
const withNow = (t, fn) => { const real = Date.now; Date.now = () => t; try { return fn(); } finally { Date.now = real; } };

test('ARCH-1: state() publishes clockSkew = the engine clock minus the phone clock', async () => {
  const { Engine } = await import('../src/engine.js');
  const { mkStorage } = await import('./_helpers.mjs');
  const wall = 2_000_000_000_000;
  const eng = new Engine({ writer: () => {}, storage: mkStorage(), now: () => wall + 5000, wallNow: () => wall, log: () => {} });
  assert.equal(eng.state().clockSkew, 5000);
  assert.equal(withNow(wall, () => engineNow(eng.state())), wall + 5000);
  assert.equal(withNow(wall, () => engineNow({})), wall, 'a state with no skew (an old fixture) reads the phone clock');
});

test('ARCH-1: the BOARD age is measured on the engine clock', () => {
  for (const skew of SKEWS) {
    const phone = 2_000_000_000_000, scoreAt = phone + skew - 30_000;   // MC stamped the score 30 s ago, on its clock
    const age = withNow(phone, () => _boardAge.call({ _boardStale: () => true }, { scoreAt, clockSkew: skew }));
    assert.equal(age, 'AS OF 30 S AGO', `skew ${skew}`);
  }
});

test('ARCH-1: the shield meter reads the engine clock by default', () => {
  for (const skew of SKEWS) {
    const phone = 2_000_000_000_000, quietAt = phone + skew - 1000;   // the shield went quiet 1 s ago, engine clock
    const st = { phase: 'live', alive: true, shield: 0, maxShield: 70, clockSkew: skew,
      shieldRegen: { on: true, paused: false, charging: false, gaveUp: false, down: false, delayMs: 5000, quietAt } };
    const m = withNow(phone, () => meterModel(st));
    assert.deepEqual(m, meterModel(st, phone + skew), `skew ${skew}: the default is the engine clock`);
    assert.notDeepEqual(m, meterModel(st, phone), `skew ${skew}: and the phone clock would draw it differently`);
  }
});

test('ARCH-1: a feed row leaves the lanes on the engine clock, not the phone clock', () => {
  const states = loadStates(new URL('./fixtures/hud-html-states.json', import.meta.url).pathname);
  const fx = states['live-alert'];
  const feed = fx.state.presented.lanes.feed[0];
  for (const skew of SKEWS) {
    const gonePhone = feed.at - skew + LANE_FEED_MS + 400;   // the engine says the row is LANE_FEED_MS + 400 ms old: gone
    const [gone] = renderDom({ ...fx, now: gonePhone, state: { ...fx.state, clockSkew: skew } });
    assert.ok(!gone.lanes.includes(`data-kind="${feed.kind}"`), `skew ${skew}: the row is gone on the engine clock`);
    const [shown] = renderDom({ ...fx, now: feed.at - skew + 100, state: { ...fx.state, clockSkew: skew } });
    assert.ok(shown.lanes.includes(`data-kind="${feed.kind}"`), `skew ${skew}: control, a 100 ms old row is drawn`);
  }
});

// DRY-5 (the half with no visible change): the HUD's own LOW line lived in two places (live.js, the hud.js render key).
test('DRY-5: the HUD reads its LOW line from one helper', async () => {
  const { hpLow, HP_LOW_FRACTION } = await import('../src/hud/shared.js');
  assert.equal(HP_LOW_FRACTION, 0.25);
  assert.equal(hpLow({ hp: 25, maxHp: 100 }), true);
  assert.equal(hpLow({ hp: 26, maxHp: 100 }), false);
  const { readFileSync } = await import('node:fs');
  for (const f of ['live.js', 'hud.js']) {
    const src = readFileSync(new URL(`../src/hud/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /maxHp \* \.25/, `${f} reads hpLow, not its own copy`);
  }
});
