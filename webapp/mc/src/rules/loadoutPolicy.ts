import type { ConfigView, GameConfig, Loadout, LoadoutPolicy, LoadoutPool, LoadoutPoolReasons, PerkView, PoolEmptyCode, SlotRule, WeaponView } from '../api/types';

/** The rule engine, mirrored from mcp/brx_mcp/mc/policy.py `pool()`. The DESIGNER computes the pool from the rules
 *  being edited on every change (instant, server-independent); the server re-derives on save/apply and is the authority. */
/** 🔴 Weapons that are NOT OFFERABLE in this build, whatever the policy says — mirrors
 *  `policy.py UNPLAYABLE_IDS` (round-2 fix pass K, 2026-09-12). A weapon whose `<t3,t4>` keys a `$SIR`
 *  row that moves no pool deals no damage at all, and the server's `validate()` now REFUSES a loadout
 *  carrying one. A pick that cannot be pushed is the F146 failure — the operator finds out at the
 *  whistle with nothing to do about it — so it is never offered. `energy_launcher` is the only such row
 *  today (its captured word keys `$SIR 9,3`, function 24, a status cell), which is why the catalogue has
 *  carried its `caution` since 2026-08-26; the CATALOGUE page still lists it, KIT and the DESIGNER do
 *  not. Delete the id here AND in policy.py the day its row is fixed on the bench. */
export const UNPLAYABLE_IDS = new Set(['energy_launcher']);

/** mcp/brx_mcp/mc/compile.py WeaponCatalog.all() keeps weapons.json order for policy.pool(). */
export function catalogOrder<T extends { weapon_id: string }>(weapons: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(weapons.map(weapon => [weapon.weapon_id, weapon]));
  const ordered = ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  if (byId.size !== weapons.length || new Set(ids).size !== ids.length || ordered.length !== weapons.length) {
    throw new Error('weapon catalogue order does not match the generated views');
  }
  return ordered;
}

const inPool = (r: SlotRule, id: string, tags: string[]) =>
  !UNPLAYABLE_IDS.has(id)
  && (r.only_ids.length === 0 || r.only_ids.includes(id)) && !r.exclude_ids.includes(id) && !tags.some(t => r.exclude_tags.includes(t));
/** The weapon rows a slot's `kinds` admits before the tag/id filters: 'weapon' = every weapon (a pistol is a weapon
 *  too); 'sidearm' alone = only the `sidearm`-tagged rows (the pistols); neither = none. Mirrors policy.py `weapon_kind_rows`. */
export const kindRows = (r: SlotRule, weapons: WeaponView[]): WeaponView[] => {
  // `UNPLAYABLE_IDS` is filtered HERE too, not only in `inPool`: these rows feed the DESIGNER's
  // per-weapon chips, and a chip that can never be switched on is worse than no chip at all.
  // `pickup_only` (2026-09-17, mirrors policy.py `_filter`): heavies reserved for a future
  // pickup/station mechanism (docs/spec/loadout.md) are never in a starting-loadout pool.
  const ws = weapons.filter(w => !UNPLAYABLE_IDS.has(w.weapon_id) && !w.pickup_only);
  return r.kinds.includes('weapon') ? ws : r.kinds.includes('sidearm') ? ws.filter(w => (w.tags ?? []).includes('sidearm')) : [];
};
/** A14: does this perk claim the ALT button (`effects.alt_reload`)? Then no second weapon can ride with it (policy.py `takes_alt`). */
export const takesAlt = (k?: PerkView | null) => !!k?.effects?.alt_reload;
/** A swap-only perk does nothing without a second weapon. Fast Hands also speeds reloads. */
export const swapsWeapons = (k?: PerkView | null) => {
  const switchMult = k?.effects?.switch_mult;
  const reloadMult = k?.effects?.reload_mult;
  return !!switchMult && switchMult < 1 && !(reloadMult && reloadMult < 1);
};

/** Why `_filter`/the choice left this slot with nothing — mirrors policy.py `_empty_code` exactly,
 *  including checking `ids` against the FULL catalog (never the kind-filtered subset): a fixed id
 *  missing from the whole game's weapon list is `fixed_missing` regardless of which kind excluded it. */
function emptyCode(rule: SlotRule, ids: Set<string>, weapons = false): PoolEmptyCode {
  if (rule.choice === 'off') return 'off';
  const unplayable = (id: string) => weapons && UNPLAYABLE_IDS.has(id);
  if (rule.choice === 'fixed') {
    if (rule.fixed_id == null || !ids.has(rule.fixed_id)) return 'fixed_missing';
    // round-3 UX-2: `unplayable` BEATS `filtered`. A slot fixed to the Energy Launcher used to read
    // `filtered` — a sentence telling the operator to clear a filter (there is none) or set the slot
    // to FIXED (it already is), and it never named the weapon.
    return unplayable(rule.fixed_id) ? 'unplayable' : 'filtered';
  }
  const only = rule.only_ids ?? [];
  if (only.length) {
    const hit = only.filter(id => ids.has(id));
    if (!hit.length) return 'only_ids_missing';
    if (hit.every(unplayable)) return 'unplayable';
  }
  return 'filtered';
}

export function computePool(p: LoadoutPolicy, weapons: WeaponView[], perks: PerkView[], healthPreset?: string | null): LoadoutPool {
  // 2026-09-18 (weapon-design.md §7.4): a weapon the catalogue marks `lethal: false` deliberately
  // cannot kill, and it may NEVER be a primary. The server refuses one in slot 0 outright
  // (`Compiler.validate`) and keeps it out of the primary pool (`policy._support_ids`), so this mirror
  // must do the same or the console offers an operator a pick that is rejected at arming.
  let prim = p.primary.choice === 'fixed' ? weapons.filter(w => w.weapon_id === p.primary.fixed_id && !UNPLAYABLE_IDS.has(w.weapon_id) && !w.pickup_only && w.lethal !== false).map(w => w.weapon_id)
    : kindRows(p.primary, weapons).filter(w => inPool(p.primary, w.weapon_id, w.tags ?? []) && w.lethal !== false).map(w => w.weapon_id);
  const s = p.secondary, k = p.perk;
  let sw: string[] = [], sp: string[] = [];
  if (s.choice === 'fixed') sw = weapons.filter(w => w.weapon_id === s.fixed_id && !UNPLAYABLE_IDS.has(w.weapon_id) && !w.pickup_only).map(w => w.weapon_id);
  else if (s.choice !== 'off') sw = kindRows(s, weapons).filter(w => inPool(s, w.weapon_id, w.tags ?? [])).map(w => w.weapon_id);   // 'sidearm' = pistols only (policy.py weapon_kind_rows)
  const visiblePerks = perks.filter(x => !x.hidden);   // pool() is handed only the visible catalog server-side
  if (k.choice === 'fixed') sp = visiblePerks.filter(x => x.perk_id === k.fixed_id).map(x => x.perk_id);                           // A14: the perk rule is its own slot
  else if (k.choice !== 'off') sp = visiblePerks.filter(x => inPool(k, x.perk_id, x.tags ?? [])).map(x => x.perk_id);
  // Honest pickers (Tony 2026-10-25), as policy.py pool(): a perk the game's health preset refuses
  // (`PerkView.blocked_presets`, Armour Piercing and Body Armor on Shields) is not offered
  let presetEmptied = false;
  if (healthPreset) {
    const kept = sp.filter(id => !(visiblePerks.find(x => x.perk_id === id)?.blocked_presets ?? []).includes(healthPreset));
    presetEmptied = sp.length > 0 && !kept.length;
    sp = kept;
  }
  let perkEmptiedPrim = false, perkEmptiedSw = false;   // F585: the fixed-perk prune emptied the slot, not its own rule
  if (k.choice === 'fixed' && sp.length) {
    // F551, as policy.py pool(): a fixed perk takes the weapons it cannot ride with out of the pool
    const fixed = visiblePerks.find(x => x.perk_id === sp[0]);
    const hadPrim = prim.length > 0, hadSw = sw.length > 0;
    prim = prim.filter(w => !(fixed?.blocked_primary ?? []).includes(w));
    sw = sw.filter(w => !(fixed?.blocked_secondary ?? []).includes(w));
    perkEmptiedPrim = hadPrim && !prim.length; perkEmptiedSw = hadSw && !sw.length;
  }
  // S37: a swap-only perk with no legal secondary has nothing to switch
  // to — pruned from the pool itself, the same way apply()/a stored loadout drops it, so it disappears
  // from both UIs with no extra rule. `neededSecondary` records whether THIS is why `sp` went empty,
  // which the perk slot's own `_empty_code` must never be blamed for instead (policy.py pool()).
  let neededSecondary = false;
  if (sw.length === 0 && sp.length > 0) {
    const kept = sp.filter(id => !swapsWeapons(visiblePerks.find(x => x.perk_id === id)));
    neededSecondary = kept.length !== sp.length;
    sp = kept;
  }
  const out: LoadoutPool = { primary: prim, secondary_weapons: sw, perks: sp };
  const weaponIds = new Set(weapons.map(w => w.weapon_id));
  const perkIds = new Set(visiblePerks.map(x => x.perk_id));
  const reasons: LoadoutPoolReasons = {};
  if (prim.length === 0) reasons.primary = perkEmptiedPrim ? 'perk_blocked' : emptyCode(p.primary, weaponIds, true);
  if (sw.length === 0) reasons.secondary_weapons = perkEmptiedSw ? 'perk_blocked' : emptyCode(s, weaponIds, true);
  if (sp.length === 0) reasons.perks = neededSecondary ? 'needs_secondary' : presetEmptied ? 'preset_blocked' : emptyCode(k, perkIds);
  if (Object.keys(reasons).length) out.reasons = reasons;
  return out;
}

/** Easy Reload takes ALT, so it conflicts with a second weapon and with any equipped chain-reload weapon. */
export function easyReloadConflict(
  loadout: Loadout,
): { weapon: string } | null {
  const weapons = loadout.weapons ?? [];
  const secondary = weapons[1]?.weapon_id;
  return secondary && loadout.overrides?.easy_reload ? { weapon: secondary } : null;
}

/** Mirrors policy.py `chain_conflict`: Easy Reload cannot reload a weapon that needs a held shell-chain reload. */
export function chainConflict(
  loadout: Loadout,
  weapons: WeaponView[],
): { weapon: string } | null {
  if (!loadout.overrides?.easy_reload) return null;
  for (const equipped of loadout.weapons ?? []) {
    const id = equipped?.weapon_id;
    // MC states every row's reload_type (views.py, from policy.chain_reload), so the row is the whole answer
    if (weapons.find(weapon => weapon.weapon_id === id)?.reload_type === 'chain') return { weapon: id };
  }
  return null;
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
export const withPolicy = (c: GameConfig): ConfigView => {
  const policy = c.loadout_policy;
  return policy?.primary && policy.secondary && policy.perk
    ? { ...c, loadout_policy: policy }
    : { ...c, loadout_policy: DEFAULT_POLICY() };
};
