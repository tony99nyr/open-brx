// F551 (field 2026-10-17): Armor Piercing on a primary without `ap_dmg` blocked the whole push. MC now names the weapons a
// perk cannot ride with (PerkView.blocked_primary / blocked_secondary) and drops such a perk from a stored loadout; the
// phone's picker must not offer it beside those weapons. An absent field hides nothing (an older MC).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../src/hud/hud.js';

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
