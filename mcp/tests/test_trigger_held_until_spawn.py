"""Bench 2026-09-16: the trigger worked during the ARMED countdown.

The head MC writes in the lobby carried the full seven-row `$BMAP` table, including the trigger row
`$BMAP,0,0` (trigger -> fire). The head now holds the trigger on a non-firing function, and only the
T-0 spawn write (and every revive, because a live resync re-writes the head first) maps it to fire.
A try-out still maps the trigger at once: the player fires it straight away.

Run: python3 run_tests.py trigger_held
"""
from brx_mcp.mc import compile as CM
from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeCompiler
from _session import match_config

LIVE = "$BMAP,0,0,,,,,*"
_TEAMS = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
          {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 3}]


def _player(weapons=("assault_rifle", "shotgun"), perk=None):
    p = {"player_id": "p7", "player_num": 7, "display": "R", "team_id": "blue", "node_id": None,
         "gun_id": None, "voice": "male", "ready": True,
         "loadout": {"weapons": [{"weapon_id": w} for w in weapons]}}
    if perk:
        p["loadout"]["perk"] = {"perk_id": perk}
    return p


def _trigger_rows(frames):
    return [f for f in frames if f.startswith("$BMAP,0,")]


def _maps_after_spawn(frames):
    i = frames.index("$SPAWN,,*")
    return LIVE in frames[i + 1:]


def _bundles():
    c = Compiler()
    out = []
    for mode in ("tdm", "ffa"):
        for env in ("indoor", "outdoor"):
            for weapons in (("assault_rifle", "shotgun"), ("assault_rifle",)):
                cfg = dict(match_config(mode, teams=_TEAMS), environment=env)
                out.append((f"{mode}/{env}/{len(weapons)}w", c.compile(cfg, _player(weapons), _TEAMS)))
    out.append(("fake", FakeCompiler().compile(match_config("tdm", teams=_TEAMS), _player(), _TEAMS)))
    return out


def test_a_compiled_match_head_does_not_map_the_trigger_to_fire():
    for name, b in _bundles():
        assert LIVE not in b["head"], f"{name}: the head maps the trigger to fire before T-0"
        rows = _trigger_rows(b["head"])
        assert rows == [CM.TRIGGER_HELD], f"{name}: the head must hold the trigger, got {rows}"


def test_the_rest_of_the_button_map_stays_in_the_head():
    """The other six rows are the captured Callsign table; only the trigger row changes."""
    b = Compiler().compile(match_config("tdm", teams=_TEAMS), _player(), _TEAMS)
    rows = [f for f in b["head"] if f.startswith("$BMAP,") and not f.startswith("$BMAP,0,")]
    assert [r.split(",")[1] for r in rows] == ["1", "2", "3", "4", "5", "8"], rows


def test_the_spawn_write_maps_the_trigger_after_spawn():
    for name, b in _bundles():
        assert _maps_after_spawn(b["spawn"]), f"{name}: spawn does not map the trigger after $SPAWN"


def test_every_revive_maps_the_trigger_after_spawn():
    """engine.js `_resyncNotLive` re-writes the head on a live node and then revives. That head holds
    the trigger, so a revive that does not map it would leave the player unable to fire."""
    for name, b in _bundles():
        assert _maps_after_spawn(b["revive"]), f"{name}: revive does not map the trigger after $SPAWN"


def test_a_try_out_still_maps_the_trigger_at_once():
    c = Compiler()
    w = c.weapon_catalog()[0]
    for frames in (c.tutorial_frames(w, "indoor"), FakeCompiler().tutorial_frames({"weapon_id": "smg"}, "indoor")):
        assert _trigger_rows(frames) == [LIVE], frames
        assert _maps_after_spawn(frames)


def test_the_guard_refuses_a_head_that_maps_the_trigger():
    b = Compiler().compile(match_config("tdm", teams=_TEAMS), _player(), _TEAMS)
    bad = [LIVE if f == CM.TRIGGER_HELD else f for f in b["head"]]
    try:
        CM.assert_trigger_held_until_spawn(bad, b["spawn"], b["revive"])
    except ValueError as e:
        assert "trigger" in str(e).lower()
    else:
        raise AssertionError("a head that maps the trigger was accepted")
    no_revive_map = [f for f in b["revive"] if f != LIVE]
    try:
        CM.assert_trigger_held_until_spawn(b["head"], b["spawn"], no_revive_map)
    except ValueError:
        pass
    else:
        raise AssertionError("a revive that never maps the trigger was accepted")
