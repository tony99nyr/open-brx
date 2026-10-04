"""F376: `ir-emit --help` must print usage and never transmit; bad input is refused.

Before the fix `--help` was read as the bit string and fired a live IR frame.
Plain-function style (no pytest) so `run_tests.py` runs it under system python.
`_ir_emit` and `IRBridge` are both faked: nothing here touches a serial port.
"""
import contextlib
import io

import brx_mcp.__main__ as cli
import brx_mcp.irbridge as irbridge_mod


class _Boom:
    """Any construction of the real bridge is a failure: it would open a port."""

    def __init__(self, *a, **k):
        raise AssertionError("IRBridge was constructed: the transmit path ran")


def _run(argv):
    """Dispatch `ir-emit argv` with the transmit path faked.
    Returns (calls to _ir_emit, exit code or None, stdout, stderr)."""
    calls: list[tuple] = []
    real_emit, real_bridge = cli._ir_emit, irbridge_mod.IRBridge
    cli._ir_emit = lambda *a, **k: calls.append((a, k))
    irbridge_mod.IRBridge = _Boom
    out, err, code = io.StringIO(), io.StringIO(), None
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                cli._dispatch("ir-emit", ["ir-emit", *argv])
            except SystemExit as e:
                code = e.code if e.code is not None else 0
    finally:
        cli._ir_emit, irbridge_mod.IRBridge = real_emit, real_bridge
    return calls, code, out.getvalue(), err.getvalue()


def test_help_prints_usage_and_never_transmits():
    for flag in ("--help", "-h"):
        calls, code, out, err = _run([flag])
        assert calls == [], f"{flag} reached the transmit path"
        assert code == 0, f"{flag} exit code {code!r}"
        assert "usage" in (out + err).lower()


def test_help_among_other_arguments_never_transmits():
    calls, code, _out, _err = _run(["101010", "COM8", "--help"])
    assert calls == [] and code == 0


def test_non_bit_strings_are_refused_without_transmitting():
    for bad in ("abc", "012", "--foo", "", "1 0", "10x", "0x1F"):
        calls, code, _out, _err = _run([bad])
        assert calls == [], f"{bad!r} reached the transmit path"
        assert code not in (None, 0), f"{bad!r} exited {code!r}"


def test_unknown_option_after_valid_bits_is_refused():
    calls, code, _o, _e = _run(["101010", "--foo"])
    assert calls == [] and code not in (None, 0)


def test_valid_bit_string_still_transmits():
    calls, code, _o, _e = _run(["1111000000010000100000010", "COM8", "3", "--gap", "60", "--wait"])
    assert code is None
    assert calls == [(("1111000000010000100000010", "COM8", 3), {"wait": True, "gap_ms": 60})]


def test_bits_alone_use_defaults():
    calls, code, _o, _e = _run(["0101"])
    assert code is None
    assert calls == [(("0101", None, 1), {"wait": False, "gap_ms": None})]
