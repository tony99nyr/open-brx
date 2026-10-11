// Shared game-summary helpers (GAMES cards, the DESIGNER rail, the KIT rules chip) — one generator everywhere.
import type { GameConfig, HealthPreset, LoadoutPool, ModeInfo, PoolEmptyCode, StationSourceId } from '../api/types';
import { STATION_SOURCE_IDS } from '../api/types';
import { PRESET_LABELS } from '../api/contract.gen';
import { isKillScored } from '../rules/scoring';


/** The win rule in force for this config. ModeInfo describes capability; this describes tonight's game. */
export function winLine(cfg: Pick<GameConfig, 'mode' | 'scoring'>, mode?: Pick<ModeInfo, 'win_text'>): string {
  if (!isKillScored(cfg)) return mode?.win_text ?? String(cfg.scoring.win_by).toUpperCase();
  const cap = cfg.scoring.frag_limit;
  if (cap == null) return 'TIME ONLY';
  return `${cfg.mode === 'ffa' ? 'FRAG LIMIT' : 'SCORE CAP'} ${cap} / TIME`;
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
export function emptyRequiredSlots(pool: LoadoutPool | null): { primary: boolean; secondary: boolean; perk: boolean; any: boolean } {
  const r = pool?.reasons;
  // `unplayable` joins `off` as a NON-blocking code (round-3 MERGE-4): it is OUR build's limitation,
  // not a rule the operator wrote. The server drops the pick, re-fits every loadout to a legal weapon
  // and warns — so a console that greyed PLAY/CONTINUE here would trap them behind a control that
  // cannot fix it, which is the F146 failure exactly. `poolEmptyMessage` still says what happened.
  const blocks = (code?: PoolEmptyCode) => !!code && code !== 'off' && code !== 'unplayable';
  const primary = blocks(r?.primary), secondary = blocks(r?.secondary_weapons), perk = blocks(r?.perks);
  return { primary, secondary, perk, any: primary || secondary || perk };
}

/** The console's own words for a pool-empty code (policy.py's copy of these is the HUD's, `_R_*`,
 *  shown verbatim to a PLAYER — this is the OPERATOR's, and names the control to fix). `slot` picks
 *  the pronoun; `needs_secondary` only ever occurs on the perk slot but is worded generically in case
 *  a second swap-effect perk ever lands on another slot. */
export function poolEmptyMessage(slot: 'PRIMARY' | 'SECONDARY' | 'PERK', code: PoolEmptyCode, name?: string | null): string {
  // F221 polish r1: one colon, not an em dash. These feed a RED alert (`designer-slot-empty-pool`,
  // `games-locked-banner`), and the wording rule is WHAT: DO, one separator.
  switch (code) {
    case 'fixed_missing': return `${slot}'S FIXED PICK IS NOT IN THIS GAME: CHOOSE A DIFFERENT ONE.`;
    case 'only_ids_missing': return `${slot}'S ALLOW-LIST NAMES NOTHING THIS GAME HAS: ADD A VALID ID OR CLEAR IT.`;
    case 'needs_secondary': return 'QUICK SWITCH NEEDS A SECONDARY: TURN THE SECONDARY ON, OR PICK ANOTHER PERK.';
    // round-3 UX-2: NAMES the weapon. `name` is the catalogue row's name where the caller has it (the
    // rule only carries an id); without one the sentence still says the right thing about the slot.
    case 'unplayable': return `${(name ?? `THE ${slot}'S PICK`).toUpperCase()} CANNOT BE PLAYED: ITS HIT ROW DEALS NO DAMAGE (CATALOGUE), PICK ANOTHER WEAPON.`;
    case 'filtered': return `${slot}'S CLASS/ID FILTERS EXCLUDE EVERYTHING: CLEAR ONE, OR SET WHO PICKS TO FIXED.`;
    case 'off': return '';   // never shown — an off slot is not a problem
  }
}




export const HEALTH_PRESET_COPY: { value: Exclude<HealthPreset, 'custom'>; label: string; hint: string }[] = [
  { value: 'standard', label: 'STANDARD', hint: '45 HP, 70 armour, no shield' },
  { value: 'shields', label: 'SHIELDS', hint: '45 HP, no armour, 105 shield that recharges after a few seconds clear of damage' },
  { value: 'hardcore', label: 'HARDCORE', hint: '45 HP, no armour, no shield — nothing regenerates' },
];

// F70 — the objective-source vocabulary. The IDS are NOT mirrored here: they come from the generated
// `STATION_SOURCE_IDS` (mcp/brx_mcp/mc/types.py `STATION_SOURCES`), and this map is keyed by
// `StationSourceId`, so a source added on the server fails this file's compile instead of quietly
// missing from the control. Only the OPERATOR COPY is ours — the server's `desc` is written for an API
// error, not for a button. It is a CLOSED list server-side (a PUT with anything else 400s naming every
// legal value), so the console offers exactly these and nothing else. An unknown value that somehow
// arrives in a config still renders (see `objectiveLine`) rather than vanishing — a field we cannot
// show is a field nobody can fix.
const SOURCE_COPY: Record<StationSourceId, { label: string; hint: string }> = {
  grenade: { label: 'GRENADE · POST-MVP', hint: 'POST-MVP: a BRX Smart Grenade in hill mode drives exactly ONE point (F88). Phones say HILL CAPTURED and HILL LOST from its beacon, never HILL CONTESTED, and a capture call can be missed.' },
  ir_station: { label: 'IR STATION', hint: 'A BRX station / Utility Box speaking $CAPTURE. It is unproven, so its announcement behaviour is unknown.' },
  phone: { label: 'PHONE', hint: 'The MVP hill: a spare phone in the UTILITY role, or a StickS3, captured by presence and armed by MC at muster. Phones say HILL CAPTURED, HILL LOST and HILL CONTESTED; it can name its point.' },
};
export const STATION_SOURCES: { value: StationSourceId; label: string; hint: string }[] =
  STATION_SOURCE_IDS.map(value => ({ value, ...SOURCE_COPY[value] }));
/** the OBJECTIVE row shown on GAMES and in the designer rail, or null for a mode with no station source */
export const objectiveLine = (cfg: GameConfig): string | null => {
  const src = cfg.station_source;
  if (!src) return null;
  if (src === 'grenade') return 'GRENADE HILL · ONE POINT · POST-MVP';
  if (src === 'phone') return 'BLUETOOTH HILL · PHONE · PRESENCE';
  return (STATION_SOURCES.find(s => s.value === src)?.label ?? src.toUpperCase());
};


/** one human line for a saved game / the live config — the same generator everywhere (cards, summary, HUD-like) */
export function rulesLine(cfg: GameConfig, weapons: { weapon_id: string; name: string }[], perks: { perk_id: string; name: string }[]) {
  const lp = cfg.loadout_policy; if (!lp) return '';
  const nm = (id?: string | null) => weapons.find(w => w.weapon_id === id)?.name ?? perks.find(k => k.perk_id === id)?.name ?? id ?? '';
  const out: string[] = [];
  if (lp.preset !== 'custom') out.push(PRESET_LABELS[lp.preset]);
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

