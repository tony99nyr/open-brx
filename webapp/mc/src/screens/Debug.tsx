import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { F, T, fmtAge } from '../tokens';
import { GhostButton, ScreenHeader, SectionRule } from '../ui';

// Everything the header used to shout at you, plus what was never shown at all.
// Tony, 2026-09-02: "the header should be cleaner and simpler. less intimidating and less confusing.
// lets pull debug stuff out into the new page." The telemetry strip lived across the top of every
// screen in 11px uppercase mono — permanent noise for information you want perhaps twice a session.

// One key column width for the WHOLE page. Each section used its own `auto` column, so SESSION's
// short keys and GAME CONFIG's long ones sized differently and the values stepped in and out down the
// page (Tony, 2026-09-02: "bit of an alignment issue on debug for keys and values").
const KEY_COL = 172;

function Row({ k, v, color }: { k: string; v: React.ReactNode; color?: string }) {
  return (
    <>
      <span style={{ font: F.mono(500, 10), letterSpacing: '.14em', color: T.micro, paddingTop: 2 }}>{k}</span>
      <span style={{ font: F.chk(600, 13), color: color ?? T.ink, wordBreak: 'break-word', minWidth: 0 }}>{v}</span>
    </>
  );
}
const Grid = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'grid', gridTemplateColumns: `${KEY_COL}px minmax(0,1fr)`, gap: '9px 16px', alignItems: 'baseline', padding: '12px 2px 20px' }}>{children}</div>
);

export function Debug() {
  const { state, connected, mock, api, error, hasToken, authRequired, setToken } = useStore();
  const [tok, setTok] = useState('');
  const [voices, setVoices] = useState<{ n: number; verified: number } | null>(null);
  useEffect(() => { api.getVoices()
    .then(v => setVoices({ n: v.voices.length, verified: v.voices.filter(x => x.verified).length }))
    .catch(() => setVoices(null)); }, [api]);

  const linked = state?.nodes.filter(n => (n.last_seen_ms ?? 1e9) < 8000).length ?? 0;
  const synced = state?.nodes.filter(n => n.synced).length ?? 0;

  return (
    <div className="screen">
      <ScreenHeader kicker="[ REF // DIAGNOSTICS ]" title="Debug" right={
        <GhostButton onClick={() => { navigator.clipboard?.writeText(JSON.stringify(state, null, 2)).catch(() => {}); }}
          title="Copy the whole server state as JSON">COPY STATE JSON</GhostButton>} />

      {(authRequired || (!mock && state?.lan.auth_required !== false && !hasToken)) && (
        <form onSubmit={e => { e.preventDefault(); if (tok.trim()) { setToken(tok); setTok(''); } }}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 14, border: `1px solid ${T.warn}`, background: 'rgba(255,176,32,.06)' }}>
          <label htmlFor="dbg-tok" style={{ font: F.chk(700, 13), color: T.warn }}>Operator token required</label>
          <input id="dbg-tok" className="textbox" value={tok} onChange={e => setTok(e.target.value)} placeholder="paste from the MC console"
            autoComplete="off" spellCheck={false} style={{ flex: '0 1 24ch', borderBottom: `1px solid ${T.warn}`, color: T.ink, minHeight: 36 }} />
          <button type="submit" style={{ background: T.warn, color: T.accInk, border: 'none', font: F.chk(700, 12), letterSpacing: '.12em', padding: '8px 14px', cursor: 'pointer', minHeight: 36 }}>APPLY</button>
        </form>
      )}

      <SectionRule label="SESSION" />
      <Grid>
        <Row k="SESSION" v={state?.session_id ?? '—'} />
        <Row k="SERVER CLOCK" v={state ? new Date(state.t).toLocaleTimeString([], { hour12: false }) : '—'} />
        <Row k="PHASE" v={(state?.phase ?? '—').toUpperCase()} />
        <Row k="UPLINK" v={connected ? 'CONNECTED' : 'DOWN'} color={connected ? T.ok : T.bad} />
        {mock && <Row k="MODE" v="MOCK — no real server" color={T.warn} />}
        {error && <Row k="LAST ERROR" v={error} color={T.bad} />}
      </Grid>

      <SectionRule label="NETWORK" hint="PHONES JOIN ON THIS URL" />
      <Grid>
        <Row k="SSID" v={state?.lan.ssid ?? state?.lan.mode?.toUpperCase() ?? '—'} />
        <Row k="MC ADDRESS" v={state?.lan.ip ? `${state.lan.ip}:${state.lan.port}` : '—'} />
        <Row k="NODE SOCKET" v={state?.lan.ws_url ?? '—'} />
        {/* A28.1: absent entirely on a server that predates backhaul — say so rather than a blank row */}
        <Row k="PUBLIC SOCKET"
          v={!state?.lan.public ? 'not supported by this server' : state.lan.public.status === 'up' ? (state.lan.public.ws_url ?? '—') : state.lan.public.status.toUpperCase()}
          color={state?.lan.public?.status === 'up' ? T.ok : state?.lan.public?.status === 'error' ? T.bad : undefined} />
        <Row k="JOIN SECRET" v={state?.lan.join_secret ?? '—'} />
        <Row k="NODES" v={`${state?.nodes.length ?? 0} known · ${linked} linked · ${synced} clock-synced`} />
      </Grid>

      <SectionRule label="NODES" />
      {(state?.nodes.length ?? 0) === 0
        ? <div style={{ font: F.chk(500, 13), color: T.micro, padding: '12px 2px 20px' }}>No phones have connected to this session.</div>
        : (
          <div style={{ overflowX: 'auto', paddingBottom: 20 }}>
            <table style={{ borderCollapse: 'collapse', minWidth: 720 }}>
              <thead><tr>{['NODE', 'PLAYER', 'GUN', 'ARM', 'SEEN', 'SYNCED', 'GUN LINK', 'HEADSET', 'PENDING'].map(h =>
                <th key={h} style={{ font: F.mono(600, 9.5), letterSpacing: '.16em', color: T.micro, textAlign: 'left', padding: '6px 12px 6px 0', borderBottom: `1px solid ${T.line2}` }}>{h}</th>)}</tr></thead>
              <tbody>
                {state!.nodes.map(n => {
                  const pf = (n.preflight ?? {}) as Record<string, unknown>;
                  const pl = state!.players.find(p => p.player_id === n.player_id);
                  const cell = (v: React.ReactNode, c?: string) => <td style={{ font: F.chk(600, 12), color: c ?? T.dim, padding: '7px 12px 7px 0', whiteSpace: 'nowrap' }}>{v}</td>;
                  return (
                    <tr key={n.node_id}>
                      {cell(n.node_id.slice(-6), T.ink)}
                      {cell(pl?.display ?? '—')}
                      {cell(n.gun_name ?? n.gun_tail ?? '—')}
                      {cell(n.arm_state)}
                      {cell(n.last_seen_ms == null ? '—' : `${fmtAge(n.last_seen_ms)} ago`)}
                      {cell(n.synced ? 'yes' : 'no', n.synced ? T.ok : T.warn)}
                      {cell(pf.gun_linked === true ? 'linked' : pf.gun_linked === false ? 'lost' : '—', pf.gun_linked === false ? T.bad : undefined)}
                      {cell(pf.headset_ok === true ? 'ok' : pf.headset_ok === false ? 'no' : '—')}
                      {cell(String(n.pending ?? 0), (n.pending ?? 0) > 0 ? T.warn : undefined)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      <SectionRule label="GAME CONFIG IN EFFECT" hint="WHAT THE NEXT PUSH WILL COMPILE FROM" />
      <Grid>
        {Object.entries(state?.config ?? {}).filter(([k]) => k !== 'teams').map(([k, v]) =>
          <Row key={k} k={k.replace(/_/g, ' ').toUpperCase()} v={readable(v)} />)}
        <Row k="VOICE PACKS" v={voices == null ? '—'
          : `${voices.n} personas · ${voices.verified} confirmed by ear, the rest inferred from the pack layout`} />
      </Grid>
    </div>
  );
}


/** `{"type":"auto","delay_s":15}` is not something you read at a glance. Flatten one level into
 *  `type auto · delay_s 15`, and give a nested object its own indented lines rather than a JSON blob. */
function readable(v: unknown): React.ReactNode {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.length ? v.map(String).join(', ') : 'none';
  if (typeof v !== 'object') return String(v);
  const rows = Object.entries(v as Record<string, unknown>);
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {rows.map(([k, val]) => (
        <span key={k} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ font: F.mono(500, 10), letterSpacing: '.1em', color: T.micro, minWidth: 128 }}>{k.replace(/_/g, ' ')}</span>
          <span>{typeof val === 'object' && val !== null ? readable(val) : String(val)}</span>
        </span>
      ))}
    </span>
  );
}
