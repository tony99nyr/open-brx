// Polish round 1 Low: SAVE AS A FAVOURITE snaps the runway to the nearest RUNWAYS value before it is
// stored, so a favourite saved off a drifted runway (LAST MATCH or another favourite's own countdown_s,
// neither of which is validated against RUNWAYS) never carries a value the COUNTDOWN control could not
// itself have picked.
import { describe, expect, it } from 'vitest';
import { nearestRunway, RUNWAYS } from '../src/runway';

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
