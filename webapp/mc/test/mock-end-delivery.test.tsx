// A42 IN THE DEMO. `?mock` hardcoded the end-delivery block as a SPENT ladder (`retrying: false`,
// `tries: 7`) and returned nothing before recap, so the RE-DELIVERING state and the LIVE banner were
// unreachable in the demo at all -- while the real server arms the watch in `_finish()`, at the
// whistle. That matters beyond the demo: the public site's console shots are taken from `?mock`, so a
// state the demo cannot reach is a state nobody ever sees outside a jsdom test.
import { describe, expect, it, vi } from 'vitest';
import { MockBackend } from '../src/mock/backend';

/** Push, start, advance the demo's one-second tick, then END. */
async function endedDemo() {
  vi.useFakeTimers();
  const b = new MockBackend();
  try {
    await b.pushLobby(true);
    // A fresh head cures the demo's stale ack before the server-equivalent START gate runs.
    if (location.search.includes('faults=1')) await b.pushLobby(true);
    await b.start(0, true);
    await vi.advanceTimersByTimeAsync(1000);
    await b.control('end');
    return await b.getState();
  } finally {
    b.dispose();
    vi.useRealTimers();
  }
}

describe('mock end-delivery (A42) is armed at the whistle and derives the ladder', () => {
  it('reads RE-DELIVERING right after the whistle, not a spent ladder', async () => {
    const was = location.pathname + location.search;
    window.history.replaceState({}, '', '/?mock&faults=1');
    try {
      const st = await endedDemo();
      const ed = st.end_delivery;
      expect(ed, 'the watch is armed at the whistle, not when RECAP is opened').toBeTruthy();
      expect(ed!.unconfirmed.length, 'faults=1 leaves exactly one phone unconfirmed').toBe(1);
      // the falsifying pair: the old block hardcoded both of these the other way.
      expect(ed!.retrying, 'the demo must be able to show RE-DELIVERING').toBe(true);
      expect(ed!.unconfirmed[0].tries, 'the ladder has only just started').toBeLessThan(7);
    } finally { window.history.replaceState({}, '', was); }
  });

  it('a clean demo says every HUD confirmed, and never claims to be retrying', async () => {
    const st = await endedDemo();
    const ed = st.end_delivery;
    expect(ed, 'still armed at the whistle with nobody missing').toBeTruthy();
    expect(ed!.unconfirmed.length).toBe(0);
    expect(ed!.retrying, 'nothing outstanding cannot be re-delivering').toBe(false);
    expect(ed!.confirmed).toBe(ed!.total);
  });
});
