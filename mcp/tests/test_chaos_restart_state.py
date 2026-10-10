"""T2 (maintainability review 2026-10-10, the MC half): an MC restart must bring back MC's whole `/api/state`, not
only the board. MC lost the KOTH hold target, mode_params and node bindings one restart at a time before. The
invariant `state_survives_restart` runs in every chaos scenario (test_chaos_fuzz); these tests pin what it accepts
and what it refuses. Its first run found `config_warnings` empty after every restart (fixed in `restore_snapshot`)."""
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


def _world(before, after, *, crash=False, phase="live", now_phase="lobby", now_players=(), nodes=(), seen=()):
    session = SimpleNamespace(phase=now_phase, nodes={nid: {"stale": False} for nid in seen},
                              snapshot=lambda: {"players": list(now_players)})
    return SimpleNamespace(session=session, nodes=[SimpleNamespace(node_id=n, link_up=True) for n in nodes],
                           restart_checks=[{"step": 3, "crash": crash, "phase_before": phase,
                                            "state_before": before, "state_after": after}])


def _check(before, after, **kw):
    from brx_mcp.chaos.invariants import state_survives_restart
    state_survives_restart(_world(before, after, **kw))


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


def test_a_crash_or_a_pre_match_restart_still_keeps_the_config():
    """Opus r1: those restarts were skipped whole, so a config field a crash lost was None on both sides of the next
    clean restart, and the original hold-target loss (a MUSTER restart) passed."""
    needs(HAVE_WS, "websockets")
    churn = {**STATE, "players": [], "feed": [], "phase": "muster"}
    _check(STATE, churn, crash=True)          # a crash may lose the last debounced write of anything else
    _check(STATE, churn, phase="lobby")       # a pre-match restart boots in MUSTER
    lost = {**churn, "config": {"mode": "koth", "mode_params": {}}}
    assert "config.mode_params.hold_target_s" in _refused(STATE, lost, crash=True)
    assert "config.mode_params.hold_target_s" in _refused(STATE, lost, phase="lobby")


def test_a_node_that_is_back_must_be_bound_to_the_same_player():
    """Opus r1: a binding is empty straight after the resume, so it is read once the node is back with this MC."""
    needs(HAVE_WS, "websockets")
    after = {**STATE, "players": [{"player_id": "p1", "display": "ACE", "node_id": None}]}
    back = dict(now_phase="live", nodes=["n1"], seen=["n1"])
    _check(STATE, after, now_players=[{"player_id": "p1", "node_id": "n1"}], **back)
    _check(STATE, after, now_players=[{"player_id": "p1", "node_id": None}], now_phase="live", nodes=["n1"])  # no hello yet
    assert "players[p1].node_id" in _refused(STATE, after, now_players=[{"player_id": "p1", "node_id": None}], **back)


def test_an_assigned_station_and_the_join_secret_are_checked():
    """Codex r1 (High): the station and LAN rows were exempt whole, so a lost assignment or join secret passed."""
    needs(HAVE_WS, "websockets")
    hill = {"node_id": "s1", "assigned": {"kind": "control", "id": 1, "team": 0}, "armed": {"game": 1}}
    loose = {"node_id": "s2", "assigned": None}
    before = {**STATE, "stations": [hill, loose], "lan": {"join_secret": "abc", "auth_required": True}}
    _check(before, {**before, "stations": [{**hill, "armed": None, "arm_pending": True}],   # link state: fine
                    "lan": {"join_secret": "abc", "auth_required": None}})
    assert "stations[s1].assigned" in _refused(before, {**before, "stations": [{**hill, "assigned": None}]})
    assert "lan.join_secret" in _refused(before, {**before, "lan": {"join_secret": "new", "auth_required": True}})


def test_a_vanished_key_that_held_none_is_refused():
    needs(HAVE_WS, "websockets")
    before = {**STATE, "players": [{"player_id": "p1", "display": "ACE", "gun_id": None}]}
    assert "players[p1].gun_id" in _refused(before, {**before, "players": [{"player_id": "p1", "display": "ACE"}]})


def test_the_feed_cap_may_push_out_the_oldest_line_but_not_a_middle_one():
    needs(HAVE_WS, "websockets")
    from brx_mcp.chaos.invariants import FEED_SHOWN
    lines = [{"kind": "kill", "text": f"L{i}"} for i in range(FEED_SHOWN)]          # newest first, at the cap
    resumed = {"kind": "alert", "text": "MC RESTARTED"}
    before = {**STATE, "feed": lines}
    _check(before, {**before, "feed": [resumed] + lines[:-1]})                     # the oldest went: fine
    assert "feed" in _refused(before, {**before, "feed": [resumed] + lines[:10] + lines[11:]})


def test_two_honours_for_one_player_do_not_hide_each_other():
    needs(HAVE_WS, "websockets")
    from brx_mcp.chaos.invariants import _flat
    flat = _flat({"honors": [{"player_id": "p1", "key": "mvp"}, {"player_id": "p1", "key": "most_kills"}]})
    assert {flat[k] for k in flat if k.endswith(".key")} == {"mvp", "most_kills"}, flat
