"""T2 (maintainability review 2026-10-10): a clean MC restart must bring back the whole `/api/state`, not only the
board. Five fields were lost one restart at a time before (hold target, powerup seen map, node bindings, stun,
poison). The invariant `state_survives_restart` runs in every chaos scenario (test_chaos_fuzz); these tests pin
what it accepts and what it refuses."""
from __future__ import annotations

from types import SimpleNamespace

from _skip import needs

try:
    import websockets  # noqa: F401
    HAVE_WS = True
except ImportError:
    HAVE_WS = False

STATE = {
    "t": 1, "session_id": "a", "phase": "live",
    "config": {"mode": "koth", "mode_params": {"hold_target_s": 120}},
    "players": [{"player_id": "p1", "display": "ACE", "node_id": "n1"}],
    "feed": [{"kind": "kill", "text": "ACE DOWNED BOB"}],
    "nodes": [{"node_id": "n1", "alive": True}],
}


def _check(before, after, *, crash=False, phase="live"):
    from brx_mcp.chaos.invariants import state_survives_restart
    world = SimpleNamespace(restart_checks=[{"step": 3, "crash": crash, "phase_before": phase,
                                             "state_before": before, "state_after": after}])
    state_survives_restart(world)


def _refused(before, after, **kw) -> str:
    from brx_mcp.chaos.registry import InvariantError
    try:
        _check(before, after, **kw)
    except InvariantError as e:
        return str(e)
    raise AssertionError("the invariant passed a lost field")


def test_volatile_keys_may_change():
    needs(HAVE_WS, "websockets")
    after = {**STATE, "t": 2, "session_id": "b", "nodes": [],
             "players": [{"player_id": "p1", "display": "ACE", "node_id": None}],
             "feed": [{"kind": "alert", "text": "MC RESTARTED"}] + STATE["feed"]}   # newest first
    _check(STATE, after)


def test_a_lost_field_is_refused_and_named():
    needs(HAVE_WS, "websockets")
    after = {**STATE, "config": {"mode": "koth", "mode_params": {}}}
    assert "config.mode_params.hold_target_s" in _refused(STATE, after)


def test_a_rewritten_feed_is_refused():
    needs(HAVE_WS, "websockets")
    assert "feed" in _refused(STATE, {**STATE, "feed": [{"kind": "alert", "text": "MC RESTARTED"}]})
    two = {**STATE, "feed": [{"kind": "kill", "text": "B"}, {"kind": "kill", "text": "A"}]}
    assert "feed" in _refused(two, {**two, "feed": [{"kind": "kill", "text": "A"}, {"kind": "kill", "text": "B"}]})


def test_a_crash_or_a_pre_match_restart_is_not_checked():
    needs(HAVE_WS, "websockets")
    lost = {**STATE, "config": {}}
    _check(STATE, lost, crash=True)          # a crash may lose the last debounced write
    _check(STATE, lost, phase="lobby")       # a pre-match restart boots in MUSTER
