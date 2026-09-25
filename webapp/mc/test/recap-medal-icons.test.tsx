// Tony 2026-09-25: the RECAP draws the phone's medal and award icons (src/api/medalicons.gen.ts) beside MC's words,
// with a legend under FULL STATS. The LIVE screen draws none ("the in game alerts dont use the icons").
import { describe, expect, it } from 'vitest';
import { Live } from '../src/screens/Live';
import { Recap } from '../src/screens/Recap';
import { AWARDS, MEDALS } from '../src/api/contract.gen';
import type { Honor, RecapView, State } from '../src/api/types';
import { demo, mountScreen } from './harness';

const ROW = { team_id: 'blue', kills: 2, deaths: 1, assists: 0, shots: 20, hits: 8, accuracy: 40, kd: 2, streak: 0 };
// MC writes a row's medals as labels, a repeat as "LABEL ×N" (scoring.py rows())
const ROWS = [
  { ...ROW, player_id: 'p1', display: 'OP1', medals: MEDALS.map((m, i) => (i === 1 ? `${m.label} ×2` : m.label)) },
  { ...ROW, player_id: 'p2', display: 'OP2', medals: ['SOMETHING NEW'] },
];
const HONORS: Honor[] = AWARDS.map(a => ({ key: a.key, award: a.label, player_id: 'p1', stat: '1' }));

async function mountRecap() {
  const d = await demo();
  const recap: RecapView = { winner: { team_id: 'blue' }, score: {}, rows: ROWS, honors: HONORS, provisional: false, missing: [] };
  const state: State = { ...d.state, phase: 'recap', recap };
  return mountScreen(<Recap />, { ...d, state, view: 'recap' });
}

describe('RECAP medal icons', () => {
  it('every MEDALS and AWARDS key renders an icon with an accessible name, words kept beside it', async () => {
    const m = await mountRecap();
    const icons = m.find('[data-medal-icon]');
    for (const r of [...MEDALS, ...AWARDS]) {
      const mine = icons.filter(e => e.dataset.medalIcon === r.key && !e.closest('[data-testid="medal-legend"]'));
      expect(mine.length, `${r.key} icon`).toBeGreaterThan(0);
      expect(mine[0].querySelector('svg[role="img"]')?.getAttribute('aria-label'), r.key).toMatch(new RegExp(`^${r.label.replace(/[/]/g, '.')}`));
    }
    // MC shows the words beside every icon, so a screen reader must not read the name twice
    expect(icons.filter(e => e.getAttribute('aria-hidden') !== 'true').map(e => e.dataset.medalIcon), 'icons not aria-hidden').toEqual([]);
    const chips = m.find('[data-cell="medals"]')[0].textContent ?? '';
    expect(chips, 'the words stay beside the icons').toContain(MEDALS[0].label);
    expect(m.find('[data-medal-chip=""]').map(e => e.textContent), 'an unknown chip keeps its words, with no icon').toEqual(['SOMETHING NEW']);
    m.unmount();
  });
  it('a legend names every icon on the recap', async () => {
    const m = await mountRecap();
    const legend = m.find('[data-testid="medal-legend"] [data-legend]');
    for (const r of [...MEDALS, ...AWARDS]) {
      const item = legend.find(e => e.dataset.legend === r.key);
      expect(item, `${r.key} in the legend`).toBeTruthy();
      expect(item!.textContent, r.key).toContain(r.label);
      expect(item!.querySelector('svg'), `${r.key} legend icon`).toBeTruthy();
    }
    m.unmount();
  });
  it('the LIVE screen draws no medal icon', async () => {
    const d = await demo();
    const m = await mountScreen(<Live />, { ...d, view: 'live' });
    expect(m.find('[data-medal-icon], svg.mi').length).toBe(0);
    m.unmount();
  });
});
