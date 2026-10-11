// Pure scheduling math for scripts/test-all.mjs, kept out of that file so a tuned constant can be checked
// (mcp/tests/test_test_all_budget.py) without spinning up the whole parallel runner.
//
// Measured 2026-09-27 on a 32-core box: a full `app-screens` run (1286 steps) does about 6300 shard-seconds
// of real work (steps mostly wait out a stage timeline, not CPU), so wall time is that total divided across
// the shards it gets. The OLD `secs: 1500 / SCREENS_S` estimate was about 4x too small, so test-all.mjs's own
// 3x-typical kill timeout fired under load (a shared box, or another agent's run competing for the same cores).

export const SCREENS_SHARD_MB = 240;

/** Workers for a parallel runner: a quarter of the cores, and never more than a quarter of the memory budget
 *  for its share of workers (each one costs about `perMb`). */
export function workerCount(perMb, cap, cpus, budgetMb) {
  return Math.max(1, Math.min(cap, Math.floor(cpus / 4), Math.floor(budgetMb / 4 / perMb)));
}

/** Size a job using this run's share and the capacity available when the pool admits it. */
export function admissionShare(ownMb, freeMb, ownCores, freeCores) {
  return { budgetMb: Math.max(1, Math.min(ownMb, freeMb)), cpus: Math.max(1, Math.min(ownCores, freeCores)) };
}

// F429/F430 (2026-09-27): two e2e jobs died mid-run ("Target page, context or browser has been closed") while
// test-all.mjs's own printed total sat at 7990 of an 8000 MB budget -- the PLAN left no headroom at all for a
// job's `mb` running low, or for anything else on the box. HEADROOM is the fraction of the budget a run may ever
// plan to use; the rest is slack. Measured the same day (ps RSS summed over each job's process tree, one run
// each, not under load): mc-standby 1043 MB against a declared 700 (49% low), mc-game-edit 787 MB against 700
// (12% low), app-logsync 438 MB against 300 (46% low) -- a real, not hypothetical, undercount across the board.
export const HEADROOM = 0.85;
export const TASK_RESERVE = Number(process.env.BRX_TEST_TASK_RESERVE || 1500);
// Measured 2026-10-05 from the pool leases' observedTasks over a full --no-cache --ui run (box peak 2,931 of 4,915),
// each set about 25% above its job's peak: site 528, app-test 230-277, an app-screens shard ~55, mc-play 234, other
// browser jobs at most 187, app-moments 107, app-logsync 83, mc-vitest 80, everything else at most 52. A job whose use
// differs from these defaults carries its own `tasks` in scripts/lib/jobs.mjs.
export const TASK_ALLOWANCES = { site: 660, appTest: 340, screensShard: 70, ui: 240, other: 70 };

/** True when a request for `tasks` must wait on task headroom. `taskCap` is the pool's capacity view
 *  ({available} = free - reserve - pending leases), or null when the box has no task cap. A zero-task request never
 *  waits: under a loaded box `available` goes negative (2026-10-05). The pool asks this in every admission path. */
export function taskBlocked(tasks, taskCap) {
  return Boolean(taskCap) && tasks > 0 && tasks > taskCap.available;
}

/** Bound app-screens shards by live task headroom while keeping the memory and CPU cap. */
export function taskScreensShards(cap, free, reserve, pending = 0) {
  return Math.max(1, Math.min(cap, Math.floor((free - reserve - pending) / TASK_ALLOWANCES.screensShard)));
}

/** A job's task allowance: its own `tasks` (scripts/lib/jobs.mjs sets it where the measured use differs), else per
 *  app-screens shard, else the UI or the default allowance. */
export function jobTaskAllowance(job) {
  if (job.tasks != null) return job.tasks;
  if (job.name === 'app-screens') return TASK_ALLOWANCES.screensShard * (job.screensShards || 1);
  return job.ui ? TASK_ALLOWANCES.ui : TASK_ALLOWANCES.other;
}

/** app-screens' shard count and the `mb`/`secs` JOBS needs for it: half the cores, at most 16, and never more
 *  than the HEADROOM-adjusted budget minus `otherUiMb` (every OTHER ui:true job test-all.mjs is about to run
 *  this time). That reservation is capped at half of the HEADROOM target, so a full `--ui` run (every e2e job
 *  selected, `otherUiMb` far past the whole budget on its own) still leaves app-screens its historical fair
 *  half, rather than starving it to one shard -- but a narrower `--changed`/filtered run, which drops most of
 *  those jobs, correctly leaves app-screens the rest. This is capped against what's LEFT after the other UI jobs
 *  are planned, never the whole budget: the whole budget is what let app-screens and the rest jointly fill every
 *  last MB of it (a shard is its own browser, ~240 MB: 16 shards are ~3.9 GB). */
export function screensBudget(cpus, budgetMb, otherUiMb = 0) {
  const target = budgetMb * HEADROOM;
  const forScreens = Math.max(0, target - Math.min(otherUiMb, target / 2));
  const shards = Math.max(1, Math.min(16, Math.floor(cpus / 2), Math.floor(forScreens / SCREENS_SHARD_MB)));
  const { mb, secs } = screensJobSize(shards);
  return { shards, mb, secs };
}

/** Resource lease for app-screens at the requested shard count. */
export function screensJobSize(shards) {
  return { mb: 100 + SCREENS_SHARD_MB * shards, secs: 6300 / shards, cores: shards };
}

/** Predicts the peak concurrent `mb` a run of `jobs` ({mb, secs}) would reach under test-all.mjs's own scheduler:
 *  sort longest first, start whatever fits inside `budgetMb`, free a job's `mb` once its `secs` elapses, try the
 *  rest of the queue again. `secs` stands in for wall time, so this is a planning estimate for printing before a
 *  run starts (and for pinning in tests), not a replacement for the real, live peak the run measures. */
export function planPeakMb(jobs, budgetMb) {
  const queue = [...jobs].sort((a, b) => b.secs - a.secs);
  const running = [];
  let time = 0, used = 0, peak = 0;
  const tryStart = () => {
    for (let i = 0; i < queue.length;) {
      const j = queue[i];
      if (running.length > 0 && used + j.mb > budgetMb) { i++; continue; }
      queue.splice(i, 1);
      used += j.mb; peak = Math.max(peak, used);
      running.push({ mb: j.mb, finish: time + j.secs });
    }
  };
  tryStart();
  while (running.length) {
    running.sort((a, b) => a.finish - b.finish);
    const next = running.shift();
    time = next.finish; used -= next.mb;
    tryStart();
  }
  return peak;
}

// app-screens costs about 5300 shard-seconds (885 s on 6 shards), and deriveTimeoutS caps a job at 3600 s, so one
// shard can never finish: on a loaded box it was killed with no step failed (2026-10-11). Two shards take about 2650 s.
// The floor stays at two: a higher one asks for more memory, and the pool's memory wait has no deadline.
export const SCREENS_MIN_SHARDS = 2;

/** The shards to ask the pool for: what the share and the free tasks allow, but never fewer than SCREENS_MIN_SHARDS
 *  (asking for more than is free makes the pool wait), unless the machine plans fewer even when idle (`planned`). */
export function screensAdmissionShards(planned, sizedShards, freeTasks) {
  const fit = Number.isFinite(freeTasks) ? Math.floor(freeTasks / TASK_ALLOWANCES.screensShard) : Infinity;
  return Math.max(Math.min(SCREENS_MIN_SHARDS, planned), Math.min(sizedShards, fit));
}

/** A job's kill timeout: normally 3x its typical `secs`, but never less than the explicit JOB_TIMEOUT_S floor
 *  (an operator's override is never silently capped) and never more than `capS` for the DERIVED (3x) term alone
 *  (2026-09-27 review: on a tiny/starved box, 1 screens shard makes `secs` alone 6300s, and 3x that would hold a
 *  hung job -- and an agent -- for over 5 hours). */
export function deriveTimeoutS(jobTimeoutS, secs, capS = 3600) {
  return Math.max(jobTimeoutS, Math.min(Math.ceil(3 * secs), capS));
}

// The shared builds' leases (test-all's withBuildLease). A lander gate's memory reservation covers the builds that will
// run: a gate that selects only cheap jobs still has to build first (Codex review, 2026-10-10).
export const APP_BUILD_MB = 800;
export const MC_DIST_BUILD_MB = 550;
