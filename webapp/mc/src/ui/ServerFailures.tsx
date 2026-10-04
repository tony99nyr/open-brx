// O7 / O8: the failures MC used to log and swallow, drawn in the shared frame so every screen shows them.
// MC owns the facts (`State.not_saving`, `.ticker_failing`, `.join_error`; state.py `snapshot()`); the
// colours come from the F221 catalogue (src/alerts/server.ts), never from here. Each line stands until
// MC's next success clears the field. Absent fields (an older MC) draw nothing. The raw Python error rides in
// `title` (the words say what to do, and a disk-full and a locked database need the same first step: the log).
import { useStore } from '../store';
import { Alert } from './Alert';
import { fmtAge } from '../tokens';

const since = (t: number | undefined, now: number) => (t == null ? '' : ` since ${fmtAge(Math.max(0, now - t))} ago`);

export function ServerFailures() {
  const { state } = useStore();
  if (!state) return null;
  const now = state.t;
  const rows: { id: string; what: string; act: string; testid: string; title: string }[] = [];
  const ns = state.not_saving;
  if (ns?.store) {
    rows.push({ id: 'server-not-saving-store', testid: 'not-saving-store', title: `${ns.store.count} writes failed${since(ns.store.since, now)}: ${ns.store.error}`,
      what: 'NOT SAVING GAME DATA, A RESULT CAN BE LOST', act: 'CHECK THE DISK AND THE MC LOG' });
  }
  if (ns?.archive) {
    // the match's own start / end row: the result itself. Cleared only by a later archive write, never by a log write.
    rows.push({ id: 'server-not-saving-archive', testid: 'not-saving-archive', title: `${ns.archive.count} writes failed${since(ns.archive.since, now)}: ${ns.archive.error}`,
      what: "NOT SAVING THIS MATCH'S RESULT, IT CAN BE LOST", act: 'CHECK THE DISK AND THE MC LOG' });
  }
  if (ns?.snapshot) {
    // a restart resumes an ARMED or LIVE match from this file, so the same failure is RED then
    const inPlay = state.phase === 'armed' || state.phase === 'live';
    rows.push({ id: inPlay ? 'server-not-saving-snapshot-live' : 'server-not-saving-snapshot', testid: 'not-saving-snapshot',
      title: `${ns.snapshot.count} writes failed${since(ns.snapshot.since, now)}: ${ns.snapshot.error}`,
      what: inPlay ? 'NOT SAVING THE SESSION, A RESTART CANNOT RESUME THIS MATCH' : 'NOT SAVING THE SESSION, A RESTART LOSES THE ROSTER', act: 'CHECK THE DISK AND THE MC LOG' });
  }
  if (state.ticker_failing) {
    const t = state.ticker_failing;
    // never advise a restart while the session file is failing: the restart would lose what is not saved
    const notSaving = !!(ns?.snapshot || ns?.store || ns?.archive);
    rows.push({ id: 'server-ticker-failing', testid: 'ticker-failing', title: `${t.count} ticks failed${since(t.since, now)}: ${t.error}`,
      what: 'MATCH CLOCK FAILING, A MATCH WILL NOT GO LIVE OR END', act: notSaving ? 'CHECK THE MC LOG (DO NOT RESTART WHILE IT IS NOT SAVING)' : 'RESTART MC' });
  }
  if (state.join_error) {
    const { ws_url, error } = state.join_error;
    rows.push({ id: 'server-join-info-failed', testid: 'join-info-failed', title: `${error}; the QR holds ${ws_url || 'no address'}`,
      what: ws_url ? 'JOIN ADDRESS NOT REFRESHED, THE QR MAY BE OUT OF DATE' : 'JOIN QR HAS NO ADDRESS', act: 'CHECK THE LAPTOP NETWORK, THEN RESTART MC' });
  }
  if (!rows.length) return null;
  return (
    <div data-testid="server-failures" style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map(r => <Alert key={r.id} id={r.id} what={r.what} act={r.act} testid={r.testid} title={r.title} size={12} style={{ padding: '8px 20px' }} />)}
    </div>
  );
}
