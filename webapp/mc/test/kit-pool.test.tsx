// The per-player ACCESSIBILITY block on KIT (modes §1.1 `loadout.overrides`): the POOL handicap
// {max_hp, max_armor}, and EASY RELOAD. The server has carried the pool per player since A10 and the
// compiler puts it on THAT player's $PSET, but nothing in the console ever set it, so a handicap
// could only be applied with a curl. S50 (2026-09-17) moved `easy_reload` into the same block, and
// it arrived the same way: on the wire, with no control in either UI.
//
// The rule these steps encode: a player armed or set up differently from everyone else is a rule of
// the match, not a hidden setting. It must be visible on the roster without selecting them, it must
// state the game's own numbers beside the player's, and clearing it must be one tap.
//
// The second rule: the two switches are INDEPENDENT (Tony, 2026-09-17 — a younger player takes both,
// a left-handed player takes Easy Reload and no extra health). Easy Reload is ACCESSIBILITY, not a
// perk and not a balance knob, so no write that touches one switch may take the other away.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { Loadout, LoadoutOverrides, Player } from '../src/api/types';
import { Kit } from '../src/screens/Kit';
import { demo, mountScreen } from './harness';

/** Mount KIT on one demo player, recording every loadout PATCH the screen sends. */
async function kitFor(pid: string, apiOverrides: Record<string, unknown> = {}, pre?: LoadoutOverrides) {
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
  /** Tap one side of the EASY RELOAD switch, the way a host does: the segment says what it will be,
   *  not what it is, so the test names the side rather than "toggle". */
  const easy = async (side: 'ON' | 'OFF') => {
    const group = m.find('[aria-label^="easy reload"]')[0];
    if (!group) throw new Error('no EASY RELOAD control on the kit rail');
    const btn = (Array.from(group.querySelectorAll('button')) as HTMLElement[])
      .find(b => (b.textContent ?? '').trim() === side);
    if (!btn) throw new Error(`no ${side} on the EASY RELOAD control`);
    await act(async () => { btn.click(); });
  };
  const easyPressed = () => {
    const group = m.find('[aria-label^="easy reload"]')[0];
    return (Array.from(group.querySelectorAll('button')) as HTMLElement[])
      .filter(b => b.getAttribute('aria-pressed') === 'true').map(b => (b.textContent ?? '').trim());
  };
  return { m, patches, hp, ar, setBox, easy, easyPressed, state: d.state };
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

  it('MATCH THE GAME POOL keeps Easy Reload: clearing a handicap is not a reason to take a reload button away', async () => {
    const { m, patches } = await kitFor('p4', {}, { max_hp: 200, easy_reload: true });
    await m.click('MATCH THE GAME POOL');
    expect(patches.length, 'one PATCH').toBe(1);
    expect(patches[0].overrides, 'the pool goes, the accessibility switch stays').toEqual({ easy_reload: true });
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

describe('KIT · per-player Easy Reload', () => {
  it('the switch sends the override, and carries the kit through untouched', async () => {
    const { m, patches, easy, easyPressed, state } = await kitFor('p4');   // SMG, no secondary, no perk
    expect(easyPressed(), 'a player with no override starts OFF').toEqual(['OFF']);
    const before = state.players.find(p => p.player_id === 'p4')!.loadout;
    await easy('ON');
    expect(patches.length, 'exactly one PATCH').toBe(1);
    expect(patches[0].overrides).toEqual({ easy_reload: true });
    // the server rejects a loadout with no weapons (state.py _clean_loadout), so they must ride along
    expect(patches[0].weapons).toEqual(before.weapons);
    expect(patches[0].perk).toBe(before.perk ?? null);
    m.unmount();
  });

  it('switching it off leaves a pool handicap standing: the two switches are independent', async () => {
    const { m, patches, easy } = await kitFor('p4', {}, { max_hp: 200, easy_reload: true });
    await easy('OFF');
    expect(patches.length, 'one PATCH').toBe(1);
    expect(patches[0].overrides, 'only the reload button goes').toEqual({ max_hp: 200 });
    m.unmount();
  });

  it('tapping the side it is already on writes nothing', async () => {
    const { m, patches, easy } = await kitFor('p4', {}, { easy_reload: true });
    await easy('ON');
    expect(patches.length, 'a no-op tap must not push a loadout to the phone').toBe(0);
    m.unmount();
  });

  it('a player on it: the card says so in the host\'s words, and the roster marks them', async () => {
    const { m, easyPressed, state } = await kitFor('p4', {}, { easy_reload: true });
    const name = state.players.find(p => p.player_id === 'p4')!.display.toUpperCase();
    expect(easyPressed()).toEqual(['ON']);
    const card = m.find('[data-pool-card]')[0].textContent ?? '';
    expect(card, 'names the player so it reads as deliberate').toContain(name);
    expect(card, 'says what the gun does, not what the wire does').toContain('ALT BUTTON');
    expect(card, 'and why there is no second weapon').toContain('ALT CANNOT DO BOTH');
    const chip = m.find('[data-easy-chip="p4"]');
    expect(chip.length, 'visible on the roster without selecting anyone').toBe(1);
    expect(chip[0].textContent).toContain('ALT RELOADS');
    expect(m.find('[data-easy-chip="p1"]').length, 'and only on the players who are on it').toBe(0);
    m.unmount();
  });

  it('it is offered as accessibility, never as an advantage', async () => {
    const { m } = await kitFor('p4');
    const card = m.find('[data-pool-card]')[0].textContent ?? '';
    expect(card).toContain('CANNOT WORK THE RELOAD LEVER');
    expect(card, 'a host must not read it as a perk worth handing out').toContain('WINS NO FIGHTS');
    m.unmount();
  });

  it('switching it on beside a second weapon is a two-tap that names the weapon it drops', async () => {
    // ALT cannot reload and swap: the server refuses the pair (policy.conflict), so the console asks
    // before it sends rather than collecting a 400. p1 is AR + Desert Eagle + Quick Switch.
    const { m, patches, easy } = await kitFor('p1');
    await easy('ON');
    expect(patches.length, 'the first tap sends nothing').toBe(0);
    expect(m.find('[data-easy-ask]')[0]?.textContent, 'it names what goes').toContain('DESERT EAGLE');
    await easy('ON');
    expect(patches.length, 'the second tap sends').toBe(1);
    expect(patches[0].weapons, 'the second weapon is dropped with it').toEqual([{ weapon_id: 'assault_rifle' }]);
    expect(patches[0].perk, 'the perk is not the thing that owns the button, so it stays').toBe('quick_switch');
    expect(patches[0].overrides).toEqual({ easy_reload: true });
    m.unmount();
  });

  it('a refused switch never repaints the card: it still reads OFF', async () => {
    // F123: the server also refuses Easy Reload on a chain-reload weapon (the shotgun reloads shell by
    // shell, by HOLDING the handle). The console cannot see `reload_type` — WeaponView does not carry
    // it — so that refusal arrives as a 400, and the card must keep showing what the gun really has.
    const { m, easy, easyPressed } = await kitFor('p2',
      { patchPlayer: async () => { throw new Error('400 Easy Reload cannot reload the Shotgun'); } });
    await easy('ON');
    await easy('ON');                                   // through the two-tap: p2 carries a shotgun secondary
    expect(easyPressed(), 'a refused override must not appear applied').toEqual(['OFF']);
    expect(m.find('[data-easy-chip="p2"]').length).toBe(0);
    m.unmount();
  });
});
