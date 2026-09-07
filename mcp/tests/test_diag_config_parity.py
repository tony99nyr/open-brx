"""The diag game must arm a gun the same way a real game does.

`diag/cases.py` says in its own docstring that its frame blocks "mirror mcp/brx_mcp/__main__.py so
the diag game uses the same, hardware-proven config/spawn sequences" and are "kept in sync". They
were not: `CONFIG` carried FIVE of the ten `$SIR` rows -- missing rocket (`$SIR,10,0,X13...`), rail
gun (`$SIR,6,0,H02...`) and all three melee rows.

Why that matters and why nothing caught it: a gun with no matching `$SIR` row does not error. It
silently ignores that IR while reporting alive and healthy -- the F11 shape. So the diagnostic tool
whose entire job is to answer "can this gun be hit?" would report a clean bill of health for a gun
that cannot be hit by a rocket, a rail gun, or any melee weapon. `test_clear_safety.py` cannot catch
it either: `_sir_restored` checks that rows are PRESENT after a `$CLEAR`, not that they are complete,
which is the right check for what it was written for.

A comment saying "kept in sync with X" is a wish. This is the version that fails.
"""
from brx_mcp import gameconfig as G
from brx_mcp.diag import cases as C


def _sir(frames) -> list[str]:
    return [f for f in frames if f.startswith("$SIR,")]


def test_the_diag_config_carries_the_full_sir_table():
    """Every row, not a subset — a missing row is a weapon the diag gun silently cannot be hit by."""
    got, want = _sir(C.CONFIG), list(G._SIR_TABLE)
    missing = [f for f in want if f not in got]
    assert not missing, (
        f"diag/cases.py CONFIG is missing {len(missing)} of {len(want)} $SIR rows, so a diag gun "
        f"silently ignores that IR while reporting healthy (F11): {missing}")


def test_the_diag_sir_table_is_exactly_the_canonical_one_in_order():
    """Not just a superset: the same rows in the same order. `assert_sir_follows_clear` and the
    hardware both care about ordering."""
    assert _sir(C.CONFIG) == list(G._SIR_TABLE), (
        "diag's $SIR rows have diverged from gameconfig._SIR_TABLE in content or order")


def test_the_diag_config_clears_before_it_arms():
    """F11: the rows must FOLLOW the $CLEAR that wipes them, never precede it."""
    frames = list(C.CONFIG)
    clear_at = [i for i, f in enumerate(frames) if f.startswith("$CLEAR")]
    sir_at = [i for i, f in enumerate(frames) if f.startswith("$SIR,")]
    assert clear_at and sir_at, "the diag config should both clear and arm"
    assert max(clear_at) < min(sir_at), "every $SIR row must come AFTER the last $CLEAR"


def test_the_diag_button_map_matches_gameconfig():
    """$BMAP is mandatory or the trigger gives the 'disabled' chirp — the same copy, the same risk."""
    got = [f for f in C.CONFIG if f.startswith("$BMAP,")]
    assert got == list(G._BMAP), "diag's $BMAP block has drifted from gameconfig._BMAP"
