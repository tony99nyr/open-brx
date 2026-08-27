// Demo-only mirror of mcp/brx_mcp/mc/policy.py (docs/spec/loadout.md §3). The real server computes
// `State.loadout_pool`; this exists so `?mock` behaves the same way without a backend. Keep in step.
import type { Loadout, LoadoutPolicy, LoadoutPool, LoadoutPreset, SlotRule } from '../api/types';

const rule = (over: Partial<SlotRule> = {}): SlotRule => ({ choice: 'player', kinds: ['weapon'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: null, ...over });

export const PRESETS: Record<Exclude<LoadoutPreset, 'custom'>, LoadoutPolicy> = {
  open: { preset: 'open', hud_select: true, primary: rule(), secondary: rule({ kinds: ['weapon', 'perk'] }) },
  no_heavies: { preset: 'no_heavies', hud_select: true, primary: rule({ exclude_tags: ['heavy'] }), secondary: rule({ kinds: ['weapon', 'perk'], exclude_tags: ['heavy'] }) },
  snipers: { preset: 'snipers', hud_select: false, primary: rule({ choice: 'fixed', fixed_id: 'sniper_rifle' }), secondary: rule({ choice: 'off', kinds: ['weapon', 'perk'] }) },
};
export const defaultPolicy = (mode: string): LoadoutPolicy => JSON.parse(JSON.stringify(PRESETS[mode === 'ffa' ? 'no_heavies' : 'open']));

import { computePool } from '../screens/gameSummary';
export const pool = computePool;

/** Bring one loadout into compliance (server `apply_policy`). Returns the (possibly new) loadout. */
export function apply(p: LoadoutPolicy, lo: Loadout, pl: LoadoutPool): Loadout {
  const out: Loadout = { weapons: [...lo.weapons.map(w => ({ ...w }))], perk: lo.perk ?? null, overrides: lo.overrides };
  const prim = out.weapons[0]?.weapon_id;
  if (!prim || !pl.primary.includes(prim)) out.weapons[0] = { weapon_id: pl.primary.includes('assault_rifle') ? 'assault_rifle' : pl.primary[0] ?? 'assault_rifle' };
  const sec = out.weapons[1]?.weapon_id;
  if (p.secondary.choice === 'off') { out.weapons = [out.weapons[0]]; out.perk = null; }
  else if (p.secondary.choice === 'fixed') {
    const f = p.secondary.fixed_id ?? '';
    if (pl.secondary_weapons.includes(f)) { out.weapons = [out.weapons[0], { weapon_id: f }]; out.perk = null; }
    else if (pl.secondary_perks.includes(f)) { out.weapons = [out.weapons[0]]; out.perk = f; }
    else { out.weapons = [out.weapons[0]]; out.perk = null; }
  } else {
    if (sec && !pl.secondary_weapons.includes(sec)) out.weapons = [out.weapons[0]];
    if (out.perk && !pl.secondary_perks.includes(out.perk)) out.perk = null;
    if (out.weapons.length > 1 && out.perk) out.perk = null;
  }
  return out;
}

/** Human reason why `id` may not go into `slot` right now (server `policy.validate`). null = allowed. */
export function reject(p: LoadoutPolicy, pl: LoadoutPool, slot: 'primary' | 'secondary', kind: 'weapon' | 'perk' | 'none', id: string | null, byHost: boolean): string | null {
  const r = slot === 'primary' ? p.primary : p.secondary;
  if (r.choice === 'off') return 'Secondary slot is off for this game — change it in BUILD';
  if (r.choice === 'fixed') return 'This slot is fixed by the ruleset — change it in BUILD';
  if (!byHost && r.choice === 'host') return 'Host picks this slot';
  if (!byHost && !p.hud_select) return 'Phone picks are off for this game';
  if (kind === 'none') return slot === 'secondary' ? null : 'A primary weapon is required';
  if (!id) return 'Pick something';
  if (slot === 'primary') return pl.primary.includes(id) ? null : 'Not allowed by the ruleset';
  if (kind === 'weapon') return pl.secondary_weapons.includes(id) ? null : (r.kinds.includes('weapon') ? 'Not allowed by the ruleset' : 'Weapons are off in the secondary slot');
  return pl.secondary_perks.includes(id) ? null : (r.kinds.includes('perk') ? 'Not allowed by the ruleset' : 'Perks are off for this game');
}

/** Does the policy still match a named preset? (any rule edit flips it to custom) */
export function presetOf(p: LoadoutPolicy): LoadoutPreset {
  for (const [k, v] of Object.entries(PRESETS)) {
    const a = { ...p, preset: k }, b = { ...v, preset: k };
    if (JSON.stringify(a) === JSON.stringify(b)) return k as LoadoutPreset;
  }
  return 'custom';
}
