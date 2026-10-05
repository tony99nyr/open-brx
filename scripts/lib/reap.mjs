import fs from 'node:fs';
import path from 'node:path';

// Leftover processes, found by an environment token. A gate tags every job with a token in its environment, and
// everything the job starts inherits it: an MC or a vite server spawned `detached` (its own session, out of reach of
// a kill to the job's process group), headless Chrome, a Python child. When the job ends, by any path, whatever still
// carries the token is a leftover. 2026-10-05: six demo MCs from a deleted lander worktree ran for 15 h, because the
// e2e scripts start MC detached and most of them die on SIGTERM without running their `finally`.
// Linux only (it reads /proc); elsewhere it finds nothing.

/** The pids (not this process) whose environment holds `key=value`, or `key=<value>...` when `prefix` is set. */
export function findByEnv(key, value, { prefix = false, procRoot = '/proc' } = {}) {
  const want = `${key}=${value}`;
  const found = [];
  let names = [];
  try { names = fs.readdirSync(procRoot).filter(name => /^\d+$/.test(name)); } catch { return found; }
  for (const name of names) {
    const pid = Number(name);
    if (pid === process.pid) continue;
    let environ;
    try { environ = fs.readFileSync(path.join(procRoot, name, 'environ'), 'latin1'); } catch { continue; }   // gone, or not ours
    if (environ.split('\0').some(kv => (prefix ? kv.startsWith(want) : kv === want))) found.push(pid);
  }
  return found;
}

const comm = pid => { try { return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch { return '?'; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const signal = (pid, sig) => { try { process.kill(pid, sig); } catch { /* gone */ } };

/** SIGTERM every process carrying the token, then SIGKILL what is left after `waitMs`. Returns [{ pid, comm }]. */
export async function reapByEnv(key, value, { prefix = false, waitMs = 2000, procRoot = '/proc' } = {}) {
  const pids = findByEnv(key, value, { prefix, procRoot });
  if (!pids.length) return [];
  const named = pids.map(pid => ({ pid, comm: comm(pid) }));
  for (const pid of pids) signal(pid, 'SIGTERM');
  for (let waited = 0; waited < waitMs && pids.some(alive); waited += 100) await new Promise(r => setTimeout(r, 100));
  for (const pid of pids) if (alive(pid)) signal(pid, 'SIGKILL');
  return named;
}

/** The same, synchronously, for a signal handler that must finish before the process exits. */
export function reapByEnvSync(key, value, { prefix = false, waitMs = 2000, procRoot = '/proc' } = {}) {
  const pids = findByEnv(key, value, { prefix, procRoot });
  if (!pids.length) return [];
  const named = pids.map(pid => ({ pid, comm: comm(pid) }));
  for (const pid of pids) signal(pid, 'SIGTERM');
  const tick = new Int32Array(new SharedArrayBuffer(4));
  for (let waited = 0; waited < waitMs && pids.some(alive); waited += 100) Atomics.wait(tick, 0, 0, 100);
  for (const pid of pids) if (alive(pid)) signal(pid, 'SIGKILL');
  return named;
}
