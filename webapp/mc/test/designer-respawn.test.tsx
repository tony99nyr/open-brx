// Respawn profiles in the DESIGNER (2026-09-19, docs/spec/contracts.md §3). A TIMED respawn (`type`
// "auto") holds the trigger for `weapon_delay_ms` after the T-0 spawn, and with protection on, never
// sooner than 500 ms after protection ends. A STATION respawn (`type` "scanner") is protected instead,
// with the trigger live at once and a shield shown on the headset. `type` "none" has neither. See
// `Designer.tsx` ~line 168-196 and `contract.gen.ts`'s `Respawn`/`TimedProtectS`/`WeaponDelayMs`/
// `StationProtectS`/`*_DEFAULT`.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { Api, GameConfig, SavedGame } from '../src/api/types';
import { Designer } from '../src/screens/Designer';
import { StoreCtx, type DesignerSeed } from '../src/store';
import { demo, fixtureApi, makeStore, mount } from './harness';

/** Mount the DESIGNER wired to a LIVE MockBackend (so `putConfig` really validates the patch), with a
 *  spy in front of `putConfig` recording every call, the same shape `game-edit-panel.test.tsx` uses. */
async function designerScreen(apiOverrides: Partial<Api> = {}, designerSeed: DesignerSeed | null = null) {
  const d = await demo();
  const calls: Partial<GameConfig>[] = [];
  const flow: string[] = [];
  const api = fixtureApi({
    putConfig: async (patch: Partial<GameConfig>) => { calls.push(patch); return d.api.putConfig(patch); },
    savePreset: async body => { flow.push('save'); return d.api.savePreset(body); },
    applyPreset: async presetId => { flow.push('apply'); return d.api.applyPreset(presetId); },
    loadGame: async () => { flow.push('load'); return d.api.loadGame(); },
    setPhase: async (phase: string) => { flow.push(`phase:${phase}`); return d.api.setPhase(phase); },
    ...apiOverrides,
  }, d.api);
  const store = makeStore({ state: d.state, weapons: d.weapons, perks: d.perks, view: 'build' }, { api, designerSeed });
  const m = await mount(<StoreCtx.Provider value={store}><Designer /></StoreCtx.Provider>);
  await new Promise(r => setTimeout(r, 0));
  return { m, calls, flow, d };
}

describe('DESIGNER respawn profile rows', () => {
  it('F188: PLAY THIS NOW loads the applied game before entering KIT', async () => {
    const { m, flow } = await designerScreen();
    await m.click('PLAY THIS NOW');
    expect(flow).toEqual(['load', 'phase:kit']);
    m.unmount();
  });

  it('F188: a named draft saves and applies before LOAD, then enters KIT', async () => {
    const d = await demo();
    const game: SavedGame = { preset_id: 'builtin:test', name: 'Named Test Game', desc: '', builtin: true,
      created_t: 0, updated_t: 0, config: d.state.config };
    const { m, flow } = await designerScreen({}, { game, copy: true });
    await m.click('PLAY THIS NOW');
    expect(flow).toEqual(['save', 'apply', 'load', 'phase:kit']);
    m.unmount();
  });

  it('F188: a failed LOAD leaves the operator in Designer and never enters KIT', async () => {
    let attempts = 0;
    const { m, flow } = await designerScreen({
      loadGame: async () => { attempts++; throw new Error('load refused'); },
    });
    await m.click('PLAY THIS NOW');
    expect(attempts).toBe(1);
    expect(flow).toEqual([]);
    m.unmount();
  });

  it('F188: rapid PLAY taps make one transition and lock navigation while LOAD is pending', async () => {
    let loads = 0;
    let release!: (value: { ok: boolean; sent: number; total: number }) => void;
    const pending = new Promise<{ ok: boolean; sent: number; total: number }>(resolve => { release = resolve; });
    const { m, flow } = await designerScreen({ loadGame: async () => { loads++; return pending; } });
    const play = m.find('button').find(b => (b.textContent ?? '').includes('PLAY THIS NOW')) as HTMLButtonElement;
    act(() => { play.click(); play.click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(loads).toBe(1);
    expect(play.disabled).toBe(true);
    const back = m.find('button').find(b => (b.textContent ?? '').includes('BACK TO GAMES')) as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    await act(async () => { release({ ok: true, sent: 0, total: 0 }); await pending; });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(flow).toEqual(['phase:kit']);
    m.unmount();
  });

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
