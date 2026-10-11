import fs from 'node:fs';

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
  const exits = {};
  for (const m of out.matchAll(/^---- (\S+) \(exit ([^)]*)\), last \d+ lines of (.+)$/gm)) {
    exits[m[1]] = m[2].trim();
    logs[m[1]] = m[3].trim();
  }
  const build = /^(app-build|mc-dist-build) failed, see (.+)$/m.exec(out);
  return { rows, logs, exits, build: build ? { name: build[1], log: build[2].trim() } : null };
}

/** Prefer the machine record. An older candidate has no record, so use its printed table. */
export function readGate(resultsPath, out) {
  if (!fs.existsSync(resultsPath)) return parseGate(out);   // a candidate older than the record runs its own test-all
  // An unreadable or malformed record is never green, and never a crash in the lander: report it as a failed build.
  const invalid = () => ({ rows: [], logs: {}, exits: {}, build: { name: 'results.json', log: resultsPath }, complete: false });
  let record;
  try { record = JSON.parse(fs.readFileSync(resultsPath, 'utf8')); } catch { return invalid(); }
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return invalid();
  const buildValid = record.build === null || (typeof record.build?.name === 'string'
    && typeof record.build?.log === 'string');
  const jobsValid = Array.isArray(record.jobs) && record.jobs.every(j => j !== null && typeof j === 'object'
    && !Array.isArray(j) && typeof j.name === 'string'
    && typeof j.ok === 'boolean' && (Number.isInteger(j.exit) || j.exit === 'TIMEOUT' || /^SIG[A-Z]+$/.test(j.exit))
    && typeof j.secs === 'number' && typeof j.log === 'string' && typeof j.cached === 'boolean');
  if (record.version !== 1 || typeof record.complete !== 'boolean' || !Array.isArray(record.selected)
    || !record.selected.every(name => typeof name === 'string') || !jobsValid || !buildValid
    || typeof record.startedAt !== 'string' || typeof record.finishedAt !== 'string')
    return invalid();
  const rows = record.jobs.map(j => ({ name: j.name, ok: j.ok }));
  const logs = Object.fromEntries(record.jobs.filter(j => j.log).map(j => [j.name, j.log]));
  const exits = Object.fromEntries(record.jobs.filter(j => !j.ok).map(j => [j.name, j.exit]));
  return { rows, logs, exits, build: record.build, complete: record.complete };
}

export function gateGreen(result, { code, expect }) {
  if (code !== 0 || result.build || result.complete === false || !expect.length || !result.rows.length
    || result.rows.length !== expect.length || result.rows.some(row => !row.ok)) return false;
  const names = new Set(expect);
  return names.size === expect.length && result.rows.every(row => names.has(row.name))
    && new Set(result.rows.map(row => row.name)).size === names.size;
}
