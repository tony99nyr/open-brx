// F596 console review (Opus + Codex, after b6c3367f4): every item here was written to FAIL first.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Recap } from '../src/screens/Recap';
import { Spectate } from '../src/screens/Spectate';
import { Live } from '../src/screens/Live';
import { SyncStrip } from '../src/screens/SyncStrip';
import { MockBackend } from '../src/mock/backend';
import { recapSync } from '../src/api/recapSync';
import { StoreCtx } from '../src/store';
import type { LiveRow, LiveView, RecapView, ScoreRow, State } from '../src/api/types';
import type { RecapSyncRow } from '../src/api/recapSync';
import { demo, makeStore, mount, mountScreen } from './harness';

const strip = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();
const NAMES = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'];
const score = (id: string, display: string, kills: number): ScoreRow => ({ player_id: id, display, team_id: id === 'p1' || id === 'p3' ? 'blue' : 'yellow', kills, deaths: 1,
  assists: 0, shots: 20, shots_total: 20, hits: 8, accuracy: 40, kd: kills, streak: kills, medals: [], best_streak: kills, multi_best: 0, first_blood: false });
const ROWS = [score('p2', 'BRAVO', 9), score('p4', 'DELTA', 6), score('p1', 'ALPHA', 4), score('p3', 'CHARLIE', 2)];
const phone = (id: string, over: Partial<RecapSyncRow> = {}): RecapSyncRow => ({ kind: 'phone', id, name: NAMES[Number(id.slice(1)) - 1], team_id: 'blue',
  stage: 'received', transport: null, end_unconfirmed: false, idle_s: 0, stuck: false, ...over });
const HILL: RecapSyncRow = { kind: 'station', id: '1', name: 'CONTROL POINT 1', team_id: null, stage: 'unlinked', transport: null, end_unconfirmed: false, idle_s: 20, stuck: false };
const syncOf = (rows: RecapSyncRow[], o: Record<string, boolean> = {}) => ({ pending: o.pending ?? rows.some(r => r.stage !== 'received'), finalised: !!o.finalised, result_changed: !!o.result_changed, rows });
const PENDING = syncOf([phone('p1'), phone('p2', { stage: 'sending', pending: 3, transport: 'wifi' }), phone('p3', { stage: 'unlinked' }), phone('p4')]);

async function stateWith(sync: unknown, rc: Partial<RecapView> = {}, over: Partial<State> = {}) {
  const d = await demo();
  const players = NAMES.map((display, i) => ({ ...d.state.players[0], player_id: `p${i + 1}`, player_num: i + 1, display, team_id: i % 2 ? 'yellow' : 'blue', node_id: `n${i + 1}` }));
  const recap = { winner: { team_id: 'blue' }, score: { blue: 6, yellow: 15 }, rows: ROWS, honors: [{ award: 'MVP', key: 'mvp', player_id: 'p2', stat: '9 K' }],
    provisional: false, missing: [], played_s: 300, ...(sync ? { sync } : {}), ...rc } as unknown as RecapView;
  const state: State = { ...d.state, phase: 'recap', players, recap, config: { ...d.state.config, time_limit_s: 300 }, ...over };
  return { d, state };
}
async function recapOf(sync: unknown, rc: Partial<RecapView> = {}) {
  const { d, state } = await stateWith(sync, rc);
  return mountScreen(<Recap />, { ...d, state, view: 'recap', api: { matchHistory: async () => [] } });
}
afterEach(() => { vi.useRealTimers(); });

describe('1 · SPECTATE follows the pending rule', () => {
  const spectate = async (sync: unknown) => {
    const { d, state } = await stateWith(sync);
    const live: LiveView = { match_id: 'm1', go_live_t: Date.now() - 60_000, time_limit_s: 300, ends_t: Date.now(), score: { blue: 6, yellow: 15 },
      rows: ROWS.map(r => ({ ...r, status: 'alive', sync_age_ms: 100, respawn_in_s: null }) as unknown as LiveRow) };
    return mount(<StoreCtx.Provider value={makeStore({ ...d, state: { ...state, live }, view: 'live' })}><Spectate /></StoreCtx.Provider>);
  };
  it('while pending: RESULTS PENDING, no winner, no score, no ranking', async () => {
    const m = await spectate(PENDING);
    const t = strip(m.text());
    expect(t).toContain('RESULTS PENDING');
    expect(t).toMatch(/WAITING FOR 2 PHONES/);
    expect(t).not.toMatch(/WINS|TIE —/);
    expect(m.find('[data-spectate="final"]').length, 'the winner card').toBe(0);
    expect(m.find('[data-team-score]').length, 'no team score').toBe(0);
    for (const n of NAMES) expect(t, `${n} is not listed (that would be a ranking)`).not.toContain(n);
    m.unmount();
  });
  it('after pending ends, the result shows as before', async () => {
    const m = await spectate(syncOf([phone('p1'), phone('p2')], { pending: false }));
    expect(strip(m.text())).toMatch(/WINS/);
    expect(strip(m.text())).not.toContain('RESULTS PENDING');
    m.unmount();
  });
});

describe('2 · LIVE during RECAP', () => {
  it('while pending LIVE shows the pending header and a way to RECAP, not the score or the ranking', async () => {
    const { d, state } = await stateWith(PENDING);
    const live: LiveView = { match_id: 'm1', go_live_t: Date.now() - 60_000, time_limit_s: 300, ends_t: Date.now(), score: { blue: 6, yellow: 15 },
      rows: ROWS.map(r => ({ ...r, status: 'alive', sync_age_ms: 100, respawn_in_s: null }) as unknown as LiveRow) };
    const m = await mountScreen(<Live />, { ...d, state: { ...state, live }, view: 'live' });
    expect(strip(m.text())).toContain('RESULTS PENDING');
    expect(m.find('[data-team-score]').length, 'no TeamScore headline').toBe(0);
    const t = m.text();
    const at = NAMES.map(n => t.indexOf(n));
    expect(at.every(i => i >= 0), 'the board is still there').toBe(true);
    expect(at, 'in ROSTER order (ALPHA..DELTA), not kill order (BRAVO first)').toEqual([...at].sort((a, b) => a - b));
    expect(m.find('[data-testid="live-open-recap"]').length).toBe(1);
    m.unmount();
  });
});

describe('3 · the mock mirrors the SERVER station rule (compared with the recorded server fixture)', () => {
  it('the recorded server gives an extraction station NO sync row (only control stations hold the wait)', () => {
    const raw = readFileSync(`${process.cwd()}/test/fixtures/mock-recorded.json`, 'utf8');
    expect(raw, 'the recorded recap lists a non-control station').toMatch(/"kind":"extraction"/);
    expect(raw, 'and the recorded sync.rows carry a phone row').toMatch(/"kind":"phone","id":"[^"]+","name":"[^"]+","team_id":"[^"]*","stage":"received"/);
    expect(raw.match(/"kind":"station","id"/g) ?? [], 'but no station row').toEqual([]);
  });
  it('the recorded gap list has no structural gap on sync.pending or sync.rows[*]', () => {
    const gaps = JSON.parse(readFileSync(`${process.cwd()}/test/fixtures/mock-recorded-gaps.json`, 'utf8')).rows as { path: string }[];
    expect(gaps.filter(g => g.path === '$.recap.sync.pending' || g.path === '$.recap.sync.rows[*]')).toEqual([]);
  });
  it('the mock gives no sync row to a station that is not a control station', async () => {
    vi.useFakeTimers();
    const b = new MockBackend();
    try {
      await b.pushLobby(true); await b.start(0, true);
      await vi.advanceTimersByTimeAsync(2000);
      await b.control('end');
      const st = await b.getState();
      const kinds = new Set((st.recap!.stations ?? []).map(s => s.kind));
      expect(kinds.size, 'the demo assigns a non-control station too').toBeGreaterThan(0);
      const rows = (st.recap as unknown as { sync: { rows: RecapSyncRow[] } }).sync.rows.filter(r => r.kind === 'station');
      expect(rows.every(r => r.name.startsWith('CONTROL POINT')), JSON.stringify(rows.map(r => r.name))).toBe(true);
      expect(rows.length).toBe((st.recap!.stations ?? []).filter(s => s.kind === 'control').length);
    } finally { b.dispose(); }
  });
});

describe('4 · recapSync() is hardened', () => {
  it('drops a null row and a row with no id or stage', () => {
    const v = recapSync({ sync: { pending: false, rows: [null, 5, { stage: 'received' }, { id: 'x' }, { id: 'p1', stage: 'received', name: 'A' }] } } as unknown as RecapView)!;
    expect(v.rows.map(r => r.id)).toEqual(['p1']);
  });
  it('an unknown stage is unlinked; an unknown transport is null', () => {
    const v = recapSync({ sync: { pending: true, rows: [{ id: 'p1', stage: 'teleporting', transport: 'pigeon', name: 'A' }] } } as unknown as RecapView)!;
    expect(v.rows[0].stage).toBe('unlinked');
    expect(v.rows[0].transport).toBeNull();
  });
  it('a pending sync with no rows array stays PENDING', () => {
    expect(recapSync({ sync: { pending: true } } as unknown as RecapView)?.pending).toBe(true);
    expect(recapSync({ sync: { pending: true, rows: 'nope' } } as unknown as RecapView)?.pending).toBe(true);
    expect(recapSync({ sync: { pending: false } } as unknown as RecapView), 'not pending and no rows: an older shape').toBeUndefined();
  });
  it('the page hides the result for that pending sync and still renders', async () => {
    const m = await recapOf({ pending: true });
    expect(m.find('[data-testid="results-pending"]').length).toBe(1);
    expect(strip(m.text())).not.toMatch(/WINS/);
    m.unmount();
  });
  it('a null row and an unknown transport do not crash the strip', async () => {
    const m = await recapOf({ pending: true, finalised: false, result_changed: false, rows: [null, { kind: 'phone', id: 'p1', name: 'ALPHA', stage: 'linked', transport: 'pigeon', end_unconfirmed: false, idle_s: 0, stuck: false }] });
    expect(m.find('[data-strip-icon="p1"]').length).toBe(1);
    m.unmount();
  });
  it('SyncStrip itself guards an unknown transport (no throw, no badge)', async () => {
    const rows = [phone('p1', { stage: 'linked', transport: 'pigeon' as unknown as 'wifi' })];
    const m = await mount(<SyncStrip rows={rows} phase="live" />);
    expect(m.find('[data-strip-icon="p1"]').length).toBe(1);
    expect(m.find('[data-strip-transport]').length).toBe(0);
    m.unmount();
  });
});

describe('5 · a stuck SENDING row does not animate', () => {
  it('no dots and no ring on a stuck sending row; a live sending row still moves', async () => {
    const m = await recapOf(syncOf([phone('p1', { stage: 'sending', pending: 2, transport: 'wifi', stuck: true, idle_s: 300 }), phone('p2', { stage: 'sending', pending: 2, transport: 'wifi' })]));
    expect(m.find('[data-strip-icon="p1"] [data-strip-motion], [data-strip-icon="p1"] .sb-ring').length).toBe(0);
    expect(m.find('[data-strip-icon="p2"] [data-strip-motion]').length).toBe(1);
    m.unmount();
  });
});

describe('6 · the strip is a list a screen reader can read', () => {
  it('each icon is a listitem labelled with name, stage and transport', async () => {
    const m = await recapOf(syncOf([phone('p1'), phone('p2', { stage: 'sending', pending: 3, transport: 'cellular' }), phone('p3', { stage: 'unlinked' }), HILL]));
    const icons = m.find('[data-strip-icon]');
    expect(icons.length).toBe(4);
    for (const i of icons) expect(i.getAttribute('role')).toBe('listitem');
    expect(m.find('[data-strip-icon="p2"]')[0].getAttribute('aria-label')).toMatch(/BRAVO.*sending.*cellular.*3 left/i);
    expect(m.find('[data-strip-icon="p3"]')[0].getAttribute('aria-label')).toMatch(/CHARLIE.*not linked/i);
    expect(m.find('[data-strip-icon="1"]')[0].getAttribute('aria-label')).toMatch(/CONTROL POINT 1.*not linked/i);
    expect(m.find('[data-testid="sync-strip"] [role="list"]').length).toBe(1);
    expect(m.find('[role="list"] > :not([role="listitem"])').filter(e => e.getAttribute('aria-hidden') !== 'true').length, 'only list items inside the list').toBe(0);
    m.unmount();
  });
});

describe('7 · phones and hills are counted apart', () => {
  it('the header counts phones, and adds the hill', async () => {
    const m = await recapOf(syncOf([phone('p1'), phone('p2', { stage: 'linked', transport: 'wifi' }), HILL]));
    expect(strip(m.find('[data-testid="waiting-for"]')[0].textContent ?? '')).toBe('WAITING FOR 1 PHONE · 1 HILL');
    m.unmount();
  });
  it('only a hill missing: WAITING FOR 1 HILL', async () => {
    const m = await recapOf(syncOf([phone('p1'), HILL]));
    expect(strip(m.find('[data-testid="waiting-for"]')[0].textContent ?? '')).toBe('WAITING FOR 1 HILL');
    m.unmount();
  });
  it('FINAL WITHOUT names a missing hill by its label', async () => {
    const m = await recapOf(syncOf([phone('p1'), phone('p2', { stage: 'linked', transport: 'wifi' }), HILL], { pending: false, finalised: true }));
    expect(strip(m.find('[data-testid="final-without"]')[0].textContent ?? '')).toBe('FINAL WITHOUT 1 PHONE (BRAVO) AND 1 HILL (CONTROL POINT 1)');
    m.unmount();
  });
  it('N OF N PHONES SYNCED counts phones only', async () => {
    const m = await recapOf(syncOf([phone('p1'), phone('p2'), { ...HILL, stage: 'received' }], { pending: false }));
    expect(strip(m.find('[data-testid="all-synced"]')[0].textContent ?? '')).toBe('2 OF 2 PHONES SYNCED');
    m.unmount();
  });
});

describe('8 · the medal legend', () => {
  it('is hidden while results are pending and back afterwards', async () => {
    const withMedals = { rows: ROWS.map(r => (r.player_id === 'p2' ? { ...r, medals: ['KILLSTREAK'] } : r)), honors: [{ award: 'MVP', key: 'mvp', player_id: 'p2', stat: '9 K' }] };
    const p = await recapOf(PENDING, withMedals as Partial<RecapView>);
    expect(p.find('[data-testid="medal-legend"]').length).toBe(0);
    p.unmount();
    const d = await recapOf(syncOf([phone('p1'), phone('p2')], { pending: false }), withMedals as Partial<RecapView>);
    expect(d.find('[data-testid="medal-legend"]').length).toBe(1);
    d.unmount();
  });
});
