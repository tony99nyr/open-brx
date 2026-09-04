// Shared game-summary helpers (GAMES cards, the DESIGNER rail, the KIT rules chip) — one generator everywhere.
import type { GameConfig, LoadoutPolicy, LoadoutPool, PerkView, SlotRule, WeaponView } from '../api/types';

/** The rule engine, mirrored from mcp/brx_mcp/mc/policy.py `pool()`. The DESIGNER computes the pool from the rules
 *  being edited on every change (instant, server-independent); the server re-derives on save/apply and is the authority. */
const inPool = (r: SlotRule, id: string, tags: string[]) =>
  (r.only_ids.length === 0 || r.only_ids.includes(id)) && !r.exclude_ids.includes(id) && !tags.some(t => r.exclude_tags.includes(t));
/** The weapon rows a slot's `kinds` admits before the tag/id filters: 'weapon' = every weapon (a pistol is a weapon
 *  too); 'sidearm' alone = only the `sidearm`-tagged rows (the pistols); neither = none. Mirrors policy.py `weapon_kind_rows`. */
export const kindRows = (r: SlotRule, weapons: WeaponView[]): WeaponView[] =>
  r.kinds.includes('weapon') ? weapons : r.kinds.includes('sidearm') ? weapons.filter(w => (w.tags ?? []).includes('sidearm')) : [];
export const admitsWeapons = (r: SlotRule) => r.kinds.includes('weapon') || r.kinds.includes('sidearm');
/** A14: does this perk claim the ALT button (`effects.alt_reload`)? Then no second weapon can ride with it (policy.py `takes_alt`). */
export const takesAlt = (k?: PerkView | null) => !!k?.effects?.alt_reload;
export function computePool(p: LoadoutPolicy, weapons: WeaponView[], perks: PerkView[]): LoadoutPool {
  const prim = p.primary.choice === 'fixed' ? weapons.filter(w => w.weapon_id === p.primary.fixed_id).map(w => w.weapon_id)
    : kindRows(p.primary, weapons).filter(w => inPool(p.primary, w.weapon_id, w.tags ?? [])).map(w => w.weapon_id);
  const s = p.secondary, k = p.perk;
  let sw: string[] = [], sp: string[] = [];
  if (s.choice === 'fixed') sw = weapons.filter(w => w.weapon_id === s.fixed_id).map(w => w.weapon_id);
  else if (s.choice !== 'off') sw = kindRows(s, weapons).filter(w => inPool(s, w.weapon_id, w.tags ?? [])).map(w => w.weapon_id);   // 'sidearm' = pistols only (policy.py weapon_kind_rows)
  if (k.choice === 'fixed') sp = perks.filter(x => x.perk_id === k.fixed_id).map(x => x.perk_id);                                  // A14: the perk rule is its own slot
  else if (k.choice !== 'off') sp = perks.filter(x => !x.hidden && inPool(k, x.perk_id, x.tags ?? [])).map(x => x.perk_id);
  return { primary: prim, secondary_weapons: sw, perks: sp };
}

const rule = (over: Partial<SlotRule> = {}): SlotRule => ({ choice: 'player', kinds: ['weapon'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: null, ...over });
const perkRule = (over: Partial<SlotRule> = {}): SlotRule => rule({ kinds: ['perk'], ...over });
/** OPEN — what the server means by "no policy". A config from a session persisted before A10, or served by an older MC,
 *  has no `loadout_policy` at all; every page must tolerate that (Tony hit "cannot read 'preset' of undefined"). */
export const DEFAULT_POLICY = (): LoadoutPolicy => ({ preset: 'open', hud_select: true, primary: rule(), secondary: rule(), perk: perkRule() });
/** The three starting templates (loadout.md §3.1) — client-side so the designer's START FROM works with no server help. */
export const TEMPLATE_RULES: Record<'open' | 'no_heavies' | 'snipers', LoadoutPolicy> = {
  open: { preset: 'open', hud_select: true, primary: rule(), secondary: rule(), perk: perkRule() },
  no_heavies: { preset: 'no_heavies', hud_select: true, primary: rule({ exclude_tags: ['heavy'] }), secondary: rule({ exclude_tags: ['heavy'] }), perk: perkRule() },
  snipers: { preset: 'snipers', hud_select: false, primary: rule({ choice: 'fixed', fixed_id: 'sniper_rifle' }), secondary: rule({ choice: 'off' }), perk: perkRule({ choice: 'off' }) },
};
/** Which template a set of rules IS (ignoring the name field) — so a hand-built NO HEAVIES reads NO HEAVIES, not CUSTOM (review #18). */
export function presetOf(p: LoadoutPolicy): LoadoutPolicy['preset'] {
  const strip = (x: LoadoutPolicy) => JSON.stringify({ ...x, preset: undefined });
  for (const k of ['open', 'no_heavies', 'snipers'] as const) if (strip(TEMPLATE_RULES[k]) === strip(p)) return k;
  return 'custom';
}
export const withPolicy = (c: GameConfig): GameConfig => (c.loadout_policy?.primary && c.loadout_policy.secondary && c.loadout_policy.perk ? c : { ...c, loadout_policy: DEFAULT_POLICY() });

const PRESET_LABEL: Record<string, string> = { open: 'OPEN', no_heavies: 'NO HEAVIES', snipers: 'SNIPERS ONLY', custom: 'CUSTOM RULES' };

/** identity of a game = everything but the per-apply id and the VENUE (environment / night are about where you play) */
export const gameSig = (c: GameConfig) => { const { config_id: _c, environment: _e, night: _n, ...rest } = c; void _c; void _e; void _n; return JSON.stringify(rest); };

/** one human line for a saved game / the live config — the same generator everywhere (cards, summary, HUD-like) */
export function rulesLine(cfg: GameConfig, weapons: { weapon_id: string; name: string }[], perks: { perk_id: string; name: string }[]) {
  const lp = cfg.loadout_policy; if (!lp) return '';
  const nm = (id?: string | null) => weapons.find(w => w.weapon_id === id)?.name ?? perks.find(k => k.perk_id === id)?.name ?? id ?? '';
  const out: string[] = [];
  if (lp.preset !== 'custom') out.push(PRESET_LABEL[lp.preset]);
  // "PLAYER picks" only means something when phones may pick; otherwise the host kits that slot (review #19)
  const who = (c: string) => (c === 'player' && !lp.hud_select ? 'HOST' : c.toUpperCase());
  out.push(lp.primary.choice === 'fixed' ? `${nm(lp.primary.fixed_id).toUpperCase()} FOR EVERYONE` : `PRIMARY: ${who(lp.primary.choice)} PICKS`);
  out.push(lp.secondary.choice === 'off' ? 'NO SLOT 2' : lp.secondary.choice === 'fixed' ? `SLOT 2: ${nm(lp.secondary.fixed_id).toUpperCase()}`
    : `SLOT 2: ${who(lp.secondary.choice)} PICKS ${lp.secondary.kinds.includes('weapon') ? 'A WEAPON' : 'A SIDEARM'}`);   // review #3; A12: 'weapon' already covers the pistols
  // A14: the perk is its own slot
  out.push(lp.perk.choice === 'off' ? 'NO PERKS' : lp.perk.choice === 'fixed' ? `EVERYONE GETS ${nm(lp.perk.fixed_id).toUpperCase()}` : `PERK: ${who(lp.perk.choice)} PICKS`);
  if (!lp.hud_select) out.push('NO PHONE PICKS');
  return out.join(' · ');
}

