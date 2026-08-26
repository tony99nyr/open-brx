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
    sc.node_player["nx"] = b["player_id"]     # facts are attributed by the node's binding only (CRITICAL-2)
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


# ---------------------------------------------------------------- iteration 3 regressions
def test_non_ascii_token_is_401_not_500():
    if not HAVE:
        return
    import asyncio
    from brx_mcp.mc.api import create_app
    app = create_app(_sess(), token="secret")
    # raw ASGI: the test client refuses to encode a non-ASCII header, so drive the app directly
    async def call(headers):
        scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "scheme": "http",
                 "path": "/api/players", "raw_path": b"/api/players", "query_string": b"", "headers": headers,
                 "client": ("127.0.0.1", 1), "server": ("127.0.0.1", 80)}
        sent = []
        async def receive():
            return {"type": "http.request", "body": b'{"display": "X"}', "more_body": False}
        async def send(msg):
            sent.append(msg)
        await app(scope, receive, send)
        return next(m["status"] for m in sent if m["type"] == "http.response.start")
    assert asyncio.run(call([(b"content-type", b"application/json"), (b"authorization", "Bearer é’".encode("utf-8"))])) == 401
    assert asyncio.run(call([(b"content-type", b"application/json"), (b"authorization", b"Bearer \xff\xfe")])) == 401
    c = TestClient(app, raise_server_exceptions=False)
    assert c.post("/api/players?tok=%C3%A9", json={"display": "X"}).status_code == 401
    assert c.post("/api/players?tok=%FF", json={"display": "X"}).status_code == 401
    # WS handshake with a bad token must be a clean auth close, not a 500
    try:
        with c.websocket_connect("/ui-ws?tok=%C3%A9") as ws:
            ws.receive()
            assert False, "should have been closed"
    except Exception as e:  # WebSocketDisconnect(4401) or a handshake refusal — anything but a 500 traceback
        assert "500" not in str(e)


def test_patch_validates_loadout_voice_ready():
    s = _sess()
    p = s.add_player("A", gun_id="GUN-A")
    for bad in ({"loadout": "junk"}, {"loadout": {}}, {"loadout": {"weapons": []}}, {"loadout": {"weapons": [{"x": 1}]}},
                {"voice": "robot"}, {"ready": "yes"}, {"loadout": {"weapons": [{"weapon_id": "assault_rifle"}], "overrides": {"max_hp": "a"}}}):
        try:
            s.patch_player(p["player_id"], **bad); assert False, bad
        except ValueError:
            pass
    assert s.players[p["player_id"]]["loadout"]["weapons"][0]["weapon_id"] == "assault_rifle"   # untouched
    ok = s.patch_player(p["player_id"], loadout={"weapons": [{"weapon_id": "smg"}, {"weapon_id": "shotgun"}], "overrides": {"max_hp": 60}}, voice="female", ready=True)
    assert [w["weapon_id"] for w in ok["loadout"]["weapons"]] == ["smg", "shotgun"] and ok["loadout"]["overrides"] == {"max_hp": 60}
    assert ok["voice"] == "female" and ok["ready"] is True


def test_numeric_bodies_overflow_and_fraction_are_400():
    if not HAVE:
        return
    from brx_mcp.mc.api import create_app
    c = TestClient(create_app(_sess(), token=None), raise_server_exceptions=False)
    p = c.post("/api/players", json={"display": "reaper", "gun_id": "GUN-A"}).json()
    J = {"content-type": "application/json"}
    for bad in (3.7, "abc", True):
        assert c.patch(f"/api/players/{p['player_id']}", json={"player_num": bad}).status_code == 400, bad
        assert c.post("/api/start", json={"runway_s": bad}).status_code == 400, bad
    # 1e999 parses to inf on the server (the client lib refuses to serialise it, so send raw bytes)
    assert c.patch(f"/api/players/{p['player_id']}", content=b'{"player_num": 1e999}', headers=J).status_code == 400
    assert c.post("/api/start", content=b'{"runway_s": 1e999}', headers=J).status_code == 400
    assert c.post("/api/armory/scan", content=b'{"duration_s": 1e999}', headers=J).status_code == 400
    assert c.put("/api/config", content=b'{"time_limit_s": 1e999}', headers=J).status_code == 400
    assert c.get("/api/state").status_code == 200   # still alive


# ---------------------------------------------------------------- iteration 3: A8 holder checks / identity (net + state + scoring)
def _ws_stack():
    try:
        import websockets  # noqa: F401
        from websockets.asyncio.client import connect  # noqa: F401
        import sys, pathlib
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
        from e2e_util import Stack, until
        return Stack, until
    except Exception:
        print("SKIP ws stack (no websockets)"); return None, None


async def _raw_hello(url, body, wait=1.5):
    """Returns (welcome_body_or_None, close_code_or_None, ws)"""
    import asyncio, json, websockets
    from websockets.asyncio.client import connect
    from brx_mcp.mc import envelope as E
    ws = await connect(url)
    await ws.send(E.encode(E.make_envelope("hello", body)))
    try:
        msg = json.loads(await asyncio.wait_for(ws.recv(), wait))
        return msg.get("body"), None, ws
    except websockets.exceptions.ConnectionClosed as e:
        return None, (e.rcvd.code if e.rcvd else None), ws


async def _two_live(st):
    p = st.add_player("ALPHA", "GUN-A-3D4F", team_id="blue")
    q = st.add_player("BRAVO", "GUN-B-4E60", team_id="yellow")
    a = await st.connect_node("GUN-A-3D4F", node_id="phone-A"); b = await st.connect_node("GUN-B-4E60", node_id="phone-B")
    assert await st.wait_ready(), st.session.readiness()
    a.send_ready(); b.send_ready()
    await st.push_and_start(runway_s=1)
    assert await st.wait_live()
    return p, q, a, b


def test_a8_gun_variants_cannot_bypass_holder_check():
    """CRITICAL-1: hydrate matches guns fuzzily (case / base name / tail); the A8 holder check must use the SAME
    resolution, so 'gun-a-3d4f', 'GUN-A-0000', 'GUN-A' and a tail-only match are all refused while ALPHA's phone is fresh."""
    Stack, until = _ws_stack()
    if Stack is None:
        return
    import asyncio

    async def go():
        async with Stack(time_limit_s=30) as st:
            st.session.guns = {"GUN-A-3D4F": {"gun_id": "GUN-A-3D4F", "sticker": "GUN-A", "ble": {"tail": "3D4F"}},
                               "GUN-B-4E60": {"gun_id": "GUN-B-4E60", "sticker": "GUN-B", "ble": {"tail": "4E60"}}}
            p, q, a, b = await _two_live(st)
            legit = st.session.players[p["player_id"]]["node_id"]
            for name, tail in (("gun-a-3d4f", "3d4f"), ("GUN-A-0000", "0000"), ("GUN-A", ""), ("ZZZ-9999", "3D4F")):
                body, code, ws = await _raw_hello(st.url, {"node_id": f"rogue-{name}", "node_type": "phone", "app_ver": "x",
                                                            "seq_next": 1, "gun": {"name": name, "tail": tail}})
                await asyncio.sleep(0.2)
                # a variant hydrate would match must be refused; one it would NOT match may connect but stays unbound
                assert code == 4003 or not (body or {}).get("node"), (name, tail, code, body)
                assert st.session.players[p["player_id"]]["node_id"] == legit, (name, tail)
                if code == 4003:
                    assert f"rogue-{name}" not in st.net.nodes, "a rejected stranger must leave no record"
                await ws.close()
            assert a.connected and st.net.stats["rejected"] >= 3
            # the legit phone still gets pushes
            n0 = len(a.controls); st.net.push("phone-A", "control", {"cmd": "recall"})
            assert await until(lambda: len(a.controls) > n0, 2)
    asyncio.run(asyncio.wait_for(go(), 40))


def test_a8_keyless_hello_for_fresh_disconnected_node_id_is_refused():
    """HIGH-3: a phone that dropped a beat ago still owns its node_id — a keyless hello for it is 4003 and must NOT
    rotate the key (else the owner's reconnect is locked out). Once STALE the id can be re-claimed keyless (wiped storage)."""
    Stack, until = _ws_stack()
    if Stack is None:
        return
    import asyncio
    from brx_mcp.mc import envelope as E

    async def go():
        async with Stack(time_limit_s=30) as st:
            p, q, a, b = await _two_live(st)
            key = a.node_key
            await a.disconnect(); await asyncio.sleep(0.1)
            assert st.net.nodes["phone-A"].ws is None
            body, code, ws = await _raw_hello(st.url, {"node_id": "phone-A", "node_type": "phone", "app_ver": "x", "seq_next": 1})
            assert code == 4003 and body is None, (code, body)
            assert st.net.nodes["phone-A"].node_key == key, "key must not rotate on a refused hello"
            await ws.close()
            a.reconnect()
            assert await until(lambda: a.connected, 4), "owner must get back in with its key"
            assert a.node_key == key and st.session.players[p["player_id"]]["node_id"] == "phone-A"
            # wiped storage: keyless re-claim works only after the record went stale, and rotates the key
            await a.close(); await asyncio.sleep(0.1)
            st.net.stale_after_ms = 300
            await asyncio.sleep(0.5)
            a2 = await st.connect_node("GUN-A-3D4F", node_id="phone-A")
            assert a2.connected and a2.node_key and a2.node_key != key and a2.player_id == p["player_id"]
            n0 = len(a2.controls); st.net.push("phone-A", "control", {"cmd": "recall"})
            assert await until(lambda: len(a2.controls) > n0, 2)
    asyncio.run(asyncio.wait_for(go(), 40))


def test_scorer_ignores_client_player_id_that_disagrees_with_binding():
    """CRITICAL-2: an event/status body's player_id never overrides the node's server-side binding."""
    Stack, until = _ws_stack()
    if Stack is None:
        return
    import asyncio
    from brx_mcp.mc import envelope as E

    async def go():
        async with Stack(time_limit_s=30) as st:
            p, q, a, b = await _two_live(st)
            mid = st.session.start_info["match_id"]
            body, code, ws = await _raw_hello(st.url, {"node_id": "rogue-nogun", "node_type": "phone", "app_ver": "x", "seq_next": 1})
            assert code is None and not (body or {}).get("node")
            t = st.session.now_ms()
            env = E.make_envelope("event", {"type": "death", "t": t, "match_id": mid, "node_id": "rogue-nogun",
                                            "player_id": q["player_id"], "shooter_num": p["player_num"], "shooter_team": 1})
            env["seq"] = 1
            await ws.send(E.encode(env))
            await ws.send(E.encode(E.make_envelope("status", {"node_id": "rogue-nogun", "player_id": p["player_id"], "arm_state": "live",
                                                             "synced": True, "shots": 999, "match_id": mid})))
            await asyncio.sleep(0.4)
            sc = st.session.scorer
            assert sc.stats[p["player_id"]].kills == 0 and sc.stats[q["player_id"]].deaths == 0
            assert sc.shots_total(p["player_id"]) == 0 and sc.mismatched >= 2
            # a bound node lying about who it is is dropped too
            a.emit({"type": "death", "t": st.session.now_ms(), "match_id": mid, "player_id": q["player_id"],
                    "shooter_num": p["player_num"], "shooter_team": 1})
            await asyncio.sleep(0.4)
            assert sc.stats[q["player_id"]].deaths == 0 and sc.stats[p["player_id"]].deaths == 0
            await ws.close()
    asyncio.run(asyncio.wait_for(go(), 40))


def test_scorer_pid_unit():
    from brx_mcp.mc.scoring import Scorer
    s = _sess()
    a = s.add_player("A", gun_id="GUN-A"); b = s.add_player("B", gun_id="GUN-B")
    s.node_player["n1"] = a["player_id"]
    sc = Scorer("m", 0, 60, "ffa", s.players, s.teams, s.node_player, {}, now_ms=lambda: 1)
    assert sc._pid("n1", {}) == a["player_id"]
    assert sc._pid("n1", {"player_id": a["player_id"]}) == a["player_id"]
    assert sc._pid("n1", {"player_id": b["player_id"]}) is None and sc.mismatched == 1
    assert sc._pid("unknown", {"player_id": b["player_id"]}) is None


def test_bind_to_another_gun_moves_the_node_and_frees_the_old_player():
    """MEDIUM-4 + LOW: a bind that names a different (free) gun rebinds the node to that gun's player; the old player is
    released and node_player carries no dangling entry."""
    Stack, until = _ws_stack()
    if Stack is None:
        return
    import asyncio
    from brx_mcp.mc import envelope as E

    async def go():
        async with Stack(time_limit_s=30) as st:
            p = st.add_player("ALPHA", "GUN-A-3D4F", team_id="blue")
            c = st.add_player("CHARLIE", "GUN-C-7777", team_id="yellow")
            a = await st.connect_node("GUN-A-3D4F", node_id="phone-A")
            assert await until(lambda: a.player_id == p["player_id"], 3)
            a._send(E.make_envelope("bind", {"node_id": "phone-A", "gun_name": "GUN-C-7777", "gun_tail": "7777"}))
            assert await until(lambda: st.session.node_player.get("phone-A") == c["player_id"], 3)
            assert st.session.players[p["player_id"]]["node_id"] is None
            assert st.session.players[c["player_id"]]["node_id"] == "phone-A"
            assert list(st.session.node_player.values()).count(p["player_id"]) == 0
            assert st.net.nodes["phone-A"].player_id == c["player_id"]
            # ... and a stranger now claiming GUN-C is refused (phone-A is the fresh holder)
            body, code, ws = await _raw_hello(st.url, {"node_id": "rogue-c", "node_type": "phone", "app_ver": "x", "seq_next": 1,
                                                        "gun": {"name": "gun-c-7777", "tail": "7777"}})
            assert code == 4003, code
            await ws.close()
    asyncio.run(asyncio.wait_for(go(), 40))


def test_second_hello_with_other_node_id_on_live_socket_is_closed():
    Stack, until = _ws_stack()
    if Stack is None:
        return
    import asyncio
    from brx_mcp.mc import envelope as E

    async def go():
        async with Stack(time_limit_s=30) as st:
            st.add_player("ALPHA", "GUN-A-3D4F", team_id="blue")
            body, code, ws = await _raw_hello(st.url, {"node_id": "n-1", "node_type": "phone", "app_ver": "x", "seq_next": 1})
            assert code is None
            await ws.send(E.encode(E.make_envelope("hello", {"node_id": "n-2", "node_type": "phone", "app_ver": "x", "seq_next": 1})))
            await asyncio.sleep(0.3)
            assert "n-2" not in st.net.nodes and st.net.nodes["n-1"].ws is None
            await ws.close()
    asyncio.run(asyncio.wait_for(go(), 40))


# ---------------------------------------------------------------- final re-check: eviction / displaced owner / empty gun name
async def _heartbeat(ws, nid, period=0.05):
    """A rogue socket that keeps itself fresh (status every 50 ms)."""
    import asyncio
    from brx_mcp.mc import envelope as E
    while True:
        try:
            await ws.send(E.encode(E.make_envelope("status", {"node_id": nid, "player_id": None, "match_id": None, "hp": 45, "armor": 70,
                                                               "ammo": 36, "alive": True, "shots": 0, "battery": 90, "arm_state": "kitted",
                                                               "synced": True, "dropped": 0, "preflight": {}})))
        except Exception:
            return
        await asyncio.sleep(period)


def test_evicted_squatter_frees_the_gun_for_the_legit_phone():
    """HIGH: a stranger that hellos with a live gun name BEFORE the owner's phone binds the player and, while it heartbeats,
    the legit phone is refused. DELETE /api/nodes/{id} (Session.evict_node) must close it (4000), unbind, rotate its key
    and let the real phone bind on its next hello."""
    Stack, until = _ws_stack()
    if Stack is None:
        return
    import asyncio

    async def go():
        async with Stack(time_limit_s=30) as st:
            st.session.guns = {"GUN-A-3D4F": {"gun_id": "GUN-A-3D4F", "sticker": "GUN-A", "ble": {"tail": "3D4F"}}}
            p = st.add_player("ALPHA", "GUN-A-3D4F", team_id="blue")
            body, code, ws = await _raw_hello(st.url, {"node_id": "squatter", "node_type": "phone", "app_ver": "x", "seq_next": 1,
                                                        "gun": {"name": "GUN-A-3D4F", "tail": "3D4F"}})
            assert code is None and (body or {}).get("node"), "the squatter binds first (names are public)"
            hb = asyncio.create_task(_heartbeat(ws, "squatter"))
            assert await until(lambda: st.session.players[p["player_id"]]["node_id"] == "squatter", 2)
            # the legit phone is refused while the squatter is fresh
            b2, c2, ws2 = await _raw_hello(st.url, {"node_id": "phone-A", "node_type": "phone", "app_ver": "x", "seq_next": 1,
                                                     "gun": {"name": "GUN-A-3D4F", "tail": "3D4F"}})
            assert c2 == 4003, (b2, c2)
            await ws2.close()
            # operator kicks the squatter
            assert st.session.evict_node("squatter") is True
            assert st.session.evict_node("nobody") is False
            assert await until(lambda: ws.state.name == "CLOSED", 2)
            assert ws.close_code == 4000
            hb.cancel()
            assert st.session.players[p["player_id"]]["node_id"] is None
            assert "squatter" not in st.session.node_player and "squatter" not in st.session.nodes
            # the real phone now binds and gets pushes
            a = await st.connect_node("GUN-A-3D4F", node_id="phone-A")
            assert await until(lambda: st.session.players[p["player_id"]]["node_id"] == "phone-A", 3)
            assert st.net.nodes["phone-A"].player_id == p["player_id"]
            assert st.net.stats["evicted"] == 1
            # the squatter cannot reconnect with the key it was welcomed with and take the gun back
            b3, c3, ws3 = await _raw_hello(st.url, {"node_id": "squatter", "node_type": "phone", "app_ver": "x", "seq_next": 1,
                                                     "node_key": (body or {}).get("node_key"), "gun": {"name": "GUN-A-3D4F", "tail": "3D4F"}})
            assert c3 == 4003, (b3, c3)
            await ws3.close()
            assert a.connected and st.session.players[p["player_id"]]["node_id"] == "phone-A"
    asyncio.run(asyncio.wait_for(go(), 40))


def test_evict_route_is_auth_gated_and_404s_unknown():
    if not HAVE:
        return
    from brx_mcp.mc.api import create_app
    s = _sess()
    c = TestClient(create_app(s, token="secret"))
    assert c.delete("/api/nodes/x").status_code == 401
    assert c.delete("/api/nodes/x?tok=secret").status_code == 404
    s.net.simulate_hello("n1", "GUN-Z-1111")
    assert "n1" in s.nodes
    assert c.delete("/api/nodes/n1?tok=secret").status_code == 200
    assert "n1" not in s.nodes


def test_displaced_owner_returning_with_key_wins_back_its_gun():
    """MEDIUM: a keyless hello may take a STALE owner's gun (A8.2 hot-swap) — but out of coverage is normal on a park, so the
    owner's phone coming back WITH its key must win over the displacer even while the displacer is fresh; and the
    displacer must not be able to use its own key to take the gun straight back."""
    Stack, until = _ws_stack()
    if Stack is None:
        return
    import asyncio

    async def go():
        async with Stack(time_limit_s=60) as st:
            st.session.guns = {"GUN-A-3D4F": {"gun_id": "GUN-A-3D4F", "sticker": "GUN-A", "ble": {"tail": "3D4F"}},
                               "GUN-B-4E60": {"gun_id": "GUN-B-4E60", "sticker": "GUN-B", "ble": {"tail": "4E60"}}}
            p, q, a, b = await _two_live(st)
            st.net.stale_after_ms = 400
            a._paused = True                      # ALPHA walks out of coverage
            await asyncio.sleep(0.8)
            wb, code, ws = await _raw_hello(st.url, {"node_id": "hijacker", "node_type": "phone", "app_ver": "x", "seq_next": 1,
                                                      "gun": {"name": "GUN-A-3D4F", "tail": "3D4F"}})
            assert code is None and (wb or {}).get("node"), "stale owner is displaced (hot-swap rule)"
            hb = asyncio.create_task(_heartbeat(ws, "hijacker"))
            assert await until(lambda: st.session.players[p["player_id"]]["node_id"] == "hijacker", 2)
            assert a.node_key in st.net.nodes["hijacker"].displaced_keys
            # the owner comes back into coverage with its key: it wins, the hijacker is closed 4000
            a._paused = False
            assert await until(lambda: st.session.players[p["player_id"]]["node_id"] == "phone-A", 4), st.session.players[p["player_id"]]
            assert await until(lambda: ws.state.name == "CLOSED", 2)
            assert ws.close_code == 4000
            hb.cancel()
            assert await until(lambda: a.connected, 2)
            assert st.net.nodes["phone-A"].displaced_keys == set(), "a proven displacement records nothing"
            # the hijacker's own key must NOT take the gun back while the owner is fresh
            b2, c2, ws2 = await _raw_hello(st.url, {"node_id": "hijacker", "node_type": "phone", "app_ver": "x", "seq_next": 1,
                                                     "node_key": (wb or {}).get("node_key"), "gun": {"name": "GUN-A-3D4F", "tail": "3D4F"}})
            assert c2 == 4003, (b2, c2)
            await ws2.close()
            assert st.session.players[p["player_id"]]["node_id"] == "phone-A"
    asyncio.run(asyncio.wait_for(go(), 60))


def test_empty_gun_name_with_a_tail_does_not_bind_a_gunless_player():
    """MEDIUM: `hello.gun = {name: "", tail: "BEEF"}` matched a roster entry with gun_id=None ("" in ("", …))."""
    s = _sess()
    z = s.add_player("ZULU")                       # no gun yet
    assert s._find_player_for_gun("", "BEEF") is None
    assert s._find_player_for_gun("", "") is None
    assert s._find_player_for_gun(None, "beef") is None
    s.net.simulate_hello("rogue", "")
    s._on_node({"node_id": "rogue", "node_type": "phone", "gun_name": "", "gun_tail": "BEEF"})
    assert s.players[z["player_id"]]["node_id"] is None and "rogue" not in s.node_player
    # a real gun still resolves
    s.patch_player(z["player_id"], gun_id="GUN-Z-BEEF")
    assert s._find_player_for_gun("GUN-Z-BEEF", "BEEF")["player_id"] == z["player_id"]
    s.guns["GUN-Z-BEEF"] = {"gun_id": "GUN-Z-BEEF", "sticker": "GUN-Z", "ble": {"tail": "BEEF"}}
    assert s._find_player_for_gun("gun-z-0000", "0000")["player_id"] == z["player_id"]     # base-name match via the registry
    assert s._find_player_for_gun("", "beef")["player_id"] == z["player_id"]               # tail-only match via the registry


def test_prune_and_rehello_rejection_are_quiet():
    """LOW: unbound + disconnected records older than PRUNE_AFTER_MS are dropped by the stale loop; a refused re-hello on
    a live socket never leaves an unretrieved task exception."""
    Stack, until = _ws_stack()
    if Stack is None:
        return
    import asyncio, logging
    from brx_mcp.mc import net as N

    async def go():
        async with Stack(time_limit_s=30) as st:
            st.session.guns = {"GUN-A-3D4F": {"gun_id": "GUN-A-3D4F", "sticker": "GUN-A", "ble": {"tail": "3D4F"}}}
            p = st.add_player("ALPHA", "GUN-A-3D4F", team_id="blue")
            a = await st.connect_node("GUN-A-3D4F", node_id="phone-A")
            assert await until(lambda: st.session.players[p["player_id"]]["node_id"] == "phone-A", 3)
            for i in range(5):
                body, code, ws = await _raw_hello(st.url, {"node_id": f"throwaway-{i}", "node_type": "phone", "app_ver": "x", "seq_next": 1})
                await ws.close()
            assert await until(lambda: all(st.net.nodes[f"throwaway-{i}"].ws is None for i in range(5)), 2)
            for i in range(5):
                st.net.nodes[f"throwaway-{i}"].last_seen -= N.PRUNE_AFTER_MS / 1000 + 5
            assert await until(lambda: not any(f"throwaway-{i}" in st.net.nodes for i in range(5)), 3)
            assert "phone-A" in st.net.nodes                # bound records are never pruned
            # re-hello on the live socket naming another player's gun → refused, socket closed, no stray task exception
            q = st.add_player("BRAVO", "GUN-B-4E60", team_id="yellow")
            b = await st.connect_node("GUN-B-4E60", node_id="phone-B")
            assert await until(lambda: st.session.players[q["player_id"]]["node_id"] == "phone-B", 3)
            stray = []
            loop = asyncio.get_running_loop()
            loop.set_exception_handler(lambda l, ctx: stray.append(ctx))
            from brx_mcp.mc import envelope as E
            await a._ws.send(E.encode(E.make_envelope("hello", {"node_id": "phone-A", "node_type": "phone", "app_ver": "x", "seq_next": 1,
                                                                  "node_key": a.node_key, "gun": {"name": "GUN-B-4E60", "tail": "4E60"}})))
            await asyncio.sleep(0.5)
            assert st.session.players[q["player_id"]]["node_id"] == "phone-B"
            assert not stray, stray
            loop.set_exception_handler(None)
    asyncio.run(asyncio.wait_for(go(), 40))
