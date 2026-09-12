"""Wire shapes from docs/spec/contracts.md (A5) as TypedDicts + the constants (§9).

These are the ONLY shapes lanes share. Keep field names identical to contracts.md; additive
fields are fine, renames are an amendment.
"""
from __future__ import annotations

from typing import Literal, NotRequired, TypedDict, get_args

# ---- §9 constants (single source; modules reference by name) ----
ASSIST_WINDOW_MS = 4000
MULTI_KILL_MS = 4000
FEEDBACK_MAX_AGE_MS = 3000
STATUS_HEARTBEAT_MS = 2000
STALE_AFTER_MS = 8000
# A24/M2: how far apart two cap-reaching kills may be and still count as the SAME moment. contracts.md
# §7 gives no single number -- it says phone clocks "drift <<1 s over a match" after a lobby re-sync, so
# 1 s is the width of the band inside which MC cannot tell which of two kills landed first. Two players
# reaching the frag cap inside it are reported as a TIE rather than decided by MC's arrival order.
CLOCK_TIE_MS = 1000
# F119: the smallest shot count an accuracy number is worth believing. Hits arrive per EVENT and shots
# only on the ~2 s status heartbeat, so a row with a handful of shots swings wildly between samples and
# can read over 100 %. `honors()` already refused SHARPSHOOTER below this; `ScoreRow.acc_provisional`
# now says the same thing about the live number instead of leaving the UI to guess.
ACC_MIN_SHOTS = 10
# Past this, a node has not merely gone quiet — it is gone (phone asleep, app closed, gear packed
# away). Everything else the board would say about it (gun link lost, clock unsynced, wrong wi-fi,
# screen off) is a CONSEQUENCE of that, and listing them as separate faults turns a switched-off
# tagger into a wall of red alarms (field 2026-09-02).
OFFLINE_AFTER_MS = 10 * 60 * 1000
SYNC_FRESH_MS = 10000
# A32: how long `status.preflight.gun_linked` must stay TRUE CONTINUOUSLY before the link itself is
# accepted as proof that a headset is attached. A gun with NO headset accepts a BLE link and answers a
# `$PING`, then drops it within ~6 s (manual/hardware.md, manual/dev.md); switching a linked headset off
# makes the gun send `$DISCONNECT,*` and drop the same way. So a link that SURVIVES is the headset --
# 10 s is the ~6 s drop plus margin for a slow phone and the ~2 s status heartbeat. Shorter and a
# headless gun's dying link would read as proven; much longer and the board sits amber for no reason.
HEADSET_LINK_PROOF_MS = 10_000
LATE_ARM_GRACE_MS = 8000
CONFIG_TTL_MS = 1_800_000
MAX_PLAYERS = 63          # wire ids 1..63; 0 reserved (tutorial / unknown shooter)
DEATH_LATCH_MS = 2000
RESYNC_PROBE_S = 10
DEFAULT_RUNWAY_S = 120
PROTOCOL_V = 1

# ---- A29: the app build MC is compatible with ----
# Versions are SEMVER and the tiers carry meaning (contracts A29): MAJOR = anything the game or the wire
# depends on (protocol, engine rules, bundle shape), MINOR = HUD-facing features with no game impact,
# PATCH = fixes. Keep these two in step with `app/package.json` — they ARE the compatibility statement.
#
# ⚠️ While the app is on 0.x, semver's own rule applies: MINOR is the breaking tier, so the comparison is
# `(major, minor)` while major == 0 and `major` alone from 1.0.0 on. `APP_MINOR` is read ONLY in the 0.x
# regime; once the app cuts 1.0.0, bump APP_MAJOR and APP_MINOR stops mattering.
APP_MAJOR = 0
APP_MINOR = 2


def parse_app_ver(app_ver: str | None) -> tuple[int, int, int] | None:
    """`"0.1.9+abc123-dirty"` → `(0, 1, 9)`; anything that is not `MAJOR.MINOR.PATCH` → None.

    The build metadata after `+` is deliberately ignored for comparison (semver says it is not part of
    precedence): two builds of 0.1.9 from different shas are the same VERSION, and the sha is for the
    operator's eyes. A node that reports something unparsable (the old hard-coded `hud-0.2`, or a fake)
    is UNKNOWN, never incompatible — see `readiness()`.

    ⚠ A PRERELEASE tag is stripped too, so `0.2.0-rc1` parses as `(0, 2, 0)` and ranks EQUAL to
    `0.2.0`, not below it as semver precedence would have it. That is the behaviour we want and not an
    oversight: MC uses this for one thing, "which build is the field on", and an rc of 0.2.0 IS a 0.2.0
    build for compatibility. Ranking it below would amber every rc phone in the field with OLDER THAN
    THE RELEASE the day before a cut. If a release ever has to out-rank its own rc, this returns a
    4-tuple with a prerelease sort key — nothing else in MC compares versions."""
    if not isinstance(app_ver, str):
        return None
    core = app_ver.strip().split("+", 1)[0].split("-", 1)[0]
    parts = core.split(".")
    if len(parts) != 3 or not all(x.isdigit() for x in parts):
        return None
    try:
        return (int(parts[0]), int(parts[1]), int(parts[2]))
    except ValueError:
        return None


def app_tier() -> str:
    """What MC needs, in the words the blocker uses: `"0.1"` on 0.x, `"2"` once the app is 1.0.0+."""
    return f"{APP_MAJOR}.{APP_MINOR}" if APP_MAJOR == 0 else str(APP_MAJOR)


def compatible(app_ver: str | None) -> bool | None:
    """True / False / None (unparsable — the caller says UNKNOWN, and A1 says amber never blocks)."""
    v = parse_app_ver(app_ver)
    if v is None:
        return None
    return (v[0], v[1]) == (APP_MAJOR, APP_MINOR) if APP_MAJOR == 0 else v[0] == APP_MAJOR

ArmState = Literal["idle", "connected", "kitted", "lobby", "armed", "live"]
# The MC session's own phase vocabulary. The SERVER owns it: `state.py PHASES = get_args(Phase)` is the
# tuple every phase guard tests against, and the console's `Phase` is generated from this alias, so a new
# phase cannot reach one side without the other.
Phase = Literal["muster", "build", "kit", "lobby", "armed", "live", "recap"]


# ---- §1 armory ----
class BleId(TypedDict, total=False):
    address: str
    uuid: str
    tail: str


class ArmoryRecord(TypedDict):
    gun_id: str
    sticker: str
    headset_pin: str
    ble: BleId
    gen: Literal["gen2_3", "gen1"]
    fw: str | None
    labeled: bool
    notes: NotRequired[str]


class ScanRow(TypedDict):
    tail: str
    name: str
    basename: str
    gun_id: str | None
    rssi: int
    identity: Literal["ok", "unconfirmed", "reverted", "unknown"]
    t: int


# ---- §2 people ----
class WeaponSel(TypedDict):
    weapon_id: str


class LoadoutOverrides(TypedDict, total=False):
    """Per-player HP/armour handicap (modes §1.1). Both keys are optional and BOTH may be absent:
    `state.py _check_loadout` drops the whole `overrides` key when neither survives validation."""
    max_hp: int          # 1..999 (`state.py _check_loadout`); 0 is a corpse, not a pool
    max_armor: int       # 0..999 -- 0 is legal and means "one shot with a sniper"


class Loadout(TypedDict):
    """weapons[] is canonical: [primary] or [primary, secondary]; `perk` is its OWN slot and rides
    beside a secondary weapon (AR + pistol + Quick Switch). The one exception: a perk whose
    effects.alt_reload is true (Easy Reload) takes the ALT button, so the server refuses it beside
    a second weapon; the UI warns and drops the other one (A9/A14, loadout.md §2).
    """
    weapons: list[WeaponSel]              # [primary] or [primary, secondary]; index == gun slot; NEVER empty (A10)
    perk: NotRequired[str | None]         # A14: the perk slot — rides beside a secondary weapon (loadout.md §2); an ALT-button perk (easy_reload) is the one that can't
    overrides: NotRequired[LoadoutOverrides]


class Team(TypedDict):
    team_id: str
    name: str
    color: str
    tid: int


class Player(TypedDict):
    player_id: str
    player_num: int            # 1..63 on the wire ($PSET token 1); 0 reserved
    display: str
    team_id: str | None
    node_id: str | None
    gun_id: str | None
    loadout: Loadout
    voice: str
    ready: bool
    # A15 (optional): {role: sound id} picks for the $PSET voice fields + the kill line -- WHICH death scream /
    # pain line / respawn cry of the family the gun plays (voices.PSET_ROLES + "kill"). Absent = the family defaults.
    voice_slots: NotRequired[dict[str, str]]


class RosterEntry(TypedDict):
    player_id: str
    player_num: int
    display: str
    team_id: str | None


# ---- §3 config + frames ----
class Respawn(TypedDict):
    type: Literal["auto", "scanner", "none"]
    delay_s: int


class Scoring(TypedDict):
    frag_limit: int | None
    win_by: str


class Health(TypedDict):
    max_hp: int
    max_armor: int


class Siphon(TypedDict):
    """S14: heal the killer on each kill (Fortnite/CoD "health on kill").

    Both are **added** to the killer's own pool and clamped by the gun ($LIFE is additive-clamped),
    so they can never overfill. There is deliberately no `shield`: that pool is IR-only (P16), so a
    number here would be written and silently do nothing.
    """
    hp: int
    armor: int


# `policy.CHOICES` -- who fills a slot. `policy._check_rule` refuses anything else (and refuses "off"
# for the primary: a player with no primary weapon has nothing to play with).
SlotChoice = Literal["player", "host", "fixed", "off"]
# `policy.PRIMARY_KINDS` / `SEC_KINDS` / `PERK_KINDS` together. A POLICY kind, never a request kind: a
# pistol is a "weapon" on the wire, and "sidearm" (A12) narrows a weapon slot to the sidearm-tagged rows.
ItemKind = Literal["weapon", "perk", "sidearm"]
# `policy.PRESET_NAMES` -- the named rulesets, plus "custom" for a hand-edited one.
LoadoutPreset = Literal["open", "no_heavies", "snipers", "custom"]


class SlotRule(TypedDict):
    choice: SlotChoice
    kinds: list[ItemKind]                 # primary/secondary: "weapon" | "sidearm" (A12); the perk rule is always ["perk"] (A14)
    exclude_tags: list[str]
    exclude_ids: list[str]
    only_ids: list[str]
    fixed_id: str | None


class LoadoutPolicy(TypedDict):
    """A14: `perk` is the third rule (kinds always ['perk']; choice may be 'off'). No legacy shape
    is supported (Tony 2026-09-04).
    """
    preset: LoadoutPreset
    hud_select: bool
    primary: SlotRule
    secondary: SlotRule
    perk: SlotRule                        # A14: perks are their own slot (choice may be "off")


class LoadoutPool(TypedDict):
    """allowed ids per slot, catalog order, computed server-side (loadout.md §3.2); `perks` is the
    perk slot's list (A14).
    """
    primary: list[str]
    secondary_weapons: list[str]
    perks: list[str]                      # A14: the perk slot's pool


class PerkEffects(TypedDict, total=False):
    """The effect knobs the compiler acts on -- exactly `perks.EFFECT_KEYS`, which `PerkCatalog.__init__`
    refuses a perks.json row for exceeding. Every key is optional: a row carries only what it changes."""
    max_armor_add: int      # added to $PSET armour, capped at 255 (`compile.armed_armor`)
    ammo_mult: float        # scales the clip/reserve the head writes
    reload_mult: float      # scales the weapon's reload time
    alt_reload: bool        # A14: claims the ALT button ($BMAP,1,97) -- cannot ride with a second weapon
    switch_mult: float      # scales $WEAP tok15, the gun's swap delay (bench 2026-09-04)


class PerkView(TypedDict):
    perk_id: str
    name: str
    desc: str
    tags: list[str]
    mechanism: Literal["passive", "slot_frame"]
    effects: PerkEffects
    verified: bool
    hidden: bool


# Modes whose objective IS a control point on the field (F70). Three modules need to agree on this:
# the compiler ships the protocol-15 `$SIR` row for them and enforces F82, `state.py` refuses a
# tid-2 team in one, and the scorer reads their possession. `ctf`/`cs`/`bomb` also gate on a station
# source, but NOTHING confirms they use this same proto-15/fn-28 mechanism -- do not widen this set
# on the strength of that other gate alone.
OBJECTIVE_MODES = {"domination", "koth"}

# What may be sitting on the field emitting the objective. This used to be a bare truthiness gate --
# any non-empty string satisfied it, including a typo -- so an operator either got an unsatisfiable
# error or "satisfied" it with a word that meant nothing. The value is what the node/host reads the
# objective FROM, and the two are not the same mechanism:
#   * `grenade`    -- a BRX Smart Grenade in hill mode. Protocol-15 `$HIR` beacons every ~5 s, owner
#                     team in the team field, mode in the magnitude (8 hill, 6 respawn). Proven end
#                     to end on hardware 2026-09-10 (F70) and read by `modes/hillbeacon.py`.
#   * `ir_station` -- a Battle Company station / Utility Box emitting `$CAPTURE`-style objective
#                     events (`modes/objectives.py`'s station path, which names its point). ⚠ NOT
#                     confirmed to be this same proto-15/fn-28 mechanism, and we have never had one
#                     on the bench -- it is accepted because that path exists in code, not measured.
#   * `phone`      -- a spare phone in the `utility` role, kind `control` (spec/utility.md §5d): a BLE
#                     control point that captures by PRESENCE (it counts living player adverts inside its
#                     bubble) and announces owner / progress / contested in its own advert. Armed by MC at
#                     muster (`station_config`, A13.5). The only source that can drive MORE than one point
#                     (its advert carries a station id; a grenade's beacon does not, F88), and the only one
#                     that can truthfully say "contested" (F75). Built 2026-09-10/11; heard by every player
#                     phone with no LAN (F94). Added 2026-09-11 (F103): the phone side existed and MC had
#                     no word for it, so a phone-driven KotH could not be configured at all.
STATION_SOURCES = {
    "grenade": "a BRX Smart Grenade in hill mode (protocol-15 beacons; bench-proven 2026-09-10)",
    "ir_station": "a BRX station / Utility Box emitting $CAPTURE objective events (unproven on our bench)",
    "phone": "a spare phone in the utility role as a BLE control point, capture by presence (spec/utility.md §5d)",
}


# A13 / spec/utility.md §5: what a utility phone can be. Mirrors `KIND` in `app/src/beacon.js` (the advert
# byte 8) and `KIND_LABEL` in `app/src/utility.js`; a `station_config` naming anything else is refused at PUT.
StationKind = Literal["respawn", "powerup", "extraction", "bomb", "control"]
STATION_KINDS = get_args(StationKind)
STATION_TEAM_ANY = 255        # advert byte 9 "any team" (`TEAM_ANY` in beacon.js); a control point starts neutral


class StationRef(TypedDict):
    """One armed utility item on `GameConfig.stations` -- exactly what `state.py _station_ids()` builds
    (`{"id": a["id"], "kind": a["kind"]}`), sorted by id. Both keys are always present."""
    id: int
    kind: StationKind


class Stun(TypedDict):
    duration_s: NotRequired[int]   # F15/A20: seconds a hit EMP keeps the gun disarmed (default 10, 1..60)


class GameConfig(TypedDict):
    config_id: str
    mode: str
    environment: Literal["indoor", "outdoor"]
    night: bool
    time_limit_s: int | None    # required (>0) on the phone path; None only for full-coverage venues
    respawn: Respawn
    scoring: Scoring
    health: Health
    teams: list[Team]
    led: NotRequired[dict]
    player_num_base: NotRequired[int]   # A6.5
    siphon: NotRequired[Siphon]         # S14: heal-on-kill; absent or {0,0} = off
    stations: NotRequired[list[StationRef]]   # A13.1 (F104): the utility items MC armed for THIS game, when at least one is assigned.
    #                                     Set by `Session._wire_config()` from the ITEMS assignments, never by the
    #                                     operator; a player phone honours only these ids (`engine.js _stationAllowed`) --
    #                                     and when the list is ABSENT (nothing assigned) it honours ANY station (the hand-armed fallback).
    station_source: NotRequired[str]    # F70: what is emitting this game's objective -- `STATION_SOURCES` above
    #                                     ("grenade" = a BRX Smart Grenade in hill mode, "ir_station" = a
    #                                     $CAPTURE-speaking station). Present only for the modes that need one
    #                                     (domination/koth/ctf/cs/bomb); `validate()` refuses those without it.
    loadout_policy: NotRequired[LoadoutPolicy]   # A10 (loadout.md §3); filled with the mode default when absent
    presentation: NotRequired[dict]              # A11 (mc/presentation.py): sounds + lights per event, preset or custom
    hit_audio_class: NotRequired[bool]           # A17: per-WEAPON $SIR sounds. DEFAULT OFF -- bench F38: a non-empty
    #                                              $SIR sound REPLACES the $PSET pool sound rather than layering, so
    #                                              turning this on SILENCES the ear-confirmed material layer (armour
    #                                              metal / shield fizz / silent health) on every standard hit.
    hit_audio_rekey: NotRequired[bool]           # A17: give each weapon FAMILY its own $SIR cell so hits sound different
    #                                              per weapon. DEFAULT OFF -- an unmatched cell is silently ignored (the
    #                                              F11 shape), so it stays off until FOLLOWUPS F38/F39 clear it at the bench.
    stun: NotRequired["Stun"]                    # F15/A20: the host-driven STUN (EMP). Present = the `<8,0>` $SIR cell
    #                                              ships as fn 24 (status, no damage) and a proto-8 $HIR disarms the
    #                                              victim's node for `duration_s` (default 10, 1..60). Absent = the stock
    #                                              charge-rifle damage row, byte-for-byte. Source: a $WEAP t3=8 slot
    #                                              (the charge rifle) or a proto-8 station.
    coverage: NotRequired[Literal["full", "partial"]]   # A31/A4.8: the VENUE's radio coverage -- "full" = every phone is on
    #                                              the LAN for the whole match (the only case where `time_limit_s` may
    #                                              be null and where an MC-decided end needs no "verify at MC" warning).
    #                                              Absent/anything else = partial. `compile.full_coverage()` is the one
    #                                              reader; `opts.coverage` (the CLI/sim path) still wins.
    mode_params: NotRequired[dict[str, int | float | bool | str]]
    #                                              A18 (E1): the MODE's own rules -- what its engine declares in `PARAMS`
    #                                              (`modes/params.py`; schema per mode from `GET /api/modes`). Present, and
    #                                              COMPLETE (defaults filled), for every mode whose engine declares any;
    #                                              absent for one that declares none (tdm/ffa/infection), so those configs
    #                                              are byte-identical to before the field existed. Unknown keys and
    #                                              out-of-range values are refused at PUT and again by `validate()`.
    #                                              Rides the wire as-is: a node reads its rules from here, never from a
    #                                              schema of its own.
    vip_player_id: NotRequired[str | None]       # A19 (S10): who the VIP is. Must name a rostered player (`validate()`);
    #                                              MC pushes them the `vip` headset role (`alert.role`) once the match is
    #                                              live and again after each of their respawns. Never stored in a saved
    #                                              game (a preset names no person).


class FrameBundle(TypedDict):
    config_id: str
    player_id: str
    head: list[str]      # config head, NO $SPAWN, no countdown sound; ends with $TID
    spawn: list[str]     # $PLAYX,0 -> $SPAWN,, -> $AMMO... -> $BMAP,0,0
    revive: list[str]
    end: list[str]
    panic: list[str]
    team_flip: NotRequired[dict[str, list[str]]]
    team_flip_take: NotRequired[dict[str, list[str]]]   # F86: per-tid [blank, rest] the node takes the gun with after a flip
    cues: dict[str, str]  # A6.3: key -> PRE-COMPOSED frame the node writes verbatim. countdown, kill,
    #        game_over?, victory?, tick?, klaxon?, multi?, medal?, runway_*?, and the once-per-life
    #        low-health pair hurt?/hurt_led? (hurt_led is an $HLED, not a $PLAY — see compile.cues)
    #        A11: plus one key per presentation EVENT that carries a sound (hit_taken … vip_down); "" = deliberately mute.
    #        A15.2: `spawn` = the character's spawn line, written by the node IMMEDIATELY after the spawn / revive frames
    #        (the head's $PSET ships an empty battleRespawnCry, so the firmware itself says nothing on $SPAWN).
    #        A15.3: `pain_short` / `pain_long` / `pain_melee` = the pain the node plays on a $HIR (the $PSET pain fields ship
    #        empty): a melee word -> pain_melee; damage >= voice.pain_long_min -> pain_long; else pain_short. At most one per
    #        600 ms, none on the lethal hit (the firmware's death scream covers it).
    leds: NotRequired[dict[str, list]]   # A11: event -> [[frame, hold_s], ...] -- the tuned $GLED burst (+ optional $HLED)
    presentation: NotRequired[dict]      # A11: presentation.summary() -- preset + switches, for the UI/HUD
    gun: NotRequired[dict]               # A11.7: {in_play team|dark|health, blank, rest, bands?[[frac,f]]} -- absent for native
    headset: NotRequired[dict]           # A11.6: {in_play, rest, blank, pregame[], start[[f,s]], hit[[f,s]], death[[f,s]], respawn[[f,s]], carrier{tid:[[f,s]]}}
    swap_ms: NotRequired[int]            # 2026-09-04: the weapon-swap delay the gun enforces (max tok15 of slots 0/1, after perks)
    cue_pools: NotRequired[dict[str, list[str]]]   # A15.1: event -> frames; the node picks ONE at random per event; `cues[ev]` is the deterministic first
    voice: NotRequired[dict]             # A15: {id, family, pset{role: id}, kill, rolled{role: id} (A15.1: this push's draws), pools{role: [ids]},
    #                                        spawn: [ids] (A15.2: the spawn pool; `pset.respawn_cry` is "" unless picked),
    #                                        pset_pool: [death-scream ids, one per `pset_pool` frame], pain_long_min: int} (A15.3)
    pset_pool: NotRequired[list[str]]    # A15.3: the node writes ONE of these at random immediately before every `$SPAWN` (spawn and revive),
    #                                      so the firmware's death scream changes per life. One full $PSET per death-scream take; only the
    #                                      deathScream token differs. A pinned `death_scream` (or a one-take family) = one frame = head[4].
    #                                      A17: each take ALSO carries its own hitHp/hitArrmor/hitShield/hitCrit draw (hitaudio.MATERIAL_POOLS).
    sir_pool: NotRequired[list[list[str]]]   # A17: one full `$SIR` table per take -- the node writes one before every `$SPAWN` and again after a
    #                                      lull, so the same weapon does not land the same clip all match. Re-sending `$SIR` rows is the F11 repair
    #                                      path, so the write is safe by construction; the rows are identical apart from their sound tokens.
    hit_audio: NotRequired[dict]         # A17: {rekey: bool, cells{weapon_id: "p,s"}, classes{"p,s": family}, shared[families sharing a cell],
    #                                      material[roles]} -- what the UI/console shows for "what does a hit sound like", and what a bench probe reads.


class Weapon(TypedDict):
    weapon_id: str
    name: str
    cls: str
    desc: NotRequired[str]     # house-written armory blurb (weapons.json `desc`); "" if a row lacks one
    stats: dict
    weap_frame: str
    icon: NotRequired[str]
    verified: NotRequired[bool]
    tags: NotRequired[list[str]]   # A10 policy vocabulary (loadout.md §1.1)
    role: NotRequired[str]
    caution: NotRequired[str]      # A10: human copy for a known LIVE problem (weapons.json `caution`)


# ---- §4 events ----
class Preflight(TypedDict, total=False):
    ssid_ok: bool
    mc_reachable: bool
    auto_join_ok: bool
    cellular_off: bool
    dnd_on: bool
    phone_batt: int
    screen_on: bool
    foreground: bool
    gun_linked: bool
    headset_ok: bool


class Event(TypedDict, total=False):
    type: Literal["hit_taken", "death", "respawn", "team_change", "status", "possession"]
    t: int
    match_id: str | None
    node_id: str
    player_id: str | None
    # hit_taken / death
    shooter_num: int
    shooter_team: int
    dmg: int
    ir_proto: int
    # $HIR tok1 — WHICH sensor caught the shot. 0-3 are ALL HEADSET sensors (the headset carries
    # FOUR, operator-confirmed 2026-09-01; only 0 = front and 1 = back are bench-mapped), 4 = gun
    # body. Forwarded 2026-09-01: it was parsed on the phone and dropped, so a
    # "the headset domes never register" report could only be checked against a frame ring.
    sensor: int
    desync: bool
    # respawn
    resync: bool
    # team_change
    tid: int
    # possession (F70, objective modes) — a CUMULATIVE tally for ONE control point, resent as it grows.
    # `hold_ms` maps a TEAM TID (as a string key on the wire: JSON has no integer keys) to the ms this
    # node observed that team OWNING the point; tid 2 on a hill is NEUTRAL, not a team. `observed_ms` is
    # how long it could hear the point at all, which is what makes the number a stated lower bound
    # rather than a claim. `site` is "A" for the single grenade point (F88: a beacon carries no id).
    # MC merges these by MAX per (site, team) and NEVER by sum — see `scoring._possession`.
    site: str
    hold_ms: dict[str, int]
    observed_ms: int
    source: Literal["beacon", "station"]
    # status
    hp: int
    armor: int
    ammo: int
    alive: bool
    shots: int
    deadline_s: int
    battery: int
    fw: str
    arm_state: ArmState
    t_minus_ms: int
    synced: bool
    dropped: int
    preflight: Preflight


class ScoreRow(TypedDict):
    player_id: str
    display: str
    team_id: str | None
    kills: int
    deaths: int
    assists: int
    shots: int
    hits: int
    accuracy: float | None
    kd: float
    streak: int            # CURRENT streak — 0 for whoever died last. `best_streak` is the one to show.
    medals: list[str]
    # --- additive, 2026-09-11 (F116 / F119). NotRequired, not merely new: `scoring.py` fills all five on
    # every LIVE row, but a session PERSISTED before the change replays rows without them, so a reader that
    # assumes them crashes on last week's recap. Never read one without a fallback. ---
    shots_total: NotRequired[int]      # shots incl. the pre-hot-swap baseline (A6.2); == `shots`
    best_streak: NotRequired[int]      # F116: the LONGEST streak this match. `streak` stayed for compatibility.
    multi_best: NotRequired[int]       # the biggest multi-kill (2 = double, 3 = triple, 4+ = killtacular); 0 = none
    first_blood: NotRequired[bool]     # this player drew first blood
    acc_provisional: NotRequired[bool] # F119: `accuracy` is not settled yet — render it as settling, not as fact
    # 2026-09-12, the same additive rule as the five above: `scoring.rows()` fills both on every LIVE row
    # (0 when nothing landed late) and `rows_csv` has a column for each, but a session PERSISTED before
    # they existed replays rows without them. Kills and deaths scored AFTER the whistle (A6.1 parks them,
    # they do not move the tally) -- read either one only with a fallback.
    after_end_kills: NotRequired[int]
    after_end_deaths: NotRequired[int]


class LogView(TypedDict):
    """A25: one node's log-sync state, as `state.py _set_log()` writes it. Fed ONLY by what the PHONE
    reports (`status.log`, `log_offer`, the `log_data` stream) -- MC asking does not make it `offered`.

    `state` and `last_t` are written on every call; the other three are carried only when the node said
    something about them (`reason` is cleared on every state change, so it never goes stale).
    `complete` sticks until something new happens: the phone idles straight back to `none` when it
    finishes, and taking that literally would erase the one state the operator is waiting for.
    """
    state: Literal["none", "offered", "pulling", "held", "complete"]
    last_t: int
    reason: NotRequired[str]     # the node's own words out of `held(2 facts pending)`
    lines: NotRequired[int]
    bytes: NotRequired[int]


class ReadinessRow(TypedDict):
    """One player's row on the readiness board. `state.py readiness()` is the ONLY producer.

    NOT `total=False`: `readiness()` builds the row as ONE literal, at the end of the loop body, once
    every field it needs (`identity`, `headset`/`headset_proof`, `blockers`/`ambers`, ...) has been
    worked out -- so every path through the function writes every key. A reader guarding for a MISSING
    key is guarding against nothing, while the fields that really are uncertain arrive as an explicit
    `None` and were the ones being read unguarded. What is unknown on this row is the VALUE, never the
    key, and `| None` is how that is said.
    """
    gun_id: str                  # "" for a player with no gun assigned
    sticker: str                 # falls back to the gun_id, then to an em dash
    tail: str                    # "" when the gun is not in the armory
    player_id: str
    player_num: int
    present: bool                # is a node bound to this player at all
    identity: Literal["ok", "unconfirmed", "reverted", "unknown", "manual"]
    node: Literal["none", "linked"]
    headset: Literal["proven", "unknown", "absent"]
    # A32: HOW the headset was proven, so the UI can say it -- `"echo"` = the gun answered the config
    # push, `"link"` = a BLE link that has held for HEADSET_LINK_PROOF_MS, `None` = not proven (yet).
    headset_proof: Literal["echo", "link"] | None
    # Everything below is the NODE's last word, passed through verbatim. `None` = the node has not said
    # it (or no node is bound): the KEY is always here, the answer may not be.
    battery_pct: int | None
    battery_age_ms: int | None
    last_seen_age_ms: int | None    # ms since this node's last packet; None when no node is bound
    gun_linked: bool | None         # `status.preflight.gun_linked` as last reported
    fw: str | None
    phone_batt: int | None
    ssid_ok: bool | None
    mc_reachable: bool | None
    synced: bool | None
    screen_on: bool | None
    foreground: bool | None
    # A29: the phone's real build, as it reported it (`"0.1.9+abc123"`), and its platform. Rendered on
    # the row so the operator can read WHICH phone is behind without opening the node list.
    app_ver: str | None
    platform: str | None
    # A25: the same log view the node card carries, on the per-player board.
    log: LogView | None
    # `waiting` = the phone has not connected yet. Blocks the start exactly like `red`, but it is
    # not a fault and the UI must not paint it as one (field 2026-09-01).
    status: Literal["green", "amber", "red", "waiting"]
    blockers: list[str]      # things that actually gate the start
    ambers: list[str]        # advisories -- never gate anything


class ReadinessSnapshot(TypedDict):
    t: int
    roster_size: int
    greens: int
    board: list[ReadinessRow]
    unclaimed: list[ScanRow]
    go: bool


# ---- §5 envelope ----
class Envelope(TypedDict):
    v: int
    kind: str
    id: str
    seq: NotRequired[int]
    t: int
    body: dict


NODE_KINDS = {"hello", "bind", "event", "event_batch", "status", "ack_config", "time_req",
              "log_offer", "log_data", "ready", "loadout_request", "loadout_browse"}   # A10: loadout_*
MC_KINDS = {"welcome", "assign", "tutorial", "config", "start", "feedback", "control",
            "time_res", "pull_log", "ack", "apply", "score", "loadout_ack",             # A10: loadout_ack
            "alert",    # A11.4 -- omitted here until 2026-09-07, so every alert MC sent was rejected
                        # by envelope.validate() at the node and silently dropped (contracts.md §MC->node).
            "result",   # A24 (2026-09-11): the match result to EVERY node, losers included. The phone's
                        # `MC_KINDS` (app/src/transport/envelope.js) must list it too or every result is
                        # dropped as malformed -- `test_mc_envelope_kinds.py` pins the two lists equal.
            "join",     # A28.2 (2026-09-12): the tunnel came up or went down -- pub + secret, the same body
                        # `welcome.join` carries. Broadcast, not pushed, so `test_mc_envelope_kinds.py`'s AST
                        # scan (which reads `self.net.push(...)` sites only) does NOT cover it.
            "station_config"}   # A13.5 (F104, 2026-09-11): MC -> a utility node. The same trap as `alert`:
                                # the phone's `MC_KINDS` (app/src/transport/envelope.js) must list it too, or
                                # the arming message is dropped as malformed before `onMessage` ever sees it.
CONTROL_CMDS = {"end", "panic", "abort_start", "recall"}
