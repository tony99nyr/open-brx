import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { BTN_RESET } from '../ui';
import { F, T } from '../tokens';

/** "SET EACH GUN TO <VENUE> (HOLD ALT 3 S)" — the ALT-hold backstop for the venue's IR range.
 *
 *  The gun has a native indoor/outdoor setting, toggled by holding ALT for 3 s, that changes IR
 *  range and hit-LED brightness — and it **persists across power cycles**
 *  (`docs/manual/operate.md`). MC cannot drive it: `$GSET` t2 carries the APK's name for it but has
 *  never been flipped on a bench, and neither has any other candidate (`mc/compile.py`
 *  `DRIVE_IO_MODE`, FOLLOWUPS **F162**). So today the only thing that puts a rack of guns into the
 *  venue the operator just picked is a person walking it — and on 2026-09-12 nobody did: the field
 *  session played outdoors at ~7-32% hit rate against ~41% indoors and could not register a hit at
 *  30-40 ft.
 *
 *  It shows at BOTH venues, because the setting sticking is the whole problem: a gun left on outdoor
 *  last night is still on outdoor in a gym tonight, where outdoor IR bounces off everything.
 *
 *  Placement follows `SetupSteps` (a physical field step has to be on screen where it is
 *  actionable): GAMES, where the venue is picked, and KIT, where the guns are handed out.
 *
 *  Dismissal is per SESSION and per VENUE. Per session because an operator who has walked the rack
 *  should not be nagged for the rest of the night; per venue because changing the venue is a new
 *  physical step on every gun, so the reminder comes back.
 */

type Env = 'indoor' | 'outdoor';

/** Module scope, not just `sessionStorage`: the dismissal has to survive GAMES unmounting on the way
 *  to KIT, and it has to work at all in a private window where storage throws. Storage is the
 *  MIRROR (it survives a reload of the console), this is the truth. */
let dismissed: Env | null = null;
const subs = new Set<(v: Env | null) => void>();
const KEY = 'mc.venue-mode-dismissed';

function readStored(): Env | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v === 'indoor' || v === 'outdoor' ? v : null;
  } catch { return null; }          // private window / blocked storage: in-memory only, still works
}
function publish(v: Env | null) {
  dismissed = v;
  try { if (v) sessionStorage.setItem(KEY, v); else sessionStorage.removeItem(KEY); } catch { /* mirror only */ }
  subs.forEach(fn => fn(v));
}

/** Forget the dismissal. Used by the tests today; the hook a "NEW MATCH" reset would call if the
 *  reminder ever needs to re-arm for something other than a venue change. */
export function resetVenueModeDismissal() { publish(null); }

export function VenueModeReminder({ style }: { style?: React.CSSProperties }) {
  const { state } = useStore();
  const [off, setOff] = useState<Env | null>(() => dismissed ?? readStored());
  useEffect(() => {
    if (dismissed === null) { const s = readStored(); if (s) dismissed = s; }
    setOff(dismissed);
    subs.add(setOff);
    return () => { subs.delete(setOff); };
  }, []);

  const env = state?.config?.environment;
  // An older server has no `environment` on the config. Say nothing rather than name a venue nobody
  // picked — a wrong instruction about a persisted hardware setting is worse than no instruction.
  if (env !== 'indoor' && env !== 'outdoor') return null;
  if (off === env) return null;

  const V = env.toUpperCase();
  return (
    <div role="status" data-testid="venue-mode-reminder"
      style={{ display: 'flex', alignItems: 'center', gap: 10, background: T.warn, color: T.accInk, padding: '4px 4px 4px 12px', ...style }}>
      <span style={{ font: F.chk(700, 12), letterSpacing: '.1em', lineHeight: 1.45, flex: 1 }}>
        ▲ SET EACH GUN TO {V} (HOLD ALT 3 S) — IT PERSISTS ACROSS POWER CYCLES, SO A GUN LEFT ON THE
        OTHER SETTING IS STILL ON IT TONIGHT
      </span>
      <button type="button" data-testid="venue-mode-dismiss"
        aria-label={`dismiss the ${env} mode reminder for this session`}
        title="Hide this until the venue changes"
        onClick={() => publish(env)}
        style={{ ...BTN_RESET, font: F.chk(700, 11), letterSpacing: '.14em', color: T.accInk,
                 border: `1px solid ${T.accInk}`, padding: '8px 12px', minHeight: 36, minWidth: 36, cursor: 'pointer', flex: 'none' }}>
        DISMISS
      </button>
    </div>
  );
}
