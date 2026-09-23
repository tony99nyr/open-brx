"""Behavioural tests for the bounded raw-byte bench helper (brx_mcp/rawbytes.py, docs/FOLLOWUPS.md
F269), no BLE hardware and no real sleeps.

`FakeClient`/`FakeSession`/`FakeMgr` mimic the ONE seam `write_raw` actually depends on
(`ble.py Session`/`ConnectionManager`): `session.client.write_gatt_char`, `session.write_lock`,
`session.record`, `session.seq`, and `mgr.sessions`/`mgr.get_events` -- the same duck-typed pattern
`test_soak_runner.py`'s `FakeMgr` already uses for `run_soak`.

`FakeClock` advances a counter instead of sleeping for real (CLAUDE.md: "a mocked clock, not
sleeps") and records every `sleep()` call so a test can assert exactly which delays fired and which
did not.
"""

from __future__ import annotations

import asyncio
from contextlib import contextmanager

from _async import run

from brx_mcp.rawbytes import (
    RawPlan,
    RawWrite,
    plan_from_segments,
    plan_from_stream,
    repeat_stream,
    split_at,
    validate_plan,
    write_raw,
)


@contextmanager
def raises(exc, match=None):
    """The system Python here has no pytest (run_tests.py): a small `raises` stand-in
    (the same one `test_mc_ready_all.py` and friends already use)."""
    try:
        yield
    except exc as e:
        assert match is None or match in str(e), f"{e!r} does not mention {match!r}"
        return
    raise AssertionError(f"{exc.__name__} not raised")


class FakeClock:
    """Advances instantly: `sleep(s)` moves the virtual clock forward and yields once, instead of
    actually waiting. Every call is recorded so a test can pin exact delay values and detect a call
    that should never have happened."""

    def __init__(self):
        self.t = 0.0
        self.sleep_calls: list[float] = []

    def now(self) -> float:
        return self.t

    async def sleep(self, seconds: float) -> None:
        self.sleep_calls.append(seconds)
        self.t += max(0.0, seconds)
        await asyncio.sleep(0)


class FakeClient:
    """Stands in for `BleakClient`: records every `write_gatt_char` call. `write_impl`, if set,
    replaces the default no-op body (used by the blocking-write test)."""

    def __init__(self):
        self.calls: list[dict] = []
        self.write_impl = None

    async def write_gatt_char(self, char, data, response=False):
        self.calls.append({"char": char, "data": bytes(data), "response": response})
        if self.write_impl is not None:
            await self.write_impl(char, data, response)


class FakeSession:
    """Mirrors `ble.py Session`'s seam: a client, a write lock, a seq'd `record()`. No BLE, no
    notify handler -- rx events are seeded directly by a test that wants to exercise `read_ms`."""

    def __init__(self):
        self.client = FakeClient()
        self.write_lock = asyncio.Lock()
        self.seq = 0
        self.buffer: list[dict] = []
        self.log_file = None
        self.log_label = None

    def record(self, direction, raw):
        self.seq += 1
        ev = {"seq": self.seq, "direction": direction, "raw": raw}
        self.buffer.append(ev)
        return ev


class FakeMgr:
    def __init__(self):
        self.sessions: dict[str, FakeSession] = {}

    def add(self, alias: str) -> FakeSession:
        s = FakeSession()
        self.sessions[alias] = s
        return s

    def get_events(self, alias, since_seq=0, max_events=200):
        s = self.sessions[alias]
        events = [e for e in s.buffer if e["seq"] > since_seq]
        return {"alias": alias, "events": events[:max_events], "last_seq": s.seq,
                "truncated": len(events) > max_events}


# -- planning (pure) ---------------------------------------------------------------------------

def test_repeat_stream_146_pings_is_1022_bytes():
    assert len(repeat_stream("$PING,*", 146)) == 1022


def test_repeat_stream_147_pings_is_1029_bytes():
    assert len(repeat_stream("$PING,*", 147)) == 1029


def test_split_at_1022_bytes_is_51_full_chunks_and_one_short_one():
    payload = repeat_stream("$PING,*", 146)
    chunks = split_at(payload, 20)
    assert len(chunks) == 52
    assert [len(c) for c in chunks[:-1]] == [20] * 51
    assert len(chunks[-1]) == 2
    assert b"".join(chunks) == payload   # every byte, exactly once, in order


def test_split_at_1029_bytes_is_51_full_chunks_and_a_9_byte_remainder():
    payload = repeat_stream("$PING,*", 147)
    chunks = split_at(payload, 20)
    assert len(chunks) == 52
    assert [len(c) for c in chunks[:-1]] == [20] * 51
    assert len(chunks[-1]) == 9
    assert b"".join(chunks) == payload


def test_split_at_a_101_byte_frame_is_five_full_chunks_and_a_1_byte_remainder():
    frame = "$WEAP," + "1," * 47 + "*"   # any 101-byte ASCII payload
    payload = frame.encode("utf-8")
    assert len(payload) == 101
    chunks = split_at(payload, 20)
    assert [len(c) for c in chunks] == [20, 20, 20, 20, 20, 1]
    assert b"".join(chunks) == payload


def test_plan_from_stream_has_no_delay_between_any_write():
    plan = plan_from_stream(repeat_stream("$PING,*", 146), chunk_size=20)
    assert all(w.delay_after_ms == 0.0 for w in plan.writes)
    assert plan.total_bytes == 1022


def test_plan_from_segments_keeps_each_segment_as_one_write_never_rechunked():
    # A7b: $AMMO,0,2 (9 B) then 3,50,1,* (8 B), a 60 ms gap, no delay after the last write.
    plan = plan_from_segments(["$AMMO,0,2", "3,50,1,*"], delays_ms=60.0)
    assert len(plan.writes) == 2
    assert plan.writes[0].data == b"$AMMO,0,2"
    assert len(plan.writes[0].data) == 9
    assert plan.writes[0].delay_after_ms == 60.0
    assert plan.writes[1].data == b"3,50,1,*"
    assert len(plan.writes[1].data) == 8
    assert plan.writes[1].delay_after_ms == 0.0   # nothing follows the last write


def test_plan_from_segments_one_delay_per_gap():
    plan = plan_from_segments(["a", "b", "c"], delays_ms=[10.0, 20.0])
    assert [w.delay_after_ms for w in plan.writes] == [10.0, 20.0, 0.0]


def test_plan_from_segments_wrong_number_of_delays_is_refused():
    with raises(ValueError):
        plan_from_segments(["a", "b", "c"], delays_ms=[10.0])


# -- validation (pure) --------------------------------------------------------------------------

def test_validate_plan_accepts_a_known_safe_stream():
    plan = plan_from_stream(repeat_stream("$PING,*", 5), chunk_size=20)
    assert validate_plan(plan) == []


def test_validate_plan_refuses_a_21_byte_write():
    plan = RawPlan(writes=[RawWrite(b"x" * 21, 0.0)])
    with raises(ValueError, match="21 B"):
        validate_plan(plan)


def test_validate_plan_refuses_zero_writes():
    with raises(ValueError):
        validate_plan(RawPlan(writes=[]))


def test_validate_plan_refuses_over_the_write_count_bound():
    plan = RawPlan(writes=[RawWrite(b"$PING,*", 0.0) for _ in range(513)])
    with raises(ValueError, match="513 writes"):
        validate_plan(plan)


def test_validate_plan_refuses_over_the_total_byte_bound():
    plan = RawPlan(writes=[RawWrite(b"x" * 20, 0.0) for _ in range(410)])   # 8200 B > 8 KiB
    with raises(ValueError, match="8200 B"):
        validate_plan(plan)


def test_validate_plan_refuses_a_delay_over_the_per_gap_bound():
    plan = RawPlan(writes=[RawWrite(b"$PING,*", 10_001.0)])
    with raises(ValueError, match="10001.0 ms"):
        validate_plan(plan)


def test_validate_plan_refuses_over_the_total_delay_bound():
    plan = RawPlan(writes=[RawWrite(b"$PING,*", 10_000.0) for _ in range(7)])   # 70,000 ms > 60 s
    with raises(ValueError, match="70000 ms"):
        validate_plan(plan)


def test_validate_plan_refuses_a_denied_command_split_across_two_writes():
    # $DPLAY is hang-prone, refused outright, no override -- even split across GATT writes.
    plan = plan_from_segments(["$DPLAY,A", "10,4,*"])
    with raises(ValueError, match="refused"):
        validate_plan(plan)


def test_validate_plan_refuses_an_unknown_command_without_confirm():
    plan = plan_from_segments(["$NOTACOMMAND,*"])
    with raises(ValueError, match="confirm"):
        validate_plan(plan)


def test_validate_plan_accepts_an_unknown_command_with_confirm():
    plan = plan_from_segments(["$NOTACOMMAND,*"])
    assert validate_plan(plan, confirm=True) == []


def test_validate_plan_refuses_an_incomplete_tail_without_allow_incomplete():
    # A4: the lost-'*' fragment.
    plan = plan_from_segments(["$AMMO,0,17,50,1"])
    with raises(ValueError, match="incomplete"):
        validate_plan(plan)


def test_validate_plan_warns_on_an_incomplete_tail_with_allow_incomplete():
    plan = plan_from_segments(["$AMMO,0,17,50,1"])
    warnings = validate_plan(plan, allow_incomplete=True)
    assert len(warnings) == 1
    assert "$*" in warnings[0]


# -- execution ------------------------------------------------------------------------------------

def test_write_raw_sends_every_chunk_and_logs_it_post_completion():
    clock = FakeClock()
    mgr = FakeMgr()
    mgr.add("g")
    plan = plan_from_stream(repeat_stream("$PING,*", 5), chunk_size=20)   # 35 B -> 2 chunks (20, 15)
    result = run(write_raw(mgr, "g", plan, clock=clock))
    assert len(result.writes) == 2
    assert [w.n_bytes for w in result.writes] == [20, 15]
    assert [c["data"] for c in mgr.sessions["g"].client.calls] == [w.data for w in plan.writes]
    # each logged write has a raw tx-raw entry in the session buffer
    tx_raw = [e for e in mgr.sessions["g"].buffer if e["direction"] == "tx-raw"]
    assert len(tx_raw) == 2


def test_write_raw_makes_no_sleep_call_when_every_delay_is_zero():
    clock = FakeClock()
    mgr = FakeMgr()
    mgr.add("g")
    plan = plan_from_stream(repeat_stream("$PING,*", 5), chunk_size=20)
    run(write_raw(mgr, "g", plan, clock=clock))
    assert clock.sleep_calls == []


def test_write_raw_sleeps_the_exact_delay_between_explicit_writes():
    clock = FakeClock()
    mgr = FakeMgr()
    mgr.add("g")
    plan = plan_from_segments(["$AMMO,0,2", "3,50,1,*"], delays_ms=60.0)
    run(write_raw(mgr, "g", plan, clock=clock))
    assert clock.sleep_calls == [0.06]   # exactly one gap, the 60 ms one; none after the last write


def test_write_raw_response_flag_reaches_the_client_call():
    clock = FakeClock()
    mgr = FakeMgr()
    mgr.add("g")
    plan = plan_from_segments(["$PING,*"])
    run(write_raw(mgr, "g", plan, clock=clock, response=True))
    assert mgr.sessions["g"].client.calls[0]["response"] is True


def test_write_raw_logs_a_write_only_after_it_actually_completes():
    clock = FakeClock()
    mgr = FakeMgr()
    session = mgr.add("g")
    gate = asyncio.Event()

    async def blocking_write(char, data, response):
        await gate.wait()

    session.client.write_impl = blocking_write
    plan = plan_from_segments(["$PING,*"])

    async def scenario():
        task = asyncio.ensure_future(write_raw(mgr, "g", plan, clock=clock))
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        # the write is in flight, blocked on `gate`: nothing has been logged yet
        assert session.buffer == []
        assert not task.done()
        gate.set()
        result = await task
        assert len(result.writes) == 1
        assert len(session.buffer) == 1

    run(scenario())


def test_write_raw_holds_the_lock_across_the_whole_plan_including_delays():
    clock = FakeClock()
    mgr = FakeMgr()
    session = mgr.add("g")
    plan = plan_from_segments(["$AMMO,0,2", "3,50,1,*"], delays_ms=60.0)
    entered_at: list[float] = []

    async def second_writer():
        async with session.write_lock:
            entered_at.append(clock.now())

    async def scenario():
        main_task = asyncio.ensure_future(write_raw(mgr, "g", plan, clock=clock))
        await asyncio.sleep(0)
        second_task = asyncio.ensure_future(second_writer())
        await main_task
        await second_task
        # the second writer could only acquire the lock once write_raw released it, i.e. at t=0.06
        assert entered_at == [0.06]

    run(scenario())


def test_write_raw_refuses_before_touching_the_client_for_a_denied_stream():
    clock = FakeClock()
    mgr = FakeMgr()
    mgr.add("g")
    plan = plan_from_segments(["$DPLAY,A", "10,4,*"])
    with raises(ValueError, match="refused"):
        run(write_raw(mgr, "g", plan, clock=clock))
    assert mgr.sessions["g"].client.calls == []


def test_write_raw_counts_replies_seen_during_the_read_window():
    class ReplyingClock(FakeClock):
        """Simulates a $PONG notification arriving mid-read-window: `sleep()` for the read phase
        appends the reply to the session buffer, the way a real BLE notify would while we wait."""

        def __init__(self, session):
            super().__init__()
            self.session = session
            self.armed = True

        async def sleep(self, seconds: float) -> None:
            await super().sleep(seconds)
            if self.armed and seconds > 0:
                self.session.record("rx", "$PONG,*")
                self.session.record("rx", "$PONG,*")
                self.armed = False

    mgr = FakeMgr()
    session = mgr.add("g")
    clock = ReplyingClock(session)
    plan = plan_from_segments(["$PING,*"])
    result = run(write_raw(mgr, "g", plan, clock=clock, read_ms=2000))
    assert result.reply_counts == {"PONG": 2}


def test_read_ms_counts_a_reply_that_arrives_during_the_stream():
    # A7c: the gun answers $PONG while later chunks are still being written. The count must start
    # before the first write, not after the last one, or every early reply is lost.
    mgr = FakeMgr()
    session = mgr.add("g")

    async def reply_mid_stream(char, data, response):
        for _ in range(bytes(data).count(b"*")):
            session.record("rx", "$PONG,*")

    session.client.write_impl = reply_mid_stream
    plan = plan_from_stream(repeat_stream("$PING,*", 3))
    result = run(write_raw(mgr, "g", plan, clock=FakeClock(), read_ms=100))
    assert result.reply_counts == {"PONG": 3}


# -- polish loop 1: bytes outside a frame, the parser reset, mid-payload fragments, read-back --------

def test_bytes_before_the_first_dollar_are_refused_even_with_confirm():
    # An earlier run may leave '$FACT' in the gun's parser; 'ORY,*' would complete a denied $FACTORY.
    for segs in (["ORY,*$PING,*"], ["FACTORY,*", "$PING,*"], ["ORY,*", "$PING,*"]):
        with raises(ValueError, match="before the first '$'"):
            validate_plan(plan_from_segments(segs), confirm=True, allow_incomplete=True)


def test_a_payload_with_no_frame_at_all_is_refused():
    # "$AMMO,0,2" in double quotes reaches us as ",0,2": no '$' at all.
    with raises(ValueError, match="no '$' frame"):
        validate_plan(plan_from_segments(["   "]), confirm=True, allow_incomplete=True)


def test_bytes_after_a_frames_star_are_refused():
    with raises(ValueError, match="outside any frame"):
        validate_plan(plan_from_segments(["$PING,*junk"]), confirm=True)


def test_the_bare_parser_reset_needs_no_confirm():
    assert validate_plan(plan_from_segments(["$PING,*", "$*", "$PING,*"])) == []


def test_a_mid_payload_fragment_needs_allow_incomplete():
    segs = ["$AMMO,0,10,50,1,*", "$AMMO,0,17,50,1", "$AMMO,0,23,50,1,*"]
    with raises(ValueError, match="incomplete frame"):
        validate_plan(plan_from_segments(segs))
    warnings = validate_plan(plan_from_segments(segs), allow_incomplete=True)
    assert len(warnings) == 1 and "stale tokens" in warnings[0]


def test_a_denied_command_in_an_incomplete_fragment_is_refused():
    with raises(ValueError, match="refused, confirm or not"):
        validate_plan(plan_from_segments(["$PING,*", "$DPLAY,A10,4"]), confirm=True,
                      allow_incomplete=True)


def test_last_alcd_counts_only_frames_after_the_last_write():
    # A shot fired while the plan is still writing must not be read as its result (A4/A7b/A8).
    class ShotInReadWindow(FakeClock):
        def __init__(self, session):
            super().__init__()
            self.session = session
            self.fired = False

        async def sleep(self, seconds: float) -> None:
            await super().sleep(seconds)
            if not self.fired and seconds >= 0.1:
                self.fired = True
                self.session.record("rx", "$ALCD,0,22,50,*")

    mgr = FakeMgr()
    session = mgr.add("g")

    async def reply(char, data, response):
        if data == b"$PING,*":
            session.record("rx", "$PONG,*")
        else:
            session.record("rx", "$ALCD,0,31,50,*")        # a shot during the writes

    session.client.write_impl = reply
    opened: list[bool] = []
    result = run(write_raw(mgr, "g", plan_from_segments(["$AMMO,0,23,50,1,*"]),
                           clock=ShotInReadWindow(session), read_ms=100, ping_after_s=10,
                           on_read_open=lambda: opened.append(True)))
    assert opened == [True], "the fire cue is given once, after the plan is written"
    assert result.last_frames["ALCD"] == "$ALCD,0,22,50,*"
    assert result.after_counts["ALCD"] == 1
    assert result.reply_counts["ALCD"] == 2, "the reply count still covers the whole run"
    assert result.pong_after is True


def test_no_pong_after_the_plan_is_reported():
    mgr = FakeMgr()
    mgr.add("g")
    clock = FakeClock()
    result = run(write_raw(mgr, "g", plan_from_segments(["$PING,*"]), clock=clock, ping_after_s=10))
    assert result.pong_after is False
    assert sum(clock.sleep_calls) >= 10, "waited the full 10 s LOCK-UP window"


# -- polish loop 2 -------------------------------------------------------------------------------

def test_a_denied_word_ending_in_star_or_padded_is_still_refused():
    for frame in ("$FACTORY*", "$DPLAY*", "$ FACTORY,*", "$FACTORY\t,*"):
        with raises(ValueError, match="refused, confirm or not"):
            validate_plan(plan_from_segments([frame]), confirm=True)


def test_no_liveness_ping_after_a_plan_that_ends_incomplete():
    mgr = FakeMgr()
    session = mgr.add("g")
    result = run(write_raw(mgr, "g", plan_from_segments(["$AMMO,0,17,50,1"]), clock=FakeClock(),
                           allow_incomplete=True, ping_after_s=10))
    assert result.pong_after is None
    assert b"$PING,*" not in [c["data"] for c in session.client.calls]
    assert any("no liveness $PING" in w for w in result.warnings)


def test_a_late_pong_from_the_plan_is_not_taken_for_the_liveness_reply():
    # A7c: the plan's own $PONGs trail in after the writes. The liveness ping must not count them.
    class LateReplyClock(FakeClock):
        def __init__(self, session):
            super().__init__()
            self.session = session
            self.late = 3

        async def sleep(self, seconds: float) -> None:
            await super().sleep(seconds)
            if self.late:
                self.late -= 1
                self.session.record("rx", "$PONG,*")

    mgr = FakeMgr()
    session = mgr.add("g")
    result = run(write_raw(mgr, "g", plan_from_segments(["$PING,*"]), clock=LateReplyClock(session),
                           ping_after_s=10))
    assert result.pong_after is False, "the gun never answered the liveness $PING"


def test_a_failed_liveness_ping_write_keeps_the_results():
    mgr = FakeMgr()
    session = mgr.add("g")

    async def fail_on_ping(char, data, response):
        if data == b"$PING,*":
            raise RuntimeError("Unreachable")

    session.client.write_impl = fail_on_ping
    result = run(write_raw(mgr, "g", plan_from_segments(["$AMMO,0,23,50,1,*"]), clock=FakeClock(),
                           ping_after_s=10))
    assert len(result.writes) == 1
    assert result.pong_after is False
    assert any("liveness $PING write failed" in w for w in result.warnings)


# -- the phone-paced plan (A7/A8's paced halves) -------------------------------------------------

def test_phone_pacing_chunks_each_frame_alone_with_the_phones_gaps():
    from brx_mcp.rawbytes import plan_phone_paced
    long = "$" + "W" * 40 + ",*"           # 43 B: three chunks, 20 + 20 + 3
    short = "$PING,*"                      # one chunk
    plan = plan_phone_paced((long + short + long).encode())
    assert [len(w.data) for w in plan.writes] == [20, 20, 3, 7, 20, 20, 3]
    # multi-packet: 8 ms after each chunk, plus 18 ms after the frame; single-packet: 18 ms; none after the last
    assert [w.delay_after_ms for w in plan.writes] == [8, 8, 26, 18, 8, 8, 0]
    assert b"".join(w.data for w in plan.writes) == (long + short + long).encode()


def test_phone_pacing_refuses_a_trailing_fragment():
    from brx_mcp.rawbytes import plan_phone_paced
    with raises(ValueError, match="whole frames"):
        plan_phone_paced(b"$PING,*$AMMO,0,2")


def test_phone_paced_a8_run_fits_the_bounds():
    from brx_mcp.rawbytes import plan_phone_paced
    weap = "$WEAP,0," + ",".join(["1"] * 42) + ",*"
    plan = plan_phone_paced(repeat_stream(weap + weap, 25))
    validate_plan(plan)


def test_phone_pacing_block_pause_lands_after_every_n_frames_never_after_the_last():
    from brx_mcp.rawbytes import plan_phone_paced
    plan = plan_phone_paced(repeat_stream("$PING,*", 5), block_frames=2, block_pause_ms=300)
    assert [w.delay_after_ms for w in plan.writes] == [18, 318, 18, 318, 0]


def test_the_cli_refuses_an_unknown_flag_before_it_connects():
    # An ignored --phone-pacing (an older build, or a typo) would run a "paced" control at zero gap.
    from brx_mcp import __main__ as cli
    for args in (["AA", "--stream", "$PING,*", "--repeat", "2", "--phone-pacng"],
                 ["AA", "BB", "--stream", "$PING,*", "--repeat", "2"]):
        with raises(SystemExit):
            cli._dispatch_raw_bytes(args)
