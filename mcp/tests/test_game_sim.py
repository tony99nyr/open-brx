"""Smoke test for the narrated game-sim — every mode runs to a game-over."""

import io
import contextlib

from brx_mcp.__main__ import _game_sim, _sim_plan

MODES = ["tdm", "ffa", "infection", "lms", "cs", "domination", "koth", "ctf", "extraction"]


def test_sim_plan_shape_for_all_modes():
    for m in MODES:
        players, overrides, steps = _sim_plan(m)
        assert players and steps
        assert all(len(s) == 3 for s in steps)          # (pid, event, dt)


def test_every_mode_sim_reaches_game_over():
    for m in MODES:
        with contextlib.redirect_stdout(io.StringIO()):
            snap = _game_sim(m)
        assert snap.get("over") is True, f"{m} did not end: {snap}"
        assert snap.get("winner"), f"{m} ended with no winner: {snap}"
