// O7 / O8: the failures MC used to log and swallow, drawn in the shared frame so every screen shows them.
// MC owns the facts (`State.not_saving`, `.ticker_failing`, `.join_error`; state.py `snapshot()`); the
// colours come from the F221 catalogue (src/alerts/server.ts), never from here. Each line stands until
// MC's next success clears the field. Absent fields (an older MC) draw nothing.
import { useStore } from '../store';
import { Alert } from './Alert';
import { fmtAge } from '../tokens';

const since = (t: number | undefined, now: number) => (t == null ? '' : ` SINCE ${fmtAge(Math.max(0, now - t))} AGO`);

export function ServerFailures() {
  const { state } = useStore();
  if (!state) return null;
  const now = state.t;
  const rows: { id: string; what: string; act: string; testid: string; title: string }[] = [];
  const ns = state.not_saving;
  if (ns?.store) {
    rows.push({ id: 'server-not-saving-store', testid: 'not-saving-store', title: `${ns.store.count} writes failed${since(ns.store.since, now).toLowerCase()}`,
      what: `NOT SAVING GAME DATA (${ns.store.error}), A RESULT CAN BE LOST`, act: 'FREE DISK SPACE ON THE MC LAPTOP' });
  }
  if (ns?.snapshot) {
    rows.push({ id: 'server-not-saving-snapshot', testid: 'not-saving-snapshot', title: `${ns.snapshot.count} writes failed${since(ns.snapshot.since, now).toLowerCase()}`,
      what: `NOT SAVING THE SESSION (${ns.snapshot.error}), A RESTART LOSES THE ROSTER`, act: 'FREE DISK SPACE ON THE MC LAPTOP' });
  }
  if (state.ticker_failing) {
    const t = state.ticker_failing;
    rows.push({ id: 'server-ticker-failing', testid: 'ticker-failing', title: `${t.count} ticks failed${since(t.since, now).toLowerCase()}`,
      what: `MATCH CLOCK FAILING (${t.error}), A MATCH WILL NOT GO LIVE OR END`, act: 'RESTART MC' });
  }
  if (state.join_error) {
    rows.push({ id: 'server-join-info-failed', testid: 'join-info-failed', title: `the QR holds ${state.join_error.ws_url || 'no address'}`,
      what: `JOIN QR HAS NO ADDRESS (${state.join_error.error})`, act: 'CHECK THE LAPTOP NETWORK, THEN RESTART MC' });
  }
  if (!rows.length) return null;
  return (
    <div data-testid="server-failures" style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map(r => <Alert key={r.id} id={r.id} what={r.what} act={r.act} testid={r.testid} title={r.title} size={12} style={{ padding: '8px 20px' }} />)}
    </div>
  );
}
