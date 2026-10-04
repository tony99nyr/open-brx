#!/usr/bin/env node
// test-all.mjs: `pnpm run test:all` runs every test suite in the repo AT THE SAME TIME, and prints one table.
//
//   pnpm run test:all                 # the unit gates: mcp, webapp/mc (tsc + vitest), app (tsc + node --test), site
//   pnpm run test:all -- --ui         # also the browser gates: app screens, moments, logsync and e2e, and the eight webapp/mc e2e scripts
//
// A new browser gate MUST be added to JOBS below (mcp/tests/test_suite_registry.py fails until it is, or until it is
// listed there as not a gate). Measure its peak memory and its time, and put them in `mb` and `secs`.
//   pnpm run test:all -- mcp app      # only the jobs whose name contains one of these words
//   pnpm run test:all -- --list       # print the job names and stop
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
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sumTreePssKb } from './lib/pss.mjs';
import { E2E_SPECS, HEADROOM, OTHER_UI_JOBS, deriveTimeoutS, planPeakMb, screensBudget, workerCount } from './lib/budget.mjs';
import { entryPid, isStale, lockDirName } from './lib/lock.mjs';
import { changedPaths, defaultBase, selectionIncludesUiJob, selectJobs, unionFilters } from './lib/changed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
let UI = argv.includes('--ui');   // --changed may force this on below (a UI job in the selection: see MEDIUM(a))
const LIST = argv.includes('--list');
// --changed [base]: the base, if given, is the token RIGHT AFTER --changed on the command line (`--changed
// abc123`, not `abc123 --changed`), and must not itself look like a flag (so `--changed --list` still means
// "default base"). With no base, defaultBase() picks one (scripts/lib/changed.mjs).
const changedIdx = argv.indexOf('--changed');
const CHANGED = changedIdx >= 0;
const changedBaseArg = CHANGED && changedIdx + 1 < argv.length && !argv[changedIdx + 1].startsWith('--') ? argv[changedIdx + 1] : null;
let filters = argv.filter((a, i) => !a.startsWith('--') && !(CHANGED && changedBaseArg !== null && i === changedIdx + 1));
const LOGS = path.join(os.tmpdir(), `brx-test-all-${process.pid}`);
fs.mkdirSync(LOGS, { recursive: true });

/** The dev venv: this checkout's, else the main checkout's (a worktree, wherever it lives, has no .venv of its own:
 *  git's common dir names the main checkout), else system python, which skips the tests that need the extras. */
function findPython() {
  if (process.env.MC_PY) return process.env.MC_PY;
  const candidates = [path.join(ROOT, '.venv/bin/python')];
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
    candidates.push(path.join(path.dirname(common), '.venv/bin/python'));
  } catch { /* not a git checkout */ }
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) console.error('test-all: no .venv found; using system python3, so the tests that need the MC extras will skip');
  return found || 'python3';
}
const PY = findPython();

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
const availableMb = () => {
  try { return Number(/MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1]) / 1024; }
  catch { return os.totalmem() / 1048576 / 2; }   // macOS counts cache as used, so os.freemem() is far too low
};
// A job that runs longer than this is killed and fails: a hung test must not hold the run (and an agent) forever.
const JOB_TIMEOUT_S = Number(process.env.JOB_TIMEOUT_S || 600);

// The one place JOBS pulls a browser job's mb/secs from: scripts/lib/budget.mjs's OTHER_UI_JOBS, so this file
// and that one's tests never drift apart on the same job.
const findOtherUi = name => {
  const j = OTHER_UI_JOBS.find(o => o.name === name);
  if (!j) throw new Error(`test-all: no OTHER_UI_JOBS entry for ${name} (scripts/lib/budget.mjs is out of step)`);
  return j;
};

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.unref(); s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// name, working dir, command, `mb` (peak PSS, from scripts/lib/budget.mjs's E2E_SPECS/OTHER_UI_JOBS -- keep the
// two in step, mcp/tests/test_test_all_budget.py pins them), `secs` (typical, for ordering), and whether it
// needs app/www. `env` may be a function (for per-job ports).
const e2e = (script, secs, mb) => ({
  name: `mc-${script}`, cwd: 'webapp/mc', cmd: ['node', `test/e2e/${script}.mjs`], ui: true, mb, secs,
  env: async () => ({ MC_PORT: String(await freePort()), MC_WS_PORT: String(await freePort()), VITE_PORT: String(await freePort()) }),
});
// The full job list (every job, regardless of --ui/filters), from a FRESH read of available memory. Called
// once up front (to check the --changed selection for a UI job, and for --list/the filter-match check, before
// any lock wait) and again right after this run takes the machine-wide lock: a run that queued behind another
// one must not schedule itself using the memory snapshot from while it was still waiting, or it under-shards
// for no reason once the machine is actually free again.
function rawJobs(budgetMb) {
  // Worker counts: a quarter of the cores, and no runner may take more than a quarter of the budget for its workers.
  const pyJ = workerCount(70, 16, CPUS, budgetMb), vitestW = workerCount(300, 8, CPUS, budgetMb), siteW = workerCount(300, 8, CPUS, budgetMb);
  // app-screens is sized against what's left after the OTHER ui:true jobs THIS INVOCATION will actually run (not
  // the whole budget): a full --ui run selects all of OTHER_UI_JOBS, so screensBudget clamps the reservation at
  // its historical fair half; a filtered/--changed run that drops most of them leaves app-screens the rest.
  const otherUiMb = OTHER_UI_JOBS.filter(j => UI && (!filters.length || filters.some(f => j.name.includes(f))))
    .reduce((s, j) => s + j.mb, 0);
  const { shards: screensS, mb: screensMb, secs: screensSecs } = screensBudget(CPUS, budgetMb, otherUiMb);   // the long pole
  return [
    { name: 'mcp', cwd: 'mcp', cmd: [PY, 'run_tests.py', '-j', String(pyJ), '--exclude', 'chaos'], mb: 150 + 70 * pyJ, secs: 33 },
    // Chaos testing (docs/chaos-testing.md): the fixed CI seeds of every scenario, each a full match on the real MC
    // stack with a field of MockNodes. Its own job so a red chaos run reads as one, not as "mcp".
    { name: 'chaos', cwd: 'mcp', cmd: [PY, 'run_tests.py', '-j', String(pyJ), 'chaos'], mb: 150 + 90 * pyJ, secs: 11 },
    { name: 'mc-tsc', cwd: 'webapp/mc', cmd: ['npx', 'tsc', '-b'], mb: 450, secs: 7 },
    { name: 'mc-vitest', cwd: 'webapp/mc', cmd: ['npx', 'vitest', 'run', `--maxWorkers=${vitestW}`], mb: 300 + 300 * vitestW, secs: 19 },
    { name: 'app-tsc', cwd: 'app', cmd: ['npx', 'tsc', '--noEmit'], mb: 350, secs: 1 },
    // The root already built shared app/www. The prebuilt form avoids rewriting it under parallel readers, and a
    // private shots dir keeps this focused A38 browser pass isolated from the full app-screens job.
    { name: 'app-test', cwd: 'app', cmd: ['npm', 'run', 'test:prebuilt'], env: { SCREENS_OUT: path.join(LOGS, 'app-test-screens') }, www: true, mb: 550, secs: 15 },
    { name: 'site', cwd: 'site', cmd: ['npx', 'playwright', 'test', `--workers=${siteW}`], www: true, mb: 300 + 300 * siteW, secs: 34 },
    // the long pole, and mostly idle: it waits out page timelines, so it gets more shards than the CPU share
    { name: 'app-screens', cwd: 'app', cmd: ['node', 'tools/screens.mjs'], env: { SCREENS_SHARDS: String(screensS) }, www: true, ui: true, mb: screensMb, secs: screensSecs },
    { name: 'app-logsync', cwd: 'app', cmd: ['node', 'tools/logsync-gate.mjs'], www: true, ui: true, ...findOtherUi('app-logsync') },
    { name: 'app-moments', cwd: 'app', cmd: ['node', 'tools/moments.mjs'], www: true, ui: true, ...findOtherUi('app-moments') },
    // two real MCs and two phone HUDs against the built console, so it needs webapp/mc/dist as well as app/www
    { name: 'app-e2e', cwd: 'app', cmd: ['node', 'tools/e2e.mjs'], www: true, dist: true, ui: true, ...findOtherUi('app-e2e') },
    ...E2E_SPECS.map(([s, t]) => e2e(s, t, findOtherUi(`mc-${s}`).mb)),
  ];
}
const selectFiltered = (all, ui, filterList) => all.filter(j => (ui || !j.ui) && (!filterList.length || filterList.some(f => j.name.includes(f))));
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

if (LIST) { for (const j of JOBS) console.log(j.name); process.exit(0); }
if (!JOBS.length) { console.error(`no job matches ${filters.join(' ')} (try --list, and --ui for the browser gates)`); process.exit(2); }

// A job that dies leaves its children behind unless the group goes with it; so does a Ctrl-C of this script.
const groups = new Set();
const kills = [];   // every kill in progress; awaited before this script exits, so the SIGKILL fallback really fires
let stopping = false;
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
const exitAfterKills = async code => { await Promise.all(kills); process.exit(code); };
// SIGTERM and SIGHUP too: an agent's command timeout or a closed terminal must not leave browsers holding gigabytes.
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;   // the scheduler starts nothing more
    for (const g of groups) killGroup(g);
    exitAfterKills(code);
  });
}
function run(name, cwd, cmd, env = {}, timeoutS = JOB_TIMEOUT_S) {
  const log = path.join(LOGS, `${name}.log`);
  const jobHome = path.join(LOGS, `${name}-brx-mcp-home`);
  fs.rmSync(jobHome, { recursive: true, force: true });
  fs.mkdirSync(jobHome, { recursive: true });
  const out = fs.openSync(log, 'w');
  const t0 = Date.now();
  return new Promise(resolve => {
    // detached: the job leads its own process group, so a timeout kills its browsers and servers too
    const child = spawn(cmd[0], cmd.slice(1), { cwd: path.join(ROOT, cwd), env: { ...process.env, MC_PY: PY, ...env, BRX_MCP_HOME: jobHome }, stdio: ['ignore', out, out], detached: true });
    groups.add(child.pid);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      fs.writeSync(out, `\ntest-all: killed after ${timeoutS}s (JOB_TIMEOUT_S, or three times the job's typical time)\n`);
      killGroup(child.pid);
    }, timeoutS * 1000);
    child.on('error', e => { fs.writeSync(out, `\nspawn failed: ${e.message}\n`); });
    child.on('close', code => {
      clearTimeout(timer); groups.delete(child.pid); fs.closeSync(out);
      resolve({ name, code: timedOut ? 'TIMEOUT' : code, secs: (Date.now() - t0) / 1000, log });
    });
  });
}

// One run per MACHINE, per user (2026-09-27: was one run per checkout, so two worktrees on the same box ran
// at once and starved each other's memory/CPU budget until jobs blew their kill timeout under the load). Each
// run adds its own entry to a FIXED lock directory under /tmp, keyed by uid (not $XDG_RUNTIME_DIR/$TMPDIR,
// which can differ between session types for the same account and would then give each its own lock), named
// <start ms>-<pid>-<random>, and touches it every 5 s. The run whose entry sorts first among the LIVE entries
// holds the machine. No run ever renames or deletes another run's live entry, so two runs cannot both take it over.
//   - Live: the holder's pid still exists (checked directly, with a ~10 s grace past a missed heartbeat before
//     trusting a "gone" read -- pids are namespaced/reused, so a crashed or SIGKILLed run is reclaimed almost
//     at once, not after a full timeout, without trusting a coincidental match the instant the heartbeat lapses),
//     AND, for one that is alive but wedged, its mtime changed within the last 60 s of THIS waiter's own
//     monotonic clock. A suspended laptop pauses that clock too, so a wake does not make a live holder look dead.
//   - An entry dead by either rule is deleted; its name can never be reused.
//   - Two runs that start together: each waits until it has been first for 1 s, twice in a row, so an entry that
//     was named earlier but written later is seen before anyone starts.
const LOCK = path.join('/tmp', lockDirName(os.userInfo().uid));
fs.mkdirSync(LOCK, { recursive: true });
const MINE = `${String(Date.now()).padStart(15, '0')}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const mineAt = path.join(LOCK, MINE);
fs.writeFileSync(mineAt, '');
const beat = setInterval(() => { try { const t = new Date(); fs.utimesSync(mineAt, t, t); } catch { /* gone */ } }, 5000);
beat.unref();
process.on('exit', () => { clearInterval(beat); try { fs.rmSync(mineAt, { force: true }); } catch { /* gone */ } });
const seen = new Map();   // entry -> { mtime, changedAt: performance.now() when this run last saw it change }
const firstLive = () => {
  const now = performance.now();
  const live = [];
  const names = fs.readdirSync(LOCK);
  if (!names.includes(MINE)) { fs.writeFileSync(mineAt, ''); names.push(MINE); }   // removed by hand, or the dir was: put it back
  for (const name of names.sort()) {
    if (name === MINE) { live.push(name); continue; }
    let mtime;
    try { mtime = fs.statSync(path.join(LOCK, name)).mtimeMs; } catch { seen.delete(name); continue; }
    const s = seen.get(name);
    if (!s || s.mtime !== mtime) seen.set(name, { mtime, changedAt: now });
    if (isStale(name, seen.get(name).changedAt, now)) { fs.rmSync(path.join(LOCK, name), { force: true }); seen.delete(name); continue; }
    live.push(name);
  }
  return live;
};
for (let firstInARow = 0, toldPid = null; firstInARow < 2;) {
  const live = firstLive();
  if (live[0] === MINE) firstInARow++;
  else {
    firstInARow = 0;
    const pid = entryPid(live[0]);
    if (pid !== toldPid) { console.log(`test-all: waiting on pid ${pid} (another run, anywhere on this machine) to finish`); toldPid = pid; }
  }
  if (firstInARow < 2) await new Promise(r => setTimeout(r, 1000));
}
// This run just acquired the machine: a queued run's earlier budget snapshot may be stale (computed while the
// box was still busy), so rebuild JOBS from a fresh read of available memory before scheduling anything.
({ budgetMb: BUDGET_MB, all: ALL_JOBS } = buildJobs());
JOBS = selectFiltered(ALL_JOBS, UI, filters);

const t0 = Date.now();
// The scheduler's real ceiling: HEADROOM's slice of the detected budget, never the whole thing (F429/F430,
// scripts/lib/budget.mjs's HEADROOM comment) -- a job's `mb` running low, or the box being busier than
// `availableMb()` saw, still has 15% of BUDGET_MB of slack instead of none.
const PLAN_BUDGET_MB = Math.floor(BUDGET_MB * HEADROOM);
const plannedPeakMb = planPeakMb(JOBS.map(j => ({ mb: j.mb, secs: j.secs })), PLAN_BUDGET_MB);
console.log(`test-all: ${JOBS.length} job(s), ${CPUS} cores, memory budget ${BUDGET_MB} MB, logs in ${LOGS}`);
console.log(`test-all: planned peak ${plannedPeakMb} MB against a ${PLAN_BUDGET_MB} MB ceiling (${Math.round(HEADROOM * 100)}% of the ${BUDGET_MB} MB budget), ${BUDGET_MB - plannedPeakMb} MB headroom`);
let measuredPeakMb = null;
const canSamplePss = fs.existsSync('/proc/self/smaps_rollup');
function samplePss() {
  if (!canSamplePss) return;
  const kb = sumTreePssKb([...groups]);
  if (kb !== null) measuredPeakMb = Math.max(measuredPeakMb || 0, kb / 1024);
}
const sampleTimer = canSamplePss ? setInterval(samplePss, 1000) : null;
// The one shared build output. Built once here, before any reader starts (see the rules at the top).
const builds = [];
if (JOBS.some(j => j.www)) builds.push(run('app-build', 'app', ['npm', 'run', 'build']));
if (JOBS.some(j => j.dist)) builds.push(run('mc-dist-build', 'webapp/mc', ['npx', 'vite', 'build']));
for (const b of await Promise.all(builds)) {
  if (b.code !== 0) { console.error(`${b.name} failed, see ${b.log}`); for (const g of groups) killGroup(g); await exitAfterKills(1); }
}
// The scheduler: longest first; start a job when its cost fits beside the running ones (or when nothing runs, so a
// job bigger than the whole budget still runs, alone).
const queue = [...JOBS].sort((a, b) => b.secs - a.secs);
const results = [];
let usedMb = 0, running = 0, peakMb = 0;
await new Promise(done => {
  const pump = () => {
    if (stopping) return;
    for (let i = 0; i < queue.length;) {
      const j = queue[i];
      if (running > 0 && usedMb + j.mb > PLAN_BUDGET_MB) { i++; continue; }
      queue.splice(i, 1); usedMb += j.mb; running++; peakMb = Math.max(peakMb, usedMb);
      (async () => {
        // A slow machine gets fewer shards, so a job may legitimately take longer than JOB_TIMEOUT_S: allow 3x
        // its estimate, capped (scripts/lib/budget.mjs: deriveTimeoutS) so a starved box's inflated `secs` cannot
        // hold a hung job -- and an agent -- for hours. JOB_TIMEOUT_S itself is still an explicit floor, never capped.
        const timeoutS = deriveTimeoutS(JOB_TIMEOUT_S, j.secs);
        let r;
        try {
          const env = typeof j.env === 'function' ? await j.env() : j.env;
          r = await run(j.name, j.cwd, j.cmd, env, timeoutS);
        }
        catch (e) { r = { name: j.name, code: `ERROR ${e.message}`, secs: 0, log: '(no log: the job did not start)' }; }
        results.push(r); usedMb -= j.mb; running--;
        if (!queue.length && !running) done(); else pump();
      })();
    }
  };
  pump();
});

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${pad('job', 18)}${pad('result', 8)}secs`);
for (const r of results.sort((a, b) => b.secs - a.secs)) console.log(`${pad(r.name, 18)}${pad(r.code === 0 ? 'ok' : r.code === 'TIMEOUT' ? 'TIMEOUT' : 'FAIL', 8)}${r.secs.toFixed(0)}`);
const failed = results.filter(r => r.code !== 0);
for (const r of failed) {
  const lines = fs.existsSync(r.log) ? fs.readFileSync(r.log, 'utf8').trimEnd().split('\n') : [String(r.code)];
  console.log(`\n---- ${r.name} (exit ${r.code}), last 30 lines of ${r.log}`);
  console.log(lines.slice(-30).join('\n'));
}
if (sampleTimer) { samplePss(); clearInterval(sampleTimer); }
const realPeak = canSamplePss && measuredPeakMb !== null ? `${measuredPeakMb.toFixed(0)} MB` : 'not measured';
console.log(`\n${results.length - failed.length}/${results.length} job(s) passed in ${((Date.now() - t0) / 1000).toFixed(0)}s (real peak ${realPeak} against a ${PLAN_BUDGET_MB} MB ceiling, planned peak ${peakMb} MB, ${BUDGET_MB} MB budget)`);
await exitAfterKills(failed.length ? 1 : 0);
