"""S16 (spec/node.md §3.17): the poison tick clock the stage runs, ported from app/src/engine.js and proven
against app/test/poison.test.mjs (the phone's own suite for the same rule). Every timer here runs on a
hand-driven clock (`test_stage._Clock`), advanced by the test, never a real sleep. The fake gun's own
`$LIFE` handling (`FakeTagger.write`, the "LIFE" branch) already models the bench-measured per-pool,
no-spill, floor-0 answer, so a tick's write is never hand-echoed: it is left to travel the real write path
and answered by the fake gun itself, exactly as a real one would.

Run: python3 run_tests.py stage_poison
"""
from __future__ import annotations

import asyncio
import re

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage.stage import GunStage, PROBE_LIFE
from test_stage import _Clock, _nosleep, settle, tx

GUN = "FA:KE:00:00:00:01"
# The bundle's game-wide `dot` table (`FrameBundle.dot`, S16): IR protocol 11 (the Toxin Rifle) ticks 4
# damage a second for 5 s -- the same numbers app/test/poison.test.mjs uses, so the two suites agree.
DOT = {"11": {"weapon_id": "toxin_rifle", "per_tick": 4, "tick_ms": 1000, "duration_ms": 5000}}
_LIFE_RE = re.compile(r"^\$LIFE,(-?\d+),(-?\d+),(-?\d+),\*$")


class Bench:
    """A live match against `FakeTagger`, the Python twin of app/test/poison.test.mjs's `harness()`.

    A tick's `$LIFE` write goes to the REAL fake gun (`self.tagger`) and its `$HP`/`$LCD` answer comes back
    the same way a hardware gun's would -- the fake's own "LIFE" write handler already carries the
    bench-measured per-pool/no-spill/floor-0/self-emit rule, so there is no second copy of that arithmetic
    here. `toxin()`/`set_pools()` steer the tagger's pools directly (an arbitrary custom pool, or a hit on a
    protocol with no `$SIR` row of its own) and hand the stage the matching frame by hand.

    `events` records every `_event_now` call, so a cue firing (or not firing) is provable without depending
    on which sounds a given profile happens to have configured."""

    def __init__(self, dot: dict | None = DOT):
        self.tagger = FakeTagger(GUN, "FAKE-STAGE", team=1)
        self.mgr = FakeConnectionManager([self.tagger])
        self.clock = _Clock()
        self.st = GunStage(self.mgr, None, sleep=_nosleep, now=self.clock, voice_verdict_sink=lambda _r: None)
        self._dot = dot                          # applied after `arm()`'s recompile, which would otherwise wipe it
        self.events: list[str] = []
        orig_event_now = self.st._event_now

        def _tap(kind: str, sound: bool = True) -> None:
            self.events.append(kind)
            orig_event_now(kind, sound)
        self.st._event_now = _tap   # type: ignore[method-assign]
        # `hold` keeps the gun's pool answers ($HP/$LCD) out of the stage until `release()`, so a test can put
        # other frames between a tick write and its answer (engine.js's harness has the same `gun.hold`).
        self.hold = False
        self.held: list[str] = []
        orig_drain = self.tagger.drain

        def _drain() -> list[str]:
            out = orig_drain()
            if not self.hold:
                return out
            self.held += [f for f in out if f.startswith(("$HP,", "$LCD,"))]
            return [f for f in out if not f.startswith(("$HP,", "$LCD,"))]
        self.tagger.drain = _drain   # type: ignore[method-assign]

    async def start(self) -> "Bench":
        st = self.st
        await st.connect(GUN)
        await st.arm()                          # recompiles the bundle -- the `dot` table is injected AFTER this
        if self._dot is not None:
            st.bundle["dot"] = self._dot
        st.bundle["cues"]["countdown"] = ""     # these tests are about the poison clock, not the spawn countdown
        await st.spawn()
        await self._settle()
        assert st.alive and st.spawned
        self.events.clear()                     # the spawn burst is not what these tests are about
        return self

    async def _settle(self) -> None:
        """Flush pending writes, then poll again so any reply the fake gun queued while flushing (a tick's
        own `$HP`/`$LCD`, self-emitted by `FakeTagger.write`, or an unrelated F264 spawn-probe round trip)
        is drained and processed too -- the fake answers synchronously inside `send()`, but only the NEXT
        `poll()` call reacts to what it queued, and that reaction can itself schedule another write. A few
        rounds settles it to a fixpoint rather than leaving one generation of reply unprocessed."""
        for _ in range(5):
            await settle(self.st)
            self.st.poll()
        await settle(self.st)

    async def adv(self, seconds: float, step: float = 0.25) -> "Bench":
        end = self.clock.t + seconds
        while self.clock.t < end - 1e-9:
            self.clock.advance(min(step, end - self.clock.t))
            self.st.poll()
            await self._settle()
        return self

    async def toxin(self, shooter: int = 3, team: int = 2, dmg: int = 8, proto: int = 11) -> "Bench":
        """A hit as the gun reports it: `$HIR` on `proto`, then the direct damage off the outer pool. Goes
        around `FakeTagger.receive_ir`'s own `$SIR` table (a poison weapon need not be in the stock rows
        under test) by steering the tagger's pools directly, the way `receive_ir` itself would (shield ->
        armour -> health, spilling inward) and handing the stage the matching frame by hand."""
        self.st._inject_rx(f"$HIR,0,{proto},{shooter},{team},{dmg},0,0,*")
        if dmg:
            self.tagger._drain_pools(dmg)
        t = self.tagger
        if t.hp <= 0:
            self.st._inject_rx("$LCD,0,0,0,0,30,90,*")
        else:
            self.st._inject_rx(f"$HP,{t.hp},{t.armor},{t.shield},*")
        await self._settle()
        return self

    async def set_pools(self, hp: int, armor: int, shield: int) -> "Bench":
        self.tagger.hp, self.tagger.armor, self.tagger.shield = hp, armor, shield
        self.st._inject_rx(f"$HP,{hp},{armor},{shield},*")
        await self._settle()
        return self

    async def release(self) -> "Bench":
        """Hand the stage the held answers now, in order, and stop holding."""
        self.hold = False
        held, self.held = self.held, []
        for f in held:
            self.st._inject_rx(f)
        await settle(self.st)
        return self

    async def rx(self, frame: str) -> "Bench":
        self.st._inject_rx(frame)
        await settle(self.st)
        return self

    def ticks(self) -> list[str]:
        return [f for f in tx(self.mgr) if _LIFE_RE.match(f) and f != PROBE_LIFE]

    def poison(self) -> dict | None:
        return self.st.state()["model"]["poison"]


def test_a_toxin_hit_starts_the_stack_plays_poisoned_once_and_ticks_off_the_armour():
    async def go():
        b = await Bench().start()
        await b.toxin(3, 2, 8)
        p = b.poison()
        assert p is not None, "the stack is on"
        assert p["proto"] == 11 and p["per_tick"] == 4
        assert round(p["left_s"], 2) == 5.0
        assert p["by"]["num"] == 3, "the applier is named"
        assert b.events.count("poisoned") == 1, "the start cue played once"
        assert b.ticks() == [], "no tick before the first interval"
        await b.adv(1.0)
        assert b.ticks() == ["$LIFE,0,-4,0,*"], "one tick at +1 s, off the armour (shield/armour default 0/70)"
        assert round(b.poison()["left_s"], 2) == 4.0
    asyncio.run(go())


def test_a_hit_on_another_protocol_or_a_bundle_with_no_dot_table_never_poisons():
    async def go():
        b = await Bench().start()
        await b.toxin(3, 2, 8, proto=0)          # a plain hit -- proto 0 is not in the dot table
        assert b.st.poison is None
        no_dot = await Bench(dot=None).start()
        await no_dot.toxin(3, 2, 8)
        await no_dot.adv(6.0)
        assert no_dot.st.poison is None, "a pre-S16 bundle: no table, no poison"
        assert no_dot.ticks() == []
    asyncio.run(go())


def test_each_tick_takes_the_outermost_non_empty_pool_shield_then_armour_then_health():
    async def go():
        b = await Bench().start()
        await b.set_pools(45, 5, 6)
        await b.toxin(3, 2, 0)                   # a zero-damage word keeps the pools exact for the arithmetic
        await b.adv(5.0)
        assert b.ticks() == ["$LIFE,0,0,-4,*", "$LIFE,0,0,-4,*", "$LIFE,0,-4,0,*", "$LIFE,0,-4,0,*", "$LIFE,-4,0,0,*"], \
            "shield 6 -> 2 -> 0 (the remainder is lost, no spill), armour 5 -> 1 -> 0, then health"
        assert [b.tagger.hp, b.tagger.armor, b.tagger.shield] == [41, 0, 0]
        await b.adv(3.0)
        assert len(b.ticks()) == 5, "five ticks in five seconds, then the stack is over"
        assert b.st.poison is None
    asyncio.run(go())


def test_a_hit_off_the_poll_grid_still_gets_all_five_ticks():
    """engine.js mirror: the last tick is due exactly AT `until`, so a poll up to one interval late must fire it.
    A guard on the poll time alone dropped it, and a stack did 16 damage, not 20."""
    async def go():
        b = await Bench().start()
        await b.toxin(3, 2, 0)
        await b.adv(0.13)                        # every later poll lands 130 ms off the hit's own grid
        await b.adv(5.87)
        assert len(b.ticks()) == 5, "five ticks: 20 poison damage, as the balance numbers assume"
        assert b.st.poison is None
    asyncio.run(go())


def test_a_second_hit_refreshes_to_full_duration_keeps_cadence_and_names_the_new_applier():
    async def go():
        b = await Bench().start()
        await b.toxin(3, 2, 8)
        await b.adv(2.5)
        assert len(b.ticks()) == 2
        await b.toxin(5, 2, 8)                   # another shooter, 2.5 s in
        p = b.poison()
        assert round(p["left_s"], 2) == 5.0, "refreshed to the full duration"
        assert p["by"]["num"] == 5, "the most recent applier"
        assert b.events.count("poisoned") == 1, "a refresh does not replay the start cue"
        await b.adv(1.0)
        assert len(b.ticks()) == 3, "still one tick a second: two applications did not add a second clock"
        await b.adv(10.0)
        assert len(b.ticks()) == 7, "ticks at +1..+7 s: the refresh ran the stack to +7.5 s"
    asyncio.run(go())


def test_the_ticks_own_echo_is_not_a_hit_but_a_real_hit_still_counts():
    async def go():
        b = await Bench().start()
        await b.set_pools(45, 0, 0)              # armour/shield empty: every hit (direct or tick) reaches HEALTH, so pain can fire
        b.events.clear()                         # the set_pools drop is its own (unrelated) hit_taken -- not what this test is about
        await b.toxin(3, 2, 8)
        assert b.events.count("hit_taken") == 1, "the direct hit is a hit"
        pain_after_direct_hit = b.st._last_pain_at
        assert pain_after_direct_hit is not None, "the direct hit reached health, so it grunts"
        await b.adv(1.0)
        assert len(b.ticks()) == 1
        assert b.events.count("hit_taken") == 1, "the tick at +1 s booked no second hit"
        assert b.st._last_pain_at == pain_after_direct_hit, "no pain grunt on the tick's own echo"
        # a real hit landing in the same second still counts
        b.st._inject_rx("$HIR,0,0,5,2,9,0,0,*")
        b.tagger._drain_pools(9)
        b.st._inject_rx(f"$HP,{b.tagger.hp},{b.tagger.armor},{b.tagger.shield},*")
        await settle(b.st)
        assert b.events.count("hit_taken") == 2, "a real hit inside the same second still counts"
        assert b.st._last_pain_at != pain_after_direct_hit, "and it plays its own pain grunt"
    asyncio.run(go())


def test_death_clears_the_stack_and_credits_the_applier_on_a_lethal_tick():
    async def go():
        b = await Bench().start()
        await b.set_pools(4, 0, 0)
        await b.toxin(3, 2, 0)                   # zero-damage: only arms the stack, hp stays exactly 4
        await b.adv(1.0)
        assert b.ticks() == ["$LIFE,-4,0,0,*"]
        assert not b.st.alive
        assert b.st.poison is None, "death clears the stack"
        assert any("poison kill credited to #3" in e["text"] for e in b.st.log), \
            "the lethal tick's kill is logged against the applier"
        n = len(b.ticks())
        await b.adv(3.0)
        assert len(b.ticks()) == n, "no ticks on a dead gun"
    asyncio.run(go())


def test_an_operator_revive_of_a_live_poisoned_player_clears_the_stack_too():
    async def go():
        b = await Bench().start()
        await b.toxin(3, 2, 8)
        assert b.st.poison is not None
        await b.st.revive()
        await settle(b.st)
        assert b.st.poison is None, "a respawn is a new life"
    asyncio.run(go())


def test_no_ticks_after_end_or_panic():
    async def go():
        b = await Bench().start()
        await b.toxin(3, 2, 8)
        await b.adv(1.0)
        assert len(b.ticks()) == 1
        await b.st.end()
        await settle(b.st)
        assert b.st.poison is None
        n = len(b.ticks())
        await b.adv(6.0)
        assert len(b.ticks()) == n, "no ticks after end"

        c = await Bench().start()
        await c.toxin(3, 2, 8)
        await c.st.panic()
        await settle(c.st)
        assert c.st.poison is None
        n2 = len(c.ticks())
        await c.adv(6.0)
        assert len(c.ticks()) == n2, "no ticks after panic"
    asyncio.run(go())


# ---- review 2026-09-19: the echo is matched on WHAT moved, not on timing alone -------------------------


def test_the_ticks_hp_queued_behind_a_real_hir_is_still_the_tick():
    """engine.js: 'the tick's $HP queued BEHIND a real $HIR is still the tick'."""
    async def go():
        b = await Bench().start()
        await b.set_pools(45, 70, 0)
        await b.toxin(3, 2, 0)
        b.events.clear()
        b.hold = True
        await b.adv(1.0)
        assert b.ticks() == ["$LIFE,0,-4,0,*"]
        assert b.held == ["$HP,45,66,0,*"], "the tick's answer is still in flight"
        await b.rx("$HIR,0,0,5,2,9,0,0,*")      # a real hit lands between the tick write and its $HP
        await b.release()
        assert b.events.count("hit_taken") == 0, "the tick's $HP moved armour by exactly 4: the tick, not a hit"
        b.tagger.armor = 57
        await b.rx("$HP,45,57,0,*")
        assert b.events.count("hit_taken") == 1, "the real hit books exactly one hit"
    asyncio.run(go())


def test_a_real_hit_whose_hir_came_just_before_the_tick_is_not_swallowed_as_the_echo():
    """engine.js: 'a real hit whose $HIR came just BEFORE the tick write is not swallowed'."""
    async def go():
        b = await Bench().start()
        await b.set_pools(45, 70, 0)
        await b.toxin(3, 2, 0)
        await b.adv(0.75)
        b.events.clear()
        await b.rx("$HIR,0,0,5,2,9,0,0,*")      # the real hit, 250 ms before the tick
        b.hold = True
        await b.adv(0.25)
        assert b.ticks() == ["$LIFE,0,-4,0,*"]
        b.hold, b.held = False, []              # the gun took the hit first: 70 -> 61 (hit) -> 57 (tick)
        b.tagger.armor = 57
        await b.rx("$HP,45,61,0,*")
        assert b.events.count("hit_taken") == 1, "the real hit's $HP moved armour by 9, not 4: a hit"
        await b.rx("$HP,45,57,0,*")
        assert b.events.count("hit_taken") == 1, "the tick's own $HP after it is the echo"
    asyncio.run(go())


def test_an_lcd_between_a_tick_write_and_its_hp_does_not_use_up_the_echo():
    """engine.js's LCD case never reaches `_onHp`, so the phone keeps `_dotEcho` over an $LCD. So must the
    stage, and the $LCD books no hit either (engine.js: 'an $LCD between a tick write and its $HP')."""
    async def go():
        b = await Bench().start()
        await b.set_pools(45, 70, 0)
        await b.toxin(3, 2, 0)
        b.events.clear()
        b.hold = True
        await b.adv(1.0)
        await b.rx("$LCD,45,66,0,0,30,90,*")    # a poll answer that already carries the tick
        echo = b.st._dot_echo
        assert echo is not None, "the echo is still waiting for the tick's $HP"
        assert (echo["pool"], echo["n"]) == ("armor", 4)
        assert b.events.count("hit_taken") == 0, "an $LCD books no hit, exactly as on the phone"
        assert (b.st.hp, b.st.armor) == (45, 66), "but it does set the pools"
    asyncio.run(go())


def test_a_clock_that_stalled_past_the_end_of_the_stack_fires_no_late_tick():
    async def go():
        b = await Bench().start()
        await b.toxin(3, 2, 8)
        await b.adv(6.0, step=6.0)              # one poll, after `until`
        assert b.ticks() == [], "the stack ran out while the poll slept"
        assert b.st.poison is None
    asyncio.run(go())


def test_an_armour_tick_does_not_claim_an_unrelated_death():
    async def go():
        b = await Bench().start()
        await b.set_pools(45, 70, 0)
        await b.toxin(3, 2, 0)
        await b.adv(1.0)
        assert b.ticks() == ["$LIFE,0,-4,0,*"], "the tick hit armour"
        b.tagger.hp, b.tagger.armor = 0, 0
        await b.rx("$HP,0,0,0,*")               # a death with no newer $HIR (a lost word, an ambient hill)
        assert not b.st.alive
        assert not any("poison kill credited" in e["text"] for e in b.st.log), \
            "only a health tick can kill, so this is not a poison kill"
    asyncio.run(go())
