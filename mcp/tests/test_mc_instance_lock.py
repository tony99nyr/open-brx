"""OP1 (maintainability review 2026-10-10, Critical): two Mission Controls on one laptop shared `~/.brx-mcp`, so each
overwrote the other's session.json, pieces.json and favourites.json with no warning. A non-ephemeral MC now holds an
exclusive lock on `<home>/mc.lock`; a second one exits 2 before it restores or writes anything."""
from __future__ import annotations

import os
import pathlib
import subprocess
import sys
import tempfile

MCP = pathlib.Path(__file__).resolve().parents[1]


def _env(home):
    return {**os.environ, "BRX_MCP_HOME": str(home), "PYTHONPATH": str(MCP)}


def test_a_second_holder_of_the_home_lock_exits_2_and_names_the_first():
    from brx_mcp.mc.__main__ import lock_home_or_exit
    home = pathlib.Path(tempfile.mkdtemp())
    held = lock_home_or_exit(home, port=8765)
    try:
        r = subprocess.run([sys.executable, "-c", "import pathlib,os;from brx_mcp.mc.__main__ import lock_home_or_exit;"
                            "lock_home_or_exit(pathlib.Path(os.environ['BRX_MCP_HOME']), port=9999)"],
                           env=_env(home), capture_output=True, text=True, timeout=60)
        assert r.returncode == 2, (r.returncode, r.stderr)
        assert str(os.getpid()) in r.stderr and "8765" in r.stderr, r.stderr
        assert "--ephemeral" in r.stderr and "BRX_MCP_HOME" in r.stderr, r.stderr
    finally:
        held.close()
    r = subprocess.run([sys.executable, "-c", "import pathlib,os;from brx_mcp.mc.__main__ import lock_home_or_exit;"
                        "lock_home_or_exit(pathlib.Path(os.environ['BRX_MCP_HOME']), port=9999)"],
                       env=_env(home), capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, ("control: free once the first holder is gone", r.stderr)


def test_a_second_mission_control_refuses_before_it_touches_the_session():
    from brx_mcp.mc.__main__ import lock_home_or_exit
    home = pathlib.Path(tempfile.mkdtemp())
    (home / "session.json").write_text('{"first": true}')
    held = lock_home_or_exit(home, port=8765)
    try:
        r = subprocess.run([sys.executable, "-m", "brx_mcp.mc", "--host", "127.0.0.1", "--port", "0", "--ws-port", "0",
                            "--no-auth"], env=_env(home), capture_output=True, text=True, timeout=120)
        assert r.returncode == 2, (r.returncode, r.stdout[-400:], r.stderr[-400:])
        assert "Another Mission Control" in r.stderr, ("refused by the lock, not by argparse or the bind", r.stderr[-400:])
        assert "Mission Control  http" not in r.stdout, "no banner from the refused MC"
        assert (home / "session.json").read_text() == '{"first": true}', "the first MC's session is untouched"
        # OP1 review: refused BEFORE build(), which would write its install secret, the trust file and the store dir
        assert sorted(x.name for x in home.iterdir()) == ["mc.lock", "mc.lock.info", "session.json"], sorted(home.iterdir())
    finally:
        held.close()


def test_demo_and_ephemeral_runs_take_no_lock():
    from brx_mcp.mc.__main__ import needs_home_lock, parser
    assert needs_home_lock(parser().parse_args([]))
    assert not needs_home_lock(parser().parse_args(["--demo"]))
    assert not needs_home_lock(parser().parse_args(["--ephemeral"]))


def test_a_lock_error_that_is_not_contention_is_reported_as_itself():
    """OP1 review: a permission or filesystem error is not "another Mission Control", and must not name a stale owner."""
    import errno
    import io
    import contextlib as _cl
    if sys.platform == "win32":
        return
    import fcntl
    from brx_mcp.mc import __main__ as M
    home = pathlib.Path(tempfile.mkdtemp())
    (home / "mc.lock.info").write_text('{"pid": 4242, "port": 1234}')
    real = fcntl.flock
    def broken(fd, op):
        raise OSError(next(codes), "refused")
    codes = iter([errno.EIO, errno.EACCES])
    fcntl.flock = broken
    try:
        for _ in range(2):   # EIO, then EACCES (a security policy on POSIX, not a holder: OP1 r2)
            err = io.StringIO()
            with _cl.redirect_stderr(err):
                try:
                    M.lock_home_or_exit(home, port=1)
                    raise AssertionError("expected an exit")
                except SystemExit as e:
                    assert e.code == 2, e.code
            assert "4242" not in err.getvalue() and "Another Mission Control" not in err.getvalue(), err.getvalue()
            assert "could not lock" in err.getvalue(), err.getvalue()
    finally:
        fcntl.flock = real


def test_a_home_that_cannot_hold_the_lock_file_exits_2_with_its_reason():
    """OP1 review: a read-only or missing home is a clean exit 2 naming the problem, not a traceback."""
    import io
    import contextlib as _cl
    from brx_mcp.mc.__main__ import lock_home_or_exit
    blocker = pathlib.Path(tempfile.mkdtemp()) / "a-file"
    blocker.write_text("not a folder")
    err = io.StringIO()
    with _cl.redirect_stderr(err):
        try:
            lock_home_or_exit(blocker / "home", port=1)
            raise AssertionError("expected an exit")
        except SystemExit as e:
            assert e.code == 2, e.code
    assert "could not lock" in err.getvalue(), err.getvalue()


def test_the_lock_outlives_main_returning_until_the_process_ends():
    """OP1 review r3: `main()` held the handle in a local, so when uvicorn returned the lock was freed BEFORE the atexit
    `persist_now` wrote session.json; a second MC could take it during that final write. It is held for the process."""
    import gc
    from brx_mcp.mc import __main__ as M
    home = pathlib.Path(tempfile.mkdtemp())
    M.hold_home_lock(home, port=8765)   # what main() calls; returns nothing for the caller to drop
    gc.collect()
    try:
        r = subprocess.run([sys.executable, "-c", "import pathlib,os;from brx_mcp.mc.__main__ import lock_home_or_exit;"
                            "lock_home_or_exit(pathlib.Path(os.environ['BRX_MCP_HOME']), port=9999)"],
                           env=_env(home), capture_output=True, text=True, timeout=60)
        assert r.returncode == 2, ("the lock went with the caller's frame", r.returncode, r.stderr)
    finally:
        M._HOME_LOCK.close()
        M._HOME_LOCK = None
