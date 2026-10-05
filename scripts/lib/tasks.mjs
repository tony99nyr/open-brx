import fs from 'node:fs';
import path from 'node:path';

/** Return the cgroup task limit and current use, or null when no finite limit is available. */
export function taskHeadroom(procCgroup = '/proc/self/cgroup', cgroupRoot = '/sys/fs/cgroup') {
  try {
    const line = fs.readFileSync(procCgroup, 'utf8').split('\n').find(row => row.startsWith('0::'));
    if (!line) return null;
    let dir = path.join(cgroupRoot, line.slice(3).replace(/^\/+/, ''));
    const root = path.resolve(cgroupRoot);
    while (dir === root || dir.startsWith(`${root}${path.sep}`)) {
      const maxText = fs.readFileSync(path.join(dir, 'pids.max'), 'utf8').trim();
      if (maxText !== 'max') {
        const max = Number(maxText);
        const current = Number(fs.readFileSync(path.join(dir, 'pids.current'), 'utf8').trim());
        if (!Number.isFinite(max) || !Number.isFinite(current)) return null;
        return { max, current, free: Math.max(0, max - current) };
      }
      if (dir === root) break;
      dir = path.dirname(dir);
    }
  } catch { /* cgroups are optional, for example on macOS */ }
  return null;
}

/** The biggest task (thread) consumers on the box, by command name: [{ comm, tasks, procs }], most first. Linux only;
 *  [] elsewhere. Read only when a wait is reported, never on the admission path. */
export function topTaskConsumers(n = 3, procRoot = '/proc') {
  const byComm = new Map();
  let names = [];
  try { names = fs.readdirSync(procRoot).filter(name => /^\d+$/.test(name)); } catch { return []; }
  for (const pid of names) {
    try {
      const status = fs.readFileSync(path.join(procRoot, pid, 'status'), 'utf8');
      const comm = /^Name:\s*(.+)$/m.exec(status)?.[1]?.trim();
      const threads = Number(/^Threads:\s*(\d+)$/m.exec(status)?.[1]);
      if (!comm || !Number.isFinite(threads)) continue;
      const row = byComm.get(comm) || { comm, tasks: 0, procs: 0 };
      row.tasks += threads; row.procs += 1;
      byComm.set(comm, row);
    } catch { /* the process exited */ }
  }
  return [...byComm.values()].sort((a, b) => b.tasks - a.tasks).slice(0, n);
}
