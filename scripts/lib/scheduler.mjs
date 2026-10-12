// Admission for scripts/test-all.mjs, in one module (architecture #3, the 2026-10-10 tooling review). Before it:
//   - the start rule lived twice: test-all's pump() and planPeakMb, a hand-kept mirror of it;
//   - the size a job asks the pool for was an inline closure in acquireJobLease, and the app-screens raise sized its
//     extra lease inline in raiseScreens, so neither could be driven by a test;
//   - the run's own tally debited a job's planned `mb` while the pool leased its admission-sized `mb`.
// The functions here are pure: the pool (lib/pool.mjs) and the runner stay in test-all.mjs and call them.
import { SCREENS_SHARD_MB, TASK_ALLOWANCES, admissionShare, jobTaskAllowance, screensAdmissionShards, screensJobSize } from './budget.mjs';
import { extraLeaseCores } from './pool.mjs';

/** The start order: longest `secs` first. The sort is stable, so ties keep the registry order. */
export const startOrder = jobs => [...jobs].sort((a, b) => b.secs - a.secs);

/** The one start rule. Takes from `queue` (in start order, changed in place) every job whose `mb` fits beside `usedMb`
 *  under `ceilingMb`, and returns them. A job that does not fit is skipped, so a smaller one behind it can start. When
 *  nothing runs, the first job starts even if it is bigger than the ceiling (it then runs alone). */
export function takeStartable(queue, { usedMb, running, ceilingMb }) {
  const started = [];
  for (let i = 0; i < queue.length;) {
    const j = queue[i];
    if (running + started.length > 0 && usedMb + j.mb > ceilingMb) { i++; continue; }
    queue.splice(i, 1); usedMb += j.mb; started.push(j);
  }
  return started;
}

/** Predicts the peak concurrent `mb` a run of `jobs` ({mb, secs}) reaches under takeStartable: a job frees its `mb`
 *  when its `secs` elapse. `secs` stands in for wall time, so this is a planning estimate to print before a run starts
 *  (and the lander's reservation), not the real peak the run measures. */
export function planPeakMb(jobs, budgetMb) {
  const queue = startOrder(jobs);
  const running = [];
  let time = 0, used = 0, peak = 0;
  const tryStart = () => {
    for (const j of takeStartable(queue, { usedMb: used, running: running.length, ceilingMb: budgetMb })) {
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

/** A job's size when the pool admits it. `free` is the pool's view ({freeMb, freeCores, freeTasks}); `ownMb` and
 *  `ownCores` are this run's budget and cores; `resolve(budgetMb, cpus)` returns every job sized for that share.
 *  app-screens asks for at least SCREENS_MIN_SHARDS of its uncut plan (`screensCap`, never the start-up task cut).
 *  Lander priority is not an input: it only orders the pool's queue. Returns the sized job and the pool request. */
export function admit(job, free, { ownMb, ownCores, resolve }) {
  const share = admissionShare(ownMb, free.freeMb, ownCores, free.freeCores);
  let sized = resolve(share.budgetMb, share.cpus).find(candidate => candidate.name === job.name);
  if (job.name === 'app-screens') {
    const shards = screensAdmissionShards(job.screensCap, sized.screensShards, free.freeTasks);
    sized = { ...sized, screensShards: shards, ...screensJobSize(shards), env: { ...sized.env, SCREENS_SHARDS: String(shards) } };
  }
  return { sized, request: { mb: sized.mb, cores: sized.cores, tasks: jobTaskAllowance(sized) } };
}

/** One app-screens raise: at most `more` extra shards, as many as free memory, cores and tasks hold. `admitted` can be
 *  0; the request still asks for one shard's worth, which the pool refuses when even that does not fit. */
export function screensRaise(more, { freeMb, freeCores, freeTasks }) {
  const fit = Math.min(more, Math.floor(freeMb / SCREENS_SHARD_MB), Math.floor(freeCores),
    Math.floor(freeTasks / TASK_ALLOWANCES.screensShard));
  const admitted = extraLeaseCores(fit, freeCores);
  const n = Math.max(1, admitted);
  return { admitted, request: { mb: SCREENS_SHARD_MB * n, cores: n, tasks: TASK_ALLOWANCES.screensShard * n } };
}
