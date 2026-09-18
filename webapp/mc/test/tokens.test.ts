// Review finding (2026-09-13): `fmtDuration` had no floor, so a negative span (a clock drift, a
// stale `of_s` minus `observed_s`) printed "-1:-5" — `Math.floor`/the `%` operator both keep the
// sign of a negative dividend in JS, and neither half is a number an operator can read. `fmtClock`
// already clamps at zero for the same reason; `fmtDuration` now does too.
import { describe, expect, it } from 'vitest';
import { fmtDuration } from '../src/tokens';

describe('fmtDuration clamps at zero', () => {
  it('never prints a negative span', () => {
    expect(fmtDuration(-65)).toBe('0:00');
  });

  it('still reads an ordinary span correctly', () => {
    expect(fmtDuration(65)).toBe('1:05');
  });
});
