# scripts/

| Script | What |
|---|---|
| `start.mjs` (via `./start.sh`, `start.cmd` and `start.ps1`) | A newcomer's one-command setup and start |
| `mc.mjs` (`pnpm mc`) | Start Mission Control from an environment that is already set up |
| `mc-collect.mjs` (`pnpm mc:collect`) | Create the diagnostic index of a Mission Control run |
| `test-all.mjs` (`pnpm run test:all`) | Every test suite at once, inside a memory budget (`CONTRIBUTING.md` → *Running things*) |
| `land.mjs` | The land lane: the queue that puts branches onto `main` (below) |
| `lib/` | Shared logic for the scripts above (the test-all lock, budget and `--changed` logic is unit tested from `mcp/tests/test_test_all_*.py`) |

## The land lane (`land.mjs`)

Many agents push to `main` at once. Each of them used to run the full gate before each push, and most of those
runs were repeats. With the land lane, you submit a branch instead. One lander at a time merges a batch of
submitted branches onto `main`, gates the batch once, and pushes it.

### The flow

1. Commit your work on a branch. Run the gate that fits your change (`CONTRIBUTING.md` → *Running things*).
2. Submit the branch:

   ```sh
   node scripts/land.mjs submit --owner <your lane name> [--note "short description"]
   ```

   The script refuses uncommitted changes to tracked files, and a branch with no commit that `main` lacks. It
   pushes HEAD to `land/<UTC time>-<owner>-<slug>` on `origin` and prints the id and the queue position. It never
   pushes `main`. Untracked files are not submitted; the script prints a note when they exist.
3. Wait for the result:

   ```sh
   node scripts/land.mjs wait <id> [--timeout-min 60]
   ```

   The exit code is the answer: 0 landed (the script prints the `main` sha and the CI run link, if `gh` is
   installed), 1 red (the failed jobs and the log path), 2 conflict (the conflicting files), 3 timeout. If no lander
   runs and the queue is not empty, `wait` runs the lander itself. A crashed lander therefore never strands the
   queue.

`node scripts/land.mjs status [id]` prints the queue, the running lander (pid and start time), recent results and the
flake summary. Like `wait`, it runs the lander when none runs and the queue is not empty (`--no-drive` stops that).
`node scripts/land.mjs run [--batch 4]` runs the lander directly. If another lander holds the lock, `run` exits 0.

### What the lander does

1. It takes the lander lock (`/tmp/brx-land-<uid>.lock`). The lock uses the stale rules of test-all's lock
   (`scripts/lib/lock.mjs`), so the lander takes over the entry of a crashed lander.
2. It fetches `origin` and takes the first N branches of the queue (`land/*`, sorted by name, so by submit time).
3. It builds the candidate in a scratch worktree (`/tmp/brx-land/wt`, reused between runs). The candidate is
   `origin/main` plus each branch in order, as `--no-ff` merge commits: no squash, no rebase. A branch that
   conflicts leaves the batch; the rest of the batch continues.
4. It gates the candidate once: `node scripts/test-all.mjs --changed <main tip> --ui`, with no job names. The gate
   must run the same number of jobs that `--list` names. A different number stops the lander with an error. The
   lander does not count that as a pass.
5. It reruns a failed job alone, once. If the job passes on the rerun, the lander records a flake and continues.
   If the job fails again, the lander bisects the batch. Each half is gated on top of the branches that already
   passed, so the lander also catches a branch that breaks only in combination. Before the lander blames a single
   branch, it gates `main` alone. If `main` is red on its own, the lander stops and blames no branch.
6. It pushes the candidate to `main`, fast-forward only. If the push is rejected because `main` moved (another
   lander, or an emergency push), the branches did not fail. The lander fetches, merges the same branches onto the
   new `main`, gates again and pushes again. After two retries it stops with "main keeps moving" and leaves the
   batch queued. A branch that is already on the new `main` (another lander landed it) is skipped, never merged
   twice.
7. It deletes `land/<id>` for each landed branch. It copies a red or conflicting branch to `land-failed/<id>`,
   and only then deletes `land/<id>`. It never deletes a branch that did not land, and it never force-pushes.

The lander loops until the queue is empty. `run --dry-run` builds one batch and prints each merge result and the
job selection. With `--dry-run`, the lander does not gate, push or change a ref.

### Results

Each branch gets `/tmp/brx-land/<id>.json`: `{id, owner, status, main_sha?, failed_jobs?, conflict_files?, log?}`,
where `status` is `landed`, `red`, `conflict` or `queued`. `wait` and `status` also read the result from the refs,
so they work from another machine: a landed branch has a `Land <id>` merge commit on `main`, and a failed branch
has a `land-failed/<id>` ref.

To fix a red or conflicting branch, merge `origin/main` into it, fix it, and submit it again. The new submit gets a
new id. Delete `land-failed/<id>` when you no longer need it.

### Flakes

Each flake is one line in `/tmp/brx-land/flakes.jsonl`: `{job, step, branches, time, log}`. At the end of each run
the lander prints the flakes of that run and of the last 7 days, per job. Make a job that keeps coming back into a
FOLLOWUPS row.

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

- `LAND_GATE_STUB` is refused unless `LAND_TEST=1` is set.
- `LAND_TEST=1` refuses a remote whose URL is not a local path (`file://` or an absolute path).

`LAND_STATE_DIR`, `LAND_LOCK_DIR` and `LAND_POLL_MS` move the state, the lock and the wait interval.

Known limits:

- The scratch worktree uses the main checkout's `node_modules` through symlinks. A batch that changes a
  `package-lock.json` is gated with the old dependencies.
- Two landers on one machine share `/tmp/brx-land/wt` and so must share the lock. Do not give them different
  `LAND_LOCK_DIR` values.
