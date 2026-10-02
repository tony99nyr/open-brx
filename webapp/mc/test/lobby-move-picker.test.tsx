// Bench 2026-10-02 (Tony): a BLUE player's row carried a red "▸ RED" chip -- "this is confusing. it says
// red on the blue team guy." The row now has one neutral MOVE button; it opens a picker of the OTHER
// teams, each in its own colour, and a pick moves the player at once (no warning, same patchPlayer).
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Api, State } from '../src/api/types';
import { Lobby } from '../src/screens/Lobby';
import { TEAM } from '../src/tokens';
import { demo, fixtureApi, mountScreen } from './harness';

async function lobby(teams?: string[]) {
  const d = await demo();
  const calls: [string, unknown][] = [];
  const api = fixtureApi({ patchPlayer: (async (id: string, patch: unknown) => { calls.push([id, patch]); return d.api.patchPlayer(id, patch as never); }) as Api['patchPlayer'] }, d.api);
  const base: State = { ...d.state, phase: 'lobby' };
  const state: State = teams
    ? { ...base, config: { ...base.config, teams: teams.map(t => base.config.teams.find(x => x.team_id === t) ?? { team_id: t, name: `${t.toUpperCase()} TEAM`, color: TEAM[t as keyof typeof TEAM], tid: 3 } as never) } }
    : base;
  const m = await mountScreen(<Lobby />, { ...d, api, state, view: 'lobby' });
  const p = state.players.find(x => x.team_id === state.config.teams[0].team_id)!;
  const group = () => m.find(`[aria-label="move ${p.display} to"]`)[0] as HTMLElement;
  const moveBtn = () => group().querySelector('[data-move-open]') as HTMLButtonElement;
  const options = () => Array.from(group().querySelectorAll('[data-move-to]')) as HTMLButtonElement[];
  return { m, p, state, calls, group, moveBtn, options };
}

describe('LOBBY — one neutral MOVE button opens a picker of the other teams', () => {
  it('the closed row shows MOVE, in no team colour, and names no team', async () => {
    const { m, moveBtn, options } = await lobby();
    const b = moveBtn();
    expect(b, 'a MOVE button on the row').toBeTruthy();
    expect(b.textContent).toContain('MOVE');
    const teamColours = Object.values(TEAM).map(c => c.toLowerCase());
    expect(teamColours, `MOVE is not painted a team colour (${b.style.color})`).not.toContain(b.style.color.toLowerCase());
    expect(b.textContent ?? '', 'MOVE names no team').not.toMatch(/RED|BLUE|YELLOW|PURPLE/);
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(options().length, 'no team buttons until MOVE is pressed').toBe(0);
    m.unmount();
  });

  it('MOVE opens the OTHER teams, each in its own colour; a pick moves the player at once and closes', async () => {
    const { m, p, state, calls, moveBtn, options } = await lobby();
    await act(async () => { moveBtn().click(); });
    expect(moveBtn().getAttribute('aria-expanded')).toBe('true');
    const others = state.config.teams.map(t => t.team_id).filter(t => t !== p.team_id);
    expect(options().map(o => o.dataset.moveTo)).toEqual(others);
    for (const o of options()) {
      const want = TEAM[o.dataset.moveTo as keyof typeof TEAM];
      expect(o.textContent).toContain(o.dataset.moveTo!.toUpperCase());
      expect(o.style.borderColor || o.style.color, `${o.dataset.moveTo} wears its own colour`).toBeTruthy();
      expect([o.style.color, o.style.borderColor].map(c => c.toLowerCase()).join(' ')).toContain(hexToRgb(want));
      expect(parseFloat(o.style.minHeight), 'a 44 px target').toBeGreaterThanOrEqual(44);
    }
    await act(async () => { options()[0].click(); });
    expect(calls).toEqual([[p.player_id, { team_id: others[0] }]]);
    expect(options().length, 'the picker closes after a pick').toBe(0);
    m.unmount();
  });

  it('with four teams the picker lists all three others, never the player\'s own', async () => {
    const { m, p, moveBtn, options } = await lobby(['blue', 'yellow', 'red', 'purple']);
    await act(async () => { moveBtn().click(); });
    const ids = options().map(o => o.dataset.moveTo);
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain(p.team_id);
    m.unmount();
  });

  it('Escape or a second MOVE press closes the picker without moving anyone', async () => {
    const { m, calls, group, moveBtn, options } = await lobby();
    await act(async () => { moveBtn().click(); });
    await act(async () => { group().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(options().length).toBe(0);
    await act(async () => { moveBtn().click(); });
    await act(async () => { moveBtn().click(); });
    expect(options().length).toBe(0);
    expect(calls).toEqual([]);
    m.unmount();
  });

  it('opening one row\'s picker closes any other row\'s', async () => {
    const { m, state } = await lobby();
    const [a, b] = state.players.slice(0, 2);
    const open = (name: string) => (m.find(`[aria-label="move ${name} to"]`)[0] as HTMLElement).querySelector('[data-move-open]') as HTMLButtonElement;
    await act(async () => { open(a.display).click(); });
    await act(async () => { open(b.display).click(); });
    expect(open(a.display).getAttribute('aria-expanded'), 'the first picker closed').toBe('false');
    expect(open(b.display).getAttribute('aria-expanded')).toBe('true');
    m.unmount();
  });

  it('a drag never starts from a button on the row (a trackpad press on MOVE stays a click)', async () => {
    const { m, group, moveBtn } = await lobby();
    const row = group().closest('[draggable="true"]') as HTMLElement;
    expect(row, 'control: the row is draggable').toBeTruthy();
    moveBtn().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    const ev = new Event('dragstart', { bubbles: true, cancelable: true });
    moveBtn().dispatchEvent(ev);
    expect(ev.defaultPrevented, 'the row refuses a drag that began on a button').toBe(true);
    m.unmount();
  });

  it('a REFUSED move never pulls focus back to that player later (the pending focus expires)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const d = await demo();
      const api = fixtureApi({ patchPlayer: (async () => { throw new Error('PLAYER NOT FOUND'); }) as Api['patchPlayer'] }, d.api);
      const state: State = { ...d.state, phase: 'lobby' };
      const p = state.players[0];
      const m = await mountScreen(<Lobby />, { ...d, api, state, view: 'lobby' });
      const move = () => (m.find(`[aria-label="move ${p.display} to"]`)[0] as HTMLElement).querySelector('[data-move-open]') as HTMLButtonElement;
      await act(async () => { move().click(); });
      const opt = (m.find(`[aria-label="move ${p.display} to"]`)[0] as HTMLElement).querySelector('[data-move-to]') as HTMLButtonElement;
      await act(async () => { opt.click(); });
      m.unmount();
      (document.activeElement as HTMLElement | null)?.blur();
      vi.setSystemTime(Date.now() + 500);   // soon after, well inside the window: the refusal itself must have cleared it
      const m2 = await mountScreen(<Lobby />, { ...d, api, state, view: 'lobby' });
      expect(document.activeElement?.hasAttribute('data-move-open') ?? false, 'no focus theft on an unrelated remount').toBe(false);
      m2.unmount();
    } finally { vi.useRealTimers(); }
  });
});

function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
