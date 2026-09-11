"""Wire shapes from docs/spec/contracts.md (A5) as TypedDicts + the constants (§9).

These are the ONLY shapes lanes share. Keep field names identical to contracts.md; additive
fields are fine, renames are an amendment.
"""
from __future__ import annotations

from typing import Literal, NotRequired, TypedDict

# ---- §9 constants (single source; modules reference by name) ----
ASSIST_WINDOW_MS = 4000
MULTI_KILL_MS = 4000
FEEDBACK_MAX_AGE_MS = 3000
STATUS_HEARTBEAT_MS = 2000
STALE_AFTER_MS = 8000
# Past this, a node has not merely gone quiet — it is gone (phone asleep, app closed, gear packed
# away). Everything else the board would say about it (gun link lost, clock unsynced, wrong wi-fi,
# screen off) is a CONSEQUENCE of that, and listing them as separate faults turns a switched-off
# tagger into a wall of red alarms (field 2026-09-02).
OFFLINE_AFTER_MS = 10 * 60 * 1000
SYNC_FRESH_MS = 10000
LATE_ARM_GRACE_MS = 8000
CONFIG_TTL_MS = 1_800_000
MAX_PLAYERS = 63          # wire ids 1..63; 0 reserved (tutorial / unknown shooter)
DEATH_LATCH_MS = 2000
RESYNC_PROBE_S = 10
DEFAULT_RUNWAY_S = 120
PROTOCOL_V = 1

ArmState = Literal["idle", "connected", "kitted", "lobby", "armed", "live"]


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


class Loadout(TypedDict):
    weapons: list[WeaponSel]              # [primary] or [primary, secondary]; index == gun slot; NEVER empty (A10)
    perk: NotRequired[str | None]         # A14: the perk slot — rides beside a secondary weapon (loadout.md §2); an ALT-button perk (easy_reload) is the one that can't
    overrides: NotRequired[dict]


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


class SlotRule(TypedDict):
    choice: Literal["player", "host", "fixed", "off"]
    kinds: list[str]                      # primary/secondary: "weapon" | "sidearm" (A12); the perk rule is always ["perk"] (A14)
    exclude_tags: list[str]
    exclude_ids: list[str]
    only_ids: list[str]
    fixed_id: str | None


class LoadoutPolicy(TypedDict):
    preset: Literal["open", "no_heavies", "snipers", "custom"]
    hud_select: bool
    primary: SlotRule
    secondary: SlotRule
    perk: SlotRule                        # A14: perks are their own slot (choice may be "off")


class LoadoutPool(TypedDict):
    primary: list[str]
    secondary_weapons: list[str]
    perks: list[str]                      # A14: the perk slot's pool


class PerkView(TypedDict):
    perk_id: str
    name: str
    desc: str
    tags: list[str]
    mechanism: Literal["passive", "slot_frame"]
    effects: dict
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
STATION_KINDS = ("respawn", "powerup", "extraction", "bomb", "control")
STATION_TEAM_ANY = 255        # advert byte 9 "any team" (`TEAM_ANY` in beacon.js); a control point starts neutral


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
    stations: NotRequired[list[dict]]   # A13.1 (F104): `[{id, kind}]` -- the utility items MC armed for THIS game.
    #                                     Set by `Session._wire_config()` from the ITEMS assignments, never by the
    #                                     operator; a player phone honours only these ids (`engine.js _stationAllowed`).
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


class FrameBundle(TypedDict):
    config_id: str
    player_id: str
    head: list[str]      # config head, NO $SPAWN, no countdown sound; ends with $TID
    spawn: list[str]     # $PLAYX,0 -> $SPAWN,, -> $AMMO... -> $BMAP,0,0
    revive: list[str]
    end: list[str]
    panic: list[str]
    team_flip: NotRequired[dict[str, list[str]]]
    cues: dict[str, str]  # A6.3: key -> PRE-COMPOSED frame the node writes verbatim. countdown, kill,
    # game_over?, victory?, tick?, klaxon?, multi?, medal?, runway_*?, and the once-per-life
    # low-health pair hurt?/hurt_led? (hurt_led is an $HLED, not a $PLAY — see compile.cues)
    # A11: plus one key per presentation EVENT that carries a sound (hit_taken … vip_down); "" = deliberately mute.
    # A15.2: `spawn` = the character's spawn line, written by the node IMMEDIATELY after the spawn / revive frames
    # (the head's $PSET ships an empty battleRespawnCry, so the firmware itself says nothing on $SPAWN).
    # A15.3: `pain_short` / `pain_long` / `pain_melee` = the pain the node plays on a $HIR (the $PSET pain fields ship
    # empty): a melee word -> pain_melee; damage >= voice.pain_long_min -> pain_long; else pain_short. At most one per
    # 600 ms, none on the lethal hit (the firmware's death scream covers it).
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
    streak: int
    medals: list[str]


class ReadinessRow(TypedDict, total=False):
    gun_id: str
    sticker: str
    tail: str
    player_id: str
    player_num: int
    present: bool
    identity: Literal["ok", "unconfirmed", "reverted", "unknown", "manual"]
    node: Literal["none", "linked"]
    headset: Literal["proven", "unknown", "absent"]
    battery_pct: int
    battery_age_ms: int
    fw: str
    phone_batt: int
    ssid_ok: bool
    mc_reachable: bool
    synced: bool
    screen_on: bool
    foreground: bool
    # `waiting` = the phone has not connected yet. Blocks the start exactly like `red`, but it is
    # not a fault and the UI must not paint it as one (field 2026-09-01).
    status: Literal["green", "amber", "red", "waiting"]
    blockers: list[str]      # things that actually gate the start
    ambers: list[str]        # advisories — never gate anything


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
            "station_config"}   # A13.5 (F104, 2026-09-11): MC -> a utility node. The same trap as `alert`:
                                # the phone's `MC_KINDS` (app/src/transport/envelope.js) must list it too, or
                                # the arming message is dropped as malformed before `onMessage` ever sees it.
CONTROL_CMDS = {"end", "panic", "abort_start", "recall"}
