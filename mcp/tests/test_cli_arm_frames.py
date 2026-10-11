"""Pins the bytes the CLI and the diag tool send to a gun, and the CLI/arm_sequence weapon rules.

The golden lists are literal on purpose: they are built from `GameConfig`, so a builder default that
changes (a voice id, a damage token, a $SIR row) must show up here as a failing test and be reviewed,
not slide through a test that repeats the builder expression. Update them only when the wire change is
intended.

DRY review 2026-10-10 #5: the CLI and the diag tool used to hold literal copies of these frames.
"""
import contextlib
import io

from brx_mcp import __main__ as cli
from brx_mcp import gameconfig as gc
from brx_mcp.diag import cases as C
from brx_mcp.mc.compile import WeaponCatalog

GOLDEN_CLI_GAME_CONFIG = [
    '$CLEAR,*',
    '$START,*',
    '$GSET,1,0,1,0,1,0,0,1,*',
    '$PSET,0,0,45,70,70,50,,H44,JAD,VA3,,,,,VA7,H06,,H02,H21,X49,U15,W71,,*',
    '$WEAP,0,,100,0,3,9,0,,,,,,,,75,850,36,216,1700,0,9,100,100,275,0,,,R18,,,,D04,D03,D02,D18,,,,,36,108,75,*',
    '$WEAP,1,2,100,0,0,45,0,,,,,,70,80,900,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,30,*',
    '$WEAP,4,1,90,13,1,90,0,,,,,,,,1000,100,1,0,0,10,13,100,100,,0,0,,M92,,,,,,,,,,,,1,0,20,*',
    '$SIR,0,0,,1,0,0,1,,*',
    '$SIR,0,1,,36,0,0,1,,*',
    '$SIR,0,3,,37,0,0,1,,*',
    '$SIR,8,0,,1,0,0,1,,*',
    '$SIR,9,3,,1,0,0,1,,*',
    '$SIR,10,0,X13,1,0,100,2,60,*',
    '$SIR,6,0,H02,1,0,90,1,40,*',
    '$SIR,13,1,H57,1,0,0,1,,*',
    '$SIR,13,0,H50,1,0,0,1,,*',
    '$SIR,13,3,H49,1,0,100,0,60,*',
    '$SIR,4,0,,2,0,0,1,,*',
    '$BMAP,0,0,,,,,*',
    '$BMAP,1,100,0,1,99,99,*',
    '$BMAP,2,97,,,,,*',
    '$BMAP,3,98,,,,,*',
    '$BMAP,4,98,,,,,*',
    '$BMAP,5,98,,,,,*',
    '$BMAP,8,4,,,,,*',
    '$PLAYX,0,*',
    '$PLAY,VA81,4,6,,,,,*',
]

GOLDEN_DIAG_CONFIG = [
    '$CLEAR,*',
    '$START,*',
    '$GSET,1,0,1,0,1,0,0,1,*',
    '$PSET,0,0,45,70,70,50,,H44,JAD,VA3,,,,,VA7,H06,,H02,H21,X49,U15,W71,,*',
    '$WEAP,0,,100,0,3,9,0,,,,,,,,75,850,36,216,1700,0,9,100,100,275,0,,,R18,,,,D04,D03,D02,D18,,,,,36,108,75,*',
    '$SIR,0,0,,1,0,0,1,,*',
    '$SIR,0,1,,36,0,0,1,,*',
    '$SIR,0,3,,37,0,0,1,,*',
    '$SIR,8,0,,1,0,0,1,,*',
    '$SIR,9,3,,1,0,0,1,,*',
    '$SIR,10,0,X13,1,0,100,2,60,*',
    '$SIR,6,0,H02,1,0,90,1,40,*',
    '$SIR,13,1,H57,1,0,0,1,,*',
    '$SIR,13,0,H50,1,0,0,1,,*',
    '$SIR,13,3,H49,1,0,100,0,60,*',
    '$SIR,4,0,,2,0,0,1,,*',
    '$BMAP,0,0,,,,,*',
    '$BMAP,1,98,,,,,*',
    '$BMAP,2,97,,,,,*',
    '$BMAP,3,98,,,,,*',
    '$BMAP,4,98,,,,,*',
    '$BMAP,5,98,,,,,*',
    '$BMAP,8,4,,,,,*',
]


def test_cli_game_config_is_golden():
    assert cli.GAME_CONFIG == GOLDEN_CLI_GAME_CONFIG
    assert len(cli.GAME_CONFIG) == 27
    assert cli.GAME_SEQUENCE == cli.GAME_CONFIG


def test_diag_config_is_golden():
    assert list(C.CONFIG) == GOLDEN_DIAG_CONFIG
    assert len(C.CONFIG) == 23


def test_cli_sends_its_own_volume_separately():
    assert not any(f.startswith("$VOL,") for f in cli.GAME_CONFIG)
    assert cli.volume_cmd(65) == "$VOL,65,0,*"


def test_sir_follows_clear_and_the_full_table_is_present():
    for frames in (cli.GAME_CONFIG, list(C.CONFIG)):
        gc.assert_sir_follows_clear(frames)
        last_clear = max(i for i, f in enumerate(frames) if f.startswith("$CLEAR"))
        first_sir = min(i for i, f in enumerate(frames) if f.startswith("$SIR,"))
        assert last_clear < first_sir, "every $SIR row must come after the last $CLEAR (F11)"
        assert [f for f in frames if f.startswith("$SIR,")] == list(gc._SIR_TABLE)


def test_diag_loads_one_weap_slot_and_the_inert_alt_row():
    assert len([f for f in C.CONFIG if f.startswith("$WEAP,")]) == 1
    assert "$BMAP,1,98,,,,,*" in C.CONFIG
    assert not any(f.startswith("$BMAP,1,100") for f in C.CONFIG)


def test_cli_weapons_is_the_gameconfig_one():
    assert cli.WEAPONS is gc.WEAPONS
    assert {"ar", "charge", "ar-bench-infinite", "charge-bench-infinite"} <= set(gc.WEAPONS)


def test_default_ar_and_charge_are_the_catalogue_frames_and_ammo():
    cat = WeaponCatalog()
    for name, wid in (("ar", "assault_rifle"), ("charge", "charge_rifle")):
        for slot in (0, 1):
            assert gc.weapon_frame(slot, name) == cat.resolve(wid, slot)
            assert cli.weap(slot, name) == cat.resolve(wid, slot)
        assert gc.weapon_ammo(name) == cat.spawn_ammo(wid)
        frames = gc.arm_sequence(team=1, player_id=1, weapon=name)
        assert cat.resolve(wid, 0) in frames
        mag, res = cat.spawn_ammo(wid)
        assert f"$AMMO,0,{mag},{res},1,*" in frames


def _stderr_of(fn):
    buf = io.StringIO()
    with contextlib.redirect_stderr(buf):
        fn()
    return buf.getvalue()


def test_bench_variants_warn_once_per_build():
    for name in ("ar-bench-infinite", "charge-bench-infinite"):
        out = _stderr_of(lambda: gc.arm_sequence(team=1, player_id=1, weapon=name))
        assert out.count("not a shipped weapon: bench variant with an infinite reserve") == 1, out
        out = _stderr_of(lambda: cli.loadout(name))
        assert out.count("not a shipped weapon: bench variant with an infinite reserve") == 1, out


def test_shipped_weapons_do_not_warn():
    for name in ("primary", "ar", "charge"):
        assert _stderr_of(lambda: gc.arm_sequence(team=1, player_id=1, weapon=name)) == ""
        assert _stderr_of(lambda: cli.loadout(name)) == ""
