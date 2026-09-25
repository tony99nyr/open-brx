// F221: the one way the console draws an alert. The severity comes from the catalogue
// (`src/alerts`), never from the caller, and it decides the colour, the glyph and the format:
//
//   RED     -> <Alert> draws a banner (tinted, red left rule). `variant="row"` draws the boxed row a
//              gun card uses. Glyph ▲.
//   AMBER   -> one line in amber with ▲. No border, no fill.
//   NEUTRAL -> dim text, no glyph. <AlertTag> draws a neutral outline tag.
//
// Words: pass `what` and `act`; the helper upper-cases them and joins them with one colon. `children`
// replaces the words when the line must hold markup (a <code> command); the caller then writes the
// words in the same `WHAT: DO` form itself.
import type { CSSProperties, ReactNode } from 'react';
import { F, T } from '../tokens';
import { GLYPH, SEV_COLOUR, alertWords, glyphed, sevOf, type Severity } from '../alerts';

type Sx = CSSProperties;

export interface AlertProps {
  /** The audit id in the catalogue. Decides the severity. */
  id: string;
  /** Overrides the catalogue for a server line whose severity `serverLineSev` worked out. */
  sev?: Severity;
  what?: string;
  act?: string | null;
  children?: ReactNode;
  /** RED only: `banner` (default) across the panel, `row` for the boxed row on a card. */
  variant?: 'banner' | 'row' | 'line';
  size?: number;
  title?: string;
  style?: Sx;
  role?: 'alert' | 'status';
  testid?: string;
}

/** The style of one severity and format, for a call site that must draw its own element (a <button>,
 *  a table cell). Everything else uses <Alert>. */
export function alertStyle(sev: Severity, variant: 'banner' | 'row' | 'line' = sev === 'red' ? 'banner' : 'line', size = 11): Sx {
  const c = SEV_COLOUR[sev];
  const base: Sx = { font: F.mono(sev === 'neutral' ? 500 : 600, size), letterSpacing: '.1em', color: c, lineHeight: 1.5, overflowWrap: 'anywhere' };
  if (sev !== 'red' || variant === 'line') return base;
  if (variant === 'row') return { ...base, padding: '4px 8px', border: `1px solid ${c}`, background: 'rgba(255,82,82,.08)' };
  return { ...base, padding: '8px 14px', border: `1px solid ${c}`, borderLeft: `3px solid ${c}`, background: 'rgba(255,82,82,.08)' };
}

export function Alert({ id, sev: sevIn, what, act, children, variant, size = 11, title, style, role, testid }: AlertProps) {
  const sev = sevIn ?? sevOf(id);
  const words = children ?? (what ? alertWords(what, act) : null);
  if (words == null) return null;
  const v = variant ?? (sev === 'red' ? 'banner' : 'line');
  // Only a RED banner interrupts a screen reader. Every other line is announced politely, so a board of
  // amber rows does not fire one assertive announcement per row on mount (F221 round 2).
  return (
    <div data-testid={testid} data-alert={id} data-sev={sev} role={role ?? (sev === 'red' && v === 'banner' ? 'alert' : 'status')} title={title}
      style={{ ...alertStyle(sev, v, size), ...style }}>
      {sev !== 'neutral' && <span aria-hidden="true">{GLYPH} </span>}{words}
    </div>
  );
}

/** A neutral outline tag: status, never a warning. */
export function AlertTag({ id, children, title, testid }: { id: string; children: ReactNode; title?: string; testid?: string }) {
  const sev = sevOf(id);
  const c = SEV_COLOUR[sev];
  return (
    <span data-testid={testid} data-alert={id} data-sev={sev} title={title}
      style={{ font: F.chk(700, 11), letterSpacing: '.14em', color: c, border: `1px solid ${sev === 'neutral' ? T.line2 : c}`, padding: '2px 8px', whiteSpace: 'nowrap' }}>
      {sev !== 'neutral' && <span aria-hidden="true">{GLYPH} </span>}{children}
    </span>
  );
}

/** Plain words with the glyph, for a `title`, an aria-label or a toast. */
export const alertString = (id: string, what: string, act?: string | null, sev?: Severity): string =>
  glyphed(sev ?? sevOf(id), alertWords(what, act));
