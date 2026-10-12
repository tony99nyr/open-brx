// The land lane's flake ledger, flakes.jsonl (A11, the land.mjs split, stage 1). One JSON row per flake the lander
// retried, plus incident rows ({"incident": {"from", "to", "note"}}) that mark a window when the MACHINE failed, not the
// tests (2026-10-04: WSL's 4915-task cgroup cap; every rerun then failed too). Flakes inside an incident stay in the
// file as evidence but leave the counts, so they cannot hide or fake a recurring job.
import fs from 'node:fs';
import path from 'node:path';

// T1 (2026-10-10 review): a job that keeps flaking is a problem, not noise. Over budget (FLAKE_BUDGET flakes of that job
// in 24 h, incident windows and box-load gates excluded), gate() reports the flake, and settle() makes a branch red
// whose OWN diff touches the job's inputs (it may be the cause); every other branch lands with a warning.
// LAND_FLAKE_BUDGET=off for an incident.
export const FLAKE_BUDGET = 3;
const FLAKE_WINDOW_MS = 24 * 3_600_000;

/** Incident windows from flakes.jsonl rows; one with no (or no valid) `to` is still open. */
const incidentWindows = rows => rows.filter(r => r.incident)
  .map(r => ({ from: Date.parse(r.incident.from), to: Date.parse(r.incident.to) || Infinity, note: r.incident.note }));

/** The ledger at `file`. `record` appends a row and remembers it for this run's summary. */
export function createFlakeLedger(file) {
  const runFlakes = [];
  function record(f) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const row = { ...f, time: new Date().toISOString() };
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
    runFlakes.push(row);
  }
  function rows() {
    try {
      return fs.readFileSync(file, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  }
  /** This job's flakes in the last 24 h that count: not in an incident window, not from a job that waited on outside
   *  load, and not dated in the future (WSL steps its clock back under load). null when `now` is itself inside an
   *  incident: the flake being counted happened in it, so it does not count either. */
  function counted(job, now = Date.now()) {
    const all = rows();
    const incidents = incidentWindows(all);
    const inIncident = ms => incidents.some(i => ms >= i.from && ms <= i.to);
    if (inIncident(now)) return null;
    return all.filter(f => {
      const ms = Date.parse(f.time), age = now - ms;
      return f.job === job && !f.outside_load && !inIncident(ms) && age >= 0 && age <= FLAKE_WINDOW_MS;
    }).length;
  }
  /** The line the lander prints: this run's flakes and the last 7 days', incident rows left out. */
  function summary(now = Date.now()) {
    const all = rows();
    const since = now - 7 * 86_400_000;
    const incidents = incidentWindows(all);
    const inIncident = f => incidents.some(i => Date.parse(f.time) >= i.from && Date.parse(f.time) <= i.to);
    const recent = all.filter(f => f.job && Date.parse(f.time) >= since);
    const excluded = recent.filter(inIncident);
    const count = list => list.reduce((m, f) => m.set(f.job, (m.get(f.job) || 0) + 1), new Map());
    const fmt = m => (m.size ? [...m].sort((a, b) => b[1] - a[1]).map(([j, n]) => {
      const latest = [...all].reverse().find(f => f.job === j && f.exit);
      return `${j} x${n}${latest ? ` (exit ${latest.exit})` : ''}`;
    }).join(', ') : 'none');
    const note = excluded.length ? `; ${excluded.length} excluded as incident noise (${[...new Set(incidents.map(i => i.note))].join('; ')})` : '';
    return `flakes this run: ${fmt(count(runFlakes))}; last 7 days: ${fmt(count(recent.filter(f => !inIncident(f))))}${note}`
      + ' (a job that keeps coming back here is a FOLLOWUPS row)';
  }
  return { record, rows, counted, summary };
}
