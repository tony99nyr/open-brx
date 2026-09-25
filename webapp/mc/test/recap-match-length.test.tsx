// Review finding (2026-09-13): the header on a just-finished match's own recap printed the match
// length with `fmtClock`, so "MATCH COMPLETE · TDM · 05:00" sat next to unpadded possession spans
// such as "7:21" on the same screen (see the comment above the header in Recap.tsx). `fmtClock` pads
// minutes for a value still counting down; a match length is a duration that is already over, so it
// must read the same unpadded way as every other span on this screen.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { Recap } from '../src/screens/Recap';
import type { MatchHistoryRow, RecapView, State } from '../src/api/types';
import { demo, mountScreen } from './harness';

const RECAP: RecapView = {
  winner: { team_id: 'blue' }, score: { blue: 3, yellow: 1 }, provisional: false, missing: [], honors: [],
  played_s: 300,
  rows: [{ player_id: 'p1', display: 'ALPHA', team_id: 'blue', kills: 3, deaths: 1, assists: 0,
    shots: 20, hits: 8, accuracy: 40, kd: 3, streak: 3, medals: [] }],
};

describe('RECAP — the header states the match length as a duration, not a clock', () => {
  it('prints an unpadded minute for a 5-minute match, not "05:00"', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'recap', recap: RECAP,
      config: { ...d.state!.config, time_limit_s: 300 } };
    const m = await mountScreen(<Recap />, { ...d, state, view: 'recap' });
    expect(m.text()).toMatch(/MATCH COMPLETE.*5:00/);
    expect(m.text()).not.toMatch(/05:00/);
    m.unmount();
  });

  it('an early finish reads m:ss OF the limit', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'recap', recap: { ...RECAP, played_s: 133 },
      config: { ...d.state!.config, time_limit_s: 300 } };
    const m = await mountScreen(<Recap />, { ...d, state, view: 'recap' });
    expect(m.text()).toMatch(/2:13 OF 5:00/);
    m.unmount();
  });

  // Polish round 2: an archived match read the CURRENT draft's limit, so a 5-minute match said OF 10:00.
  it('an archived match uses its own limit, not the current draft', async () => {
    const d = await demo();
    const rows = [{ match_id: 'old1', mode: 'tdm', go_live_t: 1, ended_t: Date.now() - 60_000,
      recap: { ...RECAP, played_s: 133 }, config: { time_limit_s: 300 } }] as unknown as MatchHistoryRow[];
    const state: State = { ...d.state, phase: 'recap', recap: RECAP, config: { ...d.state!.config, time_limit_s: 600 } };
    const m = await mountScreen(<Recap />, { ...d, state, view: 'recap', api: { matchHistory: async () => rows } });
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    const chip = (m.find('button') as HTMLButtonElement[]).find(b => /TDM/.test(b.textContent ?? '') && b.textContent !== null);
    await act(async () => { chip!.click(); });
    expect(m.text()).toMatch(/2:13 OF 5:00/);
    expect(m.text()).not.toMatch(/OF 10:00/);
    m.unmount();
  });
});
