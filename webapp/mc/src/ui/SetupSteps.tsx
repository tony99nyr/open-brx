import { useStore } from '../store';
import { F, T } from '../tokens';
import { friendlyMcVerifyLine } from './McVerify';

/** Known `SETUP: ` bodies, rewritten as short, sentence-case, id-free lines for the operator.
 *
 *  Field feedback 2026-09-19 (Tony): the server's raw copy is a shouted, multi-clause sentence that
 *  can carry an internal tracking id in a trailing parenthetical (e.g. "(F88: a beacon carries no
 *  station id)") — meaningful to us, meaningless and confusing to an operator reading it at the field.
 *  These are hand-written replacements for the small, known set of `SETUP:` bodies `compile.py` and
 *  `state.py` send today. `friendlySetupLine` below falls back to a generic, still id-free and
 *  non-shouting rendering for anything not on this list, so a new or changed server string never goes
 *  unrendered — it just does not get the hand-tuned wording until this list catches up.
 */
const KNOWN_SETUP_LINES: Array<{ test: RegExp; line: string }> = [
  // The ir_station body also mentions "the grenade" in passing ("run the grenade if you want a hill
  // we have measured") — match the grenade body by its distinctive phrase, not the bare word, or an
  // ir_station game would be misread as a grenade one.
  // First: this body names the grenade or an IR station too, and must not read as either one's field step.
  { test: /A CONTROL STATION IS ASSIGNED BUT/i, line: "A control station is assigned, but this game's objective is not a station, so every phone ignores its hill. Set OBJECTIVE SOURCE to PHONE, or clear the CONTROL station in ITEMS." },
  { test: /POWER-CYCLE THE GRENADE/i, line: 'Power-cycle the grenade so it starts neutral, then set it to hill mode and place it. This mode supports one point only.' },
  { test: /IR STATION/i, line: 'Place and power the IR station, and check it reads neutral before the whistle. This source is unproven on our bench, so use the grenade if you want a hill we have measured.' },
  { test: /CONTROL POINT IS A BLUETOOTH STATION/i, line: 'The control point is a Bluetooth station: a StickS3, or a phone in the utility role as CONTROL. Confirm it shows MC-armed for this game, keep it awake, and check its battery. Do not power-cycle it once armed.' },
  { test: /NO CONTROL STATION IS ASSIGNED/i, line: "No control station is assigned. This game's objective is a Bluetooth control point, so assign a StickS3 or a utility phone as CONTROL in ITEMS and arm it, or nothing on the field is the hill." },
  { test: /NO RESPAWN STATION/i, line: 'No respawn station is assigned. Respawn is set to scanner, so a downed player can only come back at a station. Assign a utility phone as RESPAWN in ITEMS and arm it.' },
  { test: /SCANNER RESPAWN HAS NO STATION FOR\s+(.+?)\s+—/i, line: 'Scanner respawn has no station for $1. Those players use timed AUTO respawn; assign another RESPAWN station if you want station respawn for both teams.' },
];

/** `SETUP: ...` -> a short, sentence-case, id-free line. Exported for the unit test that proves the
 *  fallback never reintroduces a bracketed internal id. */
export function friendlySetupLine(raw: string): string {
  const body = raw.replace(/^SETUP:\s*/i, '');
  const known = KNOWN_SETUP_LINES.find(e => e.test.test(body));
  if (known) {
    const m = body.match(known.test);
    return known.line.replace('$1', m?.[1] ?? 'this team');
  }
  // Fallback for a `SETUP:` body not yet on the list above: drop a trailing internal id like
  // "(F88: ...)", stop shouting, and turn the em dash into a full stop rather than showing it raw.
  const stripped = body.replace(/\s*\([A-Z]\d+:[^)]*\)\s*$/, '').replace(/\s*—\s*/g, '. ');
  return stripped.charAt(0).toUpperCase() + stripped.slice(1).toLowerCase();
}

/** The "Match reminders" panel — PHYSICAL field steps (`SETUP: ` warnings) and the A31 "win is
 *  confirmed at MC" line, together, on the pre-match screens.
 *
 *  The server raises the SETUP: warnings in `validate()` (mc/API.md): power-cycle the grenade so the
 *  hill starts NEUTRAL, set it to hill mode, place it. They shipped rendered on GAMES only, which is
 *  the screen where you PICK the mode — so the operator read the step, walked out to place the
 *  grenade from LOBBY or ARMED, and there it was gone (operator review 2026-09-10). A step has to be
 *  on screen at the moment it is actionable, so this renders on the pre-match screens too.
 *
 *  Deliberately narrow: only `SETUP: `. The other `config_warnings` are technical advisories (a $SIR
 *  cell, a frag limit without coverage) and putting those on the last screen before the horn would
 *  train the operator to ignore the strip.
 *
 *  Field feedback 2026-09-19 (Tony), two rounds:
 *   1. This used to render as a solid amber bar, and separately A31's "win is confirmed at MC" line
 *      (`McVerify`, now folded in here) rendered as its own amber-bordered box right below it. Amber
 *      is also the YELLOW team's colour, so a yellow team name elsewhere on screen read as a warning.
 *      Neither is a fault — a SETUP step is a thing to go and do, and the A31 line is a standing fact
 *      — so both are now plain lines in one neutral "Match reminders" panel: no amber, no red, normal
 *      weight. Team colours stay off this panel, and off any other status panel.
 *   2. The raw server copy for both is a shouted, multi-clause sentence that can carry an internal
 *      tracking id ("F88") an operator has no use for. `friendlySetupLine` / `friendlyMcVerifyLine`
 *      rewrite known bodies into short, sentence-case, id-free lines, with a safe fallback for
 *      anything not yet recognised.
 */
export function SetupSteps({ style }: { style?: React.CSSProperties }) {
  const { state } = useStore();
  const steps = (state?.config_warnings ?? []).filter(w => /^SETUP:/i.test(w));
  const verifyRaw = state?.notices?.mc_verify;
  const verifyLine = verifyRaw ? friendlyMcVerifyLine(verifyRaw) : null;
  if (steps.length === 0 && !verifyLine) return null;
  return (
    <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 6,
                                 background: T.panelSoft, border: `1px solid ${T.line}`, padding: '10px 14px', ...style }}>
      <span style={{ font: F.chk(600, 11), letterSpacing: '.16em', textTransform: 'uppercase', color: T.dim }}>Match reminders</span>
      {steps.length > 0 && (
        <div data-testid="setup-steps" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {steps.map((w, i) => (
            <div key={i} style={{ font: F.chk(500, 12), letterSpacing: '.02em', lineHeight: 1.5, color: T.body }}>
              {friendlySetupLine(w)}
            </div>
          ))}
        </div>
      )}
      {verifyLine && (
        <div data-testid="mc-verify" style={{ font: F.chk(500, 12), letterSpacing: '.02em', lineHeight: 1.5, color: T.body }}>
          {verifyLine}
        </div>
      )}
    </div>
  );
}
