// Bench 2026-09-16: after an MC restart the operator went GAMES → LOBBY without KIT. Nothing had opened
// the kit and nothing was pushed, so both phones said HOST IS SETTING UP THE GAME and nobody could
// ready up. The rail said "Not ready yet: A, B" and nothing about the step that frees them.
import { describe, expect, it } from 'vitest';
import type { State } from '../src/api/types';
import { Lobby } from '../src/screens/Lobby';
import { demo, mountScreen } from './harness';

const lobbyWith = (s: State, pushed: boolean): State => ({
  ...s,
  phase: 'lobby',
  players: s.players.map(p => ({ ...p, ready: false })),
  lobby: { ...s.lobby, pushed, ready: 0, acks: {}, all_acked: false },
  readiness: { ...s.readiness, roster_faults: [],
               board: s.readiness.board.map(r => ({ ...r, status: 'green', blockers: [], ambers: [] })) },
});
const railLine = (m: { find(sel: string): HTMLElement[] }) => m.find('[data-rail="lobby"]')[0].textContent ?? '';

describe('LOBBY before the push, with nobody ready', () => {
  it('names the step that gets the phones off SETTING UP', async () => {
    const d = await demo();
    const m = await mountScreen(<Lobby />, { ...d, state: lobbyWith(d.state, false), view: 'lobby' });
    expect(railLine(m)).toContain('Not ready yet:');
    expect(railLine(m)).toContain('HOST IS SETTING UP until you open KIT or push the config');
    m.unmount();
  });

  it('says nothing about SETTING UP once the config is pushed', async () => {
    const d = await demo();
    const m = await mountScreen(<Lobby />, { ...d, state: lobbyWith(d.state, true), view: 'lobby' });
    expect(railLine(m)).not.toContain('SETTING UP');
    m.unmount();
  });
});
