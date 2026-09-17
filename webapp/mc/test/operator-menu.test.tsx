// A47 (bench 2026-09-17): the operator menu on the LIVE board. Tapping a player's row opens a small inline menu
// with RESYNC GUN, FORCE RESPAWN and RELINK GUN. A second tap on the same action confirms it (no modal). A phone
// out of reach gets a sentence instead of buttons. These assert what the operator SEES and what is sent.
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Api, LiveRow, LiveView, OperatorCmd, State } from '../src/api/types';
import { CommandBar } from '../src/frame/CommandBar';
import { Live } from '../src/screens/Live';
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
async function board(answer?: Error) {
  const d = await demo();
  const calls: Call[] = [];
  const api = fixtureApi({
    operatorAction: async (pid: string, cmd: OperatorCmd, mid: string) => {
      calls.push([pid, cmd, mid]);
      if (answer) throw answer;
      return { ok: true, cmd, player_id: pid, match_id: mid, pushed: true };
    },
  } as Partial<Api>);
  const state: State = { ...d.state, phase: 'live', live: LIVE };
  const m = await mount(<Wrap state={state} api={api}><CommandBar /><Live /></Wrap>);
  return Object.assign(m, { calls });
}
const rowEl = (m: Mounted, pid: string) => m.find(`[data-live-row="${pid}"]`)[0];
const menu = (m: Mounted, pid: string) => m.find(`[data-operator-menu="${pid}"]`)[0];
const op = (m: Mounted, cmd: OperatorCmd) => m.find(`[data-op="${cmd}"]`)[0] as HTMLButtonElement | undefined;
const errStrip = (m: Mounted) => (m.find('header [role="alert"]')[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();
const tap = async (el: HTMLElement) => { const { act } = await import('react'); await act(async () => { el.click(); }); };

describe('A47 · LIVE operator menu', () => {
  beforeEach(() => clearNotice());

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
    expect(menu(m, 'p1'), 'the menu closes after a send').toBeUndefined();
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
    const r = await b.operatorAction(pid, 'respawn', match_id);
    off();
    expect(r).toMatchObject({ ok: true, cmd: 'respawn', match_id });
    const who = (await b.getState()).players[0].display.toUpperCase();
    expect(feed).toContain(`OPERATOR:OPERATOR RESPAWNED ${who}`);
  });
});
