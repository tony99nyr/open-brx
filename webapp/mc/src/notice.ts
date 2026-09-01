// A notice that must outlive the screen that raised it.
// END MATCH EARLY sets phase → recap, the store follows the phase, <Live/> unmounts, and any state
// held there is gone before it can be read — so "END REACHED 0 OF 6 NODE(S)", the one thing that
// change existed to show, never appeared (review 2026-09-01). Module scope survives the unmount.
let current: { text: string; bad: boolean } | null = null;
const subs = new Set<(n: typeof current) => void>();

export function setNotice(text: string, bad = false) {
  current = { text, bad };
  subs.forEach(fn => fn(current));
}
export function clearNotice() { current = null; subs.forEach(fn => fn(current)); }

import { useEffect, useState } from 'react';
/** The current cross-screen notice, or null. */
export function useNotice() {
  const [n, setN] = useState(current);
  useEffect(() => { subs.add(setN); setN(current); return () => { subs.delete(setN); }; }, []);
  return n;
}
