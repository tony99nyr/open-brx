"""SIGTERM persistence (OP1 review side finding, 2026-10-10): uvicorn answers SIGTERM with a graceful shutdown and then
re-raises the signal, so the process dies before `atexit` runs, and `atexit` was where MC flushed its debounced
session snapshot. `scripts/mc.mjs` stops MC with SIGTERM, so the last edits (up to the 2 s debounce) were lost. The
server's own shutdown (the lifespan) now writes the snapshot."""
from __future__ import annotations

import json
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
    import starlette  # noqa: F401
    HAVE = True
except Exception:
    HAVE = False


def _free_port() -> int:
    with socket.socket() as so:
        so.bind(("127.0.0.1", 0))
        return so.getsockname()[1]


def _req(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers={"content-type": "application/json"})
    with urllib.request.urlopen(r, timeout=10) as resp:
        return resp.read()


def _run(sig) -> int:
    home = pathlib.Path(tempfile.mkdtemp())
    port, ws = _free_port(), _free_port()
    env = {**os.environ, "BRX_MCP_HOME": str(home), "PYTHONPATH": str(MCP)}
    p = subprocess.Popen([sys.executable, "-m", "brx_mcp.mc", "--host", "127.0.0.1", "--port", str(port),
                          "--ws-port", str(ws), "--fake-net", "--no-auth"], env=env,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        base = f"http://127.0.0.1:{port}"
        end = time.monotonic() + 60
        while True:
            try:
                _req("GET", base + "/api/state")
                break
            except Exception:
                if time.monotonic() > end or p.poll() is not None:
                    raise AssertionError("control: MC never came up")
                time.sleep(0.2)
        time.sleep(2.5)                                    # past every start-up write
        _req("PUT", base + "/api/config", {"time_limit_s": 777})
        time.sleep(0.2)
        _req("PUT", base + "/api/config", {"time_limit_s": 778})   # inside the 2 s debounce
        time.sleep(0.3)
        if sig == "route":
            assert _req("POST", base + "/api/shutdown") is not None
            assert p.wait(timeout=30) == 0, "a requested stop exits 0"
        else:
            p.send_signal(sig)
            p.wait(timeout=30)
        return json.loads((home / "session.json").read_text())["config"]["time_limit_s"]
    finally:
        if p.poll() is None:
            p.kill()


def test_sigterm_keeps_the_last_edit():
    needs(HAVE, "uvicorn/starlette")
    needs(os.name != "nt", "POSIX signals")
    assert _run(signal.SIGTERM) == 778


def test_sigint_keeps_the_last_edit():
    needs(HAVE, "uvicorn/starlette")
    needs(os.name != "nt", "POSIX signals")
    assert _run(signal.SIGINT) == 778


def _app(token):
    from starlette.testclient import TestClient  # noqa: F401
    from brx_mcp.mc.api import create_app
    from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
    from brx_mcp.mc.state import Session
    s = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    app = create_app(s, token=token)
    asked = []
    app.state.request_shutdown = lambda: asked.append(True)
    return app, asked


def test_shutdown_route_needs_the_operator_token():
    """POST /api/shutdown (brx2's launcher contract, 2026-10-10): a graceful stop the Windows launcher can ask for,
    since Node's kill() there is a hard TerminateProcess. Gated like every write."""
    needs(HAVE, "uvicorn/starlette")
    from starlette.testclient import TestClient
    app, asked = _app("op-token")
    c = TestClient(app)
    assert c.post("/api/shutdown").status_code == 401 and not asked
    assert c.post("/api/shutdown", headers={"Authorization": "Bearer op-token"}).status_code == 202 and asked == [True]
    assert c.post("/api/shutdown?tok=op-token").status_code == 202


def test_shutdown_route_with_auth_off_answers_loopback_only():
    needs(HAVE, "uvicorn/starlette")
    from starlette.testclient import TestClient
    app, asked = _app(None)
    assert TestClient(app, client=("192.168.0.20", 5000)).post("/api/shutdown").status_code == 403 and not asked
    assert TestClient(app, client=("127.0.0.1", 5000)).post("/api/shutdown").status_code == 202 and asked == [True]
    assert TestClient(app, client=("::1", 5000)).post("/api/shutdown").status_code == 202


def test_shutdown_route_stops_mc_with_exit_0_and_keeps_the_last_edit():
    needs(HAVE, "uvicorn/starlette")
    assert _run("route") == 778
