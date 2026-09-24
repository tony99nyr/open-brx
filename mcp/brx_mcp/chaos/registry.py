"""The three chaos-testing registries: ACTIONS, INVARIANTS and SCENARIOS.

Each is a plain dict filled by a decorator or a constructor, so a new entry is one function or one
declaration in one file, and nothing else in the framework changes (docs/chaos-testing.md).

* An ACTION is one thing that happens to the field (a hit, a node drop, an MC restart). It has two
  halves. `pick(world, rng)` reads the world and returns the concrete parameters, or None when the
  action cannot apply right now. `apply(world, **params)` does it. The runner records every picked
  action with its parameters in the trace, so `replay` runs the same actions without the RNG.
* An INVARIANT is a rule the whole system must keep. `check(world)` raises `InvariantError` on a
  breach. Every invariant runs after every step of every scenario, unless its `when` says otherwise.
* A SCENARIO names a mode, a field size, a step count, action weights (or a fixed script), the
  config and the CI seeds.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable


class InvariantError(AssertionError):
    """An invariant broke. `name` is the invariant; the message says what and where."""

    def __init__(self, name: str, message: str):
        super().__init__(f"[{name}] {message}")
        self.name = name


# --------------------------------------------------------------------------------------- actions
@dataclass
class Action:
    name: str
    pick: Callable[..., dict | None]
    apply: Callable[..., Awaitable[Any]]
    doc: str = ""
    # Does this action end the match? The runner stops picking live actions after one.
    terminal: bool = False


ACTIONS: dict[str, Action] = {}


def action(name: str, *, pick: Callable[..., dict | None], terminal: bool = False):
    """Register an action. Decorate the APPLY coroutine and pass the PICK function:

        def _pick_hit(world, rng):
            return {"victim": 3, "shooter": 5}          # or None: not possible right now

        @action("hit", pick=_pick_hit)
        async def hit(world, victim, shooter): ...
    """
    def deco(apply):
        ACTIONS[name] = Action(name, pick, apply, (apply.__doc__ or "").strip(), terminal)
        return apply
    return deco


# ------------------------------------------------------------------------------------ invariants
@dataclass
class Invariant:
    name: str
    check: Callable[..., None]
    doc: str = ""
    # "step": after every step. "end": once, after the run's last step.
    when: str = "step"


INVARIANTS: dict[str, Invariant] = {}


def invariant(name: str, *, when: str = "step"):
    """Register an invariant. The function takes the world and raises `InvariantError` on a breach."""
    def deco(fn):
        INVARIANTS[name] = Invariant(name, fn, (fn.__doc__ or "").strip(), when)
        return fn
    return deco


# ------------------------------------------------------------------------------------- scenarios
@dataclass
class Scenario:
    name: str
    mode: str
    doc: str = ""
    nodes: int = 12
    steps: int = 30
    time_limit_s: int = 600
    # {action name: weight}. An action absent from the dict is never picked.
    weights: dict[str, float] = field(default_factory=dict)
    # A fixed list of {"name", "params"} steps instead of RNG picks (a regression scenario).
    script: list[dict] | None = None
    # How the match ends after the live steps: "end" (operator END), "time" (the time limit) or
    # "none" (only a frag cap reached during the steps ends it).
    finish: str = "end"
    # Extra config patch for `Session.set_config` (frag limit, teams, ...).
    config: dict = field(default_factory=dict)
    # Seeds that run in CI (`pnpm run test:all`). Keep them few: each is one full match.
    ci_seeds: tuple[int, ...] = ()
    # Invariants this scenario switches off, with the reason. Use it only for a documented design
    # limit, never to hide a bug (a bug gets an expected-failure test and a FOLLOWUPS row).
    skip_invariants: dict[str, str] = field(default_factory=dict)
    # Checks for THIS scenario only, run once at the end beside the "end" invariants: (world) -> None,
    # raising InvariantError. For what only one scenario sets up (a same-tick cap tie, a latency bound).
    checks: tuple[Callable[..., None], ...] = ()
    # A KNOWN, FILED bug this scenario pins: "F330: <reason>". CI expects the run to FAIL (an xfail), and a
    # pass fails CI, so the marker cannot outlive the fix. Remove it when the bug is fixed.
    xfail: str | None = None
    # ...and the invariant that bug breaks. Any OTHER failure of an xfail scenario is a real failure.
    xfail_invariant: str | None = None


SCENARIOS: dict[str, Scenario] = {}


def scenario(sc: Scenario) -> Scenario:
    if sc.name in SCENARIOS:
        raise ValueError(f"scenario {sc.name!r} is registered twice")
    SCENARIOS[sc.name] = sc
    return sc
