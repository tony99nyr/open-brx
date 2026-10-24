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

  it('F595: a LAN phone on cellular counts only while the tunnel is up; Wi-Fi never does (state.py _independent_path)', () => {
    const players = [{ player_id: 'a', display: 'ALPHA', node_id: 'node-a', ready: true }];
    const cell = [{ node_id: 'node-a', reach: 'lan' as const, stale: false, transport: 'cellular' as const }];
    const wifi = [{ node_id: 'node-a', reach: 'lan' as const, stale: false, transport: 'wifi' as const }];
    expect(sessionCoverage(players, cell, true).level).toBe('full');
    expect(sessionCoverage(players, cell, false).level).toBe('zones');
    expect(sessionCoverage(players, wifi, true).level).toBe('zones');
    expect(sessionOffGrid(players, cell, true)).toEqual([]);
    expect(sessionOffGrid(players, cell, false)).toEqual(['ALPHA']);
  });

  it('shows a phoneless player as waiting, even when the demo gun is unpowered', async () => {
    const backend = new MockBackend();
    try {
      const state = await backend.getState();
      const drift = state.players.find(p => p.display === 'DRIFT')!;
      expect(state.readiness.board.find(r => r.player_id === drift.player_id)).toMatchObject({
        status: 'waiting', present: false, node: 'none',
        blockers: ['WAITING FOR THE PHONE: OPEN THE APP AND SET THE GUN'],
      });
      expect(drift.node_id).toBeNull();
      expect(state.nodes.some(n => n.player_id === drift.player_id)).toBe(false);
      expect(state.coverage?.bound).toBe(state.kit.kitted);
    } finally {
      backend.dispose();
    }
  });

  it('lets the roster pass GO when DRIFT and its unpowered gun are unrostered', async () => {
    const backend = new MockBackend();
    try {
      const before = await backend.getState();
      const drift = before.players.find(p => p.display === 'DRIFT')!;
      expect(before.readiness.go).toBe(false);
      await backend.deletePlayer(drift.player_id);
      const after = await backend.getState();
      expect(after.readiness.board.find(r => r.gun_id === 'GUN-D')?.status).toBe('red');
      expect(after.readiness.go).toBe(true);
    } finally {
      backend.dispose();
    }
  });

  it('keeps GO closed for a rostered gun outside the demo fleet', async () => {
    const backend = new MockBackend();
    try {
      const drift = (await backend.getState()).players.find(p => p.display === 'DRIFT')!;
      await backend.deletePlayer(drift.player_id);
      expect((await backend.getState()).readiness.go).toBe(true);
      await backend.addPlayer({ display: 'NEW', team_id: 'yellow', gun_id: 'GUN-X' });
      expect((await backend.getState()).readiness.go).toBe(false);
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
    expect(sessionNoticesMcVerify(cfg, offGrid, 8)).toBe(
      'WIN IS CONFIRMED AT MC, 7 PHONES WITH NO ROUTE BACK (PLAYER2, PLAYER3, PLAYER4, PLAYER5, PLAYER6, PLAYER7 +1 MORE): TELL THOSE PLAYERS TO RETURN AFTER THE WHISTLE');
    expect(sessionNoticesMcVerify(cfg, offGrid.slice(0, 1), 8)).toBe(
      'WIN IS CONFIRMED AT MC, 1 PHONE WITH NO ROUTE BACK (PLAYER2): TELL THOSE PLAYERS TO RETURN AFTER THE WHISTLE');
    expect(sessionNoticesMcVerify(cfg, offGrid, 7)).toBe(
      'WIN IS CONFIRMED AT MC: NO PHONE CAN REACH MC AWAY FROM THE WI-FI, TELL PLAYERS TO RETURN AFTER THE WHISTLE');
    expect(sessionNoticesMcVerify({ ...cfg, coverage: 'full' }, offGrid, 8)).toBeUndefined();
    expect(sessionNoticesMcVerify({ ...cfg, scoring: { ...cfg.scoring, frag_limit: null } }, offGrid, 8)).toBeUndefined();
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
      const afterRemoval = await backend.getState();
      expect(afterRemoval.readiness.roster_size).toBe(first.players.length - 1);
      expect(afterRemoval.readiness.greens).toBe(first.readiness.greens - 1);
      const replacement = await backend.addPlayer({ display: 'ALPHA', team_id: 'blue', gun_id: 'GUN-A' });
      expect(replacement.node_id).toBe('node_3D4F');
      expect((await backend.getState()).kit.kitted).toBe(first.players.length - 1);
    } finally {
      backend.dispose();
    }
  });

  it('acks a newly claimed GUN-A phone and lets the operator arm', async () => {
    const backend = new MockBackend();
    try {
      const reaper = (await backend.getState()).players.find(p => p.display === 'REAPER')!;
      await backend.deletePlayer(reaper.player_id);
      await backend.addPlayer({ display: 'ALPHA', team_id: 'blue', gun_id: 'GUN-A' });
      for (const player of (await backend.getState()).players) await backend.setReady(player.player_id, true);
      await backend.pushLobby(true);
      const state = await backend.getState();
      expect(state.lobby.updating).toBe(0);
      expect(Object.keys(state.lobby.acks)).toHaveLength(7);
      const alpha = state.players.find(p => p.display === 'ALPHA')!;
      expect(state.lobby.acks[alpha.player_id]?.ok).toBe(true);
      expect(state.readiness.board.find(r => r.player_id === alpha.player_id)?.status).not.toBe('waiting');
      await expect(backend.start(10)).resolves.toMatchObject({ seq: 1 });
    } finally {
      backend.dispose();
    }
  });

  it('finds an unpowered gun without inventing a phone connection', async () => {
    vi.useFakeTimers();
    const backend = new MockBackend();
    try {
      const scan = backend.scan();
      await vi.advanceTimersByTimeAsync(600);
      expect((await scan).some(row => row.gun_id === 'GUN-D')).toBe(true);
      const state = await backend.getState();
      const drift = state.players.find(p => p.display === 'DRIFT')!;
      expect(drift.node_id).toBeNull();
      expect(state.readiness.board.find(row => row.player_id === drift.player_id)).toMatchObject({ status: 'waiting', node: 'none' });
    } finally {
      backend.dispose();
      vi.useRealTimers();
    }
  });

  it('clears the binding, ready intent and ack when a phone is kicked', async () => {
    const backend = new MockBackend();
    try {
      await backend.pushLobby(true);
      const before = await backend.getState();
      const reaper = before.players.find(p => p.display === 'REAPER')!;
      await backend.evictNode(reaper.node_id!);
      const after = await backend.getState();
      expect(after.players.find(p => p.player_id === reaper.player_id)).toMatchObject({ node_id: null, ready: false });
      expect(after.lobby.acks[reaper.player_id]).toBeUndefined();
      expect(after.kit.kitted).toBe(before.kit.kitted - 1);
      expect(after.coverage?.bound).toBe(before.coverage!.bound - 1);
      expect(after.readiness.board.find(row => row.player_id === reaper.player_id)?.status).toBe('waiting');
    } finally {
      backend.dispose();
    }
  });

  it('serves an empty notices block and the server tunnel provider transitions', async () => {
    const backend = new MockBackend();
    try {
      const state = await backend.getState();
      expect(state.notices).toEqual({});
      expect(state.lan.public).toMatchObject({ status: 'off', provider: null, available: true });
      expect(state.lan.warning).toBeNull();
      await backend.setTunnel(true);
      expect((await backend.getState()).lan.public).toMatchObject({ status: 'starting', provider: 'cloudflared' });
      await backend.setTunnel(false);
      expect((await backend.getState()).lan.public).toMatchObject({ status: 'off', provider: null });
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
