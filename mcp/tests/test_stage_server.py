"""GUN STAGE HTTP front (skips cleanly when starlette/httpx are absent)."""
from _skip import needs

try:
    from starlette.testclient import TestClient
    HAVE = True
except Exception:   # pragma: no cover
    HAVE = False

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage.stage import GunStage


def _client():
    from brx_mcp.stage.server import create_app
    mgr = FakeConnectionManager([FakeTagger("FA:KE:00:00:00:01", "FAKE-STAGE", team=1)])
    return TestClient(create_app(GunStage(mgr, None)))


def test_page_state_and_actions():
    needs(HAVE, "starlette + httpx")
    with _client() as c:
        assert c.get("/").status_code == 200 and "GUN STAGE" in c.get("/").text
        s = c.get("/api/state").json()
        assert s["link"]["connected"] is False and s["events"] and s["profile"]["gun"] == "team"
        r = c.post("/api/do", json={"action": "connect", "address": "FA:KE:00:00:00:01"}).json()
        assert r["link"]["connected"] is True
        r = c.post("/api/do", json={"action": "set_profile", "preset": "counter_strike"}).json()
        assert r["summary"]["preset"] == "counter_strike"
        r = c.post("/api/do", json={"action": "set_profile", "gun": "health"}).json()
        assert r["profile"]["gun"] == "health" and r["summary"]["preset"] == "custom"      # an edit over a preset reads as custom, like the server
        r = c.post("/api/do", json={"action": "walk_start"}).json()
        assert r["walk"]["n"] > 5 and r["walk"]["current"]["id"] == "arm"
        assert c.post("/api/do", json={"action": "walk_play"}).status_code == 200
        assert c.post("/api/do", json={"action": "walk_verdict", "ok": True, "note": "fine"}).json()["walk"]["i"] == 1
        assert c.post("/api/do", json={"action": "walk_stop"}).json()["walk"] is None
        for a in ("arm", "spawn", "revive", "end"):
            assert c.post("/api/do", json={"action": a}).status_code == 200
        assert c.post("/api/do", json={"action": "event", "kind": "bomb_planted"}).status_code == 200
        assert c.post("/api/do", json={"action": "kill", "medals": ["first_blood"]}).status_code == 200
        assert c.post("/api/do", json={"action": "ir", "kind": "shot", "team": 2}).status_code == 200
        # bad input is a 400 with a message, never a 500; unknown actions cannot reach the manager
        assert c.post("/api/do", json={"action": "set_profile", "gun": "breathe"}).status_code == 400
        assert c.post("/api/do", json={"action": "disconnect_all"}).status_code == 400
        assert c.post("/api/do", json={"action": "patch_presentation", "patch": {"events": {"nope": {}}}}).status_code == 400
        assert c.post("/api/do", json={"action": "auto_react", "on": False}).json()["model"]["auto_react"] is False
        log = c.get("/api/state").json()["log"]
        assert any(l["kind"] == "tx" for l in log)
