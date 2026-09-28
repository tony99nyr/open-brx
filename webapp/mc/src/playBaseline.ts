// Bench 2026-09-28 (Tony): loading a FAVOURITE over picks the operator has changed since the last load or
// save asks "DISCARD YOUR CHANGES?" first; over pristine picks it loads at once. The baseline is the
// pick + countdown as of the last favourite load or save, or the first pick this console saw. Module
// scope, like runway.ts, so a tab switch (a remount of PLAY) does not forget it.
import type { GamePick } from './api/types';

let baseline: string | null = null;

/** A stable key for a pick: sorted keys, and a null or absent field reads the same. */
function keyOf(pick: GamePick, countdown: number): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v as object).sort()
        .filter(k => (v as Record<string, unknown>)[k] != null)
        .map(k => [k, norm((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(norm({ pieces: pick.pieces, match: pick.match, countdown }));
}

/** The picks as they stand now are the clean state (a load or a save just made them so). */
export function markPristine(pick: GamePick, countdown: number) { baseline = keyOf(pick, countdown); }

/** First sight of a pick in this console: that is the baseline. */
export function seedBaseline(pick: GamePick, countdown: number) { if (baseline === null) markPristine(pick, countdown); }

export function picksDirty(pick: GamePick, countdown: number): boolean {
  return baseline !== null && keyOf(pick, countdown) !== baseline;
}

/** Tests only: forget the baseline between cases. */
export function resetBaseline() { baseline = null; }
