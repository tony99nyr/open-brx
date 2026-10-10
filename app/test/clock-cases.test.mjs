// The phone clock against the cases it shares with the stand-in phone (T4, review 2026-10-10).
// app/test/fixtures/clock-cases.json is GENERATED from clock.js by fixtures/gen-clock-cases.mjs, so this fails
// when clock.js changes until the cases are regenerated on purpose; mcp/tests/test_clock_cases.py holds
// mock_node.py MockNode to the same file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, runClock, buildDoc } from './fixtures/gen-clock-cases.mjs';
import { CLOCK_STEP_MS } from '../src/transport/contract.gen.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'clock-cases.json'), 'utf8'));

test('clock.js gives every clock case the offset and verdict the file records', () => {
  assert.ok(FIXTURE.cases.length >= 10);
  for (const c of FIXTURE.cases) {
    const inputs = c.steps.map(({ offset, accepted, synced, ...s }) => s);
    assert.deepEqual(runClock(inputs), c.steps, c.name);
  }
});

test('the file is the generator output, inputs and all: regenerate it, never edit it by hand', () => {
  assert.equal(FIXTURE.clock_step_ms, CLOCK_STEP_MS);
  assert.deepEqual(FIXTURE, buildDoc(), 'the whole document, _comment included');
});
