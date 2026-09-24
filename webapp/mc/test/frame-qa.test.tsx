// The console frame, visual QA 2026-09-23 (H6, M10, M11, M13, M21, M22 and the frame Lows).
//
// Each case asserts what the operator SEES: the rendered notice, the banner's role and colour, the
// copy beside the QR, the PANIC confirm and its receipt, and where keyboard focus is. jsdom lays
// nothing out, so the one-row command bar (M9) is proven in a real browser instead
// (`test/e2e/frame.mjs`).
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReportResult, State } from '../src/api/types';
import { CommandBar } from '../src/frame/CommandBar';
import { clock24, panicReceipt, splitWarning } from '../src/frame/frameText';
import { clearNotice, setNotice } from '../src/notice';
import { Armory } from '../src/screens/Armory';
import { StoreCtx } from '../src/store';
import { T } from '../src/tokens';
import { LoadStatus } from '../src/ui/LoadedGame';
import { VenueModeManualLink } from '../src/ui/VenueModeReminder';
import { demo, fixtureApi, makeStore, mount, mountScreen } from './harness';

afterEach(() => { clearNotice(); });

const WSL = 'PHONES CANNOT REACH THIS ADDRESS — this looks like WSL2. Pass --advertise <windows-lan-ip>.';

/** A CommandBar whose store can be swapped, the way a new snapshot arrives. */
async function bar(state: State, extra: Parameters<typeof makeStore>[1] = {}) {
  const d = await demo();
  const api = fixtureApi({}, d.api);
  const mk = (s: State) => makeStore({ ...d, state: s, view: 'muster' }, { api, ...extra });
  const m = await mount(<StoreCtx.Provider value={mk(state)}><CommandBar /></StoreCtx.Provider>);
  return Object.assign(m, { to: (s: State) => m.update(<StoreCtx.Provider value={mk(s)}><CommandBar /></StoreCtx.Provider>) });
}
const toasts = (m: { find(s: string): HTMLElement[] }) => m.find('[data-testid="cb-notices"]')[0]?.textContent ?? '';

describe('H6 · a notice from the last match does not ride into the next one', () => {
  it('MATCH ENDED clears when the next match arms', async () => {
    const d = await demo();
    const m = await bar({ ...d.state, phase: 'live' });
    await act(async () => { setNotice('MATCH ENDED · REACHED 8 OF 8 NODES'); });
    for (const phase of ['recap', 'build', 'kit', 'lobby'] as const) {
      await m.to({ ...d.state, phase });
      expect(toasts(m), `still shown on ${phase}: it outlives LIVE on purpose`).toContain('MATCH ENDED');
    }
    await m.to({ ...d.state, phase: 'armed' });
    expect(toasts(m), 'gone once the next match arms').not.toContain('MATCH ENDED');
    await m.to({ ...d.state, phase: 'live' });
    expect(toasts(m)).not.toContain('MATCH ENDED');
    m.unmount();
  });

  it('and when a match goes live straight from RECAP', async () => {
    const d = await demo();
    const m = await bar({ ...d.state, phase: 'recap' });
    await act(async () => { setNotice('MATCH ENDED · REACHED 8 OF 8 NODES'); });
    await m.to({ ...d.state, phase: 'live' });
    expect(toasts(m)).not.toContain('MATCH ENDED');
    m.unmount();
  });

  it('a notice raised in the phase just left survives the move (LOBBY → ARMED, BUILD → LIVE)', async () => {
    const d = await demo();
    const m = await bar({ ...d.state, phase: 'lobby' });
    await act(async () => { setNotice('CONFIG PUSHED'); });
    await m.to({ ...d.state, phase: 'armed' });
    expect(toasts(m)).toContain('CONFIG PUSHED');
    m.unmount();
    clearNotice();
    const m2 = await bar({ ...d.state, phase: 'build' });
    await act(async () => { setNotice('RESUMED THEIR MATCH'); });
    await m2.to({ ...d.state, phase: 'live' });
    expect(toasts(m2)).toContain('RESUMED THEIR MATCH');
    m2.unmount();
  });
});

describe('M10 · the WSL note is one neutral line, with the how-to behind an expand', () => {
  it('is a status, not a red alert, and shows only the headline until asked', async () => {
    const d = await demo();
    const m = await bar({ ...d.state, lan: { ...d.state.lan, warning: WSL } });
    const line = m.find('[data-testid="lan-warning"]')[0];
    expect(line, 'the note is on screen').toBeTruthy();
    expect(line.getAttribute('role')).toBe('status');
    expect(m.find('[role="alert"]').some(a => /CANNOT REACH/.test(a.textContent ?? '')), 'not an alert').toBe(false);
    // jsdom normalises inline colours to rgb(); T.bad (#ff5252) is rgb(255, 82, 82)
    const css = [line, ...Array.from(line.querySelectorAll<HTMLElement>('*'))].map(e => e.style.cssText + (e.getAttribute('stroke') ?? '') + (e.getAttribute('fill') ?? '')).join(' ');
    expect(T.bad.toLowerCase()).toBe('#ff5252');
    expect(css.includes('255, 82, 82') || css.toLowerCase().includes('#ff5252'), 'nothing in the note is alarm red').toBe(false);
    expect(line.textContent).toContain('PHONES CANNOT REACH THIS ADDRESS');
    expect(line.textContent, 'the how-to stays folded').not.toContain('--advertise');
    const btn = line.querySelector('button')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    await act(async () => { btn.click(); });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(line.textContent).toContain('--advertise <windows-lan-ip>');
    m.unmount();
  });

  it('splits the server string at its first dash, and keeps a dashless string whole', () => {
    expect(splitWarning(WSL)).toEqual({ head: 'PHONES CANNOT REACH THIS ADDRESS', rest: 'this looks like WSL2. Pass --advertise <windows-lan-ip>.' });
    expect(splitWarning('NO DASH HERE')).toEqual({ head: 'NO DASH HERE', rest: '' });
  });
});

describe('M11 · JOIN THE NET only promises an automatic find when MC believes its address', () => {
  const hint = async (lan: Partial<State['lan']>) => {
    const d = await demo();
    const m = await mountScreen(<Armory />, { ...d, state: { ...d.state, lan: { ...d.state.lan, ...lan } } });
    const t = m.find('[data-testid="join-hint"]')[0]?.textContent ?? '';
    m.unmount();
    return t;
  };
  it('says AUTOMATICALLY on a clean LAN', async () => {
    expect(await hint({ warning: null, ip: '192.168.1.20' })).toMatch(/AUTOMATICALLY/);
  });
  it('says NOT beside the reachability note', async () => {
    const t = await hint({ warning: WSL, ip: '172.28.1.5' });
    expect(t).not.toMatch(/AUTOMATICALLY/);
    expect(t).toMatch(/NOT FIND MC/);
  });
  it('says NOT when MC has no routable address', async () => {
    const t = await hint({ warning: null, ip: '127.0.0.1' });
    expect(t).not.toMatch(/AUTOMATICALLY/);
    expect(t).toMatch(/NOT ON A NETWORK PHONES CAN REACH/);
  });
});

describe('M13 · the tunnel banner is worded for the state it is in', () => {
  const pub = (status: 'up' | 'error') => ({ ws_url: status === 'up' ? 'wss://x.trycloudflare.com/ws' : null, status, provider: 'cloudflared' as const, available: true, ...(status === 'error' ? { error: 'cloudflared exited (1)' } : {}) });
  it('a tunnel this tab never saw up does not claim phones fell back from it', async () => {
    const d = await demo();
    const m = await bar({ ...d.state, lan: { ...d.state.lan, public: pub('error') } });
    const t = m.find('[role="alert"]').map(a => a.textContent).join(' ');
    expect(t).toContain('INTERNET TUNNEL DOWN');
    expect(t).not.toContain('FELL BACK');
    expect(t).toContain('PHONES CAN JOIN OVER WI-FI ONLY');
    m.unmount();
  });
  it('a tunnel that was up and then failed says phones fell back', async () => {
    const d = await demo();
    const m = await bar({ ...d.state, lan: { ...d.state.lan, public: pub('up') } });
    expect(m.find('[role="alert"]').some(a => /TUNNEL DOWN/.test(a.textContent ?? ''))).toBe(false);
    await m.to({ ...d.state, lan: { ...d.state.lan, public: pub('error') } });
    expect(m.find('[role="alert"]').map(a => a.textContent).join(' ')).toContain('PHONES FELL BACK TO WI-FI');
    m.unmount();
  });
});

describe('M21 · PANIC warns about the re-arm, and its receipt counts and uses a 24-hour clock', () => {
  it('the confirm says no gun can be hit until it is re-armed', async () => {
    const d = await demo();
    const m = await bar(d.state);
    await m.click('☰');
    await m.click('Panic');
    const warn = m.find('[data-testid="panic-warning"]')[0];
    expect(warn, 'the re-arm warning is in the confirm').toBeTruthy();
    expect(warn.textContent).toMatch(/no gun can be hit until you re-arm it/i);
    m.unmount();
  });

  it('CONFIRM leaves a receipt with n OF N and a 24-hour time', async () => {
    const d = await demo();
    const api = fixtureApi({ control: async () => ({ ok: true, ended: true, reached: 7, pushed: 7, nodes: 8, phase: 'kit' as const }) }, d.api);
    const m = await bar(d.state, { api, run: async fn => fn() });
    await m.click('☰');
    await m.click('Panic');
    await m.click('CONFIRM');
    const t = toasts(m);
    expect(t).toContain('PANIC REACHED 7 OF 8 NODES');
    expect(t).toMatch(/\(\d\d:\d\d:\d\d\)/);
    expect(t).not.toMatch(/[AP]M/);
    m.unmount();
  });

  it('clock24 and the receipt wording', () => {
    expect(clock24(new Date(2026, 8, 23, 21, 36, 7))).toBe('21:36:07');
    expect(clock24(new Date(2026, 8, 23, 9, 5, 0))).toBe('09:05:00');
    const at = new Date(2026, 8, 23, 21, 36, 7);
    expect(panicReceipt({ ok: true, reached: 8, nodes: 8 }, at).text).toBe('FLEET SAFED · 8 OF 8 NODES (21:36:07) — RE-ARM BEFORE PLAY');
    expect(panicReceipt({ ok: true }, at).text, 'an older MC sends no count, so none is invented').toBe('FLEET SAFED (21:36:07) — RE-ARM BEFORE PLAY');
    expect(panicReceipt(undefined, at).text).toMatch(/PANIC FAILED/);
  });

  it('a PANIC receipt clears when the next match arms', async () => {
    const d = await demo();
    const api = fixtureApi({ control: async () => ({ ok: true, reached: 8, nodes: 8 }) }, d.api);
    const m = await bar({ ...d.state, phase: 'kit' }, { api, run: async fn => fn() });
    await m.click('☰'); await m.click('Panic'); await m.click('CONFIRM');
    expect(toasts(m)).toContain('FLEET SAFED');
    await m.to({ ...d.state, phase: 'lobby' });
    await m.to({ ...d.state, phase: 'armed' });
    expect(toasts(m)).not.toContain('FLEET SAFED');
    m.unmount();
  });
});

describe('M22 · Report a problem keeps its privacy warning and holds focus', () => {
  const RESULT: ReportResult = {
    file: 'r.zip', download: '/api/report/r.zip', issue_url: 'https://github.com/x/y/issues/new',
    summary: {}, removed: { names: 1 }, too_large: false,
  } as unknown as ReportResult;

  it('focus moves into the dialog on open, stays in it through MAKE REPORT, and returns to ☰ on close', async () => {
    const d = await demo();
    let resolve!: (r: ReportResult) => void;
    const api = fixtureApi({ makeReport: () => new Promise<ReportResult>(r => { resolve = r; }) }, d.api);
    const m = await bar(d.state, { api });
    const menuBtn = m.find('button[aria-haspopup="menu"]')[0];
    await m.click('☰');
    await m.click('Report a problem');
    const dialog = () => m.find('[data-testid="report-panel"]')[0];
    expect(dialog().contains(document.activeElement), 'focus is inside the dialog when it opens').toBe(true);
    const make = Array.from(dialog().querySelectorAll('button')).find(b => b.textContent?.includes('MAKE REPORT'))!;
    make.focus();
    await act(async () => { make.click(); });
    expect(dialog().getAttribute('data-report-phase')).toBe('busy');
    expect(dialog().contains(document.activeElement), 'MAKE REPORT unmounted, and focus did not fall to <body>').toBe(true);
    await act(async () => { resolve(RESULT); });
    expect(dialog().getAttribute('data-report-phase')).toBe('done');
    expect(dialog().contains(document.activeElement)).toBe(true);
    // the privacy warning is still there, now that the file exists
    const priv = dialog().querySelector('[data-testid="report-privacy"]');
    expect(priv?.textContent).toMatch(/GitHub issues are public/);
    expect(priv?.textContent).toMatch(/text you typed/);
    await m.click('✕');
    expect(document.activeElement).toBe(menuBtn);
    m.unmount();
  });
});

describe('frame Lows', () => {
  it('the ☰ button has an accessible name', async () => {
    const d = await demo();
    const m = await bar(d.state);
    expect(m.find('button[aria-haspopup="menu"]')[0].getAttribute('aria-label')).toBe('Menu');
    m.unmount();
  });

  it('the info mark is drawn, not the ⓘ glyph the bundled fonts lack', async () => {
    const m = await mount(<VenueModeManualLink />);
    expect(m.text()).not.toContain('ⓘ');
    expect(m.find('svg[data-icon="info"]').length).toBe(1);
    m.unmount();
  });

  it('LOBBY does not tell the operator to push config "in LOBBY"', async () => {
    const d = await demo();
    const onLobby = await mount(<StoreCtx.Provider value={makeStore({ ...d, view: 'lobby' })}><LoadStatus pushed={false} acked={0} total={8} recent={false} /></StoreCtx.Provider>);
    expect(onLobby.text()).not.toMatch(/in LOBBY/);
    expect(onLobby.text()).toMatch(/push config below/);
    onLobby.unmount();
    const onKit = await mount(<StoreCtx.Provider value={makeStore({ ...d, view: 'kit' })}><LoadStatus pushed={false} acked={0} total={8} recent={false} /></StoreCtx.Provider>);
    expect(onKit.text()).toMatch(/push config in LOBBY/);
    onKit.unmount();
  });
});
