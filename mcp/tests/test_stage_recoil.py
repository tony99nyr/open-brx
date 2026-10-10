"""S42/F259: the stage's port of engine.js's node-driven recoil (the `$TMP` t4 accuracy writer), on the paths no golden
trace reaches. The three ammo-recoil traces (app/test/fixtures/traces/ammo-recoil-*.json, ammo-life-resets.json) pin the
ladder, the settle, `shotInFlight`, the reload and swap holds, melee, the verify retry and the stun against the engine's
own recording. These cases cover what those traces never drive: the DERIVED profile (every trace spells its rungs out),
a swap onto a flat weapon that must clear an inherited modifier, `config.recoil: false`, an overheated gun, and a hold
that drops a write still waiting for its verify.

Each case names the engine.js behaviour it pins. The stage's model is in whole ms (`_now_ms()`), so the clock below is
advanced in seconds and every boundary is a whole number of ms.
"""
from __future__ import annotations

import asyncio
import copy

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.mc.compile import Compiler
from brx_mcp.stage.stage import ACC_HOLD_MS, GunStage
from _stage import GUN, StageClock, _nosleep, mark, settle, since

# The stage's own kit is the assault rifle on slot 0 and the shotgun on slot 1 (`recompile()`). The rifle carries an
# explicit three-state ladder, as the golden traces do; the shotgun here is FLAT (no `recoil` block).
AR = {"weapon_id": "assault_rifle", "name": "AR", "recoil": {"crisp": 100, "degraded": 70, "heavy": 40,
                                                             "after_shots": 3, "after_heavy": 6, "settle_ms": 800}}
FLAT_SHOTGUN = {"weapon_id": "shotgun", "name": "Shotgun"}


class _Catalog(Compiler):
    """The real compiler (the real bundle), with the catalogue rows the stage's `_catalog_row` reads replaced."""

    def __init__(self, rows):
        super().__init__()
        self._rows = rows

    def weapon_catalog(self):
        return copy.deepcopy(self._rows)


def _mk(rows=(AR, FLAT_SHOTGUN), config: dict | None = None):
    clock = StageClock()
    mgr = FakeConnectionManager([FakeTagger(GUN, "FAKE-STAGE", team=1, clock=clock)])
    st = GunStage(mgr, None, compiler=_Catalog(list(rows)), sleep=_nosleep, now=clock, voice_verdict_sink=lambda _r: None)
    if config:
        st.load_config({**st.config, **config}, source="test")
    return st, mgr, clock


async def _live(st, mgr, clock):
    """Armed, spawned, the spawn's own echoes landed, and the spawn's accuracy hold (ACC_HOLD_MS) over."""
    await st.connect(GUN)
    await st.arm()
    st.bundle["cues"]["countdown"] = ""
    await st.spawn()
    await settle(st)
    await _tick(st, mgr, clock, ACC_HOLD_MS / 1000 + 0.1)


async def _tick(st, mgr, clock, s: float = 0.25):
    """The clock moves, the fake gun's delayed answers land, and the stage ticks."""
    clock.advance(s)
    mgr.pump()
    st.poll()
    await settle(st)


def _shoot(st, gun, n: int = 1, slot: int = 0, heat: int = 0, at_once: bool = False):
    """`n` rounds out of `slot`, as the gun reports them: one `$ALCD` a round, or one frame for all of them (`at_once`,
    a lost `$ALCD`). The fake's own counts move too, so its answer to a `$TMP` write reports the same magazine."""
    steps = [n] if at_once else [1] * n
    for k in steps:
        gun.mag[slot] -= k
        acc = max(0, min(100, 100 + gun.tmp_t4))
        st._inject_rx(f"$ALCD,{gun.mag[slot]},{acc},{slot},{gun.reserve.get(slot, 0)},{heat},*")


def _tmp(mgr, n) -> list[str]:
    return [f for f in since(mgr, n) if f.startswith("$TMP,")]


def test_the_derived_profile_is_the_engines_arithmetic():
    """engine.js `_recoilProfile` on a row that spells out NO rung (every golden trace spells them all out). The table
    app/test/engine.test.mjs pins (restated in test_balance_sim.py): the reference calibre (dmg 8) degrades on round 6
    and goes heavy on round 9, a heavier round sooner, a lighter one later, and an odd midpoint rounds DOWN. A floor
    equal to the ceiling, or no `recoil` block, is no profile at all."""
    st, _mgr, _clock = _mk()

    def row(dmg, **recoil):
        return {"stats": {"dmg": dmg}, "recoil": recoil}

    def want(crisp, degraded, heavy, after_shots, heavy_after):
        return {"crisp": crisp, "degraded": degraded, "heavy": heavy, "after_shots": after_shots,
                "heavy_after": heavy_after, "settle_ms": 600}

    cases = [
        (row(8, ceiling=100, floor=70, per_shot=10, recover_ms=150), want(100, 85, 70, 6, 9)),
        (row(8, ceiling=100, floor=60, per_shot=15, recover_ms=150), want(100, 80, 60, 6, 9)),
        (row(9, ceiling=100, floor=60, per_shot=10, recover_ms=150), want(100, 80, 60, 5, 8)),
        (row(13, ceiling=100, floor=60, per_shot=8, recover_ms=120), want(100, 80, 60, 4, 6)),
        (row(7, ceiling=100, floor=60, per_shot=15, recover_ms=150), want(100, 80, 60, 7, 10)),
        (row(7, ceiling=100, floor=65, per_shot=10, recover_ms=150), want(100, 82, 65, 7, 10)),
    ]
    for r, expected in cases:
        assert st._recoil_profile(r) == expected, (r, st._recoil_profile(r), expected)
    # the flat top-level `dmg` a test catalogue ships is read too, and a longer `settle_ms` raises the floor
    assert st._recoil_profile({"dmg": 8, "recoil": {"ceiling": 100, "floor": 70, "settle_ms": 900}})["settle_ms"] == 900
    assert st._recoil_profile({"stats": {"dmg": 9}, "recoil": {"ceiling": 100, "floor": 100, "per_shot": 0}}) is None
    assert st._recoil_profile({"stats": {"dmg": 9}}) is None


def test_a_swap_onto_a_flat_weapon_clears_the_modifier_it_inherited_once():
    """engine.js `_recoilArm`: t4 survives `$WEAP`, so a swap from a DEGRADED weapon onto one with no profile still
    arms an owner (no model), just long enough to write the base value back. One write, then nothing: the flat
    weapon's rounds step no ladder. CONTROL: the rifle really was degraded (-30) before the swap."""
    async def go():
        st, mgr, clock = _mk()
        await _live(st, mgr, clock)
        gun = mgr.taggers[GUN]
        n = mark(mgr)
        _shoot(st, gun, 3); await settle(st)
        await _tick(st, mgr, clock, 0.1)   # the gun answers the write at 70: confirmed
        assert _tmp(mgr, n) == ["$TMP,,,,-30,,,,,,,,*"], _tmp(mgr, n)
        assert st._recoil["model"] and st._recoil["state"] == "degraded"
        st._inject_rx("$BUT,1,1,*"); st._inject_rx("$BUT,1,0,*")
        n = mark(mgr)
        _shoot(st, gun, 1, slot=1); await settle(st)   # the round that confirms the swap, out of the shotgun
        assert st.active_slot == 1 and not st.switching
        assert st._recoil is not None and st._recoil["model"] is False and st._recoil["dirty"], st._recoil
        await _tick(st, mgr, clock)
        assert _tmp(mgr, n) == ["$TMP,,,,0,,,,,,,,*"], "the inherited -30 must be written back to the base, once"
        for _ in range(4):
            _shoot(st, gun, 1, slot=1); await settle(st)
            await _tick(st, mgr, clock)
        assert _tmp(mgr, n) == ["$TMP,,,,0,,,,,,,,*"], "a flat weapon's rounds must write nothing"
    asyncio.run(go())


def test_recoil_off_arms_nothing_and_a_long_burst_writes_nothing():
    """engine.js `recoilEnabled`: only an explicit `config.recoil: false` turns it off, and then `_recoilArm` arms
    nothing (no inherited modifier at a spawn). CONTROL: the same burst with recoil on degrades and goes heavy."""
    async def run(config):
        st, mgr, clock = _mk(config=config)
        await _live(st, mgr, clock)
        gun = mgr.taggers[GUN]
        n = mark(mgr)
        for _ in range(8):
            _shoot(st, gun, 1); await settle(st)
            await _tick(st, mgr, clock, 0.1)
        return st, _tmp(mgr, n)

    st, writes = asyncio.run(run({"recoil": False}))
    assert st._recoil is None and writes == [], writes
    st, writes = asyncio.run(run(None))
    assert writes == ["$TMP,,,,-30,,,,,,,,*", "$TMP,,,,-60,,,,,,,,*"], writes


def test_an_overheated_gun_holds_the_degrade_write_until_it_vents():
    """engine.js `_recoilFlush` stands down on `heat` (ammo.js `heatBlocksFire`: the last heat token on the active slot
    at or above HEAT_LOCKOUT): a locked gun cannot fire, so a write then is pointless and badly timed. The rung is
    still earned, and the write goes out on the first tick after the heat drops. CONTROL: below the lockout the
    same rounds write at once."""
    async def go(heat):
        st, mgr, clock = _mk()
        await _live(st, mgr, clock)
        gun = mgr.taggers[GUN]
        n = mark(mgr)
        _shoot(st, gun, 3, heat=heat); await settle(st)
        held = _tmp(mgr, n)
        await _tick(st, mgr, clock, 0.1)
        still = _tmp(mgr, n)
        st._inject_rx(f"$ALCD,{gun.mag[0]},100,0,{gun.reserve.get(0, 0)},0,*")   # the reload lever vented it
        await _tick(st, mgr, clock, 0.1)
        return held, still, _tmp(mgr, n), st._recoil["state"]

    held, still, after, state = asyncio.run(go(GunStage.HEAT_LOCKOUT))
    assert held == [] and still == [], f"a write went out at heat {GunStage.HEAT_LOCKOUT}: {held or still}"
    assert state == "degraded" and after == ["$TMP,,,,-30,,,,,,,,*"], after
    held, _still, _after, _state = asyncio.run(go(GunStage.HEAT_LOCKOUT - 1))
    assert held == ["$TMP,,,,-30,,,,,,,,*"], held


def test_a_hold_drops_a_write_awaiting_its_verify_and_re_sends_it_after_the_hold():
    """engine.js `_holdAccuracyWrites`: a cure re-assert's `$AMMO` owns the gun for ACC_HOLD_MS. A t4 write still waiting
    for its verify is DROPPED (an `$ALCD` answering the re-assert proves nothing about it) and re-marked dirty, so the
    same value is written again once the hold is over, and not inside it. CONTROL: a hold with nothing pending
    (the write already confirmed) re-sends nothing."""
    slow_settle = {**AR, "recoil": {**AR["recoil"], "settle_ms": 3000}}   # the rifle stays degraded through the hold
    async def go(confirm_first):
        st, mgr, clock = _mk(rows=(slow_settle, FLAT_SHOTGUN))
        await _live(st, mgr, clock)
        gun = mgr.taggers[GUN]
        n = mark(mgr)
        _shoot(st, gun, 3); await settle(st)
        if confirm_first:
            await _tick(st, mgr, clock, 0.1)   # the gun's answer at 70 confirms the write
        st._cure_reassert(gun.mag[0], gun.reserve.get(0, 0)); await settle(st)
        inside = []
        for _ in range(3):   # 0.75 s: still inside the 0.8 s hold
            await _tick(st, mgr, clock)
            inside = _tmp(mgr, n)
        await _tick(st, mgr, clock)
        return inside, _tmp(mgr, n)

    inside, after = asyncio.run(go(False))
    assert inside == ["$TMP,,,,-30,,,,,,,,*"], f"a re-send inside the hold: {inside}"
    assert after == ["$TMP,,,,-30,,,,,,,,*", "$TMP,,,,-30,,,,,,,,*"], after
    _inside, after = asyncio.run(go(True))
    assert after == ["$TMP,,,,-30,,,,,,,,*"], f"a confirmed write was re-sent after the hold: {after}"


def test_a_smoke_holds_the_writer_and_re_dirties_it_when_the_gun_gives_accuracy_back():
    """engine.js `_smokeObserve`/`_smokeCheck`/`_smokeClear` (S53): a `$HIR` and an accuracy drop to 0 together are a
    smoke, which owns t4 for SMOKE_MS; the writer stays quiet through it and re-asserts its target after (Codex r1)."""
    async def go():
        from brx_mcp.stage.stage import SMOKE_MS
        st, mgr, clock = _mk()
        await _live(st, mgr, clock)
        gun = mgr.taggers[GUN]
        _shoot(st, gun, 3); await settle(st)
        await _tick(st, mgr, clock, 0.1)
        assert st._recoil["state"] == "degraded"
        n = mark(mgr)
        st._inject_rx("$HIR,4,7,19,2,1,0,0,*")                                    # the Haze's word
        st._inject_rx(f"$ALCD,{gun.mag[0]},0,0,{gun.reserve.get(0, 0)},0,*")      # accuracy drops to 0 with it
        await settle(st)
        assert st.smoke is not None, "control: the pair is a smoke"
        for _ in range(int(SMOKE_MS / 250) - 2):
            await _tick(st, mgr, clock)
        assert _tmp(mgr, n) == [], f"no accuracy write while the smoke owns t4: {_tmp(mgr, n)}"
        await _tick(st, mgr, clock, 1.0)                                         # the smoke expires
        await _tick(st, mgr, clock)
        assert st.smoke is None
        assert _tmp(mgr, n) == ["$TMP,,,,0,,,,,,,,*"], f"the settled target is asserted once the gun gives t4 back: {_tmp(mgr, n)}"
    asyncio.run(go())


def test_an_end_drops_the_accuracy_model_before_its_frames_go_out():
    """engine.js `_endLocal` drops `_recoil` in the same call that queues the teardown, so no `$TMP` can land among the
    end frames (Codex r1: the stage cleared it only after awaiting the end write)."""
    async def go():
        st, mgr, clock = _mk()
        await _live(st, mgr, clock)
        gun = mgr.taggers[GUN]
        _shoot(st, gun, 3); await settle(st)
        seen = []
        real_write = st.write

        async def spy(frames, why, *a, **k):
            if why == "end":
                seen.append(st._recoil)
            return await real_write(frames, why, *a, **k)
        st.write = spy                                                           # type: ignore[method-assign]
        await st.end()
        assert seen == [None], "the model must be gone before the end frames are written"
    asyncio.run(go())
