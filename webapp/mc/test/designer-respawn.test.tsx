// Respawn profiles in the DESIGNER (2026-09-19, docs/spec/contracts.md §3). A TIMED respawn (`type`
// "auto") holds the trigger for `weapon_delay_ms` after the T-0 spawn, and with protection on, never
// sooner than 500 ms after protection ends. A STATION respawn (`type` "scanner") is protected instead,
// with the trigger live at once and a shield shown on the headset. `type` "none" has neither. See
// `Designer.tsx` ~line 168-196 and `contract.gen.ts`'s `Respawn`/`TimedProtectS`/`WeaponDelayMs`/
// `StationProtectS`/`*_DEFAULT`.
import { describe, expect, it } from 'vitest';
import type { Api, GameConfig } from '../src/api/types';
import { Designer } from '../src/screens/Designer';
import { StoreCtx } from '../src/store';
import { demo, fixtureApi, makeStore, mount } from './harness';

/** Mount the DESIGNER wired to a LIVE MockBackend (so `putConfig` really validates the patch), with a
 *  spy in front of `putConfig` recording every call, the same shape `game-edit-panel.test.tsx` uses. */
async function designerScreen(apiOverrides: Partial<Api> = {}) {
  const d = await demo();
  const calls: Partial<GameConfig>[] = [];
  const api = fixtureApi({
    putConfig: async (patch: Partial<GameConfig>) => { calls.push(patch); return d.api.putConfig(patch); },
    ...apiOverrides,
  }, d.api);
  const store = makeStore({ state: d.state, weapons: d.weapons, perks: d.perks, view: 'build' }, { api });
  const m = await mount(<StoreCtx.Provider value={store}><Designer /></StoreCtx.Provider>);
  await new Promise(r => setTimeout(r, 0));
  return { m, calls, d };
}

describe('DESIGNER respawn profile rows', () => {
  it('shows the TIMED rows under AUTO (the demo default), the STATION row under SCANNER, and neither under NONE', async () => {
    const { m } = await designerScreen();
    // control: the demo's default game is a TIMED respawn
    expect(m.text()).toContain('RESPAWN PROTECTION');
    expect(m.text()).toContain('WEAPON DELAY');
    expect(m.text()).not.toContain('STATION PROTECTION');

    await m.click('NONE');
    expect(m.text()).not.toContain('RESPAWN PROTECTION');
    expect(m.text()).not.toContain('WEAPON DELAY');
    expect(m.text()).not.toContain('STATION PROTECTION');

    await m.click('SCANNER');
    expect(m.text()).not.toContain('RESPAWN PROTECTION');
    expect(m.text()).not.toContain('WEAPON DELAY');
    expect(m.text()).toContain('STATION PROTECTION');
    m.unmount();
  });

  it('choosing 2 S protection and 3 S weapon delay sends both in the PUT /api/config respawn patch', async () => {
    const { m, calls } = await designerScreen();
    await m.click('2 S');   // RESPAWN PROTECTION -> 2
    await m.click('3 S');   // WEAPON DELAY -> 3000 ms
    await m.click('PLAY THIS NOW');
    const call = calls.find(c => c.respawn);
    expect(call, 'a respawn patch was sent').toBeTruthy();
    expect(call!.respawn).toMatchObject({ protect_s: 2, weapon_delay_ms: 3000 });
    m.unmount();
  });

  it('choosing 3 S station protection under SCANNER sends it in the PUT /api/config respawn patch', async () => {
    const { m, calls } = await designerScreen();
    await m.click('SCANNER');
    await m.click('3 S');   // STATION PROTECTION -> 3
    await m.click('PLAY THIS NOW');
    const call = calls.find(c => c.respawn);
    expect(call, 'a respawn patch was sent').toBeTruthy();
    expect(call!.respawn).toMatchObject({ type: 'scanner', station_protect_s: 3 });
    m.unmount();
  });
});
