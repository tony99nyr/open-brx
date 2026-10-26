// F551 (field 2026-10-17): Armor Piercing on a primary without `ap_dmg` blocked the whole push. MC now names the weapons a
// perk cannot ride with (PerkView.blocked_primary / blocked_secondary) and drops such a perk from a stored loadout; the
// phone's picker must not offer it beside those weapons. An absent field hides nothing (an older MC).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../src/hud/hud.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine.js';
import { mkStorage } from './_helpers.mjs';
import { DEMO_PERKS } from '../src/demo-catalog.js';

const perks = [
  { perk_id: 'armor_piercing', name: 'ARMOR PIERCING', blocked_primary: ['sniper_rifle'], blocked_secondary: ['deagle'] },
  { perk_id: 'fast_hands', name: 'FAST HANDS', blocked_primary: [], blocked_secondary: [] },
  { perk_id: 'body_armor', name: 'BODY ARMOR' },   // an older MC: no blocked fields
];
const st = (primary, secondary) => ({
  catalog: { weapons: [], perks },
  policy: { perk: { allowed_perk_ids: perks.map(p => p.perk_id) } },
  loadout: { primary: primary ? { kind: 'weapon', weapon_id: primary } : null, secondary: secondary ? { kind: 'weapon', weapon_id: secondary } : null },
});
const ids = s => Hud.prototype._loRows.call({}, s, 'perk').map(r => r.id);

test('F551: a perk blocked for the current primary or secondary is not offered; others and an older MC are', () => {
  assert.deepEqual(ids(st('assault_rifle', 'usp')), ['armor_piercing', 'fast_hands', 'body_armor']);
  assert.deepEqual(ids(st('sniper_rifle', 'usp')), ['fast_hands', 'body_armor'], 'blocked by the primary');
  assert.deepEqual(ids(st('assault_rifle', 'deagle')), ['fast_hands', 'body_armor'], 'blocked by the secondary');
  assert.deepEqual(ids(st(null, null)), ['armor_piercing', 'fast_hands', 'body_armor'], 'nothing picked yet hides nothing');
  assert.deepEqual(ids({ ...st('assault_rifle', 'usp'), pendingPick: { slot: 'primary', kind: 'weapon', id: 'sniper_rifle' } }), ['fast_hands', 'body_armor'],
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
  assert.deepEqual(wids(wst('fast_hands'), 'primary'), weapons.map(w => w.weapon_id), 'a perk that blocks nothing hides nothing');
  assert.deepEqual(wids(wst('body_armor'), 'primary'), weapons.map(w => w.weapon_id), 'an older MC (no lists) hides nothing');
  assert.deepEqual(wids(wst(null), 'primary'), weapons.map(w => w.weapon_id), 'no perk hides nothing');
  assert.deepEqual(wids(wst(null, { pendingPick: { slot: 'perk', kind: 'perk', id: 'armor_piercing' } }), 'primary'), ['assault_rifle', 'usp', 'deagle'],
    'a perk pick still waiting for its ack counts');
  assert.deepEqual(wids(wst('armor_piercing', { pendingPick: { slot: 'perk', kind: 'none', id: null } }), 'primary'), weapons.map(w => w.weapon_id),
    'a pending NONE on the perk frees the weapons');
});

// Review 2026-10-25: the earlier test here hand-built `config.health`, a key the real HUD state never has. The HUD state comes from
// `Engine.state()`, whose `game` is MC's `game_brief()`: health sits at `game.health`. Build it the way the engine does.
const engineState = health => {
  const eng = new Engine({ writer: () => {}, storage: mkStorage(), now: () => 1_000_000 });
  eng.catalog = { weapons: [], perks: [DEMO_PERKS.find(p => p.perk_id === 'extended_mags')] };
  eng.policy = { perk: { allowed_perk_ids: ['extended_mags'] } };
  eng.game = { name: 'TEST', mode: 'tdm', health };
  return eng.state();
};
const emGain = health => Hud.prototype._loRows.call({}, engineState(health), 'perk')[0].row.gain[0];

test('Extended Mags reads the health MC puts on the briefing, as Engine.state() carries it', () => {
  assert.equal(engineState({ max_hp: 45, max_armor: 0, max_shield: 105 }).config, undefined, 'the HUD state has no config key');
  assert.equal(emGain({ max_hp: 45, max_armor: 0, max_shield: 105 }), '×1.5 MAG', 'Shields');
  assert.equal(emGain({ max_hp: 45, max_armor: 70, max_shield: 0 }), '×2 MAG', 'Standard');
  assert.equal(emGain({ max_hp: 45, max_armor: 0, max_shield: 0 }), '×2 MAG', 'Hardcore');
  assert.equal(emGain({ max_hp: 45, max_armor: 0, max_shield: 50 }), '×2 MAG', 'a custom 0-armour pool is not Shields (the server agrees)');
  assert.equal(emGain(undefined), '×2 MAG', 'a briefing with no health is Standard');
});

test('the kit render signature carries the game health, so an EM plate updates when the host switches to Shields', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('../src/hud/hud.js', import.meta.url)), 'utf8');
  const signature = /const sig = \[([\s\S]*?)\]\.join\('\|'\);/.exec(source)?.[1] || '';
  for (const key of ['max_hp', 'max_armor', 'max_shield']) assert.match(signature, new RegExp(`st\\.game\\.health\\.${key}`), key);
});

test('the engine resolves a perk through the Shields variant for the ammo path too (reload and swap read it)', () => {
  const eng = new Engine({ writer: () => {}, storage: mkStorage(), now: () => 1_000_000 });
  eng.catalog = { weapons: [], perks: [DEMO_PERKS.find(p => p.perk_id === 'extended_mags')] };
  eng.game = { health: { max_hp: 45, max_armor: 0, max_shield: 105 } };
  assert.equal(eng.perkEffects('extended_mags').ammo_mult, 1.5);
  assert.equal(eng.perkEffects('extended_mags').switch_mult, 1.3, 'the variant keeps the swap cost');
  eng.game = { health: { max_hp: 45, max_armor: 70, max_shield: 0 } };
  assert.equal(eng.perkEffects('extended_mags').ammo_mult, 2);
  assert.deepEqual(eng.perkEffects('nope'), {});
});
