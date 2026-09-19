"""F206 — the gun keeps ONE team byte, and every `$PSET` we write must carry the `$TID` team.

The 2026-09-13 playtest: a TDM match, 116 shots, ZERO hits, while two FFA matches on the same guns
registered normally. Static root cause (V4_31 disassembly, LaserTagMods' drive, 2026-09-18): `$TID`,
`$TEAM` and `$PSET` token 2 all write the same byte, the outgoing IR word reads it, the friendly-fire
check compares against it, and the last writer wins. MC's head sent `$PSET` t2 = 0 then `$TID` (fine),
but the node writes one of `pset_pool` (a full `$PSET`) in the same burst as EVERY `$SPAWN` -- so every
gun went live as team 0 and, with `$GSET` t1 = 0, the firmware read every enemy hit as a same-team hit
and dropped it. FFA ships t1 = 1, which is why FFA worked.

The fix: every `$PSET` builder takes the team (`gameconfig._pset`, `pset_frames`, `setup_frames`,
`arm_sequence`), the compiler passes the `$TID` team everywhere, and `$TID` is re-asserted right after
every `$SPAWN`. `assert_team_byte_consistent` is the guard; the last test here breaks the builder and
watches the guard go red, so the guard is proven load-bearing rather than decorative.

Bench confirmation is pending: `docs/bench-firmware-levers-2026-09-19.md` §1.

Run: python3 run_tests.py f206
"""
from brx_mcp.gameconfig import GameConfig, arm_sequence, assert_team_byte_consistent, pset_team
from brx_mcp.mc.compile import SPAWN_PROTECT_ON, Compiler, golden_bundle
from _session import match_config

C = Compiler()

_TEAMS = [{"team_id": "red", "name": "Red", "color": "red", "tid": 0},
          {"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
          {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2},
          {"team_id": "green", "name": "Green", "color": "green", "tid": 3}]


def _player(num, team):
    return {"player_id": f"p{num}", "player_num": num, "display": "REAPER", "team_id": team,
            "node_id": None, "gun_id": None, "voice": "male", "ready": True,
            "loadout": {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]}}


def _tid_of(frames):
    return [int(f.split(",")[1]) for f in frames if f.startswith("$TID,")]


def _psets(frames):
    return [f for f in frames if f.startswith("$PSET,")]


def test_every_pset_in_a_team_bundle_carries_the_tid_team():
    """Head, spawn, revive and the whole `pset_pool`: one team, the `$TID` one, on every team 0-3."""
    cfg = match_config("tdm", teams=_TEAMS)
    for team in _TEAMS:
        b = C.compile(cfg, _player(7, team["team_id"]), _TEAMS)
        tid = team["tid"]
        assert b["head"][-1] == f"$TID,{tid},*", b["head"][-1]
        head_pset = _psets(b["head"])
        assert len(head_pset) == 1 and pset_team(head_pset[0]) == tid, head_pset
        assert b["pset_pool"], "A15.3: the node writes one of these before every $SPAWN"
        for f in b["pset_pool"]:
            assert pset_team(f) == tid, f"pset_pool frame on team {pset_team(f)}, $TID is {tid}: {f}"
        # the whole bundle passes the guard, which is what compile() runs itself
        assert_team_byte_consistent(b["head"] + b["spawn"] + b["revive"] + b["pset_pool"])


def test_tid_is_reasserted_right_after_every_spawn():
    """Belt to the braces: even if a writer we have not found puts the byte back, `$TID` follows `$SPAWN`.
    The same order LaserTagMods' hosted-game path uses (a second `$TID` after the gun's own start)."""
    b = C.compile(match_config("tdm", teams=_TEAMS), _player(7, "yellow"), _TEAMS)
    for key in ("spawn", "revive"):
        frames = b[key]
        i = frames.index("$SPAWN,,*")
        # F121 rebuild: the t8 protection write sits between them (bench order: $SPAWN, $TMP, $TID)
        assert frames[i + 1:i + 3] == [SPAWN_PROTECT_ON, "$TID,2,*"], (key, frames[i:i + 3])
        assert _tid_of(frames) == [2], (key, frames)


def test_an_infection_flip_ends_on_the_team_the_gun_joins():
    """`team_flip[t]` is a revive onto team t: it starts AND ends with `$TID,t`, with the `$SPAWN` between.
    The node uses that list for every later revive of a turned player, because the `pset_pool` `$PSET`
    it writes first still carries the ARMING team (engine.js `_revive`)."""
    teams = _TEAMS[:2]
    b = C.compile(match_config("infection", teams=teams), _player(7, "red"), teams)
    flip = b["team_flip"]
    assert set(flip) == {"1"}, flip.keys()
    frames = flip["1"]
    assert frames[0] == "$TID,1,*" and "$SPAWN,,*" in frames
    assert frames[frames.index("$SPAWN,,*") + 2] == "$TID,1,*", frames   # $SPAWN, the t8 write, then $TID (F121)
    assert not _psets(frames), "the flip carries no $PSET of its own"
    # and the ARMING team's own $PSET is still team 0, which is exactly why the flip must end on $TID,1
    assert all(pset_team(f) == 0 for f in b["pset_pool"])


def test_the_golden_bundle_and_ffa_agree_too():
    g = golden_bundle()
    assert pset_team(_psets(g["head"])[0]) == 1 and all(pset_team(f) == 1 for f in g["pset_pool"])
    ffa = C.compile(match_config("ffa", teams=_TEAMS), _player(3, "green"), _TEAMS)
    assert_team_byte_consistent(ffa["head"] + ffa["spawn"] + ffa["revive"] + ffa["pset_pool"])


def test_the_bench_arm_sequence_and_the_driver_builders_carry_the_team():
    seq = arm_sequence(team=3, player_id=5)
    assert _tid_of(seq) == [3] and all(pset_team(f) == 3 for f in _psets(seq)), seq
    frames = GameConfig().setup_frames(player_id=4, team=2)
    assert all(pset_team(f) == 2 for f in _psets(frames))
    assert all(pset_team(f) == 1 for f in GameConfig().pset_frames(player_id=4, team=1))
    # the default is still team 0, so an old caller that never passes a team gets what it always got
    assert pset_team(GameConfig()._pset(1)) == 0


def test_the_guard_rejects_a_pset_on_another_team_and_accepts_no_tid_at_all():
    ok = ["$CLEAR,*", "$PSET,7,2,45,70,70,50,,*", "$TID,2,*", "$SPAWN,,*", "$TID,2,*"]
    assert_team_byte_consistent(ok)
    bad = ["$CLEAR,*", "$PSET,7,0,45,70,70,50,,*", "$TID,2,*"]
    try:
        assert_team_byte_consistent(bad)
    except ValueError as e:
        assert "F206" in str(e) and "$PSET token 2 is 0" in str(e) and "$TID is 2" in str(e)
    else:
        raise AssertionError("a $PSET on team 0 under $TID,2 must be refused")
    # no $TID anywhere = the team comes from $PSET alone (Callsign's own arm); nothing to compare, so pass
    assert_team_byte_consistent(["$PSET,7,0,45,70,70,50,,*", "$SPAWN,,*"])
    # an empty t2 leaves the byte alone on the gun and is not a contradiction
    assert_team_byte_consistent(["$PSET,7,,45,*", "$TID,1,*"])
    assert pset_team("$SIR,0,0,,1,*") is None and pset_team("$PSET,7,x,*") is None


def test_the_guard_is_load_bearing_in_compile():
    """Break the fix (a builder that writes t2 = 0 again, which is what shipped until 2026-09-18) and the
    COMPILER must refuse the bundle. This is the 'break it once and watch it fail' proof."""
    original = GameConfig._pset

    def broken(self, player_id=0, voice=None, slots=None, hits=None, team=0):
        return original(self, player_id, voice, slots, hits, team=0)

    GameConfig._pset = broken
    try:
        try:
            C.compile(match_config("tdm", teams=_TEAMS), _player(7, "blue"), _TEAMS)
        except ValueError as e:
            assert "F206 GUARD" in str(e), e
        else:
            raise AssertionError("compile() accepted a bundle whose $PSET puts the gun on team 0 under $TID,1")
    finally:
        GameConfig._pset = original
    # and with the real builder back, the same compile is clean
    C.compile(match_config("tdm", teams=_TEAMS), _player(7, "blue"), _TEAMS)
