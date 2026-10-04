// Record golden traces (architecture item #6): replay each trace in test/fixtures/traces/ through the real
// `src/engine.js` and store what came out as the trace's `expect`. Re-recording is a deliberate act: run it only
// when the engine's behaviour is MEANT to change, and read the diff before committing (README.md in that folder).
//   node tools/record-traces.mjs <name>...           record these
//   ... --new                                        also record a trace whose expect is EMPTY (a new trace); without it an
//                                                    empty expect is refused, so a cleared or renamed trace never records silently
//   node tools/record-traces.mjs --all               every trace
//   ... --accept                                     also overwrite an expect that would CHANGE (after reading the diff)
// Without --accept, a trace whose recorded expect would change is NOT written: the diff is printed and the exit code is 1.
import { writeFileSync } from 'node:fs';
import { TRACE_DIR, traceNames, loadTrace, runEngine, toExpect, allDiffs } from '../test/golden-trace-runner.mjs';

const KEY_ORDER = ['name', 'why', 'source', 'runners', 'setup', 'steps', 'stage_ignores', 'expect'];

/** Pretty JSON that diffs well: one step per line, one write per line, each checkpoint's state on one line. */
function format(trace) {
  const keys = [...KEY_ORDER.filter(k => k in trace), ...Object.keys(trace).filter(k => !KEY_ORDER.includes(k))];
  const parts = keys.map(k => {
    const v = trace[k];
    if (k === 'runners') return `  "runners": ${JSON.stringify(v)}`;
    if (k === 'setup') { const ks = Object.keys(v); return ks.length ? `  "setup": {\n${ks.map(x => `    ${JSON.stringify(x)}: ${JSON.stringify(v[x])}`).join(',\n')}\n  }` : '  "setup": {}'; }
    if (k === 'steps' || k === 'stage_ignores') return v.length ? `  "${k}": [\n${v.map(s => '    ' + JSON.stringify(s)).join(',\n')}\n  ]` : `  "${k}": []`;
    if (k === 'expect') {
      const cps = v.map(c => `    {\n      "at": ${JSON.stringify(c.at)},\n      "state": ${JSON.stringify(c.state)},\n      "facts": ${JSON.stringify(c.facts || [])},\n      "reports": ${JSON.stringify(c.reports || [])},\n      "writes": [`
        + (c.writes.length ? '\n' + c.writes.map(w => '        ' + JSON.stringify(w)).join(',\n') + '\n      ' : '') + ']\n    }');
      return `  "expect": [\n${cps.join(',\n')}\n  ]`;
    }
    return `  "${k}": ${JSON.stringify(v, null, 2).split('\n').join('\n  ')}`;
  });
  return '{\n' + parts.join(',\n') + '\n}\n';
}

const args = process.argv.slice(2), flags = new Set(args.filter(a => a.startsWith('--')));
const unknown = [...flags].filter(f => f !== '--all' && f !== '--accept' && f !== '--new');
let names = args.filter(a => !a.startsWith('--'));
if (unknown.length || (!names.length && !flags.has('--all')) || (names.length && flags.has('--all'))) {
  console.error('usage: node tools/record-traces.mjs <name>... | --all   [--accept] [--new]\n'
    + '  Name the traces to record, or pass --all. A trace whose recorded expect would change is refused unless --accept.');
  process.exit(2);
}
if (flags.has('--all')) names = traceNames();
let refused = 0;
for (const name of names) {
  const trace = loadTrace(name);
  if (trace.name !== name) throw new Error(`${name}.json: "name" is ${JSON.stringify(trace.name)}, expected ${JSON.stringify(name)}`);
  const run = await runEngine(trace);
  const had = Array.isArray(trace.expect) && trace.expect.length > 0;
  if (!had && !flags.has('--new')) {
    refused++;
    console.error(`REFUSED ${name}: its expect is empty. A new trace is recorded only with --new (a cleared or renamed trace must not record silently).`);
    continue;
  }
  const diffs = had ? allDiffs(trace, run) : [];
  if (diffs.length && !flags.has('--accept')) {
    refused++;
    console.error(`REFUSED ${name}: the engine's output differs from the recorded expect (${diffs.length} checkpoint(s)).\n`
      + diffs.map(d => '  ' + d.split('\n').join('\n  ')).join('\n') + `\n  If this behaviour change is intended, re-run with --accept.\n`);
    continue;
  }
  trace.expect = toExpect(run);
  writeFileSync(TRACE_DIR + name + '.json', format(trace));
  const what = !had ? 'recorded (new)' : diffs.length ? `RE-RECORDED (${diffs.length} checkpoint(s) changed)` : 'unchanged';
  console.log(`${what} ${name}: ${trace.expect.length} checkpoint(s), ${trace.expect.reduce((n, c) => n + c.writes.length, 0)} write(s)`);
}
if (refused) process.exit(1);
