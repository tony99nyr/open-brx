// F596 (brx1, from the renders): the strip icon and the SYNC cell of one row come from ONE display model, so they agree.
import { describe, expect, it } from 'vitest';
import { Recap } from '../src/screens/Recap';
import type { RecapSyncRow } from '../src/api/recapSync';
import type { RecapView, State } from '../src/api/types';
import { demo, mountScreen } from './harness';

const base = { kind: 'phone', team_id: 'blue', end_unconfirmed: false, idle_s: 0, stuck: false } as const;
const CASES: [string, Partial<RecapSyncRow>][] = [
  ['unlinked', { stage: 'unlinked', transport: null }],
  ['linked wifi', { stage: 'linked', transport: 'wifi' }],
  ['linked cellular', { stage: 'linked', transport: 'cellular' }],
  ['linked backhaul', { stage: 'linked', transport: 'backhaul' }],
  ['sending with a count', { stage: 'sending', transport: 'wifi', pending: 3 }],
  ['sending without a count', { stage: 'sending', transport: 'cellular' }],
  ['received', { stage: 'received' }],
  ['received with lost', { stage: 'received', lost: 4 }],
  ['END unconfirmed', { stage: 'received', end_unconfirmed: true }],
  ['stuck sending', { stage: 'sending', transport: 'wifi', pending: 3, stuck: true, idle_s: 300 }],
  ['stuck linked', { stage: 'linked', transport: 'wifi', stuck: true, idle_s: 300 }],
];

describe('the strip icon and the SYNC cell show one state per row', () => {
  it('agree on state, count and badges for every stage', async () => {
    const d = await demo();
    const rows = CASES.map(([, o], i) => ({ ...base, id: `p${i + 1}`, name: `NAME${i + 1}`, ...o }) as RecapSyncRow);
    const players = rows.map((r, i) => ({ ...d.state.players[0], player_id: r.id, player_num: i + 1, display: r.name, team_id: 'blue', node_id: `n${i}` }));
    const sc = rows.map(r => ({ player_id: r.id, display: r.name, team_id: 'blue', kills: 1, deaths: 1, assists: 0, shots: 1, shots_total: 1, hits: 1, accuracy: 50, kd: 1, streak: 0, medals: [], best_streak: 1, multi_best: 0, first_blood: false }));
    const recap = { winner: { team_id: 'blue' }, score: { blue: 1 }, rows: sc, honors: [], provisional: false, missing: [],
      sync: { pending: true, finalised: false, result_changed: false, rows } } as unknown as RecapView;
    const state: State = { ...d.state, phase: 'recap', players, recap };
    const m = await mountScreen(<Recap />, { ...d, state, view: 'recap', api: { matchHistory: async () => [] } });
    for (const [i, [label]] of CASES.entries()) {
      const id = `p${i + 1}`;
      const icon = m.find(`[data-strip-icon="${id}"]`)[0], cell = m.find(`[data-sync-cell="${id}"]`)[0];
      expect(icon, `${label}: strip icon`).toBeTruthy(); expect(cell, `${label}: cell`).toBeTruthy();
      expect(icon.dataset.state, `${label}: icon has a state`).toBeTruthy();
      expect(cell.dataset.state, `${label}: strip ${icon.dataset.state} vs cell ${cell.dataset.state}`).toBe(icon.dataset.state);
      const iconCount = icon.querySelector('[data-strip-count]')?.textContent ?? '';
      const cellCount = cell.querySelector('[data-sync-num]')?.textContent ?? '';
      expect(cellCount, `${label}: count`).toBe(iconCount);
      for (const [a, b] of [['[data-strip-lost]', '[data-sync-lost]'], ['[data-strip-end]', '[data-sync-end]'], ['[data-strip-transport]', '[data-sync-transport]']] as const)
        expect(cell.querySelectorAll(b).length, `${label}: ${b}`).toBe(icon.querySelectorAll(a).length);
      const moving = icon.querySelectorAll('[data-strip-motion]').length;
      expect(cell.dataset.motion ?? '0', `${label}: motion`).toBe(moving ? '1' : '0');
    }
    // the case from the render: a stuck sending row shows the same dim count in both, and does not move
    const stuck = CASES.findIndex(([l]) => l === 'stuck sending') + 1;
    expect(m.find(`[data-strip-icon="p${stuck}"] [data-strip-count]`)[0].textContent).toBe('3');
    expect(m.find(`[data-sync-cell="p${stuck}"] [data-sync-num]`)[0].textContent).toBe('3');
    m.unmount();
  });
});
