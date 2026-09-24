"""TEMPLATE: copy this file to `my_scenario.py` in this folder (no leading underscore) and edit it.

A scenario is DATA: a mode, a field size, a step count, and either action weights (the runner picks
actions from a seed) or a fixed `script` (a regression: the same actions every time). Every
invariant in `invariants.py` applies to it automatically.

Run it:      python -m brx_mcp.chaos run --scenario my-scenario --seed 1
Explore it:  python -m brx_mcp.chaos explore --scenario my-scenario --seeds 200
Put it in CI: give it `ci_seeds`. `tests/test_chaos_fuzz.py` runs every scenario's CI seeds.
"""
from __future__ import annotations

from ..registry import Scenario, scenario

REGISTER = False      # set True in your copy: the template itself registers nothing

if REGISTER:
    scenario(Scenario(
        name="my-scenario",
        mode="tdm",                      # tdm | ffa | koth (any MC mode)
        doc="One line: what this scenario hunts for.",
        nodes=12, steps=30,
        finish="end",                    # end | time | none (only a frag cap ends it)
        weights={"kill": 5, "respawn": 5, "drop": 2, "reconnect": 2, "mc_restart": 1},
        config={"scoring": {"frag_limit": 10, "win_by": "kills"}},
        ci_seeds=(),                     # add a seed here once it passes (or once its bug is fixed)
    ))

    # A regression from a field bug: a fixed script, the actions in order. The last step is usually
    # `end` or `time_up`. Take the list from a failing run's trace file (its "actions").
    scenario(Scenario(
        name="my-field-bug", mode="tdm", nodes=4,
        doc="Field 2026-09-24: what happened, in one line.",
        script=[
            {"name": "kill", "params": {"victim": 1, "shooter": 0}},
            {"name": "drop", "params": {"node": 1}},
            {"name": "mc_restart", "params": {}},
            {"name": "reconnect", "params": {"node": 1}},
            {"name": "end", "params": {}},
        ],
        ci_seeds=(1,),
    ))
