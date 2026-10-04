# Golden traces

A golden trace is one recorded run of the phone engine (`app/src/engine.js`): a fixed sequence of inputs, and the
gun writes and state that came out. Two tests replay every trace and fail on any difference:

- `app/test/golden-traces.test.mjs` replays each trace through the real engine. A refactor that must not change
  behaviour (for example, moving the powerup code into its own module) keeps every trace green.
- `mcp/tests/test_golden_traces.py` replays the traces that list `stage` through the bench stage
  (`mcp/brx_mcp/stage/stage.py`, GunStage). The stage exists to predict the phone, so it must produce the same
  writes and state.

The golden is always the engine's output. The tests never re-record.

## The format

One JSON file per trace. `_base.json` holds the shared inputs: the base config, the player (#7, blue, assault rifle
and shotgun), the roster and the start clock. The frames are `mcp/brx_mcp/mc/golden_bundle.json`.

| Key | What it holds |
|---|---|
| `name`, `why`, `source` | The file name, what behaviour the trace pins, and the unit tests it was ported from. |
| `runners` | `["engine", "stage"]`, or `["engine"]` when the stage does not model the behaviour. |
| `setup` | `config` (merged over the base config), `frames` (merged over the golden bundle), `frames_patch` (`head_append`, `after_last_ammo`, `drop`), `catalog` (sent in the assign), `gun` (the fake gun's rules, below), `delay` (`"timers"` for a clock-driven `delay`, else immediate), `tick_ms` (the clock step, default 250), `countdown_s`, and `fields` (state fields to record beyond the default set). |
| `steps` | The inputs, in order (below). |
| `stage_ignores` | What the stage runner does not compare, each with a reason (below). |
| `expect` | Written by the recorder: per checkpoint, the writes since the previous checkpoint, the facts (`emit`) and reports (`report`) MC heard since then, and the recorded state. Times are ms since the start clock, and a hit's random `shot_group` epoch reads `epoch`. |

The runner always starts the same way: the gun links, MC sends assign, config and start (`countdown_s` before go-live),
and the head's `$LCD` echo arrives. Then the steps run:

- `{"frame": "..."}` or `{"frames": [...]}`: the gun sends these frames.
- `{"advance_ms": N}`: the clock moves on in `tick_ms` steps, with a tick and the gun's answers at each step.
- `{"stations": [...]}`: the station adverts in range, in a short form (`id`, `kind`, `team`, `state`, `value`,
  `taker`, `median`, `threshold`, `present`). The list is re-sent at every clock step until the next `stations` step.
  `[]` means none in range.
- `{"mc": {...}}`: one MC message.
- `{"fail_next_write": "<prefix>"}`: the next write that carries a frame with this prefix resolves false. Add
  `"count": N` for more than one, and `"lands": true` when the gun takes the write anyway.
- `{"gun": {...}}`: set the fake gun's state (for example `{"answer": false}`).
- `{"ble": "drop"}` and `{"ble": "relink"}`.
- `{"check": "<label>"}`: a checkpoint. `"preamble": true` marks the checkpoint where the match is live and settled.
  It may sit on the first checkpoint only, and every stage trace has it there.

The state fields: `phase`, `alive`, `spawned`, `hp`, `armor`, `shield`, `activeSlot`, `ammo`, `reserve` and `deaths`
always, plus any of `spawnLost`, `reconciling`, `switching`, `reloading`, `poison`, `held` (the held heavy, with `back`,
`base`, `trig`, `suspect` and `unconfirmed`), `claim`, `powerup` (the hint, overshield, grant, swap and spawn cards, the
item a death took, the switch-back and its retry) and `hill` from `setup.fields` (`FIELDS` in
`app/test/golden-trace-runner.mjs`).

After every step that is not a check, the fake gun's answers are fed back before the next step.

The fake gun (`TraceGun`, the same rules in both runners) answers only by these rules, set in `setup.gun`:

- `spawn` (on by default): a `$SPAWN` fills the pools from the head `$PSET`, puts the gun on slot 0, and answers `$LCD`.
- `probe` (on by default): `$LIFE,0,0,0,*` answers `$HP`, and `$QUERY,*` answers `$LCD`, while `answer` is true.
- `life`: any other `$LIFE` moves the pools and answers `$HP`, or `$LCD,0,…` at 0 health.
- `ammo`: an `$AMMO` row on the gun's own slot sets its magazine and reserve.
- `alcd_echo`: every `$WEAP` and `$AMMO` write is answered with an `$ALCD`, as a real gun does (F259).

A frame a step feeds that carries pools (`$HP`, `$LCD`) also sets the fake gun's pools.

## Add a trace

1. Find the unit test whose sequence you want to pin. Port its sequence. Do not invent new behaviour.
2. Write `<name>.json` with `name`, `why`, `source`, `runners`, `setup` and `steps`, and set `"expect": []`.
3. Record it: `cd app && node tools/record-traces.mjs <name>`. A trace with an empty `expect` is written at once.
4. Read the recorded `expect`. Check that it shows what the source test asserts. The recorder writes what the engine
   does, right or wrong.
5. If the trace lists `stage`, run `cd mcp && python3 run_tests.py test_golden_traces`. For each difference, fix the
   runner if the difference is a harness artefact, or add a `stage_ignores` entry with a reason.
6. For an engine-only trace, add one `stage_ignores` entry with `"what": "trace"` that says why the stage cannot run it.

## When to re-record

Re-record only when the engine's behaviour is meant to change. The recorder takes trace names, or `--all`, never
nothing. When a recorded `expect` would change, it refuses, prints each changed checkpoint and exits 1. Read that diff:
every changed write is a change a player's gun will see. Then, only if the change is intended, run it again with
`--accept`. A refactor that is meant to change nothing must not need `--accept`.

## stage_ignores and DIVERGENCE

Each entry has a `what` and a `why`, and may have an `at` to apply at one checkpoint only:

- `state.<field>`: the stage does not compare this state field.
- `write:<prefix>`: writes that start with this prefix are dropped from both sides before the compare.
- `checkpoint:<label>:writes`: the writes at that checkpoint are not compared.
- `trace`: the whole trace is engine-only.

The stage never compares facts and reports: GunStage has no MC link.

A `why` that starts with `DIVERGENCE:` is a real difference between the engine and the stage that a trace exposed and
nobody has fixed yet. Every other `why` is a harness limit (for example, the stage's `sleep` is instant in the runner,
so its timed LED frames land at a different checkpoint). The Python test fails when an entry is no longer needed, so
a closed gap cannot stay hidden. When you fix a divergence in the stage, delete its entry.
