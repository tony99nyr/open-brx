// F596/F597: the RECAP sync view (`mcp/brx_mcp/mc/types.py` `RecapSyncRow`/`RecapSyncView`, generated into contract.gen.ts).
// `recapSync()` is the one place that reads the field. It tolerates an archived recap or an older MC with no `sync`,
// and it never trusts a row: a pending view must never be read as "nothing to wait for" because a row was malformed.
import type { RecapSyncRow, RecapSyncView, RecapView, SyncStage } from './types';

export type { RecapSyncRow, RecapSyncView };
export type RecapSyncStage = SyncStage;

const STAGES: readonly string[] = ['unlinked', 'linked', 'sending', 'received'];
const TRANSPORTS: readonly string[] = ['wifi', 'cellular', 'backhaul'];
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/** One row as the console may draw it, or null when it is not a row at all (no object, no id, no stage). */
function cleanRow(raw: unknown): RecapSyncRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || typeof r.stage !== 'string') return null;
  const pending = num(r.pending), lost = num(r.lost);
  return {
    kind: r.kind === 'station' ? 'station' : 'phone', id: r.id, name: typeof r.name === 'string' && r.name ? r.name : r.id,
    team_id: typeof r.team_id === 'string' ? r.team_id : null,
    stage: (STAGES.includes(r.stage) ? r.stage : 'unlinked') as RecapSyncRow['stage'],
    transport: (typeof r.transport === 'string' && TRANSPORTS.includes(r.transport) ? r.transport : null) as RecapSyncRow['transport'],
    ...(pending ? { pending } : {}), ...(lost ? { lost } : {}),
    end_unconfirmed: r.end_unconfirmed === true, idle_s: num(r.idle_s) ?? 0, stuck: r.stuck === true,
  };
}

/** The recap's sync view, or undefined for an archived recap or an older MC (then RECAP has no pending state).
 *  A view that says `pending` keeps saying it even when its rows are missing or unusable: the result stays hidden. */
export function recapSync(rc: RecapView | null | undefined): RecapSyncView | undefined {
  const s = (rc as { sync?: unknown } | null | undefined)?.sync;
  if (!s || typeof s !== 'object') return undefined;
  const v = s as Record<string, unknown>;
  const pending = v.pending === true;
  if (!Array.isArray(v.rows) && !pending) return undefined;
  const rows = (Array.isArray(v.rows) ? v.rows : []).map(cleanRow).filter((r): r is RecapSyncRow => r !== null);
  return { pending, finalised: v.finalised === true, result_changed: v.result_changed === true, rows };
}
