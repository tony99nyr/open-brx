"""Shared bench-rig frames and the connect/disconnect ritual — one copy, not seven.

Closes the polish-loop 2026-08-26 deferred low: "hoist shared PSET/SIR/AR frames + a connect-finally
helper into mcp/tools/bench_common.py (7-file copy-paste drift)". The AR frame lived in five files,
the `$PSET` template in nine and the `$SIR` table in five, and they had already drifted — a bench run
that re-tunes the arming config in one tool and not the others measures two different games and
reports one number. Measurement discipline: the control has to be the same control every time.

These are BENCH frames, deliberately independent of `mcp/brx_mcp/mc/`. A bench tool exists to check
what MC compiles against what the gun actually does, so it must not import the compiler it is
auditing — otherwise a compiler bug arms the victim AND grades the result. Keep them literal.
Nothing here is imported by the server or the tests-under-test; `test_bench_common.py` only pins the
no-drift property.
"""
from __future__ import annotations

import contextlib

# The captured Callsign Assault Rifle at its STOCK 100 ms cycle — the bench reference weapon.
# (MC ships it at 140 ms for balance; a bench run wants the frame Battle Company sent.)
AR = "$WEAP,0,,100,0,0,9,0,,,,,,,,100,850,32,384,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,192,75,*"
# Its three-round-burst sibling, for weapon-swap / pickup probes.
BURST = "$WEAP,0,,100,0,3,9,0,,,,,,,,75,850,36,216,1700,0,9,100,100,275,0,,,R18,,,,D04,D03,D02,D18,,,,,36,108,75,*"

# 45 HP / 70 armour / 70 shield, crit 50 — the GameConfig defaults, so a bench number is comparable
# with a match number. `{pid}` is the player id; call `PSET.format(pid=…)`.
PSET = "$PSET,{pid},0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*"

# The two-sided $SIR function map as bench-measured 2026-08-26 (experiment-log: "the COMPLETE
# two-sided $SIR function map"). ⚠ Rows 36/37 are the DISPUTED multiplier pair — see
# docs/weapon-design.md §6 and compile.py `_SIR_MULTIPLIER`. They are here because they are what the
# bench arms with, not because the scaling is settled.
SIRS = ["$SIR,0,0,,1,0,0,1,,*", "$SIR,0,1,,36,0,0,1,,*", "$SIR,0,3,,37,0,0,1,,*", "$SIR,10,0,X13,1,0,100,2,60,*",
        "$SIR,13,0,H50,1,0,0,1,,*", "$SIR,13,1,H57,1,0,0,1,,*", "$SIR,13,3,H49,1,0,100,0,60,*",
        "$SIR,6,0,H02,1,0,90,1,40,*", "$SIR,8,0,,38,0,0,1,,*", "$SIR,9,3,,24,10,0,,,*"]

# The plain-damage-only table, for a probe that wants one known function and no multiplier rows.
SIR_PLAIN = "$SIR,0,0,,1,0,0,1,,*"

# Game head: FFA off, LEDs on, crit 50. `$GSET` per gameconfig.py.
GSET = "$GSET,0,0,1,0,1,0,50,1,*"
GSET_FF = "$GSET,1,0,1,0,1,0,50,1,*"     # friendly fire ON (same-$TID hits register)


def arming_frames(pid: int, tid: int, *, ff: bool = False, sirs: list[str] | None = None) -> list[str]:
    """The frames every bench tool sends before it measures anything, in order.

    Stops short of `$SPAWN` on purpose: some probes want the weapon written first, some want the
    gun left unspawned. The caller owns the last few frames.
    """
    return (["$VOL,60,0,*", "$CLEAR,*", "$START,*", GSET_FF if ff else GSET, PSET.format(pid=pid)]
            + list(SIRS if sirs is None else sirs) + [f"$TID,{tid},*"])


def sessions_of(mgr):
    """`ConnectionManager`'s per-alias session map, under whichever name this build uses."""
    return next((getattr(mgr, a) for a in ("sessions", "_sessions")
                 if isinstance(getattr(mgr, a, None), dict)), {})


def frames_since(mgr, alias: str, mark: int) -> list[str]:
    """Raw frames the gun has sent since `mark` (see `mark_of`). Empty if the alias is gone."""
    sess = sessions_of(mgr).get(alias)
    if sess is None:
        return []
    out = []
    for e in list(sess.buffer)[mark:]:
        d = e.to_dict() if hasattr(e, "to_dict") else e
        raw = d.get("raw", "")
        if raw:
            out.append(raw)
    return out


def mark_of(mgr, alias: str) -> int:
    sess = sessions_of(mgr).get(alias)
    return len(sess.buffer) if sess is not None else 0


@contextlib.asynccontextmanager
async def connected(mgr, *pairs: tuple[str, str]):
    """`async with connected(mgr, (addr, alias), …):` — connect each, ALWAYS disconnect.

    Every bench tool that lacked this left the gun holding an open BLE link when the probe raised or
    the operator hit ^C, and the next run could not connect until the tagger was power-cycled. The
    teardown suppresses its own errors: the link may already be gone, which is not a failure worth
    masking the real exception with.
    """
    opened: list[str] = []
    try:
        for addr, alias in pairs:
            print(f"connecting {alias}...", flush=True)
            await mgr.connect(addr, alias)
            opened.append(alias)
        yield mgr
    finally:
        for alias in reversed(opened):
            with contextlib.suppress(Exception):
                await mgr.disconnect(alias)
