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
 *
 *  Field feedback 2026-09-19 (Tony): this used to render as a solid amber bar. Amber is also the
 *  YELLOW team's colour, so a yellow team name reads as a warning on the same screen. These are field
 *  steps, not faults, so the panel is now a neutral "Match reminders" list: no amber, no red, normal
 *  weight, one plain line per step. Team colours stay off this panel, and off any other status panel.
 */
export function SetupSteps({ style }: { style?: React.CSSProperties }) {
  const { state } = useStore();
  const steps = (state?.config_warnings ?? []).filter(w => /^SETUP:/i.test(w));
  if (steps.length === 0) return null;
  return (
    <div role="status" data-testid="setup-steps" style={{ display: 'flex', flexDirection: 'column', gap: 6,
                                                            background: T.panelSoft, border: `1px solid ${T.line}`, padding: '10px 14px', ...style }}>
      <span style={{ font: F.chk(600, 11), letterSpacing: '.16em', textTransform: 'uppercase', color: T.dim }}>Match reminders</span>
      {steps.map((w, i) => (
        <div key={i} style={{ font: F.chk(500, 12), letterSpacing: '.02em', lineHeight: 1.5, color: T.body }}>
          {w.replace(/^SETUP:\s*/i, '')}
        </div>
      ))}
    </div>
  );
}
