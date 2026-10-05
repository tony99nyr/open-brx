"""Seeded PLAY and FAVOURITE choices before a KOTH match."""
from __future__ import annotations

from ..registry import Scenario, scenario


scenario(Scenario(
    name="picks-mixed", mode="koth", nodes=4, steps=12,
    doc="Vary positive KOTH hold picks and saved FAVOURITE loads before the match starts.",
    setup_script=[
        {"name": "play_pick", "params": {"pieces": {"mode": "builtin:mode:koth"},
                                          "match": {"hold_target_s": 120}}},
        {"name": "favourite_save", "params": {"slot": "base", "name": "Chaos base"}},
        {"name": "field_join", "params": {}},
        {"name": "operator_phase", "params": {"phase": "kit"}},
    ],
    setup_weights={"play_pick": 4, "favourite_save": 1, "favourite_load": 2},
    setup_steps=8,
    weights={"kill": 2, "respawn": 2, "possession": 3, "mc_restart": 0.3},
    ci_seeds=(1,),
))
