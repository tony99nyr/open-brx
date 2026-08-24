"""Tests for the Extraction→driver adapter (runs the flagship engine on run_live)."""

from brx_mcp.gameconfig import GameConfig
from brx_mcp.modes import build_engine, ExtractionEngineAdapter
from brx_mcp.modes.driver import assign_teams
from brx_mcp.modes import base
from brx_mcp.modes import extraction as ex


def _cfg(**kw):
    return GameConfig(mode="extraction", **kw)


def hir(team):
    return {"command": "HIR", "tokens": ["HIR", "0", "0", "0", str(team), "9", "0", "3"]}


def death():
    return {"command": "HP", "tokens": ["HP", "0", "0", "0"]}


def zone(z):
    return {"command": "ZONE", "tokens": ["ZONE", z]}


def loot(v):
    return {"command": "LOOT", "tokens": ["LOOT", str(v)]}


def _types(actions, typ):
    return [a for a in actions if isinstance(a, typ)]


def test_build_engine_and_teams():
    e = build_engine(_cfg())
    assert isinstance(e, ExtractionEngineAdapter)
    # extraction assigns unique teams (FFA) → 1:1 kill attribution
    assert assign_teams("extraction", ["a", "b", "c"]) == {"a": 1, "b": 2, "c": 3}


def test_loot_zone_extract_flow_scores():
    e = ExtractionEngineAdapter(_cfg(channel_s=10.0, win_target=5, respawn_s=5))
    e.add_player("red", 1); e.add_player("blue", 2)
    e.on_event("red", loot(5), now=0.0)                 # red carries 5
    starts = e.on_event("red", zone("Alpha"), now=1.0)  # channel begins → loud alarm
    assert _types(starts, base.PlaySound)
    assert e.tick(now=6.0) == []                         # channel not done
    done = e.tick(now=11.0)                              # 10s held → extract + win
    assert _types(done, base.Score) and _types(done, base.GameOver)
    assert e.snapshot()["winner"] == "red"


def test_kill_drops_loot_and_credits_killer():
    e = ExtractionEngineAdapter(_cfg(loot_per_kill=10))
    e.add_player("red", 1); e.add_player("blue", 2)
    e.on_event("blue", loot(20), now=0.0)               # blue carries 20
    e.on_event("blue", hir(1), now=1.0)                 # red (team1) tags blue
    acts = e.on_event("blue", death(), now=1.5)         # blue down → loot drops
    assert _types(acts, base.Callout)                    # loot-dropped callout
    game = e._ensure()
    assert game.status("blue") is ex.Status.DOWN
    assert game.carried("red") == 10                     # kill-loot to the killer


def test_host_respawn_after_delay():
    e = ExtractionEngineAdapter(_cfg(respawn_s=5))
    e.add_player("red", 1); e.add_player("blue", 2)
    e.on_event("blue", hir(1), now=0.0)
    e.on_event("blue", death(), now=0.5)                # blue down
    assert e.tick(now=3.0) == []                         # too soon
    acts = e.tick(now=6.0)                               # 5s later → respawn
    assert _types(acts, base.Respawn)
    assert e._ensure().status("blue") is ex.Status.ALIVE


def test_leave_zone_resets_channel():
    e = ExtractionEngineAdapter(_cfg(channel_s=10.0))
    e.add_player("red", 1)
    e.on_event("red", zone("Alpha"), now=0.0)
    e.on_event("red", {"command": "LEAVE", "tokens": ["LEAVE"]}, now=3.0)
    # channel reset → tick at 11s must NOT complete an extraction
    assert e.tick(now=11.0) == []
    assert e.snapshot()["players"]["red"]["banked"] == 0
