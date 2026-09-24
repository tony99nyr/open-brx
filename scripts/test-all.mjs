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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const UI = argv.includes('--ui');
const LIST = argv.includes('--list');
const filters = argv.filter(a => !a.startsWith('--'));
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
const BUDGET_MB = Number(process.env.MEM_BUDGET_MB || Math.min(8000, Math.floor(availableMb() / 2)));
// Worker counts: a quarter of the cores, and no runner may take more than a quarter of the budget for its workers.
const workers = (perMb, cap) => Math.max(1, Math.min(cap, Math.floor(CPUS / 4), Math.floor(BUDGET_MB / 4 / perMb)));
const PY_J = workers(70, 16), VITEST_W = workers(300, 8), SITE_W = workers(300, 8);
const SCREENS_S = Math.max(1, Math.min(16, Math.floor(CPUS / 2), Math.floor(BUDGET_MB / 3 / 240)));   // the long pole
// A job that runs longer than this is killed and fails: a hung test must not hold the run (and an agent) forever.
const JOB_TIMEOUT_S = Number(process.env.JOB_TIMEOUT_S || 600);

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.unref(); s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// name, working dir, command, `mb` (peak PSS measured 2026-09-16, with a margin), `secs` (typical, for ordering),
// and whether it needs app/www. `env` may be a function (for per-job ports).
const e2e = (script, secs, mb = 700) => ({
  name: `mc-${script}`, cwd: 'webapp/mc', cmd: ['node', `test/e2e/${script}.mjs`], ui: true, mb, secs,
  env: async () => ({ MC_PORT: String(await freePort()), MC_WS_PORT: String(await freePort()), VITE_PORT: String(await freePort()) }),
});
const JOBS = [
  { name: 'mcp', cwd: 'mcp', cmd: [PY, 'run_tests.py', '-j', String(PY_J)], mb: 150 + 70 * PY_J, secs: 20 },
  { name: 'mc-tsc', cwd: 'webapp/mc', cmd: ['npx', 'tsc', '-b'], mb: 450, secs: 10 },
  { name: 'mc-vitest', cwd: 'webapp/mc', cmd: ['npx', 'vitest', 'run', `--maxWorkers=${VITEST_W}`], mb: 300 + 300 * VITEST_W, secs: 15 },
  { name: 'app-tsc', cwd: 'app', cmd: ['npx', 'tsc', '--noEmit'], mb: 350, secs: 3 },
  // The root already built shared app/www. The prebuilt form avoids rewriting it under parallel readers, and a
  // private shots dir keeps this focused A38 browser pass isolated from the full app-screens job.
  { name: 'app-test', cwd: 'app', cmd: ['npm', 'run', 'test:prebuilt'], env: { SCREENS_OUT: path.join(LOGS, 'app-test-screens') }, www: true, mb: 550, secs: 18 },
  { name: 'site', cwd: 'site', cmd: ['npx', 'playwright', 'test', `--workers=${SITE_W}`], www: true, mb: 300 + 300 * SITE_W, secs: 30 },
  // the long pole, and mostly idle: it waits out page timelines, so it gets more shards than the CPU share
  { name: 'app-screens', cwd: 'app', cmd: ['node', 'tools/screens.mjs'], env: { SCREENS_SHARDS: String(SCREENS_S) }, www: true, ui: true, mb: 100 + 240 * SCREENS_S, secs: 1500 / SCREENS_S },
  { name: 'app-logsync', cwd: 'app', cmd: ['node', 'tools/logsync-gate.mjs'], www: true, ui: true, mb: 300, secs: 11 },
  { name: 'app-moments', cwd: 'app', cmd: ['node', 'tools/moments.mjs'], www: true, ui: true, mb: 500, secs: 60 },
  // two real MCs and two phone HUDs against the built console, so it needs webapp/mc/dist as well as app/www
  { name: 'app-e2e', cwd: 'app', cmd: ['node', 'tools/e2e.mjs'], www: true, dist: true, ui: true, mb: 1000, secs: 65 },
  ...[['koth', 45], ['backhaul', 20], ['kit-continue', 22], ['end-delivery', 13], ['standby', 87], ['m2-ui', 46], ['game-edit', 32], ['operator-menu', 18], ['report', 15],
      // MC visual QA 2026-09-23: measured as 1.0-1.1 GB RSS summed over the process tree (shared pages counted
      // twice), so 900 MB sits between that and the older jobs' measured 700 MB PSS.
      ['designer-rail-play', 9, 900], ['frame', 7, 900], ['lobby-updating', 3, 900], ['recap-next', 20, 900],
      ['feed-reload', 9, 900], ['mc-restart', 13, 900], ['live-board', 19, 900]].map(([s, t, mb]) => e2e(s, t, mb)),
].filter(j => (UI || !j.ui) && (!filters.length || filters.some(f => j.name.includes(f))));

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
  const out = fs.openSync(log, 'w');
  const t0 = Date.now();
  return new Promise(resolve => {
    // detached: the job leads its own process group, so a timeout kills its browsers and servers too
    const child = spawn(cmd[0], cmd.slice(1), { cwd: path.join(ROOT, cwd), env: { ...process.env, MC_PY: PY, ...env }, stdio: ['ignore', out, out], detached: true });
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

// One run per checkout. A second run in the SAME checkout would rebuild app/www and webapp/mc/dist while the first
// run's jobs read them, so a second run waits. Each run adds its own entry to the .test-all.lock directory, named
// <start ms>-<pid>-<random>, and touches it every 5 s. The run whose entry sorts first among the LIVE entries holds the
// checkout. No run ever renames or deletes another run's live entry, so two runs cannot both take it over.
//   - Live: this waiter saw the entry's mtime change within the last 60 s of its OWN monotonic clock. A suspended laptop
//     pauses that clock too, so a wake does not make a holder look dead. A pid is not used: pids are reused.
//   - An entry dead by that rule (a run killed with SIGKILL, a restart) is deleted; its name can never be reused.
//   - Two runs that start together: each waits until it has been first for 1 s, twice in a row, so an entry that was
//     named earlier but written later is seen before anyone starts.
const LOCK = path.join(ROOT, '.test-all.lock');
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
    if (now - seen.get(name).changedAt > 60_000) { fs.rmSync(path.join(LOCK, name), { force: true }); continue; }
    live.push(name);
  }
  return live[0];
};
for (let firstInARow = 0, told = false; firstInARow < 2;) {
  if (firstLive() === MINE) firstInARow++;
  else {
    firstInARow = 0;
    if (!told) { console.log('test-all: another run is using this checkout; waiting for it to finish'); told = true; }
  }
  if (firstInARow < 2) await new Promise(r => setTimeout(r, 1000));
}

const t0 = Date.now();
console.log(`test-all: ${JOBS.length} job(s), ${CPUS} cores, memory budget ${BUDGET_MB} MB, logs in ${LOGS}`);
// The one shared build output. Built once here, before any reader starts (see the rules at the top).
const builds = [];
if (JOBS.some(j => j.www)) builds.push(run('app-build', 'app', ['npm', 'run', 'build']));
if (JOBS.some(j => j.dist)) builds.push(run('mc-build', 'webapp/mc', ['npx', 'vite', 'build']));
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
      if (running > 0 && usedMb + j.mb > BUDGET_MB) { i++; continue; }
      queue.splice(i, 1); usedMb += j.mb; running++; peakMb = Math.max(peakMb, usedMb);
      (async () => {
        // A slow machine gets fewer shards, so a job may legitimately take longer than JOB_TIMEOUT_S: allow 3x its estimate.
        const timeoutS = Math.max(JOB_TIMEOUT_S, Math.ceil(3 * j.secs));
        let r;
        try { r = await run(j.name, j.cwd, j.cmd, typeof j.env === 'function' ? await j.env() : j.env, timeoutS); }
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
console.log(`\n${results.length - failed.length}/${results.length} job(s) passed in ${((Date.now() - t0) / 1000).toFixed(0)}s (planned peak ${peakMb} MB of a ${BUDGET_MB} MB budget)`);
await exitAfterKills(failed.length ? 1 : 0);
