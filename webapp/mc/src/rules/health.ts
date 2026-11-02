import type { HealthPreset } from '../api/types';
import { HEALTH_PRESETS as GEN_HEALTH_PRESETS } from '../api/contract.gen';

/** Tony 2026-09-19 (FOLLOWUPS S45, weapon-design.md §7.3) — the three named starting-pool presets: the server's own
 *  `compile.py HEALTH_PRESETS`, generated (Seams B), so a preset button writes the numbers `resolve_health_preset()`
 *  reads back as that preset. */
export const HEALTH_PRESETS: Record<Exclude<HealthPreset, 'custom'>, { max_hp: number; max_armor: number; max_shield: number }> = GEN_HEALTH_PRESETS;
/** Which preset these three numbers ARE, or "custom" — a label RE-DERIVED every time (mirrors mock/policy.ts `presetOf`), never trusted from a stored `preset` field on its own. */
export function healthPresetOf(h: { max_hp: number; max_armor: number; max_shield: number }): HealthPreset {
  for (const k of Object.keys(HEALTH_PRESETS) as (keyof typeof HEALTH_PRESETS)[]) {
    const p = HEALTH_PRESETS[k];
    if (p.max_hp === h.max_hp && p.max_armor === h.max_armor && p.max_shield === h.max_shield) return k;
  }
  return 'custom';
}

/** The one console rule for "this game is on Shields": the server's `compile.derived_health_preset` (the same call decides
 *  the Body Armor / Armour Piercing refusal and the Extended Mags override). A health with no `max_shield` is a legacy
 *  (custom) pool, never Shields. */
export function isShieldsHealth(h?: { max_hp?: number; max_armor?: number; max_shield?: number } | null): boolean {
  return !!h && h.max_shield !== undefined && healthPresetOf({ max_hp: h.max_hp ?? 45, max_armor: h.max_armor ?? 0, max_shield: h.max_shield }) === 'shields';
}

/** F652 (game 2026-11-01): the perks this game's health preset turns off, as one plain line ("SHIELDS: BODY ARMOR AND
 *  ARMOR PIERCING ARE OFF"), or null. Read from `PerkView.blocked_presets`, the same field the server refuses on, so
 *  the line names whatever Tony's 2026-10-25 rule removes today. */
export function shieldsOffNote(perks: readonly { name: string; blocked_presets?: readonly string[] | null }[],
  h?: { max_hp?: number; max_armor?: number; max_shield?: number } | null): string | null {
  if (!isShieldsHealth(h)) return null;
  const off = perks.filter(k => (k.blocked_presets ?? []).includes('shields')).map(k => k.name.toUpperCase());
  if (!off.length) return null;
  const list = off.length === 1 ? off[0] : `${off.slice(0, -1).join(', ')} AND ${off[off.length - 1]}`;
  return `SHIELDS: ${list} ${off.length === 1 ? 'IS' : 'ARE'} OFF`;
}
