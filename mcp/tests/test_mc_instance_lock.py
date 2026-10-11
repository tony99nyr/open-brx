"""OP1 (maintainability review 2026-10-10, Critical): two Mission Controls on one laptop shared `~/.brx-mcp`, so each
overwrote the other's session.json, pieces.json and favourites.json with no warning. A non-ephemeral MC now holds an
exclusive lock on `<home>/mc.lock`; a second one exits 2 before it restores or writes anything."""
from __future__ import annotations

from _skip import needs

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


def _no_locking(fn):
    """Run `fn` with flock (and msvcrt.locking) failing as a filesystem without locks does (ENOLCK)."""
    import errno

    def refuse(*_a, **_k):
        raise OSError(errno.ENOLCK, "No locks available")
    mod = __import__("msvcrt") if sys.platform == "win32" else __import__("fcntl")
    name = "locking" if sys.platform == "win32" else "flock"
    real = getattr(mod, name)
    setattr(mod, name, refuse)
    try:
        return fn()
    finally:
        setattr(mod, name, real)


def test_a_home_on_a_filesystem_without_locks_falls_back_to_an_exclusive_pid_file():
    """Round 2 L1: NFS and some SMB or FUSE mounts cannot lock; MC used to exit 2 there. It now takes `mc.lock.pid`
    with O_EXCL and a warning; a live other owner in it still refuses, a dead one's is taken over."""
    import contextlib
    import io
    import json
    import brx_mcp.mc.__main__ as M
    home = pathlib.Path(tempfile.mkdtemp())
    err = io.StringIO()
    try:
        with contextlib.redirect_stderr(err):
            try:
                _no_locking(lambda: M.lock_home_or_exit(home, port=8765))
            except SystemExit as e:
                raise AssertionError(f"a home that cannot lock refused MC (exit {e.code}): {err.getvalue()}") from None
        assert "cannot lock files" in err.getvalue(), err.getvalue()
        assert json.loads((home / "mc.lock.pid").read_text())["pid"] == os.getpid()
        # a live OTHER owner (our parent) is a refusal
        (home / "mc.lock.pid").write_text(json.dumps({"pid": os.getppid(), "port": 9000}))
        with contextlib.redirect_stderr(io.StringIO()):
            try:
                _no_locking(lambda: M.lock_home_or_exit(home, port=8765))
            except SystemExit as e:
                assert e.code == 2
            else:
                raise AssertionError("a live other owner in mc.lock.pid must refuse")
        # a dead owner's file is taken over
        (home / "mc.lock.pid").write_text(json.dumps({"pid": 2 ** 22 + 7, "port": 9000}))
        with contextlib.redirect_stderr(io.StringIO()):
            _no_locking(lambda: M.lock_home_or_exit(home, port=8765))
        assert json.loads((home / "mc.lock.pid").read_text())["pid"] == os.getpid()
    finally:
        M._PID_FILE = None


def test_a_relaunch_waits_for_a_stopping_holder_and_refuses_a_running_one():
    """Round 2 L3: the old MC keeps its lock until its process exits (the tunnel's stop and the atexit flush can still
    write session.json), but marks itself stopping; a new MC waits for that holder instead of exiting 2 at once.
    The child SAYS it is waiting (Opus r1: proving it merely alive after a sleep passed without the wait)."""
    import threading
    import brx_mcp.mc.__main__ as M
    home = pathlib.Path(tempfile.mkdtemp())
    held = M.lock_home_or_exit(home, port=8765)
    try:
        M._write_lock_info(home, 8765, stopping=True)
        child = subprocess.Popen([sys.executable, "-c", "import pathlib,os;from brx_mcp.mc.__main__ import lock_home_or_exit;"
                                  "lock_home_or_exit(pathlib.Path(os.environ['BRX_MCP_HOME']), port=9999)"],
                                 env=_env(home), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        first = []
        reader = threading.Thread(target=lambda: first.append(child.stderr.readline()), daemon=True)
        reader.start()
        try:
            reader.join(60)
            assert first and first[0].startswith("Waiting for the Mission Control that is stopping"), first
            assert child.poll() is None, "it must still be waiting"
            held.close()                 # the old process exits
            out, errs = child.communicate(timeout=60)
            assert child.returncode == 0, errs
        finally:
            if child.poll() is None:
                child.kill()
    finally:
        held.close()


def test_a_holder_still_stopping_at_the_deadline_is_named_as_stuck():
    import contextlib
    import io
    import brx_mcp.mc.__main__ as M
    home = pathlib.Path(tempfile.mkdtemp())
    held = M.lock_home_or_exit(home, port=8765)
    try:
        M._write_lock_info(home, 8765, stopping=True)
        r = subprocess.run([sys.executable, "-c", "import pathlib,os;from brx_mcp.mc.__main__ import lock_home_or_exit;"
                            "lock_home_or_exit(pathlib.Path(os.environ['BRX_MCP_HOME']), port=9999, wait_s=0.5)"],
                           env=_env(home), capture_output=True, text=True, timeout=60)
        assert r.returncode == 2 and "is still stopping after" in r.stderr, r.stderr
    finally:
        held.close()


def test_an_unreadable_pid_file_is_held_not_taken_and_the_refusal_names_it():
    """Opus r1: a launch that read the pid file before its owner wrote it saw it empty, called the owner dead and took
    it over. The file now appears whole (a hard link from a finished temp file), and an unreadable one is refused."""
    import contextlib
    import io
    import brx_mcp.mc.__main__ as M
    home = pathlib.Path(tempfile.mkdtemp())
    (home / "mc.lock.pid").write_text("")
    err = io.StringIO()
    try:
        with contextlib.redirect_stderr(err):
            _no_locking(lambda: M.lock_home_or_exit(home, port=8765))
    except SystemExit as e:
        assert e.code == 2
    else:
        raise AssertionError("an unreadable pid file must not be taken over")
    finally:
        M._PID_FILE = None
    assert "delete" in err.getvalue() and "mc.lock.pid" in err.getvalue(), err.getvalue()
    assert (home / "mc.lock.pid").read_text() == "", "the file was left alone"
    assert not list(home.glob("mc.lock.pid.*.tmp")), "the temp file is cleaned up"


def test_the_lifespan_marks_the_home_stopping_after_the_snapshot_and_keeps_the_lock():
    """Round 2 L3: the mark comes after the first snapshot write and before the tunnel's stop; nothing frees the lock."""
    try:
        import starlette  # noqa: F401
        have = True
    except ImportError:
        have = False
    needs(have, "starlette")      # CI's system-python pass has none
    import asyncio
    from brx_mcp.mc.api import create_app
    from _session import mk_session
    s = mk_session()[0]
    order = []

    class _Tunnel:
        async def shutdown(self):
            order.append("tunnel")
    s.tunnel = _Tunnel()
    s.persist_now = lambda: order.append("persist")
    app = create_app(s)
    app.state.mark_home_stopping = lambda: order.append("stopping")

    async def run():
        ctx = app.router.lifespan_context(app)
        await ctx.__aenter__()
        await ctx.__aexit__(None, None, None)
    asyncio.run(run())
    assert order[0] == "persist" and order[1] == "stopping" and order[-1] == "tunnel", order
