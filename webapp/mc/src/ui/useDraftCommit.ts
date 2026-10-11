import { useEffect, useRef } from 'react';

/** DRY review H3: the one draft-then-commit cycle (ValueBox, DraftText, KIT's PlayerNum each had a copy, and only
 *  ValueBox had the F494 fix). A commit shows the operator's value at once; if the server never echoes it within
 *  1.5 s, the field reverts to the server's. One timer: a newer commit replaces it, and unmounting clears it. */
export function useDraftCommit<T>(value: T, setDraft: (value: T) => void) {
  const focused = useRef(false);
  const pending = useRef<T | null>(null);
  const latest = useRef(value);
  const revert = useRef<ReturnType<typeof setTimeout> | null>(null);
  latest.current = value;

  // F494: the revert timer sets state, so it must not outlive the field (it fired after a test's jsdom was gone)
  useEffect(() => () => { if (revert.current != null) clearTimeout(revert.current); }, []);
  // Sync from the server only when ITS value changes (never on blur), so a just-committed edit doesn't flash the old value.
  useEffect(() => {
    if (pending.current != null && value === pending.current) pending.current = null;
    if (!focused.current && pending.current == null) setDraft(value);
  }, [value]);

  return {
    setFocused: (isFocused: boolean) => { focused.current = isFocused; },
    commit: (committed: T, onCommit: () => void) => {
      pending.current = committed;
      onCommit();
      if (revert.current != null) clearTimeout(revert.current);   // a newer commit owns the revert
      revert.current = setTimeout(() => {
        revert.current = null;
        if (pending.current != null) { pending.current = null; setDraft(latest.current); }
      }, 1500);
    },
  };
}
