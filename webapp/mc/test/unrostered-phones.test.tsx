// F-3 / A38 (2026-09-13). Field 2026-09-12: "4 guns connected, only 2 in lobby" — a connected companion
// phone with a gun set that nobody on the roster had claimed was invisible anywhere but ARMORY's own
// claim card. `readiness.unrostered_phones` (state.py unrostered_phone_count / mock/backend.ts) is the
// server's count; KIT and LOBBY each show a banner from it that links straight to ARMORY.
import { describe, expect, it, vi } from 'vitest';
import type { State } from '../src/api/types';
import { Kit } from '../src/screens/Kit';
import { Lobby } from '../src/screens/Lobby';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import { demo, makeStore, mount, mountScreen } from './harness';

describe('MockBackend unrostered_phones', () => {
  it('a gun whose player left the roster counts as a stray; re-claiming it clears the count', async () => {
    const b = new MockBackend();
    const before = await b.getState();
    expect(before.readiness.unrostered_phones, 'control: the demo starts with every gun claimed').toBe(0);
    const target = before.players[0];
    await b.deletePlayer(target.player_id);
    let st = await b.getState();
    expect(st.readiness.unrostered_phones, 'the gun is still connected; nobody claims it now').toBe(1);
    await b.addPlayer({ display: 'NEWGUY', gun_id: target.gun_id! });
    st = await b.getState();
    expect(st.readiness.unrostered_phones, 'claimed again — no longer a stray').toBe(0);
  });

  it('a parked STANDBY player\'s gun does not count as a stray', async () => {
    const b = new MockBackend();
    const target = (await b.getState()).players[0];
    await b.standbyPlayer(target.player_id);
    const st = await b.getState();
    expect(st.readiness.unrostered_phones, 'a deliberate stand-down, not a stray').toBe(0);
  });
});

describe('UnrosteredPhonesBanner on KIT and LOBBY', () => {
  it('hidden when the count is zero, on both screens', async () => {
    const d = await demo();
    const s: State = { ...d.state, readiness: { ...d.state.readiness, unrostered_phones: 0 } };
    for (const Screen of [Kit, Lobby]) {
      const m = await mountScreen(<Screen />, { ...d, state: s, view: 'kit', selPlayer: s.players[0]?.player_id });
      expect(m.find('[data-unrostered-phones]').length).toBe(0);
      m.unmount();
    }
  });

  it('shows the count and links to ARMORY on both screens', async () => {
    const d = await demo();
    const s: State = { ...d.state, readiness: { ...d.state.readiness, unrostered_phones: 3 } };
    for (const Screen of [Kit, Lobby]) {
      const setView = vi.fn();
      const store = makeStore({ ...d, state: s, view: 'kit', selPlayer: s.players[0]?.player_id }, { setView });
      const m = await mount(<StoreCtx.Provider value={store}><Screen /></StoreCtx.Provider>);
      const banner = m.find('[data-unrostered-phones]')[0];
      expect(banner, `${Screen.name} shows the CTA`).toBeTruthy();
      expect(banner.textContent).toContain('3 CONNECTED PHONES NOT IN THE ROSTER');
      banner.click();
      expect(setView, `${Screen.name} banner navigates to ARMORY`).toHaveBeenCalledWith('muster');
      m.unmount();
    }
  });

  it('singular wording for exactly one', async () => {
    const d = await demo();
    const s: State = { ...d.state, readiness: { ...d.state.readiness, unrostered_phones: 1 } };
    const m = await mountScreen(<Kit />, { ...d, state: s, view: 'kit', selPlayer: s.players[0]?.player_id });
    expect(m.find('[data-unrostered-phones]')[0].textContent).toContain('1 CONNECTED PHONE NOT IN THE ROSTER');
    expect(m.text()).not.toContain('1 CONNECTED PHONES');
    m.unmount();
  });

  it('absent on a server that predates the field (no crash, no invented count)', async () => {
    const d = await demo();
    const { unrostered_phones: _drop, ...rest } = d.state.readiness;
    const s: State = { ...d.state, readiness: rest as State['readiness'] };
    const m = await mountScreen(<Kit />, { ...d, state: s, view: 'kit', selPlayer: s.players[0]?.player_id });
    expect(m.find('[data-unrostered-phones]').length).toBe(0);
    m.unmount();
  });
});
