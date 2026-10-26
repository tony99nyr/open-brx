"""A81: a phone learns the outcome when MC releases the recap result."""

import json

from _session import after_end, go_live_stored, kill, persisting_live, restart_no_repersist, restart_session
from brx_mcp.mc.fakes import demo_armory


def _end_pending():
    s, net, clock, ps, info = go_live_stored(2, "ffa")
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    net.pushed.clear()
    s.control("end")
    assert s.phase == "recap" and s.recap()["sync"]["pending"]
    return s, net, clock, ps, info


def _status(s, net, clock, ps, i, pending=0):
    net.simulate_status(f"node{i}", after_end(s, {"player_id": ps[i]["player_id"], "shots": 0,
                                                  "alive": True, "synced": True, "pending": pending}), clock["t"])


def _victories(net):
    return [p for p in net.pushes("feedback") if p[2].get("kind") == "victory"]


def _welcome(net, i):
    return net.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{demo_armory()[i]['ble']['tail']}")


def test_whistle_with_a_pending_phone_withholds_result_victory_and_welcome():
    s, net, clock, ps, info = _end_pending()
    assert net.pushes("result") == [] and _victories(net) == []
    assert net.pushes("score") == []
    assert "result" not in _welcome(net, 1)
    assert "score" not in _welcome(net, 1)
    net.simulate_status("node1", {"player_id": ps[1]["player_id"], "arm_state": "live",
                                  "match_id": info["match_id"], "pending": 1}, clock["t"])
    assert net.pushes("result") == [], "stale-live reconciliation must respect the wait"
    assert s.match.released is False


def test_last_zero_pending_status_releases_once_to_every_node():
    s, net, clock, ps, info = _end_pending()
    _status(s, net, clock, ps, 0)
    assert net.pushes("result") == [] and _victories(net) == []
    _status(s, net, clock, ps, 1)
    assert s.match.released is True
    assert [p[0] for p in net.pushes("result")] == ["node0", "node1"]
    assert [p[0] for p in net.pushes("score")] == ["node0", "node1"]
    assert [p[0] for p in _victories(net)] == ["node0"]
    _status(s, net, clock, ps, 1)
    s.recap()
    assert len(net.pushes("result")) == 2 and len(_victories(net)) == 1
    assert len(net.pushes("score")) == 2


def test_release_after_thirty_seconds_has_no_victory():
    s, net, clock, ps, info = _end_pending()
    clock["t"] += 31_000
    _status(s, net, clock, ps, 0)
    _status(s, net, clock, ps, 1)
    assert len(net.pushes("result")) == 2 and _victories(net) == []


def test_finalise_releases_with_timed_victory_only():
    s, net, clock, ps, info = _end_pending()
    s.finalise_recap()
    assert len(net.pushes("result")) == 2 and len(net.pushes("score")) == 2
    assert [p[0] for p in _victories(net)] == ["node0"]
    s.finalise_recap()
    assert len(net.pushes("result")) == 2 and len(net.pushes("score")) == 2
    assert len(_victories(net)) == 1

    s2, net2, clock2, ps2, info2 = _end_pending()
    clock2["t"] += 31_000
    s2.finalise_recap()
    assert len(net2.pushes("result")) == 2 and _victories(net2) == []


def test_late_batch_changes_released_result_without_second_victory():
    s, net, clock, ps, info = _end_pending()
    s.finalise_recap()
    first = net.pushes("result")[0][2]
    clock["t"] += 1_000
    net.simulate_node_message("node0", "event_batch", {"events": [{
        "type": "death", "t": s.match.scorer.end_t - 1, "match_id": info["match_id"],
        "player_id": ps[0]["player_id"], "shooter_num": ps[1]["player_num"],
        "shooter_team": 1, "seq": 2}]}, clock["t"])
    _status(s, net, clock, ps, 0)        # A83: the sender's own result waits for its queue to drain
    assert len(net.pushes("result")) == 4
    assert net.pushes("result")[2][2] != first
    assert len(_victories(net)) == 1


def test_restart_released_pushes_result_once_and_welcome_carries_it():
    s, net, clock, ps, info = persisting_live()
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    s.control("end")
    s.finalise_recap()
    s2, net2 = restart_session(s, clock)
    assert s2.resume_match() == "recap"
    assert net2.pushes("result") == [] and _victories(net2) == []
    welcome0 = _welcome(net2, 0)
    assert "result" in welcome0
    assert "result" in _welcome(net2, 1)
    assert _victories(net2) == []
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
    assert len(net2.pushes("result")) == 2 and _victories(net2) == []

    s3, net3, clock3, ps3, info3 = persisting_live()
    kill(s3, net3, clock3, ps3, 0, 1, info3, seq=1)
    s3.control("end")
    s4, net4 = restart_session(s3, clock3)
    s4.resume_match()
    _welcome(net4, 0)
    _welcome(net4, 1)
    clock3["t"] += 31_000
    s4.finalise_recap()
    assert len(net4.pushes("result")) == 2 and _victories(net4) == []


def test_nobody_waited_on_at_whistle_releases_immediately():
    s, net, clock, ps, info = go_live_stored(2, "ffa")
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    net.pushed.clear()
    entry_for = s._sync_entry

    def already_received(nid):
        entry = entry_for(nid)
        if entry is not None:
            entry["received"] = True
        return entry

    s._sync_entry = already_received
    before = len(net.pushes("result"))
    s.control("end")
    assert s.match.released is True
    assert [p[0] for p in net.pushes("result")[before:]] == ["node0", "node1"]
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


def test_late_batch_and_status_do_not_push_score_while_pending():
    s, net, clock, ps, info = _end_pending()
    net.simulate_node_message("node0", "event_batch", {"events": [{
        "type": "death", "t": clock["t"] - 1, "match_id": info["match_id"],
        "player_id": ps[0]["player_id"], "shooter_num": ps[1]["player_num"],
        "shooter_team": 1, "seq": 2}]}, clock["t"])
    _status(s, net, clock, ps, 0)
    assert s.match.scorer.stats[ps[1]["player_id"]].kills == 1
    assert s.match.released is False and net.pushes("score") == []


def test_stale_live_return_after_late_winner_change_gets_current_result_only():
    s, net, clock, ps, info = _end_pending()
    initial = s.last_recap["winner"]
    for seq in (2, 3):
        net.simulate_node_message("node0", "event_batch", {"events": [{
            "type": "death", "t": clock["t"] - 10 + seq, "match_id": info["match_id"],
            "player_id": ps[0]["player_id"], "shooter_num": ps[1]["player_num"],
            "shooter_team": 1, "seq": seq}]}, clock["t"])
    assert s.last_recap["winner"] != initial
    s.finalise_recap()
    current_winner = s.last_recap["winner"]
    s._roll_forward_from_recap()  # retire the match before the phone reports stale-live
    net.pushed.clear()
    net.simulate_status("node1", {"player_id": ps[1]["player_id"], "arm_state": "live",
                                  "match_id": info["match_id"], "pending": 1}, clock["t"])
    pushed = net.pushes("result", "node1")
    assert pushed and all(row[2]["winner"] == current_winner for row in pushed)
    assert all(row[2]["winner"] != initial for row in pushed)


def test_retired_unreleased_match_sends_no_stale_live_result():
    s, net, clock, ps, info = _end_pending()
    assert s._ended[info["match_id"]]["released"] is False
    # The operator route forbids a pending roll. Exercise the retired ledger path directly.
    s.match = None
    s.phase = "kit"
    net.pushed.clear()
    s._reconcile_stale_live("node1", info["match_id"])
    assert net.pushes("control", "node1")
    assert net.pushes("result", "node1") == []


def test_getter_release_flushes_result_score_and_victory_on_tick_once():
    s, net, clock, ps, info = _end_pending()
    for nid in ("node0", "node1"):
        s.match.sync_nodes[nid]["received"] = True
    s.recap()
    assert s.match.released and net.pushes("result") == [] and net.pushes("score") == []
    s.tick()
    assert len(net.pushes("result")) == 2 and len(net.pushes("score")) == 2
    assert [kind for _nid, kind, _body in net.pushed if kind in ("result", "score")] == [
        "result", "result", "score", "score"]
    assert len(_victories(net)) == 1
    s.tick()
    assert len(net.pushes("result")) == 2 and len(net.pushes("score")) == 2
    assert len(_victories(net)) == 1


def test_mc_clock_step_back_blocks_victory_even_when_monotonic_age_is_short():
    s, net, clock, ps, info = go_live_stored(2, "ffa")
    mono = {"t": clock["t"]}
    s.mono_ms = lambda: mono["t"]
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    mono["t"] = clock["t"]
    s.control("end")
    clock["t"] -= 60_000  # mc_clock_step: the wall clock moves, the monotonic clock does not
    s.finalise_recap()
    assert _victories(net) == []


def test_lid_sleep_wall_age_blocks_victory_when_monotonic_age_is_short():
    s, net, clock, ps, info = _end_pending()
    mono = s.mono_ms()
    s.mono_ms = lambda: mono
    clock["t"] += 31_000
    s.finalise_recap()
    assert len(net.pushes("result")) == 2
    assert _victories(net) == []


def test_final_heartbeat_refreshes_recap_before_release_pushes():
    s, net, clock, ps, info = _end_pending()
    _status(s, net, clock, ps, 0)
    net.simulate_status("node1", after_end(s, {"player_id": ps[1]["player_id"], "shots": 17,
                                               "alive": True, "synced": True, "pending": 0}), clock["t"])
    assert s.match.released
    result = net.pushes("result")
    scores = net.pushes("score")
    assert len(result) == len(scores) == 2
    assert result[0][2]["rows"] == scores[0][2]["rows"]
    assert result[0][2]["my"]["accuracy"] == scores[0][2]["accuracy"]


def test_result_dedupe_allows_same_player_on_a_new_node():
    s, net, clock, ps, info = _end_pending()
    s.finalise_recap()
    net.evict("node0")
    net.simulate_hello("replacement", f"GUN-A-{demo_armory()[0]['ble']['tail']}")
    assert s.players[ps[0]["player_id"]]["node_id"] == "replacement"
    s._push_result()
    assert len(net.pushes("result", "replacement")) == 1


def test_failed_score_push_stays_eligible_until_socket_returns():
    s, net, clock, ps, info = _end_pending()
    s.finalise_recap()
    net.evict("node0")
    s._score_pushed.clear()
    s._push_scores(release_flush=True)
    assert any(p[0] == "node0" for p in net.pushes("score"))
    assert ps[0]["player_id"] not in s._score_pushed
    net.simulate_hello("node0", f"GUN-A-{demo_armory()[0]['ble']['tail']}")
    s._push_scores(release_flush=True)
    successful = [p for p in net.pushes("score", "node0") if id(p[2]) not in net.undelivered]
    assert successful


def test_frag_cap_kill_timestamp_ahead_of_mc_still_plays_victory():
    s, net, clock, ps, info = go_live_stored(2, "ffa", {"scoring": {"frag_limit": 1, "win_by": "kills"}})
    t = clock["t"] + 2_000
    net.simulate_event("node1", {"type": "death", "t": t, "match_id": info["match_id"],
                                 "player_id": ps[1]["player_id"], "shooter_num": ps[0]["player_num"],
                                 "shooter_team": 1}, clock["t"], seq=1)
    assert s.phase == "recap" and s.match.scorer.end_t > clock["t"]
    s.finalise_recap()
    assert [p[0] for p in _victories(net)] == ["node0"]


def test_recap_team_edit_does_not_move_victory_to_loser():
    s, net, clock, ps, info = go_live_stored(2, "tdm")
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    s.control("end")
    winner_team = s.match.played[ps[0]["player_id"]]["team_id"]
    net.evict("node0")
    net.simulate_hello("replacement", f"GUN-A-{demo_armory()[0]['ble']['tail']}")
    assert s.players[ps[0]["player_id"]]["node_id"] == "replacement"
    s.patch_player(ps[0]["player_id"], team_id=ps[1]["team_id"])
    s.patch_player(ps[1]["player_id"], team_id=winner_team)
    s.finalise_recap()
    assert [p[0] for p in _victories(net)] == ["replacement"]


def test_crash_after_release_latch_delivers_on_reconnect_without_victory():
    s, net, clock, ps, info = persisting_live()
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    s.control("end")
    for nid in ("node0", "node1"):
        s.match.sync_nodes[nid]["received"] = True
    s.recap()
    saved = json.loads(s._persist_path.read_text())
    assert saved["match"]["released"] is True and saved["match"]["release_pending"] is True
    s2, net2 = restart_no_repersist(s, clock)
    for i, player in enumerate(ps):
        # A restored logical binding can exist before the socket server accepts a phone.
        s2.players[player["player_id"]]["node_id"] = f"node{i}"
    s2.resume_match()
    # Resume precedes socket startup. Hello carries the result and triggers score delivery.
    assert net2.pushes("result") == [] and net2.pushes("score") == []
    assert _victories(net2) == []
    welcome0 = _welcome(net2, 0)
    welcome1 = _welcome(net2, 1)
    assert "result" in welcome0 and "result" in welcome1
    delivered = lambda kind: [p[0] for p in net2.pushes(kind) if id(p[2]) not in net2.undelivered]
    assert delivered("result") == ["node0", "node1"]
    assert delivered("score") == ["node0", "node1"]
    s2.tick()
    assert _victories(net2) == []


def test_restart_never_plays_victory_and_reconnect_gets_result():
    s, net, clock, ps, info = persisting_live()
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    s.control("end")
    s.finalise_recap()
    s2, net2 = restart_no_repersist(s, clock)
    s2.resume_match()
    assert _victories(net2) == []
    assert "result" in _welcome(net2, 0)
    assert "result" in _welcome(net2, 1)
    assert net2.pushes("score")


def test_resuming_recap_flag_clears_if_finish_raises():
    s, net, clock, ps, info = _end_pending()
    old = s._scorer_recap

    def broken(*args, **kwargs):
        raise RuntimeError("recap failed")

    s._scorer_recap = broken
    try:
        s._finish(resuming=True)
    except RuntimeError:
        pass
    else:
        assert False, "the fixture must raise"
    finally:
        s._scorer_recap = old
    assert s._resuming_recap is False


def test_f632_a_recap_assign_says_recap_and_a_new_session_assign_does_not():
    """F632: MC re-sends `assign` on every debrief edit (F631) and on NEW SESSION. The phone keeps its results only on
    the RECAP one, so only that one says `recap: true`; NEW SESSION's re-assign, the "new session exists" signal, does
    not. Any route that builds the body in RECAP carries it, a phone handed to a new node included (`_assign_body`)."""
    s, net, clock, ps, info = _end_pending()
    net.pushed.clear()
    s.patch_player(ps[0]["player_id"], display="RENAMED")          # a debrief rename
    debrief = net.pushes("assign")
    assert debrief and all(a[2].get("recap") is True for a in debrief), debrief
    assert s._assign_body(ps[1]).get("recap") is True, "every RECAP body says so, whichever node it goes to"
    s.finalise_recap()                                              # the host releases, then starts the next session
    net.pushed.clear()
    s.new_session(keep_roster=True)                                 # NEW MATCH: muster, kit still closed
    fresh = net.pushes("assign")
    assert fresh, "NEW SESSION re-assigns every bound phone"
    assert all("recap" not in a[2] for a in fresh), fresh
    assert "recap" not in s._assign_body(ps[1])
