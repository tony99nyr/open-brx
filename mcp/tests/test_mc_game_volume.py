"""K8 (Tony, field 2026-09-12): the host's per-game volume knob, `GameConfig.volume`.

Absent or null = the venue volume (80 indoors, 90 outdoors), exactly as before. Set = an integer
60..100 for the match head's `$VOL`. `--bench-volume` still wins, a try-out keeps 69, and a GAMES pick
never touches it (F411, games-presets.md §3.7: MVP is outdoors-only, so MATCH SETTINGS has no volume
field at all).

Run: python3 run_tests.py game_volume
"""
from _skip import needs
from brx_mcp.mc.compile import GAME_VOLUME_MAX, GAME_VOLUME_MIN, Compiler, VOL_TRYOUT
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session
from _session import match_config

_TEAMS = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
          {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 3}]
_PLAYER = {"player_id": "p7", "player_num": 7, "display": "R", "team_id": "blue", "node_id": None,
           "gun_id": None, "voice": "male", "ready": True,
           "loadout": {"weapons": [{"weapon_id": "assault_rifle"}]}}


def _session():
    return Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))


def _head_vol(compiler, env="indoor", **extra):
    cfg = dict(match_config("tdm", teams=_TEAMS), environment=env, **extra)
    head = compiler.compile(cfg, _PLAYER, _TEAMS)["head"]
    vols = [int(f.split(",")[1]) for f in head if f.startswith("$VOL,")]
    assert len(vols) == 1 and head[0].startswith("$VOL,"), head[:3]
    return vols[0]


def _tryout_vol(compiler):
    weapon = {"weapon_id": "assault_rifle"} if isinstance(compiler, FakeCompiler) else compiler.weapon_catalog()[0]
    return [int(f.split(",")[1]) for f in compiler.tutorial_frames(weapon, "outdoor") if f.startswith("$VOL,")]


def test_the_range_keeps_an_audible_floor():
    assert (GAME_VOLUME_MIN, GAME_VOLUME_MAX) == (60, 100)


def test_put_accepts_the_range_and_null_clears_it():
    s = _session()
    assert "volume" not in s.config
    for v in (GAME_VOLUME_MIN, 75, GAME_VOLUME_MAX):
        s.set_config({"volume": v})
        assert s.config["volume"] == v
    s.set_config({"volume": None})
    assert "volume" not in s.config                     # null = the venue default, stored as absence


def test_put_refuses_anything_else_naming_the_range():
    s = _session()
    s.set_config({"volume": 70})
    for bad in (59, 101, 0, -1, 30, 80.0, "80", True, [80]):
        try:
            s.set_config({"volume": bad})
        except ValueError as e:
            assert "60-100" in str(e), e
        else:
            raise AssertionError(f"accepted volume={bad!r}")
    assert s.config["volume"] == 70                     # a refused PUT changes nothing


def test_head_volume_default_set_bench_and_tryout():
    for c in (Compiler(), FakeCompiler()):
        assert _head_vol(c, "indoor") == 80 and _head_vol(c, "outdoor") == 90     # absent: the venue
        assert _head_vol(c, "outdoor", volume=None) == 90                         # null: the venue
        assert _head_vol(c, "indoor", volume=65) == 65
        assert _head_vol(c, "outdoor", volume=100) == 100
        assert _tryout_vol(c) == [VOL_TRYOUT]                                     # the knob never reaches a try-out
    for c in (Compiler(bench_volume=55), FakeCompiler(bench_volume=55)):
        assert _head_vol(c, "indoor", volume=90) == 55                            # --bench-volume wins
        assert _tryout_vol(c) == [55]


def test_the_real_compiler_game_config_carries_the_knob():
    """`_to_gc` feeds `gameconfig.GameConfig.volume` too (the summary and the CLI frames read it)."""
    c = Compiler()
    cfg = dict(match_config("tdm", teams=_TEAMS), environment="outdoor", volume=70)
    assert c._to_gc(cfg, _PLAYER).volume == 70
    del cfg["volume"]
    assert c._to_gc(cfg, _PLAYER).volume == 90


def test_the_api_answers_400_naming_the_range():
    try:
        from starlette.testclient import TestClient
        import httpx  # noqa: F401
    except Exception:
        needs(False, "starlette + httpx")
        return
    from brx_mcp.mc.api import create_app
    s = _session()
    c = TestClient(create_app(s))
    r = c.put("/api/config", json={"volume": 30})
    assert r.status_code == 400 and "60-100" in r.text, r.text
    r = c.put("/api/config", json={"volume": 85})
    assert r.status_code == 200 and r.json()["config"]["volume"] == 85
    assert c.get("/api/state").json()["config"]["volume"] == 85
    r = c.put("/api/config", json={"volume": None})
    assert r.status_code == 200 and "volume" not in r.json()["config"]


def test_a_games_pick_never_touches_the_volume_knob():
    """F411 (games-presets.md §3.7): MATCH SETTINGS has no volume field -- `gamepick.compose()`'s patch
    never carries the key, so a pick (even one that changes the mode) leaves the host's own venue-volume
    knob exactly where `PUT /api/config` left it. Replaces the old whole-game-preset volume round-trip
    test: `PresetStore` is gone with no migration (games-presets.md)."""
    try:
        from starlette.testclient import TestClient
        import httpx  # noqa: F401
    except Exception:
        needs(False, "starlette + httpx")
        return
    from brx_mcp.mc.api import create_app
    s = _session()
    s.set_config({"mode": "tdm", "volume": 70})
    c = TestClient(create_app(s))
    r = c.post("/api/play/pick", json={"pieces": {"life": "builtin:life:shields"}})
    assert r.status_code == 200 and r.json()["ok"], r.text
    assert r.json()["config"]["volume"] == 70
    # a mode change composes through `default_config(mode)` + `set_config`'s own carry-over -- still kept
    r = c.post("/api/play/pick", json={"pieces": {"mode": "builtin:mode:ffa"}})
    assert r.status_code == 200 and r.json()["ok"], r.text
    assert r.json()["config"]["volume"] == 70


def test_polish_round_2_a_mode_switch_keeps_the_knob():
    from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
    from brx_mcp.mc.state import Session
    s = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    s.set_config({"volume": 70})
    other = "ffa" if s.config["mode"] != "ffa" else "tdm"
    s.set_config({"mode": other})
    assert s.config.get("volume") == 70, "the host set the volume for the site, as the venue"
