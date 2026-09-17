"""A47: the stage MIRRORS engine.js `_operatorResync` (app/test/operator.test.mjs is the phone side).

RESYNC GUN writes `$TID`, the CURRENT `$AMMO` per slot, `$BMAP,0,0`, then one `sir_pool` take, and nothing
that heals or re-heads the gun. FORCE RESPAWN is the stage's existing `revive()`.

Run: python3 run_tests.py stage_operator_resync
"""
from __future__ import annotations

import asyncio

from test_stage import settle, tx
from test_stage_spawn_protect import _live, _mk


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
        assert w == ["$TID,1,*", "$AMMO,0,20,150,1,*", "$AMMO,1,6,24,1,*", "$BMAP,0,0,,,,,*",
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
