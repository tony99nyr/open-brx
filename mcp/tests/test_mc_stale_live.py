"""A34 (field 2026-09-12) — a phone that comes back still LIVE in a match MC has retired is TOLD.

The night's "huge bug": one phone (Tactix-3D4F's) dropped off the Wi-Fi at the whistle, came back a minute later
still LIVE, and MC -- already on the next KIT after RECALL -- had nothing that told it. Its own status
heartbeat says `arm_state: live, match_id: <old>`, and that heartbeat is the moment MC knows the phone is
reachable and wrong. So MC answers it from there: `control{end, match_id}`, the retired match's `result`
when it holds one for that player, and the CURRENT `start` when a new match is already scheduled.
"""
from test_mc_block_b import kill
from test_mc_result import go_live, results

from brx_mcp.mc.types import STALE_LIVE_RETELL_MS


def _stale_status(net, clock, nid, mid, extra=None):
    body = {"arm_state": "live", "synced": True, "alive": True, "hp": 12, **({"match_id": mid} if mid else {}), **(extra or {})}
    net.simulate_status(nid, body, clock["t"])


def _controls_to(net, nid):
    return [b for n, k, b in net.pushes("control") if n == nid]


def _reconciled(s):
    return [e for e in s.feed if e.get("tag") == "RECONCILED"]


def _ended_by_cap_and_moved_on(cap_scorer_i=0, victim_i=1):
    """Two phones, a frag-cap end, then RECALL (the RECAP screen's way back to KIT). node1 was silent
    through the whistle -- exactly the phone that never took the end."""
    s, net, clock, ps, info = go_live(2, "ffa", {"scoring": {"frag_limit": 1, "win_by": "kills"}})
    kill(s, net, clock, ps, cap_scorer_i, victim_i, info, seq=1)
    assert s.phase == "recap"
    n_before = len(_controls_to(net, "node1"))
    s.control("recall")
    assert s.phase == "kit" and s.start_info is None and s.scorer is None
    n_after = len(_controls_to(net, "node1"))
    assert n_after == n_before + 1, "the recall itself reaches node1 (broadcast) -- that is the baseline"
    return s, net, clock, ps, info


def test_a_phone_still_live_in_the_retired_match_is_told_to_end_and_given_its_result():
    s, net, clock, ps, info = _ended_by_cap_and_moved_on()
    before_ctl = {n: len(_controls_to(net, n)) for n in ("node0", "node1")}
    before_res = len([1 for n, k, b in net.pushes("result") if n == "node1"])
    clock["t"] += 60_000
    _stale_status(net, clock, "node1", info["match_id"])
    ends = [b for b in _controls_to(net, "node1")[before_ctl["node1"]:] if b.get("cmd") == "end"]
    assert ends == [{"cmd": "end", "match_id": info["match_id"]}], ends
    assert len(_controls_to(net, "node0")) == before_ctl["node0"], "the phone that ended properly hears nothing"
    res = [b for n, k, b in net.pushes("result") if n == "node1"][before_res:]
    assert len(res) == 1 and res[0]["match_id"] == info["match_id"] and res[0]["outcome"] == "lose", res
    assert res[0]["my"]["player_id"] == ps[1]["player_id"]
    assert [e["text"] for e in _reconciled(s)] == ["OP1'S PHONE CAME BACK STILL LIVE IN AN ENDED MATCH — TOLD TO END"]


def test_a_live_status_for_the_current_match_while_mc_is_live_pushes_nothing():
    s, net, clock, ps, info = go_live(2, "ffa")
    before = len(_controls_to(net, "node1")); nres = len(net.pushes("result"))
    _stale_status(net, clock, "node1", info["match_id"])
    assert len(_controls_to(net, "node1")) == before and len(net.pushes("result")) == nres
    assert not _reconciled(s)


def test_the_retell_is_rate_limited_per_phone_and_match():
    s, net, clock, ps, info = _ended_by_cap_and_moved_on()
    base = len(_controls_to(net, "node1"))
    clock["t"] += 1_000
    _stale_status(net, clock, "node1", info["match_id"])
    clock["t"] += 3_000
    _stale_status(net, clock, "node1", info["match_id"])
    assert len(_controls_to(net, "node1")) == base + 1, "3 s later: the first end is still in flight, say nothing"
    clock["t"] += STALE_LIVE_RETELL_MS + 1_000
    _stale_status(net, clock, "node1", info["match_id"])
    assert len(_controls_to(net, "node1")) == base + 2, "11 s later and still live: tell it again"
    assert len(_reconciled(s)) == 2


def test_mc_armed_for_the_next_match_ends_the_old_one_then_re_pushes_start():
    s, net, clock, ps, info = _ended_by_cap_and_moved_on()
    # KIT -> LOBBY -> a new start, node0 acks along; node1 is still out on the field, live in the old match
    s.push_config(force=True)
    net.simulate_node_message("node0", "ack_config", {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    info2 = s.start(runway_s=30, force=True)    # node1 never acked: it is out there, still live
    assert s.phase == "armed" and info2["match_id"] != info["match_id"]
    base = len(_controls_to(net, "node1")); nstart = len([1 for n, k, b in net.pushes("start") if n == "node1"])
    clock["t"] += 2_000
    _stale_status(net, clock, "node1", info["match_id"])
    ctl = _controls_to(net, "node1")[base:]
    assert ctl == [{"cmd": "end", "match_id": info["match_id"]}], ctl
    starts = [b for n, k, b in net.pushes("start") if n == "node1"][nstart:]
    assert len(starts) == 1 and starts[0]["match_id"] == info2["match_id"], "then the CURRENT start, so it hot-joins"
    # ...and a node correctly armed for the NEW match is left alone
    base0 = len(_controls_to(net, "node0"))
    net.simulate_status("node0", {"arm_state": "armed", "synced": True, "match_id": info2["match_id"]}, clock["t"])
    assert len(_controls_to(net, "node0")) == base0


def test_a_stale_live_status_with_no_match_id_in_kit_gets_an_end_but_no_result():
    s, net, clock, ps, info = _ended_by_cap_and_moved_on()
    base = len(_controls_to(net, "node1")); nres = len(net.pushes("result"))
    clock["t"] += 5_000
    _stale_status(net, clock, "node1", None)
    ctl = _controls_to(net, "node1")[base:]
    assert ctl == [{"cmd": "end"}], "no match named: the operator-style end, nothing to attribute a result to"
    assert len(net.pushes("result")) == nres


def test_a_player_added_after_the_match_gets_the_end_but_no_result():
    s, net, clock, ps, info = _ended_by_cap_and_moved_on()
    late = s.add_player("LATE", gun_id="GUN-C")
    from brx_mcp.mc.fakes import demo_armory
    net.simulate_hello("node2", f"GUN-C-{demo_armory()[2]['ble']['tail']}")
    assert s.players[late["player_id"]]["node_id"] == "node2"
    nres = len(net.pushes("result"))
    clock["t"] += 5_000
    _stale_status(net, clock, "node2", info["match_id"])
    assert [b for b in _controls_to(net, "node2") if b.get("cmd") == "end"] == [{"cmd": "end", "match_id": info["match_id"]}]
    assert len(net.pushes("result")) == nres, "they were in the car park for that match: no verdict for them"
    assert _reconciled(s)[0]["text"].startswith("LATE'S PHONE")


def test_an_aborted_start_is_retired_too():
    """A phone that missed `abort_start` and comes back ARMED for the aborted schedule is ended."""
    s, net, clock, ps = go_live(2, "ffa")[:4]
    s.control("recall")
    s.push_config(force=True)
    info = s.start(runway_s=60, force=True)
    s.abort_start()
    assert s.phase == "lobby"
    base = len(_controls_to(net, "node1"))
    clock["t"] += 3_000
    net.simulate_status("node1", {"arm_state": "armed", "synced": True, "match_id": info["match_id"]}, clock["t"])
    assert _controls_to(net, "node1")[base:] == [{"cmd": "end", "match_id": info["match_id"]}]


def test_the_existing_result_paths_are_unchanged():
    """`_result_body` grew keyword-only knobs; every existing caller must produce the same body as before."""
    s, net, clock, ps, info = go_live(2, "ffa", {"scoring": {"frag_limit": 1, "win_by": "kills"}})
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    got = results(net)
    assert got["node0"]["outcome"] == "win" and got["node1"]["outcome"] == "lose"
    assert got["node0"]["match_id"] == info["match_id"]
