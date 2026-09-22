"""A47: the stage MIRRORS engine.js `_operatorResync` (app/test/operator.test.mjs is the phone side).

RESYNC GUN writes `$TID`, the CURRENT `$AMMO` per slot, `$BMAP,0,0`, then one `sir_pool` take, and nothing
that heals or re-heads the gun. FORCE RESPAWN is the stage's existing `revive()`.

F287: PROVE BEFORE WRITING. RESYNC GUN probes the gun first (`_ask_gun`,
`$LIFE,0,0,0,*` ALONE -- v3, bench 2026-09-19: the dead-gun probe is safe to send any gun, `$QUERY` is
not, and is never sent from here) before its own writes, so a gun that had died while the stage thought
it alive books its death through the ordinary handler instead of getting fourteen frames of `$SIR` rows
at a state it no longer has. A positive `$HP` releases the burst; dead, timeout and late answers do not.
See `test_stage_cure.py` for the shared probe mechanics.

Run: python3 run_tests.py stage_operator_resync
"""
from __future__ import annotations

import asyncio

from test_stage import settle, tx
from test_stage_spawn_protect import GUN, _live, _mk


def test_resync_waits_for_live_hp_then_writes_tid_live_ammo_bmap_and_take():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        clock.advance(st.SPAWN_PROTECT_MAX_S + 0.1); st.poll(); await settle(st); st.poll(); await settle(st)   # release + drain its probe reply
        st._inject_rx("$ALCD,20,100,0,150,0,*"); await settle(st)
        st._inject_rx("$HP,30,10,0,*"); await settle(st)
        hp, armor = st.hp, st.armor
        n = len(tx(mgr))
        await st.resync(); await settle(st)
        assert tx(mgr)[n:] == ["$LIFE,0,0,0,*"], "the probe is the only write until the gun answers"
        st._inject_rx("$HP,30,10,0,*"); await settle(st)
        w = tx(mgr)[n:]
        assert w == ["$LIFE,0,0,0,*", "$TID,1,*", "$AMMO,0,20,150,1,*", "$AMMO,1,6,24,1,*", "$BMAP,0,0,,,,,*",
                     *st.bundle["sir_pool"][0], "$TMP,,,,,,,,0,,,,*"], w   # F121 rebuild: the table, then t8 = 0
        assert not [f for f in w if f.startswith(("$SPAWN", "$PSET", "$WEAP", "$CLEAR"))]
        assert (st.hp, st.armor, st.spawned, st.alive) == (hp, armor, True, True)
    asyncio.run(run())


def test_resync_dead_hp_answer_books_death_and_never_writes_the_burst():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        clock.advance(st.SPAWN_PROTECT_MAX_S + 0.1); st.poll(); await settle(st); st.poll(); await settle(st)
        n = len(tx(mgr))
        await st.resync(); await settle(st)
        st._inject_rx("$HP,0,0,0,*"); await settle(st)
        assert not st.alive
        assert not [f for f in tx(mgr)[n:] if f.startswith(("$TID", "$AMMO", "$BMAP", "$SIR"))]
    asyncio.run(run())


def test_resync_unanswered_probe_times_out_without_writing_the_burst():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        clock.advance(st.SPAWN_PROTECT_MAX_S + 0.1); st.poll(); await settle(st); st.poll(); await settle(st)
        tagger = mgr.taggers[GUN]
        tagger.go_dead_chatty(); tagger.dead_gun_answers_life = False   # node still believes alive; probe is silent
        n = len(tx(mgr))
        await st.resync(); await settle(st)
        clock.advance(st.QUERY_REPLY_S + 0.01)
        st._inject_rx("$HP,30,10,0,*"); await settle(st)   # expired even before the next poll/tick
        after = tx(mgr)[n:]
        assert after.count("$LIFE,0,0,0,*") == 1
        assert not [f for f in after if f.startswith(("$TID", "$AMMO", "$BMAP", "$SIR"))]
        assert any("operator resync" in e["text"] and "no answer" in e["text"] for e in st.log)
        late = tx(mgr)[n + 1:]
        assert not [f for f in late if f.startswith(("$TID", "$AMMO", "$BMAP", "$SIR"))], \
            "a late answer cannot release an expired burst"
    asyncio.run(run())


def test_resync_does_not_release_a_timed_respawns_weapon_delay():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        clock.advance(st.SPAWN_PROTECT_MAX_S + 0.1); st.poll(); await settle(st); st.poll(); await settle(st)
        st._trigger_pending = {"at": clock(), "due": clock() + 5.0}
        n = len(tx(mgr))
        await st.resync(); await settle(st)
        st._inject_rx("$HP,45,70,0,*"); await settle(st)
        assert not [f for f in tx(mgr)[n:] if f.startswith("$BMAP,0,0")]
        assert st._trigger_pending is not None
    asyncio.run(run())


def test_a_background_probe_queued_before_resync_cannot_steal_its_reply():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        clock.advance(st.SPAWN_PROTECT_MAX_S + 0.1); st.poll(); await settle(st); st.poll(); await settle(st)
        n = len(tx(mgr))
        st._poll_at = 0.0
        st._poll_tick(clock())                 # schedules, but deliberately do not settle it yet
        await st.resync(); await settle(st)
        assert tx(mgr)[n:].count("$LIFE,0,0,0,*") == 1, "the queued background ask must yield ownership"
        st._inject_rx("$HP,45,70,0,*"); await settle(st)
        assert any(f.startswith("$TID,") for f in tx(mgr)[n:]), "the operator's healthy reply releases the burst"
        assert st._operator_resync_pending is None
    asyncio.run(run())


def test_hp_before_the_operator_probe_coroutine_starts_is_not_its_proof():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        clock.advance(st.SPAWN_PROTECT_MAX_S + 0.1); st.poll(); await settle(st); st.poll(); await settle(st)
        n = len(tx(mgr))
        pending = asyncio.create_task(st.resync())
        st._inject_rx("$HP,45,70,0,*")             # old traffic; the RESYNC coroutine has not run
        await pending; await settle(st)
        assert tx(mgr)[n:] == ["$LIFE,0,0,0,*"]
        assert st._operator_resync_pending is not None
    asyncio.run(run())


def test_hp_while_operator_probe_waits_for_transport_admission_is_not_its_proof():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        clock.advance(st.SPAWN_PROTECT_MAX_S + 0.1); st.poll(); await settle(st); st.poll(); await settle(st)
        n = len(tx(mgr)); gate = asyncio.Event(); original_send = st._send

        async def blocked_send(frames, gap_ms, on_start=None):
            await gate.wait()                         # models ConnectionManager's held write_lock
            return await original_send(frames, gap_ms, on_start=on_start)

        st._send = blocked_send
        pending = asyncio.create_task(st.resync())
        await asyncio.sleep(0); await asyncio.sleep(0)
        assert tx(mgr)[n:] == [], "probe has not acquired the transport"
        st._inject_rx("$HP,45,70,0,*")              # older traffic while still queued
        mgr.taggers[GUN].go_dead_chatty(); mgr.taggers[GUN].dead_gun_answers_life = False
        gate.set(); await pending; await settle(st)
        assert tx(mgr)[n:] == ["$LIFE,0,0,0,*"]
        assert st._operator_resync_pending is not None, "only an answer after transport admission may release it"
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
