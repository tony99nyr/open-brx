import type { ConfigView, ModeParamSpec, PerkView, Player, WeaponView } from '../api/types';
import {
  HIT_AUDIO_CLASS_PINNED, HIT_AUDIO_CLASS_POOLS, HIT_AUDIO_FALLBACK_CLASS,
  HIT_AUDIO_FREE_CELLS, HIT_AUDIO_MAX_SIR_ROWS, HIT_AUDIO_PIN_PREFIX,
  HIT_AUDIO_RESERVED_CELLS, HIT_AUDIO_ROLE_CLASS, SIR_ARMOR_PIERCING_FNS,
  MAX_PLAYERS, MODE_PARAM_SCHEMAS, OBJECTIVE_MODES, SIR_GRANT_FNS, SIR_NO_POOL_FNS,
  SIR_PLAIN_DAMAGE_FNS, SIR_TABLE, STATION_GATED_MODES, STATION_PROTECT_S_OPTIONS,
  STATION_PROTECT_S_DEFAULT, STATION_SOURCE_DESCRIPTIONS, TIMED_PROTECT_S_DEFAULT,
  TIMED_PROTECT_S_OPTIONS, WEAPON_DELAY_MS_DEFAULT, WEAPON_DELAY_MS_OPTIONS,
  WEAPON_MOCK_FIELDS,
} from '../api/contract.gen';

export interface CompilerResult { errors: string[]; warnings: string[] }
type WeaponFields = { weapon_id: string; mag: number; resolved_frame: string; dmg: number; rounds_per_charge?: number; sir_fn?: number | null; lethal?: boolean; tags?: readonly string[]; role?: string };
const rows = new Map((WEAPON_MOCK_FIELDS as readonly WeaponFields[]).map(w => [w.weapon_id, w]));
const split = (frame: string) => frame.replace(/\*$/, '').split(',');
const tok = (frame: string, n: number) => Number(split(frame)[n] || 0);
const cell = (w: WeaponFields) => `${tok(w.resolved_frame, 4)},${tok(w.resolved_frame, 5)}`;
const dmg = (w: WeaponFields) => tok(w.resolved_frame, 6);
const pull = (w: WeaponFields) => dmg(w) + tok(w.resolved_frame, 13);
const htk = (w: WeaponFields, pool: number) => {
  const charge = pull(w), tap = tok(w.resolved_frame, 38);
  if (charge <= 0 || pool <= 0) return 0;
  return (w.rounds_per_charge ?? 1) > 1 && tap > 0 && pool > charge
    ? 1 + Math.ceil((pool - charge) / tap) : Math.ceil(pool / charge);
};
const rtk = (w: WeaponFields, pool: number) => {
  const hits = htk(w, pool);
  return hits && (w.rounds_per_charge ?? 1) > 1 && tok(w.resolved_frame, 38) > 0
    ? (w.rounds_per_charge ?? 1) + hits - 1 : hits;
};
const baseSir = new Map<string, number>((SIR_TABLE as readonly string[]).map(row => {
  const t = split(row);
  return [`${Number(t[1] || 0)},${Number(t[2] || 0)}`, Number(t[4] || 0)] as const;
}));
const repr = (value: unknown) => typeof value === 'string' ? `'${value.replace(/'/g, "\\'")}'`
  : value === null ? 'None' : typeof value === 'boolean' ? value ? 'True' : 'False' : String(value);

function modeParamErrors(mode: string, values: unknown): string[] {
  if (values == null) return [];
  if (typeof values !== 'object' || Array.isArray(values))
    return ["mode_params must be an object (the mode's own parameters, GET /api/modes .params)"];
  const schema: readonly ModeParamSpec[] = MODE_PARAM_SCHEMAS[mode] ?? [];
  const byName = new Map(schema.map(p => [p.name, p]));
  const keys = schema.map(p => p.name).sort();
  const known = keys.length ? keys.join(', ') : 'none';
  const errors: string[] = [];
  for (const key of Object.keys(values)) if (!byName.has(key)) {
    errors.push(keys.length
      ? `mode ${repr(mode)} has no parameter ${repr(key)} — its parameters are: ${known}`
      : `mode ${repr(mode)} takes no mode_params, so ${repr(key)} would be a control that does nothing`);
  }
  for (const spec of schema) {
    if (!Object.hasOwn(values, spec.name)) continue;
    const value = (values as Record<string, unknown>)[spec.name];
    const name = `mode_params.${spec.name}`;
    let error: string | null = null;
    if (spec.type === 'bool') {
      if (typeof value !== 'boolean') error = `${name} must be true or false, not ${repr(value)}`;
    } else if (spec.type === 'str') {
      if (typeof value !== 'string' || !value || value.length > 64)
        error = `${name} must be a short non-empty string, not ${repr(value)}`;
      else if (spec.choices && !spec.choices.includes(value))
        error = `${name} must be one of ${spec.choices.join(', ')}, not ${repr(value)}`;
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      error = `${name} must be a number, not ${repr(value)}`;
    } else if (spec.type === 'int' && !Number.isInteger(value)) {
      error = `${name} must be a whole number, not ${repr(value)}`;
    } else if (spec.min != null && value < spec.min) {
      error = `${name} must be at least ${spec.min}, not ${value}`;
    } else if (spec.max != null && value > spec.max) {
      error = `${name} must be at most ${spec.max}, not ${value}`;
    }
    if (error) errors.push(`mode ${repr(mode)}: ${error}`);
  }
  return errors;
}

type Plan = { cells: Map<string, string>; sir: Map<string, number> };
function hitPlan(config: ConfigView, players: Player[]): Plan {
  // MC's mock Compiler uses the default distinct_weapon_cells=false. The CLI-only
  // flag and its extra warnings do not enter this API session.
  const ids = [...new Set(players.flatMap(p => (p.loadout?.weapons ?? []).map(w => w.weapon_id)).filter(id => rows.has(id)))];
  if (rows.has('melee') && !ids.includes('melee')) ids.push('melee');
  const cells = new Map<string, string>(), sir = new Map<string, number>(baseSir);
  const entries = ids.map(id => {
    const w = rows.get(id)!;
    const stock = cell(w), fn = baseSir.get(stock) ?? w.sir_fn;
    if (fn == null) return null;
    const pinned = (HIT_AUDIO_CLASS_PINNED as Record<string, string>)[id];
    const cls = pinned ? `${HIT_AUDIO_PIN_PREFIX}${id}`
      : (HIT_AUDIO_ROLE_CLASS as Record<string, string>)[w.role ?? ''] ?? HIT_AUDIO_FALLBACK_CLASS;
    return { id, stock, fn, cls };
  });
  // Compiler.hit_plan raises on an uncovered cell without sir_fn. _check_sir_effects
  // then falls back to the stock table and reports NO ROW for that weapon.
  if (entries.some(e => e == null)) return { cells, sir };
  const valid = entries.filter((e): e is NonNullable<typeof e> => e != null);
  if (!config.hit_audio_rekey) {
    for (const e of valid) { cells.set(e.id, e.stock); if (!sir.has(e.stock)) sir.set(e.stock, e.fn); }
    return { cells, sir };
  }
  const classOrder = Object.keys(HIT_AUDIO_CLASS_POOLS);
  const rank = (cls: string) => cls.startsWith(HIT_AUDIO_PIN_PREFIX) ? -1
    : classOrder.includes(cls) ? classOrder.indexOf(cls) : classOrder.length;
  const occupants = new Map<string, Set<string>>();
  for (const e of valid) {
    if (!occupants.has(e.stock)) occupants.set(e.stock, new Set());
    occupants.get(e.stock)!.add(`${e.cls}|${e.fn}`);
  }
  const groups = [...new Map(valid.map(e => [`${e.cls}|${e.fn}|${e.stock}`, e])).values()]
    .sort((a, b) => rank(a.cls) - rank(b.cls) || a.fn - b.fn || (a.stock < b.stock ? -1 : a.stock > b.stock ? 1 : 0));
  const assigned = new Map<string, string>();
  const taken = new Set(baseSir.keys());
  const reserved = new Set(HIT_AUDIO_RESERVED_CELLS.map(c => c.join(',')));
  const free = HIT_AUDIO_FREE_CELLS.map(c => c.join(',')).filter(c => !taken.has(c) && !reserved.has(c));
  for (const e of groups) if (occupants.get(e.stock)?.size === 1 && !assigned.has(`${e.cls}|${e.fn}`)) {
    assigned.set(`${e.cls}|${e.fn}`, e.stock); taken.add(e.stock);
  }
  for (const e of groups) {
    const key = `${e.cls}|${e.fn}`;
    if (assigned.has(key)) continue;
    while (free.length && taken.has(free[0])) free.shift();
    const target = free.length && taken.size < HIT_AUDIO_MAX_SIR_ROWS ? free.shift()! : e.stock;
    assigned.set(key, target); taken.add(target);
  }
  for (const e of valid) {
    const target = assigned.get(`${e.cls}|${e.fn}`)!;
    cells.set(e.id, target);
    if (!sir.has(target)) sir.set(target, e.fn);
  }
  return { cells, sir };
}

/** Port of compile.py Compiler.validate for checks the mock can reach. */
export function compilerValidation(config: ConfigView, players: Player[], weapons: WeaponView[], covered: boolean,
  perks?: readonly PerkView[], critModifier = 0): CompilerResult {
  const errors: string[] = [], warnings: string[] = [];
  const views = new Map(weapons.map(w => [w.weapon_id, w]));
  const winBy = String(config.scoring.win_by ?? '');
  if (winBy && !['kills', 'survival', 'objective'].includes(winBy))
    errors.push('scoring.win_by must be kills, survival or objective');
  if (!(typeof config.time_limit_s === 'number' && config.time_limit_s > 0))
    errors.push("time_limit_s is required (>0) unless opts.venue_coverage=='full' (A4.8; observed backhaul coverage does NOT lift it — A28.4)");
  const numbers = players.map(p => p.player_num);
  for (const n of numbers) if (!Number.isInteger(n) || n < 1 || n > MAX_PLAYERS)
    errors.push(`player_num ${String(n)} out of range 1..${MAX_PLAYERS} (0 reserved, A5.1)`);
  const duplicates = [...new Set(numbers.filter(n => numbers.filter(other => other === n).length > 1))].sort((a, b) => a - b);
  if (duplicates.length) errors.push(`duplicate player_num across roster: [${duplicates.join(', ')}]`);
  const tids = config.teams.map(t => t.tid);
  if (new Set(tids).size !== tids.length) errors.push('duplicate team tid');
  const invalid = [...new Set(tids.filter(tid => tid < 0 || tid > 3))].sort((a, b) => a - b);
  if (invalid.length) errors.push(`team tid(s) [${invalid.join(', ')}] outside 0-3 (F35): the IR word's team field is 2 bits -- a $TID of 4 or higher makes teammates damage each other and can let a gun read its own shots as friendly`);
  if (OBJECTIVE_MODES.includes(config.mode)) {
    const tidOf = new Map(config.teams.map(t => [t.team_id, t.tid]));
    const onNeutral = [...new Set(players.filter(p => tidOf.get(p.team_id ?? '') === 2).map(p => p.player_id))].sort();
    if (onNeutral.length) errors.push(`F82: mode '${config.mode}' cannot roster players on $TID 2 (${onNeutral.join(', ')}), the team a NEUTRAL grenade hill broadcasts, so they read every uncaptured point as their own and take no hill damage. Use tid 0, 1 or 3.`);
    const neutralTeams = config.teams.filter(t => t.tid === 2).map(t => t.team_id).sort();
    if (neutralTeams.length) errors.push(`F82: mode '${config.mode}' cannot have a team on $TID 2 at all (${neutralTeams.join(', ')}), the value a NEUTRAL hill broadcasts, and anyone moved onto it later reads every uncaptured point as their own. Use tid 0, 1 or 3.`);
    const distinct = new Set(tids);
    if (distinct.size > 3) errors.push(`F97: mode '${config.mode}' supports at most 3 teams (tids [0, 1, 3]); this config has ${distinct.size}. A neutral hill broadcasts team 2 and the IR team field is 2 bits, so a fourth player has to share a team -- an FFA hill caps at three players`);
  }
  errors.push(...modeParamErrors(config.mode, config.mode_params));
  const vip = config.vip_player_id;
  if (vip != null && !players.some(p => p.player_id === vip))
    errors.push(`vip_player_id '${vip}' is not on the roster: pick the VIP from the players in this session`);
  else if (vip == null && (config.presentation as { preset?: string } | undefined)?.preset === 'vip')
    warnings.push("VIP profile with no VIP named — set config.vip_player_id or nobody's headset holds the white VIP state and vip_hit / vip_down have no subject");
  if (config.mode === 'ffa' && new Set(tids).size > 1)
    errors.push('ffa requires a single $TID (one team); identity is $PSET, not $TID (A4.1)');
  if (config.mode === 'lms' && config.respawn?.type === 'auto')
    errors.push("lms cannot use respawn.type=='auto'");
  const profile = (config.respawn ?? {}) as unknown as Record<string, unknown>;
  for (const [name, value, options] of [
    ['protect_s', Object.hasOwn(profile, 'protect_s') ? profile.protect_s : TIMED_PROTECT_S_DEFAULT, TIMED_PROTECT_S_OPTIONS],
    ['weapon_delay_ms', Object.hasOwn(profile, 'weapon_delay_ms') ? profile.weapon_delay_ms : WEAPON_DELAY_MS_DEFAULT, WEAPON_DELAY_MS_OPTIONS],
    ['station_protect_s', Object.hasOwn(profile, 'station_protect_s') ? profile.station_protect_s : STATION_PROTECT_S_DEFAULT, STATION_PROTECT_S_OPTIONS],
  ] as const) {
    if (typeof value === 'boolean' || !(options as readonly unknown[]).includes(value))
      errors.push(`respawn.${name} must be one of ${options.join(', ')}`);
  }
  const source = config.station_source;
  const sourceVocab = Object.entries(STATION_SOURCE_DESCRIPTIONS).sort(([a], [b]) => a.localeCompare(b))
    .map(([id, desc]) => `${repr(id)} (${desc})`).join(', ');
  if (STATION_GATED_MODES.includes(config.mode)) {
    if (!source) errors.push(`mode ${repr(config.mode)} needs a station/objective source (Tier 1): set config.station_source to one of: ${sourceVocab}`);
    else if (!Object.hasOwn(STATION_SOURCE_DESCRIPTIONS, source))
      errors.push(`unknown station_source ${repr(source)} for mode ${repr(config.mode)}: use one of ${sourceVocab}`);
    else if (OBJECTIVE_MODES.includes(config.mode)) {
      const points = (config as unknown as { control_points?: unknown }).control_points;
      if (source === 'grenade' && typeof points === 'number' && Number.isInteger(points) && points > 1)
        errors.push(`F88: ${points} control points on a grenade source is not buildable, because a hill beacon carries no station id, so two grenades in range are indistinguishable on the wire and would fight over the same point. Run ONE point (koth), or supply a station source that names its point`);
      if (source === 'grenade') warnings.push('SETUP: POWER-CYCLE THE GRENADE SO IT STARTS NEUTRAL, SET IT TO HILL MODE, AND PLACE IT (A HILL THAT STARTS ALREADY OWNED SKEWS THE WHOLE MATCH, AND ONLY A POWER CYCLE GUARANTEES NEUTRAL). ONE POINT ONLY (F88)');
      else if (source === 'phone') warnings.push('SETUP: THE CONTROL POINT IS A BLUETOOTH STATION (KIND CONTROL; ARMING RESETS THE POINT, SO DO NOT POWER-CYCLE IT): CONFIRM IT SHOWS MC-ARMED FOR THIS GAME, KEEP IT AWAKE ON THE POINT, AND CHECK ITS BATTERY');
      else warnings.push('SETUP: THE IR STATION IS UNPROVEN (WE HAVE NEVER HAD ONE ON THE BENCH, SO NOTHING CONFIRMS IT SPEAKS THE PROTOCOL OUR NODES READ): PLACE AND POWER IT, AND CHECK IT READS NEUTRAL BEFORE THE WHISTLE, OR USE OBJECTIVE SOURCE PHONE');
    }
  }
  for (const p of players) {
    for (const item of p.loadout?.weapons ?? []) if (!rows.has(item.weapon_id))
      errors.push(`unknown weapon_id '${item.weapon_id}'`);
    if (perks && p.loadout?.perk && !perks.some(perk => perk.perk_id === p.loadout.perk))
      errors.push(`unknown perk_id ${repr(p.loadout.perk)}`);
  }

  const seenMag = new Set<string>();
  for (const p of players) {
    const ov = p.loadout?.overrides;
    const pool = (ov?.max_hp ?? config.health.max_hp) + Math.max(0, Math.min(255, ov?.max_armor ?? config.health.max_armor));
    const kit = p.loadout?.weapons ?? [];
    kit.forEach((selection, slot) => {
      const w = rows.get(selection.weapon_id);
      if (!w) return;
      const sidearm = (views.get(w.weapon_id)?.tags ?? w.tags ?? []).includes('sidearm');
      if (slot > 0 && !sidearm) return;
      const kind = slot > 0 ? 'backup' : kit.length === 1 ? 'only' : 'primary';
      const key = `${w.weapon_id}|${pool}|${w.mag}|${kind}`;
      if (seenMag.has(key)) return;
      seenMag.add(key);
      const hits = htk(w, pool), rounds = rtk(w, pool);
      if (!rounds || w.mag >= rounds) return;
      if (sidearm) {
        const what = kind === 'only' ? 'is your only weapon' : kind === 'backup' ? 'is your backup' : 'is the gun you fight with (a sidearm in the PRIMARY slot)';
        warnings.push(`${w.weapon_id} ${what} and cannot kill on one magazine at this pool - it will need a reload (mag ${w.mag} < ${rounds} rounds for ${hits} hits at ${pull(w)} dmg vs ${pool} pool)`);
      } else warnings.push(`PRIMARY ${w.weapon_id.toUpperCase().replace(/_/g, ' ')} CANNOT KILL ON ONE MAGAZINE: mag ${w.mag} < ${rounds} rounds for ${hits} hits at ${pull(w)} dmg vs a ${pool} pool — a reload mid-kill (docs/weapon-design.md §2.1)`);
    });
  }

  const plan = hitPlan(config, players);
  const sir = plan.sir;
  const flagged = new Set<string>();
  for (const p of players) (p.loadout?.weapons ?? []).forEach((selection, slot) => {
    const id = selection.weapon_id, w = rows.get(id);
    if (!w || flagged.has(id)) return;
    if (views.get(id)?.lethal === false || w.lethal === false) {
      if (slot === 0) {
        flagged.add(id);
        errors.push(`${id} cannot kill (lethal: false) and is in the PRIMARY slot. A support weapon belongs in slot 2, where carrying it costs the player their backup gun (weapon-design.md §7.4)`);
      }
      return;
    }
    const key = plan.cells.get(id) ?? cell(w), fn = sir.get(key);
    if (fn == null) {
      flagged.add(id);
      errors.push(`${id} keys $SIR ${key} with NO ROW in the pushed table, so every hit is silently dropped (ir-effects-design.md §6.2)`);
    } else if (SIR_NO_POOL_FNS.has(fn)) {
      flagged.add(id);
      errors.push(`${id} keys $SIR ${key} → function ${fn}, which registers a hit but moves no pool: the weapon DEALS NO DAMAGE (ir-effects-design.md §6.2)`);
    } else if (!SIR_GRANT_FNS.has(fn) && !dmg(w)) {
      flagged.add(id);
      errors.push(`${id} deals 0 DAMAGE on $SIR ${key} → function ${fn}, a damage row: every hit registers and takes nothing off the pool, so the weapon cannot kill (ir-effects-design.md §6.2)`);
    } else if (SIR_GRANT_FNS.has(fn)) {
      flagged.add(id);
      const dual = [16, 17, 20, 21].includes(fn) ? ' (16/17/20/21 are DUAL-POLARITY: they still damage enemies, 17/21 armor-piercing)' : '';
      warnings.push(`${id} keys $SIR ${key} → function ${fn}, a GRANT (heal/armor/shield): it HEALS an ally it hits${dual} (ir-effects-design.md §6.2)`);
    } else if (fn === 36 || fn === 37) {
      flagged.add(id);
      // _to_gc currently passes no crit option, so the mock's normal value is zero.
      const mult = fn === 36 ? 1 + critModifier / 200 : 1 + 2 * critModifier / 100;
      if (mult !== 1) warnings.push(`${id} keys $SIR ${key} → function ${fn}, a CONFIRMED HEADSET-ONLY multiplier row: at this game's compiled crit_modifier (${critModifier}) a headset hit lands floor(${Number.isInteger(mult) ? mult.toFixed(1) : mult}x its $WEAP t5); a gun-body hit lands the raw t5 (x1) (bench 2026-09-11). The published htk/ttk_ms are the GUN-BODY (guaranteed-kill) number, so an all-headset kill needs fewer hits than published (ir-effects-design.md §6.2)`);
      else warnings.push(`${id} keys $SIR ${key} → function ${fn}, a HEADSET-ONLY multiplier row: at this game's compiled crit_modifier (${critModifier}) the multiplier is 1.0x, so a headset hit lands the same as a gun-body hit (bench 2026-09-11, ir-effects-design.md §6.2)`);
    } else if (SIR_ARMOR_PIERCING_FNS.includes(fn)) {
      flagged.add(id);
      warnings.push(`${id} keys $SIR ${key} → function ${fn}, ARMOR-PIERCING: it bypasses armor and shields, so htk is ceil(hp/dmg), not ceil(pool/dmg) (ir-effects-design.md §6.2)`);
    } else if (!SIR_PLAIN_DAMAGE_FNS.includes(fn)) {
      flagged.add(id);
      const plain = `[${[...SIR_PLAIN_DAMAGE_FNS].sort((a, b) => a - b).join(', ')}]`;
      warnings.push(`${id} keys $SIR ${key} → function ${fn}, which is NOT in the bench-confirmed plain-damage set ${plain}: its effect on the victim is uncharacterised (ir-effects-design.md §6.2)`);
    }
  });
  if ((config.scoring.frag_limit ?? 0) > 0 && (!winBy || winBy === 'kills') && !covered)
    warnings.push('frag_limit on a non-full-coverage venue is an in-coverage early end only; the guaranteed end is time_limit_s (A4.8) — winner is provisional until recap');
  if (config.stun != null) {
    if (typeof config.stun !== 'object' || Array.isArray(config.stun))
      errors.push('stun must be an object {duration_s} (F15/A20) -- {} for the 10 s default');
    else {
      const duration = Object.hasOwn(config.stun, 'duration_s') ? config.stun.duration_s : 10;
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 1 || duration > 60)
        errors.push(`stun.duration_s ${repr(duration)} out of range 1..60 s (F15/A20)`);
      if (config.hit_audio_rekey)
        errors.push('stun cannot be combined with hit_audio_rekey (F15/A20): the re-key would move the <8,0> weapons off the EMP cell with their damage intact');
      const sources = [...new Set(players.flatMap(p => (p.loadout?.weapons ?? []).map(w => w.weapon_id)).filter(id => {
        const w = rows.get(id); return w && cell(w) === '8,0';
      }))].sort();
      warnings.push(sources.length
        ? `stun: ${sources.join(', ')} fire on IR cell <8,0>, the EMP cell while stun is on -- they STUN (fn 23: no damage, the victim's accuracy drops to 0 and recovers) instead of dealing damage`
        : 'stun is on but no rostered weapon fires on cell <8,0> and MC arms no station for it: nothing in this game can stun (the source is a $WEAP t3=8 slot or a proto-8 station)');
    }
  }
  if (config.health.max_armor === 0 && config.health.max_hp > 0 && config.health.max_hp < 45
    && players.some(p => p.loadout?.perk === 'armor_piercing')) {
    const hp = config.health.max_hp;
    warnings.push(`this is a shield-only game (${hp} HP, no armour) and someone carries Armour Piercing, which IGNORES the shield entirely (bench 2026-09-18): the whole fight is the ${hp} HP underneath, and the shield buys nothing against it. The Shields preset carries 45 HP for exactly this reason (weapon-design.md §7.3)`);
  }
  return { errors, warnings };
}

// Port of configcheck.py frag_limit_needs_coverage() and compile.py Compiler.validate() warnings.
export function compilerWarnings(config: ConfigView, players: Player[], weapons: WeaponView[], covered: boolean): string[] {
  return compilerValidation(config, players, weapons, covered).warnings;
}

// Port of state.py Session._validate(): a hold target at the time limit cannot end a match. F572: the target counts
// the time summed across hills, so `hills` assigned CONTROL stations can bank `hills` times the limit.
export function holdTargetWarning(config: ConfigView, hills = 1): string | null {
  const hold = config.scoring.hold_target_s;
  const limit = config.time_limit_s;
  const n = Math.max(1, hills);
  if (!Number.isInteger(hold) || !Number.isInteger(limit) || hold == null || limit == null || hold < limit * n) return null;
  const mmss = (value: number) => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  const past = n === 1 ? `THE TIME LIMIT (${mmss(limit)})` : `THE TIME LIMIT (${mmss(limit)}) TIMES ${n} HILLS`;
  return `SETUP: THE HOLD TARGET (${mmss(hold)}) IS AT OR PAST ${past}: THE MATCH WILL ALWAYS END ON THE CLOCK, NEVER THE TARGET. LOWER THE TARGET OR RAISE THE TIME LIMIT`;
}
