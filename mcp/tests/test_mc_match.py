"""Slice 1: match data, Session lifetimes and no-match readers."""
import ast
import pathlib
import re
from unittest.mock import patch

from _skip import needs
from _session import go_live, mk_kit_session, online, persisting_live, restart_no_repersist
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.match import Match, parse_snapshot
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
                    (node.module in {"state", "snapshot_codec"} or
                     node.module.endswith((".state", ".snapshot_codec")))) and
               not any(alias.name in {"state", "snapshot_codec"} or
                       alias.name.endswith((".state", ".snapshot_codec")) for alias in node.names)
               for node in imports)


def test_begin_installs_every_prepared_field():
    head, scorer, played = {"match_id": "one"}, object(), {"p": {"player_id": "p"}}
    nodes, current = {"n": "p"}, {"p": "n"}
    evicted, unbound = {"old"}, {"loose"}
    departed = {"st": {"node_id": "st"}}
    match = Match.begin(head, scorer, played, nodes, current=current,
                        evicted=evicted, unbound=unbound, departed_stations=departed)
    assert (match.head, match.scorer, match.played, match.nodes) == (head, scorer, played, nodes)
    assert match.current is current and match.evicted is evicted and match.unbound is unbound
    assert match.departed_stations is departed and match.frozen_stations is None
    fresh = Match.begin({}, scorer, {}, {})
    assert fresh.current == {} and fresh.evicted == set() and fresh.unbound == set()
    assert fresh.departed_stations == {}
    fresh.current["other"] = "phone"
    fresh.evicted.add("other")
    fresh.departed_stations["other"] = {"node_id": "other"}
    another = Match.begin({}, scorer, {}, {})
    assert another.current == {} and another.evicted == set()
    assert another.departed_stations == {}


def test_to_snapshot_without_session_keeps_match_merge_and_order():
    class ScorerStub:
        joined_t = {"p1": 123}
        cap_recv = 456

        def match_state_alerts(self):
            return {"leader": "p1"}

    p1, p2 = {"player_id": "p1"}, {"player_id": "p2"}
    match = Match.begin(
        {"match_id": "m", "go_live_t": 100, "seq": 7, "countdown_s": 10},
        ScorerStub(), {"p1": p1, "p2": p2},
        {"old": "p1", "live": "p2", "stale": "missing"},
        current={"p1": "old", "p2": "live", "missing": "stale"},
        evicted={"z", "a"}, unbound={"y", "b"},
        departed_stations={
            "station-z": {"node_id": "station-z", "kind": "respawn", "id": 2, "team": 0,
                          "heard": True, "revives": 1},
            "station-a": {"node_id": "station-a", "kind": "respawn", "id": 1, "team": 0,
                          "heard": False, "revives": 0}})
    actual = match.to_snapshot(
        live=True, adopted=False, config={"mode": "tdm"}, roster={"p1": {"player_id": "other"}},
        node_player={"live": "p1", "new": "p2", "bad": "missing"},
        synced_at_lobby={"live": True}, clock_suspect={"n": 3},
        bundles={"live": {"head": []}}, acks={"live": {"ok": True}}, store_path="session.sqlite")
    expected = {
        "match_id": "m", "go_live_t": 100, "seq": 7, "countdown_s": 10,
        "adopted": False, "live": True, "config": {"mode": "tdm"},
        "players": {"p1": p1, "p2": p2},
        "node_player": {"old": "p1", "live": "p1", "new": "p2"},
        "current_nodes": {"p1": "live", "p2": "new"},
        "evicted_nodes": ["a", "z"], "unbound_nodes": ["b", "y"],
        "synced_at_lobby": {"live": True}, "clock_suspect": {"n": 3},
        "joined_t": {"p1": 123}, "cap_recv": 456, "alerts": {"leader": "p1"},
        "departed_stations": [
            {"node_id": "station-a", "kind": "respawn", "id": 1, "team": 0,
             "heard": False, "revives": 0},
            {"node_id": "station-z", "kind": "respawn", "id": 2, "team": 0,
             "heard": True, "revives": 1}],
        "bundles": {"live": {"head": []}}, "acks": {"live": {"ok": True}},
        "store_path": "session.sqlite"}
    assert actual == expected
    assert list(actual) == list(expected)
    match.played = None
    fallback = match.to_snapshot(
        live=False, adopted=False, config={"mode": "tdm"}, roster={"p1": p1},
        node_player={}, synced_at_lobby={}, clock_suspect=None,
        bundles={}, acks={}, store_path=None)
    assert fallback["players"] == {"p1": p1}
    assert fallback["node_player"] == {"old": "p1"}
    assert fallback["current_nodes"] == {"p1": "old"}


def test_parse_snapshot_normalises_malformed_fields_and_duplicate_departures():
    assert parse_snapshot(None, {"p"}).head is None
    assert parse_snapshot([], {"p"}).node_player == {}
    valid = {"node_id": "st", "kind": "respawn", "id": 1, "team": 0,
             "heard": True, "revives": 2}
    parsed = parse_snapshot({
        "match_id": "m", "go_live_t": 100, "seq": 4, "countdown_s": "bad",
        "config": {"mode": "tdm"}, "adopted": 1,
        "node_player": {"n": "p", "wrong": "absent", 4: "p", "bad": 7},
        "current_nodes": {"p": "n", "absent": "old", 4: "n", "bad": 7},
        "unbound_nodes": ["z", 2, "a", "z"],
        "evicted_nodes": ["b", None, "b"],
        "departed_stations": [valid, dict(valid, revives=3), {"node_id": "bad"}, 3],
    }, {"p"})
    assert parsed.head == {"match_id": "m", "go_live_t": 100, "seq": 4,
                           "countdown_s": 0, "adopted": True}
    assert parsed.node_player == {"n": "p"}
    assert parsed.current_nodes == {"p": "n"}
    assert parsed.unbound_nodes == {"a", "z"}
    assert parsed.evicted_nodes == {"b"}
    assert parsed.departed_stations == {"st": valid}
    assert parsed.invalid_departed == 3
    wrong = parse_snapshot({"match_id": 8, "go_live_t": "bad", "seq": None,
                            "config": [], "node_player": [], "current_nodes": 1,
                            "unbound_nodes": {}, "evicted_nodes": "bad",
                            "departed_stations": {}}, {"p"})
    assert wrong.head is None and wrong.node_player == {} and wrong.current_nodes == {}
    assert wrong.unbound_nodes == set() and wrong.evicted_nodes == set()
    assert wrong.departed_stations == {} and wrong.invalid_departed == 1


def test_snapshot_codec_does_not_read_old_match_fields_on_host():
    path = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp" / "mc" / "snapshot_codec.py"
    tree = ast.parse(path.read_text())
    old = {"start_info", "scorer", "_match_players", "_match_nodes", "_match_current",
           "_match_evicted", "_match_unbound", "_departed_match_stations"}
    host_reads = [node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)
                  and node.attr in old and isinstance(node.value, ast.Attribute)
                  and node.value.attr == "host"]
    assert host_reads == []
    protocol = next(node for node in tree.body if isinstance(node, ast.ClassDef)
                    and node.name == "SnapshotHost")
    protocol_fields = {node.target.id for node in protocol.body if isinstance(node, ast.AnnAssign)
                       and isinstance(node.target, ast.Name)}
    protocol_fields.update(node.name for node in protocol.body if isinstance(node, ast.FunctionDef))
    assert not (old & protocol_fields)


def test_schedule_resume_and_adopt_use_the_same_match_shape():
    with patch.object(Match, "begin", wraps=Match.begin) as begin:
        s, net, clock, _players, _info = persisting_live()
        scheduled = s.match
        assert begin.call_count == 1
        assert isinstance(scheduled.head, dict) and scheduled.scorer is not None
        s._persist_last = 0.0
        s._persist()
        resumed, _ = restart_no_repersist(s, clock)
        assert resumed.resume_match() == "live"
        assert begin.call_count == 2
        assert isinstance(resumed.match.head, dict) and resumed.match.scorer is not None
        assert resumed.match.played == scheduled.played
        assert resumed.match.nodes == scheduled.nodes

        s.control("recall")
        scheduled.departed_stations["st"] = {"node_id": "st"}
        net.simulate_status("node0", {"arm_state": "live", "match_id": "orphan",
                                      "game_byte": s._game_byte(), "synced": True}, clock["t"])
        s.adopt_orphan("orphan")
        assert begin.call_count == 3
        assert s.match.played == scheduled.played
        assert s.match.nodes == scheduled.nodes
        assert s.match.departed_stations == {"st": {"node_id": "st"}}
        assert s.match.departed_stations is not scheduled.departed_stations
        assert isinstance(s.match.head, dict) and s.match.scorer is not None


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
    assert match.nodes["old"] == "player" and match.current["player"] == "old"
    assert "old" in match.evicted and "old" in match.unbound
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


def _every_get_route_answers(s):
    from starlette.routing import Route
    from starlette.testclient import TestClient
    from brx_mcp.mc.api import create_app
    app = create_app(s)
    with TestClient(app, raise_server_exceptions=False) as client:
        routes = [route for route in app.routes if isinstance(route, Route) and "GET" in route.methods]
        assert routes
        for route in routes:
            path = re.sub(r"\{[^}]+\}", "missing", route.path)
            response = client.get(path)
            assert response.status_code < 500, (route.path, response.status_code, response.text[:200])


def test_every_get_route_answers_without_a_match():
    needs(HAVE_HTTP, "starlette + httpx")
    s = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    _every_get_route_answers(s)
    assert s.match is None


def test_every_get_route_answers_after_a_fresh_session_drops_a_played_match():
    needs(HAVE_HTTP, "starlette + httpx")
    s, _net, _clock, _players, _info = go_live()
    s.control("end")
    s.new_session(keep_roster=False)
    assert s.match is None
    _every_get_route_answers(s)


def test_no_match_reads_are_new_empties_each_time():
    s = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    s._match_unbound.discard("n")          # `_bind` does this in any phase
    s._match_evicted.add("stray")
    s._departed_match_stations["stray"] = {}
    assert s._match_evicted == set() and s._departed_match_stations == {}


def test_a_new_start_discards_the_previous_match_and_adopt_copies_departed_rows():
    s, net, clock, _players, _info = go_live()
    first = s.match
    first.nodes["old"] = "player"
    first.evicted.add("old")
    first.departed_stations["st"] = {"node_id": "st"}
    s.control("recall")                    # KIT, the Match kept with its rows
    assert s.match is first and s._departed_match_stations == {"st": {"node_id": "st"}}
    net.simulate_status("node0", {"arm_state": "live", "match_id": "m-adopted",
                                  "game_byte": s._game_byte(), "synced": True}, clock["t"])
    s.adopt_orphan("m-adopted")
    assert s.match is not first
    assert s.match.departed_stations == {"st": {"node_id": "st"}}
    assert s.match.departed_stations is not first.departed_stations
    assert "old" not in s.match.evicted and s.match.nodes.get("old") is None
