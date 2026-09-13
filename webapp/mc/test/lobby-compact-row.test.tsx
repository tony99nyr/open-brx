// F-7 (2026-09-13). At 393 px, LOBBY's MemberRow (name, gun, NO PHONE, reach, move-to chips, STAND
// DOWN, ready tag) all competed for one flex-wrap row and wrapped to 3-4 lines per player. Below 480 px
// `useNarrow` (ui/index.tsx) switches the row to a two-line compact layout: identity + ready pinned on
// row one, every other control on row two — proved here as a MECHANISM (jsdom lays nothing out; the
// pixel proof at 393 px is the e2e walk, per the same discipline ScrollX/Shelf already use).
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Lobby } from '../src/screens/Lobby';
import { demo, mountScreen } from './harness';

const JSDOM_VP = { w: 1024, h: 768 };
async function resizeTo(w: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
  await act(async () => { window.dispatchEvent(new Event('resize')); });
}
afterEach(async () => { await resizeTo(JSDOM_VP.w); });

describe('LOBBY MemberRow: a compact variant under 480px', () => {
  it('renders the ordinary wide row at desktop width', async () => {
    await resizeTo(1024);
    const d = await demo();
    const m = await mountScreen(<Lobby />, { ...d, view: 'lobby' });
    expect(m.find('[data-compact-row]').length, 'no compact rows at desktop width').toBe(0);
    // the identity block is still one span carrying both lines (callsign, then gun) — unchanged shape
    expect(m.text()).toContain(d.state.players[0].display);
    m.unmount();
  });

  it('switches every roster row to the compact layout at 393px, and back on resize', async () => {
    await resizeTo(1024);
    const d = await demo();
    const m = await mountScreen(<Lobby />, { ...d, view: 'lobby' });
    expect(m.find('[data-compact-row]').length).toBe(0);
    await resizeTo(393);
    expect(m.find('[data-compact-row]').length, 'one compact row per rostered player').toBe(d.state.players.length);
    await resizeTo(1024);
    expect(m.find('[data-compact-row]').length, 'switches back once the viewport widens again').toBe(0);
    m.unmount();
  });

  it('the compact row keeps every control: callsign, gun, ready tag, move chips, STAND DOWN', async () => {
    await resizeTo(393);
    const d = await demo();
    const [parked, ...rest] = d.state.players;
    const s = { ...d.state, players: rest, standby: [{ ...parked, node_id: null, ready: false }] };
    const m = await mountScreen(<Lobby />, { ...d, state: s, view: 'lobby' });
    const row = m.find('[data-compact-row]').find(r => (r.textContent ?? '').includes(rest[0].display));
    expect(row, `a compact row for ${rest[0].display}`).toBeTruthy();
    expect(row!.textContent).toContain(rest[0].display);
    expect(row!.textContent).toContain(rest[0].gun_id ?? 'NO GUN');
    expect(row!.textContent).toMatch(/READY|WAIT/);
    expect(row!.querySelector('[role="group"]'), 'the move-to chip group survives in the compact row').toBeTruthy();
    expect(row!.querySelector('[data-standby]'), 'STAND DOWN survives in the compact row').toBeTruthy();
    m.unmount();
  });
});
