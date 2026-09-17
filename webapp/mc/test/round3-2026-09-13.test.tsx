// Screen-truth regression tests for the round-3 (FINAL) polish-loop fix pass, 2026-09-13:
// UX-1 (the recap's play-again path), UX-2 (a slot fixed to an UNPLAYABLE weapon), MERGE-0 (the
// one-side predicate, mirrored in the mock), FIELD-1 (a mode pick re-teams by index and rebalances),
// MERGE-3 (recap "run it back"), MERGE-5 (KIT never racks a weapon that cannot be played) and
// FIELD-2 (the CATALOGUE says so out loud). Each one fails on the pre-fix code.
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Catalog } from '../src/screens/Catalog';
import { Games } from '../src/screens/Games';
import { Kit } from '../src/screens/Kit';
import { Recap } from '../src/screens/Recap';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx, type View } from '../src/store';
import { computePool, emptyRequiredSlots, poolEmptyMessage } from '../src/screens/gameSummary';
import type { LoadoutPolicy, ModeInfo, RecapView, SlotRule, State } from '../src/api/types';
import { demo, makeStore, mount, mountScreen } from './harness';

const RECAP: RecapView = { winner: { player_id: 'p1' }, score: {}, provisional: false, honors: [], missing: [],
  rows: [{ player_id: 'p1', display: 'ALPHA', team_id: 'blue', kills: 3, deaths: 1, assists: 0,
           shots: 20, hits: 8, accuracy: 40, kd: 3, streak: 3, medals: [] }] };

/** Mount a screen with a store whose `setView` is observable (the harness's is a no-op). */
async function mountWithView(screen: React.ReactNode, f: Parameters<typeof makeStore>[0]) {
  const views: string[] = [];
  const store = makeStore(f, { setView: (v: View) => { views.push(v); } });
  const m = await mount(<StoreCtx.Provider value={store}>{screen}</StoreCtx.Provider>);
  return Object.assign(m, { views });
}

describe('UX-1 — the recap advertises the play-again path (NEXT MATCH since 2026-09-16)', () => {
  // Tony, bench 2026-09-16: "why? just make a new one". The recap's KEEP THIS ROSTER? PICK A MODE ON
  // GAMES pointed at a banner that said the same thing again. The primary action now starts the next
  // match itself, roster and game kept, and lands on GAMES with the game loaded.
  it('the primary action is NEXT MATCH ▸, it calls the server, and it lands on GAMES', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'recap', recap: RECAP };
    const nextMatch = vi.fn(async () => ({ ...state, phase: 'build' }) as State);
    const m = await mountWithView(<Recap />, { ...d, state, view: 'recap', api: { nextMatch } });
    expect(m.find('[data-testid="recap-play-again"]').length, 'the looping CTA is gone').toBe(0);
    expect(m.text()).not.toMatch(/PICK A MODE/);
    const btn = m.find('[data-testid="recap-next-match"] button')[0] as HTMLButtonElement;
    expect(btn, `saw: ${m.text()}`).toBeTruthy();
    expect(btn.textContent).toBe('NEXT MATCH ▸');
    expect(btn.disabled).toBe(false);
    expect(parseFloat(getComputedStyle(btn).fontSize || '0') >= 11).toBe(true);
    await act(async () => { btn.click(); });
    expect(nextMatch).toHaveBeenCalledTimes(1);
    expect(m.views).toContain('build');
    m.unmount();
  });

  it('a refused NEXT MATCH stays on the recap and does not navigate', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'recap', recap: RECAP };
    const nextMatch = vi.fn(async () => { throw new Error('THIS MC PREDATES NEXT MATCH — RESTART IT, OR USE NEW MATCH (TOP RIGHT)'); });
    const m = await mountWithView(<Recap />, { ...d, state, view: 'recap', api: { nextMatch } });
    await act(async () => { (m.find('[data-testid="recap-next-match"] button')[0] as HTMLButtonElement).click(); });
    expect(m.views).not.toContain('build');
    m.unmount();
  });

  it('the mock rolls forward with the roster AND the game kept, and the game is LOADED', async () => {
    const backend = new MockBackend();
    const before = await backend.getState();
    await backend.setPhase('recap');
    const after = await backend.nextMatch();
    expect(after.phase).toBe('build');
    expect(after.game?.loaded).toBe(true);
    expect(after.config.mode).toBe(before.config.mode);
    expect(after.players.length).toBe(before.players.length);
  });
});

describe('UX-2 — a slot FIXED to an unplayable weapon', () => {
  const rule = (over: Partial<SlotRule> = {}): SlotRule =>
    ({ choice: 'player', kinds: ['weapon'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: null, ...over });
  const policy = (over: Partial<LoadoutPolicy>): LoadoutPolicy =>
    ({ preset: 'custom', hud_select: true, primary: rule(), secondary: rule(), perk: rule({ kinds: ['perk'] }), ...over });

  it('reads `unplayable`, not `filtered`, and the line NAMES the weapon', async () => {
    const d = await demo();
    const pool = computePool(policy({ primary: rule({ choice: 'fixed', fixed_id: 'energy_launcher' }) }), d.weapons, d.perks);
    expect(pool.primary).toEqual([]);
    expect(pool.reasons?.primary).toBe('unplayable');
    const msg = poolEmptyMessage('PRIMARY', 'unplayable', 'Energy Launcher');
    expect(msg).toContain('ENERGY LAUNCHER');
    expect(msg).toContain('CANNOT BE PLAYED');
    expect(msg, 'the old copy sent the operator to filters that do not exist').not.toContain('FILTERS');
  });

  it('an allow-list naming nothing but the launcher is the same fact', async () => {
    const d = await demo();
    const pool = computePool(policy({ primary: rule({ only_ids: ['energy_launcher'] }) }), d.weapons, d.perks);
    expect(pool.reasons?.primary).toBe('unplayable');
  });

  it('does NOT block PLAY/CONTINUE: MC self-corrects the loadouts and pushes', async () => {
    // MERGE-4's console half. The server drops the pick, re-fits every loadout and warns; a console
    // that still greys CONTINUE would strand the operator behind a limitation of OURS.
    expect(emptyRequiredSlots({ primary: [], secondary_weapons: ['x'], perks: ['y'],
      reasons: { primary: 'unplayable' } }).any).toBe(false);
    expect(emptyRequiredSlots({ primary: [], secondary_weapons: ['x'], perks: ['y'],
      reasons: { primary: 'filtered' } }).any, 'control: a real rule fault still blocks').toBe(true);
  });
});

describe('MERGE-0 / FIELD-1 — the mock mirrors the server', () => {
  it('a 2/2/0 across three declared teams is not a fault', async () => {
    const b = new MockBackend();
    await b.putConfig({ mode: 'tdm', teams: [
      { team_id: 'blue', name: 'BLUE TEAM', color: '#3a86ff', tid: 1 },
      { team_id: 'yellow', name: 'YELLOW TEAM', color: '#ffd23f', tid: 2 },
      { team_id: 'green', name: 'GREEN TEAM', color: '#2ecc71', tid: 3 },
    ] });
    const st = await b.getState();
    await Promise.all(st.players.map((p, i) => b.patchPlayer(p.player_id, { team_id: i % 2 ? 'yellow' : 'blue' })));
    expect((await b.getState()).readiness.roster_faults, 'two populated sides play').toEqual([]);
  });

  it('two teams sharing one $TID are ONE side, however the counts read', async () => {
    const b = new MockBackend();
    await b.putConfig({ mode: 'tdm', teams: [
      { team_id: 'blue', name: 'BLUE TEAM', color: '#3a86ff', tid: 1 },
      { team_id: 'yellow', name: 'YELLOW TEAM', color: '#ffd23f', tid: 1 },
    ] });
    const st = await b.getState();
    await Promise.all(st.players.map((p, i) => b.patchPlayer(p.player_id, { team_id: i % 2 ? 'yellow' : 'blue' })));
    const after = await b.getState();
    expect(new Set(after.players.map(p => p.team_id)).size, 'control: the roster really is split by name').toBe(2);
    expect(after.readiness.roster_faults.join(' ')).toContain('ONE SIDE');
  });

  /** Play a stock mode exactly as a GAMES card does (`Games.tsx playStock`): the mode's own defaults,
   *  teams included. A bare `{ mode }` patch is not a shape this console ever sends. */
  const playStock = async (b: MockBackend, mode: string) => {
    const m = (await b.getModes()).find(x => x.mode === mode)!;
    await b.putConfig({ ...m.defaults });
  };

  it('a KOTH pick keeps the operator\'s split (yellow -> green), it does not collapse onto teams[0]', async () => {
    const b = new MockBackend();
    await playStock(b, 'tdm');
    const st = await b.getState();
    const teams = st.config.teams.map(t => t.team_id);
    await Promise.all(st.players.map((p, i) => b.patchPlayer(p.player_id, { team_id: teams[i % 2] })));
    const before = (await b.getState()).players.map(p => p.team_id);
    await playStock(b, 'koth');
    const after = await b.getState();
    const idx = after.config.teams.map(t => t.team_id);
    expect(idx, 'control: koth really does declare a different team pair').not.toEqual(teams);
    expect(after.players.map(p => p.team_id)).toEqual(before.map(t => idx[teams.indexOf(t ?? '')]));
    expect(after.readiness.roster_faults, '?mock must not strand itself on one side').toEqual([]);
  });

  it('an FFA roster switched to TDM is rebalanced, not piled onto BLUE', async () => {
    const b = new MockBackend();
    await playStock(b, 'ffa');
    expect(new Set((await b.getState()).players.map(p => p.team_id)).size).toBe(1);
    await playStock(b, 'tdm');
    const after = await b.getState();
    const counts = new Map<string, number>();
    for (const p of after.players) counts.set(p.team_id ?? '', (counts.get(p.team_id ?? '') ?? 0) + 1);
    expect(Math.max(...counts.values()) - Math.min(...counts.values()) <= 1,
      `the mock left ${JSON.stringify([...counts])}`).toBe(true);
    expect(after.readiness.roster_faults).toEqual([]);
  });
});

describe('MERGE-3 — "run it back" on the recap', () => {
  it('tapping the PLAYING card in RECAP rolls the session; elsewhere it stays a no-op', async () => {
    const d = await demo();
    const modes: ModeInfo[] = await d.api.getModes();
    // the card reads PLAYING only when the applied config IS that stock mode, so play it first
    await d.api.putConfig({ ...modes.find(m => m.mode === 'tdm')!.defaults });
    const base = await d.api.getState();
    const putConfig = vi.fn(async (patch: Record<string, unknown>) => d.api.putConfig(patch));
    // `modes` is not a Fixture field, so the store is built by hand here — a Games screen with an
    // empty mode list renders no STOCK cards at all and the assertion below would be unfalsifiable.
    const mount1 = async (phase: State['phase']) => {
      const state: State = { ...base, phase };
      const store = makeStore({ ...d, state, view: 'build', api: { putConfig } }, { modes });
      return mount(<StoreCtx.Provider value={store}>{<Games />}</StoreCtx.Provider>);
    };
    const recapM = await mount1('recap');
    const card = recapM.find('[aria-pressed="true"][role="button"]')[0];
    expect(card, `the current mode's card is PLAYING, saw: ${recapM.text()}`).toBeTruthy();
    await act(async () => { card.click(); await new Promise(r => setTimeout(r, 0)); });
    expect(putConfig, 'the commonest recap action must not be swallowed').toHaveBeenCalled();
    recapM.unmount();

    putConfig.mockClear();
    const kitM = await mount1('kit');
    await act(async () => { kitM.find('[aria-pressed="true"][role="button"]')[0].click(); await new Promise(r => setTimeout(r, 0)); });
    expect(putConfig, 're-picking the game you are already on is still a no-op outside recap').not.toHaveBeenCalled();
    kitM.unmount();
  });
});

describe('MERGE-5 / FIELD-2 — one list, two screens', () => {
  it('KIT does not rack the Energy Launcher at all', async () => {
    const d = await demo();
    const pid = d.state.players[0].player_id;
    const m = await mountScreen(<Kit />, { ...d, view: 'kit', selPlayer: pid });
    const names = m.find('[role="button"]').map(b => b.getAttribute('aria-label') ?? '');
    expect(names.some(n => n.startsWith('Energy Launcher')),
      'a permanently disabled tile with "Not allowed by this game\'s rules" is a lie in every game').toBe(false);
    expect(names.some(n => n.startsWith('Assault Rifle')), 'control: the rack is rendered').toBe(true);
    m.unmount();
  });

  it('the CATALOGUE tags it NOT PLAYABLE, and tags nothing else', async () => {
    const d = await demo();
    const m = await mountScreen(<Catalog />, { ...d, view: 'catalog' });
    const tagged = m.find('[data-testid="not-playable"]');
    expect(tagged.length, `expected exactly one NOT PLAYABLE tag, saw ${tagged.length}`).toBe(1);
    const row = tagged[0].closest('tr');
    expect(row?.textContent).toContain('ENERGY LAUNCHER');
    expect(tagged[0].textContent).toContain('NOT PLAYABLE');
    m.unmount();
  });
});
