// F411 (VQA round 1, 2026-09-26; F413/F415, games-presets.md §7): the per-mode MATCH SETTINGS item
// list is a pure function -- PLAY (screens/Games.tsx) renders from it directly. The server's own
// `match_items` on a `GET /api/modes` row is authoritative; the console's own DEFAULT_ITEMS is only
// the fallback for a server that predates the field.
import { describe, expect, it } from 'vitest';
import { matchItems } from '../src/screens/matchItems';

describe('matchItems', () => {
  it('reads the mode row’s own match_items when present, KILLS filter still applied', () => {
    expect(matchItems({ match_items: ['time', 'kills', 'countdown', 'daynight', 'silenced', 'teams'] }, 'kills'))
      .toEqual(['time', 'kills', 'countdown', 'daynight', 'silenced', 'teams']);
    expect(matchItems({ match_items: ['time', 'hold', 'countdown', 'daynight', 'silenced', 'teams'] }, 'objective'))
      .toEqual(['time', 'hold', 'countdown', 'daynight', 'silenced', 'teams']);
  });

  it('the KILLS filter still applies even off a server-provided list (belt and braces)', () => {
    expect(matchItems({ match_items: ['time', 'kills', 'countdown'] }, 'objective')).toEqual(['time', 'countdown']);
  });

  it('falls back to the default order, with KILLS, when match_items is absent (an older server)', () => {
    expect(matchItems(undefined, 'kills')).toEqual(['time', 'kills', 'countdown', 'daynight', 'silenced']);
    expect(matchItems({}, 'kills')).toEqual(['time', 'kills', 'countdown', 'daynight', 'silenced']);
  });

  it('the fallback drops KILLS for a mode not scored by kills (KOTH: objective)', () => {
    expect(matchItems(undefined, 'objective')).toEqual(['time', 'countdown', 'daynight', 'silenced']);
  });

  it('the fallback drops KILLS for survival scoring too (post-MVP infection)', () => {
    expect(matchItems(undefined, 'survival')).toEqual(['time', 'countdown', 'daynight', 'silenced']);
  });
});
