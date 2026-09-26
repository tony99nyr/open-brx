// Design tokens — from the Claude Design handoff README ("military armory" system).
export const T = {
  // ground & structure
  page: '#07090d', panel: '#0c1016', panelAlt: '#090d12', inset: '#05070a',
  line: '#1c2733', row: '#131c26', line2: '#25313f', slot: '#141c26', panelSoft: '#0e141b', panelDeep: '#0a0e13',
  // ink
  ink: '#e8eef5', body: '#c7d3de', dim: '#8aa0b4', micro: '#71879c', faint: '#3a4a5c',
  // accent
  acc: '#39b4ff', accHover: '#7fd0ff', accInk: '#04121e',
  // semantic
  ok: '#2ecc71', warn: '#ffb020', bad: '#ff5252',
} as const;

// F423 (bench part 1, 2026-09-26): team 3 fights as "green" on the wire (its combat identity, F35 --
// green is reserved for the headset's own death out-blink) but the gun and headset PAINT it purple
// (mc/poolgauge.py TEAM_DISPLAY_COLOURS, protocol/brx-protocol.md $GLED/$HLED). MC's own team_id for
// it is "purple" now (`state.py` TEAM_DEFS), matching what the gun actually shows.
export const TEAM: Record<string, string> = {
  blue: '#3a86ff', yellow: '#ffd23f', red: '#ff5252', purple: '#7b2cbf', ffa: '#e8eef5',
};
export const teamColor = (id: string | null | undefined) => (id ? TEAM[id] ?? TEAM.ffa : TEAM.ffa);

/** M14 (visual QA 2026-09-23): weapon CLASS tints, a muted set of their own. The class colours used
 *  to be the team blue, yellow and green and the alarm red, so a SUPPORT tag read as "green team" and a
 *  HEAVY tag as a fault. These stay low in saturation and away from every TEAM and alarm hue
 *  (`test/tokens.test.ts` checks both). `ROLE` and `CLS_COLOR` below read from this table, so one
 *  class has one colour on every screen (KIT, GAMES, CATALOGUE and the DESIGNER chips). */
export const CLASS_TAG: Record<'heavy' | 'sniper' | 'assault' | 'cqb' | 'support' | 'sidearm', string> = {
  heavy: '#b8a07e', sniper: '#86b0a8', assault: '#8d9db4', cqb: '#b88f8a', support: '#98a880', sidearm: '#bdb8b0',
};

export const CLS_COLOR: Record<string, string> = {
  AR: CLASS_TAG.assault, SMG: CLASS_TAG.cqb, SNIPER: CLASS_TAG.sniper, SHOTGUN: CLASS_TAG.cqb, HEAVY: CLASS_TAG.heavy, LMG: CLASS_TAG.support,
};
/** weapons.json `role` → the human class label + colour (review round 3: no raw class ids on screen) */
// Literal hex on purpose: the site build reads these labels and colours out of this file as text
// (site/lib/facts.mjs). tokens.test.ts pins each colour to CLASS_TAG, so one class keeps one colour.
export const ROLE: Record<string, { label: string; color: string }> = {
  assault: { label: 'ASSAULT', color: '#8d9db4' }, cqb: { label: 'CLOSE RANGE', color: '#b88f8a' }, marksman: { label: 'SNIPER', color: '#86b0a8' },
  support: { label: 'SUPPORT', color: '#98a880' }, power: { label: 'HEAVY', color: '#b8a07e' }, melee: { label: 'MELEE', color: '#8aa0b4' },
  sidearm: { label: 'SIDEARM', color: '#bdb8b0' },   // the pistols (2026-09-04) — a slot-2 backup class
};
/** older MC (no `role`): no label at all rather than a raw class id (review round 3: no protocol ids on screen) */
export const roleOf = (role?: string, cls?: string) => ROLE[role ?? ''] ?? { label: CLS_COLOR[cls ?? ''] ? (cls ?? '').toUpperCase() : '', color: CLS_COLOR[cls ?? ''] ?? T.dim };
export const PERK_COLOR = '#c48bff';

// font shorthands (React accepts the CSS `font` shorthand as a string)
export const F = {
  osw: (w: number, px: number) => `${w} ${px}px 'Oswald','Arial Narrow',Impact,sans-serif`,
  chk: (w: number, px: number) => `${w} ${px}px 'Chakra Petch','Segoe UI',system-ui,sans-serif`,
  mono: (w: number, px: number) => `${w} ${px}px ui-monospace,monospace`,
};
/** ⚠ DOES NOTHING on either product font. `font-variant-numeric: tabular-nums` needs the FONT to ship
 *  tabular figures and neither Oswald nor Chakra Petch does — measured 2026-09-12: Oswald 500 at 40 px
 *  renders "11" and "00" 12 px apart WITH this set. Kept so untouched screens keep compiling; for any
 *  number that changes on screen use `<Num>` (`src/ui/Num.tsx`), which gives each digit a fixed cell. */
export const TAB = { fontVariantNumeric: 'tabular-nums' } as const;
// clip-paths
export const CHAMFER = {
  tr12: 'polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)',
  tr14: 'polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%)',
  br8: 'polygon(0 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%)',
  br10: 'polygon(0 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%)',
  tl10: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)',
  tl8: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)',
  tl14: 'polygon(14px 0,100% 0,100% 100%,0 100%,0 14px)',
} as const;

export const STRIPES = (a = 8, b = 16) => `repeating-linear-gradient(45deg,${T.slot} 0 ${a}px,${T.panel} ${a}px ${b}px)`;
export const HAZARD = 'repeating-linear-gradient(135deg,#ff5252 0 5px,#0c0507 5px 10px)';
export const SEG_OVERLAY = (cell: number) => `repeating-linear-gradient(90deg,transparent 0 ${cell}px,${T.page} ${cell}px ${cell + 2}px)`;

// A COUNTDOWN — a value counting down or up against the match clock (T-minus, a runway length). Both
// halves are zero-padded, so it always occupies the same width as it ticks (avoids the digits jumping
// about), and it floors: a countdown must never round UP to a time that has not arrived yet.
export const fmtClock = (s: number) => {
  const v = Math.max(0, Math.floor(s));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};
// A DURATION — a span already over and being reported (possession held, coverage seen), not a value
// still moving. Minutes are NOT padded (a duration reads as "7:21", never "07:21"), and the seconds
// round rather than floor: nothing here is still counting down, so rounding to the nearest second is
// the more honest read than truncating one off the true span. Do not fold this into `fmtClock` — a
// clock that rounds is wrong, and a duration padded to two digits reads like a clock it is not.
// Rounds the WHOLE span before splitting it, not the seconds half alone — `Math.round(s % 60)` can
// carry to 60 (119.7 would print "1:60"). `scoring.py`'s `possession()` rounds `by_team`/`neutral_s`/
// `observed_s` to whole seconds before they ever reach the wire, so no live value is fractional today;
// this is for the day one is (a mock fixture, or a server field that stops pre-rounding).
export const fmtDuration = (s: number) => {
  const v = Math.max(0, Math.round(s));   // clamp at zero, the way fmtClock does: a negative span must never print "-1:-5"
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};
// Tiered: a gun powered off overnight rendered as "1093m32s AGO", which nobody can read as 18 hours
// (field 2026-09-02). Seconds below a minute, then minutes, hours, days.
export const fmtAge = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  return `${Math.floor(s / 86400)}d${String(Math.floor((s % 86400) / 3600)).padStart(2, '0')}h`;
};
