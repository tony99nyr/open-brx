"""Characterise station records before and after the registry extraction."""

from types import SimpleNamespace
import ast
import inspect
from pathlib import Path
from typing import get_type_hints

from brx_mcp.mc import stations
from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from brx_mcp.mc.match import Match
from brx_mcp.mc.state import Session
from brx_mcp.mc.stations import StationChanges, StationFeed, StationMatch, StationRegistry, StationRoster


def _session():
    tick = [100_000]
    session = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()), now_ms=lambda: tick[0])
    session.net.simulate_utility_hello("station-a")
    session.net.simulate_utility_hello("station-b")
    return session, tick


def _registry(*, now_ms=lambda: 100_000, config=None, nodes=None, phase="muster", in_play=None,
              game_byte=None, node_loss=None, enabled=lambda: True):
    """Build the registry from small collaborators, without a Session."""
    roster = SimpleNamespace(
        config=config or {}, nodes=nodes or {}, players={}, node_player={}, teams=[], lobby_pushed=False,
        _node_loss=node_loss or (lambda _node, _kind: 0),
    )
    match = SimpleNamespace(
        match=Match(), phase=phase, _game_byte=game_byte or (lambda: 1),
        _operator_t_match=lambda now: 0, in_play=in_play or (lambda: False), is_adopted=lambda: False,
    )
    changes = SimpleNamespace(
        _after_station_change=lambda slots, brief=None: None, _brief_key=lambda: None,
        _changed=lambda: None, _refuse_station_change_in_play=lambda: None,
        _validate=lambda roster=None: {},
    )
    feed = SimpleNamespace(_log=lambda *args, **kwargs: None, _on_feed=lambda entry: None)
    registry = StationRegistry(
        compiler=Compiler(), net=FakeNet(), match=match, roster=roster, feed=feed, changes=changes,
        now_ms=now_ms, powerups_enabled=enabled, pu_state=lambda nid: (None, None, None),
        note_departed_station=lambda nid, row: None, station_sync_state=lambda: (None, {}),
        game_no_started=lambda: False,
    )
    registry._fakes = {StationMatch: match, StationRoster: roster, StationFeed: feed, StationChanges: changes}
    return registry, roster


def test_registry_fakes_match_the_protocols():
    """The fakes above must keep every member the Protocols declare, or a test passes against a shape Session lacks."""
    registry, _ = _registry()
    for protocol, fake in registry._fakes.items():
        names = set(get_type_hints(protocol)) | {n for n, m in vars(protocol).items()
                                                 if not n.startswith("__") and (callable(m) or isinstance(m, property))}
        assert names, protocol.__name__
        for name in names:
            assert hasattr(fake, name), f"the {protocol.__name__} fake misses {name}"


def test_station_module_does_not_import_state():
    source = Path(stations.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)
    imports = [node for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom))]
    assert all((node.module or "").split(".")[-1] != "state"
               and all(alias.name != "state" for alias in node.names)
               for node in imports if isinstance(node, ast.ImportFrom))
    assert all("brx_mcp.mc.state" not in alias.name for node in imports
               if isinstance(node, ast.Import) for alias in node.names)


def test_station_id_reservation_and_departure_restore_shape():
    session, tick = _session()
    first = session.set_station("station-a", {"kind": "respawn", "team": "blue"})
    assert first["assigned"]["id"] == 1
    session.station_registry.record_departure("station-a", "released")
    assert session._station_departures["station-a"]["restore"] == {
        "kind": "respawn", "team": 1, "threshold": 0,
    }
    assert session.clear_station("station-a")
    tick[0] += 10
    second = session.set_station("station-b", {"kind": "respawn", "team": "blue"})
    assert second["assigned"]["id"] == 2
    assert session.station_registry.auto_station_id("station-a") == 1


def test_range_fields_keep_the_original_age_and_source_on_an_unchanged_value():
    session, tick = _session()
    first = session.station_registry.range_fields(None, -70, {"tx_power": "low"})
    assert first == {"threshold_set_at": 100_000, "threshold_src": "mc",
                     "tx_power": "low", "tx_power_set_at": 100_000, "tx_power_src": "mc"}
    tick[0] += 500
    kept = session.station_registry.range_fields({"threshold": -70, "at": 99_000, **first}, -70, {})
    assert kept == first


def test_station_warning_and_lock_keep_their_exact_operator_voice():
    session, _ = _session()
    session.set_config({"respawn": {"type": "scanner"}})
    assert session._station_warnings() == [
        "SETUP: NO RESPAWN STATION IS ASSIGNED (RESPAWN IS SET TO STATION, SO A DOWNED PLAYER CAN ONLY COME "
        "BACK AT A STATION): ASSIGN A STATION AS RESPAWN IN ITEMS AND ARM IT",
    ]
    session.set_station("station-a", {"kind": "respawn", "team": "blue"})
    session.arm_stations()
    assert session.stations["station-a"]["lock"]["at"] == 100_000


def test_registry_allocates_reserved_ids_without_a_session():
    registry, _ = _registry()
    registry.stations["station-a"] = {"assigned": {"id": 1}}
    registry._station_id_of["station-b"] = 2
    assert registry.auto_station_id("station-c") == 3
    registry._station_departures["station-c"] = {"id": 7}
    assert registry.auto_station_id("station-c") == 7


def test_registry_keeps_range_age_without_a_session():
    tick = [100_000]
    registry, _ = _registry(now_ms=lambda: tick[0])
    first = registry.range_fields(None, -70, {"tx_power": "low"})
    tick[0] += 2_000
    kept = registry.range_fields({"threshold": -70, "at": 90_000, **first}, -70, {})
    assert kept == first


def test_registry_warns_about_missing_respawn_station_without_a_session():
    registry, _ = _registry(config={"mode": "tdm", "respawn": {"type": "scanner"}})
    assert registry.station_warnings() == [
        "SETUP: NO RESPAWN STATION IS ASSIGNED (RESPAWN IS SET TO STATION, SO A DOWNED PLAYER CAN ONLY COME "
        "BACK AT A STATION): ASSIGN A STATION AS RESPAWN IN ITEMS AND ARM IT",
    ]


def test_registry_view_and_recap_row_without_a_session():
    registry, _ = _registry(nodes={"station-a": {"stale": False}})
    registry.stations["station-a"] = {
        "assigned": {"kind": "respawn", "team": 1, "id": 4, "threshold": 0, "at": 90_000},
        "report": {"revives": 0}, "last_seen_ms": 99_000,
    }
    view = registry.station_view("station-a")
    assert view["online"] is True
    assert view["last_seen_ms"] == 1_000
    assert view["range"]["threshold"] == 0
    assert StationRegistry._station_recap_row(view) == {
        "node_id": "station-a", "kind": "respawn", "id": 4, "team": 1, "heard": True, "revives": 0,
    }


def test_registry_assigns_station_with_small_collaborators():
    registry, roster = _registry(nodes={"station-a": {"node_id": "station-a", "node_type": "utility"}})
    view = registry.set_station("station-a", {"kind": "respawn", "team": "any"})
    assert view["assigned"]["id"] == 1
    assert registry.assignment("station-a") == view["assigned"]
    assert roster.nodes["station-a"]["node_type"] == "utility"
    node = roster.nodes["station-a"]
    registry.set_station("station-a", {"kind": "respawn", "team": "any"})
    assert roster.nodes["station-a"] is node            # an existing node record is kept, not replaced
    del roster.nodes["station-a"]                       # the station record survives its node record
    registry.set_station("station-a", {"kind": "respawn", "team": "any"})
    assert roster.nodes["station-a"] == {"node_id": "station-a", "node_type": "utility", "arm_state": "idle",
                                         "synced": False, "last_seen_ms": 0}


def test_session_implements_station_protocols():
    session, _ = _session()
    for protocol in (StationMatch, StationRoster, StationFeed, StationChanges):
        for name in get_type_hints(protocol):
            assert hasattr(session, name), f"Session misses {protocol.__name__}.{name}"
        for name, member in vars(protocol).items():
            if isinstance(member, property):
                assert hasattr(session, name), f"Session misses {protocol.__name__}.{name}"
                continue
            if name.startswith("__") or not callable(member):
                continue
            actual = getattr(session, name, None)
            assert callable(actual), f"Session misses {protocol.__name__}.{name}"
            declared = inspect.signature(member).parameters
            implemented = inspect.signature(actual).parameters
            required = {key for key, value in declared.items()
                        if key != "self" and value.default is inspect.Parameter.empty}
            assert required <= implemented.keys(), f"Session.{name} misses {required - implemented.keys()}"


def test_station_registry_clock_and_powerup_flag_are_late_bound():
    session, _ = _session()
    session.now_ms = lambda: 234_567
    assert session.station_registry.range_fields(None, -70, {})["threshold_set_at"] == 234_567
    session.set_station("station-a", {"kind": "powerup", "team": "any", "item_preset": "rockets"})
    assert "item" in session.station_registry.station_ids()[0]
    session.powerups_enabled = False
    assert "item" not in session.station_registry.station_ids()[0]
    session.powerups_enabled = True
    assert "item" in session.station_registry.station_ids()[0]


def test_station_sync_state_follows_a_replaced_pending_map():
    """F401: Session replaces `_sync_pending` and sets `_match_end_t` at the whistle; the registry must read both late."""
    session, tick = _session()
    assert session.station_registry.station_sync_warnings() == []
    session._match_end_t = 50_000
    session._sync_pending = {"station-a": "STICK 1"}
    session.nodes["station-a"]["last_seen_ms"] = 40_000
    assert session.station_registry.station_sync_warnings() == [
        "STICK 1 HAS NOT SYNCED THE LAST MATCH: BRING IT INTO WI-FI BEFORE YOU LOAD, OR ITS RESULT IS LOST"]
