"""NEXT MATCH without a mode pick (Tony, bench 2026-09-16: "why? just make a new one").

After the whistle MC used to refuse every GAMES edit except a MODE pick, and the recap pointed the
operator at a banner that said so. Now the operator's first action for the next match rolls the session
forward with the roster and the game kept. The roll happens on that action, never at the whistle, and
it must not cut off anything the finished match is still owed:

  (a) the A42 end delivery keeps re-telling phones that have not confirmed,
  (b) a late fact for the finished match reaches THAT match's recap, never the new one,
  (c) A34 still reconciles a phone that is still LIVE in the retired match,
  (d) the recap log sync still asks the phone that owes its log,
  (e) `game_no` still counts matches, not rolls.

Run: python3 run_tests.py mc_next_match
"""
from test_mc_block_b import kill
from test_mc_end_delivery import _ends_to, _hb, _unconfirmed, _view
from test_mc_result import go_live
from test_mc_stale_live import _controls_to, _stale_status

from brx_mcp.mc.state import END_RETRY_MS, SYNC_ACK_TIMEOUT_MS


def _kills(recap, pid):
    return next(r["kills"] for r in recap["rows"] if r["player_id"] == pid)


def _ack(s, net, clock, i, ok=True, echo="$LCD"):
    net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"], "ok": ok,
                                                         "gun_echo": echo}, clock["t"])


def _rows(s):
    return {r["player_id"]: r for r in s.snapshot()["sync"]["rows"]}


# --------------------------------------------------------------------------------------------------
# 1. the roll itself
# --------------------------------------------------------------------------------------------------
def test_next_match_keeps_the_roster_and_the_game_and_loads_it():
    s, net, clock, ps, info = go_live(2, "tdm", {"time_limit_s": 420})
    s.control("end")
    assert s.phase == "recap"
    mode, limit, teams = s.config["mode"], s.config["time_limit_s"], {p["player_id"]: p["team_id"] for p in ps}
    s.next_match()
    assert s.phase == "build", "lands on GAMES, with the game loaded"
    assert s.game_loaded and s.game_cfg == s.config["config_id"]
    assert (s.config["mode"], s.config["time_limit_s"]) == (mode, limit), "same mode and settings"
    assert {p["player_id"]: p["team_id"] for p in s.players.values()} == teams, "roster kept"
    assert s.lobby_pushed is False, "LOAD still writes no gun"
    assert info["match_id"] in [m["match_id"] for m in s.store.matches()], "the recap stays in match history"


def test_any_config_edit_after_the_whistle_rolls_forward_instead_of_refusing():
    """The old rule took a MODE pick only and refused the rest with "match is over"."""
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    s.set_config({"night": True})
    assert s.phase == "build" and s.config["night"] is True and s.scorer is None


def test_load_after_the_whistle_loads_the_next_match():
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    s.load_game()
    assert s.phase == "build" and s.game_loaded and s.scorer is None and s.last_recap is None


# --------------------------------------------------------------------------------------------------
# (b) a late fact belongs to the match it names
# --------------------------------------------------------------------------------------------------
def test_a_late_kill_after_the_roll_lands_in_the_finished_match_recap():
    s, net, clock, ps, info = go_live(2)
    mid = info["match_id"]
    clock["t"] += 5_000
    t_kill = clock["t"]                       # the kill happened DURING the match...
    clock["t"] += 5_000
    s.control("end")
    assert _kills(s._ended[mid]["recap"], ps[0]["player_id"]) == 0
    s.next_match()
    clock["t"] += 30_000                      # ...and the phone flushed it after the operator moved on
    net.simulate_event("node1", {"type": "death", "t": t_kill, "match_id": mid, "player_id": ps[1]["player_id"],
                                 "shooter_num": ps[0]["player_num"], "shooter_team": 1}, clock["t"], seq=900)
    assert _kills(s._ended[mid]["recap"], ps[0]["player_id"]) == 1, "A34's ledger has the late kill"
    stored = next(m for m in s.store.matches() if m["match_id"] == mid)
    assert _kills(stored["recap"], ps[0]["player_id"]) == 1, "the archived recap (match history) has it"
    assert s.scorer is None and s.phase == "build", "the late fact did not touch the new match"
    assert not [e for e in s.feed if "KILL" in str(e.get("text", "")).upper()], "nor its feed"
    # and the next match that starts scores nothing from it
    s.push_config()
    _ack(s, net, clock, 0); _ack(s, net, clock, 1)
    s.start(runway_s=10)
    net.simulate_event("node1", {"type": "death", "t": t_kill, "match_id": mid, "player_id": ps[1]["player_id"],
                                 "shooter_num": ps[0]["player_num"], "shooter_team": 1}, clock["t"], seq=901)
    assert all(r["kills"] == 0 for r in s.scorer.rows())


# --------------------------------------------------------------------------------------------------
# (a) the A42 end delivery outlives the roll
# --------------------------------------------------------------------------------------------------
def test_the_end_delivery_keeps_re_telling_a_straggler_after_the_roll():
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    clock["t"] += 500
    _hb(net, clock, "node0", ps[0]["player_id"], "kitted", info["match_id"], alive=False)
    s.next_match()
    assert _unconfirmed(s) == ["OP1"], "the operator still sees who has not confirmed"
    n1 = len(_ends_to(net, "node1"))
    clock["t"] += END_RETRY_MS[0]
    s.tick()
    assert len(_ends_to(net, "node1")) == n1 + 1, "the retry ladder is still running"
    assert _ends_to(net, "node1")[-1] == {"cmd": "end", "match_id": info["match_id"]}
    _hb(net, clock, "node1", ps[1]["player_id"], "kitted", info["match_id"])
    assert _view(s)["confirmed"] == 2, "and the receipt still lands"


def test_a_fresh_session_still_ends_the_watch():
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    s.new_session(keep_roster=False)
    assert _view(s) is None and s._retired_scorer is None


# --------------------------------------------------------------------------------------------------
# (c) A34, (d) log sync, (e) game_no
# --------------------------------------------------------------------------------------------------
def test_a34_still_reconciles_a_phone_live_in_the_match_rolled_past():
    s, net, clock, ps, info = go_live(2, "ffa", {"scoring": {"frag_limit": 1, "win_by": "kills"}})
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    assert s.phase == "recap"
    s.next_match()
    clock["t"] += 60_000
    before = len(_controls_to(net, "node1"))
    _stale_status(net, clock, "node1", info["match_id"])
    assert {"cmd": "end", "match_id": info["match_id"]} in _controls_to(net, "node1")[before:]
    res = [b for n, k, b in net.pushes("result") if n == "node1"]
    assert res and res[-1]["match_id"] == info["match_id"], "told how the retired match ended"


def test_the_recap_log_ask_survives_the_roll():
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    assert s._log_match == info["match_id"]
    s._on_node_message("node0", "log_data", {"node_id": "node0", "seq": 0, "chunk": "x", "last": True}, clock["t"])
    s.next_match()
    net.pushed.clear()
    from test_mc_block_b import online
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    asks = [(n, b.get("reason")) for n, k, b in net.pushed if k == "pull_log"]
    assert asks == [("node1", "reconnect")], asks


def test_game_no_counts_matches_not_rolls():
    s, net, clock, ps, info = go_live(2)
    g = s.game_no
    s.control("end")
    s.next_match()
    assert s.game_no == g, "a roll is not a match"
    s.push_config()
    assert s.game_no == g + 1, "the first push after a played match is the next game"
    s.push_config()
    assert s.game_no == g + 1, "a re-push is not"


# --------------------------------------------------------------------------------------------------
# PRE-ARM CHECK: nothing carries over, and waiting is not failing
# --------------------------------------------------------------------------------------------------
def test_the_pre_arm_gun_columns_do_not_carry_over_from_the_last_match():
    """Bench 2026-09-16: RECAP, phones re-joined, and the check read PUSHED 2/2 from the match before."""
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    rows = _rows(s)
    assert not any(r["gun_sent"] or r["gun_acked"] for r in rows.values()), rows
    assert {r["ack_state"] for r in rows.values()} == {"none"}
    s.next_match()
    assert not any(r["gun_sent"] for r in _rows(s).values())


def test_ack_state_is_waiting_then_acked_or_failed():
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    s.next_match()
    s.push_config(force=True)
    assert {r["ack_state"] for r in _rows(s).values()} == {"waiting"}, "a fresh push is not a fault"
    _ack(s, net, clock, 0)
    _ack(s, net, clock, 1, ok=False, echo=None)
    rows = _rows(s)
    assert rows[ps[0]["player_id"]]["ack_state"] == "acked"
    assert rows[ps[1]["player_id"]]["ack_state"] == "failed", "a refused ack is a real failure"


def test_ack_state_fails_on_timeout_but_not_before():
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    s.next_match()
    s.push_config(force=True)
    clock["t"] += SYNC_ACK_TIMEOUT_MS - 1_000
    _hb(net, clock, "node0", ps[0]["player_id"], "kitted", None)
    _hb(net, clock, "node1", ps[1]["player_id"], "kitted", None)
    assert _rows(s)[ps[0]["player_id"]]["ack_state"] == "waiting"
    clock["t"] += 2_000
    _hb(net, clock, "node0", ps[0]["player_id"], "kitted", None)
    assert _rows(s)[ps[0]["player_id"]]["ack_state"] == "failed", "no answer in time"
