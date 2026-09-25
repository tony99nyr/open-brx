---
name: chaos-testing
description: Run, extend and debug Open BRX chaos testing (mcp/brx_mcp/chaos), the seeded fuzzer that plays whole matches on the real Mission Control stack with a field of MockNodes and checks invariants after every step. Use when the user says "chaos test", "chaos testing", "fuzz MC", "hard scenarios", "does MC survive X", "add a scenario", "replay this seed", "explore seeds", "soak MC", or after any change to MC scoring, the session snapshot, resume, net dedup or the node wire; also to turn a field bug about scoring, restarts, drops or clocks into a regression.
---

# Chaos testing

The guide is `docs/chaos-testing.md`: read it first. This skill is the loop.

## When to use it

- You changed `mcp/brx_mcp/mc/` scoring, `state.py` (snapshot, resume, bind, END, frag cap), `net.py`
  (dedup, acks) or `mock_node.py`. Run the CI set, then explore a few hundred seeds of the scenario that
  touches your change.
- A field report says a kill vanished, counted twice, a restart lost something, or a clock went odd.
  Write the field's actions as a script and run it.
- A new action or mode exists. Add an action, give it a weight in a scenario, and explore.
- Restarts: `mc_restart` is a clean stop (the snapshot is flushed); `mc_crash` is a crash (the snapshot
  is whatever the 2 s debounce last wrote). `crash-mixed` explores the second.

## Commands (from `mcp/`, with `../.venv/bin/python`)

    python3 run_tests.py chaos                                  # the CI set (also: pnpm run test:all -- chaos)
    ../.venv/bin/python -m brx_mcp.chaos list
    ../.venv/bin/python -m brx_mcp.chaos run --scenario tdm-mixed --seed 7 [--steps 60] [--nodes 16] [--shrink]
    ../.venv/bin/python -m brx_mcp.chaos explore --scenario koth-mixed --seeds 300 --start 1000
    ../.venv/bin/python -m brx_mcp.chaos replay ~/.brx-mcp/chaos/chaos-koth-mixed-seed1042.json --shrink
    ../.venv/bin/python -m brx_mcp.chaos soak --minutes 10          # opt-in, memory growth

Explore in the background, one process per scenario, and read only the FAIL lines. A run is about 2 s,
so 300 seeds is about 10 minutes. Bound it: never loop explore without a seed count.

## The loop: bug to scenario to fix to CI seed

1. **Find.** `explore` prints `FAIL <scenario> seed=N` with the invariant and a trace path.
2. **Check the harness first.** Replay it. Ask whether the fake or the invariant is wrong before you
   blame MC (the first finding of 2026-09-24 was a MockNode that did not mirror `engine.js`). Compare
   the fake with `app/src/engine.js` when a node behaves oddly.
3. **Minimise.** `replay <trace> --shrink`, or write the few actions by hand. Put the script in
   `scenarios/regressions.py` with `ci_seeds=(1,)` and watch it go red.
4. **Claim an id** before the work: the FOLLOWUPS "Next free" bump plus the row (or the closed line),
   committed and pushed on its own.
5. **Fix** if the fix is small, local and clearly correct. Otherwise give the regression scenario
   `xfail="F<id>: <reason>"` and `xfail_invariant="<the invariant it breaks>"` (`clock-back-assist` had them until F330's fix),
   or wrap a focused test in `xfail` from `tests/_skip.py`, and leave the row open. CI then fails on a
   pass, and on any other invariant.
6. **Never weaken an invariant** to go green. A real design limit goes in the scenario's
   `skip_invariants` with its reason, and in `docs/chaos-testing.md` "Known limits".
7. **Prove the net.** Break the behaviour on purpose (monkeypatch in a scratch script) and check the
   invariant catches it. Then `pnpm run test:all`.

## Adding things

- Scenario: copy `scenarios/_template.py`. Weights are relative. `finish` is `end`, `time` or `none`.
  `checks=` holds scenario-only rules (a tie, a latency bound).
- Action: `pick(world, rng) -> params | None` plus `@action("name", pick=...) async def apply(world, **p)`.
  Parameters are plain JSON (the trace stores them). Read state only from `world` so a seed replays.
- Invariant: `@invariant("name")` on `(world) -> None`, raise `InvariantError(name, evidence)`. Compare MC
  with the `Ledger`, not with MC's own bookkeeping.

## Traps

- Keep CI seeds few: each is a full match of about 2 s. The file is split in `run_tests.py` SPLIT.
- A MockNode's inbox lists grow for ever. The soak clears them; a long custom run must too.
- Facts inside one step can arrive in either order; do not write an invariant that needs their order.
- Do not run repo setup scripts, and do not use `git stash` in a shared checkout.
