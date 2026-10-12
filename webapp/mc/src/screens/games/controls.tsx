// PLAY's quick-pick steppers: time limit, kill limit, countdown and hold target. Split out of Games.tsx
// (round-2 candidate 11).
import { useRef, useState } from 'react';
import { HOLD_TARGET_MAX_S, TIME_LIMIT_MAX_S } from '../../api/contract.gen';
import { F, T } from '../../tokens';
import { BTN_RESET, StepBtn, useFlashOnChange } from '../../ui';
import { RUNWAYS, getRunway } from '../../runway';

const TIME_QUICK_MIN = [5, 10, 15, 20, 30];
// VQA QA-08: the server's own cap on a match's time limit (2 hours) — the stepper never sends past it.
const TIME_MAX_MIN = TIME_LIMIT_MAX_S / 60;
const KILLS_QUICK = [0, 10, 15, 25, 50, 100];   // 0 = NO KILL LIMIT
const COUNTDOWN_QUICK = [10, 30, 60];
// Bench 2026-09-28: `QuickPick`'s own `minValueWidth`, one per control, each sized to that control's
// widest label at its real weight/size (`F.chk(700, 14)`) — measured off the actual "Chakra Petch"
// face (a `<span>` off-screen, `getBoundingClientRect`), not guessed from character counts (the
// font is proportional, not monospace). Each is the measured text width + the button's own
// horizontal padding (24px) + its 1px border each side + a few px of slack for antialiasing/hinting
// differences across browsers. Widest label per control: TIME "120 MIN" (the cap, TIME_MAX_MIN);
// KILLS "NO KILL LIMIT" (wider than any "N KILLS" up to three digits); COUNTDOWN "COUNTDOWN 120 S" /
// "COUNTDOWN 180 S" (RUNWAYS' own top two); HOLD "HOLD 120 MIN" (the cap, HOLD_MAX_S).
const TIME_VALUE_W = 90;
const KILLS_VALUE_W = 136;
const COUNTDOWN_VALUE_W = 172;
const HOLD_VALUE_W = 136;

/** F415 (games-presets.md §7): KOTH's own hold target -- NO TARGET (null, the pre-F415 behaviour: most
 *  possession at the clock wins), or 3/5/10 MIN quick-picks with ±1 MIN steppers. Stepping down from a
 *  low value lands on NO TARGET (KillsControl's own idiom, minutes instead of a kill count); stepping
 *  up from NO TARGET starts a fresh target at 1 MIN. */
// Low (b), review e8811fea: the server's own ceiling is 1s..2:00:00 (checkHoldTargetShape's own sibling
// check in mock/backend.ts) -- the stepper must not invite a value it would only send back refused.
const HOLD_MAX_S = HOLD_TARGET_MAX_S;

export function HoldControl({ seconds, onChange }: { seconds: number | null; onChange: (s: number | null) => void }) {
  const step = (dir: 1 | -1) => { const next = (seconds ?? 0) + dir * 60; onChange(next <= 0 ? null : Math.min(next, HOLD_MAX_S)); };
  return (
    <QuickPick testid="match-hold-value" valueLabel={seconds ? `HOLD ${Math.round(seconds / 60)} MIN` : 'NO TARGET'} minValueWidth={HOLD_VALUE_W}
      quick={[0, 3, 5, 10]} quickLabel={v => (v === 0 ? 'NO TARGET' : `${v} MIN`)}
      onQuick={v => onChange(v === 0 ? null : v * 60)}
      step={(
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <StepBtn label="hold target minus" onClick={() => step(-1)}>−</StepBtn>
          <StepBtn label="hold target plus" disabled={(seconds ?? 0) >= HOLD_MAX_S} onClick={() => step(1)}>+</StepBtn>
        </span>
      )} />
  );
}

/** Tapping the value opens a short quick-pick row; the steppers stay for fine adjustment beyond it
 *  (games-redesign.md §5). One shape, three uses below.
 *
 *  Bench 2026-09-28: pressing − / + changed the LENGTH of the value text ("10 MIN" -> "9 MIN",
 *  "NO KILL LIMIT" -> "15 KILLS"), which shrank or grew the button and shoved the − / + pair sideways
 *  with it -- a stepper whose own position moves under the finger that is stepping it. `minValueWidth`
 *  fixes the button at its widest label for that control (measured off the real font, callers below),
 *  so the box never resizes; only the text inside it changes. Centred (`textAlign` + the flex centring)
 *  so a short label ("5 MIN") sits in the middle of the box, not jammed against its left edge. */
function QuickPick({ testid, valueLabel, quick, quickLabel, onQuick, step, minValueWidth }:
  { testid: string; valueLabel: string; quick: number[]; quickLabel: (v: number) => string; onQuick: (v: number) => void; step: React.ReactNode; minValueWidth: number }) {
  const [open, setOpen] = useState(false);
  const valueRef = useRef<HTMLButtonElement>(null);
  useFlashOnChange(valueRef, valueLabel);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button ref={valueRef} type="button" data-testid={testid} className="hov-acc hit44"
          onClick={() => setOpen(o => !o)} aria-expanded={open}
          style={{ ...BTN_RESET, font: F.chk(700, 14), padding: '8px 12px', minHeight: 44, minWidth: minValueWidth,
                   display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
                   fontVariantNumeric: 'tabular-nums', cursor: 'pointer', color: T.acc, border: `1px solid ${T.line2}` }}>
          {valueLabel}
        </button>
        {step}
      </div>
      {open && (
        <div role="group" data-testid="quick-pick-row" style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {quick.map(v => (
            <button key={v} type="button" onClick={() => { onQuick(v); setOpen(false); }} className="hit44"
              style={{ ...BTN_RESET, font: F.chk(600, 14), padding: '8px 12px', minHeight: 44, minWidth: 44, cursor: 'pointer', background: T.panelDeep, border: `1px solid ${T.line}`, color: T.body }}>
              {quickLabel(v)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TimeControl({ seconds, onChange }: { seconds: number | null; onChange: (s: number) => void }) {
  const mins = Math.max(1, Math.round((seconds ?? 600) / 60));
  return (
    <QuickPick testid="match-time-value" valueLabel={`${mins} MIN`} minValueWidth={TIME_VALUE_W} quick={TIME_QUICK_MIN}
      quickLabel={v => `${v} MIN`} onQuick={v => onChange(v * 60)}
      step={(
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <StepBtn label="time limit minus" onClick={() => onChange(Math.max(1, mins - 1) * 60)}>−</StepBtn>
          {/* VQA QA-08: the server refuses a time limit past its own cap; never send past it. */}
          <StepBtn label="time limit plus" disabled={mins >= TIME_MAX_MIN} onClick={() => onChange(Math.min(TIME_MAX_MIN, mins + 1) * 60)}>+</StepBtn>
        </span>
      )} />
  );
}

export function KillsControl({ fragLimit, onChange }: { fragLimit: number | null; onChange: (n: number | null) => void }) {
  // VQA QA-22: stepping down from a low kill count must land on NO KILL LIMIT, not stick at "1 KILLS"
  // (and pressing − again while already at NO KILL LIMIT must stay there, not go negative).
  const step = (dir: 1 | -1) => { const next = (fragLimit ?? 0) + dir * 5; onChange(next <= 0 ? null : next); };
  return (
    <QuickPick testid="match-kills-value" valueLabel={fragLimit ? `${fragLimit} KILLS` : 'NO KILL LIMIT'} minValueWidth={KILLS_VALUE_W}
      quick={KILLS_QUICK} quickLabel={v => (v === 0 ? 'NO KILL LIMIT' : `${v}`)}
      onQuick={v => onChange(v === 0 ? null : v)}
      step={(
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <StepBtn label="kill limit minus" onClick={() => step(-1)}>−</StepBtn>
          <StepBtn label="kill limit plus" onClick={() => step(1)}>+</StepBtn>
        </span>
      )} />
  );
}

export function CountdownControl({ seconds, onChange }: { seconds: number; onChange: (s: number) => void }) {
  const idx = Math.max(0, RUNWAYS.indexOf(seconds));
  const step = (d: number) => onChange(RUNWAYS[Math.max(0, Math.min(RUNWAYS.length - 1, idx + d))] ?? getRunway());
  return (
    <QuickPick testid="match-countdown-value" valueLabel={`COUNTDOWN ${seconds} S`} minValueWidth={COUNTDOWN_VALUE_W} quick={COUNTDOWN_QUICK}
      quickLabel={v => `${v} S`} onQuick={onChange}
      step={(
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <StepBtn label="countdown minus" onClick={() => step(-1)}>−</StepBtn>
          <StepBtn label="countdown plus" onClick={() => step(1)}>+</StepBtn>
        </span>
      )} />
  );
}
