"""Guards for the two faults found on the bench 2026-09-02.

F11: `$CLEAR` wipes the `$SIR` table, and a gun with no `$SIR` rows silently ignores EVERY hit while
     reporting alive and healthy. Deterministic 5/5 on hardware.
F13: a respawn sent within ~2 s of the kill is never executed by the headset, which sticks in the
     green out-blink while the gun plays on. 1.0/2.0 s stick; 2.5/3.0/6.0 s clean.

These test the real shipped objects, not helpers in isolation -- an earlier fix in this repo passed
its unit tests while being wrong on hardware precisely because the tests exercised a helper.
"""
import inspect

from brx_mcp.gameconfig import (
    MIN_RESPAWN_S, GameConfig, RESPAWN_SEQUENCE, assert_sir_follows_clear,
)


def _raises_f11(frames) -> bool:
    """No pytest here: `run_tests.py` must stay green under system python, which has none."""
    try:
        assert_sir_follows_clear(frames)
    except ValueError as e:
        return "F11 GUARD" in str(e)
    return False


# --- F11 -------------------------------------------------------------------- #

def test_the_shipped_setup_bundle_sends_sir_after_clear():
    """The bundle MC actually sends must satisfy the invariant."""
    frames = GameConfig().setup_frames(0)
    i_clear = max(i for i, f in enumerate(frames) if f.startswith("$CLEAR"))
    i_sir = max(i for i, f in enumerate(frames) if f.startswith("$SIR"))
    assert i_sir > i_clear, "setup_frames sends $CLEAR with no $SIR behind it"


def test_guard_rejects_clear_with_no_sir_after_it():
    assert _raises_f11(["$VOL,80,0,*", "$CLEAR,*", "$START,*", "$SPAWN,,*"])


def test_guard_rejects_sir_that_comes_BEFORE_the_clear():
    # ordering is the whole point: rows sent before $CLEAR are wiped by it
    assert _raises_f11(["$SIR,0,0,,1,0,0,1,,*", "$CLEAR,*", "$SPAWN,,*"])


def test_guard_accepts_a_single_sir_row():
    # table SIZE is irrelevant -- 1 row and 10 rows both registered 24/24 on hardware.
    # Only ABSENCE matters, so the guard must not demand a full table.
    assert_sir_follows_clear(["$CLEAR,*", "$SIR,0,0,,1,0,0,1,,*"])


def test_guard_ignores_bundles_with_no_clear_at_all():
    assert_sir_follows_clear(["$SPAWN,,*", "$AMMO,0,36,108,1,*"])


def test_respawn_sequence_contains_no_clear():
    """A respawn must never wipe the table mid-match."""
    assert not any(f.startswith("$CLEAR") for f in RESPAWN_SEQUENCE)


# --- F13 -------------------------------------------------------------------- #

def test_respawn_delay_is_floored_for_a_dangerously_fast_config():
    cfg = GameConfig(respawn_s=1)          # below the measured 2.0-2.5 s boundary
    assert cfg.respawn_delay(0) >= MIN_RESPAWN_S


def test_the_floor_clears_the_measured_boundary():
    # 2.0 s stuck the headset and 2.5 s did not, so the floor must exceed 2.5
    assert MIN_RESPAWN_S > 2.5


def test_a_normal_respawn_delay_is_left_alone():
    cfg = GameConfig(respawn_s=15)
    assert cfg.respawn_delay(0) == 15


def test_the_ramp_ladder_is_also_floored():
    """Patch the ladder BELOW the floor -- the shipped ladder is 15/30/45/90, so asserting against it
    is unconditionally true and the test passed with the ramp floor deleted entirely."""
    import brx_mcp.gameconfig as gcmod
    cfg = GameConfig(respawn_s=1, respawn_ramp=True)
    src = inspect.getsource(gcmod.GameConfig.respawn_delay)
    assert "max(MIN_RESPAWN_S, ladder[" in src, \
        "the ramped path is not floored -- a short ladder would wedge the headset (F13)"
    assert all(cfg.respawn_delay(i) >= MIN_RESPAWN_S for i in range(5))
