"""Tests for gamertag/callsign assignment — clean_callsign + driver $NAME push."""

import asyncio

from brx_mcp.gameconfig import GameConfig
from brx_mcp.modes import GameDriver, clean_callsign


def test_clean_callsign_strips_frame_breakers_and_caps():
    assert clean_callsign("Reaper") == "Reaper"
    assert clean_callsign("  Ghost  ") == "Ghost"
    assert clean_callsign("Ba,d$Na*me") == "BadName"       # comma/$/* removed
    assert clean_callsign("A" * 40) == "A" * 12            # capped at CALLSIGN_MAX
    assert clean_callsign(None) == "" and clean_callsign("") == ""
    assert clean_callsign("   ") == ""


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_driver_pushes_name_frame_and_echoes_snapshot():
    sent = []

    async def sender(pid, frame):
        sent.append((pid, frame))

    cfg = GameConfig(mode="tdm")
    drv = GameDriver(cfg, {"AA": 1, "BB": 2}, sender,
                     callsigns={"AA": "Reaper", "BB": "Gh,ost"})
    _run(drv.setup())
    names = [f for (_, f) in sent if f.startswith("$NAME")]
    assert "$NAME,Reaper,*" in names
    assert "$NAME,Ghost,*" in names                         # sanitized (comma dropped)
    # snapshot echoes callsigns so a scoreboard can label by gamertag
    assert drv.snapshot()["callsigns"] == {"AA": "Reaper", "BB": "Ghost"}


def test_driver_without_callsigns_sends_no_name_and_omits_key():
    sent = []

    async def sender(pid, frame):
        sent.append((pid, frame))

    drv = GameDriver(GameConfig(mode="tdm"), {"AA": 1}, sender)
    _run(drv.setup())
    assert not [f for (_, f) in sent if f.startswith("$NAME")]
    assert "callsigns" not in drv.snapshot()


def test_blank_callsign_is_dropped_not_pushed():
    sent = []

    async def sender(pid, frame):
        sent.append((pid, frame))

    drv = GameDriver(GameConfig(mode="tdm"), {"AA": 1, "BB": 2}, sender,
                     callsigns={"AA": "Nova", "BB": "   "})
    _run(drv.setup())
    assert drv.callsigns == {"AA": "Nova"}                  # blank BB dropped
    assert "$NAME,Nova,*" in [f for (_, f) in sent if f.startswith("$NAME")]
