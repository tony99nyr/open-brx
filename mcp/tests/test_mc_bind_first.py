"""F108: MC binds its HTTP port before it prints the banner, so a busy port never looks like a success.

Run: python3 run_tests.py mc_bind_first
"""
import contextlib
import io
import socket

from brx_mcp.mc.__main__ import bind_http_or_exit


def _busy():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0)); s.listen(1)
    return s


def test_a_busy_port_exits_non_zero_with_one_clear_line():
    held = _busy()
    port = held.getsockname()[1]
    err = io.StringIO()
    try:
        with contextlib.redirect_stderr(err):
            try:
                bind_http_or_exit("127.0.0.1", port)
                raise AssertionError("bound a port another process holds")
            except SystemExit as e:
                assert e.code == 2
    finally:
        held.close()
    assert f"could not bind 127.0.0.1:{port}" in err.getvalue() and "--port" in err.getvalue(), err.getvalue()


def test_a_free_port_is_bound_and_listening_for_uvicorn():
    probe = _busy(); port = probe.getsockname()[1]; probe.close()
    sock = bind_http_or_exit("127.0.0.1", port)
    try:
        c = socket.create_connection(("127.0.0.1", port), timeout=2)   # the kernel accepts into the backlog
        c.close()
    finally:
        sock.close()
