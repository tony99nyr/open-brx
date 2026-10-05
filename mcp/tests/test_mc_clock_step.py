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


def _baseline(s, net, clock, n=5):
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
    # the replay of the stored facts (a restart, a late fact) reads the same time
    sc = s._replay_scorer(info["match_id"], info["go_live_t"], {}) if hasattr(s, "_replay_scorer") else None
    assert sc is None or sorted(k["t"] for k in sc.kills) == sorted(_kill_times(s))


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
    _pu_phone_samples(s, clock, 0, n=8)
    assert not s.clock_watch.suspect("phone-0")
    clock.t = go + 121_000
    s.tick()
    _pickup(s, clock, 5, seq=1, next_spawn_in_s=59)
    assert len([line for line in _feed(s) if "TOOK" in line]) == 1
    assert s._station_view("u1")["item_available"] is False
