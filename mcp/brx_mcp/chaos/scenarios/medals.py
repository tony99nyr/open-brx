"""Scenarios for the medal, honour and after-the-whistle rules of the integration review (2026-09-25).

* medals-late-flush: kill-heavy, with late flushes (a kill stamped seconds in the past) and melee kills,
  so a multi-kill chain meets old kills and BEAT DOWN is awarded (`multi_chain_monotonic`,
  `medals_track_credited_kills`, `honors_full_ledger`).
* frag-cap-team-kills: a low frag cap with team kills from dropped nodes, so team kills flush after the
  whistle (`frozen_team_kill_keeps_victim_death`, `scores_equal_facts`).
"""
from __future__ import annotations

from ..registry import Scenario, scenario
from .mixed import MIX

scenario(Scenario(
    name="medals-late-flush", mode="tdm", nodes=8, steps=40, finish="end",
    doc="Kills, trades, melee kills and late flushed kills (5 to 20 s old), with a few drops and restarts: "
        "a late kill never joins a chain, and the honours match the facts.",
    weights={"kill": 8, "melee_kill": 2, "late_flush": 3, "trade": 1, "respawn": 8, "hit": 2,
             "drop": 0.5, "reconnect": 1, "duplicate": 0.5, "mc_restart": 0.3},
    config={"scoring": {"frag_limit": 40, "win_by": "kills"}},
    ci_seeds=(1, 2),         # both red on the unfixed chain rule (multi_chain_monotonic, honors_full_ledger)
))

scenario(Scenario(
    name="frag-cap-team-kills", mode="tdm", nodes=10, steps=50, finish="end",
    doc="A low frag cap, many team kills and many drops: team kills stamped before the capping kill "
        "flush after the whistle. The victim's death stands; only the killer's -1 is frozen.",
    weights={**MIX, "kill": 7, "team_kill": 4, "drop": 3, "reconnect": 1, "late_join": 0,
             "stale_match_fact": 0, "stale_head": 0, "garbage": 0},
    config={"scoring": {"frag_limit": 5, "win_by": "kills"}},
    ci_seeds=(5, 12),        # both red on the unfixed freeze (frozen_team_kill_keeps_victim_death; 12 also IRON MAN)
))
