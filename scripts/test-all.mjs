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
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sumTreePssKb, sumTreeTasks } from './lib/pss.mjs';
import { APP_BUILD_MB, MC_DIST_BUILD_MB, HEADROOM, TASK_ALLOWANCES, TASK_RESERVE, SCREENS_SHARD_MB, deriveTimeoutS, jobTaskAllowance } from './lib/budget.mjs';
import { admit, extraShardsToKeep, planPeakMb, screensRaise, startOrder, takeStartable } from './lib/scheduler.mjs';
import { acquireCheckoutLock } from './lib/lock.mjs';
import { createPool, memAvailableMb, extraLeasePss, splitLeaseTasks } from './lib/pool.mjs';
import { taskHeadroom } from './lib/tasks.mjs';
import { changedPaths, defaultBase, selectionIncludesUiJob, selectJobs, unionFilters } from './lib/changed.mjs';
import { cacheBypassReason, cacheKey, keyedEnv, canExitAllCached, headOf, inputTreeHash,
  jobContext, outputsFresh, pruneCache, readCache, storePass, toolFingerprint } from './lib/cache.mjs';
import { inputsForJob, resolveJobs, selectFiltered } from './lib/jobs.mjs';
import { reapByEnv } from './lib/reap.mjs';
import { pruneRunLogs } from './lib/prune.mjs';
import { stripDebugEnv } from './lib/jobenv.mjs';
import { findPython } from './lib/python.mjs';
import { npmInstallState } from './lib/launcher.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
let UI = argv.includes('--ui');   // --changed may force this on below (a UI job in the selection: see MEDIUM(a))
const LIST = argv.includes('--list');
let CACHE = argv.includes('--cache') && !argv.includes('--no-cache');
// --changed [base]: the base, if given, is the token RIGHT AFTER --changed on the command line (`--changed
// abc123`, not `abc123 --changed`), and must not itself look like a flag (so `--changed --list` still means
// "default base"). With no base, defaultBase() picks one (scripts/lib/changed.mjs).
const changedIdx = argv.indexOf('--changed');
const CHANGED = changedIdx >= 0;
const changedBaseArg = CHANGED && changedIdx + 1 < argv.length && !argv[changedIdx + 1].startsWith('--') ? argv[changedIdx + 1] : null;
let filters = argv.filter((a, i) => !a.startsWith('--') && !(CHANGED && changedBaseArg !== null && i === changedIdx + 1));
const LOGS = process.env.BRX_TEST_ALL_LOGS_DIR || path.join(os.tmpdir(), `brx-test-all-${process.pid}`);
const gateRecord = { version: 1, complete: false, selected: [], jobs: [], build: null,
  startedAt: new Date().toISOString(), finishedAt: null };
let recordWritten = false;
function recordJob(r) {
  gateRecord.jobs.push({ name: r.name, ok: r.code === 0,
    exit: typeof r.code === 'number' || r.code === 'TIMEOUT' || /^SIG[A-Z]+$/.test(r.code) ? r.code : 1,
    secs: r.secs, log: r.log || path.join(LOGS, `${r.name}.log`), cached: !!r.cached });
}
function writeResults(complete = false) {
  gateRecord.complete = complete;
  gateRecord.finishedAt = new Date().toISOString();
  let wroteLogs = false;
  for (const target of new Set([path.join(LOGS, 'results.json'), process.env.BRX_RESULTS_JSON].filter(Boolean))) {
    let temp;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(gateRecord) + '\n');
      fs.renameSync(temp, target);
      if (target === path.join(LOGS, 'results.json')) wroteLogs = true;
    } catch (error) {
      console.error(`test-all: could not write results to ${target}: ${error.message}`);
      // The lander asked for this record: without it, it would fall back to the printed table. Never exit 0 then.
      if (target === process.env.BRX_RESULTS_JSON) process.exitCode = 1;
    }
    finally {
      if (temp) {
        try { fs.rmSync(temp, { force: true }); }
        catch (error) { console.error(`test-all: could not remove ${temp}: ${error.message}`); }
      }
    }
  }
  recordWritten = true;
  if (wroteLogs) console.error(`test-all: results in ${path.join(LOGS, 'results.json')}`);
}
process.on('exit', () => {
  if (!recordWritten) {
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
  const base = changedBaseArg || defaultBase(ROOT);
  let paths;
  try { paths = changedPaths(ROOT, base); }
  catch (e) { console.error(`test-all: --changed could not diff against ${base}: ${e.message}`); process.exit(2); }
  const { filters: selected, reasons } = selectJobs(paths);
  console.log(`test-all: --changed vs ${base}: ${paths.length} path(s) changed`);
  for (const r of reasons) console.log(`  ${r}`);
  console.log(selected === null ? 'test-all: --changed selected: everything' : `test-all: --changed selected jobs matching: ${selected.join(', ')}`);
  // `filters` here is whatever job names were typed on the command line AFTER --changed (the same tokens
  // `-- mcp app` uses without --changed). unionFilters (scripts/lib/changed.mjs) makes them ADD to --changed's
  // own pick, never replace it (the 2026-09-27 trap: `--changed <sha> --ui mcp site` used to silently narrow a
  // fail-safe "run everything" down to only mcp and site).
  const named = filters;
  if (named.length) console.log(`test-all: also named on the command line: ${named.join(', ')} (adds to the --changed pick, never replaces it)`);
  filters = unionFilters(selected, named);
  // ci.yml never runs the UI gates (app-screens, app-e2e, the mc-* e2e scripts), so if the selection includes
  // one, --ui must come on too: --changed is the only thing gating it, not "CI is the backstop".
  if (!UI && selectionIncludesUiJob(ALL_JOBS.map(j => ({ name: j.name, ui: !!j.ui })), selected)) {
    UI = true;
    console.log('test-all: --changed selected a UI-only job; adding --ui (ci.yml does not run those)');
  }
  // The actual final selection, post-union, with why each job is in it -- so a mistyped or forgotten job name
  // is visible before the jobs start, not after a green run that quietly skipped something.
  const finalPreview = selectFiltered(ALL_JOBS, UI, filters);
  console.log(`test-all: final selection (${finalPreview.length} job(s)):`);
  for (const j of finalPreview) {
    const why = [];
    if (selected === null) why.push('everything (fail-safe)');
    else {
      if (selected.some(f => j.name.includes(f))) why.push('from the diff');
      if (named.some(f => j.name.includes(f))) why.push('named on the command line');
    }
    console.log(`  ${j.name}: ${why.join(', ') || '(no reason recorded)'}`);
  }
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
const RUN_ONLY_ENV = new Set(['SCREENS_OUT', 'SCREENS_ACK_FILE', 'SCREENS_WANT_FILE', 'SCREENS_SHARDS',
  'SCREENS_MAX_SHARDS', 'SCREENS_DYNAMIC']);
const staticEnv = j => ({ MC_PY: PY, ...keyedEnv(process.env), ...Object.fromEntries(
  // Per-run paths and parallelism settings do not change what a job tests, and per-run paths would make a key
  // that never repeats: leave them out (step 4's shard files are new per run).
  Object.entries(typeof j.env === 'object' && j.env ? j.env : {}).filter(([name]) => !RUN_ONLY_ENV.has(name))
) });
const cacheIdentity = (j, before, context) => cacheKey({
  job: j.name, cmd: [j.cwd, ...j.cmd], env: staticEnv(j), fingerprint, inputHash: before,
  context,
});
const packageFor = j => [...new Set([
  ...(j.cwd === 'app' || j.www ? ['app'] : []),
  ...(j.cwd === 'site' ? ['site'] : []),
  ...(j.cwd === 'webapp/mc' || j.dist ? ['webapp/mc'] : []),
])];
function cachePlan(jobs) {
  const hits = new Map();
  const before = new Map();
  const keys = new Map();
  const contexts = new Map();
  const hashes = new Map();
  const installed = new Map();
  for (const j of jobs) {
    try {
      const missing = packageFor(j).filter(pkg => {
        if (!installed.has(pkg)) installed.set(pkg, npmInstallState(path.join(ROOT, pkg)).installed);
        return installed.get(pkg) === null;
      });
      if (missing.length) {
        console.log(`test-all: cache bypassed for ${j.name} (missing installed npm marker: ${missing.join(', ')})`);
        continue;
      }
      const inputs = inputsForJob(j.name);
      const spec = JSON.stringify(inputs);
      let hash = hashes.get(spec);
      if (!hash) { hash = inputTreeHash(ROOT, inputs); hashes.set(spec, hash); }
      const context = jobContext(ROOT, j.name);
      const key = cacheIdentity(j, hash, context);
      before.set(j.name, hash);
      contexts.set(j.name, context);
      keys.set(j.name, key);
      const hit = readCache(ROOT, key);
      if (hit && hit.job === j.name) hits.set(j.name, { name: j.name, code: 0, secs: 0, cached: true });
    } catch (e) {
      console.error(`test-all: cache lookup for ${j.name} failed (${e.message}); running it`);
    }
  }
  return { hits, before, keys, contexts };
}
const pad = (s, n) => String(s).padEnd(n);
function printAllCached(jobs) {
  console.log(`\n${pad('job', 18)}${pad('result', 8)}secs`);
  for (const j of jobs) console.log(`${pad(j.name, 18)}${pad('ok', 8)}0`);
  console.log(`cached: ${jobs.map(j => j.name).join(', ')}`);
  console.log(`\n${jobs.length}/${jobs.length} job(s) passed in 0s (all cached)`);
}
if (CACHE && !JOBS.some(j => j.www || j.dist)) {
  const initial = cachePlan(JOBS);
  if (canExitAllCached(JOBS, initial.hits)) {
    printAllCached(JOBS);
    for (const r of initial.hits.values()) recordJob(r);
    writeResults(true);
    process.exit(0);
  }
}

// A job that dies leaves its children behind unless the group goes with it; so does a Ctrl-C of this script.
const groups = new Set();
const groupLeases = new Map();
const kills = [];   // every kill in progress; awaited before this script exits, so the SIGKILL fallback really fires
let stopping = false;
let fatalError = null;
const groupAlive = pid => { try { process.kill(-pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/** SIGTERM first, SIGKILL 2 s later if anything in the group is still there. The TERM matters: mcp/run_tests.py puts
 *  each test file in its own session, out of reach of a signal to the job's group, and only its SIGTERM handler can
 *  take those children down. The returned promise settles when the group is gone or has had its SIGKILL. */
const killGroup = pid => {
  const p = (async () => {
    try { process.kill(-pid, 'SIGTERM'); } catch { return; }
    for (let i = 0; i < 20 && groupAlive(pid); i++) await new Promise(r => setTimeout(r, 100));
    try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
  })();
  kills.push(p);
  return p;
};
let pool = null;
let releaseCheckout = null;
const lockAbort = new AbortController();
const cleanup = () => { pool?.close(); releaseCheckout?.(); };
const exitAfterKills = async code => { await Promise.all(kills); cleanup(); process.exit(code || process.exitCode || 0); };   // keeps an unwritten record red
// Every job carries REAP_KEY=<run>:<job> in its environment, and so does everything it starts. A job's MC or vite is
// often spawned `detached` (its own session), out of reach of killGroup, and an e2e script killed by a signal skips
// its `finally`: so when a job ends, by any path, whatever still carries its token is reaped (lib/reap.mjs).
const REAP_KEY = 'BRX_TEST_REAP';
const REAP_RUN = `${process.pid}-${Date.now()}`;
const reapJob = async name => {
  const left = await reapByEnv(REAP_KEY, `${REAP_RUN}:${name}`);
  if (left.length) console.error(`test-all: ${name} left ${left.length} process(es) behind; reaped: ${left.map(p => `${p.comm} ${p.pid}`).join(', ')}`);
};
const reapRun = () => { const p = reapByEnv(REAP_KEY, `${REAP_RUN}:`, { prefix: true }); kills.push(p); return p; };
const stopGroups = error => {
  if (fatalError) return;
  fatalError ??= error;
  stopping = true;
  pool?.close();
  for (const g of groups) killGroup(g);
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
    for (const g of groups) killGroup(g);
    Promise.all([...kills]).then(reapRun);   // after the groups, what they started in sessions of their own
    exitAfterKills(code);
  });
}
// Declared before run(): the shared builds call run() before the scheduler below is reached, and run() reads these.
let screensRunning = false, screensEnding = false, screensShards = 0, screensBaseShards = 0, screensExtraMb = 0, screensTarget = 0;
let screensPgid = null;
const screensExtraLeases = [];
// Every job imports brx_mcp from THIS checkout: <ROOT>/mcp goes first on PYTHONPATH (the dev venv's editable
// install points at the main checkout), and BRX_MCP_EXPECT_DIR makes brx_mcp/__init__.py refuse any other copy.
const OWN_MCP = path.join(ROOT, 'mcp');
function ownBrxMcpEnv(env = {}) {
  const rest = (env.PYTHONPATH ?? process.env.PYTHONPATH ?? '').split(path.delimiter).filter(p => p && p !== OWN_MCP);
  return { PYTHONPATH: [OWN_MCP, ...rest].join(path.delimiter), BRX_MCP_EXPECT_DIR: OWN_MCP };
}
function run(name, cwd, cmd, env = {}, timeoutS = JOB_TIMEOUT_S, lease = null) {
  const log = path.join(LOGS, `${name}.log`);
  const jobHome = path.join(LOGS, `${name}-brx-mcp-home`);
  fs.rmSync(jobHome, { recursive: true, force: true });
  fs.mkdirSync(jobHome, { recursive: true });
  const out = fs.openSync(log, 'w');
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    // detached: the job leads its own process group, so a timeout kills its browsers and servers too
    const child = spawn(cmd[0], cmd.slice(1), { cwd: path.join(ROOT, cwd), env: { ...jobEnv, MC_PY: PY, ...env, BRX_MCP_HOME: jobHome, ...ownBrxMcpEnv(env), [REAP_KEY]: `${REAP_RUN}:${name}` }, stdio: ['ignore', out, out], detached: true });
    if (child.pid) {
      groups.add(child.pid);
      if (name === 'app-screens') screensPgid = child.pid;
      if (lease) { lease.setPgid(child.pid); groupLeases.set(child.pid, lease); }
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { fs.writeSync(out, `\ntest-all: killed after ${timeoutS}s (JOB_TIMEOUT_S, or three times the job's typical time)\n`); }
      catch (error) { reject(error); }
      killGroup(child.pid);
    }, timeoutS * 1000);
    child.on('error', e => {
      try { fs.writeSync(out, `\nspawn failed: ${e.message}\n`); }
      catch { /* preserve the spawn error */ }
      reject(e);
    });
    child.on('close', async code => {
      try {
        clearTimeout(timer);
        if (child.pid && groupAlive(child.pid)) await killGroup(child.pid);
        await reapJob(name);
        groups.delete(child.pid);
        if (name === 'app-screens') screensEnding = true;
        groupLeases.delete(child.pid);
        fs.closeSync(out);
        resolve({ name, code: timedOut ? 'TIMEOUT' : child.signalCode || code, secs: (Date.now() - t0) / 1000, log });
      } catch (error) { reject(error); }
    });
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
// A lander gate (land.mjs sets BRX_LAND_PRIORITY on the test-all it runs) has pool priority. Read it, then remove it,
// so the jobs this run starts (and any test-all a test starts) never inherit it. BRX_LAND_GATE stays: the reaper needs it.
const LAND_PRIORITY = process.env.BRX_LAND_PRIORITY === '1';
delete process.env.BRX_LAND_PRIORITY;
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
const installedAtPlan = new Map();
if (CACHE) for (const j of selectedJobs) for (const pkg of packageFor(j))
  if (!installedAtPlan.has(pkg)) installedAtPlan.set(pkg, npmInstallState(path.join(ROOT, pkg)).installed);
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
        if (pgid === screensPgid && screensExtraLeases.length) {
          extraLeasePss(groupMb, lease.mb, screensExtraLeases.length).forEach((pss, i) => screensExtraLeases[i].setPss(pss));
        }
      }
    }
    if (canSampleTreeTasks) {
      const groupTasks = sumTreeTasks([pgid]);
      if (groupTasks !== null) {
        const leases = pgid === screensPgid ? [lease, ...screensExtraLeases] : [lease];
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
    for (const g of groups) killGroup(g);
    await exitAfterKills(1);
  }
}
const installedAfterBuild = [...installedAtPlan].filter(([pkg, state]) => npmInstallState(path.join(ROOT, pkg)).installed !== state);
if (CACHE && installedAfterBuild.length) {
  console.log(`test-all: cache bypassed (installed npm dependencies changed during build: ${installedAfterBuild.map(([pkg]) => pkg).join(', ')})`);
  CACHE = false;
  cachedResults.clear();
}
if (CACHE && selectedJobs.some(j => !outputsFresh(ROOT, j))) {
  console.log('test-all: cache bypassed (shared build output missing or stale)');
  CACHE = false;
  cachedResults.clear();
}
// A build may rewrite a declared input. Reject hits whose prebuild tree changed.
if (CACHE && builds.length) {
  const afterBuild = new Map();
  for (const j of selectedJobs) {
    if (!cachedResults.has(j.name)) continue;
    try {
      const inputs = inputsForJob(j.name);
      const spec = JSON.stringify(inputs);
      if (!afterBuild.has(spec)) afterBuild.set(spec, inputTreeHash(ROOT, inputs));
      if (afterBuild.get(spec) !== plan.before.get(j.name)) cachedResults.delete(j.name);
    } catch (e) {
      console.error(`test-all: cache post-build check for ${j.name} failed (${e.message}); running it`);
      cachedResults.delete(j.name);
    }
  }
}
JOBS = selectedJobs.filter(j => !cachedResults.has(j.name));
reservation.update(planPeakMb(JOBS.map(j => ({ mb: j.mb, secs: j.secs })), PLAN_BUDGET_MB));   // the builds are done
if (!JOBS.length) {
  printAllCached(selectedJobs);
  for (const r of cachedResults.values()) recordJob(r);
  writeResults(true);
  process.exit(0);
}
// The scheduler (lib/scheduler.mjs): longest first; start a job when its cost fits beside the running ones (or when
// nothing runs, so a job bigger than the whole budget still runs, alone).
const queue = startOrder(JOBS);
const results = [];
let usedMb = 0, running = 0, peakMb = 0;
let screensClosed = false, lastScreensRaise = 0, screensBelowTargetTicks = 0;
function releaseSurplusScreensLeases() {
  let keep = extraShardsToKeep(screensShards, screensBaseShards);
  while (screensExtraLeases.length && screensExtraLeases.reduce((sum, lease) => sum + lease.shards, 0) > keep) {
    const lease = screensExtraLeases.pop();
    lease.release(); screensExtraMb -= lease.mb; usedMb -= lease.mb;
  }
}
const screensJob = JOBS.find(j => j.name === 'app-screens');
const screensWant = screensJob && screensJob.env.SCREENS_WANT_FILE;
if (screensJob) {
  fs.rmSync(screensJob.env.SCREENS_ACK_FILE, { force: true });
  fs.rmSync(screensWant, { force: true });
}
const writeScreensWant = shards => {
  const temp = `${screensWant}.${process.pid}`;
  fs.writeFileSync(temp, String(shards));
  fs.renameSync(temp, screensWant);
};
const raiseScreens = () => {
  // Only spend newly freed memory after every queued job has started. The coordinator owns the
  // claim directory and publishes `want` when it is ready for a higher target.
  if (!screensRunning || screensEnding || stopping || screensClosed) return;
  if (Date.now() - lastScreensRaise < 500) return;
  let extraLease = null;
  try {
  const ackFile = screensJob.env.SCREENS_ACK_FILE;
  if (fs.existsSync(ackFile)) {
    let ack;
    try { ack = fs.readFileSync(ackFile, 'utf8').trim(); } catch { ack = ''; }
    if (ack === 'closed') { screensClosed = true; releaseSurplusScreensLeases(); return; }
    const applied = Number(ack);
    if (Number.isInteger(applied) && applied > screensShards && applied <= screensTarget) {
      const added = applied - screensShards;
      screensShards = applied;
      screensBelowTargetTicks = 0;
      releaseSurplusScreensLeases();
      lastScreensRaise = 0;
      console.log(`test-all: app-screens applied ${applied} shards (${added} added)`);
    } else if (screensTarget > screensShards && ++screensBelowTargetTicks >= 10) {
      // Give the raise up: lower `want` first, so the coordinator cannot start the shards whose leases go next.
      writeScreensWant(screensShards);
      screensTarget = screensShards;
      releaseSurplusScreensLeases();
    }
  }
  if (queue.length || screensTarget > screensShards || !fs.existsSync(screensWant)) return;
  const more = Math.min(screensJob.screensCap - screensShards, Math.floor((PLAN_BUDGET_MB - usedMb) / SCREENS_SHARD_MB));
  if (more <= 0) return;
  let admitted = 0;
  lastScreensRaise = Date.now();
  extraLease = pool.tryAcquire({ runId: RUN_ID, job: 'app-screens-extra', mb: SCREENS_SHARD_MB, cores: 1,
    tasks: TASK_ALLOWANCES.screensShard,
    size: free => {   // lib/scheduler.mjs: screensRaise
      const raise = screensRaise(more, free);
      admitted = raise.admitted;
      return raise.request;
    } });
  if (!extraLease) { lastScreensRaise = Date.now() + 1500; return; }
  extraLease.setPgid(screensPgid);
  extraLease.shards = admitted;
  screensExtraLeases.push(extraLease);
  screensExtraMb += extraLease.mb;
  usedMb += extraLease.mb;
  peakMb = Math.max(peakMb, usedMb);
  const next = screensShards + admitted;
  screensTarget = next;
  writeScreensWant(next);
  console.log(`test-all: app-screens requested ${next} shards`);
  } catch (error) {
    console.error(`test-all: app-screens shard raise stopped: ${error.message}`);
    screensClosed = true;
    extraLease?.release();
    if (extraLease) {
      const i = screensExtraLeases.indexOf(extraLease);
      if (i >= 0) {
        screensExtraLeases.splice(i, 1);
        screensExtraMb -= extraLease.mb;
        usedMb -= extraLease.mb;
      }
    }
  }
};
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
        const cacheKeyForRun = plan.keys.get(j.name) || null;
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
            screensRunning = true;
            screensShards = screensTarget = screensBaseShards = runJob.screensShards;
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
        if (CACHE && cacheBefore && cacheKeyForRun && r.code === 0 && !stopping) {
          try {
            const after = inputTreeHash(ROOT, inputsForJob(j.name));
            const sameContext = JSON.stringify(plan.contexts.get(j.name)) === JSON.stringify(jobContext(ROOT, j.name));
            const samePackages = packageFor(j).every(pkg => npmInstallState(path.join(ROOT, pkg)).installed === installedAtPlan.get(pkg));
            storePass(ROOT, { job: j.name, key: cacheKeyForRun, exit: 0, secs: r.secs,
              head: cacheHead, before: cacheBefore, after, stopping: stopping || !sameContext || !samePackages });
          } catch (e) { console.error(`test-all: cache store for ${j.name} failed (${e.message})`); }
        }
        if (j.name === 'app-screens') {
          const ackFile = screensJob.env.SCREENS_ACK_FILE;
          const acknowledged = fs.existsSync(ackFile) ? Number(fs.readFileSync(ackFile, 'utf8')) : null;
          console.log(`test-all: app-screens shard acknowledgement: ${Number.isInteger(acknowledged) ? acknowledged : 'not applied'}`);
          screensRunning = false;
          for (const extraLease of screensExtraLeases) extraLease.release();
          usedMb -= screensExtraMb;
        }
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
console.log(`\n${pad('job', 18)}${pad('result', 8)}secs`);
for (const r of results.sort((a, b) => b.secs - a.secs)) console.log(`${pad(r.name, 18)}${pad(r.code === 0 ? 'ok' : r.code === 'TIMEOUT' ? 'TIMEOUT' : 'FAIL', 8)}${r.secs.toFixed(0)}`);
if (cachedResults.size) console.log(`cached: ${[...cachedResults.keys()].join(', ')}`);
const failed = results.filter(r => r.code !== 0);
for (const r of failed) {
  const lines = fs.existsSync(r.log) ? fs.readFileSync(r.log, 'utf8').trimEnd().split('\n') : [String(r.code)];
  console.log(`\n---- ${r.name} (exit ${r.code}), last 30 lines of ${r.log}`);
  console.log(lines.slice(-30).join('\n'));
}
if (sampleTimer) { clearInterval(sampleTimer); if (!fatalError) samplePss(); }
const realPeak = canSamplePss && measuredPeakMb !== null ? `${measuredPeakMb.toFixed(0)} MB` : 'not measured';
const taskPeak = measuredPeakTasks === null ? 'not measured'
  : `${measuredPeakTasks}${taskStart ? ` of ${taskStart.max}` : ''} tasks${taskStart && measuredPeakTasks > taskStart.max - TASK_RESERVE
    ? ` (over the ${TASK_RESERVE} reserve: outside load used the margin)` : ''}`;
console.log(`\n${results.length - failed.length}/${results.length} job(s) passed in ${((Date.now() - t0) / 1000).toFixed(0)}s (real peak ${realPeak} against a ${PLAN_BUDGET_MB} MB ceiling, peak ${taskPeak}, planned peak ${peakMb} MB, ${BUDGET_MB} MB budget)`);
writeResults(!fatalError && !stopping && results.length === selectedJobs.length);
await exitAfterKills(failed.length || fatalError ? 1 : 0);
} catch (error) {
  stopGroups(error);
  console.error(`test-all: ${error.stack || error}`);
  await exitAfterKills(1);
}
