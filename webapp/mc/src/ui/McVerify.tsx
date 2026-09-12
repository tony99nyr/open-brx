import { useStore } from '../store';
import { F, T } from '../tokens';

/** A31 — "the win is confirmed at MC", on the two screens the host is looking at before the horn.
 *
 *  A game whose END STATE is MC's call (a frag cap, an objective `win_by`, a survival win) needs every
 *  player back in coverage after the whistle, or the result cannot be settled. The COMPILER writes the
 *  line once (`assign.game.mc_verify`) so MC and the phones cannot disagree about it, and it NAMES the
 *  phones with no backhaul — a count alone does not tell the host who to go and find.
 *
 *  Absent under full coverage, absent when every phone has backhaul, and absent on a server that
 *  predates A31. It renders nothing at all in those cases rather than a reassuring line nobody asked
 *  for. This is built against `State.notices.mc_verify`; if `mc/API.md` names the field differently
 *  when the server lane lands, this is the one place to change.
 *
 *  A border, not a fill: `SetupSteps` owns the solid amber bar, and it means something different —
 *  a PHYSICAL step the operator must go and do. Two solid amber bars would flatten both.
 */
export function McVerify({ style }: { style?: React.CSSProperties }) {
  const { state } = useStore();
  const line = state?.notices?.mc_verify;
  if (!line) return null;
  return (
    <div role="status" data-testid="mc-verify"
      style={{ border: `1px solid ${T.warn}`, borderLeft: `3px solid ${T.warn}`, background: 'rgba(255,176,32,.06)',
               padding: '9px 14px', font: F.chk(700, 12), letterSpacing: '.08em', lineHeight: 1.5, color: T.warn, ...style }}>
      ▲ {line}
    </div>
  );
}
