"""F411 §6: FAVOURITES -- a named bundle of the whole PLAY pick (docs/spec/design/games-presets.md §6).

`FavouriteStore` (CRUD, name clash, persistence across a restart, corrupt file) · the `/api/favourites*`
routes, including `POST /api/favourites/{id}/load` composing through the same path
`POST /api/play/pick` uses (ok:false leaves state alone) and falling back a deleted/post_mvp piece
reference to that kind's first builtin.

Run: python3 run_tests.py favourites
"""
from __future__ import annotations

import json
import pathlib
import tempfile

from _skip import needs
from brx_mcp.mc.favourites import FavouriteError, FavouriteStore, check_pick
from brx_mcp.mc.pieces import BUILTIN_IDS
from brx_mcp.mc.types import PIECE_KINDS
from test_mc_loadout import mk, online

try:
    from starlette.testclient import TestClient
    import httpx  # noqa: F401
    HAVE = True
except Exception:
    HAVE = False


def _store(tmp=None):
    path = pathlib.Path(tmp or tempfile.mkdtemp()) / "favourites.json"
    return FavouriteStore(path), path


def _pick(**match_overrides):
    match = {"time_limit_s": 600, "frag_limit": None, "night": False, "silenced": False}
    match.update(match_overrides)
    return {"pieces": dict(BUILTIN_IDS), "match": match}


# ---------------------------------------------------------------- store CRUD
def test_crud_and_name_clash():
    st, path = _store()
    assert st.list() == []
    row = st.create("Friday Sniper", 30, _pick(frag_limit=15))
    assert row["name"] == "Friday Sniper" and row["countdown_s"] == 30 and path.exists()
    assert row["pick"]["match"]["frag_limit"] == 15
    assert [r["name"] for r in st.list()] == ["Friday Sniper"]
    try:
        st.create("friday sniper", 10, _pick()); assert False
    except FavouriteError as e:
        assert e.status == 409
    row2 = st.update(row["favourite_id"], "Friday Night")
    assert row2["name"] == "Friday Night" and st.get(row["favourite_id"])["name"] == "Friday Night"
    st.create("Other", 20, _pick())
    try:
        st.update(row["favourite_id"], "other"); assert False
    except FavouriteError as e:
        assert e.status == 409
    for bad in (lambda: st.get("nope"), lambda: st.update("nope", "x"), lambda: st.delete("nope")):
        try:
            bad(); assert False
        except FavouriteError as e:
            assert e.status == 404
    st.delete(row["favourite_id"])
    assert [r["name"] for r in st.list()] == ["Other"]


def test_name_and_countdown_and_pick_shape_limits():
    st, _ = _store()
    try:
        st.create("", 30, _pick()); assert False
    except FavouriteError as e:
        assert e.status == 400
    try:
        st.create("x" * 25, 30, _pick()); assert False
    except FavouriteError as e:
        assert e.status == 400
    for bad_cd in (4, 901, "30", 30.0, True, None):
        try:
            st.create("Bad", bad_cd, _pick()); assert False, bad_cd
        except FavouriteError as e:
            assert e.status == 400
    assert st.create("Edge Low", 5, _pick())["countdown_s"] == 5
    assert st.create("Edge High", 900, _pick())["countdown_s"] == 900
    bad_picks = [
        {},
        {"pieces": {k: BUILTIN_IDS[k] for k in PIECE_KINDS if k != "mode"}, "match": _pick()["match"]},  # missing a kind
        {"pieces": dict(BUILTIN_IDS), "match": {"time_limit_s": 600, "frag_limit": None, "night": "no", "silenced": False}},
    ]
    for bp in bad_picks:
        try:
            st.create("Bad Pick", 30, bp); assert False, bp
        except FavouriteError as e:
            assert e.status == 400


def test_persistence_across_a_restart():
    st, path = _store()
    row = st.create("Friday Sniper", 45, _pick(night=True))
    st2 = FavouriteStore(path)
    assert [r["name"] for r in st2.list()] == ["Friday Sniper"]
    assert st2.get(row["favourite_id"])["pick"]["match"]["night"] is True
    assert st2.get(row["favourite_id"])["countdown_s"] == 45


def test_corrupt_file_is_moved_aside_not_fatal():
    _, path = _store()
    path.write_text("{not json")
    st = FavouriteStore(path)
    assert st.list() == []
    assert any(f.name.startswith("favourites.json.corrupt-") for f in path.parent.iterdir())
    st.create("Fresh", 30, _pick())
    assert path.exists()


def test_a_hand_written_file_drops_only_the_bad_row():
    _, path = _store()
    path.write_text(json.dumps({"v": 1, "favourites": [
        {"favourite_id": "f1", "name": "Fine", "countdown_s": 30, "pick": _pick()},
        {"favourite_id": "f2", "name": "Bad Countdown", "countdown_s": 2, "pick": _pick()},
        {"favourite_id": "f3", "name": "Bad Pick", "countdown_s": 30, "pick": {}},
    ]}))
    st = FavouriteStore(path)
    assert [r["name"] for r in st.list()] == ["Fine"]


# ---------------------------------------------------------------- routes
def _pclient():
    from brx_mcp.mc.api import create_app
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    return TestClient(create_app(s)), s, net, clock, ps


def test_routes_crud_and_404_409():
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    assert c.get("/api/favourites").json() == []
    r = c.post("/api/favourites", json={"name": "Friday Sniper", "countdown_s": 30})
    assert r.status_code == 200
    fid = r.json()["favourite_id"]
    assert r.json()["pick"] == s.game_pick    # default: the current pick
    assert c.post("/api/favourites", json={"name": "friday sniper", "countdown_s": 10}).status_code == 409
    assert c.post("/api/favourites", json={"name": "", "countdown_s": 10}).status_code == 400
    assert c.put("/api/favourites/nope", json={"name": "x"}).status_code == 404
    assert c.delete("/api/favourites/nope").status_code == 404
    assert c.post("/api/favourites/nope/load").status_code == 404
    r2 = c.put(f"/api/favourites/{fid}", json={"name": "Friday Night"})
    assert r2.status_code == 200 and r2.json()["name"] == "Friday Night"
    assert c.delete(f"/api/favourites/{fid}").json() == {"ok": True}
    assert c.get("/api/favourites").json() == []


def test_load_applies_pieces_and_match():
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    # build a bundle: STATION spawn, a kill limit, night, silenced -- then save it
    station = next(p["piece_id"] for p in c.get("/api/pieces").json() if p["kind"] == "spawn" and p["name"] == "STATION")
    r = c.post("/api/play/pick", json={"pieces": {"spawn": station}, "match": {"frag_limit": 15, "night": True, "silenced": True}})
    assert r.json()["ok"], r.json()
    fav = c.post("/api/favourites", json={"name": "Silent Station", "countdown_s": 15}).json()
    # reset the pick back to defaults
    default_spawn = next(p["piece_id"] for p in c.get("/api/pieces").json() if p["kind"] == "spawn" and p["name"] == "AUTO")
    c.post("/api/play/pick", json={"pieces": {"spawn": default_spawn}, "match": {"frag_limit": None, "night": False, "silenced": False}})
    assert s.config["respawn"]["type"] == "auto" and s.config["night"] is False
    # LOAD the favourite: the bundle comes back, in one call
    r2 = c.post(f"/api/favourites/{fav['favourite_id']}/load")
    body = r2.json()
    assert r2.status_code == 200 and body["ok"], body
    assert body["config"]["respawn"]["type"] == "scanner"
    assert body["config"]["night"] is True
    assert body["config"]["scoring"]["frag_limit"] == 15
    assert body["config"]["presentation"]["preset"] == "silenced"
    assert body["countdown_s"] == 15 and body["fallbacks"] == []
    assert s.game_pick["pieces"]["spawn"] == station


def test_load_falls_back_a_deleted_piece_and_reports_it():
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    made = c.post("/api/pieces", json={"kind": "life", "name": "Glass Cannon", "note": "",
                                       "value": {"max_hp": 30, "max_armor": 0, "max_shield": 0}}).json()
    pid = made["piece_id"]
    c.post("/api/play/pick", json={"pieces": {"life": pid}})
    fav = c.post("/api/favourites", json={"name": "Uses Glass Cannon", "countdown_s": 20}).json()
    # un-pick it (so it is no longer IN USE), then delete it
    c.post("/api/play/pick", json={"pieces": {"life": BUILTIN_IDS["life"]}})
    assert c.delete(f"/api/pieces/{pid}").json() == {"ok": True}
    r = c.post(f"/api/favourites/{fav['favourite_id']}/load")
    body = r.json()
    assert r.status_code == 200 and body["ok"], body
    assert body["fallbacks"] == ["life"]
    assert body["config"]["health"]["preset"] == "standard"    # the first LIFE builtin
    assert body["pick"]["pieces"]["life"] == BUILTIN_IDS["life"]


def test_load_a_post_mvp_mode_piece_falls_back_too():
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    infection = next(p["piece_id"] for p in c.get("/api/pieces").json() if p["kind"] == "mode" and p["value"]["mode"] == "infection")
    # a favourite CAN be built naming a post_mvp piece directly (only /api/play/pick refuses it) --
    # write one straight into the store to prove LOAD's own fallback, not PICK's refusal.
    pick = dict(s.game_pick)
    pick["pieces"] = {**pick["pieces"], "mode": infection}
    fav = s.favourites.create("Post-MVP Mode", 30, pick)
    r = c.post(f"/api/favourites/{fav['favourite_id']}/load")
    body = r.json()
    assert r.status_code == 200 and body["ok"], body
    assert body["fallbacks"] == ["mode"]
    assert body["config"]["mode"] == "tdm"


def test_load_ok_false_changes_nothing():
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    ghost = c.post("/api/pieces", json={"kind": "primary", "name": "Ghost Gun", "note": "",
                                        "value": {"choice": "fixed", "fixed_id": "smoke_gun"}}).json()
    pick = dict(s.game_pick)
    pick["pieces"] = {**pick["pieces"], "primary": ghost["piece_id"]}
    fav = s.favourites.create("Broken", 30, pick)
    before_config, before_pick = dict(s.config), dict(s.game_pick)
    r = c.post(f"/api/favourites/{fav['favourite_id']}/load")
    body = r.json()
    assert r.status_code == 200 and body["ok"] is False
    assert s.config == before_config
    assert s.game_pick == before_pick


def test_favourites_are_memory_only_when_no_store_attached():
    """The same "no session attached yet" fallback `_pieces` gives `PieceStore` (api.py's own
    memory-only default), so a bare `Session()` handed straight to `create_app` still serves the routes."""
    needs(HAVE, "starlette + httpx")
    from brx_mcp.mc.api import create_app
    from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
    from brx_mcp.mc.state import Session
    s = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    assert s.favourites is None
    c = TestClient(create_app(s))
    assert c.get("/api/favourites").json() == []
    assert c.post("/api/favourites", json={"name": "X", "countdown_s": 30}).status_code == 200


# ================================================================== independent review (brx1)
def test_low_piece_id_length_cap_in_a_favourite_pick():
    """Lows: a length cap on ids in favourites and picks (64 chars, 400 beyond)."""
    huge_pick = _pick()
    huge_pick["pieces"]["life"] = "x" * 65
    try:
        check_pick(huge_pick)
        assert False
    except FavouriteError as e:
        assert e.status == 400
    ok_pick = _pick()
    ok_pick["pieces"]["life"] = "x" * 64
    assert check_pick(ok_pick)["pieces"]["life"] == "x" * 64


def test_medium5_messages_are_all_caps_what_colon_do():
    st, _ = _store()
    row = st.create("Original", 30, _pick())
    try:
        st.create("original", 30, _pick())
        assert False
    except FavouriteError as e:
        assert str(e) == "NAME ALREADY USED: PICK ANOTHER NAME FOR THIS FAVOURITE"
    try:
        st.get("nope")
        assert False
    except FavouriteError as e:
        assert str(e) == "FAVOURITE NOT FOUND: IT MAY HAVE BEEN DELETED"
