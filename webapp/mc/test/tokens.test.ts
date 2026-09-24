// Review finding (2026-09-13): `fmtDuration` had no floor, so a negative span (a clock drift, a
// stale `of_s` minus `observed_s`) printed "-1:-5" — `Math.floor`/the `%` operator both keep the
// sign of a negative dividend in JS, and neither half is a number an operator can read. `fmtClock`
// already clamps at zero for the same reason; `fmtDuration` now does too.
import { describe, expect, it } from 'vitest';
import { CLASS_TAG, CLS_COLOR, PERK_COLOR, ROLE, T, TEAM, fmtDuration } from '../src/tokens';

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
  // Fix-1 (polish 2026-09-23): M14 first fixed only the DESIGNER chips, and KIT, GAMES and the
  // CATALOGUE still read `ROLE`, the team palette. `ROLE` and `CLS_COLOR` now read CLASS_TAG, so they
  // are held to the same rule.
  it('every ROLE and CLS_COLOR colour is muted and far from the loud set too', () => {
    const all = { ...Object.fromEntries(Object.entries(ROLE).map(([k, r]) => [`ROLE.${k}`, r.color])),
                  ...Object.fromEntries(Object.entries(CLS_COLOR).map(([k, c]) => [`CLS.${k}`, c])) };
    for (const [k, c] of Object.entries(all)) {
      expect(sat(c), `${k} ${c} is muted`).toBeLessThan(0.35);
      for (const l of loud) expect(dist(c, l), `${k} ${c} vs ${l}`).toBeGreaterThan(90);
    }
  });
});


// The site build parses ROLE's literal colours (site/lib/facts.mjs), so ROLE cannot reference
// CLASS_TAG by name; this pins the two together instead (MC visual QA M14, polish round 2).
import { describe as describeRole, expect as expectRole, it as itRole } from 'vitest';
import { CLASS_TAG as CT, ROLE as RL } from '../src/tokens';
describeRole('ROLE colours are the CLASS_TAG colours', () => {
  itRole('one class, one colour', () => {
    expectRole(RL.assault.color).toBe(CT.assault);
    expectRole(RL.cqb.color).toBe(CT.cqb);
    expectRole(RL.marksman.color).toBe(CT.sniper);
    expectRole(RL.support.color).toBe(CT.support);
    expectRole(RL.power.color).toBe(CT.heavy);
    expectRole(RL.sidearm.color).toBe(CT.sidearm);
    expectRole(RL.melee.color).toBe('#8aa0b4');   // T.dim, as a literal for the site parser
  });
});
