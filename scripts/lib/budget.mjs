// Pure scheduling math for scripts/test-all.mjs, kept out of that file so a tuned constant can be checked
// (mcp/tests/test_test_all_budget.py) without spinning up the whole parallel runner.
//
// Measured 2026-09-27 on a 32-core box: a full `app-screens` run (1286 steps) does about 6300 shard-seconds
// of real work (steps mostly wait out a stage timeline, not CPU), so wall time is that total divided across
// the shards it gets. The OLD `secs: 1500 / SCREENS_S` estimate was about 4x too small, so test-all.mjs's own
// 3x-typical kill timeout fired under load (a shared box, or another agent's run competing for the same cores).

/** Workers for a parallel runner: a quarter of the cores, and never more than a quarter of the memory budget
 *  for its share of workers (each one costs about `perMb`). */
export function workerCount(perMb, cap, cpus, budgetMb) {
  return Math.max(1, Math.min(cap, Math.floor(cpus / 4), Math.floor(budgetMb / 4 / perMb)));
}

// F429/F430 (2026-09-27): two e2e jobs died mid-run ("Target page, context or browser has been closed") while
// test-all.mjs's own printed total sat at 7990 of an 8000 MB budget -- the PLAN left no headroom at all for a
// job's `mb` running low, or for anything else on the box. HEADROOM is the fraction of the budget a run may ever
// plan to use; the rest is slack. Measured the same day (ps RSS summed over each job's process tree, one run
// each, not under load): mc-standby 1043 MB against a declared 700 (49% low), mc-game-edit 787 MB against 700
// (12% low), app-logsync 438 MB against 300 (46% low) -- a real, not hypothetical, undercount across the board.
export const HEADROOM = 0.85;

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
  const shards = Math.max(1, Math.min(16, Math.floor(cpus / 2), Math.floor(forScreens / 240)));
  return { shards, mb: 100 + 240 * shards, secs: 6300 / shards };
}

// The e2e() jobs test-all.mjs runs beside app-screens (name without the `mc-` prefix, typical `secs`, `mb`
// defaulting to 700 -- see test-all.mjs's own e2e() helper). Kept here, not just in test-all.mjs, so
// screensBudget's caller can total up "the other UI jobs" from the one place they're defined, and so this
// file's own tests exercise the real numbers instead of a second, driftable copy. mb bumped 2026-09-27 (see
// HEADROOM's comment): the 700 tier covers the lighter e2e scripts, 900 covers the ones already known heavier
// (2026-09-23's MC visual QA note), each nudged up now that a direct measurement showed 700 itself runs low.
export const E2E_SPECS = [
  ['koth', 45], ['backhaul', 20], ['kit-continue', 22], ['end-delivery', 13], ['standby', 87, 1100], ['m2-ui', 46],
  ['game-edit', 32, 850], ['operator-menu', 18], ['report', 15],
  ['frame', 7, 1050], ['lobby-updating', 3, 1050], ['recap-next', 20, 1050], ['feed-reload', 9, 1050],
  ['mc-restart', 13, 1050], ['live-board', 19, 1050],
  ['vqa2', 27, 1050], ['play', 35, 1100], ['build', 8, 1050], ['lobby-outcome', 7, 1050], ['observability', 25, 1050],
];
const E2E_DEFAULT_MB = 850;

/** Every UI job test-all.mjs runs besides app-screens: app-logsync, app-moments, app-e2e and every E2E_SPECS
 *  entry (named `mc-<script>`, matching test-all.mjs's e2e() helper), as `{name, mb, secs}`. */
export const OTHER_UI_JOBS = [
  { name: 'app-logsync', mb: 450, secs: 11 },
  { name: 'app-moments', mb: 650, secs: 60 },
  { name: 'app-e2e', mb: 1300, secs: 65 },
  ...E2E_SPECS.map(([name, secs, mb = E2E_DEFAULT_MB]) => ({ name: `mc-${name}`, mb, secs })),
];

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

/** A job's kill timeout: normally 3x its typical `secs`, but never less than the explicit JOB_TIMEOUT_S floor
 *  (an operator's override is never silently capped) and never more than `capS` for the DERIVED (3x) term alone
 *  (2026-09-27 review: on a tiny/starved box, 1 screens shard makes `secs` alone 6300s, and 3x that would hold a
 *  hung job -- and an agent -- for over 5 hours). */
export function deriveTimeoutS(jobTimeoutS, secs, capS = 3600) {
  return Math.max(jobTimeoutS, Math.min(Math.ceil(3 * secs), capS));
}
