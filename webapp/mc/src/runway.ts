import { useEffect, useState } from 'react';

/** Countdown lengths the operator can arm: quick bench starts through full walk-outs (Tony 2026-08-26). */
export const RUNWAYS = [10, 15, 30, 45, 60, 90, 120, 180];
// F411 (docs/spec/design/games-presets.md §2, Tony 2026-09-26): "default countdown 30s. 120s is
// generally too long." MATCH SETTINGS' COUNTDOWN pre-fills this same default.
export const DEFAULT_RUNWAY = 30;

const KEY = 'brx.mc.runway';

// Field 2026-08-30: the countdown reset to 02:00 every time the operator changed tabs. Lobby and Armed
// each held the choice in `useState(120)`, and React re-runs a useState initialiser on every REMOUNT —
// which is what a tab switch is. The operator's pick has to outlive the screen, so it lives here
// (module scope survives remounts; localStorage survives a console reload/restart too).
let current = DEFAULT_RUNWAY;
try {
  const v = Number(localStorage.getItem(KEY));
  if (RUNWAYS.includes(v)) current = v;
} catch { /* private window / storage blocked — the default is fine */ }

const subs = new Set<(v: number) => void>();

export function setRunway(v: number) {
  current = v;
  try { localStorage.setItem(KEY, String(v)); } catch { /* non-fatal */ }
  subs.forEach(fn => fn(v));
}

export function getRunway(): number { return current; }

/** Polish round 1 Low: LAST MATCH and a loaded FAVOURITE can both set the runway to whatever they were
 *  actually armed with, which need not be a RUNWAYS value (an older favourite, or a value another
 *  console version wrote). SAVE AS A FAVOURITE snaps to the nearest one so a newly saved favourite
 *  never drifts off the enumerated set. */
export function nearestRunway(v: number): number {
  if (RUNWAYS.includes(v)) return v;
  return RUNWAYS.reduce((best, r) => (Math.abs(r - v) < Math.abs(best - v) ? r : best), RUNWAYS[0]);
}

/** The armed-countdown length, shared by every screen and stable across remounts. */
export function useRunway(): [number, (v: number) => void] {
  const [v, setV] = useState(current);
  useEffect(() => { subs.add(setV); setV(current); return () => { subs.delete(setV); }; }, []);
  return [v, setRunway];
}
