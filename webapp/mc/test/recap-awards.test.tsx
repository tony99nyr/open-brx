// A63: the recap's honours are keyed by the AWARDS `key`. A shared award renders one card per holder, and the
// colour follows the key (IRON MAN, WINGMAN and OBJECTIVE HERO have their own), with the label as the
// fallback for a recap stored before A63.
import { describe, expect, it } from 'vitest';
import { Recap } from '../src/screens/Recap';
import type { Honor, RecapView, State } from '../src/api/types';
import { demo, mountScreen } from './harness';

const ROWS = ['p1', 'p2', 'p3'].map((id, i) => ({ player_id: id, display: `OP${i}`, team_id: 'blue', kills: 2, deaths: 1,
  assists: 0, shots: 20, hits: 8, accuracy: 40, kd: 2, streak: 0, medals: [] }));

async function mount(honors: Honor[]) {
  const d = await demo();
  const recap: RecapView = { winner: { team_id: 'blue' }, score: {}, rows: ROWS, honors, provisional: false, missing: [] };
  const state: State = { ...d.state, phase: 'recap', recap };
  return mountScreen(<Recap />, { ...d, state, view: 'recap' });
}

const labelColour = (m: Awaited<ReturnType<typeof mount>>, label: string) =>
  m.find('span').filter(s => s.textContent === label && !s.hasAttribute('data-medal-icon') && !s.closest('[data-testid="medal-legend"]'))
    .map(s => (s as HTMLElement).style.color);

describe('RECAP honours (A63)', () => {
  it('colours IRON MAN, WINGMAN and OBJECTIVE HERO by key, and an old label-only MVP still by label', async () => {
    const m = await mount([
      { key: 'iron_man', award: 'IRON MAN', player_id: 'p1', stat: 'FEWEST DEATHS · 1' },
      { key: 'wingman', award: 'WINGMAN', player_id: 'p2', stat: '2 ASSISTS' },
      { key: 'objective_hero', award: 'OBJECTIVE HERO', player_id: 'p3', stat: 'IN RANGE · 1:42' },
      { award: 'MVP', player_id: 'p1', stat: '2 K' },
    ]);
    const acc = 'rgb(57, 180, 255)';           // T.acc, the no-colour default
    for (const label of ['IRON MAN', 'WINGMAN', 'OBJECTIVE HERO']) {
      const c = labelColour(m, label);
      expect(c.length, `${label} card`).toBe(1);
      expect(c[0], label).not.toBe(acc);
    }
    expect(labelColour(m, 'MVP')).toEqual(['rgb(255, 210, 63)']);
    m.unmount();
  });

  it('a shared MVP renders one card per holder', async () => {
    const m = await mount([
      { key: 'mvp', award: 'MVP', player_id: 'p1', stat: '2 K' },
      { key: 'mvp', award: 'MVP', player_id: 'p2', stat: '2 K' },
    ]);
    expect(labelColour(m, 'MVP').length).toBe(2);
    m.unmount();
  });
});
