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
from brx_mcp.mc.compile import Compiler, WeaponCatalog
from _session import match_config

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
    assert gc.WEAPONS == ("primary", "secondary", "melee", "ar", "charge",
                          "ar-bench-infinite", "charge-bench-infinite")


# Literal catalogue frames for slot 0, by venue. A catalogue change fails here, not on both sides.
GOLDEN_WEAP = {
    ("ar", "indoor"): "$WEAP,0,,100,0,0,9,0,,,,,,,,100,850,32,192,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,96,75,*",
    ("ar", "outdoor"): "$WEAP,0,,70,0,0,9,0,,,,,,,,100,850,32,192,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,96,75,*",
    ("charge", "indoor"): "$WEAP,0,,100,8,0,70,0,,,,,,,,1250,850,40,80,2500,0,14,100,100,,14,,,E03,C15,C17,,D30,D29,D37,A73,D11,C04,16,150,40,40,75,*",
    ("charge", "outdoor"): "$WEAP,0,,85,8,0,70,0,,,,,,,,1250,850,40,80,2500,0,14,100,100,,14,,,E03,C15,C17,,D30,D29,D37,A73,D11,C04,16,150,40,40,75,*",
}
GOLDEN_AMMO = {"ar": (32, 192), "charge": (40, 80)}
_IDS = {"ar": "assault_rifle", "charge": "charge_rifle"}


def test_default_ar_and_charge_frames_and_ammo_are_golden():
    for (name, env), want in GOLDEN_WEAP.items():
        assert gc.weapon_frame(0, name, outdoor=env == "outdoor") == want
        assert gc.GameConfig(primary=name, outdoor=env == "outdoor")._weap(0, name) == want
    assert cli.weap(0, "ar") == GOLDEN_WEAP[("ar", "indoor")]      # the CLI default venue is indoor
    for name, ammo in GOLDEN_AMMO.items():
        assert gc.weapon_ammo(name) == ammo
        frames = gc.arm_sequence(team=1, player_id=1, weapon=name)
        assert f"$AMMO,0,{ammo[0]},{ammo[1]},1,*" in frames


def test_cli_ar_and_charge_equal_what_the_mc_compiler_ships():
    teams = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
             {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}]
    for (name, env), want in GOLDEN_WEAP.items():
        player = {"player_id": "p7", "player_num": 7, "display": "REAPER", "team_id": "blue",
                  "node_id": None, "gun_id": None, "voice": "male", "ready": True,
                  "loadout": {"weapons": [{"weapon_id": _IDS[name]}]}}
        cfg = dict(match_config("tdm", frag=0, time_limit_s=600, led=None, teams=teams), environment=env)
        head = Compiler().compile(cfg, player, teams)["head"]
        assert [f for f in head if f.startswith("$WEAP,0,")] == [want], (name, env)
        assert WeaponCatalog().spawn_ammo(_IDS[name]) == GOLDEN_AMMO[name]


def _stderr_of(fn):
    buf = io.StringIO()
    with contextlib.redirect_stderr(buf):
        fn()
    return buf.getvalue()


def test_bench_variants_warn_once_per_process_per_variant():
    msg = "not a shipped weapon: bench variant with an infinite reserve"
    for name in ("ar-bench-infinite", "charge-bench-infinite"):
        gc._warned_variants.discard(name)
        out = _stderr_of(lambda: gc.arm_sequence(team=1, player_id=1, weapon=name))
        assert out.count(msg) == 1 and name in out, out
        again = _stderr_of(lambda: (gc.arm_sequence(team=1, player_id=1, weapon=name), cli.loadout(name)))
        assert again == "", again
        gc._warned_variants.discard(name)
        assert _stderr_of(lambda: cli.loadout(name)).count(msg) == 1


def test_shipped_weapons_do_not_warn():
    for name in ("primary", "ar", "charge"):
        assert _stderr_of(lambda: gc.arm_sequence(team=1, player_id=1, weapon=name)) == ""
        assert _stderr_of(lambda: cli.loadout(name)) == ""
