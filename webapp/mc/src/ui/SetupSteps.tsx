import { useStore } from '../store';
import { F, T } from '../tokens';

/** The `SETUP: ` warnings — PHYSICAL steps on the field the operator must do before the push.
 *
 *  The server raises these in `validate()` (mc/API.md): power-cycle the grenade so the hill starts
 *  NEUTRAL, set it to hill mode, place it. They shipped rendered on GAMES only, which is the screen
 *  where you PICK the mode — so the operator read the step, walked out to place the grenade from
 *  LOBBY or ARMED, and there it was gone (operator review 2026-09-10). A step has to be on screen at
 *  the moment it is actionable, so this renders on the pre-match screens too.
 *
 *  Deliberately narrow: only `SETUP: `. The other `config_warnings` are technical advisories (a $SIR
 *  cell, a frag limit without coverage) and putting those on the last screen before the horn would
 *  train the operator to ignore the strip.
 */
export function SetupSteps({ style }: { style?: React.CSSProperties }) {
  const { state } = useStore();
  const steps = (state?.config_warnings ?? []).filter(w => /^SETUP:/i.test(w));
  if (steps.length === 0) return null;
  return (
    <div role="status" data-testid="setup-steps" style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      {steps.map((w, i) => (
        <div key={i} style={{ font: F.chk(700, 12), letterSpacing: '.1em', lineHeight: 1.45,
                              color: T.accInk, background: T.warn, padding: '7px 12px' }}>
          ▲ {w.replace(/^SETUP:\s*/i, '').toUpperCase()}
        </div>
      ))}
    </div>
  );
}
