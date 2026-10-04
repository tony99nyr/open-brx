import fs from 'node:fs';

/** Sum PSS in kB for the process groups and descendant trees rooted at `pids`. */
export function sumTreePssKb(pids, procRoot = '/proc') {
  const roots = new Set(pids.map(Number));
  const processes = new Map();
  let entries;
  try { entries = fs.readdirSync(procRoot); } catch { return null; }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = fs.readFileSync(`${procRoot}/${entry}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      processes.set(Number(entry), { ppid: Number(fields[1]), pgid: Number(fields[2]) });
    } catch { /* process exited while scanning */ }
  }
  const groups = roots;
  const included = new Set([...processes].filter(([pid, p]) => roots.has(pid) || groups.has(p.pgid)).map(([pid]) => pid));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, process] of processes) {
      if (!included.has(pid) && included.has(process.ppid)) { included.add(pid); changed = true; }
    }
  }
  let total = 0;
  for (const pid of included) {
    try {
      const text = fs.readFileSync(`${procRoot}/${pid}/smaps_rollup`, 'utf8');
      const match = /^Pss:\s+(\d+)/m.exec(text);
      if (match) total += Number(match[1]);
    } catch { /* process exited while sampling */ }
  }
  return total;
}
