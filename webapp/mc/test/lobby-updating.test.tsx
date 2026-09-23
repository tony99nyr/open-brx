// F178 (Tony, 2026-09-23): READY stays the player's intent. A READY player whose gun has not answered
// the pushed head yet is counted apart ("6/7 READY · 1 UPDATING"), so the host sees why ARM refuses
// instead of an all-green count over a refusal. `lobby.updating` is the server's tally.
import { describe, expect, it } from 'vitest';
import type { State } from '../src/api/types';
import { Lobby } from '../src/screens/Lobby';
import { demo, mountScreen } from './harness';

const readied = (s: State, updating?: number): State => ({
  ...s, phase: 'lobby', players: s.players.map(p => ({ ...p, ready: true })),
  lobby: { ...s.lobby, pushed: true, ready: s.players.length, updating },
});

describe('LOBBY: READY count names the phones still updating', () => {
  it('splits the count when the server reports READY players on an older head', async () => {
    const d = await demo();
    const n = d.state.players.length;
    expect(n, 'control: the demo roster has players').toBeGreaterThan(1);
    const m = await mountScreen(<Lobby />, { ...d, state: readied(d.state, 1), view: 'lobby' });
    expect(m.text()).toContain(`${n - 1}/${n} READY`);
    const tag = m.find('[data-updating="1"]')[0];
    expect(tag, 'the UPDATING tag beside the READY count').toBeTruthy();
    expect(tag.textContent).toContain('1 UPDATING');
    expect(m.text()).toContain('1 updating');       // the rail step says the same
    m.unmount();
  });

  it('shows the full count and no UPDATING tag when nobody is updating', async () => {
    const d = await demo();
    const n = d.state.players.length;
    const m = await mountScreen(<Lobby />, { ...d, state: readied(d.state, 0), view: 'lobby' });
    expect(m.text()).toContain(`${n}/${n} READY`);
    expect(m.find('[data-updating="1"]').length).toBe(0);
    m.unmount();
  });

  it('reads an older server with no `updating` field as nobody updating', async () => {
    const d = await demo();
    const n = d.state.players.length;
    const m = await mountScreen(<Lobby />, { ...d, state: readied(d.state, undefined), view: 'lobby' });
    expect(m.text()).toContain(`${n}/${n} READY`);
    expect(m.find('[data-updating="1"]').length).toBe(0);
    m.unmount();
  });
});
