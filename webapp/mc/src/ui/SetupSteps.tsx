import { useStore } from '../store';
import { F, T } from '../tokens';
import { colourOf, serverLine } from '../alerts';
import { Alert } from './Alert';
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
  //
  // F221 polish r2: the three STATION_CONFLICT lines below now read `WHAT: DO`, one colon, no full stop
  // in the middle — they used to be two full sentences (a fact, then a command), which read as prose,
  // not an alert. `conflictWords()` below is the one place that upper-cases them for GAMES/LOBBY/ITEMS,
  // so the words cannot drift apart across the three screens again.
  { test: /A CONTROL STATION IS ASSIGNED BUT/i, line: "A control station is assigned, but the objective is not a station, so every phone ignores its hill: set OBJECTIVE SOURCE to PHONE, or clear the CONTROL station in ITEMS." },
  { test: /POWER-CYCLE THE GRENADE/i, line: 'Power-cycle the grenade so it starts neutral, then set it to hill mode and place it. This mode supports one point only.' },
  { test: /IR STATION/i, line: 'Place and power the IR station, and check it reads neutral before the whistle. This source is unproven on our bench; the MVP hill is OBJECTIVE SOURCE PHONE.' },
  { test: /CONTROL POINT IS A BLUETOOTH STATION/i, line: 'The control point is a Bluetooth station assigned as CONTROL. Confirm it shows MC-armed for this game, keep it awake, and check its battery. Do not power-cycle it once armed.' },
  // M12 (visual QA 2026-09-24): the server does not say WHICH device will be the station (a phone or a
  // StickS3), so these say "a station", never "a utility phone".
  { test: /NO CONTROL STATION IS ASSIGNED/i, line: "No control station is assigned, and the objective is a Bluetooth control point, so nothing on the field is the hill: assign a station as CONTROL in ITEMS and arm it." },
  { test: /NO RESPAWN STATION/i, line: 'No respawn station is assigned, and respawn is set to scanner, so a downed player can only come back at a station: assign a station as RESPAWN in ITEMS and arm it.' },
  { test: /SCANNER RESPAWN HAS NO STATION FOR\s+(.+?)\s+\(/i, line: 'Scanner respawn has no station for $1. Those players use timed AUTO respawn; assign another RESPAWN station if you want station respawn for both teams.' },
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

/** H2 (visual QA 2026-09-24): the SETUP lines where the game and the ITEMS assignments disagree. They are
 *  not a field step to remember: the match will not play as set up until one side changes, so LOBBY and
 *  ARMED show them as an amber conflict block that stays up, and ARMORY names them in its header (M11). */
export const STATION_CONFLICT = /A CONTROL STATION IS ASSIGNED BUT|NO CONTROL STATION IS ASSIGNED|NO RESPAWN STATION IS ASSIGNED/i;
/** the conflict the CONTROL station's own card carries on ITEMS */
export const CONTROL_CONFLICT = /A CONTROL STATION IS ASSIGNED BUT/i;
export const setupLines = (warnings: string[] | undefined) => (warnings ?? []).filter(w => /^SETUP:/i.test(w));

/** F221 polish r2: one function for a `STATION_CONFLICT` line's alert words, so GAMES, LOBBY/ARMED
 *  (`SetupConflicts` below) and ITEMS (the CONTROL card) show the exact same words — the friendly
 *  rewrite, upper case, `WHAT: DO`. Never re-typed at any of the three call sites. */
export const conflictWords = (raw: string): string => friendlySetupLine(raw).toUpperCase();

/** The conflict block for `STATION_CONFLICT` lines, inside a `role="status"` region that is ALWAYS mounted:
 *  these are standing facts, not interruptions, and a region that exists before its first line is the one a
 *  screen reader announces (polish r1). Titled FIX BEFORE ARM; SETUP CONFLICT only when the CONTROL-under-
 *  grenade conflict is among the lines, since only that one is the game and ITEMS contradicting each other.
 *
 *  F221 polish r1: each line used to render as flat amber text, so the control-vs-grenade conflict (RED in
 *  the catalogue, `frame-setup-conflict-control-vs-grenade`, because the game will not play as set up) read
 *  exactly like the ordinary "no station assigned yet" amber. Each line now goes through `serverLine`, the
 *  same lookup the LOBBY/GAMES fault lists use, so its true catalogued severity decides its colour; the box
 *  itself turns red (not amber) the moment any line inside it is.
 *
 *  F221 polish r2: Tony's rule is explicit that AMBER is never a banner (tint + border + left rule) —
 *  only RED draws one. This block used to keep the tinted, bordered box even with every line amber; now
 *  the tint/border/rule apply only while `anyRed`, and an amber-only conflict is plain lines under the
 *  heading, the same weight as the neutral "Match reminders" panel below it. */
export function SetupConflicts({ style }: { style?: React.CSSProperties }) {
  const { state } = useStore();
  const lines = setupLines(state?.config_warnings).filter(w => STATION_CONFLICT.test(w));
  const title = lines.some(w => CONTROL_CONFLICT.test(w)) ? 'SETUP CONFLICT' : 'SETUP: FIX BEFORE ARM';
  const rows = lines.map(w => ({ w, ...serverLine(w, 'amber') }));
  const anyRed = rows.some(r => r.sev === 'red');
  const boxColor = anyRed ? T.bad : T.warn;
  return (
    <div role="status" data-setup-region="conflict">
      {lines.length > 0 && (
        <div data-testid="setup-conflict"
          style={{ display: 'flex', flexDirection: 'column', gap: 6,
                   ...(anyRed ? { background: 'rgba(255,82,82,.08)', border: `1px solid ${boxColor}`, borderLeft: `3px solid ${boxColor}`, padding: '10px 14px' } : {}),
                   ...style }}>
          {/* the glyph lives on each line below (via `<Alert>`), never doubled on this heading too */}
          <span style={{ font: F.chk(700, 11), letterSpacing: '.16em', color: boxColor }}>{title}</span>
          {/* `role="status"` on every row: this whole region is a standing fact, always mounted, never
              an interruption. `<Alert>` defaults red/amber to `role="alert"`, which this box must not
              carry (H2, polish r1). */}
          {rows.map((r, i) => <Alert key={i} id={r.id} sev={r.sev} variant="line" role="status">{conflictWords(r.w)}</Alert>)}
        </div>
      )}
    </div>
  );
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
  const steps = setupLines(state?.config_warnings).filter(w => !STATION_CONFLICT.test(w));
  const verifyRaw = state?.notices?.mc_verify;
  const verifyLine = verifyRaw ? friendlyMcVerifyLine(verifyRaw) : null;
  // polish r1: the same two regions whatever the lines, so a 0 -> N change fills them and never remounts them
  return (
    <>
    <SetupConflicts style={style} />
    <div role="status" data-setup-region="reminders">
    {(steps.length > 0 || verifyLine) && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6,
                                 background: T.panelSoft, border: `1px solid ${T.line}`, padding: '10px 14px', ...style }}>
      {/* F221: a standing, de-alarmed reminder panel (field feedback 2026-09-19) — NEUTRAL by design,
          so the label colour comes off the catalogue rather than a bare token. */}
      <span style={{ font: F.chk(600, 11), letterSpacing: '.16em', textTransform: 'uppercase', color: colourOf('frame-setup-steps-reminders') }}>Match reminders</span>
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
    )}
    </div>
    </>
  );
}
