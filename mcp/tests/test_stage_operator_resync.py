"""A47: the stage MIRRORS engine.js `_operatorResync` (app/test/operator.test.mjs is the phone side).

RESYNC GUN writes `$TID`, the CURRENT `$AMMO` per slot, `$BMAP,0,0`, then one `sir_pool` take, and nothing
that heals or re-heads the gun. FORCE RESPAWN is the stage's existing `revive()`.

F264 v3 (Tony, 2026-09-18/19): READ BEFORE WRITING. RESYNC GUN now probes the gun first (`_ask_gun`,
`$LIFE,0,0,0,*` ALONE -- v3, bench 2026-09-19: the dead-gun probe is safe to send any gun, `$QUERY` is
not, and is never sent from here) before its own writes, so a gun that had died while the stage thought
it alive books its death through the ordinary handler instead of getting fourteen frames of `$SIR` rows
at a state it no longer has. See `test_stage_cure.py` for the probe/cure mechanics; this file only
asserts the ORDER (probe first) and that the probe does not change what RESYNC GUN itself writes.

Run: python3 run_tests.py stage_operator_resync
"""
from __future__ import annotations

import asyncio

from test_stage import settle, tx
from test_stage_spawn_protect import GUN, _live, _mk


def test_resync_writes_tid_live_ammo_bmap_then_the_take_and_keeps_the_pools():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        clock.advance(st.SPAWN_PROTECT_MAX_S + 0.1); st.poll(); await settle(st)   # protection released
        st._inject_rx("$ALCD,20,100,0,150,0,*"); await settle(st)
        st._inject_rx("$HP,30,10,0,*"); await settle(st)
        hp, armor = st.hp, st.armor
        n = len(tx(mgr))
        await st.resync(); await settle(st)
        w = tx(mgr)[n:]
        # F264 v3: the probe leads the write list -- read before write, not raced against it (`_ask_gun`
        # is `await`ed directly by `_operator_resync`, never handed to `_spawn_task`, for exactly this
        # ordering). It is `$LIFE,0,0,0,*` ALONE: `$QUERY` is never sent from here (only the cure's own
        # 'mag' step sends it, once `$LIFE` has already proven the gun alive). The probe's own reply, if
        # any, is a SEPARATE rx event this test never injects.
        assert w == ["$LIFE,0,0,0,*", "$TID,1,*", "$AMMO,0,20,150,1,*", "$AMMO,1,6,24,1,*", "$BMAP,0,0,,,,,*",
                     *st.bundle["sir_pool"][0]], w
        assert not [f for f in w if f.startswith(("$SPAWN", "$PSET", "$WEAP", "$CLEAR"))]
        assert (st.hp, st.armor, st.spawned, st.alive) == (hp, armor, True, True)
    asyncio.run(run())


def test_resync_of_a_down_gun_writes_nothing():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        st._inject_rx("$HP,0,0,0,*"); await settle(st)
        assert not st.alive
        n = len(tx(mgr))
        await st.resync(); await settle(st)
        assert tx(mgr)[n:] == []
    asyncio.run(run())


def test_resync_refuses_like_the_phone_when_unlinked_or_before_the_spawn():
    """pl3 (2026-09-17): engine.js refuses an operator resync on a down link and before T-0. The stage must too,
    or a bench run shows a resync the phone would never have written."""
    async def run():
        st, mgr, clock = _mk()
        await st.connect(GUN)
        await st.arm(); await settle(st)
        n = len(st.log)
        await st.resync(); await settle(st)
        new = list(st.log)[n:]
        assert not [e for e in new if e["kind"] == "tx"], new
        assert any(e["text"] == "operator resync ignored -- the T-0 spawn has not run" for e in new), new
        await st.spawn(); await settle(st)
        st.connected = False                                # the link dropped under the stage
        n = len(st.log)
        await st.resync(); await settle(st)
        new = list(st.log)[n:]
        assert not [e for e in new if e["kind"] == "tx"], "no frames queued for an unlinked gun"
        assert any(e["text"] == "operator resync ignored -- gun link down (RELINK first)" for e in new), new
    asyncio.run(run())
