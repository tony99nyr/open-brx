"""Behavioural tests for the connect-metrics bench run (brx_mcp/connmetrics/runner.py, docs/
FOLLOWUPS.md F297), no BLE hardware.

`FakeMgr` mimics the one contract `run_connect_metrics` actually depends on (`ble.py
ConnectionManager`): `scan`/`connect`/`disconnect`/`send`/`get_events`/`is_connected`, plus a
`sessions` dict of objects carrying `.seq`/`.buffer`/`.log_file`/`.log_label` -- the same seam
`brx_mcp/soak/runner.py`'s own `test_soak_runner.py` already uses for its FakeMgr.

`FakeClock` mimics `soak.runner.Clock` but advances a counter instead of sleeping for real, so a
30 s hold window takes milliseconds of real test time (CLAUDE.md: "a mocked clock, not sleeps").
"""

import asyncio

from _async import run

from brx_mcp.connmetrics.runner import (
    ConnectAttempt, ConnectRun, run_connect_metrics, summarize,
)


class FakeSession:
    def __init__(self):
        self.seq = 0
        self.buffer: list[dict] = []
        self.log_file = None
        self.log_label = None


class FakeClock:
    """Advances instantly: `sleep(s)` moves the virtual clock forward by `s` and yields once to
    the event loop, instead of actually waiting."""

    def __init__(self):
        self.t = 0.0

    def now(self) -> float:
        return self.t

    async def sleep(self, seconds: float) -> None:
        self.t += max(0.0, seconds)
        await asyncio.sleep(0)


class FakeMgr:
    """A minimal stand-in for `ConnectionManager`. Scriptable knobs:

    `always_advertises`: False makes `scan()` never report the address (drives an advert timeout).
    `fail_attempts`: the next N `connect()` calls (across the whole run, consumed one per call)
                     raise instead of succeeding.
    `ping_ok`: False makes every `$PING,*` go unanswered.
    `version_ok`: False makes every `$VERSION,*` go unanswered (drives "no_reply" at link).
    `headset_schedule`: list of (clock time, "linked"|"not_linked") controlling what a `$VERSION`
                        reply's headset token says from that time on -- the LATEST entry whose time
                        has passed wins, so `[(0.0, "linked"), (12.0, "not_linked")]` answers
                        "linked" until t=12 and "not_linked" from then on.
    `drop_ble_at`: virtual time at which `is_connected()` starts returning False, once.
    """

    def __init__(self, clock: FakeClock):
        self.clock = clock
        self.sessions: dict[str, FakeSession] = {}
        self.sent: list[str] = []
        self.always_advertises = True
        self.fail_attempts = 0
        self.ping_ok = True
        self.version_ok = True
        self.headset_schedule: list[tuple[float, str]] = [(0.0, "linked")]
        self.drop_ble_at: float | None = None
        self.connected = False
        self._dropped = False
        self.connect_calls = 0
        self.disconnect_calls = 0
        self.scan_calls = 0

    async def scan(self, duration_s=1):
        self.scan_calls += 1
        return [{"address": "AA:BB:CC:DD:EE:FF", "rssi": -50}] if self.always_advertises else []

    async def connect(self, address, alias, attempts=1):
        self.connect_calls += 1
        if self.fail_attempts > 0:
            self.fail_attempts -= 1
            raise RuntimeError("simulated connect failure")
        self.sessions[alias] = FakeSession()
        self.connected = True
        self._dropped = False
        return {"alias": alias, "address": address, "connected": True}

    async def disconnect(self, alias):
        self.disconnect_calls += 1
        self.sessions.pop(alias, None)
        self.connected = False
        return {"alias": alias, "disconnected": True}

    def is_connected(self, alias):
        if (self.drop_ble_at is not None and not self._dropped
                and self.clock.now() >= self.drop_ble_at):
            self._dropped = True
            self.connected = False
        return alias in self.sessions and self.connected

    def _record(self, alias, direction, raw):
        s = self.sessions[alias]
        s.seq += 1
        s.buffer.append({"seq": s.seq, "direction": direction, "raw": raw})

    def _current_headset_token(self) -> str:
        state = "linked"
        for t, s in sorted(self.headset_schedule):
            if self.clock.now() >= t:
                state = s
        return "hds.59" if state == "linked" else "?"

    async def send(self, alias, command, reply_window_ms=0):
        self.sent.append(command)
        if alias not in self.sessions:
            raise RuntimeError(f"no session {alias}")
        self._record(alias, "tx", command)
        if command.startswith("$PING") and self.ping_ok:
            self._record(alias, "rx", "$PONG,*")
        elif command.startswith("$VERSION") and self.version_ok:
            hds = self._current_headset_token()
            self._record(alias, "rx", f"$VERSION,v4.32,{hds},4,,devhost.03,*")
        return {"sent": command, "replies_within_window": []}

    def get_events(self, alias, since_seq=0, max_events=200):
        if alias not in self.sessions:
            return {"alias": alias, "events": [], "last_seq": since_seq, "truncated": False}
        s = self.sessions[alias]
        events = [e for e in s.buffer if e["seq"] > since_seq]
        return {"alias": alias, "events": events[:max_events], "last_seq": s.seq,
                "truncated": len(events) > max_events}


def test_first_attempt_ok():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    summary = run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 1, cold="warm", warm_off_s=0,
                                      hold_s=0, clock=clock, out=None))
    r = summary.runs[0]
    assert r.ok is True
    assert r.first_attempt_ok is True
    assert len(r.attempts) == 1
    assert r.error is None


def test_first_attempt_fails_then_succeeds():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    mgr.fail_attempts = 1
    summary = run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 1, cold="warm", warm_off_s=0,
                                      hold_s=0, clock=clock, out=None))
    r = summary.runs[0]
    assert r.ok is True
    assert r.first_attempt_ok is False
    assert len(r.attempts) == 2
    assert r.attempts[0].ok is False and r.attempts[0].error is not None
    assert r.attempts[1].ok is True
    # the attempt gap (1.5 s) is real elapsed time between the failed and the successful attempt
    assert abs(r.t_link_s - 1.5) < 1e-9


def test_all_attempts_fail():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    mgr.fail_attempts = 99
    summary = run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 1, cold="warm", warm_off_s=0,
                                      hold_s=0, max_attempts=3, clock=clock, out=None))
    r = summary.runs[0]
    assert r.ok is False
    assert r.first_attempt_ok is False
    assert len(r.attempts) == 3
    assert all(not a.ok for a in r.attempts)
    assert r.t_link_s is None
    assert r.t_link_from_t0_s is None


def test_advert_timeout_marks_the_run_failed_without_attempting_connect():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    mgr.always_advertises = False
    summary = run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 1, cold="warm", warm_off_s=0,
                                      hold_s=0, advert_timeout_s=5, poll_s=1, clock=clock, out=None))
    r = summary.runs[0]
    assert r.advert_timeout is True
    assert r.ok is False
    assert r.attempts == []
    assert mgr.connect_calls == 0


def test_headset_at_link_is_linked_when_version_reports_hds():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    summary = run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 1, cold="warm", warm_off_s=0,
                                      hold_s=0, clock=clock, out=None))
    assert summary.runs[0].headset_at_link == "linked"


def test_no_headset_reply_at_link():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    mgr.version_ok = False
    summary = run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 1, cold="warm", warm_off_s=0,
                                      hold_s=0, clock=clock, out=None))
    r = summary.runs[0]
    assert r.headset_at_link == "no_reply"
    assert r.t_pong_ms is not None   # $PING is a separate knob (ping_ok, still True here) and
                                     # still gets answered normally


def test_ping_unanswered_leaves_t_pong_ms_none():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    mgr.ping_ok = False
    summary = run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 1, cold="warm", warm_off_s=0,
                                      hold_s=0, clock=clock, out=None))
    assert summary.runs[0].t_pong_ms is None


def test_headset_drop_detected_inside_hold_window():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    mgr.headset_schedule = [(0.0, "linked"), (12.0, "not_linked")]
    summary = run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 1, cold="warm", warm_off_s=0,
                                      hold_s=30, poll_s=3, clock=clock, out=None))
    r = summary.runs[0]
    assert r.headset_at_link == "linked"
    assert r.headset_lost_s is not None
    assert 11.5 <= r.headset_lost_s <= 12.5
    assert r.headset_drop_30s is True
    assert r.ble_drop_s is None


def test_ble_drop_detected_inside_hold_window():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    mgr.drop_ble_at = 9.0
    summary = run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 1, cold="warm", warm_off_s=0,
                                      hold_s=30, poll_s=3, clock=clock, out=None))
    r = summary.runs[0]
    assert r.ble_drop_s is not None
    assert 8.5 <= r.ble_drop_s <= 9.5
    assert r.headset_drop_30s is True


def test_ble_drop_after_hold_window_not_counted():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    mgr.drop_ble_at = 40.0   # after hold_s=30
    summary = run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 1, cold="warm", warm_off_s=0,
                                      hold_s=30, poll_s=3, clock=clock, out=None))
    r = summary.runs[0]
    assert r.ble_drop_s is None
    assert r.headset_drop_30s is False


def test_no_drop_when_the_link_stays_healthy_throughout():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    summary = run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 1, cold="warm", warm_off_s=0,
                                      hold_s=30, poll_s=3, clock=clock, out=None))
    r = summary.runs[0]
    assert r.headset_drop_30s is False
    assert r.ble_drop_s is None
    assert r.headset_lost_s is None


def test_warm_mode_never_prompts():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    calls: list[str] = []
    run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 2, cold="warm", warm_off_s=1, hold_s=0,
                            clock=clock, prompt=calls.append, out=None))
    assert calls == []


def test_manual_mode_prompts_once_per_run():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    calls: list[str] = []
    run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 3, cold="manual", hold_s=0, clock=clock,
                            prompt=calls.append, out=None))
    assert len(calls) == 3
    assert "Run 1/3" in calls[0]
    assert "Run 3/3" in calls[2]


def test_run_error_does_not_stop_the_batch():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    seen: list[str] = []

    def flaky_prompt(msg):
        seen.append(msg)
        if len(seen) == 2:
            raise RuntimeError("boom")

    summary = run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 3, cold="manual", hold_s=0,
                                      clock=clock, prompt=flaky_prompt, out=None))
    assert len(summary.runs) == 3
    assert summary.runs[0].error is None and summary.runs[0].ok is True
    assert summary.runs[1].error is not None
    assert summary.runs[2].error is None and summary.runs[2].ok is True


def test_only_ping_and_version_are_ever_sent():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    mgr.headset_schedule = [(0.0, "linked"), (6.0, "not_linked")]
    run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 2, cold="warm", warm_off_s=0.5, hold_s=9,
                            poll_s=3, clock=clock, out=None))
    assert mgr.sent, "expected some commands to have been sent"
    assert all(c in ("$PING,*", "$VERSION,*") for c in mgr.sent)


def test_frame_log_is_attached_to_the_session_on_a_successful_link(tmp_path=None):
    import tempfile
    from pathlib import Path

    log_path = Path(tempfile.mkdtemp()) / "connect-metrics.jsonl"
    clock = FakeClock()
    mgr = FakeMgr(clock)
    seen_sessions: list[FakeSession] = []
    real_connect = mgr.connect

    async def spying_connect(address, alias, attempts=1):
        result = await real_connect(address, alias, attempts=attempts)
        session = mgr.sessions.get(alias)
        if session is not None:
            seen_sessions.append(session)
        return result

    mgr.connect = spying_connect
    run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 1, cold="warm", warm_off_s=0, hold_s=0,
                            clock=clock, log_path=log_path, out=None))
    assert seen_sessions and seen_sessions[-1].log_file == log_path

    lines = log_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1   # one JSON line for the one run
    import json
    rec = json.loads(lines[0])
    assert rec["kind"] == "connect_metrics_run"
    assert rec["run"] == 1
    assert rec["ok"] is True


def test_one_json_line_is_logged_per_run_whatever_happens():
    import json
    import tempfile
    from pathlib import Path

    log_path = Path(tempfile.mkdtemp()) / "connect-metrics.jsonl"
    clock = FakeClock()
    mgr = FakeMgr(clock)
    mgr.fail_attempts = 99   # every run fails to connect at all
    run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 3, cold="warm", warm_off_s=0, hold_s=0,
                            max_attempts=1, clock=clock, log_path=log_path, out=None))
    lines = log_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 3
    for line in lines:
        rec = json.loads(line)
        assert rec["kind"] == "connect_metrics_run"
        assert rec["ok"] is False


def test_summary_maths_on_a_known_list():
    times = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
    runs = [
        ConnectRun(run=i, cold="warm", ok=True, first_attempt_ok=True, t_link_s=t,
                  headset_at_link="linked",
                  attempts=[ConnectAttempt(attempt=1, t_start_s=0.0, duration_s=t, ok=True)])
        for i, t in enumerate(times, start=1)
    ]
    stats = summarize(runs)
    assert stats["runs"] == 10
    assert stats["link_time_median_s"] == 5.5
    # nearest-rank 90th percentile of 1..10: ceil(0.9*10) = 9th smallest value = 9.0
    assert stats["link_time_p90_s"] == 9.0
    assert stats["link_time_max_s"] == 10.0
    assert stats["first_attempt_success_rate"] == 1.0
    assert stats["headset_drop_count"] == 0
    assert stats["failed_runs"] == 0


def test_summary_maths_rates_with_a_mixed_batch():
    runs = [
        ConnectRun(run=1, cold="warm", ok=True, first_attempt_ok=True, t_link_s=2.0,
                  headset_at_link="linked",
                  attempts=[ConnectAttempt(attempt=1, t_start_s=0.0, duration_s=2.0, ok=True)]),
        ConnectRun(run=2, cold="warm", ok=True, first_attempt_ok=False, t_link_s=4.0,
                  headset_at_link="not_linked", headset_drop_30s=True,
                  attempts=[ConnectAttempt(attempt=1, t_start_s=0.0, duration_s=1.0, ok=False,
                                          error="x"),
                           ConnectAttempt(attempt=2, t_start_s=1.5, duration_s=1.0, ok=True)]),
        ConnectRun(run=3, cold="warm", ok=False, first_attempt_ok=False,
                  attempts=[ConnectAttempt(attempt=1, t_start_s=0.0, duration_s=1.0, ok=False,
                                          error="x")]),
        ConnectRun(run=4, cold="warm", advert_timeout=True, ok=False),   # attempts=[]: not "attempted"
    ]
    stats = summarize(runs)
    assert stats["runs"] == 4
    assert stats["attempted_runs"] == 3
    assert stats["first_attempt_success_rate"] == 1 / 3
    assert stats["failed_runs"] == 2
    assert stats["headset_drop_count"] == 1
    assert stats["headset_drop_rate"] == 1 / 2
    assert stats["headset_not_linked_at_link_count"] == 1


def test_summary_excludes_error_runs_from_the_completed_counts():
    runs = [
        ConnectRun(run=1, cold="warm", ok=True, first_attempt_ok=True, t_link_s=2.0,
                  headset_at_link="linked",
                  attempts=[ConnectAttempt(attempt=1, t_start_s=0.0, duration_s=2.0, ok=True)]),
        ConnectRun(run=2, cold="warm", error="RuntimeError: boom"),
    ]
    stats = summarize(runs)
    assert stats["runs"] == 2
    assert stats["runs_with_errors"] == 1
    assert stats["attempted_runs"] == 1
    assert stats["first_attempt_success_rate"] == 1.0


def test_render_produces_one_line_per_run_plus_totals():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    summary = run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 2, cold="warm", warm_off_s=0,
                                      hold_s=0, clock=clock, out=None))
    text = summary.render()
    lines = text.splitlines()
    assert len(lines) == 1 + 2 + 1   # header + one per run + totals
    assert "run   1" in lines[1]
    assert "run   2" in lines[2]
    assert "totals" in lines[-1]


def test_every_bundled_run_disconnects_cleanly():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    run(run_connect_metrics(mgr, "AA:BB:CC:DD:EE:FF", 3, cold="warm", warm_off_s=0, hold_s=0,
                            clock=clock, out=None))
    assert "connmetrics" not in mgr.sessions
    assert mgr.disconnect_calls >= 3
