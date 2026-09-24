import type { EndDeliveryView } from '../api/types';

/** M1: RECAP's one statement about the END, for a view with at least one unconfirmed HUD. Three facts,
 *  each from `state.py _end_delivery_view`, never a guess:
 *   - who has not CONFIRMED (a confirmation is the HUD reporting the match over, not a socket write);
 *   - how many of those phones the END REACHED (`reached`: the link took the last push), which is the
 *     number the command bar's "REACHED N OF N NODES" counts, so the two can sit on one screen;
 *   - whether MC is still re-delivering. "NEVER" is said only once `retrying` is false (the ladder is
 *     spent): five seconds after the whistle it is simply not true yet. */
export function recapDeliveryText(ed: EndDeliveryView): string | null {
  const left = ed.unconfirmed;
  const n = left.length;
  if (!n) return null;
  const who = left.map(u => u.display).join(', ');
  const huds = `${n} OF ${ed.total} HUD${ed.total === 1 ? '' : 'S'}`;
  const tries = Math.max(0, ...left.map(u => u.tries));
  const reached = left.filter(u => u.reached).length;
  const reach = n === 1
    ? (reached ? 'THE END REACHED THAT PHONE' : 'THE END HAS NOT REACHED THAT PHONE')
    : `THE END REACHED ${reached} OF THOSE ${n} PHONES`;
  const fact = 'THIS IS A DELIVERY FACT: IT SAYS NOTHING ABOUT HOW THEY PLAYED.';
  if (ed.retrying) {
    return `${huds} ${n === 1 ? 'HAS' : 'HAVE'} NOT CONFIRMED THE END YET (${who}). MC IS STILL RE-DELIVERING IT `
      + `(${tries} ${tries === 1 ? 'DELIVERY' : 'DELIVERIES'} SO FAR). ${reach}, AND REACHING A PHONE IS NOT A CONFIRMATION. ${fact}`;
  }
  return `${huds} NEVER CONFIRMED THE END (${who}). MC TOLD ${n === 1 ? 'IT' : 'THEM'} ${tries} TIME${tries === 1 ? '' : 'S'} AND HAS STOPPED. `
    + `${reach}, AND REACHING A PHONE IS NOT A CONFIRMATION. ${fact} THAT TAGGER MAY HAVE PLAYED ON AFTER THE WHISTLE: CHECK IT ON THE GUN.`;
}
