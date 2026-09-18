"""A47 — the LIVE board's operator menu: RESYNC GUN, FORCE RESPAWN, RELINK GUN for ONE player.

Bench 2026-09-17 (Tony): a player in a bad state (for example a gun that cannot fire) had no cure MC could
send. `POST /api/players/{pid}/operator {cmd, match_id}` pushes `control{cmd, player_id, match_id}` to that
player's bound phone only. MC refuses it outside ARMED/LIVE, for a stale board's match, and for a phone that
is unbound or out of reach. It is never a config or head push.

Run: python3 run_tests.py mc_operator_actions
"""
from _skip import needs

from brx_mcp.mc import envelope as E
from brx_mcp.mc.state import STALE_AFTER_MS, ConflictError
from test_mc_block_b import DeafNet, go_live, heartbeat, kill, mk, online

try:
    from starlette.testclient import TestClient
    import httpx  # noqa: F401
    HAVE_HTTP = True
except Exception:
    HAVE_HTTP = False


def _refused(fn, *a, conflict=True):
    try:
        fn(*a)
    except ValueError as e:
        assert isinstance(e, ConflictError) == conflict, (type(e), e)
        return str(e)
    raise AssertionError("expected a refusal")


def test_each_action_pushes_one_control_to_that_player_phone_only():
    s, net, clock, ps, info = go_live(2)
    for cmd in ("resync", "respawn", "relink"):
        before = len(net.pushed)
        r = s.operator_action(ps[1]["player_id"], cmd, info["match_id"])
        assert r == {"ok": True, "cmd": cmd, "player_id": ps[1]["player_id"],
                     "match_id": info["match_id"], "pushed": True}, r
        new = net.pushed[before:]
        assert new == [("node1", "control", {"cmd": cmd, "player_id": ps[1]["player_id"],
                                             "match_id": info["match_id"]})], new
        # the envelope a phone receives is valid on the wire (CONTROL_CMDS lists the cmd)
        E.validate(E.make_envelope("control", new[0][2]), direction="mc")
    assert not any(k in ("config", "start") for _n, k, _b in net.pushed[-3:])


def test_the_send_says_sent_and_claims_nothing_about_the_phone():
    s, net, clock, ps, info = go_live(2)
    s.operator_action(ps[0]["player_id"], "respawn", info["match_id"])
    s.operator_action(ps[0]["player_id"], "resync", info["match_id"])
    s.operator_action(ps[0]["player_id"], "relink", info["match_id"])
    texts = [f["text"] for f in s.feed[:3]]
    assert texts == ["SENT RELINK TO OP0", "SENT RESYNC TO OP0", "SENT RESPAWN TO OP0"], texts
    assert all(f["tag"] == "OPERATOR" and f["kind"] == "alert" for f in s.feed[:3])
    row = next(r for r in s.snapshot()["live"]["rows"] if r["player_id"] == ps[0]["player_id"])
    assert row["operator"]["cmd"] == "relink" and row["operator"]["state"] == "sent", row


def test_refused_outside_armed_and_live():
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    before = len(net.pushed)
    msg = _refused(s.operator_action, ps[0]["player_id"], "respawn", "any-match")
    assert "ARMED or LIVE" in msg, msg
    assert len(net.pushed) == before, "a refusal sends nothing"


def test_refused_for_a_stale_match_id():
    s, net, clock, ps, info = go_live(2)
    before = len(net.pushed)
    assert "match is over" in _refused(s.operator_action, ps[0]["player_id"], "resync", "old-match")
    assert "match is over" in _refused(s.operator_action, ps[0]["player_id"], "resync", "")
    assert len(net.pushed) == before


def test_refused_for_a_phone_out_of_reach_or_unbound():
    s, net, clock, ps, info = go_live(2)
    clock["t"] += STALE_AFTER_MS + 1          # no heartbeat since go_live
    before = len(net.pushed)
    assert "OUT OF REACH" in _refused(s.operator_action, ps[0]["player_id"], "respawn", info["match_id"])
    assert len(net.pushed) == before
    s.players[ps[1]["player_id"]]["node_id"] = None
    assert "OUT OF REACH" in _refused(s.operator_action, ps[1]["player_id"], "respawn", info["match_id"])


def test_a_push_no_socket_took_is_reported_not_claimed():
    s, net, clock, ps, info = go_live(2, net=DeafNet(("node0",)))
    assert "NO CONNECTION" in _refused(s.operator_action, ps[0]["player_id"], "relink", info["match_id"])
    assert not s.feed or s.feed[0]["tag"] != "OPERATOR", "nothing reached a phone, so the feed does not say it did"


def test_unknown_cmd_and_unknown_player_are_bad_requests():
    s, net, clock, ps, info = go_live(1)
    _refused(s.operator_action, ps[0]["player_id"], "panic", info["match_id"], conflict=False)
    _refused(s.operator_action, "nobody", "resync", info["match_id"], conflict=False)


def test_an_operator_respawn_fact_keeps_the_streak():
    """The phone's revive emits `respawn{operator:true}`. A normal respawn after a death resets the streak;
    the operator's respawn of a living player is not a new life after a death, so it must not."""
    s, net, clock, ps, info = go_live(2)
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    kill(s, net, clock, ps, 0, 1, info, seq=2)
    streak = s.scorer.stats[ps[0]["player_id"]].streak
    assert streak == 2, streak
    clock["t"] += 100
    net.simulate_event("node0", {"type": "respawn", "t": clock["t"], "match_id": info["match_id"],
                                 "player_id": ps[0]["player_id"], "operator": True}, clock["t"], seq=3)
    assert s.scorer.stats[ps[0]["player_id"]].streak == 2
    net.simulate_event("node0", {"type": "respawn", "t": clock["t"], "match_id": info["match_id"],
                                 "player_id": ps[0]["player_id"]}, clock["t"], seq=4)
    assert s.scorer.stats[ps[0]["player_id"]].streak == 0


def test_the_route_needs_the_operator_token_and_answers_409_for_a_refusal():
    needs(HAVE_HTTP, "starlette + httpx")
    from brx_mcp.mc.api import create_app
    s, net, clock, ps, info = go_live(2)
    tok = "op-menu-token"
    c = TestClient(create_app(s, token=tok))
    url = f"/api/players/{ps[0]['player_id']}/operator"
    body = {"cmd": "respawn", "match_id": info["match_id"]}
    before = len(net.pushed)
    assert c.post(url, json=body).status_code == 401
    assert len(net.pushed) == before, "an unauthenticated press sends nothing"
    auth = {"Authorization": f"Bearer {tok}"}
    r = c.post(url, json=body, headers=auth)
    assert r.status_code == 200 and r.json()["ok"] is True, r.text
    r = c.post(url, json={**body, "match_id": "old"}, headers=auth)
    assert r.status_code == 409 and "match is over" in r.json()["error"], r.text
    r = c.post(url, json={**body, "cmd": "nope"}, headers=auth)
    assert r.status_code == 400, r.text


# ── A47 operator outcome: the phone's `operator_result` fact ───────────────────────────────────────
def _result(net, clock, i, info, cmd, ok, seq, why=None, pid=None, match_id=None):
    body = {"type": "operator_result", "t": clock["t"], "match_id": match_id or info["match_id"],
            "player_id": pid, "cmd": cmd, "ok": ok, **({"why": why} if why else {})}
    net.simulate_event(f"node{i}", body, clock["t"], seq=seq)
    return body


def _row(s, pid):
    return next(r for r in s.snapshot()["live"]["rows"] if r["player_id"] == pid)


def test_the_feed_line_comes_from_the_phone_result_not_the_send():
    s, net, clock, ps, info = go_live(2)
    pid = ps[1]["player_id"]
    s.operator_action(pid, "resync", info["match_id"])
    assert _row(s, pid)["operator"]["state"] == "sent"
    clock["t"] += 500
    _result(net, clock, 1, info, "resync", True, seq=11, pid=pid)
    assert s.feed[0]["text"] == "RESYNC DONE: OP1" and s.feed[0]["tag"] == "OPERATOR"
    op = _row(s, pid)["operator"]
    assert op["state"] == "done" and op["why"] is None and op["result_t"] == clock["t"], op
    clock["t"] += 2500
    s.operator_action(pid, "respawn", info["match_id"])
    _result(net, clock, 1, info, "respawn", True, seq=12, pid=pid)
    assert s.feed[0]["text"] == "RESPAWNED OP1 (OPERATOR)"
    clock["t"] += 2500
    s.operator_action(pid, "resync", info["match_id"])
    _result(net, clock, 1, info, "resync", False, seq=13, pid=pid, why="stunned")
    assert s.feed[0]["text"] == "RESYNC REFUSED BY OP1: STUNNED"
    op = _row(s, pid)["operator"]
    assert op["state"] == "refused" and op["why"] == "STUNNED", op


def test_an_operator_result_is_stored_but_never_scored():
    s, net, clock, ps, info = go_live(2)
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    before_rows = s.scorer.rows()
    s.scorer.stats[ps[0]["player_id"]].flushed = False
    _result(net, clock, 0, info, "respawn", True, seq=2, pid=ps[0]["player_id"])
    s.ingest_batch("node0", [{"type": "operator_result", "t": clock["t"], "match_id": info["match_id"],
                              "cmd": "resync", "ok": False, "why": "down", "seq": 3}], clock["t"])
    assert s.scorer.rows() == before_rows, "the scorer did not move"
    assert s.scorer.stats[ps[0]["player_id"]].flushed is False, "a result is not a scoring fact"
    assert [f["text"] for f in s.feed[:2]] == ["RESYNC REFUSED BY OP0: DOWN", "RESPAWNED OP0 (OPERATOR)"]


def test_a_replayed_or_foreign_result_writes_nothing():
    s, net, clock, ps, info = go_live(2)
    pid = ps[0]["player_id"]
    _result(net, clock, 0, info, "resync", True, seq=5, pid=pid)
    n = len(s.feed)
    _result(net, clock, 0, info, "resync", True, seq=5, pid=pid)       # the outbox replays it
    _result(net, clock, 0, info, "resync", True, seq=6, match_id="another-match")
    _result(net, clock, 0, info, "resync", True, seq=7, pid=ps[1]["player_id"])   # names another player
    assert len(s.feed) == n, s.feed[:3]


def test_the_wire_accepts_an_operator_result_event():
    body = {"type": "operator_result", "t": 1_800_000_000_000, "match_id": "m", "player_id": "p", "node_id": "n",
            "cmd": "resync", "ok": False, "why": "stunned"}
    E.validate(E.make_envelope("event", body, seq=1), direction="node")
    try:
        E.validate(E.make_envelope("event", {k: v for k, v in body.items() if k != "ok"}, seq=2), direction="node")
    except E.EnvelopeError:
        pass
    else:
        raise AssertionError("`ok` is the fact itself: an operator_result without it is malformed")


def test_resync_and_respawn_need_live_while_relink_works_in_armed():
    from test_mc_block_b import mk as mk_b
    s, net, clock, ps = mk_b(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.push_config()
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                             "gun_echo": "$LCD"}, clock["t"])
    info = s.start(runway_s=10)
    assert s.phase == "armed"
    before = len(net.pushed)
    for cmd in ("resync", "respawn"):
        msg = _refused(s.operator_action, ps[0]["player_id"], cmd, info["match_id"])
        assert "NEEDS A LIVE MATCH" in msg, msg
    assert len(net.pushed) == before
    assert s.operator_action(ps[0]["player_id"], "relink", info["match_id"])["ok"] is True


def test_force_respawn_is_refused_for_a_down_player_when_the_mode_has_no_respawn():
    s, net, clock, ps, info = go_live(2, mode="ffa", cfg={"respawn": {"type": "none", "delay_s": 0}})
    assert s.config["respawn"]["type"] == "none"
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    for i, p in enumerate(ps):                          # both phones in reach; OP1's heartbeat says down
        net.simulate_status(f"node{i}", {"player_id": p["player_id"], "alive": i == 0, "synced": True,
                                         "pending": 0}, clock["t"])
    before = len(net.pushed)
    msg = _refused(s.operator_action, ps[1]["player_id"], "respawn", info["match_id"])
    assert "NO RESPAWN" in msg and "OP1 IS OUT" in msg, msg
    assert len(net.pushed) == before
    assert s.operator_action(ps[0]["player_id"], "respawn", info["match_id"])["ok"] is True, \
        "a living player can still be respawned (full pools), which changes no survival outcome"
    assert s.operator_action(ps[1]["player_id"], "relink", info["match_id"])["ok"] is True


def test_the_same_action_twice_inside_two_seconds_is_a_double_tap():
    s, net, clock, ps, info = go_live(2)
    pid = ps[0]["player_id"]
    s.operator_action(pid, "respawn", info["match_id"])
    before = len(net.pushed)
    clock["t"] += 1999
    assert "JUST SENT" in _refused(s.operator_action, pid, "respawn", info["match_id"])
    assert len(net.pushed) == before
    assert s.operator_action(pid, "relink", info["match_id"])["ok"], "another action is not a double tap"
    assert s.operator_action(ps[1]["player_id"], "respawn", info["match_id"])["ok"], "nor is another player"
    clock["t"] += 1
    heartbeat(s, net, clock, ps)
    assert s.operator_action(pid, "respawn", info["match_id"])["ok"]


# ── pl4 (2026-09-17) ─────────────────────────────────────────────────────────────────────────────────
def test_pl4_a_relink_result_says_started_not_done():
    """The phone's `ok` for relink means it STARTED the relink; the gun coming back is a later heartbeat."""
    s, net, clock, ps, info = go_live(2)
    pid = ps[1]["player_id"]
    s.operator_action(pid, "relink", info["match_id"])
    _result(net, clock, 1, info, "relink", True, seq=21, pid=pid)
    assert s.feed[0]["text"] == "RELINK STARTED: OP1"


def test_pl4_sent_with_no_answer_reads_no_answer_after_15_s_and_a_late_answer_still_lands():
    s, net, clock, ps, info = go_live(2)
    pid = ps[0]["player_id"]
    s.operator_action(pid, "resync", info["match_id"])
    clock["t"] += s.OPERATOR_NO_ANSWER_MS - 1
    s.tick()
    assert _row(s, pid)["operator"]["state"] == "sent", "control: not yet"
    clock["t"] += 1
    s.tick()
    assert _row(s, pid)["operator"]["state"] == "no_answer"
    _result(net, clock, 0, info, "resync", True, seq=31, pid=pid)
    assert _row(s, pid)["operator"]["state"] == "done"


def test_pl4_a_result_for_an_earlier_action_writes_the_feed_but_not_the_newer_row():
    s, net, clock, ps, info = go_live(2)
    pid = ps[1]["player_id"]
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    s.operator_action(pid, "relink", info["match_id"])
    clock["t"] += 2500
    s.operator_action(pid, "respawn", info["match_id"])
    _result(net, clock, 1, info, "relink", True, seq=41, pid=pid)
    assert s.feed[0]["text"] == "RELINK STARTED: OP1", "the feed line is always written"
    op = _row(s, pid)["operator"]
    assert op["cmd"] == "respawn" and op["state"] == "sent", op


def test_pl4_a_single_operator_result_never_reaches_the_retired_scorer():
    s, net, clock, ps, info = go_live(2)
    seen = []
    orig = s._ingest_retired
    s._ingest_retired = lambda nid, evs, t: (seen.extend(e.get("type") for e in evs), orig(nid, evs, t))
    _result(net, clock, 0, info, "resync", True, seq=51, pid=ps[0]["player_id"])
    assert "operator_result" not in seen, seen
    kill(s, net, clock, ps, 0, 1, info, seq=52)
    assert "death" in seen, "control: other facts still go there"
