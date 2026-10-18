// F400 desk fix (docs/spec/powerups.md "The switch card" decision 7): a pickup switch's ACTIVE bubble must read
// CONFIRMED, never READY (that is ALT's own "we guessed, the window ran out" word) nor CONFIRMED BY YOUR GUN
// (that mechanism -- the gun's echo -- never runs for a pickup: powerup-player.js `_switchCard` sets `switching.pu` precisely so
// `am.onAmmo`'s confirm-by-shot code skips it). Same lightweight call-the-prototype-directly pattern as
// hud-gain-guard.test.mjs: no DOM, a fake `document.createElement` and a `_swap` that just records the node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../src/hud/hud.js';

function switched(st, data) {
  const had = globalThis.document;
  globalThis.document = { createElement: () => ({ className: '', innerHTML: '' }) };
  const swapped = [];
  const fake = { _slotItem: Hud.prototype._slotItem, _wtile: Hud.prototype._wtile, _swap: (k, el) => swapped.push(el) };
  try { Hud.prototype._switched.call(fake, st, { kind: 'switched', data }); }
  finally { globalThis.document = had; }
  return swapped[0];
}
const subText = el => { const m = el.innerHTML.match(/<span class="s">([^<]*)<\/span>/); return m ? m[1] : null; };

test('F400: a pickup switch (data.pu) always reads CONFIRMED on the ACTIVE bubble, whatever `assumed` is', () => {
  const st = { loadout: { primary: { kind: 'weapon', weapon_id: 'assault_rifle', name: 'ASSAULT RIFLE' } },
    powerup: { held: { slot: 2, weapon_id: 'rocket_launcher', name: 'ROCKETS', color: 3, left: 2 } } };
  assert.equal(subText(switched(st, { slot: 2, assumed: true, pu: true })), 'CONFIRMED');
});

test('F400 CONTROL: an ALT swap (no pu flag) keeps its own READY / CONFIRMED BY YOUR GUN wording', () => {
  const st = { loadout: { primary: { kind: 'weapon', weapon_id: 'assault_rifle', name: 'ASSAULT RIFLE' },
    secondary: { kind: 'weapon', weapon_id: 'smg', name: 'SMG' } } };
  assert.equal(subText(switched(st, { slot: 1, assumed: true })), 'READY');
  assert.equal(subText(switched(st, { slot: 1, assumed: false })), 'CONFIRMED BY YOUR GUN');
});

// Field 2026-10-17 (report E10): the gun's slot report moved the trigger; the card says so instead of a silent change.
test('F542 E10: a correction from the gun (data.gunWas) reads GUN WAS ON over the weapon; a plain swap keeps ACTIVE', () => {
  const st = { loadout: { primary: { kind: 'weapon', weapon_id: 'usp', name: 'USP' },
    secondary: { kind: 'weapon', weapon_id: 'deagle', name: 'DESERT EAGLE' } } };
  const el = switched(st, { slot: 0, gunWas: true });
  assert.match(el.innerHTML, /<span class="wl">GUN WAS ON<\/span><span class="wn">USP<\/span>/);
  assert.equal(subText(el), 'CONFIRMED BY YOUR GUN');
  assert.match(switched(st, { slot: 1, assumed: true }).innerHTML, /<span class="wl">ACTIVE ✓<\/span>/);
});
