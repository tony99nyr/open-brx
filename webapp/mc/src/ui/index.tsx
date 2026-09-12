// Primitives that encode the "military armory" design language (see design README).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CHAMFER, F, HAZARD, SEG_OVERLAY, STRIPES, T, TAB } from '../tokens';

export { Num, Digits, DIGIT_W } from './Num';

type Sx = CSSProperties;
const merge = (a: Sx, b?: Sx): Sx => (b ? { ...a, ...b } : a);

/** Reset for `<button>`s that look like the design's clickable spans/divs (keeps keyboard reachability). */
export const BTN_RESET: Sx = { background: 'transparent', border: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', textAlign: 'inherit', cursor: 'pointer', letterSpacing: 'inherit' };
/** Enter/Space activation for non-button interactive elements. */
export const onKey = (fn: () => void) => (e: { key: string; preventDefault(): void }) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

/** Screen header: mono accent kicker over a 30px Oswald title, with optional right-side content. */
export function ScreenHeader({ kicker, title, right }: { kicker: string; title: string; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '14px 28px', marginBottom: 20 }}>
      <div>
        <div style={{ font: F.mono(600, 11), letterSpacing: '.26em', color: T.acc }}>{kicker}</div>
        <div style={{ font: F.osw(700, 30), letterSpacing: '.1em', textTransform: 'uppercase', marginTop: 2 }}>{title}</div>
      </div>
      {right && <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14, flexWrap: 'wrap' }}>{right}</div>}
    </div>
  );
}

/** Section rule: label + 1px hairline that flexes to fill (+ optional right hint). */
export function SectionRule({ label, hint, style }: { label: string; hint?: ReactNode; style?: Sx }) {
  return (
    <div style={merge({ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }, style)}>
      <span style={{ font: F.chk(700, 11), letterSpacing: '.28em', color: T.dim }}>{label}</span>
      <span style={{ flex: 1, height: 1, background: T.line }} />
      {/* 11 px, not 9: the hint carries real content (how many stations are armed, what a section is
          FOR), and the console's floor for meaning-bearing text is 11 px (audit 2026-09-12). */}
      {hint && <span style={{ font: F.mono(500, 11), letterSpacing: '.12em', color: T.micro }}>{hint}</span>}
    </div>
  );
}

/** Panel with a chamfered corner via clip-path. */
export function Chamfer({ clip = CHAMFER.tr14, style, children, className, onClick }:
  { clip?: string; style?: Sx; children?: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div className={className} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? onKey(onClick) : undefined}
      style={merge({ background: T.panel, border: `1px solid ${T.line}`, clipPath: clip }, style)}>
      {children}
    </div>
  );
}

/** Header strip inside a chamfered panel: accent tick + label. */
export function PanelHeader({ label, right, tick = T.acc }: { label: string; right?: ReactNode; tick?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', background: T.panelAlt, borderBottom: `1px solid ${T.line}` }}>
      <span style={{ width: 8, height: 8, background: tick, clipPath: 'polygon(0 0,100% 0,100% 100%)' }} />
      <span style={{ font: F.chk(700, 11), letterSpacing: '.28em', color: T.dim }}>{label}</span>
      {right && <><span style={{ flex: 1 }} />{right}</>}
    </div>
  );
}

/** Hero panel with corner brackets (16–18px L-shaped 2px borders). */
export function Brackets({ color = T.acc, size = 16, style, children }: { color?: string; size?: number; style?: Sx; children?: ReactNode }) {
  return (
    <div className="brackets" style={merge({
      background: `linear-gradient(180deg,${T.panelSoft},${T.panelDeep})`, border: `1px solid ${T.line}`,
      ['--bk' as string]: `${size}px`, ['--bkc' as string]: color,
    }, style)}>
      {children}
    </div>
  );
}

/** Segmented meter: filled bar sliced into cells by a repeating gradient overlay. */
export function SegBar({ pct, color = T.ink, height = 10, cell = 10, style }: { pct: number; color?: string; height?: number; cell?: number; style?: Sx }) {
  return (
    <span style={merge({ display: 'inline-block', height, background: T.inset, border: `1px solid ${T.line}`, position: 'relative', overflow: 'hidden' }, style)}>
      <span style={{ display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      <span style={{ position: 'absolute', inset: 0, background: SEG_OVERLAY(cell) }} />
    </span>
  );
}

/** Solid tag: status-color background, dark ink. */
export function Tag({ children, color = T.acc, ink = T.accInk, size = 11, style }: { children: ReactNode; color?: string; ink?: string; size?: number; style?: Sx }) {
  return <span style={merge({ font: F.chk(700, size), letterSpacing: '.18em', color: ink, background: color, padding: '2px 8px', whiteSpace: 'nowrap' }, style)}>{children}</span>;
}

/** Outline tag (READY / WAIT). */
export function OutlineTag({ children, color, border }: { children: ReactNode; color: string; border: string }) {
  return <span style={{ font: F.chk(700, 11), letterSpacing: '.14em', color, border: `1px solid ${border}`, padding: '3px 9px' }}>{children}</span>;
}

/** Segmented control. */
export function Seg<V extends string>({ value, options, onChange, size = 11, pad = '5px 14px', label, titles, wrap = false }:
  { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void; size?: number; pad?: string;
    /** names the group for a screen reader (and for the e2e suite, which reads what it reads) */
    label?: string; titles?: Record<string, string>;
    /** let the options wrap onto a second row inside a narrow card — a five-way Seg in a 320 px card
     *  overflowed its clip-path and the last option could not be clicked (ITEMS, real browser 2026-09-11) */
    wrap?: boolean }) {
  return (
    <span role="group" aria-label={label} style={{ display: 'flex', flexWrap: wrap ? 'wrap' : undefined, border: `1px solid ${T.line}` }}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" className="hit44" onClick={() => onChange(o.value)} aria-pressed={on} title={titles?.[o.value]}
            // Selected used to be a solid T.acc block. With several Segs on one screen (START FROM,
            // WHO PICKS, WEAPONS|PERKS, RESPAWN) that is a lot of bright fill for a toggle — Tony,
            // 2026-09-02: "the colors of the buttons are too harsh maybe just border color or a
            // dimmer hue". A tinted panel plus an accent underline reads just as selected.
            style={{ ...BTN_RESET, font: F.chk(on ? 700 : 600, size), letterSpacing: '.08em', padding: pad,
              background: on ? T.panelAlt : 'transparent', color: on ? T.acc : T.micro,
              boxShadow: on ? `inset 0 -2px 0 ${T.acc}` : undefined,
              cursor: on ? 'default' : 'pointer', minHeight: 36, display: 'inline-flex', alignItems: 'center' }}>
            {o.label}
          </button>
        );
      })}
    </span>
  );
}

/** Square toggle. */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} role="switch" aria-checked={on} aria-label={label}
      style={{ ...BTN_RESET, width: 48, height: 36, position: 'relative', display: 'inline-block', cursor: 'pointer' }}>
      <span style={{ position: 'absolute', left: 4, top: 8, width: 40, height: 20, background: T.inset, border: `1px solid ${on ? T.acc : T.line2}`, boxSizing: 'border-box' }} />
      <span style={{ position: 'absolute', top: 11, left: on ? 27 : 7, width: 14, height: 14, background: on ? T.acc : T.micro, transition: 'left .12s' }} />
    </button>
  );
}

/** Striped image placeholder with a mono caption. */
export function StripedSlot({ height, caption, corner, style, children }: { height?: number; caption?: string; corner?: ReactNode; style?: Sx; children?: ReactNode }) {
  return (
    <div style={merge({ height, background: STRIPES(), border: `1px solid ${T.slot}`, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }, style)}>
      {corner}
      {caption && <span style={{ position: 'absolute', bottom: 4, right: 6, font: F.mono(500, 8), letterSpacing: '.16em', color: T.micro }}>{caption}</span>}
      {children}
    </div>
  );
}

/** PANIC / ABORT: hazard-stripe cell + red border. */
export function HazardButton({ children, onClick, size = 12, stripe = 12, pad = '9px 16px 9px 14px', title }:
  { children: ReactNode; onClick?: () => void; size?: number; stripe?: number; pad?: string; title?: string }) {
  return (
    <button className="hov-badbg" onClick={onClick} title={title}
      style={{ display: 'flex', alignItems: 'stretch', background: '#0c0507', border: `1px solid ${T.bad}`, cursor: 'pointer', padding: 0, minHeight: 44 }}>
      <span style={{ width: stripe, background: HAZARD, display: 'block' }} />
      <span style={{ font: F.chk(700, size), letterSpacing: '.26em', color: T.bad, padding: pad, display: 'flex', alignItems: 'center' }}>{children}</span>
    </button>
  );
}

/** Primary chamfered accent button. */
/** The filled accent button. Disabled uses `ink` on `faint`, not `accInk`: accInk measured ~2.1:1
 *  there, and a disabled PRIMARY often carries the label the operator most needs to read
 *  ("STARTING…"). `ink` on `faint` is 7.8:1 (review 2026-09-01). */
export function PrimaryButton({ children, onClick, disabled, clip = CHAMFER.tl10, size = 13, pad = '12px 26px', title }:
  { children: ReactNode; onClick?: () => void; disabled?: boolean; clip?: string; size?: number; pad?: string; title?: string }) {
  return (
    <button className={disabled ? undefined : 'hov-accbg'} onClick={disabled ? undefined : onClick} disabled={disabled} title={title}
      style={{ font: F.chk(700, size), letterSpacing: '.2em', padding: pad, background: disabled ? T.faint : T.acc, color: disabled ? T.ink : T.accInk, border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer', clipPath: clip, minHeight: 44 }}>
      {children}
    </button>
  );
}

/** Ghost / outline button. */
export function GhostButton({ children, onClick, color = T.dim, border = T.line, hoverClass = 'hov-acc', size = 11, pad = '9px 16px', title }:
  { children: ReactNode; onClick?: () => void; color?: string; border?: string; hoverClass?: string; size?: number; pad?: string; title?: string }) {
  return (
    <button className={hoverClass} onClick={onClick} title={title}
      style={{ font: F.chk(600, size), letterSpacing: '.16em', padding: pad, background: 'transparent', color, border: `1px solid ${border}`, cursor: 'pointer', minHeight: 44 }}>
      {children}
    </button>
  );
}

/** Number cell: mono label over a big Oswald number. */
export function NumberCell({ label, value, unit, color = T.ink, size = 24, pad = '8px 18px', labelSize = 11 }:
  { label: string; value: ReactNode; unit?: string; color?: string; size?: number; pad?: string; labelSize?: number }) {
  // labelSize default raised 9 -> 11 with the rest of the console's floor (audit 2026-09-12)
  return (
    <span style={{ background: T.panel, border: `1px solid ${T.line}`, padding: pad, display: 'inline-flex', flexDirection: 'column' }}>
      <span style={{ font: F.mono(500, labelSize), letterSpacing: '.2em', color: T.micro }}>{label}</span>
      <span style={{ font: F.osw(700, size), ...TAB, color }}>{value}{unit && <span style={{ font: F.chk(600, 12), color: T.micro }}>{unit}</span>}</span>
    </span>
  );
}

/** Count block: 24px Oswald over a 9px label (A1 GREEN/AMBER/RED). */
export function CountBlock({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, background: T.panel, border: `1px solid ${T.line2}`, padding: '7px 16px' }}>
      <span style={{ font: F.osw(700, 24), ...TAB, color }}>{value}</span>
      <span style={{ font: F.chk(600, 11), letterSpacing: '.18em', color: T.micro }}>{label}</span>
    </span>
  );
}

/** Inset value box with an Oswald number + dim unit; editable numeric input.
 *  Draft-then-commit: the server value is only written back while the field is NOT focused, and the
 *  edit is committed on blur / Enter (a PUT per keystroke raced the ≤4 Hz snapshot and ate keystrokes). */
export function ValueBox({ value, unit, onChange, min = 0, max = 9999, step = 1, label }:
  { value: number; unit?: string; onChange: (v: number) => void; min?: number; max?: number; step?: number; label?: string }) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false), pending = useRef<number | null>(null), latest = useRef(value);
  latest.current = value;
  // Sync from the server only when ITS value changes (never on blur), so a just-committed edit doesn't flash the old value.
  useEffect(() => { if (pending.current != null && value === pending.current) pending.current = null; if (!focused.current && pending.current == null) setDraft(String(value)); }, [value]);
  const commit = () => {
    const v = Number(draft);
    if (Number.isNaN(v) || draft.trim() === '') { setDraft(String(value)); return; }
    const c = Math.max(min, Math.min(max, v));
    setDraft(String(c));
    if (c !== value) { pending.current = c; onChange(c); setTimeout(() => { if (pending.current != null) { pending.current = null; setDraft(String(latest.current)); } }, 1500); }
  };
  const setFocused = (f: boolean) => { focused.current = f; };
  return (
    <span style={{ font: F.osw(700, 17), ...TAB, background: T.inset, border: `1px solid ${T.line2}`, padding: '4px 14px', display: 'inline-flex', alignItems: 'baseline', gap: 6, minHeight: 44 }}>
      <input className="numbox" type="number" value={draft} min={min} max={max} step={step} aria-label={label ?? unit ?? 'value'}
        onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
        onChange={e => setDraft(e.target.value)} />
      {unit && <span style={{ font: F.chk(600, 11), letterSpacing: '.12em', color: T.micro }}>{unit}</span>}
    </span>
  );
}

/** Text input that drafts locally and commits on blur / Enter (see ValueBox). */
export function DraftText({ value, onCommit, className = 'textbox', style, transform, ariaLabel, maxLength = 24 }:
  { value: string; onCommit: (v: string) => void; className?: string; style?: Sx; transform?: (s: string) => string; ariaLabel?: string; maxLength?: number }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false), pending = useRef<string | null>(null), latest = useRef(value);
  latest.current = value;
  useEffect(() => { if (pending.current != null && value === pending.current) pending.current = null; if (!focused.current && pending.current == null) setDraft(value); }, [value]);
  const commit = () => {
    const v = (transform ? transform(draft) : draft).trim();
    if (v && v !== value) { pending.current = v; onCommit(v); setTimeout(() => { if (pending.current != null) { pending.current = null; setDraft(latest.current); } }, 1500); }
    else setDraft(value);
  };
  const setFocused = (f: boolean) => { focused.current = f; };
  return (
    <input className={className} value={draft} maxLength={maxLength} aria-label={ariaLabel} style={style}
      onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      onChange={e => setDraft(transform ? transform(e.target.value) : e.target.value)} />
  );
}

/** Label/value micro-telemetry row pair used inside cards. */
/** The label half of every card's label/value pair (LINK · HEADSET · BATTERY · APP). It shipped at
 *  9.5 px, which is under the console's own floor for text that carries meaning — and these are the
 *  words that say WHAT the number beside them is (audit 2026-09-12). 11 px with the tracking pulled in
 *  so "LAST SEEN" still fits the 82 px label column. */
export function Micro({ children, color = T.micro, size = 11 }: { children: ReactNode; color?: string; size?: number }) {
  return <span style={{ font: F.mono(500, size), letterSpacing: '.12em', color }}>{children}</span>;
}

/** Progress cell: "n/N LABEL" + segmented bar (kit-out / ready). */
export function Progress({ n, total, label, color = T.acc }: { n: number; total: number; label: string; color?: string }) {
  // No bar. It used to render a 130px SegBar AFTER the number, so with two of these side by side the
  // bar sat between "2/2 KITTED" and "0/2 READY" and belonged visually to whichever you looked at —
  // Tony, 2026-09-02: "what do these blue bars represent?". The fraction already says it exactly.
  return (
    <span style={{ font: F.osw(700, 20), ...TAB, color: n === total && total > 0 ? color : T.ink }}>
      {n}<span style={{ color: T.micro }}>/{total} {label}</span>
    </span>
  );
}

/** Blinking dot. */
export function Blink({ color = T.ok, period = 2.4, size = 7 }: { color?: string; period?: number; size?: number }) {
  return <span style={{ width: size, height: size, background: color, animation: `linkBlink ${period}s infinite`, display: 'inline-block' }} />;
}

/** Horizontal shelf: fades its cut edge ONLY while it actually overflows (a fade on a shelf that fits dims the last card). */
export function Shelf({ children, style, className }: { children: ReactNode; style?: Sx; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const check = () => setOver(el.scrollWidth > el.clientWidth + 2 && el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    check();
    const ro = new ResizeObserver(check); ro.observe(el);
    el.addEventListener('scroll', check, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', check); };
  }, []);
  return <div ref={ref} className={`${className ?? ''} ${over ? 'shelf-x' : ''}`.trim()} style={merge({ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6, alignItems: 'stretch' }, style)}>{children}</div>;
}
