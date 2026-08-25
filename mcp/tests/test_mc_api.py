"""API route smoke via starlette TestClient (skips cleanly when starlette/httpx are absent)."""
try:
    from starlette.testclient import TestClient
    import httpx  # noqa: F401
    HAVE = True
except Exception:
    HAVE = False


def _client():
    from brx_mcp.mc.api import create_app
    from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
    from brx_mcp.mc.state import Session
    net = FakeNet()
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()))
    return TestClient(create_app(s)), s, net


def test_state_and_modes_and_weapons():
    if not HAVE:
        return
    c, s, net = _client()
    r = c.get("/api/state"); assert r.status_code == 200 and r.json()["phase"] == "muster"
    assert len(c.get("/api/modes").json()) == 5 and len(c.get("/api/weapons").json()) == 18


def test_player_flow_and_errors():
    if not HAVE:
        return
    c, s, net = _client()
    assert c.put("/api/config", json={"mode": "ffa", "time_limit_s": 300}).json()["ok"]
    p = c.post("/api/players", json={"display": "reaper", "gun_id": "GUN-A"}).json()
    assert p["display"] == "REAPER" and p["player_num"] == 1
    assert c.patch(f"/api/players/{p['player_id']}", json={"player_num": 0}).status_code == 400
    assert c.post("/api/lobby/push").status_code == 400            # no node → red → refused
    assert c.post("/api/control", json={"cmd": "panic"}).status_code == 400
    assert c.get("/api/recap").status_code == 404
    assert c.delete(f"/api/players/{p['player_id']}").json()["ok"]


def test_ui_ws_snapshot():
    if not HAVE:
        return
    c, s, net = _client()
    with c.websocket_connect("/ui-ws") as ws:
        msg = ws.receive_json()
        assert msg["kind"] == "snapshot" and "readiness" in msg["state"]
