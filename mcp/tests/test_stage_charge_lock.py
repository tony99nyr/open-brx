"""F226 on the stage (engine.js `_chargeLock`, ammo.js `autoReload`; bench 2026-11-01, 0.4.32).

A charge from a cell below one full charge fires nothing and the gun answers at the same magazine with heat at or past
the lockout (156 on the bench). The phone writes the reload itself, once per lock, never more than the reserve holds.
The stage predicts the phone, so it does the same.

Run: python3 run_tests.py stage_charge_lock
"""
import asyncio

from _stage import StageClock, mk_stage


def _rows(sent):
    """The `$AMMO` rows; the slot's own `$WEAP` row goes straight before each (engine.js `_chargeLock`, bench 2026-11-14 SR7)."""
    for i, f in enumerate(sent):
        if f.startswith("$AMMO,"):
            assert i > 0 and sent[i - 1].startswith(f"$WEAP,{f.split(',')[1]},"), sent
    return [f for f in sent if not f.startswith("$WEAP,")]


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
        assert _rows(sent) == ["$AMMO,0,40,4,1,*"], sent
        assert st.reloading and st.reloading.get("auto"), "shown as a reload"
        st._charge_lock(0, 4, 4, 40, 156)
        await asyncio.sleep(0)
        assert len(_rows(sent)) == 1, "once per lock"
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
        assert _rows(sent) == ["$AMMO,0,7,0,1,*"], "never more than the reserve holds"
    asyncio.run(go())


def test_codex_r3_a_charge_lock_write_that_never_left_is_no_reload_and_the_next_lock_writes_again():
    """engine.js `_chargeLockUnwrite` (Codex pass 2026-11-07 r3)."""
    async def go():
        clock = StageClock(); st, sent = _st(clock)
        real = st.write
        async def failed(*_a, **_k):
            return False
        st.write = failed   # type: ignore[method-assign]
        st._charge_lock(0, 4, 4, 40, 156)
        assert st.reloading and st.reloading.get("auto")
        for _ in range(3):
            await asyncio.sleep(0)
        assert st.reloading is None and st.reload_outcome and st.reload_outcome["why"] == "dropped", st.reload_outcome
        assert st._charge_lock_fix is None
        st.write = real   # type: ignore[method-assign]
        st._charge_lock(0, 4, 4, 40, 156)
        await asyncio.sleep(0)
        assert _rows(sent) == ["$AMMO,0,40,4,1,*"], sent
    asyncio.run(go())


def test_sr8_energy_rifle_lock_holds_on_either_slot_and_the_lever_vents():
    """ammo.js `heatBlocksFire`/`leverVents` (bench 2026-11-14, SR8): one heat value; the Energy Rifle's lock does not cool, and
    a lever with any heat vents it, with no reload takeover."""
    async def go():
        clock = StageClock(); st, _sent = _st(clock)
        st.player = {"loadout": {"weapons": [{"weapon_id": "energy_rifle"}, {"weapon_id": "usp"}]}}
        st.heat_by_slot[0] = 101; st._heat_at[0] = clock.t
        clock.t += 60.0
        assert st._heat_blocks_fire(), "a minute on, the lock still holds"
        st.active_slot = 1
        assert st._heat_blocks_fire(), "and on the other slot"
        st.active_slot = 0
        st.ammo = 20
        st._reload_pulled(lever=True)
        assert st.reloading is None and any("lever vents the heat" in l["text"] for l in st.log)
    asyncio.run(go())


def test_polish_r1_a_part_vented_energy_rifle_stays_locked_until_0():
    """ammo.js `ventLocked` (polish r1; bench SR8): 65 after one vent is still a lock, and it does not cool; 0 ends it."""
    async def go():
        clock = StageClock(); st, _sent = _st(clock)
        st.player = {"loadout": {"weapons": [{"weapon_id": "energy_rifle"}, {"weapon_id": "usp"}]}}
        st._on_ammo(201, 600, 0, 101)
        st._on_ammo(201, 600, 0, 65)
        clock.t += 20.0
        assert st._heat_blocks_fire(), "20 s on, 65 is still a lock"
        st.ammo = 20
        st._reload_pulled(lever=True)
        assert st.reloading is None and any("lever vents the heat" in l["text"] for l in st.log)
        st._on_ammo(201, 600, 0, 0)
        assert not st._heat_blocks_fire(), "vented to 0: the lock is over"
    asyncio.run(go())


def test_polish_r1_easy_reload_alt_vents_the_energy_rifle():
    """ammo.js `reloadPulled` (polish r1): on a one-weapon Easy Reload kit ALT holds fn 97, so ALT vents with no takeover."""
    async def go():
        clock = StageClock(); st, _sent = _st(clock)
        st.player = {"loadout": {"weapons": [{"weapon_id": "energy_rifle"}], "overrides": {"easy_reload": True}}}
        st._on_ammo(201, 600, 0, 101)
        st.ammo = 20
        st._reload_pulled()
        assert st.reloading is None and any("ALT vents the heat" in l["text"] for l in st.log), [l["text"] for l in st.log]
    asyncio.run(go())
