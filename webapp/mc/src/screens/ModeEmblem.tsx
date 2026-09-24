// M17 (visual QA 2026-09-23): a mode with no card art in `public/assets/modes/` used to show a bare
// striped slot captioned "mode art", which reads as an unfinished page. This draws a plain line
// emblem instead, in the console's own colours: a hill with a flag and a capture ring for KOTH, and
// a sight reticle for any other mode that has no picture yet. It is a stand-in, not a claim that it
// is the mode's real art: when `<mode>.jpg` lands (and `MODE_ART` lists it), the picture wins.
import { useId } from 'react';
import { T } from '../tokens';

export function ModeEmblem({ mode }: { mode: string }) {
  const sky = `me-sky-${useId().replace(/:/g, '')}`;
  return (
    <svg data-testid={`mode-emblem-${mode}`} aria-hidden viewBox="0 0 280 90" preserveAspectRatio="xMidYMid slice"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}>
      <defs>
        <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={T.panelSoft} />
          <stop offset="1" stopColor={T.inset} />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="280" height="90" fill={`url(#${sky})`} />
      {/* a faint map grid, the same language as the briefing art */}
      {Array.from({ length: 13 }, (_, i) => <line key={`v${i}`} x1={i * 24} y1="0" x2={i * 24} y2="90" stroke={T.line} strokeWidth="1" />)}
      {Array.from({ length: 4 }, (_, i) => <line key={`h${i}`} x1="0" y1={i * 24 + 9} x2="280" y2={i * 24 + 9} stroke={T.line} strokeWidth="1" />)}
      {mode === 'koth' ? (
        <g>
          {/* contour lines of the hill */}
          <path d="M40 88 C90 40 190 40 240 88" fill="none" stroke={T.line2} strokeWidth="1.5" />
          <path d="M70 88 C105 52 175 52 210 88" fill="none" stroke={T.line2} strokeWidth="1.5" />
          <path d="M98 88 C122 60 158 60 182 88" fill={T.panelDeep} stroke={T.dim} strokeWidth="1.5" />
          {/* the capture ring round the top */}
          <ellipse cx="140" cy="66" rx="34" ry="9" fill="none" stroke={T.acc} strokeWidth="1.5" strokeDasharray="5 4" />
          {/* the flag */}
          <line x1="140" y1="64" x2="140" y2="22" stroke={T.ink} strokeWidth="2" />
          <path d="M141 23 L166 30 L141 37 Z" fill={T.acc} />
        </g>
      ) : (
        <g fill="none" stroke={T.acc} strokeWidth="1.5">
          <circle cx="140" cy="45" r="22" />
          <circle cx="140" cy="45" r="3" fill={T.acc} />
          <line x1="140" y1="15" x2="140" y2="33" /><line x1="140" y1="57" x2="140" y2="75" />
          <line x1="110" y1="45" x2="128" y2="45" /><line x1="152" y1="45" x2="170" y2="45" />
        </g>
      )}
    </svg>
  );
}
