"""Shared KOTH desk-proof check (leading underscore: not auto-registered as a scenario module).

`mixed.py`'s koth-mixed (a phone control point) and `koth.py`'s station scenarios (a Stick control
point) both import `koth_winner_check` from here, so a phone hill and a Stick hill are proven against
the SAME rule, from the SAME ledger-derived truth, instead of two hand-written copies drifting apart.
"""
from __future__ import annotations

from ..registry import InvariantError
from ..world import World


def koth_winner_check(world: World) -> None:
    """The hill decides KOTH, never kills: the recap's winner is the team (or the tie) the ledger's own
    max-merged possession reports say should hold it -- from EVERY possession fact the field emitted,
    a phone's beacon or a station's, whatever else happened on the field (kills, drops, restarts).

    Mirrors `scoring.Scorer.possession()` + `.winner()` exactly (the merge by max per (site, tid), the
    match-length clamp, and the round to SECONDS `winner()` actually compares at) so a sub-second gap
    the field never saw never reads as a decided win here either.
    """
    sc = world.session.scorer
    if sc is None:
        return
    facts = world.ledger.delivered(world.nodes, sc.match_id)
    best: dict[int, int] = {}
    for _nid, _seq, ev in facts:
        if ev.get("type") != "possession":
            continue
        for tid, ms in (ev.get("hold_ms") or {}).items():
            best[int(tid)] = max(best.get(int(tid), 0), int(ms))
    if not best:
        return
    cap = (sc.time_limit_s or 0) * 1000 or None
    tid_team = {t["tid"]: team_id for team_id, t in sc.teams.items()}
    held_ms: dict[str, int] = {team_id: 0 for team_id in sc.teams}
    for tid, ms in best.items():
        if tid in tid_team:      # tid 2 (or any tid nobody is on): NEUTRAL, credited to nobody
            held_ms[tid_team[tid]] += min(ms, cap) if cap else ms
    held_s = {k: round(v / 1000) for k, v in held_ms.items()}
    held_s = {k: v for k, v in held_s.items() if v > 0}
    if not held_s:
        return
    winner = (world.session.last_recap or {}).get("winner") or {}
    top = max(held_s.values())
    want = sorted(t for t, s in held_s.items() if s == top)
    if len(want) == 1:
        if winner.get("team_id") != want[0]:
            raise InvariantError("koth_winner", f"the ledger's possession says {want[0]} holds the hill "
                                                f"{held_s}s, MC's winner is {winner}")
    elif winner.get("team_id") is not None or sorted(winner.get("tie") or []) != want:
        raise InvariantError("koth_winner", f"the ledger says a tie {want} {held_s}s, MC's winner is {winner}")
