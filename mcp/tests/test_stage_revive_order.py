"""The stage's mirror of engine.js 0e28ddbd (revive order) where no golden trace reaches: a revive burst held in the play
queue moves the B5 settle window and the gun take to its SEND (engine.js `_settling` takes the later of `_spawnAt` and
`_burstReached.at`; `_gunTake` runs `after_spawn_s` from the send)."""
import asyncio
import pathlib
import sys

if __name__ == "__main__":
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.mc.types import DEATH_LATCH_MS
from brx_mcp.stage.stage import GunStage
from _stage import GUN, StageClock


def _stage(sleeps=None):
    clock = StageClock()

    async def rec(s):
        if sleeps is not None:
            sleeps.append(round(s, 3))
    mgr = FakeConnectionManager([FakeTagger(GUN, "FAKE-STAGE", team=1)])
    st = GunStage(mgr, None, sleep=rec, now=clock, voice_verdict_sink=lambda _r: None)
    return st, clock


def test_a_zero_just_after_a_held_burst_lands_is_held_from_the_send_not_the_queue():
    st, clock = _stage()
    st._life, st._armed_this_life, st._hir_word, st._held_zero_life, st._life_burst = 2, False, None, None, None
    st._spawn_at = clock.t                                     # queued
    st._burst_reached = {"life": 2, "at": clock.t + 1.8}       # held 1.8 s behind the scream, then sent
    clock.advance(DEATH_LATCH_MS / 1000 + 0.05)                # past the window from the queue, inside it from the send
    assert st._death_pending() is True
    st._burst_reached = {"life": 1, "at": clock.t - 0.2}       # another life's send does not count
    assert st._death_pending() is False


def test_the_gun_take_is_timed_from_the_bursts_send():
    sleeps: list = []
    st, clock = _stage(sleeps)
    g = (st.bundle or {}).get("gun") or {}
    st.bundle = {**(st.bundle or {}), "gun": {**g, "take": ["$GLED,,,,5,,,*"], "rest": "dark", "after_spawn_s": 2.5}}
    st._burst_reached = {"life": st._life + 1, "at": clock.t - 0.6}   # the burst went out 0.6 s ago; its write just returned

    async def run():
        st._after_spawn()
        for _ in range(5):
            await asyncio.sleep(0)
    asyncio.run(run())
    assert 1.9 in sleeps, sleeps
