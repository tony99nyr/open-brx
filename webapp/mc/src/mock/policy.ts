// Demo-only mirror of mcp/brx_mcp/mc/policy.py (docs/spec/loadout.md §3). The real server computes
// `State.loadout_pool`; this exists so `?mock` behaves the same way without a backend. Keep in step.
import type { Loadout, LoadoutPolicy, LoadoutPool, LoadoutPreset, PerkView } from '../api/types';

import { TEMPLATE_RULES, takesAlt } from '../screens/gameSummary';

export const PRESETS: Record<Exclude<LoadoutPreset, 'custom'>, LoadoutPolicy> = TEMPLATE_RULES;
export const defaultPolicy = (mode: string): LoadoutPolicy => JSON.parse(JSON.stringify(PRESETS[mode === 'ffa' ? 'no_heavies' : 'open']));

import { computePool } from '../screens/gameSummary';
export const pool = computePool;

/** A14: the perk takes the ALT button AND a second weapon is loaded (policy.py `conflict`). */
export const conflict = (lo: Loadout, perks: PerkView[]) => !!(lo.weapons[1] && lo.perk && takesAlt(perks.find(k => k.perk_id === lo.perk)));

/** Bring one loadout into compliance (server `apply_policy`). Returns the (possibly new) loadout. A fixed ALT-button
 *  perk keeps the perk and drops the second weapon (the host's rule put it there). */
export function apply(p: LoadoutPolicy, lo: Loadout, pl: LoadoutPool, perks: PerkView[]): Loadout {
  const out: Loadout = { weapons: [...lo.weapons.map(w => ({ ...w }))], perk: lo.perk ?? null, overrides: lo.overrides };
  const prim = out.weapons[0]?.weapon_id;
  if (!prim || !pl.primary.includes(prim)) out.weapons[0] = { weapon_id: pl.primary.includes('assault_rifle') ? 'assault_rifle' : pl.primary[0] ?? 'assault_rifle' };
  const sec = out.weapons[1]?.weapon_id;
  if (p.secondary.choice === 'off') out.weapons = [out.weapons[0]];
  else if (p.secondary.choice === 'fixed') out.weapons = pl.secondary_weapons.includes(p.secondary.fixed_id ?? '') ? [out.weapons[0], { weapon_id: p.secondary.fixed_id! }] : [out.weapons[0]];
  else if (sec && !pl.secondary_weapons.includes(sec)) out.weapons = [out.weapons[0]];
  if (p.perk.choice === 'off') out.perk = null;
  else if (p.perk.choice === 'fixed') out.perk = pl.perks.includes(p.perk.fixed_id ?? '') ? p.perk.fixed_id! : null;
  else if (out.perk && !pl.perks.includes(out.perk)) out.perk = null;
  if (conflict(out, perks)) out.weapons = [out.weapons[0]];
  return out;
}

/** Human reason why `id` may not go into `slot` right now (server `policy.check_request` / `validate_loadout`). null = allowed. */
export function reject(p: LoadoutPolicy, pl: LoadoutPool, slot: 'primary' | 'secondary' | 'perk', kind: 'weapon' | 'perk' | 'none', id: string | null, byHost: boolean): string | null {
  const r = p[slot];
  if (r.choice === 'off') return slot === 'perk' ? 'No perks this game' : 'Secondary slot is off for this game — change it in BUILD';
  if (r.choice === 'fixed') return 'This slot is fixed by the ruleset — change it in BUILD';
  if (!byHost && r.choice === 'host') return 'Host picks this slot';
  if (!byHost && !p.hud_select) return 'Phone picks are off for this game';
  if (kind === 'none') return slot === 'primary' ? 'A primary weapon is required' : null;
  if (!id) return 'Pick something';
  if (slot === 'perk') return kind !== 'perk' ? 'Only a perk goes in the perk slot' : pl.perks.includes(id) ? null : 'Not allowed by the ruleset';
  if (kind !== 'weapon') return slot === 'primary' ? "A perk can't go in the primary slot this game" : 'Perks have their own slot this game';
  if (slot === 'primary') return pl.primary.includes(id) ? null : 'Not allowed by the ruleset';
  return pl.secondary_weapons.includes(id) ? null : (r.kinds.includes('weapon') ? 'Not allowed by the ruleset' : r.kinds.includes('sidearm') ? 'Only sidearms go in the secondary slot this game' : 'Weapons are off in the secondary slot');
}

/** Does the policy still match a named preset? (any rule edit flips it to custom) */
export function presetOf(p: LoadoutPolicy): LoadoutPreset {
  for (const [k, v] of Object.entries(PRESETS)) {
    const a = { ...p, preset: k }, b = { ...v, preset: k };
    if (JSON.stringify(a) === JSON.stringify(b)) return k as LoadoutPreset;
  }
  return 'custom';
}
