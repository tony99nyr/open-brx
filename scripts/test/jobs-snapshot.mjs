// The identity fixture for scripts/lib/jobs.mjs (mcp/tests/test_test_all_jobs.py). The fixture was first written by the
// runner as it stood before the registry (rawJobs in test-all.mjs at 17b9d4ee, through a throwaway dump with the same
// projection), so the registry's first commit proves it changed no job. After that the fixture pins every job: an
// intended change to one is a regenerated fixture, read as a diff.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jobTaskAllowance } from '../lib/budget.mjs';
import { JOB_NAMES, OTHER_UI_JOBS, inputsForJob, resolveJobs } from '../lib/jobs.mjs';

/** The identity fixture (mcp/tests/test_test_all_jobs.py): every job resolved under each context in `ctxs`, as plain
 *  JSON (an env function becomes the sorted names it sets), deduplicated. `ctx.tasksFree` stands for taskHeadroom(). */
export async function snapshot(ctxs) {
  const ids = new Map(), records = {}, combos = [];
  const envKeys = new Map();   // an env function binds three real ports: call it once per job, not once per context
  const logs = '/<LOGS>';
  for (const ctx of ctxs) {
    const jobs = [];
    const all = resolveJobs({ budgetMb: ctx.budgetMb, cpus: ctx.cpus, python: '<PY>', noSkip: ctx.noSkip, logs,
      ui: ctx.ui, filters: ctx.filters, tasks: ctx.tasksFree == null ? null : { free: ctx.tasksFree } });
    for (const j of all) {
      if (typeof j.env === 'function' && !envKeys.has(j.name)) envKeys.set(j.name, Object.keys(await j.env()).sort());
      const env = typeof j.env === 'function' ? { '<ports>': envKeys.get(j.name) } : (j.env || {});
      const rec = JSON.parse(JSON.stringify({ name: j.name, cwd: j.cwd, cmd: j.cmd, env, mb: j.mb, secs: j.secs, cores: j.cores,
        ui: !!j.ui, www: !!j.www, dist: !!j.dist, screensShards: j.screensShards ?? null, screensCap: j.screensCap ?? null,
        tasks: jobTaskAllowance(j) }).split(logs).join('<LOGS>'));
      const key = JSON.stringify(rec);
      if (!ids.has(key)) { ids.set(key, `r${ids.size}`); records[`r${ids.size - 1}`] = rec; }
      jobs.push(ids.get(key));
    }
    combos.push({ ctx, jobs });
  }
  return { version: 1, records, combos, inputs: Object.fromEntries(JOB_NAMES.map(n => [n, inputsForJob(n)])), otherUiJobs: OTHER_UI_JOBS };
}

/** The fixture file's layout: one record, context or job per line, so a changed job reads as a one-line diff. */
export function formatSnapshot(snap) {
  const rows = (o, f = ([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`) => Object.entries(o).map(f).join(',\n');
  return ['{', `"version": ${snap.version},`, '"records": {', rows(snap.records), '},', '"combos": [',
    snap.combos.map(c => `  ${JSON.stringify(c)}`).join(',\n'), '],', '"inputs": {', rows(snap.inputs), '},',
    `"otherUiJobs": ${JSON.stringify(snap.otherUiJobs)}`, '}'].join('\n') + '\n';
}

// `node scripts/test/jobs-snapshot.mjs <fixture>`: rewrite the fixture over its own contexts, after an intended change.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/test/jobs-snapshot.mjs <fixture.json>'); process.exit(2); }
  const ctxs = JSON.parse(fs.readFileSync(file, 'utf8')).combos.map(c => c.ctx);
  fs.writeFileSync(file, formatSnapshot(await snapshot(ctxs)));
  console.log(`jobs: wrote ${file}`);
}
