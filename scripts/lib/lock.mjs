// Pure logic for scripts/test-all.mjs's machine-wide lock. Tested in mcp/tests/test_test_all_lock.py by calling
// the real node module, not by reimplementing this here.
//
// An entry in the lock directory is named `<start-ms>-<pid>-<rand>`; its heartbeat is its mtime, touched every
// 5s by the run that owns it. A waiting run reclaims another run's entry in one of two ways:
//   - fast: that run's PID no longer exists (it crashed, or was SIGKILLed), AND the entry has been idle for at
//     least `deadPidGraceMs` -- the grace matters because pids are namespaced/reused: a bare "does this pid
//     exist" check, taken the instant a heartbeat lapses, could be fooled by an unrelated process that grabbed
//     the same number moments later. Waiting a few seconds past the missed heartbeat before trusting the dead
//     read is nearly free (the holder is in fact gone) and removes that coincidence;
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
export function isStale(name, changedAt, now, staleMs = 60_000, deadPidGraceMs = 10_000) {
  const idleMs = now - changedAt;
  const pid = entryPid(name);
  if (pid !== null && !pidAlive(pid)) return idleMs > deadPidGraceMs;
  return idleMs > staleMs;
}

/** The machine-wide lock directory for this user: a FIXED path under /tmp, keyed by uid. Not $XDG_RUNTIME_DIR
 *  or $TMPDIR: either can differ between shells or session types for the SAME account (a desktop session vs.
 *  an ssh session, a plain shell vs. one under sudo -E), which would hand each its own lock directory and
 *  defeat the whole point of one machine-wide lock. A uid, not a username, because that is what the kernel
 *  itself uses to keep two accounts' locks apart (and a rename does not change it). */
export function lockDirName(uid) {
  return `brx-test-all-${uid}.lock`;
}
