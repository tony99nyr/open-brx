// F411 (VQA round 1, 2026-09-26): the per-mode MATCH SETTINGS item list is a pure function --
// PLAY (screens/Games.tsx) renders from it directly.
import { describe, expect, it } from 'vitest';
import { matchItems } from '../src/screens/matchItems';

describe('matchItems', () => {
  it('the default order, with KILLS, for a kills-scored mode (TDM/FFA)', () => {
    expect(matchItems('tdm', 'kills')).toEqual(['time', 'kills', 'countdown', 'daynight', 'silenced']);
    expect(matchItems('ffa', 'kills')).toEqual(['time', 'kills', 'countdown', 'daynight', 'silenced']);
  });

  it('drops KILLS for a mode not scored by kills (KOTH: objective)', () => {
    expect(matchItems('koth', 'objective')).toEqual(['time', 'countdown', 'daynight', 'silenced']);
  });

  it('drops KILLS for survival scoring too (post-MVP infection)', () => {
    expect(matchItems('infection', 'survival')).toEqual(['time', 'countdown', 'daynight', 'silenced']);
  });

  it('an unknown mode still gets the default list (never throws, never an empty strip)', () => {
    expect(matchItems('some_future_mode', 'kills')).toEqual(['time', 'kills', 'countdown', 'daynight', 'silenced']);
  });
});
