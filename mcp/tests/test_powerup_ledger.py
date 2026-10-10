from brx_mcp.mc.powerup_ledger import PowerupLedger


class FakePowerupHost:
    def __init__(self, match_id="match-1", now=20_000):
        self.match_id = match_id
        self.now = now
        self.item = {"kind": "overshield", "amount": 1, "spawn_every_s": 30,
                     "first_at_s": 10, "name": "SHIELD", "color": "#ffffff"}
        self.assignments = {"station-a": {"id": 7}, "station-b": {"id": 8}}
        self.feed_lines = []
        self.feed_edits = []
        self.station_pushes = []
        self.changed = 0

    def powerup_enabled(self):
        return True

    def powerup_context(self):
        return (self.match_id, 0) if self.match_id is not None else None

    def powerup_active_match(self):
        return self.match_id

    def powerup_item_stations(self):
        return [(nid, assignment, self.item) for nid, assignment in self.assignments.items()]

    def powerup_slots(self):
        return []

    def powerup_assignments(self):
        return list(self.assignments.items())

    def powerup_assignment(self, nid):
        return self.assignments.get(nid)

    def powerup_required_assignment(self, nid):
        return self.assignments[nid]

    def powerup_now(self):
        return self.now

    def powerup_player(self, player_id):
        return None

    def powerup_player_num(self, num):
        return None

    def powerup_pickup_time(self, src, raw, t_recv, seq):
        return None, False

    def powerup_t_match(self, now):
        return now // 1000

    def powerup_feed(self, entry):
        self.feed_lines.append(entry)

    def powerup_edit_feed(self, rec, old, fid, new, station_id):
        self.feed_edits.append((rec, old, fid, new, station_id))

    def powerup_push(self, nid, body):
        self.station_pushes.append((nid, body))

    def powerup_changed(self):
        self.changed += 1


def _taken_snapshot(match_id="match-1"):
    return {"match_id": match_id, "go": 0, "st": {
                      "station-a": {"item": {}, "available": False, "next_k": 1, "since": 10_000,
                      "taken_by": 12, "taken": True, "by_station": False,
                      "line": "PLAYER TOOK SHIELD", "fid": 41, "hist": []}
    }}


def test_restored_taken_item_catches_up_and_archives_taker_once():
    host = FakePowerupHost(now=40_001)
    ledger = PowerupLedger(host)
    ledger.from_snapshot(_taken_snapshot())

    ledger.tick(host.now)

    row = ledger.rows["station-a"]
    assert ledger.match_id == "match-1", "the ledger adopts the restored row for the matching match"
    assert row["available"] is True, "the item is available after its missed spawn fires"
    assert row["taken_by"] is None, "the new spawn has no taker"
    assert row["hist"] == [{"since": 10_000, "until": 40_000, "taken_by": 12,
                            "by_station": False, "line": "PLAYER TOOK SHIELD", "fid": 41}], \
        "the prior taker is archived with the ended spawn window"
    pushed = [nid for nid, _body in host.station_pushes]
    assert pushed.count("station-a") == 1 and pushed.count("station-b") == 1 and len(pushed) == 2, \
        "each station receives exactly one catch-up push"


def test_different_match_does_not_adopt_restored_row():
    host = FakePowerupHost(match_id="match-2", now=10_001)
    ledger = PowerupLedger(host)
    ledger.from_snapshot(_taken_snapshot("match-1"))

    ledger.tick(host.now)

    row = ledger.rows["station-a"]
    assert ledger.match_id == "match-2", "the ledger starts the active match"
    assert row["taken_by"] is None and row["hist"] == [], "the other match's taker and history are not adopted"
    assert row["available"] is True, "the active match schedule determines availability"


def test_pickup_for_station_without_row_changes_nothing():
    host = FakePowerupHost(now=10_001)
    ledger = PowerupLedger(host)
    ledger.match_id = "match-1"
    ledger.go_live_t = 0

    ledger.pickup({"match_id": "match-1", "station_id": 7, "t": 10_000, "player_id": "p"},
                  t_recv=10_001, parked=False)

    assert ledger.rows == {}, "a pickup cannot create a missing station row"
    assert host.feed_lines == [] and host.feed_edits == [], "an unmatched pickup writes no feed record"
    assert host.station_pushes == [], "an unmatched pickup pushes no station update"
