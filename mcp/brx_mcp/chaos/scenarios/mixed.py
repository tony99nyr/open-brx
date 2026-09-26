"""The standing chaos scenarios: one per mode family, every action in the mix.

Weights are relative. Combat dominates, so a run is mostly a match. The wire and MC faults are
rarer, as they are on the field, but every run of 30+ steps draws several of them.
"""
from __future__ import annotations

from ..registry import InvariantError, Scenario, scenario
from ..world import World
from ._koth_shared import koth_winner_check

# The full action mix. A scenario copies it and changes what it must.
MIX = {
    "hit": 6, "kill": 5, "trade": 2, "team_kill": 1, "respawn": 6,
    "drop": 1.5, "reconnect": 2, "duplicate": 1.5, "reorder": 1, "clock_jump": 1.5,
    "late_join": 0.5, "stale_match_fact": 0.5, "stale_head": 0.5, "garbage": 0.5,
    "mc_restart": 0.6,
}

FFA_TEAMS = [{"team_id": "ffa", "name": "All", "color": "red", "tid": 1}]


def kills_winner_check(world: World) -> None:
    """Kills decide TDM/FFA (the whistle, the frag cap or the host END, whichever ends it): the recap's
    winner is the top score, and a tie exactly when two sides are level. `scores_equal_facts` /
    `team_score_equals_facts` already tie MC's own rows to the ledger; this pins `winner()` picking the
    right side (or tie) OFF that already-proven board -- a same-tick cap dead heat (`cap_tie`) is the
    dedicated `trade-cap-tie` scenario's job, not this one, so a run that hit one is skipped here."""
    sc = world.session.scorer
    if sc is None or sc.win_by != "kills" or sc.cap_tie:
        return
    winner = (world.session.last_recap or {}).get("winner") or {}
    if sc.mode == "ffa":
        rows = sc.rows()
        if not rows:
            return
        key = (-rows[0]["kills"], -rows[0]["kd"], rows[0]["deaths"])
        tops = sorted(r["player_id"] for r in rows if (-r["kills"], -r["kd"], r["deaths"]) == key)
        if len(tops) == 1:
            if winner.get("player_id") != tops[0]:
                raise InvariantError("kills_winner", f"the board's top row is {tops[0]}, MC's winner is {winner}")
        elif winner.get("player_id") is not None or sorted(winner.get("tie") or []) != tops:
            raise InvariantError("kills_winner", f"the board ties {tops}, MC's winner is {winner}")
    else:
        scores = sc.team_scores()
        if not scores:
            return
        best = max(scores.values())
        tops = sorted(t for t, s in scores.items() if s == best)
        if len(tops) == 1:
            if winner.get("team_id") != tops[0]:
                raise InvariantError("kills_winner", f"the board's top team is {tops[0]} ({scores}), MC's winner is {winner}")
        elif winner.get("team_id") is not None or sorted(winner.get("tie") or []) != tops:
            raise InvariantError("kills_winner", f"the board ties {tops} ({scores}), MC's winner is {winner}")


scenario(Scenario(
    name="tdm-mixed", mode="tdm", nodes=14, steps=36, finish="end",
    doc="Two teams, every action in the mix, a frag cap high enough that END usually ends it.",
    weights={**MIX, "team_credit_kill": 0.8}, config={"scoring": {"frag_limit": 12, "win_by": "kills"}},
    checks=(kills_winner_check,), ci_seeds=(1, 2),
))

scenario(Scenario(
    name="tdm-frag-race", mode="tdm", nodes=12, steps=60, finish="end",
    doc="A low frag cap and kill-heavy weights, so the cap ends the match in the middle of the chaos.",
    weights={**MIX, "kill": 9, "trade": 3, "hit": 3, "team_credit_kill": 1}, config={"scoring": {"frag_limit": 5, "win_by": "kills"}},
    checks=(kills_winner_check,), ci_seeds=(3,),
))

scenario(Scenario(
    name="tdm-whistle", mode="tdm", nodes=12, steps=40, finish="time",
    doc="TDM proof for the whistle: no frag cap at all, so only the time limit can end it, and the "
        "highest score at that instant takes the match.",
    weights=MIX, config={"scoring": {"frag_limit": None, "win_by": "kills"}},
    checks=(kills_winner_check,), ci_seeds=(1, 2),
))

scenario(Scenario(
    name="ffa-mixed", mode="ffa", nodes=12, steps=36, finish="time",
    doc="Free for all under one $TID: the frag cap ends it early when the chaos reaches it, else the "
        "time limit does (MC's clock moves past it).",
    weights=dict(MIX), config={"teams": FFA_TEAMS, "scoring": {"frag_limit": 8, "win_by": "kills"}},
    checks=(kills_winner_check,), ci_seeds=(4, 5),
))

scenario(Scenario(
    name="crash-mixed", mode="tdm", nodes=12, steps=36, finish="end",
    doc="The full mix, but MC CRASHES instead of stopping cleanly: the resume reads a snapshot up to 2 s old.",
    weights={**MIX, "mc_restart": 0, "mc_crash": 1.5}, config={"scoring": {"frag_limit": 12, "win_by": "kills"}},
    ci_seeds=(1, 2),
))

scenario(Scenario(
    name="koth-mixed", mode="koth", nodes=12, steps=36, finish="end",
    doc="King of the hill: kills do not decide it. Cumulative possession reports from a PHONE control "
        "point do, merged by max.",
    weights={**MIX, "possession": 4}, checks=(koth_winner_check,), ci_seeds=(6, 7),
))
