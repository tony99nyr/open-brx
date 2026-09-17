"""F209: the stage MIRRORS engine.js spawn protection (app/test/spawn-protect.test.mjs is the phone side).

The spawn and revive writes carry the fn-28 twin; one `sir_pool` take (the real table) follows on the
gun's first shot or SPAWN_PROTECT_MAX_S after the write. Death, end, panic and a head cancel it. The
stage clock is in SECONDS (engine.js is in ms).

Run: python3 run_tests.py stage_spawn_protect
"""
from __future__ import annotations

import asyncio

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage.stage import GunStage
from test_stage import _Clock, _nosleep, settle, tx

GUN = "FA:KE:00:00:00:01"


def _mk():
    mgr = FakeConnectionManager([FakeTagger(GUN, "FAKE-STAGE", team=1)])
    clock = _Clock()
    st = GunStage(mgr, None, sleep=_nosleep, now=clock, voice_verdict_sink=lambda _r: None)
    return st, mgr, clock


def _real(frames):
    return [f for f in frames if f.startswith("$SIR,") and f.split(",")[4] != "28"]


def _sir(frames):
    return [f for f in frames if f.startswith("$SIR,")]


async def _live(st, clock):
    await st.connect(GUN)
    await st.arm(); await st.spawn(); await settle(st)
    return st


def test_the_stage_bundle_is_protected_at_spawn_and_revive():
    st, mgr, clock = _mk()
    b = st.bundle
    assert _sir(b["spawn"]) and not _real(b["spawn"]), "spawn carries only the twin"
    assert _sir(b["revive"]) and not _real(b["revive"]), "revive carries only the twin"
    assert b["sir_pool"] and _real(b["sir_pool"][0]), "the real table is the sir_pool take"


def test_spawn_arms_at_the_cap_and_not_before():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        assert not _real(tx(mgr)), "no live row with the spawn"
        clock.advance(st.SPAWN_PROTECT_MAX_S - 0.1); st.poll(); await settle(st)
        assert not _real(tx(mgr)), "still protected just before the cap"
        clock.advance(0.2); st.poll(); await settle(st)
        assert _real(tx(mgr)) == _real(st.bundle["sir_pool"][0]), "the cap writes the real table once"
        n = len(tx(mgr)); clock.advance(5); st.poll(); await settle(st)
        assert not _sir(tx(mgr)[n:]), "and never again this life"
    asyncio.run(run())


def test_revive_arms_on_the_first_shot_not_on_the_ammo_echo():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        clock.advance(3); st.poll(); await settle(st)
        await st.ir("kill"); st.poll(); await settle(st)
        assert not st.alive
        n = len(tx(mgr))
        await st.revive(); await settle(st)
        assert not _real(tx(mgr)[n:]), "the revive write arms nothing"
        st._inject_rx("$ALCD,32,100,0,192,0,*"); await settle(st)
        assert not _real(tx(mgr)[n:]), "an echo at a full magazine does not arm"
        st._inject_rx("$ALCD,31,100,0,192,0,*"); await settle(st)
        assert _real(tx(mgr)[n:]) == _real(st.bundle["sir_pool"][0]), "the first shot arms at once"
    asyncio.run(run())


def test_death_end_and_panic_inside_the_window_cancel_the_arm():
    async def run():
        for how in ("death", "end", "panic", "head"):
            st, mgr, clock = _mk()
            await _live(st, clock)
            n = len(tx(mgr))
            if how == "death":
                # an IR kill cannot land here: the fake gun honours the fn-28 twin. A pool-only death can.
                st._inject_rx("$HP,0,0,0,*"); await settle(st)
                assert not st.alive
            elif how == "end":
                await st.end()
            elif how == "panic":
                await st.panic()
            else:
                await st.arm()
            assert st._arm_pending is None, f"{how} drops the pending arm"
            clock.advance(st.SPAWN_PROTECT_MAX_S * 2); st.poll(); await settle(st)
            assert not _real(tx(mgr)[n:]), f"{how}: nothing armed afterwards"
    asyncio.run(run())


def test_a_dropped_link_defers_the_arm_until_it_is_back():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        st.connected = False
        clock.advance(st.SPAWN_PROTECT_MAX_S * 2); st.poll(); await settle(st)
        assert st._arm_pending is not None, "no arm while the link is down, and none lost"
        st.connected = True; st.poll(); await settle(st)
        assert _real(tx(mgr)) == _real(st.bundle["sir_pool"][0]), "armed on the first poll with the link back"
    asyncio.run(run())


def test_a_hit_inside_the_window_does_no_damage_and_the_same_hit_lands_after_the_cap():
    """The bench check, on the fake gun (which honours `$SIR` functions): protected, then armed."""
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        hp0, ar0 = st.hp, st.armor
        await st.ir("kill"); st.poll(); await settle(st)
        assert st.alive and (st.hp, st.armor) == (hp0, ar0), "a kill shot inside the window moves nothing"
        clock.advance(st.SPAWN_PROTECT_MAX_S + 0.1); st.poll(); await settle(st)
        await st.ir("kill"); st.poll(); await settle(st)
        assert not st.alive, "the same shot kills once hit reception is armed"
    asyncio.run(run())
