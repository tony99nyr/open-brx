// Shared fakes for the app tests. Not a test file: the `test/*.test.mjs` glob skips it.
// Add a helper here only when every copy behaved the same way. A copy that differs in substance stays local.
// `helpers-no-copies.test.mjs` fails if a test file declares one of these names itself.

/** In-memory `localStorage` stand-in. `m` is the backing Map, for tests that read it directly. */
export function mkStorage() {
  const m = new Map();
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

/** Wait one macrotask, so queued promise callbacks and `setImmediate` callbacks run. */
export const flush = () => new Promise(r => setImmediate(r));

/** The `$TMP` frames in a list of written frames. */
export const tmps = w => w.filter(f => f.startsWith('$TMP'));

/** The `$SIR,` frames in a list of written frames. */
export const sirRows = w => w.filter(f => f.startsWith('$SIR,'));

/**
 * Mock `setTimeout`, `setInterval` and `Date` for this test and return `advance(ms)`.
 * `advance` steps 1 ms at a time and drains the microtask and immediate queues after each step, so a
 * callback that arms a new timer during the advance still fires at the right moment. `defaultMs` is the
 * span used when `advance()` gets no argument. The mock resets when the test ends.
 */
export function useClock(ctx, defaultMs = 0) {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_700_000_000_000 });
  return async (ms = defaultMs) => { for (let i = 0; i < ms; i++) { ctx.mock.timers.tick(1); await flush(); } };
}

/** A bare DOM element stand-in, enough for the utility screens' wiring tests. */
export function makeEl(id) {
  return {
    id, hidden: false, textContent: '', innerHTML: '', className: '', value: '',
    style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} }, dataset: {},
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
  };
}
