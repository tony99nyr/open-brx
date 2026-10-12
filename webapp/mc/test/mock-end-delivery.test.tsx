// A42 IN THE DEMO. `?mock` hardcoded the end-delivery block as a SPENT ladder (`retrying: false`,
// `tries: 7`) and returned nothing before recap, so the RE-DELIVERING state and the LIVE banner were
// unreachable in the demo at all -- while the real server arms the watch in `_finish()`, at the
// whistle. That matters beyond the demo: the public site's console shots are taken from `?mock`, so a
// state the demo cannot reach is a state nobody ever sees outside a jsdom test.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MockBackend } from '../src/mock/backend';
import { sessionArmEndDelivery, sessionEndDeliveryTried, sessionEndDeliveryView, sessionNoteEndConfirm, sessionSayEndUnconfirmed } from '../src/rules/endDelivery';
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
  // The demo's random kills during an advance change who is alive, and so which phone goes quiet and who has
  // facts: every test here runs with them off (a URL a test sets itself carries norandom too).
  let outer = '';
  beforeEach(() => { outer = location.pathname + location.search; window.history.replaceState({}, '', '/?mock&norandom=1'); });
  afterEach(() => { window.history.replaceState({}, '', outer); });
  it('accepts only a positive receipt for this match or a different match', () => {
    const armed = sessionArmEndDelivery('match-1', 'p1', 1000);
    expect(sessionNoteEndConfirm(armed, 'idle', 'match-1').confirmed).toBe(false);
    expect(sessionNoteEndConfirm(armed, 'live', 'match-1').confirmed).toBe(false);
    expect(sessionNoteEndConfirm(armed, 'kitted', undefined).confirmed).toBe(false);
    expect(sessionNoteEndConfirm(armed, 'kitted', 'match-2').confirmed).toBe(true);
    expect(sessionNoteEndConfirm(armed, undefined, 'match-2').confirmed).toBe(true);
    expect(sessionNoteEndConfirm(armed, 'kitted', 'match-1').confirmed).toBe(true);
    expect(sessionEndDeliveryTried(armed, 'other-match', 2000, true)).toEqual(armed);
  });
  it('sorts names by code point in the server WITHHELD line', () => {
    expect(sessionSayEndUnconfirmed(['alpha', 'ZED'])).toBe(
      '2 HUDS NEVER CONFIRMED THE END (ZED, alpha). MC TOLD THEM 7 TIMES. ' +
      'THOSE TAGGERS MAY STILL BE IN THE MATCH: END IT ON THOSE GUNS');
    const receipts = {
      first: sessionArmEndDelivery('match-1', 'a', 1000),
      second: sessionArmEndDelivery('match-1', 'z', 1000),
    };
    const players = [{ player_id: 'a', display: 'alpha' }, { player_id: 'z', display: 'ZED' }];
    expect(sessionEndDeliveryView(receipts, players as any, 2000)?.unconfirmed.map(row => row.display))
      .toEqual(['ZED', 'alpha']);
  });
  it('shows every HUD confirmed under ?mock&allgreen=1', async () => {
    const was = location.pathname + location.search;
    window.history.replaceState({}, '', '/?mock&allgreen=1&norandom=1');
    try {
      const state = await endedDemo();
      const delivery = state.end_delivery!;
      expect(delivery.confirmed).toBe(delivery.total);
      expect(delivery.unconfirmed).toEqual([]);
      expect(delivery.retrying).toBe(false);
      expect(state.recap?.missing).toEqual([]);
      expect(state.recap?.provisional).toBe(false);
      const screen = await mountScreen(<Recap />, { state, view: 'recap' });
      expect(screen.find('[data-testid="end-delivery-recap"][data-end-state="confirmed"]')).toHaveLength(1);
    } finally { window.history.replaceState({}, '', was); }
  });
  it('the normal demo resumes reporting before END and confirms delivery on RECAP', async () => {
    vi.useFakeTimers();
    const b = new MockBackend();
    try {
      await b.pushLobby(true); await b.start(0, true);
      await vi.advanceTimersByTimeAsync(22_000);
      const live = await b.getState();
      const reaper = live.live!.rows.find(r => r.display === 'REAPER')!;
      expect(reaper.status).toBe('alive');
      expect(reaper.possibly_protected).not.toBe(true);
      expect(live.recap?.missing).not.toContain(reaper.player_id);
      await b.control('end');
      const state = await b.getState();
      expect(state.end_delivery?.confirmed).toBe(state.end_delivery?.total);
      expect(state.end_delivery?.unconfirmed).toEqual([]);
      expect(state.recap?.missing).not.toContain(reaper.player_id);
      expect(state.recap?.missing).toContain(state.players.find(p => p.display === 'DRIFT')!.player_id);
    } finally { b.dispose(); vi.useRealTimers(); }
  });
  it('reads RE-DELIVERING right after the whistle, not a spent ladder', async () => {
    const was = location.pathname + location.search;
    window.history.replaceState({}, '', '/?mock&faults=1&norandom=1');
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

  it('reports again after the LIVE quiet spell and writes the late-confirmation line', async () => {
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
      await vi.advanceTimersByTimeAsync(18_000);
      const afterWait = await b.getState();
      const recap = afterWait.recap!;
      expect(afterWait.end_delivery?.confirmed).toBe(afterWait.end_delivery?.total);
      expect(afterWait.end_delivery?.retrying).toBe(false);
      expect(recap.awaiting).not.toContain(first.unconfirmed[0].player_id);
      expect(afterWait.feed.filter(e => e.tag === 'END').map(e => e.text)).toEqual([
        "REAPER'S HUD CONFIRMED THE END, 19S AFTER THE WHISTLE, ON DELIVERY 4",
      ]);
      await b.nextMatch();
      expect((await b.getState()).end_delivery?.match_id).toBe(first.match_id);
    } finally {
      b.dispose();
      vi.useRealTimers();
    }
  });
  it('writes the singular WITHHELD line once the retry ladder is spent', async () => {
    const was = location.pathname + location.search;
    window.history.replaceState({}, '', '/?mock&faults=1&norandom=1');
    vi.useFakeTimers();
    const b = new MockBackend();
    try {
      await b.pushLobby(true); await b.pushLobby(true); await b.start(0, true);
      await vi.advanceTimersByTimeAsync(2000);
      await b.control('end');
      await vi.advanceTimersByTimeAsync(140_000);
      const state = await b.getState();
      expect(state.end_delivery?.unconfirmed).toHaveLength(1);
      expect(state.end_delivery?.unconfirmed[0].tries).toBe(7);
      expect(state.end_delivery?.retrying).toBe(false);
      expect(state.feed.filter(e => e.tag === 'WITHHELD').map(e => e.text)).toEqual([
        '1 HUD NEVER CONFIRMED THE END (ONYX). MC TOLD IT 7 TIMES. ' +
        'THAT TAGGER MAY STILL BE IN THE MATCH: END IT ON THE GUN',
      ]);
    } finally { b.dispose(); vi.useRealTimers(); window.history.replaceState({}, '', was); }
  });
  it('arms a timed end at zero tries', async () => {
    vi.useFakeTimers();
    const b = new MockBackend();
    try {
      await b.putConfig({ time_limit_s: 60 });
      await b.pushLobby(true); await b.start(0, true);
      await vi.advanceTimersByTimeAsync(65_000);
      const receipts = Object.values((b as any).nodeReports).flatMap((r: any) => r.end ? [r.end] : []);
      expect(receipts.length).toBeGreaterThan(0);
      expect(receipts.every((r: any) => r.tries === 0)).toBe(true);
      expect((await b.getState()).phase).toBe('recap');
    } finally { b.dispose(); vi.useRealTimers(); }
  });
  it('waits five seconds after the timed limit before the whistle', async () => {
    vi.useFakeTimers();
    const b = new MockBackend();
    try {
      await b.putConfig({ time_limit_s: 60 });
      await b.pushLobby(true); await b.start(0, true);
      await vi.advanceTimersByTimeAsync(64_000);
      expect((await b.getState()).phase).toBe('live');
      await vi.advanceTimersByTimeAsync(1000);
      expect((await b.getState()).phase).toBe('recap');
    } finally { b.dispose(); vi.useRealTimers(); }
  });
  it('ends and scores a match during the ARMED countdown', async () => {
    vi.useFakeTimers();
    const b = new MockBackend();
    try {
      await b.pushLobby(true);
      const started = await b.start(10, true);
      const result = await b.control('end');
      const state = await b.getState();
      expect(result).toMatchObject({ ok: true, ended: true, phase: 'recap' });
      expect(state.phase).toBe('recap');
      expect(state.start).toBeNull();
      expect(state.recap?.played_s).toBe(0);
      expect(state.recap?.rows.every(row => row.kills === 0 && row.best_streak === 0)).toBe(true);
      expect(state.recap?.winner).toEqual({ team_id: null, tie: ['blue', 'yellow'] });
      expect(state.end_delivery?.match_id).toBe(started.match_id);
    } finally { b.dispose(); vi.useRealTimers(); }
  });
  it('arms and tries a HUD bound after the whistle on a second END', async () => {
    vi.useFakeTimers();
    const b = new MockBackend();
    try {
      await b.pushLobby(true); await b.start(0, true);
      await vi.advanceTimersByTimeAsync(2000); await b.control('end');
      const late = (b as any).players.find((p: any) => p.display === 'DRIFT');
      expect(late.node_id).toBeNull();
      late.node_id = 'node_22E8';
      (b as any).reportNode(late.node_id);
      await b.control('end');
      const row = (await b.getState()).end_delivery!.unconfirmed.find(r => r.player_id === late.player_id);
      expect(row).toMatchObject({ node_id: 'node_22E8', tries: 1, reached: true });
    } finally { b.dispose(); vi.useRealTimers(); }
  });
  it('tries END immediately when a returning HUD still reports the retired match LIVE', async () => {
    vi.useFakeTimers();
    const b = new MockBackend();
    try {
      await b.pushLobby(true); await b.start(0, true);
      await vi.advanceTimersByTimeAsync(2000); await b.control('end');
      const delivery = (await b.getState()).end_delivery!;
      const first = delivery.unconfirmed[0];
      (b as any).disconnectedNodes.add(first.node_id);
      (b as any).reportNode(first.node_id, Date.now(), { arm_state: 'live', match_id: delivery.match_id });
      const row = (await b.getState()).end_delivery!.unconfirmed.find(r => r.node_id === first.node_id)!;
      expect(row.tries).toBe(first.tries + 1);
      expect(row.reached).toBe(true);
      expect((b as any).nodeReports[first.node_id].end.next_t).toBe(Date.now() + 5000);
    } finally { b.dispose(); vi.useRealTimers(); }
  });
  it('reconciles retired matches after RECALL or ABORT and an older unnamed heartbeat', async () => {
    vi.useFakeTimers();
    try {
      for (const stop of ['recall', 'abort'] as const) {
        const b = new MockBackend();
        try {
          await b.pushLobby(true);
          const match = await b.start(10, true);
          if (stop === 'abort') await b.abort();
          else await b.control('recall');
          (b as any).reportNode('node_3D4F', Date.now(), { arm_state: 'live', match_id: match.match_id });
          expect((b as any).staleTold.get(`node_3D4F:${match.match_id}`)).toBe(Date.now());
        } finally { b.dispose(); }
      }
      const b = new MockBackend();
      try {
        await b.pushLobby(true); await b.start(0, true);
        await vi.advanceTimersByTimeAsync(2000); await b.control('end');
        (b as any).reportNode('node_3D4F', Date.now(), { arm_state: 'live' });
        expect((b as any).staleTold.get('node_3D4F:')).toBe(Date.now());
      } finally { b.dispose(); }
    } finally { vi.useRealTimers(); }
  });
  it('writes the exhausted delivery warning in the new session after NEXT MATCH', async () => {
    vi.useFakeTimers();
    const b = new MockBackend();
    try {
      await b.pushLobby(true); await b.start(0, true);
      await vi.advanceTimersByTimeAsync(2000); await b.control('end');
      await b.nextMatch();
      await vi.advanceTimersByTimeAsync(140_000);
      const state = await b.getState();
      expect(state.end_delivery?.unconfirmed).toHaveLength(1);
      expect(state.feed.filter(e => e.tag === 'WITHHELD').map(e => e.text)).toEqual([
        '1 HUD NEVER CONFIRMED THE END (REAPER). MC TOLD IT 7 TIMES. ' +
        'THAT TAGGER MAY STILL BE IN THE MATCH: END IT ON THE GUN',
      ]);
    } finally { b.dispose(); vi.useRealTimers(); }
  });
  it('a second END advances an unconfirmed receipt and resets its next retry', async () => {
    vi.useFakeTimers();
    const b = new MockBackend();
    try {
      await b.pushLobby(true); await b.start(0, true);
      await vi.advanceTimersByTimeAsync(2000); await b.control('end');
      const first = (await b.getState()).end_delivery!.unconfirmed[0];
      await vi.advanceTimersByTimeAsync(1000);
      await b.control('end');
      const second = (await b.getState()).end_delivery!.unconfirmed[0];
      expect(second.tries).toBe(2);
      const receipt = (b as any).nodeReports[first.node_id].end;
      expect(receipt.next_t).toBe(Date.now() + 5000);
      expect((await b.getState()).feed[0].text).toContain('END AGAIN:');
    } finally { b.dispose(); vi.useRealTimers(); }
  });
  it('keeps a confirmed player flushed after its node is evicted', async () => {
    vi.useFakeTimers();
    const b = new MockBackend();
    try {
      await b.pushLobby(true); await b.start(0, true);
      await vi.advanceTimersByTimeAsync(2000); await b.control('end');
      const before = await b.getState();
      const confirmed = before.players.find(p => p.node_id && p.display === 'VIPER')!;
      expect(before.recap?.missing).not.toContain(confirmed.player_id);
      await b.evictNode(confirmed.node_id!);
      const after = await b.getState();
      expect(after.recap?.missing).toEqual(before.recap?.missing);
      expect(after.recap?.provisional).toBe(before.recap?.provisional);
    } finally { b.dispose(); vi.useRealTimers(); }
  });
  it('counts the first simulated fact as flushed during LIVE', async () => {
    // norandom: the demo's own random kills during the advance would add fact players and make this flaky.
    const was = location.pathname + location.search;
    window.history.replaceState({}, '', '/?mock&norandom=1');
    vi.useFakeTimers();
    const b = new MockBackend();
    try {
      await b.pushLobby(true); await b.start(0, true);
      await vi.advanceTimersByTimeAsync(2000);
      (b as any).simKill('p2');
      const state = await b.getState();
      const factPlayers = state.live!.rows.filter(r => r.kills > 0 || r.deaths > 0).map(r => r.player_id);
      expect(factPlayers).toHaveLength(2);
      for (const id of factPlayers) expect(state.recap?.missing).not.toContain(id);
    } finally { b.dispose(); vi.useRealTimers(); window.history.replaceState({}, '', was); }
  });
  it('only checks players in the active scorer for missing facts', async () => {
    vi.useFakeTimers();
    const b = new MockBackend();
    try {
      await b.pushLobby(true); await b.start(0, true);
      await vi.advanceTimersByTimeAsync(2000);
      const late = await b.addPlayer({ display: 'LATE', team_id: 'blue' });
      expect((await b.getState()).recap?.missing).not.toContain(late.player_id);
    } finally { b.dispose(); vi.useRealTimers(); }
  });
  it('confirms a later post-whistle report outside the initial response list', async () => {
    const was = location.pathname + location.search;
    window.history.replaceState({}, '', '/?mock&faults=1&norandom=1');
    vi.useFakeTimers();
    const b = new MockBackend();
    try {
      await b.pushLobby(true); await b.pushLobby(true); await b.start(0, true);
      await vi.advanceTimersByTimeAsync(2000); await b.control('end');
      const before = (await b.getState()).end_delivery!;
      const onyx = before.unconfirmed.find(r => r.display === 'ONYX')!;
      (b as any).reportNode(onyx.node_id, Date.now(), { arm_state: 'kitted', match_id: before.match_id, pending: 0 });
      const after = (await b.getState()).end_delivery!;
      expect(after.unconfirmed.map(r => r.display)).not.toContain('ONYX');
      expect(after.confirmed).toBe(before.confirmed + 1);
      const reaper = after.unconfirmed.find(r => r.display === 'REAPER')!;
      (b as any).reportNode(reaper.node_id, Date.now(), { match_id: 'next-match' });
      expect((await b.getState()).end_delivery?.confirmed).toBe(after.total);
    } finally { b.dispose(); vi.useRealTimers(); window.history.replaceState({}, '', was); }
  });
  it('uses the push result when a quiet phone has dropped', async () => {
    vi.useFakeTimers();
    const b = new MockBackend();
    try {
      await b.pushLobby(true); await b.start(0, true);
      await vi.advanceTimersByTimeAsync(2000); await b.control('end');
      const quiet = (await b.getState()).end_delivery!.unconfirmed[0];
      (b as any).disconnectedNodes.add(quiet.node_id);
      await vi.advanceTimersByTimeAsync(2000);
      const after = (await b.getState()).end_delivery!.unconfirmed[0];
      expect(after.tries).toBe(2);
      expect(after.reached).toBe(false);
    } finally { b.dispose(); vi.useRealTimers(); }
  });
  it('arms a bound HUD without a node report', async () => {
    vi.useFakeTimers();
    const b = new MockBackend();
    try {
      await b.pushLobby(true); await b.start(0, true);
      await vi.advanceTimersByTimeAsync(2000);
      const player = (await b.getState()).players.find(p => p.display === 'VIPER')!;
      delete (b as any).nodeReports[player.node_id!];
      await b.control('end');
      const row = (await b.getState()).end_delivery!.unconfirmed.find(r => r.player_id === player.player_id)!;
      expect(row.tries).toBe(0);
      await vi.advanceTimersByTimeAsync(2000);
      const tried = (await b.getState()).end_delivery!.unconfirmed.find(r => r.player_id === player.player_id)!;
      expect(tried.tries).toBe(1);
      expect(tried.reached).toBe(false);
    } finally { b.dispose(); vi.useRealTimers(); }
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
