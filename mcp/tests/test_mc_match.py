"""Slice 1: match data, Session lifetimes and no-match readers."""
import ast
import logging
import json
import pathlib
import re
from types import SimpleNamespace
from unittest.mock import patch

from _skip import needs
from _session import go_live, mk_kit_session, online, persisting_live, restart_no_repersist
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.match import Match, parse_snapshot
from brx_mcp.mc.state import Session
from brx_mcp.chaos.invariants import retired_recap_matches_ledger
from brx_mcp.chaos.registry import InvariantError

try:
    import starlette  # noqa: F401
    import httpx  # noqa: F401
    HAVE_HTTP = True
except ImportError:
    HAVE_HTTP = False


def test_session_phase_writes_use_one_funnel():
    path = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp" / "mc" / "state.py"
    source = path.read_text()

    def write_sites(text: str) -> list[str]:
        tree = ast.parse(text)
        classes = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Session"]
        assert len(classes) == 1, "expected one Session class"
        members = classes[0].body
        assert sum(isinstance(node, ast.FunctionDef) and node.name == "_set_phase" for node in members) == 1
        return [member.name if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)) else "<class>"
                for member in members for node in ast.walk(member)
                if isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Store)
                and node.attr == "phase" and isinstance(node.value, ast.Name) and node.value.id == "self"]

    assert write_sites(source) == ["__init__", "_set_phase"]
    original = '        return self._set_phase("armed" if now < go else "live")'
    assert source.count(original) == 1
    mutant = source.replace(original, '        self.phase = "kit"\n' + original, 1)
    assert write_sites(mutant) == ["__init__", "_set_phase", "_promote_phase"]


def test_no_module_writes_a_phase_outside_the_funnel():
    """Every .py under brx_mcp: a phase store (attribute, setattr or __dict__) only in Session._set_phase and the
    __init__ declaration, so the console mock's copy of the transitions stays exact."""
    root = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp"

    def stores(text: str) -> list[str]:
        tree = ast.parse(text)
        out = []
        for fn in [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))] + [tree]:
            body = fn.body if fn is not tree else [n for n in tree.body
                                                 if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))]
            for node in (x for stmt in body for x in ast.walk(stmt)):
                name = fn.name if fn is not tree else "<module>"
                if isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Store) and node.attr == "phase":
                    out.append(name)
                elif (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "setattr"
                      and len(node.args) >= 2 and isinstance(node.args[1], ast.Constant) and node.args[1].value == "phase"):
                    out.append(name)
                elif (isinstance(node, ast.Subscript) and isinstance(node.ctx, ast.Store)
                      and isinstance(node.value, ast.Attribute) and node.value.attr == "__dict__"
                      and isinstance(node.slice, ast.Constant) and node.slice.value == "phase"):
                    out.append(name)
        return sorted(set(out))

    found = {str(p.relative_to(root)): hits for p in sorted(root.rglob("*.py")) if (hits := stores(p.read_text()))}
    assert found == {"mc/state.py": ["__init__", "_set_phase"]}, found
    assert stores("def route(s):\n    s.phase = 'lobby'") == ["route"]
    assert stores("def f(self):\n    setattr(self.host, 'phase', 'kit')") == ["f"]
    assert stores("def f(self):\n    self.__dict__['phase'] = 'kit'") == ["f"]


def test_set_phase_changes_nothing_but_the_phase():
    """L10: the whole Session state before and after, with a live listener and a persist path, differs only in phase."""
    import tempfile
    s = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    calls = []
    s.on_change(lambda: calls.append("change"))
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_dirty = True

    atoms = (str, int, float, bool, type(None))

    def freeze(value):
        """Data by content, all the way down; anything else (an object, a callback) by identity, plus a frozen copy of
        its own fields one level deep, so a change inside the net or the registry still shows."""
        if isinstance(value, atoms):
            return value
        if isinstance(value, dict):
            return ("dict", tuple((repr(k), freeze(v)) for k, v in value.items()))
        if isinstance(value, (list, tuple)):
            return (type(value).__name__, tuple(freeze(v) for v in value))
        if isinstance(value, (set, frozenset)):
            return ("set", tuple(sorted(repr(freeze(v)) for v in value)))
        return ("object", id(value))

    def snapshot():
        out = {}
        for key, value in vars(s).items():
            out[key] = freeze(value)
            fields = getattr(value, "__dict__", None)
            if isinstance(fields, dict) and not isinstance(value, type):
                out[key + ".__dict__"] = freeze(dict(fields))
        return out

    before = snapshot()
    pushed = len(s.net.pushed)
    with patch.object(s, "station_registry") as registry:
        assert s._set_phase("kit") == "kit"
        assert registry.mock_calls == []
    after = snapshot()
    changed = {k for k in set(before) | set(after) if before.get(k) != after.get(k)}
    assert changed == {"phase"}, changed
    assert calls == [] and len(s.net.pushed) == pushed and not s._persist_path.exists()


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


def test_rebind_clears_unbound_and_phase_eligible_eviction():
    match = Match(unbound={"n"}, evicted={"n"})
    assert match.rebind("n", clear_eviction=False) is False
    assert match.unbound == set() and match.evicted == {"n"}
    assert match.rebind("n", clear_eviction=True) is True
    assert match.evicted == set()


def test_to_snapshot_without_session_keeps_match_merge_and_order():
    class ScorerStub:
        joined_t = {"p1": 123}
        cap_recv = 456
        station_possession_ms = {"7": {0: 5000}}

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
        "joined_t": {"p1": 123}, "cap_recv": 456, "station_possession": {"7": {"0": 5000}}, "alerts": {"leader": "p1"},
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


def test_no_module_references_the_removed_match_properties():
    """Guard old match fields, then Session's removed head and scorer aliases."""
    root = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp"
    removed = {"_match_players", "_match_nodes", "_match_current", "_match_evicted",
               "_match_unbound", "_departed_match_stations", "_match_stations"}
    for path in sorted(root.rglob("*.py")):
        tree = ast.parse(path.read_text())
        names = {node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)}
        names.update(node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef))
        names.update(node.value for node in ast.walk(tree)
                     if isinstance(node, ast.Constant) and isinstance(node.value, str))
        assert not (names & removed), (path, names & removed)

    def removed_session_accesses(source: str, *, chaos: bool = False) -> list[str]:
        tree = ast.parse(source)
        old = {"start_info", "scorer"}
        hits = []
        session_class = next((node for node in tree.body if isinstance(node, ast.ClassDef)
                              and node.name == "Session"), None)
        if session_class is not None:
            hits.extend(node.name for node in session_class.body
                        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in old)
            hits.extend(node.target.id for node in session_class.body
                        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name)
                        and node.target.id in old)
            hits.extend(node.attr for node in ast.walk(session_class)
                        if isinstance(node, ast.Attribute) and node.attr in old
                        and isinstance(node.value, ast.Name) and node.value.id == "self")
            hits.extend(node.args[1].value for node in ast.walk(session_class)
                        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                        and node.func.id in {"getattr", "setattr", "delattr", "hasattr"}
                        and len(node.args) >= 2 and isinstance(node.args[0], ast.Name)
                        and node.args[0].id == "self" and isinstance(node.args[1], ast.Constant)
                        and node.args[1].value in old)
        if chaos:
            # The chaos modules use world.session, self.session and local Session handles.
            scopes = [node for node in ast.walk(tree)
                      if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]
            scopes.append(tree)
            for scope in scopes:
                nodes = [node for statement in scope.body for node in ast.walk(statement)
                         if not isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))]
                aliases = {"session", "s"}     # fakes, routes and chaos call a Session `s` or `session`
                if isinstance(scope, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    aliases.update(a.arg for a in scope.args.args if a.arg in ("s", "session", "sess"))

                def is_session(node: ast.expr) -> bool:
                    return (isinstance(node, ast.Name) and node.id in aliases) or (
                        isinstance(node, ast.Attribute) and node.attr in ("session", "s", "play"))   # world.session, ctx.s, registry.play

                for node in nodes:
                    if isinstance(node, (ast.Assign, ast.AnnAssign)):
                        value = node.value
                        if is_session(value) or (isinstance(value, ast.Call)
                                                 and isinstance(value.func, ast.Name)
                                                 and value.func.id == "Session"):
                            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                            aliases.update(t.id for t in targets if isinstance(t, ast.Name))

                hits.extend(node.attr for node in nodes
                            if isinstance(node, ast.Attribute) and node.attr in old and is_session(node.value))
                hits.extend(node.args[1].value for node in nodes
                            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                            and node.func.id in {"getattr", "setattr", "delattr", "hasattr"}
                            and len(node.args) >= 2 and is_session(node.args[0])
                            and isinstance(node.args[1], ast.Constant) and node.args[1].value in old)
        return hits

    # Session itself by `self`; every other module that holds a Session by its usual names (fakes, routes, the
    # station registry, chaos).
    held = {root / "mc" / "fakes.py", root / "mc" / "stations.py", *(root / "mc" / "routes").glob("*.py")}
    scanned = 0
    for path in sorted(root.rglob("*.py")):
        if path.name == "state.py":
            assert "class Session" in path.read_text(), "the Session class moved: point this guard at it"
        if path.name == "state.py" or "chaos" in path.parts or path in held:
            scanned += 1
            assert not (hits := removed_session_accesses(path.read_text(), chaos=path.name != "state.py")), (path, hits)
    assert scanned >= 10, f"the guard scanned only {scanned} files"

    # Break-check the rule itself without treating Match.scorer as a removed field.
    assert removed_session_accesses("class Session:\n def f(self): return self.scorer") == ["scorer"]
    assert removed_session_accesses("class Session:\n def f(self): return getattr(self, 'start_info')") == ["start_info"]
    assert removed_session_accesses("world.session.start_info", chaos=True) == ["start_info"]
    assert removed_session_accesses("s = Session()\ngetattr(s, 'scorer')", chaos=True) == ["scorer"]
    assert removed_session_accesses("def f(world):\n s = world.session\n return s.scorer", chaos=True) == ["scorer"]
    assert removed_session_accesses("match.scorer\nretired.scorer", chaos=True) == []
    assert removed_session_accesses("def inv(s):\n return s.scorer", chaos=True) == ["scorer"]
    assert removed_session_accesses("def f(ctx):\n return ctx.s.start_info", chaos=True) == ["start_info"]
    assert removed_session_accesses("class R:\n def f(self):\n  return self.play.scorer", chaos=True) == ["scorer"]


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


def test_no_match_readers_return_empty_values_and_aliases_are_absent():
    s = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    assert s.match is None
    empty = s._m()
    assert empty.head is None and empty.scorer is None
    assert empty.played is None and empty.frozen_stations is None
    assert empty.nodes == {} and empty.current == {}
    assert empty.evicted == set() and empty.unbound == set()
    assert empty.departed_stations == {}
    assert not hasattr(Session, "start_info") and not hasattr(Session, "scorer")
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
    old_scorer = match.scorer
    old_stations = match.frozen_stations
    old_evicted = match.evicted
    old_whistle = match.whistle_base
    s.next_match()
    retired = s.retired
    assert isinstance(retired, Match) and retired.frozen
    assert retired.scorer is old_scorer and retired.frozen_stations is old_stations
    assert retired.evicted == old_evicted and retired.evicted is not old_evicted
    assert retired.whistle_base == old_whistle and retired.whistle_base is not old_whistle
    _assert_cleared_but_kept(s, match, bindings)
    s.new_session(keep_roster=False)
    assert s.match is None and s.retired is None
    assert s._m().nodes == {} and s._m().evicted == set()


def test_frozen_match_refuses_evict_unbind_and_whistle():
    s, _net, _clock, _players, _info = go_live()
    s.control("end")
    s.next_match()
    retired = s.retired
    assert retired is not None and retired.frozen
    before = (set(retired.evicted), set(retired.unbound), dict(retired.whistle_base))
    for write in (lambda: retired.evict("late"), lambda: retired.unbind("late"),
                  lambda: retired.rebind("late", clear_eviction=True),
                  lambda: retired.whistle({"late": "player"})):
        try:
            write()
            assert False, "a frozen Match accepted a write"
        except RuntimeError:
            pass
    assert (retired.evicted, retired.unbound, retired.whistle_base) == before


def test_chaos_retired_invariant_reads_the_match_and_reports_a_wrong_scorer():
    good = SimpleNamespace(match_id="old", kills=[], post_end=[])
    wrong = SimpleNamespace(match_id="wrong")
    # The legacy field is a decoy: reading it would make this invariant pass.
    session = SimpleNamespace(retired=Match(scorer=wrong, frozen=True),
                              _retired_scorer=good, match=Match(), scorer=None,
                              _ended={"old": {"recap": {"rows": []}}}, store=None)
    world = SimpleNamespace(retired_flushed="old", session=session, scorers={}, ingests={},
                            ledger=SimpleNamespace(delivered=lambda *_: []), nodes=[], players=[],
                            num_to_pid=lambda: {})
    try:
        retired_recap_matches_ledger(world)
        assert False, "the invariant accepted the wrong retired scorer"
    except InvariantError as exc:
        assert exc.name == "retired_recap_matches_ledger"
    # The inverse: the right scorer on `retired` (and a wrong decoy on the old field) passes, so the invariant reads `retired`.
    session.retired, session._retired_scorer = Match(scorer=good, frozen=True), wrong
    retired_recap_matches_ledger(world)


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
        state = client.get("/api/state")         # the console's own read: a full answer, not only "not a 500"
        assert state.status_code == 200 and state.json().get("phase") == s.phase, state.text[:200]


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
    s._m().unbound.discard("n")
    s._m().evicted.add("stray")
    assert s._m().evicted == set() and s._m().departed_stations == {}
    try:                                   # the registry's departure row has no match to land in: refused, not lost
        s.station_registry.note_departed_station("stray", {})
        assert False, "a departed row with no match was accepted"
    except RuntimeError:
        pass


def test_log_marks_current_match_eviction_in_every_phase():
    saved = []
    s = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    s.store = SimpleNamespace(log=lambda *args: saved.append(args[-1]))
    s.match = Match(evicted={"evicted"})
    for phase in ("kit", "armed", "live", "recap", "lobby"):
        s.phase = phase
        s._log("evicted", "note", {"match_id": "old"}, 1)
        assert saved[-1][s._EVICTED_MARK] is True, phase
    s.match = None
    s._log("evicted", "note", {"match_id": "old"}, 1)
    assert s._EVICTED_MARK not in saved[-1]


def test_a_new_start_discards_the_previous_match_and_adopt_copies_departed_rows():
    s, net, clock, _players, _info = go_live()
    first = s.match
    first.nodes["old"] = "player"
    first.evicted.add("old")
    first.departed_stations["st"] = {"node_id": "st"}
    s.control("recall")                    # KIT, the Match kept with its rows
    assert s.match is first and s.match.departed_stations == {"st": {"node_id": "st"}}
    net.simulate_status("node0", {"arm_state": "live", "match_id": "m-adopted",
                                  "game_byte": s._game_byte(), "synced": True}, clock["t"])
    s.adopt_orphan("m-adopted")
    assert s.match is not first
    assert s.match.departed_stations == {"st": {"node_id": "st"}}
    assert s.match.departed_stations is not first.departed_stations
    assert "old" not in s.match.evicted and s.match.nodes.get("old") is None


class _Warnings(logging.Handler):
    def __init__(self):
        super().__init__(logging.WARNING)
        self.lines: list[str] = []

    def emit(self, record):
        self.lines.append(record.getMessage())


def _resume_with(block_edit):
    """Restart a persisted LIVE match after editing its saved block; return the resume result and the warnings."""
    s, _net, clock, _ps, _info = persisting_live()
    s._persist_last = 0.0
    s._persist()
    saved = json.loads(s._persist_path.read_text(encoding="utf-8"))
    block_edit(saved["match"])
    s._persist_path.write_text(json.dumps(saved), encoding="utf-8")
    resumed, _ = restart_no_repersist(s, clock)
    h = _Warnings()
    logger = logging.getLogger("brx.mc")
    logger.addHandler(h)
    try:
        return resumed.resume_match(), h.lines
    finally:
        logger.removeHandler(h)


def test_resume_warns_on_an_unreadable_block_and_on_bad_departed_rows():
    result, lines = _resume_with(lambda m: m.pop("config"))
    assert result is None
    assert "session snapshot names a match MC cannot read -- not resumed" in lines
    result, lines = _resume_with(lambda m: m.__setitem__("departed_stations", [{"node_id": 7}, "x"]))
    assert result is not None
    assert "session snapshot has 2 invalid or duplicate departed station row(s) -- ignored" in lines
