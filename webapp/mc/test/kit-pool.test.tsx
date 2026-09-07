// Per-player POOL override on KIT (modes §1.1 `loadout.overrides`). The server has carried
// {max_hp, max_armor} per player since A10 and the compiler puts them on THAT player's $PSET, but
// nothing in the console ever set them, so a handicap could only be applied with a curl.
//
// The rule these steps encode: a player armed differently from everyone else is a rule of the
// match, not a hidden setting. It must be visible on the roster without selecting them, it must
// state the game's own numbers beside the player's, and clearing it must be one tap.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { Loadout, Player } from '../src/api/types';
import { Kit } from '../src/screens/Kit';
import { demo, mountScreen } from './harness';

/** Mount KIT on one demo player, recording every loadout PATCH the screen sends. */
async function kitFor(pid: string, apiOverrides: Record<string, unknown> = {}, pre?: { max_hp?: number; max_armor?: number }) {
  const d = await demo();
  // The console re-renders from the server's pushed state, which this fixture holds still. To test
  // what an ALREADY-handicapped player looks like, apply it to the backend before mounting and take
  // a fresh snapshot -- rather than patching and asserting a re-render this harness never performs.
  if (pre) {
    const cur = (await d.api.getState()).players.find(p => p.player_id === pid)!;
    await d.api.patchPlayer(pid, { loadout: { ...cur.loadout, overrides: pre } });
    d.state = await d.api.getState();
  }
  const patches: Loadout[] = [];
  const api = {
    patchPlayer: async (id: string, patch: Partial<Player>) => {
      if (patch.loadout) patches.push(patch.loadout);
      return d.api.patchPlayer(id, patch);
    },
    ...apiOverrides,
  };
  const m = await mountScreen(<Kit />, { ...d, view: 'kit', selPlayer: pid, api });
  const hp = () => m.find('input[aria-label$="health"]')[0] as HTMLInputElement;
  const ar = () => m.find('input[aria-label$="armor"]')[0] as HTMLInputElement;
  /** Drive a ValueBox the way a person does: focus, type, leave. It commits on blur, and React
   *  hears blur as `focusout`, so a plain non-bubbling 'blur' event would silently do nothing. */
  const setBox = async (el: HTMLInputElement, v: string) => {
    await act(async () => {
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.blur();
    });
  };
  return { m, patches, hp, ar, setBox, state: d.state };
}

describe('KIT · per-player pool override', () => {
  it('starts on the game pool: no multiplier, no roster chip, both fields read SAME AS GAME', async () => {
    const { m, state } = await kitFor('p1');
    const health = state.config.health;
    expect(m.find('[data-pool-card]').length, 'the POOL card is on the kit rail').toBe(1);
    expect(m.find('[data-pool-state]')[0].textContent).toContain('GAME DEFAULT');
    expect(m.text()).toContain('SAME AS GAME');
    expect(m.find('[data-pool-chip]').length, 'nobody is marked handicapped yet').toBe(0);
    // the boxes show the game's numbers, so the host is editing from the real baseline
    expect(Number((m.find('input[aria-label$="health"]')[0] as HTMLInputElement).value)).toBe(health.max_hp);
    expect(Number((m.find('input[aria-label$="armor"]')[0] as HTMLInputElement).value)).toBe(health.max_armor);
    m.unmount();
  });

  it('setting health sends the whole loadout with the override, and never drops the weapons', async () => {
    const { m, patches, hp, setBox, state } = await kitFor('p1');
    const before = state.players.find(p => p.player_id === 'p1')!.loadout;
    await setBox(hp(), '200');
    expect(patches.length, 'exactly one PATCH').toBe(1);
    expect(patches[0].overrides).toEqual({ max_hp: 200 });
    // the server rejects a loadout with no weapons (state.py _clean_loadout), so they must ride along
    expect(patches[0].weapons).toEqual(before.weapons);
    expect(patches[0].perk).toBe(before.perk ?? null);
    m.unmount();
  });

  it('an overridden player: the card names them, sizes the advantage, and keeps the game number in view', async () => {
    const { m, state } = await kitFor('p1', {}, { max_hp: 200, max_armor: 100 });
    const name = state.players.find(p => p.player_id === 'p1')!.display.toUpperCase();
    const card = m.find('[data-pool-card]')[0].textContent ?? '';
    expect(card, 'names the player so it reads as deliberate').toContain(name);
    expect(card).toContain('ON PURPOSE');
    expect(card, 'says the rest of the squad is unaffected').toContain('EVERY OTHER PLAYER USES THE GAME POOL');
    expect(card, 'states the pool that gun is armed with').toContain('200 HP / 100 AR');
    expect(m.find('[data-pool-state]')[0].textContent, 'sizes it against the game pool').toMatch(/\u00d7 GAME POOL/);
    expect(m.find('[data-pool-base="max_hp"]')[0].textContent).toContain(`GAME ${state.config.health.max_hp}`);
    m.unmount();
  });

  it('the roster marks the handicapped player, so it is visible without selecting them', async () => {
    const { m } = await kitFor('p1', {}, { max_hp: 200, max_armor: 100 });
    const chips = m.find('[data-pool-chip]');
    expect(chips.length, 'exactly the one player carries the mark').toBe(1);
    expect(chips[0].getAttribute('data-pool-chip')).toBe('p1');
    expect(chips[0].textContent).toContain('200/100');
    m.unmount();
  });

  it('armor may be set to 0: a handicap has to be able to take a pool away, not only add', async () => {
    const { m, ar, setBox, patches } = await kitFor('p1');
    expect((m.find('input[aria-label$="armor"]')[0] as HTMLInputElement).min, 'the box must allow 0').toBe('0');
    await setBox(ar(), '0');
    expect(patches[0].overrides).toEqual({ max_armor: 0 });
    m.unmount();
  });

  it('MATCH THE GAME POOL clears it: the PATCH carries no overrides key at all', async () => {
    const { m, patches } = await kitFor('p1', {}, { max_hp: 200 });
    await m.click('MATCH THE GAME POOL');
    expect(patches.length, 'one PATCH').toBe(1);
    expect(patches[0].overrides,
      'an undefined key is dropped by JSON.stringify, which is how the server is told to clear it').toBeUndefined();
    expect(patches[0].weapons?.length, 'the weapons still ride along or the server rejects the shape').toBeGreaterThan(0);
    m.unmount();
  });

  it('a refused change never repaints the pool: the card still shows what the gun is really armed with', async () => {
    // An older MC rejects max_armor: 0 (it required 1..999). The screen must keep showing the pool
    // that is actually on the gun, not the one the host tried to set.
    const { m, ar, setBox } = await kitFor('p1',
      { patchPlayer: async () => { throw new Error('400 overrides.max_armor must be an integer 1..999'); } },
      { max_hp: 200, max_armor: 100 });
    await setBox(ar(), '0');
    const card = m.find('[data-pool-card]')[0].textContent ?? '';
    expect(card, 'a refused override must not appear applied').toContain('200 HP / 100 AR');
    expect(m.find('[data-pool-chip]')[0].textContent).toContain('200/100');
    m.unmount();
  });
});
