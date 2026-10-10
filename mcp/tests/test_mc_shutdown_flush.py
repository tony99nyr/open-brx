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


def _req(method, url, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers={"content-type": "application/json", **(headers or {})})
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
        for attempt in range(3):   # the second edit must land INSIDE the debounce, or the test proves nothing
            _req("PUT", base + "/api/config", {"time_limit_s": 777})
            time.sleep(0.2)
            _req("PUT", base + "/api/config", {"time_limit_s": 778})
            time.sleep(0.3)
            if json.loads((home / "session.json").read_text())["config"]["time_limit_s"] == 777:
                break
            time.sleep(2.5)
        else:
            raise AssertionError("control: the second edit never stayed inside the debounce (a loaded box)")
        if sig == "route":
            assert _req("POST", base + "/api/shutdown", headers={"X-BRX-Shutdown": "1"}) is not None
            assert p.wait(timeout=30) == 0, "a requested stop exits 0"
        else:
            p.send_signal(sig)
            p.wait(timeout=30)
        return json.loads((home / "session.json").read_text())["config"]["time_limit_s"]
    finally:
        if p.poll() is None:
            p.kill()
        import shutil
        shutil.rmtree(home, ignore_errors=True)


def test_sigterm_keeps_the_last_edit():
    needs(HAVE, "uvicorn/starlette")
    needs(os.name != "nt", "POSIX signals")
    assert _run(signal.SIGTERM) == 778


def test_sighup_keeps_the_last_edit():
    """brx2's launcher review (2026-10-10): closing the terminal sends SIGHUP to the whole process group, and Python's
    default action killed MC at once, with no graceful shutdown and so no flush. MC treats SIGHUP like SIGTERM now."""
    needs(HAVE, "uvicorn/starlette")
    needs(os.name != "nt", "POSIX signals")
    assert _run(signal.SIGHUP) == 778


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
    H = {"X-BRX-Shutdown": "1"}
    assert c.post("/api/shutdown", headers=H).status_code == 401 and not asked
    assert c.post("/api/shutdown", headers={**H, "Authorization": "Bearer op-token"}).status_code == 202 and asked == [True]
    assert c.post("/api/shutdown?tok=op-token", headers=H).status_code == 202


def test_shutdown_route_with_auth_off_answers_loopback_only():
    needs(HAVE, "uvicorn/starlette")
    from starlette.testclient import TestClient
    app, asked = _app(None)
    H = {"X-BRX-Shutdown": "1"}
    assert TestClient(app, client=("192.168.0.20", 5000)).post("/api/shutdown", headers=H).status_code == 403 and not asked
    assert TestClient(app, client=("127.0.0.1", 5000)).post("/api/shutdown", headers=H).status_code == 202 and asked == [True]
    assert TestClient(app, client=("::1", 5000)).post("/api/shutdown", headers=H).status_code == 202


def test_shutdown_route_refuses_a_plain_form_post():
    """Sig review (Codex r1, High): with --no-auth a web page on the operator's laptop could submit a cross-origin form to
    127.0.0.1 and stop MC. A form cannot set a custom header, and a cross-origin fetch that sets one needs a CORS
    preflight MC never grants, so the route requires `X-BRX-Shutdown: 1`."""
    needs(HAVE, "uvicorn/starlette")
    from starlette.testclient import TestClient
    app, asked = _app(None)
    r = TestClient(app, client=("127.0.0.1", 5000)).post("/api/shutdown", data={"x": "1"})
    assert r.status_code == 400 and not asked, r.status_code


def test_shutdown_route_stops_mc_with_exit_0_and_keeps_the_last_edit():
    """Note: a requested stop returns from `main()` normally, so atexit would also flush here; only the SIGTERM case
    above proves the lifespan's own flush (Opus r1)."""
    needs(HAVE, "uvicorn/starlette")
    assert _run("route") == 778


def test_the_snapshot_is_written_before_a_slow_tunnel_stops():
    """brx2's launcher review (2026-10-10): the lifespan awaited `tunnel.shutdown()` (terminate, up to 3 s, kill, up to
    3 s more) BEFORE the snapshot write, so a stopper with less patience killed MC with the last edit unwritten. The
    snapshot and the store go first now; the tunnel holds no session state."""
    needs(HAVE, "uvicorn/starlette")
    from starlette.testclient import TestClient
    from brx_mcp.mc.api import create_app
    from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
    from brx_mcp.mc.state import Session
    order: list[str] = []

    class _SlowTunnel:
        async def shutdown(self):
            order.append("tunnel")

    class _Store:
        def close(self):
            order.append("store closed")

    class _Net(FakeNet):
        async def stop(self):
            order.append("node socket closed")

    s = Session(FakeCompiler(), _Net(), FakeArmory(demo_armory()))
    s.tunnel = _SlowTunnel()
    s.store = _Store()
    s.persist_now = lambda: order.append("snapshot")
    with TestClient(create_app(s, token=None)):
        pass
    # Opus r1: the node socket closes first, so no fact can be acked after the store has closed
    assert order == ["node socket closed", "snapshot", "store closed", "tunnel"], order


def test_an_mc_started_under_nohup_ignores_sighup():
    """Codex r1: `nohup` (and the runbooks' `setsid nohup`) hands MC an ignored SIGHUP, meaning "keep running"."""
    needs(HAVE, "uvicorn/starlette")
    needs(os.name != "nt", "POSIX signals")
    home = pathlib.Path(tempfile.mkdtemp())
    port, ws = _free_port(), _free_port()
    env = {**os.environ, "BRX_MCP_HOME": str(home), "PYTHONPATH": str(MCP)}
    p = subprocess.Popen([sys.executable, "-m", "brx_mcp.mc", "--host", "127.0.0.1", "--port", str(port),
                          "--ws-port", str(ws), "--fake-net", "--no-auth"], env=env,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         preexec_fn=lambda: signal.signal(signal.SIGHUP, signal.SIG_IGN))
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
        p.send_signal(signal.SIGHUP)
        end = time.monotonic() + 3
        while time.monotonic() < end:          # a stopping MC exits well inside this window (the SIGHUP test shows it)
            assert p.poll() is None, "an MC started under nohup stopped on SIGHUP"
            time.sleep(0.1)
        _req("GET", base + "/api/state")       # and it still answers
    finally:
        if p.poll() is None:
            p.kill()
            p.wait(timeout=10)
        import shutil
        shutil.rmtree(home, ignore_errors=True)
