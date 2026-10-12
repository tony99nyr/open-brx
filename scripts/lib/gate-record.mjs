// The run's machine-readable record, results.json (A12, the gate seam; moved out of scripts/test-all.mjs by A10 stage 1).
// land-gate.mjs reads it (gateGreen). The record is written to `<logs>/results.json` and, when the lander asks with
// BRX_RESULTS_JSON, to that path too, each by an atomic rename.
import fs from 'node:fs';
import path from 'node:path';

/** A run's record. `resultsJson` is the lander's path (or undefined). `logError` reports a write failure. */
export function createGateRecord({ logs, resultsJson, logError = message => console.error(message) }) {
  const record = { version: 1, complete: false, selected: [], jobs: [], build: null,
    startedAt: new Date().toISOString(), finishedAt: null };
  let written = false;
  const own = path.join(logs, 'results.json');

  /** One job's result, from test-all's {name, code, secs, log, cached}. */
  function addJob(r) {
    record.jobs.push({ name: r.name, ok: r.code === 0,
      exit: typeof r.code === 'number' || r.code === 'TIMEOUT' || /^SIG[A-Z]+$/.test(r.code) ? r.code : 1,
      secs: r.secs, log: r.log || path.join(logs, `${r.name}.log`), cached: !!r.cached });
  }

  /** Writes the record. Returns false when the lander's copy could not be written: the run must not exit 0 then,
   *  because without the record the lander would fall back to the printed table. */
  function write(complete = false) {
    record.complete = complete;
    record.finishedAt = new Date().toISOString();
    let wroteOwn = false, landerOk = true;
    for (const target of new Set([own, resultsJson].filter(Boolean))) {
      let temp;
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(record) + '\n');
        fs.renameSync(temp, target);
        if (target === own) wroteOwn = true;
      } catch (error) {
        logError(`test-all: could not write results to ${target}: ${error.message}`);
        if (target === resultsJson) landerOk = false;
      }
      finally {
        if (temp) {
          try { fs.rmSync(temp, { force: true }); }
          catch (error) { logError(`test-all: could not remove ${temp}: ${error.message}`); }
        }
      }
    }
    written = true;
    if (wroteOwn) logError(`test-all: results in ${own}`);
    return landerOk;
  }

  return { record, addJob, write, get written() { return written; } };
}
