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

# The default CLI arm (tdm, outdoor, volume 65): MC's compiled head plus the CLI additions.
GOLDEN_CLI_ARM_OUTDOOR = [
    '$VOL,65,0,*',
    '$CLEAR,*',
    '$START,*',
    '$GSET,0,0,1,0,1,0,0,1,*',
    '$PSET,1,1,45,70,0,50,,H44,JAD,VA3,,,,,VA7,H06,,H02,H21,X49,U15,W71,,*',
    '$WEAP,0,,70,0,3,10,40,,,,,,,,75,850,36,216,1700,0,9,100,100,540,0,,,R18,,,,D04,D03,D02,D18,,,,,36,108,75,*',
    '$WEAP,1,2,30,0,0,20,0,,,,,,20,100,700,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,100,*',
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
    '$SIR,15,0,,28,0,0,1,,*',
    '$BMAP,0,98,,,,,*',
    '$BMAP,1,100,0,1,99,99,*',
    '$BMAP,2,97,,,,,*',
    '$BMAP,3,98,,,,,*',
    '$BMAP,4,98,,,,,*',
    '$BMAP,5,98,,,,,*',
    '$BMAP,8,4,,,,,*',
    '$HLED,1,0,,,10,,*',
    '$GLED,1,1,1,0,10,,*',
    '$TID,1,*',
    '$PLAYX,0,*',
    '$PLAY,VA81,4,6,,,,,*',
]

GOLDEN_CLI_ARM_INDOOR = [
    '$VOL,65,0,*',
    '$CLEAR,*',
    '$START,*',
    '$GSET,0,0,1,0,1,0,0,1,*',
    '$PSET,1,1,45,70,0,50,,H44,JAD,VA3,,,,,VA7,H06,,H02,H21,X49,U15,W71,,*',
    '$WEAP,0,,100,0,3,10,40,,,,,,,,75,850,36,216,1700,0,9,100,100,540,0,,,R18,,,,D04,D03,D02,D18,,,,,36,108,75,*',
    '$WEAP,1,2,100,0,0,20,0,,,,,,20,100,700,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,100,*',
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
    '$SIR,15,0,,28,0,0,1,,*',
    '$BMAP,0,98,,,,,*',
    '$BMAP,1,100,0,1,99,99,*',
    '$BMAP,2,97,,,,,*',
    '$BMAP,3,98,,,,,*',
    '$BMAP,4,98,,,,,*',
    '$BMAP,5,98,,,,,*',
    '$BMAP,8,4,,,,,*',
    '$HLED,1,0,,,10,,*',
    '$GLED,1,1,1,0,10,,*',
    '$TID,1,*',
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


def test_cli_default_arm_is_the_outdoor_head_golden():
    assert cli.arm_frames(volume=65) == GOLDEN_CLI_ARM_OUTDOOR
    assert cli.arm_frames(volume=65, venue="outdoor") == GOLDEN_CLI_ARM_OUTDOOR
    assert len(GOLDEN_CLI_ARM_OUTDOOR) == 32
    assert "$GSET,0,0,1,0,1,0,0,1,*" in GOLDEN_CLI_ARM_OUTDOOR         # TDM: friendly fire off, as MC writes it


def test_cli_indoor_arm_is_golden_and_differs_only_in_the_range_tokens():
    assert cli.arm_frames(volume=65, venue="indoor") == GOLDEN_CLI_ARM_INDOOR
    diff = [i for i, (a, b) in enumerate(zip(GOLDEN_CLI_ARM_OUTDOOR, GOLDEN_CLI_ARM_INDOOR)) if a != b]
    assert [GOLDEN_CLI_ARM_OUTDOOR[i][:8] for i in diff] == ["$WEAP,0,", "$WEAP,1,"]
    assert GOLDEN_CLI_ARM_INDOOR[diff[0]].split(",")[3] == "100"
    assert GOLDEN_CLI_ARM_OUTDOOR[diff[0]].split(",")[3] == "70"


def _mc_head(mode, venue):
    """What MC compiles for the same inputs: its default config for the mode, one player, the CLI loadout."""
    from brx_mcp.mc.state import default_config
    cfg = default_config(mode)
    cfg["environment"] = venue
    team = cfg["teams"][0] if mode == "ffa" else next(t for t in cfg["teams"] if t["tid"] == 1)
    player = {"player_id": "p1", "player_num": 1, "display": "X", "team_id": team["team_id"], "node_id": None,
              "gun_id": None, "voice": "male", "ready": True,
              "loadout": {"weapons": [{"weapon_id": "burst_rifle"}, {"weapon_id": "shotgun"}]}}
    return Compiler().compile(cfg, player, cfg["teams"])


def test_cli_head_equals_mc_compile_frame_for_frame_except_the_named_additions():
    for mode in ("tdm", "ffa"):
        for venue in ("outdoor", "indoor"):
            b = _mc_head(mode, venue)
            mc, got = b["head"], cli.arm_frames(mode, venue, volume=65)
            # the CLI-only additions: (1) its own volume frame, (2) the live $SIR table for the
            # disarmed rows, (3) the tail. Everything else must be MC's frame, byte for byte.
            sir = [i for i, f in enumerate(mc) if f.startswith("$SIR,")]
            tail = ["$PLAYX,0,*", b["cues"]["countdown"]]
            assert got[len(got) - 2:] == tail, (mode, venue)
            body = got[:len(got) - 2]
            assert body[0] == "$VOL,65,0,*" and mc[0].startswith("$VOL,"), (mode, venue)
            assert body[sir[0]:sir[-1] + 1] == b["sir_pool"][0], (mode, venue)
            assert body[sir[0]:sir[-1] + 1] != mc[sir[0]:sir[-1] + 1], "the CLI must not arm the disarmed rows"
            assert body[1:sir[0]] == mc[1:sir[0]], (mode, venue)
            assert body[sir[-1] + 1:] == mc[sir[-1] + 1:], (mode, venue)
            assert len(body) - (sir[-1] - sir[0] + 1) == len(mc) - len(sir)


def test_cli_ffa_head_gset_follows_the_mode_and_friendly_fire_flag_forces_it_on():
    assert "$GSET,0,0,1,0,1,0,0,1,*" in cli.arm_frames("tdm")
    assert "$GSET,1,0,1,0,1,0,0,1,*" in cli.arm_frames("ffa")        # solo mode: MC writes friendly fire on
    on = cli.arm_frames("tdm", friendly_fire=True)
    off = cli.arm_frames("tdm")
    assert "$GSET,1,0,1,0,1,0,0,1,*" in on and "$GSET,0,0,1,0,1,0,0,1,*" not in on
    assert [(a, b) for a, b in zip(on, off) if a != b] == [("$GSET,1,0,1,0,1,0,0,1,*", "$GSET,0,0,1,0,1,0,0,1,*")]


def test_cli_catalogue_ids_are_the_r18_t01_m92_rows():
    heads = {n: cli.weap(s, n) for n, s in (("primary", 0), ("secondary", 1), ("melee", 4))}
    assert ",R18," in heads["primary"] and ",T01," in heads["secondary"] and ",M92," in heads["melee"]
    cat = WeaponCatalog()
    assert heads["primary"] == cat.resolve("burst_rifle", 0, environment="outdoor")
    assert cli.cli_ammo("primary") == cat.spawn_ammo("burst_rifle") == (36, 216)
    assert cli.cli_ammo("secondary") == cat.spawn_ammo("shotgun") == (6, 24)
    assert cli.spawn_frames() == ["$SPAWN,,*", "$AMMO,0,36,216,1,*", "$AMMO,1,6,24,1,*", "$BMAP,0,0,,,,,*"]


def test_arena_gives_each_gun_its_own_team_and_player_number():
    for tid in (1, 2, 3):
        frames = cli.arm_frames("tdm", tid=tid)
        assert frames[-3] == f"$TID,{tid},*"
        assert next(f for f in frames if f.startswith("$PSET,")).split(",")[1:3] == [str(tid), str(tid)]
        gc.assert_team_byte_consistent(frames)


def test_take_arm_options_and_the_printed_venue_line():
    assert cli._take_arm_options(["a", "5"]) == (["a", "5"], "outdoor", False)
    assert cli._take_arm_options(["a", "--venue", "indoor", "5", "--friendly-fire"]) == (["a", "5"], "indoor", True)
    assert cli._take_arm_options(["--venue=indoor", "a"]) == (["a"], "indoor", False)
    for bad in (["--venue", "garage"], ["--venue"]):
        err = _stderr_of(lambda: _expect_exit(lambda: cli._take_arm_options(bad)))
        assert "unknown venue" in err, err


def _expect_exit(fn):
    try:
        fn()
    except SystemExit as e:
        assert e.code == 2
        return
    raise AssertionError("expected SystemExit(2)")


def test_dispatch_passes_venue_and_friendly_fire_and_prints_the_venue_once():
    seen = []

    async def fake(*a, **kw):
        seen.append((a, kw))

    real = cli._startgame, cli._deathmatch
    cli._startgame = cli._deathmatch = fake
    try:
        out = _stderr_of(lambda: cli._dispatch("startgame", ["startgame", "AA", "--venue", "indoor"]))
        assert out.count("venue: indoor") == 1 and "friendly" not in out, out
        out = _stderr_of(lambda: cli._dispatch("deathmatch", ["deathmatch", "AA", "--friendly-fire"]))
        assert out.count("venue: outdoor") == 1 and "friendly fire forced on" in out, out
    finally:
        cli._startgame, cli._deathmatch = real
    assert seen[0][1] == {"venue": "indoor", "friendly_fire": False}
    assert seen[1][1] == {"venue": "outdoor", "friendly_fire": True}
    assert seen[0][0][0] == "AA" and len(seen[0][0]) == 4


def test_diag_config_is_golden():
    assert list(C.CONFIG) == GOLDEN_DIAG_CONFIG
    assert len(C.CONFIG) == 23


def test_cli_sends_its_own_volume_separately():
    assert cli.arm_frames(volume=65)[0] == "$VOL,65,0,*"
    assert sum(f.startswith("$VOL,") for f in cli.arm_frames(volume=65)) == 1
    assert cli.volume_cmd(65) == "$VOL,65,0,*"


def test_sir_follows_clear_and_the_full_table_is_present():
    for frames in (cli.arm_frames(), list(C.CONFIG)):
        gc.assert_sir_follows_clear(frames)
        last_clear = max(i for i, f in enumerate(frames) if f.startswith("$CLEAR"))
        first_sir = min(i for i, f in enumerate(frames) if f.startswith("$SIR,"))
        assert last_clear < first_sir, "every $SIR row must come after the last $CLEAR (F11)"
        assert [f for f in frames if f.startswith("$SIR,")][:len(gc._SIR_TABLE)] == list(gc._SIR_TABLE)


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
    assert cli.weap(0, "ar") == GOLDEN_WEAP[("ar", "outdoor")]      # the CLI default venue is outdoor
    assert cli.weap(0, "ar", "indoor") == GOLDEN_WEAP[("ar", "indoor")]
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
