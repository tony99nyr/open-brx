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

/** app-screens' shard count and the `mb`/`secs` JOBS needs for it: half the cores, at most 16, and never more
 *  than half the memory budget (a shard is its own browser, ~240 MB: 16 shards are ~3.9 GB). */
export function screensBudget(cpus, budgetMb) {
  const shards = Math.max(1, Math.min(16, Math.floor(cpus / 2), Math.floor(budgetMb / 2 / 240)));
  return { shards, mb: 100 + 240 * shards, secs: 6300 / shards };
}

/** A job's kill timeout: normally 3x its typical `secs`, but never less than the explicit JOB_TIMEOUT_S floor
 *  (an operator's override is never silently capped) and never more than `capS` for the DERIVED (3x) term alone
 *  (2026-09-27 review: on a tiny/starved box, 1 screens shard makes `secs` alone 6300s, and 3x that would hold a
 *  hung job -- and an agent -- for over 5 hours). */
export function deriveTimeoutS(jobTimeoutS, secs, capS = 3600) {
  return Math.max(jobTimeoutS, Math.min(Math.ceil(3 * secs), capS));
}
