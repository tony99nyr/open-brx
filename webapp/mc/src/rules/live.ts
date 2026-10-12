import type { LiveRow, LiveView } from '../api/types';
import { NEVER_SEEN_MS, STALE_AFTER_MS } from '../api/types';

type Claim = Pick<LiveRow, 'pool_stale' | 'pool_stale_ms' | 'cure' | 'gun_locked'> &
  { protect_owed?: boolean };

// Server: scoring.py Scorer.live_rows().
export function scorerLiveRow(now: number, lastSeen: number | undefined, alive: boolean) {
  const sync_age_ms = lastSeen ? now - lastSeen : NEVER_SEEN_MS;
  const status = sync_age_ms > STALE_AFTER_MS ? 'stale' : alive ? 'alive' : 'down';
  return { sync_age_ms, status } as const;
}

// Server: state.py Session._with_pool_stale().
export function sessionWithPoolStale(rows: readonly LiveRow[], claims: Readonly<Record<string, Claim>>): LiveRow[] {
  return rows.map(row => {
    const claim = claims[row.player_id];
    const next = { ...row };
    if (claim?.pool_stale) {
      next.pool_stale = claim.pool_stale;
      if (claim.pool_stale_ms !== undefined) next.pool_stale_ms = claim.pool_stale_ms;
    }
    if (claim?.cure) next.cure = claim.cure;
    if (claim?.gun_locked === true) next.gun_locked = true;
    if (row.status === 'stale' && claim?.protect_owed === true) next.possibly_protected = true;
    return next;
  });
}

// Server: state.py Session._live_view() returns null without an active scorer.
export const sessionLiveView = (view?: LiveView): LiveView | null => view ?? null;
