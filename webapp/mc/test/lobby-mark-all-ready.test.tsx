// MARK ALL READY (bench 2026-09-17). A config re-push from LOBBY (the inline GameEditPanel, or an
// operator edit) mints a fresh head and resets every player's READY to false — correct, but with two
// players already readied up the operator's only fix was tapping HOST OVERRIDE once per player. One
// button, lower left beside the per-player MARK READY tray, shown only while somebody still needs it.
import { describe, expect, it } from 'vitest';
import type { State } from '../src/api/types';
import { Lobby } from '../src/screens/Lobby';
import { demo, mountScreen } from './harness';

const allReady = (s: State): State => ({ ...s, phase: 'lobby', players: s.players.map(p => ({ ...p, ready: true })) });
const someNotReady = (s: State): State => ({ ...s, phase: 'lobby', players: s.players.map((p, i) => ({ ...p, ready: i !== 0 })) });

describe('LOBBY: MARK ALL READY', () => {
  it('is hidden once every rostered player is already ready', async () => {
    const d = await demo();
    const s = allReady(d.state);
    expect(s.players.length).toBeGreaterThan(0);
    const m = await mountScreen(<Lobby />, { ...d, state: s, view: 'lobby' });
    expect(m.text()).not.toContain('MARK ALL READY');
    m.unmount();
  });

  it('shows while at least one rostered player is not ready, in the same lower-left tray as MARK READY', async () => {
    const d = await demo();
    const s = someNotReady(d.state);
    expect(s.players.some(p => !p.ready), 'control: at least one not ready').toBe(true);
    const m = await mountScreen(<Lobby />, { ...d, state: s, view: 'lobby' });
    const tray = m.find('[data-mark-ready="1"]')[0];
    expect(tray, 'the tray that hosts both MARK ALL READY and the per-player buttons').toBeTruthy();
    expect(tray.textContent).toContain('MARK ALL READY');
    m.unmount();
  });

  it('calls the roster-wide route on click, not the per-player one', async () => {
    const d = await demo();
    const s = someNotReady(d.state);
    const calls: string[] = [];
    const m = await mountScreen(<Lobby />, { ...d, state: s, view: 'lobby', api: {
      readyAll: async () => { calls.push('readyAll'); return { ok: true, readied: s.players.filter(p => !p.ready).map(p => p.player_id) }; },
      setReady: async () => { calls.push('setReady'); return s.players[0]; },
    } });
    await m.click('MARK ALL READY');
    expect(calls).toEqual(['readyAll']);
    m.unmount();
  });
});
