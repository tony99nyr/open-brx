/** A31 — "the win is confirmed at MC", folded into `SetupSteps`'s "Match reminders" panel on the two
 *  screens the host is looking at before the horn (field feedback 2026-09-19: this used to be its own
 *  amber-bordered box, which read as a warning next to the YELLOW team's colour — see SetupSteps.tsx).
 *
 *  A game whose END STATE is MC's call (a frag cap, an objective `win_by`, a survival win) needs every
 *  player back in coverage after the whistle, or the result cannot be settled. The COMPILER writes the
 *  line once (`assign.game.mc_verify`) so MC and the phones cannot disagree about it, and it NAMES the
 *  phones with no backhaul — a count alone does not tell the host who to go and find.
 *
 *  `SetupSteps` renders nothing extra when `state.notices.mc_verify` is absent: under full coverage,
 *  when every phone has backhaul, and on a server that predates A31. This is built against
 *  `State.notices.mc_verify`; if `mc/API.md` names the field differently when the server lane lands,
 *  this is the one place to change.
 */

/** The server's raw line reads like `"WIN IS CONFIRMED AT MC · N PHONE(S) OFF-GRID (names) · TELL
 *  PLAYERS TO RETURN AFTER THE WHISTLE"` (or with the names trailing instead — both shapes are seen
 *  in the wild today, `state.py` vs the `?mock` mirror). Pull the count and the names out of whatever
 *  shape it is in and say it as one short, sentence-case, plain fact plus one short instruction —
 *  never inventing a count or a name that was not in the raw line. */
export function friendlyMcVerifyLine(raw: string): string {
  const count = raw.match(/(\d+)\s*PHONES?/i);
  const names = raw.match(/\(([^)]+)\)/);
  if (count && names) {
    const n = Number(count[1]);
    return `${n} phone${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} off-grid (${names[1]}). `
      + 'Wins are confirmed at MC, so tell players to come back after the whistle.';
  }
  // Fallback for an unrecognised shape: never invent facts, just stop shouting and drop the em dash.
  const flat = raw.replace(/\s*·\s*/g, '. ').replace(/\s*—\s*/g, '. ');
  return flat.charAt(0).toUpperCase() + flat.slice(1).toLowerCase();
}
