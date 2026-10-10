"""OP10 (maintainability review 2026-10-10): every --demo or --ephemeral MC boot made three or four `brx-mc-*` temp
folders (tunnel pidfile, store, pieces, favourites) and nothing removed them: 44,461 folders on the dev box. They now
share one per-process scratch folder that the server's shutdown removes (atexit too, as a backup; SIGTERM skips atexit)."""
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
    tmp = pathlib.Path(tempfile.mkdtemp())
    home = pathlib.Path(tempfile.mkdtemp())
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


def test_a_demo_mc_stopped_by_sigterm_leaves_no_temp_folder():
    needs(HAVE, "uvicorn")
    needs(os.name != "nt", "POSIX signals")
    assert _leftovers(signal.SIGTERM) == []


def test_a_demo_mc_stopped_by_sigint_leaves_no_temp_folder():
    needs(HAVE, "uvicorn")
    needs(os.name != "nt", "POSIX signals")
    assert _leftovers(signal.SIGINT) == []
