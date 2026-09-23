// F289 (Tony, 2026-09-23): only the phone ends spawn protection, so a phone that dies inside the window
// leaves its gun unhittable. MC stamps `possibly_protected` on a STALE LIVE row whose newest evidence says
// the phone still owed that write; the console reads POSSIBLY PROTECTED · HITS MAY NOT COUNT, in amber.
import { describe, expect, it } from 'vitest';
import { possiblyProtectedLabel } from '../src/api/derive';
import type { LiveRow, LiveView, State } from '../src/api/types';
import { MockBackend } from '../src/mock/backend';
import { Live } from '../src/screens/Live';
import { StoreCtx } from '../src/store';
import { T } from '../src/tokens';
import { demo, makeStore, mount } from './harness';

const row = (over: Partial<LiveRow> = {}): LiveRow => ({
  player_id: 'p1', display: 'VIPER', team_id: 'blue',
  kills: 9, deaths: 3, assists: 2, shots: 40, hits: 14, accuracy: 35, kd: 3, streak: 0, medals: [],
  status: 'alive', sync_age_ms: 1200, respawn_in_s: null, ...over,
});
const liveView = (rows: LiveRow[]): LiveView => ({
  match_id: 'm1', go_live_t: Date.now() - 60_000, time_limit_s: 600,
  ends_t: Date.now() + 540_000, score: { blue: 9, yellow: 4 }, rows,
});
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe('F289 · POSSIBLY PROTECTED', () => {
  it('labels a stale row with the claim, and nothing else', () => {
    expect(possiblyProtectedLabel({ status: 'stale', possibly_protected: true })).toBe('POSSIBLY PROTECTED');
    expect(possiblyProtectedLabel({ status: 'stale' }), 'offline alone is not protected').toBeNull();
    expect(possiblyProtectedLabel({ status: 'alive', possibly_protected: true }), 'a phone MC hears is never flagged').toBeNull();
  });

  it('LIVE shows the amber cue on the stale, still-protected row only', async () => {
    const d = await demo();
    const rows = [row({ player_id: 'p1', display: 'VIPER', status: 'stale', sync_age_ms: 20_000, possibly_protected: true }),
                  row({ player_id: 'p2', display: 'GHOST', status: 'stale', sync_age_ms: 20_000 }),
                  row({ player_id: 'p3', display: 'REAPER', possibly_protected: true })];
    const state: State = { ...d.state, phase: 'live', live: liveView(rows) };
    const m = await mount(<StoreCtx.Provider value={makeStore({ ...d, state, view: 'live' })}><Live /></StoreCtx.Provider>);
    const cues = m.find('[data-possibly-protected]');
    expect(cues.map(c => c.getAttribute('data-possibly-protected'))).toEqual(['p1']);
    expect(cues[0].textContent).toBe('POSSIBLY PROTECTED · HITS MAY NOT COUNT');
    expect(cues[0].style.color).toBe(rgb(T.warn));
    m.unmount();
  });

  it('?mock shows it on the demo stale phone once the match is live', async () => {
    const b = new MockBackend();
    try {
      await b.pushLobby(true);
      await b.start(0, true);
      const live = (b as unknown as { goLive: () => void });
      live.goLive();
      const s = await b.getState();
      const flagged = (s.live?.rows ?? []).filter(r => r.possibly_protected);
      expect(flagged.length, 'the demo has one stale phone that went quiet protected').toBe(1);
      expect(flagged[0].status).toBe('stale');
    } finally { b.dispose(); }
  });
});
