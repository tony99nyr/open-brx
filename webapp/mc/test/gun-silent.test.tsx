// F208 (field 2026-09-13): a gun died while its status stayed byte-identical for 105 s, and the board
// showed a healthy player. The phone now says when the pool it reports is stale (`pool_stale`: `silent`
// or `no_fire`, with `pool_stale_ms`). The console shows a quiet grey cue on the LIVE row and the ARMORY
// readiness card. Grey, not amber: Tony wants fewer warnings. No claim, no cue.
//
// F264 (field 2026-09-18): the node now probes a `pool_stale` gun itself and reports its own outcome
// (`cure`: `asking` / `dead` / `alive` / `no_answer`), beside the same cue. `no_answer` is the one case
// that needs a human, so it alone renders in the warning colour.
import { describe, expect, it } from 'vitest';
import { cureLabel, gunLockedLabel, poolStaleLabel } from '../src/api/derive';
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
    expect(poolStaleLabel('write_lost', 1_000), 'pl4: a lost spawn or revive write').toBe('GUN WRITE LOST');
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
    expect(cues[0].style.color).toBe(rgb(T.dim));
    m.unmount();
  });
});

describe('F264 · the node cure cue', () => {
  it('words the cue by verdict, says nothing while asking or without a claim, and warns on no_answer', () => {
    expect(cureLabel(undefined), 'no claim, no cue').toBeNull();
    expect(cureLabel(null)).toBeNull();
    expect(cureLabel('asking'), 'a probe in flight is not yet news').toBeNull();
    expect(cureLabel('dead')).toBe('NODE FOUND IT DEAD');
    expect(cureLabel('alive')).toBe('NODE RE-ARMED IT');
    expect(cureLabel('no_answer')).toBe('GUN NOT ANSWERING: FORCE RESPAWN');
  });

  it('LIVE: the cure cue sits beside the stale cue, and no_answer alone is a warning', async () => {
    const d = await demo();
    const rows = [row({ player_id: 'p1', display: 'VIPER', pool_stale: 'silent', pool_stale_ms: 185_000, cure: 'no_answer' }),
                  row({ player_id: 'p2', display: 'REAPER', pool_stale: 'silent', pool_stale_ms: 6_000, cure: 'dead' }),
                  row({ player_id: 'p3', display: 'GHOST', cure: 'asking' }),
                  row({ player_id: 'p4', display: 'WRAITH' })];
    const state: State = { ...d.state, phase: 'live', live: liveView(rows) };
    const m = await mount(<StoreCtx.Provider value={makeStore({ ...d, state, view: 'live' })}><Live /></StoreCtx.Provider>);
    const cues = m.find('[data-gun-cure]');
    expect(cues.map(c => c.getAttribute('data-gun-cure')), 'GHOST is asking, WRAITH has not claimed either').toEqual(['p1', 'p2']);
    // F221 (2026-09-25): mid-match, a gun that stopped answering is RED (act now), with the ▲ glyph.
    expect(cues.map(c => c.textContent)).toEqual(['▲ GUN NOT ANSWERING: FORCE RESPAWN', 'NODE FOUND IT DEAD']);
    expect(cues[0].style.color, 'no_answer is the one case that needs a human, now RED mid-match').toBe(rgb(T.bad));
    expect(cues[1].style.color, 'a resolved verdict stays quiet').toBe(rgb(T.micro));
    m.unmount();
  });

  it('ARMORY: the readiness card shows it beside the gun link, no_answer in the warning colour', async () => {
    const d = await demo();
    const [first, second, ...rest] = d.state.readiness.board;
    const live = { node: 'linked', present: true, status: 'green', gun_linked: true, last_seen_age_ms: 2000 } as const;
    const board = [{ ...first, ...live, cure: 'no_answer' } as ReadinessRow,
                   { ...second, ...live, cure: null } as ReadinessRow,
                   ...rest];
    const state: State = { ...d.state, readiness: { ...d.state.readiness, board } };
    const m = await mountScreen(<Armory />, { state, view: 'muster', weapons: d.weapons, perks: d.perks });
    const cues = m.find('[data-gun-cure]');
    expect(cues.map(c => c.getAttribute('data-gun-cure'))).toEqual([first.player_id]);
    expect(cues[0].textContent).toBe('▲ GUN NOT ANSWERING: FORCE RESPAWN');
    expect(cues[0].style.color).toBe(rgb(T.warn));
    m.unmount();
  });
});

describe('F272 · the positive gun lock-up verdict', () => {
  it('renders only literal true and gives the operator the power-cycle action', () => {
    expect(gunLockedLabel(true)).toBe('GUN STOPPED: TELL THE PLAYER TO POWER-CYCLE IT');
    expect(gunLockedLabel(false)).toBeNull();
    expect(gunLockedLabel(null)).toBeNull();
    expect(gunLockedLabel(undefined)).toBeNull();
  });

  it('LIVE shows a current verdict prominently and suppresses a stale row', async () => {
    const d = await demo();
    const rows = [row({ player_id: 'p1', display: 'VIPER', gun_locked: true } as Partial<LiveRow>),
                  row({ player_id: 'p2', display: 'GHOST', status: 'stale', sync_age_ms: 20_000, gun_locked: true } as Partial<LiveRow>)];
    const state: State = { ...d.state, phase: 'live', live: liveView(rows) };
    const m = await mount(<StoreCtx.Provider value={makeStore({ ...d, state, view: 'live' })}><Live /></StoreCtx.Provider>);
    const cues = m.find('[data-gun-locked]');
    expect(cues.map(c => c.getAttribute('data-gun-locked'))).toEqual(['p1']);
    // F221 (2026-09-25): RED carries the ▲ glyph.
    expect(cues[0].textContent).toBe('▲ GUN STOPPED: TELL THE PLAYER TO POWER-CYCLE IT');
    expect(cues[0].style.color).toBe(rgb(T.bad));
    expect(cues[0].getAttribute('role')).toBe('alert');
    expect(cues[0].closest('button, [role="button"]'), 'the urgent alert stays exposed in the accessibility tree').toBeNull();
    expect(m.find('[data-live-row-toggle="p1"]')[0].getAttribute('aria-label')).toBe('VIPER operator actions');
    m.unmount();
  });

  it('ARMORY shows a current verdict and suppresses stale and disconnected cards', async () => {
    const d = await demo();
    const [current, stale, offline, ...rest] = d.state.readiness.board;
    const board = [
      { ...current, node: 'linked', present: true, reach: 'lan', status: 'green', last_seen_age_ms: 2_000, gun_locked: true },
      { ...stale, node: 'linked', present: true, reach: 'lan', status: 'amber', last_seen_age_ms: 9_000,
        ambers: ['STALE LINK (9S)'], gun_locked: true },
      { ...offline, node: 'linked', present: true, reach: null, status: 'green', last_seen_age_ms: 2_000, gun_locked: true },
      ...rest,
    ] as ReadinessRow[];
    const state: State = { ...d.state, readiness: { ...d.state.readiness, board } };
    const m = await mountScreen(<Armory />, { state, view: 'muster', weapons: d.weapons, perks: d.perks });
    const cues = m.find('[data-gun-locked]');
    expect(cues.map(c => c.getAttribute('data-gun-locked'))).toEqual([current.player_id]);
    expect(cues[0].textContent).toBe('▲ GUN STOPPED: TELL THE PLAYER TO POWER-CYCLE IT');
    expect(cues[0].style.color).toBe(rgb(T.bad));
    m.unmount();
  });
});
