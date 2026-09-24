"""K8 (Tony, field 2026-09-12): the host's per-game volume knob, `GameConfig.volume`.

Absent or null = the venue volume (80 indoors, 90 outdoors), exactly as before. Set = an integer
60..100 for the match head's `$VOL`. `--bench-volume` still wins, a try-out keeps 69, and a saved game
keeps the knob (an older one with no key plays at the venue volume).

Run: python3 run_tests.py game_volume
"""
import json
import pathlib
import tempfile

from _skip import needs
from brx_mcp.mc import policy as P
from brx_mcp.mc.compile import GAME_VOLUME_MAX, GAME_VOLUME_MIN, Compiler, VOL_TRYOUT
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.presets import PresetStore
from brx_mcp.mc.state import Session, default_config
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


def test_a_saved_game_keeps_the_knob_and_an_old_one_is_the_venue_default():
    s = _session()
    path = pathlib.Path(tempfile.mkdtemp()) / "presets.json"
    st = PresetStore(path, s.sanitize_config, default_config, P.merge, now_ms=s.now_ms)
    s.presets = st
    s.set_config({"mode": "tdm", "time_limit_s": 300, "volume": 70})
    loud = st.create("Quiet TDM", "", s.config)
    assert loud["config"]["volume"] == 70
    # round trip through the file
    reread = PresetStore(path, s.sanitize_config, default_config, P.merge, now_ms=s.now_ms)
    row = next(r for r in reread.list() if r["name"] == "Quiet TDM")
    assert row["config"]["volume"] == 70
    # a hand-written file from before K8: no key at all
    raw = json.loads(path.read_text())
    rows = raw["presets"] if isinstance(raw, dict) else raw
    old = json.loads(json.dumps(rows[0]))
    old.update(name="Old TDM", preset_id="old1")
    old["config"].pop("volume")
    rows.append(old)
    path.write_text(json.dumps(raw))
    st2 = PresetStore(path, s.sanitize_config, default_config, P.merge, now_ms=s.now_ms)
    old_row = next(r for r in st2.list() if r["name"] == "Old TDM")
    assert "volume" not in old_row["config"]
    # applying the old game after a game with the knob set must NOT inherit that knob
    s.set_config({"volume": 95})
    s.apply_preset(old_row["preset_id"], old_row["config"])
    assert "volume" not in s.config
    s.apply_preset(row["preset_id"], row["config"])
    assert s.config["volume"] == 70
    # a bad value in a stored file drops only that row, as every other bad value does
    bad = json.loads(json.dumps(old)); bad.update(name="Bad", preset_id="bad1"); bad["config"]["volume"] = 20
    rows.append(bad); path.write_text(json.dumps(raw))
    assert "Bad" not in [r["name"] for r in PresetStore(path, s.sanitize_config, default_config, P.merge, now_ms=s.now_ms).list()]
