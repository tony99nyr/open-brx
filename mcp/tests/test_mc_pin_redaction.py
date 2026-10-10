"""OP2 (maintainability review 2026-10-10, High): a gun's id IS its headset PIN (armory.py), and the open GETs
`/api/state` and `/api/armory` served it to anyone on the field LAN although every other path treats it as private
(report.py scrubs it). Without the operator token those two answers carry no PIN; with it, nothing changes."""
from _skip import needs

try:
    from starlette.testclient import TestClient
    import httpx  # noqa: F401
    HAVE = True
except Exception:
    HAVE = False

PINS = ("731905", "448210")
TOK = "op-token"


def _app():
    from brx_mcp.mc.api import create_app
    from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet
    from brx_mcp.mc.state import Session
    recs = [{"gun_id": pin, "sticker": name, "headset_pin": pin, "ble": {"tail": tail}, "gen": "gen2_3", "fw": "v4.32",
             "labeled": True} for pin, name, tail in zip(PINS, ("ALPHA", "BRAVO"), ("FE30", "9498"))]
    s = Session(FakeCompiler(), FakeNet(), FakeArmory(recs))
    s.set_config({"mode": "tdm", "time_limit_s": 600})
    for i, pin in enumerate(PINS):
        s.add_player(f"OP{i}", gun_id=pin)
    s.set_phase("kit")
    return TestClient(create_app(s, token=TOK)), s


def test_a_spectator_never_sees_a_headset_pin():
    needs(HAVE, "starlette/httpx")
    c, _s = _app()
    for route in ("/api/state", "/api/armory"):
        body = c.get(route).text
        assert not [p for p in PINS if p in body], (route, "a PIN reached a request with no operator token")


def test_the_operator_still_sees_the_pins():
    needs(HAVE, "starlette/httpx")
    c, _s = _app()
    for route in ("/api/state", "/api/armory"):
        r = c.get(route, headers={"Authorization": f"Bearer {TOK}"})
        assert r.status_code == 200 and all(p in r.text for p in PINS), (route, "control: the operator's own view")
    assert all(p in c.get(f"/api/armory?tok={TOK}").text for p in PINS), "the ?tok= form counts too"


def test_a_spectator_still_gets_the_board():
    needs(HAVE, "starlette/httpx")
    c, s = _app()
    st = c.get("/api/state").json()
    assert [p["display"] for p in st["players"]] == [p["display"] for p in s.players.values()]
    assert all(row.get("sticker") for row in c.get("/api/armory").json()), "the sticker names the gun instead"


def test_a_gun_missing_from_the_armory_does_not_leak_its_pin_through_the_sticker():
    """OP2 review (Codex r1, High): the readiness row names a gun with no armory record by its gun_id, which is its PIN
    (state.py `sticker` fallback), so blanking the `gun_id` key alone left it in the sticker."""
    needs(HAVE, "starlette/httpx")
    c, s = _app()
    s.add_player("STRAY", gun_id="905517")   # an id the armory has never heard of
    body = c.get("/api/state").text
    assert "905517" not in body, "the unknown gun's PIN reached a request with no operator token"
    assert "905517" in c.get("/api/state", headers={"Authorization": f"Bearer {TOK}"}).text, "control: the operator sees it"


def test_a_spectators_armory_view_has_no_free_text_notes():
    """OP2 review (Opus r1): a PIN inside longer text (an armory `notes` field) is not caught by the exact-value rule, so
    the spectator view leaves the free text out."""
    needs(HAVE, "starlette/httpx")
    c, s = _app()
    rows = s.armory.list()
    rows[0]["notes"] = "head 731905 swapped"
    s.armory.list = lambda: rows
    assert "731905" not in c.get("/api/armory").text
    assert "head 731905 swapped" in c.get(f"/api/armory?tok={TOK}").text, "control: the operator keeps the notes"
