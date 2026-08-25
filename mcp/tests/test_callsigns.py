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


def test_callsigns_are_display_only_never_pushed_as_name():
    sent = []

    async def sender(pid, frame):
        sent.append((pid, frame))

    cfg = GameConfig(mode="tdm")
    drv = GameDriver(cfg, {"AA": 1, "BB": 2}, sender,
                     callsigns={"AA": "Reaper", "BB": "Gh,ost"})
    _run(drv.setup())
    # the vanity gamertag must NOT clobber the gun's sticker-id $NAME
    assert not [f for (_, f) in sent if f.startswith("$NAME")]
    # but it IS echoed in the snapshot for the scoreboard (sanitized)
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
    assert drv.snapshot()["callsigns"] == {"AA": "Nova"}    # display only, no $NAME
    assert not [f for (_, f) in sent if f.startswith("$NAME")]
