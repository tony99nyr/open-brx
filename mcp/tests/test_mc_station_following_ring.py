"""F658: a following hill retains each game's own tally in its heartbeat ring."""
from __future__ import annotations

from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from brx_mcp.mc.state import Session


def _ring_session(mode):
    """A session in `mode` with two rostered players whose phones said hello, and a phone hill (id 3) on util-1."""
    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()))
    s.set_config({"mode": mode, "station_source": "phone"})
    teams = [t["team_id"] for t in s.config["teams"]]
    for i, g in enumerate([g["gun_id"] for g in s.armory.list()][:2]):
        s.add_player(f"P{i}", teams[i % len(teams)], g, "male")
    for i, p in enumerate(s.players.values()):
        s.net.simulate_hello(f"phone-{i}", p["gun_id"])
    return s


def test_f658_following_hill_seeds_armed_game_tally_from_its_ring():
    s = _ring_session("koth")
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "control", "team": "any", "id": 3})
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    s.phase = "live"
    tid = str(s.config["teams"][0]["tid"])
    t0 = s.now_ms()
    s.net.simulate_status("util-1", {"node_id": "util-1", "role": "utility", "kind": "control", "station_id": 3,
                                     "control": {"game": 2, "follows": True, "owner": 1, "hold_ms": {tid: 900},
                                                 "games": {"1": {"hold_ms": {tid: 12000}, "owner": 0, "last_ms": 12000}}}},
                         t0 + 60_000)
    tally = s.stations["util-1"]["tally"]
    assert tally["hold_ms"] == {tid: 12000}, tally
    assert tally["owner"] == 0, tally


def test_f658_late_following_hill_heartbeat_without_match_ring_keeps_recap_values():
    s = _ring_session("koth")
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "control", "team": "any", "id": 3})
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    s.phase = "live"
    tid = str(s.config["teams"][0]["tid"])
    t0 = s.now_ms()
    s.net.simulate_status("util-1", {"node_id": "util-1", "role": "utility", "kind": "control", "station_id": 3,
                                     "control": {"game": 1, "owner": 0, "hold_ms": {tid: 12000}}}, t0 + 60_000)
    s.control("end")
    # Keep this test on the recap path, independent of the live tally seed above.
    s.station_registry._keep_tally = lambda st, t_recv: None
    s.net.simulate_status("util-1", {"node_id": "util-1", "role": "utility", "kind": "control", "station_id": 3,
                                     "control": {"game": 2, "follows": True, "owner": 1, "hold_ms": {tid: 900},
                                                 "games": {"1": {"hold_ms": {tid: 15000}, "owner": 0, "last_ms": 15000},
                                                           "2": {"hold_ms": {tid: 900}, "owner": 1, "last_ms": 900}}}},
                         t0 + 65_000)
    row = s.recap()["stations"][0]
    assert row["hold_ms"] == {tid: 15000}, row
    assert row["owner"] == 0, row
    s.net.simulate_status("util-1", {"node_id": "util-1", "role": "utility", "kind": "control", "station_id": 3,
                                     "control": {"game": 3, "follows": True, "owner": 2, "hold_ms": {tid: 500},
                                                 "games": {"3": {"hold_ms": {tid: 500}, "owner": 2, "last_ms": 500}}}},
                         t0 + 70_000)
    row = s.recap()["stations"][0]
    assert row["hold_ms"] == {tid: 15000}, row
    assert row["owner"] == 0, row


def test_f658_domination_recap_reads_the_ring_entry_s_owned_clock():
    """Codex review 2026-11-07 (brx2 check): in Domination MC scores `own_ms`. A late heartbeat of a hill now following
    another game feeds the recap the ring entry's owned clock for MC's game, never its presence clock."""
    s = _ring_session("domination")
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "control", "team": "any", "id": 3})
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    s.phase = "live"
    tid = str(s.config["teams"][0]["tid"])
    t0 = s.now_ms()
    s.control("end")
    s.station_registry._keep_tally = lambda st, t_recv: None
    s.net.simulate_status("util-1", {"node_id": "util-1", "role": "utility", "kind": "control", "station_id": 3,
                                     "control": {"game": 2, "follows": True, "owner": 1, "hold_ms": {tid: 900}, "own_ms": {tid: 900},
                                                 "games": {"1": {"hold_ms": {tid: 4000}, "own_ms": {tid: 15000}, "owner": 0, "last_ms": 15000}}}},
                         t0 + 65_000)
    row = s.recap()["stations"][0]
    assert row["hold_ms"] == {tid: 15000}, row


def test_f658_recap_ring_entry_never_lowers_mc_tally_and_counts_as_the_station_report():
    """Codex review r2: a late heartbeat of a hill now following another game, carrying an older ring entry for MC's game
    (8000 ms after MC already received 12000 ms), keeps MC's max in the recap, and marks the station's report received."""
    s = _ring_session("koth")
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "control", "team": "any", "id": 3})
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    s.phase = "live"
    tid = str(s.config["teams"][0]["tid"])
    t0 = s.now_ms()
    s.net.simulate_status("util-1", {"node_id": "util-1", "role": "utility", "kind": "control", "station_id": 3,
                                     "control": {"game": 1, "owner": 0, "hold_ms": {tid: 12000}}}, t0 + 60_000)
    s.control("end")
    s.net.simulate_status("util-1", {"node_id": "util-1", "role": "utility", "kind": "control", "station_id": 3,
                                     "control": {"game": 2, "follows": True, "owner": 1, "hold_ms": {tid: 900},
                                                 "games": {"1": {"hold_ms": {tid: 8000}, "owner": 0, "last_ms": 9000}}}},
                         t0 + 65_000)
    row = s.recap()["stations"][0]
    assert row["hold_ms"] == {tid: 12000}, row
    assert s.match.sync_nodes["station:util-1"].get("status_received") is True, s.match.sync_nodes
