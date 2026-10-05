# Chaos testing

Updated: 2026-10-05.

Chaos testing plays whole matches on the real Mission Control (MC) stack under hard, random conditions,
and checks a set of rules after every step. On its first day it found five MC bugs, now fixed (F326 to
F330).

A chaos run stands up the real Session, NetServer, Compiler and session store in one process. The field is
2 to 20 MockNodes on the real WebSocket. The run plays a match through a seeded sequence of actions:

- combat: hits (multi-word shots too), kills, same-tick trades, team kills, deaths to an unrostered shooter, respawns,
  and kills at a scripted time (`timed_kill`, for a script that needs exact gaps);
- the wire: node drops and batch flushes, duplicate, resent and reordered facts, malformed bytes;
- the phones: clock jumps and jitter, late joins, stale heads, stale match ids, possession reports
  from a phone's own beacon (`possession`) and from a station (`possession_station`, `source: station`);
- MC itself: a clean restart, a crash, the operator's END and the time limit.
- operator setup: PLAY picks, FAVOURITE saves and loads, KIT mode parameters, and restarts in MUSTER,
  KIT and LOBBY;
- utility stations: control, powerup and respawn assignment, RELEASE, authenticated BACK TO HUD,
  RESTORE, DISMISS, and player pickup or station take messages;
- armory faults: a real serial/sticker/BLE-tail binding shape, then a corrupt or missing inventory at restart.

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
- `legal_phase_transitions`: the phase machine moves only on legal edges. A restart in ARMED or LIVE
  resumes that phase (or RECAP). A restart before the match boots in MUSTER (contracts A46 (2)).
- `no_config_to_live_node`: MC never pushes a `config` to a node in the middle of its match.
- `tick_never_raises`: `Session.tick()` never raises (the server would only log it).
- `snapshot_survives_restart`: an MC restart brings back the same match, phase and board. A pre-match
  restart brings back MUSTER (A46 (2)).
- `no_fact_double_counted` and the other scorer checks leave out `pickup` and `operator_result` facts:
  MC stores them and never scores them (A47, A56).
- `kills_credited_after_resume`: the recap credits the delivered death facts after a resume. It reads
  the field Ledger and accounts for a frozen team kill after a frag-cap whistle.
- `hold_target_survives`: the next match uses the KOTH hold target the operator last REQUESTED, including
  an explicit clear, after a pick, FAVOURITE load or restart. The oracle is the request the action sent
  (`world.requested_match`), never MC's `game_pick`: a FAVOURITE records the operator's requested target
  when it is saved, so a corrupted pick that the console saves is caught when it loads back.
- `mode_params_survives`: a gameplay pick applies the mode's declared parameter defaults (the engine's
  `PARAMS`, A18) merged with the picked gameplay piece's declared value (the builtin catalogue), never
  MC's `default_config`.
- `retired_recap_matches_ledger`: after a late fact reaches a match the operator rolled past, that match's
  scorer, its recap and its archived recap equal the Ledger (kills, deaths, kill pairs). The runner fails
  a run that rolls past END without arming this check.
- `archive_row_matches_match_config`: each archive row keeps its match-start mode and configuration,
  including when a late fact recreates a retired row. After that late flush the row and its recap MUST
  exist, so the check never passes on an empty archive.
- `station_ids_unique`: assigned utility stations have distinct numeric IDs.
- `station_restore_keeps_free_id`: RESTORE returns the previous ID when that ID remains free.
- `station_restore_matches_assignment` (raised by the actions): an assignment holds the kind and item
  preset the operator asked for, and RESTORE brings back the kind, team, item and range (threshold,
  tx_power) the world recorded before the departure. `station_restore` names its departure (`dep`) in the
  trace.
- `station_release_clears` (raised by `station_release`): RELEASE of an online station succeeds and
  drops its assignment.
- `pickup_credited`: a real take (sent after the item appeared on MC's clock) credits its player by the
  F454 precedence rule: a phone pickup credits its player, a station's report is final and corrects a
  conflicting phone claim, and a later phone claim changes nothing. The feed holds one TOOK line for that
  take, naming that player.
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
- At the end: `ends_exactly_once`, `frag_cap_ends_match` and `recap_equals_board`. `frag_cap_ends_match`
  judges an operator or time end on the facts MC held at that end: a late flush that then lifts the board to
  the cap does not make it a frag-cap win (F362 l).
- The runner adds `field_settles`: every connected node has its facts acknowledged after each step.

The expected values come from the `Ledger`, the harness's own record of every fact the field emitted.
MC is not checked against its own bookkeeping.

## Add a scenario, an action or an invariant

- **A scenario** is data. Copy `scenarios/_template.py` to a new file in `scenarios/`, set a mode, a field
  size, the action weights (or a fixed `script`) and `ci_seeds`. The file is imported automatically, and
  `test_chaos_fuzz.py` runs its CI seeds. Use `setup_script` for fixed actions before PUSH/START, and
  include `field_join` when a script must act in MUSTER before the player nodes join. `setup_weights`
  and `setup_steps` draw seeded pre-match actions; traces keep those draws for replay. Use `checks=`
  for a rule that only this scenario sets up.
- **An action** is two functions in `actions.py` (or any imported module): a `pick(world, rng)` that
  returns JSON parameters, or None when the action cannot apply, and an `apply(world, **params)`
  coroutine, registered with `@action("name", pick=...)`. Parameters must be plain JSON, because the
  trace stores them.
- `stations-mixed` assigns each utility kind before the match. It tests the authenticated HUD handoff,
  RESTORE, RELEASE and DISMISS across MC restarts, then mixes powerup reset, pickup and take messages.
- `stations-powerup-paths` resets an item, consumes it with a player's pickup fact, then with the
  station's taken message, then plays a conflict (`powerup_conflict`): a phone claim, a station report
  naming another player, and the first phone claiming again.
- `pickup-clock-skew` (strict xfail, F473) respawns an item and sends a real pickup from a phone whose
  synced clock trails MC by 50, 200 and 500 ms; it fails on `pickup_credited` at 200 ms.
  `pickup-clock-lead` does the same with a leading clock and passes.
- `armory-corrupt-resume-kill` and `armory-missing-resume-kill` use distinct USB serials and BLE names.
  Each scores before and after a damaged-inventory restart.
- `hold-target-prelive-restarts` walks MUSTER, KIT and LOBBY. `play-clear-hold` and
  `favourite-clear-hold` test explicit target removal. The FAVOURITE survives an MC restart in its
  per-run shelf. `standard-pick-clears-mode-params` tests a KIT
  edit followed by a STANDARD gameplay pick.
- `picks-mixed` draws positive KOTH hold picks and FAVOURITE saves and loads before START.
- `retired-archive-recreate-config` makes the initial and END archive writes fail. It then rolls to
  another mode and flushes a queued death for the retired match. Both `retired_recap_matches_ledger` and
  `archive_row_matches_match_config` pass since F471's fix.
- The F468-F471 scenarios above were strict xfails until brx3's fixes landed (2026-10-05); they now run as plain
  regressions. After an MC restart the harness waits (bounded, 6 s) for the phones to re-sync their clocks before
  it pushes (`stack.push_when_ready`), because MC refuses a push while a clock is not synced.
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
- The older `possession_station` action still uses a rostered node as its reporter. `stations-mixed`
  uses real utility MockNode sockets, but it does not emulate the phone's BLE station firmware. A
  repeated `hold_ms` models a CONTESTED hold without testing the phone's pause implementation.
- Most runs play one match. The archive regression rolls forward only to deliver a retired fact; it
  checks the first match's end invariants before the roll, then judges the retired match against the
  Ledger and its archive row after the late flush.
- `game_byte_matches_stations` compares each player node with the byte MC arms the station with.
  `tests/test_mc_stations_game_byte.py` covers the byte bump at a new match.
- `powerup_claim` waits until the player's synced clock is 100 ms past the item's spawn or reset before
  it emits the `pickup`. A real phone picks up only after it hears the station's advert, so a same-ms
  pickup is not a field case. That wait hides clock skew, so `pickup-clock-skew` tests skew on its own
  with controlled clocks: MC compares `pickup.t` (the phone's clock) with the spawn time (MC's clock)
  with no tolerance, and loses a real take from a phone that trails by more than the advert delay (F473).
- The real-shape chaos armory reads a per-run JSON fixture. It models a failed read with
  `last_read_ok=False`; it does not exercise `LocalArmory`'s quarantine and DISMISS file operations.
- `medals_track_credited_kills` reads the order in which MC took the facts from a tap on `Scorer.ingest`,
  not from the ledger. The field cannot fix that order: a flush, a reorder or a replay sets it. The
  invariant checks the medal rules on that order. The other invariants check which facts scored.
- Facts of the same step can arrive in either order, so a fact in the step that ended the match is not
  judged by that end (`credited_inside_window`).
- MC's clock is the host wall clock plus `mc_skew_ms`, and the host clock can step (WSL2 TimeSync stepped it
  back during a loaded `test:all`, F451). An invariant that ORDERS two MC events reads a monotonic stamp
  (`mono`), never MC's own `now_ms()`. `mc_clock_step` injects a step in a script.
- A phone clock that runs AHEAD can put a credited kill after a frag cap that MC reached on an earlier
  arrival. Contracts §4 lets the end move earlier only, so that kill stays credited.
- A frame that loses its `*` as the LAST frame of a burst waits in the reassembler until the gun sends
  another `$`. A dead gun can send nothing for a long time. The bench has only seen the `*` lost between
  two frames, so the gun test models that case.
