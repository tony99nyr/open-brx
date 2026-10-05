import fs from 'node:fs';
import path from 'node:path';

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/** Delete old test-all log dirs (`brx-test-all-<pid>`) in `root`: older than `maxAgeH` hours and with no live run pid.
 *  The newest `keep` of those are kept for debugging. Returns the paths deleted. 2026-10-05: /tmp held 1,722 of them,
 *  19 GB in all, because nothing ever removed one. */
export function pruneRunLogs(root, { maxAgeH = 24, keep = 5, now = Date.now(), self = process.pid } = {}) {
  let names = [];
  try { names = fs.readdirSync(root); } catch { return []; }
  const old = [];
  for (const name of names) {
    const m = /^brx-test-all-(\d+)$/.exec(name);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === self || alive(pid)) continue;   // a live run, or a reused pid: skip, never guess
    let mtime;
    try { mtime = fs.statSync(path.join(root, name)).mtimeMs; } catch { continue; }
    if (now - mtime > maxAgeH * 3_600_000) old.push({ dir: path.join(root, name), mtime });
  }
  old.sort((a, b) => b.mtime - a.mtime);
  const gone = [];
  for (const { dir } of old.slice(keep)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); gone.push(dir); } catch { /* another run took it */ }
  }
  return gone;
}
