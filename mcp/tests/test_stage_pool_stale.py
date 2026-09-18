"""F208: the stage MIRRORS engine.js `poolStale` (app/test/pool-stale.test.mjs is the phone side).

'silent': no frame of any kind for GUN_QUIET_STALE_S. 'no_fire': NO_FIRE_PULLS trigger presses in a row on a
live, loaded gun with no `$HP`/`$LCD`/`$ALCD` between them. A healthy idle gun ($VOLTS every ~60 s, one missed)
never trips it. The stage clock is in SECONDS (engine.js is in ms).

Run: python3 run_tests.py stage_pool_stale
"""
from __future__ import annotations

import asyncio

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage.stage import GunStage
from test_stage import _Clock, _nosleep, settle

GUN = "FA:KE:00:00:00:01"
VOLTS = "$VOLTS,8428,4164,100,100,*"
ENGINE_JS = __import__("pathlib").Path(__file__).resolve().parents[2] / "app" / "src" / "engine.js"


def _mk():
    mgr = FakeConnectionManager([FakeTagger(GUN, "FAKE-STAGE", team=1)])
    clock = _Clock()
    st = GunStage(mgr, None, sleep=_nosleep, now=clock, voice_verdict_sink=lambda _r: None)
    return st, mgr, clock


async def _live(st, clock):
    await st.connect(GUN)
    await st.arm(); await st.spawn(); await settle(st)
    st._inject_rx("$LCD,45,70,0,0,30,90,*")
    st._inject_rx("$BUT,0,1,*"); st._inject_rx("$ALCD,29,100,0,192,0,*"); st._inject_rx("$BUT,0,0,*")
    return st


def _adv(st, clock, s: float, step: float = 0.25):
    end = clock() + s
    while clock() < end:
        clock.advance(min(step, end - clock())); st.poll()


def _dry_pull(st, clock):
    st._inject_rx("$BUT,0,1,*"); _adv(st, clock, 0.2); st._inject_rx("$BUT,0,0,*"); _adv(st, clock, 1.8)


def test_the_thresholds_match_the_phone():
    js = ENGINE_JS.read_text(encoding="utf-8")
    assert f"GUN_QUIET_STALE_MS = {int(GunStage.GUN_QUIET_STALE_S * 1000)};" in js
    assert f"TRIGGER_NO_FIRE_MS = {int(GunStage.TRIGGER_NO_FIRE_S * 1000)};" in js
    assert f"NO_FIRE_PULLS = {GunStage.NO_FIRE_PULLS};" in js
    assert f"HEAT_LOCKOUT = {GunStage.HEAT_LOCKOUT};" in js
    assert f"HEAT_STALE_MS = {int(GunStage.HEAT_STALE_S * 1000)};" in js


def test_a_healthy_idle_gun_is_never_stale():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        for i in range(10):
            _adv(st, clock, 120.3 if i == 4 else 60.15, step=5)
            assert st.pool_stale() is None, f"idle minute {i}, just before the $VOLTS"
            st._inject_rx(VOLTS)
    asyncio.run(run())


def test_firing_dry_and_dead_pulls_are_not_stale():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        for mag in range(28, 22, -1):
            st._inject_rx("$BUT,0,1,*"); st._inject_rx(f"$ALCD,{mag},100,0,192,0,*"); _adv(st, clock, 2)
        assert st.pool_stale() is None, "every pull answered"
        st._inject_rx("$ALCD,0,100,0,192,0,*")
        for _ in range(5):
            _dry_pull(st, clock)
        assert st.pool_stale() is None, "an empty magazine owes no shot"
        st._inject_rx("$ALCD,30,70,0,192,0,*")
        st._inject_rx("$HP,0,0,0,*"); await settle(st)
        assert not st.alive
        for _ in range(5):
            _dry_pull(st, clock)
        assert st.pool_stale() is None, "a dead player owes no shot"
    asyncio.run(run())


def test_three_unanswered_pulls_are_stale_and_a_pool_report_clears_it():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        _adv(st, clock, 30, step=1)
        _dry_pull(st, clock); st._inject_rx(VOLTS); _dry_pull(st, clock)
        assert st.pool_stale() is None, "two are not yet a claim"
        _dry_pull(st, clock)
        s = st.pool_stale()
        assert s and s["why"] == "no_fire" and s["s"] >= 35, s
        assert st.state()["model"]["pool_stale"]["why"] == "no_fire"
        st._inject_rx("$HP,0,0,0,*"); await settle(st)
        assert st.pool_stale() is None
    asyncio.run(run())


def test_a_silent_gun_is_stale_until_any_frame():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        _adv(st, clock, GunStage.GUN_QUIET_STALE_S + 10, step=5)   # the fake gun answers the arm once, at +5 s
        s = st.pool_stale()
        assert s and s["why"] == "silent", s
        st._inject_rx(VOLTS)
        assert st.pool_stale() is None
    asyncio.run(run())


def test_review_2026_09_17_overheat_is_excluded_from_no_fire_until_the_reading_goes_stale():
    """Review 2026-09-17: `_await_shot`/`_no_fire_tick` did not exclude a real OVERHEAT lockout -- the
    stage had no heat tracking at all, so a locked-out gun's unanswered pulls would wrongly book NO_FIRE.
    Mirrors engine.js's own exclusion, and its staleness: the gun sends no $ALCD while cooling, so a
    reading past HEAT_LOCKOUT is trusted for only HEAT_STALE_S before ordinary no_fire tracking resumes."""
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        st._inject_rx("$ALCD,10,100,0,192,108,*")     # match 592e444eff: a real bench overheat capture
        assert st._heat_blocks_fire()
        for _ in range(5):
            _dry_pull(st, clock)
        assert st.pool_stale() is None, "overheat-locked pulls must never book NO_FIRE"
        # the second guard: overheat starting AFTER a press is already pending must also cancel the count
        st._inject_rx("$ALCD,10,100,0,192,10,*")       # cooled: not overheating any more
        st._inject_rx("$BUT,0,1,*")                    # a press goes pending
        st._inject_rx("$ALCD,10,100,0,192,108,*")      # overheat starts before the deadline
        _adv(st, clock, GunStage.TRIGGER_NO_FIRE_S + 0.1, step=0.1)
        st._inject_rx("$BUT,0,0,*")
        assert st.pool_stale() is None, "overheat that started after the press was already pending still excludes it"
        # once the reading goes stale, it can no longer suppress a REAL no_fire condition
        _adv(st, clock, GunStage.HEAT_STALE_S + 1, step=1)
        assert not st._heat_blocks_fire(), "no new $ALCD for HEAT_STALE_S: the reading is no longer trusted"
        for _ in range(3):
            _dry_pull(st, clock)
        s = st.pool_stale()
        assert s and s["why"] == "no_fire", "a stale reading no longer excludes it: no_fire tracks again"
    asyncio.run(run())


def test_pl4_the_lockout_line_is_99_for_both_measured_weapons():
    """pl4 (brx-weapons bench 2026-09-17): the Energy Rifle stops firing AT 99 (never above 100); the Charge
    Rifle stops at about 103. engine.js `heat >= HEAT_LOCKOUT`; 98 is still build-up."""
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        st._inject_rx("$ALCD,10,100,0,192,98,*")
        assert not st._heat_blocks_fire(), "98 is build-up"
        st._inject_rx("$ALCD,9,100,0,192,99,*")
        assert st._heat_blocks_fire(), "the Energy Rifle's lockout reading"
        st._inject_rx("$ALCD,9,100,0,192,103,*")
        assert st._heat_blocks_fire(), "the Charge Rifle's"
    asyncio.run(run())
