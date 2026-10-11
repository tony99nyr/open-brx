// mc.md #8 (review 2026-10-10): MC prints an age as `_human_age` (state.py: 2M, 1H05M), and the console rebuilt the same
// "NOT REACHED FOR <AGE>" readiness line with its own finer `fmtAge` (2M10S), so the line changed wording with the
// tunnel state. `fmtServerAge` is MC's form, held to the shared case file brx5's Python runner also reads.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fmtServerAge } from '../src/tokens';
import { staleReachReason } from '../src/api/derive';

const FILE = join(__dirname, '..', '..', '..', 'app', 'test', 'fixtures', 'age-format-cases.json');
const CASES: { ms: number; shown: string }[] = JSON.parse(readFileSync(FILE, 'utf8')).cases;

describe('the one age wording MC prints (age-format-cases.json)', () => {
  it('has cases', () => { expect(CASES.length).toBeGreaterThan(5); });
  for (const c of CASES) {
    it(`${c.ms} ms reads ${c.shown}`, () => { expect(fmtServerAge(c.ms).toUpperCase()).toBe(c.shown); });
  }
  it('the console-built NOT REACHED line uses it', () => {
    expect(staleReachReason({ reach: undefined, last_reach: 'backhaul', last_seen_ms: 130_000 } as never))
      .toBe('NOT REACHED FOR 2M');
  });
});
