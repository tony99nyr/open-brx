// F596 + F597 (Tony 2026-10-24): RECAP's sync strip, the RESULTS PENDING header, FINALISE and the SYNC column.
// The server decides everything (`recap.sync`, mcp `Session._recap_sync`); these tests assert what a person SEES for
// each server answer, and that a recap with no `sync` (an archived match, an older MC) renders exactly as it did.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Recap } from '../src/screens/Recap';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import type { Honor, RecapView, ScoreRow, State } from '../src/api/types';
import type { RecapSyncRow } from '../src/api/recapSync';
import { demo, makeStore, mount, mountScreen } from './harness';

const strip = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();
const NAMES = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'];

/** `rows` is in KILL order (BRAVO leads), the roster is ALPHA..DELTA: the two orders differ on purpose. */
const score = (id: string, display: string, kills: number): ScoreRow => ({ player_id: id, display, team_id: id === 'p1' || id === 'p3' ? 'blue' : 'yellow', kills, deaths: 1,
  assists: 0, shots: 20, shots_total: 20, hits: 8, accuracy: 40, kd: kills, streak: kills, medals: [], best_streak: kills, multi_best: 0, first_blood: false });
const ROWS = [score('p2', 'BRAVO', 9), score('p4', 'DELTA', 6), score('p1', 'ALPHA', 4), score('p3', 'CHARLIE', 2)];
const HONOR: Honor = { award: 'MVP', key: 'mvp', player_id: 'p2', stat: '9 K' };
const phone = (id: string, over: Partial<RecapSyncRow> = {}): RecapSyncRow => ({ kind: 'phone', id, name: NAMES[Number(id.slice(1)) - 1], team_id: 'blue',
  stage: 'received', transport: null, end_unconfirmed: false, idle_s: 0, stuck: false, ...over });
const STATION: RecapSyncRow = { kind: 'station', id: '1', name: 'HILL 1', team_id: null, stage: 'unlinked', transport: null, end_unconfirmed: false, idle_s: 20, stuck: false };

interface SyncOver { pending?: boolean; finalised?: boolean; result_changed?: boolean }
const syncOf = (rows: RecapSyncRow[], o: SyncOver = {}) => ({ pending: o.pending ?? rows.some(r => r.stage !== 'received'), finalised: o.finalised ?? false,
  result_changed: o.result_changed ?? false, rows });

async function stateWith(sync: unknown, rc: Partial<RecapView> = {}) {
  const d = await demo();
  const players = NAMES.map((display, i) => ({ ...d.state.players[0], player_id: `p${i + 1}`, player_num: i + 1, display, team_id: i % 2 ? 'yellow' : 'blue', node_id: `n${i + 1}` }));
  const recap = { winner: { team_id: 'blue' }, score: { blue: 6, yellow: 15 }, rows: ROWS, honors: [HONOR], provisional: false, missing: [], played_s: 300,
    ...(sync ? { sync } : {}), ...rc } as unknown as RecapView;
  const state: State = { ...d.state, phase: 'recap', players, recap, config: { ...d.state.config, time_limit_s: 300 } };
  return { d, state };
}
async function recapOf(sync: unknown, rc: Partial<RecapView> = {}, api: Record<string, unknown> = {}) {
  const { d, state } = await stateWith(sync, rc);
  return mountScreen(<Recap />, { ...d, state, view: 'recap', api: { matchHistory: async () => [], ...api } });
}
const cell = (m: { find(s: string): HTMLElement[] }, id: string, k: string) =>
  (m.find(`[data-sync-row="${id}"] [data-cell="${k}"]`)[0]?.textContent ?? '').trim();

afterEach(() => { vi.useRealTimers(); });

describe('F596 · results pending: nothing that names a winner', () => {
  const pendingRows = [phone('p1'), phone('p2', { stage: 'sending', pending: 4, transport: 'wifi' }), phone('p3', { stage: 'unlinked' }), phone('p4')];

  it('the header says RESULTS PENDING and how many phones are missing, with a small FINALISE', async () => {
    const m = await recapOf(syncOf(pendingRows));
    expect(strip(m.find('[data-testid="results-pending"]')[0].textContent ?? '')).toBe('RESULTS PENDING');
    expect(strip(m.find('[data-testid="waiting-for"]')[0].textContent ?? '')).toBe('WAITING FOR 2 PHONES');
    expect(m.find('[data-testid="finalise"]').length).toBe(1);
    m.unmount();
  });

  it('hides the winner, the team score, HONORS, PLAY AGAIN and EXPORT CSV', async () => {
    const m = await recapOf(syncOf(pendingRows), { possession: { by_team: { blue: 100, yellow: 50 }, neutral_s: 0, sites: 1, reports: 1, observed_s: 300, of_s: 300 } });
    const t = strip(m.text());
    expect(t).not.toMatch(/WINS|LEADS/);
    expect(m.find('[data-testid="recap-headline"]').length, 'no team score').toBe(0);
    expect(t).not.toContain('HONORS');
    expect(m.find('[data-testid="recap-next-match"]').length, 'no PLAY AGAIN').toBe(0);
    expect(m.find('a[download]').length, 'no EXPORT CSV').toBe(0);
    expect(m.find('[data-testid="possession"]').length, 'no hold time').toBe(0);
    expect(m.find('[data-medal-chip="mvp"]').length, 'and no MVP medal chip on a row').toBe(0);
    m.unmount();
  });

  it('FULL STATS stays: a received player shows their numbers, an unreceived one is greyed', async () => {
    const m = await recapOf(syncOf(pendingRows));
    expect(cell(m, 'p1', 'k')).toBe('4');
    expect(cell(m, 'p2', 'k'), 'the numbers of a phone still sending are shown too').toBe('9');
    const dim = (id: string) => Number(m.find(`[data-sync-row="${id}"]`)[0].style.opacity || 1);
    expect(m.find('[data-sync-row="p1"]')[0].dataset.unverified, 'a received player is normal').toBeUndefined();
    expect(dim('p1')).toBe(1);
    expect(m.find('[data-sync-row="p2"]')[0].dataset.unverified).toBe('1');
    expect(dim('p2'), 'sending: dim').toBeLessThan(0.6);
    expect(dim('p3'), 'unlinked: dim').toBeLessThan(0.6);
    expect(m.find('[data-cell][data-pending]').length, 'no all-dash cells').toBe(0);
    m.unmount();
  });

  it('keeps ROSTER order while pending, and the kill order returns when the wait ends', async () => {
    const order = (m: { find(s: string): HTMLElement[] }) => m.find('[data-recap-name]').map(e => e.dataset.recapName);
    const pending = await recapOf(syncOf(pendingRows));
    expect(order(pending), 'roster order: no partial ranking').toEqual(['p1', 'p2', 'p3', 'p4']);
    pending.unmount();
    const done = await recapOf(syncOf(pendingRows, { pending: false, finalised: true }));
    expect(order(done), 'kill order').toEqual(['p2', 'p4', 'p1', 'p3']);
    done.unmount();
  });

  it('a received player\'s kills rise in place when a victim\'s phone syncs, with no flag', async () => {
    const { d, state } = await stateWith(syncOf(pendingRows));
    const base = makeStore({ ...d, state, view: 'recap', api: { matchHistory: async () => [] } });
    const m = await mount(<StoreCtx.Provider value={{ ...base, state }}><Recap /></StoreCtx.Provider>);
    expect(cell(m, 'p1', 'k')).toBe('4');
    const next = { ...state, recap: { ...state.recap!, rows: ROWS.map(r => (r.player_id === 'p1' ? { ...r, kills: 6 } : r)) } as RecapView };
    await m.update(<StoreCtx.Provider value={{ ...base, state: next }}><Recap /></StoreCtx.Provider>);
    expect(cell(m, 'p1', 'k')).toBe('6');
    expect(m.find('[data-sync-row="p1"]')[0].dataset.unverified).toBeUndefined();
    m.unmount();
  });

  it('the SYNC column is the LAST column and carries the strip\'s icons, one per player row', async () => {
    const m = await recapOf(syncOf([phone('p1'), phone('p2', { stage: 'sending', pending: 4, transport: 'wifi' }), phone('p3', { stage: 'unlinked' }), phone('p4', { lost: 2 })]));
    const heads = m.find('[data-col-head]').map(e => e.dataset.colHead);
    expect(heads[heads.length - 1]).toBe('sync');
    expect(m.find('[data-sync-cell="p1"][data-stage="received"]').length).toBe(1);
    expect(m.find('[data-sync-cell="p2"] [data-sync-num]')[0].textContent, 'the count of a sending phone').toBe('4');
    expect(m.find('[data-sync-cell="p3"][data-stage="unlinked"]').length).toBe(1);
    expect(m.find('[data-sync-cell="p4"] [data-sync-lost]').length, 'the lost badge').toBe(1);
    expect(m.find('[data-testid="sync-strip"]').length, 'the strip stays above the table too').toBe(1);
    m.unmount();
  });
});

describe('F596 · FINALISE', () => {
  const rows = [phone('p1'), phone('p2', { stage: 'linked', transport: 'wifi' })];
  it('takes two taps: the first arms it and posts nothing, the second posts', async () => {
    const finaliseRecap = vi.fn(async () => ({ ok: true }));
    const m = await recapOf(syncOf(rows), {}, { finaliseRecap });
    const btn = () => m.find('[data-testid="finalise"]')[0] as HTMLButtonElement;
    expect(btn().textContent).toBe('FINALISE');
    await m.click('FINALISE');
    expect(btn().textContent).toBe('TAP AGAIN TO FINALISE');
    expect(finaliseRecap).not.toHaveBeenCalled();
    await m.click('TAP AGAIN');
    expect(finaliseRecap).toHaveBeenCalledTimes(1);
    m.unmount();
  });

  it('shows the server\'s error when the post fails, and does not swallow it', async () => {
    const finaliseRecap = vi.fn(async () => { throw new Error('no match in RECAP to finalise'); });
    const m = await recapOf(syncOf(rows), {}, { finaliseRecap });
    await m.click('FINALISE'); await m.click('TAP AGAIN');
    expect(m.find('[data-testid="finalise-error"]')[0]?.textContent).toBe('no match in RECAP to finalise');
    expect(m.find('[data-testid="finalise"]').length, 'the button is still there to try again').toBe(1);
    m.unmount();
  });

  it('is plain until a row is stuck, then amber and prominent', async () => {
    const plain = await recapOf(syncOf(rows));
    expect(plain.find('[data-testid="finalise"]')[0].dataset.prominent).toBeUndefined();
    plain.unmount();
    const stuck = await recapOf(syncOf([phone('p1'), phone('p2', { stage: 'linked', transport: 'wifi', stuck: true, idle_s: 200 })]));
    const b = stuck.find('[data-testid="finalise"]')[0];
    expect(b.dataset.prominent).toBe('1');
    expect(b.style.background, 'amber fill').not.toBe('transparent');
    stuck.unmount();
  });

  it('after FINALISE with a phone missing: the winner plus one short FINAL WITHOUT line', async () => {
    const m = await recapOf(syncOf(rows, { pending: false, finalised: true }));
    expect(strip(m.text())).toMatch(/WINS/);
    expect(strip(m.find('[data-testid="final-without"]')[0].textContent ?? '')).toBe('FINAL WITHOUT 1 PHONE (BRAVO)');
    expect(m.find('[data-testid="results-pending"]').length).toBe(0);
    expect(m.find('[data-testid="recap-next-match"]').length, 'PLAY AGAIN is back').toBe(1);
    m.unmount();
  });

  it('RESULT CHANGED shows under the winner only when the server says so', async () => {
    const m = await recapOf(syncOf([phone('p1'), phone('p2')], { result_changed: true }));
    expect(m.find('[data-testid="result-changed"]')[0]?.textContent).toBe('RESULT CHANGED');
    m.unmount();
    const none = await recapOf(syncOf([phone('p1'), phone('p2')]));
    expect(none.find('[data-testid="result-changed"]').length).toBe(0);
    none.unmount();
  });
});

describe('F597 · the strip', () => {
  it('draws one generic icon per phone with no names, a diamond for a station, and the stage on each', async () => {
    const m = await recapOf(syncOf([phone('p1'), phone('p2', { stage: 'sending', pending: 3, transport: 'cellular' }), phone('p3', { stage: 'linked', transport: 'wifi' }),
      phone('p4', { stage: 'unlinked' }), STATION]));
    expect(m.find('[data-strip-icon][data-kind="phone"]').length).toBe(4);
    expect(m.find('[data-strip-icon][data-kind="station"]').length).toBe(1);
    const strip_ = m.find('[data-testid="sync-strip"]')[0];
    for (const n of NAMES) expect(strip_.textContent, `${n} is not written on the strip`).not.toContain(n);
    expect(m.find('[data-strip-icon="p1"] [data-strip-tick]').length, 'received: a check').toBe(1);
    expect(m.find('[data-strip-icon="p2"] [data-strip-transport="cellular"]').length, 'linked: a transport badge').toBe(1);
    expect(m.find('[data-strip-icon="p2"] [data-strip-label]')[0].textContent, 'sending: the count').toBe('3');
    expect(m.find('[data-strip-icon="p4"] [data-strip-unlinked]').length).toBe(1);
    expect(m.find('[data-strip-icon="1"][data-kind="station"] [data-strip-unlinked]').length, 'an unsynced hill station').toBe(1);
    m.unmount();
  });

  it('only a SENDING row moves; received and linked icons are still; there is no progress bar anywhere', async () => {
    const m = await recapOf(syncOf([phone('p1'), phone('p2', { stage: 'sending', pending: 3, transport: 'wifi' }), phone('p3', { stage: 'linked', transport: 'wifi' }), phone('p4', { stage: 'unlinked' })]));
    expect(m.find('[data-strip-icon="p2"] [data-strip-motion]').length).toBe(1);
    for (const id of ['p1', 'p3', 'p4']) expect(m.find(`[data-strip-icon="${id}"] [data-strip-motion], [data-strip-icon="${id}"] .sb-ring`).length, id).toBe(0);
    expect(m.find('progress, [role="progressbar"]').length).toBe(0);
    m.unmount();
    const css = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');
    expect(css, 'reduced motion switches every strip animation off').toMatch(/prefers-reduced-motion: reduce\)\{\s*\.sb-dot,\.sb-ring\{animation:none\}/);
  });

  it('lost facts and END not confirmed are corner badges on the icon', async () => {
    const m = await recapOf(syncOf([phone('p1', { lost: 5, end_unconfirmed: true }), phone('p2', { stage: 'linked', transport: 'wifi' })]));
    expect(m.find('[data-strip-icon="p1"] [data-strip-lost]').length).toBe(1);
    expect(m.find('[data-strip-icon="p1"] [data-strip-end]').length).toBe(1);
    m.unmount();
  });

  it('a stuck row dims and wears its own name in amber; a row that is merely slow does not', async () => {
    const m = await recapOf(syncOf([phone('p1'), phone('p2', { stage: 'linked', transport: 'wifi', stuck: true, idle_s: 300 }), phone('p3', { stage: 'linked', transport: 'wifi', idle_s: 30 })]));
    const icon = (id: string) => m.find(`[data-strip-icon="${id}"]`)[0];
    expect(icon('p2').dataset.stuck).toBe('1');
    expect((icon('p2').firstElementChild as HTMLElement).style.opacity).toBe('0.5');
    expect(icon('p2').querySelector('[data-strip-label]')!.textContent).toBe('BRAVO');
    expect((icon('p2').querySelector('[data-strip-label]') as HTMLElement).style.color).not.toBe('');
    expect(icon('p3').querySelector('[data-strip-label]')?.textContent ?? '').toBe('');
    m.unmount();
  });

  it('past 16 rows the stalled names go on ONE line under the strip, not under the icons', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => phone(`q${i + 1}`, i === 3 || i === 9 ? { stage: 'linked', transport: 'wifi', stuck: true, idle_s: 300, name: `STUCK${i}` } : { name: `P${i}` }));
    const m = await recapOf(syncOf(rows));
    const line = m.find('[data-strip-stalled]')[0];
    expect(line.textContent).toContain('STUCK3');
    expect(line.textContent).toContain('STUCK9');
    expect(m.find('[data-strip-icon] [data-strip-label]').filter(e => e.textContent === 'STUCK3').length, 'not also under the icon').toBe(0);
    m.unmount();
  });

  it('when the last row arrives the strip goes still and green, then collapses after ~2 s to one line', async () => {
    vi.useFakeTimers();
    const { d, state } = await stateWith(syncOf([phone('p1'), phone('p2', { stage: 'sending', pending: 1, transport: 'wifi' })]));
    const base = makeStore({ ...d, state, view: 'recap', api: { matchHistory: async () => [] } });
    const at = (s: State) => <StoreCtx.Provider value={{ ...base, state: s }}><Recap /></StoreCtx.Provider>;
    const m = await mount(at(state));
    expect(m.find('[data-strip-icon="p2"] [data-strip-motion]').length).toBe(1);
    const done = { ...state, recap: { ...state.recap!, sync: syncOf([phone('p1'), phone('p2')], { pending: false }) } as unknown as RecapView };
    await m.update(at(done));
    expect(m.find('[data-testid="sync-strip"]')[0].dataset.still, 'still').toBe('1');
    expect(m.find('[data-strip-motion]').length, 'nothing moves').toBe(0);
    expect(m.find('[data-strip-tick]').length, 'all green').toBe(2);
    expect(m.find('[data-testid="all-synced"]').length, 'not collapsed yet').toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(m.find('[data-testid="sync-strip"]').length).toBe(0);
    expect(strip(m.find('[data-testid="all-synced"]')[0].textContent ?? '')).toBe('2 OF 2 PHONES SYNCED');
    expect(m.find('[data-col-head="sync"]').length, 'the SYNC column collapses with the strip').toBe(0);
    m.unmount();
  });

  it('a phone that lost facts, or whose END is open, stays visible after the collapse: an icon, and a badge by its name', async () => {
    const m = await recapOf(syncOf([phone('p1'), phone('p2', { lost: 4 }), phone('p3', { end_unconfirmed: true }), phone('p4')], { pending: false }));
    expect(m.find('[data-testid="all-synced"]').length).toBe(1);
    expect(m.find('[data-testid="sync-kept"] [data-strip-icon]').map(e => e.dataset.stripIcon).sort()).toEqual(['p2', 'p3']);
    expect(m.find('[data-sync-row="p2"] [data-sync-lost]').length).toBe(1);
    expect(m.find('[data-sync-row="p3"] [data-sync-end]').length).toBe(1);
    expect(m.find('[data-sync-row="p1"] [data-sync-lost], [data-sync-row="p1"] [data-sync-end]').length).toBe(0);
    m.unmount();
  });
});

describe('F596 · no `sync` at all (an archived recap, an older MC): the page is as it was, with no pending state', () => {
  it('renders the winner, the score, honours, PLAY AGAIN and the CSV, with no strip and no pending header', async () => {
    const m = await recapOf(null, { provisional: true, missing: ['p3'] });
    expect(m.find('[data-testid="results-pending"]').length).toBe(0);
    expect(m.find('[data-testid="sync-strip"]').length).toBe(0);
    expect(m.find('[data-col-head="sync"]').length).toBe(0);
    expect(strip(m.text())).toContain('BLUE TEAM WINS');
    expect(strip(m.text())).toContain('HONORS');
    expect(m.find('[data-testid="recap-next-match"]').length).toBe(1);
    expect(m.find('a[download]').length).toBe(1);
    expect(m.find('[data-recap-name]').map(e => e.dataset.recapName), 'kill order').toEqual(['p2', 'p4', 'p1', 'p3']);
    expect(strip(m.text()), 'and still no banner sentence for the unflushed node').not.toContain('NOT FLUSHED');
    m.unmount();
  });

  it('a pending `sync` with no usable rows stays PENDING (the result is not shown) rather than crashing the page', async () => {
    const m = await recapOf({ pending: true });
    expect(m.find('[data-testid="results-pending"]').length).toBe(1);
    m.unmount();
  });
});

describe('F596 · the mock mirrors the server', () => {
  it('?mock moves the phones: linked, sending, received, and a quiet phone stays unlinked until FINALISE', async () => {
    vi.useFakeTimers();
    const b = new MockBackend({ syncDemo: true });
    try {
      await b.pushLobby(true); await b.start(0, true);
      await vi.advanceTimersByTimeAsync(3000);
      await b.control('end');
      const first = (await b.getState()).recap!.sync as unknown as { pending: boolean; rows: RecapSyncRow[] };
      expect(first.pending).toBe(true);
      expect(first.rows.length).toBeGreaterThan(2);
      expect(first.rows.every(r => r.stage !== 'received'), 'nobody has delivered at the whistle').toBe(true);
      await vi.advanceTimersByTimeAsync(6000);
      expect(((await b.getState()).recap!.sync as unknown as { rows: RecapSyncRow[] }).rows.some(r => r.stage === 'sending' && (r.pending ?? 0) > 0)).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
      const late = (await b.getState()).recap!.sync as unknown as { pending: boolean; finalised: boolean; rows: RecapSyncRow[] };
      expect(late.rows.filter(r => r.stage === 'received').length).toBeGreaterThan(2);
      expect(late.pending, 'the quiet phone never arrives').toBe(true);
      {
        expect(await b.finaliseRecap()).toEqual({ ok: true });
        const after = (await b.getState()).recap!.sync as unknown as { pending: boolean; finalised: boolean };
        expect(after.pending).toBe(false);
        expect(after.finalised).toBe(true);
      }
    } finally { b.dispose(); }
  });

  it('finalise outside RECAP is a 409, as on the server', async () => {
    const b = new MockBackend();
    try { await expect(b.finaliseRecap()).rejects.toMatchObject({ status: 409 }); } finally { b.dispose(); }
  });
});
