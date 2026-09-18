"""Traffic patterns for `python -m brx_mcp soak` (docs/bench-screamers-2026-09-19.md, Phase C).

A pattern is DATA, not code: one arm sequence (`once`) sent at the start, plus zero or more
`ScheduledFrames` groups that fire on their own cadence for the rest of the run. Add a new pattern by
adding an entry to `PATTERNS`, and nothing else in the soak tool needs to change.

Every frame here is a byte-for-byte reuse of a real frame from elsewhere in the codebase (cited frame
by frame below). This module invents no new wire content, only the schedule.

⚠️ HANG LIST. `$DPLAY` locks a gun when the sound it names loops (bench-screamers-2026-09-19.md, A1:
`$DPLAY,A10,4,*`, the shield loop). Phase A sends hang-list frames by hand with an explicit confirm.
This module must never let one reach a pattern, because the soak tool runs unattended for hours. If a
future trigger is confirmed by Phase A, add its command name here. This list must eventually merge
with the node's own never-send list (`app/src/brxlink.js`, docs/bench-screamers-2026-09-19.md Phase B
row 1), so the same hang list backs both the node and this instrument.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .. import protocol
from ..__main__ import GAME_CONFIG, volume_cmd
from ..gameconfig import RESPAWN_SEQUENCE, _SIR_TABLE

# See the module docstring. Command names only (protocol.command_name() strips $/tokens).
HANG_LIST = frozenset({"DPLAY"})


@dataclass(frozen=True)
class ScheduledFrames:
    """One repeating traffic event inside a pattern.

    `every_s` is the cadence: the group fires, then waits `every_s` before firing again. `every_s ==
    0` means "fire again immediately": a continuous burst, for `burst-short`/`burst-weap`. `frames`
    is sent in order, one write per frame, every time the group fires.
    """
    name: str
    every_s: float
    frames: tuple[str, ...]


@dataclass(frozen=True)
class SoakPattern:
    name: str
    description: str
    once: tuple[str, ...] = ()
    repeating: tuple[ScheduledFrames, ...] = field(default_factory=tuple)


def _all_frames(pattern: SoakPattern) -> list[str]:
    out = list(pattern.once)
    for g in pattern.repeating:
        out.extend(g.frames)
    return out


def assert_pattern_is_safe(pattern: SoakPattern) -> None:
    """Refuses a pattern that carries a hang-list frame, or a frame outside the protocol's own
    known-safe command list (`protocol.KNOWN_SAFE_COMMANDS`): the same rail the rest of the CLI
    already enforces before a frame reaches a gun unattended."""
    for cmd in _all_frames(pattern):
        name = protocol.command_name(cmd)
        if name in HANG_LIST:
            raise ValueError(f"pattern {pattern.name!r} carries a hang-list frame: {cmd!r}")
        if not protocol.is_known_safe(cmd):
            raise ValueError(f"pattern {pattern.name!r} carries a frame outside "
                             f"KNOWN_SAFE_COMMANDS (needs explicit confirm, not a soak): {cmd!r}")


# --------------------------------------------------------------------------------------------- #
# Shared building blocks, each cited to where it is proven / already shipped.
# --------------------------------------------------------------------------------------------- #

# The arm sequence: byte-identical to what `python -m brx_mcp deathmatch`/`startgame` already send.
# GAME_CONFIG (brx_mcp/__main__.py: $CLEAR/$START/$GSET/$PSET/$WEAP x3/the $SIR table/$BMAP/countdown)
# plus RESPAWN_SEQUENCE's spawn half (gameconfig.py SPAWN_SEQUENCE: $SPAWN/$AMMO x2/$BMAP,0,0). This
# is "the arm sequence compiled by the existing CLI/gameconfig path the play/deathmatch commands use"
# per the plan doc, reused verbatim, not re-derived.
from ..gameconfig import SPAWN_SEQUENCE as _SPAWN_SEQUENCE  # noqa: E402

_ARM_SEQUENCE: tuple[str, ...] = (volume_cmd(65), *GAME_CONFIG, *_SPAWN_SEQUENCE)

# Per-hit reaction cues: byte-identical to `mc/compile.py` `Compiler.cues()`'s "hurt"/"hurt_led"
# entries (the victim-side low-health alert, confirmed by ear 2026-08-25, compile.py ~L1963-1968).
# HEADSET_ALERT_BRIGHTNESS (compile.py) is 10.
_HIT_CUE: tuple[str, ...] = ("$PLAY,VA8B,3,6,,,,,*", "$HLED,7,4,90,90,10,15,*")

# The transient gun-body LED readout frame: format + brightness token confirmed on hardware
# 2026-09-02 (mc/compile.py ~L48-53: token 5 on $GLED is brightness, two levels above off), example
# frame lifted verbatim from the official-app connect ritual __main__.py `_diag()` steps ("LEDs
# GREEN?"). A real bundle computes this from `mc/presentation.py gun_readout()`; this is one
# representative frame from that family, sent on `gun_readout()`'s own default cadence
# (GUN_READOUT_DEFAULT hold_s=4, gameconfig.py ~L383).
_LED_READOUT: tuple[str, ...] = ("$GLED,1,0,1,0,10,,*",)

# A revive: the $SIR table re-sent before $SPAWN (mc/compile.py ~L1757-1761: "the node writes one
# pool take immediately BEFORE frames.revive" / "revive = revive_sir + [$SPAWN,,*] + ammo + ...",
# so the SIR rows precede the spawn burst), then RESPAWN_SEQUENCE ($HLOOP,0,0,* / $SPAWN,,*,
# gameconfig.py L301). Cadence: "a revive every 3 minutes" is the plan doc's own traffic definition
# (bench-screamers-2026-09-19.md, Phase C `match`), not a derived number.
_REVIVE_INTERVAL_S = 180.0
_REVIVE: tuple[str, ...] = (*_SIR_TABLE, *RESPAWN_SEQUENCE)

# The captured primary weapon's own $WEAP frame (GAME_CONFIG, __main__.py): 105 bytes on the wire,
# close to the plan doc's "~101 bytes" estimate (its number was rounded; this is the actual captured
# frame, reused rather than re-typed).
_WEAP_FRAME = next(f for f in GAME_CONFIG if f.startswith("$WEAP,0,"))
assert len(_WEAP_FRAME) >= 100, "burst-weap wants the long captured $WEAP frame, not a short one"


# --------------------------------------------------------------------------------------------- #
# Cadence assumptions. ASSUMPTION markers are exactly that: nobody has bench-measured a real
# hit-rate yet. Phase A/C bench sessions should correct these once real numbers exist.
# --------------------------------------------------------------------------------------------- #

# ASSUMPTION: a moderate firefight cadence, one incoming-hit reaction roughly every 10 s during an
# active life. Not bench-measured; documented here so a future run can correct it against real data.
_HIT_INTERVAL_S = 10.0
_LED_INTERVAL_S = 4.0   # GUN_READOUT_DEFAULT hold_s (gameconfig.py): the readout's own refresh hold


def _match_pattern(name: str, description: str, rate: float) -> SoakPattern:
    """`match` and `match-x10` share one shape; `rate` divides every interval (10 = ten times as
    fast, the plan doc's own margin test)."""
    return SoakPattern(
        name=name, description=description, once=_ARM_SEQUENCE,
        repeating=(
            ScheduledFrames("hit-cue", _HIT_INTERVAL_S / rate, _HIT_CUE),
            ScheduledFrames("led-readout", _LED_INTERVAL_S / rate, _LED_READOUT),
            ScheduledFrames("revive", _REVIVE_INTERVAL_S / rate, _REVIVE),
        ),
    )


# ASSUMPTION (callsign): Callsign's host relays game traffic to every gun (bench-screamers plan,
# "What we think causes it"), so a 20-player lobby's hit-cue traffic all reaches THIS one gun, not
# just this player's own hits. Modelled as `match`'s per-player hit-cue cadence (one hit every 10 s)
# times 20 players, i.e. a hit-cue every 10/20 = 0.5 s. The LED readout and revive are per-OWN-life
# events, not relayed by the host, so they keep `match`'s own cadence, unscaled. Nobody has captured
# a real Callsign 20-player session to check this against (the plan's own Phase A asks Jay for one if
# Phase A finds nothing): treat these numbers as a starting point, not a measurement.
_CALLSIGN_PLAYERS = 20

PATTERNS: dict[str, SoakPattern] = {
    "match": _match_pattern(
        "match", "our real per-gun match traffic: arm, then per-hit cues, an LED readout, "
        "and a $SIR-table revive every 3 minutes", rate=1.0),
    "match-x10": _match_pattern(
        "match-x10", "match, at ten times the rate: the margin test", rate=10.0),
    "callsign": SoakPattern(
        name="callsign",
        description=f"a Callsign-like relayed load for {_CALLSIGN_PLAYERS} players "
                    "(ASSUMPTION: see module docstring)",
        once=_ARM_SEQUENCE,
        repeating=(
            ScheduledFrames("relayed-hit-cue", _HIT_INTERVAL_S / _CALLSIGN_PLAYERS, _HIT_CUE),
            ScheduledFrames("led-readout", _LED_INTERVAL_S, _LED_READOUT),
            ScheduledFrames("revive", _REVIVE_INTERVAL_S, _REVIVE),
        ),
    ),
    "burst-short": SoakPattern(
        name="burst-short",
        description="100 short frames with no gap, repeated for the run (bench-screamers A7)",
        once=_ARM_SEQUENCE,
        repeating=(ScheduledFrames("burst", 0.0, tuple(["$PING,*"] * 100)),),
    ),
    "burst-weap": SoakPattern(
        name="burst-weap",
        description="50 x the captured ~101-byte $WEAP frame with no gap, repeated for the run "
                    "(bench-screamers A8)",
        once=_ARM_SEQUENCE,
        repeating=(ScheduledFrames("burst", 0.0, tuple([_WEAP_FRAME] * 50)),),
    ),
}

for _p in PATTERNS.values():
    assert_pattern_is_safe(_p)
