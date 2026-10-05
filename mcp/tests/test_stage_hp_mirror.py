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


# ---- round 1 review (2026-10-05) --------------------------------------------------------------------------------

def test_r1_h1_with_auto_react_off_the_tick_books_no_death():
    """The bench's auto-react toggle off: `_on_pools` only stores the pools, and the stage books nothing on its own. The
    B5 re-examine in `poll()` must not book a death either."""
    async def run():
        st, _mgr, clock = _mk()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st.poll(); await settle(st)
        st._last_seq = st.mgr.get_events(st.alias, max_events=10**6)["events"][-1]["seq"]   # no later gun answer lands
        st._reacted_seq = st._last_seq
        clock.advance(10)
        st.auto_react = False
        st._inject_rx("$HP,0,0,0,*"); await settle(st)
        clock.advance(0.05); st.poll(); await settle(st)
        assert st.alive, "auto-react off: no death is booked"
        assert not any("☠ down" in str(e) for e in st.log)
    asyncio.run(run())


async def _grunt_then_death(gap_s: float):
    """A grunt (`pain_long`), then a lethal hit `gap_s` later; the holds run on the clock. Returns (st, mgr, clock,
    the tx index before the death, the scream's end in seconds)."""
    st, mgr, clock, sched = _mk_audio()
    await _live_quiet(st, clock, sched)
    st._inject_rx("$HIR,4,0,19,2,30,0,3,*"); _says(st, "$HP,15,0,0,*")
    await sched.advance(st, gap_s)
    n = len(tx(mgr))
    st._inject_rx("$HIR,4,0,19,2,106,0,3,*"); _says(st, "$HP,0,0,0,*")
    await _yield()
    assert not st.alive
    scream_end = st._scream_until_ms / 1000
    assert scream_end > clock.t, "setup: the gun screams"
    await sched.advance(st, 4.0)
    return st, mgr, clock, n, scream_end


def test_r1_h2_a_grunt_queued_behind_the_scream_gets_a_body_stop():
    """engine.js `_death` `bodyStop` (F439 r3): a grunt written within DEATH_LATE_WRITE_MS of the death reached the gun
    after the scream began, so it waits behind the scream; once the scream ends the phone stops it with one `$PLAYX`.
    CONTROL: a grunt already playing at the death is cut by the scream itself, so no stop is sent."""
    async def run(gap_s):
        st, mgr, clock, n, scream_end = await _grunt_then_death(gap_s)
        stops = [e for e in st.log if e["kind"] == "tx" and e["text"] == S.PLAYX and e["t"] >= scream_end - 1e-6]
        return stops, scream_end
    stops, scream_end = asyncio.run(run(0.25))
    assert len(stops) == 1, f"one body stop after the scream: {stops}"
    assert stops[0]["t"] >= scream_end + S.DEATH_BODY_STOP_MARGIN_MS / 1000 - 1e-6, "not before the scream's end plus the margin"
    stops, _ = asyncio.run(run(0.5))
    assert stops == [], "CONTROL: the grunt was playing, the scream cut it, nothing waits behind it"


def test_r1_h3_a_queue_slot_cue_that_waited_over_six_seconds_is_dropped():
    """engine.js `_drainPlayWrites` (F419 review): a queue-slot cue that waited longer than PLAY_QUEUE_STALE_MS for the
    gun is dropped, never sent late. CONTROL: one that waited 5 s goes."""
    async def run(busy_ms):
        st, mgr, clock, sched = _mk_audio()
        await _live_quiet(st, clock, sched)
        st._gun_audio.add(busy_ms, "a long clip the model holds", st._now_ms(), "X")
        cue = "$PLAY,,4,6,VA7H,,,,*"
        n = len(tx(mgr))
        task = asyncio.ensure_future(st.write([cue], "a queued cue", gap_ms=0))
        await sched.advance(st, busy_ms / 1000 + 0.5)
        await task
        return cue in tx(mgr)[n:], st
    sent, st = asyncio.run(run(7000))
    assert not sent and any("waited" in e["text"] and "stale" in e["text"] for e in st.log), "stale: dropped"
    sent, _ = asyncio.run(run(5000))
    assert sent, "CONTROL: inside PLAY_QUEUE_STALE_MS the cue goes"


def test_r1_h4_a_filler_is_dropped_when_any_play_write_is_queued_and_its_companions_still_go():
    """engine.js `_write`: a filler (VAG, VAE, N74, U100) is dropped when a play write is already queued or busy, or
    inside the PLAY gap, at CALL time. Only the filler `$PLAY` frame is dropped; the write's other frames go. CONTROL:
    an idle queue past the gap sends the filler."""
    async def run(busy):
        st, mgr, clock, sched = _mk_audio()
        await _live_quiet(st, clock, sched)
        st._gun_audio.add(1000, "a clip on the gun", st._now_ms(), "X")
        first = None
        if busy:   # a queue-slot cue waits for the gun: the play queue is occupied
            first = asyncio.ensure_future(st.write(["$PLAY,,4,6,VA7H,,,,*"], "a waiting cue", gap_ms=0))
            await _yield()
        else:
            clock.advance(1.2)
        n = len(tx(mgr))
        filler = asyncio.ensure_future(st.write(["$HLED,6,2,120,120,10,2,*", "$PLAY,,4,6,VAG,,,,*"], "a grunt", gap_ms=0))
        await sched.advance(st, 1.5)
        await filler
        if first:
            await first
        return tx(mgr)[n:]
    w = asyncio.run(run(True))
    assert "$PLAY,,4,6,VAG,,,,*" not in w and "$HLED,6,2,120,120,10,2,*" in w, w
    w = asyncio.run(run(False))
    assert "$PLAY,,4,6,VAG,,,,*" in w, f"CONTROL: {w}"


def test_r1_l3_the_pain_stale_boundary_is_whole_ms_and_inclusive():
    """engine.js `_pain`: `freeAt - now > PAIN_STALE_MS` drops; exactly 500 ms still grunts."""
    def run(left_ms):
        async def go():
            st, mgr, clock, sched = _mk_audio()
            await _live_quiet(st, clock, sched, clock_sleep=False)
            grunts = set(st.bundle.get("cue_pools", {}).get("pain_short") or [st.bundle["cues"]["pain_short"]])
            st._gun_audio.add(left_ms, "x", st._now_ms(), "X")
            n = len(tx(mgr))
            st._inject_rx(HIT); _says(st, "$HP,40,0,0,*"); await settle(st)
            return bool(grunts & set(tx(mgr)[n:]))
        return asyncio.run(go())
    assert [run(ms) for ms in (499, 500, 501)] == [True, True, False]


def test_r1_l3_stops_and_two_slot_frames_in_the_model():
    """announcer.js `GunAudio` via `_audio_write`: one `$PLAYX` drops the clip playing, two or more empty the FIFO; a
    two-slot `$PLAY` is two clips, the interrupt slot first (engine.js `playSlotFrames`)."""
    async def run():
        st, _mgr, clock, sched = _mk_audio()
        await _live_quiet(st, clock, sched, clock_sleep=False)
        g, now = st._gun_audio, st._now_ms()
        g.add(1000, "a", now, "A"); g.add(1000, "b", now, "B")
        st._audio_write([S.PLAYX], "one stop")
        assert [c["id"] for c in g.clips] == ["B"]
        g.add(1000, "c", now, "C")
        st._audio_write([S.PLAYX, S.PLAYX], "two stops")
        assert g.clips == []
        st._audio_write(["$PLAY,VA81,4,6,VAI,,,,*"], "two-slot")
        assert [c["id"] for c in g.clips] == ["VA81", "VAI"]
        assert g.clips[1]["start"] == g.clips[0]["end"], "the queue slot plays after the interrupt slot"
    asyncio.run(run())


def test_r1_l3_the_heartbeat_and_the_poison_tick_sound_wait_for_a_quiet_gun():
    """engine.js `_shieldLoopTick` (C3) and `_poisonStrike` (F393): neither sound starts while the gun model holds a
    clip. CONTROL: on a quiet gun both sound."""
    async def run(busy, what):   # each sound on its own stage: one written sound would itself hold the other
        st, mgr, clock, sched = _mk_audio()
        await _live_quiet(st, clock, sched, clock_sleep=False)
        if not st.bundle["cues"].get("poison_tick"):
            st.bundle["cues"]["poison_tick"] = "$PLAY,,4,6,H31,,,,*"   # the toxin profile's tick sound
        if busy:
            st._gun_audio.add(5000, "a clip on the gun", st._now_ms(), "X")
        k = len(st.log)
        if what == "beat":
            st._shield_loop_at = 0.0
            st._shield_loop_tick(st.now()); await settle(st)
            return any(e["kind"] == "tx" and e["text"] == st.bundle["cues"]["shield_loop"] for e in list(st.log)[k:])
        st._poison_strike({"per": 4, "by": {"num": 3, "team": 2}, "ticks": 0}, st.now()); await settle(st)
        return any(e["kind"] == "tx" and "poison_tick" in e["why"] for e in list(st.log)[k:])
    for what in ("beat", "tick"):
        assert not asyncio.run(run(True, what)), f"a clip on the gun: no {what} sound"
        assert asyncio.run(run(False, what)), f"CONTROL: a quiet gun: the {what} sounds"


def test_r1_the_filler_ids_are_the_engines():
    """`FILLER_IDS` mirrors engine.js `_write`'s local `fillerIds` set (test_stage_constants.py cannot read it)."""
    js = (pathlib.Path(__file__).resolve().parents[2] / "app" / "src" / "engine.js").read_text(encoding="utf-8")
    m = re.search(r"const fillerIds = new Set\(\[([^\]]*)\]\)", js)
    assert m and tuple(re.findall(r"'([^']+)'", m.group(1))) == S.FILLER_IDS
