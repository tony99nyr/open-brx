"""F366: a gamertag is at most MAX_TAG_LEN characters, and MC refuses a longer one instead of cutting it.

Tony (2026-09-25): "in the armory we should warn or prevent long gamer tags", then "366 sounds good". The hard
limit is 16 (a refusal, never a silent cut); past the soft limit of 12 the console warns that the phone HUD may
shorten the name, and MC accepts it. Each test pairs the refusal with a control at the limit.
"""
from __future__ import annotations

from _skip import needs

from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from brx_mcp.mc.state import Session
from brx_mcp.mc.types import MAX_TAG_LEN, SOFT_TAG_LEN

try:
    from starlette.testclient import TestClient
    import httpx  # noqa: F401
    HAVE = True
except Exception:
    HAVE = False


def _sess():
    return Session(Compiler(), FakeNet(), FakeArmory(demo_armory()))


def _refused(fn) -> str:
    try:
        fn()
    except ValueError as e:
        return str(e)
    raise AssertionError("a gamertag over the limit was accepted")


def test_the_limits_are_sixteen_and_twelve():
    assert (MAX_TAG_LEN, SOFT_TAG_LEN) == (16, 12)


def test_add_refuses_a_long_tag_and_keeps_one_at_the_limit_whole():
    s = _sess()
    msg = _refused(lambda: s.add_player("x" * (MAX_TAG_LEN + 1)))
    assert "17" in msg and "16" in msg, msg
    assert not s.players, "a refused add must not leave a player behind"
    # CONTROL: exactly 16 is kept whole, upper-cased
    p = s.add_player("xX_SNIPER_Xx_ABC")
    assert p["display"] == "XX_SNIPER_XX_ABC" and len(p["display"]) == MAX_TAG_LEN


def test_the_limit_counts_the_trimmed_upper_cased_tag():
    s = _sess()
    p = s.add_player("   " + "a" * MAX_TAG_LEN + "   ")      # spaces around it are not part of the tag
    assert p["display"] == "A" * MAX_TAG_LEN
    # "ß" upper-cases to "SS": the stored tag is what is counted
    _refused(lambda: s.add_player("ß" * (MAX_TAG_LEN // 2 + 1)))


def test_a_rename_refuses_a_long_tag_and_leaves_the_old_one():
    s = _sess()
    p = s.add_player("GHOST")
    _refused(lambda: s.patch_player(p["player_id"], display="y" * (MAX_TAG_LEN + 1)))
    assert s.players[p["player_id"]]["display"] == "GHOST"
    # CONTROL: a rename at the limit is kept whole
    s.patch_player(p["player_id"], display="y" * MAX_TAG_LEN)
    assert s.players[p["player_id"]]["display"] == "Y" * MAX_TAG_LEN


def test_a_stored_long_tag_keeps_working_until_it_is_renamed():
    """A roster from an MC before F366 can hold a tag up to 24. It is not refused on other edits."""
    s = _sess()
    p = s.add_player("GHOST")
    s.players[p["player_id"]]["display"] = "Z" * 24          # as restored from an older snapshot
    s.patch_player(p["player_id"], ready=True)
    assert s.players[p["player_id"]]["display"] == "Z" * 24


def test_the_api_refuses_with_a_400_and_never_cuts():
    needs(HAVE, "starlette + httpx")
    from brx_mcp.mc.api import create_app
    s = _sess()
    c = TestClient(create_app(s))
    r = c.post("/api/players", json={"display": "w" * 20})
    assert r.status_code == 400 and "16" in r.json()["error"], r.text
    assert not s.players, "the old API cut the tag to 24 and added the player"
    # CONTROL: a tag at the limit is added whole
    r = c.post("/api/players", json={"display": "w" * MAX_TAG_LEN})
    assert r.status_code == 200 and r.json()["display"] == "W" * MAX_TAG_LEN
    pid = r.json()["player_id"]
    r = c.patch(f"/api/players/{pid}", json={"display": "v" * 17})
    assert r.status_code == 400 and s.players[pid]["display"] == "W" * MAX_TAG_LEN
