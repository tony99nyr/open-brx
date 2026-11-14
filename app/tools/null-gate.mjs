// The strict-null gate (bench 2026-11-14). App 0.4.41 shipped `bindAt.at` on a `bindAt` that is null for a `$BMAP,0,98` row,
// and every revive failed. `tsc` with strictNullChecks reports that line (TS18047), but app/src has about 1,200 older
// errors under that flag, so the whole tree cannot be made clean at once. This gate checks app/src with
// tsconfig.null.json and compares the result with null-baseline.json: a count per file, per error code, per message.
// Any count above its baseline fails, so a NEW error fails even in a file full of old ones. A count is not tied to a line
// number, so moving code does not trip it.
//
//   node tools/null-gate.mjs            check (the gate)
//   node tools/null-gate.mjs --update   rewrite the baseline. Do this only to record FIXED errors, and commit the diff.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const BASELINE = path.join(APP, 'null-baseline.json');

/** Each `file(line,col): error TSnnnn: message` line of tsc's plain output, parsed. Other lines are skipped. PURE. */
export function parseDiagnostics(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line.trim());
    if (m) out.push({ file: m[1].replace(/\\/g, '/'), line: +m[2], col: +m[3], code: m[4], message: m[5] });
  }
  return out;
}

/** The baseline shape: { file: { "TSnnnn message": count } }, keys sorted so the JSON diff reads well. PURE. */
export function countDiagnostics(diags) {
  const out = {};
  for (const d of [...diags].sort((a, b) => a.file.localeCompare(b.file))) {
    const key = `${d.code} ${d.message}`;
    (out[d.file] ??= {})[key] = (out[d.file][key] || 0) + 1;
  }
  for (const f of Object.keys(out)) out[f] = Object.fromEntries(Object.entries(out[f]).sort(([a], [b]) => a.localeCompare(b)));
  return out;
}

/** Compares `diags` with `baseline`. `added`: every diagnostic of a (file, code, message) whose count rose (all of them,
 *  since tsc cannot say which one is new). `fixed`: how many baselined errors are gone. PURE. */
export function compare(diags, baseline) {
  const now = countDiagnostics(diags), added = [];
  let fixed = 0;
  for (const [file, keys] of Object.entries(now)) {
    for (const [key, n] of Object.entries(keys)) {
      const was = (baseline[file] && baseline[file][key]) || 0;
      if (n > was) added.push(...diags.filter(d => d.file === file && `${d.code} ${d.message}` === key).map(d => ({ ...d, was, now: n })));
    }
  }
  for (const [file, keys] of Object.entries(baseline)) {
    for (const [key, was] of Object.entries(keys)) fixed += Math.max(0, was - ((now[file] && now[file][key]) || 0));
  }
  return { added, fixed, total: diags.length };
}

function runTsc() {
  const tsc = path.join(APP, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  try { return execFileSync(tsc, ['-p', 'tsconfig.null.json'], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 }); }
  catch (e) {
    if (e.status === 1 || e.status === 2) return String(e.stdout || '');   // tsc exits non-zero when it reports errors
    throw e;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const text = runTsc();
  const diags = parseDiagnostics(text);
  if (!diags.length && /error/i.test(text)) { console.error(text); process.exit(2); }   // a config error, not a diagnostic list
  if (process.argv.includes('--update')) {
    fs.writeFileSync(BASELINE, JSON.stringify(countDiagnostics(diags), null, 1) + '\n');
    console.log(`null-gate: baseline written, ${diags.length} error(s) in ${Object.keys(countDiagnostics(diags)).length} file(s)`);
    process.exit(0);
  }
  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
  const { added, fixed, total } = compare(diags, baseline);
  if (added.length) {
    console.error(`null-gate: NEW strict-null error(s) in app/src (tsconfig.null.json). Fix them; do not add them to the baseline.`);
    for (const d of added) console.error(`  ${d.file}(${d.line},${d.col}): ${d.code}: ${d.message}  [${d.was} in the baseline, ${d.now} now]`);
    process.exit(1);
  }
  console.log(`null-gate: no new errors (${total} baselined${fixed ? `; ${fixed} fixed: run with --update to lock them in` : ''})`);
}
