import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { claimStep, finishStep, summariseClaims } from '../tools/lib/claims.mjs';

function tempDir() { return mkdtempSync(join(tmpdir(), 'brx-claims-')); }
function runWorker(script, dir, workerCount) {
  return Promise.all(Array.from({ length: workerCount }, (_, i) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, dir, String(i)], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)));
  })));
}
const workerSource = `import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { claimStep, finishStep } from ${JSON.stringify(new URL('../tools/lib/claims.mjs', import.meta.url).href)};
const dir = process.argv[2];
writeFileSync(dir + '/ready-' + process.argv[3], 'ready');
while (!existsSync(dir + '/go')) await new Promise(r => setTimeout(r, 1));
for (let i = 0; i < 2000; i++) { const name = 'step-' + i; if (!claimStep(dir, i, name)) continue;
 appendFileSync(dir + '/runs', i + '\\n'); finishStep(dir, i, name, 'pass'); }
`;

test('separate Node workers claim each step once across repeated runs', async () => {
  const root = tempDir();
  const script = join(root, 'worker.mjs'); writeFileSync(script, workerSource);
  try {
    for (let round = 0; round < 8; round += 1) {
      const dir = join(root, `round-${round}`); mkdirSync(dir);
      const workers = runWorker(script, dir, 8);
      const deadline = Date.now() + 5000;
      while (!Array.from({ length: 8 }, (_, i) => i).every(i => { try { return readFileSync(join(dir, `ready-${i}`), 'utf8'); } catch { return false; } }) && Date.now() < deadline) await new Promise(r => setTimeout(r, 5));
      writeFileSync(join(dir, 'go'), 'go');
      await workers;
      const executions = readFileSync(join(dir, 'runs'), 'utf8').trim().split('\n').map(Number).sort((a, b) => a - b);
      assert.deepEqual(executions, Array.from({ length: 2000 }, (_, i) => i));
      assert.deepEqual(summariseClaims(dir, 2000), { pass: 2000, fail: 0, errs: [] });
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the non-atomic exists/write mutation permits duplicate claims', async () => {
  const root = tempDir();
  try {
    const countFile = join(root, 'count');
    const script = join(root, 'mutant.mjs');
    writeFileSync(script, `import { existsSync, writeFileSync, appendFileSync } from 'node:fs';
const file = process.argv[2] + '/claim';
if (!existsSync(file)) { appendFileSync(process.argv[2] + '/ready', 'x');
while (!existsSync(process.argv[2] + '/go')) {};
writeFileSync(file, 'claimed'); appendFileSync(process.argv[2] + '/count', 'x'); }
`);
    const workers = [0, 1].map(() => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, root], { stdio: 'ignore' });
      child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`mutant exited ${code}`)));
    }));
    const readyPath = join(root, 'ready');
    const until = Date.now() + 5000;
    while ((!readFileSyncSafe(readyPath) || readFileSyncSafe(readyPath).length < 2) && Date.now() < until) await new Promise(r => setTimeout(r, 5));
    assert.equal(readFileSyncSafe(readyPath)?.length, 2, 'both mutant workers must observe the missing claim');
    writeFileSync(join(root, 'go'), 'go'); await Promise.all(workers);
    assert.equal(readFileSync(countFile, 'utf8').length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
function readFileSyncSafe(file) { try { return readFileSync(file, 'utf8'); } catch { return ''; } }

test('a claimed step without a result counts as one failure', () => {
  const dir = tempDir();
  try {
    assert.equal(claimStep(dir, 0, 'step-0'), true);
    assert.equal(claimStep(dir, 0, 'step-0'), false);
    for (let ordinal = 1; ordinal < 5; ordinal += 1) { const name = `step-${ordinal}`; claimStep(dir, ordinal, name); finishStep(dir, ordinal, name, 'pass'); }
    assert.deepEqual(summariseClaims(dir, 5), { pass: 4, fail: 1, errs: ['step-0 (unfinished claim)'] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
