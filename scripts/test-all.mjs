#!/usr/bin/env node
// test-all.mjs: `pnpm run test:all` runs every test suite in the repo AT THE SAME TIME, and prints one table.
//
//   pnpm run test:all                 # the unit gates: mcp, webapp/mc (tsc + vitest), app (tsc + node --test), site
//   pnpm run test:all -- --ui         # also the browser gates: app screens, moments, logsync and e2e, and the webapp/mc e2e scripts
//
// A new browser gate MUST be added to the job registry, scripts/lib/jobs.mjs (mcp/tests/test_suite_registry.py fails
// until it is, or until it is listed there as not a gate). Measure its peak memory and its time, and put them in `mb` and `secs`.
//   pnpm run test:all -- mcp app      # only the jobs whose name contains one of these words
//   pnpm run test:all -- --list       # print the job names and stop
//   pnpm run test:all -- --cache      # reuse matching passing jobs; off by default
//   pnpm run test:all -- --no-cache   # force a fresh run
//   pnpm run test:all -- --changed [base] --list   # dry run: which jobs would --changed pick, and why
//     (the base, if given, is the token RIGHT AFTER --changed, e.g. `--changed abc123`, not `abc123 --changed`;
//     see scripts/lib/changed.mjs's defaultBase() for what "no base" means)
//   pnpm run test:all -- --changed [base] mcp site   # job names typed after --changed ADD to its pick (a union,
//     never a replacement): --changed's own selection, PLUS mcp and site by hand. If --changed's own fail-safe
//     already picked "everything", the named jobs add nothing (everything already includes them) -- they never
//     narrow a --changed run back down to just the names you typed. The final line before the jobs start lists
//     every selected job and why (from the diff, or named on the command line).
//
// Why (2026-09-16). An agent ran the suites one after another, and the browser gates ran serially inside themselves,
// so a full run took about 30 minutes, 22 of them in `ui:screens`. Every suite is independent of the others once the
// shared build outputs exist, so this script builds those first (app/www, and webapp/mc/dist for app e2e), then starts
// the jobs in parallel inside a memory budget. Each job writes its whole output to a log file; the table names the
// file, and a failed job's last lines are printed under the table.
//
// Parallel-safety rules this script depends on (break one and two jobs will corrupt each other):
//   - no job binds a fixed port: the e2e scripts get free ports from here (MC_PORT / MC_WS_PORT / VITE_PORT), and
//     screens.mjs and logsync-gate.mjs bind ephemeral ones;
//   - no job writes a shared file: every e2e script has its own shots folder, and app/www is built once, up front, so
//     app/test/transport.test.mjs never rebuilds it while site/ reads it;
//   - mcp/run_tests.py gives every test file its own process and its own BRX_MCP_HOME.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sumTreePssKb, sumTreeTasks } from './lib/pss.mjs';
import { APP_BUILD_MB, MC_DIST_BUILD_MB, HEADROOM, TASK_ALLOWANCES, TASK_RESERVE, deriveTimeoutS, jobTaskAllowance } from './lib/budget.mjs';
import { admit, planPeakMb, startOrder, takeStartable } from './lib/scheduler.mjs';
import { createScreensRaise } from './lib/screens-raise.mjs';
import { acquireCheckoutLock } from './lib/lock.mjs';
import { createPool, memAvailableMb, extraLeasePss, splitLeaseTasks } from './lib/pool.mjs';
import { taskHeadroom } from './lib/tasks.mjs';
import { changedPaths, defaultBase } from './lib/changed.mjs';
import { parseArgs, planChanged } from './lib/test-all-cli.mjs';
import { createGateRecord } from './lib/gate-record.mjs';
import { allCachedLines, failureLines, summaryLine, tableLines } from './lib/report.mjs';
import { cacheBypassReason, canExitAllCached, headOf, outputsFresh, pruneCache, toolFingerprint } from './lib/cache.mjs';
import { createCachePlanner } from './lib/cache-plan.mjs';
import { resolveJobs, selectFiltered } from './lib/jobs.mjs';
import { createJobRunner } from './lib/job-runner.mjs';
import { pruneRunLogs } from './lib/prune.mjs';
import { stripDebugEnv } from './lib/jobenv.mjs';
import { findPython } from './lib/python.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));   // lib/test-all-cli.mjs
let UI = args.ui;
const LIST = args.list;
let CACHE = args.cache;
const CHANGED = args.changed;
let filters = args.filters;
const LOGS = process.env.BRX_TEST_ALL_LOGS_DIR || path.join(os.tmpdir(), `brx-test-all-${process.pid}`);
const gate = createGateRecord({ logs: LOGS, resultsJson: process.env.BRX_RESULTS_JSON });   // lib/gate-record.mjs
const gateRecord = gate.record;
const recordJob = gate.addJob;
const writeResults = complete => { if (!gate.write(complete)) process.exitCode = 1; };
process.on('exit', () => {
  if (!gate.written) {
    try { writeResults(); }
    catch (error) { console.error(`test-all: could not write results: ${error.message}`); }
  }
});
{ // Old runs' log dirs (24 h, dead pid; the newest 5 kept): nothing else ever removes them.
  const gone = pruneRunLogs(os.tmpdir(), { maxAgeH: 24 });
  // stderr: stdout is parsed (`--list` is one job name per line; the lander and the --changed tests read it).
  if (gone.length) console.error(`test-all: removed ${gone.length} old run log dir(s) from ${os.tmpdir()}`);
}
fs.mkdirSync(LOGS, { recursive: true });

// The dev venv, or system python: scripts/lib/python.mjs (shared with scripts/regen.mjs).
const { python: PY, foundVenv } = findPython(ROOT);   // T7: foundVenv = a repo .venv was picked (not MC_PY, not system python)
if (!foundVenv && !process.env.MC_PY) console.error('test-all: no .venv found; using system python3, so the tests that need the MC extras will skip');
// T7: a repo .venv has mcp's `mc` extra (start.mjs installs it), so a test that skips for want of websockets or uvicorn
// (with starlette, "uvicorn/starlette") means a broken venv, not a pass. httpx is not in that extra, so its skips are
// allowed here; CI's extras pass forbids them. System python and MC_PY skip by design (CLAUDE.md).
const NO_SKIP = foundVenv ? ['websockets', 'uvicorn'].flatMap(s => ['--no-skip', s]) : [];
// A lander gate (land.mjs sets BRX_LAND_PRIORITY on the test-all it runs) has pool priority. Read it, then remove it
// before jobEnv copies the environment, so the jobs this run starts (and any test-all a test starts) never inherit it
// (they did until the A10 stage 2 review). BRX_LAND_GATE stays: the reaper needs it.
const LAND_PRIORITY = process.env.BRX_LAND_PRIORITY === '1';
delete process.env.BRX_LAND_PRIORITY;
const { env: jobEnv, dropped: droppedEnv } = stripDebugEnv(process.env);   // T8: lib/jobenv.mjs
delete jobEnv.BRX_RESULTS_JSON;

// The CPU budget. Every runner below defaults to "use every core" on its own, and six of them at once pushed the
// box to full load, where three timing-sensitive tests failed (2026-09-16). Each parallel runner gets a quarter of
// the cores instead; the browser gates mostly wait on page timelines, not on the CPU, so they still finish fast.
const CPUS = os.availableParallelism ? os.availableParallelism() : os.cpus().length;

// The memory budget (2026-09-16). Unbounded, a `--ui` run peaked at 12.4 GB of proportional set size (PSS) on the
// 32-core box: screens 3.8 GB, site 3.8 GB, vitest 2.7 GB, and ~0.6 GB for each e2e script. A laptop, or two agents
// running this at once, runs out of memory. So every job carries a measured cost in MB, and a job starts only when
// the running jobs' costs plus its own fit in the budget: half of the memory free at launch, at most 8 GB
// (MEM_BUDGET_MB overrides). The longest jobs start first, so a queued job is always a short one. Measured on the
// 32-core box: a 12 GB budget took 97 s, 8 GB took 126 s, 4 GB took 279 s, all green. 8 GB leaves room for a second
// agent's run beside this one.
const availableMb = memAvailableMb;
// A job that runs longer than this is killed and fails: a hung test must not hold the run (and an agent) forever.
const JOB_TIMEOUT_S = Number(process.env.JOB_TIMEOUT_S || 600);

// The full job list (every job, regardless of --ui/filters), from a FRESH read of available memory. Called
// once up front (to check the --changed selection for a UI job, and for --list/the filter-match check, before
// any lock wait) and again right after this run takes the checkout lock: a run that queued behind another
// one must not schedule itself using the memory snapshot from while it was still waiting, or it under-shards
// for no reason once the machine is actually free again.
function rawJobs(budgetMb, cpus = CPUS) {
  return resolveJobs({ budgetMb, cpus, python: PY, noSkip: NO_SKIP, logs: LOGS, ui: UI, filters, tasks: taskHeadroom() });
}
function buildJobs() {
  const budgetMb = Number(process.env.MEM_BUDGET_MB || Math.min(8000, Math.floor(availableMb() / 2)));
  return { budgetMb, all: rawJobs(budgetMb) };
}

let { budgetMb: BUDGET_MB, all: ALL_JOBS } = buildJobs();

// `--changed [base]`: map the paths that differ from `base` to a job-name filter, the same mechanism as
// `test:all -- mcp app` above -- fail safe (CLAUDE.md's re-gate rule): an unmapped path, or a path that trips
// scripts/lib/changed.mjs's full-suite triggers, runs everything, never a narrower guess.
if (CHANGED) {
  const base = args.changedBase || defaultBase(ROOT);
  let paths;
  try { paths = changedPaths(ROOT, base); }
  catch (e) { console.error(`test-all: --changed could not diff against ${base}: ${e.message}`); process.exit(2); }
  ({ filters, ui: UI } = planChanged({ base, paths, named: filters, ui: UI, allJobs: ALL_JOBS, log: line => console.log(line) }));
}

let JOBS = selectFiltered(ALL_JOBS, UI, filters);
gateRecord.selected = JOBS.map(j => j.name);

if (LIST) { for (const j of JOBS) console.log(j.name); process.exit(0); }
if (!JOBS.length) { console.error(`no job matches ${filters.join(' ')} (try --list, and --ui for the browser gates)`); process.exit(2); }

const bypass = cacheBypassReason(jobEnv);   // T8: a stripped switch cannot change a job's result
if (CACHE && bypass) { console.log(`test-all: cache bypassed (${bypass})`); CACHE = false; }
let fingerprint = null;
if (CACHE) {
  try { pruneCache(ROOT); fingerprint = toolFingerprint(ROOT, PY); }
  catch (e) { console.error(`test-all: cache unavailable (${e.message}); running jobs`); CACHE = false; }
}
// lib/cache-plan.mjs: each job's key, the hits before the builds, the hits that survive them, and the store.
const cache = createCachePlanner({ root: ROOT, python: PY, fingerprint: () => fingerprint });
const cachePlan = jobs => cache.plan(jobs);
const printAllCached = jobs => { for (const line of allCachedLines(jobs.map(j => j.name))) console.log(line); };
if (CACHE && !JOBS.some(j => j.www || j.dist)) {
  const initial = cachePlan(JOBS);
  if (canExitAllCached(JOBS, initial.hits)) {
    printAllCached(JOBS);
    for (const r of initial.hits.values()) recordJob(r);
    writeResults(true);
    process.exit(process.exitCode || 0);   // a lost lander copy of the record set 1
  }
}

// app-screens' elastic shards (lib/screens-raise.mjs), made by the scheduler below when the run has app-screens. Declared
// before the runner, whose onStart/onEnd report the job's process group and its exit to it.
let screens = null;
// A job that dies leaves its children behind unless the group goes with it; so does a Ctrl-C of this script.
// lib/job-runner.mjs starts each job in its own group, times it out and reaps what it left behind.
const runner = createJobRunner({ root: ROOT, logs: LOGS, baseEnv: { ...jobEnv, MC_PY: PY },
  onStart: (name, pid) => { if (name === 'app-screens') screens?.setPgid(pid); },
  onEnd: name => { if (name === 'app-screens') screens?.end(); } });
const { groups, groupLeases, kills, killGroup } = runner;
const reapRun = runner.reapRun;
const run = (name, cwd, cmd, env = {}, timeoutS = JOB_TIMEOUT_S, lease = null) => runner.run(name, cwd, cmd, env, timeoutS, lease);
const ownBrxMcpEnv = runner.ownBrxMcpEnv;
const OWN_MCP = path.join(ROOT, 'mcp');   // the import probe below checks brx_mcp resolves inside it
let stopping = false;
let fatalError = null;
let pool = null;
let releaseCheckout = null;
const lockAbort = new AbortController();
const cleanup = () => { pool?.close(); releaseCheckout?.(); };
const exitAfterKills = async code => { await Promise.all(kills); cleanup(); process.exit(code || process.exitCode || 0); };   // keeps an unwritten record red
const stopGroups = error => {
  if (fatalError) return;
  fatalError ??= error;
  stopping = true;
  pool?.close();
  runner.killAll();
};
const fatalProcessError = error => {
  console.error(`test-all: fatal process error: ${error?.stack || error}`);
  stopGroups(error instanceof Error ? error : new Error(String(error)));
  Promise.all(kills).then(reapRun);
  void exitAfterKills(1);
};
process.on('uncaughtException', fatalProcessError);
process.on('unhandledRejection', fatalProcessError);
process.on('exit', cleanup);
// SIGTERM and SIGHUP too: an agent's command timeout or a closed terminal must not leave browsers holding gigabytes.
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;   // the scheduler starts nothing more
    lockAbort.abort();
    runner.killAll();
    Promise.all([...kills]).then(reapRun);   // after the groups, what they started in sessions of their own
    exitAfterKills(code);
  });
}

// Each checkout serialises its own runs because they share app/www and webapp/mc/dist.
// The machine pool admits individual builds and jobs across different checkouts.
const RUN_ID = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
try { releaseCheckout = await acquireCheckoutLock(ROOT, { signal: lockAbort.signal, runId: RUN_ID }); }
catch (error) {
  if (stopping || lockAbort.signal.aborted) await exitAfterKills(130);
  throw error;
}
if (stopping) await exitAfterKills(130);
pool = createPool({ priority: LAND_PRIORITY });
try {
({ budgetMb: BUDGET_MB, all: ALL_JOBS } = buildJobs());
JOBS = selectFiltered(ALL_JOBS, UI, filters);
const selectedJobs = JOBS;
gateRecord.selected = selectedJobs.map(j => j.name);
// A queued run may have waited through a dependency install. Refresh the fingerprint under the checkout lock.
if (CACHE) {
  try { fingerprint = toolFingerprint(ROOT, PY); }
  catch (e) { console.error(`test-all: cache unavailable after lock (${e.message}); running jobs`); CACHE = false; }
}
const installedAtPlan = CACHE ? cache.installedAt(selectedJobs) : new Map();
const plan = CACHE ? cachePlan(selectedJobs) : { hits: new Map(), before: new Map(), keys: new Map(), contexts: new Map() };
const cachedResults = plan.hits;

const t0 = Date.now();
// The scheduler's real ceiling: HEADROOM's slice of the detected budget, never the whole thing (F429/F430,
// scripts/lib/budget.mjs's HEADROOM comment) -- a job's `mb` running low, or the box being busier than
// `availableMb()` saw, still has 15% of BUDGET_MB of slack instead of none.
const PLAN_BUDGET_MB = Math.floor(BUDGET_MB * HEADROOM);
const plannedPeakMb = planPeakMb(JOBS.map(j => ({ mb: j.mb, secs: j.secs })), PLAN_BUDGET_MB);
// A lander gate only: other runs leave this much memory free. It covers the jobs that will run (not the cache hits) and
// the shared builds that will run first; it is lowered after the build and dropped once every job holds its lease.
const buildsMb = (JOBS.some(j => j.www) ? APP_BUILD_MB : 0) + (JOBS.some(j => j.dist) ? MC_DIST_BUILD_MB : 0);
const reservation = pool.reserve(Math.max(
  planPeakMb(JOBS.filter(j => !cachedResults.has(j.name)).map(j => ({ mb: j.mb, secs: j.secs })), PLAN_BUDGET_MB), buildsMb));
console.log(`test-all: ${JOBS.length} job(s), ${CPUS} cores, memory budget ${BUDGET_MB} MB, logs in ${LOGS}`);
if (droppedEnv.length) console.log(`test-all: ignoring ${droppedEnv.join(', ')} (a single gate script's switch; run that script alone to use it)`);
console.log(`test-all: planned peak ${plannedPeakMb} MB against a ${PLAN_BUDGET_MB} MB ceiling (${Math.round(HEADROOM * 100)}% of the ${BUDGET_MB} MB budget), ${BUDGET_MB - plannedPeakMb} MB headroom`);
const taskStart = taskHeadroom();
if (taskStart) console.log(`test-all: tasks ${taskStart.free} free of ${taskStart.max} (reserve ${TASK_RESERVE})`);
let measuredPeakMb = null;
let measuredPeakTasks = taskStart?.current ?? null;
function sampleTasks() {
  const sample = taskHeadroom();
  if (sample) measuredPeakTasks = Math.max(measuredPeakTasks ?? 0, sample.current);
}
const canSamplePss = fs.existsSync('/proc/self/smaps_rollup');
const canSampleTreeTasks = fs.existsSync('/proc/self/task');
function samplePss() {
  if (canSamplePss) {
    const kb = sumTreePssKb([...groups]);
    if (kb !== null) measuredPeakMb = Math.max(measuredPeakMb || 0, kb / 1024);
  }
  for (const [pgid, lease] of groupLeases) {
    if (canSamplePss) {
      const jobKb = sumTreePssKb([pgid]);
      if (jobKb !== null) {
        const groupMb = jobKb / 1024;
        lease.setPss(groupMb);
        if (screens && pgid === screens.pgid && screens.extraLeases.length) {
          extraLeasePss(groupMb, lease.mb, screens.extraLeases.length).forEach((pss, i) => screens.extraLeases[i].setPss(pss));
        }
      }
    }
    if (canSampleTreeTasks) {
      const groupTasks = sumTreeTasks([pgid]);
      if (groupTasks !== null) {
        const leases = screens && pgid === screens.pgid ? [lease, ...screens.extraLeases] : [lease];
        const observed = splitLeaseTasks(groupTasks, leases.map(item => item.tasks));
        leases.forEach((item, index) => item.setTasks(observed[index]));
      }
    }
  }
  sampleTasks();
}
const sampleTimer = canSamplePss || canSampleTreeTasks || taskStart ? setInterval(() => {
  try { samplePss(); }
  catch (error) { console.error(`test-all: memory sample failed: ${error.message}`); stopGroups(error); }
}, 1000) : null;
async function withBuildLease(name, cwd, cmd, mb) {
  const lease = await pool.acquire({ runId: RUN_ID, job: name, mb, cores: 2, tasks: TASK_ALLOWANCES.other,
    size: ({ freeCores }) => ({ mb, cores: Math.max(1, Math.min(2, freeCores)) }) });
  try {
    if (stopping) throw new Error('test run is stopping');
    return await run(name, cwd, cmd, {}, JOB_TIMEOUT_S, lease);
  }
  finally { lease.release(); }
}
async function acquireJobLease(j) {
  let sized = j;
  const lease = await pool.acquire({ runId: RUN_ID, job: j.name, mb: j.mb, cores: j.cores, tasks: jobTaskAllowance(j),
    size: free => {   // lib/scheduler.mjs: admit
      const admission = admit(j, free, { ownMb: BUDGET_MB, ownCores: CPUS, resolve: rawJobs });
      sized = admission.sized;
      return admission.request;
    } });
  return { lease, sized };
}
// The one shared build output. Built once here, before any reader starts (see the rules at the top).
// The import probe: from a neutral cwd, with the job env, brx_mcp must resolve inside this checkout. Fails the run
// before any build if the venv's editable install would shadow it (the guard in brx_mcp/__init__.py says why).
{
  const probe = spawnSync(PY, ['-c', 'import brx_mcp, os; print(os.path.realpath(brx_mcp.__file__))'],
    { cwd: os.tmpdir(), env: { ...process.env, ...ownBrxMcpEnv() }, encoding: 'utf8' });
  const where = (probe.stdout || '').trim();
  if (probe.status !== 0 || !where.startsWith(fs.realpathSync(OWN_MCP) + path.sep)) {
    console.error(`test-all: brx_mcp does not import from this checkout (${OWN_MCP}): ${where || (probe.stderr || '').trim().split('\n').pop()}`);
    process.exit(2);
  }
}
const builds = [];
if (selectedJobs.some(j => j.www)) builds.push(withBuildLease('app-build', 'app', ['npm', 'run', 'build'], APP_BUILD_MB));
if (selectedJobs.some(j => j.dist)) builds.push(withBuildLease('mc-dist-build', 'webapp/mc', ['npx', 'vite', 'build'], MC_DIST_BUILD_MB));
for (const b of await Promise.all(builds)) {
  if (b.code !== 0) {
    gateRecord.build = { name: b.name, log: b.log };
    console.error(`${b.name} failed, see ${b.log}`);
    runner.killAll();
    await exitAfterKills(1);
  }
}
const installedAfterBuild = cache.changedSince(installedAtPlan);
if (CACHE && installedAfterBuild.length) {
  console.log(`test-all: cache bypassed (installed npm dependencies changed during build: ${installedAfterBuild.join(', ')})`);
  CACHE = false;
  cachedResults.clear();
}
if (CACHE && selectedJobs.some(j => !outputsFresh(ROOT, j))) {
  console.log('test-all: cache bypassed (shared build output missing or stale)');
  CACHE = false;
  cachedResults.clear();
}
// A build may rewrite a declared input. Reject hits whose prebuild tree changed.
if (CACHE && builds.length) cache.recheckAfterBuild(selectedJobs, plan, cachedResults);
JOBS = selectedJobs.filter(j => !cachedResults.has(j.name));
reservation.update(planPeakMb(JOBS.map(j => ({ mb: j.mb, secs: j.secs })), PLAN_BUDGET_MB));   // the builds are done
if (!JOBS.length) {
  printAllCached(selectedJobs);
  for (const r of cachedResults.values()) recordJob(r);
  writeResults(true);
  process.exit(process.exitCode || 0);   // a lost lander copy of the record set 1
}
// The scheduler (lib/scheduler.mjs): longest first; start a job when its cost fits beside the running ones (or when
// nothing runs, so a job bigger than the whole budget still runs, alone).
const queue = startOrder(JOBS);
const results = [];
let usedMb = 0, running = 0, peakMb = 0;
const screensJob = JOBS.find(j => j.name === 'app-screens');
if (screensJob) screens = createScreensRaise({ job: screensJob, runId: RUN_ID, ceilingMb: PLAN_BUDGET_MB,
  tally: { used: () => usedMb, add: mb => { usedMb += mb; peakMb = Math.max(peakMb, usedMb); } },
  queued: () => queue.length, stopping: () => stopping, tryAcquire: request => pool.tryAcquire(request) });
const raiseScreens = () => screens?.tick();
// A fast final job can finish before screens.mjs creates `want`. Retry while the screens job runs.
const raiseTimer = screensJob ? setInterval(raiseScreens, 500) : null;
let pendingAdmissions = 0;
await new Promise(done => {
  const pump = () => {
    if (stopping) { if (!running) done(); return; }
    for (const j of takeStartable(queue, { usedMb, running, ceilingMb: PLAN_BUDGET_MB })) {
      // The tally debits the planned `mb` until the pool admits the job, then the size it was admitted at.
      let debitMb = j.mb;
      usedMb += debitMb; running++; pendingAdmissions++; peakMb = Math.max(peakMb, usedMb);
      (async () => {
        // A slow machine gets fewer shards, so a job may legitimately take longer than JOB_TIMEOUT_S: allow 3x
        // its estimate, capped (scripts/lib/budget.mjs: deriveTimeoutS) so a starved box's inflated `secs` cannot
        // hold a hung job -- and an agent -- for hours. JOB_TIMEOUT_S itself is still an explicit floor, never capped.
        let r;
        const cacheBefore = plan.before.get(j.name) || null;
        let cacheHead = null;
        let lease = null;
        try {
          if (CACHE && cacheBefore) cacheHead = headOf(ROOT);
          let admission;
          try { admission = await acquireJobLease(j); }
          finally {
            pendingAdmissions--;
            if (!queue.length && pendingAdmissions === 0) reservation.update(0);
          }
          lease = admission.lease;
          const runJob = admission.sized;
          usedMb += runJob.mb - debitMb; debitMb = runJob.mb; peakMb = Math.max(peakMb, usedMb);
          const env = typeof runJob.env === 'function' ? await runJob.env() : runJob.env;
          if (stopping) throw new Error('test run is stopping');
          if (j.name === 'app-screens') {
            screens.start(runJob.screensShards);
            env.SCREENS_MAX_SHARDS = String(screensJob.screensCap);
          }
          r = await run(runJob.name, runJob.cwd, runJob.cmd, env, deriveTimeoutS(JOB_TIMEOUT_S, runJob.secs), lease);
          if (JSON.stringify(runJob.cmd) !== JSON.stringify(j.cmd)) cacheHead = null;
        }
        catch (e) {
          stopGroups(e);
          r = { name: j.name, code: `ERROR ${e.message}`, secs: 0, log: '(no log: the job did not start)' };
        }
        finally {
          try { lease?.release(); }
          catch (e) {
            stopGroups(e);
            r = { name: j.name, code: `ERROR ${e.message}`, secs: 0, log: '(lease release failed)' };
          }
        }
        if (CACHE) cache.storeIfPassed(j, plan, { code: r.code, secs: r.secs, head: cacheHead, stopping, installedAtPlan });
        if (j.name === 'app-screens') screens.finish();
        results.push(r); recordJob(r); usedMb -= debitMb; running--;
        if (!running && (stopping || !queue.length)) done(); else pump();
      })();
    }
    raiseScreens();
  };
  pump();
});
if (raiseTimer) clearInterval(raiseTimer);

results.push(...cachedResults.values());
for (const r of cachedResults.values()) recordJob(r);
for (const line of tableLines(results, [...cachedResults.keys()])) console.log(line);   // lib/report.mjs
const failed = results.filter(r => r.code !== 0);
for (const r of failed) for (const line of failureLines(r, fs.existsSync(r.log) ? fs.readFileSync(r.log, 'utf8') : null)) console.log(line);
if (sampleTimer) { clearInterval(sampleTimer); if (!fatalError) samplePss(); }
console.log(summaryLine({ passed: results.length - failed.length, total: results.length, secs: (Date.now() - t0) / 1000,
  realPeakMb: canSamplePss ? measuredPeakMb : null, ceilingMb: PLAN_BUDGET_MB, taskPeak: measuredPeakTasks,
  taskMax: taskStart ? taskStart.max : null, taskReserve: TASK_RESERVE, plannedPeakMb: peakMb, budgetMb: BUDGET_MB }));
writeResults(!fatalError && !stopping && results.length === selectedJobs.length);
await exitAfterKills(failed.length || fatalError ? 1 : 0);
} catch (error) {
  stopGroups(error);
  console.error(`test-all: ${error.stack || error}`);
  await exitAfterKills(1);
}
