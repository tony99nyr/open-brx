import { useEffect, useState } from 'react';
import type { ReadinessRow } from '../api/types';
import { useStore } from '../store';
import { CHAMFER, F, T, TAB, fmtAge } from '../tokens';
import { CountBlock, GhostButton, Micro, ScreenHeader, SectionRule, SegBar, Tag } from '../ui';

const statusColor = (s: ReadinessRow['status']) => (s === 'red' ? T.bad : s === 'amber' ? T.warn : T.ok);

export function Armory() {
  const { state, run, api } = useStore();
  const [scanning, setScanning] = useState(false);
  const [registry, setRegistry] = useState<{ gun_id: string; sticker: string; ble: { tail?: string } }[]>([]);
  useEffect(() => { api.armory().then(setRegistry).catch(() => {}); }, [state?.readiness?.t]);
  if (!state) return null;
  const { readiness } = state;
  const board = readiness.board;
  const nGreen = board.filter(g => g.status === 'green').length;
  const nAmber = board.filter(g => g.status === 'amber').length;
  const nRed = board.filter(g => g.status === 'red').length;
  const firstRed = board.find(g => g.status === 'red');
  const gateNote = nRed
    ? `${firstRed?.sticker} BLOCKS START — ${firstRed?.blockers[0]?.split(' — ')[0] ?? 'CHECK IT'}`
    : nGreen ? 'NO REDS — START WHEN READY' : 'NOTHING READY YET — POWER GUNS, OPEN THE APP ON EACH PHONE';

  return (
    <div className="screen" style={{ maxWidth: 1380, margin: '0 auto' }}>
      <ScreenHeader kicker="[ A1 // GEAR CHECK ]" title="Readiness Board" right={
        <>
          <GhostButton onClick={async () => { setScanning(true); await run(() => api.scan(6)); setScanning(false); }}>{scanning ? 'SCANNING…' : '⟳ SCAN ARMORY'}</GhostButton>
          <div style={{ display: 'flex', gap: 2 }}>
            <CountBlock value={nGreen} label="GREEN" color={T.ok} />
            <CountBlock value={nAmber} label="AMBER" color={T.warn} />
            <CountBlock value={nRed} label="RED" color={nRed ? T.bad : T.micro} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
            <div style={{ font: F.osw(700, 22), letterSpacing: '.3em', padding: '8px 26px 8px 32px', background: nRed ? T.bad : nGreen ? T.ok : T.panelAlt, color: nRed || nGreen ? T.accInk : T.dim, border: nRed || nGreen ? 'none' : `1px solid ${T.line2}`, clipPath: CHAMFER.tl14 }}>{nRed ? 'HOLD' : nGreen ? 'GO' : 'STANDBY'}</div>
            <div role="status" aria-live="polite" style={{ font: F.mono(500, 10), letterSpacing: '.14em', color: T.dim }}>{gateNote}</div>
          </div>
        </>
      } />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(248px,1fr))', gap: 12 }}>
        {board.map(g => <GunCard key={g.sticker} g={g} />)}
      </div>
      {(state?.nodes?.length ?? 0) > 0 && (
        <div style={{ marginTop: 20 }}>
          <SectionRule label={`PHONES ON THE NET // ${state!.nodes.length}`} hint="WITH OR WITHOUT A GUN" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(248px,1fr))', gap: 12 }}>
            {(state?.nodes ?? []).map(n => <NodeCard key={n.node_id} n={n} />)}
          </div>
        </div>
      )}
      {registry.filter(r => !readiness.unclaimed.some(u => u.gun_id === r.gun_id) && !readiness.board.some(b => b.gun_id === r.gun_id)).length > 0 && (
        <div style={{ marginTop: 20 }}>
          <SectionRule label="KNOWN GUNS — NOT SEEN" hint="POWERED OFF OR OUT OF RANGE" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(248px,1fr))', gap: 12 }}>
            {registry.filter(r => !readiness.unclaimed.some(u => u.gun_id === r.gun_id) && !readiness.board.some(b => b.gun_id === r.gun_id)).map(r => <GhostCard key={r.gun_id} r={r} />)}
          </div>
        </div>
      )}
      {readiness.unclaimed.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <SectionRule label={`UNCLAIMED // ${readiness.unclaimed.length} GUNS ADVERTISING, NO NODE`} hint="HAND THEM OUT — A PHONE MUST CLAIM EACH GUN" />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {readiness.unclaimed.map(u => (
              <span key={u.tail} style={{ background: T.panel, border: `1px solid ${T.line}`, padding: '8px 14px', display: 'inline-flex', gap: 10, alignItems: 'baseline' }}>
                <span style={{ font: F.osw(700, 16), letterSpacing: '.08em' }}>{u.basename}</span>
                <Micro>-{u.tail}</Micro>
                <Micro color={T.dim}>{u.rssi} dBm</Micro>
                {u.identity !== 'ok' && <Tag color={u.identity === 'reverted' ? T.bad : T.warn} size={9}>{u.identity.toUpperCase()}</Tag>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GunCard({ g }: { g: ReadinessRow }) {
  const color = statusColor(g.status);
  const red = g.status === 'red';
  const batt = g.battery_pct;
  const battColor = batt == null ? T.micro : batt < 30 ? T.bad : batt < 60 ? T.warn : T.ok;
  const age = g.last_seen_age_ms ?? g.battery_age_ms ?? null;                 // real link age from the server
  const stale = age != null && age > 60_000;                                   // >1 min old = show nothing as live truth
  const linkText = g.node === 'none' ? 'NO PHONE' : age == null ? '—' : `${fmtAge(age)} AGO`;
  const hs = stale ? 'UNKNOWN' : g.headset === 'proven' ? 'CONNECTED' : g.headset === 'absent' ? '—' : 'UNKNOWN';
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderLeft: `3px solid ${color}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 11, clipPath: CHAMFER.tr12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ font: F.osw(700, 20), letterSpacing: '.1em' }}>{g.sticker}</span>
          <span style={{ font: F.mono(500, 11), color: T.micro }}>-{g.tail}</span>
          {g.player_num != null && <span style={{ font: F.mono(500, 10), color: T.acc }}>#{g.player_num}</span>}
        </div>
        <Tag color={color}>{red ? 'BLOCKED' : g.status === 'amber' ? 'CHECK' : 'READY'}</Tag>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '82px 1fr', gap: '6px 10px', alignItems: 'center' }}>
        <Micro>GUN</Micro><Val color={stale ? T.warn : g.gun_linked ? T.ink : g.gun_linked === false ? T.bad : T.micro}>{stale ? `UNKNOWN — LAST DATA ${fmtAge(age ?? 0)} AGO` : g.gun_linked ? 'LINKED' : g.gun_linked === false ? 'LINK LOST' : '—'}</Val>
        <Micro>HEADSET</Micro><Val color={stale ? T.micro : g.headset === 'proven' ? T.ink : g.headset === 'absent' ? T.micro : T.warn}>{hs}</Val>
        <Micro>BATTERY</Micro>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ font: F.osw(600, 14), ...TAB, minWidth: 38, color: stale ? T.micro : battColor }}>{batt == null ? '—' : stale ? `${batt}%*` : `${batt}%`}</span>
          <SegBar pct={stale ? 0 : batt ?? 0} color={battColor} height={8} cell={7} style={{ flex: 1, maxWidth: 96 }} />
          {stale && <span style={{ font: F.mono(500, 8), color: T.micro }}>*OLD</span>}
        </span>
        <Micro>LINK</Micro><Val color={g.node === 'none' ? T.bad : stale ? T.warn : T.dim}>{linkText}</Val>
        <Micro>COMPANION</Micro><Val color={T.micro}>—</Val>
      </div>
      {g.blockers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {g.blockers.map(b => (
            <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 8, font: F.chk(600, 11), letterSpacing: '.06em', padding: '6px 10px',
              background: red ? 'rgba(255,82,82,.1)' : 'rgba(255,176,32,.08)', color, borderLeft: `2px solid ${color}` }}>▲ {b}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Val({ children, color }: { children: React.ReactNode; color: string }) {
  return <span style={{ font: F.chk(600, 12), letterSpacing: '.08em', color }}>{children}</span>;
}


/** A connected companion phone — with or without a gun. Same card language as GunCard. */
function NodeCard({ n }: { n: { node_id: string; gun_name?: string | null; arm_state: string; last_seen_ms?: number | null; player_id?: string | null; battery?: number | null; fw?: string | null; preflight?: { phone_batt?: number | null } | null } }) {
  const hasGun = !!n.gun_name;
  const accent = hasGun ? T.acc : T.warn;
  const age = n.last_seen_ms ?? 0;
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderLeft: `3px solid ${accent}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 11, clipPath: CHAMFER.tr12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ font: F.osw(700, 18), letterSpacing: '.08em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hasGun ? n.gun_name : 'NO GUN SET'}</span>
        <Tag color={accent}>{n.arm_state.toUpperCase()}</Tag>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '82px 1fr', gap: '6px 10px', alignItems: 'center' }}>
        <Micro>PHONE</Micro><Val color={T.dim}>{n.node_id.slice(0, 12)}</Val>
        <Micro>LINK</Micro><Val color={age > 8000 ? T.warn : T.dim}>{fmtAge(age)} AGO</Val>
        {n.preflight?.phone_batt != null && (<><Micro>PH BATT</Micro><Val color={n.preflight.phone_batt < 20 ? T.bad : T.dim}>{n.preflight.phone_batt}%</Val></>)}
        {n.battery != null && (<><Micro>GUN BATT</Micro><Val color={T.dim}>{n.battery}%</Val></>)}
        {n.fw && (<><Micro>FIRMWARE</Micro><Val color={T.dim}>{n.fw}</Val></>)}
      </div>
      {!hasGun && <div style={{ font: F.mono(500, 9), letterSpacing: '.14em', color: T.warn }}>▲ WAITING FOR ITS GUN — SET IT ON THE PHONE</div>}
      {hasGun && !n.player_id && <div style={{ font: F.mono(500, 9), letterSpacing: '.14em', color: T.dim }}>UNASSIGNED — BIND A PLAYER IN KIT</div>}
    </div>
  );
}

/** A registry gun nobody can see right now. */
function GhostCard({ r }: { r: { gun_id: string; sticker: string; ble: { tail?: string } } }) {
  return (
    <div style={{ background: T.panelAlt, border: `1px dashed ${T.line2}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 8, opacity: .75 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ font: F.osw(700, 18), letterSpacing: '.08em', color: T.dim }}>{r.sticker}{r.ble?.tail ? <span style={{ font: F.mono(500, 11), color: T.micro }}>-{r.ble.tail}</span> : null}</span>
        <Tag color={T.micro}>OFFLINE</Tag>
      </div>
      <div style={{ font: F.mono(500, 9), letterSpacing: '.14em', color: T.micro }}>IN THE REGISTRY — POWER IT UP AND SCAN</div>
    </div>
  );
}
