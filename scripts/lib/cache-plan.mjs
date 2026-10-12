// scripts/test-all.mjs's use of the result cache (A10, the test-all split, stage 4). lib/cache.mjs is the store and its
// keys; this module decides, per job, what the key is, which jobs hit before the builds, which hits survive the builds,
// and when a pass is stored. The bypass decisions (a debug switch, a changed install, stale build outputs) stay in
// test-all.mjs, which turns the cache off.
import path from 'node:path';
import { cacheKey, inputTreeHash, jobContext, keyedEnv, readCache, storePass } from './cache.mjs';
import { inputsForJob } from './jobs.mjs';
import { npmInstallState } from './launcher.mjs';

// Per-run paths and parallelism settings do not change what a job tests, and per-run paths would make a key that
// never repeats: leave them out (app-screens' shard files are new per run).
export const RUN_ONLY_ENV = new Set(['SCREENS_OUT', 'SCREENS_ACK_FILE', 'SCREENS_WANT_FILE', 'SCREENS_SHARDS',
  'SCREENS_MAX_SHARDS', 'SCREENS_DYNAMIC']);

/** The npm packages whose install a job depends on. */
export const packageFor = j => [...new Set([
  ...(j.cwd === 'app' || j.www ? ['app'] : []),
  ...(j.cwd === 'site' ? ['site'] : []),
  ...(j.cwd === 'webapp/mc' || j.dist ? ['webapp/mc'] : []),
])];

/** The environment a job's key covers: the interpreter, the keyed process variables and the job's own static env. */
export const staticEnv = (j, { python, env = process.env }) => ({ MC_PY: python, ...keyedEnv(env), ...Object.fromEntries(
  Object.entries(typeof j.env === 'object' && j.env ? j.env : {}).filter(([name]) => !RUN_ONLY_ENV.has(name))) });

/** `fingerprint()` returns the current tool fingerprint (test-all refreshes it under the checkout lock). `store` is
 *  lib/cache.mjs's storePass (a test passes a recorder). */
export function createCachePlanner({ root, python, fingerprint, store = storePass, log = m => console.log(m),
  logError = m => console.error(m) }) {
  const installedState = pkg => npmInstallState(path.join(root, pkg)).installed;

  /** Each job's input hash, context and key, and the jobs that hit. A job whose npm install marker is missing, or whose
   *  lookup fails, runs. Returns { hits, before, keys, contexts }. */
  function plan(jobs) {
    const hits = new Map(), before = new Map(), keys = new Map(), contexts = new Map();
    const hashes = new Map(), installed = new Map();
    for (const j of jobs) {
      try {
        const missing = packageFor(j).filter(pkg => {
          if (!installed.has(pkg)) installed.set(pkg, installedState(pkg));
          return installed.get(pkg) === null;
        });
        if (missing.length) {
          log(`test-all: cache bypassed for ${j.name} (missing installed npm marker: ${missing.join(', ')})`);
          continue;
        }
        const inputs = inputsForJob(j.name);
        const spec = JSON.stringify(inputs);
        let hash = hashes.get(spec);
        if (!hash) { hash = inputTreeHash(root, inputs); hashes.set(spec, hash); }
        const context = jobContext(root, j.name);
        const key = cacheKey({ job: j.name, cmd: [j.cwd, ...j.cmd], env: staticEnv(j, { python }), fingerprint: fingerprint(),
          inputHash: hash, context });
        before.set(j.name, hash);
        contexts.set(j.name, context);
        keys.set(j.name, key);
        const hit = readCache(root, key);
        if (hit && hit.job === j.name) hits.set(j.name, { name: j.name, code: 0, secs: 0, cached: true });
      } catch (e) {
        logError(`test-all: cache lookup for ${j.name} failed (${e.message}); running it`);
      }
    }
    return { hits, before, keys, contexts };
  }

  /** The install state of every package `jobs` depend on, before the builds. */
  function installedAt(jobs) {
    const state = new Map();
    for (const j of jobs) for (const pkg of packageFor(j)) if (!state.has(pkg)) state.set(pkg, installedState(pkg));
    return state;
  }
  /** The packages whose install changed since `state` was taken. */
  const changedSince = state => [...state].filter(([pkg, was]) => installedState(pkg) !== was).map(([pkg]) => pkg);

  /** A build may rewrite a declared input: drops from `hits` each job whose input tree changed since `planned`. */
  function recheckAfterBuild(jobs, planned, hits) {
    const afterBuild = new Map();
    for (const j of jobs) {
      if (!hits.has(j.name)) continue;
      try {
        const inputs = inputsForJob(j.name);
        const spec = JSON.stringify(inputs);
        if (!afterBuild.has(spec)) afterBuild.set(spec, inputTreeHash(root, inputs));
        if (afterBuild.get(spec) !== planned.before.get(j.name)) hits.delete(j.name);
      } catch (e) {
        logError(`test-all: cache post-build check for ${j.name} failed (${e.message}); running it`);
        hits.delete(j.name);
      }
    }
  }

  /** Stores a pass. `stopping` (or a changed context or install since the plan) stores it as not reusable. */
  function storeIfPassed(j, planned, { code, secs, head, stopping, installedAtPlan }) {
    const before = planned.before.get(j.name) || null, key = planned.keys.get(j.name) || null;
    if (!before || !key || code !== 0 || stopping) return;
    try {
      const after = inputTreeHash(root, inputsForJob(j.name));
      const sameContext = JSON.stringify(planned.contexts.get(j.name)) === JSON.stringify(jobContext(root, j.name));
      const samePackages = packageFor(j).every(pkg => installedState(pkg) === installedAtPlan.get(pkg));
      store(root, { job: j.name, key, exit: 0, secs, head, before, after, stopping: stopping || !sameContext || !samePackages });
    } catch (e) { logError(`test-all: cache store for ${j.name} failed (${e.message})`); }
  }

  return { plan, installedAt, changedSince, recheckAfterBuild, storeIfPassed };
}
