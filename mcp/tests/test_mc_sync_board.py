"""F596: post-whistle sync facts and the operator's final result."""
import pathlib
import tempfile
import json

from _session import go_live, go_live_stored, restart_session
from brx_mcp.mc.types import SYNC_STUCK_S


def _ended(stored=False):
    s, net, clock, ps, info = (go_live_stored(2, "tdm") if stored else go_live(2))
    s.control("end")
    clock["t"] += 1
    return s, net, clock, ps, info


def _row(s, pid):
    return next(r for r in s.recap()["sync"]["rows"] if r["id"] == pid)


def _status(net, clock, i, pid, pending, **extra):
    net.simulate_status(f"node{i}", {"player_id": pid, "pending": pending, **extra}, clock["t"])


def test_fresh_zero_after_whistle_and_after_a_late_batch():
    s, net, clock, ps, info = _ended()
    pid = ps[0]["player_id"]
    assert _row(s, pid)["stage"] == "linked"
    _status(net, clock, 0, pid, 2)
    assert _row(s, pid)["stage"] == "sending"
    assert _row(s, pid)["pending"] == 2
    clock["t"] += 1
    net.simulate_batch("node0", [{"type": "hit_taken", "seq": 20, "t": clock["t"] - 10,
                                  "match_id": info["match_id"], "player_id": pid,
                                  "shooter_num": ps[1]["player_num"], "shooter_team": 2, "dmg": 1}], clock["t"])
    assert _row(s, pid)["stage"] == "sending"
    clock["t"] += 1
    _status(net, clock, 0, pid, 0)
    assert _row(s, pid)["stage"] == "received"
    net.simulate_event("node0", {"type": "hit_taken", "t": clock["t"], "match_id": info["match_id"],
                                  "player_id": pid, "shooter_num": ps[1]["player_num"],
                                  "shooter_team": 2, "dmg": 1}, clock["t"] + 1, seq=21)
    assert _row(s, pid)["stage"] != "received"


def test_a_later_event_in_the_same_millisecond_reopens_a_received_row():
    s, net, clock, ps, info = _ended()
    pid = ps[0]["player_id"]
    _status(net, clock, 0, pid, 0)
    assert _row(s, pid)["stage"] == "received"
    net.simulate_event("node0", {"type": "hit_taken", "t": clock["t"], "match_id": info["match_id"],
                                  "player_id": pid, "shooter_num": ps[1]["player_num"],
                                  "shooter_team": 2, "dmg": 1}, clock["t"], seq=30)
    assert _row(s, pid)["stage"] == "linked"


def test_a_status_without_pending_cannot_keep_a_received_claim():
    s, net, clock, ps, _ = _ended()
    pid = ps[0]["player_id"]
    _status(net, clock, 0, pid, 0)
    assert _row(s, pid)["stage"] == "received"
    clock["t"] += 1
    net.simulate_status("node0", {"player_id": pid}, clock["t"])
    assert _row(s, pid)["stage"] == "linked"


def test_hello_pending_old_phone_disconnect_transport_and_loss():
    s, net, clock, ps, info = _ended()
    pid = ps[0]["player_id"]
    net.simulate_disconnect("node0")
    assert _row(s, pid)["stage"] == "unlinked"
    net.simulate_hello("node0", "GUN-A-3D4F", node_key=net.nodes["node0"].node_key, pending=3)
    assert (_row(s, pid)["stage"], _row(s, pid)["pending"]) == ("sending", 3)
    _status(net, clock, 0, pid, 3, transport="cellular")
    assert _row(s, pid)["transport"] == "cellular"
    _status(net, clock, 0, pid, 0, transport="wifi", outbox_lost={"match_id": info["match_id"], "n": 2})
    assert (_row(s, pid)["stage"], _row(s, pid)["transport"], _row(s, pid)["lost"]) == ("received", "wifi", 2)
    net.simulate_disconnect("node0")
    net.simulate_hello("node0", "GUN-A-3D4F", node_key=net.nodes["node0"].node_key, via="backhaul")
    assert _row(s, pid)["transport"] == "backhaul"
    assert _row(s, pid)["stage"] == "linked"


def test_stuck_end_delivery_and_finalise_result():
    s, net, clock, ps, _ = _ended()
    sync = s.recap()["sync"]
    assert sync["pending"] and not sync["finalised"] and not sync["result_changed"]
    assert _row(s, ps[0]["player_id"])["end_unconfirmed"]
    clock["t"] += SYNC_STUCK_S * 1000
    assert _row(s, ps[0]["player_id"])["stuck"]
    try:
        s.finalise_recap()
    except ValueError:
        assert False, "RECAP permits finalise"
    assert s.finalise_recap() == {"ok": True}
    assert not s.recap()["sync"]["pending"]
    assert s.recap()["sync"]["finalised"]
    original = s.match.scorer.recap
    s.match.scorer.recap = lambda **kw: {**original(**kw), "winner": {"team_id": "other"}}
    assert s.recap()["sync"]["result_changed"]
    s.match.scorer.recap = original
    assert s.recap()["sync"]["result_changed"]


def test_finalise_rejected_outside_recap_and_restored():
    s, net, clock, ps, _ = go_live_stored(2, "tdm")
    try:
        s.finalise_recap()
    except ValueError:
        pass
    else:
        assert False, "LIVE must reject finalise"
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s.control("end")
    s.finalise_recap()
    first = s.recap()["winner"]
    s2, _ = restart_session(s, clock)
    assert s2.resume_match() == "recap"
    assert s2.recap()["sync"]["finalised"]
    assert s2.match.final_winner == first


def test_archived_recap_has_no_live_sync():
    s, net, clock, ps, info = _ended(stored=True)
    assert "sync" in s.snapshot()["recap"]
    rows = s.store.matches()
    assert rows and "sync" not in rows[0]["recap"]


def test_every_phone_received_ends_the_wait_and_records_the_winner():
    s, net, clock, ps, _ = _ended()
    for i, p in enumerate(ps):
        _status(net, clock, i, p["player_id"], 0)
    assert not s.recap()["sync"]["pending"]
    assert s.match.final_winner == s.recap()["winner"]
    assert all(row["stage"] == "received" for row in s.recap()["sync"]["rows"])


def test_hill_station_rows_follow_the_station_receipt_and_socket():
    s, net, clock, ps, info = go_live_stored(2, "koth")
    s.control("end")
    rows = [r for r in s.recap()["sync"]["rows"] if r["kind"] == "station"]
    assert len(rows) == 1 and rows[0]["stage"] == "linked" and rows[0]["transport"] is None
    clock["t"] += 1
    net.simulate_status("util-hill", {"arm_state": "idle"}, clock["t"])
    rows = [r for r in s.recap()["sync"]["rows"] if r["kind"] == "station"]
    assert rows[0]["stage"] == "received" and rows[0]["idle_s"] == 0


def test_invalid_hello_pending_is_unknown_and_station_can_be_unlinked():
    s, net, clock, ps, _ = go_live_stored(2, "koth")
    s.control("end")
    net.simulate_disconnect("node0")
    net.simulate_hello("node0", "GUN-A-3D4F", node_key=net.nodes["node0"].node_key, pending=True)
    assert _row(s, ps[0]["player_id"])["stage"] == "linked"
    assert "pending" not in _row(s, ps[0]["player_id"])
    net.simulate_disconnect("util-hill")
    station = next(r for r in s.recap()["sync"]["rows"] if r["kind"] == "station")
    assert station["stage"] == "unlinked" and station["transport"] is None


def test_old_finished_snapshot_defaults_to_not_finalised():
    s, net, clock, ps, _ = go_live_stored(2, "tdm")
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s.control("end")
    s.finalise_recap()
    s._persist_last = 0
    s._persist()
    snap = json.loads(s._persist_path.read_text())
    assert snap["match"]["finalised"] is True
    snap["match"].pop("finalised")
    snap["match"].pop("final_winner")
    snap["match"].pop("result_changed")
    s._persist_path.write_text(json.dumps(snap))
    from _session import restart_no_repersist
    s2, _ = restart_no_repersist(s, clock)
    assert s2.resume_match() == "recap"
    assert s2.recap()["sync"]["finalised"] is False


def test_finalise_route_requires_the_operator_token_and_recap():
    from _skip import needs
    try:
        from starlette.testclient import TestClient
        import httpx  # noqa: F401
    except ImportError:
        needs(False, "starlette + httpx")
    from brx_mcp.mc.api import create_app
    s, net, clock, ps, _ = go_live(2)
    c = TestClient(create_app(s, token="operator"))
    path = "/api/recap/finalise"
    assert c.post(path, json={}).status_code == 401
    headers = {"Authorization": "Bearer operator"}
    assert c.post(path, json={}, headers=headers).status_code == 409
    s.control("end")
    assert c.post(path, json={}, headers=headers).json() == {"ok": True}
    assert c.post(path, json={}, headers=headers).json() == {"ok": True}


def test_final_result_restores_against_the_roster_as_played():
    s, net, clock, ps, info = go_live_stored(2, "tdm")
    net.simulate_event("node1", {"type": "death", "t": clock["t"], "match_id": info["match_id"],
                                  "player_id": ps[1]["player_id"], "shooter_num": ps[0]["player_num"],
                                  "shooter_team": 1}, clock["t"], seq=40)
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s.control("end")
    s.finalise_recap()
    original = s.recap()["winner"]
    winning_team = ps[0]["team_id"]
    assert original.get("team_id") == winning_team, original
    s.players[ps[0]["player_id"]]["team_id"] = ps[1]["team_id"]
    s2, _ = restart_session(s, clock)
    assert s2.resume_match() == "recap"
    assert s2.recap()["winner"] == original
    assert _row(s2, ps[0]["player_id"])["team_id"] == winning_team
    assert not s2.recap()["sync"]["result_changed"]


def test_resumed_match_keeps_the_whistle_bindings_without_new_hellos():
    s, net, clock, ps, _ = go_live_stored(2, "tdm")
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s2, _ = restart_session(s, clock)
    assert s2.resume_match() == "live"
    s2.control("end")
    rows = s2.recap()["sync"]["rows"]
    assert len(rows) == 2 and all(row["stage"] == "unlinked" for row in rows)
    assert s2.recap()["sync"]["pending"]
