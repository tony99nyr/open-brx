// F208 (field 2026-09-13): a gun died while its status stayed byte-identical for 105 s, and the board
// showed a healthy player. The phone now says when the pool it reports is stale (`pool_stale`: `silent`
// or `no_fire`, with `pool_stale_ms`). The console shows a quiet grey cue on the LIVE row and the ARMORY
// readiness card. Grey, not amber: Tony wants fewer warnings. No claim, no cue.
import { describe, expect, it } from 'vitest';
import { poolStaleLabel } from '../src/api/derive';
import type { LiveRow, LiveView, ReadinessRow, State } from '../src/api/types';
import { Armory } from '../src/screens/Armory';
import { Live } from '../src/screens/Live';
import { StoreCtx } from '../src/store';
import { T } from '../src/tokens';
import { demo, makeStore, mount, mountScreen } from './harness';

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

describe('F208 · the stale-pool cue', () => {
  it('words the cue by reason, and says nothing without a claim', () => {
    expect(poolStaleLabel(undefined, 190_000), 'an age alone is not a claim').toBeNull();
    expect(poolStaleLabel(null)).toBeNull();
    expect(poolStaleLabel('silent', 185_000)).toBe('GUN SILENT 3m05s');
    expect(poolStaleLabel('silent')).toBe('GUN SILENT');
    expect(poolStaleLabel('no_fire', 4_000)).toBe('GUN NOT FIRING');
  });

  it('LIVE: a quiet grey cue on the stale rows only', async () => {
    const d = await demo();
    const rows = [row({ player_id: 'p1', display: 'VIPER', pool_stale: 'silent', pool_stale_ms: 185_000 }),
                  row({ player_id: 'p2', display: 'REAPER', pool_stale: 'no_fire', pool_stale_ms: 6_000 }),
                  row({ player_id: 'p3', display: 'GHOST' })];
    const state: State = { ...d.state, phase: 'live', live: liveView(rows) };
    const m = await mount(<StoreCtx.Provider value={makeStore({ ...d, state, view: 'live' })}><Live /></StoreCtx.Provider>);
    const cues = m.find('[data-gun-silent]');
    expect(cues.map(c => c.getAttribute('data-gun-silent'))).toEqual(['p1', 'p2']);
    expect(cues.map(c => c.textContent)).toEqual(['GUN SILENT 3m05s', 'GUN NOT FIRING']);
    for (const c of cues) expect(c.style.color, 'grey, never the warning colour').toBe(rgb(T.micro));
    expect(m.text(), 'the row still says ALIVE: the cue is information, not a verdict').toContain('ALIVE');
    m.unmount();
  });

  it('ARMORY: the readiness card shows it beside the gun link, and not without a claim', async () => {
    const d = await demo();
    const [first, second, ...rest] = d.state.readiness.board;
    const live = { node: 'linked', present: true, status: 'green', gun_linked: true, last_seen_age_ms: 2000 } as const;
    const board = [{ ...first, ...live, pool_stale: 'silent', pool_stale_ms: 190_000 } as ReadinessRow,
                   { ...second, ...live, pool_stale: null, pool_stale_ms: 190_000 } as ReadinessRow,
                   ...rest];
    const state: State = { ...d.state, readiness: { ...d.state.readiness, board } };
    const m = await mountScreen(<Armory />, { state, view: 'muster', weapons: d.weapons, perks: d.perks });
    const cues = m.find('[data-gun-silent]');
    expect(cues.map(c => c.getAttribute('data-gun-silent'))).toEqual([first.player_id]);
    expect(cues[0].textContent).toBe('GUN SILENT 3m10s');
    expect(cues[0].style.color).toBe(rgb(T.micro));
    m.unmount();
  });
});
