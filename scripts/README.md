# scripts/

| Script | What |
|---|---|
| `start.mjs` (via `./start.sh`, `start.cmd` and `start.ps1`) | A newcomer's one-command setup and start |
| `mc.mjs` (`pnpm mc`) | Start Mission Control from an environment that is already set up. It stops MC gracefully on Ctrl+C, SIGTERM or SIGHUP, and passes MC's start-up exit code through (2 means a home lock or busy port). It redacts `mc.log` by line (rules: `mcp/brx_mcp/mc/redact_patterns.json`, shared with `report.py`), prints the size of `~/.brx-mcp/sessions`, and removes launch folders that are both outside the newest 30 and older than 30 days, logging each (`BRX_MC_KEEP_SESSIONS`, `BRX_MC_KEEP_DAYS`; `--keep-all` skips the prune). Never touches this launch, a folder younger than 10 minutes, a session whose manifest says running with a live process (protected for at most 7 days after the manifest was written), a symlinked root, or anything outside the root |
| `test-all.mjs` (`pnpm run test:all`) | Every test suite at once, inside a memory budget (`CONTRIBUTING.md` → *Running things*) |
| `land.mjs` | The land lane: the queue that puts branches onto `main` (below) |
| `followups-index.mjs` | Generate the index block in `docs/FOLLOWUPS.md`. The lander regenerates it, so locally run it with `--check` only and do not commit a regenerated block (two branches that do conflict on the same line). |
| `regen.mjs` + `generated.json` | The one list of generated files and their generators. `node scripts/regen.mjs --check` exits 1 and names each stale output; `--write [name...]` rewrites them. Exit 2 means a generator failed. |
| `lib/` | Shared logic for the scripts above. The test-all lock, pool and budget are described in `CONTRIBUTING.md` → *Running things*; they are tested from `mcp/tests/test_test_all_*.py`. |
| `test/` | Node tests and fixtures for the scripts (`jobs-snapshot.mjs <fixture>` rewrites the fixture of `mcp/tests/test_test_all_jobs.py`). |

## The land lane (`land.mjs`)

Many agents push to `main` at once. Each of them used to run the full gate before each push, and most of those
runs were repeats. With the land lane, you submit a branch instead. One lander at a time merges a batch of
submitted branches onto `main`, gates the batch once, and pushes it.

It needs **git 2.38 or later** (`git --version`), because its conflict check uses `git merge-tree --write-tree`.
It refuses to start on an older git. On a Mac, `brew install git` and check that `which git` is the Homebrew one.

Its Python needs **pyright** (`pip install pyright`; the WSL `.venv` has it). Every gate refuses a pyright skip (F613),
because the lander stands in for CI's pyright pass, so a venv without it fails every candidate.

### The flow

1. Commit your work on a branch. Run the gate that fits your change (`CONTRIBUTING.md` → *Running things*).
2. Submit the branch:

   ```sh
   node scripts/land.mjs submit --owner <your lane name> [--note "short description"] [--fix-main "reason"]
   ```

   The script refuses uncommitted changes to tracked files, and a branch with no commit that `main` lacks. It also
   refuses a commit message in the branch that carries Claude attribution (`Co-Authored-By: Claude`, `Generated with
   Claude Code`, `Claude-Session`): rewrite the message and submit again. A branch that changes `docs/` must pass docs hygiene before it queues. The check does not run with `--fix-main`, or when no Python is found. It
   pushes HEAD to `land/<UTC time>-<owner>-<slug>` on `origin` and prints the id and the queue position. It never
   pushes `main`. Untracked files are not submitted; the script prints a note when they exist.
   Use `--fix-main "reason"` only for a fix to a red `main`. The reason names the failure, such as a failing test or CI run URL.
   The fix enters the next batch ahead of the normal queue; a running batch continues. Only one fix-main entry
   may wait in the queue at a time. The required reason is recorded in the remote `land-fix/<id>` ref and the result.
   The submit publishes the queue ref and the reason ref together.
3. Wait for the result:

   ```sh
   node scripts/land.mjs wait <id> [--timeout-min 60]
   ```

   The exit code is the answer: 0 landed, 1 red (the failed jobs and the log path), 2 conflict (the conflicting
   files), 3 timeout. On exit 0 the script prints `main <sha>` and the CI run link, if `gh` is installed. That sha is
   the head of the batch the branch landed in (or main's tip, when `wait` reads the result from the refs), not the
   branch's own merge: `git log --grep 'Land <id>' origin/main` finds that one.

   If no lander runs and the queue is not empty, `wait` serves the queue. When this checkout's lander code
   (`land.mjs` and every `scripts/lib` file it loads) matches origin/main's, `wait` runs the lander inside the `wait`
   process. Otherwise it starts a detached lander from `/tmp/brx-land/lander-main-<tag>` at origin/main, which logs to
   `/tmp/brx-land/logs/lander-main-*.log`. A crashed lander therefore never strands the queue, and a lander never
   runs a branch's copy of the code. Exit 6 means the owner withdrew the entry. Exit 4 means the command was refused (a bad id or option, or a
   check before any work), and 5 an unexpected error (a red main, or a git or file failure); never read 5 as red.

4. Withdraw a queued branch that its owner no longer wants:

   ```sh
   node scripts/land.mjs withdraw <id> --owner <your lane name>
   ```

   The owner must match the name in the id. Withdrawal works while a lander runs, for any entry the lander has not
   started: it leaves a marker under `<state>/withdrawn/`, and the lander drops a marked id from its next batch. It
   refuses an id in the active lander batch, and an unknown, landed, red or conflicting id. `wait <id>` then exits 6
   and reports that the branch was withdrawn.
   The in-batch refusal and exit 6 use this machine's lander lock and result store. On another machine, the
   `land/<id>` ref vanishes, but `wait <id>` cannot identify a withdrawal and times out.

`node scripts/land.mjs status [id]` prints the queue, the running lander (pid and start time), recent results and the
flake summary. Like `wait`, it runs the lander when none runs and the queue is not empty (`--no-drive` stops that).
`node scripts/land.mjs run [--batch 4]` runs the lander directly. If another lander holds the lock, `run` exits 0.

After the merges, the lander regenerates the FOLLOWUPS index block (`scripts/followups-index.mjs`) and commits it.
Do not edit the block by hand.

### What the lander does

1. It takes the lander lock (`/tmp/brx-land-<uid>.lock`). A dead pid is reclaimed after 10 s. A live pid with no
   heartbeat is reclaimed after 60 s. The lock is `scripts/lib/land-lock.mjs`; its stale rules are in `scripts/lib/lock.mjs`.
2. It fetches `origin` and takes the first N branches of the queue (`land/*`, sorted by name, so by submit time).
   The oldest queued fix-main entry goes first in the next batch. Each batch contains at most one fix-main entry.
   A `land/` ref that `submit` did not write (a hand push such as `land/0-Tony-x`) is reported and never landed.
   Delete it by hand.
3. It builds the candidate in a scratch worktree. Each lock entry gets its own worktree
   (`/tmp/brx-land/wt-<entry>`), and the lander removes it when it stops. The candidate is `origin/main` plus each
   branch in order, as `--no-ff` merge commits: no squash, no rebase. A branch that conflicts leaves the batch; the
   rest of the batch continues. After the bisect (step 5), the lander tries each conflicting branch once more on top
   of what passed, because its conflict can be with a batch member that then went red.
   The worktree links the main checkout's `node_modules` for `app/`, `site/` and `webapp/mc/`. If the candidate's
   `package.json` or `package-lock.json` differs from the main checkout's, the lander removes the link and runs
   `npm ci` in the worktree instead. A failed install counts as a red job named `install <dir>`.
4. It gates the candidate once: `node scripts/test-all.mjs --cache --ui`. The gate's environment (`BRX_LAND_GATE`, `BRX_FOLLOWUPS_INDEX_FRESH`) makes test-all bypass the cache, so every job reruns, because those variables change what the tests assert. A docs-only candidate also gets
   `--changed <base>`, so only jobs that read docs run. The lander reads the verdict from the gate's
   `results.json` (a candidate older than the record is judged on its printed table). An unreadable record counts as red. The gate must run exactly the jobs that `--list` names.
5. It reruns a failed job alone, once. If the job passes on the rerun, the lander records a flake and continues.
   If the job fails again, the lander bisects the batch. Each half is gated on top of the branches that already
   passed, so the lander also catches a branch that breaks only in combination. Before the lander blames a single
   branch, it runs the failed jobs on `main` alone. If `main` is red on its own, the lander records the red main
   and blames no branch. Only a queued `--fix-main` entry starts a lander on that main, once per fix.
6. It pushes the candidate to `main`, fast-forward only. If the push is rejected because `main` moved (another
   lander, or an emergency push), the branches did not fail. For a shots-only advance, it merges the gated candidate
   onto the new `main` and runs the `site` job on that merge. A conflict or red site job triggers a full remerge and
   regate, as does any other advance. After two retries it stops with "main keeps moving" and leaves the
   batch queued. Just before each push, the lander checks that it still holds the lock. If another lander took the
   lock over (for example after a suspended laptop woke up), it does not push, and the batch stays queued.
   A queued branch that is already on `main` (another lander landed it, an emergency push included it, or a lander
   crashed after its push) is never merged twice: the lander marks it landed and deletes its `land/<id>` ref.
7. It deletes `land/<id>` for each landed branch, along with any `land-fix/<id>` ref. It copies a red or conflicting
   branch to `land-failed/<id>`, then deletes `land/<id>` and any `land-fix/<id>` ref. It never deletes a branch that
   did not land, and it never force-pushes.

The lander loops until the queue is empty. `run --dry-run` builds one batch and prints each merge result and the
job selection. With `--dry-run`, the lander does not gate, push or change a ref.

### Results

Each branch gets `/tmp/brx-land/<id>.json`: `{id, owner, status, fix_main?, main_sha?, failed_jobs?, conflict_files?,
conflicts_with?, log?}`, where `status` is `landed`, `red`, `conflict`, `queued` or `withdrawn`, and `conflicts_with` is
`main` or the id of the batch member that the branch conflicts with. `wait` and `status` also read the result from the refs,
so they work from another machine: a landed branch has a `Land <id>` merge commit on `main`, and a failed branch
has a `land-failed/<id>` ref. From the refs alone, `wait` cannot tell a conflict from a red branch, so it reports
both as red (exit 1). The gate logs are in `/tmp/brx-land/logs` (the newest 200 are kept). Any unexpected error
exits 5, never 1.

To fix a red or conflicting branch, merge `origin/main` into it, fix it, and submit it again. The new submit gets a
new id. You may delete `land-failed/<id>` when you no longer need it.

`node scripts/land.mjs prune [--older-than-days 14] [--dry-run]` deletes `land-failed/<id>` refs and local results,
withdrawn markers and flake rows older than 14 days. It also deletes orphan `land-fix/<id>` refs at any age.
It touches only names this lane makes, and never an id still queued or in a batch. It leaves the flake log alone
while a lander runs, keeps a line that does not parse, and keeps an incident whose window is recent or still open.
A pruned red or conflicting id reads as unknown to `status` and `wait`. The state stays in `/tmp/brx-land`, which macOS clears on reboot.

`node scripts/land.mjs stop` asks the running lander to exit after its current batch, between gates and never in a
push. Use it to put a lander on new code: the next `wait` or `status` starts one from origin/main. The request names
that lander's lock entry, so it never stops the next one. The lock is per user, so `stop` from any clone stops
the one running lander.

### Flakes

Each flake is one line in `/tmp/brx-land/flakes.jsonl`: `{job, step, branches, time, log}`. At the end of each run
the lander prints the flakes of that run and of the last 7 days, per job. Make a job that keeps coming back into a
FOLLOWUPS row.

The flake budget is 3 flakes of one job in 24 hours. These do not count:

- a flake whose own job printed "waiting on outside load" in the pool (the row gets `outside_load: true`);
- a flake inside an incident window (an `{"incident": {"from", "to", "note"}}` line in the same file; no `to` means the
  incident is still open);
- a shared build flake.

These do not count either: a flake dated in the future (the WSL clock can step back), and any flake while an incident
window is still open.

When a flake takes a job over the budget, the lander runs `scripts/lib/changed.mjs` on each branch's own diff (from
its merge base with `main`):

- A branch that was in the flaky gate and whose diff selects the job is red. It may be the cause. This holds after a
  bisect too, when the same gate also had a real failure. Its result's `note` says so, and `wait` prints it on the
  lander's machine (elsewhere `wait` sees only the `land-failed/<id>` branch).
- The other branches are gated again without it, and they land if that gate is green. A budget red alone causes no
  bisect, so a clean re-gate cannot hide it, and no "is main red" check. A real failure in the same gate still bisects.
- A branch accepted before the flake passed a clean gate of its own, so it lands.
- When no branch touches the job, the batch lands. The lander prints a warning and the row text to file.

The flake's line records `over_budget` and `row`.

Set `LAND_FLAKE_BUDGET=off` on the lander during an incident.

### CI

CI stays the check after the push. The lander pushes `main`, and `.github/workflows/ci.yml` runs on that push as
before. `wait` prints the link to that run.

### The emergency path

A direct push to `main` stays possible. Use it only in an emergency, for example when `main` is broken and the
lander cannot land the fix because every gate is red:

```sh
git fetch origin && git merge origin/main   # on the branch that holds the fix
pnpm run test:all                           # gate it yourself
git push origin HEAD:main                   # never with --force
```

Say in the commit message why you used the emergency path. A lander that runs at the same time sees its push
rejected. It then merges its batch onto the new `main`, gates again and pushes (step 6), so the queue carries on.

### Tests and the safety guard

`mcp/tests/test_land.py` drives the real script against a temporary bare remote, with a stub in place of the gate
(`LAND_GATE_STUB`). Two guards keep tests away from the real `origin`:

- `LAND_GATE_STUB` and `LAND_INSTALL_STUB` (the install stub) are refused unless `LAND_TEST=1` is set.
- `LAND_TEST=1` refuses a remote whose URL is not a local path (`file://` or an absolute path).

`LAND_STATE_DIR`, `LAND_LOCK_DIR` and `LAND_POLL_MS` move the state, the lock and the wait interval.
`LAND_GIT_TIMEOUT_MS` caps a network git call (default 600000). Every command takes `--remote <name>` (default
`origin`).

Known limit: the lander compares a candidate's lockfiles with the main checkout's working tree, not with what
is installed in its `node_modules`. Run `npm ci` in the main checkout after you pull a dependency change there.
