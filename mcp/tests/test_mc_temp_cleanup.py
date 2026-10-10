"""OP10 (maintainability review 2026-10-10): every --demo or --ephemeral MC boot made three or four `brx-mc-*` temp
folders (tunnel pidfile, store, pieces, favourites) and nothing removed them: 44,461 folders on the dev box. They now
share one scratch folder per build() that the server's shutdown removes (atexit too, as a backup; SIGTERM skips atexit)."""
from __future__ import annotations

import os
import pathlib
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

from _skip import needs

MCP = pathlib.Path(__file__).resolve().parents[1]
try:
    import uvicorn  # noqa: F401
    HAVE = True
except Exception:
    HAVE = False


def _port() -> int:
    with socket.socket() as so:
        so.bind(("127.0.0.1", 0))
        return so.getsockname()[1]


def _leftovers(sig) -> list[str]:
    import shutil
    root = pathlib.Path(tempfile.mkdtemp())
    tmp, home = root / "tmp", root / "home"
    tmp.mkdir(); home.mkdir()
    port = _port()
    env = {**os.environ, "TMPDIR": str(tmp), "BRX_MCP_HOME": str(home), "PYTHONPATH": str(MCP)}
    p = subprocess.Popen([sys.executable, "-m", "brx_mcp.mc", "--demo", "--fake-net", "--no-auth", "--host", "127.0.0.1",
                          "--port", str(port), "--ws-port", str(_port())], env=env,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        end = time.monotonic() + 60
        while True:
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state", timeout=5).read()
                break
            except Exception:
                if time.monotonic() > end or p.poll() is not None:
                    raise AssertionError("control: MC never came up")
                time.sleep(0.2)
        assert [x for x in tmp.iterdir() if x.name.startswith("brx-mc-")], "control: the running MC uses scratch"
        p.send_signal(sig)
        p.wait(timeout=30)
        return sorted(x.name for x in tmp.iterdir() if x.name.startswith("brx-mc-"))
    finally:
        if p.poll() is None:
            p.kill()
        shutil.rmtree(root, ignore_errors=True)


def test_a_demo_mc_stopped_by_sigterm_leaves_no_temp_folder():
    needs(HAVE, "uvicorn")
    needs(os.name != "nt", "POSIX signals")
    assert _leftovers(signal.SIGTERM) == []


def test_a_demo_mc_stopped_by_sigint_leaves_no_temp_folder():
    needs(HAVE, "uvicorn")
    needs(os.name != "nt", "POSIX signals")
    assert _leftovers(signal.SIGINT) == []


def test_each_build_gets_its_own_scratch_and_a_persistent_build_none():
    """OP10 review (Codex r1, Medium): the scratch folder was module-level, so a second `build()` in one interpreter
    shared the first's, and a persistent build carried a demo's path for its shutdown to delete."""
    needs(HAVE, "uvicorn")
    import shutil
    from brx_mcp.mc.__main__ import build, parser
    old, old_tmp = os.environ.get("BRX_MCP_HOME"), tempfile.tempdir
    root = pathlib.Path(tempfile.mkdtemp())
    os.environ["BRX_MCP_HOME"] = str(root / "home")
    tempfile.tempdir = str(root)   # the builds' scratch folders land here, and go with it (run_tests skips atexit)
    try:
        a, _n1, _x1 = build(parser().parse_args(["--demo", "--fake-net", "--no-auth"]))
        b, _n2, _x2 = build(parser().parse_args(["--demo", "--fake-net", "--no-auth"]))
        c, _n3, _x3 = build(parser().parse_args(["--fake-net", "--no-auth"]))
        assert a.scratch_dir and b.scratch_dir and a.scratch_dir != b.scratch_dir, (a.scratch_dir, b.scratch_dir)
        assert c.scratch_dir is None, "a persistent build has no throwaway folder"
        for s in (a, b, c):
            if s.store:
                s.store.close()   # Codex r2: an open SQLite file blocks the rmtree below on Windows
    finally:
        tempfile.tempdir = old_tmp
        if old is None:
            os.environ.pop("BRX_MCP_HOME", None)
        else:
            os.environ["BRX_MCP_HOME"] = old
        shutil.rmtree(root, ignore_errors=True)
