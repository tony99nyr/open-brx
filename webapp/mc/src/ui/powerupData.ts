// A56 (S58): the non-component half of the powerup UI (a hook, types and text helpers), apart from
// `Powerups.tsx` so that file exports only components (fast refresh).
import { useEffect, useState } from 'react';
import type { PowerupsView, StationItem } from '../api/types';
import { useStore } from '../store';
import { fmtDuration } from '../tokens';

/** The one restart hint for a MC started with `--no-powerups` (F372: powerups are ON by default). start.sh
 *  passes anything after `--` to MC. */
export const POWERUPS_RESTART = './start.sh (no --no-powerups flag)';

/** What `GET /api/powerups` said. `old` = the route 404s (an MC that predates powerups); `err` = any
 *  other failure, shown where it matters, never swallowed. */
export type PowerupsState = { s: 'loading' } | { s: 'ok'; v: PowerupsView } | { s: 'old' } | { s: 'err'; msg: string };

/** Read once per connection: the flag is an MC start switch, so it changes only across an MC restart,
 *  which drops and reopens /ui-ws (`connected`). */
export function usePowerups(): PowerupsState {
  const { api, connected } = useStore();
  const [pu, setPu] = useState<PowerupsState>({ s: 'loading' });
  useEffect(() => {
    let alive = true;
    api.getPowerups().then(
      v => { if (alive) setPu({ s: 'ok', v }); },
      (e: Error & { status?: number }) => { if (alive) setPu(e?.status === 404 ? { s: 'old' } : { s: 'err', msg: e?.message ?? String(e) }); });
    return () => { alive = false; };
  }, [api, connected]);
  return pu;
}

/** "every 2:00, first at 2:00": the item's spawn schedule on the match clock. */
export const schedule = (it: StationItem) => `EVERY ${fmtDuration(it.spawn_every_s)}, FIRST AT ${fmtDuration(it.first_at_s)}`;
export const itemDetail = (it: StationItem) => it.kind === 'overshield' ? `+${it.amount ?? '?'} SHIELD` : `${it.charges ?? '?'} CHARGE${it.charges === 1 ? '' : 'S'}`;
