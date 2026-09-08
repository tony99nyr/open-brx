"""F1: the pool gauge painted onto the three gun LEDs.

Tony's spec: any change to health/armour/shield paints that pool as a bar; after 3-5 s with no
further change, revert to the team colour; a new change inside the window restarts the timer.

The config route was ruled out on hardware first (2026-09-02): ten `$GSET`/`$PSET` candidates all
left the three LEDs moving together, so there is no native gauge to switch on and we paint it.
"""
from _async import own_loop
from brx_mcp import poolgauge as pg
from brx_mcp.gameconfig import GameConfig
from brx_mcp.modes.base import Eliminate, Respawn, SendFrame
from brx_mcp.modes.driver import GameDriver

# This file drains GameDriver's background LED bursts across calls, so it needs a persistent loop --
# a private one, not the process-wide default. See _async.own_loop().
_run = own_loop()


# --- the mapping (pure) ------------------------------------------------------ #

def test_a_full_pool_lights_all_three_segments():
    assert pg.gauge_frame("shield", 70, 70) == f"$GLED,{pg.WHITE},{pg.WHITE},{pg.WHITE},0,10,,*"


def test_an_empty_pool_lights_none():
    assert pg.gauge_frame("health", 0, 45) == f"$GLED,{pg.DARK},{pg.DARK},{pg.DARK},0,10,,*"


def test_one_hp_still_lights_a_segment():
    """A player on 1 HP must not look identical to a player who is out."""
    f = pg.gauge_frame("health", 1, 45)
    assert f.split(",")[1] != str(pg.DARK)


def test_health_shifts_colour_as_it_falls():
    assert pg.health_colour(45, 45) == pg.GREEN
    assert pg.health_colour(20, 45) == pg.YELLOW
    assert pg.health_colour(5, 45) == pg.RED


def test_shield_and_armour_keep_a_constant_hue():
    """Hue identifies WHICH pool; only health encodes urgency in colour.

    led-language.md §3.1 readout mapping (2026-09-07): shield reads WHITE, not teal -- teal was never
    bench-validated as the shield hue."""
    assert pg.pool_colour("shield", 5, 70) == pg.pool_colour("shield", 70, 70) == pg.WHITE == pg.SHIELD_COLOUR
    assert pg.pool_colour("armor", 5, 70) == pg.pool_colour("armor", 70, 70) == pg.PURPLE


def test_ffa_paints_white_on_both_surfaces_regardless_of_team():
    """led-language.md §6 finding #11 / Q19: FFA has no team identity to protect."""
    for tid in (0, 1, 2, 3, None):
        assert pg.team_frame(tid, ffa=True) == f"$GLED,{pg.WHITE},{pg.WHITE},{pg.WHITE},0,10,,*"
        assert pg.headset_team_frame(tid, ffa=True) == f"$HLED,{pg.WHITE},0,,,10,,*"
    # a non-FFA call is unaffected (still the identity map / default fallback)
    assert pg.team_frame(1, ffa=False) == f"$GLED,{pg.BLUE},{pg.BLUE},{pg.BLUE},0,10,,*"


def test_headset_tids_are_shared_0_through_7():
    """led-language.md §6 finding #13: one range, so `compile.py` and `presentation.py` cannot disagree."""
    assert pg.HEADSET_TIDS == tuple(range(8))


def test_readout_bands_highest_first_with_the_readout_mapping_colours():
    shield = pg.readout_bands("shield")
    assert [thr for thr, _f in shield] == [0.66, 0.33, 0.0]
    assert shield[0][1] == pg.segment_frame(pg.WHITE, 3) and shield[1][1] == pg.segment_frame(pg.WHITE, 2)
    assert shield[2][1] == pg.segment_frame(pg.WHITE, 1)
    armor = pg.readout_bands("armor")
    assert armor[0][1] == pg.segment_frame(pg.PURPLE, 3)
    health = pg.readout_bands("health")
    assert health[0][1] == pg.segment_frame(pg.GREEN, 3)
    assert health[1][1] == pg.segment_frame(pg.YELLOW, 2)
    assert health[2][1] == pg.segment_frame(pg.RED, 1)
    # night dims (token 5) without changing which LEDs are lit
    dim = pg.readout_bands("health", night=True)
    assert dim[0][1] == f"$GLED,{pg.GREEN},{pg.GREEN},{pg.GREEN},0,{pg.BRIGHT_DIM},,*"


# --- A16.3: the 7-level bar with a drop animation ---------------------------- #

def test_level_for_never_reports_zero_for_a_nonzero_pool():
    """A16.3: extends `_segments`' "1 HP must not look like dead" rule to the finer 7-level scale."""
    assert pg.level_for(1, 45) == 1
    assert pg.level_for(0, 45) == 0
    assert pg.level_for(45, 45) == 6
    assert pg.level_for(0, 0) == 0
    for hp in range(1, 46):
        assert pg.level_for(hp, 45) >= 1, hp


def test_readout_levels_table_is_exactly_seven_long_per_pool():
    for pool in ("shield", "armor", "health"):
        levels = pg.readout_levels(pool)
        assert len(levels) == 7
        for entry in levels:
            assert len(entry) == 2


def test_readout_levels_partial_levels_blink_whole_levels_do_not():
    """Odd levels (5, 3, 1) are the PARTIAL ones and must carry a real blink frame; even levels
    (6, 4, 2, 0) are WHOLE and must not."""
    levels = pg.readout_levels("shield")
    for level in (5, 3, 1):
        assert levels[level][1] is not None, f"level {level} must blink"
    for level in (6, 4, 2, 0):
        assert levels[level][1] is None, f"level {level} must not blink"


def test_readout_levels_blink_frame_drops_only_the_top_segment():
    levels = pg.readout_levels("shield")
    # level 5: 2 solid + 3rd blinking -- solid lights all 3, blink drops just the 3rd
    assert levels[5][0] == pg.segment_frame(pg.WHITE, 3)
    assert levels[5][1] == f"$GLED,,,{pg.DARK},0,10,,*"
    # level 3: 1 solid + 2nd blinking
    assert levels[3][0] == pg.segment_frame(pg.WHITE, 2)
    assert levels[3][1] == f"$GLED,,{pg.DARK},,0,10,,*"
    # level 1: 1st blinking, down to dark
    assert levels[1][0] == pg.segment_frame(pg.WHITE, 1)
    assert levels[1][1] == f"$GLED,{pg.DARK},,,0,10,,*"
    # level 6/0 are the whole full/empty frames, no blink
    assert levels[6][0] == pg.segment_frame(pg.WHITE, 3) and levels[6][1] is None
    assert levels[0][0] == pg.segment_frame(pg.WHITE, 0) and levels[0][1] is None


def test_readout_levels_health_hue_shifts_as_the_level_falls():
    """Health's per-level hue follows the same bands as `HEALTH_BANDS` (green above 2/3, yellow above
    1/3, else red) as the bar itself shortens, unlike shield/armour's constant hue."""
    health = pg.readout_levels("health")
    assert health[6][0] == pg.segment_frame(pg.GREEN, 3)
    assert health[4][0] == pg.segment_frame(pg.GREEN, 2)
    assert health[3][0] == pg.segment_frame(pg.YELLOW, 2)
    assert health[2][0] == pg.segment_frame(pg.YELLOW, 1)
    assert health[1][0] == pg.segment_frame(pg.RED, 1)
    armor = pg.readout_levels("armor")
    assert armor[6][0] == pg.segment_frame(pg.PURPLE, 3) and armor[2][0] == pg.segment_frame(pg.PURPLE, 1)


def test_readout_levels_night_dims_every_frame_in_the_table():
    for pool in ("shield", "armor", "health"):
        night = pg.readout_levels(pool, night=True)
        day = pg.readout_levels(pool, night=False)
        for lvl in range(7):
            assert night[lvl][0].split(",")[5] == str(pg.BRIGHT_DIM)
            assert day[lvl][0].split(",")[5] == str(pg.BRIGHT_FULL)
            if night[lvl][1] is not None:
                assert night[lvl][1].split(",")[5] == str(pg.BRIGHT_DIM)
                assert day[lvl][1].split(",")[5] == str(pg.BRIGHT_FULL)


def test_segment_frame_lights_only_the_first_n_leds():
    assert pg.segment_frame(pg.WHITE, 0) == f"$GLED,{pg.DARK},{pg.DARK},{pg.DARK},0,10,,*"
    assert pg.segment_frame(pg.WHITE, 1) == f"$GLED,{pg.WHITE},{pg.DARK},{pg.DARK},0,10,,*"
    assert pg.segment_frame(pg.WHITE, 3) == f"$GLED,{pg.WHITE},{pg.WHITE},{pg.WHITE},0,10,,*"


def test_the_apply_gate_is_a_real_apply_and_brightness_is_full():
    """t4 must be an APPLYING value and t5 full: at the dim setting our colour stops dominating."""
    t = pg.gauge_frame("armor", 35, 70).split(",")
    assert t[4] in ("0", "6", "7", "8", "9", "10"), "token 4 must APPLY, not no-op"
    assert int(t[5]) >= 2, "token 5 must be full brightness"


def test_team_colours_are_the_identity_map_matching_the_headset():
    """F33 (2026-09-07 bench, led-language.md §6 #1): tid IS the WIRE palette index (red 0 / blue 1 /
    yellow 2 / green 3, state.py TEAM_DEFS) -- the old table (`{1: BLUE, 2: RED, 3: YELLOW, 4: GREEN}`)
    was offset, so a yellow-team (tid 2) gun painted RED and a red-team (tid 0, not even a key) gun
    painted WHITE. `TEAM_COLOURS` (wire identity) still matches tid for every team."""
    assert pg.TEAM_COLOURS == {0: pg.RED, 1: pg.BLUE, 2: pg.YELLOW, 3: pg.GREEN}
    for tid in (0, 1, 2):
        assert pg.team_frame(tid).split(",")[1] == str(tid)
    # unknown/None tid (a 5th+ team, or no team yet) still falls back cleanly
    assert pg.team_frame(None).split(",")[1] == str(pg.DEFAULT_TEAM_COLOUR)
    assert pg.team_frame(9).split(",")[1] == str(pg.DEFAULT_TEAM_COLOUR)


def test_team_3_paints_purple_but_keeps_its_green_wire_identity():
    """led-language.md §6 finding #11 (2026-09-07 bench, alongside F35): a green head/gun reads as the
    headset's own native hit/out flash at range. Team 3 stays GREEN on the wire (`$TID,3` -- its combat
    identity cannot move, F35) but PAINTS purple on both surfaces; `display_colour()` is the one place
    that decouples the two, so nothing else may assume colour == tid."""
    assert pg.TEAM_COLOURS[3] == pg.GREEN                        # wire identity: unchanged
    assert pg.display_colour(3) == pg.PURPLE == pg.TEAM_DISPLAY_COLOURS[3]
    assert pg.team_frame(3).split(",")[1] == str(pg.PURPLE)
    assert pg.headset_team_frame(3) == f"$HLED,{pg.PURPLE},0,,,10,,*"
    # teams 0-2 are unaffected: the wire identity IS the paint for them
    for tid in (0, 1, 2):
        assert pg.display_colour(tid) == pg.TEAM_COLOURS[tid]
    # an explicit override wins over the default lookup
    assert pg.display_colour(3, overrides={3: pg.TEAL}) == pg.TEAL
    assert pg.display_colour(1, overrides={3: pg.TEAL}) == pg.BLUE   # untouched team unaffected


def test_changed_pool_reports_the_innermost_pool_that_moved():
    # a hit that empties the shield AND bites armour is armour news: that is what is left
    assert pg.changed_pool((45, 70, 5), (45, 60, 0)) == "armor"
    assert pg.changed_pool((45, 70, 70), (45, 70, 60)) == "shield"
    assert pg.changed_pool((45, 0, 0), (40, 0, 0)) == "health"


def test_no_change_paints_nothing():
    assert pg.changed_pool((45, 70, 70), (45, 70, 70)) is None
    assert pg.changed_pool(None, (45, 70, 70)) is None      # first sighting is not a change


# --- the driver wiring ------------------------------------------------------- #



def _driver():
    async def sender(pid, frame):
        pass
    return GameDriver(GameConfig(), {"p1": 1}, sender, announce=lambda s: None)


def _hp(hp, ar, sh):
    return {"raw": f"$HP,{hp},{ar},{sh},*", "cmd": "HP"}


def _frames(actions):
    return [a.frame for a in actions if isinstance(a, SendFrame)]


def test_a_pool_change_emits_a_gauge_frame():
    d = _driver()
    d.feed("p1", _hp(45, 70, 70), 0.0)                 # first sighting: baseline only
    out = _frames(d.feed("p1", _hp(45, 70, 60), 1.0))
    assert any(f.startswith("$GLED") for f in out), out


def test_the_gauge_reverts_to_the_team_colour_after_the_window():
    d = _driver()
    d.feed("p1", _hp(45, 70, 70), 0.0)
    d.feed("p1", _hp(45, 70, 60), 1.0)
    assert not _frames(d.tick(1.5)), "reverted too early"
    out = _frames(d.tick(1.0 + pg.REVERT_AFTER_S + 0.1))
    assert out == [pg.team_frame(1)], out


def test_a_new_change_RESTARTS_the_window_rather_than_queuing():
    d = _driver()
    d.feed("p1", _hp(45, 70, 70), 0.0)
    d.feed("p1", _hp(45, 70, 60), 1.0)
    d.feed("p1", _hp(45, 70, 50), 3.0)                 # inside the window
    assert not _frames(d.tick(1.0 + pg.REVERT_AFTER_S + 0.1)), "old deadline still fired"
    assert _frames(d.tick(3.0 + pg.REVERT_AFTER_S + 0.1)) == [pg.team_frame(1)]


def test_it_reverts_only_once():
    d = _driver()
    d.feed("p1", _hp(45, 70, 70), 0.0)
    d.feed("p1", _hp(45, 70, 60), 1.0)
    d.tick(99.0)
    assert not _frames(d.tick(100.0)), "reverted twice"


def test_a_malformed_HP_paints_nothing():
    d = _driver()
    d.feed("p1", _hp(45, 70, 70), 0.0)
    assert not _frames(d.feed("p1", {"raw": "$HP,,,,*", "cmd": "HP"}, 1.0))


def test_the_gauge_is_off_when_leds_are_disabled():
    import dataclasses

    async def sender(pid, frame):
        pass
    d = GameDriver(dataclasses.replace(GameConfig(), leds=False), {"p1": 1}, sender,
                   announce=lambda s: None)
    d.feed("p1", _hp(45, 70, 70), 0.0)
    assert not _frames(d.feed("p1", _hp(45, 70, 60), 1.0))


# --- event paints: the tuned BURST (3 short flashes back to the team colour) --- #
# Tuned on hardware 2026-09-03. A single frame was not reliably visible: the firmware repaints the
# strip within ~0.33 s, so one paint is a coin flip. The burst is played as a background TASK so a
# 0.44 s light show cannot stall every other player's actions.

def _drain(d, pid="p1"):
    """Await the in-flight burst for `pid` so the frames have actually been sent."""
    t = d._bursts.get(pid)
    if t is not None:
        _run(t)


def test_a_respawn_plays_the_burst_and_ends_on_the_team_colour():
    sent = []

    async def sender(pid, frame):
        sent.append(frame)
    d = GameDriver(GameConfig(), {"p1": 1}, sender, announce=lambda s: None)
    d.tick(0.0)
    _run(d.execute([Respawn("p1")]))
    _drain(d)
    gled = [f for f in sent if f.startswith("$GLED")]
    assert gled.count(pg.event_frame("respawned")) == pg.BURST_FLASHES, gled
    assert gled[-1] == pg.team_frame(1), f"burst must END on the team colour, got {gled[-1]}"


def test_the_burst_is_exactly_three_flashes():
    """Not four. Three flashes in ~0.46 s already sits at the 3-per-second guidance."""
    seq = pg.event_burst("hit_taken", 1)
    assert sum(1 for f, _ in seq if f == pg.event_frame("hit_taken")) == 3
    assert pg.BURST_FLASHES == 3
    assert sum(h for _, h in seq) < 1.0, "the burst must fit inside a one-second window"


def test_a_death_paints_the_died_colour():
    sent = []

    async def sender(pid, frame):
        sent.append(frame)
    d = GameDriver(GameConfig(), {"p1": 1}, sender, announce=lambda s: None)
    d.tick(0.0)
    _run(d.execute([Eliminate("p1")]))
    _drain(d)
    assert pg.event_frame("died") in sent


def test_event_paints_are_off_when_leds_are_disabled():
    import dataclasses
    sent = []

    async def sender(pid, frame):
        sent.append(frame)
    d = GameDriver(dataclasses.replace(GameConfig(), leds=False), {"p1": 1}, sender,
                   announce=lambda s: None)
    d.tick(0.0)
    _run(d.execute([Respawn("p1")]))
    _drain(d)
    assert not [f for f in sent if f.startswith("$GLED")]


def test_a_second_event_INSIDE_the_spacing_is_dropped():
    """Three flashes is the per-second ceiling, so two bursts a second apart would double it."""
    sent = []

    async def sender(pid, frame, reply_window_ms=None):
        sent.append(frame)
    d = GameDriver(GameConfig(), {"p1": 1}, sender, announce=lambda s: None)
    d.tick(0.0)
    _run(d.execute([Respawn("p1")]))
    _drain(d)
    _run(d.execute([Eliminate("p1")]))          # same tick -- inside BURST_MIN_SPACING_S
    _drain(d)
    assert pg.event_frame("died") not in sent, "a second burst fired inside the spacing window"


def test_a_later_event_is_allowed_once_the_spacing_has_passed():
    sent = []

    async def sender(pid, frame, reply_window_ms=None):
        sent.append(frame)
    d = GameDriver(GameConfig(), {"p1": 1}, sender, announce=lambda s: None)
    d.tick(0.0)
    _run(d.execute([Respawn("p1")]))
    _drain(d)
    d.tick(pg.BURST_MIN_SPACING_S + 0.5)        # advance past the window
    _run(d.execute([Eliminate("p1")]))
    _drain(d)
    assert pg.event_frame("died") in sent


def test_the_burst_sends_with_NO_reply_wait():
    """The live sender waits 250 ms after every write by default.

    That stretched the tuned 0.08 s / 0.10 s pattern into 0.33 s / 0.35 s and the whole burst from
    0.44 s to 1.94 s, so what shipped was never the pattern signed off on the bench. The burst must
    ask for no reply wait.
    """
    windows = []

    async def sender(pid, frame, reply_window_ms=None):
        if frame.startswith("$GLED"):
            windows.append(reply_window_ms)
    d = GameDriver(GameConfig(), {"p1": 1}, sender, announce=lambda s: None)
    d.tick(0.0)
    _run(d.execute([Respawn("p1")]))
    _drain(d)
    assert windows and all(w == 0 for w in windows), f"burst reply windows were {windows}"


def test_the_burst_does_NOT_block_the_game_loop():
    """0.44 s of light show must not stall every other player's actions behind one player."""
    import time
    sent = []

    async def sender(pid, frame, reply_window_ms=None):
        sent.append(frame)
    d = GameDriver(GameConfig(), {"p1": 1}, sender, announce=lambda s: None)
    d.tick(0.0)
    t0 = time.monotonic()
    _run(d.execute([Respawn("p1")]))
    assert time.monotonic() - t0 < 0.2, "execute() awaited the whole burst inline"
    _drain(d)


def test_teardown_cancels_a_burst_in_flight():
    """Otherwise it keeps painting a gun that has just been $CLEAR-ed, then writes into a dead link."""
    async def sender(pid, frame, reply_window_ms=None):
        pass
    d = GameDriver(GameConfig(), {"p1": 1}, sender, announce=lambda s: None)
    d.tick(0.0)
    _run(d.execute([Respawn("p1")]))
    task = d._bursts.get("p1")
    assert task is not None
    _run(d.teardown())
    # Assert the TASK was cancelled, not merely that the dict was emptied: clearing the dict alone
    # leaves the coroutine painting a gun that has just been $CLEAR-ed, and this test passed with the
    # cancel removed until it checked the task itself.
    assert task.cancelled() or task.done(), "teardown emptied the dict but left the burst running"
    assert not d._bursts


def test_level_for_rounds_half_UP_like_javascript_not_bankers_like_python():
    """The node computes its own level in JS (`engine.js _readoutLevel`, `Math.round`), MC compiles the
    frame table this level indexes, and the bench stage delegates here to PREDICT the phone. Python's
    round() is round-half-to-EVEN and JS's Math.round is round-half-UP, so a plain round() here puts MC
    and the stage on a different level from the phone at every exact .5 -- e.g. 3/4 of a pool is 4.5
    levels: round(4.5) == 4 in Python, 5 in JS. Narrow, but a stage that disagrees with the phone is
    worse than no stage. Polish round 2026-09-07.
    """
    import math
    for maximum in (44, 45, 70, 24, 6):
        for value in range(0, maximum + 1):
            frac = value / maximum
            js = max(0, min(6, math.floor(frac * 6 + 0.5)))
            if value > 0:
                js = max(js, 1)                     # the shared floor-to-1 rule, mirrored in engine.js
            assert pg.level_for(value, maximum) == js, (value, maximum)
    # the exact half that banker's rounding gets wrong, spelled out so a regression names itself
    assert pg.level_for(33, 44) == 5, "3/4 of a pool is level 5 (JS Math.round(4.5)), not 4"
