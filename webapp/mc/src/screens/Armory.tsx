import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { isRoutableLanIp, registrySig } from '../api/derive';
import type { LogView, ReadinessRow } from '../api/types';
import { setNotice } from '../notice';
import { useStore } from '../store';
import { CHAMFER, F, T, TAB, fmtAge } from '../tokens';
import { CountBlock, GhostButton, Micro, ScreenHeader, SectionRule, Seg, SegBar, Tag } from '../ui';
import { Items } from './Items';

const statusColor = (s: ReadinessRow['status']) =>
  (s === 'red' ? T.bad : s === 'amber' ? T.warn : s === 'waiting' ? T.micro : T.ok);

// A29 (2026-09-12) — the phones report their REAL build now (`"<version>+<sha>[-dirty]"`). MC could not
// tell APK 0.1.8 from today's tree at the game test, and a phone a version behind can misplay the
// match. Two rules, and BOTH of them live on the server (`state.py readiness()` holds `APP_MAJOR`):
// a wrong MAJOR is a RED blocker, a MINOR/PATCH difference is AMBER. The console renders the strings
// it is sent and derives NO version rule of its own — it only shows the version and counts the field.

/** `"0.1.9+ab12cd3-dirty"` → `"0.1.9"` for the tally; the sha is noise in a summary and gold in a chip. */
const verShort = (v?: string | null) => (v ? v.split('+')[0] : '');
/** newest first by semver, so the summary leads with the version the field SHOULD be on */
const verRank = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0);
const verCmp = (a: string, b: string) => {
  const [x, y] = [verRank(a), verRank(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
};
/** "PHONES · 6 × 0.1.9 · 2 × 0.1.8" — a TALLY of what is on the field, never a verdict about it.
 *  A phone that has not reported a build is counted as UNKNOWN rather than folded into the majority.
 *
 *  `field` is the server's own count (`state.py versions()`, `State.versions.field`) when the snapshot
 *  carries it; otherwise the console counts the nodes it can see. Both produce the same sentence, and
 *  neither decides anything: every version VERDICT arrives already worded, in a readiness row. */
export function appVerSummary(nodes: { app_ver?: string }[], field?: Record<string, number>): string {
  const counts = new Map<string, number>();
  if (field && Object.keys(field).length) {
    for (const [v, n] of Object.entries(field)) counts.set(verShort(v) || 'UNKNOWN', (counts.get(verShort(v) || 'UNKNOWN') ?? 0) + n);
  } else {
    if (nodes.length === 0) return '';
    for (const n of nodes) {
      const v = verShort(n.app_ver) || 'UNKNOWN';
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return '';
  const parts = [...counts.entries()]
    .sort((a, b) => (a[0] === 'UNKNOWN' ? 1 : b[0] === 'UNKNOWN' ? -1 : verCmp(a[0], b[0])))
    .map(([v, n]) => `${n} × ${v}`);
  return `PHONES · ${parts.join(' · ')}`;
}

// A25 (2026-09-12, D6) — background log sync. "For almost all of my games I'm going to want the logs
// from all phones." MC asks on its own while `log_sync` is `auto` (at the recap, on a node's offer, on
// a reconnect); `manual` leaves the asking to the operator. The LOGS button is never gated either way.
//
// What the board shows is what the PHONE reports, never what MC intended: MC asking does not make a
// log `offered`, because the node answers when it is safe to and MC never waits on it (`state.py
// _set_log`). So every state below is a fact about the phone, and `none` is "the phone has not said",
// not "there is nothing".
const LOG_LABEL: Record<LogView['state'], { text: string; color: string }> = {
  none: { text: 'NOTHING OFFERED', color: T.micro },
  offered: { text: 'READY TO SEND', color: T.acc },
  pulling: { text: 'SENDING…', color: T.warn },
  held: { text: 'HOLDING', color: T.warn },
  complete: { text: 'DELIVERED ✓', color: T.ok },
};
const kb = (n?: number) => (n == null ? '' : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** One node's log line. Always rendered — a row that vanishes when a phone has said nothing reads as
 *  "fine", and "the phone has not said" is exactly what the operator needs to know before a match. */
function LogCell({ log }: { log?: LogView }) {
  const st = log?.state ?? 'none';
  const { text, color } = LOG_LABEL[st] ?? LOG_LABEL.none;
  // the node worded `reason` itself ("2 facts pending") — render it verbatim, never re-phrase it
  const detail = [log?.reason, st === 'pulling' || st === 'complete' || st === 'offered'
    ? [log?.lines ? `${log.lines} lines` : '', kb(log?.bytes)].filter(Boolean).join(' · ') : '']
    .filter(Boolean).join(' · ');
  return (
    <span data-log-state={st} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ font: F.chk(600, 12), letterSpacing: '.08em', color }}>{text}</span>
      {detail && <span style={{ font: F.mono(500, 11), letterSpacing: '.04em', color: T.micro, textTransform: 'none' }}>{detail}</span>}
    </span>
  );
}

export function Armory() {
  const { state, run, api, setView } = useStore();
  const [scanning, setScanning] = useState(false);
  const [registry, setRegistry] = useState<{ gun_id: string; sticker: string; ble: { tail?: string } }[]>([]);
  // Keyed on WHICH GUNS MC knows about, so a SCAN that enrols a new gun shows up in KNOWN GUNS —
  // NOT SEEN without a reload. NOT on `readiness.t`: that is a clock, and at 4 snapshots a second it
  // refetches the armory ~4x/s for as long as this screen is open (review 2026-09-01).
  const sig = registrySig(state);
  useEffect(() => { api.armory().then(setRegistry).catch(() => { /* keep the last good list — a transient failure must not empty KNOWN GUNS */ }); }, [api, sig]);
  if (!state) return null;
  const { readiness } = state;
  const board = readiness.board;
  // A13.5: a utility phone is a station, not a companion; it has its own card in ITEMS below.
  const phones = (state.nodes ?? []).filter(n => n.node_type !== 'utility');
  const nGreen = board.filter(g => g.status === 'green').length;
  const nAmber = board.filter(g => g.status === 'amber').length;
  const nRed = board.filter(g => g.status === 'red').length;
  const nWaiting = board.filter(g => g.status === 'waiting').length;
  const firstRed = board.find(g => g.status === 'red');
  // "waiting" is not a fault and must not be reported as one: it just means the phone has not
  // arrived yet (Tony, 2026-09-01 — a board full of disconnected guns "looked like critical errors").
  // No separate status line under CONTINUE. Tony, 2026-09-02: "we dont need this extra status. maybe
  // a disabled status on the button and thats it" — so the button IS the status: it says what it is
  // waiting for, and is disabled while it waits.
  const gateLabel = nRed ? `${nRed} GUN${nRed === 1 ? '' : 'S'} BLOCKED` : 'CONTINUE ▸';
  const gateWhy = nRed ? (firstRed?.blockers?.[0] ?? 'Clear the fault to continue')
    : nWaiting ? 'Open the BRX app on each phone and set its gun'
    : nGreen ? '' : 'Power the guns and open the app on each phone';

  return (
    <div className="screen" style={{ maxWidth: 1380, margin: '0 auto' }}>
      <ScreenHeader kicker="[ A1 // GEAR CHECK ]" title="Readiness Board" right={
        <>
          <GhostButton onClick={async () => { setScanning(true); await run(() => api.scan(6)); setScanning(false); }}>{scanning ? 'SCANNING…' : '⟳ SCAN ARMORY'}</GhostButton>
          {/* A29: what the field is running, at the top of the screen where the operator decides whether
              to send someone to update before the night starts. The server may word this itself
              (`readiness.app_vers`); when it does not, the console counts the nodes. */}
          {/* A25: the session switch. Rendered ONLY when the server sends an option table — an older MC
              has no `/api/options` to PUT to, and a switch that writes to a 404 is worse than none. */}
          {state.options?.log_sync && (
            <span data-logsync={state.options.log_sync} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
              title="AUTO: MC asks each phone for its log on its own — at the recap, when a phone offers one, and when one comes back into range. MANUAL: only the LOGS button asks.">
              <span style={{ font: F.mono(600, 11), letterSpacing: '.16em', color: T.micro }}>LOG SYNC</span>
              <Seg label="log sync" value={state.options.log_sync}
                options={[{ value: 'auto' as const, label: 'AUTO' }, { value: 'manual' as const, label: 'MANUAL' }]}
                onChange={v => run(() => api.setOptions({ log_sync: v }))} pad="5px 12px" />
            </span>
          )}
          {phones.length > 0 && (
            <span data-app-ver-summary="1" title="Every phone on the net and the build it reports"
              style={{ font: F.mono(600, 11), letterSpacing: '.1em', color: T.dim, border: `1px solid ${T.line2}`, padding: '7px 12px' }}>
              {appVerSummary(phones, state.versions?.field)}
            </span>
          )}
          <div style={{ display: 'flex', gap: 2 }}>
            <CountBlock value={nGreen} label="GREEN" color={T.ok} />
            <CountBlock value={nAmber} label="AMBER" color={T.warn} />
            <CountBlock value={nRed} label="RED" color={nRed ? T.bad : T.micro} />
            {nWaiting > 0 && <CountBlock value={nWaiting} label="NO PHONE" color={T.micro} />}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
            {/* Disabled on REDS only. Amber never blocked continuing and must not start now — this
                is navigation to GAMES; the real gate is the lobby push. */}
            <button type="button" className={!nRed ? 'hov-accbg' : ''} disabled={!!nRed} title={gateWhy}
              onClick={async () => { await run(() => api.setPhase('build')); setView('build'); }}
              style={{ font: F.osw(700, 20), letterSpacing: '.22em', padding: '10px 26px 10px 32px', whiteSpace: 'nowrap',
                background: nRed ? 'transparent' : nGreen ? T.ok : T.panelAlt, color: nRed ? T.micro : nGreen ? T.accInk : T.dim,
                border: `1px solid ${nRed ? T.line2 : nGreen ? T.ok : T.line}`, clipPath: CHAMFER.tl14,
                cursor: nRed ? 'not-allowed' : 'pointer', minHeight: 48 }}>{gateLabel}</button>
          </div>
        </>
      } />
      <div style={{ display: 'flex', gap: 14, alignItems: 'stretch', flexWrap: 'wrap', marginBottom: 20 }}>
        <JoinPanel />
        <div style={{ flex: '1 1 520px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))', gap: 12, alignContent: 'start' }}>
          {board.map(g => <GunCard key={g.sticker} g={g} />)}
          {board.length === 0 && <div style={{ font: F.mono(500, 11), letterSpacing: '.14em', color: T.micro, padding: '20px 4px' }}>NO PLAYERS YET — ADD OPERATORS IN KIT, OR JUST GET PHONES JOINED FIRST ◂</div>}
        </div>
      </div>
      <Items />
      {phones.length > 0 && (
        /* `data-nodes` is the count this section BELIEVES it is rendering; each card carries
           `data-node-card`. A test can then wait for "every phone card is on screen" instead of
           sleeping through the first snapshots — the sleep is what hid the arm_state crash below. */
        <div style={{ marginTop: 20 }} data-nodes={phones.length}>
          <SectionRule label={`PHONES ON THE NET // ${phones.length}`} hint="WITH OR WITHOUT A GUN" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))', gap: 12 }}>
            {phones.map(n => <NodeCard key={n.node_id} n={n} registry={registry} />)}
          </div>
        </div>
      )}
      {registry.filter(r => !readiness.unclaimed.some(u => u.gun_id === r.gun_id) && !readiness.board.some(b => b.gun_id === r.gun_id) && !(state?.nodes ?? []).some(n => (n.gun_tail || '').toUpperCase() === (r.ble?.tail || '—').toUpperCase())).length > 0 && (
        <div style={{ marginTop: 20 }}>
          <SectionRule label="KNOWN GUNS — NOT SEEN" hint="POWERED OFF, OUT OF RANGE, OR NOT YET CLAIMED BY A PHONE" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))', gap: 12 }}>
            {registry.filter(r => !readiness.unclaimed.some(u => u.gun_id === r.gun_id) && !readiness.board.some(b => b.gun_id === r.gun_id) && !(state?.nodes ?? []).some(n => (n.gun_tail || '').toUpperCase() === (r.ble?.tail || '—').toUpperCase())).map(r => <GhostCard key={r.gun_id} r={r} />)}
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
                {u.identity !== 'ok' && <Tag color={u.identity === 'reverted' ? T.bad : T.warn} size={11}>{u.identity.toUpperCase()}</Tag>}
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
  const waiting = g.status === 'waiting';   // no phone yet: inactive, NOT a fault
  const batt = g.battery_pct;
  const battColor = batt == null ? T.micro : batt < 30 ? T.bad : batt < 60 ? T.warn : T.ok;
  const age = g.last_seen_age_ms ?? g.battery_age_ms ?? null;                 // real link age from the server
  const stale = age != null && age > 60_000;                                   // >1 min old = show nothing as live truth
  const linkText = g.node === 'none' ? 'NO PHONE' : age == null ? '—' : `${fmtAge(age)} AGO`;
  // A32: the server says WHETHER the headset is proven and HOW — `link` = a BLE link this phone has held
  // for 10 s, which a headless gun cannot do (it drops in ~6 s), `echo` = the gun answered the config push.
  // The "still confirming" count-up is an ordinary server amber and is rendered by the amber list below;
  // this card never times anything itself, so it cannot disagree with the board.
  const hs = stale ? 'UNKNOWN'
    : g.headset === 'proven' ? (g.headset_proof === 'link' ? 'PROVEN BY LINK' : 'CONNECTED')
    : g.headset === 'absent' ? '—' : 'UNKNOWN';
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderLeft: `3px solid ${color}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 11, clipPath: CHAMFER.tr12, opacity: waiting ? 0.62 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flex: '1 1 auto' }}>
          {/* the sticker usually ALREADY ends in the tail ("ALPHA-3D4F"), and printing it again wrapped
              the title onto two lines and pushed the status tag off the card edge (field 2026-09-02) */}
          <span title={g.sticker} style={{ font: F.osw(700, 20), letterSpacing: '.06em', whiteSpace: 'nowrap',
                                           overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{g.sticker}</span>
          {!!g.tail && !g.sticker.toUpperCase().endsWith(g.tail.toUpperCase())
            && <span style={{ font: F.mono(500, 11), color: T.micro, whiteSpace: 'nowrap' }}>-{g.tail}</span>}
          {g.player_num != null && <span style={{ font: F.mono(500, 11), color: T.acc, whiteSpace: 'nowrap' }}>#{g.player_num}</span>}
        </div>
        <Tag color={color} style={{ whiteSpace: 'nowrap', flex: '0 0 auto' }}>
          {red ? 'BLOCKED' : g.status === 'waiting' ? (g.node === 'none' ? 'NO PHONE YET' : 'OFFLINE') : g.status === 'amber' ? 'CHECK' : 'READY'}
        </Tag>
      </div>
      {g.node === 'none' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '82px 1fr', gap: '6px 10px', alignItems: 'center' }}>
          <Micro>LINK</Micro><Val color={T.micro}>NO PHONE</Val>
          <Micro>LAST SEEN</Micro><Val color={T.micro}>{age == null ? 'NEVER THIS SESSION' : `${fmtAge(age)} AGO`}</Val>
        </div>
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: '82px 1fr', gap: '6px 10px', alignItems: 'center' }}>
        <Micro>GUN</Micro><Val color={stale ? T.warn : g.gun_linked ? T.ink : g.gun_linked === false ? T.bad : T.micro}>{stale ? `UNKNOWN — LAST DATA ${fmtAge(age ?? 0)} AGO` : g.gun_linked ? 'LINKED' : g.gun_linked === false ? 'LINK LOST' : '—'}</Val>
        <Micro>HEADSET</Micro><span data-headset={stale ? 'stale' : g.headset_proof ?? g.headset}><Val color={stale ? T.micro : g.headset === 'proven' ? T.ink : g.headset === 'absent' ? T.micro : T.warn}>{hs}</Val></span>
        <Micro>BATTERY</Micro>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ font: F.osw(600, 14), ...TAB, minWidth: 38, color: stale ? T.micro : battColor }}>{batt == null ? '—' : stale ? `${batt}%*` : `${batt}%`}</span>
          <SegBar pct={stale ? 0 : batt ?? 0} color={battColor} height={8} cell={7} style={{ flex: 1, maxWidth: 96 }} />
          {stale && <span style={{ font: F.mono(500, 8), color: T.micro }}>*OLD</span>}
        </span>
        <Micro>LINK</Micro><Val color={stale ? T.warn : T.dim}>{linkText}</Val>   {/* this branch only runs when a node IS linked */}
        {/* A25: the same log view as the node card, on the per-player board — this is the one the
            operator is reading before a match, and "whose log is still owed" is a per-PLAYER question. */}
        {g.log && (<><Micro>LOG</Micro><LogCell log={g.log} /></>)}
        {/* COMPANION row returns when the ESP32 rider exists — an always-empty row reads as broken (critic #25) */}
      </div>
      )}
      {[...(g.blockers ?? []), ...(g.ambers ?? [])].length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Every message is `STATEMENT — INSTRUCTION`. As one uppercase run-on in a 248px card it
              wrapped mid-phrase and read as noise; split, the statement carries and the instruction
              sits under it quietly (field 2026-09-02). */}
          {[...(g.blockers ?? []).map(b => [b, true] as const), ...(g.ambers ?? []).map(b => [b, false] as const)].map(([b, blocking]) => {
            const [head, ...rest] = b.split(' — ');
            const hint = rest.join(' — ').replace(/\b(DOES NOT BLOCK( YET)?|BLOCKS START)\b/g, '').trim();
            return (
              <div key={b} style={{ display: 'flex', gap: 8, padding: '7px 10px',
                background: blocking && red ? 'rgba(255,82,82,.1)' : blocking && !waiting ? 'rgba(255,176,32,.08)' : 'transparent',
                borderLeft: `2px solid ${blocking ? color : T.line2}` }}>
                <span style={{ font: F.chk(700, 11), color: blocking ? color : T.micro, flex: '0 0 auto' }}>{blocking ? (waiting ? '·' : '▲') : '·'}</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ font: F.chk(700, 11.5), letterSpacing: '.06em', color: blocking ? color : T.micro }}>{head}</span>
                  {hint && <span style={{ font: F.chk(500, 11), letterSpacing: '.02em', color: T.micro, textTransform: 'none' }}>{sentence(hint)}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Val({ children, color }: { children: React.ReactNode; color: string }) {
  return <span style={{ font: F.chk(600, 12), letterSpacing: '.08em', color }}>{children}</span>;
}


/** A connected companion phone — with or without a gun. Same card language as GunCard.
 *
 *  EVERY field here is optional on purpose, `NodeView` notwithstanding. A node that has said hello
 *  but not yet sent its first `status` has NO `arm_state`, and `n.arm_state.toUpperCase()` took the
 *  whole console down with it for the first ~300 ms of every session — the e2e walk had been
 *  sleeping past it rather than seeing it (review 2026-09-12). The skill's rule: write down what
 *  the UI does when a field is absent, because an older server or an earlier snapshot is normal. */
function NodeCard({ n, registry = [] }: { registry?: { gun_id: string; ble?: { tail?: string } }[]; n: { node_id?: string | null; gun_tail?: string | null; gun_name?: string | null; arm_state?: string | null; last_seen_ms?: number | null; player_id?: string | null; battery?: number | null; fw?: string | null; app_ver?: string | null; platform?: string | null; log?: LogView | null; preflight?: { phone_batt?: number | null } | null } }) {
  const { state, run, api } = useStore();
  const [name, setName] = useState('');
  const hasGun = !!n.gun_name;

  // device-first claim (Tony 2026-08-26: "first assign roster/gamers with phones/taggers" — naming
  // players then hunting guns in a tiny dropdown is backwards). The gun resolves via the registry
  // tail; an unregistered gun falls back to its tail, which the server matcher also accepts.
  const gunId = n.gun_tail ? (registry.find((r: { gun_id: string; ble?: { tail?: string } }) => (r.ble?.tail || '').toUpperCase() === n.gun_tail!.toUpperCase())?.gun_id ?? n.gun_tail) : null;
  const gunClaimed = !!gunId && (state?.players ?? []).some((pl: { gun_id?: string | null }) => (pl.gun_id || '').toUpperCase() === String(gunId).toUpperCase());
  const [claiming, setClaiming] = useState(false);
  const claim = async (team: string) => {
    if (!name.trim() || !gunId || claiming) return;
    setClaiming(true);
    try { await run(() => api.addPlayer({ display: name.trim(), team_id: team, gun_id: gunId })); setName(''); }
    finally { setClaiming(false); }
  };
  const accent = hasGun ? T.acc : T.warn;
  const age = n.last_seen_ms ?? 0;
  return (
    <div data-node-card={n.node_id ?? '?'} style={{ background: T.panel, border: `1px solid ${T.line}`, borderLeft: `3px solid ${accent}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 11, clipPath: CHAMFER.tr12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ font: F.osw(700, 18), letterSpacing: '.08em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hasGun ? n.gun_name : 'NO GUN SET'}</span>
        <Tag color={accent}>{(n.arm_state ?? 'unknown').toUpperCase()}</Tag>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '82px 1fr', gap: '6px 10px', alignItems: 'center' }}>
        <Micro>PHONE</Micro><Val color={T.dim}>{(n.node_id ?? '—').slice(0, 12)}</Val>
        <Micro>LINK</Micro><Val color={age > 8000 ? T.warn : T.dim}>{fmtAge(age)} AGO</Val>
        {n.preflight?.phone_batt != null && (<><Micro>PH BATT</Micro><Val color={n.preflight.phone_batt < 20 ? T.bad : T.dim}>{n.preflight.phone_batt}%</Val></>)}
        {n.battery != null && (<><Micro>GUN BATT</Micro><Val color={T.dim}>{n.battery}%</Val></>)}
        {n.fw && (<><Micro>FIRMWARE</Micro><Val color={T.dim}>{n.fw}</Val></>)}
        {/* A29: always rendered, even when the phone has not said — "UNKNOWN" is the answer the
            operator needs (an app that predates A29 reports nothing at all), and a row that simply
            vanishes reads as "fine". */}
        <Micro>APP</Micro>
        <span data-app-ver={n.app_ver ?? ''} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <Val color={n.app_ver ? T.ink : T.micro}>{verShort(n.app_ver) || 'UNKNOWN'}</Val>
          {/* the git sha is what tells "0.1.9 from the release" from "0.1.9 from your tree" apart. It used
              to be cut to 7 characters with the WHOLE string parked in a `title` — which on the match-day
              touch console is nowhere, because there is no hover. The build metadata the app stamps is a
              short sha plus an optional `-dirty` (app/scripts/build.mjs), so it is 13 characters at worst:
              there was never anything to truncate. `-dirty` says this phone is running somebody's working
              tree rather than a build anyone can reproduce, which is the single most important thing this
              row can tell an operator, so it is shown and it is shown in the warning colour. */}
          {n.app_ver?.includes('+') && (() => {
            const meta = n.app_ver.split('+').slice(1).join('+');
            const flag = meta.indexOf('-');                      // the sha, then whatever the build stamped after it
            const [sha, rest] = flag < 0 ? [meta, ''] : [meta.slice(0, flag), meta.slice(flag)];
            return (
              // 11 px, not 10: every part of this chip carries meaning (version, sha, `-dirty`,
              // platform) and the tiny-text sweep fails anything meaning-bearing under 11 px — it
              // caught this one at both viewports (review 2026-09-12). It WRAPS rather than shrinking:
              // the row has a whole line to spend and the metadata is 13 characters at worst.
              <span title={n.app_ver} style={{ font: F.mono(500, 11), color: T.faint, minWidth: 0, wordBreak: 'break-all' }}>
                +{sha}{rest && <span style={{ color: T.warn }}>{rest}</span>}
              </span>
            );
          })()}
          {n.platform && <span style={{ font: F.mono(500, 11), letterSpacing: '.12em', color: T.micro }}>{n.platform.toUpperCase()}</span>}
        </span>
        <Micro>LOG</Micro><LogCell log={n.log ?? undefined} />
      </div>
      {/* A25: always asks, whatever `log_sync` is set to — `reason: "manual"` is never gated. */}
      <PullLogButton node_id={n.node_id ?? ''} />
      {!hasGun && <div style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.warn }}>▲ WAITING FOR ITS GUN — SET IT ON THE PHONE</div>}
      {hasGun && !n.player_id && !gunClaimed && (
        <form onSubmit={e => { e.preventDefault(); claim('blue'); }} style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${T.line2}`, paddingTop: 10 }}>
          <div style={{ font: F.chk(700, 11), letterSpacing: '.2em', color: T.acc }}>▸ WHO CARRIES THIS?</div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="GAMERTAG" maxLength={24} aria-label={`gamertag for ${n.gun_name}`}
            style={{ background: T.panelDeep, border: `1px solid ${T.line2}`, color: T.ink, font: F.osw(600, 15), letterSpacing: '.06em', padding: '9px 12px', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => claim('blue')} disabled={!name.trim() || claiming}
              style={{ flex: 1, padding: '10px 0', background: name.trim() ? '#0f2438' : T.panelDeep, color: name.trim() ? '#7cc4ff' : T.micro, border: '1px solid #24486b', font: F.chk(700, 11), letterSpacing: '.2em', cursor: name.trim() ? 'pointer' : 'default' }}>JOIN BLUE</button>
            <button type="button" onClick={() => claim('yellow')} disabled={!name.trim() || claiming}
              style={{ flex: 1, padding: '10px 0', background: name.trim() ? '#2e2408' : T.panelDeep, color: name.trim() ? T.warn : T.micro, border: '1px solid #6b5824', font: F.chk(700, 11), letterSpacing: '.2em', cursor: name.trim() ? 'pointer' : 'default' }}>JOIN YELLOW</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** A25 — the operator's LOGS button.
 *
 *  `ok` is whether the ASK went out, NOT whether a log arrived: MC never waits on the node. So the
 *  answer on screen has to say exactly that much and no more. `ok: false` is MC refusing to ask at all
 *  (a utility phone, a node past the ~1 MB budget, no socket) and must look different from a successful
 *  ask, or the button answers "nothing happened" and "done" the same way — the F40 shape. */
function PullLogButton({ node_id }: { node_id: string }) {
  const { api, run } = useStore();
  const [busy, setBusy] = useState(false);
  if (!node_id) return null;
  return (
    <button type="button" data-pull-log={node_id} disabled={busy}
      title="Ask this phone for its match log now. Never gated by LOG SYNC — the phone still answers when it is safe to."
      onClick={async () => {
        setBusy(true);
        try {
          const r = await run(() => api.pullLog(node_id));
          if (r) setNotice(r.ok ? 'ASKED FOR THE LOG — THE PHONE ANSWERS WHEN IT CAN'
                                : 'COULD NOT ASK FOR THE LOG — THE PHONE IS OFF THE NET, OR PAST ITS UPLOAD BUDGET', !r.ok);
        } finally { setBusy(false); }
      }}
      style={{ alignSelf: 'flex-start', font: F.chk(700, 11), letterSpacing: '.18em', padding: '9px 14px', minHeight: 36,
               background: 'transparent', border: `1px solid ${T.line2}`, color: busy ? T.micro : T.dim,
               cursor: busy ? 'default' : 'pointer' }}>
      {busy ? 'ASKING…' : '⬇ LOGS'}
    </button>
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
      <div style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.micro }}>IN THE REGISTRY — POWER IT UP AND SCAN</div>
    </div>
  );
}


/** The join QR is step zero of muster — it earns a real panel, not a status-bar popover (critic #7). */
function JoinPanel() {
  const { state } = useStore();
  const [url, setUrl] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const qr = state?.lan.qr;
  // routable, not merely truthy: `lan.ip` falls back to 127.0.0.1, and a QR for loopback sends the
  // operator's phone to its own browser (review 2026-09-01)
  const apkUrl = isRoutableLanIp(state?.lan.ip) ? `http://${state!.lan.ip}:${state!.lan.port || 8765}/openbrx.apk` : '';
  const [apkQr, setApkQr] = useState<string | null>(null);
  useEffect(() => {
    if (!apkUrl) return;
    QRCode.toDataURL(apkUrl, { margin: 2, width: 300, errorCorrectionLevel: 'M', color: { dark: '#0b0e13', light: '#ffffff' } }).then(setApkQr).catch(() => setApkQr(null));
  }, [apkUrl]);
  useEffect(() => {
    if (!qr) return;
    QRCode.toDataURL(qr, { margin: 2, width: 480, errorCorrectionLevel: 'M', color: { dark: '#0b0e13', light: '#ffffff' } }).then(setUrl).catch(() => setUrl(null));
  }, [qr]);
  if (!qr) return null;
  return (
    <div style={{ flex: '0 0 300px', background: `linear-gradient(180deg,${T.panelSoft},${T.panelDeep})`, border: `1px solid ${T.line}`, borderTop: `2px solid ${T.acc}`, padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ alignSelf: 'stretch', font: F.chk(700, 11), letterSpacing: '.28em', color: T.acc }}>▸ JOIN THE NET</div>
      <div style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.dim, textAlign: 'center', lineHeight: 1.8 }}>PHONES ON THIS WI-FI FIND MC <span style={{ color: T.ink }}>AUTOMATICALLY</span> — OPEN BRX COMPANION AND WAIT A BEAT</div>
      <div style={{ font: F.mono(600, 12), letterSpacing: '.04em', color: T.ink, textAlign: 'center', wordBreak: 'break-all' }}>{state?.lan.ws_url}</div>
      <button onClick={() => setShowQr(v => !v)} style={{ minHeight: 36,  alignSelf: 'stretch', background: showQr ? T.panelAlt : 'transparent', border: `1px solid ${T.line2}`, color: T.dim, font: F.chk(700, 11), letterSpacing: '.2em', padding: '9px 0', cursor: 'pointer' }}>
        {showQr ? '▴ HIDE QR CODES' : '▾ SHOW QR CODES'}
      </button>
      {showQr && <>
        <div style={{ font: F.chk(700, 11), letterSpacing: '.22em', color: T.dim }}>JOIN — TAP SCAN QR IN THE APP</div>
        {url && <div style={{ background: '#ffffff', padding: 10, lineHeight: 0, boxShadow: `0 0 0 1px ${T.line}, 0 8px 24px rgba(0,0,0,.45)` }}><img src={url} width={200} height={200} alt="node join QR" style={{ display: 'block', imageRendering: 'pixelated' }} /></div>}
        {/* no lan.ip means no download URL to print and no QR to scan — the header alone told the
            operator to point a camera at nothing (polish-loop deferred low) */}
        {apkUrl ? (
          <div style={{ alignSelf: 'stretch', borderTop: `1px solid ${T.line2}`, paddingTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ font: F.chk(700, 11), letterSpacing: '.22em', color: T.dim }}>NO APP YET? PHONE CAMERA HERE</div>
            {apkQr && <div style={{ background: '#ffffff', padding: 8, lineHeight: 0, boxShadow: `0 0 0 1px ${T.line}` }}><img src={apkQr} width={132} height={132} alt="apk download QR" style={{ display: 'block', imageRendering: 'pixelated' }} /></div>}
            <div style={{ font: F.mono(500, 11), letterSpacing: '.02em', color: T.micro, wordBreak: 'break-all', textAlign: 'center' }}>{apkUrl}</div>
          </div>
        ) : (
          <div style={{ alignSelf: 'stretch', borderTop: `1px solid ${T.line2}`, paddingTop: 12, font: F.mono(500, 11), letterSpacing: '.1em', color: T.micro, textAlign: 'center' }}>
            NO LAN ADDRESS ({state?.lan.ip || '—'}) — MC IS NOT ON A NETWORK PHONES CAN REACH.
            {' '}JOIN THE FIELD WI-FI AND RESTART MC; SIDELOAD THE APK BY CABLE MEANWHILE.
          </div>
        )}
      </>}
    </div>
  );
}



/** "OPEN THE APP AND SET THE GUN" -> "Open the app and set the gun". Shouted instructions are what
 *  made these cards read as noise; the STATEMENT still shouts, the instruction does not. */
function sentence(t: string) {
  const s = t.trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
