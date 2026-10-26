# Contributing to Open BRX

Thanks for looking at this. Open BRX turns stock **Battle Company BRX** laser taggers into a hosted
laser tag system: a laptop Mission Control plus a per-player phone app (or, later, a Companion ESP32)
driving each gun over Bluetooth LE, on stock firmware. Start with [`README.md`](README.md) and
[`docs/README.md`](docs/README.md) (the docs index) before you touch anything.

## The one hard safety rule

**Stock BRX firmware is never modified.** Every capability comes from talking to the tagger over its
documented Bluetooth serial protocol (`protocol/brx-protocol.md`), never from flashing or patching the
gun itself. Power-cycling a tagger always restores it to factory state; that's the safety net, and no
PR may weaken it.

Two things that follow from this:

- The MCP server refuses malformed frames and requires `confirm=true` for any command outside the
  known-safe list enforced in `mcp/brx_mcp/protocol.py`. If you're adding a new command, add it there
  deliberately, don't bypass the guard.
- The panic sequence stops and silences a gun immediately but leaves it unhittable until it's
  re-armed or power-cycled: see `CLAUDE.md` → Hard rules and `protocol/brx-protocol.md` §3. Never end
  a bench session on a bare `$CLEAR`.

If a change you're proposing could brick a tagger, weaken that guard, or leave a gun in a state where
it can't be hit, it needs to be justified explicitly in the PR, not just tested.

## Running things

**Set up the environment first**, if you have not already: `./start.sh --setup-only` (macOS, Linux) or
`start.cmd --setup-only` (Windows) from the repo root. It installs Node.js and Python if needed, creates
the Python `.venv`, and builds the Mission Control console. It stops after setup instead of starting
Mission Control. See `README.md` → *Quickstart: run Mission Control* for the full one-command path, and
the per-piece sections below for what each test suite needs beyond that.

The repo has several independently-testable pieces, useful while you iterate on one of them (see each
piece's own command below). **Before opening a PR, run `pnpm run test:all`** (plus `-- --ui` if you
touched `app/src`, `webapp/mc/src`, a UI gate or an e2e script): that is the final check, not any one
suite on its own.

**Everything at once:** `pnpm run test:all` from the repo root runs the unit gates of all four pieces in parallel
(about 30 s). `pnpm run test:all -- --ui` adds the browser gates: `app` screens, moments, logsync and e2e, and every
`webapp/mc` e2e script (about 7.5 min on a 32-core box). `pnpm run test:all -- site mcp` runs only the jobs whose names
match, and `-- --list` prints the names. It builds `app/www` once first, gives every e2e script its own free ports, and
writes one log per job (`scripts/test-all.mjs` states the parallel-safety rules it depends on).

How runs share the machine:

- **One run per checkout, many checkouts at once.** A per-checkout lock stops two runs from sharing build outputs.
  Runs from different worktrees (and the land lane) run together: each build and job takes a lease from a shared pool
  in `/tmp/brx-test-pool-<uid>/`, admitted first in, first out, except that a land-lane gate has priority: local runs slow down instead.
- **Memory and cores.** The pool admits within 10,000 MB and 24 cores, and keeps 3,000 MB of available memory free
  (`BRX_TEST_POOL_MB`, `BRX_TEST_POOL_CORES`, `BRX_TEST_POOL_RESERVE_MB`). One run's own budget is half the free
  memory, at most 8 GB (`MEM_BUDGET_MB`).
- **Tasks (threads and processes).** On WSL every process, every Claude session and Mission Control included, shares
  one cgroup whose cap is `/sys/fs/cgroup/init.scope/pids.max`.
  Exhausting it crashes everything ("can't start new thread"). test-all reads the live cap and count and keeps 1,500
  tasks free (`BRX_TEST_TASK_RESERVE`); a job blocked by other processes waits up to 60 min, printing the biggest. Each job
  carries a task allowance (the defaults in `scripts/lib/budget.mjs`, or its own `tasks` in `scripts/lib/jobs.mjs`), counted until its measured use reaches it, and the
  `app-screens` shard count shrinks to fit, never below 2 unless the machine plans fewer even when idle (a smaller run waits for room). Where there is no cgroup limit (macOS), this check is off.
- **Timeouts.** A job that runs past 10 min, or three times its typical time (capped at one hour) if longer, is killed
  (`JOB_TIMEOUT_S=` sets the floor). A job whose task request can never fit under the cap fails with the reason as soon as it holds
  the pool alone; outside load that keeps the headroom too low fails it after 60 min.

What every job can rely on:

- **It tests this checkout's Python.** The dev venv's editable `brx_mcp` points at the main checkout. test-all puts
  `<checkout>/mcp` first on `PYTHONPATH` for every job and sets `BRX_MCP_EXPECT_DIR`, and `brx_mcp/__init__.py` then
  refuses to import from anywhere else. A start-of-run probe stops the run if the import resolves elsewhere.
- **Build state stays in the checkout.** A new `git worktree add` has no `node_modules` in `app/`, `site/` or
  `webapp/mc/`: they are per checkout. Run `npm ci` in each, or symlink each from the main checkout. A symlinked
  `node_modules` is shared, so anything written there is shared too: TypeScript's incremental build info once let
  `tsc -b` skip a branch's type check (a false green). The land lane's scratch worktree links them itself.
  Every `tsBuildInfoFile` lives in `.tsbuild/` and every Vite/Vitest `cacheDir` in `.vite-cache/`, both per checkout
  and git-ignored. `mcp/tests/test_build_state_in_checkout.py` fails if a config puts build state under
  `node_modules` or outside the checkout.

`pnpm run test:all -- --cache` reuses successful job results when the job's declared inputs
(`inputs` in `scripts/lib/jobs.mjs`), command and tools match. Caching is off by default. Entries live at
`$(git rev-parse --git-common-dir)/brx-test-cache`; delete that directory to clear them. A run with an environment
variable that can change a result is not cached (it says which). Use `--no-cache` to run without cached results.
The land lane runs its full gate without the cache (its environment bypasses it, so every job reruns), and also without it for failure reruns. Run
`pnpm run test:all -- --no-cache` nightly as the cache canary.

**After merging `origin/main`** into a branch that was already green, re-run only what the merge could have
touched: `pnpm run test:all -- --changed [base]` (the base, if given, goes right after `--changed`) diffs
against `base` (tracked changes plus any untracked files), maps the changed paths to jobs (`scripts/lib/changed.mjs`),
and prints the selection and why. Default base: `HEAD^1` if HEAD is a merge commit (its first parent is the
branch before the merge), else the merge-base with `origin/main`. Right after `git merge origin/main`, though,
that merge-base IS origin/main's own tip, so the default omits everything the merge just brought in: pass the
base you last tested explicitly whenever you are not calling `--changed` immediately after the merge. If only docs
came in, `mcp` (docs hygiene), `site` (which renders `docs/platform`/`docs/manual`) are needed, plus `app-test` when
`docs/announcer.md` changed (its test reads that file). An unknown top-level directory selects `mcp` only. An unmapped path inside a known
tree, or a change to the runner itself, the root `package.json`/`pnpm-lock.yaml` or a CI workflow file
(`FULL_SUITE_TRIGGERS` in `scripts/lib/changed.mjs`), selects everything: fail safe, never a
narrower guess. A job name typed after `--changed` (e.g. `--changed [base] mcp site`) ADDS to that selection, a
union, never a replacement: if the diff's own fail-safe already picked everything, naming jobs by hand adds
nothing, it never narrows the run back down to just the names typed. The line printed just before the jobs
start lists the final selection and why each job is in it (from the diff, or named on the command line).
`--changed` adds `--ui` itself whenever the selection includes a UI-only job. CI runs only `mc-play` of the browser gates, as a
blocking job (F512), and does not run `site`. The lander runs all UI gates, but a red result costs a batch.
The full `--ui` gate stays the rule before the FIRST push of a UI change in a branch.

**After you edit a generator's source**, run `node scripts/regen.mjs --check`. It names each stale output and the
command that rewrites it (`--write <name>`). The list of generators is `scripts/generated.json`, and
`mcp/tests/test_generated_fresh.py` fails until every output is fresh.

**When you add or change a test**, keep the suite parallel-safe. `test:all` runs every job at once, under load:

- **Ports.** A `webapp/mc/test/e2e/` script reads `MC_PORT`, `MC_WS_PORT` and `VITE_PORT` from its environment and
  takes every other port from `await freePort()` in `scripts/lib/ports.mjs`. test-all gives each of these jobs its own
  block of 40 ports below the kernel's ephemeral range (`env: jobBlockEnv` in `scripts/lib/jobs.mjs`), because a
  port-0 pick can go to another listener first (F523: a job lost its port under load, and a repro saw 11 of 200 picks
  handed out again). A new job of that kind takes the
  same `env`. Outside test-all, `freePort()` falls back to a port-0 pick. Any other test may listen on 0 or read the
  port from an env var. Never use a literal port.
- **Output.** Write output to the test's own folder, never a folder another test writes.
- **Time.** Wait for a condition, or use a mocked clock (`mock.timers`, `vi.useFakeTimers`). A fixed sleep races
  under load.
- **Cleanup.** Clean up in `after`/`finally`, so a failed assertion cannot leave a server or a timer that hangs the run.
- **Proof.** Break the behaviour once and watch the test fail.
- **Slow Python files.** A new Python test file slower than about 5 s goes into `SPLIT` in `mcp/run_tests.py`.

A Python test in `mcp/tests` is
a plain zero-argument `test_*` function: `run_tests.py` calls each one with no arguments and has no pytest fixtures
(`test_tests_run_without_fixtures.py` enforces it; `_skip.pytest_only` marks the rare test that needs pytest). A new test-all job is one record in
the job registry, `scripts/lib/jobs.mjs`: its command, measured `mb` and `secs`, flags and inputs. A `webapp/mc/test/e2e/`
script needs only a line in its `E2E` table there. `mcp/tests/test_suite_registry.py` fails until the gate script is
registered, and `test_test_all_jobs.py` shows the change as a fixture diff (the file says how to regenerate it).

**Python server + Mission Control (`mcp/`)** — zero external test runner, works under plain system
Python:
```bash
cd mcp && python3 run_tests.py            # everything
cd mcp && python3 run_tests.py modes cs   # only files matching these substrings
cd mcp && python3 run_tests.py -j 1       # one file at a time; --inline runs every file in one process, streamed
cd mcp && python3 run_tests.py chaos      # chaos testing only (its own `chaos` job in test:all; docs/chaos-testing.md)
```
No hardware needed; tests that require optional extras (websockets etc.) skip cleanly if they're
missing rather than failing the run. `test:all` runs this suite under the repo `.venv` (or `MC_PY`), so it never
shows a missing-extra import. When you import an optional extra, also run `cd mcp && python3 run_tests.py` under
system python, as CI's first pass does. Two places refuse such skips (`run_tests.py --no-skip <name>`): CI's second
pass, after it installs the extras, and `test:all` with the repo `.venv`, for websockets and uvicorn (its `mc`
extra). A filter that matches no file exits 2. The suite includes a static-type gate: `pip install pyright`
once (the WSL venv already has it), then `cd mcp && python3 -m pyright` for the full list of errors.
`run_tests.py pyright` is what actually gates the suite — it SKIPS cleanly where pyright isn't
installed (the bench box's system python), and CI installs pyright for its second, with-extras pass.

**Phone app (`app/`)**, native Capacitor app for Android + iOS:
```bash
cd app && npm test
```
This runs `node --test` over `test/*.test.mjs`, then builds the HUD and runs the focused A38 standby screen-truth
gate in Chromium at both phone sizes. Install that browser once with `npx playwright install chromium` (CI uses
`--with-deps`). The root parallel runner uses the prebuilt/private-output form so no job rewrites another job's
bundle or captures. `test/transport.test.mjs` starts its own MC on a free port. See `app/README.md` for
build/signing/APK details; that file is the authority on anything platform-specific.

**Golden traces** (`app/test/fixtures/traces/`) replay recorded engine runs through `engine.js` and through the bench
stage. A change to engine behaviour is re-recorded on purpose: read `app/test/fixtures/traces/README.md` first (it
owns the `--new` and `--accept` rules of `app/tools/record-traces.mjs`).

**Mission Control web UI (`webapp/mc/`)**, Vite/React/TS:
```bash
cd webapp/mc && npm run build   # tsc -b && vite build
cd webapp/mc && npm test        # vitest run
cd webapp/mc && npm run dev     # local dev server; add ?mock for the in-browser demo, no server needed
```

**Public website generator (`site/`)**, two doors onto one source (`docs/platform/*.md` → the
marketing landing, `/docs/*` and `/download`; `docs/manual/*.md` → `/manual/*`), built to the contract
in `docs/site/README.md` + `docs/site/FORMAT.md`:
```bash
cd app && npm run build   # the landing embeds the real phone HUD; site/build.mjs fails without app/www
cd site && npm test           # builds first (site/test/global-setup.mjs)
```
`npm test` builds first, then runs the Playwright suite over two projects, desktop and phone. That suite is the UI
verification checklist for the generated site and refuses to run against a stale build, so always let
it build rather than reusing an old `webapp/`. **The generated pages are git-ignored** (`.gitignore`):
a push to `main` deploys the site, and Cloudflare rebuilds it itself (`wrangler.toml`'s `[build]` runs
`npm run build:ci`), so there is nothing to rebuild or commit locally. Commit only the source
(`docs/platform/`, `docs/manual/`, `site/`); never hand-commit `webapp/` output. `webapp/mc/` and
`webapp/download/build.json` are the exception — they're hand-kept, not generated, and stay tracked.

`site/shots/` holds the marketing screenshots, generated from the real UIs by `cd site && npm run shots`.
⚠ **Never write GitHub's skip keyword in a commit message, not even to explain it.** GitHub scans the
whole message, so a commit that described the shots job's loop guard and quoted the token ran no CI at
all: no red build, no queued run, only the Cloudflare check on the commit (2026-09-18). Say "the skip
keyword" in prose and leave the literal token in the workflow file, where it is inert.

The `site-shots` job in `.github/workflows/ci.yml` regenerates them on every push to `main` that leaves
them stale, and commits the result back as `github-actions[bot]`. **Do not capture the shots by hand
after a UI change**, and nothing local checks their staleness any more (2026-09-26): a hand capture
only races the job's own commit. `test_site_shots.py` still checks that the manifest matches the files
and that every shot is small.
That job never forces anything: if `main` moves under it, it replays its commit on the new tip. If
the move touched a UI, it abandons the capture with a notice and exits green, because the run queued
behind it captures the newer UI. A red `site-shots` is therefore a real fault (the capture failed, wrote
nothing, or could not push). Read the log, then run `cd app && npm run build && cd ../webapp/mc && npm run
build`, then `cd site && npm run shots`, and commit `site/shots/` yourself.

## Landing on main (the land lane)

Do not push to `main` directly except in an emergency. Submit your branch instead (the steps and every exit code are in `scripts/README.md` → *The land lane*):

```sh
node scripts/land.mjs submit --owner <your lane name> --note "short description"
node scripts/land.mjs wait <id>   # 0 landed; any other exit: see scripts/README.md
```

A red or conflicting branch moves to `land-failed/<id>`: merge `origin/main` into it, fix it, and submit it
again. Full detail — how the lander works, the flake log, and the emergency direct-push path — is
`scripts/README.md` → *The land lane*.

## The evidence culture

The heart of this repo is that **a claim about the hardware needs provenance**, not just plausibility.
`docs/manual/` is the canonical home for confirmed BRX facts (the same source the public site is built
from); `docs/spec/contracts.md` is the spec of record for the software's data model and wire protocol.
Read [`docs/manual/README.md`](docs/manual/README.md) before adding or editing a manual page — in
short:

- The manual is **plain markdown**, one file per page: no block syntax, no provenance badge, and no
  per-sentence `src:` line (`docs/site/FORMAT.md`). Confidence lives outside the page, in
  `docs/experiment-log/` and `docs/FOLLOWUPS.md`, not attached to each sentence.
- Only confirmed facts get published. If it's a guess, it belongs in a FOLLOWUPS row or the
  experiment log, not the manual page itself.
- A fact lives in exactly one manual file. Other docs link to it; they don't restate it.
- If you're wrong and something needs retracting, fix it **at the source**: the `protocol/` row, the
  manual page, the spec, and the code/comment built on it, in the same change. A stale answer left in
  place recruits the next person who reads it; an open question only warns them.

`docs/manual/` and `docs/platform/` also have a house style: see `docs/site/FORMAT.md` → *House style*.

## Session-close discipline

If you're doing anything beyond a small, self-contained fix, close the session with the three writes (log entry,
FOLLOWUPS diff, HANDOFF lane update). The rule is in [`docs/README.md`](docs/README.md) → *Session close is three
writes*.

A new confirmed fact goes into `protocol/` or `docs/manual/` in the same commit that introduces it, or
gets a FOLLOWUPS row saying "promote X" if it isn't ready yet.

## Hardware contributions

Most claims about tagger behavior need a real gun to back them. If your change asserts something about
hardware behavior (a command's effect, a timing value, an LED pattern), it needs a bench observation
behind it, not just a reading of the protocol docs or the APK teardown. `docs/FOLLOWUPS.md` has a
"MVP BENCH" group for exactly this: things that need someone with hands on a gun
and headset to settle. If you can't get bench time, open the question there instead of guessing at an
answer and writing it into the manual.

## What never gets committed

- **No raw third-party assets.** Anything extracted from Battle Company's own APK or app data is
  restated in our own words, never committed verbatim. The one deliberate exception is closed
  (`protocol/callsign-extract/RAW_ASSETS_NOTE.md`): the repo is public now, so raw configs never land
  here again, even temporarily.
- **No device identifiers.** Headset sticker ids and Bluetooth MAC/UUID addresses never enter the repo.
  Use a placeholder like `Tactix-XXXX` or `GUN-A` in examples. `mcp/tests/test_docs_hygiene.py`
  mechanically checks tracked files for sticker-id patterns and will fail the build if one lands; keep
  MAC addresses and other device-specific identifiers out on the same principle even where nothing
  greps for them yet.
- **No em dashes in `docs/manual/` or `docs/platform/`:** see `docs/site/FORMAT.md` → *House style* (`site/build.mjs` enforces it).
- **No hand-edits to generated output.** `app/ios/`, `app/android/`, `app/www/app.js`, and the site
  generator's output under `webapp/` are all git-ignored and rebuilt from source; a regeneration wipes
  anything you hand-edited there. `webapp/mc/` and `webapp/download/build.json` are the opposite case:
  hand-kept and tracked, never touched by the site build. If something in a generated tree is wrong,
  fix the generator or the source it reads, not the output.

## Proposing a change

Open an issue or a pull request against `main`. Small, well-scoped changes are easier to review than
large ones, especially anything touching the protocol layer or the spec.

For a **Mission Control** bug, use the
[bug report form](https://github.com/tony99nyr/open-brx/issues/new/choose) and attach a report zip:
run `./start.sh --report` (`start.cmd --report` on Windows), or press **Report a problem** in the
console. Open the zip and check it before you post: the issue is public. See `docs/platform/run.md`
→ *Reporting a problem*.

For a **hardware/protocol** bug report or finding, include what you'd want if you were debugging it
cold:
- The tagger's firmware/generation (e.g. Tactix2 v4.32) and whether a headset was paired and powered.
- The exact command(s) sent, or the app/mode that triggered the behavior.
- What the gun actually did (LEDs, sound, `$HP`/`$SIR` state) versus what you expected.
- Whether the result was one-off or repeatable, and under what conditions.

For a **software** PR, run `pnpm run test:all` (plus `-- --ui` for a UI change) first and say the
result in the PR description. If you added or changed a fact in `docs/manual/`, link the supporting
experiment-log or followup evidence in the PR body; manual pages intentionally do not carry per-sentence
`src:` lines.

## Credit

Protocol discovery for BRX originates with **[LaserTagMods](https://github.com/LaserTagMods)**
(the JEDGE/JBOX projects). This project is an independent implementation built on that discovery work,
not a fork of theirs, and anything public-facing (docs, the website, release notes) needs to credit
them. If your change draws on LaserTagMods material, JEDGE/JBOX, or another named community source, say
so in the PR and cite it the way `docs/reference/` already does.
