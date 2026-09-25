"""The stage MIRRORS the phone -- F102 (the phone control point), F58(b) (the pool-rise events) and F54
(the reload glance), each ported from `app/src/engine.js` and each pinned here with a paired CONTROL:
the old behaviour would have failed, or the neighbouring path is unchanged.

The stage's only purpose is to PREDICT the phone (2026-09-07: seven of nine defects in one night were a
stage/phone divergence the operator had signed off on). ⚠ UNITS: engine.js is on `Date.now()` (ms), the
stage on `time.monotonic` (SECONDS); every test below drives `self.now` by hand through `_Clock`.
"""
from __future__ import annotations

import asyncio
import math
import time

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage import stage as S
import pathlib

from brx_mcp.stage.stage import PROBE_LIFE, GunStage, decode_advert_uuid, encode_advert_uuid
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

def test_byte_15_taker_is_decoded_and_encoded_as_beacon_js_does():
    """F331: a powerup station's winner rides in byte 15 (`taker`, beacon.js `decodeUuid`); the stage ignored it."""
    u = encode_advert_uuid("station", 4, "powerup", 255, 0, 110, taker=7)
    raw = u.replace("-", "")
    assert raw[30:32] == "07", "taker at byte 15"
    d = decode_advert_uuid(u)
    assert d is not None and d["taker"] == 7 and d["value"] == 110
    # CONTROL: the same advert with byte 15 cleared names nobody
    d0 = decode_advert_uuid(raw[:30] + "00")
    assert d0 is not None and d0["taker"] == 0


def test_the_advert_is_decoded_through_the_phones_byte_layout_not_a_side_door():
    """The stage feeds an injected advert through beacon.js's 16-byte layout: team is byte 9, FLAGS byte 10,
    progress byte 11. A literal UUID lands in the same model as the fields do; anything that is not an Open
    BRX advert, or not a control point, is refused rather than guessed at."""
    u = encode_advert_uuid("station", 7, "control", 1, S.CONTROL_STATE["held"] | S.CONTROL_STATE["rising"], 42)
    d = decode_advert_uuid(u)
    assert d == {"role": "station", "id": 7, "kind": "control", "team": 1, "state": 5, "value": 42, "seq": 0, "game": 0, "threshold": 0, "taker": 0}
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
    st._arm_life("test"); await settle(st)   # F209: past spawn protection, so the fake gun takes hits
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


def test_a_rise_above_the_armed_ceiling_is_a_misread_pset_not_a_pickup_and_is_never_voiced():
    """HUD QA R2-02 x F341: a `$PSET` the gun misread reports `$HP,4545,7070` -- a rise of 4500 health and 7000 armour.
    The phone neither floats nor voices it (engine.js `_gainOverCeiling`), so the stage must not either. CONTROL: a
    rise back up TO the ceiling still says armour_up."""
    async def go():
        st, mgr, clock = mk_gain()
        await live(st)
        cues = rise_cues(st)
        clock.advance(1.0)
        st._on_rx("$HP,45,40,0,*"); await settle(st)                  # a 30 armour hit
        clock.advance(1.0)
        n = mark(mgr)
        st._on_rx("$HP,4545,7070,0,*"); await settle(st)              # the misread `$PSET`: above 45/70
        assert not any(c in since(mgr, n) for c in cues.values()), "a pool above the armed ceiling was voiced as a gain"
        assert any("above the armed ceiling: no gain event" in l["text"] for l in st.log)
        clock.advance(1.0)
        st._on_rx("$HP,45,40,0,*"); await settle(st)                  # back in range (what a repair gives)
        clock.advance(1.0)
        n = mark(mgr)
        st._on_rx("$HP,45,70,0,*"); await settle(st)                  # CONTROL: +30 armour up to the ceiling
        assert since(mgr, n).count(cues["armour_up"]) == 1
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


async def flush_fake_ammo(st, mgr):
    """Drain delayed `$ALCD` replies before a test injects a newer gun report."""
    tagger = mgr.taggers[GUN]
    loop = asyncio.get_running_loop()
    deadline = loop.time() + 5.0
    while tagger._pending and loop.time() < deadline:
        await st.write(["$VOLTS,*"], "flush delayed fake ammo", gap_ms=0)
        st.poll()
        if tagger._pending:
            await asyncio.sleep(0.01)
    assert not tagger._pending, "the fake gun's delayed ammo replies did not drain"


# ======================================================================================================
# F259 -- the node's own magazine account, mirrored from engine.js `_acctLive` / `_acctPress` / `_acctAmmo`
# ======================================================================================================

def test_the_stun_restore_carries_the_nodes_own_magazine_account_not_the_last_alcd():
    """F259 (bench 2026-09-18): every `$AMMO` the node writes decides what the player is left holding, and the
    gun's `$ALCD` is always a little late -- the round has left by the time the frame lands. The phone's
    accuracy writer restored the last count it had RECEIVED and so handed spent rounds back until the magazine
    never emptied. The stage has no accuracy writer, but its STUN restore carries a count too, and it had the
    same staleness in it.

    CONTROL: the account tracks the gun exactly while nothing is in flight, and a press the gun never answers
    expires rather than holding the account down for the rest of the life."""
    async def go():
        st, mgr, clock = mk_reload()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st.config["stun"] = {"duration_s": 4}          # `stun_enabled` reads the live config, as engine.js does
        assert st.stun_enabled
        st.alcd(mag=20, reserve=200); await settle(st)
        assert st._acct_live(0) == 20, "CONTROL: with nothing in flight the account is the gun's own number"
        # the trigger press: the round is leaving NOW, and its $ALCD has not landed
        st._inject_rx("$BUT,0,1,*"); await settle(st)
        assert st._acct_live(0) == 19, "the press must book the round straight away -- it is the earliest evidence"
        n = mark(mgr)
        st._stun(); await settle(st)
        assert "$AMMO,0,0,0,1,*" in since(mgr, n), "pre-condition: the stun must disarm slot 0"
        clock.advance(st.stun_s + 0.1); st.poll(); await settle(st)
        assert st.stunned is None, "pre-condition: the stun must have expired"
        assert "$AMMO,0,19,200,1,*" in since(mgr, n), \
            f"the restore handed back a round the player had already spent: {since(mgr, n)}"
        # CONTROL: a press the gun never answers expires, so a mis-modelled press cannot hold the count down
        # for the rest of the life. ONE press is outstanding here, not two: the stun above ran the clock past
        # TRIGGER_NO_FIRE_S, so the earlier press is gone. It used to STACK -- `_acct_live` merely ignored an
        # expired press and left the count on the account, so the next pull added to it -- and on a 2-round
        # magazine (five shipping weapons carry one) two unanswered pulls took the account to zero while the
        # gun was loaded, which `_live_ammo` then wrote to the gun as `$AMMO,<slot>,0` (polish review
        # 2026-09-18). An expired press is now CLEARED.
        st._inject_rx("$BUT,0,1,*"); await settle(st)
        assert st._acct_live(0) == 19, "one outstanding press, not a stale one stacked under it"
        clock.advance(st.TRIGGER_NO_FIRE_S + 0.1)
        assert st._acct_live(0) == 20, "unanswered presses must expire; the gun's number wins"
    asyncio.run(go())


def test_the_account_takes_the_guns_number_whenever_nothing_is_in_flight():
    """The gun always wins. The account exists to cover the gap between a round leaving and its `$ALCD`, never
    to hold an opinion about the magazine: one frame outside the echo window re-seats it outright."""
    async def go():
        st, mgr, clock = mk_reload()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st.alcd(mag=20, reserve=200); await settle(st)
        st._shot_acct[0] = {"mag": 3, "fired": 2, "at": 0.0, "res": None, "echo_until": 0.0, "echo_expect": None}
        st.alcd(mag=18, reserve=200); await settle(st)
        assert st._acct_live(0) == 18, "the account must take the gun's number, never argue with it"
        assert st._acct_echoing(0) is False
    asyncio.run(go())


def test_the_echo_window_covers_both_answers_to_a_write_and_neither_reads_as_fire():
    """F259 (bench 2026-09-18), the oscillation, mirrored. The node writes `$AMMO,0,6`; the gun answers
    `$ALCD 32` (its `$WEAP` reset) and then `$ALCD 6` (the restore landing). Judging those one at a time --
    refusing the rise, then taking the fall as a 26-round decrement -- is what fed the phone's recoil burst
    counter and made its accuracy writer flap for nine seconds after the player stopped shooting.

    CONTROL: a real round outside the window still costs the account one, and still reads as one round spent."""
    async def go():
        st, mgr, clock = mk_reload()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st.alcd(mag=6, reserve=200); await settle(st)
        assert st._acct_live(0) == 6
        st._acct_wrote(0, 6)                       # the node writes $WEAP + $AMMO,0,6
        st._last_spent = 0
        st.alcd(mag=32, reserve=200); await settle(st)     # answer 1: the $WEAP reset, back to the compiled clip
        assert st._acct_live(0) == 6, "the reset echo must not move the account"
        assert st._last_spent == 0, "and must not read as rounds fired"
        st.alcd(mag=6, reserve=200); await settle(st)      # answer 2: our own restore landing
        assert st._acct_live(0) == 6, "the restore echo must not move the account either"
        assert st._last_spent == 0, "the node read its OWN write back as 26 rounds fired -- that is the bench oscillation"
        assert st._acct_echoing(0) is False, "the gun reporting the written number must close the window early"
        st.alcd(mag=5, reserve=200); await settle(st)      # CONTROL: a real round
        assert st._acct_live(0) == 5 and st._last_spent == 1
    asyncio.run(go())


def test_the_echo_never_reaches_the_screen_the_displayed_ammo_does_not_rise():
    """F259 (bench 2026-09-18), display half. Tony, with the account already correct: "it shoots up to 32
    while shooting and it shoots up again once, it syncs on trigger release." While a write is in flight the
    gun briefly reports the magazine its own `$WEAP` reset gave it, and the screen rendered that raw number.
    The node knew the true count throughout.

    CONTROL: outside the window the gun's number goes straight to the screen, exactly as before."""
    async def go():
        st, mgr, clock = mk_reload()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st.alcd(mag=6, reserve=200); await settle(st)
        assert st.ammo == 6 and st.reserve == 200
        st._acct_wrote(0, 6, 200)                       # the node writes $WEAP + $AMMO,0,6,200
        st.alcd(mag=32, reserve=384); await settle(st)   # the $WEAP reset, reported by the gun
        assert st.ammo == 6, "the reset magazine reached the screen -- that is the flash to 32 Tony saw"
        assert st.reserve == 200, "and the reset reserve reached it too"
        st.alcd(mag=6, reserve=200); await settle(st)    # our own restore landing, which closes the window
        assert st.ammo == 6
        st.alcd(mag=5, reserve=200); await settle(st)    # CONTROL: a real round, outside the window
        assert st.ammo == 5, "outside the window nothing changes: the gun's number goes straight to the screen"
    asyncio.run(go())


def test_the_echo_window_expires_so_a_write_the_gun_never_answers_hands_the_slot_back():
    """The window is a backstop, not a latch: a write the gun never confirms must not leave the node holding
    an opinion about the magazine for the rest of the life."""
    async def go():
        st, mgr, clock = mk_reload()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st.alcd(mag=6, reserve=200); await settle(st)
        st._acct_wrote(0, 6)
        clock.advance(st.ACC_ECHO_S + 0.01)
        assert st._acct_echoing(0) is False
        st.alcd(mag=30, reserve=200); await settle(st)
        assert st._acct_live(0) == 30, "and the gun wins again"
    asyncio.run(go())


def test_a_press_the_gun_has_not_answered_is_outstanding_until_it_does_or_it_expires():
    """engine.js gates its CLOCK-driven writes on this (`shotInFlight`): a write takes 30-90 ms to reach the
    gun, so one sent while a round is on its way out would land after it and put the round back."""
    async def go():
        st, mgr, clock = mk_reload()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st.alcd(mag=20, reserve=200); await settle(st)
        assert st._acct_outstanding(0) is False
        st._inject_rx("$BUT,0,1,*"); await settle(st)
        assert st._acct_outstanding(0) is True, "a press the gun has not reported must read as a round in flight"
        st.alcd(mag=19, reserve=200); await settle(st)
        assert st._acct_outstanding(0) is False, "and the gun reporting it must clear that"
        st._inject_rx("$BUT,0,1,*"); await settle(st)
        assert st._acct_outstanding(0) is True
        clock.advance(st.TRIGGER_NO_FIRE_S + 0.1)
        assert st._acct_outstanding(0) is False, "a press the gun NEVER answers must expire, not latch"
    asyncio.run(go())


def test_a_press_the_stage_says_cannot_fire_is_never_booked():
    """`_await_shot`'s stand-down table already models every press that produces no round. The account books a
    round only where one is owed, so a dry trigger, a swap or a stun cannot walk the magazine down."""
    async def go():
        st, mgr, clock = mk_reload()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st.alcd(mag=10, reserve=200); await settle(st)
        st.switching = {"at": st.now(), "from": 0}
        st._inject_rx("$BUT,0,1,*"); await settle(st)
        assert st._shot_acct[0]["fired"] == 0, "a press mid-swap produces no round, so it must not book one"
        st.switching = None
        st._inject_rx("$BUT,0,1,*"); await settle(st)
        assert st._shot_acct[0]["fired"] == 1, "CONTROL: the same press with nothing in the way IS booked"
        st._shot_acct[0] = {"mag": 0, "fired": 0, "at": 0.0, "res": None, "echo_until": 0.0, "echo_expect": None}
        st._inject_rx("$BUT,0,1,*"); await settle(st)
        assert st._shot_acct[0]["fired"] == 0, "a dry trigger on an empty magazine must not book a round"
    asyncio.run(go())


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
        await flush_fake_ammo(st, mgr)
        st._arm_life("test"); await settle(st)   # F209: past spawn protection, so the kill below lands
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
        assert st.reloading is None and st._prev_ammo == {} and st._prev_reserve == {}, "revive clears slot memory"
        assert st.reserve == 20, "revive keeps the last reserve the gun reported"
        # a full mag with reserve: the gun ignores the pull
        st._on_rx("$ALCD,30,100,0,20,0,*")
        st.bundle["spawn"] = [f for f in st.bundle["spawn"]] + ["$AMMO,0,30,20,1,*"]
        st._on_rx("$BUT,2,1,*")
        assert st.reloading is None and any("mag full" in l["text"] for l in st.log)
    asyncio.run(go())


def test_alt_on_an_empty_slot_1_only_reloads_with_easy_reload():
    """Bench 2026-09-17 (match 592e444eff): "the alt button is reloading the charge rifle" -- with an
    empty slot 1, compile.py now maps ALT to fn 98 (inert) unless the player wears easy_reload, which
    keeps ALT -> fn 97 (RELOAD) on purpose (loadout.md §2 `alt_reload`). Mirrors engine.js `_altPressed`.
    The stage's fixed player normally carries two weapons (`recompile`), so `_slot_count` is patched here
    to simulate the empty slot the real one-weapon loadout leaves."""
    async def go():
        st, mgr, clock = mk_reload()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st._slot_count = lambda: 1
        st._on_rx("$ALCD,10,100,0,20,0,*")
        st._on_rx("$BUT,1,1,*")
        assert st.reloading is None, "no easy_reload: ALT (fn 98) does nothing"
        # S50: the live shape is the per-player override, not the retired perk pick.
        st.player["loadout"]["overrides"] = {"easy_reload": True}
        st._on_rx("$BUT,1,1,*")
        assert st.reloading and st.reloading["slot"] == 0, "easy_reload override: ALT (fn 97) reloads"
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


# ── review 2026-09-19: the low-health write is HELD (HURT_DEBOUNCE_S), mirroring engine.js HURT_DEBOUNCE_MS,
# and a death landing before the hold elapses cancels it outright, exactly as engine.js's office test does ──
def test_a_death_inside_the_debounce_hold_cancels_the_queued_low_health_write():
    """`_on_rx` is synchronous; the debounced write only runs once the event loop gets a turn, at `settle()`.
    So queuing the killing hit BEFORE `settle()` reproduces "the death landed inside the window" without
    needing a real clock -- CONTROL: `_pending_hurt_write` is true the instant the crossing is queued."""
    async def go():
        st, mgr, clock = mk_gain()
        await live(st)
        clock.advance(1.0)
        st._on_rx("$HP,45,0,0,*"); await settle(st)                  # armour gone, health full: sync
        clock.advance(1.0)
        n = mark(mgr)
        st._on_rx("$HP,12,0,0,*")                                    # crosses under 15: QUEUED, not yet on the wire
        assert st._pending_hurt_write, "CONTROL: the alert is sitting in its debounce hold"
        assert st.bundle["cues"]["hurt"] not in since(mgr, n), "still held -- nothing on the wire yet"
        st._on_rx("$HP,0,0,0,*")                                     # the killing hit lands inside the hold
        await settle(st)
        assert not st._pending_hurt_write, "death clears the pending flag"
        assert st.bundle["cues"]["hurt"] not in since(mgr, n), "a stray low-health write must not reach a dead gun"
    asyncio.run(go())


def test_f374_a_hit_during_the_hold_restarts_it_and_a_heal_drops_the_line():
    """F375 (engine.js `_onHp`): the low-health line goes out only after HURT_DEBOUNCE_S with no damaging `$HP`.
    The sleeps are recorded, so the restart shows as a second wait of exactly the time the hit moved the end."""
    async def go():
        st, mgr, clock = mk_gain()
        sleeps: list[float] = []
        async def rec(s: float) -> None:
            sleeps.append(round(s, 3))
        st.sleep = rec
        await live(st)
        clock.advance(1.0)
        st._on_rx("$HP,45,0,0,*"); await settle(st)
        clock.advance(1.0)
        n = mark(mgr); sleeps.clear()
        st._on_rx("$HP,12,0,0,*")                                    # crosses under 15: held
        clock.advance(0.3)
        st._on_rx("$HP,8,0,0,*")                                     # the burst goes on: the hold restarts
        await settle(st)
        assert HURT in sleeps and sleeps[sleeps.index(HURT) + 1:][:1] == [0.3], f"the hold, then 0.3 s more for the later hit: {sleeps}"
        assert st.bundle["cues"]["hurt"] in since(mgr, n), "then the line goes out"
        # CONTROL: a heal back over the threshold during the hold drops it
        st2, mgr2, clock2 = mk_gain()
        await live(st2)
        clock2.advance(1.0)
        st2._on_rx("$HP,45,0,0,*"); await settle(st2)
        clock2.advance(1.0)
        n2 = mark(mgr2)
        st2._on_rx("$HP,12,0,0,*")
        st2._on_rx("$HP,30,0,0,*")                                   # healed before the hold ended
        await settle(st2)
        assert st2.bundle["cues"]["hurt"] not in since(mgr2, n2), "no longer critical: no line"
    HURT = S.HURT_DEBOUNCE_S
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
        # F121/A23 + F209: the live table is the `sir_pool` take the node writes behind spawn protection --
        # the head ships the cell disarmed (fn 28).
        #
        # F253 (bench 2026-09-18): the live function is fn 23, NOT fn 24. fn 24 does no damage AND leaves
        # the victim's gun manufacturing a fake $HIR every 5.07 s until the next $SPAWN, so a stunned
        # player was told they were being shot by nobody. fn 23 is the real effect: accuracy 100 -> 0 in
        # the same millisecond, no pool moves, the gun still fires but every shot misses, and it recovers
        # by itself in about 3 s. Tony's name for it is smoke, not stun.
        live_rows = [f for f in st.bundle["sir_pool"][0] if f.startswith("$SIR,8,0,")]
        assert live_rows and live_rows[0].split(",")[4] == "23", (
            f"the <8,0> cell is fn 23 (smoke: accuracy to 0, no pool moves) when stun is on: {live_rows}")
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
        # Polish review: engine.js's disarm carries STUN_PLAY, the cue on the gun that just went dark
        # (`$PLAY,X17,4,6,,,,,*`), in the SAME write as the $AMMO frames -- the stage must too.
        assert "$PLAY,X17,4,6,,,,,*" in since(mgr, n), f"the disarm must carry the stun cue: {since(mgr, n)}"
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
        head = [f for f in c.bundle["sir_pool"][0] if f.startswith("$SIR,8,0,")]   # F121 rebuild: the take carries the table
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
        st._arm_life("test"); await settle(st)   # F209: past spawn protection
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


def _strip_comments(src: str) -> str:
    """`src` with `//` and `#` line comments blanked out, so a guard reads CODE and not prose.

    This repo keeps re-learning one fault: a guard that reads text will eventually be satisfied, or
    defeated, by somebody's DESCRIPTION of the behaviour instead of the behaviour. It has happened here
    with a heading check, with a screenshot manifest, and with the string-presence assertion in
    `test_f206_...` that could not see an ordering at all. The order guard below inherited the same fault
    one rung up: its markers matched inside comments, so the engine lane had to avoid writing a marker
    verbatim while EXPLAINING it, or a correct code order would have gone red. A guard that people must
    write around is worse than no guard, because it looks like cover.

    Quote-aware, so a `//` inside a string or a `#` inside one survives: enough for two small function
    bodies, and deliberately not a parser. It does not track a template literal or a triple-quoted string
    across a line break; neither body has one, and `_fn_body` fails loudly if either moves."""
    out = []
    for line in src.split("\n"):
        quote = None
        cut = len(line)
        i = 0
        while i < len(line):
            ch = line[i]
            if quote:
                if ch == "\\":
                    i += 2
                    continue
                if ch == quote:
                    quote = None
            elif ch in "'\"`":
                quote = ch
            elif ch == "#" or (ch == "/" and line[i + 1:i + 2] == "/"):
                cut = i
                break
            i += 1
        out.append(line[:cut])
    return "\n".join(out)


def _fn_body(src: str, start: str, end: str) -> str:
    """One function's CODE, from its signature line to `end`, with comments stripped. Raises if it moved.

    Used to assert the ORDER of two steps inside one function. A search over the whole file would happily
    match the same two markers in two unrelated places and call it an ordering; a search that kept the
    comments would match a marker in a sentence about the marker (see `_strip_comments`)."""
    i = src.index(start)
    j = src.index(end, i + len(start))
    return _strip_comments(src[i:j])
_JS_KEYWORDS = {"if", "for", "while", "switch", "catch", "do", "else", "return", "constructor",
                "function", "try"}


# `^  ` is exactly the class-body indent ONCE THE CALLER SLICES TO THE CLASS BODY (below): `\s*` anywhere
# before the name would swallow deeper indentation and pull local function calls (`      paint(next,
# ...)`) in as methods, and without the slice it would also pull in the two MODULE-level functions above
# the class (`handoverPool`, `toks`) that happen to share this file's two-space indent for their own
# statements. A `get`/`set` prefix must be followed by real whitespace, or `setReady(` parses as `set` +
# `Ready`. The generator star is non-capturing: it is never read, only the name at group 1 is.
_METHOD = _re.compile(r"^  (?:static\s+)?(?:async\s+)?(?:(?:get|set)\s+)?(?:\*\s*)?(\w+)\s*\(", _re.M)

_CLASS_DECL = _re.compile(r"^(?:export\s+)?class\s+Engine\s*\{", _re.M)


def _engine_methods() -> set[str]:
    """Names declared at one indent level inside the Engine class body -- and ONLY the class body.

    2026-09-12 polish pass: the original pattern only saw `  foo(` / `  async foo(`, so it missed all
    thirteen ACCESSORS — and accessors are where engine.js keeps its config rules (`maxHp`, `maxArmor`,
    `respawnDelayMs`, `respawnType`, `respawnGate`, `stunMs`, `timeLimitMs`). A rule the scan cannot see
    is a rule the stage can silently fail to model, which is the one thing this file exists to catch.
    `static`, `get`/`set` and generator (`*name`) declarations are all read now.

    2026-09-12 polish pass 2: the regex used to run over the WHOLE FILE, so the two module-level
    functions above the class (`handoverPool`, `toks`) were exposed to it too -- today only their `if (`
    lines match (filtered by `_JS_KEYWORDS`), but the first plain call statement either one grew at the
    same two-space indent would have been read as a new Engine method. Slice from the class declaration
    (to its closing brace, if one is found; else to EOF) before scanning.
    """
    text = _ENGINE_JS.read_text(encoding="utf-8")
    decl = _CLASS_DECL.search(text)
    assert decl, f"no `class Engine {{` declaration found in {_ENGINE_JS} -- pinned to the name so a " \
                  f"helper class declared above it can never be the one sliced"
    body = text[decl.start():]
    closes = list(_re.finditer(r"^\}$", body, _re.M))
    if closes:
        body = body[:closes[0].end()]      # the FIRST column-0 `}` closes THIS class; a later one is the next declaration
    methods = {m.group(1) for m in _METHOD.finditer(body)} - _JS_KEYWORDS
    assert methods, f"no methods found inside the Engine class body in {_ENGINE_JS} -- the slice is wrong, not the file"
    return methods


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
    # asymmetric scanner fallback is a phone-side policy accessor; GunStage models one configured respawn path
    "respawnAutoTeams", "timedRespawn",
    # transport / MC session: the stage talks to a gun, never to Mission Control
    "onMcMessage", "onBleConnected", "onBleDropped", "setWsState", "hydrate", "statusBody", "resume",
    "resumeSchedule", "_event", "_probe", "_checkEcho", "ackEnd", "onResultPush", "resultWait",
    # bench 2026-09-17: BrxLink's flap count, passed through to the HUD and MC; no game rule reads it
    "setGunFlapping",
    # F293: BrxLink's `$VERSION` headset probe. The frames it sends and the headset state it shows the HUD; no game rule
    # reads either, and the stage has no BrxLink
    "linkProbeFrames", "setHeadsetJoin",
    # F347: engine drains its queued play jobs; the stage serialises them with `_play_lock` in `write`
    "_drainPlayWrites",
    # F289: what the node tells MC about owed spawn protection (respawn fact + statusBody); no game rule reads it
    "_protectOwedMs",
    # F272: node/BrxLink liveness and locked-head recovery. The stage is itself the deterministic gun driver,
    # has no phone BLE connection to diagnose, and never models a batch resolving false after a radio-only link.
    "_sendGunProbe", "_gunLockTick", "_beginGunRecovery", "_gunRecoveryWrite", "_gunRecoveryTick",
    # A47 (bench 2026-09-17): dispatches MC's operator `control` (match/player checks, relink hook). The stage has no
    # MC and no BrxLink; its RESYNC GUN and RESPAWN buttons call `_operator_resync` and `revive` directly
    "_operator",
    # pl3 (2026-09-17): `_operatorAct` is `_operator`'s body split out so every outcome reaches MC as an `operator_result`
    # fact. The stage has no MC and no facts; its refusals are mirrored inline in `_operator_resync`.
    "_operatorAct", "_operatorResult", "_operatorResyncProbeStarted", "_operatorResyncProbeSent",
    # pl3 (2026-09-17): retries a BrxLink batch that resolved false. The stage's `write` has its own retry (it
    # reconnects and sends again on an exception), and its fake and real managers never resolve a batch false.
    "_writeMust",
    # pl4 (2026-09-17): what a spawn/revive batch that resolved false leaves behind (no repeat, re-arm, pool
    # `write_lost`). The stage's batches never resolve false, for the same reason as `_writeMust`.
    "_writeLife",
    # pl4 (2026-09-17): the HUD's OVERHEAT word (`overheatShown`): display only. The stage has no OVERHEAT word;
    # the game rule, the lockout line that exempts no_fire, is mirrored in `_heat_blocks_fire` (HEAT_LOCKOUT = 99).
    # Maint review 2026-09-17 renamed the pair so the names say which is which: `_heatBlocksFire` is the
    # mechanic (mirrored), `_overheatOnHud` is the display (pinned here).
    "_heatLockFrame", "_heatLockPress", "_overheatOnHud",
    # app lifecycle + the A26 pick debounce: the stage has no foreground/background and no MC to pick from
    "_awake", "commitPick",
    # F202: local picker/storage operation; GunStage has no phone-owned gun binding to clear.
    "forgetGun",
    # field 2026-09-17: the kill banner's victim name, resolved from MC's `feedback`; the stage has no MC and no banner
    "victimName",
    # S57 (2026-09-23, docs/ir-callouts.md): the IR callout bus's receiver -- presentation only, no game rule.
    # It never books a death/kill/score (MC's own facts already did that), only a HUD chip and a locally-picked
    # cue; the stage has no HUD and no cue picker to mirror either half against.
    "_onIrCallout", "_irKillConfirmed", "_takeKillMatch",
    # 2026-09-24 (docs/announcer.md): an MC alert or the node's clock warning as one announcer-queue item. The stage has
    # no MC and no HUD; its only announcer lines are the hill callouts, whose queue behaviour alone (the later hill word
    # preempts, the tick waits out the clip) is what `_hill_busy_until` already mirrors.
    "_announceAlert", "_announceStatus", "_card",
    # 2026-09-24 (docs/announcer.md, "The three lanes"): the HUD's alert lanes, written as each event arrives. Presentation
    # only: they write no gun frame, say no line and move no score, and the stage has no HUD to draw them on.
    "_lanesOf", "_heroUntil", "_laneTakeover", "_laneKill", "_laneUpdate", "_laneName", "_laneObj", "_laneFeed",
    # 2026-09-24 (docs/announcer.md, "The gun's audio FIFO"): the phone's model of the gun's audio queue and the
    # must-hear $PLAYX flush. NOT yet ported: the stage's own writes do not model the FIFO, and its heartbeat does not
    # skip a beat that would sound over the refill. A stage/phone divergence on audio timing only, no game rule.
    "_audioWrite", "_clipLen", "_sayMust", "_audioSync", "_audioHit", "_shieldLoopPeriod",   # the pool voice lines, the same queue; the stage speaks them at once
    # X3 (2026-09-24): the fill-last write order IS mirrored, inline in `spawn`/`revive`; the helper's other half marks
    # the phone schedules sounds after the fill, and the stage has no audio model (see `_audioWrite` above)
    "_writeSpawnBurst",
    # bench 2026-09-17: the phone's day/night HUD skin and its per-MC-session pick; HUD chrome, no LED or game rule
    "setNight", "ownNightChoice", "_autoNight", "_loadNight", "_storeNight",
    # bench 2026-09-17: the ammo gauge's shot-ready cue ($WEAP token 14 timed from $ALCD); HUD display only, no game rule
    "_fireIntervalMs", "shotCooldown",
    # B5: guards a BLE frame-race (a stale zero-HP echo the gun queued before it processed $SPAWN landing
    # just after a `_spawn`/`_revive` write) against a shooter `latch` the stage has no equivalent of --
    # the bench drives spawn/revive and pool frames deterministically by hand and never races a real echo.
    "_deathPending",
    "_beginReconcile", "_endReconcile", "_reportPossession", "feedback", "alert", "control", "_cue",
    "_beginResync", "_resyncButton", "_resyncDone", "_resyncEvidence", "_resyncNotLive", "_resyncTick",
    # persistence + config application (the stage is configured directly, not by a pushed bundle)
    "_save", "_load", "_set", "_changed", "clearPersisted", "_applyConfig", "_assign", "_write",
    "_savedAmmo", "_restoreAmmo",   # F164: the live counts a reconcile re-arms survive an app restart; the stage never restarts

    "_writeHead", "_writeTeardown", "feedFrame", "reset",
    # B1 (2026-09-12): catches an MC `assign` that re-teams the roster without a config re-push rewriting
    # the gun's $TID. It reads the head `_writeHead` wrote and fires only off `_assign` — both of which
    # are transport/MC-only and already pinned here. The stage is configured directly (no `assign`, no
    # pushed head), so there is no divergence for it to detect.
    "_checkTeamVsHead",
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
    # A56 (S58, docs/spec/powerups.md), behind MC's `--powerups` flag until bench Sitting A passes. PRESENTATION only:
    # the spawn announcer and the HUD's view (`_puTick`, `powerupView`, `_puNextInMs`). GAME STATE, but not portable
    # yet: the claim, the grant, the end of an item and the overshield all hang off a powerup station's advert (its
    # median RSSI and its `taker` byte, like `setStations` above) and the MATCH CLOCK's spawn schedule (like `goLiveT`
    # below), and the stage models neither. The gun-facing writes (`_puGrantWeapon`/`_puGrantShield`/`_puEnd`) are the
    # part to port, as a hand-driven stage button, once Sitting A has proved the spare slot and the `$BMAP` cycle.
    "_puReset", "_puItems", "_puElapsed", "_puAdvertOf", "_puClaimable", "_puNextInMs", "_puMedian", "_puThreshold",
    "_puStation", "_altCycle", "_nextAltSlot", "_puObserve", "_puClaimTick",
    "_puTakerCheck", "_puTick", "_puGrantWeapon", "_puGrantShield", "_puAmmo", "_puEnd", "_puShieldFrame", "_puDeath",
    # Tony 2026-09-24, "straight to trigger" + "select should equip it": the heavy goes onto the trigger with its head
    # `$WEAP` re-sent, SELECT toggles it, and the empty magazine / a death / a reconcile hand the trigger back. All of it
    # hangs off a held item, which only a powerup station's grant (above) creates, so it is unportable for the same reason.
    "_puHeadWeap", "_puOnHeavy", "_puLoadoutSlot", "_puCounts", "_puEquip", "_puSelectPressed", "_puRevive", "_puRearmRows", "_puBackResend", "_puBackTick",
    # Tony 2026-09-24, the overshield: the grant burst (spawn protection, the raised `$PSET`, the `$LIFE`), its protection
    # end, and the `$PSET` restore. They hang off a granted overshield, which only the station grant above creates.
    "_osPset", "_osProtectFrames", "_osTick", "_osRestore",
    "powerupView",
    # S42 (2026-09-17): node-driven recoil. Every one of these reads `weaponRow(id).recoil` off the
    # CATALOG (`_activeWeaponId` -> `this.catalog`) -- and `weaponRow`/`catalog` are already pinned
    # above ("kitting / loadout browser -- HUD surface, no stage equivalent"): the bench configures a
    # weapon's `$WEAP` frame directly, by hand, with no catalog or loadout behind it, so there is no
    # per-weapon `recoil` profile for a stage-side model to read. A hand-fed profile parameter would let
    # a bench script exercise the state machine (step/recover/write/verify) in isolation, but that is a
    # new bench feature, not a straight port, and is left for the bench-parity backlog rather than
    # guessed at here.
    # F259 (2026-09-18) folded the ladder into two states and added `_recoilProfile`, which reads that shape
    # off the SAME catalog row -- so it is unmirrored for the same reason as the rest of this group.
    # S55's `_nativeAccuracyHold` arbitrates the phone's t4 writer against native fn-23 smoke/EMP. The
    # stage has neither that writer nor a recoil HUD, so there is no competing accuracy owner to arbitrate.
    # ⚠ Its neighbour, the magazine account (`_acctLive` / `_acctWriting` / `_acctPress` / `_acctAmmo`), is
    # NOT recoil and IS mirrored: the stage's own stun restore carries a magazine count and had the same
    # staleness in it.
    "recoilEnabled", "_activeWeaponId", "_recoilProfile", "_recoilArm", "_recoilStep", "_recoilTick",
    "_recoilFlush", "_recoilVerify", "_recoilWrite", "_recoilObserve", "_nativeAccuracyHold",
    # `_headAccuracy` reads t21 off the compiled `$WEAP` so `_recoilArm` can tell whether the gun is already
    # holding the weapon's crisp value. Only the accuracy writer asks that question, and the stage has none.
    "_headAccuracy",
    # Merge 2026-09-17: `_holdAccuracyWrites` stands the accuracy writer down while a spawn, revive,
    # operator resync or stun write owns `$AMMO`. It exists only to gate the writer pinned just above,
    # so it has nothing to mirror: with no stage-side accuracy model there is nothing to hold.
    "_holdAccuracyWrites",
    # F68 (2026-09-17): the periodic team-colour repaint rides the SAME headset-paint machinery already
    # pinned above ("LED readout internals: the stage models the READOUT, not each paint step" --
    # `_headsetFlash`/`_headsetRest`) plus the role lookup (`_activeRole`/`_roleSeq`, behind the already-
    # pinned `_setRole`). The bench has no equivalent "what should the headset be showing right now"
    # question to answer on an interval.
    "_teamRepaintTick",
    # ---- accessors (2026-09-12: newly VISIBLE to the scan, not newly unmirrored) ----
    # config values the stage resolves into plain attributes rather than same-named accessors:
    # `stun_s` is the stage's `stunMs` under the unit it works in (seconds). `self.max_hp`/
    # `self.max_armor` (F213, 2026-09-16) are set in `recompile()` from `mc.frames.head_pool()` on the
    # freshly compiled bundle -- the same pool-off-the-`$PSET` reading engine.js's `_headPool` does --
    # so both sides carry per-player overrides and the body_armor perk the same way. Mirrored in
    # substance, not in name; `_headPool` itself is inline in `recompile()`, not a separate method.
    # S45: `maxShield` joins them -- `self.max_shield`, set in the same place from `mc.frames.head_shield()`
    # (`$PSET` t5, the shield CEILING). Same reading, same source, a plain attribute rather than a getter.
    "maxHp", "maxArmor", "maxShield", "stunMs", "_headPool",
    # match CLOCK: the stage has none. The operator drives spawn, revive and end by hand from the
    # bench script, which is why `startAt`/`tick`/`_endLocal` are pinned above; these are the config
    # readers that only a self-running clock would need.
    "respawnDelayMs", "respawnType", "respawnGate", "timeLimitMs", "goLiveT", "endT",
    # display helpers over `this.team` / the equipped weapon — HUD surface, no gun-side behaviour
    "teamTid", "teamKey", "weaponName",
    # `stunEnabled` is deliberately ABSENT: the stage has `stun_enabled`, and it must stay paired.
    # S53 (the smoke tell, fn 23): HUD-only -- these write NOTHING to the gun. `_smokeObserve`/`_smokeCheck`
    # read the phone's OWN `$ALCD` accuracy report and `$HIR` pairing to hold the ONE accuracy pill the HUD
    # renders; `_aimView` is that pill's read model. The stage has no accuracy-pill HUD and no `$ALCD`-driven
    # aim state to hold it in, so there is nothing gun-facing here to port. S16 (poison), built in the same change,
    # IS ported (`_dot_spec`/`_poison_hit`/`_poison_tick`/`_poison_strike`/`_poison_clear`), because that half
    # writes real `$LIFE` frames to the gun.
    "_smokeObserve", "_smokeCheck", "_smokeClear", "_aimView",
    # S56 "what hit me": names the weapon behind a hit off the roster/catalog HIR magnitude table and keeps a
    # per-life damage taken/dealt ledger for the HUD (reads `weaponRow`/`nameOf`, both already pinned above,
    # plus MC's own `feedback{kind:'hit'}` relay). Writes nothing to the gun and changes no game rule -- not
    # `alive`, not `hp`, not scoring -- only what the HUD shows about who or what hit this player and who this
    # player hit, so there is nothing here for the stage, which predicts the GUN, to port.
    "_resolveHitWeapon", "_lethalWeapon", "_lifeBookHit", "_lifeBookDot", "_freshLedger", "_resetLifeLedger",
    "_ledgerSnapshot", "_bookDealtHit", "_lifeForFact",
}


def test_f206_every_stage_write_puts_the_team_back_after_a_pset_like_the_phone():
    """F206 (bench 2026-09-16): any `$PSET` clears the gun's team until a `$TID` follows; `$SPAWN` and `$SIR` do not.
    engine.js `_write` -> `_tidAfterPset` restores it in ONE place; the stage's `write` must do the same, or a
    bench run from the stage tests a different gun."""
    from test_stage import mk, tid_follows_pset
    js = _ENGINE_JS.read_text(encoding="utf-8")
    # ORDER, not presence. A string-presence assertion cannot see an ordering, and the ordering is the
    # behaviour: insert the `$TID` first and a denied `$PSET` dropped afterwards leaves the `$TID` behind as
    # an orphan, because `$TID` is a KNOWN command the deny filter has no reason to take. The gun would read
    # a team byte for a `$PSET` that never arrived. Both `_write` bodies must therefore DENY FIRST, then
    # restore the team, and this guard reads both bodies rather than trusting either comment.
    for label, body, deny, tid in (
            ("engine.js `_write`", _fn_body(js, "  _write(frames, why, options = undefined, playScheduled = false, onSent = null, mustHear = false) {", "\n  }"),
             "deniedCommand(f)", "frames = this._tidAfterPset(frames);"),
            ("stage.py `write`", _fn_body(_STAGE_PY.read_text(encoding="utf-8"),
                                          "    async def write(self, frames: list[str], why: str", "\n    def "),
             "protocol.is_denied(f)", "self._tid_after_pset(frames)")):
        assert deny in body and tid in body, \
            (f"{label}: the deny filter and the $TID restore are not both in this function's CODE. A "
             "comment mentioning either one does not count -- `_fn_body` strips comments on purpose.")
        assert body.index(deny) < body.index(tid), \
            (f"{label} restores the team BEFORE it drops denied frames. A denied $PSET would then leave an "
             "orphan $TID on the gun. Deny first, then $TID -- and keep the two sources in the same order, "
             "or a bench run from the stage predicts a phone that does something else.")

    async def run():
        st, mgr = mk(tid=2)
        await st.connect("FA:KE:00:00:00:01")
        await st.arm()
        head = tx(mgr)
        assert head.index("$TID,2,*") > max(i for i, f in enumerate(head) if f.startswith("$PSET,")), \
            "the head already ends on $TID after its $PSET: nothing added"
        assert head.count("$TID,2,*") == 1
        st.bundle["cues"]["countdown"] = ""
        for step in (st.spawn, st.revive):
            n = len(tx(mgr))
            await step(); await settle(st)
            new = tx(mgr)[n:]
            psets = [i for i, f in enumerate(new) if f.startswith("$PSET,")]
            assert psets, f"{step.__name__}: the bundle carries a scream pool, so a $PSET rides this write"
            # An ORDERING, not an index (`test_stage.tid_follows_pset`). F206 was fixed on two branches at
            # once and the merge keeps both cures: the compiled burst re-asserts `$TID` after `$SPAWN`, and
            # `_tid_after_pset` covers a write that carries none. The F209 twin now puts eleven disarmed
            # `$SIR` rows between the `$PSET` and that `$TID`, so the old next-index assertion was pinning a
            # frame order rather than the rule. The count pins the other half: the two cures must not both
            # fire, or the gun reads a redundant team byte in the burst it can least afford one.
            assert tid_follows_pset(new, 2), new
            assert new.count("$TID,2,*") == 1, new
        # a write with a $PSET and NO $SPAWN gets the team too
        n = len(tx(mgr))
        await st.write([st.bundle["pset_pool"][0], "$AMMO,0,1,1,1,*"], "lone pset"); await settle(st)
        assert tx(mgr)[n:] == [st.bundle["pset_pool"][0], "$TID,2,*", "$AMMO,0,1,1,1,*"]
        # a $TID already after the $PSET wins and is not doubled; a write with no $PSET is untouched
        n = len(tx(mgr))
        await st.write([st.bundle["pset_pool"][0], "$TID,3,*"], "flip"); await st.write(["$SPAWN,,*"], "spawn only")
        await st.write([st.bundle["pset_pool"][0]], "after flip"); await settle(st)
        assert tx(mgr)[n:] == [st.bundle["pset_pool"][0], "$TID,3,*", "$SPAWN,,*", st.bundle["pset_pool"][0], "$TID,3,*"]
    asyncio.run(run())


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


def test_pl4_an_energy_weapon_watchdog_covers_a_held_recharge_that_lands_3_9_s_after_the_pull():
    """engine.js `_reloadDeadline` (pl4, Energy Rifle bench 2026-09-17): a hold refills the whole cell 3.5-3.9 s
    after the pull. An energy weapon waits at least ENERGY_REFILL_MAX_S + RELOAD_GRACE_S from the pull."""
    js = (pathlib.Path(__file__).resolve().parents[2] / "app" / "src" / "engine.js").read_text(encoding="utf-8")
    assert f"ENERGY_REFILL_MAX_MS = {int(GunStage.ENERGY_REFILL_MAX_S * 1000)};" in js

    async def go():
        st, mgr, clock = mk_reload()
        await st.connect(GUN); await st.arm(); await st.spawn(); await settle(st)
        st.player["loadout"]["weapons"][0] = {"weapon_id": "energy_rifle"}
        st.alcd(mag=10, reserve=600); await settle(st)
        st.reload(); await settle(st)
        assert st._reload_deadline() >= st.reloading["at"] + 3.9 + 0.6, st.reloading
        st._end_reload("fired")
        st.player["loadout"]["weapons"][0] = {"weapon_id": "assault_rifle"}
        st.reload(); await settle(st)
        assert st._reload_deadline() == st.reloading["at"] + st.reloading["s"] + max(0.6, st.reloading["s"] * 0.5), "control: a bullet weapon keeps its ceiling"
    asyncio.run(go())


# ======================================================================================================
# Maint review 2026-09-17 -- what the method scan above CANNOT see
# ======================================================================================================

#: Fields published by engine.js `state()` INLINE (not through a method) that the stage deliberately does
#: not mirror. `_engine_methods()` reads method declarations, so an inline `state()` field is invisible to
#: it: a game rule that ships as one of these would slip past the whole file. Each entry needs a reason.
KNOWN_UNMIRRORED_STATE = {
    # MC's mid-match leaderboard, pushed to the node as `feedback`/`score` and read back out for the HUD's
    # results overlay. It is MC's own arithmetic arriving over the wire, not a rule the node computes, and
    # the stage has no MC session to receive it (`onMcMessage` is already pinned in KNOWN_UNMIRRORED). A
    # stage-side copy would be a hand-typed fiction of MC's board, which is worse than not having one.
    "scoreRows",
}


def _state_fields() -> set[str]:
    """The top-level keys engine.js `state()` returns, read from the source text.

    Slices from `  state() {` to the first line that is exactly the method's closing brace, then takes every
    `name:` at the object-literal indent. `^      (\\w+):` is that indent: a deeper one is a nested object
    (`preflight`, `station`), and a shallower one is not inside the literal at all.
    """
    text = _ENGINE_JS.read_text(encoding="utf-8")
    i = text.index("\n  state() {")
    body = text[i:]
    body = body[:body.index("\n  }\n")]
    return {m.group(1) for m in _re.finditer(r"^      (\w+):", body, _re.M)}


def test_a_state_field_the_method_scan_cannot_see_is_still_pinned():
    """Every name in KNOWN_UNMIRRORED_STATE must still be an engine.js `state()` field AND still absent from
    the stage. Both halves fail loudly: a renamed or deleted field leaves a lying pin, and a field somebody
    HAS mirrored should be dropped from the set so it keeps shrinking."""
    fields, stage = _state_fields(), _stage_methods()
    stage_text = _STAGE_PY.read_text(encoding="utf-8")
    for name in sorted(KNOWN_UNMIRRORED_STATE):
        assert name in fields, (
            f"`{name}` is pinned as an unmirrored engine.js `state()` field but `state()` no longer publishes "
            f"it -- find the new name and re-pin it, or drop the entry")
        snake = _snake(name)
        assert snake not in stage and f'"{snake}"' not in stage_text, (
            f"`{name}` is mirrored on the stage now (`{snake}`) -- delete it from KNOWN_UNMIRRORED_STATE")
    assert "scoreRows" in fields, "the results overlay's only input vanished from `state()`"


# ---- the stand-down table (engine.js `STAND_DOWN` / GunStage `_STAND_DOWN`) ---------------------------

_STAND_DOWN_CALL = _re.compile(r"_standDown\(\[([^\]]*)\]", _re.S)
_STAND_DOWN_CALL_PY = _re.compile(r"_stand_down\(\(([^)]*)\)", _re.S)


def _table_names(text: str, marker: str, end: str) -> list[str]:
    """The ordered names declared in a stand-down table, read from the source text. `marker` is the table's
    declaration line and `end` the line that closes it; only the first quoted word of each row is a name."""
    body = text[text.index(marker) + len(marker):]
    body = body[:body.index(end)]
    return [m.group(1) for m in _re.finditer(r"""^\s*[\[(]['"](\w+)['"]""", body, _re.M)]


def test_every_stand_down_name_used_is_a_name_the_table_declares():
    """The table only removes the copies if a call site cannot invent a name. `_standDown` ignores an unknown
    name on purpose -- throwing at a player mid-match would be worse than the missing guard -- so the typo has
    to be caught HERE instead, on both sides.

    CONTROL: the tables are non-empty and the scan finds real call sites, so an empty set cannot pass."""
    js = _ENGINE_JS.read_text(encoding="utf-8")
    py = _STAGE_PY.read_text(encoding="utf-8")
    js_names = _table_names(js, "const STAND_DOWN = [", "\n];")
    py_names = _table_names(py, "_STAND_DOWN: tuple[tuple[str, Callable[[GunStage], bool]], ...] = (", "\n    )")
    assert len(js_names) >= 10 and len(py_names) >= 5, (js_names, py_names)
    assert set(py_names) <= set(js_names), (
        "the stage declares a stand-down name engine.js does not: " + ", ".join(sorted(set(py_names) - set(js_names))))
    # the stage's subset keeps the engine's ORDER, so `_operator_resync`'s refusals come out in the phone's order
    assert py_names == [n for n in js_names if n in set(py_names)], (py_names, js_names)

    js_calls = _STAND_DOWN_CALL.findall(js)
    py_calls = _STAND_DOWN_CALL_PY.findall(py)
    assert len(js_calls) >= 7, f"only {len(js_calls)} `_standDown([...])` call sites found in engine.js"
    assert len(py_calls) >= 3, f"only {len(py_calls)} `_stand_down((...))` call sites found in stage.py"
    for call in js_calls:
        for name in _re.findall(r"""['"](\w+)['"]""", call):
            assert name in js_names, f"engine.js `_standDown([{call.strip()}])` names `{name}`, which the STAND_DOWN table does not declare"
    for call in py_calls:
        for name in _re.findall(r"""['"](\w+)['"]""", call):
            assert name in py_names, f"stage.py `_stand_down(({call.strip()}))` names `{name}`, which `_STAND_DOWN` does not declare"


# ======================================================================================================
# The RELOAD nag and SHIELDS ONLINE -- the two cues the NODE owes the player, mirrored from engine.js `_dryPull` / `_onHp`
# ======================================================================================================

def _nag_live(st, clock):
    """Live, past spawn protection, with an EMPTY magazine and reserve still behind it."""
    st._inject_rx("$LCD,45,70,0,0,30,90,*")
    st._inject_rx("$ALCD,30,100,0,192,0,*")
    st._inject_rx("$ALCD,0,100,0,192,0,*")


def _pull(st, clock):
    st._inject_rx("$BUT,0,1,*"); clock.advance(0.2); st.poll()
    st._inject_rx("$BUT,0,0,*"); clock.advance(0.2); st.poll()


def test_the_reload_nag_cadence_matches_the_phone():
    """The stage predicts the phone, so the two must agree on the numbers, not only on the shape."""
    js = _ENGINE_JS.read_text(encoding="utf-8")
    assert f"const RELOAD_NAG_FIRST = {S.RELOAD_NAG_FIRST}, RELOAD_NAG_EVERY = {S.RELOAD_NAG_EVERY};" in js


def test_the_fifth_dry_pull_says_reload_and_then_every_third():
    """The RELOAD nag (Tony, bench 2026-09-18): pulls 1-4 of a dry spell are the player finding out; the 5th and every
    3rd after it say RELOAD. CONTROL: the loaded gun above fires none of them, and a reload starts the
    count over -- so a count that simply never resets, or one that nags on every pull, fails here."""
    async def go():
        st, mgr, clock = mk_gain()
        await live(st)
        nag = st.bundle["cues"]["reload_nag"]
        _nag_live(st, clock)
        n = mark(mgr)
        for i in range(1, 5):
            _pull(st, clock); await settle(st)
            assert since(mgr, n).count(nag) == 0, f"pull {i} is silent"
        _pull(st, clock); await settle(st)
        assert since(mgr, n).count(nag) == 1, "the 5th pull speaks"
        _pull(st, clock); _pull(st, clock); await settle(st)
        assert since(mgr, n).count(nag) == 1, "pulls 6 and 7 are silent"
        _pull(st, clock); await settle(st)
        assert since(mgr, n).count(nag) == 2, "the 8th pull speaks"
        # a reload starts the spell over
        st._inject_rx("$ALCD,30,70,0,162,0,*"); st.poll()
        assert st._dry_pulls == 0, "the magazine came back"
        st._inject_rx("$ALCD,0,70,0,162,0,*"); st.poll()
        for i in range(1, 5):
            _pull(st, clock); await settle(st)
            assert since(mgr, n).count(nag) == 2, f"pull {i} of the new spell is silent"
        _pull(st, clock); await settle(st)
        assert since(mgr, n).count(nag) == 3, "the 5th pull of the new spell speaks"
    asyncio.run(go())


def test_the_nag_is_silent_when_the_magazine_is_not_what_stopped_the_round():
    """Every other reason a pull produced nothing -- a dry reserve, an overheat lockout, a stun -- says
    RELOAD would be the wrong instruction. CONTROL: the same nine pulls with reserve and no lockout speak
    three times, so an assertion of silence cannot pass by the pulls simply not landing."""
    async def go():
        st, mgr, clock = mk_gain()
        await live(st)
        nag = st.bundle["cues"]["reload_nag"]
        # (a) a dry reserve: nothing to reload TO
        st._inject_rx("$LCD,45,70,0,0,30,90,*")
        st._inject_rx("$ALCD,30,100,0,0,0,*"); st._inject_rx("$ALCD,0,100,0,0,0,*")
        n = mark(mgr)
        for _ in range(9):
            _pull(st, clock)
        await settle(st)
        assert since(mgr, n).count(nag) == 0, "no reserve, no nag"
        # (b) overheated: the lockout is what stopped the round
        st._inject_rx("$ALCD,0,100,0,192,99,*"); st.poll()
        assert st._heat_blocks_fire(), "setup: the lockout is on"
        st._dry_pulls = 0
        n = mark(mgr)
        for _ in range(9):
            _pull(st, clock)
        await settle(st)
        assert since(mgr, n).count(nag) == 0, "an overheated gun is not told to reload"
        assert st._dry_pulls == 0, "and nothing was counted"
        # CONTROL: cooled, with reserve, the same nine pulls nag three times (5, 8, 11)
        clock.advance(S.GunStage.HEAT_STALE_S + 1.0)
        st._inject_rx("$ALCD,0,100,0,192,0,*"); st.poll()
        n = mark(mgr)
        for _ in range(11):
            _pull(st, clock)
        await settle(st)
        assert since(mgr, n).count(nag) == 3, since(mgr, n).count(nag)
    asyncio.run(go())


def test_the_grant_that_fills_the_shield_says_shields_online_once():
    """S45 (bench 2026-09-17 step 7): `$LIFE` grants refill the shield and the gun plays nothing for
    it. The node says SHIELDS ONLINE on the grant that reaches the `$PSET` t5 ceiling -- and drops the
    per-grant `shield_up` line on that frame, because the gun plays one clip at a time (F57's rule).
    CONTROL: the grants on the way up still fire `shield_up`, and a spawn (shield always 0) fires neither."""
    async def go():
        st, mgr, clock = mk_gain(max_shield=70)      # S45: a shield ceiling is a host field now, not a free constant
        await live(st)
        online, up = st.bundle["cues"]["shield_online"], st.bundle["cues"]["shield_up"]
        assert st.max_shield == 70, "setup: the compiled head arms a shield ceiling"
        n = mark(mgr)
        clock.advance(1.0)
        st._on_rx("$HP,45,70,0,*"); await settle(st)                  # the empty shield a spawn leaves
        assert online not in since(mgr, n) and up not in since(mgr, n), "a spawn is not a recharge"
        clock.advance(1.0)
        n = mark(mgr)
        st._on_rx("$HP,45,70,40,*"); await settle(st)
        assert since(mgr, n).count(up) == 1 and online not in since(mgr, n), "on the way up it is an ordinary grant"
        clock.advance(1.0)
        n = mark(mgr)
        st._on_rx("$HP,45,70,70,*"); await settle(st)
        assert since(mgr, n).count(online) == 1, "the grant that reached the ceiling speaks"
        assert up not in since(mgr, n), "and not the per-grant line under it"
        clock.advance(1.0)
        n = mark(mgr)
        st._on_rx("$HP,45,70,70,*"); await settle(st)
        st._on_rx("$HP,45,70,70,*"); await settle(st)
        assert online not in since(mgr, n), "the frames that merely report a full shield are silent"
        # broken and recharged is its own piece of news
        clock.advance(1.0)
        st._on_rx("$HP,45,70,20,*"); await settle(st)
        clock.advance(1.0)
        n = mark(mgr)
        st._on_rx("$HP,45,70,70,*"); await settle(st)
        assert since(mgr, n).count(online) == 1, "the next refill speaks again"
    asyncio.run(go())


def test_a_game_with_no_shield_ceiling_grants_without_announcing_a_full_charge():
    """`max_shield > 0` is the load-bearing half of the test: with no shield configured, `0 >= 0` would read
    every grant as a completed charge. CONTROL: the same grant on a head that DOES arm a shield is still an
    ordinary `shield_up` until it reaches the ceiling (above)."""
    async def go():
        st, mgr, clock = mk_gain()
        await live(st)
        st.max_shield = 0                                             # a head with no readable `$PSET` shield
        online, up = st.bundle["cues"]["shield_online"], st.bundle["cues"]["shield_up"]
        clock.advance(1.0)
        st._on_rx("$HP,45,70,0,*"); await settle(st)
        clock.advance(1.0)
        n = mark(mgr)
        st._on_rx("$HP,45,70,20,*"); await settle(st)
        assert online not in since(mgr, n), "nothing to fill, nothing to announce"
        assert since(mgr, n).count(up) == 1, "it is still a shield grant"
    asyncio.run(go())


# ======================================================================================================
# S29 -- the shield RECHARGE, mirrored from engine.js `_shieldTick` / `_shieldLoopTick` / `_onHp`
# ======================================================================================================

def mk_shields(**profile):
    """A stage whose game IS the shields preset (armour 0), so `shield_regen_on` is true and the bench can
    rehearse a cycle. Without it nothing ever grants shield and the whole mechanic is unreachable."""
    st, mgr, clock = mk_gain(**profile)
    st.set_profile(shields=True)
    return st, mgr, clock


def shield_cues(st) -> dict[str, str]:
    c = st.bundle["cues"]
    return {k: c[k] for k in ("shield_down", "shield_charging", "shield_online", "shield_loop", "shield_up")}


def grants(mgr, n) -> int:
    # F264 v3: `PROBE_LIFE` (`$LIFE,0,0,0,*`) is ALSO a `$LIFE` frame -- the cure's own dead-gun probe,
    # not a shield grant. Filtered out here (app/test/cues.test.mjs's own `grants()` filters the same
    # frame on the node side), or every heartbeat/spawn probe during a shield test would count as one.
    return len([f for f in since(mgr, n) if f.startswith("$LIFE,") and f != PROBE_LIFE])


async def shield_run(st, mgr, clock, seconds: float) -> None:
    """Advance the clock at the stage server's own cadence. The FAKE GUN answers the `$LIFE` grants itself
    (`fake.FakeTagger`'s `LIFE` handler, token 3: clamp the shield at the `$PSET` ceiling and self-emit `$HP`),
    exactly as the hardware does -- so this drives the clock and nothing else."""
    end = clock.t + seconds
    while clock.t < end - 1e-9:
        clock.advance(min(0.05, end - clock.t))
        st.poll()
        await settle(st)


SHIELD_GRANTS = 4   # S.SHIELD_REGEN_GRANTS (F349: a full pool in this many grants), spelled out so a change fails loudly
SHIELD_LOOP_S_TEST = S.SHIELD_LOOP_S   # the heartbeat period the ordering test makes due by hand


def gun_says(st, frame: str) -> None:
    """F348: a pool frame the test puts in the GUN's mouth, with the fake gun's own pools set to match first. The
    fake's pools are what its later `$LIFE` answers report, so a shield the test breaks must be broken on the fake
    too, or the recharge's first grant would echo the full pool the spawn fill left there."""
    t = frame.split(",")
    for fake in st.mgr.taggers.values():
        fake.hp, fake.armor, fake.shield = int(t[1]), int(t[2]), int(t[3])
    st._on_rx(frame)


async def shielded(st, mgr, clock):
    """Live in a shields game with the shield full, about to lose it."""
    await live(st)
    assert st.shield_regen_on, "setup: this game recharges shields"
    clock.advance(1.0)
    st.poll(); await settle(st)                                  # F348: flush the fake's queued answers (they carry its pools)
    assert st.shield == st.max_shield, "setup: the spawn filled the shield (F348)"
    gun_says(st, f"$HP,30,0,{st.max_shield},*"); await settle(st)
    assert st.shield == st.max_shield, "setup: charged"


def test_f344_every_shields_life_starts_at_full_shield_like_the_phone():
    """F348 (Tony, live match 2026-09-24: "you can die from a couple hits right after spawn"): engine.js ends every
    spawn and revive burst of a shields game with one additive `$LIFE,0,0,<max>,*`, because `$SPAWN` leaves the pool
    at 0 on hardware. The stage writes the same: the T-0 spawn, a timed revive and a station revive all start full,
    say nothing about it, and stay full when spawn protection (t8 and the protection LIGHT) ends.
    CONTROL: the Standard preset (no shield) writes no pool grant at all."""
    async def go():
        st, mgr, clock = mk_shields()
        fill = f"$LIFE,0,0,{st.max_shield},*"
        c = shield_cues(st)
        await st.connect(GUN)
        await st.arm()
        st.bundle["cues"]["countdown"] = ""
        n = mark(mgr)
        await st.spawn(); await settle(st)
        st.poll(); await settle(st)                                # the fake gun's answers reach the stage
        burst = since(mgr, n)
        assert fill in burst and burst.index(fill) > burst.index("$SPAWN,,*"), burst
        assert st.shield == st.max_shield == 105, "the T-0 spawn starts full"
        for station in (None, 1):
            st._on_rx("$HP,0,0,0,*"); await settle(st)
            assert not st.alive, "setup: down"
            m = mark(mgr)
            await st.revive(station=station); await settle(st)
            st.poll(); await settle(st)
            burst = since(mgr, m)
            assert fill in burst and burst.index(fill) > burst.index("$SPAWN,,*"), (station, burst)
            assert st.shield == st.max_shield, f"the revive starts full (station={station})"
            await shield_run(st, mgr, clock, 3.0)                  # past any spawn protection
            assert st.shield == st.max_shield, "and stays full when protection ends"
        await shield_run(st, mgr, clock, S.SHIELD_REGEN_DELAY_S + 3.0)
        stream = since(mgr, n)
        assert c["shield_online"] not in stream and c["shield_charging"] not in stream, "a spawn fill is not a recharge"
        assert [f for f in stream if f.startswith("$LIFE,") and f != PROBE_LIFE] == [fill] * 3, "one fill per life, no grants"
        # CONTROL: Standard (armour, no shield)
        st2, mgr2, _ = mk_gain()
        await st2.connect(GUN); await st2.arm(); st2.bundle["cues"]["countdown"] = ""
        k = mark(mgr2)
        await st2.spawn(); await settle(st2)
        assert not [f for f in since(mgr2, k) if f.startswith("$LIFE,") and f != PROBE_LIFE], "no pool write without a shield"
    asyncio.run(go())


def test_x3_the_spawn_line_and_the_klaxon_go_before_the_fill_like_the_phone():
    """X3 (integration review 2026-09-24): engine.js writes the fill LAST in the spawn and revive bursts, after the spawn
    line and the klaxon, and `PLAY_GAP_MS` keeps their writes apart. The stage writes the same order."""
    async def go():
        st, mgr, clock = mk_shields()
        fill = f"$LIFE,0,0,{st.max_shield},*"
        cues = st.bundle["cues"]
        await st.connect(GUN); await st.arm()
        cues["countdown"] = ""
        n = mark(mgr)
        await st.spawn(); await settle(st)
        burst = since(mgr, n)
        plays = [i for i, f in enumerate(burst) if f.startswith("$PLAY,")]
        assert len(plays) >= 2 and cues["klaxon"] in burst, f"setup: the spawn line and the klaxon went out: {burst}"
        assert max(plays) < burst.index(fill), burst
        st._on_rx("$HP,0,0,0,*"); await settle(st)
        m = mark(mgr)
        await st.revive(); await settle(st)
        burst = since(mgr, m)
        plays = [i for i, f in enumerate(burst) if f.startswith("$PLAY,")]
        assert plays and max(plays) < burst.index(fill), burst
    asyncio.run(go())


def test_live_bench_arming_literals_leave_t23_empty():
    root = pathlib.Path(__file__).resolve().parents[2]
    for name in ("mcp/tools/bench_common.py", "mcp/tools/ally_remeasure.py"):
        source = (root / name).read_text(encoding="utf-8")
        assert "W71,A10,*" not in source, name
        assert "W71,,*" in source, name


def test_x5_x6_x7_the_pool_repair_keeps_armour_the_fill_and_a_no_shield_grant_like_the_phone():
    """X5: a no-armour game keeps the armour the gun reports. X6: a repair before the fill echo keeps the full shield.
    X7: a shield in a no-shield game is not above its ceiling. Mirrors app/test/shield-spawn.test.mjs."""
    async def go():
        st, mgr, clock = mk_shields()
        await live(st)
        st._arm_pending = None
        st._shield_fill_at = clock()                       # X6: the fill is still in flight
        st.hp, st.armor, st.shield = 90, 20, 0             # X5: armour 20 in a game that arms none
        st._pool_repair = {"life": st._life, "attempts": 0, "due_at": 0.0, "read_at": 0.0, "wrote": False}
        n = mark(mgr)
        st._pool_repair_tick(clock()); await settle(st)
        assert "$LIFE,45,20,105,1,*" in since(mgr, n), since(mgr, n)
        assert not GunStage._pools_over(45, 70, 30, {"hp": 45, "armor": 70, "shield": 0}), "X7: no shield ceiling, no fault"
        assert GunStage._pools_over(45, 70, 130, {"hp": 45, "armor": 70, "shield": 105}), "control: a shield above its ceiling"
    asyncio.run(go())


def test_f344_the_spawn_fill_switch_matches_the_phone():
    js = _ENGINE_JS.read_text(encoding="utf-8")
    assert f"export const SPAWN_SHIELD_FULL = {'true' if S.SPAWN_SHIELD_FULL else 'false'};" in js
    assert f"const SHIELD_FILL_ECHO_MS = {int(S.SHIELD_FILL_ECHO_S * 1000)};" in js


def test_f345_a_recharge_writes_a_few_large_grants_and_no_readout_like_the_phone():
    """F349 (field 2026-09-24): a 105 recharge was 11 grants with a readout step or blink behind each, and SHIELDS
    ONLINE queued behind them. The stage writes what the phone does: SHIELD_REGEN_GRANTS grants and no readout
    write on the gun while the recharge runs."""
    async def go():
        st, mgr, clock = mk_shields()
        await shielded(st, mgr, clock)
        n = mark(mgr)
        clock.advance(1.0)
        gun_says(st, "$HP,30,0,0,*"); await settle(st)
        await shield_run(st, mgr, clock, S.SHIELD_REGEN_DELAY_S + 5.0)
        w = since(mgr, n)
        online = st.bundle["cues"]["shield_online"]
        assert online in w, f"SHIELDS ONLINE: {[f for f in w if 'VA6Y' in f]}"
        c = w.index(st.bundle["cues"]["shield_charging"])
        during = w[c:w.index(online) + 1]
        assert len(during) <= S.SHIELD_REGEN_GRANTS + 2, during
        assert not [f for f in during if f.startswith("$GLED,")], f"no readout write during the recharge: {during}"
        assert st.shield == st.max_shield
    asyncio.run(go())


def test_the_recharge_constants_match_the_phone():
    js = _ENGINE_JS.read_text(encoding="utf-8")
    assert f"const SHIELD_REGEN_DELAY_MS = {int(S.SHIELD_REGEN_DELAY_S * 1000)};" in js
    assert f"const SHIELD_REGEN_GRANTS = {S.SHIELD_REGEN_GRANTS};" in js
    assert f"const SHIELD_REGEN_STEP_MS = {int(S.SHIELD_REGEN_STEP_S * 1000)};" in js
    assert f"const SHIELD_REGEN_MAX_GRANTS_SLACK = {S.SHIELD_REGEN_MAX_GRANTS_SLACK};" in js
    assert f"const SHIELD_LOOP_MS = {int(S.SHIELD_LOOP_S * 1000)};" in js
    assert S.SHIELD_REGEN_GRANTS == SHIELD_GRANTS


def test_break_heartbeat_refill_online_is_the_whole_cycle():
    """S29 (Tony 2026-09-18, "shields also never recharged"): nothing granted shield, so no cue below could
    be benched at all. CONTROL: the per-grant `shield_up` line fires for NO part of a refill -- twelve of them
    over a 4 s refill would cut each other off -- and the heartbeat stops on the frame the refill starts."""
    async def go():
        st, mgr, clock = mk_shields()
        await shielded(st, mgr, clock)
        c = shield_cues(st)
        n = mark(mgr)
        clock.advance(1.0)
        gun_says(st, "$HP,30,0,0,*"); await settle(st)                  # the shield takes a hit all the way through
        assert since(mgr, n).count(c["shield_down"]) == 1, "the break speaks"
        assert c["shield_loop"] not in since(mgr, n), "the heartbeat does not land under the break cue"
        await shield_run(st, mgr, clock, 2.1)
        assert since(mgr, n).count(c["shield_loop"]) == 1, "one heartbeat, a clip-length after the break"
        await shield_run(st, mgr, clock, 2.0)
        assert since(mgr, n).count(c["shield_loop"]) == 2, "and it keeps time"
        assert grants(mgr, n) == 0, "nothing granted before the delay is up"
        await shield_run(st, mgr, clock, S.SHIELD_REGEN_DELAY_S + 3.0)
        stream = since(mgr, n)
        assert stream.count(c["shield_charging"]) == 1, "the refill announces itself once"
        after = stream[stream.index(c["shield_charging"]):]
        assert c["shield_loop"] not in after, "the heartbeat stops the moment the recharge starts"
        # EXACTLY the beats the timing predicts (SHIELD_LOOP_S into SHIELD_REGEN_DELAY_S), not "at least".
        # `>=` let a heartbeat written in the SAME tick as `shield_charging` pass, because it lands just
        # before it in the stream and the slice above cannot see it.
        beats = int(S.SHIELD_REGEN_DELAY_S // S.SHIELD_LOOP_S)
        assert stream.count(c["shield_loop"]) == beats, (stream.count(c["shield_loop"]), beats)
        assert st.shield == st.max_shield, "the pool came back"
        assert stream.count(c["shield_online"]) == 1, "and says so, once"
        assert c["shield_up"] not in stream, "never the per-grant line"
        # CEILING, not floor division (S45: the Shields preset's 105 is not a multiple of the 10-point
        # step) -- the last grant overshoots and the firmware clamps at the $PSET ceiling, so a pool
        # that does not divide evenly still needs one more grant than a floor would count.
        assert grants(mgr, n) == SHIELD_GRANTS, "exactly the grants a full pool needs"
        n2 = mark(mgr)
        await shield_run(st, mgr, clock, 4.0)
        assert grants(mgr, n2) == 0 and c["shield_online"] not in since(mgr, n2), "and it stops once the gun says full"
    asyncio.run(go())


def test_damage_restarts_the_clock_and_abandons_a_refill_already_running():
    """The shield comes back only when you break contact -- Callsign's own rule
    (`DetectRecoverShieldCommand._lastHitTime`). CONTROL: the same wait with no hit in it does refill."""
    async def go():
        st, mgr, clock = mk_shields()
        await shielded(st, mgr, clock)
        c = shield_cues(st)
        n = mark(mgr)
        clock.advance(1.0)
        gun_says(st, "$HP,30,0,0,*"); await settle(st)
        await shield_run(st, mgr, clock, S.SHIELD_REGEN_DELAY_S - 1.0)
        assert grants(mgr, n) == 0, "setup: nearly there"
        gun_says(st, "$HP,25,0,0,*"); await settle(st)                  # hit again
        await shield_run(st, mgr, clock, S.SHIELD_REGEN_DELAY_S - 1.0)
        assert grants(mgr, n) == 0, "the hit put the whole delay back"
        await shield_run(st, mgr, clock, 2.0)
        assert grants(mgr, n) > 0, "and it starts once the new quiet window is served"
        # a hit MID-refill abandons it, and the next refill announces itself again
        n2 = mark(mgr)
        st._on_rx(f"$HP,20,0,{max(0, st.shield - 20)},*"); await settle(st)
        await shield_run(st, mgr, clock, 2.0)
        assert grants(mgr, n2) == 0, "the refill stopped"
        await shield_run(st, mgr, clock, S.SHIELD_REGEN_DELAY_S + 3.0)
        assert since(mgr, n2).count(c["shield_charging"]) == 1, "the next refill is its own piece of news"
        assert st.shield == st.max_shield
    asyncio.run(go())


def test_a_stand_down_mid_refill_re_earns_the_delay_and_never_announces_twice():
    """Polish review 2026-09-18. The stand-down abandons a running refill, and the comment beside it says the
    refill "re-earns its delay once the player is back". It did not: `_shield_quiet_at` was left where it was,
    so the next tick found the delay long since served, started again, and said `shield_charging` a SECOND
    time for one refill. A stun, a resync, a reconcile and a BLE blip are all ordinary mid-match events."""
    async def go():
        st, mgr, clock = mk_shields()
        await shielded(st, mgr, clock)
        c = shield_cues(st)
        n = mark(mgr)
        clock.advance(1.0)
        gun_says(st, "$HP,30,0,0,*"); await settle(st)
        await shield_run(st, mgr, clock, S.SHIELD_REGEN_DELAY_S + 0.6)
        assert since(mgr, n).count(c["shield_charging"]) == 1, "setup: a refill is running"
        assert 0 < st.shield < st.max_shield, f"setup: part way up ({st.shield})"
        n2 = mark(mgr)
        st.config["stun"] = {"duration_s": 1}   # the EMP cell, so `_stun` is a stun and not a no-op. Short, so the
        #                                       window below is the RESTAMPED one and not the original serving out.
        st._stun(); await settle(st)
        assert st.stunned is not None, "setup: stunned"
        await shield_run(st, mgr, clock, 0.5)
        assert grants(mgr, n2) == 0, "setup: a disarmed gun is not granted to"
        clock.advance(st.stun_s + 0.1); st.poll(); await settle(st)
        assert st.stunned is None, "setup: the stun has expired"
        n3 = mark(mgr)
        await shield_run(st, mgr, clock, 1.5)
        assert grants(mgr, n3) == 0, "the refill must serve a fresh quiet window, not resume on the next tick"
        assert c["shield_charging"] not in since(mgr, n3), "one refill is one piece of news"
        await shield_run(st, mgr, clock, S.SHIELD_REGEN_DELAY_S + 3.0)
        assert since(mgr, n3).count(c["shield_charging"]) == 1, "and the refill after the new quiet is its own news"
    asyncio.run(go())


def test_the_heartbeat_follows_the_pool_and_stops_when_the_refill_gives_up():
    """Two latches, both wrong in the same place. `_shield_down` means "it BROKE this life", which is right for
    the break cue and wrong for the heartbeat: a hit that abandons a refill half way up leaves 40 of 70 on the
    pool and the gun went on saying the shield was gone. And a refill that GAVE UP is one nothing can fix, so
    replaying the clip every 1.94 s for the rest of the life is noise (polish review 2026-09-18)."""
    async def go():
        st, mgr, clock = mk_shields()
        await shielded(st, mgr, clock)
        c = shield_cues(st)
        clock.advance(1.0)
        gun_says(st, "$HP,30,0,0,*"); await settle(st)
        await shield_run(st, mgr, clock, S.SHIELD_REGEN_DELAY_S + 0.9)
        assert 0 < st.shield < st.max_shield, f"setup: part way up ({st.shield})"
        n = mark(mgr)
        gun_says(st, f"$HP,20,0,{st.shield},*"); await settle(st)     # a hit on HEALTH: the shield stays up
        await shield_run(st, mgr, clock, 6.0)
        assert c["shield_loop"] not in since(mgr, n), "the shield is not GONE, so nothing may say it is"
        # ...and once the cap gives up on a gun that never reports full, the heartbeat stops with it.
        st2, mgr2, clock2 = mk_shields()
        await shielded(st2, mgr2, clock2)
        c2 = shield_cues(st2)
        clock2.advance(1.0)
        st2._shield_quiet_at = clock2.t - S.SHIELD_REGEN_DELAY_S
        st2._prev_shield = st2.shield
        st2.shield = 0; st2._shield_down = True; st2._shield_gave_up = True
        n2 = mark(mgr2)
        await shield_run(st2, mgr2, clock2, 20.0)
        assert c2["shield_loop"] not in since(mgr2, n2), \
            "a refill nothing can fix must not replay the clip for the rest of the life"
    asyncio.run(go())


def test_an_ordinary_game_never_grants_and_a_dead_gun_is_not_refilled():
    """The ARMOUR is the opt-in, not the ceiling (S45): `health.max_shield` is a real host field now,
    so a host can arm a non-zero shield BESIDE ordinary armour (Advanced) -- and that alone must not
    start the mechanic. Only an armour-0 game (`shield_regen_on`) does. Used to be provable only by a
    constant every compiled head armed whether the game wanted shields or not (`$PSET` t5 = 70,
    unconditionally, before this field existed); that "for free" ceiling is gone -- Standard now ships
    0 -- so this rehearses the harder case, a real ceiling that still does not opt in."""
    async def go():
        st, mgr, clock = mk_gain(max_shield=70)      # 45 HP + 70 armour + a shield ceiling: still not a shields game
        await live(st)
        assert st.max_shield == 70 and not st.shield_regen_on, "a non-zero shield beside armour does not opt in"
        n = mark(mgr)
        clock.advance(1.0)
        gun_says(st, "$HP,45,70,0,*"); await settle(st)
        await shield_run(st, mgr, clock, S.SHIELD_REGEN_DELAY_S * 2)
        assert grants(mgr, n) == 0, "no $LIFE beside armour, ceiling or not"
        # ...and the actual default (Standard: 45/70/0, no shield at all) is silent for the trivial reason too
        st0, mgr0, clock0 = mk_gain()
        await live(st0)
        assert st0.max_shield == 0 and not st0.shield_regen_on, "Standard ships no shield ceiling at all"
        # ...and in a shields game, a DEAD gun is not refilled either
        st2, mgr2, clock2 = mk_shields()
        await shielded(st2, mgr2, clock2)
        c = shield_cues(st2)
        clock2.advance(1.0)
        gun_says(st2, "$HP,30,0,0,*"); await settle(st2)
        n2 = mark(mgr2)
        gun_says(st2, "$HP,0,0,0,*"); await settle(st2)
        assert not st2.alive, "setup: dead"
        await shield_run(st2, mgr2, clock2, S.SHIELD_REGEN_DELAY_S * 2)
        assert grants(mgr2, n2) == 0, "nothing is granted to a dead gun"
        # ...nor to a STUNNED one: it is disarmed, and a write there fights the stun restore
        await st2.revive(); await settle(st2)
        gun_says(st2, "$HP,30,0,0,*"); await settle(st2)
        st2.set_profile(stun=60)
        st2._stun(); await settle(st2)
        assert st2.stunned, "setup: stunned"
        n_stun = mark(mgr2)
        await shield_run(st2, mgr2, clock2, S.SHIELD_REGEN_DELAY_S * 2)
        assert grants(mgr2, n_stun) == 0, "nothing is granted to a disarmed gun"
        st2._stun_restore("test"); await settle(st2)
        assert c["shield_loop"] not in since(mgr2, n2), "and the heartbeat stopped with the life"
        # ...and a FRESH life reports shield 0 without ever having crossed it, which is not a break
        await st2.revive(); await settle(st2)
        n3 = mark(mgr2)
        clock2.advance(1.0)
        gun_says(st2, "$HP,30,0,0,*"); await settle(st2)
        assert c["shield_down"] not in since(mgr2, n3), "a shield that STARTS at 0 never crossed 0"
        await shield_run(st2, mgr2, clock2, 2.5)
        assert c["shield_loop"] not in since(mgr2, n3), "so a fresh life does not heartbeat" 
    asyncio.run(go())


def test_a_gun_that_never_reports_full_is_granted_at_a_capped_number_of_times():
    """A refill drives off the gun's `$HP`, so a gun that never reports full would be written at forever.
    CONTROL: the cap STICKS -- clearing the refill alone let the next tick start a fresh counter, so the cap
    counted to ten and began again. A hit earns another go; silence does not."""
    async def go():
        st, mgr, clock = mk_shields()
        await shielded(st, mgr, clock)
        await settle(st)
        n = mark(mgr)
        clock.advance(1.0)
        gun_says(st, "$HP,30,0,0,*"); await settle(st)
        # The gun's OWN ceiling is 0, so every grant lands and the pool still never reaches the 70 the head
        # says it has. That is the cap's second case verbatim: the ceiling is not what the head said.
        mgr.taggers[GUN].cfg_shield = 0
        cap = SHIELD_GRANTS + S.SHIELD_REGEN_MAX_GRANTS_SLACK
        await shield_run(st, mgr, clock, S.SHIELD_REGEN_DELAY_S + 20.0)
        assert grants(mgr, n) == cap, f"a full pool of grants plus the slack, then it gives up ({cap})"
        n2 = mark(mgr)
        await shield_run(st, mgr, clock, 20.0)
        assert grants(mgr, n2) == 0, "and it does not start again on its own"
    asyncio.run(go())


def test_no_heartbeat_is_written_in_the_same_tick_the_recharge_starts():
    """The ordering inside `_shield_tick`, pinned on its own and deterministically: BOTH the heartbeat and the
    refill are made due at the same instant, and `_shield_tick` is called once at it. The refill wins that
    tick. Driving this through the clock cannot pin it -- with the default period a beat is never due at the
    refill instant, and at any period the two land on adjacent 50 ms steps rather than the same one.

    CONTROL: the second call, with only the heartbeat due, does write one -- so this cannot pass by the
    heartbeat being broken outright."""
    async def go():
        st, mgr, clock = mk_shields()
        await shielded(st, mgr, clock)
        c = shield_cues(st)
        clock.advance(1.0)
        gun_says(st, "$HP,30,0,0,*"); await settle(st)                # the shield breaks
        assert st._shield_down, "setup: the shield is down"
        now = st.now()
        st._shield_quiet_at = now - S.SHIELD_REGEN_DELAY_S         # the refill is due NOW
        st._shield_loop_at = now - SHIELD_LOOP_S_TEST              # ...and so is a heartbeat
        n = mark(mgr)
        st._shield_tick(now); await settle(st)
        wrote = since(mgr, n)
        assert c["shield_charging"] in wrote, "the refill starts"
        assert c["shield_loop"] not in wrote, f"and the heartbeat does NOT go out under it: {wrote}"
        # CONTROL: with the refill NOT due, the same moment does write a heartbeat
        st2, mgr2, clock2 = mk_shields()
        await shielded(st2, mgr2, clock2)
        clock2.advance(1.0)
        gun_says(st2, "$HP,30,0,0,*"); await settle(st2)
        clock2.advance(S.PLAY_GAP_MS / 1000 + 0.001)  # let the break cue's play gap end
        now2 = st2.now()
        st2._shield_loop_at = now2 - SHIELD_LOOP_S_TEST
        n2 = mark(mgr2)
        st2._shield_tick(now2); await settle(st2)
        assert c["shield_loop"] in since(mgr2, n2), "control: a heartbeat alone is written"
    asyncio.run(go())


# ======================================================================================================
# A65 (F354) -- a lost damaging hit with only a no-pool word fresh credits that word's TEAM, as engine.js `_death`
# ======================================================================================================
def test_a65_a_lost_damaging_hit_credits_the_team_of_the_fresh_no_pool_word():
    """engine.js `_death` `teamCredit`: no fresh damaging word, and the killing source (the last hit, else the raw
    latch) is a no-pool word, so the death names that word's team and no player. Controls: a damaging word keeps
    its player (no team credit), and our own team's no-pool word credits nobody."""
    emp = "$SIR,8,0,,23,0,0,1,,*"            # compile.py `_with_stun_row`: <8,0> moves no pool

    async def death_after(*frames) -> int | None:
        st, mgr, clock = mk_hill(tid=1)
        await in_play(st)
        st.bundle = {**st.bundle, "head": [*st.bundle["head"], emp],
                     "sir_pool": [[*take, emp] for take in (st.bundle.get("sir_pool") or [])]}
        for f in frames:
            if isinstance(f, float):
                clock.advance(f)                 # seconds, the stage's unit
                continue
            mgr.sessions["stage"].record("rx", f)
            st.poll(); await settle(st)
        assert not st.alive, "control: the $HP,0 killed the player"
        return st.team_credit_tid

    async def go():
        assert await death_after("$HIR,0,8,5,2,0,0,0,*", "$HP,0,0,0,*") == 2, "the enemy EMP's team gets the kill"
        assert await death_after("$HIR,0,1,5,2,45,0,0,*", "$HP,0,0,0,*") is None, "a damaging word keeps its player"
        assert await death_after("$HIR,0,1,5,2,45,0,0,*", "$HIR,0,8,6,2,0,0,0,*", "$HP,0,0,0,*") is None, \
            "F354: a no-pool word after a fresh damaging one does not take the kill"
        assert await death_after("$HIR,0,8,5,1,0,0,0,*", "$HP,0,0,0,*") is None, "our own team's EMP credits nobody"
        # past the 1000 ms hit gate, inside DEATH_LATCH_MS: no hit is booked, and the raw latch alone names the team
        assert await death_after("$HIR,0,8,5,2,0,0,0,*", 1.5, "$HP,0,0,0,*") == 2, "the raw-latch-only path"
        assert await death_after("$HIR,0,8,5,2,0,0,0,*", 2.5, "$HP,0,0,0,*") is None, "control: a stale latch credits nobody"
        assert await death_after("$HIR,0,8,5,3,0,0,0,*", "$HP,0,0,0,*") is None, "a team not on the roster credits nobody"
    asyncio.run(go())
