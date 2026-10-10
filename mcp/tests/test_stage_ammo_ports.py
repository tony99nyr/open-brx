"""OP13: the ammo rules ported to the stage when the ammo-* golden traces moved onto it (test_golden_traces.py).

Each test pins one port by hand, so a regression names the rule and not only a trace checkpoint:
  - `_slot_count` reads the player's LOADOUT (engine.js `_slotCount`), not the bundle's `$AMMO` rows;
  - `mag` is the HUD denominator (ammo.js `publish`/`magBySlot`), the reload cap of a slot with no spawn row
    (ammo.js `reloadPulled`: `ammoBySlot()[slot] ?? this.host.mag`), forgotten at the match spawn (`forgetShown`).
"""
from __future__ import annotations

import asyncio

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage.stage import GunStage
from _stage import GUN, StageClock, _nosleep, settle


async def _live():
    clock = StageClock()
    mgr = FakeConnectionManager([FakeTagger(GUN, "FAKE-STAGE", team=1, clock=clock)])
    st = GunStage(mgr, None, sleep=_nosleep, now=clock, voice_verdict_sink=lambda _r: None)
    await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
    st.poll(); await settle(st)
    return st


def test_slot_count_is_the_loadout_not_the_bundle_rows():
    """ammo-one-slot-alt: a one-weapon kit on a bundle that still carries two `$AMMO` rows has ONE slot, so ALT is
    inert (fn 98) and opens no swap; with Easy Reload it is a reload pull (engine.js `_slotCount`, `_altPressed`)."""
    async def go():
        st = await _live()
        assert len(st._ammo_by_slot()) == 2 and st._slot_count() == 2
        st.player["loadout"] = {"weapons": [{"weapon_id": "assault_rifle"}]}
        assert st._slot_count() == 1, "the slot count follows the kit"
        st._on_rx("$ALCD,20,100,0,192,0,*")
        st._on_rx("$BUT,1,1,*")
        assert st.switching is None and st.reloading is None, "one weapon, no Easy Reload: ALT does nothing"
        st.player["loadout"]["overrides"] = {"easy_reload": True}
        st._on_rx("$BUT,1,1,*")
        assert st.switching is None and st.reloading and st.reloading["slot"] == 0, "Easy Reload: ALT reloads"
        st.player["loadout"] = {}
        assert st._slot_count() == 0, "no loadout: no slots (engine.js returns 0)"
    asyncio.run(go())


def test_mag_is_the_hud_denominator_and_caps_a_reload_on_a_slot_with_no_spawn_row():
    """ammo-recoil-*: `mag` is the largest count published per slot. A slot the spawn `$AMMO` rows do not name (a
    melee or pickup slot) takes it as the reload cap, as the engine does; the stage used to read the last `$LCD` mag."""
    async def go():
        st = await _live()
        st._publish_ammo(4, 1, 0)
        st._publish_ammo(4, 0, 0)
        assert st.mag == 1 and st._mag_by_slot[4] == 1, "the denominator keeps the largest count, not the last"
        st.active_slot = 4; st.reserve = 3
        st._reload_pulled()
        assert st.reloading and st.reloading["cap"] == 1, st.reloading
        st.reloading = None
        await st.spawn(); await settle(st)
        assert st._mag_by_slot.get(4) is None, "the match spawn forgets the denominators (ammo.js `forgetShown`)"
    asyncio.run(go())



async def _spin(n: int = 50) -> None:
    for _ in range(n):
        await asyncio.sleep(0)


def _tx(st) -> list[str]:
    return [e["raw"] for e in st.mgr.get_events("stage", max_events=10**6)["events"] if e["direction"] == "tx"]


def test_the_respawn_paint_starts_its_second_when_the_burst_is_queued():
    """OP13 polish (engine.js `_revive` -> `_headsetDelayed(frames.headset.respawn)`, 1000 ms): the paint is scheduled when
    the revive QUEUES its burst, before the burst reaches the gun, so a burst held behind the death scream lands after it
    (respawn-operator-in-scream)."""
    async def go():
        st = await _live()
        await st.ir("kill"); st.poll(); await settle(st)
        assert not st.alive
        seen: list = []
        real = st._headset_delayed

        def spy(seq, why, **kw):
            seen.append((why, sum(f == "$SPAWN,,*" for f in _tx(st))))
            return real(seq, why, **kw)
        st._headset_delayed = spy
        spawns = sum(f == "$SPAWN,,*" for f in _tx(st))
        await st.revive(); await settle(st)
        assert seen == [("headset respawn", spawns)], ("scheduled before the revive burst was written", seen)
        assert "$HLED,6,2,120,120,10,2,*" in _tx(st), "an instant sleep still paints, after the burst"
    asyncio.run(go())


def test_the_delayed_paint_waits_its_second_and_a_teardown_cancels_it():
    """engine.js `_headsetDelayed`: `delay(1000)`, then paint only while `_lightGen` is unchanged and the player is alive."""
    async def go():
        st = await _live()
        seq = st.bundle["headset"]["respawn"]
        waits: list = []

        async def held(s):
            if s <= 0:
                return
            fut = asyncio.get_running_loop().create_future()
            waits.append((s, fut))
            await fut
        st.sleep = held
        n = len(_tx(st))
        st._headset_delayed(seq, "test paint"); await _spin()
        assert [w for w, _ in waits] == [1.0] and not any(f.startswith("$HLED") for f in _tx(st)[n:]), "it waits one second"
        waits.pop()[1].set_result(None); await _spin()
        assert _tx(st)[n:][:1] == [seq[0][0]], _tx(st)[n:]
        for _s, f in waits:
            f.set_result(None)
        waits.clear(); await _spin()
        n = len(_tx(st))
        st._headset_delayed(seq, "test paint"); await _spin()
        st._light_gen += 1                     # a teardown (end, panic, BLE drop, head) before it is due
        waits.pop()[1].set_result(None); await _spin()
        assert not any(f.startswith("$HLED") for f in _tx(st)[n:]), "a teardown cancelled the paint"
    asyncio.run(go())


def test_the_reload_outcome_keeps_its_length_unrounded():
    """OP13 polish (ammo.js `endReload`: `ms: now - r.at`, no rounding): the stage's outcome keeps full seconds, so the
    golden runner's ms conversion reads the engine's own number."""
    async def go():
        st = await _live()
        st._on_rx("$ALCD,20,100,0,192,0,*")
        st._on_rx("$BUT,2,1,*")
        assert st.reloading
        st.now.advance(1.2345)
        st._end_reload("timeout")
        assert abs(st.reload_outcome["s"] - 1.2345) < 1e-9, st.reload_outcome
    asyncio.run(go())


def test_ir_callout_constants_match_the_engine():
    """S57: stage.IR_CALLOUT is engine.js `IR_CALLOUT`, key by key (an object literal test_stage_constants cannot read)."""
    import pathlib
    import re
    from brx_mcp.stage import stage as S
    js = (pathlib.Path(__file__).resolve().parents[2] / "app" / "src" / "engine.js").read_text(encoding="utf-8")
    body = re.search(r"export const IR_CALLOUT = \{(.*?)\};", js, re.S).group(1)
    for k, v in S.IR_CALLOUT.items():
        m = re.search(rf"\b{k}:\s*(\d+)", body)
        assert m and int(m.group(1)) == v, (k, v, m and m.group(1))


def test_a_death_sends_the_s57_callout_and_names_the_victim_after_the_gap():
    """S57 (engine.js `_death`): a kill by #19 sends DOWN_BY naming 19 (21 + our tid), then CALLOUT_NAME_GAP_MS after
    that word is written a DOWN naming us (25 + our tid); a death with no fresh shooter sends a bare DOWN naming us."""
    async def go():
        st = await _live()
        tid, me, ct = int(st.profile["tid"]), st.player["player_num"], st.bundle.get("callout_team", int(st.profile["tid"]))
        gaps: list = []

        async def sleep(s):
            gaps.append(s)
        st.sleep = sleep
        st._arm_life("test"); await settle(st)   # F209: past spawn protection, so the death lands
        n = len(_tx(st))
        st._on_rx("$HIR,4,0,19,2,106,0,3,*"); st._on_rx("$HP,0,0,0,*"); await settle(st)
        irtx = [f for f in _tx(st)[n:] if f.startswith("$IRTX")]
        assert irtx == [f"$IRTX,100,15,19,{ct},{21 + tid},0,0,100,1,,0,*", f"$IRTX,100,15,{me},{ct},{25 + tid},0,0,100,1,,0,*"], irtx
        assert 0.3 in gaps, gaps
        await st.revive(); await settle(st)
        st._arm_life("test"); await settle(st)
        st._on_rx("$HP,45,70,0,*"); await settle(st)    # B5: the gun confirms the new life, so a zero is a real death
        st._hit_word = st._hir_word = st._dmg_hir = None   # no fresh shooter: the killer is unknown
        n = len(_tx(st))
        st._on_rx("$HP,0,0,0,*"); await settle(st)
        assert not st.alive
        irtx = [f for f in _tx(st)[n:] if f.startswith("$IRTX")]
        assert irtx == [f"$IRTX,100,15,{me},{ct},{25 + tid},0,0,100,1,,0,*"], irtx
    asyncio.run(go())
