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
