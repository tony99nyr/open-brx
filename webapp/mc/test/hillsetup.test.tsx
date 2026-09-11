// The operator-facing half of the hill review (2026-09-10): where the FIELD STEP is on screen, and
// what the recap says about a possession game.
//
// Three findings live here. `SETUP:` rendered on GAMES only, so the step vanished on the walk out to
// place the grenade. The recap never said "still settling", so numbers that were still moving read as
// the result. And a koth recap showed a kills table for a mode won on possession.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { Armed } from '../src/screens/Armed';
import { Lobby } from '../src/screens/Lobby';
import { Recap } from '../src/screens/Recap';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import { demo, makeStore, mount, mountScreen } from './harness';
import type { RecapView, State } from '../src/api/types';

const GRENADE_STEP = 'SETUP: POWER-CYCLE THE GRENADE SO IT STARTS NEUTRAL, SET IT TO HILL MODE, AND PLACE IT — one point only (F88)';
const TECHNICAL = 'frag_limit on a non-full-coverage venue is an in-coverage early end only';

const withWarnings = (base: State, warnings: string[]): State => ({ ...base, config_warnings: warnings });

describe('the grenade step follows the operator to the screens where it is actionable', () => {
  it('LOBBY shows the SETUP step and leaves the technical advisories alone', async () => {
    const d = await demo();
    const m = await mountScreen(<Lobby />, { state: withWarnings(d.state, [TECHNICAL, GRENADE_STEP]), view: 'lobby' });
    const strip = m.find('[data-testid="setup-steps"]');
    expect(strip.length).toBe(1);
    expect(strip[0].textContent).toMatch(/POWER-CYCLE THE GRENADE/i);
    expect(strip[0].textContent).toMatch(/F88/);
    // the strip is for FIELD steps: a $SIR / frag-limit advisory here would train the operator to
    // ignore the one strip that matters on the last screen before the horn
    expect(strip[0].textContent).not.toMatch(/frag_limit/i);
    m.unmount();
  });

  it('ARMED shows it too — the grenade is placed while the players walk', async () => {
    const api = new MockBackend();
    await api.pushLobby(true);
    await api.start(60, true);
    const state = await api.getState();
    expect(state.start).toBeTruthy();                       // the screen's real branch, not "NO SCHEDULE"
    const store = makeStore({ state: withWarnings(state, [GRENADE_STEP]), view: 'armed' }, { api });
    const m = await mount(<StoreCtx.Provider value={store}><Armed /></StoreCtx.Provider>);
    expect(m.find('[data-testid="setup-steps"]').length).toBe(1);
    expect(m.text()).toMatch(/POWER-CYCLE THE GRENADE/i);
    m.unmount();
  });

  it('shows nothing on either screen for a game with no field step', async () => {
    // CONTROL: the strip is driven by the server's warning, not by the screen. Without one, neither
    // screen may grow an empty banner.
    const d = await demo();
    const clean = withWarnings(d.state, [TECHNICAL]);
    const lobby = await mountScreen(<Lobby />, { state: clean, view: 'lobby' });
    expect(lobby.find('[data-testid="setup-steps"]').length).toBe(0);
    lobby.unmount();
    const api = new MockBackend();
    await api.pushLobby(true);
    await api.start(60, true);
    const armedState = withWarnings(await api.getState(), []);
    const m = await mount(<StoreCtx.Provider value={makeStore({ state: armedState, view: 'armed' }, { api })}><Armed /></StoreCtx.Provider>);
    expect(m.find('[data-testid="setup-steps"]').length).toBe(0);
    m.unmount();
  });

  it('an ir_station game says on the same strip that the source is unproven', async () => {
    const api = new MockBackend();
    await api.putConfig({ mode: 'koth' });
    await api.putConfig({ station_source: 'ir_station' });
    const state = await api.getState();
    const m = await mountScreen(<Lobby />, { state, view: 'lobby' });
    const strip = m.find('[data-testid="setup-steps"]');
    expect(strip.length).toBe(1);
    expect(strip[0].textContent).toMatch(/UNPROVEN/);
    expect(strip[0].textContent).not.toMatch(/POWER-CYCLE THE GRENADE/i);
    m.unmount();
  });
});

// --------------------------------------------------------------------------- //
// the recap of a possession game                                              //
// --------------------------------------------------------------------------- //
const RECAP = (over: Partial<RecapView> = {}): RecapView => ({
  winner: { team_id: 'blue' },
  score: { blue: 3, green: 5 },                 // kills — deliberately the OPPOSITE of the possession
  rows: [],
  honors: [],
  provisional: false,
  missing: [],
  ...over,
});

async function recapScreen(rc: RecapView) {
  const d = await demo();
  const state: State = { ...d.state, phase: 'recap', recap: rc };
  const m = await mountScreen(<Recap />, { state, view: 'recap' });
  await act(async () => { await new Promise(r => setTimeout(r, 5)); });    // the history fetch effect
  return m;
}

describe('a possession game reads as possession', () => {
  it('shows seconds held per team, the neutral time, and says the coverage is a floor', async () => {
    const m = await recapScreen(RECAP({
      possession: { by_team: { blue: 245, green: 100 }, neutral_s: 55, sites: 1, reports: 2, observed_s: 400, of_s: 400 },
    }));
    const block = m.find('[data-testid="possession"]');
    expect(block.length).toBe(1);
    const t = block[0].textContent ?? '';
    expect(t).toMatch(/4:05/);                    // 245 s held, as a clock and not as "245"
    expect(t).toMatch(/1:40/);
    expect(t).toMatch(/NEUTRAL 0:55/);            // nobody's time is shown as nobody's
    expect(t).toMatch(/BEST COVERAGE 6:40 OF 6:40/);
    expect(t).toMatch(/FLOOR, NOT A FULL ACCOUNT/);
    // the winner block still comes from the server, which named blue on possession despite green's kills
    expect(m.text()).toMatch(/BLUE TEAM WINS/i);
    m.unmount();
  });

  it('flags thin coverage rather than presenting it as the result', async () => {
    const m = await recapScreen(RECAP({
      possession: { by_team: { blue: 30, green: 0 }, neutral_s: 0, sites: 1, reports: 1, observed_s: 60, of_s: 600 },
    }));
    const t = m.find('[data-testid="possession"]')[0].textContent ?? '';
    expect(t).toMatch(/▲ ?BEST COVERAGE 1:00 OF 10:00/);
    m.unmount();
  });

  it('shows no possession block for a match that reported none', async () => {
    // CONTROL: the block is driven by the fact, not by the mode. A kills game must not grow it, and a
    // hill match nobody observed must not show 0:00 as though it were measured.
    const m = await recapScreen(RECAP({ winner: { team_id: null, undecided: 'objective' } }));
    expect(m.find('[data-testid="possession"]').length).toBe(0);
    expect(m.text()).toMatch(/UNDECIDED — OBJECTIVE/);
    m.unmount();
  });
});

describe('a recap that is still moving says so', () => {
  it('names the nodes that have not reported since the whistle', async () => {
    const d = await demo();
    const someone = d.state.players[0];
    const m = await recapScreen(RECAP({ settling: true, awaiting: [someone.player_id], since_end_ms: 42_000 }));
    const banner = m.find('[data-testid="settling"]');
    expect(banner.length).toBe(1);
    expect(banner[0].textContent).toMatch(/STILL SETTLING/);
    expect(banner[0].textContent).toMatch(new RegExp(someone.display, 'i'));
    // the strip is all caps and nothing uppercases it, so the seconds are written in caps at source
    expect(banner[0].textContent).toMatch(/42S AGO/);
    expect(banner[0].textContent).not.toMatch(/\ds AGO/);
    expect(banner[0].textContent).toMatch(/1 NODE HAS NOT REPORTED/);   // not "1 NODE HAVE"

    expect(banner[0].textContent).toMatch(/CAN STILL CHANGE/);
    m.unmount();
  });

  it('says nothing once every node has reported', async () => {
    // CONTROL: `settling: false` is the ordinary end state, and a permanent banner would be noise
    // the operator learns to ignore — the same mistake as a permanently PROVISIONAL recap.
    const m = await recapScreen(RECAP({ settling: false, awaiting: [], since_end_ms: 9_000 }));
    expect(m.find('[data-testid="settling"]').length).toBe(0);
    m.unmount();
  });
});
