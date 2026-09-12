// A28: the Armory REACH panel (backhaul tunnel control) and the Lobby coverage/reach readout.
//
// The control must be VISIBLE in every state — unavailable, off, starting, up, error, manual, and on
// a server that predates A28 entirely — never hidden, per the ui-build-verify skill's "every control
// must visibly respond" and "never swallow an error" rules. Screen-truth assertions: rendered text
// and disabled state, not the fixture's own object.
import { describe, expect, it, vi } from 'vitest';
import { CommandBar } from '../src/frame/CommandBar';
import { Armed } from '../src/screens/Armed';
import { Armory } from '../src/screens/Armory';
import { Live } from '../src/screens/Live';
import { Lobby } from '../src/screens/Lobby';
import type { LanPublic, State } from '../src/api/types';
import { demo, mountScreen } from './harness';

/** A demo session with `lan.public` set exactly as given (or entirely absent for the "predates A28" case). */
async function withPublic(pub: LanPublic | undefined) {
  const d = await demo();
  const state: State = { ...d.state, lan: { ...d.state.lan, public: pub } };
  return { ...d, state };
}

describe('Armory REACH panel', () => {
  it('renders the NETWORK row and a REACH heading regardless of tunnel state', async () => {
    const d = await withPublic({ ws_url: null, status: 'off', provider: 'cloudflared', available: true });
    const m = await mountScreen(<Armory />, d);
    expect(m.text()).toContain('REACH');
    expect(m.text()).toContain('BRX-FIELD');           // the demo's ssid, rendered on the NETWORK row
    m.unmount();
  });

  it('unavailable: the TURN ON control is disabled, and the install line is shown, never hidden', async () => {
    const d = await withPublic({ ws_url: null, status: 'off', provider: 'cloudflared', available: false });
    const m = await mountScreen(<Armory />, d);
    const btn = m.find('button').find(b => (b.textContent ?? '').includes('TURN ON')) as HTMLButtonElement | undefined;
    expect(btn, 'a TURN ON control is on screen even though it cannot be used').toBeTruthy();
    expect(btn!.disabled).toBe(true);
    expect(m.text()).toContain('brew install cloudflared');
    expect(m.text()).toContain('winget install Cloudflare.cloudflared');
    expect(m.text()).toContain('apt install cloudflared');
    m.unmount();
  });

  it('off: shows OFF, TURN ON posts {on:true}, and the copy tells the host already-joined phones pick it up', async () => {
    const setTunnel = vi.fn(async () => ({ ws_url: null, status: 'starting', provider: 'cloudflared', available: true }) as LanPublic);
    const d = await withPublic({ ws_url: null, status: 'off', provider: 'cloudflared', available: true });
    const m = await mountScreen(<Armory />, { ...d, api: { setTunnel } });
    expect(m.text()).toContain('OFF');
    // A28.2: welcome.join / MC->node join push this to phones already on the LAN — nothing on their
    // end has to change, and the console has to say so or a host re-scans a QR that already worked.
    expect(m.text()).toContain('PHONES ALREADY JOINED PICK THIS UP');
    expect(m.text()).toContain('NEW PHONES SCAN THE QR');
    await m.click('TURN ON');
    expect(setTunnel).toHaveBeenCalledWith(true);
    m.unmount();
  });

  it('starting: shows STARTING…', async () => {
    const d = await withPublic({ ws_url: null, status: 'starting', provider: 'cloudflared', available: true });
    const m = await mountScreen(<Armory />, d);
    expect(m.text()).toContain('STARTING');
    m.unmount();
  });

  it('up: shows UP <hostname>, and the QR caption says it carries the internet URL; TURN OFF warns once then posts {on:false}', async () => {
    const setTunnel = vi.fn(async () => ({ ws_url: null, status: 'off', provider: 'cloudflared', available: true }) as LanPublic);
    const d = await withPublic({ ws_url: 'wss://abcd1234.trycloudflare.com/ws', status: 'up', provider: 'cloudflared', available: true });
    const m = await mountScreen(<Armory />, { ...d, api: { setTunnel } });
    expect(m.text()).toContain('UP');
    expect(m.text()).toContain('abcd1234.trycloudflare.com');
    await m.click('SHOW QR CODES');
    expect(m.text()).toContain('CARRIES THE LAN + INTERNET JOIN');
    // 27b (field 2026-09-12): the first tap only arms the warning — every phone on the internet path
    // would drop and have to rescan the QR — and must not call the API yet.
    await m.click('TURN OFF');
    expect(setTunnel).not.toHaveBeenCalled();
    expect(m.text()).toContain('EVERY PHONE ON THE INTERNET PATH WILL DROP');
    await m.click('TURN OFF');   // the confirm button's text still contains "TURN OFF"
    expect(setTunnel).toHaveBeenCalledWith(false);
    m.unmount();
  });

  it('the QR caption says LAN ONLY while the tunnel is off', async () => {
    const d = await withPublic({ ws_url: null, status: 'off', provider: 'cloudflared', available: true });
    const m = await mountScreen(<Armory />, d);
    await m.click('SHOW QR CODES');
    expect(m.text()).toContain('CARRIES THE LAN JOIN ONLY');
    m.unmount();
  });

  it('error: shows ERROR and the server-supplied reason, never swallowed', async () => {
    const d = await withPublic({ ws_url: null, status: 'error', provider: 'cloudflared', available: true, error: 'cloudflared exited: bad gateway' });
    const m = await mountScreen(<Armory />, d);
    expect(m.text()).toContain('ERROR');
    expect(m.text()).toContain('cloudflared exited: bad gateway');
    m.unmount();
  });

  it('manual: shows the URL and no toggle at all', async () => {
    const d = await withPublic({ ws_url: 'wss://tunnel.example.com/ws', status: 'up', provider: 'manual', available: true });
    const m = await mountScreen(<Armory />, d);
    expect(m.text()).toContain('UP');
    expect(m.text()).toContain('tunnel.example.com');
    expect(m.text().toUpperCase()).toContain('--PUBLIC-URL');
    const toggle = m.find('button').find(b => /TURN (ON|OFF)/.test(b.textContent ?? ''));
    expect(toggle, 'no TURN ON/OFF control when the tunnel is not MC\'s to stop').toBeFalsy();
    m.unmount();
  });

  it('a server that predates A28: the control is disabled with a restart explanation, not hidden or invented', async () => {
    const d = await withPublic(undefined);
    const m = await mountScreen(<Armory />, d);
    expect(m.text()).toContain('PREDATES BACKHAUL');
    const toggle = m.find('button').find(b => /TURN (ON|OFF)/.test(b.textContent ?? ''));
    expect(toggle, 'no toggle is invented for a route that does not exist on this server').toBeFalsy();
    m.unmount();
  });
});

describe('Lobby coverage line and per-node reach tags', () => {
  it('renders no coverage tag when no player node has ever bound (bound === 0)', async () => {
    const d = await demo();
    const state: State = { ...d.state, coverage: { level: 'zones', on_backhaul: 0, bound: 0 } };
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(m.text()).not.toContain('COVERAGE');
    m.unmount();
  });

  it('COVERAGE ZONES when some, but not all, bound nodes are on backhaul', async () => {
    const d = await demo();
    const state: State = { ...d.state, coverage: { level: 'zones', on_backhaul: 2, bound: 5 },
      lan: { ...d.state.lan, public: { ws_url: 'wss://x.trycloudflare.com/ws', status: 'up', provider: 'cloudflared', available: true } } };
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(m.text()).toContain('COVERAGE ZONES — 2 OF 5 ON THE INTERNET PATH');
    m.unmount();
  });

  it('FULL COVERAGE when every bound node is on backhaul', async () => {
    const d = await demo();
    const state: State = { ...d.state, coverage: { level: 'full', on_backhaul: 5, bound: 5 },
      lan: { ...d.state.lan, public: { ws_url: 'wss://x.trycloudflare.com/ws', status: 'up', provider: 'cloudflared', available: true } } };
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(m.text()).toContain('FULL COVERAGE — 5 OF 5 ON THE INTERNET PATH');
    m.unmount();
  });

  /** the roster-row reach tag only, never the coverage-line text (which also contains the word
   *  "INTERNET" and would make a whole-page substring check pass for the wrong reason). S40 (field
   *  2026-09-12): the tag itself now reads INTERNET, not BACKHAUL — "on cellular" was the wrong read
   *  a real operator gave it in the field. */
  const reachTags = (m: { find(sel: string): HTMLElement[] }) =>
    m.find('span').map(s => (s.textContent ?? '').trim()).filter(t => t === 'LAN' || t === 'INTERNET');

  it('a node connected over the internet path shows an INTERNET tag on its roster row; a LAN node shows LAN', async () => {
    const d = await demo();
    const firstNodePid = d.state.nodes.find(n => n.player_id)?.player_id;
    expect(firstNodePid, 'the demo fixture has at least one bound node — control for the assertion below').toBeTruthy();
    const nodes = d.state.nodes.map(n => n.player_id === firstNodePid ? { ...n, reach: 'backhaul' as const } : { ...n, reach: 'lan' as const });
    const state: State = { ...d.state, nodes };
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    const tags = reachTags(m);
    expect(tags).toContain('INTERNET');
    expect(tags).toContain('LAN');
    m.unmount();
  });

  it('a player with no connected node shows no reach tag at all — never invents LAN for one that has not joined', async () => {
    const d = await demo();
    // strip every node so nobody has one, but keep the roster
    const state: State = { ...d.state, nodes: [] };
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(reachTags(m)).toEqual([]);
    m.unmount();
  });
});

describe('CommandBar: the tunnel-down banner rides on every screen, not just Armory', () => {
  it('a tunnel in error shows a persistent, non-colour-only banner naming the server\'s reason', async () => {
    const d = await withPublic({ ws_url: null, status: 'error', provider: 'cloudflared', available: true, error: 'cloudflared exited: bad gateway' });
    const m = await mountScreen(<CommandBar />, d);
    const alert = m.find('[role="alert"]').find(el => /TUNNEL DOWN/.test(el.textContent ?? ''));
    expect(alert, 'a role=alert banner names the tunnel outage').toBeTruthy();
    const txt = (alert!.textContent ?? '');
    expect(txt).toContain('INTERNET TUNNEL DOWN');
    expect(txt).toContain('PHONES FELL BACK TO WI-FI');
    expect(txt).toContain('cloudflared exited: bad gateway');
    // ▲ carries the same meaning as the colour — never colour-only
    expect(txt.trim().startsWith('▲')).toBe(true);
    m.unmount();
  });

  it('no banner when the tunnel is off, up, or unsupported — only ERROR is an outage', async () => {
    for (const pub of [
      { ws_url: null, status: 'off', provider: 'cloudflared', available: true } as LanPublic,
      { ws_url: 'wss://x.trycloudflare.com/ws', status: 'up', provider: 'cloudflared', available: true } as LanPublic,
      undefined,
    ]) {
      const d = await withPublic(pub);
      const m = await mountScreen(<CommandBar />, d);
      expect(m.find('[role="alert"]').some(el => /TUNNEL DOWN/.test(el.textContent ?? ''))).toBe(false);
      m.unmount();
    }
  });
});

describe('Armed and Live carry the same coverage line as Lobby', () => {
  it('Armed (no schedule yet) shows the coverage line in its header', async () => {
    const d = await demo();
    const state: State = { ...d.state, start: undefined, coverage: { level: 'zones', on_backhaul: 1, bound: 4 },
      lan: { ...d.state.lan, public: { ws_url: 'wss://x.trycloudflare.com/ws', status: 'up', provider: 'cloudflared', available: true } } };
    const m = await mountScreen(<Armed />, { ...d, state, view: 'armed' });
    expect(m.text()).toContain('COVERAGE ZONES — 1 OF 4 ON THE INTERNET PATH');
    m.unmount();
  });

  it('Live shows the coverage line while a match is running', async () => {
    const d = await demo();
    const live = { match_id: 'm1', go_live_t: Date.now() - 1000, time_limit_s: 600, ends_t: Date.now() + 599000, score: {}, rows: [] };
    const state: State = { ...d.state, live, coverage: { level: 'full', on_backhaul: 4, bound: 4 },
      lan: { ...d.state.lan, public: { ws_url: 'wss://x.trycloudflare.com/ws', status: 'up', provider: 'cloudflared', available: true } } };
    const m = await mountScreen(<Live />, { ...d, state, view: 'live' });
    expect(m.text()).toContain('FULL COVERAGE — 4 OF 4 ON THE INTERNET PATH');
    m.unmount();
  });

  it('Live shows nothing extra when nobody is bound yet (bound === 0)', async () => {
    const d = await demo();
    const live = { match_id: 'm1', go_live_t: Date.now() - 1000, time_limit_s: 600, ends_t: Date.now() + 599000, score: {}, rows: [] };
    const state: State = { ...d.state, live, coverage: { level: 'zones', on_backhaul: 0, bound: 0 } };
    const m = await mountScreen(<Live />, { ...d, state, view: 'live' });
    expect(m.text()).not.toContain('COVERAGE');
    m.unmount();
  });
});
