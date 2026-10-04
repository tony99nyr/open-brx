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
