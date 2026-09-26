"""KOTH desk proofs for a STATION (Stick) control point, on top of `mixed.py`'s koth-mixed (a phone
control point). Both prove the same rule -- `_koth_shared.koth_winner_check` -- from the same
ledger-derived truth, so a phone hill and a Stick hill are held to one standard, not two.

* koth-station-mixed: the full chaos mix, with a Stick reporting alongside the phones.
* koth-station-reconnect: a scripted proof of the Stick-specific shape Tony asked for -- a report sent
  while the point is CONTESTED (F382: the hold clock pauses, so the total does not grow), then a report
  that queues while the Stick is out of BLE range and reaches MC LATE, only once it reconnects.
"""
from __future__ import annotations

from ..registry import Scenario, scenario
from ._koth_shared import koth_winner_check

# `mixed.MIX` plus the station action: not imported from there, so this file carries no import-time
# dependency on `mixed.py` (and vice versa) -- two ordinary scenario modules, never a cycle.
STATION_MIX = {
    "hit": 6, "kill": 5, "trade": 2, "team_kill": 1, "respawn": 6,
    "drop": 1.5, "reconnect": 2, "duplicate": 1.5, "reorder": 1, "clock_jump": 1.5,
    "late_join": 0.5, "stale_match_fact": 0.5, "stale_head": 0.5, "garbage": 0.5,
    "mc_restart": 0.6, "possession": 3, "possession_station": 3,
}

scenario(Scenario(
    name="koth-station-mixed", mode="koth", nodes=12, steps=36, finish="end",
    doc="King of the hill with a STATION (Stick) control point in the mix too (`source: station`), on "
        "top of every wire and MC fault: the hill still decides it, whatever else happened.",
    weights=STATION_MIX, checks=(koth_winner_check,), ci_seeds=(8,),
))

# node 0: blue (tid 1) phone beacon. node 3 (the field's last node): the Stick, green (tid 3).
KOTH_STATION_SCRIPT = [
    {"name": "possession", "params": {"node": 0, "tid": 1, "add_ms": 4000}},          # blue phone: 4.0 s
    {"name": "possession_station", "params": {"node": 3, "tid": 3, "add_ms": 3000}},  # green Stick: 3.0 s
    {"name": "possession_station", "params": {"node": 3, "tid": 3, "add_ms": 0}},     # CONTESTED: same total resent (F382)
    {"name": "drop", "params": {"node": 3}},                                          # the Stick walks out of BLE range
    {"name": "possession_station", "params": {"node": 3, "tid": 3, "add_ms": 6000}},  # queues while offline: green would be 9.0 s
    {"name": "possession", "params": {"node": 0, "tid": 1, "add_ms": 2000}},          # blue, meanwhile: 4.0 + 2.0 = 6.0 s
    {"name": "reconnect", "params": {"node": 3}},                                     # the Stick reconnects: the queued report reaches MC LATE
    {"name": "end", "params": {}},
]

scenario(Scenario(
    name="koth-station-reconnect", mode="koth", nodes=4, finish="end",
    doc="A Stick control point (station `hold_ms`, `source: station`): one report sent while CONTESTED "
        "(the total does not grow, F382), then a report that queues while the Stick is out of BLE range "
        "and reaches MC only when it reconnects, LATE. The late flush still decides the hill: green's "
        "9.0 s beats blue's 6.0 s.",
    script=KOTH_STATION_SCRIPT,
    checks=(koth_winner_check,), ci_seeds=(1,),
))
