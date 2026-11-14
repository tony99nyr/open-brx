// The strict-null gate's comparison (tools/null-gate.mjs). The gate itself runs tsc (the app-null job); these check the
// rule that turns tsc's output into pass or fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiagnostics, countDiagnostics, compare } from '../tools/null-gate.mjs';

const OLD = [
  "src/engine.js(10,5): error TS18047: 'a' is possibly 'null'.",
  "src/engine.js(20,5): error TS18047: 'a' is possibly 'null'.",
  "src/hud/hud.js(3,1): error TS2532: Object is possibly 'undefined'.",
].join('\n');
// 0.4.41: `bindAt.at` where `bindAt` may be null, four reads on one line
const BIND = Array.from({ length: 4 }, (_, i) => `src/engine.js(1472,${34 + i}): error TS18047: 'bindAt' is possibly 'null'.`).join('\n');

test('tsc lines parse into file, line, code and message; other lines are skipped', () => {
  const d = parseDiagnostics(OLD + '\nFound 3 errors.\n  src/x.js(1,1): not an error line');
  assert.equal(d.length, 3);
  assert.deepEqual(d[0], { file: 'src/engine.js', line: 10, col: 5, code: 'TS18047', message: "'a' is possibly 'null'." });
});

test('the baseline counts per file, code and message, not per line', () => {
  assert.deepEqual(countDiagnostics(parseDiagnostics(OLD)), {
    'src/engine.js': { "TS18047 'a' is possibly 'null'.": 2 },
    'src/hud/hud.js': { "TS2532 Object is possibly 'undefined'.": 1 },
  });
});

test('the 0.4.41 bindAt deref is NEW against a baseline without it, and fails', () => {
  const base = countDiagnostics(parseDiagnostics(OLD));
  const { added } = compare(parseDiagnostics(OLD + '\n' + BIND), base);
  assert.equal(added.length, 4);
  assert.ok(added.every(d => d.file === 'src/engine.js' && d.line === 1472 && d.code === 'TS18047' && d.was === 0 && d.now === 4));
});

test('moved code passes; one more copy of an old message fails; a fixed error is counted', () => {
  const base = countDiagnostics(parseDiagnostics(OLD));
  const moved = OLD.replace('(10,5)', '(110,5)').replace('(20,5)', '(220,9)');
  assert.deepEqual(compare(parseDiagnostics(moved), base).added, []);
  const more = compare(parseDiagnostics(OLD + "\nsrc/engine.js(30,1): error TS18047: 'a' is possibly 'null'."), base);
  assert.equal(more.added.length, 3, 'all three are listed, since tsc cannot say which one is new');
  const fixed = compare(parseDiagnostics(OLD.split('\n').slice(1).join('\n')), base);
  assert.deepEqual([fixed.added.length, fixed.fixed], [0, 1]);
});

test('an error in a file with no baseline entry is new', () => {
  const { added } = compare(parseDiagnostics("src/new.js(1,1): error TS2531: Object is possibly 'null'."), {});
  assert.equal(added.length, 1);
});
