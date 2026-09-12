// Shared game-summary helpers (GAMES cards, the DESIGNER rail, the KIT rules chip) — one generator everywhere.
import type { ConfigView, GameConfig, LoadoutPolicy, LoadoutPool, LoadoutPoolReasons, PerkView, PoolEmptyCode, SlotRule, StationSourceId, WeaponView } from '../api/types';
import { STATION_SOURCE_IDS } from '../api/types';

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
/** S37: does this perk do NOTHING without a second weapon (`effects.switch_mult` — Quick Switch,
 *  which compiles to the $WEAP tok15 swap delay)? Mirrors policy.py `swaps_weapons`, asked of the
 *  EFFECT rather than the perk id so a second swap perk is covered the day it exists. */
export const swapsWeapons = (k?: PerkView | null) => !!k?.effects?.switch_mult;

/** Why `_filter`/the choice left this slot with nothing — mirrors policy.py `_empty_code` exactly,
 *  including checking `ids` against the FULL catalog (never the kind-filtered subset): a fixed id
 *  missing from the whole game's weapon list is `fixed_missing` regardless of which kind excluded it. */
function emptyCode(rule: SlotRule, ids: Set<string>): PoolEmptyCode {
  if (rule.choice === 'off') return 'off';
  if (rule.choice === 'fixed') return rule.fixed_id != null && ids.has(rule.fixed_id) ? 'filtered' : 'fixed_missing';
  const only = rule.only_ids ?? [];
  if (only.length && !only.some(id => ids.has(id))) return 'only_ids_missing';
  return 'filtered';
}

export function computePool(p: LoadoutPolicy, weapons: WeaponView[], perks: PerkView[]): LoadoutPool & { reasons?: LoadoutPoolReasons } {
  const prim = p.primary.choice === 'fixed' ? weapons.filter(w => w.weapon_id === p.primary.fixed_id).map(w => w.weapon_id)
    : kindRows(p.primary, weapons).filter(w => inPool(p.primary, w.weapon_id, w.tags ?? [])).map(w => w.weapon_id);
  const s = p.secondary, k = p.perk;
  let sw: string[] = [], sp: string[] = [];
  if (s.choice === 'fixed') sw = weapons.filter(w => w.weapon_id === s.fixed_id).map(w => w.weapon_id);
  else if (s.choice !== 'off') sw = kindRows(s, weapons).filter(w => inPool(s, w.weapon_id, w.tags ?? [])).map(w => w.weapon_id);   // 'sidearm' = pistols only (policy.py weapon_kind_rows)
  const visiblePerks = perks.filter(x => !x.hidden);   // pool() is handed only the visible catalog server-side
  if (k.choice === 'fixed') sp = visiblePerks.filter(x => x.perk_id === k.fixed_id).map(x => x.perk_id);                           // A14: the perk rule is its own slot
  else if (k.choice !== 'off') sp = visiblePerks.filter(x => inPool(k, x.perk_id, x.tags ?? [])).map(x => x.perk_id);
  // S37 (field 2026-09-12): a swap perk (Quick Switch) with no legal secondary has nothing to switch
  // to — pruned from the pool itself, the same way apply()/a stored loadout drops it, so it disappears
  // from both UIs with no extra rule. `neededSecondary` records whether THIS is why `sp` went empty,
  // which the perk slot's own `_empty_code` must never be blamed for instead (policy.py pool()).
  let neededSecondary = false;
  if (sw.length === 0 && sp.length > 0) {
    const kept = sp.filter(id => !swapsWeapons(visiblePerks.find(x => x.perk_id === id)));
    neededSecondary = kept.length !== sp.length;
    sp = kept;
  }
  const out: LoadoutPool & { reasons?: LoadoutPoolReasons } = { primary: prim, secondary_weapons: sw, perks: sp };
  const weaponIds = new Set(weapons.map(w => w.weapon_id));
  const perkIds = new Set(visiblePerks.map(x => x.perk_id));
  const reasons: LoadoutPoolReasons = {};
  if (prim.length === 0) reasons.primary = emptyCode(p.primary, weaponIds);
  if (sw.length === 0) reasons.secondary_weapons = emptyCode(s, weaponIds);
  if (sp.length === 0) reasons.perks = neededSecondary ? 'needs_secondary' : emptyCode(k, perkIds);
  if (Object.keys(reasons).length) out.reasons = reasons;
  return out;
}

/** F141 polish (field 2026-09-12, pass 1 + pass 2): which of the three slots would hand nobody
 *  anything, given the pool's OWN `reasons` (server pass 2, policy.py `pool()`/`_empty_code`) — a slot
 *  is fine only when its code is `off` (a deliberately empty slot) or absent (something is allowed).
 *  Pass 1 exempted `choice === 'fixed'` too, on the theory a fixed slot always has its one id — but the
 *  server's own push refusal (`_primary_pool_refusal`) blocks exactly the case where a fixed id is NOT
 *  in the catalog, so that exemption let PLAY/SAVE/CONTINUE through into a refused push. Shared by
 *  DESIGNER (a draft's own pool, so PLAY/SAVE can refuse before the bad policy is ever applied) and
 *  GAMES (the server-computed `state.loadout_pool` against the config actually in play, so CONTINUE
 *  refuses too — a policy can reach `state.config` from an older saved game or a race even if this
 *  session's Designer never produced it). Absent pool (not loaded yet) reads as nothing empty, never a
 *  false block. */
export function emptyRequiredSlots(pool: (LoadoutPool & { reasons?: LoadoutPoolReasons }) | null): { primary: boolean; secondary: boolean; perk: boolean; any: boolean } {
  const r = pool?.reasons;
  const blocks = (code?: PoolEmptyCode) => !!code && code !== 'off';
  const primary = blocks(r?.primary), secondary = blocks(r?.secondary_weapons), perk = blocks(r?.perks);
  return { primary, secondary, perk, any: primary || secondary || perk };
}

/** The console's own words for a pool-empty code (policy.py's copy of these is the HUD's, `_R_*`,
 *  shown verbatim to a PLAYER — this is the OPERATOR's, and names the control to fix). `slot` picks
 *  the pronoun; `needs_secondary` only ever occurs on the perk slot but is worded generically in case
 *  a second swap-effect perk ever lands on another slot. */
export function poolEmptyMessage(slot: 'PRIMARY' | 'SECONDARY' | 'PERK', code: PoolEmptyCode): string {
  switch (code) {
    case 'fixed_missing': return `${slot}'S FIXED PICK IS NOT IN THIS GAME — CHOOSE A DIFFERENT ONE.`;
    case 'only_ids_missing': return `${slot}'S ALLOW-LIST NAMES NOTHING THIS GAME HAS — ADD A VALID ID OR CLEAR IT.`;
    case 'needs_secondary': return 'QUICK SWITCH NEEDS A SECONDARY — TURN THE SECONDARY ON, OR PICK ANOTHER PERK.';
    case 'filtered': return `${slot}'S CLASS/ID FILTERS EXCLUDE EVERYTHING — CLEAR ONE, OR SET WHO PICKS TO FIXED.`;
    case 'off': return '';   // never shown — an off slot is not a problem
  }
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
export const withPolicy = (c: GameConfig): ConfigView =>
  (c.loadout_policy?.primary && c.loadout_policy.secondary && c.loadout_policy.perk
    ? (c as ConfigView) : { ...c, loadout_policy: DEFAULT_POLICY() });

const PRESET_LABEL: Record<string, string> = { open: 'OPEN', no_heavies: 'NO HEAVIES', snipers: 'SNIPERS ONLY', custom: 'CUSTOM RULES' };

// F70 — the objective-source vocabulary. The IDS are NOT mirrored here: they come from the generated
// `STATION_SOURCE_IDS` (mcp/brx_mcp/mc/types.py `STATION_SOURCES`), and this map is keyed by
// `StationSourceId`, so a source added on the server fails this file's compile instead of quietly
// missing from the control. Only the OPERATOR COPY is ours — the server's `desc` is written for an API
// error, not for a button. It is a CLOSED list server-side (a PUT with anything else 400s naming every
// legal value), so the console offers exactly these and nothing else. An unknown value that somehow
// arrives in a config still renders (see `objectiveLine`) rather than vanishing — a field we cannot
// show is a field nobody can fix.
const SOURCE_COPY: Record<StationSourceId, { label: string; hint: string }> = {
  grenade: { label: 'GRENADE', hint: 'A BRX Smart Grenade in hill mode. Bench-proven 2026-09-10; drives exactly ONE point (F88).' },
  ir_station: { label: 'IR STATION', hint: 'A BRX station / Utility Box speaking $CAPTURE. UNPROVEN — we have never had one on the bench.' },
  phone: { label: 'PHONE', hint: 'A spare phone in the UTILITY role as a BLE control point: capture by presence, armed by MC at muster. Announces contested; can name its point (several are possible).' },
};
export const STATION_SOURCES: { value: StationSourceId; label: string; hint: string }[] =
  STATION_SOURCE_IDS.map(value => ({ value, ...SOURCE_COPY[value] }));
/** the OBJECTIVE row shown on GAMES and in the designer rail, or null for a mode with no station source */
export const objectiveLine = (cfg: GameConfig): string | null => {
  const src = cfg.station_source;
  if (!src) return null;
  if (src === 'grenade') return 'GRENADE HILL · ONE POINT';
  if (src === 'phone') return 'PHONE CONTROL POINT · PRESENCE';
  return (STATION_SOURCES.find(s => s.value === src)?.label ?? src.toUpperCase());
};

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

