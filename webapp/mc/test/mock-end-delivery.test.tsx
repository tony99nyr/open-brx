// A42 IN THE DEMO. `?mock` hardcoded the end-delivery block as a SPENT ladder (`retrying: false`,
// `tries: 7`) and returned nothing before recap, so the RE-DELIVERING state and the LIVE banner were
// unreachable in the demo at all -- while the real server arms the watch in `_finish()`, at the
// whistle. That matters beyond the demo: the public site's console shots are taken from `?mock`, so a
// state the demo cannot reach is a state nobody ever sees outside a jsdom test.
import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/mock/backend';

/** The demo's own path to a whistle: push, start with no runway, let `goLive` fire, then END.
 *
 *  The wait is not padding. `schedule()` only sets `start_` and `phase: 'armed'`; the armed -> live
 *  promotion happens inside `tick()`, which the demo runs on a ONE SECOND `setInterval`. So a whistle
 *  cannot be reached in less than a tick, and a shorter wait makes `control('end')` no-op against its
 *  own `!this.live_` guard -- which looks exactly like the bug this file is here to catch. */
async function endedDemo() {
  const b = new MockBackend();
  await b.pushLobby(true);
  await b.start(0, true);
  await new Promise(r => setTimeout(r, 1300));
  await b.control('end');
  return b;
}

describe('mock end-delivery (A42) is armed at the whistle and derives the ladder', () => {
  it('reads RE-DELIVERING right after the whistle, not a spent ladder', async () => {
    const was = location.pathname + location.search;
    window.history.replaceState({}, '', '/?mock&faults=1');
    try {
      const st = await (await endedDemo()).getState();
      const ed = st.end_delivery;
      expect(ed, 'the watch is armed at the whistle, not when RECAP is opened').toBeTruthy();
      expect(ed!.unconfirmed.length, 'faults=1 leaves exactly one phone unconfirmed').toBe(1);
      // the falsifying pair: the old block hardcoded both of these the other way.
      expect(ed!.retrying, 'the demo must be able to show RE-DELIVERING').toBe(true);
      expect(ed!.unconfirmed[0].tries, 'the ladder has only just started').toBeLessThan(7);
    } finally { window.history.replaceState({}, '', was); }
  });

  it('a clean demo says every HUD confirmed, and never claims to be retrying', async () => {
    const st = await (await endedDemo()).getState();
    const ed = st.end_delivery;
    expect(ed, 'still armed at the whistle with nobody missing').toBeTruthy();
    expect(ed!.unconfirmed.length).toBe(0);
    expect(ed!.retrying, 'nothing outstanding cannot be re-delivering').toBe(false);
    expect(ed!.confirmed).toBe(ed!.total);
  });
});
