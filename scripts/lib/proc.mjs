/** True when the process exists or the OS does not permit this process to signal it. */
export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}
