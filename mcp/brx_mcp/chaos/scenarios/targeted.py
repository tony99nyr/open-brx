"""Targeted hard scenarios: each one aims at one kind of trouble, with its own extra check.

* trade-cap-tie: two players kill each other on the same tick, and each kill is the frag cap.
* scale-20: twenty nodes through a whole match; every fact arrives, and MC keeps up.
* clock-hostile: phone clocks jump by minutes (both ways) and jitter, and the time limit ends it.
"""
from __future__ import annotations

from ..registry import InvariantError, Scenario, scenario
from ..world import World
from .mixed import FFA_TEAMS, MIX

ACK_P95_LIMIT_S = 1.0     # generous on purpose: test:all runs every job at once
ACK_MAX_LIMIT_S = 3.0


def _tie_on_the_cap(world: World) -> None:
    recap = world.session.last_recap or {}
    w = recap.get("winner") or {}
    tie = w.get("tie") or []
    if len(tie) != 2:
        raise InvariantError("trade_cap_tie", f"a same-tick trade that caps both sides must be a tie, got {w}")


scenario(Scenario(
    name="trade-cap-tie", mode="ffa", nodes=2, finish="none",
    doc="Two players trade on the same millisecond with the frag cap at 1: both reach the cap at once.",
    config={"teams": FFA_TEAMS, "scoring": {"frag_limit": 1, "win_by": "kills"}},
    script=[{"name": "trade", "params": {"a": 0, "b": 1}}],
    checks=(_tie_on_the_cap,), ci_seeds=(1,),
))


def _mc_kept_up(world: World) -> None:
    lat = sorted(x for n in world.nodes for x in n.ack_latency_s)
    if not lat:
        raise InvariantError("scale_latency", "no fact was acknowledged: the latency check measured nothing")
    p95 = lat[int(0.95 * (len(lat) - 1))]
    if p95 > ACK_P95_LIMIT_S or lat[-1] > ACK_MAX_LIMIT_S:
        raise InvariantError("scale_latency", f"{len(lat)} facts: ack p95 {p95 * 1000:.0f} ms, max {lat[-1] * 1000:.0f} ms "
                                              f"(limits {ACK_P95_LIMIT_S * 1000:.0f} / {ACK_MAX_LIMIT_S * 1000:.0f} ms)")


scenario(Scenario(
    name="scale-20", mode="tdm", nodes=20, steps=60, finish="end",
    doc="Twenty nodes, a full match of combat with drops, resends and one MC restart: nothing is lost "
        "and MC acknowledges facts quickly.",
    weights={"hit": 6, "kill": 6, "trade": 2, "respawn": 7, "drop": 1, "reconnect": 2, "duplicate": 1,
             "mc_restart": 0.3},
    config={"scoring": {"frag_limit": 40, "win_by": "kills"}},
    checks=(_mc_kept_up,), ci_seeds=(1,),
))

scenario(Scenario(
    name="clock-hostile", mode="tdm", nodes=12, steps=40, finish="time",
    doc="Clocks jump by minutes, forwards and backwards, and jitter; the time limit ends the match.",
    weights={**MIX, "clock_jump": 6, "clock_jitter": 6, "mc_restart": 0.3},
    config={"scoring": {"frag_limit": 30, "win_by": "kills"}},
    ci_seeds=(1,),
))
