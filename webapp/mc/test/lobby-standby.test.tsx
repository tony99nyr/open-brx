// STANDBY (2026-09-12). Field ask at the first four-phone session: "i had a player walk away. i dont
// have a way to do that in MC ... pull them out into standby ... i want to be able to select who is
// going to participate in the lobby".
//
// Screen-truth assertions: the chip is ON every lobby row and calls the standby route with THAT
// player's id; the parked player is listed under STANDBY with a PLAY control that calls reinstate;
// the READY total counts the roster only; and a snapshot from a server that predates the field
// (no `standby` key) renders no section, no chip, no STAND DOWN — and no crash.
// `test/e2e/standby.mjs` is the same behaviour in a real browser, fresh and stale.
import { describe, expect, it } from 'vitest';
import type { Player, State } from '../src/api/types';
import { Kit } from '../src/screens/Kit';
import { Lobby } from '../src/screens/Lobby';
import { MockBackend } from '../src/mock/backend';
import { Armory } from '../src/screens/Armory';
import { demo, mountScreen } from './harness';

const withStandby = (s: State): State => {
  const [parked, ...rest] = s.players;
  return { ...s, players: rest, standby: [{ ...parked, node_id: null, ready: false }] };
};
/** a server that predates the field: no `standby` key at all */
const olderServer = (s: State): State => { const { standby: _drop, ...rest } = s; return rest as State; };

describe('LOBBY standby', () => {
  it('every roster row carries a STAND DOWN chip that parks THAT player', async () => {
    const d = await demo();
    const calls: string[] = [];
    const s = { ...d.state, standby: [] as Player[] };
    const m = await mountScreen(<Lobby />, { ...d, state: s, view: 'lobby', api: { standbyPlayer: async (id: string) => { calls.push(id); return s.players[0]; } } });
    const chips = m.find('[data-standby]');
    expect(chips.length, 'one chip per rostered player').toBe(s.players.length);
    for (const c of chips) expect(c.textContent).toContain('STAND DOWN');
    const target = s.players[2];
    m.find(`[data-standby="${target.player_id}"]`)[0].click();
    await new Promise(r => setTimeout(r, 0));
    expect(calls).toEqual([target.player_id]);
    m.unmount();
  });

  it('a parked player is listed under STANDBY with PLAY, and is out of the READY total', async () => {
    const d = await demo();
    const s = withStandby(d.state);
    const parked = s.standby![0];
    const calls: string[] = [];
    const m = await mountScreen(<Lobby />, { ...d, state: s, view: 'lobby', api: { reinstatePlayer: async (id: string) => { calls.push(id); return parked; } } });
    const sec = m.find('[data-standby-section]');
    expect(sec.length).toBe(1);
    expect(sec[0].textContent).toContain('STANDBY // 1 SITTING OUT');
    expect(sec[0].textContent).toContain(parked.display);
    expect(sec[0].textContent).toContain(parked.gun_id ?? 'NO GUN');
    // the parked row is not one of the roster rows
    expect(m.find(`[data-standby="${parked.player_id}"]`).length, 'no STANDBY chip for someone already parked').toBe(0);
    // the READY total is the roster, not the roster plus the bench
    const ready = s.players.filter(p => p.ready).length;
    expect(m.text()).toContain(`${ready}/${s.players.length}`);
    expect(m.text()).not.toContain(`/${s.players.length + 1}`);
    m.find(`[data-reinstate="${parked.player_id}"]`)[0].click();
    await new Promise(r => setTimeout(r, 0));
    expect(calls).toEqual([parked.player_id]);
    m.unmount();
  });

  it('a snapshot without `standby` (older MC) renders no section and no chip — and does not crash', async () => {
    const d = await demo();
    const s = olderServer(d.state);
    const m = await mountScreen(<Lobby />, { ...d, state: s, view: 'lobby' });
    expect(m.find('[data-standby-section]').length).toBe(0);
    expect(m.find('[data-standby]').length).toBe(0);
    expect(m.text()).toContain('Team Assignment');
    m.unmount();
  });
});

describe('KIT standby', () => {
  it('the selected operator has STAND DOWN, the bench lists the parked with PLAY', async () => {
    const d = await demo();
    const s = withStandby(d.state);
    const sel = s.players[0];
    const parked = s.standby![0];
    const down: string[] = [], back: string[] = [];
    const m = await mountScreen(<Kit />, { ...d, state: s, view: 'kit', selPlayer: sel.player_id,
      api: { standbyPlayer: async (id: string) => { down.push(id); return sel; }, reinstatePlayer: async (id: string) => { back.push(id); return parked; } } });
    const btn = m.find(`[data-stand-down="${sel.player_id}"]`);
    expect(btn.length, 'STAND DOWN for the selected operator').toBe(1);
    btn[0].closest('button')!.click();
    await new Promise(r => setTimeout(r, 0));
    expect(down).toEqual([sel.player_id]);
    expect(m.find('[data-standby-section]')[0].textContent).toContain(parked.display);
    expect(m.text()).toContain(`${s.players.length} OPERATORS`);
    m.find(`[data-reinstate="${parked.player_id}"]`)[0].click();
    await new Promise(r => setTimeout(r, 0));
    expect(back).toEqual([parked.player_id]);
    m.unmount();
  });

  it('older MC: no STAND DOWN, no bench', async () => {
    const d = await demo();
    const s = olderServer(d.state);
    const m = await mountScreen(<Kit />, { ...d, state: s, view: 'kit', selPlayer: s.players[0].player_id });
    expect(m.find('[data-stand-down]').length).toBe(0);
    expect(m.find('[data-standby-section]').length).toBe(0);
    expect(m.text()).toContain('SQUAD ROSTER');
    m.unmount();
  });
});

describe('STANDBY once the match is armed/live', () => {
  it('LOBBY offers no STAND DOWN and no PLAY, and says why', async () => {
    const d = await demo();
    const s = { ...withStandby(d.state), phase: 'live' as const };
    const m = await mountScreen(<Lobby />, { ...d, state: s, view: 'lobby' });
    expect(m.find('[data-standby]').length, 'no STAND DOWN chip on a live match').toBe(0);
    expect(m.find('[data-reinstate]').length, 'no PLAY on a live match').toBe(0);
    expect(m.find('[data-standby-locked]').length).toBe(1);
    expect(m.find('[data-standby-section]')[0].textContent).toContain('MATCH LIVE');
    m.unmount();
  });
  it('KIT offers no STAND DOWN', async () => {
    const d = await demo();
    const s = { ...withStandby(d.state), phase: 'armed' as const };
    const m = await mountScreen(<Kit />, { ...d, state: s, view: 'kit', selPlayer: s.players[0].player_id });
    expect(m.find('[data-stand-down]').length).toBe(0);
    expect(m.find('[data-reinstate]').length).toBe(0);
    m.unmount();
  });
});

describe('ARMORY and a parked player\'s gun', () => {
  // GUN-B in the mock registry is tail 91C2 (mock/data.ts GUNS)
  const worn = { node_id: 'node_91C2', node_type: 'companion', gun_name: 'GUN-B-91C2', gun_tail: '91C2', arm_state: 'kitted', last_seen_ms: 300, synced: true } as unknown as State['nodes'][number];
  it('is not a stray: ON STANDBY + PLAY instead of the claim form', async () => {
    const d = await demo();
    const parked = { ...d.state.players.find(p => p.gun_id === 'GUN-B')!, node_id: null, ready: false };
    const s: State = { ...d.state, players: d.state.players.filter(p => p.gun_id !== 'GUN-B'), standby: [parked], nodes: [worn] };
    const calls: string[] = [];
    const m = await mountScreen(<Armory />, { ...d, state: s, view: 'muster', api: { reinstatePlayer: async (id: string) => { calls.push(id); return parked; } } });
    const card = m.find('[data-node-card="node_91C2"]');
    expect(card.length).toBe(1);
    expect(card[0].textContent).toContain(`ON STANDBY · ${parked.display}`);
    expect(card[0].textContent).not.toContain('WHO CARRIES THIS?');
    expect(card[0].querySelectorAll('input').length, 'no gamertag field').toBe(0);
    const play = card[0].querySelector(`[data-reinstate="${parked.player_id}"]`) as HTMLElement;
    expect(play).toBeTruthy();
    play.click();
    await new Promise(r => setTimeout(r, 0));
    expect(calls).toEqual([parked.player_id]);
    m.unmount();
  });
  it('the same gun with nobody parked still gets the claim form', async () => {
    const d = await demo();
    const s: State = { ...d.state, players: d.state.players.filter(p => p.gun_id !== 'GUN-B'), standby: [], nodes: [worn] };
    const m = await mountScreen(<Armory />, { ...d, state: s, view: 'muster' });
    const card = m.find('[data-node-card="node_91C2"]')[0];
    expect(card.textContent).toContain('WHO CARRIES THIS?');
    expect(card.querySelector('[data-standby-holder]')).toBeNull();
    m.unmount();
  });
});

describe('MockBackend standby', () => {
  it('stand down and reinstate both work through the pushed LOBBY, and refuse once armed', async () => {
    const b = new MockBackend();
    const s0 = await b.getState();
    for (const p of s0.players) await b.setReady(p.player_id, true);
    await b.pushLobby(true);
    expect((await b.getState()).phase).toBe('lobby');
    const target = s0.players[1];
    const parked = await b.standbyPlayer(target.player_id);
    expect(parked.player_id).toBe(target.player_id);
    let st = await b.getState();
    expect(st.standby!.map(p => p.player_id)).toEqual([target.player_id]);
    expect(st.players.some(p => p.player_id === target.player_id)).toBe(false);
    await expect(b.addPlayer({ display: 'ROCCO', gun_id: target.gun_id! })).rejects.toThrow(/on standby with .* - PLAY puts them back/);
    const back = await b.reinstatePlayer(target.player_id);
    expect(back.player_num).toBe(target.player_num);
    st = await b.getState();
    expect(st.standby).toEqual([]);
    expect(st.players.some(p => p.player_id === target.player_id)).toBe(true);
    await b.start(60);
    expect((await b.getState()).phase).toBe('armed');
    await expect(b.standbyPlayer(target.player_id)).rejects.toThrow(/after the match has started/);
    b.dispose();
  });
});

