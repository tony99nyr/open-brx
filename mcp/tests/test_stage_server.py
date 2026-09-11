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


def test_the_control_point_reload_and_ammo_actions_through_the_api():
    """F102 / F54: the injectors are whitelisted actions with the validator's message on a bad value."""
    needs(HAVE, "starlette + httpx")
    with _client() as c:
        c.post("/api/do", json={"action": "connect", "address": "FA:KE:00:00:00:01"})
        r = c.post("/api/do", json={"action": "set_profile", "mode": "koth"}).json()
        assert r["station_source"] == "grenade" and "phone" in r["station_sources"], "koth's own source is the grenade"
        r = c.post("/api/do", json={"action": "set_profile", "station_source": "phone"}).json()
        assert r["station_source"] == "phone" and r["profile"]["station_source"] == "phone"
        assert c.post("/api/do", json={"action": "set_profile", "station_source": "pigeon"}).status_code == 400
        # F15: every profile key the page can send must be on the action's allow-list -- `stun` was not, and the
        # browser drive showed a select that changed nothing while the page said RE-ARM (caught 2026-09-11)
        r = c.post("/api/do", json={"action": "set_profile", "stun": 5}).json()
        assert r["profile"]["stun"] == 5 and r["model"]["stun_enabled"] is True and r["model"]["stun_s"] == 5
        assert c.post("/api/do", json={"action": "set_profile", "stun": 61}).status_code == 400
        r = c.post("/api/do", json={"action": "set_profile", "stun": None}).json()
        assert r["profile"]["stun"] is None and r["model"]["stun_enabled"] is False
        for a in ("arm", "spawn"):
            assert c.post("/api/do", json={"action": a}).status_code == 200
        r = c.post("/api/do", json={"action": "station_advert", "id": 1, "team": None, "value": 0, "present": True}).json()
        assert r["stations"] and r["stations"][0]["id"] == 1 and r["stations"][0]["advertising"] is True
        assert r["model"]["hill"]["source"] == "station" and r["model"]["hill"]["owner"] == 2
        assert c.post("/api/do", json={"action": "station_advert", "id": 0}).status_code == 400
        assert c.post("/api/do", json={"action": "station_advert", "id": 1, "value": 101}).status_code == 400
        assert c.post("/api/do", json={"action": "station_advert", "id": 1, "team": 7}).status_code == 400
        assert c.post("/api/do", json={"action": "station_advert", "uuid": "nope"}).status_code == 400
        r = c.post("/api/do", json={"action": "station_stop"}).json()
        assert r["stations"][0]["advertising"] is False
        # F54: a reload before any ammo report is ignored (the phone knows no reserve); after one it glances
        r = c.post("/api/do", json={"action": "reload"}).json()
        assert r["model"]["reloading"] is None and any("no reserve known" in l["text"] for l in r["log"])
        r = c.post("/api/do", json={"action": "alcd", "mag": 10, "reserve": 20}).json()
        assert r["model"]["reserve"] == 20 and any(l["why"] == "injected by the page" for l in r["log"])
        r = c.post("/api/do", json={"action": "reload"}).json()
        assert r["model"]["reloading"] and r["model"]["reloading"]["slot"] == 0
        assert c.post("/api/do", json={"action": "alcd", "mag": "x"}).status_code == 400


class _SleepyManager(FakeConnectionManager):
    """A tagger that never answers: `connect` awaits an Event nobody sets until the test says so."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.wake = None

    async def connect(self, address, alias, **kw):
        import asyncio
        if self.wake is None:
            self.wake = asyncio.Event()
        await self.wake.wait()
        return await super().connect(address, alias, **kw)


def test_boot_does_not_block_the_page_when_the_gun_never_answers():
    """S11: `--gun` is booted as a BACKGROUND task. With the tagger asleep the page must come up at once,
    LINKED=false, and the link must land later without a restart. CONTROL: the boot task is still pending
    at the moment start-up has completed -- the old `await boot()` inside the lifespan could not have
    yielded before it finished, and this test would have hung on the 2 s bound instead of passing."""
    needs(HAVE, "starlette + httpx")
    import asyncio
    from brx_mcp.stage.server import create_app, install_boot
    mgr = _SleepyManager([FakeTagger("FA:KE:00:00:00:01", "FAKE-STAGE", team=1)])
    stage = GunStage(mgr, None)
    app = create_app(stage)
    install_boot(app, stage, gun="FA:KE:00:00:00:01")

    async def go():
        ctx = app.router.lifespan_context(app)
        await asyncio.wait_for(ctx.__aenter__(), 2.0)          # start-up completes while the connect is still hanging
        try:
            task = app.state.boot_task
            assert not task.done() and stage.connected is False, "the page is up before the link"
            await asyncio.sleep(0)                                # one loop turn: the task starts and logs its intent
            assert not task.done() and any("connecting to FA:KE:00:00:00:01 in the background" in l["text"] for l in stage.log)
            mgr.wake.set()                                        # the tagger wakes up
            await asyncio.wait_for(task, 2.0)
            assert stage.connected is True, "the link landed with the page already serving"
        finally:
            await ctx.__aexit__(None, None, None)
    asyncio.run(go())
    # and through the real front: the routes answer while the connect is (forever) pending
    mgr2 = _SleepyManager([FakeTagger("FA:KE:00:00:00:01", "FAKE-STAGE", team=1)])
    stage2 = GunStage(mgr2, None)
    app2 = create_app(stage2)
    install_boot(app2, stage2, gun="FA:KE:00:00:00:01")
    with TestClient(app2) as c:
        s = c.get("/api/state").json()
        assert s["link"]["connected"] is False and c.get("/").status_code == 200
        assert not app2.state.boot_task.done()
    assert app2.state.boot_task.cancelled() or app2.state.boot_task.done(), "shutdown cancels the pending boot"


def test_a_failed_boot_connect_is_one_warn_line_not_a_hang():
    needs(HAVE, "starlette + httpx")
    import asyncio
    from brx_mcp.stage.server import create_app, install_boot
    mgr = FakeConnectionManager([FakeTagger("FA:KE:00:00:00:01", "FAKE-STAGE", team=1)])
    mgr.fail_connect.add("FA:KE:00:00:00:01")
    stage = GunStage(mgr, None)
    app = create_app(stage)
    install_boot(app, stage, gun="FA:KE:00:00:00:01")
    with TestClient(app) as c:
        asyncio.run(asyncio.sleep(0))
        for _ in range(50):
            if app.state.boot_task.done():
                break
            import time; time.sleep(0.02)
        s = c.get("/api/state").json()
        assert s["link"]["connected"] is False
        assert any(l["kind"] == "warn" and "connect FA:KE:00:00:00:01 failed" in l["text"] for l in s["log"]), [l["text"] for l in s["log"]]


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


def test_boot_never_replaces_a_link_the_operator_made_first():
    """Polish round 2: `GunStage.connect` disconnects any existing link first, so a slow `--gun` boot landing after
    the operator pressed CONNECT (possibly to another gun) was a silent gun swap. The boot task now leaves an
    existing link alone. CONTROL: with no link up, the same boot still connects."""
    needs(HAVE, "starlette + httpx")
    import asyncio
    from brx_mcp.stage.server import create_app, install_boot
    mgr = _SleepyManager([FakeTagger("FA:KE:00:00:00:01", "FAKE-STAGE", team=1), FakeTagger("FA:KE:00:00:00:02", "FAKE-OTHER", team=1)])
    stage = GunStage(mgr, None)
    app = create_app(stage)
    install_boot(app, stage, gun="FA:KE:00:00:00:01")
    stage.poll = lambda: None                                          # the lifespan's poller would read the fake manager and drop a link it cannot see
    async def go():
        stage.connected = True; stage.address = "FA:KE:00:00:00:02"   # the operator linked the other gun before the boot task ran
        ctx = app.router.lifespan_context(app)
        await asyncio.wait_for(ctx.__aenter__(), 2.0)
        try:
            task = app.state.boot_task
            await asyncio.wait_for(task, 2.0)                             # the guard returns before any connect (so no wake is needed)
            assert stage.address == "FA:KE:00:00:00:02", "the boot left the operator's link alone"
            assert any("leaving it, not dialling FA:KE:00:00:00:01" in l["text"] for l in stage.log)
        finally:
            await ctx.__aexit__(None, None, None)
    asyncio.run(go())
