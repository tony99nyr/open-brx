// HUD QA R2-02 (F341): the HUD's own guard behind the engine's. A "gain" whose pools sit above the armed maximum is a
// misread `$PSET` (`$HP,4545,7070`), never a pickup, so `_gain` floats nothing for it. CONTROL: a gain inside the max floats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../src/hud/hud.js';

function floats(st, data) {
  const had = globalThis.document;
  globalThis.document = { createElement: () => ({ className: '', innerHTML: '' }) };
  const swapped = [];
  try { Hud.prototype._gain.call({ _swap: (k, el) => swapped.push(el), h: {} }, st, { kind: 'gain', data }); }
  finally { globalThis.document = had; }
  return swapped;
}
const st = { phase: 'live', alive: true, maxHp: 45, maxArmor: 70, maxShield: 0 };

test('R2-02: a gain above the armed maximum floats nothing (armour 7070 of 70, hp 4545 of 45)', () => {
  assert.deepEqual(floats(st, { pool: 'armor', amount: 7000, hp: 45, armor: 7070, shield: 0 }), []);
  assert.deepEqual(floats(st, { pool: 'health', amount: 4500, hp: 4545, armor: 70, shield: 0 }), []);
});

test('R2-02 CONTROL: a gain up to the maximum floats', () => {
  const out = floats(st, { pool: 'armor', amount: 30, hp: 45, armor: 70, shield: 0 });
  assert.equal(out.length, 1);
  assert.match(out[0].innerHTML, /\+30/);
  assert.match(out[0].innerHTML, /ARMOUR/);
});

test('R2-02 CONTROL: armour granted in a no-armour game is shown (no max to be above)', () => {
  assert.equal(floats({ ...st, maxArmor: 0 }, { pool: 'armor', amount: 20, hp: 45, armor: 20, shield: 0 }).length, 1);
});
