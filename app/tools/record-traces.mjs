// Record golden traces (architecture item #6): replay each trace in test/fixtures/traces/ through the real
// `src/engine.js` and store what came out as the trace's `expect`. Re-recording is a deliberate act: run it only
// when the engine's behaviour is MEANT to change, and read the diff before committing (README.md in that folder).
//   node tools/record-traces.mjs            every trace
//   node tools/record-traces.mjs <name>...  just these
import { writeFileSync } from 'node:fs';
import { TRACE_DIR, traceNames, loadTrace, runEngine, toExpect } from '../test/golden-trace-runner.mjs';

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
      const cps = v.map(c => `    {\n      "at": ${JSON.stringify(c.at)},\n      "state": ${JSON.stringify(c.state)},\n      "writes": [`
        + (c.writes.length ? '\n' + c.writes.map(w => '        ' + JSON.stringify(w)).join(',\n') + '\n      ' : '') + ']\n    }');
      return `  "expect": [\n${cps.join(',\n')}\n  ]`;
    }
    return `  "${k}": ${JSON.stringify(v, null, 2).split('\n').join('\n  ')}`;
  });
  return '{\n' + parts.join(',\n') + '\n}\n';
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : traceNames();
for (const name of names) {
  const trace = loadTrace(name);
  if (trace.name !== name) throw new Error(`${name}.json: "name" is ${JSON.stringify(trace.name)}, expected ${JSON.stringify(name)}`);
  const run = await runEngine(trace);
  trace.expect = toExpect(run);
  writeFileSync(TRACE_DIR + name + '.json', format(trace));
  console.log(`recorded ${name}: ${trace.expect.length} checkpoint(s), ${trace.expect.reduce((n, c) => n + c.writes.length, 0)} write(s)`);
}
