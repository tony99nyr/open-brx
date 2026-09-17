"""F209 burst half: the stage MIRRORS engine.js one-death-per-life (app/test/death-once.test.mjs is the phone side).

A burst of lethal frames is one death: one `died` event, one strip blank, and no second death until a revive.
The next life can die again. The stage has no respawn clock (the operator revives by hand), so the delay half
is the phone test alone.

Run: python3 run_tests.py stage_death_once
"""
from __future__ import annotations

import asyncio

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage.stage import GunStage
from test_stage import _Clock, _nosleep, settle

GUN = "FA:KE:00:00:00:01"


def _mk():
    mgr = FakeConnectionManager([FakeTagger(GUN, "FAKE-STAGE", team=1)])
    clock = _Clock()
    st = GunStage(mgr, None, sleep=_nosleep, now=clock, voice_verdict_sink=lambda _r: None)
    return st, mgr, clock


def _deaths(st) -> int:
    return sum(1 for e in st.log if "☠ down" in str(e))


def test_a_burst_of_lethal_frames_is_one_death_and_the_next_life_can_die():
    async def run():
        st, mgr, clock = _mk()
        await st.connect(GUN)
        await st.arm(); await st.spawn(); await settle(st)
        for _ in range(5):
            st._inject_rx("$HIR,4,0,19,2,9,0,3,*"); st._inject_rx("$HP,0,0,0,*"); st._inject_rx("$LCD,0,0,0,0,30,90,*")
        await settle(st)
        assert not st.alive
        assert _deaths(st) == 1, f"one death for the burst, got {_deaths(st)}"
        clock.advance(5); st._inject_rx("$HP,0,0,0,*"); await settle(st)
        assert _deaths(st) == 1, "a lethal frame while down is not a second death"
        await st.revive(); await settle(st)
        assert st.alive
        st._inject_rx("$HP,0,0,0,*"); st._inject_rx("$HP,0,0,0,*"); await settle(st)
        assert _deaths(st) == 2, "the next life dies once"
    asyncio.run(run())
