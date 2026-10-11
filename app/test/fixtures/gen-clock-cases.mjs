// Writes clock-cases.json by RUNNING app/src/transport/clock.js over the scenarios below (T4, review 2026-10-10).
// The phone is the truth: app/test/clock-cases.test.mjs fails when clock.js changes until this is re-run on
// purpose, and mcp/tests/test_clock_cases.py holds the stand-in phone (mock_node.py MockNode) to the same file.
// Run: node app/test/fixtures/gen-clock-cases.mjs
// A scenario added here must also pass `cd mcp && python3 run_tests.py test_clock_cases` (the stand-in phone):
// if it fails there, the mock has drifted from clock.js, so fix mock_node.py (brx3's lane), not the case.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Clock } from '../../src/transport/clock.js';
import { CLOCK_STEP_MS } from '../../src/transport/contract.gen.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T = 1_700_000_000_000;   // a wall-clock base; MC's clock runs `skew` ms ahead of the phone's
/** A round trip sent at `at` that takes `rtt` ms, answered by an MC whose clock is `skew` ahead. */
const rt = (at, rtt, skew, half = rtt / 2) => ({ op: 'sample', t_node: T + at, server_t: T + at + half + skew, now: T + at + rtt });
const burst = (from, rtts, skew) => rtts.map((r, i) => rt(from + i * 1000, r, skew));
/** A burst whose skew climbs by `step` per sample, so a replaced offset and an EWMA one differ at every sample. */
const ramp = (from, rtts, skew, step) => rtts.map((r, i) => rt(from + i * 1000, r, skew + i * step));

export const SCENARIOS = [
  { name: 'the first burst keeps the smallest-rtt sample and replaces the offset',
    steps: [...ramp(0, [80, 40, 120, 60, 30], 500, 10), rt(6000, 20, 600)] },
  { name: 'after the burst every sample moves the offset by the alpha 0.2 EWMA',
    steps: [...burst(0, [40, 40, 40, 40, 40], 500), rt(6000, 40, 600), rt(7000, 40, 600), rt(8000, 40, 400)] },
  { name: 'a one-way delay skews the offset by half the asymmetry',
    steps: [rt(0, 100, 0, 80), rt(1000, 100, 0, 20)] },
  { name: 'an rtt over 3x the running median is rejected and keeps the offset',
    steps: [...burst(0, [40, 50, 60, 40, 50], 500), rt(6000, 400, 9000), rt(7000, 150, 9000)] },
  { name: 'the median of an even count averages the middle two',
    steps: [...burst(0, [10, 20, 30, 40], 0), rt(5000, 76, 5000), rt(6000, 74, 5000)] },
  { name: 'no outlier check until three rtts are held',
    steps: [rt(0, 10, 0), rt(1000, 10, 0), rt(2000, 900, 300)] },
  { name: 'a rejected first reply is not synced, and the welcome seed alone is not either',
    steps: [{ op: 'seed', server_t: T + 700, now: T }, { op: 'sample', t_node: T + 5000, server_t: T + 5000, now: T + 4000 }, rt(6000, 40, 500)] },
  { name: 'a reconnect or a forced re-sync before any sample is not synced',
    steps: [{ op: 'seed', server_t: T + 700, now: T }, { op: 'new_burst' }, { op: 'restart' }, rt(1000, 40, 500)] },
  { name: 'a negative rtt is rejected',
    steps: [rt(0, 40, 500), { op: 'sample', t_node: T + 5000, server_t: T + 5000, now: T + 4000 }] },
  { name: 'the welcome seed sets the offset only before any round trip',
    steps: [{ op: 'seed', server_t: T + 700, now: T }, rt(1000, 40, 500), { op: 'seed', server_t: T + 9000, now: T + 2000 }] },
  { name: 'a reconnect on a synced clock with no step stays on the EWMA',
    steps: [...burst(0, [40, 40, 40, 40, 40], 500), { op: 'new_burst' }, ...ramp(10_000, [40, 30, 50, 45, 60], 520, 10)] },
  { name: `a reconnect after a wall-clock step over CLOCK_STEP_MS (${CLOCK_STEP_MS} ms) snaps to the best sample`,
    steps: [...burst(0, [40, 40, 40, 40, 40], 500), { op: 'new_burst' }, ...ramp(10_000, [60, 30, 50, 40, 45], 500 + CLOCK_STEP_MS + 2000, 50)] },
  { name: 'a reconnect after a backward step over CLOCK_STEP_MS snaps too',
    steps: [...burst(0, [40, 40, 40, 40, 40], 500), { op: 'new_burst' }, ...ramp(10_000, [60, 45, 30, 40, 50], 500 - CLOCK_STEP_MS - 2000, -50)] },
  { name: 'a reconnect step just under CLOCK_STEP_MS does not snap',
    steps: [...burst(0, [40, 40, 40, 40, 40], 500), { op: 'new_burst' }, ...burst(10_000, [40, 40, 40, 40, 40], 500 + CLOCK_STEP_MS - 1)] },
  { name: 'a reconnect on a part-synced clock replaces the offset for the samples still owed',
    steps: [...burst(0, [40, 40, 40], 500), { op: 'new_burst' }, ...burst(10_000, [60, 30], 3000), rt(12_000, 50, 4000), rt(13_000, 50, 4000)] },
  { name: 'a forced re-sync replaces the offset for the next five samples, then the EWMA resumes',
    steps: [...burst(0, [40, 40, 40, 40, 40], 500), { op: 'restart' }, ...ramp(10_000, [50, 45, 40, 35, 30], 8000, 100), rt(16_000, 40, 8100)] },
  { name: 'a rejected sample during a forced re-sync does not count toward it',
    steps: [...burst(0, [40, 40, 40, 40, 40], 500), { op: 'restart' }, rt(10_000, 400, 8000), ...ramp(11_000, [50, 45, 40, 35, 30], 8000, 100)] },
  { name: 'the outlier median forgets an rtt 33 samples old (a 40 ms probe is rejected)',
    steps: [...burst(0, Array(20).fill(100), 0), ...burst(20_000, Array(20).fill(10), 0), rt(40_000, 40, 0)] },
  { name: 'the outlier median keeps exactly 32 rtts (a 200 ms probe after 20 + 16 is rejected)',
    steps: [...burst(0, Array(20).fill(100), 0), ...burst(20_000, Array(16).fill(10), 0), rt(36_000, 200, 0)] },
  { name: 'the outlier median keeps exactly 32 rtts (a 40 ms probe after 20 + 16 is accepted)',
    steps: [...burst(0, Array(20).fill(100), 0), ...burst(20_000, Array(16).fill(10), 0), rt(36_000, 40, 0)] },
  { name: 'the outlier check starts at exactly three held rtts',
    steps: [rt(0, 10, 0), rt(1000, 10, 0), rt(2000, 10, 0), rt(3000, 900, 300)] },
  { name: 'a burst tie on rtt keeps the first sample',
    steps: [rt(0, 40, 500), rt(1000, 40, 900)] },
  { name: 'a reconnect tie on rtt keeps the first sample for the snap',
    steps: [...burst(0, [40, 40, 40, 40, 40], 500), { op: 'new_burst' }, rt(10_000, 30, 4000 + CLOCK_STEP_MS), rt(11_000, 30, 9000 + CLOCK_STEP_MS), ...burst(12_000, [50, 50, 50], 600)] },
  { name: 'a reconnect step of exactly CLOCK_STEP_MS does not snap',
    steps: [...burst(0, [40, 40, 40, 40, 40], 500), { op: 'new_burst' }, ...burst(10_000, [40, 40, 40, 40, 40], 500 + CLOCK_STEP_MS)] },
];

/** Run one scenario through clock.js; each step records what clock.js did. */
export function runClock(steps) {
  const c = new Clock({ now: () => T });
  return steps.map(s => {
    // `synced` is clock.js synced()'s first half, a real round trip (sampleCount > 0); MockNode has no freshness clock
    const has = () => c.sampleCount > 0;
    if (s.op === 'seed') { c.seed(s.server_t, s.now); return { ...s, offset: c.offset, synced: has() }; }
    if (s.op === 'new_burst') { c.newBurst(); return { ...s, offset: c.offset, synced: has() }; }
    if (s.op === 'restart') { c.restart(); return { ...s, offset: c.offset, synced: has() }; }
    const got = c.sample(s.t_node, s.server_t, s.now);
    return { ...s, accepted: got !== null, offset: c.offset, synced: has() };
  });
}

/** The whole file, as written. The test compares the file on disk with this, `_comment` included. */
export function buildDoc() {
  return {
    _comment: 'T4 (review 2026-10-10): the phone clock (app/src/transport/clock.js) as step sequences, GENERATED by gen-clock-cases.mjs from clock.js itself; never edit by hand. A step is seed {server_t, now}, sample {t_node, server_t, now} (one time_req/time_res round trip), new_burst (a reconnect) or restart (control{clock_resync}). Every step records the offset after it and `synced`, whether an accepted round-trip sample has been taken (the first half of clock.js synced(): a rejected reply is not one; a welcome seed alone is not synced; it is "has a real sample", NOT the full synced(), which also needs freshness (SYNC_FRESH_MS); the freshness of the mock is not pinned, since MockNode has no clock for it); a sample also records whether it was accepted. The clock starts with no samples and offset 0, burst 5, alpha 0.2. Read by app/test/clock-cases.test.mjs (clock.js) and mcp/tests/test_clock_cases.py (the stand-in phone, mock_node.py MockNode).',
    clock_step_ms: CLOCK_STEP_MS,
    cases: SCENARIOS.map(s => ({ name: s.name, steps: runClock(s.steps) })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const doc = buildDoc();
  const out = path.join(HERE, 'clock-cases.json'), text = JSON.stringify(doc, null, 2) + '\n';
  if (process.argv.includes('--check')) {   // the registry's staleness check: write nothing, exit 1 when the file is stale
    if (readFileSync(out, 'utf8') !== text) { console.error('stale: app/test/fixtures/clock-cases.json; run node app/test/fixtures/gen-clock-cases.mjs'); process.exit(1); }
    process.exit(0);
  }
  writeFileSync(out, text);
  for (const c of doc.cases) console.log(c.name, '->', c.steps.map(s => s.op === 'sample' ? `${s.accepted ? '' : 'X'}${s.offset}` : `${s.op}:${s.offset}`).join(' '));
}
