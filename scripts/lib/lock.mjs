// Pure logic for scripts/test-all.mjs's machine-wide lock. Tested in mcp/tests/test_test_all_lock.py by calling
// the real node module, not by reimplementing this here.
//
// An entry in the lock directory is named `<start-ms>-<pid>-<rand>`; its heartbeat is its mtime, touched every
// 5s by the run that owns it. A waiting run reclaims another run's entry in one of two ways:
//   - fast: that run's PID no longer exists (it crashed, or was SIGKILLed) -- reclaim it immediately, without
//     waiting out the heartbeat window;
//   - slow: the PID is alive but its heartbeat has gone quiet for `staleMs` (wedged, or a suspended laptop's
//     entry the OWNER itself would also see as stale on wake) -- reclaim it only then.

/** The pid encoded in a lock entry's name, or null if the name is not one of ours. */
export function entryPid(name) {
  const pid = Number(name.split('-')[1]);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

/** True if a process with this pid still exists (alive, or alive but owned by someone else: EPERM still means
 *  "still there"). False only for ESRCH (no such process). */
export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

/** `changedAt`/`now` are the SAME monotonic clock (performance.now()), so a suspended machine's paused clock
 *  cannot make a live holder look stale mid-sleep. */
export function isStale(name, changedAt, now, staleMs = 60_000) {
  const pid = entryPid(name);
  if (pid !== null && !pidAlive(pid)) return true;
  return now - changedAt > staleMs;
}

/** The machine-wide lock directory for this user: $XDG_RUNTIME_DIR (cleared on logout, so nothing to clean up
 *  by hand) if set, else the OS temp dir. Keyed by username so two people on a shared box never queue behind
 *  each other, and so a stale entry from another user's checkout is never even considered. */
export function lockDirName(username) {
  return `brx-test-all-${username}.lock`;
}
