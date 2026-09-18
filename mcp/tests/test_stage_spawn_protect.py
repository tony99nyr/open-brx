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


ENGINE_JS = __import__("pathlib").Path(__file__).resolve().parents[2] / "app" / "src" / "engine.js"


def test_the_spawn_protection_cap_is_the_same_number_on_both_sides():
    """Maint review 2026-09-17: SPAWN_PROTECT_MAX_S was the one mirrored constant with NO parity assertion
    (GUN_QUIET_STALE_S, TRIGGER_NO_FIRE_S, NO_FIRE_PULLS, HEAT_LOCKOUT and HEAT_STALE_S are all pinned in
    test_stage_pool_stale.py, ENERGY_REFILL_MAX_S in test_stage_mirror.py). A stage that arms hit reception
    at a different moment from the phone predicts a different gun, which is the one thing these files exist
    to stop. Same shape as the others: read the number straight out of the engine.js source text."""
    js = ENGINE_JS.read_text(encoding="utf-8")
    assert f"SPAWN_PROTECT_MAX_MS = {int(GunStage.SPAWN_PROTECT_MAX_S * 1000)};" in js, (
        "engine.js SPAWN_PROTECT_MAX_MS and GunStage.SPAWN_PROTECT_MAX_S disagree -- the bench would arm the "
        "real $SIR table at a different moment from the phone")


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


def test_arm_pending_is_stamped_before_the_write_not_after_it_resolves():
    """Playtest review 2026-09-13: engine.js stamps `_armAfterSpawn` right after QUEUEING the spawn/revive
    write, not after it resolves. A stage that waits for `await self.write(...)` to finish first starts the
    SPAWN_PROTECT_MAX_S cap late by the write's own gap time -- exactly the divergence the stage exists to
    avoid (the stage must mirror the phone)."""
    async def run():
        st, mgr, clock = _mk()
        await st.connect(GUN); await st.arm()
        orig_write = st.write
        async def slow_write(frames, why, gap_ms=60, exact=False):
            if why.startswith(("spawn", "revive")):
                clock.advance(0.5)               # simulate 0.5s of real BLE write time
            return await orig_write(frames, why, gap_ms=gap_ms, exact=exact)
        st.write = slow_write
        t0 = clock()
        await st.spawn()
        assert st._arm_pending == t0, "spawn: the pending-arm time must be stamped BEFORE the write"
        st._inject_rx("$HP,0,0,0,*"); await settle(st)   # a pool-only death: the fn-28 twin still protects IR
        assert not st.alive
        t1 = clock()
        await st.revive()
        assert st._arm_pending == t1, "revive: the pending-arm time must be stamped BEFORE the write"
    asyncio.run(run())


def test_a_write_slower_than_the_cap_still_ends_with_the_life_armed():
    """F209 follow-up (playtest review 2026-09-13): `_arm_life`'s gate reads `spawned`/`alive`, which
    `_after_spawn` only sets once the awaited write RETURNS. A revive write of SPAWN_PROTECT_MAX_S or more
    (the fn-28 twin's own gap time, or a reconnect-and-retry inside `write`) let the poller's cap fire
    mid-write, find the PREVIOUS life's state (spawned True, alive False) and cancel the arm as "not
    live" -- nothing re-arms it afterwards, so the gun stayed on fn 28 (no live `$SIR` table) for the
    rest of that life."""
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        clock.advance(3); st.poll(); await settle(st)
        await st.ir("kill"); st.poll(); await settle(st)
        assert not st.alive
        n = len(tx(mgr))
        orig_write = st.write

        async def slow_write(frames, why, gap_ms=60, exact=False):
            if why.startswith("revive"):
                clock.advance(st.SPAWN_PROTECT_MAX_S + 0.1)   # the write itself outlasts the cap
                st.poll()                                     # the poller's tick runs while the write is in flight
            return await orig_write(frames, why, gap_ms=gap_ms, exact=exact)

        st.write = slow_write
        await st.revive(); await settle(st)
        assert _real(tx(mgr)[n:]) == _real(st.bundle["sir_pool"][0]), "the cap still arms the real table"
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
