import { describe, expect, it, vi } from 'vitest';
import type { LiveRow } from '../src/api/types';
import { NEVER_SEEN_MS, STALE_AFTER_MS } from '../src/api/types';
import { scorerLiveRow, sessionLiveView, sessionWithPoolStale } from '../src/rules/live';
import { sessionStartView } from '../src/rules/start';
import { MockBackend } from '../src/mock/backend';

const row = (status: LiveRow['status']): LiveRow => ({
  player_id: 'p1', display: 'ALPHA', team_id: 'blue', kills: 0, deaths: 0, assists: 0,
  shots: 0, hits: 0, accuracy: null, kd: 0, streak: 0, medals: [], status,
  sync_age_ms: 0, respawn_in_s: null,
});

describe('server live rules in the mock', () => {
  it('uses the server stale boundary and never-seen age', () => {
    expect(scorerLiveRow(20_000, 20_000 - STALE_AFTER_MS, true)).toEqual({
      sync_age_ms: STALE_AFTER_MS, status: 'alive', respawn_in_s: null,
    });
    expect(scorerLiveRow(20_000, 20_000 - STALE_AFTER_MS - 1, true).status).toBe('stale');
    expect(scorerLiveRow(20_000, 19_000, false).status).toBe('down');
    expect(scorerLiveRow(20_000, 19_000, false, 7).respawn_in_s).toBe(7);
    expect(scorerLiveRow(20_000, 1_000, false, 7).respawn_in_s).toBeNull();
    expect(scorerLiveRow(20_000, undefined, true).sync_age_ms).toBe(NEVER_SEEN_MS);
  });

  it('copies only reported pool claims and flags protection only on a stale row', () => {
    expect(sessionWithPoolStale([row('alive')], { p1: { pool_stale: 'silent', pool_stale_ms: 190_000,
      protect_owed: true } })[0]).toMatchObject({ pool_stale: 'silent', pool_stale_ms: 190_000 });
    expect(sessionWithPoolStale([row('alive')], { p1: { protect_owed: true } })[0].possibly_protected).toBeUndefined();
    expect(sessionWithPoolStale([row('stale')], { p1: { protect_owed: true } })[0].possibly_protected).toBe(true);
    expect(sessionWithPoolStale([row('stale')], {})[0].pool_stale).toBeUndefined();
    expect(sessionWithPoolStale([row('alive')], { p1: { pool_stale_ms: 4_000 } })[0].pool_stale_ms).toBeUndefined();
    expect(sessionWithPoolStale([row('alive')], { p1: { cure: 'alive', gun_locked: true } })[0])
      .toMatchObject({ cure: 'alive', gun_locked: true });
    expect(sessionWithPoolStale([row('alive')], { p1: { gun_locked: false } })[0].gun_locked).toBeUndefined();
  });

  it('keeps the opening board ages and gives protection to the stale phone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000_000);
    const backend = new MockBackend();
    try {
      const opening = await backend.getState();
      const player = opening.players.find(p => p.display === 'DRIFT');
      expect(player?.node_id).toBeNull();
      const openingRow = (name: string) => opening.readiness.board.find(r =>
        r.player_id === opening.players.find(p => p.display === name)?.player_id);
      expect(openingRow('GHOST')?.last_seen_age_ms).toBe(2_000);
      expect(openingRow('GHOST')?.status).toBe('green');
      expect(opening.readiness.board.filter(r => r.status === 'green')).toHaveLength(4);
      expect(opening.readiness.board.filter(r => r.status === 'amber')).toHaveLength(3);
      expect(openingRow('SABLE')?.last_seen_age_ms).toBe(STALE_AFTER_MS);
      expect(openingRow('SABLE')?.ambers).not.toContain('STALE LINK (8S)');
      vi.advanceTimersByTime(1);
      expect((await backend.getState()).readiness.board.find(r => r.player_id ===
        opening.players.find(p => p.display === 'SABLE')?.player_id)?.ambers).toContain('STALE LINK (8S)');
      await backend.pushLobby(true);
      await backend.start(0, true);
      const armed = await backend.getState();
      const armedOnyx = armed.players.find(p => p.display === 'ONYX')!;
      expect(armed.start?.per_node[armedOnyx.player_id]?.last_seen_ms).toBe(
        armed.readiness.board.find(r => r.player_id === armedOnyx.player_id)?.last_seen_age_ms);
      expect(armed.live?.rows.find(r => r.player_id === armedOnyx.player_id)?.possibly_protected).toBe(true);
      vi.advanceTimersByTime(1_000);
      const state = await backend.getState();
      const live = state.live;
      expect(live?.rows.find(r => r.display === 'ONYX')?.possibly_protected).toBe(true);
      const firstStaleWithPhone = live?.rows.find(r => r.status === 'stale' &&
        state.players.some(p => p.player_id === r.player_id && p.node_id));
      expect(live?.rows.find(r => r.possibly_protected)?.player_id).toBe(firstStaleWithPhone?.player_id);
      expect(live?.rows.find(r => r.display === 'GHOST')?.status).toBe('alive');
      expect(live?.rows.find(r => r.display === 'DRIFT')?.possibly_protected).toBeUndefined();
      const onyx = state.players.find(p => p.display === 'ONYX')!;
      const age = state.readiness.board.find(r => r.player_id === onyx.player_id)?.last_seen_age_ms;
      expect(state.nodes.find(n => n.player_id === onyx.player_id)?.last_seen_ms).toBe(age);
      expect(live?.rows.find(r => r.player_id === onyx.player_id)?.sync_age_ms).toBe(age);
      expect(state.mc_confidence.stale).toContain(onyx.player_id);
      expect((await backend.getPresentation()).mc_confidence).toEqual(state.mc_confidence);
      const nomad = state.players.find(p => p.display === 'NOMAD')!;
      expect(state.readiness.board.find(r => r.player_id === nomad.player_id)?.pool_stale).toBe('silent');
      expect(live?.rows.find(r => r.player_id === nomad.player_id)?.pool_stale).toBe('silent');
      backend.setNodeStale('7A10', false);
      const after = await backend.getState();
      expect(after.readiness.board.find(r => r.player_id === nomad.player_id)?.pool_stale).toBeNull();
      expect(after.live?.rows.find(r => r.player_id === nomad.player_id)?.pool_stale).toBeUndefined();
    } finally {
      backend.dispose();
      vi.useRealTimers();
    }
  });

  it('uses null for absent server blocks', () => {
    expect(sessionLiveView()).toBeNull();
    expect(sessionStartView()).toBeNull();
  });
});
