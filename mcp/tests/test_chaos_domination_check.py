"""Codex pass 2026-11-07: the `domination-hills` check must refuse a target finish the hills never reached. It compared
`v * 1000` with the target in ms (`v` was already ms), so a finish at 1 point of 4 passed, and a finish with no points
returned before the target was checked."""
from __future__ import annotations

from types import SimpleNamespace

try:
    from brx_mcp.chaos.registry import InvariantError
    from brx_mcp.chaos.scenarios import domination_hills as dh
    HAVE_CHAOS = True
except ImportError:   # the chaos stack needs the server extras; system python may not have them
    HAVE_CHAOS = False


def _world(red_ms, *, target=4, reason="hold_target", recap_red=None):
    session = SimpleNamespace(phase="recap", end_reason=reason, config={"scoring": {"hold_target_s": target}},
                              last_recap={"possession": {"by_team": {"red": round(red_ms / 1000) if recap_red is None else recap_red,
                                                                     "blue": 0}},
                                          "winner": {"team_id": "red"} if red_ms >= 500 else {"team_id": None, "tie": ["blue", "red"]}})
    world = SimpleNamespace(session=session)
    world.hill_own = {nid: {} for nid in dh.HILLS}
    world.hill_own[dh.HILLS[0]] = {0: red_ms} if red_ms else {}
    return world


def _check(world):
    teams = {"red": {"tid": 0}, "blue": {"tid": 1}}
    real = dh.match_scorer
    dh.match_scorer = lambda _s: SimpleNamespace(teams=teams)
    try:
        dh.domination_hills_check(world)
    finally:
        dh.match_scorer = real


def _refused(world) -> bool:
    try:
        _check(world)
    except InvariantError:
        return True
    return False


def test_a_target_finish_below_the_target_is_refused():
    if not HAVE_CHAOS:
        return
    assert not _refused(_world(4_000)), "CONTROL: a finish at the target passes"
    assert _refused(_world(1_000)), "a finish at 1 point of 4 must fail"


def test_a_target_finish_with_no_points_is_refused():
    if not HAVE_CHAOS:
        return
    assert not _refused(_world(0, reason="time")), "CONTROL: a clock finish with no points passes"
    assert _refused(_world(0)), "a target finish with nothing banked must fail"
