"""`ir-emit`'s run-time estimate + `--wait` flag (2026-09-11).

Bench finding: `IRBridge.emit()` sends `TXN <repeat> <bits>` and returns as soon as the
firmware acks, but the board keeps transmitting on its own for ~0.15 s per repeat -- a
repeat=1000 flood ran ~2 minutes after the CLI call had already returned, and a
re-spawned victim gun died again 90 ms later because the emitter, not the gun, was still
live. That was nearly written up as a firmware latch (FOLLOWUPS F74).

These tests cover the estimate string and `--wait` behaviour without touching hardware:
`IRBridge` and `time.sleep` are swapped for fakes, plain-function style with manual
save/restore (no pytest -- `run_tests.py` runs this under system python, same as the
rest of the suite; see `_skip.py`'s note).
"""
import contextlib
import io

import brx_mcp.__main__ as cli
import brx_mcp.irbridge as irbridge_mod


class FakeBridge:
    """Stand-in for IRBridge -- no serial port, just records what it was asked to do."""

    instances: list["FakeBridge"] = []

    def __init__(self, port):
        self.port = port or "FAKE"
        self.calls: list[tuple[str, int]] = []
        FakeBridge.instances.append(self)

    ack = "ACK"   # a test sets it to mimic an old or a new ir_emit.ino

    def emit(self, bits: str, repeat: int, gap_ms: int | None = None) -> str:
        self.calls.append((bits, repeat) if gap_ms is None else (bits, repeat, gap_ms))
        return FakeBridge.ack

    def close(self) -> None:
        pass


def _with_fake_bridge_and_sleep(fn):
    """Run `fn(slept)` with IRBridge faked and time.sleep captured, not actually slept."""
    real_bridge = irbridge_mod.IRBridge
    real_sleep = cli.time.sleep
    slept: list[float] = []
    FakeBridge.instances.clear()
    irbridge_mod.IRBridge = FakeBridge
    cli.time.sleep = lambda s: slept.append(s)
    try:
        fn(slept)
    finally:
        irbridge_mod.IRBridge = real_bridge
        cli.time.sleep = real_sleep


def _emit_capturing_stderr(*args, **kwargs) -> str:
    buf = io.StringIO()
    with contextlib.redirect_stderr(buf):
        cli._ir_emit(*args, **kwargs)
    return buf.getvalue()


# ---- the estimate string ---------------------------------------------------- #

def test_estimate_printed_before_emitting_when_repeat_over_1():
    def body(_slept):
        err = _emit_capturing_stderr("0" * 25, "COM8", 1000)
        assert "estimated run time ~150 s" in err
        # printed BEFORE the "emitting" line, not after
        assert err.index("estimated run time") < err.index("emitting")
        assert FakeBridge.instances[0].calls == [("0" * 25, 1000)]
    _with_fake_bridge_and_sleep(body)


def test_no_estimate_for_a_single_shot():
    def body(_slept):
        err = _emit_capturing_stderr("0" * 25, "COM8", 1)
        assert "estimated run time" not in err
    _with_fake_bridge_and_sleep(body)


def test_estimate_scales_with_repeat():
    def body(_slept):
        err = _emit_capturing_stderr("0" * 25, "COM8", 20)
        assert "estimated run time ~3 s" in err   # 20 * 0.15 = 3.0
    _with_fake_bridge_and_sleep(body)


# ---- --wait ------------------------------------------------------------------ #

def test_wait_sleeps_estimate_plus_one_and_reports_done():
    def body(slept):
        err = _emit_capturing_stderr("0" * 25, "COM8", 10, wait=True)
        assert slept == [10 * 0.15 + 1]     # 2.5
        assert "# emitter done" in err
    _with_fake_bridge_and_sleep(body)


def test_without_wait_never_sleeps():
    def body(slept):
        _emit_capturing_stderr("0" * 25, "COM8", 1000, wait=False)
        assert slept == []
    _with_fake_bridge_and_sleep(body)


def test_wait_on_single_shot_still_sleeps_and_reports_done():
    def body(slept):
        err = _emit_capturing_stderr("0" * 25, "COM8", 1, wait=True)
        assert slept == [1 * 0.15 + 1]      # 1.15
        assert "# emitter done" in err
    _with_fake_bridge_and_sleep(body)


# ---- CLI argument parsing: --wait may appear anywhere ------------------------- #

def _dispatch_capturing_ir_emit_call(argv: list[str]) -> tuple:
    """Run `_dispatch("ir-emit", argv)` with `_ir_emit` swapped for a recorder;
    returns the (bits, port, repeat, wait) tuple it was called with."""
    calls: list[tuple] = []
    real = cli._ir_emit
    cli._ir_emit = lambda bits, port, repeat, wait=False, gap_ms=None: calls.append(
        (bits, port, repeat, wait) if gap_ms is None else (bits, port, repeat, wait, gap_ms))
    try:
        cli._dispatch("ir-emit", argv)
    finally:
        cli._ir_emit = real
    assert len(calls) == 1, calls
    return calls[0]


def test_dispatch_wait_flag_trailing():
    got = _dispatch_capturing_ir_emit_call(["ir-emit", "101010", "COM8", "1000", "--wait"])
    assert got == ("101010", "COM8", 1000, True)


def test_dispatch_wait_flag_leading():
    got = _dispatch_capturing_ir_emit_call(["ir-emit", "--wait", "101010"])
    assert got == ("101010", None, 1, True)


def test_dispatch_wait_flag_between_positionals():
    got = _dispatch_capturing_ir_emit_call(["ir-emit", "101010", "--wait", "5"])
    assert got == ("101010", None, 5, True)


def test_dispatch_no_wait_flag_defaults_false():
    got = _dispatch_capturing_ir_emit_call(["ir-emit", "101010", "COM8", "5"])
    assert got == ("101010", "COM8", 5, False)


def test_dispatch_positional_parsing_unchanged_without_wait():
    # bits-only, no port/repeat given -- existing positional parsing must still work
    got = _dispatch_capturing_ir_emit_call(["ir-emit", "101010"])
    assert got == ("101010", None, 1, False)


# ---- F321: the TXN gap (2026-09-24) ---------------------------------------------------------------

def test_gap_reaches_the_bridge_and_sets_the_estimate():
    def run(slept):
        FakeBridge.ack = "SENT n=10 bits=25 gap=60"
        out = _emit_capturing_stderr("1" * 25, None, 10, wait=True, gap_ms=60)
        assert FakeBridge.instances[0].calls == [("1" * 25, 10, 60)]
        assert slept == [10 * (37 + 60) / 1000 + 1], slept   # words start (word + gap) apart
        assert "WARNING" not in out
    _with_fake_bridge_and_sleep(run)
    FakeBridge.ack = "ACK"


def test_gap_warns_when_the_board_runs_old_firmware():
    def run(slept):
        FakeBridge.ack = "SENT n=5 bits=28"   # no gap= : an old ir_emit.ino read the gap as bits
        out = _emit_capturing_stderr("1" * 25, None, 5, gap_ms=30)
        assert "older ir_emit.ino" in out
    _with_fake_bridge_and_sleep(run)
    FakeBridge.ack = "ACK"


def test_gap_out_of_bounds_is_refused_before_anything_is_sent():
    def run(slept):
        for bad in (-1, 10001):
            try:
                _emit_capturing_stderr("1" * 25, None, 5, gap_ms=bad)
            except SystemExit as e:
                assert "0-10000" in str(e)
            else:
                raise AssertionError(f"gap {bad} was accepted")
        assert FakeBridge.instances == []
    _with_fake_bridge_and_sleep(run)


def test_no_gap_keeps_todays_call_and_estimate():
    def run(slept):
        _emit_capturing_stderr("1" * 25, None, 4, wait=True)
        assert FakeBridge.instances[0].calls == [("1" * 25, 4)]
        assert slept == [4 * 0.15 + 1]
    _with_fake_bridge_and_sleep(run)


def test_bridge_builds_the_gap_command_and_bounds_it():
    import brx_mcp.irbridge as ib
    sent = []
    br = ib.IRBridge.__new__(ib.IRBridge)
    br._ser = type("S", (), {"write": lambda self, b: sent.append(b.decode())})()
    br._readlines = lambda t: ["SENT n=3 bits=25 gap=0"]
    assert "gap=0" in br.emit("1" * 25, 3, gap_ms=0)
    assert sent == [f"TXN 3 {'1' * 25} 0\n"]
    try:
        br.emit("1" * 25, 3, gap_ms=20000)
    except ValueError:
        pass
    else:
        raise AssertionError("gap 20000 was accepted")
    sent.clear()
    br.emit("1" * 25, 1)
    assert sent == [f"TX {'1' * 25}\n"], "no gap: today's command"


def test_dispatch_gap_anywhere_among_the_arguments():
    assert _dispatch_capturing_ir_emit_call(["ir-emit", "101010", "COM8", "10", "--gap", "60"]) == ("101010", "COM8", 10, False, 60)
    assert _dispatch_capturing_ir_emit_call(["ir-emit", "--gap", "0", "101010", "COM8", "5", "--wait"]) == ("101010", "COM8", 5, True, 0)


def test_dispatch_gap_without_a_number_is_refused():
    for argv in (["ir-emit", "101010", "COM8", "5", "--gap"], ["ir-emit", "101010", "--gap", "fast"]):
        try:
            cli._dispatch("ir-emit", argv)
        except SystemExit as e:
            assert "--gap" in str(e)
        else:
            raise AssertionError(f"{argv} was accepted")

