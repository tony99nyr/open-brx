import type { Player, RecapView } from '../api/types';

type NodeReport = { lastSeen: number; pending?: number };

// Server: state.py Session._mark_flushed_live(). The scorer owns this sticky fact.
export function sessionMarkFlushedLive(matchPlayerIds: readonly string[], players: readonly Player[],
    reports: Readonly<Record<string, NodeReport>>, now: number, flushed: Set<string>): void {
  for (const id of matchPlayerIds) {
    if (flushed.has(id)) continue;
    const p = players.find(player => player.player_id === id);
    const report = p?.node_id ? reports[p.node_id] : undefined;
    if (report && now - report.lastSeen < 30_000 && report.pending === 0) flushed.add(id);
  }
}

// Server: scoring.py Scorer.missing().
export function scorerMissing(matchPlayerIds: readonly string[], flushed: ReadonlySet<string>): string[] {
  return matchPlayerIds.filter(id => !flushed.has(id));
}

// Server: state.py Session.settling().
export function sessionSettling(players: readonly Player[], reports: Readonly<Record<string, NodeReport>>,
    end_t: number | undefined, now: number): Pick<RecapView, 'settling' | 'awaiting' | 'since_end_ms'> {
  if (end_t === undefined || now < end_t) return { settling: false, awaiting: [], since_end_ms: null };
  const awaiting = players.filter(p => p.node_id && (reports[p.node_id]?.lastSeen ?? 0) < end_t)
    .map(p => p.player_id);
  return { settling: awaiting.length > 0, awaiting, since_end_ms: now - end_t };
}

// Server: state.py Session._scorer_recap(), including its live station sync check.
export function sessionScorerRecap(recap: RecapView, stations: RecapView['stations'],
    stationSeen?: Readonly<Record<string, number>>, end_t?: number): RecapView {
  const next = { ...recap };
  if (stations?.length) next.stations = stations.map(row => stationSeen && end_t !== undefined
    ? { ...row, synced: (stationSeen[row.node_id] ?? 0) >= end_t } : row);
  else delete next.stations;
  return next;
}
