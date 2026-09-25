# Chaos testing

Updated: 2026-09-24.

Chaos testing plays whole matches on the real Mission Control (MC) stack under hard, random conditions,
and checks a set of rules after every step. On its first day it found five MC bugs, now fixed (F326 to
F330).

A chaos run stands up the real Session, NetServer, Compiler and session store in one process. The field is
2 to 20 MockNodes on the real WebSocket. The run plays a match through a seeded sequence of actions:

- combat: hits (multi-word shots too), kills, same-tick trades, team kills, deaths to an unrostered shooter, respawns,
  and kills at a scripted time (`timed_kill`, for a script that needs exact gaps);
- the wire: node drops and batch flushes, duplicate, resent and reordered facts, malformed bytes;
- the phones: clock jumps and jitter, late joins, stale heads, stale match ids, possession reports;
- MC itself: a clean restart, a crash, the operator's END and the time limit.

After every step it checks every invariant.

The code is `mcp/brx_mcp/chaos/`. The CI tests are `mcp/tests/test_chaos_*.py`. They run as the `chaos`
job of `pnpm run test:all`.

## Run it

Run everything from `mcp/` with the dev venv (`../.venv/bin/python`), because the stack needs `websockets`.

| You want | Command |
|---|---|
| The CI set | `python3 run_tests.py chaos` (or `pnpm run test:all -- chaos` from the root) |
| The names of scenarios, actions and invariants | `python -m brx_mcp.chaos list` |
| One seed | `python -m brx_mcp.chaos run --scenario tdm-mixed --seed 7 [--steps 60] [--nodes 16]` |
| Many seeds (exploration, not CI) | `python -m brx_mcp.chaos explore --scenario tdm-mixed --seeds 500 [--start 1000]` |
| A failure again, action for action | `python -m brx_mcp.chaos replay <trace.json>` |
| A shorter failing trace | add `--shrink` to `run` or `replay` |
| The CI test file on other seeds | `BRX_CHAOS_SEEDS=100-140 python3 run_tests.py chaos_fuzz` |
| The MC soak (opt-in) | `python -m brx_mcp.chaos soak --minutes 10`, or `BRX_CHAOS_SOAK_MIN=10 RUN_TESTS_TIMEOUT_S=900 python3 run_tests.py chaos_soak` |

A failing run prints the seed, the broken invariant, the whole action list and the command that
reproduces it. It also writes a trace file to `~/.brx-mcp/chaos/` (or `--trace-dir`). In the test runner,
set `BRX_CHAOS_TRACE_DIR` to keep the trace, because the runner's home folder is temporary.

## The invariants

They are in `invariants.py`. Each one applies to every scenario.

- `kills_credited_once`: every delivered death is on the board or parked as an after-the-whistle fact,
  never both, never neither, never twice.
- `scores_equal_facts`: each row's kills, deaths and hits equal the sum of the credited facts (a team
  kill is -1; a multi-word shot is one hit).
- `no_fact_double_counted`: MC's dedup set is exactly the set of delivered facts, after resends,
  reorders and restarts.
- `stale_match_parks`: a fact with another match's id is parked and scores nothing.
- `pools_in_range`: no pool is negative or above its armed maximum, on a node or in MC's mirror.
- `one_death_per_life`: deaths never outrun respawns + 1.
- `credited_inside_window`: no credited fact is later than the time limit. After an END or a frag cap,
  no fact that arrived later is credited past the end.
- `legal_phase_transitions`: the phase machine moves only on legal edges, and a restart resumes the
  phase it left.
- `no_config_to_live_node`: MC never pushes a `config` to a node in the middle of its match.
- `tick_never_raises`: `Session.tick()` never raises (the server would only log it).
- `snapshot_survives_restart`: an MC restart brings back the same match, phase and board.
- `possession_is_max_merged`: KOTH possession is the highest cumulative report per team, never a sum.
- `game_byte_matches_stations`: a connected node that holds MC's current head holds the game byte MC arms
  its stations with (`config.game_byte` equals `station_config.game`), across restarts and crashes.
- `kill_feedback_matches_credit`: every `feedback` of kind `kill` that a node receives matches exactly one
  kill credited to that node's player in the ledger. MC sends no cue for a death that nobody is credited
  with (an unknown or unrostered shooter, a self-kill, a team kill), and never two cues for one kill
  (a resend, a duplicate, a restart, a resume). The rule is one-way: the cues are a subset of the credited
  kills. MC skips a cue by design when a kill is older than `FEEDBACK_MAX_AGE_MS` on arrival, when the
  victim's node never synced its clock, in a replay, and when the killer's node has no socket. A kill
  that MC cued live and a late fact then parked (the fact moved a frag-cap end earlier) still counts.
  The scenario `unknown-shooter-no-kill-cue` checks the other direction (`every_kill_cued`).
- `medals_track_credited_kills`: every enemy kill carries the medals that its killer's credited kills imply,
  from `types.MEDALS`. The rules are Halo 3's multi-kill ladder:
  - The multi medal is the highest one whose count the chain has reached.
  - A kill within `MULTI_KILL_MS` of the killer's previous kill extends the chain. A bigger gap starts a
    new chain. The killer's own death does not reset the chain.
  - First blood goes once, to the first credited kill.
  - A streak medal fires at its exact count of kills without a death.

  The invariant checks the current scorer's per-kill record kill for kill. It also checks the medals on
  every kill cue that a node received. The cue check is one-way, for the same designed skips as
  `kill_feedback_matches_credit`. Medals depend on the order in which MC took the facts, so the World
  taps `Scorer.ingest` for its inputs: the order, `t_recv`, the batch re-base and the node's sync state.
  The fact content comes from the ledger. The invariant takes MC's verdict on whether a fact scored, and
  models the A5.7 suppression: a kill on a never-synced victim node earns no multi medal. The scenario
  `multi-kill-ladder` pins one 11-kill chain, a gap and a new chain.
- `multi_chain_monotonic` (integration review 2026-09-25): a kill flushed late (its `t` before the killer's
  newest kill) never extends a chain, and the chain clock never moves back. The `late_flush` action drives it.
- `frozen_team_kill_keeps_victim_death`: a team kill frozen out after a frag-cap whistle (F356) still counts
  the victim's death. Only the killer's -1 is frozen. The oracle does not read `post_end`.
- `recap_medals_equal_live_cues`: the recap's medals equal the medal cues sent live. It skips a match whose
  scorer a replay replaced, because a replay judges streak medals in `t` order (A63).
- `honors_full_ledger`: MVP, IRON MAN, MULTIKILL and SURVIVOR, computed from the ledger, equal MC's honours.
  The `melee_kill` action makes BEAT DOWN fire.
- At the end: `ends_exactly_once`, `frag_cap_ends_match` and `recap_equals_board`.
- The runner adds `field_settles`: every connected node has its facts acknowledged after each step.

The expected values come from the `Ledger`, the harness's own record of every fact the field emitted.
MC is not checked against its own bookkeeping.

## Add a scenario, an action or an invariant

- **A scenario** is data. Copy `scenarios/_template.py` to a new file in `scenarios/`, set a mode, a field
  size, the action weights (or a fixed `script`) and `ci_seeds`. The file is imported automatically, and
  `test_chaos_fuzz.py` runs its CI seeds. Use `checks=` for a rule that only this scenario sets up.
- **An action** is two functions in `actions.py` (or any imported module): a `pick(world, rng)` that
  returns JSON parameters, or None when the action cannot apply, and an `apply(world, **params)`
  coroutine, registered with `@action("name", pick=...)`. Parameters must be plain JSON, because the
  trace stores them.
- **An invariant** is a function `(world) -> None` in `invariants.py`, registered with
  `@invariant("name")`, that raises `InvariantError` with the evidence. Break the behaviour once and watch
  it fail before you trust it.

## Turn a bug into a scenario

1. Reproduce it with `run` (or `explore` finds it). Keep the trace file.
2. Shrink it: `replay <trace> --shrink`.
3. Paste the short action list into `scenarios/regressions.py` as a scripted scenario with
   `ci_seeds=(1,)`. Watch it go red.
4. Fix the bug if the fix is small, local and clearly correct. Otherwise set the scenario's
   `xfail="F<id>: <reason>"` (or wrap a focused test in `xfail(...)` from `tests/_skip.py`) and file the
   FOLLOWUPS row (claim the id first). CI then expects the run to fail, and a pass fails CI until you
   remove the marker. `clock-back-assist` (F330) carried the marker until its fix.
5. Never weaken an invariant to get a green run. A documented design limit goes in the scenario's
   `skip_invariants` with the reason.

A field bug works the same way: write the actions that the field saw as a script.

## What else is in the suite

- `test_chaos_gun.py`: a live `run_live` game on FakeTaggers while the gun-to-host byte stream is split,
  loses its `*`, loses chunks, and carries the soak patterns' traffic. The frames go through the real
  reassembler (`protocol.extract_frames`).
- `test_chaos_stage.py`: the gun stage (`stage.py`, the mirror of `engine.js`) under overlapping stun,
  smoke and poison, and death in the middle of a reload or a weapon swap.
- `test_chaos_soak.py`: the growth rule of the opt-in soak. The soak itself plays back-to-back matches on
  one MC and fails when resident memory keeps growing.

## Known limits

- The fields are MockNodes, not phones. `engine.js` is covered by the stage mirror, not here.
- The field has no station nodes, and a run plays one match. `game_byte_matches_stations` compares each
  node with the byte MC would arm a station with. The bump to a new match is covered by
  `tests/test_mc_stations_game_byte.py`.
- `medals_track_credited_kills` reads the order in which MC took the facts from a tap on `Scorer.ingest`,
  not from the ledger. The field cannot fix that order: a flush, a reorder or a replay sets it. The
  invariant checks the medal rules on that order. The other invariants check which facts scored.
- Facts of the same step can arrive in either order, so a fact in the step that ended the match is not
  judged by that end (`credited_inside_window`).
- A phone clock that runs AHEAD can put a credited kill after a frag cap that MC reached on an earlier
  arrival. Contracts §4 lets the end move earlier only, so that kill stays credited.
- A frame that loses its `*` as the LAST frame of a burst waits in the reassembler until the gun sends
  another `$`. A dead gun can send nothing for a long time. The bench has only seen the `*` lost between
  two frames, so the gun test models that case.
