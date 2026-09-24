"""Run a chaos scenario: pick actions from a seed (or replay a trace), check every invariant after
every step, and on a breach write a trace file that `replay` reproduces.

A run is:
  1. setup: the scenario's field joins, readies, takes the config and goes LIVE;
  2. the live steps: each step picks one action by weight (or takes the next scripted one), applies
     it, waits for the field to settle, then runs every step invariant;
  3. the finish: the scenario's terminal action (END, or the time limit), unless a frag cap already
     ended the match;
  4. the aftermath: every dropped node reconnects and flushes, the operator presses END again, MC
     ticks; then the step invariants and the end invariants run one last time.

The trace records every action with its concrete parameters, so a replay needs no RNG.
"""
from __future__ import annotations

import asyncio
import json
import os
import pathlib
import shutil
import tempfile
import time
import traceback
from dataclasses import dataclass, field
from typing import Any

from . import actions as _actions  # noqa: F401  (registers the built-in actions)
from . import invariants as _invariants  # noqa: F401  (registers the built-in invariants)
from . import scenarios as _scenarios  # noqa: F401  (registers the built-in scenarios)
from .registry import ACTIONS, INVARIANTS, SCENARIOS, InvariantError, Scenario
from .world import World

RUN_TIMEOUT_S = float(os.environ.get("BRX_CHAOS_RUN_TIMEOUT_S", "120"))


@dataclass
class RunResult:
    scenario: str
    seed: int
    nodes: int
    steps: int
    actions: list[dict] = field(default_factory=list)
    ok: bool = True
    invariant: str | None = None
    error: str | None = None
    secs: float = 0.0
    failed_step: int | None = None
    trace_path: str | None = None
    timings: list[tuple[str, float]] = field(default_factory=list)   # (action, seconds incl. settle)

    def trace(self) -> dict:
        return {"scenario": self.scenario, "seed": self.seed, "nodes": self.nodes, "steps": self.steps,
                "actions": self.actions, "failure": None if self.ok else
                {"invariant": self.invariant, "error": self.error, "step": self.failed_step}}

    def summary(self) -> str:
        head = f"{self.scenario} seed={self.seed} nodes={self.nodes} steps={len(self.actions)} {self.secs:.1f}s"
        if self.ok:
            return f"PASS {head}"
        lines = [f"FAIL {head}", f"  invariant: {self.invariant}", f"  error: {self.error}"]
        if self.trace_path:        # the exact actions; a re-run of the seed re-picks them, which timing can move
            lines.append(f"  replay: python -m brx_mcp.chaos replay {self.trace_path}")
        lines.append(f"  re-run: python -m brx_mcp.chaos run --scenario {self.scenario} --seed {self.seed}"
                     f" --nodes {self.nodes} --steps {self.steps}")
        lines.append("  actions:")
        lines += [f"    {i:3d} {a['name']} {json.dumps(a['params'])}" for i, a in enumerate(self.actions)]
        return "\n".join(lines)


def _check(world: World, when: str) -> None:
    skip = world.scenario.skip_invariants
    for inv in INVARIANTS.values():
        if inv.when == when and inv.name not in skip:
            inv.check(world)


def _pick(world: World) -> dict | None:
    """One weighted pick. An action that cannot apply right now (pick returns None) is re-drawn."""
    weights = {n: w for n, w in world.scenario.weights.items() if w > 0 and n in ACTIONS
               and not ACTIONS[n].terminal}
    for _ in range(12):
        if not weights:
            return None
        names = sorted(weights)
        name = world.rng.choices(names, [weights[n] for n in names])[0]
        params = ACTIONS[name].pick(world, world.rng)
        if params is not None:
            return {"name": name, "params": params}
        weights.pop(name)
    return None


async def _apply(world: World, step: dict) -> None:
    act = ACTIONS.get(step["name"])
    if act is None:
        raise KeyError(f"unknown chaos action {step['name']!r} (python -m brx_mcp.chaos list)")
    t0 = time.monotonic()
    await act.apply(world, **step["params"])
    if not await world.settle():
        stuck = [n.index for n in world.nodes if not n._paused and (not n.link_up or n.ring)]
        raise InvariantError("field_settles", f"after {step['name']}, node(s) {stuck} never had their facts "
                                              "acknowledged (a link that never came back, or MC stopped acking)")
    world.timings.append((step["name"], time.monotonic() - t0))
    if world.session.phase == "recap" and world.end_delivered is None:
        world.mark_end()          # a frag cap ended the match inside this step


async def _run(world: World, res: RunResult, script: list[dict] | None) -> None:
    sc = world.scenario
    await world.setup()
    steps = script if script is not None else sc.script
    i = 0
    while True:
        if steps is not None:
            if i >= len(steps):
                break
            step = steps[i]
        else:
            if i >= res.steps or world.session.phase != "live":
                break
            picked = _pick(world)
            if picked is None:
                break
            step = picked
        world.step = i
        res.failed_step = i
        res.actions.append(step)
        await _apply(world, step)
        _check(world, "step")
        i += 1
        if world.session.phase == "recap":
            world.ended = True
            if steps is None:
                break
    # the finish (a script carries its own terminal step)
    if script is None and sc.script is None and world.session.phase in ("live", "armed"):
        finish = {"end": "end", "time": "time_up"}.get(sc.finish)
        if finish:
            step = {"name": finish, "params": {}}
            world.step = i
            res.failed_step = i
            res.actions.append(step)
            await _apply(world, step)
            _check(world, "step")
    # the aftermath: late flushes, a second END, a few ticks
    world.ended = True
    res.failed_step = None
    at_end = {(n, s) for n, s, _ in world.ledger.delivered(world.nodes)}
    for n in world.nodes:
        if n._paused:
            n.reconnect()
    await world.settle(6.0)
    world.late_after_end = len({(n, s) for n, s, _ in world.ledger.delivered(world.nodes)} - at_end)
    if world.session.phase == "recap":
        world.session.control("end")
    for _ in range(3):
        world.session.tick()
    await world.settle()
    _check(world, "step")
    _check(world, "end")
    for check in sc.checks:
        check(world)


def run_one(sc: Scenario | str, seed: int, *, nodes: int | None = None, steps: int | None = None,
            script: list[dict] | None = None, workdir: pathlib.Path | None = None,
            trace_dir: pathlib.Path | None = None) -> RunResult:
    """Run one scenario for one seed (or one scripted action list). Never raises on a breach: the
    result says what broke. Writes a trace file on a failure when `trace_dir` is given."""
    sc = SCENARIOS[sc] if isinstance(sc, str) else sc
    res = RunResult(sc.name, seed, nodes or sc.nodes, steps or sc.steps)
    work = pathlib.Path(workdir) if workdir else pathlib.Path(tempfile.mkdtemp(prefix=f"chaos-{sc.name}-{seed}-"))
    world = World(sc, seed, work, nodes=res.nodes)
    t0 = time.monotonic()

    async def go():
        try:
            await asyncio.wait_for(_run(world, res, script), RUN_TIMEOUT_S)
        finally:
            await world.teardown()
    try:
        asyncio.run(go())
    except InvariantError as e:
        res.ok, res.invariant, res.error = False, e.name, str(e)
    except Exception as e:   # a crash is a failure too, and it gets the same trace
        res.ok, res.invariant = False, f"crash:{type(e).__name__}"
        res.error = "".join(traceback.format_exception_only(type(e), e)).strip()
        res.error += "\n" + "".join(traceback.format_tb(e.__traceback__)[-4:])
    res.secs = time.monotonic() - t0
    res.timings = list(world.timings)
    if workdir is None:            # our own temp folder (store files, session.json): gone once the run is over
        shutil.rmtree(work, ignore_errors=True)
    if not res.ok and trace_dir is not None:
        trace_dir = pathlib.Path(trace_dir)
        trace_dir.mkdir(parents=True, exist_ok=True)
        path = trace_dir / f"chaos-{sc.name}-seed{seed}.json"
        path.write_text(json.dumps(res.trace(), indent=1))
        res.trace_path = str(path)
    return res


def replay(trace: dict[str, Any] | str | pathlib.Path, **kw) -> RunResult:
    """Run a trace file (or its dict) again: the same scenario, seed, field size and actions."""
    data: dict[str, Any] = trace if isinstance(trace, dict) else json.loads(pathlib.Path(trace).read_text())
    return run_one(data["scenario"], int(data["seed"]), nodes=int(data["nodes"]),
                   steps=int(data.get("steps") or 0) or None, script=list(data["actions"]), **kw)


def shrink(failed: RunResult, *, max_runs: int = 40, log=print) -> RunResult:
    """Make a failing action list shorter while it still breaks the SAME invariant (delta debugging:
    drop chunks, halving the chunk size when no chunk can go). Each try is one full run, so this is
    for the CLI, not for CI. The terminal step, if any, is kept."""
    acts = list(failed.actions)
    best = failed
    runs = 0
    chunk = max(1, len(acts) // 2)
    while chunk >= 1 and runs < max_runs:
        i, cut = 0, False
        while i < len(acts) and runs < max_runs:
            trial = acts[:i] + acts[i + chunk:]
            if not trial or (acts[-1]["name"] in ("end", "time_up") and trial[-1] is not acts[-1]):
                i += chunk
                continue
            runs += 1
            r = run_one(failed.scenario, failed.seed, nodes=failed.nodes, steps=failed.steps, script=trial)
            if not r.ok and r.invariant == failed.invariant:
                acts, best, cut = trial, r, True
                log(f"  shrink: {len(acts)} actions still fail {r.invariant}")
            else:
                i += chunk
        if not cut:
            chunk //= 2
    return best
