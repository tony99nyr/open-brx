// Visual QA pass 2026-09-23, lane C: LOBBY, ARMORY and KIT. One `describe` per finding id, so a red
// test names the finding it guards. The browser half (the UPDATING tag's colour, the 900 px roster
// strip) is `e2e/lobby-updating.mjs`; jsdom lays nothing out, so this file proves the mechanism.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { Api, ReadinessRow, State } from '../src/api/types';
import { Armory } from '../src/screens/Armory';
import { Kit } from '../src/screens/Kit';
import { Lobby } from '../src/screens/Lobby';
import { ARM_TIMEOUT_MS } from '../src/screens/OperatorMenu';
import { T } from '../src/tokens';
import { demo, mountScreen, starved } from './harness';

const btns = (m: { find: (s: string) => HTMLElement[] }) => m.find('button') as HTMLButtonElement[];
const btnText = (m: { find: (s: string) => HTMLElement[] }) => btns(m).map(b => (b.textContent ?? '').trim());
/** jsdom normalises a hex colour in `style` to rgb(); compare like with like. */
const rgb = (hex: string) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe('H5 · LOBBY outside the lobby phase', () => {
  for (const phase of ['armed', 'live'] as const) {
    it(`is read-only in ${phase.toUpperCase()}, says why, and offers no push, ready or move control`, async () => {
      const d = await demo();
      const state: State = { ...d.state, phase, players: d.state.players.map((p, i) => ({ ...p, ready: i !== 0 })),
        lobby: { ...d.state.lobby, pushed: false } };
      const calls: string[] = [];
      const spy = (name: string) => async () => { calls.push(name); return undefined as never; };
      const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby', api: {
        pushLobby: spy('pushLobby'), readyAll: spy('readyAll'), setReady: spy('setReady'), start: spy('start'), patchPlayer: spy('patchPlayer'),
      } as Partial<Api> });
      const banner = m.find('[data-lobby-readonly]')[0];
      expect(banner, 'the read-only reason').toBeTruthy();
      expect(banner.getAttribute('data-lobby-readonly')).toBe(phase);
      expect(banner.textContent).toContain('READ-ONLY');
      const labels = btnText(m);
      for (const word of ['MARK ALL READY', 'PUSH CONFIG', 'ARM COUNTDOWN', 'Push anyway', 'RE-PUSH']) {
        expect(labels.some(l => l.includes(word)), `no "${word}" in ${phase}`).toBe(false);
      }
      expect(m.find('[data-mark-ready="1"]').length, 'no per-player MARK READY').toBe(0);
      expect(m.find('[aria-label^="move "] button').length, 'no team move chips').toBe(0);
      expect(m.text(), 'the false "not configured" line is gone').not.toContain('GUNS NOT CONFIGURED YET');
      // the one control left says where to go, and goes there
      expect(labels).toContain(`GO TO ${phase.toUpperCase()} ▸`);
      expect(calls, 'rendering fired nothing').toEqual([]);
      m.unmount();
    });
  }

  it('keeps the push and the per-player READY before the lobby phase (the server accepts both) but hides MARK ALL READY, which it refuses', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'build', players: d.state.players.map((p, i) => ({ ...p, ready: i !== 0 })),
      lobby: { ...d.state.lobby, pushed: false } };
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(m.find('[data-lobby-readonly]').length, 'BUILD is not read-only').toBe(0);
    expect(m.find('[data-lobby-primary="push"]').length, 'the push is still offered').toBe(1);
    expect(btnText(m).some(l => l.includes('MARK ALL READY')), 'ready_all refuses outside LOBBY').toBe(false);
    expect(m.find('[data-mark-ready="1"]').length, 'the per-player MARK READY stays').toBe(1);
    expect(m.find('[data-ready-closed]')[0]?.textContent).toContain('MARK ALL READY OPENS ONCE THE CONFIG IS PUSHED. MC IS AT BUILD');
    m.unmount();
  });
});

describe('M2 · LOBBY not-ready rows and MARK ALL READY', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('sorts not-ready players first in each team, and marks them NOT READY in amber', async () => {
    const d = await demo();
    const last = d.state.players[d.state.players.length - 1];
    const team = last.team_id;
    const state: State = { ...d.state, phase: 'lobby', players: d.state.players.map(p => ({ ...p, ready: p.player_id !== last.player_id })) };
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    const teamMates = state.players.filter(p => p.team_id === team);
    expect(teamMates.length, 'control: the team has more than one player').toBeGreaterThan(1);
    const tags = m.find('[data-ready-tag]');
    const notReady = tags.filter(t => t.getAttribute('data-ready-tag') === 'not-ready');
    expect(notReady.length).toBe(1);
    const tag = notReady[0].firstElementChild as HTMLElement;
    expect(tag.textContent).toBe('NOT READY');
    expect(tag.style.color).toBe(rgb(T.warn));
    // the last-rostered player is the first row of their column now
    const column = notReady[0].closest('[style*="min-height: 200px"]') as HTMLElement;
    const firstRowTag = column.querySelector('[data-ready-tag]');
    expect(firstRowTag?.getAttribute('data-ready-tag'), 'the not-ready row leads its column').toBe('not-ready');
    m.unmount();
  });

  it('needs a second tap, names who it overrides, and the confirm expires', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const d = await demo();
    const state: State = { ...d.state, phase: 'lobby', players: d.state.players.map((p, i) => ({ ...p, ready: i > 1 })) };
    const calls: string[] = [];
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby', api: {
      readyAll: async () => { calls.push('readyAll'); return { ok: true, readied: [] }; },
    } });
    await m.click('MARK ALL READY');
    expect(calls).toEqual([]);
    const confirm = m.find('[data-mark-all-confirm="1"]')[0];
    expect(confirm.textContent).toContain(`OVERRIDES 2 PHONES: ${state.players[0].display}, ${state.players[1].display}`);
    expect(btnText(m)).toContain('TAP AGAIN: MARK 2 READY ▸');
    // left alone, it disarms
    await act(async () => { vi.advanceTimersByTime(ARM_TIMEOUT_MS + 10); });
    expect(m.find('[data-mark-all-confirm="1"]').length, 'the confirm expired').toBe(0);
    expect(btnText(m)).toContain('MARK ALL READY ▸');
    // CANCEL disarms too
    await m.click('MARK ALL READY');
    await m.click('CANCEL');
    expect(m.find('[data-mark-all-confirm="1"]').length).toBe(0);
    expect(calls, 'nothing was sent by arming, expiring or cancelling').toEqual([]);
    m.unmount();
  });
});

describe('M3 · LOBBY primary and hint name the step they are on', () => {
  it('pushes as PUSH CONFIG before the push, and the hint names the push', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'lobby', players: d.state.players.map(p => ({ ...p, ready: true })),
      readiness: { ...d.state.readiness, board: d.state.readiness.board.map(r => ({ ...r, status: 'green', blockers: [], ambers: [] }) as ReadinessRow) },
      lobby: { ...d.state.lobby, pushed: false, acks: {} } };
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(m.find('[data-lobby-primary]')[0].getAttribute('data-lobby-primary')).toBe('push');
    expect(m.find('[data-lobby-primary]')[0].textContent).toBe('PUSH CONFIG ▸');
    expect(m.text()).not.toContain('PUSH CONFIG & ARM');
    expect(m.text()).toContain('Push the config to the guns next.');
    expect(m.text()).not.toContain('Push, then walk');
    m.unmount();
  });

  it('arms as ARM COUNTDOWN after the push, and the hint no longer says push', async () => {
    const d = await demo();
    const acks = Object.fromEntries(d.state.players.map(p => [p.player_id, { ok: true, config_id: d.state.config.config_id }]));
    const state: State = { ...d.state, phase: 'lobby', players: d.state.players.map(p => ({ ...p, ready: true })),
      readiness: { ...d.state.readiness, board: d.state.readiness.board.map(r => ({ ...r, status: 'green', blockers: [], ambers: [] }) as ReadinessRow) },
      lobby: { ...d.state.lobby, pushed: true, all_acked: true, acks } as State['lobby'] };
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(m.find('[data-lobby-primary]')[0].getAttribute('data-lobby-primary')).toBe('arm');
    expect(m.find('[data-lobby-primary]')[0].textContent).toBe('ARM COUNTDOWN ▸');
    expect(m.text()).toContain('Arm the countdown, then walk out.');
    expect(m.text()).not.toContain('Push, then walk');
    m.unmount();
  });
});

describe('M20 · the empty LOBBY is neither balanced nor ready', () => {
  it('says NO PLAYERS YET in grey, and no green "all ready"', async () => {
    const d = await demo();
    const state: State = { ...starved(d.state), phase: 'lobby' };
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    const tag = m.find('[data-roster-empty="1"]')[0];
    expect(tag, 'the empty-roster tag').toBeTruthy();
    expect(tag.textContent).toBe('NO PLAYERS YET');
    expect(tag.style.background).not.toBe(rgb(T.ok));
    expect(m.text()).not.toContain('BALANCED');
    expect(m.text()).not.toContain('All nodes ready');
    const line = Array.from(m.el.querySelectorAll('[data-rail="lobby"] div')).find(e => (e.textContent ?? '').startsWith('Nobody is on the roster')) as HTMLElement;
    expect(line, 'the rail says nobody is rostered').toBeTruthy();
    expect(line.style.color, 'not the green of a ready field').toBe(rgb(T.micro));
    m.unmount();
  });
});

describe('M4 · ARMORY', () => {
  async function board(statuses: string[]) {
    const d = await demo();
    const rows = d.state.readiness.board.slice(0, statuses.length).map((r, i) => ({ ...r, status: statuses[i],
      blockers: statuses[i] === 'red' ? ['GUN LINK LOST — POWER IT ON'] : [], ambers: statuses[i] === 'amber' ? ['LOW PHONE BATTERY'] : [] }) as ReadinessRow);
    const state: State = { ...d.state, readiness: { ...d.state.readiness, board: rows } };
    return { d, state, rows };
  }

  it('puts problem guns first: red, amber, no phone, then green', async () => {
    const { d, state, rows } = await board(['green', 'waiting', 'green', 'amber', 'red']);
    const m = await mountScreen(<Armory />, { state, weapons: d.weapons, perks: d.perks });
    const order = m.find('[data-gun-card]').map(c => c.getAttribute('data-gun-card'));
    expect(order).toEqual([rows[4].sticker, rows[3].sticker, rows[1].sticker, rows[0].sticker, rows[2].sticker]);
    m.unmount();
  });

  it('draws the pressable WAITING FOR N PHONES gate in the accent, not the disabled grey', async () => {
    const { d, state } = await board(['green', 'waiting']);
    const m = await mountScreen(<Armory />, { state, weapons: d.weapons, perks: d.perks });
    const gate = m.find('[data-testid="armory-gate"]')[0] as HTMLButtonElement;
    expect(gate.textContent).toBe('WAITING FOR 1 PHONE ▸');
    expect(gate.disabled).toBe(false);
    expect(gate.style.color).toBe(rgb(T.acc));
    expect(gate.style.border).toContain(rgb(T.acc));
    m.unmount();
  });
});

describe('M18 / M19 · KIT', () => {
  it('wraps the roster strip in the ScrollX hint, naming how many players there are', async () => {
    const d = await demo();
    const m = await mountScreen(<Kit />, { ...d, view: 'kit', selPlayer: d.state.players[0].player_id });
    const rows = m.find('.kit-roster-rows')[0];
    expect(rows, 'the roster strip').toBeTruthy();
    const hint = rows.parentElement!.previousElementSibling as HTMLElement;
    expect(hint.getAttribute('data-scroll-hint'), 'a ScrollX hint sits before the strip').not.toBeNull();
    expect(hint.textContent).toBe(`▸ SCROLL FOR ALL ${d.state.players.length} PLAYERS`);
    m.unmount();
  });

  it('sets no inline font under 11 px anywhere on the screen', async () => {
    const d = await demo();
    const m = await mountScreen(<Kit />, { ...d, view: 'kit', selPlayer: d.state.players[0].player_id });
    const tiny = m.find('[style*="font"]').filter(e => {
      const px = /(\d+(?:\.\d+)?)px/.exec(e.style.font || e.style.fontSize || '');
      return px && Number(px[1]) < 11 && (e.textContent ?? '').trim() !== '';
    }).map(e => `${e.style.font} "${(e.textContent ?? '').trim().slice(0, 30)}"`);
    expect(tiny).toEqual([]);
    m.unmount();
  });
});
