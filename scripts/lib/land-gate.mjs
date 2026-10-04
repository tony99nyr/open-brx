/** Parse test-all's result table, per-job logs, and failed shared builds. */
export function parseGate(out) {
  const all = out.split('\n');
  const h = all.findIndex(l => /^job\s+result\s+secs\s*$/.test(l));
  const rows = [];
  if (h >= 0) {
    for (const l of all.slice(h + 1)) {
      const m = /^(\S+?)\s*(ok|FAIL|TIMEOUT)\s+\d+\s*$/.exec(l);
      if (!m) break;
      rows.push({ name: m[1], ok: m[2] === 'ok' });
    }
  }
  const logs = {};
  for (const m of out.matchAll(/^---- (\S+) \(exit [^)]*\), last \d+ lines of (.+)$/gm)) logs[m[1]] = m[2].trim();
  const build = /^(app-build|mc-dist-build|mc-build) failed, see (.+)$/m.exec(out);
  return { rows, logs, build: build ? { name: build[1], log: build[2].trim() } : null };
}
