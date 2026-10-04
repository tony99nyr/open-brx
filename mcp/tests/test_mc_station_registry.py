"""Characterise station records before and after the registry extraction."""

from types import SimpleNamespace
import ast
from pathlib import Path

from brx_mcp.mc import stations
from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from brx_mcp.mc.state import Session
from brx_mcp.mc.stations import StationRegistry


def _session():
    tick = [100_000]
    session = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()), now_ms=lambda: tick[0])
    session.net.simulate_utility_hello("station-a")
    session.net.simulate_utility_hello("station-b")
    return session, tick


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
    registry = StationRegistry(SimpleNamespace())
    registry.stations["station-a"] = {"assigned": {"id": 1}}
    registry._station_id_of["station-b"] = 2
    assert registry.auto_station_id("station-c") == 3
    registry._station_departures["station-c"] = {"id": 7}
    assert registry.auto_station_id("station-c") == 7


def test_registry_keeps_range_age_without_a_session():
    tick = [100_000]
    registry = StationRegistry(SimpleNamespace(now_ms=lambda: tick[0]))
    first = registry.range_fields(None, -70, {"tx_power": "low"})
    tick[0] += 2_000
    kept = registry.range_fields({"threshold": -70, "at": 90_000, **first}, -70, {})
    assert kept == first


def test_registry_warns_about_missing_respawn_station_without_a_session():
    registry = StationRegistry(SimpleNamespace(config={"mode": "tdm", "respawn": {"type": "scanner"}}))
    assert registry.station_warnings() == [
        "SETUP: NO RESPAWN STATION IS ASSIGNED (RESPAWN IS SET TO STATION, SO A DOWNED PLAYER CAN ONLY COME "
        "BACK AT A STATION): ASSIGN A STATION AS RESPAWN IN ITEMS AND ARM IT",
    ]


def test_registry_view_and_recap_row_without_a_session():
    registry = StationRegistry(SimpleNamespace(
        now_ms=lambda: 100_000, nodes={"station-a": {"stale": False}},
        phase="muster", config={}, _game_byte=lambda: 1, _node_loss=lambda _node, _kind: 0,
    ))
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
