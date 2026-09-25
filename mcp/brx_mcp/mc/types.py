"""Wire shapes from docs/spec/contracts.md (A5) as TypedDicts + the constants (§9).

These are the ONLY shapes lanes share. Keep field names identical to contracts.md; additive
fields are fine, renames are an amendment.
"""
from __future__ import annotations

from typing import Any, Literal, NotRequired, TypeGuard, TypedDict, get_args

# ---- §9 constants (single source; modules reference by name) ----
ASSIST_WINDOW_MS = 4000
MULTI_KILL_MS = 4000
# Tony 2026-09-24, ear-confirmed at volume 69: the multi-kill ladder, Halo 3's order with the two tiers the gun
# has no voice for (Overkill, Killpocalypse) removed, so every kill from 2 to 8 is voiced ("front stack them ...
# we get a sound bite on every kill"). The one table for every kill medal MC awards. `kind` multi = kills in a
# chain, each within MULTI_KILL_MS of the last (the HIGHEST count reached is the medal, killionaire at 8 and
# beyond); streak = kills without dying; first = the match's first kill. `clip` is the gun's voice line (null
# = no line: the HUD shows the text and the voice stays silent), `clip_ms` its length from the sound catalogue.
# The phone reads labels and clips from here (contract.gen MEDALS).
MEDALS = [
    {"key": "first_blood",   "kind": "first",  "count": 1,  "label": "FIRST BLOOD",   "clip": "VA7H", "clip_ms": 2456},
    {"key": "double_kill",   "kind": "multi",  "count": 2,  "label": "DOUBLE KILL",   "clip": "VA7E", "clip_ms": 1787},
    {"key": "triple_kill",   "kind": "multi",  "count": 3,  "label": "TRIPLE KILL",   "clip": "VA7Q", "clip_ms": 1904},
    {"key": "killtacular",   "kind": "multi",  "count": 4,  "label": "KILLTACULAR",   "clip": "VA7M", "clip_ms": 1924},
    {"key": "killtrocity",   "kind": "multi",  "count": 5,  "label": "KILLTROCITY",   "clip": "VA7O", "clip_ms": 1924},
    {"key": "killamanjaro",  "kind": "multi",  "count": 6,  "label": "KILLAMANJARO",  "clip": "VA7J", "clip_ms": 1927},
    {"key": "killtastrophe", "kind": "multi",  "count": 7,  "label": "KILLTASTROPHE", "clip": "VA7N", "clip_ms": 1924},
    {"key": "killionaire",   "kind": "multi",  "count": 8,  "label": "KILLIONAIRE",   "clip": "VA7L", "clip_ms": 1924},
    {"key": "killing_spree", "kind": "streak", "count": 5,  "label": "KILLING SPREE", "clip": "VA7K", "clip_ms": 1924},
    {"key": "unstoppable",   "kind": "streak", "count": 10, "label": "UNSTOPPABLE",   "clip": "VX0U", "clip_ms": 1175},
    # Tony 2026-09-24: "melee kills should be a medal". Awarded when the victim's phone flags the death `melee`
    # (the killing $HIR was the melee proto, 13), and it stacks with the chain medal. Label BEAT DOWN (Halo's name;
    # the bank has no such line) over VA7F "Fatality", Tony's pick 2026-09-24 ("ha that works").
    {"key": "melee_kill",    "kind": "melee",  "count": 1,  "label": "BEAT DOWN",     "clip": "VA7F", "clip_ms": 1924},
    # Tony 2026-09-24 (A63): KILLJOY, for killing an enemy whose CURRENT streak (read before the death resets it)
    # is at least `count`, the killing_spree threshold. It stacks with the other medals and goes only to a
    # credited enemy kill. The bank has no Killjoy line, so it is HUD text only: a null clip compiles no cue.
    {"key": "killjoy",       "kind": "killjoy", "count": 5, "label": "KILLJOY",       "clip": None,   "clip_ms": None},
]
# A63 (Tony 2026-09-24): the END-OF-MATCH awards, in recap order. `scoring.Scorer.honors()` awards them; every
# Honor row carries its `key`, and `award` stays the label for older consumers. None is awarded under 3 scored
# players. `rule` and `tie` are the rule as built, in words, for the docs and the console. A tie that survives
# the tie-break is SHARED: every tied player gets their own Honor row for that award.
AWARDS = [
    {"key": "mvp",            "label": "MVP",                "rule": "top kills minus deaths; needs 1+ kill",
     "tie": "then K/D, then kills; still level = shared"},
    {"key": "most_kills",     "label": "MOST KILLS",         "rule": "most kills; needs 1+ kill",
     "tie": "shared"},
    {"key": "best_kd",        "label": "BEST K/D · NON-MVP", "rule": "best K/D among players who are not MVP; needs 1+ kill",
     "tie": "then kills; still level = shared"},
    {"key": "sharpshooter",   "label": "SHARPSHOOTER",       "rule": "best accuracy (hits per shot_group) with ACC_MIN_SHOTS+ shots; needs above 0 %",
     "tie": "shared, to the whole percent shown"},
    {"key": "survivor",       "label": "SURVIVOR",           "rule": "the longest single life: go-live (or join, or a respawn) to a death or the match end; not for a silent player or one with a fact from an unsynced node",
     "tie": "shared, to the whole second; not awarded when every player ties"},
    {"key": "iron_man",       "label": "IRON MAN",           "rule": "fewest deaths among players who played the whole match (no hot-join) and whose phone reported; must be fewer than the most",
     "tie": "then kills; still level = shared"},
    {"key": "first_blood",    "label": "FIRST BLOOD",        "rule": "the match's first credited enemy kill",
     "tie": "none: one kill is first"},
    {"key": "multikill",      "label": "MULTIKILL",          "rule": "the longest multi-kill chain (2+), shown with its MEDALS ladder label",
     "tie": "then the number of 2+ chains; still level = shared"},
    {"key": "wingman",        "label": "WINGMAN",            "rule": "most assists; needs 1+ assist",
     "tie": "shared"},
    {"key": "objective_hero", "label": "OBJECTIVE HERO",     "rule": "koth/domination only: most seconds the player's own phone reported their team holding a point while in range (IR for a grenade, BLE for a station); needs 1+ s",
     "tie": "shared, to the whole second"},
]
FEEDBACK_MAX_AGE_MS = 3000
STATUS_HEARTBEAT_MS = 2000
STALE_AFTER_MS = 8000
# F52: the A16.3 gun readout's timings, shipped in `gun.readout`. One owner here, so the generator emits them
# to the phone (contract.gen.js) and poolgauge / presentation / the stage import them: no literal copies left
# to disagree after a bench retune. Their meanings are documented at poolgauge.py's readout section.
READOUT_LEAD_MS = 180
READOUT_BLINK_GAP_MS = 80
READOUT_STEP_MS = 120
READOUT_BLINK_MS = 400
READOUT_MIN_GAP_MS = 400
READOUT_HOLD_S = 4
# The `sync_age_ms` a LIVE row carries when MC has never heard its node in THIS process (no node bound,
# or MC restarted mid-match and the phone has not spoken since). It is a sentinel, not an age: the
# console must print "not heard", never "11d13h ago" (visual QA H3, 2026-09-23).
NEVER_SEEN_MS = 10**9
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
# F366 (Tony 2026-09-25): a gamertag is at most MAX_TAG_LEN characters after trim + upper-case; MC refuses a
# longer one (never a silent cut). Past SOFT_TAG_LEN the console warns that the phone HUD may shorten it.
MAX_TAG_LEN = 16
SOFT_TAG_LEN = 12
DEATH_LATCH_MS = 2000
# A34: a phone still LIVE in a match MC has retired is told `control{end}` from its status heartbeat; this
# is how long MC waits before telling the SAME phone about the SAME match again (the first end normally lands).
STALE_LIVE_RETELL_MS = 10_000
# A36: how long after a life begins MC waits before believing the pool a gun reports. The `$SPAWN`
# and the head's `$PSET` are two BLE writes and a relay apart, and the ~2 s status heartbeat can be
# sampled between them -- so the first frame or two of a life legitimately carries the previous
# pool. Past this the gun has had a whole heartbeat to settle and a pool that still disagrees with
# the pushed `$PSET` is the gun running a different game.
POOL_CHECK_SETTLE_MS = 2000
RESYNC_PROBE_S = 10
DEFAULT_RUNWAY_S = 120
PROTOCOL_V = 1

# ---- K8: the match-head $VOL (compile.play_volume / head_volume) ----
# The venue volume (field-corrected 2026-08-30: 80 = on-gun L3 indoors, 90 = L4 outdoors) and the
# bounds of the host's per-game knob, `GameConfig.volume`. The floor is on-gun L1: 30 is inaudible
# for game audio, so the knob cannot choose silence.
VENUE_VOLUME_INDOOR = 80
VENUE_VOLUME_OUTDOOR = 90
GAME_VOLUME_MIN = 60
GAME_VOLUME_MAX = 100

# ---- A29: the app build MC is compatible with ----
# Versions are SEMVER and the tiers carry meaning (contracts A29): MAJOR = anything the game or the wire
# depends on (protocol, engine rules, bundle shape), MINOR = HUD-facing features with no game impact,
# PATCH = fixes. Keep these two in step with `app/package.json` — they ARE the compatibility statement.
#
# ⚠️ While the app is on 0.x, semver's own rule applies: MINOR is the breaking tier, so the comparison is
# `(major, minor)` while major == 0 and `major` alone from 1.0.0 on. `APP_MINOR` is read ONLY in the 0.x
# regime; once the app cuts 1.0.0, bump APP_MAJOR and APP_MINOR stops mattering.
APP_MAJOR = 0
APP_MINOR = 4


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
ARM_STATES = get_args(ArmState)


def is_arm_state(value: object) -> TypeGuard[ArmState]:
    return value in ARM_STATES
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
    """Per-player accessibility + HP/armour handicap (modes §1.1). All keys are optional and
    independent -- `state.py _check_loadout` drops the whole `overrides` key when none survive
    validation. S50 (2026-09-17): `easy_reload` moved HERE from the perk slot, because it is
    accessibility (a player who cannot work the reload lever), not balance, so a left-handed player
    can take it with NO extra health, and a younger player can take it WITH one (Tony, 2026-09-17:
    "keep the two accessibility switches independent")."""
    max_hp: int          # 1..999 (`state.py _check_loadout`); 0 is a corpse, not a pool
    max_armor: int       # 0..999 -- 0 is legal and means "one shot with a sniper"
    easy_reload: bool    # ALT button = RELOAD ($BMAP,1,97); still can't ride with a second weapon or
                         # a chain-reload primary (the hardware facts don't move with the slot)


class Loadout(TypedDict):
    """weapons[] is canonical: [primary] or [primary, secondary]; `perk` is its OWN slot and rides
    beside a secondary weapon (AR + pistol + Quick Switch). The one exception: S50 (2026-09-17)
    moved it from a perk to `overrides.easy_reload` (a per-player accessibility switch, host-set
    only) -- it still takes the ALT button, so the server refuses it beside a second weapon; the
    host UI warns and drops the other one (A14, loadout.md §2/§2.1).
    """
    weapons: list[WeaponSel]              # [primary] or [primary, secondary]; index == gun slot; NEVER empty (A10)
    perk: NotRequired[str | None]         # A14: the perk slot — rides beside a secondary weapon (loadout.md §2)
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


class HirCell(TypedDict):
    """F315: one `$HIR` word a weapon can put on the wire -- the IR protocol (`$WEAP` t3, the `$HIR` token 2
    the victim reads), the subtype (t4) and the magnitude (t5, t12 or t37). Every word of one `$WEAP` frame
    rides the frame's own t3/t4, the headset word included, so a weapon's entries share one cell."""
    proto: int
    subtype: int
    mag: int


class RosterWeapon(TypedDict):
    """S56: one weapon a roster player carries, so a victim's phone can name what hit it."""
    weapon_id: str
    # The `$HIR` token-5 magnitudes this weapon's words can carry (`$WEAP` t5, t12 when > 0, t37 when > 0),
    # read from THIS player's compiled frame when MC holds one (a perk such as Armour Piercing changes them),
    # else the catalogue's base values. Sorted, unique.
    hir: list[int]
    # F315: the same words with the cell each one rides, from the same compiled frame (after any re-key:
    # Armour Piercing, `--distinct-weapon-cells`), one entry per `hir` magnitude, sorted by it. The phone
    # matches cell + magnitude first. Absent = an older MC; the phone then matches `hir` alone.
    cells: NotRequired[list[HirCell]]


class RosterEntry(TypedDict):
    player_id: str
    player_num: int
    display: str
    team_id: str | None
    # S56: the player's loadout, slot order (primary first). Absent = an older MC; the phone then names no weapon.
    weapons: NotRequired[list[RosterWeapon]]


# ---- §3 config + frames ----
# Respawn profiles (Tony, 2026-09-19). A TIMED respawn (in place, `type` "auto") and a
# STATION respawn (a revive at a respawn station) protect and arm differently. docs/spec/contracts.md §3.
TimedProtectS = Literal[0, 1, 2]           # timed: seconds of `$TMP` t8 = -100 after `$SPAWN`; 0 = no `$TMP` at all
WeaponDelayMs = Literal[500, 1000, 3000]   # timed: the trigger stays held (`$BMAP,0,98`) this long after `$SPAWN`
StationProtectS = Literal[0, 2, 3]         # station: seconds of t8 = -100; the trigger is live at once
TIMED_PROTECT_S_DEFAULT = 0
WEAPON_DELAY_MS_DEFAULT = 500
STATION_PROTECT_S_DEFAULT = 2
# A58: the station tamper lock (`station_config.lock_s`). The LOAD value covers a lobby wait of up to
# STATION_LOCK_LOBBY_S plus the match, because a muster station hears nothing after the lobby push.
STATION_LOCK_MAX_S = 7200
STATION_LOCK_LOBBY_S = 1800
STATION_LOCK_MARGIN_S = 120
STATION_REBOOT_SLACK_MS = 5000             # a boot instant (t_recv - uptime_s) that moves further than this is a new boot
TRIGGER_AFTER_PROTECT_MS = 500             # timed: the trigger goes live at least this long after protection ends
SPAWN_KILL_WINDOW_MS = 10000               # a death this soon after a timed respawn raises the down-screen warning
# Review finding, 2026-09-19: an app below 0.4.3 has no `respawn_profile` path at all -- it keeps the OLD
# rules (protected at go-live, the trigger live at respawn), not the ones above. `state.py
# _respawn_rules_warning` names every bound node still on one, so a mixed fleet gets a friendly,
# NON-BLOCKING readiness warning -- the hard 0.4 compatibility gate (`compatible()`/`app_tier()`) is
# unaffected and unrelated: an app that old is still ALLOWED to play, just with the old rules.
RESPAWN_PROFILE_MIN_APP = (0, 4, 3)

class Respawn(TypedDict):
    type: Literal["auto", "scanner", "none"]
    delay_s: int
    protect_s: NotRequired[TimedProtectS]            # absent = TIMED_PROTECT_S_DEFAULT
    weapon_delay_ms: NotRequired[WeaponDelayMs]      # absent = WEAPON_DELAY_MS_DEFAULT
    station_protect_s: NotRequired[StationProtectS]  # absent = STATION_PROTECT_S_DEFAULT
    # F325: scanner respawn only (contracts §3, A13.1): "trigger" = at the station AND pull the trigger (the
    # node's default when absent), "presence" = being at the station is enough. The node ignores it otherwise.
    gate: NotRequired[Literal["trigger", "presence"]]


class RespawnProfile(TypedDict):
    """The node's respawn frames (2026-09-19). Absent on an older bundle: the node keeps the legacy path
    (`spawn`/`revive`, protection ended by the first shot or SPAWN_PROTECT_MAX_MS). An app older than 0.4.3
    ignores this block and plays the legacy lists, so the legacy lists stay byte for byte as they were."""
    protect_ms: int          # timed: t8 window after `$SPAWN`; 0 = the timed lists carry no `$TMP`
    trigger_ms: int          # timed: when the node writes `trigger_live`, after the `$SPAWN` write
    station_protect_ms: int  # station: t8 window; the trigger is live in the write itself
    spawn: list[str]         # the T-0 spawn: $PLAYX,0 -> $SPAWN -> $TID -> $AMMO -> $BMAP,0,0 (no t8: everyone is live and hittable at go-live)
    revive: list[str]        # a timed revive: $SPAWN -> [t8 -100] -> $TID -> $AMMO -> $BMAP,0,98
    revive_station: list[str]   # a station revive: $SPAWN -> [t8 -100] -> $TID -> $AMMO -> $BMAP,0,0 -> [shield_on]
    team_flip: NotRequired[dict[str, list[str]]]   # infection: the flip bursts, timed profile
    trigger_live: str        # `$BMAP,0,0,,,,,*`
    shield_on: str           # a headset blink, distinct from the native hit flash; "" = no shield light
    shield_off: str          # the headset's in-play rest frame, written when station protection ends


WinBy = Literal["kills", "survival", "objective"]


def parse_win_by(value: object, default: WinBy) -> WinBy:
    """Normalise a missing/empty mode default and refuse any other scoring vocabulary."""
    if value is None or value == "":
        return default
    if value == "kills":
        return "kills"
    if value == "survival":
        return "survival"
    if value == "objective":
        return "objective"
    raise ValueError("scoring.win_by must be kills, survival or objective")


class Scoring(TypedDict):
    frag_limit: int | None
    win_by: WinBy


# Tony 2026-09-19 (FOLLOWUPS S45, weapon-design.md §7.3): the three named starting-pool presets, plus
# "custom" for a hand-edited pool. Mirrors `LoadoutPreset` -- a label RE-DERIVED from the numbers
# (`compile.resolve_health_preset`), never trusted on its own; see that function's docstring.
HealthPreset = Literal["standard", "shields", "hardcore", "custom"]


class Health(TypedDict):
    max_hp: int
    max_armor: int
    # Tony 2026-09-19 (S45/§7.3): the `$PSET` t5 shield CEILING -- a host-facing field where there used
    # to be none (`compile._GC_SHIELD_DEFAULT` armed a fixed 70 on every game, shields preset or not).
    # 0 = no shield at all. The Shields preset recharge (`app/src/engine.js shieldRegenOn`) turns on
    # only when `max_armor == 0` AND this is `> 0` -- the same rule the node already keyed the S29
    # mechanic on, now driven by a real number instead of a silent constant.
    max_shield: int
    # Which named preset these three numbers ARE, or "custom" -- computed server-side
    # (`compile.resolve_health_preset`) on every `PUT /api/config`, never hand-set by a client's own
    # guess. A saved game from before this field existed (no `max_shield` at all) loads as "custom"
    # (`state.py _merge_config`'s `health` branch), because its shield intent is unknown.
    preset: HealthPreset


class Siphon(TypedDict):
    """S14: heal the killer on each kill (Fortnite/CoD "health on kill").

    Both are **added** to the killer's own pool and clamped by the gun ($LIFE is additive-clamped),
    so they can never overfill. There is no `shield` term yet. The shield CAN be filled over BLE
    (`$LIFE,0,0,<n>,*`, F109, bench 2026-09-11), so one can be added if a mode wants it. Typed only:
    compile and the node do not act on `siphon` today (S14 open).
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


PoolEmptyCode = Literal["off", "fixed_missing", "only_ids_missing", "needs_secondary", "unplayable", "filtered"]


class LoadoutPool(TypedDict):
    """allowed ids per slot, catalog order, computed server-side (loadout.md §3.2); `perks` is the
    perk slot's list (A14).
    """
    primary: list[str]
    secondary_weapons: list[str]
    perks: list[str]                      # A14: the perk slot's pool
    reasons: NotRequired[dict[str, PoolEmptyCode]]
    # field 2026-09-12 (F146/S37): one code per EMPTY slot (keys: primary / secondary_weapons / perks), absent when every
    # slot has something; `PoolEmptyCode` is the vocabulary, `policy._empty_code` the classifier.


class PerkEffects(TypedDict, total=False):
    """The effect knobs the compiler acts on -- exactly `perks.EFFECT_KEYS`, which `PerkCatalog.__init__`
    refuses a perks.json row for exceeding. Every key is optional: a row carries only what it changes.

    S50 (2026-09-17, docs/perk-design.md §2): `max_armor_add` is a FLAT armour grant/cost (body_armor
    +25, quick_switch -20) -- `compile._MAX_ARMOR_ADD` is the one table the compiled arithmetic reads,
    keyed by perk_id; this field is its wire-visible documentation, kept an integer because
    `app/src/hud/hud.js` / `webapp/mc/src/screens/Kit.tsx` render it literally."""
    max_armor_add: int      # added to $PSET armour (or, base armour 0: $PSET shield) -- capped at 255,
                            # floored at 0 (`compile.armed_armor`/`armed_shield`)
    ammo_mult: float        # scales the clip/reserve the head writes
    reload_mult: float      # scales the weapon's reload time
    alt_reload: bool        # unused by any current row (S50: easy_reload moved to
                            # `loadout.overrides.easy_reload`) -- kept for a future ALT-button perk
    switch_mult: float      # scales $WEAP tok15, the gun's swap delay (bench 2026-09-04)
    armor_piercing: bool    # S50 (new, armor_piercing perk): primary's $SIR key -> the armour-piercing
                            # cell, damage cut to `compile._AP_DAMAGE_MULT`. PRIMARY ONLY.
    crit_pct_add: int       # F278 (2026-09-18): no row declares this yet -- filed and refused before it
                            # ships. `compile._refuse_if_crit_perk_ineligible` refuses it at runtime on
                            # any equipped weapon declaring `wire.headset_dmg`.


class PerkView(TypedDict):
    perk_id: str
    name: str
    desc: str
    tags: list[str]
    mechanism: Literal["passive", "slot_frame"]
    effects: PerkEffects
    gain: list[str]     # S50 (2026-09-19): player-facing GAIN lines, e.g. "+25 ARMOR" -- `perks.gain_cost_lines`
                        # is the one place either UI reads this from (app/src/hud/hud.js, webapp/mc/src/screens/Kit.tsx)
    cost: list[str]     # the same perk's COST lines, e.g. "RELOADS 1.3× SLOWER" -- empty when the perk carries none
    verified: bool
    hidden: bool


class ValuePair(TypedDict):
    """S50 build 4: a wire number before and after a perk touched it. Integers, always both present
    together (never just one)."""
    base: int
    resolved: int


class PerkEffectsResolved(TypedDict, total=False):
    """S50 build 4 (`docs/spec/loadout.md` §1.2/§2): the RESOLVED, per-player perk effect, exactly as
    it was compiled into this bundle -- not the catalogue's `PerkEffects` (which is unresolved and
    pool-independent). A field is present only when the perk actually changed it; `perk_id` is present
    whenever the player carries a perk, even one with no other field here, so a phone/console can show
    an icon. Lives on `FrameBundle.perk_effects` (the persisted per-player config, survives an app
    restart) and, per player, on `State`'s roster/player view for Mission Control's console."""
    perk_id: str
    mag: ValuePair
    reserve: ValuePair
    reload_ms: ValuePair
    swap_ms: ValuePair
    max_hp: ValuePair
    max_armor: ValuePair
    max_shield: ValuePair


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


def is_station_kind(value: object) -> TypeGuard[StationKind]:
    return value in STATION_KINDS
# F345: a phone station's own threshold defaults (app/src/beacon.js RESPAWN_RSSI_DBM.phone, STATION_THRESHOLD_DBM),
# sent explicitly instead of 0 to a phone app older than PHONE_THRESHOLD_ZERO_APP (which clamps 0 to -30 dBm).
PHONE_RESPAWN_THRESHOLD_DBM = -70
PHONE_STATION_THRESHOLD_DBM = -74
PHONE_POWERUP_THRESHOLD_DBM = -55   # S58: a powerup station's ~1 ft claim range (placeholder until bench 4.11)
PHONE_THRESHOLD_ZERO_APP = (0, 4, 12)
STATION_TEAM_ANY = 255        # advert byte 9 "any team" (`TEAM_ANY` in beacon.js); a control point starts neutral

# A67 (F365): a station's advert strength and where its range value came from. "station" = the operator's long-hold
# edit on the station itself; "mc" = the value MC sent in `station_config`.
TxPower = Literal["ultra_low", "low", "medium", "high"]
TX_POWERS = get_args(TxPower)
RangeSrc = Literal["station", "mc"]
RangeField = Literal["threshold", "tx_power"]
# A67: an edit age at or above this is "the station restarted since, the time is lost". A Stick has no clock
# across a reboot, so it reports a LARGE age; MC's value then wins on the next `station_config`.
STATION_EDIT_AGE_UNKNOWN_MS = 24 * 3600 * 1000
# A67 polish: MC dates an adopted station edit `t_recv - age`, later than the true edit by the uplink latency. While a
# field's source is "station", MC adds this to the age it sends, so the station's own edit is always the younger one
# and it keeps src "station" through every re-send (A58's START/END locks).
ADOPT_SLACK_MS = 10_000


StationItemKind = Literal["weapon", "overshield"]


class StationItem(TypedDict):
    """A56 (S58, docs/spec/powerups.md): what a `powerup` station grants, and when it spawns on the match clock.
    A weapon item grants `charges` rounds of `weapon_id` (armed at start in a spare slot, `GameConfig.powerups`);
    an overshield grants `amount` shield on top, hit first, no regen, gone at death. `spawn_every_s` is 1-255 so
    the station advert's one-byte `value` can count it down; `name` is at most 12 characters; `color` is `#rrggbb`."""
    kind: StationItemKind
    weapon_id: NotRequired[str]
    charges: NotRequired[int]
    amount: NotRequired[int]
    spawn_every_s: int
    first_at_s: int
    name: str
    color: str


class PowerupPreset(TypedDict):
    """A56: one item the host can pick for a powerup station (`GET /api/powerups`), MC's defaults expanded.
    `preset` is what `PUT` sends back as `item_preset`."""
    preset: str
    item: StationItem


class PowerupsView(TypedDict):
    """A56: `GET /api/powerups`. `enabled` is MC's powerups flag (off until the bench passes); the console hides
    the item picker when it is false."""
    enabled: bool
    presets: list[PowerupPreset]


class PowerupSlot(TypedDict):
    """A56: a pickup weapon MC armed at start (empty, out of the ALT cycle) and the gun slot it went into (2 or 3)."""
    weapon_id: str
    slot: int


class StationRef(TypedDict):
    """One armed utility item on `GameConfig.stations` -- exactly what `state.py _station_ids()` builds
    (`{"id": a["id"], "kind": a["kind"]}`), sorted by id. `item` (A56) rides along for a powerup station, so a
    player's phone knows the item and its spawn schedule without MC."""
    id: int
    kind: StationKind
    item: NotRequired[StationItem]


class Stun(TypedDict):
    duration_s: NotRequired[int]   # F15/A20: seconds a hit EMP keeps the gun disarmed (default 10, 1..60)


class DotSpec(TypedDict):
    """S16: one damage-over-time weapon's tick numbers, as the VICTIM's node needs them. The victim knows only
    its own loadout, so MC ships a game-wide table in `FrameBundle.dot`, keyed by the IR protocol the shooter's
    `$WEAP` t3 carries (the `$HIR` token 2 the victim reads). Built by `Compiler.dot_table()` from every weapon in
    the game whose `weapons.json` row declares `dot`. `spec/node.md` §3.17 holds the rules the node runs."""
    weapon_id: str
    per_tick: int       # damage one tick takes from the outermost non-empty pool
    tick_ms: int        # the interval between ticks
    duration_ms: int    # how long one hit keeps the stack alive; a second hit REFRESHES it, never stacks


class Recoil(TypedDict):
    """S42 (2026-09-17): a weapon's TARGET accuracy profile -- `weapons.json` `recoil`, declared-only
    on the wire (compile.py `resolve()` never writes t21/t22 from it). `app/src/engine.js` is the sole
    reader. **F259 (2026-09-18): a STATE MACHINE, not a per-shot walk** -- `_recoilProfile` derives
    `crisp`/`degraded`/`heavy` states from this shape (`ceiling`/`floor` become `crisp`/`degraded`):
    CRISP until the burst reaches `after_shots` rounds (DEGRADED), HEAVY after `after_heavy`, and back
    to CRISP in one step once the trigger is quiet for `settle_ms`.

    **S54/F268/F280 (2026-09-23): `after_shots`/`after_heavy` derive from ROUNDS PER TRIGGER PULL scaled
    by calibre, not from the ladder's depth.** A weapon dealing the engine's reference damage (8, the
    Assault Rifle/SMG/Energy Rifle) fires 5 clean rounds and degrades on the 6th, then 3 more clean
    rounds and goes heavy on the 9th; a different `dmg` scales both counts by `8 / dmg`, so a bigger
    round kicks in sooner. The four legacy fields (`ceiling`, `floor`, `per_shot`, `recover_ms`) remain
    accepted as derivation inputs for `crisp`/`heavy`/`settle_ms`; `per_shot` no longer sizes anything.
    The six explicit fields are optional per-weapon overrides that win outright over the derivation
    (S54). `app/src/engine.js` also resets a still-CRISP burst on the gun's own trigger-release edge
    (`$BUT,0,0`), at no cost in writes; a DEGRADED or HEAVY weapon still recovers only on `settle_ms`
    quiet, in one write (bench-provisional)."""
    ceiling: int
    floor: int
    per_shot: int
    recover_ms: int
    crisp: NotRequired[int]
    degraded: NotRequired[int]
    heavy: NotRequired[int]
    after_shots: NotRequired[int]
    after_heavy: NotRequired[int]
    settle_ms: NotRequired[int]


class GameConfigBase(TypedDict):
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
    powerups: NotRequired[list[PowerupSlot]]  # A56 (S58): pickup weapons armed at start in spare slots; absent = none (or the flag is off)
    #                                     Set by `Session._wire_config()` from the ITEMS assignments, never by the
    #                                     operator; a player phone honours only these ids (`engine.js _stationAllowed`) --
    #                                     and when the list is ABSENT (nothing assigned) it honours ANY station (the hand-armed fallback).
    game_byte: NotRequired[int]          # F-hotfix (contracts A-row): the advert `game` byte (1..255) MC arms its stations with
    #                                     (`station_config.game`) for THIS match. Set by `Session._wire_config()`; a player phone
    #                                     scopes presence and its own advert by it. Absent (an older MC) = 0, any game.
    respawn_auto_teams: NotRequired[list[int]]  # Derived scanner fallback: teams without a station use timed AUTO respawn.
    station_source: NotRequired[str]    # F70: what is emitting this game's objective -- `STATION_SOURCES` above
    #                                     ("grenade" = a BRX Smart Grenade in hill mode, "ir_station" = a
    #                                     $CAPTURE-speaking station). Present only for the modes that need one
    #                                     (domination/koth/ctf/cs/bomb); `validate()` refuses those without it.
    presentation: NotRequired[dict]              # A11 (mc/presentation.py): sounds + lights per event, preset or custom
    hit_audio_class: NotRequired[bool]           # A17: per-WEAPON $SIR sounds. DEFAULT OFF -- bench F38: a non-empty
    #                                              $SIR sound REPLACES the $PSET pool sound rather than layering, so
    #                                              turning this on SILENCES the ear-confirmed material layer (armour
    #                                              metal / shield fizz / silent health) on every standard hit.
    hit_audio_rekey: NotRequired[bool]           # A17: give each weapon FAMILY its own $SIR cell so hits sound different
    #                                              per weapon. DEFAULT OFF -- an unmatched cell is silently ignored (the
    #                                              F11 shape), so it stays off until FOLLOWUPS F38/F39 clear it at the bench.
    stun: NotRequired["Stun"]                    # F15/A20: the host-driven STUN (EMP). Present = the `<8,0>` $SIR cell
    #                                              ships as fn 23 (status, no damage; F253) and a proto-8 $HIR disarms the
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
    recoil: NotRequired[bool]                    # S42: node-driven recoil (the accuracy ceiling/floor is OURS, not the
    #                                              gun's native walk -- F230). DEFAULT ON: absent or `true` = on, only an
    #                                              explicit `false` turns it off. No FrameBundle change needed -- `config`
    #                                              already rides every push wholesale, and `app/src/engine.js` reads
    #                                              `config.recoil !== false`. Seam for stance/flinch (also S42, not built
    #                                              here): a future switch for either can sit right beside this one.
    volume: NotRequired[int | None]              # K8: the host's match-head $VOL, an integer 60..100
    #                                              (`compile.GAME_VOLUME_MIN/MAX`). Absent or null = the venue volume
    #                                              (`compile.play_volume`: 80 indoors, 90 outdoors); a null PUT removes
    #                                              the key. `--bench-volume` still wins; a try-out keeps VOL_TRYOUT.


class GameConfig(GameConfigBase):
    """A complete config type whose policy may be omitted for server defaulting."""
    loadout_policy: NotRequired[LoadoutPolicy]


class ConfigView(GameConfigBase):
    """A config MC serves in State or from a successful config/preset response.

    PUT bodies use ``GameConfig`` with optional fields, since callers may update only selected keys.
    Served configs have gone through the server's policy fill and always include ``loadout_policy``.
    """
    loadout_policy: LoadoutPolicy


class FrameBundle(TypedDict):
    config_id: str
    player_id: str
    head: list[str]      # config head, NO $SPAWN, no countdown sound; ends with $TID
    spawn: list[str]     # $PLAYX,0 -> $SPAWN,, -> $TMP t8=-100 -> $TID -> $AMMO... -> $BMAP,0,0 (F121 rebuild: no $SIR row; the table survives $SPAWN)
    revive: list[str]    # $SPAWN,, -> $TMP t8=-100 -> $TID -> $AMMO... -> $BMAP,0,0
    respawn_profile: NotRequired[RespawnProfile]   # 2026-09-19: timed vs station respawn frames; an app >= 0.4.3 plays these
    spawn_protect_off: NotRequired[str]   # F121 rebuild: `$TMP` t8=0, written on the first shot or the cap; absent = an older bundle
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
    presentation: NotRequired[PresentationSummary]  # A11: presentation.summary() -- preset + switches, for the UI/HUD
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
    sir_pool: NotRequired[list[list[str]]]   # A17/A44: one full live `$SIR` table per take, the ONLY live carrier -- the node writes one in front of `spawn_protect_off` when the gun's table is not live or class sounds are on, and again after a
    #                                      lull, so the same weapon does not land the same clip all match. Re-sending `$SIR` rows is the F11 repair
    #                                      path, so the write is safe by construction; the rows are identical apart from their sound tokens.
    hit_audio: NotRequired[dict]         # A17: {rekey: bool, cells{weapon_id: "p,s"}, classes{"p,s": family}, shared[families sharing a cell],
    #                                      material[roles]} -- what the UI/console shows for "what does a hit sound like", and what a bench probe reads.
    dual_emitters: NotRequired[list[dict]] # physical gun/headset word pairs for node-side accuracy grouping
    dot: NotRequired[dict[str, "DotSpec"]]   # S16: IR protocol (a string key: JSON has no integer keys) -> tick numbers,
    #                                      for every damage-over-time weapon in THIS GAME. Absent = no such weapon.
    perk_effects: NotRequired[PerkEffectsResolved]   # S50 build 4: this player's compiled perk effect,
    #                                      absent when they carry no perk. Persisted here (not a
    #                                      one-shot message) so it survives an app restart.
    callout_team: NotRequired[int | None]   # S57 (docs/ir-callouts.md): the smallest team id in 0..3 that
    #                                      no player in this match holds, or None when all four are in use.
    #                                      Every player's dead-man IR callout word (protocol 15) carries this
    #                                      team, so a receiving phone hears it without it landing on a real
    #                                      team's own id. The same value in every player's bundle for one match.


class Weapon(TypedDict):
    weapon_id: str
    name: str
    cls: str
    weapon_class: str           # ballistic|energy|melee (weapons.json `class`, A10, 2026-09-17): ballistic reloads, energy overheats/charges; not the same as `cls` above (raw protocol class byte)
    desc: NotRequired[str]     # house-written armory blurb (weapons.json `desc`); "" if a row lacks one
    stats: dict
    weap_frame: str
    icon: NotRequired[str]
    verified: NotRequired[bool]
    tags: NotRequired[list[str]]   # A10 policy vocabulary (loadout.md §1.1)
    role: NotRequired[str]
    caution: NotRequired[str]      # A10: human copy for a known LIVE problem (weapons.json `caution`)
    pickup_only: NotRequired[bool]  # 2026-09-17: catalogue-visible but never in a player loadout pool (policy.py)
    recoil: NotRequired[Recoil]     # S42: the declared target accuracy profile (weapons.json `recoil`)
    rounds_per_charge: NotRequired[int]  # A48: rounds of the cell one FULL charge spends. `WeaponCatalog.rounds_per_charge()` resolves weapons.json's absent-means-1 row to a concrete integer, so a real compiled Weapon always carries this; NotRequired only for a hand-built fixture that skips it
    lethal: NotRequired[bool]       # 2026-09-18, weapon-design.md §7.4: False = cannot kill; absent means true
    crit_pct: NotRequired[int]      # F62 (2026-09-18): $WEAP t6 primaryCritChance, 0-100; absent = never crits
    min_app: NotRequired[str]       # victim-side runtime floor, declared beside the mechanic that needs it
    dual_emitter: NotRequired[bool] # one trigger emits separate gun and headset words


class WeaponBars(TypedDict):
    power: int | None
    rof: int | None
    ammo: int | None
    ttk: int | None


class WeaponView(TypedDict):
    """Host-health-ranked arsenal row built by views.weapon_view(s)."""
    weapon_id: str
    name: str
    cls: str
    weapon_class: str           # ballistic|energy|melee (weapons.json `class`, A10, 2026-09-17): ballistic reloads, energy overheats/charges; not the same as `cls` above (raw protocol class byte)
    desc: str
    clip: int
    mags: int
    reserve: int | None
    reload_s: float | None
    reload_ms: int | None
    dmg: float | None
    rpm: float | None
    rng: float | None
    dmg_per_hit: float | None
    dual_emitter: NotRequired[bool]  # one trigger can emit separate gun and headset words
    pool: NotRequired[int]   # older MC rows predate host-pool ranking; the current producer always fills it
    verified: bool
    tags: list[str]
    role: str
    htk: float | None
    ttk_ms: NotRequired[float | None]  # older MC rows can omit this derived figure
    caution: NotRequired[str]
    ammo_total: NotRequired[int]
    bars: NotRequired[WeaponBars]
    pickup_only: NotRequired[bool]  # 2026-09-17: catalogue-visible but never in a player loadout pool (policy.py)
    lethal: NotRequired[bool]       # 2026-09-18 (weapon-design.md §7.4): FALSE on a weapon that deliberately
                                    # cannot kill (the fn-20 Breacher, the fn-23 Haze). It may never be a PRIMARY:
                                    # the server refuses one in slot 0 and both UIs mirror that, so the field has
                                    # to travel with the row or a console offers a pick that is refused at arming.
    recoil: NotRequired[Recoil]     # S42: the declared target accuracy profile -- the node's `weaponRow(id).recoil`
    rounds_per_charge: NotRequired[int]  # A48: rounds of the cell one FULL charge spends -- the HUD's NOT ENOUGH ENERGY line reads this, never a hard-coded cost. `views.weapon_view()` resolves the catalogue's absent-means-1 row, so a real WeaponView always carries this; NotRequired only for a hand-built fixture that skips it
    crit_pct: NotRequired[int]      # F62 (2026-09-18): $WEAP t6 primaryCritChance, 0-100; absent = never crits
    hir: NotRequired[list[int]]     # S56: the base `$HIR` t5 magnitudes this weapon can emit (t5, t12, t37 when > 0), sorted, unique -- the phone's pickup fallback when a hit matches no roster weapon
    cells: NotRequired[list[HirCell]]  # F315: the same magnitudes with the catalogue frame's own cell (t3/t4), one entry per `hir` value -- a match's `--distinct-weapon-cells` move is in the roster's `cells`, never here


class SavedGame(TypedDict):
    """A sanitized whole-game preset stored on the Mission Control host."""
    preset_id: str
    name: str
    desc: str
    builtin: bool
    created_t: int
    updated_t: int
    config: GameConfig


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
    # Bench 2026-09-17: true while the gun keeps dropping the link seconds after each connect (2+ quick
    # drops in a row, BrxLink.flapping), which is what a headset that is off looks like. Optional.
    gun_flapping: NotRequired[bool]


class NodeView(TypedDict):
    """One player or utility node in `State.snapshot()`.

    `last_seen_ms` is an age in this public view. The session keeps the corresponding node record's
    receive timestamp internally and projects it at snapshot time, so the UI never receives the
    host's wall clock. The optional fields are forwarded only after the node has reported them.
    """
    node_id: str
    node_type: str
    arm_state: ArmState
    last_seen_ms: int
    synced: bool
    # 2026-09-19 (two field bugs, a station and a rejoined phone kept "online"): the net layer's own
    # freshness flag (STALE_AFTER_MS = 8 s of silence,
    # `net.py`'s `_stale_loop`/`on_stale`/`on_return`), projected here so a client reads MC's judgement
    # instead of re-deriving one from `last_seen_ms` with its own, disagreeing threshold. A stale node's
    # `gun_linked`/`preflight`/`arm_state` are last-known facts, not current ones — the console must show
    # OFFLINE and treat them as unknown, never green/connected.
    stale: bool
    gun_name: NotRequired[str]
    gun_tail: NotRequired[str]
    player_id: NotRequired[str]
    preflight: NotRequired[Preflight]
    battery: NotRequired[int | None]
    fw: NotRequired[str | None]
    hp: NotRequired[int | None]
    armor: NotRequired[int | None]
    ammo: NotRequired[int | None]
    alive: NotRequired[bool | None]
    pending: NotRequired[int | None]
    app_ver: NotRequired[str | None]
    platform: NotRequired[str | None]
    log: NotRequired[LogView | None]
    # F309: the phone's own last `status.transport` claim; absent = never reported (older app).
    transport: NotRequired[Literal["wifi", "cellular", "none", "unknown"]]
    reach: NotRequired[Literal["lan", "backhaul"]]
    last_reach: NotRequired[Literal["lan", "backhaul"]]
    # F208: the node's last `status.pool_stale` / `pool_stale_ms`. Absent = not stale, or an older app.
    pool_stale: NotRequired[Literal["silent", "no_fire", "write_lost", "pool_wrong"]]
    pool_stale_ms: NotRequired[int]
    # F264: what the node ITSELF did about a `pool_stale` claim, so the board reads more than "stale".
    # `asking` = a $QUERY/$LIFE probe is out; `dead` = the gun answered health 0 and the death is booked;
    # `alive` = it answered above 0 and the node re-asserted the arming, never a revive; `no_answer` =
    # nothing came back and the node deliberately did NOTHING. `no_answer` is the one that needs a human.
    cure: NotRequired[Literal["asking", "dead", "alive", "no_answer"]]
    # F272: the node positively proved that the linked gun stopped answering. Optional and true-only:
    # absence is an older/healthy node, never evidence of a lock-up.
    gun_locked: NotRequired[bool]


class Event(TypedDict, total=False):
    type: Literal["hit_taken", "death", "respawn", "team_change", "status", "possession", "operator_result", "pickup"]
    t: int
    match_id: str | None
    node_id: str
    player_id: str | None
    # hit_taken / death
    shooter_num: int
    shooter_team: int
    dmg: int
    ir_proto: int
    ir_subtype: int
    shot_group: int | str
    # $HIR tok1 — WHICH sensor caught the shot. 0-3 are ALL HEADSET sensors (the headset carries
    # FOUR, operator-confirmed 2026-09-01; only 0 = front and 1 = back are bench-mapped), 4 = gun
    # body. Forwarded 2026-09-01: it was parsed on the phone and dropped, so a
    # "the headset domes never register" report could only be checked against a frame ring.
    sensor: int
    desync: bool
    # S16: the death came from the node's own poison tick (a `$LIFE` write), not from a hit. `shooter_num` and
    # `shooter_team` then name the player who last applied the poison, which is who gets the kill.
    dot: bool
    # Tony 2026-09-24 (death): the killing $HIR was the melee proto (13) -- the melee medal. Absent on an older phone.
    melee: bool
    # A65 (F354, death): the victim's phone lost the damaging hit and only a non-damaging word (smoke, EMP) was fresh,
    # so it credits that word's TEAM (`shooter_team`) and no player (`shooter_num` 0). The team score counts the kill;
    # no player gets the K, a medal, a chain, first blood or an assist. Absent on an older phone.
    credit: Literal["team"]
    # S56 (hit_taken): the weapon the victim's phone resolved from the shooter's roster loadout; absent = unresolved or ambiguous.
    weapon_id: str
    # respawn
    resync: bool
    operator: bool   # A47: the operator's FORCE RESPAWN, not a respawn after a death (scoring keeps the streak)
    # F289 (respawn and an infection team_change): the ms of spawn protection the phone must end itself; absent =
    # none owed. Sent at once with the respawn, so MC knows of the window even when the phone dies inside it and no status follows.
    protect_ms: int
    # operator_result (A47): what the phone DID with an operator action MC sent (`control{resync|respawn|relink}`).
    # Persisted like every fact, and read for the operator's feed and menu only: it never reaches the scorer.
    cmd: Literal["resync", "respawn", "relink"]
    ok: bool
    why: str   # present on a refusal: the phone's own reason ("stunned", "not live", ...)
    # pickup (A56, S58): the player took a powerup station's item. Presentation and station state only; never scored.
    station_id: int
    item_kind: StationItemKind
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
    # X2: the advert `game` byte (1..255) the phone holds from `config.game_byte`. A fresh MC that adopts an
    # orphan match takes it (`Session.adopt_orphan`). An older phone omits it.
    game_byte: int
    synced: bool
    dropped: int
    preflight: Preflight
    # A37/R2-3: WHERE `hp`/`armor` above came from THIS LIFE. `engine.js` fills them from
    # `config.health` at spawn/revive -- the phone's MODEL of the pool -- and overwrites them with the
    # gun's own numbers on the first `$LCD`/`$HP`. The `$PSET` MC pushed bakes
    # `loadout.overrides.max_hp/max_armor` and the body_armor perk, so the two legitimately disagree
    # until the gun has spoken, and `state.py _check_pool` judges `"gun"` ONLY. Optional: an app that
    # omits it makes no claim at all, and the check keeps waiting rather than guessing.
    pool_src: Literal["gun", "model"]
    # A36: the `config_id` of the head this node is CURRENTLY holding (`engine.js statusBody`).
    # `ack_config` says which config a gun took at the moment it took it; this says which one it is
    # still on, every ~2 s, for the rest of the game -- the difference that made a whole field night
    # of stale pushes invisible. Optional: an older app omits it and MC then makes no claim.
    config_id: str
    # F208: the pool this status reports is STALE, and why. A gun that died kept a byte-identical status
    # for 105 s and looked like a healthy idle player. `"silent"` = no gun frame for 185 s; `"no_fire"` =
    # three trigger presses in a row got no shot back; `"write_lost"` = this life's spawn or revive write was
    # lost and the phone did not repeat it (pl4: RESYNC GUN clears it); `"pool_wrong"` = the gun reports pools above (or,
    # at the spawn read-back, other than) the ones its `$PSET` armed, and two repairs did not hold (F341: FORCE RESPAWN).
    # `pool_stale_ms` = ms since the gun last reported a
    # pool. Absent = not stale, or an older app: MC then shows no cue at all.
    pool_stale: Literal["silent", "no_fire", "write_lost", "pool_wrong"]
    pool_stale_ms: int
    # F264: what the node ITSELF did about a `pool_stale` claim, so the board reads more than "stale".
    # `asking` = a $QUERY/$LIFE probe is out; `dead` = the gun answered health 0 and the death is booked;
    # `alive` = it answered above 0 and the node re-asserted the arming, never a revive; `no_answer` =
    # nothing came back and the node deliberately did NOTHING. `no_answer` is the one that needs a human.
    cure: Literal["asking", "dead", "alive", "no_answer"]
    # F272: positive lock-up verdict. False/absent is deliberately no claim.
    gun_locked: bool
    # F289: true-only while the phone still owes the write that ends spawn protection. Absent = no claim.
    protected: bool
    # F309: the phone's own connection (Capacitor Network `connectionType`), restated on every heartbeat.
    # A CLAIM, unlike `reach` (which MC stamps from the socket): only the phone knows whether it is
    # riding the field Wi-Fi. Absent = an older app or no answer; MC reads anything unknown as not cellular.
    # The node says `cellular` only when the network at bind time AND the current one are both cellular
    # (a bound socket stays on the network it opened on); the full rule is contracts §5d.
    transport: Literal["wifi", "cellular", "none", "unknown"]


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
    multi_best: NotRequired[int]       # the longest multi-kill chain (2 double ... 8+ killionaire, types.MEDALS); 0 = none
    first_blood: NotRequired[bool]     # this player drew first blood
    acc_provisional: NotRequired[bool] # F119: `accuracy` is not settled yet — render it as settling, not as fact
    # 2026-09-12, the same additive rule as the five above: `scoring.rows()` fills both on every LIVE row
    # (0 when nothing landed late) and `rows_csv` has a column for each, but a session PERSISTED before
    # they existed replays rows without them. Kills and deaths scored AFTER the whistle (A6.1 parks them,
    # they do not move the tally) -- read either one only with a fallback.
    after_end_kills: NotRequired[int]
    after_end_deaths: NotRequired[int]


class OperatorStatus(TypedDict):
    """A47: the last operator action MC sent to one player, and what the phone said about it.
    `state` is "sent" until the phone's `operator_result` fact arrives, then "done" or "refused". With no
    answer OPERATOR_NO_ANSWER_MS after the send it reads "no_answer" (an older app, a dropped socket); a late
    answer still replaces it. For relink, "done" means the phone STARTED the relink, not that the gun is back."""
    cmd: Literal["resync", "respawn", "relink"]
    state: Literal["sent", "done", "refused", "no_answer"]
    why: str | None
    sent_t: int
    result_t: int | None


class LiveRow(ScoreRow):
    status: Literal["alive", "down", "stale"]
    sync_age_ms: int
    respawn_in_s: int | None
    # F208: the bound node's `pool_stale` / `pool_stale_ms`, as NodeView. Absent = not stale.
    pool_stale: NotRequired[Literal["silent", "no_fire", "write_lost", "pool_wrong"]]
    pool_stale_ms: NotRequired[int]
    # F264: what the node ITSELF did about a `pool_stale` claim, so the board reads more than "stale".
    # `asking` = a $QUERY/$LIFE probe is out; `dead` = the gun answered health 0 and the death is booked;
    # `alive` = it answered above 0 and the node re-asserted the arming, never a revive; `no_answer` =
    # nothing came back and the node deliberately did NOTHING. `no_answer` is the one that needs a human.
    cure: NotRequired[Literal["asking", "dead", "alive", "no_answer"]]
    # F272: the bound node's current positive lock-up verdict. Absent = no claim or an older app.
    gun_locked: NotRequired[bool]
    # A47: the latest operator action for this player in THIS match. Absent = none sent.
    operator: NotRequired[OperatorStatus]
    # F289: true-only. The row is `stale` and the newest evidence says the phone had not ended spawn
    # protection, so the gun may still take no damage. Absent = no such claim.
    possibly_protected: NotRequired[bool]


class LiveView(TypedDict):
    match_id: str
    go_live_t: int
    time_limit_s: int
    ends_t: int
    score: dict[str, int]
    rows: list[LiveRow]
    # A47: an ADOPTED match only. True when every bound phone that has reported a claim says it has ended
    # (`kitted` for this match, or another match), and at least one does. MC never ends an adopted match
    # itself; the console asks the operator to press END. Absent = no such claim.
    phones_ended: NotRequired[bool]
    # Objective modes (win_by "objective"): the same merged possession tally the recap carries
    # (`Scorer.possession()`), so the board can headline what actually decides the match. Absent until
    # some node has reported possession, exactly as on RecapView.
    possession: NotRequired[PossessionView]


class StartNodeView(TypedDict):
    arm_state: ArmState
    t_minus_ms: int | None
    synced: bool
    last_seen_ms: int


class StartView(TypedDict):
    match_id: str
    go_live_t: int
    config_id: str
    seq: int
    countdown_s: int
    per_node: dict[str, StartNodeView]


class ModeParamSpec(TypedDict):
    """One tunable schema row served by GET /api/modes."""
    name: str
    type: Literal["int", "float", "bool", "str"]
    default: int | float | bool | str
    desc: str
    min: NotRequired[float]
    max: NotRequired[float]
    choices: NotRequired[list[str]]


class ModeInfo(TypedDict):
    """One mode catalogue row served by ``GET /api/modes``."""
    mode: str
    name: str
    abbr: str
    desc: str
    brief: str
    teams_text: str
    win_text: str
    respawn_text: str
    defaults: GameConfig
    params: list[ModeParamSpec]


class Honor(TypedDict):
    award: str             # the award's LABEL (types.AWARDS), kept for older consumers
    player_id: str
    stat: str
    # A63: the AWARDS key. NotRequired, not merely new: `honors()` fills it on every row, but a recap PERSISTED
    # before A63 replays honors without it. Read it with a fallback to `award`.
    key: NotRequired[str]


class StationAssignment(TypedDict):
    kind: StationKind
    team: int
    id: int
    threshold: int
    at: NotRequired[int]
    # A67 (F365): who last set each range value and when (MC clock). Absent on an assignment from before A67:
    # read `threshold_set_at` with a fallback to `at`. `tx_power` is absent until an operator or a station sets one.
    threshold_set_at: NotRequired[int]
    threshold_src: NotRequired[RangeSrc]
    tx_power: NotRequired[TxPower]
    tx_power_set_at: NotRequired[int]
    tx_power_src: NotRequired[RangeSrc]
    item: NotRequired[StationItem]   # A56 (S58): a powerup station's item and spawn schedule


class StationUpdate(TypedDict):
    """A56: MC -> a powerup station, on a pickup and at each spawn time. `next_spawn_in_ms` is time REMAINING
    (a Stick has no synced clock); the station re-anchors on arrival and MC re-sends it on a reconnect."""
    id: int
    available: bool
    next_spawn_in_ms: NotRequired[int]
    reset: NotRequired[bool]   # an operator reset: the station accepts it even for a spawn it already awarded


class StationAction(TypedDict):
    """A56 (S58): a powerup station -> MC, live only (no seq). `reset` = the operator reset the item at the
    station (available NOW; the fixed spawn times do not move). `taken` = the station decided who took it
    (first come at the station); `player_num` names the winner. MC dedupes `taken` against the player's own
    `pickup` fact by station and spawn: whichever arrives first marks the item taken, the second is a no-op."""
    id: int
    action: Literal["reset", "taken"]
    player_num: NotRequired[int]
    t: NotRequired[int]
    age_ms: NotRequired[int]   # `taken`: how long ago the station awarded it (no synced clock); MC dates it t_recv - age_ms


class StationControl(TypedDict):
    owner: NotRequired[int]
    progress: NotRequired[int]
    contested: NotRequired[bool]
    hold_ms: NotRequired[dict[str, int]]


# `from` and `to` are Python keywords, so the two fields live on a functional base (gen_contract flattens it).
_RangeEditValues = TypedDict("_RangeEditValues", {"from": int | TxPower, "to": int | TxPower})


class RangeEdit(_RangeEditValues):
    """A67 (F365): one on-station range edit, as the station reports it in `status.range_edits` (the last up to 8,
    oldest first) and as MC serves it in `StationView.range_edits`. `seq` rises per edit and survives a reboot;
    `locked` = the edit was made while the station held a tamper lock. `age_ms` is ms since the edit (on the wire,
    the station's count; in a StationView, MC's). After a Stick reboot the age is LARGE (no clock)."""
    seq: int
    field: RangeField
    locked: bool
    age_ms: int


class StationRange(TypedDict):
    """A67: a station's range as MC sees it. The values are what the station APPLIES now (its report); the source
    and the edit age are MC's record on the assignment (who set the value last). `*_edit_age_ms` is present only
    when the source is "station" and the edit time is known (not lost to a restart)."""
    threshold: NotRequired[int]
    threshold_src: NotRequired[RangeSrc]
    threshold_edit_age_ms: NotRequired[int]
    tx_power: NotRequired[TxPower]
    tx_power_src: NotRequired[RangeSrc]
    tx_power_edit_age_ms: NotRequired[int]


class StationReport(TypedDict):
    kind: NotRequired[StationKind]
    team: NotRequired[int]
    station_id: NotRequired[int]
    threshold: NotRequired[int]                      # A67: the value the station applies NOW (dBm)
    threshold_src: NotRequired[RangeSrc]             # A67: who set it
    threshold_edit_age_ms: NotRequired[int]          # A67: ms since the on-station edit; only when src is "station"
    tx_power: NotRequired[TxPower]                   # A67: the advert strength applied now
    tx_power_src: NotRequired[RangeSrc]
    tx_power_edit_age_ms: NotRequired[int]
    range_edits: NotRequired[list[RangeEdit]]        # A67: the last up to 8 on-station edits, oldest first
    live: NotRequired[bool]
    revives: NotRequired[int]
    armed: NotRequired[bool]
    battery: NotRequired[float]
    control: NotRequired[StationControl]
    uptime_s: NotRequired[int]                       # A58: seconds since this station booted
    boot_count: NotRequired[int]                     # A58: boots since the station was flashed (persisted)
    assoc: NotRequired[Literal["muster", "held"]]    # A58: the Wi-Fi association mode (utility.md §5g.4)


class StationArmed(TypedDict):
    game: int
    at: int
    kind: StationKind
    team: int
    id: int


class StationView(TypedDict):
    """A utility phone as MC sees it in the ITEMS panel."""
    node_id: str
    assigned: StationAssignment | None
    armed: StationArmed | None
    arm_pending: bool
    report: StationReport
    app_ver: NotRequired[str | None]
    platform: NotRequired[str | None]
    last_seen_ms: int | None
    online: bool
    attention: list[str]
    game: int
    # A56 (S58): a powerup station's live item state as MC last told it: whether the item is there, and when it next spawns.
    item_available: NotRequired[bool]
    next_spawn_at_ms: NotRequired[int | None]
    taken_by: NotRequired[int]   # A56: the player_num that took the item this spawn; cleared at the next spawn
    # A58: the tamper lock MC last sent (`lock_until_ms` is MC's clock; absent = unlocked) and the restarts
    # MC counted inside this game's lock window.
    lock_until_ms: NotRequired[int]
    restarts: NotRequired[int]
    # A67 (F365): the station's current range with its source and edit age, and the on-station edits MC has
    # heard (oldest first, the last 8; `age_ms` is MC's count at this snapshot).
    range: NotRequired[StationRange]
    range_edits: NotRequired[list[RangeEdit]]


class RecapStationRow(TypedDict):
    """One assigned utility station's self-authoritative recap heartbeat."""
    node_id: str
    kind: StationKind
    id: int
    team: int
    heard: bool
    revives: NotRequired[int | None]
    hold_ms: NotRequired[dict[str, int] | None]
    owner: NotRequired[int | None]


class EndDeliveryRow(TypedDict):
    player_id: str
    display: str
    node_id: str
    tries: int
    since_ms: int
    reached: bool
    retrying: bool


class EndDeliveryView(TypedDict):
    match_id: str
    total: int
    confirmed: int
    unconfirmed: list[EndDeliveryRow]
    retrying: bool


class Coverage(TypedDict):
    """Derived socket coverage (A28.4, F256, F309). `on_backhaul`: bound nodes connected through the tunnel.
    `on_cellular`: those that also report `transport == "cellular"`, an independent path. `level` is
    "full" iff every bound node is on_cellular."""
    level: Literal["full", "zones"]
    on_backhaul: int
    on_cellular: int
    bound: int


TunnelStatus = Literal["off", "starting", "up", "error"]
TunnelProviderValue = Literal["cloudflared", "manual"]


class LanPublic(TypedDict):
    ws_url: str | None
    status: TunnelStatus
    provider: TunnelProviderValue | None
    available: bool
    detail: NotRequired[str]
    error: NotRequired[str]


class PresentationRow(TypedDict):
    event: str
    source: Literal["hud", "mc", "both"]
    desc: str
    sound: str | None
    words: str
    gun_led: int | None
    headset: int | None
    flash: Literal["green"] | None
    slot: Literal["queue", "interrupt"] | None
    text: str
    enabled: bool


class HeadsetSummary(TypedDict):
    pregame: str
    start_flash: bool
    in_play: str
    hit: int | None
    death: str | int
    respawn_flash: bool
    role: bool
    carrier: bool


class GunSummary(TypedDict):
    in_play: str
    pregame: str
    readout: NotRequired[dict[str, Any]]


class PresentationSummary(TypedDict):
    preset: str
    announcer: bool
    gun_flash: bool
    headset_team: bool
    sight_flash: bool
    hud_events: bool
    mc_events: bool
    mc_confidence: bool
    blackout: bool
    voice: Literal["on", "hits_only", "off"]
    headset: HeadsetSummary
    gun: GunSummary
    custom_events: list[str]


class McConfidence(TypedDict):
    confident: bool
    missing: list[str]
    stale: list[str]
    unflushed: list[str]


class PresentationView(TypedDict):
    summary: PresentationSummary
    events: list[PresentationRow]
    mc_confidence: McConfidence
    presets: list[str]


class WinnerView(TypedDict, total=False):
    team_id: str | None
    player_id: str | None
    undecided: str
    tie: list[str]


class PossessionView(TypedDict):
    by_team: dict[str, float]
    neutral_s: float
    sites: int
    reports: int
    observed_s: float
    of_s: int | None


class AfterEndPlayer(TypedDict):
    kills: int
    deaths: int


class AfterEndView(TypedDict):
    facts: int
    by_player: dict[str, AfterEndPlayer]


class RecapView(TypedDict):
    winner: WinnerView
    score: dict[str, int]
    rows: list[ScoreRow]
    honors: list[Honor]
    provisional: bool
    missing: list[str]
    warnings: NotRequired[list[str]]
    possession: NotRequired[PossessionView]
    settling: NotRequired[bool]
    awaiting: NotRequired[list[str]]
    since_end_ms: NotRequired[int | None]
    after_end: NotRequired[AfterEndView]
    post_end_facts: NotRequired[int]
    post_end: NotRequired[int]
    parked: NotRequired[int]
    stations: NotRequired[list[RecapStationRow]]


class MatchHistoryRow(TypedDict):
    match_id: str
    mode: str
    go_live_t: int | None
    ended_t: int | None
    recap: RecapView | None
    config: NotRequired[dict[str, Any]]


class VoiceOption(TypedDict):
    id: str
    name: str
    family: str
    speaker: NotRequired[str]
    lines: NotRequired[int]
    kill_line: str
    verified: bool


class VoiceList(TypedDict):
    default: str
    voices: list[VoiceOption]


class PhaseRefusalBody(TypedDict):
    """The 409 response emitted by NotReadyError; older error bodies may omit these fields."""
    error: str
    not_ready: list[str]
    greens: int
    roster_size: int


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
    # A37: the WEAPON check's own state, and it has THREE answers, not two.
    #   "proven"     -- the gun's slot-0 `$ALCD` carried the magazine the head's `$WEAP,0` wrote;
    #   "mismatch"   -- it carried a different one (the row's red `GUN ECHO ≠ CONFIG` blocker);
    #   "not_echoed" -- the gun answered the head but said nothing about ammo.
    # The third state exists because it is the NORMAL one in the field: `protocol/brx-protocol.md`
    # records the `$WEAP` echo as never seen from our v4.32 units and `$ALCD` as streaming on ammo
    # events only, so the usual answer to a head write is `$START`'s `$LCD,0,0,0,0,0,0,*` and nothing
    # else. Rendered NEUTRAL (never red, never counted as proven): a green row that ran no weapon
    # check must be visibly different from one that ran it and passed. `None` = nothing pushed, no
    # ack yet, the ack is for another head (the stale-ack blocker owns that row), or the head carries
    # no readable `$WEAP,0` -- in every one of those there is no check to report on.
    echo: Literal["proven", "mismatch", "not_echoed"] | None
    # Everything below is the NODE's last word, passed through verbatim. `None` = the node has not said
    # it (or no node is bound): the KEY is always here, the answer may not be.
    battery_pct: int | None
    battery_age_ms: int | None
    last_seen_age_ms: int | None    # ms since this node's last packet; None when no node is bound
    gun_linked: bool | None         # `status.preflight.gun_linked` as last reported
    # `status.preflight.gun_flapping` (bench 2026-09-17). The card shows one steady HEADSET OFF line while
    # it is true. An older server omits it, so a reader treats a missing key as false.
    gun_flapping: NotRequired[bool]
    pool_stale: Literal["silent", "no_fire", "write_lost", "pool_wrong"] | None   # F208: `status.pool_stale`; None = not stale or not reported
    pool_stale_ms: int | None                        # F208: `status.pool_stale_ms`; None = not reported
    cure: Literal["asking", "dead", "alive", "no_answer"] | None    # F264: the node's own outcome; None = it has not acted
    gun_locked: NotRequired[bool]                        # F272: positive verdict only; absent = no claim or older app
    fw: str | None
    phone_batt: int | None
    ssid_ok: bool | None
    mc_reachable: bool | None
    reach: Literal["lan", "backhaul"] | None       # A28.3, stamped by MC from the socket path; None once the socket is gone
    last_reach: Literal["lan", "backhaul"] | None  # field 2026-09-12 (F155): outlives the socket so a stale row can say which path it had
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
    # Round-2 fix pass B (2026-09-12): faults about the ROSTER AS A WHOLE rather than any one gun —
    # today exactly one, "all players on one team", which `push_config` and `start` refuse outright
    # (`force` included). Each entry is operator-facing copy; a non-empty list forces `go` false.
    roster_faults: list[str]
    # F-3 (2026-09-13): a connected companion phone with a gun set, claimed by nobody on the roster
    # and not parked on STANDBY either — never blocks `go`, it is the field's own "4 guns connected,
    # only 2 in lobby" confusion made visible on KIT/LOBBY (`state.py unrostered_phone_count()`).
    unrostered_phones: int
    # Review finding, 2026-09-19: a friendly, NEVER-blocking heads-up naming every bound node still
    # below `RESPAWN_PROFILE_MIN_APP` — a mixed fleet plays fine (the 0.4 compat gate is unrelated),
    # it just keeps the old spawn-protection rules until it updates. `None` when nobody is behind.
    respawn_rules_warning: str | None
    go: bool


# ---- M-MC snapshot (`state.py Session.snapshot`, `mc/API.md` State) ----
class LanView(TypedDict):
    """LAN details attached to every snapshot. Newer fields stay optional for older MC servers."""
    mode: Literal["router", "hotspot", "lan", "unknown"]
    ip: str
    port: int
    ws_url: str
    qr: str
    ssid: NotRequired[str | None]
    warning: NotRequired[str | None]
    join_secret: NotRequired[str]
    public: NotRequired[LanPublic]
    auth_required: NotRequired[bool]


class KitView(TypedDict):
    kitted: int
    total: int
    trying: dict[str, str]
    browsing: dict[str, int]


class GunConfigReadback(TypedDict):
    player_id: int
    team: int
    hp: int
    armor: int
    shield: int


class LobbyAck(TypedDict):
    ok: bool
    gun_echo: NotRequired[str]
    gun_config: NotRequired[GunConfigReadback]
    err: NotRequired[str]
    config_id: NotRequired[str]


class LobbyView(TypedDict):
    ready: int
    # F178: the READY players whose gun has not answered the pushed head yet (a subset of `ready`).
    # NotRequired: an older server never sends it, and the console reads its absence as 0.
    updating: NotRequired[int]
    total: int
    pushed: bool
    acks: dict[str, LobbyAck]
    all_acked: NotRequired[bool]


class GameAnnouncementView(TypedDict):
    loaded: bool
    config_id: NotRequired[str]
    sent: int
    total: int


# 2026-09-16: the PRE-ARM CHECK's ACKED cell. `none` = no head pushed for this lobby; `waiting` = pushed,
# no answer yet (never a fault); `failed` = refused ack, offline or unbound phone, or no answer in time.
SyncAckState = Literal["acked", "waiting", "failed", "none"]


class SyncRow(TypedDict):
    player_id: str
    display: str
    gun_id: str
    player_num: int
    bound: bool
    phone_game: bool
    gun_sent: bool
    gun_acked: bool
    gun_echo: Literal["proven", "mismatch", "not_echoed"] | None
    ack_state: SyncAckState


class SyncTotals(TypedDict):
    rostered: int
    phone_game: int
    gun_sent: int
    gun_acked: int
    gun_echo_proven: int
    in_sync: bool


class SyncView(TypedDict):
    rows: list[SyncRow]
    totals: SyncTotals
    unconfigured: list[str]


class SessionOptions(TypedDict):
    log_sync: Literal["auto", "manual"]


class VersionsView(TypedDict):
    field: dict[str, int]
    newest: str | None
    release: str | None
    mc_major: str


class NoticesView(TypedDict):
    mc_verify: NotRequired[str]


class OrphanMatchView(TypedDict):
    """Bench 2026-09-17: phones report ARMED/LIVE in a match this MC did not start. A phone need not be
    BOUND to a player for its claim to count here (F261, bench 2026-09-18: a fresh MC has no roster yet).

    Absent from `State` unless at least one such phone is heard now. `players` are display names, or the
    node id for a phone MC has not bound to a player yet. `can_resume` is false while MC runs or recaps
    a match of its own (END THEIR MATCH still works)."""
    match_id: str
    phones: int
    players: list[str]
    arm_state: Literal["armed", "live"]
    can_resume: bool


class RestoredFromView(TypedDict):
    at: int | None
    players: int


class SnapshotFeedRow(TypedDict):
    t_match_s: int
    text: str
    tag: NotRequired[str]
    kind: Literal["kill", "sync", "info", "alert"]


class State(TypedDict):
    """One complete Mission Control snapshot (`GET /api/state` and `/ui-ws`)."""
    session_id: str
    phase: Phase
    t: int
    lan: LanView
    mc_confidence: McConfidence
    nodes: list[NodeView]
    readiness: ReadinessSnapshot
    config: ConfigView
    config_errors: list[str]
    players: list[Player]
    teams: list[Team]
    kit: KitView
    loadout_pool: LoadoutPool
    lobby: LobbyView
    feed: list[SnapshotFeedRow]
    # Additive fields below are absent from snapshots emitted by older MC versions. Keep these
    # optional on the client so rolling a new console back to an older server remains safe.
    coverage: NotRequired[Coverage]
    stations: NotRequired[list[StationView]]
    game_byte: NotRequired[int]
    # X10: the old name for `game_byte` (the same wrapped byte, not a match count). Kept for an older console.
    game_no: NotRequired[int]
    config_warnings: NotRequired[list[str]]
    standby: NotRequired[list[Player]]
    active_preset_id: NotRequired[str | None]
    restored_from: NotRequired[RestoredFromView]
    game: NotRequired[GameAnnouncementView]
    sync: NotRequired[SyncView]
    options: NotRequired[SessionOptions]
    versions: NotRequired[VersionsView]
    start: NotRequired[StartView | None]
    live: NotRequired[LiveView | None]
    recap: NotRequired[RecapView | None]
    notices: NotRequired[NoticesView]
    end_delivery: NotRequired[EndDeliveryView]
    orphan_match: NotRequired[OrphanMatchView]   # bench 2026-09-17: absent unless phones are in a match MC did not start
    bench_volume: NotRequired[int]     # `--bench-volume N`: every $VOL MC compiles plays at N. Absent on a normal run
    perk_effects: NotRequired[dict[str, PerkEffectsResolved]]   # S50 build 4: {player_id: resolved effect},
    #                                     one entry per player carrying a perk (absent players carry none;
    #                                     the whole key absent when nobody on the roster has a perk). The
    #                                     SAME numbers `FrameBundle.perk_effects` carries for that player --
    #                                     `Compiler.perk_effects_resolved()` is the one arithmetic both read,
    #                                     so the console and the node can never disagree.


# ---- §5 envelope ----
class Envelope(TypedDict):
    v: int
    kind: str
    id: str
    seq: NotRequired[int]
    t: int
    body: dict


NODE_KINDS = {"hello", "bind", "event", "event_batch", "status", "ack_config", "time_req",
              "log_offer", "log_data", "ready", "loadout_request", "loadout_browse",   # A10: loadout_*
              "station_action"}   # A56 (S58): a powerup station's reset / taken report, live only
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
            "station_config",   # (A13.5 note below)
            "station_update"}   # A56 (S58): MC -> a powerup station: available / taken + the time to the next spawn.
                                # A13.5 (F104, 2026-09-11): MC -> a utility node. The same trap as `alert`:
                                # the phone's `MC_KINDS` (app/src/transport/envelope.js) must list it too, or
                                # the arming message is dropped as malformed before `onMessage` ever sees it.
CONTROL_CMDS = {"end", "panic", "abort_start", "recall",
                "resync", "respawn", "relink",   # A47 (bench 2026-09-17): the LIVE board's operator menu for ONE
                                                 # player phone. Each names `player_id` and `match_id`; the phone
                                                 # ignores one for another match or player (`engine.js control`).
                "release_utility"}   # A41 (2026-09-13): MC -> ONE utility node, an operator-driven cure for a
                                      # phone stuck in utility mode (field 2026-09-12: the phone's own exit is
                                      # the same undiscoverable seven-tap gesture its settings drawer uses, and
                                      # no MC message could reach it at all). `utility.js` takes it exactly the
                                      # way its own BACK TO HUD button does -- `state.py release_station`.

# A47: the three operator actions MC may send to ONE bound player phone (`state.py operator_action`).
OperatorCmd = Literal["resync", "respawn", "relink"]


class OperatorActionResult(TypedDict):
    """A47: `POST /api/players/{pid}/operator`. `pushed` means only that a socket took the push: no ack
    kind exists for `control`, so the phone's own log and the next heartbeat are the receipt."""
    ok: bool
    cmd: OperatorCmd
    player_id: str
    match_id: str
    pushed: bool
