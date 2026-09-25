"""M-MODES — the FrameBundle compiler (docs/spec/modes.md §1.1–§8, contracts §3, A5/A6).

MC-side, pure (no clock, no BLE). Turns a GameConfig + Player + teams into the per-player
`FrameBundle` the node writes VERBATIM. Wraps the frame builders in `gameconfig.py`; the node never
compiles. Implements the `interfaces.Compiler` Protocol.

A6: `cues(voice)` returns **pre-composed `$PLAY` frames** (not bare ids); `validate()` returns
`{ok, errors, warnings}`. A5.1: `player_num` is 1..63 on the wire, 0 reserved (tutorial / unknown).
"""
from __future__ import annotations

import dataclasses
import json
import math
import pathlib
from typing import Any, Literal, cast, get_args

import random as _random

from ..gameconfig import (END_SEQUENCE, GSET_T2_SAFE, WEAPON_TAILS, _SIR_TABLE, GameConfig as _GC,
                          assert_sir_follows_clear, assert_team_byte_consistent)
from .. import hitaudio as _ha
from ..protocol import PANIC_SEQUENCE
from .perks import PerkCatalog
from .policy import SIDEARM_TAG          # F146: one vocabulary for "this is a backup weapon"
from .types import (MAX_PLAYERS, OBJECTIVE_MODES, STATION_PROTECT_S_DEFAULT, STATION_SOURCES, TIMED_PROTECT_S_DEFAULT,
                    TRIGGER_AFTER_PROTECT_MS, WEAPON_DELAY_MS_DEFAULT, DotSpec, FrameBundle, GameConfig, Health,
                    HealthPreset, HirCell, PerkEffectsResolved, PerkView, Player, PowerupSlot, RespawnProfile, StationProtectS, Team,
                    TimedProtectS, ValuePair, VoiceOption, WeaponDelayMs, Weapon, parse_app_ver, parse_win_by)
from .types import GAME_VOLUME_MAX, GAME_VOLUME_MIN, VENUE_VOLUME_INDOOR, VENUE_VOLUME_OUTDOOR   # K8
from . import presentation as _pres
from .. import poolgauge as pg
from .. import voices as _voices
from ..modes.hillbeacon import NEUTRAL_TEAM as _NEUTRAL_TEAM
from ..modes.registry import validate_mode_params as _validate_mode_params

# Field-corrected 2026-08-30 (first live 2-player match on the Mac): $VOL,69 — the value iOS
# Callsign sends — plays at roughly **on-gun level 2** and Tony called it "super low" outdoors.
# The on-gun menu maps L1=60 L2=70 L3=80 L4=90 L5=100 (protocol/brx-protocol.md $VOL), so play
# volume is now taken from the venue: L3 indoors, L4 outdoors (the level he asked for).
# `$HLED` token 5: Callsign ships **10** in every populated LED frame on disk. Tony asked for the
# on-hit alert to be brighter and I raised it to 100 — that was WRONG and is reverted.
# ⛔ We do NOT know this token is brightness. The 2026-08-30 per-field sweep pinned token 5 on
# `$GLED` (the GUN), not on `$HLED` (the HEADSET), and the two commands demonstrably do not share a
# layout: `$GLED,,,,5` blanks by APPLYING empty colour tokens, `$HLED,,6` blanks via token 2. The APK's headset LED
# family exposes `LedColorType` / `BlinkLoopType(Once, ThreeTimes, Infinite)` / `LedEffectType` —
# counts and effects, not a brightness scale. Given tokens 3/4 are `90,90` (an on/off ms pair), the
# likeliest alternative is a REPEAT COUNT, in which case 100 would turn Callsign's ~1.8 s alert into
# ~18 s of blinking: it would light a player up for the next ten seconds of a firefight.
# It also destroyed the experiment. Raising it in the same commit that added the "did the cue fire?"
# log meant the next field test could not separate "our code never fired" from "the gun rejected the
# value". Callsign's 10 is the known-good control and it stays until the cue is confirmed firing.
# ➡ 2026-09-02, from the Windows lane's video rig: on `$GLED` token 5 is a brightness with exactly
#   TWO levels above off — 1 is dim (~70%), anything >=2 is full, identical all the way to 255 —
#   and **Callsign's 10 already sits in the saturated region**. If `$HLED` behaves the same, 10 is
#   ALREADY maximum and raising it can do nothing: a dim on-hit alert would be a hardware limit,
#   not a value we are under-driving. Measured on the GUN LEDs, so still an inference for the
#   headset — but it is now the likely answer, and it is cheaper to test than to sweep.
HEADSET_ALERT_BRIGHTNESS = 10

VOL_BY_ENV = {"indoor": VENUE_VOLUME_INDOOR, "outdoor": VENUE_VOLUME_OUTDOOR}
VOL_PLAY = VOL_BY_ENV["indoor"]    # unknown venue -> the QUIETER of the two (see play_volume)
VOL_TRYOUT = 69                    # a try-out is fired at ARM'S LENGTH from the player's own head,
                                   # so it keeps the quieter Callsign value (review 2026-08-31).
                                   # The field complaint was about hearing a game across a field.
# `--bench-volume [N]` (bench 2026-09-16): a bench run plays every $VOL MC compiles at N. 30 is barely
# audible and the venue value is too loud at a bench. Not for a real game.
BENCH_VOLUME_DEFAULT = 55


def check_volume(value) -> int:
    """A $VOL level: an integer 0-100. Raises ValueError otherwise."""
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100:
        raise ValueError(f"volume must be an integer 0-100, got {value!r}")
    return value


# K8 (Tony, field 2026-09-12): the host's per-game volume knob, `GameConfig.volume`. Absent or null =
# the venue volume (`play_volume`). The bounds live in types.py (GAME_VOLUME_MIN/MAX, generated into
# the console): the floor is on-gun level 1 (`gameconfig.VOLUME_LEVELS`, 60), since 55 is barely audible
# at a bench and 30 is inaudible for game audio. `--bench-volume` still wins; a try-out keeps VOL_TRYOUT.


def check_game_volume(value) -> int | None:
    """`GameConfig.volume`: None (the venue default) or an integer GAME_VOLUME_MIN..GAME_VOLUME_MAX."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not GAME_VOLUME_MIN <= value <= GAME_VOLUME_MAX:
        raise ValueError(f"volume must be an integer {GAME_VOLUME_MIN}-{GAME_VOLUME_MAX} "
                         f"or null (the venue default), got {value!r}")
    return value


def head_volume(config) -> int:
    """The match head's $VOL for this config: the K8 knob when set, else the venue volume."""
    v = check_game_volume(config.get("volume"))
    return play_volume(config.get("environment")) if v is None else v

# ---------------------------------------------------------------------------
# Venue range (F234, correcting F135/B6) -- see docs/weapon-design.md §4.2 and
# docs/experiment-log/2026-09.md (2026-09-17 garden range test).
# ---------------------------------------------------------------------------
# CORRECTED READING, do not revert: this plumbing used to scale `$WEAP` t41 (`gunRangeIndoor`) by
# venue. The 2026-09-17 garden test (Q15/F231) proved t41 is a NULL outdoors -- two slots
# differing only in t41 (5 vs 75) scored 27/27 vs 55/57 at every paced distance, 3 m to ~200 ft --
# while the SAME session found the token that does move hits at `$WEAP` t2 (APK name
# `gunRangeOutdoor`): t2=5 landed 0 hits from 38 shots at any distance, t2=100 (the shipped value
# on every gun) reaches ~200 ft, with a floor, a transition around 13-26, and a flat shelf from
# ~31 up. t2 sets the emitter's CARRIER FREQUENCY, not its power (V4_31 disassembly, 2026-09-18,
# `protocol/brx-protocol.md`): a low value detunes the word out of the receiver's band-pass near
# 38 kHz, it does not shorten the beam. So read the shelf as the pass-band, not as a power plateau.
# F234 filed the fix: move this plumbing from t41 to t2. t41 stays written EXACTLY as the
# capture carries it from here on (see `resolve()` -- there is no longer a `put("range_indoor", ...)`
# call at all) because indoor behaviour is still unmeasured (F231 open) and a guessed indoor value
# would be a false promise.
#
# RANGE_OUTDOOR_FLOOR is not a design choice, it is a hard measured fact: t2=5 landed on nobody at
# any distance the garden could pace, including muzzle-on-dome. A weapon compiled under the floor
# is a weapon that silently cannot hit anyone, so `gun_range_outdoor_pct` refuses to compile one.
# The floor is a property of the RECEIVER, not of the firmware: 13 sits at 27.1 kHz, far enough
# below the ~38 kHz band-pass that the receiver drops the word. The firmware clamps nothing.
RANGE_OUTDOOR_FLOOR = 13


def gun_range_outdoor_pct(base_captured: int, wire_value: int | None, environment: str | None) -> int:
    """$WEAP t2 (gunRangeOutdoor) for one weapon at one venue (F234).

    Outdoor ships the weapon's own catalogue starting value (`weapons.json` `wire.range_outdoor_pct`,
    docs/weapon-design.md §4.2's shipped table) when the weapon has one. A weapon with no catalogue
    value -- every hidden/cut weapon, the sidearms, melee -- keeps its captured t2 unchanged (100 on
    every captured gun so far, 90 on melee).

    Indoor is deliberately UNTOUCHED: nobody has run this ladder indoors (F231 open), so an unknown
    or indoor venue always keeps `base_captured` -- never invent an indoor number.
    """
    if (environment or "").strip().lower() == "outdoor" and wire_value is not None:
        value = int(wire_value)
    else:
        value = base_captured
    if value < RANGE_OUTDOOR_FLOOR:
        raise ValueError(
            f"$WEAP t2 (gunRangeOutdoor) {value} is below the measured floor ({RANGE_OUTDOOR_FLOOR}): "
            "F231 measured t2=5 landing 0 hits from 38 shots at any distance, including muzzle on the "
            "dome -- a weapon compiled below the floor cannot hit anyone")
    return value


# ---------------------------------------------------------------------------
# Experimental emitted-IR controls over BLE (F162)
# ---------------------------------------------------------------------------
# The gun has a native indoor/outdoor toggle -- ALT pressed quickly in succession at power-on --
# that changes beam WIDTH (roughly double the aim tolerance in outdoor mode) and persists across
# power cycles. The 2026-09-13 field checks did not reproduce the t2 reception failure through
# this toggle; native play reached about 200 ft in both toggle states. Its full behavior is not
# characterised.
#
# `$GSET` t2 is a SEPARATE receiver control (not `$WEAP` t2 / `gunRangeOutdoor` above, a different
# command's token 2): t2=1 crippled hit reception at 30 ft, and t2=0 restored it. Shipping heads
# pin t2 to 0 at every venue. The t3 and `$IRTX` candidates below remain unconfirmed ways to
# control emitted IR and remain disabled. `DRIVE_IO_MODE` therefore stays "off"; a future bench
# experiment may enable exactly one candidate by editing this line.
#
# These legacy candidates stay separate from `gun_range_outdoor_pct` above: `$WEAP` t2 is
# per-weapon and these `$GSET`/`$IRTX` candidates are per-gun, so a bench run that moves both
# proves nothing about either.
DRIVE_IO_MODE: Literal["off", "gset_t3", "irtx"] = "off"

# Candidate (b): `$GSET` token 3, `gunLaserRegion` -- "IR transmit power, as a regional legal limit
# (USA vs International) ... the one field that looks like a direct power control, so it is the first
# thing to try" (docs/manual/dev.md). The APK's `GunLaserRegion` enum recovers as USA / International
# in declaration order (protocol/callsign-extract/apk-harvest.md "Region / legal power"), i.e. 0 and
# 1 -- but which region permits MORE power is not documented anywhere we have, and the teardown
# recovers names in declaration order with no values, so even 0/1 is an inference.
#
# Hence the direction of this table: every capture we hold, and every head MC has ever pushed, is
# t3 = 1, and INDOOR is the venue that works -- so indoor keeps 1 and emits nothing at all. OUTDOOR
# is the venue that is failing, so it gets the one untried value. An unknown venue resolves to 1,
# today's value, so it can never emit a surprise. Run C measures the direction with its own control.
GSET_T3_BY_ENV: dict[str, int] = {"indoor": 1, "outdoor": 0}

# Candidate (c): `$IRTX`. ⚠️ TWO FIELD LISTS EXIST AND THE OLDER ONE IS WRONG.
# `protocol/callsign-extract/protocol-classes.md` carries a 4-field row
# (`iRPower, soundOnHit, rangeOutdoor, rangeIndoor`) which reads exactly like the venue control we
# want -- but that shape was already probed on the bench and emitted ZERO IR against a receiver
# control, and the 2026-09-04 metadata read recovered the real, 11-field shape
# (protocol/brx-protocol.md §3.2; docs/archive/bench-flash-control-2026-09-05.md):
#     $IRTX,<Direction>,<BulletType>,<PlayerId>,<Team>,<Damage>,<IsCriticalShot>,
#           <Power>,<IrRange>,<LoopFire>,<IrPulse>,<FlashLED>,*
# In that shape `$IRTX` is a RAW TRANSMIT, not a mode: `Power`/`IrRange` are parameters of the word
# it sends. Whether they also stick for the trigger's own shots is exactly what Run E asks. So the
# frame below is a deliberately HARMLESS probe -- Damage 0, PlayerId 0 (the A5.1 "no identity" id, so
# a stray word can never be credited), Team 0, no loop, no pulse train, no flash -- with the venue
# moving only the (Power, IrRange) pair. Enabling this gate makes every gun emit one such word during
# config; that is the point of the gate, and it is why it ships "off".
#
# The magnitudes are a STARTING POINT, not a finding: both scales are unmapped. Indoor borrows the
# `$WEAP` t41 stock magnitude (75) so the two range levers read on one scale at the bench, and
# outdoor takes the top of it. An unknown venue resolves to the indoor (quieter) pair.
IRTX_BY_ENV: dict[str, tuple[int, int]] = {"indoor": (75, 75), "outdoor": (100, 100)}


def venue_mode_frames(gset: str, environment: str | None,
                      mode: Literal["off", "gset_t3", "irtx"] | None = None) -> list[str]:
    """The venue-mode frames that ride in the head right after `$GSET`, for `DRIVE_IO_MODE` (F162).

    `[]` today and at every venue -- see `DRIVE_IO_MODE` above for why, and read it before changing
    anything here. `gset` is the head's own `$GSET` frame, passed in so the `gset_t3` candidate can
    re-issue a BYTE COPY of it with exactly one token moved: a bench rung that changes two things at
    once measures neither, and rebuilding the frame from parts is how a second token drifts.
    `mode` overrides the module gate (tests; a bench driver that wants one rung without an edit).
    """
    m = DRIVE_IO_MODE if mode is None else mode
    if m == "off":
        return []
    env = (environment or "").strip().lower()
    if m == "gset_t3":
        tokens = gset.split(",")
        # $GSET,<t1>,..,<t8>,*  -> t3 is index 3. A frame that is not the 8-token $GSET we compiled
        # is not something to guess at: emit nothing rather than corrupt the head.
        if len(tokens) != 10 or tokens[0] != "$GSET":
            return []
        want = str(GSET_T3_BY_ENV.get(env, GSET_T3_BY_ENV["indoor"]))
        if tokens[3] == want:
            return []          # already what the head carries: no redundant re-issue
        return [",".join(tokens[:3] + [want] + tokens[4:])]
    if m == "irtx":
        power, ir_range = IRTX_BY_ENV.get(env, IRTX_BY_ENV["indoor"])
        #        dir bullet pid team dmg crit  power     range     loop pulse flash
        return [f"$IRTX,0,0,0,0,0,0,{power},{ir_range},0,0,0,*"]
    # ⚠️ NOT a fallthrough to `$IRTX`. This gate is edited by hand between bench rungs, and `$IRTX` is
    # the one candidate that TRANSMITS -- so "anything I don't recognise" must never resolve to the
    # frame that fires IR. `Literal` + the pyright gate catch a typo in the constant above; this
    # catches one that arrives any other way.
    raise ValueError(f"DRIVE_IO_MODE: unknown venue-mode gate {m!r} (off | gset_t3 | irtx)")


# The health pool every published weapon stat is quoted against: 45 HP + 70 armour, the GameConfig
# default. It is a DEFAULT, not a constant of the game — MC lets the host change `health`, and
# `weapon_view(..., pool=)` follows it (docs/weapon-design.md §2.5). Only `stats.dmg`, whose
# definition *is* "share of a 115 pool", is pinned here.
DEFAULT_POOL = 115


# Token 1 is a headset colour index. Across all 23 captures it is only ever 0, 1, 7 or empty, and the
# APK's `LedColorType` has only a handful of members — so a 4-team game's tid 2/3, and certainly any
# larger tid, would be a token we cannot name. Emit it only for the values Callsign has been seen to
# send, and stay silent otherwise rather than guess.
# 2026-09-02/03: the headset palette was read off hardware -- indices 0-7 render the same hues as the
# gun (0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal · 6 white · 7 pink), so a 4-team
# game's tid 2/3 now has a known colour and is emitted too. ⚠ 3 is GREEN, the headset's own death
# out-blink colour; a green team's headset is ambiguous while a player is down.
# led-language.md §6 finding #13 (2026-09-07): this used to stop at (0,1,2,3) while `presentation.py`
# allowed 0-7 -- one shared range, `poolgauge.HEADSET_TIDS`, so the two modules can never disagree again.
_HLED_SEEN_COLOURS = pg.HEADSET_TIDS


def _headset_colour(tid: int, leds: bool, ffa: bool = False, night: bool = False) -> list[str]:
    """The pre-game headset team colour, or nothing (WHITE for every player in FFA -- Q19, no team
    identity to protect there).

    Skipped when the game has LEDs off: `gc._led_frames()` blanks the GUN for blackout play (night only dims), and
    lighting the headset in the same head would mark every player in the lobby — exactly what that
    setting exists to prevent (review 2026-09-01).

    F35/led-language.md §6 finding #11 (2026-09-07): PAINTS `pg.display_colour(tid)`, never the raw
    tid -- team 3 stays green on the wire (its combat identity, F35) but paints purple.
    """
    colour = pg.FFA_COLOUR if ffa else pg.display_colour(tid)
    if not leds or colour not in _HLED_SEEN_COLOURS:
        return []
    # `night` dims to token 5 = 1 (led-language.md §3.4). Until 2026-09-07 this hardcoded 10 and took
    # no `night` at all, so a night bundle shipped a dimmed GUN BODY one line away from a
    # full-brightness HEADSET in the same `head` (D3). Blackout is the OTHER case and is handled by
    # `leds` above -- the caller omits the headset entirely; `night=True` is not a substitute for that.
    return [pg.headset_team_frame(tid, ffa, night)]


def play_volume(environment: str | None) -> int:
    """$VOL for game audio at this venue. See VOL_BY_ENV — 69 was measurably too quiet outdoors.

    An unrecognised venue resolves to the INDOOR value. `set_config` validates `indoor|outdoor`, so
    this is only reachable through a preset or a hand-edited config — but the failure has to be quiet,
    not loud: guessing "outdoor" for an unknown venue means blasting L4 into someone's ear indoors.
    """
    return VOL_BY_ENV.get((environment or "").strip().lower(), VOL_PLAY)


# S50 (2026-09-17, perk balance pass; docs/perk-design.md §2): the flat armour grant/cost a
# `max_armor_add` perk carries. Body Armor +25 (was +50 -- "maybe 50 is too much armor and it should
# be 25", Tony 2026-09-17); Quick Switch -20 (its cost for Quick Switch's swap-speed grant). Kept as
# a compiler-side table, keyed by perk_id, rather than trusting `perks.json`'s own `effects.
# max_armor_add` at compile time: the two must obviously agree (perks.json is the wire-visible
# documentation of the same number), but this is the one place the ARITHMETIC runs, matching every
# other shared-formula table in this module (`_POOL_GRANT_PCT`'s S50-draft predecessor, `_SIR_*`).
_MAX_ARMOR_ADD: dict[str, int] = {"body_armor": 25, "quick_switch": -20}


# §7.3: the health the Shields preset carries, and the floor the warning below measures against. It
# was 30 until the 2026-09-18 bench proved armour piercing ignores a shield, which made the shield worth
# nothing against that perk and left only the health underneath to fight through.
_SHIELDS_MIN_HP = 45


def is_shields_preset(config: GameConfig) -> bool:
    """S50 (docs/perk-design.md §2): true when this game's BASE health config carries zero armour,
    so a shield pool is the player's only non-HP buffer (the Shields preset -- 45 HP + 105 shield +
    no armour, weapon-design.md §7.3). Reads the GAME's `health.max_armor`, never a per-player
    `overrides.max_armor` -- an individually handicapped player (armoured down to 0 for that one
    player) must not flip this branch for everyone else, or for themselves: the preset is a fact
    about the game's design, not about one player's pool.

    ⚠️ Hardcore (45 HP, 0 armour, 0 shield -- `HEALTH_PRESETS`) also carries zero armour, so this is
    also true for Hardcore. That is intentional and pre-existing (this function has never read
    `max_shield`): the branch it gates is "does an armour-0 game route perk armour grants into
    shield instead", which is a fact about armour alone. A Body Armor perk in Hardcore still redirects
    into shield (`armed_shield`), which can start the S29 recharge for that one player even though the
    game's own `max_shield` is 0 -- a pre-existing interaction with S50, not something this feature
    changes."""
    return int((config.get("health") or {}).get("max_armor") or 0) == 0


# Tony 2026-09-19 (FOLLOWUPS S45, weapon-design.md §7.3): the three named starting-pool presets a host
# picks in Mission Control's game setup, replacing the old free-form "custom health"/"armour" fields
# with no shield at all. (max_hp, max_armor, max_shield) -- keep in that order, `state.py _merge_config`
# and `resolve_health_preset` both zip against it positionally.
HEALTH_PRESETS: dict[str, tuple[int, int, int]] = {
    "standard": (45, 70, 0),     # the old GameConfig default (S45: "Standard" ships no shield now,
                                  # where it used to arm a $PSET t5 of 70 nobody could see or turn off)
    "shields":  (45, 0, 105),    # §7.3: 45 HP so Armour Piercing does not hard-counter the preset
    "hardcore": (45, 0, 0),
}
HEALTH_PRESET_NAMES: tuple[str, ...] = (*HEALTH_PRESETS, "custom")


def default_health() -> Health:
    """The Standard preset, as a full `Health` -- `state.py default_config()`'s own `health` value."""
    hp, armor, shield = HEALTH_PRESETS["standard"]
    return {"max_hp": hp, "max_armor": armor, "max_shield": shield, "preset": "standard"}


def normalize_health(h: object) -> Health:
    """A `health` blob from anywhere untyped -- a persisted `session.json` snapshot from before this
    field existed, most concretely (`state.py restore_snapshot`) -- coerced to a complete `Health`.
    Missing `max_shield` is the LEGACY SIGNAL (S45): the pool predates the field, so its shield intent
    is unknown and the preset reads CUSTOM rather than guessing one. A complete blob with no `preset`
    (or an unrecognised one) gets one re-derived from its own numbers, same as `resolve_health_preset`
    everywhere else. Idempotent: normalizing an already-normal `Health` returns it unchanged."""
    d = h if isinstance(h, dict) else {}
    legacy = "max_shield" not in d
    hp, armor, shield = int(d.get("max_hp") or 45), int(d.get("max_armor") or 0), int(d.get("max_shield") or 0)
    preset = d.get("preset")
    if legacy or preset not in HEALTH_PRESET_NAMES:
        preset = "custom" if legacy else resolve_health_preset(hp, armor, shield)
    return {"max_hp": hp, "max_armor": armor, "max_shield": shield, "preset": cast(HealthPreset, preset)}


def resolve_health_preset(max_hp: int, max_armor: int, max_shield: int) -> HealthPreset:
    """Which named preset these three numbers ARE, or "custom" -- a label RE-DERIVED from the pool
    every time (mirrors `policy._matches_preset`/`merge()`'s "preset" handling for `loadout_policy`):
    never trusted as a client's own claim, so a hand-edited number always shows CUSTOM and a preset
    pick always shows its own name."""
    for name, ref in HEALTH_PRESETS.items():
        if (max_hp, max_armor, max_shield) == ref:
            return cast(HealthPreset, name)
    return "custom"


def armed_armor(armor: int, perk_id: str | None = None, shields: bool = False) -> int:
    """$PSET armour after a `max_armor_add` perk's grant, capped at the 255 policy ceiling and
    floored at 0 (NOT a device limit -- $PSET pools store past 255 with no wrap, see the note in
    `_to_gc()`; both bounds are our own policy choice). The floor matters now that a cost perk
    (Quick Switch, docs/perk-design.md §2) carries a NEGATIVE grant -- `armed_armor()` used to only
    cap, never floor, before S50 (docs/perk-design.md §5.4).

    One arithmetic, called wherever the armed armour is needed -- it drifted into three disagreeing
    copies once already (review 2026-09-01: a `body_armor` player was armed at a 165 pool while a
    simpler, perk-blind version of the sum graded it at 115), so `_to_gc()`, `Compiler.validate()`,
    and `Session.health_pool()` all go through here.

    `shields=True` (`is_shields_preset()`): the grant is redirected to `armed_shield()` instead --
    adding an armour LAYER to a preset built with none would defeat its design (docs/perk-design.md
    §2) -- so this returns `armor` (0, by construction of that branch) untouched."""
    if shields:
        return max(0, min(255, int(armor)))
    grant = _MAX_ARMOR_ADD.get(perk_id or "", 0)
    return max(0, min(255, int(armor) + grant))


def armed_shield(shield: int, perk_id: str | None = None, shields: bool = False) -> int:
    """$PSET shield after a `max_armor_add` perk's grant, ONLY when `shields` (`is_shields_preset()`)
    -- the branch `armed_armor()` defers to. Same 255 cap / 0 floor as armour; outside a shields
    preset this is the shield pool untouched (still clamped, for consistency, though nothing writes
    it that high today)."""
    if not shields:
        return max(0, min(255, int(shield)))
    grant = _MAX_ARMOR_ADD.get(perk_id or "", 0)
    return max(0, min(255, int(shield) + grant))


def armed_pool(hp: int, armor: int, perk_id: str | None = None, shields: bool = False) -> int:
    """hp + `armed_armor()` -- the total pool hits-to-kill math (KIT, ARSENAL, the mag>=htk gate in
    `validate()`) is quoted against. Deliberately excludes shield (docs/perk-design.md §2: shield
    sits above this pool and is not counted in hits-to-kill -- shield was always "IR-only, inactive
    until activated", never part of the published pool). `_to_gc()` needs hp and armor as separate
    `$PSET` fields, so it calls `armed_armor()` directly instead of this."""
    return int(hp) + armed_armor(armor, perk_id, shields)

# ---- $SIR effect classes (bench-measured 2026-08-26; experiment-log "the COMPLETE two-sided $SIR
# function map + crit multiplier + FF enforcement"). A weapon's <t3,t4> is the composite key into the
# $SIR table MC pushes in every game head, and the ROW'S FUNCTION decides what the IR word's magnitude
# does. So damage is a property of the (weapon, table) PAIR, never of the weapon alone.
# ⚠ fn 3 was REMOVED from this set 2026-08-29 (exp-log "FLOOR ARTIFACT CLOSED: fn 3 is DAMAGE").
# It only looked inert because the original sweep ran with the shield at 0; re-measured with a shield
# granted first, it drains exactly what fn 1 drains. It is plain damage and lives in _SIR_PLAIN_DAMAGE.
_SIR_NO_POOL = frozenset({8, 23, 24, 25, 26, 27, 28, 35, 31, 32, 34})     # registers a $HIR, moves no pool
# ✅ RESOLVED 2026-09-11 (bench, gun Tactix-3D4F): fn 36/37 only scale the HEADSET sensor, and the scale is a
# function of the compiled `$GSET` criticalShotModifier (t7), not a fixed constant. On the GUN BODY
# sensor, fn 1/36/37 all land the raw magnitude (x1) -- five sets of five words, sensor field recorded
# on every hit, confirmed the split. On the HEADSET sensor: fn 36 lands floor(magnitude * (1 + t7/200))
# and fn 37 lands floor(magnitude * (1 + 2*t7/100)); a t7=0 closing control on fn 37 read back to x1,
# isolating t7 as the driver. See `headset_multiplier()` below. This reconciles, rather than overturns,
# the two earlier readings: 2026-08-27's "x1.0" matrix was rig-pinned to the gun body (correct, body is
# always x1) and 2026-09-02's x1.25/x2 reading was taken on the headset at the MC-compiled default
# t7=50 (also correct) -- neither was wrong, they measured different sensors. Method lesson: record the
# `$HIR` sensor field on every hit. See docs/ir-effects-design.md §6 and brx-protocol.md §5,
# experiment-log/2026-09.md (2026-09-11, bench).
def headset_multiplier(fn: int, crit_modifier: int) -> float:
    """HEADSET-sensor damage multiplier for a $SIR row's function, at the compiled `$GSET`
    criticalShotModifier (t7, 0-100). Bench-confirmed 2026-09-11: fn 36 -> 1 + t7/200 (x1.25 at the
    then-MC default t7=50), fn 37 -> 1 + 2*t7/100 (x2.0 at t7=50); every other function is unscaled (1.0).
    2026-09-17 (arsenal review): the MC default is now t7=0, so both fn 36 and fn 37 return 1.0 at the
    compiled default -- BRX has 4 headset sensors and 1 tagger sensor and play aims at the head, so the
    headset needs no bonus multiplier. The formula above is unchanged; only the compiled default moved.
    ⚠ HEADSET ONLY -- the gun-body sensor applies the raw magnitude (x1) for fn 1/36/37 alike, which is
    why `WeaponCatalog.damage()`/`hits_to_kill()`/`time_to_kill()` do NOT call this: they compute the
    body number, the guaranteed kill. `applied = floor(magnitude * headset_multiplier(fn, t7))` on a
    headset hit."""
    if fn == 36:
        return 1 + crit_modifier / 200
    if fn == 37:
        return 1 + 2 * crit_modifier / 100
    return 1.0


_SIR_ARMOR_PIERCING = frozenset({2, 6})           # bypasses armor AND shields -> straight to bare HP
_SIR_GRANT = frozenset(range(9, 23))              # heals/armor/shields: a "damage" weapon here HELPS the target
# ALLOW-LIST, deliberately: only these are bench-confirmed plain 1x damage. Anything not listed is
# warned about, because the failure we are guarding against (a weapon that cannot hurt anyone, or
# worse, heals what it shoots) lives precisely in the functions we have NOT characterised.
# ⚠ fn 38 was REMOVED from this set 2026-09-17 (F225): bench-proven to HALVE every hit (a charge of
# 100 landed 50, a tap of 20 landed 10), not plain damage. It is not added to any other set either --
# its true effect is still uncharacterised beyond "halves" -- so a weapon that keys to it now falls
# through to the final `elif` and is WARNED about, which is the guard this whole allow-list exists
# to provide: nothing may key to fn 38 by accident and ship silently halved.
_SIR_PLAIN_DAMAGE = frozenset({1, 3, 4, 5, 7, 29, 30, 33})   # 3 added 2026-08-29, see above; 38 removed 2026-09-17


# S50 (2026-09-17, Armour Piercing perk; docs/perk-design.md §2): ONE permanent, GAME-WIDE cell,
# always in `gameconfig._SIR_TABLE` (so it ships in every head, whoever compiles it, including a
# late joiner's -- see `sir_table()`: stock rows are never removed). A (proto,sub) cell's function is
# the SAME on every player's compiled table (the victim's table decides the effect, keyed by the
# SHOOTER's `$WEAP` t3/t4 -- see `assert_sir_covers_weapons`), so this key means "armour piercing"
# FOR THE WHOLE MATCH: two players can never give the same cell two different meanings. `(4,0)` is a
# free cell (`hitaudio.FREE_CELLS`), reserved in `hitaudio.RESERVED_CELLS` so the A17 class-sound
# rekey allocator never reassigns it. fn 2 is bench-proven (`_SIR_ARMOR_PIERCING` above) to bypass
# armour AND shields, straight to HP.
_AP_CELL: tuple[str, str] = ("4", "0")
_AP_FN = 2
# ⚠️ 2026-09-18: Armour Piercing's damage is a PER-WEAPON number (`ap_dmg` in weapons.json), not a
# multiplier, and this constant is gone. A multiplier cannot price the perk at all. Bypassing armour
# takes a standard target from a 115 pool to 45 HP, and 45/115 is 0.39, so a multiplier near the old
# 0.4 leaves hits-to-kill UNCHANGED: the perk skips every layer and costs nothing. Worked across the
# catalogue, 0.4 left Armour Piercing STRICTLY BETTER on 11 of 13 weapons, the Assault Rifle killing in
# 1.10 s against anything versus its plain 1.20 s. Integer damage is the other half of the problem: at
# 8 damage the only choices are 3, which is free, and 2, which is useless, with nothing in between, so
# most weapons have no fair price and simply cannot carry the perk. See weapon-design.md §7.7.


def assert_armor_piercing_armed(head: list[str]) -> None:
    """S50: refuses to arm a player carrying Armour Piercing if THIS compiled head's `$SIR` table
    has no row for `_AP_CELL`. The mechanism lives in the VICTIM's `$SIR` table (every gun that
    might be hit, not the shooter's own) -- a gun that never received this row ignores those shots
    ENTIRELY and SILENTLY while both ends report healthy: the F11 failure (a gun with no `$SIR` row
    for a cell eats every hit on it and says nothing), the same shape that let the Energy Launcher
    ship for weeks keyed to a row landing 0 damage. An ERROR, not a warning: a weapon that cannot
    hurt anyone must never reach a player. `assert_sir_covers_weapons` (the general F11 guard) would
    also catch this once the primary is re-keyed onto `_AP_CELL` with no matching row -- this is the
    same failure, named for what it means: the perk did not arm."""
    cells = {c for c in _sir_cells([f for f in head if f.startswith("$SIR")]) if c != ("", "")}
    if _AP_CELL not in cells:
        raise ValueError(
            f"S50 ARMOUR-PIERCING GUARD: this head's $SIR table has no row for <{_AP_CELL[0]},{_AP_CELL[1]}>, "
            "the armour-piercing cell -- an Armour Piercing primary keyed to it would fire IR words every "
            "gun on this cell silently ignores (the F11 failure: a gun with no matching $SIR row reports "
            "healthy and eats the hit while dealing nothing). Refusing to arm rather than ship a weapon "
            "that cannot hurt anyone.")


def _sir_index(table) -> dict[tuple[str, str], int]:
    """`$SIR,<proto>,<sub>,<snd>,<fn>,...` → {(proto, sub): fn}."""
    out: dict[tuple[str, str], int] = {}
    for row in table:
        t = row.strip().lstrip("$").rstrip("*").rstrip(",").split(",")
        if len(t) > 4 and t[0] == "SIR":
            try:
                out[(t[1] or "0", t[2] or "0")] = int(t[4] or 0)
            except ValueError:
                continue
    return out


# --------------------------------------------------------------------------- #
# A17 CLASS LAYER -- the $SIR <soundID> the VICTIM hears, keyed by the shooter's weapon
# --------------------------------------------------------------------------- #
# Two levels, because only one of them is safe today (see hitaudio.py):
#   SOUNDS-ONLY (always on): write a family sound into the sound token of the rows we ALREADY ship.
#     Nothing moves; the table keeps every stock cell, so a stock gun or a grenade station still
#     registers exactly as before. This alone takes the arsenal from 3 audible classes to 8, because
#     the three commonest rows -- <0,0>, <0,1>, <0,3> -- ship their sound token EMPTY today.
#   RE-KEY (config `hit_audio_rekey`, DEFAULT OFF): additionally move each (family, function) group
#     onto its own free cell so the AR, the shotgun and the suppressor stop sounding identical.
#     ⚠ An unmatched cell is SILENTLY IGNORED -- the F11 failure -- so this stays off until the bench
#     clears F38/F39. `assert_sir_covers_weapons` is the guard that makes it survivable when it is on.
_SIR_SOUND_TOK = 3          # $SIR,<proto>,<sub>,<soundID>,<fn>,... -- split()[3] over the leading "$SIR"
# How many rolled `$SIR` tables ship in `FrameBundle.sir_pool`. Four is enough that a player does not
# hear the same draw twice in a row without making the bundle (which crosses the LAN to every phone)
# meaningfully bigger -- each take is ~10 short rows.
_SIR_TAKES = 4


def _sir_cells(table) -> list[tuple[str, str]]:
    """The (proto, subtype) each row of a `$SIR` table keys, in table order. `("", "")` means "not a
    `$SIR` row at all" — the answer both F121 guards read as "nothing to disarm, nothing to check".

    A row that SAYS `SIR` and carries no cell gets an error, not that answer (round-2 review
    2026-09-12): `sir_spawn_protected` used to copy such a row into the pregame head verbatim and
    `assert_spawn_protected` used to skip it, so a truncated row reached the countdown with its
    function intact and the guard called the head clean. Nothing here can tell which cell it would
    arm, so the only honest answer is to refuse to compile it."""
    out = []
    for row in table:
        t = row.strip().lstrip("$").rstrip("*").rstrip(",").split(",")
        if t[0] != "SIR":
            out.append(("", ""))
            continue
        if len(t) <= 2:
            raise ValueError(f"malformed $SIR row — no <proto>,<sub> cell to arm or disarm: {row!r}")
        out.append((t[1] or "0", t[2] or "0"))
    return out


def _sir_with_sound(row: str, sound: str) -> str:
    """The same `$SIR` row with its sound token replaced. Empty `sound` leaves the row untouched."""
    if not sound:
        return row
    t = row.split(",")
    if len(t) <= _SIR_SOUND_TOK:
        return row
    t[_SIR_SOUND_TOK] = sound
    return ",".join(t)


def _sir_row(cell: tuple[str, str], sound: str, fn: int, template: str | None) -> str:
    """A new `$SIR` row for `cell`. The TAIL (p5-p8) is copied from the stock row that already carries
    this function, so a re-keyed weapon lands exactly what it lands today -- damage is a property of
    the (weapon, table) pair, and re-keying must move the sound, never the effect."""
    tail = ",0,0,1,,"
    if template:
        # rstrip("*") only: the empty token before the trailing "*" is p8 and must survive, so the
        # copied row keeps the stock TOKEN COUNT. t[-1] is the artifact of that final comma.
        t = template.strip().rstrip("*").split(",")
        if len(t) > 6:
            tail = "," + ",".join(t[5:-1]) + ","
    return f"$SIR,{cell[0]},{cell[1]},{sound},{fn}{tail}*"


def assert_sir_covers_weapons(head: list[str]) -> None:
    """Every `$WEAP` cell in this head MUST have a matching `$SIR` row. Raises if one does not.

    ⚠ The F11 shape, one layer up. `$CLEAR` wiping the table made a gun ignore EVERY hit; a weapon
    keyed to a cell with no row makes a gun ignore every hit FROM THAT WEAPON, while both ends report
    healthy. A17 re-keying is the only thing that can introduce it, so the guard runs on every head."""
    cells = {c for c in _sir_cells([f for f in head if f.startswith("$SIR")]) if c != ("", "")}
    missing = []
    for f in head:
        if not f.startswith("$WEAP"):
            continue
        t = f.split(",")
        key = ((t[4] if len(t) > 4 else "") or "0", (t[5] if len(t) > 5 else "") or "0")
        if key not in cells:
            missing.append((t[1] if len(t) > 1 else "?", key))
    if missing:
        raise ValueError(
            "A17 GUARD: this head arms weapons whose $SIR cell has no row, so every hit from them is "
            "silently dropped while both guns report healthy (the F11 failure): "
            + ", ".join(f"slot {s} keys <{k[0]},{k[1]}>" for s, k in missing))


# F70/F73 (bench 2026-09-10): a grenade in hill/respawn mode broadcasts a `$HIR` on protocol 15 every
# ~5 s -- owner team in the team field, mode in the magnitude (8 hill, 6 respawn station). `$SIR,15,0`
# registered through fn 28 with ZERO player feedback (no sound, no flash, no vibration) is the row that
# lets a gun report the beacon at all without also making the player experience one every 5 s.
# S57 (2026-09-23, docs/ir-callouts.md): the same row is now what lets a gun in ANY mode report the
# IR callout bus's own dead-man `$IRTX` word (also protocol 15, magnitudes 21-28, clear of the hill/
# station magnitudes above) -- the name is kept because the row still exists to serve an objective's
# beacon wherever one is present; it now also serves every mode with no objective at all.
_OBJECTIVE_SIR_ROW = "$SIR,15,0,,28,0,0,1,,*"

# F312 (2026-09-23, a code reading, bench-gated): with friendly fire off, a fn-28 row drops a word whose
# team is the receiver's own (bench-confirmed), and a grenade's capture word and beacons carry the NEW
# owner's team, so the capturing team may never report its own capture. fn 34 is the first candidate for
# a row that registers whatever the team (bench-2026-09-24 Block 7 step 3 and step 8); its frame is the
# bench's exact one. It ships only behind `--bench-capture-row 34` until Block 7 step 8 confirms both the
# problem and that fn 34 registers without moving the capturer's pool. Keys = the `$SIR` function.
CAPTURE_ROWS: dict[int, str] = {28: _OBJECTIVE_SIR_ROW, 34: "$SIR,15,0,,34,,,,,*"}
CAPTURE_ROW_DEFAULT = 28


def check_capture_row_fn(fn: object) -> int:
    """F312: the `<15,0>` function a compiler may ship; only the bench-known frames in `CAPTURE_ROWS`."""
    if isinstance(fn, bool) or not isinstance(fn, int) or fn not in CAPTURE_ROWS:
        raise ValueError(f"capture row fn must be one of {sorted(CAPTURE_ROWS)}, not {fn!r}")
    return fn

# --------------------------------------------------------------------------- #
# F121 / A23 SPAWN PROTECTION -- the head must not ARM hit reception
# --------------------------------------------------------------------------- #
# The `$SIR` table IS the arming of hit reception (F11: a gun with no rows silently eats every hit),
# and it used to ship in the HEAD -- the lobby push, alongside the pregame team colour, minutes before
# go-live. Field 2026-09-11: "during the countdown you can take damage apparently. while team colours
# are still on headsets" and "you can get hit by shots before the gun is armed during spawn". One bug:
# the software is gated (`engine.js` books a damage fact only on `phase==='live' && spawned && alive`)
# but the GUN is not -- hit sounds, the headset flash and the firmware's own pool decrements all land,
# so a player walks to the line already hurt and MC's score says nothing happened.
#
# The fix is a two-table head: the same CELLS pregame, every function replaced by a registrar that
# moves no pool, and the REAL table written by the node behind the first spawn's `$TMP` protection.
# Cells persist across writes (only `$CLEAR` wipes the table), so re-sending the same cells with a new
# function is a swap, not an addition -- the same mechanism the F11 repair path and A17's per-life
# `sir_pool` take already rely on.
#
# WHY fn 28 and nothing else. It is the only no-pool function bench-proven to register with ZERO
# player feedback -- no sound, no headset flash, no vibration (2026-09-10 sweep; it is why the
# objective row above is what it is). The alternatives all fail on something:
#   fn 8      silent, but still FLASHES the headset -- and every registered hit wipes the headset
#             colour (bench 2026-09-03), so a shot in the lobby would strip the pregame team colour
#             that is the operator's only way to read teams, and nothing repaints it until go-live.
#   fn 23     accuracy suppression: registers, moves no pool, drops live accuracy to 0 and recovers
#             on its own (P18/A20).
#   fn 24-27  the PHANTOM HIT family: apply no damage, but the victim's gun then manufactures a fake
#             `$HIR` every 5.07 s, with sound, vibration and a headset flash, until the next `$SPAWN`
#             (P18, closed 2026-09-18 -- retracts the earlier "delayed real damage" reading). A
#             countdown hit would haunt the player into the match proper. These must never reach a
#             spawn-protection table -- `assert_spawn_protected`.
#   fn 35, 31/32/34  unswept: no idea what the player feels.
# The sound token is blanked with the function: fn 28's "no sound" was measured on a row with an empty
# `<soundID>`, and a row's own sound plays whenever the row fires (§5). A pregame hit is therefore
# fully silent by construction -- deliberately. "Registers for feedback" here means the HOST sees the
# `$HIR` (telemetry, and the node can say what it likes on the phone); it does not mean the gun should
# perform a hit the match will not count.
_SPAWN_PROTECT_FN = 28
_SPAWN_PROTECT_TAIL = "0,0,1,,"          # the tail of the bench-proven fn-28 row above, byte for byte


def sir_spawn_protected(rows) -> list[str]:
    """The pregame twin of a live `$SIR` table: same cells, same order, every row a silent fn-28
    registrar. A hit lands as a `$HIR` and moves nothing.

    Same cells is the whole point -- `assert_sir_covers_weapons` / `assert_sir_covers_objective` run on
    the head, and the spawn table can only re-arm a cell the head already carries."""
    out: list[str] = []
    for row, cell in zip(rows, _sir_cells(rows)):
        if cell == ("", ""):
            out.append(row)          # not a $SIR row: nothing to disarm
            continue
        out.append(f"$SIR,{cell[0]},{cell[1]},,{_SPAWN_PROTECT_FN},{_SPAWN_PROTECT_TAIL}*")
    return out


def assert_spawn_protected(head: list[str], name: str = "head") -> None:
    """F121: no `$SIR` row in a HEAD may move a pool. Raises naming the rows that would.

    The head is written at the lobby push and again on every relink and resync, i.e. everywhere the
    player is NOT live. A row here that damages, heals or delay-blasts is a hit the gun takes and the
    match never books. F209: the spawn and revive writes hold the same rule (`name` says which list)."""
    bad = []
    for row, cell in zip(head, _sir_cells(head)):
        if cell == ("", ""):
            continue
        fn = _sir_index([row]).get(cell)
        if fn != _SPAWN_PROTECT_FN:
            bad.append((row, fn))
    if bad:
        raise ValueError(
            f"F121 GUARD: this {name} arms hit reception before the player can fire -- a hit in that "
            "window would take real pools off a gun that cannot shoot back: "
            + ", ".join(f"{r} (fn {f})" for r, f in bad))


# F209 + F121 rebuild (bench 2026-09-18, levers §23, v4.32): SPAWN PROTECTION IS `$TMP` t8, NOT A TABLE.
# A23 put the real table ahead of `$SPAWN`, so hit reception came back before the weapon did (F209). A44 then
# wrote the fn-28 twin into every spawn and revive, and the node re-sent the real table once the gun could
# fire: 28 frames a life. The bench retired that. What it proved:
#   - `$SPAWN,,*`, then `$TMP,,,,,,,,-100,,,,*`, then `$TID`: hits register (`$HIR` and `$HP`) with 0 damage.
#   - `$TMP,,,,,,,,0,,,,*` restores damage.
#   - A `$TMP` sent BEFORE `$SPAWN` is wiped by the spawn, so t8 must FOLLOW it. `$SPAWN` zeroes every `$TMP`
#     token, so any other `$TMP` modifier must be re-sent after the spawn too (none ships today).
#   - The `$SIR` table survives `$SPAWN` and death. Only `$CLEAR` zeroes it.
#   - `$STOP` survives `$SPAWN`: whatever sends `$STOP` must send `$START` before the next life. Only the
#     probe and `END_SEQUENCE` send it, and both are followed by a head, which carries `$START`.
# So the spawn and revive writes carry no `$SIR` row at all. The node writes `spawn_protect_off` on the gun's
# first shot or `engine.js SPAWN_PROTECT_MAX_MS` after the write, and puts one `sir_pool` take IN FRONT of it
# only when the table on the gun is not the live one (after any head, `$CLEAR` or app restart) or when class
# sounds are on (A17's per-life re-roll). The head keeps the fn-28 twin: it covers the countdown, silent.
# Do not use `$INVU` for any of this: it sets the flag that later forces team 2 (levers §7).
SPAWN_PROTECT_ON = "$TMP,,,,,,,,-100,,,,*"
SPAWN_PROTECT_OFF = "$TMP,,,,,,,,0,,,,*"
_TMP_COMMAS = 12     # a `$TMP` frame always carries all twelve commas: the tokens are positional


def assert_tmp_frames_whole(frames, name: str = "bundle") -> None:
    """Every `$TMP` frame carries all twelve commas. A short frame shifts t8 onto another token."""
    bad = [f for f in frames if f.startswith("$TMP") and f.count(",") != _TMP_COMMAS]
    if bad:
        raise ValueError(f"TMP GUARD: this {name} carries a $TMP frame without its {_TMP_COMMAS} commas, so t8 "
                         "would land on another token: " + ", ".join(bad))


def assert_spawn_shielded(frames: list[str], name: str) -> None:
    """F121/F209: a spawn or revive write turns protection on in the bench-proven order, and arms no table.

    The order is `$SPAWN,,*`, then `SPAWN_PROTECT_ON`, then `$TID`, with nothing between them. A t8 write
    before `$SPAWN` is wiped by the spawn: the player would be live and unprotected with every guard green.
    A `$SIR` row here is worse. The table on the gun is already the live one after the first life, so a
    fn-28 twin here would leave the player immortal for the life, and a live row would arm before t8."""
    if frames.count("$SPAWN,,*") != 1:
        raise ValueError(f"F121 GUARD: {name} must carry exactly one $SPAWN,,*")
    i = frames.index("$SPAWN,,*")
    if frames[i + 1:i + 2] != [SPAWN_PROTECT_ON] or not frames[i + 2:i + 3] or not frames[i + 2].startswith("$TID,"):
        raise ValueError(f"F121 GUARD: {name} must write $SPAWN,,*, then {SPAWN_PROTECT_ON}, then $TID, in that "
                         f"order and back to back (a $TMP before $SPAWN is wiped by the spawn): {frames[max(0, i - 1):i + 3]}")
    if frames.count(SPAWN_PROTECT_ON) != 1 or any(f.startswith("$TMP") and f != SPAWN_PROTECT_ON for f in frames):
        raise ValueError(f"F121 GUARD: {name} carries a $TMP frame other than the one protection write")
    sir = [f for f in frames if f.startswith("$SIR")]
    if sir:
        raise ValueError(f"F121 GUARD: {name} carries $SIR rows. The table survives $SPAWN, so a row here either "
                         f"arms before protection or leaves the player immortal all life: {sir}")


def assert_arms_after_spawn(head: list[str], bundle) -> None:
    """F121/F209: the spawn and revive writes turn protection on, `spawn_protect_off` turns it off, and every
    cell the head disarmed is re-armed by every `sir_pool` take. Raises if any of that fails.

    A cell left on fn 28 for a whole life is F11 wearing a different hat: the gun registers every hit
    from that weapon and takes nothing off, so both ends report healthy while one player is immortal."""
    for name in ("spawn", "revive"):
        assert_spawn_shielded(list(bundle.get(name) or []), name)
    if bundle.get("spawn_protect_off") != SPAWN_PROTECT_OFF:
        raise ValueError("F121 GUARD: the bundle has no spawn_protect_off frame, so every protected life would "
                         f"stay at 0 damage until the next $SPAWN (want {SPAWN_PROTECT_OFF})")
    pool = [list(t) for t in (bundle.get("sir_pool") or []) if t]
    if not pool:
        raise ValueError("F121 GUARD: no sir_pool take re-arms the $SIR table after the head -- every "
                         "player would register every hit and take nothing off it")
    head_cells = [c for c in _sir_cells([f for f in head if f.startswith("$SIR")]) if c != ("", "")]
    for take in pool:
        live = _sir_index(take)
        # the <15,0> capture row is exempt: the head's fn-28 twin is its shipped value, and the F312 guard
        # in compile() checks every take carries the compiler's own capture row, whatever its function
        missing = [c for c in head_cells if c != ("15", "0") and live.get(c) in (None, _SPAWN_PROTECT_FN)]
        if missing:
            raise ValueError(
                "F121 GUARD: a sir_pool take does not re-arm every cell the head disarmed, so these "
                "weapons would take nothing off this player all life: "
                + ", ".join(f"<{c[0]},{c[1]}>" for c in missing))


# Bench 2026-09-16: a gun could fire during the ARMED countdown. The lobby head carried the full
# seven-row button map, and its trigger row `$BMAP,0,0` maps the trigger to fire. The head now holds
# the trigger on function 98, the no-op function the captured table gives select/left/right. The T-0
# spawn write and every revive map it back to fire AFTER `$SPAWN`, as Callsign does.
# UNVERIFIED on hardware: no capture shows 98 on the trigger. The evidence is only that buttons 3-5 on
# 98 fire nothing, and that a gun with no trigger row "chirps disabled". A row that holds the trigger
# (not an absent one) also overrides a map left by a try-out, whatever `$CLEAR` resets.
TRIGGER_HELD = "$BMAP,0,98,,,,,*"
TRIGGER_LIVE = "$BMAP,0,0,,,,,*"


def hold_trigger(bmap) -> list[str]:
    """The head's button map with the trigger row swapped for the held row."""
    return [TRIGGER_HELD if row.startswith("$BMAP,0,") else row for row in bmap]


def assert_trigger_held_until_spawn(head: list[str], spawn: list[str], revive: list[str]) -> None:
    """Bench 2026-09-16: no head may map the trigger to fire, and spawn and revive must map it after
    `$SPAWN`. A revive needs it too: `engine.js _resyncNotLive` re-writes the head on a live node and
    then revives. Raises ValueError naming the frame list that is wrong."""
    if any(f.startswith("$BMAP,0,") and f != TRIGGER_HELD for f in head):
        raise ValueError("TRIGGER GUARD: the head maps the trigger, so a player can fire during the "
                         f"countdown. The head's trigger row must be {TRIGGER_HELD}")
    for name, frames in (("spawn", spawn), ("revive", revive)):
        if "$SPAWN,,*" not in frames or TRIGGER_LIVE not in frames[frames.index("$SPAWN,,*") + 1:]:
            raise ValueError(f"TRIGGER GUARD: {name} does not map the trigger ({TRIGGER_LIVE}) after "
                             "$SPAWN, so the player goes live and cannot fire")


# Respawn profiles (Tony, 2026-09-19; docs/spec/contracts.md §3). Field problem: a protected player's headset
# flashed "hit" and took no damage, so shooters thought the game was broken, and the respawner could fire while
# protected. So a TIMED respawn (in place: `respawn.type` "auto", an operator respawn) now writes
# NO `$TMP` by default and holds the trigger (`TRIGGER_HELD`) until the node writes `trigger_live`. A STATION
# respawn keeps protection (default 2 s), maps the trigger at once, and lights a shield on the headset so the
# shooters can see why their hits do nothing. Neither profile ends protection on the first shot. The T-0 spawn is
# neither (Tony, field 2026-09-19: at match start everyone is equal): no t8 and the trigger live at go-live, with
# the live table already on the gun (the node writes it at T-3, while the head still holds every trigger).
# These lists live in `respawn_profile`; the legacy `spawn`/`revive` lists stay as they were for an app < 0.4.3.
TIMED_PROTECT_S_OPTIONS = get_args(TimedProtectS)
WEAPON_DELAY_MS_OPTIONS = get_args(WeaponDelayMs)
STATION_PROTECT_S_OPTIONS = get_args(StationProtectS)
_SHIELD_COLOUR = 6        # white: the native hit flash is the SMALL green LED, so a white big-LED blink reads apart
_SHIELD_BLINK_MS = 150    # on and off; the blink form `$HLED,<c>,2,<on>,<off>,<b>,<count>` is bench-proven in game


def respawn_settings(respawn) -> tuple[int, int, int]:
    """`config.respawn` -> (timed protect ms, timed trigger ms, station protect ms). Absent keys take the
    defaults. Raises ValueError on a value outside the options. The timed trigger never goes live while the
    player is protected: with protection on, it waits TRIGGER_AFTER_PROTECT_MS past the end of it."""
    r = respawn or {}
    protect_s = r.get("protect_s", TIMED_PROTECT_S_DEFAULT)
    delay_ms = r.get("weapon_delay_ms", WEAPON_DELAY_MS_DEFAULT)
    station_s = r.get("station_protect_s", STATION_PROTECT_S_DEFAULT)
    for name, v, ok in (("protect_s", protect_s, TIMED_PROTECT_S_OPTIONS),
                        ("weapon_delay_ms", delay_ms, WEAPON_DELAY_MS_OPTIONS),
                        ("station_protect_s", station_s, STATION_PROTECT_S_OPTIONS)):
        if isinstance(v, bool) or v not in ok:
            raise ValueError(f"respawn.{name} must be one of {', '.join(str(o) for o in ok)}")
    protect_ms = int(protect_s) * 1000
    trigger_ms = max(int(delay_ms), protect_ms + TRIGGER_AFTER_PROTECT_MS if protect_ms else 0)
    return protect_ms, trigger_ms, int(station_s) * 1000


def shield_frame(ms: int, night: bool) -> str:
    """The station-respawn shield: a white blink on the headset for `ms`. The count covers the window; the node
    writes `shield_off` when protection ends, because a count-limited blink ending dark is not verified."""
    count = max(1, math.ceil(ms / (2 * _SHIELD_BLINK_MS)))
    return f"$HLED,{_SHIELD_COLOUR},2,{_SHIELD_BLINK_MS},{_SHIELD_BLINK_MS},{pg.BRIGHT_DIM if night else pg.BRIGHT_FULL},{count},*"


def life_frames(team: int, ammo: list[str], hled: list[str], protect: bool, trigger_live: bool,
                shield: str = "", lead: list[str] | None = None, trigger_lead: bool = False) -> list[str]:
    """One spawn or revive write in the bench-proven order: `$SPAWN`, then t8 (only when protected), then
    `$TID`, the loadout `$AMMO`, the trigger row, the headset team repaint, and the shield last.

    `trigger_lead` (review finding, 2026-09-19): a TIMED revive holds the trigger BEFORE `$SPAWN` instead
    of after it. Without this the previous life's `trigger_live` mapping (`$BMAP,0,0`) stays live across
    the gap between `$SPAWN` landing and the trigger row after it, so the respawning player could fire
    during their own spawn frames. Only ever used with `trigger_live=False` (holding, not mapping)."""
    trigger = TRIGGER_LIVE if trigger_live else TRIGGER_HELD
    return ([*(lead or []), *([trigger] if trigger_lead else []), "$SPAWN,,*"]
            + ([SPAWN_PROTECT_ON] if protect else []) + [f"$TID,{team},*"] + list(ammo)
            + ([] if trigger_lead else [trigger]) + list(hled) + ([shield] if shield else []))


def assert_respawn_profile(rp) -> None:
    """2026-09-19 guard: the T-0 spawn maps the trigger and carries no t8 (everyone is equal at go-live); a timed
    list holds the trigger BEFORE $SPAWN (so the previous life's live trigger cannot fire during the spawn
    frames) and carries t8 only when timed protection is on; a station list maps the trigger and carries t8
    only when station protection is on. Every list keeps the
    F121 order ($SPAWN, [t8], $TID) and carries no `$SIR` row. Raises ValueError naming the list."""
    timed = [("revive", rp["revive"])] + [(f"team_flip[{k}]", v) for k, v in (rp.get("team_flip") or {}).items()]
    for name, frames, protect, live in ([("spawn", rp["spawn"], False, True)]
                                        + [(n, f, rp["protect_ms"] > 0, False) for n, f in timed]
                                        + [("revive_station", rp["revive_station"], rp["station_protect_ms"] > 0, True)]):
        if frames.count("$SPAWN,,*") != 1:
            raise ValueError(f"RESPAWN GUARD: respawn_profile.{name} must carry exactly one $SPAWN,,*")
        idx = frames.index("$SPAWN,,*")
        before, after = frames[:idx], frames[idx + 1:]
        want = [SPAWN_PROTECT_ON] if protect else []
        if after[:len(want)] != want or not after[len(want):len(want) + 1] or not after[len(want)].startswith("$TID,"):
            raise ValueError(f"RESPAWN GUARD: respawn_profile.{name} must write $SPAWN,,*, then "
                             f"{'the t8 write, then ' if protect else ''}$TID, back to back: {after[:3]}")
        if frames.count(SPAWN_PROTECT_ON) != len(want) or any(f.startswith("$TMP") and f != SPAWN_PROTECT_ON for f in frames):
            raise ValueError(f"RESPAWN GUARD: respawn_profile.{name} carries a $TMP it should not")
        if any(f.startswith("$SIR") for f in frames):
            raise ValueError(f"RESPAWN GUARD: respawn_profile.{name} carries $SIR rows")
        if live:
            if TRIGGER_LIVE not in after or TRIGGER_HELD in frames:
                raise ValueError(f"RESPAWN GUARD: respawn_profile.{name} must map the trigger "
                                 f"({TRIGGER_LIVE}) after $SPAWN")
        elif TRIGGER_HELD not in before or TRIGGER_LIVE in frames:
            raise ValueError(f"RESPAWN GUARD: respawn_profile.{name} must hold the trigger "
                             f"({TRIGGER_HELD}) before $SPAWN")
    if rp["trigger_live"] != TRIGGER_LIVE:
        raise ValueError(f"RESPAWN GUARD: respawn_profile.trigger_live must be {TRIGGER_LIVE}")
    if rp["protect_ms"] and rp["trigger_ms"] < rp["protect_ms"] + TRIGGER_AFTER_PROTECT_MS:
        raise ValueError("RESPAWN GUARD: a timed respawn would map the trigger while the player is still protected")


def _bundle_frames(value) -> list[str]:
    """Every `$…` string anywhere in a bundle (lists, dicts, nested), for whole-bundle guards."""
    if isinstance(value, str):
        return [value] if value.startswith("$") else []
    if isinstance(value, dict):
        return [f for v in value.values() for f in _bundle_frames(v)]
    if isinstance(value, (list, tuple)):
        return [f for v in value for f in _bundle_frames(v)]
    return []


def assert_no_denied_frames(bundle) -> None:
    """No frame anywhere in a bundle may carry a command from `protocol.DENIED_COMMANDS`.

    The node refuses these at its write path (`engine._write`, the stage's `write`), so a bundle that
    carried one would fail SILENTLY on the phone: the frame dropped, the rest of the burst written, and
    a log line nobody reads mid-match. Refuse it here, at compile time, where an operator sees it.
    docs/spec/transport-hardening.md §4."""
    from ..protocol import deny_reason
    for f in _bundle_frames(bundle):
        why = deny_reason(f)
        if why:
            raise ValueError(f"DENY-LIST GUARD: a compiled bundle carries a frame the node must never write "
                             f"({why}). Frame: {f}")


def assert_rearms_every_life(bundle) -> None:
    """F121/F209: every life is protected the same way, and a table exists to re-arm it. Raises if not.

    The node writes a `sir_pool` take whenever the table on the gun may not be the live one: `engine.js
    _resyncNotLive` re-writes the HEAD (fn 28 throughout) on a live node and then revives. An infection flip
    is a revive too, so its burst must hold the same order."""
    head = list(bundle.get("head") or [])
    assert_arms_after_spawn(head, bundle)
    for tid, frames in (bundle.get("team_flip") or {}).items():
        assert_spawn_shielded(list(frames), f"team_flip[{tid}]")
    assert_tmp_frames_whole(_bundle_frames(bundle))
# F15 / A20: the host-driven STUN (EMP). The proven chain: a proto-8 IR word -> the victim's `$SIR,8,0,,24` row
# (fn 24 = a STATUS function: `$HIR` fires, pools do not move, the gun plays fn 24's own clip) -> the NODE writes
# `$AMMO,<slot>,0,0,1,*` for its live slots and restores the LIVE counts when `config.stun.duration_s` runs out
# (`engine.js _stun`). The native stun is not relied on (2/5 singles, lasts until death). The cell is the stock
# `<8,0>` row -- the CHARGE RIFLE's plain damage (fn 1 since F225, 2026-09-17; fn 38 before that
# HALVED every hit, the bug F225 fixed) -- so with stun ON, a charge rifle IS the EMP source: it
# stuns and deals no damage (the row's function is the only thing that changes; the sound token is carried over,
# never rewritten -- F43). The other source is a proto-8 station. Shipped ONLY when `config.stun` is present;
# a game without it keeps the stock row byte-for-byte.
# ⚠️ F253, FIXED 2026-09-18 on the bench: this cell shipped fn 24 and that was a real bug. fn 24 does no
# damage AND leaves the victim's gun manufacturing a fake `$HIR` every 5.07 s until the next `$SPAWN`, with
# sound, vibration and a headset flash, so every stunned player would have been told they were being shot by
# nobody for the rest of the life. **fn 23 is the stun primitive**, measured the same session: the victim's
# live accuracy goes 100 -> 0 in the same millisecond as the `$HIR`, no pool moves, the gun keeps firing but
# every shot MISSES (the person being shot at hears the near-miss whizz-bys, Tony by ear), and it recovers by
# itself, 0 -> 2 -> 4 -> 7 -> 12 over a few seconds, leaving nothing behind. So the wire now does half the
# stun's work on its own and the node's disarm rides on top of a real effect rather than a silent one.
_STUN_SIR_ROW = "$SIR,8,0,,23,0,0,1,,*"
_STUN_CELL = ("8", "0")
_STUN_DEFAULT_S = 10
_STUN_MAX_S = 60


def stun_enabled(config) -> bool:
    """`config.stun` present (an object; `{}` = the 10 s default) = the EMP cell is a stun this game."""
    return isinstance(config.get("stun"), dict)


def _with_stun_row(rows: list[str]) -> list[str]:
    """The table with the `<8,0>` cell's function swapped to fn 23 (P18/F253), in place (stock order kept, sound token
    carried over so a class-layer draw survives); appended if the table had no such cell."""
    out: list[str] = []
    done = False
    for row in rows:
        cell = _sir_cells([row])
        if cell and cell[0] == _STUN_CELL and not done:
            out.append(_sir_with_sound(_STUN_SIR_ROW, row.split(",")[_SIR_SOUND_TOK]))
            done = True
        else:
            out.append(row)
    if not done:
        out.append(_STUN_SIR_ROW)
    return out
# Modes whose objective IS this grenade beacon -- defined in `.types` beside the GameConfig shape,
# because `state.py`'s PUT validator and `scoring.py` read the same set (keep the local alias: it is
# what every guard in this file reads).
_OBJECTIVE_MODES = OBJECTIVE_MODES
# F97: the teams a hill mode can actually field -- every valid tid except the one a NEUTRAL hill broadcasts.
_HILL_TIDS = frozenset(t for t in pg.TEAM_TIDS if t != _NEUTRAL_TEAM)

# Every mode that cannot run without something on the field emitting its objective (modes §7).
# `extraction` is deliberately absent: its objective runs MC-side off gun events, no emitter.
_STATION_GATED_MODES = {"domination", "koth", "ctf", "cs", "bomb"}

# `STATION_SOURCES` (imported from `.types`) is the objective-source vocabulary: it is part of the
# GameConfig shape, so it lives beside it and both this module's `validate()` and `state.py`'s PUT
# validator read the one table.


# ---------------------------------------------------------------------------------------------------
# A31 (2026-09-12): THE "VERIFY AT MC" PRE-GAME WARNING.
# ---------------------------------------------------------------------------------------------------
# Written ONCE, here, and read by both audiences (`assign.game.mc_verify` for the phone's ARMED screen,
# `State.notices.mc_verify` for the host's LOBBY/ARMED banner), so MC and the phones cannot disagree
# about whether this match needs the warning at all.
MC_VERIFY_PLAYER = "A WIN IS CONFIRMED AT MISSION CONTROL · RETURN AFTER THE WHISTLE"


def full_coverage(config: GameConfig | None = None, opts: dict | None = None) -> bool:
    """Is the VENUE asserted to cover every phone for the whole match? (A4.8, A31.)

    THE coverage model, and the only reader of either field: `opts.coverage` is the per-call CLI/sim
    path and wins; `config.coverage` is the MC operator's venue setting (`state.py` `_CONFIG_KEYS`).
    Anything other than "full" — including absent, which is the default — is partial coverage, because
    a venue nobody has asserted is one MC cannot promise to hear.
    """
    o = opts or {}
    # A28 (backhaul) asserts the venue as `opts.venue_coverage`; A31 as `opts.coverage`; the operator as `config.coverage`.
    return (o.get("venue_coverage") or o.get("coverage") or (config or {}).get("coverage")) == "full"


def mc_decided_end(config: GameConfig) -> bool:
    """Does MISSION CONTROL decide when this game is over, rather than the clock on every phone?

    Three shapes (A31): a frag cap (MC counts the kills and calls it), an objective `win_by` (possession
    is merged from the nodes' reports at MC), and a survival mode, where "last player standing" is a
    fact about the whole field. A plain timed kills match is NOT one of these — every phone ends itself
    on `go_live_t + time_limit_s` and needs nothing from MC to know the match is over.
    """
    sc = config.get("scoring") or {}
    if sc.get("frag_limit"):
        return True
    if sc.get("win_by") not in (None, "", "kills"):
        return True
    return config.get("mode") in ("lms", "infection")


def mc_verify(config: GameConfig, opts: dict | None = None, off_grid: bool = False) -> str | None:
    """The player-facing line, or None when this match does not need it (A31).

    Three conditions, all required: MC decides the end, the venue is not full coverage, and at least
    one rostered phone has no backhaul (the caller's `off_grid` — `state.py` `_off_grid()`). Under full
    coverage every phone hears the END; with backhaul everywhere every phone hears the RESULT; either
    way the warning would be a lie about a match that tells players itself.
    """
    if not off_grid or not mc_decided_end(config) or full_coverage(config, opts):
        return None
    return MC_VERIFY_PLAYER


def station_source_of(config: GameConfig, opts: dict | None = None) -> str | None:
    """Where this game's objective comes from: `opts` wins (the CLI/sim path passes it per call),
    else the GameConfig field the MC operator sets (`state.py` `_CONFIG_KEYS`)."""
    return (opts or {}).get("station_source") or config.get("station_source")


def assert_sir_covers_objective(head: list[str], mode: str) -> None:
    """F79: `assert_sir_covers_weapons` only knows about `$WEAP` cells -- it has no concept of a
    non-weapon cell, so a head for an objective/hill mode with no `$SIR,15,0` row sailed straight
    through it. That is the exact condition that made a real gun discard every hill beacon in
    silence (F60/F70/F72): no `$HIR`, no way for the node to ever see the point, while both ends
    report healthy. Raises for any `_OBJECTIVE_MODES` config shipping no protocol-15 cell."""
    if mode not in _OBJECTIVE_MODES:
        return
    cells = {c for c in _sir_cells([f for f in head if f.startswith("$SIR")]) if c != ("", "")}
    if ("15", "0") not in cells:
        raise ValueError(
            f"F79 GUARD: mode {mode!r} declares an objective but this head ships no $SIR,15,0 row, "
            "so a hill/station beacon is silently discarded while both ends report healthy")


# $WEAP full-frame token indices (0-based over the comma-split of "$WEAP,<slot>,<tail>"),
# protocol-classes §WEAP: 5=primaryDamage, 15=rateOfFire, 16=maxClip, 18=reloadSpeed(ms),
# 39=clipStartingAmmo, 40=ammoReserv, 41=gunRange%.
_W_MAG, _W_RELOAD, _W_CLIPSTART, _W_RESERVE = 17, 19, 40, 41   # doc tokN == split()[N+1]; the old values wrote MAG into the RoF token (found 2026-08-26)

# Kill-line id per voice family (§5/§5b). VA (male) + V3A (heavy "kill") are hardware-confirmed;
# the rest are the family's kill slot, best-effort until pinned.
# Kill lines LISTED in protocol/callsign-extract/sound-bank.md's pack examples. ⚠ Not confirmed by
# ear — that file's only 'heard' annotations are V3I, H29, VA8C and VA16. Unlike the six $PSET
# voice slots these do NOT share a suffix across families (A, S, A, A, R, A), so they are listed
# rather than derived — a family with no confirmed line falls back to its own "<fam>A", which is
# the majority pattern, and finally to VAA.
_KILL_LINE_DOCUMENTED = {"heavy": "V3A", "medic": "V8S", "male": "VAA", "scout": "VBA",
                        "valkyrie": "VHR", "clean_male": "VEA"}


def kill_line(voice: str | None) -> str:
    from ..gameconfig import VOICE_PACKS
    v = (voice or "male").lower()
    if v in _KILL_LINE_DOCUMENTED:
        return _KILL_LINE_DOCUMENTED[v]
    fam = VOICE_PACKS.get(v)
    return f"{fam}A" if fam else "VAA"
_CONFIRMED_CUES = {"countdown", "kill"}   # everything else in cues() is provisional (real bank ids)

_HERE = pathlib.Path(__file__).resolve().parent


def _load_weapons() -> list[dict]:
    data = json.loads((_HERE / "weapons.json").read_text())
    return data["weapons"]


# 2026-09-17 (Tony, following F225/F226/S43): the ambush identity of a cell weapon (Charge Rifle) is a
# pre-built charge held behind cover -- the charge time (`t14`, and by feel longer still, see
# weapon-design.md §2.2) is SETUP, not combat time, so it does not belong in `ttk_ms`. What a target
# actually experiences is RELEASE (the charge lands the instant the trigger releases, zero delay, same
# "first shot free" convention as every other weapon) plus however many taps close the rest of the
# pool. MEASURED on hardware 2026-09-18 (was a 500 ms placeholder): a full charge released, then five
# taps as fast as the operator could pull, gave 285, 270, 300, 285 ms press to press on the shooter
# and 300, 270, 300, 330 ms on the victim. 285 ms was the shooter-side mean of that bench run. The
# same run confirmed the rest of the model: the release costs exactly 10 rounds, each tap costs 1,
# the charge lands t5 (85 then) and every tap lands t37 (20). Module-level so `views.py` can redo the
# same release-to-kill maths `WeaponCatalog.time_to_kill()` does, at whatever pool the host has set.
#
# 2026-09-23 (Tony, F291): briefly raised 285 -> 350 as an attempted fix for the recoil duel sim's rule 2
# (an AR that catches an uncharged CR should beat it), then REVERTED the same day. This constant is the
# player's own physical trigger-pull rate: no `$WEAP` token encodes it and the gun does not read or
# enforce it at all, so moving it changes nothing the gun does -- only what this module's htk/ttk_ms
# arithmetic assumes a human can do. Rule 2 is fixed on the wire instead, by pricing the Charge Rifle's
# tap DAMAGE down (`wire.tap_dmg`, t37, a real gun-enforced token) rather than pretending the player taps
# slower. 285 ms remains the only hardware-measured figure this constant has ever had.
CHARGE_TAP_CADENCE_MS = 285


class WeaponCatalog:
    """§3 roster. `resolve(id, slot)` → "$WEAP,<slot>,<tail>"; `spawn_ammo(id)` → (mag, reserve)."""

    def __init__(self, rows: list[dict] | None = None) -> None:
        self._rows = rows if rows is not None else _load_weapons()
        self._by_id = {w["weapon_id"]: w for w in self._rows}

    def _to_weapon(self, w: dict) -> Weapon:
        """One raw `weapons.json` row -> contracts §3 `Weapon` shape, hidden or not. `all()` is this
        applied to every VISIBLE row; a caller that needs a hidden row's `Weapon` shape too (e.g. a
        test proving `weapon_view()` still forwards `caution` off a row the picker no longer offers)
        calls this directly via `catalog._row(weapon_id)`."""
        row: Weapon = {
            "weapon_id": w["weapon_id"], "name": w["name"], "cls": str(w["cls"]),
            "weapon_class": w.get("class", "ballistic"),   # weapons.json `class`: ballistic|energy|melee (A10, 2026-09-17)
            "desc": w.get("desc", ""),
            "tags": list(w.get("tags") or []), "role": w.get("role", ""),   # A10 policy vocabulary
            "stats": {"mag": w["mag"], "reserve": w["reserve"], "reload_ms": w["reload_ms"],
                      "dmg": w["dmg"], "rof": w["rof"], "rng": w["rng"],
                      "htk": w.get("htk"), "ttk_ms": w.get("ttk_ms"),   # A10: HITS TO KILL replaces the flat RANGE bar in the UIs
                      # the pool-INDEPENDENT chain the views re-derive htk/ttk from when the host
                      # changes `health` (W2, docs/weapon-design.md §2.5). `dmg` above is a share
                      # of the 115 default and cannot be rescaled; `dmg_hit` is the real magnitude:
                      # `damage_per_pull()` (t5 plus a declared `wire.headset_dmg`), not `damage()`
                      # (t5 alone), or the client's own htk/ttk re-derivation (`views.weapon_view()`)
                      # would disagree with the server's (2026-09-18: a Shotgun view derived htk 6
                      # from a t5-only dmg_hit of 20, against the server's own htk 3 off 40).
                      "dmg_hit": self.damage_per_pull(w["weapon_id"]),
                      "cycle_ms": self.cycle_ms(w["weapon_id"]),
                      "charged": self._frame_int(w["weapon_id"], "mode") in self._CHARGE_MODES,
                      # 2026-09-17 (F225/F226/S43): a CELL weapon (rounds_per_charge > 1) with a tap
                      # magnitude counts trigger ACTIONS, not equal-sized hits -- `views.weapon_view()`
                      # needs both numbers to redo the same htk/ttk_ms maths at a host-chosen pool the
                      # way it already redoes the plain ceil(pool/dmg) maths for every other weapon.
                      "tap_dmg": self.tap_damage(w["weapon_id"]) or None},
            "weap_frame": self.resolve(w["weapon_id"], 0),
            "verified": bool(w.get("verified", False)),
            "dual_emitter": bool((w.get("wire") or {}).get("headset_dmg")),
        }
        # A48: what one full charge costs the cell. The node reads it, and after F248 the HUD picks the
        # ammo gauge from it, so send the RESOLVED number rather than the raw field: `weapons.json` writes
        # the key only where it is not 1 (`_note`: "Absent = 1"), and the node must never have to know
        # that rule. `rounds_per_charge()` is the one place the default lives.
        row["rounds_per_charge"] = self.rounds_per_charge(w["weapon_id"])
        if w.get("caution"):    # A10: known live problem, human copy
            row["caution"] = w["caution"]
        if w.get("pickup_only"):   # 2026-09-17: catalogue-visible, never in a loadout pool (policy.py)
            row["pickup_only"] = True
        if w.get("recoil"):     # S42 (2026-09-17): the declared target profile -- weapons.json `_note`
            row["recoil"] = w["recoil"]
        if w.get("lethal") is False:   # 2026-09-18, weapon-design.md §7.4: cannot kill (stripper, smoke).
            # `policy.pool()`'s `_support_ids` reads this off the SAME `Weapon` view it is handed, so
            # dropping it here would leave the primary-slot exclusion dead: `loadout_pool()` calls
            # `weapon_catalog()`, which routes through THIS method, not the raw catalogue row.
            row["lethal"] = False
        if w.get("crit_pct") is not None:   # F62 (2026-09-18): the declared t6 crit chance, 0-100.
            row["crit_pct"] = int(w["crit_pct"])
        if w.get("min_app"):
            # A victim-side mechanic is a field compatibility requirement, so it travels with the
            # catalog row that declares the mechanic rather than in a second hand-maintained map.
            row["min_app"] = str(w["min_app"])
        return row

    def all(self) -> list[Weapon]:
        """Visible catalog (hidden weapons excluded: melee always, plus the 2026-09-17 arsenal cuts --
        force_rifle/bolt_rifle/stinger/plasma_sniper/laser_cannon/ion_sniper/energy_launcher/glock),
        as contracts §3 Weapon shape."""
        return [self._to_weapon(w) for w in self._rows if not w.get("hidden")]

    def app_requirements(self) -> list[dict]:
        """Raw feature floors, including hidden weapons kept in saved/custom rosters."""
        return [w for w in self._rows if w.get("min_app")]

    def _row(self, weapon_id: str) -> dict:
        if weapon_id not in self._by_id:
            raise KeyError(f"unknown weapon_id {weapon_id!r}")
        return self._by_id[weapon_id]

    # doc token positions (protocol-classes.md, cross-checked against 19 captured frames by
    # `python -m brx_mcp.weapmap`). doc tokN == frame.split(",")[N+1] — `put()` adds the +1.
    # idx15 (tok14) is the FIRE INTERVAL — bench-proven 2026-08-26. tok15 is the WEAPON-SWAP DELAY (ms) —
    # bench-proven 2026-09-04 (850 → 1700 doubled the swap, 425 halved it, 100 ran at 100; linear, no floor).
    # The gun applies the LARGER of the two loaded slots' values whichever direction you swap, so a swap
    # perk must scale every slot (docs/spec/loadout.md §1.2, `switch_mult`).
    # acc_ceiling/acc_floor (t21/t22, docs/weapon-design.md §4.4): named here so a test can locate them,
    # but `resolve()` never writes either -- every weapon ships t21==t22==100 (native walk off, F230),
    # and S42's `recoil` catalogue field only ever reaches the wire through `app/src/engine.js`, which
    # pins both to the live accuracy value on every write. See `weapons.json` `_note` (S42).
    # "range_outdoor" (t2, `gunRangeOutdoor`) is the confirmed venue lever (F231/F234, 2026-09-17
    # garden test). It sets the emitter's carrier frequency, not its power (2026-09-18 V4_31
    # disassembly): a low value detunes the word out of the receiver's band-pass near 38 kHz, it does
    # not shorten the beam. "range_indoor" (t41, `gunRangeIndoor`) is kept only so a test can pin
    # it untouched -- do NOT write it from `gun_range_outdoor_pct` or any venue map; see the F234
    # comment block above `RANGE_OUTDOOR_FLOOR`.
    _T = {"proto": 3, "subtype": 4, "dmg": 5, "crit": 6, "headset_dmg": 12, "headset_range_outdoor": 13,
          "fire": 14, "swap": 15, "mag": 16,
          "reserve": 17, "reload": 18, "mode": 20, "acc_ceiling": 21, "acc_floor": 22, "burst": 23,
          "heat": 24, "snd_fire": 27, "snd_up": 28, "snd_down": 29, "rel1": 31, "rel2": 32, "rel3": 33,
          "noammo": 34, "tap": 37, "clipstart": 39, "reserve_half": 40, "range_indoor": 41,
          "range_outdoor": 2, "headset_range_indoor": 42}
    # The ammo trio + its two mirrors. `resolve()` owns these — they carry the invariants — so an
    # `overrides` entry may not name one (see `_override_index`).
    _AMMO_TOKENS = frozenset({16, 17, 18, 39, 40})
    # Doc-token positions that protocol-classes.md gives a NAME to. `overrides` may only name one of
    # these — the hard rule is "never write a token we cannot name", and an override is still a write.
    _NAMED = frozenset({0, 1, 2, 3, 4, 5, 6, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
                        27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42})

    # Legacy 4-sample tails, kept only for rows with no `capture` block (synthetic catalogs in tests).
    SAMPLES = {"ar": WEAPON_TAILS.get("ar", WEAPON_TAILS["primary"]),
               "charge": WEAPON_TAILS.get("charge", WEAPON_TAILS["primary"])}

    def swap_ms(self, weapon_id: str, mods: dict | None = None) -> int:
        """tok15 as it will be written: the weapon's captured swap delay (850 on every stock gun, 100 on
        melee) scaled by a `switch_mult` perk. Bench 2026-09-04: the gun honours it linearly with no floor."""
        w = self._by_id[weapon_id]
        frame = (w.get("capture") or {}).get("frame")
        base = 850
        if (w.get("wire") or {}).get("swap_ms") is not None:          # a per-weapon draw time (sidearms); NB the gun enforces
            base = int(w["wire"]["swap_ms"])                          # the LARGER of slots 0/1, so it only bites when both are quick
        elif frame:
            tok = frame.split(",")
            if len(tok) > 16 and tok[16].strip().isdigit():
                base = int(tok[16])
        sm = float((mods or {}).get("switch_mult") or 1)
        return max(0, int(round(base * sm)))

    @staticmethod
    def _is_pistol(w: dict) -> bool:
        """D5 (2026-09-25, docs/perk-design.md §2): a pistol-class weapon -- role `sidearm` or the
        `pistol` tag (today the same three rows, usp/deagle/glock, but a future row need only carry
        one of the two to qualify). The one place `_ammo` asks whether extended_mags' cheaper
        `ammo_mult_pistol` applies instead of the plain `ammo_mult`."""
        return w.get("role") == "sidearm" or "pistol" in (w.get("tags") or [])

    @staticmethod
    def _mods(mods: dict | None, mag: int, reserve: int, reload_ms: int, *, floor: bool = False) -> tuple[int, int, int]:
        """Apply passive-perk knobs (loadout.md §2): `ammo_mult` scales mag + reserve, `reload_mult`
        scales reload_ms. Integers, never below 1 round / 0 ms.

        `floor` (D5, 2026-09-25): the pistol-class `ammo_mult_pistol` substitution rounds mag/reserve
        DOWN, never to the nearest -- Tony's rule for the +50% pistol case, deliberately not the
        round-to-nearest every other `ammo_mult` use keeps (`_ammo` sets it only for that
        substitution)."""
        if not mods:
            return mag, reserve, reload_ms
        am = float(mods.get("ammo_mult") or 1)
        rm = float(mods.get("reload_mult") or 1)
        rnd = (lambda v: int(v)) if floor else (lambda v: int(round(v)))
        return (max(1, rnd(mag * am)), rnd(reserve * am),
                max(0, int(round(reload_ms * rm))))

    def _ammo(self, weapon_id: str, mods: dict | None) -> tuple[int, int, int]:
        """(mag, reserve, reload_ms) as they will ACTUALLY be written for this weapon.

        The single answer `resolve()` and `spawn_ammo()` both take, so the frame the gun gets and the
        number the phone's HUD is told can never disagree — an `ammo_mult` perk used to produce an
        odd reserve that `resolve()` floored onto the `tok17 == 2 * tok40` invariant while
        `spawn_ammo()` reported the odd value, i.e. a gun one round short of what the HUD claimed.

        The rounding follows the INVARIANT, not the code path: only a captured frame carries the
        tok40 mirror, so a legacy-template row (synthetic test catalogs, no `capture`) writes its
        reserve straight to tok41 and must keep an odd one intact (review 2026-09-01).

        D5 (2026-09-25): a perk's `ammo_mult_pistol` (extended_mags' only user today) replaces
        `ammo_mult` when this weapon is a pistol (`_is_pistol`), rounded down. This is the ONE place
        that substitution happens, so `resolve()`, `spawn_ammo()` and `perk_effects_resolved()` (every
        caller of `_ammo`) apply it identically; nothing downstream re-derives it.
        """
        w = self._row(weapon_id)
        pistol_mult = mods.get("ammo_mult_pistol") if mods and self._is_pistol(w) else None
        eff_mods = {**mods, "ammo_mult": pistol_mult} if pistol_mult and mods else mods
        mag, reserve, reload_ms = self._mods(eff_mods, int(w["mag"]), int(w["reserve"]), int(w["reload_ms"]),
                                              floor=bool(pistol_mult))
        if (w.get("capture") or {}).get("frame"):
            reserve = (reserve // 2) * 2
        return mag, reserve, reload_ms

    def resolve(self, weapon_id: str, slot: int, mods: dict | None = None,
                environment: str | None = None) -> str:
        """`$WEAP` frame for a slot, built from the weapon's OWN captured Callsign frame.

        Every weapon carries `capture.frame` — the real frame Battle Company sent for that gun, pulled
        out of `protocol/captures/raw/` (see `weapons.json._note`). Emitting it verbatim inherits every
        native behaviour we cannot synthesise from a template: the 3-round burst (tok23), bolt/single
        shot, charge, overheat (tok24/35), the per-weapon reload chain, damage type (tok3), reload type
        (tok19) and muzzle flash (tok25/26). On top of that we write ONLY the balance tokens — damage,
        fire interval, the ammo/reload trio, and t2 (range, via `gun_range_outdoor_pct` — F234) —
        preserving the two invariants every captured frame obeys: `tok39 == tok16` (clip start == max
        clip) and `tok17 == 2 * tok40`. **t41 is never written here** — it is left exactly as the
        capture carries it, because indoor range is unmeasured (F231 open) and t41 itself was proven
        inert outdoors (Q15, 2026-09-17); see the F234 comment above `RANGE_OUTDOOR_FLOOR`. t12
        (`ExtraHeadsetDamage`) is MEASURED (2026-09-18, Callsign capture cap30): a second word, fired
        from the shooter's own headset, that stacks with the gun word. `resolve()` writes it from a
        declared `wire.headset_dmg` (never a mirror of t5) and REFUSES a weapon whose capture carries
        a t12 but declares no `wire.headset_dmg` (see the comment above that write). t13/t42
        (`HeadsetRangeOutdoor`/`HeadsetRangeIndoor`, the second word's own reach) are optional: a
        declared `wire.headset_range_outdoor`/`_indoor` overwrites the captured cell, an undeclared one
        leaves it untouched, and neither ever raises: reach is not a damage number.

        t6 (`primaryCritChance`, F62, closed 2026-09-18) is a straight percentage the GUN rolls itself
        (a crit is the magnitude x1.5 truncated, `$HIR` token 6 reads 1 on it). A declared `crit_pct`
        writes it; an absent one leaves the captured value untouched (0 on every stock frame) -- unlike
        `headset_dmg`, an absent `crit_pct` is not a refusal, because a weapon that never crits is not a
        balance hole (see the comment above the write).

        `environment` ("indoor"/"outdoor"/None) only reaches `gun_range_outdoor_pct`: outdoor scales
        t2 by the weapon's catalogue starting value, indoor and unset both keep the captured t2
        unchanged (indoor is untested, F231 open — never invent an indoor number).

        A weapon may additionally declare `overrides` — an explicit, per-token escape hatch for bench
        findings that contradict a stock value (see `_override_index`). Each entry must name a
        documented token and carry a `why`; nothing else in the frame can move.

        Rows without a `capture` block fall back to the old template path (synthetic test catalogs)."""
        w = self._row(weapon_id)
        cap = w.get("capture") or {}
        frame = cap.get("frame")
        if not frame:                                  # legacy template path
            base = w.get("base", "ar")
            p = f"$WEAP,{slot}{WEAPON_TAILS[base]}".split(",")
            _mag, _res, _rel = self._mods(mods, int(w["mag"]), int(w["reserve"]), int(w["reload_ms"]))
            p[_W_MAG] = str(_mag); p[_W_CLIPSTART] = str(_mag)
            p[_W_RESERVE] = str(_res); p[_W_RELOAD] = str(_rel)
            return ",".join(p)
        p = frame.split(",")
        p[1] = str(slot)
        T = self._T

        def put(key: str, val) -> None:
            p[T[key] + 1] = str(val)

        wire = w.get("wire") or {}
        # S50 (Armour Piercing perk): `dmg_mult` must be able to scale t5 even on a weapon with NO
        # `wire.dmg` override -- every other `mods` knob only fires when its perk is present, but
        # most weapons carry no `wire.dmg` at all, so the base to scale falls back to `damage()`
        # (the number this catalogue already publishes as `dmg_hit`, wire.dmg if set else the
        # captured frame's own t5 -- never the raw hardware capture ignoring an existing rebalance).
        # 2026-09-18: Armour Piercing now passes an ABSOLUTE damage (`dmg_abs`, the weapon's own
        # `ap_dmg`) rather than a multiplier, because no multiplier prices the perk fairly: 45/115 is
        # 0.39, so anything near the old 0.4 left hits-to-kill unchanged and the perk free. §7.7.
        # t12 (`ExtraHeadsetDamage`, protocol.md 2026-09-18) is now MEASURED, not unknown: on exactly
        # three stock weapons (shotgun, plasma sniper, rocket launcher) t1=2 sends a SECOND word out of
        # the shooter's own headset, ~88 ms behind the gun word, and it STACKS -- Callsign capture cap30
        # caught one Shotgun pull as `$HIR,4,0,1,0,45,0,0` then `$HIR,4,0,1,0,70,0,0` 88 ms later on the
        # same victim sensor, 115 in one pull, a kill (900 ms cycle, so it cannot have been two pulls).
        # LaserTagMods (Jay, 2026-09-18) independently confirms the mechanism -- "it actually is both ...
        # so there is a dual emitter fire, one from tagger, weaker damage, and one from headset, greater
        # damage" -- which READS AS the tagger sending the smaller word and the headset the larger one,
        # though that stays SOURCED and not settled: a capture cannot show which emitter fired, and no
        # bench has yet covered one emitter at a time (F275's run does it in passing). Open BRX also
        # adds a deliberately tiny second word to the SMG after the 2026-09-20 covered-emitter test;
        # because that is not present in the capture, it requires evidence-carrying t1/t12 overrides.
        # `resolve()` therefore no longer MIRRORS t5 onto t12: it writes a DECLARED
        # `wire.headset_dmg`, priced independently of t5 (see `WeaponCatalog.damage_per_pull()`). A
        # weapon whose capture carries a t12 but declares no `wire.headset_dmg` is REFUSED, not silently
        # left at its raw captured word -- an unpriced captured t12 is the exact three-weapon balance
        # hole this whole change exists to close (the Plasma Sniper priced its t5 down to 25 while its
        # capture still carried an unpriced 80). Inventing a t12 on another weapon is still refused --
        # the same "emit the capture verbatim" contract that keeps t41 untouched.
        had_headset_dmg = p[T["headset_dmg"] + 1].strip() != ""
        dmg_abs = (mods or {}).get("dmg_abs")
        if dmg_abs is not None:
            eff_dmg = max(1, int(dmg_abs))
            put("dmg", eff_dmg)
        elif wire.get("dmg") is not None:
            # An explicit `wire.dmg` literal is written verbatim, 0 included: that is FIELD-4's own
            # fixture (a weapon whose catalog `dmg: 0` must compile to a gun that deals no damage, not a
            # floored 1, or the "0 DAMAGE" validate() guard this exact case exists to catch can never
            # trip again).
            eff_dmg = int(wire["dmg"])
            put("dmg", eff_dmg)
        else:
            eff_dmg = int(p[T["dmg"] + 1] or 0)   # captured value, unmoved -- still the number t5 carries
        headset_dmg = wire.get("headset_dmg")
        if had_headset_dmg:
            if headset_dmg is None:
                raise ValueError(
                    f"{weapon_id}: capture carries a t12 (ExtraHeadsetDamage) but weapons.json declares "
                    f"no wire.headset_dmg: shipping the raw captured second word unpriced would reopen "
                    f"the balance hole this change exists to close; add a wire.headset_dmg")
            # ⚠ ARMOUR PIERCING OWNS THE WHOLE PULL, BOTH WORDS (2026-09-18, polish review). `dmg_abs` is
            # the perk's ABSOLUTE priced damage per trigger pull, and `_rekey` points the WHOLE frame at
            # the AP cell -- so both words land on fn 2, straight past armour AND shields. Writing the
            # weapon's normal `headset_dmg` beside a priced t5 delivered `ap_dmg + headset_dmg` to bare
            # health while the perk was priced at `ap_dmg` alone (an AP Shotgun shipped 15 + 20 = 35 for
            # the price of 15). That is the identical unpriced-second-word hole this whole change exists
            # to close, so AP zeroes the second word and the pull is worth exactly what it costs.
            put("headset_dmg", 0 if dmg_abs is not None else int(headset_dmg))
        elif headset_dmg is not None:
            # The captured SMG has no second word. Open BRX deliberately adds a small close-combat
            # headset word after the 2026-09-20 covered-barrel control proved the absence. Inventing a
            # word remains awkward: the row must both price it in `wire` (so balance sees it) and carry
            # an explicit, sourced t12 override (so a casual balance edit cannot create an emitter).
            overrides = w.get("overrides") or {}
            ov = overrides.get("t12")
            if not isinstance(ov, dict) or int(ov.get("value", -1)) != int(headset_dmg):
                raise ValueError(f"{weapon_id}: wire.headset_dmg on a capture with empty t12 needs a matching "
                                 "overrides.t12 entry with the evidence for inventing the headset word")
            self._override_index(weapon_id, "t12", ov)
            source = overrides.get("t1")
            if not isinstance(source, dict) or int(source.get("value", -1)) != 2:
                raise ValueError(f"{weapon_id}: an invented headset word needs overrides.t1=2 "
                                 "(gun and headset), or t12 will never be emitted")
            self._override_index(weapon_id, "t1", source)
            for key, wire_key in (("t13", "headset_range_outdoor"),
                                  ("t42", "headset_range_indoor")):
                reach = overrides.get(key)
                if (int(wire.get(wire_key, -1)) != 100 or not isinstance(reach, dict)
                        or int(reach.get("value", -1)) != 100):
                    raise ValueError(f"{weapon_id}: an invented headset word needs wire.{wire_key}=100 "
                                     f"and overrides.{key}=100 so the receiver can hear it reliably")
                self._override_index(weapon_id, key, reach)
            put("headset_dmg", 0 if dmg_abs is not None else int(headset_dmg))
        # t37 (`charge tap damage`, F225/S43, bench-proven 2026-09-17: t37=30 changed only the tap while
        # the charge stayed on t5) -- an independent balance lever from the charge magnitude, so it gets
        # its own `wire.tap_dmg` override, the same plain pattern as `wire.fire_ms` below: written
        # verbatim when declared, left exactly as the capture carries it otherwise. F291 (2026-09-23,
        # Tony): the Charge Rifle's own kill combo (charge + N taps) is priced on THIS token, never on
        # the tap CADENCE, which the gun does not read or enforce at all (see `CHARGE_TAP_CADENCE_MS`).
        if wire.get("tap_dmg") is not None:
            put("tap", int(wire["tap_dmg"]))
        # t6 (`primaryCritChance`, F62, closed 2026-09-18): the GUN rolls its own crit off this straight
        # percentage, magnitude x1.5 truncated, and `$HIR` token 6 reads 1 on the proc (0 on a normal
        # hit) so the victim's node can see it. This is NOT the same "declare it or we refuse" contract
        # as `headset_dmg` above, though the two writes sit side by side and look alike. A captured t12
        # left unpriced is a live balance hole -- the second word still fires and lands its raw captured
        # magnitude, so an undeclared `wire.headset_dmg` is refused outright. A captured t6 left at 0 is
        # not a hole: it is just a weapon that never crits, which every stock frame already is (every
        # capture carries t6=0). So an ABSENT `crit_pct` is silently left exactly as the capture carries
        # it, not refused -- only a DECLARED `crit_pct` writes the token, and only the three weapons that
        # carry one pay for it in ammunition (weapon-design.md; the dominance model prices the buff).
        crit_pct = w.get("crit_pct")
        if crit_pct is not None:
            crit_pct = int(crit_pct)
            if not 0 <= crit_pct <= 100:
                raise ValueError(f"{weapon_id}: crit_pct {crit_pct} must be 0-100")
            put("crit", crit_pct)
        # t13 (`HeadsetRangeOutdoor`) / t42 (`HeadsetRangeIndoor`): the second word's OWN reach. Unlike
        # t12, an unwritten reach is not a safety hole -- reach is not a damage number, so a weapon with
        # a captured cell but no declared override just keeps whatever the capture carries, and this
        # never raises either way. 2026-09-18 (Tony): both are locked at 100 on all configured headset
        # words -- the flat, measured shelf of F231's range curve, not its unstable 13-26 transition
        # band -- so today the second word lands on every pull at every range this game is played at.
        # See docs/FOLLOWUPS.md for the open question of where the word WOULD cut out if aimed lower.
        if p[T["headset_range_outdoor"] + 1].strip() != "" and wire.get("headset_range_outdoor") is not None:
            put("headset_range_outdoor", int(wire["headset_range_outdoor"]))
        if p[T["headset_range_indoor"] + 1].strip() != "" and wire.get("headset_range_indoor") is not None:
            put("headset_range_indoor", int(wire["headset_range_indoor"]))
        fire_abs = (mods or {}).get("fire_abs")
        if fire_abs is not None:
            put("fire", int(fire_abs))         # Armour Piercing's own cycle (§7.7)
        elif wire.get("fire_ms") is not None:
            put("fire", int(wire["fire_ms"]))
        mag, reserve, reload_ms = self._ammo(weapon_id, mods)
        put("mag", mag); put("clipstart", mag)                 # tok39 == tok16
        put("reserve", reserve); put("reserve_half", reserve // 2)   # tok17 == 2 * tok40 (`_ammo` keeps it even)
        put("reload", reload_ms)
        put("swap", self.swap_ms(weapon_id, mods))
        # t2 (F234): the venue-scaled carrier-frequency lever. t41 is deliberately NOT written here (see the
        # `_T` comment and the F234 block above `RANGE_OUTDOOR_FLOOR`) -- it stays exactly as the
        # capture carries it, byte for byte.
        put("range_outdoor", gun_range_outdoor_pct(
            int(p[T["range_outdoor"] + 1] or 0), wire.get("range_outdoor_pct"), environment))
        for key, ov in (w.get("overrides") or {}).items():
            # t12 has already been validated and written above. Applying the evidence record again
            # here would undo Armour Piercing's required zeroing of the second damage word.
            if key == "t12" and headset_dmg is not None:
                continue
            idx = self._override_index(weapon_id, key, ov)   # validates before we touch the frame
            p[idx + 1] = str(ov["value"])
        return ",".join(p)

    @staticmethod
    def _override_index(weapon_id: str, key: str, ov) -> int:
        """Validate one `overrides` entry and return its doc-token index.

        An override is the ONLY sanctioned way to deviate from a captured frame outside the balance
        tokens, so it is deliberately awkward: it must name a documented token and it must say why.
        Bench findings that contradict a stock sound (a reload part that chirps, a fire sound that is
        actually a music sting) are what this is for — not a general-purpose token writer."""
        if not isinstance(ov, dict) or not str(ov.get("value", "")).strip() or not str(ov.get("why", "")).strip():
            raise ValueError(f"{weapon_id}: override {key!r} needs both a 'value' and a 'why'")
        try:
            idx = int(str(key).lstrip("tT"))
        except ValueError:
            raise ValueError(f"{weapon_id}: override key {key!r} must look like 't33'") from None
        if idx not in WeaponCatalog._NAMED:
            raise ValueError(f"{weapon_id}: override tok{idx} is not a token we have a name for")
        # An override runs LAST, after the ammo trio is written, so an ammo token here would land
        # outside `resolve()`'s two invariants — tok39 == tok16 and tok17 == 2 * tok40 — and ship a
        # frame no captured Callsign frame has ever looked like. Ammo is a catalog field; edit that.
        if idx in WeaponCatalog._AMMO_TOKENS:
            raise ValueError(f"{weapon_id}: override tok{idx} is an AMMO token — set mag/reserve/reload_ms "
                             f"on the weapon instead, or the tok39==tok16 / tok17==2*tok40 invariants break")
        return idx

    def damage(self, weapon_id: str) -> int:
        """The weapon's `$WEAP` t5 — the MAGNITUDE it emits, and (bench-confirmed 2026-09-11) exactly
        what lands on a GUN-BODY hit; this is the guaranteed-kill number this class publishes.

        ⚠ The victim's `$SIR` row for this weapon's `<t3,t4>` decides what the magnitude does, and on
        the HEADSET sensor it can do more: fn 36 lands floor(t5 x headset_multiplier(36, t7)) and fn 37
        lands floor(t5 x headset_multiplier(37, t7)) (t7 = the compiled `$GSET` criticalShotModifier;
        see `headset_multiplier()`), a status row lands nothing, and a missing row drops the hit
        entirely (bench 2026-08-26, headset scaling bench-confirmed 2026-09-11 to be sensor-gated and
        t7-dependent, superseding the earlier flat x1.25/x2 reading; docs/ir-effects-design.md §6.2).
        `validate()` warns about all three; this method always returns the gun-body (x1) number.
        For plain damage rows — the majority — this is the applied damage on either sensor and `$HIR`
        token 5 echoes it.

        Rebalanced weapons carry it in `wire.dmg`; untuned ones read it back out of their captured
        frame rather than being treated as unknown."""
        w = self._row(weapon_id)
        dmg = (w.get("wire") or {}).get("dmg")
        if dmg:
            return int(dmg)
        try:
            return int(self.resolve(weapon_id, 0).split(",")[self._T["dmg"] + 1])
        except (IndexError, ValueError):
            return 0

    def damage_per_pull(self, weapon_id: str) -> int:
        """What ONE trigger pull delivers to a target that takes every word it sends: `damage()` (the
        gun-body t5 magnitude) plus a declared `wire.headset_dmg`, or exactly `damage()` on the vast
        majority of weapons that declare none.

        This is deliberately a SEPARATE method from `damage()`, not a redefinition of it: `damage()`
        keeps its exact current meaning and every current caller (the Armour Piercing `dmg_abs` pricing
        base, and the number `validate()` calls "the x1 number"), untouched by this.

        The fn 36/37 HEADSET MULTIPLIER (see `headset_multiplier()`) stays excluded from every
        derivation below this method, on purpose: it is conditional on which sensor a shot lands on,
        and the catalogue cannot know that in advance. `$WEAP` t12 (`ExtraHeadsetDamage`) is a
        different mechanism entirely: on the three stock weapons whose t1 (`WeaponIRSource`) is 2
        (Shotgun, Plasma Sniper, Rocket Launcher), plus Open BRX's explicit SMG deviation, the gun fires
        an UNCONDITIONAL second word out of the shooter's
        own headset, ~88 ms behind the first. Measured on the wire 2026-09-18 (Callsign capture cap30:
        the shooter's gun emitted 45, the shooter's headset emitted 70, landing 88 ms apart on the same
        victim sensor) and independently confirmed by LaserTagMods (Jay, 2026-09-18): "it actually is
        both ... so there is a dual emitter fire, one from tagger, weaker damage, and one from headset,
        greater damage", which also settles that the tagger sent the smaller word and the headset the
        larger one. With t13/t42 (the second word's own reach) locked at 100, the flat, measured shelf
        of F231's range curve (not its unstable 13-26 transition band), both words land on every pull
        at every range this game is played at, so t5 + t12 is simply what one trigger pull delivers.
        Excluding it from `hits_to_kill()`/`time_to_kill()`/`damage_bar()` would publish a hits-to-kill
        that is wrong, which is the bug this whole method exists to close. Credit to LaserTagMods
        (Jay) for the confirming protocol read, per this repo's hard rule on crediting their work."""
        wire = self._row(weapon_id).get("wire") or {}
        headset = wire.get("headset_dmg")
        return self.damage(weapon_id) + int(headset) if headset is not None else self.damage(weapon_id)

    def hits_to_kill(self, weapon_id: str, pool: int) -> int:
        """Hits to drop a `pool`-point target (hp + armor) on the GUN BODY, computed on
        `damage_per_pull()` (t5, plus a declared `wire.headset_dmg`: see that method).

        Armor absorbs at face value and spills into HP (bench §7r). This is the guaranteed-kill number:
        `damage_per_pull()` IS the gun-body applied damage per pull, so this is correct for a body-only
        kill, not an over-estimate. ⚠ Two things this does not model (docs/ir-effects-design.md §6). First,
        a `$SIR` multiplier row lands MORE on a HEADSET hit: **fn 36 lands floor(magnitude x
        headset_multiplier(36, t7)) and fn 37 lands floor(magnitude x headset_multiplier(37, t7))**, t7
        = the compiled crit_modifier (bench-confirmed 2026-09-11, superseding the earlier flat x1.25/x2
        reading), so an all-headset kill on the five weapons on fn 36/37 needs FEWER hits than this
        method publishes; `validate()` warns on those rows with the actual multiplier. Second, the
        SHIELD pool, which sits above armor and is granted only by an IR function-11 event. 0 = damage
        unknown, caller skips.

        **A cell weapon (`rounds_per_charge` > 1) with a tap magnitude (`t37`) counts TRIGGER ACTIONS,
        not equal-sized hits** (2026-09-17, Tony, following F225/F226/S43): the Charge Rifle's real kill
        is one charge (t5, 85) plus as many taps (t37, 20) as it takes to close the remainder, e.g. 1 +
        2 = 3 actions at the 115 pool -- not `ceil(115/85) = 2`, which silently assumes every hit is a
        full charge. See `rounds_to_kill()` for the ROUNDS this costs (10 per charge, 1 per tap) and
        `tap_damage()`."""
        rpc = self.rounds_per_charge(weapon_id)
        tap = self.tap_damage(weapon_id)
        if rpc > 1 and tap > 0:
            charge_dmg = self.damage_per_pull(weapon_id)
            if charge_dmg <= 0 or pool <= 0:
                return 0
            if pool <= charge_dmg:
                return 1
            return 1 + math.ceil((pool - charge_dmg) / tap)
        dmg = self.damage_per_pull(weapon_id)
        return math.ceil(pool / dmg) if dmg > 0 and pool > 0 else 0

    # ---- derived numbers -------------------------------------------------
    # Everything below is computed from the SHIPPED frame, never read out of weapons.json. The five
    # hand-set stat fields (`dmg`, `rof`, `rng`, `htk`, `ttk_ms`) are documentation of these, and
    # `test_weapon_derivations.py` fails if any of them drifts from what the wire actually says.
    # Field 2026-08-30 found the AR shipping `rof: 53` against a derived 54 for exactly that reason.
    _BURST_MODE = 9                          # $WEAP t20 fireMode: 3-round burst (t23 = the gap after it)
    _CHARGE_MODES = frozenset({2, 3, 14})    # 2 auto-fires when charged, 3 must be held, 14 charge+heat

    def _frame_int(self, weapon_id: str, key: str, default: int = 0) -> int:
        """One named doc token of the shipped frame as an int (wire overrides already applied)."""
        try:
            return int(self.resolve(weapon_id, 0).split(",")[self._T[key] + 1] or default)
        except (IndexError, ValueError, KeyError):
            return default

    def fire_ms(self, weapon_id: str) -> int:
        """The `$WEAP` t14 fire interval as SHIPPED — a `wire.fire_ms` override wins, as on the AR."""
        return self._frame_int(weapon_id, "fire")

    def cycle_ms(self, weapon_id: str) -> float:
        """Mean ms between landed hits: t14, except on a burst weapon.

        A 3-round burst (t20 == 9) spaces two rounds at t14 and then waits t23 before the next burst,
        so what a player sustains is (2*t14 + t23)/3 — the "cycle 75 +275" column of
        docs/weapon-design.md §2.2, and the number `ttk_ms` is built from."""
        fire = self.fire_ms(weapon_id)
        if self._frame_int(weapon_id, "mode") == self._BURST_MODE:
            gap = self._frame_int(weapon_id, "burst")
            if gap:
                return (2 * fire + gap) / 3
        return float(fire)

    def rate_of_fire(self, weapon_id: str) -> int:
        """weapons.json `stats.rof` — the 0-100 UI bar, `round(7500 / t14)` (weapons.json `_note`).

        Deliberately the RAW t14, not `cycle_ms`: the bar is "how fast does this thing fire", and a
        burst weapon does fire at t14 — it just cannot keep it up."""
        fire = self.fire_ms(weapon_id)
        return round(7500 / fire) if fire else 0

    def damage_bar(self, weapon_id: str, pool: int = DEFAULT_POOL) -> int:
        """weapons.json `stats.dmg`: the SHARE of `pool` one PULL removes, 0-100 (weapons.json
        `_note`), on `damage_per_pull()` (t5, plus a declared `wire.headset_dmg`: see that method)."""
        return round(100 * self.damage_per_pull(weapon_id) / pool) if pool > 0 else 0

    CHARGE_TAP_CADENCE_MS = CHARGE_TAP_CADENCE_MS   # class-level alias; see the module constant above

    def tap_damage(self, weapon_id: str) -> int:
        """The `$WEAP` t37 tap magnitude for a cell weapon (F229/S43): independent of the charge
        magnitude (`damage()`/t5). 0 for every weapon without a tap (t37 blank on the captured frame)."""
        return self._frame_int(weapon_id, "tap")

    def rounds_to_kill(self, weapon_id: str, pool: int) -> int:
        """ROUNDS of the `mag`/`reserve` cell the minimal kill combo costs -- identical to
        `hits_to_kill()` for every weapon that fires one round per hit, but NOT for a cell weapon
        (`rounds_per_charge` > 1 with a tap magnitude): a charge costs `rounds_per_charge` rounds and a
        tap costs 1, so "3 trigger actions" (`hits_to_kill()`) and "12 rounds" are different numbers.
        This is the one to compare against a raw `mag`/`reserve` count (the one-magazine guard, kills
        per clip); `hits_to_kill()`/`time_to_kill()` are the ones to show a player."""
        rpc = self.rounds_per_charge(weapon_id)
        tap = self.tap_damage(weapon_id)
        if rpc > 1 and tap > 0:
            htk = self.hits_to_kill(weapon_id, pool)
            if not htk:
                return 0
            taps = htk - 1                       # hits_to_kill() already counted the one charge
            return rpc + taps
        return self.hits_to_kill(weapon_id, pool)

    def time_to_kill(self, weapon_id: str, pool: int) -> int:
        """ms from the first shot to the killing hit at `pool`, on the GUN BODY; 0 when the weapon
        one-shots. Built on `hits_to_kill()`, so the same gun-body caveat applies: an all-headset kill
        on an fn 36/37 weapon lands sooner than this.

        (htk - 1) cycles, because the first hit costs no wait — EXCEPT on a charge/hold weapon with NO
        tap (Rail Gun, Laser Cannon: `mode` in `_CHARGE_MODES`), where the first shot has to be charged
        too, so it is htk cycles. That is the whole reason the Rail Gun and the Laser Cannon publish a
        TTK (1.20 s / 1.50 s) while the Rocket Launcher, equally a one-shot kill, publishes 0.00.

        A CELL weapon with a tap (the Charge Rifle) is neither: it is RELEASE-to-kill, not
        charge-to-kill (see `CHARGE_TAP_CADENCE_MS`) -- the pre-built charge lands at zero delay and
        only the taps that follow cost time."""
        htk = self.hits_to_kill(weapon_id, pool)
        if not htk:
            return 0
        rpc = self.rounds_per_charge(weapon_id)
        if rpc > 1 and self.tap_damage(weapon_id) > 0:
            taps = htk - 1
            return taps * self.CHARGE_TAP_CADENCE_MS
        charged = self._frame_int(weapon_id, "mode") in self._CHARGE_MODES
        return int(round(self.cycle_ms(weapon_id) * (htk if charged else htk - 1)))

    def spawn_ammo(self, weapon_id: str, mods: dict | None = None) -> tuple[int, int]:
        """What the phone's HUD is told the player is carrying — the SAME numbers `resolve()` writes."""
        mag, reserve, _ = self._ammo(weapon_id, mods)
        return mag, reserve

    def rounds_per_charge(self, weapon_id: str) -> int:
        """weapons.json `rounds_per_charge` (2026-09-17, F226/S43): rounds of the `mag`/`reserve` cell
        one hit costs. 1 for every weapon except the Charge Rifle (10, bench-measured): its `mag`/
        `reserve` count ROUNDS of the cell, not hits, so a caller that wants "how many hits can this
        magazine land" must divide by this first (`charges()`)."""
        return int(self._row(weapon_id).get("rounds_per_charge") or 1)

    def charges(self, weapon_id: str, rounds: int) -> int:
        """`rounds` (a mag or reserve count) expressed as full charges/hits for this weapon.

        Identity for every weapon but the Charge Rifle. Floor division: a charge weapon with fewer
        than `rounds_per_charge` rounds left cannot fire one at all (F226, bench-confirmed: a
        part-filled cell jams rather than firing a partial charge)."""
        rpc = self.rounds_per_charge(weapon_id)
        return rounds // rpc if rpc > 1 else rounds

    def hir_magnitudes(self, weapon_id: str) -> list[int]:
        """S56 ("what hit me"): the BASE `$HIR` t5 magnitudes this weapon can send a victim, from one
        compiled `$WEAP` frame at slot 0 with no mods.

        A `$HIR` fact carries only the raw IR magnitude (its own t5), never a weapon id, so a victim's
        phone that wants to NAME what hit it must match that magnitude against the shooter's known
        weapons. A weapon can put more than one number on the wire: t5 (`dmg`, the gun word), t12
        (`headset_dmg`, the shooter's own second word on a dual-emitter weapon) and t37 (`tap`, a cell
        weapon's tap damage, independent of its charge). Each is included only when the compiled frame
        carries it greater than 0 -- the Shotgun's t5 and t12 are both 20, so it publishes one entry,
        not two, because the phone can only tell a hit's SIZE, not which emitter sent it. Sorted
        ascending and de-duplicated for the same reason `hir_from_weap()` is."""
        return hir_from_weap(self.resolve(weapon_id, 0))


def hir_from_weap(frame: str) -> list[int]:
    """S56: the `$HIR` t5 magnitudes carried by one already-compiled `$WEAP,...` frame.

    The same parse `WeaponCatalog.hir_magnitudes()` runs on a freshly resolved frame, but this one
    takes a frame that is already on the wire -- a player's own compiled bundle, where a perk (Armour
    Piercing's `dmg_abs`) may have changed t5 or zeroed t12 away from the catalogue's base numbers.
    `WeaponCatalog.damage()` reads t5 the same way: `split(",")[self._T["dmg"] + 1]`, one token to the
    right of the doc-token index, because index 0 of a split frame is `$WEAP` itself.

    t5/t12/t37, each only when the frame carries it greater than 0; sorted ascending and
    de-duplicated, because a phone matching a `$HIR` magnitude back to a weapon only needs to know
    which SIZES that weapon can send, not which token sent it (the Shotgun's t5 and t12 are both 20:
    one entry, not two)."""
    p = frame.split(",")
    T = WeaponCatalog._T
    vals: set[int] = set()
    for key in ("dmg", "headset_dmg", "tap"):
        idx = T[key] + 1
        if idx < len(p):
            try:
                v = int(p[idx] or 0)
            except ValueError:
                v = 0
            if v > 0:
                vals.add(v)
    return sorted(vals)


def cells_from_weap(frame: str) -> list[HirCell]:
    """F315: `hir_from_weap()`'s magnitudes, each with the cell it rides (`HirCell`), from the same frame.

    Every word one `$WEAP` frame puts on the wire (t5, the headset word t12, the charge tap t37) rides that
    frame's own t3/t4: the dual-emitter shape `compile()` sends the victim keys one cell per weapon for the
    same reason. So each entry carries the frame's t3/t4, read AFTER any re-key (Armour Piercing's
    `_AP_CELL`, a `--distinct-weapon-cells` move), which is why this takes the compiled frame and never a
    catalogue cell."""
    p = frame.split(",")
    T = WeaponCatalog._T

    def tok(key: str) -> int:
        idx = T[key] + 1
        try:
            return int(p[idx] or 0) if idx < len(p) else 0
        except ValueError:
            return 0
    proto, subtype = tok("proto"), tok("subtype")
    return [HirCell(proto=proto, subtype=subtype, mag=m) for m in hir_from_weap(frame)]


# F315 (`--distinct-weapon-cells`): the cells a same-cell, same-magnitude weapon may move to. A free cell
# UNDER THE WEAPON'S OWN PROTOCOL only: the protocol is what the victim reads first (the poison tick, the
# melee pain line, the EMP cell all key on it), so a move within one protocol changes nothing but the
# subtype. Today that is `<0,2>` alone. `hitaudio.RESERVED_CELLS` is subtracted again at use, as a belt.
DISTINCT_CELL_CANDIDATES: tuple[tuple[str, str], ...] = tuple(
    c for c in _ha.FREE_CELLS if c[0] == "0" and c not in _ha.RESERVED_CELLS)


class Compiler:
    """Implements interfaces.Compiler."""

    def __init__(self, catalog: WeaponCatalog | None = None, perks: PerkCatalog | None = None,
                 bench_volume: int | None = None, capture_row_fn: int | None = None,
                 distinct_weapon_cells: bool = False) -> None:
        self.catalog = catalog or WeaponCatalog()
        self.perks = perks or PerkCatalog()
        # None = the venue volume. A number = `--bench-volume`: every $VOL this compiler writes.
        self.bench_volume = None if bench_volume is None else check_volume(bench_volume)
        # F312: None = the shipped fn-28 row. A number = `--bench-capture-row`: the `<15,0>` row's function.
        self.capture_row_fn = None if capture_row_fn is None else check_capture_row_fn(capture_row_fn)
        # F315: False = every weapon keys its catalogue cell. True = `--distinct-weapon-cells`: `hit_plan()`
        # moves a weapon that shares a cell AND a magnitude with another onto a free cell (bench-gated).
        self.distinct_weapon_cells = bool(distinct_weapon_cells)

    def capture_row(self) -> str:
        """The `<15,0>` row this compiler ships in every live table (S57, F312)."""
        return CAPTURE_ROWS[self.capture_row_fn if self.capture_row_fn is not None else CAPTURE_ROW_DEFAULT]

    def _with_capture_row(self, rows: list[str]) -> list[str]:
        """Every live `$SIR` table (the fixed one and every class-sound take) carries the capture row,
        unless a real row already keys `("15", "0")` (a RESERVED cell no weapon is allocated). F312
        review: the class-sound takes were rebuilt without it, so `--bench-capture-row 34` left the
        head's fn-28 twin on the gun all match while the banner claimed fn 34."""
        return rows if ("15", "0") in _sir_index(rows) else list(rows) + [self.capture_row()]

    def head_volume(self, config) -> int:
        """The $VOL for a match head: the bench volume when set, else the K8 knob, else the venue volume."""
        return head_volume(config) if self.bench_volume is None else self.bench_volume

    def tryout_volume(self) -> int:
        """The $VOL for a try-out: the bench volume when set, else VOL_TRYOUT."""
        return VOL_TRYOUT if self.bench_volume is None else self.bench_volume

    def perk_effects(self, player: Player | None) -> dict:
        """The passive knobs of the player's slot-2 perk (loadout.md §1.2/§2); {} when none."""
        pid = ((player or {}).get("loadout") or {}).get("perk")
        return self.perks.effects(pid) if pid else {}

    @staticmethod
    def _perk_id(player: Player | None) -> str | None:
        return ((player or {}).get("loadout") or {}).get("perk")

    @staticmethod
    def _base_health(config: GameConfig, player: Player | None) -> tuple[int, int, int]:
        """(hp, armor, shield) BEFORE any perk grant -- the game's `health` config with the per-player
        `overrides` handicap applied (modes §1.1). There is no per-player shield override (S45: shield
        is a fact about the GAME's preset, not a handicap a player carries), so `shield` is read
        straight off `config["health"]`, defensively (`.get`, not `[]`) -- a config built before S45
        (a saved game, `golden_bundle()`, a hand-built test fixture) carries no `max_shield` at all,
        and that must read as 0 (no shield), never crash. Shared by `_to_gc()` and
        `perk_effects_resolved()` so the compiled frame and the wire `perk_effects` report can never
        disagree about what "before" means (the same drift `armed_armor()`'s own docstring warns
        about)."""
        ov = ((player or {}).get("loadout", {}) or {}).get("overrides") or {}
        h = config["health"]
        return (int(ov.get("max_hp", h["max_hp"])), int(ov.get("max_armor", h["max_armor"])),
                int(h.get("max_shield", 0)))

    # -- helpers -----------------------------------------------------------
    def _to_gc(self, config: GameConfig, player: Player | None = None, blackout: bool = False) -> _GC:
        """Map the contracts §3 GameConfig (TypedDict) onto the gameconfig.py dataclass — only the
        fields whose frames we reuse (_gset/_pset/_bmap/_led_frames). Weapons + ammo come from the
        catalog, not the dataclass, so primary/secondary are left at their defaults.

        led-language.md §6 finding #2 (2026-09-07): `leds` used to go dark on `config.night` too,
        which silently deleted the down signal along with every other light. Night is an OVERLAY now
        (dim + shorter holds, applied inside `presentation.py`'s frame builders via their own `night`
        argument) -- the only things that turn every gun LED off are the legacy `led.mode == "off"`
        and the explicit `presentation.blackout` switch (`caller passes it in, resolved once from the
        profile so this stays a pure mapping)."""
        led = config.get("led") or {}
        ov = ((player or {}).get("loadout", {}) or {}).get("overrides") or {}   # per-player HP/armor/easy_reload (modes §1.1, S50)
        pid = self._perk_id(player)
        shields = is_shields_preset(config)
        hp, armor_base, shield_base = self._base_health(config, player)
        return _GC(
            mode=config["mode"],
            game_time_s=config["time_limit_s"] or 0,
            respawn_s=config["respawn"]["delay_s"],
            respawns=0 if config["respawn"]["type"] == "none" else None,
            frag_limit=((config["scoring"].get("frag_limit") or 0)
                        if config["scoring"].get("win_by") in (None, "", "kills") else 0),
            volume=self.head_volume(config),
            outdoor=config["environment"] == "outdoor",
            leds=(led.get("mode", "team") != "off") and not blackout,
            # Q13: a ONE-team game (FFA, solo LMS: both declare the single `ffa` team) needs the gun to
            # register same-$TID hits, or nobody can hit anybody. Two or more teams: TEAM DAMAGE OFF, always.
            friendly_fire=len({t["tid"] for t in config.get("teams") or []}) < 2,
            hp=hp,
            # S50 (docs/perk-design.md §2): body_armor / quick_switch's `max_armor_add` (`_MAX_ARMOR_
            # ADD`), capped at the wire's 255 and floored at 0 — NOTE: 255 is OUR POLICY CEILING, not
            # a device limit. Bench 2026-08-27: $PSET pools are not 8-bit -- armor and HP store and
            # decrement exactly to at least 1000, clamping at zero with no wrap (shield was never
            # measured that far). Keep the cap, but do not "fix" it believing the hardware requires
            # it. In a base-armour-0 game (`shields`) the grant compiles into SHIELD instead — see
            # `armed_armor()`/`armed_shield()`.
            armor=armed_armor(armor_base, pid, shields),
            # S45: `shield_base` is now the HOST'S OWN `health.max_shield` (was a fixed constant every
            # game armed regardless of what the host asked for) -- `armed_shield()` still redirects a
            # `max_armor_add` perk's grant here in a shields-preset game (S50), on top of that number.
            shield=armed_shield(shield_base, pid, shields),
            alt_reload=bool(ov.get("easy_reload")),          # S50: moved from the perk slot to the per-player override; $BMAP,1,97
        )

    @staticmethod
    def _tid(player: Player, teams: list[Team]) -> int:
        by_id = {t["team_id"]: t for t in teams}
        tm = by_id.get(player.get("team_id") or "")
        return int(tm["tid"]) if tm else 0

    @staticmethod
    def _callout_team(teams: list[Team]) -> int | None:
        """S57 (docs/ir-callouts.md): `frames.callout_team` -- the smallest team id in 0..3 that no
        player in this match holds, or `None` when all four are in use. Every player's dead-man IR
        callout word (protocol 15, DOWN/DOWN_BY) carries this team, so a live receiving phone can hear
        it without it ever landing on a real team's own id; when it is `None`, the phone falls back to
        the victim's own team and friendly-fire-on players simply do not hear it.

        `teams` is the match's own team roster (`self._tid` maps every player into it), so the tids it
        carries ARE the tids some player holds; this needs no per-player scan. Same for every player's
        bundle in one match, because `teams` is the same list for the whole match. Friendly fire does
        not change the rule -- the gate that matters lives on the phone, not in this id."""
        held = {int(t["tid"]) for t in teams}
        return next((tid for tid in range(4) if tid not in held), None)

    def _pickup_slots(self, config: GameConfig) -> list[PowerupSlot]:
        """A56 (S58): `config.powerups`, checked. Each row names a catalogued weapon and a spare slot (2 or 3),
        and no slot is used twice. A bad row is refused rather than armed into a slot the loadout owns."""
        from .powerups import PICKUP_SLOTS
        rows = config.get("powerups") or []
        if not isinstance(rows, list):
            raise ValueError("powerups must be a list of {weapon_id, slot}")
        out: list[PowerupSlot] = []
        for r in rows:
            wid = r.get("weapon_id") if isinstance(r, dict) else None
            slot = r.get("slot") if isinstance(r, dict) else None
            if not isinstance(wid, str) or wid not in self.catalog._by_id:
                raise ValueError(f"powerups: unknown weapon_id {wid!r}")
            if isinstance(slot, bool) or slot not in PICKUP_SLOTS:
                raise ValueError(f"powerups: slot must be one of {list(PICKUP_SLOTS)}, not {slot!r}")
            if any(o["slot"] == slot for o in out):
                raise ValueError(f"powerups: slot {slot} is used twice")
            out.append({"weapon_id": wid, "slot": slot})
        return out

    @staticmethod
    def _pickup_carrier(pickups: list[PowerupSlot]) -> list[Player]:
        """A stand-in roster row that 'carries' the pickup weapons, so the A17 hit plan (and so every gun's
        `$SIR` table) covers them: a pickup hit on a cell no gun has a row for would be dropped in silence."""
        if not pickups:
            return []
        return [cast(Player, {"player_id": "_powerups", "loadout": {"weapons": [{"weapon_id": pu["weapon_id"]}
                                                                              for pu in pickups]}})]

    def _weapon_ids(self, player: Player) -> tuple[str, str | None]:
        """(primary, secondary-or-None). A10: no silent default secondary — an empty slot 1 is what the host
        asked for (ALT then falls back to reload; hardware-verified, loadout.md §2)."""
        w = player.get("loadout", {}).get("weapons", [])
        primary = w[0]["weapon_id"] if len(w) > 0 else "assault_rifle"
        secondary = w[1]["weapon_id"] if len(w) > 1 else None
        return primary, secondary

    def perk_effects_resolved(self, config: GameConfig, player: Player | None) -> PerkEffectsResolved | None:
        """S50 build 4 (docs/spec/loadout.md §1.2/§2, contracts wire `PerkEffectsResolved`): this
        player's perk, resolved to the actual base→resolved numbers a compiled frame carries. `None`
        when the player carries no perk; a field is present only when the perk actually moved it
        (`perk_id` always present otherwise, for an icon).

        Pure and cheap — catalog lookups only, no `$SIR`/voice rolls — so `State.snapshot()` can call
        it for every player on every poll. `compile()` calls this SAME method rather than re-deriving
        the numbers, so the node's `FrameBundle.perk_effects` and Mission Control's console can never
        disagree (the exact drift `armed_armor()`'s own docstring warns about, one layer up)."""
        pid = self._perk_id(player)
        if not pid or player is None:
            return None
        fx = self.perk_effects(player)
        w0, w1 = self._weapon_ids(player)
        _hp, armor_base, shield_base = self._base_health(config, player)
        shields = is_shields_preset(config)
        base_mag, base_reserve, base_reload = self.catalog._ammo(w0, None)
        res_mag, res_reserve, res_reload = self.catalog._ammo(w0, fx)   # ammo/reload knobs act on the PRIMARY only
        base_swap = max(self.catalog.swap_ms(w0, None), self.catalog.swap_ms(w1, None) if w1 else 0)
        res_swap = max(self.catalog.swap_ms(w0, fx), self.catalog.swap_ms(w1, fx) if w1 else 0)   # the gun takes the larger of slots 0/1

        def pair(base: int, resolved: int) -> ValuePair | None:
            return {"base": int(base), "resolved": int(resolved)} if int(base) != int(resolved) else None

        # Written key-by-key with a LITERAL name, not a runtime string (the same reason
        # `PerkCatalog.view()` rebuilds `effects` field-by-field): a TypedDict's assignment can only
        # be checked against a name pyright can see, never a variable.
        pe: PerkEffectsResolved = {"perk_id": pid}
        if (v := pair(base_mag, res_mag)) is not None:
            pe["mag"] = v
        if (v := pair(base_reserve, res_reserve)) is not None:
            pe["reserve"] = v
        if (v := pair(base_reload, res_reload)) is not None:
            pe["reload_ms"] = v
        if (v := pair(base_swap, res_swap)) is not None:
            pe["swap_ms"] = v
        # max_hp is never moved by any current perk — never populated, which is the correct "absent"
        # per the wire contract, not an oversight.
        if (v := pair(armor_base, armed_armor(armor_base, pid, shields))) is not None:
            pe["max_armor"] = v
        if (v := pair(shield_base, armed_shield(shield_base, pid, shields))) is not None:
            pe["max_shield"] = v
        return pe

    # -- Compiler Protocol -------------------------------------------------
    # ---- A17 hit audio ------------------------------------------------------ #
    def _hit_entry(self, weapon_id: str, sir: dict) -> "_ha.Entry | None":
        """One weapon as `hitaudio` sees it: family, the cell it keys today, and that cell's function."""
        row = self.catalog._by_id.get(weapon_id)
        if row is None:
            return None
        T = self.catalog._T
        try:
            f = self.catalog.resolve(weapon_id, 0).split(",")
            cell = (f[T["proto"] + 1] or "0", f[T["subtype"] + 1] or "0")
        except (IndexError, ValueError, KeyError):
            return None
        # F53 (closed 2026-09-11): this used to be `sir.get(cell, 0)`, which defaulted an UNCOVERED cell's
        # function to 0 -- inert while every catalogued weapon's stock cell is in `_SIR_TABLE`, but a future
        # weapon on a cell the table lacks with `hit_audio_rekey` ON would have had its new row written with
        # fn 0, silently changing its damage class, and `assert_sir_covers_weapons` (which checks a row
        # EXISTS, never that its function is right) would have passed. An uncovered cell is now an error
        # at compile time rather than a plausible wrong table on the gun (the F40 "absence reports as
        # health" shape).
        fn = sir.get(cell)
        if fn is None:
            # 2026-09-18: a weapon may instead DECLARE its own function with `sir_fn`, and then the row is
            # conditional: `sir_table()` already appends a row for any plan cell the base table lacks, so
            # the cell ships only in games that actually contain the weapon. That matters because
            # `hitaudio.MAX_SIR_ROWS` is 14 and the base table is 11: three permanent rows for three new
            # weapons took the table to the ceiling and left the class-sound allocator no budget at all.
            # A game with no Breacher in it should not push the Breacher's row to every gun.
            # The F53 error below still stands for a weapon that declares NOTHING, which is the case it
            # was written for: an uncovered cell must never default to function 0 and silently change a
            # weapon's damage class.
            fn = row.get("sir_fn")
        if fn is None:
            raise ValueError(
                f"F53: weapon {weapon_id!r} fires on IR cell {cell} and the $SIR table has no row for it "
                f"-- add the cell to compile._SIR_TABLE, or give the catalogue row a `sir_fn` so the row "
                f"ships only in games that carry the weapon (with the function it needs, not 0)")
        return _ha.Entry(weapon_id, _ha.class_for(row.get("role"), weapon_id), cell, fn)

    def hit_plan(self, roster, rekey: bool = False) -> "_ha.Plan":
        """The A17 `$SIR` plan for ONE MATCH, from every weapon on the roster.

        It must be computed once and handed to every player's `compile()`: a plan derived per player
        would give two guns different tables, and a hit keyed to a cell the victim does not carry is
        silently dropped. `rekey=False` (the default, and what ships) moves nothing -- see
        `hitaudio.plan_in_place`."""
        sir = _sir_index(_SIR_TABLE)
        ids: list[str] = []
        for p in roster or []:
            for w in ((p.get("loadout") or {}).get("weapons") or []):
                wid = w.get("weapon_id")
                if wid and wid in self.catalog._by_id and wid not in ids:
                    ids.append(wid)
        if "melee" in self.catalog._by_id and "melee" not in ids:
            ids.append("melee")                      # every player carries it, no loadout names it
        entries = [e for e in (self._hit_entry(w, sir) for w in ids) if e is not None]
        if not entries:
            return _ha.Plan()
        if not rekey:
            if self.distinct_weapon_cells:
                entries = self._distinct_cells(entries)   # F315: moves happen HERE, so every plan reader agrees
            return _ha.plan_in_place(entries)
        return _ha.plan(entries, base_cells=_sir_cells(_SIR_TABLE))

    def _distinct_cells(self, entries: list) -> list:
        """F315 (`--distinct-weapon-cells`): `entries` with every weapon that shares a cell AND a `$HIR`
        magnitude with an earlier one moved onto a free cell, so a victim's phone can tell the two apart.

        "Earlier" is catalogue order, never roster order, so the same pair always moves the same weapon
        (the Assault Rifle stays, the Energy Rifle moves). Only a plain-damage weapon moves, and only
        within its own protocol (`DISTINCT_CELL_CANDIDATES`), onto a cell no stock row, reserved cell or
        other weapon in the match keys. It keeps its `Entry.fn`, so `sir_table()` adds the new cell's row
        with the SAME function the old cell carried (`_sir_row` copies that row's tail): no balance
        change. With no candidate left the weapon stays where it is, and the phone names the hit "A / B".
        Called only on the in-place plan: `hit_audio_rekey` allocates cells by class and is not composed."""
        order = {wid: i for i, wid in enumerate(self.catalog._by_id)}
        taken = ({e.cell for e in entries} | set(_sir_cells(_SIR_TABLE)) | set(_ha.RESERVED_CELLS)
                 | {_STUN_CELL, ("15", "0"), _AP_CELL})
        out = list(entries)
        claimed: dict[tuple[str, str], set[int]] = {}      # cell -> magnitudes an earlier weapon already sends on it
        for i in sorted(range(len(out)), key=lambda i: (order.get(out[i].weapon_id, len(order)), out[i].weapon_id)):
            e = out[i]
            mags = set(self.catalog.hir_magnitudes(e.weapon_id))
            if claimed.get(e.cell, set()) & mags and e.fn in _SIR_PLAIN_DAMAGE:
                free = next((c for c in DISTINCT_CELL_CANDIDATES if c[0] == e.cell[0] and c not in taken), None)
                if free is not None:
                    out[i] = e = dataclasses.replace(e, cell=free)
                    taken.add(free)
            claimed.setdefault(e.cell, set()).update(mags)
        return out

    def _validate_distinct_cells(self, config, roster, plan, warnings: list[str]) -> None:
        """F315: say what `--distinct-weapon-cells` did to this roster, and what it could not do."""
        if not self.distinct_weapon_cells:
            return
        if config.get("hit_audio_rekey"):
            warnings.append("--distinct-weapon-cells is SKIPPED in this game: hit_audio_rekey allocates the cells by "
                            "weapon family, and the two do not compose. Same-magnitude weapons on one cell keep "
                            "sharing it, and a phone names such a hit \"A / B\" (F315)")
            return
        moved = sorted(w for w, c in plan.cells.items() if c != self._weapon_cell(w))
        if moved:
            warnings.append("--distinct-weapon-cells moved " + ", ".join(
                f"{w} to <{plan.cells[w][0]},{plan.cells[w][1]}>" for w in moved)
                + " with a plain-damage $SIR row of the same function (F315, bench-gated)")
        by_cell: dict[tuple[str, str], list[str]] = {}
        for w, c in plan.cells.items():
            by_cell.setdefault(c, []).append(w)
        for c, wids in sorted(by_cell.items()):
            mags = {w: set(self.catalog.hir_magnitudes(w)) for w in wids}
            clash = sorted(w for w in wids if any(o != w and mags[o] & mags[w] for o in wids))
            if clash:
                warnings.append(f"{' and '.join(clash)} share IR cell <{c[0]},{c[1]}> and a magnitude, and the flag could not "
                                f"move one (no free cell under that protocol, or not a plain-damage row): a phone names such a hit \"A / B\" (F315)")
        rows = len(self._with_capture_row(self.sir_table(plan, None, stun=stun_enabled(config))))
        if moved and rows > _ha.MAX_SIR_ROWS:
            warnings.append(f"the $SIR table is {rows} rows, over the {_ha.MAX_SIR_ROWS}-row community ceiling "
                            f"(hitaudio.MAX_SIR_ROWS, never measured: F39); --distinct-weapon-cells adds one row "
                            f"per moved weapon (F315)")

    def plan_gaps(self, plan, player) -> list[str]:
        """The weapons in `player`'s loadout that `plan` cannot carry for them: a hot joiner is compiled against
        the match's PINNED plan (`state._hit_plan`), and every other gun already holds the table built from it.

        A weapon the plan never saw is safe only when its cell is a STOCK row, which every gun's table keeps
        (`sir_table` never removes one). A weapon whose row is conditional (a catalogue `sir_fn` on a cell the
        base `_SIR_TABLE` lacks: the Toxin Rifle's <11,0>, the Breacher, the Haze) is in no gun's table, and a
        weapon that declares `dot` is missing from `dot_table`. So its hits vanish in silence on every gun. A
        conditional cell that another weapon in the plan already keys (`plan.groups`) has its row, and is safe.
        Those weapon ids come back here, in loadout order. An uncovered cell (the F53 error) comes back too."""
        known = set(plan.cells) if plan is not None else set()
        base = _sir_index(_SIR_TABLE)
        out: list[str] = []
        for w in ((player.get("loadout") or {}).get("weapons") or []):
            wid = w.get("weapon_id")
            if not wid or wid in known or wid in out or wid not in self.catalog._by_id:
                continue
            try:
                e = self._hit_entry(wid, base)
            except ValueError:
                out.append(wid)
                continue
            if e is None:
                continue
            rows = plan.groups if plan is not None else {}
            if (e.cell not in base and e.cell not in rows) or (self.catalog._by_id.get(wid) or {}).get("dot"):
                out.append(wid)
        return out

    def dot_table(self, plan) -> dict[str, DotSpec]:
        """S16: the game-wide damage-over-time table the VICTIM's node needs, keyed by IR protocol.

        The victim only knows its own loadout, so it cannot look up the shooter's tick numbers itself. Every
        weapon in the match plan (the whole roster, and hidden rows too: the catalogue lookup is by id) whose
        `weapons.json` row declares `dot` contributes one entry, keyed by the protocol its `$WEAP` t3 puts on
        the wire, which is the `$HIR` token 2 the victim reads. The plan's cell is used, not the catalogue's, so
        a re-keyed cell stays in step with the frame that actually ships.

        ⚠ The key is the protocol alone, because that is what the victim reads before it knows anything else.
        So another weapon in the same game on the same protocol would poison with every hit. That is refused at
        compile time rather than shipped: two weapons with different tick numbers, or a plain weapon, sharing a
        poison protocol is a table the node cannot read unambiguously."""
        by_proto: dict[str, list[str]] = {}
        for wid, cell in plan.cells.items():
            by_proto.setdefault(str(int(cell[0] or 0)), []).append(wid)
        out: dict[str, DotSpec] = {}
        for proto, wids in sorted(by_proto.items()):
            specs = {w: (self.catalog._by_id.get(w) or {}).get("dot") for w in wids}
            dotted = {w: d for w, d in specs.items() if d}
            if not dotted:
                continue
            missing_floor = [w for w in dotted if not (self.catalog._by_id.get(w) or {}).get("min_app")]
            if missing_floor:
                raise ValueError("S16: victim-side damage-over-time needs a catalog min_app so MC can refuse "
                                 "partial old-phone behavior: " + ", ".join(sorted(missing_floor)))
            malformed_floor = [w for w in dotted
                               if parse_app_ver(str((self.catalog._by_id.get(w) or {}).get("min_app"))) is None]
            if malformed_floor:
                raise ValueError("S16: catalog min_app must be MAJOR.MINOR.PATCH: "
                                 + ", ".join(sorted(malformed_floor)))
            if len(dotted) != len(wids) or len({(int(d["per_tick"]), int(d["tick_ms"]), int(d["duration_ms"])) for d in dotted.values()}) > 1:
                raise ValueError(
                    f"S16: IR protocol {proto} carries a damage-over-time weapon ({', '.join(sorted(dotted))}) AND "
                    f"{', '.join(sorted(set(wids) - set(dotted))) or 'a second tick profile'}. The victim keys the "
                    f"poison on the protocol alone, so every hit on it would poison. Move one weapon off the cell.")
            wid = sorted(dotted)[0]
            d = dotted[wid]
            spec: DotSpec = {"weapon_id": wid, "per_tick": int(d["per_tick"]), "tick_ms": int(d["tick_ms"]),
                             "duration_ms": int(d["duration_ms"])}
            if spec["per_tick"] <= 0 or spec["tick_ms"] <= 0 or spec["duration_ms"] < spec["tick_ms"]:
                raise ValueError(f"S16: {wid}'s `dot` block is unusable: {d!r} (per_tick and tick_ms must be "
                                 "positive, and duration_ms at least one tick)")
            out[proto] = spec
        return out

    def _cell_cycle_ms(self, plan, cell) -> int | None:
        """The TIGHTEST fire interval on a cell -- the row's sound has to fit the fastest weapon that
        keys it, or a burst of hits stutters over itself."""
        ms = [self.catalog.cycle_ms(w) for w, c in plan.cells.items() if c == cell]
        return int(min(ms)) if ms else None

    def sir_table(self, plan, rng, class_sounds: bool = False, stun: bool = False) -> list[str]:
        """The `$SIR` table for one head. Stock rows are never removed -- a cell we vacate keeps its row,
        so a stock gun or a grenade station still registers exactly as it does today.

        `class_sounds` DEFAULTS OFF, and that is a bench decision, not caution. F38 (2026-09-07): a
        non-empty `$SIR` sound REPLACES the `$PSET` pool sound rather than layering with it, so the
        per-WEAPON layer and the per-POOL layer compete for the same hit and only one can speak. The
        material layer wins by default because it is EAR-CONFIRMED (armour metal, shield fizz, silent
        health) while `hitaudio.CLASS_POOLS` has never been auditioned at all and was built by the
        shape method that produced zero surviving picks. Turning this on silences the material layer on
        every standard hit -- which is why the shipped rows keep the EMPTY sound token Callsign ships.
        Those empty tokens are not a gap to fill; they are what makes the pool sounds audible."""
        cells = _sir_cells(_SIR_TABLE)
        rows: list[str] = list(_SIR_TABLE)
        by_fn: dict[int, str] = {}
        for row, cell in zip(_SIR_TABLE, cells):
            fn = _sir_index([row]).get(cell)
            if fn is not None:
                by_fn.setdefault(fn, row)
        if not class_sounds:
            # Stock rows VERBATIM, in stock order, plus a silent row for any re-keyed cell. Order is
            # preserved deliberately: the table is a wire artefact and churning it churns every bundle.
            rows = rows + [_sir_row(cell, "", fn, by_fn.get(fn))
                           for cell, (_k, fn) in sorted(plan.groups.items()) if cell not in cells]
            return _with_stun_row(rows) if stun else rows   # F15/A20: the EMP cell, only when the game asks
        for cell, (cls, fn) in sorted(plan.groups.items()):
            sound = _ha.class_sound(cls, rng, self._cell_cycle_ms(plan, cell))
            if cell in cells:
                i = cells.index(cell)
                rows[i] = _sir_with_sound(rows[i], sound)
            else:
                rows.append(_sir_row(cell, sound, fn, by_fn.get(fn)))
        return _with_stun_row(rows) if stun else rows   # F15/A20: same substitution on the class-sound path (and so on every `sir_pool` take)

    def _weapon_cell(self, weapon_id: str) -> tuple[str, str] | None:
        """The `<proto, subtype>` cell a weapon fires on today (its `$WEAP` tok3/tok4), or None for an unknown id."""
        if weapon_id not in self.catalog._by_id:
            return None
        T = self.catalog._T
        try:
            f = self.catalog.resolve(weapon_id, 0).split(",")
            return (f[T["proto"] + 1] or "0", f[T["subtype"] + 1] or "0")
        except (IndexError, ValueError, KeyError):
            return None

    def _validate_stun(self, config, roster, errors: list[str], warnings: list[str]) -> None:
        """F15 / A20 `config.stun`: `{duration_s?}`, 1..60 s, default 10. Says which rostered weapons become the EMP
        source (they stop dealing damage), and says so if NOTHING in the game can stun. Refused together with
        `hit_audio_rekey`: a re-key would move the charge rifle off `<8,0>` with its fn-38 damage intact and leave
        the stun row keying nothing."""
        st = config.get("stun")
        if st is None:
            return
        if not isinstance(st, dict):
            errors.append("stun must be an object {duration_s} (F15/A20) -- {} for the 10 s default")
            return
        d = st.get("duration_s", _STUN_DEFAULT_S)
        if isinstance(d, bool) or not isinstance(d, (int, float)) or not (1 <= d <= _STUN_MAX_S):
            errors.append(f"stun.duration_s {d!r} out of range 1..{_STUN_MAX_S} s (F15/A20)")
        if config.get("hit_audio_rekey"):
            errors.append("stun cannot be combined with hit_audio_rekey (F15/A20): the re-key would move the "
                          "<8,0> weapons off the EMP cell with their damage intact")
        srcs = sorted({str(w.get("weapon_id")) for p in roster
                       for w in ((p.get("loadout") or {}).get("weapons") or [])
                       if self._weapon_cell(w.get("weapon_id")) == _STUN_CELL})
        if srcs:
            warnings.append(f"stun: {', '.join(srcs)} fire on IR cell <8,0>, the EMP cell while stun is on -- "
                            f"they STUN (fn 23: no damage, the victim's accuracy drops to 0 and recovers) instead of dealing damage")
        else:
            warnings.append("stun is on but no rostered weapon fires on cell <8,0> and MC arms no station for "
                            "it: nothing in this game can stun (the source is a $WEAP t3=8 slot or a proto-8 station)")
    @staticmethod
    def _rekey(frame: str, cell) -> str:
        """`$WEAP` with tok3/tok4 (the IR word's B and U fields) pointed at `cell`. Nothing else moves."""
        if cell is None:
            return frame
        t = frame.split(",")
        if len(t) > 5:
            t[4], t[5] = cell[0], cell[1]
        return ",".join(t)

    def _refuse_if_ap_ineligible(self, weapon_id: str, player: Player) -> None:
        """S50: Armour Piercing may only key a PLAIN-DAMAGE primary. Refused, not silently skipped
        (the task's own choice of the two options offered: "a weapon whose damage key is already
        special must be refused or left alone" -- refusing matches this codebase's existing style,
        `assert_*`/F82's "refusing to compile"), on two shapes:

        * a CELL/CHARGE weapon (the Charge Rifle): its `hits_to_kill`/`rounds_to_kill` is
          release+tap math, not a flat t5 cut (see `hits_to_kill()`), so a `dmg_mult` and a $SIR key
          swap would silently change what the charge and taps do rather than just skip armour.
        * a weapon whose OWN stock `$SIR` cell is already a grant/heal/status row
          (`_SIR_GRANT`/`_SIR_NO_POOL`), never plain damage -- the hidden `med_kit`/`concussion`
          `slot_frame` mechanism lives in the VICTIM's table the same way, on the secondary, so this
          also guards a future primary built the same way.
        """
        name = player.get("display") or player.get("player_id") or "this player"
        if self.catalog._row(weapon_id).get("ap_dmg") is None or self.catalog._row(weapon_id).get("ap_fire_ms") is None:
            # 2026-09-18 (§7.7): most weapons have NO fair Armour Piercing damage, and that is
            # arithmetic rather than an oversight. Bypassing armour takes a standard target from a 115
            # pool to 45 HP, so the perk only costs something if its damage is well under 45/115 of the
            # weapon's own, and damage is an integer: at 8 the choices are 3 (which leaves hits-to-kill
            # unchanged, so the perk is free) and 2 (which is useless), with nothing between. A weapon
            # that cannot be priced must not carry the perk, or Armour Piercing is strictly better than
            # not taking it, which is what shipped until this was measured.
            raise ValueError(
                f"S50 ARMOUR-PIERCING GUARD: refusing to compile {name}'s Armour Piercing primary "
                f"{weapon_id!r} — the catalogue gives it no `ap_dmg`, so there is no damage value that "
                f"makes the perk a trade rather than a free upgrade on this weapon (weapon-design.md "
                f"§7.7). Armour Piercing needs a low-damage, high-rate primary")
        if self.catalog.rounds_per_charge(weapon_id) > 1:
            raise ValueError(
                f"S50 ARMOUR-PIERCING GUARD: refusing to compile {name}'s Armour Piercing primary "
                f"{weapon_id!r} — it is a CHARGE weapon (rounds_per_charge > 1): its hits-to-kill is "
                "release+tap math, not a flat damage cut, so a $SIR key swap would silently change "
                "what its charge and taps do rather than just skip armour and shields. Armour "
                "Piercing is refused on a charge weapon; pick a different primary.")
        cell = self._weapon_cell(weapon_id)
        if cell is None:
            return                                # unknown id -- already reported elsewhere
        fn = _sir_index(_SIR_TABLE).get(cell)
        if fn is not None and fn not in _SIR_PLAIN_DAMAGE:
            raise ValueError(
                f"S50 ARMOUR-PIERCING GUARD: refusing to compile {name}'s Armour Piercing primary "
                f"{weapon_id!r} — its stock $SIR cell <{cell[0]},{cell[1]}> is fn {fn}, not plain "
                "damage (a grant/heal/status row): re-keying it would change what the weapon DOES, "
                "not just where its damage goes. Armour Piercing is refused on a weapon whose damage "
                "key is already special; pick a different primary.")

    def _refuse_if_crit_perk_ineligible(self, weapon_id: str, player: Player) -> None:
        """F278: `test_a_two_word_weapon_never_also_carries_a_crit_chance` refuses a CATALOGUE row that
        declares both `wire.headset_dmg` and `crit_pct` -- the crit flag rides on both IR words but the
        multiplier reaches only the barrel word, a split nothing in the catalogue models. That guard
        reads `weapons.json` at catalogue-lint time only. A perk that grants crit chance (`crit_pct_add`)
        writes the gun's crit token at RUNTIME (bench-found: `$TMP` t10), so it can reach the identical
        combination without ever touching the row the lint guard reads. This refuses it here too, one
        condition, fails safe, filed and fixed before any such perk ships (docs/FOLLOWUPS.md F278)."""
        name = player.get("display") or player.get("player_id") or "this player"
        headset = (self.catalog._row(weapon_id).get("wire") or {}).get("headset_dmg")
        if headset:
            raise ValueError(
                f"F278 CRIT-PERK GUARD: refusing to compile {name}'s crit-chance perk with {weapon_id!r} "
                f"armed — it carries a second IR word (wire.headset_dmg {headset}); the crit flag rides "
                "on both words but the multiplier reaches only the barrel word, and that combination has "
                "never been measured. Pick a different weapon, or a different perk.")

    def compile(self, config: GameConfig, player: Player, teams: list[Team], roll=None,
                plan=None) -> FrameBundle:
        """`roll` (A15.1) = a `random.Random`: the `$PSET` voice fields a player did not pick explicitly are
        ROLLED from their pools (voices.roll_pset) -- since A15.3 that is the death scream only, and the node
        re-rolls it per spawn from `pset_pool` anyway. None = the family defaults, deterministic (tests, the
        golden bundle)."""
        prof = _pres.resolve(config)
        night = bool(config.get("night", False))
        ffa = config["mode"] == "ffa"          # Q19: FFA paints WHITE on both surfaces, no team identity to protect
        gc = self._to_gc(config, player, blackout=prof.get("blackout", False))
        pnum = int(player["player_num"])
        if not 1 <= pnum <= MAX_PLAYERS:
            raise ValueError(f"player_num {pnum} out of range 1..{MAX_PLAYERS} (0 reserved, A5.1)")
        tid = self._tid(player, teams)
        # 🔴 F82 at the last possible moment: a hill mode's head may not carry `$TID,2`. `validate()`
        # reports that as an ERROR, but an error is ADVISORY — `_after_player_change` re-compiles and
        # re-pushes before it runs, so a team change after the push could put the frame on a gun with
        # nothing but a red line on a screen the operator had already left (operator review
        # 2026-09-10). The config can no longer even HOLD a tid-2 team in these modes (`state.py`
        # `_merge_config`); this makes the frame itself unbuildable, the same way `assert_sir_covers_*`
        # makes a silently-deaf head unbuildable.
        if config.get("mode") in _OBJECTIVE_MODES and tid == _NEUTRAL_TEAM:
            raise ValueError(
                f"F82 GUARD: refusing to compile a {config.get('mode')!r} head on $TID {_NEUTRAL_TEAM} for "
                f"{player.get('display') or player.get('player_id')} — that is the team a NEUTRAL hill "
                "broadcasts, so this gun would read every uncaptured point as its own and take no hill "
                "damage. Move the player to tid 0, 1 or 3.")
        w0, w1 = self._weapon_ids(player)
        fx = self.perk_effects(player)                    # ammo/reload knobs act on the PRIMARY only …
        mods = {k: fx[k] for k in ("ammo_mult", "ammo_mult_pistol", "reload_mult", "switch_mult") if fx.get(k)}
        swap_mods = {k: mods[k] for k in ("switch_mult",) if k in mods}   # … the swap delay must scale on EVERY slot (the gun takes the larger)
        # S50 (Armour Piercing perk): PRIMARY ONLY. `_refuse_if_ap_ineligible` raises before anything
        # is written for a weapon whose damage key is already special (a charge weapon, or a stock
        # grant/heal/status cell); `dmg_mult` rides in `mods` so `resolve()` cuts t5, and the frame's
        # tok3/tok4 are re-keyed onto `_AP_CELL` AFTER the class-sound `plan` rekey below, so Armour
        # Piercing always wins regardless of `hit_audio_class`.
        armor_piercing = bool(fx.get("armor_piercing"))
        if armor_piercing:
            self._refuse_if_ap_ineligible(w0, player)
            ap_row = self.catalog._row(w0)
            # BOTH levers (§7.7). Damage alone cannot price the perk, because damage is an integer and
            # the steps are too coarse: on an 8-damage weapon 3 is free and 2 is useless. Slowing the
            # cycle as well makes the trade continuous, and it is what the perk should feel like anyway:
            # heavier rounds, fewer of them, slower.
            mods = {**mods, "dmg_abs": int(ap_row["ap_dmg"]), "fire_abs": int(ap_row["ap_fire_ms"])}

        # F278: a crit-chance perk (`crit_pct_add`) checked against BOTH slots -- the catalogue guard it
        # mirrors (`test_a_two_word_weapon_never_also_carries_a_crit_chance`) refuses any row, not just
        # a primary, so a player could still reach the combination by carrying the two-word weapon as
        # their secondary.
        if fx.get("crit_pct_add"):
            self._refuse_if_crit_perk_ineligible(w0, player)
            if w1:
                self._refuse_if_crit_perk_ineligible(w1, player)

        # A15.1: roll the un-picked $PSET voice fields for THIS push; explicit picks always win
        voice, picks = player.get("voice", "male"), (player.get("voice_slots") or {})
        rolled: dict[str, str] = {}
        if roll is not None:
            full = _voices.roll_pset(voice, picks, roll)
            fixed = _voices.check_slots(picks)
            rolled = {r: i for r, i in full.items() if r not in fixed and len(_voices.roll_pool(voice, r)) > 1}   # the real draws only
        voice_slots = {**rolled, **picks} if rolled else (picks or None)
        # A17: the hit-audio plan is a MATCH property -- `state._compile_rolled` computes it once from the
        # whole roster and hands the same object to every player. A caller that passes none (the golden
        # bundle, tests, `bundle_for`) gets an in-place plan built from THIS player's weapons: sounds only,
        # nothing re-keyed, so a per-player plan can never disagree about which cells exist.
        hits_rng = roll if roll is not None else _random.Random(0)     # None = deterministic, for the golden bundle
        # A56 (S58): the pickup weapons MC armed for this game (`GameConfig.powerups`, set by the session only
        # under `--powerups`). Absent = none, and then nothing below changes a single frame.
        pickups = self._pickup_slots(config)
        if plan is None:
            plan = self.hit_plan([player, *self._pickup_carrier(pickups)], rekey=False)
        # head — config, per player, SILENT (no $SPAWN, no $PLAY,VA81); ends with $TID (§1.1)
        env = config.get("environment")
        _gset = gc._gset()
        head = [f"$VOL,{self.head_volume(config)},0,*", "$CLEAR,*", "$START,*",
                _gset,
                # F162: EMPTY today (`DRIVE_IO_MODE` is "off") -- the staged venue-mode candidates,
                # right after $GSET so a bench rung changes one thing next to the frame it copies.
                *venue_mode_frames(_gset, env),
                gc._pset(pnum, player.get("voice"), voice_slots, team=tid),   # the voice pack is per-PLAYER (§PSET); A15 slot picks / A15.1 rolls. F206: t2 = the $TID team
                self._rekey(self._rekey(self.catalog.resolve(w0, 0, mods, environment=env), plan.cell_for(w0)),
                            _AP_CELL if armor_piercing else None)]
        if w1:
            head.append(self._rekey(self.catalog.resolve(w1, 1, swap_mods, environment=env), plan.cell_for(w1)))   # slot 1 only when a secondary exists (A10)
        head.append(self._rekey(self.catalog.resolve("melee", 4, swap_mods, environment=env), plan.cell_for("melee")))
        # A56: each pickup weapon in its spare slot with its normal `$WEAP` tokens. It is LOCKED by the empty
        # magazine below and by the ALT `$BMAP` cycle, which stays 0/1 only (`gc._bmap()` is not touched): the
        # player's own phone unlocks it at the station with a mid-life `$AMMO` + `$BMAP` (powerups.md).
        for pu in pickups:
            head.append(self._rekey(self.catalog.resolve(pu["weapon_id"], pu["slot"], swap_mods, environment=env),
                                    plan.cell_for(pu["weapon_id"])))
        bmap = list(gc._bmap())
        if not w1 and not gc.alt_reload:
            # Empty slot 2 (A10 §2): with one $WEAP slot loaded, weapon-cycle (fn 100) has nothing to cycle to and
            # falls back to RELOADING (protocol §BMAP; bench 2026-09-17, Tony: "the alt button is reloading the charge
            # rifle"). So ALT gets fn 98, the inert function select/left/right use: alt-fire does nothing.
            # easy_reload keeps ALT→97 on purpose.
            bmap = [("$BMAP,1,98,,,,,*" if row.startswith("$BMAP,1,") else row) for row in bmap]
        # Headset colour. We never sent ANY lit-state $HLED, which is why our headsets sat dark for a
        # whole match (field 2026-08-30) — that part is solid, and this frame is the fix.
        #
        # ⚠ WHAT THE CAPTURES ACTUALLY SHOW, corrected 2026-09-01 after review found the original
        # comment here overstated them. Read this before trusting the value:
        #   · Callsign sends it in the LOBBY, not in the arm sequence. In every capture it lands
        #     seconds BEFORE $CLEAR/$START (game-start.txt: $HLED @21.429s, $CLEAR @25.012s;
        #     two-tagger-combat: @211.7s vs @274.5s). We send it mid-head, after $BMAP. Position is
        #     therefore OURS, not Callsign's.
        #   · It is always PAIRED with a $GLED carrying the identical token 1 ~200 ms earlier. We
        #     send it alone: `_led_frames()` returns [] when LEDs are on.
        #   · Token 1 is only ever 0, 1 or 7 across every capture on disk (7 = the hurt alert), and
        #     NO capture contains a $TID at all — so nothing observed correlates this token with a
        #     team id. "tid is the colour" is an inference from $GLED's palette, not a measurement.
        #     A tid of 2..63 has never been sent to a headset by anything.
        # Keeping the behaviour deliberately: it is the only way to test it, and it cannot be worse
        # than the dark headsets we shipped. But it is UNVERIFIED — see FOLLOWUPS F10, which is an
        # eyeball test, and do not cite this frame as confirmed until that is done.
        hs = prof.get("headset") or _pres.HEADSET_DEFAULT
        # A11.6: the lobby team colour is the headset block's `pregame`; the in-play repaint after
        # spawn / revive / hit exists only when `in_play` is "team" (default: dark, native-like).
        hled = _headset_colour(tid, gc.leds, ffa, night) if hs.get("pregame", "team") == "team" else []
        play_hled = _headset_colour(tid, gc.leds, ffa, night) if hs.get("in_play") == "team" else []
        # A11.7 pregame: the armed gun body in the team colour (a paint holds before $SPAWN), like the headset.
        gun_pre = _pres.gun_pregame(prof, tid, night, gc.leds, ffa)
        _cs = bool(config.get("hit_audio_class", False))     # A17 class sounds -> a per-life `sir_pool` take
        sir_live = self.sir_table(plan, hits_rng, _cs, stun=stun_enabled(config))
        # S57 (2026-09-23, docs/ir-callouts.md): the silent proto-15 beacon row now ships in EVERY
        # mode's live table, not only `_OBJECTIVE_MODES` -- the IR callout bus needs a gun in ANY mode
        # to REPORT a dead player's own `$IRTX` word, and fn 28 is the one function proven to register
        # it with zero player feedback (see the row's own comment above `_OBJECTIVE_SIR_ROW`). Guarded
        # rather than unconditional: `("15", "0")` is a RESERVED cell (`hitaudio.RESERVED_CELLS`) that
        # no weapon or class group is ever allocated, so no table should already key it -- but if one
        # ever does, that real row wins and this never doubles up on the same cell (under
        # `--bench-capture-row` the F312 guard refuses such a bundle instead: the banner would lie).
        sir_live = self._with_capture_row(sir_live)   # F70/F79/S57: the proto-15 beacon row (F312: its fn)
        # F121/A23: the HEAD carries the same cells DISARMED -- hits register, nothing moves, no sound. The
        # real table is a `sir_pool` take the node writes behind the first spawn's protection (F121 rebuild).
        sir_pregame = sir_spawn_protected(sir_live)
        head += sir_pregame + hold_trigger(bmap) + gc._led_frames() + hled + gun_pre + [f"$TID,{tid},*"]   # §1.1: head ends with $TID
        assert_sir_covers_weapons(head)      # A17: no armed weapon may key a cell this head has no row for
        assert_sir_covers_objective(head, config["mode"])   # F79: no objective mode may ship with no way to hear its own beacon
        assert_spawn_protected(head)         # F121: and none of those rows may move a pool before go-live
        if armor_piercing:
            assert_armor_piercing_armed(head)   # S50: refuse to arm a weapon nobody's gun can register

        pmag, pres = self.catalog.spawn_ammo(w0, mods)
        ammo = [f"$AMMO,0,{pmag},{pres},1,*"]
        if w1:
            smag, sres = self.catalog.spawn_ammo(w1)
            ammo.append(f"$AMMO,1,{smag},{sres},1,*")
        # A56: a pickup slot's magazine and reserve are 0 at every spawn and revive, so an item never carries
        # into the next life (`powerups.LOST_AT_DEATH`) even if the gun would restore it after `$SPAWN`.
        ammo += [f"$AMMO,{pu['slot']},0,0,1,*" for pu in pickups]

        # spawn = $PLAYX,0 -> $SPAWN -> $AMMOs -> $BMAP,0,0 (the T-0 tail; M-START wraps VA81 + $SFLASH)
        # ... + the headset team colour LAST. Bench 2026-09-03 (hled_spawned.py): `$SPAWN` CLEARS
        # the headset, which is exactly why the lobby frame above showed up "on death, not pre-game"
        # in the field (G4/V3) -- it was gone the moment the game started. A static $HLED painted
        # after spawn holds solid, and one sent 1 s after spawn lit; it goes at the end of the tail
        # so the $AMMO writes give the headset relay a beat first. Token 5 = 10 is already maximum
        # brightness (1 dim, 2/10/255 identical), measured the same day.
        # A11.7 (S4): the gun body is taken by the NODE `gun.after_spawn_s` after every $SPAWN (blank, then the
        # rest frame) -- a blank inside this burst does not take, the spawn animation re-enables the breathing
        # (stage ladder 2026-09-04: +1.0 s / +1.5 s breathing, +2.0 s solid). So spawn/revive carry no $GLED.
        # F121 rebuild (levers §23, bench 2026-09-18): protection is `$TMP` t8 = -100, written RIGHT AFTER
        # `$SPAWN` (the spawn zeroes every `$TMP` token, so one sent earlier is wiped) and before `$TID`. The
        # gun can fire only once `$AMMO` and `$BMAP,0,0` land, and t8 holds hits at 0 damage until the node
        # writes `spawn_protect_off` (engine.js `_armLife`: the first shot or the cap). No `$SIR` row rides
        # here: the table survives `$SPAWN` and death, and `assert_spawn_shielded` refuses one.
        # F206: `$TID` is re-asserted right after every `$SPAWN`. The gun keeps ONE team byte, written by
        # `$TID`, `$TEAM` and `$PSET` t2 alike (V4_31 disassembly, 2026-09-18), and the node writes a
        # `pset_pool` `$PSET` in the same burst as `$SPAWN`. That `$PSET` now carries the team too; this
        # frame is the belt to its braces, and it is what LaserTagMods' own hosted-game path does (a
        # second `$TID` after the gun's start). A live `$TID` write changes hit resolution at once and
        # repaints nothing (bench 2026-09-07), so it is safe after `$SPAWN`.
        spawn = ["$PLAYX,0,*", "$SPAWN,,*", SPAWN_PROTECT_ON, f"$TID,{tid},*"] + ammo + [TRIGGER_LIVE] + play_hled

        # revive = $SPAWN + t8 + $TID + loadout $AMMOs + the trigger row (NO $HLOOP; §1.1 replaces
        # RESPAWN_SEQUENCE). Bench 2026-09-16: the head holds the trigger, and a live resync re-writes the
        # head before it revives, so the revive maps the trigger again too.
        def _revive_for(team: int) -> list[str]:
            # One revive burst per TEAM: the plain `revive` is the arming team's; an infection flip
            # (below) needs the same burst ending on the team the gun has just joined, because the
            # `pset_pool` `$PSET` the node writes before it still carries the ARMING team.
            return ["$SPAWN,,*", SPAWN_PROTECT_ON, f"$TID,{team},*"] + ammo + [TRIGGER_LIVE] + play_hled

        revive = _revive_for(tid)
        assert_trigger_held_until_spawn(head, spawn, revive)

        bundle: FrameBundle = {
            "config_id": config["config_id"],
            "player_id": player["player_id"],
            "head": head,
            "spawn": spawn,
            "revive": revive,
            "spawn_protect_off": SPAWN_PROTECT_OFF,   # F121 rebuild: the node writes it when protection ends
            "end": list(END_SEQUENCE),
            "panic": list(PANIC_SEQUENCE),
            "cues": self.cues(voice, voice_slots, night=night),
            # the swap delay the gun will actually enforce between slots 0 and 1: the larger tok15 of the two
            # (bench 2026-09-04). The HUD's SWITCHING takeover runs for exactly this long.
            "swap_ms": max([int(f.split(",")[16]) for f in head if f.startswith("$WEAP,0,") or f.startswith("$WEAP,1,")] or [850]),
            "callout_team": self._callout_team(teams),   # S57: the IR callout bus's own team id, or None
        }
        # Every registered hit wipes the headset (native flash, then dark; bench 2026-09-03). The
        # node re-sends this after each hit so the team colour is back for the rest of the life.
        # Empty when LEDs are off or the tid has no known headset colour -- the node writes nothing.
        bundle["cues"]["team_led"] = play_hled[0] if play_hled else ""

        # A11: the PRESENTATION profile -- per-event sounds + lights, preset or custom (presentation.py).
        # Cues it names override the fixed table above; `announcer: false` mutes the voice groups but
        # keeps the $SFLASH; `gun_flash: false` empties the LED table; `headset_team: false` drops the
        # team-colour repaint frames added above.
        # A15: every `voice:<role>` sound resolves per PLAYER to that role's line (voices.role_id: the family's
        # slot, or the player's own pick in `voice_slots`) -- the kill line, a boast on respawn, a taunt, …
        voice_map = self._voice_map(voice, voice_slots)
        bundle["voice"] = {"id": voice, "family": _voices.family(voice),
                           "pset": _voices.pset_ids(voice, voice_slots), "kill": (voice_map.get("kill") or [None])[0],
                           "rolled": rolled,                                                   # A15.1: this push's draws
                           "pools": {r: _voices.roll_pool(voice, r) for r in _voices.PSET_ROLES},
                           "spawn": list(voice_map.get("spawn") or []),                       # A15.2: what the node may say at spawn
                           # A15.3: the death scream stays the firmware's but is re-rolled per SPAWN: the node writes
                           # one of `pset_pool` before every $SPAWN. `pset_pool` here = the scream id per frame.
                           "pset_pool": _voices.roll_pool(voice, "death_scream") if "death_scream" not in _voices.check_slots(picks)
                                        else [_voices.check_slots(picks)["death_scream"]],
                           # A15.3: the node picks the pain pool by `$HIR` damage -- at or above this = long pain
                           "pain_long_min": _voices.PAIN_LONG_MIN_DAMAGE}
        frames = _pres.cue_frames(prof, voice_map)
        bundle["cue_pools"] = _pres.cue_pool_frames(prof, voice_map)   # A15.1: the node rolls one per event
        # S12 (Tony, 2026-09-11: "let the config drive it. silenced snipers no grunts could be legit"):
        # `presentation.voice` gates the player's OWN voice lines -- "on" (default) plays both the pain
        # cues and the spawn line; "hits_only" keeps the pain cues but drops the spawn line; "off" drops
        # both. Independent of `announcer` (MC/announcer feedback). The native death scream (`pset_pool`
        # below) and the material hit sounds are UNCHANGED in all three: the scream is firmware, not a
        # `$PLAY`, and a death already gives no position away.
        # `respawned` (`presentation.EVENTS`, source "hud") is the SAME spawn line as `cues.spawn` --
        # engine.js plays `cues.spawn` on the first life and `cues.respawned` on every REVIVE after that
        # (`_spawn`/`_revive`), so it must be dropped alongside `spawn` or every respawn past the first
        # would still speak under "hits_only"/"off".
        voice_switch = prof.get("voice", "on")
        if voice_switch != "on":
            frames.pop("respawned", None)
            bundle["cue_pools"].pop("respawned", None)
        # A15.3: one full $PSET per death-scream take (only the deathScream token differs); the node writes ONE at
        # random immediately before every $SPAWN (spawn and revive) so the firmware's scream changes per life.
        # A17: each take also carries its own draw from the MATERIAL pools (hitHp / hitArrmor /
        # hitShield / hitCrit), so the one write that re-rolls the death scream re-rolls what a hit on
        # each pool sounds like. Variety lands BETWEEN hits; nothing is played over BLE during one.
        bundle["pset_pool"] = gc.pset_frames(pnum, player.get("voice"), picks or None, rng=hits_rng, team=tid)   # F206: t2 = the $TID team
        # F206 GUARD: every $PSET this bundle can write carries the team its $TID frames carry. The node
        # writes one of `pset_pool` in the same burst as every $SPAWN, so a stray 0 here is the whole bug.
        assert_team_byte_consistent(head + spawn + revive + bundle["pset_pool"])
        # A17: the class layer, rolled the same way -- one full $SIR table per take, so the same weapon does
        # not land the same clip all match. Re-sending $SIR rows is the F11 REPAIR path, so this write is
        # bench-safe by construction. `sir_pool` is the ONLY carrier of the real table, so it is never empty:
        # one take of the fixed table (the objective row included) when class sounds are off. The node writes a
        # take when protection ends, but only if the gun's table is not the live one or class sounds are on.
        bundle["sir_pool"] = ([self._with_capture_row(self.sir_table(plan, hits_rng, _cs, stun=stun_enabled(config)))
                               for _ in range(_SIR_TAKES)] if _cs else [list(sir_live)])
        # F312 GUARD: every take keys <15,0>; and under `--bench-capture-row` it is the row the banner names,
        # since a bench result read against the wrong function is worse than no result.
        _cap = self.capture_row()
        for sir_take in bundle["sir_pool"]:
            if ("15", "0") not in _sir_index(sir_take):
                raise ValueError("F312 GUARD: a sir_pool take has no <15,0> row, so the gun cannot report a capture")
            if self.capture_row_fn is not None and _cap not in sir_take:
                raise ValueError(f"F312 GUARD: --bench-capture-row asked for {_cap}, but a take ships another <15,0> row")
        bundle["hit_audio"] = {"rekey": bool(config.get("hit_audio_rekey", False)),
                               "cells": {w: f"{c[0]},{c[1]}" for w, c in plan.cells.items()},
                               "classes": {f"{c[0]},{c[1]}": k for c, (k, _fn) in plan.groups.items()},
                               "shared": list(plan.shared),
                               "material": list(_ha.MATERIAL_ROLES)}
        # The victim node needs the match's dual-emitter shapes to collapse the two words of
        # one trigger for accuracy. Keep the wire cell and magnitudes together; a shared cell
        # is still safe because the magnitude pair distinguishes the dual weapon.
        dual_emitters = []
        for wid in plan.cells:
            row = self.catalog._row(wid)
            headset = (row.get("wire") or {}).get("headset_dmg")
            if headset is None:
                continue
            frame = self.catalog.resolve(wid, 0).split(",")
            cell = plan.cell_for(wid) or self._weapon_cell(wid)
            if cell is None:
                continue
            dual_emitters.append({"proto": int(cell[0] or 0), "subtype": int(cell[1] or 0),
                                  "body": int(frame[self.catalog._T["dmg"] + 1] or 0),
                                  "headset": int(frame[self.catalog._T["headset_dmg"] + 1] or 0),
                                  "cycle_ms": int(self.catalog.cycle_ms(wid) or 0)})
        if dual_emitters:
            bundle["dual_emitters"] = dual_emitters
        # A15.3: the pains are OURS -- the three $PSET pain fields ship empty and the node plays one of these on each
        # $HIR, the pool chosen by damage (proto 13 -> pain_melee; >= pain_long_min -> pain_long; else pain_short).
        if voice_switch != "off":
            for role in ("pain_short", "pain_long", "pain_melee"):
                ids = voice_map.get(role) or []
                if ids:
                    # `ids` truthy means `voice_map[role]` resolves, so play_frame's own lookup always
                    # hits -- but its return type is honest about the general case (an unmatched role
                    # -> None), so guard rather than write a None into a wire field typed str.
                    fr = _pres.play_frame(f"voice:{role}", voice_map)
                    if fr is not None:
                        bundle["cues"][role] = fr
                    if len(ids) > 1:
                        bundle["cue_pools"][role] = [f"$PLAY,,4,6,{i},,,,*" for i in ids]
        # A15.2: the SPAWN LINE is ours. The head's $PSET carries an EMPTY battleRespawnCry (the firmware then says
        # nothing on $SPAWN -- bench 2026-09-06) and the node writes ONE of these right after the spawn / revive
        # frames, a fresh draw per spawn. `cues.spawn` = the first take; `cue_pools.spawn` = the pool when 2+.
        if voice_switch == "on":
            spawn_ids = voice_map.get("spawn") or []
            if spawn_ids:
                fr = _pres.play_frame("voice:spawn", voice_map)
                if fr is not None:
                    bundle["cues"]["spawn"] = fr
                if len(spawn_ids) > 1:
                    bundle["cue_pools"]["spawn"] = [f"$PLAY,,4,6,{i},,,,*" for i in spawn_ids]
        low = frames.pop("low_health", None)
        bundle["cues"].update(frames)
        # low_health is the node's existing `hurt` cue. The default profile now plays the player's OWN
        # hurt loop once at critical health (Tony, 2026-09-06 bench: "good for when the player is at
        # critical health"); Callsign's byte-identical frame ($PLAY,VA8B,3,6) stays only if the profile
        # was explicitly reverted to that sound.
        if low is not None and prof["events"]["low_health"].get("sound") != "VA8B":
            bundle["cues"]["hurt"] = low
        bundle["leds"] = _pres.led_table(prof, tid, night, gc.leds, ffa)
        if not prof.get("headset_team", True):
            bundle["cues"]["team_led"] = ""
            bundle["spawn"] = [f for f in bundle["spawn"] if not f.startswith("$HLED,")]
            bundle["revive"] = [f for f in bundle["revive"] if not f.startswith("$HLED,")]
        # A11.6: the headset table the node drives (pregame / start / in_play rest / hit / death / respawn /
        # role states, §3.3). Team colours for the `infected` role: tid -> the colour PAINTED for that
        # team (`pg.display_colour`, F35/finding #11 -- not the raw tid; green stays green on the wire
        # but paints purple). Filtered to valid team tids (F35: 0-3, `pg.TEAM_TIDS`) -- an out-of-range
        # tid is already rejected earlier (state.py / `validate()`), this is belt-and-braces.
        team_cols = {int(t["tid"]): pg.display_colour(int(t["tid"])) for t in teams if int(t.get("tid", 99)) in pg.TEAM_TIDS}
        bundle["headset"] = _pres.headset_frames(prof, tid, gc.leds, team_cols, ffa, night)
        gun_tbl = _pres.gun_frames(prof, tid, night, gc.leds, ffa, gc.hp, gc.armor, gc.shield)
        if gun_tbl:
            bundle["gun"] = gun_tbl            # A11.7: absent for native (older nodes see nothing new)
        bundle["presentation"] = _pres.summary(config.get("presentation") or _pres.default_for(config.get("mode")))
        if config["mode"] == "infection":
            # move THIS gun to each other team's $TID on death, then re-arm (node emits team_change)
            flip: dict[str, list[str]] = {}
            take: dict[str, list[str]] = {}
            for t in teams:
                if int(t["tid"]) != tid:
                    # F206: the burst ends on the NEW team's `$TID` (see `_revive_for`), and the node
                    # uses this same list for every later revive of a turned player (`engine._revive`).
                    flip[str(t["tid"])] = [f"$TID,{t['tid']},*"] + _revive_for(int(t["tid"]))
                    # F86: `gun.take` (blank + rest) is compiled for the ARMING team, so after a flip the
                    # node's next take -- 2.5 s after the flip's own $SPAWN, and after every later revive --
                    # painted the OLD team's colour back onto a gun the firmware had just moved. The node
                    # picks the take for the team it is on now; this is that table. (The headset is the
                    # `infected` ROLE's job, A16 §3.3, and needs nothing here.)
                    other = _pres.gun_frames(prof, int(t["tid"]), night, gc.leds, ffa, gc.hp, gc.armor, gc.shield)
                    if other:
                        take[str(t["tid"])] = other["take"]
            bundle["team_flip"] = flip
            if take:
                bundle["team_flip_take"] = take
        # 2026-09-19: the respawn profiles. Built from the same ammo and team repaint as the legacy lists above.
        hled_tail = play_hled if prof.get("headset_team", True) else []
        protect_ms, trigger_ms, station_ms = respawn_settings(config.get("respawn"))
        shield_on = shield_frame(station_ms, night) if station_ms and gc.leds else ""
        rp: RespawnProfile = {
            "protect_ms": protect_ms, "trigger_ms": trigger_ms, "station_protect_ms": station_ms,
            # the T-0 spawn is neither profile: everyone goes live AND hittable at go-live, trigger mapped, no t8
            # (Tony, field 2026-09-19). The node writes the live table at T-3, while every trigger is still held.
            "spawn": life_frames(tid, ammo, hled_tail, False, True, lead=["$PLAYX,0,*"]),
            "revive": life_frames(tid, ammo, hled_tail, protect_ms > 0, False, trigger_lead=True),
            "revive_station": life_frames(tid, ammo, hled_tail, station_ms > 0, True, shield_on),
            "trigger_live": TRIGGER_LIVE,
            "shield_on": shield_on,
            # the headset's in-play rest: the team repaint when the game paints one, else dark by colour
            "shield_off": (hled_tail[0] if hled_tail else _pres.HEADSET_DARK) if shield_on else "",
        }
        if config["mode"] == "infection":
            rp["team_flip"] = {str(t["tid"]): [f"$TID,{t['tid']},*"] + life_frames(int(t["tid"]), ammo, hled_tail, protect_ms > 0, False, trigger_lead=True)
                               for t in teams if int(t["tid"]) != tid}
        assert_respawn_profile(rp)
        assert_team_byte_consistent(rp["spawn"] + rp["revive"] + rp["revive_station"])
        bundle["respawn_profile"] = rp
        assert_rearms_every_life(bundle)   # F121: whichever carrier is active, every life gets the real table back
        # S50 build 4: {perk_id, mag/reserve/reload_ms/swap_ms/max_armor/max_shield: {base,resolved}},
        # absent when this player carries no perk — persisted on the bundle (not a one-shot message)
        # so a phone/console icon survives an app restart. `perk_effects_resolved()` is also what
        # `State.snapshot()` reads for the console, so the two can never disagree.
        pe = self.perk_effects_resolved(config, player)
        if pe:
            bundle["perk_effects"] = pe
        # S16: the poison tick numbers for every damage-over-time weapon in THIS game, keyed by IR protocol. It is
        # game-wide (the victim's node needs the SHOOTER's numbers), so it comes off the match plan, not this
        # player's loadout. Absent when the game carries no such weapon, so an older bundle reads the same.
        dot = self.dot_table(plan)
        if dot:
            bundle["dot"] = dot
        assert_no_denied_frames(bundle)   # transport-hardening.md §4: MC never even compiles a frame the node refuses
        return bundle

    def tutorial_frames(self, weapon: Weapon, environment: str) -> list[str]:
        """§4 private try-out: one weapon, identity 0 (uncredited), audible (VOL_TRYOUT). Needs $START + a $TID to
        actually fire (bench 2026-08-25); identity 0 keeps any stray hit off the scoreboard.

        The try-out is a real armed head after its `$CLEAR`, so it uses the same catalogue-driven hit plan
        and conditional rows as a match. A single hard-coded `<0,0>` row left Burst, Breacher, Toxin and
        every other non-`<0,0>` weapon in the A17/F11 silent-drop state during the one path intended to
        prove a new weapon works."""
        wid = weapon["weapon_id"]
        mag, reserve = self.catalog.spawn_ammo(wid)
        plan = self.hit_plan([{"loadout": {"weapons": [{"weapon_id": wid}]}}], rekey=False)
        sir = self.sir_table(plan, None)
        # $PSET,0 = "no identity" (A5.1) so a stray try-out hit reports shooter 0, never credited.
        # F206: token 2 = 1, the same team as the `$TID,1` below (one team byte, last writer wins).
        pset = "$PSET,0,1,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*"
        frames = [
            f"$VOL,{self.tryout_volume()},0,*", "$CLEAR,*", "$START,*",   # $START IS required — bench 2026-08-25: without it the gun
                                                     # spawns but the trigger only reloads, it will not fire IR
            f"$GSET,0,{GSET_T2_SAFE},1,0,1,0,0,1,*",    # FF off; t2 stays safe at every venue; t7 (crit_modifier) matches the GameConfig default of 0 (2026-09-17)
            pset,
            *sir,                                    # every stock row + this weapon's conditional row (Breacher/Toxin/Haze)
            "$TID,1,*",                            # a team is needed to spawn-to-live (identity stays 0 → uncredited)
            self.catalog.resolve(wid, 0, environment=environment),   # the one weapon, slot 0
            "$SPAWN,,*", "$PLAYX,0,*",              # live, then silence the spawn chirp
            f"$AMMO,0,{mag},{reserve},1,*",
            "$BMAP,0,0,,,,,*",
        ]
        assert_sir_follows_clear(frames)
        assert_sir_covers_weapons(frames)
        return frames

    def voice_options(self) -> list[VoiceOption]:
        """The selectable personas (`Session._voice_ids` picks this up to validate a PATCH).

        `$PSET`'s trailing tokens are a positional voice pack and the sound bank carries one for
        every character family; the roster accepted only male/female, so the other ~13 were
        unreachable. Only HEAVY is confirmed by ear — see gameconfig.VOICE_PACKS. `speaker` is the
        catalog's label for the family, `lines` how many lines it carries (voices.options()).
        """
        return [{"id": o["id"], "name": o["name"], "family": o["family"],
                 "speaker": o["speaker"], "lines": o["lines"], "verified": o["verified"],
                 "kill_line": kill_line(o["id"])} for o in _voices.options()]

    @staticmethod
    def _voice_map(voice: str | None, slots: dict | None = None) -> dict[str, list[str]]:
        """`{role: [ids]}` for every `voice:<role>` a presentation event may name (A15) -- the whole POOL,
        default first (A15.1); an explicit pick is a one-id pool."""
        out = {}
        for role in _voices.SOUND_ROLES:
            ids = _voices.role_ids(voice, role, slots)
            if ids:
                out[role] = ids
        return out

    def cues(self, voice: str, slots: dict | None = None, night: bool = False) -> dict[str, str]:
        """A6: pre-composed `$PLAY` frames (node writes verbatim; only $SFLASH/$PLAYX,0 are its own
        templates). Two-slot `$PLAY,<fx>,4,6,<voice>,,,,*`: token1 = SFX, token4 = voice line.
        `slots["kill"]` (A15) replaces the family's kill line. `night` dims the one light here, `hurt_led`
        (led-language.md §3.4: low health is dim at night, token 5 = 1; bench 2026-09-17 found it still at 10)."""
        kill = _voices.role_id(voice, "kill", slots) or kill_line(voice)
        return {
            "countdown": "$PLAY,VA81,4,6,,,,,*",         # confirmed 3-2-1-GO (VA81, slot 1)
            "kill":      f"$PLAY,,4,6,{kill},,,,*",       # confirmed kill line (slot 4, voice-family)
            "game_over": "$PLAY,VA33,4,6,,,,,*",         # CONFIRMED by ear 2026-08-25: "game over" (neutral — a node ending on its own timer does not know the winner)
            "victory":   "$PLAY,VSF,4,6,JAY,,,,*",        # CONFIRMED by ear 2026-08-25: victory sting + "victory" (winners only, MC-sent at recap when in coverage)
            # Victim-side low-health alert, byte-identical to Callsign. Fires once per life shortly
            # after ARMOUR reaches 0 and HP starts dropping — 2 deaths, 2 alerts, both at $HP,34,0,0
            # in 2026-08-23-two-tagger-combat (@340.5s, @361.5s). This, not a per-hit flash, is almost
            # certainly the "headset blinks green" Tony remembered (he flagged his own uncertainty).
            "hurt":      "$PLAY,VA8B,3,6,,,,,*",
            "hurt_led":  f"$HLED,7,4,90,90,{pg.BRIGHT_DIM if night else HEADSET_ALERT_BRIGHTNESS},15,*",
            "tick":      "$PLAY,U16,4,6,,,,,*",             # provisional id; 4,6 required — the empty-token form is SILENT (bench 2026-08-25) SFX tick (real bank id)
            "klaxon":    "$PLAY,U16,4,6,,,,,*",             # provisional id; 4,6 required — the empty-token form is SILENT (bench 2026-08-25)
            "multi":     "$PLAY,,4,6,VA46,,,,*",          # provisional (nRF-native is silent over BLE)
            "medal":     f"$PLAY,,4,6,{kill},,,,*",       # provisional (reuse kill line until pinned)
            "runway_30": "",                              # SILENT for now — VA85 at 30 AND 20 AND 10 stacked the same counting track (bench 2026-08-25); pin distinct lines by ear
            "runway_20": "",                              # SILENT (see runway_30)
            "runway_10": "$PLAY,,4,6,VA85,,,,*",          # provisional
        }

    def voice_preview(self, voice: str, slots: dict | None = None) -> str | None:
        """S39 (field 2026-09-12, Tony): the ONE frame the A9.1 pick-preview plays — that character's
        INTRO line, not their kill line. Picking a voice and hearing it announce a kill says nothing
        about who you just picked; the intro is the character introducing themselves.

        Deliberately NOT a `cues()` entry: `cues()` is compiled into every FrameBundle on the wire (and
        into `golden_bundle.json`, which the phone app's tests read), and a bench preview is not part of
        a match's frame set. Falls back to the kill line for a family with no intro take.
        """
        sid = _voices.role_id(voice, "intro", slots)
        if sid:
            return f"$PLAY,,4,6,{sid},,,,*"
        try:
            return self.cues(voice, slots).get("kill")
        except Exception:
            return None

    def validate(self, config: GameConfig, roster: list[Player],
                 opts: dict | None = None) -> dict:
        """§7 rules → {ok, errors, warnings} (A6: frag-limit-without-coverage is a WARNING).

        **Two coverage opts, deliberately (A28.4).** `coverage` is the DERIVED one MC now computes every
        time it validates (`Session.coverage()`: "full" iff every bound phone is on the tunnel AND reports cellular, F309). `venue_coverage` is the ASSERTED one — a human saying this park has coverage
        everywhere — which nothing sets today. They do different work:

          * either one clears the A6.1 frag-limit warning and makes a frag-limit / survival end authoritative;
          * only `venue_coverage` unlocks `time_limit_s: null`.

        A28.4 is explicit about the asymmetry: a cell signal is less trustworthy than a venue assertion,
        and a phone that loses data mid-match must still hold an end it can reach alone. One opt could
        not express that, so the derived value got the new name and the old one kept its meaning.
        """
        opts = opts or {}
        errors: list[str] = []
        warnings: list[str] = []
        mode = config.get("mode", "tdm")
        try:
            parse_win_by((config.get("scoring") or {}).get("win_by"), "kills")
        except ValueError as exc:
            errors.append(str(exc))
        covered = full_coverage(config, opts)      # A31: one coverage model, `opts` over the venue setting
        asserted = (opts or {}).get("venue_coverage") == "full"   # A28: the explicit venue assertion (the time-limit rule keys on it alone)

        # time limit: required (>0) on the phone path unless a fully-covered venue is asserted
        tl = config.get("time_limit_s")
        if not asserted and (tl is None or tl <= 0):
            errors.append("time_limit_s is required (>0) unless opts.venue_coverage=='full' (A4.8; "
                          "observed backhaul coverage does NOT lift it — A28.4)")

        # player_num: unique + 1..63 across the roster
        nums = [p.get("player_num") for p in roster]
        for n in nums:
            if n is None or not (1 <= int(n) <= MAX_PLAYERS):
                errors.append(f"player_num {n} out of range 1..{MAX_PLAYERS} (0 reserved, A5.1)")
        dupes = {n for n in nums if nums.count(n) > 1}
        if dupes:
            errors.append(f"duplicate player_num across roster: {sorted(dupes)}")

        # team tids unique
        tids = [t["tid"] for t in config.get("teams", [])]
        if len(tids) != len(set(tids)):
            errors.append("duplicate team tid")

        # F35 (bench 2026-09-07): the IR word's team field is 2 bits, so a gun on $TID 4-7 transmits
        # tid&3 while the victim compares its own FULL tid -- teammates on 0-3 vs 4-7 damage each
        # other, and a tid>=4 player's own shots read as a lower team to everyone else. `state.py`'s
        # config sanitizer already rejects this at PUT time; this is belt-and-braces for any config
        # that reaches the compiler another way (a hand-built preset, a test, opts.station_source flows).
        bad_tids = [t for t in tids if not (isinstance(t, int) and not isinstance(t, bool) and t in pg.TEAM_TIDS)]
        if bad_tids:
            errors.append(f"team tid(s) {sorted(set(bad_tids))} outside 0-3 (F35): the IR word's team "
                          f"field is 2 bits -- a $TID of 4 or higher makes teammates damage each other "
                          f"and can let a gun read its own shots as friendly")

        # 🔴 F82: in a hill mode team 2 is NOT a team, it is the value a NEUTRAL grenade
        # broadcasts. A player rostered there reads every uncaptured point as their own: under an
        # enemy-only $SIR row they go deaf to it, and the hill's proto=0 damage word cannot land on
        # them, so they walk onto any neutral point untouched while everyone else is contested.
        # Both inputs are bench-measured (2026-09-10); only the consequence is predicted, and it
        # costs nothing to make impossible — teams 0, 1 and 3 are all free. `DominationEngine`
        # refuses it too; this is the half that says so before the match starts.
        if mode in _OBJECTIVE_MODES:
            tid_of = {t.get("team_id"): t.get("tid") for t in config.get("teams", [])}
            on_neutral = sorted({str(p.get("player_id")) for p in roster
                                 if tid_of.get(p.get("team_id") or "") == _NEUTRAL_TEAM})
            if on_neutral:
                errors.append(
                    f"F82: mode {mode!r} cannot roster players on $TID {_NEUTRAL_TEAM} "
                    f"({', '.join(on_neutral)}), the team a NEUTRAL grenade hill "
                    "broadcasts, so they read every uncaptured point as their own and take no "
                    "hill damage. Use tid 0, 1 or 3.")
            # The EMPTY tid-2 team was the open route (operator review 2026-09-10): the roster scan
            # above passes while nobody is on it, the push succeeds, the Lobby renders it as a drop
            # target and one drag re-pushes `$TID,2`. `state.py` refuses such a config at PUT time;
            # this catches one that arrives another way (a stored preset from before the refusal, the
            # CLI, a fixture) and names the team rather than waiting for a body to be dropped on it.
            neutral_teams = sorted({str(t.get("team_id")) for t in config.get("teams", [])
                                    if t.get("tid") == _NEUTRAL_TEAM})
            if neutral_teams:
                errors.append(
                    f"F82: mode {mode!r} cannot have a team on $TID {_NEUTRAL_TEAM} at all "
                    f"({', '.join(neutral_teams)}), the value a NEUTRAL hill broadcasts, and "
                    "anyone moved onto it later reads every uncaptured point as their own. Use tid 0, 1 or 3.")

        # F97: a hill mode has THREE usable teams, never four. Four tids exist (0-3, F35), a neutral hill
        # broadcasts 2 (F82), so 0 / 1 / 3 are all there is -- a "free-for-all" King of the Hill caps at
        # three players and a fourth must share a team. Refused by count rather than left to the F82
        # message, whose advice ("use tid 0, 1 or 3") is impossible for a fourth single-member team.
        if mode in _OBJECTIVE_MODES:
            distinct = {t.get("tid") for t in config.get("teams", [])}
            if len(distinct) > len(_HILL_TIDS):
                errors.append(
                    f"F97: mode {mode!r} supports at most {len(_HILL_TIDS)} teams (tids "
                    f"{sorted(_HILL_TIDS)}); this config has {len(distinct)}. A neutral hill broadcasts "
                    f"team {_NEUTRAL_TEAM} and the IR team field is 2 bits, so a fourth player has to "
                    "share a team -- an FFA hill caps at three players")

        # A18 (E1): the mode's own rules. `state._merge_config` refuses these at PUT; this is the belt-and-braces
        # for a config that reaches the compiler another way (a fixture, the CLI, a stored preset from before the
        # engine tightened a bound). Unknown keys are an ERROR, not dropped: a knob the engine ignores is a
        # control that does nothing, which is the whole failure mode E1 exists to remove.
        mp = config.get("mode_params")
        if mp is not None:
            if not isinstance(mp, dict):
                errors.append("mode_params must be an object (the mode's own parameters, GET /api/modes .params)")
            else:
                errors.extend(_validate_mode_params(mode, mp)[1])

        # A19 (S10): the VIP must be somebody who is actually playing. A saved game never carries this (a preset
        # names no person), so a stale id here means the player was removed after being named.
        vip = config.get("vip_player_id")
        if vip is not None:
            rostered = {str(p.get("player_id")) for p in roster}
            if not isinstance(vip, str) or vip not in rostered:
                errors.append(f"vip_player_id {vip!r} is not on the roster: pick the VIP from the players in this session")
        elif (config.get("presentation") or {}).get("preset") == "vip":
            warnings.append("VIP profile with no VIP named — set config.vip_player_id or nobody's headset holds the "
                            "white VIP state and vip_hit / vip_down have no subject")

        # ffa ⇒ exactly one team (one $TID); friendly fire is forced on in compile (§2/A5.2)
        if mode == "ffa" and len({t["tid"] for t in config.get("teams", [])}) > 1:
            errors.append("ffa requires a single $TID (one team); identity is $PSET, not $TID (A4.1)")

        # lms ⇔ no auto-respawn (none / finite lives)
        if mode == "lms" and config.get("respawn", {}).get("type") == "auto":
            errors.append("lms cannot use respawn.type=='auto'")
        try:
            respawn_settings(config.get("respawn"))   # 2026-09-19: the protection and weapon-delay options
        except ValueError as e:
            errors.append(str(e))

        # station-gated objective modes need a Tier-1 station/objective source (modes §7).
        # `extraction` is deliberately NOT gated: its objective logic runs MC-side on gun events
        # (modes §2 — coverage-zone gameplay), no IR station required.
        src = station_source_of(config, opts)
        vocab = ", ".join(f"{k!r} ({v})" for k, v in sorted(STATION_SOURCES.items()))
        if mode in _STATION_GATED_MODES:
            if not src:
                errors.append(f"mode {mode!r} needs a station/objective source (Tier 1): set "
                              f"config.station_source to one of: {vocab}")
            elif src not in STATION_SOURCES:
                # This used to be a bare truthiness gate, so any string at all passed -- including a
                # typo, which then shipped a match with nothing on the field emitting its objective.
                errors.append(f"unknown station_source {src!r} for mode {mode!r}: use one of {vocab}")
            elif mode in _OBJECTIVE_MODES:
                # F88: a beacon carries NO station id, so one grenade is indistinguishable from
                # another and the bridge can only ever speak for ONE point. KotH is exactly that;
                # a multi-point Domination on grenades cannot be built at all.
                # ⚠ On the MC path this is UNREACHABLE BY DESIGN and that is not an oversight:
                # `control_points` is deliberately NOT in `state.py` `_CONFIG_KEYS`, so no operator can
                # ask for a second point and `sanitize_config` drops the key out of a saved game. The
                # guard is for the paths that build a GameConfig directly -- the CLI (`__main__`), the
                # sim, a hand-written fixture. Do not "fix" it by wiring the key: multi-point domination
                # is not buildable on grenades at all, and the key would be a control for a mode we
                # cannot ship (operator review 2026-09-10).
                points = config.get("control_points")
                if src == "grenade" and isinstance(points, int) and not isinstance(points, bool) and points > 1:
                    errors.append(
                        f"F88: {points} control points on a grenade source is not buildable, because a hill "
                        "beacon carries no station id, so two grenades in range are indistinguishable "
                        "on the wire and would fight over the same point. Run ONE point (koth), or "
                        "supply a station source that names its point")
                # The physical setup nothing in software can do for the operator, and it is DIFFERENT per
                # source: a grenade must be power-cycled (a hill that starts already-owned banks
                # possession for its old owner from t=0 and skews the match silently; bench 2026-09-10
                # read team 2 = NEUTRAL straight after a power cycle, and a stale owner without one). An
                # IR station is the source we have NEVER had on the bench, so the honest line says so --
                # it used to say nothing at all, and a game saved on `ir_station` pushed clean and
                # silent (operator review 2026-09-10).
                if src == "grenade":
                    warnings.append(
                        "SETUP: POWER-CYCLE THE GRENADE SO IT STARTS NEUTRAL, SET IT TO HILL MODE, AND "
                        "PLACE IT (A HILL THAT STARTS ALREADY OWNED SKEWS THE WHOLE MATCH, AND ONLY A POWER "
                        "CYCLE GUARANTEES NEUTRAL). ONE POINT ONLY (F88)")
                elif src == "phone":
                    # A phone point is NOT power-cycled: arming is what resets it (utility.js
                    # `applyStationConfig` calls `resetPoint()` when the game id changes), so the
                    # checklist is about the app being in the right role and staying awake on the point.
                    warnings.append(
                        "SETUP: THE CONTROL POINT IS A BLUETOOTH STATION (KIND CONTROL; ARMING RESETS THE "
                        "POINT, SO DO NOT POWER-CYCLE IT): CONFIRM IT SHOWS MC-ARMED FOR THIS GAME, KEEP IT "
                        "AWAKE ON THE POINT, AND CHECK ITS BATTERY")
                else:
                    warnings.append(
                        "SETUP: THE IR STATION IS UNPROVEN (WE HAVE NEVER HAD ONE ON THE BENCH, SO NOTHING "
                        "CONFIRMS IT SPEAKS THE PROTOCOL OUR NODES READ): PLACE AND POWER IT, AND CHECK IT READS NEUTRAL BEFORE THE "
                        "WHISTLE, OR USE OBJECTIVE SOURCE PHONE")

        # unknown weapon / perk ids; a perk rides BESIDE a secondary weapon (A14) -- the ALT-button pairing is refused by policy.py before it gets here
        for p in roster:
            lo = p.get("loadout", {}) or {}
            for w in lo.get("weapons", []):
                if w["weapon_id"] not in self.catalog._by_id:
                    errors.append(f"unknown weapon_id {w['weapon_id']!r}")
            perk = lo.get("perk")
            if perk and not self.perks.has(perk):
                errors.append(f"unknown perk_id {perk!r}")

        # A PRIMARY weapon must be able to kill on one magazine: mag >= ceil(pool / dmg).
        # `docs/weapon-design.md` §2.1 — the rail gun and energy launcher shipped at mag 1 needing 2 hits,
        # so a kill cost charge + shot + full reload + charge again. Pool is per-player: loadout overrides
        # win over config health, exactly as `_gset` reads them.
        #
        # F146 (field 2026-09-12) narrowed it three ways, after it blocked two pushes at a real match,
        # and the round-1 polish review of the same day put one slot back:
        #
        #  * **THE PRIMARY SLOT, NOT EVERY EQUIPPED WEAPON.** It ran over the whole loadout, so it
        #    graded a SIDEARM — a backup by definition, carried precisely for the moments the primary
        #    is empty — by the standard of the gun you fight with. "deagle cannot kill on one
        #    magazine: mag 7 < 8 hits" refused a perfectly ordinary sniper + deagle kit.
        #  * **AGAINST THE BASE POOL, NO PERKS, AND THE WEAPON'S OWN MAGAZINE.** Graded against the
        #    perk-armed pool, Body Armor (+50) took the 190-point pool past what any pistol's magazine
        #    can do — so ONE player taking that perk banned every sidearm in the game. The weapon's
        #    design is a fact about the weapon and the host's health setting; what a player straps on
        #    top is not the weapon's fault.
        #  * **WARNING, NOT ERROR — for a weapon the operator cannot fix at the whistle.** The tuning
        #    of a primary against the host's health model is not something they can act on in the
        #    thirty seconds before the game, and as a hard error it stood between them and the
        #    whistle. It names the slot, the weapon and the numbers now, and the push goes through.
        #  * **INCLUDING A SIDEARM CARRIED AS THE ONLY GUN — a warning too, worded for that shape.**
        #    The round-1 review made that case an ERROR; round-2 pass C put it back to a warning, and
        #    the code six lines below is the authority (this bullet said the opposite until round-3
        #    corrected it, 2026-09-13). The A12 exemption is about the SLOT, not the tag:
        #    `policy.PRIMARY_KINDS` admits "sidearm" (`_R_SIDEARM_ONLY` is the copy for it), so a
        #    pistols-only round can put a pistol in slot 1 as somebody's ONLY weapon — and then it is
        #    the gun they fight with, not a backup, which is what `kind` says out loud. A reload still
        #    kills, so nothing here blocks; what is genuinely UNKILLABLE is the `$SIR`/zero-damage gate
        #    below, which passes K and FIELD-4 promoted to the errors this guard was standing in for.
        health = config.get("health") or {}
        seen: set[tuple[str, int, int, str]] = set()
        for p in roster:
            ov = ((p.get("loadout") or {}).get("overrides")) or {}
            hp, armor = ov.get("max_hp", health.get("max_hp")), ov.get("max_armor", health.get("max_armor"))
            if hp is None or armor is None:
                continue                                     # no health model to check against
            # `armed_pool()` — the SAME arithmetic as `_to_gc()` and `Session.health_pool()`, the 255
            # ceiling included — with NO perk id: the base pool this game's health model sets. A
            # per-player OVERRIDE still moves it (that is the host's health model for that player,
            # not something the player strapped on).
            pool = armed_pool(hp, armor)
            ws = (p.get("loadout", {}) or {}).get("weapons", []) or []
            for slot, w in enumerate(ws):
                wid = (w or {}).get("weapon_id")
                if not wid or wid not in self.catalog._by_id:
                    continue                                 # unknown ids already reported above
                sidearm = SIDEARM_TAG in set(self.catalog._by_id[wid].get("tags") or ())
                if slot > 0 and not sidearm:
                    continue                                 # the guard is the PRIMARY slot's (F146)
                # what the weapon is, for THIS player: "only" (the gun they fight with), "primary"
                # (a real primary with a backup behind it) or "backup".
                kind = "backup" if slot > 0 else ("only" if len(ws) == 1 else "primary")
                mag = self.catalog._ammo(wid, None)[0]        # the weapon's OWN magazine, no perk, ROUNDS
                if (wid, pool, mag, kind) in seen:
                    continue
                seen.add((wid, pool, mag, kind))
                htk = self.catalog.hits_to_kill(wid, pool)
                rtk = self.catalog.rounds_to_kill(wid, pool)  # F226/S43: a cell weapon's kill combo costs
                                                                # ROUNDS, not hits -- grade against those
                if not (rtk and mag < rtk):
                    continue
                if sidearm:
                    # Round-2 fix pass C (2026-09-12): a WARNING in EVERY slot, worded for the shape
                    # the kit actually has.
                    #
                    # The round-1 review made a lone sidearm an ERROR ("a main gun that cannot finish a
                    # kill on a magazine is a broken kit"). F146 is the field decision that overrides
                    # that: a guideline never blocks. The operator cannot retune a weapon against the
                    # host's health model in the thirty seconds before the whistle, a reload still
                    # kills, and nothing UNKILLABLE ships either way -- that is the `$SIR` gate below,
                    # which pass K promoted to the error this one was standing in for.
                    #
                    # And the old copy was wrong about the slot. `kind` is "backup" only for slot > 0;
                    # a sidearm in SLOT 0 with a second weapon behind it read "riding beside a
                    # primary", which is exactly backwards -- it IS the primary.
                    what = ("is your only weapon" if kind == "only"
                            else "is your backup" if kind == "backup"
                            else "is the gun you fight with (a sidearm in the PRIMARY slot)")
                    warnings.append(f"{wid} {what} and cannot kill on one magazine at this pool - "
                                    f"it will need a reload (mag {mag} < {rtk} rounds for {htk} hits at "
                                    f"{self.catalog.damage_per_pull(wid)} dmg vs {pool} pool)")
                else:
                    warnings.append(f"PRIMARY {wid.upper().replace('_', ' ')} CANNOT KILL ON ONE MAGAZINE: "
                                    f"mag {mag} < {rtk} rounds for {htk} hits at {self.catalog.damage_per_pull(wid)} dmg "
                                    f"vs a {pool} pool — a reload mid-kill (docs/weapon-design.md §2.1)")

        # Does each loadout weapon's <t3,t4> key a $SIR row that actually DEALS DAMAGE?
        # The mag>=htk invariant above computes on raw t5 and cannot see this: it passed an Energy
        # Launcher (mag 2, htk 1) that lands on $SIR,9,3,,24 — a status row — and deals ZERO damage
        # in every game we ship. Validating the weapon alone is not enough; the effect lives in the
        # (weapon, table) pair. Bench-confirmed 2026-08-26, see docs/ir-effects-design.md §6.2.
        #
        # 🔴 THE FIRST TWO ARE ERRORS (round-2 fix pass K, 2026-09-12). They are the definition of
        # unkillable: a weapon whose <t3,t4> keys no row has every hit silently DROPPED, and one on a
        # `_SIR_NO_POOL` function registers a `$HIR` and moves nothing. Neither can win a match, and
        # neither is reachable by the magazine gate above -- `hits_to_kill` returns 0 for zero damage,
        # so that guard skips such a weapon entirely. The severity ordering used to be inverted: the
        # RELOAD case (a kit that can still win, just slower) was the only error, while these two were
        # advisories pending an Energy Launcher fix.
        #
        # `energy_launcher` is the one shipped row that trips this (its captured word keys $SIR 9,3 =
        # fn 24, a status function), so it is excluded from every POOL (`policy.UNPLAYABLE_IDS`) rather
        # than left as a pickable trap -- no stock pick may be blocked at the whistle (F146). When the
        # bench fixes its row (flatten `_SIR_TABLE` to fn 1, or move the weapon off <9,3>), delete the
        # id from that set. `test_k_no_stock_weapon_and_no_shipped_pool_is_blocked_by_the_new_errors`
        # holds both halves together.
        #
        # The REST stay warnings: a GRANT row heals the target and an armour-piercing one is a
        # balance fact -- both are playable, and both are things the operator may have chosen.
        #
        # S16 (2026-09-19): read the table this ROSTER actually ships, not the permanent base. A weapon
        # may declare its own `sir_fn`, and `sir_table()` then appends its row only in a game that
        # carries it (the Toxin Rifle's <11,0>, and the support cells). Reading `_SIR_TABLE` alone
        # called that row missing and blocked a weapon whose hits the gun registers. The key is the
        # PLAN's cell for the same reason: with `hit_audio_rekey` on, the frame that ships is re-keyed.
        # If the plan cannot be built (F53: a weapon on a cell with no row AND no `sir_fn`), fall back
        # to the base table, so that weapon gets the NO ROW error below instead of a crash here.
        try:
            plan = self.hit_plan(roster, rekey=bool(config.get("hit_audio_rekey", False)))
            sir = _sir_index(self.sir_table(plan, None))
        except ValueError:
            plan, sir = _ha.Plan(), _sir_index(_SIR_TABLE)
        self._validate_distinct_cells(config, roster, plan, warnings)   # F315 (own hunk: the flag's moves and its budget)
        T = self.catalog._T
        # KeyError here is a CODE bug, not bad data — raise loudly rather than letting every
        # weapon `continue` and silently turn the whole guard into a no-op.
        _pi, _si = T["proto"] + 1, T["subtype"] + 1
        flagged: set[str] = set()
        for p in roster:
            for slot, w in enumerate((p.get("loadout", {}) or {}).get("weapons", [])):
                wid = w.get("weapon_id")
                if wid not in self.catalog._by_id or wid in flagged:
                    continue
                # §7.4 PLACEMENT: a weapon the catalogue marks `lethal: false` is deliberately unable to
                # kill (the fn-20 stripper, the fn-23 smoke, both measured 2026-09-18). That is a real
                # design, and the three errors below must not treat it as the accident they were written
                # for. What it may NOT be is a PRIMARY: a player whose primary cannot finish anyone is
                # not playing a hard game, they are holding a broken tagger. Slot 0 is the primary.
                if self.catalog._by_id[wid].get("lethal") is False:
                    if slot == 0:
                        flagged.add(wid)
                        errors.append(
                            f"{wid} cannot kill (lethal: false) and is in the PRIMARY slot. A support "
                            f"weapon belongs in slot 2, where carrying it costs the player their backup "
                            f"gun (weapon-design.md §7.4)")
                    continue
                try:
                    frame = self.catalog.resolve(wid, 0).split(",")
                    key = plan.cell_for(wid) or (frame[_pi] or "0", frame[_si] or "0")
                except (IndexError, ValueError):
                    continue   # a malformed catalog row is another check's problem, not a crash here
                fn = sir.get(key)
                if fn is None:
                    flagged.add(wid)
                    errors.append(f"{wid} keys $SIR {key[0]},{key[1]} with NO ROW in the pushed table, so "
                                  f"every hit is silently dropped (ir-effects-design.md §6.2)")
                elif fn in _SIR_NO_POOL:
                    flagged.add(wid)
                    errors.append(f"{wid} keys $SIR {key[0]},{key[1]} → function {fn}, which registers a "
                                  f"hit but moves no pool: the weapon DEALS NO DAMAGE (ir-effects-design.md §6.2)")
                elif fn not in _SIR_GRANT and not self.catalog.damage(wid):
                    # 🔴 Round-3 FIELD-4 (2026-09-13) — the third door into the same unkillable class.
                    # The two errors above key off the $SIR FUNCTION; a weapon on a perfectly ordinary
                    # DAMAGE row whose own compiled `dmg` is 0 (a catalog row, or an override) still
                    # compiles, still pushes, registers every hit and kills nobody. The magazine gate
                    # cannot see it either -- `hits_to_kill` returns 0 for zero damage, so it skips
                    # such a weapon entirely. GRANT rows (and the no-pool rows caught above) are
                    # exempt: a heal/armour/shield weapon is not MEANT to deal damage.
                    flagged.add(wid)
                    errors.append(f"{wid} deals 0 DAMAGE on $SIR {key[0]},{key[1]} → function {fn}, a "
                                  f"damage row: every hit registers and takes nothing off the pool, so "
                                  f"the weapon cannot kill (ir-effects-design.md §6.2)")
                elif fn in _SIR_GRANT:
                    flagged.add(wid)
                    dual = " (16/17/20/21 are DUAL-POLARITY: they still damage enemies, 17/21 armor-piercing)" \
                           if fn in (16, 17, 20, 21) else ""
                    warnings.append(f"{wid} keys $SIR {key[0]},{key[1]} → function {fn}, a GRANT "
                                    f"(heal/armor/shield): it HEALS an ally it hits{dual} "
                                    f"(ir-effects-design.md §6.2)")
                elif fn in (36, 37):
                    flagged.add(wid)
                    cm = self._to_gc(config, p).crit_modifier
                    mult = headset_multiplier(fn, cm)
                    # 2026-09-17: the default crit_modifier is now 0, so mult is 1.0 for most games —
                    # a headset hit and a gun-body hit are equal, and the old "needs fewer hits than
                    # published" framing would be a wrong claim at that default. Only make it when the
                    # compiled crit_modifier actually scales the headset (mult != 1.0).
                    if mult != 1.0:
                        warnings.append(f"{wid} keys $SIR {key[0]},{key[1]} → function {fn}, a CONFIRMED "
                                        f"HEADSET-ONLY multiplier row: at this game's compiled crit_modifier "
                                        f"({cm}) a headset hit lands floor({mult}x its $WEAP t5); a gun-body "
                                        f"hit lands the raw t5 (x1) (bench 2026-09-11). The published "
                                        f"htk/ttk_ms are the GUN-BODY (guaranteed-kill) number, so an "
                                        f"all-headset kill needs fewer hits than published "
                                        f"(ir-effects-design.md §6.2)")
                    else:
                        warnings.append(f"{wid} keys $SIR {key[0]},{key[1]} → function {fn}, a "
                                        f"HEADSET-ONLY multiplier row: at this game's compiled crit_modifier "
                                        f"({cm}) the multiplier is 1.0x, so a headset hit lands the same as "
                                        f"a gun-body hit (bench 2026-09-11, ir-effects-design.md §6.2)")
                elif fn in _SIR_ARMOR_PIERCING:
                    flagged.add(wid)
                    warnings.append(f"{wid} keys $SIR {key[0]},{key[1]} → function {fn}, ARMOR-PIERCING: it "
                                    f"bypasses armor and shields, so htk is ceil(hp/dmg), not ceil(pool/dmg) "
                                    f"(ir-effects-design.md §6.2)")
                elif fn not in _SIR_PLAIN_DAMAGE:
                    flagged.add(wid)
                    warnings.append(f"{wid} keys $SIR {key[0]},{key[1]} → function {fn}, which is NOT in the "
                                    f"bench-confirmed plain-damage set {sorted(_SIR_PLAIN_DAMAGE)}: its effect "
                                    f"on the victim is uncharacterised (ir-effects-design.md §6.2)")

        # frag-limit on a non-covered venue is a coverage-zone early end, not a guaranteed win (C1/M7)
        scoring = config.get("scoring", {})
        if ((scoring.get("frag_limit") or 0) > 0
                and scoring.get("win_by") in (None, "", "kills") and not covered):
            warnings.append("frag_limit on a non-full-coverage venue is an in-coverage early end only; "
                            "the guaranteed end is time_limit_s (A4.8) — winner is provisional until recap")

        self._validate_stun(config, roster, errors, warnings)   # F15/A20 (own hunk: the stun's shape + its source)
        # §7.3 (bench 2026-09-18): armour piercing ignores the SHIELD as well as the armour -- a victim
        # died with a full 120 shield and full 70 armour standing. So in a shield-only game the shield
        # buys NOTHING against it and the whole fight is the health underneath. At the 30 health the
        # preset used to carry, that is a 0.90 s kill against a plain rifle's 1.60 s, which is a hard
        # counter rather than a trade. The preset now carries 45, but a host sets the health freely
        # (`is_shields_preset` only reads "base armour is zero"), so say it rather than silently
        # shipping a game where one perk beats the entire defensive choice.
        if is_shields_preset(config) and any(
                (p.get("loadout") or {}).get("perk") == "armor_piercing" for p in roster):
            hp = int((config.get("health") or {}).get("max_hp") or 0)
            if hp and hp < _SHIELDS_MIN_HP:
                warnings.append(
                    f"this is a shield-only game ({hp} HP, no armour) and someone carries Armour "
                    f"Piercing, which IGNORES the shield entirely (bench 2026-09-18): the whole fight is "
                    f"the {hp} HP underneath, and the shield buys nothing against it. The Shields preset "
                    f"carries {_SHIELDS_MIN_HP} HP for exactly this reason (weapon-design.md §7.3)")
        return {"ok": not errors, "errors": errors, "warnings": warnings}

    def weapon_catalog(self) -> list[Weapon]:
        return self.catalog.all()

    def perk_catalog(self) -> list[PerkView]:
        """Visible perks (loadout.md §1.2) — `PerkView` rows."""
        return self.perks.all()

# Module singleton + the committed golden bundle other lanes import as their fixture (M10).
_DEFAULT = Compiler()


def default_compiler() -> Compiler:
    return _DEFAULT


def golden_bundle() -> FrameBundle:
    """One canonical bundle (M10) — the shared fixture for M-NODE/M-START/M-MC so no lane hand-rolls
    its own copy. Blue player #7, assault_rifle + shotgun, TDM."""
    config: GameConfig = {
        "config_id": "golden-tdm", "mode": "tdm", "environment": "indoor", "night": False,
        "time_limit_s": 600, "respawn": {"type": "auto", "delay_s": 15},
        "scoring": {"frag_limit": 0, "win_by": "kills"},
        "health": default_health(),
        "teams": [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
                  {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}],
    }
    player: Player = {
        "player_id": "p-golden", "player_num": 7, "display": "REAPER", "team_id": "blue",
        "node_id": None, "gun_id": None, "voice": "male", "ready": True,
        "loadout": {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]},
    }
    return _DEFAULT.compile(config, player, config["teams"])
