// T8 (2026-10-10 review): one-run switches for a single gate script. Inherited by every test-all job, a stray ONLY ran
// no steps in the gates that do not reject an unknown step, and they printed ALL GOOD. test-all is never that single
// run, so its jobs never see them.
export const DEBUG_ENV = ['ONLY', 'HEADED', 'KEEP_SHOTS', 'DBG', 'ALLOW_STALE'];   // ALLOW_STALE: app/tools/e2e.mjs, mid-edit only

// 2026-10-24: a stalled WSLg compositor hung every headless Chromium `page.screenshot` while WAYLAND_DISPLAY was set,
// and every browser gate timed out. A headless browser never needs a display, so no job inherits it. Not reported:
// it is the host's, not a switch someone set.
export const HOST_DISPLAY_ENV = ['WAYLAND_DISPLAY'];

/** `env` without the single-script switches and the host display, and the switch names it dropped. */
export function stripDebugEnv(env) {
  const dropped = DEBUG_ENV.filter(k => k in env);
  const drop = new Set([...DEBUG_ENV, ...HOST_DISPLAY_ENV]);
  return { env: Object.fromEntries(Object.entries(env).filter(([k]) => !drop.has(k))), dropped };
}
