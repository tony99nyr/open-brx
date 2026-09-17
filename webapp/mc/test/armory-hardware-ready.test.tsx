// ARMORY's gate button and ENABLE BACKHAUL (Tony, bench 2026-09-17).
//
// "CONTINUE ▸" told the operator nothing. The button is now the status: it names what it waits for and
// reads HARDWARE READY ▸ when the board allows. The gate itself did not move (only a red a push cannot
// cure disables it). Beside it, ENABLE BACKHAUL starts the internet link once every phone is green,
// and never stands between the operator and GAMES.
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { Armory } from '../src/screens/Armory';
import { armoryGate, backhaulOffer } from '../src/api/derive';
import type { LanPublic, ReadinessRow, State } from '../src/api/types';
import { demo, mountScreen } from './harness';

const LINK_LOST = 'GUN LINK LOST';
const STALE = 'ACKED AN OLDER CONFIG (9f2a1c04) — RE-PUSH';
const OFF: LanPublic = { ws_url: null, status: 'off', provider: 'cloudflared', available: true };

/** The demo session with every row green, then `rows` patched over the first rows, and `pub` as the link. */
async function session(rows: Partial<ReadinessRow>[] = [], ...link: [LanPublic | undefined] | []) {
  const pub = link.length ? link[0] : OFF;
  const d = await demo();
  const board = d.state.readiness.board.map((r, i) => ({ ...r, status: 'green', blockers: [], ambers: [], ...(rows[i] ?? {}) }) as ReadinessRow);
  const state = { ...d.state, readiness: { ...d.state.readiness, board }, lan: { ...d.state.lan, public: pub } } as State;
  return { d, state };
}

const gateBtn = (m: { find: (s: string) => HTMLElement[] }) => m.find('[data-testid="armory-gate"]')[0] as HTMLButtonElement;
const backhaulBtn = (m: { find: (s: string) => HTMLElement[] }) =>
  (m.find('button') as HTMLButtonElement[]).find(b => (b.textContent ?? '').includes('ENABLE BACKHAUL'));

describe('ARMORY gate · the label is the status', () => {
  it('names the phones it waits for, and still goes on to GAMES', async () => {
    const { d, state } = await session([{ status: 'waiting' }, { status: 'waiting' }]);
    const m = await mountScreen(<Armory />, { state, weapons: d.weapons, perks: d.perks });
    expect(gateBtn(m).textContent).toBe('WAITING FOR 2 PHONES');
    expect(gateBtn(m).disabled, 'a waiting phone never blocked navigation').toBe(false);
    expect(m.text()).not.toContain('CONTINUE ▸');
    m.unmount();
  });

  it('says how many guns are blocked, and is disabled', async () => {
    const { d, state } = await session([{ status: 'red', blockers: [LINK_LOST] }, { status: 'waiting' }]);
    const m = await mountScreen(<Armory />, { state, weapons: d.weapons, perks: d.perks });
    expect(gateBtn(m).textContent).toBe('1 GUN BLOCKED');
    expect(gateBtn(m).disabled).toBe(true);
    expect(gateBtn(m).title).toBe(LINK_LOST);
    m.unmount();
  });

  it('reads HARDWARE READY ▸ on a clean board, and on a red a RE-PUSH cures', async () => {
    for (const rows of [[], [{ status: 'red', blockers: [STALE] }], [{ status: 'amber', ambers: ['LOW PHONE BATTERY'] }]] as Partial<ReadinessRow>[][]) {
      const { d, state } = await session(rows);
      const m = await mountScreen(<Armory />, { state, weapons: d.weapons, perks: d.perks });
      expect(gateBtn(m).textContent).toBe('HARDWARE READY ▸');
      expect(gateBtn(m).disabled).toBe(false);
      m.unmount();
    }
  });

  it('the pure rule, including an empty board', () => {
    expect(armoryGate([]).label).toBe('NO PLAYERS YET ▸');
    expect(armoryGate([{ status: 'waiting' }]).label).toBe('WAITING FOR 1 PHONE');
    expect(armoryGate([{ status: 'red', blockers: [LINK_LOST] }, { status: 'red', blockers: [LINK_LOST] }]).label).toBe('2 GUNS BLOCKED');
    expect(armoryGate([{ status: 'green' }]).ready).toBe(true);
  });
});

describe('ARMORY · ENABLE BACKHAUL', () => {
  it('shows beside HARDWARE READY when the link can start, is down, and every phone is green', async () => {
    const { d, state } = await session();
    const m = await mountScreen(<Armory />, { state, weapons: d.weapons, perks: d.perks });
    const b = backhaulBtn(m);
    expect(b, 'offered').toBeTruthy();
    // immediately to the LEFT: the previous sibling element of the gate button's wrapper chain
    const row = gateBtn(m).parentElement!;
    const kids = Array.from(row.children);
    expect(kids.findIndex(k => k.contains(b!))).toBe(kids.indexOf(gateBtn(m)) - 1);
    m.unmount();
  });

  it('also shows after a failed start (status error), so the operator can try again', async () => {
    const { state } = await session([], { ...OFF, status: 'error', error: 'no internet' });
    expect(backhaulOffer(state).offer).toBe(true);
  });

  const hidden: [string, Partial<ReadinessRow>[], LanPublic | undefined][] = [
    ['cloudflared is not installed', [], { ...OFF, available: false }],
    ['the server predates backhaul', [], undefined],
    ['the link is set by --public-url', [], { ...OFF, provider: 'manual', status: 'up', ws_url: 'wss://x/ws' }],
    ['the link is already up', [], { ...OFF, status: 'up', ws_url: 'wss://abc.trycloudflare.com/ws' }],
    ['a phone has not arrived', [{ status: 'waiting' }], OFF],
    ['a row is amber', [{ status: 'amber', ambers: ['LOW PHONE BATTERY'] }], OFF],
    ['a row is red', [{ status: 'red', blockers: [LINK_LOST] }], OFF],
  ];
  for (const [why, rows, pub] of hidden) {
    it(`is hidden when ${why}`, async () => {
      const { d, state } = await session(rows, pub);
      const m = await mountScreen(<Armory />, { state, weapons: d.weapons, perks: d.perks });
      expect(backhaulBtn(m)).toBeFalsy();
      m.unmount();
    });
  }

  it('is hidden on an empty board', async () => {
    const { state } = await session();
    expect(backhaulOffer({ ...state, readiness: { ...state.readiness, board: [] } }).offer).toBe(false);
  });

  it('pressing it calls POST /api/tunnel {on:true}, reads STARTING…, and HARDWARE READY still navigates', async () => {
    const { d, state } = await session();
    const calls: boolean[] = [];
    const phases: string[] = [];
    const m = await mountScreen(<Armory />, {
      state, weapons: d.weapons, perks: d.perks,
      api: {
        setTunnel: (on: boolean) => { calls.push(on); return new Promise<LanPublic>(() => { /* never settles: a slow link */ }); },
        setPhase: async (p: string) => { phases.push(p); return state; },
      },
    });
    await m.click('ENABLE BACKHAUL');
    expect(calls).toEqual([true]);
    expect(m.find('[data-backhaul="starting"]')[0]?.textContent).toBe('STARTING…');
    expect(gateBtn(m).disabled, 'starting the link never disables the gate').toBe(false);
    await act(async () => { gateBtn(m).click(); });
    expect(phases).toEqual(['build']);
    m.unmount();
  });

  it('once up after a press, it becomes a quiet BACKHAUL ON tag', async () => {
    const { d, state } = await session();
    const m = await mountScreen(<Armory />, { state, weapons: d.weapons, perks: d.perks, api: { setTunnel: async () => ({ ...OFF, status: 'starting' }) } });
    await m.click('ENABLE BACKHAUL');
    const up = { ...state, lan: { ...state.lan, public: { ...OFF, status: 'up', ws_url: 'wss://abc.trycloudflare.com/ws' } } } as State;
    const { StoreCtx } = await import('../src/store');
    await m.update(<StoreCtx.Provider value={{ ...m.store, state: up }}><Armory /></StoreCtx.Provider>);
    expect(m.find('[data-backhaul="on"]')[0]?.textContent).toBe('BACKHAUL ON');
    expect(backhaulBtn(m)).toBeFalsy();
    m.unmount();
  });

  it('an error is one quiet line and never blocks HARDWARE READY', async () => {
    const { d, state } = await session();
    const phases: string[] = [];
    const m = await mountScreen(<Armory />, {
      state, weapons: d.weapons, perks: d.perks,
      api: {
        setTunnel: async () => { throw new Error('cloudflared was not found on PATH'); },
        setPhase: async (p: string) => { phases.push(p); return state; },
      },
    });
    await m.click('ENABLE BACKHAUL');
    const line = m.find('[data-backhaul-error]');
    expect(line.length).toBe(1);
    expect(line[0].textContent).toContain('cloudflared was not found on PATH');
    expect(gateBtn(m).disabled).toBe(false);
    expect(gateBtn(m).textContent).toBe('HARDWARE READY ▸');
    await act(async () => { gateBtn(m).click(); });
    expect(phases).toEqual(['build']);
    m.unmount();
  });
});
