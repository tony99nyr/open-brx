import asyncio
"""F1: the pool gauge painted onto the three gun LEDs.

Tony's spec: any change to health/armour/shield paints that pool as a bar; after 3-5 s with no
further change, revert to the team colour; a new change inside the window restarts the timer.

The config route was ruled out on hardware first (2026-09-02): ten `$GSET`/`$PSET` candidates all
left the three LEDs moving together, so there is no native gauge to switch on and we paint it.
"""
from brx_mcp import poolgauge as pg
from brx_mcp.gameconfig import GameConfig
from brx_mcp.modes.base import Eliminate, Respawn, SendFrame
from brx_mcp.modes.driver import GameDriver


# --- the mapping (pure) ------------------------------------------------------ #

def test_a_full_pool_lights_all_three_segments():
    assert pg.gauge_frame("shield", 70, 70) == f"$GLED,{pg.TEAL},{pg.TEAL},{pg.TEAL},0,10,,*"


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
    """Hue identifies WHICH pool; only health encodes urgency in colour."""
    assert pg.pool_colour("shield", 5, 70) == pg.pool_colour("shield", 70, 70) == pg.TEAL
    assert pg.pool_colour("armor", 5, 70) == pg.pool_colour("armor", 70, 70) == pg.PURPLE


def test_the_apply_gate_is_a_real_apply_and_brightness_is_full():
    """t4 must be an APPLYING value and t5 full: at the dim setting our colour stops dominating."""
    t = pg.gauge_frame("armor", 35, 70).split(",")
    assert t[4] in ("0", "6", "7", "8", "9", "10"), "token 4 must APPLY, not no-op"
    assert int(t[5]) >= 2, "token 5 must be full brightness"


def test_changed_pool_reports_the_innermost_pool_that_moved():
    # a hit that empties the shield AND bites armour is armour news: that is what is left
    assert pg.changed_pool((45, 70, 5), (45, 60, 0)) == "armor"
    assert pg.changed_pool((45, 70, 70), (45, 70, 60)) == "shield"
    assert pg.changed_pool((45, 0, 0), (40, 0, 0)) == "health"


def test_no_change_paints_nothing():
    assert pg.changed_pool((45, 70, 70), (45, 70, 70)) is None
    assert pg.changed_pool(None, (45, 70, 70)) is None      # first sighting is not a change


# --- the driver wiring ------------------------------------------------------- #

def _run(coro):
    """The suite shares one event loop; recreate it only if something closed it."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("closed")
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


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


def test_a_second_event_CANCELS_the_burst_in_flight():
    """Two events must not interleave their colours on the same strip."""
    sent = []

    async def sender(pid, frame):
        sent.append(frame)
    d = GameDriver(GameConfig(), {"p1": 1}, sender, announce=lambda s: None)
    d.tick(0.0)
    _run(d.execute([Respawn("p1")]))        # starts a burst
    _run(d.execute([Eliminate("p1")]))      # supersedes it
    _drain(d)
    assert pg.event_frame("died") in sent
