// DRY-1 (review 2026-10-10): the ONE rule for "is this an energy weapon". ammo.js reads it for the reload watchdog
// (pl4: a held recharge lands 3.5-3.9 s after the pull), hud/shared.js for the RECHARGE words, and the bench stage
// mirrors it (stage.py `_active_weapon_is_energy`). All three are held to app/test/fixtures/weapon-class-cases.json.
// The catalogue's `weapon_class` (weapons.json `class`) decides. The id regex is only the fallback for a pre-A48
// bundle that carries no class. PURE.
export const isEnergyClass = (weaponClass, weaponId) =>
  weaponClass ? weaponClass === 'energy' : /energy|charge/i.test(String(weaponId || ''));
