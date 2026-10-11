import ast
import inspect
from pathlib import Path

from brx_mcp.mc.powerup_ledger import PowerupFeed, PowerupLedger, PowerupMatch, PowerupStations


class FakePowerupStations:
    def __init__(self):
        self.item = {"kind": "overshield", "amount": 1, "spawn_every_s": 30,
                     "first_at_s": 10, "name": "SHIELD", "color": "#ffffff"}
        self.assigned = {"station-a": {"id": 7}, "station-b": {"id": 8}}

    def item_stations(self):
        return [(nid, assignment, self.item) for nid, assignment in self.assigned.items()]

    def powerup_slots(self):
        return []

    def assignments(self):
        return list(self.assigned.items())

    def assignment(self, nid):
        return self.assigned.get(nid)

    def required_assignment(self, nid):
        return self.assigned[nid]


class FakePowerupMatch:
    def __init__(self, match_id):
        self.match_id = match_id

    def powerup_enabled(self):
        return True

    def powerup_context(self):
        return (self.match_id, 0) if self.match_id is not None else None

    def powerup_active_match(self):
        return self.match_id

    def powerup_pickup_time(self, src, raw, t_recv, seq):
        return None, False

    def powerup_t_match(self, now):
        return now // 1000


class FakePowerupFeed:
    def __init__(self):
        self.feed_lines = []
        self.feed_edits = []

    def powerup_feed(self, entry):
        entry["id"] = len(self.feed_lines) + 1
        self.feed_lines.append(entry)

    def powerup_edit_feed(self, rec, old, fid, new, station_id):
        self.feed_edits.append((rec, old, fid, new, station_id))

class FakePowerupPush:
    def __init__(self):
        self.station_pushes = []

    def __call__(self, nid, kind, body):
        assert kind == "station_update"
        self.station_pushes.append((nid, body))


def _ledger(match_id="match-1", now=20_000, players=None):
    stations = FakePowerupStations()
    match = FakePowerupMatch(match_id)
    feed = FakePowerupFeed()
    push = FakePowerupPush()
    roster = players if players is not None else {}
    ledger = PowerupLedger(stations, push, lambda: roster, lambda: now, match, feed, lambda: None)
    return ledger, feed, push


def _taken_snapshot(match_id="match-1"):
    return {"match_id": match_id, "go": 0, "st": {
                      "station-a": {"item": {}, "available": False, "next_k": 1, "since": 10_000,
                      "taken_by": 12, "taken": True, "by_station": False,
                      "line": "PLAYER TOOK SHIELD", "fid": 41, "hist": []}
    }}


def test_restored_taken_item_catches_up_and_archives_taker_once():
    ledger, _feed, push = _ledger(now=40_001)
    ledger.from_snapshot(_taken_snapshot())

    ledger.tick(40_001)

    row = ledger.rows["station-a"]
    assert ledger.match_id == "match-1", "the ledger adopts the restored row for the matching match"
    assert row["available"] is True, "the item is available after its missed spawn fires"
    assert row["taken_by"] is None, "the new spawn has no taker"
    assert row["hist"] == [{"since": 10_000, "until": 40_000, "taken_by": 12,
                            "by_station": False, "line": "PLAYER TOOK SHIELD", "fid": 41}], \
        "the prior taker is archived with the ended spawn window"
    pushed = [nid for nid, _body in push.station_pushes]
    assert pushed.count("station-a") == 1 and pushed.count("station-b") == 1 and len(pushed) == 2, \
        "each station receives exactly one catch-up push"


def test_different_match_does_not_adopt_restored_row():
    ledger, _feed, _push = _ledger(match_id="match-2", now=10_001)
    ledger.from_snapshot(_taken_snapshot("match-1"))

    ledger.tick(10_001)

    row = ledger.rows["station-a"]
    assert ledger.match_id == "match-2", "the ledger starts the active match"
    assert row["taken_by"] is None and row["hist"] == [], "the other match's taker and history are not adopted"
    assert row["available"] is True, "the active match schedule determines availability"


def test_pickup_for_station_without_row_changes_nothing():
    ledger, feed, push = _ledger(now=10_001)
    ledger.match_id = "match-1"
    ledger.go_live_t = 0

    ledger.pickup({"match_id": "match-1", "station_id": 7, "t": 10_000, "player_id": "p"},
                  t_recv=10_001, parked=False)

    assert ledger.rows == {}, "a pickup cannot create a missing station row"
    assert feed.feed_lines == [] and feed.feed_edits == [], "an unmatched pickup writes no feed record"
    assert push.station_pushes == [], "an unmatched pickup pushes no station update"


def test_fakes_spawn_and_take_without_session():
    players = {"p": {"player_num": 12, "display": "ALPHA"}}
    ledger, feed, push = _ledger(now=10_001, players=players)

    ledger.tick(10_001)
    assert ledger.rows["station-a"]["available"] is True
    ledger.pickup({"match_id": "match-1", "station_id": 7, "t": 10_001, "player_id": "p"},
                  t_recv=10_001, parked=False)

    assert ledger.rows["station-a"]["available"] is False
    assert ledger.rows["station-a"]["taken_by"] == 12
    assert feed.feed_lines[-1]["text"] == "ALPHA TOOK SHIELD · STATION #7"
    assert push.station_pushes[-1][1]["available"] is False


def test_ledger_has_no_state_import():
    source = (Path(__file__).resolve().parents[1] / "brx_mcp/mc/powerup_ledger.py").read_text()
    imports = (node for node in ast.walk(ast.parse(source)) if isinstance(node, (ast.Import, ast.ImportFrom)))
    for node in imports:
        names = [node.module or "", *(alias.name for alias in node.names)] if isinstance(node, ast.ImportFrom) \
            else [alias.name for alias in node.names]
        assert all("state" not in name.split(".") for name in names)


def _assert_implements(protocol, impl):
    """Check the real object's methods against the Protocol names and required parameters."""
    for name, member in vars(protocol).items():
        if name.startswith("_") or not callable(member):
            continue
        assert hasattr(impl, name), f"{impl.__name__} is missing {protocol.__name__}.{name}"
        declared = inspect.signature(member).parameters
        actual = inspect.signature(getattr(impl, name)).parameters
        required = {n for n, p in declared.items() if n != "self" and p.default is inspect.Parameter.empty}
        extra = {n for n, p in actual.items() if n != "self" and p.default is inspect.Parameter.empty}
        assert required <= actual.keys(), f"{impl.__name__}.{name} misses {required - actual.keys()}"
        assert extra <= declared.keys(), f"{impl.__name__}.{name} requires {extra - declared.keys()}"


def test_real_collaborators_satisfy_powerup_protocols():
    from brx_mcp.mc.state import Session
    from brx_mcp.mc.stations import StationRegistry

    _assert_implements(PowerupStations, StationRegistry)
    _assert_implements(PowerupMatch, Session)
    _assert_implements(PowerupFeed, Session)
