// F-armory-claim (operator, 2026-09-16): ARMORY's claim card sent `team_id: 'blue'|'yellow'`, which
// the server refuses outright in FFA (only `ffa` exists there -- state.py `_check_team`). The refusal
// only ever reached the shared error strip, so the card looked unchanged and the operator read that
// as "nothing happened". The fix: the claim sets a gamertag only (the server auto-balances a team
// when it is omitted), and a refused claim shows its error ON THE CARD.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { Armory } from '../src/screens/Armory';
import { MockBackend } from '../src/mock/backend';
import type { State } from '../src/api/types';
import { demo, mountScreen } from './harness';

/** type into a card's gamertag field and submit it, settling every effect the click causes. */
async function typeAndSubmit(card: HTMLElement, name: string) {
  const form = card.querySelector('form') as HTMLFormElement;
  const input = form.querySelector('input') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    (form.querySelector('button') as HTMLElement).click();
    await new Promise(r => setTimeout(r, 0));
  });
}

describe('MockBackend.addPlayer auto-balances a team, mirroring state.py add_player', () => {
  it('a claim with no team_id lands on the FFA team in an FFA config', async () => {
    const b = new MockBackend();
    await b.putConfig({ mode: 'ffa' });
    const target = (await b.getState()).players[0];
    await b.deletePlayer(target.player_id);
    const p = await b.addPlayer({ display: 'ROCCO', gun_id: target.gun_id! });
    expect(p.team_id).toBe('ffa');
  });

  it('a claim with no team_id auto-balances onto a declared team in a TDM config', async () => {
    const b = new MockBackend();   // the mock starts in TDM (MODES[0]) -- control, asserted below
    const before = await b.getState();
    expect(before.config.mode).toBe('tdm');
    const target = before.players[0];
    await b.deletePlayer(target.player_id);
    const p = await b.addPlayer({ display: 'ROCCO', gun_id: target.gun_id! });
    // pre-fix, an omitted team_id fell through to `?? null` and never balanced at all
    expect(p.team_id).not.toBeNull();
    expect(before.config.teams.map(t => t.team_id)).toContain(p.team_id);
  });

  it('still refuses a team_id naming no declared team (the bug the fix removes from the UI path)', async () => {
    const b = new MockBackend();
    const target = (await b.getState()).players[0];
    await b.deletePlayer(target.player_id);
    await expect(b.addPlayer({ display: 'ROCCO', team_id: 'nonexistent', gun_id: target.gun_id! }))
      .rejects.toThrow(/unknown team_id/);
  });
});

// GUN-B in the mock registry is tail 91C2 (mock/data.ts GUNS) -- same fixture lobby-standby.test.tsx uses
const worn = { node_id: 'node_91C2', node_type: 'companion', gun_name: 'GUN-B-91C2', gun_tail: '91C2', arm_state: 'kitted', last_seen_ms: 300, synced: true } as unknown as State['nodes'][number];

async function claimableState() {
  const d = await demo();
  const s: State = { ...d.state, players: d.state.players.filter(p => p.gun_id !== 'GUN-B'), standby: [], nodes: [worn] };
  return { d, s };
}

describe('ARMORY claim card', () => {
  it('offers one SET GAMERTAG submit, not a team choice', async () => {
    const { d, s } = await claimableState();
    const m = await mountScreen(<Armory />, { ...d, state: s, view: 'muster' });
    const card = m.find('[data-node-card="node_91C2"]')[0];
    expect(card.textContent).toContain('SET GAMERTAG');
    expect(card.textContent).not.toContain('JOIN BLUE');
    expect(card.textContent).not.toContain('JOIN YELLOW');
    expect(card.querySelector('form')!.querySelectorAll('button').length, 'exactly one submit control in the claim form').toBe(1);
    m.unmount();
  });

  it('submits a gamertag with no team_id -- the server auto-balances one', async () => {
    const { d, s } = await claimableState();
    const calls: unknown[] = [];
    const m = await mountScreen(<Armory />, {
      ...d, state: s, view: 'muster',
      api: { addPlayer: async p => { calls.push(p); return { player_id: 'p_new', player_num: 9, display: 'ROCCO', team_id: 'ffa', node_id: null, gun_id: 'GUN-B', loadout: { weapons: [], perk: null }, voice: 'male', ready: false }; } },
    });
    const card = m.find('[data-node-card="node_91C2"]')[0];
    await typeAndSubmit(card, 'ROCCO');
    expect(calls).toEqual([{ display: 'ROCCO', gun_id: 'GUN-B' }]);   // NO team_id key at all
    m.unmount();
  });

  it('a refused claim shows the error on this card, not only in the shared strip', async () => {
    const { d, s } = await claimableState();
    let sharedStripSaw: string | null = null;
    const m = await mountScreen(<Armory />, {
      ...d, state: s, view: 'muster',
      api: { addPlayer: async () => { throw new Error("roster full"); } },
    });
    // the fixture store's default `run` swallows the error into nothing visible -- the card must not
    // depend on it. `sharedStripSaw` stands in for "whatever the shared strip does or does not show".
    void sharedStripSaw;
    const card = m.find('[data-node-card="node_91C2"]')[0];
    await typeAndSubmit(card, 'ROCCO');
    expect(card.querySelector('[data-claim-error]'), 'the card renders its own error').toBeTruthy();
    expect(card.textContent).toContain('ROSTER FULL');
    m.unmount();
  });
});
