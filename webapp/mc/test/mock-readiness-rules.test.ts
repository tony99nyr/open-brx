import { describe, expect, it, vi } from 'vitest';
import { MockBackend } from '../src/mock/backend';
import { sessionCoverage, sessionKitted, sessionNoticesMcVerify, sessionOffGrid, sessionReadinessRosterSize, sessionUpdating } from '../src/rules/readiness';

const roster = [
  { player_id: 'a', display: 'ALPHA', node_id: 'node-a', ready: true },
  { player_id: 'b', display: 'BRAVO', node_id: null, ready: true },
];

describe('server readiness rules in the mock', () => {
  it('counts roster slots after a removal', () => {
    expect(sessionReadinessRosterSize(roster)).toBe(2);
  });

  it('counts bound phones as kitted', () => {
    expect(sessionKitted(roster)).toBe(1);
  });

  it('counts only ready, bound players without a current good ACK as updating', () => {
    const players = [...roster, { player_id: 'c', display: 'CHARLIE', node_id: 'node-c', ready: true },
      { player_id: 'd', display: 'DELTA', node_id: 'node-d', ready: false }];
    const acks = { c: { ok: false, config_id: 'new' }, d: { ok: true, gun_echo: 'echo', config_id: 'old' } };
    expect(sessionUpdating(players, false, acks, 'new')).toBe(0);
    expect(sessionUpdating(players, true, acks, 'new')).toBe(1);
    expect(sessionUpdating(players, true, { ...acks, a: { ok: true, gun_echo: 'echo', config_id: 'old' } }, 'new')).toBe(1);
  });

  it('counts bound roster phones even when a phone has no current node view', () => {
    const players = [...roster, { player_id: 'c', display: 'CHARLIE', node_id: 'node-c', ready: true }];
    const nodes = [{ node_id: 'node-c', reach: 'backhaul' as const, stale: false, transport: 'cellular' as const },
      { node_id: 'unclaimed', reach: 'backhaul' as const, stale: false, transport: 'cellular' as const }];
    expect(sessionCoverage(players, nodes)).toEqual({ level: 'zones', bound: 2, on_backhaul: 1, on_cellular: 1 });
  });

  it('keeps the unpowered demo gun off the network', async () => {
    const backend = new MockBackend();
    try {
      const state = await backend.getState();
      const drift = state.players.find(p => p.display === 'DRIFT')!;
      expect(state.readiness.board.find(r => r.player_id === drift.player_id)).toMatchObject({
        status: 'red', present: false, node: 'none',
      });
      expect(drift.node_id).toBeNull();
      expect(state.nodes.some(n => n.player_id === drift.player_id)).toBe(false);
      expect(state.coverage?.bound).toBe(state.kit.kitted);
    } finally {
      backend.dispose();
    }
  });

  it('names off-grid players in roster order', () => {
    const players = Array.from({ length: 8 }, (_, i) =>
      ({ player_id: String(i), display: `PLAYER${i + 1}`, node_id: `node-${i}` }));
    const nodes = [{ node_id: 'node-0', reach: 'backhaul' as const, stale: false, transport: 'cellular' as const }];
    expect(sessionOffGrid(players, nodes)).toEqual(['PLAYER2', 'PLAYER3', 'PLAYER4', 'PLAYER5', 'PLAYER6', 'PLAYER7', 'PLAYER8']);
  });

  it('truncates the host notice after six off-grid names and honours full coverage', () => {
    const offGrid = ['PLAYER2', 'PLAYER3', 'PLAYER4', 'PLAYER5', 'PLAYER6', 'PLAYER7', 'PLAYER8'];
    const cfg = { mode: 'tdm', scoring: { win_by: 'kills' as const, frag_limit: 10 }, coverage: 'partial' as const };
    expect(sessionNoticesMcVerify(cfg, offGrid)).toBe(
      'WIN IS CONFIRMED AT MC, 7 PHONES OFF-GRID (PLAYER2, PLAYER3, PLAYER4, PLAYER5, PLAYER6, PLAYER7 +1 MORE): TELL PLAYERS TO RETURN AFTER THE WHISTLE');
    expect(sessionNoticesMcVerify({ ...cfg, coverage: 'full' }, offGrid)).toBeUndefined();
    expect(sessionNoticesMcVerify({ ...cfg, scoring: { ...cfg.scoring, frag_limit: null } }, offGrid)).toBeUndefined();
  });

  it('serves the teams selected in the current config', async () => {
    const backend = new MockBackend();
    try {
      const first = await backend.getState();
      expect(first.teams).toEqual(first.config.teams);
    } finally {
      backend.dispose();
    }
  });

  it('adopts an already connected demo phone on a claim', async () => {
    const backend = new MockBackend();
    try {
      const first = await backend.getState();
      expect(first.kit.kitted).toBe(first.players.length - 1);
      await expect(backend.addPlayer({ display: 'ALPHA', team_id: 'blue', gun_id: 'GUN-A' }))
        .rejects.toThrow('gun GUN-A is already assigned to REAPER');
      const reaper = first.players.find(p => p.display === 'REAPER')!;
      await backend.deletePlayer(reaper.player_id);
      expect((await backend.getState()).readiness.roster_size).toBe(first.players.length - 1);
      const replacement = await backend.addPlayer({ display: 'ALPHA', team_id: 'blue', gun_id: 'GUN-A' });
      expect(replacement.node_id).toBe('node_3D4F');
      expect((await backend.getState()).kit.kitted).toBe(first.players.length - 1);
    } finally {
      backend.dispose();
    }
  });

  it('keeps newly claimed phones and the silent demo gun pending after a push', async () => {
    const backend = new MockBackend();
    try {
      for (const display of ['REAPER', 'VIPER']) {
        const player = (await backend.getState()).players.find(p => p.display === display)!;
        await backend.deletePlayer(player.player_id);
      }
      await backend.addPlayer({ display: 'ALPHA', team_id: 'yellow', gun_id: 'GUN-A' });
      await backend.addPlayer({ display: 'BRAVO', team_id: 'blue', gun_id: 'GUN-B' });
      for (const player of (await backend.getState()).players) await backend.setReady(player.player_id, true);
      await backend.pushLobby(true);
      const state = await backend.getState();
      expect(state.lobby.updating).toBe(2);
      expect(Object.keys(state.lobby.acks)).toHaveLength(5);
    } finally {
      backend.dispose();
    }
  });

  it('serves an empty notices block and the demo tunnel provider', async () => {
    const backend = new MockBackend();
    try {
      const state = await backend.getState();
      expect(state.notices).toEqual({});
      expect(state.lan.public).toMatchObject({ status: 'off', provider: 'cloudflared', available: true });
      expect(state.lan.warning).toBeNull();
      await backend.setTunnel(true);
      expect((await backend.getState()).lan.public?.status).toBe('starting');
    } finally {
      backend.dispose();
    }
  });

  it('clears every READY intent at the whistle', async () => {
    vi.useFakeTimers();
    const backend = new MockBackend();
    try {
      await backend.pushLobby(true);
      await backend.start(10, true);
      vi.advanceTimersByTime(11_000);
      expect((await backend.getState()).lobby.ready).toBeGreaterThan(0);
      await backend.control('end');
      const state = await backend.getState();
      expect(state.phase).toBe('recap');
      expect(state.lobby.ready).toBe(0);
      expect(state.players.every(p => !p.ready)).toBe(true);
    } finally {
      backend.dispose();
      vi.useRealTimers();
    }
  });
});
