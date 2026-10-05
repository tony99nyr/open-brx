"""F474: a phone whose wall clock steps AFTER its clock sync stamps every later fact off by the step, and MC
used to trust that stamp. MC now watches the drift (`env.t - t_recv`) of every LIVE status and time_req, marks
a node whose drift stepped as clock-suspect, scores its facts at arrival, and asks the phone to re-sync with
`control{clock_resync}`. Every behaviour test below has a control: a node that did not step.
"""
import pathlib
import random
import tempfile

from test_mc_resume import _persisting_live, _restart
from test_mc_result import go_live

from brx_mcp.mc.clockwatch import ClockWatch
from brx_mcp.mc.types import CLOCK_RESYNC_MIN_GAP_MS, CLOCK_STEP_MS

NODE = "node0"


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
    _baseline(s, net, clock)
    for _ in range(2):
        _sample(s, net, clock, 60_000)
    assert s.clock_watch.suspect(NODE)
    since = s.clock_watch.windows[NODE][-1]["since"]
    clock["t"] += 3000
    s2, net2 = _restart(s, clock)
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


def test_an_mc_clock_step_suspects_nobody_and_pushes_no_resync():
    s, net, clock, ps, info = go_live(3, "ffa")
    for i in range(3):
        _burst(net, clock, nid=f"node{i}")
    for _ in range(5):
        clock["t"] += 2000
        for i in range(3):
            net.simulate_status(f"node{i}", {"arm_state": "live", "synced": True}, clock["t"], t=clock["t"])
    # MC's wall clock steps forward by 20 s: every phone's drift falls by 20 s at once
    for _ in range(6):
        clock["t"] += 2000
        for i in range(3):
            net.simulate_status(f"node{i}", {"arm_state": "live", "synced": True}, clock["t"] + 20_000, t=clock["t"])
    for i in range(3):
        assert not s.clock_watch.suspect(f"node{i}") and not s.clock_watch.windows.get(f"node{i}")
        assert _resyncs(net, f"node{i}") == []
    # CONTROL: one phone alone shifting by the same amount IS a step
    s2, net2, clock2, ps2, info2 = go_live(3, "ffa")
    for i in range(3):
        _burst(net2, clock2, nid=f"node{i}")
    for k in range(8):
        clock2["t"] += 2000
        for i in range(3):
            net2.simulate_status(f"node{i}", {"arm_state": "live", "synced": True}, clock2["t"],
                                 t=clock2["t"] + (-20_000 if i == 0 and k >= 4 else 0))
    assert s2.clock_watch.suspect("node0") and not s2.clock_watch.suspect("node1")
