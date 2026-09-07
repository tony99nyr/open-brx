"""Tests for gamertag/callsign assignment — clean_callsign + driver $NAME push."""

import asyncio

from _async import run as _run

from brx_mcp.gameconfig import GameConfig
from brx_mcp.modes import GameDriver, clean_callsign


def test_clean_callsign_strips_frame_breakers_and_caps():
    assert clean_callsign("Reaper") == "Reaper"
    assert clean_callsign("  Ghost  ") == "Ghost"
    assert clean_callsign("Ba,d$Na*me") == "BadName"       # comma/$/* removed
    assert clean_callsign("A" * 40) == "A" * 12            # capped at CALLSIGN_MAX
    assert clean_callsign(None) == "" and clean_callsign("") == ""
    assert clean_callsign("   ") == ""


def test_clean_callsign_caps_by_wire_bytes_not_python_characters():
    from brx_mcp.modes.driver import CALLSIGN_MAX
    # "Ω" is one Python character but TWO UTF-8 bytes. 20 of them is well inside
    # CALLSIGN_MAX by character count, but 40 bytes on a wire field sized for
    # "Tactix2" — the old `safe[:CALLSIGN_MAX]` sliced code points, not bytes, and
    # would ship a frame several times the field's real budget.
    out = clean_callsign("Ω" * 20)
    assert len(out.encode("utf-8")) <= CALLSIGN_MAX
    assert out == "Ω" * 6                       # 12 bytes / 2 bytes-per-char, exact cut
    # a cut that lands mid-character (1-byte "A" + 2-byte "Ω"s, budget of 12) must drop
    # the dangling partial character rather than ship a mangled trailing byte
    assert clean_callsign("A" + "Ω" * 20) == "A" + "Ω" * 5




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
