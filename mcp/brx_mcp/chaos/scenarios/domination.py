"""Domination desk proof (2026-11-02, F666): three Bluetooth hills, an owned hill scores contested or empty.

The wire fact is the same `possession` tally KOTH sends; only what it counts differs (ownership, not presence), so the
same ledger-derived rule (`_koth_shared.koth_winner_check`) decides it. The stack arms three hills for this mode.
"""
from __future__ import annotations

from ..registry import Scenario, scenario
from ._koth_shared import koth_winner_check

DOMINATION_MIX = {
    "hit": 6, "kill": 5, "trade": 2, "team_kill": 1, "respawn": 6,
    "drop": 1.5, "reconnect": 2, "duplicate": 1.5, "reorder": 1, "clock_jump": 1.5,
    "late_join": 0.5, "stale_match_fact": 0.5, "stale_head": 0.5, "garbage": 0.5,
    "mc_restart": 0.6, "possession": 3, "possession_station": 3,
}

scenario(Scenario(
    name="domination-mixed", mode="domination", nodes=8, steps=36, finish="end",
    doc="Domination on three phone hills, with phone and station tallies in the mix, on top of every wire and MC "
        "fault: the owned-hill time still decides it, whatever else happened.",
    weights=DOMINATION_MIX, checks=(koth_winner_check,), ci_seeds=(3,),
))
