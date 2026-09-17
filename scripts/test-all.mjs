#!/usr/bin/env node
// test-all.mjs: `npm run test:all` runs every test suite in the repo AT THE SAME TIME, and prints one table.
//
//   npm run test:all                 # the unit gates: mcp, webapp/mc (tsc + vitest), app (tsc + node --test), site
//   npm run test:all -- --ui         # also the browser gates: app screens, logsync and e2e, and the seven webapp/mc e2e scripts
//   npm run test:all -- mcp app      # only the jobs whose name contains one of these words
//   npm run test:all -- --list       # print the job names and stop
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
const e2e = (script, secs) => ({
  name: `mc-${script}`, cwd: 'webapp/mc', cmd: ['node', `test/e2e/${script}.mjs`], ui: true, mb: 700, secs,
  env: async () => ({ MC_PORT: String(await freePort()), MC_WS_PORT: String(await freePort()), VITE_PORT: String(await freePort()) }),
});
const JOBS = [
  { name: 'mcp', cwd: 'mcp', cmd: [PY, 'run_tests.py', '-j', String(PY_J)], mb: 150 + 70 * PY_J, secs: 20 },
  { name: 'mc-tsc', cwd: 'webapp/mc', cmd: ['npx', 'tsc', '-b'], mb: 450, secs: 10 },
  { name: 'mc-vitest', cwd: 'webapp/mc', cmd: ['npx', 'vitest', 'run', `--maxWorkers=${VITEST_W}`], mb: 300 + 300 * VITEST_W, secs: 15 },
  { name: 'app-tsc', cwd: 'app', cmd: ['npx', 'tsc', '--noEmit'], mb: 350, secs: 3 },
  { name: 'app-test', cwd: 'app', cmd: ['npm', 'test'], www: true, mb: 300, secs: 10 },
  { name: 'site', cwd: 'site', cmd: ['npx', 'playwright', 'test', `--workers=${SITE_W}`], www: true, mb: 300 + 300 * SITE_W, secs: 30 },
  // the long pole, and mostly idle: it waits out page timelines, so it gets more shards than the CPU share
  { name: 'app-screens', cwd: 'app', cmd: ['node', 'tools/screens.mjs'], env: { SCREENS_SHARDS: String(SCREENS_S) }, www: true, ui: true, mb: 100 + 240 * SCREENS_S, secs: 1500 / SCREENS_S },
  { name: 'app-logsync', cwd: 'app', cmd: ['node', 'tools/logsync-gate.mjs'], www: true, ui: true, mb: 300, secs: 11 },
  // two real MCs and two phone HUDs against the built console, so it needs webapp/mc/dist as well as app/www
  { name: 'app-e2e', cwd: 'app', cmd: ['node', 'tools/e2e.mjs'], www: true, dist: true, ui: true, mb: 1000, secs: 65 },
  ...[['koth', 45], ['backhaul', 20], ['kit-continue', 22], ['end-delivery', 13], ['standby', 87], ['m2-ui', 46], ['game-edit', 32]].map(([s, t]) => e2e(s, t)),
].filter(j => (UI || !j.ui) && (!filters.length || filters.some(f => j.name.includes(f))));

if (LIST) { for (const j of JOBS) console.log(j.name); process.exit(0); }
if (!JOBS.length) { console.error(`no job matches ${filters.join(' ')} (try --list, and --ui for the browser gates)`); process.exit(2); }

// A job that dies leaves its children behind unless the group goes with it; so does a Ctrl-C of this script.
const groups = new Set();
// SIGTERM and SIGHUP too: an agent's command timeout or a closed terminal must not leave browsers holding gigabytes.
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.on(sig, () => { for (const g of groups) { try { process.kill(-g, 'SIGKILL'); } catch { /* gone */ } } process.exit(code); });
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
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }, timeoutS * 1000);
    child.on('error', e => { fs.writeSync(out, `\nspawn failed: ${e.message}\n`); });
    child.on('close', code => {
      clearTimeout(timer); groups.delete(child.pid); fs.closeSync(out);
      resolve({ name, code: timedOut ? 'TIMEOUT' : code, secs: (Date.now() - t0) / 1000, log });
    });
  });
}

// One run per checkout. A second run in the SAME checkout would rebuild app/www and webapp/mc/dist while the first
// run's jobs read them. So a second run waits for the first; a lock whose process is gone is taken over.
const LOCK = path.join(ROOT, '.test-all.lock');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
for (let waited = 0; ; waited++) {
  try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); break; }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const holder = Number(fs.readFileSync(LOCK, 'utf8')) || 0;
    if (!holder || !alive(holder)) { fs.rmSync(LOCK, { force: true }); continue; }
    if (waited === 0) console.log(`test-all: another run (pid ${holder}) is using this checkout; waiting for it to finish`);
    await new Promise(r => setTimeout(r, 2000));
  }
}
process.on('exit', () => { try { if (fs.readFileSync(LOCK, 'utf8') === String(process.pid)) fs.rmSync(LOCK); } catch { /* gone */ } });

const t0 = Date.now();
console.log(`test-all: ${JOBS.length} job(s), ${CPUS} cores, memory budget ${BUDGET_MB} MB, logs in ${LOGS}`);
// The one shared build output. Built once here, before any reader starts (see the rules at the top).
const builds = [];
if (JOBS.some(j => j.www)) builds.push(run('app-build', 'app', ['npm', 'run', 'build']));
if (JOBS.some(j => j.dist)) builds.push(run('mc-build', 'webapp/mc', ['npx', 'vite', 'build']));
for (const b of await Promise.all(builds)) {
  if (b.code !== 0) { console.error(`${b.name} failed, see ${b.log}`); process.exit(1); }
}
// The scheduler: longest first; start a job when its cost fits beside the running ones (or when nothing runs, so a
// job bigger than the whole budget still runs, alone).
const queue = [...JOBS].sort((a, b) => b.secs - a.secs);
const results = [];
let usedMb = 0, running = 0, peakMb = 0;
await new Promise(done => {
  const pump = () => {
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
  const lines = fs.readFileSync(r.log, 'utf8').trimEnd().split('\n');
  console.log(`\n---- ${r.name} (exit ${r.code}), last 30 lines of ${r.log}`);
  console.log(lines.slice(-30).join('\n'));
}
console.log(`\n${results.length - failed.length}/${results.length} job(s) passed in ${((Date.now() - t0) / 1000).toFixed(0)}s (planned peak ${peakMb} MB of a ${BUDGET_MB} MB budget)`);
process.exit(failed.length ? 1 : 0);
