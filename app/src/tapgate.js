// Accidental-entry guard for the hidden utility-mode door (app.js: 7 taps on the idle stage). Split out
// of app.js precisely so this can be unit tested without a DOM (app.js touches `document`; history.js
// set this precedent — see its header comment).
//
// T2-B item 3 (2026-09-13): N quick taps alone crossed into utility mode from an idle-stage jostle (a
// phone face-down in a bag, a pocket). Counting taps is still required (so a stray long touch on the
// idle screen can't trip it by itself), but the LAST contact must also be HELD for `holdMs` before the
// gate fires — a deliberate, single, sustained press, not a burst of brief ones. Pure state machine:
// every method takes the time explicitly, so tests never depend on a real clock or real timers.
export function createTapHoldGate({ taps = 7, windowMs = 3000, holdMs = 1500 } = {}) {
  let history = [];     // timestamps of completed prior contacts, pruned to `windowMs`
  let downAt = null;    // when the contact NOW down started being held, once it is the (taps)th within the window — null otherwise
  return {
    /** A new contact touched down at `now`. */
    down(now) {
      history = history.filter(t => now - t < windowMs);
      downAt = (history.length >= taps - 1) ? now : null;
      history.push(now);
    },
    /** The current contact lifted or was cancelled before the hold completed — it does not count as the trigger. */
    up() { downAt = null; },
    cancel() { downAt = null; },
    /** Forget the current contact and every prior tap. Use when the surrounding app becomes ineligible:
     *  a later gesture must start from zero rather than inheriting taps from an obsolete state. */
    reset() { downAt = null; history = []; },
    /** Ask "has the current contact now been held long enough?" at time `now`. True at most once per
     *  contact (and clears the whole tap history on a true, so re-entry needs a fresh run of taps). */
    held(now) {
      if (downAt != null && now - downAt >= holdMs) { downAt = null; history = []; return true; }
      return false;
    },
    /** Test/diagnostic hook: how many taps (including the one currently down, if any) are in the window. */
    get tapCount() { return history.length; },
  };
}

/** Wire the pure gate to the hidden-door surface. Dependencies are explicit so the complete gesture,
 * including cancellation and the fire-time eligibility check, is behavior-testable without booting app.js. */
export function installTapHoldDoor({
  stage,
  eligible,
  activate,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = id => clearTimeout(id),
  holdMs = 1500,
  releaseTarget = globalThis.window || stage,
} = {}) {
  const gate = createTapHoldGate({ holdMs });
  let holdTimer = null;
  const clearHoldTimer = () => {
    if (holdTimer === null) return;
    clearTimer(holdTimer);
    holdTimer = null;
  };
  stage.addEventListener('pointerdown', () => {
    clearHoldTimer();
    if (!eligible()) { gate.reset(); return; }
    gate.down(now());
    holdTimer = setTimer(() => {
      holdTimer = null;
      if (!eligible()) { gate.reset(); return; }
      if (gate.held(now())) activate();
    }, holdMs);
  }, { passive: true });
  // A contact can leave the frame before release. Listen at the window boundary so that release still
  // cancels the pending hold instead of letting a stale timer enter utility mode.
  releaseTarget.addEventListener('pointerup', () => { clearHoldTimer(); gate.up(); }, { passive: true });
  releaseTarget.addEventListener('pointercancel', () => { clearHoldTimer(); gate.cancel(); }, { passive: true });
  releaseTarget.addEventListener('blur', () => { clearHoldTimer(); gate.reset(); }, { passive: true });
}
