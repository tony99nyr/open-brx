"""F226 on the stage (engine.js `_chargeLock`, ammo.js `autoReload`; bench 2026-11-01, 0.4.32).

A charge from a cell below one full charge fires nothing and the gun answers at the same magazine with heat at or past
the lockout (156 on the bench). The phone writes the reload itself, once per lock, never more than the reserve holds.
The stage predicts the phone, so it does the same.

Run: python3 run_tests.py stage_charge_lock
"""
import asyncio

from _stage import StageClock, mk_stage


def _st(clock, cap=40):
    st, _ = mk_stage(now=clock)
    st.spawned, st.alive, st.stunned, st.active_slot = True, True, False, 0
    st.player = {"loadout": {"weapons": [{"weapon_id": "charge_rifle"}]}}
    st._ammo_by_slot = lambda: {0: cap}   # type: ignore[method-assign]
    sent = []

    async def write(frames, why="", **kw):
        sent.extend(frames)
        return True
    st.write = write   # type: ignore[method-assign]
    return st, sent


def test_a_charge_lock_from_4_gets_one_reload_from_the_reserve():
    async def go():
        clock = StageClock(); st, sent = _st(clock)
        row = st._catalog_row("weapon_catalog", "weapon_id", "charge_rifle") or {}
        assert (row.get("rounds_per_charge") or 1) > 4, "control: a charge costs more than 4 rounds"
        st._charge_lock(0, 4, 4, 40, 156)
        await asyncio.sleep(0)
        assert sent == ["$AMMO,0,40,4,1,*"], sent
        assert st.reloading and st.reloading.get("auto"), "shown as a reload"
        st._charge_lock(0, 4, 4, 40, 156)
        await asyncio.sleep(0)
        assert len(sent) == 1, "once per lock"
        clock.t += float(row.get("reload_s") or 1.5) + 0.01
        st._reload_tick()
        assert st.reload_outcome and st.reload_outcome["why"] == "filled" and st.reload_outcome["to"] == 40
    asyncio.run(go())


def test_the_rule_stays_narrow():
    async def go():
        clock = StageClock()
        for args, why in (((0, 4, 3, 40, 156), "a round fired"), ((0, 4, 4, 40, 60), "a cool frame"),
                          ((0, 4, 4, 0, 156), "an empty reserve"), ((0, 12, 12, 40, 156), "a cell above one charge")):
            st, sent = _st(clock)
            st._charge_lock(*args)
            await asyncio.sleep(0)
            assert sent == [], why
        st, sent = _st(clock)
        st._charge_lock(0, 4, 4, 3, 156)
        await asyncio.sleep(0)
        assert sent == ["$AMMO,0,7,0,1,*"], "never more than the reserve holds"
    asyncio.run(go())
