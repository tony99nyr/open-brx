"""F596: post-whistle sync facts and the operator's final result."""
from _skip import needs
try:
    import starlette  # noqa: F401
    import httpx  # noqa: F401
    HAVE = True
except ImportError:
    HAVE = False

import pathlib
import tempfile
import json
import asyncio

from _session import go_live, go_live_stored, restart_session, mk_stored_session, online, kill
from brx_mcp.mc.types import SYNC_STUCK_S
from brx_mcp.mc.state import END_RETRY_MS
from brx_mcp.mc.net import NetServer
from brx_mcp.mc import envelope as E


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
    assert _row(s, pid)["stage"] == "sending"


def test_a_status_without_pending_keeps_a_received_claim():
    s, net, clock, ps, _ = _ended()
    pid = ps[0]["player_id"]
    _status(net, clock, 0, pid, 0)
    assert _row(s, pid)["stage"] == "received"
    clock["t"] += 1
    net.simulate_status("node0", {"player_id": pid}, clock["t"])
    assert _row(s, pid)["stage"] == "received"


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
    assert _row(s, pid)["stage"] == "received"


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


def test_received_stays_released_across_disconnect_stale_and_plain_hello():
    s, net, clock, ps, info = _ended()
    for i, p in enumerate(ps):
        _status(net, clock, i, p["player_id"], 0)
    pid = ps[0]["player_id"]
    assert not s.recap()["sync"]["pending"]
    net.simulate_disconnect("node0")
    assert _row(s, pid)["stage"] == "received"
    assert _row(s, pid)["linked"] is False
    assert not s.recap()["sync"]["pending"]
    net.nodes["node0"].stale = True
    assert _row(s, pid)["stage"] == "received"
    assert _row(s, pid)["linked"] is False
    assert not s.recap()["sync"]["pending"]
    net.nodes["node0"].stale = False
    net.simulate_hello("node0", "GUN-A-3D4F", node_key=net.nodes["node0"].node_key, pending=0)
    assert _row(s, pid)["stage"] == "received"
    assert _row(s, pid)["linked"] is True
    assert not s.recap()["sync"]["pending"]
    net.simulate_hello("node0", "GUN-A-3D4F", node_key=net.nodes["node0"].node_key, pending=2)
    assert _row(s, pid)["stage"] == "sending"
    assert not s.recap()["sync"]["pending"]


def test_recap_resume_preserves_receipts_and_whistle_side_effects():
    s, net, clock, ps, info = _ended(stored=True)
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    _status(net, clock, 0, ps[0]["player_id"], 0,
            arm_state="kitted", match_id=info["match_id"])
    _row(s, ps[1]["player_id"])
    s.match.sync_nodes["node1"]["changed_mono"] -= 120_000
    before = _row(s, ps[1]["player_id"])["idle_s"]
    assert before >= 120
    ended_ms = s._ended[info["match_id"]]["ended_ms"]
    archive = s.store.matches()[0]
    s._persist_last = 0
    s._persist()
    clock["t"] += 24 * 3600 * 1000  # downtime and a forward wall-clock step are not idle time
    from _session import restart_no_repersist
    s2, net2 = restart_no_repersist(s, clock)
    pushed = []
    pulled = []
    archived = []
    s2._push_victory = lambda *args: pushed.append("victory")
    s2._push_result = lambda *args: pushed.append("result")
    s2.pull_log = lambda *args: pulled.append(args)
    s2._archive = lambda *args: archived.append(args)
    assert s2.resume_match() == "recap"
    assert pushed == [] and pulled == [] and archived == []
    assert not [p for p in net2.pushed if p[1] == "control" and p[2].get("cmd") == "end"]
    assert s2._end_delivery["node1"]["confirmed"] is False
    assert s2._end_delivery["node0"]["confirmed"] is True
    assert _row(s2, ps[1]["player_id"])["end_unconfirmed"]
    assert not _row(s2, ps[0]["player_id"])["end_unconfirmed"]
    assert s2._ended[info["match_id"]]["ended_ms"] == ended_ms
    assert s.store.matches()[0] == archive
    assert _row(s2, ps[0]["player_id"])["stage"] == "received"
    assert before <= _row(s2, ps[1]["player_id"])["idle_s"] <= before + 2
    for delay in END_RETRY_MS:
        clock["t"] += delay + 1
        s2.tick()
    assert [p for p in net2.pushed if p[1] == "control" and p[2].get("cmd") == "end"]
    assert any("NEVER CONFIRMED THE END" in f.get("text", "") for f in s2.feed)


def test_sync_stuck_age_survives_a_backward_wall_clock_step():
    s, net, clock, ps, _ = _ended()
    mono = {"t": clock["t"]}
    s.mono_ms = lambda: mono["t"]
    s.recap()
    mono["t"] += SYNC_STUCK_S * 1000
    clock["t"] -= 30_000
    assert _row(s, ps[0]["player_id"])["stuck"]


def test_sync_progress_resets_monotonic_stuck_age():
    s, net, clock, ps, _ = go_live(2)
    mono = {"t": clock["t"]}
    s.mono_ms = lambda: mono["t"]
    s.control("end")
    pid = ps[0]["player_id"]
    _status(net, clock, 0, pid, 2)
    assert _row(s, pid)["stage"] == "sending"
    mono["t"] += SYNC_STUCK_S * 1000
    clock["t"] += SYNC_STUCK_S * 1000
    _status(net, clock, 0, pid, 1)
    assert _row(s, pid)["stage"] == "sending"
    assert _row(s, pid)["idle_s"] == 0
    assert not _row(s, pid)["stuck"]


def test_hill_station_rows_follow_the_station_receipt_and_socket():
    s, net, clock, ps, info = go_live_stored(2, "koth")
    s.control("end")
    rows = [r for r in s.recap()["sync"]["rows"] if r["kind"] == "station"]
    assert len(rows) == 1 and rows[0]["stage"] == "linked" and rows[0]["transport"] is None
    clock["t"] += 3_000
    sid = s.station_registry.stations["util-hill"]["assigned"]["id"]
    net.simulate_status("util-hill", {"role": "utility", "kind": "control", "station_id": sid,
                                      "control": {"owner": 0, "progress": 0, "contested": False,
                                                  "hold_ms": {}}}, clock["t"])
    rows = [r for r in s.recap()["sync"]["rows"] if r["kind"] == "station"]
    assert rows[0]["stage"] == "received" and rows[0]["idle_s"] == 0


def test_hill_receipt_survives_recap_restart():
    s, net, clock, ps, _ = go_live_stored(2, "koth")
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s.control("end")
    clock["t"] += 3_000
    sid = s.station_registry.stations["util-hill"]["assigned"]["id"]
    net.simulate_status("util-hill", {"role": "utility", "kind": "control", "station_id": sid,
                                      "control": {"owner": 0, "progress": 0, "contested": False,
                                                  "hold_ms": {}}}, clock["t"])
    assert next(r for r in s.recap()["sync"]["rows"] if r["kind"] == "station")["stage"] == "received"
    s2, _ = restart_session(s, clock)
    assert s2.resume_match() == "recap"
    assert next(r for r in s2.recap()["sync"]["rows"] if r["kind"] == "station")["stage"] == "received"


def test_hill_hello_waits_for_its_late_tally_before_recording_winner():
    s, net, clock, ps, info = go_live_stored(2, "koth")
    hill = "util-hill"
    sid = s.station_registry.stations[hill]["assigned"]["id"]
    red, blue = s.config["teams"]
    clock["t"] += 3_000
    net.simulate_status(hill, {"role": "utility", "kind": "control", "station_id": sid,
                               "control": {"owner": blue["tid"], "progress": 100,
                                           "contested": False, "hold_ms": {str(blue["tid"]): 1_000}}}, clock["t"])
    clock["t"] += 30_000
    net.simulate_disconnect(hill)
    s.control("end")
    for i, p in enumerate(ps):
        _status(net, clock, i, p["player_id"], 0)
    assert s.recap()["sync"]["pending"]
    clock["t"] += 1
    net.simulate_utility_hello(hill, node_key=net.nodes[hill].node_key)
    station = next(r for r in s.recap()["sync"]["rows"] if r["kind"] == "station")
    assert station["stage"] == "linked" and s.recap()["sync"]["pending"]
    assert s.match.final_winner is None
    net.simulate_status(hill, {"role": "utility", "arm_state": "idle"}, clock["t"])
    assert next(r for r in s.recap()["sync"]["rows"] if r["kind"] == "station")["stage"] == "linked"
    net.simulate_status(hill, {"role": "utility", "kind": "control", "station_id": sid,
                               "control": ["bad"]}, clock["t"])
    assert next(r for r in s.recap()["sync"]["rows"] if r["kind"] == "station")["stage"] == "linked"
    clock["t"] += 3_000  # the station has applied the post-END lock update
    net.simulate_status(hill, {"role": "utility", "kind": "control", "station_id": sid,
                               "control": {"game": 255, "owner": red["tid"], "progress": 100,
                                           "contested": False, "hold_ms": {str(red["tid"]): 30_000}}}, clock["t"])
    assert next(r for r in s.recap()["sync"]["rows"] if r["kind"] == "station")["stage"] == "linked"
    clock["t"] += 1
    net.simulate_status(hill, {"role": "utility", "kind": "control", "station_id": sid,
                               "control": {"owner": red["tid"], "progress": 100,
                                           "contested": False, "hold_ms": {str(red["tid"]): 20_000,
                                                                           str(blue["tid"]): 1_000}}}, clock["t"])
    recap = s.recap()
    assert next(r for r in recap["sync"]["rows"] if r["kind"] == "station")["stage"] == "received"
    assert recap["winner"] == {"team_id": red["team_id"]}, (recap["winner"], s.match.scorer.station_possession_ms,
                                                                s.station_registry.stations[hill])
    assert not recap["sync"]["pending"] and not recap["sync"]["result_changed"]


def test_pending_recap_survives_restart_and_can_be_finalised():
    s, net, clock, ps, _ = go_live_stored(2, "tdm")
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s.control("end")
    _status(net, clock, 0, ps[0]["player_id"], 3)
    assert s.recap()["sync"]["pending"]
    s2, _ = restart_session(s, clock)
    assert s2.resume_match() == "recap"
    assert s2.recap() is not None and s2.recap()["sync"]["pending"]
    assert s2.finalise_recap() == {"ok": True}
    assert s2.recap()["sync"]["finalised"] and not s2.recap()["sync"]["pending"]


def test_respawn_station_does_not_hold_result_open():
    s, net, clock, ps = mk_stored_session(2, "tdm")
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    net.simulate_utility_hello("util-respawn")
    s.set_station("util-respawn", {"kind": "respawn"})
    s.push_config()
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"],
                                                               "ok": True, "gun_echo": "$LCD"}, clock["t"])
    info = s.start(runway_s=1)
    clock["t"] = info["go_live_t"] + 1
    s.tick()
    s.control("end")
    net.simulate_disconnect("util-respawn")
    for i, p in enumerate(ps):
        _status(net, clock, i, p["player_id"], 0)
    assert [r for r in s.recap()["sync"]["rows"] if r["kind"] == "station"] == []
    assert not s.recap()["sync"]["pending"]


def test_recorded_winner_ends_wait_after_restart():
    s, net, clock, ps, _ = go_live_stored(2, "tdm")
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s.control("end")
    for i, p in enumerate(ps):
        _status(net, clock, i, p["player_id"], 0)
    assert s.match.final_winner is not None
    s2, _ = restart_session(s, clock)
    assert s2.resume_match() == "recap"
    sync = s2.recap()["sync"]
    assert not sync["pending"] and len(sync["rows"]) == 2


def test_finished_whistle_map_survives_handover_and_restart():
    s, net, clock, ps, info = go_live_stored(2, "tdm")
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s.control("end")
    original = dict(s.match.whistle_base)
    # A replacement phone now owns the player, but the whistle still saw the old phone.
    s.node_player["replacement"] = ps[0]["player_id"]
    s.match.nodes["superseded"] = ps[0]["player_id"]
    s2, net2 = restart_session(s, clock)
    assert s2.resume_match() == "recap"
    assert s2.match.whistle_base == original
    rows = [r for r in s2.recap()["sync"]["rows"] if r["kind"] == "phone"]
    assert len(rows) == 2 and len({r["id"] for r in rows}) == 2
    assert s2.match.scorer.node_player == original
    before = s2.match.scorer.stats[ps[0]["player_id"]].deaths
    net2.simulate_hello("node0", "GUN-B-3E60")
    assert s2.node_player["node0"] == ps[1]["player_id"]
    net2.simulate_event("node0", {"type": "death", "t": clock["t"], "match_id": info["match_id"],
                                  "player_id": ps[0]["player_id"], "shooter_num": ps[1]["player_num"],
                                  "shooter_team": 2}, clock["t"] + 1, seq=62)
    assert s2.match.scorer.stats[ps[0]["player_id"]].deaths == before + 1


def test_backward_clock_does_not_hide_late_batch_or_zero_status():
    s, net, clock, ps, info = _ended()
    pid = ps[0]["player_id"]
    _status(net, clock, 0, pid, 0)
    assert _row(s, pid)["stage"] == "received"
    clock["t"] -= 10_000
    net.simulate_batch("node0", [{"type": "hit_taken", "seq": 42, "t": clock["t"],
                                  "match_id": info["match_id"], "player_id": pid,
                                  "shooter_num": ps[1]["player_num"], "shooter_team": 2, "dmg": 1}], clock["t"])
    assert _row(s, pid)["stage"] == "sending"
    _status(net, clock, 0, pid, 0)
    assert _row(s, pid)["stage"] == "received"
    net.simulate_disconnect("node0")
    net.simulate_hello("node0", "GUN-A-3D4F", node_key=net.nodes["node0"].node_key, pending=2)
    assert (_row(s, pid)["stage"], _row(s, pid)["pending"]) == ("sending", 2)


def test_multi_event_batch_after_zero_reopens_the_row_but_not_the_wait():
    s, net, clock, ps, info = _ended()
    for i, p in enumerate(ps):
        _status(net, clock, i, p["player_id"], 0)
    assert not s.recap()["sync"]["pending"]
    pid = ps[0]["player_id"]
    net.simulate_batch("node0", [
        {"type": "hit_taken", "seq": seq, "t": clock["t"], "match_id": info["match_id"],
         "player_id": pid, "shooter_num": ps[1]["player_num"], "shooter_team": 2, "dmg": 1}
        for seq in (43, 44)], clock["t"])
    assert _row(s, pid)["stage"] == "sending"
    assert not s.recap()["sync"]["pending"]
    assert s.match.released
    _status(net, clock, 0, pid, 0)
    assert _row(s, pid)["stage"] == "received"
    assert not s.recap()["sync"]["pending"]


def test_late_batch_keeps_released_result_and_flags_winner_flip_in_process():
    s, net, clock, ps, info = go_live_stored(2, "tdm")
    s.control("end")
    for i, p in enumerate(ps):
        _status(net, clock, i, p["player_id"], 0)
    assert s.match.released and not s.recap()["sync"]["pending"]
    previous = s.recap()["winner"]
    clock["t"] += 1
    net.simulate_batch("node1", [{"type": "death", "seq": 51, "t": clock["t"] - 2,
                                  "match_id": info["match_id"], "player_id": ps[1]["player_id"],
                                  "shooter_num": ps[0]["player_num"], "shooter_team": 1}], clock["t"])
    assert _row(s, ps[1]["player_id"])["stage"] == "sending"
    assert not s.recap()["sync"]["pending"] and s.match.released
    assert s.recap()["winner"] != previous
    assert s.recap()["sync"]["result_changed"]
    if HAVE:
        from starlette.testclient import TestClient
        from brx_mcp.mc.api import create_app
        c = TestClient(create_app(s))
        assert c.get("/api/recap.csv").status_code == 200
        assert c.get(f"/api/matches/{info['match_id']}.csv").status_code == 200
        current = next(row for row in c.get("/api/matches").json() if row["match_id"] == info["match_id"])
        assert not current.get("pending") and current["recap"]["winner"] == s.recap()["winner"]


def test_late_batch_keeps_released_result_after_restart():
    s, net, clock, ps, info = go_live_stored(2, "tdm")
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s.control("end")
    for i, p in enumerate(ps):
        _status(net, clock, i, p["player_id"], 0)
    previous = s.recap()["winner"]
    assert json.loads(s._persist_path.read_text())["match"]["released"] is True
    s2, net2 = restart_session(s, clock)
    assert s2.resume_match() == "recap" and s2.match.released
    from _session import online
    online(s2, net2, clock, ps[1], 1)
    clock["t"] += 1
    net2.simulate_batch("node1", [{"type": "death", "seq": 52, "t": clock["t"] - 2,
                                   "match_id": info["match_id"], "player_id": ps[1]["player_id"],
                                   "shooter_num": ps[0]["player_num"], "shooter_team": 1}], clock["t"])
    assert _row(s2, ps[1]["player_id"])["stage"] == "sending"
    assert not s2.recap()["sync"]["pending"] and s2.match.released
    assert s2.recap()["winner"] != previous
    assert s2.recap()["sync"]["result_changed"]
    if HAVE:
        from starlette.testclient import TestClient
        from brx_mcp.mc.api import create_app
        c = TestClient(create_app(s2))
        assert c.get("/api/recap.csv").status_code == 200
        assert c.get(f"/api/matches/{info['match_id']}.csv").status_code == 200
        current = next(row for row in c.get("/api/matches").json() if row["match_id"] == info["match_id"])
        assert not current.get("pending") and current["recap"]["winner"] == s2.recap()["winner"]


def test_pending_recap_refuses_every_roll_route_before_changing_history():
    needs(HAVE, "starlette + httpx")
    from starlette.testclient import TestClient
    from brx_mcp.mc.api import create_app
    s, net, clock, ps, info = go_live_stored(2, "tdm")
    c = TestClient(create_app(s))
    s.control("end")
    paths = [("post", "/api/match/next", {}), ("post", "/api/session/new", {"keep_roster": True}),
             ("post", "/api/session/new", {"keep_roster": False}),
             ("post", "/api/games/load", {}), ("post", "/api/lobby/push", {"force": True}),
             ("post", "/api/play/pick", {"match": {"night": True}}),
             ("post", "/api/phase", {"phase": "build"}),
             ("put", "/api/config", {"night": True})]
    for method, path, body in paths:
        response = getattr(c, method)(path, json=body)
        assert response.status_code == 409, (path, response.status_code, response.text)
        assert "Finalise the result first." in response.json()["error"], path
        assert s.phase == "recap" and s.match.scorer.match_id == info["match_id"]
        assert c.get("/api/matches").json()[0]["pending"] is True


def test_frag_cap_reason_restores_and_reconciles_a_late_kill():
    s, net, clock, ps, info = go_live_stored(4, "tdm", {"scoring": {"frag_limit": 2, "win_by": "kills"}})
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    kill(s, net, clock, ps, 0, 1, info, seq=61)
    kill(s, net, clock, ps, 2, 3, info, seq=62)
    assert s.phase == "recap" and s.end_reason == "frag_limit"
    s2, net2 = restart_session(s, clock)
    assert s2.resume_match() == "recap" and s2.end_reason == "frag_limit"
    online(s2, net2, clock, ps[0], 0)
    calls = []
    original = s2._match_facts
    def counted(mid):
        calls.append(mid)
        return original(mid)
    s2._match_facts = counted
    net2.simulate_event("node0", {"type": "death", "t": s2.match.scorer.end_t - 1,
                                  "match_id": info["match_id"], "player_id": ps[0]["player_id"],
                                  "shooter_num": ps[1]["player_num"], "shooter_team": 2}, clock["t"], seq=63)
    assert info["match_id"] in calls


def test_first_zero_status_after_reconnect_receives_and_stale_count_sends():
    s, net, clock, ps, _ = _ended()
    pid = ps[0]["player_id"]
    net.simulate_disconnect("node0")
    net.simulate_hello("node0", "GUN-A-3D4F", node_key=net.nodes["node0"].node_key, pending=2)
    _status(net, clock, 0, pid, 2)
    assert _row(s, pid)["stage"] == "sending"
    net.simulate_disconnect("node0")
    net.simulate_hello("node0", "GUN-A-3D4F", node_key=net.nodes["node0"].node_key, pending=0)
    _status(net, clock, 0, pid, 0)
    assert _row(s, pid)["stage"] == "received"


def test_recap_change_does_not_build_full_scorer_sheet():
    s, net, clock, ps, _ = _ended()
    original = s.match.scorer.recap
    def no_sheet(**_kw):
        raise AssertionError("a heartbeat built the full recap")
    s.match.scorer.recap = no_sheet
    try:
        _status(net, clock, 0, ps[0]["player_id"], 1)
    finally:
        s.match.scorer.recap = original


def test_real_net_hello_cleans_pending_before_session_hydration():
    seen = []
    server = NetServer()
    server.hydrate(lambda body: seen.append(body) or None)

    class Socket:
        remote_address = ("127.0.0.1", 12001)
        async def send(self, _raw):
            pass
        async def close(self, *_args):
            pass

    async def run():
        for i, pending in enumerate((3, 0, True, -1, "4")):
            body = {"node_id": f"node{i}", "node_type": "phone", "app_ver": "test", "seq_next": 1,
                    "pending": pending}
            await server._on_hello(Socket(), E.make_envelope("hello", body))

    asyncio.run(run())
    assert [body.get("pending") for body in seen] == [3, 0, None, None, None]


def test_finalise_flushes_snapshot_without_clock_advance():
    s, net, clock, ps, _ = go_live_stored(2, "tdm")
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s.control("end")
    s.finalise_recap()
    assert json.loads(s._persist_path.read_text())["match"]["finalised"] is True


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
    snap["match"].pop("released")
    snap["match"].pop("result_changed")
    s._persist_path.write_text(json.dumps(snap))
    from _session import restart_no_repersist
    s2, _ = restart_no_repersist(s, clock)
    assert s2.resume_match() == "recap"
    assert s2.recap()["sync"]["finalised"] is False


def test_finalise_route_requires_the_operator_token_and_recap():
    needs(HAVE, "starlette + httpx")
    from starlette.testclient import TestClient
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


def test_the_recap_csv_waits_for_the_result_like_the_page():
    """F596 review (Codex): the console hides EXPORT CSV while the result is pending, but a saved /api/recap.csv link still
    downloaded the provisional table. It answers 409 until every row is received or the operator finalises."""
    needs(HAVE, "starlette + httpx")
    from starlette.testclient import TestClient
    from brx_mcp.mc.api import create_app
    s, net, clock, ps, _ = go_live(2)
    c = TestClient(create_app(s))
    s.control("end")
    assert s.recap()["sync"]["pending"], s.recap()["sync"]
    r = c.get("/api/recap.csv")
    assert r.status_code == 409 and "PENDING" in r.json()["error"].upper(), (r.status_code, r.text)
    s.finalise_recap()
    assert c.get("/api/recap.csv").status_code == 200


def test_pending_result_is_hidden_from_match_csv_and_history():
    needs(HAVE, "starlette + httpx")
    from starlette.testclient import TestClient
    from brx_mcp.mc.api import create_app
    s, net, clock, ps, info = go_live_stored(2, "tdm")
    c = TestClient(create_app(s))
    s.control("end")
    assert s.recap()["sync"]["pending"]
    assert c.get("/api/recap").json()["winner"] is None
    assert c.get("/api/state").json()["recap"]["winner"] is None
    csv_response = c.get(f"/api/matches/{info['match_id']}.csv")
    assert csv_response.status_code == 409 and "PENDING" in csv_response.json()["error"].upper()
    history = c.get("/api/matches").json()
    current = next(row for row in history if row["match_id"] == info["match_id"])
    assert current["pending"] is True
    assert set(current) == {"match_id", "go_live_t", "ended_t", "mode", "pending"}
    s.finalise_recap()
    assert c.get(f"/api/matches/{info['match_id']}.csv").status_code == 200
    released = next(row for row in c.get("/api/matches").json() if row["match_id"] == info["match_id"])
    assert "pending" not in released and "winner" in released["recap"]
