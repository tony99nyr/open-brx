"""The stage's mirror of engine.js 0e28ddbd (revive order) where no golden trace reaches. A life is numbered when its
burst is QUEUED (`_life_queued`, engine.js `_lifeSeq`); `_life` follows once the write returns. So while a held burst is
still being written, the B5 settle window and the respawn paint already belong to the new life, as on the phone."""
import asyncio
import pathlib
import sys

if __name__ == "__main__":
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.mc.types import DEATH_LATCH_MS
from brx_mcp.stage.stage import GunStage
from _stage import GUN, StageClock


def _mk(sleeps=None):
    clock = StageClock()

    async def rec(s):
        if sleeps is not None:
            sleeps.append(round(s, 3))
    mgr = FakeConnectionManager([FakeTagger(GUN, "FAKE-STAGE", team=1)])
    st = GunStage(mgr, None, sleep=rec, now=clock, voice_verdict_sink=lambda _r: None)
    return st, clock


def test_a_zero_while_a_held_burst_is_written_is_held_from_its_send():
    st, clock = _mk()
    st._armed_this_life, st._hir_word, st._held_zero_life, st._life_burst = False, None, None, None
    st._life, st._life_queued = 1, 2                           # the revive is queued; its write has not returned
    st._spawn_at = clock.t                                     # queued
    st._burst_reached = {"life": 2, "at": clock.t + 1.8}       # held 1.8 s behind the scream, then sent
    clock.advance(DEATH_LATCH_MS / 1000 + 0.05)                # past the window from the queue, inside it from the send
    assert st._death_pending() is True, "mid-write: the new life's window runs from the send"
    st._life = 2                                               # the write returned (`_after_spawn`)
    assert st._death_pending() is True
    st._burst_reached = {"life": 1, "at": clock.t - 0.2}       # another life's send does not count
    assert st._death_pending() is False


def test_the_respawn_paint_lands_when_the_burst_write_outlasts_its_delay():
    st, clock = _mk()
    painted = []
    st._headset = lambda seq, why: painted.append(why)          # type: ignore[method-assign]
    st.alive = True
    st._life, st._life_queued = 1, 2                           # queued life 2; the burst write is still going

    async def run():
        st._headset_delayed(["$HLED,6,2,*"], "headset respawn", life=st._life_queued)
        for _ in range(5):
            await asyncio.sleep(0)
    asyncio.run(run())
    assert painted == ["headset respawn"], "the paint is for the queued life, which the write does not wait for"
    painted.clear()
    st._life_queued = 3                                        # a second revive queued inside the delay

    async def run2():
        st._headset_delayed(["$HLED,6,2,*"], "headset respawn", life=2)
        for _ in range(5):
            await asyncio.sleep(0)
    asyncio.run(run2())
    assert painted == [], "a paint for an older life must not paint the new one"


def test_the_gun_take_is_timed_from_the_bursts_send():
    sleeps: list = []
    st, clock = _mk(sleeps)
    g = (st.bundle or {}).get("gun") or {}
    st.bundle = {**(st.bundle or {}), "gun": {**g, "take": ["$GLED,,,,5,,,*"], "rest": "dark", "after_spawn_s": 2.5}}
    st._life_queued = st._life + 1
    st._burst_reached = {"life": st._life_queued, "at": clock.t - 0.6}   # the burst went out 0.6 s ago; its write just returned

    async def run():
        st._after_spawn()
        for _ in range(5):
            await asyncio.sleep(0)
    asyncio.run(run())
    assert 1.9 in sleeps, sleeps


def test_a_zero_held_for_a_queued_life_is_that_life_even_after_a_cancelled_burst():
    """A burst a death cancelled skipped a life number, so the held zero is the queued life, not `_life + 1`."""
    st, clock = _mk()
    st._armed_this_life, st._hir_word, st._held_zero_life = False, None, None
    st._life, st._life_queued = 1, 3                           # life 2's burst was cancelled; life 3 is queued
    st._spawn_at = clock.t
    st._life_burst = {"at": clock.t, "sent": False, "reached": False, "cancelled": False, "flash": None}
    assert st._death_pending() is True and st._held_zero_life == 3
    st._life_burst = None
    st._life = 3                                               # life 3's write returned
    assert st._death_pending(reexamine=True) is True, "the held zero is the last life's pool: never booked"


def test_an_operator_resync_for_the_last_life_does_not_write_into_a_queued_one():
    st, clock = _mk()
    writes = []

    async def w(frames, why, *a, **k):
        writes.append(why)
    st.write = w                                               # type: ignore[method-assign]
    st.spawned = st.alive = True
    st._life, st._life_queued = 1, 2                           # a revive is queued; its write has not returned
    asyncio.run(st._operator_resync_write({"life": 1}))
    assert writes == [], writes
