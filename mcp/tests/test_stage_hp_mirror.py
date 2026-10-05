"""F478-F480: the stage mirrors three engine.js rules the hp-* golden traces exposed (test_golden_traces.py).

  - F478 (engine.js `_gun`, announcer.js `GunAudio` and `Announcer`): the gun audio model. A grunt that would wait
    longer than PAIN_STALE_MS behind a clip is dropped; a pool voice line waits for a silent gun and goes stale; the
    low-health line holds until the gun is quiet and is dropped past HURT_MAX_WAIT_MS. The golden runner drives the
    stage on an instant `sleep`, so the holds are pinned here on a clock-driven one (`_Sched`).
  - F479 (engine.js `_spawn`, `_armLife`): a LATE start carries the live table in front of `$SPAWN`; the burst waits out
    the countdown cue's PLAY gap, so its send undoes the table claim, and the first revive re-arms the table in its
    own write straight after the revive burst.
  - F480, B5 (engine.js `_deathPending`): a zero-HP frame just after a spawn or revive write, with no fresh latch and
    no hp>0 report since the write, is presumed a STALE echo and held; the tick re-examines it once the settle window
    is over. A held zero is game state (who is dead), so the stage books it exactly when the phone does.

Run: python3 run_tests.py stage_hp_mirror
"""
from __future__ import annotations

import asyncio
import pathlib
import random
import re

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.mc.types import DEATH_LATCH_MS
from brx_mcp.stage import stage as S
from brx_mcp.stage.stage import GunStage
from test_stage import _Clock, _nosleep, settle, tx

GUN = "FA:KE:00:00:00:01"


def _mk():
    clock = _Clock()
    mgr = FakeConnectionManager([FakeTagger(GUN, "FAKE-STAGE", team=1, clock=clock)])
    st = GunStage(mgr, None, sleep=_nosleep, now=clock, voice_verdict_sink=lambda _r: None)
    return st, mgr, clock


async def _down_then_revived(st, clock):
    """A live gun, killed by a real hit, then revived. The revive's own `$LCD` answer is dropped, so the gun has not
    yet reported a life on the wire (the B5 window is open)."""
    await st.connect(GUN)
    await st.arm(); await st.spawn(); await settle(st)
    st.poll(); await settle(st)
    st._inject_rx("$HIR,4,0,19,2,45,0,3,*"); st._inject_rx("$HP,0,0,0,*"); await settle(st)
    assert not st.alive, "control: a real kill with a fresh latch is a death"
    clock.advance(8)
    await st.revive(); await settle(st)
    st._last_seq = st.mgr.get_events(st.alias, max_events=10**6)["events"][-1]["seq"]   # drop the revive's `$LCD`
    st._reacted_seq = st._last_seq
    assert st.alive


def test_b5_a_stale_zero_just_after_a_revive_is_held_and_reexamined_once_the_window_ends():
    async def run():
        st, _mgr, clock = _mk()
        await _down_then_revived(st, clock)
        clock.advance(DEATH_LATCH_MS / 1000 * 0.2)       # well inside the settle window, the latch long stale
        st._inject_rx("$HP,0,0,0,*"); await settle(st)
        assert st.alive, "B5: an unattributed zero inside the settle window is held, not booked as a death"
        assert st.hp == 0, "the pools still say what the gun said"
        st.poll(); await settle(st)
        assert st.alive, "the tick keeps holding it while the window is open"
        clock.advance(DEATH_LATCH_MS / 1000)
        st.poll(); await settle(st)
        assert not st.alive, "B5 re-examine: past the window the zero (still on the wire) is a death"
    asyncio.run(run())


def test_b5_a_zero_with_a_fresh_latch_inside_the_window_is_a_death_at_once():
    async def run():
        st, _mgr, clock = _mk()
        await _down_then_revived(st, clock)
        clock.advance(0.3)
        st._inject_rx("$HIR,4,0,19,2,45,0,3,*"); st._inject_rx("$HP,0,0,0,*"); await settle(st)
        assert not st.alive, "a spawn-camp kill is a real hit: the fresh latch clears the window"
    asyncio.run(run())


def test_b5_a_zero_after_the_gun_reported_a_life_is_a_death_at_once():
    async def run():
        st, _mgr, clock = _mk()
        await _down_then_revived(st, clock)
        clock.advance(0.3)
        st._inject_rx("$HP,45,70,0,*"); await settle(st)
        clock.advance(0.3)
        st._inject_rx("$HP,0,0,0,*"); await settle(st)
        assert not st.alive, "the gun confirmed this life on the wire (`_armedThisLife`): the window is over"
    asyncio.run(run())


# ---- F478: the gun audio model ----------------------------------------------------------------------------------

HIT = "$HIR,4,0,19,2,9,0,3,*"          # a damaging word (proto 0, subtype 3: a `$SIR` row with no sound of its own)
LONG = "$PLAY,,4,6,VA86,,,,*"          # 1984 ms in the phone's CLIP_MS: longer than PAIN_STALE_MS and the status TTL


class _Sched:
    """A `sleep` on the test clock: each one resolves when `advance` moves the clock past its end (whole ms, as the
    engine's timers), so the stage's holds run on the same clock as its audio model, as on the bench. Off until the
    stage is live, so the setup runs at once."""

    def __init__(self, clock):
        self.clock = clock
        self.on = False
        self.waiting: list = []

    async def sleep(self, s: float) -> None:
        if not self.on or s <= 0:
            return
        fut = asyncio.get_running_loop().create_future()
        self.waiting.append((round((self.clock.t + s) * 1000), fut))
        await fut

    async def advance(self, st, seconds: float, step: float = 0.05, each=None) -> None:
        end = self.clock.t + seconds
        while self.clock.t < end - 1e-9:
            self.clock.advance(min(step, end - self.clock.t))
            for w in sorted([w for w in self.waiting if w[0] <= round(self.clock.t * 1000)], key=lambda w: w[0]):
                self.waiting.remove(w)
                if not w[1].done():
                    w[1].set_result(None)
            await _yield()
            st.poll()
            await _yield()
            if each:
                each()
                await _yield()


async def _yield(n: int = 40) -> None:
    for _ in range(n):
        await asyncio.sleep(0)


def _mk_audio():
    clock = _Clock()
    sched = _Sched(clock)
    mgr = FakeConnectionManager([FakeTagger(GUN, "FAKE-STAGE", team=1, clock=clock)])
    st = GunStage(mgr, None, sleep=sched.sleep, now=clock, voice_verdict_sink=lambda _r: None,
                  rng=random.Random(478))   # type: ignore[arg-type]   # the takes (spawn line, scream, grunt) fixed per run
    st.set_profile(gun="health")
    st.patch_presentation({"events": {"healed": {"sound": "VA7H"}, "armour_up": {"sound": "VA7I"}, "shield_up": {"sound": "VA7J"}}})
    return st, mgr, clock, sched


async def _live_quiet(st, clock, sched, clock_sleep: bool = True) -> None:
    """Live, armed, armour gone (a health game), and the gun audio model silent; then the holds go on the clock."""
    await st.connect(GUN)
    await st.arm()
    st.bundle["cues"]["countdown"] = ""
    await st.spawn(); await settle(st)
    st.poll(); await settle(st)
    st._arm_life("test"); await settle(st)
    st.poll(); await settle(st)                          # the divergence poll's answer, before the pools move
    clock.advance(1.0)
    _says(st, "$HP,45,0,0,*"); await settle(st)       # armour gone, health full: every hit below reaches health
    clock.advance(3.0)                                   # past the spawn line and klaxon (under 2 s together)
    st.poll(); await settle(st)                          # the spawn read-back goes out (2.5 s after the spawn)...
    clock.advance(0.1); st.mgr.pump(); st.poll(); await settle(st)   # ...and its answer lands before the test's frames
    if hasattr(st, "_gun_audio"):   # (lets this setup run on a stage from before F478, to show the tests fail there)
        assert st._gun_audio.outstanding(st._now_ms()) == 0, "setup: a silent gun"
    sched.on = clock_sleep


def _says(st, frame: str) -> None:
    """A pool frame put in the GUN's mouth: the fake gun's own pools are set to match first, so its later answers (a
    probe's `$HP`) report the same pools and read as no rise (test_stage_mirror.py `gun_says`)."""
    t = frame.split(",")
    if t[0] == "$HP":
        for fake in st.mgr.taggers.values():
            fake.hp, fake.armor, fake.shield = int(t[1]), int(t[2]), int(t[3])
    st._inject_rx(frame)


def _plays(mgr, n, frame):
    return tx(mgr)[n:].count(frame)


def test_f478_a_grunt_that_would_wait_past_pain_stale_behind_a_clip_is_dropped():
    """engine.js `_pain`: a grunt is stale PAIN_STALE_MS after its hit; one that would wait longer behind a clip the
    gun model still holds is dropped, not queued. CONTROL: with the gun quiet the same hit grunts."""
    async def run():
        st, mgr, clock, sched = _mk_audio()
        await _live_quiet(st, clock, sched, clock_sleep=False)
        grunts = set(st.bundle.get("cue_pools", {}).get("pain_short") or [st.bundle["cues"]["pain_short"]])
        await st.write([LONG], "a long clip on the gun", gap_ms=0)
        clock.advance(0.2)
        n = len(tx(mgr))
        st._inject_rx(HIT); _says(st, "$HP,40,0,0,*"); await settle(st)
        assert not grunts & set(tx(mgr)[n:]), "the clip has 1.8 s left: the grunt would start too late"
        assert any("dropped -- the gun is busy" in l["text"] for l in st.log)
        clock.advance(2.0)
        n = len(tx(mgr))
        st._inject_rx(HIT); _says(st, "$HP,35,0,0,*"); await settle(st)
        assert grunts & set(tx(mgr)[n:]), "CONTROL: a quiet gun takes the grunt"
    asyncio.run(run())


def test_f478_a_pool_line_waits_for_a_silent_gun_and_goes_stale_after_its_ttl():
    """announcer.js P1 and `ANNOUNCE_TTL_MS.status`: a pool voice line never goes to a gun that still holds a clip. It
    waits, and past 1.5 s in the queue it is dropped unsaid. CONTROL: a line queued 0.5 s before the clip ends plays
    on the first tick after it."""
    async def run():
        st, mgr, clock, sched = _mk_audio()
        await _live_quiet(st, clock, sched, clock_sleep=False)
        healed = st.bundle["cues"]["healed"]
        st._inject_rx(HIT); _says(st, "$HP,30,0,0,*"); await settle(st)
        clock.advance(1.0)
        await st.write([LONG], "a long clip on the gun", gap_ms=0)
        n = len(tx(mgr))
        _says(st, "$HP,35,0,0,*"); await settle(st)                      # +5 health: healed, queued behind the clip
        assert healed not in tx(mgr)[n:], "P1: the line waits for a silent gun"
        for _ in range(12):                                                    # 3 s of ticks: the clip ends at 1.98 s
            clock.advance(0.25); st.poll(); await settle(st)
        assert healed not in tx(mgr)[n:], "past its 1.5 s TTL the line was dropped, never said late"
        # CONTROL: queued 1.5 s into the clip (0.5 s left), it plays on the first tick after the clip ends
        await st.write([LONG], "a long clip on the gun", gap_ms=0)
        clock.advance(1.5)
        n = len(tx(mgr))
        _says(st, "$HP,40,0,0,*"); await settle(st)
        assert healed not in tx(mgr)[n:]
        for _ in range(4):
            clock.advance(0.25); st.poll(); await settle(st)
        assert _plays(mgr, n, healed) == 1, "the gun went quiet inside the TTL: the line plays"
    asyncio.run(run())


def test_f478_the_low_health_line_waits_for_a_quiet_gun():
    """engine.js `_hurtLineTry` (F375): after HURT_DEBOUNCE the line still waits until the gun model holds no clip, so
    it never queues behind a clip where a scream could overtake it. CONTROL: on a quiet gun it goes at the debounce."""
    async def run():
        for busy in (True, False):
            st, mgr, clock, sched = _mk_audio()
            await _live_quiet(st, clock, sched)
            hurt = st.bundle["cues"]["hurt"]
            if busy:
                sched.on = False
                await st.write([LONG], "a long clip on the gun", gap_ms=0)   # 1.98 s
                sched.on = True
            n = len(tx(mgr))
            st._inject_rx(HIT); _says(st, "$HP,12,0,0,*")                 # crosses under 15: the line is held
            await sched.advance(st, 0.6)
            if busy:
                assert hurt not in tx(mgr)[n:], "the debounce is over but the gun still plays a clip: the line waits"
                await sched.advance(st, 1.5)
                assert _plays(mgr, n, hurt) == 1, "the clip ended: the line goes"
            else:
                assert _plays(mgr, n, hurt) == 1, "CONTROL: a quiet gun takes the line at the debounce"
    asyncio.run(run())


def test_f478_the_low_health_line_is_dropped_past_the_max_wait_under_a_burst():
    """engine.js `_hurtLineTry`: every damaging `$HP` restarts the quiet time; past HURT_MAX_WAIT_MS from the crossing the
    line is dropped, never said late."""
    async def run():
        st, mgr, clock, sched = _mk_audio()
        await _live_quiet(st, clock, sched)
        hurt = st.bundle["cues"]["hurt"]
        n = len(tx(mgr))
        st._inject_rx(HIT); _says(st, "$HP,14,0,0,*")
        hp, steps = [14], [0]

        def burst():                                                            # a 1-damage hit every 250 ms
            steps[0] += 1
            if steps[0] % 5 == 0 and hp[0] > 2:
                hp[0] -= 1
                st._inject_rx(HIT); _says(st, f"$HP,{hp[0]},0,0,*")
        await sched.advance(st, 3.5, each=burst)
        assert hurt not in tx(mgr)[n:], "the burst never went quiet: the line is dropped"
        assert any("low-health line dropped" in l["text"] for l in st.log)
    asyncio.run(run())


def test_f478_a_heal_inside_the_hold_drops_the_line_and_the_pool_line_plays():
    """engine.js `_hurtLineTry`: a heal back to LOW_HEALTH_HP drops the held line, so the `healed` pool line finds a
    silent gun and plays at once (hp-low-health-heal and hp-low-health-shield pin this as harness timing)."""
    async def run():
        st, mgr, clock, sched = _mk_audio()
        await _live_quiet(st, clock, sched)
        hurt, healed = st.bundle["cues"]["hurt"], st.bundle["cues"]["healed"]
        n = len(tx(mgr))
        st._inject_rx(HIT); _says(st, "$HP,11,0,0,*")
        await sched.advance(st, 0.25)
        _says(st, "$HP,20,0,0,*")                                           # the heal, inside the hold
        await sched.advance(st, 3.0)
        assert hurt not in tx(mgr)[n:], "no longer critical: the line is dropped"
        assert _plays(mgr, n, healed) == 1, "and the pool line plays"
    asyncio.run(run())


def test_f478_a_match_end_inside_the_hold_drops_the_line():
    """engine.js `_endLocal` clears the held line (hp-low-health-end pins this as harness timing)."""
    async def run():
        st, mgr, clock, sched = _mk_audio()
        await _live_quiet(st, clock, sched)
        hurt = st.bundle["cues"]["hurt"]
        n = len(tx(mgr))
        st._inject_rx(HIT); _says(st, "$HP,11,0,0,*")
        await sched.advance(st, 0.2)
        end = asyncio.ensure_future(st.end())
        await sched.advance(st, 2.0)
        await end
        assert hurt not in tx(mgr)[n:], "the match ended inside the hold: no line"
    asyncio.run(run())


def test_f478_the_status_ttl_is_the_announcers():
    """`STATUS_TTL_MS` mirrors one field of announcer.js `ANNOUNCE_TTL_MS` (test_stage_constants.py cannot read an object)."""
    js = (pathlib.Path(__file__).resolve().parents[2] / "app" / "src" / "announcer.js").read_text(encoding="utf-8")
    body = js[js.index("export const ANNOUNCE_TTL_MS = {"):]
    body = body[:body.index("};")]
    assert re.search(r"\bstatus: (\d+),", body).group(1) == str(S.STATUS_TTL_MS)


# ---- F479: the revive burst on a late start ----------------------------------------------------------------------

def test_f479_a_late_start_rearms_the_table_straight_after_the_first_revive_burst():
    """engine.js `_spawn` (late, no `_preArmTable`) claims the live table when it queues the burst; the burst waits out
    the countdown cue's PLAY gap, and its send marks the table as not a take, so the first revive re-arms it: the
    `sir_pool` rows go out straight after the revive burst (its spawn line), before anything else. CONTROL: a start
    that pre-armed at T-3 has the table live, and the revive writes no `$SIR` row."""
    async def run(pre_arm):
        st, mgr, clock = _mk()
        await st.connect(GUN)
        await st.arm(); await st.spawn(pre_arm=pre_arm); await settle(st)
        st.poll(); await settle(st)
        if not pre_arm:
            spawn = next(e["why"] for e in st.log if e["kind"] == "tx" and e["text"] == "$SPAWN,,*")
            assert "hit table" in spawn and "(late)" in spawn, f"setup: the late table rides the spawn burst ({spawn})"
        st._inject_rx("$HIR,4,0,19,2,45,0,3,*"); _says(st, "$HP,0,0,0,*"); await settle(st)
        assert not st.alive
        clock.advance(8)
        n = len(tx(mgr))
        await st.revive(); await settle(st)
        w = tx(mgr)[n:]
        return w, st
    w, st = asyncio.run(run(False))
    w = [f for f in w if not f.startswith(("$GLED,", "$HLED,"))]   # gun-body and headset paints: timed on `_nosleep` here
    rows = [f for f in w if f.startswith("$SIR,")]
    assert rows, "the late start's claim was undone: the revive re-arms the table"
    line = max(i for i, f in enumerate(w) if f.startswith("$PLAY,"))
    assert w[line + 1:line + 1 + len(rows)] == rows, f"the rows follow the revive burst's spawn line directly: {w}"
    assert st._sir_live, "the revive's own take claims the table"
    w2, _ = asyncio.run(run(True))
    assert not [f for f in w2 if f.startswith("$SIR,")], "CONTROL: a pre-armed start re-arms nothing"
