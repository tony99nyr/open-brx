// K8 (Tony, field 2026-09-12): the host's per-game VOLUME knob in the inline game editor on KIT and
// LOBBY. VENUE DEFAULT is the absent key (an older server with no `volume` field renders as it), a
// step sends one integer, VENUE DEFAULT sends `null`, and the whole row locks with its neighbours.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { Api, GameConfig, Phase } from '../src/api/types';
import { Kit } from '../src/screens/Kit';
import { StoreCtx } from '../src/store';
import { demo, fixtureApi, makeStore, mount } from './harness';

const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error('no such control on screen');
  await act(async () => { (el as HTMLElement).click(); });
};

async function kit(opts: { phase?: Phase; config?: Partial<GameConfig>; bench?: number; api?: Partial<Api> } = {}) {
  const d = await demo();
  await d.api.setPhase('kit', true);
  d.state = await d.api.getState();
  if (opts.config) d.state = { ...d.state, config: { ...d.state.config, ...opts.config } };
  if (opts.phase) d.state = { ...d.state, phase: opts.phase };
  if (opts.bench != null) d.state = { ...d.state, bench_volume: opts.bench };
  const modes = await d.api.getModes();
  const calls: Partial<GameConfig>[] = [];
  const api = fixtureApi({ putConfig: async (p: Partial<GameConfig>) => { calls.push(p); return d.api.putConfig(p); }, ...opts.api }, d.api);
  const view = 'kit' as const;
  const m = await mount(<StoreCtx.Provider value={makeStore({ ...d, view }, { api, modes })}><Kit /></StoreCtx.Provider>);
  const resync = async () => {
    const state = await d.api.getState();
    await m.update(<StoreCtx.Provider value={makeStore({ ...d, state, view }, { api, modes })}><Kit /></StoreCtx.Provider>);
    return state;
  };
  const panel = () => m.el.querySelector('[data-testid="game-edit-panel"]')!;
  const group = () => panel().querySelector('[data-testid="game-edit-volume"]') as HTMLElement | null;
  const btn = (v: string | number) => group()?.querySelector(`[data-volume="${v}"]`) as HTMLButtonElement | null;
  const note = () => panel().querySelector('[data-testid="game-edit-volume-note"]')?.textContent ?? '';
  const open = () => click(m.find('[data-testid="game-edit-toggle"]')[0]);
  const save = () => panel().querySelector('[data-testid="game-edit-save"] button') as HTMLButtonElement | null;
  return { m, d, calls, resync, group, btn, note, open, save };
}

describe('GameEditPanel VOLUME (K8)', () => {
  it('an older server with no volume field renders VENUE DEFAULT, naming what the venue resolves to', async () => {
    const { m, d, btn, note, open } = await kit();
    expect(d.state.config.volume, 'the demo config carries no knob, like a pre-K8 server').toBeUndefined();
    await open();
    const venue = d.state.config.environment === 'outdoor' ? 90 : 80;
    expect(btn('venue')!.textContent).toBe(`VENUE DEFAULT (${venue})`);
    expect(btn('venue')!.getAttribute('aria-pressed')).toBe('true');
    for (const v of [60, 70, 80, 90, 100]) expect(btn(v)!.getAttribute('aria-pressed'), `${v}`).toBe('false');
    expect(note()).toContain(`PLAYS AT ${venue}`);
    m.unmount();
  });

  it('the indoor venue default reads 80', async () => {
    const { m, btn, open } = await kit({ config: { environment: 'indoor' } });
    await open();
    expect(btn('venue')!.textContent).toBe('VENUE DEFAULT (80)');
    m.unmount();
  });

  it('a step changes the draft, SAVE sends ONE {volume} patch, and the saved value comes back pressed', async () => {
    const { m, calls, btn, note, open, save, resync } = await kit();
    await open();
    await click(btn(70));
    expect(calls, 'a tap edits the draft, it sends nothing').toEqual([]);
    expect(btn(70)!.getAttribute('aria-pressed')).toBe('true');
    expect(btn('venue')!.getAttribute('aria-pressed')).toBe('false');
    expect(note()).toContain('PLAYS AT 70');
    expect(m.text()).toContain('UNSAVED: VOLUME');
    await click(save());
    expect(calls).toEqual([{ volume: 70 }]);
    const st = await resync();
    expect(st.config.volume).toBe(70);
    expect(m.find('[data-testid="game-edit-toggle"]')[0].textContent, 'the collapsed row names the knob').toContain('VOL 70');
    await open();
    expect(btn(70)!.getAttribute('aria-pressed')).toBe('true');
    // back to the venue: the patch is an explicit null, and the key is gone afterwards
    await click(btn('venue'));
    await click(save());
    expect(calls).toEqual([{ volume: 70 }, { volume: null }]);
    expect((await resync()).config.volume).toBeUndefined();
    m.unmount();
  });

  it('a value set another way (the API takes any integer in range) gets its own pressed button', async () => {
    const { m, btn, open } = await kit({ config: { volume: 65 } });
    await open();
    expect(btn(65)!.getAttribute('aria-pressed')).toBe('true');
    m.unmount();
  });

  it('every button reaches 36 px and 11 px text', async () => {
    const { m, group, open } = await kit();
    await open();
    const bs = [...group()!.querySelectorAll('button')];
    expect(bs.length).toBe(6);
    for (const b of bs) {
      expect(parseFloat(b.style.minHeight), b.textContent!).toBeGreaterThanOrEqual(36);
      expect(parseFloat(/(\d+(?:\.\d+)?)px/.exec(b.style.font)![1]), b.textContent!).toBeGreaterThanOrEqual(11);
    }
    m.unmount();
  });

  it('locks with its neighbours while the match is LIVE', async () => {
    const { m, group, open } = await kit({ phase: 'live' });
    await open();
    for (const b of group()!.querySelectorAll('button')) expect(b.matches(':disabled'), b.textContent!).toBe(true);
    expect(m.find('[data-testid="game-edit-locked"]').length).toBe(1);
    m.unmount();
  });

  it('says when --bench-volume overrides the knob on this run', async () => {
    const { m, note, open } = await kit({ bench: 55 });
    await open();
    expect(note()).toContain('BENCH VOLUME 55 OVERRIDES THIS');
    m.unmount();
  });

  it('the mock refuses an out-of-range value in the server\'s words', async () => {
    const d = await demo();
    await d.api.setPhase('kit', true);
    await expect(d.api.putConfig({ volume: 30 })).rejects.toThrow(/60-100/);
    await expect(d.api.putConfig({ volume: 80 })).resolves.toBeTruthy();
  });
});
