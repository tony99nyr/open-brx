// A47 (bench 2026-09-17): the operator menu on the LIVE board. Tapping a player's row opens a small inline menu
// with RESYNC GUN, FORCE RESPAWN and RELINK GUN. A second tap on the same action confirms it (no modal). A phone
// out of reach gets a sentence instead of buttons. These assert what the operator SEES and what is sent.
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api, LiveRow, LiveView, OperatorCmd, State } from '../src/api/types';
import { CommandBar } from '../src/frame/CommandBar';
import { Live } from '../src/screens/Live';
import { ARM_TIMEOUT_MS } from '../src/screens/OperatorMenu';
import { clearNotice } from '../src/notice';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import { demo, fixtureApi, makeStore, mount, type Mounted } from './harness';

const row = (player_id: string, display: string, status: LiveRow['status'], sync_age_ms = 1000): LiveRow => ({
  player_id, display, team_id: 'blue', kills: 1, deaths: 0, assists: 0, shots: 10, hits: 4, shots_total: 10,
  accuracy: 40, kd: 1, streak: 1, best_streak: 1, multi_best: 0, first_blood: false, acc_provisional: false,
  medals: [], status, sync_age_ms, respawn_in_s: status === 'down' ? 5 : null,
});

const LIVE: LiveView = {
  match_id: 'm-op', go_live_t: Date.now() - 60_000, time_limit_s: 600, ends_t: Date.now() + 540_000,
  score: { blue: 1 }, rows: [row('p1', 'VIPER', 'alive'), row('p2', 'GHOST', 'stale', 20_000), row('p3', 'ROOK', 'down')],
};

function Wrap({ state, api, children }: { state: State; api: Partial<Api>; children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const store = makeStore({ state, view: 'live', api }, {
    error, clearError: () => setError(null),
    run: async fn => { try { setError(null); return await fn(); } catch (e) { setError((e as Error).message); return undefined; } },
  });
  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>;
}

type Call = [string, OperatorCmd, string];
async function board(answer?: Error, opts: { phase?: State['phase']; live?: LiveView; respawnType?: 'auto' | 'none' } = {}) {
  const d = await demo();
  const calls: Call[] = [];
  const api = fixtureApi({
    operatorAction: async (pid: string, cmd: OperatorCmd, mid: string) => {
      calls.push([pid, cmd, mid]);
      if (answer) throw answer;
      return { ok: true, cmd, player_id: pid, match_id: mid, pushed: true };
    },
  } as Partial<Api>);
  const mkState = (live: LiveView): State => ({
    ...d.state, phase: opts.phase ?? 'live', live,
    config: { ...d.state.config, respawn: { type: opts.respawnType ?? 'auto', delay_s: opts.respawnType === 'none' ? 0 : 15 } },
  });
  const m = await mount(<Wrap state={mkState(opts.live ?? LIVE)} api={api}><CommandBar /><Live /></Wrap>);
  const rerender = (live: LiveView) => m.update(<Wrap state={mkState(live)} api={api}><CommandBar /><Live /></Wrap>);
  return Object.assign(m, { calls, rerender });
}
const rowEl = (m: Mounted, pid: string) => m.find(`[data-live-row="${pid}"]`)[0];
const menu = (m: Mounted, pid: string) => m.find(`[data-operator-menu="${pid}"]`)[0];
const op = (m: Mounted, cmd: OperatorCmd) => m.find(`[data-op="${cmd}"]`)[0] as HTMLButtonElement | undefined;
const errStrip = (m: Mounted) => (m.find('header [role="alert"]')[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();
const tap = async (el: HTMLElement) => { const { act } = await import('react'); await act(async () => { el.click(); }); };

/** what jsdom writes back for a token colour set as an inline style */
function styleColor(c: string) { const d = document.createElement('div'); d.style.color = c; return d.style.color.replace(/\s/g, ''); }

describe('A47 · LIVE operator menu', () => {
  beforeEach(() => clearNotice());
  afterEach(() => vi.useRealTimers());

  it('tapping a row opens its menu with the three actions, and tapping it again closes it', async () => {
    const m = await board();
    expect(menu(m, 'p1'), 'closed at first').toBeUndefined();
    await tap(rowEl(m, 'p1'));
    const el = menu(m, 'p1');
    expect(el, 'the menu opens under the row').toBeTruthy();
    expect(rowEl(m, 'p1').getAttribute('aria-expanded')).toBe('true');
    const t = el.textContent ?? '';
    for (const label of ['RESYNC GUN', 'FORCE RESPAWN', 'RELINK GUN']) expect(t).toContain(label);
    await tap(rowEl(m, 'p1'));
    expect(menu(m, 'p1'), 'a second tap on the row closes it').toBeUndefined();
    m.unmount();
  });

  it('the first tap arms the action and sends nothing; the second tap sends it and says so', async () => {
    const m = await board();
    await tap(rowEl(m, 'p1'));
    await tap(op(m, 'respawn')!);
    expect(m.calls, 'one tap sends nothing').toEqual([]);
    expect(op(m, 'respawn')!.textContent).toBe('CONFIRM FORCE RESPAWN');
    await tap(op(m, 'resync')!);
    expect(op(m, 'respawn')!.textContent, 'arming another action disarms the first').toBe('FORCE RESPAWN');
    expect(op(m, 'resync')!.textContent).toBe('CONFIRM RESYNC GUN');
    await tap(op(m, 'resync')!);
    expect(m.calls).toEqual([['p1', 'resync', 'm-op']]);
    expect(m.text()).toContain("RESYNC SENT TO VIPER'S PHONE");
    expect(menu(m, 'p1'), 'the menu stays open to show what the phone says').toBeTruthy();
    m.unmount();
  });

  it('a phone out of reach gets a sentence and no action buttons', async () => {
    const m = await board();
    await tap(rowEl(m, 'p2'));
    const el = menu(m, 'p2');
    expect(el.querySelector('[data-op-unavailable="reach"]')?.textContent).toContain("GHOST'S PHONE IS OUT OF REACH");
    expect(el.querySelectorAll('[data-op]').length).toBe(0);
    m.unmount();
  });

  it('RESYNC is disabled for a down player, who is pointed at FORCE RESPAWN', async () => {
    const m = await board();
    await tap(rowEl(m, 'p3'));
    expect(op(m, 'resync')!.disabled).toBe(true);
    expect(menu(m, 'p3').textContent).toContain('ROOK IS DOWN. USE FORCE RESPAWN.');
    expect(op(m, 'respawn')!.disabled).toBe(false);
    m.unmount();
  });

  it('the row reads as a control: a mark in the name cell, and a label and target for assistive tech', async () => {
    const m = await board();
    const el = rowEl(m, 'p1');
    expect(el.querySelector('[data-row-affordance]')?.textContent).toBe('▸');
    expect(el.getAttribute('aria-label')).toBe('VIPER operator actions');
    await tap(el);
    expect(el.getAttribute('aria-controls')).toBe(menu(m, 'p1').id);
    m.unmount();
  });

  it('shows "sent, waiting for the phone" until the result arrives, then the result', async () => {
    const withOp = (op: LiveRow['operator']): LiveView => ({ ...LIVE, rows: LIVE.rows.map(r => (r.player_id === 'p1' ? { ...r, operator: op } : r)) });
    const m = await board(undefined, { live: withOp({ cmd: 'resync', state: 'sent', why: null, sent_t: 1, result_t: null }) });
    await tap(rowEl(m, 'p1'));
    const out = () => menu(m, 'p1').querySelector('[data-op-outcome]')?.textContent ?? '';
    expect(out()).toBe('RESYNC SENT, WAITING FOR THE PHONE.');
    await m.rerender(withOp({ cmd: 'resync', state: 'done', why: null, sent_t: 1, result_t: 2 }));
    expect(out()).toBe('RESYNC DONE ON THE PHONE.');
    await m.rerender(withOp({ cmd: 'resync', state: 'refused', why: 'STUNNED', sent_t: 1, result_t: 3 }));
    expect(out()).toBe('THE PHONE REFUSED RESYNC: STUNNED.');
    m.unmount();
  });

  it('pl4: says NO ANSWER in dim text once MC stops waiting, and RELINK STARTED for a relink', async () => {
    const withOp = (op: LiveRow['operator']): LiveView => ({ ...LIVE, rows: LIVE.rows.map(r => (r.player_id === 'p1' ? { ...r, operator: op } : r)) });
    const m = await board(undefined, { live: withOp({ cmd: 'resync', state: 'no_answer', why: null, sent_t: 1, result_t: null }) });
    await tap(rowEl(m, 'p1'));
    const el = () => menu(m, 'p1').querySelector<HTMLElement>('[data-op-outcome]');
    expect(el()?.textContent).toBe('NO ANSWER FROM THE PHONE.');
    expect(el()?.getAttribute('data-op-outcome')).toBe('no_answer');
    const sentColor = el()?.style.color;
    await m.rerender(withOp({ cmd: 'relink', state: 'done', why: null, sent_t: 1, result_t: 2 }));
    expect(el()?.textContent).toBe('RELINK STARTED ON THE PHONE.');
    await m.rerender(withOp({ cmd: 'resync', state: 'sent', why: null, sent_t: 1, result_t: null }));
    expect(el()?.style.color, 'the same dim as "sent"').toBe(sentColor);
    m.unmount();
  });

  it('an armed CONFIRM clears after 4 s, and when the row status changes', async () => {
    const m = await board();
    await tap(rowEl(m, 'p1'));
    vi.useFakeTimers();
    try {
      await tap(op(m, 'respawn')!);
      expect(op(m, 'respawn')!.textContent).toBe('CONFIRM FORCE RESPAWN');
      const { act } = await import('react');
      await act(async () => { vi.advanceTimersByTime(ARM_TIMEOUT_MS - 100); });
      expect(op(m, 'respawn')!.textContent, 'still armed just before the timeout').toBe('CONFIRM FORCE RESPAWN');
      await act(async () => { vi.advanceTimersByTime(200); });
      expect(op(m, 'respawn')!.textContent).toBe('FORCE RESPAWN');
      await tap(op(m, 'respawn')!);
      expect(op(m, 'respawn')!.textContent).toBe('CONFIRM FORCE RESPAWN');
      await m.rerender({ ...LIVE, rows: LIVE.rows.map(r => (r.player_id === 'p1' ? { ...r, status: 'down', respawn_in_s: 9 } : r)) });
      expect(op(m, 'respawn')!.textContent, 'a status change disarms it').toBe('FORCE RESPAWN');
      expect(m.calls).toEqual([]);
    } finally { vi.useRealTimers(); }
    m.unmount();
  });

  it('in ARMED only RELINK is offered, with one line saying why', async () => {
    const m = await board(undefined, { phase: 'armed' });
    await tap(rowEl(m, 'p1'));
    expect(op(m, 'resync')).toBeUndefined();
    expect(op(m, 'respawn')).toBeUndefined();
    expect(op(m, 'relink')).toBeTruthy();
    expect(menu(m, 'p1').querySelector('[data-op-unavailable="armed"]')?.textContent).toContain('WAIT FOR T-0');
    m.unmount();
  });

  it('FORCE RESPAWN is disabled for a down player when the mode has no respawn, and says why', async () => {
    const m = await board(undefined, { respawnType: 'none' });
    await tap(rowEl(m, 'p3'));
    expect(op(m, 'respawn')!.disabled).toBe(true);
    expect(menu(m, 'p3').textContent).toContain('ROOK IS OUT. THIS MODE HAS NO RESPAWN.');
    m.unmount();
    const m2 = await board(undefined, { respawnType: 'none' });
    await tap(rowEl(m2, 'p1'));
    expect(op(m2, 'respawn')!.disabled, 'a living player can still be respawned').toBe(false);
    m2.unmount();
  });

  it('the out-of-reach sentence is dim, not a warning', async () => {
    const m = await board();
    await tap(rowEl(m, 'p2'));
    const el = menu(m, 'p2').querySelector('[data-op-unavailable="reach"]') as HTMLElement;
    const { T } = await import('../src/tokens');
    expect(el.style.color.replace(/\s/g, '')).toBe(styleColor(T.dim));
    m.unmount();
  });

  it('an adopted match every phone has ended shows one line on the MATCH screen', async () => {
    const m = await board(undefined, { live: { ...LIVE, phones_ended: true } });
    expect(m.find('[data-testid="phones-ended"]')[0]?.textContent).toBe('PHONES HAVE ENDED THIS MATCH: PRESS END');
    expect(m.find('[role="dialog"]').length, 'not a popup').toBe(0);
    m.unmount();
    const m2 = await board();
    expect(m2.find('[data-testid="phones-ended"]').length).toBe(0);
    m2.unmount();
  });

  it("a refusal shows the server's reason in the error strip and keeps the menu open", async () => {
    const m = await board(Object.assign(new Error('that match is over: the board was stale. Look at the player again'), { status: 409 }));
    await tap(rowEl(m, 'p1'));
    await tap(op(m, 'relink')!); await tap(op(m, 'relink')!);
    expect(errStrip(m)).toContain('that match is over');
    expect(m.text()).not.toContain('RELINK SENT');
    expect(menu(m, 'p1')).toBeTruthy();
    m.unmount();
  });
});

describe('A47 · the ?mock backend refuses what MC refuses', () => {
  it('refuses outside ARMED/LIVE, then sends in ARMED and writes the feed line', async () => {
    const b = new MockBackend();
    const pid = (await b.getState()).players[0].player_id;
    await expect(b.operatorAction(pid, 'respawn', 'x')).rejects.toThrow(/ARMED or LIVE/);
    await b.pushLobby(true);
    const { match_id } = await b.start(0, true);
    await expect(b.operatorAction(pid, 'respawn', 'old')).rejects.toThrow(/match is over/);
    const feed: string[] = [];
    const off = b.subscribe(() => {}, e => feed.push(`${e.tag}:${e.text}`));
    const phase = (await b.getState()).phase;
    const who = (await b.getState()).players[0].display.toUpperCase();
    if (phase === 'armed') {
      await expect(b.operatorAction(pid, 'respawn', match_id)).rejects.toThrow(/NEEDS A LIVE MATCH/);
      expect((await b.operatorAction(pid, 'relink', match_id)).ok).toBe(true);
      expect(feed).toContain(`OPERATOR:SENT RELINK TO ${who}`);
    } else {
      const r = await b.operatorAction(pid, 'respawn', match_id);
      expect(r).toMatchObject({ ok: true, cmd: 'respawn', match_id });
      expect(feed).toContain(`OPERATOR:SENT RESPAWN TO ${who}`);
      await expect(b.operatorAction(pid, 'respawn', match_id)).rejects.toThrow(/JUST SENT/);
    }
    off();
  });
});
