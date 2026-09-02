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
