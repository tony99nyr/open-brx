// O7 / O8: the failures MC used to log and swallow, drawn in the shared frame so every screen shows them.
// MC owns the facts (`State.not_saving`, `.ticker_failing`, `.join_error`; state.py `snapshot()`); the
// colours come from the F221 catalogue (src/alerts/server.ts), never from here. Each line stands until
// MC's next success clears the field. Absent fields (an older MC) draw nothing. The raw Python error rides in
// the opened detail (a full disk and a locked database need the same first step: check the log).
import { useStore } from '../store';
import { fmtAge } from '../tokens';
import { FaultPill, ItemChip } from './Compact';
import { sevOf } from '../alerts';

const since = (t: number | undefined, now: number) => (t == null ? '' : ` since ${fmtAge(Math.max(0, now - t))} ago`);

export function ServerFailures() {
  const { state } = useStore();
  if (!state) return null;
  const now = state.t;
  const rows: { id: string; testid: string; short: string; why: string; fix: string }[] = [];
  const ns = state.not_saving;
  if (ns?.store) {
    rows.push({ id: 'server-not-saving-store', testid: 'not-saving-store',
      short: 'Not saving game data', why: `A result can be lost. ${ns.store.count} writes failed${since(ns.store.since, now)}: ${ns.store.error}`, fix: 'Check the disk and the MC log.' });
  }
  if (ns?.archive) {
    // the match's own start / end row: the result itself. Cleared only by a later archive write, never by a log write.
    rows.push({ id: 'server-not-saving-archive', testid: 'not-saving-archive',
      short: 'Not saving this result', why: `The result can be lost. ${ns.archive.count} writes failed${since(ns.archive.since, now)}: ${ns.archive.error}`, fix: 'Check the disk and the MC log.' });
  }
  if (ns?.snapshot) {
    // a restart resumes an ARMED or LIVE match from this file, so the same failure is RED then
    const inPlay = state.phase === 'armed' || state.phase === 'live';
    rows.push({ id: inPlay ? 'server-not-saving-snapshot-live' : 'server-not-saving-snapshot', testid: 'not-saving-snapshot',
      short: 'Not saving the session', why: `${inPlay ? 'A restart cannot resume this match.' : 'A restart loses the roster.'} ${ns.snapshot.count} writes failed${since(ns.snapshot.since, now)}: ${ns.snapshot.error}`, fix: 'Check the disk and the MC log.' });
  }
  if (state.ticker_failing) {
    const t = state.ticker_failing;
    // never advise a restart while the session file is failing: the restart would lose what is not saved
    const notSaving = !!(ns?.snapshot || ns?.store || ns?.archive);
    rows.push({ id: 'server-ticker-failing', testid: 'ticker-failing',
      short: 'Match clock failing', why: `A match will not go live or end. ${t.count} ticks failed${since(t.since, now)}: ${t.error}`, fix: notSaving ? 'Check the MC log. Do not restart while MC is not saving.' : 'Restart MC.' });
  }
  if (state.join_error) {
    const { ws_url, error } = state.join_error;
    rows.push({ id: 'server-join-info-failed', testid: 'join-info-failed',
      short: ws_url ? 'Join address out of date' : 'Join QR has no address', why: `${ws_url ? 'The QR may be out of date.' : 'The QR holds no address.'} ${error}`, fix: 'Check the laptop network, then restart MC.' });
  }
  if (!rows.length) return null;
  return (
    <div data-testid="server-failures" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8, padding: '8px 20px' }}>
      {rows.map(r => sevOf(r.id) === 'amber'
        ? <ItemChip key={r.id} id={r.id} testid={r.testid} short={r.short} detail={<>{r.why} <b>What to do:</b> {r.fix}</>} />
        : <FaultPill key={r.id} id={r.id} testid={r.testid} short={r.short} why={r.why} fix={r.fix} />)}
    </div>
  );
}
