// Screen-truth regression tests for the 2026-09-12 field-test fixes (F138, F141, F142, F143, F144,
// F151, F155, S38, S41; 27b lives in reach.test.tsx beside the rest of the REACH panel). Each test
// reproduces the exact condition Tony hit in the field, against a real MockBackend fixture, and would
// have failed on the pre-fix code (ui-build-verify skill: a test is worth having only if it can fail).
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Armory } from '../src/screens/Armory';
import { Designer } from '../src/screens/Designer';
import { Games } from '../src/screens/Games';
import { Lobby } from '../src/screens/Lobby';
import { Recap } from '../src/screens/Recap';
import { Spectate } from '../src/screens/Spectate';
import { computePool } from '../src/screens/gameSummary';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import type { Api, ModeInfo, Phase, RecapView, State } from '../src/api/types';
import { demo, fixtureApi, makeStore, mount, mountScreen } from './harness';

describe('F141 — Designer class chip toggle', () => {
  it('a chip left PARTIAL by another chip\'s exclusion still toggles fully OFF on tap, and back ON on the next', async () => {
    const d = await demo();
    const m = await mountScreen(<Designer />, d);
    const chipsSel = '[aria-label="primary slot rules"] button';
    const chip = (label: string) => m.find(chipsSel).find(b =>
      (b.getAttribute('title') ?? '').includes('class') && (b.textContent ?? '').trim().endsWith(label));

    // AMR is tagged support+sniper (mock/data.ts): excluding SUPPORT leaves SNIPER PARTIAL, not OFF —
    // exactly the state that used to make the SNIPER chip look "stuck" (field 2026-09-12).
    const support = chip('SUPPORT');
    expect(support, 'the SUPPORT class chip is on screen').toBeTruthy();
    await act(async () => { support!.click(); });

    const sniperMixed = chip('SNIPER');
    expect(sniperMixed, 'the SNIPER class chip is on screen').toBeTruthy();
    expect(sniperMixed!.getAttribute('aria-pressed'), 'AMR going off via SUPPORT leaves SNIPER partial, not fully on').toBe('mixed');

    // Tap SNIPER once: it must go fully OFF, not silently stay partial (the bug: tapping a "mixed"
    // chip used to always turn everything back ON, so a partial chip could never be switched off).
    await act(async () => { sniperMixed!.click(); });
    const sniperOff = chip('SNIPER');
    expect(sniperOff!.getAttribute('aria-pressed')).toBe('false');

    // Tap it again: back on (still partial, since AMR is still excluded via SUPPORT) — never stuck.
    await act(async () => { sniperOff!.click(); });
    const sniperBack = chip('SNIPER');
    expect(sniperBack!.getAttribute('aria-pressed')).not.toBe('false');
    m.unmount();
  });

  it('a primary slot filtered down to nothing says so in place, instead of silently degrading', async () => {
    const d = await demo();
    const m = await mountScreen(<Designer />, d);
    const chipsSel = '[aria-label="primary slot rules"] button';
    const chip = (label: string) => m.find(chipsSel).find(b =>
      (b.getAttribute('title') ?? '').includes('class') && (b.textContent ?? '').trim().endsWith(label));
    for (const label of ['HEAVY', 'SNIPER', 'ASSAULT', 'CLOSE RANGE', 'SUPPORT', 'SIDEARM']) {
      const c = chip(label);
      if (c && c.getAttribute('aria-pressed') !== 'false') await act(async () => { c.click(); });
    }
    expect(m.find('[data-testid="primary-empty-pool"]').length, 'excluding every class shows the empty-pool warning, not a bare "0 OF N"').toBe(1);
    // pass 2 (2026-09-12): named per the pool's own `reasons` code — a class/id filter that leaves
    // nothing is "filtered", not a generic "excludes every weapon" sentence.
    expect(m.text()).toContain("PRIMARY'S CLASS/ID FILTERS EXCLUDE EVERYTHING");
    // pass 1 (2026-09-12): the warning used to be purely cosmetic — PLAY/SAVE stayed enabled and
    // pushed a zero-weapon primary to KIT, where every arsenal tile ended up locked with no way out.
    const playBtn = m.find('button').find(b => (b.textContent ?? '').includes('PLAY THIS NOW')) as HTMLButtonElement | undefined;
    expect(playBtn, 'the PLAY THIS NOW control is on screen').toBeTruthy();
    expect(playBtn!.disabled, 'PLAY THIS NOW is disabled while the primary pool is empty').toBe(true);
    const saveBtn = m.find('button').find(b => (b.textContent ?? '').includes('SAVE GAME')) as HTMLButtonElement | undefined;
    expect(saveBtn, 'the SAVE GAME control is on screen').toBeTruthy();
    expect(saveBtn!.disabled, 'SAVE GAME is disabled too — a broken policy must never be persisted either').toBe(true);
    m.unmount();
  });
});

describe('F151 / round-2 — the GAMES lock is SPLIT the way the server splits it', () => {
  /** GAMES with a live mock backend behind it and the `modes` list loaded, the way `store.tsx` loads
   *  it — the ONLY way a mode card is a real one-tap play (with `modes` empty every card reads as a
   *  TUNED draft and the first tap is only the "this drops your unsaved game" confirm, which is what
   *  made the old lobby assertion pass for the wrong reason). */
  const games = async (phase: Phase, over: Partial<Api> = {}) => {
    const backend = new MockBackend();
    const modes: ModeInfo[] = await backend.getModes();
    await backend.setPhase(phase);
    let state: State = await backend.getState();
    const api = fixtureApi(over, backend as unknown as Api);
    const render = () => (<StoreCtx.Provider value={makeStore({ state, view: 'build' }, { api, modes })}><Games /></StoreCtx.Provider>);
    const m = await mount(render());
    return { m, backend, modes,
      settle: async () => { state = await backend.getState(); await m.update(render()); } };
  };

  it('a LOBBY mode pick goes through — the server allows it and the push is re-sent, not swallowed', async () => {
    // Round 2: `CONFIG_EDITABLE_PHASES` stopped at `kit`, so a mode-card tap in LOBBY hit `guarded()`
    // and RETURNED WITHOUT ACTING — while `GameEditPanel`, on the same screen, edited mode/night/health
    // inline in exactly that phase. Two contradictory rules on one console, and the reason the koth e2e
    // (whose shared server sits in lobby/recap) never saw the KotH tap.
    const g = await games('lobby');
    await g.backend.pushLobby(true);
    await g.settle();
    expect(g.m.find('[data-testid="games-locked"]').length, 'LOBBY is not a locked phase for config edits').toBe(0);
    expect(g.m.text()).not.toContain('GO BACK TO KIT');
    // F-6 (2026-09-13): an 8-player roster switching family reshapes teams (TDM's BLUE/YELLOW to
    // KOTH's BLUE/GREEN), so the first tap is now the confirm — same one-more-tap pattern a TUNED
    // draft already used — never a silent reshape.
    await g.m.click('KING OF THE HILL');
    expect((await g.backend.getState()).config.mode, 'the first tap only confirms — nothing reaches the server yet').toBe('tdm');
    await g.m.click('KING OF THE HILL');
    await g.settle();
    const after = await g.backend.getState();
    expect(after.config.mode, 'the second tap reached the server').toBe('koth');
    expect(after.lobby.pushed, 'and the lobby stays pushed — the edit RE-PUSHES rather than vanishing').toBe(true);
    g.m.unmount();
  });

  for (const phase of ['armed', 'live'] as const) {
    it(`says why controls do nothing once the match is ${phase.toUpperCase()}, and never calls putConfig silently`, async () => {
      const putConfig = vi.fn(async () => { throw new Error('putConfig must never be reached while the match is in play'); });
      const g = await games(phase, { putConfig });
      expect(g.m.find('[data-testid="games-locked"]').length, 'a visible banner explains the lock').toBe(1);
      expect(g.m.text()).toContain('GAME SETTINGS ARE LOCKED');
      expect(g.m.text()).toContain(phase.toUpperCase());
      const continueBtn = g.m.find('button').find(b => (b.textContent ?? '').includes('CONTINUE'));
      expect((continueBtn as HTMLButtonElement).disabled).toBe(true);
      await g.m.click('TEAM DEATHMATCH');
      expect(putConfig).not.toHaveBeenCalled();
      g.m.unmount();
    });
  }

  it('RECAP still takes a MODE pick — that IS the play-again path — and it rolls the session', async () => {
    // `state.py set_config` in `recap` accepts exactly one patch: an explicit MODE. It rolls the
    // finished session forward (`new_session(keep_roster=True)`) and lands in BUILD. The console used
    // to swallow the tap and tell the operator to press NEW MATCH, which throws the roster away.
    const g = await games('recap');
    const before = await g.backend.getState();
    expect(g.m.text()).toContain('PICK A MODE TO START THE NEXT ONE');
    // F-6 (2026-09-13): the roster carries over into the rolled session, so this switch reshapes teams
    // too — first tap confirms, second tap rolls forward.
    await g.m.click('KING OF THE HILL');
    expect((await g.backend.getState()).phase, 'the first tap only confirms — the session has not rolled yet').toBe('recap');
    await g.m.click('KING OF THE HILL');
    await g.settle();
    const after = await g.backend.getState();
    expect(after.phase, 'the recap rolls forward into a fresh, editable session').toBe('build');
    expect(after.config.mode).toBe('koth');
    expect(after.config.config_id).not.toBe(before.config.config_id);
    expect(after.players.length, 'the roster is KEPT — this is play-again, not a wipe').toBe(before.players.length);
    expect(after.recap, 'the finished match\'s recap is cleared with the roll').toBeFalsy();
    g.m.unmount();
  });

  it('a RECAP venue edit is still refused, in the server\'s own words', async () => {
    const backend = new MockBackend();
    await backend.setPhase('recap');
    await expect(backend.putConfig({ night: true })).rejects.toThrow(/match is over/i);
  });

  it('is fully interactive in muster/build/kit AND lobby (unaffected by the lock)', async () => {
    for (const phase of ['muster', 'build', 'kit', 'lobby'] as const) {
      const d = await demo();
      const state: State = { ...d.state, phase };
      const m = await mountScreen(<Games />, { ...d, state });
      expect(m.find('[data-testid="games-locked"]').length, `${phase} is editable`).toBe(0);
      const continueBtn = m.find('button').find(b => (b.textContent ?? '').includes('CONTINUE'));
      expect((continueBtn as HTMLButtonElement).disabled, `${phase} CONTINUE is live`).toBe(false);
      m.unmount();
    }
  });

  it('refuses CONTINUE when the applied config\'s own pool has an empty required slot, even with no Designer visit', async () => {
    const d = await demo();
    // a policy whose only_ids names a weapon that is not in this game — the server (and the mock's
    // own computePool) would compute an empty primary pool for it, reason `only_ids_missing`, exactly
    // as if a bad saved game had just been played.
    const policy = { ...d.state.config.loadout_policy, primary: { ...d.state.config.loadout_policy.primary, only_ids: ['nonexistent_weapon_id'] } };
    const pool = computePool(policy, d.weapons, d.perks);
    const state: State = { ...d.state, phase: 'build', config: { ...d.state.config, loadout_policy: policy }, loadout_pool: pool };
    expect(pool.reasons?.primary, 'the pool computes only_ids_missing for this policy').toBe('only_ids_missing');
    const m = await mountScreen(<Games />, { ...d, state });
    expect(m.find('[data-testid="games-locked"]').length, 'a banner explains the empty pool').toBe(1);
    expect(m.text()).toContain("PRIMARY'S ALLOW-LIST NAMES NOTHING THIS GAME HAS");
    const continueBtn = m.find('button').find(b => (b.textContent ?? '').includes('CONTINUE')) as HTMLButtonElement;
    expect(continueBtn.disabled, 'CONTINUE refuses to carry an empty primary into KIT').toBe(true);
    m.unmount();
  });

  it('the secondary being deliberately OFF never blocks CONTINUE — "off" is a fact, not a fault', async () => {
    const d = await demo();
    const policy = { ...d.state.config.loadout_policy, secondary: { ...d.state.config.loadout_policy.secondary, choice: 'off' as const } };
    const pool = computePool(policy, d.weapons, d.perks);
    expect(pool.reasons?.secondary_weapons, 'an off slot still gets a reason code').toBe('off');
    const state: State = { ...d.state, phase: 'build', config: { ...d.state.config, loadout_policy: policy }, loadout_pool: pool };
    const m = await mountScreen(<Games />, { ...d, state });
    expect(m.find('[data-testid="games-locked"]').length, 'no banner for a deliberately-off slot').toBe(0);
    const continueBtn = m.find('button').find(b => (b.textContent ?? '').includes('CONTINUE')) as HTMLButtonElement;
    expect(continueBtn.disabled).toBe(false);
    m.unmount();
  });

  it('a FIXED primary whose weapon is not in this game blocks CONTINUE too (pass 2: fixed is no longer exempt)', async () => {
    const d = await demo();
    const policy = { ...d.state.config.loadout_policy, primary: { ...d.state.config.loadout_policy.primary, choice: 'fixed' as const, fixed_id: 'not_a_real_weapon' } };
    const pool = computePool(policy, d.weapons, d.perks);
    expect(pool.reasons?.primary, 'a missing fixed weapon reads fixed_missing').toBe('fixed_missing');
    const state: State = { ...d.state, phase: 'build', config: { ...d.state.config, loadout_policy: policy }, loadout_pool: pool };
    const m = await mountScreen(<Games />, { ...d, state });
    expect(m.text()).toContain("PRIMARY'S FIXED PICK IS NOT IN THIS GAME");
    const continueBtn = m.find('button').find(b => (b.textContent ?? '').includes('CONTINUE')) as HTMLButtonElement;
    expect(continueBtn.disabled, 'a fixed slot can be just as empty as a filtered one, and must block the same way').toBe(true);
    m.unmount();
  });

  it('a Quick Switch perk pruned for having no secondary blames the SECONDARY, never the perk filters', async () => {
    const d = await demo();
    const policy = { ...d.state.config.loadout_policy,
      secondary: { ...d.state.config.loadout_policy.secondary, choice: 'off' as const },
      perk: { ...d.state.config.loadout_policy.perk, choice: 'fixed' as const, fixed_id: 'quick_switch' } };
    const pool = computePool(policy, d.weapons, d.perks);
    expect(pool.reasons?.perks, 'a swap perk with no secondary reads needs_secondary, not off/filtered').toBe('needs_secondary');
    const state: State = { ...d.state, phase: 'build', config: { ...d.state.config, loadout_policy: policy }, loadout_pool: pool };
    const m = await mountScreen(<Games />, { ...d, state });
    expect(m.text()).toContain('QUICK SWITCH NEEDS A SECONDARY');
    // never blame the PERK slot's own filters/who-picks for a cause that is entirely about the secondary
    expect(m.text()).not.toContain("PERK'S CLASS/ID FILTERS");
    expect(m.text()).not.toContain("PERK'S FIXED PICK");
    m.unmount();
  });
});

describe('round-2 — the mock never re-pushes a config the server would have dropped', () => {
  it('an INVALID edit in a pushed lobby UN-pushes, instead of quietly re-sending a config no gun can arm', async () => {
    // `state.py set_config` re-pushes only `if res["ok"]`; otherwise `lobby_pushed = False` and the
    // acks are dropped. The mock's B3 re-push block ran unconditionally, so `?mock` showed a lobby
    // still reading "pushed" while carrying a config the real MC refuses.
    const backend = new MockBackend();
    await backend.setPhase('lobby');
    await backend.pushLobby(true);
    expect((await backend.getState()).lobby.pushed, 'control: the lobby really is pushed first').toBe(true);
    const r = await backend.putConfig({ time_limit_s: 0 });
    expect(r.ok, 'a zero time limit is invalid on the phone path').toBe(false);
    const after = await backend.getState();
    expect(after.lobby.pushed, 'an invalid config cannot arm a gun — the push is dropped, never re-sent').toBe(false);
    expect(Object.keys(after.lobby.acks).length, 'and the acks go with it').toBe(0);
  });
});

describe('round-2 B — an empty team is a BLOCKING red on the lobby, never an amber tag', () => {
  /** A LOBBY with a clean board (no red/waiting rows of its own), `n` players dealt onto the named
   *  teams. `blockedCount` is what normally disables PUSH, so the board is levelled first: this test
   *  is about the ROSTER gate and nothing else. */
  /** `faults` is what the SERVER said: an array (it answered), or `null` for a server that predates
   *  the field and never sends the key at all. (`null`, not `undefined`: passing `undefined` to a
   *  defaulted parameter takes the default, which would quietly test the wrong case.) Round-3
   *  FIELD-3: the console's local rule is the FALLBACK for that older server and nothing else. */
  const lobbyOn = async (teamOf: (i: number) => string, faults: string[] | null = []) => {
    const d = await demo();
    const players = d.state.players.map((p, i) => ({ ...p, team_id: teamOf(i), ready: true }));
    const board = d.state.readiness.board.map(b => ({ ...b, status: 'green' as const, blockers: [] }));
    const readiness = { ...d.state.readiness, board, go: true, roster_faults: faults! };
    if (faults === null) delete (readiness as Partial<State['readiness']>).roster_faults;
    const state: State = { ...d.state, phase: 'lobby', players,
      config: { ...d.state.config, mode: 'tdm' },
      lobby: { ...d.state.lobby, pushed: false, acks: {} },
      readiness };
    return mountScreen(<Lobby />, { ...d, state });
  };
  const pushBtn = (m: Awaited<ReturnType<typeof lobbyOn>>) =>
    m.find('button').find(b => (b.textContent ?? '').includes('PUSH CONFIG')) as HTMLButtonElement;

  it('everyone on one team: a red alert says why, and PUSH/ARM is disabled', async () => {
    // The field bug: switching FFA -> TDM re-teamed all four players onto BLUE. A one-team match
    // cannot register a hit (the gun refuses friendly damage), and the only thing on screen about it
    // was an amber "4 V 0 — UNBALANCED" chip beside a live PUSH button. The SERVER names the fault
    // (round-3 FIELD-3: the console renders what it was told, and only invents a fault of its own
    // when the key is absent altogether).
    const m = await lobbyOn(() => 'blue', ['ONLY ONE SIDE HAS PLAYERS — move players between teams']);
    const alert = m.find('[data-testid="roster-fault"]');
    expect(alert.length, 'the empty team gets its own alert, not a tag').toBe(1);
    expect(alert[0].getAttribute('role')).toBe('alert');
    expect(m.text()).toContain('ONLY ONE SIDE HAS PLAYERS');
    expect(pushBtn(m).disabled, 'MC would refuse this push anyway — never offer it').toBe(true);
    m.unmount();
  });

  it('uneven but populated (3 v 1) stays amber and still plays', async () => {
    const m = await lobbyOn(i => (i === 0 ? 'yellow' : 'blue'));
    expect(m.find('[data-testid="roster-fault"]').length, 'uneven is not a fault').toBe(0);
    expect(m.text()).toContain('UNBALANCED');
    expect(pushBtn(m).disabled, 'full auto-balance is a later tier; 1 v 3 is legal and must play').toBe(false);
    m.unmount();
  });

  it('FIELD-3: the local rule is a fallback for an OLDER server, not a second opinion', async () => {
    // Present-and-EMPTY is the server saying "this roster is fine". The console used to run its own
    // cruder rule whenever it saw no fault at all, so it overrode that answer — and would silently
    // undo any server-side narrowing (MERGE-0's tid predicate is exactly one).
    const told = await lobbyOn(() => 'blue', []);
    expect(told.find('[data-testid="roster-fault"]').length,
      'the server said there is no fault; the console does not overrule it').toBe(0);
    told.unmount();
    // ABSENT is an MC that predates the field: the local rule is all there is.
    const old = await lobbyOn(() => 'blue', null);
    expect(old.find('[data-testid="roster-fault"]').length,
      'against an older server the console still has to say it').toBe(1);
    expect(old.text()).toContain('ONLY ONE SIDE HAS PLAYERS');
    old.unmount();
    // ...and the local rule is the SAME question the server asks: populated $TIDs, so a populated
    // second side is never a fault even against an old server.
    const split = await lobbyOn(i => (i % 2 ? 'yellow' : 'blue'), null);
    expect(split.find('[data-testid="roster-fault"]').length).toBe(0);
    split.unmount();
  });

  it('F-8 (2026-09-13): HOST OVERRIDE vanishes under a roster fault, and the banner says why', async () => {
    // Before F-8 the override tray simply did not render while `rosterFault` stood — even with a red
    // row also on the board, which is exactly the situation an operator reaches for HOST OVERRIDE in.
    // Nothing on screen said the control could not be there because of the roster, not the red row.
    const d = await demo();
    const players = d.state.players.map(p => ({ ...p, team_id: 'blue', ready: true }));
    const board = d.state.readiness.board.map((b, i) => ({ ...b, status: (i === 0 ? 'red' : 'green') as 'red' | 'green', blockers: i === 0 ? ['GUN LINK LOST'] : [] }));
    const readiness = { ...d.state.readiness, board, go: false, roster_faults: ['ONLY ONE SIDE HAS PLAYERS — move players between teams'] };
    const state: State = { ...d.state, phase: 'lobby', players, config: { ...d.state.config, mode: 'tdm' },
      lobby: { ...d.state.lobby, pushed: false, acks: {} }, readiness };
    const m = await mountScreen(<Lobby />, { ...d, state });
    expect(m.find('[data-override="1"]').length, 'no override control while the roster is unplayable').toBe(0);
    expect(m.find('[data-no-override-reason]').length, 'the fault banner says why it is missing').toBe(1);
    expect(m.text()).toContain('CANNOT BE OVERRIDDEN');
    m.unmount();
  });

  it('the mock refuses the push and the start the same way the server does', async () => {
    const backend = new MockBackend();
    await backend.pushLobby(true);                 // pushed while the teams are still split
    const st0 = await backend.getState();
    // Round-3 FIELD-1: a mode pick no longer CREATES this roster (it re-teams by index and
    // rebalances), so the one-side roster is built the way an operator still can — by hand.
    await Promise.all(st0.players.map(p => backend.patchPlayer(p.player_id, { team_id: st0.config.teams[0].team_id })));
    const st = await backend.getState();
    expect(new Set(st.players.map(p => p.team_id)).size, 'control: everyone really is on one side').toBe(1);
    expect(st.readiness.roster_faults.join(' ')).toContain('ONE SIDE');
    await expect(backend.pushLobby(true)).rejects.toThrow(/ONE SIDE/);
    await expect(backend.start(10, true)).rejects.toThrow(/ONE SIDE/);
  });
});

describe('F142 — restored-session banner', () => {
  it('shows RESTORED FROM with a FRESH SESSION control, and the roster keeps the ghost rows dimmed', async () => {
    const d = await demo();
    const restoredAt = Date.now() - 60 * 60 * 1000;
    const ghost = { player_id: 'p_ghost', player_num: 9, display: 'ALPHA', team_id: 'blue', node_id: null, gun_id: null,
      loadout: { weapons: [{ weapon_id: 'assault_rifle' }], perk: null }, voice: 'male', ready: false };
    const state: State = { ...d.state, restored_from: { at: restoredAt, players: 1 }, players: [...d.state.players, ghost] };
    const newSession = vi.fn(async () => state);
    const m = await mountScreen(<Armory />, { ...d, state, api: { newSession } });
    expect(m.find('[data-testid="restored-banner"]').length).toBe(1);
    expect(m.text()).toContain('RESTORED FROM');
    expect(m.text()).toContain('1 PLAYER');
    await m.click('FRESH SESSION');
    expect(newSession).toHaveBeenCalledWith(false);
    m.unmount();
  });

  it('renders nothing when the session was not restored', async () => {
    const d = await demo();
    const m = await mountScreen(<Armory />, d);
    expect(m.find('[data-testid="restored-banner"]').length).toBe(0);
    m.unmount();
  });
});

describe('F144/F155 — Armory gun card reach', () => {
  it('a connected node on the internet path shows an INTERNET tag beside READY, never CHECK/amber for that alone', async () => {
    const d = await demo();
    const greenRow = d.state.readiness.board.find(b => b.status === 'green' && b.node === 'linked');
    expect(greenRow, 'the demo fixture has at least one green, linked gun').toBeTruthy();
    const nodes = d.state.nodes.map(n => n.gun_tail === greenRow!.tail ? { ...n, reach: 'backhaul' as const } : n);
    const state: State = { ...d.state, nodes };
    const m = await mountScreen(<Armory />, { ...d, state });
    expect(m.text()).toContain('INTERNET');
    // the row's own status tag must still read READY, not CHECK — the tag rides BESIDE it
    const card = m.find('div').find(div => (div.textContent ?? '').includes(greenRow!.sticker) && (div.textContent ?? '').includes('INTERNET'));
    expect(card, 'found the gun card carrying both the sticker and the INTERNET tag').toBeTruthy();
    expect(card!.textContent).toContain('READY');
    m.unmount();
  });

  it('a stale node whose last path was the internet reads NOT REACHED FOR <age>, never WRONG WI-FI', async () => {
    const d = await demo();
    const redRow = d.state.readiness.board.find(b => b.status === 'red');
    expect(redRow, 'the demo fixture has a red gun to turn into a dropped-backhaul row').toBeTruthy();
    // pass 1 (2026-09-12): `reach`/`last_reach` now ride on the READINESS ROW itself (state.py stamps
    // them there), never a separate `state.nodes` entry — a row with `present: true` (a node WAS
    // bound) but no live `reach` and `last_reach: 'backhaul'` is exactly a dropped-tunnel gun. The old
    // wifi-worded blocker must be REPLACED, never sit beside the honest one.
    const board = d.state.readiness.board.map(b => b.sticker === redRow!.sticker
      ? { ...b, present: true, reach: null, last_reach: 'backhaul' as const, last_seen_age_ms: 95_000,
          blockers: ['WRONG WI-FI / MC UNREACHABLE — BLOCKS START'] } : b);
    const state: State = { ...d.state, readiness: { ...d.state.readiness, board } };
    const m = await mountScreen(<Armory />, { ...d, state });
    expect(m.text()).toContain('NOT REACHED FOR');
    expect(m.text()).not.toContain('WRONG WI-FI');
    m.unmount();
  });

  it('a card with NO node ever bound never gets a reach explanation at all — one card, one fact', async () => {
    const d = await demo();
    const neverRow = d.state.readiness.board.find(b => b.node === 'none' && !b.present);
    expect(neverRow, 'the demo fixture has a never-connected gun (present: false)').toBeTruthy();
    const board = d.state.readiness.board.map(b => b.sticker === neverRow!.sticker
      ? { ...b, last_reach: 'backhaul' as const } : b);   // even if the server sent stray history, present:false must win
    const state: State = { ...d.state, readiness: { ...d.state.readiness, board } };
    const m = await mountScreen(<Armory />, { ...d, state });
    expect(m.text()).toContain('NEVER THIS SESSION');
    expect(m.text()).not.toContain('NOT REACHED FOR');
    m.unmount();
  });
});

describe('F143 — REACH network row never prints a placeholder word', () => {
  it('prints the SSID when known', async () => {
    const d = await demo();
    const m = await mountScreen(<Armory />, d);
    expect(m.text()).toContain('BRX-FIELD');
    m.unmount();
  });

  it('falls back to the generic "LAN", never a mode word like UNKNOWN/ROUTER/HOTSPOT', async () => {
    const d = await demo();
    const state: State = { ...d.state, lan: { ...d.state.lan, mode: 'unknown', ssid: null } };
    const m = await mountScreen(<Armory />, { ...d, state });
    expect(m.text()).toContain('LAN ·');
    expect(m.text()).not.toContain('UNKNOWN ·');
    m.unmount();
  });
});

describe('F138 — join QR is large and tells the operator how to use it', () => {
  it('renders at least 280px and the hold-the-phone hint once SHOW QR CODES is open', async () => {
    const d = await demo();
    const m = await mountScreen(<Armory />, d);
    await m.click('SHOW QR CODES');
    const img = m.find('img[alt="node join QR"]')[0] as HTMLImageElement | undefined;
    expect(img, 'the join QR image is on screen').toBeTruthy();
    expect(img!.width).toBeGreaterThanOrEqual(280);
    expect(m.text()).toContain('HOLD THE PHONE 20');
    m.unmount();
  });
});

describe('S38 — Armory gun card shows the bound player\'s gamertag', () => {
  it('shows the display name once a player is bound to the gun', async () => {
    const d = await demo();
    const boundRow = d.state.readiness.board.find(b => b.player_id);
    expect(boundRow, 'the demo fixture has at least one bound player').toBeTruthy();
    const player = d.state.players.find(p => p.player_id === boundRow!.player_id);
    const m = await mountScreen(<Armory />, d);
    expect(m.text()).toContain(player!.display);
    m.unmount();
  });
});

describe('S41 — Recap hides AFTER THE WHISTLE when it has nothing to show', () => {
  const base = async (): Promise<{ d: Awaited<ReturnType<typeof demo>>; recap: RecapView }> => {
    const d = await demo();
    const recap: RecapView = { winner: { player_id: d.state.players[0].player_id }, score: {},
      rows: d.state.players.map(p => ({ player_id: p.player_id, display: p.display, team_id: p.team_id, kills: 1, deaths: 1,
        assists: 0, shots: 10, shots_total: 10, hits: 5, accuracy: 50, kd: 1, streak: 0, medals: [],
        best_streak: 1, multi_best: 0, first_blood: false, acc_provisional: false })),
      honors: [], provisional: false, missing: [] };
    return { d, recap };
  };

  it('hidden when facts is zero (already fixed, kept as a guard)', async () => {
    const { d, recap } = await base();
    const state: State = { ...d.state, phase: 'recap', recap: { ...recap, after_end: { facts: 0, by_player: {} } } };
    const m = await mountScreen(<Recap />, { ...d, state });
    expect(m.text()).not.toContain('AFTER THE WHISTLE');
    m.unmount();
  });

  it('hidden when facts landed but none could be attributed to a player — a titled empty box was worse than nothing', async () => {
    const { d, recap } = await base();
    const state: State = { ...d.state, phase: 'recap', recap: { ...recap, after_end: { facts: 2, by_player: {} } } };
    const m = await mountScreen(<Recap />, { ...d, state });
    expect(m.text()).not.toContain('AFTER THE WHISTLE');
    m.unmount();
  });

  it('shown when there is a real per-player breakdown', async () => {
    const { d, recap } = await base();
    const pid = d.state.players[0].player_id;
    const state: State = { ...d.state, phase: 'recap', recap: { ...recap, after_end: { facts: 1, by_player: { [pid]: { kills: 1, deaths: 0 } } } } };
    const m = await mountScreen(<Recap />, { ...d, state });
    expect(m.text()).toContain('AFTER THE WHISTLE');
    m.unmount();
  });

  it('shown as a bare count when an older MC sends only post_end_facts (no breakdown at all)', async () => {
    const { d, recap } = await base();
    const state: State = { ...d.state, phase: 'recap', recap: { ...recap, post_end_facts: 3 } };
    const m = await mountScreen(<Recap />, { ...d, state });
    expect(m.text()).toContain('AFTER THE WHISTLE');
    expect(m.text()).toContain('WITHOUT THE PER-PLAYER SPLIT');
    m.unmount();
  });
});

describe('F154 polish — an FFA tie names players, never raw ids', () => {
  const ffaTieState = (d: Awaited<ReturnType<typeof demo>>): State => {
    const [p1, p2] = d.state.players;
    const recap: RecapView = {
      winner: { tie: [p1.player_id, p2.player_id] }, score: {},
      rows: d.state.players.map(p => ({ player_id: p.player_id, display: p.display, team_id: p.team_id, kills: 5, deaths: 5,
        assists: 0, shots: 40, shots_total: 40, hits: 20, accuracy: 50, kd: 1, streak: 0, medals: [],
        best_streak: 1, multi_best: 0, first_blood: false, acc_provisional: false })),
      honors: [], provisional: false, missing: [] };
    return { ...d.state, phase: 'recap', config: { ...d.state.config, mode: 'ffa' }, recap, live: undefined };
  };

  it('Recap names the tied players by display name, not their raw ids', async () => {
    const d = await demo();
    const state = ffaTieState(d);
    const m = await mountScreen(<Recap />, { ...d, state });
    const [p1, p2] = d.state.players;
    expect(m.text()).toContain(`TIE — ${p1.display} / ${p2.display}`);
    expect(m.text()).not.toContain(p1.player_id);
    m.unmount();
  });

  it('Spectate (the projector board) names the tied players too', async () => {
    const d = await demo();
    const state = ffaTieState(d);
    const m = await mountScreen(<Spectate />, { ...d, state });
    const [p1, p2] = d.state.players;
    expect(m.text()).toContain(`TIE — ${p1.display} / ${p2.display}`);
    expect(m.text()).not.toContain(p1.player_id);
    m.unmount();
  });
});
