// Polish review 2026-09-23 (RECAP and SPECTATE):
//  1. a KOTH RECAP headlined the kill score, unlabelled ("1 — -1"); it now headlines held time, or
//     labels the numbers KILLS when no held time was reported;
//  2. RECAP reached by URL during LIVE said MATCH COMPLETE and offered NEXT MATCH (the server 409s);
//  3. SPECTATE at 900 px wide squeezed its rows to about 20 px under the fit layout;
//  4. a negative K had no team-kill note on SPECTATE or RECAP;
//  5. RECAP opened at LIVE's scroll position.
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Recap } from '../src/screens/Recap';
import { Spectate, FIT_MIN_W } from '../src/screens/Spectate';
import type { LiveRow, LiveView, RecapView, State } from '../src/api/types';
import { StoreCtx } from '../src/store';
import { demo, makeStore, mount, mountScreen } from './harness';

const RECAP: RecapView = {
  winner: { undecided: 'objective' }, score: { blue: 1, yellow: -1 }, provisional: false, missing: [], honors: [],
  rows: [
    { player_id: 'p1', display: 'ALPHA', team_id: 'blue', kills: 1, deaths: 0, assists: 0, shots: 5, hits: 2, accuracy: 40, kd: 1, streak: 1, medals: [] },
    { player_id: 'p2', display: 'BRAVO', team_id: 'yellow', kills: -1, deaths: 1, assists: 0, shots: 5, hits: 1, accuracy: 20, kd: -1, streak: 0, medals: [] },
  ],
};
const HELD: NonNullable<RecapView['possession']> = { by_team: { blue: 95, yellow: 212 }, neutral_s: 0, sites: 1, reports: 2, observed_s: 300, of_s: 300 };

async function recap(over: Partial<State> = {}, rc: Partial<RecapView> = {}, objective = true) {
  const d = await demo();
  const cfg = d.state!.config;
  const state: State = { ...d.state!, phase: 'recap', recap: { ...RECAP, ...rc },
    config: { ...cfg, mode: objective ? 'koth' : 'tdm', scoring: { ...cfg.scoring, win_by: objective ? 'objective' : 'kills' } }, ...over };
  return mountScreen(<Recap />, { ...d, state, view: 'recap' });
}
const strip = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

describe('1 · a KOTH RECAP headlines held time', () => {
  it('shows HILL TIME per team, most held first, with the kill score as a labelled sub', async () => {
    const m = await recap({}, { possession: HELD });
    const h = m.find('[data-testid="recap-headline"]')[0];
    expect(h.dataset.headline).toBe('held');
    const t = strip(h.textContent ?? '');
    expect(t).toContain('HILL TIME');
    expect(t).toMatch(/3:32.*KILLS -1.*1:35.*KILLS 1/);
    expect(m.find('[data-headline-team]').map(e => e.dataset.headlineTeam)).toEqual(['yellow', 'blue']);
  });

  it('labels the numbers KILLS when no held time was reported', async () => {
    const m = await recap();
    const h = m.find('[data-testid="recap-headline"]')[0];
    expect(h.dataset.headline).toBe('kills');
    expect(strip(h.textContent ?? '')).toContain('KILLS');
  });

  it('leaves a kill-scored match as it was', async () => {
    const m = await recap({}, { possession: HELD, winner: { team_id: 'blue' } }, false);
    const h = m.find('[data-testid="recap-headline"]')[0];
    expect(h.dataset.headline).toBe('kills');
    expect(strip(h.textContent ?? '')).not.toContain('KILLS');
  });
});

describe('2 · RECAP during LIVE is not a finished match', () => {
  for (const phase of ['live', 'armed'] as const) {
    it(`says IN PLAY · PROVISIONAL and hides NEXT MATCH while ${phase}`, async () => {
      const m = await recap({ phase });
      expect(m.find('[data-testid="recap-status"]')[0].textContent).toBe('IN PLAY · PROVISIONAL');
      expect(strip(m.text())).not.toContain('MATCH COMPLETE');
      expect(m.find('[data-testid="recap-next-match"]').length).toBe(0);
    });
  }

  it('still says MATCH COMPLETE and offers NEXT MATCH in recap', async () => {
    const m = await recap();
    expect(m.find('[data-testid="recap-status"]')[0].textContent).toBe('MATCH COMPLETE');
    expect(m.find('[data-testid="recap-next-match"]').length).toBe(1);
  });
});

describe('4 · a negative K carries the team-kill note', () => {
  it('RECAP says why K is below zero', async () => {
    const m = await recap();
    expect(strip(m.find('[data-testid="team-kill-note"]')[0]?.textContent ?? '')).toContain('A TEAM KILL COSTS THE SHOOTER ONE KILL');
  });
  it('RECAP says nothing when no K is below zero', async () => {
    const m = await recap({}, { rows: [RECAP.rows[0]] });
    expect(m.find('[data-testid="team-kill-note"]').length).toBe(0);
  });
});

describe('5 · RECAP opens at the top', () => {
  it('scrolls its scrolled ancestor back to the top on mount', async () => {
    const d = await demo();
    const state: State = { ...d.state!, phase: 'recap', recap: RECAP };
    const store = makeStore({ ...d, state, view: 'recap' });
    // jsdom keeps no scroll offset, so give the container one that it does keep
    let top = 640;
    const host = document.createElement('main');
    Object.defineProperty(host, 'scrollTop', { get: () => top, set: v => { top = v; }, configurable: true });
    document.body.appendChild(host);
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(host);
    await act(async () => { root.render(<StoreCtx.Provider value={store}><Recap /></StoreCtx.Provider>); });
    expect(top).toBe(0);
    act(() => { root.unmount(); });
    host.remove();
  });
});

// SPECTATE ------------------------------------------------------------------------------------------

const JSDOM_VP = { w: 1024, h: 768 };
async function resizeTo(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true, writable: true });
  await act(async () => { window.dispatchEvent(new Event('resize')); });
}
afterEach(async () => { await resizeTo(JSDOM_VP.w, JSDOM_VP.h); });

const liveRow = (i: number, kills: number): LiveRow => ({
  player_id: `p${i}`, display: `OPERATOR ${i}`, team_id: i % 2 ? 'yellow' : 'blue',
  kills, deaths: 1, assists: 0, shots: 10, hits: 3, accuracy: 30, kd: kills, streak: 0,
  best_streak: 1, medals: [], status: 'alive', sync_age_ms: 1000, respawn_in_s: null,
});
async function spectate(rows: LiveRow[]) {
  const d = await demo();
  const live: LiveView = { match_id: 'm1', go_live_t: Date.now() - 60_000, time_limit_s: 600,
    ends_t: Date.now() + 540_000, score: { blue: 4, yellow: 3 }, rows };
  const state: State = { ...d.state!, phase: 'live', live };
  const store = makeStore({ ...d, state, view: 'live' });
  return mount(<StoreCtx.Provider value={store}><Spectate /></StoreCtx.Provider>);
}

describe('3 · SPECTATE rows stay readable', () => {
  const eight = () => Array.from({ length: 8 }, (_, i) => liveRow(i, 8 - i));

  it('turns the fit layout off at 900 px wide, so the page scrolls instead of squeezing rows', async () => {
    await resizeTo(900, 800);
    const m = await spectate(eight());
    const frame = m.find('[data-spectate="board"]')[0];
    expect(frame.style.height, 'no one-viewport clip at 900 px').toBe('');
    expect(frame.style.minHeight).toBe('100vh');
    for (const r of m.find('[data-spectate="row"]')) expect(r.style.minHeight, 'a row is sized by its content').toBe('');
    m.unmount();
  });

  it('under the fit layout, a row may shrink but not below its own text', async () => {
    await resizeTo(FIT_MIN_W, 768);
    const m = await spectate(eight());
    expect(m.find('[data-spectate="board"]')[0].style.height).toBe('100vh');
    const rows = m.find('[data-spectate="row"]');
    expect(rows.length).toBe(8);
    for (const r of rows) {
      const min = parseFloat(r.style.minHeight);
      const k = parseFloat(getComputedStyle(r.children[1] as HTMLElement).fontSize);
      expect(min, `row min-height ${r.style.minHeight} vs K type ${k}px`).toBeGreaterThanOrEqual(k * 1.3);
    }
    m.unmount();
  });

  it('carries the team-kill note when a K is below zero', async () => {
    const m = await spectate([liveRow(0, 2), liveRow(1, -1)]);
    const note = m.find('[data-spectate="team-kill-note"]')[0];
    expect(strip(note?.textContent ?? '')).toContain('A TEAM KILL COSTS THE SHOOTER ONE KILL');
    expect(parseFloat(getComputedStyle(note).fontSize), 'nothing on the board under 16 px').toBeGreaterThanOrEqual(16);
    m.unmount();
    const clean = await spectate([liveRow(0, 2)]);
    expect(clean.find('[data-spectate="team-kill-note"]').length).toBe(0);
    clean.unmount();
  });
});
