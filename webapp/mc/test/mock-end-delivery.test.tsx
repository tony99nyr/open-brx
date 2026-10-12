// A42 IN THE DEMO. `?mock` hardcoded the end-delivery block as a SPENT ladder (`retrying: false`,
// `tries: 7`) and returned nothing before recap, so the RE-DELIVERING state and the LIVE banner were
// unreachable in the demo at all -- while the real server arms the watch in `_finish()`, at the
// whistle. That matters beyond the demo: the public site's console shots are taken from `?mock`, so a
// state the demo cannot reach is a state nobody ever sees outside a jsdom test.
import { describe, expect, it, vi } from 'vitest';
import { MockBackend } from '../src/mock/backend';
import { sessionArmEndDelivery, sessionNoteEndConfirm } from '../src/rules/endDelivery';
import { Live } from '../src/screens/Live';
import { Recap } from '../src/screens/Recap';
import { mountScreen } from './harness';

/** Push, start, let the quiet phone miss a live tick, then END. */
async function endedDemo() {
  vi.useFakeTimers();
  const b = new MockBackend();
  try {
    await b.pushLobby(true);
    // A fresh head cures the demo's stale ack before the server-equivalent START gate runs.
    if (location.search.includes('faults=1')) await b.pushLobby(true);
    await b.start(0, true);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await b.control('end');
    return await b.getState();
  } finally {
    b.dispose();
    vi.useRealTimers();
  }
}

describe('mock end-delivery (A42) is armed at the whistle and derives the ladder', () => {
  it('accepts only a positive receipt for this match or a different match', () => {
    const armed = sessionArmEndDelivery('match-1', 'p1', 1000);
    expect(sessionNoteEndConfirm(armed, 'idle', 'match-1').confirmed).toBe(false);
    expect(sessionNoteEndConfirm(armed, 'live', 'match-1').confirmed).toBe(false);
    expect(sessionNoteEndConfirm(armed, 'kitted', undefined).confirmed).toBe(false);
    expect(sessionNoteEndConfirm(armed, 'kitted', 'match-2').confirmed).toBe(true);
    expect(sessionNoteEndConfirm(armed, 'kitted', 'match-1').confirmed).toBe(true);
  });
  it('reads RE-DELIVERING right after the whistle, not a spent ladder', async () => {
    const was = location.pathname + location.search;
    window.history.replaceState({}, '', '/?mock&faults=1');
    try {
      const st = await endedDemo();
      const ed = st.end_delivery;
      expect(ed, 'the watch is armed at the whistle, not when RECAP is opened').toBeTruthy();
      expect(ed!.unconfirmed.length, 'faults=1 adds one missed END to the quiet phone').toBe(2);
      expect(ed!.unconfirmed.map(row => row.player_id)).toContain(st.recap!.awaiting![0]);
      // the falsifying pair: the old block hardcoded both of these the other way.
      expect(ed!.retrying, 'the demo must be able to show RE-DELIVERING').toBe(true);
      expect(ed!.unconfirmed[0].tries, 'the ladder has only just started').toBeLessThan(7);
    } finally { window.history.replaceState({}, '', was); }
  });

  it('the phone silent since LIVE remains unconfirmed after the whistle', async () => {
    const st = await endedDemo();
    const ed = st.end_delivery;
    expect(ed, 'the watch stays armed at the whistle').toBeTruthy();
    expect(ed!.unconfirmed).toHaveLength(1);
    expect(ed!.unconfirmed[0].node_id).toBe(st.players.find(p => p.player_id === ed!.unconfirmed[0].player_id)?.node_id);
    expect(ed!.retrying).toBe(true);
    expect(ed!.confirmed).toBe(ed!.total - 1);
    expect(st.recap?.awaiting).toContain(ed!.unconfirmed[0].player_id);
    expect(st.recap?.missing).toContain(ed!.unconfirmed[0].player_id);
  });

  it('keeps the receipt watch through NEXT MATCH and stops after the last retry', async () => {
    vi.useFakeTimers();
    const b = new MockBackend();
    try {
      await b.pushLobby(true);
      await b.start(0, true);
      await vi.advanceTimersByTimeAsync(2000);
      await b.control('end');
      const first = (await b.getState()).end_delivery!;
      expect(first.unconfirmed[0].tries).toBe(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect((await b.getState()).end_delivery?.unconfirmed[0].tries).toBe(2);
      await vi.advanceTimersByTimeAsync(35_000);
      const afterWait = await b.getState();
      const recap = afterWait.recap!;
      const confirmed = afterWait.players.find(p => p.node_id && p.player_id !== first.unconfirmed[0].player_id)!;
      expect(recap.missing).not.toContain(confirmed.player_id);
      expect(recap.awaiting).toContain(first.unconfirmed[0].player_id);
      await b.nextMatch();
      expect((await b.getState()).end_delivery?.match_id).toBe(first.match_id);
      await vi.advanceTimersByTimeAsync(105_000);
      const spent = (await b.getState()).end_delivery!;
      expect(spent.unconfirmed[0].tries).toBe(7);
      expect(spent.retrying).toBe(false);
    } finally {
      b.dispose();
      vi.useRealTimers();
    }
  });

  it('puts the same quiet HUD on the LIVE and RECAP screens', async () => {
    const state = await endedDemo();
    const name = state.end_delivery!.unconfirmed[0].display;
    const recap = await mountScreen(<Recap />, { state, view: 'recap' });
    const live = await mountScreen(<Live />, { state, view: 'live' });
    const recapDelivery = recap.find('[data-testid="end-delivery-recap"]')[0]?.textContent ?? '';
    const liveDelivery = live.find('[data-testid="end-delivery"]')[0]?.textContent ?? '';
    expect(recapDelivery).toContain(name);
    expect(recapDelivery).toContain('STILL RE-DELIVERING');
    expect(liveDelivery).toContain(name);
    expect(liveDelivery).toContain('RE-DELIVERING');
    expect(recap.find('[data-testid="settling"]')[0]?.textContent).toContain(name);
  });

  it('updates station sync and removes an evicted HUD from the delivery watch', async () => {
    vi.useFakeTimers();
    const b = new MockBackend();
    try {
      await b.pushLobby(true);
      await b.start(0, true);
      await vi.advanceTimersByTimeAsync(2000);
      await b.control('end');
      const before = await b.getState();
      const quiet = before.end_delivery!.unconfirmed[0];
      expect(before.recap?.stations?.find(s => s.node_id === 'util-d4e5f6')?.synced).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      b.utilityHello('util-d4e5f6');
      expect((await b.getState()).recap?.stations?.find(s => s.node_id === 'util-d4e5f6')?.synced).toBe(true);
      await b.evictNode(quiet.node_id);
      const after = (await b.getState()).end_delivery!;
      expect(after.total).toBe(before.end_delivery!.total - 1);
      expect(after.unconfirmed).toHaveLength(0);
    } finally {
      b.dispose();
      vi.useRealTimers();
    }
  });
});
