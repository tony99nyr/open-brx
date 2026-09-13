"""A42 — the END is a DELIVERY, and the heartbeat is the receipt.

Field 2026-09-12, twice: the operator ended the match and a player's tagger played on. Tony called it a
huge bug and asked for "some kind of retry logic which confirms all player hud ack".

Nothing MC had could answer that. `_broadcast_control` counts nodes that had a SOCKET (`net.push` returns
False only when there is none) and `net._send` swallows the exception of a send that fails afterwards, so
"END REACHED 2 OF 2 NODES" was never a statement about any HUD. There is no `ack` kind for `control`.

The receipt already exists and costs nothing: a bound phone heartbeats every ~2 s with `arm_state` and
`match_id` (`engine.js statusBody`), and `_endLocal` keeps `match_id` while moving the phone to `kitted`.
A phone that TOOK the end reports `kitted` for that match; one that MISSED it reports `live`.

The hard requirement these tests exist to protect: **ending a match never waits on a phone.** `_finish()`
has already moved MC to recap before the first retry is even due. A player who walks out of range at the
whistle is normal, and must not be able to hang the whistle.

Run: python3 run_tests.py mc_end_delivery
"""
from brx_mcp.mc.fakes import FakeNet
from brx_mcp.mc.state import END_RETRY_MS
from test_mc_block_b import DeafNet, go_live, mk, online


def _controls_to(net, nid):
    return [b for n, k, b in net.pushes("control") if n == nid]


def _ends_to(net, nid):
    return [b for b in _controls_to(net, nid) if b.get("cmd") == "end"]


def _hb(net, clock, nid, pid, arm_state, match_id, alive=True):
    """One status heartbeat, shaped as `engine.js statusBody` sends it."""
    net.simulate_status(nid, {"player_id": pid, "arm_state": arm_state, "synced": True, "alive": alive,
                              "shots": 0, "pending": 0,
                              **({"match_id": match_id} if match_id else {})}, clock["t"])


def _view(s):
    return s.snapshot().get("end_delivery")


def _unconfirmed(s):
    return [r["display"] for r in (_view(s) or {}).get("unconfirmed", [])]


# --------------------------------------------------------------------------------------------------
# the watch itself
# --------------------------------------------------------------------------------------------------
def test_the_whistle_arms_a_delivery_watch_over_every_bound_player_hud():
    s, net, clock, ps, info = go_live(2)
    assert _view(s) is None, "nothing to say before a match has ended"
    s.control("end")
    v = _view(s)
    assert v and v["match_id"] == info["match_id"]
    assert v["total"] == 2 and v["confirmed"] == 0, v
    assert sorted(_unconfirmed(s)) == ["OP0", "OP1"], v


def test_the_operator_end_names_the_match_so_no_retry_can_ever_touch_a_newer_one():
    """A34 gave `control{end}` an optional `match_id` and the node ignores an end naming a match it is
    not playing. The OPERATOR's end never carried one, so a re-delivery of it was a blunt instrument."""
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    for nid in ("node0", "node1"):
        assert _ends_to(net, nid)[-1] == {"cmd": "end", "match_id": info["match_id"]}, _ends_to(net, nid)


def test_the_end_never_waits_on_a_phone():
    """The whole mechanism observes; it must not gate. MC is in recap with the recap written before any
    retry is due, with BOTH phones deaf."""
    s, net, clock, ps, info = go_live(2, net=DeafNet(("node0", "node1")))
    r = s.control("end")
    assert s.phase == "recap" and r["ok"] and r["ended"]
    assert s.last_recap is not None, "the recap is written at the whistle, not when a phone answers"
    assert _view(s)["confirmed"] == 0, "and the unconfirmed pair did not hold anything up"


# --------------------------------------------------------------------------------------------------
# the receipt: the heartbeat the phone already sends
# --------------------------------------------------------------------------------------------------
def test_a_kitted_heartbeat_confirms_the_end_with_no_new_message_kind():
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    clock["t"] += 500
    for i, p in enumerate(ps):
        _hb(net, clock, f"node{i}", p["player_id"], "kitted", info["match_id"], alive=False)
    v = _view(s)
    assert v["confirmed"] == 2 and v["unconfirmed"] == [], v
    assert v["retrying"] is False


def test_a_phone_still_live_after_the_whistle_is_not_counted_as_confirmed():
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    clock["t"] += 500
    _hb(net, clock, "node0", ps[0]["player_id"], "kitted", info["match_id"], alive=False)
    _hb(net, clock, "node1", ps[1]["player_id"], "live", info["match_id"])
    v = _view(s)
    assert v["confirmed"] == 1 and _unconfirmed(s) == ["OP1"], v


def test_a_phone_that_moved_on_to_a_newer_match_has_left_this_one():
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    clock["t"] += 500
    _hb(net, clock, "node1", ps[1]["player_id"], "live", "some-newer-match")
    assert "OP1" not in _unconfirmed(s)


def test_an_app_that_reports_no_arm_state_makes_no_claim_either_way():
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    clock["t"] += 500
    net.simulate_status("node1", {"player_id": ps[1]["player_id"], "shots": 3}, clock["t"])
    assert "OP1" in _unconfirmed(s), "silence is not a confirmation"


# --------------------------------------------------------------------------------------------------
# the re-delivery
# --------------------------------------------------------------------------------------------------
def test_a_phone_that_missed_the_end_is_told_again_on_a_backoff():
    """node1 is out of range at the whistle and sends NOTHING, so the tick is the only thing that can
    re-deliver — the field's actual case, and the one A34 cannot reach (it answers a heartbeat)."""
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    clock["t"] += 500
    _hb(net, clock, "node0", ps[0]["player_id"], "kitted", info["match_id"], alive=False)
    n0, n1 = len(_ends_to(net, "node0")), len(_ends_to(net, "node1"))
    clock["t"] += END_RETRY_MS[0]
    s.tick()
    assert len(_ends_to(net, "node1")) == n1 + 1, "the straggler is told again"
    assert len(_ends_to(net, "node0")) == n0, "the phone that confirmed hears nothing more"
    assert _ends_to(net, "node1")[-1] == {"cmd": "end", "match_id": info["match_id"]}


def test_the_re_delivery_stops_the_moment_the_straggler_confirms():
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    clock["t"] += END_RETRY_MS[0] + 1
    s.tick()
    n1 = len(_ends_to(net, "node1"))
    _hb(net, clock, "node1", ps[1]["player_id"], "kitted", info["match_id"], alive=False)
    clock["t"] += 60_000
    s.tick()
    assert len(_ends_to(net, "node1")) == n1, "a confirmed HUD is never pushed again"


def test_the_backoff_lengthens_and_the_ladder_runs_out():
    """It must not hammer a phone that is simply gone — and it must stop, because A34's reconcile
    answers a returning phone from its own heartbeat for as long as MC remembers the match."""
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    gaps, last = [], len(_ends_to(net, "node1"))
    for _ in range(len(END_RETRY_MS) + 4):
        for step in range(1, 200):          # advance a second at a time until the next try lands
            clock["t"] += 1000
            s.tick()
            if len(_ends_to(net, "node1")) > last:
                gaps.append(step)
                last = len(_ends_to(net, "node1"))
                break
        else:
            break
    assert gaps == sorted(gaps), f"the gaps must never shorten: {gaps}"
    assert len(gaps) == len(END_RETRY_MS), f"one try per rung, then it stops: {gaps}"
    assert max(gaps) <= 60, f"capped near a minute: {gaps}"
    v = _view(s)
    assert v["retrying"] is False, "a spent ladder must stop trying"
    assert "OP1" in _unconfirmed(s) and v["confirmed"] == 0


def test_a_spent_ladder_still_shows_the_straggler_to_the_operator():
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    _hb(net, clock, "node0", ps[0]["player_id"], "kitted", info["match_id"], alive=False)
    for _ in range(400):
        clock["t"] += 1000
        s.tick()
    assert _unconfirmed(s) == ["OP1"], _view(s)
    assert _view(s)["retrying"] is False
    said = [e for e in s.feed if "NEVER CONFIRMED" in e.get("text", "")]
    assert len(said) == 1, f"named once, not once per tick: {len(said)}"
    assert "OP1" in said[0]["text"]


def test_a_node_with_no_socket_at_all_is_still_shown_as_unconfirmed():
    s, net, clock, ps, info = go_live(2, net=DeafNet(("node1",)))
    s.control("end")
    _hb(net, clock, "node0", ps[0]["player_id"], "kitted", info["match_id"], alive=False)
    clock["t"] += END_RETRY_MS[0] + 1
    s.tick()
    assert _unconfirmed(s) == ["OP1"]
    assert _view(s)["unconfirmed"][0]["reached"] is False, "MC must not claim a push that had no socket"


# --------------------------------------------------------------------------------------------------
# who is never expected to confirm
# --------------------------------------------------------------------------------------------------
def test_a_player_with_no_phone_is_never_expected_to_confirm():
    s, net, clock, ps, info = go_live(2)
    benched = s.add_player("NOPHONE")
    assert benched.get("node_id") is None
    s.control("end")
    assert _view(s)["total"] == 2 and "NOPHONE" not in _unconfirmed(s)


def test_a_utility_station_is_never_expected_to_confirm():
    s, net, clock, ps, info = go_live(2)
    net.simulate_hello("node9", "PHONE-9", node_type="utility")
    s.control("end")
    assert _view(s)["total"] == 2
    assert all(r["node_id"] != "node9" for r in _view(s)["unconfirmed"])


# --------------------------------------------------------------------------------------------------
# it belongs to ONE match
# --------------------------------------------------------------------------------------------------
def test_a_new_match_clears_the_previous_match_watch():
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    assert _view(s)["total"] == 2
    s.push_config()
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                             "gun_echo": "$LCD"}, clock["t"])
    s.start(runway_s=10)
    assert _view(s) is None, "the last match's delivery is not a fact about this one"


def test_a_new_session_clears_the_watch():
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    s.new_session()
    assert _view(s) is None


def test_the_timed_end_is_watched_too():
    """A timed end pushes no `control` at all — every phone ends on its own clock. That is exactly the
    case where the operator most needs to know which phone did NOT."""
    s, net, clock, ps, info = go_live(2, cfg={"time_limit_s": 60})
    clock["t"] = info["go_live_t"] + 60_000 + 5_001
    s.tick()
    assert s.phase == "recap"
    assert _view(s)["total"] == 2 and _view(s)["confirmed"] == 0


def test_an_end_with_nothing_to_end_arms_nothing():
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    r = s.control("end")
    assert r["ok"] is False and r["ended"] is False
    assert _view(s) is None, "there is no match whose end could be unconfirmed"


# --------------------------------------------------------------------------------------------------
# A34 and A42 are one mechanism, not two
# --------------------------------------------------------------------------------------------------
def test_a34_s_reconcile_counts_as_this_match_s_delivery_try():
    """A34 answers a phone that reports a retired match from its own heartbeat. When that phone is one
    of ours, the two must not push twice in the same breath, and A34's push must move our backoff on."""
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    clock["t"] += 30_000
    before = len(_ends_to(net, "node1"))
    _hb(net, clock, "node1", ps[1]["player_id"], "live", info["match_id"])
    after = len(_ends_to(net, "node1"))
    assert after == before + 1, "one end, not two, for one heartbeat"
    v = next(r for r in _view(s)["unconfirmed"] if r["display"] == "OP1")
    assert v["tries"] >= 2, "A34's push is one of ours"


def test_every_push_this_mechanism_makes_names_the_match():
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    for _ in range(200):
        clock["t"] += 1000
        s.tick()
    for b in _ends_to(net, "node1"):
        assert b.get("match_id") == info["match_id"], b


def test_the_fake_and_the_real_net_agree_about_a_push_with_no_socket():
    """`FakeNet.push` returns None and the real one returns False for a node with no socket — the
    `is not False` convention this file relies on."""
    net = FakeNet()
    assert net.push("nobody", "control", {"cmd": "end"}) is not False
