// The phone clock against the cases it shares with the stand-in phone (T4, review 2026-10-10).
// app/test/fixtures/clock-cases.json is GENERATED from clock.js by fixtures/gen-clock-cases.mjs; freshness is
// mcp/tests/test_generated_fresh.py's job (scripts/generated.json); mcp/tests/test_clock_cases.py holds
// mock_node.py MockNode to the same file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClock } from './fixtures/gen-clock-cases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'clock-cases.json'), 'utf8'));

test('clock.js gives every clock case the offset, verdict and synced the file records', () => {
  assert.ok(FIXTURE.cases.length >= 10);
  for (const c of FIXTURE.cases) {
    const inputs = c.steps.map(({ offset, accepted, synced, ...s }) => s);
    assert.deepEqual(runClock(inputs), c.steps, c.name);
  }
});
