// Polish round 1 Low: a favourite's countdown_s snapped to the nearest RUNWAYS value only at SAVE time,
// so the on-screen COUNTDOWN control (and its +/- stepper, which reads `RUNWAYS.indexOf(seconds)` --
// -1, stuck at index 0, for a non-member) could show and step from a DRIFTED value (LAST MATCH or a
// favourite's own countdown_s, neither validated against RUNWAYS) right up until the moment of saving.
// Round 2: `setRunway` itself snaps, so the screen and a saved favourite always already agree.
import { describe, expect, it } from 'vitest';
import { getRunway, nearestRunway, RUNWAYS, setRunway } from '../src/runway';

describe('nearestRunway', () => {
  it('leaves an exact RUNWAYS value alone', () => {
    for (const v of RUNWAYS) expect(nearestRunway(v)).toBe(v);
  });

  it('snaps to the closer neighbour', () => {
    expect(nearestRunway(12)).toBe(10);   // between 10 and 15, closer to 10
    expect(nearestRunway(40)).toBe(45);   // between 30 and 45, closer to 45
  });

  it('clamps outside the range to the nearest end', () => {
    expect(nearestRunway(5)).toBe(10);
    expect(nearestRunway(900)).toBe(180);
  });
});

describe('setRunway snaps immediately (round 2)', () => {
  it('a drifted value reads back snapped, not raw', () => {
    const restore = getRunway();
    try {
      setRunway(40);
      expect(getRunway()).toBe(45);
    } finally { setRunway(restore); }
  });
});
