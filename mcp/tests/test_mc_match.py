"""Slice 1: match data, Session lifetimes and no-match readers."""
import ast
import pathlib
import re

from _skip import needs
from _session import go_live, mk_kit_session, online
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.match import Match
from brx_mcp.mc.state import Session

try:
    import starlette  # noqa: F401
    import httpx  # noqa: F401
    HAVE_HTTP = True
except ImportError:
    HAVE_HTTP = False


def test_match_is_independent_of_session_and_state_imports():
    match = Match(head={"match_id": "one"})
    match.nodes["node"] = "player"
    assert match.head == {"match_id": "one"} and match.nodes == {"node": "player"}
    assert Match().nodes == {} and Match().evicted == set()
    path = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp" / "mc" / "match.py"
    tree = ast.parse(path.read_text())
    imports = [node for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom))]
    assert all(not (isinstance(node, ast.ImportFrom) and node.module and
                    (node.module == "state" or node.module.endswith(".state"))) and
               not any(alias.name == "state" or alias.name.endswith(".state") for alias in node.names)
               for node in imports)


def test_no_match_readers_return_empty_values_and_setters_refuse_creation():
    s = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    assert s.match is None
    assert s.start_info is None and s.scorer is None
    assert s._match_players is None and s._match_stations is None
    assert s._match_nodes == {} and s._match_current == {}
    assert s._match_evicted == set() and s._match_unbound == set()
    assert s._departed_match_stations == {}
    for field, value in (("start_info", {}), ("scorer", None), ("_match_nodes", {})):
        try:
            setattr(s, field, value)
            assert False, field
        except RuntimeError:
            assert s.match is None


def _kept_bindings(match):
    match.nodes["old"] = "player"
    match.current["player"] = "old"
    match.evicted.add("old")
    match.unbound.add("old")
    return match.nodes, match.current, match.evicted, match.unbound


def _assert_cleared_but_kept(s, match, bindings):
    assert s.match is match
    assert match.head is None and match.scorer is None
    assert (match.nodes, match.current, match.evicted, match.unbound) == bindings
    assert all(actual is expected for actual, expected in zip(
        (match.nodes, match.current, match.evicted, match.unbound), bindings))


def test_abort_keeps_match_bindings_and_clears_active_fields():
    s, net, clock, players = mk_kit_session()
    for i, player in enumerate(players):
        online(s, net, clock, player, i)
    s.push_config()
    for i in range(len(players)):
        net.simulate_node_message(f"node{i}", "ack_config",
                                  {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    s.start(runway_s=30)
    match = s.match
    bindings = _kept_bindings(match)
    s.abort_start()
    _assert_cleared_but_kept(s, match, bindings)


def test_recall_keeps_match_bindings_and_clears_active_fields():
    s, _net, _clock, _players, _info = go_live()
    match = s.match
    bindings = _kept_bindings(match)
    s.control("recall")
    _assert_cleared_but_kept(s, match, bindings)


def test_roll_keeps_match_bindings_and_fresh_session_drops_match():
    s, _net, _clock, _players, _info = go_live()
    match = s.match
    bindings = _kept_bindings(match)
    s.control("end")
    assert match.played is not None and match.frozen_stations is not None
    s.next_match()
    _assert_cleared_but_kept(s, match, bindings)
    s.new_session(keep_roster=False)
    assert s.match is None
    assert s._match_nodes == {} and s._match_evicted == set()


def test_every_get_route_answers_without_a_match():
    needs(HAVE_HTTP, "starlette + httpx")
    from starlette.routing import Route
    from starlette.testclient import TestClient
    from brx_mcp.mc.api import create_app
    s = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    app = create_app(s)
    with TestClient(app, raise_server_exceptions=False) as client:
        routes = [route for route in app.routes if isinstance(route, Route) and "GET" in route.methods]
        assert routes
        for route in routes:
            path = re.sub(r"\{[^}]+\}", "missing", route.path)
            response = client.get(path)
            assert response.status_code < 500, (route.path, response.status_code, response.text[:200])
    assert s.match is None
