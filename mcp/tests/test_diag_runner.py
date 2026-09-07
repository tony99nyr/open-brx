"""Characterisation tests for the diagnostic-game runner (brx_mcp/diag/runner.py).

`run_case` is the unit of behaviour: it gates on capability, sends setup then
measured frames, polls for rx events across a window, and scores the result via
either an auto `verify` predicate or a human-injected `asker` callback. It takes
`mgr` as a duck-typed collaborator (see brx_mcp/ble.py `ConnectionManager` /
`Session`) and `parse_event` as an injected callable — exactly the seams that let
this run without any BLE hardware or the `bleak` dependency (not installed under
system python; see brx_mcp/diag/runner.py's deferred `from ..ble import
ConnectionManager`, which only `run_game` touches).

FakeMgr mimics the one behaviour run_case actually depends on: `brx_mcp/ble.py`'s
`Session.record()` bumps ONE shared seq counter for both tx and rx frames, and
`get_events(since_seq=...)` filters on it — so a case's "unmeasured setup" frames
and their echoes must sit at or below the `last` floor captured after setup, and
only rx arriving after that floor should reach `verify`/evidence.
"""

import asyncio

from brx_mcp.diag.model import Capability as Cap, DiagCase, Outcome, saw_command
from brx_mcp.diag.runner import run_case
from brx_mcp.protocol import parse_event


class FakeSession:
    def __init__(self):
        self.seq = 0


class FakeMgr:
    """A minimal stand-in for ConnectionManager, faithful to its seq/get_events
    contract. `queue_rx(...)` schedules raw rx frames to be delivered (i.e. added
    to the buffer with a fresh seq) the next time anyone calls `send()` or
    `get_events()` — modelling a tagger reply arriving in response to traffic, or
    just being on the wire when the runner next polls."""

    def __init__(self):
        self.sessions = {"diag": FakeSession()}
        self.sent: list[str] = []
        self._buffer: list[dict] = []
        self._rx_queue: list[str] = []

    def queue_rx(self, *raws: str) -> None:
        self._rx_queue.extend(raws)

    def _record(self, direction: str, raw: str) -> None:
        s = self.sessions["diag"]
        s.seq += 1
        self._buffer.append({"seq": s.seq, "direction": direction, "raw": raw})

    def _flush_rx(self) -> None:
        while self._rx_queue:
            self._record("rx", self._rx_queue.pop(0))

    async def send(self, sid: str, command: str, reply_window_ms: int = 250) -> dict:
        self.sent.append(command)
        self._record("tx", command)
        self._flush_rx()
        return {"sent": command}

    def get_events(self, sid: str, since_seq: int = 0, max_events: int = 200) -> dict:
        self._flush_rx()
        return {"events": [e for e in self._buffer if e["seq"] > since_seq]}


def _run(coro):
    return asyncio.run(coro)


def test_missing_capability_skips_without_sending_any_frames():
    mgr = FakeMgr()
    case = DiagCase(id="x", name="X", category="cat", requires=(Cap.TWO_GUNS,),
                    setup=("$SETUP,*",), frames=("$FIRE,*",))
    r = _run(run_case(mgr, "diag", case, available={Cap.BLE}, asker=lambda q: True,
                      parse_event=parse_event))
    assert r.outcome is Outcome.SKIP
    assert "2guns" in r.detail
    assert mgr.sent == []  # a case that can't run must not touch the wire at all


def test_verify_predicate_pass_produces_pass_outcome():
    mgr = FakeMgr()
    mgr.queue_rx("$!DFP,PONG,*")
    case = DiagCase(id="conn.ping", name="Ping", category="connectivity",
                    requires=(Cap.BLE,), frames=("$PING,*",), window_ms=150,
                    verify=saw_command("PONG"))
    r = _run(run_case(mgr, "diag", case, available={Cap.BLE}, asker=lambda q: True,
                      parse_event=parse_event))
    assert r.outcome is Outcome.PASS
    assert "PONG" in r.detail
    assert mgr.sent == ["$PING,*"]


def test_verify_predicate_fail_produces_fail_outcome():
    mgr = FakeMgr()  # no reply queued at all
    case = DiagCase(id="conn.ping", name="Ping", category="connectivity",
                    requires=(Cap.BLE,), frames=("$PING,*",), window_ms=150,
                    verify=saw_command("PONG"))
    r = _run(run_case(mgr, "diag", case, available={Cap.BLE}, asker=lambda q: True,
                      parse_event=parse_event))
    assert r.outcome is Outcome.FAIL
    assert "no $PONG seen" == r.detail


def test_ask_after_true_produces_pass_with_human_confirmed_detail():
    mgr = FakeMgr()
    case = DiagCase(id="audio.play", name="Play", category="audio",
                    requires=(Cap.BLE, Cap.HUMAN), frames=("$PLAY,VA20,4,6,,,,,*",),
                    window_ms=150, ask_after="Did you HEAR it?")
    r = _run(run_case(mgr, "diag", case, available={Cap.BLE, Cap.HUMAN},
                      asker=lambda q: True, parse_event=parse_event))
    assert r.outcome is Outcome.PASS
    assert r.detail == "(human-confirmed)"


def test_ask_after_false_produces_fail_with_human_said_no_detail():
    mgr = FakeMgr()
    case = DiagCase(id="audio.play", name="Play", category="audio",
                    requires=(Cap.BLE, Cap.HUMAN), frames=("$PLAY,VA20,4,6,,,,,*",),
                    window_ms=150, ask_after="Did you HEAR it?")
    asked = []

    def asker(question):
        asked.append(question)
        return False

    r = _run(run_case(mgr, "diag", case, available={Cap.BLE, Cap.HUMAN},
                      asker=asker, parse_event=parse_event))
    assert r.outcome is Outcome.FAIL
    assert r.detail == "(human said no)"
    assert asked == ["Did you HEAR it?"]  # the exact question was passed through


def test_no_verify_and_no_ask_after_is_manual():
    mgr = FakeMgr()
    case = DiagCase(id="btn.events", name="Buttons", category="buttons",
                    requires=(Cap.BLE,), window_ms=150)
    r = _run(run_case(mgr, "diag", case, available={Cap.BLE}, asker=lambda q: True,
                      parse_event=parse_event))
    assert r.outcome is Outcome.MANUAL
    assert r.detail == "ran; no auto check"


def test_setup_frame_replies_are_excluded_from_the_measured_window():
    # a reply that lands during `setup` (unmeasured) must not satisfy `verify`,
    # even though it carries the exact text the predicate looks for — only rx
    # arriving after `last` (captured post-setup) counts.
    mgr = FakeMgr()
    mgr.queue_rx("$!DFP,PONG,*")  # delivered on the setup send, below the floor
    case = DiagCase(id="conn.ping", name="Ping", category="connectivity",
                    requires=(Cap.BLE,), setup=("$WARMUP,*",), frames=("$PING,*",),
                    window_ms=150, verify=saw_command("PONG"))
    r = _run(run_case(mgr, "diag", case, available={Cap.BLE}, asker=lambda q: True,
                      parse_event=parse_event))
    assert r.outcome is Outcome.FAIL
    assert mgr.sent == ["$WARMUP,*", "$PING,*"]  # setup still sent, in order, first


def test_frame_phase_reply_is_seen_even_though_setup_ran_first():
    mgr = FakeMgr()
    # first queued rx lands during setup (must be ignored), second during the
    # measured frame send (must be picked up).
    mgr.queue_rx("$!DFP,SETUPECHO,*")
    case = DiagCase(id="x", name="X", category="cat", requires=(Cap.BLE,),
                    setup=("$WARMUP,*",), frames=("$PING,*",), window_ms=150,
                    verify=saw_command("PONG"))
    # queue the real reply to land on the *next* send() after setup consumed the first
    orig_send = mgr.send

    async def send_then_queue_pong(sid, command, reply_window_ms=250):
        result = await orig_send(sid, command, reply_window_ms)
        if command == "$WARMUP,*":
            mgr.queue_rx("$!DFP,PONG,*")
        return result

    mgr.send = send_then_queue_pong
    r = _run(run_case(mgr, "diag", case, available={Cap.BLE}, asker=lambda q: True,
                      parse_event=parse_event))
    assert r.outcome is Outcome.PASS
    assert "PONG" in r.detail


def test_evidence_is_capped_to_the_last_twelve_raw_frames():
    mgr = FakeMgr()
    raws = [f"$LCD,{i},*" for i in range(15)]
    mgr.queue_rx(*raws)
    case = DiagCase(id="x", name="X", category="cat", requires=(Cap.BLE,),
                    frames=("$PING,*",), window_ms=150, verify=saw_command("LCD"))
    r = _run(run_case(mgr, "diag", case, available={Cap.BLE}, asker=lambda q: True,
                      parse_event=parse_event))
    assert r.outcome is Outcome.PASS
    assert len(r.evidence) == 12
    assert r.evidence == raws[-12:]  # the OLDEST 3 are dropped, not the newest


def test_exception_during_send_produces_error_outcome():
    mgr = FakeMgr()

    async def boom(sid, command, reply_window_ms=250):
        raise RuntimeError("gatt write failed")

    mgr.send = boom
    case = DiagCase(id="x", name="X", category="cat", requires=(Cap.BLE,),
                    frames=("$PING,*",), window_ms=150, verify=saw_command("PONG"))
    r = _run(run_case(mgr, "diag", case, available={Cap.BLE}, asker=lambda q: True,
                      parse_event=parse_event))
    assert r.outcome is Outcome.ERROR
    assert r.detail == "RuntimeError: gatt write failed"
    assert r.evidence == []  # never got as far as collecting any


def test_passing_case_carries_no_capability_gaps_and_reports_the_case_identity():
    mgr = FakeMgr()
    mgr.queue_rx("$!DFP,PONG,*")
    case = DiagCase(id="conn.ping", name="Ping / Pong", category="connectivity",
                    requires=(Cap.BLE,), frames=("$PING,*",), window_ms=150,
                    verify=saw_command("PONG"))
    r = _run(run_case(mgr, "diag", case, available={Cap.BLE}, asker=lambda q: True,
                      parse_event=parse_event))
    # the Result must echo the case's own identity, not just a bare outcome
    assert (r.case_id, r.name, r.category) == ("conn.ping", "Ping / Pong", "connectivity")
