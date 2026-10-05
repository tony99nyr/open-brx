"""F474: a phone whose wall clock steps AFTER its clock sync stamps every later fact off by the step, and MC
used to trust that stamp. MC now watches the drift (`env.t - t_recv`) of every LIVE status and time_req, marks
a node whose drift stepped as clock-suspect, scores its facts at arrival, and asks the phone to re-sync with
`control{clock_resync}`. Every behaviour test below has a control: a node that did not step.
"""
import pathlib
import random
import tempfile

from test_mc_resume import _persisting_live, _restart
from test_mc_result import go_live as _go_live

from brx_mcp.mc.clockwatch import ClockWatch
from brx_mcp.mc.types import CLOCK_RESYNC_MIN_GAP_MS, CLOCK_STEP_MS

NODE = "node0"


def go_live(*a, **kw):
    """`go_live` from the result tests, with MC's monotonic clock following the fake wall clock (F474 polish 2:
    MC reads wall minus monotonic to see its OWN clock step, and the real monotonic clock does not follow a fake one)."""
    s, net, clock, ps, info = _go_live(*a, **kw)
    _wire_mono(s, clock)
    return s, net, clock, ps, info


def _wire_mono(s, clock, off=None):
    off = off if off is not None else {"v": 0}
    s.mono_ms = lambda: (clock["t"] if isinstance(clock, dict) else clock.t) - off["v"]
    s._mono_off = off


def _resyncs(net, nid=NODE):
    return [b for n, k, b in net.pushed if n == nid and k == "control" and b.get("cmd") == "clock_resync"]


def _sample(s, net, clock, step_ms, dt_ms=2000, kind="status", jitter=0):
    """The phone sends one live message `dt_ms` after the last. Its clock reads `step_ms` ahead of MC's."""
    clock["t"] += dt_ms
    t_recv = clock["t"]
    t = t_recv + step_ms + jitter
    if kind == "status":
        net.simulate_status(NODE, {"arm_state": "live", "synced": True, "alive": True, "pending": 0,
                                   "match_id": s.start_info["match_id"]}, t_recv, t=t)
    else:
        net.simulate_time_req(NODE, t, t_recv)


def _burst(net, clock, step_ms=0, nid=NODE):
    """The phone's burst of five time_req, back to back, then the time MC gives the replies to land."""
    for _ in range(5):
        net.simulate_time_req(nid, clock["t"] + step_ms, clock["t"])
        clock["t"] += 20
    clock["t"] += 1200


def _baseline(s, net, clock, n=5):
    _burst(net, clock)
    for i in range(n):
        _sample(s, net, clock, 0, kind="time_req" if i % 2 else "status")


def _death_at(net, clock, ps, info, t, seq):
    """node0 dies to node1's shot; the fact carries the phone's own time `t`."""
    net.simulate_event(NODE, {"type": "death", "t": t, "match_id": info["match_id"], "player_id": ps[0]["player_id"],
                              "shooter_num": ps[1]["player_num"], "shooter_team": 1}, clock["t"], seq=seq)


def _kill_times(s):
    return [k["t"] for k in s.scorer.kills]


def test_a_forward_step_marks_the_node_suspect_after_two_samples_and_asks_for_one_resync():
    s, net, clock, ps, info = go_live(2, "ffa")
    _baseline(s, net, clock)
    assert not s.clock_watch.suspect(NODE) and _resyncs(net) == [], "control: a steady phone is trusted"
    _sample(s, net, clock, 60_000)
    assert not s.clock_watch.suspect(NODE), "one shifted sample is not a step"
    first = clock["t"]
    _sample(s, net, clock, 60_000)
    assert s.clock_watch.suspect(NODE)
    assert s.clock_watch.windows[NODE][-1]["since"] == first, "suspect from the FIRST shifted sample"
    for _ in range(3):
        _sample(s, net, clock, 60_000)          # still inside the 10 s rate limit
    assert len(_resyncs(net)) == 1, "exactly one clock_resync inside the rate-limit gap"
    assert _resyncs(net) == [{"cmd": "clock_resync"}]
    # a phone that ignores it is asked again, but never more than once per gap
    _sample(s, net, clock, 60_000, dt_ms=CLOCK_RESYNC_MIN_GAP_MS)
    assert len(_resyncs(net)) == 2


def test_a_backward_step_is_a_step_too():
    s, net, clock, ps, info = go_live(2, "ffa")
    _baseline(s, net, clock)
    _sample(s, net, clock, -60_000)
    _sample(s, net, clock, -60_000)
    assert s.clock_watch.suspect(NODE) and len(_resyncs(net)) == 1
    assert s.clock_watch.windows[NODE][-1]["shift"] < -CLOCK_STEP_MS


def test_a_suspect_node_s_facts_are_scored_at_arrival_and_a_steady_node_s_at_its_own_time():
    s, net, clock, ps, info = go_live(2, "ffa")
    _baseline(s, net, clock)
    clock["t"] += 500
    own = clock["t"] - 400                       # control: a steady phone's own time (a little before arrival)
    _death_at(net, clock, ps, info, own, seq=1)
    assert _kill_times(s) == [own], _kill_times(s)
    for _ in range(2):
        _sample(s, net, clock, 60_000)
    clock["t"] += 500
    _death_at(net, clock, ps, info, clock["t"] + 60_000, seq=2)
    assert _kill_times(s)[-1] == clock["t"], "scored at t_recv, not at the stepped time"
    # the replay of the stored facts (a restart, a late fact) scores the same times in the same order
    sc = s._replay(s.scorer, s._match_facts(info["match_id"]))
    assert [(k["killer"], k["victim"], k["t"]) for k in sc.kills] == \
        [(k["killer"], k["victim"], k["t"]) for k in s.scorer.kills]


def test_one_late_status_and_a_queued_burst_are_not_a_step():
    s, net, clock, ps, info = go_live(2, "ffa")
    _baseline(s, net, clock)
    _sample(s, net, clock, -9_000)               # one delayed message: its drift is far more negative
    _sample(s, net, clock, 0)
    assert not s.clock_watch.suspect(NODE) and _resyncs(net) == []
    # a backhaul queue flushed at once: many statuses stamped seconds apart, all received in the same instant
    t_recv = clock["t"] + 1000
    for k in range(6):
        net.simulate_status(NODE, {"arm_state": "live", "synced": True, "alive": True, "pending": 0},
                            t_recv, t=t_recv - 30_000 + k * 2000)
    assert not s.clock_watch.suspect(NODE) and _resyncs(net) == []
    clock["t"] = t_recv
    _sample(s, net, clock, 0)
    assert not s.clock_watch.suspect(NODE), "the next live message is on the old level again"


def test_jitter_of_400_ms_is_not_a_step():
    s, net, clock, ps, info = go_live(2, "ffa")
    rng = random.Random(474)
    for _ in range(60):
        _sample(s, net, clock, 0, jitter=rng.randint(-400, 400))
    assert not s.clock_watch.suspect(NODE) and _resyncs(net) == []


def test_after_the_phone_re_syncs_the_node_clears_and_its_own_time_is_trusted_again():
    s, net, clock, ps, info = go_live(2, "ffa")
    _baseline(s, net, clock)
    for _ in range(2):
        _sample(s, net, clock, 60_000)
    assert s.clock_watch.suspect(NODE)
    _sample(s, net, clock, 0)                    # the phone's re-sync lands: back on MC's clock
    assert s.clock_watch.suspect(NODE), "one sample back is not enough to clear"
    _sample(s, net, clock, 0)
    assert not s.clock_watch.suspect(NODE)
    w = s.clock_watch.windows[NODE][-1]
    assert w["until"] is not None and w["until"] > w["since"]
    clock["t"] += 500
    own = clock["t"] - 300
    _death_at(net, clock, ps, info, own, seq=3)
    assert _kill_times(s)[-1] == own, "trusted again after the clear"
    # a fact stamped inside the stepped window, flushed after the clear, still reads as stepped
    stepped_t = w["since"] + 1000 + w["shift"]
    assert s.clock_watch.stepped(NODE, stepped_t, clock["t"])
    assert not s.clock_watch.stepped(NODE, own, clock["t"])
    # and a phone that never re-syncs stays suspect
    s2, net2, clock2, ps2, info2 = go_live(2, "ffa")
    _baseline(s2, net2, clock2)
    for _ in range(12):
        _sample(s2, net2, clock2, 60_000)
    assert s2.clock_watch.suspect(NODE)


def test_the_suspect_state_survives_a_restart():
    s, net, clock, ps, info = _persisting_live()
    _wire_mono(s, clock)
    _baseline(s, net, clock)
    for _ in range(2):
        _sample(s, net, clock, 60_000)
    assert s.clock_watch.suspect(NODE)
    since = s.clock_watch.windows[NODE][-1]["since"]
    clock["t"] += 3000
    s2, net2 = _restart(s, clock)
    _wire_mono(s2, clock)
    assert s2.resume_match() == "live"
    assert s2.clock_watch.suspect(NODE) and s2.clock_watch.windows[NODE][-1]["since"] == since
    # the restarted MC scores the node's next fact at arrival as well
    from brx_mcp.mc.fakes import demo_armory
    for i in range(2):
        net2.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{demo_armory()[i]['ble']['tail']}")
    clock["t"] += 500
    s2.net.simulate_event(NODE, {"type": "death", "t": clock["t"] + 60_000, "match_id": info["match_id"],
                                 "player_id": ps[0]["player_id"], "shooter_num": ps[1]["player_num"],
                                 "shooter_team": 1}, clock["t"], seq=9)
    assert _kill_times(s2)[-1] == clock["t"]


def test_the_watch_alone_judges_a_window_by_arrival_and_by_stepped_time():
    w = ClockWatch()
    for k in range(5):
        assert w.sample("n", 0, 1000 * k) == []
    assert w.sample("n", 60_000, 10_000) == []
    assert w.sample("n", 60_000, 12_000) == ["suspect"]
    assert w.stepped("n", 0, 11_000) and w.stepped("n", 0, 99_000), "an open window covers every later arrival"
    assert not w.stepped("n", 5_000, 9_000), "before the first shifted sample"
    assert w.sample("n", 0, 14_000) == [] and w.sample("n", 0, 16_000) == ["cleared"]
    assert w.stepped("n", 0, 13_000) and not w.stepped("n", 0, 17_000)
    snap = w.to_snapshot()
    w2 = ClockWatch()
    w2.restore(snap)
    assert w2.windows == w.windows
    w2.restore({"x": [{"since": "bad"}], 5: 1})
    assert "x" not in w2.windows


def _pu_burst(s, clock, nid="phone-0"):
    for _ in range(5):
        s.net.simulate_time_req(nid, clock.t, clock.t)
        clock.t += 20
    clock.t += 1200


def _pu_phone_samples(s, clock, step_ms, n=3, nid="phone-0"):
    """Live statuses from a powerup-test phone: one every 2 s, its clock `step_ms` ahead of MC's."""
    for _ in range(n):
        clock.t += 2_000
        s.net.simulate_status(nid, {"arm_state": "live", "synced": True, "alive": True, "pending": 0,
                                    "match_id": s.start_info["match_id"]}, clock.t, t=clock.t + step_ms)


def test_a_stepped_phone_takes_a_powerup_once_and_in_the_spawn_it_was_at():
    """F474 on the F473 path: a pickup fact names its spawn from its own time plus `next_spawn_in_s`. A phone whose
    clock stepped back by a spawn interval names the spawn BEFORE: the take was booked there (a TOOK line for a
    spawn nobody took) and the item that was really taken stayed on the shelf."""
    from test_mc_powerups import _feed, _live, _pickup, _sess, _station
    for step in (-60_000, 60_000):
        s, clock = _sess()
        _wire_mono(s, clock)
        _station(s, "u1", 5, "overshield")
        go = _live(s, clock)
        clock.t = go + 70_000
        s.tick()
        _pu_burst(s, clock)
        _pu_phone_samples(s, clock, 0, n=5)          # the phone is steady: spawn 1 (go+60 s) is still on the shelf
        _pu_phone_samples(s, clock, step_ms=step, n=3)
        assert s.clock_watch.suspect("phone-0") == True
        clock.t = go + 121_000
        s.tick()                                      # spawn 2 is on the shelf; nobody took spawn 1
        _pickup(s, clock, 5, seq=1, t=clock.t + step, next_spawn_in_s=59)
        took = [line for line in _feed(s) if "TOOK" in line]
        assert len(took) == 1, (step, took)
        assert s._station_view("u1")["item_available"] is False, f"step {step}: the take hit the wrong spawn"
        _pickup(s, clock, 5, seq=2, t=clock.t + step, next_spawn_in_s=59)
        assert len([line for line in _feed(s) if "TOOK" in line]) == 1, "a second report books nothing"


def test_a_steady_phone_takes_a_powerup_as_before():
    from test_mc_powerups import _feed, _live, _pickup, _sess, _station
    s, clock = _sess()
    _wire_mono(s, clock)
    _station(s, "u1", 5, "overshield")
    go = _live(s, clock)
    clock.t = go + 70_000
    s.tick()
    _pu_burst(s, clock)
    _pu_phone_samples(s, clock, 0, n=8)
    assert not s.clock_watch.suspect("phone-0")
    clock.t = go + 121_000
    s.tick()
    _pickup(s, clock, 5, seq=1, next_spawn_in_s=59)
    assert len([line for line in _feed(s) if "TOOK" in line]) == 1
    assert s._station_view("u1")["item_available"] is False


# --------------------------------------------------------------------------- polish round 1
def test_a_phone_that_joins_with_a_stale_offset_and_then_re_syncs_is_never_suspect():
    """The connect burst of a phone with a SAVED offset (another MC host, an old session) is all at the stale level.
    That is not a baseline: the correct sync that follows used to look like a step and the node stayed suspect."""
    s, net, clock, ps, info = go_live(2, "ffa")
    net.simulate_hello(NODE, f"GUN-A-{__import__('brx_mcp.mc.fakes', fromlist=['x']).demo_armory()[0]['ble']['tail']}")
    _sample(s, net, clock, 20_000, dt_ms=50)       # the heartbeat that leaves with the hello
    _burst(net, clock, step_ms=20_000)             # the connect burst, stamped with the stale 20 s offset
    for _ in range(8):
        _sample(s, net, clock, 0)                  # the burst's replies landed: the phone is on MC's clock
    assert not s.clock_watch.suspect(NODE) and not s.clock_watch.windows.get(NODE)
    assert _resyncs(net) == []


def test_a_node_with_a_stale_baseline_clears_on_a_fresh_burst_and_the_pushes_stop():
    s, net, clock, ps, info = go_live(2, "ffa")
    _baseline(s, net, clock)
    s.clock_watch._node(NODE).base = [20_000] * 5       # a baseline taken at a stale level (a restore, a timed-out gate)
    for _ in range(3):
        _sample(s, net, clock, 0)
    assert s.clock_watch.suspect(NODE), "the right level looks like a step against a stale baseline"
    assert len(_resyncs(net)) == 1
    _burst(net, clock)                                   # it answers the push with a burst
    for _ in range(4):
        _sample(s, net, clock, 0)
    assert not s.clock_watch.suspect(NODE), "two samples after the burst, 2 s apart, are its new level"
    n = len(_resyncs(net))
    for _ in range(20):
        _sample(s, net, clock, 0, dt_ms=1000)
    assert len(_resyncs(net)) == n and not s.clock_watch.suspect(NODE), "no more pushes"
    # CONTROL: a phone that ignores the push (no burst) stays suspect and is asked again
    s2, net2, clock2, ps2, info2 = go_live(2, "ffa")
    _baseline(s2, net2, clock2)
    for _ in range(8):
        _sample(s2, net2, clock2, 60_000, dt_ms=2000)
    assert s2.clock_watch.suspect(NODE) and len(_resyncs(net2)) >= 1


def test_a_kill_in_the_confirmation_gap_is_re_scored_to_match_the_replay():
    s, net, clock, ps, info = go_live(2, "ffa")
    _baseline(s, net, clock)
    _sample(s, net, clock, 60_000)                       # the first shifted sample: not confirmed yet
    assert not s.clock_watch.suspect(NODE) and s.clock_watch.pending(NODE)
    clock["t"] += 500
    arrival = clock["t"]
    _death_at(net, clock, ps, info, arrival + 60_000, seq=1)
    assert _kill_times(s) == [arrival + 60_000], "the live board takes it at its own time until the step is confirmed"
    _sample(s, net, clock, 60_000)                       # confirmed: the board is re-derived
    assert s.clock_watch.suspect(NODE)
    assert _kill_times(s) == [arrival], _kill_times(s)
    sc = s._replay(s.scorer, s._match_facts(info["match_id"]))
    assert [k["t"] for k in sc.kills] == _kill_times(s), "the live board and a replay agree"


def test_a_pickup_in_the_confirmation_gap_books_the_right_spawn():
    from test_mc_powerups import _feed, _live, _pickup, _sess, _station
    for step in (-60_000, 60_000):
        s, clock = _sess()
        _wire_mono(s, clock)
        _station(s, "u1", 5, "overshield")
        go = _live(s, clock)
        clock.t = go + 70_000
        s.tick()
        _pu_burst(s, clock)
        _pu_phone_samples(s, clock, 0, n=5)
        _pu_phone_samples(s, clock, step, n=1)
        assert not s.clock_watch.suspect("phone-0") and s.clock_watch.pending("phone-0")
        clock.t = go + 121_000
        s.tick()
        _pickup(s, clock, 5, seq=1, t=clock.t + step, next_spawn_in_s=59)
        assert len([line for line in _feed(s) if "TOOK" in line]) == 1, (step, _feed(s))
        assert s._station_view("u1")["item_available"] is False, f"step {step}: the gap take hit the wrong spawn"


def test_an_offline_fact_from_before_the_step_keeps_its_own_time_after_the_clear():
    w = ClockWatch()
    for k in range(5):
        w.sample("n", 0, 1000 * k)
    since = 10_000
    assert w.sample("n", -60_000, since) == []
    assert w.sample("n", -60_000, since + 2_000) == ["suspect"]
    for k in range(1, 40):
        w.sample("n", -60_000, since + 2_000 + 2_000 * k)         # the step lasts about 80 s
    t0 = since + 2_000 + 2_000 * 40
    assert w.sample("n", 0, t0) == [] and w.sample("n", 0, t0 + 2_000) == ["cleared"]
    until = w.windows["n"][-1]["until"]
    pre_step = since - 5_000                                      # stamped before the step, flushed after the clear
    assert w.stepped("n", pre_step, until + 5_000) is False, "genuine pre-step time keeps its own t"
    w2 = ClockWatch()
    for k in range(5):
        w2.sample("n", 0, 1000 * k)
    w2.sample("n", 60_000, since)
    assert w2.sample("n", 60_000, since + 2_000) == ["suspect"]
    w2.sample("n", 0, since + 10_000)
    assert w2.sample("n", 0, since + 12_000) == ["cleared"]
    inside = since + 5_000 + 60_000                               # stamped during the window (stepped copy), flushed late
    assert w2.stepped("n", inside, since + 20_000) is True


def _all_status(net, clock, n, step_by_node=None):
    """One heartbeat from each of `n` nodes, node `i` stamped `step_by_node[i]` ms ahead of MC."""
    for i in range(n):
        step = (step_by_node or {}).get(i, 0)
        net.simulate_status(f"node{i}", {"arm_state": "live", "synced": True}, clock["t"], t=clock["t"] + step)


def test_an_mc_wall_clock_step_re_baselines_every_node_and_suspects_nobody():
    s, net, clock, ps, info = go_live(3, "ffa")
    for i in range(3):
        _burst(net, clock, nid=f"node{i}")
    for _ in range(5):
        clock["t"] += 2000
        _all_status(net, clock, 3)
    # MC's wall clock steps 20 s forward while its monotonic clock does not: every phone's drift falls by 20 s at once
    clock["t"] += 20_000
    s._mono_off["v"] += 20_000
    for _ in range(6):
        clock["t"] += 2000
        _all_status(net, clock, 3, step_by_node={0: -20_000, 1: -20_000, 2: -20_000})   # the phones' own clocks did not move
    for i in range(3):
        assert not s.clock_watch.suspect(f"node{i}") and not s.clock_watch.windows.get(f"node{i}")
        assert _resyncs(net, f"node{i}") == []
    # CONTROL: one phone stepping alone is still caught after the MC step
    for k in range(6):
        clock["t"] += 2000
        _all_status(net, clock, 3, step_by_node={0: 40_000, 1: -20_000, 2: -20_000})
    assert s.clock_watch.suspect("node0") and not s.clock_watch.suspect("node1")


def test_two_phones_stepping_together_are_both_suspected():
    s, net, clock, ps, info = go_live(3, "ffa")
    for i in range(3):
        _burst(net, clock, nid=f"node{i}")
    for _ in range(5):
        clock["t"] += 2000
        _all_status(net, clock, 3)
    for _ in range(4):
        clock["t"] += 2000
        _all_status(net, clock, 3, step_by_node={0: 60_000, 1: 60_000})
    assert s.clock_watch.suspect("node0") and s.clock_watch.suspect("node1") and not s.clock_watch.suspect("node2")
    assert len(_resyncs(net, "node0")) == 1 and len(_resyncs(net, "node1")) == 1


def test_one_phone_stepping_in_a_two_player_match_is_suspected():
    s, net, clock, ps, info = go_live(2, "ffa")
    for i in range(2):
        _burst(net, clock, nid=f"node{i}")
    for _ in range(5):
        clock["t"] += 2000
        _all_status(net, clock, 2)
    for _ in range(4):
        clock["t"] += 2000
        _all_status(net, clock, 2, step_by_node={1: -60_000})
    assert s.clock_watch.suspect("node1") and not s.clock_watch.suspect("node0")


def test_a_resync_burst_whose_replies_never_land_does_not_clear_at_the_stepped_level():
    s, net, clock, ps, info = go_live(2, "ffa")
    _baseline(s, net, clock)
    for _ in range(3):
        _sample(s, net, clock, 60_000)
    assert s.clock_watch.suspect(NODE) and len(_resyncs(net)) == 1
    _burst(net, clock, step_ms=60_000)               # it sends the burst, but no time_res lands: still on the stepped offset
    for _ in range(20):
        _sample(s, net, clock, 60_000)
    assert s.clock_watch.suspect(NODE), "a stable stepped level is not a clear"
    _burst(net, clock, step_ms=0)                    # CONTROL: replies that land put it back near MC time
    for _ in range(4):
        _sample(s, net, clock, 0)
    assert not s.clock_watch.suspect(NODE)


def test_the_real_netserver_marks_a_bind_so_a_relink_does_not_blind_the_clock_watch():
    from brx_mcp.mc.net import NetServer, NodeRecord
    net = NetServer()
    net._loop = object()
    seen = []
    net.on_node(lambda info: seen.append(info))
    net._on_bind(NodeRecord(node_id="n1", node_type="phone", app_ver="x"), {})
    assert seen and seen[-1].get("bind") is True, seen
    net._fire_node(NodeRecord(node_id="n1", node_type="phone", app_ver="x"))
    assert not seen[-1].get("bind"), "CONTROL: a hello is not a bind"


def _fact(net, clock, ps, info, kind, node, victim_i, killer_i, t, seq, **extra):
    net.simulate_event(node, {"type": kind, "t": t, "match_id": info["match_id"], "player_id": ps[victim_i]["player_id"],
                              "shooter_num": ps[killer_i]["player_num"], "shooter_team": 1, **extra}, clock["t"], seq=seq)


def _tdm_gap_session(frag=3):
    """4 players (0 and 2 red, 1 and 3 blue), cap `frag`. node3 is the one whose clock steps."""
    s, net, clock, ps, info = go_live(4, "tdm", {"scoring": {"frag_limit": frag, "win_by": "kills"}})
    for i in range(4):
        _burst(net, clock, nid=f"node{i}")
    for _ in range(4):
        clock["t"] += 2000
        _all_status(net, clock, 4)
    return s, net, clock, ps, info


def _gap_open(net, clock, nid, step=60_000):
    clock["t"] += 500
    net.simulate_status(nid, {"arm_state": "live", "synced": True}, clock["t"], t=clock["t"] + step)
    clock["t"] += 500


def _confirm(net, clock, nid, step=60_000):
    for _ in range(2):
        clock["t"] += 2000
        net.simulate_status(nid, {"arm_state": "live", "synced": True}, clock["t"], t=clock["t"] + step)


def test_a_transient_cap_in_the_rescore_leaves_a_later_real_cap_able_to_end_the_match():
    s, net, clock, ps, info = _tdm_gap_session(frag=3)
    t0 = clock["t"]
    _fact(net, clock, ps, info, "death", "node1", 1, 0, t0 - 300, 1)         # red +1
    _fact(net, clock, ps, info, "death", "node1", 1, 0, t0 - 200, 2)         # red +1
    _fact(net, clock, ps, info, "death", "node2", 2, 0, t0 + 5_000, 3)       # a team kill stamped later: red -1
    _gap_open(net, clock, "node3")
    _fact(net, clock, ps, info, "death", "node3", 3, 0, clock["t"] + 60_000, 4)   # red +1, at the stepped time
    assert s.phase == "live" and s.scorer.team_scores()["red"] == 2
    _confirm(net, clock, "node3")     # re-scored: in `t` order the board passes 3 for a moment, then the team kill
    assert s.clock_watch.suspect("node3")
    assert s.phase == "live", "the transient cap is not a whistle"
    _fact(net, clock, ps, info, "death", "node1", 1, 0, clock["t"], 5)       # a real third kill
    assert s.phase != "live", "a later real cap still ends the match"


def test_a_rescore_that_genuinely_reaches_the_cap_ends_the_match():
    s, net, clock, ps, info = _tdm_gap_session(frag=3)
    t0 = clock["t"]
    _fact(net, clock, ps, info, "death", "node1", 1, 0, t0 - 300, 1)
    _gap_open(net, clock, "node3")
    _fact(net, clock, ps, info, "death", "node3", 3, 0, clock["t"] + 60_000, 2)
    assert s.phase == "live" and s.scorer.team_scores()["red"] == 2
    # a stored fact the live scorer never took (a flush lost on the way): the replay finds the cap reached
    s.store.log("node1", "death", 77, clock["t"] - 100, clock["t"] - 100, info["match_id"], False,
                {"type": "death", "t": clock["t"] - 100, "match_id": info["match_id"], "player_id": ps[1]["player_id"],
                 "shooter_num": ps[0]["player_num"], "shooter_team": 1, "seq": 77})
    _confirm(net, clock, "node3")
    assert s.phase != "live", "the re-scored board reached the cap, so the match ends as it would live"


def test_no_lead_alert_fires_again_after_a_rebuild():
    from brx_mcp.mc.types import FEEDBACK_MAX_AGE_MS
    s, net, clock, ps, info = go_live(2, "ffa", {"scoring": {"frag_limit": 50, "win_by": "kills"}})
    alerts = []
    s._alert = lambda kind, scope, extra=None: alerts.append((kind, scope))   # every scorer MC builds calls this
    s.scorer.on_alert = s._alert
    for i in range(2):
        _burst(net, clock, nid=f"node{i}")
    _fact(net, clock, ps, info, "death", "node1", 1, 0, clock["t"], 1)       # player 0 takes the lead, once
    assert [a for a in alerts if a[0] == "lead_taken"] == [("lead_taken", ps[0]["player_id"])]
    clock["t"] += FEEDBACK_MAX_AGE_MS + 5_000                                  # the replay skips alerts for a fact this old
    for _ in range(4):
        clock["t"] += 2000
        _all_status(net, clock, 2)
    _gap_open(net, clock, "node1")
    _fact(net, clock, ps, info, "hit_taken", "node1", 1, 0, clock["t"] + 60_000, 2, dmg=9)   # a scoring fact in the gap
    _confirm(net, clock, "node1")
    assert s.clock_watch.suspect("node1")
    alerts.clear()
    _fact(net, clock, ps, info, "death", "node1", 1, 0, clock["t"], 3)       # the leader leads on: nothing to announce
    assert [a for a in alerts if a[0] in ("lead_taken", "lead_lost")] == [], alerts


def test_a_confirmation_with_no_scoring_fact_in_the_gap_does_not_rebuild_the_scorer():
    s, net, clock, ps, info = go_live(2, "ffa")
    _baseline(s, net, clock)
    before = s.scorer
    for _ in range(2):
        _sample(s, net, clock, 60_000)
    assert s.clock_watch.suspect(NODE) and s.scorer is before, "nothing to re-date: the same scorer stays"


# --------------------------------------------------------------------------- polish round 3
def test_an_mc_step_back_leaves_a_suspect_node_suspect_and_able_to_clear():
    s, net, clock, ps, info = go_live(2, "ffa")
    _baseline(s, net, clock)
    for _ in range(2):
        _sample(s, net, clock, 60_000)
    assert s.clock_watch.suspect(NODE)
    clock["t"] -= 5_000                 # MC's wall clock steps back 5 s; its monotonic clock does not
    s._mono_off["v"] -= 5_000
    _sample(s, net, clock, 65_000, dt_ms=500)       # the phone's drift now reads 5 s more
    assert s.clock_watch.suspect(NODE)
    clock["t"] += 500
    _death_at(net, clock, ps, info, clock["t"] + 65_000, seq=1)
    assert _kill_times(s)[-1] == clock["t"], "still scored at arrival: the window moved with MC's clock"
    # the phone puts its clock right: in MC's new frame its drift is +5 s, which is its old level (0) moved by the step
    for _ in range(3):
        _sample(s, net, clock, 5_000)
    assert not s.clock_watch.suspect(NODE), "it can still clear against the moved reference"


def test_the_whistle_of_a_rescore_is_the_crossing_that_still_stands():
    s, net, clock, ps, info = _tdm_gap_session(frag=3)
    t0 = clock["t"]
    _fact(net, clock, ps, info, "death", "node1", 1, 0, t0 - 300, 1)         # red +1
    _fact(net, clock, ps, info, "death", "node1", 1, 0, t0 - 250, 2)         # red +1
    _fact(net, clock, ps, info, "death", "node2", 2, 0, t0 + 5_000, 3)       # a team kill: red -1
    _gap_open(net, clock, "node3")
    _fact(net, clock, ps, info, "death", "node3", 3, 0, clock["t"] + 60_000, 4)   # red +1 (re-dated to arrival)
    assert s.phase == "live" and s.scorer.team_scores()["red"] == 2
    last = t0 + 6_000
    s.store.log("node1", "death", 77, last, last, info["match_id"], False,       # red +1 again, after the team kill
                {"type": "death", "t": last, "match_id": info["match_id"], "player_id": ps[1]["player_id"],
                 "shooter_num": ps[0]["player_num"], "shooter_team": 1, "seq": 77})
    _confirm(net, clock, "node3")     # in `t` order: 3 (cap), 2 (team kill), 3 again at `last`
    assert s.phase != "live"
    assert s.scorer.end_t == last, (s.scorer.end_t, last)


def test_a_session_with_a_wall_clock_and_no_monotonic_one_sees_no_false_mc_step():
    s, net, clock, ps, info = _go_live(2, "ffa")          # not wired: the default monotonic clock
    assert s.mono_ms() == s.now_ms()
    _burst(net, clock)
    for _ in range(3):
        _sample(s, net, clock, 0)
    clock["t"] += 20_000                                  # a test jumps the wall clock
    assert s.clock_watch.note_clock(s.now_ms(), s.mono_ms()) is False


def _mock_after_trips(node, true_off, n, rtt_ms=20):
    """Feed `n` round trips to a MockNode: the server clock reads `true_off` ms ahead of the node's wall clock."""
    import time
    for _ in range(n):
        t_node = time.time() * 1000 - rtt_ms
        node._take_time_res({"t_node": t_node, "server_t": t_node + rtt_ms / 2 + true_off})


def test_f477_mock_reconnect_burst_snaps_a_step_made_while_offline():
    """F477, mirrored in the MockNode: clock.js `newBurst` on a synced clock snaps to the burst best when it differs
    from the held offset by more than CLOCK_STEP_MS, and averages it in (EWMA) when it does not."""
    from brx_mcp.mc.mock_node import MockNode
    node = MockNode("ws://example.invalid/ws", node_id="f477")
    _mock_after_trips(node, 100, 8)
    node._start_reconnect_burst()
    _mock_after_trips(node, 100 + 60_000, 5)
    assert abs(node.offset_ms - 60_100) < 5, node.offset_ms
    # control: a 1 s difference stays on the EWMA
    node2 = MockNode("ws://example.invalid/ws", node_id="f477b")
    _mock_after_trips(node2, 100, 8)
    node2._start_reconnect_burst()
    _mock_after_trips(node2, 1_100, 5)
    want = 100 + 1000 * (1 - 0.8 ** 5)
    assert abs(node2.offset_ms - want) < 5, node2.offset_ms

# --------------------------------------------------------------------------- follow-up: replay frame, short back-step window
def test_a_fact_scored_live_before_an_mc_step_is_replayed_the_same_after_it():
    s, net, clock, ps, info = go_live(2, "ffa")
    _baseline(s, net, clock)
    for _ in range(2):
        _sample(s, net, clock, 60_000)
    assert s.clock_watch.suspect(NODE)
    clock["t"] += 1_000
    arrival = clock["t"]
    _death_at(net, clock, ps, info, arrival + 60_000, seq=1)          # scored live at its arrival, inside the window
    assert _kill_times(s) == [arrival]
    # MC's wall clock steps 5 s forward: the window moves into the new frame, and the stored arrival does not
    clock["t"] += 5_000
    s._mono_off["v"] += 5_000
    _sample(s, net, clock, 55_000, dt_ms=500)
    assert s.clock_watch.suspect(NODE)
    sc = s._replay(s.scorer, s._match_facts(info["match_id"]))
    assert [k["t"] for k in sc.kills] == _kill_times(s), "the stored verdict, not the moved window, decides the replay"


def test_the_gap_rescore_stamps_its_verdict_so_a_later_replay_agrees():
    s, net, clock, ps, info = go_live(2, "ffa")
    _baseline(s, net, clock)
    _sample(s, net, clock, 60_000)
    clock["t"] += 500
    arrival = clock["t"]
    _death_at(net, clock, ps, info, arrival + 60_000, seq=1)          # in the confirmation gap
    _sample(s, net, clock, 60_000)                                    # confirmed: re-scored and stamped
    assert _kill_times(s) == [arrival]
    clock["t"] += 5_000
    s._mono_off["v"] += 5_000
    _sample(s, net, clock, 55_000, dt_ms=500)
    sc = s._replay(s.scorer, s._match_facts(info["match_id"]))
    assert [k["t"] for k in sc.kills] == [arrival]


def test_a_fact_queued_offline_through_a_short_backward_step_is_read_as_stepped_after_the_window():
    w = ClockWatch()
    for k in range(5):
        w.sample("n", 0, 1000 * k, seq_hi=10)
    since = 10_000
    w.sample("n", -60_000, since, seq_hi=10)
    assert w.sample("n", -60_000, since + 2_000, seq_hi=11) == ["suspect"]
    w.sample("n", 0, since + 30_000)
    assert w.sample("n", 0, since + 32_000) == ["cleared"]            # the window lasted 30 s: shorter than the 60 s step
    until = w.windows["n"][-1]["until"]
    queued = since + 10_000 - 60_000                                  # stamped in the window by the stepped clock
    assert w.stepped("n", queued, until + 5_000, seq=12) is True, "queued after the step began: its t is 60 s early"
    genuine = since - 45_000                                          # stamped before the step; the same time band
    assert w.stepped("n", genuine, until + 5_000, seq=8) is False, "CONTROL: it was sent before the window opened"
    assert w.stepped("n", genuine, until + 5_000) is False, "no seq: the older reading stands"


# --------------------------------------------------------------------------- follow-up polish round 1
def _short_back_step_watch(seq_at_first_shifted=9):
    """A node steps back 60 s for a 30 s window. `seq_at_first_shifted` is the highest seq MC had received just before
    the first shifted sample."""
    w = ClockWatch()
    for k in range(5):
        w.sample("n", 0, 1000 * k, seq_hi=7)
    since = 10_000
    w.sample("n", -60_000, since, seq_hi=seq_at_first_shifted)
    assert w.sample("n", -60_000, since + 2_000, seq_hi=seq_at_first_shifted + 1) == ["suspect"]
    w.sample("n", 0, since + 30_000)
    assert w.sample("n", 0, since + 32_000) == ["cleared"]
    return w, since, w.windows["n"][-1]["until"]


def test_an_offline_pre_step_fact_keeps_its_t_and_a_post_step_one_is_stepped():
    # fact 9 was made after the step and reached MC before the first shifted sample; fact 8 was made BEFORE the step
    # and is still queued; fact 10 was made after the step and is queued too.
    w, since, until = _short_back_step_watch(seq_at_first_shifted=9)
    in_band = since - 45_000
    assert w.stepped("n", in_band, until + 5_000, seq=8) is False, "below a seq MC had already received: older than the step"
    assert w.stepped("n", since + 5_000 - 60_000, until + 5_000, seq=10) is True, "above it: made after the step"


def test_the_seq_anchor_survives_an_mc_restart():
    w, since, until = _short_back_step_watch()
    w2 = ClockWatch()
    w2.restore(w.to_snapshot())
    assert w2.windows == w.windows
    assert w2.stepped("n", since - 45_000, until + 5_000, seq=8) is False
    assert w2.stepped("n", since + 5_000 - 60_000, until + 5_000, seq=10) is True


def test_a_seq_reset_inside_a_window_fails_safe():
    w, since, until = _short_back_step_watch()
    in_band = since - 45_000
    assert w.stepped("n", in_band, until + 5_000, seq=3) is False, "CONTROL: without a reset a low seq is an old fact"
    w.drop_seq("n")                   # the phone reset its storage: its seq counter starts again from 1
    assert w.stepped("n", in_band, until + 5_000, seq=3) is True, "a low seq no longer proves anything"
    assert w.stepped("n", in_band, until + 5_000) is True
    w2 = ClockWatch()
    w2.restore(w.to_snapshot())
    assert w2.stepped("n", in_band, until + 5_000, seq=3) is True, "the reset is saved with the window"


def test_a_failing_restamp_does_not_escape_the_status_handler():
    s, net, clock, ps, info = go_live(2, "ffa")
    _baseline(s, net, clock)
    _sample(s, net, clock, 60_000)
    clock["t"] += 500
    _death_at(net, clock, ps, info, clock["t"] + 60_000, seq=1)

    def boom(*a, **k):
        raise RuntimeError("disk full")
    s.store.restamp_many = s.store.restamp = boom
    _sample(s, net, clock, 60_000)                       # confirms: the rescore's stamps fail, nothing raises
    assert s.clock_watch.suspect(NODE)


def test_a_confirmation_saves_the_session_snapshot_with_the_window():
    s, net, clock, ps, info = _persisting_live()
    _wire_mono(s, clock)
    _baseline(s, net, clock)
    s._persist_last = 0.0
    saved = []
    real = s._persist
    s._persist = lambda: (saved.append(1), real())[1]
    _sample(s, net, clock, 60_000)
    n = len(saved)
    _sample(s, net, clock, 60_000)
    assert len(saved) > n, "the suspect edge persists the snapshot"
    import json
    assert json.loads(s._persist_path.read_text())["match"]["clock_suspect"][NODE]


def test_the_replay_order_reads_the_stored_verdict_not_a_recomputation():
    s, net, clock, ps, info = go_live(2, "ffa")
    _baseline(s, net, clock)
    for _ in range(2):
        _sample(s, net, clock, 60_000)
    clock["t"] += 1_000
    a = clock["t"]
    _death_at(net, clock, ps, info, a + 60_000, seq=1)                 # node0 dies: stepped, scored at arrival `a`
    clock["t"] += 500
    net.simulate_event("node1", {"type": "death", "t": clock["t"], "match_id": info["match_id"],
                                 "player_id": ps[1]["player_id"], "shooter_num": ps[0]["player_num"],
                                 "shooter_team": 1}, clock["t"], seq=2)   # node1 dies 500 ms later, steady clock
    live = [(k["killer"], k["victim"]) for k in s.scorer.kills]
    assert live[0][1] == ps[0]["player_id"] and live[1][1] == ps[1]["player_id"]
    clock["t"] += 5_000                                                # MC steps forward: the window moves past `a`
    s._mono_off["v"] += 5_000
    _sample(s, net, clock, 55_000, dt_ms=500)
    sc = s._replay(s.scorer, s._match_facts(info["match_id"]))
    assert [(k["killer"], k["victim"]) for k in sc.kills] == live, "node0's death still sorts first"


def test_a_hello_that_resets_the_seq_counter_reaches_the_clock_watch_once():
    from brx_mcp.mc.net import NetServer, NodeRecord
    net = NetServer()
    seen = []
    net.on_node(lambda info: seen.append(info))
    rec = NodeRecord(node_id="n1", node_type="phone", app_ver="x")
    rec.seq_reset = True
    net._fire_node(rec)
    net._fire_node(rec)
    assert seen[0].get("seq_reset") is True and not seen[1].get("seq_reset"), seen


# --------------------------------------------------------------------------- follow-up polish round 2
class _Capture:
    def __enter__(self):
        import logging
        self.lines = []
        outer = self

        class H(logging.Handler):
            def emit(self, record):
                outer.lines.append(record.getMessage())
        self.h, self.log = H(level=logging.DEBUG), logging.getLogger("brx.mc")
        self.old = self.log.level
        self.log.setLevel(logging.DEBUG)
        self.log.addHandler(self.h)
        return self

    def __exit__(self, *a):
        self.log.removeHandler(self.h)
        self.log.setLevel(self.old)


def test_the_watch_tells_an_ambiguous_late_flush_from_a_clean_stepped_fact():
    w, since, until = _short_back_step_watch(seq_at_first_shifted=9)
    assert w.verdict("n", since + 5_000, since + 5_000) == "stepped", "it arrived while the node was suspect"
    assert w.verdict("n", since + 5_000 - 60_000, until + 5_000, seq=10) == "ambiguous", "a late flush made after the anchor"
    assert w.verdict("n", since - 45_000, until + 5_000, seq=8) is None
    assert w.stepped("n", since + 5_000 - 60_000, until + 5_000, seq=10) is True


def _pu_stepped_window(s, clock, go):
    """phone-0 steps back 60 s for a short window, then is right again. MC had received seq 9 before the first shifted sample."""
    from types import SimpleNamespace
    s.net.nodes = {"phone-0": SimpleNamespace(seq_hi=9)}
    _pu_burst(s, clock)
    _pu_phone_samples(s, clock, 0, n=5)
    _pu_phone_samples(s, clock, -60_000, n=4)
    assert s.clock_watch.suspect("phone-0")
    _pu_phone_samples(s, clock, 0, n=3)
    assert not s.clock_watch.suspect("phone-0")


def test_an_ambiguous_offline_pickup_takes_nothing_and_the_station_report_still_records_the_take():
    from test_mc_powerups import _action, _feed, _live, _sess, _station
    s, clock = _sess()
    _wire_mono(s, clock)
    _station(s, "u1", 5, "overshield")
    go = _live(s, clock)
    clock.t = go + 70_000
    s.tick()
    _pu_stepped_window(s, clock, go)
    clock.t = go + 121_000
    s.tick()                                              # spawn 2 is on the shelf
    p = s.players[s.node_player["phone-0"]]
    ev = {"type": "pickup", "t": clock.t - 90_000, "match_id": s.start_info["match_id"], "node_id": "phone-0",
          "player_id": p["player_id"], "station_id": 5, "item_kind": "overshield", "seq": 11, "next_spawn_in_s": 59}
    with _Capture() as cap:
        s.ingest_batch("phone-0", [ev], clock.t)           # queued offline through the step, flushed late
    assert [x for x in _feed(s) if "TOOK" in x] == [], "an ambiguous fact books no take"
    assert s._station_view("u1")["item_available"] is True
    assert len([x for x in cap.lines if "ambiguous" in x]) == 1, cap.lines
    _action(s, clock, "u1", 5, "taken", player_num=p["player_num"])
    assert len([x for x in _feed(s) if "TOOK" in x]) == 1 and s._station_view("u1")["item_available"] is False


def test_an_ambiguous_pickup_stamped_ahead_of_arrival_is_judged_on_its_own_time_not_the_clamp():
    """Round 3 (Codex): a pickup queued during a FORWARD step carries a `t` ahead of its arrival. The take path clamps `t`
    to `t_recv`; the verdict must read the fact's own time first, or the clamp hides the stepped band."""
    from types import SimpleNamespace
    from test_mc_powerups import _feed, _live, _sess, _station
    s, clock = _sess()
    _wire_mono(s, clock)
    _station(s, "u1", 5, "overshield")
    go = _live(s, clock)
    clock.t = go + 70_000
    s.tick()
    s.net.nodes = {"phone-0": SimpleNamespace(seq_hi=9)}
    _pu_burst(s, clock)
    _pu_phone_samples(s, clock, 0, n=5)
    _pu_phone_samples(s, clock, 60_000, n=4)
    assert s.clock_watch.suspect("phone-0")
    _pu_phone_samples(s, clock, 0, n=3)
    assert not s.clock_watch.suspect("phone-0")
    clock.t = go + 121_000
    s.tick()
    p = s.players[s.node_player["phone-0"]]
    ev = {"type": "pickup", "t": clock.t + 30_000, "match_id": s.start_info["match_id"], "node_id": "phone-0",
          "player_id": p["player_id"], "station_id": 5, "item_kind": "overshield", "seq": 11, "next_spawn_in_s": 59}
    w = s.clock_watch.windows["phone-0"][-1]
    lo, hi = w["since"] + w["ref"] + w["shift"], w["until"] + w["ref"] + w["shift"]
    assert lo <= ev["t"] <= hi, ("control: the fact's own time is in the stepped band", lo, ev["t"], hi)
    assert s.clock_watch.verdict("phone-0", ev["t"], clock.t, 11) == "ambiguous", "control: on its own time it is ambiguous"
    s.ingest_batch("phone-0", [ev], clock.t)
    assert [x for x in _feed(s) if "TOOK" in x] == [], "the clamp to t_recv must not hide the ambiguous verdict"


def test_an_ambiguous_kill_is_still_scored_at_arrival_and_logged_once():
    s, net, clock, ps, info = go_live(2, "ffa")
    from types import SimpleNamespace
    net.nodes = {NODE: SimpleNamespace(seq_hi=9)}
    _baseline(s, net, clock)
    for _ in range(4):
        _sample(s, net, clock, -60_000)
    for _ in range(3):
        _sample(s, net, clock, 0)
    assert not s.clock_watch.suspect(NODE)
    w = s.clock_watch.windows[NODE][-1]
    clock["t"] += 500
    t = w["since"] + 5_000 - 60_000
    with _Capture() as cap:
        net.simulate_event(NODE, {"type": "death", "t": t, "match_id": info["match_id"], "player_id": ps[0]["player_id"],
                                  "shooter_num": ps[1]["player_num"], "shooter_team": 1, "seq": 11}, clock["t"])
    assert _kill_times(s)[-1] == clock["t"]
    assert len([x for x in cap.lines if "ambiguous" in x]) == 1, cap.lines


def test_a_fresh_process_hello_drops_a_restored_anchor():
    from brx_mcp.mc.net import NetServer, NodeRecord
    from brx_mcp.mc.compile import Compiler
    from brx_mcp.mc.fakes import FakeArmory, demo_armory
    from brx_mcp.mc.state import Session
    w, since, until = _short_back_step_watch()
    net = NetServer()
    s = Session(Compiler(), net, FakeArmory(demo_armory()))
    s.clock_watch.restore(w.to_snapshot())
    assert s.clock_watch.windows["n"][-1]["seq"] == 9
    seen = []
    net.on_node(lambda info: seen.append(info))
    rec = NodeRecord(node_id="n", node_type="phone", app_ver="x")      # this process has never heard of it: seq_hi is 0
    net._fire_node(rec)
    assert s.clock_watch.windows["n"][-1]["seq"] is None and s.clock_watch.windows["n"][-1].get("reset") is True
    # CONTROL: a node this process has already heard facts from keeps its anchor
    s.clock_watch.restore(w.to_snapshot())
    heard = NodeRecord(node_id="n", node_type="phone", app_ver="x")
    heard.seq_hi = 12
    net._fire_node(heard)
    assert s.clock_watch.windows["n"][-1]["seq"] == 9


def test_a_hello_with_a_seq_next_below_seq_hi_drops_the_anchor_end_to_end():
    from _skip import Skipped
    try:
        import websockets  # noqa: F401
    except ImportError:
        raise Skipped("websockets")
    import asyncio
    from test_mc_net import _Harness, _run, _until
    from brx_mcp.mc.compile import Compiler
    from brx_mcp.mc.fakes import FakeArmory, demo_armory
    from brx_mcp.mc.mock_node import MockNode
    from brx_mcp.mc.state import Session

    async def go():
        async with _Harness() as h:
            s = Session(Compiler(), h.net, FakeArmory(demo_armory()))
            w, since, until = _short_back_step_watch()
            s.clock_watch.restore({"n1": w.to_snapshot()["n"]})
            node = MockNode(h.url, node_id="n1", gun_name="GUN-A", gun_tail="3D4F", heartbeat_ms=100)
            await node.start()
            await node.wait_connected()
            for _ in range(3):
                node.emit({"type": "respawn", "match_id": "m"})
            assert await _until(lambda: h.net.nodes["n1"].seq_hi >= 3)
            s.clock_watch.restore({"n1": w.to_snapshot()["n"]})            # the anchor is back after the first hello
            await node.disconnect()
            node.seq_next = 1                                              # storage reset: the counter starts over
            node.reconnect()
            assert await _until(lambda: (s.clock_watch.windows["n1"][-1].get("reset") is True))
            await node.close()
    _run(go())
