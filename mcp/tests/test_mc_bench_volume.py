"""`--bench-volume [N]`: every `$VOL` MC compiles for a bench run uses N (default 55).

Tony, bench 2026-09-16: 30 is barely audible, and the venue play volume (80 indoors, 90 outdoors) is
too loud for a bench. Without the flag nothing changes.

Run: python3 run_tests.py bench_volume
"""
import contextlib
import io

from brx_mcp.mc import __main__ as M
from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeCompiler
from _session import match_config

_TEAMS = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
          {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 3}]
_PLAYER = {"player_id": "p7", "player_num": 7, "display": "R", "team_id": "blue", "node_id": None,
           "gun_id": None, "voice": "male", "ready": True,
           "loadout": {"weapons": [{"weapon_id": "assault_rifle"}]}}


def _vols(compiler):
    """Every $VOL value this compiler emits: match heads at both venues, and a try-out."""
    out = {}
    for env in ("indoor", "outdoor"):
        cfg = dict(match_config("tdm", teams=_TEAMS), environment=env)
        b = compiler.compile(cfg, _PLAYER, _TEAMS)
        frames = [f for key in ("head", "spawn", "revive", "end", "panic") for f in b[key]]
        frames += list(b.get("cues", {}).values())
        out[env] = sorted({int(f.split(",")[1]) for f in frames if isinstance(f, str) and f.startswith("$VOL,")})
        weapon = {"weapon_id": "assault_rifle"} if isinstance(compiler, FakeCompiler) else compiler.weapon_catalog()[0]
        out[f"tryout-{env}"] = [int(f.split(",")[1]) for f in compiler.tutorial_frames(weapon, env) if f.startswith("$VOL,")]
    return out


def _parse(*argv):
    return M.parser().parse_args(list(argv))


def test_flag_absent_keeps_the_venue_volumes():
    assert _parse().bench_volume is None
    for c in (Compiler(), FakeCompiler()):
        assert _vols(c) == {"indoor": [80], "outdoor": [90], "tryout-indoor": [69], "tryout-outdoor": [69]}


def test_flag_without_a_value_is_55_everywhere():
    assert _parse("--bench-volume").bench_volume == 55
    for c in (Compiler(bench_volume=55), FakeCompiler(bench_volume=55)):
        assert _vols(c) == {"indoor": [55], "outdoor": [55], "tryout-indoor": [55], "tryout-outdoor": [55]}


def test_flag_with_an_explicit_value():
    assert _parse("--bench-volume", "40").bench_volume == 40
    assert _parse("--bench-volume=0").bench_volume == 0
    assert _parse("--bench-volume", "100").bench_volume == 100
    assert _vols(Compiler(bench_volume=40))["outdoor"] == [40]


def test_an_invalid_value_is_refused():
    for bad in ("101", "-1", "loud", "55.5"):
        with contextlib.redirect_stderr(io.StringIO()):
            try:
                _parse(f"--bench-volume={bad}")
            except SystemExit as e:
                assert e.code == 2, bad
            else:
                raise AssertionError(f"accepted --bench-volume={bad}")
    for bad in (101, -1):
        try:
            Compiler(bench_volume=bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Compiler accepted bench_volume={bad}")


def test_the_state_carries_the_bench_volume_only_when_set():
    from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
    from brx_mcp.mc.state import Session
    plain = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()))
    assert "bench_volume" not in plain.snapshot()
    bench = Session(Compiler(bench_volume=55), FakeNet(), FakeArmory(demo_armory()))
    assert bench.snapshot()["bench_volume"] == 55
