"""The MC soak: back-to-back matches on ONE Mission Control for N minutes, sampling the process's
resident memory after every match, and failing when it keeps growing.

Opt-in, never in the default `test:all`:

    cd mcp && ../.venv/bin/python -m brx_mcp.chaos soak --minutes 10 [--nodes 12] [--max-growth-mb 32]
    BRX_CHAOS_SOAK_MIN=10 ../.venv/bin/python run_tests.py chaos_soak

Each match is a real one on the real stack: push, start, a seeded mix of combat, drops and duplicate
facts, END, then RECAP's NEXT MATCH. The step invariants and `ends_exactly_once` run after every match,
so a soak also catches a scoring fault that only shows after many matches in one process.

The memory rule: after a warm-up (the first quarter of the samples, at least three matches), the
median of the last three samples may not exceed the warm-up peak by more than `max_growth_mb`.
Resident memory comes from /proc on Linux; elsewhere the check uses the peak, which is weaker.
"""
from __future__ import annotations

import asyncio
import os
import pathlib
import random
import shutil
import sys
import tempfile
import time

from . import actions as _actions  # noqa: F401  (registers the built-in actions)
from . import invariants as _invariants  # noqa: F401
from .registry import ACTIONS, INVARIANTS, Scenario
from .stack import until
from .world import World

SOAK_WEIGHTS = {"hit": 5, "kill": 5, "trade": 1, "respawn": 6, "drop": 1, "reconnect": 2, "duplicate": 1}
STEPS_PER_MATCH = 25


def rss_mb() -> float:
    """Resident set size now, in MB (Linux), else the process's peak so far."""
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) / 1024.0
    except OSError:
        pass
    import resource            # Unix only; Windows has neither this nor /proc
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return peak / (1024.0 * 1024.0) if sys.platform == "darwin" else peak / 1024.0


def growth_verdict(samples: list[float], max_growth_mb: float) -> tuple[bool, str]:
    """(ok, why) for a list of per-match RSS samples. Pure, so the rule itself is unit-tested."""
    if len(samples) < 6:
        return True, f"only {len(samples)} samples: too few to judge growth"
    warm = max(3, len(samples) // 4)
    base = max(samples[:warm])
    tail = sorted(samples[-3:])[1]
    grew = tail - base
    why = f"warm-up peak {base:.1f} MB, last median {tail:.1f} MB, growth {grew:+.1f} MB (limit {max_growth_mb:.0f})"
    return grew <= max_growth_mb, why


async def _next_match(world: World) -> None:
    """RECAP's NEXT MATCH on the same MC: push, start, wait for LIVE."""
    s = world.session
    s.next_match()
    s.push_config()
    assert await until(s.all_acked, 8.0), "not every node acked the next match's config"
    info = s.start(runway_s=1)
    world.match_id = info["match_id"]
    assert await until(lambda: s.phase == "live" and all(n.arm_state == "live" for n in world.nodes), 8.0), \
        "the next match never went live"


async def _play(world: World, rng: random.Random) -> None:
    """One match's worth of seeded actions, then END, then the invariants."""
    for _ in range(STEPS_PER_MATCH):
        names = sorted(SOAK_WEIGHTS)
        name = rng.choices(names, [SOAK_WEIGHTS[n] for n in names])[0]
        params = ACTIONS[name].pick(world, rng)
        if params is not None:
            await ACTIONS[name].apply(world, **params)
            await world.settle()
    for n in world.nodes:
        if n._paused:
            n.reconnect()
    await world.settle(6.0)
    await ACTIONS["end"].apply(world)
    await world.settle()
    for inv in INVARIANTS.values():
        if inv.when == "step" or inv.name == "ends_exactly_once":
            inv.check(world)
    world.end_delivered = None
    # The MockNodes keep every envelope they receive (a test inbox). That is the harness's memory, not
    # MC's, and over hundreds of matches it would be most of the growth measured, so it is emptied here.
    for n in world.nodes:
        for inbox in (n.received, n.feedback, n.controls, n.tutorials, n.configs, n.loadout_acks, n.starts,
                      n.acks, n.applies, n.time_res, n.ack_latency_s):
            inbox.clear()
    # The scorer input tap (`medals_track_credited_kills`) holds every scorer and its inputs: this match's are done.
    world.ingests.clear()
    world.scorers.clear()


def run_soak(*, minutes: float, nodes: int = 12, max_growth_mb: float = 32.0, seed: int = 1,
             workdir: pathlib.Path | None = None, log=print) -> bool:
    sc = Scenario(name="soak", mode="tdm", nodes=nodes, weights=dict(SOAK_WEIGHTS))
    work = pathlib.Path(workdir) if workdir else pathlib.Path(tempfile.mkdtemp(prefix="chaos-soak-"))
    world = World(sc, seed, work, nodes=nodes)
    rng = random.Random(seed)
    samples: list[float] = []

    async def go() -> None:
        deadline = time.monotonic() + minutes * 60
        await world.setup()
        try:
            n = 0
            while True:
                if n:                   # setup already started the first match
                    await _next_match(world)
                await _play(world, rng)
                n += 1
                samples.append(rss_mb())
                log(f"soak: match {n} done, rss {samples[-1]:.1f} MB, {len(world.ledger.facts)} facts so far")
                if time.monotonic() >= deadline:
                    break
        finally:
            await world.teardown()
    try:
        asyncio.run(go())
    finally:
        if workdir is None:
            shutil.rmtree(work, ignore_errors=True)
    ok, why = growth_verdict(samples, max_growth_mb)
    log(f"soak {'PASS' if ok else 'FAIL'}: {len(samples)} matches in {minutes:g} min; {why}")
    return ok


if __name__ == "__main__":     # pragma: no cover
    sys.exit(0 if run_soak(minutes=float(os.environ.get("BRX_CHAOS_SOAK_MIN", "1"))) else 1)
