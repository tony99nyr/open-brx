// Polish fix-1 (2026-09-23): KIT in ARMED/LIVE offered team buttons, ADD, EVICT, loadout controls and
// CONTINUE while LOBBY and GAMES said the match was locked. The server refuses every one of those
// (A30 kit fields 409, B1 team change 409, phase move 409, remove after start). The callsign stays:
// `display` rides in `assign`, never reaches the gun, and the server still takes it mid-match.
// Also here: M14's class colour identity on KIT, and the 36 px LOBBY row controls.
import { describe, expect, it } from 'vitest';
import type { Api, State } from '../src/api/types';
import { Kit } from '../src/screens/Kit';
import { Lobby } from '../src/screens/Lobby';
import { CLASS_TAG, CLS_COLOR, PERK_COLOR, ROLE, T, TEAM, roleOf } from '../src/tokens';
import { demo, mountScreen } from './harness';

const btnText = (m: { find: (s: string) => HTMLElement[] }) => (m.find('button') as HTMLButtonElement[]).map(b => (b.textContent ?? '').trim());
const rgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe('KIT locks in ARMED and LIVE', () => {
  for (const phase of ['armed', 'live'] as const) {
    it(`shows the banner and offers no kit or roster edit in ${phase.toUpperCase()}`, async () => {
      const d = await demo();
      const state: State = { ...d.state, phase };
      const calls: string[] = [];
      const spy = (name: string) => async () => { calls.push(name); return undefined as never; };
      const m = await mountScreen(<Kit />, { ...d, state, view: 'kit', api: {
        patchPlayer: spy('patchPlayer'), addPlayer: spy('addPlayer'), setPhase: spy('setPhase'), evictNode: spy('evictNode'), tryout: spy('tryout'),
      } as Partial<Api> });
      const banner = m.find('[data-kit-readonly]')[0];
      expect(banner, 'the lock reason').toBeTruthy();
      expect(banner.getAttribute('data-kit-readonly')).toBe(phase);
      expect(banner.textContent).toContain('THE KIT IS LOCKED');
      const labels = btnText(m);
      expect(labels).toContain(`GO TO ${phase.toUpperCase()} ▸`);
      expect(m.find('[data-continue="kit"]').length, 'no CONTINUE').toBe(0);
      expect(labels.some(l => l === 'ADD'), 'no ADD').toBe(false);
      expect(m.find('[aria-label="new operator callsign"]').length, 'no ADD field').toBe(0);
      // A30: EVICT is the one node action allowed in every phase (a stranger holding a gun's name), so it stays.
      expect(labels.some(l => l.includes('EVICT')), 'EVICT kept (A30)').toBe(true);
      expect(m.find('[data-stand-down]').length, 'no STAND DOWN').toBe(0);
      expect(m.find('[data-slot-clear]').length, 'no CLEAR on a slot').toBe(0);
      expect(m.text(), 'no slot offers an override').not.toContain('YOU CAN OVERRIDE');
      expect(m.text()).toContain('LOCKED FOR THIS MATCH');
      const teamBtns = m.find('[aria-label="team"] button') as HTMLButtonElement[];
      expect(teamBtns.length).toBeGreaterThan(0);
      expect(teamBtns.every(b => b.disabled), 'team buttons disabled').toBe(true);
      for (const sel of ['[aria-label^="voice for "]', '[aria-label^="gun for "]', '[aria-label^="player number"]']) {
        const el = m.find(sel)[0] as HTMLInputElement | HTMLSelectElement | undefined;
        if (el) expect(el.disabled, `${sel} disabled`).toBe(true);
      }
      expect((m.find('[aria-label^="gun for "]')[0] as HTMLSelectElement).disabled).toBe(true);
      expect((m.find('fieldset[data-pool-card]')[0] as HTMLFieldSetElement).disabled, 'pool card disabled').toBe(true);
      const tiles = m.find('[role="button"][aria-label*="magazine"]');
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles.every(t => t.getAttribute('aria-disabled') === 'true'), 'every arsenal tile disabled').toBe(true);
      tiles[0].click(); teamBtns[0].click();
      // kept: the callsign (the server accepts `display` mid-match)
      expect(m.find('[aria-label="operator callsign"]').length, 'the callsign stays editable').toBe(1);
      expect(calls, 'nothing wrote').toEqual([]);
      m.unmount();
    });
  }

  it('keeps every control in KIT (the lock is ARMED/LIVE only)', async () => {
    const d = await demo();
    const m = await mountScreen(<Kit />, { ...d, state: { ...d.state, phase: 'kit' }, view: 'kit' });
    expect(m.find('[data-kit-readonly]').length).toBe(0);
    expect(m.find('[data-continue="kit"]').length).toBe(1);
    expect(m.find('[aria-label="new operator callsign"]').length).toBe(1);
    expect((m.find('[aria-label="team"] button') as HTMLButtonElement[]).some(b => b.disabled)).toBe(false);
    m.unmount();
  });
});

describe('M14 · one class, one colour, on every screen', () => {
  const tagOf: Record<string, keyof typeof CLASS_TAG> = { assault: 'assault', cqb: 'cqb', marksman: 'sniper', support: 'support', power: 'heavy', sidearm: 'sidearm' };
  it('ROLE reads its colour from CLASS_TAG', () => {
    for (const [role, tag] of Object.entries(tagOf)) expect(ROLE[role].color, role).toBe(CLASS_TAG[tag]);
  });
  it('KIT paints the class label in the CLASS_TAG colour', async () => {
    const d = await demo();
    const m = await mountScreen(<Kit />, { ...d, state: { ...d.state, phase: 'kit' }, view: 'kit' });
    const label = m.find('[data-slot-ammo="1"] span')[0] as HTMLElement;
    const w = d.weapons.find(x => roleOf(x.role, x.cls).label === label.textContent)!;
    expect(w, 'the label names a weapon class').toBeTruthy();
    expect(label.style.color).toBe(rgb(CLASS_TAG[tagOf[w.role!]]));
    m.unmount();
  });
  it('no ROLE or CLS_COLOR colour is a team, alarm or accent colour', () => {
    const loud = new Set([...Object.values(TEAM), T.ok, T.warn, T.bad, T.acc, T.accHover, PERK_COLOR].map(c => c.toLowerCase()));
    for (const c of [...Object.values(ROLE).map(r => r.color), ...Object.values(CLS_COLOR)]) expect(loud.has(c.toLowerCase()), c).toBe(false);
  });
});

describe('LOBBY row controls are at least 36 px tall', () => {
  it('the move chips and the per-player MARK READY links', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'lobby', players: d.state.players.map((p, i) => ({ ...p, ready: i !== 0 })) };
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    const chips = m.find('[aria-label^="move "] button');
    const marks = m.find('[data-mark-ready-player]');
    expect(chips.length).toBeGreaterThan(0);
    expect(marks.length).toBeGreaterThan(0);
    for (const b of [...chips, ...marks]) expect(parseFloat(b.style.minHeight), b.textContent ?? '').toBeGreaterThanOrEqual(36);
    m.unmount();
  });
});
