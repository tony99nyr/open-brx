"""Targeted hard scenarios: each one aims at one kind of trouble, with its own extra check.

* trade-cap-tie: two players kill each other on the same tick, and each kill is the frag cap.
* scale-20: twenty nodes through a whole match; every fact arrives, and MC keeps up.
* clock-hostile: phone clocks jump by minutes (both ways) and jitter, and the time limit ends it.
* multi-kill-ladder: one killer's 11-kill chain, 300 ms apart, a gap over MULTI_KILL_MS, then a new chain.
"""
from __future__ import annotations

from ...mc.types import MEDALS, MULTI_KILL_MS
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


LADDER_CHAIN_1 = 11          # kills 300 ms apart: past the top of the ladder, so the top medal repeats
LADDER_CHAIN_2 = 3           # after a gap over MULTI_KILL_MS: a new chain from 1
LADDER_STEP_MS = 300
LADDER_GAP_MS = MULTI_KILL_MS + 500


def _ladder_want() -> list[tuple[str, ...]]:
    """The medals of each of the killer's kills, from types.MEDALS: first blood on kill 1, the highest
    multi medal whose count the chain has reached, and a streak medal at its exact count."""
    out = []
    chains = list(range(1, LADDER_CHAIN_1 + 1)) + list(range(1, LADDER_CHAIN_2 + 1))
    for i, c in enumerate(chains, start=1):
        m = [x["key"] for x in MEDALS if x["kind"] == "first"] if i == 1 else []
        multi = [x for x in MEDALS if x["kind"] == "multi" and x["count"] <= c]
        if multi:
            m.append(max(multi, key=lambda x: x["count"])["key"])
        m += [x["key"] for x in MEDALS if x["kind"] == "streak" and x["count"] == i]
        out.append(tuple(m))
    return out


def _ladder_script() -> list[dict]:
    steps, at = [], 0
    for v in range(1, LADDER_CHAIN_1 + LADDER_CHAIN_2 + 1):
        if v == LADDER_CHAIN_1 + 1:
            at += LADDER_GAP_MS - LADDER_STEP_MS
        steps.append({"name": "timed_kill", "params": {"victim": v, "shooter": 0, "at_ms": at}})
        at += LADDER_STEP_MS
    return steps + [{"name": "end", "params": {}}]


def _ladder_pinned(world: World) -> None:
    sc = world.session.scorer
    killer = world.players[0]["player_id"]
    want = _ladder_want()
    have = [tuple(k.get("medals") or ()) for k in (sc.kills if sc else []) if k["killer"] == killer]
    if have != want:
        raise InvariantError("multi_kill_ladder", f"P00's kills carry {have}, the ladder says {want}")
    cues = [(fb.get("t"), tuple(fb.get("medals") or ())) for fb in world.nodes[0].feedback if fb.get("kind") == "kill"]
    if len(cues) != len(want):      # every kill here is fresh, synced and connected: each one is cued
        raise InvariantError("multi_kill_ladder", f"P00 got {len(cues)} kill cues for {len(want)} kills")
    if [m for _t, m in sorted(cues)] != want:
        raise InvariantError("multi_kill_ladder", f"P00's kill cues carry {[m for _t, m in sorted(cues)]}, "
                                                  f"the ladder says {want}")


scenario(Scenario(
    name="multi-kill-ladder", mode="ffa", nodes=LADDER_CHAIN_1 + LADDER_CHAIN_2 + 1, finish="end",
    doc="Halo 3's multi-kill ladder (Tony 2026-09-24): one killer's 11-kill chain 300 ms apart climbs the "
        "whole ladder and repeats its top medal, a gap over MULTI_KILL_MS starts a new chain, and the "
        "streak medals fire at their exact counts across both chains.",
    config={"teams": FFA_TEAMS, "scoring": {"frag_limit": 30, "win_by": "kills"}},
    script=_ladder_script(),
    checks=(_ladder_pinned,), ci_seeds=(1,),
))
