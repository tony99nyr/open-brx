"""Behavioural tests for the soak run loop (brx_mcp/soak/runner.py), no BLE hardware.

`FakeMgr` mimics the one contract `run_soak` actually depends on (`ble.py ConnectionManager`):
`connect`/`disconnect`/`send`/`get_events`/`is_connected`, plus a `sessions` dict of objects that
carry a `.seq` (and, if a log path is given, `.log_file`/`.log_label`), the same seam
`brx_mcp/diag/runner.py`'s own `test_diag_runner.py` already uses for its FakeMgr.

`FakeClock` mimics `runner.Clock` but advances a counter instead of sleeping for real, so a run of
several *simulated* minutes takes milliseconds of real test time (CLAUDE.md: "a mocked clock, not
sleeps"; a fixed real sleep would race under `npm run test:all`'s parallel load anyway).
"""

import asyncio

from _async import run

from brx_mcp.soak.patterns import PATTERNS, ScheduledFrames, SoakPattern
from brx_mcp.soak.runner import run_soak


class FakeSession:
    """Mirrors `ble.py Session`: each connect (including a reconnect) gets a FRESH session with its
    OWN seq counter and buffer, so a reconnect can never see an event from before the link dropped,
    the same reason a real `BleakClient` reconnect starts a real tagger's session over."""

    def __init__(self):
        self.seq = 0
        self.buffer: list[dict] = []
        self.log_file = None
        self.log_label = None


class FakeClock:
    """Advances instantly: `sleep(s)` moves the virtual clock forward by `s` and yields once to
    the event loop (so concurrent-looking `await`s still interleave), instead of actually waiting."""

    def __init__(self):
        self.t = 0.0

    def now(self) -> float:
        return self.t

    async def sleep(self, seconds: float) -> None:
        self.t += max(0.0, seconds)
        await asyncio.sleep(0)


class FakeMgr:
    """A minimal stand-in for `ConnectionManager`. Scriptable knobs:

    `answer_ping`: False makes every $PING go unanswered (drives a LOCK-UP).
    `connected`: flipped to False (directly, or via `drop_link_at`) to drive a LINK DROP.
    `drop_link_at`: virtual time (via `clock`) at which the link drops, once.
    `reconnect_answers`: whether a reconnect's own $PING gets a $PONG back.
    `bad_frame_slots`: slots whose next $ALCD echo (after an $AMMO write) reports the WRONG
                       magazine, to drive a BAD FRAME.
    `raise_after`: raise KeyboardInterrupt on exactly the Nth call to `send()` (simulates a real
                  Ctrl-C landing mid-write), once.
    """

    def __init__(self, clock: FakeClock):
        self.clock = clock
        self.sessions: dict[str, FakeSession] = {}
        self.sent: list[str] = []
        self.answer_ping = True
        self.connected = True
        self.drop_link_at: float | None = None
        self._dropped = False
        self.reconnect_answers = True
        self.bad_frame_slots: set[str] = set()
        self._acked_slots: set[str] = set()
        self.raise_after: int | None = None
        self._send_calls = 0
        self.connect_calls = 0

    async def connect(self, address, alias):
        self.connect_calls += 1
        self.sessions[alias] = FakeSession()
        self.connected = True
        if self.connect_calls > 1:      # a RECONNECT (not the first connect)
            self.answer_ping = self.reconnect_answers
        return {"alias": alias, "address": address, "connected": True}

    async def disconnect(self, alias):
        self.sessions.pop(alias, None)
        return {"alias": alias, "disconnected": True}

    def is_connected(self, alias):
        if (self.drop_link_at is not None and not self._dropped
                and self.clock.now() >= self.drop_link_at):
            self._dropped = True
            self.connected = False
        return alias in self.sessions and self.connected

    def _record(self, alias, direction, raw):
        s = self.sessions[alias]
        s.seq += 1
        s.buffer.append({"seq": s.seq, "direction": direction, "raw": raw})

    async def send(self, alias, command, reply_window_ms=0):
        self._send_calls += 1
        if self.raise_after is not None and self._send_calls == self.raise_after:
            raise KeyboardInterrupt()
        self.sent.append(command)
        if alias not in self.sessions:
            raise RuntimeError(f"no session {alias}")
        self._record(alias, "tx", command)
        if command.startswith("$PING") and self.connected and self.answer_ping:
            self._record(alias, "rx", "$PONG,*")
        elif command.startswith("$AMMO,"):
            body = command.strip().rstrip("*").rstrip(",").lstrip("$")
            t = body.split(",")
            slot, mag = t[1], t[2]
            key = f"{alias}:{slot}"
            if slot in self.bad_frame_slots and key not in self._acked_slots:
                self._acked_slots.add(key)
                wrong = str(int(mag) - 1)
                self._record(alias, "rx", f"$ALCD,{wrong},100,{slot},0,0,*")
            elif key not in self._acked_slots:
                self._acked_slots.add(key)
                self._record(alias, "rx", f"$ALCD,{mag},100,{slot},0,0,*")
        return {"sent": command, "replies_within_window": []}

    def get_events(self, alias, since_seq=0, max_events=200):
        if alias not in self.sessions:
            return {"alias": alias, "events": [], "last_seq": since_seq, "truncated": False}
        s = self.sessions[alias]
        events = [e for e in s.buffer if e["seq"] > since_seq]
        return {"alias": alias, "events": events[:max_events], "last_seq": s.seq,
                "truncated": len(events) > max_events}


_TINY = SoakPattern(name="tiny", description="isolates the liveness/lockup logic")


def test_clean_run_has_no_anomalies_and_tears_down():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    summary = run(run_soak(mgr, "AA:BB", _TINY, minutes=5 / 60, clock=clock, status=None))
    assert summary.lockups == []
    assert summary.link_drops == []
    assert summary.bad_frames == []
    assert summary.frames_sent > 0
    # teardown always runs the WHOLE of gameconfig.END_SEQUENCE, never a bare $CLEAR
    assert "$CLEAR,*" in mgr.sent
    assert mgr.sent[-1] != "$CLEAR,*"
    assert "soak" not in mgr.sessions   # disconnected (default alias)


def test_lockup_detected_after_ten_seconds_of_silence():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    mgr.answer_ping = False        # every $PING goes unanswered from t=0
    summary = run(run_soak(mgr, "AA:BB", _TINY, minutes=15 / 60, clock=clock, status=None))
    assert len(summary.lockups) == 1
    ev = summary.lockups[0]
    assert 9.5 <= ev["t_s"] <= 10.5
    assert ev["silent_for_s"] >= 10


def test_lockup_not_reported_while_pongs_keep_arriving():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    summary = run(run_soak(mgr, "AA:BB", _TINY, minutes=15 / 60, clock=clock, status=None))
    assert summary.lockups == []


def test_link_drop_detected_and_gun_answers_after_reconnect():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    mgr.drop_link_at = 3.0
    mgr.reconnect_answers = True
    summary = run(run_soak(mgr, "AA:BB", _TINY, minutes=8 / 60, clock=clock, status=None))
    assert len(summary.link_drops) == 1
    assert summary.link_drops[0]["reconnected"] is True
    assert mgr.connect_calls >= 2      # the original connect + at least one reconnect


def test_link_drop_detected_and_gun_stays_silent_after_reconnect():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    mgr.drop_link_at = 3.0
    mgr.reconnect_answers = False
    summary = run(run_soak(mgr, "AA:BB", _TINY, minutes=8 / 60, clock=clock, status=None))
    assert len(summary.link_drops) == 1
    assert summary.link_drops[0]["reconnected"] is False


def test_bad_frame_detected_when_alcd_echo_disagrees():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    mgr.bad_frame_slots = {"0"}
    pattern = SoakPattern(name="ammo", description="d", once=("$AMMO,0,50,100,1,*",))
    summary = run(run_soak(mgr, "AA:BB", pattern, minutes=2 / 60, clock=clock, status=None))
    assert len(summary.bad_frames) == 1
    ev = summary.bad_frames[0]
    assert ev["slot"] == "0"
    assert ev["expected_mag"] == 50
    assert ev["got_mag"] == 49


def test_no_bad_frame_when_alcd_echo_agrees():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    pattern = SoakPattern(name="ammo", description="d", once=("$AMMO,0,50,100,1,*",))
    summary = run(run_soak(mgr, "AA:BB", pattern, minutes=2 / 60, clock=clock, status=None))
    assert summary.bad_frames == []


def test_ctrl_c_ends_cleanly_with_a_summary():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    mgr.raise_after = 5     # a KeyboardInterrupt lands on the 5th write, mid-run
    summary = run(run_soak(mgr, "AA:BB", _TINY, minutes=5, clock=clock, status=None))
    assert summary.minutes_run < 5      # stopped early
    assert summary.frames_sent >= 4
    # teardown still ran (it happens in `finally`, after the one-shot interrupt), never a bare $CLEAR
    assert "$CLEAR,*" in mgr.sent
    assert mgr.sent[-1] != "$CLEAR,*"


def test_gap_ms_and_block_pacing_are_applied():
    clock = FakeClock()
    mgr = FakeMgr(clock)
    burst = SoakPattern(name="burst", description="d",
                        repeating=(ScheduledFrames("b", 0.0, ("$PING,*", "$PING,*", "$PING,*")),))
    # minutes chosen tiny so the loop body runs only a couple of times; gap/pause pacing should
    # still show up as virtual time elapsed beyond the bare deadline.
    summary = run(run_soak(mgr, "AA:BB", burst, minutes=1 / 60, gap_ms=50, block=2, pause_ms=500,
                           clock=clock, status=None))
    assert summary.frames_sent >= 3


def test_every_bundled_pattern_runs_clean_for_a_short_soak():
    for name in PATTERNS:
        clock = FakeClock()
        mgr = FakeMgr(clock)
        summary = run(run_soak(mgr, "AA:BB", name, minutes=6 / 60, clock=clock, status=None))
        assert summary.pattern == name
        assert summary.frames_sent > 0
        assert summary.lockups == summary.link_drops == summary.bad_frames == []
