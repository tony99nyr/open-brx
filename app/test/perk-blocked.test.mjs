// F551 (field 2026-10-17): Armor Piercing on a primary without `ap_dmg` blocked the whole push. MC now names the weapons a
// perk cannot ride with (PerkView.blocked_primary / blocked_secondary) and drops such a perk from a stored loadout; the
// phone's picker must not offer it beside those weapons. An absent field hides nothing (an older MC).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../src/hud/hud.js';
import { DEMO_PERKS } from '../src/demo-catalog.js';

const perks = [
  { perk_id: 'armor_piercing', name: 'ARMOR PIERCING', blocked_primary: ['sniper_rifle'], blocked_secondary: ['deagle'] },
  { perk_id: 'quick_switch', name: 'QUICK SWITCH', blocked_primary: [], blocked_secondary: [] },
  { perk_id: 'body_armor', name: 'BODY ARMOR' },   // an older MC: no blocked fields
];
const st = (primary, secondary) => ({
  catalog: { weapons: [], perks },
  policy: { perk: { allowed_perk_ids: perks.map(p => p.perk_id) } },
  loadout: { primary: primary ? { kind: 'weapon', weapon_id: primary } : null, secondary: secondary ? { kind: 'weapon', weapon_id: secondary } : null },
});
const ids = s => Hud.prototype._loRows.call({}, s, 'perk').map(r => r.id);

test('F551: a perk blocked for the current primary or secondary is not offered; others and an older MC are', () => {
  assert.deepEqual(ids(st('assault_rifle', 'usp')), ['armor_piercing', 'quick_switch', 'body_armor']);
  assert.deepEqual(ids(st('sniper_rifle', 'usp')), ['quick_switch', 'body_armor'], 'blocked by the primary');
  assert.deepEqual(ids(st('assault_rifle', 'deagle')), ['quick_switch', 'body_armor'], 'blocked by the secondary');
  assert.deepEqual(ids(st(null, null)), ['armor_piercing', 'quick_switch', 'body_armor'], 'nothing picked yet hides nothing');
  assert.deepEqual(ids({ ...st('assault_rifle', 'usp'), pendingPick: { slot: 'primary', kind: 'weapon', id: 'sniper_rifle' } }), ['quick_switch', 'body_armor'],
    'a primary pick still waiting for its ack counts');
});

// Honest pickers (Tony 2026-10-25): with a perk held, the weapon tabs offer only the weapons it can ride with, so a
// player never picks a pair MC would clear. MC's lists decide (the catalogue), never a hand list.
const weapons = ['assault_rifle', 'sniper_rifle', 'usp', 'deagle'].map(weapon_id => ({ weapon_id, name: weapon_id }));
const wst = (perk, extra = {}) => ({
  catalog: { weapons, perks },
  policy: { primary: { allowed_ids: weapons.map(w => w.weapon_id) }, secondary: { allowed_weapon_ids: weapons.map(w => w.weapon_id), kinds: ['weapon'] },
    perk: { allowed_perk_ids: perks.map(p => p.perk_id) } },
  loadout: { primary: { kind: 'weapon', weapon_id: 'assault_rifle' }, secondary: null, perk: perk ? { kind: 'perk', perk_id: perk } : null },
  ...extra,
});
const wids = (s, tab) => Hud.prototype._loRows.call({}, s, tab).map(r => r.id);

test('honest pickers: a held perk takes the weapons it cannot ride with out of the primary and secondary tabs', () => {
  assert.deepEqual(wids(wst('armor_piercing'), 'primary'), ['assault_rifle', 'usp', 'deagle'], 'AP held: no sniper as primary');
  assert.deepEqual(wids(wst('armor_piercing'), 'secondary'), ['assault_rifle', 'sniper_rifle', 'usp'], 'AP held: no deagle as secondary');
  assert.deepEqual(wids(wst('quick_switch'), 'primary'), weapons.map(w => w.weapon_id), 'a perk that blocks nothing hides nothing');
  assert.deepEqual(wids(wst('body_armor'), 'primary'), weapons.map(w => w.weapon_id), 'an older MC (no lists) hides nothing');
  assert.deepEqual(wids(wst(null), 'primary'), weapons.map(w => w.weapon_id), 'no perk hides nothing');
  assert.deepEqual(wids(wst(null, { pendingPick: { slot: 'perk', kind: 'perk', id: 'armor_piercing' } }), 'primary'), ['assault_rifle', 'usp', 'deagle'],
    'a perk pick still waiting for its ack counts');
  assert.deepEqual(wids(wst('armor_piercing', { pendingPick: { slot: 'perk', kind: 'none', id: null } }), 'primary'), weapons.map(w => w.weapon_id),
    'a pending NONE on the perk frees the weapons');
});

test('Extended Mags shows the resolved gain for each health preset', () => {
  const perk = DEMO_PERKS.find(p => p.perk_id === 'extended_mags');
  const state = { catalog: { perks: [perk] }, policy: { perk: { allowed_perk_ids: ['extended_mags'] } }, loadout: {} };
  const gain = health => Hud.prototype._loRows.call({}, { ...state, config: { health } }, 'perk')[0].row.gain[0];
  assert.equal(gain({ max_armor: 75, max_shield: 0 }), '×2 MAG');
  assert.equal(gain({ max_armor: 0, max_shield: 100 }), '×1.5 MAG');
  assert.equal(gain({ max_armor: 0, max_shield: 0 }), '×2 MAG');
});
