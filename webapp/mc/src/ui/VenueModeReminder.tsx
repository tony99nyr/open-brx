import { F, T } from '../tokens';
import { InfoIcon } from './index';

/** F162 superseded (bench, 2026-09-16): the old dismissable banner ("SET EACH GUN TO <VENUE> (HOLD
 *  ALT 3 S)") had to be dismissed on every screen, every session, Tony's word for it was
 *  "obnoxious". There is no popup any more, and no dismiss state to store: this is a quiet link that
 *  sits beside the venue setting on GAMES and opens the manual page explaining how to set the gun's
 *  own native ALT mode. `target="_blank"` on purpose: the operator keeps this console open and reads
 *  the manual on another tab or a phone, the way `SPECTATE` already does (see `screens/Live.tsx`).
 *
 *  The gun's ALT mode changes beam width and persists across power cycles; outdoor mode gave roughly
 *  twice the aim tolerance across three guns in the 2026-09-13 field measurement. It does not control
 *  range, and it is a different control from `$GSET` token 2 (a receiver setting MC pins to 0 at both
 *  venues, F197/F199), see `docs/manual/operate.md#indoor-vs-outdoor-mode` for the current, corrected
 *  how-to. The exact press count and whether the gun announces the new mode are not yet measured, so
 *  this component names none of that; the manual page is the single place that wording lives.
 */
export const MANUAL_ALT_MODE_URL = 'https://open-brx.iamrossi.workers.dev/manual/operate#indoor-vs-outdoor-mode';

export function VenueModeManualLink({ style }: { style?: React.CSSProperties }) {
  return (
    <a data-testid="venue-mode-manual-link" href={MANUAL_ALT_MODE_URL} target="_blank" rel="noopener"
      className="hov-acc"
      title="How to set the gun's own indoor/outdoor mode, opens the manual in a new tab"
      aria-label="How to set the gun's mode (opens in a new tab)"
      style={{ font: F.mono(600, 16), color: T.dim, textDecoration: 'none', lineHeight: 1,
               display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 44, ...style }}>
      {/* Bench 2026-09-17 (Tony): a small clickable icon, no label. The accessible name and the tooltip carry the words. */}
      <InfoIcon size={18} />
    </a>
  );
}
