"""The standing chaos scenarios: one per mode family, every action in the mix.

Weights are relative. Combat dominates, so a run is mostly a match. The wire and MC faults are
rarer, as they are on the field, but every run of 30+ steps draws several of them.
"""
from __future__ import annotations

from ..registry import Scenario, scenario

# The full action mix. A scenario copies it and changes what it must.
MIX = {
    "hit": 6, "kill": 5, "trade": 2, "team_kill": 1, "respawn": 6,
    "drop": 1.5, "reconnect": 2, "duplicate": 1.5, "reorder": 1, "clock_jump": 1.5,
    "late_join": 0.5, "stale_match_fact": 0.5, "stale_head": 0.5, "garbage": 0.5,
    "mc_restart": 0.6,
}

FFA_TEAMS = [{"team_id": "ffa", "name": "All", "color": "red", "tid": 1}]

scenario(Scenario(
    name="tdm-mixed", mode="tdm", nodes=14, steps=36, finish="end",
    doc="Two teams, every action in the mix, a frag cap high enough that END usually ends it.",
    weights=dict(MIX), config={"scoring": {"frag_limit": 12, "win_by": "kills"}},
    ci_seeds=(1, 2),
))

scenario(Scenario(
    name="tdm-frag-race", mode="tdm", nodes=12, steps=60, finish="end",
    doc="A low frag cap and kill-heavy weights, so the cap ends the match in the middle of the chaos.",
    weights={**MIX, "kill": 9, "trade": 3, "hit": 3}, config={"scoring": {"frag_limit": 5, "win_by": "kills"}},
    ci_seeds=(3,),
))

scenario(Scenario(
    name="ffa-mixed", mode="ffa", nodes=12, steps=36, finish="time",
    doc="Free for all under one $TID, ended by the time limit (MC's clock moves past it).",
    weights=dict(MIX), config={"teams": FFA_TEAMS, "scoring": {"frag_limit": 8, "win_by": "kills"}},
    ci_seeds=(4, 5),
))

scenario(Scenario(
    name="crash-mixed", mode="tdm", nodes=12, steps=36, finish="end",
    doc="The full mix, but MC CRASHES instead of stopping cleanly: the resume reads a snapshot up to 2 s old.",
    weights={**MIX, "mc_restart": 0, "mc_crash": 1.5}, config={"scoring": {"frag_limit": 12, "win_by": "kills"}},
    ci_seeds=(1, 2),
))

scenario(Scenario(
    name="koth-mixed", mode="koth", nodes=12, steps=36, finish="end",
    doc="King of the hill: kills do not decide it. Cumulative possession reports do, merged by max.",
    weights={**MIX, "possession": 4}, ci_seeds=(6, 7),
))
