"""F538: `ir-emit` must read the emitter's ack and say when the board sent the wrong word.

`--repeat 4 --gap 600` landed 0/4 hits on 2026-10-16 while single shots landed 4/4. An `ir_emit.ino` older than
the TXN gap (c69206a21) reads the gap as more bits and sends a longer, garbled word, and its ack says so
(`bits=29` for a 25-bit word). The old host check could not tell that from a new board still mid-run.
Plain-function style (no pytest); the bridge is faked, so nothing here touches a serial port.
"""
import contextlib
import io

import brx_mcp.__main__ as cli
import brx_mcp.irbridge as irbridge_mod

WORD = "1111000000010000100000010"   # 25 bits


class _FakeBridge:
    ack = ""

    def __init__(self, port=None):
        self.port = port or "COM8"

    def emit(self, bits, repeat=1, gap_ms=None):
        return _FakeBridge.ack

    def close(self):
        pass


def _emit(ack, repeat=4, gap_ms=600):
    """Run `_ir_emit` against a board that answers `ack`. Returns (exit code or None, stderr)."""
    _FakeBridge.ack = ack
    real = irbridge_mod.IRBridge
    irbridge_mod.IRBridge = _FakeBridge
    out, err, code = io.StringIO(), io.StringIO(), None
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                cli._ir_emit(WORD, "COM8", repeat, gap_ms=gap_ms)
            except SystemExit as e:
                code = e.code if e.code is not None else 0
    finally:
        irbridge_mod.IRBridge = real
    return code, err.getvalue()


def test_a_board_that_read_the_gap_as_bits_fails_loudly():
    # the pre-c69206a21 firmware: "TXN 4 <word> 600" -> the word plus " 600" as four more marks
    code, err = _emit("SENT n=4 bits=29")
    assert code not in (None, 0), "a garbled word must fail the command"
    assert "29" in err and "25" in err and "reflash" in err.lower()


def test_a_wrong_bit_count_fails_without_a_gap_too():
    code, err = _emit("SENT bits=24", repeat=1, gap_ms=None)
    assert code not in (None, 0) and "24" in err


def test_a_good_gap_ack_passes_quietly():
    code, err = _emit("SENT n=1 bits=25 gap=600", repeat=1)
    assert code is None
    assert "WARNING" not in err and "reflash" not in err.lower()


def test_a_run_still_going_is_not_called_old_firmware():
    # 4 x (37 + 600) ms outlasts the 0.6 s ack read: no ack yet is not evidence of an old board
    code, err = _emit("")
    assert code is None
    assert "older" not in err.lower() and "reflash" not in err.lower()
    assert "no ack" in err.lower()


def test_an_ack_without_gap_echo_still_warns():
    code, err = _emit("SENT n=4 bits=25", repeat=4)
    assert "older ir_emit.ino" in err


def _bridge_reading(read_for):
    import brx_mcp.irbridge as ib
    br = ib.IRBridge.__new__(ib.IRBridge)
    br._ser = type("S", (), {"write": lambda self, b: None})()

    def readlines(secs, until=None):
        read_for.append(secs)
        return ["SENT n=1 bits=25 gap=600"]
    br._readlines = readlines
    return br


def test_a_gap_run_reads_long_enough_for_its_ack():
    # a new board acks after its last word and gap: one word at gap 600 acks at 637 ms, past a fixed 0.6 s read
    import brx_mcp.irbridge as ib
    read_for = []
    br = _bridge_reading(read_for)
    br.emit(WORD, 1, gap_ms=600)
    br.emit(WORD, 4, gap_ms=600)
    br.emit(WORD, 1000, gap_ms=600)
    one, four, flood = read_for
    assert one > (ib.WORD_MS + 600) / 1000, one
    assert four > 4 * (ib.WORD_MS + 600) / 1000, four
    assert flood <= ib.ACK_READ_MAX_S, flood   # a long flood still returns within the cap (the --wait contract)


def test_the_ack_read_stops_at_the_ack():
    import brx_mcp.irbridge as ib
    br = ib.IRBridge.__new__(ib.IRBridge)
    data = [b"SENT n=1 bits=25 gap=600\n"]

    class S:
        in_waiting = 0

        def read(self, n):
            return data.pop(0) if data else b""
    br._ser = S()
    import time
    t0 = time.monotonic()
    lines = br._readlines(2.0, until=lambda ln: ln.startswith(("SENT", "ERR")))
    assert lines == ["SENT n=1 bits=25 gap=600"]
    assert time.monotonic() - t0 < 1.0, "the read must stop at the ack, not run the whole window"
