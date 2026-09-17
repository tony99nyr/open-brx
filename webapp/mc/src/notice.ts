// A notice that must outlive the screen that raised it.
// END MATCH EARLY sets phase → recap, the store follows the phase, <Live/> unmounts, and any state
// held there is gone before it can be read — so "END REACHED 0 OF 6 NODE(S)", the one thing that
// change existed to show, never appeared (review 2026-09-01). Module scope survives the unmount.
let current: { text: string; bad: boolean } | null = null;
const subs = new Set<(n: typeof current) => void>();
let autoClearTimer: ReturnType<typeof setTimeout> | null = null;

/** `autoClearMs`, when given, clears the notice on its own after that many milliseconds — for a
 *  notice that only confirms something happened (never a `bad` one: a refusal stays until the
 *  operator dismisses it, the same as before). Games.tsx's "UNSAVED EDITS DISCARDED" is the first
 *  caller (2026-09-17): a picked game must not leave a stale toast sitting in the bar forever. */
export function setNotice(text: string, bad = false, autoClearMs?: number) {
  if (autoClearTimer) { clearTimeout(autoClearTimer); autoClearTimer = null; }
  current = { text, bad };
  subs.forEach(fn => fn(current));
  if (autoClearMs) autoClearTimer = setTimeout(clearNotice, autoClearMs);
}
export function clearNotice() {
  if (autoClearTimer) { clearTimeout(autoClearTimer); autoClearTimer = null; }
  current = null; subs.forEach(fn => fn(current));
}

import { useEffect, useState } from 'react';
/** The current cross-screen notice, or null. */
export function useNotice() {
  const [n, setN] = useState(current);
  useEffect(() => { subs.add(setN); setN(current); return () => { subs.delete(setN); }; }, []);
  return n;
}
