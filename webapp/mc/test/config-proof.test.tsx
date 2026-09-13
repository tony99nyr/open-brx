// A36 — the console side of "did the config we pushed actually reach the guns?".
//
// Field night 2026-09-12: guns ran a PREVIOUS push in nearly every match and nothing on screen said
// so. The server now says so in three places, and every one of them has to be VISIBLE:
//   * a stale ack and a bad gun echo are ordinary `blockers` on a readiness row (red),
//   * a heartbeat still holding an older head is an ordinary `amber`,
//   * and the LOBBY's own "acked N/M" counter has to ask the same question the server asks, or it
//     reads 4/4 green beside a START the server refuses.
// The strings are the SERVER'S — rendered verbatim, never re-derived here (F33/A32's lesson: two
// rules for one fact disagree exactly when it matters).
import { describe, expect, it } from 'vitest';
import { Armory } from '../src/screens/Armory';
import { Lobby } from '../src/screens/Lobby';
import type { ReadinessRow, State } from '../src/api/types';
import { demo, mountScreen } from './harness';

const STALE = 'ACKED AN OLDER CONFIG (9f2a1c04) — RE-PUSH';
const ECHO = 'GUN ECHO ≠ COMPILED WEAPON (31/192 echoed vs 32/192 expected, mag/reserve) — RE-PUSH';
const POOL = 'GUN POOL ≠ CONFIG (got 45/115, expected 45/70, hp/armor) — THE GUN IS ON ANOTHER HEAD';
const HOLDING = 'HOLDING OLDER CONFIG (9f2a1c04) — RE-PUSH TO BE SURE';

/** The demo board with row 0 replaced. */
async function boardWith(row: Partial<ReadinessRow>) {
  const d = await demo();
  const [first, ...rest] = d.state.readiness.board;
  const board = [{ ...first, ...row } as ReadinessRow, ...rest];
  const state: State = { ...d.state, readiness: { ...d.state.readiness, board } };
  return { d, state, who: (board[0] as ReadinessRow).sticker };
}

describe('ARMORY · the three A36 proofs appear on the gun card', () => {
  for (const [name, blocker] of [['a stale ack', STALE], ['a bad gun echo', ECHO], ['a wrong pool', POOL]] as const) {
    it(`${name} renders as a red fault, verbatim`, async () => {
      const { d, state } = await boardWith({ status: 'red', blockers: [blocker], ambers: [] });
      const m = await mountScreen(<Armory />, { state, view: 'muster', weapons: d.weapons, perks: d.perks });
      expect(m.text()).toContain(blocker.split(' — ')[0]);
      m.unmount();
    });
  }

  it('a heartbeat on an older head is an advisory, not a fault', async () => {
    const { d, state } = await boardWith({ status: 'amber', blockers: [], ambers: [HOLDING] });
    const m = await mountScreen(<Armory />, { state, view: 'muster', weapons: d.weapons, perks: d.perks });
    expect(m.text()).toContain('HOLDING OLDER CONFIG');
    m.unmount();
  });
});

describe('LOBBY · a stale ack is not an ack', () => {
  /** The demo session, pushed, every board row GREEN (the demo ships one dead gun, whose red fault
   *  would otherwise be the rail's headline and hide the sentence under test). */
  async function pushedAndClean() {
    const d = await demo();
    await d.api.pushLobby(true);
    const s = await d.api.getState();
    const board = s.readiness.board.map(r => ({ ...r, status: 'green', blockers: [], ambers: [] }) as ReadinessRow);
    const acks = Object.fromEntries(s.players.map(p => [p.player_id,
      { ok: true, gun_echo: '$ALCD,32,100,0,192,0,*', config_id: s.config.config_id }]));
    const players = s.players.map(p => ({ ...p, ready: true }));
    return { d, s, base: { ...s, players, readiness: { ...s.readiness, board, go: true },
                           lobby: { ...s.lobby, acks, ready: players.length } } as State };
  }

  it('the acked counter drops, the button locks, and the line NAMES the gun', async () => {
    const { d, base } = await pushedAndClean();
    const [p0] = base.players;
    const state = { ...base, lobby: { ...base.lobby, acks: { ...base.lobby.acks,
      [p0.player_id]: { ok: true, gun_echo: '$ALCD,32,100,0,192,0,*', config_id: 'deadbeef' } } } } as State;
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(m.text(), 'one of the guns is answering for the wrong game').toContain(
      `${state.players.length - 1}/${state.players.length}`);
    expect(m.text()).toContain(`${p0.display} still answering for an older config`);
    const arm = m.find('button').find(b => (b.textContent ?? '').includes('ARM COUNTDOWN'));
    expect(arm, 'the lobby is pushed, so step 3 is the ARM button').toBeTruthy();
    expect((arm as HTMLButtonElement).disabled, 'the server would refuse this START, force or not').toBe(true);
    m.unmount();
  });

  it('an older server that sends no config_id on its acks still counts them (no false alarm)', async () => {
    const { d, base } = await pushedAndClean();
    const acks = Object.fromEntries(Object.entries(base.lobby.acks).map(([id, a]) => [id, { ok: a.ok, gun_echo: a.gun_echo }]));
    const state = { ...base, lobby: { ...base.lobby, acks } } as State;
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(m.text()).toContain(`${state.players.length}/${state.players.length}`);
    expect(m.text()).not.toContain('still answering for an older config');
    m.unmount();
  });

  it('the demo backend acks with the config it pushed — so the mock cannot demo a state the server refuses', async () => {
    const d = await demo();
    await d.api.pushLobby(true);
    const s = await d.api.getState();
    const ids = Object.values(s.lobby.acks).filter(a => a.ok).map(a => a.config_id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toBe(s.config.config_id);
  });
});
