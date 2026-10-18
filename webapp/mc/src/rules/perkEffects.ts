import type { GameConfig, PerkEffectsResolved, PerkView, Player, ValuePair, WeaponView } from '../api/types';
import { RESERVE_PROVEN_MAX, WEAPON_MOCK_FIELDS } from '../api/contract.gen';

/** Python round(): nearest integer, with an exact midpoint going to the even integer. */
export function roundHalfEven(value: number): number {
  const low = Math.floor(value);
  const fraction = value - low;
  return fraction < 0.5 ? low : fraction > 0.5 ? low + 1 : low % 2 === 0 ? low : low + 1;
}

/** Port of mcp/brx_mcp/mc/compile.py Compiler.perk_effects_resolved() and WeaponCatalog._ammo()/swap_ms(). */
export function perkEffectsResolved(config: GameConfig, player: Player, weapons: readonly WeaponView[],
  perks: readonly PerkView[]): PerkEffectsResolved | null {
  const perkId = player.loadout?.perk;
  if (!perkId) return null;
  const effects = perks.find(perk => perk.perk_id === perkId)?.effects ?? {};
  const primaryId = player.loadout.weapons[0]?.weapon_id ?? 'assault_rifle';
  const secondaryId = player.loadout.weapons[1]?.weapon_id;
  const primary = weapons.find(weapon => weapon.weapon_id === primaryId);
  const rawPrimary = WEAPON_MOCK_FIELDS.find(weapon => weapon.weapon_id === primaryId);
  if (!rawPrimary) return null;

  const pair = (base: number, resolved: number): ValuePair | undefined =>
    base === resolved ? undefined : { base, resolved };
  const round = roundHalfEven;
  const isPistol = (primary?.role ?? rawPrimary.role) === 'sidearm'
    || (primary?.tags ?? rawPrimary.tags).includes('pistol');
  // Tony, 2026-10-17: perks leave a bolt action's one-round magazine and its bolt (reload_ms) alone, as compile.py does.
  const bolt = rawPrimary.reload_type === 'bolt';
  const pistolMult = isPistol && !bolt ? effects.ammo_mult_pistol : undefined;
  const ammoMult = bolt ? 1 : pistolMult || effects.ammo_mult || 1;
  const ammoRound = pistolMult ? Math.floor : round;
  const magBase = rawPrimary.mag;
  const reserveBase = rawPrimary.capture_frame ? Math.floor(rawPrimary.reserve / 2) * 2 : rawPrimary.reserve;
  const reloadBase = rawPrimary.reload_ms;
  const mag = Math.max(1, ammoRound(magBase * ammoMult));
  let reserve = ammoRound(reserveBase * ammoMult);
  // The reserve ceiling, as compile.py `_ammo` applies it: never past max(RESERVE_PROVEN_MAX, the row's own reserve).
  reserve = Math.min(reserve, Math.max(RESERVE_PROVEN_MAX, rawPrimary.reserve));
  // Captured frames mirror the reserve in tok40, which makes odd counts round down.
  if (rawPrimary.capture_frame) reserve = Math.floor(reserve / 2) * 2;
  const reload = Math.max(0, round(reloadBase * (bolt ? 1 : effects.reload_mult || 1)));

  const swapMs = (id: string, multiplier = 1) => {
    const row = WEAPON_MOCK_FIELDS.find(weapon => weapon.weapon_id === id);
    if (!row) return 0;
    const frame = row.capture_frame?.split(',');
    const captured = frame && /^\d+$/.test(frame[16] ?? '') ? Number(frame[16]) : 850;
    const base = row.swap_ms ?? captured;
    return Math.max(0, round(base * multiplier));
  };
  const swapBase = Math.max(swapMs(primaryId), secondaryId ? swapMs(secondaryId) : 0);
  const swap = Math.max(swapMs(primaryId, effects.switch_mult || 1),
    secondaryId ? swapMs(secondaryId, effects.switch_mult || 1) : 0);

  const armourBase = player.loadout.overrides?.max_armor ?? config.health.max_armor;
  const shieldBase = config.health.max_shield ?? 0;
  const shields = config.health.max_armor === 0;
  const clamp = (value: number) => Math.max(0, Math.min(255, value));
  const grant = effects.max_armor_add ?? 0;
  const armour = clamp(armourBase + (shields ? 0 : grant));
  const shield = clamp(shieldBase + (shields ? grant : 0));
  const result: PerkEffectsResolved = { perk_id: perkId };
  if (pair(magBase, mag)) result.mag = pair(magBase, mag);
  if (pair(reserveBase, reserve)) result.reserve = pair(reserveBase, reserve);
  if (pair(reloadBase, reload)) result.reload_ms = pair(reloadBase, reload);
  if (pair(swapBase, swap)) result.swap_ms = pair(swapBase, swap);
  if (pair(armourBase, armour)) result.max_armor = pair(armourBase, armour);
  if (pair(shieldBase, shield)) result.max_shield = pair(shieldBase, shield);
  return result;
}
