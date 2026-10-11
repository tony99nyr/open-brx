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
