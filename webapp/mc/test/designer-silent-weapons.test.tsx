// F282 (Tony, 2026-09-25: "yes, MVP; the silenced preset must silence the weapons"): the DESIGNER's
// QUIET WEAPONS switch — the one live control on the read-only ADVANCED panel (Designer.tsx renders
// `<AdvancedPresentation draft={cfg} onSilentWeaponsChange={...} />`; see AdvancedPresentation.tsx).
// It edits `draft.presentation.silent_weapons` directly, shows the draft's current value, and its
// change reaches PUT /api/config on PLAY. An older/absent-field draft renders OFF, never a crash.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { Api, GameConfig } from '../src/api/types';
import { Designer } from '../src/screens/Designer';
import { StoreCtx } from '../src/store';
import { demo, fixtureApi, makeStore, mount } from './harness';

const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error('no such control on screen');
  await act(async () => { (el as HTMLElement).click(); });
};

/** Mount the DESIGNER wired to a LIVE MockBackend, with a spy in front of `putConfig` — the same
 *  shape `designer-respawn.test.tsx` uses. */
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
  // Not `m.click('ADVANCED')`: the LIFE PRESET editor above this panel has its own "▸ ADVANCED" toggle
  // (custom health numbers), so a plain text match hits that one first. Scope to this section.
  const openAdvanced = () => click(m.el.querySelector('[data-testid="advanced-presentation"] button'));
  const theSwitch = () => m.el.querySelector('[data-testid="advanced-presentation"] [role="switch"]') as HTMLElement | null;
  return { m, calls, d, openAdvanced, theSwitch };
}

describe('DESIGNER quiet-weapons switch (F282)', () => {
  it('renders OFF for a fresh draft (the demo config carries no presentation field at all)', async () => {
    const { m, d, openAdvanced, theSwitch } = await designerScreen();
    expect(d.state.config.presentation, 'the fixture is the absent-field case this test wants').toBeFalsy();
    await openAdvanced();
    const sw = theSwitch();
    expect(sw, 'the switch is on screen once ADVANCED is open').toBeTruthy();
    expect(sw!.getAttribute('aria-checked')).toBe('false');
    expect(m.text()).toContain('QUIET WEAPONS');
    expect(m.text()).toContain("Every weapon uses the Suppressor's fire sound");
    m.unmount();
  });

  it('tapping the switch turns it visibly ON and PLAY sends silent_weapons: true in the PUT patch', async () => {
    const { m, calls, openAdvanced, theSwitch } = await designerScreen();
    await openAdvanced();
    const sw = theSwitch()!;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await click(sw);
    expect(theSwitch()!.getAttribute('aria-checked'), 'the control visibly responds').toBe('true');
    // no name typed: `play()` PUTs the draft config directly rather than saving it first (Designer.tsx `play`)
    await m.click('PLAY THIS NOW');
    const call = calls.find(c => c.presentation);
    expect(call, 'a presentation patch was sent').toBeTruthy();
    expect((call!.presentation as Record<string, unknown>).silent_weapons).toBe(true);
    m.unmount();
  });

  it('tapping twice returns it to OFF', async () => {
    const { m, calls, openAdvanced, theSwitch } = await designerScreen();
    await openAdvanced();
    const sw = theSwitch()!;
    await click(sw);
    await click(theSwitch()!);
    expect(theSwitch()!.getAttribute('aria-checked')).toBe('false');
    await m.click('PLAY THIS NOW');
    const call = calls.find(c => c.presentation);
    // either no presentation patch at all, or one that explicitly carries silent_weapons: false —
    // never true, and never a crash either way.
    if (call) expect((call.presentation as Record<string, unknown>).silent_weapons).toBe(false);
    m.unmount();
  });
});
