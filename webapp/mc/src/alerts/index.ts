// F221 (Tony, 2026-09-25): ONE rule for every warning colour on the console.
//
//   RED     = act now, or the game is wrong. A banner across the screen or panel it concerns
//             (on a gun card: the boxed row). Glyph ▲.
//   AMBER   = fix before the next match. One line on the card or panel it concerns. Glyph ▲.
//             Never a banner, never a filled chip.
//   NEUTRAL = status only. Dim text or an outline tag. No glyph, no amber, no red.
//
// A call site never picks `T.warn` or `T.bad` for an alert. It names the alert's id, and the
// catalogue below gives the severity. `test/alert-severity.test.ts` pins every id against the
// approved audit (`test/alert-audit-2026-09-25.json`), so a colour cannot drift at one call site.
//
// Wording: every alert reads `WHAT IS WRONG: WHAT TO DO`, upper case, one colon, no suffix that
// restates the colour ("BLOCKS START", "DOES NOT BLOCK"). The helper adds the glyph; the words never
// carry it. A command to type stays exactly as typed (render it in <code>).
import { T } from '../tokens';
import { ARMORY_ALERTS, ARMORY_RETIRED } from './armory';
import { SETUP_ALERTS, SETUP_RETIRED } from './setup';
import { LOBBY_ALERTS, LOBBY_RETIRED } from './lobby';
import { LIVE_ALERTS, LIVE_RETIRED } from './live';
import { RECAP_ALERTS, RECAP_RETIRED } from './recap';
import { SERVER_ALERTS, SERVER_RETIRED } from './server';

export type Severity = 'red' | 'amber' | 'neutral';

/** One catalogue row: the severity, and the wording as a template (`{name}` marks a value). The
 *  template is the documentation the gallery and the review read; the call site writes the same words. */
export interface AlertDef {
  sev: Severity;
  text: string;
  /** Other audit ids this one render site also covers (one component shown on several screens, or two
   *  phrasings of one fact merged into this one). */
  also?: string[];
  /** Required when `sev` differs from the audit's proposed severity: why. */
  why?: string;
}

export const GLYPH = '▲';

/** The only place an alert colour is chosen. */
export const SEV_COLOUR: Record<Severity, string> = { red: T.bad, amber: T.warn, neutral: T.dim };

/** Every alert the console shows, by the audit id. Each lane file owns the ids of the screens it renders. */
export const ALERTS: Record<string, AlertDef> = {
  ...ARMORY_ALERTS, ...SETUP_ALERTS, ...LOBBY_ALERTS, ...LIVE_ALERTS, ...RECAP_ALERTS, ...SERVER_ALERTS,
};

/** Audit ids that no longer render as an alert, with the reason (the line was removed, or it is now
 *  positive or data status and not an alert at all). */
export const RETIRED: Record<string, string> = {
  ...ARMORY_RETIRED, ...SETUP_RETIRED, ...LOBBY_RETIRED, ...LIVE_RETIRED, ...RECAP_RETIRED, ...SERVER_RETIRED,
};

/** The severity of one catalogued alert. Throws on an unknown id, so a typo fails the first render in
 *  a test instead of falling back to a colour nobody chose. */
export function sevOf(id: string): Severity {
  const d = ALERTS[id];
  if (!d) throw new Error(`alert id "${id}" is not in the catalogue (src/alerts)`);
  return d.sev;
}
export const colourOf = (id: string): string => SEV_COLOUR[sevOf(id)];

/** `WHAT: DO`, upper case. The glyph is not part of the words. */
export function alertWords(what: string, act?: string | null): string {
  const w = what.trim().toUpperCase();
  const a = act?.trim();
  return a ? `${w}: ${a.toUpperCase()}` : w;
}

/** The words with the glyph, as a screen reader and a `title` read them. Neutral carries no glyph. */
export function glyphed(sev: Severity, words: string): string {
  return sev === 'neutral' ? words : `${GLYPH} ${words}`;
}

// ---- one fact, one sentence -------------------------------------------------------------------
// The facts more than one screen states. A screen imports the words; it never re-types them.

/** The browser's socket to MC is down: the board on screen is the last snapshot. */
export const MC_OFFLINE = { what: 'MC OFFLINE, THE BOARD IS FROZEN AT THE LAST SNAPSHOT', act: 'CHECK THAT MC IS RUNNING' } as const;
/** The MC process is older than the console served to this browser (a route 404s). */
export const MC_OLDER = { what: 'MC SERVER IS OLDER THAN THIS CONSOLE', act: 'RESTART MC' } as const;
/** The command that restarts MC, shown in <code> beside MC_OLDER where there is room. */
export const MC_RESTART_CMD = './start.sh';
/** The operator token is missing or wrong (401). NEUTRAL: a prompt, not a fault.
 *
 *  The link MC prints ends in a case-sensitive `#tok=` (`client.ts` parses it with `/tok=/`, lower
 *  case only). Split into `actPre`/`code`/`actPost` so a call site never runs the whole fact through
 *  `alertWords()`/`.toUpperCase()`, which turned it into the unrecognised `#TOK=` (F221 round 1). */
export const OPERATOR_TOKEN = { what: 'OPERATOR TOKEN NEEDED', actPre: 'OPEN THE', code: '#tok=', actPost: 'LINK THAT MC PRINTED' } as const;
/** `OPERATOR_TOKEN` as one line for a plain-text context (an `aria-label`, a `title`) that cannot
 *  hold a `<code>` element. The words are already upper case; `code` keeps its exact, lower-case form. */
export const operatorTokenLine = (): string => `${OPERATOR_TOKEN.what}: ${OPERATOR_TOKEN.actPre} ${OPERATOR_TOKEN.code} ${OPERATOR_TOKEN.actPost}`;
/** A gun whose HP/armour pools disagree with the game (LIVE): the cure is a forced respawn. */
export const GUN_POOLS_WRONG = { what: 'GUN POOLS WRONG', act: 'FORCE RESPAWN' } as const;

// ---- battery: one threshold for the gun, the phone and the station ----------------------------
/** F221: under 30 % is AMBER, for every battery the console shows. `state.py` uses the same number. */
export const BATTERY_LOW_PCT = 30;
export const batteryLow = (pct: number | null | undefined): boolean => typeof pct === 'number' && pct < BATTERY_LOW_PCT;
/** The colour of a battery READING: amber when low, else the caller's ordinary data colour. */
export const batteryColour = (pct: number | null | undefined, normal: string = T.dim): string => (batteryLow(pct) ? SEV_COLOUR.amber : normal);

// ---- server-worded lines ----------------------------------------------------------------------
/** The severity of one line MC wrote (a readiness blocker, an amber, a station attention line).
 *
 *  MC words the line; the console colours it. A line is matched by its HEAD (the words before the
 *  first `:` or `(`), against `SERVER_LINES` in `./server`. A line the table does not know keeps the
 *  list's own default (a blocker RED, an amber AMBER), so a new server line is never silently dimmed. */
export { serverLine, serverLineSev, SERVER_LINES } from './server';
