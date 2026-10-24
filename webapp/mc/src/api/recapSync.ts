// F596/F597: the RECAP sync view, as `mcp/brx_mcp/mc/types.py` `SyncRow`/`SyncView` (the F596 ones) declare it.
// Those two names collide with the pre-arm check's `SyncRow`/`SyncView` in the same file, so the generated
// `contract.gen.ts` carries only ONE of them (the pre-arm shape) and `RecapView['sync']` is typed wrongly there.
// These local types are the F596 shapes until the server types are renamed (e.g. `RecapSyncRow`) and regenerated;
// `recapSync()` is the one place that reads the field, so the swap is one line.
import type { RecapView } from './types';

export type RecapSyncStage = 'unlinked' | 'linked' | 'sending' | 'received';
export interface RecapSyncRow {
  kind: 'phone' | 'station';
  id: string;                         // player_id for a phone, station id for a station
  name: string;
  team_id: string | null;
  stage: RecapSyncStage;
  transport: 'wifi' | 'cellular' | 'backhaul' | null;
  pending?: number;                   // present only when > 0
  lost?: number;                      // present only when > 0
  end_unconfirmed: boolean;
  idle_s: number;
  stuck: boolean;
}
export interface RecapSyncView {
  pending: boolean;
  finalised: boolean;
  result_changed: boolean;
  rows: RecapSyncRow[];
}

/** The recap's sync view, or undefined for an archived recap or an older MC (then RECAP has no pending state). */
export function recapSync(rc: RecapView | null | undefined): RecapSyncView | undefined {
  const s = (rc as { sync?: unknown } | null | undefined)?.sync as Partial<RecapSyncView> | undefined;
  if (!s || !Array.isArray(s.rows)) return undefined;
  return { pending: !!s.pending, finalised: !!s.finalised, result_changed: !!s.result_changed, rows: s.rows };
}
