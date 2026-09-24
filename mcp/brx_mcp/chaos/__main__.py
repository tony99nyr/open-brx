"""`python -m brx_mcp.chaos`: run, replay and explore chaos scenarios; run the MC soak.

    python -m brx_mcp.chaos list
    python -m brx_mcp.chaos run --scenario tdm-mixed --seed 7 [--steps 60] [--nodes 16] [--shrink]
    python -m brx_mcp.chaos replay ~/.brx-mcp/chaos/chaos-tdm-mixed-seed7.json [--shrink]
    python -m brx_mcp.chaos explore --scenario tdm-mixed --seeds 1000 [--start 100] [--stop-on-fail]
    python -m brx_mcp.chaos soak --minutes 10 [--nodes 12] [--max-growth-mb 32]

Run it from `mcp/` with the dev venv (`../.venv/bin/python`): it needs `websockets`. A failing run
writes its trace to `<BRX_MCP_HOME or ~/.brx-mcp>/chaos/` (or `--trace-dir`), and `replay` runs that
file again. docs/chaos-testing.md is the guide.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time

from ..storage import home_dir


def _trace_dir(arg: str | None) -> pathlib.Path:
    return pathlib.Path(arg) if arg else home_dir() / "chaos"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m brx_mcp.chaos", description="Open BRX chaos testing")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="list the scenarios, actions and invariants")

    r = sub.add_parser("run", help="run one scenario for one seed")
    r.add_argument("--scenario", required=True)
    r.add_argument("--seed", type=int, default=1)
    r.add_argument("--steps", type=int)
    r.add_argument("--nodes", type=int)
    r.add_argument("--shrink", action="store_true", help="on a failure, cut the action list down")
    r.add_argument("--trace-dir")

    p = sub.add_parser("replay", help="run a trace file again, action for action")
    p.add_argument("trace")
    p.add_argument("--shrink", action="store_true")
    p.add_argument("--trace-dir")

    e = sub.add_parser("explore", help="run many seeds of a scenario (opt-in, not in CI)")
    e.add_argument("--scenario", required=True)
    e.add_argument("--seeds", type=int, default=100, help="how many seeds")
    e.add_argument("--start", type=int, default=1000, help="the first seed (CI uses small seeds)")
    e.add_argument("--steps", type=int)
    e.add_argument("--nodes", type=int)
    e.add_argument("--stop-on-fail", action="store_true")
    e.add_argument("--trace-dir")

    s = sub.add_parser("soak", help="back-to-back matches on one MC; fail on unbounded memory growth")
    s.add_argument("--minutes", type=float, default=10.0)
    s.add_argument("--nodes", type=int, default=12)
    s.add_argument("--max-growth-mb", type=float, default=32.0)
    s.add_argument("--seed", type=int, default=1)

    a = ap.parse_args(argv)
    try:
        from .runner import replay, run_one, shrink
        from .registry import ACTIONS, INVARIANTS, SCENARIOS
    except ImportError as err:     # no websockets: the stack cannot start
        print(f"chaos testing needs the MC extras ({err}); run it with the dev venv: ../.venv/bin/python")
        return 2

    if a.cmd == "list":
        print("scenarios:")
        for sc in SCENARIOS.values():
            seeds = ",".join(map(str, sc.ci_seeds)) or "-"
            kind = "script" if sc.script else f"{sc.steps} steps"
            print(f"  {sc.name:<18} {sc.mode:<5} {sc.nodes:>2} nodes  {kind:<9} ci seeds {seeds:<6} {sc.doc}")
        print("actions:")
        for act in ACTIONS.values():
            print(f"  {act.name:<18} {'(terminal) ' if act.terminal else ''}{act.doc.splitlines()[0] if act.doc else ''}")
        print("invariants:")
        for inv in INVARIANTS.values():
            print(f"  {inv.name:<26} [{inv.when}] {inv.doc.splitlines()[0] if inv.doc else ''}")
        return 0

    if a.cmd == "soak":
        from .soak import run_soak
        return 0 if run_soak(minutes=a.minutes, nodes=a.nodes, max_growth_mb=a.max_growth_mb, seed=a.seed) else 1

    tdir = _trace_dir(getattr(a, "trace_dir", None))
    if a.cmd == "run":
        if a.scenario not in SCENARIOS:
            print(f"unknown scenario {a.scenario!r}; try: python -m brx_mcp.chaos list")
            return 2
        res = run_one(a.scenario, a.seed, nodes=a.nodes, steps=a.steps, trace_dir=tdir)
    elif a.cmd == "replay":
        res = replay(a.trace, trace_dir=tdir)
    else:
        fails = 0
        t0 = time.monotonic()
        for seed in range(a.start, a.start + a.seeds):
            res = run_one(a.scenario, seed, nodes=a.nodes, steps=a.steps, trace_dir=tdir)
            print(res.summary().splitlines()[0] if res.ok else res.summary(), flush=True)
            if not res.ok:
                fails += 1
                if a.stop_on_fail:
                    break
        print(f"explore {a.scenario}: {a.seeds} seed(s) from {a.start}, {fails} failed, {time.monotonic() - t0:.0f}s")
        return 1 if fails else 0
    print(res.summary())
    if not res.ok and a.shrink:
        small = shrink(res)
        print(f"shrunk to {len(small.actions)} action(s):")
        print(json.dumps(small.actions, indent=1))
        if small.actions != res.actions:
            path = tdir / f"chaos-{res.scenario}-seed{res.seed}-min.json"
            tdir.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(small.trace(), indent=1))
            print(f"minimal trace: {path}")
    return 0 if res.ok else 1


if __name__ == "__main__":
    sys.exit(main())
