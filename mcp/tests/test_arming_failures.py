"""A gun whose `$SIR` rows did not land is UNHITTABLE, and that must not be silent.

F11 (bench-proven 2026-09-02): `$CLEAR` wipes the `$SIR` table and a gun with no rows silently
ignores every hit while reporting alive, in-game and healthy. `setup_frames()` orders `$CLEAR` before
the rows, so a COMPLETE bundle is safe; the live-match exposure is a PARTIAL one, because
`GameDriver._send` swallows every send error by design so one gun's BLE hiccup cannot abort a game.
"""
import asyncio

from brx_mcp.gameconfig import GameConfig
from brx_mcp.modes.driver import GameDriver


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _driver(fail_pred):
    """A driver whose sender raises for frames matching `fail_pred`."""
    sent, notes = [], []

    async def sender(pid, frame):
        if fail_pred(frame):
            raise ConnectionError("link dropped")
        sent.append((pid, frame))

    d = GameDriver(GameConfig(), {"p1": 1}, sender, announce=notes.append)
    return d, sent, notes


def test_a_clean_arm_records_no_failures():
    d, _, _ = _driver(lambda f: False)
    assert _run(d._arm_one("p1")) is True
    assert not d.arming_failures
    assert "unhittable" not in d.snapshot()


def test_a_failed_SIR_row_is_retried_and_then_succeeds():
    state = {"fail": True}

    async def sender(pid, frame):
        if frame.startswith("$SIR") and state["fail"]:
            state["fail"] = False          # fails once, then the retry lands
            raise ConnectionError("link dropped")

    notes = []
    d = GameDriver(GameConfig(), {"p1": 1}, sender, announce=notes.append)
    assert _run(d._arm_one("p1")) is True
    assert any("retrying" in n for n in notes), notes
    assert "unhittable" not in d.snapshot()


def test_a_persistently_failing_SIR_row_makes_the_player_UNHITTABLE_and_says_so():
    d, _, notes = _driver(lambda f: f.startswith("$SIR"))
    assert _run(d._arm_one("p1")) is False
    assert "p1" in d.snapshot()["unhittable"]
    assert any("IS NOT ARMED" in n for n in notes), notes


def test_a_failed_NON_sir_frame_is_reported_but_not_fatal():
    d, _, notes = _driver(lambda f: f.startswith("$PLAY"))
    assert _run(d._arm_one("p1")) is True
    assert "unhittable" not in d.snapshot()
    assert d.arming_failures.get("p1")


def test_re_arming_clears_a_previous_failure():
    state = {"fail": True}

    async def sender(pid, frame):
        if frame.startswith("$SIR") and state["fail"]:
            raise ConnectionError("link dropped")

    d = GameDriver(GameConfig(), {"p1": 1}, sender, announce=lambda s: None)
    assert _run(d._arm_one("p1")) is False
    state["fail"] = False
    assert _run(d._arm_one("p1")) is True
    assert not d.arming_failures.get("p1")


# --- "never hit all match" — the cheapest LIVE detector for the F11 class ------ #
# A gun whose $SIR table did not land looks completely healthy: alive, full pools, answering
# $QUERY. The only host-visible symptom is that the player is never hit, which no scoreboard
# would otherwise call out.
from brx_mcp.modes.driver import NEVER_HIT_AFTER_S


def _hit_event():
    return {"raw": "$HIR,0,0,42,2,1,*", "cmd": "HIR"}


def _two_player_driver():
    async def sender(pid, frame):
        pass
    return GameDriver(GameConfig(), {"p1": 1, "p2": 2}, sender, announce=lambda s: None)


def test_nobody_is_flagged_at_kickoff():
    d = _two_player_driver()
    d.tick(0.0)
    assert "never_hit" not in d.snapshot()


def test_a_player_never_hit_is_flagged_once_the_match_is_underway():
    d = _two_player_driver()
    d.tick(0.0)
    d.feed("p1", _hit_event(), 5.0)
    d.tick(NEVER_HIT_AFTER_S + 1)
    snap = d.snapshot()
    assert snap["never_hit"] == ["p2"], snap.get("never_hit")
    assert snap["hits_taken"]["p1"] == 1


def test_a_quiet_opening_is_not_flagged_before_the_threshold():
    d = _two_player_driver()
    d.tick(0.0)
    d.tick(NEVER_HIT_AFTER_S - 1)
    assert "never_hit" not in d.snapshot()


def test_everyone_hit_means_no_flag():
    d = _two_player_driver()
    d.tick(0.0)
    d.feed("p1", _hit_event(), 1.0)
    d.feed("p2", _hit_event(), 2.0)
    d.tick(NEVER_HIT_AFTER_S + 1)
    assert "never_hit" not in d.snapshot()


def test_non_HIR_events_do_not_count_as_being_hit():
    d = _two_player_driver()
    d.tick(0.0)
    d.feed("p1", {"raw": "$HP,45,70,0,*", "cmd": "HP"}, 1.0)
    d.tick(NEVER_HIT_AFTER_S + 1)
    assert "p1" in d.snapshot()["never_hit"]
