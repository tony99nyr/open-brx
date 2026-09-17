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
import { MockBackend } from '../src/mock/backend';
import type { ReadinessRow, State } from '../src/api/types';
import { demo, mountScreen } from './harness';

// Verbatim server strings (state.py `_STALE_ACK_FAULT` / `_ECHO_FAULT` / `_POOL_FAULT`). All three
// read `<WHAT> ≠ CONFIG` on purpose: one frame of reference for the three proofs.
const STALE = 'ACKED AN OLDER CONFIG (9f2a1c04) — RE-PUSH';
const ECHO = 'GUN ECHO ≠ CONFIG (WEAPON 31/192 echoed vs 32/192 expected, mag/reserve) — RE-PUSH';
const POOL = 'GUN POOL ≠ CONFIG (REPORTS 45/115, THIS CONFIG GRANTS 45/70, hp/armor) — LIKELY ON AN OLDER HEAD; RE-PUSH';
const HOLDING = 'HOLDING OLDER CONFIG (9f2a1c04) — RE-PUSH TO BE SURE';

/** The demo board with EVERY row forced green, then row 0 replaced — for the gate tests, where any
 *  other red would be the thing blocking HARDWARE READY. */
async function cleanBoardWith(row: Partial<ReadinessRow>) {
  const d = await demo();
  const [first, ...rest] = d.state.readiness.board.map(r => ({ ...r, status: 'green', blockers: [], ambers: [] }) as ReadinessRow);
  const board = [{ ...first, ...row } as ReadinessRow, ...rest];
  return { d, state: { ...d.state, readiness: { ...d.state.readiness, board } } as State };
}

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

  // A37 — the weapon echo is THREE-state. `protocol/brx-protocol.md` records the `$WEAP` echo as
  // never seen from our v4.32 units and `$ALCD` as streaming on ammo events only, so the ordinary
  // answer to a head write in the field is `$START`'s `$LCD` and nothing more. A board that read
  // that as "no fault" was showing GREEN for a check that never ran.
  it('an unproven echo is visible as unproven, and is NOT a fault', async () => {
    const { d, state } = await boardWith({ status: 'green', blockers: [], ambers: [], echo: 'not_echoed' });
    const m = await mountScreen(<Armory />, { state, view: 'muster', weapons: d.weapons, perks: d.perks });
    expect(m.text()).toContain('GUN DID NOT ECHO ITS WEAPON');
    expect(m.text()).toContain('UNPROVEN ON THIS FIRMWARE');
    expect(m.find('[data-echo="not_echoed"]').length, 'the state is on the DOM, not only in prose').toBe(1);
    m.unmount();
  });

  it('a proven echo says so, and reads differently from an unproven one', async () => {
    const { d, state } = await boardWith({ status: 'green', blockers: [], ambers: [], echo: 'proven' });
    const m = await mountScreen(<Armory />, { state, view: 'muster', weapons: d.weapons, perks: d.perks });
    expect(m.find('[data-echo="proven"]').length).toBe(1);
    expect(m.text()).not.toContain('UNPROVEN ON THIS FIRMWARE');
    m.unmount();
  });

  it('a row with no echo state says nothing about the weapon at all', async () => {
    const { d, state } = await boardWith({ status: 'green', blockers: [], ambers: [], echo: null });
    const m = await mountScreen(<Armory />, { state, view: 'muster', weapons: d.weapons, perks: d.perks });
    expect(m.find('[data-echo]').length).toBe(0);
    m.unmount();
  });

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

  /** The state the SERVER ACTUALLY EMITS for a stale ack: the row is RED with the blocker on it
   *  (`state.py readiness()` appends `ACKED AN OLDER CONFIG` to `blockers`, and any blocker makes
   *  the row red), and `all_acked` is false. The earlier version of this suite forced
   *  `status: 'green', blockers: []` beside a stale ack — a state no server can produce — which is
   *  exactly how the rail sentence under test came to be dead code (U-1). */
  async function staleAsTheServerSendsIt() {
    const { d, base } = await pushedAndClean();
    const [p0] = base.players;
    const board = base.readiness.board.map(r => (r.player_id === p0.player_id
      ? ({ ...r, status: 'red', blockers: [STALE] } as ReadinessRow) : r));
    const state = {
      ...base,
      readiness: { ...base.readiness, board, go: false },
      lobby: {
        ...base.lobby, all_acked: false,
        acks: { ...base.lobby.acks, [p0.player_id]: { ok: true, gun_echo: '$ALCD,32,100,0,192,0,*', config_id: 'deadbeef' } },
      },
    } as State;
    return { d, state, p0, sticker: board.find(r => r.player_id === p0.player_id)!.sticker };
  }

  it('U-1: the stale-ack sentence renders on the state the server really sends (a RED row)', async () => {
    const { d, state, p0 } = await staleAsTheServerSendsIt();
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(m.text(), 'the generic "N guns cannot start" count must not swallow the one thing to DO')
      .toContain(`${p0.display} still answering for an older config`);
    m.unmount();
  });

  it('U-2: every A36 line keeps its "what to do" half on the LOBBY fault list', async () => {
    const { d, base } = await pushedAndClean();
    const [p0, p1, p2] = base.players;
    const lines: Record<string, string> = { [p0.player_id]: STALE, [p1.player_id]: ECHO, [p2.player_id]: POOL };
    const board = base.readiness.board.map(r => (lines[r.player_id]
      ? ({ ...r, status: 'red', blockers: [lines[r.player_id]] } as ReadinessRow) : r));
    const state = { ...base, readiness: { ...base.readiness, board, go: false } } as State;
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    const txt = m.text();
    for (const line of [STALE, ECHO, POOL]) {
      const [head, ...rest] = line.split(' — ');
      expect(txt, `the statement of ${JSON.stringify(head)}`).toContain(head);
      expect(txt.toLowerCase(), `the INSTRUCTION half of ${JSON.stringify(head)}`)
        .toContain(rest.join(' — ').toLowerCase());
    }
    m.unmount();
  });

  it('U-4: the disabled ARM title names a stale ack rather than "waiting to echo"', async () => {
    const { d, state } = await staleAsTheServerSendsIt();
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    const arm = m.find('button').find(b => (b.textContent ?? '').includes('ARM COUNTDOWN')) as HTMLButtonElement;
    expect(arm.disabled).toBe(true);
    expect(arm.title.toLowerCase(), `saw ${JSON.stringify(arm.title)}`).toContain('older config');
    expect(arm.title.toLowerCase()).not.toContain('waiting for every gun to echo');
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

  // C-5 (polish loop, 2026-09-13). `types.ts` has said since A36 that `lobby.all_acked` "wins wherever
  // it is present", and `Lobby.tsx` never read it: the console counted the acks itself and disagreed
  // with the server the moment the server's rule was the narrower one. The local count stays as the
  // FALLBACK for a server that predates the field.
  it('the SERVER\'s all_acked wins over the local count when it is present', async () => {
    const { d, base } = await pushedAndClean();
    const state = { ...base, lobby: { ...base.lobby, all_acked: false } } as State;
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    const arm = m.find('button').find(b => (b.textContent ?? '').includes('ARM COUNTDOWN'));
    expect((arm as HTMLButtonElement).disabled,
      'every ack looks current here, but the server says the roster is not acked').toBe(true);
    m.unmount();
  });

  it('…and an all_acked: true unlocks ARM even where the local count cannot see every gun', async () => {
    const { d, base } = await pushedAndClean();
    const acks = { ...base.lobby.acks };
    delete acks[base.players[0].player_id];           // e.g. a player with no node bound: the server skips them
    const state = { ...base, lobby: { ...base.lobby, acks, all_acked: true } } as State;
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    const arm = m.find('button').find(b => (b.textContent ?? '').includes('ARM COUNTDOWN'));
    expect((arm as HTMLButtonElement).disabled).toBe(false);
    m.unmount();
  });

  it('the mock predicts the server: it sends all_acked, and it agrees with its own acks', async () => {
    const d = await demo();
    await d.api.pushLobby(true);
    const s = await d.api.getState();
    expect(s.lobby.all_acked, 'the mock must send the field the real server sends').not.toBe(undefined);
    const everyOneCurrent = s.players.every(p => {
      const a = s.lobby.acks[p.player_id];
      return !!a && a.ok && a.config_id === s.config.config_id;
    });
    expect(s.lobby.all_acked).toBe(everyOneCurrent);
  });

  it('a plain ?mock acks with the config it pushed — a clean demo stays clean', async () => {
    const d = await demo();
    await d.api.pushLobby(true);
    const s = await d.api.getState();
    const ids = Object.values(s.lobby.acks).filter(a => a.ok).map(a => a.config_id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toBe(s.config.config_id);
    expect(s.readiness.board.some(r => (r.blockers ?? []).some(b => /OLDER CONFIG|GUN ECHO|GUN POOL/.test(b))))
      .toBe(false);
    expect(s.readiness.board.some(r => r.echo === 'not_echoed')).toBe(false);
  });
});

// U-3 — until this switch existed, `?mock` ALWAYS acked with the config it had just pushed, so a
// stale ack, an echo mismatch, a pool fault and a gun that simply does not echo could be demoed
// exactly never, and the console's rendering of all four was unverifiable by eye. One query flag,
// four otherwise-green guns, the server's own strings.
describe('?mock&faults=1 · all four config-proof states, without a field', () => {
  async function faultyMock() {
    const was = location.href;
    window.history.replaceState({}, '', '/?mock&faults=1');
    try {
      const api = new MockBackend();
      await api.pushLobby(true);
      return { api, state: await api.getState() };
    } finally { window.history.replaceState({}, '', was); }
  }

  it('one stale ack, one echo mismatch, one pool fault, one not-echoed — and the rest proven', async () => {
    const { state } = await faultyMock();
    const lines = state.readiness.board.flatMap(r => r.blockers ?? []);
    expect(lines.some(b => b.startsWith('ACKED AN OLDER CONFIG')), `saw ${JSON.stringify(lines)}`).toBe(true);
    expect(lines.some(b => b.startsWith('GUN ECHO ≠ CONFIG'))).toBe(true);
    expect(lines.some(b => b.startsWith('GUN POOL ≠ CONFIG'))).toBe(true);
    expect(state.readiness.board.filter(r => r.echo === 'not_echoed').length).toBe(1);
    expect(state.readiness.board.filter(r => r.echo === 'mismatch').length).toBe(1);
    expect(state.readiness.board.some(r => r.echo === 'proven')).toBe(true);
  });

  it('the stale ack is stale ON THE WIRE, not just a string on the board', async () => {
    const { state } = await faultyMock();
    expect(Object.values(state.lobby.acks).some(a => a.ok && a.config_id !== state.config.config_id)).toBe(true);
    expect(state.lobby.all_acked, 'so the server would refuse the whistle').toBe(false);
  });

  // R2-1 (iteration 2): the four states survive the FIRST push — the point of the switch is to be
  // able to look at them — and the first RE-PUSH cures the three a re-push really does cure. A demo
  // whose faults outlived the button that fixes them would be demoing a button that does nothing.
  it('the four rows survive the first push, and the RE-PUSH is what clears them', async () => {
    const was = location.href;
    window.history.replaceState({}, '', '/?mock&faults=1');
    try {
      const api = new MockBackend();
      await api.pushLobby(true);
      const s = await api.getState();
      expect(s.readiness.board.flatMap(r => r.blockers ?? []).filter(b => /OLDER CONFIG|GUN ECHO|GUN POOL/.test(b)).length)
        .toBe(3);
    } finally { window.history.replaceState({}, '', was); }
  });
});

// ============ ROUND 2 (polish loop iteration 2, 2026-09-13) ================================= //
// R2-1/R2-2/R2-8. Every one of the three A36 lines ends in RE-PUSH, and the console had no button
// that says it: `api.pushLobby` was reachable only while `lobby.pushed` was false, after which the
// primary becomes ARM COUNTDOWN. Worse, the console DISABLED the push on exactly the rows the
// server's A37 gate had just stopped refusing, so the only route past a stale ack was "Push anyway"
// — the force override, over a judgement the operator was told to clear, not accept.

const LINK_LOST = 'GUN LINK LOST — BLOCKS START';

/** A pushed, otherwise-clean board with `rows` (by index) replaced. */
async function lobbyWith(rows: Record<number, Partial<ReadinessRow>>, lobbyPatch: Partial<State['lobby']> = {}) {
  const d = await demo();
  await d.api.pushLobby(true);
  const s = await d.api.getState();
  const board = s.readiness.board.map((r, i) => ({ ...r, status: 'green', blockers: [], ambers: [], ...(rows[i] ?? {}) }) as ReadinessRow);
  const acks = Object.fromEntries(s.players.map(p => [p.player_id,
    { ok: true, gun_echo: '$ALCD,32,100,0,192,0,*', config_id: s.config.config_id }]));
  const players = s.players.map(p => ({ ...p, ready: true }));
  const state = { ...s, players,
    readiness: { ...s.readiness, board, go: false, roster_faults: [] },
    lobby: { ...s.lobby, acks, ready: players.length, pushed: true, all_acked: true, ...lobbyPatch } } as State;
  return { d, state, board };
}

const btn = (m: { find: (s: string) => Element[] }, text: string) =>
  (m.find('button') as HTMLButtonElement[]).find(b => (b.textContent ?? '').includes(text));

describe('R2-2 · the console refuses only what the server refuses', () => {
  it('the three A36 prefixes are the SERVER\'s strings, not a paraphrase', async () => {
    // `process.cwd()` is webapp/mc under vitest; `import.meta.url` is an http:// URL in jsdom.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const py = readFileSync(resolve(process.cwd(), '../../mcp/brx_mcp/mc/state.py'), 'utf8');
    const { PUSH_CURES } = await import('../src/api/derive');
    for (const name of ['_STALE_ACK_FAULT', '_ECHO_FAULT', '_POOL_FAULT']) {
      const m = py.match(new RegExp(`^${name} = "(.+)"$`, 'm'));
      expect(m, `state.py must still define ${name}`).toBeTruthy();
      expect(PUSH_CURES as readonly string[], `${name} = ${JSON.stringify(m![1])}`).toContain(m![1]);
    }
    expect(PUSH_CURES.length).toBe(3);
  });

  it('a pool red left over from a RECALL does not disable the PUSH the server would accept', async () => {
    // RECALL from a live match drops `lobby_pushed` and keeps `_pool_faults` (state.py `control`),
    // so this is the board an operator really meets: unpushed, one red, and the red says RE-PUSH.
    const { d, state } = await lobbyWith({ 0: { status: 'red', blockers: [POOL] } },
      { pushed: false, all_acked: false, acks: {} });
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    const push = btn(m, 'PUSH CONFIG & ARM');
    expect(push, 'the unpushed lobby shows the push as its primary').toBeTruthy();
    expect(push!.disabled, 'the server accepts this push — A37 excluded the three from its own gate').toBe(false);
    m.unmount();
  });

  it('…but a red no push can cure still disables it', async () => {
    const { d, state } = await lobbyWith({ 0: { status: 'red', blockers: [LINK_LOST] } },
      { pushed: false, all_acked: false, acks: {} });
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(btn(m, 'PUSH CONFIG & ARM')!.disabled).toBe(true);
    m.unmount();
  });

  it('ARMORY · HARDWARE READY is not blocked by a row a re-push clears, and says where to clear it', async () => {
    const { d, state } = await cleanBoardWith({ status: 'red', blockers: [STALE], ambers: [] });
    const m = await mountScreen(<Armory />, { state, view: 'muster', weapons: d.weapons, perks: d.perks });
    const go = btn(m, 'HARDWARE READY');
    expect(go, 'the gate reads HARDWARE READY, not "1 GUN BLOCKED"').toBeTruthy();
    expect(go!.disabled).toBe(false);
    expect(go!.title).toContain('RE-PUSH CONFIG on LOBBY');
    m.unmount();
  });

  it('ARMORY · …and a red no push can cure still blocks HARDWARE READY', async () => {
    const { d, state } = await cleanBoardWith({ status: 'red', blockers: [LINK_LOST], ambers: [] });
    const m = await mountScreen(<Armory />, { state, view: 'muster', weapons: d.weapons, perks: d.perks });
    expect(btn(m, 'HARDWARE READY'), 'a real fault still reads as blocked').toBeFalsy();
    const blocked = btn(m, 'BLOCKED');
    expect(blocked!.disabled).toBe(true);
    m.unmount();
  });
});

describe('R2-1 · RE-PUSH CONFIG is a button, not only a word in a fault line', () => {
  it('a pushed lobby with a curable red offers RE-PUSH CONFIG, and ARM stays locked', async () => {
    const { d, state } = await lobbyWith({ 0: { status: 'red', blockers: [STALE] } }, { all_acked: false });
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    const repush = btn(m, 'RE-PUSH CONFIG');
    expect(repush, 'the action every A36 line names must be reachable').toBeTruthy();
    expect(repush!.disabled).toBe(false);
    expect(btn(m, 'ARM COUNTDOWN')!.disabled, 'the whistle is still refused by the server').toBe(true);
    m.unmount();
  });

  it('the disabled ARM points at the button by name', async () => {
    const { d, state } = await lobbyWith({ 0: { status: 'red', blockers: [STALE] } }, { all_acked: false });
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(btn(m, 'ARM COUNTDOWN')!.title).toContain('RE-PUSH CONFIG on LOBBY');
    m.unmount();
  });

  it('a clean pushed-and-acked lobby offers no RE-PUSH — there is nothing to re-push for', async () => {
    const { d, state } = await lobbyWith({});
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(btn(m, 'RE-PUSH CONFIG')).toBeFalsy();
    expect(btn(m, 'ARM COUNTDOWN')!.disabled).toBe(false);
    m.unmount();
  });

  it('the mock re-push clears the three demo reds and keeps the NOT ECHOED row', async () => {
    const was = location.href;
    window.history.replaceState({}, '', '/?mock&faults=1');
    try {
      const api = new MockBackend();
      await api.pushLobby(true);
      const before = await api.getState();
      expect(before.readiness.board.flatMap(r => r.blockers ?? []).filter(b => /OLDER CONFIG|GUN ECHO|GUN POOL/.test(b)).length,
        'control: the demo starts with all three').toBe(3);
      // forced, because the demo also ships one gun that is simply not powered — a red no push cures
      const res = await api.pushLobby(true);
      expect(res.repushed, 'the server reports a re-push and the mock must predict it').toBe(true);
      const after = await api.getState();
      expect(after.readiness.board.flatMap(r => r.blockers ?? []).filter(b => /OLDER CONFIG|GUN ECHO|GUN POOL/.test(b)).length)
        .toBe(0);
      expect(after.readiness.board.filter(r => r.echo === 'not_echoed').length,
        'NOT ECHOED is the firmware, not a fault: a re-push cannot fix it').toBe(1);
    } finally { window.history.replaceState({}, '', was); }
  });
});

describe('R2-8 · the rail states the count once', () => {
  it('two stale-only reds do not also read as "2 guns cannot start"', async () => {
    const { d, base } = await (async () => {
      const r = await lobbyWith({ 0: { status: 'red', blockers: [STALE] }, 1: { status: 'red', blockers: [STALE] } },
        { all_acked: false });
      return { d: r.d, base: r.state };
    })();
    const [p0, p1] = base.players;
    const state = { ...base, lobby: { ...base.lobby, acks: { ...base.lobby.acks,
      [p0.player_id]: { ok: true, gun_echo: '$ALCD,32,100,0,192,0,*', config_id: 'deadbeef' },
      [p1.player_id]: { ok: true, gun_echo: '$ALCD,32,100,0,192,0,*', config_id: 'deadbeef' } } } } as State;
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(m.text()).toContain('still answering for an older config');
    expect(m.text(), 'every red IS the stale ack — saying it twice is not a second fault')
      .not.toContain('cannot start');
    m.unmount();
  });

  it('…but a red BESIDE the stale ones still gets counted', async () => {
    const { d, state: base } = await lobbyWith(
      { 0: { status: 'red', blockers: [STALE] }, 1: { status: 'red', blockers: [LINK_LOST] } }, { all_acked: false });
    const [p0] = base.players;
    const state = { ...base, lobby: { ...base.lobby, acks: { ...base.lobby.acks,
      [p0.player_id]: { ok: true, gun_echo: '$ALCD,32,100,0,192,0,*', config_id: 'deadbeef' } } } } as State;
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(m.text()).toContain('still answering for an older config');
    expect(m.text()).toContain('cannot start');
    m.unmount();
  });
});

// ============ ROUND 3 (polish loop iteration 3, 2026-09-13) ================================= //
// Every fix below is a case where the console's own rule was NARROWER than the fault it describes,
// so the control it names disappeared exactly when the operator was told to press it.

describe('F1 · the RE-PUSH is offered whenever a re-push would change something', () => {
  it('a row with a curable red BESIDE an uncurable one still offers RE-PUSH', async () => {
    // The `every(curedByPush)` filter dropped this row: an echo mismatch leaves the ack CURRENT, so
    // `all_acked` is true as well, and the button vanished on the one board that names it three times.
    const { d, state } = await lobbyWith({ 0: { status: 'red', blockers: [ECHO, LINK_LOST] } });
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(btn(m, 'RE-PUSH CONFIG'), 'the echo mismatch is still cured by a push').toBeTruthy();
    m.unmount();
  });

  it('a stale ack beside a link loss offers RE-PUSH, and the disabled ARM is never silent', async () => {
    const { d, state } = await lobbyWith({ 0: { status: 'red', blockers: [STALE, LINK_LOST] } });
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(btn(m, 'RE-PUSH CONFIG')).toBeTruthy();
    const arm = btn(m, 'ARM COUNTDOWN')!;
    expect(arm.disabled).toBe(true);
    expect(arm.title, 'a disabled button with no title is a dead end').not.toBe('');
    expect(arm.title).toContain('RE-PUSH CONFIG on LOBBY');
    m.unmount();
  });

  it('a disabled ARM always says why, even when nothing is curable', async () => {
    const { d, state } = await lobbyWith({ 0: { status: 'red', blockers: [LINK_LOST] } });
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    const arm = btn(m, 'ARM COUNTDOWN')!;
    expect(arm.disabled).toBe(true);
    expect(arm.title).not.toBe('');
    expect(arm.title).toContain('GUN LINK LOST');
    m.unmount();
  });

  it('an unplayable roster DISABLES the RE-PUSH and says so, rather than erroring on the click', async () => {
    // The server refuses a one-team push with `force` included (`_refuse_one_team`), so a clickable
    // RE-PUSH here can only ever throw — and the throw lands in a toast, not on the control.
    const { d, state: base } = await lobbyWith({ 0: { status: 'red', blockers: [STALE] } }, { all_acked: false });
    const state = { ...base, readiness: { ...base.readiness,
      roster_faults: ['ONLY ONE SIDE HAS PLAYERS — a match fought on one side cannot register a hit; move players between teams'] } } as State;
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    const repush = btn(m, 'RE-PUSH CONFIG')!;
    expect(repush.disabled).toBe(true);
    expect(repush.title.toLowerCase()).toContain('one side');
    m.unmount();
  });
});

describe('F3 · a phone that has not arrived blocks the FIRST push, not a re-push', () => {
  it('derive.blocksPush asks the two questions separately', async () => {
    const { blocksPush } = await import('../src/api/derive');
    const waiting = { status: 'waiting', blockers: [] };
    expect(blocksPush(waiting), 'the first push cannot reach a phone that is not here').toBe(true);
    expect(blocksPush(waiting, { repush: true }), 'a re-push is delivered on that phone\'s hello').toBe(false);
    const red = { status: 'red', blockers: [LINK_LOST] };
    expect(blocksPush(red, { repush: true }), 'a red no push cures still refuses either way').toBe(true);
    expect(blocksPush({ status: 'red', blockers: [STALE] }, { repush: true })).toBe(false);
  });

  it('the RE-PUSH reads as ORDINARY when the only other row is a phone that has not arrived', async () => {
    const { d, state } = await lobbyWith({ 0: { status: 'red', blockers: [STALE] }, 1: { status: 'waiting', blockers: [] } },
      { all_acked: false });
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    const repush = btn(m, 'RE-PUSH CONFIG')!;
    expect(repush.textContent, 'it is not forcing anything — the head reaches that phone on its hello')
      .not.toContain('BLOCKED');
    expect(repush.disabled).toBe(false);
    m.unmount();
  });

  it('…but the FIRST push is still disabled by it', async () => {
    const { d, state } = await lobbyWith({ 1: { status: 'waiting', blockers: [] } },
      { pushed: false, all_acked: false, acks: {} });
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(btn(m, 'PUSH CONFIG & ARM')!.disabled).toBe(true);
    m.unmount();
  });
});

describe('F6 · the mock mints a fresh config_id on a re-push, as the server does', () => {
  it('the id moves and the call reports it', async () => {
    const d = await demo();
    const first = await d.api.pushLobby(true);
    const before = (await d.api.getState()).config.config_id;
    expect(first.config_id, 'the server returns the id it pushed').toBe(before);
    const again = await d.api.pushLobby(true);
    const after = (await d.api.getState()).config.config_id;
    expect(again.repushed).toBe(true);
    expect(after, 'a re-push that cannot be told apart cannot be proven to have landed').not.toBe(before);
    expect(again.config_id).toBe(after);
    for (const a of Object.values((await d.api.getState()).lobby.acks)) {
      if (a.ok) expect(a.config_id).toBe(after);
    }
  });
});

describe('F8 · one instruction, one count', () => {
  it('the rail names the button, not "push again"', async () => {
    const { d, state: base } = await lobbyWith({ 0: { status: 'red', blockers: [STALE] } }, { all_acked: false });
    const [p0] = base.players;
    const state = { ...base, lobby: { ...base.lobby, acks: { ...base.lobby.acks,
      [p0.player_id]: { ok: true, gun_echo: '$ALCD,32,100,0,192,0,*', config_id: 'deadbeef' } } } } as State;
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(m.text()).toContain('RE-PUSH CONFIG on LOBBY');
    expect(m.text()).not.toContain('push again');
    m.unmount();
  });

  it('a stale ack that ALSO carries another red is still counted as a gun that cannot start', async () => {
    // R2-8 compared red ROWS with stale ACKS, so one row carrying both suppressed the count entirely.
    const { d, state: base } = await lobbyWith({ 0: { status: 'red', blockers: [STALE, LINK_LOST] } }, { all_acked: false });
    const [p0] = base.players;
    const state = { ...base, lobby: { ...base.lobby, acks: { ...base.lobby.acks,
      [p0.player_id]: { ok: true, gun_echo: '$ALCD,32,100,0,192,0,*', config_id: 'deadbeef' } } } } as State;
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(m.text()).toContain('still answering for an older config');
    expect(m.text(), 'that gun is also off the net — a re-push alone will not start it').toContain('cannot start');
    m.unmount();
  });

  it('the pin test reads the SERVER\'s PUSH_CURES tuple, so a fourth cure cannot be missed', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const py = readFileSync(resolve(process.cwd(), '../../mcp/brx_mcp/mc/state.py'), 'utf8');
    const { PUSH_CURES } = await import('../src/api/derive');
    const tuple = py.match(/^PUSH_CURES = \(([^)]*)\)$/m);
    expect(tuple, 'state.py must still define PUSH_CURES as a tuple of named constants').toBeTruthy();
    const names = tuple![1].split(',').map(x => x.trim()).filter(Boolean);
    expect(names.length, `the server cures ${names.length} blockers: ${names.join(', ')}`).toBe(PUSH_CURES.length);
    for (const name of names) {
      const m = py.match(new RegExp(`^${name} = "(.+)"$`, 'm'));
      expect(m, `state.py must define ${name}`).toBeTruthy();
      expect(PUSH_CURES as readonly string[], `${name} = ${JSON.stringify(m![1])}`).toContain(m![1]);
    }
  });
});
