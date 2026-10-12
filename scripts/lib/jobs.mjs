// The job registry: one record per scripts/test-all.mjs job. Before it (2026-10-11, architecture candidate 5) five
// tables named the same jobs: JOBS in test-all.mjs (command and flags), inputs.mjs (the cache key), and budget.mjs's
// E2E_SPECS, OTHER_UI_JOBS and TASK_BY_JOB (cost). A new job is one record here.
//
// A record:
//   name, cwd           the job name (test-all's filters match a substring of it) and its working directory
//   cmd, env, mb, secs  the command, extra environment, peak PSS in MB and typical seconds (for ordering and timeouts).
//                       `env` may be an async function: the e2e scripts get free ports at start.
//   sized(s)            the fields that depend on this run's sizing `s` (workers, shards, python, logs); it overrides
//                       the static ones. `cores` defaults to 1.
//   ui, www, dist       a browser gate (--ui only); needs the built app/www; needs the built webapp/mc/dist
//   tasks               the task allowance, when the job's measured use differs from budget.mjs's defaults
//   libs                the scripts/lib files the job's own code imports or reads (not the runner's). A change to one
//                       selects the job in --changed; mcp/tests/test_test_all_changed.py scans the gates for them.
//   inputs              the repository paths the job reads (prefixes end in `/`), the cache key and flake blame.
//                       COMMON is added to every job. These are broad on purpose: a missed cross-tree input can make a
//                       cached result wrong.
//
// mcp/tests/test_test_all_jobs.py checks every job resolves as its fixture says (scripts/test/jobs-snapshot.mjs). test_suite_registry.py checks every
// gate script under app/tools/ and webapp/mc/test/e2e/ is named here. Measure a new browser gate's peak memory and
// time, and put them in `mb` and `secs`.
import path from 'node:path';
import { TASK_ALLOWANCES, TASK_RESERVE, screensBudget, screensJobSize, taskScreensShards, workerCount } from './budget.mjs';
import { blockAllocator } from './ports.mjs';

// Real cross-tree readers (git grep 2026-10-04; every other docs/, hardware/ and protocol/ hit in app/ and
// webapp/mc/ is a comment): app/test/announcer.test.mjs reads docs/announcer.md; the built app/www bundles
// mcp/brx_mcp/mc/golden_bundle.json; webapp/mc/test/medalicons-gen.test.ts reads app/src/hud/medalicons.js and
// fake-invariants.test.ts imports mcp/brx_mcp/mc/fake_invariants.json; every job that starts MC runs mcp/ and
// reads webapp/download/build.json. The mcp job and site stay broad.
const COMMON = ['scripts/test-all.mjs', 'scripts/lib/', 'package.json', 'pnpm-lock.yaml'];
const APP = ['app/', 'mcp/'];
const MC = ['webapp/mc/', 'mcp/'];
const SITE = ['site/', 'app/', 'mcp/', 'webapp/', 'docs/'];
const DOWNLOAD = 'webapp/download/build.json';
const WEB_LOCK = ['webapp/mc/package.json', 'webapp/mc/package-lock.json'];
const APP_LOCK = ['app/package.json', 'app/package-lock.json'];
const SITE_LOCK = ['site/package.json', 'site/package-lock.json'];
// The shared case files webapp/mc's tests read from app/ (brx3). changed.mjs reads this list for mc-tsc.
const MC_CASES = ['app/src/hud/medalicons.js', 'app/test/fixtures/honors-cases.json', 'app/test/fixtures/policy-cases.json',
  'app/test/fixtures/age-format-cases.json', 'app/test/fixtures/config-pick-cases.json'];

const SERVER = 'scripts/lib/static-server.mjs', BUNDLES = 'scripts/lib/bundles.mjs';

// F523: each e2e job gets its own block of ports from below the kernel's ephemeral range (lib/ports.mjs).
let ports = null;   // made on first use, so a module that only reads the registry claims nothing
const jobBlockEnv = () => (ports ??= blockAllocator())();
const PORTS = 'scripts/lib/ports.mjs';

// The webapp/mc/test/e2e scripts: [script, secs, mb]. mb bumped 2026-09-27 (budget.mjs HEADROOM's comment): 850 covers
// the lighter scripts, 1050 and up the ones measured heavier.
const E2E_DEFAULT_MB = 850;
const E2E = [
  ['koth', 34], ['backhaul', 16], ['kit-continue', 18], ['end-delivery', 10], ['standby', 86, 1100], ['m2-ui', 43],
  ['game-edit', 86, 850], ['operator-menu', 24], ['report', 4],
  ['frame', 6, 1050], ['lobby-updating', 3, 1050], ['recap-next', 20, 1050], ['feed-reload', 9, 1050],
  ['mc-restart', 13, 1050], ['live-board', 18, 1050],
  ['vqa2', 26, 1050], ['play', 45, 1100], ['build', 16, 1050], ['lobby-outcome', 6, 1050], ['observability', 25, 1050],
];
// Measured 2026-10-05 (budget.mjs TASK_ALLOWANCES's comment); every other e2e script fits the default UI allowance.
const E2E_TASKS = { play: 300 };

const REGISTRY = [
  { name: 'mcp', cwd: 'mcp', secs: 33, inputs: ['.'],   // docs hygiene and suite registration read the whole repo
    sized: s => ({ cmd: [s.python, 'run_tests.py', '-j', String(s.pyJ), '--exclude', 'chaos', ...s.noSkip], mb: 150 + 70 * s.pyJ, cores: s.pyJ }) },
  // Chaos testing (docs/chaos-testing.md): the fixed CI seeds of every scenario, each a full match on the real MC
  // stack with a field of MockNodes. Its own job so a red chaos run reads as one, not as "mcp". It runs only the chaos
  // files, but the guard scans all of mcp/tests and costs 11 s: its inputs stay broad.
  { name: 'chaos', cwd: 'mcp', secs: 21,
    inputs: ['mcp/', 'app/', 'webapp/', 'site/', 'scripts/', 'docs/', 'hardware/', 'protocol/', '.claude/', '.github/', ...WEB_LOCK, ...APP_LOCK, ...SITE_LOCK],
    sized: s => ({ cmd: [s.python, 'run_tests.py', '-j', String(s.pyJ), 'chaos', ...s.noSkip], mb: 150 + 90 * s.pyJ, cores: s.pyJ }) },
  { name: 'mc-tsc', cwd: 'webapp/mc', cmd: ['npx', 'tsc', '-b'], mb: 450, secs: 7, inputs: [...MC, ...MC_CASES, ...WEB_LOCK] },
  { name: 'mc-vitest', cwd: 'webapp/mc', secs: 19, tasks: 100, inputs: [...MC, ...MC_CASES, ...WEB_LOCK],
    sized: s => ({ cmd: ['npx', 'vitest', 'run', `--maxWorkers=${s.vitestW}`], mb: 300 + 300 * s.vitestW, cores: s.vitestW }) },
  { name: 'app-tsc', cwd: 'app', cmd: ['npx', 'tsc', '--noEmit'], mb: 350, secs: 1, inputs: ['app/', ...APP_LOCK] },
  // The root already built shared app/www. The prebuilt form avoids rewriting it under parallel readers, and a
  // private shots dir keeps this focused A38 browser pass isolated from the full app-screens job.
  { name: 'app-test', cwd: 'app', cmd: ['npm', 'run', 'test:prebuilt'], www: true, mb: 550, secs: 15, tasks: TASK_ALLOWANCES.appTest, libs: [SERVER, BUNDLES],
    inputs: [...APP, 'docs/announcer.md', 'webapp/download/', ...APP_LOCK],
    sized: s => ({ env: { SCREENS_OUT: path.join(s.logs, 'app-test-screens') } }) },
  { name: 'site', cwd: 'site', www: true, secs: 34, tasks: TASK_ALLOWANCES.site, inputs: [...SITE, ...APP_LOCK, ...WEB_LOCK, ...SITE_LOCK],
    sized: s => ({ cmd: ['npx', 'playwright', 'test', `--workers=${s.siteW}`], mb: 300 + 300 * s.siteW, cores: s.siteW }) },
  // the long pole, and mostly idle: it waits out page timelines, so it gets more shards than the CPU share
  { name: 'app-screens', cwd: 'app', cmd: ['node', 'tools/screens.mjs'], www: true, ui: true, libs: [SERVER, BUNDLES], inputs: [...APP, ...APP_LOCK],
    sized: s => ({ env: {
      SCREENS_SHARDS: String(s.screens.shards), SCREENS_MAX_SHARDS: String(s.screensCap), SCREENS_DYNAMIC: '1',
      SCREENS_OUT: path.join(s.logs, 'app-screens-shots'),
      SCREENS_ACK_FILE: path.join(s.logs, 'app-screens-ack'), SCREENS_WANT_FILE: path.join(s.logs, 'app-screens-want'),
    }, screensShards: s.screens.shards, screensCap: s.screensCap, mb: s.screens.mb, secs: s.screens.secs, cores: s.screens.shards }) },
  { name: 'app-logsync', cwd: 'app', cmd: ['node', 'tools/logsync-gate.mjs'], www: true, ui: true, mb: 450, secs: 11, tasks: 105, libs: [SERVER],
    inputs: [...APP, DOWNLOAD, ...APP_LOCK] },
  { name: 'app-moments', cwd: 'app', cmd: ['node', 'tools/moments.mjs'], www: true, ui: true, mb: 650, secs: 60, tasks: 135, libs: [SERVER, BUNDLES],
    inputs: [...APP, ...APP_LOCK] },
  // two real MCs and two phone HUDs against the built console, so it needs webapp/mc/dist as well as app/www
  { name: 'app-e2e', cwd: 'app', cmd: ['node', 'tools/e2e.mjs'], www: true, dist: true, ui: true, mb: 1300, secs: 65, libs: [SERVER, BUNDLES],
    inputs: [...MC, ...APP, DOWNLOAD, ...APP_LOCK, ...WEB_LOCK] },
  ...E2E.map(([script, secs, mb = E2E_DEFAULT_MB]) => ({
    name: `mc-${script}`, cwd: 'webapp/mc', cmd: ['node', `test/e2e/${script}.mjs`], ui: true, mb, secs,
    ...(script in E2E_TASKS ? { tasks: E2E_TASKS[script] } : {}),
    env: jobBlockEnv, libs: [PORTS],
    inputs: [...MC, DOWNLOAD, ...WEB_LOCK],
  })),
];

const byName = new Map(REGISTRY.map(r => [r.name, r]));
if (byName.size !== REGISTRY.length) throw new Error('scripts/lib/jobs.mjs: two jobs share a name');

/** Every job name, in registry order (--list prints it; the run queue sorts by `secs`, ties in this order). */
export const JOB_NAMES = Object.freeze(REGISTRY.map(r => r.name));

/** The declared repo-relative inputs of a job: COMMON plus its own, without duplicates. */
export function inputsForJob(name) {
  const r = byName.get(name);
  if (!r) throw new Error(`no declared inputs for test-all job: ${name}`);
  return [...new Set([...COMMON, ...r.inputs])];
}

/** The jobs whose own code imports or reads `libPath` (a scripts/lib file), from their `libs`. */
export const jobsReadingLib = libPath => REGISTRY.filter(r => (r.libs || []).includes(libPath)).map(r => r.name);

/** test-all's job filter: --ui admits the browser gates, and a filter word matches a substring of the name. */
export const selectFiltered = (jobs, ui, filters) =>
  jobs.filter(j => (ui || !j.ui) && (!filters.length || filters.some(f => j.name.includes(f))));

/** Every UI job besides app-screens, as {name, mb, secs}: what app-screens leaves room for. */
export const OTHER_UI_JOBS = Object.freeze(REGISTRY.filter(r => r.ui && r.name !== 'app-screens').map(({ name, mb, secs }) => ({ name, mb, secs })));
// app-screens is sized from these static costs: a cost set only in `sized` would make its plan NaN, with no error.
for (const j of OTHER_UI_JOBS) {
  if (!Number.isFinite(j.mb) || !Number.isFinite(j.secs)) throw new Error(`scripts/lib/jobs.mjs: UI job ${j.name} needs a static mb and secs`);
}

/** Every job, sized for this run. `ctx`: budgetMb and cpus (the run's share), python and noSkip (the mcp runner),
 *  logs (the run's log dir), ui and filters (the selection, which sets app-screens' room), tasks (taskHeadroom(),
 *  or null on a box with no task cap). */
export function resolveJobs({ budgetMb, cpus, python, noSkip = [], logs, ui, filters = [], tasks = null }) {
  // Worker counts: a quarter of the cores, and no runner may take more than a quarter of the budget for its workers.
  const pyJ = workerCount(70, 16, cpus, budgetMb), vitestW = workerCount(300, 8, cpus, budgetMb), siteW = workerCount(300, 8, cpus, budgetMb);
  // app-screens is sized against what is left after the OTHER ui jobs THIS run selects (not the whole budget): a full
  // --ui run selects all of them, so screensBudget clamps the reservation at its historical fair half; a filtered or
  // --changed run that drops most of them leaves app-screens the rest.
  const otherUiMb = (ui ? OTHER_UI_JOBS.filter(j => !filters.length || filters.some(f => j.name.includes(f))) : [])
    .reduce((sum, j) => sum + j.mb, 0);
  let screens = screensBudget(cpus, budgetMb, otherUiMb);   // the long pole
  if (tasks) {
    const shards = taskScreensShards(screens.shards, tasks.free, TASK_RESERVE);
    screens = { shards, ...screensJobSize(shards) };
  }
  const s = { pyJ, vitestW, siteW, python, noSkip, logs, screens, screensCap: screensBudget(cpus, budgetMb).shards };
  return REGISTRY.map(({ inputs, libs, sized, ...r }) => ({ cores: 1, ...r, ...(sized ? sized(s) : {}) }));
}
