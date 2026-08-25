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
