// Checkout lock helpers for scripts/test-all.mjs. A directory under /tmp is keyed by the checkout's real path
// and the user's uid, so shells that use different temporary directories still serialise the same checkout.
// The lock pool heartbeats its lease. A waiting run reclaims a dead owner's lease after a 10 s grace, or an
// unresponsive live owner's lease after the full stale interval. A run marker records the owner's runId so the
// next holder waits for any build or job group that survived a crash.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function entryPid(name) {
  const pid = Number(name.split('-')[1]);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

export const oldMachineLockDir = (uid = os.userInfo().uid) =>
  path.join('/tmp', `brx-test-all-${uid}.lock`);

/** This transition check can go once every checkout runs step 6 and uses the pool. */
export function oldMachineLockPid(dir = oldMachineLockDir()) {
  let names;
  try { names = fs.readdirSync(dir).sort(); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  for (const name of names) {
    const pid = entryPid(name);
    if (pid !== null && pidAlive(pid)) return pid;
  }
  return null;
}

/** changedAt and now use the same monotonic clock (performance.now()). A suspended machine pauses that clock,
 *  so waking does not make a live holder stale. Wait 10 s after a dead PID's last heartbeat: PID namespaces
 *  and reuse make an immediate dead read unsafe. A live PID needs the full stale interval without a heartbeat. */
export function isStale(name, changedAt, now, staleMs = 60_000, deadPidGraceMs = 10_000) {
  const idleMs = now - changedAt;
  const pid = entryPid(name);
  if (pid !== null && !pidAlive(pid)) return idleMs > deadPidGraceMs;
  return idleMs > staleMs;
}

export function checkoutLockDir(root, uid = os.userInfo().uid) {
  const real = fs.realpathSync(root);
  const hash = crypto.createHash('sha256').update(real).digest('hex');
  return path.join('/tmp', `brx-test-checkout-${uid}-${hash}.lock`);
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const groupAlive = pgid => {
  if (!Number.isInteger(pgid) || pgid <= 0) return false;
  try { process.kill(-pgid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
};

function liveRunLease(poolDir, runId) {
  let names;
  try { names = fs.readdirSync(poolDir).filter(name => name.endsWith('.lease')); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  for (const name of names) {
    let lease;
    try { lease = JSON.parse(fs.readFileSync(path.join(poolDir, name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) continue; throw error; }
    if (lease.runId === runId && (pidAlive(lease.pid) || groupAlive(lease.pgid) ||
        Date.now() - lease.heartbeat <= 10_000)) return true;
  }
  return false;
}

/** One run per checkout. Surviving pool leases delay the next run after a crash. */
export async function acquireCheckoutLock(root, { dir = checkoutLockDir(root), pollMs = 250,
  heartbeatMs = 2_000, staleMs = 300_000, signal, runId = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`,
  poolDir, oldLockDir = oldMachineLockDir() } = {}) {
  const { createPool, poolDirName } = await import('./pool.mjs');
  poolDir ??= poolDirName();
  const lock = createPool({ dir, poolMb: 1, reserveMb: 0, poolCores: 1,
    readAvailableMb: () => Number.POSITIVE_INFINITY, pollMs, heartbeatMs, staleMs,
    oldLockDir });
  const stop = () => lock.close();
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const lease = await lock.acquire({ runId, job: 'checkout', mb: 1, cores: 1 });
    let waiting = false;
    for (const name of fs.readdirSync(dir).filter(name => name.startsWith('run-') && name.endsWith('.json'))) {
      const marker = path.join(dir, name);
      let previous;
      try { previous = JSON.parse(fs.readFileSync(marker, 'utf8')).runId; }
      catch (error) { if (error.code === 'ENOENT') continue; if (!(error instanceof SyntaxError)) throw error; }
      while (previous && liveRunLease(poolDir, previous)) {
        if (signal?.aborted) throw new Error('checkout lock cancelled');
        if (!waiting) { console.error(`test-all: waiting for prior checkout run ${previous} to finish`); waiting = true; }
        await delay(pollMs);
      }
      fs.rmSync(marker, { force: true });
    }
    const marker = path.join(dir, `run-${crypto.randomBytes(12).toString('hex')}.json`);
    fs.writeFileSync(marker, JSON.stringify({ runId }));
    const release = () => {
      lease.release();
      if (!liveRunLease(poolDir, runId)) fs.rmSync(marker, { force: true });
      lock.close();
      signal?.removeEventListener('abort', stop);
    };
    if (signal?.aborted) {
      release();
      throw new Error('checkout lock cancelled');
    }
    return release;
  } catch (error) {
    lock.close();
    signal?.removeEventListener('abort', stop);
    throw error;
  }
}
