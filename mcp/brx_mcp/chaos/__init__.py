"""Chaos testing for Mission Control, the phone nodes and the (simulated) guns.

A chaos run stands up the REAL MC stack (Session + NetServer + Compiler + store) with a field of
MockNodes on the real WebSocket, plays a match through a seeded random sequence of hard events
(trades, drops, duplicate and reordered facts, clock jumps, late joins, MC restarts), and checks a
set of invariants after every step. A failure prints the seed and the action trace, and writes a
trace file that `python -m brx_mcp.chaos replay` runs again.

    registry.py    the ACTIONS, INVARIANTS and SCENARIOS registries
    stack.py       Stack / ChaosStack: the real MC stack in one process
    world.py       World (what actions and invariants see), ChaosNode, Ledger
    actions.py     the built-in actions
    invariants.py  the built-in invariants
    scenarios/     one module per scenario family; `_template.py` to copy
    runner.py      run one seed, replay a trace, shrink a failure
    soak.py        the opt-in MC soak (back-to-back matches, memory growth)
    __main__.py    the CLI

docs/chaos-testing.md is the guide. The package imports nothing that needs `websockets` until a
submodule is imported, so `import brx_mcp.chaos` is always safe.
"""
