import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { BTN_RESET } from '../ui';
import { F, T } from '../tokens';

/** "SET EACH GUN TO <VENUE> (HOLD ALT 3 S)" — the ALT-hold backstop for beam width.
 *
 *  The gun has a native indoor/outdoor setting, toggled by holding ALT for 3 s, that changes beam
 *  width and **persists across power cycles**. Outdoor mode gave roughly twice the aim tolerance
 *  across three guns in the 2026-09-13 field measurement. It does not control range: the outdoor
 *  range failure came from `$GSET` token 2 crippling hit reception on the target, and MC pins that
 *  separate receiver setting to 0 at both venues (F197/F199).
 *
 *  It shows at BOTH venues because beam width is a venue choice and the setting sticks: a gun left
 *  on outdoor last night is still on outdoor in a gym tonight.
 *
 *  Placement follows `SetupSteps` (a physical field step has to be on screen where it is
 *  actionable): GAMES, where the venue is picked, and KIT, where the guns are handed out.
 *
 *  Dismissal is per SESSION, per VENUE **and per SCREEN** (polish loop, 2026-09-13 — both review
 *  lenses flagged the same two holes). Per session because an operator who has walked the rack
 *  should not be nagged for the rest of the night. Per venue because changing the venue is a new
 *  physical step on every gun. Per screen because GAMES is where the venue is PICKED and KIT is
 *  where the rack is actually walked: acknowledging the instruction while planning the game is not
 *  the same as having done it while handing the guns out, and the old single flag hid it on KIT the
 *  moment it was dismissed on GAMES.
 *
 *  And it is a SET, not the last value. Remembering only the last venue meant INDOOR → OUTDOOR →
 *  INDOOR raised it again for a venue the operator had already walked the rack for.
 */

type Env = 'indoor' | 'outdoor';
/** Which screen is asking. Absent = a caller with no screen of its own (a test mount): its own key. */
type Screen = string;

/** Module scope, not just `sessionStorage`: the dismissal has to survive GAMES unmounting on the way
 *  to KIT, and it has to work at all in a private window where storage throws. Storage is the
 *  MIRROR (it survives a reload of the console), this is the truth. */
let dismissed = new Set<string>();
const subs = new Set<(v: Set<string>) => void>();
const KEY = 'mc.venue-mode-dismissed';
const keyOf = (screen: Screen | undefined, env: Env) => `${screen ?? '-'}:${env}`;

function readStored(): Set<string> {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch { return new Set(); }     // private window / blocked storage / older shape: in-memory only
}
function publish(v: Set<string>) {
  dismissed = v;
  try {
    if (v.size) sessionStorage.setItem(KEY, JSON.stringify([...v]));
    else sessionStorage.removeItem(KEY);
  } catch { /* mirror only */ }
  subs.forEach(fn => fn(v));
}

/** Forget every dismissal. Used by the tests today; the hook a "NEW MATCH" reset would call if the
 *  reminder ever needs to re-arm for something other than a venue change. */
export function resetVenueModeDismissal() { publish(new Set()); }

export function VenueModeReminder({ style, screen }: { style?: React.CSSProperties; screen?: Screen }) {
  const { state } = useStore();
  const [off, setOff] = useState<Set<string>>(() => (dismissed.size ? dismissed : readStored()));
  useEffect(() => {
    if (dismissed.size === 0) { const s = readStored(); if (s.size) dismissed = s; }
    setOff(dismissed);
    subs.add(setOff);
    return () => { subs.delete(setOff); };
  }, []);

  const env = state?.config?.environment;
  // An older server has no `environment` on the config. Say nothing rather than name a venue nobody
  // picked — a wrong instruction about a persisted hardware setting is worse than no instruction.
  if (env !== 'indoor' && env !== 'outdoor') return null;
  if (off.has(keyOf(screen, env))) return null;

  const V = env.toUpperCase();
  return (
    <div role="status" data-testid="venue-mode-reminder"
      style={{ display: 'flex', alignItems: 'center', gap: 10, background: T.warn, color: T.accInk, padding: '4px 4px 4px 12px', ...style }}>
      <span style={{ font: F.chk(700, 12), letterSpacing: '.1em', lineHeight: 1.45, flex: 1 }}>
        ▲ SET EACH GUN TO {V} (HOLD ALT 3 S) — ALT SELECTS BEAM WIDTH, NOT RANGE. OUTDOOR GIVES
        ROUGHLY 2× THE AIM TOLERANCE. THE SETTING PERSISTS ACROSS POWER CYCLES
      </span>
      <button type="button" data-testid="venue-mode-dismiss"
        aria-label={`dismiss the ${env} mode reminder for this session`}
        title="Hide this until the venue changes"
        onClick={() => publish(new Set(dismissed).add(keyOf(screen, env)))}
        style={{ ...BTN_RESET, font: F.chk(700, 11), letterSpacing: '.14em', color: T.accInk,
                 border: `1px solid ${T.accInk}`, padding: '8px 12px', minHeight: 36, minWidth: 36, cursor: 'pointer', flex: 'none' }}>
        DISMISS
      </button>
    </div>
  );
}
