"""The stage MIRRORS the phone -- F102 (the phone control point), F58(b) (the pool-rise events) and F54
(the reload glance), each ported from `app/src/engine.js` and each pinned here with a paired CONTROL:
the old behaviour would have failed, or the neighbouring path is unchanged.

The stage's only purpose is to PREDICT the phone (2026-09-07: seven of nine defects in one night were a
stage/phone divergence the operator had signed off on). ⚠ UNITS: engine.js is on `Date.now()` (ms), the
stage on `time.monotonic` (SECONDS); every test below drives `self.now` by hand through `_Clock`.
"""
from __future__ import annotations

import asyncio
import time

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage import stage as S
from brx_mcp.stage.stage import GunStage, decode_advert_uuid, encode_advert_uuid
from test_stage import (CAPTURED, LOST, TICK, PLAYX, NEUTRAL_TO_BLUE, BLUE_TO_RED, _Clock, _nosleep, feed, hill_audio,
                        in_play, install_levels_readout, mark, mk_hill, run_clock, settle, since, tx)

CONTESTED = S.HILL_CUES["hill_contested"]["frame"]     # VB0O "Hill Contested"
GUN = "FA:KE:00:00:00:01"


def mk_point(tid: int = 1, source: str | None = "phone", **profile):
    """A stage whose game names a PHONE as the objective source (the F70 gate lets the station path through)."""
    st, mgr, clock = mk_hill(tid=tid, **profile)
    st.set_profile(station_source=source)
    return st, mgr, clock


def audio(mgr, n) -> list[str]:
    return [f for f in since(mgr, n) if f in (CAPTURED, LOST, TICK, PLAYX, CONTESTED)]


async def ticks(st, clock, seconds: float, step: float = 0.1) -> list[float]:
    """Like `run_clock` but at a finer step, so a 0.5 s losing cadence is resolvable too."""
    return await run_clock(st, clock, seconds, step=step)


def gaps(times: list[float]) -> list[float]:
    return [round(b - a, 3) for a, b in zip(times, times[1:])]


async def adv(st, **kw):
    """One scanner callback: inject the advert, then let the callout it may have spawned reach the tx stream
    (the hill lines are written by a task, exactly as on the IR path -- `feed` settles the same way)."""
    st.station_advert(**kw)
    await settle(st)


async def stop(st, id=None):
    st.station_stop(id=id)
    await settle(st)


# ======================================================================================================
# F102 -- the phone CONTROL POINT (kind 5), mirrored from engine.js `_onControlAdvert` / `_hillTick`
# ======================================================================================================

def test_the_advert_is_decoded_through_the_phones_byte_layout_not_a_side_door():
    """The stage feeds an injected advert through beacon.js's 16-byte layout: team is byte 9, FLAGS byte 10,
    progress byte 11. A literal UUID lands in the same model as the fields do; anything that is not an Open
    BRX advert, or not a control point, is refused rather than guessed at."""
    u = encode_advert_uuid("station", 7, "control", 1, S.CONTROL_STATE["held"] | S.CONTROL_STATE["rising"], 42)
    d = decode_advert_uuid(u)
    assert d == {"role": "station", "id": 7, "kind": "control", "team": 1, "state": 5, "value": 42, "seq": 0, "game": 0, "threshold": 0}
    raw = u.replace("-", "")
    assert raw[18:20] == "01" and raw[20:22] == "05" and raw[22:24] == "2a", "team / flags / value at bytes 9 / 10 / 11"
    # CONTROL: a flipped magic byte is not ours; a respawn-kind advert is not a control point
    assert decode_advert_uuid("00" + raw[2:]) is None
    st, _, _ = mk_point()
    try:
        st.station_advert(uuid=encode_advert_uuid("station", 1, "respawn", 255, 1, 0))
        assert False, "a respawn advert must be refused by the control-point injector"
    except ValueError as e:
        assert "kind 5" in str(e)
    try:
        st.station_advert(uuid="not-an-advert")
        assert False
    except ValueError:
        pass
    # the literal-UUID route and the fields route write the SAME hill
    st.station_advert(uuid=u, present=True)
    a = dict(st.hill)
    st2, _, _ = mk_point()
    st2.station_advert(id=7, team=1, held=True, rising=True, value=42, present=True)
    b = dict(st2.hill)
    a.pop("at"); b.pop("at")
    assert a == b == {"owner": 1, "from_neutral": False, "source": "station", "site": 7, "progress": 42, "holding": 1,
                      "contested": False, "rising": True, "falling": False, "on_point": True}


def test_a_phone_point_capture_is_announced_and_ticks_on_our_clock_and_the_source_gate_mirrors_the_phone():
    """A first advert is adopted SILENTLY (a point we were not reading tells us nothing about a change of
    hands); the flip to us says "Hill Captured" once; then the possession tick runs off OUR 1 s clock. The
    hill it writes carries `source: 'station'`, which is what `_hill_tick` keys the 4 s window on.

    CONTROL: the same adverts on a game whose `station_source` is `grenade` write NO hill and play nothing
    (engine.js `_hillSourceAllowed`: `station` only when the source is `phone`), and the refusal is logged
    once; a game with NO source at all (a try-out, the stage's tdm) lets either wire through."""
    async def go():
        st, mgr, clock = mk_point(tid=1)
        await in_play(st)
        n = mark(mgr)
        await adv(st, id=1, team=None, value=0, present=True)          # neutral, adopted silently
        assert audio(mgr, n) == [] and st.hill["owner"] == S.HILL_NEUTRAL_TEAM and st.hill["source"] == "station"
        await adv(st, id=1, team=1, held=True, value=100, present=True)
        assert audio(mgr, n) == [CAPTURED], audio(mgr, n)
        assert st.hill["owner"] == 1 and st.hill["from_neutral"] is True and st.hill["site"] == 1
        n = mark(mgr)
        times = await ticks(st, clock, 3.2)
        assert len(times) >= 2 and all(abs(g - S.HILL_TICK_S) < 0.11 for g in gaps(times)), (times, gaps(times))
        assert audio(mgr, n) and set(audio(mgr, n)) == {TICK}, "only the tick after the callout finished"

        # CONTROL 1: the grenade-sourced game ignores the phone point outright
        g, gm, gclock = mk_point(tid=1, source="grenade")
        await in_play(g)
        n = mark(gm)
        await adv(g, id=1, team=None, value=0, present=True)
        await adv(g, id=1, team=1, held=True, value=100, present=True)
        await ticks(g, gclock, 2.0)
        assert g.hill is None and audio(gm, n) == [], "a grenade game must not hear a phone point"
        assert sum("ignoring the phone control point" in l["text"] for l in g.log) == 1, "logged once, not per advert"
        # ...and the same gate the other way: a phone game ignores the grenade's IR beacon
        n = mark(mgr)
        await feed(st, mgr, clock, NEUTRAL_TO_BLUE[:2])
        assert st.hill["source"] == "station" and CAPTURED not in audio(mgr, n)[1:], "the IR capture word must not re-announce on a phone game"
        assert any("ignoring the grenade hill beacon" in l["text"] for l in st.log)
        # CONTROL 2: no source at all = what we hear is it
        t, tm, _ = mk_point(tid=1, source=None)
        assert "station_source" not in t.config
        await in_play(t)
        n = mark(tm)
        await adv(t, id=1, team=None, value=0, present=True)
        await adv(t, id=1, team=1, held=True, value=100, present=True)
        assert audio(tm, n) == [CAPTURED]
    asyncio.run(go())


def test_the_station_window_is_4s_and_the_grenade_window_is_12s_on_purpose():
    """engine.js `_hillTick` takes its window from `hill.source`: a BLE station advertises continuously, so
    its point goes stale on the §3 presence rule (4 s); a grenade beacons once per ~5 s, so its presence is
    two missed beacons (12 s). Expiry is SILENT on both -- nobody took the point from us."""
    async def go():
        st, mgr, clock = mk_point(tid=1)
        await in_play(st)
        await adv(st, id=1, team=None, value=0, present=True)
        await adv(st, id=1, team=1, held=True, value=100, present=True)
        await stop(st)
        n = mark(mgr)
        # ⚠ The phone's timeline is TWO halves of CONTROL_STALE_S, not one (engine.js's own comment on
        # CONTROL_STALE_MS): app.js hands the engine the Presence snapshot on a TIMER, so `_onControlAdvert`
        # keeps refreshing `hill.at` for as long as the stale entry is still under 4 s old, and only then
        # does `_hillTick` start its own 4 s. A stage that expired at 4 s flat would go quiet four seconds
        # before the player's phone does -- the operator would sign off on a silence players do not get.
        await ticks(st, clock, S.CONTROL_STALE_S + 0.2)
        assert st.hill is not None and st.hill["source"] == "station", "still read off the (<= 4 s old) presence entry"
        await ticks(st, clock, S.CONTROL_STALE_S - 0.4)
        assert st.hill is not None, "just under 2x the window: still fresh"
        await ticks(st, clock, 0.4)
        assert st.hill is None, "a station point expires CONTROL_STALE_S after the entry stopped being read"
        assert LOST not in audio(mgr, n) and any("hill presence expired" in l["text"] for l in st.log)
        assert st.stations == {}, "the presence entry is dropped after 2x the window, like the phone's Presence"
        assert TICK in audio(mgr, n), "we kept ticking (we still held it) right up to the expiry"

        # CONTROL: the grenade point on the SAME stage class outlives 4 s and expires at 12 s
        g, gm, gclock = mk_point(tid=1, source="grenade")
        await in_play(g)
        await feed(g, gm, gclock, NEUTRAL_TO_BLUE[:2])
        n = mark(gm)
        await run_clock(g, gclock, S.CONTROL_STALE_S + 1.0)
        assert g.hill is not None and g.hill.get("source") is None, "a grenade point is still fresh at 5 s"
        await run_clock(g, gclock, S.HILL_PRESENCE_S - S.CONTROL_STALE_S)
        assert g.hill is None and LOST not in audio(gm, n)
    asyncio.run(go())


def test_hill_contested_is_wired_on_the_station_path_with_a_10s_floor_and_never_on_the_ir_path():
    """The station COUNTS living bodies of each team in its bubble, so contested is a measurement and VB0O
    plays -- on the rising edge only, floored at HILL_CONTESTED_MIN_S, and only to players the fight belongs to
    (on the point, or the owning team). F75 keeps it off the IR path: a non-capturing IR hit emits nothing."""
    async def go():
        st, mgr, clock = mk_point(tid=1)
        await in_play(st)
        await adv(st, id=1, team=None, value=0, present=True)
        await adv(st, id=1, team=1, held=True, value=100, present=True)
        await ticks(st, clock, S.HILL_CUES["hill_captured"]["s"] + 0.1)     # let "Captured" finish
        n = mark(mgr)
        await adv(st, id=1, team=1, held=True, contested=True, falling=True, value=90, present=True)
        assert audio(mgr, n) == [CONTESTED], audio(mgr, n)
        # a flapping bit inside the floor does not repeat the line
        await adv(st, id=1, team=1, held=True, value=85, present=True)
        await adv(st, id=1, team=1, held=True, contested=True, falling=True, value=80, present=True)
        assert audio(mgr, n).count(CONTESTED) == 1, "a repeat inside HILL_CONTESTED_MIN_S is dropped"
        clock.advance(S.HILL_CONTESTED_MIN_S)
        await adv(st, id=1, team=1, held=True, value=75, present=True)
        await adv(st, id=1, team=1, held=True, contested=True, falling=True, value=70, present=True)
        assert audio(mgr, n).count(CONTESTED) == 2, "past the floor, the next rising edge speaks again"
        # CONTROL 1: a bystander (not on the point, not the owner) is not told
        b, bm, bclock = mk_point(tid=0)
        await in_play(b)
        await adv(b, id=1, team=None, value=0, present=False)
        await adv(b, id=1, team=1, held=True, value=100, present=False)
        n = mark(bm)
        await adv(b, id=1, team=1, held=True, contested=True, value=90, present=False)
        assert audio(bm, n) == [], "team 0, in range but off an enemy point: not their fight"
        # CONTROL 2: a capture in the SAME advert wins outright over contested (it would preempt it)
        c, cm, cclock = mk_point(tid=1)
        await in_play(c)
        await adv(c, id=1, team=None, value=0, present=True)
        n = mark(cm)
        await adv(c, id=1, team=1, held=True, contested=True, value=100, present=True)
        assert audio(cm, n) == [CAPTURED], audio(cm, n)
        # CONTROL 3: the IR path -- both real captured streams, no VB0O anywhere
        g, gm, gclock = mk_point(tid=1, source="grenade")
        await in_play(g)
        n = mark(gm)
        await feed(g, gm, gclock, NEUTRAL_TO_BLUE + BLUE_TO_RED)
        assert CONTESTED not in audio(gm, n) and CAPTURED in audio(gm, n) and LOST in audio(gm, n)
    asyncio.run(go())


def test_rising_and_falling_together_read_as_direction_unknown_and_falling_alone_doubles_the_tick():
    """Byte 10 is FLAGS, not a packed phase: `rising|falling` CAN both be set (an unauthenticated advert can
    say it) and reads as direction UNKNOWN, never as either -- so it does NOT double the tick. `falling`
    alone (our point draining) halves the tick period to HILL_TICK_LOSING_S: the one audible warning before
    "Hill Lost!"."""
    async def go():
        st, mgr, clock = mk_point(tid=1)
        await in_play(st)
        await adv(st, id=1, team=None, value=0, present=True)
        await adv(st, id=1, team=1, held=True, value=100, present=True)
        await ticks(st, clock, S.HILL_CUES["hill_captured"]["s"] + 0.1)
        both = S.CONTROL_STATE["held"] | S.CONTROL_STATE["rising"] | S.CONTROL_STATE["falling"]
        await adv(st, id=1, team=1, flags=both, value=60, present=True)
        assert st.hill["rising"] is False and st.hill["falling"] is False, "both bits = unknown, not either"
        times = await ticks(st, clock, 3.0)
        assert all(abs(g - S.HILL_TICK_S) < 0.11 for g in gaps(times)), gaps(times)
        await adv(st, id=1, team=1, held=True, falling=True, value=50, present=True)
        assert st.hill["falling"] is True
        times = await ticks(st, clock, 3.0)
        assert len(times) >= 4 and all(abs(g - S.HILL_TICK_LOSING_S) < 0.11 for g in gaps(times)), gaps(times)
        # CONTROL: held + rising (our point being reinforced) is the ordinary cadence
        await adv(st, id=1, team=1, held=True, rising=True, value=70, present=True)
        times = await ticks(st, clock, 3.0)
        assert all(abs(g - S.HILL_TICK_S) < 0.11 for g in gaps(times)), gaps(times)
    asyncio.run(go())


def test_lost_lands_on_the_drain_to_neutral_captured_on_the_rebuild_and_the_3s_floor_bounds_a_flap():
    """Ownership changes only THROUGH neutral on a station: the drain to 0 is "Hill Lost!" for the robbed
    team at the moment they stop holding it, a stranger's build is silent, and our rebuild to 100 is "Hill
    Captured". HILL_CALLOUT_MIN_S floors the transition lines (two phones on one station id flap the owner
    several times a second); the later word still wins by preempting once past the floor."""
    async def go():
        st, mgr, clock = mk_point(tid=1)
        await in_play(st)
        await adv(st, id=1, team=None, value=0, present=True)
        await adv(st, id=1, team=1, held=True, value=100, present=True)
        clock.advance(S.HILL_CALLOUT_MIN_S)
        n = mark(mgr)
        await adv(st, id=1, team=None, value=0, present=True)             # drained: we LOST it
        assert audio(mgr, n) == [LOST], audio(mgr, n)
        clock.advance(S.HILL_CALLOUT_MIN_S)
        n = mark(mgr)
        await adv(st, id=1, team=0, value=40, present=True)               # red building it: still nobody's
        await adv(st, id=1, team=0, held=True, value=100, present=True)   # red holds it: not our event
        assert audio(mgr, n) == [] and st.hill["owner"] == 0
        await adv(st, id=1, team=None, value=0, present=True)             # red drained: still not ours
        assert audio(mgr, n) == []
        await adv(st, id=1, team=1, held=True, value=100, present=True)
        assert audio(mgr, n) == [CAPTURED]
        # the floor: a flap right after a line is swallowed, and past the floor the next word preempts
        n = mark(mgr)
        clock.advance(0.5)
        await adv(st, id=1, team=None, value=0, present=True)
        assert audio(mgr, n) == [], "a transition inside HILL_CALLOUT_MIN_S of the last line is dropped"
        clock.advance(S.HILL_CALLOUT_MIN_S)
        await adv(st, id=1, team=1, held=True, value=100, present=True)
        assert audio(mgr, n) == [CAPTURED], "the owner as last announced was us, so a re-take is not a change... unless the model says so"
    asyncio.run(go())


def test_a_transition_while_down_is_owed_and_said_once_on_revive():
    """C (engine.js): a change of hands that lands while we are DOWN is remembered, not swallowed -- the
    first advert after revive says the ONE line for the NET change across the death window. CONTROL: no
    change while down means nothing is said on revive."""
    async def go():
        st, mgr, clock = mk_point(tid=1)
        await in_play(st)
        await adv(st, id=1, team=None, value=0, present=True)
        await adv(st, id=1, team=1, held=True, value=100, present=True)
        clock.advance(S.HILL_CALLOUT_MIN_S)
        st.alive = False                                                       # down: audio off
        n = mark(mgr)
        await adv(st, id=1, team=None, value=0, present=True)
        await adv(st, id=1, team=0, held=True, value=100, present=True)
        assert audio(mgr, n) == [], "silent while down"
        st.alive = True
        await adv(st, id=1, team=0, held=True, value=100, present=True)    # first advert back on our feet
        assert audio(mgr, n) == [LOST], audio(mgr, n)
        assert any("changed hands while we were down" in l.get("why", "") for l in st.log), "the write's reason names the owed change"
        await adv(st, id=1, team=0, held=True, value=100, present=True)
        assert audio(mgr, n) == [LOST], "said once"
        # CONTROL: down and back with the owner unchanged says nothing
        c, cm, cclock = mk_point(tid=1)
        await in_play(c)
        await adv(c, id=1, team=None, value=0, present=True)
        await adv(c, id=1, team=1, held=True, value=100, present=True)
        cclock.advance(S.HILL_CALLOUT_MIN_S)
        c.alive = False
        n = mark(cm)
        await adv(c, id=1, team=1, held=True, value=100, present=True)
        c.alive = True
        await adv(c, id=1, team=1, held=True, value=100, present=True)
        assert audio(cm, n) == []
    asyncio.run(go())


def test_a_different_site_is_adopted_silently_and_the_latch_holds_the_point_being_read():
    """A: two points are two objectives. The reader LATCHES to the point it is on; a second point in range is
    not read while the first is present, and once the first is gone the second is adopted silently -- walking
    from our own point toward an enemy's must never say "Hill Lost!" for a point nobody took."""
    async def go():
        st, mgr, clock = mk_point(tid=1)
        await in_play(st)
        await adv(st, id=1, team=None, value=0, present=True)
        await adv(st, id=1, team=1, held=True, value=100, present=True)
        clock.advance(S.HILL_CALLOUT_MIN_S)
        n = mark(mgr)
        await adv(st, id=2, team=0, held=True, value=100, present=False, rssi=-40)   # stronger, enemy-held, not on it
        assert st.hill["site"] == 1 and st.hill["owner"] == 1 and audio(mgr, n) == [], "latched to the point we stand on"
        await stop(st, id=1)
        await ticks(st, clock, S.CONTROL_STALE_S + 0.3)
        assert st.hill is not None and st.hill["site"] == 2 and st.hill["owner"] == 0, "point 2 is read once point 1 is gone"
        assert LOST not in audio(mgr, n), "a different site is adopted silently"
        assert any("different point" in l["text"] for l in st.log)
        # CONTROL: a SAME-site change of hands still speaks
        clock.advance(S.HILL_CALLOUT_MIN_S)
        n = mark(mgr)
        await adv(st, id=2, team=None, value=0, present=True)
        await adv(st, id=2, team=1, held=True, value=100, present=True)
        assert audio(mgr, n) == [CAPTURED]
    asyncio.run(go())


def test_a_new_match_forgets_the_point_and_a_tid_2_listener_is_silent_on_the_station_path_too():
    """engine.js `_resetHill` on a new match (ARM here): game 2 must not inherit game 1's point or its
    once-per-game warnings. And F82 on this path: a NEUTRAL point maps to team 2, so a tid-2 roster cannot
    decide ownership and hears nothing."""
    async def go():
        st, mgr, clock = mk_point(tid=1)
        await in_play(st)
        await adv(st, id=1, team=None, value=0, present=True)
        await adv(st, id=1, team=1, held=True, value=100, present=True)
        assert st.hill and st._control_site == 1
        await st.arm()
        assert st.hill is None and st._control_site is None and st.stations, "the point is forgotten, the operator's adverts are not"
        # F82
        y, ym, yclock = mk_point(tid=2)
        await in_play(y)
        n = mark(ym)
        await adv(y, id=1, team=None, value=0, present=True)
        await adv(y, id=1, team=2, held=True, value=100, present=True)    # "held" by 2 = nobody (2 is the neutral sentinel)
        assert y.hill["owner"] == S.HILL_NEUTRAL_TEAM and audio(ym, n) == []
        await ticks(y, yclock, 2.0)
        assert audio(ym, n) == [] and any("F82" in l["text"] for l in y.log)
    asyncio.run(go())


# ======================================================================================================
# F58(b) -- the pool-RISE events, mirrored from engine.js `_onHp`'s HUD-moments block
# ======================================================================================================

def mk_gain(**profile):
    """A health-body stage on a driveable clock, with a SOUND on each rise event so the tx stream shows it."""
    mgr = FakeConnectionManager([FakeTagger(GUN, "FAKE-STAGE", team=1)])
    clock = _Clock()
    st = GunStage(mgr, None, sleep=_nosleep, now=clock, voice_verdict_sink=lambda _r: None)
    st.set_profile(gun="health", **profile)
    st.patch_presentation({"events": {"healed": {"sound": "VA7H"}, "armour_up": {"sound": "VA7I"}, "shield_up": {"sound": "VA7J"}}})
    return st, mgr, clock


def rise_cues(st) -> dict[str, str]:
    c = st.bundle["cues"]
    return {"healed": c["healed"], "armour_up": c["armour_up"], "shield_up": c["shield_up"]}


async def live(st):
    await st.connect(GUN)
    await st.arm()
    st.bundle["cues"]["countdown"] = ""
    await st.spawn()
    await settle(st)
    st.poll()
    await settle(st)


def test_a_pool_rise_fires_healed_armour_up_or_shield_up_by_the_biggest_gain_like_the_phone():
    """CONTROL: before this the stage fired none of them (zero occurrences of `healed` in stage.py), so the
    bench could not exercise the heal path at all. The event named is the BIGGEST rise; the readout
    repaints for the innermost pool that moved (health first) exactly as a drop does."""
    async def go():
        st, mgr, clock = mk_gain()
        await live(st)
        cues = rise_cues(st)
        assert len(set(cues.values())) == 3, cues
        # the gun's own reports, fed through the real rx path (`_on_rx`), one pool at a time
        clock.advance(1.0)
        n = mark(mgr)
        st._on_rx("$HP,45,70,0,*"); await settle(st)                 # what we already hold: no rise, nothing fires
        assert not any(c in since(mgr, n) for c in cues.values())
        clock.advance(1.0)
        n = mark(mgr)
        st._on_rx("$HP,45,70,20,*"); await settle(st)                # a shield grant: shield_up
        assert since(mgr, n).count(cues["shield_up"]) == 1 and any("pool rise: shield_up (shield +20)" in l["text"] for l in st.log)
        clock.advance(1.0)
        n = mark(mgr)
        st._on_rx("$HP,45,45,20,*"); await settle(st)                # a 25 armour hit: the hit path, no rise
        assert not any(c in since(mgr, n) for c in cues.values()) and st.armor == 45
        clock.advance(1.0)
        n = mark(mgr)
        st._on_rx("$HP,45,70,20,*"); await settle(st)                # armour back to 70 (+25): armour_up
        assert since(mgr, n).count(cues["armour_up"]) == 1 and cues["healed"] not in since(mgr, n)
        assert any("pool rise: armour_up (armor +25)" in l["text"] for l in st.log)
        # take health damage, then heal: healed
        clock.advance(1.0)
        st._on_rx("$HP,20,0,0,*"); await settle(st)                  # a big hit through to health
        assert st.hp == 20 and st.armor == 0
        clock.advance(1.0)
        n = mark(mgr)
        st._on_rx("$HP,40,0,0,*"); await settle(st)                  # +20 health: healed
        assert cues["healed"] in since(mgr, n) and cues["armour_up"] not in since(mgr, n)
        # the biggest rise names the event: health +5 and armour +70 in one frame is armour_up
        clock.advance(1.0)
        n = mark(mgr)
        st._on_rx("$HP,45,70,0,*"); await settle(st)
        assert cues["armour_up"] in since(mgr, n) and cues["healed"] not in since(mgr, n)
        assert any("pool rise: armour_up (armor +70)" in l["text"] for l in st.log)
        # ...and the readout repainted for the INNERMOST pool that moved (health first), gain or drop alike
        assert st._readout_last_pool == "health"
    asyncio.run(go())


def test_a_frame_that_damages_and_grants_in_one_tick_is_a_hit_when_the_total_fell_and_the_gain_is_dropped():
    """F14: engine.js tests `dmg > 0` (the TOTAL went down) before it looks for gains, so a frame that costs
    30 armour and grants 10 shield is a hit with no gain event; a frame that costs 10 and grants 30 is a gain
    (the total rose) and the hit path is skipped. CONTROL: the plain gain still fires."""
    async def go():
        st, mgr, clock = mk_gain()
        await live(st)
        cues = rise_cues(st)
        clock.advance(1.0)
        st._on_rx("$HP,45,70,0,*"); await settle(st)                 # sync the model (no change vs the model: nothing fires)
        clock.advance(1.0)
        n = mark(mgr)
        st._on_rx("$HP,45,40,10,*"); await settle(st)                # -30 armour, +10 shield: net loss = HIT
        assert cues["shield_up"] not in since(mgr, n), "the HIT wins: no gain event"
        assert any("the HIT wins" in l["text"] for l in st.log) and st.armor == 40 and st.shield == 10
        clock.advance(1.0)
        n = mark(mgr); k = len(st.log)
        st._on_rx("$HP,45,30,40,*"); await settle(st)                # -10 armour, +30 shield: net rise = GAIN
        assert since(mgr, n).count(cues["shield_up"]) == 1 and any("pool rise: shield_up (shield +30)" in l["text"] for l in st.log)
        assert not any("hit_taken" in l["text"] or "pain" in l["text"] for l in list(st.log)[k:]), "a net rise is not a hit"
    asyncio.run(go())


def test_a_rise_inside_the_rare_moment_guard_is_dropped_and_after_it_fires():
    """engine.js keeps ONE HUD moment slot: a gain landing within RARE_GUARD_MS of a kill / redeploy / down /
    match_over moment is dropped (the rarer moment survives to be rendered). Mirrored so the bench does not
    play a heal line the phone stays silent on. CONTROL: past the guard the same frame fires."""
    async def go():
        st, mgr, clock = mk_gain()
        await live(st)
        cues = rise_cues(st)
        clock.advance(1.0)
        st._on_rx("$HP,45,70,0,*"); await settle(st)
        st.kill()                                                    # the kill moment, now
        n = mark(mgr)
        st._on_rx("$HP,45,70,20,*"); await settle(st)
        assert cues["shield_up"] not in since(mgr, n) and any("dropped -- inside" in l["text"] and "kill moment" in l["text"] for l in st.log)
        clock.advance(S.RARE_GUARD_S + 0.01)
        n = mark(mgr)
        st._on_rx("$HP,45,70,40,*"); await settle(st)
        assert cues["shield_up"] in since(mgr, n)
        # the same guard after a revive (the redeploy moment)
        await st.ir("kill"); st.poll(); await settle(st)
        assert not st.alive
        clock.advance(2.0)
        await st.revive(); await settle(st)
        n = mark(mgr)
        st._on_rx("$HP,45,70,70,*"); await settle(st)                # the shield blip lands inside the redeploy guard
        assert cues["shield_up"] not in since(mgr, n)
    asyncio.run(go())


# ======================================================================================================
# F54 -- the reload glance, mirrored from engine.js `_reloadPulled` / `_gunReadoutReloadGlance`
# ======================================================================================================

def mk_reload():
    mgr = FakeConnectionManager([FakeTagger(GUN, "FAKE-STAGE", team=1)])
    clock = _Clock()
    st = GunStage(mgr, None, sleep=_nosleep, now=clock, voice_verdict_sink=lambda _r: None)
    return st, mgr, clock


def test_the_compiled_readout_carries_the_glance_length_2s_day_1s_night():
    """A16 §3.1: `reload_glance_s` rides the bundle (2 s day, 1 s night); the stage reads it, never a literal."""
    st, _, _ = mk_reload()
    assert st.bundle["gun"]["readout"]["reload_glance_s"] == 2
    st.set_profile(night=True)
    assert st.bundle["gun"]["readout"]["reload_glance_s"] == 1
    assert st.state()["readout"]["timings"]["reload_glance_s"] == 1


def test_the_reload_glance_repaints_the_last_moved_pool_solid_for_reload_glance_s_even_after_the_hold_reverted():
    """The handle pull ($BUT,2,1) glances whichever pool most recently MOVED this life, at its CURRENT level,
    SOLID (no lead, no blink, no animation), for `reload_glance_s` -- then rest. It works after the ordinary
    hold has already reverted to rest, which is why `_readout_last_pool` must survive that revert.

    CONTROL 1: with no reserve known (no `$ALCD` yet -- the gun only reports ammo on a shot) the pull is
    ignored, on the phone too. CONTROL 2: before this lane the stage had no reload path at all."""
    async def go():
        st, mgr, clock = mk_reload()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        readout = install_levels_readout(st, hold_s=0.3, lead_ms=1, blink_gap_ms=1, step_ms=1, blink_ms=1)
        readout["reload_glance_s"] = 0.7
        assert st._gun_taken
        st._level_state["health"] = 6
        st.hp = 4                                                    # max 6 -> level 4 (whole: no blink)
        st._readout_paint("health"); await settle(st)
        assert tx(mgr)[-1] == "REST" and st._readout_last_pool == "health", "the hold ran and reverted; the pool is remembered"
        sleeps: list[float] = []
        real_sleep = st.sleep
        async def recording(s):
            sleeps.append(s); await real_sleep(s)
        st.sleep = recording
        # CONTROL 1: reserve unknown -> ignored
        n = mark(mgr)
        st.reload(); await settle(st)
        assert since(mgr, n) == [] and st.reloading is None and any("no reserve known" in l["text"] for l in st.log)
        st.alcd(mag=10, reserve=20); await settle(st)
        assert st.reserve == 20 and st.ammo == 10
        n = mark(mgr)
        st.reload(); await settle(st)
        assert since(mgr, n) == ["L4", "REST"], since(mgr, n)      # SOLID, once, then rest -- no L0 blink, no steps
        # F123: the pull now also arms the reload WATCHDOG, whose one sleep is the takeover deadline
        # -- so the glance is the FIRST sleep, and hold_s (0.3) is nowhere. The deadline is the ACTIVE
        # weapon's own reload (the stage's slot 0 is the AR: 1.4 s) plus max(0.6, 0.5 x 1.4) = 2.1 s;
        # it was 2.25 while the stage hardcoded 1.5 s for every gun (polish review 2026-09-12).
        assert sleeps[0] == 0.7 and 0.3 not in sleeps, f"the glance holds for reload_glance_s, not hold_s: slept {sleeps}"
        assert [round(x, 3) for x in sleeps[1:]] == [2.1], f"the watchdog sleeps once, to the deadline, and never spins: {sleeps}"
        assert st.reloading and st.reloading["slot"] == 0
        # the glance shows the CURRENT level even if the pool changed since the last paint
        st.hp = 2
        n = mark(mgr)
        st.reload(); await settle(st)
        assert since(mgr, n) == ["L2", "REST"], since(mgr, n)
        # F123: the mag coming back on that slot ends the reload only when it reaches the CAP (engine.js
        # `_onAmmo`: a rise FEEDS the takeover -- a shell-by-shell chain must not clear on shell #1). Short of
        # the cap it keeps waiting; at the cap it books a filled outcome.
        cap = st.reloading["cap"]
        assert cap is not None and cap > 11, f"the test needs a known spawn cap above the partial mag: {cap}"
        st.alcd(mag=11, reserve=0, slot=0)
        assert st.reloading is not None and st.reloading["mag"] == 11, "a partial refill keeps the takeover open"
        st.alcd(mag=cap, reserve=0, slot=0)
        assert st.reloading is None and st.reload_outcome and st.reload_outcome["ok"] and st.reload_outcome["filled"], st.reload_outcome
    asyncio.run(go())


def test_the_glance_cancels_an_animation_in_flight_and_a_later_drop_cancels_the_glances_revert():
    """A glance is a peek, not an animation: it cancels a drop/gain/blink in flight (engine.js bumps `_roGen`).
    And the other way round: a drop landing during the glance owns the strip -- the glance's pending revert
    must not write REST under the new animation (engine.js's hold poll defers to `_roAnimating`)."""
    async def go():
        st, mgr, clock = mk_reload()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        readout = install_levels_readout(st, hold_s=0.3, lead_ms=1, blink_gap_ms=1, step_ms=1, blink_ms=1)
        readout["reload_glance_s"] = 0.7
        st.alcd(mag=10, reserve=20)
        st._level_state["health"] = 6
        st.hp = 3
        st._readout_paint("health")                                  # a drop 6 -> 3, scheduled but not yet run
        st.reload()                                                  # the glance lands first
        await settle(st)
        new = tx(mgr)[tx(mgr).index("L3"):]
        assert new == ["L3", "REST"], f"the glance cancelled the drop outright: {new}"
        # now a drop DURING a glance: use a sleep that yields so the glance's revert is still pending
        pend: list = []
        async def yielding(s):
            pend.append(s); await asyncio.sleep(0)
        st.sleep = yielding
        st.hp = 5
        st._level_state["health"] = 5; st._level_current = None
        n = mark(mgr)
        st.reload()
        st.hp = 2
        st._readout_paint("health")                                  # a drop 5 -> 2 while the glance is up
        await settle(st)
        new = since(mgr, n)
        assert new[0] == "L5" and "L2" in new and new[-1] == "REST", new
        assert new.index("REST") > new.index("L2"), "REST came from the drop's own hold, after its last step -- not from the glance's revert mid-animation"
        assert new.count("REST") == 1, new
    asyncio.run(go())


def test_a_real_reload_is_but_2_1_the_release_and_a_two_slot_alt_are_not_and_death_clears_it():
    """The trigger the phone reacts to is the press half of the reload button (`$BUT,2,1`); the release
    (`,0`) and an ALT press on a two-weapon loadout are not reloads. Death clears the reload in flight."""
    async def go():
        st, mgr, clock = mk_reload()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st._on_rx("$ALCD,10,100,0,20,0,*")
        st._on_rx("$BUT,2,0,*")
        assert st.reloading is None, "the release is not a pull"
        st._on_rx("$BUT,1,1,*")
        assert st.reloading is None and st._slot_count() == 2, "ALT on two slots is a swap, not a reload"
        st._on_rx("$BUT,2,1,*")
        assert st.reloading and st.reloading["slot"] == 0
        await st.ir("kill"); st.poll(); await settle(st)
        assert not st.alive and st.reloading is None, "the gun stops the reload when you drop; so does the model"
        await st.revive(); await settle(st)
        assert st.reloading is None and st.reserve == 20, "revive clears the slot memory, not what the gun reported"
        # a full mag with reserve: the gun ignores the pull
        st._on_rx("$ALCD,30,100,0,20,0,*")
        st.bundle["spawn"] = [f for f in st.bundle["spawn"]] + ["$AMMO,0,30,20,1,*"]
        st._on_rx("$BUT,2,1,*")
        assert st.reloading is None and any("mag full" in l["text"] for l in st.log)
    asyncio.run(go())


# ======================================================================================================
# F57 -- the hit that ARMS low_health plays the alert only, and stamps the pain gate (engine.js `_onHp`)
# ======================================================================================================

def pains(st, k: int) -> list[str]:
    return [l["why"] for l in list(st.log)[k:] if l["kind"] == "tx" and l["why"].startswith("pain ")]


def test_the_low_health_crossing_plays_no_grunt_and_silences_the_next_600ms():
    """CONTROL 1: a health hit at 16 HP (not under 15) grunts as before. The crossing hit (16 -> 14) plays the
    low-health alert ONLY -- the old stage grunted under it. A hit inside PAIN_GAP_S of the alert is silent
    too (the gate was stamped by the crossing), and CONTROL 2: a hit past the gap grunts again."""
    async def go():
        st, mgr, clock = mk_gain()
        await live(st)
        assert st.bundle["cues"].get("hurt"), "the profile carries the low-health line"
        clock.advance(1.0)
        st._on_rx("$HP,45,0,0,*"); await settle(st)                  # armour gone, health full: sync
        clock.advance(1.0)
        k = len(st.log)
        st._on_rx("$HP,16,0,0,*"); await settle(st)                  # 29 dmg to health at 16 HP: grunts (short pain)
        assert pains(st, k) and pains(st, k)[0].startswith("pain short"), pains(st, k)
        assert st.bundle["cues"]["hurt"] not in since(mgr, 0)[-3:], "16 is not under 15: no alert yet"
        clock.advance(S.PAIN_GAP_S + 0.1)                            # well past the gap the grunt above started
        k = len(st.log); n = mark(mgr)
        st._on_rx("$HP,14,0,0,*"); await settle(st)                  # the CROSSING: 16 -> 14
        assert st.bundle["cues"]["hurt"] in since(mgr, n), "the low-health alert played"
        assert pains(st, k) == [], "F57: no grunt under the alert"
        assert any("armed the low-health alert (F57)" in l["text"] for l in list(st.log)[k:])
        assert st._last_pain_at == clock.t, "the pain gate was stamped by the crossing"
        clock.advance(0.3)
        k = len(st.log)
        st._on_rx("$HP,12,0,0,*"); await settle(st)                  # inside PAIN_GAP_S of the alert: silent
        assert pains(st, k) == [] and any("dropped (another inside" in l["text"] for l in list(st.log)[k:])
        clock.advance(S.PAIN_GAP_S)
        k = len(st.log)
        st._on_rx("$HP,10,0,0,*"); await settle(st)                  # past the gap: grunts again
        assert pains(st, k) and pains(st, k)[0].startswith("pain short"), pains(st, k)
    asyncio.run(go())


# ======================================================================================================
# F15 -- the host-driven stun (EMP), mirrored from engine.js `_stun` / `_stunRestore` / `_onAmmo`
# ======================================================================================================

def mk_stun(stun=10, **profile):
    mgr = FakeConnectionManager([FakeTagger(GUN, "FAKE-STAGE", team=1)])
    clock = _Clock()
    st = GunStage(mgr, None, sleep=_nosleep, now=clock, voice_verdict_sink=lambda _r: None)
    st.set_profile(stun=stun, **profile)
    return st, mgr, clock


def ammo_writes(mgr, n) -> list[str]:
    return [f for f in since(mgr, n) if f.startswith("$AMMO,")]


def test_an_emp_under_config_stun_disarms_every_slot_extends_on_a_second_word_and_restores_the_live_counts_once():
    """The proven chain: proto-8 $HIR -> the `<8,0>` fn-24 row (compiled ONLY when config.stun is set) -> the node
    writes `$AMMO,<slot>,0,0,1,*` per live slot and restores the LIVE pair (last $ALCD, else the spawn frame's)
    when `config.stun.duration_s` runs out. A second EMP extends and writes nothing; $ALCD is ignored while
    stunned; the restore is written once. CONTROL: without config.stun the same word does nothing and the head
    carries the stock plain-damage cell."""
    async def go():
        st, mgr, clock = mk_stun(stun=10)
        assert st.stun_enabled and st.stun_s == 10.0
        await live(st)
        # F121/A23: the live table rides the SPAWN burst now -- the head ships the cell disarmed (fn 28),
        # because fn 24 is the delayed-blast family and must never reach a gun before go-live.
        live_rows = [f for f in st.bundle["spawn"] if f.startswith("$SIR,8,0,")]
        assert live_rows and live_rows[0].split(",")[4] == "24", f"the <8,0> cell is fn 24 (a status row) when stun is on: {live_rows}"
        head = [f for f in st.bundle["head"] if f.startswith("$SIR,8,0,")]
        assert head and head[0].split(",")[4] == "28", f"the head must not arm the EMP cell: {head}"
        spawn = st._spawn_ammo()
        assert set(spawn) == {0, 1}, spawn
        # a shot on slot 0 first, so the restore must use the LIVE pair there and the frame's on slot 1
        st._on_rx("$ALCD,25,100,0,80,0,*")
        clock.advance(1.0)
        n = mark(mgr); k = len(st.log)
        await st.ir("emp"); st.poll(); await settle(st)
        assert ammo_writes(mgr, n) == ["$AMMO,0,0,0,1,*", "$AMMO,1,0,0,1,*"], ammo_writes(mgr, n)
        assert st.stunned and st.stunned["until"] == clock.t + 10.0 and st.stunned["ammo"] == {0: [25, 80], 1: spawn[1]}
        assert st.hp == 45, "a stun is not damage"
        assert st.state()["model"]["stunned"]["left_s"] == 10.0
        # $ALCD while stunned: the gun echoing our zero -- ignored, not recorded
        st._on_rx("$ALCD,0,100,0,80,0,*")
        assert st._prev_ammo[0] == 25 and st.ammo == 25 and any("ignored while stunned" in l["text"] for l in list(st.log)[k:])
        # a second EMP mid-window extends, writes nothing
        clock.advance(4.0)
        n = mark(mgr)
        await st.ir("emp"); st.poll(); await settle(st)
        assert ammo_writes(mgr, n) == [] and st.stunned["until"] == clock.t + 10.0
        clock.advance(7.0)                                           # the first window has passed; the extension holds
        st.poll(); await settle(st)
        assert st.stunned
        clock.advance(3.0)
        n = mark(mgr)
        st.poll(); await settle(st)                                  # expiry: the restore, from the snapshot, once
        assert st.stunned is None and ammo_writes(mgr, n) == ["$AMMO,0,25,80,1,*", f"$AMMO,1,{spawn[1][0]},{spawn[1][1]},1,*"], ammo_writes(mgr, n)
        n = mark(mgr)
        for _ in range(3):
            clock.advance(1.0); st.poll(); await settle(st)
        assert ammo_writes(mgr, n) == [], "restored once"
        assert any(l["text"] == "stun over (expired)" for l in st.log)
        # death cancels with NO write
        clock.advance(1.0)
        await st.ir("emp"); st.poll(); await settle(st)
        assert st.stunned
        n = mark(mgr)
        await st.ir("kill"); st.poll(); await settle(st)
        assert not st.alive and st.stunned is None and ammo_writes(mgr, n) == []
        assert any(l["text"] == "stun over (died)" for l in st.log)
        clock.advance(20.0)
        n = mark(mgr); st.poll(); await settle(st)
        assert ammo_writes(mgr, n) == [], "no restore ever lands from a stun death cancelled"
        # CONTROL: no config.stun -> the stock cell, no stun, no write
        c, cm, cclock = mk_stun(stun=None)
        assert not c.stun_enabled and "stun" not in c.config
        await live(c)
        head = [f for f in c.bundle["spawn"] if f.startswith("$SIR,8,0,")]
        assert head and head[0].split(",")[4] != "24", f"stock plain-damage cell without config.stun: {head}"
        n = mark(cm)
        await c.ir("emp"); c.poll(); await settle(c)
        assert c.stunned is None and ammo_writes(cm, n) == [] and any("no stun -- this game has no config.stun" in l["text"] for l in c.log)
        # the duration knob: `stun=0` is the {} default (10 s), a number is `{duration_s}`
        d, _, _ = mk_stun(stun=0)
        assert d.config["stun"] == {} and d.stun_s == 10.0
        d.set_profile(stun=3)
        assert d.config["stun"] == {"duration_s": 3} and d.stun_s == 3.0
        try:
            d.set_profile(stun=61); assert False
        except ValueError:
            pass
    asyncio.run(go())


def test_a_stun_before_the_first_shot_of_a_new_life_restores_this_lifes_reserve_not_the_last_ones():
    """Polish review 2026-09-11 (engine.js had the same defect, fixed together): the spawn reset cleared the
    per-slot MAG map but not the RESERVE map, so a stun before any $ALCD of life 2 snapshotted the frame's
    mag with life 1's reserve and the restore wrote that stale pair to the gun."""
    async def go():
        st, mgr, clock = mk_stun(stun=10)
        await live(st)
        spawn = st._spawn_ammo()
        st._on_rx("$ALCD,20,100,0,150,0,*")                          # life 1 fired: live 20/150
        clock.advance(1.0)
        await st.ir("kill"); st.poll(); await settle(st)
        assert not st.alive
        await st.spawn(); await settle(st); st.poll(); await settle(st)   # life 2: the frame's pair is back on the gun
        assert st.alive
        assert st._prev_ammo == {} and st._prev_reserve == {}, "both $ALCD maps reset on spawn"
        n = mark(mgr)
        await st.ir("emp"); st.poll(); await settle(st)
        assert st.stunned and st.stunned["ammo"][0] == list(spawn[0]), st.stunned["ammo"]
        clock.advance(10.5); n = mark(mgr); st.poll(); await settle(st)
        w = ammo_writes(mgr, n)
        assert w == [f"$AMMO,0,{spawn[0][0]},{spawn[0][1]},1,*", f"$AMMO,1,{spawn[1][0]},{spawn[1][1]},1,*"], w
        assert not any(",150," in f for f in w), "life 1's reserve never reaches the gun"
        # CONTROL: a shot in life 2 before the stun makes the live pair the restore (the main test's rule)
        st._on_rx("$ALCD,31,100,0,190,0,*")
        await st.ir("emp"); st.poll(); await settle(st)
        clock.advance(10.5); n = mark(mgr); st.poll(); await settle(st)
        assert "$AMMO,0,31,190,1,*" in ammo_writes(mgr, n)
    asyncio.run(go())


# ======================================================================================================
# F123 (polish review 2026-09-12) -- the rest of the reload takeover, mirrored from engine.js
# ======================================================================================================
def test_the_takeover_is_as_long_as_THIS_weapon_not_a_flat_1_5s():
    """engine.js `_reloadPulled` times the takeover from the ACTIVE slot's catalog `reload_s`, then the
    perk's `reload_mult` on slot 0. The stage hardcoded 1.5 s for every gun and every perk, so the bench
    predicted a deadline the phone would never use -- on the Shotgun (0.4 s per shell) by a factor of
    nearly four, and on a quick_hands AR (0.7 s) by more than two."""
    async def go():
        st, mgr, clock = mk_reload()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st.alcd(mag=10, reserve=20); await settle(st)
        st.reload(); await settle(st)
        assert st.reloading["s"] == 1.4, f"slot 0 is the AR (reload_ms 1400): {st.reloading}"
        # the second slot is its own weapon: the stage's is the Shotgun, whose row is a 0.4 s per-shell chain
        st._end_reload("fired"); st.active_slot = 1
        st.alcd(mag=2, reserve=12, slot=1); await settle(st)
        st.reload(); await settle(st)
        assert st.reloading["s"] == 0.4, f"slot 1 is the Shotgun (reload_ms 400): {st.reloading}"
        # a reload perk shrinks slot 0 only -- compile writes `reload_mult` into slot 0's $WEAP and nowhere else
        st._end_reload("fired")
        st.player["loadout"]["perk"] = "quick_hands"
        st.reload(); await settle(st)
        assert st.reloading["s"] == 0.4, "slot 1 does not get the perk's multiplier"
        st._end_reload("fired"); st.active_slot = 0
        st.reload(); await settle(st)
        assert st.reloading["s"] == 0.7, f"quick_hands halves the AR's 1.4 s: {st.reloading}"
    asyncio.run(go())


def test_a_new_life_and_the_end_of_the_match_clear_the_whole_takeover_not_just_the_bar():
    """engine.js clears `reloading`, `_reloadOutcome` AND `held` at `_afterSpawn`/`_revive` (~1170),
    `_endLocal` (~1599) and on PANIC. The stage cleared only `reloading`, so the last life's VERDICT
    ("reload did NOT take") stayed on the page to be read as this life's, and a button pressed before a
    death stayed down forever."""
    async def go():
        for finish in ("revive", "end", "panic"):
            st, mgr, clock = mk_reload()
            await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
            st.alcd(mag=10, reserve=20); await settle(st)
            st._on_rx("$BUT,2,1,*")                      # a pull, still held: `held` carries the press
            assert st.reloading and st.held, (st.reloading, st.held)
            st._end_reload("timeout")
            assert st.reload_outcome and st.reload_outcome["ok"] is False, "the life ends on a failed reload"
            if finish == "revive":
                await st.ir("kill"); st.poll(); await settle(st)
                # `_death` already clears all three; the clear in `_afterSpawn`/`_revive` is the phone's
                # BACKSTOP for anything that lands while you are down, so put something there to be cleared.
                st.reloading = {"at": st.now(), "s": 1.4, "slot": 0, "from": 0, "cap": 30, "mag": 0,
                                "last_gain_at": st.now(), "released_at": None}
                st.reload_outcome = {"ok": False, "why": "timeout"}; st.held = {2: st.now()}
                await st.revive(); await settle(st)
            else:
                await getattr(st, finish)(); await settle(st)
            assert st.reloading is None, finish
            assert st.reload_outcome is None, f"{finish}: last life's verdict survived into the next"
            assert st.held == {}, f"{finish}: a button was left down across it"
    asyncio.run(go())


def test_a_ble_drop_ends_the_takeover_because_no_echo_can_ever_arrive():
    """engine.js `onBleDropped` (~384) calls `_endReload('dropped')`: with no link there is no `$ALCD` to
    reconcile against, so a bar left running is fiction -- the exact F123 symptom. Both of `poll()`'s
    drop branches must do it (the manager reporting the link down, and `get_events` raising)."""
    async def go():
        st, mgr, clock = mk_reload()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st.alcd(mag=10, reserve=20); await settle(st)
        st.reload(); await settle(st)
        assert st.reloading
        mgr.drop("stage")
        assert st.poll() == [] and st.connected is False
        assert st.reloading is None, "a takeover cannot outlive the link it would be confirmed on"
        assert st.reload_outcome and st.reload_outcome["why"] == "dropped", st.reload_outcome
        assert st.reload_outcome["ok"] is False, "nothing was gained: the verdict must not read as a success"
        # the other branch: `get_events` itself raises
        st2, mgr2, _c2 = mk_reload()
        await st2.connect(GUN); await st2.arm(); await st2.spawn(); await settle(st2)
        st2.alcd(mag=10, reserve=20); await settle(st2)
        st2.reload(); await settle(st2)
        def boom(*a, **k):
            raise RuntimeError("link lost")
        mgr2.get_events = boom
        assert st2.poll() == [] and st2.connected is False
        assert st2.reloading is None and st2.reload_outcome["why"] == "dropped", st2.reload_outcome
    asyncio.run(go())


def test_a_stunned_gun_refuses_the_pull_and_takes_it_again_once_the_stun_is_over():
    """engine.js `_reloadPulled`: a stunned gun is disarmed and `_on_ammo` drops every $ALCD in the window,
    so a takeover started there could only ever book `ok:false` on a reload nobody asked the gun for.
    CONTROL: the same pull takes the moment the stun expires."""
    async def go():
        st, mgr, clock = mk_reload()
        st.load_config({**st.config, "stun": {"duration_s": 2}}, source="test")
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st.alcd(mag=10, reserve=20); await settle(st)
        await st.ir("emp"); st.poll(); await settle(st)
        assert st.stunned, "fixture: the EMP word must actually stun this game"
        st.reload(); await settle(st)
        assert st.reloading is None, "a stunned gun takes no reload"
        assert any("stunned" in l["text"] for l in st.log if "reload pull ignored" in l["text"])
        clock.advance(2.5); st.poll(); await settle(st)
        assert not st.stunned, "fixture: the stun expired"
        st.alcd(mag=10, reserve=20); await settle(st)
        st.reload(); await settle(st)
        assert st.reloading, "the same pull takes once the gun is back"
    asyncio.run(go())


def test_a_chain_that_loaded_then_fired_books_what_it_LOADED():
    """engine.js `_onAmmo`: `_endReload('fired')` runs BEFORE `mag` is overwritten with the post-shot count.
    Overwriting first made a shotgun chain that loaded 1 -> 3 and then fired read `gained: 0, ok: false` --
    the false verdict F123 exists to prevent. CONTROL: a reload that gained nothing still books ok:false."""
    async def go():
        st, mgr, clock = mk_reload()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st.alcd(mag=1, reserve=20); await settle(st)
        st.reload(); await settle(st)
        st.alcd(mag=2, reserve=19); st.alcd(mag=3, reserve=18)      # two shells of a chain
        assert st.reloading and st.reloading["mag"] == 3
        st.alcd(mag=2, reserve=18)                                   # …and the player fires
        assert st.reloading is None
        o = st.reload_outcome
        assert (o["ok"], o["from"], o["to"], o["gained"], o["why"]) == (True, 1, 3, 2, "fired"), o
        # CONTROL: a pull the gun never fed, ended by a shot, is still a failure
        st.reload(); await settle(st)
        st.alcd(mag=1, reserve=18)
        assert st.reload_outcome["ok"] is False and st.reload_outcome["gained"] == 0, st.reload_outcome
    asyncio.run(go())


def test_an_alt_swap_abandons_the_takeover_on_the_same_frame():
    """engine.js `_altPressed`: a swap puts a different weapon in your hands, so the old slot's magazine
    stops moving and no $ALCD can ever reconcile the takeover. `switching` and `reloading` are never both
    set. CONTROL: the confirming $ALCD on the other slot clears `switching` and times it."""
    async def go():
        st, mgr, clock = mk_reload()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st.alcd(mag=10, reserve=20); await settle(st)
        st.reload(); await settle(st)
        assert st.reloading and st._slot_count() == 2
        st._on_rx("$BUT,1,1,*")                                      # ALT
        assert st.reloading is None and st.switching, (st.reloading, st.switching)
        assert st.reload_outcome["why"] == "swapped", st.reload_outcome
        m = st.state()["model"]
        assert m["reloading"] is None and m["switching"]["from"] == 0, (m["reloading"], m["switching"])
        clock.advance(0.2)
        st.alcd(mag=6, reserve=12, slot=1)
        assert st.switching is None and st.last_switch_s == 0.2, (st.switching, st.last_switch_s)
        assert st.active_slot == 1
        # and a swap the gun never confirms is ASSUMED past the window rather than shown for ever
        st._on_rx("$BUT,1,1,*")
        assert st.switching
        clock.advance(st._switch_window_s() + 0.1); st.poll(); await settle(st)
        assert st.switching is None and st.active_slot == 0, st.active_slot
    asyncio.run(go())


def test_a_ble_drop_also_lets_go_of_every_button():
    """engine.js `onBleDropped` clears `held`: `_on_button` keeps the FIRST edge, so a press whose release
    never arrived before the drop would read as held for the rest of the life. The reconnect does not reset
    buttons either, so it stays empty until a real press."""
    async def go():
        st, mgr, clock = mk_reload()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st.alcd(mag=10, reserve=20); await settle(st)
        st._on_rx("$BUT,2,1,*")                                      # pressed, never released
        assert st.held and st.reloading
        mgr.drop("stage")
        assert st.poll() == [] and st.connected is False
        assert st.held == {} and st.switching is None, st.held
        assert st.state()["model"]["held"] == {}
        st.connected = True                     # the page relinks; nothing on the way back re-presses a button
        st.poll(); await settle(st)
        assert st.held == {}, "a relink does not invent a press either"
    asyncio.run(go())


def test_the_published_takeover_goes_null_all_at_once_past_the_deadline():
    """engine.js `state()` gates `reloading`/`reloadMs`/`reloadTotalMs`/`reloadGained`/`reloadOverrun` on one
    `reloadingMs()`, so between the deadline and the tick that books the timeout a reader can never see a
    live elapsed beside `reloading: false`. The stage publishes one object, so it is null or whole."""
    async def go():
        st, mgr, clock = mk_reload()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st.alcd(mag=10, reserve=20); await settle(st)
        st.reload(); await settle(st)
        v = st.state()["model"]["reloading"]
        assert v and v["elapsed_s"] == 0 and v["overrun"] is False, v
        clock.advance(st.reloading["s"] + 0.05)                      # past nominal, inside the deadline
        v = st.state()["model"]["reloading"]
        assert v and v["overrun"] is True, v
        clock.advance(st._reload_deadline() - clock.t + 0.01)        # past the deadline, before any tick
        assert st.reloading is not None, "the model still holds it: only the tick books the timeout"
        assert st.state()["model"]["reloading"] is None, "but nothing stale is published under it"
        st.poll(); await settle(st)
        assert st.reloading is None and st.reload_outcome["why"] == "timeout"
    asyncio.run(go())


def test_a_stunned_gun_raises_no_swap_on_alt_and_takes_it_again_once_the_stun_is_over():
    """engine.js `_altPressed`, the mirror of the guard `_reloadPulled` already had: a stunned gun is
    disarmed and `_on_ammo` drops every $ALCD in the window, so a swap opened there can never be confirmed
    -- it runs to the switch window and then books an ASSUMED swap, leaving `active_slot` on a weapon the
    player never drew for the rest of the life. CONTROL: the same press swaps once the stun expires."""
    async def go():
        st, mgr, clock = mk_reload()
        st.load_config({**st.config, "stun": {"duration_s": 2}}, source="test")
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st.alcd(mag=10, reserve=20); await settle(st)
        assert st._slot_count() == 2, "fixture: two weapons, so ALT is a swap and not a reload"
        await st.ir("emp"); st.poll(); await settle(st)
        assert st.stunned, "fixture: the EMP word must actually stun this game"
        st._on_rx("$BUT,1,1,*")
        assert st.switching is None, "a stunned gun raises no swap"
        assert any("ALT ignored" in l["text"] for l in st.log)
        clock.advance(st._switch_window_s() + 0.1); st.poll(); await settle(st)
        assert st.active_slot == 0, "and no assumed swap books a weapon the player is not holding"
        clock.advance(2.5); st.poll(); await settle(st)
        assert not st.stunned, "fixture: the stun expired"
        st._on_rx("$BUT,1,1,*")
        assert st.switching, "CONTROL: the same press swaps once the gun is back"
    asyncio.run(go())


def test_the_reload_watchdog_hands_the_deadline_to_poll_instead_of_busy_spinning():
    """The anti-spin guard was ONE-SIDED: it returned only when the clock had not moved at all, which is the
    hand-driven stage every test above builds. `test_stage.py` `mk()` builds the other kind -- a no-op
    `sleep` beside the REAL `time.monotonic` -- so every pass of the `while True` saw a moved clock, re-armed
    and spun at 100% CPU to the wall-clock deadline (2.1 s for the AR, and a chain pushing `last_gain_at`
    moves it as it goes). No `mk()` test pulls the handle yet, so this is the crash class, not a live bug.
    CONTROL: the deadline still lands -- `poll()` books it, the way engine.js `_reloadTick` does."""
    async def go():
        mgr = FakeConnectionManager([FakeTagger(GUN, "FAKE-STAGE", team=1)])
        st = GunStage(mgr, None, sleep=_nosleep, voice_verdict_sink=lambda _r: None)   # no-op sleep, REAL clock
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st.alcd(mag=10, reserve=20); await settle(st)
        st.reload()
        assert st.reloading, "fixture: the pull took, so there IS a watchdog that could spin"
        assert st._reload_deadline() - st.now() > 1.5, "fixture: the deadline is far enough away to measure a spin"
        t0 = time.monotonic()
        await asyncio.wait_for(settle(st), 5)          # a true hang fails here rather than wedging the suite
        spent = time.monotonic() - t0
        assert spent < 0.5, f"the watchdog spun {spent:.2f}s to the wall-clock deadline instead of handing it to poll()"
        assert st.reloading, "and it booked nothing on the way out -- the takeover is still the gun's to end"
        # CONTROL: the deadline is not lost, it is just `poll()`'s now
        st.reloading["at"] -= 10.0; st.reloading["last_gain_at"] -= 10.0
        st.poll(); await asyncio.wait_for(settle(st), 5)
        assert st.reloading is None and st.reload_outcome["why"] == "timeout", st.reload_outcome
    asyncio.run(go())


# ---------------------------------------------------------------------------- #
# 2026-09-12 doc-rot review: a MECHANICAL coverage floor under the tests above.
#
# Every test in this file is a hand-written pairing of one engine.js behaviour with its GunStage
# counterpart, which means the file can only ever assert what somebody remembered to port. The gap it
# leaves is the one that actually bites: a NEW method lands in `app/src/engine.js`, the stage never
# grows one, and the operator signs off a bench run against a stage that does not model it (2026-09-07:
# seven of nine defects in one night were exactly that).
#
# So: parse both class bodies, and pin the set of engine methods with NO same-named stage counterpart.
# A new name appearing in that set fails this test and forces a decision — port it to the stage, or add
# it below with a reason. Most of the pinned set is deliberately node-only: transport (`onMcMessage`,
# `setWsState`), persistence (`_save`, `_load`), HUD/browser surface (`openBriefing`, `loadoutView`) and
# MC-pushed facts the stage has no MC for. Game RULES are what must not appear here.
# ---------------------------------------------------------------------------- #
import pathlib as _pathlib
import re as _re

_REPO = _pathlib.Path(__file__).resolve().parents[2]
_ENGINE_JS = _REPO / "app" / "src" / "engine.js"
_STAGE_PY = _REPO / "mcp" / "brx_mcp" / "stage" / "stage.py"
_JS_KEYWORDS = {"if", "for", "while", "switch", "catch", "do", "else", "return", "constructor",
                "function", "try"}


# `^  ` is exactly the class-body indent: `\s*` anywhere before the name would swallow deeper
# indentation and pull local function calls (`      paint(next, ...)`) in as methods. A `get`/`set`
# prefix must be followed by real whitespace, or `setReady(` parses as `set` + `Ready`.
_METHOD = _re.compile(r"^  (?:static\s+)?(?:async\s+)?(?:(?:get|set)\s+)?(\*\s*)?(\w+)\s*\(", _re.M)


def _engine_methods() -> set[str]:
    """Names declared at one indent level inside the Engine class.

    2026-09-12 polish pass: the original pattern only saw `  foo(` / `  async foo(`, so it missed all
    thirteen ACCESSORS — and accessors are where engine.js keeps its config rules (`maxHp`, `maxArmor`,
    `respawnDelayMs`, `respawnType`, `respawnGate`, `stunMs`, `timeLimitMs`). A rule the scan cannot see
    is a rule the stage can silently fail to model, which is the one thing this file exists to catch.
    `static`, `get`/`set` and generator (`*name`) declarations are all read now.
    """
    text = _ENGINE_JS.read_text(encoding="utf-8")
    return {m.group(2) for m in _METHOD.finditer(text)} - _JS_KEYWORDS


def _stage_methods() -> set[str]:
    """`def`s inside the GunStage class body."""
    text = _STAGE_PY.read_text(encoding="utf-8")
    body = text[text.index("class GunStage"):]
    nxt = _re.search(r"^class ", body[10:], _re.M)
    if nxt:
        body = body[:nxt.start() + 10]
    return {m.group(1) for m in _re.finditer(r"^    (?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", body, _re.M)}


def _snake(name: str) -> str:
    return _re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def _unmirrored() -> set[str]:
    stage = _stage_methods()
    return {m for m in _engine_methods() if m not in stage and _snake(m) not in stage}


# Pinned from the tree of 2026-09-12 (107 names, re-pinned once the accessor scan above started seeing
# getters). Shrinking it is progress; GROWING it needs a reason.
KNOWN_UNMIRRORED = {
    # transport / MC session: the stage talks to a gun, never to Mission Control
    "onMcMessage", "onBleConnected", "onBleDropped", "setWsState", "hydrate", "statusBody", "resume",
    "resumeSchedule", "_event", "_probe", "_checkEcho", "ackEnd", "onResultPush", "resultWait",
    # app lifecycle + the A26 pick debounce: the stage has no foreground/background and no MC to pick from
    "_awake", "commitPick",
    "_beginReconcile", "_endReconcile", "_reportPossession", "feedback", "alert", "control", "_cue",
    "_beginResync", "_resyncButton", "_resyncDone", "_resyncEvidence", "_resyncNotLive", "_resyncTick",
    # persistence + config application (the stage is configured directly, not by a pushed bundle)
    "_save", "_load", "_set", "_changed", "clearPersisted", "_applyConfig", "_assign", "_write",
    "_writeHead", "_writeTeardown", "feedFrame", "reset", "_pickTable",
    # kitting / loadout browser — HUD surface, no stage equivalent
    "browse", "canPick", "conflictFor", "kitOpen", "loadoutView", "perkRow", "weaponRow", "slotRule",
    "requestLoadout", "_loadoutAck", "dismissTryout", "_tutorial", "setReady", "_loadAmmo",
    "_cancelPick", "_flushPick", "_sendPick",     # A26: the 400 ms tap-to-equip debounce, browser-only
    # briefing / history / roster display
    "openBriefing", "closeBriefing", "historyEntry", "nameOf", "teamOf",
    # lifecycle the stage drives by hand from its own clock
    "startAt", "tick", "_spawn", "_revive", "_death", "_endLocal", "_triggerPulled", "_onHp",
    "armState", "respawnHint", "heldMs", "reloadingMs", "switchingMs", "switchWindowMs", "_accrueHold",
    # LED readout internals: the stage models the READOUT, not each paint step
    "_gunReadoutPaint", "_gunReadoutPaintLevels", "_gunReadoutTick", "_readoutAnimStart",
    "_readoutConfiguredPools", "_readoutFullLevel", "_readoutLevel", "_readoutSettle",
    "_headsetDeath", "_headsetDelayed", "_headsetFlash", "_headsetRest", "_reassertDeathBlink",
    # roles + stations
    "_carrier", "_setRole", "_respawnStation", "_stationRevivable", "setStations",
    # ---- accessors (2026-09-12: newly VISIBLE to the scan, not newly unmirrored) ----
    # config values the stage resolves into plain attributes rather than same-named accessors:
    # `_apply_config` sets `self.max_hp` / `self.max_armor` from the same `health` block, and `stun_s`
    # is the stage's `stunMs` under the unit it works in (seconds). Mirrored in substance, not in name.
    "maxHp", "maxArmor", "stunMs",
    # match CLOCK: the stage has none. The operator drives spawn, revive and end by hand from the
    # bench script, which is why `startAt`/`tick`/`_endLocal` are pinned above; these are the config
    # readers that only a self-running clock would need.
    "respawnDelayMs", "respawnType", "respawnGate", "timeLimitMs", "goLiveT", "endT",
    # display helpers over `this.team` / the equipped weapon — HUD surface, no gun-side behaviour
    "teamTid", "teamKey", "weaponName",
    # `stunEnabled` is deliberately ABSENT: the stage has `stun_enabled`, and it must stay paired.
}


def test_stage_ports_every_engine_method_it_claims():
    """Fails when a NEW `app/src/engine.js` method has no same-named `GunStage` counterpart.

    The stage's only purpose is to PREDICT the phone. A rule that exists on one side and not the other
    is a bench run that proves nothing — verified against a fiction. If the new name is genuinely
    node-only (transport, storage, HUD chrome), add it to `KNOWN_UNMIRRORED` with a comment; if it is a
    game rule, port it to `brx_mcp/stage/stage.py`.
    """
    unmirrored = _unmirrored()
    new = sorted(unmirrored - KNOWN_UNMIRRORED)
    assert not new, (
        "new engine.js method(s) with no GunStage counterpart — port them to the stage, or pin them in "
        "KNOWN_UNMIRRORED with a reason: " + ", ".join(new))
    # A pinned name that no longer turns up unmirrored is EITHER ported to the stage OR gone from
    # engine.js (removed, renamed, or moved out of the class body). Those need opposite follow-ups, and
    # the old message asserted the happy one for both — sending a reader to look for a stage method that
    # was never written. Say which it is; fail either way, so the pin gets cleaned.
    engine = _engine_methods()
    stale = sorted(KNOWN_UNMIRRORED - unmirrored)
    ported = [m for m in stale if m in engine]
    vanished = [m for m in stale if m not in engine]
    stale = [m for m in stale if m in ported or m in vanished]
    assert not stale, "; ".join(filter(None, [
        ("now mirrored on the stage — delete them from KNOWN_UNMIRRORED so the set keeps shrinking: "
         + ", ".join(ported)) if ported else "",
        ("no longer declared in app/src/engine.js at all (REMOVED or RENAMED, not mirrored) — find the new "
         "name and re-pin it, or drop the entry: " + ", ".join(vanished)) if vanished else "",
    ]))


def test_the_mirror_scan_sees_both_classes():
    """The floor: two empty sets agree perfectly. Both parsers must find real methods."""
    eng, stg = _engine_methods(), _stage_methods()
    assert len(eng) > 100, f"only {len(eng)} engine.js methods parsed — the declaration pattern moved"
    for getter in ("maxHp", "respawnDelayMs", "timeLimitMs", "stunEnabled"):
        assert getter in eng, (f"`get {getter}()` is not parsed out of engine.js — the accessor pattern "
                               "regressed and every config RULE is invisible to this file again")
    assert len(stg) > 100, f"only {len(stg)} GunStage methods parsed — the class body pattern moved"
    mirrored = eng - _unmirrored()
    assert len(mirrored) > 25, f"only {len(mirrored)} engine methods resolve to a stage method"
    for known in ("_hillTick", "_reloadTick", "_stun"):
        assert known in mirrored, f"{known} should pair engine.js with GunStage but does not"
