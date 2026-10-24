// F596/F597: the RECAP sync view (`mcp/brx_mcp/mc/types.py` `RecapSyncRow`/`RecapSyncView`, generated into contract.gen.ts).
// `recapSync()` is the one place that reads the field, and it tolerates an archived recap or an older MC with no `sync`.
import type { RecapSyncRow, RecapSyncView, RecapView, SyncStage } from './types';

export type { RecapSyncRow, RecapSyncView };
export type RecapSyncStage = SyncStage;

/** The recap's sync view, or undefined for an archived recap or an older MC (then RECAP has no pending state). */
export function recapSync(rc: RecapView | null | undefined): RecapSyncView | undefined {
  const s = (rc as { sync?: unknown } | null | undefined)?.sync as Partial<RecapSyncView> | undefined;
  if (!s || !Array.isArray(s.rows)) return undefined;
  return { pending: !!s.pending, finalised: !!s.finalised, result_changed: !!s.result_changed, rows: s.rows };
}
