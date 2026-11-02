"""A WebSocket that reaches the CONSOLE port (8765) on any path but /ui-ws closes cleanly.

Bench 2026-09-24: while a utility phone connected, MC logged 8 x "Exception in ASGI application ...
starlette/staticfiles.py ... assert scope['type'] == 'http'". A node socket had dialled the console
port, fell through to the `Mount("/", StaticFiles)` catch-all, and StaticFiles asserts on a websocket
scope. MC now refuses such a socket before accept (F659: a client never sees an open) with 4404 and a reason that names the node URL.

Run: python3 run_tests.py mc_console_port_ws
"""
import tempfile
from pathlib import Path

from _skip import needs
from _session import mc_session

try:
    from starlette.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect
    import httpx  # noqa: F401
    HAVE_HTTP = True
except Exception:
    HAVE_HTTP = False


def _client(with_dist: bool):
    """A console app whose static mount is present (`with_dist`) or absent, independent of the real
    webapp/mc/dist, so the test covers both builder branches on any checkout."""
    from brx_mcp.mc import api
    s = mc_session()
    s.lan["ws_url"] = "ws://10.0.0.5:8766/ws"
    saved = api.UI_DIST
    tmp = tempfile.TemporaryDirectory()
    try:
        dist = Path(tmp.name) / ("dist" if with_dist else "missing")
        if with_dist:
            dist.mkdir()
            (dist / "index.html").write_text("<html>console</html>")
        api.UI_DIST = dist
        app = api.create_app(s)
    finally:
        api.UI_DIST = saved
    return TestClient(app, raise_server_exceptions=True), tmp


def _closed_with(c, path):
    """The (code, reason) of a refused upgrade. F659: the refusal must come BEFORE accept, so the client never sees an
    open (a probe counts an open as a live MC). Entering the context is the handshake: it must raise."""
    try:
        ws_cm = c.websocket_connect(path)
        ws = ws_cm.__enter__()
    except WebSocketDisconnect as e:
        return e.code, e.reason
    try:
        ws.receive_text()
    except WebSocketDisconnect as e:
        raise AssertionError(f"{path}: accepted, then closed {e.code}: a client saw an open")
    finally:
        ws_cm.__exit__(None, None, None)
    raise AssertionError(f"{path}: the socket stayed open")


def test_a_node_socket_on_the_console_port_closes_with_a_reason():
    needs(HAVE_HTTP, "starlette + httpx")
    for with_dist in (True, False):
        c, tmp = _client(with_dist)
        with tmp:
            for path in ("/", "/node", "/ws", "/assets/x.js"):
                code, reason = _closed_with(c, path)
                assert code == 4404, (with_dist, path, code, reason)
                assert "console port" in reason and "ws://10.0.0.5:8766/ws" in reason, reason
            if with_dist:
                r = c.get("/")
                assert r.status_code == 200 and "console" in r.text, "the static mount still serves http"


def test_ui_ws_still_serves_the_snapshot():
    needs(HAVE_HTTP, "starlette + httpx")
    c, tmp = _client(True)
    with tmp, c.websocket_connect("/ui-ws") as ws:
        msg = ws.receive_json()
        assert msg["kind"] == "snapshot", msg
