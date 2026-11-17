"""F665: the stage mirrors the phone's melee not-ready sound (engine.js `_meleeNotReadyCue`).

N92 is the default. A melee press inside the cooldown plays it once, at the press, while live and alive. A busy speaker
drops it. An explicit empty id (`set_melee_not_ready("")`) turns it off.
"""
from __future__ import annotations

import asyncio

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage.stage import GunStage
from _stage import GUN, StageClock, _nosleep, settle

NOT_READY = "$PLAY,,4,6,N92,,,,*"
SWING_ALCD = "$ALCD,1,100,4,0,0,*"


async def _live():
    clock = StageClock()
    gun = FakeTagger(GUN, "FAKE-STAGE", team=1, clock=clock)
    mgr = FakeConnectionManager([gun])
    st = GunStage(mgr, None, sleep=_nosleep, now=clock, voice_verdict_sink=lambda _r: None)
    await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
    st.poll(); await settle(st)
    for _ in range(3):
        clock.t += 0.5; mgr.pump(); st.poll(); await settle(st)
    await _quiet(st, clock)
    return st, clock


async def _quiet(st, clock) -> None:
    """Past the go-live audio and any cooldown."""
    for _ in range(2):
        clock.t += 30.0; st.mgr.pump(); st.poll(); await settle(st)


def _tx(st) -> list[str]:
    return [e["raw"] for e in st.mgr.get_events("stage", max_events=10**6)["events"] if e["direction"] == "tx"]


async def _swing(st, clock) -> None:
    st._on_rx("$BUT,8,1,*"); clock.t += 0.01; st._on_rx(SWING_ALCD); st._on_rx("$BUT,8,0,*"); await settle(st)


async def _press(st) -> None:
    st._on_rx("$BUT,8,1,*"); st._on_rx("$BUT,8,0,*"); await settle(st)


def test_default_is_n92_and_a_refused_press_plays_it_once():
    async def run():
        st, clock = await _live()
        assert st.melee_not_ready == "N92", "no setting: the default is N92"
        assert st._melee_buttons() == [8] and st._fire_interval_s(4) == 3.0, "setup: a melee line and button in the head"
        await _swing(st, clock)
        assert _tx(st).count(NOT_READY) == 0, "the swing itself is not refused"
        clock.t += 0.05
        await _press(st)
        assert _tx(st).count(NOT_READY) == 1, "a press inside the cooldown: one sound, at the press"
        await _quiet(st, clock)
        await _swing(st, clock)
        assert _tx(st).count(NOT_READY) == 1, "a press after the cooldown is a swing: no sound"
    asyncio.run(run())


def test_off_a_busy_speaker_and_a_down_player_get_no_sound():
    async def run():
        st, clock = await _live()
        await _swing(st, clock); clock.t += 0.05
        assert st.set_melee_not_ready("") is None
        await _press(st)
        assert _tx(st).count(NOT_READY) == 0, "off: no sound"
        assert st.set_melee_not_ready("n92") == "N92"
        st._gun_audio.add(800, "test: a voice line", st._now_ms(), "VX0W")
        await _press(st)
        assert _tx(st).count(NOT_READY) == 0, "a busy speaker drops the sound"
        await _quiet(st, clock)
        assert _tx(st).count(NOT_READY) == 0, "and it never plays late"
        await _swing(st, clock); clock.t += 0.05
        st.alive = False
        await _press(st)
        assert _tx(st).count(NOT_READY) == 0, "a down player gets no sound"
    asyncio.run(run())


def test_two_refused_presses_before_the_write_runs_play_one_sound():
    """Review: the second press finds the speaker claimed by the first, so it plays nothing, never a late sound."""
    async def run():
        st, clock = await _live()
        await _swing(st, clock); clock.t += 0.05
        st._on_rx("$BUT,8,1,*"); st._on_rx("$BUT,8,0,*")
        st._on_rx("$BUT,8,1,*"); st._on_rx("$BUT,8,0,*")
        await settle(st)
        await _quiet(st, clock)
        assert _tx(st).count(NOT_READY) == 1, _tx(st)
    asyncio.run(run())
