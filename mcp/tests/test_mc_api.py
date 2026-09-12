"""API route smoke via starlette TestClient (skips cleanly when starlette/httpx are absent)."""
from _skip import needs

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
    needs(HAVE, "starlette + httpx")
    c, s, net = _client()
    r = c.get("/api/state"); assert r.status_code == 200 and r.json()["phase"] == "muster"
    # Count off the real MODES table, not a literal: this file is SKIPPED under system python (no
    # starlette), so a hardcoded 5 turned "a new mode was added" into a failure only the venv run
    # could see -- which is exactly the gate CLAUDE.md says not to lean on. What matters is that the
    # route serves every catalogued mode, and that each row carries the fields the UI renders.
    from brx_mcp.mc.state import MODES
    modes = c.get("/api/modes").json()
    assert [m["mode"] for m in modes] == [m["mode"] for m in MODES], [m["mode"] for m in modes]
    assert all(m.get("abbr") and m.get("brief") and m.get("defaults") for m in modes), modes
    assert len(c.get("/api/weapons").json()) == 18


def test_player_flow_and_errors():
    needs(HAVE, "starlette + httpx")
    c, s, net = _client()
    assert c.put("/api/config", json={"mode": "ffa", "time_limit_s": 300}).json()["ok"]
    p = c.post("/api/players", json={"display": "reaper", "gun_id": "GUN-A"}).json()
    assert p["display"] == "REAPER" and p["player_num"] == 1
    assert c.patch(f"/api/players/{p['player_id']}", json={"player_num": 0}).status_code == 400
    # A15 voice_slots: {role: id} picks for the $PSET voice fields -- bad role / off-gun id 400, good ones stick, {} clears
    assert c.patch(f"/api/players/{p['player_id']}", json={"voice_slots": {"dance": "V34"}}).status_code == 400
    assert c.patch(f"/api/players/{p['player_id']}", json={"voice_slots": {"death_scream": "E_J10"}}).status_code == 400
    # (the FakeCompiler has no voice_options, so this session only knows male/female; the ids are validated on the gun, not the family)
    r = c.patch(f"/api/players/{p['player_id']}", json={"voice": "male", "voice_slots": {"death_scream": "v34", "kill": "V38"}})
    assert r.status_code == 200 and r.json()["voice_slots"] == {"death_scream": "V34", "kill": "V38"} and r.json()["voice"] == "male"
    assert "voice_slots" not in c.patch(f"/api/players/{p['player_id']}", json={"voice_slots": {}}).json()
    q = c.post("/api/players", json={"display": "two", "voice": "female", "voice_slots": {"respawn_cry": "VB1"}}).json()
    assert q["voice_slots"] == {"respawn_cry": "VB1"}
    assert c.post("/api/players", json={"display": "three", "voice_slots": {"nope": "VB1"}}).status_code == 400
    assert c.delete(f"/api/players/{q['player_id']}").json()["ok"]
    from brx_mcp.mc.compile import Compiler
    v = {o["id"]: o for o in Compiler().voice_options()}          # what a REAL server's GET /api/voices lists
    assert {"speaker", "lines", "kill_line"} <= set(v["heavy"]) and "soldier" in v and v["clean_male"]["family"] == "VP"
    assert c.post("/api/lobby/push").status_code == 400            # no node → red → refused
    assert c.post("/api/control", json={"cmd": "panic"}).status_code == 400
    assert c.get("/api/recap").status_code == 404
    assert c.delete(f"/api/players/{p['player_id']}").json()["ok"]


def test_ui_ws_snapshot():
    needs(HAVE, "starlette + httpx")
    c, s, net = _client()
    with c.websocket_connect("/ui-ws") as ws:
        msg = ws.receive_json()
        assert msg["kind"] == "snapshot" and "readiness" in msg["state"]


# ── W1/F6: per-match CSV export (handoff-post-first-match) ───────────────────────────────────────
def _client_with_history():
    """A session whose store already holds two finished matches, as after two rounds on the field."""
    import pathlib, tempfile
    from brx_mcp.mc.store import Store
    c, s, net = _client()
    s.store = Store("sess", pathlib.Path(tempfile.mkdtemp()) / "s.sqlite")
    s.store.match_started("m1", {"mode": "tdm"}, 1000)
    s.store.match_ended("m1", {"winner": {"team_id": "blue"}, "rows": [
        {"player_id": "p1", "display": "ALPHA", "team_id": "blue", "kills": 4, "deaths": 1, "assists": 2,
         "kd": 4.0, "accuracy": 31, "streak": 3, "shots": 40, "hits": 12, "medals": ["MVP"]}]})
    s.store.match_started("m2", {"mode": "ffa"}, 2000)
    s.store.match_ended("m2", {"winner": {"player_id": "p2"}, "rows": [
        {"player_id": "p2", "display": "=CMD|calc", "team_id": None, "kills": 9, "deaths": 0, "assists": 0,
         "kd": 9.0, "accuracy": None, "streak": 9, "shots": 20, "hits": 9, "medals": []}]})
    return c, s, net


def test_archived_match_csv_exports_that_match_not_the_live_one():
    """`/api/recap.csv` only ever served the LIVE scorer, so the RECAP history picker had to HIDE
    its export button on a past match rather than hand the operator the wrong game's numbers."""
    needs(HAVE, "starlette + httpx")
    c, s, net = _client_with_history()
    r = c.get("/api/matches/m1.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert 'filename="recap-m1.csv"' in r.headers["content-disposition"]
    body = r.text.splitlines()
    assert body[0].startswith("operator,team,kills")
    # F116 (2026-09-11): `best_streak` sits after `streak` — an ARCHIVED recap predates the field, so
    # `rows_csv` reads it defensively and this stored row exports 0 for it.
    assert body[1].startswith("ALPHA,blue,4,1,2,4.0,31,3,0,40,12,MVP")
    assert "ALPHA" not in c.get("/api/matches/m2.csv").text        # a different match, different rows
    # there is no live scorer at all here — the archived export must not depend on one
    assert s.scorer is None and c.get("/api/recap.csv").status_code == 404


def test_archived_match_csv_edge_cases():
    needs(HAVE, "starlette + httpx")
    c, s, net = _client_with_history()
    assert c.get("/api/matches/nope.csv").status_code == 404       # unknown id, not an empty file
    # spreadsheet formula injection is neutralised on the archived path too (same writer)
    assert "'=CMD|calc" in c.get("/api/matches/m2.csv").text
    # a scored-nobody match is a truthful empty export, not a 404
    s.store.match_started("m3", {"mode": "ffa"}, 3000)
    s.store.match_ended("m3", {"winner": {}, "rows": []})
    r = c.get("/api/matches/m3.csv")
    assert r.status_code == 200 and r.text.strip() == "operator,team,kills,deaths,assists,kd,accuracy,streak,best_streak,shots,hits,medals"
    # and it is READ-ONLY: no operator token, exactly like GET /api/matches
    assert c.get("/api/matches").status_code == 200


def test_weapon_stats_follow_the_hosts_health_config():
    """W2: `POOL = 115` was hardcoded in views.py, so ARSENAL and KIT quoted `HITS TO KILL 13` for
    the AR at every health setting (docs/weapon-design.md §2.5)."""
    needs(HAVE, "starlette + httpx")
    # the REAL compiler: this is about the shipped arsenal's derivation chain, which the fake has none of
    from brx_mcp.mc.api import create_app
    from brx_mcp.mc.compile import Compiler
    from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
    from brx_mcp.mc.state import Session
    c = TestClient(create_app(Session(Compiler(), FakeNet(), FakeArmory(demo_armory()))))

    def ar():
        return next(w for w in c.get("/api/weapons").json() if w["weapon_id"] == "assault_rifle")
    base = ar()
    assert base["pool"] == 115 and base["htk"] == 13
    assert c.put("/api/config", json={"health": {"max_hp": 100, "max_armor": 100}}).json()["ok"]
    hard = ar()
    assert hard["pool"] == 200 and hard["htk"] == 23                # §2.5's 100/100 column
    assert hard["dmg_per_hit"] == base["dmg_per_hit"]               # a property of the weapon, not the pool
    assert hard["ttk_ms"] > base["ttk_ms"]


def test_station_routes_refuse_in_the_operators_voice_while_armed_or_live():
    """Polish 2026-09-11: `clear_station` raises while the match is armed/live (a re-push would re-arm every
    live gun). The DELETE route called it outside its try, so the refusal was a 500 with no message where PUT
    gave a 400 in the operator's voice."""
    needs(HAVE, "starlette + httpx")
    c, s, net = _client()
    net.simulate_utility_hello("util-1")
    assert c.put("/api/stations/util-1", json={"kind": "respawn", "team": "any", "id": 3}).status_code == 200
    s.phase = "live"
    r = c.delete("/api/stations/util-1")
    assert r.status_code == 400 and "LIVE" in r.json()["error"], (r.status_code, r.text)
    r = c.put("/api/stations/util-1", json={"kind": "respawn", "team": "any", "id": 4})
    assert r.status_code == 400 and "LIVE" in r.json()["error"], (r.status_code, r.text)
    assert s.stations["util-1"]["assigned"]["id"] == 3, "the refused change left nothing behind"
    # CONTROL: in lobby the same DELETE succeeds, and an unknown station is still a 404 (not a 400)
    s.phase = "lobby"
    assert c.delete("/api/stations/util-1").status_code == 200
    assert c.delete("/api/stations/never").status_code == 404


def test_the_kit_locks_at_start_over_http_with_a_409():
    """A30: a host kit edit during a running match is a CONFLICT (the request is fine, the moment is not),
    so the route answers 409 and not the blanket 400 every other player error gets. The fields that never
    reach the gun still patch."""
    needs(HAVE, "starlette + httpx")
    from brx_mcp.mc.fakes import demo_armory
    c, s, net = _client()
    assert c.put("/api/config", json={"mode": "tdm", "time_limit_s": 60}).json()["ok"]
    p = c.post("/api/players", json={"display": "reaper", "gun_id": "GUN-A"}).json()
    tail = demo_armory()[0]["ble"]["tail"]
    net.simulate_hello("node0", f"GUN-A-{tail}")
    assert c.post("/api/lobby/push", json={"force": True}).status_code == 200
    net.simulate_node_message("node0", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                      "gun_echo": "x"}, s.now_ms())
    assert c.post("/api/start", json={"runway_s": 30, "force": True}).status_code == 200
    pushes = len(net.pushes("config", "node0"))
    r = c.patch(f"/api/players/{p['player_id']}", json={"loadout": {"weapons": [{"weapon_id": "shotgun"}]}})
    assert r.status_code == 409, (r.status_code, r.json())
    assert "kit is locked" in r.json()["error"] and "loadout" in r.json()["error"], r.json()
    assert c.patch(f"/api/players/{p['player_id']}", json={"voice": "female"}).status_code == 409
    # a gamertag never reaches the gun, so it is still allowed — and nothing re-pushed frames
    assert c.patch(f"/api/players/{p['player_id']}", json={"display": "rocco"}).json()["display"] == "ROCCO"
    assert len(net.pushes("config", "node0")) == pushes
    # …and the ordinary validation errors are still 400
    assert c.patch(f"/api/players/{p['player_id']}", json={"team_id": "nope"}).status_code == 400
