"""A81: a phone learns the outcome when MC releases the recap result."""

from _session import go_live_stored, kill, persisting_live, restart_session
from brx_mcp.mc.fakes import demo_armory


def _end_pending():
    s, net, clock, ps, info = go_live_stored(2, "ffa")
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    s.control("end")
    assert s.phase == "recap" and s.recap()["sync"]["pending"]
    return s, net, clock, ps, info


def _status(net, clock, ps, i, pending=0):
    net.simulate_status(f"node{i}", {"player_id": ps[i]["player_id"], "shots": 0,
                                     "alive": True, "synced": True, "pending": pending}, clock["t"])


def _victories(net):
    return [p for p in net.pushes("feedback") if p[2].get("kind") == "victory"]


def _welcome(net, i):
    return net.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{demo_armory()[i]['ble']['tail']}")


def test_whistle_with_a_pending_phone_withholds_result_victory_and_welcome():
    s, net, clock, ps, info = _end_pending()
    assert net.pushes("result") == [] and _victories(net) == []
    assert "result" not in _welcome(net, 1)
    net.simulate_status("node1", {"player_id": ps[1]["player_id"], "arm_state": "live",
                                  "match_id": info["match_id"], "pending": 1}, clock["t"])
    assert net.pushes("result") == [], "stale-live reconciliation must respect the wait"
    assert s.match.released is False


def test_last_zero_pending_status_releases_once_to_every_node():
    s, net, clock, ps, info = _end_pending()
    _status(net, clock, ps, 0)
    assert net.pushes("result") == [] and _victories(net) == []
    _status(net, clock, ps, 1)
    assert s.match.released is True
    assert [p[0] for p in net.pushes("result")] == ["node0", "node1"]
    assert [p[0] for p in _victories(net)] == ["node0"]
    _status(net, clock, ps, 1)
    s.recap()
    assert len(net.pushes("result")) == 2 and len(_victories(net)) == 1


def test_release_after_thirty_seconds_has_no_victory():
    s, net, clock, ps, info = _end_pending()
    clock["t"] = s.match.scorer.end_t + 30_001
    _status(net, clock, ps, 0)
    _status(net, clock, ps, 1)
    assert len(net.pushes("result")) == 2 and _victories(net) == []


def test_finalise_releases_with_timed_victory_only():
    s, net, clock, ps, info = _end_pending()
    s.finalise_recap()
    assert len(net.pushes("result")) == 2 and [p[0] for p in _victories(net)] == ["node0"]
    s.finalise_recap()
    assert len(net.pushes("result")) == 2 and len(_victories(net)) == 1

    s2, net2, clock2, ps2, info2 = _end_pending()
    clock2["t"] = s2.match.scorer.end_t + 30_001
    s2.finalise_recap()
    assert len(net2.pushes("result")) == 2 and _victories(net2) == []


def test_late_batch_changes_released_result_without_second_victory():
    s, net, clock, ps, info = _end_pending()
    s.finalise_recap()
    first = net.pushes("result")[0][2]
    clock["t"] += 1_000
    net.simulate_node_message("node1", "event_batch", {"events": [{
        "type": "death", "t": s.match.scorer.end_t - 1, "match_id": info["match_id"],
        "player_id": ps[0]["player_id"], "shooter_num": ps[1]["player_num"],
        "shooter_team": 1, "seq": 2}]}, clock["t"])
    assert len(net.pushes("result")) == 4
    assert net.pushes("result")[2][2] != first
    assert len(_victories(net)) == 1


def test_restart_released_pushes_result_once_and_welcome_carries_it():
    s, net, clock, ps, info = persisting_live()
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    s.control("end")
    s.finalise_recap()
    s2, net2 = restart_session(s, clock)
    _welcome(net2, 0)   # the phone rebinds before MC resumes the stored match
    assert s2.resume_match() == "recap"
    assert [p[0] for p in net2.pushes("result")] == ["node0"] and _victories(net2) == []
    assert "result" in _welcome(net2, 1)
    assert len(net2.pushes("result")) == 2
    s2.tick()
    assert len(net2.pushes("result")) == 2


def test_restart_pending_stays_quiet_until_release():
    s, net, clock, ps, info = persisting_live()
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    s.control("end")
    s2, net2 = restart_session(s, clock)
    assert s2.resume_match() == "recap"
    assert net2.pushes("result") == [] and _victories(net2) == []
    _welcome(net2, 0)
    assert "result" not in _welcome(net2, 1)
    s2.finalise_recap()
    assert len(net2.pushes("result")) == 2


def test_nobody_waited_on_at_whistle_releases_immediately():
    s, net, clock, ps, info = go_live_stored(2, "ffa")
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    entry_for = s._sync_entry

    def already_received(nid):
        entry = entry_for(nid)
        if entry is not None:
            entry["received"] = True
        return entry

    s._sync_entry = already_received
    s.control("end")
    assert s.match.released is True
    assert [p[0] for p in net.pushes("result")] == ["node0", "node1"]
    assert [p[0] for p in _victories(net)] == ["node0"]

    s, net, clock, ps, info = go_live_stored(2, "ffa")
    s.node_player.clear()
    s.match.nodes.clear()
    s.match.current.clear()
    s.match.scorer.node_player.clear()
    for p in s.players.values():
        p["node_id"] = None
    s.control("end")
    assert s.match.released is True
    assert net.pushes("result") == [] and _victories(net) == []
