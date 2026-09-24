import type { EndDeliveryView } from '../api/types';

/** M1: RECAP's one statement about the END, for a view with at least one unconfirmed HUD. Three facts,
 *  each from `state.py _end_delivery_view`, never a guess:
 *   - who has not CONFIRMED (a confirmation is the HUD reporting the match over, not a socket write);
 *   - how many of those phones the END REACHED (`reached`: the link took the last push), which is the
 *     number the command bar's "REACHED N OF N NODES" counts, so the two can sit on one screen;
 *   - whether MC is still re-delivering. "NEVER" is said only once `retrying` is false (the ladder is
 *     spent): five seconds after the whistle it is simply not true yet.
 *
 *  One noun, NODE, for the thing the END is delivered to (polish 2026-09-23). The banner used to say HUDS
 *  and PHONES beside the command bar's NODES, three words for one thing on one screen. */
export function recapDeliveryText(ed: EndDeliveryView): string | null {
  const left = ed.unconfirmed;
  const n = left.length;
  if (!n) return null;
  const who = left.map(u => u.display).join(', ');
  const nodes = `${n} OF ${ed.total} NODE${ed.total === 1 ? '' : 'S'}`;
  const tries = Math.max(0, ...left.map(u => u.tries));
  const reached = left.filter(u => u.reached).length;
  const reach = n === 1
    ? (reached ? 'THE END REACHED THAT NODE' : 'THE END HAS NOT REACHED THAT NODE')
    : `THE END REACHED ${reached} OF THOSE ${n} NODES`;
  const fact = 'THIS IS A DELIVERY FACT: IT SAYS NOTHING ABOUT HOW THEY PLAYED.';
  if (ed.retrying) {
    return `${nodes} ${n === 1 ? 'HAS' : 'HAVE'} NOT CONFIRMED THE END YET (${who}). MC IS STILL RE-DELIVERING IT `
      + `(${tries} ${tries === 1 ? 'DELIVERY' : 'DELIVERIES'} SO FAR). ${reach}, AND REACHING A NODE IS NOT A CONFIRMATION. ${fact}`;
  }
  return `${nodes} NEVER CONFIRMED THE END (${who}). MC TOLD ${n === 1 ? 'IT' : 'THEM'} ${tries} TIME${tries === 1 ? '' : 'S'} AND HAS STOPPED. `
    + `${reach}, AND REACHING A NODE IS NOT A CONFIRMATION. ${fact} THAT TAGGER MAY HAVE PLAYED ON AFTER THE WHISTLE: CHECK IT ON THE GUN.`;
}

/** The clean-end line in RECAP's own noun, NODES, which `endDeliveryLine` (LIVE) now uses too (F318). */
export function recapDeliveryOkText(ed: Pick<EndDeliveryView, 'total'>): string {
  return `ALL ${ed.total} NODE${ed.total === 1 ? '' : 'S'} CONFIRMED THE END`;
}
