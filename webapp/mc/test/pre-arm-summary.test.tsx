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
import type { State } from '../src/api/types';
import { Lobby } from '../src/screens/Lobby';
import { demo, mountScreen } from './harness';

type Row = NonNullable<State['sync']>['rows'][number];

const row = (over: Partial<Row> = {}): Row => ({
  player_id: 'p1', display: 'REAPER', gun_id: 'GUN-A', player_num: 1, bound: true,
  phone_game: true, gun_sent: true, gun_acked: true, gun_echo: 'proven', ...over,
});

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

async function lobby(sync: State['sync'], over: Partial<State> = {}) {
  const d = await demo();
  const state: State = { ...d.state, phase: 'lobby', sync, ...over } as State;
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
