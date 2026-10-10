// DRY-1 (review 2026-10-10): one rule decides "energy weapon" for the reload watchdog (ammo.js), the HUD's RECHARGE
// words (hud/shared.js) and the stage. The HUD read the catalogue's `weapon_class` while ammo.js and the stage matched
// the id, so the Plasma Sniper, Rail Gun, Laser Cannon and Ion Sniper said HOLD TO RECHARGE but got the bullet watchdog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isEnergyClass } from '../src/weaponclass.js';
import { isEnergyWeapon } from '../src/hud/shared.js';

const { cases } = JSON.parse(readFileSync(new URL('./fixtures/weapon-class-cases.json', import.meta.url), 'utf8'));
const raw = JSON.parse(readFileSync(new URL('../../mcp/brx_mcp/mc/weapons.json', import.meta.url), 'utf8'));
const rows = (Array.isArray(raw) ? raw : Object.values(raw.weapons || raw)).filter(r => r && typeof r === 'object' && r.weapon_id);

test('DRY-1: every case, through the one rule and through the HUD', () => {
  for (const c of cases) {
    assert.equal(isEnergyClass(c.weapon_class, c.weapon_id), c.energy, `${c.weapon_id} (${c.weapon_class})`);
    assert.equal(isEnergyWeapon({ weaponClass: c.weapon_class, weaponId: c.weapon_id }), c.energy, `HUD: ${c.weapon_id}`);
  }
});

test('DRY-1: the case file names every weapons.json row with its class, so a new weapon cannot skip the rule', () => {
  const byId = new Map(cases.filter(c => c.weapon_class != null).map(c => [c.weapon_id, c.weapon_class]));
  for (const r of rows) assert.equal(byId.get(r.weapon_id), r.class || 'ballistic', `${r.weapon_id}: regenerate weapon-class-cases.json`);
  assert.ok(rows.some(r => r.class === 'energy' && !/energy|charge/i.test(r.weapon_id)), 'the file covers a class the id regex misses');
});

