import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { CommandBar } from '../src/frame/CommandBar';
import { panicReceipt } from '../src/frame/frameText';
import { sevOf } from '../src/alerts';
import type { State } from '../src/api/types';
import { Armory } from '../src/screens/Armory';
import { Games } from '../src/screens/Games';
import { Items } from '../src/screens/Items';
import { Kit } from '../src/screens/Kit';
import { StoreCtx } from '../src/store';
import { FaultPill, HelpNote, ItemChip } from '../src/ui/Compact';
import { LoadError } from '../src/ui/LoadError';
import { demo, makeStore, mount } from './harness';

function pointer(target: Element, type: 'pointerover' | 'pointerout', pointerType = 'mouse') {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  target.dispatchEvent(event);
}

async function revealCycle(m: Awaited<ReturnType<typeof mount>>, selector: string, detail: string, hoverSelector = selector) {
  const button = m.find(selector)[0];
  const hoverTarget = m.find(hoverSelector)[0];
  expect(button).toBeTruthy();
  expect(m.text()).not.toContain(detail);
  await act(async () => { pointer(hoverTarget, 'pointerover'); });
  expect(m.text()).toContain(detail);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  if (button.textContent?.includes('Why?')) expect(button.textContent).not.toContain('Hide');
  await act(async () => { button.click(); });
  expect(m.text()).toContain(detail);
  if (button.textContent?.includes('Why?') || button.textContent?.includes('Hide')) expect(button.textContent).toContain('Hide');
  await act(async () => { pointer(hoverTarget, 'pointerout'); });
  expect(m.text()).toContain(detail);
  await act(async () => { button.click(); });
  expect(m.text()).not.toContain(detail);
  expect(button.getAttribute('aria-expanded')).toBe('false');
}

describe('F599 console copy', () => {
  it('opens FaultPill detail on hover and pins it with a tap', async () => {
    const m = await mount(<FaultPill id="frame-mc-offline" short="MC offline" why="Check the server." />);
    expect(m.find('button')[0].getAttribute('aria-label')).toBe('Why? MC offline');
    await revealCycle(m, 'button', 'Check the server.', '[data-alert="frame-mc-offline"]');
    m.unmount();
  });

  it('opens ItemChip detail on hover and pins it with a tap', async () => {
    const m = await mount(<ItemChip id="kit-slot-note-locked" short="Kit locked" detail="Change it after the whistle." />);
    await revealCycle(m, 'button', 'Change it after the whistle.');
    m.unmount();
  });

  it('opens HelpNote detail on hover and pins it with a tap', async () => {
    const m = await mount(<HelpNote label="INFO" keep="Players pick on their phone." />);
    await revealCycle(m, 'button', 'Players pick on their phone.');
    m.unmount();
  });

  it('pins hovered detail on tap and closes it on the next tap', async () => {
    for (const node of [
      <FaultPill key="fault" id="frame-mc-offline" short="MC offline" why="Check the server." />,
      <ItemChip key="chip" id="kit-slot-note-locked" short="Kit locked" detail="Check the kit." />,
    ]) {
      const m = await mount(node);
      const wrapper = m.find('[data-alert]')[0]?.closest('div') as HTMLElement;
      const button = m.find('button')[0] as HTMLButtonElement;
      const hoverTarget = node.key === 'chip' ? button : wrapper;
      await act(async () => { pointer(hoverTarget, 'pointerover'); });
      expect(button.getAttribute('aria-expanded')).toBe('true');
      await act(async () => { button.click(); });
      expect(button.getAttribute('aria-expanded')).toBe('true');
      await act(async () => { button.click(); });
      expect(button.getAttribute('aria-expanded')).toBe('false');
      await act(async () => { pointer(hoverTarget, 'pointerout'); });
      m.unmount();
    }
  });

  it('does not open detail when a touch pointer enters', async () => {
    for (const node of [
      <FaultPill key="fault" id="frame-mc-offline" short="MC offline" why="Check the server." />,
      <ItemChip key="chip" id="kit-slot-note-locked" short="Kit locked" detail="Check the kit." />,
    ]) {
      const m = await mount(node);
      const target = node.key === 'chip' ? m.find('button')[0].parentElement! : m.find('[data-alert]')[0];
      await act(async () => { pointer(target, 'pointerover', 'touch'); });
      expect(m.find('[data-testid="fault-detail"], [data-testid="chip-detail"]')).toHaveLength(0);
      m.unmount();
    }
  });

  it('takes chip and failed-load severity from the catalogue and exposes live roles', async () => {
    const cases = [
      <FaultPill key="red" id="frame-mc-offline" role="status" short="MC offline" why="Check MC." />,
      <ItemChip key="amber" id="kit-slot-note-locked" short="Kit locked" detail="Check kit." />,
      <ItemChip key="alert" id="frame-catalogue-unavailable" short="Catalogue unavailable" role="alert" detail="Retry." />,
      ...['games-pieces-error', 'games-favourites-error', 'kit-load-error'].map(id =>
        <LoadError key={id} id={id} testid={id} retryTestid={`${id}-retry`} what="the list" error="MC refused." onRetry={() => {}} />),
    ];
    for (const node of cases) {
      const m = await mount(node);
      const alert = m.find('[data-alert]')[0];
      const id = alert.getAttribute('data-alert')!;
      expect(alert.getAttribute('data-sev'), id).toBe(sevOf(id));
      const live = alert.tagName === 'BUTTON' ? alert.parentElement! : alert;
      expect(live.getAttribute('role'), id).toBe(id === 'frame-catalogue-unavailable' ? 'alert' : 'status');
      m.unmount();
    }
  });

  it("keeps a chip's hover target within its visible width", async () => {
    const m = await mount(<ItemChip id="kit-slot-note-locked" short="Kit locked" detail="Check kit." />);
    const button = m.find('button[data-alert]')[0];
    const wrapper = button.parentElement as HTMLElement;
    expect(wrapper.style.display).toBe('inline-flex');
    await act(async () => { pointer(wrapper, 'pointerover'); });
    expect(m.text()).toContain('Check kit.');
    m.unmount();
  });

  it('puts the HelpNote test id on the opened body and a separate id on INFO', async () => {
    const m = await mount(<HelpNote label="INFO" testid="operator-note" keep="Player picks." />);
    expect(m.find('[data-testid="help-info"]')).toHaveLength(1);
    expect(m.find('[data-testid="operator-note"]')).toHaveLength(0);
    await m.click('INFO');
    expect(m.find('[data-testid="operator-note"]')[0]?.textContent).toBe('Player picks.');
    m.unmount();
  });

  it('shows static fault and chip details without a control', async () => {
    const m = await mount(<><FaultPill id="frame-mc-offline" short="MC offline" why="Check MC." static />
      <ItemChip id="kit-slot-note-locked" short="Kit locked" detail="Check kit." static /></>);
    expect(m.find('button')).toHaveLength(0);
    expect(m.text()).toContain('Check MC.');
    expect(m.text()).toContain('Check kit.');
    m.unmount();
  });

  it('names up to three KIT players and counts larger groups with names in the title', async () => {
    const d = await demo();
    for (const names of [['Ana'], ['Ana', 'Ben'], ['Ana', 'Ben', 'Cal'], ['Ana', 'Ben', 'Cal', 'Dee']]) {
      const state = { ...d.state, phase: 'kit' as const, players: d.state.players.map((p, i) => ({ ...p, display: names[i] ?? `Ready ${i}`, ready: i >= names.length })) };
      const store = makeStore({ ...d, state, view: 'kit', selPlayer: state.players[0]?.player_id });
      const m = await mount(<StoreCtx.Provider value={store}><Kit /></StoreCtx.Provider>);
      const button = m.find('[data-continue="kit"] button').slice(-1)[0];
      await act(async () => { button.click(); });
      const warn = m.find('[data-continue-warn="1"]')[0];
      expect(warn).toBeTruthy();
      if (names.length <= 3) expect(warn.textContent).toContain(`${(names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]}, ${names[1]} and ${names[2]}`)} still kitting`);
      else {
        expect(warn.textContent).toContain('4 still kitting');
        expect(warn.querySelector('[title]')?.getAttribute('title')).toContain('Ana, Ben, Cal, Dee');
      }
      m.unmount();
    }
  });

  it('puts MC offline and tunnel faults in one CommandBar container', async () => {
    const d = await demo();
    const state = { ...d.state, lan: { ...d.state.lan, public: { ...d.state.lan.public, ws_url: d.state.lan.public?.ws_url ?? null, provider: d.state.lan.public?.provider ?? null, available: d.state.lan.public?.available ?? false, status: 'error' as const, error: 'tunnel failed' } } };
    const store = makeStore({ ...d, state }, { mock: false, connected: false });
    const m = await mount(<StoreCtx.Provider value={store}><CommandBar /></StoreCtx.Provider>);
    const row = m.find('[data-testid="frame-faults"]')[0];
    expect(row).toBeTruthy();
    expect(row.querySelector('[data-alert="frame-mc-offline"]')).toBeTruthy();
    expect(row.querySelector('[data-alert="frame-tunnel-down"]')).toBeTruthy();
    m.unmount();
  });

  it('words all panic receipt outcomes in sentence case', () => {
    const at = new Date('2026-10-25T21:36:07');
    expect(panicReceipt({ ok: true, reached: 6, nodes: 8 }, at)).toMatchObject({ text: 'Panic reached 6 of 8', detail: 'The rest are still live. Re-arm before play.', bad: true });
    expect(panicReceipt({ ok: true, reached: 8, nodes: 8 }, at)).toMatchObject({ text: 'Fleet safed, 8 of 8', detail: 'Re-arm before play.', bad: true });
    expect(panicReceipt(undefined, at)).toMatchObject({ text: 'Panic failed', detail: 'Check the server.', bad: true });
    expect(panicReceipt({ ok: false, error: 'Not armed' }, at)).toMatchObject({ text: 'Panic refused', detail: 'Not armed', bad: true });
    expect(panicReceipt({ ok: true, reached: 6, nodes: 8 }, at).time).toBe('21:36:07');
  });

  it('keeps visible red and amber alert labels short and in sentence case on the four changed screens', async () => {
    const d = await demo();
    const scenarios: [string, (state: State) => State, React.ReactNode][] = [
      ['ARMORY', s => ({ ...s, restore_failed: { reason: 'Could not read session', kept: 'backup' } }), <Armory key="armory" />],
      ['PLAY', s => ({ ...s, config: { ...s.config, mode: 'koth' }, stations: [] }), <Games key="play" />],
      ['ITEMS', s => ({ ...s, station_departures: [{ node_id: 'gone', kind: 'control', id: 1, team: 1, threshold: 0, label: 'PHONE gone', id_free: true, reason: 'back_to_hud', at_ms: Date.now(), returned: false, restore: { kind: 'control', team: 1, threshold: 0 }, line: 'CONTROL 1 LEFT: RESTORE IT OR DISMISS THIS' }] as never }), <Items key="items" />],
      ['KIT', s => ({ ...s, phase: 'kit', players: s.players.map((p, i) => ({ ...p, ready: i > 0 })) }), <Kit key="kit" />],
    ];
    for (const [name, inject, screen] of scenarios) {
      const state = inject(d.state);
      const view = name === 'PLAY' ? 'build' : name === 'ARMORY' || name === 'ITEMS' ? 'muster' : 'kit';
      const store = makeStore({ ...d, state, view, selPlayer: state.players[0]?.player_id });
      const m = await mount(<StoreCtx.Provider value={store}>{screen}</StoreCtx.Provider>);
      for (const alert of m.find('[data-sev="red"], [data-sev="amber"]')) {
        const id = alert.getAttribute('data-alert');
        if (id) expect(alert.getAttribute('data-sev'), `${name} ${id} severity`).toBe(sevOf(id));
        const pillLabel = alert.querySelector(':scope > div > button[aria-expanded]')
          ? alert.querySelector(':scope > div > span')?.textContent : null;
        const label = (pillLabel ?? alert.textContent ?? '').replace(/[▾▴]/g, '').trim();
        const words = label.split(/\s+/).filter(Boolean);
        expect(words.length, `${name} ${alert.getAttribute("data-alert")}: ${label}`).toBeLessThanOrEqual(8);
        expect(label === label.toUpperCase(), `${name} ${alert.getAttribute("data-alert")}: ${label}`).toBe(false);
      }
      m.unmount();
    }
  });
});
