// T8 (2026-10-10 review): one-run switches for a single gate script. Inherited by every test-all job, a stray ONLY ran
// no steps in the gates that do not reject an unknown step, and they printed ALL GOOD. test-all is never that single
// run, so its jobs never see them.
export const DEBUG_ENV = ['ONLY', 'HEADED', 'KEEP_SHOTS', 'DBG', 'ALLOW_STALE'];   // ALLOW_STALE: app/tools/e2e.mjs, mid-edit only

/** `env` without the single-script switches, and the names it dropped. */
export function stripDebugEnv(env) {
  const dropped = DEBUG_ENV.filter(k => k in env);
  return { env: Object.fromEntries(Object.entries(env).filter(([k]) => !DEBUG_ENV.includes(k))), dropped };
}
