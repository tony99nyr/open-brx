// A28: the Armory REACH panel (backhaul tunnel control) and the Lobby coverage/reach readout.
//
// The control must be VISIBLE in every state — unavailable, off, starting, up, error, manual, and on
// a server that predates A28 entirely — never hidden, per the ui-build-verify skill's "every control
// must visibly respond" and "never swallow an error" rules. Screen-truth assertions: rendered text
// and disabled state, not the fixture's own object.
import { describe, expect, it, vi } from 'vitest';
import { Armory } from '../src/screens/Armory';
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

  it('off: shows OFF and TURN ON posts {on:true}', async () => {
    const setTunnel = vi.fn(async () => ({ ws_url: null, status: 'starting', provider: 'cloudflared', available: true }) as LanPublic);
    const d = await withPublic({ ws_url: null, status: 'off', provider: 'cloudflared', available: true });
    const m = await mountScreen(<Armory />, { ...d, api: { setTunnel } });
    expect(m.text()).toContain('OFF');
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

  it('up: shows UP <hostname>, and the QR caption says it carries the internet URL; TURN OFF posts {on:false}', async () => {
    const setTunnel = vi.fn(async () => ({ ws_url: null, status: 'off', provider: 'cloudflared', available: true }) as LanPublic);
    const d = await withPublic({ ws_url: 'wss://abcd1234.trycloudflare.com/ws', status: 'up', provider: 'cloudflared', available: true });
    const m = await mountScreen(<Armory />, { ...d, api: { setTunnel } });
    expect(m.text()).toContain('UP');
    expect(m.text()).toContain('abcd1234.trycloudflare.com');
    await m.click('SHOW QR CODES');
    expect(m.text()).toContain('CARRIES THE LAN + INTERNET JOIN');
    await m.click('TURN OFF');
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
    expect(m.text()).toContain('COVERAGE ZONES — 2 OF 5 ON BACKHAUL');
    m.unmount();
  });

  it('FULL COVERAGE when every bound node is on backhaul', async () => {
    const d = await demo();
    const state: State = { ...d.state, coverage: { level: 'full', on_backhaul: 5, bound: 5 },
      lan: { ...d.state.lan, public: { ws_url: 'wss://x.trycloudflare.com/ws', status: 'up', provider: 'cloudflared', available: true } } };
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(m.text()).toContain('FULL COVERAGE — 5 OF 5 ON BACKHAUL');
    m.unmount();
  });

  /** the roster-row reach tag only, never the coverage-line text (which also contains the word
   *  "BACKHAUL" and would make a whole-page substring check pass for the wrong reason) */
  const reachTags = (m: { find(sel: string): HTMLElement[] }) =>
    m.find('span').map(s => (s.textContent ?? '').trim()).filter(t => t === 'LAN' || t === 'BACKHAUL');

  it('a node connected over backhaul shows a BACKHAUL tag on its roster row; a LAN node shows LAN', async () => {
    const d = await demo();
    const firstNodePid = d.state.nodes.find(n => n.player_id)?.player_id;
    expect(firstNodePid, 'the demo fixture has at least one bound node — control for the assertion below').toBeTruthy();
    const nodes = d.state.nodes.map(n => n.player_id === firstNodePid ? { ...n, reach: 'backhaul' as const } : { ...n, reach: 'lan' as const });
    const state: State = { ...d.state, nodes };
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    const tags = reachTags(m);
    expect(tags).toContain('BACKHAUL');
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
