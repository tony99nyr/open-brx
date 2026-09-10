"""Tests for `arm_sequence()` / `assert_arm_sequence_complete()` -- the guard against the
2026-09-10 bench incident: a hand-rolled `$CLEAR/$START/$GSET/$PSET/$TID/$SIR/$WEAP/$SPAWN`
sequence spawned a gun that showed HP and armour and looked armed, while the trigger fired
nothing, because it was missing `$AMMO`, missing `$BMAP`, and used `$SPAWN,*` instead of
`$SPAWN,,*`. A fourth real mistake that night -- the weapon loaded into slot 1 (secondary)
instead of slot 0 (primary) -- produces the exact same symptom and is covered too.
"""
import pytest

from brx_mcp.gameconfig import arm_sequence, assert_arm_sequence_complete


def _good_frames():
    return arm_sequence(team=1, player_id=3, weapon="primary")


# -- arm_sequence() itself ---------------------------------------------------------- #

def test_arm_sequence_produces_a_complete_bundle():
    frames = _good_frames()
    assert_arm_sequence_complete(frames)  # must not raise
    assert "$START,*" in frames
    assert any(f.startswith("$AMMO,0,") for f in frames)
    assert any(f.startswith("$AMMO,1,") for f in frames)
    assert any(f.startswith("$BMAP,0,0") for f in frames)
    assert "$SPAWN,,*" in frames
    assert any(f.startswith("$WEAP,0,") for f in frames)
    assert "$TID,1,*" in frames


def test_arm_sequence_order_matches_the_live_driver():
    # config head ($START etc, weapons, $SIR table, $BMAP, LEDs) -> $TID -> $SPAWN sequence,
    # the same order modes/driver.py uses on a real arm.
    frames = _good_frames()
    start_i = frames.index("$START,*")
    tid_i = frames.index("$TID,1,*")
    spawn_i = frames.index("$SPAWN,,*")
    assert start_i < tid_i < spawn_i


def test_extra_sir_rows_land_inside_the_sir_block():
    beacon = "$SIR,15,0,,28,0,0,1,,*"
    frames = arm_sequence(team=1, player_id=3, weapon="primary", extra_sir=(beacon,))
    assert beacon in frames
    bmap_i = min(i for i, f in enumerate(frames) if f.startswith("$BMAP,"))
    assert frames.index(beacon) < bmap_i


def test_weapon_goes_in_slot_0_primary():
    frames = arm_sequence(team=2, player_id=0, weapon="ar")
    assert any(f.startswith("$WEAP,0,") for f in frames)


def test_arm_sequence_reuses_gameconfig_tables_not_copies():
    # the whole point is ONE source of truth -- prove the SIR/BMAP rows in the output are
    # literally the shared tables, not a re-typed duplicate.
    from brx_mcp.gameconfig import _SIR_TABLE, _BMAP
    frames = _good_frames()
    for row in _SIR_TABLE:
        assert row in frames
    for row in _BMAP:
        if row == "$BMAP,0,0,,,,,*":
            continue  # this one is deliberately repeated after $SPAWN, see spawn_frames()
        assert row in frames


# -- the validator: each bench omission must be caught, on its own -------------------- #

def test_missing_start_is_rejected():
    frames = [f for f in _good_frames() if not f.startswith("$START")]
    with pytest.raises(ValueError, match="START"):
        assert_arm_sequence_complete(frames)


def test_missing_ammo_is_rejected():
    frames = [f for f in _good_frames() if not f.startswith("$AMMO,")]
    with pytest.raises(ValueError, match="AMMO"):
        assert_arm_sequence_complete(frames)


def test_missing_bmap_is_rejected():
    frames = [f for f in _good_frames() if not f.startswith("$BMAP,")]
    with pytest.raises(ValueError, match="BMAP"):
        assert_arm_sequence_complete(frames)


def test_wrong_spawn_form_is_rejected():
    # the exact 2026-09-10 mistake: $SPAWN,* (no empty token) instead of $SPAWN,,*
    frames = ["$SPAWN,*" if f == "$SPAWN,,*" else f for f in _good_frames()]
    with pytest.raises(ValueError, match="SPAWN"):
        assert_arm_sequence_complete(frames)


def test_spawn_missing_entirely_is_also_rejected():
    frames = [f for f in _good_frames() if f != "$SPAWN,,*"]
    with pytest.raises(ValueError, match="SPAWN"):
        assert_arm_sequence_complete(frames)


def test_weapon_only_in_secondary_slot_is_rejected():
    # the "Also" mistake from the same session: $WEAP,1 with no $WEAP,0
    frames = [f for f in _good_frames() if not f.startswith("$WEAP,0,")]
    with pytest.raises(ValueError, match="WEAP"):
        assert_arm_sequence_complete(frames)


def test_a_fully_hand_built_partial_arm_is_rejected():
    # roughly what actually got sent at the bench on 2026-09-10: config, SIR, WEAP,0 only
    # (no secondary, no melee), $TID, then $SPAWN,* with no $AMMO and no $BMAP at all.
    frames = [
        "$CLEAR,*", "$START,*", "$GSET,1,0,1,0,1,0,50,1,*",
        "$PSET,3,0,45,70,70,*",
        "$SIR,0,0,,1,0,0,1,,*",
        "$WEAP,0,,100,0,3,9,0,,,,,,,,75,850,36,216,1700,0,9,100,100,275,0,,,R18,*",
        "$TID,1,*",
        "$SPAWN,*",
    ]
    with pytest.raises(ValueError):
        assert_arm_sequence_complete(frames)
