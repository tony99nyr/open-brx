// A number that does not move when its value does.
//
// `tokens.ts` exports `TAB = {fontVariantNumeric:'tabular-nums'}` and every big number on this console
// used it. It is a lie: the property only does something if the FONT ships tabular figures, and
// neither product face does. Measured 2026-09-12 in Chromium — Oswald 500 at 40 px, with
// `font-variant-numeric: tabular-nums` set, renders "11" and "00" at widths 12 px apart. The phone HUD
// made exactly the same assumption with Saira Condensed and the countdown re-centred and re-laid-out
// on every tick while a transform animation ran on it (game test 2026-09-11, A5).
//
// So the fix is not a CSS property, it is a box: each digit gets its own fixed-width, centred cell, and
// the value's width then depends only on how many characters it has — a score going 9 → 10 grows by
// exactly one cell, and 10 → 11 does not move at all. Separators and units (`:`, `.`, `%`, `/`, `—`)
// keep their natural width: a fixed cell around a colon reads as a gap.
//
// `TAB` stays exported for the screens that have not been converted, but nothing should rely on it.
import type { CSSProperties, ReactNode } from 'react';

/** Default cell width. Oswald's digits advance ~0.55em; 0.62em holds the widest with a hair of air on
 *  either side, which is what keeps a centred digit from looking cramped against its neighbour. */
export const DIGIT_W = '0.62em';

export function Num({ value, w = DIGIT_W, style, title }: {
  value: string | number;
  /** per-digit cell width, in em so it tracks the font size it is rendered at */
  w?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const s = String(value);
  const out: ReactNode[] = [];
  let run = '';
  const flush = (key: string) => { if (run) { out.push(<span key={key}>{run}</span>); run = ''; } };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c >= '0' && c <= '9') {
      flush(`t${i}`);
      out.push(
        <span key={i} data-digit="" style={{ display: 'inline-block', width: w, textAlign: 'center' }}>{c}</span>,
      );
    } else {
      run += c;
    }
  }
  flush('tail');
  // `aria-label` so a screen reader says "forty-two", not "four, two" — the cells are a layout device.
  //
  // `role="img"` is what makes that label REACH a screen reader. A bare <span> maps to role `generic`,
  // and ARIA forbids naming a generic element: the `aria-label` is dropped and the accessible name
  // falls back to the split-up digit cells — the exact announcement the label exists to prevent
  // (review 2026-09-12). `img` is the honest role for what this is: one value drawn out of parts.
  return <span role="img" aria-label={s} title={title} style={{ display: 'inline-block', whiteSpace: 'nowrap', ...style }}>{out}</span>;
}

/** The same thing under the name the rest of the console reaches for first. */
export const Digits = Num;
