"""Chaos testing in CI: every registered scenario runs for each of its fixed `ci_seeds`.

Each run is one full match on the REAL MC stack (Session + NetServer + Compiler + store) with 12-16
MockNodes on the real WebSocket, through a seeded sequence of hits, trades, drops, duplicate and
reordered facts, clock jumps, late joins and MC restarts, with every invariant checked after every
step (`brx_mcp/chaos/`, docs/chaos-testing.md).

A failure prints the seed and the whole action trace, and the command that reproduces it:

    cd mcp && ../.venv/bin/python -m brx_mcp.chaos run --scenario <name> --seed <n>

Exploration (not CI): `python -m brx_mcp.chaos explore --scenario <name> --seeds 500`, or run THIS
file on other seeds: `BRX_CHAOS_SEEDS=100-140 python3 run_tests.py chaos_fuzz`.
Set BRX_CHAOS_TRACE_DIR to keep the trace files of failures (the runner's home is a temp folder).
"""
from __future__ import annotations

import os
import pathlib
import shutil

from _skip import needs, xfail

try:
    import websockets  # noqa: F401
    HAVE_WS = True
except ImportError:
    HAVE_WS = False

if HAVE_WS:
    from brx_mcp.chaos.registry import SCENARIOS
    from brx_mcp.chaos.runner import run_one
    from brx_mcp.storage import home_dir
else:
    SCENARIOS = {}


def _seeds_from_env() -> list[int] | None:
    raw = os.environ.get("BRX_CHAOS_SEEDS", "").strip()
    if not raw:
        return None
    lo, _, hi = raw.partition("-")
    return list(range(int(lo), int(hi or lo) + 1))


def _make(name: str, seed: int):
    def test():
        needs(HAVE_WS, "websockets")
        work = home_dir() / "chaos-work" / f"{name}-{seed}"      # this test's own folder
        shutil.rmtree(work, ignore_errors=True)
        trace_dir = os.environ.get("BRX_CHAOS_TRACE_DIR")
        try:
            sc = SCENARIOS[name]

            def once():
                res = run_one(name, seed, workdir=work, trace_dir=pathlib.Path(trace_dir) if trace_dir else None)
                if sc.xfail and not res.ok and res.invariant != sc.xfail_invariant:
                    # not the filed bug: a real failure, which xfail() must not swallow
                    raise RuntimeError(f"expected {sc.xfail_invariant} to fail, got:\n{res.summary()}")
                assert res.ok, "\n" + res.summary()
            known = sc.xfail
            if known:
                xfail(known, once)      # a filed bug: red is expected, green means remove the marker
            else:
                once()
        finally:
            shutil.rmtree(work, ignore_errors=True)
    test.__name__ = f"test_chaos_{name.replace('-', '_')}_seed{seed}"
    return test


def _register() -> None:
    env = _seeds_from_env()
    for sc in SCENARIOS.values():
        for seed in (env if env is not None else sc.ci_seeds):
            fn = _make(sc.name, seed)
            globals()[fn.__name__] = fn


_register()


def test_every_scenario_has_ci_seeds_or_is_the_template():
    """A scenario without CI seeds never runs in CI: say so here rather than find out later."""
    needs(HAVE_WS, "websockets")
    bare = [sc.name for sc in SCENARIOS.values() if not sc.ci_seeds]
    assert not bare, f"these scenarios have no ci_seeds: {bare}"


def test_no_kill_cue_after_end_flags_a_cue_sent_after_the_cap_froze_the_match():
    """F357 polish r1: a same-batch cue after the frag cap leaves MC before the finish (`sent_ms` cannot show it), so
    the invariant reads the cap as it stood when the cue left (`cap_t`). A cue with none passes; one with it fails."""
    needs(HAVE_WS, "websockets")
    from types import SimpleNamespace
    from brx_mcp.chaos.invariants import no_kill_cue_after_end
    from brx_mcp.chaos.registry import InvariantError
    sc = SimpleNamespace(go_live_t=0, time_limit_s=None, limit_reached_t=5_000)
    cue = {"match_id": "m", "player_id": "p0", "victim": "p1", "t": 5_000, "sent_ms": 5_100, "phase": "live", "cap_t": None}
    world = SimpleNamespace(session=SimpleNamespace(scorer=sc), match_id="m",
                            finishes=[{"match_id": "m", "at_ms": 5_200}], kill_cues=[cue])
    no_kill_cue_after_end(world)                       # control: the capping kill's own cue
    world.kill_cues = [cue, {**cue, "victim": "p2", "t": 4_900, "cap_t": 5_000}]
    try:
        no_kill_cue_after_end(world)
    except InvariantError:
        return
    raise AssertionError("a cue sent after the cap froze the match passed")
