// Review finding (2026-09-13): `fmtDuration` had no floor, so a negative span (a clock drift, a
// stale `of_s` minus `observed_s`) printed "-1:-5" — `Math.floor`/the `%` operator both keep the
// sign of a negative dividend in JS, and neither half is a number an operator can read. `fmtClock`
// already clamps at zero for the same reason; `fmtDuration` now does too.
import { describe, expect, it } from 'vitest';
import { CLASS_TAG, PERK_COLOR, ROLE, T, TEAM, fmtDuration } from '../src/tokens';

describe('fmtDuration clamps at zero', () => {
  it('never prints a negative span', () => {
    expect(fmtDuration(-65)).toBe('0:00');
  });

  it('still reads an ordinary span correctly', () => {
    expect(fmtDuration(65)).toBe('1:05');
  });
});

// M14 (visual QA 2026-09-23): the weapon class tags reused the team and alarm colours. The class set
// must stay muted and read as different from every team colour and every alarm colour.
describe('CLASS_TAG is its own muted palette', () => {
  const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const sat = (h: string) => { const c = rgb(h); const mx = Math.max(...c), mn = Math.min(...c); return mx === 0 ? 0 : (mx - mn) / mx; };
  const dist = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
  const loud = [...Object.values(TEAM), T.ok, T.warn, T.bad, T.acc, PERK_COLOR];
  it('is low in saturation and far from every team, alarm and accent colour', () => {
    for (const [k, c] of Object.entries(CLASS_TAG)) {
      expect(sat(c), `${k} ${c} is muted`).toBeLessThan(0.35);
      for (const l of loud) expect(dist(c, l), `${k} ${c} vs ${l}`).toBeGreaterThan(90);
    }
  });
  it('no class tint is a ROLE colour any more', () => {
    const role = Object.values(ROLE).map(r => r.color.toLowerCase());
    for (const c of Object.values(CLASS_TAG)) expect(role).not.toContain(c.toLowerCase());
  });
});
