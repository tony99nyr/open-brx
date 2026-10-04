// Golden traces (architecture item #6): every trace in test/fixtures/traces/ replayed through the real engine
// must reproduce its recorded `expect` exactly: every gun write, in order, and every recorded state field at every
// checkpoint. A difference fails with the first differing checkpoint and write. This test NEVER re-records: if the
// change is meant, re-record with `node tools/record-traces.mjs <name>` and review the diff (fixtures/traces/README.md).
// mcp/tests/test_golden_traces.py replays the same files through the bench stage (GunStage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traceNames, loadTrace, runEngine, firstDiff, FIELDS, fieldsOf } from './golden-trace-runner.mjs';

const names = traceNames();

test('golden traces: the folder holds traces, and each one is well formed', () => {
  assert.ok(names.length >= 7, `the starter set is at least seven traces: ${names}`);
  for (const n of names) {
    const t = loadTrace(n);
    assert.equal(t.name, n, `${n}.json: "name" matches the file`);
    assert.ok(t.why && t.why.length > 20, `${n}: says why it exists`);
    assert.ok(Array.isArray(t.runners) && t.runners.includes('engine'), `${n}: runs on the engine`);
    assert.ok(t.runners.every(r => r === 'engine' || r === 'stage'), `${n}: runners are engine/stage`);
    assert.ok(Array.isArray(t.expect) && t.expect.length, `${n}: has a recorded expect (node tools/record-traces.mjs ${n})`);
    for (const k of fieldsOf(t)) assert.ok(FIELDS[k], `${n}: unknown state field ${k}`);
    // `preamble` marks where the match is live and settled; the stage compares only state there, so it may sit on the
    // FIRST checkpoint only (a later one would hide writes from the stage compare)
    const checks = t.steps.filter(s => s.check);
    assert.ok(checks.slice(1).every(s => !s.preamble), `${n}: "preamble" is allowed on the first checkpoint only`);
    if (t.runners.includes('stage')) assert.ok(checks[0] && checks[0].preamble, `${n}: a stage trace marks its first checkpoint "preamble"`);
    for (const ig of t.stage_ignores || []) assert.ok(ig.what && ig.why && ig.why.length > 10, `${n}: every stage_ignores entry has a what and a why: ${JSON.stringify(ig)}`);
    if (!t.runners.includes('stage')) assert.ok((t.stage_ignores || []).some(ig => ig.what === 'trace'), `${n}: an engine-only trace says why the stage cannot run it (stage_ignores what: "trace")`);
  }
});

for (const name of names) {
  test(`golden trace ${name}: the engine reproduces the recording`, async () => {
    const trace = loadTrace(name);
    const run = await runEngine(trace);
    const diff = firstDiff(trace, run);
    assert.equal(diff, null, `${name}: the engine diverged from its golden trace.\n${diff}\n`
      + `If this change is intended, re-record: cd app && node tools/record-traces.mjs ${name}`);
  });
}
