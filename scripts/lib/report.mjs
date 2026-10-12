// scripts/test-all.mjs's printed report (A10, the test-all split, stage 1). Pure: each function returns the lines; the
// runner prints them. The lander reads results.json (gate-record.mjs), but when the record is missing land-gate.mjs's
// parseGate reads this table and the failure headings: keep their format (test_test_all_split.py round-trips them).
const pad = (s, n) => String(s).padEnd(n);
const verdict = code => code === 0 ? 'ok' : code === 'TIMEOUT' ? 'TIMEOUT' : 'FAIL';

/** The results table, slowest first, and the cached jobs' names. Sorts `results` in place (the runner prints the
 *  failures in the same order). */
export function tableLines(results, cachedNames = []) {
  const lines = [`\n${pad('job', 18)}${pad('result', 8)}secs`];
  for (const r of results.sort((a, b) => b.secs - a.secs)) lines.push(`${pad(r.name, 18)}${pad(verdict(r.code), 8)}${r.secs.toFixed(0)}`);
  if (cachedNames.length) lines.push(`cached: ${cachedNames.join(', ')}`);
  return lines;
}

/** The report when every selected job was a cache hit. */
export function allCachedLines(names) {
  return [`\n${pad('job', 18)}${pad('result', 8)}secs`, ...names.map(n => `${pad(n, 18)}${pad('ok', 8)}0`),
    `cached: ${names.join(', ')}`, `\n${names.length}/${names.length} job(s) passed in 0s (all cached)`];
}

/** A failed job's heading and the last 30 lines of its log (`logText` is null when the log is missing). */
export function failureLines(r, logText) {
  const lines = logText !== null ? logText.trimEnd().split('\n') : [String(r.code)];
  return [`\n---- ${r.name} (exit ${r.code}), last 30 lines of ${r.log}`, lines.slice(-30).join('\n')];
}

/** The closing line: passes, wall time and the memory and task figures. */
export function summaryLine({ passed, total, secs, realPeakMb, ceilingMb, taskPeak, taskMax, taskReserve, plannedPeakMb, budgetMb }) {
  const real = realPeakMb !== null ? `${realPeakMb.toFixed(0)} MB` : 'not measured';
  const tasks = taskPeak === null ? 'not measured'
    : `${taskPeak}${taskMax !== null ? ` of ${taskMax}` : ''} tasks${taskMax !== null && taskPeak > taskMax - taskReserve
      ? ` (over the ${taskReserve} reserve: outside load used the margin)` : ''}`;
  return `\n${passed}/${total} job(s) passed in ${secs.toFixed(0)}s (real peak ${real} against a ${ceilingMb} MB ceiling, peak ${tasks}, planned peak ${plannedPeakMb} MB, ${budgetMb} MB budget)`;
}
