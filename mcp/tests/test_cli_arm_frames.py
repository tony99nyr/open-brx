"""The CLI and the diag tool arm a gun with the frames `GameConfig` builds, not with copies.

DRY review 2026-10-10 #5: both held literal `$GSET`/`$PSET`/`$WEAP` copies, and the `$PSET` copies
kept the old voice slots and the shield hum that F347 removed. These tests pin the derivation.
"""
from brx_mcp import __main__ as cli
from brx_mcp import gameconfig as gc
from brx_mcp.diag import cases as C


def test_cli_game_config_is_the_builder_without_the_volume_frame():
    want = [f for f in gc.GameConfig().setup_frames(0, team=0) if not f.startswith("$VOL,")]
    assert cli.GAME_CONFIG == want
    assert cli.GAME_SEQUENCE == cli.GAME_CONFIG


def test_cli_sends_its_own_volume_separately():
    assert not any(f.startswith("$VOL,") for f in cli.GAME_CONFIG)
    assert cli.volume_cmd(65) == "$VOL,65,0,*"


def test_cli_weapons_is_the_gameconfig_one():
    assert cli.WEAPONS is gc.WEAPONS


def test_diag_config_is_the_builder_frames_in_order():
    cfg = gc.GameConfig()
    want = ["$CLEAR,*", "$START,*", cfg._gset(), cfg._pset(0), cfg._weap(0, "primary"),
            *gc._SIR_TABLE,
            *[("$BMAP,1,98,,,,,*" if row.startswith("$BMAP,1,") else row) for row in gc._BMAP]]
    assert list(C.CONFIG) == want
    assert len([f for f in C.CONFIG if f.startswith("$SIR,")]) == len(gc._SIR_TABLE)
    assert len([f for f in C.CONFIG if f.startswith("$WEAP,")]) == 1
    gc.assert_sir_follows_clear(C.CONFIG)
    last_clear = max(i for i, f in enumerate(C.CONFIG) if f.startswith("$CLEAR"))
    first_sir = min(i for i, f in enumerate(C.CONFIG) if f.startswith("$SIR,"))
    assert last_clear < first_sir, "every $SIR row must come after the last $CLEAR (F11)"
