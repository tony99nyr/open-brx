"""Polish-loop iteration 1 regressions (security + validation + scoring edge cases)."""
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session
from brx_mcp.mc.scoring import Scorer

try:
    from starlette.testclient import TestClient
    import httpx  # noqa: F401
    HAVE = True
except Exception:
    HAVE = False


def _sess():
    s = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    return s


def test_config_validation_rejects_bad_values():
    s = _sess()
    for bad in ({"time_limit_s": "abc"}, {"time_limit_s": -5}, {"mode": "nope"},
                {"teams": "ab"}, {"respawn": {"type": "warp"}}, {"environment": "space"}):
        try:
            s.set_config(bad); assert False, bad
        except ValueError:
            pass
    # a good patch still applies; unknown keys are ignored, not stored
    r = s.set_config({"time_limit_s": 300, "bogus": 1})
    assert r["config"]["time_limit_s"] == 300 and "bogus" not in r["config"]


def test_scorer_multikill_after_suppressed_death_does_not_crash():
    s = _sess(); s.set_config({"mode": "ffa", "time_limit_s": 120})
    a = s.add_player("A", gun_id="GUN-A"); b = s.add_player("B", gun_id="GUN-B"); c = s.add_player("C", gun_id="GUN-C")
    sc = Scorer("m", 1000, 120, "ffa", s.players, s.teams, {}, {}, now_ms=lambda: 2000)
    # a's first kill is suppressed (never-synced node → suppress path sets last_kill_t but not multis)
    sc.ingest("nx", {"type": "death", "match_id": "m", "player_id": b["player_id"],
                     "shooter_num": a["player_num"], "shooter_team": 1}, 1500)   # nx never synced → suppressed
    # a fresh (synced) kill ≤ MULTI_KILL_MS later must not IndexError on the empty multis list
    sc.synced_at_lobby["ny"] = True
    sc.node_player["ny"] = c["player_id"]
    sc.ingest("ny", {"type": "death", "match_id": "m", "player_id": c["player_id"],
                     "shooter_num": a["player_num"], "shooter_team": 1}, 1500)
    assert sc.stats[a["player_id"]].kills == 2


def test_csv_injection_neutralised():
    s = _sess(); s.set_config({"mode": "tdm", "time_limit_s": 60})
    p = s.add_player("=cmd|calc", gun_id="GUN-A")
    sc = Scorer("m", 0, 60, "tdm", s.players, s.teams, {}, {}, now_ms=lambda: 1)
    line = next(l for l in sc.csv().splitlines() if "CMD" in l)
    assert line.lstrip('"').startswith("'=") or line.startswith("'=")


def test_auth_gate_and_open_reads():
    if not HAVE:
        return
    from brx_mcp.mc.api import create_app
    s = _sess()
    c = TestClient(create_app(s, token="secret"))
    assert c.get("/api/state").status_code == 200                      # open read
    assert c.post("/api/players", json={"display": "X"}).status_code == 401   # gated write
    assert c.post("/api/players?tok=secret", json={"display": "X"}).status_code == 200
    assert c.post("/api/players", json={"display": "Y"},
                  headers={"Authorization": "Bearer secret"}).status_code == 200
    assert c.get("/api/state").json()["lan"]["auth_required"] is True
    # no-token app leaves writes open
    c2 = TestClient(create_app(_sess(), token=None))
    assert c2.post("/api/players", json={"display": "Z"}).status_code == 200


def test_bad_bodies_return_4xx_not_500():
    if not HAVE:
        return
    from brx_mcp.mc.api import create_app
    c = TestClient(create_app(_sess(), token=None), raise_server_exceptions=False)
    assert c.put("/api/config", json=[1, 2]).status_code in (400, 200)     # non-dict → not a 500
    p = c.post("/api/players", json={"display": "reaper", "gun_id": "GUN-A"}).json()
    assert c.patch(f"/api/players/{p['player_id']}", json={"display": 5}).status_code in (200, 400)
    assert c.post("/api/start", json={"runway_s": "abc"}).status_code == 400
    assert c.get("/api/weapons").status_code == 200 and all(
        w["dmg"] is not None for w in c.get("/api/weapons").json())


# ---------------------------------------------------------------- iteration 2 regressions
def test_team_id_validated_on_add_and_patch():
    s = _sess()
    try:
        s.add_player("X", team_id="purple"); assert False
    except ValueError:
        pass
    p = s.add_player("Y", team_id="blue")
    try:
        s.patch_player(p["player_id"], team_id="nope"); assert False
    except ValueError:
        pass
    assert s.players[p["player_id"]]["team_id"] == "blue"
    s.patch_player(p["player_id"], team_id=None)
    assert s.players[p["player_id"]]["team_id"] is None


def test_player_num_base_honoured():
    s = _sess()
    s.set_config({"player_num_base": 32})
    a = s.add_player("A"); b = s.add_player("B")
    assert (a["player_num"], b["player_num"]) == (32, 33)
    try:
        s.set_config({"player_num_base": 0}); assert False
    except ValueError:
        pass


def test_patch_team_mid_match_updates_scorer_and_display_capped():
    s = _sess()
    a = s.add_player("A", team_id="blue"); b = s.add_player("B", team_id="yellow")
    s.set_config({"time_limit_s": 60})
    for p in (a, b):
        s._bind(f"n-{p['player_id']}", p)
        s.nodes[f"n-{p['player_id']}"]["synced"] = True
    s.patch_player(a["player_id"], ready=True); s.patch_player(b["player_id"], ready=True)
    s.push_config()
    for pid in (a["player_id"], b["player_id"]):
        s._on_node_message(s.players[pid]["node_id"], "ack_config", {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD,0,0,0,0,0,0,*"}, s.now_ms())
    s.start(runway_s=5)
    assert s.scorer.stats[a["player_id"]].team_id == "blue"
    s.patch_player(a["player_id"], team_id="yellow", display="x" * 40)
    assert s.scorer.stats[a["player_id"]].team_id == "yellow"
    assert len(s.players[a["player_id"]]["display"]) == 24
    try:
        s.patch_player(a["player_id"], display="   "); assert False
    except ValueError:
        pass


def test_ingest_batch_records_seq_for_dedup():
    s = _sess()
    a = s.add_player("A", team_id="blue"); b = s.add_player("B", team_id="yellow")
    s.set_config({"time_limit_s": 60})
    for p in (a, b):
        s._bind(f"n-{p['player_id']}", p); s.nodes[f"n-{p['player_id']}"]["synced"] = True
        s.patch_player(p["player_id"], ready=True)
    s.push_config()
    for pid in (a["player_id"], b["player_id"]):
        s._on_node_message(s.players[pid]["node_id"], "ack_config", {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD,0,0,0,0,0,0,*"}, s.now_ms())
    s.start(runway_s=1)
    mid = s.start_info["match_id"]; t = s.now_ms()
    nid = s.players[b["player_id"]]["node_id"]
    ev = {"type": "death", "t": t, "match_id": mid, "node_id": nid, "player_id": b["player_id"],
          "shooter_num": a["player_num"], "shooter_team": 1, "seq": 7}
    s.ingest_batch(nid, [dict(ev)], t)
    assert (nid, 7) in s.scorer.seen
    s.ingest_batch(nid, [dict(ev)], t + 10)          # replay with the same seq is ignored
    assert s.scorer.stats[b["player_id"]].deaths == 1


def test_rogue_hello_with_copied_gun_name_is_rejected_a8():
    """A8: a keyless hello carrying a live gun's name must be closed 4003 BEFORE hydrate rebinds anything."""
    try:
        import websockets  # noqa: F401
        from websockets.asyncio.client import connect
    except Exception:
        print("SKIP rogue_hello (no websockets)"); return
    import asyncio, json, sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    from e2e_util import Stack
    from brx_mcp.mc import envelope as E

    async def go():
        async with Stack(time_limit_s=30) as st:
            p = st.add_player("ALPHA", "GUN-A-3D4F", team_id="blue")
            q = st.add_player("BRAVO", "GUN-B-4E60", team_id="yellow")
            a = await st.connect_node("GUN-A-3D4F"); b = await st.connect_node("GUN-B-4E60")
            assert await st.wait_ready(), st.session.readiness()
            a.send_ready(); b.send_ready()
            await st.push_and_start(runway_s=1)
            assert await st.wait_live()
            a.fire(20); await asyncio.sleep(0.4)
            before = st.session.scorer.shots_total(p["player_id"])
            legit_nid = st.session.players[p["player_id"]]["node_id"]
            closed_code = None
            async with connect(st.url) as ws:
                hello = {"node_id": "rogue-1", "node_type": "phone", "app_ver": "x", "seq_next": 1,
                         "gun": {"name": "GUN-A-3D4F", "tail": "3D4F"}}
                await ws.send(E.encode(E.make_envelope("hello", hello)))
                try:
                    msg = json.loads(await asyncio.wait_for(ws.recv(), 3))
                    assert msg.get("kind") != "welcome" or not msg["body"].get("node"), "rogue must not be hydrated"
                except websockets.exceptions.ConnectionClosed as e:
                    closed_code = e.rcvd.code if e.rcvd else None
            assert closed_code == 4003, closed_code
            await asyncio.sleep(0.3)
            assert st.session.players[p["player_id"]]["node_id"] == legit_nid
            assert st.session.scorer.shots_total(p["player_id"]) == before
            assert st.net.stats["rejected"] >= 1
    asyncio.run(asyncio.wait_for(go(), 40))
