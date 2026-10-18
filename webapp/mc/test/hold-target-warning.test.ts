// F572 (Tony 2026-10-18, "It should add both hills"): the hold target counts the time summed across hills, so the
// mock's setup warning (rules/configcheck.ts, the port of state.py `_validate`) scales with the assigned hills.
import { describe, expect, it } from 'vitest';
import { holdTargetWarning } from '../src/rules/configcheck';
import type { ConfigView } from '../src/api/types';

const cfg = (hold: number) => ({ time_limit_s: 600, scoring: { frag_limit: null, win_by: 'objective', hold_target_s: hold } }) as unknown as ConfigView;

describe('holdTargetWarning', () => {
  it('one hill: a target at or past the time limit warns', () => {
    expect(holdTargetWarning(cfg(720))).toContain('IS AT OR PAST THE TIME LIMIT (10:00):');
    expect(holdTargetWarning(cfg(599))).toBeNull();
  });
  it('two hills: a 12:00 target in a 10:00 match can fire, so it does not warn; 20:00 does', () => {
    expect(holdTargetWarning(cfg(720), 2)).toBeNull();
    expect(holdTargetWarning(cfg(1200), 2)).toContain('IS AT OR PAST THE TIME LIMIT (10:00) TIMES 2 HILLS:');
  });
});
