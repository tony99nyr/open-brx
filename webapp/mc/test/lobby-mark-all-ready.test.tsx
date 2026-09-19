// MARK ALL READY (bench 2026-09-17). A config re-push from LOBBY (the inline GameEditPanel, or an
// operator edit) mints a fresh head and resets every player's READY to false — correct, but with two
// players already readied up the operator's only fix was tapping HOST OVERRIDE once per player.
//
// Field feedback 2026-09-19 (Tony): this is a common, regular step, and it used to sit as a
// GhostButton down in the lower-left tray with the per-player MARK READY buttons — easy to miss
// while players are still gathering. It now sits as a PrimaryButton in the screen header, beside the
// READY count it changes, and shown only while somebody still needs it (same gate as before).
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

  it('shows while at least one rostered player is not ready, as a prominent button in the header, beside the READY count', async () => {
    const d = await demo();
    const s = someNotReady(d.state);
    expect(s.players.some(p => !p.ready), 'control: at least one not ready').toBe(true);
    const m = await mountScreen(<Lobby />, { ...d, state: s, view: 'lobby' });
    const header = m.find('[data-mark-all-ready="1"]')[0];
    expect(header, 'the header control that hosts MARK ALL READY').toBeTruthy();
    expect(header.textContent).toContain('MARK ALL READY');
    // it left the lower-left tray — that one now hosts only the per-player MARK READY buttons
    const tray = m.find('[data-mark-ready="1"]')[0];
    expect(tray, 'the per-player MARK READY tray').toBeTruthy();
    expect(tray.textContent).not.toContain('MARK ALL READY');
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
