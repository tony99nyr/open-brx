// A27 · A29 · A31 — three places the console must render what the SERVER decided, and nothing it
// worked out for itself.
//
//  A27  `POST /api/phase {phase:"lobby"}` from `kit` is refused 409 with `{error, not_ready}` while a
//       rostered player is not ready. The console already arms its own two-tap from the roster's
//       `ready` flags (F127) — but the two can disagree (a phone readied between the snapshot and the
//       tap), and when they do the SERVER's list is the true one. The second tap sends `force: true`.
//  A29  A phone reports its real build (`app_ver` + `platform`). MC holds the semver rule and words
//       the flags; the console shows the version, tallies the field, and derives NO rule of its own.
//  A31  The compiler writes the "verify at MC" line ONCE so MC and the phones cannot disagree. LOBBY
//       and ARMED render it verbatim.
//
// Every new field is OPTIONAL on purpose: the server lane lands them later, and a session persisted
// before the change has none of them. The absent case is asserted in each block.
import { describe, expect, it } from 'vitest';
import { Armed } from '../src/screens/Armed';
import { Armory } from '../src/screens/Armory';
import { Kit } from '../src/screens/Kit';
import { Lobby } from '../src/screens/Lobby';
import { VIEWS } from '../src/store';
import type { NodeView, State } from '../src/api/types';
import { demo, fixtureApi, makeStore, mount, mountScreen } from './harness';
import { StoreCtx } from '../src/store';

describe('A27 · CONTINUE against a server that guards the phase', () => {
  /** Mount KIT with a `setPhase` that refuses the way `POST /api/phase` does. */
  async function kitScreen(refusal: { error: string; not_ready?: string[] } | null) {
    const d = await demo();
    const calls: { phase: string; force?: boolean }[] = [];
    const errors: string[] = [];
    const api = fixtureApi({
      setPhase: async (phase: string, force?: boolean) => {
        calls.push({ phase, force });
        if (refusal && !force) {
          const e = new Error(refusal.error) as Error & { status?: number; body?: unknown };
          e.status = 409; e.body = refusal;
          throw e;
        }
        return {};
      },
    });
    const state: State = { ...d.state, players: d.state.players.map(p => ({ ...p, ready: true })) };
    const store = makeStore({ ...d, state, view: 'kit' }, {
      api,
      run: async fn => { try { return await fn(); } catch (e) { errors.push((e as Error).message); return undefined; } },
    });
    const m = await mount(<StoreCtx.Provider value={store}><Kit /></StoreCtx.Provider>);
    return Object.assign(m, { calls, errors });
  }

  it('shows the SERVER list of who is not ready, even when the roster looked green', async () => {
    // The roster this console holds says everyone is ready, so its own gate would advance on one tap.
    // The server knows better. What the operator must see is the server's names, not "8/8 READY".
    const m = await kitScreen({ error: '2 PLAYERS ARE NOT READY', not_ready: ['SABLE', 'DRIFT'] });
    await m.click('CONTINUE');
    expect(m.calls).toEqual([{ phase: 'lobby', force: undefined }]);
    const line = m.find('[data-continue-refusal]')[0];
    expect(line, 'the refusal is on screen').toBeTruthy();
    expect(line.textContent).toContain('SABLE');
    expect(line.textContent).toContain('DRIFT');
    m.unmount();
  });

  it('the second tap forces it, and only the second', async () => {
    const m = await kitScreen({ error: 'NOT READY', not_ready: ['SABLE'] });
    await m.click('CONTINUE');
    expect(m.calls.length).toBe(1);
    await m.click('CONTINUE');
    expect(m.calls).toEqual([{ phase: 'lobby', force: undefined }, { phase: 'lobby', force: true }]);
    m.unmount();
  });

  it('a refusal with no list still says what the server said', async () => {
    const m = await kitScreen({ error: 'THE LOBBY IS CLOSED' });
    await m.click('CONTINUE');
    expect(m.find('[data-continue-refusal]')[0].textContent).toContain('THE LOBBY IS CLOSED');
    m.unmount();
  });

  it('never costs a third tap when BOTH guards would fire', async () => {
    // The console's own F127 confirm and the server's A27 guard ask the same question about the same
    // roster. Answering the console's must answer the server's too, or CONTINUE becomes arm → refused
    // → force: three taps to do what took two the day before (caught by `npm run e2e:kit`, 2026-09-12).
    const d = await demo();
    const calls: (boolean | undefined)[] = [];
    const api = fixtureApi({
      setPhase: async (_p: string, force?: boolean) => {
        calls.push(force);
        if (force) return {};
        const e = new Error('1 of 8 are not READY: SABLE') as Error & { status?: number; body?: unknown };
        e.status = 409; e.body = { error: e.message, not_ready: ['SABLE'] };
        throw e;
      },
    });
    // a roster the console ITSELF gates on, so both guards are in play
    const state: State = { ...d.state, players: d.state.players.map(p => ({ ...p, ready: p.display !== 'SABLE' })) };
    const views: string[] = [];
    const store = makeStore({ ...d, state, view: 'kit' }, {
      api, setView: v => views.push(v),
      run: async fn => { try { return await fn(); } catch { return undefined; } },
    });
    const m = await mount(<StoreCtx.Provider value={store}><Kit /></StoreCtx.Provider>);
    await m.click('CONTINUE');                       // tap 1: arms, names SABLE, sends nothing
    expect(calls).toEqual([]);
    expect(m.find('[data-continue-warn]').length, 'the console names who it would strand').toBe(1);
    await m.click('CONTINUE');                       // tap 2: the operator has answered — force it
    expect(calls).toEqual([true]);
    expect(m.find('[data-continue-refusal]').length, 'no second warning about the same roster').toBe(0);
    expect(views).toEqual(['lobby']);
    m.unmount();
  });

  it("does not repeat names the server's own sentence already carries", async () => {
    // MC words it as "1 of 9 are not READY: ROCCO". Appending "— ROCCO IS NOT READY" after that reads
    // as two separate facts about two separate things (real server walk, 2026-09-12).
    const m = await kitScreen({ error: '1 of 9 are not READY: ROCCO', not_ready: ['ROCCO'] });
    await m.click('CONTINUE');
    const txt = m.find('[data-continue-refusal]')[0].textContent ?? '';
    expect(txt).toBe('1 of 9 are not READY: ROCCO — CONTINUE ANYWAY?');
    expect(txt.match(/ROCCO/g)?.length).toBe(1);
    m.unmount();
  });

  it('names them when the server only gives a count', async () => {
    const m = await kitScreen({ error: '2 PLAYERS ARE NOT READY', not_ready: ['SABLE', 'DRIFT'] });
    await m.click('CONTINUE');
    expect(m.find('[data-continue-refusal]')[0].textContent)
      .toBe('2 PLAYERS ARE NOT READY — SABLE, DRIFT — CONTINUE ANYWAY?');
    m.unmount();
  });

  it('an unguarded (older) server advances on one tap and shows no refusal', async () => {
    const m = await kitScreen(null);
    await m.click('CONTINUE');
    expect(m.calls).toEqual([{ phase: 'lobby', force: undefined }]);
    expect(m.find('[data-continue-refusal]').length).toBe(0);
    m.unmount();
  });
});

describe('A29 · what build each phone is running', () => {
  const withVers = (s: State, vers: (Partial<NodeView> | null)[]): State => ({
    ...s,
    nodes: s.nodes.map((n, i) => ({ ...n, ...(vers[i] ?? {}) })),
  });

  it('the node card carries the version and the platform', async () => {
    const d = await demo();
    const m = await mountScreen(<Armory />, { ...d, view: 'muster' });
    const chip = m.find('[data-app-ver]')[0];
    expect(chip, 'a version chip on the node card').toBeTruthy();
    expect(chip.textContent).toMatch(/0\.1\.\d/);
    expect(chip.textContent?.toUpperCase()).toMatch(/ANDROID|IOS/);
    m.unmount();
  });

  it('the muster header tallies the field', async () => {
    const d = await demo();
    const m = await mountScreen(<Armory />, { ...d, view: 'muster' });
    const sum = m.find('[data-app-ver-summary]')[0];
    expect(sum, 'the muster version summary').toBeTruthy();
    // the demo field is 7 phones on the net (GUN-D is unpowered, so it has no node): 5 on 0.1.9 and
    // 2 on 0.1.8 — a tally, newest first, never a verdict
    expect(sum.textContent?.replace(/\s+/g, ' ')).toMatch(/PHONES · 5 × 0\.1\.9 · 2 × 0\.1\.8/);
    m.unmount();
  });

  it("prefers the server's own count when the snapshot carries it", async () => {
    const d = await demo();
    // `state.py versions()` counts the PLAYER nodes itself. When it is on the snapshot the console
    // renders THAT, so MC and the console can never disagree about how many phones are on what.
    const state: State = { ...d.state, versions: { field: { '0.2.0+aaa': 3, 'hud-0.2': 1 }, newest: '0.2.0', release: '0.2.0', mc_major: 0 } };
    const m = await mountScreen(<Armory />, { ...d, state, view: 'muster' });
    const sum = m.find('[data-app-ver-summary]')[0].textContent?.replace(/\s+/g, ' ');
    expect(sum).toMatch(/3 × 0\.2\.0/);
    expect(sum).toMatch(/1 × hud-0\.2/);   // an unparsable build is shown VERBATIM, not hidden
    m.unmount();
  });

  it('says UNKNOWN rather than guessing when a phone reports no build', async () => {
    const d = await demo();
    const state = withVers(d.state, d.state.nodes.map(() => ({ app_ver: undefined, platform: undefined })));
    const m = await mountScreen(<Armory />, { ...d, state, view: 'muster' });
    expect(m.find('[data-app-ver]')[0].textContent).toMatch(/UNKNOWN/);
    expect(m.find('[data-app-ver-summary]')[0].textContent).toMatch(/UNKNOWN/);
    m.unmount();
  });

  it("renders the server's amber version flag verbatim and never invents one", async () => {
    const d = await demo();
    // The demo readiness board carries the A29 amber the server words. The console must print it and
    // must not decide on its own that 0.1.8 vs 0.1.9 is a problem — that rule lives in `state.py`.
    const m = await mountScreen(<Armory />, { ...d, view: 'muster' });
    expect(m.text()).toContain('APP OLDER THAN THE FIELD (0.1.8 < 0.1.9)');
    m.unmount();
  });
});

describe('A31 · the verify-at-MC host line', () => {
  const notice = 'WIN IS CONFIRMED AT MC · 2 PHONES OFF-GRID · TELL PLAYERS TO RETURN AFTER THE WHISTLE (SABLE, DRIFT)';

  it('LOBBY shows it', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'lobby', notices: { mc_verify: notice } };
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(m.find('[data-testid="mc-verify"]')[0]?.textContent).toContain('2 PHONES OFF-GRID');
    m.unmount();
  });

  it('ARMED shows it', async () => {
    const d = await demo();
    const base = await (async () => { const api = d.api; await api.pushLobby(true); await api.start(120); return api.getState(); })();
    const state: State = { ...base, notices: { mc_verify: notice } };
    const m = await mountScreen(<Armed />, { ...d, state, view: 'armed' });
    expect(m.find('[data-testid="mc-verify"]')[0]?.textContent).toContain('RETURN AFTER THE WHISTLE');
    m.unmount();
  });

  it('is absent under full coverage — the screens render nothing extra', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'lobby', notices: undefined };
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(m.find('[data-testid="mc-verify"]').length).toBe(0);
    m.unmount();
  });
});

describe('the spectator route is reachable', () => {
  it('#spectate is whitelisted', () => {
    expect(VIEWS).toContain('spectate');
  });
});
