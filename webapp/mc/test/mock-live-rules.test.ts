import { describe, expect, it } from 'vitest';
import type { LiveRow } from '../src/api/types';
import { NEVER_SEEN_MS, STALE_AFTER_MS } from '../src/api/types';
import { scorerLiveRow, sessionLiveView, sessionWithPoolStale } from '../src/rules/live';
import { sessionStartView } from '../src/rules/start';

const row = (status: LiveRow['status']): LiveRow => ({
  player_id: 'p1', display: 'ALPHA', team_id: 'blue', kills: 0, deaths: 0, assists: 0,
  shots: 0, hits: 0, accuracy: null, kd: 0, streak: 0, medals: [], status,
  sync_age_ms: 0, respawn_in_s: null,
});

describe('server live rules in the mock', () => {
  it('uses the server stale boundary and never-seen age', () => {
    expect(scorerLiveRow(20_000, 20_000 - STALE_AFTER_MS, true)).toEqual({
      sync_age_ms: STALE_AFTER_MS, status: 'alive',
    });
    expect(scorerLiveRow(20_000, 20_000 - STALE_AFTER_MS - 1, true).status).toBe('stale');
    expect(scorerLiveRow(20_000, 19_000, false).status).toBe('down');
    expect(scorerLiveRow(20_000, undefined, true).sync_age_ms).toBe(NEVER_SEEN_MS);
  });

  it('copies only reported pool claims and flags protection only on a stale row', () => {
    expect(sessionWithPoolStale([row('alive')], { p1: { pool_stale: 'silent', pool_stale_ms: 190_000,
      protect_owed: true } })[0]).toMatchObject({ pool_stale: 'silent', pool_stale_ms: 190_000 });
    expect(sessionWithPoolStale([row('alive')], { p1: { protect_owed: true } })[0].possibly_protected).toBeUndefined();
    expect(sessionWithPoolStale([row('stale')], { p1: { protect_owed: true } })[0].possibly_protected).toBe(true);
    expect(sessionWithPoolStale([row('stale')], {})[0].pool_stale).toBeUndefined();
  });

  it('uses null for absent server blocks', () => {
    expect(sessionLiveView()).toBeNull();
    expect(sessionStartView()).toBeNull();
  });
});
