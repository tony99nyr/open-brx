"""Every shipped frame list that sends `$CLEAR` must either restore `$SIR` or be a declared teardown.

F11 (bench-proven 2026-09-02, deterministic 5/5): `$CLEAR` WIPES the `$SIR` table, and unmatched
`$SIR` cells are silently ignored -- so a gun left with no rows discards EVERY incoming hit while
reporting alive, in-game and healthy to `$QUERY`. It presents as a dead headset and is not one.

Leaving a gun unhittable is CORRECT for a teardown or a panic stop, and catastrophic anywhere else.
So the rule is not "never send a bare `$CLEAR`" -- it is "say which one you meant". Anything not on
the allowlist below must restore the table.
"""
import json
import pathlib

from brx_mcp import gameconfig as gc
from brx_mcp.diag import cases as diag
from brx_mcp import protocol
from brx_mcp import __main__ as cli

# Sequences that deliberately leave the gun idle and unhittable. Each needs a reason, because adding
# a name here is exactly how this bug would come back.
INTENTIONAL_TEARDOWNS = {
    "gameconfig.END_SEQUENCE": "game over: the gun should be inert until the next match arms it",
    "protocol.PANIC_SEQUENCE": "panic stop: making the gun unhittable is the POINT",
    "diag.END": "diagnostic teardown between cases",
    "cli.END_SEQUENCE": "CLI teardown",
    "golden_bundle/end": "game over (the bundle MC ships for teardown)",
    "golden_bundle/panic": "panic stop",
    "mc.tryout_teardown": "end of a private try-out: the gun stays idle until the game is pushed",
}


def _sir_restored(frames) -> bool:
    """Is there a `$SIR` row after the LAST `$CLEAR`? Order and presence only -- not count.

    Table SIZE is irrelevant: one row and ten rows both registered 24/24 in an interleaved A/B on
    hardware. Only ABSENCE matters.
    """
    frames = list(frames)
    last_clear = max((i for i, f in enumerate(frames) if f.startswith("$CLEAR")), default=-1)
    if last_clear < 0:
        return True
    return any(f.startswith("$SIR") for f in frames[last_clear + 1:])


def _shipped_sequences():
    out = {
        "gameconfig.setup_frames": list(gc.GameConfig().setup_frames(0)),
        "gameconfig.END_SEQUENCE": list(gc.END_SEQUENCE),
        "gameconfig.RESPAWN_SEQUENCE": list(gc.RESPAWN_SEQUENCE),
        "gameconfig.spawn_frames": list(gc.GameConfig().spawn_frames()),
        "protocol.PANIC_SEQUENCE": list(protocol.PANIC_SEQUENCE),
        "diag.CONFIG": list(diag.CONFIG),
        "diag.END": list(diag.END),
        "cli.GAME_CONFIG": list(cli.GAME_CONFIG),
        "cli.END_SEQUENCE": list(cli.END_SEQUENCE),
    }
    # The private try-out pushes its own bundle to a real gun, so it is in scope. It is also the
    # easiest one to get wrong: it is assembled by hand rather than by setup_frames().
    try:
        from brx_mcp.mc.compile import Compiler
        c = Compiler()
        w = c.weapon_catalog()[0]
        out["compile.tutorial_frames"] = list(c.tutorial_frames(w, "indoor"))
    except Exception:
        pass                      # optional: the compiler needs its catalog, absent in some checkouts
    out["mc.tryout_teardown"] = ["$SPAWN,,*", "$PLAYX,0,*", "$STOP,*", "$CLEAR,*",
                                 "$HLOOP,0,0,*", "$HLED,0,0,0,0,0,0,*"]
    bundle = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp" / "mc" / "golden_bundle.json"
    if bundle.exists():
        d = json.loads(bundle.read_text())
        for k, v in d.items():
            if isinstance(v, list) and v and isinstance(v[0], str):
                out[f"golden_bundle/{k}"] = v
    return out


def test_every_shipped_sequence_either_restores_SIR_or_is_a_declared_teardown():
    offenders = []
    for name, frames in _shipped_sequences().items():
        if _sir_restored(frames):
            continue
        if name in INTENTIONAL_TEARDOWNS:
            continue
        offenders.append(name)
    assert not offenders, (
        "these sequences send $CLEAR with no $SIR after it and are NOT declared teardowns, so they "
        "leave a gun silently unhittable: " + ", ".join(sorted(offenders)))


def test_the_arm_path_specifically_restores_the_table():
    """The one that would end someone's match if it regressed."""
    assert _sir_restored(gc.GameConfig().setup_frames(0))
    assert _sir_restored(list(diag.CONFIG))
    assert _sir_restored(list(cli.GAME_CONFIG))
    try:
        from brx_mcp.mc.compile import Compiler
        c = Compiler()
        assert _sir_restored(c.tutorial_frames(c.weapon_catalog()[0], "indoor")), \
            "a try-out would leave the gun unhittable"
    except ImportError:
        pass


def test_a_respawn_never_clears_the_table_mid_match():
    assert not any(f.startswith("$CLEAR") for f in gc.RESPAWN_SEQUENCE)
    assert not any(f.startswith("$CLEAR") for f in gc.GameConfig().spawn_frames())


def test_every_declared_teardown_still_actually_exists():
    """Stops the allowlist rotting into a licence for sequences nobody ships any more."""
    known = set(_shipped_sequences())
    stale = [n for n in INTENTIONAL_TEARDOWNS if n not in known]
    assert not stale, f"allowlist names sequences that no longer exist: {stale}"


def test_the_checker_can_fail():
    assert not _sir_restored(["$CLEAR,*", "$SPAWN,,*"])
    assert _sir_restored(["$CLEAR,*", "$SIR,0,0,,1,0,0,1,,*"])
    assert not _sir_restored(["$SIR,0,0,,1,0,0,1,,*", "$CLEAR,*"])
