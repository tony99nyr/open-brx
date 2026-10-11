// pct, clipOf and heatPct (shared.js), and the reload and switch bars that now clamp at 0 as well as at 100.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pct, clipOf, heatPct, hpPct, armorPct, magText } from '../src/hud/shared.js';
import { loadStates, renderDom } from './hud-html-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('pct rounds and stays within 0..100', () => {
  assert.equal(pct(1, 3), 33);
  assert.equal(pct(2, 3), 67);
  assert.equal(pct(5, 5), 100);
  assert.equal(pct(7070, 70), 100);
  assert.equal(pct(-5, 10), 0);
  assert.equal(pct(0, 10), 0);
});

test('clipOf is the magazine, else the ammo, never below 1', () => {
  assert.equal(clipOf({ mag: 30, ammo: 4 }), 30);
  assert.equal(clipOf({ mag: 0, ammo: 7 }), 7);
  assert.equal(clipOf({ ammo: 0 }), 1);
});

test('heatPct rounds and stays within 0..100', () => {
  assert.equal(heatPct({ heat: 41.6 }), 42);
  assert.equal(heatPct({}), 0);
  assert.equal(heatPct({ heat: 250 }), 100);
  assert.equal(heatPct({ heat: -3 }), 0);
});

test('the bars that use pct keep their old answers', () => {
  assert.equal(hpPct({ maxHp: 0, hp: 5 }), 0);
  assert.equal(hpPct({ maxHp: 45, hp: 4545 }), 100);
  assert.equal(armorPct({ maxArmor: 0, armor: 10 }, 20), 50);
  assert.equal(armorPct({ maxArmor: 0, armor: 10 }, 0), 0);
  assert.equal(magText({ roundsPerCharge: 10, ammo: 5, mag: 20 }), '25');
  assert.equal(magText({ roundsPerCharge: 10, ammo: 5 }), '100');
});

const fixtures = loadStates(path.join(root, 'test/fixtures/hud-html-states.json'));
const bar = (fixture, takeover, patch, id) => {
  const state = { ...fixture.state, ...patch, presented: { ...fixture.state.presented, takeover: { kind: takeover } } };
  const [out] = renderDom({ ...fixture, state });
  const m = new RegExp(`id="${id}" style="width:([^"]*)"`).exec(out.overlay);
  assert.ok(m, `${id} not drawn`);
  return m[1];
};

test('a negative reload or switch progress draws an empty bar, not a negative width', () => {
  const f = fixtures['live-reload'];
  assert.equal(bar(f, 'reload', { reloadMs: 700, reloadTotalMs: 1400, reloadOverrun: false }, 'rlbar'), '50%');
  assert.equal(bar(f, 'reload', { reloadMs: -500, reloadTotalMs: 1400, reloadOverrun: false }, 'rlbar'), '0%');
  assert.equal(bar(f, 'switch', { switchingMs: 2000, switchWindowMs: 850 }, 'swbar'), '100%');
  assert.equal(bar(f, 'switch', { switchingMs: -100, switchWindowMs: 850 }, 'swbar'), '0%');
});
