// THE PRE-ARM CHECK (2026-09-13). Tony: "we need to have a validation on arm though to ensure
// everything is armed and configured in sync and correctly."
//
// It exists because LOAD split one event into two. Before it, "the game is loaded" and "the guns are
// configured" happened together at the push; now a phone can hold the current game while its gun has
// never been given weapons at all, and the second half only happens at the LOBBY push.
//
// Every test here is written against the rule the coordinator set, and that this lane has already
// broken once: NO CHECK MAY READ AS SATISFIED BECAUSE NOTHING WAS CHECKED. `all_acked()` reading true
// with zero phones bound produced "ALL GUNS ON THIS CONFIG (0/8)" earlier the same day, so each check
// below proves the summary fails when the thing it checks is ABSENT, not merely when it is wrong.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { Api, State } from '../src/api/types';
import { Lobby } from '../src/screens/Lobby';
import { T } from '../src/tokens';
import { demo, mountScreen } from './harness';

type Row = NonNullable<State['sync']>['rows'][number];

const row = (over: Partial<Row> = {}): Row => {
  const r = { player_id: 'p1', display: 'REAPER', gun_id: 'GUN-A', player_num: 1, bound: true,
    phone_game: true, gun_sent: true, gun_acked: true, gun_echo: 'proven' as Row['gun_echo'], ...over };
  // `state.py _sync_ack_state`, unless the case names one: pushed-but-silent is FAILED here (the
  // fixtures model a gun that had its chance), not the WAITING of a push still in flight.
  return { ack_state: r.gun_acked ? 'acked' : r.gun_sent ? 'failed' : 'none', ...r } as Row;
};

/** A `sync` block whose totals are computed FROM the rows, the way the server computes them — a
 *  fixture that hand-wrote disagreeing totals would prove nothing about either. */
const syncOf = (rows: Row[]): NonNullable<State['sync']> => ({
  rows,
  totals: {
    rostered: rows.length,
    phone_game: rows.filter(r => r.phone_game).length,
    gun_sent: rows.filter(r => r.gun_sent).length,
    gun_acked: rows.filter(r => r.gun_acked).length,
    gun_echo_proven: rows.filter(r => r.gun_echo === 'proven').length,
    in_sync: rows.length > 0 && rows.every(r => r.gun_sent && r.gun_acked),
  },
  unconfigured: rows.filter(r => !r.gun_acked).map(r => r.display),
});

/** A LOBBY with a game loaded and the config pushed, unless `over` says otherwise: every check below
 *  is about a load that happened. The no-game-loaded state has its own block at the end. */
async function lobby(sync: State['sync'], over: Partial<State> = {}) {
  const d = await demo();
  const state: State = { ...d.state, phase: 'lobby', sync,
    game: { ...(d.state.game ?? { sent: 0, total: 0 }), loaded: true },
    lobby: { ...d.state.lobby, pushed: true },
    ...over } as State;
  const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
  const q = (sel: string) => m.el.querySelector(sel) as HTMLElement | null;
  const all = (sel: string) => Array.from(m.el.querySelectorAll(sel)) as HTMLElement[];
  return { m, q, all };
}

describe('PRE-ARM CHECK — nothing checked is never something satisfied', () => {
  it('an EMPTY roster is not in sync, and does not render as ready', async () => {
    const v = await lobby(syncOf([]));
    expect(v.q('[data-testid="pre-arm-summary"]'), 'the check is on screen').toBeTruthy();
    const verdict = v.q('[data-testid="pre-arm-verdict"]')!.textContent ?? '';
    expect(verdict, `saw ${JSON.stringify(verdict)}`).not.toMatch(/IN SYNC/);
    expect(verdict).toMatch(/NOBODY IS ROSTERED/);
    v.m.unmount();
  });

  it('every count carries its denominator, so a partial can never be read as a whole', async () => {
    const v = await lobby(syncOf([row({ player_id: 'p1' }), row({ player_id: 'p2', display: 'VIPER', gun_acked: false })]));
    const counts = v.q('[data-testid="pre-arm-counts"]')!.textContent ?? '';
    expect(counts).toContain('2/2');   // phones told
    expect(counts).toContain('1/2');   // acked
    v.m.unmount();
  });

  it('a player with NO PHONE BOUND is reported as absent on every fact, and told what to do', async () => {
    const away = row({ player_id: 'p2', display: 'DRIFT', bound: false, phone_game: false, gun_sent: false, gun_acked: false, gun_echo: 'not_echoed' });
    const v = await lobby(syncOf([row(), away]));
    const line = v.all('[data-testid="pre-arm-row"]').find(r => (r.textContent ?? '').includes('DRIFT'));
    expect(line, 'the absent player has a row').toBeTruthy();
    expect(line!.textContent).toMatch(/No phone bound/);
    expect(v.q('[data-testid="pre-arm-verdict"]')!.textContent).not.toMatch(/IN SYNC/);
    v.m.unmount();
  });

  it('a bound phone that missed LOAD tells the operator MC is retrying automatically', async () => {
    const missed = row({ player_id: 'p2', display: 'VIPER', bound: true, phone_game: false,
                         gun_sent: false, gun_acked: false, gun_echo: 'not_echoed' });
    const v = await lobby(syncOf([row(), missed]));
    const line = v.all('[data-testid="pre-arm-row"]').find(r => (r.textContent ?? '').includes('VIPER'));
    expect(line!.textContent).toMatch(/retrying automatically/i);
    expect(line!.textContent).not.toMatch(/LOAD again/i);
    v.m.unmount();
  });

  it('a gun that was sent a head but has NOT acked is named differently from an absent one', async () => {
    const silent = row({ player_id: 'p2', display: 'VIPER', bound: true, phone_game: true, gun_sent: true, gun_acked: false, gun_echo: 'not_echoed' });
    const v = await lobby(syncOf([row(), silent]), { lobby: { ready: 2, total: 2, pushed: true, acks: {} } } as Partial<State>);
    const line = v.all('[data-testid="pre-arm-row"]').find(r => (r.textContent ?? '').includes('VIPER'));
    expect(line!.textContent, 'a silent gun is a re-push, not a hunt for a phone').toMatch(/RE-PUSH CONFIG/);
    expect(line!.textContent).not.toMatch(/No phone bound/);
    v.m.unmount();
  });

  it('only the problem rows show by default, and the toggle reveals the whole roster', async () => {
    const rows = [row(), row({ player_id: 'p2', display: 'VIPER' }), row({ player_id: 'p3', display: 'DRIFT', gun_acked: false })];
    const v = await lobby(syncOf(rows));
    expect(v.all('[data-testid="pre-arm-row"]').length, 'just the one that needs doing').toBe(1);
    await act(async () => { v.q('[data-testid="pre-arm-toggle"]')!.click(); });
    expect(v.all('[data-testid="pre-arm-row"]').length, 'and all of them on request').toBe(3);
    v.m.unmount();
  });

  it('a fully configured roster reads IN SYNC — so the green state means something', async () => {
    const v = await lobby(syncOf([row(), row({ player_id: 'p2', display: 'VIPER' })]));
    expect(v.q('[data-testid="pre-arm-verdict"]')!.textContent).toMatch(/IN SYNC/);
    expect(v.all('[data-testid="pre-arm-row"]').length, 'nothing to fix, nothing to list').toBe(0);
    v.m.unmount();
  });

  it('an ECHO nobody sent is neutral, never a fault — it is the ordinary v4.32 answer (A37)', async () => {
    const rows = [row({ gun_echo: 'not_echoed' }), row({ player_id: 'p2', display: 'VIPER', gun_echo: 'not_echoed' })];
    const v = await lobby(syncOf(rows));
    expect(v.q('[data-testid="pre-arm-verdict"]')!.textContent, 'a missing echo must not hold the whistle').toMatch(/IN SYNC/);
    v.m.unmount();
  });

  it('an echo the server DID NOT CHECK renders neutral, never as a failure', async () => {
    // `state.py _echo_state` returns NULL when there is no check to report — nothing pushed, no ack
    // for this config, or no readable $WEAP in the head. The first cut of this panel typed that state
    // away and painted it a red ✕, so eight guns that had simply not answered yet read as eight
    // faults (caught by eye on the koth screenshot). "Nothing was checked" is not "this failed".
    const rows = [row({ gun_echo: null }), row({ player_id: 'p2', display: 'VIPER', gun_echo: null })];
    const v = await lobby(syncOf(rows));
    expect(v.q('[data-testid="pre-arm-verdict"]')!.textContent, 'an unchecked echo holds nothing up').toMatch(/IN SYNC/);
    await act(async () => { v.q('[data-testid="pre-arm-toggle"]')!.click(); });
    const cell = v.all('[data-testid="pre-arm-row"]')[0].querySelector('[title*="Not checked yet"]');
    expect(cell, 'the cell says the check did not run').toBeTruthy();
    expect(cell!.textContent, 'and renders neutral, not a cross').toBe('—');
    v.m.unmount();
  });

  it('a real MISMATCH is still a fault — the neutral states must not swallow the one that matters', async () => {
    const v = await lobby(syncOf([row({ gun_echo: 'mismatch' })]));
    await act(async () => { v.q('[data-testid="pre-arm-toggle"]')?.click(); });
    const line = v.all('[data-testid="pre-arm-row"]')[0];
    expect(line.querySelector('[title*="different weapon"]'), 'a mismatch is reported as one').toBeTruthy();
    expect(line.textContent, 'and it names the cure').toMatch(/RE-PUSH CONFIG/);
    v.m.unmount();
  });

  it('a server that sends no `sync` block renders NOTHING rather than a summary it made up', async () => {
    const v = await lobby(undefined);
    expect(v.q('[data-testid="pre-arm-summary"]'), 'a pre-arm check that invents its answer is worse than none').toBeFalsy();
    v.m.unmount();
  });
});

/** `#rrggbb` as jsdom reports an inline style back — the panel's green/amber is a fact about what the
 *  operator sees, so it is asserted as a colour, not as "some element exists". */
const rgb = (hex: string) => {
  const v = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255})`;
};

describe('PRE-ARM CHECK — the verdict can never be greener than the rows beneath it', () => {
  it('a phone that never took this game is not "IN SYNC", however happy the gun columns are', async () => {
    // `totals.in_sync` is computed server-side from the GUN columns ALONE (`state.py sync_summary`:
    // gun_sent and gun_acked), so this fixture — every gun pushed and acked, one phone that never
    // took the game — made the panel print "IN SYNC: EVERY GUN HAS THIS CONFIG" in green directly
    // above a row rendering PHONE ✕. LOAD split those two halves; a verdict that only reads one of
    // them is the `(0/8)` false reassurance in a new place.
    const v = await lobby(syncOf([row(), row({ player_id: 'p2', display: 'DRIFT', phone_game: false })]));
    const verdict = v.q('[data-testid="pre-arm-verdict"]')!;
    expect(verdict.textContent, `saw ${JSON.stringify(verdict.textContent)}`).not.toMatch(/IN SYNC/);
    expect(verdict.textContent).toBe('1 OF 2 PLAYERS NEEDS ACTION: SEE BELOW');
    expect(v.all('[data-testid="pre-arm-row"]').length, 'and the row it is about is listed').toBe(1);
    v.m.unmount();
  });

  it('…and the panel is not painted green while it is listing somebody', async () => {
    const v = await lobby(syncOf([row(), row({ player_id: 'p2', display: 'DRIFT', phone_game: false })]));
    expect(v.q('[data-testid="pre-arm-verdict"]')!.style.color, 'amber, not the green of an all-clear').toBe(rgb(T.warn));
    expect(v.q('[data-testid="pre-arm-summary"]')!.style.borderLeftColor, 'including the bar down the side').toBe(rgb(T.warn));
    v.m.unmount();
  });

  it('a server insisting `in_sync` over a failing row still cannot make this read all-clear', async () => {
    // Not a state today's MC can produce — it is what an older or a newer one might send. The green
    // is derived from the RENDERED rows for exactly this reason: whatever the totals claim, the panel
    // must not call itself clear while it is naming somebody.
    const s = syncOf([row({ phone_game: false })]);
    const v = await lobby({ ...s, totals: { ...s.totals, in_sync: true, phone_game: 1 } });
    expect(v.q('[data-testid="pre-arm-verdict"]')!.textContent).not.toMatch(/IN SYNC/);
    expect(v.q('[data-testid="pre-arm-verdict"]')!.style.color).toBe(rgb(T.warn));
    v.m.unmount();
  });

  it('the GUN axis says PUSHED, so "SENT" stays the phone axis\'s word', async () => {
    // int-n1, 2026-09-13: SENT meant phone delivery on the loaded-game view and a gun-side fact here,
    // on the one feature whose whole purpose is keeping those apart. Worst in the table, where a
    // green GUN SENT sits beside a red ACKED and reads as "done".
    const v = await lobby(syncOf([row({ gun_acked: false })]));
    const panel = v.q('[data-testid="pre-arm-summary"]')!.textContent ?? '';
    expect(v.q('[data-testid="pre-arm-counts"]')!.textContent).toContain('GUNS PUSHED');
    expect(panel, 'neither the count nor the column header may say SENT of a gun').not.toMatch(/GUNS? SENT/);
    v.m.unmount();
  });

  it('at phone width the instruction gets a row of its own, and follows a resize', async () => {
    // jsdom lays nothing out, so this is proved as a MECHANISM (the same way MemberRow's compact row
    // is) and re-measured in pixels by the e2e walk. Four fixed 92 px columns left the one line the
    // operator needs fastest wrapping to seven lines of one or two words at 393 px.
    const was = window.innerWidth;
    const setWidth = (px: number) => Object.defineProperty(window, 'innerWidth', { value: px, configurable: true, writable: true });
    try {
      setWidth(393);
      const v = await lobby(syncOf([row({ phone_game: false })]));
      expect(v.q('[data-testid="pre-arm-todo"]')!.getAttribute('data-narrow'), 'full-width at 393 px').toBe('1');
      expect(v.q('[data-testid="pre-arm-row"]')!.getAttribute('data-compact')).toBe('1');
      expect(v.q('[data-testid="pre-arm-summary"]')!.textContent, 'the header it would label is gone with it').not.toContain('WHAT TO DO');
      setWidth(1280);
      await act(async () => { window.dispatchEvent(new Event('resize')); });
      expect(v.q('[data-testid="pre-arm-todo"]')!.getAttribute('data-narrow'), 'watched, not decided once at mount').toBe('0');
      v.m.unmount();
    } finally {
      setWidth(was);
    }
  });
});

/** The only state in which the HOST OVERRIDE tray renders on a PUSHED lobby: a playable roster, the
 *  config already pushed, and at least one blocked row on the board. A `waiting` row — a rostered
 *  player whose phone never arrived — is exactly what `state.py _refuse_unconfigured_gun` is about,
 *  and is why the override is the only reachable path past that gate (ARM itself is disabled here). */
async function overrideTray(sync: State['sync'], apiOver: Partial<Api> = {}) {
  const d = await demo();
  const board = d.state.readiness.board.map((b, i) => ({ ...b, blockers: [], status: (i === 0 ? 'waiting' : 'green') as 'waiting' | 'green' }));
  const state: State = { ...d.state, phase: 'lobby', sync,
    readiness: { ...d.state.readiness, board, go: false, roster_faults: [] },
    lobby: { ...d.state.lobby, pushed: true, all_acked: false, acks: {} } } as State;
  const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby', api: apiOver });
  return {
    m,
    btn: m.el.querySelector('[data-override="1"] button') as HTMLButtonElement,
    risk: m.el.querySelector('[data-testid="override-risk"]') as HTMLElement | null,
  };
}

/** A rostered player whose phone never arrived: MC has sent their gun nothing at all. */
const awol = (over: Partial<Row>): Row =>
  row({ bound: false, phone_game: false, gun_sent: false, gun_acked: false, gun_echo: null, ...over });

describe('HOST OVERRIDE — the button says what overriding actually costs', () => {
  it('names the guns that will play the head they are still holding', async () => {
    // The 2026-09-12 field failure, printed as reassurance: this button used to read "Arm anyway"
    // under a tooltip promising that blocked nodes would not arm. A gun that never took this config
    // is not inert — it arms on its old head, on the old team, with the old weapons.
    const v = await overrideTray(syncOf([row(), awol({ player_id: 'p2', display: 'DRIFT' }), awol({ player_id: 'p3', display: 'SABLE' })]));
    expect(v.btn, 'the override is on screen').toBeTruthy();
    expect(v.btn.textContent, `saw ${JSON.stringify(v.btn.textContent)}`)
      .toContain('2 guns will play the head they are still holding: DRIFT, SABLE');
    v.m.unmount();
  });

  it('the tooltip no longer promises that a blocked gun stays inert', async () => {
    const v = await overrideTray(syncOf([row(), awol({ player_id: 'p2', display: 'DRIFT' })]));
    const title = v.btn.getAttribute('title') ?? '';
    expect(title, 'the sentence that made the start look safe').not.toMatch(/will not arm/);
    expect(title, 'nobody is promised a clean start here').not.toMatch(/starts on time/);
    expect(title).toContain('NOT inert');
    expect(title).toContain("previous game's team and weapons");
    expect(title, 'and it names who it is about').toContain('DRIFT');
    v.m.unmount();
  });

  it('puts the risk ON THE SCREEN, not only in a tooltip the tablet cannot show', async () => {
    const v = await overrideTray(syncOf([row(), awol({ player_id: 'p2', display: 'DRIFT' })]));
    expect(v.risk, 'the tray carries a visible warning').toBeTruthy();
    expect(v.risk!.textContent).toContain('1 GUN HAS NEVER TAKEN THIS CONFIG: DRIFT');
    expect(v.risk!.textContent, 'with the cure, not just the alarm').toMatch(/PUSH CONFIG/);
    expect(v.risk!.textContent, 'and the reason the override exists at all').toMatch(/hot-joins/);
    v.m.unmount();
  });

  it('still forces the start — informing the judgement is not taking it away', async () => {
    const calls: (boolean | undefined)[] = [];
    const v = await overrideTray(syncOf([row(), awol({ player_id: 'p2', display: 'DRIFT' })]), {
      start: async (_runway_s: number, force?: boolean) => { calls.push(force); return { match_id: 'm1', go_live_t: 0, seq: 1 }; },
    });
    expect(v.btn.disabled, 'the override is never disabled — that is the whole point of it').toBe(false);
    await act(async () => { v.btn.click(); });
    expect(calls, 'the click reached the server, carrying force').toEqual([true]);
    v.m.unmount();
  });

  it('a gun that was pushed but has not answered is UNKNOWN, never reported as wrong', async () => {
    const v = await overrideTray(syncOf([row(), row({ player_id: 'p2', display: 'VIPER', gun_acked: false, gun_echo: 'not_echoed' })]));
    expect(v.btn.textContent).toContain('1 gun has not confirmed this config: VIPER');
    expect(v.btn.textContent, 'it may well have taken the head and said nothing').not.toMatch(/still holding/);
    expect(v.btn.getAttribute('title')).toContain('unknown, not proven wrong');
    v.m.unmount();
  });

  it('claims no risk when there is none — every gun on this config leaves a phone problem, not a wrong head', async () => {
    const v = await overrideTray(syncOf([row(), row({ player_id: 'p2', display: 'VIPER' })]));
    expect(v.risk, 'nothing to warn about, so nothing invented').toBeFalsy();
    expect(v.btn.textContent?.trim()).toBe('Arm anyway ▸');
    expect(v.btn.getAttribute('title')).toContain('not a wrong head');
    expect(v.btn.getAttribute('title')).not.toMatch(/starts on time/);
    v.m.unmount();
  });

  it('an older server with no `sync` block says it CANNOT CHECK, never that all is well', async () => {
    const v = await overrideTray(undefined);
    const title = v.btn.getAttribute('title') ?? '';
    expect(title).toContain('CANNOT TELL YOU');
    expect(title).not.toMatch(/starts on time/);
    expect(v.risk!.textContent).toContain('MC CANNOT CHECK THE GUNS ON THIS SERVER');
    v.m.unmount();
  });
});

/** Bench 2026-09-16: MC in RECAP with no game loaded, phones re-joined, and the check showed PHONE ✕,
 *  ACKED ✕, a leftover PUSHED ✓, the headline "GUNS NOT CONFIGURED YET" beside GUNS PUSHED 2/2, and a
 *  yellow "LOAD again" about a LOAD from the match before. */
describe('PRE-ARM CHECK — nothing loaded is not broken, and waiting is not failing (2026-09-16)', () => {
  const benchRows = () => [
    row({ phone_game: false, gun_sent: true, gun_acked: false, gun_echo: null }),
    row({ player_id: 'p2', display: 'VIPER', phone_game: false, gun_sent: true, gun_acked: false, gun_echo: null }),
  ];
  const noGame = { game: { loaded: false, sent: 0, total: 2 }, lobby: { ready: 0, total: 2, pushed: false, acks: {} } } as unknown as Partial<State>;

  for (const phase of ['recap', 'muster', 'kit'] as const) {
    it(`with NO GAME LOADED (${phase}) it is one neutral line: no crosses, no yellow`, async () => {
      const v = await lobby(syncOf(benchRows()), { ...noGame, phase } as Partial<State>);
      const panel = v.q('[data-testid="pre-arm-summary"]')!;
      expect(v.q('[data-testid="pre-arm-verdict"]')!.textContent).toBe('NO GAME LOADED');
      expect(v.q('[data-testid="pre-arm-verdict"]')!.style.color).toBe(rgb(T.micro));
      expect(panel.querySelectorAll('[data-mark="fail"]').length, 'no red cross').toBe(0);
      expect(v.all('[data-testid="pre-arm-row"]').length, 'no rows, so no yellow instruction').toBe(0);
      expect(panel.textContent, 'no leftover LOAD instruction').not.toMatch(/LOAD again/);
      expect(panel.style.borderColor, 'no amber frame').not.toBe(rgb(T.warn));
      v.m.unmount();
    });
  }

  it('a push still in flight is a neutral WAITING mark, and the headline says so', async () => {
    const rows = [row({ gun_acked: false, gun_echo: null, ack_state: 'waiting' }),
                  row({ player_id: 'p2', display: 'VIPER', gun_acked: false, gun_echo: null, ack_state: 'waiting' })];
    const v = await lobby(syncOf(rows));
    const panel = v.q('[data-testid="pre-arm-summary"]')!;
    expect(panel.querySelectorAll('[data-mark="fail"]').length, 'waiting is not a fault').toBe(0);
    expect(panel.querySelectorAll('[data-col="ack"] [data-mark="wait"]').length).toBe(2);
    expect(v.q('[data-testid="pre-arm-verdict"]')!.textContent).toBe('WAITING FOR 2 OF 2 GUNS TO CONFIRM');
    expect(v.q('[data-testid="pre-arm-verdict"]')!.style.color).toBe(rgb(T.micro));
    expect(v.all('[data-testid="pre-arm-todo"]').map(t => t.style.color), 'no yellow while waiting').not.toContain(rgb(T.warn));
    v.m.unmount();
  });

  it('red only for a real failure: the server calls the ack FAILED', async () => {
    const rows = [row(), row({ player_id: 'p2', display: 'VIPER', gun_acked: false, gun_echo: null, ack_state: 'failed' })];
    const v = await lobby(syncOf(rows));
    const bad = v.q('[data-testid="pre-arm-summary"] [data-col="ack"] [data-mark="fail"]');
    expect(bad, 'the failed ack is a red cross').toBeTruthy();
    expect(bad!.style.color).toBe(rgb(T.bad));
    expect(v.q('[data-testid="pre-arm-verdict"]')!.textContent).toBe('1 OF 2 PLAYERS NEEDS ACTION: SEE BELOW');
    v.m.unmount();
  });

  it('loaded but not pushed: the gun columns wait, and the headline agrees with GUNS PUSHED 0/2', async () => {
    const rows = [row({ gun_sent: false, gun_acked: false, gun_echo: null }),
                  row({ player_id: 'p2', display: 'VIPER', gun_sent: false, gun_acked: false, gun_echo: null })];
    const v = await lobby(syncOf(rows), { lobby: { ready: 0, total: 2, pushed: false, acks: {} } } as unknown as Partial<State>);
    const panel = v.q('[data-testid="pre-arm-summary"]')!;
    expect(v.q('[data-testid="pre-arm-counts"]')!.textContent).toContain('GUNS PUSHED0/2');
    expect(v.q('[data-testid="pre-arm-verdict"]')!.textContent).toBe('EVERY PHONE HAS THE GAME: GUNS ARE CONFIGURED AT THE PUSH');
    expect(panel.querySelectorAll('[data-mark="fail"]').length).toBe(0);
    await act(async () => { v.q('[data-testid="pre-arm-toggle"]')!.click(); });
    expect(panel.querySelectorAll('[data-col="push"] [data-mark="wait"]').length).toBe(2);
    v.m.unmount();
  });

  it('the headline never says "not configured" beside a count that says pushed', async () => {
    const v = await lobby(syncOf(benchRows()), { lobby: { ready: 0, total: 2, pushed: false, acks: {} } } as unknown as Partial<State>);
    expect(v.q('[data-testid="pre-arm-verdict"]')!.textContent).not.toMatch(/NOT CONFIGURED/);
    expect(v.q('[data-testid="pre-arm-verdict"]')!.textContent).toBe('2 OF 2 PLAYERS NEED ACTION: SEE BELOW');
    v.m.unmount();
  });
});
