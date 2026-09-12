"""M-MODES — the FrameBundle compiler (docs/spec/modes.md §1.1–§8, contracts §3, A5/A6).

MC-side, pure (no clock, no BLE). Turns a GameConfig + Player + teams into the per-player
`FrameBundle` the node writes VERBATIM. Wraps the frame builders in `gameconfig.py`; the node never
compiles. Implements the `interfaces.Compiler` Protocol.

A6: `cues(voice)` returns **pre-composed `$PLAY` frames** (not bare ids); `validate()` returns
`{ok, errors, warnings}`. A5.1: `player_num` is 1..63 on the wire, 0 reserved (tutorial / unknown).
"""
from __future__ import annotations

import json
import math
import pathlib
from typing import Any

import random as _random

from ..gameconfig import END_SEQUENCE, WEAPON_TAILS, _SIR_TABLE, GameConfig as _GC
from .. import hitaudio as _ha
from ..protocol import PANIC_SEQUENCE
from .perks import PerkCatalog
from .policy import SIDEARM_TAG          # F146: one vocabulary for "this is a backup weapon"
from .types import (MAX_PLAYERS, OBJECTIVE_MODES, STATION_SOURCES, FrameBundle, GameConfig, PerkView,
                    Player, Team, Weapon)
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

VOL_BY_ENV = {"indoor": 80, "outdoor": 90}
VOL_PLAY = VOL_BY_ENV["indoor"]    # unknown venue -> the QUIETER of the two (see play_volume)
VOL_TRYOUT = 69                    # a try-out is fired at ARM'S LENGTH from the player's own head,
                                   # so it keeps the quieter Callsign value (review 2026-08-31).
                                   # The field complaint was about hearing a game across a field.


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

    Skipped when the game has LEDs off: `gc._led_frames()` blanks the GUN for night/blackout play, and
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


def armed_armor(armor: int, fx: dict) -> int:
    """$PSET armor after the body_armor perk's `max_armor_add`, capped at the 255 policy ceiling
    (NOT a device limit -- $PSET pools store past 255 with no wrap, see the note in `_to_gc()`;
    this is our own policy choice). One arithmetic, called wherever the armed armor is needed --
    it drifted into three disagreeing copies once already (review 2026-09-01: a `body_armor`
    player was armed at a 165 pool while a simpler, perk-blind version of the sum graded it at
    115), so `_to_gc()`, `Compiler.validate()`, and `Session.health_pool()` all go through here."""
    return min(255, int(armor) + int(fx.get("max_armor_add") or 0))


def armed_pool(hp: int, armor: int, fx: dict) -> int:
    """hp + `armed_armor()` -- the total pool hits-to-kill math (KIT, ARSENAL, the mag>=htk gate in
    `validate()`) is quoted against. `_to_gc()` needs hp and armor as separate `$PSET` fields, so
    it calls `armed_armor()` directly instead of this."""
    return int(hp) + armed_armor(armor, fx)

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
# `$HIR` sensor field on every hit. See docs/weapon-design.md §6 and brx-protocol.md §5,
# experiment-log/2026-09.md (2026-09-11, bench).
def headset_multiplier(fn: int, crit_modifier: int) -> float:
    """HEADSET-sensor damage multiplier for a $SIR row's function, at the compiled `$GSET`
    criticalShotModifier (t7, 0-100). Bench-confirmed 2026-09-11: fn 36 -> 1 + t7/200 (x1.25 at the
    MC default t7=50), fn 37 -> 1 + 2*t7/100 (x2.0 at t7=50); every other function is unscaled (1.0).
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
_SIR_PLAIN_DAMAGE = frozenset({1, 3, 4, 5, 7, 29, 30, 33, 38})   # 3 added 2026-08-29, see above


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
_OBJECTIVE_SIR_ROW = "$SIR,15,0,,28,0,0,1,,*"

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
# moves no pool, and the REAL table written in the spawn / revive burst, where the gun goes live.
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
#   fn 23     audio suppression: registers, moves no pool, and silences the gun for 6-8 s.
#   fn 24-27  the DELAYED BLAST family: fn 24 applies the word's magnitude as real damage ~4 s AFTER
#             it arrives (bench 2026-09-11). A countdown hit would land in the first seconds of the
#             match. These must never reach a spawn-protection table -- `assert_spawn_protected`.
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


def assert_spawn_protected(head: list[str]) -> None:
    """F121: no `$SIR` row in a HEAD may move a pool. Raises naming the rows that would.

    The head is written at the lobby push and again on every relink and resync, i.e. everywhere the
    player is NOT live. A row here that damages, heals or delay-blasts is a hit the gun takes and the
    match never books."""
    bad = []
    for row, cell in zip(head, _sir_cells(head)):
        if cell == ("", ""):
            continue
        fn = _sir_index([row]).get(cell)
        if fn != _SPAWN_PROTECT_FN:
            bad.append((row, fn))
    if bad:
        raise ValueError(
            "F121 GUARD: this head arms hit reception before the player is live -- a countdown hit "
            "would take real pools off a gun while MC books nothing: "
            + ", ".join(f"{r} (fn {f})" for r, f in bad))


def assert_arms_at_spawn(head: list[str], spawn: list[str]) -> None:
    """F121: every cell the head disarmed MUST be re-armed by the spawn burst. Raises if one is not.

    The failure this guards is F11 wearing a different hat: a cell left on fn 28 for the whole match
    registers every hit from that weapon and takes nothing off, so both ends report healthy while one
    player is immortal."""
    live = {c for c in _sir_cells([f for f in spawn if f.startswith("$SIR")]) if c != ("", "")}
    missing = [c for c in _sir_cells([f for f in head if f.startswith("$SIR")])
               if c != ("", "") and c not in live]
    if missing:
        raise ValueError(
            "F121 GUARD: the spawn frames do not re-arm every cell the head disarmed, so these "
            "weapons would take nothing off this player all match: "
            + ", ".join(f"<{c[0]},{c[1]}>" for c in missing))


def assert_rearms_every_life(bundle) -> None:
    """F121: a REVIVE must put the real table back too. Raises if neither carrier does.

    Two paths write it and exactly one is active per bundle: `revive` carries the rows itself, or (A17
    class sounds) `sir_pool` does -- the node writes one pool take immediately BEFORE `frames.revive`,
    so shipping both would clobber the take's sounds with a fixed draw. The reason this cannot be left
    to "the table is still live from spawn": `engine.js _resyncNotLive` re-writes the HEAD on a live
    node and then revives, so a revive that does not re-arm leaves that player immortal for good."""
    rows = [f for f in bundle.get("revive", []) if f.startswith("$SIR")]
    pool = [t for t in (bundle.get("sir_pool") or []) if t]
    head_cells = [c for c in _sir_cells([f for f in bundle.get("head", []) if f.startswith("$SIR")])
                  if c != ("", "")]
    carriers = ([rows] if rows else []) + [list(t) for t in pool]
    if not carriers:
        raise ValueError("F121 GUARD: no revive path re-arms the $SIR table -- a respawned player "
                         "would register every hit and take nothing off it")
    for take in carriers:
        cells = {c for c in _sir_cells(take) if c != ("", "")}
        missing = [c for c in head_cells if c not in cells and c != ("15", "0")]   # the beacon row is fn 28 in BOTH tables
        if missing:
            raise ValueError(
                "F121 GUARD: a revive $SIR take does not re-arm "
                + ", ".join(f"<{c[0]},{c[1]}>" for c in missing))
# F15 / A20: the host-driven STUN (EMP). The proven chain: a proto-8 IR word -> the victim's `$SIR,8,0,,24` row
# (fn 24 = a STATUS function: `$HIR` fires, pools do not move, the gun plays fn 24's own clip) -> the NODE writes
# `$AMMO,<slot>,0,0,1,*` for its live slots and restores the LIVE counts when `config.stun.duration_s` runs out
# (`engine.js _stun`). The native stun is not relied on (2/5 singles, lasts until death). The cell is the stock
# `<8,0>` row -- the CHARGE RIFLE's plain damage (fn 38) -- so with stun ON, a charge rifle IS the EMP source: it
# stuns and deals no damage (the row's function is the only thing that changes; the sound token is carried over,
# never rewritten -- F43). The other source is a proto-8 station. Shipped ONLY when `config.stun` is present;
# a game without it keeps the stock row byte-for-byte.
_STUN_SIR_ROW = "$SIR,8,0,,24,0,0,1,,*"
_STUN_CELL = ("8", "0")
_STUN_DEFAULT_S = 10
_STUN_MAX_S = 60


def stun_enabled(config) -> bool:
    """`config.stun` present (an object; `{}` = the 10 s default) = the EMP cell is a stun this game."""
    return isinstance(config.get("stun"), dict)


def _with_stun_row(rows: list[str]) -> list[str]:
    """The table with the `<8,0>` cell's function swapped to fn 24, in place (stock order kept, sound token
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


class WeaponCatalog:
    """§3 roster. `resolve(id, slot)` → "$WEAP,<slot>,<tail>"; `spawn_ammo(id)` → (mag, reserve)."""

    def __init__(self, rows: list[dict] | None = None) -> None:
        self._rows = rows if rows is not None else _load_weapons()
        self._by_id = {w["weapon_id"]: w for w in self._rows}

    def all(self) -> list[Weapon]:
        """Visible catalog (hidden melee excluded), as contracts §3 Weapon shape."""
        out: list[Weapon] = []
        for w in self._rows:
            if w.get("hidden"):
                continue
            row: Weapon = {
                "weapon_id": w["weapon_id"], "name": w["name"], "cls": str(w["cls"]),
                "desc": w.get("desc", ""),
                "tags": list(w.get("tags") or []), "role": w.get("role", ""),   # A10 policy vocabulary
                "stats": {"mag": w["mag"], "reserve": w["reserve"], "reload_ms": w["reload_ms"],
                          "dmg": w["dmg"], "rof": w["rof"], "rng": w["rng"],
                          "htk": w.get("htk"), "ttk_ms": w.get("ttk_ms"),   # A10: HITS TO KILL replaces the flat RANGE bar in the UIs
                          # the pool-INDEPENDENT chain the views re-derive htk/ttk from when the host
                          # changes `health` (W2, docs/weapon-design.md §2.5). `dmg` above is a share
                          # of the 115 default and cannot be rescaled; `dmg_hit` is the real magnitude.
                          "dmg_hit": self.damage(w["weapon_id"]),
                          "cycle_ms": self.cycle_ms(w["weapon_id"]),
                          "charged": self._frame_int(w["weapon_id"], "mode") in self._CHARGE_MODES},
                "weap_frame": self.resolve(w["weapon_id"], 0),
                "verified": bool(w.get("verified", False)),
            }
            if w.get("caution"):    # A10: known live problem, human copy
                row["caution"] = w["caution"]
            out.append(row)
        return out

    def _row(self, weapon_id: str) -> dict:
        if weapon_id not in self._by_id:
            raise KeyError(f"unknown weapon_id {weapon_id!r}")
        return self._by_id[weapon_id]

    # doc token positions (protocol-classes.md, cross-checked against 19 captured frames by
    # `python -m brx_mcp.weapmap`). doc tokN == frame.split(",")[N+1] — `put()` adds the +1.
    # idx15 (tok14) is the FIRE INTERVAL — bench-proven 2026-08-26. tok15 is the WEAPON-SWAP DELAY (ms) —
    # bench-proven 2026-09-04 (850 → 1700 doubled the swap, 425 halved it, 100 ran at 100; linear, no floor).
    # The gun applies the LARGER of the two loaded slots' values whichever direction you swap, so a swap
    # perk must scale every slot (docs/archive/bench-weap-tokens-2026-09-04.md).
    _T = {"proto": 3, "subtype": 4, "dmg": 5, "fire": 14, "swap": 15, "mag": 16, "reserve": 17, "reload": 18,
          "mode": 20, "burst": 23, "heat": 24, "snd_fire": 27, "snd_up": 28, "snd_down": 29,
          "rel1": 31, "rel2": 32, "rel3": 33, "noammo": 34, "clipstart": 39, "reserve_half": 40,
          "range": 41}
    # The ammo trio + its two mirrors. `resolve()` owns these — they carry the invariants — so an
    # `overrides` entry may not name one (see `_override_index`).
    _AMMO_TOKENS = frozenset({16, 17, 18, 39, 40})
    # Doc-token positions that protocol-classes.md gives a NAME to. `overrides` may only name one of
    # these — the hard rule is "never write a token we cannot name", and an override is still a write.
    _NAMED = frozenset({0, 2, 3, 4, 5, 6, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
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
    def _mods(mods: dict | None, mag: int, reserve: int, reload_ms: int) -> tuple[int, int, int]:
        """Apply passive-perk knobs (loadout.md §2): `ammo_mult` scales mag + reserve, `reload_mult`
        scales reload_ms. Integers, never below 1 round / 0 ms."""
        if not mods:
            return mag, reserve, reload_ms
        am = float(mods.get("ammo_mult") or 1)
        rm = float(mods.get("reload_mult") or 1)
        return (max(1, int(round(mag * am))), int(round(reserve * am)),
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
        """
        w = self._row(weapon_id)
        mag, reserve, reload_ms = self._mods(mods, int(w["mag"]), int(w["reserve"]), int(w["reload_ms"]))
        if (w.get("capture") or {}).get("frame"):
            reserve = (reserve // 2) * 2
        return mag, reserve, reload_ms

    def resolve(self, weapon_id: str, slot: int, mods: dict | None = None) -> str:
        """`$WEAP` frame for a slot, built from the weapon's OWN captured Callsign frame.

        Every weapon carries `capture.frame` — the real frame Battle Company sent for that gun, pulled
        out of `protocol/captures/raw/` (see `weapons.json._note`). Emitting it verbatim inherits every
        native behaviour we cannot synthesise from a template: the 3-round burst (tok23), bolt/single
        shot, charge, overheat (tok24/35), the per-weapon reload chain, damage type (tok3), reload type
        (tok19) and muzzle flash (tok25/26). On top of that we write ONLY the balance tokens — damage,
        fire interval, and the ammo/reload trio — preserving the two invariants every captured frame
        obeys: `tok39 == tok16` (clip start == max clip) and `tok17 == 2 * tok40`.

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
        if wire.get("dmg") is not None:
            put("dmg", int(wire["dmg"]))
        if wire.get("fire_ms") is not None:
            put("fire", int(wire["fire_ms"]))
        mag, reserve, reload_ms = self._ammo(weapon_id, mods)
        put("mag", mag); put("clipstart", mag)                 # tok39 == tok16
        put("reserve", reserve); put("reserve_half", reserve // 2)   # tok17 == 2 * tok40 (`_ammo` keeps it even)
        put("reload", reload_ms)
        put("swap", self.swap_ms(weapon_id, mods))
        for key, ov in (w.get("overrides") or {}).items():
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
        t7-dependent, superseding the earlier flat x1.25/x2 reading; docs/weapon-design.md §6.2).
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

    def hits_to_kill(self, weapon_id: str, pool: int) -> int:
        """Hits to drop a `pool`-point target (hp + armor) on the GUN BODY, computed on raw t5.

        Armor absorbs at face value and spills into HP (bench §7r). This is the guaranteed-kill number:
        raw t5 IS the gun-body applied damage (bench-confirmed 2026-09-11, `damage()`), so this is
        correct for a body-only kill, not an over-estimate. ⚠ Two things this does not model
        (docs/weapon-design.md §6). First, a `$SIR` multiplier row lands MORE on a HEADSET hit — **fn 36
        lands floor(magnitude x headset_multiplier(36, t7)) and fn 37 lands floor(magnitude x
        headset_multiplier(37, t7))**, t7 = the compiled crit_modifier (bench-confirmed 2026-09-11,
        superseding the earlier flat x1.25/x2 reading) — so an all-headset kill on the five weapons on
        fn 36/37 needs FEWER hits than this method publishes; `validate()` warns on those rows with the
        actual multiplier. Second, the SHIELD pool, which sits above armor and is granted only by an IR
        function-11 event. 0 = damage unknown, caller skips."""
        dmg = self.damage(weapon_id)
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
        """weapons.json `stats.dmg` — the SHARE of `pool` one hit removes, 0-100 (weapons.json `_note`)."""
        return round(100 * self.damage(weapon_id) / pool) if pool > 0 else 0

    def time_to_kill(self, weapon_id: str, pool: int) -> int:
        """ms from the first shot to the killing hit at `pool`, on the GUN BODY; 0 when the weapon
        one-shots. Built on `hits_to_kill()`, so the same gun-body caveat applies: an all-headset kill
        on an fn 36/37 weapon lands sooner than this.

        (htk - 1) cycles, because the first hit costs no wait — EXCEPT on a charge weapon, where the
        first shot has to be charged too, so it is htk cycles. That is the whole reason the Rail Gun
        and the Laser Cannon publish a TTK (1.20 s / 1.50 s) while the Rocket Launcher, equally a
        one-shot kill, publishes 0.00."""
        htk = self.hits_to_kill(weapon_id, pool)
        if not htk:
            return 0
        charged = self._frame_int(weapon_id, "mode") in self._CHARGE_MODES
        return int(round(self.cycle_ms(weapon_id) * (htk if charged else htk - 1)))

    def spawn_ammo(self, weapon_id: str, mods: dict | None = None) -> tuple[int, int]:
        """What the phone's HUD is told the player is carrying — the SAME numbers `resolve()` writes."""
        mag, reserve, _ = self._ammo(weapon_id, mods)
        return mag, reserve


class Compiler:
    """Implements interfaces.Compiler."""

    def __init__(self, catalog: WeaponCatalog | None = None, perks: PerkCatalog | None = None) -> None:
        self.catalog = catalog or WeaponCatalog()
        self.perks = perks or PerkCatalog()

    def _perk_effects(self, player: Player | None) -> dict:
        """The passive knobs of the player's slot-2 perk (loadout.md §1.2/§2); {} when none."""
        pid = ((player or {}).get("loadout") or {}).get("perk")
        return self.perks.effects(pid) if pid else {}

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
        ov = ((player or {}).get("loadout", {}) or {}).get("overrides") or {}   # per-player HP/armor (modes §1.1)
        fx = self._perk_effects(player)
        return _GC(
            mode=config["mode"],
            game_time_s=config["time_limit_s"] or 0,
            respawn_s=config["respawn"]["delay_s"],
            respawns=0 if config["respawn"]["type"] == "none" else None,
            frag_limit=config["scoring"].get("frag_limit") or 0,
            volume=play_volume(config["environment"]),
            outdoor=config["environment"] == "outdoor",
            leds=(led.get("mode", "team") != "off") and not blackout,
            friendly_fire=(config["mode"] == "ffa"),  # FFA needs the gun to register same-$TID hits
            hp=int(ov.get("max_hp", config["health"]["max_hp"])),
            # body_armor perk: +N on $PSET armor (loadout.md §2) — capped at the wire's 255
            # NOTE: 255 is OUR POLICY CEILING, not a device limit. Bench 2026-08-27: $PSET
            # pools are not 8-bit -- armor and HP store and decrement exactly to at least 1000,
            # clamping at zero with no wrap (shield was never measured that far). Keep the cap,
            # but do not "fix" it believing the hardware requires it.
            armor=armed_armor(ov.get("max_armor", config["health"]["max_armor"]), fx),
            alt_reload=bool(fx.get("alt_reload")),          # easy_reload perk: $BMAP,1,97
        )

    @staticmethod
    def _tid(player: Player, teams: list[Team]) -> int:
        by_id = {t["team_id"]: t for t in teams}
        tm = by_id.get(player.get("team_id") or "")
        return int(tm["tid"]) if tm else 0

    def _weapon_ids(self, player: Player) -> tuple[str, str | None]:
        """(primary, secondary-or-None). A10: no silent default secondary — an empty slot 1 is what the host
        asked for (ALT then falls back to reload; hardware-verified, loadout.md §2)."""
        w = player.get("loadout", {}).get("weapons", [])
        primary = w[0]["weapon_id"] if len(w) > 0 else "assault_rifle"
        secondary = w[1]["weapon_id"] if len(w) > 1 else None
        return primary, secondary

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
        if cell not in sir:
            raise ValueError(
                f"F53: weapon {weapon_id!r} fires on IR cell {cell} and the $SIR table has no row for it "
                f"-- add the cell to compile._SIR_TABLE (with the function it needs, not 0) before it ships")
        return _ha.Entry(weapon_id, _ha.class_for(row.get("role"), weapon_id), cell, sir[cell])

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
            return _ha.plan_in_place(entries)
        return _ha.plan(entries, base_cells=_sir_cells(_SIR_TABLE))

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
                            f"they STUN (fn 24, no damage) instead of dealing damage")
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
        fx = self._perk_effects(player)                    # ammo/reload knobs act on the PRIMARY only …
        mods = {k: fx[k] for k in ("ammo_mult", "reload_mult", "switch_mult") if fx.get(k)}
        swap_mods = {k: mods[k] for k in ("switch_mult",) if k in mods}   # … the swap delay must scale on EVERY slot (the gun takes the larger)

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
        if plan is None:
            plan = self.hit_plan([player], rekey=False)
        # head — config, per player, SILENT (no $SPAWN, no $PLAY,VA81); ends with $TID (§1.1)
        head = [f"$VOL,{play_volume(config.get('environment'))},0,*", "$CLEAR,*", "$START,*",
                gc._gset(), gc._pset(pnum, player.get("voice"), voice_slots),   # the voice pack is per-PLAYER (§PSET); A15 slot picks / A15.1 rolls
                self._rekey(self.catalog.resolve(w0, 0, mods), plan.cell_for(w0))]
        if w1:
            head.append(self._rekey(self.catalog.resolve(w1, 1, swap_mods), plan.cell_for(w1)))   # slot 1 only when a secondary exists (A10)
        head.append(self._rekey(self.catalog.resolve("melee", 4, swap_mods), plan.cell_for("melee")))
        bmap = list(gc._bmap())
        if not w1 and not gc.alt_reload:
            # Empty slot 2 (A10 §2): the stock ALT row cycles to slot 1, which we no longer load — an UNVERIFIED
            # button-map state on real guns (brx-opus review 2026-08-27). Cycle only to slot 0 instead, so ALT is a
            # no-op by construction ("alt-fire does nothing"). easy_reload keeps ALT→97. Bench item: FOLLOWUPS "Needs Tony at the bench" (A10a).
            bmap = [("$BMAP,1,100,0,0,99,99,*" if row.startswith("$BMAP,1,") else row) for row in bmap]
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
        if config["mode"] in _OBJECTIVE_MODES:
            sir_live = list(sir_live) + [_OBJECTIVE_SIR_ROW]   # F70/F79: the silent proto-15 beacon row
        # F121/A23: the HEAD carries the same cells DISARMED -- hits register, nothing moves. The real
        # table below rides the spawn and revive bursts, where the player actually goes live.
        sir_pregame = sir_spawn_protected(sir_live)
        head += sir_pregame + bmap + gc._led_frames() + hled + gun_pre + [f"$TID,{tid},*"]   # §1.1: head ends with $TID
        assert_sir_covers_weapons(head)      # A17: no armed weapon may key a cell this head has no row for
        assert_sir_covers_objective(head, config["mode"])   # F79: no objective mode may ship with no way to hear its own beacon
        assert_spawn_protected(head)         # F121: and none of those rows may move a pool before go-live

        pmag, pres = self.catalog.spawn_ammo(w0, mods)
        ammo = [f"$AMMO,0,{pmag},{pres},1,*"]
        if w1:
            smag, sres = self.catalog.spawn_ammo(w1)
            ammo.append(f"$AMMO,1,{smag},{sres},1,*")

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
        # F121/A23: the REAL $SIR table leads the burst, so hit reception is armed by the time `$SPAWN`
        # makes the player live -- and never a moment before. Cells persist, so this is a swap of the
        # head's fn-28 registrars, not an addition (the F11 repair path is the same write).
        spawn = list(sir_live) + ["$PLAYX,0,*", "$SPAWN,,*"] + ammo + ["$BMAP,0,0,,,,,*"] + play_hled
        # revive = $SPAWN + loadout $AMMOs (NO $HLOOP, NO $BMAP — §1.1 replaces RESPAWN_SEQUENCE)
        # F121: the table again, because a revive is not always preceded by a spawn -- `engine.js
        # _resyncNotLive` re-writes the HEAD on a live node and revives from there. Omitted only when
        # A17 class sounds are on: the node writes one `sir_pool` take (a full real table) immediately
        # BEFORE `frames.revive`, and a copy here would clobber that take's sounds with a fixed draw.
        # `assert_rearms_every_life` holds the invariant whichever carrier is active.
        revive_sir = [] if _cs else list(sir_live)
        revive = revive_sir + ["$SPAWN,,*"] + ammo + play_hled
        assert_arms_at_spawn(head, spawn)    # F121: every disarmed cell comes back live at $SPAWN

        bundle: FrameBundle = {
            "config_id": config["config_id"],
            "player_id": player["player_id"],
            "head": head,
            "spawn": spawn,
            "revive": revive,
            "end": list(END_SEQUENCE),
            "panic": list(PANIC_SEQUENCE),
            "cues": self.cues(voice, voice_slots),
            # the swap delay the gun will actually enforce between slots 0 and 1: the larger tok15 of the two
            # (bench 2026-09-04). The HUD's SWITCHING takeover runs for exactly this long.
            "swap_ms": max([int(f.split(",")[16]) for f in head if f.startswith("$WEAP,0,") or f.startswith("$WEAP,1,")] or [850]),
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
        bundle["pset_pool"] = gc.pset_frames(pnum, player.get("voice"), picks or None, rng=hits_rng)
        # A17: the class layer, rolled the same way -- one full $SIR table per take. The node writes one
        # before every $SPAWN and again after a lull, so the same weapon does not land the same clip all
        # match. Re-sending $SIR rows is the F11 REPAIR path, so this write is bench-safe by construction.
        # `_cs` is settled at the top of compile(): it also decides whether `revive` carries the $SIR
        # rows itself (F121) -- exactly one carrier, or the take's sounds get clobbered.
        bundle["sir_pool"] = [self.sir_table(plan, hits_rng, _cs, stun=stun_enabled(config)) for _ in range(_SIR_TAKES)] if _cs else []
        bundle["hit_audio"] = {"rekey": bool(config.get("hit_audio_rekey", False)),
                               "cells": {w: f"{c[0]},{c[1]}" for w, c in plan.cells.items()},
                               "classes": {f"{c[0]},{c[1]}": k for c, (k, _fn) in plan.groups.items()},
                               "shared": list(plan.shared),
                               "material": list(_ha.MATERIAL_ROLES)}
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
                    flip[str(t["tid"])] = [f"$TID,{t['tid']},*"] + revive
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
        assert_rearms_every_life(bundle)   # F121: whichever carrier is active, every life gets the real table back
        return bundle

    def tutorial_frames(self, weapon: Weapon, environment: str) -> list[str]:
        """§4 private try-out: one weapon, identity 0 (uncredited), audible (VOL_TRYOUT). Needs $START + a $TID to
        actually fire (bench 2026-08-25); identity 0 keeps any stray hit off the scoreboard."""
        outdoor = 1 if environment == "outdoor" else 0
        wid = weapon["weapon_id"]
        mag, reserve = self.catalog.spawn_ammo(wid)
        # $PSET,0 = "no identity" (A5.1) so a stray try-out hit reports shooter 0, never credited.
        pset = "$PSET,0,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*"
        return [
            f"$VOL,{VOL_TRYOUT},0,*", "$CLEAR,*", "$START,*",   # $START IS required — bench 2026-08-25: without it the gun
                                                     # spawns but the trigger only reloads, it will not fire IR
            f"$GSET,0,{outdoor},1,0,1,0,50,1,*",   # FF off, env
            pset,
            "$SIR,0,0,,1,0,0,1,,*",                # standard-weapon IR interpretation so a try-out shot registers
            "$TID,1,*",                            # a team is needed to spawn-to-live (identity stays 0 → uncredited)
            self.catalog.resolve(wid, 0),          # the one weapon, slot 0
            "$SPAWN,,*", "$PLAYX,0,*",              # live, then silence the spawn chirp
            f"$AMMO,0,{mag},{reserve},1,*",
            "$BMAP,0,0,,,,,*",
        ]

    def voice_options(self) -> list[dict]:
        """The selectable personas (`Session._voice_ids` picks this up to validate a PATCH).

        `$PSET`'s trailing tokens are a positional voice pack and the sound bank carries one for
        every character family; the roster accepted only male/female, so the other ~13 were
        unreachable. Only HEAVY is confirmed by ear — see gameconfig.VOICE_PACKS. `speaker` is the
        catalog's label for the family, `lines` how many lines it carries (voices.options()).
        """
        return [{**o, "kill_line": kill_line(o["id"])} for o in _voices.options()]

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

    def cues(self, voice: str, slots: dict | None = None) -> dict[str, str]:
        """A6: pre-composed `$PLAY` frames (node writes verbatim; only $SFLASH/$PLAYX,0 are its own
        templates). Two-slot `$PLAY,<fx>,4,6,<voice>,,,,*`: token1 = SFX, token4 = voice line.
        `slots["kill"]` (A15) replaces the family's kill line."""
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
            "hurt_led":  f"$HLED,7,4,90,90,{HEADSET_ALERT_BRIGHTNESS},15,*",
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
        time it validates (`Session.coverage()`: "full" iff every bound player node is connected over
        backhaul). `venue_coverage` is the ASSERTED one — a human saying this park has coverage
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
                    f"({', '.join(on_neutral)}) — that is the team a NEUTRAL grenade hill "
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
                    f"({', '.join(neutral_teams)}) — that is the value a NEUTRAL hill broadcasts, and "
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
                errors.append(f"vip_player_id {vip!r} is not on the roster — pick the VIP from the players in this session")
        elif (config.get("presentation") or {}).get("preset") == "vip":
            warnings.append("VIP profile with no VIP named — set config.vip_player_id or nobody's headset holds the "
                            "white VIP state and vip_hit / vip_down have no subject")

        # ffa ⇒ exactly one team (one $TID); friendly fire is forced on in compile (§2/A5.2)
        if mode == "ffa" and len({t["tid"] for t in config.get("teams", [])}) > 1:
            errors.append("ffa requires a single $TID (one team); identity is $PSET, not $TID (A4.1)")

        # lms ⇔ no auto-respawn (none / finite lives)
        if mode == "lms" and config.get("respawn", {}).get("type") == "auto":
            errors.append("lms cannot use respawn.type=='auto'")

        # station-gated objective modes need a Tier-1 station/objective source (modes §7).
        # `extraction` is deliberately NOT gated: its objective logic runs MC-side on gun events
        # (modes §2 — coverage-zone gameplay), no IR station required.
        src = station_source_of(config, opts)
        vocab = ", ".join(f"{k!r} ({v})" for k, v in sorted(STATION_SOURCES.items()))
        if mode in _STATION_GATED_MODES:
            if not src:
                errors.append(f"mode {mode!r} needs a station/objective source (Tier 1) — set "
                              f"config.station_source to one of: {vocab}")
            elif src not in STATION_SOURCES:
                # This used to be a bare truthiness gate, so any string at all passed -- including a
                # typo, which then shipped a match with nothing on the field emitting its objective.
                errors.append(f"unknown station_source {src!r} for mode {mode!r} — valid values are: {vocab}")
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
                        f"F88: {points} control points on a grenade source is not buildable — a hill "
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
                        "PLACE IT — a hill that starts already owned skews the whole match, and only a "
                        "power cycle guarantees neutral. ONE POINT ONLY (F88: a beacon carries no station id)")
                elif src == "phone":
                    # A phone point is NOT power-cycled: arming is what resets it (utility.js
                    # `applyStationConfig` calls `resetPoint()` when the game id changes), so the
                    # checklist is about the app being in the right role and staying awake on the point.
                    warnings.append(
                        "SETUP: THE CONTROL POINT IS A PHONE — open the app in the UTILITY role, kind "
                        "CONTROL, confirm it shows MC-ARMED for THIS game (arming resets the point; do NOT "
                        "power-cycle it), leave the screen awake on the point, and check its battery. "
                        "Players must be advertising (the HUD does this) or the point counts nobody")
                else:
                    warnings.append(
                        "SETUP: PLACE AND POWER THE IR STATION, AND CHECK IT READS NEUTRAL BEFORE THE "
                        "WHISTLE — ⚠ UNPROVEN: we have never had one on the bench, so nothing confirms it "
                        "speaks the protocol our nodes read. Run the grenade if you want a hill we have measured")

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
        # F146 (field 2026-09-12) narrowed it three ways, after it blocked two pushes at a real match:
        #
        #  * **PRIMARY SLOT ONLY.** It ran over every equipped weapon, so it graded a SIDEARM — which is
        #    a backup by definition, carried precisely for the moments the primary is empty — by the
        #    standard of the gun you fight with. "deagle cannot kill on one magazine: mag 7 < 8 hits"
        #    refused a perfectly ordinary sniper + deagle kit.
        #  * **AGAINST THE BASE POOL, NO PERKS.** Graded against the perk-armed pool, Body Armor (+50)
        #    took the 190-point pool past what any pistol's magazine can do — so ONE player taking that
        #    perk banned every sidearm in the game. The weapon's design is a fact about the weapon and
        #    the host's health setting; what a player straps on top is not the weapon's fault.
        #  * **WARNING, NOT ERROR.** It is a design guideline out of a design doc, and it was standing
        #    between an operator and the whistle with a line they could not act on. It names the slot,
        #    the weapon and the numbers now, and the push goes through.
        health = config.get("health") or {}
        seen: set[tuple[str, int, int]] = set()
        for p in roster:
            ov = ((p.get("loadout") or {}).get("overrides")) or {}
            hp, armor = ov.get("max_hp", health.get("max_hp")), ov.get("max_armor", health.get("max_armor"))
            if hp is None or armor is None:
                continue                                     # no health model to check against
            # `armed_pool()` — the SAME arithmetic as `_to_gc()` and `Session.health_pool()`, the 255
            # ceiling included — with NO perk effects: the base pool this game's health model sets.
            pool = armed_pool(hp, armor, {})
            ws = (p.get("loadout", {}) or {}).get("weapons", []) or []
            wid = (ws[0] or {}).get("weapon_id") if ws else None
            if not wid or wid not in self.catalog._by_id:
                continue                                     # unknown ids already reported above
            if SIDEARM_TAG in set(self.catalog._by_id[wid].get("tags") or ()):
                continue                                     # a sidearm is a backup, never held to this
            mag = self.catalog._ammo(wid, None)[0]           # the base magazine, for the same reason
            if (wid, pool, mag) in seen:
                continue
            seen.add((wid, pool, mag))
            htk = self.catalog.hits_to_kill(wid, pool)
            if htk and mag < htk:
                warnings.append(f"PRIMARY {wid.upper().replace('_', ' ')} CANNOT KILL ON ONE MAGAZINE: "
                                f"mag {mag} < {htk} hits at {self.catalog.damage(wid)} dmg vs a {pool} "
                                f"pool — a reload mid-kill (docs/weapon-design.md §2.1)")

        # Does each loadout weapon's <t3,t4> key a $SIR row that actually DEALS DAMAGE?
        # The mag>=htk invariant above computes on raw t5 and cannot see this: it passed an Energy
        # Launcher (mag 2, htk 1) that lands on $SIR,9,3,,24 — a status row — and deals ZERO damage
        # in every game we ship. Validating the weapon alone is not enough; the effect lives in the
        # (weapon, table) pair. Bench-confirmed 2026-08-26, see docs/weapon-design.md §6.2.
        #
        # ⚠ WARNING-ONLY BY DESIGN, TEMPORARILY. Promote the first two cases to `errors` in the SAME
        # commit that fixes the Energy Launcher (flatten _SIR_TABLE to fn 1, or move the weapon off
        # <9,3>) — at that point a clean pass is achievable. It must not sit here as a permanent
        # warning; the test name records the intent.
        sir = _sir_index(_SIR_TABLE)
        T = self.catalog._T
        # KeyError here is a CODE bug, not bad data — raise loudly rather than letting every
        # weapon `continue` and silently turn the whole guard into a no-op.
        _pi, _si = T["proto"] + 1, T["subtype"] + 1
        flagged: set[str] = set()
        for p in roster:
            for w in (p.get("loadout", {}) or {}).get("weapons", []):
                wid = w.get("weapon_id")
                if wid not in self.catalog._by_id or wid in flagged:
                    continue
                try:
                    frame = self.catalog.resolve(wid, 0).split(",")
                    key = (frame[_pi] or "0", frame[_si] or "0")
                except (IndexError, ValueError):
                    continue   # a malformed catalog row is another check's problem, not a crash here
                fn = sir.get(key)
                if fn is None:
                    flagged.add(wid)
                    warnings.append(f"{wid} keys $SIR {key[0]},{key[1]} — NO ROW in the pushed table, so "
                                    f"every hit is silently dropped (weapon-design.md §6.2)")
                elif fn in _SIR_NO_POOL:
                    flagged.add(wid)
                    warnings.append(f"{wid} keys $SIR {key[0]},{key[1]} → function {fn}, which registers a "
                                    f"hit but moves no pool: the weapon DEALS NO DAMAGE (weapon-design.md §6.2)")
                elif fn in _SIR_GRANT:
                    flagged.add(wid)
                    dual = " (16/17/20/21 are DUAL-POLARITY: they still damage enemies, 17/21 armor-piercing)" \
                           if fn in (16, 17, 20, 21) else ""
                    warnings.append(f"{wid} keys $SIR {key[0]},{key[1]} → function {fn}, a GRANT "
                                    f"(heal/armor/shield): it HEALS an ally it hits{dual} "
                                    f"(weapon-design.md §6.2)")
                elif fn in (36, 37):
                    flagged.add(wid)
                    cm = self._to_gc(config, p).crit_modifier
                    mult = headset_multiplier(fn, cm)
                    warnings.append(f"{wid} keys $SIR {key[0]},{key[1]} → function {fn}, a CONFIRMED "
                                    f"HEADSET-ONLY multiplier row: at this game's compiled crit_modifier "
                                    f"({cm}) a headset hit lands floor({mult}x its $WEAP t5); a gun-body "
                                    f"hit lands the raw t5 (x1) (bench 2026-09-11). The published "
                                    f"htk/ttk_ms are the GUN-BODY (guaranteed-kill) number, so an "
                                    f"all-headset kill needs fewer hits than published "
                                    f"(weapon-design.md §6.2)")
                elif fn in _SIR_ARMOR_PIERCING:
                    flagged.add(wid)
                    warnings.append(f"{wid} keys $SIR {key[0]},{key[1]} → function {fn}, ARMOR-PIERCING: it "
                                    f"bypasses armor and shields, so htk is ceil(hp/dmg), not ceil(pool/dmg) "
                                    f"(weapon-design.md §6.2)")
                elif fn not in _SIR_PLAIN_DAMAGE:
                    flagged.add(wid)
                    warnings.append(f"{wid} keys $SIR {key[0]},{key[1]} → function {fn}, which is NOT in the "
                                    f"bench-confirmed plain-damage set {sorted(_SIR_PLAIN_DAMAGE)}: its effect "
                                    f"on the victim is uncharacterised (weapon-design.md §6.2)")

        # frag-limit on a non-covered venue is a coverage-zone early end, not a guaranteed win (C1/M7)
        if (config.get("scoring", {}).get("frag_limit") or 0) > 0 and not covered:
            warnings.append("frag_limit on a non-full-coverage venue is an in-coverage early end only; "
                            "the guaranteed end is time_limit_s (A4.8) — winner is provisional until recap")

        self._validate_stun(config, roster, errors, warnings)   # F15/A20 (own hunk: the stun's shape + its source)
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
        "health": {"max_hp": 45, "max_armor": 70},
        "teams": [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
                  {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}],
    }
    player: Player = {
        "player_id": "p-golden", "player_num": 7, "display": "REAPER", "team_id": "blue",
        "node_id": None, "gun_id": None, "voice": "male", "ready": True,
        "loadout": {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]},
    }
    return _DEFAULT.compile(config, player, config["teams"])
