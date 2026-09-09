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
        # untouched, the selector shows the "standard" preset's OWN gun.in_play (GUN_DEFAULT is "team")
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


def test_reroll_and_the_rolled_takes_through_the_api():
    needs(HAVE, "starlette + httpx")
    with _client() as c:
        c.post("/api/do", json={"action": "connect", "address": "FA:KE:00:00:00:01"})
        c.post("/api/do", json={"action": "set_profile", "voice": "heavy"})
        assert c.get("/api/state").json()["voice"]["rolled"] == {}
        r = c.post("/api/do", json={"action": "reroll"})
        assert r.status_code == 200 and r.json()["voice"]["rolled"]["death_scream"] in ("V33", "V34", "V35")
        r = c.post("/api/do", json={"action": "arm"})
        v = r.json()["voice"]
        # A15.3: short_pain ships empty and is no longer rolled -- death_scream is the only field left to roll
        assert v["rolled"] and v["pools"]["death_scream"] and [x["id"] for x in v["cue_pools"]["kill"]] == ["V3A", "V38", "V39", "V3K", "V3L"]
        assert any(l["text"].startswith("rolled: ") for l in r.json()["log"])


def test_voice_actions_through_the_api():
    needs(HAVE, "starlette + httpx")
    with _client() as c:
        c.post("/api/do", json={"action": "connect", "address": "FA:KE:00:00:00:01"})
        s = c.get("/api/state").json()
        assert s["voice"]["id"] == "male" and s["voices"] and s["voice"]["lines"]
        assert isinstance(s["voice"]["spawn"], list) and [x["id"] for x in s["voice"]["spawn"]][:1] in (["VAI"], [])   # A15.2: the spawn takes (empty only on a pre-A15.2 compiler)
        r = c.post("/api/do", json={"action": "set_profile", "voice": "heavy"})
        assert r.status_code == 200 and r.json()["voice"]["speaker"] == "Heavy" and r.json()["profile"]["voice"] == "heavy"
        assert c.post("/api/do", json={"action": "set_profile", "voice": "robot"}).status_code == 400
        r = c.post("/api/do", json={"action": "set_voice_slot", "role": "death_scream", "id": "V35"})
        assert r.status_code == 200 and r.json()["voice"]["pset"]["death_scream"] == "V35"
        assert c.post("/api/do", json={"action": "set_voice_slot", "role": "death_scream", "id": "ZZZ9"}).status_code == 400
        assert c.post("/api/do", json={"action": "set_voice_slot", "role": "hat", "id": "V35"}).status_code == 400
        r = c.post("/api/do", json={"action": "voice_line", "id": "V3K"})
        assert r.status_code == 200 and any(l["text"] == "$PLAY,,4,6,V3K,,,,*" for l in r.json()["log"])
        assert c.post("/api/do", json={"action": "voice_line", "id": "NOPE"}).status_code == 400
        # the soundboard: a character independent of the game voice, PLAY ALL / STOP, a verdict per line
        r = c.post("/api/do", json={"action": "voice_board", "voice": "scout"})
        assert r.status_code == 200 and r.json()["board"]["speaker"] == "Scout (female)" and r.json()["profile"]["voice"] == "heavy"
        assert c.post("/api/do", json={"action": "voice_board", "voice": "robot"}).status_code == 400
        assert c.post("/api/do", json={"action": "voice_board_play", "voice": "scout"}).status_code == 200
        assert c.post("/api/do", json={"action": "voice_board_stop"}).json()["board"]["playing"] is None
        r = c.post("/api/do", json={"action": "voice_verdict", "voice": "scout", "id": "VB3", "ok": False, "note": "nope"})
        assert r.status_code == 200 and r.json()["board"]["verdicts"]["VB3"] == {"ok": False, "note": "nope"}
        assert c.post("/api/do", json={"action": "voice_verdict", "voice": "scout", "id": "V33", "ok": True}).status_code == 400
