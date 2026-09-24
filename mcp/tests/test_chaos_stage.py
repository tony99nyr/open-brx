"""CHAOS testing of the gun-stage fake (`brx_mcp/stage/stage.py` `GunStage`), which MIRRORS the phone
engine `app/src/engine.js`. Every test here drives two or more HARD effects (stun, smoke, poison, a plain hit,
a reload, a weapon swap) at once or in quick succession, on a hand-driven clock (`test_stage._Clock`),
and checks the invariants a chaotic match must never break:

- a pool (shield/armour/health) never goes negative and never exceeds its armed maximum
- every timed effect (stun, the poison stack) ends or clears on its own, never lingering past a death
- a life dies at most once, and no effect is left "active" on a dead gun
- a reload or a weapon swap in flight at death never completes into the dead life, and the next life
  can start a fresh one

No real sleeps: `_nosleep`/`_Clock` from `test_stage.py` stand in for the clock and the wire delay, the
same pair `test_stage_poison.py` and `test_stage_death_once.py` already use.

Run: python3 run_tests.py chaos_stage
"""
from __future__ import annotations

import asyncio
import random

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage.stage import GunStage
from test_stage import _Clock, _nosleep, settle

GUN = "FA:KE:00:00:00:01"
# The same game-wide `dot` table test_stage_poison.py uses: IR protocol 11 (the Toxin Rifle) ticks 4
# damage a second for 5 s.
DOT = {"11": {"weapon_id": "toxin_rifle", "per_tick": 4, "tick_ms": 1000, "duration_ms": 5000}}


def _mk(clock, **profile):
    mgr = FakeConnectionManager([FakeTagger(GUN, "FAKE-STAGE", team=1)])
    st = GunStage(mgr, None, sleep=_nosleep, now=clock, voice_verdict_sink=lambda _r: None)
    if profile:
        st.set_profile(**profile)
    return st, mgr


async def _settle_all(st) -> None:
    """Flush pending writes, then poll again so any reply the fake gun queued while flushing is drained
    and processed too. Ported from test_stage_poison.Bench._settle: the fake answers synchronously
    inside `send()`, but only the NEXT `poll()` reacts to what it queued."""
    for _ in range(5):
        await settle(st)
        st.poll()
    await settle(st)


def _sync_tagger(st, tagger) -> None:
    """Line the fake gun's pools and ceilings up with the stage's own armed maxima (the same defensive
    lift test_stage_poison.Bench.set_pools does), so a later hand-crafted hit drains from the numbers
    the stage already shows rather than a stale default."""
    tagger.cfg_hp = max(tagger.cfg_hp, st.max_hp)
    tagger.cfg_armor = max(tagger.cfg_armor, st.max_armor)
    tagger.cfg_shield = max(tagger.cfg_shield, st.max_shield)
    tagger.hp, tagger.armor, tagger.shield = st.hp, st.armor, st.shield
    tagger.alive = True


async def _set_pools(st, tagger, hp: int, armor: int, shield: int) -> None:
    tagger.cfg_hp = max(tagger.cfg_hp, hp)
    tagger.cfg_armor = max(tagger.cfg_armor, armor)
    tagger.cfg_shield = max(tagger.cfg_shield, shield)
    tagger.hp, tagger.armor, tagger.shield = hp, armor, shield
    st._inject_rx(f"$HP,{hp},{armor},{shield},*")
    await _settle_all(st)


async def _hit(st, tagger, proto: int, dmg: int, shooter: int = 3, team: int = 2, sub: int = 0) -> None:
    """A hit as the gun reports it: `$HIR` on `proto`, then the direct damage off the outer pool, then
    the matching `$HP`/`$LCD`. Ported from test_stage_poison.Bench.toxin, generalised to any protocol."""
    st._inject_rx(f"$HIR,0,{proto},{shooter},{team},{dmg},0,{sub},*")
    if dmg:
        tagger._drain_pools(dmg)
    if tagger.hp <= 0:
        st._inject_rx("$LCD,0,0,0,0,30,90,*")
    else:
        st._inject_rx(f"$HP,{tagger.hp},{tagger.armor},{tagger.shield},*")
    await _settle_all(st)


async def _stun_hit(st, shooter: int = 9, team: int = 2) -> None:
    """A proto-8 EMP word: a status row, no `$HP` follows (stage.py `_stun`'s own docstring)."""
    st._inject_rx(f"$HIR,0,8,{shooter},{team},0,0,0,*")
    await _settle_all(st)


async def _smoke_hit(st, shooter: int = 9, team: int = 2) -> None:
    """A "smoke" word: a readable team, no pool-moving frame behind it -- the same shape
    test_stage_poison.py's own smoke-word tests use (a bare `$HIR` with no `$HP`/`$LCD` echo)."""
    st._inject_rx(f"$HIR,0,7,{shooter},{team},6,0,0,*")
    await _settle_all(st)


def _deaths(st) -> int:
    return sum(1 for e in st.log if "☠ down" in str(e))


def _check_pools(st) -> None:
    assert 0 <= st.hp <= st.max_hp, f"hp {st.hp} out of [0,{st.max_hp}]"
    assert 0 <= st.armor <= st.max_armor, f"armor {st.armor} out of [0,{st.max_armor}]"
    assert 0 <= st.shield <= st.max_shield, f"shield {st.shield} out of [0,{st.max_shield}]"


# ---- 1: stun + smoke + poison at once, then more hits land ------------------------------------------


def test_stun_smoke_and_poison_stack_on_one_player_then_more_hits_land():
    """Three hard effects land on the same life at once, then three more hits arrive on top of them.
    No pool ever goes negative or over its armed maximum, and every timed effect ends on its own clock."""
    async def go():
        clock = _Clock()
        st, mgr = _mk(clock, stun=0, max_shield=20)
        await st.connect(GUN)
        await st.arm()
        st.bundle["dot"] = DOT                      # injected after arm(), which would otherwise wipe it
        st.bundle["cues"]["countdown"] = ""
        await st.spawn()
        await _settle_all(st)
        tagger = mgr.taggers[GUN]
        _sync_tagger(st, tagger)
        _check_pools(st)

        await _stun_hit(st)
        assert st.stunned is not None, "the EMP word armed the stun"

        await _smoke_hit(st)
        _check_pools(st)

        await _hit(st, tagger, 11, 8)                # proto 11 is the dot table's own protocol
        assert st.poison is not None, "the toxin word armed the poison stack too"
        _check_pools(st)

        for dmg in (5, 3, 4):                        # more hits land while all three effects are live
            await _hit(st, tagger, 0, dmg)
            _check_pools(st)
        assert st.alive, "the mix above must not be lethal -- the timers below need a live gun to expire on"

        for _ in range(60):                          # 15 s: past the 5 s poison stack and the 10 s stun default
            clock.advance(0.25)
            st.poll()
            await _settle_all(st)
            _check_pools(st)

        assert st.poison is None, "the poison stack ran its course"
        assert st.stunned is None, "the stun timer expired"
    asyncio.run(go())


# ---- 2: death while stunned + smoked + poisoned ------------------------------------------------------


def test_death_while_stunned_smoked_and_poisoned_clears_every_effect_once():
    async def go():
        clock = _Clock()
        st, mgr = _mk(clock, stun=0)
        await st.connect(GUN)
        await st.arm()
        st.bundle["dot"] = DOT
        st.bundle["cues"]["countdown"] = ""
        await st.spawn()
        await _settle_all(st)
        tagger = mgr.taggers[GUN]
        _sync_tagger(st, tagger)

        await _stun_hit(st)
        await _smoke_hit(st)
        await _set_pools(st, tagger, 4, 0, 0)
        await _hit(st, tagger, 11, 0)                # a zero-damage toxin word: arms the stack, hp stays 4
        assert st.poison is not None and st.stunned is not None

        clock.advance(1.0)                           # the tick fires -- per_tick=4 is exactly lethal at hp=4
        st.poll()
        await _settle_all(st)

        assert not st.alive, "the lethal tick killed the gun"
        assert _deaths(st) == 1, f"one death for this life, got {_deaths(st)}"
        assert st.poison is None, "poison cleared on death"
        assert st.stunned is None, "stun cleared on death (no restore write -- the revive's own $AMMO re-arms)"
        assert st._dot_kill is None and st._dot_echo is None, "the poison-kill bookkeeping is cleared too"

        life_writes = sum(1 for e in st.log if "$LIFE" in str(e))
        clock.advance(15.0)                          # past both the poison duration and the stun default
        st.poll()
        await _settle_all(st)
        assert st.poison is None and st.stunned is None, "no effect re-arms itself on a dead gun"
        assert sum(1 for e in st.log if "$LIFE" in str(e)) == life_writes, "no poison tick fires on a dead gun"

        await st.revive()
        await _settle_all(st)
        assert st.alive and st.spawned
        assert st.poison is None and st.stunned is None and st.reloading is None and st.switching is None
        assert (st.hp, st.armor, st.shield) == (st.max_hp, st.max_armor, 0), "the next life starts clean"
    asyncio.run(go())


# ---- 3: death mid-reload -------------------------------------------------------------------------------


def test_death_mid_reload_blocks_the_refill_and_revive_starts_clean():
    async def go():
        clock = _Clock()
        st, mgr = _mk(clock)
        await st.connect(GUN)
        await st.arm()
        await st.spawn()
        await _settle_all(st)

        st.alcd(mag=1, reserve=50, slot=0)           # a known, below-cap mag + a real reserve opens the reload gate
        st.reload()
        await _settle_all(st)
        assert st.reloading is not None, "the pull started a takeover"

        st._inject_rx("$HP,0,0,0,*")
        await _settle_all(st)
        assert not st.alive
        assert st.reloading is None, "death stops the reload"
        assert st.reload_outcome is None, "no outcome is booked for a takeover death cut off"

        st.alcd(mag=30, reserve=50, slot=0)          # a stray magazine report while down
        await _settle_all(st)
        assert st.reloading is None, "no magazine refill while down"

        await st.revive()
        await _settle_all(st)
        assert st.alive and st.reloading is None

        st.alcd(mag=1, reserve=50, slot=0)
        st.reload()
        await _settle_all(st)
        assert st.reloading is not None, "the gun can pull the handle again after a revive"
    asyncio.run(go())


# ---- 4: death mid-weapon-swap --------------------------------------------------------------------------


def test_death_mid_swap_blocks_the_confirm_and_revive_starts_on_slot_zero():
    async def go():
        clock = _Clock()
        st, mgr = _mk(clock)
        await st.connect(GUN)
        await st.arm()
        await st.spawn()
        await _settle_all(st)
        assert st.active_slot == 0

        st._inject_rx("$BUT,1,1,*")                  # ALT pressed: a swap starts
        await _settle_all(st)
        assert st.switching is not None, "the swap is in flight"

        st._inject_rx("$HP,0,0,0,*")
        await _settle_all(st)
        assert not st.alive
        assert st.switching is None, "death cancels the swap"
        assert st.active_slot == 0, "the swap never confirmed, so the active slot never moved"

        await st.revive()
        await _settle_all(st)
        assert st.alive and st.active_slot == 0, "a fresh life starts back on slot 0"

        st._inject_rx("$BUT,1,1,*")
        st.alcd(mag=5, reserve=50, slot=1)           # the gun's own report of the new slot confirms the swap
        await _settle_all(st)
        assert st.switching is None and st.active_slot == 1, "a swap can start and complete again after the revive"
    asyncio.run(go())


# ---- 5: a seeded randomised mix ------------------------------------------------------------------------


async def _run_chaos_seed(seed: int) -> None:
    rng = random.Random(seed)
    clock = _Clock()
    st, mgr = _mk(clock, stun=0, max_shield=20)
    await st.connect(GUN)
    await st.arm()
    st.bundle["dot"] = DOT
    st.bundle["cues"]["countdown"] = ""
    await st.spawn()
    await _settle_all(st)
    tagger = mgr.taggers[GUN]
    _sync_tagger(st, tagger)
    st.alcd(mag=10, reserve=100, slot=0)             # a known mag/reserve, so reload has something to work with
    await _settle_all(st)

    events: list[str] = []
    revives = 0
    deaths = 0

    def fail(msg: str) -> None:
        raise AssertionError(f"seed={seed} after {len(events)} events {events}: {msg}")

    for _ in range(rng.randint(40, 80)):
        was_alive = st.alive
        action = rng.choice(["hit", "toxin", "stun", "smoke", "reload", "swap", "advance", "ammo", "lethal"]
                             if was_alive else ["revive", "advance"])
        events.append(action)

        if action == "hit":
            await _hit(st, tagger, 0, rng.randint(1, 10))
        elif action == "lethal":
            await _hit(st, tagger, 0, st.hp + st.armor + st.shield + 20)
        elif action == "toxin":
            await _hit(st, tagger, 11, rng.randint(0, 8))
        elif action == "stun":
            await _stun_hit(st)
        elif action == "smoke":
            await _smoke_hit(st)
        elif action == "reload":
            st.reload()
            await _settle_all(st)
        elif action == "swap":
            st._inject_rx("$BUT,1,1,*")
            await _settle_all(st)
        elif action == "ammo":
            st.alcd(mag=rng.randint(0, 30), reserve=rng.randint(0, 200), slot=st.active_slot)
            await _settle_all(st)
        elif action == "advance":
            clock.advance(round(rng.uniform(0.1, 2.0), 2))
            st.poll()
            await _settle_all(st)
        elif action == "revive":
            revives += 1
            await st.revive()
            await _settle_all(st)
            _sync_tagger(st, tagger)

        if was_alive and not st.alive:
            deaths += 1

        if not (0 <= st.hp <= st.max_hp):
            fail(f"hp {st.hp} out of [0,{st.max_hp}]")
        if not (0 <= st.armor <= st.max_armor):
            fail(f"armor {st.armor} out of [0,{st.max_armor}]")
        if not (0 <= st.shield <= st.max_shield):
            fail(f"shield {st.shield} out of [0,{st.max_shield}]")
        if deaths > revives + 1:
            fail(f"deaths {deaths} exceeds revives {revives} + 1")
        if not st.alive:
            if st.stunned is not None:
                fail("stunned is still active on a dead gun")
            if st.poison is not None:
                fail("poison is still active on a dead gun")


def test_seeded_chaos_mix_never_breaks_the_pool_or_death_invariants():
    async def go():
        for seed in range(1, 6):
            await _run_chaos_seed(seed)
    asyncio.run(go())
