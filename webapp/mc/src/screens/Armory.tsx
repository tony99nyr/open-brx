import { useState } from 'react';
import type { ReadinessRow } from '../api/types';
import { useStore } from '../store';
import { CHAMFER, F, T, TAB, fmtAge } from '../tokens';
import { CountBlock, GhostButton, Micro, ScreenHeader, SectionRule, SegBar, Tag } from '../ui';

const statusColor = (s: ReadinessRow['status']) => (s === 'red' ? T.bad : s === 'amber' ? T.warn : T.ok);

export function Armory() {
  const { state, run, api } = useStore();
  const [scanning, setScanning] = useState(false);
  if (!state) return null;
  const { readiness } = state;
  const board = readiness.board;
  const nGreen = board.filter(g => g.status === 'green').length;
  const nAmber = board.filter(g => g.status === 'amber').length;
  const nRed = board.filter(g => g.status === 'red').length;
  const firstRed = board.find(g => g.status === 'red');
  const gateNote = nRed
    ? `${firstRed?.sticker} BLOCKS START — ${firstRed?.blockers[0]?.split(' — ')[0] ?? 'CHECK IT'}`
    : 'NO REDS — START WHEN READY';

  return (
    <div className="screen">
      <ScreenHeader kicker="[ A1 // GEAR CHECK ]" title="Readiness Board" right={
        <>
          <GhostButton onClick={async () => { setScanning(true); await run(() => api.scan(6)); setScanning(false); }}>{scanning ? 'SCANNING…' : '⟳ SCAN ARMORY'}</GhostButton>
          <div style={{ display: 'flex', gap: 2 }}>
            <CountBlock value={nGreen} label="GREEN" color={T.ok} />
            <CountBlock value={nAmber} label="AMBER" color={T.warn} />
            <CountBlock value={nRed} label="RED" color={nRed ? T.bad : T.micro} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
            <div style={{ font: F.osw(700, 22), letterSpacing: '.3em', padding: '8px 26px 8px 32px', background: nRed ? T.bad : T.ok, color: T.accInk, clipPath: CHAMFER.tl14 }}>{nRed ? 'HOLD' : 'GO'}</div>
            <div style={{ font: F.mono(500, 10), letterSpacing: '.14em', color: T.micro }}>{gateNote}</div>
          </div>
        </>
      } />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(248px,1fr))', gap: 12 }}>
        {board.map(g => <GunCard key={g.sticker} g={g} />)}
      </div>
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
  const stale = (g.last_seen_ms ?? 0) > 8000;
  const linkText = g.node === 'none' ? `LAST SEEN ${fmtAge(g.last_seen_ms ?? 0)}` : `${fmtAge(g.last_seen_ms ?? 0)} AGO`;
  const hs = g.headset === 'proven' ? 'CONNECTED' : g.headset === 'absent' ? '—' : 'UNKNOWN';
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
        <Micro>POWER</Micro><Val color={g.present ? T.ink : T.bad}>{g.present ? 'ON' : 'OFF'}</Val>
        <Micro>HEADSET</Micro><Val color={g.headset === 'proven' ? T.ink : g.headset === 'absent' ? T.micro : T.warn}>{hs}</Val>
        <Micro>BATTERY</Micro>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ font: F.osw(600, 14), ...TAB, minWidth: 38, color: battColor }}>{batt == null ? '—' : `${batt}%`}</span>
          <SegBar pct={batt ?? 0} color={battColor} height={8} cell={7} style={{ flex: 1, maxWidth: 96 }} />
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
